# P2 — Loudness Measurement & Automatic Normalization Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 14)  
> Foundation: `docs/validation/P1_AUDIO_ENGINE_REPORT.md` (P1 Stable Audio Engine)  
> Purpose: provide an authoritative, bounded implementation specification to implement BS.1770 loudness measurement, activity detection, and perceptual automatic normalization.

---

## 1. Authority and Scope

This document specifies the engineering implementation of **P2 — Loudness Measurement & Automatic Normalization**.

P2 builds directly on the stable `AudioEngine` produced in P1, adding perceptual loudness measurement and automatic gain adjustment.

### 1.1 In-Scope Responsibilities

P2 owns:
1. **BS.1770-4 K-Weighting Filter Stage**:
   - Stage 1: High-shelf pre-filter (simulating acoustic head shadowing, ~1.5 kHz boost);
   - Stage 2: High-pass RLB weighting filter (~38 Hz low-cut);
2. **Loudness Metering**:
   - Momentary Loudness ($M$, 400 ms sliding rectangular window);
   - Short-Term Loudness ($S$, 3 s sliding rectangular window);
   - Conversion to LUFS with silence floor;
3. **Activity Detector (Silence Gating)**:
   - Detects active audio vs. silence/speech pauses;
   - Freezes automatic gain adjustments during silence to eliminate noise runaway and breathing/pumping artifacts;
4. **Perceptual Normalization Controller**:
   - Target loudness setting (`targetLufs`, default configurable, e.g. $-18\text{ LUFS}$);
   - Error calculation: $e = \text{targetLufs} - S_{\text{lufs}}$;
   - Configurable deadband / hysteresis (e.g. $\pm 1.0\text{ LU}$);
   - Asymmetric adaptation rates: fast attenuation for loud bursts, gentle gradual release for quiet passages;
   - Bounded automatic gain limits ($[\text{minAutoGainDb}, \text{maxAutoGainDb}]$);
5. **Gain Composition**:
   - Mathematical composition: $\text{effectiveGainDb} = \text{autoGainDb} + \text{manualOffsetDb}$;
6. **Normalization-Aware Safety Hook**:
   - Peak guard ensuring composite gain cannot cause digital clipping ($> 0\text{ dBFS}$);
7. **Deterministic Benchmark Suite**:
   - Synthetic and representative test signals (silence, speech bursts, loud transients, dynamic music, speech pauses).

### 1.2 Explicit Non-Goals for P2

P2 MUST NOT implement:
- Multi-tab cross-tab registry or communication protocol (owned by P3);
- Production UI / Popup design (owned by P4);
- Equalization, multiband compression, or AI enhancement;
- MediaElement fallback backends.

---

## 2. DSP Graph Baseline

```text
[ Captured MediaStream ]
          |
          v
MediaStreamAudioSourceNode
          |
          +-------------------------------------------------+
          | (Observation Branch)                            | (Audio Path Branch)
          v                                                 v
  [ K-Weighting Filters ]                            [ GainProcessor ]
    1. High-Shelf (+4 dB @ 1.5 kHz)                    - effectiveGainDb =
    2. High-Pass (cut < 38 Hz)                             autoGainDb + manualOffsetDb
          |                                            - Click-free smoothing
          v                                                 |
  [ Loudness Meter ]                                        v
    - Momentary (400ms)                               [ SafetyHook ]
    - Short-Term (3s)                                  - Brickwall peak limiter
          |                                                 |
          v                                                 v
  [ Activity Detector ]                          AudioContext.destination
    - Active vs. Silence Gate                       (Audible Playback)
          |
          v
  [ Normalization Controller ]
    - Target error calculation
    - Deadband / Hysteresis
    - Asymmetric attack / release
    - Output: autoGainDb
```

The observation branch and audio path remain completely decoupled: measuring loudness does not distort or color the listening signal.

---

## 3. Mathematical Models & Constants

### 3.1 K-Weighting Filter Coefficients (ITU-R BS.1770-4)

For standard $48\text{ kHz}$ sampling:
- **Stage 1 (High-Shelf Pre-Filter)**:
  $f_0 = 1681.97\text{ Hz}$, $G = +3.9998\text{ dB}$, $Q = 0.7071$
- **Stage 2 (RLB High-Pass Filter)**:
  $f_0 = 38.1355\text{ Hz}$, $Q = 0.5003$

### 3.2 Loudness Calculation

Mean-square energy of K-weighted signal $z[i]$ over window length $N$:
$$z_{\text{rms}}^2 = \frac{1}{N} \sum_{i=0}^{N-1} z[i]^2$$
$$\text{LUFS} = -0.691 + 10 \log_{10}(z_{\text{rms}}^2)$$

### 3.3 Activity Detector (Silence Gate)

$$\text{isActive} = \begin{cases} \text{true}, & \text{if } M_{\text{lufs}} > \text{silenceThresholdLufs} \quad (-50\text{ LUFS}) \\ \text{false}, & \text{otherwise} \end{cases}$$

When $\text{isActive} = \text{false}$:
- Controller freezes adaptation: $\Delta \text{autoGainDb} = 0$;
- Auto-gain remains held at its last stable value, preventing background noise amplification.

### 3.4 Asymmetric Normalization Controller

Error:
$$e = \text{targetLufs} - S_{\text{lufs}}$$

Deadband check:
$$\text{If } |e| \le \text{deadbandDb} \ (1.0\text{ dB}) \implies e_{\text{effective}} = 0$$

Rate limiting (per second):
$$\Delta \text{gain} = \begin{cases} \min(e, \text{attackRateDbPerSec} \times \Delta t), & \text{if } e < 0 \ (\text{too loud, attenuate fast}) \\ \min(e, \text{releaseRateDbPerSec} \times \Delta t), & \text{if } e > 0 \ (\text{too quiet, boost slow}) \end{cases}$$

Default rates:
- $\text{AttackRate} = 10.0\text{ dB/s}$ (fast attenuation);
- $\text{ReleaseRate} = 1.5\text{ dB/s}$ (gentle, natural increase);
- Bounds: $\text{autoGainDb} \in [-18.0\text{ dB}, +12.0\text{ dB}]$.

---

## 4. P2 Work Packages

- **WP0**: K-Weighting Biquad Filter implementation and test harness.
- **WP1**: Sliding window Momentary and Short-Term Loudness Meter (`LoudnessMeter`).
- **WP2**: Activity Detector / Silence Gate (`ActivityDetector`).
- **WP3**: Perceptual Normalization Controller (`NormalizationController`).
- **WP4**: Engine Integration (hooking controller into `AudioEngine`).
- **WP5**: Deterministic Audio Benchmark Suite (11 benchmark classes).
- **WP6**: P2 Validation Report and Gate Decision (`docs/validation/P2_NORMALIZATION_REPORT.md`).

---

## 5. P2 Acceptance Criteria

P2 is **GO** only if:
1. K-weighting filter and LUFS calculation match ITU-R BS.1770 reference signals ($\pm 0.5\text{ LU}$);
2. Silence / inactivity freezes auto-gain with zero gain runaway;
3. Normalization smoothly converges test signals toward `targetLufs` without oscillation or pumping;
4. Asymmetric rates ensure loud signals are restrained quickly and quiet signals rise naturally;
5. Composite gain ($\text{auto} + \text{manual}$) respects safety limiter clamping at $\le 0\text{ dBFS}$;
6. All 11 benchmark classes pass with recorded trajectories.
