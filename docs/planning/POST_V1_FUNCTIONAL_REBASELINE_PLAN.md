# WebAudioBalance — Post-v1 Functional Rebaseline Plan

> Status: **FROZEN**  
> Frozen Date: **2026-10-04**  
> Scope: **Post-v1 functional correction and product revalidation**  
> Authority: This document is the current authoritative development mainline for work after the original P0–P6 cycle.  
> Historical baseline: `docs/PROJECT_MAINLINE_PLAN.md` and `docs/validation/P0_*`–`P6_*` are retained as historical records. Their previous **GO / RELEASE READY** decisions do **not** constitute current release evidence after this rebaseline.

---

## 1. Why this rebaseline exists

Real product use after the original v1.0.0 closeout exposed a mismatch between the repository's validation claims and the actual product behavior.

The architecture remains viable, but several implementation and validation defects are material to the product's primary purpose:

1. the automatic normalization control law can continue accumulating gain because loudness is measured before gain while the controller integrates a persistent source-level error;
2. the production loudness path uses sampled `AnalyserNode` snapshots that do not constitute a continuous 400 ms / 3 s loudness window;
3. production K-weighting and benchmark K-weighting are not the same implementation path;
4. Popup, Service Worker, Coordinator, and Offscreen runtime use inconsistent runtime-state schemas and incomplete command acknowledgement;
5. Service Worker restart/runtime reconciliation is incomplete;
6. detected-tab refresh and tab metadata propagation are incomplete;
7. UI status such as `Balanced` is not tied to verified processed-output loudness;
8. portions of the P4/P5 validation suites validate declared/mock state rather than real end-to-end product behavior.

Therefore the project is reclassified from **release-ready** to:

> **Functional prototype — post-v1 functional rebaseline in progress**

The objective is correction and evidence rebuilding, not an architectural rewrite.

---

## 2. Frozen product definition

WebAudioBalance exists to provide **absolute perceptual loudness balancing across user-enabled browser tabs**.

The frozen functional definition is:

> For every browser tab explicitly enabled by the user, WebAudioBalance independently measures that tab's captured audio loudness and independently adjusts its gain so that the tab's effective output loudness converges toward a shared global loudness target. A per-tab user adjustment is represented as an offset from that shared target.

This means:

- tabs share a target reference;
- tabs do **not** directly control or compare against one another;
- each tab has its own measurement, controller, gain state, activity state, and safety state;
- source-level differences may originate from mastering, website/player volume, Web Audio gain, advertisements, streams, meetings, or other page behavior;
- WebAudioBalance operates on the actual tab capture signal presented to its Audio Runtime.

The established architectural principle of **independent per-tab engines with a shared target** is retained.

---

## 3. Frozen control semantics

### 3.1 Global target

A global target represents the desired perceptual listening level, for example:

```text
globalTargetLufs = -18 LUFS
```

Semantic presets such as Quiet / Normal / Loud may remain product-level aliases for concrete target values.

### 3.2 Per-tab relative level

The per-tab user slider is frozen conceptually as a **relative target offset**, not as an unrelated second volume system.

```text
effectiveTargetLufs =
    globalTargetLufs
  + relativeOffsetDb
```

Examples:

```text
Global target        -18 LUFS
Tab A offset           0 dB  -> effective target -18 LUFS
Tab B offset          +2 dB  -> effective target -16 LUFS
Tab C offset          -3 dB  -> effective target -21 LUFS
```

Internally this may still be implemented through gain composition, but state, controller behavior, UI semantics, diagnostics, and tests must preserve this single-target model.

### 3.3 Desired normalization gain

The normalization controller must target a bounded desired gain rather than indefinitely integrate a source-level error.

Conceptually:

```text
desiredAutoGainDb =
    effectiveTargetLufs
  - measuredInputLufs
```

Then:

```text
desiredAutoGainDb
      |
      v
headroom / safety constraint
      |
      v
gain bounds
      |
      v
temporal smoothing / attack-release policy
      |
      v
appliedAutoGainDb
```

A source whose measured loudness remains constant must converge to a stable gain rather than continue moving toward a gain limit.

Exact controller equations and time constants belong to R1 implementation design and benchmark evidence; the behavior above is frozen.

---

## 4. Frozen loudness model

The product must preserve program dynamics rather than force every short instant to the same level.

### Primary normalization reference

Use a continuously measured **Short-Term loudness** window of approximately 3 seconds as the principal normalization reference.

### Supporting measurements

Use:

