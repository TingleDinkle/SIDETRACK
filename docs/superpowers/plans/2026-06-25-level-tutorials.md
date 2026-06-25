# Level Tutorials with Blur-Spotlight Highlighting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the six mechanic-introducing levels, play a short tap-to-advance tutorial that spotlights the relevant object(s) crisply while the rest of the board is blurred and dimmed; after dismissal the level plays exactly as today.

**Architecture:** A new pure `Tutorial` controller (in `src/tutorial.ts`) drives a step sequence; per-step "what to highlight" is authored as data in `src/tutorialData.ts` and resolved to grid cells against the live level. The renderer gains one additive `drawTutorialSpotlight()` method (true canvas blur + dim + crisp cell window + glow ring), invoked from the game loop the same way `drawHoldOverlay`/`markFrozen` already are. `game.ts` owns the controller, gates input/Play/Step while active, and starts the tutorial from `loadLevel`. A caption card + `?` replay button are added to `index.html` and wired in `main.ts`.

**Tech Stack:** TypeScript (ES modules, `strict`), HTML5 Canvas 2D, no framework, zero runtime deps. Build = `npm run build` (`tsc` → `dist/`, then `tools/genlevels.mjs`). Tests = `npm test` (`node dist/selftest.js && node dist/leveltest.js`).

## Global Constraints

- **Zero runtime dependencies** — pure model files stay DOM-free; only `render.ts`, `game.ts`, `main.ts` touch the DOM/canvas.
- **No changes to** simulation (`sim.ts`), level data (`levelData.ts`/`levels.json`), or mechanic behaviour. The feature is strictly additive.
- **Coordinate convention:** grid is `cols × rows`, origin top-left; headings N/E/S/W; E increases x, S increases y.
- **Build output is committed:** `dist/` must be rebuilt and committed so the served game includes the feature.
- **Trigger:** tutorial shows on **every visit** to a tutorial level; always skippable; **no persistence**.
- **Module imports use the `.js` extension** in TypeScript source (NodeNext resolution), e.g. `import { Grid } from './grid.js'`.
- **Tutorial levels & highlights (verbatim copy):**
  - `1-2` → rocks: "Boulders block the line. You can't lay track over a rock — route around them to reach the exit."
  - `1-3` → wagon: "This is a wagon. Drive the engine over it to couple it on." / exit: "Then haul it to the exit. Wagons couple in number order."
  - `2-1` → tunnel (3,1): "Tunnels come in pairs. Send the train into one mouth…" / tunnel (5,1): "…and it pops out of its partner across the map, slipping past the rock."
  - `3-1` → gate: "This gate bars the track and starts shut." / button: "Roll over its matching button to open it. Same colour = linked."
  - `4-1` → signal: "A signal holds the train on red and passes it on green. It flips every few ticks — time your run to arrive on green."
  - `4-3` → mover: "This trolley roams the rails on its own, back and forth." / crossing (2,2): "Your line crosses its path here. Don't be on the crossing when it passes, or you'll collide — time it."

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tutorial.ts` | **New.** `StepTarget`/`TutorialStep`/`TutorialScript` types, `resolveTarget()`, and the `Tutorial` controller (step state, cached cells). Pure logic, DOM-free, unit-tested. |
| `src/tutorialData.ts` | **New.** `TUTORIALS: Record<string, TutorialScript>` — the six authored scripts keyed by level id. |
| `src/render.ts` | Add `drawTutorialSpotlight(cells, tMs)` + a lazy offscreen "sharp" canvas. No change to `draw()`. |
| `src/game.ts` | Extend `Hud` (tutorial card refs + `btnHelp`); own a `Tutorial`; start it in `loadLevel`; gate input + Play/Step; render the spotlight each frame; add `tutorialNext/tutorialSkip/replayTutorial/tutorialActive/hasTutorial`. |
| `index.html` | `#tutorial` caption card inside `#stage` + `#btn-help` button + their CSS. |
| `src/main.ts` | Provide the new `Hud` refs; wire Next/Skip/`?`; guard booster clicks while a tutorial is active. |
| `src/selftest.ts` | Assertions for `resolveTarget` + `Tutorial` progression + script integrity. |

---

## Task 1: `Tutorial` controller + `resolveTarget` (pure logic, TDD)

**Files:**
- Create: `src/tutorial.ts`
- Test: `src/selftest.ts` (append a new section before the `/* ---- report ---- */` block)

**Interfaces:**
- Consumes: `Grid` from `./grid.js` (`grid.cells: Cell[]`, each `{x,y,type}`); `Level` from `./level.js` (`level.wagons?: {x,y,number}[]`, `level.movers?: {x,y,heading}[]`); `TileType` from `./types.js`.
- Produces (used by Tasks 2, 3, 4):
  - `type StepTarget = { tile: TileType } | { entity: 'wagon' | 'mover' } | { cells: { x: number; y: number }[] }`
  - `interface TutorialStep { text: string; target: StepTarget }`
  - `interface TutorialScript { steps: TutorialStep[] }`
  - `function resolveTarget(target: StepTarget, grid: Grid, level: Level): { x: number; y: number }[]`
  - `class Tutorial` with: `start(script, grid, level): void`, `active(): boolean`, `next(): boolean` (false when finished — and it auto-ends), `end(): void`, `cells(): {x,y}[]`, `text(): string`, `stepInfo(): { index: number; total: number }` (1-based), `isLast(): boolean`.

