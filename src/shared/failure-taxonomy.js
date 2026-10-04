/**
 * WebAudioBalance - Failure Taxonomy (Shared)
 * Authoritative failure classification per Section 17 of Mainline Plan
 */

export const FailureTaxonomy = Object.freeze({
  CAPTURE_FAILURE: 'capture_failure',
  PLAYBACK_FAILURE: 'playback_failure',
  LIFECYCLE_FAILURE: 'lifecycle_failure',
  DSP_FAILURE: 'dsp_failure',
  PERMISSION_ACTIVATION_FAILURE: 'permission_activation_failure',
  BROWSER_SPECIFIC_FAILURE: 'browser_specific_failure',
  SITE_SPECIFIC_FAILURE: 'site_specific_failure',
  PROTECTED_CONTENT_LIMITATION: 'protected_content_limitation',
  UNKNOWN: 'unknown'
});

/**
 * Classify a runtime error into the formal failure taxonomy
 * @param {Error|object|string} error
 * @param {object} context - additional metadata such as url, tabId, browser
 * @returns {{ category: string, userMessage: string, actionable: boolean }}
 */
export function classifyFailure(error, context = {}) {
  const errMsg = typeof error === 'string' ? error : (error?.message || '');
  const url = context.url || '';

  // 1. Browser-specific URL restrictions
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://')) {
    return {
      category: FailureTaxonomy.BROWSER_SPECIFIC_FAILURE,
      userMessage: 'Browser internal pages cannot be captured due to platform security rules.',
      actionable: false
    };
  }

  // 2. Web Store policies
  if (url.includes('chrome.google.com/webstore') || url.includes('microsoftedge.microsoft.com/addons')) {
    return {
      category: FailureTaxonomy.BROWSER_SPECIFIC_FAILURE,
      userMessage: 'Extension store pages cannot be captured due to browser security policy.',
      actionable: false
    };
  }

  // 3. Protected Content / DRM / EME
  if (errMsg.includes('EME') || errMsg.includes('DRM') || errMsg.includes('Widevine') || errMsg.includes('protected media')) {
    return {
      category: FailureTaxonomy.PROTECTED_CONTENT_LIMITATION,
      userMessage: 'Audio is protected by hardware DRM (EME) and cannot be captured via tabCapture.',
      actionable: false
    };
  }

  // 4. Permission / User Activation
  if (errMsg.includes('user gesture') || errMsg.includes('activeTab') || errMsg.includes('gesture')) {
    return {
      category: FailureTaxonomy.PERMISSION_ACTIVATION_FAILURE,
      userMessage: 'Tab capture requires a direct user click on the extension or context menu.',
      actionable: true
    };
  }

  // 5. Capture failures
  if (errMsg.includes('tabCapture') || errMsg.includes('getMediaStreamId') || errMsg.includes('Cannot capture')) {
    return {
      category: FailureTaxonomy.CAPTURE_FAILURE,
      userMessage: 'Failed to obtain audio capture stream from browser.',
      actionable: true
    };
  }

  // 6. Lifecycle failures
  if (errMsg.includes('Tab was closed') || errMsg.includes('tab closed') || errMsg.includes('disconnected port')) {
    return {
      category: FailureTaxonomy.LIFECYCLE_FAILURE,
      userMessage: 'Tab or background connection closed.',
      actionable: false
    };
  }

  // 7. DSP failures
  if (errMsg.includes('NaN') || errMsg.includes('Infinity') || errMsg.includes('AudioContext') || errMsg.includes('audio processing')) {
    return {
      category: FailureTaxonomy.DSP_FAILURE,
      userMessage: 'Digital signal processing encountered an arithmetic anomaly.',
      actionable: false
    };
  }

  // 8. Playback failures
  if (errMsg.includes('playback') || errMsg.includes('destination') || errMsg.includes('audio routing')) {
    return {
      category: FailureTaxonomy.PLAYBACK_FAILURE,
      userMessage: 'Failed to output processed audio to system audio device.',
      actionable: true
    };
  }

  return {
    category: FailureTaxonomy.UNKNOWN,
    userMessage: errMsg || 'An unexpected error occurred.',
    actionable: false
  };
}
