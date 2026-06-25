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
import { DrawEntity, DynamicState, Renderer, linkColor } from './render.js';
import { Simulation } from './sim.js';
import { AudioManager } from './sound.js';
import { DELTA, Heading } from './types.js';
import { easeFrac, MotionPhase } from './feel/motion.js';
import { tracePath } from './feel/pathpreview.js';

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
  private finishing = false; // playing out the final move (win) before the panel
  private settling = false; // final move eases to a stop instead of cruising
  private prevLocoHeading: Heading | undefined; // for lean-into-curves detection
  private locoRoll = 0; // current cosmetic lean (radians), decays each frame
  private ambientStarted = false; // start the mine-ambience bed once, after a gesture

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
    this.finishing = false;
    this.settling = false;
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

    const s = this.sim;
    if (this.state === 'running' && s) {
      if (s.status === 'running') {
        this.acc += dt;
        const interval = this.tickInterval();
        let guard = 0;
        while (this.acc >= interval && s.status === 'running' && guard++ < 8) {
          s.tick();
          this.afterTick();
          this.acc -= interval;
        }
        if (s.status !== 'running') this.beginFinish();
      } else if (this.finishing) {
        // Let the final move ease to a stop, then reveal the outcome.
        this.acc += dt;
        if (this.acc >= this.tickInterval()) {
          this.finishing = false;
          this.settling = false;
          this.onSimEnded();
        }
      }
    }

    const cruising = this.state === 'running' && s != null && s.status === 'running';
    const animating = cruising || this.finishing;
    const frac = animating ? Math.min(1, this.acc / this.tickInterval()) : 1;
    this.renderer.draw(this.grid, this.buildEntities(frac), this.dynState(), now, this.previewPath());
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
        this.renderer.kick(0.12); // a little jolt as the wagon snaps on
        navigator.vibrate?.(20);
      } else if (ev === 'button') {
        this.audio.play('button');
        this.reactButtons();
      } else if (ev === 'switch') {
        this.reactSwitches();
      }
    }
    this.reactTeleports();

    // Rolling feedback. While advancing: a rail clack + a chimney puff drifting
    // behind. While held at a signal/gate: a small impatient puff straight up.
    if (s.status === 'running') {
      const moved = s.loco.x !== s.loco.px || s.loco.y !== s.loco.py;
      if (moved) {
        this.audio.play('clack');
        this.renderer.spawnSmoke(s.loco.x, s.loco.y, this.now, s.loco.heading);
      } else {
        this.renderer.spawnSmoke(s.loco.x, s.loco.y, this.now);
      }
    }
  }

  /** A button was stepped on: pulse the link to each gate it controls, flash the
   *  gate, kick up dust, and clunk. (Derives the buttons hit from unit positions.) */
  private reactButtons(): void {
    const s = this.sim;
    if (!s) return;
    const units = [{ x: s.loco.x, y: s.loco.y }, ...s.movers.map((m) => ({ x: m.x, y: m.y }))];
    let reacted = false;
    for (const u of units) {
      const cell = this.grid.get(u.x, u.y);
      if (!cell || cell.type !== 'button') continue;
      const master = !cell.color;
      const col = master ? '#f3e1b0' : linkColor(cell.color);
      for (const g of this.grid.cells) {
        if (g.type !== 'gate') continue;
        if (!master && g.color !== cell.color) continue;
        this.renderer.fxLink(u.x, u.y, g.x, g.y, col, this.now);
        this.renderer.fxRing(g.x, g.y, col, this.now);
        this.renderer.spawnBurst(g.x, g.y, 'rgba(150,140,130,0.8)', 5, this.now); // dust
        reacted = true;
      }
    }
    if (reacted) this.audio.play('gate');
  }

  /** A switch was thrown: ring it and ka-chak. (The junction chevron already flips.) */
  private reactSwitches(): void {
    const s = this.sim;
    if (!s) return;
    const units = [{ x: s.loco.x, y: s.loco.y }, ...s.movers.map((m) => ({ x: m.x, y: m.y }))];
    let reacted = false;
    for (const u of units) {
      const cell = this.grid.get(u.x, u.y);
      if (cell && cell.type === 'switch' && cell.color) {
        this.renderer.fxRing(u.x, u.y, linkColor(cell.color), this.now);
        reacted = true;
      }
    }
    if (reacted) this.audio.play('switch');
  }

  /** Any unit that jumped more than a cell this tick teleported — whoosh both mouths. */
  private reactTeleports(): void {
    const s = this.sim;
    if (!s) return;
    const units = [s.loco, ...s.movers];
    let teleported = false;
    for (const u of units) {
      if (Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 1.5) {
        this.renderer.fxWhoosh(u.px, u.py, '#9a6fc0', this.now);
        this.renderer.fxWhoosh(u.x, u.y, '#9a6fc0', this.now);
        teleported = true;
      }
    }
    if (teleported) this.audio.play('teleport');
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
    // Constant-speed cruise, easing only out of rest (launch) and into the stop
    // (settle) — so a multi-cell run rolls smoothly instead of pulsing per cell.
    const phase: MotionPhase = this.settling ? 'settle' : this.sim && this.sim.ticks <= 1 ? 'launch' : 'cruise';
    const frac = easeFrac(rawFrac, phase);
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
      // Cosmetic life: a chug-bob (≈one bob per tick) and a lean into curves,
      // only while the train is actually rolling.
      const cruising = this.state === 'running' && s.status === 'running';
      const bob = cruising ? Math.sin(this.now * 0.017) * 0.022 : 0;
      this.updateLocoRoll(cruising ? s.loco.heading : undefined);
      for (const w of s.free) out.push({ kind: 'wagon', x: w.x, y: w.y, heading: w.heading, number: w.number });
      const lp = pos(s.loco.px, s.loco.py, s.loco.x, s.loco.y);
      lp.y += bob;
      const chain: { x: number; y: number }[] = [lp]; // front-to-back train positions
      for (const w of s.coupled) {
        const p = pos(w.px, w.py, w.x, w.y);
        p.y += bob;
        chain.push(p);
        out.push({ kind: 'wagon', x: p.x, y: p.y, heading: dirOf(w.x - w.px, w.y - w.py, w.heading), number: w.number, coupled: true });
      }
      for (const m of s.movers) {
        const p = pos(m.px, m.py, m.x, m.y);
        p.y += bob;
        out.push({ kind: 'mover', x: p.x, y: p.y, heading: m.heading });
      }
      out.push({ kind: 'loco', x: lp.x, y: lp.y, heading: s.loco.heading, roll: this.locoRoll });
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
    this.finishing = false;
    this.settling = false;
    this.locoRoll = 0;
    this.prevLocoHeading = undefined;
    this.hideOutcome();
  }

  /** Sim just stopped during continuous play. Win → glide the last move to a
   *  stop (eased settle) before celebrating; derail → crash now, resolve now. */
  private beginFinish(): void {
    if (this.sim?.status === 'won') {
      this.finishing = true;
      this.settling = true;
      this.acc = 0; // restart the inter-tick clock for the final glide
      this.audio.play('arrive');
    } else {
      this.finalize();
    }
  }

  /** Resolve a finished sim immediately (used when stepping, and on derail). */
  private finalize(): void {
    if (this.sim?.status === 'lost') this.onCrash();
    this.onSimEnded();
  }

  /** Visceral derail feedback: impact sound, debris burst, a hard screen kick. */
  private onCrash(): void {
    const s = this.sim;
    if (!s) return;
    this.audio.play('crash');
    this.renderer.spawnDebris(s.loco.x, s.loco.y, this.now);
    this.renderer.kick(0.9);
    navigator.vibrate?.(120);
  }

  private onSimEnded(): void {
    if (!this.sim) return;
    const won = this.sim.status === 'won';
    this.state = won ? 'won' : 'lost';
    if (won) {
      this.audio.play('win');
      this.audio.play('whistle');
      this.renderer.spawnBurst(this.sim.loco.x, this.sim.loco.y, '#7ed09a', 22, this.now);
      this.renderer.kick(0.3);
      navigator.vibrate?.([20, 40, 30]);
      if (this.onWin) this.onWin(this.level.id, this.sim.ticks);
    }
    this.showOutcome();
    this.updateControls();
  }

  /** Where the train will roll given the current track (editing-only telegraph),
   *  plus whether it reaches the goal and where it would grab wagons. */
  private previewPath(): ReturnType<typeof tracePath> | undefined {
    if (this.state !== 'editing') return undefined;
    const wagons = (this.level.wagons ?? []).map((w) => ({ x: w.x, y: w.y }));
    return tracePath(this.grid, this.level.locomotive, wagons);
  }

  /** Lean-into-curves: set a brief tilt impulse when the loco changes heading,
   *  decaying each frame. Pass undefined when not rolling to clear it. */
  private updateLocoRoll(heading: Heading | undefined): void {
    if (!heading) {
      this.locoRoll = 0;
      this.prevLocoHeading = undefined;
      return;
    }
    if (this.prevLocoHeading && heading !== this.prevLocoHeading) {
      const a = DELTA[this.prevLocoHeading];
      const b = DELTA[heading];
      this.locoRoll = Math.sign(a.dx * b.dy - a.dy * b.dx) * 0.2; // lean into the turn
    }
    this.prevLocoHeading = heading;
    this.locoRoll *= 0.88; // decay
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
    this.finishing = false;
    this.settling = false;
    this.hideOutcome();
    this.updateControls();
  }

  play(): void {
    // First Play is a user gesture — safe to start the WebAudio ambience bed.
    if (!this.ambientStarted) {
      this.audio.startAmbient();
      this.ambientStarted = true;
    }
    switch (this.state) {
      case 'editing':
        this.startSim();
        this.audio.play('start');
        this.audio.play('whistle');
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
      if (this.sim.status !== 'running') this.finalize();
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
    this.finishing = false;
    this.settling = false;
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
