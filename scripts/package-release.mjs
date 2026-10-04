/**
 * WebAudioBalance - Automated Release Packaging Script
 * Generates:
 * 1. dist/webaudiobalance-v1.0.0.zip (Chrome Web Store / Edge Add-ons upload & manual load)
 * 2. dist/webaudiobalance-v1.0.0.crx (Direct installable Chromium CRX package)
 * 3. dist/webaudiobalance-v1.0.0.pem (Signing key for enterprise / self-distribution)
 * 4. SHA-256 release checksum manifest
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const ROOT_DIR = path.resolve('.');
const DIST_DIR = path.resolve('dist');
const UNPACKED_DIR = path.resolve('dist/unpacked');
const VERSION = '1.0.0';

console.log(`Packaging WebAudioBalance v${VERSION}...`);

// 1. Prepare clean directories
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(UNPACKED_DIR, { recursive: true });

// 2. Stage production runtime files (strictly omitting dev files, tests, git)
fs.copyFileSync(path.join(ROOT_DIR, 'manifest.json'), path.join(UNPACKED_DIR, 'manifest.json'));
fs.cpSync(path.join(ROOT_DIR, 'assets'), path.join(UNPACKED_DIR, 'assets'), { recursive: true });
fs.cpSync(path.join(ROOT_DIR, 'src'), path.join(UNPACKED_DIR, 'src'), { recursive: true });
console.log('Staged runtime files into dist/unpacked/');

// 3. Create Distribution ZIP archive using Windows built-in tar.exe
const zipPath = path.join(DIST_DIR, `webaudiobalance-v${VERSION}.zip`);
execFileSync('tar.exe', [
  '-a',
  '-cf',
  zipPath,
  '-C',
  UNPACKED_DIR,
  '.'
]);
console.log(`Created Web Store ZIP package: ${zipPath} (${fs.statSync(zipPath).size} bytes)`);

// 4. Create CRX Package using Chrome --pack-extension
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

let browserExe = chromeCandidates.find((p) => fs.existsSync(p));
if (browserExe) {
  // Chrome rejects --pack-extension if manifest.json already has "key"
  const stagedManifestPath = path.join(UNPACKED_DIR, 'manifest.json');
  const manifestData = JSON.parse(fs.readFileSync(stagedManifestPath, 'utf8'));
  const savedKey = manifestData.key;
  delete manifestData.key;
  fs.writeFileSync(stagedManifestPath, JSON.stringify(manifestData, null, 2));

  try {
    execFileSync(browserExe, [`--pack-extension=${UNPACKED_DIR}`]);

    const generatedCrx = path.join(DIST_DIR, 'unpacked.crx');
    const generatedPem = path.join(DIST_DIR, 'unpacked.pem');

    const targetCrx = path.join(DIST_DIR, `webaudiobalance-v${VERSION}.crx`);
    const targetPem = path.join(DIST_DIR, `webaudiobalance-v${VERSION}.pem`);

    if (fs.existsSync(generatedCrx)) {
      fs.renameSync(generatedCrx, targetCrx);
      console.log(`Created Chromium CRX package: ${targetCrx} (${fs.statSync(targetCrx).size} bytes)`);
    }
    if (fs.existsSync(generatedPem)) {
      fs.renameSync(generatedPem, targetPem);
      console.log(`Saved Signing Private Key: ${targetPem} (${fs.statSync(targetPem).size} bytes)`);
    }
  } catch (err) {
    console.warn('Could not pack CRX with browser CLI:', err.message);
  } finally {
    // Restore key in unpacked folder
    manifestData.key = savedKey;
    fs.writeFileSync(stagedManifestPath, JSON.stringify(manifestData, null, 2));
  }
}

// 5. Generate SHA-256 Checksums
function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const checksums = [];
fs.readdirSync(DIST_DIR).forEach((file) => {
  const full = path.join(DIST_DIR, file);
  if (fs.statSync(full).isFile() && !file.endsWith('.sha256')) {
    const hash = sha256(full);
    checksums.push(`${hash}  ${file}`);
  }
});

const checksumsPath = path.join(DIST_DIR, `SHA256SUMS.txt`);
fs.writeFileSync(checksumsPath, checksums.join('\n') + '\n');
console.log('\n--- Release Artifact Checksums (SHA-256) ---');
console.log(checksums.join('\n'));
console.log('--------------------------------------------\nPackaging Complete.');
