# WebAudioBalance — Final Release Correction Plan

> Status: **FROZEN / READY FOR IMPLEMENTATION**  
> Frozen Date: **2026-10-05**  
> Scope: **v1.1.0 post-release evidence correction and simultaneous multi-tab capability verification**  
> Parent authority: `docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`  
> Current release: `v1.1.0`  
> Current release commit/tag target: `8d4f9d1cc0bbff004078f18090436d74688b34ca`

---

## 1. Purpose

WebAudioBalance v1.1.0 has been successfully built, tagged, released, and passed its core CI and single-tab production-path closeout.

An independent post-release review identified two residual closeout deficiencies:

1. the final release report records the tested commit as the pre-closeout base commit `7992c278...`, while the actual immutable `v1.1.0` tag points to release commit `8d4f9d1c...`;
2. the current FC-1 and FC-3 browser validation proves a complete real production lifecycle for one captured tab at a time, but does not yet prove that two or more tabs can remain captured and normalized simultaneously in the target Chromium browsers.

This correction phase exists only to close those two gaps.

It is **not** a new feature phase and must not reopen settled R1/R2/R3 architecture unless the simultaneous multi-tab experiment exposes a genuine product limitation.

---

## 2. Frozen correction scope

The phase contains only two work packages:

```text
RC-1  Simultaneous multi-tab capture and independent-engine verification
RC-2  Release evidence traceability correction and final audit refresh
```

No other product changes are permitted unless RC-1 reveals a release-blocking defect.

---

# 3. RC-1 — Simultaneous Multi-Tab Capability Verification

## 3.1 Objective

Determine with real Chrome and Edge behavior whether WebAudioBalance can keep multiple tabCapture sessions active simultaneously and independently process them through separate AudioEngine instances.

This must be verified empirically.

Do not infer support from architecture, source code, browser documentation, or sequential tab switching.

## 3.2 Minimum experiment

Prepare two independent tabs with continuous deterministic audio:

```text
Tab A  steady source A
Tab B  steady source B
```

Then execute:

```text
1. Start browser with production extension
2. Confirm A and B are both audible/discoverable
3. Enable / Balance Tab A
4. Wait until A:
   - managed=true
   - captured=true
   - engineState=RUNNING
   - input/output metering valid
5. Without stopping A, Enable / Balance Tab B
6. Inspect browser capture state and WebAudioBalance runtime
7. Keep both sources active for a bounded observation period
8. Apply independent Relative Level changes
9. Release A while B remains enabled
10. Verify B continues normally
11. Release B
12. Verify runtime cleanup
```

Run this in:

- Google Chrome Stable;
- Microsoft Edge Stable.

## 3.3 Required assertions

For a simultaneous multi-tab PASS, all of the following must hold after B is enabled while A remains active:

### Browser/runtime truth

- browser reports both captures active where the API exposes that state;
- A remains `captured=true`;
- B becomes `captured=true`;
- neither capture is silently revoked;
- Offscreen runtime reports two live engines;
- the two engines have distinct tab IDs and independent state.

### Measurement truth

For both A and B:

- input measurement becomes valid;
- output measurement becomes valid;
- telemetry sequences advance;
- AudioContext remains healthy;
- runtime errors remain null.

### Controller independence

Use different source levels and/or different Relative Level offsets.

Required behavior:

```text
Tab A target/offset change
must not mutate Tab B target/offset/gain state

Tab B target/offset change
must not mutate Tab A target/offset/gain state
```

### Lifecycle isolation

When A is released:

- A engine is destroyed;
- B remains managed/captured/running;
- B telemetry continues;
- B audio does not reset or stop.

Then release B and verify zero residual engines.

## 3.4 Test implementation

Add a dedicated release-correction browser runner, for example:

`test/run-release-correction-multitab.mjs`

Do not overload the existing single-tab FC-1 test.

The runner must:

- use the production extension path;
- avoid `window.__wabTest.*` injection;
- use real `chrome.tabCapture` behavior;
- fail immediately on silent replacement of the first capture;
- print a concise capability classification.

## 3.5 Capability classification

The result must be one of exactly three classes:

### CLASS A — SIMULTANEOUS_MULTI_TAB_SUPPORTED

Both Chrome and Edge keep A and B captured simultaneously and all independence assertions pass.

Product interpretation:

> Existing WebAudioBalance multi-tab architecture is validated as intended.

### CLASS B — PLATFORM_SINGLE_CAPTURE_LIMIT

The browser itself prevents or revokes concurrent tab capture despite correct product behavior.

Evidence must include:

- browser API result / error;
- actual state transition observed;
- whether first capture is stopped, replaced, or second capture rejected.

Product interpretation:

> Current product cannot truthfully claim simultaneous cross-tab balancing on that browser under the current tabCapture architecture.

This requires documentation/product-scope correction before final freeze.

### CLASS C — PRODUCT_DEFECT

The browser permits concurrent capture, but WebAudioBalance mishandles it.

Examples:

- engine B replaces engine A;
- registry loses A;
- shared gain state cross-contaminates;
- release of A stops B;
- engine manager cannot hold two engines.

Product interpretation:

> Code correction is required.

If CLASS C occurs, fix the smallest responsible layer and add regression coverage.

## 3.6 Cross-browser decision

Final classification must be recorded separately for Chrome and Edge.

If the two browsers differ, documentation must reflect browser-specific capability.

Do not generalize one browser's result to the other.

---

# 4. RC-2 — Release Evidence Traceability Correction

## 4.1 Exact release commit

The authoritative final report must identify:

```text
Release commit:
8d4f9d1cc0bbff004078f18090436d74688b34ca

Tag:
v1.1.0 -> 8d4f9d1cc0bbff004078f18090436d74688b34ca

CI:
main @ 8d4f9d1 -> success
```

The existing `7992c278...` reference may remain only as the pre-closeout baseline if useful, but it must not be labeled as the release commit tested.

## 4.2 Final report amendment

Update:

`docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`

Required changes:

- correct release/tested commit traceability;
- add a dedicated **Simultaneous Multi-Tab Capability Verification** section;
- record Chrome and Edge RC-1 classifications separately;
- remove or revise any statement contradicted by RC-1 evidence;
- refresh G15 independent audit status after this correction.

## 4.3 README alignment

If RC-1 returns CLASS A on both browsers:

- keep current multi-tab product positioning;
- optionally add one sentence noting validated concurrent multi-tab operation.

If RC-1 returns CLASS B on either browser:

- remove any wording implying simultaneous multi-tab balancing where unsupported;
- clearly describe actual behavior;
- keep independent-engine architecture wording only where it is actually realizable.

If RC-1 returns CLASS C:

- README must not be finalized until the defect is fixed and regression-tested.

## 4.4 Known limitations correction

The current final report contains:

> `Single Active Stream Capture per Session`

This statement must not remain as an unsupported blanket limitation.

Replace it only after RC-1 establishes the actual browser behavior.

The corrected limitation must be evidence-backed and browser-specific if necessary.

---

# 5. Release Version Policy

The current public release `v1.1.0` must not be deleted or force-moved.

## 5.1 If RC-1 = CLASS A and only documentation changes are needed

Do not create `v1.1.1`.

Actions:

- correct documentation on `main`;
- add the new evidence;
- retain immutable historical `v1.1.0` tag and Release;
- optionally amend the GitHub Release notes to reference the correction commit and updated validation report.

The release artifact itself remains valid.

## 5.2 If RC-1 = CLASS B and only product-scope/documentation correction is required

Prefer a documentation-only correction first.

Do not issue a new binary version unless extension behavior or manifest/package contents change.

The public release notes must be corrected so they do not overstate simultaneous cross-tab capability.

## 5.3 If RC-1 = CLASS C and code changes are required

Create a patch release:

```text
manifest.json  1.1.1
package.json   1.1.1
tag            v1.1.1
GitHub Release v1.1.1
```

Only after regression tests and a refreshed independent audit pass.

Never move `v1.1.0`.

---

# 6. Independent Audit Refresh

After RC-1 and RC-2 are complete, run one final review focused only on the correction.

The audit must answer:

1. Does the RC-1 runner truly keep the first tab active while starting the second?
2. Is the observed classification based on actual browser/runtime state?
3. If simultaneous capture succeeds, are two live AudioEngines proven?
4. Are per-tab controller states demonstrably independent?
5. Does releasing one tab leave the other intact?
6. Does the final report name the exact release commit correctly?
7. Does README/product wording match the measured capability?
8. Does the GitHub Release description match the final evidence?
9. Are there any remaining statements of simultaneous multi-tab support or limitation without proof?

Audit outcomes:

- `GO — FINAL FREEZE`
- `GO WITH DOCUMENTATION CORRECTION`
- `NO-GO — PATCH RELEASE REQUIRED`

---

# 7. Final Correction Gates

| Gate | Requirement | Passing condition |
|---|---|---|
| RC-G1 | Chrome simultaneous capture experiment | explicit CLASS A/B/C with evidence |
| RC-G2 | Edge simultaneous capture experiment | explicit CLASS A/B/C with evidence |
| RC-G3 | engine-count/runtime truth | matches observed capture capability |
| RC-G4 | independent per-tab controller behavior | PASS if concurrent capture supported |
| RC-G5 | lifecycle isolation | releasing A does not corrupt B where concurrent mode exists |
| RC-G6 | release SHA traceability | exact `8d4f9d1...` lineage documented |
| RC-G7 | README/report consistency | matches RC-1 result |
| RC-G8 | GitHub Release wording | no unsupported capability claims |
| RC-G9 | independent audit refresh | final GO decision |

---

# 8. Implementation Order

Execute strictly in this order:

```text
1. Add dedicated simultaneous multi-tab browser test
2. Run Chrome experiment
3. Run Edge experiment
4. Classify each browser as A / B / C
5. If C: repair code and rerun regression
6. Update final validation report
7. Correct release SHA traceability
8. Update README / known limitations only as required by evidence
9. Amend GitHub Release notes if necessary
10. Perform independent correction audit
11. If documentation-only: FINAL FREEZE v1.1.0
12. If code changed: prepare v1.1.1 patch release
```

---

# 9. Explicit Non-Goals

Do not add:

- new normalization algorithms;
- new UX concepts;
- Firefox/Safari support;
- site-specific hacks;
- additional long soak programs;
- new settings;
- new analytics;
- broader compatibility expansion;
- architectural rewrites unrelated to RC-1 findings.

---

# 10. Completion Definition

This correction phase is complete when:

1. simultaneous multi-tab capability is empirically classified in both Chrome and Edge;
2. the result is reflected truthfully in product/release documentation;
3. the final report points to the actual `v1.1.0` release commit;
4. all unsupported claims are removed or corrected;
5. independent audit returns a final decision.

If both browsers are CLASS A and no code changes are needed, the terminal project state becomes:

> **WebAudioBalance v1.1.0 — FINAL FREEZE / simultaneous multi-tab capability validated**

If a platform limitation is confirmed:

> **WebAudioBalance v1.1.0 — FINAL FREEZE / capability boundary documented**

If a product defect requires code changes:

> **v1.1.1 patch release required before final freeze**
