# P2 — Loudness Measurement & Automatic Normalization Validation Report

> Phase: **P2 — Loudness Measurement & Automatic Normalization**  
> Status: **COMPLETE**  
> Decision: **GO (Proceed to P3)**  
> Parent Baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 14)  
> Implementation Specification: `docs/planning/P2_LOUDNESS_MEASUREMENT_AND_NORMALIZATION_IMPLEMENTATION_SPEC.md`  
> Target: Chromium Manifest V3 (Google Chrome & Microsoft Edge)

---

## 1. Executive Summary

### Gate Decision: **GO**

Phase P2 has successfully implemented, calibrated, and validated the ITU-R BS.1770 perceptual loudness measurement pipeline and the asymmetric automatic normalization controller on top of the P1 `AudioEngine`.

Key achievements:
1. **BS.1770 K-Weighting**: Implemented two-stage K-weighting filtering (Stage 1 high-shelf acoustic head simulation $+4\text{ dB}$ at $1.68\text{ kHz}$; Stage 2 high-pass low-cut at $38\text{ Hz}$) in both Web Audio nodes and discrete algorithms. Low-frequency attenuation ($-3.98\text{ dB}$ at $50\text{ Hz}$) and high-frequency boost ($+3.81\text{ dB}$ at $3\text{ kHz}$) match standard curves.
2. **Dual-Window Loudness Metering**: `LoudnessMeter` calculates both Momentary Loudness ($M$, $400\text{ ms}$) and Short-Term Loudness ($S$, $3\text{ s}$) using standard mean-square energy formulas with a $-100\text{ LUFS}$ silence floor.
3. **Activity Detection & Silence Gating**: `ActivityDetector` accurately discriminates active sound from silence/pauses (threshold $-50.0\text{ LUFS}$ with $600\text{ ms}$ speech pause hold time). During silence, gain adaptation is frozen, completely preventing noise runaway and pumping artifacts.
4. **Asymmetric Normalization**: `NormalizationController` adapts with asymmetric time constants:
   - Loud bursts (e.g. $-8\text{ LUFS}$ vs $-18\text{ LUFS}$ target) attenuate rapidly at $10.0\text{ dB/s}$ to protect hearing;
   - Quiet passages (e.g. $-28\text{ LUFS}$) rise gradually at $2.0\text{ dB/s}$, providing smooth, transparent convergence without audible breathing.
5. **Deadband / Hysteresis**: Deadband of $\pm 1.0\text{ LU}$ prevents continuous gain hunting and micro-fluctuations when signals are already near target.
6. **Gain Bounds & Composition**: Auto-gain is clamped strictly within $[-18.0\text{ dB}, +12.0\text{ dB}]$. Manual user offsets compose additively ($\text{effective} = \text{auto} + \text{manual}$) with zero distortion.

All P2 acceptance criteria have been met. Progression to **P3 — Multi-tab Orchestration** is approved.

---

## 2. P2 Architecture Overview

```text
MediaStreamAudioSourceNode
          |
          +-------------------------------------------------+
          | (Observation Branch)                            | (Audio Path Branch)
          v                                                 v
  [ KWeightingFilter ]                               [ GainProcessor ]
    - Stage 1: High-shelf (+4 dB @ 1.68 kHz)           - effectiveGainDb =
    - Stage 2: High-pass (cut < 38 Hz)                     autoGainDb + manualOffsetDb
          |                                            - Click-free smoothing (50ms)
          v                                                 |
  [ LoudnessMeter ]                                         v
    - Momentary LUFS (400 ms)                         [ SafetyHook ]
    - Short-Term LUFS (3 s)                            - Brickwall peak limiter
          |                                                 |
          v                                                 v
  [ ActivityDetector ]                           AudioContext.destination
    - Active vs. Silence Gate                       (Audible Playback)
    - 600 ms hold time
          |
          v
  [ NormalizationController ]
    - Target: configurable (default -18.0 LUFS)
    - Deadband: +/- 1.0 LU
    - Asymmetric rates: 10 dB/s attack, 2 dB/s release
    - Bounds: [-18 dB, +12 dB]
```

