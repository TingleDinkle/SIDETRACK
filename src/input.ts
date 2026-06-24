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

import { Editor } from './editor.js';
import { Renderer } from './render.js';
import { headingBetween } from './types.js';

export class InputController {
  private enabled = true;
  private activeId: number | null = null;
  private last: { x: number; y: number } | null = null;
  private moved = false;
  /** True while an active gesture's pointer is off the board, so re-entry does
   *  not draw a spurious "bridge" across the gap (see onMove). */
  private outside = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: Renderer,
    private editor: Editor,
    private readonly onChange: () => void,
  ) {
    canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    canvas.addEventListener('pointermove', this.onMove, { passive: false });
    // End/cancel are on window (the pointer is captured to the canvas, but a
    // release can still land anywhere). Explicit non-passive so preventDefault
    // is always honoured.
    window.addEventListener('pointerup', this.onUp, { passive: false });
    window.addEventListener('pointercancel', this.onCancel, { passive: false });
  }

  /** Rebind to a new editor (e.g. after loading a different level). */
  setEditor(editor: Editor): void {
    this.cancelGesture();
    this.editor = editor;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.cancelGesture();
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.activeId !== null) return;
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    this.activeId = e.pointerId;
    this.last = cell;
    this.moved = false;
    this.outside = false;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.editor.beginStroke();
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId || !this.last) return;
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
    if (cell.x === this.last.x && cell.y === this.last.y) return;
    this.walkLay(this.last, cell);
    this.last = cell;
    this.moved = true;
    this.onChange();
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    e.preventDefault();
    // A tap (no movement) on a track cell erases it.
    if (!this.moved && this.last) this.editor.eraseAt(this.last.x, this.last.y);
    this.editor.endStroke();
    this.releaseGesture(e.pointerId);
    this.onChange();
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId) return;
    this.cancelGesture();
  };

  private cancelGesture(): void {
    if (this.activeId === null) return;
    this.editor.endStroke();
    this.releaseGesture(this.activeId);
  }

  private releaseGesture(id: number): void {
    try {
      this.canvas.releasePointerCapture(id);
    } catch {
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
  private walkLay(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const maxSteps = this.editor.grid.cols + this.editor.grid.rows + 2;
    let cur = { ...from };
    let guard = 0;
    while ((cur.x !== to.x || cur.y !== to.y) && guard++ < maxSteps) {
      const next = { ...cur };
      if (cur.x !== to.x) next.x += Math.sign(to.x - cur.x);
      else next.y += Math.sign(to.y - cur.y);
      if (headingBetween(cur.x, cur.y, next.x, next.y)) {
        this.editor.layStep(cur.x, cur.y, next.x, next.y);
      }
      cur = next;
    }
  }
}
