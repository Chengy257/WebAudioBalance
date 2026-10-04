/**
 * WebAudioBalance - AudioEngine
 * Concrete per-tab audio engine managing source capture, gain processing,
 * dual continuous BS.1770-5 loudness metering (input + output verification),
 * headroom-aware safety, and normalization lifecycle.
 */

import { AudioEngineState, validateStateTransition } from './types.js';
import { GainProcessor } from './gain-processor.js';
import { SafetyHook } from './safety.js';
import { LoudnessMeter } from './loudness-meter.js';
import { ActivityDetector } from './activity-detector.js';
import { NormalizationController } from './normalization-controller.js';

export class AudioEngine {
  constructor(tabId, audioSource, options = {}) {
    this.tabId = tabId;
    this.source = audioSource;
    this.options = options;

    this.state = AudioEngineState.IDLE;
    this.audioCtx = null;
    this.sourceNode = null;
    this.gainProcessor = null;
    this.safetyHook = null;

    // Dual continuous loudness meters
    this.inputMeter = null;
    this.outputMeter = null;

    // Compatibility references
    this.loudnessMeter = null;
    this.engineeringMeter = null;
    this.kWeighting = null;

    this.activityDetector = new ActivityDetector(options.activityOptions);
    this.controller = new NormalizationController(options.controllerOptions);

    this.wasActive = false;
    this.engineTimer = null;
    this.startedAt = null;
    this.lastError = null;
    this.listeners = new Map();

    // Listen to source ended event (e.g. tab navigation, close)
    this.source.on('ended', () => {
      this.handleSourceEnded();
    });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const list = this.listeners.get(event) || [];
    list.forEach((fn) => {
      try { fn(data); } catch (e) { console.error('AudioEngine event listener error', e); }
    });
  }

  transitionTo(nextState) {
    validateStateTransition(this.state, nextState);
    const prevState = this.state;
    this.state = nextState;
    this.emit('stateChange', { tabId: this.tabId, from: prevState, to: nextState });
  }

  async start() {
    if (this.state === AudioEngineState.RUNNING || this.state === AudioEngineState.STARTING) {
      return;
    }

    this.transitionTo(AudioEngineState.STARTING);
    this.lastError = null;

    try {
      // 1. Acquire audio stream from source
      const stream = await this.source.acquire();

      // 2. Initialize AudioContext
      const AudioCtxConstructor = (typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : globalThis.AudioContext);
      this.audioCtx = new AudioCtxConstructor();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 3. Load AudioWorklet module for continuous loudness measurement
      await LoudnessMeter.initWorklet(this.audioCtx, this.options.workletUrl);

      // 4. Create Web Audio processing and observation nodes
      this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.gainProcessor = new GainProcessor(this.audioCtx, this.options.gainOptions);
      this.safetyHook = new SafetyHook(this.audioCtx, this.options.safetyOptions);

      // Observation Branch 1: Continuous Input Loudness Meter
      this.inputMeter = new LoudnessMeter(this.audioCtx, { isOutput: false, channelCount: 2 });
      this.loudnessMeter = this.inputMeter; // Compatibility alias

      // Observation Branch 2: Continuous Processed-Output Verification Meter
      this.outputMeter = new LoudnessMeter(this.audioCtx, { isOutput: true, channelCount: 2 });

      // 5. Assemble Web Audio Graph:
      // Audible path: source -> GainProcessor -> SafetyHook -> destination
      this.sourceNode.connect(this.gainProcessor.getNode());
      this.gainProcessor.getNode().connect(this.safetyHook.getInputNode());
      this.safetyHook.getOutputNode().connect(this.audioCtx.destination);

      // Observation branch 1: source -> inputMeter
      this.sourceNode.connect(this.inputMeter.getNode());

      // Observation branch 2: post-safety output -> outputMeter
      this.safetyHook.getOutputNode().connect(this.outputMeter.getNode());

      // 6. Start periodic control and metrics cycle (default 100ms)
      this.engineTimer = setInterval(() => {
        if (this.state === AudioEngineState.RUNNING) {
          this.processControlCycle();
        }
      }, this.options.cycleIntervalMs ?? 100);

      this.startedAt = Date.now();
      this.transitionTo(AudioEngineState.RUNNING);
    } catch (err) {
      this.lastError = err.message;
      this.transitionTo(AudioEngineState.ERROR);
      await this.cleanupResources();
      throw err;
    }
  }

