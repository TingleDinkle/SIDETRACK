// Check if levelValidate is exported or available
try {
  const mod = await import('./dist/levelValidate.js');
  console.log("levelValidate exports:", Object.keys(mod));
  
  if (mod.validateLevel) {
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
    
    const issues = mod.validateLevel(huge);
    console.log("\nTest: 200x200 grid with levelValidate.validateLevel:");
    console.log("Issues returned:", issues);
  }
} catch (e) {
  console.log("Error loading levelValidate:", e.message);
}
