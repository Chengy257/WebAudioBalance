/**
 * WebAudioBalance - BS.1770-4 K-Weighting Filter Stage
 * Implements the two-stage K-weighting filter curve:
 * Stage 1: Pre-filter (high-shelf filter simulating head acoustics, +4 dB boost @ 1.68 kHz)
 * Stage 2: RLB weighting (high-pass filter cutting low rumble < 38 Hz)
 */

export class KWeightingFilter {
  constructor(audioContext) {
    this.audioCtx = audioContext;

    // Stage 1: High-Shelf pre-filter
    this.stage1 = this.audioCtx.createBiquadFilter();
    this.stage1.type = 'highshelf';
    this.stage1.frequency.setValueAtTime(1682, this.audioCtx.currentTime);
    this.stage1.gain.setValueAtTime(4.0, this.audioCtx.currentTime);

    // Stage 2: High-pass RLB weighting filter
    this.stage2 = this.audioCtx.createBiquadFilter();
    this.stage2.type = 'highpass';
    this.stage2.frequency.setValueAtTime(38, this.audioCtx.currentTime);
    this.stage2.Q.setValueAtTime(0.5, this.audioCtx.currentTime);

    // Cascade stages: stage1 -> stage2
    this.stage1.connect(this.stage2);
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

/**
 * Pure software biquad filter for discrete buffer evaluation in benchmark testing
 */
export function applyKWeightingPureJs(samples, sampleRate = 48000) {
  // Coefficients for 48kHz (ITU-R BS.1770-4)
  // Stage 1 (High-shelf)
  const b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285];
  const a1 = [1.0, -1.69065929318241, 0.73248077421585];

  // Stage 2 (High-pass)
  const b2 = [1.0, -2.0, 1.0];
  const a2 = [1.0, -1.99004745483398, 0.99007225034628];

  function runBiquad(input, b, a) {
    const out = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 = (b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0];
      out[i] = y0;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }
    return out;
  }

  const stage1Out = runBiquad(samples, b1, a1);
  return runBiquad(stage1Out, b2, a2);
}
