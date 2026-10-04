/**
 * WebAudioBalance - SettingsController & Storage
 * Manages global normalization settings and persistence via chrome.storage.local
 */

const SETTINGS_KEY = 'wab_global_settings';

export class SettingsController {
  constructor() {
    this.globalAutoEnabled = true;
    this.globalTargetLufs = -18.0;
  }

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

  /**
   * Determine effective auto-normalization for a specific tab
   * Formula: effectiveAuto = globalAutoEnabled AND tabAutoEnabled
   */
  isEffectiveAuto(tabAutoEnabled) {
    return this.globalAutoEnabled && Boolean(tabAutoEnabled);
  }

  getSettings() {
    return {
      globalAutoEnabled: this.globalAutoEnabled,
      globalTargetLufs: this.globalTargetLufs
    };
  }
}
