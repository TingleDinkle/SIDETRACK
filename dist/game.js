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
            requestAnimationFrame(this.loop);
        };
        this.levels = levels;
        this.levelIndex = startIndex;
        this.applyLevel(this.levels[startIndex]);
        this.input = new InputController(canvas, renderer, this.editor, () => this.onEdited());
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
        this.renderer.setTheme(typeof level.world === 'number' ? level.world : 1);
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
            for (const w of s.coupled) {
                const p = pos(w.px, w.py, w.x, w.y);
                out.push({ kind: 'wagon', x: p.x, y: p.y, heading: 'N', number: w.number });
            }
            for (const m of s.movers) {
                const p = pos(m.px, m.py, m.x, m.y);
                out.push({ kind: 'mover', x: p.x, y: p.y, heading: m.heading });
            }
            const lp = pos(s.loco.px, s.loco.py, s.loco.x, s.loco.y);
            out.push({ kind: 'loco', x: lp.x, y: lp.y, heading: s.loco.heading });
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
        this.sim = new Simulation(this.grid, this.level);
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