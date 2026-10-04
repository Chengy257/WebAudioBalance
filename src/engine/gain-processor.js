/**
 * WebAudioBalance - GainProcessor
 * Manages deterministic dB gain application with click-free parameter smoothing
 */

export class GainProcessor {
  constructor(audioContext, options = {}) {
    this.audioCtx = audioContext;
    this.minGainDb = options.minGainDb ?? -30;
    this.maxGainDb = options.maxGainDb ?? +15;
    this.defaultRampDurationSec = options.rampDurationSec ?? 0.04; // 40ms smooth transition

    this.currentGainDb = 0;
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
  }

  getNode() {
    return this.gainNode;
  }

  /**
   * Set gain in decibels with smoothing
   * @param {number} targetGainDb - Gain in dB
   * @param {number} [rampDurationSec] - Duration of linear ramp
   */
  setGainDb(targetGainDb, rampDurationSec = this.defaultRampDurationSec) {
    if (typeof targetGainDb !== 'number' || isNaN(targetGainDb)) {
      throw new Error(`Invalid gain value: ${targetGainDb}`);
    }

    // Clamp within bounds
    const boundedDb = Math.max(this.minGainDb, Math.min(this.maxGainDb, targetGainDb));
    const linearGain = Math.pow(10, boundedDb / 20);

    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(linearGain, now + rampDurationSec);

    this.currentGainDb = boundedDb;
    return {
      targetGainDb: boundedDb,
      linearGain
    };
  }

  getGainDb() {
    return this.currentGainDb;
  }

  getLinearGain() {
    return this.gainNode.gain.value;
  }

  disconnect() {
    try {
      this.gainNode.disconnect();
    } catch (_) {}
  }
}
