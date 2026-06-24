import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

const level = {
  id: 'wagon-wagon-overlap',
  world: 1,
  name: 'Bad',
  grid: { cols: 5, rows: 1 },
  trackBudget: 2,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [{ x: 4, y: 0, type: 'exit', heading: 'W' }],
  wagons: [
    { x: 1, y: 0, number: 1 },
    { x: 1, y: 0, number: 2 }
  ]
};

console.log('Testing wagon overlap at startup...');
console.log('Wagons:', JSON.stringify(level.wagons, null, 2));

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('\nSimulation created successfully');
console.log('Loco position:', sim.loco.x, sim.loco.y);
console.log('Free wagons:', sim.free.map(w => ({ x: w.x, y: w.y, number: w.number })));
console.log('Initial status:', sim.status);

// Attempt first tick
sim.tick();
console.log('\nAfter first tick:');
console.log('Status:', sim.status);
console.log('Fail reason:', sim.failReason);
console.log('Free wagons:', sim.free.map(w => ({ x: w.x, y: w.y, number: w.number })));
