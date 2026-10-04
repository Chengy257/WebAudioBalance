/**
 * WebAudioBalance - Continuous Loudness Core (ITU-R BS.1770-5 aligned)
 * Continuous PCM loudness accumulation, contiguous 100ms energy slicing,
 * 400ms Momentary and 3s Short-Term sliding windows, sample peak tracking.
 * Pure JS: runs in AudioWorklet, browser tests, and Node.
 */

import {
  getKWeightingCoefficients,
  createKWeightingChannelState,
  resetKWeightingChannelState,
  applyKWeightingSample
} from './k-weighting-core.js';

export class LoudnessCore {
  constructor(options = {}) {
    this.sampleRate = Number(options.sampleRate) || 48000;
    this.channelCount = Number(options.channelCount) || 2;
    this.sliceDurationSec = Number(options.sliceDurationSec) || 0.1; // 100ms
    this.framesPerSlice = Math.round(this.sampleRate * this.sliceDurationSec);

    this.coeffs = getKWeightingCoefficients(this.sampleRate);
    this.channelStates = Array.from({ length: this.channelCount }, () => createKWeightingChannelState());

    // Channel weighting according to ITU-R BS.1770-5:
    // Left: 1.0 (0 dB), Right: 1.0 (0 dB), Center: 1.0, Surround: 1.41 (+1.5 dB)
    // For mono or stereo, channel weighting is 1.0 per channel
    this.channelWeights = new Float64Array(this.channelCount);
    for (let c = 0; c < this.channelCount; c++) {
      this.channelWeights[c] = (c >= 3 && c <= 4) ? 1.41 : 1.0;
    }

    // Contiguous slices history (up to 30 slices = 3.0s)
    this.maxSlices = 30;
    this.momentarySlicesCount = 4; // 4 * 100ms = 400ms
    this.slices = []; // { energy: number, peak: number }

    // Current slice accumulator
    this.currentSliceFrames = 0;
    this.currentSliceChannelSquares = new Float64Array(this.channelCount);
    this.currentSlicePeak = 0.0;

    this.totalSlicesProcessed = 0;
    this.measurementSequence = 0;
    this.lastMeasurement = null;
  }

  /**
   * Process a quantum of multi-channel audio samples
   * @param {Array<Float32Array|Float64Array>} channels - Array of channel buffers
   * @returns {boolean} True if one or more 100ms slices were completed and emitted
   */
  processQuantum(channels) {
    if (!channels || channels.length === 0) return false;
    const numChannels = Math.min(channels.length, this.channelCount);
    const quantumFrames = channels[0].length;
    if (quantumFrames === 0) return false;

    let framesRemaining = quantumFrames;
    let offset = 0;
    let sliceEmitted = false;

    while (framesRemaining > 0) {
      const framesNeeded = this.framesPerSlice - this.currentSliceFrames;
      const take = Math.min(framesRemaining, framesNeeded);

      for (let ch = 0; ch < numChannels; ch++) {
        const input = channels[ch];
        const state = this.channelStates[ch];
        const coeffs = this.coeffs;
        let sumSq = 0.0;
        let peak = this.currentSlicePeak;

        for (let i = 0; i < take; i++) {
          const raw = input[offset + i];
          const absRaw = Math.abs(raw);
          if (absRaw > peak) peak = absRaw;

          const filtered = applyKWeightingSample(raw, coeffs, state);
          sumSq += filtered * filtered;
        }

        this.currentSliceChannelSquares[ch] += sumSq;
        this.currentSlicePeak = peak;
      }

      this.currentSliceFrames += take;
      offset += take;
      framesRemaining -= take;

      if (this.currentSliceFrames >= this.framesPerSlice) {
        this.finalizeSlice();
        sliceEmitted = true;
      }
    }

    return sliceEmitted;
  }

