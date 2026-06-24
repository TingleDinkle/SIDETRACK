import { validateLevel } from './dist/levelValidate.js';

const levelNegative = {
  id: "negative-coords",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: -1, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: []
};

const levelFloat = {
  id: "float-coords",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 1.5, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: []
};

console.log("=== Testing validateLevel ===\n");
console.log("1. Negative locomotive coordinate (x=-1, y=0):");
const issues1 = validateLevel(levelNegative);
console.log(issues1.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues1.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

console.log("\n2. Non-integer locomotive coordinate (x=1.5, y=0):");
const issues2 = validateLevel(levelFloat);
console.log(issues2.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues2.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

// Test with negative wagon
console.log("\n3. Negative wagon coordinate:");
const levelNegWagon = {
  id: "test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: [{ x: -1, y: 1, number: 1 }]
};
const issues3 = validateLevel(levelNegWagon);
console.log(issues3.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues3.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

// Test with float wagon
console.log("\n4. Float wagon coordinate:");
const levelFloatWagon = {
  id: "test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  wagons: [{ x: 1.5, y: 1, number: 1 }]
};
const issues4 = validateLevel(levelFloatWagon);
console.log(issues4.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues4.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

// Test with float mover
console.log("\n5. Float mover coordinate:");
const levelFloatMover = {
  id: "test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [{ x: 2, y: 1, type: "exit", heading: "W" }],
  movers: [{ x: 1.5, y: 1, heading: "E" }]
};
const issues5 = validateLevel(levelFloatMover);
console.log(issues5.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues5.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

// Test with float fixedTile
console.log("\n6. Float fixedTile coordinate:");
const levelFloatTile = {
  id: "test",
  world: 1,
  name: "Bad",
  grid: { cols: 3, rows: 3 },
  trackBudget: 1,
  locomotive: { x: 0, y: 0, heading: "E" },
  fixedTiles: [
    { x: 2, y: 1, type: "exit", heading: "W" },
    { x: 1.5, y: 1, type: "rock" }
  ],
  wagons: []
};
const issues6 = validateLevel(levelFloatTile);
console.log(issues6.length === 0 ? "NO VALIDATION ERRORS" : "Validation caught:");
issues6.forEach(i => console.log(`  [${i.level}] ${i.msg}`));
