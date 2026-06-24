import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

const level = {
  id: 'mover-at-loco-start',
  world: 1,
  name: 'Edge Case: Mover at Locomotive Start',
  grid: { cols: 5, rows: 1 },
  trackBudget: 3,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [{ x: 4, y: 0, type: 'exit', heading: 'W' }],
  movers: [{ x: 0, y: 0, heading: 'E' }],
  objectives: { couple: 'all-in-order', passengers: 0 }
};

console.log('Testing mover placed at locomotive start position...');
console.log('Locomotive:', JSON.stringify(level.locomotive));
console.log('Movers:', JSON.stringify(level.movers, null, 2));

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
console.log('Movers:', sim.movers.map(m => ({ x: m.x, y: m.y, heading: m.heading })));
console.log('Initial status:', sim.status);

console.log('\nAttempting first tick...');
sim.tick();
console.log('\nAfter first tick:');
console.log('Status:', sim.status);
console.log('Fail reason:', sim.failReason);
