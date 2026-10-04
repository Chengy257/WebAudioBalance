# R2 — Runtime & State Reliability Mainline Plan

> Status: **FROZEN PLAN — IMPLEMENTATION BLOCKED UNTIL R1 GO**  
> Frozen Date: **2026-10-04**  
> Parent baseline: `docs/planning/POST_V1_FUNCTIONAL_REBASELINE_PLAN.md`  
> Dependency: corrected R1 closeout must be GO/FROZEN before R2 implementation begins.

---

## 1. Objective

R2 makes the extension's distributed runtime state **truthful, recoverable, and command-safe**.

R2 does not redesign the product UI. It provides one coherent state/control substrate so the later R3 UI can trust what it displays.

The core R2 rule is:

> The Popup never invents runtime success, the Service Worker never assumes Audio Runtime success, and the Audio Runtime never publishes a payload under a schema that means something else elsewhere.

---

## 2. Frozen ownership model

R2 freezes the following source-of-truth boundaries.

### 2.1 Audio Runtime / Offscreen

Authoritative for live audio-engine facts:

- which AudioEngines actually exist;
- engine lifecycle state;
- capture/audio context runtime state;
- R1 canonical audio metrics;
- current applied audio parameters;
- current active/frozen/limited state.

### 2.2 Service Worker / Coordinator

Authoritative for control-plane intent and reconciled product state:

- global settings;
- per-tab user intent/settings;
- browser tab metadata;
- mapping between user-managed tabs and live runtime engines;
- canonical snapshot served to Popup;
- command orchestration and error state.

It must derive `captured=true` from confirmed runtime evidence, not from “message send did not throw”.

### 2.3 Browser APIs

External evidence for browser-owned state:

- tab existence and metadata from `chrome.tabs`;
- capture status from `chrome.tabCapture.getCapturedTabs()` where supported;
- Offscreen existence from `chrome.runtime.getContexts()` / supported Offscreen APIs.

Browser capture status is corroborating evidence, not a replacement for Audio Runtime engine state.

### 2.4 Popup

A transient projection/control client only.

It owns ephemeral interaction state such as:

- currently dragged slider;
- open diagnostics panel;
- in-flight button state.

It is not authoritative for managed/captured/active/audio state.

---

## 3. R2 problem set

R2 explicitly owns the following current defects.

1. `RUNTIME_STATE` payload collision:
   - Offscreen sends `{activeStreams}`;
   - Popup treats the same message type as a Coordinator snapshot.

2. incomplete command acknowledgement:
   - Coordinator often treats a resolved `sendMessage()` as success without checking `response.success`;
   - several update methods swallow failures.

3. optimistic state mutation:
   - captured/settings state is mutated before downstream confirmation;
   - Popup locally changes settings without authoritative reconciliation on failure.

4. Service Worker restart:
   - registry is in-memory;
   - current `QUERY_RUNTIME_STATE` returns Coordinator memory rather than querying Offscreen;
   - surviving Offscreen engines can therefore disagree with a restarted SW.

5. incomplete tab metadata:
   - start-management path can create `Untitled Tab`;
   - favicon/current tab metadata is not reliably seeded/refreshed.

6. telemetry/state schema lag:
   - registry stores legacy R1/P2 metric names and omits canonical R1 fields;
   - `AudioEngineManager.getAllStates()` publishes only a subset of the new metrics.

7. excessive metrics IPC:
   - audio metrics are forwarded approximately every control cycle whether or not the UI needs them.

8. detected-tab refresh/UI coupling:
   - discovery refresh updates memory but does not guarantee visible refresh.
   - R2 owns the reliable event/state mechanism; R3 owns final visual behavior.

---

## 4. Canonical message contract

R2 must replace ambiguous message semantics with explicit command/query/event contracts.

The implementation may preserve existing string constants temporarily, but each message type must have one payload schema.

### 4.1 Commands

Examples:

