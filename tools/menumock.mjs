/**
 * menumock.mjs — composite a rough mock of the new meta-shell (level-select grid +
 * bottom tab nav) from the actual slices, to eyeball layout/colour without a
 * browser. Text (the white-outlined numbers) can't render here — that's verified
 * live — this confirms the cards, nav bar, icons and the orange active highlight.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';

const UI = 'assets/ui';
const cache = {};
const img = (n) => (cache[n] ??= decodePNG(fs.readFileSync(`${UI}/${n}.png`)));
const W = 420, H = 940;
const out = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  const t = y / H, r = Math.round(42 * (1 - t) + 20 * t), g = Math.round(51 * (1 - t) + 24 * t), b = Math.round(88 * (1 - t) + 38 * t);
  for (let x = 0; x < W; x++) { const d = (y * W + x) * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255; }
}
function px(x, y, r, g, b, a = 1) { if (x < 0 || y < 0 || x >= W || y >= H) return; const d = (y * W + x) * 4; out[d] = Math.round(r * a + out[d] * (1 - a)); out[d + 1] = Math.round(g * a + out[d + 1] * (1 - a)); out[d + 2] = Math.round(b * a + out[d + 2] * (1 - a)); out[d + 3] = 255; }
function blit(src, sx, sy, sw, sh, dx, dy, dw, dh) { if (dw <= 0 || dh <= 0) return; for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const u = sx + Math.min(sw - 1, (x / dw * sw) | 0), v = sy + Math.min(sh - 1, (y / dh * sh) | 0), s = (v * src.width + u) * 4, a = src.data[s + 3] / 255; if (a > 0) px(dx + x, dy + y, src.data[s], src.data[s + 1], src.data[s + 2], a); } }
function nine(name, [sl, st, sr, sb], [bl, bt, br, bb], dx, dy, tw, th) { const s = img(name), Wd = s.width, Hd = s.height, smw = Wd - sl - sr, smh = Hd - st - sb, dmw = tw - bl - br, dmh = th - bt - bb; blit(s, 0, 0, sl, st, dx, dy, bl, bt); blit(s, Wd - sr, 0, sr, st, dx + tw - br, dy, br, bt); blit(s, 0, Hd - sb, sl, sb, dx, dy + th - bb, bl, bb); blit(s, Wd - sr, Hd - sb, sr, sb, dx + tw - br, dy + th - bb, br, bb); blit(s, sl, 0, smw, st, dx + bl, dy, dmw, bt); blit(s, sl, Hd - sb, smw, sb, dx + bl, dy + th - bb, dmw, bb); blit(s, 0, st, sl, smh, dx, dy + bt, bl, dmh); blit(s, Wd - sr, st, sr, smh, dx + tw - br, dy + bt, br, dmh); blit(s, sl, st, smw, smh, dx + bl, dy + bt, dmw, dmh); }
function icon(name, cx, cy, size) { const s = img(name), sc = Math.min(size / s.width, size / s.height), w = s.width * sc | 0, h = s.height * sc | 0; blit(s, 0, 0, s.width, s.height, cx - (w / 2 | 0), cy - (h / 2 | 0), w, h); }
function band(y0, y1, r, g, b, a = 1) { for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) px(x, y, r, g, b, a); }
function rrect(x, y, w, h, rad, cr, cg, cb, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = Math.max(rad - i, i - (w - 1 - rad), 0), dy = Math.max(rad - j, j - (h - 1 - rad), 0); if (dx * dx + dy * dy <= rad * rad) px(x + i, y + j, cr, cg, cb, a); } }

// ---- top bar ----
band(0, 70, 33, 43, 70); band(68, 72, 0, 0, 0, 0.3);
nine('countbox', [34, 30, 34, 30], [16, 14, 16, 14], W - 132, 18, 116, 38); // progress pill
icon('ic_check', W - 116, 37, 26);

// ---- level grid (3 cols) ----
const cols = 3, gap = 14, pad = 16, cw = ((W - pad * 2 - gap * (cols - 1)) / cols) | 0, ch = 92;
let gx = pad, gy = 96, n = 1;
for (let row = 0; row < 4; row++) {
  for (let c = 0; c < cols; c++) {
    const done = n % 4 === 0;
    nine(done ? 'panel_cyan' : 'panel_blue', [120, 120, 120, 120], [22, 22, 22, 22], gx, gy, cw, ch);
    if (done) icon('ic_check', gx + cw - 8, gy - 2, 30); // solved badge
    gx += cw + gap; n++;
  }
  gx = pad; gy += ch + gap;
}

// ---- bottom tab nav ----
const navY = H - 78;
band(navY, H, 32, 42, 70); band(navY, navY + 3, 255, 255, 255, 0.06);
const tabs = [
  { ic: 'ic_calendar', glyph: null, active: true },   // Levels (active)
  { ic: null, glyph: 'edit', active: false },          // Editor
  { ic: 'ic_home', glyph: null, active: false, center: true }, // Play (center)
  { ic: 'ic_check', glyph: 'star', active: false },    // Stats
  { ic: 'ic_gear', glyph: null, active: false },       // Settings
];
const tw = W / tabs.length;
tabs.forEach((t, i) => {
  const cx = (i + 0.5) * tw | 0, cy = navY + 30, box = t.center ? 56 : 48, bh = t.center ? 42 : 36;
  if (t.active) {
    // orange rounded highlight
    rrect(cx - box / 2 | 0, cy - bh / 2 | 0, box, bh, 12, 255, 150, 40);
    rrect(cx - box / 2 | 0, cy - bh / 2 | 0, box, 6, 4, 255, 190, 90, 0.6);
  }
  if (t.ic) icon(t.ic, cx, cy, t.center ? 34 : 28);
  else { // glyph tab placeholder (a small light box) — real glyph renders in CSS
    rrect(cx - 11, cy - 11, 22, 22, 5, 200, 210, 235, 0.5);
  }
});

const SCRATCH = process.argv[2] || '.';
fs.writeFileSync(`${SCRATCH}/menu_mockup.png`, encodePNG(W, H, out));
console.log(`wrote ${SCRATCH}/menu_mockup.png (${W}x${H}) — grid + bottom nav (Levels active)`);
