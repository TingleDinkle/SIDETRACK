/**
 * Sidetrack — core types and small math helpers.
 *
 * Coordinate convention (matches the design spec):
 *   - The board is `cols × rows` cells, indexed (x, y) with origin top-left.
 *   - Headings N / E / S / W. E increases x, S increases y.
 *
 * Track connectivity is stored as an `EdgeMask`: a 4-bit bitmask over a cell's
 * four edges. A cell's track *shape* (straight / curve / junction / crossing)
 * is **derived** from which edges are connected — the editor never special-cases
 * shapes, it just toggles edges, and the renderer + simulation read the mask.
 * This keeps the data model tiny and makes every later mechanic compose.
 */

export type Heading = 'N' | 'E' | 'S' | 'W';
export const HEADINGS: readonly Heading[] = ['N', 'E', 'S', 'W'] as const;

/** Per-edge bit values that make up an EdgeMask. */
export const EdgeBit = { N: 1, E: 2, S: 4, W: 8 } as const;
export type EdgeMask = number;

/** Step vector for each heading (E: +x, S: +y). */
export const DELTA: Record<Heading, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

/** Opposite heading / edge. */
export const OPPOSITE: Record<Heading, Heading> = { N: 'S', E: 'W', S: 'N', W: 'E' };

/* ------------------------------------------------------------------ *
 * Edge-mask helpers
 * ------------------------------------------------------------------ */

export function hasEdge(mask: EdgeMask, h: Heading): boolean {
  return (mask & EdgeBit[h]) !== 0;
}
export function addEdge(mask: EdgeMask, h: Heading): EdgeMask {
  return mask | EdgeBit[h];
}
export function removeEdge(mask: EdgeMask, h: Heading): EdgeMask {
  return mask & ~EdgeBit[h];
}
/** The connected edges of a mask, in canonical N,E,S,W order. */
export function edgeList(mask: EdgeMask): Heading[] {
  const out: Heading[] = [];
  for (const h of HEADINGS) if (hasEdge(mask, h)) out.push(h);
  return out;
}
/** Population count (number of connected edges). */
export function edgeCount(mask: EdgeMask): number {
  let n = 0;
  let m = mask & 0b1111;
  while (m) {
    n += m & 1;
    m >>= 1;
  }
  return n;
}

/**
 * The heading that points from cell A to an orthogonally-adjacent cell B,
 * or null if B is not a 4-neighbour of A.
 */
export function headingBetween(ax: number, ay: number, bx: number, by: number): Heading | null {
  if (by === ay) {
    if (bx === ax + 1) return 'E';
    if (bx === ax - 1) return 'W';
  } else if (bx === ax) {
    if (by === ay + 1) return 'S';
    if (by === ay - 1) return 'N';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Tiles
 * ------------------------------------------------------------------ */

export type TileType =
  | 'empty'
  | 'track'
  | 'rock'
  | 'tunnel'
  | 'gate'
  | 'button'
  | 'switch'
  | 'signal'
  | 'platform'
  | 'start'
  | 'exit';

/**
 * One grid cell. Most fields are optional and only meaningful for certain tile
 * types; keeping them on a single struct lets later milestones add mechanics
 * without reshaping the grid. `mask` is the source of truth for editable track:
 * a non-fixed cell is `'track'` iff its mask is non-zero.
 */
export interface Cell {
  x: number;
  y: number;
  type: TileType;
  /** Track connectivity. Non-zero only for tiles a unit can roll across. */
  mask: EdgeMask;
  /** Fixed tiles belong to the level and cannot be edited by the player. */
  fixed: boolean;
  /** Orientation for 'start' (loco facing / leave edge) and 'exit' (entry edge). */
  heading?: Heading;
  /** Tunnels sharing a pairId teleport to each other. */
  pairId?: number;
  /** Links buttons↔gates and switches↔junctions (and tints the tile). */
  color?: string;
  /** Initial open state for gates (default closed) and signals (default open). */
  open?: boolean;
}
