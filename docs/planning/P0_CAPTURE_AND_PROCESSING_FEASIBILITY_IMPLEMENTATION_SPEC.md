# P0 — Cross-Browser Audio Capture & Processing Feasibility Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**
>
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md`
>
> Phase: **P0 — Cross-Browser Audio Capture & Processing Feasibility**
>
> Implementation target: Google Chrome Stable + Microsoft Edge Stable, Chromium Manifest V3
>
> Purpose: provide a bounded, evidence-producing implementation task that can be handed directly to an implementation agent without pre-implementing P1–P6.

---

## 1. Authority and scope

This specification refines P0 of the frozen project mainline. It MUST NOT change the product model, architecture baseline, phase ownership, or deferred-scope decisions in the parent document.

P0 is a **feasibility phase**, not the first production implementation phase.

Its job is to answer, with executable evidence, whether the frozen primary path is viable:

```text
User invocation
      |
      v
MV3 Service Worker
      |
      v
tab-level capture authorization / stream ID
      |
      v
Offscreen Audio Runtime
      |
      v
MediaStream -> Web Audio graph
      |
      v
measurement + deterministic gain
      |
      v
processed playback
```

P0 MUST remain disposable/refactorable. Code produced here may inform P1 but MUST NOT be treated as the final AudioEngine architecture by default.

---

## 2. P0 questions that must be resolved

P0 is complete only when evidence answers all of the following.

### Q1 — Single-tab capture viability

Can a user-invoked MV3 extension reliably acquire audio from an ordinary active browser tab and consume it inside an offscreen extension document?

### Q2 — Processed playback viability

Can the captured stream be routed through Web Audio, measured, gain-adjusted, and returned to audible output without unintended duplicate playback?

### Q3 — User activation boundary

What exact user interaction is required to authorize capture of the current/target tab?

### Q4 — Multi-tab activation model

Can two different tabs be independently placed under management with an interaction model acceptable for the frozen product?

Record the exact interaction required for the second tab. Do not infer this from API documentation.

### Q5 — Navigation continuity

What happens to capture and the offscreen audio path when a managed tab navigates or reloads while retaining the same browser tab identity?

### Q6 — MV3 lifecycle viability

Does ordinary Service Worker suspension/restart leave the audio runtime viable, and can the Control Plane rediscover/reconcile state without depending on a permanently alive Service Worker?

### Q7 — Chrome / Edge parity

Does the same core implementation work in current Chrome Stable and Edge Stable? If not, what behavior differs?

### Q8 — Resource cleanup

Can stop, tab close, capture failure, and repeated start/stop release MediaStream, AudioContext/audio nodes, listeners, timers, and logical state cleanly?

---

## 3. Explicit non-goals

P0 MUST NOT implement or optimize:

- BS.1770 / LUFS;
- K-weighting;
- automatic loudness normalization;
- activity/silence algorithms;
- final peak limiter/safety policy;
- production AudioEngine abstraction;
- production Managed Tab Registry;
- production Popup;
- site rules;
- MediaElement fallback backend;
- Content Script media interception;
- DNR/CORS rewriting;
- persistent Service Worker keepalive;
- production storage schema;
- P5-scale compatibility coverage;
- store packaging;
- final performance optimization.

RMS/peak-style engineering measurements are permitted only to prove that PCM/audio observation works.

---

## 4. Known platform assumptions versus experimental questions

P0 distinguishes documented platform facts from behavior that this project must verify experimentally.

### 4.1 Documented assumptions used by the PoC

The implementation may assume the current Chromium extension model supports:

- MV3 Service Worker;
- `tabCapture` permission/API;
- Offscreen Document API;
- a stream ID obtained through the extension capture flow being consumed by an appropriate extension offscreen context on supported Chromium versions;
- Web Audio routing of the captured MediaStream;
- capture initiation being tied to user invocation of the extension.

These assumptions justify the PoC architecture but do NOT substitute for browser testing.

### 4.2 Experimental questions

The implementation MUST measure rather than assume:

- exact user-activation scope;
- exact second-tab workflow;
- same-tab navigation behavior;
- reload behavior;
- Service Worker termination/restart behavior;
- browser restart behavior;
- Chrome/Edge behavioral parity;
- protected-media behavior;
- iframe/media-player behavior;
- long-lived offscreen/runtime behavior.

---

## 5. Minimal repository layout

P0 should add only the structure needed for the feasibility harness.

Recommended logical layout:

```text
src/
  background/
    service-worker.*
  offscreen/
    offscreen.html
    offscreen.*
  shared/
    messages.*
  popup/
    popup.html
    popup.*

