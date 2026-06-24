import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Scenario: loco at (2,1) with NO track -> loco doesn't move, wagon at same position
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 1 }],
  "fixedTiles": [
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
    // NO TRACK from loco start!
  ], 
  "trackBudget": 2,
  "id": "no-track",
  "world": 1,
  "name": "No Track",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('Scenario: Loco and wagon at same cell, NO track (loco cannot move)');
console.log('Expected: collision or special handling');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick:');
console.log('  Loco: (2,1)');
console.log('  Wagon #1: (2,1)');
console.log('  Status:', sim.status);

sim.tick();
console.log('\nAfter tick 1:');
console.log('  Status:', sim.status);
console.log('  Reason:', sim.failReason);

// This is what should happen per the claim:
// finals[] includes both (2,1) from trainNew and (2,1) from wagons
// collision detection triggers on duplicate key
console.log('\nExpected from claim:');
console.log('  Should fail with "collision" on first tick');
