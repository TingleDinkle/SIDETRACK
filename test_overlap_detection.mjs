import { validateLevel } from './dist/levelValidate.js';

const level = {
  "grid": { "cols": 5, "rows": 3 }, 
  "locomotive": { "x": 2, "y": 1, "heading": "E" }, 
  "wagons": [{ "x": 2, "y": 1, "number": 1 }],
  "fixedTiles": [{ "x": 4, "y": 1, "type": "exit", "heading": "W" }],
  "trackBudget": 2,
  "id": "wagon-at-loco",
  "world": 1,
  "name": "Test",
  "objectives": { "couple": "all-in-order", "passengers": 0 }
};

const issues = validateLevel(level);
console.log('Issues found:', issues.length);
issues.forEach(i => console.log(`  [${i.level}] ${i.msg}`));

if (issues.length === 0) {
  console.log('\nNO ISSUES - wagon at loco.x/y is NOT detected!');
}
