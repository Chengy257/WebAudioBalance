/**
 * WebAudioBalance - Service Worker (Control Plane)
 * Multi-tab lifecycle coordinator, ManagedTabRegistry host, and command router
 * Compliant with R2 Runtime & State Reliability Implementation Specification (Sections 8, 9, 13)
 * Does NOT perform DSP.
 */

import { MessageTargets, MessageTypes, createMessage, createCommandSuccess, createCommandFailure } from '../shared/messages.js';
import { ErrorCodes, createRuntimeError } from '../shared/failure-taxonomy.js';
import { StructuredLogger, getBrowserInfo } from '../shared/logger.js';
import { MultiTabCoordinator } from '../control/coordinator.js';
import { checkUrlSupport } from '../popup/state-presenter.js';

const logger = new StructuredLogger('ServiceWorker');
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen/offscreen.html';

const coordinator = new MultiTabCoordinator();
// Section 8: Coordinator readiness barrier
const coordinatorReady = coordinator.init().catch((e) => {
  logger.error('Coordinator init failed', e);
  return false;
});

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
        const urlCheck = checkUrlSupport(tab.url || '');
        if (!urlCheck.supported) {
          logger.warn('Context menu capture rejected: unsupported page', { tabId: tab.id, url: tab.url, reason: urlCheck.reason });
          return;
        }

        let streamId = null;
        try {
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        } catch (streamErr) {
          logger.error('tabCapture.getMediaStreamId failed in context menu gesture', { tabId: tab.id, error: streamErr.message });
          return;
        }

        if (!streamId) {
          logger.error('Empty stream ID acquired in context menu gesture', { tabId: tab.id });
          return;
        }

        await handleStartCapture(tab.id, streamId, { gestureSource: 'contextMenu' });
      } catch (err) {
        logger.error('Failed to capture tab via context menu', { tabId: tab.id, error: err.message });
      }
    }
  });
}

/**
 * Handle START_CAPTURE command with strict authorization check & transaction ordering (RA-1 & RA-2)
 */
async function handleStartCapture(tabId, existingStreamId = null, options = {}) {
  await coordinatorReady;

  // 1. Validate supported tab/page
  let tabInfo = null;
  try {
    tabInfo = await chrome.tabs.get(tabId);
  } catch (_) {}
  const tabUrl = tabInfo?.url || options.url || '';
  const urlCheck = checkUrlSupport(tabUrl);
  if (!urlCheck.supported) {
    logger.warn('START_CAPTURE rejected: unsupported page', { tabId, url: tabUrl, reason: urlCheck.reason });
    const err = createRuntimeError(
      ErrorCodes.UNSUPPORTED_TAB,
      urlCheck.reason || 'This browser page cannot be captured.',
      { tabId, retryable: false }
    );
    // Ensure no stale managed state on failure
    coordinator.registry.setManaged(tabId, false);
    coordinator.registry.setCaptured(tabId, false, { lastRuntimeError: err });
    return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, err, { tabId });
  }

  // 2. First-time capture requires an authorized streamId from valid user invocation
  const streamId = existingStreamId;
  if (!streamId) {
    logger.warn('START_CAPTURE rejected: missing authorized stream ID', { tabId });
    const authErr = createRuntimeError(
      ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED,
      'This tab must be opened and explicitly enabled before it can be balanced.',
      { tabId, retryable: true }
    );
    // Crucial: Do not commit managed state before capture authorization succeeds
    coordinator.registry.setManaged(tabId, false);
    coordinator.registry.setCaptured(tabId, false, { lastRuntimeError: authErr });
    return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, authErr, { tabId });
  }

  // 3. Ensure Offscreen document
  try {
    await ensureOffscreenDocument();
  } catch (offErr) {
    logger.error('Failed to ensure offscreen document', { tabId, error: offErr.message });
    const runtimeErr = createRuntimeError(
      ErrorCodes.OFFSCREEN_UNAVAILABLE,
      `Failed to reach Offscreen audio runtime: ${offErr.message}`,
      { tabId, cause: offErr, retryable: true }
    );
    coordinator.registry.setManaged(tabId, false);
    coordinator.registry.setCaptured(tabId, false, { lastRuntimeError: runtimeErr });
    return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, runtimeErr, { tabId });
  }

  // 4. Delegate to coordinator startManagingTab
  try {
    const res = await coordinator.startManagingTab(tabId, streamId, options);
    return res;
  } catch (err) {
    logger.error('handleStartCapture exception', { tabId, error: err.message || err });
    const runtimeErr = err.code ? err : createRuntimeError(ErrorCodes.AUDIO_ENGINE_START_FAILED, err.message, { tabId, cause: err });
    coordinator.registry.setCaptured(tabId, false, { lastRuntimeError: runtimeErr });
    chrome.runtime.sendMessage(createMessage(MessageTypes.CAPTURE_ERROR, MessageTargets.POPUP, {
      tabId,
      error: runtimeErr.message,
      errorCode: runtimeErr.code
    })).catch(() => {});
    return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, runtimeErr, { tabId });
  }
}

