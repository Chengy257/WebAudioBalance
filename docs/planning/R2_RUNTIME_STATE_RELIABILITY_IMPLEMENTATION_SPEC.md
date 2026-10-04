# R2 — Runtime & State Reliability Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC — CODE START AFTER FINAL R1 GO**  
> Frozen Date: **2026-10-04**  
> Parent plan: `docs/planning/R2_RUNTIME_STATE_RELIABILITY_PLAN.md`  
> Upstream dependency: R1 Audio Core GO/FROZEN  
> Purpose: provide a single Codex-ready implementation specification for truthful distributed state, explicit command acknowledgement, Service Worker reconciliation, lifecycle correctness, and bounded telemetry.

---

## 1. Implementation outcome

R2 is complete only when the product has one coherent control/runtime state model across:

```text
Browser APIs
    |
Service Worker / Coordinator
    |
Offscreen Audio Runtime
    |
Popup projection
```

R2 does not redesign the Popup. It makes the existing UI capable of consuming reliable state.

The implementation must preserve the R1 AudioEngine/DSP behavior unchanged except for state/telemetry adapters needed to expose canonical metrics.

---

## 2. Files and responsibility map

Expected primary modifications:

```text
src/shared/messages.js
src/shared/failure-taxonomy.js

src/control/registry.js
src/control/settings.js
src/control/coordinator.js

src/background/service-worker.js

src/offscreen/audio-engine-manager.js
src/offscreen/offscreen.js

src/popup/popup.js
```

Popup changes in R2 are limited to protocol/state-consumption correctness. Visual hierarchy and status semantics remain R3.

Expected tests:

```text
test/test-r2-runtime-state.mjs
test/run-r2-browser-integration.mjs
test/fixtures/r2-runtime-state/*
```

Required closeout:

```text
docs/validation/R2_RUNTIME_STATE_RELIABILITY_REPORT.md
```

---

## 3. Canonical protocol primitives

### 3.1 Message envelope

Retain a simple extension message envelope:

```js
{
  type,
  target,
  payload,
  requestId,
  timestamp
}
```

`requestId` is required for commands/queries and optional for one-way events.

Do not introduce a general RPC framework.

### 3.2 Command result

All fallible commands return:

```js
{
  success: true,
  requestId,
  command,
  tabId?, 
  revision?,
  result?
}
```

or:

```js
{
  success: false,
  requestId,
  command,
  tabId?,
  error: {
    code,
    message,
    retryable
  }
}
```

A resolved message containing `success:false` is a failure and must propagate as such.

### 3.3 Required distinct queries

Use separate message types for:

```text
GET_PRODUCT_SNAPSHOT
GET_AUDIO_RUNTIME_SNAPSHOT
```

The first returns the Coordinator's reconciled product state.

The second is handled only by Offscreen and returns live engine/runtime state.

Do not retain `QUERY_RUNTIME_STATE` as a dual-purpose query. It may remain only as a temporary compatibility alias routed to one unambiguous meaning and must be deprecated.

### 3.4 Required distinct events

At minimum distinguish:

```text
AUDIO_RUNTIME_READY
AUDIO_RUNTIME_LIFECYCLE
AUDIO_TELEMETRY
PRODUCT_SNAPSHOT_CHANGED   optional
CAPTURE_ERROR              compatibility event if still useful
```

Remove or deprecate the overloaded `RUNTIME_STATE` broadcast.

---

## 4. Audio Runtime snapshot schema

`AudioEngineManager.getRuntimeSnapshot()` should return:

```js
{
  runtimeInstanceId,
  generatedAt,
  engines: [
    {
      tabId,
      engineState,
      audioContextState,
      startedAt,

      active,
      frozen,
      limited,
      limitReason,

      globalTargetLufs,
      relativeOffsetDb,
      effectiveTargetLufs,
      appliedGainDb,
      desiredAutoGainDb,
      appliedAutoGainDb,

      inputMomentaryLufs,
      inputShortTermLufs,
      inputMomentaryValid,
      inputShortTermValid,
      inputSamplePeakDbFS,

      outputMomentaryLufs,
      outputShortTermLufs,
      outputMomentaryValid,
      outputShortTermValid,
      outputSamplePeakDbFS,
      outputTargetErrorLu,

      metricsSequence,
      lastRuntimeError
    }
  ]
}
```

