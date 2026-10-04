/**
 * WebAudioBalance - Offscreen Audio Runtime (Audio Plane)
 * Hosts AudioEngineManager managing all active tab AudioEngines
 * Compliant with R2 Runtime & State Reliability Implementation Specification
 */

import { AudioEngineManager } from './audio-engine-manager.js';
import { MessageTargets, MessageTypes, createMessage, createCommandSuccess, createCommandFailure } from '../shared/messages.js';
import { ErrorCodes } from '../shared/failure-taxonomy.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('OffscreenRuntime');
const engineManager = new AudioEngineManager();

logger.info('Offscreen Audio Runtime initialized with AudioEngineManager', {
  runtimeInstanceId: engineManager.runtimeInstanceId,
  env: getBrowserInfo()
});

// Notify SW that offscreen document is ready (Section 3.4 & 13)
chrome.runtime.sendMessage(createMessage(
  MessageTypes.AUDIO_RUNTIME_READY,
  MessageTargets.SERVICE_WORKER,
  { runtimeInstanceId: engineManager.runtimeInstanceId }
)).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.target !== MessageTargets.OFFSCREEN && message.target !== MessageTargets.BROADCAST)) {
    return false;
  }

  const { type, payload = {}, requestId } = message;

  switch (type) {
    case MessageTypes.START_CAPTURE:
      engineManager.startEngine(payload.tabId, payload.streamId, payload)
        .then((result) => {
          if (result.success) {
            sendResponse(createCommandSuccess(requestId, type, { tabId: payload.tabId, result }));
          } else {
            sendResponse(createCommandFailure(requestId, type, result.error, { tabId: payload.tabId }));
          }
        })
        .catch((err) => {
          sendResponse(createCommandFailure(requestId, type, {
            code: ErrorCodes.AUDIO_ENGINE_START_FAILED,
            message: err.message,
            retryable: true
          }, { tabId: payload.tabId }));
        });
      return true;

    case MessageTypes.SET_TAB_OFFSET:
    case MessageTypes.SET_TEST_GAIN: {
      const gainVal = payload.gainDb ?? payload.offsetDb ?? payload.relativeOffsetDb ?? payload.manualOffsetDb ?? 0.0;
      const res = engineManager.setEngineGain(payload.tabId, gainVal);
      if (res.success) {
        sendResponse(createCommandSuccess(requestId, type, { tabId: payload.tabId, result: res }));
      } else {
        sendResponse(createCommandFailure(requestId, type, res.error, { tabId: payload.tabId }));
      }
      return true;
    }

    case MessageTypes.SET_NORMALIZATION: {
      const res = engineManager.setEngineNormalization(payload.tabId, payload.normalizationEnabled);
      if (res.success) {
        sendResponse(createCommandSuccess(requestId, type, { tabId: payload.tabId, result: res }));
      } else {
        sendResponse(createCommandFailure(requestId, type, res.error, { tabId: payload.tabId }));
      }
      return true;
    }

    case MessageTypes.SET_TARGET: {
      const res = engineManager.setEngineTarget(payload.tabId, payload.targetLufs);
      if (res.success) {
        sendResponse(createCommandSuccess(requestId, type, { tabId: payload.tabId, result: res }));
      } else {
        sendResponse(createCommandFailure(requestId, type, res.error, { tabId: payload.tabId }));
      }
      return true;
    }

    case MessageTypes.SET_GLOBAL_AUTO: {
      const res = engineManager.setGlobalNormalization(payload.enabled);
      if (res.success) {
        sendResponse(createCommandSuccess(requestId, type, { result: res }));
      } else {
        sendResponse(createCommandFailure(requestId, type, {
          code: ErrorCodes.AUDIO_COMMAND_REJECTED,
          message: 'Some engines failed to apply global normalization'
        }, { result: res }));
      }
      return true;
    }

    case MessageTypes.SET_GLOBAL_TARGET: {
      const res = engineManager.setGlobalTarget(payload.targetLufs);
      if (res.success) {
        sendResponse(createCommandSuccess(requestId, type, { result: res }));
      } else {
        sendResponse(createCommandFailure(requestId, type, {
          code: ErrorCodes.AUDIO_COMMAND_REJECTED,
          message: 'Some engines failed to apply global target'
        }, { result: res }));
      }
      return true;
    }

    case MessageTypes.STOP_CAPTURE:
      engineManager.stopEngine(payload.tabId)
        .then((res) => {
          if (res.success) {
            sendResponse(createCommandSuccess(requestId, type, { tabId: payload.tabId, result: res }));
          } else {
            sendResponse(createCommandFailure(requestId, type, res.error, { tabId: payload.tabId }));
          }
        })
        .catch((err) => {
          sendResponse(createCommandFailure(requestId, type, {
            code: ErrorCodes.AUDIO_COMMAND_REJECTED,
            message: err.message,
            retryable: true
          }, { tabId: payload.tabId }));
        });
      return true;

    // Disambiguated Query: GET_AUDIO_RUNTIME_SNAPSHOT (Section 3.3 & Section 4)
    case MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT:
      sendResponse(engineManager.getRuntimeSnapshot());
      return true;

    // Compatibility alias: QUERY_RUNTIME_STATE (Section 3.3)
    case MessageTypes.QUERY_RUNTIME_STATE: {
      const snapshot = engineManager.getRuntimeSnapshot();
      sendResponse({
        activeStreams: engineManager.getAllStates(),
        ...snapshot
      });
      return true;
    }

    default:
      return false;
  }
});
