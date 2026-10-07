# WebAudioBalance v1.1.1 — Capture Authorization & Multi-Tab Recovery Release

> **Release Target: v1.1.1**  
> **Release Tag: `v1.1.1`**  
> **Release Lineage: Audited release commit tagged `v1.1.1`**  
> **Release Decision: GO — PRODUCTION RELEASE**  
> **Governing Document: [`docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md`](../docs/planning/CAPTURE_AUTHORIZATION_AND_MULTITAB_RECOVERY_PLAN.md)**  
> **Authoritative Evidence: [`docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md`](../docs/validation/V1_1_1_CAPTURE_AUTH_MULTITAB_RECOVERY_REPORT.md)**  
> **Historical Baseline: Preserved `v1.1.0` (commit `8d4f9d1cc0bbff004078f18090436d74688b34ca`) and `v1.0.0`**

WebAudioBalance v1.1.1 is an audited corrective release that rectifies the first-time tab capture authorization defect, removes misleading background-tab controls, refines popup user experience, and empirically confirms CLASS A simultaneous multi-tab loudness normalization across Google Chrome and Microsoft Edge.

---

### Core Corrections & Highlights

1. **Corrected Capture Authorization Contract (RA-1)**:
   - Eliminated the defect where background tabs were erroneously assumed capturable without activeTab / direct user invocation (`Extension has not been invoked for the current page`).
   - The first-time capture transaction strictly requires an authorized `streamId` acquired within the user's active gesture before launching the audio engine.
   - Right-click context menu `"WebAudioBalance: Balance this tab"` now acquires `streamId` under the direct context-menu user gesture.

2. **Removal of Misleading Remote First-Enable UX (RA-2)**:
   - Popup now clearly categorizes tabs into three distinct sections:
     - **Current Tab**: Provides **[ Balance This Tab ]** for the active tab (or displays a clear unsupported-page message for system/store URLs).
     - **Balanced Tabs**: Displays active balanced tabs with live Relative Level slider ($\pm 12\text{ dB}$), Auto-Balance switch, and **[ Release ]** control.
     - **Other Audio Tabs**: Discovered audible tabs show **[ Switch to Tab ]** with clear guidance: *"Enable WebAudioBalance after switching to this tab"*. Remote first-enable buttons that would fail without activeTab invocation have been completely removed.

3. **Classification of Unsupported Pages (RA-1 & RA-2)**:
   - Non-capturable browser internal pages (`chrome://`, `edge://`, `chrome-extension://`, Chrome Web Store, Edge Addons) are accurately detected and present explicit, non-actionable explanations rather than ambiguous failures.

4. **Zero Stale Managed State on Failure (RA-1, Gate RA-G6)**:
   - If authorization or runtime start fails, the transaction is cleanly aborted and state is rolled back (`managed = false`). No stale "Balancing..." or ghost entries remain in the UI or state registry.

5. **Simultaneous Multi-Tab Capability Empirically Validated (RA-4, CLASS A)**:
   - Validated on both **Google Chrome (v154.0.8037.58)** and **Microsoft Edge (v154.0.4258.53)** without test bypass flags.
   - Multiple tabs, each authorized through real user paths, run concurrent AudioEngine instances simultaneously.
   - Strict controller and lifecycle isolation: Tab A relative level changes do not affect Tab B; releasing Tab A leaves Tab B unaffected; final release cleanly destroys all engine instances.

6. **Preserved Historical Releases**:
   - Historical release artifacts for `v1.0.0` and `v1.1.0` remain completely preserved and unmutated in `dist/`.

---

### Authoritative Recovery Gates (RA-G1 – RA-G12)

| Gate | Category | Requirement | Result | Status |
|:---:|---|---|:---:|:---:|
| **RA-G1** | Authorization | Current-Tab Popup Authorization on Google Chrome | PASS | **PASS** |
| **RA-G2** | Authorization | Current-Tab Popup Authorization on Microsoft Edge | PASS | **PASS** |
| **RA-G3** | UX Contract | Background Tab Direct Capture Rejected cleanly | PASS (No remote capture) | **PASS** |
| **RA-G4** | Context Menu | Context-Menu User Gesture Authorization | PASS | **PASS** |
| **RA-G5** | Error Taxonomy | Clean Unsupported-Page Classification & Messaging | PASS | **PASS** |
| **RA-G6** | State Integrity | No Stale Managed State after Auth Failure | PASS (Immediate Rollback) | **PASS** |
| **RA-G7** | User Acceptance | Real User-Path Browser Verification (No test flags) | PASS | **PASS** |
| **RA-G8** | Multi-Tab | Empirical Simultaneous Multi-Tab Classification | CLASS A (Both Browsers) | **PASS** |
| **RA-G9** | Isolation | Controller & Lifecycle Isolation between Tabs | PASS | **PASS** |
| **RA-G10** | Metadata | Version & Package Consistency (1.1.1 Aligned) | PASS | **PASS** |
| **RA-G11** | Regression | Full Regression Test Suite (R1, R2, R3, RA) | 137 / 137 PASS (100%) | **PASS** |
| **RA-G12** | Audit | Independent Recovery Audit | 0 Deficiencies | **GO** |

---

### Usage Guidance

> **Important Workflow Note**: To enable a new tab, switch to that tab and invoke WebAudioBalance there. Once enabled, the tab can be managed centrally with other enabled tabs. Multiple independently authorized tabs remain balanced simultaneously (**CLASS A — Simultaneous Multi-Tab Supported**).

1. Navigate to the audible tab you wish to balance;
2. Click the WebAudioBalance extension icon (or right-click the page and select "WebAudioBalance: Balance this tab");
3. Click **[ Balance This Tab ]**;
4. Switch to any other tab — your balanced tabs remain running and controllable from any WebAudioBalance popup!

---

### Release Artifact Integrity (SHA-256)

```text
7c438ba5484e59b5aa6b01017aa395d78e3a7630a375366534921203d151bcdb  webaudiobalance-v1.1.1.crx
c984e2308ecfc0aea6e9e3c8692b07ba5e4eef09f52f9162aca41dcca12750e2  webaudiobalance-v1.1.1.pem
9cab156526a35db882079815bda3c5de355081fa30ba1a268652d7f775926efd  webaudiobalance-v1.1.1.zip
```
