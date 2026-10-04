/**
 * WebAudioBalance - P3 Multi-tab Orchestration Test Suite
 */

import { ManagedTabRegistry } from '../src/control/registry.js';
import { SettingsController } from '../src/control/settings.js';
import { MultiTabCoordinator } from '../src/control/coordinator.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${message}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${message}`);
  }
}

// -------------------------------------------------------------
// Test Suite 1: ManagedTabRegistry & State Trinity
// -------------------------------------------------------------
console.log('\n--- 1. ManagedTabRegistry & State Trinity ---');
const registry = new ManagedTabRegistry();

// Create Tab 1
const tab1 = registry.ensureTab(101, { title: 'YouTube - Podcast', url: 'https://youtube.com', audible: true });
assert(!tab1.managed && !tab1.captured && !tab1.active, 'Initial tab state is unmanaged, uncaptured, inactive');

// User enables tab 1
registry.setManaged(101, true);
assert(tab1.managed && !tab1.captured && !tab1.active, 'User enabled -> managed=true, captured=false, active=false');

// Capture starts
registry.setCaptured(101, true);
assert(tab1.managed && tab1.captured && !tab1.active, 'Capture acquired -> managed=true, captured=true, active=false');

// Audio becomes active
registry.setActive(101, true);
assert(tab1.managed && tab1.captured && tab1.active, 'Audio streaming -> managed=true, captured=true, active=true');

// Video pauses -> active drops to false, but captured and managed stay true!
registry.setActive(101, false);
assert(tab1.managed && tab1.captured && !tab1.active, 'Media paused -> managed=true, captured=true, active=false (Orthogonal state separation verified)');

// User disables tab -> clears captured and active
registry.setManaged(101, false);
assert(!tab1.managed && !tab1.captured && !tab1.active, 'User disabled -> unmanaged, uncaptured, inactive');

// -------------------------------------------------------------
// Test Suite 2: SettingsController & Effective Normalization Formula
// -------------------------------------------------------------
console.log('\n--- 2. SettingsController & Effective Formula ---');
const settings = new SettingsController();

assert(settings.globalAutoEnabled === true, 'Default globalAutoEnabled is true');
assert(settings.globalTargetLufs === -18.0, 'Default globalTargetLufs is -18.0 LUFS');

// Formula: effectiveAuto = globalAutoEnabled AND tabAutoEnabled
assert(settings.isEffectiveAuto(true) === true, 'Global ON + Tab ON -> Effective ON');
assert(settings.isEffectiveAuto(false) === false, 'Global ON + Tab OFF -> Effective OFF');

settings.setGlobalAutoEnabled(false);
assert(settings.isEffectiveAuto(true) === false, 'Global OFF + Tab ON -> Effective OFF');
assert(settings.isEffectiveAuto(false) === false, 'Global OFF + Tab OFF -> Effective OFF');

settings.setGlobalAutoEnabled(true);
settings.setGlobalTargetLufs(-14.0);
assert(settings.globalTargetLufs === -14.0, 'Global target updated to -14.0 LUFS');

// Clamping bounds: -36 to -6
settings.setGlobalTargetLufs(-50);
assert(settings.globalTargetLufs === -36.0, 'Underflow clamped to -36.0 LUFS');
settings.setGlobalTargetLufs(0);
assert(settings.globalTargetLufs === -6.0, 'Overflow clamped to -6.0 LUFS');

// -------------------------------------------------------------
// Test Suite 3: MultiTabCoordinator & Cross-Tab Independence
// -------------------------------------------------------------
console.log('\n--- 3. MultiTabCoordinator & Multi-Tab Isolation ---');

// Mock chrome.runtime for Node environment
const dispatchedMessages = [];
globalThis.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      dispatchedMessages.push(msg);
      return { success: true };
    }
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  }
};

const coordinator = new MultiTabCoordinator();
await coordinator.init();

// Start Tab 101
await coordinator.startManagingTab(101, 'stream-101');
const tab101 = coordinator.registry.getTab(101);
assert(tab101.managed && tab101.captured, 'Tab 101 is managed and captured');

// Start Tab 102
await coordinator.startManagingTab(102, 'stream-102');
const tab102 = coordinator.registry.getTab(102);
assert(tab102.managed && tab102.captured, 'Tab 102 is managed and captured in parallel');

// Verify initial manual offset is 0 dB for both
assert(tab101.manualOffsetDb === 0.0 && tab102.manualOffsetDb === 0.0, 'Both tabs start with 0 dB manual offset');

// Set manual offset on Tab 101 to +3 dB
await coordinator.setTabManualOffset(101, 3.0);
assert(coordinator.registry.getTab(101).manualOffsetDb === 3.0, 'Tab 101 offset is +3.0 dB');
assert(coordinator.registry.getTab(102).manualOffsetDb === 0.0, 'Tab 102 offset remains 0.0 dB (No crosstalk)');

// Update metrics on Tab 101: simulates loud source
coordinator.handleMetricsUpdate({
  tabId: 101,
  momentaryLufs: -10.0,
  shortTermLufs: -11.0,
  autoGainDb: -7.0,
  effectiveGainDb: -4.0,
  isActive: true
});

assert(coordinator.registry.getTab(101).shortTermLufs === -11.0, 'Tab 101 metrics updated to -11.0 LUFS');
assert(coordinator.registry.getTab(102).shortTermLufs === -100.0, 'Tab 102 metrics completely independent (No shared AGC)');

// Disable auto-normalization on Tab 102 only
await coordinator.setTabNormalization(102, false);
assert(coordinator.registry.getTab(102).normalizationEnabled === false, 'Tab 102 normalization disabled');
assert(coordinator.registry.getTab(101).normalizationEnabled === true, 'Tab 101 normalization remains enabled');

// Global target change propagates
await coordinator.setGlobalTargetLufs(-16.0);
assert(coordinator.settings.globalTargetLufs === -16.0, 'Global target updated to -16.0 LUFS');

// Close Tab 101
coordinator.handleTabClosed(101);
assert(coordinator.registry.getTab(101) === null, 'Tab 101 removed cleanly on tab close');
assert(coordinator.registry.getTab(102) !== null, 'Tab 102 continues running undisturbed');

// Snapshot generation
const snapshot = coordinator.getSnapshot();
assert(snapshot.globalSettings.globalTargetLufs === -16.0, 'Snapshot contains current global settings');
assert(snapshot.managedTabs.length === 1 && snapshot.managedTabs[0].tabId === 102, 'Snapshot contains active managed tab 102');

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n=============================================');
console.log(`P3 ORCHESTRATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
