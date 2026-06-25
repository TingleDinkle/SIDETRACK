/**
 * Track editor: drag-to-lay, tap-to-erase, budget accounting, undo/redo.
 *
 * The editor only ever mutates the `mask` of **non-fixed** cells. Track shapes
 * are not stored — they fall out of the mask (see track.ts). Fixed tiles
 * (start / exit / rocks / pre-laid track) are never modified; the player simply
 * connects their own track up against them.
 *
 * Budget rule: each non-fixed cell that holds track costs exactly 1, regardless
 * of its shape. Laying that turns an empty cell into track spends 1; extending
 * an existing track cell (e.g. straight → junction) is free; erasing refunds.
 *
 * Undo/redo work at the granularity of a *stroke* (one pointer gesture). Call
 * `beginStroke()` on pointer-down and `endStroke()` on pointer-up; no-op strokes
 * are discarded so the undo history stays meaningful.
 */
import { OPPOSITE, addEdge, edgeList, headingBetween, removeEdge } from './types.js';
/** Tile types a laid track edge may point into (a unit can travel onto these). */
function isConnectableFixed(cell) {
    switch (cell.type) {
        case 'track':
        case 'start':
        case 'exit':
        case 'tunnel':
        case 'gate':
        case 'signal':
        case 'platform':
        case 'button':
        case 'switch':
            return true;
        default:
            return false; // 'empty', 'rock'
    }
}
export class Editor {
    constructor(grid, budget) {
        /** Cosmetic hooks (sound / particles). Fired on a real change to one cell;
         *  set by the Game. Kept out of the edit logic so the editor stays pure. */
        this.onLay = null;
        this.onErase = null;
        this.undoStack = [];
        this.redoStack = [];
        this.strokeOpen = false;
        this.strokeDirty = false;
        this.grid = grid;
        this.budget = budget;
    }
    /* --------------------------- budget --------------------------- */
    /** How many player-placed track cells are currently on the board. */
    budgetUsed() {
        let n = 0;
        for (const c of this.grid.cells)
            if (!c.fixed && c.mask !== 0)
                n++;
        return n;
    }
    budgetLeft() {
        return this.budget - this.budgetUsed();
    }
    /* --------------------------- undo/redo --------------------------- */
    snapshot() {
        return this.grid.cells.map((c) => c.mask);
    }
    restore(masks) {
        for (let i = 0; i < this.grid.cells.length; i++) {
            const c = this.grid.cells[i];
            if (c.fixed)
                continue;
            c.mask = masks[i] ?? 0;
            c.type = c.mask ? 'track' : 'empty';
        }
    }
    beginStroke() {
        if (this.strokeOpen)
            return;
        this.undoStack.push(this.snapshot());
        this.redoStack.length = 0;
        this.strokeOpen = true;
        this.strokeDirty = false;
    }
    endStroke() {
        if (!this.strokeOpen)
            return;
        if (!this.strokeDirty)
            this.undoStack.pop(); // drop a stroke that changed nothing
        this.strokeOpen = false;
    }
    canUndo() {
        return this.undoStack.length > 0;
    }
    canRedo() {
        return this.redoStack.length > 0;
    }
    undo() {
        if (!this.undoStack.length)
            return;
        this.redoStack.push(this.snapshot());
        this.restore(this.undoStack.pop());
    }
    redo() {
        if (!this.redoStack.length)
            return;
        this.undoStack.push(this.snapshot());
        this.restore(this.redoStack.pop());
    }
    /* --------------------------- editing --------------------------- */
    normalize(c) {
        if (c.fixed)
            return;
        c.type = c.mask ? 'track' : 'empty';
    }
    /**
     * Lay a connection between two orthogonally-adjacent cells. Returns true if
     * the board changed. Honours the budget: the step is rejected outright if it
     * would push the used count over budget.
     */
    layStep(ax, ay, bx, by) {
        const h = headingBetween(ax, ay, bx, by);
        if (!h)
            return false; // not adjacent
        const a = this.grid.get(ax, ay);
        const b = this.grid.get(bx, by);
        if (!a || !b)
            return false;
        const aEditable = !a.fixed && (a.type === 'empty' || a.type === 'track');
        const bEditable = !b.fixed && (b.type === 'empty' || b.type === 'track');
        const aOk = aEditable || (a.fixed && isConnectableFixed(a));
        const bOk = bEditable || (b.fixed && isConnectableFixed(b));
        if (!aOk || !bOk)
            return false; // rock / empty-fixed / off-grid on a side
        if (!aEditable && !bEditable)
            return false; // nothing editable → no change possible
        // Cost = editable sides going from empty → track this step.
        let cost = 0;
        if (aEditable && a.mask === 0)
            cost++;
        if (bEditable && b.mask === 0)
            cost++;
        if (this.budgetUsed() + cost > this.budget)
            return false;
        let changed = false;
        if (aEditable) {
            const before = a.mask;
            a.mask = addEdge(a.mask, h);
            if (a.mask !== before) {
                this.normalize(a);
                changed = true;
            }
        }
        if (bEditable) {
            const before = b.mask;
            b.mask = addEdge(b.mask, OPPOSITE[h]);
            if (b.mask !== before) {
                this.normalize(b);
                changed = true;
            }
        }
        if (changed) {
            this.strokeDirty = true;
            this.onLay?.(bx, by);
        }
        return changed;
    }
    /** Erase a player-placed track cell, pruning dangling edges on neighbours. */
    eraseAt(x, y) {
        const c = this.grid.get(x, y);
        if (!c || c.fixed || c.mask === 0)
            return false;
        const edges = edgeList(c.mask);
        c.mask = 0;
        this.normalize(c);
        for (const h of edges) {
            const nb = this.grid.neighbor(x, y, h);
            if (nb && !nb.fixed && nb.mask !== 0) {
                nb.mask = removeEdge(nb.mask, OPPOSITE[h]);
                this.normalize(nb);
            }
        }
        this.strokeDirty = true;
        this.onErase?.(x, y);
        return true;
    }
    /** Remove all player track (used by Reset while editing). One undo step. */
    clearAll() {
        this.beginStroke();
        for (const c of this.grid.cells) {
            if (!c.fixed && c.mask !== 0) {
                c.mask = 0;
                this.normalize(c);
                this.strokeDirty = true;
            }
        }
        this.endStroke();
    }
}
//# sourceMappingURL=editor.js.map