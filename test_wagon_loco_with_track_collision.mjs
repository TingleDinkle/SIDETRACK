import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

const level = {
  id: 'wagon-at-loco-with-track',
  world: 1,
  name: 'Test wagon at loco collision',
  grid: { cols: 5, rows: 3 },
  trackBudget: 3,
  locomotive: { x: 2, y: 1, heading: 'E' },
  fixedTiles: [
    { x: 2, y: 1, type: 'track', edges: ['E'] },  // exit east from start
    { x: 3, y: 1, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 1, type: 'exit', heading: 'W' }
  ],
  wagons: [{ x: 2, y: 1, number: 1 }],
  objectives: { couple: 'all-in-order', passengers: 0 }
};

console.log('Testing wagon at loco start WITH track laid out...');
console.log('Locomotive:', level.locomotive);
console.log('Wagons:', level.wagons);

// Test validation
console.log('\n=== VALIDATION TEST ===');
const issues = validateLevel(level);
console.log('Validation issues:', issues.length);
for (const issue of issues) {
  console.log(`[${issue.level.toUpperCase()}] ${issue.msg}`);
}

// Test simulation
console.log('\n=== SIMULATION TEST ===');
const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('Loco position:', sim.loco.x, sim.loco.y);
console.log('Free wagons:', sim.free.map(w => ({ x: w.x, y: w.y, number: w.number })));
console.log('Initial status:', sim.status);

console.log('\nAttempting first tick...');
sim.tick();
console.log('\nAfter first tick:');
console.log('Status:', sim.status);
console.log('Fail reason:', sim.failReason);
console.log('Loco at:', sim.loco.x, sim.loco.y);
console.log('Wagon at:', sim.free.length > 0 ? `${sim.free[0].x},${sim.free[0].y}` : 'coupled');
