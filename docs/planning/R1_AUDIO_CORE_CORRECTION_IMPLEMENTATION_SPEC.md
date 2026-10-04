# R1 — Audio Core Correction Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Frozen Date: **2026-10-04**  
> Parent baseline: `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`  
> Phase: **R1 — Audio Core Correction**  
> Purpose: correct the production loudness measurement and normalization loop, establish processed-output verification, and rebuild deterministic audio evidence before runtime-state or UI work proceeds.

---

## 1. Authority and phase boundary

This document is the authoritative implementation specification for **R1 — Audio Core Correction**.

It implements the R0-frozen product promise:

> Every user-enabled tab is independently normalized toward a shared absolute perceptual loudness target, with a per-tab relative target offset, while safety remains a hard constraint.

R1 owns the audio-core implementation only. It MUST NOT reopen the R0 product definition and MUST NOT absorb R2/R3 responsibilities merely because neighboring code currently contains defects.

### 1.1 In scope

R1 owns:

- continuous PCM loudness measurement;
- a production/test-shared K-weighting DSP implementation;
- correct 400 ms Momentary and 3 s Short-Term windows;
- input loudness measurement;
- bounded feed-forward normalization targeting;
- asymmetric temporal convergence;
- activity/silence freeze and resume reacquisition;
- peak/headroom-aware gain constraints;
- processed-output loudness verification;
- authoritative per-engine audio metrics;
- deterministic audio fixtures and browser audio-path validation;
- migration away from misleading P2 production paths;
- an R1 validation/closeout report based on observed processed output.

### 1.2 Explicitly out of scope

R1 MUST NOT implement:

- Service Worker ↔ Offscreen authoritative-state reconciliation;
- Popup message-schema redesign;
- command ACK/NACK propagation across extension contexts;
- tab metadata or detected-tab UI fixes;
- Popup UX redesign;
- metrics IPC throttling across extension contexts beyond what is strictly necessary to expose new audio-core metrics;
- real-site compatibility claims;
- Chrome/Edge full product release validation;
- Integrated Loudness, Loudness Range, or broadcast workflow features;
- Firefox/Safari;
- EQ, spatial audio, compressor presets, or unrelated DSP features.

Those belong to R2/R3 or later work.

---

## 2. Standards and terminology baseline

R1 shall use the current loudness-measurement baseline rather than retain stale BS.1770-4 branding.

### 2.1 Reference standards

Authoritative references:

- ITU-R BS.1770-5 (11/2023), current in-force recommendation:
  https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
- EBU Tech 3341 v4 (November 2023), loudness metering:
  https://tech.ebu.ch/docs/tech/tech3341.pdf

R1 specifically adopts:

- K-weighted programme loudness measurement principles from BS.1770;
- Momentary Loudness as a **0.4 s sliding rectangular window**;
- Short-Term Loudness as a **3 s sliding rectangular window**;
- a live measurement update cadence of **at least 10 Hz**.

### 2.2 Compliance wording

R1 is a product normalization implementation, not a broadcast meter certification project.

Therefore:

- production/test behavior must be numerically validated against independent reference fixtures;
- documentation may say **BS.1770-5-aligned loudness measurement** only after the R1 conformance gate passes;
- documentation MUST NOT claim complete BS.1770-5 or complete EBU Mode compliance unless all claimed portions are actually implemented and validated;
- R1 does not require Integrated Loudness or LRA;
- if R1 uses sample peak with a conservative headroom margin, it MUST call it **sample peak**, not true peak.

---

## 3. Current defect map and required disposition

The following current implementation paths are specifically superseded by R1.

### 3.1 `src/engine/loudness-meter.js`

Current behavior:

- samples `AnalyserNode.fftSize = 2048`;
- is polled approximately every 100 ms;
- treats four sampled buffers as ~400 ms;
- treats thirty sampled buffers as ~3 s.

This does not represent continuous 400 ms / 3 s audio coverage.

**R1 disposition:** rewrite the production meter as a wrapper around continuous PCM processing. Sparse `AnalyserNode` sampling must no longer be authoritative for loudness.

### 3.2 `src/engine/k-weighting.js`

Current production path uses Web Audio `BiquadFilterNode` approximations, while tests exercise separate hard-coded pure-JS coefficients.

