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
  CAPTURE_AUTHORIZATION_REQUIRED: 'CAPTURE_AUTHORIZATION_REQUIRED',
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
  const errMsg = typeof error === 'string' ? error : (error?.message || error?.code || '');
  const errCode = error?.code || '';
  const url = context.url || '';

  // 1. Browser-specific URL restrictions & unsupported pages (Section 4.7 & 5.5)
  if (
    errCode === ErrorCodes.UNSUPPORTED_TAB ||
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    url.includes('chrome.google.com/webstore') ||
    url.includes('chromewebstore.google.com') ||
    url.includes('microsoftedge.microsoft.com/addons') ||
    errMsg.includes('Chrome pages cannot be captured') ||
    errMsg.includes('cannot be captured') ||
    errMsg.includes('security restrictions')
  ) {
    return {
      category: FailureTaxonomy.BROWSER_SPECIFIC_FAILURE,
      userMessage: 'This browser page cannot be captured.',
      actionable: false
    };
  }

  // 2. Authorization / User Activation Required (Section 4.5 & 5.5)
  if (
    errCode === ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED ||
    errMsg.includes('CAPTURE_AUTHORIZATION_REQUIRED') ||
    errMsg.includes('Extension has not been invoked') ||
    errMsg.includes('activeTab') ||
    errMsg.includes('user gesture') ||
    errMsg.includes('gesture')
  ) {
    return {
      category: FailureTaxonomy.PERMISSION_ACTIVATION_FAILURE,
      userMessage: 'Open this tab and enable WebAudioBalance from that tab before balancing it.',
      actionable: true
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

  // 4. Capture failures
  if (errMsg.includes('tabCapture') || errMsg.includes('getMediaStreamId')) {
    return {
      category: FailureTaxonomy.CAPTURE_FAILURE,
      userMessage: 'WebAudioBalance could not start audio processing for this tab.',
      actionable: true
    };
  }

  // 5. Lifecycle failures
  if (errMsg.includes('Tab was closed') || errMsg.includes('tab closed') || errMsg.includes('disconnected port')) {
    return {
      category: FailureTaxonomy.LIFECYCLE_FAILURE,
      userMessage: 'Tab or background connection closed.',
      actionable: false
    };
  }

  // 6. DSP failures
  if (errMsg.includes('NaN') || errMsg.includes('Infinity') || errMsg.includes('audio processing anomaly')) {
    return {
      category: FailureTaxonomy.DSP_FAILURE,
      userMessage: 'Digital signal processing encountered an arithmetic anomaly.',
      actionable: false
    };
  }

  // 7. Audio runtime start / engine failure (Section 5.5)
  if (
    errCode === ErrorCodes.AUDIO_ENGINE_START_FAILED ||
    errCode === ErrorCodes.OFFSCREEN_UNAVAILABLE ||
    errCode === ErrorCodes.AUDIO_ENGINE_NOT_FOUND ||
    errCode === ErrorCodes.STREAM_ID_ACQUISITION_FAILED ||
    errMsg.includes('AudioContext') ||
    errMsg.includes('AudioEngine') ||
    errMsg.includes('Offscreen')
  ) {
    return {
      category: FailureTaxonomy.CAPTURE_FAILURE,
      userMessage: 'WebAudioBalance could not start audio processing for this tab.',
      actionable: true
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
    userMessage: 'WebAudioBalance could not start audio processing for this tab.',
    actionable: false
  };
}
