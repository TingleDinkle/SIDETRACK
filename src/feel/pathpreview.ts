/**
 * Planned-route telegraph. Traces where the train will roll given the current
 * track, returning the cells it passes through. It mirrors the sim's movement
 * rules — coast-forward, curve/junction redirects, the goal's edge connection,
 * and tunnel teleports — so the preview matches what Play will do.
 *
 * It is a *best-effort* telegraph, not a guarantee: gates/signals are treated as
 * passable (you may yet open them) and junctions take their default branch, both
 * of which depend on live sim state. Read-only; never mutates the grid.
 */
import { Grid } from '../grid.js';
import { DELTA, Heading, OPPOSITE, edgeList, hasEdge } from '../types.js';
import { exitEdge } from '../track.js';

export interface PathStart {
  x: number;
  y: number;
  heading: Heading;
}

export interface TraceResult {
  cells: { x: number; y: number }[];
  /** 'exit' = the route reaches the goal; 'derail' = it runs off / can't connect. */
  outcome: 'exit' | 'derail';
  /** Cells along the route that sit on a wagon (where pickups would happen). */
  pickups: { x: number; y: number }[];
}

export function tracePath(
  grid: Grid,
  start: PathStart,
  wagons: { x: number; y: number }[] = [],
): TraceResult {
  const cells: { x: number; y: number }[] = [{ x: start.x, y: start.y }];
  let x = start.x;
  let y = start.y;
  let h: Heading = start.heading;
  let outcome: 'exit' | 'derail' = 'derail';
  const seen = new Set<string>();
  const cap = grid.cols * grid.rows * 3 + 8;

  for (let i = 0; i < cap; i++) {
    if (seen.has(`${x},${y},${h}`)) break; // entered a loop — stop
    seen.add(`${x},${y},${h}`);

    const c = grid.get(x, y);
    if (!c) break;
    // Exit direction: launch/emerge straight from a start/tunnel, otherwise the
    // rail's redirect, otherwise coast straight on.
    const dir: Heading =
      c.type === 'start' || c.type === 'tunnel' ? h : exitEdge(c.mask, OPPOSITE[h], 0) ?? h;

    const nx = x + DELTA[dir].dx;
    const ny = y + DELTA[dir].dy;
    const dest = grid.get(nx, ny);
    if (!dest || dest.type === 'rock') break; // off the board / blocked → derail

    if (dest.type === 'exit') {
      if (!hasEdge(c.mask, dir)) break; // can't coast into the goal — needs a rail at its edge
      cells.push({ x: nx, y: ny });
      outcome = 'exit';
      break;
    }

    if (dest.type === 'tunnel') {
      const pair = grid.cells.find(
        (o) => o !== dest && o.type === 'tunnel' && o.pairId === dest.pairId,
      );
      const mouth = pair ? edgeList(pair.mask)[0] : undefined;
      cells.push({ x: nx, y: ny });
      if (!pair || !mouth) break; // unpaired tunnel — stop here
      x = pair.x;
      y = pair.y;
      h = mouth;
      cells.push({ x, y });
      continue;
    }

    x = nx;
    y = ny;
    h = dir;
    cells.push({ x, y });
  }

  const pickups = wagons.filter((w) => cells.some((c) => c.x === w.x && c.y === w.y));
  return { cells, outcome, pickups };
}
