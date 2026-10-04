/**
 * WebAudioBalance - Phase R3 Product UX & UI Unit Verification Suite
 * Tests status presenter precedence, continuous balanced dwell time, relative level formatting,
 * and URL support classifications
 * Compliant with R3 Product UX & Real-World Validation Implementation Specification
 */

import assert from 'node:assert/strict';

import {
  ListeningLevels,
  getListeningLevelByTarget,
  presentTabStatus,
  formatRelativeLevel,
  checkUrlSupport,
  resetDwellTracker,
  BALANCED_DWELL_MS,
  BALANCED_TOLERANCE_LU
} from '../src/popup/state-presenter.js';

import { ErrorCodes, createRuntimeError } from '../src/shared/failure-taxonomy.js';

console.log('Starting R3 Product UX & UI Unit Verification Suite...\n');

let passCount = 0;
function testAssert(condition, message) {
  assert.ok(condition, message);
  console.log(`  [PASS] ${message}`);
  passCount++;
}

// ============================================================================
// SUITE 1: Listening Levels Mapping & Defaults (Section 4.2)
// ============================================================================
console.log('=== [R3 SUITE] 1. Listening Levels Mapping & Defaults ===');

testAssert(ListeningLevels.length === 3, 'Listening levels defined with exactly 3 presets');
testAssert(getListeningLevelByTarget(-24.0).id === 'quiet', '-24.0 LUFS maps to Quiet preset');
testAssert(getListeningLevelByTarget(-18.0).id === 'normal', '-18.0 LUFS maps to Normal preset');
testAssert(getListeningLevelByTarget(-14.0).id === 'loud', '-14.0 LUFS maps to Loud preset');
testAssert(getListeningLevelByTarget(-22.0).id === 'quiet', 'Boundary -22.0 LUFS maps to Quiet');
testAssert(getListeningLevelByTarget(-15.5).id === 'loud', 'Boundary -15.5 LUFS maps to Loud');

// ============================================================================
// SUITE 2: Relative Level Consumer Terminology (Section 6)
// ============================================================================
console.log('\n=== [R3 SUITE] 2. Relative Level Consumer Terminology ===');

testAssert(formatRelativeLevel(0.0) === 'Normal (0.0 dB)', '0.0 dB formats as "Normal (0.0 dB)"');
testAssert(formatRelativeLevel(0.02) === 'Normal (0.0 dB)', 'Near-zero 0.02 dB formats as "Normal (0.0 dB)"');
testAssert(formatRelativeLevel(3.0) === '+3.0 dB (Louder)', '+3.0 dB formats as "+3.0 dB (Louder)"');
testAssert(formatRelativeLevel(-4.5) === '-4.5 dB (Quieter)', '-4.5 dB formats as "-4.5 dB (Quieter)"');

// ============================================================================
// SUITE 3: Status Presenter Precedence (Section 7.1)
// ============================================================================
console.log('\n=== [R3 SUITE] 3. Status Presenter Precedence ===');

resetDwellTracker();

// 1. Error state precedence over everything
const errTab = {
  tabId: 101,
  intent: { managed: true, normalizationEnabled: true },
  runtime: {
    captured: true,
    active: true,
    limited: false,
    lastRuntimeError: createRuntimeError(ErrorCodes.AUDIO_COMMAND_REJECTED, 'Hardware device disconnected')
  },
  audio: { outputShortTermValid: true, outputTargetErrorLu: 0.0 }
};
const errStatus = presentTabStatus(errTab);
testAssert(errStatus.status === 'error', 'Error state takes top precedence');
testAssert(errStatus.badgeText === 'Error', 'Error badge displayed');

// 2. Connecting precedence over paused/active
const connTab = {
  tabId: 102,
  intent: { managed: true },
  runtime: { captured: false, active: false, lastRuntimeError: null }
};
const connStatus = presentTabStatus(connTab);
testAssert(connStatus.status === 'connecting', 'Managed but uncaptured presents as Connecting...');

// 3. Paused precedence over normal balanced
const pausedTab = {
  tabId: 103,
  intent: { managed: true, normalizationEnabled: true },
  runtime: { captured: true, active: false, lastRuntimeError: null },
  audio: { outputShortTermValid: true, outputTargetErrorLu: 0.0 }
};
const pausedStatus = presentTabStatus(pausedTab);
testAssert(pausedStatus.status === 'paused', 'Captured but inactive presents as Paused');

