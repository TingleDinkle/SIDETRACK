/**
 * Deterministic tick simulation — the heart of Sidetrack.
 *
 * Pure logic, no DOM, fully unit-testable in Node. The Game drives it one
 * `tick()` per step and reads positions for rendering between ticks.
 *
 * THE TRAIN AS A TRAIL.
 * The loco leaves a breadcrumb trail of the cells it has occupied. Coupled
 * wagon `i` always sits on `trail[i]`. Advancing the train is just:
 *     trail = [newLocoCell, ...trail]            // then drop the tail on a normal move
 * A normal move drops the last entry (length stays); a coupling keeps it (the
 * train grows by one). This single rule reproduces the snake *and* threads the
 * whole train cleanly through tunnels (the teleport is baked into the trail),
 * which a "follow the vacated cell" model can't do without special cases.
 *
 * Tick order (per the spec):
 *   1) Intent     — each independent unit (loco, movers) computes its target via
 *                   the track exit edge; tunnels are resolved here so collision
 *                   and the trail use the real destination.
 *   2) Blocking    — a closed gate or closed signal makes a unit wait.
 *   3) Collision   — two units onto one cell, or an independent-unit swap, = FAIL.
 *   4) Move        — advance the trail and the movers.
 *   5) Enter-fx    — coupling, buttons (toggle gates), switches (flip junctions),
 *                    alternating-junction pass-flip.
 *   6) Win / lose  — loco on exit with all wagons coupled = WIN; incomplete = FAIL.
 */
