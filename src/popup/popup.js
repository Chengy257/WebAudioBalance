/**
 * WebAudioBalance P0 Feasibility Harness - Popup Controller
 */

import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger, getBrowserInfo, getStoredLogs, clearStoredLogs } from '../shared/logger.js';

const logger = new StructuredLogger('PopupUI');

let currentTab = null;
let activeSessions = [];

// DOM Elements
const envInfoEl = document.getElementById('envInfo');
const currentTabIdEl = document.getElementById('currentTabId');
const currentTabTitleEl = document.getElementById('currentTabTitle');
const currentTabAudibleEl = document.getElementById('currentTabAudible');
const btnEnableCapture = document.getElementById('btnEnableCapture');
const btnStopCapture = document.getElementById('btnStopCapture');
const gainSlider = document.getElementById('gainSlider');
const gainValueDisplay = document.getElementById('gainValueDisplay');
const activeStreamsContainer = document.getElementById('activeStreamsContainer');
const btnRefreshState = document.getElementById('btnRefreshState');
const btnCopyReport = document.getElementById('btnCopyReport');
const btnClearLogs = document.getElementById('btnClearLogs');
const logViewer = document.getElementById('logViewer');

// Initialize Popup
async function init() {
  const env = getBrowserInfo();
  envInfoEl.textContent = `${env.browser} ${env.version}`;
  logger.info('Popup initialized', { env });

  // Get current active tab
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      currentTab = tabs[0];
      currentTabIdEl.textContent = currentTab.id;
      currentTabTitleEl.textContent = currentTab.title || currentTab.url || 'No title';
      currentTabTitleEl.title = currentTab.title || currentTab.url || '';
      updateAudibleBadge(currentTab.audible);
    }
  } catch (err) {
    logger.error('Failed to query current tab', { error: err.message });
  }

  // Bind Event Listeners
  btnEnableCapture.addEventListener('click', handleEnableCapture);
  btnStopCapture.addEventListener('click', handleStopCapture);
  btnRefreshState.addEventListener('click', refreshRuntimeState);
  btnCopyReport.addEventListener('click', handleCopyReport);
  btnClearLogs.addEventListener('click', handleClearLogs);

  // Gain Presets
  document.querySelectorAll('.gain-preset').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const gain = Number(e.target.dataset.gain);
      setGain(gain);
    });
  });

  // Gain Slider
  gainSlider.addEventListener('input', (e) => {
    const gain = Number(e.target.value);
    gainValueDisplay.textContent = `${gain > 0 ? '+' : ''}${gain} dB`;
  });

  gainSlider.addEventListener('change', (e) => {
    const gain = Number(e.target.value);
    setGain(gain);
  });

  // Load existing logs into view
  renderExistingLogs();

  // Query initial runtime state from Service Worker / Offscreen
  refreshRuntimeState();
}

function updateAudibleBadge(isAudible) {
  if (isAudible) {
    currentTabAudibleEl.textContent = 'Audible';
    currentTabAudibleEl.classList.add('active');
  } else {
    currentTabAudibleEl.textContent = 'Silent';
    currentTabAudibleEl.classList.remove('active');
  }
}

async function handleEnableCapture() {
  if (!currentTab) return;
  btnEnableCapture.disabled = true;
  logger.info('User requested capture start', { tabId: currentTab.id });

  try {
    const response = await chrome.runtime.sendMessage(createMessage(
      MessageTypes.START_CAPTURE,
      MessageTargets.SERVICE_WORKER,
      { tabId: currentTab.id }
    ));

    if (response && response.success) {
      logger.info('Capture request succeeded from SW', { tabId: currentTab.id });
    } else {
      logger.error('Capture request returned failure', response);
      alert(`Capture failed: ${response?.error || 'Unknown error'}`);
    }
  } catch (err) {
    logger.error('Error invoking START_CAPTURE', { error: err.message });
    alert(`Capture invocation error: ${err.message}`);
  } finally {
    setTimeout(refreshRuntimeState, 300);
  }
}

async function handleStopCapture() {
  if (!currentTab) return;
  btnStopCapture.disabled = true;
  logger.info('User requested capture stop', { tabId: currentTab.id });

  try {
    await chrome.runtime.sendMessage(createMessage(
      MessageTypes.STOP_CAPTURE,
      MessageTargets.SERVICE_WORKER,
      { tabId: currentTab.id }
    ));
  } catch (err) {
    logger.error('Error invoking STOP_CAPTURE', { error: err.message });
  } finally {
    setTimeout(refreshRuntimeState, 300);
  }
}

async function setGain(gainDb) {
  if (!currentTab) return;
  gainSlider.value = gainDb;
  gainValueDisplay.textContent = `${gainDb > 0 ? '+' : ''}${gainDb} dB`;

  logger.info('Sending SET_TEST_GAIN', { tabId: currentTab.id, gainDb });
  try {
    await chrome.runtime.sendMessage(createMessage(
      MessageTypes.SET_TEST_GAIN,
      MessageTargets.SERVICE_WORKER,
      { tabId: currentTab.id, gainDb }
    ));
  } catch (err) {
    logger.error('Failed to send SET_TEST_GAIN', { error: err.message });
  }
}

