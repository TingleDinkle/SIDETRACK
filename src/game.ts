/**
 * Game orchestrator — owns the level, grid, editor, renderer, input and the
 * running simulation. Drives one render loop that (a) advances the sim on a
 * fixed tick interval when playing and (b) interpolates entity positions
 * between ticks for smooth motion.
 *
 * States:
 *   editing  — laying track; input enabled; no sim.
 *   running  — sim auto-ticking at the current speed.
 *   paused   — sim exists but halted (after Step, or Play-toggle).
 *   won/lost — sim finished; outcome panel shown.
 */

import { Editor } from './editor.js';
import { InputController } from './input.js';
import { Level, buildGrid } from './level.js';
import { Grid } from './grid.js';
import { DrawEntity, DynamicState, Renderer } from './render.js';
import { Simulation } from './sim.js';
import { AudioManager } from './sound.js';
import { Heading } from './types.js';

export type GameState = 'editing' | 'running' | 'paused' | 'won' | 'lost';

export interface Hud {
  levelName: HTMLElement;
  budgetUsed: HTMLElement;
  budgetTotal: HTMLElement;
  budgetBox: HTMLElement;
  toast: HTMLElement;
  btnUndo: HTMLButtonElement;
  btnRedo: HTMLButtonElement;
  btnPlay: HTMLButtonElement;
  btnStep: HTMLButtonElement;
  btnSpeed: HTMLButtonElement;
  outcome: {
    panel: HTMLElement;
    title: HTMLElement;
    sub: HTMLElement;
    btnReplay: HTMLButtonElement;
    btnNext: HTMLButtonElement;
    btnEdit: HTMLButtonElement;
  };
}