- Momentary loudness (~400 ms) for rapid state/transition observation and auxiliary protection logic;
- activity/silence state to freeze inappropriate adaptation during inactivity;
- peak/headroom information for amplification safety;
- optional longer-term/integrated loudness for diagnostics or later features, not as a required v1 correction control signal.

The runtime measurement path must operate on **continuous PCM**, not sparse snapshots whose accumulated samples do not represent the claimed window duration.

The preferred R1 implementation direction is an AudioWorklet-based continuous metering path or an equivalent continuous-sample implementation.

---

## 5. Frozen Audio Runtime model

The required logical graph is:

```text
Captured Tab Source
        |
        +----> Input Loudness Measurement
        |            |
        |            v
        |      Desired Gain Decision
        |            |
        v            v
      Gain Processor
        |
        v
   Safety / Headroom
        |
        +----> Output Verification Measurement
        |
        v
 AudioContext.destination
```

### Input measurement

Input loudness is used to determine the requested normalization gain.

### Output verification

Processed-output loudness is used to verify product state and acceptance, including whether a tab is actually balanced.

Output verification is not required to become a high-gain feedback loop.

### Safety precedence

The loudness target is a soft objective. Output safety is a hard constraint.

If the target cannot be reached safely because of peak/headroom constraints, the runtime must prefer safety and expose that condition in diagnostics rather than falsely claim convergence.

---

## 6. Frozen activity and resume behavior

During meaningful silence or inactivity:

- automatic gain must not run away toward maximum boost;
- the previous stable gain may be held;
- a paused tab remains logically managed/captured if its capture session still exists.

When sound resumes:

1. begin from a safe retained state;
2. protect against sudden loud transients immediately;
3. reacquire valid loudness measurements;
4. smoothly converge toward the new desired gain.

Pause → resume, silence → speech, quiet → loud, and loud → quiet are required benchmark transitions.

---

## 7. Frozen user-facing state model

The three state dimensions remain distinct:

- **managed/enabled** — the user has opted the tab into WebAudioBalance;
- **captured** — a valid capture/AudioEngine session exists;
- **active** — meaningful audio is currently present.

The browser's audible flag may assist discovery but is not authoritative DSP activity.

### Balanced

`Balanced` must become a trustworthy output condition.

It may only be presented when, at minimum:

- the tab is managed and captured;
- meaningful audio is active;
- output loudness is valid;
- processed-output loudness is within the accepted tolerance of the effective target;
- the controller is settled sufficiently for the status to be meaningful;
- no safety constraint invalidates the claimed target convergence.

Exact tolerance and settling duration are frozen later from R1/R3 evidence. They must not be invented solely for UI convenience.

---

## 8. Frozen UI product model

The primary UI must be organized around the user's real workflow:

```text
Discover -> Enable -> Balance -> Relative Adjust
```

The default surface should answer:

1. which tabs are enabled;
2. whether each enabled tab is balanced, balancing, paused, unavailable, or in error;
3. how to make one tab relatively quieter or louder;
4. what the global listening target is.

Engineering details such as raw Momentary LUFS, Short-Term LUFS, auto gain, applied gain, capture internals, and AudioContext state belong in diagnostics.

The per-tab slider should use user semantics such as:

```text
Relative Level
Quieter <---- Normal ----> Louder
```

while retaining precise dB representation internally.

Because Chromium requires user authorization for tab capture, the product must clearly communicate that Auto Balance applies to **enabled/managed tabs**, not silently to every browser tab.

---

## 9. Runtime and state reliability requirements

The current control/audio/UI state model must be corrected before product validation resumes.

The following are hard requirements:

1. one authoritative message schema per command/event type;
2. `RUNTIME_STATE` and Coordinator snapshots must not use incompatible payload shapes;
3. every command that can fail must return and propagate an explicit ACK/NACK result;
4. the Coordinator must not mark a tab captured when the Audio Runtime rejected engine startup;
5. command failures must not be silently swallowed;
6. Popup optimistic state must reconcile with authoritative runtime state;
7. Service Worker restart must reconcile with the Offscreen runtime and current browser capture state rather than assume in-memory registry continuity;
8. tab title, URL, favicon, audible state, and lifecycle metadata must be populated and refreshed coherently;
9. detected audible tabs must actually re-render when discovery changes;
10. Popup lifetime must remain independent of AudioEngine lifetime;
11. DSP-rate data must remain inside the Audio Runtime; only aggregated UI/control telemetry should cross extension messaging boundaries.

---

## 10. Validation evidence policy

The post-v1 rebaseline explicitly changes the meaning of validation.

A test may only support a claim that it actually executes or measures.

