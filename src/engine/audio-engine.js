/**
 * WebAudioBalance - AudioEngine
 * Concrete per-tab audio engine managing source, gain, BS.1770 metering, safety, normalization, and lifecycle
 */

import { AudioEngineState, validateStateTransition } from './types.js';
import { GainProcessor } from './gain-processor.js';
import { EngineeringMeter } from './meter.js';
import { SafetyHook } from './safety.js';
import { KWeightingFilter } from './k-weighting.js';
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
    this.engineeringMeter = null;
    this.safetyHook = null;

    // P2 Perceptual Loudness & Normalization Components
    this.kWeighting = null;
    this.loudnessMeter = null;
    this.activityDetector = new ActivityDetector(options.activityOptions);
    this.controller = new NormalizationController(options.controllerOptions);

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
      const AudioCtxConstructor = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxConstructor();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 3. Create Web Audio nodes
      this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.gainProcessor = new GainProcessor(this.audioCtx, this.options.gainOptions);
      this.safetyHook = new SafetyHook(this.audioCtx, this.options.safetyOptions);

      // Observation 1: Engineering Meter
      this.engineeringMeter = new EngineeringMeter(this.audioCtx, 2048);

      // Observation 2: K-Weighting Filter + BS.1770 Loudness Meter
      this.kWeighting = new KWeightingFilter(this.audioCtx);
      this.loudnessMeter = new LoudnessMeter(this.audioCtx);

      // 4. Assemble Graph:
      // Audio path branch: source -> gain -> safety -> destination
      this.sourceNode.connect(this.gainProcessor.getNode());
      this.gainProcessor.getNode().connect(this.safetyHook.getInputNode());
      this.safetyHook.getOutputNode().connect(this.audioCtx.destination);

      // Observation branch 1: source -> engineering meter
      this.sourceNode.connect(this.engineeringMeter.getNode());

      // Observation branch 2: source -> K-weighting filters -> loudness meter
      this.sourceNode.connect(this.kWeighting.getInputNode());
      this.kWeighting.getOutputNode().connect(this.loudnessMeter.getNode());

      // 5. Start periodic control and metering loop (100ms)
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
    // 1. Measure engineering levels
    const engMetrics = this.engineeringMeter.measure();

    // 2. Measure perceptual loudness
    const lufsMetrics = this.loudnessMeter.measure();

    // 3. Process activity / silence gate
    const activity = this.activityDetector.process(lufsMetrics.momentaryLufs);

    // 4. Update normalization controller
    // Use short-term if warm (> -70), otherwise momentary for faster initial acquisition
    const controlInput = lufsMetrics.shortTermLufs > -70 ? lufsMetrics.shortTermLufs : lufsMetrics.momentaryLufs;
    const ctrlState = this.controller.update(controlInput, activity.isActive);

    // 5. Apply effective gain to GainProcessor (smooth transition over 50ms)
    this.gainProcessor.setGainDb(ctrlState.effectiveGainDb, 0.05);

    // 6. Broadcast comprehensive metrics
    this.emit('metrics', {
      tabId: this.tabId,
      rmsDbFS: engMetrics.rmsDbFS,
      peakDbFS: lufsMetrics.peakDbFS,
      momentaryLufs: lufsMetrics.momentaryLufs,
      shortTermLufs: lufsMetrics.shortTermLufs,
      autoGainDb: ctrlState.autoGainDb,
      manualOffsetDb: ctrlState.manualOffsetDb,
      effectiveGainDb: ctrlState.effectiveGainDb,
      targetLufs: ctrlState.targetLufs,
      isActive: activity.isActive,
      isFrozen: ctrlState.isFrozen,
      audioContextState: this.audioCtx.state
    });
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

    if (this.engineeringMeter) {
      this.engineeringMeter.disconnect();
      this.engineeringMeter = null;
    }

    if (this.kWeighting) {
      this.kWeighting.disconnect();
      this.kWeighting = null;
    }

    if (this.loudnessMeter) {
      this.loudnessMeter.disconnect();
      this.loudnessMeter = null;
    }

    if (this.gainProcessor) {
      this.gainProcessor.disconnect();
      this.gainProcessor = null;
    }

    if (this.safetyHook) {
      this.safetyHook.disconnect();
      this.safetyHook = null;
    }

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
  }

  setManualOffsetDb(gainDb) {
    this.controller.setManualOffsetDb(gainDb);
    if (this.state === AudioEngineState.RUNNING && this.gainProcessor) {
      const state = this.controller.getState();
      this.gainProcessor.setGainDb(state.effectiveGainDb, 0.04);
    }
  }

  setTargetLufs(targetLufs) {
    this.controller.setTargetLufs(targetLufs);
  }

  setNormalizationEnabled(enabled) {
    this.controller.setEnabled(enabled);
    if (this.state === AudioEngineState.RUNNING && this.gainProcessor) {
      const state = this.controller.getState();
      this.gainProcessor.setGainDb(state.effectiveGainDb, 0.04);
    }
  }

  getGainDb() {
    return this.gainProcessor ? this.gainProcessor.getGainDb() : 0;
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    const lufsMetrics = this.loudnessMeter ? this.loudnessMeter.getMetrics() : { momentaryLufs: -100, shortTermLufs: -100, peakDbFS: -100 };
    const engMetrics = this.engineeringMeter ? this.engineeringMeter.getMetrics() : { rmsDbFS: -100 };
    const ctrlState = this.controller.getState();

    return {
      rmsDbFS: engMetrics.rmsDbFS,
      peakDbFS: lufsMetrics.peakDbFS,
      momentaryLufs: lufsMetrics.momentaryLufs,
      shortTermLufs: lufsMetrics.shortTermLufs,
      autoGainDb: ctrlState.autoGainDb,
      manualOffsetDb: ctrlState.manualOffsetDb,
      effectiveGainDb: ctrlState.effectiveGainDb,
      targetLufs: ctrlState.targetLufs,
      isActive: this.activityDetector.isActive,
      isFrozen: ctrlState.isFrozen,
      audioContextState: this.audioCtx?.state || 'closed'
    };
  }

  getTabId() {
    return this.tabId;
  }
}
