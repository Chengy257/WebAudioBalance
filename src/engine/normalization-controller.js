/**
 * WebAudioBalance - NormalizationController
 * Desired-gain normalization controller with asymmetric convergence,
 * deadband stability, silence gating, hard headroom/safety bounding, and relative target semantics.
 */

export class NormalizationController {
  constructor(options = {}) {
    this.globalTargetLufs = options.globalTargetLufs ?? options.targetLufs ?? -18.0;
    this.relativeOffsetDb = options.relativeOffsetDb ?? options.manualOffsetDb ?? 0.0;
    this.deadbandDb = options.deadbandDb ?? 0.5;

    // Configured gain range
    this.minAutoGainDb = options.minAutoGainDb ?? -18.0;
    this.maxAutoGainDb = options.maxAutoGainDb ?? +12.0;
    this.minGainDb = options.minGainDb ?? -30.0;
    this.maxGainDb = options.maxGainDb ?? +15.0;

    // Safety and headroom parameters
    this.outputCeilingDbFS = options.outputCeilingDbFS ?? -1.0;
    this.peakMarginDb = options.peakMarginDb ?? 1.0;

    // Asymmetric adaptation rates (dB per second)
    this.attackRateDbPerSec = options.attackRateDbPerSec ?? 8.0;  // Fast attenuation on loud passages
    this.releaseRateDbPerSec = options.releaseRateDbPerSec ?? 1.5; // Gentle amplification on quiet passages

    this.normalizationEnabled = options.enabled ?? options.normalizationEnabled ?? true;

    // Safety envelope tracking (R1 Final Closeout Addendum)
    this.hasValidSafetyPeak = false;
    this.lastSafeMaxGainDb = 0.0;

    // Controller state variables
    this.candidateAutoGainDb = 0.0;
    this.desiredAutoGainDb = 0.0;
    this.appliedAutoGainDb = 0.0;
    this.stableTargetAutoGainDb = 0.0;
    this.requestedTotalGainDb = this.relativeOffsetDb;
    this.gainErrorDb = 0.0;

    if (this.relativeOffsetDb > 0.0) {
      this.appliedGainDb = 0.0;
      this.appliedAutoGainDb = -this.relativeOffsetDb;
      this.candidateAutoGainDb = this.appliedAutoGainDb;
      this.isLimited = true;
      this.limitReason = 'warmup';
    } else {
      this.appliedGainDb = this.relativeOffsetDb;
      this.appliedAutoGainDb = 0.0;
      this.candidateAutoGainDb = 0.0;
    }

    this.isFrozen = false;
    this.isLimited = this.relativeOffsetDb > 0.0;
    this.limitReason = this.relativeOffsetDb > 0.0 ? 'warmup' : null;

    this.lastUpdateTime = null;
  }

  get autoGainDb() {
    return this.appliedAutoGainDb;
  }