**R1 disposition:** production and tests must execute the same sample-rate-aware pure DSP core. No second “test-only” K-weighting algorithm may be used as proof of the production path.

### 3.3 `src/engine/normalization-controller.js`

Current behavior repeatedly performs:

```text
autoGain += target - input
```

while `input` is measured before gain. A constant source-level error therefore persists even after gain has already corrected the audible output.

**R1 disposition:** replace persistent error integration with a bounded desired-gain model.

### 3.4 `src/engine/audio-engine.js`

Current graph has:

- pre-gain source loudness measurement only;
- no processed-output verification meter;
- controller driven by the flawed sparse meter;
- reported `Balanced`-relevant values derived from source rather than verified output.

**R1 disposition:** implement separate input and post-safety output metering and expose both measurement domains.

### 3.5 `src/engine/safety.js`

Current `DynamicsCompressorNode` is an emergency tail-stage guard but does not constrain requested boost before gain is applied.

**R1 disposition:** retain an emergency guard if useful, but add explicit headroom-aware gain constraint logic before/at gain application. The limiter/compressor must not be the sole safety policy.

### 3.6 Historical P2 tests

`test/test-p2-normalization.mjs` remains useful as historical regression evidence but does not prove processed-output convergence.

**R1 disposition:** add new R1 tests. Do not rewrite history by relabeling P2 tests as R1 evidence.

---

## 4. Frozen R1 architecture

The R1 per-tab audio graph is:

```text
Captured Tab Source
        |
        +---------------------> Input Continuous Loudness Meter
        |                               |
        |                               v
        |                       Control Measurement
        |                               |
        v                               v
  GainProcessor <-------------- Normalization Controller
        |
        v
  Safety / Emergency Guard
        |
        +---------------------> Output Verification Meter
        |
        v
 AudioContext.destination
```

The two loudness meters are observation branches. They MUST NOT unnecessarily sit inline in the audible path.

### 4.1 One production DSP core

K-weighting, energy accumulation, windowing, LUFS conversion, and peak accumulation must live in reusable pure-JavaScript DSP modules that:

- can run inside an `AudioWorkletProcessor`;
- can run directly in Node/browser test harnesses;
- do not depend on DOM, `window`, extension APIs, or UI state;
- do not allocate unbounded memory.

This eliminates production/test algorithm divergence.

---

## 5. Continuous loudness measurement design

### 5.1 Required implementation shape

Preferred repository structure:

```text
src/engine/
  dsp/
    biquad-core.js
    k-weighting-core.js
    loudness-core.js
  worklets/
    loudness-meter-processor.js
  loudness-meter.js
```

Equivalent naming is acceptable only if responsibilities remain equally clear.

### 5.2 AudioWorklet responsibilities

`loudness-meter-processor.js` shall:

1. receive every PCM render quantum delivered to the worklet;
2. apply the shared K-weighting core per supported channel;
3. accumulate contiguous weighted energy;
4. accumulate sample peak continuously;
5. emit one complete measurement slice every ~100 ms;
6. maintain or feed sufficient state for 400 ms Momentary and 3 s Short-Term windows;
7. never use `setInterval` for sample acquisition;
8. avoid per-render-quantum object/array churn where practical.

The worklet may compute the final windows itself or send continuous 100 ms energy slices to the wrapper, provided the 0.4 s / 3 s windows remain contiguous and exact with respect to those slices.

### 5.3 Window implementation

A simple accepted design is:

```text
continuous PCM
  -> exact contiguous ~100 ms energy slices
  -> last 4 slices  = 400 ms Momentary
  -> last 30 slices = 3 s Short-Term
```

At each actual AudioContext sample rate, slice boundaries must be based on frame counts, not wall-clock timer assumptions.

Required validity state:

```text
momentaryValid = false until 400 ms of contiguous samples exist
shortTermValid = false until 3 s of contiguous samples exist
```

R1 MUST NOT substitute fabricated floor values such as `-100 LUFS` for “valid quiet measurement” when the real state is “window not yet valid”. A numeric floor may still be reported separately for display compatibility, but validity must be explicit.

### 5.4 Sample-rate handling

The production DSP core must derive its coefficients/state from the actual `AudioContext.sampleRate`.