manifest.json
docs/
  planning/
    P0_CAPTURE_AND_PROCESSING_FEASIBILITY_IMPLEMENTATION_SPEC.md
  validation/
    P0_FEASIBILITY_REPORT.md
    P0_COMPATIBILITY_MATRIX.md
```

Exact source language/build-tool file extensions may follow the smallest maintainable implementation choice.

Do not create empty P1–P6 production modules.

---

## 6. Harness architecture

### 6.1 Control Plane PoC

The Service Worker is responsible only for:

- receiving an explicit user command;
- resolving the target tab;
- ensuring the offscreen document exists;
- requesting a capture stream ID;
- sending the stream ID and tab identity to the offscreen runtime;
- issuing stop/gain/status requests;
- receiving low-frequency status/measurement reports;
- observing capture/tab lifecycle events needed for experiments.

It MUST NOT perform DSP.

### 6.2 Audio Plane PoC

The Offscreen Document is responsible for:

- consuming the capture stream ID;
- creating the MediaStream;
- creating the AudioContext;
- creating the source/gain/measurement/output path;
- applying deterministic manual test gain;
- reporting minimal status/metrics;
- stopping and releasing the runtime.

### 6.3 Minimal PoC audio graph

```text
Captured MediaStream
        |
        v
MediaStreamAudioSourceNode
        |
        +------> engineering meter
        |
        v
     GainNode
        |
        v
