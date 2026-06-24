import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// From claim: "Loco and wagon, or loco and mover at same start cell causes immediate collision on first tick"
// The claim provides a repro:
// {"grid": {"cols": 5, "rows": 3}, "locomotive": {"x": 2, "y": 1, "heading": "E"}, 
//  "wagons": [{"x": 2, "y": 1, "number": 1}], 
//  "fixedTiles": [{"x": 4, "y": 1, "type": "exit", "heading": "W"}], 
//  "trackBudget": 2}

// This has NO TRACK, so loco derails on first attempt
// BUT the claim says it should hit collision in STEP 3

// Let me add track so loco CAN move
const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 1 }],
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "exact-claim",
  "world": 1,
  "name": "Exact Claim Repro",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('=== EXACT CLAIM SCENARIO (with track added) ===');
console.log('Loco at (2,1), Wagon #1 at (2,1), track exists');
console.log('\nClaim: "finalscollect both loco and wagon at same cell, collision triggered"');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick 1:');
console.log('  Loco: (2,1)');
console.log('  Wagon #1: (2,1)');

sim.tick();

console.log('\nAfter tick 1:');
console.log('  Status:', sim.status);
console.log('  Reason:', sim.failReason);
console.log('  Loco:', sim.loco.x, sim.loco.y);
console.log('  Wagon #1:', sim.free.length > 0 ? '(' + sim.free[0].x + ',' + sim.free[0].y + ')' : 'coupled');

console.log('\n=== ANALYSIS ===');
if (sim.status === 'running') {
  console.log('Wagon #1 was at loco.rawX, locoIntent.rawY (coupling happened)');
  console.log('But the ISSUE is: the level ALLOWS this invalid state to exist');
  console.log('Validation should PREVENT wagon at loco.x/y');
} else if (sim.failReason === 'collision') {
  console.log('Collision detected! (as claim states)');
} else {
  console.log('Failed with different reason');
}
