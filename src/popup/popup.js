/**
 * WebAudioBalance - Product UI Controller (Popup)
 * Connects MultiTabCoordinator control plane with user-facing presentation layer
 */

import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { ErrorCodes, createRuntimeError, classifyFailure } from '../shared/failure-taxonomy.js';
import { StructuredLogger, getBrowserInfo, getStoredLogs, clearStoredLogs } from '../shared/logger.js';
import { ListeningLevels, getListeningLevelByTarget, presentTabStatus, formatRelativeLevel, checkUrlSupport } from './state-presenter.js';

const logger = new StructuredLogger('ProductUI');

// Local UI state
let currentSnapshot = {
  globalSettings: { globalAutoEnabled: true, globalTargetLufs: -18.0 },
  managedTabs: [],
  allTabs: []
};
let detectedAudibleTabs = [];
let activeTabInfo = null;
let activeDragTabId = null; // Prevents incoming telemetry from snapping slider during user drag

// DOM Elements
const envDisplayEl = document.getElementById('envDisplay');
const btnRefresh = document.getElementById('btnRefresh');
const btnToggleDiagnostics = document.getElementById('btnToggleDiagnostics');
const diagnosticsDrawer = document.getElementById('diagnosticsDrawer');
const diagnosticsLog = document.getElementById('diagnosticsLog');
const diagnosticsMetrics = document.getElementById('diagnosticsMetrics');
const btnCopyDiagReport = document.getElementById('btnCopyDiagReport');
const btnClearDiagLogs = document.getElementById('btnClearDiagLogs');

const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');
const btnDismissError = document.getElementById('btnDismissError');

const btnGlobalAuto = document.getElementById('btnGlobalAuto');
const levelButtons = document.querySelectorAll('.segment-btn');

const currentTabContainer = document.getElementById('currentTabContainer');
const managedCountBadge = document.getElementById('managedCountBadge');
const managedTabsContainer = document.getElementById('managedTabsContainer');

const detectedCountBadge = document.getElementById('detectedCountBadge');
const detectedTabsContainer = document.getElementById('detectedTabsContainer');

function showError(msg) {
  if (errorBanner && errorMessage) {
    errorMessage.textContent = msg;
    errorBanner.classList.remove('hidden');
  }
}

function hideError() {
  if (errorBanner) {
    errorBanner.classList.add('hidden');
  }
}

/**
 * Initialize Popup
 */
async function init() {
  const env = getBrowserInfo();
  if (envDisplayEl) {
    envDisplayEl.textContent = `${env.browser} ${env.version}`;
  }
  logger.info('Product UI initialized', { env });

  setupEventListeners();
  renderLogs();

  await refreshAll();

  // Periodically refresh detected tabs while popup is open
  setInterval(refreshDetectedTabs, 3000);
}

/**
 * Setup static DOM listeners
 */
function setupEventListeners() {
  btnRefresh.addEventListener('click', async () => {
    btnRefresh.classList.add('spinning');
    setTimeout(() => btnRefresh.classList.remove('spinning'), 600);
    try {
      // Trigger active self-healing reconciliation across runtime
      await chrome.runtime.sendMessage(createMessage(
        MessageTypes.RECONCILE_RUNTIME,
        MessageTargets.SERVICE_WORKER,
        { reason: 'user_refresh_button' }
      ));
    } catch (_) {}
    await refreshAll();
  });

  btnToggleDiagnostics.addEventListener('click', () => {
    if (diagnosticsDrawer) {
      diagnosticsDrawer.open = !diagnosticsDrawer.open;
      btnToggleDiagnostics.classList.toggle('active', diagnosticsDrawer.open);
      if (diagnosticsDrawer.open) {
        renderDiagnosticsMetrics();
        diagnosticsDrawer.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  });

  if (diagnosticsDrawer) {
    diagnosticsDrawer.addEventListener('toggle', () => {
      btnToggleDiagnostics.classList.toggle('active', diagnosticsDrawer.open);
      if (diagnosticsDrawer.open) renderDiagnosticsMetrics();
    });
  }

  if (btnDismissError) {
    btnDismissError.addEventListener('click', hideError);
  }

  btnCopyDiagReport.addEventListener('click', handleCopyDiagnosticsReport);
  btnClearDiagLogs.addEventListener('click', handleClearDiagnosticsLogs);

  // Global Auto-Balance Toggle
  btnGlobalAuto.addEventListener('click', () => {
    const nextState = !currentSnapshot.globalSettings.globalAutoEnabled;
    setGlobalAuto(nextState);
  });

  // Listening Level Segmented Control
  levelButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const levelId = btn.dataset.level;
      const levelObj = ListeningLevels.find((l) => l.id === levelId);
      if (levelObj) {
        setListeningLevel(levelObj.targetLufs);
      }
    });

    // Keyboard navigation for segmented radio buttons
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = btn.nextElementSibling || levelButtons[0];
        next.focus();
        next.click();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = btn.previousElementSibling || levelButtons[levelButtons.length - 1];
        prev.focus();
        prev.click();
      }
    });
  });
}

