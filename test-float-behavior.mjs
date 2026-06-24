import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Detailed test of non-integer locomotive
const level = {
  id: "float-test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 5,
  locomotive: { x: 1.5, y: 0, heading: "E" },
  fixedTiles: [
    { x: 0, y: 0, type: "track", edges: ["E", "W"] },
    { x: 1, y: 0, type: "track", edges: ["E", "W"] },
    { x: 2, y: 0, type: "exit", heading: "W" }
  ],
  wagons: []
};

console.log("Testing: locomotive at (1.5, 0) with valid track");
const grid = buildGrid(level);

console.log("\nDirect buildGrid effects:");
console.log("grid.get(1.5, 0) =", grid.get(1.5, 0));
console.log("grid.get(1, 0) =", grid.get(1, 0));
console.log("grid.get(2, 0) =", grid.get(2, 0));

console.log("\nLooking at the start tile that should be set at loco position:");
console.log("grid.inBounds(1.5, 0) =", grid.inBounds(1.5, 0));
console.log("grid.idx(1.5, 0) =", grid.idx(1.5, 0));

console.log("\nActual start tile position check:");
for (let x = 0; x < 3; x++) {
  for (let y = 0; y < 3; y++) {
    const c = grid.get(x, y);
    if (c.type === 'start') {
      console.log(`Start tile found at (${x}, ${y})`);
    }
  }
}

console.log("\nSimulation initialization:");
const sim = new Simulation(grid, level);
console.log("sim.loco =", sim.loco);

console.log("\nFirst tick:");
sim.tick();
console.log("Status:", sim.status);
console.log("Loco position:", sim.loco.x, sim.loco.y);
console.log("Fail reason:", sim.failReason);

// Now test with a wagon at float coordinate
console.log("\n\n=== Testing wagon at float coordinate ===");
const level2 = {
  id: "float-wagon-test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 5,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [
    { x: 1, y: 0, type: "track", edges: ["E", "W"] },
    { x: 2, y: 0, type: "exit", heading: "W" }
  ],
  wagons: [{ x: 1.5, y: 0, number: 1 }]
};

const grid2 = buildGrid(level2);
const sim2 = new Simulation(grid2, level2);

console.log("Initial state:");
console.log("Loco at:", sim2.loco.x, sim2.loco.y);
console.log("Free wagons:", sim2.free);

// Add track to connect
grid2.get(0, 0).type = 'track';
grid2.get(0, 0).mask = 3; // E+W edges

sim2.tick();
console.log("After tick 1:");
console.log("Status:", sim2.status);
console.log("Loco at:", sim2.loco.x, sim2.loco.y);
console.log("Free wagons:", sim2.free);