  processControlCycle() {
    // 1. Read input continuous loudness metrics
    const inputMetrics = this.inputMeter ? this.inputMeter.getMetrics() : {
      momentaryLufs: -100,
      shortTermLufs: -100,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100,
      measurementSequence: 0
    };

    // 2. Process activity / silence gate
    const activity = this.activityDetector.process(inputMetrics.momentaryLufs);

    // 3. Handle silence -> active resume transition: reset epoch to avoid silence poisoning
    if (!this.wasActive && activity.isActive) {
      if (this.inputMeter) this.inputMeter.resetEpoch();
      if (this.outputMeter) this.outputMeter.resetEpoch();
    }
    this.wasActive = activity.isActive;

    // 4. Update normalization controller
    const ctrlState = this.controller.update(inputMetrics, activity.isActive);

    // 5. Apply effective gain to GainProcessor (smooth transition over 40ms)
    if (this.gainProcessor) {
      this.gainProcessor.setGainDb(ctrlState.appliedGainDb, 0.04);
    }

    // 6. Read processed-output verification metrics
    const outputMetrics = this.outputMeter ? this.outputMeter.getMetrics() : {
      momentaryLufs: -100,
      shortTermLufs: -100,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100
    };

    const outputTargetErrorLu = outputMetrics.shortTermValid ?
      Number((outputMetrics.shortTermLufs - ctrlState.effectiveTargetLufs).toFixed(1)) : null;

    // 7. Broadcast comprehensive authoritative metrics
    const metricsPayload = {
      tabId: this.tabId,

      // Input continuous measurement
      inputMomentaryLufs: inputMetrics.momentaryLufs,
      inputShortTermLufs: inputMetrics.shortTermLufs,
      inputMomentaryValid: inputMetrics.momentaryValid,
      inputShortTermValid: inputMetrics.shortTermValid,
      inputSamplePeakDbFS: inputMetrics.samplePeakDbFS,

      // Output verification measurement
      outputMomentaryLufs: outputMetrics.momentaryLufs,
      outputShortTermLufs: outputMetrics.shortTermLufs,
      outputMomentaryValid: outputMetrics.momentaryValid,
      outputShortTermValid: outputMetrics.shortTermValid,
      outputSamplePeakDbFS: outputMetrics.samplePeakDbFS,

      // Target and controller state
      globalTargetLufs: ctrlState.globalTargetLufs,
      relativeOffsetDb: ctrlState.relativeOffsetDb,
      effectiveTargetLufs: ctrlState.effectiveTargetLufs,

      desiredAutoGainDb: ctrlState.desiredAutoGainDb,
      appliedAutoGainDb: ctrlState.appliedAutoGainDb,
      requestedTotalGainDb: ctrlState.requestedTotalGainDb,
      appliedGainDb: ctrlState.appliedGainDb,
      gainErrorDb: ctrlState.gainErrorDb,

      outputTargetErrorLu,
      isActive: activity.isActive,
      isFrozen: ctrlState.isFrozen,
      isLimited: ctrlState.isLimited,
      limitReason: ctrlState.limitReason,
      measurementSequence: inputMetrics.measurementSequence,
      audioContextState: this.audioCtx?.state || 'closed',

      // Compatibility fields for legacy consumers
      momentaryLufs: inputMetrics.momentaryLufs,
      shortTermLufs: inputMetrics.shortTermLufs,
      peakDbFS: inputMetrics.samplePeakDbFS,
      rmsDbFS: inputMetrics.shortTermLufs, // approximation alias for legacy rmsDbFS display
      autoGainDb: ctrlState.appliedAutoGainDb,
      manualOffsetDb: ctrlState.relativeOffsetDb,
      effectiveGainDb: ctrlState.appliedGainDb,
      targetLufs: ctrlState.globalTargetLufs
    };

    this.emit('metrics', metricsPayload);
    return metricsPayload;
  }

  async stop() {
    if (this.state === AudioEngineState.IDLE || this.state === AudioEngineState.STOPPING) {
      return;
    }

    this.transitionTo(AudioEngineState.STOPPING);
    try {
      await this.cleanupResources();
      this.transitionTo(AudioEngineState.IDLE);
    } catch (err) {
      this.lastError = err.message;
      this.transitionTo(AudioEngineState.ERROR);
    }
  }

  async handleSourceEnded() {
    if (this.state === AudioEngineState.RUNNING || this.state === AudioEngineState.STARTING) {
      await this.stop();
    }
  }

