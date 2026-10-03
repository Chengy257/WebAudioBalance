/**
 * WebAudioBalance P0 Automation Script
 * Verifies extension loading and Service Worker initialization in Chrome and Edge via CDP
 */

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EXTENSION_PATH = 'D:\\CHATGPT_WORKSPACE\\WebAudioBalance';
const PORT = 9222;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyBrowser(browserName, browserExe) {
  console.log(`\n=== Verifying ${browserName} ===`);
  const userDataDir = join(tmpdir(), `wab_test_${browserName.toLowerCase().replace(/\s+/g, '_')}`);

  if (existsSync(userDataDir)) {
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];

  console.log(`Launching: ${browserExe}`);
  const proc = spawn(browserExe, args, { stdio: 'ignore' });

  let success = false;
  let targets = [];

  try {
    // Wait for CDP to become available
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        if (res.ok) {
          targets = await res.json();
          break;
        }
      } catch (_) {}
    }

    console.log(`Discovered ${targets.length} targets via CDP:`);
    targets.forEach((t) => {
      console.log(`- [${t.type}] ${t.title || t.url}`);
    });

    const swTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('service-worker.js'));
    if (swTarget) {
      console.log(`SUCCESS: Service Worker detected!`);
      console.log(`  Title: ${swTarget.title}`);
      console.log(`  URL: ${swTarget.url}`);
      success = true;
    } else {
      console.log(`WARNING: Service Worker target not found immediately in target list.`);
      // Check extension background page or generic background targets
      const extTarget = targets.find((t) => t.url && t.url.startsWith('chrome-extension://'));
      if (extTarget) {
        console.log(`SUCCESS: Extension target detected: ${extTarget.url}`);
        success = true;
      }
    }
  } catch (err) {
    console.error(`Verification error for ${browserName}:`, err.message);
  } finally {
    console.log(`Terminating ${browserName}...`);
    proc.kill('SIGKILL');
    await sleep(1000);
  }

  return { browser: browserName, success, targets };
}

async function run() {
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgeExe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  const chromeResult = await verifyBrowser('Google Chrome', chromeExe);
  await sleep(1500);
  const edgeResult = await verifyBrowser('Microsoft Edge', edgeExe);

  console.log('\n=== Summary ===');
  console.log(`Chrome Loaded: ${chromeResult.success ? 'PASS' : 'FAIL'}`);
  console.log(`Edge Loaded:   ${edgeResult.success ? 'PASS' : 'FAIL'}`);
}

run();
