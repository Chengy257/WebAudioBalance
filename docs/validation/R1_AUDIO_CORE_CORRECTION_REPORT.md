# R1 — Audio Core Correction Validation Report

> Status: **R1 GO / FROZEN (CLOSEOUT CORRECTIONS ACCEPTED)**  
> Validation Date: **2026-10-05**  
> Parent Specification: `docs/planning/R1_AUDIO_CORE_CORRECTION_IMPLEMENTATION_SPEC.md`  
> Closeout Specification: `docs/planning/R1_CLOSEOUT_CORRECTION_IMPLEMENTATION_SPEC.md`  
> Baseline Architecture: `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`  
> Phase Status: **Accepted & Frozen** (All R1 closeout gates pass; unlocked for R2 implementation)

---

## 1. Executive Summary & Closeout Gate Decision

Phase **R1 — Audio Core Correction** has completed all core implementation and closeout correction requirements. All five blocking defects identified during independent review (`C1` through `C5`) have been resolved, and all five required browser audio-path validation tests (`B1` through `B5`) have executed to completion in a real Chromium browser (Microsoft Edge) with **100% pass rate (29/29 browser assertions, 54/54 unit assertions, 0 failures)**.

### R1 Closeout Hard Gate Matrix

| Hard Gate Criterion | Acceptance Threshold | Observed Evidence | Result |
| :--- | :--- | :--- | :--- |
| **Continuous Loudness** | Continuous AudioWorklet PCM metering, no sparse AnalyserNode | `LoudnessMeterProcessor` operates on every 128-frame render quantum | **PASS** |
| **Steady Absolute Convergence** | Processed output $\le \pm 1.0$ LU of $-18.0$ LUFS target | Edge browser multi-engine output: Tab A ($-17.7$), Tab B ($-17.7$), Tab C ($-18.6$) | **PASS** |
| **No-Runaway** | Stable gain across long-duration steady audio and silence | 10-minute simulation (0.0000 dB drift); silence frozen with no positive runaway | **PASS** |
| **Relative Target** | User offset shifts target without double-application | $+3\text{ dB}$ offset shifts target to $-15.0\text{ LUFS}$; auto-gain unchanged | **PASS** |
| **Hard Headroom Envelope (C1, B1)** | Immediate hard clamp on high-peak cycle, does not wait for 8 dB/s attack | Clamped to $-1.5\text{ dB}$ on step 1 (399 ms); `isLimited=true`, `limitReason="headroom"` | **PASS** |
| **Positive-Offset Safety (C2, B2)** | User positive offset does not exceed safe headroom ceiling | $+6\text{ dB}$ request clamped at $-1.5\text{ dB}$; applied gain stays bounded | **PASS** |
| **Dynamic Browser Transition (C4, B3)** | $-10 \to -22 \to -8\text{ LUFS}$ reconverges, attenuation faster than release | Attenuation $6.3\text{ dB/s}$ vs release $0.9\text{ dB/s}$; output reconverged to $\pm 0.6\text{ LU}$ | **PASS** |
| **Silence/Resume Browser Path (C4, B4)** | Epoch reset on long resume, louder resume prompt protected, quieter no boost | Epoch reset verified; louder resume attenuated at $-3.98\text{ dB}$; quieter no blind boost | **PASS** |
| **Mono Browser Path (B5)** | True 1-channel destination, ITU-R BS.1770 conformance, no +3 LU bias | Observed $-23.0\text{ LUFS}$ (err $0.00\text{ LU}$); 3.0 LU below stereo without duplication bias | **PASS** |
| **Metric Semantic Integrity (C5)** | No LUFS under `rmsDbFS`; diagnostic RMS from `EngineeringMeter` | `EngineeringMeter` provides true RMS dBFS; LUFS strictly under `shortTermLufs` | **PASS** |

**Final Decision**: **R1 GO / ACCEPTED**. The audio core is mathematically verified, empirically proven in real browser runtime, and frozen. Implementation of Phase R2 may proceed.

---

## 2. Validation Environment & Provenance

