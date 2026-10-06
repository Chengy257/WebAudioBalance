# WebAudioBalance — v1.1.1 Final Release Closeout Correction Plan

> Status: **FROZEN / READY FOR IMPLEMENTATION**  
> Frozen Date: **2026-10-06**  
> Scope: **CI repair, real-user simultaneous multi-tab evidence, release-state correction, and final v1.1.1 publication**  
> Parent authority: `docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md`  
> Current candidate commit: `86f96918c98ce9dd0220535dbb794ba203c2be06`  
> Current tag: `v1.1.1`  
> Current GitHub Release: **NOT YET PUBLISHED**

---

## 1. Purpose

The v1.1.1 recovery implementation materially fixes the real capture-authorization defect that affected normal multi-tab use.

The product code now correctly:

- limits first-time capture to the current explicitly invoked tab;
- removes direct first-time Balance actions from background tabs;
- requires an authorized `streamId` for first-time capture;
- rejects missing authorization with `CAPTURE_AUTHORIZATION_REQUIRED`;
- distinguishes unsupported browser pages from authorization failures;
- rolls back managed/captured state after authorization failure;
- keeps already-managed tabs centrally controllable.

However, final release closeout is not yet complete because three release-level discrepancies remain:

1. GitHub Actions for `main @ 86f96918...` is red because Package Integrity failed;
2. the automated simultaneous multi-tab runner still uses browser allowlist/whitelist flags, so it cannot by itself prove ordinary-user authorization behavior for RA-G8/RA-G9;
3. `v1.1.1` has a Git tag but no GitHub Release, while README/report currently describe it as already released.

This plan corrects only those release-closeout deficiencies.

It does **not** reopen the capture authorization design, DSP, runtime architecture, or product UX.

---

## 2. Closeout structure

```text
FR-1  CI and package-integrity repair
FR-2  Real-user simultaneous multi-tab acceptance evidence
FR-3  Release-state and documentation reconciliation
FR-4  Final v1.1.1 publication and audit
```

---

# 3. FR-1 — CI and Package-Integrity Repair

## 3.1 Objective

Make the actual v1.1.1 release candidate pass the repository CI pipeline.

Current observed state:

```text
main @ 86f96918
Core Verification Suites     PASS
Release Artifact Packaging   PASS
Package Integrity            FAIL
```

## 3.2 Root-cause requirement

Inspect `.github/workflows/ci.yml` and release scripts for version-specific assumptions left from v1.1.0.

Likely classes of defect include:

- hard-coded `1.1.0` expected version;
- hard-coded `webaudiobalance-v1.1.0.zip` path;
- artifact verification script using stale version constants;
- mismatch between package output and CI assertion.

Do not patch CI merely to ignore a failing assertion.

## 3.3 Version-source policy

Release validation should derive the release version from one authoritative source rather than duplicating a hard-coded version string in multiple places.

Preferred approach:

```text
manifest.json.version
        ↓
package.json must match
        ↓
package script uses the same resolved version
        ↓
CI verifies generated artifact using the resolved version
```

If the package script cannot reasonably read `manifest.json`, use a shared release-version helper or equivalent single source.

## 3.4 Required CI result

After repair:

```text
npm test        PASS
npm run package PASS
package integrity PASS
workflow conclusion PASS
```

The final release commit must have a green GitHub Actions run.

---

# 4. FR-2 — Real-User Simultaneous Multi-Tab Acceptance Evidence

## 4.1 Objective

Close the remaining evidence gap between automated multi-engine validation and ordinary-user browser authorization behavior.

The existing automated runner may continue to use allowlist/whitelist flags for downstream engine/runtime verification, but those runs must be classified as test-infrastructure evidence only.

They cannot alone satisfy the final real-user concurrent capture gate.

## 4.2 Required manual/interactive procedure

Perform this exact workflow independently in Chrome Stable and Edge Stable:

```text
Tab A
1. open ordinary web audio source
2. make Tab A active
3. invoke WebAudioBalance normally
4. click Balance This Tab
5. confirm A becomes captured/running

Tab B
6. open second ordinary web audio source
7. make Tab B active
8. invoke WebAudioBalance normally
9. click Balance This Tab
10. do NOT release A

Concurrent verification
11. reopen popup
12. confirm both A and B remain managed/captured/running
13. confirm both input/output loudness values update
14. change Relative Level on A only
15. verify B state/offset remains unchanged
16. change Relative Level on B only
17. verify A state/offset remains unchanged
18. release A
19. verify B continues running and telemetry continues
20. release B
21. verify zero residual managed engines
```

## 4.3 No-bypass requirement

For this acceptance run, do not launch the browser with:

```text
--allowlisted-extension-id
--whitelisted-extension-id
```

and do not use any other test-only mechanism that bypasses normal user invocation semantics.

## 4.4 Evidence record

Add a dedicated section to:

`docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md`

or create a concise supplemental record if cleaner.

Record at minimum:

- browser name and exact version;
- date;
- extension source (unpacked/package);
- Tab A source type;
- Tab B source type;
- A capture result;
- B capture result while A remains active;
- live engine count;
- A/B input/output metering validity;
- independent Relative Level result;
- isolated release result;
- final cleanup result;
- final classification.

## 4.5 Final classification

Use the existing classes:

```text
CLASS A — SIMULTANEOUS_MULTI_TAB_SUPPORTED
CLASS B — PLATFORM_SINGLE_CAPTURE_LIMIT
CLASS C — PRODUCT_DEFECT
```

For v1.1.1 final publication, Chrome and Edge must each have an explicit evidence-backed classification.

