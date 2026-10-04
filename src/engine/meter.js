/**
 * WebAudioBalance - EngineeringMeter
 * Non-intrusive observation tap for RMS and Peak dBFS measurements
 */

export class EngineeringMeter {
  constructor(audioContext, fftSize = 2048) {
    this.audioCtx = audioContext;
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.timeBuffer = new Float32Array(this.analyser.fftSize);

    this.lastRmsDbFS = -100;
    this.lastPeakDbFS = -100;
    this.lastSampleTime = Date.now();
  }

  getNode() {
    return this.analyser;
  }

  /**
   * Sample current buffer and compute RMS and Peak levels
   */
  measure() {
    this.analyser.getFloatTimeDomainData(this.timeBuffer);

    let sumSquares = 0;
    let peakAbs = 0;
    const len = this.timeBuffer.length;

    for (let i = 0; i < len; i++) {
      const val = this.timeBuffer[i];
      const absVal = Math.abs(val);
      if (absVal > peakAbs) peakAbs = absVal;
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / len);

    // Convert to dBFS with -100 dBFS floor
    this.lastRmsDbFS = rms > 1e-5 ? Number((20 * Math.log10(rms)).toFixed(1)) : -100;
    this.lastPeakDbFS = peakAbs > 1e-5 ? Number((20 * Math.log10(peakAbs)).toFixed(1)) : -100;
    this.lastSampleTime = Date.now();

    return {
      rmsDbFS: this.lastRmsDbFS,
      peakDbFS: this.lastPeakDbFS,
      rawRms: rms,
      rawPeak: peakAbs,
      timestamp: this.lastSampleTime
    };
  }

  getMetrics() {
    return {
      rmsDbFS: this.lastRmsDbFS,
      peakDbFS: this.lastPeakDbFS,
      timestamp: this.lastSampleTime
    };
  }

  disconnect() {
    try {
      this.analyser.disconnect();
    } catch (_) {}
  }
}
