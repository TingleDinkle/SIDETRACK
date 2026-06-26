# Sidetrack

A cozy, **deterministic** train-shunting puzzle — lay a limited budget of track,
press Play, and watch the locomotive couple numbered wagons in order and roll to
the exit. Original game (genre cousin of the "lay-track-then-simulate" puzzlers),
TypeScript + HTML5 Canvas, **no framework**, mobile-first.

> Status: **M1–M6 complete** — a fully playable game: deterministic simulation,
> 13 levels across 4 worlds, tunnels / gates / signals / switches / movers, level
> select with saved progress, animation, sound, and an in-app level editor that
> exports the level JSON.

---

## Run it

The compiled output is committed in `dist/`, so you can just serve the folder and
open it. ES modules don't load from `file://` in most browsers, so use any static
server:

```bash
# any of these from the project root:
npx serve .            # or
python -m http.server  # then open http://localhost:8000
```

Open `index.html`. On a phone it fills the screen; on desktop it's centered.

## Deploy to the web (Vercel)

It's a pure static site — `index.html` plus the committed `dist/`, `levels.json`
and `assets/`. There's no server and no backend (saves live in `localStorage`),
so hosting is just "serve the folder".

The included [`vercel.json`](vercel.json) tells Vercel to skip install/build and
serve the repo root as static files (the compiled `dist/` is already committed):

```bash
npm i -g vercel
vercel          # first run: log in + answer the prompts, then it gives you a URL
vercel --prod   # promote to production
```

Or import the GitHub repo at vercel.com → **New Project** (Framework: **Other**).
The one thing that matters: **Output Directory is the repo root (`.`)**, because
`index.html` lives at the top and references `./dist/`, `./assets/`, `./levels.json`
— pointing it at `dist/` would 404. To rebuild from source on every deploy instead
of serving the committed output, set `buildCommand` to `npm run build` in
`vercel.json`. The same static setup works on Netlify, GitHub Pages, or Cloudflare
Pages (publish directory = root).

## Build from source

```bash
npm install      # installs TypeScript (see note below)
npm run build    # tsc -> dist/
npm test         # runs the pure-logic self-tests in Node
npm run watch    # recompile on change
```

> **Corporate-proxy note:** if `npm install` fails with
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, run it once as
> `NODE_OPTIONS=--use-system-ca npm install` to trust the system certificate
> store. The build itself has **zero runtime dependencies**.

---

## Controls

| Action | Input |
| --- | --- |
| Lay track | drag across adjacent cells (auto-forms straight / curve / junction / crossing) |
| Erase a track | tap it |
| Undo / Redo | toolbar ↶ ↷ |
| Play / Pause | ▶ button (toggles while a run is in progress) |
| Step | advance the simulation one tick |
| Speed | toggle 1× / 2× |
| Reset | stop the run and return to editing (your track is kept) |
| Level select | ☰ button (worlds → levels, with completion ticks) |
| Mute | 🔊 button (persisted) |

Budget is shown top-right (`Track used/total`); it turns red at the cap. Solve a
level to earn a ✓ and a best-tick record, saved to `localStorage`.

### How a run resolves (each tick)

Intent → blocking (gates/signals) → collision → move (coupled wagons snake) →
enter-effects (coupling, tunnels, buttons, switches, junction flip) → win/lose.
Crashing, derailing, or coupling a wagon out of order fails the run.

---

## Architecture

Everything is plain modules with a clear seam between **pure model** (no DOM,
unit-tested in Node) and the **browser layer** (canvas + pointer).