- [ ] **Step 1: Write the failing tests**

First add these imports alongside the existing imports at the top of `src/selftest.ts` (e.g. after the `import { validateLevel } from './levelValidate.js';` line):

```ts
import { buildGrid } from './level.js';
import { resolveTarget, Tutorial } from './tutorial.js';
```

Then append this test section to `src/selftest.ts` immediately before the `/* ----------------------------- report ----------------------------- */` line near the end of the file:

```ts
/* ----------------------------- tutorial ----------------------------- */
{
  // A tiny level with one rock, one wagon, one mover, an exit, a tunnel pair.
  const lv = {
    id: 't-1',
    world: 1,
    name: 'tut',
    grid: { cols: 6, rows: 3 },
    trackBudget: 5,
    locomotive: { x: 0, y: 1, heading: 'E' },
    fixedTiles: [
      { x: 5, y: 1, type: 'exit', heading: 'W' },
      { x: 2, y: 0, type: 'rock' },
      { x: 1, y: 2, type: 'tunnel', edges: ['E'], pairId: 1 },
      { x: 3, y: 2, type: 'tunnel', edges: ['W'], pairId: 1 },
    ],
    wagons: [{ x: 3, y: 1, number: 1 }],
    movers: [{ x: 4, y: 2, heading: 'N' }],
    objectives: { couple: 'all-in-order', passengers: 0 },
  } as unknown as Level;
  const g = buildGrid(lv);

  eq('resolveTarget tile rock', resolveTarget({ tile: 'rock' }, g, lv), [{ x: 2, y: 0 }]);
  eq('resolveTarget tile tunnel (both)', resolveTarget({ tile: 'tunnel' }, g, lv), [{ x: 1, y: 2 }, { x: 3, y: 2 }]);
  eq('resolveTarget entity wagon', resolveTarget({ entity: 'wagon' }, g, lv), [{ x: 3, y: 1 }]);
  eq('resolveTarget entity mover', resolveTarget({ entity: 'mover' }, g, lv), [{ x: 4, y: 2 }]);
  eq('resolveTarget explicit cells', resolveTarget({ cells: [{ x: 2, y: 2 }] }, g, lv), [{ x: 2, y: 2 }]);

  const tut = new Tutorial();
  ok('tutorial inactive before start', !tut.active());
  tut.start({ steps: [
    { text: 'one', target: { tile: 'rock' } },
    { text: 'two', target: { tile: 'exit' } },
  ] }, g, lv);
  ok('tutorial active after start', tut.active());
  eq('tutorial step1 text', tut.text(), 'one');
  eq('tutorial step1 cells', tut.cells(), [{ x: 2, y: 0 }]);
  eq('tutorial stepInfo 1/2', tut.stepInfo(), { index: 1, total: 2 });
  ok('tutorial step1 not last', !tut.isLast());
  ok('tutorial next advances', tut.next() === true);
  eq('tutorial step2 text', tut.text(), 'two');
  eq('tutorial step2 cells', tut.cells(), [{ x: 5, y: 1 }]);
  ok('tutorial step2 is last', tut.isLast());
  ok('tutorial next past end returns false', tut.next() === false);
  ok('tutorial inactive after finishing', !tut.active());

  const tut2 = new Tutorial();
  tut2.start({ steps: [{ text: 'solo', target: { tile: 'rock' } }] }, g, lv);
  ok('single-step tutorial is last immediately', tut2.isLast());
  tut2.end();
  ok('tutorial inactive after end()', !tut2.active());
}
```

Note: `tsconfig.json` is `module/target: ES2020`, so **top-level `await` is not allowed** (TS1378) — use the static imports above, never `await import(...)`. The `Level` type and the `eq`/`ok` helpers already exist in the file. `buildGrid` is a value import (separate from the existing `import type { Level }`).

- [ ] **Step 2: Build to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc` errors that `./tutorial.js` has no exported `resolveTarget`/`Tutorial` (module not found).

- [ ] **Step 3: Create `src/tutorial.ts`**

```ts
/**
 * Tutorial controller + step-target resolution.
 *
 * A tutorial is an ordered list of steps; each step names WHAT to spotlight by
 * selector (a tile type, an entity kind, or explicit cells), resolved against
 * the live grid/level so it survives coordinate edits. Pure logic, no DOM — the
 * Game drives it and the Renderer draws the cells it returns.
 */

import { Grid } from './grid.js';
import { Level } from './level.js';
import { TileType } from './types.js';

export type StepTarget =
  | { tile: TileType }
  | { entity: 'wagon' | 'mover' }
  | { cells: { x: number; y: number }[] };

export interface TutorialStep {
  text: string;
  target: StepTarget;
}

export interface TutorialScript {
  steps: TutorialStep[];
}

