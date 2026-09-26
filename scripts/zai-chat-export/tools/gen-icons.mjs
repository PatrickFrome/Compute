// Генератор PNG-иконок для Chrome-расширения (без внешних зависимостей).
// Запуск: node gen-icons.mjs <output-dir>
// Рисует: скруглённый тёмный квадрат + белая стрелка вниз (download).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || '.';
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 128; // масштаб геометрии от базовых 128
  const radius = 28 * S, inset = 5 * S;
  const bg = [0x11, 0x18, 0x27];
  const inRect = (x, y) => {
    if (x < inset || x > size - 1 - inset || y < inset || y > size - 1 - inset) return false;
    const cx = Math.max(inset + radius - x, x - (size - 1 - inset - radius), 0);
    const cy = Math.max(inset + radius - y, y - (size - 1 - inset - radius), 0);
    return Math.hypot(cx, cy) <= radius + 0.5;
  };
  const inArrow = (x, y) => {
    const sx1 = 54 * S, sx2 = 74 * S, top = 30 * S, mid = 70 * S;
    const hx1 = 34 * S, hx2 = 94 * S, tip = 102 * S;
    if (x >= sx1 && x <= sx2 && y >= top && y <= mid) return true;
    if (y >= mid && y <= tip) {
      const half = (hx2 - hx1) / 2 * (1 - (y - mid) / (tip - mid));
      const cx = (hx1 + hx2) / 2;
      return Math.abs(x - cx) <= half;
    }
    return false;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (inRect(x, y)) {
        px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255;
        if (inArrow(x, y)) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; }
      } else {
        px[i + 3] = 0;
      }
    }
  }
  return png(size, size, px);
}

for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('written', file, fs.statSync(file).size, 'bytes');
}
