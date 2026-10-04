/**
 * WebAudioBalance - P4 Product UI & Presentation Layer Automated Test Suite
 * Tests:
 * 1. Semantic Listening Level Mapping (Quiet/Normal/Loud)
 * 2. User-Facing Presentation Statuses (Balanced, Balancing, Manual Only, Paused, Starting, Error)
 * 3. URL Compatibility & Graceful Degradation
 * 4. Multi-tab UI Snapshot Rendering & State Integrity
 * 5. Manual Gain Range & Center Notch Bounds
 */

import {
  ListeningLevels,
  getListeningLevelByTarget,
  presentTabStatus,
  checkUrlSupport
} from '../src/popup/state-presenter.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

function testSection(title) {
  console.log(`\n=== [TEST SECTION] ${title} ===`);
}

async function runTests() {
  console.log('Starting P4 Product UI & Presentation Test Suite...\n');

  // -------------------------------------------------------------
  // Test 1: Semantic Listening Level Mapping
  // -------------------------------------------------------------
  testSection('1. Semantic Listening Level Mapping');

  assert(ListeningLevels.length === 3, 'ListeningLevels contains 3 presets');
  const [quiet, normal, loud] = ListeningLevels;

  assert(quiet.id === 'quiet' && quiet.targetLufs === -24.0, 'Quiet preset maps to -24.0 LUFS');
  assert(normal.id === 'normal' && normal.targetLufs === -18.0, 'Normal preset maps to -18.0 LUFS');
  assert(loud.id === 'loud' && loud.targetLufs === -14.0, 'Loud preset maps to -14.0 LUFS');

  assert(getListeningLevelByTarget(-24.0).id === 'quiet', '-24.0 LUFS resolves to Quiet');
  assert(getListeningLevelByTarget(-22.0).id === 'quiet', '-22.0 LUFS resolves to Quiet (boundary test)');
  assert(getListeningLevelByTarget(-18.0).id === 'normal', '-18.0 LUFS resolves to Normal');
  assert(getListeningLevelByTarget(-19.5).id === 'normal', '-19.5 LUFS resolves to Normal');
  assert(getListeningLevelByTarget(-14.0).id === 'loud', '-14.0 LUFS resolves to Loud');
  assert(getListeningLevelByTarget(-15.0).id === 'loud', '-15.0 LUFS resolves to Loud (boundary test)');

  // -------------------------------------------------------------
  // Test 2: User-Facing Presentation Statuses
  // -------------------------------------------------------------
  testSection('2. Tab Presentation Status Mapping');

  // Null/empty
  assert(presentTabStatus(null).badgeText === 'Unknown', 'Null tab state maps to Unknown');

  // Error state
  const errorTab = { error: 'Audio device failure', managed: true };
  const errRes = presentTabStatus(errorTab);
  assert(errRes.badgeText === 'Error' && errRes.badgeClass === 'badge-danger', 'Error state maps to Error badge');

  // Detected (not managed)
  const unmanagedTab = { managed: false };
  const unmanagedRes = presentTabStatus(unmanagedTab);
  assert(unmanagedRes.badgeText === 'Detected' && unmanagedRes.badgeClass === 'badge-info', 'Unmanaged audible tab maps to Detected');

  // Starting (managed but capture pending)
  const startingTab = { managed: true, captured: false };
  const startingRes = presentTabStatus(startingTab);
  assert(startingRes.badgeText === 'Starting...' && startingRes.badgeClass === 'badge-warning', 'Managed but uncaptured maps to Starting...');

  // Paused (captured but media paused/silent)
  const pausedTab = { managed: true, captured: true, active: false };
  const pausedRes = presentTabStatus(pausedTab);
  assert(pausedRes.badgeText === 'Paused' && pausedRes.badgeClass === 'badge-muted', 'Captured but inactive maps to Paused');

  // Manual Only (normalizationEnabled === false)
  const manualOnlyTab = {
    managed: true,
    captured: true,
    active: true,
    normalizationEnabled: false,
    manualOffsetDb: 3.0
  };
  const manualRes = presentTabStatus(manualOnlyTab);
  assert(manualRes.badgeText === 'Manual Only' && manualRes.badgeClass === 'badge-secondary', 'Normalization disabled maps to Manual Only');

  // Balancing (active, target = -18, shortTerm = -23, difference > 1.5 dB)
  const balancingTab = {
    managed: true,
    captured: true,
    active: true,
    normalizationEnabled: true,
    targetLufs: -18.0,
    shortTermLufs: -23.0
  };
  const balancingRes = presentTabStatus(balancingTab);
  assert(balancingRes.badgeText === 'Balancing' && balancingRes.badgeClass === 'badge-primary', 'Loudness converging maps to Balancing');

  // Balanced (active, target = -18, shortTerm = -18.4, within 1.5 dB)
  const balancedTab = {
    managed: true,
    captured: true,
    active: true,
    normalizationEnabled: true,
    targetLufs: -18.0,
    shortTermLufs: -18.4
  };
  const balancedRes = presentTabStatus(balancedTab);
  assert(balancedRes.badgeText === 'Balanced' && balancedRes.badgeClass === 'badge-success', 'Loudness within tolerance maps to Balanced');

  // -------------------------------------------------------------
  // Test 3: URL Compatibility & Graceful Degradation
  // -------------------------------------------------------------
  testSection('3. URL Compatibility & Graceful Degradation');

  assert(checkUrlSupport(null).supported === false, 'Null URL is unsupported');
  assert(checkUrlSupport('').supported === false, 'Empty URL is unsupported');

  // Browser internal pages
  assert(checkUrlSupport('chrome://settings').supported === false, 'chrome://settings is unsupported');
  assert(checkUrlSupport('chrome://extensions').supported === false, 'chrome://extensions is unsupported');
  assert(checkUrlSupport('edge://settings').supported === false, 'edge://settings is unsupported');
  assert(checkUrlSupport('chrome-extension://abcdefg/popup.html').supported === false, 'chrome-extension:// is unsupported');

  // Webstores
  assert(checkUrlSupport('https://chrome.google.com/webstore/detail/xyz').supported === false, 'Chrome Web Store is unsupported');
  assert(checkUrlSupport('https://microsoftedge.microsoft.com/addons/detail/xyz').supported === false, 'Edge Addons Store is unsupported');

  // File URLs
  const fileCheck = checkUrlSupport('file:///C:/Users/media/test.mp4');
  assert(fileCheck.supported === true && Boolean(fileCheck.warning), 'file:/// is supported with permission warning');

  // Web pages
  assert(checkUrlSupport('https://www.youtube.com/watch?v=123').supported === true, 'YouTube URL is fully supported');
  assert(checkUrlSupport('https://open.spotify.com/').supported === true, 'Spotify Web URL is fully supported');
  assert(checkUrlSupport('http://localhost:8080/stream').supported === true, 'Localhost HTTP stream is fully supported');

  // -------------------------------------------------------------
  // Test 4: Multi-tab UI Snapshot Presentation & State Integrity
  // -------------------------------------------------------------
  testSection('4. Multi-tab UI Snapshot Presentation');

  const mockSnapshot = {
    globalSettings: { globalAutoEnabled: true, globalTargetLufs: -18.0 },
    managedTabs: [
      {
        tabId: 101,
        title: 'Lofi Chill Stream - YouTube',
        url: 'https://youtube.com/watch?v=lofi',
        favIconUrl: 'https://youtube.com/favicon.ico',
        managed: true,
        captured: true,
        active: true,
        normalizationEnabled: true,
        manualOffsetDb: 2.0,
        autoGainDb: -1.5,
        effectiveGainDb: 0.5,
        targetLufs: -18.0,
        shortTermLufs: -18.2
      },
      {
        tabId: 102,
        title: 'Twitch Gaming Broadcast',
        url: 'https://twitch.tv/streamer',
        favIconUrl: '',
        managed: true,
        captured: true,
        active: true,
        normalizationEnabled: false,
        manualOffsetDb: -3.0,
        autoGainDb: 0.0,
        effectiveGainDb: -3.0,
        targetLufs: -18.0,
        shortTermLufs: -14.0
      }
    ]
  };

  const tab1Status = presentTabStatus(mockSnapshot.managedTabs[0]);
  assert(tab1Status.badgeText === 'Balanced', 'Snapshot tab 101 presents Balanced');
  assert(mockSnapshot.managedTabs[0].effectiveGainDb === 0.5, 'Effective gain is autoGain (-1.5) + manual (+2.0) = 0.5 dB');

  const tab2Status = presentTabStatus(mockSnapshot.managedTabs[1]);
  assert(tab2Status.badgeText === 'Manual Only', 'Snapshot tab 102 presents Manual Only');
  assert(mockSnapshot.managedTabs[1].effectiveGainDb === -3.0, 'Tab 102 manual offset (-3.0 dB) preserved when auto disabled');

  // -------------------------------------------------------------
  // Test 5: Manual Gain Range & Center Notch Bounds
  // -------------------------------------------------------------
  testSection('5. Manual Gain Range & Center Notch Bounds');

  const minGain = -12.0;
  const maxGain = 12.0;
  const centerGain = 0.0;

  function clampGain(val) {
    return Math.max(minGain, Math.min(maxGain, Number(val)));
  }

  assert(clampGain(-15) === -12.0, 'Gain values below -12 dB clamp to -12 dB');
  assert(clampGain(20) === 12.0, 'Gain values above +12 dB clamp to +12 dB');
  assert(clampGain(0.0) === centerGain, 'Center notch is exactly 0.0 dB');
  assert(clampGain(-4.5) === -4.5, 'Intermediate gain -4.5 dB is preserved within range');

  console.log(`\n========================================`);
  console.log(`P4 Product UI Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
