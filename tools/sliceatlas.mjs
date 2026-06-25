/**
 * sliceatlas.mjs — dependency-free PNG atlas slicer.
 *
 * Decodes an 8-bit RGBA PNG (using Node's built-in zlib), finds every
 * connected non-transparent blob (8-connectivity over an alpha threshold),
 * and crops each into its own PNG. Also emits a `regions.json` manifest and a
 * `contact.png` grid so the blobs can be eyeballed and labelled.
 *
 * Usage:
 *   node tools/sliceatlas.mjs "<input.png>" <outDir> [--alpha 40] [--min 2000] [--gap 0]
 *
 * Only colour type 6 (RGBA) / 2 (RGB), bit depth 8, non-interlaced is supported
 * (which is what the UI-kit atlases are). Pure data — no canvas, no deps.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

/* ----------------------------- PNG decode ----------------------------- */

function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.toString('ascii', p, p + 4); p += 4;
    const data = buf.subarray(p, p + len); p += len;
    p += 4; // crc
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2))
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let q = 0;
  const paeth = (a, b, c) => {
    const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const ft = raw[q++];
    for (let x = 0; x < stride; x++) {
      const rawb = raw[q++];
      const a = x >= channels ? cur[x - channels] : 0; // left
      const b = prev[x]; // up
      const c = x >= channels ? prev[x - channels] : 0; // up-left
      let v;
      switch (ft) {
        case 0: v = rawb; break;
        case 1: v = rawb + a; break;
        case 2: v = rawb + b; break;
        case 3: v = rawb + ((a + b) >> 1); break;
        case 4: v = rawb + paeth(a, b, c); break;
        default: throw new Error('bad filter ' + ft);
      }
      cur[x] = v & 0xff;
    }
    // expand scanline -> RGBA
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = cur[s + 1];
      out[d + 2] = cur[s + 2];
      out[d + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

/* ----------------------------- PNG encode ----------------------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    img.data.copy(out, y * w * 4, src, src + w * 4);
  }
  return out;
}

/* ----------------------- connected components ----------------------- */

function label(img, alphaThresh, minArea) {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const comps = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || data[i * 4 + 3] < alphaThresh) continue;
    let sp = 0; stack[sp++] = i; seen[i] = 1;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    while (sp) {
      const c = stack[--sp];
      const cx = c % W, cy = (c / W) | 0;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      area++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || data[ni * 4 + 3] < alphaThresh) continue;
        seen[ni] = 1; stack[sp++] = ni;
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (area >= minArea && w >= 8 && h >= 8) comps.push({ x: minX, y: minY, w, h, area });
  }
  // reading order: top-to-bottom, then left-to-right (banded)
  comps.sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
  return comps;
}

/* ----------------------------- contact sheet ----------------------------- */

function contactSheet(img, comps, cell = 240, pad = 10) {
  const cols = Math.ceil(Math.sqrt(comps.length)) || 1;
  const rows = Math.ceil(comps.length / cols);
  const W = cols * cell, H = rows * cell;
  const out = Buffer.alloc(W * H * 4);
  // mid-grey opaque background so transparent + dark blobs both read
  for (let i = 0; i < W * H; i++) { out[i * 4] = 70; out[i * 4 + 1] = 74; out[i * 4 + 2] = 82; out[i * 4 + 3] = 255; }
  comps.forEach((c, idx) => {
    const col = idx % cols, row = (idx / cols) | 0;
    const box = cell - pad * 2;
    const scale = Math.min(box / c.w, box / c.h, 1);
    const dw = Math.max(1, Math.round(c.w * scale)), dh = Math.max(1, Math.round(c.h * scale));
    const ox = col * cell + ((cell - dw) >> 1), oy = row * cell + ((cell - dh) >> 1);
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      const sx = c.x + Math.min(c.w - 1, (x / scale) | 0), sy = c.y + Math.min(c.h - 1, (y / scale) | 0);
      const s = (sy * img.width + sx) * 4, d = ((oy + y) * W + (ox + x)) * 4;
      const a = img.data[s + 3] / 255;
      out[d] = Math.round(img.data[s] * a + out[d] * (1 - a));
      out[d + 1] = Math.round(img.data[s + 1] * a + out[d + 1] * (1 - a));
      out[d + 2] = Math.round(img.data[s + 2] * a + out[d + 2] * (1 - a));
      out[d + 3] = 255;
    }
  });
  return { buf: encodePNG(W, H, out), cols, rows };
}

export { decodePNG, encodePNG, crop, contactSheet };

/* ----------------------------- main ----------------------------- */

// Only run the CLI when invoked directly (not when imported by montage.mjs).
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (!invokedDirectly) { /* imported as a module */ }
else {
const args = process.argv.slice(2);
const input = args[0];
const outDir = args[1];
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? Number(args[i + 1]) : def; };
if (!input || !outDir) { console.error('usage: node tools/sliceatlas.mjs <input.png> <outDir> [--alpha 40] [--min 2000]'); process.exit(1); }
const alpha = opt('alpha', 40), minArea = opt('min', 2000);

fs.mkdirSync(outDir, { recursive: true });
const img = decodePNG(fs.readFileSync(input));
console.log(`decoded ${path.basename(input)} ${img.width}x${img.height}`);
const comps = label(img, alpha, minArea);
console.log(`found ${comps.length} blobs (alpha>${alpha}, area>=${minArea})`);
const regions = comps.map((c, i) => {
  const file = `comp_${String(i).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(outDir, file), encodePNG(c.w, c.h, crop(img, c.x, c.y, c.w, c.h)));
  return { i, file, x: c.x, y: c.y, w: c.w, h: c.h, area: c.area };
});
fs.writeFileSync(path.join(outDir, 'regions.json'), JSON.stringify(regions, null, 2));
const cs = contactSheet(img, comps);
fs.writeFileSync(path.join(outDir, 'contact.png'), cs.buf);
console.log(`wrote ${regions.length} crops + regions.json + contact.png (${cs.cols}x${cs.rows} grid) -> ${outDir}`);
for (const r of regions) console.log(`  #${r.i}  ${r.w}x${r.h}\t@(${r.x},${r.y})\tarea=${r.area}`);
}
