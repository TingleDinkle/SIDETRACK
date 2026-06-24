import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { classify } from './dist/track.js';

// Case 2: A switch that the loco can navigate, but which has no matching colored junction
const level = {
  "id": "switch-no-junction-2",
  "world": 1,
  "name": "Switch with no junction",
  "grid": { "cols": 6, "rows": 1 },
  "trackBudget": 3,
  "locomotive": { "x": 0, "y": 0, "heading": "E" },
  "fixedTiles": [
    { "x": 1, "y": 0, "type": "switch", "edges": ["W", "E", "S"], "color": "blue" },  // 3-way junction
    { "x": 2, "y": 0, "type": "track", "mask": 3 },  // 2-way straight EW
    { "x": 3, "y": 0, "type": "track", "mask": 3 },  // 2-way straight EW
    { "x": 4, "y": 0, "type": "track", "mask": 3 },  // 2-way straight EW
    { "x": 5, "y": 0, "type": "exit", "heading": "W" }
  ],
  "wagons": []
};

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log("=== Case 2: Switch with no matching junction ===");
console.log(`Loco at (${sim.loco.x}, ${sim.loco.y}) heading ${sim.loco.heading}`);

const switches = grid.cells.filter(c => c.type === 'switch');
const junctions = grid.cells.filter(c => classify(c.mask) === 'junction');
const blueJunctions = junctions.filter(c => c.color === 'blue');

console.log(`Grid has ${switches.length} switches with color 'blue'`);
console.log(`Grid has ${junctions.length} junctions total`);
console.log(`Grid has ${blueJunctions.length} junctions with color 'blue'`);

for (let i = 0; i < 6; i++) {
  sim.tick();
  console.log(`Tick ${i + 1}: Loco at (${sim.loco.x}, ${sim.loco.y}), status=${sim.status}, failReason='${sim.failReason}', events=[${sim.events.join(',')}]`);
  if (sim.status !== 'running') break;
}
