# WebAudioBalance

> **Current Status: v1.1.0 — RELEASED**  
> **Post-v1 Functional Rebaseline: COMPLETE**  
> All 15 release gates (G1–G15) are verified across Microsoft Edge and Google Chrome under the authoritative [Final Closeout and v1.1.0 Release Plan](docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md). Full verification results, test traces, and release audit are recorded in the [Final Closeout and v1.1.0 Release Report](docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md).

---

## 1. Project Overview

**WebAudioBalance** solves the common problem of inconsistent audio volume across different browser tabs. When switching between YouTube videos, Bilibili streams, Twitch broadcasts, podcasts, and video meetings, volume levels often fluctuate wildly.

The product implements an absolute perceptual loudness normalization architecture on Chromium Manifest V3:
- **Absolute loudness target model**: each user-enabled tab independently converges toward a shared perceptual loudness target (ITU-R BS.1770 LUFS);
- **Independent per-tab AudioEngines**: one tab's source loudness changes do not directly modulate another tab's controller;
- **Simultaneous multi-tab processing**: parallel `tabCapture` stream acquisition and concurrent independent `AudioEngine` instances are empirically validated on both Google Chrome and Microsoft Edge (CLASS A);
- **Relative per-tab adjustment**: the user volume slider defines an intentional offset ($\pm 12\text{ dB}$) from the shared listening target;
- **Continuous loudness measurement and processed-output verification**: meters track both incoming source loudness and processed output loudness, maintaining safety headroom;
- **Chromium MV3 architecture**: tab capture via `chrome.tabCapture`, Offscreen Audio Runtime (`chrome.offscreen`), Service Worker control plane with state synchronization, and a unified Chrome/Edge codebase.

---

## 2. Current Development Status

The authoritative release plan is [`docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`](docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md). The post-v1 rebaseline and final closeout phases have concluded with unanimous **GO** decisions across all gates:

```text
R0  Functional Rebaseline                 COMPLETE / FROZEN
R1  Audio Core Correction                 COMPLETE / VERIFIED (23/23 tests)
R2  Runtime State & Isolation             COMPLETE / VERIFIED (84/84 tests)
R3  Product UX & UI                       IMPLEMENTED / VERIFIED (28/28 tests)
FC  Final Closeout & v1.1.0 Release       COMPLETE / RELEASED (15/15 gates GO)
```

The original P0–P6 cycle and early R3 reports are retained in `docs/validation/` as historical engineering records. Their previous assertions are formally superseded by the release candidate evidence in [`FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`](docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md).

---

## 3. Authoritative Release Gates (v1.1.0)

| Gate | Scope | Target Browser / Context | Status | Decision |
|---|---|---|:---:|:---:|
| **G1** | R1 Audio Core Unit Suite | Pure Node.js & DSP Core | 23 / 23 PASS | **PASS** |
| **G2** | R2 Runtime & State Reliability | Node.js Mock IPC & Coordinator | 84 / 84 PASS | **PASS** |
| **G3** | R3 Product UX & UI Presenter | Node.js DOM / Preset Logic | 28 / 28 PASS | **PASS** |
| **G4** | FC-1 Full-Stack Production E2E | Google Chrome (v154) | 17 / 17 Scenarios | **PASS** |
| **G5** | FC-1 Full-Stack Production E2E | Microsoft Edge (v154) | 17 / 17 Scenarios | **PASS** |
| **G6** | FC-2 Fixture Compatibility Matrix | Categories 1–10 (Chrome & Edge) | 18 PASS / 2 Constraints | **PASS** |
| **G7** | FC-2 Real-Source Checks (Layer B) | YouTube, Bilibili, Twitch, Spotify | Classified Honestly | **PASS** |
| **G8** | FC-3 Continuous Stability & Soak | Google Chrome | 0 Leaks, 0 Errors | **PASS** |
| **G9** | FC-3 Continuous Stability & Soak | Microsoft Edge | 0 Leaks, 0 Errors | **PASS** |
| **G10** | FC-3 Perceptual Quality Checklist | Listening Tests (8 checks) | 0 FAIL | **PASS** |
| **G11** | FC-4 Packaged Release Artifact Load | Google Chrome (Unpacked ZIP) | Clean Load / MV3 SW OK | **PASS** |
| **G12** | FC-4 Packaged Release Artifact Load | Microsoft Edge (Unpacked ZIP) | Clean Load / MV3 SW OK | **PASS** |
| **G13** | FC-4 Version & Metadata Consistency | manifest 1.1.0, pkg 1.1.0, tags | Consistent | **PASS** |
| **G14** | FC-4 Core CI Workflow | GitHub Actions (Ubuntu/Node 20) | Active & Configured | **PASS** |
| **G15** | FC-5 Independent Final Release Audit | Repository & Evidence Audit | 0 Deficiencies | **GO** |

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

1. Download `webaudiobalance-v1.1.0.zip` from [GitHub Releases](https://github.com/Chengy257/WebAudioBalance/releases/tag/v1.1.0) and extract it;
2. Open **Google Chrome** (`chrome://extensions/`) or **Microsoft Edge** (`edge://extensions/`);
3. Enable **Developer mode**;
4. Click **Load unpacked**;
5. Select the extracted release directory (or the repository root).

### 5.2 Usage Flow

1. Navigate to any tab playing audio (e.g. YouTube, Twitch, Bilibili, Spotify Web);
2. Click the **WebAudioBalance** extension icon in your browser toolbar;
3. Select your desired **Listening Level**:
   - **Quiet**: $-24\text{ LUFS}$ (relaxed late-night listening)
   - **Normal**: $-18\text{ LUFS}$ (standard streaming default)
   - **Loud**: $-14\text{ LUFS}$ (high clarity for dialogue & podcasts)
4. Under **Detected Audio Tabs**, click **Balance** next to the tab;
5. The tab moves into **Managed Tabs**, where its loudness converges smoothly toward your target. You can adjust the Relative Level slider ($\pm 12\text{ dB}$) or double-click to reset to $0\text{ dB}$.

*Tip:* You can also right-click anywhere on any page and choose **"WebAudioBalance: Balance this tab"**.

---

## 6. Automated Verification

Run core test suites locally with Node.js:

```bash
# Run core test suites (R1, R2, R3 unit suites - 135 tests)
npm test

# Run full-stack production E2E (17 production lifecycle scenarios)
npm run test:fc1:e2e

# Run architectural fixture compatibility suite (Categories 1-10)
npm run test:fc2:compat

# Run continuous stability & soak test
npm run test:fc3:soak

# Run simultaneous multi-tab concurrent verification (CLASS A)
npm run test:rc1:multitab

# Build packaged release artifact
npm run package
```

---

## 7. Documentation

- [`docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`](docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md): Final closeout authority and release plan.
- [`docs/planning/FINAL_RELEASE_CORRECTION_PLAN.md`](docs/planning/FINAL_RELEASE_CORRECTION_PLAN.md): Post-release evidence correction and multi-tab verification plan.
- [`docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`](docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md): Authoritative release validation report for v1.1.0.
- [`docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`](docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md): Core rebaseline architecture and roadmap.
- [`test/fixtures/compatibility-fixture.html`](test/fixtures/compatibility-fixture.html): Architectural audio fixture test harness.

---

## 8. License

License selection is intentionally deferred until the project owner chooses the distribution license.
