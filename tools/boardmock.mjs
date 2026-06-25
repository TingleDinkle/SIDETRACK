/**
 * boardmock.mjs — verify the mine floor now tiles across the whole stage (not
 * just the 6x3 board), filling the old cream margins. Uses the real baked floor
 * sprite + mirrors the renderer's layout math.
 */
import fs from 'node:fs';
import { decodePNG, encodePNG } from './sliceatlas.mjs';
const floor = decodePNG(fs.readFileSync('assets/baked/floor.png'));
const W = 520, H = 430, COLS = 6, ROWS = 3;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { out[i * 4] = 0x31; out[i * 4 + 1] = 0x35; out[i * 4 + 2] = 0x3f; out[i * 4 + 3] = 255; } // floorBase
const px = (x, y, r, g, b, a = 1) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const d = (y * W + x) * 4; out[d] = r * a + out[d] * (1 - a) | 0; out[d + 1] = g * a + out[d + 1] * (1 - a) | 0; out[d + 2] = b * a + out[d + 2] * (1 - a) | 0; out[d + 3] = 255; };
const blit = (s, dx, dy, dw, dh) => { for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) { const u = Math.min(s.width - 1, x / dw * s.width | 0), v = Math.min(s.height - 1, y / dh * s.height | 0), p = (v * s.width + u) * 4, a = s.data[p + 3] / 255; if (a > 0) px(dx + x, dy + y, s.data[p], s.data[p + 1], s.data[p + 2], a); } };

const pad = Math.max(8, Math.min(W, H) * 0.03);
const cell = Math.floor(Math.min((W - pad * 2) / COLS, (H - pad * 2) / ROWS));
const ox = Math.floor((W - cell * COLS) / 2), oy = Math.floor((H - cell * ROWS) / 2);
// floor tiled across the whole stage (over-filled), aligned to the board grid
const x0 = Math.floor(-ox / cell) - 2, x1 = Math.ceil((W - ox) / cell) + 2;
const y0 = Math.floor(-oy / cell) - 2, y1 = Math.ceil((H - oy) / cell) + 2;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blit(floor, ox + x * cell, oy + y * cell, cell + 1, cell + 1);
// board grid seams + edge (play area only)
const line = (x0p, y0p, x1p, y1p, r, g, b, a) => { const n = Math.max(Math.abs(x1p - x0p), Math.abs(y1p - y0p)); for (let i = 0; i <= n; i++) px(Math.round(x0p + (x1p - x0p) * i / n), Math.round(y0p + (y1p - y0p) * i / n), r, g, b, a); };
for (let x = 0; x <= COLS; x++) line(ox + x * cell, oy, ox + x * cell, oy + ROWS * cell, 38, 30, 58, 0.16);
for (let y = 0; y <= ROWS; y++) line(ox, oy + y * cell, ox + COLS * cell, oy + y * cell, 38, 30, 58, 0.16);
for (const [a, b, c, d] of [[ox, oy, ox + COLS * cell, oy], [ox, oy + ROWS * cell, ox + COLS * cell, oy + ROWS * cell], [ox, oy, ox, oy + ROWS * cell], [ox + COLS * cell, oy, ox + COLS * cell, oy + ROWS * cell]]) line(a, b, c, d, 80, 60, 30, 0.5);
fs.writeFileSync(`${process.argv[2] || '.'}/board_mockup.png`, encodePNG(W, H, out));
console.log(`wrote board_mockup.png — floor fills ${W}x${H}, board ${COLS}x${ROWS} cell=${cell} centered`);
