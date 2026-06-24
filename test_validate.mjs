import { validateLevel } from './dist/levelLoader.js';

const huge = {
  id: "huge-grid",
  world: 1,
  name: "Bad",
  grid: { cols: 200, rows: 200 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 50, y: 50, type: "exit", heading: "W" }],
  wagons: []
};

const zero = {
  id: "zero-grid",
  world: 1,
  name: "Bad",
  grid: { cols: 0, rows: 0 },
  trackBudget: 1000,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [],
  wagons: []
};

console.log("Testing levelLoader.validateLevel (the one used by leveleditor.ts import)");
console.log("\nTest 1: 200x200 grid");
try {
  const result = validateLevel(huge);
  console.log("Result: No error thrown - Level accepted");
  console.log("Grid dimensions:", result.grid);
} catch (e) {
  console.log("Error:", e.message);
}

console.log("\nTest 2: 0x0 grid");
try {
  const result = validateLevel(zero);
  console.log("Result: No error thrown - Level accepted");
  console.log("Grid dimensions:", result.grid);
} catch (e) {
  console.log("Error:", e.message);
}
