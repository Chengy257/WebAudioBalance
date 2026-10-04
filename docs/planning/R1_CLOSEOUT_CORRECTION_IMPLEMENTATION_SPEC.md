# R1 Closeout Correction — Implementation Specification

> Status: **FROZEN CORRECTION SPEC**  
> Frozen Date: **2026-10-04**  
> Parent: `docs/planning/R1_AUDIO_CORE_CORRECTION_IMPLEMENTATION_SPEC.md`  
> Trigger: independent post-implementation review of commit `3fb2b9ce6ec1929af0eb5ead84b69b15c989fd73`  
> Scope: targeted R1 closeout correction only. This document does not reopen R0 or redesign R1.

---

## 1. Decision

The R1 implementation is **substantially complete but not yet accepted as R1 GO**.

The following R1 claims remain valid:

- continuous AudioWorklet PCM metering exists;
- production and tests share the same K-weighting/loudness core;
- the persistent source-error integrator has been replaced with a desired-gain controller;
- input and processed-output loudness meters exist;
- stable multi-engine convergence is demonstrated.

R1 closeout is blocked by one safety implementation defect and several validation gaps.

R2 MUST NOT begin implementation until this correction spec passes.

---

## 2. Blocking defects

### C1 — safety cap is not a hard applied-gain constraint

Current behavior computes a headroom-constrained target but then moves toward that target using the normal attenuation rate.

This permits:

```text
previous applied gain = +8 dB
new safe maximum      = -1 dB
normal attack rate    = 8 dB/s
control dt            = 0.1 s

next applied gain ~= +7.2 dB
```

The state may report `isLimited=true`, while the actually applied gain still exceeds the calculated safety envelope.

This violates the frozen rule:

> headroom safety is a hard constraint; the tail compressor is only an emergency fallback.

### C2 — relative-offset setter can bypass safety recomputation

`AudioEngine.setManualOffsetDb()/setRelativeOffsetDb()` currently updates the controller and immediately applies `controller.getState().appliedGainDb`.

A positive user offset may therefore increase actual gain before fresh peak/headroom evaluation.

### C3 — browser safety evidence does not exercise the claimed high-peak case

The browser validation currently tests a quiet sine plus a large relative offset. That can prove configured max-gain limiting, but it is not the low-average/high-peak headroom fixture described in the validation report.

The browser test must explicitly prove `limitReason=headroom`.

### C4 — required dynamic/resume hard gates are not fully browser end-to-end

The current controller simulations cover dynamics and silence, but R1 frozen acceptance requires real AudioEngine/AudioWorklet evidence for:

- loud -> quiet -> loud source transition;
- long silence -> resume;
- resume to much louder content;
- resume to much quieter content.

### C5 — `rmsDbFS` compatibility alias is semantically invalid

Current AudioEngine emits:

```text
rmsDbFS = inputShortTermLufs
```

LUFS and RMS dBFS are different quantities. This false alias must be removed.

---

## 3. Required code correction

### 3.1 Separate normal convergence from hard safety enforcement

The controller shall maintain two concepts:

```text
normalTargetGainDb
hardSafeMaximumGainDb
```

Normal loudness adaptation remains smoothed:

```text
smoothedCandidateGain =
    moveToward(currentGain, normalTargetGain, attack/release)
```

Actual gain must then obey the hard envelope:

```text
appliedGainDb =
    min(smoothedCandidateGain, hardSafeMaximumGainDb)
```

plus the configured lower/upper gain bounds.

If the current gain already exceeds a newly calculated hard maximum, the safety reduction MUST take precedence over the normal 8 dB/s attack rule.

The implementation may use a very short anti-click ramp at the `GainProcessor` layer, but it must not retain an unsafe dB target for multiple normal controller cycles.

### 3.2 Controller state consistency after a hard clamp

When safety clamps the actual total gain:

- `appliedGainDb` must equal the safe value;
- `appliedAutoGainDb` must remain internally consistent with `appliedGainDb - relativeOffsetDb`;
- `isLimited=true`;
- `limitReason=headroom` or the appropriate configured gain-bound reason;
- later relaxation of the safety constraint may increase gain only through the normal slow amplification/release path.

This avoids an internal state that says one gain while the GainNode applies another.

### 3.3 Relative-offset safety rule

A negative relative-offset change may be applied immediately because it reduces gain.

A positive relative-offset change MUST NOT bypass the latest safety envelope.

Accepted behavior:

1. update the requested relative offset;
2. use the latest valid peak/headroom envelope if available;
3. clamp the immediate applied value to that envelope;
4. if no valid peak measurement exists, do not perform a positive immediate jump; wait for the next valid control cycle.

