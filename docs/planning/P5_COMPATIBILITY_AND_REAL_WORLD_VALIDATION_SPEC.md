# P5 — Compatibility & Real-world Audio Validation Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 17)  
> Foundation: `docs/validation/P4_PRODUCT_UI_REPORT.md` (P4 Product UI & User Interaction)  
> Purpose: provide an authoritative, bounded implementation specification to execute comprehensive real-world media compatibility audits, failure taxonomy classification, acoustic behavior validation, and cross-browser verification across Chrome Stable and Edge Stable.

---

## 1. Authority and Scope

This document specifies the engineering implementation of **P5 — Real-world Compatibility & Validation**.

P5 subjects the complete WebAudioBalance system (Control Plane, Offscreen Audio Plane, BS.1770 K-weighting normalization engine, and Product Popup UI) to systematic real-world media workloads, measuring actual coverage and classifying failure modes before considering ad-hoc workarounds.

### 1.1 In-Scope Responsibilities

P5 owns:
1. **Representative Media Category Coverage**:
   - Ordinary HTML5 audio/video (`<audio>`, `<video>`);
   - Mainstream MSE (Media Source Extensions) streaming (YouTube, Bilibili);
   - Live streaming media (Twitch, YouTube Live, HLS/DASH);
   - Music streaming & high dynamic range audio (Spotify Web, SoundCloud);
   - Speech & dialogue dominant media (Podcasts, news broadcasts, video meetings);
   - Web Audio API synthesized audio (HTML5 Web Audio games, synthesizers);
   - Protected DRM/EME media classification (Netflix, Spotify protected streams);
   - Local media files (`file:///` playback);
   - Cross-origin iframe embedded media.
2. **Cross-Browser Verification**:
   - Google Chrome Stable (`154.0.8037.58` / latest);
   - Microsoft Edge Stable (`154.0.4258.48` / latest);
   - Validation of identical user authorization boundary, stream capture, and playback without duplicate audio.
3. **Failure Taxonomy Classification**:
   - Strict classification of edge cases according to Section 17 of Mainline Plan:
     - `capture failure`
     - `playback failure`
     - `lifecycle failure`
     - `DSP failure`
     - `permission/activation failure`
     - `browser-specific failure`
     - `site-specific failure`
     - `protected-content limitation`
4. **Real-world Acoustic Tuning & Dynamics Audit**:
   - Verification of speech pause hold time ($600\text{ ms}$) in real-world dialogue (no ambient noise pumping);
   - Verification of deadband ($\pm 1.0\text{ LU}$) preventing hunting/breathing during steady-state music;
   - Sudden loud transient attenuation verification ($10\text{ dB/s}$ attack rate protecting user hearing);
   - Recovery behavior after user pauses and resumes playback.
5. **Automated Compatibility Test Harness**:
   - Construction of comprehensive test fixture page `test/fixtures/compatibility-fixture.html` and automated evaluation suite `test/test-p5-compatibility.mjs`.

### 1.2 Explicit Non-Goals for P5

P5 MUST NOT implement:
- Invasive content script DOM injection or page-side monkey-patching;
- DRM bypass or reverse engineering of EME CDM modules;
- Ad-blocking or site-specific custom layout hacks;
- P6 release build packaging or store asset generation (reserved for P6).

---

## 2. Work Packages for P5

- **WP0**: Author P5 Implementation Spec & Test Harness definition.
- **WP1**: Real-world Audio Compatibility Fixture suite (`test/fixtures/compatibility-fixture.html`) providing deterministic multi-profile audio streams (dialogue, dynamic music, low-level speech, square wave bursts, silence intervals).
- **WP2**: Automated Compatibility & Dynamics Benchmark Suite (`test/test-p5-compatibility.mjs`) testing:
  - Multi-profile audio capture & convergence;
  - Long-duration stability;
  - Rapid pause/resume recovery;
  - Audio glitch & dropout prevention under CPU load;
  - DRM / protected media classification contract.
- **WP3**: Comprehensive Compatibility Matrix across Chrome & Edge for all 10 target categories.
- **WP4**: Failure taxonomy mapping & documented product boundary contracts.
- **WP5**: P5 Compatibility Validation Report & Gate Decision in `docs/validation/P5_COMPATIBILITY_REPORT.md`.

---

## 3. Acceptance Criteria

P5 is **GO** only if:
1. All core media streaming classes (HTML5, MSE, live stream, Web Audio, iframe) reliably complete the capture $\rightarrow$ process $\rightarrow$ playback cycle on both Chrome Stable and Edge Stable;
2. Pausing and resuming media does not reset manual gain or produce acoustic pops/clicks;
3. Speech pauses cause zero gain pumping/hunting;
4. Sudden volume transitions (quiet $\rightarrow$ loud) are clamped swiftly without exceeding safety limits;
5. All failure modes and protected DRM limitations are classified according to the formal taxonomy;
6. Automated regression test pass rate is 100% across P1, P2, P3, P4, and P5.