At minimum R1 conformance tests must cover:

- 44.1 kHz;
- 48 kHz.

Any implementation that silently uses 48 kHz coefficients at all rates fails R1.

### 5.5 Channel handling

R1 first-class support is **mono and stereo**, which covers the normal Chromium tab-capture product path.

For mono/stereo:

- filter each channel independently;
- combine weighted channel energies according to the implemented BS.1770 loudness subset;
- do not average channels in a way that produces a stereo/mono level bias.

If a runtime stream exposes more than two channels and the channel layout cannot be identified correctly, R1 must not silently claim standards-correct multichannel loudness. It must either:

- use a documented, validated channel-layout path; or
- expose an unsupported/limited diagnostic and avoid false compliance claims.

A full advanced multichannel implementation is not required for R1.

### 5.6 Measurement payload

Each meter shall expose at least:

```text
momentaryLufs
shortTermLufs
momentaryValid
shortTermValid
samplePeakDbFS
sampleRate
channelCount
measurementTimestamp
measurementSequence
```

Input and output metrics must be separately named at AudioEngine level.

---

## 6. K-weighting implementation requirements

### 6.1 Shared implementation

The old model:

```text
production: WebAudio BiquadFilterNode approximation
test:       separate pure-JS coefficient implementation
```

is forbidden as the authoritative R1 path.

Production and test must share the same filter coefficient generator and sample-processing implementation.

### 6.2 Filter state

Each channel requires independent filter state. Reusing state between channels is invalid.

Filter state must reset deterministically on:

- engine destruction;
- explicit meter reset/reacquisition epoch where required.

### 6.3 Numerical validation

R1 tests must include:

- impulse/filter stability;
- representative low-frequency attenuation;
- representative high-frequency shelf behavior;
- steady-tone/reference-fixture agreement;
- 44.1 kHz and 48 kHz;
- mono and stereo.

Reference expected values must come from an independently validated source or frozen reference fixture, not from calling the same production function twice.

---

## 7. Normalization controller redesign

### 7.1 Core equations

The user-visible semantic target is:

```text
effectiveTargetLufs =
    globalTargetLufs
  + relativeOffsetDb
```

The total steady-state gain request is:

```text
requestedTotalGainDb =
    effectiveTargetLufs
  - measuredInputLufs
```

For implementation compatibility and responsive manual adjustment, it is acceptable to decompose this into:

```text
requestedAutoGainDb =
    globalTargetLufs
  - measuredInputLufs

requestedTotalGainDb =
    requestedAutoGainDb
  + relativeOffsetDb
```

This is mathematically equivalent at convergence and prevents applying the relative offset twice.

### 7.2 No persistent source-error integration

The controller MUST NOT implement:

```text
autoGain += globalTargetLufs - measuredInputLufs
```

as the normal steady-state control law.

Instead it shall smooth the currently applied auto gain **toward a bounded desired auto gain**:

```text
desiredAutoGainDb = clamp(globalTargetLufs - measuredInputLufs)

appliedAutoGainDb =
    moveToward(
        currentAutoGainDb,
        desiredAutoGainDb,
        asymmetricRate,
        dt
    )
```

A constant input source therefore creates a constant desired gain, and applied gain converges to it once.

### 7.3 Hysteresis/deadband

Deadband must be applied to the difference between desired gain and current gain (or an equivalent stable target domain), not used as an excuse to keep integrating source-level error.

The implementation must avoid audible gain hunting from small Short-Term fluctuations.

### 7.4 Asymmetric convergence

Retain the product principle:

- loud source / required attenuation: faster response;
- quiet source / required amplification: slower response.

The current rates may be used as starting defaults:

```text
attenuation rate: ~8 dB/s
amplification rate: ~1.5 dB/s
```

but R1 validation may tune these values.

Any change to final defaults must be justified in the R1 validation report with step-response evidence.

### 7.5 Relative offset behavior

The existing public command/method may temporarily remain named `setManualOffsetDb` to avoid pulling R2 message-contract work into R1.

Internally, R1 must treat that value as `relativeOffsetDb`.

When normalization is enabled:

```text
final target = global target + relative offset
```

When normalization is disabled for backward compatibility:

```text
applied gain = relative offset from unity
```

