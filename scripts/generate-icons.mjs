/**
 * WebAudioBalance - Production Icon Generator
 * Generates crisp, compliant PNG icons (16x16, 32x32, 48x48, 128x128) using pure Node.js
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const crcTable = createCRC32Table();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePngChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function encodeRGBAtoPNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit per channel
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // Deflate compression
  ihdr[11] = 0; // Filter method
  ihdr[12] = 0; // Non-interlaced
  const ihdrChunk = writePngChunk('IHDR', ihdr);

  // Scanline filtering: 1 byte filter type (0 = None) + row bytes
  const rowBytes = width * 4;
  const rawScanlines = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    const rawOffset = y * (1 + rowBytes);
    rawScanlines[rawOffset] = 0; // Filter None
    rgbaBuffer.copy(rawScanlines, rawOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  // IDAT Chunk
  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });
  const idatChunk = writePngChunk('IDAT', compressed);

  // IEND Chunk
  const iendChunk = writePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Render WebAudioBalance icon pixels:
 * Circular rounded emblem in primary blue (#2563eb) with stylized sound wave bars (#ffffff)
 */
function renderIcon(size) {
  const buffer = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.46;

  // Soundwave bars definition (relative x and height fractions)
  const barCount = 4;
  const barWidth = Math.max(1, Math.round(size * 0.1));
  const barSpacing = Math.max(1, Math.round(size * 0.08));
  const totalBarsWidth = barCount * barWidth + (barCount - 1) * barSpacing;
  const startX = Math.round((size - totalBarsWidth) / 2);
  const barHeights = [0.35, 0.65, 0.85, 0.5]; // Balanced dynamic levels

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Distance from center for circle
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Anti-aliasing edge
        const edgeAlpha = Math.max(0, Math.min(1, radius - dist + 0.5));

        // Check if inside one of the bars
        let inBar = false;
        for (let b = 0; b < barCount; b++) {
          const bx = startX + b * (barWidth + barSpacing);
          const bHeight = Math.round(size * 0.55 * barHeights[b]);
          const bYStart = Math.round(center - bHeight / 2);
          const bYEnd = bYStart + bHeight;

          if (x >= bx && x < bx + barWidth && y >= bYStart && y <= bYEnd) {
            inBar = true;
            break;
          }
        }

        if (inBar) {
          // White bar
          buffer[idx] = 255;
          buffer[idx + 1] = 255;
          buffer[idx + 2] = 255;
          buffer[idx + 3] = Math.round(255 * edgeAlpha);
        } else {
          // Royal blue background (#2563eb = RGB 37, 99, 235)
          buffer[idx] = 37;
          buffer[idx + 1] = 99;
          buffer[idx + 2] = 235;
          buffer[idx + 3] = Math.round(255 * edgeAlpha);
        }
      } else {
        // Fully transparent background
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  return encodeRGBAtoPNG(size, size, buffer);
}

// Ensure directory
const outDir = path.resolve('assets/icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const sizes = [16, 32, 48, 128];
sizes.forEach((s) => {
  const png = renderIcon(s);
  const target = path.join(outDir, `icon-${s}.png`);
  fs.writeFileSync(target, png);
  console.log(`Generated ${target} (${png.length} bytes)`);
});
