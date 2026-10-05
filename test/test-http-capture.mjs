/**
 * Test tabCapture against an HTTP origin (http://127.0.0.1:8080/test/test-page.html)
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EXTENSION_PATH = 'D:\\CHATGPT_WORKSPACE\\WebAudioBalance';
const HTTP_PORT = 8080;
const CDP_PORT = 9235;

// Simple static HTTP server
const server = createServer((req, res) => {
  const filePath = join(EXTENSION_PATH, req.url.split('?')[0]);
  if (existsSync(filePath)) {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    res.end(readFileSync(filePath));
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(HTTP_PORT, async () => {
  console.log(`Local HTTP server running on http://127.0.0.1:${HTTP_PORT}`);
  runTest();
});

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest() {
  const edgeExe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const testUrl = `http://127.0.0.1:${HTTP_PORT}/test/test-page.html`;

  const tmpDir = join(tmpdir(), 'wab_http_test_' + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  const proc = spawn(edgeExe, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tmpDir}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--allowlisted-extension-id=gfkjhobklaikenpabhmeppdcggojmohd',
    '--whitelisted-extension-id=gfkjhobklaikenpabhmeppdcggojmohd',
    '--no-first-run',
    '--no-default-browser-check',
    testUrl
  ], { stdio: 'ignore' });

  await sleep(2500);

  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const targets = await res.json();
    console.log('Targets:', targets.map(t => ({ type: t.type, url: t.url })));

    const testTab = targets.find(t => t.url.includes('test-page.html'));
    console.log('Test page tab found:', testTab?.url);

    // Open popup
    const popupUrl = 'chrome-extension://gfkjhobklaikenpabhmeppdcggojmohd/src/popup/popup.html';
    const createRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${popupUrl}`, { method: 'PUT' });
    const popupTarget = await createRes.json();
    console.log('Popup target created:', popupTarget.url);

    await sleep(1500);

    const ws = new WebSocket(popupTarget.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    const send = (method, params) => new Promise((resolve) => {
      const cur = id++;
      const onmsg = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === cur) {
          ws.removeEventListener('message', onmsg);
          resolve(m.result);
        }
      };
      ws.addEventListener('message', onmsg);
      ws.send(JSON.stringify({ id: cur, method, params }));
    });

    await send('Runtime.enable');

    // Query tabs from popup
    const captureRes = await send('Runtime.evaluate', {
      awaitPromise: true,
      expression: `
        (async () => {
          const tabs = await chrome.tabs.query({});
          const target = tabs.find(t => t.url && t.url.includes('127.0.0.1'));
          if (!target) return { error: 'Tab not found', tabs };
          console.log('Target tab from tabs.query:', target.id, target.url);

          let streamId = null;
          let streamErr = null;
          try {
            streamId = await new Promise((resolve, reject) => {
              chrome.tabCapture.getMediaStreamId({ targetTabId: target.id }, (id) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(id);
              });
            });
          } catch (e) {
            streamErr = e.message;
          }

          const res = await chrome.runtime.sendMessage({
            type: 'START_CAPTURE',
            target: 'service_worker',
            payload: { tabId: target.id, streamId }
          });
          return { res, streamId, streamErr, targetTabId: target.id };
        })()
      `,
      returnByValue: true
    });

    console.log('HTTP Origin Capture Result:', JSON.stringify(captureRes.result.value, null, 2));

    ws.close();
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    proc.kill('SIGKILL');
    server.close();
    process.exit(0);
  }
}
