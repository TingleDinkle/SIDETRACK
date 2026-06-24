import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';

// Test 3: Wagon on rock with valid loco path that doesn't interact with wagon
const level3 = {
  id: 'wagon-on-rock-isolated',
  world: 1,
  name: 'Bad3',
  grid: { cols: 6, rows: 2 },
  trackBudget: 2,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [
    { x: 1, y: 1, type: 'rock' },
    { x: 5, y: 0, type: 'exit', heading: 'W' }
  ],
  wagons: [
    { x: 1, y: 1, number: 1 }  // wagon on the rock
  ]
};

console.log('=== TEST 3: Wagon on rock (loco path on different row) ===');
console.log('Loco at: (0, 0) heading E');
console.log('Wagon at: (1, 1)');
console.log('Rock at: (1, 1)');
console.log('Exit at: (5, 0)');

const grid3 = buildGrid(level3);
const sim3 = new Simulation(grid3, level3);

console.log('\nInitial: status =', sim3.status);
console.log('Free wagons:', sim3.free.map(w => ({ x: w.x, y: w.y, number: w.number })));

// Need to provide a valid track for the loco to move
grid3.get(1, 0).type = 'track';
grid3.get(1, 0).mask = 0b1010; // edges W and E
grid3.get(2, 0).type = 'track';
grid3.get(2, 0).mask = 0b1010;
grid3.get(3, 0).type = 'track';
grid3.get(3, 0).mask = 0b1010;
grid3.get(4, 0).type = 'track';
grid3.get(4, 0).mask = 0b1010;

for (let i = 0; i < 3; i++) {
  sim3.tick();
  console.log(`After tick ${i + 1}: status = ${sim3.status}`);
  if (sim3.status !== 'running') {
    console.log(`  Fail reason: ${sim3.failReason}`);
    break;
  }
  console.log(`  Loco at: (${sim3.loco.x}, ${sim3.loco.y})`);
  console.log(`  Free wagons: ${JSON.stringify(sim3.free.map(w => ({ x: w.x, y: w.y })))}`);
}