/** Resolve a step's target to the list of board cells it highlights. */
export function resolveTarget(target: StepTarget, grid: Grid, level: Level): { x: number; y: number }[] {
  if ('cells' in target) return target.cells.map((c) => ({ x: c.x, y: c.y }));
  if ('entity' in target) {
    const src = target.entity === 'wagon' ? (level.wagons ?? []) : (level.movers ?? []);
    return src.map((e) => ({ x: e.x, y: e.y }));
  }
  return grid.cells.filter((c) => c.type === target.tile).map((c) => ({ x: c.x, y: c.y }));
}

export class Tutorial {
  private script: TutorialScript | null = null;
  private grid: Grid | null = null;
  private level: Level | null = null;
  private step = 0;
  private cached: { x: number; y: number }[] = [];

  /** Begin a script over a level. Resolves the first step's cells immediately. */
  start(script: TutorialScript, grid: Grid, level: Level): void {
    this.script = script;
    this.grid = grid;
    this.level = level;
    this.step = 0;
    this.resolve();
  }

  active(): boolean {
    return this.script !== null;
  }

  /** Advance to the next step. Returns false (and auto-ends) when none remain. */
  next(): boolean {
    if (!this.script) return false;
    if (this.step + 1 >= this.script.steps.length) {
      this.end();
      return false;
    }
    this.step++;
    this.resolve();
    return true;
  }

  end(): void {
    this.script = null;
    this.grid = null;
    this.level = null;
    this.step = 0;
    this.cached = [];
  }

  cells(): { x: number; y: number }[] {
    return this.cached;
  }

  text(): string {
    return this.script ? this.script.steps[this.step].text : '';
  }

  /** 1-based current step and total, for the caption dots/label. */
  stepInfo(): { index: number; total: number } {
    return { index: this.step + 1, total: this.script ? this.script.steps.length : 0 };
  }

  isLast(): boolean {
    return !this.script || this.step + 1 >= this.script.steps.length;
  }

  private resolve(): void {
    if (!this.script || !this.grid || !this.level) {
      this.cached = [];
      return;
    }
    this.cached = resolveTarget(this.script.steps[this.step].target, this.grid, this.level);
  }
}
```

- [ ] **Step 4: Build + run tests to verify they pass**

Run: `npm run build && npm test`
Expected: PASS — self-tests report increases by the new assertions, `0 failed`. (`leveltest.js` unaffected.)

- [ ] **Step 5: Commit**

```bash
git add src/tutorial.ts src/selftest.ts
git commit -m "feat(tutorial): add Tutorial controller + step-target resolution"
```

---

## Task 2: The six tutorial scripts (data + integrity test)

**Files:**
- Create: `src/tutorialData.ts`
- Test: `src/selftest.ts` (extend the tutorial section from Task 1)

**Interfaces:**
- Consumes: `TutorialScript` from `./tutorial.js`; `LEVEL_LIBRARY` from `./levelData.js`; `buildGrid` from `./level.js`; `resolveTarget` from `./tutorial.js`.
- Produces (used by Task 4): `export const TUTORIALS: Record<string, TutorialScript>` — keys `1-2`, `1-3`, `2-1`, `3-1`, `4-1`, `4-3`.

- [ ] **Step 1: Write the failing test**

First add these imports at the top of `src/selftest.ts` (next to the Task 1 tutorial imports):

```ts
import { TUTORIALS } from './tutorialData.js';
import { LEVEL_LIBRARY } from './levelData.js';
```

Then append this block inside the tutorial `{ ... }` section (added in Task 1) in `src/selftest.ts`, just before that section's closing `}`:

```ts
  // Authored scripts: every key is a real level, and every non-explicit target
  // resolves to at least one cell on that level.
  {
    const byId = new Map(LEVEL_LIBRARY.map((l) => [l.id, l]));
    for (const [id, script] of Object.entries(TUTORIALS)) {
      const level = byId.get(id);
      ok(`tutorial ${id}: level exists`, !!level);
      ok(`tutorial ${id}: has steps`, script.steps.length > 0);
      if (!level) continue;
      const grid = buildGrid(level);
      script.steps.forEach((s, i) => {
        const cells = resolveTarget(s.target, grid, level);
        ok(`tutorial ${id} step ${i + 1}: resolves to >=1 cell`, cells.length > 0);
      });
    }
    eq('tutorial keys', Object.keys(TUTORIALS).sort(), ['1-2', '1-3', '2-1', '3-1', '4-1', '4-3']);
  }
```

- [ ] **Step 2: Build to verify it fails**

Run: `npm run build`
Expected: FAIL — `tsc` cannot find `./tutorialData.js` exporting `TUTORIALS`.

- [ ] **Step 3: Create `src/tutorialData.ts`**

```ts
/**
 * Tutorial scripts — one per mechanic-introducing level, keyed by level id.
 * Authored content (sibling of levelData.ts). Each step names what to spotlight
 * by selector; coords are only hardcoded where a selector can't single out one
 * object (the two tunnel mouths, the crossing tile).
 */

