/**
 * Level loading + validation.
 *
 * The game loads its levels from `levels.json` (generated from levelData.ts at
 * build time). If the fetch fails — most commonly when index.html is opened
 * straight from the file system, where fetch is blocked — it falls back to the
 * embedded library so the game still runs.
 */

import { Level, LevelTile } from './level.js';
import { LEVEL_LIBRARY, World, WORLDS } from './levelData.js';
import { Heading } from './types.js';

export interface LevelBundle {
  worlds: World[];
  levels: Level[];
}

function isHeading(v: unknown): v is Heading {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

/** Throw on anything that does not conform to the documented Level shape. */
export function validateLevel(o: unknown, i = 0): Level {
  const L = o as Record<string, unknown>;
  const fail = (msg: string): never => {
    throw new Error(`level[${i}]: ${msg}`);
  };
  if (typeof L.id !== 'string') fail('id must be a string');
  const grid = L.grid as { cols?: unknown; rows?: unknown } | undefined;
  if (!grid || typeof grid.cols !== 'number' || typeof grid.rows !== 'number') fail('grid.cols/rows required');
  if (typeof L.trackBudget !== 'number') fail('trackBudget required');
  const loco = L.locomotive as { x?: unknown; y?: unknown; heading?: unknown } | undefined;
  if (!loco || typeof loco.x !== 'number' || typeof loco.y !== 'number' || !isHeading(loco.heading))
    fail('locomotive {x,y,heading} required');
  if (!Array.isArray(L.fixedTiles)) fail('fixedTiles must be an array');
  for (const t of L.fixedTiles as LevelTile[]) {
    if (typeof t.x !== 'number' || typeof t.y !== 'number' || typeof t.type !== 'string') fail('bad fixedTile');
  }
  return o as Level;
}

export async function loadBundle(): Promise<LevelBundle> {
  try {
    const res = await fetch('./levels.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = (await res.json()) as { worlds?: World[]; levels?: unknown[] };
    const levels = (data.levels ?? []).map(validateLevel);
    if (!levels.length) throw new Error('no levels');
    return { worlds: data.worlds ?? WORLDS, levels };
  } catch {
    // Offline / file:// fallback — use the type-checked embedded library.
    return { worlds: WORLDS, levels: LEVEL_LIBRARY };
  }
}
