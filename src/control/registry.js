/**
 * WebAudioBalance - ManagedTabRegistry (Control Plane)
 * Manages logical tab states and cleanly separates metadata, intent, runtime, and audio evidence
 * Compliant with R2 Runtime & State Reliability Implementation Specification (Sections 5 & 6)
 */

export class ManagedTabState {
  constructor(tabId, metadata = {}) {
    this.tabId = tabId;
    this.revision = 0;
    this.lastUpdated = Date.now();

    this.metadata = {
      title: metadata.title || 'Untitled Tab',
      url: metadata.url || '',
      favIconUrl: metadata.favIconUrl || '',
      audible: Boolean(metadata.audible),
      exists: metadata.exists !== undefined ? Boolean(metadata.exists) : true
    };

    this.intent = {
      managed: false,
      normalizationEnabled: true,
      relativeOffsetDb: 0.0
    };

    this.runtime = {
      captured: false,
      engineState: 'IDLE',
      audioContextState: 'closed',
      active: false,
      frozen: false,
      limited: false,
      limitReason: 'none',
      lastRuntimeError: null,
      runtimeInstanceId: null
    };

    this.audio = {
      inputMomentaryLufs: -100.0,
      inputShortTermLufs: -100.0,
      inputMomentaryValid: false,
      inputShortTermValid: false,
      inputSamplePeakDbFS: -100.0,

      outputMomentaryLufs: -100.0,
      outputShortTermLufs: -100.0,
      outputMomentaryValid: false,
      outputShortTermValid: false,
      outputSamplePeakDbFS: -100.0,

      effectiveTargetLufs: -18.0,
      appliedGainDb: 0.0,
      outputTargetErrorLu: null,
      metricsSequence: 0
    };
  }

  bumpRevision() {
    this.revision++;
    this.lastUpdated = Date.now();
  }

  // --- Metadata compatibility getters & setters ---
  get title() { return this.metadata.title; }
  set title(val) {
    if (this.metadata.title !== val) {
      this.metadata.title = val || 'Untitled Tab';
      this.bumpRevision();
    }
  }

  get url() { return this.metadata.url; }
  set url(val) {
    if (this.metadata.url !== val) {
      this.metadata.url = val || '';
      this.bumpRevision();
    }
  }

  get favIconUrl() { return this.metadata.favIconUrl; }
  set favIconUrl(val) {
    if (this.metadata.favIconUrl !== val) {
      this.metadata.favIconUrl = val || '';
      this.bumpRevision();
    }
  }

  get audible() { return this.metadata.audible; }
  set audible(val) {
    const boolVal = Boolean(val);
    if (this.metadata.audible !== boolVal) {
      this.metadata.audible = boolVal;
      this.bumpRevision();
    }
  }

  get exists() { return this.metadata.exists; }
  set exists(val) {
    const boolVal = Boolean(val);
    if (this.metadata.exists !== boolVal) {
      this.metadata.exists = boolVal;
      this.bumpRevision();
    }
  }

  // --- Intent compatibility getters & setters ---
  get managed() { return this.intent.managed; }
  set managed(val) {
    const boolVal = Boolean(val);
    if (this.intent.managed !== boolVal) {
      this.intent.managed = boolVal;
      this.bumpRevision();
    }
  }

  get normalizationEnabled() { return this.intent.normalizationEnabled; }
  set normalizationEnabled(val) {
    const boolVal = Boolean(val);
    if (this.intent.normalizationEnabled !== boolVal) {
      this.intent.normalizationEnabled = boolVal;
      this.bumpRevision();
    }
  }

  get manualOffsetDb() { return this.intent.relativeOffsetDb; }
  set manualOffsetDb(val) {
    const num = typeof val === 'number' && !isNaN(val) ? val : 0.0;
    if (this.intent.relativeOffsetDb !== num) {
      this.intent.relativeOffsetDb = num;
      this.bumpRevision();
    }
  }

