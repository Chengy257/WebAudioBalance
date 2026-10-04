# WebAudioBalance — Project Mainline Plan

> **CURRENT AUTHORITY NOTICE (2026-10-04):** The original P0–P6 mainline below is retained as a historical baseline. Its release conclusions are superseded by [`docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`](planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md), which is the authoritative current development plan. Post-v1 work follows R0 → R1 → R2 → R3, with R0 frozen and R1 next.


> Status: **FROZEN BASELINE**
>
> Target: Chromium Manifest V3 desktop extension with first-class support for **Google Chrome** and **Microsoft Edge**.
>
> Purpose: authoritative product, architecture, phase, validation, and scope baseline for subsequent implementation specifications.

---

## 1. Purpose and authority

This document supersedes the implementation assumptions in the initial project proposal while preserving its core product need: reduce disruptive loudness differences between browser tabs and provide independent per-tab volume adjustment.

Historically, this document served as the authoritative P0–P6 development mainline. It is now retained as a frozen historical baseline. Current post-v1 authority is `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`; new implementation specifications must follow that rebaseline and must not silently revive superseded release claims.

If implementation evidence invalidates a frozen assumption, the required process is:

**Evidence → architecture review → mainline amendment → implementation update.**

The initial proposal remains a historical design record, not the implementation authority.

---

## 2. Product definition

WebAudioBalance is a desktop Chromium browser extension that allows users to actively place browser tabs under audio management and then:

1. normalize each managed tab independently toward a shared perceptual loudness reference;
2. apply a user-controlled per-tab manual gain offset on top of automatic normalization;
3. centrally view and control managed and currently relevant audio tabs;
4. run without a native executable, driver, or external backend service.

### 2.1 Primary platforms

- Google Chrome Desktop
- Microsoft Edge Desktop
- Manifest V3
- One shared core codebase

Edge is a first-class target, not a later port.

### 2.2 Core interaction model

The v1 product model is **user-initiated managed tabs**.

Discovery of a tab that appears to be producing audio does not imply that the extension has capture/control authority over it. A user action establishes management where the browser API permits it.

Once a tab is successfully managed, the extension should maintain management through the tab's current lifecycle where supported and should not require the popup to remain open.

### 2.3 Meaning of “cross-tab balancing”

Cross-tab balancing does **not** mean that tabs continuously compare their loudness with one another or participate in a shared feedback controller.

The frozen model is:

```text
                  Shared Loudness Reference
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
           Tab A          Tab B          Tab C
              |             |             |
          Controller A  Controller B  Controller C
              |             |             |
          AudioEngine A AudioEngine B AudioEngine C
```

Each managed tab independently converges toward the same configured loudness reference.

**Tab A MUST NOT become a feedback input that changes the gain decision for Tab B or Tab C.**

This is centralized orchestration with decentralized per-tab normalization.

---

## 3. MVP scope

### 3.1 Global controls

The MVP provides:

- global automatic normalization ON/OFF;
- a listening-level / loudness-target setting;
- an overview of managed tabs;
- discovery/presentation of relevant audible tabs where supported.

### 3.2 Per-tab controls

Each managed tab supports:

- Enable / Disable management;
- automatic normalization ON/OFF;
- manual gain offset;
- user-facing status.

The original ±12 dB manual offset range may be retained as an initial UI range, but the Audio Engine MUST use configurable gain bounds rather than treating ±12 dB as an architectural limit.

### 3.3 Audio capabilities

The MVP audio path provides:

- tab audio capture;
- audio-level/loudness measurement;
- automatic loudness normalization;
- deterministic manual gain adjustment;
- peak/clipping safety;
- processed playback.

---

## 4. Explicit non-goals and deferred scope

The following are NOT required for the initial MVP:

- per-site automatic rules;
- auto-enable rules by origin/site;
- user-defined audio profiles;
- cloud synchronization;
- listening history;
- Side Panel UI;
- full keyboard-shortcut management system;
- equalization;
- multiband compression;
- dialogue enhancement;
- AI audio enhancement;
- per-media-element control inside one tab;
- Firefox support;
- Safari support;
- mobile-browser support.

### 4.1 Deferred capture backend

DOM `HTMLMediaElement` / `createMediaElementSource()` interception is **not** a second mandatory v1 capture backend.

Its status is:

**Deferred pending P5 compatibility evidence.**

It may be introduced only if real-world validation demonstrates an important use case where the primary tab-level capture path fails and a MediaElement-based backend reliably solves the failure without unacceptable complexity or permissions.