import { TutorialScript } from './tutorial.js';

export const TUTORIALS: Record<string, TutorialScript> = {
  '1-2': {
    steps: [
      {
        text: "Boulders block the line. You can't lay track over a rock — route around them to reach the exit.",
        target: { tile: 'rock' },
      },
    ],
  },
  '1-3': {
    steps: [
      { text: 'This is a wagon. Drive the engine over it to couple it on.', target: { entity: 'wagon' } },
      { text: 'Then haul it to the exit. Wagons couple in number order.', target: { tile: 'exit' } },
    ],
  },
  '2-1': {
    steps: [
      { text: 'Tunnels come in pairs. Send the train into one mouth…', target: { cells: [{ x: 3, y: 1 }] } },
      {
        text: '…and it pops out of its partner across the map, slipping past the rock.',
        target: { cells: [{ x: 5, y: 1 }] },
      },
    ],
  },
  '3-1': {
    steps: [
      { text: 'This gate bars the track and starts shut.', target: { tile: 'gate' } },
      { text: 'Roll over its matching button to open it. Same colour = linked.', target: { tile: 'button' } },
    ],
  },
  '4-1': {
    steps: [
      {
        text: 'A signal holds the train on red and passes it on green. It flips every few ticks — time your run to arrive on green.',
        target: { tile: 'signal' },
      },
    ],
  },
  '4-3': {
    steps: [
      { text: 'This trolley roams the rails on its own, back and forth.', target: { entity: 'mover' } },
      {
        text: "Your line crosses its path here. Don't be on the crossing when it passes, or you'll collide — time it.",
        target: { cells: [{ x: 2, y: 2 }] },
      },
    ],
  },
};
```

- [ ] **Step 4: Build + run tests to verify they pass**

Run: `npm run build && npm test`
Expected: PASS — `0 failed`. The integrity assertions confirm all six levels exist and every step resolves to ≥1 cell.

- [ ] **Step 5: Commit**

```bash
git add src/tutorialData.ts src/selftest.ts
git commit -m "feat(tutorial): author the six level tutorial scripts"
```

---

## Task 3: Renderer blur-spotlight

**Files:**
- Modify: `src/render.ts` — add two private fields after line 136 (`hoverCell`), and a new public method. No change to `draw()`.

**Interfaces:**
- Consumes: existing `this.canvas` (device-px backing store), `this.dpr`, `this.layout` (`cssW`, `cssH`), `this.cellRect(x,y)` → `{left, top, size}` (CSS px), `this.roundRect(x,y,w,h,r)` (builds a path; caller fills/strokes/clips).
- Produces (used by Task 4): `drawTutorialSpotlight(cells: { x: number; y: number }[], tMs: number): void` — call once per frame, after `draw()`, while a tutorial is active.

- [ ] **Step 1: Add the offscreen "sharp" buffer fields** — in `src/render.ts`, find the field declaration block ending at:

```ts
  private hoverCell: { x: number; y: number } | null = null; // editor targeting reticle
```

Insert directly after it:

```ts
  // Tutorial spotlight: an offscreen snapshot of the un-blurred frame, so the
  // highlighted cells can be redrawn crisp over the blurred-and-dimmed board.
  private sharp: HTMLCanvasElement | null = null;
  private sharpCtx: CanvasRenderingContext2D | null = null;