  get relativeOffsetDb() { return this.intent.relativeOffsetDb; }
  set relativeOffsetDb(val) {
    const num = typeof val === 'number' && !isNaN(val) ? val : 0.0;
    if (this.intent.relativeOffsetDb !== num) {
      this.intent.relativeOffsetDb = num;
      this.bumpRevision();
    }
  }

  // --- Runtime compatibility getters & setters ---
  get captured() { return this.runtime.captured; }
  set captured(val) {
    const boolVal = Boolean(val);
    if (this.runtime.captured !== boolVal) {
      this.runtime.captured = boolVal;
      this.bumpRevision();
    }
  }

  get active() { return this.runtime.active; }
  set active(val) {
    const boolVal = Boolean(val);
    if (this.runtime.active !== boolVal) {
      this.runtime.active = boolVal;
      this.bumpRevision();
    }
  }

  get isFrozen() { return this.runtime.frozen; }
  set isFrozen(val) {
    const boolVal = Boolean(val);
    if (this.runtime.frozen !== boolVal) {
      this.runtime.frozen = boolVal;
      this.bumpRevision();
    }
  }

  get engineState() { return this.runtime.engineState; }
  set engineState(val) {
    if (this.runtime.engineState !== val) {
      this.runtime.engineState = val;
      this.bumpRevision();
    }
  }

  get lastRuntimeError() { return this.runtime.lastRuntimeError; }
  set lastRuntimeError(val) {
    this.runtime.lastRuntimeError = val;
    this.bumpRevision();
  }

  // --- Audio metrics compatibility getters ---
  get autoGainDb() { return this.audio.appliedGainDb; }
  get effectiveGainDb() { return this.audio.appliedGainDb; }
  get momentaryLufs() { return this.audio.inputMomentaryLufs; }
  get shortTermLufs() { return this.audio.inputShortTermLufs; }
  get peakDbFS() { return this.audio.inputSamplePeakDbFS; }
  get rmsDbFS() { return this.audio.inputSamplePeakDbFS; }

  toJSON() {
    return {
      tabId: this.tabId,
      metadata: { ...this.metadata },
      intent: { ...this.intent },
      runtime: { ...this.runtime },
      audio: { ...this.audio },
      revision: this.revision,
      lastUpdated: this.lastUpdated,

      // Flat compatibility fields for UI/existing tests
      title: this.metadata.title,
      url: this.metadata.url,
      favIconUrl: this.metadata.favIconUrl,
      audible: this.metadata.audible,
      managed: this.intent.managed,
      captured: this.runtime.captured,
      active: this.runtime.active,
      normalizationEnabled: this.intent.normalizationEnabled,
      manualOffsetDb: this.intent.relativeOffsetDb,
      relativeOffsetDb: this.intent.relativeOffsetDb,
      autoGainDb: this.audio.appliedGainDb,
      effectiveGainDb: this.audio.appliedGainDb,
      momentaryLufs: this.audio.inputMomentaryLufs,
      shortTermLufs: this.audio.inputShortTermLufs,
      peakDbFS: this.audio.inputSamplePeakDbFS,
      rmsDbFS: this.audio.inputSamplePeakDbFS,
      isFrozen: this.runtime.frozen
    };
  }
}

export class ManagedTabRegistry {
  constructor() {
    this.tabs = new Map(); // tabId -> ManagedTabState
    this.revision = 0;
    this.lastReconciliation = {
      at: Date.now(),
      reason: 'init',
      runtimeInstanceId: null
    };
  }

  bumpRevision() {
    this.revision++;
  }

