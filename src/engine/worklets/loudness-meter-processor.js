/**
 * WebAudioBalance - LoudnessMeterProcessor (AudioWorkletProcessor)
 * Continuous PCM loudness measurement worklet processor.
 * Executes the shared LoudnessCore on every Web Audio render quantum (128 frames).
 */

import { LoudnessCore } from '../dsp/loudness-core.js';

class LoudnessMeterProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions || {};
    const sampleRate = processorOptions.sampleRate || (typeof currentSampleRate !== 'undefined' ? currentSampleRate : 48000);
    const channelCount = processorOptions.channelCount || 2;

    this.core = new LoudnessCore({
      sampleRate,
      channelCount
    });

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'reset') {
        this.core.reset();
      } else if (data.type === 'resetEpoch') {
        this.core.resetEpoch();
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const sliceEmitted = this.core.processQuantum(input);
      if (sliceEmitted) {
        this.port.postMessage({
          type: 'measurement',
          metrics: this.core.getLatestMeasurement()
        });
      }
    }
    return true; // Observation node: keep processor alive
  }
}

registerProcessor('loudness-meter-processor', LoudnessMeterProcessor);
