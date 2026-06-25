/**
 * uipick.mjs — copy chosen atlas components to assets/ui/<name>.png and lay them
 * out in a single labelled montage (scratch) so the whole picked set can be
 * eyeballed in one image before wiring it into the UI. Reuses the slicer codec.
 *
 * Usage: node tools/uipick.mjs <slice1Dir> <slice2Dir> <assetsUiDir> <montageOut>
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './sliceatlas.mjs';

// { atlas: 1|2, i: componentIndex, name } — semantic name -> assets/ui/<name>.png
const PICKS = [
  // atlas 2 — buttons, panels, ability icons
  { a: 2, i: 16, name: 'btn_green' },
  { a: 2, i: 17, name: 'btn_red' },
  { a: 2, i: 11, name: 'btn_orange' },
  { a: 2, i: 12, name: 'btn_navy' },
  { a: 2, i: 3, name: 'panel_cyan' },
  { a: 2, i: 1, name: 'title_magenta' },
  { a: 2, i: 6, name: 'bar_navy' },
  { a: 2, i: 4, name: 'field_light' },
  { a: 2, i: 0, name: 'panel_blue' },
  { a: 2, i: 5, name: 'card_surprise' },
  { a: 2, i: 8, name: 'ic_reverse' }, // swirl — Reverse
  { a: 2, i: 14, name: 'ic_hold' },   // hand  — Hold
  { a: 2, i: 10, name: 'ic_boost' },  // star-shield — Boost
  // atlas 1 — buttons, menus, icons
  { a: 1, i: 13, name: 'btn_yellow' },
  { a: 1, i: 14, name: 'menu_blue' },
  { a: 1, i: 15, name: 'menu_orange' },
  { a: 1, i: 22, name: 'icon_bg' },
  { a: 1, i: 2, name: 'ic_home' },
  { a: 1, i: 4, name: 'ic_gear' },
  { a: 1, i: 5, name: 'ic_check' },
  { a: 1, i: 16, name: 'ic_plus' },   // green + — +Track
  { a: 1, i: 62, name: 'countbox' },
  { a: 1, i: 67, name: 'ic_close' },
  { a: 1, i: 68, name: 'ic_back' },
];

const [s1, s2, uiDir, montageOut] = process.argv.slice(2);
if (!s1 || !s2 || !uiDir || !montageOut) {
  console.error('usage: node tools/uipick.mjs <slice1Dir> <slice2Dir> <assetsUiDir> <montageOut>');
  process.exit(1);
}
fs.mkdirSync(uiDir, { recursive: true });

const imgs = [];
PICKS.forEach((p, idx) => {
  const dir = p.a === 1 ? s1 : s2;
  const src = path.join(dir, `comp_${String(p.i).padStart(2, '0')}.png`);
  const buf = fs.readFileSync(src);
  fs.writeFileSync(path.join(uiDir, p.name + '.png'), buf);
  imgs.push({ ...decodePNG(buf), name: p.name });
  console.log(`  cell ${idx}\t${p.name}\t(atlas ${p.a} #${p.i})`);
});

// montage in PICKS order, mid-grey bg
const cols = 6, cell = 240, pad = 12;
const rows = Math.ceil(imgs.length / cols);
const W = cols * cell, H = rows * cell;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 64; out[i * 4 + 1] = 68; out[i * 4 + 2] = 76; out[i * 4 + 3] = 255; }
imgs.forEach((im, idx) => {
  const col = idx % cols, row = (idx / cols) | 0, box = cell - pad * 2;
  const scale = Math.min(box / im.width, box / im.height, 1);
  const dw = Math.max(1, Math.round(im.width * scale)), dh = Math.max(1, Math.round(im.height * scale));
  const ox = col * cell + ((cell - dw) >> 1), oy = row * cell + ((cell - dh) >> 1);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx = Math.min(im.width - 1, (x / scale) | 0), sy = Math.min(im.height - 1, (y / scale) | 0);
    const s = (sy * im.width + sx) * 4, d = ((oy + y) * W + (ox + x)) * 4;
    const al = im.data[s + 3] / 255;
    out[d] = Math.round(im.data[s] * al + out[d] * (1 - al));
    out[d + 1] = Math.round(im.data[s + 1] * al + out[d + 1] * (1 - al));
    out[d + 2] = Math.round(im.data[s + 2] * al + out[d + 2] * (1 - al));
    out[d + 3] = 255;
  }
});
fs.writeFileSync(montageOut, encodePNG(W, H, out));
console.log(`\ncopied ${imgs.length} -> ${uiDir}\nmontage (${cols} cols) -> ${montageOut}`);
