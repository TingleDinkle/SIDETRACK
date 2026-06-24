import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

// The exact case from the spec
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 1 }], 
  "fixedTiles": [{ "x": 4, "y": 1, "type": "exit", "heading": "W" }], 
  "trackBudget": 2,
  "id": "spec-case",
  "world": 1,
  "name": "Spec Case",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('SPEC CASE: Loco and wagon at same start cell');
console.log('Level:', JSON.stringify(level, null, 2));

console.log('\n=== VALIDATION ===');
const issues = validateLevel(level);
console.log('Issues found:', issues.length);
issues.forEach(i => console.log(`[${i.level}] ${i.msg}`));

console.log('\n=== SIMULATION ===');
const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('Initial:');
console.log('  Loco: (2,1)');
console.log('  Wagon #1: (2,1)');
console.log('  Status:', sim.status);

sim.tick();

console.log('\nAfter TICK 1:');
console.log('  Loco: (' + sim.loco.x + ',' + sim.loco.y + ')');
console.log('  Wagon #1:', sim.free.length > 0 ? '(' + sim.free[0].x + ',' + sim.free[0].y + ')' : 'coupled');
console.log('  Status:', sim.status);
console.log('  Reason:', sim.failReason);
