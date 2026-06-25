/**
 * econmock.mjs — mock the economy screens (currency top bar, Shop booster rows,
 * Daily-reward grid, Scratch cards) from the real slices, to compare against the
 * 300MIND reference. Text can't render here — verified live — this confirms the
 * layout, sprites, currency pills, buy buttons, day cards and the bottom nav.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';
const UI = 'assets/ui';
const cache = {};
const img = (n) => (cache[n] ??= decodePNG(fs.readFileSync(`${UI}/${n}.png`)));

function mk(W, H) {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) { const t = y / H, r = 42 * (1 - t) + 20 * t | 0, g = 51 * (1 - t) + 24 * t | 0, b = 88 * (1 - t) + 38 * t | 0; for (let x = 0; x < W; x++) { const d = (y * W + x) * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255; } }
  const px = (x, y, r, g, b, a = 1) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const d = (y * W + x) * 4; out[d] = r * a + out[d] * (1 - a) | 0; out[d + 1] = g * a + out[d + 1] * (1 - a) | 0; out[d + 2] = b * a + out[d + 2] * (1 - a) | 0; out[d + 3] = 255; };
  const blit = (s, sx, sy, sw, sh, dx, dy, dw, dh) => { if (dw <= 0 || dh <= 0) return; for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const u = sx + Math.min(sw - 1, x / dw * sw | 0), v = sy + Math.min(sh - 1, y / dh * sh | 0), p = (v * s.width + u) * 4, a = s.data[p + 3] / 255; if (a > 0) px(dx + x, dy + y, s.data[p], s.data[p + 1], s.data[p + 2], a); } };
  const nine = (name, [sl, st, sr, sb], [bl, bt, br, bb], dx, dy, tw, th) => { const s = img(name), Wd = s.width, Hd = s.height, smw = Wd - sl - sr, smh = Hd - st - sb, dmw = tw - bl - br, dmh = th - bt - bb; blit(s, 0, 0, sl, st, dx, dy, bl, bt); blit(s, Wd - sr, 0, sr, st, dx + tw - br, dy, br, bt); blit(s, 0, Hd - sb, sl, sb, dx, dy + th - bb, bl, bb); blit(s, Wd - sr, Hd - sb, sr, sb, dx + tw - br, dy + th - bb, br, bb); blit(s, sl, 0, smw, st, dx + bl, dy, dmw, bt); blit(s, sl, Hd - sb, smw, sb, dx + bl, dy + th - bb, dmw, bb); blit(s, 0, st, sl, smh, dx, dy + bt, bl, dmh); blit(s, Wd - sr, st, sr, smh, dx + tw - br, dy + bt, br, dmh); blit(s, sl, st, smw, smh, dx + bl, dy + bt, dmw, dmh); };
  const icon = (name, cx, cy, size) => { const s = img(name), sc = Math.min(size / s.width, size / s.height), w = s.width * sc | 0, h = s.height * sc | 0; blit(s, 0, 0, s.width, s.height, cx - (w / 2 | 0), cy - (h / 2 | 0), w, h); };
  const band = (y0, y1, r, g, b, a = 1) => { for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) px(x, y, r, g, b, a); };
  const rrect = (x, y, w, h, rad, cr, cg, cb, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const dx = Math.max(rad - i, i - (w - 1 - rad), 0), dy = Math.max(rad - j, j - (h - 1 - rad), 0); if (dx * dx + dy * dy <= rad * rad) px(x + i, y + j, cr, cg, cb, a); } };
  return { W, H, out, px, blit, nine, icon, band, rrect, save: (p) => fs.writeFileSync(p, encodePNG(W, H, out)) };
}

function topbar(c) {
  c.band(0, 60, 33, 43, 70); c.band(58, 62, 0, 0, 0, 0.3);
  c.nine('countbox', [34, 30, 34, 30], [16, 14, 16, 14], 10, 10, 120, 40); c.icon('ic_coin', 26, 30, 26);
  c.nine('countbox', [34, 30, 34, 30], [16, 14, 16, 14], c.W - 130, 10, 120, 40); c.icon('ic_gem', c.W - 114, 30, 24);
}
function nav(c, activeIdx) {
  const navY = c.H - 78; c.band(navY, c.H, 32, 42, 70); c.band(navY, navY + 3, 255, 255, 255, 0.06);
  const tabs = ['ic_calendar', 'ic_shop', 'ic_home', 'ic_mail', 'ic_gear'], tw = c.W / 5;
  tabs.forEach((t, i) => { const cx = (i + 0.5) * tw | 0, cy = navY + 30; if (i === activeIdx) c.rrect(cx - (i === 2 ? 29 : 25), cy - (i === 2 ? 22 : 19), i === 2 ? 58 : 50, i === 2 ? 44 : 38, 12, 255, 150, 40); c.icon(t, cx, cy, i === 2 ? 34 : 28); });
}

// ---------- Shop ----------
{
  const c = mk(420, 940);
  topbar(c);
  const rows = ['ic_reverse', 'ic_plus', 'ic_hold', 'ic_boost'];
  let y = 78;
  for (const ic of rows) {
    c.nine('btn_navy', [40, 40, 40, 40], [22, 22, 22, 22], 16, y, c.W - 32, 74);
    c.icon(ic, 48, y + 37, 46);
    // green coin buy + navy gem buy
    c.nine('btn_green', [64, 0, 64, 0], [0, 20, 0, 20], c.W - 168, y + 16, 70, 44);
    c.nine('btn_navy', [40, 40, 40, 40], [18, 20, 18, 20], c.W - 90, y + 15, 74, 46);
    c.icon('ic_coin', c.W - 156, y + 38, 18); c.icon('ic_gem', c.W - 78, y + 38, 18);
    y += 86;
  }
  nav(c, 1);
  const S = process.argv[2] || '.';
  c.save(`${S}/shop_mockup.png`);
  console.log('wrote shop_mockup.png');
}

// ---------- Daily + Scratch ----------
{
  const c = mk(420, 940);
  topbar(c);
  // daily grid: days 1-6 in 3x2, day 7 wide
  const gx = 16, gw = (c.W - 32 - 24) / 3 | 0, gh = 86;
  let n = 0;
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    const x = gx + col * (gw + 12), y = 74 + row * (gh + 12);
    const claimable = n === 3;
    c.nine(claimable ? 'panel_cyan' : 'panel_blue', [120, 120, 120, 120], [20, 20, 20, 20], x, y, gw, gh);
    c.icon(n % 2 ? 'ic_gem' : 'ic_coin', x + gw / 2, y + gh / 2 + 6, 26);
    if (n < 3) c.icon('ic_check', x + gw - 6, y - 2, 28);
    n++;
  }
  // day 7 wide
  const wy = 74 + 2 * (gh + 12);
  c.nine('panel_blue', [120, 120, 120, 120], [20, 20, 20, 20], gx, wy, c.W - 32, 70);
  c.icon('ic_coin', c.W / 2 - 40, wy + 35, 30); c.icon('ic_gem', c.W / 2 + 20, wy + 35, 28);
  // scratch cards 2x2 (rainbow)
  const sy = wy + 90, sw = 150, sh = 130, sx = (c.W - sw * 2 - 20) / 2 | 0;
  for (let i = 0; i < 4; i++) {
    const x = sx + (i % 2) * (sw + 20), yy = sy + ((i / 2) | 0) * (sh + 18);
    const cols = [[255, 93, 93], [255, 210, 74], [94, 192, 106], [74, 163, 255], [154, 111, 192]];
    for (let j = 0; j < sh; j++) for (let k = 0; k < sw; k++) { const cc = cols[(j + k >> 4) % cols.length]; c.px(x + k, yy + j, cc[0], cc[1], cc[2]); }
    c.rrect(x, yy, sw, 6, 3, 255, 255, 255, 0.6);
  }
  nav(c, 3);
  const S = process.argv[2] || '.';
  c.save(`${S}/daily_mockup.png`);
  console.log('wrote daily_mockup.png');
}
