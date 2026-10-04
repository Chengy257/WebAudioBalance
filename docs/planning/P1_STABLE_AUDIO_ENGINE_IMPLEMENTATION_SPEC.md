# P1 — Stable Audio Engine Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Section 13)  
> Feasibility Evidence: `docs/validation/P0_FEASIBILITY_REPORT.md`  
> Target: Chromium Manifest V3 (Google Chrome & Microsoft Edge)  
> Purpose: provide an authoritative, bounded implementation specification to build the production per-tab AudioEngine without pre-implementing P2–P6.

---

## 1. Authority and scope

This document is the authoritative engineering specification for **P1 — Stable Audio Engine**.

P1 takes the raw tab-level capture path validated in P0 and formalizes it into a modular, production-ready, testable, and robust per-tab `AudioEngine`.

### 1.1 In-Scope Responsibilities

P1 owns:
- Formal `AudioEngine` class and lifecycle state machine;
- Single-engine-per-managed-tab invariant;
- Clean `AudioSource` abstraction with `TabCaptureAudioSource` backend;
- Deterministic dB gain application with click-free parameter smoothing;
- Engineering RMS and peak level metering;
- Minimal peak safety hook (preventing output clipping / overflow);
- Offscreen Audio Runtime orchestration of multiple independent engines;
- Deterministic signal verification (0 dB, -6 dB, +6 dB, silence, ramp transitions).

### 1.2 Explicit Non-Goals for P1

P1 MUST NOT implement:
- BS.1770 / K-weighted LUFS measurement (owned by P2);
- Automatic loudness normalization / AGC feedback loops (owned by P2);
- Silence gating / activity detection algorithms (owned by P2);
- Production Multi-tab Registry / cross-tab orchestration rules (owned by P3);
- Production user-facing Popup UI (owned by P4);
- MediaElement fallback backend (deferred per Mainline Plan);
- Site-specific workarounds.

---

## 2. Core Architecture

In P1, the Offscreen Audio Runtime is structured into distinct, cohesive components:

```text
+-----------------------------------------------------------------------+
|                    Offscreen Audio Runtime                            |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  |                  AudioEngineManager                             |  |
|  |    - Map<tabId, AudioEngine>                                    |  |
|  |    - Engine lifecycle routing (create / start / stop / destroy)  |  |
|  +-----------------------------------------------------------------+  |
|                                 |                                     |
|             +-------------------+-------------------+                 |
|             |                                       |                 |
|             v                                       v                 |
|     +---------------+                       +---------------+         |
|     | AudioEngine A |                       | AudioEngine B |         |
|     +---------------+                       +---------------+         |
+-----------------------------------------------------------------------+
```

### 2.1 Inside an `AudioEngine`

Each managed tab owns exactly one `AudioEngine`:

```text
[ AudioSource: TabCaptureAudioSource ]
                  |
                  v  (MediaStream)
      MediaStreamAudioSourceNode
                  |
                  +--------------------------------+
                  |                                |
                  v                                v
          [ GainProcessor ]              [ EngineeringMeter ]
                  |                                |
                  v (scaled PCM)             (observation:
            [ SafetyHook ]                   RMS + Peak dBFS)
                  |
                  v
       AudioContext.destination
```

1. **AudioSource**: Encapsulates media stream acquisition, stream lifecycle, and track health.
2. **GainProcessor**: Applies user or test gain in dB with exponential or linear smoothing over a configurable ramp window (default 30–50 ms) to ensure click-free transitions.
3. **EngineeringMeter**: Parallel observation tap measuring RMS level and peak level in dBFS without coloring or modifying the audio path.
4. **SafetyHook**: Output protection stage constraining output to prevent hard clipping over 0 dBFS.

---

## 3. Engine Lifecycle State Machine

The `AudioEngine` enforces a strict, deterministic lifecycle:

```text
       +--------------+
       |     IDLE     | <------------------------------------+
       +--------------+                                      |
              |                                              |
       start(streamId)                                       |
              |                                              |
              v                                              |
       +--------------+                                      |
       |   STARTING   |                                      |
       +--------------+                                      |
              |                                              |
       success|       \ error                                |
              v        \                                     |
       +--------------+ \                                    |
+----> |   RUNNING    |  |                                   |
|      +--------------+  |                                   |
|             |          v                                   |
|      stop() |   +--------------+                           |
|             v   |    ERROR     | -- reset() / destroy() ---+
|      +--------------+   +--------------+
|      |   STOPPING   |          ^
|      +--------------+          |
|             |                  |
|             +------------------+ (if cleanup errors)
|             |
+-------------+
   (clean finish -> IDLE)
```

