import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { classify } from './dist/track.js';

const level = {
  "id": "switch-no-junction",
  "world": 1,
  "name": "Bad",
  "grid": { "cols": 5, "rows": 1 },
  "trackBudget": 3,
  "locomotive": { "x": 0, "y": 0, "heading": "E" },
  "fixedTiles": [
    { "x": 1, "y": 0, "type": "switch", "edges": ["W", "E"], "color": "blue" },
    { "x": 2, "y": 0, "type": "track", "mask": 3 },
    { "x": 4, "y": 0, "type": "exit", "heading": "W" }
  ],
  "wagons": []
};

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log("=== Initial state ===");
console.log(`Loco at (${sim.loco.x}, ${sim.loco.y}) heading ${sim.loco.heading}`);
console.log(`Grid cell (1,0):`, grid.get(1, 0));

const switches = grid.cells.filter(c => c.type === 'switch');
const junctions = grid.cells.filter(c => classify(c.mask) === 'junction');

console.log(`Grid has ${switches.length} switches`);
console.log(`Grid has ${junctions.length} junctions`);

for (let i = 0; i < 5; i++) {
  sim.tick();
  console.log(`Tick ${i + 1}: Loco at (${sim.loco.x}, ${sim.loco.y}), status=${sim.status}, failReason='${sim.failReason}', events=[${sim.events.join(',')}]`);
  if (sim.status !== 'running') break;
}