If both are CLASS A, keep the current product promise.

If either is CLASS B, correct product wording before release.

If either is CLASS C, stop closeout and repair the product before release.

---

# 5. FR-3 — Release-State and Documentation Reconciliation

## 5.1 Current inconsistency

At present:

```text
README                says v1.1.1 RELEASED
validation report     says 12/12 gates PASS
git tag               v1.1.1 exists
GitHub Release        does not exist
CI                    FAIL
```

This state is not release-consistent.

## 5.2 Pre-publication status

Until FR-1 and FR-2 pass, repository status should be represented as:

```text
v1.1.1 — RELEASE CANDIDATE / FINAL CLOSEOUT
CI GREEN REQUIRED
REAL-USER MULTI-TAB EVIDENCE REQUIRED
GITHUB RELEASE NOT YET PUBLISHED
```

## 5.3 Final status

Only after all gates pass may README/report say:

```text
v1.1.1 — RELEASED
Capture Authorization & Multi-Tab Recovery — COMPLETE
```

## 5.4 Report correction

Update the recovery report so RA-G8/RA-G9 clearly distinguish:

- automated allowlisted multi-engine/runtime evidence;
- manual/interactive no-bypass user-path concurrent capture evidence.

Do not write that the automated runner itself was executed without bypass flags if the script still uses them.

## 5.5 RA-G12 audit correction

The current report states:

> 0 Deficiencies / GO

That must be refreshed after this closeout.

Final independent audit must explicitly verify:

- CI green;
- real-user multi-tab evidence present;
- report claims match the test implementation;
- README state matches actual release state;
- Git tag and GitHub Release point to the intended final commit.

---

# 6. FR-4 — Final v1.1.1 Publication and Tag Policy

## 6.1 Existing tag problem

`v1.1.1` already exists and points to:

```text
86f96918c98ce9dd0220535dbb794ba203c2be06
```

If FR-1 requires any code or workflow change, the final release commit will no longer equal the existing tag target.

Do not force-move a published release tag after final publication.

Because there is currently no GitHub Release for v1.1.1, use one of these policies:

### Preferred policy

If the tag has not been distributed as an immutable public release artifact:

1. delete the premature `v1.1.1` tag;
2. complete FR-1/FR-2/FR-3;
3. create a new annotated `v1.1.1` tag at the audited final commit;
4. publish GitHub Release v1.1.1.

### Conservative alternative

If the existing tag must be preserved as immutable history:

publish the corrected binary as:

```text
v1.1.2
```

and document that v1.1.1 was a tagged but unpublished release candidate.

## 6.2 Release artifact requirements

Final GitHub Release must include:

- `webaudiobalance-v1.1.1.zip` or the final chosen patch version;
- `.crx` if retained for direct distribution;
- `SHA256SUMS.txt`;
- concise release notes;
- no `.pem` private key.

## 6.3 Final release lineage

The final report must state:

```text
Release commit: <final audited SHA>
Tag:            v1.1.1 -> <same SHA>
CI:             PASS on <same SHA>
GitHub Release: published from same tag
```

---

# 7. Final hard gates

| Gate | Requirement | Passing condition |
|---|---|---|
| FR-G1 | core test suite | PASS |
| FR-G2 | package build | PASS |
| FR-G3 | package integrity CI step | PASS |
| FR-G4 | full GitHub Actions run | PASS on final release commit |
| FR-G5 | Chrome real-user concurrent multi-tab | explicit A/B/C classification |
| FR-G6 | Edge real-user concurrent multi-tab | explicit A/B/C classification |
| FR-G7 | A/B controller independence | PASS if CLASS A |
| FR-G8 | isolated release and cleanup | PASS |
| FR-G9 | recovery report truthfulness | automated vs manual evidence clearly separated |
| FR-G10 | README/status consistency | matches actual release state |
| FR-G11 | tag/release/commit lineage | exact match |
| FR-G12 | final independent audit | GO |

All 12 gates are required for final publication.

---

# 8. Implementation order

```text
1. Diagnose package-integrity CI failure
2. Remove stale hard-coded release-version assumptions
3. Run npm test
4. Run package build
5. Push candidate and obtain green CI
6. Perform Chrome real-user simultaneous multi-tab acceptance
7. Perform Edge real-user simultaneous multi-tab acceptance
8. Record evidence and final A/B/C classifications
9. Correct recovery report evidence wording
10. Correct README pre-release/final status
11. Refresh RA-G12 / final audit
12. Resolve premature v1.1.1 tag according to tag policy
13. Create final annotated tag at audited commit
14. Publish GitHub Release
15. Verify assets, checksums, tag target, and release URL
```

---

# 9. Explicit non-goals

Do not:

- redesign capture authorization;
- redesign popup workflow;
- alter DSP or normalization behavior;
- add new browser support;
- add new site-specific logic;
- expand the compatibility matrix;
- add new product features;
- weaken tests to obtain a green release.

---

# 10. Completion definition

This closeout is complete only when:

1. CI is green on the final release commit;
2. Chrome and Edge real-user concurrent multi-tab behavior is explicitly classified;
3. automated and manual evidence are truthfully separated;
4. README and validation report no longer overstate release state;
5. tag and GitHub Release point to the audited commit;
6. release assets are complete and safe;
7. final independent audit returns GO.

Terminal state:

> **WebAudioBalance v1.1.1 — FINAL RELEASED / capture authorization corrected / real-user multi-tab capability verified**

If the existing v1.1.1 tag must remain immutable and a new commit is required, use:

> **WebAudioBalance v1.1.2 — FINAL RELEASED**