AudioContext.destination
```

No normalization controller belongs in this graph during P0.

### 6.4 Minimal control surface

P0 may use a deliberately plain popup/debug UI containing only controls needed to execute experiments, for example:

- Enable current/target tab;
- Stop;
- test gain selector/buttons;
- runtime state;
- basic meter/status;
- diagnostic log export/copy if useful.

This UI is test instrumentation and MUST NOT be treated as the P4 product UI.

---

## 7. P0 implementation work packages

These are work packages, not separate project phases. They may be implemented sequentially on one P0 branch.

### WP0 — Scaffold and observability

Implement:

- minimal MV3 manifest;
- minimal Service Worker;
- minimal offscreen document;
- minimal debug popup;
- explicit structured logging;
- shared message definitions;
- browser/runtime version capture in validation output.

The manifest MUST start with the minimum permissions required by the PoC. Do not inherit `declarativeNetRequest` or `<all_urls>` from the historical proposal unless an experiment demonstrates a need.

**Exit condition:** extension loads unpacked in both Chrome and Edge and control/offscreen messaging can be demonstrated.

### WP1 — Single-tab capture loop

Implement the smallest path from explicit user invocation to tab audio capture.

Required observations:

- capture request succeeds/fails with recorded error;
- stream ID is consumed promptly;
- MediaStream contains an audio track;
- track readyState and relevant settings can be inspected;
- stopping the PoC stops the track.

**Exit condition:** ordinary media in one tab can be captured in Chrome and Edge.

### WP2 — Web Audio processing and audible return

Add:

- MediaStreamAudioSourceNode;
- GainNode;
- engineering level measurement;
- connection to destination.

Test deterministic gain states such as:

- unity / 0 dB;
- attenuation (e.g. -6 dB);
- boost (e.g. +6 dB), using a safe source level.

Confirm:

- output remains audible;
- gain changes are clearly observable;
- no unintended direct + processed duplicate path is heard;
- the meter responds to source audio;
- stop returns the tab/runtime to an expected state.

P0 is not required to provide production-quality gain smoothing.

**Exit condition:** capture → measure → gain → output works in both browsers.

### WP3 — Activation and two-tab experiment

This is a P0 hard-risk work package.

Experiment with two ordinary media tabs.

Record:

- where the user must click/invoke the extension;
- whether capture can target a tab other than the invocation context;
- whether enabling Tab B requires switching to/invoking on Tab B;
- whether an already-running Tab A continues while Tab B is enabled;
- whether both streams remain independently controllable;
- whether stopping one affects the other.

The implementation MUST NOT hide an inconvenient activation requirement behind automation or unsupported workarounds.

**Exit condition:** exact multi-tab interaction model is documented and two independent streams are demonstrated, or the phase is escalated to HOLD/NO-GO.

### WP4 — Lifecycle experiment

Run controlled experiments for:

- popup close/reopen;
- source media pause/resume;
- tab reload;
- same-tab navigation;
- Service Worker suspension/termination and subsequent wake;
- offscreen document/runtime state inspection;
- managed tab close;
- explicit stop;
- repeated start/stop cycles.

Where practical, also record browser restart behavior. Browser restart continuity is an observation target, not a requirement that P0 invent persistent capture.

For each event record:

- expected state before event;
- actual capture state after event;
- actual AudioContext/track state;
- whether audio continues;
- whether user reactivation is required;
- whether cleanup/recovery succeeds.

**Exit condition:** lifecycle matrix is complete enough to decide whether the frozen Control Plane / Audio Plane split is viable.

### WP5 — Representative compatibility sampling

Use a deliberately small sample to detect architecture-class failures.

Required categories:

1. plain HTML5 audio/video;
2. MSE/mainstream video;
3. live streaming;
4. Web Audio source;
5. iframe-hosted media;
6. representative protected/DRM media where accessible for testing.

For each category record only P0-relevant dimensions:

- capture start;
- audible processed playback;
- measurement available;
- gain control works;
- major limitation/error.

Do NOT add site-specific fixes in P0.

**Exit condition:** no unclassified architecture-blocking failure remains hidden by testing only one trivial page.

### WP6 — Cleanup and repeatability

Validate:

- stop all MediaStream tracks;
- disconnect audio nodes;
- close AudioContext where appropriate;
- remove runtime entries;
- no duplicate runtime for one tab;
- no duplicated listeners/timers after restart;
- repeated enable/disable does not accumulate obviously stale capture sessions.

Use browser task-manager/devtools observations where useful, but do not turn P0 into a performance-optimization phase.

**Exit condition:** the PoC can be repeatedly exercised without obvious resource/lifecycle corruption.

### WP7 — Evidence consolidation and gate decision

Complete:

- `docs/validation/P0_FEASIBILITY_REPORT.md`;
- `docs/validation/P0_COMPATIBILITY_MATRIX.md`;
- final GO / HOLD / NO-GO statement;
- explicit P1 capture-backend recommendation;
- list of limitations/deferred findings.

No production refactor is required before the gate decision.

---

## 8. Required message boundary for the PoC

Use an explicit, small message protocol so the experiment reflects the frozen Control Plane / Audio Plane separation.

Minimum conceptual commands:

```text
ENSURE_AUDIO_RUNTIME
START_CAPTURE { tabId, streamId }
SET_TEST_GAIN { tabId, gainDb }
STOP_CAPTURE { tabId }
QUERY_RUNTIME_STATE
```

Minimum conceptual events:

```text
CAPTURE_STARTED
CAPTURE_STOPPED
CAPTURE_ERROR
METRICS_UPDATE
RUNTIME_STATE
```

Exact names/types may differ, but messages must be typed/validated enough that failures can be diagnosed.

Do not transmit raw PCM through extension messaging.

---

## 9. Required runtime observations

For each active PoC stream, expose enough diagnostic state to answer the feasibility questions.

Recommended fields:

```text
tabId
browser
browserVersion
captureStatus
trackReadyState
audioContextState
testGainDb
rmsDbFS or equivalent engineering level
startedAt
lastMetricAt
lastError
```

This is diagnostic state, not the final P3 registry schema.

---

## 10. Browser test policy

### 10.1 Required browsers

Every P0 hard-gate experiment must be run on:

- current Google Chrome Stable;
- current Microsoft Edge Stable.

Record exact versions and OS.

### 10.2 Shared implementation first

Use the same source/manifest architecture in both browsers.

Do not create separate Chrome and Edge implementations.

If a browser-specific difference is found:

1. reproduce it;
2. record it;
3. classify it;
4. introduce the smallest adapter/conditional only if required to continue the feasibility test.

### 10.3 Minimum browser version

P0 MUST NOT invent a marketing minimum browser version.

The feasibility report should instead record:

- APIs actually required;
- documented API availability relevant to the architecture;
- versions actually tested.

The supported minimum version is frozen later from this evidence.

---

## 11. Test matrix

The implementation agent must execute and record at least the following cases.

| ID | Experiment | Chrome | Edge | Gate relevance |
|---|---|---|---|---|
| T01 | Extension loads; SW ↔ offscreen messaging | required | required | hard |
| T02 | Single ordinary tab capture | required | required | hard |
| T03 | Captured audio returned audibly | required | required | hard |
| T04 | Engineering meter responds | required | required | hard |
| T05 | 0/-6/+6 dB test gain behavior | required | required | hard |
| T06 | Stop releases capture | required | required | hard |
| T07 | Popup close/reopen | required | required | hard |
| T08 | Media pause/resume | required | required | hard |
| T09 | Same-tab reload/navigation | required | required | hard |
| T10 | Service Worker restart/wake | required | required | hard |
| T11 | Two independently captured tabs | required | required | hard |
| T12 | Change gain A without changing B | required | required | hard |
| T13 | Stop A without stopping B | required | required | hard |
| T14 | Close managed tab | required | required | hard |
| T15 | Repeated enable/disable | required | required | hard |
| T16 | MSE/mainstream video sample | required | required | evidence |
| T17 | Live-stream sample | required | required | evidence |
| T18 | Web Audio sample | required | required | evidence |
| T19 | iframe sample | required | required | evidence |
| T20 | protected/DRM sample | required where accessible | required where accessible | boundary |
| T21 | Browser restart observation | recommended | recommended | evidence |

A failed compatibility sample does not automatically fail P0. A failure is hard-gate relevant only if it undermines the primary architecture or target product interaction.

---

## 12. Evidence recording rules

Each test result must record:

- test ID;
- date;
- OS;
- browser and exact version;
- extension commit SHA;
- source/test page category;
- steps;
- expected result;
- observed result;
- PASS / FAIL / BLOCKED;
- error/log evidence;
- interpretation;
- gate impact.

Do not convert uncertainty into PASS.

If a behavior is inconsistent, record it as unstable/reproducibility failure and repeat enough times to characterize it.

---

## 13. P0 compatibility matrix format

`P0_COMPATIBILITY_MATRIX.md` should use a compact evidence table such as:

| Category | Chrome capture | Chrome processing | Edge capture | Edge processing | Notes / limitation |
|---|---|---|---|---|---|
| HTML5 | | | | | |
| MSE/video | | | | | |
| live | | | | | |
| Web Audio | | | | | |
| iframe | | | | | |
| protected/DRM | | | | | |

Do not inflate P0 into the comprehensive P5 matrix.

---

## 14. Feasibility report structure

`P0_FEASIBILITY_REPORT.md` must contain:

1. Executive result: GO / HOLD / NO-GO;
2. tested environment;
3. implementation commit;
4. capture architecture actually tested;
5. single-tab findings;
6. processed-playback findings;
7. user-activation findings;
8. two-tab findings;
9. navigation/lifecycle findings;
10. Service Worker/offscreen findings;
11. Chrome/Edge parity findings;
12. compatibility sample summary;
13. cleanup/repeatability findings;
14. known limitations;
15. unresolved blockers;
16. recommendation for P1;
17. explicit statement of whether the frozen Mainline remains valid.

The report must separate documented API expectations from observed test evidence.

---

## 15. Gate classification

### 15.1 GO

P0 is GO only when all of the following are supported by reproducible evidence:

- ordinary tab audio reliably completes capture → Web Audio processing → audible output;
- deterministic gain and engineering measurement work;
- the primary path works in both Chrome Stable and Edge Stable;
- at least two tabs can remain independently processed;
- the user interaction required to enable multiple tabs is compatible with the product model;
- ordinary MV3 Service Worker lifecycle does not require permanent keepalive for ongoing audio processing;
- cleanup/restart behavior is sufficiently controlled to justify P1;
- remaining compatibility limitations are bounded and do not invalidate the primary architecture.

### 15.2 HOLD

Use HOLD when the architecture remains plausible but a bounded unresolved issue prevents a responsible GO decision, for example:

- a browser-version-specific defect requires confirmation;
- two-tab behavior is inconsistent but not clearly impossible;
- lifecycle recovery requires one additional focused experiment;
- Chrome/Edge parity is unclear due to a reproducibility problem.

HOLD must name the smallest additional experiment needed.

### 15.3 NO-GO / architecture review

Use NO-GO when evidence invalidates a frozen product/architecture assumption, including:

- primary tab-level capture cannot provide a stable processed-audio path for ordinary target use;
- multi-tab capture/control cannot be achieved under an acceptable user interaction model;
- Chrome and Edge cannot share a viable first-class architecture without major divergence;
- ongoing audio processing fundamentally depends on keeping the Service Worker permanently alive;
- capture/output behavior creates an unavoidable architecture-level playback defect.

NO-GO MUST stop progression to P1 and trigger the Mainline change-control process.

---

## 16. What does not constitute a P0 NO-GO by itself

The following findings should normally be documented/deferred rather than treated as automatic architecture failure:

- one protected/DRM service is unavailable;
- one iframe configuration fails;
- a specific website behaves differently;
- a site requires later compatibility investigation;
- P0 gain transitions are not production-smooth;
- LUFS is not implemented;
- performance is not yet optimized;
- browser restart does not automatically restore active capture;
- a future product UI interaction is not polished.

These become P5/P6 or later-phase concerns unless evidence shows they are manifestations of a broader architecture failure.

---

## 17. Implementation discipline for Codex/agent execution

The implementation agent MUST:

1. work from the frozen Mainline and this specification;
2. use a dedicated P0 working branch;
3. keep commits small enough to review by work package;
4. avoid unrelated refactors/features;
5. preserve test evidence and failure logs;
6. not silently change the Mainline;
7. not add fallback capture backends to make tests appear green;
8. not add site-specific hacks;
9. not add DNR/CORS manipulation;
10. not add Service Worker keepalive tricks;
11. stop and report if a hard architecture assumption is contradicted.

A failing experiment is a valid P0 result. The purpose is to learn whether the architecture works, not to force a PASS.

---

## 18. Suggested execution sequence

Execute in this order:

```text
WP0 Scaffold
   |
