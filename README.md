# WebAudioBalance

> **Current Status: R1 FINAL CLOSEOUT — ONE STARTUP SAFETY ADDENDUM NEXT**  
> The R1 closeout correction has passed its main C1–C5/B1–B5 gates. One residual pre-measurement positive-gain guard remains before final R1 GO. R2 and R3 plans/specs are frozen, but R2 code implementation remains gated.

---

## 1. Project Overview

**WebAudioBalance** solves the common problem of inconsistent audio volume across different browser tabs. When switching between YouTube videos, Bilibili streams, Twitch broadcasts, podcasts, and video meetings, volume levels often fluctuate wildly. 

The current product direction retains the validated Chromium extension architecture while reworking the loudness-control implementation and release evidence:
- **Absolute loudness target model**: each user-enabled tab should independently converge toward a shared perceptual loudness target;
- **Independent per-tab AudioEngines**: one tab's source changes must not directly drive another tab's controller;
- **Relative per-tab adjustment**: the user slider is defined as an offset from the shared target;
- **Continuous loudness measurement and processed-output verification**: these are required by the frozen post-v1 rebaseline and are being rebuilt/revalidated in R1;
- **Chromium MV3 architecture retained**: tab capture, Offscreen Audio Runtime, Service Worker control plane, and a unified Chrome/Edge codebase remain the platform baseline.

---

## 2. Current Development Status

The authoritative current plan is [`docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`](docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md). Immediate execution is governed by [`R1_FINAL_CLOSEOUT_ADDENDUM.md`](docs/planning/R1_FINAL_CLOSEOUT_ADDENDUM.md). Both R2 and R3 now have frozen mainline plans and Codex-ready implementation specifications.

The original P0–P6 cycle and its validation reports are retained as historical engineering records. Their previous **GO / RELEASE READY** decisions do not satisfy the post-v1 release gate. Historical test counts must not be interpreted as proof that the current product achieves reliable absolute cross-tab loudness balancing.

Current correction mainline:

```text
R0  Functional Rebaseline              COMPLETE / FROZEN
R1  Main + Closeout Correction          ACCEPTED EXCEPT FINAL STARTUP GUARD
R1  Final Closeout Addendum             SPEC FROZEN / CODE NEXT
R2  Plan + Implementation Spec          COMPLETE / FROZEN, CODE BLOCKED UNTIL R1 GO
R3  Plan + Implementation Spec          COMPLETE / FROZEN, CODE AFTER R2 GO
```

## 3. Historical P0–P6 Development Record

All development phases outlined in [`docs/PROJECT_MAINLINE_PLAN.md`](docs/PROJECT_MAINLINE_PLAN.md) have been systematically implemented, verified, and concluded with unanimous **GO** gate decisions:

| Phase | Subsystem | Validation Report | Automated Tests | Gate Decision |
|---|---|---|:---:|:---:|
| **P0** | Architectural Feasibility (Chrome & Edge) | [`docs/validation/P0_FEASIBILITY_REPORT.md`](docs/validation/P0_FEASIBILITY_REPORT.md) | Manual & CDP | **GO** |
| **P1** | Stable Audio Engine & State Machine | [`docs/validation/P1_AUDIO_ENGINE_REPORT.md`](docs/validation/P1_AUDIO_ENGINE_REPORT.md) | 23 / 23 PASS | **GO** |
| **P2** | BS.1770 LUFS Normalization & DSP | [`docs/validation/P2_NORMALIZATION_REPORT.md`](docs/validation/P2_NORMALIZATION_REPORT.md) | 16 / 16 PASS | **GO** |
| **P3** | Multi-Tab Orchestration & State Trinity | [`docs/validation/P3_MULTI_TAB_ORCHESTRATION_REPORT.md`](docs/validation/P3_MULTI_TAB_ORCHESTRATION_REPORT.md) | 29 / 29 PASS | **GO** |
| **P4** | Consumer Product UI & Accessibility | [`docs/validation/P4_PRODUCT_UI_REPORT.md`](docs/validation/P4_PRODUCT_UI_REPORT.md) | 38 / 38 PASS | **GO** |
| **P5** | Compatibility & Real-World Validation | [`docs/validation/P5_COMPATIBILITY_REPORT.md`](docs/validation/P5_COMPATIBILITY_REPORT.md) | 41 / 41 PASS | **GO** |
| **P6** | Hardening & Release Packaging | [`docs/validation/P6_RELEASE_REPORT.md`](docs/validation/P6_RELEASE_REPORT.md) | 59 / 59 PASS | **GO** |
| **Total** | **Whole WebAudioBalance Platform** | **6 Detailed Gate Reports** | **206 / 206 PASS** | **RELEASE READY** |

