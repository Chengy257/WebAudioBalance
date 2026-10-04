/**
 * WebAudioBalance - SettingsController & Storage
 * Manages durable global normalization settings via chrome.storage.local
 * and session-scoped tab intent via chrome.storage.session
 * Compliant with R2 Runtime & State Reliability Implementation Specification (Section 7)
 */

const SETTINGS_KEY = 'wab_global_settings';
const SESSION_INTENTS_KEY = 'wab_session_intents';

export class SettingsController {
  constructor() {
    this.globalAutoEnabled = true;
    this.globalTargetLufs = -18.0;
    this.sessionIntents = new Map(); // tabId -> { tabId, managed, normalizationEnabled, relativeOffsetDb, updatedAt }
  }

  // --- Durable Global Settings (chrome.storage.local) ---

  async loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = await chrome.storage.local.get(SETTINGS_KEY);
        if (data && data[SETTINGS_KEY]) {
          const s = data[SETTINGS_KEY];
          if (typeof s.globalAutoEnabled === 'boolean') this.globalAutoEnabled = s.globalAutoEnabled;
          if (typeof s.globalTargetLufs === 'number') this.globalTargetLufs = s.globalTargetLufs;
        }
      } catch (err) {
        console.warn('Could not load settings from chrome.storage.local:', err.message);
      }
    }
    return this.getSettings();
  }

  async saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.set({
          [SETTINGS_KEY]: {
            globalAutoEnabled: this.globalAutoEnabled,
            globalTargetLufs: this.globalTargetLufs,
            updatedAt: Date.now()
          }
        });
      } catch (err) {
        console.warn('Could not save settings to chrome.storage.local:', err.message);
      }
    }
  }

  setGlobalAutoEnabled(enabled) {
    this.globalAutoEnabled = Boolean(enabled);
    this.saveSettings();
    return this.globalAutoEnabled;
  }

  setGlobalTargetLufs(targetLufs) {
    if (typeof targetLufs === 'number' && !isNaN(targetLufs)) {
      this.globalTargetLufs = Math.max(-36, Math.min(-6, targetLufs));
      this.saveSettings();
    }
    return this.globalTargetLufs;
  }

  isEffectiveAuto(tabAutoEnabled) {
    return this.globalAutoEnabled && Boolean(tabAutoEnabled);
  }

  getSettings() {
    return {
      globalAutoEnabled: this.globalAutoEnabled,
      globalTargetLufs: this.globalTargetLufs
    };
  }

  // --- Session-Scoped Tab Intent (chrome.storage.session, Section 7.2) ---

  async loadSessionIntents() {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const data = await chrome.storage.session.get(SESSION_INTENTS_KEY);
        if (data && data[SESSION_INTENTS_KEY]) {
          const intentsObj = data[SESSION_INTENTS_KEY];
          this.sessionIntents.clear();
          for (const [tIdStr, item] of Object.entries(intentsObj)) {
            const numTabId = Number(tIdStr);
            this.sessionIntents.set(numTabId, {
              tabId: numTabId,
              managed: Boolean(item.managed),
              normalizationEnabled: item.normalizationEnabled !== undefined ? Boolean(item.normalizationEnabled) : true,
              relativeOffsetDb: typeof item.relativeOffsetDb === 'number' ? item.relativeOffsetDb : 0.0,
              updatedAt: item.updatedAt || Date.now()
            });
          }
        }
      } catch (err) {
        console.warn('Could not load session intents from chrome.storage.session:', err.message);
      }
    }
    return new Map(this.sessionIntents);
  }

  async persistSessionIntentsToStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const plainObj = {};
        for (const [tabId, intent] of this.sessionIntents.entries()) {
          plainObj[String(tabId)] = intent;
        }
        await chrome.storage.session.set({ [SESSION_INTENTS_KEY]: plainObj });
      } catch (err) {
        console.warn('Could not save session intents to chrome.storage.session:', err.message);
      }
    }
  }

  async saveSessionIntent(tabId, intent = {}) {
    const numTabId = Number(tabId);
    const existing = this.sessionIntents.get(numTabId) || {};
    const sanitized = {
      tabId: numTabId,
      managed: intent.managed !== undefined ? Boolean(intent.managed) : Boolean(existing.managed),
      normalizationEnabled: intent.normalizationEnabled !== undefined ? Boolean(intent.normalizationEnabled) : (existing.normalizationEnabled ?? true),
      relativeOffsetDb: typeof intent.relativeOffsetDb === 'number' ? intent.relativeOffsetDb : (existing.relativeOffsetDb ?? 0.0),
      updatedAt: Date.now()
    };
    this.sessionIntents.set(numTabId, sanitized);
    await this.persistSessionIntentsToStorage();
    return sanitized;
  }

  async removeSessionIntent(tabId) {
    const numTabId = Number(tabId);
    const deleted = this.sessionIntents.delete(numTabId);
    if (deleted) {
      await this.persistSessionIntentsToStorage();
    }
    return deleted;
  }

  async clearAllSessionIntents() {
    this.sessionIntents.clear();
    await this.persistSessionIntentsToStorage();
  }

  getSessionIntent(tabId) {
    return this.sessionIntents.get(Number(tabId)) || null;
  }

  getAllSessionIntents() {
    return new Map(this.sessionIntents);
  }
}
