import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// The REAL scenario from the claim:
// Loco at (2,1), wagon at (2,1), with track so loco CAN attempt move
// On first tick, loco tries to move but coupling with wagon #1 happens
// So loco couples wagon #1, and both move together

// But what if there's no coupling? Let me create a scenario where:
// - Loco at (2,1) heading E
// - Wagon at (2,1) but with #2 (out of order)
// - Track exists

const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 2 }],  // Out of order!
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "oo-wagon-at-start",
  "world": 1,
  "name": "Out of Order at Start",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('Scenario: Out-of-order wagon at loco start');
console.log('Loco at (2,1), Wagon #2 at (2,1), track exists');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nBefore tick: Loco (2,1), Wagon #2 (2,1)');
sim.tick();
console.log('After tick 1: Status =', sim.status, ', Reason =', sim.failReason);

// What happens? Loco tries to move to (3,1), wagon at (2,1) stays there
// Actually no - let me think through coupling logic:
// At line 223: fw = this.freeWagonAt(locoIntent.rawX, locoIntent.rawY)
// locoIntent.rawX = 3, locoIntent.rawY = 1
// So wagon at (2,1) is NOT at the target, so NO coupling decision
// Wagon stays at (2,1), loco moves to (3,1)
// collision check: trainNew has (3,1), wagons include (2,1) -> NO collision

console.log('\nWait, let me test a different scenario...');

// REAL collision scenario: loco and wagon both at same cell
// If loco can't couple (out of order), it moves anyway
// finals will have both loco and wagon at same spot

const level2 = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 3, "y": 1, "number": 2 }],  // In loco's target
  "movers": [{ "x": 2, "y": 1, "heading": "E" }],  // At loco's start
  "fixedTiles": [
    { "x": 2, "y": 1, "type": "track", "edges": ["E"] },
    { "x": 3, "y": 1, "type": "track", "edges": ["W", "E"] },
    { "x": 4, "y": 1, "type": "exit", "heading": "W" }
  ], 
  "trackBudget": 2,
  "id": "real-collision",
  "world": 1,
  "name": "Real Collision",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

console.log('\n--- Real collision scenario ---');
console.log('Loco at (2,1), Mover at (2,1), Wagon #2 at (3,1)');
console.log('Loco wants to move to (3,1), Mover wants to move to (3,1)');

const grid2 = buildGrid(level2);
const sim2 = new Simulation(grid2, level2);

sim2.tick();
console.log('After tick: Status =', sim2.status, ', Reason =', sim2.failReason);
