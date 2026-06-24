// Test the gap-wagons case from the spec
const level = {
  "id": "gap-wagons",
  "world": 1,
  "name": "Bad",
  "grid": { "cols": 7, "rows": 1 },
  "trackBudget": 3,
  "locomotive": { "x": 0, "y": 0, "heading": "E" },
  "fixedTiles": [{ "x": 6, "y": 0, "type": "exit", "heading": "W" }],
  "wagons": [
    { "x": 1, "y": 0, "number": 1 },
    { "x": 4, "y": 0, "number": 3 }
  ]
};

console.log("Test level wagons:", level.wagons);
console.log("Wagons are NOT contiguous: [1, 3] (skips 2)");
console.log("Expected behavior per sim.ts line 225:");
console.log("  - Loco will couple wagon #1");
console.log("  - nextNeeded becomes 2");
console.log("  - Wagon #3 will never be coupled (doesn't match nextNeeded)");
console.log("  - Reaches exit without all wagons -> FAIL");