  set autoGainDb(val) {
    const num = Number(val) || 0.0;
    this.appliedAutoGainDb = num;
    this.candidateAutoGainDb = num;
    this.stableTargetAutoGainDb = num;
    this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, num + this.relativeOffsetDb));
    this.hasValidSafetyPeak = true;
    this.lastSafeMaxGainDb = this.maxGainDb;
  }

  get manualOffsetDb() {
    return this.relativeOffsetDb;
  }

  set manualOffsetDb(val) {
    this.setManualOffsetDb(val);
  }

  setTargetLufs(targetLufs) {
    if (typeof targetLufs === 'number' && !isNaN(targetLufs)) {
      this.globalTargetLufs = Math.max(-36.0, Math.min(-6.0, targetLufs));
    }
  }

  setGlobalTargetLufs(targetLufs) {
    this.setTargetLufs(targetLufs);
  }

  setManualOffsetDb(offsetDb) {
    if (typeof offsetDb !== 'number' || isNaN(offsetDb)) return;

    if (offsetDb <= this.relativeOffsetDb) {
      // Negative or equal change reduces or maintains gain -> safe immediately
      this.relativeOffsetDb = offsetDb;
      this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.appliedAutoGainDb + this.relativeOffsetDb));
      this.requestedTotalGainDb = this.candidateAutoGainDb + this.relativeOffsetDb;
    } else {
      // Positive offset change: MUST NOT bypass latest safety envelope
      this.relativeOffsetDb = offsetDb;
      const requestedTotal = this.appliedAutoGainDb + offsetDb;
      this.requestedTotalGainDb = requestedTotal;

      if (!this.hasValidSafetyPeak) {
        // No valid peak measurement established yet for current epoch:
        // Record user intent but do not increase applied gain above safe startup envelope (<= 0 dB)
        const safeStartupMax = Math.min(0.0, this.lastSafeMaxGainDb);
        this.appliedGainDb = Math.min(this.appliedGainDb, safeStartupMax);
        this.appliedAutoGainDb = this.appliedGainDb - this.relativeOffsetDb;
        this.candidateAutoGainDb = this.appliedAutoGainDb;
        this.isLimited = true;
        this.limitReason = 'warmup';
        return;
      }

      const maxAllowed = Math.min(this.maxGainDb, this.lastSafeMaxGainDb ?? this.maxGainDb);

      if (requestedTotal > maxAllowed) {
        this.appliedGainDb = maxAllowed;
        this.appliedAutoGainDb = this.appliedGainDb - this.relativeOffsetDb;
        this.candidateAutoGainDb = this.appliedAutoGainDb;
        this.isLimited = true;
        this.limitReason = (this.lastSafeMaxGainDb ?? this.maxGainDb) < this.maxGainDb ? 'headroom' : 'maxGain';
      } else {
        this.appliedGainDb = Math.max(this.minGainDb, requestedTotal);
      }
    }
  }

  setRelativeOffsetDb(offsetDb) {
    this.setManualOffsetDb(offsetDb);
  }

  setEnabled(enabled) {
    this.normalizationEnabled = Boolean(enabled);
    if (!this.normalizationEnabled) {
      this.desiredAutoGainDb = 0.0;
      this.appliedAutoGainDb = 0.0;
      this.candidateAutoGainDb = 0.0;
      this.stableTargetAutoGainDb = 0.0;
      this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.relativeOffsetDb));
      this.isLimited = false;
      this.limitReason = null;
    }
  }

  /**
   * Update controller decision based on continuous loudness metrics and activity
   * @param {object|number} metricsInput - Measurement payload or numeric LUFS
   * @param {boolean} isActive - Activity detector status
   * @param {number} [deltaTimeSec=null] - Delta time in seconds
   */
  update(metricsInput, isActive, deltaTimeSec = null) {
    const now = Date.now();
    const dt = deltaTimeSec ?? (this.lastUpdateTime ? Math.max(0.01, Math.min(1.0, (now - this.lastUpdateTime) / 1000)) : 0.1);
    this.lastUpdateTime = now;

    // Extract metrics whether passed as object or legacy number
    let momentaryLufs = -100.0;
    let shortTermLufs = -100.0;
    let momentaryValid = true;
    let shortTermValid = true;
    let samplePeakDbFS = -100.0;

    if (typeof metricsInput === 'number') {
      momentaryLufs = metricsInput;
      shortTermLufs = metricsInput;
      // Synthesized peak from nominal crest factor for unit tests
      samplePeakDbFS = metricsInput > -90 ? metricsInput + 3.0 : -100.0;
    } else if (metricsInput && typeof metricsInput === 'object') {
      momentaryLufs = metricsInput.momentaryLufs ?? -100.0;
      shortTermLufs = metricsInput.shortTermLufs ?? -100.0;
      momentaryValid = metricsInput.momentaryValid ?? true;
      shortTermValid = metricsInput.shortTermValid ?? true;
      samplePeakDbFS = metricsInput.samplePeakDbFS ?? metricsInput.peakDbFS ?? -100.0;
    }

    const effectiveTargetLufs = this.globalTargetLufs + this.relativeOffsetDb;

    // 1. If normalization is disabled, apply purely manual offset from unity
    if (!this.normalizationEnabled) {
      this.desiredAutoGainDb = 0.0;
      this.appliedAutoGainDb = 0.0;
      this.candidateAutoGainDb = 0.0;
      this.stableTargetAutoGainDb = 0.0;
      this.requestedTotalGainDb = this.relativeOffsetDb;
      this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.relativeOffsetDb));
      this.gainErrorDb = 0.0;
      this.isFrozen = false;
      this.isLimited = false;
      this.limitReason = null;
      return this.getState();
    }

    // 2. Inactive / Silence Gating: freeze gain adaptation to prevent runaway during silence
    if (!isActive || momentaryLufs <= -70.0) {
      this.isFrozen = true;
      this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.appliedAutoGainDb + this.relativeOffsetDb));
      return this.getState();
    }

    this.isFrozen = false;

    // 3. Warm-up and control input selection
    let controlLufs = shortTermLufs;
    if (!momentaryValid) {
      // Incomplete momentary window (< 400ms): keep gain frozen, do not boost
      this.isFrozen = true;
      this.limitReason = 'warmup';
      return this.getState();
    }

    if (!shortTermValid) {
      // Momentary is valid, but Short-Term (< 3s) is still warming up
      if (momentaryLufs > this.globalTargetLufs) {
        // Fast protective attenuation for loud signals during warm-up
        controlLufs = momentaryLufs;
      } else {
        // Conservative: do not apply positive boost until Short-Term stabilizes
        controlLufs = this.globalTargetLufs;
      }
    } else {
      // Steady state: use Short-Term, with Momentary override for large loud transients
      if (momentaryLufs > shortTermLufs + 3.0 && momentaryLufs > this.globalTargetLufs) {
        controlLufs = momentaryLufs - 1.0;
      } else {
        controlLufs = shortTermLufs;
      }
    }

    // 4. Compute normal feed-forward target auto gain
    const rawAutoGain = this.globalTargetLufs - controlLufs;
    this.desiredAutoGainDb = Math.max(this.minAutoGainDb, Math.min(this.maxAutoGainDb, rawAutoGain));
    this.requestedTotalGainDb = this.desiredAutoGainDb + this.relativeOffsetDb;

    // 5. Compute Hard Safe Maximum Gain (Headroom Envelope)
    const safeHeadroomGain = this.outputCeilingDbFS - this.peakMarginDb - samplePeakDbFS;
    const maxSafeGainDb = Math.min(this.maxGainDb, safeHeadroomGain);
    this.lastSafeMaxGainDb = safeHeadroomGain;
    this.hasValidSafetyPeak = true;

    // 6. Deadband on normal target updates: prevent hunting from micro-fluctuations
    if (Math.abs(this.desiredAutoGainDb - this.stableTargetAutoGainDb) > this.deadbandDb) {
      this.stableTargetAutoGainDb = this.desiredAutoGainDb;
    }

    // 7. Smooth candidate auto gain toward stableTargetAutoGainDb with asymmetric rates
    const diff = this.stableTargetAutoGainDb - this.candidateAutoGainDb;

    if (Math.abs(diff) > 1e-4) {
      if (diff < 0) {
        // Attenuate fast
        const maxStep = this.attackRateDbPerSec * dt;
        const step = Math.max(diff, -maxStep);
        this.candidateAutoGainDb += step;
      } else {
        // Amplify gently
        const maxStep = this.releaseRateDbPerSec * dt;
        const step = Math.min(diff, maxStep);
        this.candidateAutoGainDb += step;
      }
    } else {
      this.candidateAutoGainDb = this.stableTargetAutoGainDb;
    }

    this.candidateAutoGainDb = Math.max(this.minAutoGainDb, Math.min(this.maxAutoGainDb, this.candidateAutoGainDb));

    // 8. HARD ENVELOPE ENFORCEMENT:
    // Total candidate gain before safety clamp
    const candidateTotalGainDb = this.candidateAutoGainDb + this.relativeOffsetDb;

    if (candidateTotalGainDb > maxSafeGainDb) {
      // Hard headroom / maxGain clamp: immediately applied!
      this.appliedGainDb = maxSafeGainDb;
      this.appliedAutoGainDb = this.appliedGainDb - this.relativeOffsetDb;
      // Sync candidate state so later relaxation grows only via normal slow release rate
      this.candidateAutoGainDb = this.appliedAutoGainDb;
      this.isLimited = true;
      this.limitReason = safeHeadroomGain < this.maxGainDb ? 'headroom' : 'maxGain';
    } else if (candidateTotalGainDb < this.minGainDb) {
      this.appliedGainDb = this.minGainDb;
      this.appliedAutoGainDb = this.appliedGainDb - this.relativeOffsetDb;
      this.candidateAutoGainDb = this.appliedAutoGainDb;
      this.isLimited = true;
      this.limitReason = 'minGain';
    } else {
      this.appliedGainDb = candidateTotalGainDb;
      this.appliedAutoGainDb = this.candidateAutoGainDb;
      this.isLimited = false;
      this.limitReason = null;
    }

    this.gainErrorDb = effectiveTargetLufs - (controlLufs + this.appliedGainDb);

    return this.getState();
  }

  getState(errorDb = null, isFrozen = null) {
    const effectiveTargetLufs = this.globalTargetLufs + this.relativeOffsetDb;
    const frozen = isFrozen !== null ? isFrozen : this.isFrozen;
    const finalError = errorDb !== null ? errorDb : this.gainErrorDb;

    return {
      // Canonical R1 fields
      globalTargetLufs: Number(this.globalTargetLufs.toFixed(1)),
      relativeOffsetDb: Number(this.relativeOffsetDb.toFixed(2)),
      effectiveTargetLufs: Number(effectiveTargetLufs.toFixed(1)),
      desiredAutoGainDb: Number(this.desiredAutoGainDb.toFixed(2)),
      appliedAutoGainDb: Number(this.appliedAutoGainDb.toFixed(2)),
      requestedTotalGainDb: Number(this.requestedTotalGainDb.toFixed(2)),
      appliedGainDb: Number(this.appliedGainDb.toFixed(2)),
      gainErrorDb: Number(finalError.toFixed(2)),
      isFrozen: frozen,
      isLimited: this.isLimited,
      limitReason: this.limitReason,
      hasValidSafetyPeak: this.hasValidSafetyPeak,
      normalizationEnabled: this.normalizationEnabled,

      // Compatibility aliases for legacy consumers
      autoGainDb: Number(this.appliedAutoGainDb.toFixed(2)),
      manualOffsetDb: Number(this.relativeOffsetDb.toFixed(2)),
      effectiveGainDb: Number(this.appliedGainDb.toFixed(2)),
      targetLufs: Number(this.globalTargetLufs.toFixed(1)),
      errorDb: Number(finalError.toFixed(2)),
      enabled: this.normalizationEnabled
    };
  }

  resetEpoch() {
    this.hasValidSafetyPeak = false;
    this.lastSafeMaxGainDb = 0.0;
  }

  reset() {
    this.candidateAutoGainDb = 0.0;
    this.desiredAutoGainDb = 0.0;
    this.appliedAutoGainDb = 0.0;
    this.stableTargetAutoGainDb = 0.0;
    this.requestedTotalGainDb = 0.0;
    this.appliedGainDb = 0.0;
    this.gainErrorDb = 0.0;
    this.hasValidSafetyPeak = false;
    this.lastSafeMaxGainDb = 0.0;
    this.isFrozen = false;
    this.isLimited = false;
    this.limitReason = null;
    this.lastUpdateTime = null;
  }
}
