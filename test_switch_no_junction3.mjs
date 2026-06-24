import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { classify } from './dist/track.js';

// Case 3: A switch that is NOT a junction (2-way), and no matching colored junction elsewhere
const level = {
  "id": "switch-no-junction-3",
  "world": 1,
  "name": "Switch straight, no junction",
  "grid": { "cols": 6, "rows": 1 },
  "trackBudget": 3,
  "locomotive": { "x": 0, "y": 0, "heading": "E" },
  "fixedTiles": [
    { "x": 1, "y": 0, "type": "switch", "edges": ["W", "E"], "color": "blue" },  // straight 2-way, NOT junction
    { "x": 2, "y": 0, "type": "track", "mask": 3 },  // straight EW
    { "x": 3, "y": 0, "type": "track", "mask": 3 },  // straight EW
    { "x": 4, "y": 0, "type": "track", "mask": 3 },  // straight EW
    { "x": 5, "y": 0, "type": "exit", "heading": "W" }
  ],
  "wagons": []
};

const grid = buildGrid(level);

console.log("=== Grid cells ===");
for (let x = 0; x < 6; x++) {
  const c = grid.get(x, 0);
  console.log(`(${x},0): type=${c.type}, mask=${c.mask} (binary: ${c.mask.toString(2).padStart(4, '0')}), classify=${classify(c.mask)}, color=${c.color || 'none'}`);
}

const switches = grid.cells.filter(c => c.type === 'switch');
const junctions = grid.cells.filter(c => classify(c.mask) === 'junction');
const blueJunctions = junctions.filter(c => c.color === 'blue');

console.log(`\nGrid has ${switches.length} switches`);
console.log(`Grid has ${junctions.length} junctions total`);
console.log(`Grid has ${blueJunctions.length} junctions with color 'blue'`);

const sim = new Simulation(grid, level);
console.log(`\nLoco at (${sim.loco.x}, ${sim.loco.y}) heading ${sim.loco.heading}`);

for (let i = 0; i < 6; i++) {
  sim.tick();
  console.log(`Tick ${i + 1}: Loco at (${sim.loco.x}, ${sim.loco.y}), status=${sim.status}, failReason='${sim.failReason}', events=[${sim.events.join(',')}]`);
  if (sim.status !== 'running') break;
}
