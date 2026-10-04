# P3 — Multi-tab Orchestration Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 15)  
> Foundation: `docs/validation/P2_NORMALIZATION_REPORT.md` (P2 Loudness Measurement & Normalization)  
> Purpose: provide an authoritative, bounded implementation specification to coordinate multiple independent AudioEngines across the Service Worker control plane and Offscreen audio plane.

---

## 1. Authority and Scope

This document specifies the engineering implementation of **P3 — Multi-tab Orchestration**.

P3 builds upon the per-tab `AudioEngine` (P1) and perceptual normalization pipeline (P2), providing the centralized orchestration system that manages multiple independent audio tabs without reintroducing centralized AGC feedback.

### 1.1 In-Scope Responsibilities

P3 owns:
1. **Managed Tab Registry** in the Service Worker:
   - Tracks all managed tabs and candidate audible tabs;
   - Maintains strict separation of the three orthogonal states: `managed`, `captured`, and `active`;
2. **Global vs. Per-Tab Control Hierarchy**:
   - Global settings: `globalAutoEnabled` (boolean) and `globalTargetLufs` (number);
   - Per-tab settings: `normalizationEnabled` (boolean) and `manualOffsetDb` (number);
   - Composite auto-normalization formula:
     $$\text{effectiveAuto} = \text{globalAutoEnabled} \land \text{tabAutoEnabled}$$
   - Independent manual gain offset: disabling automatic normalization MUST NOT disable manual offset control;
3. **Control-to-Audio Message Protocol**:
   - `START_ENGINE { tabId, streamId, targetLufs, normalizationEnabled, manualOffsetDb }`;
   - `STOP_ENGINE { tabId }`;
   - `UPDATE_ENGINE_CONFIG { tabId, targetLufs, normalizationEnabled, manualOffsetDb }`;
   - `SET_GLOBAL_TARGET { targetLufs }`;
   - `SET_GLOBAL_NORMALIZATION { globalAutoEnabled }`;
   - `METRICS_SNAPSHOT { metrics[] }`;
4. **Lifecycle & Tab Event Coordination**:
   - `chrome.tabs.onRemoved`: cleanly releases the specific `AudioEngine` for closed tabs without disturbing remaining tabs;
   - `chrome.tabs.onUpdated`: observes URL changes, reload, and browser-reported `audible` state transitions;
   - Service Worker suspend/wake reconciliation: queries Offscreen runtime state on wake;
5. **Persistence**:
   - Persists user preferences and global configuration to `chrome.storage.local`;
   - Strictly prohibits persisting transient DSP objects (AudioContext, streams, buffers).

### 1.2 Explicit Non-Goals for P3

P3 MUST NOT implement:
- Shared cross-tab AGC feedback (Tab A loudness must NEVER affect Tab B's gain decision);
- Production user-facing Popup UI (owned by P4);
- Equalization, multiband compression, or AI enhancement;
- MediaElement fallback backends.

---

## 2. System Architecture & Topology

```text
[ Chrome / Edge Browser Events ]       [ Popup UI (Debug / View) ]
        |                                           ^
        | (tabs.onRemoved, tabs.onUpdated)          | (Low-frequency updates)
        v                                           v
+-----------------------------------------------------------------------+
|                    Control Plane: Service Worker                      |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                      ManagedTabRegistry                         |  |
|  |   - globalSettings: { globalAutoEnabled, globalTargetLufs }     |  |
|  |   - tabs: Map<tabId, ManagedTabState>                           |  |
|  |     * logical state: managed, captured, active                  |  |
|  |     * settings: normalizationEnabled, manualOffsetDb            |  |
|  |     * metrics snapshot: momentaryLufs, shortTermLufs, gainDb    |  |
|  +-----------------------------------------------------------------+  |
|                                 |                                     |
|  +-----------------------------------------------------------------+  |
|  |                     SettingsStorage                             |  |
|  |   - chrome.storage.local persistence of preferences             |  |
|  +-----------------------------------------------------------------+  |
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
|  +-----------------------------------------------------------------+  |
|              |                                       |                |
|              v                                       v                |
|      +---------------+                       +---------------+        |
|      | AudioEngine A |                       | AudioEngine B |        |
|      +---------------+                       +---------------+        |
|      (Independent LUFS                       (Independent LUFS        |
|       normalization)                          normalization)          |
+-----------------------------------------------------------------------+
```

---

## 3. ManagedTab Data Model & State Separation

```text
ManagedTabState:
  tabId: number
  title: string
  url: string
  favIconUrl: string
  audible: boolean              // Browser-level detection

  // State Trinity:
  managed: boolean              // User has opted tab into extension management
  captured: boolean             // Active MediaStream and AudioEngine session exists
  active: boolean               // Stream contains meaningful audio (not silence/paused)

  // Control Parameters:
  normalizationEnabled: boolean // Per-tab normalization toggle
  manualOffsetDb: number        // Manual offset (-12 dB to +12 dB)
  effectiveGainDb: number       // Applied gain = autoGainDb + manualOffsetDb

  // Metrics:
  momentaryLufs: number
  shortTermLufs: number
  peakDbFS: number
  lastUpdated: number
```

### State Disambiguation Rule
- `managed=true, captured=true, active=true`: Media playing and actively normalizing.
- `managed=true, captured=true, active=false`: Managed media is paused or silent; gain adaptation frozen.
- `managed=true, captured=false, active=false`: User enabled tab, but capture session is starting or pending reactivation after navigation.
- `managed=false, captured=false, active=true/false`: Detected browser tab not yet managed by user.

---

## 4. Work Packages for P3

- **WP0**: Data models and `ManagedTabRegistry` in `src/control/registry.js`.
- **WP1**: Global and per-tab settings controller with persistence in `src/control/settings.js`.
- **WP2**: Multi-tab message contract & orchestration coordinator in `src/control/coordinator.js`.
- **WP3**: Service Worker integration: wire tabs lifecycle (`tabs.onRemoved`, `tabs.onUpdated`) and SW wake/sleep sync.
- **WP4**: Offscreen `AudioEngineManager` enhancements: multi-engine target propagation and independent config update routing.
- **WP5**: Automated Multi-Tab Orchestration Test Suite in `test/test-p3-orchestration.mjs`.
- **WP6**: P3 Validation Report & Gate Decision in `docs/validation/P3_MULTI_TAB_ORCHESTRATION_REPORT.md`.

---

## 5. Acceptance Criteria

P3 is **GO** only if:
1. `ManagedTabRegistry` correctly tracks multiple tabs and distinguishes `managed`, `captured`, and `active` states;
2. Enabling/disabling global auto-normalization propagates to all engines without resetting manual offsets;
3. Turning off per-tab normalization freezes auto-gain to $0\text{ dB}$ while preserving manual offset;
4. Tab A audio level changes affect ONLY Engine A; Engine B converges strictly from its own signal;
5. Closing Tab A disposes ONLY Engine A; Engine B remains running uninterrupted;
6. Settings persist across Service Worker restarts;
7. Zero DSP objects are stored in persistent storage.
