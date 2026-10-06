/**
 * WebAudioBalance - RA Authorization & Multi-Tab Recovery Unit Test Suite
 * Validates RA-1 (Capture authorization model), RA-2 (Popup and user workflow correction),
 * Gate RA-G3 (No remote unauthorized capture), Gate RA-G5 (Unsupported-page behavior),
 * and Gate RA-G6 (No stale managed state after auth failure).
 */

import assert from 'node:assert/strict';
import { ErrorCodes, FailureTaxonomy, createRuntimeError, classifyFailure } from '../src/shared/failure-taxonomy.js';
import { MultiTabCoordinator } from '../src/control/coordinator.js';
import { checkUrlSupport } from '../src/popup/state-presenter.js';
import { MessageTypes, MessageTargets } from '../src/shared/messages.js';

console.log('Starting RA Authorization & Multi-Tab Recovery Unit Test Suite...\n');

let passCount = 0;
function testAssert(condition, message) {
  assert.ok(condition, message);
  console.log(`  [PASS] ${message}`);
  passCount++;
}

// ============================================================================
// SUITE 1: Failure Classification & Product User Messages (Section 5.5)
// ============================================================================
console.log('=== [RA SUITE] 1. Error Taxonomy & User Message Classification ===');

testAssert(ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED === 'CAPTURE_AUTHORIZATION_REQUIRED', 'CAPTURE_AUTHORIZATION_REQUIRED code defined');

const authErr = createRuntimeError(ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED, 'Authorization required');
const classifiedAuth = classifyFailure(authErr);
testAssert(classifiedAuth.category === FailureTaxonomy.PERMISSION_ACTIVATION_FAILURE, 'Classified into PERMISSION_ACTIVATION_FAILURE category');
testAssert(
  classifiedAuth.userMessage === 'Open this tab and enable WebAudioBalance from that tab before balancing it.',
  'Authorization required maps to exact product message'
);
testAssert(classifiedAuth.actionable === true, 'Authorization failure is actionable');

const unsupportedErr = createRuntimeError(ErrorCodes.UNSUPPORTED_TAB, 'Cannot capture page');
const classifiedUnsupported = classifyFailure(unsupportedErr, { url: 'chrome://extensions' });
testAssert(classifiedUnsupported.category === FailureTaxonomy.BROWSER_SPECIFIC_FAILURE, 'Classified into BROWSER_SPECIFIC_FAILURE category');
testAssert(
  classifiedUnsupported.userMessage === 'This browser page cannot be captured.',
  'Unsupported page maps to exact product message'
);
testAssert(classifiedUnsupported.actionable === false, 'Unsupported page error is not actionable');

const runtimeStartErr = createRuntimeError(ErrorCodes.AUDIO_ENGINE_START_FAILED, 'AudioContext crashed');
const classifiedRuntime = classifyFailure(runtimeStartErr);
testAssert(
  classifiedRuntime.userMessage === 'WebAudioBalance could not start audio processing for this tab.',
  'Audio runtime failure maps to exact product message'
);

// ============================================================================
// SUITE 2: Unsupported URL Identification (Section 4.7 & Gate RA-G5)
// ============================================================================
console.log('\n=== [RA SUITE] 2. Unsupported URL Identification (Gate RA-G5) ===');

testAssert(checkUrlSupport('chrome://settings').supported === false, 'chrome:// rejected');
testAssert(checkUrlSupport('edge://flags').supported === false, 'edge:// rejected');
testAssert(checkUrlSupport('chrome-extension://xyz/options.html').supported === false, 'chrome-extension:// rejected');
testAssert(checkUrlSupport('https://chromewebstore.google.com/item/123').supported === false, 'Chrome Web Store rejected');
testAssert(checkUrlSupport('https://microsoftedge.microsoft.com/addons/detail/123').supported === false, 'Edge Addons store rejected');
testAssert(checkUrlSupport('https://en.wikipedia.org/wiki/Audio').supported === true, 'Standard https supported');
testAssert(checkUrlSupport('http://localhost:3000').supported === true, 'Standard http supported');

// ============================================================================
// SUITE 3: Coordinator Capture Contract & No Stale Managed State (Gate RA-G6)
// ============================================================================
console.log('\n=== [RA SUITE] 3. Transaction Ordering & No Stale Managed State (Gate RA-G6) ===');

const mockChrome = {
  runtime: {
    sendMessage: async () => ({ success: true }),
    getURL: (p) => p
  },
  tabs: {
    get: async (id) => ({ id, title: `Test Tab ${id}`, url: `https://example.com/${id}`, audible: true }),
    query: async () => []
  },
  tabCapture: {
    getCapturedTabs: (cb) => cb([])
  }
};
globalThis.chrome = mockChrome;

const coordinator = new MultiTabCoordinator();
await coordinator.init();

// Attempt startManagingTab without streamId
const noStreamRes = await coordinator.startManagingTab(1234, null);
testAssert(noStreamRes.success === false, 'startManagingTab rejects null streamId');
testAssert(noStreamRes.error.code === ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED, 'Returns CAPTURE_AUTHORIZATION_REQUIRED');

// Assert Gate RA-G6: Tab must NOT have stale managed intent!
const tab1234 = coordinator.registry.getTab(1234);
testAssert(tab1234.intent.managed === false, 'Tab managed intent is false after auth failure (Gate RA-G6)');
testAssert(tab1234.runtime.captured === false, 'Tab captured is false after auth failure');
testAssert(tab1234.runtime.lastRuntimeError.code === ErrorCodes.CAPTURE_AUTHORIZATION_REQUIRED, 'Last runtime error recorded');

const snapshot = coordinator.getSnapshot();
const inManaged = snapshot.managedTabs.some((t) => t.tabId === 1234);
testAssert(inManaged === false, 'Failed tab is NOT present in managedTabs canonical snapshot');

// Now provide valid streamId and successful runtime
coordinator.queryAudioRuntimeSnapshot = async () => ({
  runtimeInstanceId: 'rt_mock_1',
  engines: [{ tabId: 1234, engineState: 'RUNNING', audioContextState: 'running' }]
});

const okRes = await coordinator.startManagingTab(1234, 'stream_valid_auth');
testAssert(okRes.success === true, 'startManagingTab succeeds with authorized streamId');
testAssert(tab1234.intent.managed === true, 'Tab becomes managed after successful transaction');
testAssert(tab1234.runtime.captured === true, 'Tab becomes captured after runtime confirmation');

// Clean up
await coordinator.stopManagingTab(1234);
testAssert(tab1234.intent.managed === false, 'Tab released cleanly');

// ============================================================================
// CLOSEOUT & SUMMARY
// ============================================================================
console.log('\n=============================================');
console.log(`RA RECOVERY UNIT SUITE: ${passCount} PASSED, 0 FAILED`);
console.log('=============================================\n');
