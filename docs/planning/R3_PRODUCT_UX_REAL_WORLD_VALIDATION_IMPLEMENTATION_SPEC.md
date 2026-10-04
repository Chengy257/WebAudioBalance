# R3 — Product UX & Real-world Validation Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC — CODE START AFTER R2 GO**  
> Frozen Date: **2026-10-04**  
> Parent plan: `docs/planning/R3_PRODUCT_UX_REAL_WORLD_VALIDATION_PLAN.md`  
> Dependencies: R1 GO/FROZEN and R2 GO/FROZEN  
> Purpose: deliver a coherent Popup product experience and rebuild release evidence on real Chrome/Edge audio sources.

---

## 1. Implementation outcome

R3 converts the corrected technical stack into a user-facing product.

The default experience must make this workflow obvious:

```text
Discover -> Enable -> Balance -> Relative Adjust -> Release
```

R3 is also the final post-v1 product validation phase. It does not declare a release merely because UI tests pass.

---

## 2. Primary source files

Expected modification:

```text
src/popup/popup.html
src/popup/popup.css
src/popup/popup.js
src/popup/state-presenter.js
```

R2 protocol helpers/state types may be consumed but not redesigned.

Potential supporting modules:

```text
src/popup/components/*
src/popup/view-model.js
```

Only introduce components if they reduce complexity. A framework migration is out of scope.

Tests:

```text
test/test-r3-ui.mjs
test/run-r3-popup-e2e.mjs
test/run-r3-compatibility.mjs
test/fixtures/r3/*
```

Closeout:

```text
docs/validation/R3_PRODUCT_UX_REAL_WORLD_VALIDATION_REPORT.md
```

---

## 3. Popup information architecture

Default hierarchy:

```text
Header / product identity

Auto Balance                    [On/Off]
Listening Level                 [Quiet] [Normal] [Loud]

Enabled Tabs (N)
  Tab Card
  Tab Card

Other Audio Tabs (N)
  Detected Tab
  Detected Tab

Advanced / Diagnostics
```

The most common action must not require opening Diagnostics.

---

## 4. Global controls

### 4.1 Auto Balance

Label:

```text
Auto Balance
Applies to enabled tabs
```

The control represents R2 global intent and must settle to the authoritative state after ACK/reconciliation.

### 4.2 Listening Level

Primary presets:

```text
Quiet
Normal
Loud
```

Continue using the project's frozen target mapping unless R3 validation demonstrates a specific usability problem.

Normal UI does not need to expose raw LUFS.

Advanced diagnostics may show the exact target.

---

## 5. Enabled-tab card

Each enabled tab card contains:

- favicon;
- recognizable title;
- optional concise hostname;
- status;
- Relative Level control;
- Release;
- optional per-tab Auto Balance only if retained after UX review.

Recommended minimal card:

```text
[icon] YouTube
       ● Balanced

Relative Level
Quieter ----|---- Normal ----|---- Louder

[Release]
```

Raw Auto/Total gain chips must leave the primary card.

---

## 6. Relative Level interaction

Rename `Volume Adjustment` to `Relative Level`.

Product semantics:

```text
global target + relative level offset
```

Default:

```text
Normal / 0 dB
```

The underlying numeric range may remain ±12 dB unless real UX validation demonstrates a reason to change it.

### Interaction behavior

During drag:

- thumb/value may update locally for responsiveness;
- command is debounced;
- an in-flight marker may be subtle;
- authoritative success updates the canonical state;
- NACK restores/reconciles to the actual value and shows an inline error.

Do not leave a slider at a value the runtime rejected.

---

## 7. Status presenter

Replace the current input-LUFS-based Balanced logic.

### 7.1 Precedence

Recommended status precedence:

```text
Error
Connecting
Paused
Limited
Manual
Balancing / Balanced
```

### 7.2 Error

When R2 runtime state contains an active actionable error.

Show concise reason + Retry/Release where appropriate.

