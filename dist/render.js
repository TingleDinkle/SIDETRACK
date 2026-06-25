/**
 * Canvas renderer — all original placeholder art, drawn from primitive shapes
 * (rounded rects, arcs, lines). No images, no framework.
 *
 * Rails are *derived* from each cell's edge-mask: for every cell with track we
 * emit a set of "segments" (straight bars / quarter arcs / spokes) and stroke
 * each one as wooden sleepers + two steel rails. Because shape is computed from
 * the mask, curves, junctions and crossings all render with the same code.
 *
 * The renderer owns the screen↔grid mapping (`layout`) so input and rendering
 * always agree on where a cell is.
 */
import { tunnelExitDir } from './grid.js';
import { EdgeBit, edgeList } from './types.js';
import { classify } from './track.js';
import { Shake } from './feel/shake.js';
import { drawHeadlight } from './feel/lighting.js';
import { Effects } from './feel/effects.js';
// Calibration offsets for the baked track/coupler sprites (radians). Tuned so
// the corner piece connects the right edges and couplers lie along the train.
const CURVE_BASE = 0;
const COUPLER_BASE = Math.PI / 2;
/** Named link colours for gates/buttons/switches/junctions. */
const LINK_COLORS = {
    red: '#d2553f',
    blue: '#3f7fd2',
    green: '#4fae5a',
    yellow: '#d9a82e',
    purple: '#9a6fc0',
    orange: '#e0883c',
};
export const linkColor = (name) => (name ? (LINK_COLORS[name] ?? '#8a7a64') : '#8a7a64');
const PAL = {
    bg: '#ead9bb',
    boardLight: '#dcc8a2',
    boardDark: '#d3bd93',
    grid: 'rgba(80,60,30,0.10)',
    boardEdge: 'rgba(80,60,30,0.18)',
    floorSeam: 'rgba(38,30,58,0.16)', // faint cell separators over the baked mine floor
    tie: '#f3a373', // orange-peach sleepers, matching the baked Kenney straight
    tieShadow: 'rgba(60,40,15,0.25)',
    railCore: '#e2e7f8', // light periwinkle rails
    railEdge: '#b7c0e6',
    rock: '#736c62',
    rockHi: '#8a8278',
    rockShadow: 'rgba(40,32,22,0.30)',
    start: '#2c313d', // dark recessed entry pad, sits into the mine floor
    startRim: '#525c70', // soft bevel highlight around the pad
    startMark: '#6f9d86', // muted teal "enter here" accent
    exitA: '#c95f52',
    exitB: '#f1e3cf',
    loco: '#3f6fa3',
    locoCab: '#2d5680',
    coupledWagon: '#5f82c8', // recolour a coupled wagon to the loco's blue
    wagon: '#cf8740',
    wagonDark: '#a96a2c',
    ink: '#fbf6ec',
    inkDark: '#3a2f22',
    mover: '#8a6bb0',
    ghost: 'rgba(70,120,90,0.30)',
};
export class Renderer {
    constructor(canvas) {
        this.layout = { ox: 0, oy: 0, cell: 1, cols: 1, rows: 1, cssW: 1, cssH: 1 };
        this.dpr = 1;
        this.particles = [];
        this.lastDrawMs = 0;
        this.shakeFx = new Shake();
        this.fx = new Effects();
        this.assets = null;
        this.theme = 1; // world number, selects ground_w{theme}
        this.hoverCell = null; // editor targeting reticle
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('2D canvas context unavailable');
        this.ctx = ctx;
    }
    /** Optional sprite layer; when set, the renderer prefers sprites over shapes. */
    setAssets(assets) {
        this.assets = assets;
    }
    /** Selects per-world ground/theming. */
    setTheme(world) {
        this.theme = world || 1;
    }
    /** Draw a tinted UI/booster icon (a mono symbol recoloured to `color`),
     *  centred at (cx,cy) in CSS pixels. No-op if the icon isn't loaded. */
    icon(name, cx, cy, size, color = '#ffffff') {
        return this.assets?.drawIcon(this.ctx, name, cx, cy, size, size, color) ?? false;
    }
    groundSprite() {
        if (!this.assets)
            return null;
        const w = `ground_w${this.theme}`;
        if (this.assets.has(w))
            return w;
        return this.assets.has('ground') ? 'ground' : null;
    }
    /** Recompute backing-store size and the centred board layout. */
    resize(cols, rows) {
        this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        const cssW = this.canvas.clientWidth || 320;
        const cssH = this.canvas.clientHeight || 240;
        this.canvas.width = Math.round(cssW * this.dpr);
        this.canvas.height = Math.round(cssH * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const pad = Math.max(8, Math.min(cssW, cssH) * 0.03);
        const cell = Math.floor(Math.min((cssW - pad * 2) / cols, (cssH - pad * 2) / rows));
        const boardW = cell * cols;
        const boardH = cell * rows;
        this.layout = {
            cell,
            cols,
            rows,
            ox: Math.floor((cssW - boardW) / 2),
            oy: Math.floor((cssH - boardH) / 2),
            cssW,
            cssH,
        };
    }
    /** Map client (page) coordinates to a grid cell, or null if outside. */
    cellAt(clientX, clientY) {
        const r = this.canvas.getBoundingClientRect();
        const px = clientX - r.left;
        const py = clientY - r.top;
        const { ox, oy, cell, cols, rows } = this.layout;
        const x = Math.floor((px - ox) / cell);
        const y = Math.floor((py - oy) / cell);
        if (x < 0 || y < 0 || x >= cols || y >= rows)
            return null;
        return { x, y };
    }
    cellRect(x, y) {
        const { ox, oy, cell } = this.layout;
        return { left: ox + x * cell, top: oy + y * cell, size: cell };
    }
    /** A stable pseudo-random 0..1 from a cell's coords (normalised cellHash) —
     *  for cosmetic variety (rock shape/rotation) that must NOT flicker. */
    cellRand(x, y) {
        return this.cellHash(x, y) / 4294967296;
    }
    /* ----------------------------- frame ----------------------------- */
    /** Add a screen-shake impulse (~0.3 gentle, ~0.9 crash). */
    kick(intensity) {
        this.shakeFx.kick(intensity);
    }
    /** World-reaction effects — fired from sim events (gate clunk, button link, …). */
    fxRing(cellX, cellY, color, tMs) {
        this.fx.ring(cellX, cellY, color, tMs);
    }
    fxLink(ax, ay, bx, by, color, tMs) {
        this.fx.pulse(ax, ay, bx, by, color, tMs);
    }
    fxWhoosh(cellX, cellY, color, tMs) {
        this.fx.whoosh(cellX, cellY, color, tMs);
    }
    /** Set (or clear) the editor hover reticle — the cell a tap would target. */
    setHover(cell) {
        this.hoverCell = cell;
    }
    draw(grid, entities, dyn = null, tMs = 0, preview) {
        const ctx = this.ctx;
        const { cssW, cssH } = this.layout;
        ctx.clearRect(0, 0, cssW, cssH);
        // Backdrop — stays put so the shaking board reads against a steady frame.
        ctx.fillStyle = PAL.bg;
        ctx.fillRect(0, 0, cssW, cssH);
        const sh = this.shakeFx.offset(tMs, this.layout.cell);
        ctx.save();
        ctx.translate(sh.x, sh.y);
        this.drawBoard(grid);
        // Cosmetic scenery behind the gameplay.
        for (const e of entities)
            if (e.kind === 'decor')
                this.drawEntity(e);
        // Flat floor markings (start/exit/button/switch) go UNDER the rails.
        for (const c of grid.cells)
            this.drawTileMarker(c, grid, dyn, 'ground');
        // Track (any cell with a mask: player track, fixed track, start/exit stubs)
        for (const c of grid.cells)
            if (c.mask !== 0)
                this.drawTrack(c, grid, dyn);
        // 3-D objects (rock/tunnel/gate/signal) go OVER the rails.
        for (const c of grid.cells)
            this.drawTileMarker(c, grid, dyn, 'object');
        // Editing-only (preview is supplied only while editing): a soft reticle on
        // the cell under the cursor, then the planned-route telegraph.
        if (preview)
            this.drawHover(grid, tMs);
        if (preview && preview.cells.length > 1)
            this.drawPreview(preview, tMs);
        // Warm headlight pool under the loco for the dark-mine mood.
        const loco = entities.find((e) => e.kind === 'loco');
        if (loco) {
            const { ox, oy, cell } = this.layout;
            drawHeadlight(ctx, ox + (loco.x + 0.5) * cell, oy + (loco.y + 0.5) * cell, cell, loco.heading);
        }
        // Entities — drawn back-to-front so the loco sits on top of its wagons.
        for (const e of entities)
            if (e.kind === 'coupler')
                this.drawEntity(e);
        for (const e of entities)
            if (e.kind === 'wagon' || e.kind === 'mover')
                this.drawEntity(e);
        for (const e of entities)
            if (e.kind === 'loco')
                this.drawEntity(e);
        // World-reaction flashes (gate clunk, button→gate link, teleport) over the board.
        this.fx.draw(ctx, this.layout.ox, this.layout.oy, this.layout.cell, tMs);
        this.drawParticles(tMs);
        ctx.restore();
        this.drawVignette();
    }
    /** Dashed, marching route telegraph: green to the goal, red (with an ✕) if it
     *  would derail, plus amber rings where it would grab wagons. */
    drawPreview(route, tMs) {
        const { cells, outcome, pickups } = route;
        const { ox, oy, cell } = this.layout;
        const ctx = this.ctx;
        const px = (c) => [ox + (c.x + 0.5) * cell, oy + (c.y + 0.5) * cell];
        const ok = outcome === 'exit';
        const line = ok ? 'rgba(126,208,154,0.55)' : 'rgba(214,108,84,0.6)';
        const mark = ok ? 'rgba(126,208,154,0.75)' : 'rgba(214,108,84,0.85)';
        ctx.save();
        ctx.strokeStyle = line;
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([cell * 0.06, cell * 0.2]);
        ctx.lineDashOffset = -((tMs * 0.03) % 100000); // marching ants in the travel direction
        ctx.beginPath();
        cells.forEach((c, i) => {
            const [x, y] = px(c);
            if (i)
                ctx.lineTo(x, y);
            else
                ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        // Pickup markers — rings where the route grabs a wagon.
        ctx.strokeStyle = 'rgba(245,210,140,0.9)';
        ctx.lineWidth = Math.max(1.5, cell * 0.04);
        for (const p of pickups) {
            const [x, y] = px(p);
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.22, 0, Math.PI * 2);
            ctx.stroke();
        }
        // End marker: a filled dot at the goal, or an ✕ where it derails.
        const [ex, ey] = px(cells[cells.length - 1]);
        if (ok) {
            // Inviting pulse on the goal — a soft ring that breathes outward, plus a dot.
            const pulse = ((tMs * 0.0016) % 1 + 1) % 1; // 0..1, march-safe
            ctx.globalAlpha = (1 - pulse) * 0.55;
            ctx.strokeStyle = mark;
            ctx.lineWidth = Math.max(1.5, cell * 0.05);
            ctx.beginPath();
            ctx.arc(ex, ey, cell * (0.14 + pulse * 0.32), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = mark;
            ctx.beginPath();
            ctx.arc(ex, ey, cell * 0.1, 0, Math.PI * 2);
            ctx.fill();
        }
        else {
            ctx.strokeStyle = mark;
            ctx.lineWidth = Math.max(2, cell * 0.06);
            const r = cell * 0.12;
            ctx.beginPath();
            ctx.moveTo(ex - r, ey - r);
            ctx.lineTo(ex + r, ey + r);
            ctx.moveTo(ex + r, ey - r);
            ctx.lineTo(ex - r, ey + r);
            ctx.stroke();
        }
        ctx.restore();
    }
    /** A gentle reticle on the hovered cell so the player sees what a tap targets.
     *  Skipped for rocks / off-board (nothing to lay or erase there). */
    drawHover(grid, tMs) {
        const h = this.hoverCell;
        if (!h)
            return;
        const c = grid.get(h.x, h.y);
        if (!c || c.type === 'rock')
            return;
        const { left, top, size } = this.cellRect(h.x, h.y);
        const ctx = this.ctx;
        const breath = 0.5 + 0.5 * Math.sin(tMs * 0.005);
        ctx.save();
        ctx.fillStyle = `rgba(255,248,228,${0.07 + 0.05 * breath})`;
        this.roundRect(left + size * 0.08, top + size * 0.08, size * 0.84, size * 0.84, size * 0.16);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,240,200,${0.4 + 0.2 * breath})`;
        ctx.lineWidth = Math.max(1, size * 0.025);
        this.roundRect(left + size * 0.08, top + size * 0.08, size * 0.84, size * 0.84, size * 0.16);
        ctx.stroke();
        ctx.restore();
    }
    /** Soft darkening toward the edges for depth (works with or without art). */
    drawVignette() {
        const ctx = this.ctx;
        const { cssW, cssH } = this.layout;
        const r = Math.hypot(cssW, cssH) / 2;
        const g = ctx.createRadialGradient(cssW / 2, cssH / 2, r * 0.62, cssW / 2, cssH / 2, r);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(40,28,12,0.18)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, cssW, cssH);
    }
    /** Hold targeting: blue-dim the board and ring the choosable objects. */
    drawHoldOverlay(cells) {
        const ctx = this.ctx;
        const { cssW, cssH, ox, oy, cell } = this.layout;
        ctx.save();
        ctx.fillStyle = 'rgba(28,48,86,0.5)';
        ctx.fillRect(0, 0, cssW, cssH);
        for (const c of cells) {
            const cx = ox + (c.x + 0.5) * cell;
            const cy = oy + (c.y + 0.5) * cell;
            ctx.beginPath();
            ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.fill();
            ctx.lineWidth = cell * 0.06;
            ctx.strokeStyle = '#ffe27a';
            ctx.stroke();
        }
        ctx.restore();
    }
    /** A frozen (held) marker on each given cell. */
    markFrozen(cells) {
        const ctx = this.ctx;
        const { ox, oy, cell } = this.layout;
        ctx.save();
        for (const c of cells) {
            const cx = ox + (c.x + 0.5) * cell;
            const cy = oy + (c.y + 0.5) * cell;
            ctx.beginPath();
            ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(120,190,255,0.22)';
            ctx.fill();
            ctx.lineWidth = cell * 0.05;
            ctx.strokeStyle = '#bfe4ff';
            ctx.stroke();
            ctx.fillStyle = '#eaf6ff';
            ctx.font = `${Math.round(cell * 0.3)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❄', cx, cy - cell * 0.3);
        }
        ctx.restore();
    }
    /* ----------------------------- particles ----------------------------- */
    /** Spawn a burst of sparks at a cell (e.g. on coupling / win). */
    spawnBurst(cellX, cellY, color, count, tMs) {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 0.6 + Math.random() * 1.4;
            this.particles.push({
                cx: cellX + 0.5,
                cy: cellY + 0.5,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                born: tMs,
                life: 380 + Math.random() * 260,
                color,
                r0: 0.06 + Math.random() * 0.05,
            });
        }
    }
    /** Spawn a rising smoke puff from a loco's chimney, drifting behind its travel. */
    spawnSmoke(cellX, cellY, tMs, heading) {
        const back = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] };
        const [bx, by] = heading ? back[heading] : [0, 0];
        this.particles.push({
            cx: cellX + 0.5 + bx * 0.22 + (Math.random() - 0.5) * 0.1,
            cy: cellY + 0.42 + by * 0.18,
            vx: (Math.random() - 0.5) * 0.15 + bx * 0.06,
            vy: -0.35 - Math.random() * 0.2,
            born: tMs,
            life: 650 + Math.random() * 350,
            color: 'rgba(170,160,150,0.5)',
            r0: 0.1 + Math.random() * 0.06,
            grav: 0.0005, // smoke barely falls; it keeps rising
        });
    }
    /** Spawn a crash: sparks/debris flung out plus a grey poof. */
    spawnDebris(cellX, cellY, tMs) {
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 1.0 + Math.random() * 2.2;
            this.particles.push({
                cx: cellX + 0.5,
                cy: cellY + 0.5,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp - 0.6, // bias upward, then gravity pulls debris down
                born: tMs,
                life: 420 + Math.random() * 320,
                color: Math.random() < 0.5 ? '#caa45f' : 'rgba(120,110,100,0.85)',
                r0: 0.05 + Math.random() * 0.06,
                grav: 0.004,
            });
        }
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            this.particles.push({
                cx: cellX + 0.5,
                cy: cellY + 0.5,
                vx: Math.cos(a) * 0.4,
                vy: -0.3 - Math.random() * 0.3,
                born: tMs,
                life: 600 + Math.random() * 300,
                color: 'rgba(90,80,75,0.55)',
                r0: 0.12 + Math.random() * 0.08,
                grav: 0.0006,
            });
        }
    }
    /** A small soft dust poof — the "pop" when a track piece is erased. */
    spawnPoof(cellX, cellY, tMs) {
        for (let i = 0; i < 7; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 0.3 + Math.random() * 0.7;
            this.particles.push({
                cx: cellX + 0.5,
                cy: cellY + 0.5,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp * 0.6 - 0.2,
                born: tMs,
                life: 260 + Math.random() * 180,
                color: 'rgba(150,135,110,0.5)',
                r0: 0.08 + Math.random() * 0.06,
                grav: 0.0008,
            });
        }
    }
    /** Victory confetti: bright fluttering flakes that arc up and rain down. */
    spawnConfetti(cellX, cellY, tMs, count = 34) {
        const cols = ['#7ed09a', '#f3d35a', '#e0883c', '#5f82c8', '#d2553f', '#9a6fc0'];
        for (let i = 0; i < count; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1; // mostly upward fan
            const sp = 1.4 + Math.random() * 2.6;
            this.particles.push({
                cx: cellX + 0.5,
                cy: cellY + 0.5,
                vx: Math.cos(a) * sp,
                vy: Math.sin(a) * sp,
                born: tMs,
                life: 900 + Math.random() * 700,
                color: cols[i % cols.length],
                r0: 0.05 + Math.random() * 0.05,
                grav: 0.0042,
            });
        }
    }
    /** Full victory flourish at the goal: expanding rings + a confetti shower. */
    celebrate(cellX, cellY, tMs) {
        this.fx.ring(cellX, cellY, '#7ed09a', tMs, 520, 1.4);
        this.fx.ring(cellX, cellY, '#f3d35a', tMs + 90, 560, 1.9);
        this.fx.ring(cellX, cellY, '#ffffff', tMs + 180, 460, 1.2);
        this.spawnConfetti(cellX, cellY, tMs);
    }
    drawParticles(tMs) {
        if (!this.particles.length) {
            this.lastDrawMs = tMs;
            return;
        }
        const dt = this.lastDrawMs ? Math.min(64, tMs - this.lastDrawMs) : 16;
        this.lastDrawMs = tMs;
        const { ox, oy, cell } = this.layout;
        const ctx = this.ctx;
        ctx.save();
        const next = [];
        for (const p of this.particles) {
            const age = tMs - p.born;
            if (age >= p.life)
                continue;
            p.cx += (p.vx * dt) / 1000;
            p.cy += (p.vy * dt) / 1000;
            p.vy += (p.grav ?? 0.0012) * dt; // per-particle gravity (debris falls hard, smoke barely)
            const k = 1 - age / p.life;
            ctx.globalAlpha = Math.max(0, k);
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(ox + p.cx * cell, oy + p.cy * cell, p.r0 * cell * (0.6 + 0.4 * k), 0, Math.PI * 2);
            ctx.fill();
            next.push(p);
        }
        ctx.restore();
        this.particles = next;
    }
    drawEntity(e) {
        switch (e.kind) {
            case 'loco':
                this.drawLocomotive(e.x, e.y, e.heading, e.roll ?? 0);
                break;
            case 'wagon':
                this.drawWagon(e.x, e.y, e.number ?? 0, e.heading, e.coupled ?? false);
                break;
            case 'mover':
                this.drawMover(e.x, e.y, e.heading);
                break;
            case 'decor':
                this.drawDecor(e);
                break;
            case 'coupler':
                this.drawCoupler(e);
                break;
        }
    }
    /** Map a curve cell's two edges to a rotation for the baked corner sprite. */
    curveRot(mask) {
        if (mask & EdgeBit.E && mask & EdgeBit.S)
            return CURVE_BASE; // base orientation
        if (mask & EdgeBit.S && mask & EdgeBit.W)
            return CURVE_BASE + Math.PI / 2;
        if (mask & EdgeBit.W && mask & EdgeBit.N)
            return CURVE_BASE + Math.PI;
        return CURVE_BASE - Math.PI / 2; // N + E
    }
    /** The coupler bar between two adjacent cars. */
    drawCoupler(e) {
        if (!this.assets || !this.assets.has('coupler'))
            return;
        const { ox, oy, cell } = this.layout;
        const cx = ox + (e.x + 0.5) * cell;
        const cy = oy + (e.y + 0.5) * cell;
        this.assets.draw(this.ctx, 'coupler', cx, cy, cell * 0.5, cell * 0.5, this.headingAngle(e.heading) + COUPLER_BASE);
    }
    /** Cosmetic scenery sprite, anchored near its base on the ground. */
    drawDecor(e) {
        if (!this.assets || !e.sprite || !this.assets.has(e.sprite))
            return;
        const { ox, oy, cell } = this.layout;
        const s = cell * (e.scale ?? 1);
        this.assets.draw(this.ctx, e.sprite, ox + (e.x + 0.5) * cell, oy + (e.y + 0.92) * cell, s, s);
    }
    /** Whisper-faint contact shadow — cool-toned and low opacity so it sinks into
     *  the dark mine floor instead of reading as a black blob under the train. */
    contactShadow(cx, cy, w) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(12,14,22,0.10)';
        ctx.beginPath();
        ctx.ellipse(cx, cy + w * 0.32, w * 0.38, w * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    /** Stable per-cell hash (deterministic, no Math.random) used to scatter the
     *  occasional floor-detail tile and vary its rotation. */
    cellHash(x, y) {
        let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
    }
    /** Baked floor: lay the plain `floor` tile everywhere, then sprinkle the
     *  `floor_detail` variant on ~1-in-8 cells (rotated for variety) so the board
     *  reads like a worn mine floor rather than a flat fill. */
    drawFloor(grid) {
        const ctx = this.ctx;
        const a = this.assets;
        const { ox, oy, cell, cols, rows } = this.layout;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const cx = ox + (x + 0.5) * cell;
                const cy = oy + (y + 0.5) * cell;
                a.draw(ctx, 'floor', cx, cy, cell + 1, cell + 1); // +1 kills hairline seams
            }
        }
        if (a.has('floor_detail')) {
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const hsh = this.cellHash(x, y);
                    if (hsh % 100 >= 12)
                        continue; // ~12% of cells, "less frequently"
                    const cx = ox + (x + 0.5) * cell;
                    const cy = oy + (y + 0.5) * cell;
                    a.draw(ctx, 'floor_detail', cx, cy, cell + 1, cell + 1, (hsh % 4) * (Math.PI / 2));
                }
            }
        }
        // Faint cell separators (legibility for track placement) + outer edge.
        ctx.strokeStyle = PAL.floorSeam;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= cols; x++) {
            ctx.moveTo(ox + x * cell + 0.5, oy);
            ctx.lineTo(ox + x * cell + 0.5, oy + rows * cell);
        }
        for (let y = 0; y <= rows; y++) {
            ctx.moveTo(ox, oy + y * cell + 0.5);
            ctx.lineTo(ox + cols * cell, oy + y * cell + 0.5);
        }
        ctx.stroke();
        ctx.strokeStyle = PAL.boardEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(ox, oy, cols * cell, rows * cell);
    }
    drawBoard(grid) {
        const ctx = this.ctx;
        const { ox, oy, cell, cols, rows } = this.layout;
        const boardW = cols * cell;
        const boardH = rows * cell;
        // Baked mine floor takes precedence when its sprite is present.
        if (this.assets && this.assets.has('floor')) {
            this.drawFloor(grid);
            return;
        }
        const ground = this.groundSprite();
        const pat = ground && this.assets ? this.assets.pattern(ctx, ground) : null;
        if (pat) {
            ctx.save();
            ctx.fillStyle = pat;
            ctx.translate(ox, oy);
            ctx.fillRect(0, 0, boardW, boardH);
            ctx.restore();
        }
        else {
            for (let y = 0; y < grid.rows; y++) {
                for (let x = 0; x < grid.cols; x++) {
                    const { left, top, size } = this.cellRect(x, y);
                    ctx.fillStyle = (x + y) % 2 === 0 ? PAL.boardLight : PAL.boardDark;
                    ctx.fillRect(left, top, size, size);
                }
            }
        }
        // Grid lines (skipped when a ground texture is supplied) + outer edge.
        if (!pat) {
            ctx.strokeStyle = PAL.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= cols; x++) {
                ctx.moveTo(ox + x * cell + 0.5, oy);
                ctx.lineTo(ox + x * cell + 0.5, oy + rows * cell);
            }
            for (let y = 0; y <= rows; y++) {
                ctx.moveTo(ox, oy + y * cell + 0.5);
                ctx.lineTo(ox + cols * cell, oy + y * cell + 0.5);
            }
            ctx.stroke();
        }
        ctx.strokeStyle = PAL.boardEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(ox, oy, cols * cell, rows * cell);
    }
    /* ----------------------------- track ----------------------------- */
    edgeMid(left, top, size, h) {
        const cx = left + size / 2;
        const cy = top + size / 2;
        switch (h) {
            case 'N': return { x: cx, y: top };
            case 'S': return { x: cx, y: top + size };
            case 'E': return { x: left + size, y: cy };
            case 'W': return { x: left, y: cy };
        }
    }
    cornerOf(left, top, size, a, b) {
        const set = new Set([a, b]);
        const right = set.has('E');
        const bottom = set.has('S');
        return { x: right ? left + size : left, y: bottom ? top + size : top };
    }
    drawTrack(c, grid, dyn) {
        // The start, exit, and tunnel show no separate periwinkle rail: the start/exit
        // pads let the player's track reach their edge, and the tunnel's own machine
        // sprite is its rail. A stub here would just cross over / disagree with the
        // sprite. Let those tiles render without an interior stub.
        if (c.type === 'start' || c.type === 'exit' || c.type === 'tunnel')
            return;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        const mask = c.mask;
        if (mask === 0)
            return;
        const edges = edgeList(mask);
        const shape = classify(mask);
        // Optional baked track sprites for the common shapes (off by default).
        if (this.assets) {
            if (shape === 'straight' && this.assets.has('track_straight')) {
                const vertical = (mask & EdgeBit.N) !== 0; // N|S
                this.assets.draw(this.ctx, 'track_straight', cx, cy, size, size, vertical ? Math.PI / 2 : 0);
                return;
            }
            if (shape === 'curve' && this.assets.has('track_curve')) {
                this.assets.draw(this.ctx, 'track_curve', cx, cy, size, size, this.curveRot(mask));
                return;
            }
        }
        switch (shape) {
            case 'stub': {
                const m = this.edgeMid(left, top, size, edges[0]);
                this.railLine(cx, cy, m.x, m.y, size);
                break;
            }
            case 'straight': {
                const a = this.edgeMid(left, top, size, edges[0]);
                const b = this.edgeMid(left, top, size, edges[1]);
                this.railLine(a.x, a.y, b.x, b.y, size);
                break;
            }
            case 'curve': {
                this.railCurve(left, top, size, edges[0], edges[1]);
                break;
            }
            case 'junction': {
                // Straight bar across the opposite pair + a spoke to the branch.
                const hasNS = mask & 1 && mask & 4;
                const barA = hasNS ? 'N' : 'E';
                const barB = hasNS ? 'S' : 'W';
                const branch = edges.find((e) => e !== barA && e !== barB);
                const a = this.edgeMid(left, top, size, barA);
                const b = this.edgeMid(left, top, size, barB);
                const br = this.edgeMid(left, top, size, branch);
                this.railLine(a.x, a.y, b.x, b.y, size);
                this.railLine(cx, cy, br.x, br.y, size);
                // Active-branch indicator: a chevron toward the currently live exit.
                const idx = grid.idx(c.x, c.y);
                const branchIdx = dyn ? dyn.junctionBranch(idx) : 0;
                const exits = edges.filter((e) => e !== branch); // the alternating pair (bar ends)
                const live = exits[branchIdx % exits.length];
                if (live) {
                    // A filled arrowhead pointing down the currently live exit — reads at a
                    // glance which way a train will be sent (vs. the old ambiguous dot).
                    const ctx = this.ctx;
                    const col = c.color ? linkColor(c.color) : PAL.startMark;
                    const a = size * 0.15;
                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate(this.headingAngle(live));
                    ctx.translate(a * 0.55, 0); // nudge toward the live edge
                    ctx.fillStyle = col;
                    ctx.beginPath();
                    ctx.moveTo(a, 0);
                    ctx.lineTo(-a * 0.55, a * 0.72);
                    ctx.lineTo(-a * 0.55, -a * 0.72);
                    ctx.closePath();
                    ctx.fill();
                    ctx.lineWidth = Math.max(1, size * 0.02);
                    ctx.strokeStyle = 'rgba(20,18,28,0.4)';
                    ctx.stroke();
                    ctx.restore();
                }
                break;
            }
            case 'crossing': {
                const n = this.edgeMid(left, top, size, 'N');
                const s = this.edgeMid(left, top, size, 'S');
                const e = this.edgeMid(left, top, size, 'E');
                const w = this.edgeMid(left, top, size, 'W');
                this.railLine(n.x, n.y, s.x, s.y, size);
                this.railLine(e.x, e.y, w.x, w.y, size);
                break;
            }
            default:
                break;
        }
    }
    railCurve(left, top, size, a, b) {
        const corner = this.cornerOf(left, top, size, a, b);
        const r = size / 2;
        const ma = this.edgeMid(left, top, size, a);
        const mb = this.edgeMid(left, top, size, b);
        const a0 = Math.atan2(ma.y - corner.y, ma.x - corner.x);
        let a1 = Math.atan2(mb.y - corner.y, mb.x - corner.x);
        // Choose the 90° (minor) sweep.
        let delta = a1 - a0;
        while (delta <= -Math.PI)
            delta += Math.PI * 2;
        while (delta > Math.PI)
            delta -= Math.PI * 2;
        const anticlockwise = delta < 0;
        this.railArc(corner.x, corner.y, r, a0, a0 + (anticlockwise ? -Math.PI / 2 : Math.PI / 2), anticlockwise, size);
    }
    /** Stroke a straight rail segment as sleepers + two steel rails. */
    railLine(x0, y0, x1, y1, size) {
        const ctx = this.ctx;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const g = size * 0.12;
        this.sleepersLine(x0, y0, x1, y1, size);
        // rail outline then core, both offset to either side
        for (const pass of [
            { col: PAL.railEdge, w: size * 0.085 },
            { col: PAL.railCore, w: size * 0.05 },
        ]) {
            ctx.strokeStyle = pass.col;
            ctx.lineWidth = pass.w;
            ctx.lineCap = 'round';
            for (const k of [-g, g]) {
                ctx.beginPath();
                ctx.moveTo(x0 + px * k, y0 + py * k);
                ctx.lineTo(x1 + px * k, y1 + py * k);
                ctx.stroke();
            }
        }
    }
    railArc(cx, cy, r, a0, a1, acw, size) {
        const ctx = this.ctx;
        const g = size * 0.12;
        this.sleepersArc(cx, cy, r, a0, a1, acw, size);
        for (const pass of [
            { col: PAL.railEdge, w: size * 0.085 },
            { col: PAL.railCore, w: size * 0.05 },
        ]) {
            ctx.strokeStyle = pass.col;
            ctx.lineWidth = pass.w;
            ctx.lineCap = 'round';
            for (const k of [-g, g]) {
                ctx.beginPath();
                ctx.arc(cx, cy, r + k, a0, a1, acw);
                ctx.stroke();
            }
        }
    }
    sleepersLine(x0, y0, x1, y1, size) {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.setLineDash([size * 0.11, size * 0.11]);
        ctx.strokeStyle = PAL.tie;
        ctx.lineWidth = size * 0.34;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }
    sleepersArc(cx, cy, r, a0, a1, acw, size) {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.setLineDash([size * 0.11, size * 0.11]);
        ctx.strokeStyle = PAL.tie;
        ctx.lineWidth = size * 0.34;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1, acw);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }
    /* ----------------------------- tiles ----------------------------- */
    /** Only the start zone and exit target are floor markings the rails run OVER.
     *  Everything else (rock, tunnel, gate, signal, button, switch) is an obstacle
     *  that sits OVER the rails. The two layers draw in separate passes around
     *  drawTrack. */
    isGroundMarker(c) {
        return c.type === 'start' || c.type === 'exit';
    }
    drawTileMarker(c, grid, dyn, layer) {
        if (this.isGroundMarker(c) !== (layer === 'ground'))
            return;
        // Prefer a sprite when one is loaded; otherwise fall through to shapes.
        if (this.assets) {
            const sp = this.tileSpriteFor(c, grid, dyn);
            if (sp && this.assets.has(sp.name)) {
                const { left, top, size } = this.cellRect(c.x, c.y);
                const cx = left + size / 2;
                const cy = top + size / 2;
                if (sp.shadow)
                    this.contactShadow(cx, cy, size);
                this.assets.draw(this.ctx, sp.name, cx, cy, size * 0.94, size * 0.94, sp.rot);
                return;
            }
        }
        switch (c.type) {
            case 'rock':
                this.drawRock(c.x, c.y);
                break;
            case 'exit':
                this.drawExit(c.x, c.y);
                break;
            case 'start':
                this.drawStartPad(c.x, c.y);
                break;
            case 'tunnel':
                this.drawTunnel(c, grid);
                break;
            case 'button':
                this.drawButton(c);
                break;
            case 'switch':
                this.drawSwitch(c);
                break;
            case 'gate': {
                const open = dyn ? dyn.gateOpen(c.color ?? '') : c.open ?? false;
                this.drawGate(c, open);
                break;
            }
            case 'signal': {
                const open = dyn ? dyn.signalOpen(grid.idx(c.x, c.y)) : c.open ?? true;
                this.drawSignal(c, open);
                break;
            }
            default: break;
        }
    }
    /** Sprite name + rotation + shadow flag for a fixed tile (null if none). */
    tileSpriteFor(c, grid, dyn) {
        switch (c.type) {
            case 'rock':
                // Quarter-turn the rock per cell so a field of them doesn't read as a
                // repeated stamp. Deterministic, so it never flickers.
                return { name: 'tile_rock', rot: Math.floor(this.cellRand(c.x, c.y) * 4) * (Math.PI / 2), shadow: true };
            case 'exit': return { name: 'tile_exit', rot: 0, shadow: false };
            case 'start': return { name: 'tile_start', rot: 0, shadow: false };
            // buttons are drawn by drawButton (colour-tinted small vs neutral master)
            case 'switch': return { name: 'tile_switch', rot: 0, shadow: false };
            case 'tunnel':
                return null; // drawTunnel mirrors/rotates the machine so its mouth faces the track
            case 'gate':
                return null; // drawGate renders the link-colour-recoloured barrier sprite
            case 'signal': {
                const open = dyn ? dyn.signalOpen(grid.idx(c.x, c.y)) : c.open ?? true;
                return { name: open ? 'tile_signal_green' : 'tile_signal_red', rot: 0, shadow: false };
            }
            default:
                return null;
        }
    }
    /**
     * A drive-over button. The baked plate (`tile_button` small / `tile_button_master`
     * large) keeps its model look; a centred pip shows the link: a coloured pip for a
     * small button (matching its one gate's colour) or a white "all" pip for a
     * colourless master button (which opens every gate).
     */
    drawButton(c) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        const master = !c.color;
        const sprite = master ? 'tile_button_master' : 'tile_button';
        if (this.assets && this.assets.has(sprite)) {
            this.assets.draw(ctx, sprite, cx, cy, size * 0.94, size * 0.94);
            ctx.save();
            const pr = master ? size * 0.085 : size * 0.135;
            // pip body
            ctx.fillStyle = master ? 'rgba(244,247,252,0.95)' : linkColor(c.color);
            ctx.beginPath();
            ctx.arc(cx, cy, pr, 0, Math.PI * 2);
            ctx.fill();
            // thin dark rim + soft highlight so the pip reads as a lamp
            ctx.lineWidth = Math.max(1, size * 0.02);
            ctx.strokeStyle = 'rgba(20,18,28,0.4)';
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.beginPath();
            ctx.arc(cx - pr * 0.3, cy - pr * 0.3, pr * 0.4, 0, Math.PI * 2);
            ctx.fill();
            if (master) {
                // ring around the pip to read as "opens everything"
                ctx.strokeStyle = 'rgba(244,247,252,0.8)';
                ctx.lineWidth = Math.max(1, size * 0.022);
                ctx.beginPath();
                ctx.arc(cx, cy, size * 0.17, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
            return;
        }
        // Procedural fallback: a round pad (link colour, or grey for master).
        const col = master ? '#8f99a8' : linkColor(c.color);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.arc(cx, cy + size * 0.03, size * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    /** A drive-over switch: a diamond with a small lever. */
    drawSwitch(c) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        const col = linkColor(c.color);
        const r = size * 0.22;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = size * 0.05;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, r * 0.4);
        ctx.lineTo(r * 0.4, -r * 0.4);
        ctx.stroke();
        ctx.restore();
    }
    /**
     * A gate across the track: the structure-barrier sprite recoloured from its
     * model yellow to the gate's link colour (so it matches its button). Solid when
     * closed; ghosted (raised) when open. Falls back to a drawn bar without art.
     */
    drawGate(c, open) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        const col = linkColor(c.color);
        const horizontal = (c.mask & 2 || c.mask & 8) !== 0; // track runs E/W -> bar is vertical
        // Open → lay a soft green "clear lane" glow down the travel axis so an open
        // gate reads as unmistakably passable (more than just a ghosted barrier).
        if (open)
            this.gateClearGlow(cx, cy, size, horizontal);
        if (this.assets && this.assets.has('tile_gate')) {
            // Barrier is baked vertical (blocks E/W); turn it a quarter for N/S track.
            const rot = horizontal ? 0 : Math.PI / 2;
            ctx.save();
            ctx.globalAlpha = open ? 0.3 : 1; // open = barrier lifted away
            this.assets.drawRecolored(ctx, 'tile_gate', cx, cy, size * 0.96, size * 0.96, col, rot);
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.translate(cx, cy);
        if (horizontal)
            ctx.rotate(Math.PI / 2); // make the bar cross the track
        const halfLen = size * 0.34;
        const barW = size * 0.16;
        // posts
        ctx.fillStyle = col;
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(s * halfLen, 0, size * 0.06, 0, Math.PI * 2);
            ctx.fill();
        }
        if (open) {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = col;
            this.roundRect(-halfLen, -size * 0.4, barW, size * 0.34, size * 0.04); // lifted bar
            ctx.fill();
        }
        else {
            ctx.fillStyle = col;
            this.roundRect(-halfLen, -barW / 2, halfLen * 2, barW, size * 0.05);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            this.roundRect(-halfLen, -barW / 2, halfLen * 2, barW * 0.35, size * 0.05);
            ctx.fill();
        }
        ctx.restore();
    }
    /** A soft green lane down the travel axis — the "this gate is open, roll through"
     *  cue. `horizontal` means the track runs E/W, so the lane runs left↔right. */
    gateClearGlow(cx, cy, size, horizontal) {
        const ctx = this.ctx;
        ctx.save();
        const g = horizontal
            ? ctx.createLinearGradient(cx - size * 0.5, cy, cx + size * 0.5, cy)
            : ctx.createLinearGradient(cx, cy - size * 0.5, cx, cy + size * 0.5);
        g.addColorStop(0, 'rgba(120,210,150,0)');
        g.addColorStop(0.5, 'rgba(120,210,150,0.42)');
        g.addColorStop(1, 'rgba(120,210,150,0)');
        ctx.fillStyle = g;
        const t = size * 0.32; // lane thickness
        if (horizontal)
            ctx.fillRect(cx - size * 0.5, cy - t / 2, size, t);
        else
            ctx.fillRect(cx - t / 2, cy - size * 0.5, t, size);
        ctx.restore();
    }
    /** A signal post with a green (open) / red (closed) light. */
    drawSignal(c, open) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        ctx.save();
        ctx.fillStyle = '#4a4036';
        this.roundRect(cx - size * 0.06, cy - size * 0.32, size * 0.12, size * 0.34, size * 0.03);
        ctx.fill();
        ctx.fillStyle = '#2c2620';
        this.roundRect(cx - size * 0.13, cy - size * 0.4, size * 0.26, size * 0.2, size * 0.05);
        ctx.fill();
        ctx.fillStyle = open ? '#4fae5a' : '#d2553f';
        ctx.beginPath();
        ctx.arc(cx, cy - size * 0.3, size * 0.066, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    drawRock(x, y) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        // Deterministic per-cell jitter so no two procedural rocks look identical.
        const h1 = this.cellRand(x, y);
        const h2 = this.cellRand(x * 3 + 1, y * 7 + 2);
        const w = 0.66 + h1 * 0.12; // body footprint (fraction of the cell)
        const ht = 0.58 + h2 * 0.12;
        const bx = left + size * (0.5 - w / 2) + (h2 - 0.5) * size * 0.05;
        const by = top + size * (0.52 - ht / 2);
        ctx.save();
        ctx.fillStyle = PAL.rockShadow;
        this.roundRect(bx + size * 0.02, by + size * 0.08, size * w, size * ht, size * 0.18);
        ctx.fill();
        ctx.fillStyle = PAL.rock;
        this.roundRect(bx, by, size * w, size * ht, size * 0.2);
        ctx.fill();
        ctx.fillStyle = PAL.rockHi;
        ctx.beginPath();
        ctx.arc(cx - size * 0.1 + (h1 - 0.5) * size * 0.08, cy - size * 0.08 + (h2 - 0.5) * size * 0.06, size * (0.1 + h1 * 0.05), 0, Math.PI * 2);
        ctx.arc(cx + size * 0.12 + (h2 - 0.5) * size * 0.06, cy + size * 0.03, size * (0.06 + h2 * 0.04), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    drawStartPad(x, y) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        const px = left + size * 0.12;
        const py = top + size * 0.12;
        const ps = size * 0.76;
        const r = size * 0.14;
        ctx.save();
        // Recessed dark pad set into the mine floor.
        ctx.fillStyle = PAL.start;
        this.roundRect(px, py, ps, ps, r);
        ctx.fill();
        // Soft bevel rim so it reads as an inset socket, not a flat tile.
        ctx.strokeStyle = PAL.startRim;
        ctx.lineWidth = Math.max(1, size * 0.025);
        this.roundRect(px, py, ps, ps, r);
        ctx.stroke();
        // Subtle "enter here" ring.
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = PAL.startMark;
        ctx.lineWidth = Math.max(1, size * 0.045);
        ctx.beginPath();
        ctx.arc(left + size / 2, top + size / 2, size * 0.17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
    drawExit(x, y) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        ctx.save();
        // checkered portal
        const n = 4;
        const s = size * 0.66;
        const ox = left + (size - s) / 2;
        const oy = top + (size - s) / 2;
        this.roundRect(ox, oy, s, s, size * 0.12);
        ctx.clip();
        const cs = s / n;
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                ctx.fillStyle = (i + j) % 2 === 0 ? PAL.exitA : PAL.exitB;
                ctx.fillRect(ox + i * cs, oy + j * cs, cs + 0.5, cs + 0.5);
            }
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = PAL.exitA;
        ctx.lineWidth = size * 0.05;
        this.roundRect(ox, oy, s, s, size * 0.12);
        ctx.stroke();
        ctx.restore();
    }
    /**
     * A tunnel = the machine model. Baked with its opening facing West; we turn it
     * to face the rail/goal it connects to (so the opening points where the train
     * exits), mirrored for East to stay upright and quarter-turned for N/S.
     */
    drawTunnel(c, grid) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(c.x, c.y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        if (this.assets && this.assets.has('tile_tunnel')) {
            const mouth = (edgeList(c.mask)[0] ?? tunnelExitDir(grid, c)) ?? 'W';
            this.contactShadow(cx, cy, size);
            ctx.save();
            ctx.translate(cx, cy);
            switch (mouth) {
                case 'W': break; // baked orientation
                case 'E':
                    ctx.scale(-1, 1);
                    break; // mirror, stays upright
                case 'S':
                    ctx.rotate(Math.PI / 2);
                    break;
                case 'N':
                    ctx.rotate(-Math.PI / 2);
                    break;
            }
            this.assets.draw(ctx, 'tile_tunnel', 0, 0, size * 0.98, size * 0.98);
            ctx.restore();
            return;
        }
        // Procedural fallback: a rounded portal with a dark mouth.
        ctx.save();
        ctx.fillStyle = PAL.rock;
        this.roundRect(left + size * 0.12, top + size * 0.12, size * 0.76, size * 0.76, size * 0.3);
        ctx.fill();
        ctx.fillStyle = PAL.inkDark;
        ctx.beginPath();
        ctx.arc(left + size / 2, top + size * 0.62, size * 0.22, Math.PI, Math.PI * 2);
        ctx.rect(left + size / 2 - size * 0.22, top + size * 0.62, size * 0.44, size * 0.26);
        ctx.fill();
        ctx.restore();
    }
    /* ----------------------------- entities ----------------------------- */
    headingAngle(h) {
        return { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 }[h];
    }
    drawLocomotive(x, y, h, roll = 0) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        if (this.assets?.has('loco')) {
            this.assets.draw(ctx, 'loco', cx, cy, size * 0.92, size * 0.92, this.headingAngle(h) + roll);
            return;
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.headingAngle(h) + roll);
        const w = size * 0.74;
        const hh = size * 0.5;
        // body
        ctx.fillStyle = PAL.loco;
        this.roundRect(-w / 2, -hh / 2, w, hh, size * 0.12);
        ctx.fill();
        // cab (rear)
        ctx.fillStyle = '#2d5680';
        this.roundRect(-w / 2, -hh / 2, w * 0.34, hh, size * 0.12);
        ctx.fill();
        // chimney
        ctx.fillStyle = PAL.inkDark;
        ctx.beginPath();
        ctx.arc(w * 0.22, 0, size * 0.09, 0, Math.PI * 2);
        ctx.fill();
        // forward chevron
        ctx.fillStyle = PAL.ink;
        ctx.beginPath();
        ctx.moveTo(w * 0.5 - size * 0.04, 0);
        ctx.lineTo(w * 0.32, -hh * 0.28);
        ctx.lineTo(w * 0.32, hh * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
    drawWagon(x, y, num, h = 'E', coupled = false) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        const w = size * 0.66;
        // A single wagon sprite serves every number — the sprite faces its heading,
        // the digit is drawn upright on top. A coupled wagon is recoloured to the
        // loco's blue so it visibly joins the train.
        if (this.assets?.has('wagon')) {
            if (coupled)
                this.assets.drawRecolored(ctx, 'wagon', cx, cy, size * 0.86, size * 0.86, PAL.coupledWagon, this.headingAngle(h));
            else
                this.assets.draw(ctx, 'wagon', cx, cy, size * 0.86, size * 0.86, this.headingAngle(h));
            ctx.save();
            ctx.fillStyle = PAL.ink;
            ctx.font = `800 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(num), cx, cy + size * 0.02);
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.fillStyle = PAL.wagonDark;
        this.roundRect(cx - w / 2, cy - w / 2 + size * 0.04, w, w, size * 0.12);
        ctx.fill();
        ctx.fillStyle = PAL.wagon;
        this.roundRect(cx - w / 2, cy - w / 2, w, w, size * 0.12);
        ctx.fill();
        ctx.fillStyle = PAL.ink;
        ctx.font = `700 ${Math.round(size * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(num), cx, cy + size * 0.02);
        ctx.restore();
    }
    drawMover(x, y, h) {
        const ctx = this.ctx;
        const { left, top, size } = this.cellRect(x, y);
        const cx = left + size / 2;
        const cy = top + size / 2;
        if (this.assets?.has('mover')) {
            this.assets.draw(ctx, 'mover', cx, cy, size * 0.78, size * 0.78, this.headingAngle(h));
            return;
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.headingAngle(h));
        ctx.fillStyle = PAL.mover;
        ctx.beginPath();
        ctx.moveTo(size * 0.24, 0);
        ctx.lineTo(-size * 0.18, -size * 0.2);
        ctx.lineTo(-size * 0.18, size * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
    /* ----------------------------- helper ----------------------------- */
    roundRect(x, y, w, h, r) {
        const ctx = this.ctx;
        const rr = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    }
}
//# sourceMappingURL=render.js.map