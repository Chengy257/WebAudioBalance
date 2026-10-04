/**
 * WebAudioBalance - StatePresenter (Popup Presentation Layer)
 * Translates low-level DSP metrics and logical states into friendly consumer concepts
 */

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
 * Determine user-facing presentation status
 * @param {object} tabState - ManagedTabState from registry or snapshot
 * @returns {{ badgeText: string, badgeClass: string, tooltip: string }}
 */
export function presentTabStatus(tabState) {
  if (!tabState) {
    return { badgeText: 'Unknown', badgeClass: 'badge-muted', tooltip: 'Status unavailable' };
  }

  // 1. Error state
  if (tabState.error) {
    return { badgeText: 'Error', badgeClass: 'badge-danger', tooltip: tabState.error };
  }

  // 2. Not managed yet
  if (!tabState.managed) {
    return { badgeText: 'Detected', badgeClass: 'badge-info', tooltip: 'Audible tab ready to balance' };
  }

  // 3. Managed but capture starting
  if (!tabState.captured) {
    return { badgeText: 'Starting...', badgeClass: 'badge-warning', tooltip: 'Connecting audio engine' };
  }

  // 4. Media paused / silence
  if (!tabState.active) {
    return { badgeText: 'Paused', badgeClass: 'badge-muted', tooltip: 'Media paused or silent' };
  }

  // 5. Automatic normalization disabled
  if (!tabState.normalizationEnabled) {
    return { badgeText: 'Manual Only', badgeClass: 'badge-secondary', tooltip: 'Auto-normalization off; manual offset active' };
  }

  // 6. Normalizing vs Balanced
  // If shortTermLufs is near target (within 1.5 dB), show "Balanced"
  const target = tabState.targetLufs ?? -18.0;
  const current = tabState.shortTermLufs ?? -100.0;
  if (current > -70 && Math.abs(current - target) <= 1.5) {
    return { badgeText: 'Balanced', badgeClass: 'badge-success', tooltip: 'Loudness matched to target' };
  }

  return { badgeText: 'Balancing', badgeClass: 'badge-primary', tooltip: 'Adjusting loudness toward target' };
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

  if (url.includes('chrome.google.com/webstore') || url.includes('microsoftedge.microsoft.com/addons')) {
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
