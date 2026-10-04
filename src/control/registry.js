/**
 * WebAudioBalance - ManagedTabRegistry (Control Plane)
 * Manages logical tab states and cleanly separates managed, captured, and active states
 */

export class ManagedTabState {
  constructor(tabId, metadata = {}) {
    this.tabId = tabId;
    this.title = metadata.title || 'Untitled Tab';
    this.url = metadata.url || '';
    this.favIconUrl = metadata.favIconUrl || '';
    this.audible = Boolean(metadata.audible);

    // State Trinity
    this.managed = false;
    this.captured = false;
    this.active = false;

    // Per-tab parameters
    this.normalizationEnabled = true;
    this.manualOffsetDb = 0.0;
    this.autoGainDb = 0.0;
    this.effectiveGainDb = 0.0;

    // Metrics snapshot
    this.momentaryLufs = -100.0;
    this.shortTermLufs = -100.0;
    this.peakDbFS = -100.0;
    this.rmsDbFS = -100.0;
    this.isFrozen = false;
    this.lastUpdated = Date.now();
  }

  toJSON() {
    return {
      tabId: this.tabId,
      title: this.title,
      url: this.url,
      favIconUrl: this.favIconUrl,
      audible: this.audible,
      managed: this.managed,
      captured: this.captured,
      active: this.active,
      normalizationEnabled: this.normalizationEnabled,
      manualOffsetDb: this.manualOffsetDb,
      autoGainDb: this.autoGainDb,
      effectiveGainDb: this.effectiveGainDb,
      momentaryLufs: this.momentaryLufs,
      shortTermLufs: this.shortTermLufs,
      peakDbFS: this.peakDbFS,
      rmsDbFS: this.rmsDbFS,
      isFrozen: this.isFrozen,
      lastUpdated: this.lastUpdated
    };
  }
}

export class ManagedTabRegistry {
  constructor() {
    this.tabs = new Map(); // tabId -> ManagedTabState
  }

  ensureTab(tabId, metadata = {}) {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, new ManagedTabState(tabId, metadata));
    } else if (metadata) {
      this.updateMetadata(tabId, metadata);
    }
    return this.tabs.get(tabId);
  }

  setManaged(tabId, isManaged) {
    const tab = this.ensureTab(tabId);
    tab.managed = Boolean(isManaged);
    if (!tab.managed) {
      tab.captured = false;
      tab.active = false;
    }
    tab.lastUpdated = Date.now();
    return tab;
  }

  setCaptured(tabId, isCaptured) {
    const tab = this.ensureTab(tabId);
    tab.captured = Boolean(isCaptured);
    if (!tab.captured) {
      tab.active = false;
    }
    tab.lastUpdated = Date.now();
    return tab;
  }

  setActive(tabId, isActive) {
    const tab = this.ensureTab(tabId);
    tab.active = Boolean(isActive);
    tab.lastUpdated = Date.now();
    return tab;
  }

  updateMetadata(tabId, metadata = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    if (metadata.title !== undefined) tab.title = metadata.title;
    if (metadata.url !== undefined) tab.url = metadata.url;
    if (metadata.favIconUrl !== undefined) tab.favIconUrl = metadata.favIconUrl;
    if (metadata.audible !== undefined) tab.audible = Boolean(metadata.audible);
    tab.lastUpdated = Date.now();
    return tab;
  }

  updateTabSettings(tabId, { normalizationEnabled, manualOffsetDb } = {}) {
    const tab = this.ensureTab(tabId);
    if (normalizationEnabled !== undefined) {
      tab.normalizationEnabled = Boolean(normalizationEnabled);
    }
    if (manualOffsetDb !== undefined && typeof manualOffsetDb === 'number') {
      tab.manualOffsetDb = manualOffsetDb;
    }
    tab.lastUpdated = Date.now();
    return tab;
  }

  updateMetrics(tabId, metrics = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    if (metrics.momentaryLufs !== undefined) tab.momentaryLufs = metrics.momentaryLufs;
    if (metrics.shortTermLufs !== undefined) tab.shortTermLufs = metrics.shortTermLufs;
    if (metrics.peakDbFS !== undefined) tab.peakDbFS = metrics.peakDbFS;
    if (metrics.rmsDbFS !== undefined) tab.rmsDbFS = metrics.rmsDbFS;
    if (metrics.autoGainDb !== undefined) tab.autoGainDb = metrics.autoGainDb;
    if (metrics.manualOffsetDb !== undefined) tab.manualOffsetDb = metrics.manualOffsetDb;
    if (metrics.effectiveGainDb !== undefined) tab.effectiveGainDb = metrics.effectiveGainDb;
    if (metrics.isFrozen !== undefined) tab.isFrozen = metrics.isFrozen;
    if (metrics.isActive !== undefined) tab.active = Boolean(metrics.isActive);

    tab.lastUpdated = Date.now();
    return tab;
  }

  removeTab(tabId) {
    return this.tabs.delete(tabId);
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
}
