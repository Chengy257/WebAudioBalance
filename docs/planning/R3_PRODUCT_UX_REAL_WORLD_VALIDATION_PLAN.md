# R3 — Product UX & Real-world Validation Mainline Plan

> Status: **FROZEN PLAN — IMPLEMENTATION AFTER R2 GO**  
> Frozen Date: **2026-10-04**  
> Parent baseline: `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`  
> Dependencies: corrected R1 GO/FROZEN + R2 GO/FROZEN.

---

## 1. Objective

R3 turns the corrected Audio Core and reliable Runtime State into a product that is simple to understand and demonstrably works on real browser audio sources.

R3 owns two inseparable outcomes:

1. a clear user workflow for enabling and balancing tabs;
2. evidence-backed real-world Chrome/Edge validation.

R3 does not redesign the DSP or runtime protocol.

---

## 2. Frozen product workflow

The primary interaction remains:

```text
Discover
-> Enable
-> Balance automatically
-> optionally adjust Relative Level
-> Release when no longer wanted
```

The normal UI must answer four questions immediately:

- Which tabs are currently enabled?
- Are they actually balanced / balancing / paused / limited / failed?
- Which other tabs can I enable?
- How do I make one enabled tab slightly quieter or louder?

---

## 3. Primary information architecture

Recommended main Popup structure:

```text
Auto Balance                         ON

Listening Level
[ Quiet ] [ Normal ] [ Loud ]

Enabled Tabs
------------------------------------------------
YouTube
● Balanced
Relative Level:  Quieter -- Normal -- Louder
[Release]

Bilibili
◐ Balancing
Relative Level:  Quieter -- Normal -- Louder
[Release]

Other Audio Tabs
------------------------------------------------
Twitch                                  [Enable]
Spotify                                 [Enable]

Advanced / Diagnostics
```

Exact visual styling is not frozen here; information hierarchy and semantics are.

---

## 4. User-facing terminology

Use product concepts, not engineering internals.

Preferred:

- `Enable` / `Balance`;
- `Enabled Tabs`;
- `Relative Level`;
- `Quieter — Normal — Louder`;
- `Listening Level`;
- `Balanced`;
- `Balancing`;
- `Paused`;
- `Limited`;
- `Error`.

Move these to Advanced/Diagnostics:

- raw input LUFS;
- raw output LUFS;
- auto gain;
- total applied gain;
- AudioContext state;
- capture state;
- measurement sequence.

Do not show `Auto -6.4 dB / Total -4.4 dB` as primary product UI.

---

## 5. Trustworthy status model

R3 must consume R1/R2 authoritative state.

### 5.1 Connecting

Managed intent exists but capture/engine ACK has not completed.

### 5.2 Paused

Engine exists, but R1 activity state says meaningful audio is inactive.

### 5.3 Balancing

Active audio exists and valid output evidence has not yet met the frozen balanced criterion.

### 5.4 Balanced

Must use **processed-output verification**, never pre-gain input loudness.

Minimum condition:

```text
managed
AND captured/runtime healthy
AND active
AND outputShortTermValid
AND abs(outputTargetErrorLu) <= final R1 tolerance
AND stable for final R1/R3 dwell requirement
AND NOT target-invalidating limited state
```

The final dwell duration must come from corrected R1 evidence / R3 UX validation; it must not be invented by the presentation helper.

### 5.5 Limited

Audio is being processed safely, but the effective target cannot currently be reached because of headroom/gain constraints.

Primary UI can simply say `Limited` with a concise explanation on hover/details.

### 5.6 Error

A real command/runtime error exists.

The UI must show a recovery action where possible, e.g.:

- Retry;
- Release;
- Re-enable;
- unsupported page explanation.

---

## 6. Primary controls

### 6.1 Global Auto Balance

Clarify scope:

> applies to enabled tabs.

Do not imply the extension silently captures every browser tab.

### 6.2 Listening Level

Retain semantic presets for normal use.

Exact LUFS may be shown in Advanced settings/diagnostics.

A custom numeric target is optional and not required for R3 release.

### 6.3 Relative Level

Rename the current `Volume Adjustment` concept.

Internally:

```text
effectiveTarget = globalTarget + relativeOffset
```

Default position: Normal / 0 dB.

The UI may retain a bounded dB slider internally but should communicate relative intent first.

### 6.4 Per-tab Auto toggle

Keep only if real user testing shows it is useful and understandable.

If retained:

- Off = manual relative gain only;
- On = shared target normalization + relative offset.

It must not compete visually with the primary global Auto Balance concept.

---

## 7. Interaction reliability requirements

R3 UI must use R2 ACK/NACK and canonical snapshot semantics.

No control may appear successful solely because the Popup changed local state.

For every action:

```text
user action
-> in-flight state
-> authoritative success or failure
-> canonical snapshot reconciliation
-> final UI
```

Required:

