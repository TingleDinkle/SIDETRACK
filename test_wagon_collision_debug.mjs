import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

const level = {
  id: 'wagon-at-loco-start-debug',
  world: 1,
  name: 'Test wagon at loco start collision',
  grid: { cols: 5, rows: 1 },
  trackBudget: 3,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [
    { x: 1, y: 0, type: 'track', edges: ['W', 'E'] },
    { x: 2, y: 0, type: 'track', edges: ['W', 'E'] },
    { x: 3, y: 0, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 0, type: 'exit', heading: 'W' }
  ],
  wagons: [{ x: 0, y: 0, number: 1 }],
  objectives: { couple: 'all-in-order', passengers: 0 }
};

console.log('INITIAL STATE:');
console.log('Loco at (0,0), heading E');
console.log('Wagon #1 at (0,0)');
console.log('Track: (1,0)-(2,0)-(3,0)->Exit at (4,0)');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

// Manually trace tick 0
console.log('\n--- TICK 0 ---');
console.log('Before: loco at', sim.loco.x, sim.loco.y);
console.log('Before: wagon #1 at', sim.free[0].x, sim.free[0].y);
console.log('Before: trail =', JSON.stringify(sim.trail));

sim.tick();

console.log('After: status =', sim.status);
console.log('After: fail reason =', sim.failReason);
console.log('After: loco at', sim.loco.x, sim.loco.y);
console.log('After: wagon #1 at', sim.free[0].x, sim.free[0].y);
console.log('After: trail =', JSON.stringify(sim.trail || 'N/A'));

if (sim.status === 'running') {
  console.log('\n--- TICK 1 ---');
  sim.tick();
  console.log('Status:', sim.status);
  console.log('Fail reason:', sim.failReason);
}
