/**
 * WebAudioBalance - P2 Loudness Normalization & BS.1770 Benchmark Suite
 */

import { KWeightingFilter, applyKWeightingPureJs } from '../src/engine/k-weighting.js';
import { LoudnessMeter } from '../src/engine/loudness-meter.js';
import { ActivityDetector } from '../src/engine/activity-detector.js';
import { NormalizationController } from '../src/engine/normalization-controller.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

// -------------------------------------------------------------
// Benchmark 1: Silence & Activity Detector
// -------------------------------------------------------------
console.log('\n--- Benchmark 1: Silence & Inactivity Gating ---');
const activityDetector = new ActivityDetector({ silenceThresholdLufs: -50.0 });
const ctrl1 = new NormalizationController({ targetLufs: -18.0 });

// Silence input (-80 LUFS)
const actSilence = activityDetector.process(-80);
assert(!actSilence.isActive, 'Silence (-80 LUFS) correctly marked inactive');

const state1 = ctrl1.update(-80, actSilence.isActive);
assert(state1.isFrozen, 'Controller freezes gain adaptation on silence');
assert(state1.autoGainDb === 0.0, 'No gain runaway during silence: autoGainDb remains 0.0 dB');

// -------------------------------------------------------------
// Benchmark 2: K-Weighting Frequency Response
// -------------------------------------------------------------
console.log('\n--- Benchmark 2: BS.1770 K-Weighting Curve ---');

function generateTone(freq, sampleRate = 48000, durationSec = 0.5, amplitude = 0.5) {
  const n = sampleRate * durationSec;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amplitude * Math.sin(2 * Math.PI * freq * (i / sampleRate));
  }
  return buf;
}

function calculateRms(buffer) {
  let s = 0;
  for (let i = 0; i < buffer.length; i++) s += buffer[i] * buffer[i];
  return Math.sqrt(s / buffer.length);
}

// 50 Hz should be attenuated by Stage 2 highpass
const tone50 = generateTone(50);
const tone50Filtered = applyKWeightingPureJs(tone50);
const rms50In = calculateRms(tone50);
const rms50Out = calculateRms(tone50Filtered);
const gain50Db = 20 * Math.log10(rms50Out / rms50In);
assert(gain50Db < -1.0, `50 Hz low-frequency attenuated: ${gain50Db.toFixed(2)} dB (< -1.0 dB)`);

// 3 kHz should be boosted by Stage 1 highshelf (+4 dB nominal shelf)
const tone3000 = generateTone(3000);
const tone3000Filtered = applyKWeightingPureJs(tone3000);
const rms3000In = calculateRms(tone3000);
const rms3000Out = calculateRms(tone3000Filtered);
const gain3000Db = 20 * Math.log10(rms3000Out / rms3000In);
assert(gain3000Db > +2.5, `3 kHz high-frequency boosted: +${gain3000Db.toFixed(2)} dB (> +2.5 dB)`);

// -------------------------------------------------------------
// Benchmark 3: Deadband & Hysteresis
// -------------------------------------------------------------
console.log('\n--- Benchmark 3: Deadband & Hysteresis (Prevent Hunting) ---');
const ctrlDeadband = new NormalizationController({ targetLufs: -18.0, deadbandDb: 1.0 });

// Input is -17.5 LUFS (0.5 dB error, inside deadband)
const dbState1 = ctrlDeadband.update(-17.5, true, 0.1);
assert(dbState1.autoGainDb === 0.0, 'Input within +/-1.0 LU deadband results in 0 dB change');

// Input is -18.8 LUFS (0.8 dB error, inside deadband)
const dbState2 = ctrlDeadband.update(-18.8, true, 0.1);
assert(dbState2.autoGainDb === 0.0, 'Second input within deadband maintains 0 dB change');

// -------------------------------------------------------------
// Benchmark 4: Loud Signal Fast Attenuation (Attack Rate)
// -------------------------------------------------------------
console.log('\n--- Benchmark 4: Fast Attenuation on Loud Signal ---');
const ctrlLoud = new NormalizationController({
  targetLufs: -18.0,
  attackRateDbPerSec: 10.0, // 10 dB/s
  releaseRateDbPerSec: 1.5
});

// Loud signal: -8 LUFS (10 dB too loud, requires -10 dB autoGain)
// Simulate 1 second of adaptation in 10 steps of 0.1s
for (let step = 0; step < 10; step++) {
  ctrlLoud.update(-8.0, true, 0.1);
}
const loudState = ctrlLoud.getState();
assert(loudState.autoGainDb <= -9.0, `Loud burst (-8 LUFS) attenuated rapidly to ${loudState.autoGainDb} dB (target -10 dB)`);

