# P6 — Hardening, Performance Optimization & Release Packaging Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (P6 Phase)  
> Foundation: `docs/validation/P5_COMPATIBILITY_REPORT.md` (P5 Compatibility & Real-World Validation)  
> Purpose: provide an authoritative, bounded implementation specification to harden the extension codebase, optimize performance, verify leak-free multi-tab lifecycles, package high-resolution visual assets, validate the production Manifest V3 configuration, and achieve final release readiness.

---

## 1. Authority and Scope

This document specifies the engineering implementation of **P6 — Hardening, Performance Optimization & Release Packaging**, the final phase of the WebAudioBalance mainline plan:

$$\text{\bf P0 Feasibility} \rightarrow \text{\bf P1 Audio Engine} \rightarrow \text{\bf P2 Normalization} \rightarrow \text{\bf P3 Orchestration} \rightarrow \text{\bf P4 Product UX} \rightarrow \text{\bf P5 Compatibility} \rightarrow \text{\bf P6 Hardening \& Release}$$

### 1.1 In-Scope Responsibilities

P6 owns:
1. **Memory & Lifecycle Hardening (Zero-Leak Guarantee)**:
   - Audit and enforce deterministic cleanup of `AudioContext`, `MediaStream`, `BiquadFilterNode`, `DynamicsCompressorNode`, and event listeners upon tab closure or user release;
   - Ensure the Offscreen Document manages its AudioEngine pool without dangling references;
   - Prevent unbounded log growth in `StructuredLogger` (capped buffer);
2. **Performance Optimization**:
   - Throttle/batch metrics updates from the Audio Plane to the Control Plane ($5\text{–}10\text{ Hz}$ when popup is active; $0\text{ Hz}$ when popup is closed);
   - Prevent background IPC overhead when the popup is closed;
   - Efficient biquad filter calculations and minimal allocation in real-time callbacks;
3. **Production Visual Assets & Branding**:
   - Clean, professional vector/high-res PNG icons in standard extension sizes:
     - `assets/icons/icon-16.png`
     - `assets/icons/icon-32.png`
     - `assets/icons/icon-48.png`
     - `assets/icons/icon-128.png`
   - Wire icon declarations in `manifest.json` under `action.default_icon` and root `icons`;
4. **Manifest V3 Release Hardening**:
   - Ensure permissions are strictly minimal (`tabCapture`, `offscreen`, `tabs`, `activeTab`, `contextMenus`);
   - Confirm CSP (Content Security Policy) compliance (no inline scripts, no `eval`, all ES modules);
   - Strict versioning bump to `1.0.0`;
5. **Comprehensive Release Verification Suite**:
   - Build `test/test-p6-release.mjs` verifying:
     - Memory leak prevention & engine disposal;
     - Manifest schema & asset integrity;
     - Capped log buffer bounds;
     - Cumulative test suite passing 100%;
6. **Documentation & Release Closeout**:
   - Author `docs/validation/P6_RELEASE_REPORT.md` declaring final **GO / RELEASE READY**;
   - Update `README.md` with complete installation, architecture, and user instructions.

### 1.2 Explicit Non-Goals for P6

P6 MUST NOT implement:
- Speculative new audio features (such as 10-band graphic EQ or spatial audio);
- Native messaging host or binary dependencies;
- Unrelated browser platforms (Firefox, Safari) outside the frozen Chromium MV3 scope.

---

## 2. Work Packages for P6

- **WP0**: Author P6 Implementation Spec (`docs/planning/P6_HARDENING_AND_RELEASE_SPEC.md`).
- **WP1**: Lifecycle hardening, resource cleanup audit, and telemetry throttling (`src/offscreen/audio-engine-manager.js`, `src/offscreen/offscreen.js`, `src/shared/logger.js`).
- **WP2**: Production icon asset generation (`assets/icons/icon-{16,32,48,128}.png`).
- **WP3**: Manifest V3 production configuration & metadata bump to `1.0.0` (`manifest.json`).
- **WP4**: Automated Release Verification Suite (`test/test-p6-release.mjs`).
- **WP5**: P6 Release Validation Report & Final Gate Decision (`docs/validation/P6_RELEASE_REPORT.md`).
- **WP6**: Final repository documentation closeout (`README.md`).

---

## 3. Acceptance Criteria

P6 is **GO (Release Ready)** only if:
1. Every tab closure triggers complete resource destruction (AudioContext closed, tracks stopped, disconnected nodes);
2. Visual assets exist at all 4 standard dimensions and are properly referenced in `manifest.json`;
3. `manifest.json` validates with zero warnings under Chrome/Edge MV3 schema;
4. The full cumulative test suite (P1, P2, P3, P4, P5, P6) passes 100% with zero failures;
5. All documentation is aligned with the final product.
