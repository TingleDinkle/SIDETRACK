import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Scenario: loco and wagon both at (2,1), loco CAN move to (3,1)
// On first tick: loco moves to (3,1), wagon stays at (2,1) (not coupled because it's #1 and loco isn't moving to couple it)
// So NO collision because they end up at different places

// But what if we add a mover at (2,1) too?
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 1 }],
  "movers": [{ "x": 2, "y": 1, "heading": "E" }],
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "loco-wagon-mover-same",
  "world": 1,
  "name": "Three at Start",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('Scenario: Loco, wagon, and mover all at (2,1)');
console.log('Loco moves to (3,1), wagon stays at (2,1), mover moves to (3,1)');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick:');
console.log('  Loco: (2,1)');
console.log('  Wagon #1: (2,1)');
console.log('  Mover: (2,1)');

sim.tick();
console.log('\nAfter tick 1:');
console.log('  Status:', sim.status);
console.log('  Reason:', sim.failReason);
console.log('  Loco at:', sim.loco.x, sim.loco.y);
console.log('  Wagon at:', sim.free[0]?.x, sim.free[0]?.y);
console.log('  Mover at:', sim.movers[0]?.x, sim.movers[0]?.y);