```

- [ ] **Step 2: Add `drawTutorialSpotlight`** — in `src/render.ts`, insert this method immediately after the closing brace of `markFrozen(...)` (right before the `private roundRect(...)` definition near the end of the class):

```ts
  /** Tutorial focus: blur + dim the whole board, then redraw the given cells
   *  crisp with a soft glowing ring. Called once per frame after draw(). */
  drawTutorialSpotlight(cells: { x: number; y: number }[], tMs: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width; // device px
    const H = this.canvas.height;
    if (W === 0 || H === 0) return;

    // (Re)allocate the offscreen snapshot to match the backing store.
    if (!this.sharp || this.sharp.width !== W || this.sharp.height !== H) {
      this.sharp = document.createElement('canvas');
      this.sharp.width = W;
      this.sharp.height = H;
      this.sharpCtx = this.sharp.getContext('2d');
    }
    const sc = this.sharpCtx;
    if (!sc) return;

    // 1) Snapshot the finished frame (identity transform, device px).
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, W, H);
    sc.drawImage(this.canvas, 0, 0);

    // 2) Blur the visible board, then 3) dim it — both in device space.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${Math.max(2, Math.round(6 * this.dpr))}px)`;
    ctx.drawImage(this.sharp, 0, 0);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(10,12,20,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore(); // back to the DPR transform

    // 4) Punch each highlighted cell back to crisp (no blur, no dim).
    const { cssW, cssH } = this.layout;
    for (const c of cells) {
      const { left, top, size } = this.cellRect(c.x, c.y);
      const pad = size * 0.06;
      ctx.save();
      this.roundRect(left - pad, top - pad, size + pad * 2, size + pad * 2, size * 0.18);
      ctx.clip();
      // Source = full device snapshot; dest = full CSS board → lands 1:1 in device px.
      ctx.drawImage(this.sharp, 0, 0, W, H, 0, 0, cssW, cssH);
      ctx.restore();
    }

    // 5) A gently-pulsing warm ring around each window.
    const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.005);
    for (const c of cells) {
      const { left, top, size } = this.cellRect(c.x, c.y);
      const pad = size * 0.06;
      ctx.save();
      ctx.strokeStyle = `rgba(255,226,122,${0.55 + 0.35 * pulse})`;
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.shadowColor = 'rgba(255,226,122,0.85)';
      ctx.shadowBlur = size * (0.18 + 0.12 * pulse);
      this.roundRect(left - pad, top - pad, size + pad * 2, size + pad * 2, size * 0.18);
      ctx.stroke();
      ctx.restore();
    }
  }
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: PASS — `tsc` clean (no test for this visual method; verified by eye in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/render.ts
git commit -m "feat(render): add drawTutorialSpotlight (blur + dim + crisp window)"
```

---

## Task 4: Wire the tutorial into the game state

**Files:**
- Modify: `src/game.ts` — extend the `Hud` interface; add a `Tutorial` field + imports; start/gate/render/dismiss logic.

**Interfaces:**
- Consumes: `Tutorial` + `TutorialScript` from `./tutorial.js`; `TUTORIALS` from `./tutorialData.js`; existing `this.input.setEnabled(bool)`, `this.renderer.drawTutorialSpotlight(cells, now)`, `this.updateControls()`.
- Produces (used by Task 5): `Hud.tutorial = { panel, text, dots, btnSkip, btnNext }` and `Hud.btnHelp`; public methods `tutorialNext(): void`, `tutorialSkip(): void`, `replayTutorial(): void`, `tutorialActive(): boolean`, `hasTutorial(): boolean`.

- [ ] **Step 1: Add imports** — in `src/game.ts`, find:

```ts
import { Simulation } from './sim.js';
```

Add directly below it:

```ts
import { Tutorial } from './tutorial.js';
import { TUTORIALS } from './tutorialData.js';
```

- [ ] **Step 2: Extend the `Hud` interface** — in `src/game.ts`, find the end of the `outcome: { ... }` block inside `interface Hud` (the lines):

```ts
  outcome: {
    panel: HTMLElement;
    title: HTMLElement;
    sub: HTMLElement;
    btnReplay: HTMLButtonElement;
    btnNext: HTMLButtonElement;
    btnEdit: HTMLButtonElement;
  };
}
```

Replace that closing block with (adds `btnHelp` and a `tutorial` group before the final `}`):

```ts
  outcome: {
    panel: HTMLElement;
    title: HTMLElement;
    sub: HTMLElement;
    btnReplay: HTMLButtonElement;
    btnNext: HTMLButtonElement;
    btnEdit: HTMLButtonElement;
  };
  btnHelp: HTMLButtonElement;
  tutorial: {
    panel: HTMLElement;
    text: HTMLElement;
    dots: HTMLElement;
    btnSkip: HTMLButtonElement;
    btnNext: HTMLButtonElement;
  };
}
```

- [ ] **Step 3: Add the `Tutorial` field** — in `src/game.ts`, find:

```ts
  private input: InputController;
```

Insert directly above it:

```ts
  private readonly tutorial = new Tutorial();
```

- [ ] **Step 4: Start the tutorial from `loadLevel`** — in `src/game.ts`, replace the whole `loadLevel` method:

```ts
  loadLevel(level: Level): void {
    const i = this.levels.indexOf(level);
    if (i >= 0) this.levelIndex = i;
    this.applyLevel(level);
    this.input.setEditor(this.editor);
    this.input.setEnabled(true);
    this.resize();
    this.hideOutcome();
    this.updateHud();
    this.updateControls();
  }
```

with:

```ts
  loadLevel(level: Level): void {
    const i = this.levels.indexOf(level);
    if (i >= 0) this.levelIndex = i;
    this.tutorial.end(); // drop any tutorial carried from the previous level
    this.applyLevel(level);
    this.input.setEditor(this.editor);
    this.input.setEnabled(true);
    this.resize();
    this.hideOutcome();
    this.updateHud();
    this.startTutorialIfAny(); // may disable input + show the caption card
    this.updateControls();
  }