/**
 * Full refresh: queries SW coordinator snapshot and browser tabs
 */
async function refreshAll() {
  await Promise.all([
    queryCoordinatorSnapshot(),
    refreshDetectedTabs()
  ]);
  renderUI();
}

/**
 * Fetch Coordinator state snapshot from Service Worker (Section 6 & 16)
 */
async function queryCoordinatorSnapshot() {
  try {
    const res = await chrome.runtime.sendMessage(createMessage(
      MessageTypes.GET_PRODUCT_SNAPSHOT,
      MessageTargets.SERVICE_WORKER
    ));

    if (res && res.globalSettings) {
      if (!currentSnapshot.revision || res.revision === undefined || res.revision >= currentSnapshot.revision) {
        currentSnapshot = res;
      }
    }
  } catch (err) {
    logger.warn('Failed to get product snapshot, trying fallback GET_COORDINATOR_SNAPSHOT', { error: err.message });
    try {
      const fallback = await chrome.runtime.sendMessage(createMessage(
        MessageTypes.GET_COORDINATOR_SNAPSHOT,
        MessageTargets.SERVICE_WORKER
      ));
      if (fallback && fallback.globalSettings) {
        currentSnapshot = fallback;
      }
    } catch (_) {}
  }
}

/**
 * Query browser for audible tabs and active tab
 */
