# WebAudioBalance

> **Current Status: Post-v1 Functional Rebaseline — R0 FROZEN**  
> The previous v1.0.0 release-ready conclusion has been superseded after real-use review identified core normalization, runtime-state, UI interaction, and validation-evidence defects. The Chromium MV3 architecture is retained while the product is corrected and revalidated.

---

## 1. Project Overview

**WebAudioBalance** solves the common problem of inconsistent audio volume across different browser tabs. When switching between YouTube videos, Bilibili streams, Twitch broadcasts, podcasts, and video meetings, volume levels often fluctuate wildly. 

Unlike traditional browser extensions that rely on simplistic global peak limiters or invasive DOM scripts, WebAudioBalance provides:
- **Perceptual Loudness Normalization**: Implements ITU-R BS.1770-4 K-weighting filters with integrated Momentary (400ms) and Short-Term (3s) LUFS metering;
- **Decentralized Multi-Tab Architecture**: Each tab runs an independent, isolated `AudioEngine`. Tab A source loudness variations **never** trigger gain changes in Tab B (zero cross-tab AGC feedback loops);
- **Smooth Manual Offsets**: Users can apply independent manual volume offsets ($\pm 12\text{ dB}$) with 40ms parameter smoothing on top of or in place of automatic normalization;
- **Zero Native Dependencies**: 100% pure Web Audio API and standard JavaScript; no native binaries, drivers, or external processes required;
- **Strict Decoupling**: Control plane (Service Worker) and Audio plane (Offscreen Document) operate independently; closing or opening the popup causes zero audio dropouts.

---

## 2. Current Development Status

The authoritative current plan is [`docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`](docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md).

The original P0–P6 cycle and its validation reports are retained as historical engineering records. Their previous **GO / RELEASE READY** decisions do not satisfy the post-v1 release gate. Historical test counts must not be interpreted as proof that the current product achieves reliable absolute cross-tab loudness balancing.

Current correction mainline:

```text
R0  Functional Rebaseline            COMPLETE / FROZEN
R1  Audio Core Correction            NEXT
R2  Runtime & State Reliability      PLANNED
R3  Product UX & Real-world Validation PLANNED
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