`runtimeInstanceId` is generated once when the Offscreen runtime/manager initializes and lets the Coordinator distinguish a surviving runtime from a newly recreated runtime.

Do not send legacy-only `activeStreams` as the canonical representation.

---

## 5. Canonical Coordinator tab record

Refactor `ManagedTabState` to separate intent, runtime, and audio evidence.

Recommended representation:

```js
{
  tabId,

  metadata: {
    title,
    url,
    favIconUrl,
    audible,
    exists
  },

  intent: {
    managed,
    normalizationEnabled,
    relativeOffsetDb
  },

  runtime: {
    captured,
    engineState,
    audioContextState,
    active,
    frozen,
    limited,
    limitReason,
    lastRuntimeError,
    runtimeInstanceId
  },

  audio: {
    inputMomentaryLufs,
    inputShortTermLufs,
    inputMomentaryValid,
    inputShortTermValid,
    inputSamplePeakDbFS,

    outputMomentaryLufs,
    outputShortTermLufs,
    outputMomentaryValid,
    outputShortTermValid,
    outputSamplePeakDbFS,

    effectiveTargetLufs,
    appliedGainDb,
    outputTargetErrorLu,
    metricsSequence
  },

  revision,
  lastUpdated
}
```

A flatter internal representation is acceptable if serialization preserves these semantic boundaries.

Compatibility getters may temporarily expose:

```text
managed
captured
active
manualOffsetDb
shortTermLufs
...
```

but they must be derived aliases, not separate mutable state.

---

## 6. Product snapshot

The Service Worker exposes one canonical product snapshot:

```js
{
  revision,
  generatedAt,
  globalSettings: {
    globalAutoEnabled,
    globalTargetLufs
  },
  managedTabs: [...],
  allKnownTabs: [...],
  lastReconciliation: {
    at,
    reason,
    runtimeInstanceId
  }
}
```

`revision` increments on meaningful reconciled product-state changes.

Popup must ignore older snapshots when a newer revision has already been applied.

---

## 7. Persistence model

### 7.1 Durable global settings

Keep:

```text
chrome.storage.local
  globalAutoEnabled
  globalTargetLufs
```

### 7.2 Session-scoped tab intent

Use `chrome.storage.session` for per-tab control intent required across Service Worker restarts within the current browser session:

```text
tabId
managed
normalizationEnabled
relativeOffsetDb
updatedAt
```

Do not persist:

- live capture truth;
- engine existence;
- audio telemetry;
- `captured=true`;
- stale errors beyond what is needed for immediate UX.

Session storage is explicitly appropriate for state that must survive Service Worker runs but not browser restarts.

### 7.3 Cleanup

Remove session intent when:

- user releases and chooses no longer managed;
- tab closes;
- tab no longer exists during reconciliation.

---

## 8. Coordinator readiness barrier

Current Service Worker can receive messages before asynchronous settings initialization is guaranteed complete.

Introduce a single readiness promise:

```js
const coordinatorReady = coordinator.init();
```

Every command/query path requiring settings or reconciliation must await readiness.

`init()` should:

1. load global settings;
2. load session-scoped tab intent;
3. run initial reconciliation;
4. only then expose a reconciled snapshot.

Avoid parallel independent initialization paths.

---

## 9. Start transaction

### 9.1 Metadata seed

Before or during start:

```text
chrome.tabs.get(tabId)
-> seed title/url/favIconUrl/audible
```

A normal start must not create an avoidable `Untitled Tab`.

### 9.2 Transaction

Required:

```text
set/confirm managed intent
-> ensure Offscreen
-> acquire stream ID under valid user gesture path
-> START_CAPTURE to Offscreen
-> inspect response.success
-> query/consume runtime evidence
-> set captured=true only if live engine exists
-> persist session intent
-> return command result
```