---

## 4. Architecture

```text
[ Browser Tab Events / User Gestures ]
                  |
                  v
+-------------------------------------------------------------+
|                 Control Plane: Service Worker               |
|                                                             |
|  - MultiTabCoordinator                                      |
|  - ManagedTabRegistry (State Trinity: managed/captured/active)
|  - SettingsController (persisted to chrome.storage.local)   |
|  - Context Menu: "WebAudioBalance: Balance this tab"        |
+-------------------------------------------------------------+
                  |                         |
     Chrome IPC   |                         | Snapshots & Actions
                  v                         v
+-----------------------------------+  +----------------------+
|   Audio Plane: Offscreen Document |  |  Product Popup UI    |
|                                   |  |                      |
|  - AudioEngineManager             |  |  - Global Switch     |
|    ├── AudioEngine (Tab 101)      |  |  - Semantic Levels   |
|    │   ├── TabCaptureAudioSource  |  |  - Managed Tab Deck  |
|    │   ├── BS.1770 K-Weighting    |  |  - Detected Tabs     |
|    │   ├── LoudnessMeter (LUFS)   |  |  - Diagnostics       |
|    │   ├── ActivityDetector       |  +----------------------+
|    │   ├── NormalizationController|
|    │   ├── GainProcessor          |
|    │   └── SafetyHook (Limiter)   |
|    └── AudioEngine (Tab 102) ...  |
+-----------------------------------+
```

---

## 5. Installation & Usage

### 5.1 Loading the Extension

1. Open **Google Chrome** (`chrome://extensions/`) or **Microsoft Edge** (`edge://extensions/`);
2. Enable **Developer mode** (top right in Chrome, left sidebar in Edge);
3. Click **Load unpacked**;
4. Select the project root directory: `d:\CHATGPT_WORKSPACE\WebAudioBalance`.

### 5.2 Historical v1 Usage Flow

1. Navigate to any website playing audio (e.g. YouTube, Twitch, Bilibili, Spotify Web);
2. Click the **WebAudioBalance** extension icon in your browser toolbar;
3. Select your desired **Listening Level**:
   - **Quiet**: $-24\text{ LUFS}$ (relaxed late-night listening)
   - **Normal**: $-18\text{ LUFS}$ (standard streaming default)
   - **Loud**: $-14\text{ LUFS}$ (high clarity for dialogue & podcasts)
4. Under **Detected Audio Tabs**, click **Balance** next to the tab;
5. The tab moves into **Managed Tabs**, where its loudness converges smoothly toward your target. You can adjust the volume slider ($\pm 12\text{ dB}$) or double-click to reset to $0\text{ dB}$.

*Tip:* You can also right-click anywhere on any page and choose **"WebAudioBalance: Balance this tab"**.

---

## 6. Historical Automated Verification

Run all test suites locally with Node.js:

```bash
# Run complete test suite (206 automated tests)
node test/test-p1-engine.mjs
node test/test-p2-normalization.mjs
node test/test-p3-orchestration.mjs
node test/test-p4-ui.mjs
node test/test-p5-compatibility.mjs
node test/test-p6-release.mjs
```

---

## 7. Documentation

- [`docs/PROJECT_MAINLINE_PLAN.md`](docs/PROJECT_MAINLINE_PLAN.md): Core frozen architecture and mainline scope.
- [`docs/planning/`](docs/planning/): Implementation specifications for phases P1 through P6.
- [`docs/validation/`](docs/validation/): Verification reports and gate decision records for phases P0 through P6.
- [`test/fixtures/compatibility-fixture.html`](test/fixtures/compatibility-fixture.html): Real-world audio fixture test harness.

---

## 8. License

License selection is intentionally deferred until the project owner chooses the distribution license.
