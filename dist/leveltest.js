/**
 * Level solvability tests — for every authored level, lay a known-good track
 * layout and assert the simulation WINS within the stated budget. This makes it
 * impossible to ship an unsolvable level or one whose intended solution exceeds
 * its track budget.
 *
 * Run via `npm test` (after selftest).
 */
import { LEVEL_LIBRARY } from './levelData.js';
import { buildGrid } from './level.js';
import { Simulation } from './sim.js';
import { addEdge } from './types.js';
let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
    if (cond)
        passed++;
    else {
        failed++;
        console.error('  FAIL:', name, extra);
    }
}
/** A verified track layout (player-placed cells) for each level id. */
const SOLUTIONS = {
    '1-1': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 2, y: 1, edges: ['E', 'W'] },
        { x: 3, y: 1, edges: ['E', 'W'] },
        { x: 4, y: 1, edges: ['E', 'W'] },
    ],
    '1-2': [
        { x: 1, y: 1, edges: ['W', 'S'] },
        { x: 1, y: 2, edges: ['N', 'E'] },
        { x: 2, y: 2, edges: ['W', 'E'] },
        { x: 3, y: 2, edges: ['W', 'E'] },
        { x: 4, y: 2, edges: ['W', 'N'] },
        { x: 4, y: 1, edges: ['S', 'E'] },
    ],
    '1-3': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 2, y: 1, edges: ['E', 'W'] },
        { x: 3, y: 1, edges: ['E', 'W'] },
        { x: 4, y: 1, edges: ['E', 'W'] },
    ],
    '1-4': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 2, y: 1, edges: ['E', 'W'] },
        { x: 3, y: 1, edges: ['E', 'W'] },
        { x: 4, y: 1, edges: ['E', 'W'] },
        { x: 5, y: 1, edges: ['E', 'W'] },
    ],
    '1-5': [
        { x: 1, y: 0, edges: ['W', 'E'] },
        { x: 2, y: 0, edges: ['W', 'S'] },
        { x: 2, y: 1, edges: ['N', 'S'] },
        { x: 2, y: 2, edges: ['N', 'W'] },
        { x: 1, y: 2, edges: ['W', 'E'] },
    ],
    '2-1': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 2, y: 1, edges: ['E', 'W'] },
    ],
    '2-2': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 5, y: 1, edges: ['E', 'W'] },
    ],
    '2-3': [
        { x: 1, y: 0, edges: ['W', 'S'] }, // curve down off the start
        { x: 1, y: 1, edges: ['N', 'S'] }, // down into the top tunnel
        { x: 3, y: 3, edges: ['N', 'S'] }, // out of the bottom tunnel, down to the goal
    ],
    '3-1': [
        { x: 1, y: 1, edges: ['E', 'W'] },
        { x: 3, y: 1, edges: ['E', 'W'] },
        { x: 5, y: 1, edges: ['E', 'W'] },
    ],
    '3-2': [
        { x: 1, y: 1, edges: ['W', 'N'] },
        { x: 1, y: 0, edges: ['S', 'E'] },
        { x: 2, y: 1, edges: ['N', 'E'] },
        { x: 3, y: 1, edges: ['W', 'E'] },
    ],
    '4-1': [
        { x: 2, y: 1, edges: ['E', 'W'] },
        { x: 3, y: 1, edges: ['E', 'W'] },
    ],
    '4-2': [
        { x: 2, y: 1, edges: ['E', 'W'] },
        { x: 4, y: 1, edges: ['E', 'W'] },
    ],
    '4-3': [
        { x: 1, y: 2, edges: ['E', 'W'] },
        { x: 3, y: 2, edges: ['E', 'W'] },
    ],
};
for (const level of LEVEL_LIBRARY) {
    const sol = SOLUTIONS[level.id];
    check(`${level.id}: has a solution`, !!sol);
    if (!sol)
        continue;
    check(`${level.id}: solution within budget`, sol.length <= level.trackBudget, `(${sol.length}/${level.trackBudget})`);
    const grid = buildGrid(level);
    let placeable = true;
    for (const s of sol) {
        const c = grid.get(s.x, s.y);
        if (!c || c.fixed || c.type !== 'empty') {
            placeable = false;
            break;
        }
        c.type = 'track';
        let m = 0;
        for (const e of s.edges)
            m = addEdge(m, e);
        c.mask = m;
    }
    check(`${level.id}: solution cells are placeable`, placeable);
    const sim = new Simulation(grid, level);
    let n = 0;
    while (sim.status === 'running' && n++ < 500)
        sim.tick();
    check(`${level.id}: solution wins`, sim.status === 'won', `(ended ${sim.status}: ${sim.failReason})`);
}
console.log(`\nSidetrack level tests: ${passed} passed, ${failed} failed`);
if (failed)
    process.exit(1);
//# sourceMappingURL=leveltest.js.map