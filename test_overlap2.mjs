import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Test 1: Two wagons at same position with valid track
const level1 = {
  id: 'wagon-wagon-overlap',
  world: 1,
  name: 'Bad',
  grid: { cols: 5, rows: 1 },
  trackBudget: 2,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [
    { x: 1, y: 0, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 0, type: 'exit', heading: 'W' }
  ],
  wagons: [
    { x: 1, y: 0, number: 1 },
    { x: 1, y: 0, number: 2 }
  ]
};

console.log('=== TEST 1: Two wagons at same position with valid track ===');
console.log('Wagons:', JSON.stringify(level1.wagons, null, 2));

const grid1 = buildGrid(level1);
const sim1 = new Simulation(grid1, level1);

console.log('Initial: status =', sim1.status);
console.log('Free wagons:', sim1.free.map(w => ({ x: w.x, y: w.y, number: w.number })));

sim1.tick();
console.log('After tick 1: status =', sim1.status);
if (sim1.status !== 'running') {
  console.log('  Fail reason:', sim1.failReason);
}
console.log('Free wagons:', sim1.free.map(w => ({ x: w.x, y: w.y, number: w.number })));

// Test 2: Wagon on rock
const level2 = {
  id: 'wagon-on-rock',
  world: 1,
  name: 'Bad2',
  grid: { cols: 5, rows: 1 },
  trackBudget: 2,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [
    { x: 1, y: 0, type: 'rock' },
    { x: 4, y: 0, type: 'exit', heading: 'W' }
  ],
  wagons: [
    { x: 1, y: 0, number: 1 }
  ]
};

console.log('\n=== TEST 2: Single wagon on rock ===');
console.log('Wagon at:', JSON.stringify(level2.wagons[0]));
console.log('Rock at: (1, 0)');

const grid2 = buildGrid(level2);
const sim2 = new Simulation(grid2, level2);

console.log('Initial: status =', sim2.status);
console.log('Free wagons:', sim2.free.map(w => ({ x: w.x, y: w.y, number: w.number })));

sim2.tick();
console.log('After tick 1: status =', sim2.status);
if (sim2.status !== 'running') {
  console.log('  Fail reason:', sim2.failReason);
}
console.log('Free wagons:', sim2.free.map(w => ({ x: w.x, y: w.y, number: w.number })));
