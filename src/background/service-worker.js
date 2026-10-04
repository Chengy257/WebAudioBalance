/**
 * WebAudioBalance - Service Worker (Control Plane)
 * Multi-tab lifecycle coordinator, ManagedTabRegistry host, and command router
 * Does NOT perform DSP.
 */

import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';
import { MultiTabCoordinator } from '../control/coordinator.js';

const logger = new StructuredLogger('ServiceWorker');
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

const coordinator = new MultiTabCoordinator();
coordinator.init().catch((e) => logger.error('Coordinator init failed', e));

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
      justification: 'WebAudioBalance tab audio capture and real-time processing'
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
 * Register Context Menu for 1-click user invocation
 */
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.contextMenus) {
    chrome.contextMenus.create({
      id: 'balance-tab-menu',
      title: 'WebAudioBalance: Balance this tab',
      contexts: ['page', 'frame', 'video', 'audio']
    });
  }
});

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'balance-tab-menu' && tab && tab.id) {
      logger.info('User activated capture via context menu', { tabId: tab.id });
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        await handleStartCapture(tab.id, streamId);
      } catch (err) {
        logger.error('Failed to capture tab via context menu', { tabId: tab.id, error: err.message });
      }
    }
  });
}

/**
 * Handle START_CAPTURE command
 */
async function handleStartCapture(tabId, existingStreamId = null) {
  try {
    logger.info('Initiating capture for tab', { tabId, hasExistingStreamId: Boolean(existingStreamId) });
    await ensureOffscreenDocument();

    const streamId = existingStreamId || await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (!streamId) {
      throw new Error('tabCapture.getMediaStreamId returned empty stream ID');
    }

    const res = await coordinator.startManagingTab(tabId, streamId);
    return res;
  } catch (err) {
    logger.error('handleStartCapture failed', { tabId, error: err.message });
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
  return await coordinator.stopManagingTab(tabId);
}

/**
 * Central message router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  const { type, payload } = message;

  // Intercept metrics update to keep registry snapshot fresh
  if (type === MessageTypes.METRICS_UPDATE) {
    coordinator.handleMetricsUpdate(payload);
    return false;
  }

  if (message.target !== MessageTargets.SERVICE_WORKER && message.target !== MessageTargets.BROADCAST) {
    return false;
  }

  switch (type) {
    case MessageTypes.ENSURE_AUDIO_RUNTIME:
      ensureOffscreenDocument()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.START_CAPTURE:
      handleStartCapture(payload.tabId, payload.streamId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.STOP_CAPTURE:
      handleStopCapture(payload.tabId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_TEST_GAIN:
      coordinator.setTabManualOffset(payload.tabId, payload.gainDb)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_NORMALIZATION:
      coordinator.setTabNormalization(payload.tabId, payload.normalizationEnabled)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_GLOBAL_AUTO:
      coordinator.setGlobalAutoEnabled(payload.enabled)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.SET_GLOBAL_TARGET:
      coordinator.setGlobalTargetLufs(payload.targetLufs)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case MessageTypes.GET_COORDINATOR_SNAPSHOT:
      sendResponse(coordinator.getSnapshot());
      return true;

    case MessageTypes.QUERY_RUNTIME_STATE:
      sendResponse(coordinator.getSnapshot());
      return true;

    default:
      return false;
  }
});

/**
 * Tab lifecycle observations (tabs.onRemoved, tabs.onUpdated)
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  logger.info('Tab closed, notifying coordinator', { tabId, removeInfo });
  coordinator.handleTabClosed(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  coordinator.handleTabUpdated(tabId, changeInfo);
});