async function refreshDetectedTabs() {
  try {
    const urlParams = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : null;
    const overrideTabId = urlParams?.get('tabId') ? Number(urlParams.get('tabId')) : null;

    const [audibleTabs, activeTabs] = await Promise.all([
      chrome.tabs.query({ audible: true }),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);

    if (overrideTabId) {
      try {
        activeTabInfo = await chrome.tabs.get(overrideTabId);
      } catch (_) {
        activeTabInfo = activeTabs?.[0] || null;
      }
    } else if (activeTabs && activeTabs.length > 0) {
      activeTabInfo = activeTabs[0];
      // If popup was opened as a full tab in test/dev inspection, find the underlying target web tab
      if (activeTabInfo?.url?.startsWith('chrome-extension://')) {
        const windowTabs = await chrome.tabs.query({ currentWindow: true }).catch(() => []);
        const targetWebTab = windowTabs.find((t) => t.id !== activeTabInfo.id && !t.url?.startsWith('chrome-extension://'));
        if (targetWebTab) {
          activeTabInfo = targetWebTab;
        }
      }
    }

    // Combine audible tabs and the current active tab
    const tabMap = new Map();
    (audibleTabs || []).forEach((t) => tabMap.set(t.id, t));
    if (activeTabInfo && !tabMap.has(activeTabInfo.id)) {
      tabMap.set(activeTabInfo.id, activeTabInfo);
    }

    detectedAudibleTabs = Array.from(tabMap.values());
    renderUI();
  } catch (err) {
    logger.warn('Failed to query browser tabs', { error: err.message });
  }
}

/**
 * Render all UI components
 */
function renderUI() {
  renderMasterControls();
  renderCurrentTab();
  renderManagedTabs();
  renderDetectedTabs();
  renderDiagnosticsMetrics();
}

/**
 * Render Master controls (Global toggle and Level Selector)
 */
function renderMasterControls() {
  const isGlobalAuto = Boolean(currentSnapshot.globalSettings?.globalAutoEnabled);
  btnGlobalAuto.setAttribute('aria-checked', isGlobalAuto ? 'true' : 'false');

  const currentTarget = currentSnapshot.globalSettings?.globalTargetLufs ?? -18.0;
  const activeLevel = getListeningLevelByTarget(currentTarget);

  levelButtons.forEach((btn) => {
    const isActive = btn.dataset.level === activeLevel.id;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

/**
 * Render Current Active Tab section (RA-2)
 */
function renderCurrentTab() {
  if (!currentTabContainer) return;

  if (!activeTabInfo) {
    currentTabContainer.innerHTML = `
      <div class="empty-state">
        <p>No active tab detected.</p>
      </div>
    `;
    return;
  }

  const isManaged = (currentSnapshot.managedTabs || []).some((t) => t.tabId === activeTabInfo.id);

  if (isManaged) {
    const managedTab = currentSnapshot.managedTabs.find((t) => t.tabId === activeTabInfo.id);
    currentTabContainer.innerHTML = '';
    const card = createManagedTabCard(managedTab, { isCurrentTab: true });
    currentTabContainer.appendChild(card);
    return;
  }

  // Current tab is unmanaged - check support
  const urlCheck = checkUrlSupport(activeTabInfo.url);
  currentTabContainer.innerHTML = '';

  if (!urlCheck.supported) {
    const card = document.createElement('div');
    card.className = 'tab-card current-unsupported-card';
    card.id = `current-card-${activeTabInfo.id}`;

    const faviconHtml = activeTabInfo.favIconUrl
      ? `<img class="tab-favicon" src="${escapeHtml(activeTabInfo.favIconUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('🔒'))" />`
      : `<span class="tab-favicon-fallback" aria-hidden="true">🔒</span>`;

    card.innerHTML = `
      <div class="tab-header">
        <div class="tab-identity">
          ${faviconHtml}
          <div class="tab-title-group">
            <div class="tab-title" title="${escapeHtml(activeTabInfo.title)}">${escapeHtml(activeTabInfo.title || 'Browser Page')}</div>
            <div class="tab-url" title="${escapeHtml(activeTabInfo.url)}">${escapeHtml(formatDisplayUrl(activeTabInfo.url))}</div>
          </div>
        </div>
        <span class="status-badge badge-muted">Unsupported</span>
      </div>
      <div class="unsupported-callout">
        <span class="unsupported-title">This browser page cannot be captured.</span>
        <span class="unsupported-desc">${escapeHtml(urlCheck.reason || 'Browser security restrictions prevent capturing this page.')}</span>
      </div>
    `;
    currentTabContainer.appendChild(card);
    return;
  }

  // Supported, unmanaged current tab
  const card = document.createElement('div');
  card.className = 'tab-card current-ready-card';
  card.id = `current-card-${activeTabInfo.id}`;

  const faviconHtml = activeTabInfo.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(activeTabInfo.favIconUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('🔊'))" />`
    : `<span class="tab-favicon-fallback" aria-hidden="true">🔊</span>`;

  card.innerHTML = `
    <div class="tab-header">
      <div class="tab-identity">
        ${faviconHtml}
        <div class="tab-title-group">
          <div class="tab-title" title="${escapeHtml(activeTabInfo.title)}">${escapeHtml(activeTabInfo.title || 'Current Tab')}</div>
          <div class="tab-url" title="${escapeHtml(activeTabInfo.url)}">${escapeHtml(formatDisplayUrl(activeTabInfo.url))}</div>
        </div>
      </div>
      <span class="status-badge ${activeTabInfo.audible ? 'badge-info' : 'badge-muted'}">
        ${activeTabInfo.audible ? 'Playing' : 'Ready'}
      </span>
    </div>
    <div class="current-tab-actions">
      <button class="btn btn-primary btn-block" id="btn-balance-${activeTabInfo.id}">
        Balance This Tab
      </button>
      <span class="tab-action-hint">Click to start smart loudness normalization for this tab.</span>
    </div>
  `;

  const btnBalance = card.querySelector(`#btn-balance-${activeTabInfo.id}`);
  if (btnBalance) {
    btnBalance.addEventListener('click', () => {
      btnBalance.disabled = true;
      btnBalance.textContent = 'Connecting...';
      handleStartCapture(activeTabInfo.id);
    });
  }

  currentTabContainer.appendChild(card);
}

/**
 * Render Managed Tabs Card Deck (Balanced Tabs)
 */
function renderManagedTabs() {
  const managedTabs = currentSnapshot.managedTabs || [];
  managedCountBadge.textContent = String(managedTabs.length);

  // Tabs shown under Balanced Tabs are other balanced tabs (not activeTab if shown in Current Tab)
  const otherManagedTabs = managedTabs.filter((t) => t.tabId !== activeTabInfo?.id);

  if (managedTabs.length === 0) {
    managedTabsContainer.innerHTML = `
      <div class="empty-state">
        <p>No tabs currently balanced.</p>
        <p class="empty-hint">Use "Balance This Tab" above to balance the current tab.</p>
      </div>
    `;
    return;
  }

  if (otherManagedTabs.length === 0) {
    managedTabsContainer.innerHTML = `
      <div class="empty-state">
        <p>No other tabs currently balanced.</p>
        <p class="empty-hint">Switch to another audio tab below to balance it too.</p>
      </div>
    `;
    return;
  }

  managedTabsContainer.innerHTML = '';
  otherManagedTabs.forEach((tab) => {
    const card = createManagedTabCard(tab);
    managedTabsContainer.appendChild(card);
  });
}

/**
 * Create DOM card for a managed tab
 */
function createManagedTabCard(tab, options = {}) {
  const card = document.createElement('div');
  card.className = 'tab-card';
  card.id = `managed-card-${tab.tabId}`;

  const status = presentTabStatus(tab);
  const offsetVal = typeof tab.manualOffsetDb === 'number' ? tab.manualOffsetDb : (tab.relativeOffsetDb ?? 0.0);
  const formattedRelative = formatRelativeLevel(offsetVal);

  const faviconHtml = tab.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('🔊'))" />`
    : `<span class="tab-favicon-fallback" aria-hidden="true">🔊</span>`;

  const activePill = options.isCurrentTab ? `<span class="current-tab-badge">Active Tab</span>` : '';

  card.innerHTML = `
    <div class="tab-header">
      <div class="tab-identity">
        ${faviconHtml}
        <div class="tab-title-group">
          <div class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title || 'Untitled Tab')}</div>
          <div class="tab-url" title="${escapeHtml(tab.url)}">${escapeHtml(formatDisplayUrl(tab.url))}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        ${activePill}
        <span class="status-badge ${status.badgeClass}" title="${escapeHtml(status.tooltip)}">${status.badgeText}</span>
      </div>
    </div>

    <div class="tab-controls-block">
      <div class="slider-group">
        <div class="slider-header">
          <label class="slider-label" for="slider-${tab.tabId}">Relative Level</label>
          <span class="gain-val-chip" id="val-${tab.tabId}">${formattedRelative}</span>
        </div>
        <div class="slider-container" title="Double click to reset to 0 dB (Normal)">
          <input
            type="range"
            class="volume-slider"
            id="slider-${tab.tabId}"
            min="-12"
            max="12"
            step="0.5"
            value="${offsetVal}"
            aria-label="Relative level for ${escapeHtml(tab.title)}"
            aria-valuemin="-12"
            aria-valuemax="12"
            aria-valuenow="${offsetVal}"
          />
        </div>
        <div class="relative-level-legend">
          <span>Quieter</span>
          <span>Normal</span>
          <span>Louder</span>
        </div>
      </div>

      <div class="tab-actions-row">
        <label class="tab-auto-toggle">
          <button
            class="switch"
            id="tab-auto-${tab.tabId}"
            role="switch"
            aria-checked="${tab.normalizationEnabled ? 'true' : 'false'}"
            aria-label="Toggle auto balance for ${escapeHtml(tab.title)}"
          >
            <span class="switch-handle"></span>
          </button>
          <span>Auto Balance</span>
        </label>

        <button class="btn btn-danger-outline" id="btn-release-${tab.tabId}" title="Stop balancing and return audio control to browser">
          Release
        </button>
      </div>
    </div>
  `;

  // Bind Card Interactions
  const slider = card.querySelector(`#slider-${tab.tabId}`);
  const valChip = card.querySelector(`#val-${tab.tabId}`);
  const autoSwitch = card.querySelector(`#tab-auto-${tab.tabId}`);
  const releaseBtn = card.querySelector(`#btn-release-${tab.tabId}`);

  slider.addEventListener('pointerdown', () => { activeDragTabId = tab.tabId; });
  slider.addEventListener('pointerup', () => { activeDragTabId = null; });

  slider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    valChip.textContent = formatRelativeLevel(val);
    slider.setAttribute('aria-valuenow', String(val));
    setTabManualOffset(tab.tabId, val);
  });

  // Double click resets to 0.0 dB (Normal)
  slider.addEventListener('dblclick', () => {
    slider.value = '0';
    valChip.textContent = formatRelativeLevel(0);
    slider.setAttribute('aria-valuenow', '0');
    setTabManualOffset(tab.tabId, 0);
  });

  autoSwitch.addEventListener('click', () => {
    const next = !tab.normalizationEnabled;
    autoSwitch.setAttribute('aria-checked', next ? 'true' : 'false');
    setTabNormalization(tab.tabId, next);
  });

  releaseBtn.addEventListener('click', () => {
    releaseBtn.disabled = true;
    handleStopCapture(tab.tabId);
  });

  return card;
}

/**
 * Render Detected / Audible Tabs Section (Other Audio Tabs)
 */
function renderDetectedTabs() {
  const managedTabIds = new Set((currentSnapshot.managedTabs || []).map((t) => t.tabId));
  const unmanagedDetected = detectedAudibleTabs.filter((t) => !managedTabIds.has(t.id) && t.id !== activeTabInfo?.id);

  detectedCountBadge.textContent = String(unmanagedDetected.length);

  if (unmanagedDetected.length === 0) {
    detectedTabsContainer.innerHTML = `
      <div class="empty-state">
        <p>No other audio tabs found.</p>
      </div>
    `;
    return;
  }

  detectedTabsContainer.innerHTML = '';
  unmanagedDetected.forEach((tab) => {
    const card = createDetectedTabCard(tab);
    detectedTabsContainer.appendChild(card);
  });
}

/**
 * Create DOM card for a background audio tab (RA-2)
 */
function createDetectedTabCard(tab) {
  const card = document.createElement('div');
  card.className = 'detected-card tab-card detected-card-row';
  card.id = `detected-card-${tab.id}`;

  const faviconHtml = tab.favIconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('🎵'))" />`
    : `<span class="tab-favicon-fallback" aria-hidden="true">🎵</span>`;

  card.innerHTML = `
    <div class="tab-header">
      <div class="tab-identity">
        ${faviconHtml}
        <div class="tab-title-group">
          <div class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title || 'Untitled Tab')}</div>
          <div class="tab-url" title="${escapeHtml(tab.url)}">${escapeHtml(formatDisplayUrl(tab.url))}</div>
        </div>
      </div>
      <span class="status-badge badge-muted">Not enabled</span>
    </div>
    <div class="detected-actions-row">
      <button class="btn btn-secondary btn-sm" id="btn-switch-${tab.id}">
        Switch to Tab
      </button>
      <span class="tab-switch-hint">Enable WebAudioBalance after switching to this tab.</span>
    </div>
  `;

  const btnSwitch = card.querySelector(`#btn-switch-${tab.id}`);
  if (btnSwitch) {
    btnSwitch.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true }, () => {
        if (typeof window !== 'undefined' && window.close) {
          window.close();
        }
      });
    });
  }

  return card;
}

