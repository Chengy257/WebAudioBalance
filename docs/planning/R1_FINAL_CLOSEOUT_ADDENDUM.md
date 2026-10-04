# R1 Final Closeout Addendum — Pre-Measurement Positive-Gain Guard

> Status: **FROZEN FINAL ADDENDUM**  
> Frozen Date: **2026-10-04**  
> Parent: `docs/planning/R1_CLOSEOUT_CORRECTION_IMPLEMENTATION_SPEC.md`  
> Trigger: independent review of closeout implementation commit `d56c8a9d0aeccd375186c812a8c12ecf6775d2ff`  
> Scope: one residual startup/reacquisition safety condition only.

---

## 1. Residual finding

The R1 closeout correction successfully implements immediate hard headroom clamping once a valid peak measurement exists.

One residual case remains:

- controller initialization sets `lastSafeMaxGainDb` to the configured maximum;
- a positive Relative Level may therefore be accepted before any valid peak measurement has ever been observed;
- during the initial Momentary warm-up, `NormalizationController.update()` freezes and returns the existing applied gain;
- `AudioEngine.processControlCycle()` can then apply that positive gain before the first valid peak window.

This conflicts with the already frozen R1 correction rule:

> If no valid peak measurement exists, do not perform a positive immediate jump; wait for the next valid control cycle.

No other R1 design is reopened.

---

## 2. Required correction

The controller must track whether a usable safety peak envelope has been established for the current measurement epoch.

A minimal implementation is acceptable, e.g.:

```text
hasValidSafetyPeak = false
lastSafeMaxGainDb = 0 dB or another non-positive startup envelope
```

When a valid Momentary/peak measurement is processed:

```text
hasValidSafetyPeak = true
lastSafeMaxGainDb = computed safe maximum
```

On full reset and on a control epoch that intentionally invalidates prior safety evidence:

```text
hasValidSafetyPeak = false
```

### Positive Relative Level before safety evidence

If:

```text
requested relative offset > current relative offset
AND hasValidSafetyPeak == false
```

then:

- record the requested relative offset as user intent if desired;
- do not increase the actually applied gain;
- keep actual gain at or below the current non-positive safe startup value;
- expose a temporary warm-up/pending state if needed internally;
- after valid safety measurement exists, normal controller logic may begin moving toward the requested target under headroom and release-rate constraints.

Negative gain changes remain immediately safe and may apply.

---

## 3. Required tests

Add both:

### Unit regression

1. new controller / no valid measurement;
2. request positive relative offset;
3. assert actual applied gain does not rise above 0 dB;
4. feed valid safe peak measurement;
5. assert positive gain becomes eligible only through normal controlled adaptation.

### Real browser regression

1. start AudioEngine;
2. request positive Relative Level immediately before first valid Momentary measurement;
3. inspect the first control cycles;
4. assert GainProcessor does not apply positive boost before valid safety evidence;
5. once measurement is valid, verify normal convergence.

---

## 4. Final R1 gate

After this regression passes, the existing corrected R1 evidence plus this addendum are sufficient to accept:

```text
R1 — GO / COMPLETE / FROZEN
```

No further R1 planning document should be created unless a new material audio-core defect is discovered.