```
src/   (pure model — no DOM, unit-tested in Node)
  types.ts       Headings, the EdgeMask bitmask, Cell/TileType, edge math helpers.
  grid.ts        The board: flat cell array + neighbour lookups.
  track.ts       classify(mask) -> shape; exitEdge(mask, entry, junction) — the movement rule.
  level.ts       Level JSON shape + buildGrid(level).
  levelData.ts   The 13-level library (4 worlds) + world metadata. Source of truth.
  editor.ts      Drag-lay, tap-erase, budget accounting, snapshot undo/redo.
  sim.ts         The deterministic tick simulation (trail-following train + all mechanics).
       (browser layer)
  assets.ts      Optional sprite/atlas loader; renderer falls back to shapes when absent.
  render.ts      Canvas renderer + particles. Owns the screen<->grid layout.
  input.ts       Pointer Events (mouse/touch/pen) -> one gesture = one undo stroke.
  sound.ts       Procedural WebAudio sfx (no audio files).
  levelLoader.ts Fetches + validates levels.json (falls back to the embedded library).
  progress.ts    localStorage: solved levels + best tick counts.
  game.ts        Orchestrator: state machine, RAF loop, run pacing, HUD, effects.
  main.ts        DOM bootstrap, toolbar + level-select wiring.
  selftest.ts    Node tests for the pure model + simulation (npm test).
  leveltest.ts   Lays a verified solution for every level and asserts it wins in budget.
tools/
  genlevels.mjs  Build step: emits levels.json from levelData.ts.
```

The simulation models the train as a **trail**: the loco leaves a breadcrumb of
the cells it has occupied and coupled wagon *i* sits on `trail[i]`. Advancing is
just `trail = [newLocoCell, ...trail]` (drop the tail on a normal move; keep it
when coupling). One rule gives the snake, the coupling, *and* clean threading of
the whole train through tunnels.

### Key design decision: track shape is *derived*, not stored

A cell stores only an `EdgeMask` (4 bits: N=1, E=2, S=4, W=8). The shape —
straight / curve / junction / crossing — is computed from the mask by
`classify()`, and the next-cell movement by `exitEdge()`. The editor never
special-cases shapes; it just toggles edges. The renderer and (coming) simulation
both read the same mask. This keeps the data model tiny and lets every later
mechanic (tunnels, gates, signals, alternating junctions) compose on top without
reshaping the grid.

### Coordinate convention

Grid is `cols × rows`, origin top-left. Headings **N/E/S/W**; **E increases x,
S increases y**. The edge a unit *enters* a cell through is the opposite of its
travel heading — that's the input to `exitEdge`.

### Budget rule

Each non-fixed cell holding track costs exactly **1**, regardless of shape.
Laying onto an empty cell spends 1; extending an existing track cell
(straight → junction) is free; erasing refunds. Fixed level tiles (start, exit,
rocks, pre-laid track) are never edited — the player connects up against them.

---

## Art assets (optional)

The game draws everything procedurally — no art files required. To skin it, drop
PNGs into `assets/` and list them in `assets/manifest.json`; the renderer uses a
sprite when one exists and falls back to the shape otherwise, **per piece**. The
ground, locomotive, wagons, tiles, and per-level scenery (`decor`) are all
overridable. See [`assets/README.md`](assets/README.md) for the sprite names,
sizes, anchors and the (atlas-region *or* loose-file) manifest format. Depth cues
(contact shadows, edge vignette, textured ground) apply with or without art.

## Roadmap

- **M1 ✅** grid, tile model, budgeted track laying, rendering.
- **M2 ✅** deterministic tick simulation (movement, coupling, collision, win/lose),
  Play / Pause / Reset / Step / Speed, smooth interpolation, outcome panel.
- **M3 ✅** alternating junctions, tunnels, gates+buttons, coloured switches, signals,
  independent movers.
- **M4 ✅** JSON level loader + validator, 13 original levels across 4 worlds, level
  select with completion ticks, localStorage progress.
- **M5 ✅** touch handling, eased motion, chimney smoke, coupling sparks, win burst,
  procedural sound + mute, haptics.
- **M6 ✅** in-app level editor (☰ → ✎ Editor): paint tiles, set start/exit/wagons/
  movers, tune grid + budget, test-play, and export/import the level JSON.

Tests: `npm test` runs 55 model/simulation assertions plus a solvability check
that lays a known-good solution for all 13 levels and confirms each wins within
budget.