  /**
   * Finalize a complete 100ms slice and update sliding window metrics
   */
  finalizeSlice() {
    // 1. Calculate weighted energy for this 100ms slice
    let sliceWeightedEnergy = 0.0;
    const invFrames = 1.0 / this.framesPerSlice;

    for (let ch = 0; ch < this.channelCount; ch++) {
      const meanSquare = this.currentSliceChannelSquares[ch] * invFrames;
      sliceWeightedEnergy += this.channelWeights[ch] * meanSquare;
    }

    // 2. Push slice to sliding window history
    this.slices.push({
      energy: sliceWeightedEnergy,
      peak: this.currentSlicePeak
    });

    if (this.slices.length > this.maxSlices) {
      this.slices.shift();
    }

    this.totalSlicesProcessed++;
    this.measurementSequence++;

    // 3. Compute Momentary Loudness (last 4 slices = 400ms)
    const mCount = Math.min(this.slices.length, this.momentarySlicesCount);
    let mEnergySum = 0.0;
    let mPeak = 0.0;
    for (let i = this.slices.length - mCount; i < this.slices.length; i++) {
      const s = this.slices[i];
      mEnergySum += s.energy;
      if (s.peak > mPeak) mPeak = s.peak;
    }
    const mMeanEnergy = mCount > 0 ? (mEnergySum / mCount) : 0.0;
    const momentaryLufs = this.calculateLufs(mMeanEnergy);

    // 4. Compute Short-Term Loudness (last 30 slices = 3.0s)
    let stEnergySum = 0.0;
    for (let i = 0; i < this.slices.length; i++) {
      stEnergySum += this.slices[i].energy;
    }
    const stMeanEnergy = this.slices.length > 0 ? (stEnergySum / this.slices.length) : 0.0;
    const shortTermLufs = this.calculateLufs(stMeanEnergy);

    // 5. Peak in dBFS (over recent window)
    const samplePeakDbFS = mPeak > 1e-5 ? Number((20 * Math.log10(mPeak)).toFixed(1)) : -100.0;

    // 6. Validity flags based strictly on contiguous duration
    const momentaryValid = this.totalSlicesProcessed >= this.momentarySlicesCount;
    const shortTermValid = this.totalSlicesProcessed >= this.maxSlices;

    this.lastMeasurement = {
      momentaryLufs,
      shortTermLufs,
      momentaryValid,
      shortTermValid,
      samplePeakDbFS,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      measurementTimestamp: Date.now(),
      measurementSequence: this.measurementSequence
    };

    // 7. Reset accumulator for next slice
    this.currentSliceFrames = 0;
    this.currentSliceChannelSquares.fill(0);
    this.currentSlicePeak = 0.0;
  }

  /**
   * Convert linear weighted mean square energy to LUFS (BS.1770 formula)
   * LUFS = -0.691 + 10 * log10(energy)
   */
  calculateLufs(meanEnergy) {
    if (!meanEnergy || meanEnergy < 1e-10) {
      return -100.0;
    }
    const lufs = -0.691 + 10 * Math.log10(meanEnergy);
    return Number(Math.max(-100.0, Math.min(10.0, lufs)).toFixed(1));
  }

  /**
   * Get the latest measurement payload
   */
  getLatestMeasurement() {
    if (this.lastMeasurement) {
      return { ...this.lastMeasurement };
    }
    return {
      momentaryLufs: -100.0,
      shortTermLufs: -100.0,
      momentaryValid: false,
      shortTermValid: false,
      samplePeakDbFS: -100.0,
      sampleRate: this.sampleRate,
      channelCount: this.channelCount,
      measurementTimestamp: Date.now(),
      measurementSequence: 0
    };
  }

  /**
   * Reset epoch upon activity resume to avoid contaminating short-term window with preceding silence
   */
  resetEpoch() {
    this.slices = [];
    this.totalSlicesProcessed = 0;
    this.currentSliceFrames = 0;
    this.currentSliceChannelSquares.fill(0);
    this.currentSlicePeak = 0.0;
    if (this.lastMeasurement) {
      this.lastMeasurement.momentaryValid = false;
      this.lastMeasurement.shortTermValid = false;
    }
  }

  /**
   * Complete deterministic reset
   */
  reset() {
    this.slices = [];
    this.totalSlicesProcessed = 0;
    this.measurementSequence = 0;
    this.currentSliceFrames = 0;
    this.currentSliceChannelSquares.fill(0);
    this.currentSlicePeak = 0.0;
    this.lastMeasurement = null;
    for (const state of this.channelStates) {
      resetKWeightingChannelState(state);
    }
  }
}