- Enable;
- Release;
- global auto;
- listening target;
- relative level;
- per-tab auto if retained.

Avoid blocking browser `alert()` as the normal error UX. Use inline actionable status/toast/panel behavior.

---

## 8. Discovery behavior

Detected audio tabs must update while Popup is open.

R3 may use the R2 canonical discovery/state feed or explicitly rerender after browser tab queries.

Requirements:

- a newly audible tab appears without manual refresh;
- a no-longer-relevant tab disappears/updates appropriately;
- enabled tabs do not simultaneously appear as “Other Audio Tabs”;
- metadata is recognizable: favicon/title/site.

The current pattern of polling data without rerender is not acceptable.

---

## 9. Diagnostics

Diagnostics remain available but secondary.

Useful diagnostics:

- input/output Short-Term LUFS;
- effective target;
- output target error;
- applied gain;
- active/frozen/limited;
- limit reason;
- capture/engine state;
- last runtime error;
- browser/version.

Diagnostics should help debug real reports without overwhelming the default UI.

---

## 10. R3 automated UI behavior tests

Tests must exercise the real Popup DOM plus actual runtime messaging contracts rather than only presentation helper functions.

At minimum:

- initial snapshot render;
- detected tab arrival;
- Enable success;
- Enable failure;
- Connecting -> Balancing -> Balanced;
- Paused;
- Limited;
- runtime Error;
- Relative Level;
- Global Auto;
- Listening Level;
- Release;
- Popup close/reopen;
- stale/out-of-order telemetry ignored by revision/sequence where applicable.

A helper-unit test is not evidence that the complete interaction works.

---

## 11. Real-world compatibility program

R3 must revalidate representative sources in both current Chrome Stable and Edge Stable.

Target categories:

- ordinary HTML5 audio/video;
- YouTube/MSE;
- Bilibili or comparable MSE service;
- Twitch/live stream;
- Spotify Web or comparable music service;
- dialogue/podcast;
- Web Audio application;
- iframe media;
- WebRTC receive audio;
- protected/DRM source as a documented limitation where capture is unavailable/restricted.

For each source record:

```text
browser/version
site/source
capture success
processed playback
input loudness valid
output loudness valid
target convergence
relative-level behavior
pause/resume
navigation behavior
long-session stability
release/cleanup
errors/limitations
evidence type
```

No hard-coded PASS row counts as compatibility evidence.

---

## 12. Perceptual validation

Numerical output convergence is necessary but not sufficient for a volume-balancing product.

R3 should include a bounded listening evaluation using representative:

- speech;
- music;
- live stream;
- highly compressed content;
- dynamic content;
- ads/transitions.

Evaluate:

- disruptive loudness jumps when switching tabs;
- audible pumping/breathing;
- overreaction to silence;
- transition smoothness;
- whether `Quiet / Normal / Loud` presets feel meaningfully distinct.

This is product validation, not a new psychoacoustic research project.

---

## 13. Chrome + Edge policy

Maintain one Chromium codebase.

Do not add browser-specific branches unless actual evidence shows a behavior difference.

Real validation must record browser version and any differences.

A compatibility issue unique to one browser should be handled through the smallest adapter/guard possible.

---

## 14. R3 work packages

### R3-A — Product-state presentation

Implement:

- new primary hierarchy;
- authoritative statuses;
- relative-level semantics;
- reduced engineering clutter;
- inline error/recovery states.

### R3-B — Interaction integration

Implement:

- ACK-aware controls;
- detected-tab live refresh;
- stable slider interaction;
- Popup reopen state;
- diagnostics.

### R3-C — Real UI/E2E validation

Implement:

- actual Popup DOM/runtime integration suite;
- Chrome + Edge primary workflow tests;
- accessibility/basic keyboard regression.

### R3-D — Real-world compatibility and release evidence

Execute:

- real-site matrix;
- long-running sessions;
- perceptual checks;
- known limitation documentation;
- final release-readiness assessment.

---

## 15. R3 hard gate

R3 is GO only if:

1. the default UI exposes the Discover -> Enable -> Balance -> Relative Adjust workflow clearly;
2. all displayed runtime statuses come from authoritative R1/R2 state;
3. `Balanced` is based on processed-output convergence;
4. common controls produce visible authoritative success/failure;
5. discovered tabs update correctly;
6. Popup close/reopen preserves truthful state;
7. real Chrome and Edge tests pass the core workflow;
8. representative real-source evidence supports compatibility claims;
9. no known blocker causes “button appears to do nothing” behavior;
10. release documentation describes limitations truthfully.

---

## 16. Release closeout

Required artifact:

`docs/validation/R3_PRODUCT_UX_REAL_WORLD_VALIDATION_REPORT.md`

Only after corrected R1 GO, R2 GO, and R3 GO may the project reconsider a new release-ready version.

The old v1.0.0 RELEASE READY conclusion remains historical and must not be reinstated automatically.
