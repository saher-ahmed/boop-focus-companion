/**
 * create-icons.js
 * Generates icons/icon16.png, icon48.png, icon128.png
 * Run once: node create-icons.js
 *
 * No npm dependencies — uses only Node built-ins (zlib, fs, path).
 * Produces an anti-aliased filled circle in #6c63ff on a transparent background.
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC-32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG chunk helper ──────────────────────────────────────────────────────
function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body      = Buffer.concat([typeBytes, data]);
  const lenBuf    = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf    = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

// ── Build circle PNG (RGBA, transparent bg, #6c63ff fill) ────────────────
function buildCirclePNG(size) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 0.5;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter byte: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const alpha = Math.round(Math.max(0, Math.min(1, r + 0.75 - Math.sqrt(dx*dx + dy*dy))) * 255);
      row.push(108, 99, 255, alpha); // RGBA: #6c63ff
    }
    rows.push(Buffer.from(row));
  }

  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0); ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdrData),
    makeChunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write ─────────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buildCirclePNG(size));
  console.log(`✓  icons/icon${size}.png`);
}
console.log('\nDone. Load the extension in chrome://extensions → Load unpacked.');
