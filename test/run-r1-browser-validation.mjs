/**
 * WebAudioBalance - R1 Browser Audio-Path Validation Runner
 * Executes real browser AudioWorklet continuous loudness measurement, GainProcessor,
 * SafetyHook, and processed-output verification in real Chromium (Edge or Chrome).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const HTTP_PORT = 8089;
const CDP_PORT = 9240;

const EXTENSION_ROOT = process.cwd();

// Lightweight static HTTP server with proper JS MIME type for ES modules and AudioWorklets
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
  return new Promise(r => setTimeout(r, ms));
}

function findBrowserExe() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  if (fs.existsSync(edgePath)) return { name: 'Microsoft Edge', exe: edgePath };
  if (fs.existsSync(chromePath)) return { name: 'Google Chrome', exe: chromePath };
  throw new Error('Neither Microsoft Edge nor Google Chrome found on system');
}

async function main() {
  console.log('===============================================================');
  console.log('R1 — Browser Audio-Path Real AudioWorklet Validation');
  console.log('===============================================================\n');

  server.listen(HTTP_PORT);
  console.log(`Local HTTP fixture server listening on http://127.0.0.1:${HTTP_PORT}`);

  const browser = findBrowserExe();
  console.log(`Using browser: ${browser.name} (${browser.exe})`);

  const tmpProfile = path.join(tmpdir(), 'wab_r1_browser_' + Date.now());
  fs.mkdirSync(tmpProfile, { recursive: true });

  const fixtureUrl = `http://127.0.0.1:${HTTP_PORT}/test/fixtures/r1-audio-core/browser-fixture.html`;

  const proc = spawn(browser.exe, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${tmpProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    fixtureUrl
  ], { stdio: 'ignore' });

  try {
    let versionInfo = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (res.ok) {
          versionInfo = await res.json();
          break;
        }
      } catch (_) {}
    }

    if (!versionInfo) {
      throw new Error('Failed to connect to CDP endpoint on port ' + CDP_PORT);
    }
    console.log(`Connected to CDP (${versionInfo.Product})`);

    // Fetch tab target
    let targetPage = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
        const list = await res.json();
        targetPage = list.find(t => t.url.includes('browser-fixture.html'));
        if (targetPage) break;
      } catch (_) {}
    }

    if (!targetPage) {
      throw new Error('Browser fixture tab not found');
    }
    console.log(`Found target page: ${targetPage.url}`);

    const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
    await new Promise(r => ws.onopen = r);

    let id = 1;
    function send(method, params = {}) {
      return new Promise(resolve => {
        const curId = id++;
        const handler = (e) => {
          const d = JSON.parse(e.data);
          if (d.id === curId) {
            ws.removeEventListener('message', handler);
            resolve(d.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });
    }

    await send('Runtime.enable');

    console.log('\nRunning in-browser R1 test suite (AudioWorklet + Gain + Safety + Verification)...');
    console.log('Waiting for contiguous 3.0s window settling and multi-engine convergence...\n');

    const evalRes = await send('Runtime.evaluate', {
      expression: 'window.runBrowserR1Suite()',
      awaitPromise: true,
      returnByValue: true
    });

    const results = evalRes?.result?.value;
    if (!results || evalRes.exceptionDetails) {
      console.error('Browser execution error:', evalRes.exceptionDetails || 'No result returned');
      process.exit(1);
    }

    console.log('---------------------------------------------------------------');
    console.log('BROWSER AUDIO-PATH EVIDENCE TABLE');
    console.log('---------------------------------------------------------------');
    results.tests.forEach(t => {
      const mark = t.pass ? '[PASS]' : '[FAIL]';
      console.log(`  ${mark} ${t.name}: ${t.detail}`);
    });

    console.log('\n===============================================================');
    console.log(`BROWSER VALIDATION RESULT: ${results.passed} PASSED, ${results.failed} FAILED`);
    console.log('===============================================================\n');

    ws.close();

    if (results.failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Browser validation failed with exception:', err);
    process.exit(1);
  } finally {
    proc.kill();
    server.close();
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (_) {}
  }
}

main();
