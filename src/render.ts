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

import { Grid } from './grid.js';
import { Cell, Heading, edgeList } from './types.js';
import { classify } from './track.js';

/** A drawable unit. `x`/`y` may be fractional so the Game can interpolate
 *  positions between simulation ticks for smooth motion. */
export interface DrawEntity {
  kind: 'loco' | 'wagon' | 'mover';
  x: number;
  y: number;
  heading: Heading;
  number?: number;
}

/** Live tile state during a run (gates open, signals green, junction branch).
 *  Null while editing — tiles then show their authored defaults. */
export interface DynamicState {
  gateOpen(color: string): boolean;
  signalOpen(idx: number): boolean;
  junctionBranch(idx: number): number;
}

/** A short-lived effect particle, positioned in cell-space so it survives resizes. */
interface Particle {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
  r0: number;
}

/** Named link colours for gates/buttons/switches/junctions. */
const LINK_COLORS: Record<string, string> = {
  red: '#d2553f',
  blue: '#3f7fd2',
  green: '#4fae5a',
  yellow: '#d9a82e',
  purple: '#9a6fc0',
  orange: '#e0883c',
};
const linkColor = (name?: string): string => (name ? (LINK_COLORS[name] ?? '#8a7a64') : '#8a7a64');

const PAL = {
  bg: '#ead9bb',
  boardLight: '#dcc8a2',
  boardDark: '#d3bd93',
  grid: 'rgba(80,60,30,0.10)',
  boardEdge: 'rgba(80,60,30,0.18)',
  tie: '#b98c54',
  tieShadow: 'rgba(60,40,15,0.25)',
  railCore: '#eef0f2',
  railEdge: '#8d9298',
  rock: '#736c62',
  rockHi: '#8a8278',
  rockShadow: 'rgba(40,32,22,0.30)',
  start: '#cdb892',
  startMark: '#5b8c6a',
  exitA: '#c95f52',
  exitB: '#f1e3cf',
  loco: '#3f6fa3',
  locoCab: '#2d5680',
  wagon: '#cf8740',
  wagonDark: '#a96a2c',
  ink: '#fbf6ec',
  inkDark: '#3a2f22',
  mover: '#8a6bb0',
  ghost: 'rgba(70,120,90,0.30)',
};

export interface Layout {
  ox: number;
  oy: number;
  cell: number;
  cols: number;
  rows: number;
  cssW: number;
  cssH: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  layout: Layout = { ox: 0, oy: 0, cell: 1, cols: 1, rows: 1, cssW: 1, cssH: 1 };
  private dpr = 1;
  private particles: Particle[] = [];
  private lastDrawMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Recompute backing-store size and the centred board layout. */
  resize(cols: number, rows: number): void {
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
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const { ox, oy, cell, cols, rows } = this.layout;
    const x = Math.floor((px - ox) / cell);
    const y = Math.floor((py - oy) / cell);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return { x, y };
  }

  private cellRect(x: number, y: number): { left: number; top: number; size: number } {
    const { ox, oy, cell } = this.layout;
    return { left: ox + x * cell, top: oy + y * cell, size: cell };
  }

  /* ----------------------------- frame ----------------------------- */

  draw(grid: Grid, entities: DrawEntity[], dyn: DynamicState | null = null, tMs = 0): void {
    const ctx = this.ctx;
    const { cssW, cssH } = this.layout;
    ctx.clearRect(0, 0, cssW, cssH);

    // Backdrop
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    this.drawBoard(grid);

    // Track (any cell with a mask: player track, fixed track, start/exit stubs)
    for (const c of grid.cells) if (c.mask !== 0) this.drawTrack(c, grid, dyn);

    // Tile markers on top of their stubs
    for (const c of grid.cells) this.drawTileMarker(c, grid, dyn);

    // Entities — drawn back-to-front so the loco sits on top of its wagons.
    for (const e of entities) if (e.kind !== 'loco') this.drawEntity(e);
    for (const e of entities) if (e.kind === 'loco') this.drawEntity(e);

    this.drawParticles(tMs);
  }

  /* ----------------------------- particles ----------------------------- */

