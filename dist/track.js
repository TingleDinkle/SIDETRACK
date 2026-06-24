/**
 * Track shape classification and the exit-edge rule.
 *
 * Everything here is a pure function of a cell's `EdgeMask`, so it is fully
 * unit-testable in Node with no DOM. The simulation (M2+) reads `exitEdge` to
 * decide where a moving unit goes next; M1 only needs `classify` for rendering.
 */
import { EdgeBit, OPPOSITE, edgeCount, edgeList, hasEdge, removeEdge, } from './types.js';
const STRAIGHT_NS = EdgeBit.N | EdgeBit.S;
const STRAIGHT_EW = EdgeBit.E | EdgeBit.W;
/** Classify a track cell purely from its connection mask. */
export function classify(mask) {
    switch (edgeCount(mask)) {
        case 0:
            return 'none';
        case 1:
            return 'stub'; // a dead-end; valid to draw, but a unit would derail here
        case 2:
            return mask === STRAIGHT_NS || mask === STRAIGHT_EW ? 'straight' : 'curve';
        case 3:
            return 'junction';
        default:
            return 'crossing';
    }
}
/**
 * Given the edge a unit ENTERED a cell through and the cell's mask, return the
 * edge it should LEAVE through — or `null` to signal a derail.
 *
 * Used by the simulation from M2 onward; included now so the movement rule is
 * defined and tested alongside the model.
 *
 * @param entryEdge       cell edge the unit crossed to get in (= OPPOSITE of its travel heading)
 * @param junctionActive  for junctions only: which of the two exits is live (0 or 1)
 */
export function exitEdge(mask, entryEdge, junctionActive = 0) {
    if (!hasEdge(mask, entryEdge))
        return null; // entered across a non-connected edge → derail
    switch (classify(mask)) {
        case 'straight':
        case 'curve': {
            // The single remaining connected edge.
            const others = edgeList(removeEdge(mask, entryEdge));
            return others[0] ?? null;
        }
        case 'crossing': {
            // Pass straight through; the opposite edge is guaranteed present on a 4-way.
            const opp = OPPOSITE[entryEdge];
            return hasEdge(mask, opp) ? opp : null;
        }
        case 'junction': {
            // One entry consumed; choose between the two remaining exits.
            const exits = edgeList(removeEdge(mask, entryEdge));
            return exits.length ? exits[junctionActive % exits.length] : null;
        }
        default:
            return null; // 'none' / 'stub'
    }
}
//# sourceMappingURL=track.js.map