On Offscreen NACK:

- captured=false;
- retain actionable runtime error;
- managed intent may remain true so UI can show Error/Retry;
- return `success:false`.

Do not report start success merely because `sendMessage()` resolved.

---

## 10. Stop transaction

Stop must be idempotent.

Required semantics:

- live engine exists -> stop, verify absence, success;
- no engine exists -> success with `alreadyStopped:true`;
- runtime failure -> `success:false`, preserve truthful reconciled state.

After a confirmed user Release:

- `intent.managed=false`;
- remove session intent;
- captured=false;
- clear stale audio metrics/error when appropriate.

Do not optimistically remove live runtime truth before confirmation.

---

## 11. Settings transactions

### 11.1 Per-tab Relative Level / normalization

For a live captured tab:

```text
validate request
-> send runtime command
-> inspect ACK
-> update intent/canonical state
-> persist session intent
-> return result
```

If runtime rejects the command, UI-visible intent must not falsely appear applied.

For a managed but currently uncaptured/error tab, settings may update stored intent, but the command result must indicate that there is no live runtime application.

### 11.2 Global target / auto

Global settings are durable user intent and may be saved immediately.

For every live engine:

- propagate command;
- collect individual results;
- return aggregate result.

Example:

```js
{
  success: false,
  settingPersisted: true,
  appliedTo: [101, 102],
  failedTabs: [{ tabId: 103, error: {...} }]
}
```

Coordinator must mark failed live tabs out-of-sync/error rather than pretending all engines accepted the change.

---

## 12. Reconciliation algorithm

Implement one explicit `reconcileRuntime(reason)` operation.

Inputs:

1. session intent;
2. current Offscreen existence;
3. `GET_AUDIO_RUNTIME_SNAPSHOT` if Offscreen exists;
4. `chrome.tabCapture.getCapturedTabs()` when available;
5. current `chrome.tabs.get()` metadata for referenced tab IDs.

Chrome currently exposes `tabCapture.getCapturedTabs()` for requested/active captures, and `storage.session` is designed to retain in-memory state across Service Worker runs. These are evidence sources, not the sole source of truth.

### 12.1 Merge precedence

For actual engine existence:

```text
Offscreen runtime snapshot > stored intent
```

For browser capture corroboration:

```text
tabCapture CaptureInfo = external evidence
```

For user preference:

```text
stored/session intent = authoritative intent
```

For tab existence/metadata:

```text
chrome.tabs = authoritative
```

### 12.2 Important cases

#### Offscreen survives SW restart

Rebuild registry from live engines and session intent.

#### Offscreen absent

No tab may remain `captured=true`.

Managed intent may remain so the product can show that re-enable/retry is needed.

#### Runtime engine exists but session intent is missing

Treat the live engine as managed for current reconciliation and create session intent consistent with its current configuration.

#### Stored managed intent exists but tab disappeared

Remove stale intent and registry entry.

#### Browser CaptureInfo and Offscreen disagree

Record a reconciliation error/diagnostic; do not silently invent healthy state.

---

## 13. Lifecycle events

Add/use:

- `chrome.tabs.onRemoved`;
- `chrome.tabs.onUpdated`;
- `chrome.tabCapture.onStatusChanged`;
- `AUDIO_RUNTIME_READY`;
- Offscreen engine lifecycle event.

### Metadata

On relevant `tabs.onUpdated`, update:

```text
title
url
favIconUrl
audible
```

Use the full `tab` argument where needed, not only `changeInfo`.

### Navigation

Tab capture can persist across navigation. Do not automatically release merely because URL changed.

Reconcile actual runtime/capture state.

---

## 14. Error model

Use stable error codes, preferably via `failure-taxonomy.js`.

Minimum classes:

```text
UNSUPPORTED_TAB
STREAM_ID_ACQUISITION_FAILED
OFFSCREEN_UNAVAILABLE
AUDIO_ENGINE_START_FAILED
AUDIO_ENGINE_NOT_FOUND
AUDIO_COMMAND_REJECTED
RUNTIME_RECONCILIATION_FAILED
TAB_GONE
CAPTURE_STATE_MISMATCH
```