```text
START_CAPTURE
STOP_CAPTURE
SET_TAB_RELATIVE_OFFSET
SET_TAB_NORMALIZATION
SET_GLOBAL_AUTO
SET_GLOBAL_TARGET
```

Every command response must return an explicit result:

```js
{
  success: true,
  command: "START_CAPTURE",
  tabId: 123,
  revision: 42
}
```

or:

```js
{
  success: false,
  command: "START_CAPTURE",
  tabId: 123,
  error: {
    code: "AUDIO_ENGINE_START_FAILED",
    message: "..."
  }
}
```

A fulfilled Promise containing `success:false` is failure.

### 4.2 Queries

Use distinct semantics for:

- Audio Runtime snapshot query;
- Coordinator/product snapshot query.

Do not reuse one query name to mean different snapshots.

### 4.3 Events

Use distinct events for:

- runtime lifecycle snapshot/change;
- audio telemetry;
- capture/runtime error;
- reconciled product snapshot change if needed.

`RUNTIME_STATE` must not remain an overloaded payload type.

---

## 5. Canonical tab state

R2 should converge the Coordinator registry on one tab record containing at least:

```text
identity:
  tabId
  title
  url
  favIconUrl

browser:
  audible
  exists

intent:
  managed
  normalizationEnabled
  relativeOffsetDb

runtime:
  captured
  engineState
  audioContextState
  active
  frozen
  limited
  limitReason
  lastRuntimeError

audio:
  inputMomentaryLufs
  inputShortTermLufs
  inputMomentaryValid
  inputShortTermValid
  inputSamplePeakDbFS
  outputMomentaryLufs
  outputShortTermLufs
  outputMomentaryValid
  outputShortTermValid
  outputSamplePeakDbFS
  effectiveTargetLufs
  appliedGainDb
  outputTargetErrorLu

freshness:
  runtimeRevision
  metricsSequence
  lastUpdated
```

Legacy aliases may exist at boundaries during migration but not as competing authoritative state.

---

## 6. Command transaction rules

### 6.1 Start

Required order:

```text
user intent
-> acquire stream ID / ensure Offscreen
-> send START_CAPTURE
-> require success ACK from Audio Runtime
-> reconcile runtime snapshot
-> only then captured=true
```

If engine start fails:

- managed intent may remain or roll back according to the command policy;
- captured must be false;
- error must be retained;
- Popup must receive a truthful failure result.

### 6.2 Stop

Do not mark the runtime stopped solely before Offscreen confirmation.

Stop should be idempotent:

- already absent engine -> success with explicit “already stopped” semantics;
- live engine -> stop and confirm absence;
- failure -> retain truthful state/error for reconciliation.

### 6.3 Settings changes

Per-tab/global settings commands must:

1. validate request;
2. send to relevant live engines;
3. inspect each ACK;
4. update canonical state according to confirmed result;
5. return partial-failure information if a multi-engine global command is not fully applied.

Do not silently swallow downstream failures.

---

## 7. Startup and wake reconciliation

Service Worker initialization must reconcile instead of assuming an empty runtime.

Recommended sequence:

```text
SW wake/start
-> load persisted global/per-tab intent needed for continuity
-> inspect Offscreen existence
-> if Offscreen exists, QUERY_AUDIO_RUNTIME_SNAPSHOT
-> query browser tab metadata for referenced tabIds
-> query chrome.tabCapture.getCapturedTabs() where available
-> merge evidence under explicit precedence rules
-> rebuild Coordinator registry
-> expose reconciled product snapshot
```

Precedence:

1. live Offscreen AudioEngine state is authoritative for actual engine existence;
2. browser capture API corroborates browser capture status;
3. stored control intent supplies settings/intent, not proof of live capture.

If Offscreen is absent, stale stored `captured=true` must never survive reconciliation.

Chrome documents `tabCapture.getCapturedTabs()` as returning tabs with non-stopped/non-error capture status, and current Chromium supports Service Worker stream IDs being consumed by an Offscreen Document. R2 should use these APIs as reconciliation evidence where available, with a feature check for compatibility.