/**
 * Central message router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  const { type, payload = {}, requestId } = message;

  // Intercept telemetry events to keep registry state fresh
  if (type === MessageTypes.AUDIO_TELEMETRY || type === MessageTypes.METRICS_UPDATE) {
    coordinator.handleMetricsUpdate(payload);
    return false;
  }

  // Intercept Offscreen ready & lifecycle events (Section 13)
  if (type === MessageTypes.AUDIO_RUNTIME_READY) {
    coordinator.handleRuntimeReady(payload?.runtimeInstanceId);
    return false;
  }
  if (type === MessageTypes.AUDIO_RUNTIME_LIFECYCLE) {
    coordinator.handleRuntimeLifecycle(payload);
    return false;
  }

  if (message.target !== MessageTargets.SERVICE_WORKER && message.target !== MessageTargets.BROADCAST) {
    return false;
  }

  switch (type) {
    case MessageTypes.ENSURE_AUDIO_RUNTIME:
      ensureOffscreenDocument()
        .then(() => sendResponse(createCommandSuccess(requestId, type)))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, {
          code: ErrorCodes.OFFSCREEN_UNAVAILABLE,
          message: err.message
        })));
      return true;

    case MessageTypes.START_CAPTURE:
      handleStartCapture(payload.tabId, payload.streamId, {
        requestId,
        manualOffsetDb: payload.manualOffsetDb,
        relativeOffsetDb: payload.relativeOffsetDb,
        normalizationEnabled: payload.normalizationEnabled
      })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err, { tabId: payload.tabId })));
      return true;

    case MessageTypes.STOP_CAPTURE:
      coordinatorReady
        .then(() => coordinator.stopManagingTab(payload.tabId, { requestId, release: payload.release !== false }))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err, { tabId: payload.tabId })));
      return true;

    case MessageTypes.SET_TAB_OFFSET:
    case MessageTypes.SET_TEST_GAIN: {
      const gainVal = payload.gainDb ?? payload.offsetDb ?? payload.relativeOffsetDb ?? payload.manualOffsetDb ?? 0.0;
      coordinatorReady
        .then(() => coordinator.setTabManualOffset(payload.tabId, gainVal, { requestId }))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err, { tabId: payload.tabId })));
      return true;
    }

    case MessageTypes.SET_NORMALIZATION:
      coordinatorReady
        .then(() => coordinator.setTabNormalization(payload.tabId, payload.normalizationEnabled, { requestId }))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err, { tabId: payload.tabId })));
      return true;

    case MessageTypes.SET_GLOBAL_AUTO:
      coordinatorReady
        .then(() => coordinator.setGlobalAutoEnabled(payload.enabled, { requestId }))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err)));
      return true;

    case MessageTypes.SET_GLOBAL_TARGET:
      coordinatorReady
        .then(() => coordinator.setGlobalTargetLufs(payload.targetLufs, { requestId }))
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err)));
      return true;

    case MessageTypes.RECONCILE_RUNTIME:
      coordinatorReady
        .then(() => coordinator.reconcileRuntime(payload?.reason || 'user_refresh'))
        .then((snapshot) => sendResponse(createCommandSuccess(requestId, type, { snapshot })))
        .catch((err) => sendResponse(createCommandFailure(requestId, type, err)));
      return true;

    // Disambiguated Query: GET_PRODUCT_SNAPSHOT (Section 3.3 & Section 6)
    case MessageTypes.GET_PRODUCT_SNAPSHOT:
    case MessageTypes.GET_COORDINATOR_SNAPSHOT:
    case MessageTypes.QUERY_RUNTIME_STATE:
      coordinatorReady
        .then(() => sendResponse(coordinator.getSnapshot()))
        .catch(() => sendResponse(coordinator.getSnapshot()));
      return true;

    default:
      return false;
  }
});

/**
 * Tab lifecycle observations (tabs.onRemoved, tabs.onUpdated, tabCapture.onStatusChanged) (Section 13)
 */
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  logger.info('Tab closed, notifying coordinator', { tabId, removeInfo });
  coordinatorReady.then(() => coordinator.handleTabClosed(tabId)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  coordinatorReady.then(() => coordinator.handleTabUpdated(tabId, changeInfo, tab)).catch(() => {});
});

if (chrome.tabCapture && chrome.tabCapture.onStatusChanged) {
  chrome.tabCapture.onStatusChanged.addListener((info) => {
    logger.info('tabCapture.onStatusChanged detected', info);
    coordinatorReady.then(() => coordinator.reconcileRuntime('tabCapture.onStatusChanged')).catch(() => {});
  });
}
