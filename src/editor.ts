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

import { Grid } from './grid.js';
import { Cell, EdgeMask, OPPOSITE, addEdge, edgeList, headingBetween, removeEdge } from './types.js';

/** Tile types a laid track edge may point into (a unit can travel onto these). */
function isConnectableFixed(cell: Cell): boolean {
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
  readonly grid: Grid;
  budget: number;

  private undoStack: EdgeMask[][] = [];
  private redoStack: EdgeMask[][] = [];
  private strokeOpen = false;
  private strokeDirty = false;

  constructor(grid: Grid, budget: number) {
    this.grid = grid;
    this.budget = budget;
  }

  /* --------------------------- budget --------------------------- */

  /** How many player-placed track cells are currently on the board. */
  budgetUsed(): number {
    let n = 0;
    for (const c of this.grid.cells) if (!c.fixed && c.mask !== 0) n++;
    return n;
  }
  budgetLeft(): number {
    return this.budget - this.budgetUsed();
  }

  /* --------------------------- undo/redo --------------------------- */

  private snapshot(): EdgeMask[] {
    return this.grid.cells.map((c) => c.mask);
  }
  private restore(masks: EdgeMask[]): void {
    for (let i = 0; i < this.grid.cells.length; i++) {
      const c = this.grid.cells[i];
      if (c.fixed) continue;
      c.mask = masks[i] ?? 0;
      c.type = c.mask ? 'track' : 'empty';
    }
  }

  beginStroke(): void {
    if (this.strokeOpen) return;
    this.undoStack.push(this.snapshot());
    this.redoStack.length = 0;
    this.strokeOpen = true;
    this.strokeDirty = false;
  }
  endStroke(): void {
    if (!this.strokeOpen) return;
    if (!this.strokeDirty) this.undoStack.pop(); // drop a stroke that changed nothing
    this.strokeOpen = false;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop()!);
  }
  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop()!);
  }

  /* --------------------------- editing --------------------------- */

  private normalize(c: Cell): void {
    if (c.fixed) return;
    c.type = c.mask ? 'track' : 'empty';
  }

  /**
   * Lay a connection between two orthogonally-adjacent cells. Returns true if
   * the board changed. Honours the budget: the step is rejected outright if it
   * would push the used count over budget.
   */
  layStep(ax: number, ay: number, bx: number, by: number): boolean {
    const h = headingBetween(ax, ay, bx, by);
    if (!h) return false; // not adjacent
    const a = this.grid.get(ax, ay);
    const b = this.grid.get(bx, by);
    if (!a || !b) return false;

    const aEditable = !a.fixed && (a.type === 'empty' || a.type === 'track');
    const bEditable = !b.fixed && (b.type === 'empty' || b.type === 'track');
    const aOk = aEditable || (a.fixed && isConnectableFixed(a));
    const bOk = bEditable || (b.fixed && isConnectableFixed(b));
    if (!aOk || !bOk) return false; // rock / empty-fixed / off-grid on a side
    if (!aEditable && !bEditable) return false; // nothing editable → no change possible

    // Cost = editable sides going from empty → track this step.
    let cost = 0;
    if (aEditable && a.mask === 0) cost++;
    if (bEditable && b.mask === 0) cost++;
    if (this.budgetUsed() + cost > this.budget) return false;

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
    // A tunnel's single mouth follows the track laid against it, so its machine
    // (and the train's emerge direction) faces where the train actually travels.
    if (a.fixed && a.type === 'tunnel' && bEditable && a.mask !== addEdge(0, h)) {
      a.mask = addEdge(0, h);
      changed = true;
    }
    if (b.fixed && b.type === 'tunnel' && aEditable && b.mask !== addEdge(0, OPPOSITE[h])) {
      b.mask = addEdge(0, OPPOSITE[h]);
      changed = true;
    }
    if (changed) this.strokeDirty = true;
    return changed;
  }

  /** Erase a player-placed track cell, pruning dangling edges on neighbours. */
  eraseAt(x: number, y: number): boolean {
    const c = this.grid.get(x, y);
    if (!c || c.fixed || c.mask === 0) return false;
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
    return true;
  }

  /** Remove all player track (used by Reset while editing). One undo step. */
  clearAll(): void {
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
