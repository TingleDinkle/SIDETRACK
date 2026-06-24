import { buildGrid } from './dist/level.js';
import { Simulation } from './dist/sim.js';
import { validateLevel } from './dist/levelValidate.js';

console.log('=== REAL WORLD IMPACT TEST ===\n');

// Test 1: Wagon at loco start, no track
console.log('Test 1: Wagon at loco start, NO track');
const level1 = {
  grid: { cols: 5, rows: 3 },
  locomotive: { x: 2, y: 1, heading: 'E' },
  wagons: [{ x: 2, y: 1, number: 1 }],
  fixedTiles: [{ x: 4, y: 1, type: 'exit', heading: 'W' }],
  trackBudget: 2,
  id: 'test1', world: 1, name: 'T1', objectives: {}
};
const issues1 = validateLevel(level1);
console.log('  Validation issues:', issues1.length);
if (issues1.length === 0) console.log('  ✗ NOT CAUGHT by validation');
const sim1 = new Simulation(buildGrid(level1), level1);
sim1.tick();
console.log('  Sim result:', sim1.status, '-', sim1.failReason);

// Test 2: Wagon at loco start, WITH track so loco can move
console.log('\nTest 2: Wagon at loco start, WITH track');
const level2 = {
  grid: { cols: 5, rows: 3 },
  locomotive: { x: 2, y: 1, heading: 'E' },
  wagons: [{ x: 2, y: 1, number: 1 }],
  fixedTiles: [
    { x: 2, y: 1, type: 'track', edges: ['E'] },
    { x: 3, y: 1, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 1, type: 'exit', heading: 'W' }
  ],
  trackBudget: 2,
  id: 'test2', world: 1, name: 'T2', objectives: {}
};
const issues2 = validateLevel(level2);
console.log('  Validation issues:', issues2.length);
if (issues2.length === 0) console.log('  ✗ NOT CAUGHT by validation');
const sim2 = new Simulation(buildGrid(level2), level2);
sim2.tick();
console.log('  Sim result:', sim2.status, '-', sim2.failReason);
console.log('  Wagon at (', sim2.free[0]?.x || 'coupled', sim2.free[0]?.y || '', ')');

// Test 3: Mover at loco start, with track
console.log('\nTest 3: Mover at loco start, WITH track');
const level3 = {
  grid: { cols: 5, rows: 3 },
  locomotive: { x: 2, y: 1, heading: 'E' },
  movers: [{ x: 2, y: 1, heading: 'E' }],
  fixedTiles: [
    { x: 2, y: 1, type: 'track', edges: ['E'] },
    { x: 3, y: 1, type: 'track', edges: ['W', 'E'] },
    { x: 4, y: 1, type: 'exit', heading: 'W' }
  ],
  trackBudget: 2,
  id: 'test3', world: 1, name: 'T3', objectives: {}
};
const issues3 = validateLevel(level3);
console.log('  Validation issues:', issues3.length);
if (issues3.length === 0) console.log('  ✗ NOT CAUGHT by validation');
const sim3 = new Simulation(buildGrid(level3), level3);
sim3.tick();
console.log('  Sim result:', sim3.status, '-', sim3.failReason);

console.log('\n=== SUMMARY ===');
console.log('The claim is REAL: wagon/mover at loco.x/y is not caught by validation');
console.log('Impact varies: might derail (no track) or be benign (track exists)');
console.log('But it\'s a MALFORMED LEVEL and should be caught');
