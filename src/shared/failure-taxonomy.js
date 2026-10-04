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

export const ErrorCodes = Object.freeze({
  UNSUPPORTED_TAB: 'UNSUPPORTED_TAB',
  STREAM_ID_ACQUISITION_FAILED: 'STREAM_ID_ACQUISITION_FAILED',
  OFFSCREEN_UNAVAILABLE: 'OFFSCREEN_UNAVAILABLE',
  AUDIO_ENGINE_START_FAILED: 'AUDIO_ENGINE_START_FAILED',
  AUDIO_ENGINE_NOT_FOUND: 'AUDIO_ENGINE_NOT_FOUND',
  AUDIO_COMMAND_REJECTED: 'AUDIO_COMMAND_REJECTED',
  RUNTIME_RECONCILIATION_FAILED: 'RUNTIME_RECONCILIATION_FAILED',
  TAB_GONE: 'TAB_GONE',
  CAPTURE_STATE_MISMATCH: 'CAPTURE_STATE_MISMATCH',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Construct a standardized runtime error object (Section 14)
 */
export function createRuntimeError(code, message, options = {}) {
  const err = {
    code: code || ErrorCodes.UNKNOWN,
    message: message || (typeof code === 'string' ? code : 'An unexpected runtime error occurred'),
    retryable: Boolean(options.retryable),
    timestamp: options.timestamp || Date.now()
  };
  if (options.tabId !== undefined && options.tabId !== null) {
    err.tabId = options.tabId;
  }
  if (options.cause !== undefined && options.cause !== null) {
    err.cause = typeof options.cause === 'object' ? (options.cause.message || String(options.cause)) : options.cause;
  }
  return err;
}


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
