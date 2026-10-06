# WebAudioBalance — Capture Authorization & Multi-Tab Recovery Plan

> Status: **FROZEN / READY FOR IMPLEMENTATION**  
> Frozen Date: **2026-10-06**  
> Scope: **Capture authorization correction, user workflow recovery, real multi-tab validation, and v1.1.1 patch release**  
> Parent baselines:
> - `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`
> - `docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`
> - `docs/planning/FINAL_RELEASE_CORRECTION_PLAN.md`
>
> Current public release: `v1.1.0`  
> Target corrective release: **`v1.1.1`**

---

## 1. Why this recovery plan exists

Real user operation after the v1.1.0 release exposed a release-blocking defect in the capture initiation workflow.

Observed error:

```text
Could not balance tab:
tabCapture.getMediaStreamId failed:
Extension has not been invoked for the current page
(see activeTab permission).
Chrome pages cannot be captured.
```

The current popup lists multiple audible tabs and allows the user to press `Balance` on a background tab. The implementation then calls:

```js
chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
```

for that target tab.

This workflow assumes that selecting a background tab inside the extension popup is sufficient to authorize capture for that tab. That assumption is false in normal Chromium user operation.

The initial capture authorization must be tied to a valid user invocation for the target page/tab. A popup opened from one active tab cannot be treated as blanket authorization to acquire media stream IDs for arbitrary background tabs.

The fallback path in the Service Worker does not solve this because it repeats the same unauthorized `getMediaStreamId({ targetTabId })` call.

Therefore v1.1.0 is reclassified as:

> **RELEASED, BUT CORE MULTI-TAB USER WORKFLOW NOT ACCEPTED**

This is a real product defect and requires a patch release.

---

## 2. Recovery objective

Restore the intended product capability without fighting the browser permission model.

The corrected product definition is:

> WebAudioBalance can centrally manage and balance multiple tabs that have each been explicitly enabled by the user through a valid user invocation on that tab. Initial capture authorization is per-tab; ongoing monitoring, relative-level adjustment, shared-target control, and release may be managed centrally.

```text
Tab A
user explicitly invokes WebAudioBalance
→ capture A authorized
→ A becomes managed

Tab B
user switches to B and explicitly invokes WebAudioBalance
→ capture B authorized
→ B becomes managed

Then:
A + B remain centrally managed
→ independent AudioEngines
→ shared absolute target
→ independent Relative Level
→ cross-tab perceptual balancing
```

The product must no longer imply that one popup invocation can remotely authorize first-time capture of arbitrary background tabs.

---

## 3. Recovery phase structure

```text
RA-1  Capture authorization model correction
RA-2  Popup and user workflow correction
RA-3  Real user-path browser validation
RA-4  Simultaneous multi-tab capability verification
RA-5  v1.1.1 closeout and release
```

This is a narrow recovery phase. Do not reopen the DSP, loudness model, R2 state architecture, or general UI design unless a recovery test exposes a directly related defect.

---

# 4. RA-1 — Capture Authorization Model Correction

## 4.1 Objective

Make first-time capture initiation obey the real Chromium permission model.

## 4.2 Core rule

A tab may enter first-time capture only when the extension has a valid user invocation associated with that target tab.

Do not attempt to acquire a new stream ID for an arbitrary background tab from a popup opened on another tab.

## 4.3 Current invalid path

```text
Popup opened on Tab A
→ list background Tab B
→ user clicks Balance on Tab B card
→ getMediaStreamId(targetTabId = B)
```

This must be removed as a supported workflow and must not be silently retried in the Service Worker.

## 4.4 Correct initial-capture paths

### A. Current-tab popup action

The user is on the target tab, opens WebAudioBalance, and chooses `Balance This Tab`.

The popup may obtain the stream ID while the valid user invocation is active, then pass that stream ID to the Service Worker.

### B. Context menu

Existing action `WebAudioBalance: Balance this tab` may be retained as a valid explicit invocation path.

The implementation must verify this path in normal browser operation.

### C. Optional command/keyboard shortcut

A command may be supported later if it provides an equivalent valid browser user invocation. It is not required for v1.1.1.

## 4.5 Service Worker responsibility

The Service Worker must not pretend it can recover missing capture authorization.

For first-time capture, `START_CAPTURE` should require `tabId`, an already-authorized `streamId`, and invocation metadata.

If `streamId` is absent for a new capture, the Service Worker should fail with an explicit authorization error rather than call `getMediaStreamId` opportunistically.

Suggested error code:

```text
CAPTURE_AUTHORIZATION_REQUIRED
This tab must be opened and explicitly enabled before it can be balanced.
```

