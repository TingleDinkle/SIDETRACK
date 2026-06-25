# Per-Level Tutorials with Blur-Spotlight Highlighting

**Date:** 2026-06-25
**Status:** Approved (design) — ready for implementation plan

## Goal

When a player opens a level that introduces a new mechanic, play a short, guided
tutorial that highlights the relevant object(s) — one focused step at a time —
while everything else on the board is blurred and dimmed for visual clarity.
After the tutorial is dismissed, the level plays exactly as it does today.

Tutorial levels and the mechanic each introduces:

| Level | Name | Mechanic introduced | Highlighted object(s) |
| --- | --- | --- | --- |
| 1-2 | Around the Rock | rocks (obstacles) | the rock tiles |
| 1-3 | Pickup | coupling wagons | wagon #1, then the exit |
| 2-1 | Underpass | tunnel teleport | tunnel mouth A, then tunnel mouth B |
| 3-1 | Keycard | button opens gate | the gate, then the button |
| 4-1 | Stop and Go | signal timing | the signal |
| 4-3 | Crossing | roaming trolley timing | the trolley, then the crossing cell |

## Decisions (locked)

- **Focus effect:** true Gaussian blur on the rest of the board **plus** a dim
  scrim; the highlighted cell(s) stay crisp with a glowing ring.
- **Pacing:** tap to advance. Each step shows a caption + `Next ▶`; the last step
  reads `Got it ▶`. A `Skip` control dismisses the whole tutorial.
- **Trigger:** show on **every visit** to a tutorial level (always skippable). No
  persistence required.
  - *Noted trade-off:* replaying a solved level re-shows its tutorial. Flipping to
    "first time only" later is a small change (gate the start on a `localStorage`
    flag); out of scope for now.

## Non-goals

- No tutorials for non-mechanic levels (1-1, 1-4, 1-5, 2-2, 2-3, 3-2, 4-2).
- No persistence / "don't show again" / first-time-only gating.
- No changes to the simulation, level data, or how any mechanic actually works.
- No new art assets — the spotlight is drawn procedurally on the canvas.

## Architecture

The codebase already has the seam this needs. `render.ts` `drawHoldOverlay()`
(Hold-booster targeting) establishes the exact pattern: dim the whole board and
ring specific cells. We add a true-blur sibling and a small controller that drives
it. Existing module boundaries (pure model vs. browser layer) are preserved.

### New / changed files

| File | Change |
| --- | --- |
| `src/tutorialData.ts` | **New.** The scripts: one ordered list of steps per tutorial level id. Authored content (sibling of `levelData.ts`). |
| `src/tutorial.ts` | **New.** `Tutorial` controller: holds the active script + step index; resolves each step's target to grid cells; exposes `start/next/skip/active/cells/text/stepInfo`. Pure logic except for nothing DOM — it is unit-testable. |
| `src/render.ts` | Add `drawTutorialSpotlight(cells, tMs)`. Lazily-allocated offscreen "sharp" canvas for the blur. |
| `src/game.ts` | Own a `Tutorial`. Start it from `loadLevel` when a script exists; gate board input + Play/Step while active; call `drawTutorialSpotlight` each frame in the render loop. New methods: `tutorialNext()`, `tutorialSkip()`, `replayTutorial()`, `tutorialActive()`, `hasTutorial()`. |
| `index.html` | Add a `#tutorial` caption card inside `#stage` (styled like `#outcome`) and a floating `#btn-help` (`?`) button. |
| `src/main.ts` | Wire `#tutorial` Next/Skip buttons and the `?` button to the game; refresh `?` visibility on level change. |
| `src/selftest.ts` | Add assertions for `Tutorial` target resolution. |

## Data model — step targets

