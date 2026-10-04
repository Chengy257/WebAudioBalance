/**
 * WebAudioBalance - P1 Audio Engine Unit & Deterministic Verification Suite
 */

import { AudioEngineState, validateStateTransition } from '../src/engine/types.js';
import { GainProcessor } from '../src/engine/gain-processor.js';
import { EngineeringMeter } from '../src/engine/meter.js';
import { AudioEngineManager } from '../src/offscreen/audio-engine-manager.js';

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

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`  [FAIL] ${message} (Expected error was not thrown)`);
  } catch (_) {
    passed++;
    console.log(`  [PASS] ${message}`);
  }
}

// -------------------------------------------------------------
// Test Suite 1: State Machine & Transition Validation
// -------------------------------------------------------------
console.log('\n--- 1. State Machine & Transition Validation ---');

assertThrows(() => validateStateTransition(AudioEngineState.IDLE, AudioEngineState.RUNNING), 'Reject direct IDLE -> RUNNING');
assertThrows(() => validateStateTransition(AudioEngineState.IDLE, AudioEngineState.STOPPING), 'Reject direct IDLE -> STOPPING');

// Valid paths
validateStateTransition(AudioEngineState.IDLE, AudioEngineState.STARTING);
assert(true, 'Allow IDLE -> STARTING');

validateStateTransition(AudioEngineState.STARTING, AudioEngineState.RUNNING);
assert(true, 'Allow STARTING -> RUNNING');

validateStateTransition(AudioEngineState.RUNNING, AudioEngineState.STOPPING);
assert(true, 'Allow RUNNING -> STOPPING');

validateStateTransition(AudioEngineState.STOPPING, AudioEngineState.IDLE);
assert(true, 'Allow STOPPING -> IDLE');

// Error transitions
validateStateTransition(AudioEngineState.RUNNING, AudioEngineState.ERROR);
assert(true, 'Allow RUNNING -> ERROR');

validateStateTransition(AudioEngineState.ERROR, AudioEngineState.IDLE);
assert(true, 'Allow ERROR -> IDLE');

// -------------------------------------------------------------
// Test Suite 2: Deterministic Gain Math & Boundary Clamping
// -------------------------------------------------------------
console.log('\n--- 2. Deterministic Gain Math & Boundary Clamping ---');

// Mock Web Audio Context for Node test
class MockGainAudioContext {
  constructor() {
    this.currentTime = 0;
  }
  createGain() {
    return {
      gain: {
        value: 1.0,
        setValueAtTime: (val) => {},
        cancelScheduledValues: () => {},
        linearRampToValueAtTime: (val) => {}
      },
      disconnect: () => {}
    };
  }
}

const mockCtx = new MockGainAudioContext();
const gainProc = new GainProcessor(mockCtx, { minGainDb: -30, maxGainDb: +15 });

// 0 dB -> linear 1.0
const res0 = gainProc.setGainDb(0);
assert(Math.abs(res0.linearGain - 1.0) < 1e-4, '0 dB yields linear gain 1.0000');

// -6 dB -> linear ~ 0.501187
const resMinus6 = gainProc.setGainDb(-6);
assert(Math.abs(resMinus6.linearGain - 0.501187) < 1e-4, '-6 dB yields linear gain ~ 0.5012');

// +6 dB -> linear ~ 1.995262
const resPlus6 = gainProc.setGainDb(6);
assert(Math.abs(resPlus6.linearGain - 1.995262) < 1e-4, '+6 dB yields linear gain ~ 1.9953');

// Clamping: exceed max bound +15 dB
const resOver = gainProc.setGainDb(25);
assert(resOver.targetGainDb === 15, '+25 dB request clamped to max +15 dB');

// Clamping: exceed min bound -30 dB
const resUnder = gainProc.setGainDb(-50);
assert(resUnder.targetGainDb === -30, '-50 dB request clamped to min -30 dB');

// -------------------------------------------------------------
// Test Suite 3: EngineeringMeter Math (RMS & Peak dBFS)
// -------------------------------------------------------------
console.log('\n--- 3. EngineeringMeter Math Verification ---');

