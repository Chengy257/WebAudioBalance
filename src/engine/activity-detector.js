/**
 * WebAudioBalance - ActivityDetector (Silence Gate)
 * Distinguishes meaningful audio activity from silence/pauses to prevent gain runaway
 */

export class ActivityDetector {
  constructor(options = {}) {
    this.silenceThresholdLufs = options.silenceThresholdLufs ?? -50.0;
    this.holdTimeMs = options.holdTimeMs ?? 1500; // Hold active state through natural conversational pauses

    this.isActive = false;
    this.lastActiveTime = 0;
  }

  /**
   * Process current momentary loudness
   * @param {number} momentaryLufs
   * @returns {{ isActive: boolean, isSilence: boolean }}
   */
  process(momentaryLufs) {
    const now = Date.now();

    if (momentaryLufs > this.silenceThresholdLufs) {
      this.isActive = true;
      this.lastActiveTime = now;
    } else {
      // Hold active state during brief pauses (e.g. between spoken syllables)
      if (now - this.lastActiveTime > this.holdTimeMs) {
        this.isActive = false;
      }
    }

    return {
      isActive: this.isActive,
      isSilence: !this.isActive
    };
  }

  reset() {
    this.isActive = false;
    this.lastActiveTime = 0;
  }
}