async function refreshRuntimeState() {
  try {
    const res = await chrome.runtime.sendMessage(createMessage(
      MessageTypes.QUERY_RUNTIME_STATE,
      MessageTargets.SERVICE_WORKER
    ));

    if (res && Array.isArray(res.activeStreams)) {
      activeSessions = res.activeStreams;
      renderStreams();
      updateCurrentTabControls();
    }
  } catch (err) {
    logger.warn('Failed to query runtime state', { error: err.message });
  }
}

function updateCurrentTabControls() {
  if (!currentTab) return;
  const isCaptured = activeSessions.some((s) => s.tabId === currentTab.id && s.captureStatus === 'RUNNING');
  btnEnableCapture.disabled = isCaptured;
  btnStopCapture.disabled = !isCaptured;

  const currentSession = activeSessions.find((s) => s.tabId === currentTab.id);
  if (currentSession) {
    gainSlider.value = currentSession.testGainDb;
    gainValueDisplay.textContent = `${currentSession.testGainDb > 0 ? '+' : ''}${currentSession.testGainDb} dB`;
  }
}

function renderStreams() {
  if (!activeSessions || activeSessions.length === 0) {
    activeStreamsContainer.innerHTML = '<div class="empty-hint">No active capture sessions</div>';
    return;
  }

  activeStreamsContainer.innerHTML = '';
  activeSessions.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'stream-card';
    card.id = `stream-card-${s.tabId}`;

    // Meter percentage calculation (-60 dBFS to 0 dBFS)
    const meterPct = Math.max(0, Math.min(100, ((s.rmsDbFS + 60) / 60) * 100));

    card.innerHTML = `
      <div class="stream-card-header">
        <strong>Tab ${s.tabId}</strong>
        <span class="status-tag ${s.captureStatus === 'RUNNING' ? 'active' : ''}">${s.captureStatus}</span>
      </div>
      <div class="stream-meter">
        <div class="stream-meter-bar" id="meter-bar-${s.tabId}" style="width: ${meterPct}%"></div>
      </div>
      <div class="stream-meta-row">
        <span>Level: <span id="level-val-${s.tabId}">${s.rmsDbFS} dBFS</span></span>
        <span>Gain: ${s.testGainDb > 0 ? '+' : ''}${s.testGainDb} dB</span>
      </div>
      <div class="stream-meta-row" style="margin-top: 4px;">
        <span>Ctx: ${s.audioContextState}</span>
        <span>Track: ${s.trackReadyState}</span>
      </div>
    `;
    activeStreamsContainer.appendChild(card);
  });
}

function renderExistingLogs() {
  const logs = getStoredLogs();
  logViewer.innerHTML = '';
  logs.forEach(appendLogToUI);
}

function appendLogToUI(entry) {
  if (!entry) return;
  const line = document.createElement('div');
  line.className = `log-line log-${entry.level}`;
  const time = entry.timestamp ? entry.timestamp.split('T')[1].replace('Z', '') : '';
  line.textContent = `[${time}] [${entry.context}] ${entry.message} ${entry.data ? JSON.stringify(entry.data) : ''}`;
  logViewer.appendChild(line);
  logViewer.scrollTop = logViewer.scrollHeight;
}

function handleClearLogs() {
  clearStoredLogs();
  logViewer.innerHTML = '';
}

async function handleCopyReport() {
  const env = getBrowserInfo();
  const report = {
    generatedAt: new Date().toISOString(),
    environment: env,
    activeSessions,
    logs: getStoredLogs()
  };

  const text = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    alert('Diagnostics report copied to clipboard!');
  } catch (err) {
    logger.error('Failed to copy report to clipboard', { error: err.message });
  }
}

// Runtime Message Listener
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  const { type, payload } = message;

  switch (type) {
    case MessageTypes.LOG_ENTRY:
      if (payload && payload.entry) {
        appendLogToUI(payload.entry);
      }
      break;

    case MessageTypes.RUNTIME_STATE:
      if (payload && payload.activeStreams) {
        activeSessions = payload.activeStreams;
        renderStreams();
        updateCurrentTabControls();
      }
      break;

    case MessageTypes.METRICS_UPDATE:
      if (payload && payload.tabId) {
        const levelValEl = document.getElementById(`level-val-${payload.tabId}`);
        const meterBarEl = document.getElementById(`meter-bar-${payload.tabId}`);
        if (levelValEl) levelValEl.textContent = `${payload.rmsDbFS} dBFS`;
        if (meterBarEl) {
          const pct = Math.max(0, Math.min(100, ((payload.rmsDbFS + 60) / 60) * 100));
          meterBarEl.style.width = `${pct}%`;
        }
      }
      break;

    case MessageTypes.CAPTURE_STOPPED:
    case MessageTypes.CAPTURE_STARTED:
      refreshRuntimeState();
      break;

    default:
      break;
  }
});

// Run init
init();