WP1 Single-tab capture
   |
WP2 Web Audio processing/output
   |
WP3 Activation + two-tab
   |
WP4 Lifecycle
   |
WP5 Representative compatibility
   |
WP6 Cleanup/repeatability
   |
WP7 Evidence + gate decision
```

WP3 is intentionally early. If the multi-tab activation model is unacceptable, do not spend time broadening compatibility testing before reporting the blocker.

---

## 19. Required closeout state

Before P0 is considered complete:

- implementation branch is internally reviewed;
- required tests have recorded evidence;
- compatibility matrix is complete for the P0 sample;
- feasibility report is complete;
- GO/HOLD/NO-GO is explicit;
- any Mainline contradiction is explicitly identified;
- P1 recommendation is bounded to evidence;
- no P1/P2/P4 production work is disguised inside P0.

If GO, the next planning task is the P1 Stable Audio Engine implementation specification, informed by P0 evidence.

If HOLD, execute only the named focused follow-up.

If NO-GO, return to architecture review before any P1 planning.

---

## 20. Freeze statement

This document freezes the implementation scope for **P0 — Cross-Browser Audio Capture & Processing Feasibility**.

P0 exists to establish whether WebAudioBalance's primary Chromium MV3 audio-capture architecture and multi-tab product interaction are viable in real Chrome and Edge behavior.

**Status: FROZEN IMPLEMENTATION SPEC — ready for implementation and evidence collection.**
