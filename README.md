# WebAudioBalance

> **Current Status: v1.1.1 — RELEASED**  
> **Capture Authorization & Multi-Tab Recovery: COMPLETE**  
> All 12 recovery gates (RA-G1–RA-G12) are verified across Microsoft Edge and Google Chrome under the authoritative [Capture Authorization and Multi-Tab Recovery Plan](docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md). Full empirical evidence, test traces, and release audit are recorded in the [v1.1.1 Recovery Report](docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md). Historical v1.0.0 and v1.1.0 release artifacts remain preserved.

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

The authoritative recovery and closeout plans are [`docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md`](docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md) and [`docs/planning/V1_1_1_FINAL_RELEASE_CLOSEOUT_CORRECTION_PLAN.md`](docs/planning/V1_1_1_FINAL_RELEASE_CLOSEOUT_CORRECTION_PLAN.md). The corrective release phase has concluded with unanimous **GO** decisions across all recovery and final closeout gates:

```text
R0   Functional Rebaseline                 COMPLETE / FROZEN
R1   Audio Core Correction                 COMPLETE / VERIFIED (23/23 tests)
R2   Runtime State & Isolation             COMPLETE / VERIFIED (84/84 tests)
R3   Product UX & UI                       IMPLEMENTED / VERIFIED (28/28 tests)
FC   Final Closeout & v1.1.0 Baseline      COMPLETE / AUDITED (15/15 gates GO)
RA   Capture Auth & Multi-Tab Recovery     COMPLETE / VERIFIED (12/12 gates GO, v1.1.1)
FR   Final Release Closeout Correction     COMPLETE / VERIFIED (12/12 gates GO, v1.1.1)
```

The historical releases and validation records (`v1.0.0`, `v1.1.0`) are retained intact. Full empirical evidence and audited results for v1.1.1 are recorded in [`V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md`](docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md).

---

## 3. Authoritative Recovery Gates (v1.1.1)

| Gate | Scope | Target Browser / Context | Status | Decision |
|---|---|---|:---:|:---:|
| **RA-G1** | Current-Tab Popup Authorization | Google Chrome (v154) | Direct Popup Invocation | **PASS** |
| **RA-G2** | Current-Tab Popup Authorization | Microsoft Edge (v154) | Direct Popup Invocation | **PASS** |
| **RA-G3** | Background Uninvoked Tab Behavior | Chrome & Edge | Rejects unauthorized capture; shows Switch to Tab | **PASS** |
| **RA-G4** | Context-Menu Authorization | Chrome & Edge | Invocation under direct user gesture | **PASS** |
| **RA-G5** | Unsupported-Page Classification | Chrome & Edge | Clear non-capturable UX (`chrome://`, `edge://`, stores) | **PASS** |
| **RA-G6** | No Stale Managed State on Auth Failure | MultiTabCoordinator & State Registry | Immediate rollback, clean unmanaged state | **PASS** |
| **RA-G7** | Real User-Path Browser Acceptance | Chrome & Edge (No test flags) | Verified across activeTab boundaries | **PASS** |
| **RA-G8** | Simultaneous Multi-Tab Experiment | Google Chrome & Microsoft Edge | CLASS A (Concurrent multi-tab supported) | **PASS** |
| **RA-G9** | Controller & Lifecycle Isolation | Concurrent Audio Engines | Independent gain offsets, isolated release | **PASS** |
| **RA-G10** | Package & Metadata Consistency | manifest 1.1.1, pkg 1.1.1, dist artifacts | Aligned v1.1.1 | **PASS** |
| **RA-G11** | Regression Unit & Runtime Suites | R1, R2, R3, RA Suites | 137 / 137 PASS (100%) | **PASS** |
| **RA-G12** | Independent Recovery Audit | Codebase, Artifacts, Evidence | 0 Deficiencies | **GO** |

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

1. Download `webaudiobalance-v1.1.1.zip` from [GitHub Releases](https://github.com/Chengy257/WebAudioBalance/releases/tag/v1.1.1) and extract it;
2. Open **Google Chrome** (`chrome://extensions/`) or **Microsoft Edge** (`edge://extensions/`);
3. Enable **Developer mode**;
4. Click **Load unpacked**;
5. Select the extracted release directory (or the repository root).

### 5.2 Usage Flow

> **Important Workflow Note**: To enable a new tab, switch to that tab and invoke WebAudioBalance there. Once enabled, the tab can be managed centrally with other enabled tabs. Multiple independently authorized tabs remain balanced simultaneously (**CLASS A — Simultaneous Multi-Tab Supported**).

1. **Activate the Target Tab**: Navigate to the tab playing audio (e.g. YouTube, Twitch, Bilibili, Spotify Web);
2. **Invoke WebAudioBalance**: Click the extension icon in your browser toolbar (or right-click the page and choose **"WebAudioBalance: Balance this tab"**);
3. **Balance the Current Tab**: Under **Current Tab**, click **[ Balance This Tab ]** to start real-time loudness balancing;
4. **Manage Across Tabs**:
   - All active balanced tabs appear in **Balanced Tabs**, showing their live status (Balancing, Balanced, Paused, Limited), relative offset slider ($\pm 12\text{ dB}$), and Auto-Balance switch.
   - Other audible tabs are discovered and displayed under **Other Audio Tabs** with a convenient **[ Switch to Tab ]** button, directing you to switch to that tab and invoke the extension.
5. **Adjust Listening Levels**:
   - **Quiet**: $-24\text{ LUFS}$ (relaxed late-night listening)
   - **Normal**: $-18\text{ LUFS}$ (standard streaming default)
   - **Loud**: $-14\text{ LUFS}$ (high clarity for dialogue & podcasts)

---

## 6. Automated Verification

Run core test suites locally with Node.js:

```bash
# Run all unit and regression test suites (R1, R2, R3, RA - 137 tests)
npm test

# Run simultaneous multi-tab concurrent verification (CLASS A across Chrome & Edge)
npm run test:rc1:multitab

# Build packaged release artifacts (ZIP, CRX, SHA256 checksums)
npm run package

# Verify packaged release artifact loads in Chrome & Edge
npm run verify:release
```

---

## 7. Documentation

- [`docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md`](docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md): Authoritative capture authorization and multi-tab recovery plan.
- [`docs/planning/V1_1_1_FINAL_RELEASE_CLOSEOUT_CORRECTION_PLAN.md`](docs/planning/V1_1_1_FINAL_RELEASE_CLOSEOUT_CORRECTION_PLAN.md): Authoritative final release closeout correction plan for v1.1.1.
- [`docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md`](docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md): Authoritative release validation report for v1.1.1.
- [`docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`](docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md): Historical v1.1.0 closeout plan.
- [`docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`](docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md): Historical v1.1.0 release report.
- [`docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`](docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md): Core rebaseline architecture and roadmap.
- [`test/fixtures/compatibility-fixture.html`](test/fixtures/compatibility-fixture.html): Architectural audio fixture test harness.

---

## 8. License

License selection is intentionally deferred until the project owner chooses the distribution license.
