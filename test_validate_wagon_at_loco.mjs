import { validateLevel } from './dist/levelValidate.js';

const level = {
  id: 'wagon-at-loco-start',
  world: 1,
  name: 'Edge Case: Wagon at Locomotive Start',
  grid: { cols: 5, rows: 2 },
  trackBudget: 3,
  locomotive: { x: 0, y: 0, heading: 'E' },
  fixedTiles: [{ x: 4, y: 0, type: 'exit', heading: 'W' }],
  wagons: [{ x: 0, y: 0, number: 1 }],
  objectives: { couple: 'all-in-order', passengers: 0 }
};

console.log('Level to validate:');
console.log('Loco:', level.locomotive);
console.log('Wagons:', level.wagons);

const issues = validateLevel(level);

console.log('\nValidation issues:', issues.length);
for (const issue of issues) {
  console.log(`[${issue.level.toUpperCase()}] ${issue.msg}`);
}

if (issues.length === 0) {
  console.log('✗ NO ISSUES FOUND! (This is the problem - wagon at loco start should be caught)');
} else {
  console.log('\n✓ Issues detected');
  const hasWagonLocoProblem = issues.some(i => i.msg.includes('wagon') && (i.msg.includes('loco') || i.msg.includes('overlap')));
  if (!hasWagonLocoProblem) {
    console.log('But none specifically about wagon at loco position!');
  }
}
