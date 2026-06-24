import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

// Scenario: loco at (2,1) intends to move to (3,1), but TWO wagons: one at start, one in path
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [
    { "x": 2, "y": 1, "number": 1 },  // at start (collision trigger)
    { "x": 3, "y": 1, "number": 2 }   // in path
  ],
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "collision-both-places",
  "world": 1,
  "name": "Collision Test",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('Scenario: Wagon at start AND wagon in loco path');
console.log('Loco at (2,1), Wagon #1 at (2,1), Wagon #2 at (3,1)');

const issues = validateLevel(level);
console.log('Validation issues:', issues.length);
issues.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick:');
console.log('  Loco: (2,1)');
console.log('  Free wagons:', sim.free.map(w => `#${w.number}@(${w.x},${w.y})`).join(', '));

sim.tick();
console.log('\nAfter tick 1:');
console.log('  Status:', sim.status);
console.log('  Reason:', sim.failReason);