This preserves useful manual volume control until R3 decides the final exposed UI.

### 7.6 Compatibility fields

R1 may temporarily continue emitting legacy fields such as:

```text
manualOffsetDb
effectiveGainDb
```

if downstream R2-unfixed code requires them.

However the AudioEngine's canonical internal R1 state should expose:

```text
globalTargetLufs
relativeOffsetDb
effectiveTargetLufs
desiredAutoGainDb
appliedAutoGainDb
requestedTotalGainDb
appliedGainDb
gainErrorDb
isFrozen
isLimited
limitReason
normalizationEnabled
```

Legacy fields must be adapters/aliases, not a second control model.

---

## 8. Warm-up, silence, and resume behavior

### 8.1 Initial start

Before Momentary is valid:

- do not make positive auto-boost decisions from incomplete loudness data;
- emergency safety remains active.

After Momentary is valid but before Short-Term is valid:

- Momentary may trigger protective attenuation for clearly loud content;
- positive boost must remain conservative and MUST NOT assume that an incomplete Short-Term window represents stable programme loudness.

After Short-Term becomes valid:

- normal Short-Term-driven control begins.

### 8.2 Inactivity

When meaningful audio is inactive:

- automatic gain adaptation freezes;
- no “silence = very low LUFS = increase gain” behavior is permitted;
- capture/engine lifetime remains unchanged.

### 8.3 Resume reacquisition

A long silence contaminates a normal 3 s sliding window with silence. Therefore R1 must explicitly model control reacquisition.

On inactive -> active transition:

1. retain or safely constrain the prior gain;
2. begin a new control-measurement epoch or otherwise invalidate stale Short-Term control data;
3. use Momentary only for immediate attenuation/protection while reacquiring;
4. do not allow large positive boost from a Short-Term window dominated by preceding silence;
5. re-enable normal positive target tracking only after sufficient fresh active audio has been accumulated.

The output verification meter must likewise expose validity so a future UI cannot declare `Balanced` from stale pre-resume history.

### 8.4 Required transition tests

R1 must test:

- start -> loud audio;
- start -> quiet audio;
- active -> short speech pause -> active;
- active -> long silence -> same-level resume;
- active -> long silence -> much louder resume;
- active -> long silence -> much quieter resume.

---

## 9. Gain safety and headroom constraints

### 9.1 Safety hierarchy

The hierarchy is:

```text
loudness target = soft objective
headroom safety = hard constraint
emergency output guard = final fallback
```

### 9.2 Pre-application gain constraint

The controller/audio engine must derive a maximum safe positive total gain from recent input peak/headroom.

Conceptually:

```text
safeMaxGainDb =
    outputCeilingDbFS
  - conservativePeakMarginDb
  - recentInputSamplePeakDbFS
```

Then:

```text
constrainedTotalGainDb =
    min(requestedTotalGainDb, safeMaxGainDb, configuredMaxGainDb)
```

Negative attenuation remains governed by configured minimum gain.

Exact ceiling/margin defaults are implementation parameters and shall be finalized from R1 evidence. A conservative initial policy is preferred to false target attainment.

### 9.3 Sample peak versus true peak

If only sample peak is implemented in R1:

- name it `samplePeakDbFS`;
- include a conservative safety margin;
- do not expose or document it as `truePeak`;
- do not make a full true-peak-compliance claim.

A proper true-peak implementation may be added if it is straightforward and independently validated, but it is not required to complete R1.

### 9.4 Emergency output guard

`SafetyHook` may retain a `DynamicsCompressorNode` as emergency clipping protection.

It must be treated as fallback protection, not as evidence that the requested gain was safe.

### 9.5 Limited-target state

When safety or configured gain limits prevent target attainment:

```text
isLimited = true
limitReason = headroom | maxGain | minGain | unsupportedMeasurement | ...
```

The engine must report the real applied gain and real output loudness. It must not falsify a balanced state by reporting the unconstrained request.

---

## 10. Processed-output verification

### 10.1 Required second meter

A second continuous meter must observe the signal **after gain and safety**.

It is the authoritative source for:

- actual processed Momentary;
- actual processed Short-Term;
- actual processed peak;
- target error verification.

### 10.2 Canonical AudioEngine metrics

R1 AudioEngine should expose at least:

