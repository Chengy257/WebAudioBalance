/**
 * WebAudioBalance P0 Test Harness Launcher
 * Starts local HTTP server and opens browser with unpacked extension loaded
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSION_PATH = 'D:\\CHATGPT_WORKSPACE\\WebAudioBalance';
const HTTP_PORT = 8080;

const server = createServer((req, res) => {
  const cleanPath = req.url.split('?')[0];
  const filePath = join(EXTENSION_PATH, cleanPath);
  if (existsSync(filePath)) {
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
    else if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
    res.end(readFileSync(filePath));
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`\n======================================================`);
  console.log(`WebAudioBalance P0 Test Server running`);
  console.log(`URL: http://127.0.0.1:${HTTP_PORT}/test/test-page.html`);
  console.log(`======================================================\n`);

  const browser = process.argv[2] === 'chrome' ? 'chrome' : 'edge';
  const exePath = browser === 'chrome'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  console.log(`Launching ${browser.toUpperCase()} with unpacked extension...`);
  const child = spawn(exePath, [
    `--load-extension=${EXTENSION_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    `http://127.0.0.1:${HTTP_PORT}/test/test-page.html`
  ], { detached: true, stdio: 'ignore' });

  child.unref();

  console.log(`\nBrowser launched.`);
  console.log(`Test steps:`);
  console.log(`1. Click "Start 440Hz Sine Tone" on the test page.`);
  console.log(`2. Right-click the page -> "WebAudioBalance: Balance this tab", OR click the extension icon in the toolbar.`);
  console.log(`3. In the popup, view real-time RMS meter, test -6 dB, 0 dB, +6 dB gain.`);
  console.log(`4. Open a second tab to test multi-tab independent control.`);
});
