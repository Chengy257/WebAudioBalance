/**
 * WebAudioBalance - AudioEngineManager
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
   * Start engine for tabId using streamId
   * Enforces single-engine-per-tab invariant
   */
  async startEngine(tabId, streamId) {
    if (this.engines.has(tabId)) {
      logger.warn('Stopping existing engine before starting new instance', { tabId });
      await this.stopEngine(tabId);
    }

    logger.info('Creating new AudioEngine for tab', { tabId });
    const source = new TabCaptureAudioSource(streamId);
    const engine = new AudioEngine(tabId, source);

    // Forward metrics to Popup
    engine.on('metrics', (metrics) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(createMessage(MessageTypes.METRICS_UPDATE, MessageTargets.POPUP, metrics)).catch(() => {});
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

  setEngineGain(tabId, gainDb, rampSec) {
    const engine = this.engines.get(tabId);
    if (!engine) {
      logger.warn('Cannot set gain: no engine found for tab', { tabId });
      return false;
    }
    const result = engine.setGainDb(gainDb, rampSec);
    this.broadcastState();
    return Boolean(result);
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
        testGainDb: engine.getGainDb(),
        rmsDbFS: metrics.rmsDbFS,
        peakDbFS: metrics.peakDbFS,
        audioContextState: metrics.audioContextState,
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
