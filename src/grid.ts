/**
 * The board: a flat array of cells with neighbour helpers.
 *
 * Pure data + indexing only (no DOM, no rendering), so it is shared by the
 * editor, the simulation and the renderer.
 */

import { Cell, DELTA, Heading } from './types.js';

export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Cell[];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this.cells[this.idx(x, y)] = { x, y, type: 'empty', mask: 0, fixed: false };
      }
    }
  }

  idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  get(x: number, y: number): Cell | null {
    return this.inBounds(x, y) ? this.cells[this.idx(x, y)] : null;
  }

  /** The neighbouring cell one step in direction `h`, or null if off-grid. */
  neighbor(x: number, y: number, h: Heading): Cell | null {
    const d = DELTA[h];
    return this.get(x + d.dx, y + d.dy);
  }
}
