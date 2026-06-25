/**
 * Pure-logic self tests — run in Node with `npm test` (no DOM needed).
 *
 * These cover the parts of M1 that have real logic and that M2's simulation
 * will depend on: edge math, track classification, the exit-edge rule, and the
 * editor's lay/erase/budget/undo behaviour. Rendering and pointer handling are
 * verified by eye in the browser.
 */

import {
  EdgeBit,
  OPPOSITE,
  edgeCount,
  hasEdge,
  headingBetween,
} from './types.js';
import { classify, exitEdge } from './track.js';
import { Grid } from './grid.js';
import { Editor } from './editor.js';
import { Simulation } from './sim.js';
import { validateLevel } from './levelValidate.js';
import type { Level } from './level.js';
import type { Heading } from './types.js';

// Minimal ambient for Node's exit code, so we don't need @types/node here.
declare const process: { exit(code: number): never };

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.error('  FAIL:', name);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(`${name} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));
}

/* ----------------------------- edge math ----------------------------- */
eq('opposite N', OPPOSITE.N, 'S');
eq('opposite E', OPPOSITE.E, 'W');
eq('edgeCount N|S', edgeCount(EdgeBit.N | EdgeBit.S), 2);
eq('edgeCount all', edgeCount(15), 4);
ok('hasEdge', hasEdge(EdgeBit.E, 'E') && !hasEdge(EdgeBit.E, 'W'));
eq('headingBetween E', headingBetween(1, 1, 2, 1), 'E');
eq('headingBetween N', headingBetween(1, 1, 1, 0), 'N');
eq('headingBetween diagonal', headingBetween(1, 1, 2, 2), null);
eq('headingBetween far', headingBetween(1, 1, 3, 1), null);

/* ----------------------------- classify ----------------------------- */
eq('classify none', classify(0), 'none');
eq('classify stub', classify(EdgeBit.N), 'stub');
eq('classify straight NS', classify(EdgeBit.N | EdgeBit.S), 'straight');
eq('classify straight EW', classify(EdgeBit.E | EdgeBit.W), 'straight');
eq('classify curve NE', classify(EdgeBit.N | EdgeBit.E), 'curve');
eq('classify curve SW', classify(EdgeBit.S | EdgeBit.W), 'curve');
eq('classify junction', classify(EdgeBit.N | EdgeBit.E | EdgeBit.S), 'junction');
eq('classify crossing', classify(15), 'crossing');

/* ----------------------------- exitEdge ----------------------------- */
eq('exit straight through', exitEdge(EdgeBit.N | EdgeBit.S, 'N'), 'S');
eq('exit curve turn', exitEdge(EdgeBit.N | EdgeBit.E, 'N'), 'E');
eq('exit derail off-track', exitEdge(EdgeBit.N | EdgeBit.S, 'E'), null);
eq('exit crossing straight', exitEdge(15, 'N'), 'S');
eq('exit junction branch 0', exitEdge(EdgeBit.N | EdgeBit.E | EdgeBit.S, 'N', 0), 'E');
eq('exit junction branch 1', exitEdge(EdgeBit.N | EdgeBit.E | EdgeBit.S, 'N', 1), 'S');

/* ----------------- editor: lay + shape + budget ----------------- */
{
  const g = new Grid(3, 1); // 3 editable cells in a row
  const ed = new Editor(g, 3);
  ed.beginStroke();
  ok('lay 0→1', ed.layStep(0, 0, 1, 0)); // both empty → cost 2
  eq('used after first segment', ed.budgetUsed(), 2);
  ok('lay 1→2', ed.layStep(1, 0, 2, 0)); // cell2 new → cost 1
  eq('used after second segment', ed.budgetUsed(), 3);
  eq('cell1 is straight', classify(g.get(1, 0)!.mask), 'straight');
  eq('cell0 is stub', classify(g.get(0, 0)!.mask), 'stub');
  ed.endStroke();

  // undo / redo
  ed.undo();
  eq('used after undo', ed.budgetUsed(), 0);
  ed.redo();
  eq('used after redo', ed.budgetUsed(), 3);

  // erase an end cell: neighbour loses its dangling edge.
  ed.beginStroke();
  ok('erase end cell0', ed.eraseAt(0, 0));
  ed.endStroke();
  eq('used after erase', ed.budgetUsed(), 2);
  eq('cell1 now stub', classify(g.get(1, 0)!.mask), 'stub');
}

/* ----------------- editor: budget enforcement ----------------- */
{
  const g = new Grid(4, 1);
  const ed = new Editor(g, 2); // only two cells of track allowed
  ed.beginStroke();
  ok('lay 0→1 within budget', ed.layStep(0, 0, 1, 0)); // cost 2 → used 2
  eq('used at cap', ed.budgetUsed(), 2);
  ok('lay 1→2 rejected (over budget)', !ed.layStep(1, 0, 2, 0));
  eq('cell2 untouched', g.get(2, 0)!.mask, 0);
  ed.endStroke();
}

/* ----------------- editor: rocks block laying ----------------- */
{
  const g = new Grid(3, 1);
  g.get(1, 0)!.type = 'rock';
  g.get(1, 0)!.fixed = true;
  const ed = new Editor(g, 5);
  ed.beginStroke();
  ok('cannot lay into a rock', !ed.layStep(0, 0, 1, 0));
  ed.endStroke();
}

/* ----------------- simulation: movement / coupling / win / lose ----------------- */
{
  const NS = EdgeBit.N | EdgeBit.S;
  const EW = EdgeBit.E | EdgeBit.W;

  const track = (g: Grid, x: number, y: number, mask: number): void => {
    const c = g.get(x, y)!;
    c.type = 'track';
    c.mask = mask;
  };
  const start = (g: Grid, x: number, y: number, h: Heading): void => {
    const c = g.get(x, y)!;
    c.type = 'start';
    c.fixed = true;
    c.heading = h;
    c.mask = EdgeBit[h];
  };
  const exit = (g: Grid, x: number, y: number, edge: Heading): void => {
    const c = g.get(x, y)!;
    c.type = 'exit';
    c.fixed = true;
    c.heading = edge;
    c.mask = EdgeBit[edge];
  };
  const lvl = (
    cols: number,
    rows: number,
    loco: { x: number; y: number; heading: Heading },
    wagons: { x: number; y: number; number: number }[] = [],
  ): Level =>
    ({
      id: 't',
      world: 0,
      name: 't',
      grid: { cols, rows },
      trackBudget: 0,
      fixedTiles: [],
      locomotive: loco,
      wagons,
    }) as Level;
  const run = (g: Grid, level: Level, maxT = 300): Simulation => {
    const s = new Simulation(g, level);
    let n = 0;
    while (s.status === 'running' && n++ < maxT) s.tick();
    return s;
  };

  // A) straight run to the exit, no wagons -> win
  {
    const g = new Grid(4, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    track(g, 2, 0, EW);
    exit(g, 3, 0, 'W');
    const s = run(g, lvl(4, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: straight run wins', s.status, 'won');
  }

  // B) couple wagon #1 in order, then reach exit -> win
  {
    const g = new Grid(5, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    track(g, 2, 0, EW); // wagon sits here
    track(g, 3, 0, EW);
    exit(g, 4, 0, 'W');
    const s = run(g, lvl(5, 1, { x: 0, y: 0, heading: 'E' }, [{ x: 2, y: 0, number: 1 }]));
    eq('sim: couple-in-order wins', s.status, 'won');
    eq('sim: wagon is coupled', s.coupled.length, 1);
  }

  // C) couple two wagons in order across a turn -> win (exercises the snake)
  {
    const g = new Grid(4, 3);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    track(g, 2, 0, EdgeBit.W | EdgeBit.S); // curve down
    track(g, 2, 1, NS);
    track(g, 2, 2, EdgeBit.N | EdgeBit.W); // curve to west
    track(g, 1, 2, EW);
    exit(g, 0, 2, 'E');
    const s = run(
      g,
      lvl(4, 3, { x: 0, y: 0, heading: 'E' }, [
        { x: 1, y: 0, number: 1 },
        { x: 2, y: 1, number: 2 },
      ]),
    );
    eq('sim: two-wagon snake wins', s.status, 'won');
    eq('sim: both coupled', s.coupled.length, 2);
  }

  // D) wagons present but encountered out of order -> lose
  {
    const g = new Grid(6, 1);
    start(g, 0, 0, 'E');
    for (let x = 1; x <= 4; x++) track(g, x, 0, EW);
    exit(g, 5, 0, 'W');
    const s = run(
      g,
      lvl(6, 1, { x: 0, y: 0, heading: 'E' }, [
        { x: 2, y: 0, number: 2 }, // hit first, but #1 is expected
        { x: 4, y: 0, number: 1 },
      ]),
    );
    eq('sim: out-of-order loses', s.status, 'lost');
  }

  // E) a dead-end stub doesn't stop the train — it coasts straight off the board -> lose
  {
    const g = new Grid(3, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EdgeBit.W); // stub; the train rolls past it and off the edge
    const s = run(g, lvl(3, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: coasting off the board derails', s.status, 'lost');
  }

  // E2) the train coasts straight through empty cells to a straight-ahead exit -> win
  {
    const g = new Grid(4, 1);
    start(g, 0, 0, 'E');
    // (1,0) and (2,0) left empty — no track needed on the straight
    exit(g, 3, 0, 'W');
    const s = run(g, lvl(4, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: coasts straight through gaps to the exit', s.status, 'won');
  }

  // E3) a lone curve redirects the coasting train; straights need no track -> win
  {
    const g = new Grid(3, 3);
    start(g, 0, 0, 'E');
    track(g, 2, 0, EdgeBit.W | EdgeBit.S); // the only track: a curve that turns it south
    exit(g, 2, 2, 'N');
    const s = run(g, lvl(3, 3, { x: 0, y: 0, heading: 'E' }));
    eq('sim: a lone curve steers the coasting train to the exit', s.status, 'won');
  }

  // F) reach exit without coupling a required wagon -> lose
  {
    const g = new Grid(4, 2);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    track(g, 2, 0, EW);
    exit(g, 3, 0, 'W');
    const s = run(g, lvl(4, 2, { x: 0, y: 0, heading: 'E' }, [{ x: 1, y: 1, number: 1 }]));
    eq('sim: incomplete at exit loses', s.status, 'lost');
  }

  // G) determinism: same setup runs identically twice
  {
    const build = (): [Grid, Level] => {
      const g = new Grid(5, 1);
      start(g, 0, 0, 'E');
      track(g, 1, 0, EW);
      track(g, 2, 0, EW);
      track(g, 3, 0, EW);
      exit(g, 4, 0, 'W');
      return [g, lvl(5, 1, { x: 0, y: 0, heading: 'E' }, [{ x: 2, y: 0, number: 1 }])];
    };
    const [g1, l1] = build();
    const [g2, l2] = build();
    const a = run(g1, l1);
    const b = run(g2, l2);
    eq('sim: deterministic status', a.status, b.status);
    eq('sim: deterministic ticks', a.ticks, b.ticks);
  }

  /* --------- M3 mechanics: tunnels / gates+buttons / signals --------- */
  const tunnel = (g: Grid, x: number, y: number, edge: Heading, pairId: number): void => {
    const c = g.get(x, y)!;
    c.type = 'tunnel';
    c.fixed = true;
    c.pairId = pairId;
    c.mask = EdgeBit[edge];
  };
  const special = (g: Grid, x: number, y: number, type: 'button' | 'gate' | 'signal' | 'switch', mask: number, opts: { color?: string; open?: boolean } = {}): void => {
    const c = g.get(x, y)!;
    c.type = type;
    c.fixed = true;
    c.mask = mask;
    if (opts.color) c.color = opts.color;
    if (opts.open !== undefined) c.open = opts.open;
  };

  // H) tunnel teleports the loco across the board to the exit -> win
  {
    const g = new Grid(3, 3);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    tunnel(g, 2, 0, 'W', 1); // enter here (mouth faces the track to its west)
    tunnel(g, 2, 2, 'W', 1); // emerge here, heading W toward (1,2)
    track(g, 1, 2, EW);
    exit(g, 0, 2, 'E');
    const s = run(g, lvl(3, 3, { x: 0, y: 0, heading: 'E' }));
    eq('sim: tunnel reaches exit', s.status, 'won');
  }

  // I) a button opens a same-colour gate so the loco can pass -> win
  {
    const g = new Grid(6, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    special(g, 2, 0, 'button', EW, { color: 'red' });
    track(g, 3, 0, EW);
    special(g, 4, 0, 'gate', EW, { color: 'red', open: false }); // closed until the button
    exit(g, 5, 0, 'W');
    const s = run(g, lvl(6, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: button opens gate -> win', s.status, 'won');
  }

  // J) a closed gate with no button blocks forever -> lose (out of time)
  {
    const g = new Grid(5, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    track(g, 2, 0, EW);
    special(g, 3, 0, 'gate', EW, { color: 'red', open: false });
    exit(g, 4, 0, 'W');
    const s = run(g, lvl(5, 1, { x: 0, y: 0, heading: 'E' }), 400);
    eq('sim: unbuttoned gate blocks -> lose', s.status, 'lost');
  }

  // J2) a master (colourless) button opens EVERY gate, of any colour -> win
  {
    const g = new Grid(7, 1);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    special(g, 2, 0, 'button', EW, {}); // no colour = master
    special(g, 3, 0, 'gate', EW, { color: 'red', open: false });
    special(g, 4, 0, 'gate', EW, { color: 'blue', open: false });
    track(g, 5, 0, EW);
    exit(g, 6, 0, 'W');
    const s = run(g, lvl(7, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: master button opens all gates -> win', s.status, 'won');
  }

  // J3) a small (coloured) button only opens its own colour, not others -> lose
  {
    const g = new Grid(6, 1);
    start(g, 0, 0, 'E');
    special(g, 1, 0, 'button', EW, { color: 'red' }); // red button...
    track(g, 2, 0, EW);
    special(g, 3, 0, 'gate', EW, { color: 'blue', open: false }); // ...can't open a blue gate
    track(g, 4, 0, EW);
    exit(g, 5, 0, 'W');
    const s = run(g, lvl(6, 1, { x: 0, y: 0, heading: 'E' }), 400);
    eq('sim: small button leaves other colours shut -> lose', s.status, 'lost');
  }

  // K) a closed signal holds the loco one tick, then opens -> win
  {
    const g = new Grid(4, 1);
    start(g, 0, 0, 'E');
    special(g, 1, 0, 'signal', EW, { open: false }); // closed on the first tick
    track(g, 2, 0, EW);
    exit(g, 3, 0, 'W');
    const s = run(g, lvl(4, 1, { x: 0, y: 0, heading: 'E' }));
    eq('sim: signal holds then opens -> win', s.status, 'won');
    ok('sim: signal cost a wait tick', s.ticks >= 4);
  }

  // L) a switch flips a same-coloured junction's active branch
  {
    const g = new Grid(3, 3);
    const j = g.get(2, 2)!; // an isolated coloured junction
    j.type = 'track';
    j.mask = EdgeBit.N | EdgeBit.E | EdgeBit.S;
    j.color = 'blue';
    start(g, 0, 0, 'E');
    special(g, 1, 0, 'switch', EW, { color: 'blue' });
    exit(g, 2, 0, 'W');
    const idx = g.idx(2, 2);
    const s = new Simulation(g, lvl(3, 3, { x: 0, y: 0, heading: 'E' }));
    const before = s.junctionBranch(idx);
    s.tick(); // loco enters the switch -> flips blue junctions
    ok('sim: switch flips junction branch', before !== s.junctionBranch(idx));
  }

  // M) Hold booster: a frozen closed signal never opens -> loco stuck -> lose
  {
    const mk = (): Grid => {
      const g = new Grid(4, 1);
      start(g, 0, 0, 'E');
      special(g, 1, 0, 'signal', EW, { open: false }); // closed
      track(g, 2, 0, EW);
      exit(g, 3, 0, 'W');
      return g;
    };
    const lv = lvl(4, 1, { x: 0, y: 0, heading: 'E' });
    eq('hold: signal flips normally -> win', run(mk(), lv).status, 'won');
    const g2 = mk();
    const held = new Set(['sig:' + g2.idx(1, 0)]);
    const s2 = new Simulation(g2, lv, held);
    let n = 0;
    while (s2.status === 'running' && n++ < 400) s2.tick();
    eq('hold: frozen closed signal -> lose', s2.status, 'lost');
  }

  // N) a long train threading a self-crossing overlaps itself there — NOT a collision
  {
    const X = EdgeBit.N | EdgeBit.E | EdgeBit.S | EdgeBit.W;
    const g = new Grid(3, 3);
    start(g, 0, 1, 'E');
    track(g, 1, 1, X); // crossing
    track(g, 2, 1, EdgeBit.W | EdgeBit.N);
    track(g, 2, 0, EdgeBit.S | EdgeBit.W);
    track(g, 1, 0, EdgeBit.E | EdgeBit.S);
    track(g, 1, 2, EdgeBit.N | EdgeBit.W);
    track(g, 0, 2, EdgeBit.E | EdgeBit.N);
    const wag = [
      { x: 1, y: 1, number: 1 },
      { x: 2, y: 1, number: 2 },
      { x: 2, y: 0, number: 3 },
      { x: 1, y: 0, number: 4 },
    ];
    const s = new Simulation(g, lvl(3, 3, { x: 0, y: 1, heading: 'E' }, wag));
    let n = 0;
    while (s.status === 'running' && n++ < 6) s.tick();
    ok('sim: train threads a crossing without a false collision', s.failReason !== 'collision');
    eq('sim: all 4 wagons couple through the crossing', s.coupled.length, 4);
  }

  // O) a coloured button fires once per train PASS, not once per car (no length parity)
  {
    const build = (nWag: number): Simulation => {
      const g = new Grid(10, 2);
      start(g, 0, 0, 'E');
      const wag: { x: number; y: number; number: number }[] = [];
      for (let x = 1; x <= 8; x++) track(g, x, 0, EW);
      for (let i = 1; i <= nWag; i++) wag.push({ x: i, y: 0, number: i });
      special(g, 6, 0, 'button', EW, { color: 'red' });
      special(g, 0, 1, 'gate', NS, { color: 'red', open: true }); // off-path, just holds the red state
      exit(g, 9, 0, 'W');
      return run(g, lvl(10, 2, { x: 0, y: 0, heading: 'E' }, wag), 80);
    };
    eq('sim: toggle button is train-length independent', build(1).gateIsOpen('red'), build(3).gateIsOpen('red'));
  }

  // P) a wagon parked on a tunnel's EXIT couples there instead of being a collision
  {
    const g = new Grid(3, 3);
    start(g, 0, 0, 'E');
    track(g, 1, 0, EW);
    tunnel(g, 2, 0, 'W', 1);
    tunnel(g, 2, 2, 'W', 1);
    track(g, 1, 2, EW);
    exit(g, 0, 2, 'E');
    const s = run(g, lvl(3, 3, { x: 0, y: 0, heading: 'E' }, [{ x: 2, y: 2, number: 1 }]));
    eq('sim: wagon on tunnel exit couples -> win', s.status, 'won');
    eq('sim: that wagon is coupled', s.coupled.length, 1);
  }

  // R) same-colour gates with conflicting open flags fold to closed, order-independently
  {
    const mk = (firstOpen: boolean): Simulation => {
      const g = new Grid(4, 1);
      start(g, 0, 0, 'E');
      special(g, 1, 0, 'gate', EW, { color: 'red', open: firstOpen });
      special(g, 2, 0, 'gate', EW, { color: 'red', open: !firstOpen });
      exit(g, 3, 0, 'W');
      return new Simulation(g, lvl(4, 1, { x: 0, y: 0, heading: 'E' }));
    };
    eq('sim: conflicting same-colour gates fold to closed', mk(true).gateIsOpen('red'), false);
    eq('sim: gate fold is order-independent', mk(true).gateIsOpen('red'), mk(false).gateIsOpen('red'));
  }
}

/* ----------------- level validation (editor edge cases) ----------------- */
{
  const good = {
    id: 't',
    world: 1,
    name: 't',
    grid: { cols: 5, rows: 3 },
    trackBudget: 5,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [{ x: 4, y: 1, type: 'exit', heading: 'W' }],
    wagons: [],
    movers: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  } as unknown as Level;
  const errs = (l: Level): number => validateLevel(l).filter((i) => i.level === 'error').length;
  const with_ = (patch: Partial<Level>): Level => ({ ...good, ...patch }) as Level;

  ok('validate: clean level has no errors', errs(good) === 0);
  ok('validate: no exit -> error', errs(with_({ fixedTiles: [] })) > 0);
  ok('validate: loco off-grid -> error', errs(with_({ locomotive: { x: 99, y: 0, heading: 'E' } })) > 0);
  ok('validate: wagon number gap -> error', errs(with_({ wagons: [{ x: 1, y: 1, number: 1 }, { x: 2, y: 1, number: 3 }] })) > 0);
  ok('validate: wagon on loco -> error', errs(with_({ wagons: [{ x: 0, y: 1, number: 1 }] })) > 0);
  ok(
    'validate: colourless gate -> error',
    errs(with_({ fixedTiles: [{ x: 4, y: 1, type: 'exit', heading: 'W' }, { x: 2, y: 1, type: 'gate', edges: ['W', 'E'] }] })) > 0,
  );
  ok(
    'validate: lone tunnel -> error',
    errs(with_({ fixedTiles: [{ x: 4, y: 1, type: 'exit', heading: 'W' }, { x: 2, y: 1, type: 'tunnel', edges: ['W'], pairId: 1 }] })) > 0,
  );
  ok(
    'validate: multi-edge tunnel -> error',
    errs(
      with_({
        fixedTiles: [
          { x: 4, y: 1, type: 'exit', heading: 'W' },
          { x: 2, y: 1, type: 'tunnel', edges: ['W'], pairId: 1 },
          { x: 1, y: 1, type: 'tunnel', edges: ['N', 'S'], pairId: 1 },
        ],
      }),
    ) > 0,
  );
}

/* ----------------------------- report ----------------------------- */
console.log(`\nSidetrack self-tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
