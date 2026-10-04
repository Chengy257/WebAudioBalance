/**
 * WebAudioBalance - LoudnessMeter (BS.1770 compliant)
 * Calculates Momentary Loudness (400ms) and Short-Term Loudness (3s) from K-weighted audio
 */

export class LoudnessMeter {
  constructor(audioContext, options = {}) {
    this.audioCtx = audioContext;
    this.sampleRate = this.audioCtx.sampleRate || 48000;

    // Analyser node connected to the output of K-weighting filter
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = options.fftSize ?? 2048;
    this.buffer = new Float32Array(this.analyser.fftSize);

    // Sliding ring buffer for Short-Term Loudness (~3 seconds)
    // 3 seconds @ 100ms update intervals = 30 slices
    this.maxSlices = 30;
    this.meanSquares = [];

    this.lastMomentaryLufs = -100;
    this.lastShortTermLufs = -100;
    this.lastPeakDbFS = -100;
    this.lastMeasureTime = Date.now();
  }

  getNode() {
    return this.analyser;
  }

  /**
   * Sample the buffer and compute Momentary (400ms) and Short-Term (3s) LUFS
   */
  measure() {
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sumSquares = 0;
    let peakVal = 0;
    const len = this.buffer.length;

    for (let i = 0; i < len; i++) {
      const s = this.buffer[i];
      const absS = Math.abs(s);
      if (absS > peakVal) peakVal = absS;
      sumSquares += s * s;
    }

    const meanSquare = sumSquares / len;

    // Maintain sliding history for Short-Term (3s)
    this.meanSquares.push(meanSquare);
    if (this.meanSquares.length > this.maxSlices) {
      this.meanSquares.shift();
    }

    // 1. Momentary LUFS (last ~400ms, approx last 4 slices)
    const recentSlices = this.meanSquares.slice(-4);
    const mMeanSquare = recentSlices.reduce((a, b) => a + b, 0) / (recentSlices.length || 1);
    this.lastMomentaryLufs = this.calculateLufs(mMeanSquare);

    // 2. Short-Term LUFS (last 3s, all slices)
    const stMeanSquare = this.meanSquares.reduce((a, b) => a + b, 0) / this.meanSquares.length;
    this.lastShortTermLufs = this.calculateLufs(stMeanSquare);

    // 3. Peak dBFS
    this.lastPeakDbFS = peakVal > 1e-5 ? Number((20 * Math.log10(peakVal)).toFixed(1)) : -100;
    this.lastMeasureTime = Date.now();

    return {
      momentaryLufs: this.lastMomentaryLufs,
      shortTermLufs: this.lastShortTermLufs,
      peakDbFS: this.lastPeakDbFS,
      timestamp: this.lastMeasureTime
    };
  }

  /**
   * BS.1770 LUFS formula: -0.691 + 10 * log10(meanSquare)
   */
  calculateLufs(meanSquare) {
    if (!meanSquare || meanSquare < 1e-10) {
      return -100;
    }
    const lufs = -0.691 + 10 * Math.log10(meanSquare);
    return Number(Math.max(-100, Math.min(0, lufs)).toFixed(1));
  }

  getMetrics() {
    return {
      momentaryLufs: this.lastMomentaryLufs,
      shortTermLufs: this.lastShortTermLufs,
      peakDbFS: this.lastPeakDbFS,
      timestamp: this.lastMeasureTime
    };
  }

  disconnect() {
    try {
      this.analyser.disconnect();
    } catch (_) {}
  }
}