// 4. Limited precedence over balanced
const limitedTab = {
  tabId: 104,
  intent: { managed: true, normalizationEnabled: true },
  runtime: { captured: true, active: true, limited: true, limitReason: 'headroom', lastRuntimeError: null },
  audio: { outputShortTermValid: true, outputTargetErrorLu: 0.0 } // target error 0, but limited
};
const limitedStatus = presentTabStatus(limitedTab);
testAssert(limitedStatus.status === 'limited', 'Active limited tab presents as Limited (not Balanced)');
testAssert(limitedStatus.tooltip.includes('Headroom ceiling'), 'Limited status includes headroom ceiling explanation');

// 5. Manual precedence over balancing
const manualTab = {
  tabId: 105,
  intent: { managed: true, normalizationEnabled: false },
  runtime: { captured: true, active: true, limited: false, lastRuntimeError: null },
  audio: { outputShortTermValid: true, outputTargetErrorLu: 2.0 }
};
const manualStatus = presentTabStatus(manualTab);
testAssert(manualStatus.status === 'manual', 'Auto-norm disabled presents as Manual');

// ============================================================================
// SUITE 4: Balanced Dwell Time Requirement (Section 7.7 & Gate 597)
// ============================================================================
console.log('\n=== [R3 SUITE] 4. Balanced Dwell Time Requirement ===');

resetDwellTracker();

const balancingTab = {
  tabId: 201,
  intent: { managed: true, normalizationEnabled: true },
  runtime: { captured: true, active: true, limited: false, lastRuntimeError: null },
  audio: { outputShortTermValid: true, outputTargetErrorLu: 0.2 } // Well within ±1.0 LU tolerance
};

const t0 = 1000000;
// At t0: first entry into tolerance
const st0 = presentTabStatus(balancingTab, t0);
testAssert(st0.status === 'balancing', 'Initial entry into ±1.0 LU tolerance is Balancing (dwell start)');

// At t0 + 500ms (< 1500ms)
const st500 = presentTabStatus(balancingTab, t0 + 500);
testAssert(st500.status === 'balancing', 'At 500ms in tolerance, status remains Balancing');

// At t0 + 1499ms (< 1500ms)
const st1499 = presentTabStatus(balancingTab, t0 + 1499);
testAssert(st1499.status === 'balancing', 'At 1499ms (< 1500ms dwell), status remains Balancing');

// At t0 + 1500ms (>= 1500ms)
const st1500 = presentTabStatus(balancingTab, t0 + 1500);
testAssert(st1500.status === 'balanced', 'At 1500ms continuous dwell in tolerance, status transitions to Balanced');

// Tolerance disturbance: outputTargetErrorLu jumps to 1.8 LU at t0 + 2000ms
balancingTab.audio.outputTargetErrorLu = 1.8;
const stSpike = presentTabStatus(balancingTab, t0 + 2000);
testAssert(stSpike.status === 'balancing', 'When target error exceeds 1.0 LU, status immediately drops to Balancing');

// Restored to tolerance at t0 + 2100ms
balancingTab.audio.outputTargetErrorLu = 0.1;
const stRestored = presentTabStatus(balancingTab, t0 + 2100);
testAssert(stRestored.status === 'balancing', 'When tolerance restored, dwell restarts from 0 (status is Balancing)');

// Restored + 1500ms at t0 + 3600ms
const stRebalanced = presentTabStatus(balancingTab, t0 + 3600);
testAssert(stRebalanced.status === 'balanced', 'Re-balanced after full 1500ms dwell window');

// ============================================================================
// SUITE 5: URL Support Classification (Section 8)
// ============================================================================
console.log('\n=== [R3 SUITE] 5. URL Support Classification ===');

const edgeInternal = checkUrlSupport('edge://settings/appearance');
testAssert(edgeInternal.supported === false, 'edge:// internal page correctly identified as unsupported');

const chromeInternal = checkUrlSupport('chrome://extensions');
testAssert(chromeInternal.supported === false, 'chrome:// internal page correctly identified as unsupported');

const webStore = checkUrlSupport('https://chromewebstore.google.com/detail/xyz');
testAssert(webStore.supported === false, 'Extension store page correctly identified as unsupported');

const validSite = checkUrlSupport('https://youtube.com/watch?v=123');
testAssert(validSite.supported === true, 'Public HTTPS website correctly identified as supported');

// ============================================================================
// CLOSEOUT & SUMMARY
// ============================================================================
console.log('\n=============================================');
console.log(`R3 PRODUCT UX & UI SUITE: ${passCount} PASSED, 0 FAILED`);
console.log('=============================================\n');