/**
 * Capture invocation with user authorization check & error classification (RA-1 & RA-2)
 */
async function handleStartCapture(tabId) {
  logger.info('Initiating tab balance from popup', { tabId, activeTabId: activeTabInfo?.id });
  hideError();

  // RA-1: A tab may enter first-time capture only when extension has valid user invocation on target tab
  if (activeTabInfo && tabId !== activeTabInfo.id) {
    const msg = 'Open this tab and enable WebAudioBalance from that tab before balancing it.';
    logger.warn('Attempted remote first-time balance on background tab', { tabId, activeTabId: activeTabInfo.id });
    showError(msg);
    return;
  }

  const url = activeTabInfo?.url || '';
  const urlCheck = checkUrlSupport(url);
  if (!urlCheck.supported) {
    const msg = 'This browser page cannot be captured.';
    logger.warn('Attempted capture on unsupported page', { tabId, url, reason: urlCheck.reason });
    showError(msg);
    return;
  }

  const btnBalance = document.getElementById(`btn-balance-${tabId}`);
  if (btnBalance) {
    btnBalance.disabled = true;
    btnBalance.textContent = 'Connecting...';
  }

  try {
    let streamId = null;
    try {
      streamId = await new Promise((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!id) {
            reject(new Error('Empty stream ID received'));
          } else {
            resolve(id);
          }
        });
      });
      logger.info('Acquired stream ID under popup gesture', { tabId, streamIdPresent: Boolean(streamId) });
    } catch (gestureErr) {
      logger.error('Could not acquire stream ID directly in popup gesture', { error: gestureErr.message });
      const failure = classifyFailure(gestureErr, { tabId, url });
      showError(failure.userMessage);
      if (btnBalance) {
        btnBalance.disabled = false;
        btnBalance.textContent = 'Balance This Tab';
      }
      return;
    }

    const response = await chrome.runtime.sendMessage(createMessage(
      MessageTypes.START_CAPTURE,
      MessageTargets.SERVICE_WORKER,
      { tabId, streamId }
    ));

    if (response && response.success) {
      logger.info('Start capture successfully processed', { tabId });
      hideError();
    } else {
      const runtimeErr = response?.error;
      const failure = classifyFailure(runtimeErr, { tabId, url });
      logger.error('Start capture returned error', response);
      showError(failure.userMessage);
    }
  } catch (err) {
    logger.error('handleStartCapture exception', { error: err.message });
    const failure = classifyFailure(err, { tabId, url });
    showError(failure.userMessage);
  } finally {
    setTimeout(refreshAll, 300);
  }
}