### 4.2 DRM / protected media

DRM/EME content is a compatibility class to validate, not a requirement to bypass or guarantee support for.

Known browser/platform protection boundaries may be documented as unsupported behavior.

---

## 5. Architecture baseline

The frozen architecture separates control responsibilities from real-time audio responsibilities.

```text
+--------------------------------------------------+
|                    Popup UI                      |
|       Discover / Enable / Balance / Adjust       |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
|                  Control Plane                   |
|               MV3 Service Worker                 |
|                                                  |
|  - Managed Tab Registry                          |
|  - persistent/global settings                    |
|  - lifecycle coordination                        |
|  - command routing                               |
|  - low-frequency state/metrics coordination      |
+-------------------------+------------------------+
                          |
                          v
+--------------------------------------------------+
|                   Audio Plane                    |
|              Offscreen Audio Runtime             |
|                                                  |
|  AudioEngine A   AudioEngine B   AudioEngine C   |
|       |               |               |          |
|  Capture -> Meter -> Controller -> Gain           |
|                              -> Safety -> Output  |
+--------------------------------------------------+
```

### 5.1 Architecture principles

#### A1. Chromium MV3 first

Chrome and Edge use one core architecture and one shared implementation wherever possible.

Browser-specific code is permitted only for demonstrated browser-specific behavior and should be isolated behind a small Chromium/platform adapter rather than separate Chrome and Edge codebases.

#### A2. User-initiated managed tabs

Capture/control authority must follow the browser's user-activation and permission model.

The product MUST NOT assume that every audible tab can be silently captured in the background.

The exact multi-tab activation behavior is a P0 hard feasibility question.

#### A3. Control Plane is not the Audio Plane

The Service Worker owns orchestration, state routing, and lifecycle coordination.

It MUST NOT be the real-time DSP engine.

The Audio Runtime owns:

- `AudioContext`;
- capture streams;
- Web Audio nodes;
- metering;
- normalization control;
- gain application;
- audio output.

#### A4. Service Worker permanence is not an architectural dependency

The system MUST tolerate normal MV3 Service Worker suspension/restart.

A long-lived Port MUST NOT be treated as a mechanism for forcing the Service Worker to remain permanently alive.

#### A5. Independent per-tab normalization

Each AudioEngine performs its own measurement and normalization.

Cross-tab state is centrally managed, but cross-tab loudness feedback is prohibited from the v1 normalization algorithm.

#### A6. Evidence-driven compatibility

Fallbacks, site-specific code, additional capture backends, and broader permissions require evidence from real compatibility failures.

Do not pre-implement compatibility complexity.

---

## 6. Core runtime model

### 6.1 Managed Tab Registry

The Control Plane maintains logical tab state such as:

```text
ManagedTab
- tabId
- title / presentation metadata
- managementState
- captureState
- audioState
- normalizationEnabled
- manualOffsetDb
- shortTermLufs (when available)
- appliedGainDb
- lastUpdated
```

Web Audio runtime objects MUST NOT be stored in the Registry.

### 6.2 State distinctions

The implementation must distinguish at least:

**Managed** — the user has placed the tab under extension management.

**Captured** — a valid audio capture/runtime path currently exists.

**Active** — the captured stream currently contains meaningful audio activity.

Therefore the following state is valid:

```text
managed = true
captured = true
active = false
```

For example, a managed video may simply be paused.

### 6.3 Tab lifecycle

Where the browser capture model permits it, navigation within the same tab should preserve the logical managed-tab identity.

Closing a tab must:

- stop its AudioEngine;
- release capture resources;
- remove runtime registry state;
- leave other managed tabs unaffected.

---

## 7. Audio Engine baseline

One managed tab maps to at most one valid logical `AudioEngine`.

Conceptually:

```text
AudioEngine
- AudioSource
- Meter
- GainProcessor
- SafetyProcessor
- Output
- state
```

A minimal lifecycle is preferred:

```text
IDLE -> STARTING -> RUNNING -> STOPPING -> IDLE
             \          /
                  ERROR
```

Do not introduce a complex recovery state machine without implementation evidence.

### 7.1 Initial source backend

P1 implements only the source backend validated by P0, expected to be a tab-level capture source.

Conceptually:

```text
AudioSource
    |
    +-- TabCaptureSource   [initial implementation]
    |
    +-- other source       [deferred unless justified]
```

### 7.2 Minimal engine contract

The implementation should expose an equivalent of:

```text
start(tabId)
stop()
setGainDb(value)
getState()
getMetrics()
```

