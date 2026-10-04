/**
 * WebAudioBalance - MultiTabCoordinator (Control Plane)
 * Central orchestrator connecting ManagedTabRegistry, Settings, and Offscreen AudioEngines
 */

import { ManagedTabRegistry } from './registry.js';
import { SettingsController } from './settings.js';
import { MessageTargets, MessageTypes, createMessage } from '../shared/messages.js';
import { StructuredLogger } from '../shared/logger.js';

const logger = new StructuredLogger('MultiTabCoordinator');

export class MultiTabCoordinator {
  constructor() {
    this.registry = new ManagedTabRegistry();
    this.settings = new SettingsController();
  }

  async init() {
    await this.settings.loadSettings();
    logger.info('Coordinator initialized with settings', this.settings.getSettings());
  }

  getSnapshot() {
    return {
      globalSettings: this.settings.getSettings(),
      managedTabs: this.registry.getManagedTabs(),
      allTabs: this.registry.getAllTabs()
    };
  }

  async startManagingTab(tabId, streamId) {
    logger.info('Starting management for tab', { tabId, hasStreamId: Boolean(streamId) });
    const tab = this.registry.setManaged(tabId, true);

    const effectiveAuto = this.settings.isEffectiveAuto(tab.normalizationEnabled);

    // Send START_CAPTURE / START_ENGINE to Offscreen
    try {
      await chrome.runtime.sendMessage(createMessage(MessageTypes.START_CAPTURE, MessageTargets.OFFSCREEN, {
        tabId,
        streamId,
        targetLufs: this.settings.globalTargetLufs,
        normalizationEnabled: effectiveAuto,
        manualOffsetDb: tab.manualOffsetDb
      }));

      this.registry.setCaptured(tabId, true);
      return { success: true, tabId };
    } catch (err) {
      logger.error('Failed to dispatch engine start to offscreen', { tabId, error: err.message });
      this.registry.setCaptured(tabId, false);
      throw err;
    }
  }

  async stopManagingTab(tabId) {
    logger.info('Stopping management for tab', { tabId });
    this.registry.setManaged(tabId, false);
    this.registry.setCaptured(tabId, false);

    try {
      await chrome.runtime.sendMessage(createMessage(MessageTypes.STOP_CAPTURE, MessageTargets.OFFSCREEN, { tabId }));
      return { success: true };
    } catch (err) {
      logger.warn('Failed to dispatch STOP_CAPTURE to offscreen', { tabId, error: err.message });
      return { success: false, error: err.message };
    }
  }

  async setTabNormalization(tabId, enabled) {
    this.registry.updateTabSettings(tabId, { normalizationEnabled: enabled });
    const effectiveAuto = this.settings.isEffectiveAuto(enabled);

    logger.info('Setting tab normalization', { tabId, tabEnabled: enabled, effectiveAuto });
    try {
      await chrome.runtime.sendMessage(createMessage(MessageTypes.SET_NORMALIZATION, MessageTargets.OFFSCREEN, {
        tabId,
        normalizationEnabled: effectiveAuto
      }));
    } catch (_) {}
  }

  async setTabManualOffset(tabId, offsetDb) {
    this.registry.updateTabSettings(tabId, { manualOffsetDb: offsetDb });
    logger.info('Setting tab manual offset', { tabId, offsetDb });

    try {
      await chrome.runtime.sendMessage(createMessage(MessageTypes.SET_TEST_GAIN, MessageTargets.OFFSCREEN, {
        tabId,
        gainDb: offsetDb
      }));
    } catch (_) {}
  }

  async setGlobalAutoEnabled(enabled) {
    this.settings.setGlobalAutoEnabled(enabled);
    logger.info('Global auto-normalization changed', { globalAutoEnabled: enabled });

    // Propagate to all captured tabs
    const captured = this.registry.getCapturedTabs();
    for (const tab of captured) {
      const effective = this.settings.isEffectiveAuto(tab.normalizationEnabled);
      try {
        await chrome.runtime.sendMessage(createMessage(MessageTypes.SET_NORMALIZATION, MessageTargets.OFFSCREEN, {
          tabId: tab.tabId,
          normalizationEnabled: effective
        }));
      } catch (_) {}
    }
  }

  async setGlobalTargetLufs(targetLufs) {
    this.settings.setGlobalTargetLufs(targetLufs);
    logger.info('Global target LUFS changed', { targetLufs });

    // Propagate to all captured tabs
    const captured = this.registry.getCapturedTabs();
    for (const tab of captured) {
      try {
        await chrome.runtime.sendMessage(createMessage(MessageTypes.SET_TARGET, MessageTargets.OFFSCREEN, {
          tabId: tab.tabId,
          targetLufs
        }));
      } catch (_) {}
    }
  }

  handleTabClosed(tabId) {
    logger.info('Tab closed by browser, cleaning up coordinator registry', { tabId });
    this.stopManagingTab(tabId).catch(() => {});
    this.registry.removeTab(tabId);
  }

  handleTabUpdated(tabId, changeInfo) {
    this.registry.updateMetadata(tabId, {
      title: changeInfo.title,
      url: changeInfo.url,
      audible: changeInfo.audible
    });
  }

  handleMetricsUpdate(metrics) {
    if (metrics && metrics.tabId) {
      this.registry.updateMetrics(metrics.tabId, metrics);
    }
  }
}