  /** Spawn a burst of sparks at a cell (e.g. on coupling / win). */
  spawnBurst(cellX: number, cellY: number, color: string, count: number, tMs: number): void {
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

  /** Spawn a rising smoke puff from a loco's chimney. */
  spawnSmoke(cellX: number, cellY: number, tMs: number): void {
    this.particles.push({
      cx: cellX + 0.5 + (Math.random() - 0.5) * 0.1,
      cy: cellY + 0.4,
      vx: (Math.random() - 0.5) * 0.15,
      vy: -0.35 - Math.random() * 0.2,
      born: tMs,
      life: 650 + Math.random() * 350,
      color: 'rgba(170,160,150,0.55)',
      r0: 0.1 + Math.random() * 0.06,
    });
  }

  private drawParticles(tMs: number): void {
    if (!this.particles.length) {
      this.lastDrawMs = tMs;
      return;
    }
    const dt = this.lastDrawMs ? Math.min(64, tMs - this.lastDrawMs) : 16;
    this.lastDrawMs = tMs;
    const { ox, oy, cell } = this.layout;
    const ctx = this.ctx;
    ctx.save();
    const next: Particle[] = [];
    for (const p of this.particles) {
      const age = tMs - p.born;
      if (age >= p.life) continue;
      p.cx += (p.vx * dt) / 1000;
      p.cy += (p.vy * dt) / 1000;
      p.vy += (0.0012 * dt) / 1; // slight gravity for sparks; smoke rises faster than it falls
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

  private drawEntity(e: DrawEntity): void {
    switch (e.kind) {
      case 'loco':
        this.drawLocomotive(e.x, e.y, e.heading);
        break;
      case 'wagon':
        this.drawWagon(e.x, e.y, e.number ?? 0);
        break;
      case 'mover':
        this.drawMover(e.x, e.y, e.heading);
        break;
    }
  }

  private drawBoard(grid: Grid): void {
    const ctx = this.ctx;
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        const { left, top, size } = this.cellRect(x, y);
        ctx.fillStyle = (x + y) % 2 === 0 ? PAL.boardLight : PAL.boardDark;
        ctx.fillRect(left, top, size, size);
      }
    }
    // Grid lines + outer edge
    const { ox, oy, cell, cols, rows } = this.layout;
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
    ctx.strokeStyle = PAL.boardEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, cols * cell, rows * cell);
  }

  /* ----------------------------- track ----------------------------- */

  private edgeMid(left: number, top: number, size: number, h: Heading): { x: number; y: number } {
    const cx = left + size / 2;
    const cy = top + size / 2;
    switch (h) {
      case 'N': return { x: cx, y: top };
      case 'S': return { x: cx, y: top + size };
      case 'E': return { x: left + size, y: cy };
      case 'W': return { x: left, y: cy };
    }
  }
  private cornerOf(left: number, top: number, size: number, a: Heading, b: Heading): { x: number; y: number } {
    const set = new Set([a, b]);
    const right = set.has('E');
    const bottom = set.has('S');
    return { x: right ? left + size : left, y: bottom ? top + size : top };
  }