A step names *what* to highlight by **selector**, resolved against the live grid /
level at runtime (robust to coordinates), with an explicit-cells escape hatch for
the one case a selector cannot express (4-3's crossing cell).

```ts
// src/tutorial.ts
export type StepTarget =
  | { tile: TileType }                       // e.g. 'rock' | 'tunnel' | 'gate' | 'button' | 'signal' | 'exit'
  | { entity: 'wagon' | 'mover' }            // resolved from level.wagons / level.movers
  | { cells: { x: number; y: number }[] };   // explicit (the crossing)

export interface TutorialStep {
  text: string;
  target: StepTarget;
}

export interface TutorialScript {
  steps: TutorialStep[];
}

// src/tutorialData.ts
export const TUTORIALS: Record<string, TutorialScript> = { /* keyed by level id */ };
```

### Target resolution

`Tutorial` resolves a `StepTarget` to a `{x,y}[]` of cells:

- `{ tile: t }` → every `grid.cells` whose `type === t`.
- `{ entity: 'wagon' }` → `level.wagons.map(w => ({x,y}))`.
- `{ entity: 'mover' }` → `level.movers.map(m => ({x,y}))`. (Static start positions
  are used — the tutorial shows over the pre-run board, before any sim exists.)
- `{ cells }` → the literal list.

If a selector resolves to zero cells, the step is still shown (caption only, no
spotlight); `selftest.ts` guards that authored scripts never do this.

## The blur-spotlight render

`drawTutorialSpotlight(cells, tMs)` runs in `render.ts` **after** the normal scene
has been drawn for the frame (so it composes over the finished board), every frame
while a step is active (the board keeps its idle-breath animation underneath).

Steps, working in device pixels for the snapshot/blur and CSS pixels for the
windows (the renderer already tracks both via `layout` and `dpr`):

1. **Snapshot** the freshly-drawn canvas into an offscreen "sharp" canvas
   (allocated lazily; resized to match the backing store when dimensions differ).
2. **Blur**: draw the sharp copy back over the whole canvas with
   `ctx.filter = 'blur(<~6px * dpr>)'`, then clear the filter. Now the visible
   board is soft.
3. **Dim**: fill a translucent dark scrim (e.g. `rgba(10,12,20,0.45)`) over
   everything.
4. **Punch through**: build a path of rounded-rect windows from `cellRect(x,y)`
   for each target cell (adjacent cells like the two rocks/tunnels read as one
   merged region), `clip()` to it, and redraw the **sharp** copy into the
   window(s) — the highlighted object(s) snap back crisp and full-bright (no blur,
   no dim).
5. **Ring**: stroke a soft, gently-pulsing glow around the window(s) (reuse the
   warm accent already used elsewhere, e.g. `#ffe27a`).

Notes:
- `ctx.filter` blur is supported in all current target browsers; this path only
  runs during tutorial moments, so per-frame cost is irrelevant.
- The offscreen canvas matches the main canvas backing size; it is (re)sized in
  `resize()` or lazily when a size mismatch is detected.
- No change to the normal `draw()` path — the spotlight is a separate, additive
  call invoked from the game loop, mirroring how `markFrozen` / `drawHoldOverlay`
  are invoked today.

## Flow & interaction

- `game.loadLevel(level)` → after `applyLevel`, if `TUTORIALS[level.id]` exists,
  `tutorial.start(script, grid, level)`. This is the only trigger point and it
  already covers level-select, `next()`, and editor test-play.
- While `tutorial.active()`:
  - Board pointer input is disabled (`input.setEnabled(false)`).
  - `Play` and `Step` are disabled (via `updateControls`, which reads
    `tutorialActive()`). `Undo`/`Redo` are already disabled outside a clean
    editing state; they remain disabled here too.
  - The render loop calls `renderer.drawTutorialSpotlight(tutorial.cells(), now)`.
- Caption card (`#tutorial`, bottom of `#stage`): step text, step dots
  (`● ○ …`), `Skip`, and `Next ▶` / `Got it ▶` on the last step.
- `tutorialNext()` → advance; if past the last step, finish.
- `tutorialSkip()` and finishing both call an internal `endTutorial()`:
  clear the active script, re-enable input, re-enable controls, hide `#tutorial`.
  The level is now in its normal editing state — **identical to today**.
- `#btn-help` (`?`) is shown only when `game.hasTutorial()` is true for the current
  level; clicking it calls `replayTutorial()` (re-`start`s the level's script).

### State

`game.state` is unchanged (stays `'editing'` under the tutorial). A single
`tutorial` object holds activeness; `tutorialActive()` is derived from it. This
keeps the existing state machine intact and the tutorial strictly additive.

## The six scripts (final copy)

```
1-2  Around the Rock
  • { tile: 'rock' }   "Boulders block the line. You can't lay track over a rock —
                         route around them to reach the exit."

1-3  Pickup
  • { entity: 'wagon' } "This is a wagon. Drive the engine over it to couple it on."
  • { tile: 'exit' }    "Then haul it to the exit. Wagons couple in number order."

2-1  Underpass
  • { cells: [tunnel A] } "Tunnels come in pairs. Send the train into one mouth…"
  • { cells: [tunnel B] } "…and it pops out of its partner across the map, slipping
                            past the rock."

3-1  Keycard
  • { tile: 'gate' }   "This gate bars the track and starts shut."
  • { tile: 'button' } "Roll over its matching button to open it. Same colour = linked."

4-1  Stop and Go
  • { tile: 'signal' } "A signal holds the train on red and passes it on green. It
                         flips every few ticks — time your run to arrive on green."

4-3  Crossing
  • { entity: 'mover' }    "This trolley roams the rails on its own, back and forth."
  • { cells: [{x:2,y:2}] } "Your line crosses its path here. Don't be on the crossing
                            when it passes, or you'll collide — time it."
```

Notes:
- 2-1 uses explicit cells per step so "enter one / exit the other" highlights one
  mouth at a time (a `{tile:'tunnel'}` selector would light both at once). Tunnel A
  = `(3,1)`, B = `(5,1)`.
- 4-3 step 2 uses the explicit crossing cell `(2,2)` (the 4-edge crossing tile).

## Testing

- **`selftest.ts` (Node, pure logic):**
  - Every key in `TUTORIALS` is a real level id in the library.
  - For every step with a `tile`/`entity` selector, resolution against that level's
    grid/level yields ≥ 1 cell.
  - Spot-check resolutions: 1-2 `{tile:'rock'}` → 2 cells; 1-3 `{entity:'wagon'}` →
    1 cell at `(3,1)`; 2-1 explicit tunnel cells match the tunnel tiles; 3-1
    `{tile:'gate'}` → `(4,1)`, `{tile:'button'}` → `(2,1)`; 4-1 `{tile:'signal'}` →
    `(1,1)`; 4-3 `{entity:'mover'}` → `(2,1)`.
  - `Tutorial` step progression: `start` → `next` × n → finished; `skip` ends it.
- **Visual (manual):** the blur-spotlight render is not unit-tested. Verify by
  serving the build and opening each tutorial level (blur reads correctly, crisp
  window aligns to the cell, Next/Skip/`?` behave, dismissal restores normal play).
- `npm test` (existing 55 model/sim assertions + solvability) must still pass.

## Build / integration notes

- `npm run build` runs `tsc` then `tools/genlevels.mjs`. The tutorial work touches
  no level JSON, so `levels.json` is unaffected, but the committed `dist/` must be
  rebuilt so the served game includes the feature.
- No new runtime dependencies (consistent with the project's zero-dep stance).
