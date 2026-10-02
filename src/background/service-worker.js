/**
 * WebAudioBalance P0 Feasibility Harness - Service Worker (Control Plane)
 * Responsible for lifecycle, user command orchestration, stream ID generation, and event routing.
 * Does NOT perform DSP.
 */

import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';

const logger = new StructuredLogger('ServiceWorker');
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

let swStartupTime = Date.now();
logger.info('Service Worker started/woken up', {
  startupTime: new Date(swStartupTime).toISOString(),
  env: getBrowserInfo()
});

/**
 * Ensure offscreen document exists
 */
async function ensureOffscreenDocument() {
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    if (await chrome.offscreen.hasDocument()) {
      return;
    }
  } else if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length > 0) return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'P0 tab audio capture and Web Audio real-time processing'
    });
    logger.info('Offscreen document created');
  } catch (err) {
    if (err.message && err.message.includes('Only a single offscreen')) {
      return;
    }
    logger.error('Failed to create offscreen document', { error: err.message });
    throw err;
  }
}

/**
 * Handle START_CAPTURE command
 */
async function handleStartCapture(tabId) {
  try {
    logger.info('Initiating capture for tab', { tabId });
    await ensureOffscreenDocument();

    // Acquire stream ID from tabCapture API
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) {
      throw new Error('tabCapture.getMediaStreamId returned empty stream ID');
    }

    logger.info('Acquired stream ID, dispatching to Offscreen', { tabId, streamIdLength: streamId.length });

    // Send to offscreen audio runtime
    chrome.runtime.sendMessage(createMessage(MessageTypes.START_CAPTURE, MessageTargets.OFFSCREEN, {
      tabId,
      streamId
    })).catch((err) => {
      logger.error('Failed to dispatch START_CAPTURE to offscreen', { error: err.message });
    });

    return { success: true, tabId };
  } catch (err) {
    logger.error('handleStartCapture failed', { tabId, error: err.message, stack: err.stack });
    // Notify UI of error
    chrome.runtime.sendMessage(createMessage(MessageTypes.CAPTURE_ERROR, MessageTargets.POPUP, {
      tabId,
      error: err.message
    })).catch(() => {});
    return { success: false, error: err.message };
  }
}

/**
 * Handle STOP_CAPTURE command
 */
async function handleStopCapture(tabId) {
  logger.info('Stopping capture for tab', { tabId });
  try {
    await chrome.runtime.sendMessage(createMessage(MessageTypes.STOP_CAPTURE, MessageTargets.OFFSCREEN, { tabId }));
    return { success: true };
  } catch (err) {
    logger.warn('Failed to dispatch STOP_CAPTURE to offscreen', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Central message router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== MessageTargets.SERVICE_WORKER && message.target !== MessageTargets.BROADCAST) {
    return false;
  }

  const { type, payload } = message;

  switch (type) {
    case MessageTypes.ENSURE_AUDIO_RUNTIME:
      ensureOffscreenDocument()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.START_CAPTURE:
      handleStartCapture(payload.tabId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.STOP_CAPTURE:
      handleStopCapture(payload.tabId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_TEST_GAIN:
      chrome.runtime.sendMessage(createMessage(MessageTypes.SET_TEST_GAIN, MessageTargets.OFFSCREEN, payload))
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.QUERY_RUNTIME_STATE:
      chrome.runtime.sendMessage(createMessage(MessageTypes.QUERY_RUNTIME_STATE, MessageTargets.OFFSCREEN, payload))
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ activeStreams: [], error: err.message }));
      return true;

    default:
      return false;
  }
});

/**
 * Tab lifecycle observations (WP4 / Lifecycle experiment)
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  logger.info('Tab closed by browser, notifying offscreen to cleanup', { tabId, removeInfo });
  handleStopCapture(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status || changeInfo.url || changeInfo.audible !== undefined) {
    logger.info('Tab update event observed', {
      tabId,
      status: changeInfo.status,
      audible: changeInfo.audible,
      urlChanged: Boolean(changeInfo.url)
    });
  }
});