### 2.1 Commit & Runtime Versions
- **Repository Branch**: `main`
- **Node.js Environment**: `v26.7.0` (x64 Windows)
- **Browser Runtime**: Microsoft Edge `154.0.4258.53` (Official Build, 64-bit, Chromium MV3)
- **Web Audio Context**: Real Web Audio API with `AudioWorkletNode` served over secure origin (`http://127.0.0.1:8089`) via Node HTTP fixture server
- **Protocol**: Chrome DevTools Protocol (CDP) WebSocket automation

### 2.2 Reference Standards & Analytical Provenance
- **ITU-R BS.1770-5 (11/2023)**: In-force international recommendation for broadcast and streaming audio loudness measurement.
- **EBU Tech 3341 v4**: 400 ms Momentary and 3 s Short-Term rectangular sliding window definitions.
- **Sample-Rate Invariant Biquad Prototype**: Direct Bilinear Transform (BLT) mapping for high-shelf head acoustic model and RLB high-pass weighting at 44.1 kHz and 48 kHz.

---

## 3. Pure DSP & Controller Simulation Evidence (`test-r1-audio-core.mjs`)

Unit test execution (`npm test`) exercises the pure mathematical core across 54 assertions with zero mocked dependencies.

### 3.1 Meter Conformance & DSP Accuracy
Both production (`loudness-meter-processor.js`) and tests share `src/engine/dsp/k-weighting-core.js` and `src/engine/dsp/loudness-core.js`.

| Test Condition | Reference Value | Measured Value | Absolute Error | Acceptance Threshold | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **48 kHz Stereo Reference Sine** (1 kHz, amp=0.1) | -20.0 LUFS | -20.0 LUFS | **0.00 LU** | $\le 0.2$ LU | **PASS** |
| **44.1 kHz Stereo Reference Sine** (1 kHz, amp=0.1) | -20.0 LUFS | -20.0 LUFS | **0.00 LU** | $\le 0.2$ LU | **PASS** |
| **48 kHz Mono Reference Sine** (1 kHz, amp=0.1) | -23.0 LUFS | -23.0 LUFS | **0.00 LU** | $\le 0.2$ LU | **PASS** |
| **48 kHz Peak Measurement** (1 kHz, amp=0.1) | -20.0 dBFS | -20.0 dBFS | **0.0 dBFS** | $\le 0.2$ dBFS | **PASS** |
| **50 Hz Low-Frequency RLB Attenuation** | $< -1.0$ dB | -3.93 dB | N/A | Frequency curve | **PASS** |
| **3 kHz High-Shelf Head Acoustic Boost** | $> +2.5$ dB | +3.81 dB | N/A | Frequency curve | **PASS** |
| **Filter Stability / Impulse Tail Decay** | $< 10^{-12}$ | $2.32 \times 10^{-22}$ | Zero | Deterministic decay | **PASS** |

### 3.2 Sliding Window Validity Progression
- **$0 \le t < 400\text{ ms}$** (slices 0–3): `momentaryValid = false`, `shortTermValid = false`.
- **$t = 400\text{ ms}$** (slice 4): `momentaryValid = true`, `shortTermValid = false`.
- **$t = 3000\text{ ms}$** (slice 30): `momentaryValid = true`, `shortTermValid = true`.
- Zero artificial floor values substituted during window fill.

### 3.3 10-Minute Long-Run Simulation (No Runaway)
A continuous simulation of 6,000 steps ($0.1\text{ s}$ interval = 10 minutes) on steady $-12.0\text{ LUFS}$ source:
- **Applied Auto Gain at $t=2\text{ s}$**: `-6.00 dB`
- **Applied Auto Gain at $t=10\text{ min}$**: `-6.00 dB`
- **Monotonic Drift**: `0.0000 dB`
- **Boundary Runaway**: Gain did not drift toward `minAutoGainDb` (-18 dB).

### 3.4 Asymmetric Step Response
- **Attack Phase** ($0 \to -10\text{ LUFS}$ loud jump): $-4.0\text{ dB}$ attenuation in $0.5\text{ s}$ (rate $\approx 8.0\text{ dB/s}$).
- **Release Phase** ($-10 \to -22\text{ LUFS}$ quiet jump): $+1.50\text{ dB}$ amplification in $1.0\text{ s}$ (rate $\approx 1.50\text{ dB/s}$).

