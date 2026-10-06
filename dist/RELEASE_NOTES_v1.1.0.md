# WebAudioBalance v1.1.0 — Production Release

> **Release Decision: GO — FINAL FREEZE**  
> **Post-v1 Functional Rebaseline: COMPLETE**  
> **Audited Release Commit: `8d4f9d1cc0bbff004078f18090436d74688b34ca`**  
> **Governing Documents: [`FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md`](docs/planning/FINAL_CLOSEOUT_AND_V1_1_0_RELEASE_PLAN.md) & [`FINAL_RELEASE_CORRECTION_PLAN.md`](docs/planning/FINAL_RELEASE_CORRECTION_PLAN.md)**  
> **Authoritative Evidence: [`FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md`](docs/validation/FINAL_CLOSEOUT_V1_1_0_RELEASE_REPORT.md)**

WebAudioBalance v1.1.0 is the official, production-ready release delivering intelligent cross-tab perceptual loudness normalization (ITU-R BS.1770 LUFS) and independent per-tab audio balance for Google Chrome and Microsoft Edge.

---

### Highlights & Architectural Achievements

- **Absolute Loudness Normalization Core**: Each user-enabled tab converges independently toward a shared target (default: -18.0 LUFS) using ITU-R BS.1770 K-weighted filtering and momentary/short-term gating without cross-tab AGC interference.
- **Simultaneous Multi-Tab Processing (CLASS A)**: Parallel `tabCapture` stream acquisition and concurrent independent `AudioEngine` instances are empirically validated on both Google Chrome and Microsoft Edge. Multiple tabs can be balanced and normalized concurrently with strict controller and lifecycle isolation.
- **Production-Path Full-Stack E2E**: Fully validated across 17 production lifecycle scenarios in both Google Chrome (v154) and Microsoft Edge (v154) via real CDP interactions without synthetic test hooks.
- **Durable State Trinity & Reconnection**: Service Worker and Offscreen Document maintain strictly separated `managed`, `captured`, and `active` states with automatic reconciliation across Service Worker sleep/restart cycles.
- **Architectural Fixture Matrix**: Categories 1–10 evaluated under live capture (HTML5, MSE VOD, Segmented DASH, Live Streams, Music, Speech Pauses, Web Audio graphs, and Subframes) with transparent classification of native DRM CDM constraints.
- **Audio-Runtime Soak Stability**: Bounded soak tests proved monotonic telemetry sequences, continuous AudioContext health, $< 0.05\text{ dB}$ stationary gain stability, and 0 engine leaks upon tab release.
- **Perceptual Acoustic Tuning**: Evaluated across 8 transition scenarios (rapid loud/quiet transitions, speech pauses, startup safety clamp, ±6 dB relative adjustments, and soft-knee safety limiting).
- **Hardened Release Artifact**: The packaged extension ZIP contains strictly required runtime assets and loads cleanly into both Chrome and Edge.

---

### Master Release Gates (G1–G15) + Correction Gates (RC-G1–RC-G9)

| Gate | Category | Scope | Result | Status |
|:---:|---|---|:---:|:---:|
| **G1** | Audio Core | R1 DSP, Metering & Safety Hook | 23 / 23 PASS | **PASS** |
| **G2** | Runtime State | R2 State Trinity, Reconciliation, NACK | 84 / 84 PASS | **PASS** |
| **G3** | UX & Presenter | R3 Presets, Dwell Time, URL Classification | 28 / 28 PASS | **PASS** |
| **G4** | Full-Stack E2E | FC-1 Production E2E on Google Chrome | 17 / 17 Scenarios | **PASS** |
| **G5** | Full-Stack E2E | FC-1 Production E2E on Microsoft Edge | 17 / 17 Scenarios | **PASS** |
| **G6** | Fixture Matrix | FC-2 Categories 1–10 on Chrome & Edge | 18 PASS / 2 Constraints | **PASS** |
| **G7** | Real Sources | FC-2 YouTube, Bilibili, Twitch, Spotify | Classified Honestly | **PASS** |
| **G8** | Stability / Soak | FC-3 Soak on Google Chrome | 0 Leaks, 0 Errors | **PASS** |
| **G9** | Stability / Soak | FC-3 Soak on Microsoft Edge | 0 Leaks, 0 Errors | **PASS** |
| **G10** | Perceptual | FC-3 Listening Tests (8 Scenarios) | 0 FAIL | **PASS** |
| **G11** | Artifact Load | FC-4 Packaged ZIP Load on Google Chrome | Clean Load / SW Active | **PASS** |
| **G12** | Artifact Load | FC-4 Packaged ZIP Load on Microsoft Edge | Clean Load / SW Active | **PASS** |
| **G13** | Hygiene | FC-4 Version & Metadata Consistency (1.1.0) | Aligned | **PASS** |
| **G14** | CI Workflow | FC-4 GitHub Actions CI Workflow | Active & Configured | **PASS** |
| **G15** | Release Audit | FC-5 Independent Final Release Audit | 0 Deficiencies | **GO** |
| **RC-G1..5** | Multi-Tab | Chrome & Edge Simultaneous Multi-Tab | CLASS A (Verified) | **PASS** |
| **RC-G6..9** | Correction | Traceability & Final Audit Refresh | Full Lineage to `8d4f9d1` | **GO** |

---

### Installation & Getting Started

1. Download `webaudiobalance-v1.1.0.zip` attached below and extract it;
2. Navigate to `chrome://extensions/` or `edge://extensions/`;
3. Enable **Developer mode**;
4. Click **Load unpacked** and select the extracted folder;
5. Open any audio tab, click the extension icon, and select **Balance**!

---

### Release Artifact Integrity (SHA-256)

```text
40f485dcd5c4ce611c94d6f66b56815bb20333609acd1957271cd161ef085da8  webaudiobalance-v1.1.0.crx
eef62cf8a235c7bce5cb7f7e2d691753261e19027e718e1de4e6544118e1d833  webaudiobalance-v1.1.0.zip
```