  async cleanupResources() {
    if (this.engineTimer) {
      clearInterval(this.engineTimer);
      this.engineTimer = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }

    if (this.inputMeter) {
      this.inputMeter.disconnect();
      this.inputMeter = null;
    }
    this.loudnessMeter = null;

    if (this.outputMeter) {
      this.outputMeter.disconnect();
      this.outputMeter = null;
    }

    if (this.gainProcessor) {
      this.gainProcessor.disconnect();
      this.gainProcessor = null;
    }

    if (this.safetyHook) {
      this.safetyHook.disconnect();
      this.safetyHook = null;
    }

    this.engineeringMeter = null;
    this.kWeighting = null;

    if (this.source) {
      this.source.release();
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        await this.audioCtx.close();
      } catch (_) {}
      this.audioCtx = null;
    }

    this.activityDetector.reset();
    this.controller.reset();
    this.wasActive = false;
    this.listeners.clear();
  }

  setManualOffsetDb(gainDb) {
    this.controller.setManualOffsetDb(gainDb);
    if (this.state === AudioEngineState.RUNNING && this.gainProcessor) {
      const state = this.controller.getState();
      this.gainProcessor.setGainDb(state.appliedGainDb, 0.04);
    }
  }

  setRelativeOffsetDb(gainDb) {
    this.setManualOffsetDb(gainDb);
  }

  setTargetLufs(targetLufs) {
    this.controller.setTargetLufs(targetLufs);
  }

  setGlobalTargetLufs(targetLufs) {
    this.controller.setTargetLufs(targetLufs);
  }

  setNormalizationEnabled(enabled) {
    this.controller.setEnabled(enabled);
    if (this.state === AudioEngineState.RUNNING && this.gainProcessor) {
      const state = this.controller.getState();
      this.gainProcessor.setGainDb(state.appliedGainDb, 0.04);
    }
  }

  getGainDb() {
    return this.gainProcessor ? this.gainProcessor.getGainDb() : 0;
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    const inputMetrics = this.inputMeter ? this.inputMeter.getMetrics() : {
      momentaryLufs: -100,
      shortTermLufs: -100,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100,
      measurementSequence: 0
    };
    const outputMetrics = this.outputMeter ? this.outputMeter.getMetrics() : {
      momentaryLufs: -100,
      shortTermLufs: -100,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100
    };
    const ctrlState = this.controller.getState();
    const outputTargetErrorLu = outputMetrics.shortTermValid ?
      Number((outputMetrics.shortTermLufs - ctrlState.effectiveTargetLufs).toFixed(1)) : null;

    return {
      tabId: this.tabId,
      inputMomentaryLufs: inputMetrics.momentaryLufs,
      inputShortTermLufs: inputMetrics.shortTermLufs,
      inputMomentaryValid: inputMetrics.momentaryValid,
      inputShortTermValid: inputMetrics.shortTermValid,
      inputSamplePeakDbFS: inputMetrics.samplePeakDbFS,

      outputMomentaryLufs: outputMetrics.momentaryLufs,
      outputShortTermLufs: outputMetrics.shortTermLufs,
      outputMomentaryValid: outputMetrics.momentaryValid,
      outputShortTermValid: outputMetrics.shortTermValid,
      outputSamplePeakDbFS: outputMetrics.samplePeakDbFS,

      globalTargetLufs: ctrlState.globalTargetLufs,
      relativeOffsetDb: ctrlState.relativeOffsetDb,
      effectiveTargetLufs: ctrlState.effectiveTargetLufs,

      desiredAutoGainDb: ctrlState.desiredAutoGainDb,
      appliedAutoGainDb: ctrlState.appliedAutoGainDb,
      requestedTotalGainDb: ctrlState.requestedTotalGainDb,
      appliedGainDb: ctrlState.appliedGainDb,
      gainErrorDb: ctrlState.gainErrorDb,

      outputTargetErrorLu,
      isActive: this.activityDetector.isActive,
      isFrozen: ctrlState.isFrozen,
      isLimited: ctrlState.isLimited,
      limitReason: ctrlState.limitReason,
      measurementSequence: inputMetrics.measurementSequence,
      audioContextState: this.audioCtx?.state || 'closed',

      // Compatibility aliases
      momentaryLufs: inputMetrics.momentaryLufs,
      shortTermLufs: inputMetrics.shortTermLufs,
      peakDbFS: inputMetrics.samplePeakDbFS,
      rmsDbFS: inputMetrics.shortTermLufs,
      autoGainDb: ctrlState.appliedAutoGainDb,
      manualOffsetDb: ctrlState.relativeOffsetDb,
      effectiveGainDb: ctrlState.appliedGainDb,
      targetLufs: ctrlState.globalTargetLufs
    };
  }

  getTabId() {
    return this.tabId;
  }
}
