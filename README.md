# WebAudioBalance

Cross-tab perceptual loudness normalization and independent per-tab audio control for Chrome and Edge.

## Status

- P0 (Feasibility) has concluded with a **GO** decision (see `docs/validation/P0_FEASIBILITY_REPORT.md`).
- P1 (Stable Audio Engine) has concluded with a **GO** decision (see `docs/validation/P1_AUDIO_ENGINE_REPORT.md`).
- P2 (Loudness Measurement & Automatic Normalization) has concluded with a **GO** decision (see `docs/validation/P2_NORMALIZATION_REPORT.md`).
- P3 (Multi-tab Orchestration) has concluded with a **GO** decision (see `docs/validation/P3_MULTI_TAB_ORCHESTRATION_REPORT.md`).
- P4 (Product UI & User Interaction) has concluded with a **GO** decision (see `docs/validation/P4_PRODUCT_UI_REPORT.md`).

Current phase: **P5 — Compatibility, Real-world Audio Validation & Tuning**.

## Authoritative documentation

- `docs/PROJECT_MAINLINE_PLAN.md` — current authoritative product, architecture, scope, phase, validation, and change-control baseline.
- `docs/initial/INITIAL_PROJECT_PROPOSAL.md` — historical initial proposal retained for design provenance. Its implementation assumptions are superseded where they conflict with the mainline.

## Development mainline

`P0 Feasibility → P1 Audio Engine → P2 Loudness Normalization → P3 Multi-tab Orchestration → P4 Product UX → P5 Compatibility → P6 Hardening & Release`

Development is gate-driven. Detailed implementation specifications refine the mainline but must not silently change its frozen architecture or product scope.

## MVP

WebAudioBalance targets Chromium Manifest V3 desktop browsers with first-class support for Google Chrome and Microsoft Edge. Users explicitly enable tabs for management; each managed tab independently normalizes toward a shared perceptual loudness reference while retaining an independent manual gain offset.

## License

License selection is intentionally deferred until the project owner chooses the distribution license.
