/**
 * WebAudioBalance - MultiTabCoordinator (Control Plane)
 * Central orchestrator connecting ManagedTabRegistry, Settings, and Offscreen AudioEngines
 * Compliant with R2 Runtime & State Reliability Implementation Specification (Sections 8, 9, 10, 11, 12)
 */

import { ManagedTabRegistry } from './registry.js';
import { SettingsController } from './settings.js';
import { MessageTargets, MessageTypes, createMessage, createCommandSuccess, createCommandFailure } from '../shared/messages.js';
import { ErrorCodes, createRuntimeError } from '../shared/failure-taxonomy.js';
import { StructuredLogger } from '../shared/logger.js';

const logger = new StructuredLogger('MultiTabCoordinator');

export class MultiTabCoordinator {
  constructor() {
    this.registry = new ManagedTabRegistry();
    this.settings = new SettingsController();
    this.isReady = false;
    this._initPromise = null;
  }

  /**
   * Coordinator readiness barrier (Section 8)
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      logger.info('Coordinator initializing readiness barrier...');
      await this.settings.loadSettings();
      await this.settings.loadSessionIntents();
      await this.reconcileRuntime('init');
      this.isReady = true;
      logger.info('Coordinator initialization complete', {
        settings: this.settings.getSettings(),
        managedCount: this.registry.getManagedTabs().length
      });
      return true;
    })();
    return this._initPromise;
  }

  /**
   * Seed metadata from chrome.tabs.get before start transaction (Section 9.1)
   */
  async seedTabMetadata(tabId) {
    if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          return this.registry.ensureTab(tabId, {
            title: tab.title || 'Untitled Tab',
            url: tab.url || '',
            favIconUrl: tab.favIconUrl || '',
            audible: Boolean(tab.audible),
            exists: true
          });
        }
      } catch (err) {
        logger.warn('Could not seed tab metadata from chrome.tabs.get', { tabId, error: err.message });
      }
    }
    return this.registry.ensureTab(tabId);
  }

  /**
   * Query live Audio Runtime snapshot directly from Offscreen document (Section 3.3 & 4)
   */
  async queryAudioRuntimeSnapshot() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return null;
    }
    try {
      const res = await chrome.runtime.sendMessage(createMessage(
        MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT,
        MessageTargets.OFFSCREEN
      ));
      if (res && res.runtimeInstanceId) {
        return res;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Product Snapshot Query (Section 6)
   */
  getSnapshot() {
    const snap = this.registry.getProductSnapshot(this.settings.getSettings());
    // Provide backwards-compatible alias 'allTabs'
    snap.allTabs = snap.allKnownTabs;
    return snap;
  }

  /**
   * Start capture transaction with explicit ACK and runtime verification (Section 9)
   */
  async startManagingTab(tabId, streamId, options = {}) {
    await this.init();
    logger.info('Starting management transaction for tab', { tabId, hasStreamId: Boolean(streamId) });

    if (!streamId) {
      const authErr = createRuntimeError(
        ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED,
        'This tab must be opened and explicitly enabled before it can be balanced.',
        { tabId, retryable: true }
      );
      this.registry.setManaged(tabId, false);
      this.registry.setCaptured(tabId, false, { lastRuntimeError: authErr });
      return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, authErr, { tabId });
    }

    // 1. Seed tab metadata
    await this.seedTabMetadata(tabId);

    // 2. Set managed intent
    const tab = this.registry.setManaged(tabId, true);
    if (typeof options.manualOffsetDb === 'number') {
      tab.manualOffsetDb = options.manualOffsetDb;
    } else if (typeof options.relativeOffsetDb === 'number') {
      tab.relativeOffsetDb = options.relativeOffsetDb;
    }
    if (typeof options.normalizationEnabled === 'boolean') {
      tab.normalizationEnabled = options.normalizationEnabled;
    }

    const effectiveAuto = this.settings.isEffectiveAuto(tab.normalizationEnabled);

    // 3. Dispatch START_CAPTURE to Offscreen
    let startResponse = null;
    try {
      startResponse = await chrome.runtime.sendMessage(createMessage(
        MessageTypes.START_CAPTURE,
        MessageTargets.OFFSCREEN,
        {
          tabId,
          streamId,
          targetLufs: this.settings.globalTargetLufs,
          normalizationEnabled: effectiveAuto,
          manualOffsetDb: tab.manualOffsetDb
        },
        options.requestId
      ));
    } catch (err) {
      const runtimeError = createRuntimeError(
        ErrorCodes.OFFSCREEN_UNAVAILABLE,
        `Failed to reach Offscreen audio runtime: ${err.message}`,
        { tabId, cause: err, retryable: true }
      );
      this.registry.setCaptured(tabId, false, { lastRuntimeError: runtimeError });
      return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, runtimeError, { tabId });
    }

    // 4. Inspect Offscreen response.success
    if (!startResponse || !startResponse.success) {
      const errObj = startResponse?.error || {
        code: ErrorCodes.AUDIO_ENGINE_START_FAILED,
        message: 'Offscreen rejected audio engine start',
        retryable: true
      };
      const runtimeError = createRuntimeError(errObj.code, errObj.message, { tabId, retryable: errObj.retryable });
      this.registry.setCaptured(tabId, false, { lastRuntimeError: runtimeError });
      logger.error('Offscreen rejected engine start', { tabId, error: runtimeError });
      return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, runtimeError, { tabId });
    }

    // 5. Query runtime snapshot to verify live engine exists (Section 9.2 & Section 19 hard gate)
    const runtimeSnapshot = await this.queryAudioRuntimeSnapshot();
    const liveEngine = runtimeSnapshot?.engines?.find((e) => e.tabId === tabId);

    if (!liveEngine) {
      const err = createRuntimeError(
        ErrorCodes.AUDIO_ENGINE_NOT_FOUND,
        'Offscreen reported success but engine is absent in runtime snapshot',
        { tabId, retryable: true }
      );
      this.registry.setCaptured(tabId, false, { lastRuntimeError: err });
      return createCommandFailure(options.requestId, MessageTypes.START_CAPTURE, err, { tabId });
    }

    // 6. Confirmed live engine exists -> mark captured=true
    this.registry.setCaptured(tabId, true, {
      engineState: liveEngine.engineState,
      audioContextState: liveEngine.audioContextState,
      runtimeInstanceId: runtimeSnapshot.runtimeInstanceId,
      lastRuntimeError: null
    });

    // 7. Persist session intent
    await this.settings.saveSessionIntent(tabId, {
      managed: true,
      normalizationEnabled: tab.normalizationEnabled,
      relativeOffsetDb: tab.relativeOffsetDb
    });

    return createCommandSuccess(options.requestId, MessageTypes.START_CAPTURE, {
      tabId,
      revision: this.registry.revision,
      result: { liveEngine }
    });
  }

  /**
   * Stop capture transaction with idempotent semantics (Section 10)
   */
  async stopManagingTab(tabId, options = {}) {
    await this.init();
    logger.info('Stopping management transaction for tab', { tabId, options });

    let stopResponse = null;
    try {
      stopResponse = await chrome.runtime.sendMessage(createMessage(
        MessageTypes.STOP_CAPTURE,
        MessageTargets.OFFSCREEN,
        { tabId },
        options.requestId
      ));
    } catch (err) {
      logger.warn('Could not contact Offscreen runtime for STOP_CAPTURE', { tabId, error: err.message });
    }

    if (stopResponse && !stopResponse.success) {
      logger.error('Offscreen returned failure stopping engine', { tabId, error: stopResponse.error });
      return createCommandFailure(options.requestId, MessageTypes.STOP_CAPTURE, stopResponse.error, { tabId });
    }

    const isRelease = options.release !== false;
    if (isRelease) {
      this.registry.setManaged(tabId, false);
      this.registry.setCaptured(tabId, false, {
        engineState: 'IDLE',
        audioContextState: 'closed',
        lastRuntimeError: null
      });
      await this.settings.removeSessionIntent(tabId);
    } else {
      this.registry.setCaptured(tabId, false, {
        engineState: 'IDLE',
        audioContextState: 'closed'
      });
    }

    return createCommandSuccess(options.requestId, MessageTypes.STOP_CAPTURE, {
      tabId,
      revision: this.registry.revision,
      result: { alreadyStopped: stopResponse?.result?.alreadyStopped || false }
    });
  }

  /**
   * Per-tab relative level transaction with live ACK inspection (Section 11.1)
   */
  async setTabManualOffset(tabId, offsetDb, options = {}) {
    await this.init();
    const tab = this.registry.ensureTab(tabId);
    const isCaptured = tab.runtime.captured;

    if (isCaptured) {
      let res = null;
      try {
        res = await chrome.runtime.sendMessage(createMessage(
          MessageTypes.SET_TAB_OFFSET,
          MessageTargets.OFFSCREEN,
          { tabId, gainDb: offsetDb, offsetDb, relativeOffsetDb: offsetDb },
          options.requestId
        ));
      } catch (err) {
        const error = createRuntimeError(ErrorCodes.OFFSCREEN_UNAVAILABLE, err.message, { tabId });
        return createCommandFailure(options.requestId, MessageTypes.SET_TAB_OFFSET, error, { tabId });
      }

      if (!res || !res.success) {
        const errObj = res?.error || { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: 'Offset rejected by runtime' };
        return createCommandFailure(options.requestId, MessageTypes.SET_TAB_OFFSET, errObj, { tabId });
      }
    }

    this.registry.updateTabSettings(tabId, { relativeOffsetDb: offsetDb });
    await this.settings.saveSessionIntent(tabId, {
      managed: tab.intent.managed,
      normalizationEnabled: tab.intent.normalizationEnabled,
      relativeOffsetDb: offsetDb
    });

    return createCommandSuccess(options.requestId, MessageTypes.SET_TAB_OFFSET, {
      tabId,
      revision: this.registry.revision,
      result: { relativeOffsetDb: offsetDb, appliedToRuntime: isCaptured }
    });
  }

  /**
   * Per-tab normalization transaction with live ACK inspection (Section 11.1)
   */
  async setTabNormalization(tabId, enabled, options = {}) {
    await this.init();
    const tab = this.registry.ensureTab(tabId);
    const isCaptured = tab.runtime.captured;
    const effectiveAuto = this.settings.isEffectiveAuto(enabled);

    if (isCaptured) {
      let res = null;
      try {
        res = await chrome.runtime.sendMessage(createMessage(
          MessageTypes.SET_NORMALIZATION,
          MessageTargets.OFFSCREEN,
          { tabId, normalizationEnabled: effectiveAuto },
          options.requestId
        ));
      } catch (err) {
        const error = createRuntimeError(ErrorCodes.OFFSCREEN_UNAVAILABLE, err.message, { tabId });
        return createCommandFailure(options.requestId, MessageTypes.SET_NORMALIZATION, error, { tabId });
      }

      if (!res || !res.success) {
        const errObj = res?.error || { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: 'Normalization toggle rejected by runtime' };
        return createCommandFailure(options.requestId, MessageTypes.SET_NORMALIZATION, errObj, { tabId });
      }
    }

    this.registry.updateTabSettings(tabId, { normalizationEnabled: enabled });
    await this.settings.saveSessionIntent(tabId, {
      managed: tab.intent.managed,
      normalizationEnabled: enabled,
      relativeOffsetDb: tab.intent.relativeOffsetDb
    });

    return createCommandSuccess(options.requestId, MessageTypes.SET_NORMALIZATION, {
      tabId,
      revision: this.registry.revision,
      result: { normalizationEnabled: enabled, appliedToRuntime: isCaptured }
    });
  }

  /**
   * Global auto-normalization setting transaction with partial failure aggregation (Section 11.2)
   */
  async setGlobalAutoEnabled(enabled, options = {}) {
    await this.init();
    this.settings.setGlobalAutoEnabled(enabled);

    const capturedTabs = this.registry.getCapturedTabs();
    const appliedTo = [];
    const failedTabs = [];

    for (const tab of capturedTabs) {
      const effective = this.settings.isEffectiveAuto(tab.normalizationEnabled);
      try {
        const res = await chrome.runtime.sendMessage(createMessage(
          MessageTypes.SET_NORMALIZATION,
          MessageTargets.OFFSCREEN,
          { tabId: tab.tabId, normalizationEnabled: effective }
        ));
        if (res && res.success) {
          appliedTo.push(tab.tabId);
        } else {
          failedTabs.push({
            tabId: tab.tabId,
            error: res?.error || { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: 'Rejected' }
          });
          this.registry.updateRuntime(tab.tabId, {
            lastRuntimeError: createRuntimeError(ErrorCodes.AUDIO_COMMAND_REJECTED, 'Global auto rejected', { tabId: tab.tabId })
          });
        }
      } catch (err) {
        failedTabs.push({
          tabId: tab.tabId,
          error: { code: ErrorCodes.OFFSCREEN_UNAVAILABLE, message: err.message }
        });
      }
    }

    const allSuccess = failedTabs.length === 0;
    const result = {
      settingPersisted: true,
      globalAutoEnabled: enabled,
      appliedTo,
      failedTabs
    };

    if (allSuccess) {
      return createCommandSuccess(options.requestId, MessageTypes.SET_GLOBAL_AUTO, { result });
    } else {
      return createCommandFailure(options.requestId, MessageTypes.SET_GLOBAL_AUTO, {
        code: ErrorCodes.AUDIO_COMMAND_REJECTED,
        message: 'Some engines failed to apply global auto-balance'
      }, { result });
    }
  }

  /**
   * Global target LUFS setting transaction with partial failure aggregation (Section 11.2)
   */
  async setGlobalTargetLufs(targetLufs, options = {}) {
    await this.init();
    this.settings.setGlobalTargetLufs(targetLufs);

    const capturedTabs = this.registry.getCapturedTabs();
    const appliedTo = [];
    const failedTabs = [];

    for (const tab of capturedTabs) {
      try {
        const res = await chrome.runtime.sendMessage(createMessage(
          MessageTypes.SET_TARGET,
          MessageTargets.OFFSCREEN,
          { tabId: tab.tabId, targetLufs }
        ));
        if (res && res.success) {
          appliedTo.push(tab.tabId);
        } else {
          failedTabs.push({
            tabId: tab.tabId,
            error: res?.error || { code: ErrorCodes.AUDIO_COMMAND_REJECTED, message: 'Rejected' }
          });
          this.registry.updateRuntime(tab.tabId, {
            lastRuntimeError: createRuntimeError(ErrorCodes.AUDIO_COMMAND_REJECTED, 'Global target rejected', { tabId: tab.tabId })
          });
        }
      } catch (err) {
        failedTabs.push({
          tabId: tab.tabId,
          error: { code: ErrorCodes.OFFSCREEN_UNAVAILABLE, message: err.message }
        });
      }
    }

    const allSuccess = failedTabs.length === 0;
    const result = {
      settingPersisted: true,
      globalTargetLufs: targetLufs,
      appliedTo,
      failedTabs
    };

    if (allSuccess) {
      return createCommandSuccess(options.requestId, MessageTypes.SET_GLOBAL_TARGET, { result });
    } else {
      return createCommandFailure(options.requestId, MessageTypes.SET_GLOBAL_TARGET, {
        code: ErrorCodes.AUDIO_COMMAND_REJECTED,
        message: 'Some engines failed to apply global target LUFS'
      }, { result });
    }
  }

  /**
   * Comprehensive Runtime Reconciliation Algorithm (Section 12)
   */
  async reconcileRuntime(reason = 'manual') {
    logger.info(`Reconciling runtime state (reason: ${reason})`);

    // Fetch external evidence sources in parallel
    const [runtimeSnapshot, capturedTabsList, allBrowserTabs] = await Promise.all([
      this.queryAudioRuntimeSnapshot(),
      (async () => {
        if (typeof chrome !== 'undefined' && chrome.tabCapture?.getCapturedTabs) {
          try {
            return await new Promise((resolve) => {
              chrome.tabCapture.getCapturedTabs((tabs) => resolve(tabs || []));
            });
          } catch (_) { return []; }
        }
        return [];
      })(),
      (async () => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
          try {
            return await chrome.tabs.query({});
          } catch (_) { return []; }
        }
        return [];
      })()
    ]);

    const browserTabMap = new Map();
    for (const bTab of allBrowserTabs) {
      browserTabMap.set(bTab.id, bTab);
    }

    const browserCapturedTabIds = new Set(
      capturedTabsList
        .filter((c) => c.status === 'active' || c.status === 'requested')
        .map((c) => c.tabId)
    );

    const liveEnginesMap = new Map();
    if (runtimeSnapshot && Array.isArray(runtimeSnapshot.engines)) {
      for (const eng of runtimeSnapshot.engines) {
        liveEnginesMap.set(eng.tabId, eng);
      }
    }

    const sessionIntents = this.settings.getAllSessionIntents();

    // Union of all known tab IDs
    const allReferencedTabIds = new Set([
      ...this.registry.tabs.keys(),
      ...sessionIntents.keys(),
      ...liveEnginesMap.keys()
    ]);

    for (const tabId of allReferencedTabIds) {
      const bTab = browserTabMap.get(tabId);
      const sessionIntent = sessionIntents.get(tabId);
      const liveEngine = liveEnginesMap.get(tabId);
      const isBrowserCaptured = browserCapturedTabIds.has(tabId);

      // 1. Tab no longer exists in browser (Section 12.2)
      if (browserTabMap.size > 0 && !bTab) {
        logger.info(`Tab ${tabId} absent in browser; cleaning up registry and session intent`);
        if (liveEngine) {
          this.stopManagingTab(tabId, { release: true }).catch(() => {});
        }
        this.registry.removeTab(tabId);
        await this.settings.removeSessionIntent(tabId);
        continue;
      }

      // Ensure tab in registry
      const regTab = this.registry.ensureTab(tabId, bTab ? {
        title: bTab.title || 'Untitled Tab',
        url: bTab.url || '',
        favIconUrl: bTab.favIconUrl || '',
        audible: Boolean(bTab.audible),
        exists: true
      } : { exists: true });

      // 2. Authoritative Intent merging
      if (sessionIntent) {
        regTab.intent.managed = Boolean(sessionIntent.managed);
        regTab.intent.normalizationEnabled = sessionIntent.normalizationEnabled ?? true;
        regTab.intent.relativeOffsetDb = sessionIntent.relativeOffsetDb ?? 0.0;
      } else if (liveEngine) {
        // Runtime engine exists but session intent missing (adopt engine config)
        regTab.intent.managed = true;
        regTab.intent.normalizationEnabled = true;
        regTab.intent.relativeOffsetDb = liveEngine.relativeOffsetDb ?? 0.0;
        await this.settings.saveSessionIntent(tabId, {
          managed: true,
          normalizationEnabled: true,
          relativeOffsetDb: regTab.intent.relativeOffsetDb
        });
      }

      // 3. Engine existence: Offscreen runtime snapshot > stored intent (Section 12.1)
      if (liveEngine) {
        regTab.runtime.captured = true;
        regTab.runtime.engineState = liveEngine.engineState;
        regTab.runtime.audioContextState = liveEngine.audioContextState;
        regTab.runtime.active = liveEngine.active;
        regTab.runtime.frozen = liveEngine.frozen;
        regTab.runtime.limited = liveEngine.limited;
        regTab.runtime.limitReason = liveEngine.limitReason;
        regTab.runtime.runtimeInstanceId = runtimeSnapshot.runtimeInstanceId;
        regTab.runtime.lastRuntimeError = liveEngine.lastRuntimeError;

        // Populate audio metrics
        regTab.audio.inputMomentaryLufs = liveEngine.inputMomentaryLufs;
        regTab.audio.inputShortTermLufs = liveEngine.inputShortTermLufs;
        regTab.audio.inputMomentaryValid = liveEngine.inputMomentaryValid;
        regTab.audio.inputShortTermValid = liveEngine.inputShortTermValid;
        regTab.audio.inputSamplePeakDbFS = liveEngine.inputSamplePeakDbFS;
        regTab.audio.outputMomentaryLufs = liveEngine.outputMomentaryLufs;
        regTab.audio.outputShortTermLufs = liveEngine.outputShortTermLufs;
        regTab.audio.outputMomentaryValid = liveEngine.outputMomentaryValid;
        regTab.audio.outputShortTermValid = liveEngine.outputShortTermValid;
        regTab.audio.outputSamplePeakDbFS = liveEngine.outputSamplePeakDbFS;
        regTab.audio.effectiveTargetLufs = liveEngine.effectiveTargetLufs;
        regTab.audio.appliedGainDb = liveEngine.appliedGainDb;
        regTab.audio.outputTargetErrorLu = liveEngine.outputTargetErrorLu;
        regTab.audio.metricsSequence = liveEngine.metricsSequence;

        // Corroboration diagnostic check (Section 12.2)
        const tabCaptureRecord = capturedTabsList.find(c => c.tabId === tabId);
        if (tabCaptureRecord && (tabCaptureRecord.status === 'stopped' || tabCaptureRecord.status === 'error')) {
          if (liveEngine.engineState === 'RUNNING' && liveEngine.audioContextState === 'running') {
            // Live engine is confirmed running and healthy in the Offscreen audio runtime.
            // Offscreen AudioContext is the authoritative source of truth.
            if (regTab.runtime.lastRuntimeError?.code === ErrorCodes.CAPTURE_STATE_MISMATCH) {
              regTab.runtime.lastRuntimeError = null;
            }
          } else {
            logger.warn(`Capture mismatch: Live engine exists for tab ${tabId} but tabCapture reports status ${tabCaptureRecord.status}`);
            regTab.runtime.lastRuntimeError = createRuntimeError(
              ErrorCodes.CAPTURE_STATE_MISMATCH,
              `Audio engine running but browser tabCapture reports ${tabCaptureRecord.status}`,
              { tabId, retryable: true }
            );
          }
        } else if (liveEngine.engineState === 'RUNNING') {
          if (regTab.runtime.lastRuntimeError?.code === ErrorCodes.CAPTURE_STATE_MISMATCH) {
            regTab.runtime.lastRuntimeError = null;
          }
        }
      } else {
        // No live engine exists for this tab
        regTab.runtime.captured = false;
        regTab.runtime.active = false;
        regTab.runtime.engineState = 'IDLE';

        if (runtimeSnapshot === null) {
          // Offscreen document absent entirely
          if (regTab.intent.managed) {
            regTab.runtime.lastRuntimeError = createRuntimeError(
              ErrorCodes.OFFSCREEN_UNAVAILABLE,
              'Offscreen audio runtime is currently stopped or unavailable',
              { tabId, retryable: true }
            );
          }
        } else if (regTab.intent.managed && isBrowserCaptured) {
          logger.warn(`Capture mismatch: tabCapture indicates captured for tab ${tabId} but Offscreen has no engine`);
          regTab.runtime.lastRuntimeError = createRuntimeError(
            ErrorCodes.CAPTURE_STATE_MISMATCH,
            'Browser tabCapture is active but audio engine was terminated',
            { tabId, retryable: true }
          );
        }
      }

      regTab.bumpRevision();
    }

    this.registry.setReconciliationInfo(reason, runtimeSnapshot?.runtimeInstanceId || null);
    return this.registry.getProductSnapshot(this.settings.getSettings());
  }

  // --- Lifecycle & Event Handlers (Section 13) ---

  async handleTabClosed(tabId) {
    logger.info('Tab closed by browser, cleaning up coordinator registry', { tabId });
    await this.stopManagingTab(tabId, { release: true });
    this.registry.removeTab(tabId);
    await this.settings.removeSessionIntent(tabId);
  }

  handleTabUpdated(tabId, changeInfo, tab) {
    // Section 13: Tab capture can persist across navigation. Do not automatically release merely because URL changed.
    this.registry.updateMetadata(tabId, {
      title: tab?.title || changeInfo.title,
      url: tab?.url || changeInfo.url,
      favIconUrl: tab?.favIconUrl || changeInfo.favIconUrl,
      audible: tab?.audible !== undefined ? tab.audible : changeInfo.audible
    });
  }

  handleMetricsUpdate(metrics) {
    if (metrics && metrics.tabId) {
      this.registry.updateMetrics(metrics.tabId, metrics);
    }
  }

  handleRuntimeReady(runtimeInstanceId) {
    logger.info('Offscreen AUDIO_RUNTIME_READY received', { runtimeInstanceId });
    this.reconcileRuntime('AUDIO_RUNTIME_READY').catch((e) => logger.error('Reconciliation on ready failed', e));
  }

  handleRuntimeLifecycle(payload) {
    logger.info('Offscreen AUDIO_RUNTIME_LIFECYCLE received', payload);
    if (payload && payload.tabId) {
      this.reconcileRuntime('AUDIO_RUNTIME_LIFECYCLE').catch((e) => logger.error('Reconciliation on lifecycle failed', e));
    }
  }
}
