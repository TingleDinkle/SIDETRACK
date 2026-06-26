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
import { linkColor } from './render.js';
import { Simulation } from './sim.js';
import { Tutorial } from './tutorial.js';
import { TUTORIALS } from './tutorialData.js';
import { DELTA } from './types.js';
import { easeFrac, idleBreath } from './feel/motion.js';
import { tracePath } from './feel/pathpreview.js';
const TICK_BASE_MS = 360; // 1× tick interval
const lerp = (a, b, t) => a + (b - a) * t;
export class Game {
    constructor(canvas, renderer, hud, audio, levels, startIndex = 0) {
        this.renderer = renderer;
        this.hud = hud;
        this.audio = audio;
        this.state = 'editing';
        this.sim = null;
        this.tutorial = new Tutorial();
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
        this.finishing = false; // playing out the final move (win) before the panel
        this.settling = false; // final move eases to a stop instead of cruising
        this.locoRoll = 0; // current cosmetic lean (radians), decays each frame
        this.ambientStarted = false; // start the mine-ambience bed once, after a gesture
        this.loop = (now) => {
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
                    if (s.status !== 'running')
                        this.beginFinish();
                }
                else if (this.finishing) {
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
            if (this.held.size)
                this.renderer.markFrozen(this.frozenCells());
            if (this.holdTargeting)
                this.renderer.drawHoldOverlay(this.holdableCells());
            if (this.tutorial.active())
                this.renderer.drawTutorialSpotlight(this.tutorial.cells(), now);
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
                cb?.('freeze'); // spend the use
            }
            else if (hit) {
                this.held.delete(hit.key); // tapping a frozen object un-freezes it
                this.toast('Un-frozen');
                cb?.('unfreeze'); // refund the use
            }
            else {
                this.toast('Cancelled');
                cb?.('cancel');
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
        // Tactile editing feedback: a soft click as each rail goes down, a duller
        // click + a dust poof as one is erased.
        this.editor.onLay = () => this.audio.play('lay');
        this.editor.onErase = (x, y) => {
            this.audio.play('erase');
            this.renderer.spawnPoof(x, y, this.now);
        };
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
    setLevels(levels) {
        this.levels = levels;
        if (this.levelIndex >= levels.length)
            this.levelIndex = Math.max(0, levels.length - 1);
    }
    loadLevel(level) {
        const i = this.levels.indexOf(level);
        if (i >= 0)
            this.levelIndex = i;
        this.tutorial.end(); // drop any tutorial carried from the previous level
        this.applyLevel(level);
        this.input.setEditor(this.editor);
        this.input.setEnabled(true);
        this.resize();
        this.hideOutcome();
        this.updateHud();
        this.startTutorialIfAny(); // may disable input + show the caption card
        this.updateControls();
    }
    /* ----------------------------- tutorial ----------------------------- */
    tutorialActive() {
        return this.tutorial.active();
    }
    hasTutorial() {
        return !!TUTORIALS[this.level.id];
    }
    /** If the current level has a script, start it; otherwise ensure the card is hidden. */
    startTutorialIfAny() {
        const script = TUTORIALS[this.level.id];
        if (!script) {
            this.hud.tutorial.panel.classList.remove('show');
            this.renderer.setReservedBottom(0); // no caption → board gets the full stage
            return;
        }
        this.tutorial.start(script, this.grid, this.level);
        this.input.setEnabled(false);
        this.renderTutorialHud();
    }
    /** Push the active step's text / dots / button label into the caption card. */
    renderTutorialHud() {
        const o = this.hud.tutorial;
        if (!this.tutorial.active()) {
            o.panel.classList.remove('show');
            return;
        }
        const { index, total } = this.tutorial.stepInfo();
        o.text.textContent = this.tutorial.text();
        o.dots.textContent = Array.from({ length: total }, (_, i) => (i + 1 === index ? '●' : '○')).join(' ');
        o.btnNext.textContent = this.tutorial.isLast() ? 'Got it ▶' : 'Next ▶';
        o.btnSkip.style.display = total > 1 ? '' : 'none'; // a single-step tutorial only needs "Got it"
        // Single-step caption: no Skip and a lone dot, so centre the big "Got it" button.
        o.panel.classList.toggle('single', total === 1);
        o.panel.classList.add('show');
        this.reserveForCaption();
    }
    /** On a small screen, reserve the caption's height so the board re-lays ABOVE it
     *  (otherwise a tall card swallows the board and hides the spotlit object). */
    reserveForCaption() {
        const o = this.hud.tutorial;
        if (!this.tutorial.active()) {
            this.renderer.setReservedBottom(0);
            return;
        }
        const L = this.renderer.layout;
        const small = L.cssW < 560 || L.cssH < 480; // phone-ish (portrait or short landscape)
        const card = o.panel.firstElementChild;
        const cardH = card ? card.offsetHeight : 0;
        this.renderer.setReservedBottom(small && cardH ? cardH + 24 : 0);
    }
    /** Advance one step, or finish (and resume normal play) on the last step. */
    tutorialNext() {
        if (!this.tutorial.active())
            return;
        if (this.tutorial.next())
            this.renderTutorialHud();
        else
            this.endTutorial();
    }
    /** Dismiss the whole tutorial. */
    tutorialSkip() {
        if (this.tutorial.active())
            this.endTutorial();
    }
    endTutorial() {
        this.tutorial.end();
        this.hud.tutorial.panel.classList.remove('show');
        this.renderer.setReservedBottom(0); // give the board the full stage back
        if (this.state === 'editing')
            this.input.setEnabled(true);
        this.updateControls();
    }
    /** Replay the current level's tutorial from the `?` button. */
    replayTutorial() {
        if (this.state !== 'editing')
            this.reset();
        this.startTutorialIfAny();
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
                this.renderer.kick(0.12); // a little jolt as the wagon snaps on
                this.buzz(20);
            }
            else if (ev === 'button') {
                this.audio.play('button');
                this.reactButtons();
            }
            else if (ev === 'switch') {
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
            }
            else {
                this.renderer.spawnSmoke(s.loco.x, s.loco.y, this.now);
            }
        }
    }
    /** A button was stepped on: pulse the link to each gate it controls, flash the
     *  gate, kick up dust, and clunk. (Derives the buttons hit from unit positions.) */
    reactButtons() {
        const s = this.sim;
        if (!s)
            return;
        const units = [{ x: s.loco.x, y: s.loco.y }, ...s.movers.map((m) => ({ x: m.x, y: m.y }))];
        let reacted = false;
        for (const u of units) {
            const cell = this.grid.get(u.x, u.y);
            if (!cell || cell.type !== 'button')
                continue;
            const master = !cell.color;
            const col = master ? '#f3e1b0' : linkColor(cell.color);
            for (const g of this.grid.cells) {
                if (g.type !== 'gate')
                    continue;
                if (!master && g.color !== cell.color)
                    continue;
                this.renderer.fxLink(u.x, u.y, g.x, g.y, col, this.now);
                this.renderer.fxRing(g.x, g.y, col, this.now);
                this.renderer.spawnBurst(g.x, g.y, 'rgba(150,140,130,0.8)', 5, this.now); // dust
                reacted = true;
            }
        }
        if (reacted)
            this.audio.play('gate');
    }
    /** A switch was thrown: ring it and ka-chak. (The junction chevron already flips.) */
    reactSwitches() {
        const s = this.sim;
        if (!s)
            return;
        const units = [{ x: s.loco.x, y: s.loco.y }, ...s.movers.map((m) => ({ x: m.x, y: m.y }))];
        let reacted = false;
        for (const u of units) {
            const cell = this.grid.get(u.x, u.y);
            if (cell && cell.type === 'switch' && cell.color) {
                this.renderer.fxRing(u.x, u.y, linkColor(cell.color), this.now);
                reacted = true;
            }
        }
        if (reacted)
            this.audio.play('switch');
    }
    /** Any unit that jumped more than a cell this tick teleported — whoosh both mouths. */
    reactTeleports() {
        const s = this.sim;
        if (!s)
            return;
        const units = [s.loco, ...s.movers];
        let teleported = false;
        for (const u of units) {
            if (Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 1.5) {
                this.renderer.fxWhoosh(u.px, u.py, '#9a6fc0', this.now);
                this.renderer.fxWhoosh(u.x, u.y, '#9a6fc0', this.now);
                teleported = true;
            }
        }
        if (teleported)
            this.audio.play('teleport');
    }
    /** Fire a vibration unless the player disabled haptics in Settings. */
    buzz(pattern) {
        try {
            if (localStorage.getItem('sidetrack.haptics') !== '0')
                navigator.vibrate?.(pattern);
        }
        catch {
            /* storage/vibrate unavailable */
        }
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
        // Constant-speed cruise, easing only out of rest (launch) and into the stop
        // (settle) — so a multi-cell run rolls smoothly instead of pulsing per cell.
        const phase = this.settling ? 'settle' : this.sim && this.sim.ticks <= 1 ? 'launch' : 'cruise';
        const frac = easeFrac(rawFrac, phase);
        // Lerp between ticks, but snap across teleports (a jump of >1 cell).
        const pos = (px, py, x, y) => Math.abs(x - px) + Math.abs(y - py) > 1.5 ? { x, y } : { x: lerp(px, x, frac), y: lerp(py, y, frac) };
        const out = [];
        // Cosmetic scenery (only drawn when matching sprites are loaded).
        for (const d of this.level.decor ?? [])
            out.push({ kind: 'decor', x: d.x, y: d.y, heading: 'N', sprite: d.sprite, scale: d.scale });
        // Facing from a discrete cell delta (cosmetic wagon orientation).
        const dirOf = (dx, dy, fb) => dx === 0 && dy === 0 ? fb : Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
        if (this.sim) {
            const s = this.sim;
            // Cosmetic life: a chug-bob (≈one bob per tick) while rolling, otherwise a
            // slow idle "breath" so a stopped/parked train still feels alive.
            const cruising = this.state === 'running' && s.status === 'running';
            const bob = cruising ? Math.sin(this.now * 0.017) * 0.022 : idleBreath(this.now);
            this.updateLocoRoll(cruising ? s.loco.heading : undefined);
            for (const w of s.free)
                out.push({ kind: 'wagon', x: w.x, y: w.y + idleBreath(this.now, 0.6), heading: w.heading, number: w.number });
            const lp = pos(s.loco.px, s.loco.py, s.loco.x, s.loco.y);
            lp.y += bob;
            const chain = [lp]; // front-to-back train positions
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
        }
        else {
            const L = this.level;
            const br = idleBreath(this.now);
            for (const w of L.wagons ?? [])
                out.push({ kind: 'wagon', x: w.x, y: w.y + br * 0.6, heading: w.heading ?? 'E', number: w.number });
            for (const m of L.movers ?? [])
                out.push({ kind: 'mover', x: m.x, y: m.y, heading: m.heading });
            out.push({ kind: 'loco', x: L.locomotive.x, y: L.locomotive.y + br, heading: L.locomotive.heading });
        }
        return out;
    }
    startSim() {
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
    beginFinish() {
        if (this.sim?.status === 'won') {
            this.finishing = true;
            this.settling = true;
            this.acc = 0; // restart the inter-tick clock for the final glide
            this.audio.play('arrive');
        }
        else {
            this.finalize();
        }
    }
    /** Resolve a finished sim immediately (used when stepping, and on derail). */
    finalize() {
        if (this.sim?.status === 'lost')
            this.onCrash();
        this.onSimEnded();
    }
    /** Visceral derail feedback: impact sound, debris burst, a hard screen kick. */
    onCrash() {
        const s = this.sim;
        if (!s)
            return;
        this.audio.play('crash');
        this.renderer.spawnDebris(s.loco.x, s.loco.y, this.now);
        this.renderer.kick(0.9);
        this.buzz(120);
    }
    onSimEnded() {
        if (!this.sim)
            return;
        const won = this.sim.status === 'won';
        this.state = won ? 'won' : 'lost';
        if (won) {
            this.audio.play('win');
            this.audio.play('whistle');
            // Celebrate at the goal (fall back to the loco if the exit isn't found).
            const goal = this.grid.cells.find((c) => c.type === 'exit') ?? this.sim.loco;
            this.renderer.celebrate(goal.x, goal.y, this.now);
            this.renderer.spawnBurst(this.sim.loco.x, this.sim.loco.y, '#7ed09a', 22, this.now);
            this.renderer.kick(0.3);
            this.buzz([20, 40, 30]);
            if (this.onWin)
                this.onWin(this.level.id, this.sim.ticks);
        }
        this.showOutcome();
        this.updateControls();
    }
    /** Where the train will roll given the current track (editing-only telegraph),
     *  plus whether it reaches the goal and where it would grab wagons. */
    previewPath() {
        if (this.state !== 'editing')
            return undefined;
        const wagons = (this.level.wagons ?? []).map((w) => ({ x: w.x, y: w.y }));
        return tracePath(this.grid, this.level.locomotive, wagons);
    }
    /** Lean-into-curves: set a brief tilt impulse when the loco changes heading,
     *  decaying each frame. Pass undefined when not rolling to clear it. */
    updateLocoRoll(heading) {
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
    resize() {
        this.renderer.resize(this.grid.cols, this.grid.rows);
        if (this.tutorial.active())
            this.reserveForCaption(); // re-fit on rotate / resize
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
        const tut = this.tutorial.active();
        this.hud.btnUndo.disabled = !editing || tut || !this.editor.canUndo();
        this.hud.btnRedo.disabled = !editing || tut || !this.editor.canRedo();
        this.hud.btnPlay.textContent = running ? '⏸ Pause' : this.state === 'paused' ? '▶ Resume' : '▶ Play';
        this.hud.btnPlay.disabled = tut; // can't run the sim mid-tutorial
        this.hud.btnStep.disabled = tut;
        this.hud.btnSpeed.textContent = `${this.speed}×`;
        this.hud.btnHelp.classList.toggle('show', this.hasTutorial() && !tut);
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
        this.finishing = false;
        this.settling = false;
        this.hideOutcome();
        this.updateControls();
    }
    play() {
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
                this.finalize();
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
    grantTrack(n = 1) {
        this.editor.budget += n;
        this.updateHud();
        this.toast(`+${n} track piece`);
    }
    /** Boost: run Play at 2×. Returns false if already boosted (so no use is spent). */
    boost() {
        if (this.speed === 2)
            return false;
        this.speed = 2;
        this.updateControls();
        this.toast('Boost · 2× speed');
        return true;
    }
    /** Hold: enter targeting to freeze one object (signal / gate / mover). The
     *  callback reports freeze (spend a use) / unfreeze (refund) / cancel (no change). */
    beginHold(onResult) {
        if (this.holdTargeting) {
            onResult('cancel');
            return;
        }
        if (!this.holdableCells().length) {
            this.toast('Nothing to hold on this level');
            onResult('cancel');
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
        cb?.('cancel');
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