### State Definitions
- **`IDLE`**: Initial or stopped state. No active `AudioContext` or media tracks.
- **`STARTING`**: Acquiring `MediaStream`, initializing `AudioContext`, connecting graph nodes.
- **`RUNNING`**: Web Audio graph active, audio streaming to destination, meter reporting.
- **`STOPPING`**: Disconnecting nodes, stopping media tracks, closing `AudioContext`.
- **`ERROR`**: Encountered an unrecoverable track or Web Audio error; resources released.

---

## 4. Work Packages (WP) for P1

### WP0 — Engine Interfaces & Lifecycle Contract
- Define TypeScript/JSDoc interfaces for `IAudioEngine`, `IAudioSource`, `IGainProcessor`, `IEngineeringMeter`.
- Implement `AudioEngineState` enum and state-transition validator.
- Ensure invalid transitions throw clear, actionable errors.

### WP1 — AudioSource Abstraction & TabCapture Backend
- Implement `BaseAudioSource` interface: `acquire()`, `release()`, `getStream()`, `getState()`.
- Implement `TabCaptureAudioSource`:
  - Consumes `streamId`;
  - Calls `navigator.mediaDevices.getUserMedia`;
  - Immediately stops redundant video tracks;
  - Monitors `audioTrack.onended` and `audioTrack.onmute` events;
  - Dispatches source status changes to the engine.

### WP2 — GainProcessor & Deterministic Gain Transitions
- Implement `GainProcessor`:
  - Canonical control in dB;
  - Conversion formula: $\text{linear} = 10^{\text{gainDb} / 20}$;
  - Configurable minimum/maximum gain bounds (e.g. $-30\text{ dB}$ to $+15\text{ dB}$);
  - Parameter smoothing using `gain.linearRampToValueAtTime()` or `setTargetAtTime()` over 30–50 ms;
  - No audible clicks, pops, or zipper noise during transitions.

### WP3 — EngineeringMeter & Minimal SafetyHook
- Implement `EngineeringMeter`:
  - Non-intrusive `AnalyserNode` tap (2048 FFT);
  - RMS level calculation: $\text{RMS} = \sqrt{\frac{1}{N} \sum x_i^2}$;
  - Peak level calculation: $\text{Peak} = \max |x_i|$;
  - Conversion to dBFS with $-100\text{ dBFS}$ silence floor;
  - Periodic or pull-based metrics snapshot.
- Implement `SafetyHook`:
  - Minimal hard limiter / clipping guard stage to clamp runaway signals before `destination`.

### WP4 — AudioEngineManager & Multi-Engine Invariant
- Implement `AudioEngineManager` in Offscreen Document:
  - Maintains `Map<number, AudioEngine>`;
  - Enforces: Tab ID maps to at most one `AudioEngine` at any time;
  - Automatically destroys stale engine before starting a new one on the same tab ID;
  - Dispatches low-frequency metrics snapshots (`METRICS_UPDATE`) and state changes to Service Worker.

### WP5 — P1 Automated Verification Suite
- Comprehensive automated test runner using synthetic signals:
  - Known-signal tests at $0\text{ dB}$, $-6\text{ dB}$, $+6\text{ dB}$;
  - Verify measured RMS accurately matches theoretical attenuation/gain ($\pm 0.5\text{ dB}$ tolerance);
  - State machine transition tests (`IDLE` $\rightarrow$ `STARTING` $\rightarrow$ `RUNNING` $\rightarrow$ `STOPPING` $\rightarrow$ `IDLE`);
  - Error recovery and track ended simulation;
  - Multi-engine isolation test (Engine A parameter change does not leak into Engine B).

### WP6 — Validation Documentation & Gate Decision
- Produce `docs/validation/P1_AUDIO_ENGINE_REPORT.md`;
- Review all acceptance criteria;
- Formalize GO / HOLD / NO-GO recommendation for **P2 — Loudness Measurement & Automatic Normalization**.

---

## 5. P1 Acceptance Criteria (Gate Requirements)

P1 is **GO** only if:
1. `AudioEngine` completes clean lifecycle transitions without stuck states;
2. Deterministic gain is verified on known signals ($0\text{ dB}$, $-6\text{ dB}$, $+6\text{ dB}$) with high accuracy;
3. Gain changes are click-free and parameter smoothed;
4. Two independent engines run simultaneously without crosstalk or shared state;
5. Stopping an engine cleanly destroys tracks, nodes, and `AudioContext` instances;
6. Tests pass on both Google Chrome Stable and Microsoft Edge Stable;
7. Zero LUFS, AGC, or premature P2–P4 code is introduced.

---

## 6. Freeze Statement

This document freezes the implementation scope and acceptance requirements for **P1 — Stable Audio Engine**.

**Status: FROZEN IMPLEMENTATION SPEC — ready for branch creation and execution.**
