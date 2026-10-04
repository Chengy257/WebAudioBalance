/**
 * WebAudioBalance - Biquad Filter Core
 * Direct Form II Transposed implementation for pure JS and AudioWorklet DSP.
 */

export function createBiquadState() {
  return {
    s1: 0.0,
    s2: 0.0
  };
}

export function resetBiquadState(state) {
  state.s1 = 0.0;
  state.s2 = 0.0;
}

/**
 * Process a single audio sample through a biquad stage
 * @param {number} x - Input sample
 * @param {number[]} b - Numerator coefficients [b0, b1, b2]
 * @param {number[]} a - Denominator coefficients [a0, a1, a2] (a0 assumed 1.0)
 * @param {{s1: number, s2: number}} state - Direct Form II Transposed state
 * @returns {number} Filtered sample
 */
export function processBiquadSample(x, b, a, state) {
  const y = b[0] * x + state.s1;
  state.s1 = b[1] * x - a[1] * y + state.s2;
  state.s2 = b[2] * x - a[2] * y;
  return y;
}

/**
 * Process an entire buffer/chunk through a biquad stage
 * @param {Float32Array|Float64Array} input
 * @param {Float32Array|Float64Array} output - Can be the same as input for in-place filtering
 * @param {number[]} b
 * @param {number[]} a
 * @param {{s1: number, s2: number}} state
 */
export function processBiquadChunk(input, output, b, a, state) {
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const a1 = a[1], a2 = a[2];
  let s1 = state.s1;
  let s2 = state.s2;
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const x = input[i];
    const y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    output[i] = y;
  }

  state.s1 = s1;
  state.s2 = s2;
}