```text
inputMomentaryLufs
inputShortTermLufs
inputMomentaryValid
inputShortTermValid
inputSamplePeakDbFS

outputMomentaryLufs
outputShortTermLufs
outputMomentaryValid
outputShortTermValid
outputSamplePeakDbFS

globalTargetLufs
relativeOffsetDb
effectiveTargetLufs

desiredAutoGainDb
appliedAutoGainDb
requestedTotalGainDb
appliedGainDb

outputTargetErrorLu
isActive
isFrozen
isLimited
limitReason
measurementSequence
audioContextState
```

R1 may include compatibility aliases for existing consumers.

### 10.3 Balanced-ready signal

R1 does not redesign Popup status, but it must make future trustworthy status possible.

It may provide an internal verification boolean only if it is computed from:

- valid output Short-Term;
- active signal;
- absolute output target error;
- no target-invalidating safety limit;
- a defined settling/dwell condition.

If these conditions are not yet frozen, R1 should expose the underlying metrics and let the R1 closeout freeze the final tolerance/dwell values rather than hard-code a misleading `Balanced`.

---

## 11. AudioEngine integration

### 11.1 Worklet initialization

`AudioEngine.start()` must load the loudness worklet module before constructing meter nodes.

The same worklet module may be instantiated twice per engine:

- input meter;
- output verification meter.

Module registration should be idempotent per `AudioContext`.

### 11.2 Observation branches

Preferred graph:

```text
sourceNode
  +-> inputMeter (observation only)
  +-> gainNode -> safetyNode -> destination
                         +-> outputMeter (observation only)
```

Metering must not create duplicate audible routes.

### 11.3 Control cadence

The measurement path itself is continuous.

The control decision cadence may remain approximately 10 Hz in R1, either:

- driven by input-meter measurement messages; or
- by reading the latest continuous metrics at a 100 ms control cadence.

R1 must not rely on the timer for audio sample acquisition.

Cross-context telemetry throttling is R2.

### 11.4 Cleanup

R1 cleanup must dispose:

- both meter nodes;
- worklet message handlers;
- meter wrapper listeners;
- gain/safety nodes;
- AudioContext and source resources according to existing lifecycle behavior.

No R1 work may weaken the current cleanup guarantees.

---

## 12. File-level implementation plan

The Codex implementation should remain a single R1 change series, not create many planning documents.

### 12.1 Rewrite / major modification

Expected:

- `src/engine/loudness-meter.js`
- `src/engine/k-weighting.js` or replace it with the shared DSP module and compatibility export
- `src/engine/normalization-controller.js`
- `src/engine/audio-engine.js`
- `src/engine/safety.js`
- `src/engine/activity-detector.js` only where required for explicit reacquisition state

### 12.2 New DSP/worklet modules

Expected or equivalent:

- `src/engine/dsp/biquad-core.js`
- `src/engine/dsp/k-weighting-core.js`
- `src/engine/dsp/loudness-core.js`
- `src/engine/worklets/loudness-meter-processor.js`

Do not duplicate K-weighting logic in test-only code.

### 12.3 Tests / fixtures

Expected or equivalent:

- `test/test-r1-audio-core.mjs`
- `test/run-r1-browser-validation.mjs`
- `test/fixtures/r1-audio-core/*`
- optional fixture page/scripts needed to create deterministic real Web Audio streams

### 12.4 Closeout

Required:

- `docs/validation/R1_AUDIO_CORE_CORRECTION_REPORT.md`

No R1 closeout may modify the project status to Release Ready.

---

## 13. Work packages

R1 is intentionally kept to four implementation work packages.

### WP1 — Shared Continuous Loudness DSP

Deliver:

- sample-rate-aware shared K-weighting core;
- continuous energy/peak accumulation;
- 100 ms contiguous slices;
- valid 400 ms Momentary and 3 s Short-Term windows;
- mono/stereo handling;
- worklet processor + wrapper;
- production/test shared code path.

WP1 gate:

- pure DSP/reference tests pass at 44.1 and 48 kHz;
- production code uses the same core tested by the reference suite;
- no `AnalyserNode` snapshot path remains authoritative for loudness.

### WP2 — Bounded Normalization + Safety + Verification

Deliver:

