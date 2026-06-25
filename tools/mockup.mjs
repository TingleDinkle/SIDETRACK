/**
 * mockup.mjs — composite a rough phone-screen mock of the reskinned Sidetrack HUD
 * from the actual UI-kit slices, so the assembled look (colour harmony, layout,
 * the bright kit chrome over a dark slate frame around the warm board) can be
 * eyeballed without a browser. Approximate (no text) — confirms composition only.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';

const UI = 'assets/ui';
const cache = {};
const img = (n) => (cache[n] ??= decodePNG(fs.readFileSync(`${UI}/${n}.png`)));

const W = 420, H = 940;
const out = Buffer.alloc(W * H * 4);
// dark slate radial-ish vertical gradient
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = Math.round(40 * (1 - t) + 22 * t), g = Math.round(49 * (1 - t) + 26 * t), b = Math.round(80 * (1 - t) + 39 * t);
  for (let x = 0; x < W; x++) { const d = (y * W + x) * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255; }
}

function px(x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const d = (y * W + x) * 4;
  out[d] = Math.round(r * a + out[d] * (1 - a));
  out[d + 1] = Math.round(g * a + out[d + 1] * (1 - a));
  out[d + 2] = Math.round(b * a + out[d + 2] * (1 - a));
  out[d + 3] = 255;
}
function blit(src, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (dw <= 0 || dh <= 0) return;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const u = sx + Math.min(sw - 1, Math.floor((x / dw) * sw)), v = sy + Math.min(sh - 1, Math.floor((y / dh) * sh));
    const s = (v * src.width + u) * 4, a = src.data[s + 3] / 255;
    if (a > 0) px(dx + x, dy + y, src.data[s], src.data[s + 1], src.data[s + 2], a);
  }
}
function nine(name, [sl, st, sr, sb], [bl, bt, br, bb], dx, dy, tw, th) {
  const s = img(name), Wd = s.width, Hd = s.height, smw = Wd - sl - sr, smh = Hd - st - sb, dmw = tw - bl - br, dmh = th - bt - bb;
  blit(s, 0, 0, sl, st, dx, dy, bl, bt); blit(s, Wd - sr, 0, sr, st, dx + tw - br, dy, br, bt);
  blit(s, 0, Hd - sb, sl, sb, dx, dy + th - bb, bl, bb); blit(s, Wd - sr, Hd - sb, sr, sb, dx + tw - br, dy + th - bb, br, bb);
  blit(s, sl, 0, smw, st, dx + bl, dy, dmw, bt); blit(s, sl, Hd - sb, smw, sb, dx + bl, dy + th - bb, dmw, bb);
  blit(s, 0, st, sl, smh, dx, dy + bt, bl, dmh); blit(s, Wd - sr, st, sr, smh, dx + tw - br, dy + bt, br, dmh);
  blit(s, sl, st, smw, smh, dx + bl, dy + bt, dmw, dmh);
}
function icon(name, cx, cy, size) { const s = img(name), sc = Math.min(size / s.width, size / s.height); const w = s.width * sc | 0, h = s.height * sc | 0; blit(s, 0, 0, s.width, s.height, cx - w / 2 | 0, cy - h / 2 | 0, w, h); }
function rrect(x, y, w, h, r, cr, cg, cb) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = Math.max(r - i, i - (w - 1 - r), 0), dy = Math.max(r - j, j - (h - 1 - r), 0); if (dx * dx + dy * dy <= r * r) px(x + i, y + j, cr, cg, cb, 1); } }

// ---- header: navy bar + 2 icon buttons + count box ----
nine('bar_navy', [64, 64, 64, 64], [24, 24, 24, 24], 8, 10, W - 16, 56);
nine('icon_bg', [44, 44, 44, 44], [16, 16, 16, 16], 18, 14, 48, 48);   // menu
nine('icon_bg', [44, 44, 44, 44], [16, 16, 16, 16], 72, 14, 48, 48);   // mute
nine('countbox', [34, 30, 34, 30], [16, 14, 16, 14], W - 150, 22, 130, 40); // budget

// ---- board placeholder (warm, like the canvas) ----
rrect(12, 78, W - 24, 366, 16, 0xea, 0xd9, 0xbb);
// faint grid lines on the warm board
for (let i = 1; i < 5; i++) { const gx = 12 + ((W - 24) * i / 5) | 0; for (let y = 80; y < 442; y++) px(gx, y, 80, 60, 30, 0.08); }

// ---- booster row: 4 dark icon squares with ability icons ----
const bx0 = (W - (4 * 66 + 3 * 12)) / 2 | 0;
['ic_reverse', 'ic_plus', 'ic_hold', 'ic_boost'].forEach((ic, i) => {
  const x = bx0 + i * (66 + 12), y = 456;
  nine('icon_bg', [44, 44, 44, 44], [16, 16, 16, 16], x, y, 66, 66);
  icon(ic, x + 33, y + 30, 36);
});

// ---- footer action bar ----
const fy = 540, fh = 56;
nine('icon_bg', [44, 44, 44, 44], [18, 18, 18, 18], 12, fy, 52, fh);      // undo
nine('icon_bg', [44, 44, 44, 44], [18, 18, 18, 18], 70, fy, 52, fh);      // redo
nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 128, fy, 70, fh);    // reset
nine('btn_green', [64, 0, 64, 0], [28, 0, 28, 0], 204, fy, 120, fh);      // PLAY (pill)
nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 330, fy, 76, fh);    // step

// ---- outcome card overlay (lower third) ----
const oy = 636;
for (let y = oy - 16; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 10, 14, 24, 0.55); // dim
nine('panel_cyan', [120, 120, 120, 120], [34, 34, 34, 34], 56, oy, W - 112, 250);
nine('title_magenta', [96, 0, 96, 0], [40, 0, 40, 0], W / 2 - 110, oy + 20, 220, 58); // "Solved!" banner
const byy = oy + 250 - 70;
nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 80, byy, 90, 50);     // Edit
nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 178, byy, 90, 50);    // Replay
nine('btn_yellow', [46, 46, 46, 46], [20, 20, 20, 20], 276, byy, 86, 50);  // Next

const SCRATCH = process.argv[2] || '.';
fs.writeFileSync(`${SCRATCH}/hud_mockup.png`, encodePNG(W, H, out));
console.log(`wrote ${SCRATCH}/hud_mockup.png (${W}x${H})`);
