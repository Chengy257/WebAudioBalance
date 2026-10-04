/**
 * WebAudioBalance - Shared Extension Messaging Protocol
 * Explicit message types, query/event separation, and command result envelopes across contexts
 * Compliant with R2 Runtime & State Reliability Implementation Specification
 */

export const MessageTargets = Object.freeze({
  SERVICE_WORKER: 'service_worker',
  OFFSCREEN: 'offscreen',
  POPUP: 'popup',
  BROADCAST: 'broadcast'
});

export const MessageTypes = Object.freeze({
  // Runtime lifecycle commands
  ENSURE_AUDIO_RUNTIME: 'ENSURE_AUDIO_RUNTIME',
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',

  // Per-tab audio control commands
  SET_TAB_OFFSET: 'SET_TAB_OFFSET',
  SET_NORMALIZATION: 'SET_NORMALIZATION',
  SET_TARGET: 'SET_TARGET',
  SET_TEST_GAIN: 'SET_TEST_GAIN', // Legacy alias for SET_TAB_OFFSET

  // Global settings commands
  SET_GLOBAL_AUTO: 'SET_GLOBAL_AUTO',
  SET_GLOBAL_TARGET: 'SET_GLOBAL_TARGET',

  // Disambiguated Queries (Section 3.3)
  GET_PRODUCT_SNAPSHOT: 'GET_PRODUCT_SNAPSHOT',         // Coordinator reconciled product state
  GET_AUDIO_RUNTIME_SNAPSHOT: 'GET_AUDIO_RUNTIME_SNAPSHOT', // Offscreen live engine truth
  GET_COORDINATOR_SNAPSHOT: 'GET_COORDINATOR_SNAPSHOT', // Deprecated alias for GET_PRODUCT_SNAPSHOT
  QUERY_RUNTIME_STATE: 'QUERY_RUNTIME_STATE',           // Deprecated compatibility alias

  // Disambiguated Events (Section 3.4)
  AUDIO_RUNTIME_READY: 'AUDIO_RUNTIME_READY',
  AUDIO_RUNTIME_LIFECYCLE: 'AUDIO_RUNTIME_LIFECYCLE',
  AUDIO_TELEMETRY: 'AUDIO_TELEMETRY',                   // Throttled live audio metrics (<= 2 Hz)
  METRICS_UPDATE: 'METRICS_UPDATE',                     // Legacy alias for AUDIO_TELEMETRY
  PRODUCT_SNAPSHOT_CHANGED: 'PRODUCT_SNAPSHOT_CHANGED',
  CAPTURE_ERROR: 'CAPTURE_ERROR',
  CAPTURE_STARTED: 'CAPTURE_STARTED',
  CAPTURE_STOPPED: 'CAPTURE_STOPPED',
  LOG_ENTRY: 'LOG_ENTRY'
});

/**
 * Build standard extension message envelope
 */
export function createMessage(type, target, payload = {}, requestId = null) {
  const envelope = {
    type,
    target,
    payload,
    timestamp: Date.now()
  };
  if (requestId !== null && requestId !== undefined) {
    envelope.requestId = requestId;
  }
  return envelope;
}

/**
 * Build explicit command ACK / success envelope (Section 3.2)
 */
export function createCommandSuccess(requestId, command, options = {}) {
  const envelope = {
    success: true,
    requestId: requestId ?? null,
    command
  };
  if (options.tabId !== undefined && options.tabId !== null) envelope.tabId = options.tabId;
  if (options.revision !== undefined && options.revision !== null) envelope.revision = options.revision;
  if (options.result !== undefined) envelope.result = options.result;
  return envelope;
}

/**
 * Build explicit command NACK / error envelope (Section 3.2)
 */
export function createCommandFailure(requestId, command, error, options = {}) {
  const envelope = {
    success: false,
    requestId: requestId ?? null,
    command,
    error: {
      code: error?.code || 'UNKNOWN',
      message: error?.message || (typeof error === 'string' ? error : 'Operation failed'),
      retryable: Boolean(error?.retryable)
    }
  };
  if (options.tabId !== undefined && options.tabId !== null) envelope.tabId = options.tabId;
  if (options.result !== undefined) envelope.result = options.result;
  return envelope;
}
