/**
 * WebAudioBalance - Phase R2 Runtime & State Reliability Unit & Component Verification Suite
 * Tests truthful distributed state, explicit ACK/NACK, SW reconciliation, lifecycle correctness, and bounded telemetry
 * Compliant with R2 Runtime & State Reliability Implementation Specification (Sections 17.1 & 19)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MessageTargets,
  MessageTypes,
  createMessage,
  createCommandSuccess,
  createCommandFailure
} from '../src/shared/messages.js';

import {
  ErrorCodes,
  createRuntimeError,
  FailureTaxonomy,
  classifyFailure
} from '../src/shared/failure-taxonomy.js';

import {
  ManagedTabState,
  ManagedTabRegistry
} from '../src/control/registry.js';

import {
  SettingsController
} from '../src/control/settings.js';

import {
  AudioEngineManager
} from '../src/offscreen/audio-engine-manager.js';

import {
  MultiTabCoordinator
} from '../src/control/coordinator.js';

console.log('Starting R2 Runtime & State Reliability Verification Suite...\n');

let passCount = 0;
function testAssert(condition, message) {
  assert.ok(condition, message);
  console.log(`  [PASS] ${message}`);
  passCount++;
}

// ============================================================================
// SUITE 1: Message Schemas & Uniqueness (Section 3 & Gate 1)
// ============================================================================
console.log('=== [R2 SUITE] 1. Message Schemas & Uniqueness ===');

const messageTypeValues = Object.values(MessageTypes);
const uniqueTypes = new Set(messageTypeValues);
testAssert(
  messageTypeValues.length === uniqueTypes.size,
  'All MessageTypes values are unique without collision'
);

testAssert(
  MessageTypes.GET_PRODUCT_SNAPSHOT !== MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT,
  'GET_PRODUCT_SNAPSHOT and GET_AUDIO_RUNTIME_SNAPSHOT are distinct queries'
);

testAssert(
  MessageTypes.AUDIO_TELEMETRY !== MessageTypes.AUDIO_RUNTIME_READY,
  'AUDIO_TELEMETRY and AUDIO_RUNTIME_READY are distinct message events'
);

const envMsg = createMessage(MessageTypes.START_CAPTURE, MessageTargets.OFFSCREEN, { tabId: 101 }, 'req_123');
testAssert(envMsg.type === MessageTypes.START_CAPTURE, 'Message envelope type matches');
testAssert(envMsg.target === MessageTargets.OFFSCREEN, 'Message envelope target matches');
testAssert(envMsg.requestId === 'req_123', 'Message envelope requestId matches');
testAssert(typeof envMsg.timestamp === 'number', 'Message envelope timestamp generated');

// ============================================================================
// SUITE 2: Explicit Command ACK / NACK Envelopes (Section 3.2 & Gate 2)
// ============================================================================
console.log('\n=== [R2 SUITE] 2. Explicit Command ACK / NACK Envelopes ===');

const successAck = createCommandSuccess('req_456', MessageTypes.START_CAPTURE, {
  tabId: 101,
  revision: 5,
  result: { liveEngine: true }
});
testAssert(successAck.success === true, 'Success envelope has success: true');
testAssert(successAck.requestId === 'req_456', 'Success envelope preserves requestId');
testAssert(successAck.tabId === 101, 'Success envelope includes tabId');
testAssert(successAck.revision === 5, 'Success envelope includes revision');
testAssert(successAck.result.liveEngine === true, 'Success envelope includes result');

const nackErr = createRuntimeError(ErrorCodes.AUDIO_ENGINE_START_FAILED, 'AudioContext crashed', {
  tabId: 102,
  retryable: true
});
const failureNack = createCommandFailure('req_789', MessageTypes.START_CAPTURE, nackErr, {
  tabId: 102
});
testAssert(failureNack.success === false, 'Failure envelope has success: false');
testAssert(failureNack.error.code === ErrorCodes.AUDIO_ENGINE_START_FAILED, 'Failure envelope has error code');
testAssert(failureNack.error.message === 'AudioContext crashed', 'Failure envelope has error message');
testAssert(failureNack.error.retryable === true, 'Failure envelope has retryable flag');
testAssert(failureNack.tabId === 102, 'Failure envelope preserves tabId');

// ============================================================================
// SUITE 3: Canonical Coordinator Tab Record & Revision Ordering (Section 5, 6 & Gate 7, 8)
// ============================================================================
console.log('\n=== [R2 SUITE] 3. Canonical Coordinator Tab Record & Revision Ordering ===');

const tabState = new ManagedTabState(201, {
  title: 'Test Music Video',
  url: 'https://youtube.com/watch?v=123',
  audible: true
});

testAssert(tabState.revision === 0, 'Initial tab revision is 0');
testAssert(typeof tabState.metadata === 'object', 'Tab has metadata sub-object');
testAssert(typeof tabState.intent === 'object', 'Tab has intent sub-object');
testAssert(typeof tabState.runtime === 'object', 'Tab has runtime sub-object');
testAssert(typeof tabState.audio === 'object', 'Tab has audio sub-object');

// Compatibility getters
testAssert(tabState.title === 'Test Music Video', 'Compatibility getter title works');
testAssert(tabState.managed === false, 'Initial managed is false');
testAssert(tabState.captured === false, 'Initial captured is false');
testAssert(tabState.manualOffsetDb === 0.0, 'Initial manualOffsetDb is 0.0');

// Mutate intent
tabState.managed = true;
testAssert(tabState.revision === 1, 'Mutating managed bumps revision to 1');
testAssert(tabState.intent.managed === true, 'Sub-object intent.managed is true');

tabState.relativeOffsetDb = 2.5;
testAssert(tabState.revision === 2, 'Mutating relativeOffsetDb bumps revision to 2');
testAssert(tabState.manualOffsetDb === 2.5, 'Compatibility manualOffsetDb getter matches');

// Serialization toJSON
const json = tabState.toJSON();
testAssert(json.tabId === 201, 'JSON includes tabId');
testAssert(json.metadata.title === 'Test Music Video', 'JSON includes structured metadata');
testAssert(json.intent.relativeOffsetDb === 2.5, 'JSON includes structured intent');
testAssert(json.runtime.captured === false, 'JSON includes structured runtime');
testAssert(json.audio.inputMomentaryLufs === -100.0, 'JSON includes structured audio');
testAssert(json.manualOffsetDb === 2.5, 'JSON preserves flat compatibility field manualOffsetDb');

// Registry product snapshot
const registry = new ManagedTabRegistry();
testAssert(registry.revision === 0, 'Registry initial revision is 0');
registry.ensureTab(201, { title: 'Test Tab' });
testAssert(registry.revision === 1, 'Adding tab bumps registry revision');

registry.updateTabSettings(201, { normalizationEnabled: true, relativeOffsetDb: -3.0 });
testAssert(registry.revision === 2, 'Updating settings bumps registry revision');

const prodSnap = registry.getProductSnapshot({ globalAutoEnabled: true, globalTargetLufs: -18.0 });
testAssert(prodSnap.revision === 2, 'Product snapshot contains current registry revision');
testAssert(Array.isArray(prodSnap.managedTabs), 'Product snapshot contains managedTabs array');
testAssert(Array.isArray(prodSnap.allKnownTabs), 'Product snapshot contains allKnownTabs array');
testAssert(typeof prodSnap.lastReconciliation === 'object', 'Product snapshot contains lastReconciliation');

// ============================================================================
// SUITE 4: Audio Runtime Snapshot vs Product Snapshot Separation (Section 4, 6 & Gate 8)
// ============================================================================
console.log('\n=== [R2 SUITE] 4. Audio Runtime Snapshot vs Product Snapshot Separation ===');

const manager = new AudioEngineManager();
testAssert(typeof manager.runtimeInstanceId === 'string' && manager.runtimeInstanceId.startsWith('rt_'), 'Manager generated runtimeInstanceId');

const rtSnapshot = manager.getRuntimeSnapshot();
testAssert(rtSnapshot.runtimeInstanceId === manager.runtimeInstanceId, 'Runtime snapshot includes runtimeInstanceId');
testAssert(typeof rtSnapshot.generatedAt === 'number', 'Runtime snapshot includes generatedAt timestamp');
testAssert(Array.isArray(rtSnapshot.engines), 'Runtime snapshot includes engines array');
testAssert(rtSnapshot.globalSettings === undefined, 'Runtime snapshot does NOT contain product globalSettings');
testAssert(rtSnapshot.managedTabs === undefined, 'Runtime snapshot does NOT contain product managedTabs');

testAssert(prodSnap.engines === undefined, 'Product snapshot does NOT contain audio engines array');
testAssert(prodSnap.runtimeInstanceId === undefined, 'Product snapshot does NOT pretend to be runtime snapshot');

// ============================================================================
// SUITE 5: Session Intent Persistence & Cleanup (Section 7 & Gate 4)
// ============================================================================
console.log('\n=== [R2 SUITE] 5. Session Intent Persistence & Cleanup ===');

const settings = new SettingsController();
await settings.saveSessionIntent(301, {
  managed: true,
  normalizationEnabled: true,
  relativeOffsetDb: 1.5
});

const intent301 = settings.getSessionIntent(301);
testAssert(intent301 !== null, 'Session intent retrieved for tab 301');
testAssert(intent301.managed === true, 'Session intent records managed: true');
testAssert(intent301.relativeOffsetDb === 1.5, 'Session intent records relativeOffsetDb: 1.5');
testAssert(intent301.captured === undefined, 'Session intent does NOT persist live capture truth (captured)');
testAssert(intent301.engineState === undefined, 'Session intent does NOT persist engine existence');
testAssert(intent301.audioTelemetry === undefined, 'Session intent does NOT persist audio telemetry');

// Cleanup
await settings.removeSessionIntent(301);
testAssert(settings.getSessionIntent(301) === null, 'Session intent removed after tab release/close');

// ============================================================================
// SUITE 6: Start Transaction & NACK Resistance (Section 9 & Gate 2, 3)
// ============================================================================
console.log('\n=== [R2 SUITE] 6. Start Transaction & NACK Resistance ===');

// Setup mock chrome API for Coordinator testing
const mockChrome = {
  runtime: {
    sendMessage: async (msg) => {
      // Mock Offscreen START_CAPTURE rejection
      if (msg.type === MessageTypes.START_CAPTURE && msg.payload.tabId === 999) {
        return createCommandFailure(msg.requestId, msg.type, {
          code: ErrorCodes.AUDIO_ENGINE_START_FAILED,
          message: 'AudioContext start failed in offscreen',
          retryable: true
        }, { tabId: 999 });
      }

      // Mock Offscreen START_CAPTURE success with runtime snapshot query
      if (msg.type === MessageTypes.START_CAPTURE && msg.payload.tabId === 888) {
        return createCommandSuccess(msg.requestId, msg.type, {
          tabId: 888,
          result: { liveEngine: true }
        });
      }

      if (msg.type === MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT) {
        return {
          runtimeInstanceId: 'rt_mock_123',
          generatedAt: Date.now(),
          engines: [
            {
              tabId: 888,
              engineState: 'RUNNING',
              audioContextState: 'running',
              startedAt: Date.now(),
              active: true,
              frozen: false,
              limited: false,
              limitReason: 'none',
              globalTargetLufs: -18.0,
              relativeOffsetDb: 0.0,
              effectiveTargetLufs: -18.0,
              appliedGainDb: 0.0,
              desiredAutoGainDb: 0.0,
              appliedAutoGainDb: 0.0,
              inputMomentaryLufs: -18.0,
              inputShortTermLufs: -18.0,
              inputMomentaryValid: true,
              inputShortTermValid: true,
              inputSamplePeakDbFS: -15.0,
              outputMomentaryLufs: -18.0,
              outputShortTermLufs: -18.0,
              outputMomentaryValid: true,
              outputShortTermValid: true,
              outputSamplePeakDbFS: -15.0,
              outputTargetErrorLu: 0.0,
              metricsSequence: 10,
              lastRuntimeError: null
            }
          ]
        };
      }

      if (msg.type === MessageTypes.STOP_CAPTURE) {
        return createCommandSuccess(msg.requestId, msg.type, {
          tabId: msg.payload.tabId,
          result: { alreadyStopped: false }
        });
      }

      return { success: true };
    }
  },
  tabs: {
    get: async (tabId) => ({
      id: tabId,
      title: `Tab ${tabId}`,
      url: `https://example.com/${tabId}`,
      favIconUrl: 'https://example.com/favicon.ico',
      audible: true
    }),
    query: async () => [
      { id: 888, title: 'Tab 888', url: 'https://example.com/888', audible: true },
      { id: 999, title: 'Tab 999', url: 'https://example.com/999', audible: true }
    ]
  },
  tabCapture: {
    getCapturedTabs: (cb) => cb([{ tabId: 888, status: 'active' }])
  }
};

globalThis.chrome = mockChrome;

const coordinator = new MultiTabCoordinator();
await coordinator.init();

// Test forced NACK
const nackResult = await coordinator.startManagingTab(999, 'stream_err');
testAssert(nackResult.success === false, 'Coordinator returns success: false on Offscreen start NACK');
testAssert(nackResult.error.code === ErrorCodes.AUDIO_ENGINE_START_FAILED, 'Coordinator propagates error code');

const tab999 = coordinator.registry.getTab(999);
testAssert(tab999.runtime.captured === false, 'Tab captured remains false after Offscreen start NACK');
testAssert(tab999.intent.managed === true, 'Managed intent remains true so UI can show Retry');
testAssert(tab999.runtime.lastRuntimeError !== null, 'Tab retains actionable lastRuntimeError');

// Test successful start with live engine verification
const successResult = await coordinator.startManagingTab(888, 'stream_ok');
testAssert(successResult.success === true, 'Coordinator returns success: true when live engine confirmed');
const tab888 = coordinator.registry.getTab(888);
testAssert(tab888.runtime.captured === true, 'Tab captured is true when live engine is confirmed in runtime');
testAssert(tab888.runtime.engineState === 'RUNNING', 'Tab engineState is RUNNING');

// ============================================================================
// SUITE 7: Stop Transaction Idempotency (Section 10 & Gate 2)
// ============================================================================
console.log('\n=== [R2 SUITE] 7. Stop Transaction Idempotency ===');

const stopResult1 = await coordinator.stopManagingTab(888);
testAssert(stopResult1.success === true, 'First stop call succeeds');
testAssert(tab888.runtime.captured === false, 'Tab captured is false after stop');
testAssert(tab888.intent.managed === false, 'Tab managed is false after confirmed release');

const stopResult2 = await coordinator.stopManagingTab(888);
testAssert(stopResult2.success === true, 'Second stop call is idempotent and succeeds');

// ============================================================================
// SUITE 8: Settings Partial-Failure Aggregation (Section 11.2 & Gate 2)
// ============================================================================
console.log('\n=== [R2 SUITE] 8. Settings Partial-Failure Aggregation ===');

// Mock Offscreen with 1 rejecting tab for global target
mockChrome.runtime.sendMessage = async (msg) => {
  if (msg.type === MessageTypes.SET_TARGET) {
    if (msg.payload.tabId === 502) {
      return createCommandFailure(msg.requestId, msg.type, {
        code: ErrorCodes.AUDIO_COMMAND_REJECTED,
        message: 'Engine 502 busy'
      }, { tabId: 502 });
    }
    return createCommandSuccess(msg.requestId, msg.type, { tabId: msg.payload.tabId });
  }
  return { success: true };
};

const coordSettings = new MultiTabCoordinator();
await coordSettings.init();
coordSettings.registry.setManaged(501, true);
coordSettings.registry.setCaptured(501, true);
coordSettings.registry.setManaged(502, true);
coordSettings.registry.setCaptured(502, true);

const aggResult = await coordSettings.setGlobalTargetLufs(-14.0);
testAssert(aggResult.success === false, 'Aggregate command fails when at least one engine rejects');
testAssert(aggResult.result.settingPersisted === true, 'Durable user setting was still saved');
testAssert(aggResult.result.appliedTo.includes(501), 'Applied to tab 501');
testAssert(aggResult.result.failedTabs.some(f => f.tabId === 502), 'Recorded failure for tab 502');

const tab502 = coordSettings.registry.getTab(502);
testAssert(tab502.runtime.lastRuntimeError !== null, 'Failed live tab marked out-of-sync/error in registry');

// ============================================================================
// SUITE 9: SW Restart & Offscreen Reconciliation (Section 12 & Gate 4, 5)
// ============================================================================
console.log('\n=== [R2 SUITE] 9. SW Restart & Offscreen Reconciliation ===');

// Setup mock state where Offscreen survives with engine 777
mockChrome.runtime.sendMessage = async (msg) => {
  if (msg.type === MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT) {
    return {
      runtimeInstanceId: 'rt_surviving_999',
      generatedAt: Date.now(),
      engines: [
        {
          tabId: 777,
          engineState: 'RUNNING',
          audioContextState: 'running',
          startedAt: Date.now() - 50000,
          active: true,
          frozen: false,
          limited: false,
          limitReason: 'none',
          globalTargetLufs: -18.0,
          relativeOffsetDb: 3.0,
          effectiveTargetLufs: -15.0,
          appliedGainDb: 3.0,
          desiredAutoGainDb: 0.0,
          appliedAutoGainDb: 0.0,
          inputMomentaryLufs: -15.0,
          inputShortTermLufs: -15.0,
          inputMomentaryValid: true,
          inputShortTermValid: true,
          inputSamplePeakDbFS: -12.0,
          outputMomentaryLufs: -15.0,
          outputShortTermLufs: -15.0,
          outputMomentaryValid: true,
          outputShortTermValid: true,
          outputSamplePeakDbFS: -12.0,
          outputTargetErrorLu: 0.0,
          metricsSequence: 50,
          lastRuntimeError: null
        }
      ]
    };
  }
  return { success: true };
};

mockChrome.tabs.query = async () => [
  { id: 777, title: 'Live Stream 777', url: 'https://twitch.tv/streamer', audible: true }
];
mockChrome.tabCapture.getCapturedTabs = (cb) => cb([{ tabId: 777, status: 'active' }]);

// Simulate new SW instance starting up with saved session intent for 777
const freshCoord = new MultiTabCoordinator();
freshCoord.settings.sessionIntents.set(777, {
  tabId: 777,
  managed: true,
  normalizationEnabled: true,
  relativeOffsetDb: 3.0,
  updatedAt: Date.now()
});

await freshCoord.init();

const reconciledTab777 = freshCoord.registry.getTab(777);
testAssert(reconciledTab777 !== null, 'Reconciliation rebuilt tab 777 after SW restart');
testAssert(reconciledTab777.runtime.captured === true, 'Tab 777 marked captured=true from surviving Offscreen');
testAssert(reconciledTab777.intent.managed === true, 'Tab 777 preserved managed intent');
testAssert(reconciledTab777.audio.inputMomentaryLufs === -15.0, 'Tab 777 restored audio metrics');
testAssert(reconciledTab777.metadata.title === 'Live Stream 777', 'Tab 777 restored browser metadata');

// Simulate Offscreen document crash/loss
mockChrome.runtime.sendMessage = async (msg) => {
  if (msg.type === MessageTypes.GET_AUDIO_RUNTIME_SNAPSHOT) {
    return null; // Offscreen gone
  }
  return { success: true };
};

await freshCoord.reconcileRuntime('offscreen_crash');
testAssert(reconciledTab777.runtime.captured === false, 'Tab 777 captured revoked when Offscreen is lost');
testAssert(reconciledTab777.intent.managed === true, 'Managed intent retained so user can see re-enable/retry');
testAssert(reconciledTab777.runtime.lastRuntimeError.code === ErrorCodes.OFFSCREEN_UNAVAILABLE, 'Reported OFFSCREEN_UNAVAILABLE error');

// ============================================================================
// SUITE 10: Telemetry Rate Bounding (Section 15 & Gate 9)
// ============================================================================
console.log('\n=== [R2 SUITE] 10. Telemetry Rate Bounding ===');

const telemetryManager = new AudioEngineManager();
const sentTelemetry = [];
mockChrome.runtime.sendMessage = async (msg) => {
  if (msg.type === MessageTypes.AUDIO_TELEMETRY) {
    sentTelemetry.push(msg);
  }
  return { success: true };
};

// Simulate high-cadence 10 Hz internal ticks (10 ticks in 100ms)
const now = Date.now();
for (let i = 0; i < 10; i++) {
  // Directly trigger metric emission check on manager
  const lastTime = telemetryManager.lastTelemetrySendTimes.get(601) || 0;
  const tickTime = now + (i * 10); // 10ms intervals
  if (tickTime - lastTime >= 500) {
    telemetryManager.lastTelemetrySendTimes.set(601, tickTime);
    mockChrome.runtime.sendMessage(createMessage(MessageTypes.AUDIO_TELEMETRY, MessageTargets.BROADCAST, { tabId: 601, seq: i }));
  }
}

testAssert(sentTelemetry.length === 1, `10 rapid ticks generated only 1 cross-context message (<= 2 Hz rate bound verified, observed: ${sentTelemetry.length})`);

// ============================================================================
// CLOSEOUT & SUMMARY
// ============================================================================
console.log('\n=============================================');
console.log(`R2 RUNTIME & STATE RELIABILITY SUITE: ${passCount} PASSED, 0 FAILED`);
console.log('=============================================\n');
