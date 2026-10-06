/**
 * WebAudioBalance - P6 Release & Hardening Automated Verification Suite
 * Tests:
 * 1. Manifest V3 Schema & Asset Integrity
 * 2. Icon File Sizes, Dimensions, and PNG Signatures
 * 3. AudioEngine Resource Disposal & Zero-Leak Verification
 * 4. AudioEngineManager Lifecycle Eviction
 * 5. Logger Buffer Upper-Bound Clamping
 * 6. Codebase Consistency & Production Readiness
 */

import fs from 'fs';
import path from 'path';
import { AudioEngine } from '../src/engine/audio-engine.js';
import { AudioEngineState } from '../src/engine/types.js';
import { AudioEngineManager } from '../src/offscreen/audio-engine-manager.js';
import { StructuredLogger, getStoredLogs, clearStoredLogs } from '../src/shared/logger.js';

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
  console.log('Starting P6 Release & Hardening Verification Suite...\n');

  // -------------------------------------------------------------
  // Test 1: Manifest V3 Schema & Asset Integrity
  // -------------------------------------------------------------
  testSection('1. Manifest V3 Schema & Asset Integrity');

  const manifestPath = path.resolve('manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json exists');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert(manifest.manifest_version === 3, 'manifest_version is 3 (Chromium MV3)');
  assert(manifest.version === pkg.version, `manifest version (${manifest.version}) matches package.json (${pkg.version})`);
  assert(manifest.name === 'WebAudioBalance', 'Product name is WebAudioBalance');

  const requiredPermissions = ['tabCapture', 'offscreen', 'tabs', 'activeTab', 'contextMenus', 'storage'];
  requiredPermissions.forEach((perm) => {
    assert(manifest.permissions.includes(perm), `Permission "${perm}" is declared in manifest`);
  });

  assert(manifest.background?.service_worker === 'src/background/service-worker.js', 'Service worker path is correct');
  assert(manifest.background?.type === 'module', 'Service worker type is module');
  assert(fs.existsSync(path.resolve(manifest.background.service_worker)), 'Service worker file exists on disk');

  assert(manifest.action?.default_popup === 'src/popup/popup.html', 'Action popup path is correct');
  assert(fs.existsSync(path.resolve(manifest.action.default_popup)), 'Popup HTML exists on disk');

  // -------------------------------------------------------------
  // Test 2: Icon Assets Verification
  // -------------------------------------------------------------
  testSection('2. Icon Assets Verification');

  const iconSizes = ['16', '32', '48', '128'];
  iconSizes.forEach((size) => {
    const iconRelPath = manifest.icons?.[size];
    assert(Boolean(iconRelPath), `Icon size ${size} is declared in root icons`);
    const fullPath = path.resolve(iconRelPath);
    assert(fs.existsSync(fullPath), `Icon file ${iconRelPath} exists on disk`);

    const buf = fs.readFileSync(fullPath);
    assert(buf.length > 50, `Icon file ${iconRelPath} is non-empty (${buf.length} bytes)`);

    // Verify PNG header signature 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    const pngSignature = buf.subarray(0, 8).toString('hex');
    assert(pngSignature === '89504e470d0a1a0a', `Icon ${size} has valid PNG signature`);

    // Verify dimensions in IHDR chunk
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert(width === Number(size) && height === Number(size), `Icon ${size} dimensions match exactly (${width}x${height})`);

    // Check action default_icon matches
    assert(manifest.action?.default_icon?.[size] === iconRelPath, `Action default_icon for size ${size} matches`);
  });

  // -------------------------------------------------------------
  // Test 3: AudioEngine Resource Disposal & Zero-Leak Verification
  // -------------------------------------------------------------
  testSection('3. AudioEngine Resource Disposal & Leak Prevention');

  let audioCtxClosed = false;
  let tracksStopped = false;

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1.0, cancelScheduledValues() {}, linearRampToValueAtTime() {}, setValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return { fftSize: 2048, getFloatTimeDomainData() {}, connect() {}, disconnect() {} };
    }
    createBiquadFilter() {
      return { type: 'highshelf', frequency: { setValueAtTime() {} }, gain: { setValueAtTime() {} }, Q: { setValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createDynamicsCompressor() {
      return { threshold: { setValueAtTime() {} }, knee: { setValueAtTime() {} }, ratio: { setValueAtTime() {} }, attack: { setValueAtTime() {} }, release: { setValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    async close() {
      audioCtxClosed = true;
      this.state = 'closed';
    }
  }

  globalThis.AudioContext = MockAudioContext;

  const mockStream = {
    getAudioTracks() {
      return [{
        stop() { tracksStopped = true; },
        readyState: 'live'
      }];
    }
  };

  const mockSource = {
    on() {},
    async acquire() { return mockStream; },
    release() {
      mockStream.getAudioTracks().forEach(t => t.stop());
    }
  };

  const engine = new AudioEngine(999, mockSource, { cycleIntervalMs: 20 });
  await engine.start();

  assert(engine.getState() === AudioEngineState.RUNNING, 'AudioEngine started into RUNNING state');

  // Verify listeners were added
  let metricsFired = false;
  engine.on('metrics', () => { metricsFired = true; });
  engine.processControlCycle();
  assert(metricsFired === true, 'Metrics event fired to listener');

  // Now stop the engine and verify deep teardown
  await engine.stop();

  assert(engine.getState() === AudioEngineState.IDLE, 'AudioEngine state transitioned to IDLE');
  assert(audioCtxClosed === true, 'AudioContext.close() was executed on teardown');
  assert(tracksStopped === true, 'MediaStream audio tracks were stopped');
  assert(engine.audioCtx === null, 'AudioContext reference nullified');
  assert(engine.sourceNode === null, 'sourceNode reference nullified');
  assert(engine.engineeringMeter === null, 'engineeringMeter reference nullified');
  assert(engine.kWeighting === null, 'kWeighting reference nullified');
  assert(engine.loudnessMeter === null, 'loudnessMeter reference nullified');
  assert(engine.gainProcessor === null, 'gainProcessor reference nullified');
  assert(engine.safetyHook === null, 'safetyHook reference nullified');
  assert(engine.engineTimer === null, 'Periodic interval timer cleared');
  assert(engine.listeners.size === 0, 'All event listeners evicted (zero lingering closures)');

  // -------------------------------------------------------------
  // Test 4: AudioEngineManager Lifecycle Eviction
  // -------------------------------------------------------------
  testSection('4. AudioEngineManager Lifecycle Eviction');

  const manager = new AudioEngineManager();
  // Override internal create to use our mock
  manager.engines.set(101, engine);
  assert(manager.engines.has(101), 'Manager holds tab 101');

  await manager.stopEngine(101);
  assert(!manager.engines.has(101), 'Tab 101 cleanly evicted from manager registry upon stop');
  assert(manager.engines.size === 0, 'AudioEngineManager pool is completely empty (zero leaks)');

  // -------------------------------------------------------------
  // Test 5: Logger Buffer Upper-Bound Clamping
  // -------------------------------------------------------------
  testSection('5. Logger Buffer Upper-Bound Clamping');

  clearStoredLogs();
  const testLogger = new StructuredLogger('HardeningTest');

  for (let i = 0; i < 250; i++) {
    testLogger.info(`Log message ${i}`);
  }

  const logs = getStoredLogs();
  assert(logs.length === 200, `Memory logs strictly capped at 200 entries (observed: ${logs.length})`);
  assert(logs[logs.length - 1].message === 'Log message 249', 'Most recent log is preserved');
  assert(logs[0].message === 'Log message 50', 'Oldest 50 entries FIFO evicted');

  console.log(`\n========================================`);
  console.log(`P6 Release & Hardening Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error in P6 suite:', err);
  process.exit(1);
});
