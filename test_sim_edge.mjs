import { Simulation } from './dist/sim.js';
import { buildGrid } from './dist/level.js';

// Test: 0x0 grid in simulation
console.log("Test: 0x0 grid in simulation");
const level1 = {
  id: "zero-grid",
  world: 1,
  name: "Bad",
  grid: { cols: 0, rows: 0 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [],
  wagons: []
};

try {
  const grid = buildGrid(level1);
  console.log(`Grid created: ${grid.cols}x${grid.rows}`);
  
  const sim = new Simulation(grid, level1);
  console.log(`Simulation started`);
  
  // Try a few ticks
  for (let i = 0; i < 5; i++) {
    sim.tick();
    console.log(`Tick ${i+1}: status=${sim.status}, failReason=${sim.failReason}`);
  }
} catch (e) {
  console.log("Error:", e.message);
  console.log(e.stack);
}

// Test: 200x200 grid in simulation
console.log("\n\nTest: 200x200 grid in simulation");
const level2 = {
  id: "huge-grid",
  world: 1,
  name: "Bad",
  grid: { cols: 200, rows: 200 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 199, y: 199, type: "exit", heading: "W" }],
  wagons: []
};

try {
  const grid = buildGrid(level2);
  console.log(`Grid created: ${grid.cols}x${grid.rows}, ${grid.cells.length} cells`);
  
  const sim = new Simulation(grid, level2);
  console.log(`Simulation started, maxTicks=${grid.cols * grid.rows * 8 + 100}`);
  
  // Try one tick
  sim.tick();
  console.log(`Tick 1: status=${sim.status}, failReason=${sim.failReason}`);
} catch (e) {
  console.log("Error:", e.message);
  console.log(e.stack);
}
