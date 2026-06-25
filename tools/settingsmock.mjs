/**
 * settingsmock.mjs — mock the new Settings screen (slider rows + colored round
 * icons + Follow/Share badges + Reset) and the styled confirm popup, to compare
 * against the 300MIND reference. Text/glyphs can't render here — verified live;
 * this confirms layout, sprites, colours, the slider tracks/knobs and the popup.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';
const UI = 'assets/ui';
const cache = {};
const img = (n) => (cache[n] ??= decodePNG(fs.readFileSync(`${UI}/${n}.png`)));
const W = 420, H = 940;
const out = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) { const t = y / H, r = 42 * (1 - t) + 20 * t | 0, g = 51 * (1 - t) + 24 * t | 0, b = 88 * (1 - t) + 38 * t | 0; for (let x = 0; x < W; x++) { const d = (y * W + x) * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255; } }
function px(x, y, r, g, b, a = 1) { if (x < 0 || y < 0 || x >= W || y >= H) return; const d = (y * W + x) * 4; out[d] = r * a + out[d] * (1 - a) | 0; out[d + 1] = g * a + out[d + 1] * (1 - a) | 0; out[d + 2] = b * a + out[d + 2] * (1 - a) | 0; out[d + 3] = 255; }
function blit(s, sx, sy, sw, sh, dx, dy, dw, dh) { if (dw <= 0 || dh <= 0) return; for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const u = sx + Math.min(sw - 1, x / dw * sw | 0), v = sy + Math.min(sh - 1, y / dh * sh | 0), p = (v * s.width + u) * 4, a = s.data[p + 3] / 255; if (a > 0) px(dx + x, dy + y, s.data[p], s.data[p + 1], s.data[p + 2], a); } }
function nine(name, [sl, st, sr, sb], [bl, bt, br, bb], dx, dy, tw, th) { const s = img(name), Wd = s.width, Hd = s.height, smw = Wd - sl - sr, smh = Hd - st - sb, dmw = tw - bl - br, dmh = th - bt - bb; blit(s, 0, 0, sl, st, dx, dy, bl, bt); blit(s, Wd - sr, 0, sr, st, dx + tw - br, dy, br, bt); blit(s, 0, Hd - sb, sl, sb, dx, dy + th - bb, bl, bb); blit(s, Wd - sr, Hd - sb, sr, sb, dx + tw - br, dy + th - bb, br, bb); blit(s, sl, 0, smw, st, dx + bl, dy, dmw, bt); blit(s, sl, Hd - sb, smw, sb, dx + bl, dy + th - bb, dmw, bb); blit(s, 0, st, sl, smh, dx, dy + bt, bl, dmh); blit(s, Wd - sr, st, sr, smh, dx + tw - br, dy + bt, br, dmh); blit(s, sl, st, smw, smh, dx + bl, dy + bt, dmw, dmh); }
function icon(name, cx, cy, size) { const s = img(name), sc = Math.min(size / s.width, size / s.height), w = s.width * sc | 0, h = s.height * sc | 0; blit(s, 0, 0, s.width, s.height, cx - (w / 2 | 0), cy - (h / 2 | 0), w, h); }
function band(y0, y1, r, g, b, a = 1) { for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) px(x, y, r, g, b, a); }
function rrect(x, y, w, h, rad, cr, cg, cb, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = Math.max(rad - i, i - (w - 1 - rad), 0), dy = Math.max(rad - j, j - (h - 1 - rad), 0); if (dx * dx + dy * dy <= rad * rad) px(x + i, y + j, cr, cg, cb, a); } }
function circle(cx, cy, r, cr, cg, cb, a = 1) { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) px(cx + i, cy + j, cr, cg, cb, a); }

// top bar
band(0, 70, 33, 43, 70); band(68, 72, 0, 0, 0, 0.3);

// 3 slider rows
const rows = [[76, 203, 94], [230, 96, 74], [63, 147, 216]]; // green/red/blue icon colours
let y = 96;
for (const [r, g, b] of rows) {
  nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 16, y, W - 32, 60);
  circle(46, y + 30, 21, r, g, b); circle(40, y + 24, 8, 255, 255, 255, 0.35); // icon badge + gloss
  // slider track + gold knob
  const tx = 84, tw = W - 84 - 30, ty = y + 30;
  rrect(tx, ty - 8, tw, 16, 8, 21, 48, 106); // dark track
  const kx = tx + tw * (rows.indexOf([r, g, b]) === 1 ? 0.45 : 0.7) | 0; // knob position varies
  circle(kx, ty, 14, 255, 206, 58); circle(kx - 4, ty - 4, 5, 255, 241, 184); // knob + highlight
  y += 72;
}

// Follow/Share badges
y += 6;
rrect((W / 2 - 64) | 0, y, 54, 54, 16, 124, 95, 198); // share (purple)
rrect((W / 2 + 10) | 0, y, 54, 54, 16, 51, 64, 94);   // source (dark)

// Reset row
y += 76;
nine('btn_navy', [40, 40, 40, 40], [18, 18, 18, 18], 16, y, W - 32, 56);
nine('btn_red', [64, 0, 64, 0], [27, 0, 27, 0], W - 130, y + 4, 100, 48);

// bottom nav (Settings active)
const navY = H - 78; band(navY, H, 32, 42, 70); band(navY, navY + 3, 255, 255, 255, 0.06);
const tabs = ['ic_calendar', 'edit', 'ic_home', 'star', 'ic_gear'];
const tw2 = W / tabs.length;
tabs.forEach((t, i) => { const cx = (i + 0.5) * tw2 | 0, cy = navY + 30, active = i === 4; if (active) { rrect(cx - 25, cy - 19, 50, 38, 12, 255, 150, 40); } if (t.startsWith('ic_')) icon(t, cx, cy, i === 2 ? 34 : 28); else rrect(cx - 11, cy - 11, 22, 22, 5, 200, 210, 235, 0.5); });

// ---- popup overlay sample (lower) ----
const py = 470;
band(py - 12, py + 250, 10, 14, 24, 0.6);
nine('panel_cyan', [120, 120, 120, 120], [34, 34, 34, 34], 70, py, W - 140, 230);
nine('title_magenta', [96, 0, 96, 0], [40, 0, 40, 0], (W / 2 - 95) | 0, py + 16, 190, 54); // title
nine('btn_green', [64, 0, 64, 0], [27, 0, 27, 0], 96, py + 230 - 66, 100, 48); // Yes
nine('btn_red', [64, 0, 64, 0], [27, 0, 27, 0], 224, py + 230 - 66, 100, 48);   // No

const SCRATCH = process.argv[2] || '.';
fs.writeFileSync(`${SCRATCH}/settings_mockup.png`, encodePNG(W, H, out));
console.log(`wrote ${SCRATCH}/settings_mockup.png — settings sliders + follow/share + reset + nav, with a popup sample overlaid`);