/**
 * Stop capture invocation
 */
async function handleStopCapture(tabId) {
  logger.info('Stopping tab balance from popup', { tabId });
  try {
    await chrome.runtime.sendMessage(createMessage(
      MessageTypes.STOP_CAPTURE,
      MessageTargets.SERVICE_WORKER,
      { tabId }
    ));
  } catch (err) {
    logger.error('handleStopCapture exception', { error: err.message });
  } finally {
    setTimeout(refreshAll, 300);
  }
}

/**
 * Global Auto Toggle
 */
async function setGlobalAuto(enabled) {
  currentSnapshot.globalSettings.globalAutoEnabled = enabled;
  renderMasterControls();

  logger.info('Setting global auto balance', { enabled });
  try {
    await chrome.runtime.sendMessage(createMessage(
      MessageTypes.SET_GLOBAL_AUTO,
      MessageTargets.SERVICE_WORKER,
      { enabled }
    ));
  } catch (err) {
    logger.error('Failed to set global auto', { error: err.message });
  }
}

/**
 * Listening Level
 */
async function setListeningLevel(targetLufs) {
  currentSnapshot.globalSettings.globalTargetLufs = targetLufs;
  renderMasterControls();

  logger.info('Setting listening level target', { targetLufs });
  try {
    await chrome.runtime.sendMessage(createMessage(
      MessageTypes.SET_GLOBAL_TARGET,
      MessageTargets.SERVICE_WORKER,
      { targetLufs }
    ));
  } catch (err) {
    logger.error('Failed to set global target LUFS', { error: err.message });
  }
}

