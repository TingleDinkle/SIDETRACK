/**
 * navmock.mjs — render just the bottom tab bar (Levels / Shop / Home / Daily /
 * Settings) with the centre Home tab ACTIVE as a full gold block (btn_yellow
 * 9-slice, matching the .navtab.active::before CSS), to confirm the gold look.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';
const UI = 'assets/ui';
const cache = {};
const img = (n) => (cache[n] ??= decodePNG(fs.readFileSync(`${UI}/${n}.png`)));
const W = 440, H = 110;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 32; out[i * 4 + 1] = 42; out[i * 4 + 2] = 70; out[i * 4 + 3] = 255; }
for (let x = 0; x < W; x++) { const d = (2 * W + x) * 4; out[d] = 255; out[d + 1] = 255; out[d + 2] = 255; out[d + 3] = 255; } // top hairline
const px = (x, y, r, g, b, a = 1) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const d = (y * W + x) * 4; out[d] = r * a + out[d] * (1 - a) | 0; out[d + 1] = g * a + out[d + 1] * (1 - a) | 0; out[d + 2] = b * a + out[d + 2] * (1 - a) | 0; out[d + 3] = 255; };
const blit = (s, sx, sy, sw, sh, dx, dy, dw, dh) => { if (dw <= 0 || dh <= 0) return; for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const u = sx + Math.min(sw - 1, x / dw * sw | 0), v = sy + Math.min(sh - 1, y / dh * sh | 0), p = (v * s.width + u) * 4, a = s.data[p + 3] / 255; if (a > 0) px(dx + x, dy + y, s.data[p], s.data[p + 1], s.data[p + 2], a); } };
const nine = (name, [sl, st, sr, sb], [bl, bt, br, bb], dx, dy, tw, th) => { const s = img(name), Wd = s.width, Hd = s.height, smw = Wd - sl - sr, smh = Hd - st - sb, dmw = tw - bl - br, dmh = th - bt - bb; blit(s, 0, 0, sl, st, dx, dy, bl, bt); blit(s, Wd - sr, 0, sr, st, dx + tw - br, dy, br, bt); blit(s, 0, Hd - sb, sl, sb, dx, dy + th - bb, bl, bb); blit(s, Wd - sr, Hd - sb, sr, sb, dx + tw - br, dy + th - bb, br, bb); blit(s, sl, 0, smw, st, dx + bl, dy, dmw, bt); blit(s, sl, Hd - sb, smw, sb, dx + bl, dy + th - bb, dmw, bb); blit(s, 0, st, sl, smh, dx, dy + bt, bl, dmh); blit(s, Wd - sr, st, sr, smh, dx + tw - br, dy + bt, br, dmh); blit(s, sl, st, smw, smh, dx + bl, dy + bt, dmw, dmh); };
const icon = (name, cx, cy, size) => { const s = img(name), sc = Math.min(size / s.width, size / s.height), w = s.width * sc | 0, h = s.height * sc | 0; blit(s, 0, 0, s.width, s.height, cx - (w / 2 | 0), cy - (h / 2 | 0), w, h); };

const tabs = [['ic_calendar', false], ['ic_shop', false], ['ic_home', true], ['ic_mail', false], ['ic_gear', false]];
const tw = W / 5;
tabs.forEach(([ic, active], i) => {
  const x = i * tw, cy = 56;
  if (active) nine('btn_yellow', [46, 46, 46, 46], [14, 14, 14, 14], x + 4, 10, tw - 8, 92); // gold block
  icon(ic, x + tw / 2 | 0, cy, active ? 34 : 28);
});
fs.writeFileSync(`${process.argv[2] || '.'}/nav_mockup.png`, encodePNG(W, H, out));
console.log('wrote nav_mockup.png — Home (centre) active as a gold block');
