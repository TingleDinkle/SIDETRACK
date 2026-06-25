/**
 * Train-motion easing — purely cosmetic, never touches the deterministic sim.
 *
 * The simulation advances exactly one cell per tick. This module shapes the
 * *visual* glide between ticks so the train rolls at a constant speed while
 * cruising and only eases when it launches from rest or settles to a stop.
 *
 * Why not ease every tick? An ease-in-out applied per tick drops the velocity
 * to ~0 at every cell boundary, so a multi-cell run visibly pulses ("inchworm").
 * The three curves below are C1-continuous at the boundaries — cruise holds a
 * constant velocity of 1, launch ramps 0→1, settle ramps 1→0 — so velocity is
 * continuous across ticks and the motion reads as one smooth roll.
 */
const clamp01 = (r) => (r <= 0 ? 0 : r >= 1 ? 1 : r);
// f(0)=0, f(1)=1 for all three. Slopes are matched so phases chain seamlessly:
const cruise = (r) => r; //                    f'(0)=1, f'(1)=1
const launchIn = (r) => r * r * (2 - r); //    f'(0)=0, f'(1)=1
const settleOut = (r) => r * (1 + r * (1 - r)); // f'(0)=1, f'(1)=0
/** Map a raw 0..1 inter-tick fraction to an eased one for the given phase. */
export function easeFrac(rawFrac, phase) {
    const r = clamp01(rawFrac);
    return phase === 'launch' ? launchIn(r) : phase === 'settle' ? settleOut(r) : cruise(r);
}
//# sourceMappingURL=motion.js.map