/**
 * WebAudioBalance - StatePresenter (Popup Presentation Layer)
 * Translates low-level DSP metrics and logical states into friendly consumer concepts
 * Compliant with R3 Product UX & Real-World Validation Implementation Specification (Section 7)
 */

export const BALANCED_DWELL_MS = 1500;
export const BALANCED_TOLERANCE_LU = 1.0;

export const ListeningLevels = Object.freeze([
  { id: 'quiet', label: 'Quiet', targetLufs: -24.0, description: 'Soft & relaxed (-24 LUFS)' },
  { id: 'normal', label: 'Normal', targetLufs: -18.0, description: 'Standard balanced (-18 LUFS)' },
  { id: 'loud', label: 'Loud', targetLufs: -14.0, description: 'Clarity & dialogue (-14 LUFS)' }
]);

export function getListeningLevelByTarget(targetLufs) {
  if (targetLufs <= -21.0) return ListeningLevels[0]; // Quiet
  if (targetLufs >= -16.0) return ListeningLevels[2]; // Loud
  return ListeningLevels[1]; // Normal
}

/**
 * In-memory dwell tracker for continuous balanced state confirmation
 */
const balancedDwellTimestamps = new Map(); // tabId -> timestamp

export function resetDwellTracker(tabId = null) {
  if (tabId !== null && tabId !== undefined) {
    balancedDwellTimestamps.delete(Number(tabId));
  } else {
    balancedDwellTimestamps.clear();
  }
}

/**
 * Determine user-facing presentation status according to Section 7 precedence:
 * 1. Error
 * 2. Connecting
 * 3. Paused
 * 4. Limited
 * 5. Manual
 * 6. Balanced (requires processed output, valid short-term, error <= 1.0 LU, dwell >= 1500ms)
 * 7. Balancing
 *
 * @param {object} tabState - ManagedTabState from registry or snapshot
 * @param {number} currentTime - current timestamp for dwell testing
 * @returns {{ status: string, badgeText: string, badgeClass: string, tooltip: string, limitReason?: string, error?: any }}
 */