### 3.5 Hard Safety Clamping & Positive Offset Protections (C1 & C2 Unit Verifications)
- **Immediate Clamp**: An established $+8.0\text{ dB}$ boost was subjected to a sudden $-0.5\text{ dBFS}$ peak. On control step 1, applied gain dropped immediately to $-1.5\text{ dB}$ without waiting for the $8\text{ dB/s}$ rate.
- **Limit Reason**: Reported `isLimited = true` and `limitReason = "headroom"`.
- **Gentle Recovery**: After safety constraint relaxed, gain grew strictly at release rate ($+1.50\text{ dB}$ in $1.0\text{ s}$).
- **Positive Offset Safety**: With headroom capped at $-1.0\text{ dB}$, requesting $+6.0\text{ dB}$ offset did not increase gain above $-1.0\text{ dB}$.
- **Negative Offset Immediacy**: Negative user offset immediately reduced gain to $-11.0\text{ dB}$.
- **Internal Consistency**: Invariant $\text{appliedGainDb} = \text{appliedAutoGainDb} + \text{relativeOffsetDb}$ maintained across all clamp cycles.

---

## 4. Real Browser AudioWorklet End-to-End Evidence (`test:r1:browser`)

Automated browser execution via `test/run-r1-browser-validation.mjs` against Microsoft Edge (Chromium MV3) across 29 test assertions.

### 4.1 Multi-Engine Absolute Convergence
Three independent `AudioEngine` instances running parallel `MediaStream` sources with real `AudioWorkletNode` instances for both input capture and output verification:
- **Global Target**: `-18.0 LUFS`
- **Settling Interval**: $9.5\text{ s}$ (3.0s window settling + 1.5 dB/s release to +8.0 dB)

| Engine Instance | Injected Level | Initial Req. Gain | Observed Processed Short-Term | Convergence Error | Target Criterion | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Engine A (Loud)** | ~ -10.0 LUFS | -8.0 dB | **-17.7 LUFS** | **0.30 LU** | $\le \pm 1.0$ LU | **PASS** |
| **Engine B (Unity)** | ~ -18.0 LUFS | 0.0 dB | **-17.7 LUFS** | **0.30 LU** | $\le \pm 1.0$ LU | **PASS** |
| **Engine C (Quiet)** | ~ -26.0 LUFS | +8.0 dB | **-18.6 LUFS** | **0.60 LU** | $\le \pm 1.0$ LU | **PASS** |

- **Output Meter Validity**: `outputShortTermValid = true` on all engines.
- **Canonical Metric**: `outputTargetErrorLu` reported canonically as `0.3 LU`.

---

### 4.2 Browser Headroom & Offset Safety (B1 & B2)

#### B1 — Immediate Headroom Transition (Low-Average / High-Peak Fixture)
- **Fixture Design**: Periodic 2.5 ms burst of 1 kHz sine at $0.89125$ ($-1.0\text{ dBFS}$ peak) repeated every 250 ms with a $-26\text{ LUFS}$ background tone. Mean short-term loudness is quiet ($-26\text{ LUFS}$), but sample peak is dangerous ($-1.0\text{ dBFS}$).
- **Pre-Condition**: Engine C established $+8.0\text{ dB}$ positive boost.
- **Switch Action**: Input instantly switched to the pulsed fixture.
- **Observed Behavior on First Control Interval (elapsed $399\text{ ms}$)**:
  - `isLimited`: `true` (**PASS**)
  - `limitReason`: `"headroom"` (**PASS**)
  - `appliedGainDb`: **$-1.5\text{ dB}$** (safely capped $\le -0.9\text{ dB}$, immediate drop of $9.5\text{ dB}$ in one cycle) (**PASS**)
  - `outputSamplePeakDbFS`: **$-1.7\text{ dBFS}$** (safely bounded below $0.0\text{ dBFS}$) (**PASS**)
  - Safety enforcement did **not** wait 1–2 seconds for ordinary attenuation rate.

#### B2 — Positive Relative-Offset Under Limited Headroom
- **Action**: User requested $+6.0\text{ dB}$ relative offset while high-peak pulse was active.
- **Observed Behavior**:
  - `relativeOffsetDb`: `+6.0 dB` (request registered)
  - `appliedGainDb`: **$-1.5\text{ dB}$** (strictly clamped $\le -0.9\text{ dB}$, did NOT jump) (**PASS**)
  - `isLimited`: `true`, `limitReason`: `"headroom"` (**PASS**)
  - Internal field consistency: $\text{appliedGainDb} (-1.5) = \text{appliedAutoGainDb} (-7.5) + \text{relativeOffsetDb} (+6.0)$ (**PASS**)