/**
 * Per-Tab Manual Offset
 */
let debounceOffsetTimers = new Map();
function setTabManualOffset(tabId, offsetDb) {
  // Update local snapshot immediately
  const tab = currentSnapshot.managedTabs?.find((t) => t.tabId === tabId);
  if (tab) {
    tab.manualOffsetDb = offsetDb;
    tab.effectiveGainDb = tab.autoGainDb + offsetDb;
  }

  // Debounce sending to audio plane to avoid IPC spam during rapid slider dragging
  if (debounceOffsetTimers.has(tabId)) {
    clearTimeout(debounceOffsetTimers.get(tabId));
  }

  debounceOffsetTimers.set(tabId, setTimeout(async () => {
    try {
      const res = await chrome.runtime.sendMessage(createMessage(
        MessageTypes.SET_TAB_OFFSET,
        MessageTargets.SERVICE_WORKER,
        { tabId, gainDb: offsetDb, offsetDb, relativeOffsetDb: offsetDb }
      ));
      if (res && !res.success) {
        logger.error('Failed to set tab offset', res.error);
        refreshAll();
      }
    } catch (err) {
      logger.error('Failed to send SET_TAB_OFFSET', { tabId, error: err.message });
    }
  }, 40));
}

/**
 * Per-Tab Auto Balance Toggle
 */
async function setTabNormalization(tabId, enabled) {
  const tab = currentSnapshot.managedTabs?.find((t) => t.tabId === tabId);
  if (tab) {
    tab.normalizationEnabled = enabled;
    // Re-render card status badge
    const card = document.getElementById(`managed-card-${tabId}`);
    if (card) {
      const badge = card.querySelector('.status-badge');
      if (badge) {
        const status = presentTabStatus(tab);
        badge.className = `status-badge ${status.badgeClass}`;
        badge.textContent = status.badgeText;
        badge.title = status.tooltip;
      }
    }
  }

  logger.info('Setting tab normalization toggle', { tabId, enabled });
  try {
    const res = await chrome.runtime.sendMessage(createMessage(
      MessageTypes.SET_NORMALIZATION,
      MessageTargets.SERVICE_WORKER,
      { tabId, normalizationEnabled: enabled }
    ));
    if (res && !res.success) {
      logger.error('Failed to set tab normalization', res.error);
      refreshAll();
    }
  } catch (err) {
    logger.error('Failed to set tab normalization', { tabId, error: err.message });
  }
}

