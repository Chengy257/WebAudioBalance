# P4 — Product UI & User Interaction Implementation Specification

> Status: **FROZEN IMPLEMENTATION SPEC**  
> Parent baseline: `docs/PROJECT_MAINLINE_PLAN.md` (Sections 10 & 16)  
> Foundation: `docs/validation/P3_MULTI_TAB_ORCHESTRATION_REPORT.md` (P3 Multi-tab Orchestration)  
> Purpose: provide an authoritative, bounded implementation specification to create the consumer-grade desktop extension UI and user interaction model.

---

## 1. Authority and Scope

This document specifies the engineering implementation of **P4 — Product UI & User Interaction**.

P4 transforms the engineering debug test surface from P0–P3 into an intuitive, accessible, and elegant consumer product interface centered around the non-technical user workflow:

$$\text{\bf Discover} \longrightarrow \text{\bf Enable} \longrightarrow \text{\bf Balance} \longrightarrow \text{\bf Adjust}$$

### 1.1 In-Scope Responsibilities

P4 owns:
1. **Primary Popup UI Surface**:
   - Modern, responsive, clean desktop extension popup (380–420px width);
   - Global Auto-Balance master switch;
   - Semantic Listening Level selector (Quiet / Normal / Loud);
   - Managed Tabs card deck (status badge, per-tab volume slider, auto-balance toggle, release button);
   - Detected / Audible Tabs discovery list with 1-click "Balance" invocation;
   - Unsupported page graceful degradation (showing helpful explanations for `chrome://`, `edge://`, `file:///`);
2. **User-Facing Presentation State Model**:
   - Human-readable statuses: `Detected`, `Balancing`, `Balanced`, `Manual Only`, `Paused`, `Unavailable`, `Error`;
   - Technical DSP metrics (LUFS, RMS, FFT) sequestered into an optional collapsible "Diagnostics / Advanced" drawer;
3. **Semantic Listening Level Mapping**:
   - **Quiet**: $-24.0\text{ LUFS}$ (late-night listening, low-dynamic media);
   - **Normal**: $-18.0\text{ LUFS}$ (standard desktop streaming target, default);
   - **Loud**: $-14.0\text{ LUFS}$ (dialogue-heavy podcasts, noisy environments);
4. **Per-Tab Controls**:
   - Smooth manual volume offset slider ($-12\text{ dB}$ to $+12\text{ dB}$, with $0\text{ dB}$ center notch / double-click reset);
   - Independent per-tab normalization toggle;
   - Instant "Release / Disconnect" button;
5. **Accessibility (WCAG 2.1 AA compliant)**:
   - Full keyboard navigation (`Tab`, `Shift+Tab`, `Arrow keys`, `Space`, `Enter`);
   - ARIA labels (`aria-label`, `aria-checked`, `role="slider"`, `role="switch"`);
   - Contrast ratio $\ge 4.5:1$;
   - Layout resilience under browser zoom (up to 200%);
6. **Popup Lifecycle Resilience**:
   - Transient popup lifetime strictly decoupled from persistent background audio engines.

### 1.2 Explicit Non-Goals for P4

P4 MUST NOT implement:
- Side Panel UI (deferred per Mainline);
- Multiband EQ, compressor curve graphs, or AI enhancement;
- Cloud account sync or user profiles;
- Site-specific rule engines.

---

## 2. Product UI Information Architecture

```text
+-------------------------------------------------------------+
|  [🔊 WebAudioBalance]                 [Settings/Diagnostics] |
+-------------------------------------------------------------+
|  MASTER CONTROL                                             |
|  [===] Global Auto Balance                   (ON / OFF)     |
|                                                             |
|  Target Listening Level:                                    |
|  [ Quiet (-24) ]   [ Normal (-18) * ]   [ Loud (-14) ]      |
+-------------------------------------------------------------+
|  MANAGED TABS (Active Audio Balancing)                      |
|  +-------------------------------------------------------+  |
|  | [Favicon] YouTube - Lofi Hip Hop Stream   [BALANCED]  |  |
|  | Auto Balance: [ON]   Volume: [----O----] +2.0 dB      |  |
|  | [Release / Stop]                                      |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
|  DETECTED AUDIBLE TABS                                      |
|  +-------------------------------------------------------+  |
|  | [Favicon] Bilibili - Gaming Live Stream               |  |
|  | [ Balance this Tab ]                                  |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
|  [v] Advanced Diagnostics & Engineering Metrics             |
+-------------------------------------------------------------+
```

---

## 3. Work Packages for P4

- **WP0**: UX semantic tokens, state presenter, and Listening Level mapping in `src/popup/state-presenter.js`.
- **WP1**: Product Popup HTML markup & semantic structure in `src/popup/popup.html`.
- **WP2**: Product Popup modern CSS design, accessible theme, and responsive styling in `src/popup/popup.css`.
- **WP3**: Product Popup Controller logic, keyboard accessibility, and real-time state sync in `src/popup/popup.js`.
- **WP4**: Unsupported page & error handling (graceful alerts and action tips).
- **WP5**: Automated UI State and Presenter Test Suite in `test/test-p4-ui.mjs`.
- **WP6**: P4 Validation Report & Gate Decision in `docs/validation/P4_PRODUCT_UI_REPORT.md`.

---

## 4. Acceptance Criteria

P4 is **GO** only if:
1. Popup exposes the complete consumer flow: Discover $\rightarrow$ Enable $\rightarrow$ Balance $\rightarrow$ Adjust;
2. Semantic levels (Quiet/Normal/Loud) cleanly map to global target LUFS;
3. Manual offset slider ($-12$ to $+12\text{ dB}$) operates smoothly without interrupting playback;
4. Disabling per-tab auto-balance preserves manual offset;
5. Popup closing and reopening immediately re-syncs state without glitches or audio dropouts;
6. Unsupported tabs (`chrome://`, etc.) clearly communicate why they cannot be captured;
7. Full keyboard navigation and ARIA attributes pass accessibility audit.
