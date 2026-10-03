/**
 * WebAudioBalance CDP Inspector
 * Connects via WebSocket to inspect targets and load extension popup/pages
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

async function inspectBrowser(browserName, browserExe) {
  console.log(`\n========================================`);
  console.log(`Testing ${browserName}`);
  console.log(`========================================`);

  const userDataDir = join(tmpdir(), `wab_cdp_${browserName.toLowerCase().replace(/\s+/g, '_')}`);
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

  const proc = spawn(browserExe, args, { stdio: 'ignore' });

  try {
    let versionInfo = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        if (res.ok) {
          versionInfo = await res.json();
          break;
        }
      } catch (_) {}
    }

    if (!versionInfo) {
      throw new Error('Failed to connect to browser CDP endpoint');
    }

    console.log(`Browser Product: ${versionInfo.Product}`);
    console.log(`User-Agent:      ${versionInfo['User-Agent']}`);

    // Connect to browser target WebSocket
    const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);

    let msgId = 1;
    const callbacks = new Map();

    function sendCommand(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    const discoveredTargets = [];

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg.result);
        callbacks.delete(msg.id);
      }
      if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
        discoveredTargets.push(msg.params.targetInfo);
      }
    };

    // Discover all targets including background services
    await sendCommand('Target.setDiscoverTargets', { discover: true });
    await sleep(1000);

    const targetListRes = await sendCommand('Target.getTargets');
    const allTargets = targetListRes.targetInfos || [];

    console.log(`Discovered ${allTargets.length} targets:`);
    let extTarget = null;
    for (const t of allTargets) {
      console.log(`- Type: [${t.type}], URL: ${t.url}, Title: ${t.title || ''}`);
      if (t.url.includes('service-worker.js') || t.title.includes('WebAudioBalance')) {
        extTarget = t;
      }
    }

    if (extTarget) {
      console.log(`\n>> Found WebAudioBalance target: ${extTarget.type} (${extTarget.url})`);
    } else {
      console.log(`\n>> Note: Unpacked extension loaded, waiting to trigger popup/offscreen`);
    }

    ws.close();
  } catch (err) {
    console.error(`Error inspecting ${browserName}:`, err);
  } finally {
    proc.kill('SIGKILL');
    await sleep(1000);
  }
}

async function main() {
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgeExe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  await inspectBrowser('Google Chrome', chromeExe);
  await sleep(1000);
  await inspectBrowser('Microsoft Edge', edgeExe);
}

main();
