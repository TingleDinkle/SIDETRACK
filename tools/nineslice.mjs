/**
 * nineslice.mjs — simulate CSS `border-image` 9-slice scaling in pure Node so the
 * chosen slice insets can be eyeballed BEFORE they go into the stylesheet (no
 * browser needed to validate the UI scaling). Renders each element at a couple of
 * game-realistic sizes onto a slate backdrop and montages them.
 *
 * The `slice` insets here are SOURCE pixels — identical to `border-image-slice`,
 * so whatever looks right in the montage maps 1:1 into CSS.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';

const UI = 'assets/ui';
// [name, sliceSrc[l,t,r,b] (border-image-slice, source px),
//        borderDst[l,t,r,b] (border-image-width, rendered px), [[w,h]...] sizes]
// Pills get borderDst top/bottom = 0 (horizontal 3-slice; caps keep aspect).
const ELS = [
  ['btn_green', [64, 0, 64, 0], [27, 0, 27, 0], [[190, 54], [120, 54]]],
  ['btn_red', [64, 0, 64, 0], [27, 0, 27, 0], [[150, 54]]],
  ['btn_navy', [40, 40, 40, 40], [20, 20, 20, 20], [[200, 50], [104, 50]]],
  ['btn_orange', [40, 40, 40, 40], [20, 20, 20, 20], [[150, 50]]],
  ['btn_yellow', [46, 46, 46, 46], [22, 22, 22, 22], [[150, 56]]],
  ['title_magenta', [96, 0, 96, 0], [40, 0, 40, 0], [[360, 70]]],
  ['bar_navy', [64, 64, 64, 64], [26, 26, 26, 26], [[680, 64]]],
  ['field_light', [56, 56, 56, 56], [22, 22, 22, 22], [[420, 56]]],
  ['panel_cyan', [120, 120, 120, 120], [34, 34, 34, 34], [[520, 320], [300, 240]]],
  ['panel_blue', [120, 120, 120, 120], [34, 34, 34, 34], [[300, 220]]],
  ['countbox', [34, 30, 34, 30], [16, 14, 16, 14], [[150, 44]]],
  ['menu_blue', [44, 44, 44, 44], [22, 22, 22, 22], [[72, 72]]],
  ['icon_bg', [44, 44, 44, 44], [22, 22, 22, 22], [[72, 72]]],
];

// nearest-neighbour blit of src rect -> dst rect, alpha-composited onto `out`
function blit(src, sx, sy, sw, sh, out, ow, dx, dy, dw, dh) {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const u = sx + Math.min(sw - 1, Math.floor((x / dw) * sw));
    const v = sy + Math.min(sh - 1, Math.floor((y / dh) * sh));
    const s = (v * src.width + u) * 4;
    const px = dx + x, py = dy + y;
    const d = (py * ow + px) * 4;
    const a = src.data[s + 3] / 255;
    out[d] = Math.round(src.data[s] * a + out[d] * (1 - a));
    out[d + 1] = Math.round(src.data[s + 1] * a + out[d + 1] * (1 - a));
    out[d + 2] = Math.round(src.data[s + 2] * a + out[d + 2] * (1 - a));
    out[d + 3] = 255;
  }
}

// CSS-accurate: source insets (sl) sampled into rendered borders (bl).
function nineSlice(src, [sl, st, sr, sb], [bl, bt, br, bb], tw, th, out, ow, ox, oy) {
  const W = src.width, H = src.height;
  const smw = W - sl - sr, smh = H - st - sb;     // src middle
  const dmw = tw - bl - br, dmh = th - bt - bb;   // dst middle
  blit(src, 0, 0, sl, st, out, ow, ox, oy, bl, bt);
  blit(src, W - sr, 0, sr, st, out, ow, ox + tw - br, oy, br, bt);
  blit(src, 0, H - sb, sl, sb, out, ow, ox, oy + th - bb, bl, bb);
  blit(src, W - sr, H - sb, sr, sb, out, ow, ox + tw - br, oy + th - bb, br, bb);
  blit(src, sl, 0, smw, st, out, ow, ox + bl, oy, dmw, bt);             // top
  blit(src, sl, H - sb, smw, sb, out, ow, ox + bl, oy + th - bb, dmw, bb); // bottom
  blit(src, 0, st, sl, smh, out, ow, ox, oy + bt, bl, dmh);             // left
  blit(src, W - sr, st, sr, smh, out, ow, ox + tw - br, oy + bt, br, dmh); // right
  blit(src, sl, st, smw, smh, out, ow, ox + bl, oy + bt, dmw, dmh);     // center
}

// lay every render into a flow on a slate backdrop
const cellW = 560, gap = 18;
const items = [];
for (const [name, slice, border, sizes] of ELS) {
  const src = decodePNG(fs.readFileSync(`${UI}/${name}.png`));
  for (const [w, h] of sizes) items.push({ name, src, slice, border, w, h });
}
const W = cellW + gap * 2;
let rowY = gap, totalH = gap;
const placed = items.map((it) => { const y = totalH; totalH += it.h + gap; return { ...it, y }; });
const H = totalH;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 32; out[i * 4 + 1] = 36; out[i * 4 + 2] = 46; out[i * 4 + 3] = 255; }
for (const it of placed) nineSlice(it.src, it.slice, it.border, it.w, it.h, out, W, gap, it.y);
const SCRATCH = process.argv[2] || '.';
fs.writeFileSync(`${SCRATCH}/nineslice_preview.png`, encodePNG(W, H, out));
console.log(`rendered ${placed.length} nine-slice samples -> ${SCRATCH}/nineslice_preview.png`);
placed.forEach((p) => console.log(`  ${p.name}  ${p.w}x${p.h}  slice[${p.slice.join(',')}]  y=${p.y}`));
