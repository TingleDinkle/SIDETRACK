/**
 * Pointer input — one gesture model for mouse, touch and pen via Pointer Events.
 *
 *   • Drag across cells  → lay track along the path (auto-forms shapes).
 *   • Tap a track cell    → erase it.
 *   • Fast drags that skip a cell are filled in with an orthogonal walk so no
 *     cells are missed.
 *
 * One pointer gesture = one undo stroke. The controller is editing-only; when
 * the simulation runs (M2) the Game disables it via `setEnabled(false)`.
 */
import { headingBetween } from './types.js';
export class InputController {
    constructor(canvas, renderer, editor, onChange) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.editor = editor;
        this.onChange = onChange;
        this.enabled = true;
        this.activeId = null;
        this.last = null;
        this.moved = false;
        /** True while an active gesture's pointer is off the board, so re-entry does
         *  not draw a spurious "bridge" across the gap (see onMove). */
        this.outside = false;
        this.onDown = (e) => {
            if (!this.enabled || this.activeId !== null)
                return;
            const cell = this.renderer.cellAt(e.clientX, e.clientY);
            if (!cell)
                return;
            e.preventDefault();
            this.activeId = e.pointerId;
            this.last = cell;
            this.moved = false;
            this.outside = false;
            try {
                this.canvas.setPointerCapture(e.pointerId);
            }
            catch {
                /* capture is best-effort */
            }
            this.editor.beginStroke();
            this.renderer.setHover(null); // the active gesture is its own feedback
        };
        this.onMove = (e) => {
            // No active gesture → just track the hover reticle (mouse/pen; touch has none).
            if (this.activeId === null) {
                this.renderer.setHover(this.enabled ? this.renderer.cellAt(e.clientX, e.clientY) : null);
                return;
            }
            if (e.pointerId !== this.activeId || !this.last)
                return;
            e.preventDefault();
            const cell = this.renderer.cellAt(e.clientX, e.clientY);
            if (!cell) {
                this.outside = true; // left the board; remember it for re-entry
                return;
            }
            if (this.outside) {
                // Re-entered after leaving: resume from here without bridging the gap.
                this.outside = false;
                this.last = cell;
                this.moved = true;
                return;
            }
            if (cell.x === this.last.x && cell.y === this.last.y)
                return;
            this.walkLay(this.last, cell);
            this.last = cell;
            this.moved = true;
            this.onChange();
        };
        this.onUp = (e) => {
            if (e.pointerId !== this.activeId)
                return;
            e.preventDefault();
            // A tap (no movement) on a track cell erases it.
            if (!this.moved && this.last)
                this.editor.eraseAt(this.last.x, this.last.y);
            this.editor.endStroke();
            this.releaseGesture(e.pointerId);
            this.onChange();
        };
        this.onCancel = (e) => {
            if (e.pointerId !== this.activeId)
                return;
            this.cancelGesture();
        };
        /** Cursor left the board → drop the hover reticle (unless mid-gesture). */
        this.onLeave = () => {
            if (this.activeId === null)
                this.renderer.setHover(null);
        };
        canvas.addEventListener('pointerdown', this.onDown, { passive: false });
        canvas.addEventListener('pointermove', this.onMove, { passive: false });
        canvas.addEventListener('pointerleave', this.onLeave);
        // End/cancel are on window (the pointer is captured to the canvas, but a
        // release can still land anywhere). Explicit non-passive so preventDefault
        // is always honoured.
        window.addEventListener('pointerup', this.onUp, { passive: false });
        window.addEventListener('pointercancel', this.onCancel, { passive: false });
    }
    /** Rebind to a new editor (e.g. after loading a different level). */
    setEditor(editor) {
        this.cancelGesture();
        this.editor = editor;
    }
    setEnabled(on) {
        this.enabled = on;
        if (!on) {
            this.cancelGesture();
            this.renderer.setHover(null); // no reticle while the sim runs
        }
    }
    cancelGesture() {
        if (this.activeId === null)
            return;
        this.editor.endStroke();
        this.releaseGesture(this.activeId);
    }
    releaseGesture(id) {
        try {
            this.canvas.releasePointerCapture(id);
        }
        catch {
            /* ignore */
        }
        this.activeId = null;
        this.last = null;
        this.moved = false;
        this.outside = false;
    }
    /** Lay along an orthogonal path from `from` to `to`, one step per cell.
     *  `from`/`to` are always on-grid, so the path length is bounded by the
     *  board's Manhattan span; the guard is just an infinite-loop backstop. */
    walkLay(from, to) {
        const maxSteps = this.editor.grid.cols + this.editor.grid.rows + 2;
        let cur = { ...from };
        let guard = 0;
        while ((cur.x !== to.x || cur.y !== to.y) && guard++ < maxSteps) {
            const next = { ...cur };
            if (cur.x !== to.x)
                next.x += Math.sign(to.x - cur.x);
            else
                next.y += Math.sign(to.y - cur.y);
            if (headingBetween(cur.x, cur.y, next.x, next.y)) {
                this.editor.layStep(cur.x, cur.y, next.x, next.y);
            }
            cur = next;
        }
    }
}
//# sourceMappingURL=input.js.map