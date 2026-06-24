import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

const level = {
  id: 'wagon-at-loco-start-with-track',
  world: 1,
  name: 'Edge Case: Wagon at Locomotive Start (with track)',
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

console.log('Testing wagon at loco start with proper track...');
console.log('Locomotive:', JSON.stringify(level.locomotive));
console.log('Wagons:', JSON.stringify(level.wagons, null, 2));

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nSimulation state before tick:');
console.log('Loco:', sim.loco.x, sim.loco.y);
console.log('Free wagons:', sim.free.map(w => ({ x: w.x, y: w.y, number: w.number })));

// Attempt first tick
console.log('\nTick 0:');
sim.tick();
console.log('Status:', sim.status);
console.log('Fail reason:', sim.failReason);

if (sim.status === 'running') {
  console.log('Loco after tick:', sim.loco.x, sim.loco.y);
  console.log('Free wagons:', sim.free.map(w => ({ x: w.x, y: w.y, number: w.number })));
}
