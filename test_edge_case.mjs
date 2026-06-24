import { Grid } from './dist/grid.js';
import { buildGrid } from './dist/level.js';

// Test 1: Create a huge grid (200x200) - would be 40,000 cells
console.log("Test 1: 200x200 grid");
const level1 = {
  id: "huge-grid",
  world: 1,
  name: "Bad",
  grid: { cols: 200, rows: 200 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 50, y: 50, type: "exit", heading: "W" }],
  wagons: []
};

try {
  const startTime = performance.now();
  const grid1 = buildGrid(level1);
  const endTime = performance.now();
  console.log(`Success: Created grid ${grid1.cols}x${grid1.rows} = ${grid1.cells.length} cells in ${(endTime - startTime).toFixed(2)}ms`);
} catch (e) {
  console.log("Error:", e.message);
}

// Test 2: Create a 0x0 grid - would be empty
console.log("\nTest 2: 0x0 grid");
const level2 = {
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
  const startTime = performance.now();
  const grid2 = buildGrid(level2);
  const endTime = performance.now();
  console.log(`Success: Created grid ${grid2.cols}x${grid2.rows} = ${grid2.cells.length} cells in ${(endTime - startTime).toFixed(2)}ms`);
} catch (e) {
  console.log("Error:", e.message);
}

// Test 3: Create negative grid
console.log("\nTest 3: negative grid");
const level3 = {
  id: "neg-grid",
  world: 1,
  name: "Bad",
  grid: { cols: -5, rows: -5 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [],
  wagons: []
};

try {
  const startTime = performance.now();
  const grid3 = buildGrid(level3);
  const endTime = performance.now();
  console.log(`Success: Created grid ${grid3.cols}x${grid3.rows} = ${grid3.cells.length} cells in ${(endTime - startTime).toFixed(2)}ms`);
} catch (e) {
  console.log("Error:", e.message);
}

// Test 4: Very large but reasonable grid
console.log("\nTest 4: 16x12 grid (editor max)");
const level4 = {
  id: "max-grid",
  world: 1,
  name: "Max",
  grid: { cols: 16, rows: 12 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 15, y: 11, type: "exit", heading: "W" }],
  wagons: []
};

try {
  const startTime = performance.now();
  const grid4 = buildGrid(level4);
  const endTime = performance.now();
  console.log(`Success: Created grid ${grid4.cols}x${grid4.rows} = ${grid4.cells.length} cells in ${(endTime - startTime).toFixed(2)}ms`);
} catch (e) {
  console.log("Error:", e.message);
}