### 7.3 Connecting

```text
intent.managed == true
AND runtime.captured == false
AND start command is in flight / no terminal error
```

### 7.4 Paused

```text
captured
AND runtime healthy
AND active == false
```

### 7.5 Limited

```text
active
AND limited == true
```

Do not show Balanced simultaneously.

### 7.6 Manual

If effective auto normalization is disabled for that tab.

### 7.7 Balanced

Required evidence:

```text
managed
AND captured
AND active
AND outputShortTermValid
AND abs(outputTargetErrorLu) <= 1.0 LU
AND limited == false
AND runtime healthy
AND tolerance condition held continuously for balancedDwellMs
```

Initial `balancedDwellMs`:

```text
1500 ms
```

Make it a single configurable presentation constant.

R3 validation may tune it, but any change must be documented in the R3 report.

### 7.8 Balancing

All other healthy, active, auto-normalizing states.

---

## 8. Detected / Other Audio Tabs

Requirements:

- show audible tabs not already managed;
- include current active tab when relevant even if it has not yet emitted browser `audible=true`;
- identify unsupported browser-internal/store pages before Enable;
- update while Popup is open;
- newly audible tabs appear without manual Refresh;
- tabs that become managed disappear from the “Other” section;
- closed tabs disappear.

Use R2 canonical state plus direct browser discovery only where R2 intentionally leaves discovery to Popup.

Every discovery refresh must actually trigger rendering/state update.

---

## 9. Enable interaction

Sequence:

```text
click Enable
-> Connecting state
-> acquire stream ID under user gesture where required
-> START command
-> await explicit result
-> reconcile canonical snapshot
-> Balancing / Paused / Error
```

On failure:

- restore button availability;
- show inline actionable message;
- do not rely on `alert()` as normal UX.

Retry should reuse the same canonical start path.

---

## 10. Release interaction

Sequence:

```text
Release
-> in-flight disabled control
-> STOP command
-> ACK
-> canonical snapshot reconciliation
-> card leaves Enabled Tabs
```

On NACK:

- card remains;
- display runtime error;
- do not visually pretend release succeeded.

---

## 11. Error UX

Replace ordinary `alert()` usage with an inline notification/toast/card error surface.

Minimum properties:

- concise human-readable message;
- technical code/details available in Diagnostics;
- Retry if retryable;
- Release if the runtime is partially alive and release is appropriate.

Avoid repeated modal interruption during slider/global changes.

---

## 12. Diagnostics redesign

Diagnostics is secondary and collapsible.

Display:

```text
Browser/version
tabId
engine state
AudioContext state
active/frozen/limited
limit reason

input Momentary / Short-Term
output Momentary / Short-Term
effective target
output target error

relative offset
desired auto gain
applied gain

runtime instance
product revision
metrics sequence
last runtime error
```

Do not expose misleading legacy values.

Retain “Copy diagnostics report”.

---

## 13. Accessibility

Maintain:

- keyboard access for all controls;
- proper button semantics;
- `role=switch` only where needed;
- accessible names;
- visible focus;
- status text not communicated by color alone;
- slider `aria-valuenow` and understandable label;
- no essential information only in hover tooltip.

Keyboard-only core workflow must pass.

---

## 14. Popup performance/state behavior

R3 must respect R2 revisions/sequences.

- ignore stale product snapshot revisions;
- ignore stale metrics sequences;
- do not fully rebuild the DOM at telemetry cadence if a focused control would be disrupted;
- active slider drag must not snap due incoming telemetry;
- Popup close/reopen must reconstruct entirely from R2 canonical state.

No UI state should be required for audio processing to continue.

---

## 15. Real Popup E2E test

The E2E harness must instantiate/load the actual extension Popup and actual Service Worker/Offscreen flow.

Required scenario:

