/**
 * WebAudioBalance - Release Correction: Simultaneous Multi-Tab Verification (RC-1)
 *
 * Evaluates whether Google Chrome and Microsoft Edge support concurrent
 * chrome.tabCapture sessions and independent parallel AudioEngines.
 *
 * Implements test requirements defined in docs/planning/FINAL_RELEASE_CORRECTION_PLAN.md:
 * - Tab A and Tab B audible simultaneously.
 * - Balance Tab A and verify live running engine.
 * - Without stopping Tab A, Balance Tab B.
 * - Inspect browser tabCapture API, Offscreen runtime snapshot, coordinator registry,
 *   telemetry sequence progression, and controller isolation.
 * - Classify result into CLASS A, CLASS B, or CLASS C.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const HTTP_PORT = 8098;
const CDP_BASE_PORT = 9270;
const EXTENSION_ROOT = process.cwd();

// Lightweight static HTTP server
const server = http.createServer((req, res) => {
  const reqPath = req.url.split('?')[0];
  const filePath = path.join(EXTENSION_ROOT, reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    let contentType = 'application/octet-stream';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.js' || ext === '.mjs') contentType = 'application/javascript';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.css') contentType = 'text/css';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findInstalledBrowsers() {
  const candidates = [
    { name: 'Google Chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'Microsoft Edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }
  ];
  return candidates.filter((c) => fs.existsSync(c.exe));
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleLogs = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        this.callbacks.get(msg.id)(msg);
        this.callbacks.delete(msg.id);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
        this.consoleLogs.push({ type: msg.params.type, text });
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const curId = this.id++;
      this.callbacks.set(curId, resolve);
      this.ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.result?.exceptionDetails) {
      const desc = res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text;
      throw new Error(`CDP Evaluate Error: ${desc}`);
    }
    return res.result?.result?.value;
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {}
  }
}

async function testBrowserSimultaneousMultiTab(browser, portOffset) {
  const cdpPort = CDP_BASE_PORT + portOffset;
  console.log(`\n===============================================================`);
  console.log(`RC-1 Simultaneous Multi-Tab Test: ${browser.name}`);
  console.log(`CDP Port: ${cdpPort}`);
  console.log(`===============================================================\n`);

  const tmpProfile = path.join(tmpdir(), `wab_rc1_multitab_${portOffset}_${Date.now()}`);
  fs.mkdirSync(tmpProfile, { recursive: true });

  const tabAUrl = `http://127.0.0.1:${HTTP_PORT}/test/test-page.html?source=tabA`;
  const tabBUrl = `http://127.0.0.1:${HTTP_PORT}/test/test-page.html?source=tabB`;

  const browserArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tmpProfile}`,
    '--allowlisted-extension-id=gfkjhobklaikenpabhmeppdcggojmohd',
    '--whitelisted-extension-id=gfkjhobklaikenpabhmeppdcggojmohd',
    '--extensions-on-chrome-urls',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    tabAUrl
  ];

  if (!browser.name.includes('Chrome')) {
    browserArgs.push(`--load-extension=${EXTENSION_ROOT}`);
    browserArgs.push(`--disable-extensions-except=${EXTENSION_ROOT}`);
  }

  const proc = spawn(browser.exe, browserArgs, { stdio: 'ignore' });
  let browserCdp = null;

  const result = {
    browser: browser.name,
    classification: 'UNRESOLVED',
    details: {},
    errors: []
  };

  try {
    let versionInfo = null;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (res.ok) {
          versionInfo = await res.json();
          break;
        }
      } catch (_) {}
    }
    if (!versionInfo) throw new Error(`Could not connect to ${browser.name} CDP`);

    browserCdp = new CdpConnection(versionInfo.webSocketDebuggerUrl);
    await browserCdp.connect();
    await browserCdp.send('Target.setDiscoverTargets', { discover: true });

    let extensionId = null;

    // Load unpacked extension if Chrome
    if (browser.name.includes('Chrome')) {
      try {
        const formattedPath = EXTENSION_ROOT.replace(/\\/g, '/');
        const loadRes = await browserCdp.send('Extensions.loadUnpacked', { path: formattedPath });
        if (loadRes?.result?.id) extensionId = loadRes.result.id;
        else if (loadRes?.id) extensionId = loadRes.id;
      } catch (_) {}
    }

    // Discover targets
    let swTarget = null;
    let pageATarget = null;

    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        for (const t of targets) {
          if (!extensionId && t.type === 'service_worker' && t.url.includes('/src/background/service-worker.js')) {
            extensionId = new URL(t.url).hostname;
          }
          if (t.type === 'service_worker' && t.url.includes('service-worker.js')) {
            swTarget = t;
          }
          if (t.type === 'page' && t.url.includes('source=tabA')) {
            pageATarget = t;
          }
        }
        if (extensionId && pageATarget) break;
      }
    }

    if (!extensionId) throw new Error('Extension ID not discovered');
    console.log(`Discovered Extension ID: ${extensionId}`);

    // Open Tab B
    const createTabBRes = await browserCdp.send('Target.createTarget', { url: tabBUrl });
    const tabBTargetId = createTabBRes.result?.targetId || createTabBRes.targetId;
    await sleep(600);

    let pageBTarget = null;
    const targetsAfterB = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    pageBTarget = targetsAfterB.find((t) => t.id === tabBTargetId || (t.url && t.url.includes('source=tabB')));
    if (!pageBTarget) throw new Error('Could not find Tab B target');

    // Connect to Tab A and start audio (440 Hz Sine)
    const cdpA = new CdpConnection(pageATarget.webSocketDebuggerUrl);
    await cdpA.connect();
    await cdpA.send('Runtime.enable');
    await cdpA.evaluate(`
      (() => {
        const btn = document.getElementById('btnToneToggle');
        if (btn) btn.click();
      })()
    `);
    console.log('Started continuous audio tone on Tab A (440 Hz)');

    // Connect to Tab B and start audio (880 Hz Sine)
    const cdpB = new CdpConnection(pageBTarget.webSocketDebuggerUrl);
    await cdpB.connect();
    await cdpB.send('Runtime.enable');
    await cdpB.evaluate(`
      (() => {
        const btn = document.getElementById('btnToneToggle');
        if (btn) btn.click();
        const btnFreq = document.getElementById('btnToneFreq');
        if (btnFreq) btnFreq.click();
      })()
    `);
    console.log('Started continuous audio tone on Tab B (880 Hz)');
    await sleep(600);

    // Attach to Service Worker
    const swCdp = new CdpConnection(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();
    await swCdp.send('Runtime.enable');

    // Query browser tabs to get Tab A and Tab B IDs
    const tabsList = await swCdp.evaluate(`
      new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => resolve(tabs.map(t => ({ id: t.id, url: t.url, active: t.active }))));
      })
    `);
    const tabAId = tabsList.find((t) => t.url && t.url.includes('source=tabA'))?.id;
    const tabBId = tabsList.find((t) => t.url && t.url.includes('source=tabB'))?.id;
    console.log(`Discovered Tab IDs: Tab A = ${tabAId}, Tab B = ${tabBId}`);
    if (!tabAId || !tabBId) {
      throw new Error(`Failed to find both Tab A and Tab B in browser tabs`);
    }

    // --- STEP 1: Activate Tab A, Open Popup, Enable Tab A (Section 7.2) ---
    console.log(`\n--- Step 1: Activate Tab A (${tabAId}) & Balance Tab A ---`);
    await swCdp.evaluate(`chrome.tabs.update(${tabAId}, { active: true })`);
    await sleep(600);

    const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
    const popupUrlA = `${popupUrl}?tabId=${tabAId}`;
    const popupTargetResA = await browserCdp.send('Target.createTarget', { url: popupUrlA });
    const popupTargetIdA = popupTargetResA.result?.targetId || popupTargetResA.targetId;
    await sleep(600);

    let popupTargetA = null;
    const targetsAfterA = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    popupTargetA = targetsAfterA.find((t) => (t.id === popupTargetIdA || t.url.includes('popup.html')) && t.webSocketDebuggerUrl);
    if (!popupTargetA) throw new Error('Could not attach to Popup target for Tab A');

    let popupCdp = new CdpConnection(popupTargetA.webSocketDebuggerUrl);
    await popupCdp.connect();
    await popupCdp.send('Runtime.enable');

    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const ready = await popupCdp.evaluate('Boolean(window.chrome && window.chrome.tabs && window.chrome.tabs.query)');
      if (ready) break;
    }
    await popupCdp.evaluate('document.getElementById("btnRefresh")?.click()');
    await sleep(600);

    // Click balance on Tab A
    const clickRes = await popupCdp.evaluate(`
      (() => {
        const btn = document.getElementById("btn-balance-${tabAId}");
        if (!btn) return { clicked: false, currentContainer: document.getElementById('currentTabContainer')?.innerHTML };
        btn.click();
        return { clicked: true, text: btn.textContent };
      })()
    `);
    console.log('Click on btn-balance Tab A result:', clickRes);
    await sleep(1000);
    const errText = await popupCdp.evaluate(`document.getElementById('errorMessage')?.textContent`);
    console.log('Popup errorMessage after click:', errText);
    console.log('Popup console logs:', popupCdp.consoleLogs);

    // Wait until Tab A is running
    let tabARunning = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const snap = await popupCdp.evaluate(`
        (async () => {
          return await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_PRODUCT_SNAPSHOT', target: 'service_worker' }, (res) => resolve(res));
          });
        })()
      `);
      const tabA = snap?.managedTabs?.find((t) => t.tabId === tabAId);
      if (tabA && tabA.runtime?.captured && tabA.runtime?.engineState === 'RUNNING') {
        tabARunning = true;
        console.log(`  Tab A successfully running: captured=${tabA.runtime.captured}, inputLufs=${tabA.audio?.inputShortTermLufs}`);
        break;
      }
    }

    if (!tabARunning) {
      throw new Error(`Tab A failed to start and reach RUNNING state`);
    }

    // Close Tab A popup before switching
    popupCdp.close();
    await browserCdp.send('Target.closeTarget', { targetId: popupTargetIdA });
    await sleep(600);

    // --- STEP 2: Activate Tab B, Open Popup, Enable Tab B (Section 7.2) ---
    console.log(`\n--- Step 2: Activate Tab B (${tabBId}) & Balance Tab B (without stopping Tab A) ---`);
    await swCdp.evaluate(`chrome.tabs.update(${tabBId}, { active: true })`);
    await sleep(600);

    const popupUrlB = `${popupUrl}?tabId=${tabBId}`;
    const popupTargetResB = await browserCdp.send('Target.createTarget', { url: popupUrlB });
    const popupTargetIdB = popupTargetResB.result?.targetId || popupTargetResB.targetId;
    await sleep(600);

    let popupTargetB = null;
    const targetsAfterBNow = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
    popupTargetB = targetsAfterBNow.find((t) => (t.id === popupTargetIdB || t.url.includes('popup.html')) && t.webSocketDebuggerUrl);
    if (!popupTargetB) throw new Error('Could not attach to Popup target for Tab B');

    popupCdp = new CdpConnection(popupTargetB.webSocketDebuggerUrl);
    await popupCdp.connect();
    await popupCdp.send('Runtime.enable');

    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const ready = await popupCdp.evaluate('Boolean(window.chrome && window.chrome.tabs && window.chrome.tabs.query)');
      if (ready) break;
    }
    await popupCdp.evaluate('document.getElementById("btnRefresh")?.click()');
    await sleep(600);

    // Click balance on Tab B
    const balanceBClicked = await popupCdp.evaluate(`
      (() => {
        const btn = document.getElementById("btn-balance-${tabBId}");
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    console.log(`  Clicked Balance on Tab B: ${balanceBClicked}`);
    await sleep(2500);

    // --- STEP 3: Inspect simultaneous state ---
    console.log(`\n--- Step 3: Inspect simultaneous state ---`);

    // Query browser tabCapture
    const browserCapturedTabs = await popupCdp.evaluate(`
      new Promise((resolve) => {
        chrome.tabCapture.getCapturedTabs((tabs) => resolve(tabs));
      })
    `);
    console.log(`  Browser chrome.tabCapture.getCapturedTabs():`, browserCapturedTabs);

    // Query Service Worker coordinator snapshot
    const swSnapshot = await popupCdp.evaluate(`
      (async () => {
        return await chrome.runtime.sendMessage({ type: 'GET_PRODUCT_SNAPSHOT', target: 'service_worker' });
      })()
    `);
    const managedTabs = swSnapshot?.managedTabs || [];
    console.log(`  Service Worker managed tabs count: ${managedTabs.length}`);
    for (const t of managedTabs) {
      console.log(`    Tab ${t.tabId}: managed=${t.intent?.managed}, captured=${t.runtime?.captured}, engineState=${t.runtime?.engineState}, error=${t.runtime?.lastRuntimeError?.code}`);
    }

    // Query Offscreen audio runtime snapshot
    const offscreenSnap = await popupCdp.evaluate(`
      (async () => {
        return await chrome.runtime.sendMessage({ type: 'GET_AUDIO_RUNTIME_SNAPSHOT', target: 'offscreen' });
      })()
    `);
    const liveEngines = offscreenSnap?.engines || [];
    console.log(`  Offscreen live engines count: ${liveEngines.length}`);
    for (const eng of liveEngines) {
      console.log(`    Engine ${eng.tabId}: state=${eng.engineState}, ctxState=${eng.audioContextState}, inputLufs=${eng.inputShortTermLufs}, seq=${eng.metricsSequence}`);
    }

    // Direct streamId test on Tab B to inspect native browser return value/error
    const directStreamIdTest = await popupCdp.evaluate(`
      new Promise((resolve) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: ${tabBId} }, (streamId) => {
          const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
          resolve({ streamId, err });
        });
      })
    `);
    console.log(`  Direct chrome.tabCapture.getMediaStreamId for Tab B:`, directStreamIdTest);

    result.details = {
      browserCapturedTabs,
      managedTabsCount: managedTabs.length,
      liveEnginesCount: liveEngines.length,
      tabAState: managedTabs.find((t) => t.tabId === tabAId),
      tabBState: managedTabs.find((t) => t.tabId === tabBId),
      directStreamIdTest
    };

    // Analyze outcome
    const tabARun = managedTabs.find((t) => t.tabId === tabAId && t.runtime?.captured && t.runtime?.engineState === 'RUNNING');
    const tabBRun = managedTabs.find((t) => t.tabId === tabBId && t.runtime?.captured && t.runtime?.engineState === 'RUNNING');

    if (tabARun && tabBRun && liveEngines.length >= 2) {
      console.log(`\n>>> Both Tab A and Tab B are concurrently captured and running! Testing independence...`);

      // Test controller independence
      // Change Tab A Relative Level to +3.0 dB
      await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({
            type: 'SET_TAB_OFFSET',
            target: 'service_worker',
            payload: { tabId: ${tabAId}, offsetDb: 3.0 }
          });
        })()
      `);
      await sleep(1000);

      const snapAfterOffset = await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({ type: 'GET_PRODUCT_SNAPSHOT', target: 'service_worker' });
        })()
      `);
      const aAfter = snapAfterOffset?.managedTabs?.find((t) => t.tabId === tabAId);
      const bAfter = snapAfterOffset?.managedTabs?.find((t) => t.tabId === tabBId);

      const aIndependent = aAfter?.audio?.effectiveTargetLufs === -15.0;
      const bUnchanged = bAfter?.audio?.effectiveTargetLufs === -18.0;
      console.log(`  Tab A offset +3 dB applied: effectiveTarget=${aAfter?.audio?.effectiveTargetLufs} (expected -15.0)`);
      console.log(`  Tab B unchanged: effectiveTarget=${bAfter?.audio?.effectiveTargetLufs} (expected -18.0)`);

      // Release Tab A, verify Tab B continues
      console.log(`  Releasing Tab A (${tabAId})...`);
      await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({
            type: 'STOP_CAPTURE',
            target: 'service_worker',
            payload: { tabId: ${tabAId} }
          });
        })()
      `);
      await sleep(1200);

      const snapAfterRelA = await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({ type: 'GET_PRODUCT_SNAPSHOT', target: 'service_worker' });
        })()
      `);
      const bStillRunning = snapAfterRelA?.managedTabs?.find((t) => t.tabId === tabBId && t.runtime?.captured);
      console.log(`  Tab B after Tab A released: captured=${bStillRunning?.runtime?.captured}`);

      // Release Tab B
      await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({
            type: 'STOP_CAPTURE',
            target: 'service_worker',
            payload: { tabId: ${tabBId} }
          });
        })()
      `);
      await sleep(1000);

      const finalOffscreen = await popupCdp.evaluate(`
        (async () => {
          return await chrome.runtime.sendMessage({ type: 'GET_AUDIO_RUNTIME_SNAPSHOT', target: 'offscreen' });
        })()
      `);
      console.log(`  Final offscreen engine count: ${finalOffscreen?.engines?.length} (expected 0)`);

      if (aIndependent && bUnchanged && bStillRunning && finalOffscreen?.engines?.length === 0) {
        result.classification = 'CLASS_A_SIMULTANEOUS_MULTI_TAB_SUPPORTED';
        console.log(`\n===============================================================`);
        console.log(`RESULT FOR ${browser.name}: CLASS A — SIMULTANEOUS_MULTI_TAB_SUPPORTED`);
        console.log(`===============================================================\n`);
      } else {
        result.classification = 'CLASS_C_PRODUCT_DEFECT';
        console.log(`\n===============================================================`);
        console.log(`RESULT FOR ${browser.name}: CLASS C — PRODUCT_DEFECT (Independence/Lifecycle failed)`);
        console.log(`===============================================================\n`);
      }
    } else {
      // Analyze why simultaneous capture did not hold
      console.log(`\n>>> Simultaneous capture did NOT produce 2 active engines.`);

      // Check browser capture list
      const tabARecord = browserCapturedTabs.find((c) => c.tabId === tabAId);
      const tabBRecord = browserCapturedTabs.find((c) => c.tabId === tabBId);
      console.log(`  Tab A browser capture record:`, tabARecord);
      console.log(`  Tab B browser capture record:`, tabBRecord);

      // Check if browser stopped Tab A when Tab B was acquired
      if (tabARecord?.status === 'stopped' || (!tabARun && tabBRun)) {
        result.classification = 'CLASS_B_PLATFORM_SINGLE_CAPTURE_LIMIT';
        result.details.reason = 'Chromium native tabCapture single active stream limitation: capturing Tab B automatically transitions Tab A to stopped in getCapturedTabs().';
        console.log(`\n===============================================================`);
        console.log(`RESULT FOR ${browser.name}: CLASS B — PLATFORM_SINGLE_CAPTURE_LIMIT`);
        console.log(`Reason: ${result.details.reason}`);
        console.log(`===============================================================\n`);
      } else if (directStreamIdTest.err) {
        result.classification = 'CLASS_B_PLATFORM_SINGLE_CAPTURE_LIMIT';
        result.details.reason = `Chromium tabCapture rejected: ${directStreamIdTest.err}`;
        console.log(`\n===============================================================`);
        console.log(`RESULT FOR ${browser.name}: CLASS B — PLATFORM_SINGLE_CAPTURE_LIMIT`);
        console.log(`Reason: ${result.details.reason}`);
        console.log(`===============================================================\n`);
      } else {
        result.classification = 'CLASS_C_PRODUCT_DEFECT';
        result.details.reason = 'Browser permitted capture or unknown state, but WebAudioBalance failed to manage concurrent engines.';
        console.log(`\n===============================================================`);
        console.log(`RESULT FOR ${browser.name}: CLASS C — PRODUCT_DEFECT`);
        console.log(`===============================================================\n`);
      }
    }
  } catch (err) {
    result.errors.push(err.message);
    console.error(`Error during ${browser.name} test:`, err);
  } finally {
    if (browserCdp) browserCdp.close();
    proc.kill('SIGKILL');
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch (_) {}
  }

  return result;
}

async function main() {
  server.listen(HTTP_PORT);
  console.log(`Local static test server listening on http://127.0.0.1:${HTTP_PORT}`);

  const requestedBrowser = process.argv[2]?.toLowerCase();
  let browsers = findInstalledBrowsers();

  if (requestedBrowser === 'chrome') {
    browsers = browsers.filter((b) => b.name.includes('Chrome'));
  } else if (requestedBrowser === 'edge') {
    browsers = browsers.filter((b) => b.name.includes('Edge'));
  }

  console.log(`Found ${browsers.length} target browsers:`, browsers.map((b) => b.name));

  const results = [];
  for (let idx = 0; idx < browsers.length; idx++) {
    const res = await testBrowserSimultaneousMultiTab(browsers[idx], idx);
    results.push(res);
  }

  server.close();

  console.log('\n===============================================================');
  console.log('RC-1 SIMULTANEOUS MULTI-TAB EXPERIMENT SUMMARY');
  console.log('===============================================================');
  for (const r of results) {
    console.log(`Browser: ${r.browser}`);
    console.log(`Classification: ${r.classification}`);
    if (r.details?.reason) console.log(`Reason: ${r.details.reason}`);
    if (r.errors?.length) console.log(`Errors: ${r.errors.join(', ')}`);
    console.log('---------------------------------------------------------------');
  }

  const hasClassC = results.some((r) => r.classification === 'CLASS_C_PRODUCT_DEFECT');
  if (hasClassC) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  server.close();
  process.exit(1);
});