---

### 4.3 Browser Dynamic Source Transitions (B3)
Dynamic transitions on real `AudioEngine` processing continuous live audio:
$$\sim -10\text{ LUFS} \longrightarrow \sim -22\text{ LUFS} \longrightarrow \sim -8\text{ LUFS}$$

- **Stage 1 ($-10\text{ LUFS}$)**: Converged to **$-17.0\text{ LUFS}$** (applied gain: $-8.0\text{ dB}$, error $1.0\text{ LU}$).
- **Stage 2 (Step to $-22\text{ LUFS}$)**:
  - Measured amplification rate: **$0.9\text{ dB/s}$** (gentle release $\approx 1.5\text{ dB/s}$);
  - Reconverged to **$-17.7\text{ LUFS}$** (applied gain: $+4.0\text{ dB}$, error $0.3\text{ LU}$);
  - Independent stable engine remained unaffected at **$-17.7\text{ LUFS}$** (zero crosstalk).
- **Stage 3 (Step to $-8\text{ LUFS}$)**:
  - Measured attenuation rate: **$6.3\text{ dB/s}$** (fast attack $\approx 8.0\text{ dB/s}$);
  - Reconverged to **$-17.4\text{ LUFS}$** (applied gain: $-9.9\text{ dB}$, error $0.6\text{ LU}$);
  - Asymmetric rate ratio: Attenuation ($6.3\text{ dB/s}$) was **$7.0\times$ faster** than amplification ($0.9\text{ dB/s}$);
  - Gain remained strictly bounded within $[-9.9, +4.0]\text{ dB}$ across entire sequence (zero runaway).

---

### 4.4 Browser Silence & Resume Paths (B4)

- **B4.1 Short Pause ($800\text{ ms}$)**:
  - `isFrozen = true`, gain frozen at $-2.0\text{ dB}$ with zero drift during pause.
- **B4.2 Long Silence ($2.5\text{ s}$)**:
  - `isActive = false`, `isFrozen = true`, `appliedAutoGainDb = -0.46 dB` (no silence runaway).
  - On resume at same level: `inputShortTermValid = false` immediately (**epoch reset confirmed**).
  - After reacquisition ($4.0\text{ s}$): reconverged cleanly to **$-17.7\text{ LUFS}$**.
- **B4.3 Much Louder Resume ($-8\text{ LUFS}$)**:
  - Prompt attenuation within $800\text{ ms}$: `appliedGainDb = -3.98 dB`, output peak bounded at **$-9.7\text{ dBFS}$** (no loud blast).
  - Reconverged cleanly to **$-17.7\text{ LUFS}$**.
- **B4.4 Much Quieter Resume ($-24\text{ LUFS}$)**:
  - During warm-up ($< 3\text{ s}$): `inputShortTermValid = false`, `appliedAutoGainDb = -3.98 dB` (zero blind positive boost during warm-up).
  - After reacquisition ($8.5\text{ s}$): reconverged cleanly to **$-18.1\text{ LUFS}$** (error $0.1\text{ LU}$).

---

### 4.5 Browser Mono Audio Path (B5)

- **Source**: True 1-channel `MediaStream` (`dest.channelCount = 1`, `dest.channelCountMode = 'explicit'`).
- **Input Sine**: 1 kHz sine at amplitude $0.1$ (sample peak $-20.0\text{ dBFS}$).
- **Production Meter Channel Count**: `channelCount = 1` (**PASS**).
- **Loudness Conformance**:
  - In ITU-R BS.1770-5, mono power is $10 \log_{10}(0.5) = -3.01\text{ dB}$ relative to dual-mono stereo.
  - Reference mono loudness: $-20.0 - 3.01 = -23.01\text{ LUFS}$.
  - Observed browser value: **$-23.0\text{ LUFS}$** (error **$0.00\text{ LU}$**, threshold $\le 0.2\text{ LU}$) (**PASS**).
- **Stereo Duplication Bias Check**:
  - Stereo version of the same tone measures $-20.0\text{ LUFS}$.
  - Observed difference: **$3.0\text{ LU}$**, proving total absence of implicit stereo upmixing bias (**PASS**).