## 4.6 Transaction ordering

For first-time Enable, avoid committing managed state before capture authorization succeeds.

Preferred transaction:

```text
user invocation
→ validate supported page
→ acquire streamId
→ ensure Offscreen runtime
→ start AudioEngine
→ runtime ACK
→ commit managed=true / captured=true
→ publish canonical snapshot
```

On failure:

```text
managed=false
captured=false
explicit error
no stale managed intent
```

## 4.7 Unsupported pages

Before attempting capture, explicitly reject `chrome://*`, `edge://*`, extension-store pages, extension pages, and other browser-restricted schemes.

The user-facing error must distinguish unsupported page from authorization required.

---

# 5. RA-2 — Popup and User Workflow Correction

## 5.1 Objective

Make the UI match what the browser actually allows.

## 5.2 New information architecture

### Current Tab

Only the current active tab may expose first-time `Balance This Tab`.

If already managed, show its current status, Relative Level, and Release controls.

### Balanced / Managed Tabs

All tabs that already have active managed state may be controlled centrally:

- status;
- Relative Level;
- diagnostics;
- Release;
- global Listening Level effects.

These controls do not require new capture authorization.

### Other Audio Tabs

Background audible tabs may still be discovered and shown, but they must not expose a misleading direct `Balance` action.

Use wording such as:

```text
Bilibili — Playing
Not enabled

[ Switch to Tab ]

Enable WebAudioBalance after switching to this tab.
```

## 5.3 Switch behavior

`Switch to Tab` may use `chrome.tabs.update(tabId, { active: true })`, but the UI and code must not assume that programmatic activation itself grants capture authorization.

After switching, the user must explicitly invoke the extension on that tab.

## 5.4 Context-menu UX

Retain and validate `WebAudioBalance: Balance this tab` as an alternative first-time enable workflow.

If capture succeeds through the context menu, the next popup opening should show the tab as already managed.

## 5.5 User-facing errors

Replace low-level browser API messages with product-level classifications:

- Authorization required: `Open this tab and enable WebAudioBalance from that tab before balancing it.`
- Unsupported browser page: `This browser page cannot be captured.`
- Runtime failure: `WebAudioBalance could not start audio processing for this tab.`

The raw browser error may remain in diagnostics.

---

# 6. RA-3 — Real User-Path Browser Validation

## 6.1 Objective

Replace automation shortcuts that mask the actual activeTab/user-invocation behavior.

The recovery release must prove the workflow in ordinary Chrome and Edge conditions.

## 6.2 Automated production-path test

Automation may still drive browser UI where possible, but it must not use flags or APIs that bypass the real authorization requirement for the release-critical capture-start scenario.

The test must prove:

```text
active target tab
→ explicit extension invocation
→ Balance This Tab
→ streamId acquisition succeeds
→ capture starts
```

and:

```text
background uninvoked tab
→ direct remote Balance is unavailable
or
→ explicit authorization error is returned
```

## 6.3 Manual browser acceptance check

Because browser user activation semantics can be difficult to reproduce faithfully through CDP, a short manual acceptance matrix is required for Chrome Stable and Edge Stable.

Minimum manual checks:

1. current ordinary web tab → popup → Balance This Tab → PASS;
2. background audible tab → cannot directly first-enable from another tab's popup → expected UX;
3. Switch to Tab → invoke extension → Balance This Tab → PASS;
4. context-menu Balance this tab → PASS;
5. `chrome://extensions` → clean unsupported-page explanation;
6. popup close/reopen → already-enabled tabs remain controllable.

Record browser version and outcome.

## 6.4 Automation flags

Any `--allowlisted-extension-id` or `--whitelisted-extension-id` run must be classified as test infrastructure only.

Such a run cannot by itself satisfy the release gate for first-time capture authorization.

---

# 7. RA-4 — Simultaneous Multi-Tab Capability Verification

## 7.1 Objective

After authorization is corrected, determine whether multiple individually authorized tabs can remain captured simultaneously.

This must occur only after RA-1 through RA-3 are functioning.

## 7.2 Required user-path setup

```text
Tab A:
activate A
→ explicitly invoke extension
→ Balance This Tab
→ confirm A running

Tab B:
activate B
→ explicitly invoke extension
→ Balance This Tab
→ do NOT release A
```

Then inspect both.

## 7.3 Required assertions

If the browser permits simultaneous capture:

- A remains captured/running;
- B becomes captured/running;
- AudioEngineManager contains two live engines;
- both have valid input/output loudness;
- both telemetry sequences progress;
- Relative Level A does not modify B;
- Relative Level B does not modify A;
- release A leaves B running;
- final release B leaves zero engines.

