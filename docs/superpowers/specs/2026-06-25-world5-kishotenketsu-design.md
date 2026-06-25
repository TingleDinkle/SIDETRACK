# World 5 — "Kishotenketsu": three deterministic capstone puzzles

**Date:** 2026-06-25
**Status:** Approved (design) — ready for implementation plan

## Goal

Add World 5, **Kishotenketsu** — the final, hardest world: three deterministic
levels, each combining multiple already-taught mechanics into a puzzle that makes
the player *think*. Every level ships a concrete, engine-verified winning solution
within a tight budget, and the tempting naive attempts provably lose.

## The unifying thread

**Order is not what you see.** In each World-5 level the obvious, eye-level
reading of the board is a trap — the nearest wagon, the straight line, the on-time
crossing. The deterministic machinery (a gate you must arm, a tunnel that reverses
space, a trolley on a clock) is what lets you reach the *true* order underneath.
Worlds 1–4 taught the mechanics in isolation; World 5 asks the player to disbelieve
the obvious and compose them. **No tutorials** — discovering the assembly is the
puzzle.

## Layered kishotenketsu (起承転結)

The three levels form one arc **and** each level is internally 起承転結.

| Level | World arc | The board's lie (起承) | The turn (転) | The resolution (結) |
| --- | --- | --- | --- | --- |
| 5-1 Right of Way | 起 introduce | "grab the wagon in front of you" | it's wagon **2**, and the gate is shut | detour up: arm the gate **and** take #1 first |
| 5-2 The Long Way Round | 転 twist | "go straight to the wagons" | geography lies — #1 is *past* #2 | the tunnel **reverses** reach; loop back through the armed gate |
| 5-3 Confluence | 結 synthesise | "you have order + gates now" | a trolley owns the only crossing | line up **space + sequence + time** at once |

## Design constraints (locked)

- **Difficulty: hardest in the game.** Each level's budget equals its verified
  solution length — **zero slack** to flail. Difficulty escalates: one insight
  (5-1) → two (5-2) → three concurrent constraints (5-3).
- **No engine changes.** Pure data + tests. Mechanics used are all already
  implemented (rocks, tunnels, gates+buttons, signals, movers, coupling order).
- **No new art.** World 5 falls back to procedural ground (the renderer uses
  `ground_w{world}` if present, else generic) — nothing to add.
- **No tutorials** for World 5 (the `TUTORIALS` map gets no `5-*` entries).
- Switches/junctions are intentionally **omitted** (their auto-flip topologies read
  as illegible); the world features tunnels, gates+buttons, signals, and trolleys.

## The three levels (final, engine-verified)

Coordinates are `(x,y)`, origin top-left, headings N/E/S/W. Each "Solution" is the
exact `SOLUTIONS[id]` entry for `leveltest.ts`; each was run in the real
`Simulation` and **wins at the stated budget**. Each "Anti" attempt was run and
**loses** as noted.

### 5-1 · Right of Way — `gate + button + coupling order`

Grid **6×3**, budget **4**. Loco `(0,1)→E`. Exit `(5,1)←W`.
Fixed: gate `red (4,1)` edges `[W,E]` closed; button `red (1,0)` edges `[S,E]`.
Wagons: **#1 `(2,0)`**, **#2 `(3,1)`**.

Intent: wagon #2 sits on the straight line to the exit (the trap); #1 and the
button are up the side. Going straight couples #2 first → fail, and the gate is
shut anyway. Turn **up** first → button arms the gate and you take #1 → drop down,
take #2, roll through the opened gate.

Solution (4): `(1,1)[W,N]`, `(2,0)[W,S]`, `(2,1)[N,E]`, `(3,1)[W,E]` →
**WON in 7 ticks**.
Anti — straight bottom line `(1,1)[W,E],(2,1)[W,E],(3,1)[W,E]` → **LOST: "wagon 2
coupled out of order"**.

### 5-2 · The Long Way Round — `tunnel + gate + button + coupling order`

Grid **6×3**, budget **3**. Loco `(0,1)→E`. Exit `(2,0)←S`.
Fixed: tunnel pair `pairId 1` at `(1,1)[W]` and `(3,1)[E]`; gate `red (3,2)` edges
`[W,E]` closed; button `red (4,2)` edges `[N,W]`.
Wagons: **#1 `(4,1)`**, **#2 `(2,1)`**.

Intent: the loco launches into the tunnel and **emerges past wagon #2** at `(3,1)`,
reaching wagon **#1** first — the tunnel reverses the reach the ground denies. It
then loops back (down, west, up): the descent presses the button (arming the gate),
the loop crosses the opened gate, couples #2, and climbs to the exit.

