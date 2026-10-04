/**
 * WebAudioBalance - AudioEngine
 * Concrete per-tab audio engine managing source, gain, metering, safety, and lifecycle
 */

import { AudioEngineState, validateStateTransition } from './types.js';
import { GainProcessor } from './gain-processor.js';
import { EngineeringMeter } from './meter.js';
import { SafetyHook } from './safety.js';

export class AudioEngine {
  constructor(tabId, audioSource, options = {}) {
    this.tabId = tabId;
    this.source = audioSource;
    this.options = options;

    this.state = AudioEngineState.IDLE;
    this.audioCtx = null;
    this.sourceNode = null;
    this.gainProcessor = null;
    this.meter = null;
    this.safetyHook = null;
    this.meterTimer = null;

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
      this.meter = new EngineeringMeter(this.audioCtx, 2048);
      this.gainProcessor = new GainProcessor(this.audioCtx, this.options.gainOptions);
      this.safetyHook = new SafetyHook(this.audioCtx, this.options.safetyOptions);

      // 4. Assemble Graph:
      // Observation branch: source -> meter
      this.sourceNode.connect(this.meter.getNode());

      // Audio path branch: source -> gain -> safety -> destination
      this.sourceNode.connect(this.gainProcessor.getNode());
      this.gainProcessor.getNode().connect(this.safetyHook.getInputNode());
      this.safetyHook.getOutputNode().connect(this.audioCtx.destination);

      // 5. Start periodic metering loop (250ms)
      this.meterTimer = setInterval(() => {
        if (this.state === AudioEngineState.RUNNING) {
          const metrics = this.meter.measure();
          this.emit('metrics', {
            tabId: this.tabId,
            ...metrics,
            currentGainDb: this.gainProcessor.getGainDb(),
            audioContextState: this.audioCtx.state
          });
        }
      }, this.options.meterIntervalMs ?? 250);

      this.startedAt = Date.now();
      this.transitionTo(AudioEngineState.RUNNING);
    } catch (err) {
      this.lastError = err.message;
      this.transitionTo(AudioEngineState.ERROR);
      await this.cleanupResources();
      throw err;
    }
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
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }

    if (this.meter) {
      this.meter.disconnect();
      this.meter = null;
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
  }

  setGainDb(gainDb, rampDurationSec) {
    if (this.state !== AudioEngineState.RUNNING || !this.gainProcessor) {
      return false;
    }
    return this.gainProcessor.setGainDb(gainDb, rampDurationSec);
  }

  getGainDb() {
    return this.gainProcessor ? this.gainProcessor.getGainDb() : 0;
  }

  getState() {
    return this.state;
  }

  getMetrics() {
    if (!this.meter) {
      return { rmsDbFS: -100, peakDbFS: -100, timestamp: Date.now() };
    }
    return {
      ...this.meter.getMetrics(),
      currentGainDb: this.getGainDb(),
      audioContextState: this.audioCtx?.state || 'closed'
    };
  }

  getTabId() {
    return this.tabId;
  }
}
