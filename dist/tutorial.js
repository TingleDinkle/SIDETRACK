/**
 * Tutorial controller + step-target resolution.
 *
 * A tutorial is an ordered list of steps; each step names WHAT to spotlight by
 * selector (a tile type, an entity kind, or explicit cells), resolved against
 * the live grid/level so it survives coordinate edits. Pure logic, no DOM — the
 * Game drives it and the Renderer draws the cells it returns.
 */
/** Resolve a step's target to the list of board cells it highlights. */
export function resolveTarget(target, grid, level) {
    if ('cells' in target)
        return target.cells.map((c) => ({ x: c.x, y: c.y }));
    if ('entity' in target) {
        const src = target.entity === 'wagon' ? (level.wagons ?? []) : (level.movers ?? []);
        return src.map((e) => ({ x: e.x, y: e.y }));
    }
    return grid.cells.filter((c) => c.type === target.tile).map((c) => ({ x: c.x, y: c.y }));
}
export class Tutorial {
    constructor() {
        this.script = null;
        this.grid = null;
        this.level = null;
        this.step = 0;
        this.cached = [];
    }
    /** Begin a script over a level. Resolves the first step's cells immediately. */
    start(script, grid, level) {
        this.script = script;
        this.grid = grid;
        this.level = level;
        this.step = 0;
        this.resolve();
    }
    active() {
        return this.script !== null;
    }
    /** Advance to the next step. Returns false (and auto-ends) when none remain. */
    next() {
        if (!this.script)
            return false;
        if (this.step + 1 >= this.script.steps.length) {
            this.end();
            return false;
        }
        this.step++;
        this.resolve();
        return true;
    }
    end() {
        this.script = null;
        this.grid = null;
        this.level = null;
        this.step = 0;
        this.cached = [];
    }
    cells() {
        return this.cached;
    }
    text() {
        return this.script ? this.script.steps[this.step].text : '';
    }
    /** 1-based current step and total, for the caption dots/label. */
    stepInfo() {
        return { index: this.step + 1, total: this.script ? this.script.steps.length : 0 };
    }
    isLast() {
        return !this.script || this.step + 1 >= this.script.steps.length;
    }
    resolve() {
        if (!this.script || !this.grid || !this.level) {
            this.cached = [];
            return;
        }
        this.cached = resolveTarget(this.script.steps[this.step].target, this.grid, this.level);
    }
}
//# sourceMappingURL=tutorial.js.map