The following are not sufficient evidence for a real-world compatibility PASS:

- a hard-coded matrix entry containing `PASS`;
- a mock state object;
- checking that a field exists;
- unit-testing a presentation helper;
- unit-testing an isolated controller without closing the real audio-control loop.

Historical unit tests remain useful regression tests, but they are not release evidence by themselves.

Validation reports must distinguish:

- unit/algorithm tests;
- component integration tests;
- browser integration tests;
- real audio end-to-end tests;
- real website compatibility tests;
- manual perceptual/UX evaluation where automation cannot prove the claim.

---

## 11. New development mainline

The post-v1 correction mainline is frozen as four phases.

```text
R0  Functional Rebaseline
 |
 v
R1  Audio Core Correction
 |
 v
R2  Runtime & State Reliability
 |
 v
R3  Product UX & Real-world Validation
```

The previous P0–P6 sequence remains historical and is not extended for this correction cycle.

---

## 12. R0 — Functional Rebaseline

### Objective

Freeze the actual product promise, the required audio-control semantics, the state model, and the evidence required to claim success.

### Frozen deliverables

This document itself is the R0 authoritative deliverable.

R0 freezes:

- absolute perceptual balance across user-enabled tabs;
- independent per-tab controllers with a shared global target;
- per-tab adjustment as target-relative offset;
- continuous loudness measurement requirement;
- bounded desired-gain convergence rather than persistent error accumulation;
- input measurement plus processed-output verification;
- safety precedence;
- trustworthy `Balanced` semantics;
- explicit runtime ACK/NACK and state reconciliation requirements;
- evidence-based end-to-end release gates.

### Status

**R0 COMPLETE / FROZEN.**

No additional product-scope discussion is required before R1 planning unless implementation evidence demonstrates that a frozen assumption is technically invalid.

---

## 13. R1 — Audio Core Correction

### Objective

Correct the actual loudness measurement and normalization loop before further UI polishing.

### Required work

R1 must cover:

- continuous PCM loudness measurement;
- production K-weighting path validation;
- correct 400 ms Momentary and 3 s Short-Term windows;
- channel-aware energy handling appropriate to the supported tab stream;
- desired gain computation;
- bounded/smoothed controller behavior;
- activity/silence freeze;
- pause/resume reacquisition;
- peak/headroom-aware amplification limits;
- processed-output verification measurement;
- authoritative audio metrics;
- removal or isolation of misleading legacy measurement behavior.

### R1 hard gate

R1 is **GO** only when fixed audio fixtures demonstrate actual processed-output convergence.

Minimum required deterministic scenario:

```text
Target = -18 LUFS

Source A input = -10 LUFS
Source B input = -18 LUFS
Source C input = -26 LUFS
```

After settling:

```text
A processed output ~= target
B processed output ~= target
C processed output ~= target
```

and during sustained playback:

- A does not continue attenuating;
- B does not drift;
- C does not continue boosting;
- no controller hits a gain bound merely because a constant source-level error was repeatedly integrated.

Then dynamically change source levels and verify that only the corresponding engine reconverges.

R1 must also test silence, speech pauses, transients, quiet/loud transitions, and safety-limited targets.

Numerical tolerance and settling criteria must be reported from evidence and then frozen in the R1 closeout.

---

## 14. R2 — Runtime & State Reliability

### Objective

Make Control Plane, Audio Plane, browser state, and Popup state coherent and failure-aware.

### Required work

R2 must cover:

- canonical message contracts;
- command ACK/NACK handling;
- authoritative engine-start/stop state;
- runtime snapshot schema;
- Coordinator ↔ Offscreen reconciliation;
- Service Worker restart recovery;
- current capture discovery/reconciliation where browser APIs permit;
- tab metadata population;
- navigation/close lifecycle;
- detected-tab refresh;
- Popup reopen/reconciliation;
- telemetry rate reduction and aggregation;
- actionable error propagation.

### R2 hard gate

A real browser integration test must demonstrate:

```text
open Popup
-> discover audio tab
-> enable tab
-> engine actually starts
-> close Popup
-> processing continues
-> reopen Popup
-> state is correct
-> pause/resume works
-> Service Worker restart/re-wake
-> state reconciles
-> release tab
-> processed session is removed cleanly
```

No UI success state may be derived solely from optimistic local mutation.

---

## 15. R3 — Product UX & Real-world Validation

### Objective

Rebuild the user experience around the corrected audio/runtime model and then establish real release evidence.

### UX work

R3 should simplify the default Popup around:

- Balance Enabled Tabs;
- semantic global listening target;
- Enabled/Managed tabs;
- Other detected audio tabs;
- trustworthy Balancing/Balanced/Paused/Error states;
- per-tab Relative Level;
- clear Enable and Release actions;
- concise actionable failures;
- advanced diagnostics separated from the primary workflow.

### Required UI behavior testing

At minimum validate real interactions for:

- Enable/Balance;
- Release;
- global Auto Balance;
- global listening target;
- per-tab Relative Level;
- per-tab auto toggle if retained;
- detected-tab appearance/disappearance;
- pause/resume;
- popup close/reopen;
- navigation;
- tab close;
- unsupported page;
- capture failure;
- runtime failure.

### Real-world compatibility evidence

Test current Chrome Stable and Edge Stable with representative real sources, including where accessible:

- ordinary HTML5 audio/video;
- YouTube/MSE;
- Bilibili or equivalent MSE source;
- Twitch/live streaming;
- Spotify Web or equivalent music streaming;
- podcast/dialogue content;
- Web Audio application;
- iframe media;
- WebRTC receive audio;
- known protected/DRM content as a documented platform limitation.

For each applicable source, record actual evidence for:

- capture;
- processed playback;
- loudness measurement;
- convergence;
- manual relative level;
- pause/resume;
- navigation;
- long-running stability;
- release/cleanup;
- Chrome/Edge differences.

A compatibility row may not be marked PASS merely because the category is represented in a test data structure.

---

## 16. Release gate after rebaseline

The product must not return to **Release Ready** until all of the following are true:

1. R1 Audio Core Correction passes its processed-output convergence gate;
2. R2 Runtime & State Reliability passes real browser lifecycle/reconciliation tests;
3. R3 UI behavior tests execute the real Popup/runtime path;
4. representative Chrome and Edge real-world compatibility evidence is recorded;
5. the default UI accurately reflects authoritative runtime state;
6. long-running tests show no gain runaway and no materially incorrect convergence;
7. known unsupported conditions are classified without false success states;
8. README and release documentation are regenerated from the new evidence rather than inheriting historical P0–P6 GO claims.

---

## 17. Explicitly retained architecture

The rebaseline does **not** reopen the following without contrary implementation evidence:

- Chromium Manifest V3 as the target platform;
- Chrome + Microsoft Edge unified Chromium codebase;
- tab-level capture as the primary source backend;
- Offscreen Document as the persistent Audio Runtime;
- Service Worker as Control Plane, not DSP owner;
- one independent AudioEngine per managed tab;
- user-initiated tab enablement;
- shared global target with independent per-tab normalization;
- Popup as a transient control/view surface.

This is a functional correction program, not a platform rewrite.

---

## 18. Explicitly superseded claims

As of this frozen rebaseline:

- `v1.0.0 — Production Release Ready` is superseded as a current project-status claim;
- cumulative historical test counts such as `206 / 206 PASS` remain historical regression information only;
- P4/P5/P6 GO decisions do not satisfy the new release gate;
- prior claims of complete BS.1770-compliant production metering and comprehensive real-world compatibility require revalidation through R1/R3;
- implementation work must follow R1 -> R2 -> R3 unless a blocking dependency requires a narrowly justified ordering change.

---

## 19. R1 implementation specification

The R1 implementation specification is now frozen:

- `docs/planning/R1_AUDIO_CORE_CORRECTION_IMPLEMENTATION_SPEC.md`

It defines the bounded Audio Core correction, production/test-shared DSP path, deterministic processed-output benchmarks, safety behavior, migration rules, and Codex execution order without reopening R0 scope.

Current handoff state after independent implementation review:

```text
R0  Functional Rebaseline        COMPLETE / FROZEN
R1  Primary Implementation       SUBSTANTIALLY COMPLETE
R1  Closeout Correction Spec     COMPLETE / FROZEN
R1  Closeout Correction Code     NEXT
R2  Mainline Plan                COMPLETE / FROZEN, IMPLEMENTATION BLOCKED
R3  Mainline Plan                COMPLETE / FROZEN, IMPLEMENTATION AFTER R2
```

Authoritative follow-on documents:

- `docs/planning/R1_CLOSEOUT_CORRECTION_IMPLEMENTATION_SPEC.md`
- `docs/planning/R2_RUNTIME_STATE_RELIABILITY_PLAN.md`
- `docs/planning/R3_PRODUCT_UX_REAL_WORLD_VALIDATION_PLAN.md`

R2 planning is frozen for continuity, but **R2 implementation must not begin until corrected R1 evidence is GO/FROZEN**.
