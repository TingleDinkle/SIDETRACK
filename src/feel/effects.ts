/**
 * Transient world-reaction effects — the flashes/pulses that make puzzle objects
 * feel like they *responded*. Cosmetic and self-contained: spawn on a sim event,
 * they animate themselves and expire. Positions are in cell-space so they survive
 * resizes. The renderer owns one instance and draws it inside its frame.
 */

interface RingFx {
  kind: 'ring';
  cx: number;
  cy: number;
  born: number;
  life: number;
  color: string;
  r1: number; // end radius in cells
}
interface PulseFx {
  kind: 'pulse';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  born: number;
  life: number;
  color: string;
}
type Fx = RingFx | PulseFx;

export class Effects {
  private fx: Fx[] = [];

  /** An expanding ring at a cell — a "this reacted" flash (gate clunk, switch). */
  ring(cellX: number, cellY: number, color: string, tMs: number, life = 420, r1 = 0.85): void {
    this.fx.push({ kind: 'ring', cx: cellX + 0.5, cy: cellY + 0.5, born: tMs, life, color, r1 });
  }

  /** A glow that travels from one cell to another — the button→gate link firing. */
  pulse(ax: number, ay: number, bx: number, by: number, color: string, tMs: number): void {
    this.fx.push({ kind: 'pulse', ax: ax + 0.5, ay: ay + 0.5, bx: bx + 0.5, by: by + 0.5, born: tMs, life: 320, color });
  }

  /** A double-ring burst — the tunnel teleport flash (spawn at both mouths). */
  whoosh(cellX: number, cellY: number, color: string, tMs: number): void {
    this.ring(cellX, cellY, color, tMs, 360, 0.7);
    this.ring(cellX, cellY, color, tMs + 60, 300, 1.0);
  }

  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, cell: number, tMs: number): void {
    if (!this.fx.length) return;
    const px = (cx: number, cy: number): [number, number] => [ox + cx * cell, oy + cy * cell];
    ctx.save();
    const next: Fx[] = [];
    for (const f of this.fx) {
      const age = tMs - f.born;
      if (age < 0) {
        next.push(f);
        continue;
      }
      if (age >= f.life) continue;
      const k = age / f.life; // 0..1 progress
      if (f.kind === 'ring') {
        const [x, y] = px(f.cx, f.cy);
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = Math.max(2, cell * 0.06 * (1 - k));
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.15 + f.r1 * k), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // pulse: a comet from a→b with a short fading tail
        const hx = f.ax + (f.bx - f.ax) * k;
        const hy = f.ay + (f.by - f.ay) * k;
        const tk = Math.max(0, k - 0.25);
        const tx = f.ax + (f.bx - f.ax) * tk;
        const ty = f.ay + (f.by - f.ay) * tk;
        const [hX, hY] = px(hx, hy);
        const [tX, tY] = px(tx, ty);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = f.color;
        ctx.lineCap = 'round';
        ctx.lineWidth = cell * 0.09;
        ctx.beginPath();
        ctx.moveTo(tX, tY);
        ctx.lineTo(hX, hY);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(hX, hY, cell * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      next.push(f);
    }
    ctx.restore();
    this.fx = next;
  }
}