export function presentTabStatus(tabState, currentTime = Date.now()) {
  if (!tabState) {
    return {
      status: 'unknown',
      badgeText: 'Unknown',
      badgeClass: 'badge-muted',
      tooltip: 'Status unavailable'
    };
  }

  const tabId = Number(tabState.tabId);
  const runtime = tabState.runtime || {};
  const intent = tabState.intent || {};
  const audio = tabState.audio || {};

  const isManaged = intent.managed !== undefined ? Boolean(intent.managed) : Boolean(tabState.managed);
  const isCaptured = runtime.captured !== undefined ? Boolean(runtime.captured) : Boolean(tabState.captured);
  const isActive = runtime.active !== undefined ? Boolean(runtime.active) : Boolean(tabState.active);
  const isLimited = runtime.limited !== undefined ? Boolean(runtime.limited) : Boolean(tabState.isLimited);
  const limitReason = runtime.limitReason || tabState.limitReason || 'none';
  const isNormEnabled = intent.normalizationEnabled !== undefined ? Boolean(intent.normalizationEnabled) : (tabState.normalizationEnabled ?? true);
  const runtimeError = runtime.lastRuntimeError || tabState.lastRuntimeError || tabState.error || null;

  // 1. Error State (Section 7.2)
  if (runtimeError) {
    balancedDwellTimestamps.delete(tabId);
    const errMsg = runtimeError.message || (typeof runtimeError === 'string' ? runtimeError : 'Audio engine error');
    return {
      status: 'error',
      badgeText: 'Error',
      badgeClass: 'badge-danger',
      tooltip: errMsg,
      error: runtimeError
    };
  }

  // Detected / Not managed
  if (!isManaged) {
    balancedDwellTimestamps.delete(tabId);
    return {
      status: 'detected',
      badgeText: 'Detected',
      badgeClass: 'badge-info',
      tooltip: 'Audible tab ready to balance'
    };
  }

  // 2. Connecting State (Section 7.3)
  if (isManaged && !isCaptured) {
    balancedDwellTimestamps.delete(tabId);
    return {
      status: 'connecting',
      badgeText: 'Connecting...',
      badgeClass: 'badge-warning',
      tooltip: 'Connecting audio engine to tab stream'
    };
  }

  // 3. Paused State (Section 7.4: captured AND runtime healthy AND active == false)
  if (isCaptured && !isActive) {
    balancedDwellTimestamps.delete(tabId);
    return {
      status: 'paused',
      badgeText: 'Paused',
      badgeClass: 'badge-muted',
      tooltip: 'Playback paused or silent'
    };
  }

  // 4. Limited State (Section 7.5: active AND limited == true)
  if (isActive && isLimited) {
    balancedDwellTimestamps.delete(tabId);
    const reasonText = limitReason === 'headroom' ? 'Headroom ceiling reached to prevent distortion' : `Gain limited (${limitReason})`;
    return {
      status: 'limited',
      badgeText: 'Limited',
      badgeClass: 'badge-warning',
      tooltip: reasonText,
      limitReason
    };
  }

  // 5. Manual State (Section 7.6: auto-normalization disabled)
  if (!isNormEnabled) {
    balancedDwellTimestamps.delete(tabId);
    return {
      status: 'manual',
      badgeText: 'Manual',
      badgeClass: 'badge-secondary',
      tooltip: 'Auto-normalization off; manual relative level active'
    };
  }

  // 6. Balanced State (Section 7.7: outputShortTermValid AND abs(outputTargetErrorLu) <= 1.0 LU AND held for dwell)
  const outputShortTermValid = Boolean(audio.outputShortTermValid ?? tabState.outputShortTermValid);
  const outputTargetErrorLu = audio.outputTargetErrorLu !== undefined ? audio.outputTargetErrorLu : tabState.outputTargetErrorLu;

  const inTolerance = outputShortTermValid &&
    outputTargetErrorLu !== null &&
    outputTargetErrorLu !== undefined &&
    Math.abs(outputTargetErrorLu) <= BALANCED_TOLERANCE_LU;

  if (inTolerance) {
    const dwellStart = balancedDwellTimestamps.get(tabId);
    if (!dwellStart) {
      balancedDwellTimestamps.set(tabId, currentTime);
    } else if (currentTime - dwellStart >= BALANCED_DWELL_MS) {
      return {
        status: 'balanced',
        badgeText: 'Balanced',
        badgeClass: 'badge-success',
        tooltip: `Loudness balanced within ±${BALANCED_TOLERANCE_LU} LU of target`
      };
    }
  } else {
    balancedDwellTimestamps.delete(tabId);
  }

  // 7. Balancing State (Section 7.8: all other healthy, active auto-normalizing states)
  return {
    status: 'balancing',
    badgeText: 'Balancing',
    badgeClass: 'badge-primary',
    tooltip: 'Actively adjusting loudness toward target'
  };
}

/**
 * Format relative level in friendly consumer terminology (Section 6)
 * @param {number} offsetDb
 * @returns {string}
 */
export function formatRelativeLevel(offsetDb) {
  const val = typeof offsetDb === 'number' && !isNaN(offsetDb) ? offsetDb : 0.0;
  if (Math.abs(val) < 0.05) return 'Normal (0.0 dB)';
  if (val > 0) return `+${val.toFixed(1)} dB (Louder)`;
  return `${val.toFixed(1)} dB (Quieter)`;
}

/**
 * Check if a tab URL is supported by Chrome/Edge tabCapture
 * @param {string} url
 * @returns {{ supported: boolean, reason?: string }}
 */
export function checkUrlSupport(url) {
  if (!url) {
    return { supported: false, reason: 'Tab has no URL' };
  }

  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://')) {
    return {
      supported: false,
      reason: 'Browser internal pages cannot be captured due to security restrictions'
    };
  }

  if (url.includes('chrome.google.com/webstore') || url.includes('chromewebstore.google.com') || url.includes('microsoftedge.microsoft.com/addons')) {
    return {
      supported: false,
      reason: 'Extension stores cannot be captured due to browser policy'
    };
  }

  if (url.startsWith('file:///')) {
    return {
      supported: true,
      warning: 'Local files require "Allow access to file URLs" enabled in extension settings'
    };
  }

  return { supported: true };
}