---

## 8. Persistence boundary

Persist only state that represents user intent or durable settings.

Required durable/global:

- global auto enabled;
- global target.

Per-tab intent may be stored in session-scoped extension storage if needed for Service Worker restart continuity, but must not be treated as proof the tab or engine still exists.

Do not persist high-rate audio telemetry.

On browser/tab disappearance, stale per-tab session intent must be cleaned.

---

## 9. Tab metadata and lifecycle

When enabling a tab, seed metadata from `chrome.tabs.get(tabId)` or equivalent before/while registering it.

Track at least:

- title;
- URL;
- favicon;
- audible;
- tab existence.

Lifecycle handling must cover:

- title/favicon updates;
- navigation;
- audible changes;
- close;
- capture ending independently;
- engine error.

Navigation is not automatically equivalent to release; browser tab capture may persist across navigation. R2 must reconcile actual capture/engine state rather than assume either outcome.

---

## 10. Telemetry policy

R1 DSP/control cadence remains internal.

R2 must prevent raw control-rate telemetry from becoming cross-context spam.

Recommended policy:

- AudioEngine internal: ~10 Hz or as R1 requires;
- Offscreen aggregate/cache: latest metrics per engine;
- Service Worker update: low-frequency/event-driven;
- Popup when open: typically 2–5 Hz is sufficient;
- Popup closed: no UI telemetry requirement.

Lifecycle/error/command events remain immediate.

The exact implementation may use throttling, coalescing, or snapshot polling, but must preserve the latest authoritative state.

---

## 11. R2 work packages

### R2-A — Contract and state-schema correction

Implement:

- canonical messages;
- distinct runtime vs product snapshots;
- explicit ACK/NACK;
- canonical R1 metric propagation;
- registry schema migration.

Gate: no message type has multiple incompatible payload meanings.

### R2-B — Transactional command handling

Implement:

- start/stop command confirmation;
- per-tab setting ACK;
- global setting aggregate results;
- retained actionable runtime errors;
- removal of swallowed downstream failures.

Gate: forced Offscreen failures produce visible NACK and do not create false captured/settings state.

### R2-C — Reconciliation and lifecycle

Implement:

- SW wake/start reconciliation;
- Offscreen snapshot query;
- browser capture corroboration;
- metadata seeding/updates;
- tab close/navigation/error handling;
- stale-state cleanup.

Gate: terminate/restart/wake the Service Worker while engines continue; Coordinator reconstructs truthful state.

### R2-D — Telemetry and integration closeout

Implement:

- telemetry aggregation/throttle;
- Popup receives canonical snapshots/metrics without state-schema overwrite;
- integration harness for lifecycle.

Gate: full R2 hard acceptance flow passes.

---

## 12. R2 hard acceptance flow

A real extension/browser test must demonstrate:

```text
1. open Popup
2. discover an audio tab
3. enable it
4. receive real Audio Runtime ACK
5. Coordinator reports managed=true, captured=true
6. close Popup
7. audio processing continues
8. restart/wake Service Worker
9. reopen Popup
10. state is reconstructed correctly
11. change relative level and global target
12. verify Audio Runtime ACK and canonical state
13. force a command/runtime failure
14. verify no false success state
15. pause/resume and navigation
16. close/release tab
17. verify runtime and registry cleanup
```

Also assert:

- no `RUNTIME_STATE` schema collision;
- no swallowed command failure;
- no stale captured state after engine loss;
- no missing basic metadata for a normally accessible tab;
- telemetry volume is bounded.

---

## 13. R2 closeout

Required artifact:

`docs/validation/R2_RUNTIME_STATE_RELIABILITY_REPORT.md`

R2 may be **GO/FROZEN** only when the real browser lifecycle/reconciliation test passes.

R3 implementation must not compensate for unresolved R2 state inconsistency.
