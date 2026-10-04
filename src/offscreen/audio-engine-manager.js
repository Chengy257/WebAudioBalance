/**
 * WebAudioBalance - AudioEngineManager (Audio Plane)
 * Coordinates per-tab AudioEngine instances in the Offscreen Audio Runtime
 * Compliant with R2 Runtime & State Reliability Implementation Specification
 */

import { AudioEngine } from '../engine/audio-engine.js';
import { TabCaptureAudioSource } from '../engine/audio-source.js';
import { AudioEngineState } from '../engine/types.js';
import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { ErrorCodes } from '../shared/failure-taxonomy.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('AudioEngineManager');

export class AudioEngineManager {
  constructor() {
    this.engines = new Map(); // tabId -> AudioEngine
    this.runtimeInstanceId = `rt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.lastTelemetrySendTimes = new Map(); // tabId -> timestamp
  }

  /**
   * Start engine for tabId using streamId and initial configuration
   * Enforces single-engine-per-tab invariant
   */
  async startEngine(tabId, streamId, options = {}) {
    if (this.engines.has(tabId)) {
      logger.warn('Stopping existing engine before starting new instance', { tabId });
      await this.stopEngine(tabId);
    }

    logger.info('Creating new AudioEngine for tab', { tabId, options });
    const source = new TabCaptureAudioSource(streamId);
    const engine = new AudioEngine(tabId, source, {
      controllerOptions: {
        targetLufs: options.targetLufs ?? -18.0,
        enabled: options.normalizationEnabled ?? true
      }
    });

    if (typeof options.manualOffsetDb === 'number') {
      engine.setManualOffsetDb(options.manualOffsetDb);
    } else if (typeof options.relativeOffsetDb === 'number') {
      engine.setManualOffsetDb(options.relativeOffsetDb);
    }

    // Forward metrics to Popup and SW, throttled to <= 2 Hz per engine (Section 15)
    engine.on('metrics', (metrics) => {
      const now = Date.now();
      const lastTime = this.lastTelemetrySendTimes.get(tabId) || 0;
      if (now - lastTime >= 500) {
        this.lastTelemetrySendTimes.set(tabId, now);
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(createMessage(MessageTypes.AUDIO_TELEMETRY, MessageTargets.BROADCAST, metrics)).catch(() => {});
        }
      }
    });

    // Forward state changes & lifecycle events
    engine.on('stateChange', (ev) => {
      logger.info('Engine state transition', ev);
      this.broadcastLifecycle(tabId, ev);
      this.broadcastState();
      if (ev.to === AudioEngineState.IDLE || ev.to === AudioEngineState.ERROR) {
        if (this.engines.get(tabId) === engine) {
          this.engines.delete(tabId);
          this.lastTelemetrySendTimes.delete(tabId);
        }
      }
    });

    this.engines.set(tabId, engine);

    try {
      await engine.start();
      this.broadcastState();
      return {
        success: true,
        tabId,
        runtimeInstanceId: this.runtimeInstanceId
      };
    } catch (err) {
      logger.error('Failed to start AudioEngine', { tabId, error: err.message });
      this.engines.delete(tabId);
      this.lastTelemetrySendTimes.delete(tabId);
      this.broadcastState();
      return {
        success: false,
        tabId,
        error: {
          code: ErrorCodes.AUDIO_ENGINE_START_FAILED,
          message: err.message,
          retryable: true
        }
      };
    }
  }

  async stopEngine(tabId) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.info('No active engine found to stop for tab', { tabId });
      return { success: true, tabId, alreadyStopped: true };
    }

    logger.info('Stopping AudioEngine for tab', { tabId });
    try {
      await engine.stop();
      this.engines.delete(tabId);
      this.lastTelemetrySendTimes.delete(tabId);
      this.broadcastState();
      return { success: true, tabId, alreadyStopped: false };
    } catch (err) {
      logger.error('Error stopping engine', { tabId, error: err.message });
      this.engines.delete(tabId);
      this.lastTelemetrySendTimes.delete(tabId);
      this.broadcastState();
      return {
        success: false,
        tabId,
        error: {
          code: ErrorCodes.AUDIO_COMMAND_REJECTED,
          message: err.message,
          retryable: true
        }
      };
    }
  }

  setEngineGain(tabId, gainDb) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.warn('Cannot set gain: no engine found for tab', { tabId });
      return {
        success: false,
        tabId,
        error: {
          code: ErrorCodes.AUDIO_ENGINE_NOT_FOUND,
          message: `No active audio engine for tab ${tabId}`,
          retryable: false
        }
      };
    }
    if (typeof engine.setManualOffsetDb === 'function') {
      engine.setManualOffsetDb(gainDb);
    } else if (typeof engine.setGainDb === 'function') {
      engine.setGainDb(gainDb);
    }
    this.broadcastState();
    return { success: true, tabId, relativeOffsetDb: gainDb };
  }

  setEngineNormalization(tabId, enabled) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.warn('Cannot set normalization: no engine found for tab', { tabId });
      return {
        success: false,
        tabId,
        error: {
          code: ErrorCodes.AUDIO_ENGINE_NOT_FOUND,
          message: `No active audio engine for tab ${tabId}`,
          retryable: false
        }
      };
    }
    engine.setNormalizationEnabled(enabled);
    this.broadcastState();
    return { success: true, tabId, normalizationEnabled: enabled };
  }

  setEngineTarget(tabId, targetLufs) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      return {
        success: false,
        tabId,
        error: {
          code: ErrorCodes.AUDIO_ENGINE_NOT_FOUND,
          message: `No active audio engine for tab ${tabId}`,
          retryable: false
        }
      };
    }
    engine.setTargetLufs(targetLufs);
    this.broadcastState();
    return { success: true, tabId, targetLufs };
  }

  setGlobalTarget(targetLufs) {
    const appliedTo = [];
    const failedTabs = [];
    for (const [tabId, engine] of this.engines.entries()) {
      try {
        engine.setTargetLufs(targetLufs);
        appliedTo.push(tabId);
      } catch (err) {
        failedTabs.push({ tabId, error: { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: err.message } });
      }
    }
    this.broadcastState();
    return {
      success: failedTabs.length === 0,
      appliedTo,
      failedTabs
    };
  }

  setGlobalNormalization(globalAutoEnabled) {
    const appliedTo = [];
    const failedTabs = [];
    for (const [tabId, engine] of this.engines.entries()) {
      try {
        engine.setNormalizationEnabled(globalAutoEnabled);
        appliedTo.push(tabId);
      } catch (err) {
        failedTabs.push({ tabId, error: { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: err.message } });
      }
    }
    this.broadcastState();
    return {
      success: failedTabs.length === 0,
      appliedTo,
      failedTabs
    };
  }

  /**
   * Authoritative Audio Runtime Snapshot (Section 4)
   */
  getRuntimeSnapshot() {
    const engines = [];
    for (const [tabId, engine] of this.engines.entries()) {
      const metrics = engine.getMetrics();
      const ctrlState = engine.normalizationController ? engine.normalizationController.getState() : {};
      engines.push({
        tabId,
        engineState: engine.getState(),
        audioContextState: metrics.audioContextState || 'closed',
        startedAt: engine.startedAt || 0,

        active: Boolean(metrics.isActive),
        frozen: Boolean(metrics.isFrozen),
        limited: Boolean(metrics.isLimited),
        limitReason: metrics.limitReason || 'none',

        globalTargetLufs: metrics.globalTargetLufs ?? ctrlState.globalTargetLufs ?? -18.0,
        relativeOffsetDb: metrics.relativeOffsetDb ?? ctrlState.relativeOffsetDb ?? 0.0,
        effectiveTargetLufs: metrics.effectiveTargetLufs ?? ctrlState.effectiveTargetLufs ?? -18.0,
        appliedGainDb: metrics.appliedGainDb ?? 0.0,
        desiredAutoGainDb: metrics.desiredAutoGainDb ?? 0.0,
        appliedAutoGainDb: metrics.appliedAutoGainDb ?? 0.0,

        inputMomentaryLufs: metrics.inputMomentaryLufs ?? -100,
        inputShortTermLufs: metrics.inputShortTermLufs ?? -100,
        inputMomentaryValid: Boolean(metrics.inputMomentaryValid),
        inputShortTermValid: Boolean(metrics.inputShortTermValid),
        inputSamplePeakDbFS: metrics.inputSamplePeakDbFS ?? -100,

        outputMomentaryLufs: metrics.outputMomentaryLufs ?? -100,
        outputShortTermLufs: metrics.outputShortTermLufs ?? -100,
        outputMomentaryValid: Boolean(metrics.outputMomentaryValid),
        outputShortTermValid: Boolean(metrics.outputShortTermValid),
        outputSamplePeakDbFS: metrics.outputSamplePeakDbFS ?? -100,
        outputTargetErrorLu: metrics.outputTargetErrorLu ?? null,

        metricsSequence: metrics.measurementSequence ?? 0,
        lastRuntimeError: engine.lastError || null
      });
    }

    return {
      runtimeInstanceId: this.runtimeInstanceId,
      generatedAt: Date.now(),
      engines
    };
  }

  getAllStates() {
    const env = getBrowserInfo();
    const list = [];
    for (const [tabId, engine] of this.engines.entries()) {
      const metrics = engine.getMetrics();
      list.push({
        tabId,
        browser: env.browser,
        browserVersion: env.version,
        captureStatus: engine.getState(),
        audioContextState: metrics.audioContextState,
        testGainDb: engine.getGainDb(),
        autoGainDb: metrics.autoGainDb,
        manualOffsetDb: metrics.manualOffsetDb,
        effectiveGainDb: metrics.effectiveGainDb,
        targetLufs: metrics.targetLufs,
        momentaryLufs: metrics.momentaryLufs,
        shortTermLufs: metrics.shortTermLufs,
        peakDbFS: metrics.peakDbFS,
        rmsDbFS: metrics.rmsDbFS,
        isFrozen: metrics.isFrozen,
        isActive: metrics.isActive,
        startedAt: engine.startedAt
      });
    }
    return list;
  }

  broadcastLifecycle(tabId, transition) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(createMessage(
        MessageTypes.AUDIO_RUNTIME_LIFECYCLE,
        MessageTargets.BROADCAST,
        {
          tabId,
          runtimeInstanceId: this.runtimeInstanceId,
          transition,
          timestamp: Date.now()
        }
      )).catch(() => {});
    }
  }

  broadcastState() {
    // Keep legacy broadcast for tests/adapters that rely on it
    const list = this.getAllStates();
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(createMessage(MessageTypes.RUNTIME_STATE, MessageTargets.POPUP, {
        activeStreams: list
      })).catch(() => {});
    }
  }
}