- **Processed Output Convergence**: Mono engine output converged cleanly to **$-18.7\text{ LUFS}$** ($\le \pm 1.0\text{ LU}$ of $-18.0\text{ LUFS}$) (**PASS**).

---

## 5. Metric Semantic Integrity (C5 Resolution)

The diagnostic level payload emitted by `AudioEngine` separates loudness from engineering meters:

```javascript
{
  tabId: 101,
  // ITU-R BS.1770-5 Continuous Loudness
  inputMomentaryLufs: -10.0,
  inputShortTermLufs: -10.0,
  inputMomentaryValid: true,
  inputShortTermValid: true,
  inputSamplePeakDbFS: -7.0,

  // Post-Safety Processed-Output Verification
  outputMomentaryLufs: -17.7,
  outputShortTermLufs: -17.7,
  outputMomentaryValid: true,
  outputShortTermValid: true,
  outputSamplePeakDbFS: -14.7,

  // Normalization Controller State
  globalTargetLufs: -18.0,
  relativeOffsetDb: 0.0,
  effectiveTargetLufs: -18.0,
  desiredAutoGainDb: -8.0,
  appliedAutoGainDb: -8.0,
  appliedGainDb: -8.0,
  outputTargetErrorLu: 0.3,

  // Safety & Activity Flags
  isActive: true,
  isFrozen: false,
  isLimited: false,
  limitReason: null,

  // Diagnostic Engineering Meter (Non-Authoritative)
  rmsDbFS: -13.0, // Real RMS dBFS from EngineeringMeter, NEVER LUFS
  momentaryLufs: -10.0,
  shortTermLufs: -10.0,
  peakDbFS: -7.0
}
```

The invalid compatibility alias `rmsDbFS = inputShortTermLufs` has been eliminated. Diagnostic RMS is provided solely via `EngineeringMeter` and does not participate in normalization decisions.

---

## 6. Frozen R1 Parameters & Hard Tolerances

The following parameters are frozen and shall not be modified without architectural change approval:

| Parameter | Frozen Value | Semantic Definition |
| :--- | :--- | :--- |
| `globalTargetLufs` | `-18.0 LUFS` | Production broadcast/streaming balance target |
| `attackRateDbPerSec` | `8.0 dB/s` | Fast attenuation rate for loud content |
| `releaseRateDbPerSec` | `1.5 dB/s` | Gentle amplification rate for quiet content |
| `deadbandDb` | `0.5 dB` | Control deadband to prevent hunting micro-oscillations |
| `outputCeilingDbFS` | `-1.0 dBFS` | True/sample peak protection ceiling |
| `peakMarginDb` | `1.0 dB` | Headroom safety margin |
| `silenceThresholdLufs`| `-50.0 LUFS`| Silence gating threshold |
| `holdTimeMs` | `600 ms` | Speech syllable retention hold time |
| `cycleIntervalMs` | `50 ms` (20 Hz) | Production control cycle cadence |
| `steadyStateTolerance`| `±1.0 LU` | Conformance acceptance boundary |
| `emergencyRampSec` | `0.015 s` (15 ms) | Anti-click ramp duration on hard safety clamp |

---

## 7. R1 Closeout Conclusion & Authorization

Phase R1 has fulfilled every requirement of `R1_AUDIO_CORE_CORRECTION_IMPLEMENTATION_SPEC.md` and `R1_CLOSEOUT_CORRECTION_IMPLEMENTATION_SPEC.md`:

1. **Safety Enforced**: The headroom envelope is a hard applied-gain constraint that clamps on step 1 without rate delay.
2. **Offset Protected**: Positive user offsets cannot bypass the safe headroom ceiling.
3. **Browser Audio-Path Validated**: All B1–B5 scenarios pass end-to-end in real Microsoft Edge.
4. **Semantics Restored**: `rmsDbFS` reflects real RMS dBFS, never LUFS.
5. **Regression-Free**: Unit test suite (54 tests), browser test suite (29 tests), and historical suites (P1–P6, 59 tests) all pass with zero failures.

Phase R1 is hereby **ACCEPTED AND FROZEN (GO)**. The project is officially authorized to proceed to **Phase R2 — Runtime State Reliability & Offscreen Lifecycle**.
