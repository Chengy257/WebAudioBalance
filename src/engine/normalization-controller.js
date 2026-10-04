/**
 * WebAudioBalance - NormalizationController
 * Asymmetric, deadband-equipped perceptual loudness normalization controller
 */

export class NormalizationController {
  constructor(options = {}) {
    this.targetLufs = options.targetLufs ?? -18.0;
    this.deadbandDb = options.deadbandDb ?? 1.0;
    this.minAutoGainDb = options.minAutoGainDb ?? -18.0;
    this.maxAutoGainDb = options.maxAutoGainDb ?? +12.0;

    // Asymmetric adaptation rates (dB per second)
    this.attackRateDbPerSec = options.attackRateDbPerSec ?? 8.0;  // Fast attenuation on loud passages
    this.releaseRateDbPerSec = options.releaseRateDbPerSec ?? 1.5; // Gentle gradual gain boost on quiet passages

    this.autoGainDb = 0.0;
    this.manualOffsetDb = 0.0;
    this.enabled = options.enabled ?? true;

    this.lastUpdateTime = null;
  }

  setTargetLufs(targetLufs) {
    if (typeof targetLufs === 'number' && !isNaN(targetLufs)) {
      this.targetLufs = Math.max(-36, Math.min(-6, targetLufs));
    }
  }

  setManualOffsetDb(offsetDb) {
    if (typeof offsetDb === 'number' && !isNaN(offsetDb)) {
      this.manualOffsetDb = offsetDb;
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.autoGainDb = 0.0;
    }
  }

  /**
   * Update controller decision based on current loudness and activity
   * @param {number} inputLufs - Current Short-Term or Momentary LUFS
   * @param {boolean} isActive - Activity flag from ActivityDetector
   * @param {number} [deltaTimeSec] - Time elapsed since last update (or computed automatically)
   */
  update(inputLufs, isActive, deltaTimeSec = null) {
    const now = Date.now();
    const dt = deltaTimeSec ?? (this.lastUpdateTime ? Math.max(0.01, Math.min(1.0, (now - this.lastUpdateTime) / 1000)) : 0.1);
    this.lastUpdateTime = now;

    if (!this.enabled) {
      this.autoGainDb = 0.0;
      return this.getState(0, false);
    }

    // 1. If signal is inactive/silence, freeze gain adjustment
    if (!isActive || inputLufs <= -70) {
      return this.getState(0, true);
    }

    // 2. Compute error: target - actual
    const rawError = this.targetLufs - inputLufs;

    // 3. Deadband / Hysteresis: small errors require no adaptation
    let effectiveError = rawError;
    if (Math.abs(rawError) <= this.deadbandDb) {
      effectiveError = 0;
    }

    // 4. Asymmetric adaptation step
    if (effectiveError < 0) {
      // Input is too loud -> attenuate fast
      const maxStep = this.attackRateDbPerSec * dt;
      const step = Math.max(effectiveError, -maxStep);
      this.autoGainDb += step;
    } else if (effectiveError > 0) {
      // Input is too quiet -> amplify gently
      const maxStep = this.releaseRateDbPerSec * dt;
      const step = Math.min(effectiveError, maxStep);
      this.autoGainDb += step;
    }

    // 5. Clamp to configured bounds
    this.autoGainDb = Math.max(this.minAutoGainDb, Math.min(this.maxAutoGainDb, this.autoGainDb));

    return this.getState(rawError, false);
  }

  getState(errorDb = 0, isFrozen = false) {
    const effectiveGainDb = this.autoGainDb + this.manualOffsetDb;
    return {
      autoGainDb: Number(this.autoGainDb.toFixed(2)),
      manualOffsetDb: Number(this.manualOffsetDb.toFixed(2)),
      effectiveGainDb: Number(effectiveGainDb.toFixed(2)),
      targetLufs: this.targetLufs,
      errorDb: Number(errorDb.toFixed(2)),
      isFrozen,
      enabled: this.enabled
    };
  }

  reset() {
    this.autoGainDb = 0.0;
    this.lastUpdateTime = null;
  }
}
