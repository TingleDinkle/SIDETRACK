import { Simulation } from './dist/sim.js';
import { buildGrid } from './dist/level.js';
import { validateLevel as loaderValidate } from './dist/levelLoader.js';
import { validateLevel as checkValidate } from './dist/levelValidate.js';

console.log("=== COMPREHENSIVE EDGE CASE TEST ===\n");

const testCases = [
  {
    name: "0x0 grid",
    level: {
      id: "zero-grid", world: 1, name: "Bad",
      grid: { cols: 0, rows: 0 },
      trackBudget: 1000,
      locomotive: { x: 0, y: 0, heading: "E" },
      fixedTiles: [{ x: 0, y: 0, type: "exit", heading: "W" }],
      wagons: []
    }
  },
  {
    name: "1x1 grid (editor minimum is 2x2)",
    level: {
      id: "one-grid", world: 1, name: "Bad",
      grid: { cols: 1, rows: 1 },
      trackBudget: 1000,
      locomotive: { x: 0, y: 0, heading: "E" },
      fixedTiles: [{ x: 0, y: 0, type: "exit", heading: "W" }],
      wagons: []
    }
  },
  {
    name: "200x200 grid (20x beyond max)",
    level: {
      id: "huge-grid", world: 1, name: "Bad",
      grid: { cols: 200, rows: 200 },
      trackBudget: 1000,
      locomotive: { x: 0, y: 0, heading: "E" },
      fixedTiles: [{ x: 50, y: 50, type: "exit", heading: "W" }],
      wagons: []
    }
  },
  {
    name: "17x12 grid (1 col over max)",
    level: {
      id: "wide-grid", world: 1, name: "Bad",
      grid: { cols: 17, rows: 12 },
      trackBudget: 1000,
      locomotive: { x: 0, y: 0, heading: "E" },
      fixedTiles: [{ x: 16, y: 11, type: "exit", heading: "W" }],
      wagons: []
    }
  },
  {
    name: "16x13 grid (1 row over max)",
    level: {
      id: "tall-grid", world: 1, name: "Bad",
      grid: { cols: 16, rows: 13 },
      trackBudget: 1000,
      locomotive: { x: 0, y: 0, heading: "E" },
      fixedTiles: [{ x: 15, y: 12, type: "exit", heading: "W" }],
      wagons: []
    }
  }
];

for (const tc of testCases) {
  console.log(`\n--- ${tc.name} ---`);
  const L = tc.level;
  
  // Test 1: levelLoader.validateLevel (used by leveleditor.importJSON)
  console.log("1. levelLoader.validateLevel (used by editor import):");
  try {
    const result = loaderValidate(L);
    console.log("   ✓ No error - level accepted as valid");
  } catch (e) {
    console.log(`   ✗ Error: ${e.message}`);
  }
  
  // Test 2: levelValidate.validateLevel (should catch bounds)
  console.log("2. levelValidate.validateLevel (proper validation):");
  const issues = checkValidate(L);
  if (issues.length === 0) {
    console.log("   ✓ No issues found");
  } else {
    issues.forEach(i => console.log(`   ${i.level.toUpperCase()}: ${i.msg}`));
  }
  
  // Test 3: Grid creation
  console.log("3. Grid creation:");
  const grid = buildGrid(L);
  console.log(`   Grid: ${grid.cols}x${grid.rows} = ${grid.cells.length} cells`);
  
  // Test 4: Simulation behavior
  console.log("4. Simulation tick:");
  const sim = new Simulation(grid, L);
  const maxTicks = grid.cols * grid.rows * 8 + 100;
  console.log(`   maxTicks = ${maxTicks}`);
  sim.tick();
  console.log(`   After first tick: status=${sim.status}, reason=${sim.failReason || '(none)'}`);
}

console.log("\n=== SUMMARY ===");
console.log("Issue: levelLoader.validateLevel (used in leveleditor.importJSON) does NOT check grid bounds.");
console.log("       Only levelValidate.validateLevel has the proper bounds check.");
console.log("\nConsequence:");
console.log("- 0x0 grid: Creates empty grid (40000 cells for 200x200)");
console.log("- Simulation initializes and runs, but likely derails immediately");
console.log("- No crash, but broken level silently accepted");