/**
 * Real-time Runtime Telemetry Update
 */
function handleMetricsUpdate(metrics) {
  if (!metrics || !metrics.tabId) return;

  const tab = currentSnapshot.managedTabs?.find((t) => t.tabId === metrics.tabId);
  if (tab) {
    const incomingSeq = metrics.measurementSequence ?? metrics.metricsSequence;
    const currentSeq = tab.audio?.metricsSequence ?? tab.metricsSequence;
    if (incomingSeq !== undefined && currentSeq !== undefined && incomingSeq < currentSeq) {
      return;
    }

    Object.assign(tab, metrics);
    if (tab.audio) {
      Object.assign(tab.audio, metrics);
    }
    if (tab.runtime) {
      const activeVal = metrics.active !== undefined ? metrics.active : metrics.isActive;
      if (activeVal !== undefined) tab.runtime.active = Boolean(activeVal);
      const limitedVal = metrics.limited !== undefined ? metrics.limited : metrics.isLimited;
      if (limitedVal !== undefined) tab.runtime.limited = Boolean(limitedVal);
      const frozenVal = metrics.frozen !== undefined ? metrics.frozen : metrics.isFrozen;
      if (frozenVal !== undefined) tab.runtime.frozen = Boolean(frozenVal);
      if (metrics.limitReason !== undefined) tab.runtime.limitReason = metrics.limitReason;
      if (metrics.captured !== undefined) tab.runtime.captured = metrics.captured;
    }

    const card = document.getElementById(`managed-card-${metrics.tabId}`);
    if (card) {
      // Update badge
      const badge = card.querySelector('.status-badge');
      if (badge) {
        const status = presentTabStatus(tab);
        badge.className = `status-badge ${status.badgeClass}`;
        badge.textContent = status.badgeText;
        badge.title = status.tooltip;
      }

      // Update slider if user is not actively dragging it
      if (activeDragTabId !== metrics.tabId) {
        const slider = card.querySelector(`#slider-${metrics.tabId}`);
        const valChip = card.querySelector(`#val-${metrics.tabId}`);
        const currentOffset = typeof tab.relativeOffsetDb === 'number' ? tab.relativeOffsetDb : (tab.manualOffsetDb ?? 0.0);
        if (slider && Math.abs(Number(slider.value) - currentOffset) > 0.05) {
          slider.value = String(currentOffset);
          if (valChip) {
            valChip.textContent = formatRelativeLevel(currentOffset);
          }
        }
      }
    }
  }

  // Refresh live diagnostics metrics if drawer is open
  renderDiagnosticsMetrics();
}

/**
 * Render real-time canonical diagnostics metrics (Section 12)
 */