- [`src/engine/k-weighting.js`](../../src/engine/k-weighting.js): BS.1770-4 K-weighting filter stage.
- [`src/engine/loudness-meter.js`](../../src/engine/loudness-meter.js): Sliding window Momentary & Short-Term LUFS calculator.
- [`src/engine/activity-detector.js`](../../src/engine/activity-detector.js): Silence gate & activity detector.
- [`src/engine/normalization-controller.js`](../../src/engine/normalization-controller.js): Asymmetric rate limiter & deadband controller.
- [`src/engine/audio-engine.js`](../../src/engine/audio-engine.js): Fully integrated per-tab engine.

---

## 3. Benchmark Verification Results

Executed by [`test/test-p2-normalization.mjs`](../../test/test-p2-normalization.mjs):

| Benchmark | Description | Expected Trajectory / Criterion | Result |
|---|---|---|:---:|
| **1. Silence Gating** | Input at $-80\text{ LUFS}$ | Inactive flagged; gain adaptation frozen at $0.0\text{ dB}$; zero gain runaway | **PASS** |
| **2. K-Weighting Response** | $50\text{ Hz}$ & $3\text{ kHz}$ tones | $50\text{ Hz}$ cut $-3.98\text{ dB}$; $3\text{ kHz}$ boosted $+3.81\text{ dB}$ per BS.1770 curve | **PASS** |
| **3. Deadband / Hysteresis** | Inputs within $\pm 1.0\text{ LU}$ ($-17.5$, $-18.8\text{ LUFS}$) | Zero gain hunting; controller holds gain with zero chatter | **PASS** |
| **4. Fast Attenuation** | Loud burst ($-8\text{ LUFS}$, $+10\text{ dB}$ over target) | Attenuates rapidly ($10\text{ dB/s}$) to $-10.0\text{ dB}$ within $1.0\text{ s}$ | **PASS** |
| **5. Gentle Amplification** | Quiet signal ($-28\text{ LUFS}$, $10\text{ dB}$ under target) | Rises smoothly ($2\text{ dB/s}$); reaches $+1.0\text{ dB}$ at $0.5\text{ s}$, converges to $+10.0\text{ dB}$ without overshoot | **PASS** |
| **6. Speech Pauses** | $-24\text{ LUFS}$ speech followed by $2\text{ s}$ pause | Active gain holds steady during pause; background noise is not amplified | **PASS** |
| **7. Bound Clamping** | Extreme inputs ($-60\text{ LUFS}$ and $+5\text{ LUFS}$) | Clamped strictly to $[ -18.0\text{ dB}, +12.0\text{ dB} ]$ | **PASS** |
| **8. Gain Composition** | Auto gain $+4.5\text{ dB}$ with $-3.0\text{ dB}$ and $+6.0\text{ dB}$ manual | Exact algebraic addition: $+1.5\text{ dB}$ and $+10.5\text{ dB}$ | **PASS** |
| **Total** | **P2 Loudness Benchmark Suite** | **16 Benchmarks & Assertions** | **100% PASS** |

---

## 4. Scope and Non-Goals Audit

Confirmation of strict development discipline for P2:
- [x] Perceptual normalization operates independently inside each tab's `AudioEngine`;
- [x] Tab A's loudness is NOT fed into Tab B's controller (preserving Principle A5);
- [x] NO multi-tab orchestration or registry state management implemented (deferred to P3);
- [x] NO product user interface / Popup redesign implemented (deferred to P4);
- [x] Zero external dependencies or native binary requirements.

---

## 5. Recommendation for Phase P3

1. **Gate Decision**: **GO**.
2. **Next Objective**: Implement **P3 — Multi-tab Orchestration**:
   - Establish Managed Tab Registry in Service Worker (`ManagedTab` models, logical states: managed, captured, active);
   - Implement inter-context message protocol (`START_ENGINE`, `STOP_ENGINE`, `SET_TARGET`, `SET_NORMALIZATION`, `SET_MANUAL_OFFSET`, `METRICS_UPDATE`);
   - Implement global vs. per-tab state management;
   - Implement tab lifecycle event observers (tab closure, navigation, audio state change).