```

- [ ] **Step 5: Add the tutorial control methods** — in `src/game.ts`, insert this block immediately after the `loadLevel` method (before `loadIndex`):

```ts
  /* ----------------------------- tutorial ----------------------------- */

  tutorialActive(): boolean {
    return this.tutorial.active();
  }
  hasTutorial(): boolean {
    return !!TUTORIALS[this.level.id];
  }

  /** If the current level has a script, start it; otherwise ensure the card is hidden. */
  private startTutorialIfAny(): void {
    const script = TUTORIALS[this.level.id];
    if (!script) {
      this.hud.tutorial.panel.classList.remove('show');
      return;
    }
    this.tutorial.start(script, this.grid, this.level);
    this.input.setEnabled(false);
    this.renderTutorialHud();
  }

  /** Push the active step's text / dots / button label into the caption card. */
  private renderTutorialHud(): void {
    const o = this.hud.tutorial;
    if (!this.tutorial.active()) {
      o.panel.classList.remove('show');
      return;
    }
    const { index, total } = this.tutorial.stepInfo();
    o.text.textContent = this.tutorial.text();
    o.dots.textContent = Array.from({ length: total }, (_, i) => (i + 1 === index ? '●' : '○')).join(' ');
    o.btnNext.textContent = this.tutorial.isLast() ? 'Got it ▶' : 'Next ▶';
    o.btnSkip.style.display = total > 1 ? '' : 'none'; // a single-step tutorial only needs "Got it"
    o.panel.classList.add('show');
  }

  /** Advance one step, or finish (and resume normal play) on the last step. */
  tutorialNext(): void {
    if (!this.tutorial.active()) return;
    if (this.tutorial.next()) this.renderTutorialHud();
    else this.endTutorial();
  }

  /** Dismiss the whole tutorial. */
  tutorialSkip(): void {
    if (this.tutorial.active()) this.endTutorial();
  }

  private endTutorial(): void {
    this.tutorial.end();
    this.hud.tutorial.panel.classList.remove('show');
    if (this.state === 'editing') this.input.setEnabled(true);
    this.updateControls();
  }

  /** Replay the current level's tutorial from the `?` button. */
  replayTutorial(): void {
    if (this.state !== 'editing') this.reset();
    this.startTutorialIfAny();
    this.updateControls();
  }
```

- [ ] **Step 6: Render the spotlight each frame** — in `src/game.ts`, find in the `loop` method:

```ts
    if (this.held.size) this.renderer.markFrozen(this.frozenCells());
    if (this.holdTargeting) this.renderer.drawHoldOverlay(this.holdableCells());
```

Add directly below those two lines:

```ts
    if (this.tutorial.active()) this.renderer.drawTutorialSpotlight(this.tutorial.cells(), now);
```

- [ ] **Step 7: Gate Play/Step + toggle the `?` button** — in `src/game.ts`, replace the whole `updateControls` method:

```ts
  private updateControls(): void {
    const editing = this.state === 'editing';
    const running = this.state === 'running';
    this.hud.btnUndo.disabled = !editing || !this.editor.canUndo();
    this.hud.btnRedo.disabled = !editing || !this.editor.canRedo();
    this.hud.btnPlay.textContent = running ? '⏸ Pause' : this.state === 'paused' ? '▶ Resume' : '▶ Play';
    this.hud.btnSpeed.textContent = `${this.speed}×`;
    this.updateHud();
  }
```

with:

```ts
  private updateControls(): void {
    const editing = this.state === 'editing';
    const running = this.state === 'running';
    const tut = this.tutorial.active();
    this.hud.btnUndo.disabled = !editing || tut || !this.editor.canUndo();
    this.hud.btnRedo.disabled = !editing || tut || !this.editor.canRedo();
    this.hud.btnPlay.textContent = running ? '⏸ Pause' : this.state === 'paused' ? '▶ Resume' : '▶ Play';
    this.hud.btnPlay.disabled = tut; // can't run the sim mid-tutorial
    this.hud.btnStep.disabled = tut;
    this.hud.btnSpeed.textContent = `${this.speed}×`;
    this.hud.btnHelp.classList.toggle('show', this.hasTutorial() && !tut);
    this.updateHud();
  }
```

- [ ] **Step 8: Build to verify it compiles**

Run: `npm run build`
Expected: PASS — `tsc` clean. (`main.ts` does not yet supply `btnHelp`/`tutorial` refs, but `Hud` is only structurally required where constructed; `tsc` will flag `main.ts` in Task 5. If `tsc` errors here on `main.ts` missing the new `Hud` fields, that is expected — proceed to Task 5, then build.)

> If you prefer a clean build at every task boundary, do Step 8 together with Task 5's build. Either way, commit Task 4 only once `npm run build` passes after Task 5.

- [ ] **Step 9: Commit**

```bash
git add src/game.ts
git commit -m "feat(game): drive the tutorial — start on load, gate input/controls, render spotlight"
```

---

## Task 5: Caption card, `?` button, and DOM wiring

**Files:**
- Modify: `index.html` — add `#tutorial` + `#btn-help` inside `#stage`, and their CSS.
- Modify: `src/main.ts` — supply the new `Hud` refs; wire Next/Skip/`?`; guard boosters during a tutorial.

**Interfaces:**
- Consumes: `game.tutorialNext()`, `game.tutorialSkip()`, `game.replayTutorial()`, `game.tutorialActive()` (from Task 4); the `el<T>(id)` helper already in `main.ts`.
- Produces: the running, visually-verifiable feature.

- [ ] **Step 1: Add the DOM** — in `index.html`, find the end of the `#outcome` block inside `<main id="stage">`:

