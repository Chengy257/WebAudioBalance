# WebAudioBalance — Final Closeout & v1.1.0 Release Plan

> Status: **FROZEN / READY FOR IMPLEMENTATION**  
> Frozen Date: **2026-10-05**  
> Scope: **Post-v1 validation correction, product closeout, and final v1.1.0 release**  
> Parent baseline: `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`  
> Upstream completed phases: **R1 Audio Core Correction**, **R2 Runtime & State Reliability**, **R3 Product UX & Validation implementation**  
> Release target: **v1.1.0**  
> Historical tag: `v1.0.0` is preserved and must not be moved or overwritten.

---

## 1. Purpose

R1–R3 have implemented the corrected audio core, runtime/state model, and user-facing product workflow required by the post-v1 functional rebaseline.

The remaining work is not a new feature phase.

This final phase exists to:

1. correct validation evidence that currently overstates what some R3 automated tests actually prove;
2. establish a true end-to-end browser evidence path through the production extension stack;
3. complete bounded real-browser compatibility and stability validation;
4. align repository metadata, documentation, automation, and release artifacts with the implemented product;
5. perform an independent final closeout audit;
6. publish a new immutable `v1.1.0` release only after every release gate passes.

The governing principle is:

> **No new product scope unless a closeout test exposes a real release-blocking defect.**

This phase is therefore a **verification-and-release closeout**, not R4 product development.

---

## 2. Current baseline accepted for this phase

The following implementation baseline is accepted and must not be redesigned without a demonstrated defect:

### R1 — Audio Core

Accepted architecture:

- continuous loudness measurement;
- Short-Term loudness as the primary normalization reference;
- independent per-tab AudioEngine instances;
- shared absolute loudness target with per-tab relative target offset;
- asymmetric gain convergence;
- silence/activity gating;
- pre-measurement positive-gain startup guard;
- hard headroom/safety envelope;
- processed-output loudness verification.

### R2 — Runtime & State Reliability

Accepted architecture:

- explicit command ACK/NACK semantics;
- canonical product and runtime snapshots;
- separated intent/runtime/audio state;
- session-scoped tab intent;
- Service Worker restart reconciliation;
- Offscreen runtime truth;
- monotonic revision/sequence handling;
- bounded telemetry.

### R3 — Product UX

Accepted architecture:

- consumer-facing Listening Level;
- Enabled Tabs / Other Audio Tabs separation;
- Relative Level semantics;
- `Connecting / Paused / Limited / Manual / Balancing / Balanced / Error` presentation states;
- processed-output evidence for `Balanced`;
- inline non-modal failure UX;
- diagnostics separated from primary controls.

These are considered implementation baseline. Closeout work should repair evidence, release hygiene, or genuine defects found during verification rather than reopen already-settled architecture.

---

## 3. Why an additional closeout phase is required

The current R3 implementation is materially complete, but portions of the existing validation evidence are stronger than the underlying tests justify.

Known closeout deficiencies include:

1. `test/run-r3-compatibility.mjs` uses a local compatibility fixture to emulate multiple media architectures while its report labels those cases as specific real services such as YouTube, Bilibili, Twitch, and Spotify;
2. several compatibility result fields are initialized as `PASS` before corresponding runtime assertions are made;
3. the current popup E2E suite uses `window.__wabTest.*` state and telemetry injection for many UI transitions, proving presentation behavior but not a complete production lifecycle;
4. the current perceptual evaluation records declared outcomes rather than an actual listening protocol;
5. the current “long-session” path does not constitute a meaningful soak/stability run;
6. repository top-level status and version metadata are stale or inconsistent with current implementation;
7. no lightweight continuous-integration gate protects the core automated suite.

These issues do **not** invalidate the R1/R2/R3 implementation. They invalidate only the claim that every current R3 release gate already has production-grade evidence.

Therefore the existing:

> `R3 RELEASE GO (ALL 12 GATES PASSED)`

must be treated as **provisional historical evidence** until this closeout phase replaces or corrects the affected claims.