## 7.4 Classification

Use exactly:

```text
CLASS A — SIMULTANEOUS_MULTI_TAB_SUPPORTED
CLASS B — PLATFORM_SINGLE_CAPTURE_LIMIT
CLASS C — PRODUCT_DEFECT
```

Record classification independently for Chrome and Edge.

## 7.5 Product consequence

CLASS A validates the intended concurrent multi-tab product promise.

CLASS B requires product wording and UX to reflect a browser platform limit.

CLASS C requires a product fix and complete regression rerun.

---

# 8. RA-5 — v1.1.1 Closeout and Release

## 8.1 Version policy

Because RA-1 and RA-2 require product code and UX changes, the corrective release is:

```text
manifest.json  1.1.1
package.json   1.1.1
tag            v1.1.1
GitHub Release v1.1.1
```

Do not move or delete `v1.0.0` or `v1.1.0`.

## 8.2 Required final report

Create `docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md`.

It must contain:

- exact release candidate commit SHA;
- Chrome/Edge versions;
- RA-1 authorization-path results;
- current-tab popup result;
- context-menu result;
- background-tab negative test;
- unsupported-page result;
- simultaneous multi-tab result;
- CLASS A/B/C per browser;
- any repaired defects;
- final package verification;
- final release decision.

## 8.3 README

README must explicitly explain:

> To enable a new tab, switch to that tab and invoke WebAudioBalance there. Once enabled, the tab can be managed centrally with other enabled tabs.

If RA-4 returns CLASS A, also state that multiple independently authorized tabs may remain balanced simultaneously.

## 8.4 GitHub Release notes

The v1.1.1 release notes must identify:

- corrected capture authorization workflow;
- removal of misleading remote first-enable behavior;
- improved authorization/unsupported-page UX;
- multi-tab capability result;
- preserved historical v1.1.0 release.

---

# 9. Recovery hard gates

| Gate | Requirement | Passing condition |
|---|---|---|
| RA-G1 | current-tab popup authorization | Chrome PASS |
| RA-G2 | current-tab popup authorization | Edge PASS |
| RA-G3 | background uninvoked tab behavior | no unauthorized capture attempt presented as success |
| RA-G4 | context-menu authorization | Chrome + Edge PASS |
| RA-G5 | unsupported-page behavior | clean classified UX |
| RA-G6 | no stale managed state after auth failure | PASS |
| RA-G7 | real user-path manual acceptance | Chrome + Edge PASS |
| RA-G8 | simultaneous multi-tab experiment | explicit A/B/C classification in both browsers |
| RA-G9 | controller/lifecycle isolation | PASS if CLASS A |
| RA-G10 | package/version consistency | 1.1.1 aligned |
| RA-G11 | regression unit/runtime suites | PASS |
| RA-G12 | independent recovery audit | GO |

All gates are hard release gates except CLASS B platform behavior, which may be accepted only if product scope and documentation are corrected truthfully.

---

# 10. Implementation order

```text
1. Remove background-tab first-time Balance workflow
2. Refactor first-time capture contract to require authorized streamId
3. Correct managed/captured transaction ordering
4. Add CAPTURE_AUTHORIZATION_REQUIRED handling
5. Add unsupported-page classification
6. Rework popup: Current Tab / Managed Tabs / Other Audio Tabs
7. Validate popup current-tab enable
8. Validate context-menu enable
9. Run manual Chrome/Edge authorization acceptance
10. Run simultaneous multi-tab experiment
11. Repair any CLASS C defect
12. Add regression tests
13. Update README and validation documentation
14. Bump version to 1.1.1
15. Build and verify release artifact
16. Run independent recovery audit
17. Create immutable v1.1.1 tag
18. Publish GitHub Release v1.1.1
```

---

# 11. Explicit non-goals

Do not add new DSP algorithms, loudness targets, normalization modes, Firefox/Safari support, cloud synchronization, site-specific capture hacks, blanket auto-capture, permission bypasses, or unrelated UI redesign.

---

# 12. Completion definition

The recovery phase is complete when:

1. first-time capture no longer fails because a background tab was incorrectly assumed authorized;
2. the UI no longer offers misleading remote first-enable controls;
3. a user can reliably enable a normal web tab in both Chrome and Edge;
4. context-menu enable works or is explicitly removed if not reliable;
5. authorization failures do not create stale managed state;
6. simultaneous multi-tab capability is empirically classified;
7. product wording matches the measured capability;
8. all recovery gates pass;
9. v1.1.1 is released from an audited commit.

Terminal state:

> **WebAudioBalance v1.1.1 — Capture authorization corrected / multi-tab capability validated and documented**