The exact TypeScript API is an implementation-spec concern.

### 7.3 Audio graph

The baseline graph is:

```text
MediaStreamSource
      |
      +------> Meter (observation only)
      |
      v
   GainNode
      |
      v
 Safety Stage
      |
      v
 Destination
```

Measurement must not alter the signal path.

---

## 8. Loudness and normalization baseline

The initial proposal's RMS-to-dBFS AGC is superseded as the product normalization algorithm.

RMS and peak remain useful engineering/debugging metrics.

Automatic perceptual normalization should use a **BS.1770-derived loudness model**, with implementation and validation refined during P2.

### 8.1 Measurement concepts

The target measurement model includes:

- K-weighted loudness processing;
- momentary loudness (~400 ms concept);
- short-term loudness (~3 s concept);
- peak measurement;
- audio activity state.

Whole-session integrated loudness is not the primary real-time control signal for continuous browser playback.

### 8.2 Control separation

The following components remain separate:

```text
Loudness Meter
      |
      v
Activity Detector
      |
      v
Normalization Controller
      |
      v
Gain Composition
      |
      v
Peak Safety
```

The Meter describes the signal.

The Controller decides desired normalization.

The Gain Processor applies gain.

The Safety stage constrains unsafe output.

### 8.3 Target loudness

The old fixed `-18 dBFS` target is superseded.

The engine uses a configurable:

```text
targetLufs
```

The final product default is selected from P2 validation evidence rather than frozen before testing.

The UI may expose semantic presets such as Quiet / Normal / Loud rather than raw LUFS values.

### 8.4 Activity handling

Inactivity/silence must not cause uncontrolled gain increase.

When the signal is considered inactive, normalization gain should normally be frozen rather than repeatedly increased or reset.

### 8.5 Controller behavior

The controller must support:

- target error calculation;
- configurable auto-gain bounds;
- deadband/hysteresis;
- temporal smoothing/rate limiting;
- asymmetric response;
- activity gating.

The architecture freezes these mechanisms, not their final numerical constants.

Gain reduction may react faster than gain increase, but values such as the original 50 ms / 1500 ms are not frozen requirements.

### 8.6 Manual offset composition

The canonical control representation is dB:

```text
effectiveGainDb =
    autoGainDb
  + manualOffsetDb
```

This is equivalent to multiplying linear gains but is clearer for control, state, diagnostics, and UI.

### 8.7 Safety precedence

The loudness target is a soft target.

Output safety is a hard constraint.

Therefore:

```text
requestedGainDb
      |
      v
Safety constraint
      |
      v
appliedGainDb
```

`requestedGainDb` and `appliedGainDb` may differ.

P1 may provide a minimal safety hook/basic clipping guard; P2 owns the normalization-aware safety policy. Sophisticated mastering, multiband processing, or other unrelated dynamics processing is out of scope.

---

## 9. Multi-tab orchestration baseline

The system uses a common global loudness reference but independent per-tab controllers.

### 9.1 Global versus per-tab settings

Global state includes:

- global Auto Balance enabled/disabled;
- global listening-level/target setting.

Per-tab state includes:

- managed/unmanaged;
- normalization enabled/disabled;
- manual offset;
- runtime status.

Effective automatic normalization is conceptually:

```text
effectiveAuto =
    globalAutoEnabled
    AND tabAutoEnabled
```

Turning automatic normalization off MUST NOT disable manual per-tab volume adjustment.

### 9.2 Discovery versus control

Browser-level audible state may be used for discovery and presentation.

Actual DSP activity must be determined from the Audio Runtime's measurement/activity state.

### 9.3 Messaging

A small explicit message contract should be established by P3.

Conceptual Control → Audio commands:

```text
START_ENGINE
STOP_ENGINE
SET_NORMALIZATION
SET_TARGET
SET_MANUAL_OFFSET
```

Conceptual Audio → Control events:

```text
ENGINE_STARTED
ENGINE_STOPPED
ENGINE_ERROR
METRICS_UPDATE
```

DSP-rate data must remain inside the Audio Runtime.

Only aggregated/low-frequency metrics should cross extension messaging boundaries.

---

## 10. Product UI baseline

The Popup is a control/view surface, not an Audio Engine owner and not an audio-engineering dashboard.

Primary user flow:

**Discover → Enable → Balance → Adjust**

### 10.1 Popup content

The MVP Popup contains:

```text
Global Auto Balance
Listening Level

Managed Tabs
- status
- manual adjustment
- per-tab controls

Detected / relevant audio tabs
- Enable

Settings
```