class MockMeterAudioContext {
  constructor() {
    this.currentTime = 0;
  }
  createAnalyser() {
    let internalBuffer = new Float32Array(2048);
    return {
      fftSize: 2048,
      _setBuffer: (arr) => { internalBuffer.set(arr); },
      getFloatTimeDomainData: (dest) => { dest.set(internalBuffer); },
      disconnect: () => {}
    };
  }
}

const meterCtx = new MockMeterAudioContext();
const meter = new EngineeringMeter(meterCtx, 2048);

// Case 3.1: Complete Silence
const silenceBuf = new Float32Array(2048);
meter.analyser._setBuffer(silenceBuf);
const silenceMetrics = meter.measure();
assert(silenceMetrics.rmsDbFS === -100, 'Silence yields -100 dBFS floor');
assert(silenceMetrics.peakDbFS === -100, 'Silence yields -100 dBFS peak');

// Case 3.2: Full scale square wave (RMS = 1.0 -> 0 dBFS)
const squareBuf = new Float32Array(2048).fill(1.0);
meter.analyser._setBuffer(squareBuf);
const squareMetrics = meter.measure();
assert(Math.abs(squareMetrics.rmsDbFS - 0.0) < 0.1, 'Full-scale DC/Square wave yields 0.0 dBFS RMS');
assert(Math.abs(squareMetrics.peakDbFS - 0.0) < 0.1, 'Full-scale DC/Square wave yields 0.0 dBFS Peak');

// Case 3.3: Sine wave of amplitude 0.25 (-12.04 dBFS Peak, -15.05 dBFS RMS)
const sineBuf = new Float32Array(2048);
for (let i = 0; i < 2048; i++) {
  sineBuf[i] = 0.25 * Math.sin(2 * Math.PI * (i / 100));
}
meter.analyser._setBuffer(sineBuf);
const sineMetrics = meter.measure();
assert(Math.abs(sineMetrics.peakDbFS - (-12.0)) < 0.2, 'Sine (amp=0.25) yields ~ -12 dBFS Peak');
assert(Math.abs(sineMetrics.rmsDbFS - (-15.1)) < 0.2, 'Sine (amp=0.25) yields ~ -15.1 dBFS RMS (3 dB crest factor)');

// -------------------------------------------------------------
// Test Suite 4: AudioEngineManager Invariant & Multi-tab Isolation
// -------------------------------------------------------------
console.log('\n--- 4. AudioEngineManager Multi-Engine Isolation ---');

const manager = new AudioEngineManager();

// Tab 100 session simulation
manager.engines.set(100, {
  tabId: 100,
  currentGainDb: 0,
  state: AudioEngineState.RUNNING,
  startedAt: Date.now(),
  setGainDb(g) { this.currentGainDb = g; return true; },
  getGainDb() { return this.currentGainDb; },
  getState() { return this.state; },
  getMetrics() { return { rmsDbFS: -15, peakDbFS: -12, audioContextState: 'running' }; },
  stop() { this.state = AudioEngineState.IDLE; }
});

// Tab 200 session simulation
manager.engines.set(200, {
  tabId: 200,
  currentGainDb: 0,
  state: AudioEngineState.RUNNING,
  startedAt: Date.now(),
  setGainDb(g) { this.currentGainDb = g; return true; },
  getGainDb() { return this.currentGainDb; },
  getState() { return this.state; },
  getMetrics() { return { rmsDbFS: -20, peakDbFS: -17, audioContextState: 'running' }; },
  stop() { this.state = AudioEngineState.IDLE; }
});

// Change gain on Tab 100 only
manager.setEngineGain(100, -6);
assert(manager.engines.get(100).getGainDb() === -6, 'Tab 100 gain changed to -6 dB');
assert(manager.engines.get(200).getGainDb() === 0, 'Tab 200 gain remains untouched at 0 dB');

// Stop Tab 100 only
await manager.stopEngine(100);
assert(!manager.engines.has(100), 'Tab 100 removed cleanly after stop');
assert(manager.engines.has(200), 'Tab 200 remains active and unaffected');

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n=============================================');
console.log(`P1 UNIT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('=============================================\n');

if (failed > 0) {
  process.exit(1);
}
