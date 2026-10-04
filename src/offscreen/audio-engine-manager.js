/**
 * WebAudioBalance - AudioEngineManager (Audio Plane)
 * Coordinates per-tab AudioEngine instances in the Offscreen Audio Runtime
 */

import { AudioEngine } from '../engine/audio-engine.js';
import { TabCaptureAudioSource } from '../engine/audio-source.js';
import { AudioEngineState } from '../engine/types.js';
import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('AudioEngineManager');

export class AudioEngineManager {
  constructor() {
    this.engines = new Map(); // tabId -> AudioEngine
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
    }

    // Forward metrics to Popup and SW
    engine.on('metrics', (metrics) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(createMessage(MessageTypes.METRICS_UPDATE, MessageTargets.BROADCAST, metrics)).catch(() => {});
      }
    });

    // Forward state changes
    engine.on('stateChange', (ev) => {
      logger.info('Engine state transition', ev);
      this.broadcastState();
      if (ev.to === AudioEngineState.IDLE || ev.to === AudioEngineState.ERROR) {
        if (this.engines.get(tabId) === engine) {
          this.engines.delete(tabId);
        }
      }
    });

    this.engines.set(tabId, engine);

    try {
      await engine.start();
      this.broadcastState();
      return { success: true, tabId };
    } catch (err) {
      logger.error('Failed to start AudioEngine', { tabId, error: err.message });
      this.engines.delete(tabId);
      this.broadcastState();
      throw err;
    }
  }

  async stopEngine(tabId) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.info('No active engine found to stop for tab', { tabId });
      return false;
    }

    logger.info('Stopping AudioEngine for tab', { tabId });
    await engine.stop();
    this.engines.delete(tabId);
    this.broadcastState();
    return true;
  }

  setEngineGain(tabId, gainDb) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.warn('Cannot set gain: no engine found for tab', { tabId });
      return false;
    }
    if (typeof engine.setManualOffsetDb === 'function') {
      engine.setManualOffsetDb(gainDb);
    } else if (typeof engine.setGainDb === 'function') {
      engine.setGainDb(gainDb);
    }
    this.broadcastState();
    return true;
  }

  setEngineNormalization(tabId, enabled) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.warn('Cannot set normalization: no engine found for tab', { tabId });
      return false;
    }
    engine.setNormalizationEnabled(enabled);
    this.broadcastState();
    return true;
  }

  setEngineTarget(tabId, targetLufs) {
    const engine = this.engines.get(tabId);
    if (!engine) return false;
    engine.setTargetLufs(targetLufs);
    this.broadcastState();
    return true;
  }

  setGlobalTarget(targetLufs) {
    for (const engine of this.engines.values()) {
      engine.setTargetLufs(targetLufs);
    }
    this.broadcastState();
  }

  setGlobalNormalization(globalAutoEnabled) {
    for (const engine of this.engines.values()) {
      engine.setNormalizationEnabled(globalAutoEnabled);
    }
    this.broadcastState();
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

  broadcastState() {
    const list = this.getAllStates();
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(createMessage(MessageTypes.RUNTIME_STATE, MessageTargets.POPUP, {
        activeStreams: list
      })).catch(() => {});
    }
  }
}