```text
open popup
-> detected audio tab appears
-> Enable
-> Connecting
-> Balancing
-> Balanced
-> change Relative Level
-> output target changes and reconverges
-> close popup
-> audio continues
-> reopen popup
-> same authoritative state
-> pause source
-> Paused
-> resume
-> Balancing -> Balanced
-> create headroom-limited source
-> Limited
-> recover
-> Balanced
-> Release
-> card removed
```

Also force:

- start failure;
- setting failure;
- runtime loss/reconciliation;
- unsupported page.

---

## 16. Real-world compatibility matrix

R3 must validate both current Chrome Stable and Edge Stable.

Required categories:

1. controlled HTML5 audio/video fixture;
2. YouTube or equivalent MSE VOD;
3. Bilibili or comparable MSE source;
4. Twitch or comparable live stream;
5. Spotify Web or comparable music stream;
6. spoken podcast/dialogue;
7. Web Audio application;
8. iframe-hosted media;
9. WebRTC receive audio;
10. protected/DRM source as limitation evidence where capture is restricted.

For each browser/source record:

```text
browser/version
date
source URL/category
capture result
processed playback
input meter validity
output meter validity
convergence
relative level
pause/resume
navigation
30+ minute stability where applicable
release/cleanup
error/limitation
evidence type
```

Do not claim category PASS from a static fixture record.

---

## 17. Compatibility acceptance classes

Use explicit outcomes:

```text
PASS
PASS_WITH_LIMITATION
UNSUPPORTED_PLATFORM_CONSTRAINT
FAIL_PRODUCT_DEFECT
NOT_TESTED
```

This prevents “known browser restriction” and “our bug” from being conflated.

A release blocker is any common-source `FAIL_PRODUCT_DEFECT` affecting the primary workflow.

---

## 18. Perceptual evaluation

Use a bounded listening check after numerical validation.

Representative material:

- speech/dialogue;
- dense mastered music;
- dynamic music;
- live stream;
- ad/content transition;
- very quiet programme;
- high-peak material.

Evaluate:

- tab-switch loudness shock;
- pumping/breathing;
- slow/annoying catch-up;
- silence/resume behavior;
- whether Relative Level is intuitive;
- whether Quiet/Normal/Loud are useful.

Record observations in the R3 validation report.

This is not a substitute for numerical R1 evidence.

---

## 19. Long-session validation

At least one Chrome and one Edge run must exercise multiple enabled tabs for an extended session.

Target:

```text
>= 30 minutes
```

Record:

- AudioContext health;
- engine count;
- output convergence snapshots;
- telemetry stability;
- CPU/memory observations where practical;
- no progressive gain drift;
- no UI state desynchronization;
- clean release.

---

## 20. R3 work packages and order

### R3-A — Presenter + information hierarchy

Implement:

- status model;
- layout;
- Relative Level terminology;
- diagnostics separation.

### R3-B — Reliable interactions

Implement:

- ACK-aware controls;
- inline errors;
- discovery refresh;
- Popup reopen;
- stale revision/sequence handling.

### R3-C — Real Popup/browser E2E

Implement and pass the actual extension workflow tests in Chrome/Edge.

### R3-D — Real-world compatibility + closeout

Execute real-source matrix, perceptual evaluation, long-session validation, and produce release assessment.

Do not create a separate planning document for every site/category.

---

## 21. R3 release gate

R3 GO requires:

```text
clear primary workflow                    PASS
Balanced uses processed output            PASS
controls reconcile with ACK/NACK          PASS
no "button did nothing" blocker           PASS
detected tabs update live                  PASS
popup close/reopen truthful               PASS
Chrome core E2E                            PASS
Edge core E2E                              PASS
representative real-source matrix          PASS / documented limitation
perceptual evaluation acceptable          PASS
long-session stability                     PASS
known limitations documented              PASS
```

Required closeout:

`docs/validation/R3_PRODUCT_UX_REAL_WORLD_VALIDATION_REPORT.md`

Only after R3 GO should the repository reconsider a new release version and regenerate release packaging/documentation.
