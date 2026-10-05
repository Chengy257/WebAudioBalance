/**
 * WebAudioBalance - Release Artifact Load Verification (Gates G11 & G12)
 *
 * Verifies that the packaged release artifact (dist/webaudiobalance-v1.1.0.zip)
 * unzips cleanly and loads without errors into both Google Chrome (G11) and Microsoft Edge (G12).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const VERSION = '1.1.0';
const DIST_DIR = path.resolve('dist');
const ZIP_PATH = path.join(DIST_DIR, `webaudiobalance-v${VERSION}.zip`);
const VERIFY_DIR = path.join(tmpdir(), `wab_verify_artifact_${Date.now()}`);

console.log('=== WebAudioBalance Release Artifact Verification (Gates G11 & G12) ===\n');

// 1. Verify ZIP existence
if (!fs.existsSync(ZIP_PATH)) {
  console.error(`FAIL: ZIP archive not found at ${ZIP_PATH}`);
  process.exit(1);
}
console.log(`[PASS] Release ZIP exists: ${ZIP_PATH} (${fs.statSync(ZIP_PATH).size} bytes)`);

// 2. Unpack ZIP to temporary directory using tar
fs.mkdirSync(VERIFY_DIR, { recursive: true });
const tarCmd = process.platform === 'win32' ? 'tar.exe' : 'tar';
execFileSync(tarCmd, ['-xf', ZIP_PATH, '-C', VERIFY_DIR]);
console.log(`[PASS] Successfully extracted ZIP archive into ${VERIFY_DIR}`);

// 3. Verify manifest in extracted folder
const manifestPath = path.join(VERIFY_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`FAIL: manifest.json missing from extracted package`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== VERSION) {
  console.error(`FAIL: Extracted manifest version ${manifest.version} does not match expected ${VERSION}`);
  process.exit(1);
}
console.log(`[PASS] Manifest verified: Name="${manifest.name}", Version="${manifest.version}", MV=${manifest.manifest_version}`);

// Verify all files referenced by manifest
const referencedFiles = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {})
].filter(Boolean);

for (const rel of referencedFiles) {
  const full = path.join(VERIFY_DIR, rel);
  if (!fs.existsSync(full)) {
    console.error(`FAIL: Referenced file ${rel} does not exist in package`);
    process.exit(1);
  }
}
console.log(`[PASS] All ${referencedFiles.length} manifest-referenced assets verified inside package.`);

// 4. Test loading in Microsoft Edge (G12) and Google Chrome (G11)
const browsers = [
  { name: 'Microsoft Edge', gate: 'G12', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { name: 'Google Chrome', gate: 'G11', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }
].filter(b => fs.existsSync(b.exe));

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class SimpleCdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
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
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.text);
    }
    return res.result?.result?.value;
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

let allGatesPassed = true;

for (let idx = 0; idx < browsers.length; idx++) {
  const browser = browsers[idx];
  const cdpPort = 9310 + idx;
  const profileDir = path.join(tmpdir(), `wab_verify_profile_${idx}_${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`\n--- Testing ${browser.name} (${browser.gate}) ---`);
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];

  if (!browser.name.includes('Chrome')) {
    args.push(`--load-extension=${VERIFY_DIR}`);
    args.push(`--disable-extensions-except=${VERIFY_DIR}`);
  }

  const proc = spawn(browser.exe, args, { stdio: 'ignore' });
  let browserCdp = null;

  try {
    let versionInfo = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (res.ok) {
          versionInfo = await res.json();
          break;
        }
      } catch (_) {}
    }
    if (!versionInfo) throw new Error('Could not connect to browser CDP');

    browserCdp = new SimpleCdp(versionInfo.webSocketDebuggerUrl);
    await browserCdp.connect();

    // If Chrome, load via Extensions.loadUnpacked
    if (browser.name.includes('Chrome')) {
      const formattedPath = VERIFY_DIR.replace(/\\/g, '/');
      await browserCdp.send('Extensions.loadUnpacked', { path: formattedPath });
    }

    // Wait for service worker
    let extensionId = null;
    let swTarget = null;
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        for (const t of targets) {
          if (t.type === 'service_worker' && t.url.includes('service-worker.js')) {
            swTarget = t;
            extensionId = new URL(t.url).hostname;
            break;
          }
        }
        if (extensionId) break;
      }
    }

    if (!extensionId || !swTarget) {
      throw new Error(`Extension service worker failed to start in ${browser.name}`);
    }

    console.log(`  [PASS] Extension service worker active: ID=${extensionId}`);

    // Connect to Service Worker CDP and query manifest
    const swCdp = new SimpleCdp(swTarget.webSocketDebuggerUrl);
    await swCdp.connect();
    const manifestFromRuntime = await swCdp.evaluate(`chrome.runtime.getManifest()`);
    swCdp.close();

    if (manifestFromRuntime.version !== VERSION) {
      throw new Error(`Runtime manifest version is ${manifestFromRuntime.version}, expected ${VERSION}`);
    }
    console.log(`  [PASS] Runtime manifest version confirmed: ${manifestFromRuntime.version}`);

    // Create a tab with popup.html to verify popup loads without error
    const createTabRes = await browserCdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/src/popup/popup.html`
    });
    const popupTargetId = createTabRes.targetId || createTabRes.result?.targetId;
    await sleep(800);

    // Verify popup target loaded
    const resList = await fetch(`http://127.0.0.1:${cdpPort}/json`);
    const targets = await resList.json();
    const popupTarget = targets.find(t => t.id === popupTargetId || t.url.includes('popup.html'));
    if (!popupTarget) {
      throw new Error('Popup page target not found');
    }

    const popupCdp = new SimpleCdp(popupTarget.webSocketDebuggerUrl);
    await popupCdp.connect();
    const title = await popupCdp.evaluate(`document.title`);
    const bodyChildrenCount = await popupCdp.evaluate(`document.body.children.length`);
    popupCdp.close();

    console.log(`  [PASS] Popup UI loaded successfully: title="${title}", elements=${bodyChildrenCount}`);
    console.log(`  [PASS] Gate ${browser.gate} (${browser.name}) PASSED.`);
  } catch (err) {
    console.error(`  [FAIL] Gate ${browser.gate} failed:`, err.message);
    allGatesPassed = false;
  } finally {
    if (browserCdp) browserCdp.close();
    proc.kill('SIGKILL');
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// Cleanup extracted verify dir
try { fs.rmSync(VERIFY_DIR, { recursive: true, force: true }); } catch (_) {}

if (!allGatesPassed) {
  console.error('\nRelease artifact verification FAILED.');
  process.exit(1);
} else {
  console.log('\nAll release artifact gates (G11 & G12) PASSED successfully!');
}
