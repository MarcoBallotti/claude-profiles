// Original vector geometry, rasterized deterministically without external dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
const output = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'assets', 'trayTemplate.png');
function distance(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - (w / 2 - r), qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const size = 32, pixels = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  let coverage = 0;
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
    const px = x + (dx + .5) / 4, py = y + (dy + .5) / 4;
    const back = distance(px, py, 20, 12, 17, 16, 3), front = distance(px, py, 12, 20, 17, 16, 3);
    if (Math.abs(front) < 1.2 || (front > 1.5 && Math.abs(back) < 1.2)) coverage++;
  }
  pixels[y * (1 + size * 4) + 1 + x * 4 + 3] = Math.round(coverage * 255 / 16);
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, content) {
  const data = Buffer.concat([Buffer.from(type), content]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(content.length); crc.writeUInt32BE(crc32(data)); return Buffer.concat([length, data, crc]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
fs.writeFileSync(output, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
