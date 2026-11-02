import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Draws the extension icon at every size the browsers ask for.
 *
 * The icon is generated rather than committed as opaque binaries: it must stay
 * consistent across sizes, and adding art assets is a design decision that
 * shouldn't be smuggled in as base64. A white map-pin on Jira blue.
 */
const SIZES = [16, 32, 48, 96, 128, 256, 512];
const OUT = path.resolve('extension/icons');

const BG = [12, 102, 228]; // #0C66E4
const FG = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed-distance helpers in unit space (0..1), so one drawing serves all sizes.
function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function insidePin(x, y) {
  const cx = 0.5;
  const headY = 0.40;
  const r = 0.195;
  // head: circle
  if ((x - cx) ** 2 + (y - headY) ** 2 <= r * r) {
    // hollow centre
    return (x - cx) ** 2 + (y - headY) ** 2 > (r * 0.38) ** 2;
  }
  // tail: triangle tapering down from the head
  const top = headY + r * 0.55;
  const bottom = 0.74;
  if (y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  const halfWidth = r * 0.62 * (1 - t);
  return Math.abs(x - cx) <= halfWidth;
}

function render(size) {
  const ss = 4; // supersampling
  const buffer = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let fgHits = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (!insideRoundedSquare(x, y, 0.22)) continue;
          bgHits += 1;
          if (insidePin(x, y)) fgHits += 1;
        }
      }
      const total = ss * ss;
      const index = (py * size + px) * 4;
      if (bgHits === 0) {
        buffer[index + 3] = 0;
        continue;
      }
      const fg = fgHits / total;
      const bg = bgHits / total;
      for (let c = 0; c < 3; c += 1) {
        buffer[index + c] = Math.round(BG[c] * (1 - fg) + FG[c] * fg);
      }
      buffer[index + 3] = Math.round(255 * bg);
    }
  }
  return png(size, size, buffer);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`[JiraTack] ${file} (${size}x${size})`);
}
