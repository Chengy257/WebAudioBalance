/**
 * WebAudioBalance - R1 Audio Core Correction Unit & Simulation Verification Suite
 * Authoritative verification of:
 * - ITU-R BS.1770-5 aligned K-weighting DSP and sample-rate independence (44.1k & 48k)
 * - Contiguous 400ms Momentary and 3s Short-Term sliding windows and validity gates
 * - Multi-engine absolute convergence (±1.0 LU) without gain runaway
 * - 10-minute long-run stability simulation
 * - Asymmetric attack/release dynamic step response
 * - Relative target offsets (no double application)
 * - Activity gating, speech pauses, and resume reacquisition epochs
 * - Headroom safety and peak constraint enforcement
 */

import { getKWeightingCoefficients, createKWeightingChannelState, resetKWeightingChannelState, applyKWeightingSample, applyKWeightingPureJs } from '../src/engine/dsp/k-weighting-core.js';
import { LoudnessCore } from '../src/engine/dsp/loudness-core.js';
import { NormalizationController } from '../src/engine/normalization-controller.js';
import { ActivityDetector } from '../src/engine/activity-detector.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testSection(title) {
  console.log(`\n=== [R1 SUITE] ${title} ===`);
}

async function runR1CoreTests() {
  console.log('Starting R1 Audio Core Verification Suite...\n');

  // =========================================================================
  // Section 1: Meter Conformance & Sample-Rate Handling (48 kHz & 44.1 kHz)
  // =========================================================================
  testSection('1. Meter Conformance & Sample-Rate Handling (ITU-R BS.1770-5)');

  // 1.1 48 kHz Stereo Reference Tone (1 kHz, amp=0.1 -> -20 dBFS / -20 LUFS)
  {
    const fs = 48000;
    const core = new LoudnessCore({ sampleRate: fs, channelCount: 2 });
    const quantumSize = 128;
    const durationSec = 4.0;
    const totalQuanta = Math.floor(durationSec * fs / quantumSize);

    const ch0 = new Float32Array(quantumSize);
    const ch1 = new Float32Array(quantumSize);

    let frame = 0;
    for (let q = 0; q < totalQuanta; q++) {
      for (let i = 0; i < quantumSize; i++) {
        const t = (frame + i) / fs;
        const val = 0.1 * Math.sin(2 * Math.PI * 1000 * t);
        ch0[i] = val;
        ch1[i] = val;
      }
      frame += quantumSize;
      core.processQuantum([ch0, ch1]);
    }

    const m = core.getLatestMeasurement();
    const errorLu = Math.abs(m.shortTermLufs - (-20.0));
    assert(m.momentaryValid === true, '48 kHz Momentary window is valid after 4s');
    assert(m.shortTermValid === true, '48 kHz Short-Term window is valid after 4s');
    assert(errorLu <= 0.2, `48 kHz steady reference error ≤ 0.2 LU (observed: ${m.shortTermLufs} LUFS, error: ${errorLu.toFixed(2)} LU)`);
    assert(Math.abs(m.samplePeakDbFS - (-20.0)) <= 0.2, `48 kHz sample peak matches fixture (observed: ${m.samplePeakDbFS} dBFS)`);
  }

  // 1.2 44.1 kHz Stereo Reference Tone (1 kHz, amp=0.1 -> -20 dBFS / -20 LUFS)
  {
    const fs = 44100;
    const core = new LoudnessCore({ sampleRate: fs, channelCount: 2 });
    const quantumSize = 128;
    const durationSec = 4.0;
    const totalQuanta = Math.floor(durationSec * fs / quantumSize);

    const ch0 = new Float32Array(quantumSize);
    const ch1 = new Float32Array(quantumSize);

    let frame = 0;
    for (let q = 0; q < totalQuanta; q++) {
      for (let i = 0; i < quantumSize; i++) {
        const t = (frame + i) / fs;
        const val = 0.1 * Math.sin(2 * Math.PI * 1000 * t);
        ch0[i] = val;
        ch1[i] = val;
      }
      frame += quantumSize;
      core.processQuantum([ch0, ch1]);
    }

    const m = core.getLatestMeasurement();
    const errorLu = Math.abs(m.shortTermLufs - (-20.0));
    assert(m.momentaryValid === true, '44.1 kHz Momentary window is valid after 4s');
    assert(m.shortTermValid === true, '44.1 kHz Short-Term window is valid after 4s');
    assert(errorLu <= 0.2, `44.1 kHz steady reference error ≤ 0.2 LU (observed: ${m.shortTermLufs} LUFS, error: ${errorLu.toFixed(2)} LU)`);
  }

  // 1.3 Mono Channel Handling (No stereo/mono averaging bias)
  {
    const fs = 48000;
    const core = new LoudnessCore({ sampleRate: fs, channelCount: 1 });
    const quantumSize = 128;
    const durationSec = 4.0;
    const totalQuanta = Math.floor(durationSec * fs / quantumSize);

    const chMono = new Float32Array(quantumSize);
    let frame = 0;
    for (let q = 0; q < totalQuanta; q++) {
      for (let i = 0; i < quantumSize; i++) {
        const t = (frame + i) / fs;
        chMono[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * t);
      }
      frame += quantumSize;
      core.processQuantum([chMono]);
    }

    const m = core.getLatestMeasurement();
    // In BS.1770, single mono channel has half the total power of dual-mono stereo (10 log10(0.5) = -3.01 dB)
    // -20.0 - 3.01 = -23.01 LUFS
    const errorLu = Math.abs(m.shortTermLufs - (-23.0));
    assert(errorLu <= 0.2, `Mono channel weighted energy correctly sums without division bias (observed: ${m.shortTermLufs} LUFS)`);
  }

  // 1.4 Warm-Up Validity State Progression
  {
    const fs = 48000;
    const core = new LoudnessCore({ sampleRate: fs, channelCount: 2 });
    const q128 = [new Float32Array(128), new Float32Array(128)];

    // Initial state
    let m = core.getLatestMeasurement();
    assert(m.momentaryValid === false, 'Initial momentaryValid is false');
    assert(m.shortTermValid === false, 'Initial shortTermValid is false');

    // Feed 3 slices (300 ms = 112 quanta)
    for (let i = 0; i < 112; i++) core.processQuantum(q128);
    m = core.getLatestMeasurement();
    assert(m.momentaryValid === false, 'At 300 ms, momentaryValid remains false (< 400ms)');
    assert(m.shortTermValid === false, 'At 300 ms, shortTermValid remains false (< 3s)');

    // Feed 1 more slice (total 4 slices = 400 ms)
    for (let i = 0; i < 38; i++) core.processQuantum(q128);
    m = core.getLatestMeasurement();
    assert(m.momentaryValid === true, 'At 400 ms (4 contiguous slices), momentaryValid transitions to true');
    assert(m.shortTermValid === false, 'At 400 ms, shortTermValid remains false (< 3s)');

    // Feed up to 3000 ms (30 slices)
    for (let i = 0; i < 26 * 38; i++) core.processQuantum(q128);
    m = core.getLatestMeasurement();
    assert(m.momentaryValid === true, 'At 3.0s, momentaryValid is true');
    assert(m.shortTermValid === true, 'At 3.0s (30 contiguous slices), shortTermValid transitions to true');
  }

  // =========================================================================
  // Section 2: Pure DSP Stability & Frequency Curves
  // =========================================================================
  testSection('2. Pure DSP Stability & Frequency Curves');

  {
    // 2.1 Impulse stability
    const coeffs = getKWeightingCoefficients(48000);
    const state = createKWeightingChannelState();
    const impulse = new Float32Array(10000);
    impulse[0] = 1.0;
    const out = new Float32Array(10000);
    for (let i = 0; i < impulse.length; i++) {
      out[i] = applyKWeightingSample(impulse[i], coeffs, state);
    }
    const tailEnergy = out.slice(5000).reduce((acc, v) => acc + v * v, 0);
    assert(tailEnergy < 1e-12, 'Impulse response is stable and decays to zero within 100ms');

    // 2.2 Reset determinism
    resetKWeightingChannelState(state);
    const zeroOut = applyKWeightingSample(0.0, coeffs, state);
    assert(zeroOut === 0.0, 'Filter state resets deterministically to zero');

    // 2.3 Low and high frequency response
    const fs = 48000;
    const N = 48000;
    const sig50 = new Float32Array(N);
    for (let i = 0; i < N; i++) sig50[i] = Math.sin(2 * Math.PI * 50 * i / fs);
    const out50 = applyKWeightingPureJs(sig50, fs);
    let rms50In = 0, rms50Out = 0;
    for (let i = fs / 2; i < N; i++) {
      rms50In += sig50[i] * sig50[i];
      rms50Out += out50[i] * out50[i];
    }
    const gain50 = 10 * Math.log10(rms50Out / rms50In);
    assert(gain50 < -1.0, `50 Hz rumble attenuated by RLB stage: ${gain50.toFixed(2)} dB (< -1.0 dB)`);

    const sig3k = new Float32Array(N);
    for (let i = 0; i < N; i++) sig3k[i] = Math.sin(2 * Math.PI * 3000 * i / fs);
    const out3k = applyKWeightingPureJs(sig3k, fs);
    let rms3kIn = 0, rms3kOut = 0;
    for (let i = fs / 2; i < N; i++) {
      rms3kIn += sig3k[i] * sig3k[i];
      rms3kOut += out3k[i] * out3k[i];
    }
    const gain3k = 10 * Math.log10(rms3kOut / rms3kIn);
    assert(gain3k > 2.5, `3 kHz head shelf boosted: +${gain3k.toFixed(2)} dB (> +2.5 dB)`);
  }

  // =========================================================================
  // Section 3: Absolute Convergence & Multi-Engine Independence (Section 14.2)
  // =========================================================================
  testSection('3. Absolute Convergence & Multi-Engine Independence (Section 14.2)');

  {
    // Simulation of 3 independent tabs converging to shared global target -18 LUFS:
    // Tab A: loud input (-10 LUFS) -> requires -8 dB attenuation
    // Tab B: target level (-18 LUFS) -> requires 0 dB
    // Tab C: quiet input (-26 LUFS) -> requires +8 dB amplification
    const globalTarget = -18.0;

    const ctrlA = new NormalizationController({ globalTargetLufs: globalTarget, deadbandDb: 0.2 });
    const ctrlB = new NormalizationController({ globalTargetLufs: globalTarget, deadbandDb: 0.2 });
    const ctrlC = new NormalizationController({ globalTargetLufs: globalTarget, deadbandDb: 0.2 });

    const inputA = -10.0;
    const inputB = -18.0;
    const inputC = -26.0;

    // Simulate 12 seconds of active continuous audio (120 steps of 0.1s dt)
    const dt = 0.1;
    for (let step = 0; step < 120; step++) {
      ctrlA.update({ momentaryLufs: inputA, shortTermLufs: inputA, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputA + 3 }, true, dt);
      ctrlB.update({ momentaryLufs: inputB, shortTermLufs: inputB, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputB + 3 }, true, dt);
      ctrlC.update({ momentaryLufs: inputC, shortTermLufs: inputC, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputC + 3 }, true, dt);
    }

    const stateA = ctrlA.getState();
    const stateB = ctrlB.getState();
    const stateC = ctrlC.getState();

    // Effective processed loudness = input + appliedGain
    const outputA = inputA + stateA.appliedGainDb;
    const outputB = inputB + stateB.appliedGainDb;
    const outputC = inputC + stateC.appliedGainDb;

    assert(Math.abs(outputA - globalTarget) <= 1.0, `Tab A processed output converged to ${outputA.toFixed(2)} LUFS (target ${globalTarget} ±1.0 LU)`);
    assert(Math.abs(outputB - globalTarget) <= 1.0, `Tab B processed output converged to ${outputB.toFixed(2)} LUFS (target ${globalTarget} ±1.0 LU)`);
    assert(Math.abs(outputC - globalTarget) <= 1.0, `Tab C processed output converged to ${outputC.toFixed(2)} LUFS (target ${globalTarget} ±1.0 LU)`);

    // Verify steady-state stability over next 50 steps (no drift)
    for (let step = 0; step < 50; step++) {
      ctrlA.update({ momentaryLufs: inputA, shortTermLufs: inputA, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputA + 3 }, true, dt);
      ctrlB.update({ momentaryLufs: inputB, shortTermLufs: inputB, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputB + 3 }, true, dt);
      ctrlC.update({ momentaryLufs: inputC, shortTermLufs: inputC, momentaryValid: true, shortTermValid: true, samplePeakDbFS: inputC + 3 }, true, dt);
    }

    const driftA = Math.abs(ctrlA.getState().appliedGainDb - stateA.appliedGainDb);
    const driftB = Math.abs(ctrlB.getState().appliedGainDb - stateB.appliedGainDb);
    const driftC = Math.abs(ctrlC.getState().appliedGainDb - stateC.appliedGainDb);

    assert(driftA < 1e-3, `Tab A zero drift after convergence (drift: ${driftA.toFixed(4)} dB)`);
    assert(driftB < 1e-3, `Tab B zero drift after convergence (drift: ${driftB.toFixed(4)} dB)`);
    assert(driftC < 1e-3, `Tab C zero drift after convergence (drift: ${driftC.toFixed(4)} dB)`);
  }

  // =========================================================================
  // Section 4: 10-Minute Long-Run Simulation (No Runaway) (Section 14.3)
  // =========================================================================
  testSection('4. 10-Minute Long-Run Simulation (No Runaway) (Section 14.3)');

  {
    const ctrl = new NormalizationController({ globalTargetLufs: -18.0, deadbandDb: 0.2 });
    const inputLufs = -12.0; // 6 dB too loud -> desired autoGain = -6.0 dB
    const dt = 0.1;

    // Run 6000 steps of 0.1s = 600 seconds = 10 minutes
    for (let step = 0; step < 6000; step++) {
      ctrl.update({
        momentaryLufs: inputLufs,
        shortTermLufs: inputLufs,
        momentaryValid: true,
        shortTermValid: true,
        samplePeakDbFS: -9.0
      }, true, dt);
    }

    const state = ctrl.getState();
    assert(Math.abs(state.appliedAutoGainDb - (-6.0)) < 0.05, `After 10 minutes, appliedAutoGainDb remains bounded at -6.0 dB (observed: ${state.appliedAutoGainDb} dB)`);
    assert(state.appliedAutoGainDb > ctrl.minAutoGainDb, 'Gain did NOT run away to min bound (-18 dB)');
  }

  // =========================================================================
  // Section 5: Dynamic Step Response & Asymmetric Adaptation (Section 14.4)
  // =========================================================================
  testSection('5. Dynamic Step Response & Asymmetric Rates (Section 14.4)');

  {
    const ctrl = new NormalizationController({
      globalTargetLufs: -18.0,
      attackRateDbPerSec: 8.0,
      releaseRateDbPerSec: 1.5,
      deadbandDb: 0.2
    });

    // 1. Sudden loud burst: 0 dB to -10 LUFS input (target -18 -> desired gain -8 dB)
    // At 8 dB/s attack rate, should attenuate ~4 dB in 0.5s
    for (let i = 0; i < 5; i++) {
      ctrl.update({ momentaryLufs: -10.0, shortTermLufs: -10.0, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -7.0 }, true, 0.1);
    }
    const attackGain = ctrl.getState().appliedAutoGainDb;
    assert(attackGain <= -3.8, `Attack phase attenuated rapidly by ${attackGain} dB in 0.5s (rate ~8 dB/s)`);

    // Complete convergence
    for (let i = 0; i < 15; i++) {
      ctrl.update({ momentaryLufs: -10.0, shortTermLufs: -10.0, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -7.0 }, true, 0.1);
    }
    assert(Math.abs(ctrl.getState().appliedAutoGainDb - (-8.0)) < 0.1, `Loud passage converged to -8 dB: ${ctrl.getState().appliedAutoGainDb} dB`);

    // 2. Drop to quiet passage: -22 LUFS input (target -18 -> desired gain +4 dB)
    // Gain needs to transition from -8 dB to +4 dB (a +12 dB swing)
    // At release rate 1.5 dB/s, over 1.0s (10 steps) it should rise by ~1.5 dB (gentle, no pumping)
    const gainBeforeRelease = ctrl.getState().appliedAutoGainDb;
    for (let i = 0; i < 10; i++) {
      ctrl.update({ momentaryLufs: -22.0, shortTermLufs: -22.0, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -19.0 }, true, 0.1);
    }
    const releaseRise = ctrl.getState().appliedAutoGainDb - gainBeforeRelease;
    assert(Math.abs(releaseRise - 1.5) < 0.3, `Release phase amplified gently: +${releaseRise.toFixed(2)} dB in 1.0s (rate ~1.5 dB/s)`);
  }

  // =========================================================================
  // Section 6: Relative Target Offsets (Section 14.5)
  // =========================================================================
  testSection('6. Relative Target Offsets (Section 14.5)');

  {
    const ctrl = new NormalizationController({ globalTargetLufs: -18.0, deadbandDb: 0.2 });
    const inputLufs = -18.0; // Input matches base target -> desiredAutoGain = 0 dB

    // Offset +3 dB -> effective target -15 LUFS
    ctrl.setRelativeOffsetDb(3.0);
    for (let i = 0; i < 20; i++) {
      ctrl.update({ momentaryLufs: inputLufs, shortTermLufs: inputLufs, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -15.0 }, true, 0.1);
    }
    let st = ctrl.getState();
    assert(st.effectiveTargetLufs === -15.0, 'Effective target is -15.0 LUFS with +3 dB offset');
    assert(st.appliedGainDb === 3.0, 'Applied gain is +3.0 dB with +3 dB relative offset');
    assert(st.desiredAutoGainDb === 0.0, 'Auto gain remains 0 dB (offset not double-applied)');

    // Offset -3 dB -> effective target -21 LUFS
    ctrl.setRelativeOffsetDb(-3.0);
    for (let i = 0; i < 20; i++) {
      ctrl.update({ momentaryLufs: inputLufs, shortTermLufs: inputLufs, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -15.0 }, true, 0.1);
    }
    st = ctrl.getState();
    assert(st.effectiveTargetLufs === -21.0, 'Effective target is -21.0 LUFS with -3 dB offset');
    assert(st.appliedGainDb === -3.0, 'Applied gain is -3.0 dB with -3 dB relative offset');
    assert(st.desiredAutoGainDb === 0.0, 'Auto gain remains 0 dB (offset not double-applied)');
  }

  // =========================================================================
  // Section 7: Silence, Resume & Reacquisition Epochs (Section 14.6)
  // =========================================================================
  testSection('7. Silence, Resume & Reacquisition Epochs (Section 14.6)');

  {
    const detector = new ActivityDetector({ silenceThresholdLufs: -50.0, holdTimeMs: 300 });
    const ctrl = new NormalizationController({ globalTargetLufs: -18.0 });

    // Establish active speech (+3 dB auto gain)
    for (let i = 0; i < 25; i++) {
      const act = detector.process(-21.0);
      ctrl.update({ momentaryLufs: -21.0, shortTermLufs: -21.0, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -18.0 }, act.isActive, 0.1);
    }
    const establishedGain = ctrl.getState().appliedGainDb;
    assert(establishedGain > 2.5, `Speech established gain: +${establishedGain} dB`);

    // Enter true silence (-80 LUFS)
    await new Promise(r => setTimeout(r, 350)); // let hold time expire
    for (let i = 0; i < 50; i++) {
      const act = detector.process(-80.0);
      ctrl.update({ momentaryLufs: -80.0, shortTermLufs: -80.0, momentaryValid: true, shortTermValid: true, samplePeakDbFS: -80.0 }, act.isActive, 0.1);
    }
    const silenceState = ctrl.getState();
    assert(silenceState.isFrozen === true, 'Controller is frozen during silence');
    assert(silenceState.appliedGainDb === establishedGain, 'Gain is frozen and does not grow during silence');

    // Resume reacquisition: signal returns, but short-term window is reset/invalid (< 3s)
    const actResume = detector.process(-28.0);
    // While reacquiring, shortTermValid is false
    ctrl.update({ momentaryLufs: -28.0, shortTermLufs: -80.0, momentaryValid: true, shortTermValid: false, samplePeakDbFS: -25.0 }, actResume.isActive, 0.1);
    const resumeState = ctrl.getState();
    assert(resumeState.desiredAutoGainDb === 0.0, 'Quiet resume with invalid short-term does NOT boost from preceding silence');
  }

  // =========================================================================
  // Section 8: Headroom & Safety-Limited Target (Section 14.7)
  // =========================================================================
  testSection('8. Headroom & Safety-Limited Target (Section 14.7)');

  {
    // Fixture with quiet average (-28 LUFS) but extremely high peaks (-1 dBFS)
    // Target is -18 LUFS (would request +10 dB boost), but output ceiling is -1 dBFS with 1 dB margin
    // Max safe gain = -1.0 - 1.0 - (-1.0) = -1.0 dB!
    const ctrl = new NormalizationController({
      globalTargetLufs: -18.0,
      outputCeilingDbFS: -1.0,
      peakMarginDb: 1.0,
      deadbandDb: 0.1
    });

    for (let i = 0; i < 30; i++) {
      ctrl.update({
        momentaryLufs: -28.0,
        shortTermLufs: -28.0,
        momentaryValid: true,
        shortTermValid: true,
        samplePeakDbFS: -1.0 // High peak near 0 dBFS
      }, true, 0.1);
    }

    const state = ctrl.getState();
    assert(state.isLimited === true, 'Target is marked isLimited=true due to headroom safety');
    assert(state.limitReason === 'headroom', `Concrete limitReason is reported: "${state.limitReason}"`);
    assert(state.appliedGainDb <= -0.9, `Applied gain is constrained by safe headroom (applied: ${state.appliedGainDb} dB)`);
  }

  // =========================================================================
  // Section 9: Hard Safety Envelope & Relative Offset Protections (R1 Closeout)
  // =========================================================================
  testSection('9. Hard Safety Envelope & Relative Offset Protections (R1 Closeout)');

  {
    // 9.1 Immediate drop when current gain is above newly reduced safety envelope
    const ctrlSafety = new NormalizationController({
      globalTargetLufs: -18.0,
      outputCeilingDbFS: -1.0,
      peakMarginDb: 1.0,
      attackRateDbPerSec: 8.0,
      releaseRateDbPerSec: 1.5,
      deadbandDb: 0.1
    });

    // Establish +8.0 dB positive boost on quiet input (-26 LUFS)
    for (let i = 0; i < 60; i++) {
      ctrlSafety.update({
        momentaryLufs: -26.0,
        shortTermLufs: -26.0,
        momentaryValid: true,
        shortTermValid: true,
        samplePeakDbFS: -23.0
      }, true, 0.1);
    }
    const prePeakGain = ctrlSafety.getState().appliedGainDb;
    assert(Math.abs(prePeakGain - 8.0) < 0.2, `Established positive boost: +${prePeakGain} dB`);

    // Sudden dangerous peak arrives (-0.5 dBFS) -> hard safe maximum = -1.0 - 1.0 - (-0.5) = -1.5 dB!
    // On the very next 0.1s step, gain MUST drop immediately to -1.5 dB (NOT only 8.0 - 0.8 = 7.2 dB!)
    ctrlSafety.update({
      momentaryLufs: -26.0,
      shortTermLufs: -26.0,
      momentaryValid: true,
      shortTermValid: true,
      samplePeakDbFS: -0.5
    }, true, 0.1);

    const clampedState = ctrlSafety.getState();
    assert(clampedState.appliedGainDb <= -1.5, `Gain immediately hard-clamped to safe ceiling on step 1: ${clampedState.appliedGainDb} dB (<= -1.5 dB)`);
    assert(clampedState.isLimited === true, 'Controller reports isLimited=true');
    assert(clampedState.limitReason === 'headroom', `limitReason is correctly reported as "headroom" (observed: "${clampedState.limitReason}")`);

    // 9.2 Safety relaxation grows only at slow release rate
    // Peak subsides back to -23.0 dBFS (safe max is now +15 dB).
    // Gain must grow upward from -1.5 dB at 1.5 dB/s, NOT jump back to +8.0 dB!
    ctrlSafety.update({
      momentaryLufs: -26.0,
      shortTermLufs: -26.0,
      momentaryValid: true,
      shortTermValid: true,
      samplePeakDbFS: -23.0
    }, true, 1.0); // 1.0s elapsed

    const relaxedState = ctrlSafety.getState();
    const relaxedGrowth = relaxedState.appliedGainDb - clampedState.appliedGainDb;
    assert(Math.abs(relaxedGrowth - 1.5) < 0.3, `Safety relaxation grew gently at release rate: +${relaxedGrowth.toFixed(2)} dB in 1s (~1.5 dB/s)`);

    // 9.3 Positive relative offset does not bypass safety envelope
    // Re-introduce peak of -1.0 dBFS -> safe max is -1.0 dB
    ctrlSafety.update({
      momentaryLufs: -26.0,
      shortTermLufs: -26.0,
      momentaryValid: true,
      shortTermValid: true,
      samplePeakDbFS: -1.0
    }, true, 0.1);
    assert(ctrlSafety.getState().appliedGainDb <= -1.0, 'Headroom constraint active at -1.0 dB');

    // User attempts to add +6.0 dB relative offset
    ctrlSafety.setRelativeOffsetDb(6.0);
    const offsetAttemptState = ctrlSafety.getState();
    assert(offsetAttemptState.appliedGainDb <= -1.0, `Positive relative offset did NOT bypass safety envelope (applied: ${offsetAttemptState.appliedGainDb} dB <= -1.0 dB)`);
    assert(offsetAttemptState.isLimited === true, 'isLimited remains true after positive offset attempt under headroom limit');

    // 9.4 Negative relative offset reduces gain immediately
    ctrlSafety.setRelativeOffsetDb(-4.0);
    const negOffsetState = ctrlSafety.getState();
    assert(negOffsetState.appliedGainDb <= -4.0, `Negative relative offset immediately reduces gain: ${negOffsetState.appliedGainDb} dB`);

    // 9.5 Internal gain field consistency
    assert(
      Math.abs(negOffsetState.appliedGainDb - (negOffsetState.appliedAutoGainDb + negOffsetState.relativeOffsetDb)) < 1e-4,
      'Internal gain fields remain mutually consistent: appliedGainDb == appliedAutoGainDb + relativeOffsetDb'
    );

    // 9.6 Pre-Measurement Positive-Gain Guard (R1 Final Closeout Addendum)
    const ctrlPre = new NormalizationController({ targetLufs: -18.0 });
    assert(ctrlPre.hasValidSafetyPeak === false, 'New controller has no valid safety peak');
    assert(ctrlPre.getState().appliedGainDb === 0.0, 'Initial applied gain is 0 dB');

    // 1. Request positive relative offset before any measurement exists
    ctrlPre.setRelativeOffsetDb(6.0);
    const preOffsetState = ctrlPre.getState();
    assert(preOffsetState.relativeOffsetDb === 6.0, 'Requested relative offset recorded as user intent (+6.0 dB)');
    assert(preOffsetState.appliedGainDb <= 0.0, `Applied gain does NOT rise above 0 dB before safety evidence (observed: ${preOffsetState.appliedGainDb} dB)`);
    assert(preOffsetState.isLimited === true, 'Controller reports isLimited=true during pre-measurement positive offset attempt');
    assert(preOffsetState.limitReason === 'warmup', 'limitReason is reported as warmup');

    // 2. Feed incomplete/warming up measurement (momentaryValid: false)
    const warmupState = ctrlPre.update({ momentaryLufs: -20.0, shortTermLufs: -20.0, samplePeakDbFS: -20.0, momentaryValid: false, shortTermValid: false }, true, 0.1);
    assert(warmupState.appliedGainDb <= 0.0, `Applied gain remains <= 0 dB during warm-up (observed: ${warmupState.appliedGainDb} dB)`);
    assert(ctrlPre.hasValidSafetyPeak === false, 'hasValidSafetyPeak remains false while momentaryValid is false');

    // 3. Feed valid safe peak measurement (momentaryValid: true, safe peak -10 dBFS -> safeHeadroomGain = -1 - 1 - (-10) = +8 dB)
    const validMetrics = { momentaryLufs: -20.0, shortTermLufs: -20.0, samplePeakDbFS: -10.0, momentaryValid: true, shortTermValid: true };
    const step1State = ctrlPre.update(validMetrics, true, 0.1);
    assert(ctrlPre.hasValidSafetyPeak === true, 'hasValidSafetyPeak transitions to true upon valid measurement');
    assert(ctrlPre.lastSafeMaxGainDb >= 6.0, `Safe maximum envelope computed: ${ctrlPre.lastSafeMaxGainDb} dB`);

    // 4. Adaptation begins growing only through normal controlled release rate (1.5 dB/s * 0.1s = 0.15 dB)
    assert(step1State.appliedGainDb > preOffsetState.appliedGainDb, 'Positive gain becomes eligible to grow only after valid safety evidence');
    assert(step1State.appliedGainDb <= 0.2, `Gain growth on step 1 constrained by release rate (observed: ${step1State.appliedGainDb} dB)`);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=============================================');
  console.log(`R1 AUDIO CORE SUITE: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runR1CoreTests();