- desired-gain controller;
- relative-target semantics;
- asymmetric move-toward convergence;
- silence freeze;
- resume reacquisition;
- peak/headroom gain constraint;
- input and post-safety output meters;
- authoritative audio-core metrics;
- compatibility aliases only where required.

WP2 gate:

- constant sources converge and stop moving;
- gain does not run away to a bound;
- safety-limited targets are explicitly reported;
- output verification reflects actual processed audio.

### WP3 — Deterministic End-to-End Audio Validation

Deliver:

- independent reference fixtures;
- controller simulations;
- actual Web Audio/AudioWorklet browser fixture path;
- multi-engine tests;
- long-run stability;
- dynamic transitions;
- relative-offset tests;
- safety-limit tests.

WP3 gate:

- the R1 hard acceptance matrix in Section 14 passes with observed processed output.

### WP4 — R1 Closeout

Deliver:

- validation report with raw/summary evidence;
- achieved measurement error;
- achieved convergence error;
- final controller rates;
- final activity threshold/hold settings;
- final headroom policy;
- known limitations;
- explicit GO/NO-GO for R1.

Only after R1 GO does implementation planning proceed to R2.

---

## 14. Hard acceptance matrix

R1 evidence must measure **processed output**, not infer success from controller state.

### 14.1 Meter conformance

Required:

1. 400 ms Momentary is built from contiguous 0.4 s audio;
2. 3 s Short-Term is built from contiguous 3 s audio;
3. update cadence is at least 10 Hz;
4. 44.1 and 48 kHz both pass reference checks;
5. mono/stereo energy handling passes;
6. production and test use the same K-weighting core;
7. steady reference fixture error is small enough to support a ±1 LU product goal; target implementation goal: **≤ 0.2 LU** versus the frozen independent reference for stable fixtures;
8. invalid warm-up windows are explicitly marked invalid.

If the ≤0.2 LU reference target cannot be achieved, R1 is not automatically failed, but the discrepancy must be independently diagnosed before any GO decision. The acceptance threshold may not be silently loosened.

### 14.2 Absolute convergence

Minimum deterministic scenario:

```text
global target = -18 LUFS
relative offset = 0 dB

A input ~= -10 LUFS
B input ~= -18 LUFS
C input ~= -26 LUFS
```

After the configured settling interval and with no safety constraint:

```text
A processed Short-Term ~= -18 LUFS
B processed Short-Term ~= -18 LUFS
C processed Short-Term ~= -18 LUFS
```

Target steady-state criterion:

- each output within **±1.0 LU** of its effective target over the final stable verification window;
- no monotonic drift after convergence;
- no source reaches a gain bound merely because the old source-error integrator behavior survived.

### 14.3 Long-run no-runaway

For constant source fixtures:

- run a fast simulation equivalent to at least 10 minutes;
- run the real browser audio path long enough to reveal continued drift;
- applied gain after settling must remain bounded around the desired value rather than continue toward min/max.

### 14.4 Dynamic source change

For one engine at a time:

```text
-10 -> -22 LUFS
-22 -> -8 LUFS
```

Required:

- only that engine's gain state changes;
- attenuation responds faster than amplification;
- it reconverges to the shared target;
- the other engines remain stable.

### 14.5 Relative target offset

At stable source loudness:

```text
global target = -18
relative offset = +3
effective target = -15
```

and:

```text
relative offset = -3
effective target = -21
```

Required:

- verified processed output tracks the effective target within the steady-state tolerance when not safety-limited;
- offset is not double-applied.

### 14.6 Silence / resume

Required cases:

- true silence causes no gain growth;
- short speech pause preserves stable behavior;
- long silence does not poison resume with a large boost;
- louder resume receives immediate protection and then reconverges;
- quieter resume waits for valid reacquired control data before large positive boost.

### 14.7 Safety-limited target

Create a quiet-average/high-peak fixture for which loudness target gain would violate headroom.

Required:

- requested target gain and applied gain differ;
- output remains safe;
- `isLimited=true`;
- a concrete `limitReason` is reported;
- the engine does not claim verified target convergence.

---

## 15. Reference fixture policy

R1 must avoid circular tests.

A fixture is not independent evidence if its expected LUFS value is generated by the same function under test.

