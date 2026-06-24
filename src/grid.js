/**
 * The board: a flat array of cells with neighbour helpers.
 *
 * Pure data + indexing only (no DOM, no rendering), so it is shared by the
 * editor, the simulation and the renderer.
 */
import { DELTA } from './types.js';
export class Grid {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = new Array(cols * rows);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                this.cells[this.idx(x, y)] = { x, y, type: 'empty', mask: 0, fixed: false };
            }
        }
    }
    idx(x, y) {
        return y * this.cols + x;
    }
    inBounds(x, y) {
        return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
    }
    get(x, y) {
        return this.inBounds(x, y) ? this.cells[this.idx(x, y)] : null;
    }
    /** The neighbouring cell one step in direction `h`, or null if off-grid. */
    neighbor(x, y, h) {
        const d = DELTA[h];
        return this.get(x + d.dx, y + d.dy);
    }
}