---

## 4. Final phase structure

The final phase is divided into six work packages.

```text
FC-0  Evidence reclassification and closeout baseline
FC-1  Full-stack production-path E2E validation
FC-2  Compatibility evidence correction and representative real-source checks
FC-3  Stability / soak / perceptual closeout
FC-4  Repository and release hygiene
FC-5  Independent final audit and v1.1.0 release
```

Implementation may be delivered in several commits, but these work packages should remain one closeout phase rather than becoming a new multi-phase roadmap.

---

# 5. FC-0 — Evidence Reclassification and Baseline

## 5.1 Objective

Make validation semantics truthful before adding new evidence.

## 5.2 Required changes

### Compatibility naming

Fixture-driven tests must use architecture/category names rather than names of external websites unless the external service itself was actually exercised.

Examples:

```text
YouTube / MSE VOD
-> MSE VOD-like fixture

Bilibili / Segmented DASH
-> segmented-stream fixture

Twitch / Live Stream
-> continuous live-stream fixture

Spotify Web / Music Stream
-> wide-dynamic-range music fixture
```

Specific service names may appear only in a separate real-source validation table with actual evidence from those services.

### Evidence classes

Every validation result must identify one evidence class:

- `UNIT`
- `FIXTURE_INTEGRATION`
- `FULL_STACK_BROWSER_E2E`
- `REAL_SOURCE_BROWSER_CHECK`
- `MANUAL_PERCEPTUAL_CHECK`
- `PLATFORM_CONSTRAINT`

A fixture test must never be reported as a real-source check.

### PASS construction

A test record must begin unresolved and become PASS only after concrete assertions succeed.

Do not initialize unverified properties to `PASS`.

Preferred shape:

```js
{
  capture: "NOT_RUN",
  inputMeter: "NOT_RUN",
  outputMeter: "NOT_RUN",
  convergence: "NOT_RUN",
  pauseResume: "NOT_RUN",
  cleanup: "NOT_RUN"
}
```

Each property becomes `PASS`, `FAIL`, `NOT_APPLICABLE`, or `PLATFORM_CONSTRAINT` only after its evidence path completes.

## 5.3 Gate

FC-0 passes only if every R3 release claim can be traced to an explicit evidence class and no fixture result is represented as an external-site result.

---

# 6. FC-1 — Full-Stack Production-Path E2E

## 6.1 Objective

Prove at least one complete user workflow through the actual extension stack without test-state injection.

The minimum production path is:

```text
real browser tab with generated audio
        ↓
Popup detects tab
        ↓
user Enable / Balance action
        ↓
Service Worker
        ↓
Coordinator
        ↓
tabCapture stream acquisition
        ↓
Offscreen document
        ↓
AudioEngineManager
        ↓
AudioEngine
        ↓
continuous input measurement
        ↓
NormalizationController
        ↓
GainProcessor / safety
        ↓
processed output measurement
        ↓
runtime telemetry
        ↓
Coordinator canonical snapshot
        ↓
Popup Balancing → Balanced
```

## 6.2 Hard rule

The release-critical full-stack test must **not** use:

- `window.__wabTest.setSnapshot()`;
- `window.__wabTest.handleMetricsUpdate()`;
- manually fabricated managed/captured/audio state;
- direct DOM mutation to simulate product lifecycle.

The existing injected popup tests should remain because they are useful UI/presenter tests; they must simply be classified correctly.

## 6.3 Minimum automated scenarios

The full-stack browser E2E must assert:

1. an audible supported fixture tab is discovered;
2. clicking Balance initiates a real command transaction;
3. command receives authoritative ACK;
4. tab becomes managed only through canonical state;
5. live Offscreen engine exists;
6. capture/runtime truth reports `captured=true`;
7. input loudness becomes valid;
8. output loudness becomes valid;
9. UI reaches `Balancing`;
10. output error converges within the accepted target tolerance;
11. `Balanced` appears only after the required dwell;
12. Relative Level changes the effective target through the real command path;
13. pause/silence produces the correct runtime/UI state;
14. resume reacquires valid evidence without unsafe startup gain;
15. Release removes the engine and returns canonical state to unmanaged;
16. popup close/reopen reconstructs the same authoritative state;
17. no unhandled runtime error occurs.

