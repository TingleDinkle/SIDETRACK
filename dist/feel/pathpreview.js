import { DELTA, OPPOSITE, edgeList, hasEdge } from '../types.js';
import { exitEdge } from '../track.js';
export function tracePath(grid, start, wagons = []) {
    const cells = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    let h = start.heading;
    let outcome = 'derail';
    const seen = new Set();
    const cap = grid.cols * grid.rows * 3 + 8;
    for (let i = 0; i < cap; i++) {
        if (seen.has(`${x},${y},${h}`))
            break; // entered a loop — stop
        seen.add(`${x},${y},${h}`);
        const c = grid.get(x, y);
        if (!c)
            break;
        // Exit direction: launch/emerge straight from a start/tunnel, otherwise the
        // rail's redirect, otherwise coast straight on.
        const dir = c.type === 'start' || c.type === 'tunnel' ? h : exitEdge(c.mask, OPPOSITE[h], 0) ?? h;
        const nx = x + DELTA[dir].dx;
        const ny = y + DELTA[dir].dy;
        const dest = grid.get(nx, ny);
        if (!dest || dest.type === 'rock')
            break; // off the board / blocked → derail
        if (dest.type === 'exit') {
            if (!hasEdge(c.mask, dir))
                break; // can't coast into the goal — needs a rail at its edge
            cells.push({ x: nx, y: ny });
            outcome = 'exit';
            break;
        }
        if (dest.type === 'tunnel') {
            const pair = grid.cells.find((o) => o !== dest && o.type === 'tunnel' && o.pairId === dest.pairId);
            const mouth = pair ? edgeList(pair.mask)[0] : undefined;
            cells.push({ x: nx, y: ny });
            if (!pair || !mouth)
                break; // unpaired tunnel — stop here
            x = pair.x;
            y = pair.y;
            h = mouth;
            cells.push({ x, y });
            continue;
        }
        x = nx;
        y = ny;
        h = dir;
        cells.push({ x, y });
    }
    const pickups = wagons.filter((w) => cells.some((c) => c.x === w.x && c.y === w.y));
    return { cells, outcome, pickups };
}
//# sourceMappingURL=pathpreview.js.map