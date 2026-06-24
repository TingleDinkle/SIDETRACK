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
import { buildGrid } from './level.js';
import { Simulation } from './sim.js';
const TICK_BASE_MS = 360; // 1× tick interval
const lerp = (a, b, t) => a + (b - a) * t;
export class Game {
    constructor(canvas, renderer, hud, audio, levels, startIndex = 0) {
        this.renderer = renderer;
        this.hud = hud;
        this.audio = audio;
        this.state = 'editing';
        this.sim = null;
        this.toastTimer = 0;
        /** Hold booster: frozen object keys for the sim, plus targeting state. */
        this.held = new Set();
        this.holdTargeting = false;
        this.onHoldResult = null;
        /** Called when a level is solved (for progress persistence / UI refresh). */
        this.onWin = null;
        this.levelIndex = 0;
        this.speed = 1;
        this.acc = 0; // accumulated ms toward the next tick
        this.lastTime = 0;
        this.now = 0; // latest RAF timestamp (for particle spawns)
        this.loop = (now) => {
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
                if (this.sim.status !== 'running')
                    this.onSimEnded();
            }
            const animating = this.state === 'running' && this.sim && this.sim.status === 'running';
            const frac = animating ? Math.min(1, this.acc / this.tickInterval()) : 1;
            this.renderer.draw(this.grid, this.buildEntities(frac), this.dynState(), now);
            if (this.held.size)
                this.renderer.markFrozen(this.frozenCells());
            if (this.holdTargeting)
                this.renderer.drawHoldOverlay(this.holdableCells());
            requestAnimationFrame(this.loop);
        };
        this.onHoldPointer = (e) => {
            if (!this.holdTargeting)
                return;
            e.preventDefault();
            e.stopPropagation();
            const cell = this.renderer.cellAt(e.clientX, e.clientY);
            const cb = this.onHoldResult;
            this.holdTargeting = false;
            this.onHoldResult = null;
            if (this.state === 'editing')
                this.input.setEnabled(true);
            const hit = cell ? this.holdableCells().find((h) => h.x === cell.x && h.y === cell.y) : undefined;
            if (hit && !this.held.has(hit.key)) {
                this.held.add(hit.key);
                this.toast('Frozen ❄');
                cb?.(true); // applied → spend the use
            }
            else if (hit) {
                this.held.delete(hit.key); // tapping a frozen object un-freezes it (refunds)
                this.toast('Un-frozen');
                cb?.(false);
            }
            else {
                this.toast('Cancelled');
                cb?.(false);
            }
        };
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
    applyLevel(level) {
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
    setLevels(levels) {
        this.levels = levels;
        if (this.levelIndex >= levels.length)
            this.levelIndex = Math.max(0, levels.length - 1);
    }
    loadLevel(level) {
        const i = this.levels.indexOf(level);
        if (i >= 0)
            this.levelIndex = i;
        this.applyLevel(level);
        this.input.setEditor(this.editor);
        this.input.setEnabled(true);
        this.resize();
        this.hideOutcome();
        this.updateHud();
        this.updateControls();
    }
    loadIndex(i) {
        if (i < 0 || i >= this.levels.length)
            return;
        this.loadLevel(this.levels[i]);
    }
    hasNext() {
        return this.levelIndex + 1 < this.levels.length;
    }
    /* ----------------------------- run loop ----------------------------- */
    tickInterval() {
        return TICK_BASE_MS / this.speed;
    }
    /** React to the events of the tick that just ran (sfx + particles + puff). */
    afterTick() {
        const s = this.sim;
        if (!s)
            return;
        for (const ev of s.events) {
            if (ev === 'couple') {
                this.audio.play('couple');
                this.renderer.spawnBurst(s.loco.x, s.loco.y, '#ffe7a0', 12, this.now);
                navigator.vibrate?.(20);
            }
            else if (ev === 'button') {
                this.audio.play('button');
            }
        }
        if (s.status === 'running')
            this.renderer.spawnSmoke(s.loco.x, s.loco.y, this.now);
    }
    dynState() {
        const s = this.sim;
        if (!s)
            return null;
        return {
            gateOpen: (c) => s.gateIsOpen(c),
            signalOpen: (i) => s.signalIsOpen(i),
            junctionBranch: (i) => s.junctionBranch(i),
        };
    }
    buildEntities(rawFrac) {
        // Ease the motion (easeInOutQuad) for a gentler glide between ticks.
        const frac = rawFrac < 0.5 ? 2 * rawFrac * rawFrac : 1 - Math.pow(-2 * rawFrac + 2, 2) / 2;
        // Lerp between ticks, but snap across teleports (a jump of >1 cell).
        const pos = (px, py, x, y) => Math.abs(x - px) + Math.abs(y - py) > 1.5 ? { x, y } : { x: lerp(px, x, frac), y: lerp(py, y, frac) };
        const out = [];
        // Cosmetic scenery (only drawn when matching sprites are loaded).
        for (const d of this.level.decor ?? [])
            out.push({ kind: 'decor', x: d.x, y: d.y, heading: 'N', sprite: d.sprite, scale: d.scale });
        if (this.sim) {
            const s = this.sim;
            for (const w of s.free)
                out.push({ kind: 'wagon', x: w.x, y: w.y, heading: 'N', number: w.number });
            const lp = pos(s.loco.px, s.loco.py, s.loco.x, s.loco.y);
            const chain = [lp]; // front-to-back train positions
            for (const w of s.coupled) {
                const p = pos(w.px, w.py, w.x, w.y);
                chain.push(p);
                out.push({ kind: 'wagon', x: p.x, y: p.y, heading: 'N', number: w.number });
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
        }
        else {
            const L = this.level;
            for (const w of L.wagons ?? [])
                out.push({ kind: 'wagon', x: w.x, y: w.y, heading: 'N', number: w.number });
            for (const m of L.movers ?? [])
                out.push({ kind: 'mover', x: m.x, y: m.y, heading: m.heading });
            out.push({ kind: 'loco', x: L.locomotive.x, y: L.locomotive.y, heading: L.locomotive.heading });
        }
        return out;
    }
    startSim() {
        this.sim = new Simulation(this.grid, this.level, this.held);
        this.input.setEnabled(false);
        this.acc = 0;
        this.hideOutcome();
    }
    onSimEnded() {
        if (!this.sim)
            return;
        const won = this.sim.status === 'won';
        this.state = won ? 'won' : 'lost';
        if (won) {
            this.audio.play('win');
            this.renderer.spawnBurst(this.sim.loco.x, this.sim.loco.y, '#7ed09a', 22, this.now);
            navigator.vibrate?.([20, 40, 30]);
            if (this.onWin)
                this.onWin(this.level.id, this.sim.ticks);
        }
        else {
            this.audio.play('lose');
            navigator.vibrate?.(120);
        }
        this.showOutcome();
        this.updateControls();
    }
    /* ----------------------------- view ----------------------------- */
    resize() {
        this.renderer.resize(this.grid.cols, this.grid.rows);
    }
    onEdited() {
        this.updateHud();
    }
    updateHud() {
        this.hud.levelName.textContent = `${this.level.id} · ${this.level.name}`;
        const used = this.editor.budgetUsed();
        this.hud.budgetUsed.textContent = String(used);
        this.hud.budgetTotal.textContent = String(this.editor.budget);
        this.hud.budgetBox.classList.toggle('over', used >= this.editor.budget);
    }
    updateControls() {
        const editing = this.state === 'editing';
        const running = this.state === 'running';
        this.hud.btnUndo.disabled = !editing || !this.editor.canUndo();
        this.hud.btnRedo.disabled = !editing || !this.editor.canRedo();
        this.hud.btnPlay.textContent = running ? '⏸ Pause' : this.state === 'paused' ? '▶ Resume' : '▶ Play';
        this.hud.btnSpeed.textContent = `${this.speed}×`;
        this.updateHud();
    }
    toast(msg) {
        const t = this.hud.toast;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1700);
    }
    showOutcome() {
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
    hideOutcome() {
        this.hud.outcome.panel.classList.remove('show');
    }
    /* ----------------------------- actions ----------------------------- */
    undo() {
        if (this.state !== 'editing')
            return;
        this.editor.undo();
        this.updateControls();
    }
    redo() {
        if (this.state !== 'editing')
            return;
        this.editor.redo();
        this.updateControls();
    }
    /** Stop any running sim and return to editing (track preserved). */
    reset() {
        this.sim = null;
        this.state = 'editing';
        this.input.setEnabled(true);
        this.acc = 0;
        this.hideOutcome();
        this.updateControls();
    }
    play() {
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
    step() {
        if (this.state === 'editing')
            this.startSim();
        if (this.state === 'won' || this.state === 'lost')
            return;
        if (this.sim && this.sim.status === 'running') {
            this.sim.tick();
            this.afterTick();
            this.acc = 0;
            if (this.sim.status !== 'running')
                this.onSimEnded();
            else
                this.state = 'paused';
        }
        this.updateControls();
    }
    /** Mute / unmute all sound. */
    setMuted(muted) {
        this.audio.setEnabled(!muted);
    }
    cycleSpeed() {
        this.speed = this.speed === 1 ? 2 : 1;
        this.updateControls();
    }
    /* ----------------------------- boosters ----------------------------- */
    /** Reverse: undo all the way back to the level's starting state. */
    revertToStart() {
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
    grantTrack(n = 1) {
        this.editor.budget += n;
        this.updateHud();
        this.toast(`+${n} track piece`);
    }
    /** Boost: run Play at 2×. */
    boost() {
        this.speed = 2;
        this.updateControls();
        this.toast('Boost · 2× speed');
    }
    /** Hold: enter targeting to freeze one object (signal / gate / mover). The
     *  callback reports whether a freeze was actually applied (to spend the use). */
    beginHold(onResult) {
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
    cancelHoldTargeting() {
        if (!this.holdTargeting)
            return;
        this.holdTargeting = false;
        const cb = this.onHoldResult;
        this.onHoldResult = null;
        if (this.state === 'editing')
            this.input.setEnabled(true);
        cb?.(false);
    }
    /** Cells of objects that can be frozen: movers, signals, gates. */
    holdableCells() {
        const out = [];
        const movers = this.sim ? this.sim.movers.map((m, i) => ({ x: m.x, y: m.y, i })) : (this.level.movers ?? []).map((m, i) => ({ x: m.x, y: m.y, i }));
        for (const m of movers)
            out.push({ x: m.x, y: m.y, key: 'mover:' + m.i });
        for (const c of this.grid.cells) {
            if (c.type === 'signal')
                out.push({ x: c.x, y: c.y, key: 'sig:' + this.grid.idx(c.x, c.y) });
            else if (c.type === 'gate' && c.color)
                out.push({ x: c.x, y: c.y, key: 'gate:' + c.color });
        }
        return out;
    }
    /** Current cells of frozen objects (for the ❄ markers). */
    frozenCells() {
        const out = [];
        for (const key of this.held) {
            if (key.startsWith('mover:')) {
                const i = Number(key.slice(6));
                const m = this.sim ? this.sim.movers[i] : (this.level.movers ?? [])[i];
                if (m)
                    out.push({ x: m.x, y: m.y });
            }
            else if (key.startsWith('sig:')) {
                const idx = Number(key.slice(4));
                const c = this.grid.cells[idx];
                if (c)
                    out.push({ x: c.x, y: c.y });
            }
            else if (key.startsWith('gate:')) {
                const color = key.slice(5);
                for (const c of this.grid.cells)
                    if (c.type === 'gate' && c.color === color)
                        out.push({ x: c.x, y: c.y });
            }
        }
        return out;
    }
    replay() {
        this.startSim();
        this.state = 'running';
        this.updateControls();
    }
    next() {
        if (this.hasNext())
            this.loadIndex(this.levelIndex + 1);
    }
    /** Release observers/listeners (no destruction path yet, but ready for it). */
    dispose() {
        this.resizeObserver.disconnect();
    }
}
//# sourceMappingURL=game.js.map