Solution (3): `(4,1)[W,S]`, `(2,2)[E,N]`, `(2,1)[S,N]` → **WON in 7 ticks**.
Anti — emerge and run straight `(4,1)[W,E]` → **LOST: derailed** (off the board;
you must take the long way).

### 5-3 · Confluence — `trolley + signal + gate + button + 2 wagons`

Grid **8×5**, budget **6**. Loco `(0,3)→E`. Exit `(7,3)←W`.
Fixed: trolley shaft, column 3 — `(3,0)[S]`, `(3,1)[N,S]`, `(3,2)[N,S]`,
**crossing `(3,3)[N,E,S,W]`**, `(3,4)[N,S]`; signal `(2,3)` edges `[W,E]`
**`open: true`** (times the crossing); button `red (5,1)` edges `[W,S]`; gate
`red (5,3)` edges `[N,E]` closed. Mover (trolley): **`(3,0)→S`**.
Wagons: **#1 `(1,3)`**, **#2 `(6,3)`**.

Intent (synthesis): couple #1, then the signal forces a one-tick wait so the loco
**crosses `(3,3)` the tick after the trolley clears it** (a straight rush arrives
on the same tick → collision); past the crossing, detour **up** to the button
(arms the gate), drop back **down** through the opened gate, couple #2, exit.

Verified trace (the intent, start to end): `t1` couple #1; `t2` **loco waits** at
`(1,3)` (signal red) while the trolley falls to `(3,2)`; `t3` trolley occupies the
crossing `(3,3)`, loco safely at `(2,3)`; `t4` **loco crosses `(3,3)`** as the
trolley clears to `(3,4)`; `t8` button arms the gate; `t10` through the gate; `t11`
couple #2; `t12` exit.

Solution (6): `(1,3)[W,E]`, `(4,3)[W,N]`, `(4,2)[N,S]`, `(4,1)[S,E]`,
`(5,2)[N,S]`, `(6,3)[W,E]` → **WON in 12 ticks**.
Anti — rush straight to the gate `(1,3)[W,E],(4,3)[W,E],(6,3)[W,E]` → **LOST: out
of time** (stuck at the un-armed gate). (The collision failure mode for an
un-delayed crossing is proven separately in the prototype and by the t3/t4 trace.)

## Architecture & integration

Purely additive data + tests. Files touched:

| File | Change |
| --- | --- |
| `src/levelData.ts` | Append `{ id: 5, name: 'Kishotenketsu', blurb: … }` to `WORLDS`, and the three `Level` objects (above) to `LEVEL_LIBRARY`. |
| `src/leveltest.ts` | Add the three verified `SOLUTIONS['5-1'|'5-2'|'5-3']` entries (above). The existing loop then proves each wins within budget. |
| `src/selftest.ts` | Add: (a) every `LEVEL_LIBRARY` level passes `validateLevel` with **0 errors**; (b) **anti-solution** assertions — the named naive layouts for 5-1/5-2/5-3 end `lost`. |
| `tools/genlevels.mjs` (build) | No code change; the build regenerates `levels.json` from `levelData.ts` (now 4 worlds → 5, 13 levels → 16). |

The world/level-select UI ([src/main.ts](src/main.ts) `buildSelect`) and renderer
(`setTheme(world)`) read worlds/levels from the store and need **no change** — World
5 appears automatically as `World 5 · Kishotenketsu`.

World blurb: *"Order is not what you see. Tunnels, gates and trolleys — composed."*

## Testing (the heart of "thorough")

Every assertion below runs in `npm test` (Node, no DOM):

1. **Solvability (existing harness):** `leveltest.ts` lays each `SOLUTIONS[id]` and
   asserts `status === 'won'` and `solution.length ≤ trackBudget`. Verified: 5-1
   4/4, 5-2 3/3, 5-3 6/6.
2. **Validation:** each new level passes `validateLevel` with zero errors (added as
   a library-wide loop in `selftest.ts`).
3. **Anti-solutions (intent lock):** the tempting naive layout for each level is
   asserted to end `lost` — 5-1 out-of-order, 5-2 derail, 5-3 stuck-gate — so the
   design is pinned from both sides (the intended path wins, the obvious one fails).
4. **Existing suite stays green:** 119 self-tests + (13→16) level tests, plus the
   new assertions.

## Non-goals

- No new mechanics, no engine/sim changes, no renderer changes, no art.
- No tutorials for World 5.
- No switch/junction levels.
- No change to Worlds 1–4 or any existing level.
- The `objectives.passengers` field stays 0 (unimplemented; validator warns only).