### 10.2 User-facing state

Presentation state should use user concepts such as:

- Detected
- Enabled
- Balancing
- Balanced
- Manual
- Paused
- Unavailable
- Error

Internal states such as capture/runtime implementation details must not leak directly into the primary UI.

### 10.3 Technical metrics

Values such as:

- momentary LUFS;
- short-term LUFS;
- peak dBFS;
- auto gain;
- effective gain;
- capture state;
- engine state;

belong in diagnostics/advanced tooling, not the default user experience.

### 10.4 UI surfaces

v1 uses:

- Popup;
- minimal Options/Settings surface.

Side Panel is deferred.

Popup closure MUST NOT stop active Audio Engines.

### 10.5 Accessibility

The MVP must support:

- keyboard-operable controls;
- accessible slider labels;
- focus navigation;
- screen-reader labels;
- status communication that does not depend only on color;
- normal behavior under browser zoom.

---

## 11. Development mainline

Development is gate-driven rather than calendar-driven.

```text
P0  Cross-Browser Audio Capture & Processing Feasibility
 |
 v
P1  Stable Audio Engine
 |
 v
P2  Loudness Measurement & Automatic Normalization
 |
 v
P3  Multi-tab Orchestration
 |
 v
P4  Product UI & User Interaction
 |
 v
P5  Real-world Compatibility & Validation
 |
 v
P6  Hardening & Release
```

The original four-week schedule may be used later for estimation but is not an architectural or release contract.

---

## 12. P0 — Cross-Browser Audio Capture & Processing Feasibility

### Objective

Determine whether Chrome and Edge MV3 capabilities and their user-activation model can support the intended product interaction before building the full system.

### Required feasibility path

```text
User invocation
      |
      v
tab-level capture
      |
      v
Offscreen Audio Runtime
      |
      v
AudioContext
      |
      v
Gain / measurement
      |
      v
Processed playback
```

### Required validation

P0 must validate on Chrome Stable and Edge Stable:

- one-tab capture;
- processed playback without unintended duplicate audio;
- deterministic gain changes;
- readable PCM/level information;
- playback/pause;
- navigation behavior;
- stop/resource release;
- Service Worker lifecycle behavior;
- user activation/authorization behavior;
- at least two independently managed tabs.

P0 must explicitly answer:

1. What can one user invocation authorize?
2. What is the practical `targetTabId`/capture authorization boundary?
3. What interaction is required to enable a second tab?
4. How does Popup interaction affect activation?
5. What survives same-tab navigation?
6. What happens after browser/runtime restart?
7. Are Chrome and Edge materially different?

### P0 compatibility sampling

P0 may use a small representative set such as:

- ordinary HTML5 media;
- YouTube/MSE;
- live streaming;
- Web Audio;
- iframe media;
- representative protected media.

This is architecture feasibility sampling, not the full P5 compatibility matrix.

### P0 hard gate

P0 is **GO** only if:

- mainstream ordinary tab audio can reliably complete capture → process → playback;
- two tabs can be independently managed with acceptable interaction;
- lifecycle behavior is viable;
- Chrome and Edge both support an acceptable core path;
- known limitations are documented.

If capture technically works but the required user interaction makes the intended multi-tab product experience unacceptable, P0 is **NO-GO / architecture review**.

No P1 implementation should be treated as committed before this gate passes.

### P0 deliverables

- minimal feasibility harness/PoC;
- Chrome/Edge feasibility report;
- small compatibility matrix;
- activation/permission behavior report;
- capture architecture decision for P1.

P0 does NOT implement LUFS normalization, production UI, full compatibility handling, or release optimization.

---

## 13. P1 — Stable Audio Engine

### Objective

Convert the validated P0 capture path into a stable, testable per-tab AudioEngine.

### Scope

P1 owns:

- AudioEngine lifecycle;
- one-engine-per-managed-tab invariant;
- initial AudioSource abstraction;
- validated tab capture backend;
- deterministic dB gain;
- smooth gain transitions;
- engineering RMS/peak metering;
- minimal safety hook;
- Offscreen Audio Runtime ownership;
- Chrome/Edge platform adapter where evidence requires it.

### Validation

Known-signal tests should demonstrate approximately correct deterministic gain behavior, including:

- 0 dB;
- -6 dB;
- +6 dB.

P1 also validates:

- start/stop/restart;
- capture failure;
- navigation;
- tab close;
- two-engine independence;
- Chrome/Edge behavior.

### Exclusions

P1 does NOT implement:

- LUFS normalization;
- K-weighting;
- automatic gain control;
- final silence/activity gating;
- final normalization attack/release behavior;
- site-specific compatibility;
- MediaElement fallback;
- production Popup;
- sophisticated limiter.

---

## 14. P2 — Loudness Measurement & Automatic Normalization

### Objective

Implement and validate perceptual loudness measurement and stable automatic normalization on top of the P1 engine.

### Scope

P2 owns:

- BS.1770-derived Loudness Meter;
- activity detector;
- normalization controller;
- configurable target loudness;
- deadband/hysteresis;
- asymmetric adaptation;
- auto-gain limits;
- auto + manual gain composition;
- normalization-aware peak safety;
- deterministic audio benchmark suite.

### Benchmark classes

Use fixed, reproducible fixtures including:

- sine/reference signals;
- pink/noise-like test signals where useful;
- silence;
- transients;
- quiet/normal/loud speech;
- compressed music;
- dynamic music;
- silence → speech;
- quiet → loud;
- loud → quiet;
- speech pauses.

Record at least:

- input loudness;
- target;
- output loudness;
- gain trajectory;
- peaks;
- settling behavior.

### P2 acceptance dimensions

Do not prematurely freeze one universal “2 seconds / 2 dB” rule.

Evaluate:

- measurement accuracy;
- stable convergence;
- absence of gain oscillation/pumping;
- sensible quiet/loud transitions;
- no gain runaway during inactivity;
- peak/clipping safety;
- deterministic manual-offset composition.

Final numerical controller parameters are frozen from benchmark evidence.

---

## 15. P3 — Multi-tab Orchestration

### Objective

Build the control model for multiple independent AudioEngines without reintroducing centralized AGC.

### Scope

P3 owns:

- Managed Tab Registry;
- managed/captured/active state separation;
- start/stop routing;
- global target propagation;
- global and per-tab normalization toggles;
- manual offset routing;
- lifecycle coordination;
- explicit internal message contract;
- low-frequency metrics snapshots.

### Required behavior

With multiple managed tabs:

- each engine converges independently toward the shared target;
- changing Tab A source loudness affects only Engine A's normalization decision;
- manual offset on Tab B affects only Tab B;
- disabling automatic normalization on Tab C preserves manual control;
- closing one tab releases only that tab's resources.

### Persistence

Persist only appropriate state.

**Persistent settings** may include global defaults and user preferences.

**Session/runtime state** may include appropriate logical management information.

**DSP transient state** such as AudioContext objects, streams, filter history, and smoothing buffers MUST NOT be serialized as persistent state.

---

## 16. P4 — Product UI & User Interaction

### Objective

Expose the P0–P3 system through a simple non-technical user workflow.

### Scope

P4 owns:

- Popup;
- minimal Settings/Options;
- detected versus managed presentation;
- Enable/Disable;
- global Auto Balance;
- listening-level selection;
- per-tab manual offset;
- per-tab automatic normalization toggle;
- user-facing state;
- actionable errors;
- accessibility;
- diagnostics entry point.

### UX principles

- Prefer “Enable” / “Balance this tab” over technical capture terminology.
- Manual offset and automatic normalization are independent controls.
- Raw LUFS is not required in the primary UI.
- A semantic listening-level control is preferred for ordinary users.
- Errors should explain what the user can do next.
- Known unsupported pages/sources should be shown as unavailable rather than repeatedly failing.
- Popup lifetime is independent from AudioEngine lifetime.

The UI framework is an implementation choice, not an architecture dependency.

---

## 17. P5 — Real-world Compatibility & Validation

### Objective

Measure actual product coverage and classify real failures before adding compatibility complexity.

### Compatibility matrix

Test representative categories including:

- ordinary HTML5 video/audio;
- mainstream video/MSE;
- live streaming;
- music streaming;
- social/video feeds where relevant;
- news/embedded media;
- podcast players;
- Web Audio applications;
- WebRTC scenarios;
- iframe media;
- DRM/EME/protected media.

Test both Chrome Stable and Edge Stable.

Record more than PASS/FAIL. At minimum evaluate where applicable:

- capture;
- playback;
- metering;
- gain;
- normalization;
- manual offset;
- navigation;
- pause/resume;
- long-running behavior.

### Failure taxonomy

Classify failures before implementing workarounds:

- capture failure;
- playback failure;
- lifecycle failure;
- DSP failure;
- permission/activation failure;
- browser-specific failure;
- site-specific failure;
- protected-content limitation;
- unknown.

### Compatibility decision rule