// -------------------------------------------------------------
// Benchmark 5: Quiet Signal Gentle Release (Release Rate)
// -------------------------------------------------------------
console.log('\n--- Benchmark 5: Gentle Amplification on Quiet Signal ---');
const ctrlQuiet = new NormalizationController({
  targetLufs: -18.0,
  attackRateDbPerSec: 10.0,
  releaseRateDbPerSec: 2.0 // 2.0 dB/s
});

// Quiet signal: -28 LUFS (10 dB too quiet, requires +10 dB autoGain)
// Over 0.5 seconds (5 steps of 0.1s), at 2 dB/s it should rise by ~1.0 dB (smooth, non-pumping)
for (let step = 0; step < 5; step++) {
  ctrlQuiet.update(-28.0, true, 0.1);
}
const quietStateHalfSec = ctrlQuiet.getState();
assert(Math.abs(quietStateHalfSec.autoGainDb - 1.0) < 0.2, `Quiet signal rises gradually: +${quietStateHalfSec.autoGainDb} dB after 0.5s (~ +1.0 dB)`);

// After 5 total seconds (50 steps), it should reach +10 dB
for (let step = 0; step < 45; step++) {
  ctrlQuiet.update(-28.0, true, 0.1);
}
const quietStateFinal = ctrlQuiet.getState();
assert(Math.abs(quietStateFinal.autoGainDb - 10.0) < 0.5, `Quiet signal converges smoothly near target: +${quietStateFinal.autoGainDb} dB`);

// -------------------------------------------------------------
// Benchmark 6: Speech Pauses & Freeze Behavior
// -------------------------------------------------------------
console.log('\n--- Benchmark 6: Speech Pauses (No Pumping during Pauses) ---');
const detectorPause = new ActivityDetector({ silenceThresholdLufs: -50.0, holdTimeMs: 200 });
const ctrlPause = new NormalizationController({ targetLufs: -18.0, releaseRateDbPerSec: 2.0 });

// Active speech (-24 LUFS) for 1 second -> gain increases by ~2.0 dB
for (let i = 0; i < 10; i++) {
  const act = detectorPause.process(-24.0);
  ctrlPause.update(-24.0, act.isActive, 0.1);
}
const gainBeforePause = ctrlPause.getState().autoGainDb;
assert(gainBeforePause > 1.5, `Speech established gain: +${gainBeforePause} dB`);

// Pause for 1 second (silence at -70 LUFS)
await new Promise(r => setTimeout(r, 250)); // let hold time expire
for (let i = 0; i < 10; i++) {
  const act = detectorPause.process(-70.0);
  ctrlPause.update(-70.0, act.isActive, 0.1);
}
const gainAfterPause = ctrlPause.getState().autoGainDb;
assert(gainAfterPause === gainBeforePause, `Gain frozen during speech pause: +${gainAfterPause} dB (no background noise pumping)`);

// -------------------------------------------------------------
// Benchmark 7: Auto Gain Bounding / Clamping
// -------------------------------------------------------------
console.log('\n--- Benchmark 7: Auto-Gain Bound Enforcement ---');
const ctrlBounds = new NormalizationController({
  targetLufs: -18.0,
  minAutoGainDb: -18.0,
  maxAutoGainDb: +12.0
});

// Extremely quiet signal (-60 LUFS, requested gain +42 dB)
for (let i = 0; i < 100; i++) {
  ctrlBounds.update(-60.0, true, 0.2);
}
assert(ctrlBounds.getState().autoGainDb === +12.0, `Extreme quiet signal clamped to max +12.0 dB: ${ctrlBounds.getState().autoGainDb} dB`);

// Extremely loud signal (+5 LUFS, requested gain -23 dB)
for (let i = 0; i < 100; i++) {
  ctrlBounds.update(+5.0, true, 0.2);
}
assert(ctrlBounds.getState().autoGainDb === -18.0, `Extreme loud signal clamped to min -18.0 dB: ${ctrlBounds.getState().autoGainDb} dB`);

// -------------------------------------------------------------
// Benchmark 8: Gain Composition (Auto + Manual Offset)
// -------------------------------------------------------------
console.log('\n--- Benchmark 8: Manual Offset Composition ---');
const ctrlComp = new NormalizationController({ targetLufs: -18.0 });
ctrlComp.autoGainDb = +4.5;
ctrlComp.setManualOffsetDb(-3.0);
const compState1 = ctrlComp.getState();
assert(compState1.effectiveGainDb === 1.5, `Composite gain: +4.5 auto + (-3.0 manual) = +1.5 dB (observed: ${compState1.effectiveGainDb} dB)`);

ctrlComp.setManualOffsetDb(+6.0);
const compState2 = ctrlComp.getState();
assert(compState2.effectiveGainDb === 10.5, `Composite gain: +4.5 auto + (+6.0 manual) = +10.5 dB (observed: ${compState2.effectiveGainDb} dB)`);

// -------------------------------------------------------------
// Benchmark Summary
// -------------------------------------------------------------
console.log('\n=============================================');
console.log(`P2 BENCHMARK RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