Run this path on both:

- Microsoft Edge Stable;
- Google Chrome Stable.

## 6.4 Failure handling

If a full-stack scenario exposes a product defect, repair the defect in the smallest responsible layer and add a regression test.

Do not weaken the assertion merely to preserve a PASS result.

## 6.5 Gate

FC-1 passes only when the complete lifecycle succeeds through production runtime code in both target browsers.

---

# 7. FC-2 — Compatibility Evidence Correction and Representative Real-Source Checks

## 7.1 Two-layer compatibility model

Final release evidence must separate:

### Layer A — Deterministic architecture fixtures

Automated local fixtures should cover reproducible technical categories:

- ordinary HTML5 media;
- MSE VOD-like playback;
- segmented MSE-like playback;
- continuous/live-like audio;
- wide-dynamic-range music;
- dialogue with pauses;
- Web Audio graph;
- iframe-hosted audio;
- WebRTC receive-like audio;
- unsupported/protected-content boundary where a deterministic test is valid.

For every applicable fixture, verify actual:

- capture;
- live engine existence;
- input metering;
- output metering;
- target convergence;
- Relative Level;
- pause/resume;
- cleanup.

### Layer B — Representative real services

A smaller manual or semi-automated matrix should check actual commonly used services, where accessible:

- YouTube;
- Bilibili or another segmented-stream service;
- Twitch or another live stream;
- Spotify Web or another web music service.

The purpose is compatibility confirmation, not service-specific feature support.

Authentication-dependent, geo-dependent, paywalled, or DRM-protected cases must be recorded honestly as:

- checked and PASS;
- checked with limitation;
- not testable in the current environment;
- platform constraint.

A missing real-service test must never be converted into a synthetic PASS.

## 7.2 DRM and platform boundaries

Do not assert a browser/CDM behavior solely because the test fixture labels a case as DRM.

Protected-media limitations must be based on actual documented/observed browser behavior.

If direct evidence is unavailable during closeout, classify the case as a documented known limitation rather than an automated PASS.

## 7.3 Gate

FC-2 passes when:

- fixture compatibility has real assertions;
- real-source claims are separated from fixtures;
- unsupported conditions are explicitly classified;
- no `PASS` exists without corresponding evidence.

---

# 8. FC-3 — Stability, Soak, and Perceptual Closeout

## 8.1 Automated soak test

Replace the current short snapshot-loop “long-session” claim with an actual bounded audio-runtime soak test.

Recommended release closeout duration:

> **30 minutes per target browser**

A shorter CI smoke variant may exist separately.

The soak scenario should maintain multiple concurrent managed tabs or equivalent deterministic streams with periodic source-state changes.

Record periodically:

- managed tab count;
- live engine count;
- AudioContext state;
- runtimeInstanceId;
- measurement sequence progression;
- applied gain;
- target error;
- limited/frozen state;
- last runtime error;
- capture truth.

Where practical, also record process/heap memory as diagnostic evidence, but memory measurement is not a required release gate unless a reliable method is available.

## 8.2 Soak assertions

Hard failures include:

- engine count leak after Release;
- stale captured state after engine loss;
- gain drifting continuously under a stationary source;
- telemetry sequence stopping unexpectedly;
- AudioContext entering an unrecoverable state;
- repeated runtime errors;
- unsafe positive-gain startup/resume behavior;
- failure to clean up all engines at the end.

Do not claim “memory leak free” without measuring memory.

## 8.3 Perceptual closeout

Use a short manual listening checklist rather than pretending subjective outcomes are automated facts.

Required checks:

- loud source → quiet source transition;
- quiet source → loud source transition;
- switching between two balanced tabs;
- dialogue with normal pauses;
- silence then resume;
- Relative Level `+6 dB`;
- Relative Level `-6 dB`;
- Limited/headroom behavior on a high-peak source.