  private drawTrack(c: Cell, grid: Grid, dyn: DynamicState | null): void {
    const { left, top, size } = this.cellRect(c.x, c.y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    const edges = edgeList(c.mask);
    const shape = classify(c.mask);

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
        const hasNS = c.mask & 1 && c.mask & 4;
        const barA: Heading = hasNS ? 'N' : 'E';
        const barB: Heading = hasNS ? 'S' : 'W';
        const branch = edges.find((e) => e !== barA && e !== barB)!;
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
          const lm = this.edgeMid(left, top, size, live);
          const ctx = this.ctx;
          ctx.save();
          ctx.fillStyle = c.color ? linkColor(c.color) : PAL.startMark;
          ctx.beginPath();
          ctx.arc(cx + (lm.x - cx) * 0.45, cy + (lm.y - cy) * 0.45, size * 0.08, 0, Math.PI * 2);
          ctx.fill();
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

  private railCurve(left: number, top: number, size: number, a: Heading, b: Heading): void {
    const corner = this.cornerOf(left, top, size, a, b);
    const r = size / 2;
    const ma = this.edgeMid(left, top, size, a);
    const mb = this.edgeMid(left, top, size, b);
    const a0 = Math.atan2(ma.y - corner.y, ma.x - corner.x);
    let a1 = Math.atan2(mb.y - corner.y, mb.x - corner.x);
    // Choose the 90° (minor) sweep.
    let delta = a1 - a0;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    const anticlockwise = delta < 0;
    this.railArc(corner.x, corner.y, r, a0, a0 + (anticlockwise ? -Math.PI / 2 : Math.PI / 2), anticlockwise, size);
  }

  /** Stroke a straight rail segment as sleepers + two steel rails. */
  private railLine(x0: number, y0: number, x1: number, y1: number, size: number): void {
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

  private railArc(cx: number, cy: number, r: number, a0: number, a1: number, acw: boolean, size: number): void {
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

  private sleepersLine(x0: number, y0: number, x1: number, y1: number, size: number): void {
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

  private sleepersArc(cx: number, cy: number, r: number, a0: number, a1: number, acw: boolean, size: number): void {
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

  private drawTileMarker(c: Cell, grid: Grid, dyn: DynamicState | null): void {
    switch (c.type) {
      case 'rock': this.drawRock(c.x, c.y); break;
      case 'exit': this.drawExit(c.x, c.y); break;
      case 'start': this.drawStartPad(c.x, c.y); break;
      case 'tunnel': this.drawTunnel(c.x, c.y); break;
      case 'button': this.drawButton(c); break;
      case 'switch': this.drawSwitch(c); break;
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

  /** A drive-over button: a round pad in its link colour. */
  private drawButton(c: Cell): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(c.x, c.y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    const col = linkColor(c.color);
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
  private drawSwitch(c: Cell): void {
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

  /** A gate across the track: a coloured bar (filled = closed, hollow = open). */
  private drawGate(c: Cell, open: boolean): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(c.x, c.y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    const col = linkColor(c.color);
    const horizontal = (c.mask & 2 || c.mask & 8) !== 0; // track runs E/W -> bar is vertical
    ctx.save();
    ctx.translate(cx, cy);
    if (horizontal) ctx.rotate(Math.PI / 2); // make the bar cross the track
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
    } else {
      ctx.fillStyle = col;
      this.roundRect(-halfLen, -barW / 2, halfLen * 2, barW, size * 0.05);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      this.roundRect(-halfLen, -barW / 2, halfLen * 2, barW * 0.35, size * 0.05);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A signal post with a green (open) / red (closed) light. */
  private drawSignal(c: Cell, open: boolean): void {
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

  private drawRock(x: number, y: number): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    ctx.save();
    ctx.fillStyle = PAL.rockShadow;
    this.roundRect(left + size * 0.16, top + size * 0.24, size * 0.7, size * 0.62, size * 0.18);
    ctx.fill();
    ctx.fillStyle = PAL.rock;
    this.roundRect(left + size * 0.14, top + size * 0.16, size * 0.72, size * 0.64, size * 0.2);
    ctx.fill();
    ctx.fillStyle = PAL.rockHi;
    ctx.beginPath();
    ctx.arc(cx - size * 0.1, cy - size * 0.08, size * 0.12, 0, Math.PI * 2);
    ctx.arc(cx + size * 0.13, cy + size * 0.02, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawStartPad(x: number, y: number): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
    ctx.save();
    ctx.fillStyle = PAL.start;
    this.roundRect(left + size * 0.1, top + size * 0.1, size * 0.8, size * 0.8, size * 0.14);
    ctx.fill();
    ctx.restore();
  }

  private drawExit(x: number, y: number): void {
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

  private drawTunnel(x: number, y: number): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
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

  private headingAngle(h: Heading): number {
    return { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 }[h];
  }

  private drawLocomotive(x: number, y: number, h: Heading): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.headingAngle(h));
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

  private drawWagon(x: number, y: number, num: number): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
    const cx = left + size / 2;
    const cy = top + size / 2;
    const w = size * 0.66;
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

  private drawMover(x: number, y: number, h: Heading): void {
    const ctx = this.ctx;
    const { left, top, size } = this.cellRect(x, y);
    const cx = left + size / 2;
    const cy = top + size / 2;
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

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
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