function renderDiagnosticsMetrics() {
  if (!diagnosticsDrawer || !diagnosticsDrawer.open || !diagnosticsMetrics) return;
  const managed = currentSnapshot.managedTabs || [];

  if (managed.length === 0) {
    diagnosticsMetrics.innerHTML = `
      <div class="diag-metric-row">
        <span class="diag-metric-label">Status</span>
        <span class="diag-metric-val">No active audio engines</span>
      </div>
      <div class="diag-metric-row">
        <span class="diag-metric-label">Product Revision</span>
        <span class="diag-metric-val">r${currentSnapshot.revision || 0}</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const tab of managed) {
    const audio = tab.audio || {};
    const runtime = tab.runtime || {};
    const offset = typeof tab.relativeOffsetDb === 'number' ? tab.relativeOffsetDb : (tab.manualOffsetDb ?? 0.0);

    html += `
      <div class="diag-metric-row"><span class="diag-metric-label">Tab ID</span><span class="diag-metric-val">${tab.tabId}</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Engine / AudioContext</span><span class="diag-metric-val">${runtime.engineState || 'IDLE'} / ${runtime.audioContextState || 'closed'}</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Active / Frozen / Limited</span><span class="diag-metric-val">${runtime.active} / ${runtime.frozen} / ${runtime.limited} (${runtime.limitReason || 'none'})</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Input LUFS (M / S)</span><span class="diag-metric-val">${(audio.inputMomentaryLufs ?? -100).toFixed(1)} / ${(audio.inputShortTermLufs ?? -100).toFixed(1)} LUFS</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Output LUFS (M / S)</span><span class="diag-metric-val">${(audio.outputMomentaryLufs ?? -100).toFixed(1)} / ${(audio.outputShortTermLufs ?? -100).toFixed(1)} LUFS</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Target / Target Error</span><span class="diag-metric-val">${(audio.effectiveTargetLufs ?? -18).toFixed(1)} LUFS / ${audio.outputTargetErrorLu !== null ? audio.outputTargetErrorLu + ' LU' : 'N/A'}</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Relative Offset / Applied Gain</span><span class="diag-metric-val">${offset.toFixed(1)} dB / ${(audio.appliedGainDb ?? 0).toFixed(1)} dB</span></div>
      <div class="diag-metric-row"><span class="diag-metric-label">Revision / Sequence</span><span class="diag-metric-val">r${currentSnapshot.revision || 0} / #${audio.metricsSequence || 0}</span></div>
      ${runtime.lastRuntimeError ? `<div class="diag-metric-row" style="color:var(--danger)"><span class="diag-metric-label">Last Error</span><span class="diag-metric-val">${runtime.lastRuntimeError.code || runtime.lastRuntimeError.message}</span></div>` : ''}
    `;
  }
  diagnosticsMetrics.innerHTML = html;
}

/**
 * Diagnostics and Logging
 */
function renderLogs() {
  if (!diagnosticsLog) return;
  const logs = getStoredLogs();
  diagnosticsLog.innerHTML = '';
  logs.forEach(appendLogToView);
}

function appendLogToView(entry) {
  if (!diagnosticsLog || !entry) return;
  const line = document.createElement('div');
  line.className = `diag-log-line diag-log-${entry.level}`;
  const time = entry.timestamp ? entry.timestamp.split('T')[1]?.replace('Z', '') : '';
  line.textContent = `[${time}] [${entry.context}] ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ''}`;
  diagnosticsLog.appendChild(line);
  diagnosticsLog.scrollTop = diagnosticsLog.scrollHeight;
}

function handleClearDiagnosticsLogs() {
  clearStoredLogs();
  if (diagnosticsLog) {
    diagnosticsLog.innerHTML = '';
  }
}

async function handleCopyDiagnosticsReport() {
  const env = getBrowserInfo();
  const report = {
    generatedAt: new Date().toISOString(),
    environment: env,
    snapshot: currentSnapshot,
    audibleTabs: detectedAudibleTabs.map((t) => ({ id: t.id, title: t.title, url: t.url, audible: t.audible })),
    logs: getStoredLogs()
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    alert('Diagnostics report copied to clipboard!');
  } catch (err) {
    logger.error('Failed to copy diagnostics report', { error: err.message });
  }
}

/**
 * Formatting Utilities
 */
function formatDisplayUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch (_) {
    return rawUrl;
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Chrome Runtime Message Dispatcher
 */
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  const { type, payload } = message;

  switch (type) {
    case MessageTypes.LOG_ENTRY:
      if (payload && payload.entry) {
        appendLogToView(payload.entry);
      }
      break;

    case MessageTypes.AUDIO_TELEMETRY:
    case MessageTypes.METRICS_UPDATE:
      handleMetricsUpdate(payload);
      break;

    case MessageTypes.PRODUCT_SNAPSHOT_CHANGED:
    case MessageTypes.COORDINATOR_SNAPSHOT:
      if (payload && payload.globalSettings) {
        if (!currentSnapshot.revision || payload.revision === undefined || payload.revision >= currentSnapshot.revision) {
          currentSnapshot = payload;
          renderUI();
        }
      }
      break;

    case MessageTypes.CAPTURE_STARTED:
    case MessageTypes.CAPTURE_STOPPED:
    case MessageTypes.CAPTURE_ERROR:
    case MessageTypes.AUDIO_RUNTIME_LIFECYCLE:
      setTimeout(refreshAll, 150);
      break;

    default:
      break;
  }
});

// Run Init
init();

// Test harness inspection interface
if (typeof window !== 'undefined') {
  window.__wabTest = {
    getSnapshot: () => currentSnapshot,
    setSnapshot: (s) => { currentSnapshot = s; renderUI(); },
    handleMetricsUpdate,
    renderUI,
    showError,
    hideError,
    checkUrlSupport,
    presentTabStatus
  };
}
