/**
 * WebAudioBalance - SafetyHook
 * Minimal output clipping protection stage to constrain unsafe peaks
 */

export class SafetyHook {
  constructor(audioContext, options = {}) {
    this.audioCtx = audioContext;
    this.limiter = this.audioCtx.createDynamicsCompressor();

    // Fast-acting transparent peak guard
    this.limiter.threshold.setValueAtTime(options.thresholdDb ?? -0.5, this.audioCtx.currentTime);
    this.limiter.knee.setValueAtTime(0, this.audioCtx.currentTime);
    this.limiter.ratio.setValueAtTime(20, this.audioCtx.currentTime);
    this.limiter.attack.setValueAtTime(0.002, this.audioCtx.currentTime);
    this.limiter.release.setValueAtTime(0.05, this.audioCtx.currentTime);
  }

  getInputNode() {
    return this.limiter;
  }

  getOutputNode() {
    return this.limiter;
  }

  disconnect() {
    try {
      this.limiter.disconnect();
    } catch (_) {}
  }
}