import { DELTA, OPPOSITE, edgeList, hasEdge } from './types.js';
import { classify, exitEdge } from './track.js';
export class Simulation {
    constructor(grid, level, held = new Set()) {
        /** Coupled wagons, chain order: index 0 directly behind the loco. */
        this.coupled = [];
        this.free = [];
        this.movers = [];
        this.status = 'running';
        this.failReason = '';
        this.ticks = 0;
        this.nextNeeded = 1;
        this.requiredCount = 0;
        /** Notable things that happened during the most recent tick (for sfx / fx). */
        this.events = [];
        this.junctionActive = new Map();
        this.gateOpen = new Map();
        this.signalOpen = new Map();
        this.grid = grid;
        this.held = held;
        const L = level.locomotive;
        this.loco = { x: L.x, y: L.y, px: L.x, py: L.y, heading: L.heading };
        this.trail = [{ x: L.x, y: L.y }];
        this.free = (level.wagons ?? []).map((w) => ({ number: w.number, x: w.x, y: w.y, px: w.x, py: w.y, coupled: false }));
        this.requiredCount = this.free.length;
        this.movers = (level.movers ?? []).map((m) => ({ x: m.x, y: m.y, px: m.x, py: m.y, heading: m.heading, alive: true }));
        this.maxTicks = grid.cols * grid.rows * 8 + 100;
        // Initialise switch/gate/signal state from the static tiles.
        for (const c of grid.cells) {
            if (c.type === 'gate' && c.color)
                this.gateOpen.set(c.color, c.open ?? false);
            if (c.type === 'signal')
                this.signalOpen.set(grid.idx(c.x, c.y), c.open ?? true);
        }
    }
    /* ----------------------------- helpers ----------------------------- */
    fail(reason) {
        this.status = 'lost';
        this.failReason = reason;
    }
    exitFor(x, y, heading) {
        const c = this.grid.get(x, y);
        if (!c)
            return null;
        if (c.type === 'start' || c.type === 'tunnel')
            return heading; // launch / emerge in facing direction
        return exitEdge(c.mask, OPPOSITE[heading], this.junctionActive.get(this.grid.idx(x, y)) ?? 0);
    }
    canEnter(x, y, dir) {
        const c = this.grid.get(x, y);
        if (!c)
            return false;
        if (c.type === 'rock')
            return false;
        return hasEdge(c.mask, OPPOSITE[dir]);
    }
    /** A closed gate or closed signal holds an entering unit. */
    isBlocked(x, y) {
        const c = this.grid.get(x, y);
        if (!c)
            return false;
        if (c.type === 'gate')
            return !(this.gateOpen.get(c.color ?? '') ?? false);
        if (c.type === 'signal')
            return !(this.signalOpen.get(this.grid.idx(x, y)) ?? true);
        return false;
    }
    /** If (x,y) is a tunnel, the destination + emerge heading at its pair. */
    teleport(x, y) {
        const c = this.grid.get(x, y);
        if (!c || c.type !== 'tunnel')
            return null;
        const pair = this.grid.cells.find((o) => o !== c && o.type === 'tunnel' && o.pairId === c.pairId);
        if (!pair)
            return null;
        const mouth = edgeList(pair.mask)[0];
        if (!mouth)
            return null;
        return { x: pair.x, y: pair.y, heading: mouth };
    }
    freeWagonAt(x, y) {
        return this.free.find((w) => w.x === x && w.y === y) ?? null;
    }
    isJunction(x, y) {
        const c = this.grid.get(x, y);
        return !!c && classify(c.mask) === 'junction';
    }
    /** Compute the intent of one independent unit (loco or mover). */
    intentFor(x, y, heading) {
        const dir = this.exitFor(x, y, heading);
        if (dir === null)
            return { kind: 'derail' };
        const rawX = x + DELTA[dir].dx;
        const rawY = y + DELTA[dir].dy;
        if (!this.canEnter(rawX, rawY, dir))
            return { kind: 'derail' };
        if (this.isBlocked(rawX, rawY))
            return { kind: 'wait' };
        const tp = this.teleport(rawX, rawY);
        return {
            kind: 'move',
            rawX,
            rawY,
            x: tp ? tp.x : rawX,
            y: tp ? tp.y : rawY,
            heading: tp ? tp.heading : dir,
            fromX: x,
            fromY: y,
        };
    }
    applyEnterEffects(cell) {
        if (cell.type === 'button') {
            if (cell.color) {
                // Small button: toggle its own link-colour gate (held colour ignores it).
                if (!this.held.has('gate:' + cell.color))
                    this.gateOpen.set(cell.color, !(this.gateOpen.get(cell.color) ?? false));
            }
            else {
                // Master button (no colour): open every gate at once (skip held colours).
                for (const g of this.grid.cells) {
                    if (g.type === 'gate' && g.color && !this.held.has('gate:' + g.color))
                        this.gateOpen.set(g.color, true);
                }
            }
            this.events.push('button');
        }
        else if (cell.type === 'switch' && cell.color) {
            for (const c of this.grid.cells) {
                if (c.color === cell.color && classify(c.mask) === 'junction') {
                    const i = this.grid.idx(c.x, c.y);
                    this.junctionActive.set(i, ((this.junctionActive.get(i) ?? 0) + 1) % 2);
                }
            }
        }
    }
    /* ----------------------------- the tick ----------------------------- */
    tick() {
        if (this.status !== 'running')
            return;
        if (this.ticks >= this.maxTicks)
            return this.fail('out of time');
        this.events = [];
        // Snapshot positions for interpolation.
        this.loco.px = this.loco.x;
        this.loco.py = this.loco.y;
        for (const w of this.coupled) {
            w.px = w.x;
            w.py = w.y;
        }
        for (const m of this.movers) {
            m.px = m.x;
            m.py = m.y;
        }
        const flips = new Set(); // alternating junctions a unit leaves this tick
        /* --- STEP 1+2: intents --- */
        const locoIntent = this.intentFor(this.loco.x, this.loco.y, this.loco.heading);
        if (locoIntent.kind === 'derail')
            return this.fail('derailed');
        const locoMoves = locoIntent.kind === 'move';
        const moverIntents = this.movers.map((m, j) => m.alive && !this.held.has('mover:' + j) ? this.intentFor(m.x, m.y, m.heading) : { kind: 'wait' });
        /* --- coupling decision (only when the loco actually moves) --- */
        let coupling = null;
        if (locoMoves) {
            const fw = this.freeWagonAt(locoIntent.rawX, locoIntent.rawY);
            if (fw) {
                if (fw.number === this.nextNeeded)
                    coupling = fw;
                else
                    return this.fail(`wagon ${fw.number} coupled out of order`);
            }
            if (this.isJunction(this.loco.x, this.loco.y))
                flips.add(this.grid.idx(this.loco.x, this.loco.y));
        }
        /* --- planned train trail --- */
        let trainNew;
        if (!locoMoves) {
            trainNew = this.trail.map((c) => ({ ...c })); // hold
        }
        else if (coupling) {
            trainNew = [{ x: locoIntent.x, y: locoIntent.y }, ...this.trail.map((c) => ({ ...c }))]; // grow
        }
        else {
            trainNew = [{ x: locoIntent.x, y: locoIntent.y }, ...this.trail.slice(0, this.coupled.length).map((c) => ({ ...c }))];
        }
        /* --- planned mover positions --- */
        const moverNew = this.movers.map((m, j) => {
            const it = moverIntents[j];
            if (it.kind === 'move') {
                if (this.isJunction(m.x, m.y))
                    flips.add(this.grid.idx(m.x, m.y));
                return { x: it.x, y: it.y, heading: it.heading, alive: true, moved: true };
            }
            const dead = it.kind === 'derail';
            return { x: m.x, y: m.y, heading: m.heading, alive: m.alive && !dead, moved: false };
        });
        /* --- STEP 3: collision --- */
        const finals = [];
        for (const p of trainNew)
            finals.push(p);
        for (const w of this.free)
            if (w !== coupling)
                finals.push({ x: w.x, y: w.y });
        for (const p of moverNew)
            finals.push({ x: p.x, y: p.y });
        const seen = new Set();
        for (const f of finals) {
            const key = f.x + ',' + f.y;
            if (seen.has(key))
                return this.fail('collision');
            seen.add(key);
        }
        // Swap detection among independent units (loco + movers); train-internal is safe.
        const indep = [
            { ox: this.loco.x, oy: this.loco.y, nx: trainNew[0].x, ny: trainNew[0].y },
            ...this.movers.map((m, j) => ({ ox: m.x, oy: m.y, nx: moverNew[j].x, ny: moverNew[j].y })),
        ];
        for (let a = 0; a < indep.length; a++) {
            for (let b = a + 1; b < indep.length; b++) {
                const A = indep[a];
                const B = indep[b];
                if (A.nx === B.ox && A.ny === B.oy && B.nx === A.ox && B.ny === A.oy)
                    return this.fail('collision');
            }
        }
        /* --- STEP 4: apply move --- */
        const enteredCells = [];
        if (locoMoves && locoIntent.kind === 'move')
            this.loco.heading = locoIntent.heading;
        if (coupling) {
            coupling.coupled = true;
            coupling.px = locoIntent.kind === 'move' ? locoIntent.rawX : coupling.x;
            coupling.py = locoIntent.kind === 'move' ? locoIntent.rawY : coupling.y;
            this.free = this.free.filter((w) => w !== coupling);
            this.coupled.unshift(coupling);
            this.nextNeeded++;
            this.events.push('couple');
        }
        this.trail = trainNew;
        this.loco.x = trainNew[0].x;
        this.loco.y = trainNew[0].y;
        for (let i = 0; i < this.coupled.length; i++) {
            this.coupled[i].x = trainNew[i + 1].x;
            this.coupled[i].y = trainNew[i + 1].y;
        }
        // Collect entered cells, guarding against off-grid coords from a malformed level.
        const pushCell = (x, y) => {
            const c = this.grid.get(x, y);
            if (c)
                enteredCells.push(c);
        };
        if (locoMoves)
            pushCell(this.loco.x, this.loco.y);
        // Coupled wagons that moved trigger pass-over effects too (in chain order).
        for (const w of this.coupled)
            if (w.x !== w.px || w.y !== w.py)
                pushCell(w.x, w.y);
        for (let j = 0; j < this.movers.length; j++) {
            const p = moverNew[j];
            this.movers[j].x = p.x;
            this.movers[j].y = p.y;
            this.movers[j].heading = p.heading;
            this.movers[j].alive = p.alive;
            if (p.moved)
                pushCell(p.x, p.y);
        }
        /* --- STEP 5: enter-effects (buttons/switches), then junction pass-flips --- */
        for (const c of enteredCells)
            this.applyEnterEffects(c);
        for (const idx of flips)
            this.junctionActive.set(idx, ((this.junctionActive.get(idx) ?? 0) + 1) % 2);
        // Signals advance their phase every tick (unless held/frozen).
        for (const [idx, open] of this.signalOpen)
            if (!this.held.has('sig:' + idx))
                this.signalOpen.set(idx, !open);
        this.ticks++;
        /* --- STEP 6: win / lose --- */
        const here = this.grid.get(this.loco.x, this.loco.y);
        if (here && here.type === 'exit') {
            if (this.coupled.length === this.requiredCount)
                this.status = 'won';
            else
                this.fail('reached exit without all wagons');
        }
    }
    /* ----------------------------- introspection (for rendering) ----------------------------- */
    /** Active branch index for an alternating junction (for the UI indicator). */
    junctionBranch(idx) {
        return this.junctionActive.get(idx) ?? 0;
    }
    gateIsOpen(color) {
        return this.gateOpen.get(color) ?? false;
    }
    signalIsOpen(idx) {
        return this.signalOpen.get(idx) ?? true;
    }
}
//# sourceMappingURL=sim.js.map