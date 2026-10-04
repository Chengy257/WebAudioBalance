/**
 * WebAudioBalance - AudioEngine Types & Lifecycle Definitions
 */

export const AudioEngineState = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  ERROR: 'ERROR'
});

const VALID_TRANSITIONS = {
  [AudioEngineState.IDLE]: [AudioEngineState.STARTING, AudioEngineState.ERROR],
  [AudioEngineState.STARTING]: [AudioEngineState.RUNNING, AudioEngineState.STOPPING, AudioEngineState.ERROR],
  [AudioEngineState.RUNNING]: [AudioEngineState.STOPPING, AudioEngineState.ERROR],
  [AudioEngineState.STOPPING]: [AudioEngineState.IDLE, AudioEngineState.ERROR],
  [AudioEngineState.ERROR]: [AudioEngineState.IDLE, AudioEngineState.STARTING]
};

/**
 * Validate state transition
 */
export function validateStateTransition(currentState, nextState) {
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed || !allowed.includes(nextState)) {
    throw new Error(`Invalid AudioEngine state transition from "${currentState}" to "${nextState}"`);
  }
}
