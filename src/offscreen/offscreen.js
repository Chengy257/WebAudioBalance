/**
 * WebAudioBalance - Offscreen Audio Runtime (Audio Plane)
 * Hosts AudioEngineManager managing all active tab AudioEngines
 */

import { AudioEngineManager } from './audio-engine-manager.js';
import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('OffscreenRuntime');
const engineManager = new AudioEngineManager();

logger.info('Offscreen Audio Runtime initialized with AudioEngineManager', { env: getBrowserInfo() });

// Notify SW that offscreen document is ready
chrome.runtime.sendMessage(createMessage(MessageTypes.AUDIO_RUNTIME_READY, MessageTargets.SERVICE_WORKER)).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || (message.target !== MessageTargets.OFFSCREEN && message.target !== MessageTargets.BROADCAST)) {
    return false;
  }

  const { type, payload } = message;

  switch (type) {
    case MessageTypes.START_CAPTURE:
      engineManager.startEngine(payload.tabId, payload.streamId, payload)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_TEST_GAIN:
      const gainOk = engineManager.setEngineGain(payload.tabId, payload.gainDb);
      sendResponse({ success: gainOk });
      return true;

    case MessageTypes.SET_NORMALIZATION:
      const normOk = engineManager.setEngineNormalization(payload.tabId, payload.normalizationEnabled);
      sendResponse({ success: normOk });
      return true;

    case MessageTypes.SET_TARGET:
      const targetOk = engineManager.setEngineTarget(payload.tabId, payload.targetLufs);
      sendResponse({ success: targetOk });
      return true;

    case MessageTypes.STOP_CAPTURE:
      engineManager.stopEngine(payload.tabId)
        .then((stopped) => sendResponse({ success: stopped }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.QUERY_RUNTIME_STATE:
      sendResponse({ activeStreams: engineManager.getAllStates() });
      return true;

    default:
      return false;
  }
});
