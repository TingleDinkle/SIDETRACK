/**
 * Screen shake ("camera kick") — cosmetic impact feedback. The renderer owns one
 * instance, calls `kick()` on impactful events, and applies `offset()` as a
 * canvas translate each frame. Magnitude decays exponentially so a kick is a
 * quick snap, not a wobble. Frame-rate independent via the draw timestamp.
 */
export class Shake {
    constructor() {
        this.mag = 0;
        this.lastMs = 0;
    }
    /** Add an impulse. Typical: ~0.3 (gentle), ~0.9 (crash). Strongest wins. */
    kick(intensity) {
        this.mag = Math.max(this.mag, intensity);
    }
    /** Pixel offset for this frame, given the frame time and the cell size. */
    offset(tMs, cell) {
        const dt = this.lastMs ? Math.min(64, tMs - this.lastMs) : 16;
        this.lastMs = tMs;
        if (this.mag < 0.002) {
            this.mag = 0;
            return { x: 0, y: 0 };
        }
        const amp = this.mag * cell * 0.22;
        const ox = (Math.random() * 2 - 1) * amp;
        const oy = (Math.random() * 2 - 1) * amp;
        this.mag *= Math.pow(0.0025, dt / 1000); // ~halve every ~115ms
        return { x: ox, y: oy };
    }
}
//# sourceMappingURL=shake.js.map