Record:

- PASS;
- PASS_WITH_OBSERVATION;
- FAIL.

Subjective notes should be concise.

This checklist is a product sanity check, not a psychoacoustic study.

## 8.4 Gate

FC-3 passes when both Chrome and Edge complete the bounded soak without release-blocking defects and the perceptual checklist has no FAIL.

---

# 9. FC-4 — Repository and Release Hygiene

## 9.1 README

Rewrite the top-level current status so it reflects the actual post-v1 state.

Before final release it should state:

```text
R1 — COMPLETE
R2 — COMPLETE
R3 — IMPLEMENTED
Final Closeout — IN PROGRESS
```

After final release:

```text
v1.1.0 — RELEASED
Post-v1 functional rebaseline — COMPLETE
```

Historical P0–P6 records remain clearly marked historical.

## 9.2 Version alignment

The current repository has:

```text
manifest.json  1.0.0
package.json   0.1.0
historical tag v1.0.0
```

Final release version is frozen as:

```text
manifest.json  1.1.0
package.json   1.1.0
Git tag        v1.1.0
GitHub Release v1.1.0
```

The historical `v1.0.0` tag must remain unchanged.

## 9.3 Package/release artifact

The existing release packaging path must produce a clean distributable extension artifact containing only required runtime assets.

Before release verify:

- manifest parses;
- referenced files exist;
- no development-only absolute paths;
- no temporary profiles/logs;
- no test fixtures accidentally required at runtime;
- icons are present;
- extension loads from the packaged artifact in Chrome and Edge.

## 9.4 CI

Add a lightweight core GitHub Actions workflow.

Required on push / pull request:

```text
checkout
runtime setup
npm test
static/package validation
```

Browser CDP suites may remain manual or separately dispatched if hosted CI cannot reliably provide the required browsers/session behavior.

Do not make fragile GUI/browser automation a mandatory CI gate merely for appearance.

## 9.5 Documentation alignment

Update references so the repository identifies:

- post-v1 rebaseline as completed;
- R1/R2/R3 as completed implementation phases;
- this Final Closeout plan as the final release authority;
- corrected final validation report as current evidence;
- older R3 report as superseded where its claims were reclassified.

## 9.6 Gate

FC-4 passes when repository metadata, documentation, package version, packaged artifact, and core CI all describe the same release state.

---

# 10. FC-5 — Independent Final Audit and Release

## 10.1 Final validation report

Create:

`docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`

The report must contain:

- exact commit SHA tested;
- target browser versions;
- operating system/environment;
- unit/core suite results;
- full-stack Chrome result;
- full-stack Edge result;
- deterministic compatibility matrix;
- real-source check matrix;
- 30-minute soak results;
- perceptual checklist;
- known limitations;
- final artifact/package verification;
- unresolved issues, if any;
- explicit release decision.

Do not copy historical PASS counts unless they were rerun against the release candidate or clearly labeled historical.

## 10.2 Independent audit

After implementation and validation are complete, perform a separate review pass that is not based only on the generated closeout report.

The audit should inspect:

- actual release candidate code;
- final validation scripts;
- assertion semantics;
- final report claims;
- package contents;
- version consistency;
- README/documentation consistency;
- git diff from current R3 baseline.

The audit question is:

> **Does every material release claim have evidence that actually proves it?**

## 10.3 Release blockers

The release must stop if any of the following remain:

- false or pre-populated PASS state;
- full-stack production lifecycle failure;
- unsafe loudness/gain behavior;
- stale or contradictory runtime state;
- Chrome or Edge core workflow failure;
- release artifact cannot load;
- package/manifest version mismatch;
- documentation still presents superseded evidence as current truth;
- any unclassified known P0/P1 defect.

## 10.4 Non-blocking limitations

Release may proceed with documented limitations when they are outside product control, for example:

- browser privileged/internal pages;
- extension-store pages;
- DRM/protected media restrictions;
- site-specific behaviors that cannot be supported through Chromium `tabCapture`;
- environment-dependent real-service checks that are clearly marked unverified rather than PASS.

---

# 11. Final hard release gates

The `v1.1.0` release requires all gates below.

| # | Gate | Required result |
|---|---|---|
| G1 | R1 core unit/regression suite | PASS |
| G2 | R2 runtime/state suite | PASS |
| G3 | R3 presenter/UI suite | PASS |
| G4 | Chrome production-path full-stack E2E | PASS |
| G5 | Edge production-path full-stack E2E | PASS |
| G6 | fixture compatibility assertions | PASS / explicit constraint only |
| G7 | representative real-source checks | no hidden FAIL; untested is not PASS |
| G8 | 30-minute Chrome soak | PASS |
| G9 | 30-minute Edge soak | PASS |
| G10 | perceptual checklist | no FAIL |
| G11 | release artifact loads in Chrome | PASS |
| G12 | release artifact loads in Edge | PASS |
| G13 | version/documentation consistency | PASS |
| G14 | core CI workflow | PASS |
| G15 | independent final audit | GO |

All 15 gates are hard release gates except individual external-service cases explicitly classified as unavailable or platform constrained.

---

# 12. Final release sequence

The implementation agent should execute closeout in this order:

```text
1. Freeze this plan
2. Correct validation semantics
3. Implement/assert real full-stack E2E
4. Repair any product defect exposed by E2E
5. Rebuild deterministic compatibility matrix
6. Perform representative real-source checks
7. Run Chrome + Edge soak tests
8. Complete manual perceptual checklist
9. Align README/version/release metadata
10. Add core CI
11. Build packaged release artifact
12. Test packaged artifact in both browsers
13. Generate FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md
14. Perform independent release audit
15. Only after GO: merge release candidate
16. Create immutable tag v1.1.0
17. Create GitHub Release v1.1.0 and attach packaged artifact/release notes
18. Verify tag/release points to the audited commit
19. Clean temporary closeout branches/worktrees if used
```

Do not create the final tag before the independent audit returns GO.

---

# 13. Required implementation outputs

At minimum this phase should leave:

### Code/test outputs

- corrected R3 compatibility runner;
- production-path full-stack browser E2E;
- bounded soak runner;
- any regression tests required by discovered defects;
- lightweight core CI workflow.

### Documentation outputs

- updated `README.md`;
- corrected/superseding R3 validation wording where required;
- `docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`;
- concise final release notes.

### Release outputs

- aligned `1.1.0` package and manifest metadata;
- reproducible packaged extension artifact;
- immutable `v1.1.0` tag;
- GitHub Release `v1.1.0`.

---

# 14. Explicit non-goals

Do **not** use this phase to add:

- Firefox/Safari support;
- new DSP algorithms;
- cross-device synchronization;
- cloud services;
- account systems;
- new site-specific adapters unless required to fix a confirmed product defect;
- large UI redesign;
- new settings architecture;
- new normalization modes;
- broad telemetry/analytics;
- complex CI infrastructure.

Any such work belongs after v1.1.0.

---

# 15. Completion definition

The post-v1 rebaseline is complete only when all of the following are true:

1. R1 corrected audio behavior remains passing;
2. R2 runtime state is truthful and restart-safe;
3. R3 product UI is operational;
4. at least one complete production runtime path is proven in both Chrome and Edge;
5. compatibility claims distinguish deterministic fixtures from actual real-source checks;
6. long-session and perceptual claims reflect tests that were actually performed;
7. the repository and packaged extension identify themselves consistently as v1.1.0;
8. the independent audit returns GO;
9. the audited commit is tagged `v1.1.0`;
10. a GitHub Release is created from that immutable tag.

At that point the project status becomes:

> **WebAudioBalance v1.1.0 — RELEASED / post-v1 functional rebaseline COMPLETE**

No further correction phase is planned unless real use exposes a new defect.
