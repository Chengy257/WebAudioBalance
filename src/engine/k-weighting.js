/**
 * WebAudioBalance - K-Weighting Filter Module
 * Re-exports the shared continuous K-weighting DSP core and provides
 * backward compatibility wrappers.
 */

export {
  getKWeightingCoefficients,
  createKWeightingChannelState,
  resetKWeightingChannelState,
  applyKWeightingSample,
  applyKWeightingChunk,
  applyKWeightingPureJs
} from './dsp/k-weighting-core.js';

/**
 * Legacy Web Audio BiquadFilterNode approximation wrapper (deprecated in R1 in favor of AudioWorklet LoudnessMeter)
 */
export class KWeightingFilter {
  constructor(audioContext) {
    this.audioCtx = audioContext;
    if (this.audioCtx?.createBiquadFilter) {
      this.stage1 = this.audioCtx.createBiquadFilter();
      this.stage1.type = 'highshelf';
      this.stage1.frequency.setValueAtTime(1682, this.audioCtx.currentTime);
      this.stage1.gain.setValueAtTime(4.0, this.audioCtx.currentTime);

      this.stage2 = this.audioCtx.createBiquadFilter();
      this.stage2.type = 'highpass';
      this.stage2.frequency.setValueAtTime(38, this.audioCtx.currentTime);
      this.stage2.Q.setValueAtTime(0.5, this.audioCtx.currentTime);

      this.stage1.connect(this.stage2);
    } else {
      this.stage1 = { connect() {}, disconnect() {} };
      this.stage2 = { connect() {}, disconnect() {} };
    }
  }

  getInputNode() {
    return this.stage1;
  }

  getOutputNode() {
    return this.stage2;
  }

  disconnect() {
    try {
      this.stage1.disconnect();
      this.stage2.disconnect();
    } catch (_) {}
  }
}
