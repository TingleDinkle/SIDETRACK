/**
 * Level format (matches the spec) + a small builder that turns a Level into a
 * Grid of fixed tiles. Entities (locomotive / wagons / movers) stay on the
 * Level object and are drawn (M1) / simulated (M2) separately from the grid.
 *
 * The full JSON loader and the level library arrive in M4; for M1 we ship a
 * couple of hand-authored sample levels inline so there is something to play
 * with immediately.
 */
import { Grid } from './grid.js';
import { addEdge } from './types.js';
function edgesToMask(edges, mask) {
    if (typeof mask === 'number')
        return mask;
    let m = 0;
    if (edges)
        for (const e of edges)
            m = addEdge(m, e);
    return m;
}
/**
 * Build a Grid (tiles only) from a Level. The locomotive's cell is marked as a
 * fixed `start` tile facing its heading; exits/rocks/etc. come from fixedTiles.
 */
export function buildGrid(level) {
    const g = new Grid(level.grid.cols, level.grid.rows);
    for (const t of level.fixedTiles) {
        const c = g.get(t.x, t.y);
        if (!c)
            continue;
        c.type = t.type;
        c.fixed = true;
        c.mask = edgesToMask(t.edges, t.mask);
        if (t.heading)
            c.heading = t.heading;
        if (t.pairId !== undefined)
            c.pairId = t.pairId;
        if (t.color)
            c.color = t.color;
        if (t.open !== undefined)
            c.open = t.open;
        // An exit with only a heading still needs an edge to connect track to.
        if (c.type === 'exit' && c.mask === 0 && c.heading)
            c.mask = addEdge(0, c.heading);
    }
    // Locomotive start tile: fixed, faces its heading, with a stub edge so the
    // player can connect their track to it.
    const s = g.get(level.locomotive.x, level.locomotive.y);
    if (s) {
        s.type = 'start';
        s.fixed = true;
        s.heading = level.locomotive.heading;
        s.mask = addEdge(s.mask, level.locomotive.heading);
    }
    return g;
}
/* ------------------------------------------------------------------ *
 * M1 sample levels — just enough to exercise laying + budget + obstacles.
 * (Real authored worlds come in M4.)
 * ------------------------------------------------------------------ */
export const SAMPLE_LEVELS = [
    {
        id: '1-1',
        world: 1,
        name: 'First Tracks',
        grid: { cols: 6, rows: 3 },
        trackBudget: 4,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 5, y: 1, type: 'exit', heading: 'W' },
            { x: 2, y: 0, type: 'rock' },
        ],
        wagons: [],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    {
        id: '1-2',
        world: 1,
        name: 'Around the Rock',
        grid: { cols: 6, rows: 4 },
        trackBudget: 9,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 5, y: 1, type: 'exit', heading: 'W' },
            { x: 2, y: 1, type: 'rock' },
            { x: 3, y: 1, type: 'rock' },
        ],
        wagons: [],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    {
        id: '1-3',
        world: 1,
        name: 'Pickup',
        grid: { cols: 6, rows: 3 },
        trackBudget: 4,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 5, y: 1, type: 'exit', heading: 'W' },
            { x: 2, y: 0, type: 'rock' },
        ],
        wagons: [{ x: 3, y: 1, number: 1 }],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    {
        id: '1-4',
        world: 1,
        name: 'Two in Order',
        grid: { cols: 7, rows: 3 },
        trackBudget: 5,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [{ x: 6, y: 1, type: 'exit', heading: 'W' }],
        wagons: [
            { x: 2, y: 1, number: 1 },
            { x: 4, y: 1, number: 2 },
        ],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    // World 2 — tunnels
    {
        id: '2-1',
        world: 2,
        name: 'Underpass',
        grid: { cols: 7, rows: 3 },
        trackBudget: 3,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 3, y: 1, type: 'tunnel', edges: ['W'], pairId: 1 },
            { x: 4, y: 1, type: 'rock' },
            { x: 5, y: 1, type: 'tunnel', edges: ['E'], pairId: 1 },
            { x: 6, y: 1, type: 'exit', heading: 'W' },
        ],
        wagons: [{ x: 2, y: 1, number: 1 }],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    // World 3 — gates + buttons
    {
        id: '3-1',
        world: 3,
        name: 'Keycard',
        grid: { cols: 7, rows: 3 },
        trackBudget: 3,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 2, y: 1, type: 'button', edges: ['W', 'E'], color: 'red' },
            { x: 4, y: 1, type: 'gate', edges: ['W', 'E'], color: 'red', open: false },
            { x: 6, y: 1, type: 'exit', heading: 'W' },
        ],
        wagons: [],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
    // World 4 — signals
    {
        id: '4-1',
        world: 4,
        name: 'Stop and Go',
        grid: { cols: 5, rows: 3 },
        trackBudget: 2,
        locomotive: { x: 0, y: 1, heading: 'E' },
        fixedTiles: [
            { x: 1, y: 1, type: 'signal', edges: ['W', 'E'], open: false },
            { x: 4, y: 1, type: 'exit', heading: 'W' },
        ],
        wagons: [],
        objectives: { couple: 'all-in-order', passengers: 0 },
    },
];
// Kept for any callers expecting the old name.
export const M1_LEVELS = SAMPLE_LEVELS;
//# sourceMappingURL=level.js.map