```html
        <div id="outcome">
          <div class="card s9 s-cyan">
            <p id="outcome-title" class="s9 s-title">Solved!</p>
            <p id="outcome-sub">Nice routing</p>
            <div class="row">
              <button id="outcome-edit" class="s9 s-navy">Edit</button>
              <button id="outcome-replay" class="s9 s-navy">Replay</button>
              <button class="primary s9 s-yellow" id="outcome-next">Next ▶</button>
            </div>
          </div>
        </div>
      </main>
```

Replace it with (insert `#tutorial` + `#btn-help` before `</main>`):

```html
        <div id="outcome">
          <div class="card s9 s-cyan">
            <p id="outcome-title" class="s9 s-title">Solved!</p>
            <p id="outcome-sub">Nice routing</p>
            <div class="row">
              <button id="outcome-edit" class="s9 s-navy">Edit</button>
              <button id="outcome-replay" class="s9 s-navy">Replay</button>
              <button class="primary s9 s-yellow" id="outcome-next">Next ▶</button>
            </div>
          </div>
        </div>
        <div id="tutorial">
          <div class="tut-card s9 s-cyan">
            <p id="tut-text"></p>
            <div class="tut-foot">
              <span id="tut-dots" class="tut-dots"></span>
              <span class="tut-btns">
                <button id="tut-skip" class="s9 s-navy">Skip</button>
                <button id="tut-next" class="primary s9 s-yellow">Next ▶</button>
              </span>
            </div>
          </div>
        </div>
        <button id="btn-help" title="Show tutorial">?</button>
      </main>
```

- [ ] **Step 2: Add the CSS** — in `index.html`, find the end of the outcome-overlay CSS block:

```css
      #outcome .row { display: flex; gap: 8px; justify-content: center; }
      #outcome .row button { flex: 1 1 0; min-height: 52px; }
```

Insert directly after those two lines:

```css

      /* ---- tutorial caption + spotlight ---- */
      #tutorial {
        position: absolute; inset: 0; display: none; align-items: flex-end; justify-content: center;
        padding: 18px; pointer-events: none; z-index: 9;
      }
      #tutorial.show { display: flex; }
      #tutorial .tut-card {
        pointer-events: auto; width: 100%; max-width: 420px; text-align: center;
        padding: 14px 16px 12px; animation: pop 0.28s cubic-bezier(0.2, 1.3, 0.4, 1) both;
      }
      #tut-text { color: #18324a; font-weight: 600; font-size: 15px; line-height: 1.35; margin: 0 0 12px; }
      #tutorial .tut-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .tut-dots { color: #2b4a66; font-size: 14px; letter-spacing: 3px; }
      .tut-btns { display: flex; gap: 8px; }
      #tutorial .tut-btns button { min-height: 46px; padding: 0 16px; }
      #btn-help {
        position: absolute; top: 10px; right: 10px; z-index: 7;
        display: none; align-items: center; justify-content: center;
        width: 38px; height: 38px; border-radius: 999px; padding: 0;
        font-size: 18px; font-weight: 800; line-height: 1;
        background: rgba(16, 20, 32, 0.9); color: #ffe27a;
        border: 1px solid rgba(255, 255, 255, 0.14); cursor: pointer;
      }
      #btn-help.show { display: flex; }
```

- [ ] **Step 3: Supply the new `Hud` refs** — in `src/main.ts`, find the `outcome` group at the end of the `const hud: Hud = { ... }` object:

```ts
    outcome: {
      panel: el('outcome'),
      title: el('outcome-title'),
      sub: el('outcome-sub'),
      btnReplay: el<HTMLButtonElement>('outcome-replay'),
      btnNext: el<HTMLButtonElement>('outcome-next'),
      btnEdit: el<HTMLButtonElement>('outcome-edit'),
    },
  };
```

Replace it with (add `btnHelp` + `tutorial` before the closing `};`):

```ts
    outcome: {
      panel: el('outcome'),
      title: el('outcome-title'),
      sub: el('outcome-sub'),
      btnReplay: el<HTMLButtonElement>('outcome-replay'),
      btnNext: el<HTMLButtonElement>('outcome-next'),
      btnEdit: el<HTMLButtonElement>('outcome-edit'),
    },
    btnHelp: el<HTMLButtonElement>('btn-help'),
    tutorial: {
      panel: el('tutorial'),
      text: el('tut-text'),
      dots: el('tut-dots'),
      btnSkip: el<HTMLButtonElement>('tut-skip'),
      btnNext: el<HTMLButtonElement>('tut-next'),
    },
  };
```

- [ ] **Step 4: Wire the buttons** — in `src/main.ts`, find:

```ts
  hud.outcome.btnReplay.addEventListener('click', () => game.replay());
  hud.outcome.btnEdit.addEventListener('click', () => game.reset());
```

Insert directly above those lines:

```ts
  hud.tutorial.btnNext.addEventListener('click', () => game.tutorialNext());
  hud.tutorial.btnSkip.addEventListener('click', () => game.tutorialSkip());
  hud.btnHelp.addEventListener('click', () => game.replayTutorial());
```

- [ ] **Step 5: Guard boosters during a tutorial** — in `src/main.ts`, find the booster button click handler opening:

```ts
    btn.addEventListener('click', () => {
      if (economy.boosterCount(b.id) <= 0) {
        game.toast(`Out of ${b.name} — buy more in the Shop`);
        return;
      }
```

Replace it with (add the tutorial guard as the first check):

```ts
    btn.addEventListener('click', () => {
      if (game.tutorialActive()) return; // boosters are inert while a tutorial is up
      if (economy.boosterCount(b.id) <= 0) {
        game.toast(`Out of ${b.name} — buy more in the Shop`);
        return;
      }
```

- [ ] **Step 6: Build to verify everything compiles**

Run: `npm run build`
Expected: PASS — `tsc` clean across `game.ts` + `main.ts`, then `genlevels.mjs` regenerates `levels.json` (unchanged content).

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(ui): tutorial caption card + ? replay button, wired in main"
```

---

## Task 6: Full build, tests, and manual verification

**Files:**
- Modify: `dist/**` (regenerated build output — committed per project convention).

- [ ] **Step 1: Clean build + tests**

Run: `npm run build && npm test`
Expected: `tsc` clean; self-tests report `N passed, 0 failed` (N higher than before by the tutorial assertions); `leveltest.js` prints all 13 levels solved within budget.

- [ ] **Step 2: Serve and verify each tutorial level by eye**

Run: `npx serve .` (or `python -m http.server`), open the served `index.html`.

Verify, opening each level from ☰ → Levels:
- **1-2:** on load, the two rock tiles are crisp + ringed; the rest of the board is blurred and dimmed; one step; button reads `Got it ▶`; no `Skip` (single step). `Got it` dismisses → board normal, Play enabled.
- **1-3:** step 1 spotlights wagon #1; `Next ▶` → step 2 spotlights the exit; `Skip` present; dots show `● ○` then `○ ●`. Finish → normal play.
- **2-1:** step 1 spotlights the left tunnel mouth (3,1); step 2 the right mouth (5,1).
- **3-1:** step 1 the gate (4,1); step 2 the button (2,1).
- **4-1:** single step on the signal (1,1).
- **4-3:** step 1 the trolley/mover; step 2 the crossing cell (2,2).
- **Replay:** the `?` button (top-right of the board) appears only on these six levels; clicking it re-runs the tutorial. It is hidden while the tutorial is showing and on non-tutorial levels (e.g. 1-1, 1-4).
- **Gating:** Play/Step/Undo/Redo are disabled while a tutorial is up; tapping the board lays no track; tapping a booster does nothing. All restore after dismissal.
- **Non-tutorial levels** (1-1, 1-4, 1-5, 2-2, 2-3, 3-2, 4-2): no tutorial, no `?`, behave exactly as before.

Note any discrepancy and fix before committing. (If the blur looks too strong/weak, tune the `blur(... )` px and the `rgba(10,12,20,0.45)` scrim alpha in `drawTutorialSpotlight`.)

- [ ] **Step 3: Commit the rebuilt dist**

```bash
git add dist
git commit -m "build: compile level tutorials into dist"
```

- [ ] **Step 4: (Optional) open a PR / finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to merge or open a PR for `feature/level-tutorials`.

---

## Self-Review

**1. Spec coverage**
- Six tutorial levels + exact highlights + copy → Task 2 (scripts) + Global Constraints (verbatim copy). ✓
- True blur + dim, crisp highlight + ring → Task 3 `drawTutorialSpotlight`. ✓
- Tap-to-advance, `Next`/`Got it`, `Skip`, step dots → Task 4 `renderTutorialHud`/`tutorialNext`/`tutorialSkip` + Task 5 DOM/CSS. ✓
- Show every visit, no persistence → Task 4 `startTutorialIfAny` from `loadLevel`; no localStorage anywhere. ✓
- After dismissal plays normally; input/Play/Step gated while active → Task 4 `endTutorial` + `updateControls`. ✓
- `?` replay button, visible only on tutorial levels → Task 4 `replayTutorial` + `updateControls` toggle + Task 5 `#btn-help`. ✓
- Selector-based targets with explicit-cells escape hatch (tunnels, crossing) → Task 1 `resolveTarget` + Task 2 data. ✓
- Tests for resolution + progression + script integrity → Tasks 1 & 2 selftest additions. ✓
- Additive only; no sim/level-data changes; zero deps; rebuild dist → Global Constraints + Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code; every command has an expected result. ✓

**3. Type consistency:** `StepTarget`/`TutorialStep`/`TutorialScript`/`resolveTarget`/`Tutorial` names match across Tasks 1→2→4. `Hud.tutorial` shape (`panel/text/dots/btnSkip/btnNext`) and `Hud.btnHelp` match between Task 4 (interface) and Task 5 (main.ts refs + DOM ids `tutorial`/`tut-text`/`tut-dots`/`tut-skip`/`tut-next`/`btn-help`). Game methods `tutorialNext/tutorialSkip/replayTutorial/tutorialActive/hasTutorial` match between Task 4 (defs) and Task 5 (calls). Renderer `drawTutorialSpotlight(cells, tMs)` matches between Task 3 (def) and Task 4 (call, passing `now`). ✓
