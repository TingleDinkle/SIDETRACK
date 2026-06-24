# Sidetrack art assets

The game draws everything procedurally by default. Drop sprites in here and they
**override** the shapes — per sprite, so you can theme it one piece at a time.
Anything you don't provide keeps its built-in look.

## Enable it

1. Copy `manifest.example.json` → `manifest.json`.
2. Put your PNGs under `assets/` (any subfolders) and point the manifest at them.
3. Reload. (Served over HTTP — see the top-level README.)

That's it. No build step; the loader reads `manifest.json` at startup and fails
soft if a file is missing.

## Manifest format

```jsonc
{
  "atlas": "atlas.png",            // optional shared sprite sheet
  "sprites": {
    "loco":      { "x":0, "y":0, "w":128, "h":128 },   // a region of atlas.png
    "tile_rock": { "src": "tiles/rock.png" },          // OR a standalone file
    "prop_tree": { "src": "props/tree.png", "anchorY": 1 }
  }
}
```

- **Atlas region:** `{ x, y, w, h }` — pixels into the shared `atlas` image.
- **Standalone file:** `{ src: "path/under/assets" }`.
- **Anchor:** `anchorX`/`anchorY` in 0..1, default `0.5` (centre). Use `anchorY: 1`
  for things that sit on the ground (trees, posts).
- Mix both styles freely.

## Sprite names the renderer looks for

| Name | What | Notes |
| --- | --- | --- |
| `ground` / `ground_w1`..`ground_w4` | tiled terrain per world | **seamless**, standalone `src`. `ground_w{world}` wins, else `ground`, else the checker. |
| `loco` | locomotive | faces **East** at rotation 0; rotated per heading. |
| `wagon` | numbered wagon | one sprite for all numbers — the digit is drawn on top. |
| `mover` | trolley | faces **East** at rotation 0. |
| `tile_rock` | rock obstacle | |
| `tile_tunnel` | tunnel mouth | drawn with its **opening facing East** at rotation 0; auto-rotated to the mouth. |
| `tile_exit` | exit | |
| `tile_start` | locomotive start pad | |
| `tile_button` | drive-over button | |
| `tile_switch` | drive-over switch | |
| `tile_gate_open` / `tile_gate_closed` | gate | author for **horizontal** track; auto-rotated for vertical. |
| `tile_signal_green` / `tile_signal_red` | signal | open = green, closed = red. |
| `prop_tree` / `prop_rock` / `prop_bush` … | scenery | any name; placed via level `decor` (below). |

Track pieces stay procedural (they already adapt to every connection). You can
add `track_*` sprites later if you want.

## Sizes & style

- **Tiles / entities:** author at ~**2×** the on-screen cell so they stay crisp on
  hi-dpi — **128–192 px**, transparent PNG. They're drawn to fit the cell.
- **Ground:** **256–512 px**, seamlessly tileable (it's repeated as a pattern).
- Tint to a consistent per-world palette; bake soft shadows into props if you like
  (the engine also adds a light contact shadow under entities).

## Scenery (decor)

Cosmetic props are placed per level via an optional `decor` array (cell coords,
may be fractional and may sit in the margin):

```json
"decor": [
  { "x": -0.8, "y": 0.2, "sprite": "prop_tree", "scale": 1.4 },
  { "x": 5.6,  "y": 2.7, "sprite": "prop_rock" }
]
```

Decor draws only when its sprite is loaded, so it's invisible in procedural mode.

## What ships here

- **`icons/`** — monochrome UI symbols (game-icons.net style, white-on-black).
  They're **tintable**: the AssetManager knocks out the black and recolours them
  to any colour. Used by the booster bar under the board. Draw one yourself with
  `renderer.icon('icon_loco', x, y, size, '#d2553f')` or
  `assets.drawIcon(ctx, name, cx, cy, w, h, color)`.
- **`baked/`** — in-world sprites rendered from the Kenney *Trains* GLB pack at a
  top-down-with-depth angle (transparent PNG). `manifest.json` maps `loco` /
  `wagon` / `mover` to a chosen few; the rest are alternates you can swap in.

### Baking your own from 3D (GLB → sprite)

The `baked/` PNGs were produced by loading each `.glb` in a headless three.js
page, framing it with an orthographic camera (~62° elevation, model facing +X so
it points East), rendering to a 256² transparent canvas, and saving the PNG.
Repeat with any glTF/GLB pack to get more in-world art while staying 2D.

## Where to get art

See the top-level README / project notes — Kenney.nl (CC0), itch.io, OpenGameArt,
Game-icons.net for UI, plus commission/AI. Keep it **original** (don't reuse other
games' assets).