Accepted reference strategies include:

- official/standards test material where practical;
- fixture expected values generated and frozen from an independent trusted loudness implementation;
- analytically controlled synthetic material whose expected behavior is independently verified.

Each checked-in fixture manifest should include:

```text
id
sampleRate
channelCount
duration
referenceMomentary/ShortTerm value or expected range
referenceSource/tool
referenceDate/version
purpose
```

Large media files should not be added unnecessarily. Small deterministic generated PCM fixtures are preferred when they can carry independent frozen reference values.

---

## 16. Browser audio-path validation

Pure Node tests are necessary but insufficient.

R1 browser validation must execute the actual production path:

```text
real AudioContext
-> AudioWorklet module
-> meter wrapper
-> GainProcessor
-> SafetyHook
-> output verification meter
```

Preferred fixture approach:

- generate deterministic audio in a browser fixture page;
- route it through `MediaStreamAudioDestinationNode` or equivalent to create MediaStream inputs compatible with AudioEngine;
- instantiate multiple independent AudioEngines;
- capture emitted R1 metrics;
- judge convergence from output Short-Term values.

The browser harness must fail when output does not converge even if the controller reports the expected requested gain.

---

## 17. Evidence and reporting requirements

`docs/validation/R1_AUDIO_CORE_CORRECTION_REPORT.md` must contain:

1. exact commit under validation;
2. browser/runtime versions used;
3. sample rates tested;
4. reference-fixture provenance;
5. K-weighting/loudness error table;
6. constant-source convergence table;
7. dynamic step-response table;
8. relative-offset results;
9. silence/resume results;
10. safety-limited results;
11. long-run drift result;
12. final parameter values;
13. known limitations;
14. explicit R1 GO or NO-GO.

The report must distinguish:

- pure DSP unit evidence;
- controller simulation evidence;
- real browser AudioWorklet evidence.

Test counts alone are not an R1 gate.

---

## 18. Migration and compatibility rules

### 18.1 Historical files

Do not delete historical P2 reports/tests solely because they are scientifically insufficient for R1 release evidence.

They remain traceability artifacts.

### 18.2 Misleading comments/claims

Production comments such as:

```text
BS.1770 compliant
```

must be updated if they overstate the validated implementation.

### 18.3 Legacy API surface

To avoid R2 scope leakage:

- existing setter names/messages may remain temporarily;
- R1 must add correct internal semantics and canonical metrics;
- adapters may map old names to new meanings;
- schema cleanup and cross-context ownership remain R2.

### 18.4 No silent fallback

If AudioWorklet initialization fails, R1 must not silently fall back to the old sparse `AnalyserNode` loudness path and report success.

Engine start should fail or enter an explicit audio-core error state. R2 later owns complete cross-context propagation of that failure.

---

## 19. Codex execution order

Codex should execute R1 in this order:

```text
1. Add shared DSP core + reference tests
2. Add continuous AudioWorklet meter + wrapper
3. Replace controller with desired-gain model
4. Add safety/headroom policy
5. Integrate input + output meters into AudioEngine
6. Add warm-up/reacquisition behavior
7. Add deterministic multi-engine/browser validation
8. Remove/de-authorize legacy sparse loudness path
9. Run historical regressions and classify expected breakage
10. Produce R1 validation report
```

Do not start R2 fixes during steps 1–10 unless an R2 defect literally prevents R1 browser evidence from running. Any such exception must be minimal and documented.

---

## 20. R1 completion gate

R1 may be declared **GO / COMPLETE** only when:

- continuous loudness measurement replaces sparse sampling in the authoritative path;
- production/test K-weighting uses one shared core;
- 400 ms and 3 s windows are contiguous and valid;
- constant-source processed output converges to target and stops drifting;
- multi-engine independence is demonstrated;
- relative offsets produce corresponding effective targets without double application;
- silence/resume cannot create gain runaway;
- safety-limited conditions are explicit;
- processed-output verification exists and is used for acceptance;
- browser AudioWorklet validation executes the real production audio path;
- the R1 validation report records evidence and freezes final numeric parameters/tolerances.

Until then:

> **R1 remains implementation-in-progress and the project remains non-release-ready.**

After R1 GO, the next phase is **R2 — Runtime & State Reliability**.
