import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Test case from the claim
const level = {
  id: "negative-coords",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: -1, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: []
};

console.log("Testing negative locomotive coordinate: x=-1, y=0");
console.log("Level locomotive:", level.locomotive);

try {
  const grid = buildGrid(level);
  console.log("buildGrid succeeded (no error thrown)");
  console.log("Grid dimensions:", grid.cols, "x", grid.rows);
  
  // Try to get the locomotive cell
  const locoCell = grid.get(-1, 0);
  console.log("grid.get(-1, 0) returned:", locoCell);
  
  // Check what happens with idx calculation
  console.log("\nGrid.idx(-1, 0) calculation: 0 * 3 + (-1) =", 0 * 3 + (-1), "=", -1);
  console.log("Accessing grid.cells[-1]:", grid.cells[-1]);
  
  // Try to create simulation
  const sim = new Simulation(grid, level);
  console.log("\nSimulation created successfully");
  console.log("Loco position in sim:", sim.loco.x, sim.loco.y);
  
  // Try a tick
  sim.tick();
  console.log("First tick completed");
  console.log("Loco now at:", sim.loco.x, sim.loco.y);
  console.log("Status:", sim.status);
  console.log("Failure reason:", sim.failReason);
} catch (e) {
  console.error("Error thrown:", e.message);
}

// Test with non-integer coordinates
console.log("\n\n--- Testing non-integer coordinate ---");
const level2 = {
  id: "float-coords",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 1.5, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: []
};

console.log("Testing non-integer locomotive coordinate: x=1.5, y=0");

try {
  const grid = buildGrid(level2);
  console.log("buildGrid succeeded");
  
  const locoCell = grid.get(1.5, 0);
  console.log("grid.get(1.5, 0) returned:", locoCell);
  
  console.log("Grid.idx(1.5, 0) calculation: 0 * 3 + 1.5 =", 0 * 3 + 1.5);
  console.log("Array access grid.cells[1.5]:", grid.cells[1.5]);
  
  const sim = new Simulation(grid, level2);
  console.log("Simulation created");
  sim.tick();
  console.log("Status:", sim.status);
} catch (e) {
  console.error("Error thrown:", e.message);
}
