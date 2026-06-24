import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

const level = {
  id: 'wagon-at-loco',
  world: 1,
  name: 'Test collision',
  grid: { cols: 5, rows: 3 },
  trackBudget: 3,
  locomotive: { x: 2, y: 1, heading: 'E' },
  fixedTiles: [
    { x: 2, y: 1, type: 'track', edges: ['E'] },
    { x: 3, y: 1, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 1, type: 'exit', heading: 'W' }
  ],
  wagons: [{ x: 2, y: 1, number: 1 }],
  movers: [{ x: 2, y: 1, heading: 'E' }],
  objectives: { couple: 'all-in-order', passengers: 0 }
};

console.log('Testing loco + wagon + mover all at (2,1) with track...');

const grid = buildGrid(level);
const sim = new Simulation(grid, level);

console.log('Before tick:');
console.log('Loco: (', sim.loco.x, ',', sim.loco.y, ')');
console.log('Wagon #1: (', sim.free[0].x, ',', sim.free[0].y, ')');
console.log('Mover: (', sim.movers[0].x, ',', sim.movers[0].y, ')');

console.log('\nTicking...');
sim.tick();

console.log('\nAfter tick:');
console.log('Status:', sim.status);
console.log('Fail reason:', sim.failReason);
console.log('Loco: (', sim.loco.x, ',', sim.loco.y, ')');
console.log('Wagon #1 (free):', sim.free.length > 0 ? `(${sim.free[0].x},${sim.free[0].y})` : 'coupled');
console.log('Mover:', sim.movers.length > 0 ? `(${sim.movers[0].x},${sim.movers[0].y}, alive=${sim.movers[0].alive})` : 'removed');
