/**
 * The board: a flat array of cells with neighbour helpers.
 *
 * Pure data + indexing only (no DOM, no rendering), so it is shared by the
 * editor, the simulation and the renderer.
 */
import { DELTA, HEADINGS, OPPOSITE, edgeList, hasEdge } from './types.js';
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
/**
 * The direction a tunnel sends the train out: toward an adjacent goal or
 * connecting rail, so it always exits onto track instead of off the board (a
 * fixed authored mouth could point at the edge and crash on emerge). Falls back
 * to the authored mouth if nothing is connected. Shared by the sim (emerge
 * heading), the renderer (machine facing) and the route preview so all three
 * agree.
 */
export function tunnelExitDir(grid, t) {
    for (const h of HEADINGS) {
        const nb = grid.neighbor(t.x, t.y, h);
        if (!nb || nb.type === 'tunnel')
            continue;
        if (nb.type === 'exit' || hasEdge(nb.mask, OPPOSITE[h]))
            return h;
    }
    return edgeList(t.mask)[0] ?? null;
}
//# sourceMappingURL=grid.js.map