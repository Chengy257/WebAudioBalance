/**
 * WebAudioBalance - LoudnessMeter (ITU-R BS.1770-5 aligned)
 * Continuous PCM loudness meter wrapper around LoudnessMeterProcessor AudioWorklet.
 * Exposes contiguous 400ms Momentary, 3s Short-Term LUFS, sample peak, and validity flags.
 */

const registeredContexts = new WeakSet();

export class LoudnessMeter {
  /**
   * Idempotently register the AudioWorklet processor module on an AudioContext
   * @param {AudioContext} audioCtx
   * @param {string} [workletUrl]
   */
  static async initWorklet(audioCtx, workletUrl = null) {
    if (!audioCtx || !audioCtx.audioWorklet) {
      return;
    }
    if (registeredContexts.has(audioCtx)) {
      return;
    }

    let url = workletUrl;
    if (!url) {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        url = chrome.runtime.getURL('src/engine/worklets/loudness-meter-processor.js');
      } else {
        url = '/src/engine/worklets/loudness-meter-processor.js';
      }
    }

    await audioCtx.audioWorklet.addModule(url);
    registeredContexts.add(audioCtx);
  }

  constructor(audioContext, options = {}) {
    this.audioCtx = audioContext;
    this.channelCount = options.channelCount ?? 2;
    this.sampleRate = this.audioCtx?.sampleRate ?? 48000;
    this.isOutput = Boolean(options.isOutput);

    this.latestMetrics = {
      momentaryLufs: -100.0,
      shortTermLufs: -100.0,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100.0,
      peakDbFS: -100.0,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      measurementTimestamp: Date.now(),
      measurementSequence: 0
    };

    if (this.audioCtx?.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'loudness-meter-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [this.channelCount],
        processorOptions: {
          sampleRate: this.sampleRate,
          channelCount: this.channelCount
        }
      });
      this.workletNode.channelCount = this.channelCount;
      this.workletNode.channelCountMode = 'explicit';

      this.workletNode.port.onmessage = (event) => {
        if (event.data?.type === 'measurement' && event.data.metrics) {
          const m = event.data.metrics;
          this.latestMetrics = {
            ...m,
            peakDbFS: m.samplePeakDbFS // compatibility alias
          };
        }
      };
    } else {
      // Mock / fallback node for non-browser unit test environments
      this.workletNode = {
        connect() {},
        disconnect() {},
        port: {
          postMessage() {}
        }
      };
    }
  }

  getNode() {
    return this.workletNode;
  }

  getMetrics() {
    return { ...this.latestMetrics };
  }

  /**
   * Return latest continuous metrics snapshot (compatibility wrapper for periodic polling)
   */
  measure() {
    return this.getMetrics();
  }

  /**
   * Reset epoch upon activity resume (invalidates short-term window to avoid silence contamination)
   */
  resetEpoch() {
    if (this.workletNode?.port?.postMessage) {
      this.workletNode.port.postMessage({ type: 'resetEpoch' });
    }
    this.latestMetrics.momentaryValid = false;
    this.latestMetrics.shortTermValid = false;
  }

  /**
   * Reset all filter states and sliding window history
   */
  reset() {
    if (this.workletNode?.port?.postMessage) {
      this.workletNode.port.postMessage({ type: 'reset' });
    }
    this.latestMetrics = {
      momentaryLufs: -100.0,
      shortTermLufs: -100.0,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100.0,
      peakDbFS: -100.0,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      measurementTimestamp: Date.now(),
      measurementSequence: 0
    };
  }

  disconnect() {
    try {
      if (this.workletNode?.disconnect) {
        this.workletNode.disconnect();
      }
    } catch (_) {}
  }
}
