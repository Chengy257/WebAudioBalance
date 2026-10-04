/**
 * WebAudioBalance P0 Feasibility Harness
 * Explicit message types and contracts across contexts (Service Worker, Offscreen Document, Popup)
 */

export const MessageTargets = {
  SERVICE_WORKER: 'service_worker',
  OFFSCREEN: 'offscreen',
  POPUP: 'popup',
  BROADCAST: 'broadcast'
};

export const MessageTypes = {
  // Commands
  ENSURE_AUDIO_RUNTIME: 'ENSURE_AUDIO_RUNTIME',
  START_CAPTURE: 'START_CAPTURE',
  SET_TEST_GAIN: 'SET_TEST_GAIN',
  STOP_CAPTURE: 'STOP_CAPTURE',
  QUERY_RUNTIME_STATE: 'QUERY_RUNTIME_STATE',
  CLEAR_DIAGNOSTICS: 'CLEAR_DIAGNOSTICS',

  // P3 Orchestration Commands
  SET_NORMALIZATION: 'SET_NORMALIZATION',
  SET_TARGET: 'SET_TARGET',
  SET_GLOBAL_AUTO: 'SET_GLOBAL_AUTO',
  SET_GLOBAL_TARGET: 'SET_GLOBAL_TARGET',
  GET_COORDINATOR_SNAPSHOT: 'GET_COORDINATOR_SNAPSHOT',

  // Events / Responses
  AUDIO_RUNTIME_READY: 'AUDIO_RUNTIME_READY',
  CAPTURE_STARTED: 'CAPTURE_STARTED',
  CAPTURE_STOPPED: 'CAPTURE_STOPPED',
  CAPTURE_ERROR: 'CAPTURE_ERROR',
  METRICS_UPDATE: 'METRICS_UPDATE',
  RUNTIME_STATE: 'RUNTIME_STATE',
  COORDINATOR_SNAPSHOT: 'COORDINATOR_SNAPSHOT',
  LOG_ENTRY: 'LOG_ENTRY'
};

/**
 * Helper to build standard envelope
 */
export function createMessage(type, target, payload = {}) {
  return {
    type,
    target,
    payload,
    timestamp: Date.now()
  };
}
