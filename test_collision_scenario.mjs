import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

// Scenario: loco at (2,1) intends to move to (3,1), but wagon is ALSO at (3,1)
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 3, "y": 1, "number": 1 }],  // wagon in loco's path
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "collision-wagon-in-path",
  "world": 1,
  "name": "Wagon in Loco Path",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('Scenario: Wagon at loco.nextMove position (not start)');
console.log('Loco at (2,1) heading E -> would move to (3,1)');
console.log('Wagon #1 at (3,1)');

const issues = validateLevel(level);
console.log('\nValidation issues:', issues.length);

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick: Loco (2,1), Wagon (3,1)');
sim.tick();
console.log('After tick 1: Status =', sim.status, ', Reason =', sim.failReason);

if (sim.status === 'running') {
  console.log('Loco is now at (', sim.loco.x, ',', sim.loco.y, ')');
  console.log('Wagon is at (', sim.free[0].x, ',', sim.free[0].y, ')');
}