The normal control cycle must remain the canonical authority for positive gain increases.

### 3.4 GainProcessor application

When a new hard safety cap is lower than the currently scheduled/applied gain:

- cancel the existing upward/normal ramp;
- schedule a short safe downward ramp;
- do not wait for the ordinary normalization rate.

The exact emergency-ramp duration may be tuned during validation, but should be short enough to enforce safety and long enough to avoid an obvious click.

### 3.5 RMS compatibility field

Do not emit LUFS under the name `rmsDbFS`.

Preferred minimal correction:

- restore `EngineeringMeter` only as a non-authoritative diagnostic RMS/peak observation branch; or
- explicitly deprecate/remove `rmsDbFS` from the R1 canonical payload if historical tests/consumers tolerate it.

If retained, `rmsDbFS` must be a real RMS dBFS measurement.

It must never participate in normalization decisions.

---

## 4. Required browser validation additions

Extend the real Chromium browser harness rather than adding only controller simulations.

### B1 — immediate headroom transition

Establish a positive boost first, then switch the same engine to a low-average/high-peak source.

Required assertions on the first control interval after valid dangerous-peak observation:

- `isLimited === true`;
- `limitReason === "headroom"`;
- actual `appliedGainDb <= hardSafeMaximumGainDb + small numerical tolerance`;
- the output path remains bounded;
- the test does not wait 1–2 seconds before first judging safety.

### B2 — positive relative-offset under limited headroom

While a high-peak source is active:

- increase relative offset substantially;
- verify the request changes;
- verify the actual gain does not jump above the current safety envelope;
- verify `isLimited` remains truthful.

### B3 — dynamic source transition

At least one real AudioEngine must execute:

```text
~ -10 LUFS
-> ~ -22 LUFS
-> ~ -8 LUFS
```

Required:

- output reconverges to the effective target after each transition;
- attenuation is faster than amplification;
- another independent engine remains stable;
- no gain runaway occurs.

### B4 — silence/resume

Real AudioEngine + AudioWorklet cases:

- active -> short pause -> same source;
- active -> long silence -> same-level resume;
- active -> long silence -> much louder resume;
- active -> long silence -> much quieter resume.

Required:

- long silence invalidates/reacquires the control epoch;
- no silence-driven positive runaway;
- louder resume is protected immediately;
- quieter resume does not receive a large positive boost before fresh active-window validity;
- final processed output reconverges.

### B5 — mono browser path

Create a true one-channel MediaStream path and verify:

- channel count is treated as mono by the production meter;
- the production AudioWorklet output matches the mono reference tolerance;
- no implicit stereo duplication creates a +3 LU bias.

---

## 5. Unit-test additions

Add focused regression tests for:

- current gain above newly reduced safety envelope;
- safety relaxation after clamp grows only at release rate;
- positive relative-offset does not bypass safety;
- negative relative-offset can reduce gain immediately;
- controller internal gain fields remain mutually consistent after clamp;
- `rmsDbFS` is either a true RMS measurement or absent/deprecated, never LUFS.

Do not replace browser cases B1–B5 with unit tests.

---

## 6. Validation report correction

Before rerun, change the current R1 validation report status to:

```text
R1 CLOSEOUT REVIEW — CORRECTION REQUIRED / GO WITHHELD
```

After fixes, regenerate the evidence sections rather than merely appending “fixed”.

The corrected report must clearly distinguish:

- controller simulation evidence;
- real AudioWorklet/AudioEngine browser evidence;
- headroom-limited fixture evidence;
- max-gain-limited fixture evidence.

Do not combine measurements from different fixtures into one claimed scenario.

---

## 7. R1 closeout hard gate

R1 becomes **GO / FROZEN** only if all original R1 gates plus these correction gates pass.

Required closeout state:

```text
continuous loudness          PASS
steady absolute convergence  PASS
no-runaway                   PASS
relative target              PASS
hard headroom envelope       PASS
positive-offset safety       PASS
dynamic browser transition   PASS
silence/resume browser path  PASS
mono browser path            PASS
metric semantic integrity    PASS
```

Only then may the project proceed to R2 implementation.

---

## 8. Codex correction order

```text
1. Fix controller hard-safety envelope semantics
2. Fix positive relative-offset application path
3. Correct/deprecate rmsDbFS compatibility field
4. Add unit safety-transition regressions
5. Add browser B1/B2 headroom tests
6. Add browser B3 dynamic transition
7. Add browser B4 silence/resume
8. Add browser B5 mono path
9. Rerun R1 + historical regression suites
10. Rewrite R1 validation report from actual evidence
```

No R2/R3 implementation belongs in this correction commit series.
