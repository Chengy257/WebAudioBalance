/**
 * WebAudioBalance - NormalizationController
 * Desired-gain normalization controller with asymmetric convergence,
 * deadband stability, silence gating, headroom/safety bounding, and relative target semantics.
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

    // Controller state variables
    this.desiredAutoGainDb = 0.0;
    this.appliedAutoGainDb = 0.0;
    this.stableTargetAutoGainDb = 0.0;
    this.requestedTotalGainDb = 0.0;
    this.appliedGainDb = 0.0;
    this.gainErrorDb = 0.0;

    this.isFrozen = false;
    this.isLimited = false;
    this.limitReason = null;

    this.lastUpdateTime = null;
  }

  get autoGainDb() {
    return this.appliedAutoGainDb;
  }

  set autoGainDb(val) {
    this.appliedAutoGainDb = Number(val) || 0.0;
    this.stableTargetAutoGainDb = this.appliedAutoGainDb;
    this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.appliedAutoGainDb + this.relativeOffsetDb));
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
    if (typeof offsetDb === 'number' && !isNaN(offsetDb)) {
      this.relativeOffsetDb = offsetDb;
      this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.appliedAutoGainDb + this.relativeOffsetDb));
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

    // 4. Compute desired auto gain (feed-forward target error)
    const rawAutoGain = this.globalTargetLufs - controlLufs;
    this.desiredAutoGainDb = Math.max(this.minAutoGainDb, Math.min(this.maxAutoGainDb, rawAutoGain));

    this.requestedTotalGainDb = this.desiredAutoGainDb + this.relativeOffsetDb;

    // 5. Headroom & Peak Safety Constraint (Section 9.2)
    const safeHeadroomGain = this.outputCeilingDbFS - this.peakMarginDb - samplePeakDbFS;
    const maxSafeGainDb = Math.min(this.maxGainDb, safeHeadroomGain);

    let constrainedTotalTargetGain = this.requestedTotalGainDb;
    this.isLimited = false;
    this.limitReason = null;

    if (this.requestedTotalGainDb > maxSafeGainDb) {
      constrainedTotalTargetGain = maxSafeGainDb;
      this.isLimited = true;
      this.limitReason = safeHeadroomGain < this.maxGainDb ? 'headroom' : 'maxGain';
    } else if (this.requestedTotalGainDb < this.minGainDb) {
      constrainedTotalTargetGain = this.minGainDb;
      this.isLimited = true;
      this.limitReason = 'minGain';
    }

    const constrainedAutoGain = constrainedTotalTargetGain - this.relativeOffsetDb;

    // 6. Deadband on target updates: prevent hunting from micro-fluctuations
    if (Math.abs(constrainedAutoGain - this.stableTargetAutoGainDb) > this.deadbandDb) {
      this.stableTargetAutoGainDb = constrainedAutoGain;
    }

    // 7. Smooth applied auto gain toward stableTargetAutoGainDb with asymmetric rates
    const diff = this.stableTargetAutoGainDb - this.appliedAutoGainDb;

    if (Math.abs(diff) > 1e-4) {
      if (diff < 0) {
        // Attenuate fast
        const maxStep = this.attackRateDbPerSec * dt;
        const step = Math.max(diff, -maxStep);
        this.appliedAutoGainDb += step;
      } else {
        // Amplify gently
        const maxStep = this.releaseRateDbPerSec * dt;
        const step = Math.min(diff, maxStep);
        this.appliedAutoGainDb += step;
      }
    } else {
      this.appliedAutoGainDb = this.stableTargetAutoGainDb;
    }

    this.appliedAutoGainDb = Math.max(this.minAutoGainDb, Math.min(this.maxAutoGainDb, this.appliedAutoGainDb));
    this.appliedGainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, this.appliedAutoGainDb + this.relativeOffsetDb));

    this.gainErrorDb = effectiveTargetLufs - (controlLufs + this.appliedGainDb);

    return this.getState();
  }

  getState(errorDb = null, isFrozen = null) {
    const effectiveTargetLufs = this.globalTargetLufs + this.relativeOffsetDb;
    const frozen = isFrozen !== null ? isFrozen : this.isFrozen;
    const computedGain = this.appliedAutoGainDb + this.relativeOffsetDb;
    const gainDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, computedGain));
    const finalError = errorDb !== null ? errorDb : this.gainErrorDb;

    return {
      // Canonical R1 fields
      globalTargetLufs: Number(this.globalTargetLufs.toFixed(1)),
      relativeOffsetDb: Number(this.relativeOffsetDb.toFixed(2)),
      effectiveTargetLufs: Number(effectiveTargetLufs.toFixed(1)),
      desiredAutoGainDb: Number(this.desiredAutoGainDb.toFixed(2)),
      appliedAutoGainDb: Number(this.appliedAutoGainDb.toFixed(2)),
      requestedTotalGainDb: Number(this.requestedTotalGainDb.toFixed(2)),
      appliedGainDb: Number(gainDb.toFixed(2)),
      gainErrorDb: Number(finalError.toFixed(2)),
      isFrozen: frozen,
      isLimited: this.isLimited,
      limitReason: this.limitReason,
      normalizationEnabled: this.normalizationEnabled,

      // Compatibility aliases for legacy consumers
      autoGainDb: Number(this.appliedAutoGainDb.toFixed(2)),
      manualOffsetDb: Number(this.relativeOffsetDb.toFixed(2)),
      effectiveGainDb: Number(gainDb.toFixed(2)),
      targetLufs: Number(this.globalTargetLufs.toFixed(1)),
      errorDb: Number(finalError.toFixed(2)),
      enabled: this.normalizationEnabled
    };
  }

  reset() {
    this.desiredAutoGainDb = 0.0;
    this.appliedAutoGainDb = 0.0;
    this.stableTargetAutoGainDb = 0.0;
    this.requestedTotalGainDb = 0.0;
    this.appliedGainDb = 0.0;
    this.gainErrorDb = 0.0;
    this.isFrozen = false;
    this.isLimited = false;
    this.limitReason = null;
    this.lastUpdateTime = null;
  }
}