  ensureTab(tabId, metadata = {}) {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      tab = new ManagedTabState(tabId, metadata);
      this.tabs.set(tabId, tab);
      this.bumpRevision();
    } else if (metadata && Object.keys(metadata).length > 0) {
      this.updateMetadata(tabId, metadata);
    }
    return tab;
  }

  setManaged(tabId, isManaged) {
    const tab = this.ensureTab(tabId);
    tab.managed = Boolean(isManaged);
    if (!tab.managed) {
      tab.captured = false;
      tab.active = false;
    }
    this.bumpRevision();
    return tab;
  }

  setCaptured(tabId, isCaptured, runtimeInfo = {}) {
    const tab = this.ensureTab(tabId);
    tab.captured = Boolean(isCaptured);
    if (!tab.captured) {
      tab.active = false;
    }
    if (runtimeInfo && Object.keys(runtimeInfo).length > 0) {
      Object.assign(tab.runtime, runtimeInfo);
      tab.bumpRevision();
    }
    this.bumpRevision();
    return tab;
  }

  setActive(tabId, isActive) {
    const tab = this.ensureTab(tabId);
    tab.active = Boolean(isActive);
    return tab;
  }

  updateMetadata(tabId, metadata = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    let changed = false;
    if (metadata.title !== undefined && tab.metadata.title !== metadata.title) {
      tab.metadata.title = metadata.title || 'Untitled Tab';
      changed = true;
    }
    if (metadata.url !== undefined && tab.metadata.url !== metadata.url) {
      tab.metadata.url = metadata.url || '';
      changed = true;
    }
    if (metadata.favIconUrl !== undefined && tab.metadata.favIconUrl !== metadata.favIconUrl) {
      tab.metadata.favIconUrl = metadata.favIconUrl || '';
      changed = true;
    }
    if (metadata.audible !== undefined && tab.metadata.audible !== Boolean(metadata.audible)) {
      tab.metadata.audible = Boolean(metadata.audible);
      changed = true;
    }
    if (metadata.exists !== undefined && tab.metadata.exists !== Boolean(metadata.exists)) {
      tab.metadata.exists = Boolean(metadata.exists);
      changed = true;
    }

    if (changed) {
      tab.bumpRevision();
      this.bumpRevision();
    }
    return tab;
  }

  updateTabSettings(tabId, { normalizationEnabled, manualOffsetDb, relativeOffsetDb } = {}) {
    const tab = this.ensureTab(tabId);
    let changed = false;

    if (normalizationEnabled !== undefined) {
      const boolVal = Boolean(normalizationEnabled);
      if (tab.intent.normalizationEnabled !== boolVal) {
        tab.intent.normalizationEnabled = boolVal;
        changed = true;
      }
    }

    const nextOffset = relativeOffsetDb !== undefined ? relativeOffsetDb : manualOffsetDb;
    if (nextOffset !== undefined && typeof nextOffset === 'number' && !isNaN(nextOffset)) {
      if (tab.intent.relativeOffsetDb !== nextOffset) {
        tab.intent.relativeOffsetDb = nextOffset;
        changed = true;
      }
    }

    if (changed) {
      tab.bumpRevision();
      this.bumpRevision();
    }
    return tab;
  }

  updateRuntime(tabId, runtimeData = {}) {
    const tab = this.ensureTab(tabId);
    Object.assign(tab.runtime, runtimeData);
    tab.bumpRevision();
    this.bumpRevision();
    return tab;
  }

  updateMetrics(tabId, metrics = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    if (metrics.inputMomentaryLufs !== undefined) tab.audio.inputMomentaryLufs = metrics.inputMomentaryLufs;
    else if (metrics.momentaryLufs !== undefined) tab.audio.inputMomentaryLufs = metrics.momentaryLufs;

    if (metrics.inputShortTermLufs !== undefined) tab.audio.inputShortTermLufs = metrics.inputShortTermLufs;
    else if (metrics.shortTermLufs !== undefined) tab.audio.inputShortTermLufs = metrics.shortTermLufs;

    if (metrics.inputMomentaryValid !== undefined) tab.audio.inputMomentaryValid = Boolean(metrics.inputMomentaryValid);
    if (metrics.inputShortTermValid !== undefined) tab.audio.inputShortTermValid = Boolean(metrics.inputShortTermValid);

    if (metrics.inputSamplePeakDbFS !== undefined) tab.audio.inputSamplePeakDbFS = metrics.inputSamplePeakDbFS;
    else if (metrics.peakDbFS !== undefined) tab.audio.inputSamplePeakDbFS = metrics.peakDbFS;

    if (metrics.outputMomentaryLufs !== undefined) tab.audio.outputMomentaryLufs = metrics.outputMomentaryLufs;
    if (metrics.outputShortTermLufs !== undefined) tab.audio.outputShortTermLufs = metrics.outputShortTermLufs;
    if (metrics.outputMomentaryValid !== undefined) tab.audio.outputMomentaryValid = Boolean(metrics.outputMomentaryValid);
    if (metrics.outputShortTermValid !== undefined) tab.audio.outputShortTermValid = Boolean(metrics.outputShortTermValid);
    if (metrics.outputSamplePeakDbFS !== undefined) tab.audio.outputSamplePeakDbFS = metrics.outputSamplePeakDbFS;

    if (metrics.effectiveTargetLufs !== undefined) tab.audio.effectiveTargetLufs = metrics.effectiveTargetLufs;
    if (metrics.appliedGainDb !== undefined) tab.audio.appliedGainDb = metrics.appliedGainDb;
    else if (metrics.effectiveGainDb !== undefined) tab.audio.appliedGainDb = metrics.effectiveGainDb;

    if (metrics.outputTargetErrorLu !== undefined) tab.audio.outputTargetErrorLu = metrics.outputTargetErrorLu;
    if (metrics.measurementSequence !== undefined) tab.audio.metricsSequence = metrics.measurementSequence;
    else if (metrics.metricsSequence !== undefined) tab.audio.metricsSequence = metrics.metricsSequence;

    if (metrics.isActive !== undefined) tab.runtime.active = Boolean(metrics.isActive);
    if (metrics.isFrozen !== undefined) tab.runtime.frozen = Boolean(metrics.isFrozen);
    if (metrics.isLimited !== undefined) tab.runtime.limited = Boolean(metrics.isLimited);
    if (metrics.limitReason !== undefined) tab.runtime.limitReason = metrics.limitReason;
    if (metrics.audioContextState !== undefined) tab.runtime.audioContextState = metrics.audioContextState;

    tab.lastUpdated = Date.now();
    return tab;
  }

  setReconciliationInfo(reason, runtimeInstanceId) {
    this.lastReconciliation = {
      at: Date.now(),
      reason: reason || 'unknown',
      runtimeInstanceId: runtimeInstanceId || null
    };
    this.bumpRevision();
  }

  removeTab(tabId) {
    const existed = this.tabs.delete(tabId);
    if (existed) {
      this.bumpRevision();
    }
    return existed;
  }

  getTab(tabId) {
    return this.tabs.get(tabId) || null;
  }

  getAllTabs() {
    return Array.from(this.tabs.values()).map(t => t.toJSON());
  }

  getManagedTabs() {
    return Array.from(this.tabs.values()).filter(t => t.managed).map(t => t.toJSON());
  }

  getCapturedTabs() {
    return Array.from(this.tabs.values()).filter(t => t.captured).map(t => t.toJSON());
  }

  /**
   * Canonical Product Snapshot (Section 6)
   */
  getProductSnapshot(globalSettings = {}) {
    return {
      revision: this.revision,
      generatedAt: Date.now(),
      globalSettings: {
        globalAutoEnabled: globalSettings.globalAutoEnabled ?? true,
        globalTargetLufs: globalSettings.globalTargetLufs ?? -18.0
      },
      managedTabs: this.getManagedTabs(),
      allKnownTabs: this.getAllTabs(),
      lastReconciliation: { ...this.lastReconciliation }
    };
  }
}
