/**
 * WebAudioBalance - K-Weighting Filter Core (ITU-R BS.1770-5 aligned)
 * Sample-rate-aware two-stage IIR filter (Pre-filter High-Shelf + RLB High-Pass).
 * Production and tests share this exact DSP core.
 */

import {
  createBiquadState,
  resetBiquadState,
  processBiquadChunk,
  processBiquadSample
} from './biquad-core.js';

const coefficientsCache = new Map();

/**
 * Compute BS.1770 K-weighting biquad coefficients for any sample rate via bilinear transform.
 * Matches ITU-R BS.1770-4/5 reference coefficients at 48kHz and libebur128 at arbitrary rates.
 * @param {number} sampleRate - Audio sample rate (e.g. 48000, 44100)
 * @returns {{ stage1: { b: number[], a: number[] }, stage2: { b: number[], a: number[] } }}
 */
export function getKWeightingCoefficients(sampleRate) {
  const fs = Number(sampleRate) || 48000;
  if (coefficientsCache.has(fs)) {
    return coefficientsCache.get(fs);
  }

  // Stage 1: Pre-filter (high-shelf filter modeling human head acoustics)
  const f0_pre = 1681.974450955533;
  const G = 3.999843853973347;
  const Q_pre = 0.7071752369554196;
  const K_pre = Math.tan(Math.PI * f0_pre / fs);
  const Vh = Math.pow(10.0, G / 20.0);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_pre = 1.0 + K_pre / Q_pre + K_pre * K_pre;

  const stage1 = {
    b: [
      (Vh + Vb * K_pre / Q_pre + K_pre * K_pre) / a0_pre,
      2.0 * (K_pre * K_pre - Vh) / a0_pre,
      (Vh - Vb * K_pre / Q_pre + K_pre * K_pre) / a0_pre
    ],
    a: [
      1.0,
      2.0 * (K_pre * K_pre - 1.0) / a0_pre,
      (1.0 - K_pre / Q_pre + K_pre * K_pre) / a0_pre
    ]
  };

  // Stage 2: RLB weighting filter (high-pass filter cutting sub-bass rumble)
  const f0_rlb = 38.13547087602444;
  const Q_rlb = 0.5003270373238773;
  const K_rlb = Math.tan(Math.PI * f0_rlb / fs);
  const denom_rlb = 1.0 + K_rlb / Q_rlb + K_rlb * K_rlb;

  const stage2 = {
    b: [1.0, -2.0, 1.0],
    a: [
      1.0,
      2.0 * (K_rlb * K_rlb - 1.0) / denom_rlb,
      (1.0 - K_rlb / Q_rlb + K_rlb * K_rlb) / denom_rlb
    ]
  };

  const coeffs = { stage1, stage2, sampleRate: fs };
  coefficientsCache.set(fs, coeffs);
  return coeffs;
}

/**
 * Create state for a single audio channel (two cascaded biquad stages)
 */
export function createKWeightingChannelState() {
  return {
    stage1: createBiquadState(),
    stage2: createBiquadState()
  };
}

/**
 * Deterministically reset channel filter states
 */
export function resetKWeightingChannelState(state) {
  resetBiquadState(state.stage1);
  resetBiquadState(state.stage2);
}

/**
 * Filter a single sample through Stage 1 then Stage 2
 */
export function applyKWeightingSample(sample, coeffs, state) {
  const s1 = processBiquadSample(sample, coeffs.stage1.b, coeffs.stage1.a, state.stage1);
  return processBiquadSample(s1, coeffs.stage2.b, coeffs.stage2.a, state.stage2);
}

/**
 * Filter a chunk/buffer of audio samples for one channel
 * @param {Float32Array|Float64Array} input
 * @param {Float32Array|Float64Array} output - Can be identical to input for in-place filtering
 * @param {{ stage1: { b: number[], a: number[] }, stage2: { b: number[], a: number[] } }} coeffs
 * @param {{ stage1: object, stage2: object }} state
 */
export function applyKWeightingChunk(input, output, coeffs, state) {
  // Pass through Stage 1 into output
  processBiquadChunk(input, output, coeffs.stage1.b, coeffs.stage1.a, state.stage1);
  // Pass through Stage 2 in-place
  processBiquadChunk(output, output, coeffs.stage2.b, coeffs.stage2.a, state.stage2);
}

/**
 * Shared helper for discrete buffer evaluation in benchmark testing and legacy compatibility
 * @param {Float32Array|Array<number>} samples
 * @param {number} [sampleRate=48000]
 * @returns {Float32Array}
 */
export function applyKWeightingPureJs(samples, sampleRate = 48000) {
  const inArr = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const outArr = new Float32Array(inArr.length);
  const coeffs = getKWeightingCoefficients(sampleRate);
  const state = createKWeightingChannelState();
  applyKWeightingChunk(inArr, outArr, coeffs, state);
  return outArr;
}