Each error should carry:

```text
code
message
retryable
tabId?
cause?
timestamp
```

Do not use logs as the only error state.

---

## 15. Telemetry transport

R1 AudioEngine may remain at ~10 Hz internally.

R2 must bound extension IPC.

### Required behavior

- Offscreen keeps the latest metrics for each engine at full internal cadence.
- Cross-context `AUDIO_TELEMETRY` must be throttled/coalesced to **no more than 2 Hz per engine by default**.
- lifecycle/error events remain immediate.
- Popup may obtain fresh state on open via `GET_PRODUCT_SNAPSHOT`.
- no raw worklet/DSP samples cross extension contexts.

A more sophisticated Popup subscription is optional, not required for R2.

Hard acceptance records actual message counts over a multi-tab interval.

---

## 16. Popup protocol correction within R2

R2 may minimally change `popup.js` to consume the new protocol.

Required:

- never assign a runtime snapshot object into the product snapshot variable;
- apply only canonical product snapshots to `currentSnapshot`;
- merge telemetry only into the matching tab record;
- check command `success`;
- on failure, reconcile and retain/show error state;
- periodic detected-tab refresh must trigger a render or use the canonical snapshot feed;
- use snapshot revision / metrics sequence to ignore stale data where needed.

R3 owns the final layout, labels, badge design, and non-alert error UX.

---

## 17. R2 test program

### 17.1 Unit/component tests

Cover:

- message schema validation;
- explicit ACK/NACK propagation;
- `success:false` does not mutate captured=true;
- runtime/product snapshot separation;
- registry canonical metric mapping;
- revision ordering;
- settings partial-failure aggregation;
- session intent load/save/cleanup;
- reconciliation merge cases.

### 17.2 Browser extension integration

Run the actual extension, not only isolated modules.

Required scenarios:

1. enable tab successfully;
2. forced engine-start NACK;
3. per-tab setting NACK;
4. global command partial failure;
5. Popup close while audio continues;
6. Popup reopen snapshot correct;
7. terminate/restart Service Worker while Offscreen engine survives;
8. reconciliation restores state;
9. Offscreen/runtime loss;
10. tab navigation;
11. tab close;
12. release;
13. capture-state mismatch diagnostic;
14. metadata/favIcon update;
15. telemetry-rate bound.

---

## 18. R2 work packages and execution order

Keep R2 as four bounded work packages.

### R2-A — Contract + canonical state

Implement:

- new message constants/helpers;
- canonical runtime snapshot;
- canonical registry/product snapshot;
- R1 metrics propagation;
- error schema.

Do not yet rewrite lifecycle.

### R2-B — Transactions + persistence

Implement:

- readiness barrier;
- start/stop ACK/NACK;
- settings command semantics;
- `storage.session` intent;
- failure propagation.

### R2-C — Reconciliation + lifecycle

Implement:

- initial/wake reconciliation;
- Offscreen snapshot query;
- CaptureInfo corroboration;
- lifecycle events;
- metadata correctness.

### R2-D — Telemetry + real browser closeout

Implement:

- telemetry throttle/coalescing;
- minimal Popup protocol correction;
- full browser integration suite;
- validation report.

Do not split these into many additional planning documents.

---

## 19. R2 hard gate

R2 GO requires all of:

```text
message schemas unique                  PASS
false ACK cannot become success         PASS
captured=true requires live runtime     PASS
SW restart reconciliation               PASS
Offscreen loss reconciliation           PASS
tab metadata/lifecycle                   PASS
canonical R1 metrics propagated         PASS
runtime/product snapshots separated     PASS
telemetry bounded                       PASS
real browser lifecycle flow             PASS
```

Required report:

`docs/validation/R2_RUNTIME_STATE_RELIABILITY_REPORT.md`

Only after R2 GO/FROZEN may R3 implementation begin.