const TICK_BASE_MS = 360; // 1× tick interval

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Game {
  state: GameState = 'editing';
  level!: Level;
  grid!: Grid;
  editor!: Editor;
  sim: Simulation | null = null;

  private input: InputController;
  private readonly resizeObserver: ResizeObserver;
  private toastTimer = 0;

  /** Hold booster: frozen object keys for the sim, plus targeting state. */
  private readonly held = new Set<string>();
  private holdTargeting = false;
  private onHoldResult: ((applied: boolean) => void) | null = null;

  /** Called when a level is solved (for progress persistence / UI refresh). */
  onWin: ((levelId: string, ticks: number) => void) | null = null;

  private levels: Level[];
  private levelIndex = 0;
  private speed = 1;
  private acc = 0; // accumulated ms toward the next tick
  private lastTime = 0;
  private now = 0; // latest RAF timestamp (for particle spawns)

  constructor(
    canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private readonly hud: Hud,
    private readonly audio: AudioManager,
    levels: Level[],
    startIndex = 0,
  ) {
    this.levels = levels;
    this.levelIndex = startIndex;
    this.applyLevel(this.levels[startIndex]);
    this.input = new InputController(canvas, renderer, this.editor, () => this.onEdited());
    // Capture-phase listener so Hold targeting intercepts taps before track-laying.
    canvas.addEventListener('pointerdown', this.onHoldPointer, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    requestAnimationFrame(this.loop);
    this.updateControls();
  }

  /* ----------------------------- level mgmt ----------------------------- */

  private applyLevel(level: Level): void {
    this.level = level;
    this.grid = buildGrid(level);
    this.editor = new Editor(this.grid, level.trackBudget);
    this.sim = null;
    this.state = 'editing';
    this.acc = 0;
    this.held.clear();
    this.cancelHoldTargeting();
    this.renderer.setTheme(typeof level.world === 'number' ? level.world : 1);
  }

  /** Replace the level list (e.g. after the manager edits the library). */
  setLevels(levels: Level[]): void {
    this.levels = levels;
    if (this.levelIndex >= levels.length) this.levelIndex = Math.max(0, levels.length - 1);
  }

  loadLevel(level: Level): void {
    const i = this.levels.indexOf(level);
    if (i >= 0) this.levelIndex = i;
    this.applyLevel(level);
    this.input.setEditor(this.editor);
    this.input.setEnabled(true);
    this.resize();
    this.hideOutcome();
    this.updateHud();
    this.updateControls();
  }
  loadIndex(i: number): void {
    if (i < 0 || i >= this.levels.length) return;
    this.loadLevel(this.levels[i]);
  }
  hasNext(): boolean {
    return this.levelIndex + 1 < this.levels.length;
  }

  /* ----------------------------- run loop ----------------------------- */

  private tickInterval(): number {
    return TICK_BASE_MS / this.speed;
  }

  private loop = (now: number): void => {
    const dt = this.lastTime ? now - this.lastTime : 0;
    this.lastTime = now;
    this.now = now;

    if (this.state === 'running' && this.sim && this.sim.status === 'running') {
      this.acc += dt;
      const interval = this.tickInterval();
      let guard = 0;
      while (this.acc >= interval && this.sim.status === 'running' && guard++ < 8) {
        this.sim.tick();
        this.afterTick();
        this.acc -= interval;
      }
      if (this.sim.status !== 'running') this.onSimEnded();
    }

    const animating = this.state === 'running' && this.sim && this.sim.status === 'running';
    const frac = animating ? Math.min(1, this.acc / this.tickInterval()) : 1;
    this.renderer.draw(this.grid, this.buildEntities(frac), this.dynState(), now);
    if (this.held.size) this.renderer.markFrozen(this.frozenCells());
    if (this.holdTargeting) this.renderer.drawHoldOverlay(this.holdableCells());
    requestAnimationFrame(this.loop);
  };

  /** React to the events of the tick that just ran (sfx + particles + puff). */
  private afterTick(): void {
    const s = this.sim;
    if (!s) return;
    for (const ev of s.events) {
      if (ev === 'couple') {
        this.audio.play('couple');
        this.renderer.spawnBurst(s.loco.x, s.loco.y, '#ffe7a0', 12, this.now);
        navigator.vibrate?.(20);
      } else if (ev === 'button') {
        this.audio.play('button');
      }
    }
    if (s.status === 'running') this.renderer.spawnSmoke(s.loco.x, s.loco.y, this.now);
  }

  private dynState(): DynamicState | null {
    const s = this.sim;
    if (!s) return null;
    return {
      gateOpen: (c) => s.gateIsOpen(c),
      signalOpen: (i) => s.signalIsOpen(i),
      junctionBranch: (i) => s.junctionBranch(i),
    };
  }

  private buildEntities(rawFrac: number): DrawEntity[] {
    // Ease the motion (easeInOutQuad) for a gentler glide between ticks.
    const frac = rawFrac < 0.5 ? 2 * rawFrac * rawFrac : 1 - Math.pow(-2 * rawFrac + 2, 2) / 2;
    // Lerp between ticks, but snap across teleports (a jump of >1 cell).
    const pos = (px: number, py: number, x: number, y: number): { x: number; y: number } =>
      Math.abs(x - px) + Math.abs(y - py) > 1.5 ? { x, y } : { x: lerp(px, x, frac), y: lerp(py, y, frac) };
    const out: DrawEntity[] = [];
    // Cosmetic scenery (only drawn when matching sprites are loaded).
    for (const d of this.level.decor ?? [])
      out.push({ kind: 'decor', x: d.x, y: d.y, heading: 'N', sprite: d.sprite, scale: d.scale });
    // Facing from a discrete cell delta (cosmetic wagon orientation).
    const dirOf = (dx: number, dy: number, fb: Heading): Heading =>
      dx === 0 && dy === 0 ? fb : Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    if (this.sim) {
      const s = this.sim;
      for (const w of s.free) out.push({ kind: 'wagon', x: w.x, y: w.y, heading: w.heading, number: w.number });
      const lp = pos(s.loco.px, s.loco.py, s.loco.x, s.loco.y);
      const chain: { x: number; y: number }[] = [lp]; // front-to-back train positions
      for (const w of s.coupled) {
        const p = pos(w.px, w.py, w.x, w.y);
        chain.push(p);
        out.push({ kind: 'wagon', x: p.x, y: p.y, heading: dirOf(w.x - w.px, w.y - w.py, w.heading), number: w.number, coupled: true });
      }
      for (const m of s.movers) {
        const p = pos(m.px, m.py, m.x, m.y);
        out.push({ kind: 'mover', x: p.x, y: p.y, heading: m.heading });
      }
      out.push({ kind: 'loco', x: lp.x, y: lp.y, heading: s.loco.heading });
      // A coupler between each adjacent pair of cars (skip teleport gaps).
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > 0.2 && d < 1.4) {
          out.push({
            kind: 'coupler',
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            heading: Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N',
          });
        }
      }
    } else {
      const L = this.level;
      for (const w of L.wagons ?? []) out.push({ kind: 'wagon', x: w.x, y: w.y, heading: w.heading ?? 'E', number: w.number });
      for (const m of L.movers ?? []) out.push({ kind: 'mover', x: m.x, y: m.y, heading: m.heading });
      out.push({ kind: 'loco', x: L.locomotive.x, y: L.locomotive.y, heading: L.locomotive.heading });
    }
    return out;
  }

  private startSim(): void {
    this.sim = new Simulation(this.grid, this.level, this.held);
    this.input.setEnabled(false);
    this.acc = 0;
    this.hideOutcome();
  }

  private onSimEnded(): void {
    if (!this.sim) return;
    const won = this.sim.status === 'won';
    this.state = won ? 'won' : 'lost';
    if (won) {
      this.audio.play('win');
      this.renderer.spawnBurst(this.sim.loco.x, this.sim.loco.y, '#7ed09a', 22, this.now);
      navigator.vibrate?.([20, 40, 30]);
      if (this.onWin) this.onWin(this.level.id, this.sim.ticks);
    } else {
      this.audio.play('lose');
      navigator.vibrate?.(120);
    }
    this.showOutcome();
    this.updateControls();
  }

  /* ----------------------------- view ----------------------------- */

  private resize(): void {
    this.renderer.resize(this.grid.cols, this.grid.rows);
  }

  private onEdited(): void {
    this.updateHud();
  }

  updateHud(): void {
    this.hud.levelName.textContent = `${this.level.id} · ${this.level.name}`;
    const used = this.editor.budgetUsed();
    this.hud.budgetUsed.textContent = String(used);
    this.hud.budgetTotal.textContent = String(this.editor.budget);
    this.hud.budgetBox.classList.toggle('over', used >= this.editor.budget);
  }

  private updateControls(): void {
    const editing = this.state === 'editing';
    const running = this.state === 'running';
    this.hud.btnUndo.disabled = !editing || !this.editor.canUndo();
    this.hud.btnRedo.disabled = !editing || !this.editor.canRedo();
    this.hud.btnPlay.textContent = running ? '⏸ Pause' : this.state === 'paused' ? '▶ Resume' : '▶ Play';
    this.hud.btnSpeed.textContent = `${this.speed}×`;
    this.updateHud();
  }

  toast(msg: string): void {
    const t = this.hud.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1700);
  }

  private showOutcome(): void {
    const o = this.hud.outcome;
    const won = this.state === 'won';
    o.panel.classList.add('show');
    o.panel.classList.toggle('win', won);
    o.panel.classList.toggle('lose', !won);
    o.title.textContent = won ? 'Solved!' : 'Crashed';
    o.sub.textContent = won
      ? `Cleared in ${this.sim?.ticks ?? 0} ticks`
      : this.sim?.failReason
        ? `${this.sim.failReason}`
        : 'Try again';
    o.btnNext.style.display = won && this.hasNext() ? '' : 'none';
  }
  private hideOutcome(): void {
    this.hud.outcome.panel.classList.remove('show');
  }

  /* ----------------------------- actions ----------------------------- */

  undo(): void {
    if (this.state !== 'editing') return;
    this.editor.undo();
    this.updateControls();
  }
  redo(): void {
    if (this.state !== 'editing') return;
    this.editor.redo();
    this.updateControls();
  }

  /** Stop any running sim and return to editing (track preserved). */
  reset(): void {
    this.sim = null;
    this.state = 'editing';
    this.input.setEnabled(true);
    this.acc = 0;
    this.hideOutcome();
    this.updateControls();
  }

  play(): void {
    switch (this.state) {
      case 'editing':
        this.startSim();
        this.audio.play('start');
        this.state = 'running';
        break;
      case 'running':
        this.state = 'paused';
        break;
      case 'paused':
        this.state = 'running';
        break;
      case 'won':
      case 'lost':
        this.startSim();
        this.state = 'running';
        break;
    }
    this.updateControls();
  }

  step(): void {
    if (this.state === 'editing') this.startSim();
    if (this.state === 'won' || this.state === 'lost') return;
    if (this.sim && this.sim.status === 'running') {
      this.sim.tick();
      this.afterTick();
      this.acc = 0;
      if (this.sim.status !== 'running') this.onSimEnded();
      else this.state = 'paused';
    }
    this.updateControls();
  }

  /** Mute / unmute all sound. */
  setMuted(muted: boolean): void {
    this.audio.setEnabled(!muted);
  }

  cycleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
    this.updateControls();
  }

  /* ----------------------------- boosters ----------------------------- */

  /** Reverse: undo all the way back to the level's starting state. */
  revertToStart(): void {
    this.sim = null;
    this.state = 'editing';
    this.input.setEnabled(true);
    this.acc = 0;
    this.held.clear();
    this.cancelHoldTargeting();
    this.editor.clearAll();
    this.hideOutcome();
    this.updateControls();
    this.toast('Reverted to start');
  }

  /** +Track: grant extra track budget for this attempt. */
  grantTrack(n = 1): void {
    this.editor.budget += n;
    this.updateHud();
    this.toast(`+${n} track piece`);
  }

  /** Boost: run Play at 2×. */
  boost(): void {
    this.speed = 2;
    this.updateControls();
    this.toast('Boost · 2× speed');
  }

  /** Hold: enter targeting to freeze one object (signal / gate / mover). The
   *  callback reports whether a freeze was actually applied (to spend the use). */
  beginHold(onResult: (applied: boolean) => void): void {
    if (this.holdTargeting) {
      onResult(false);
      return;
    }
    if (!this.holdableCells().length) {
      this.toast('Nothing to hold on this level');
      onResult(false);
      return;
    }
    this.holdTargeting = true;
    this.onHoldResult = onResult;
    this.input.setEnabled(false);
    this.toast('Tap an object to freeze it (tap empty to cancel)');
  }

  private cancelHoldTargeting(): void {
    if (!this.holdTargeting) return;
    this.holdTargeting = false;
    const cb = this.onHoldResult;
    this.onHoldResult = null;
    if (this.state === 'editing') this.input.setEnabled(true);
    cb?.(false);
  }

  /** Cells of objects that can be frozen: movers, signals, gates. */
  private holdableCells(): { x: number; y: number; key: string }[] {
    const out: { x: number; y: number; key: string }[] = [];
    const movers = this.sim ? this.sim.movers.map((m, i) => ({ x: m.x, y: m.y, i })) : (this.level.movers ?? []).map((m, i) => ({ x: m.x, y: m.y, i }));
    for (const m of movers) out.push({ x: m.x, y: m.y, key: 'mover:' + m.i });
    for (const c of this.grid.cells) {
      if (c.type === 'signal') out.push({ x: c.x, y: c.y, key: 'sig:' + this.grid.idx(c.x, c.y) });
      else if (c.type === 'gate' && c.color) out.push({ x: c.x, y: c.y, key: 'gate:' + c.color });
    }
    return out;
  }

  /** Current cells of frozen objects (for the ❄ markers). */
  private frozenCells(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const key of this.held) {
      if (key.startsWith('mover:')) {
        const i = Number(key.slice(6));
        const m = this.sim ? this.sim.movers[i] : (this.level.movers ?? [])[i];
        if (m) out.push({ x: m.x, y: m.y });
      } else if (key.startsWith('sig:')) {
        const idx = Number(key.slice(4));
        const c = this.grid.cells[idx];
        if (c) out.push({ x: c.x, y: c.y });
      } else if (key.startsWith('gate:')) {
        const color = key.slice(5);
        for (const c of this.grid.cells) if (c.type === 'gate' && c.color === color) out.push({ x: c.x, y: c.y });
      }
    }
    return out;
  }

  private onHoldPointer = (e: PointerEvent): void => {
    if (!this.holdTargeting) return;
    e.preventDefault();
    e.stopPropagation();
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    const cb = this.onHoldResult;
    this.holdTargeting = false;
    this.onHoldResult = null;
    if (this.state === 'editing') this.input.setEnabled(true);
    const hit = cell ? this.holdableCells().find((h) => h.x === cell.x && h.y === cell.y) : undefined;
    if (hit && !this.held.has(hit.key)) {
      this.held.add(hit.key);
      this.toast('Frozen ❄');
      cb?.(true); // applied → spend the use
    } else if (hit) {
      this.held.delete(hit.key); // tapping a frozen object un-freezes it (refunds)
      this.toast('Un-frozen');
      cb?.(false);
    } else {
      this.toast('Cancelled');
      cb?.(false);
    }
  };

  replay(): void {
    this.startSim();
    this.state = 'running';
    this.updateControls();
  }
  next(): void {
    if (this.hasNext()) this.loadIndex(this.levelIndex + 1);
  }

  /** Release observers/listeners (no destruction path yet, but ready for it). */
  dispose(): void {
    this.resizeObserver.disconnect();
  }
}
