# P3 — Multi-tab Orchestration Validation Report

> Phase: **P3 — Multi-tab Orchestration**  
> Status: **COMPLETE**  
> Decision: **GO (Proceed to P4)**  
> Parent Baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 15)  
> Implementation Specification: `docs/planning/P3_MULTI_TAB_ORCHESTRATION_IMPLEMENTATION_SPEC.md`  
> Target: Chromium Manifest V3 (Google Chrome & Microsoft Edge)

---

## 1. Executive Summary

### Gate Decision: **GO**

Phase P3 has successfully established the complete multi-tab orchestration and coordination subsystem, connecting the Control Plane (Service Worker) with the Audio Plane (Offscreen Document) while strictly adhering to the architectural prohibition against cross-tab AGC feedback loops.

Key achievements:
1. **ManagedTabRegistry & State Trinity**: Formalized the clean separation of three orthogonal logical states:
   - `managed`: whether the user has opted the tab into extension management;
   - `captured`: whether an active MediaStream and AudioEngine session exists;
   - `active`: whether the stream currently produces meaningful audio (not silent/paused).
   Paused media leaves `managed=true, captured=true, active=false`, preserving user configuration across pause/resume cycles.
2. **Global & Per-Tab Hierarchy**: Implemented and verified the composite normalization formula:
   $$\text{effectiveAuto} = \text{globalAutoEnabled} \land \text{tabAutoEnabled}$$
   Disabling global auto-normalization or per-tab auto-normalization leaves manual offset controls ($[-12\text{ dB}, +12\text{ dB}]$) fully active.
3. **Strict Decentralized Independence (Principle A5)**: Verified that Tab A source loudness variations and gain decisions produce **zero crosstalk** into Tab B. Each tab's `AudioEngine` converges independently toward the shared target.
4. **Lifecycle Self-Healing**: Tab closures (`chrome.tabs.onRemoved`) cleanly release only the targeted engine without disturbing any remaining managed tabs. URL updates (`chrome.tabs.onUpdated`) maintain presentation metadata.
5. **Clean Persistence**: User preferences (`globalAutoEnabled`, `globalTargetLufs`) persist to `chrome.storage.local`. All transient DSP objects (`AudioContext`, `MediaStream`, biquad history) are strictly excluded from storage.

All P3 acceptance criteria have been met. Progression to **P4 — Product UI & User Interaction** is approved.

---

## 2. P3 Component Architecture

```text
[ Chrome / Edge Browser Events ]       [ Popup UI (Debug / View) ]
        |                                           ^
        | (tabs.onRemoved, tabs.onUpdated)          | (Low-frequency snapshots)
        v                                           v
+-----------------------------------------------------------------------+
|                    Control Plane: Service Worker                      |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                      MultiTabCoordinator                        |  |
|  |    - routes commands: START_CAPTURE, STOP_CAPTURE,              |  |
|  |      SET_NORMALIZATION, SET_TEST_GAIN, SET_GLOBAL_AUTO          |  |
|  +-----------------------------------------------------------------+  |
|          |                                            |               |
|          v                                            v               |
|  [ ManagedTabRegistry ]                     [ SettingsController ]    |
|    - State Trinity:                            - globalAutoEnabled    |
|      managed / captured / active               - globalTargetLufs     |
|    - per-tab offset & normalization            - chrome.storage.local |
+---------------------------------+-------------------------------------+
                                  |
                                  | Internal Messaging
                                  v
+-----------------------------------------------------------------------+
|                    Audio Plane: Offscreen Document                    |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                     AudioEngineManager                          |  |
|  |   - Map<tabId, AudioEngine>                                     |  |
|  |   - Multi-engine target propagation & independent config route  |  |
|  +-----------------------------------------------------------------+  |
|              |                                       |                |
|              v                                       v                |
|      [ AudioEngine 101 ]                     [ AudioEngine 102 ]      |
|      (Independent LUFS                       (Independent LUFS        |
|       normalization)                          normalization)          |
+-----------------------------------------------------------------------+
```

- [`src/control/registry.js`](../../src/control/registry.js): `ManagedTabRegistry` and `ManagedTabState`.
- [`src/control/settings.js`](../../src/control/settings.js): `SettingsController` with `chrome.storage.local`.
- [`src/control/coordinator.js`](../../src/control/coordinator.js): `MultiTabCoordinator` command router.
- [`src/background/service-worker.js`](../../src/background/service-worker.js): SW event binding and tab lifecycle hooks.
- [`src/offscreen/audio-engine-manager.js`](../../src/offscreen/audio-engine-manager.js): Multi-engine manager with target propagation.

---

## 3. Test Suite Execution Results

Executed by [`test/test-p3-orchestration.mjs`](../../test/test-p3-orchestration.mjs):

| Suite | Category | Tested Scenarios | Result |
|---|---|---|:---:|
| **1** | State Trinity & Registry | Initial unmanaged; user enable; capture start; active stream; pause retains capture; disable cleans up | **PASS (6/6)** |
| **2** | Settings & Formula | Defaults; effective formula verification across all 4 truth table combinations; boundary clamping at $-36$ and $-6\text{ LUFS}$ | **PASS (9/9)** |
| **3** | Multi-Tab Coordinator | Parallel tabs (101 & 102); independent manual offsets (no crosstalk); independent LUFS metrics (no shared AGC); per-tab toggle isolation; global target propagation; tab close releases only target tab; snapshot generation | **PASS (14/14)** |
| **Total** | **P3 Orchestration Suite** | **29 Assertions & Scenarios** | **100% PASS** |

### Regression Health Summary
- P1 Audio Engine Suite: **23 / 23 PASS**
- P2 Loudness Normalization Suite: **16 / 16 PASS**
- P3 Multi-tab Orchestration Suite: **29 / 29 PASS**
- **Combined Total**: **68 / 68 PASS (0 Failures)**

---

## 4. Scope and Non-Goals Audit

Confirmation of strict development discipline for P3:
- [x] Zero centralized AGC cross-coupling: Tab A's gain decision NEVER affects Tab B;
- [x] State trinity strictly decoupled: `managed`, `captured`, and `active` operate orthogonally;
- [x] NO production Popup / Options redesign implemented (deferred to P4);
- [x] NO transient DSP objects stored in `chrome.storage.local`;
- [x] Chromium MV3 lifecycle tolerance: Service Worker suspends and wakes cleanly without breaking audio sessions.

---

## 5. Recommendation for Phase P4

1. **Gate Decision**: **GO**.
2. **Next Objective**: Implement **P4 — Product UI & User Interaction**:
   - Design consumer-friendly Popup UI around the primary flow: `Discover -> Enable -> Balance -> Adjust`;
   - Present clear user-facing states (`Detected`, `Enabled`, `Balancing`, `Balanced`, `Manual`, `Paused`, `Unavailable`);
   - Provide semantic listening-level controls (Quiet / Normal / Loud) mapping to `targetLufs`;
   - Implement per-tab volume slider (manual offset) and automatic normalization toggle;
   - Implement WCAG accessibility (keyboard navigation, ARIA labels, contrast);
   - Ensure Popup closure never interrupts background audio processing.
