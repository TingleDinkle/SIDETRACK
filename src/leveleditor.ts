/**
 * Level manager + editor (M6, expanded).
 *
 * The single management surface for the whole level library: list every level,
 * create / duplicate / delete, and edit each one — tiles, entities, fixed track,
 * grid size, budget, objectives — with a live preview that uses the same
 * renderer + sprites as the game, plus validation that flags the edge cases that
 * would break gameplay. Everything reads/writes through the LevelStore (so it
 * persists), and the library can be exported to / imported from the game's JSON.
 */

import { buildGrid, Level, LevelMover, LevelTile, LevelWagon } from './level.js';
import { DrawEntity, Renderer } from './render.js';
import { AssetManager } from './assets.js';
import { LevelStore } from './levelStore.js';
import { Issue, validateLevel } from './levelValidate.js';
import { Heading, OPPOSITE, addEdge, edgeList, headingBetween } from './types.js';

type Tool =
  | 'select'
  | 'track'
  | 'start'
  | 'exit'
  | 'wagon'
  | 'mover'
  | 'rock'
  | 'tunnel'
  | 'gate'
  | 'button'
  | 'signal'
  | 'switch'
  | 'erase';

/** What the Select tool currently has picked. References point straight at the
 *  live level objects (which keep their identity across edits), so moving /
 *  rotating just mutates them in place. */
type Selection =
  | { kind: 'loco' }
  | { kind: 'wagon'; ref: LevelWagon }
  | { kind: 'mover'; ref: LevelMover }
  | { kind: 'tile'; ref: LevelTile };

/** Clockwise quarter-turn for headings/edges. */
const ROT_CW: Record<Heading, Heading> = { N: 'E', E: 'S', S: 'W', W: 'N' };

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'select', label: '⤢ Select' },
  { tool: 'track', label: 'Track' },
  { tool: 'start', label: 'Start' },
  { tool: 'exit', label: 'Exit' },
  { tool: 'wagon', label: 'Wagon' },
  { tool: 'mover', label: 'Mover' },
  { tool: 'rock', label: 'Rock' },
  { tool: 'tunnel', label: 'Tunnel' },
  { tool: 'gate', label: 'Gate' },
  { tool: 'button', label: 'Button' },
  { tool: 'signal', label: 'Signal' },
  { tool: 'switch', label: 'Switch' },
  { tool: 'erase', label: 'Erase' },
];

const DRAG_TOOLS = new Set<Tool>(['track', 'erase', 'rock']);

export interface ManagerRefs {
  panel: HTMLElement;
  list: HTMLElement;
  main: HTMLElement;
  status: HTMLElement;
  json: HTMLTextAreaElement;
  btnNew: HTMLButtonElement;
  btnExportAll: HTMLButtonElement;
  btnImportAll: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  btnDone: HTMLButtonElement;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class LevelManager {
  private level: Level | null = null;
  private editingId = ''; // id when the level was opened (to handle id renames on save)
  private tool: Tool = 'track';
  private dirty = false;

  private readonly renderer: Renderer;
  private readonly canvas: HTMLCanvasElement;
  private painting = false;
  private last: { x: number; y: number } | null = null;
  private trackMask = new Map<string, number>(); // "x,y" -> edge mask for fixed track

  // Select tool: pick an entity/obstacle, then drag to move or rotate it.
  private selection: Selection | null = null;
  private dragging = false;
  private dragHover: { x: number; y: number } | null = null;
  private activeId: number | null = null; // the one pointer that owns the current gesture
  private outside = false; // pointer left the board mid-paint (don't bridge track across the gap)
  private hoverCell: { x: number; y: number } | null = null; // Erase tool: cell under the cursor
  private downXY: { x: number; y: number } | null = null; // Select: pointerdown px, for a move threshold

  // built UI
  private inputs!: {
    id: HTMLInputElement;
    name: HTMLInputElement;
    world: HTMLInputElement;
    cols: HTMLInputElement;
    rows: HTMLInputElement;
    budget: HTMLInputElement;
    passengers: HTMLInputElement;
  };
  private heading!: HTMLSelectElement;
  private orient!: HTMLSelectElement;
  private color!: HTMLSelectElement;
  private openChk!: HTMLInputElement;
  private toolsEl!: HTMLElement;
  private validEl!: HTMLElement;
  private editorEl!: HTMLElement;
  private selBar!: HTMLElement;
  private selLabel!: HTMLElement;
  private selRotBtn!: HTMLButtonElement;
  private selDelBtn!: HTMLButtonElement;

  constructor(
    private readonly refs: ManagerRefs,
    private readonly store: LevelStore,
    assets: AssetManager,
    private readonly onTest: (level: Level) => void,
  ) {
    this.buildEditorUI();
    this.canvas = this.editorEl.querySelector<HTMLCanvasElement>('canvas')!;
    this.renderer = new Renderer(this.canvas);
    this.renderer.setAssets(assets);

    this.canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.onMove, { passive: false });
    this.canvas.addEventListener('lostpointercapture', this.onLost);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', this.onKey);
    new ResizeObserver(() => this.draw()).observe(this.canvas);

    refs.btnNew.addEventListener('click', () => {
      const lvl = this.store.create(9);
      this.renderList();
      this.selectLevel(lvl.id);
    });
    refs.btnExportAll.addEventListener('click', () => {
      this.refs.json.value = this.store.exportJSON();
      this.status('Whole library exported — copy it, or paste one and Import.');
    });
    refs.btnImportAll.addEventListener('click', () => {
      const res = this.store.importJSON(this.refs.json.value);
      if (res.ok) {
        this.level = null;
        this.editorEl.style.display = 'none';
        this.renderList();
        this.status('Library imported.');
      } else this.status('Import failed: ' + res.error);
    });
    refs.btnReset.addEventListener('click', () => {
      if (!confirm('Reset the whole library to the built-in levels? Your custom levels will be lost.')) return;
      this.store.resetDefaults();
      this.level = null;
      this.editorEl.style.display = 'none';
      this.renderList();
      this.status('Reset to defaults.');
    });
  }

  open(): void {
    this.refs.panel.classList.add('show');
    this.renderList();
    if (!this.level && this.store.levels().length) {
      this.selectLevel(this.store.levels()[0].id);
      return;
    }
    if (this.level) {
      this.resize();
      this.draw();
    }
  }
  close(): void {
    this.refs.panel.classList.remove('show');
    // Drop any half-finished gesture so a stray pointerup can't commit a phantom move.
    this.clearSelection();
    this.painting = false;
    this.last = null;
    this.activeId = null;
    this.outside = false;
  }

  /* ----------------------------- level list ----------------------------- */

  private renderList(): void {
    const list = this.refs.list;
    list.replaceChildren();
    const worlds = this.store.worlds();
    const levels = this.store.levels();
    for (const w of worlds) {
      const inWorld = levels.filter((l) => (typeof l.world === 'number' ? l.world : 9) === w.id);
      if (!inWorld.length) continue;
      list.appendChild(el('div', 'ls-wh', `World ${w.id} · ${w.name}`));
      for (const lv of inWorld) {
        const row = el('div', 'ls-row');
        if (this.level && lv.id === this.editingId) row.classList.add('sel');
        const label = el('button', 'ls-pick');
        label.innerHTML = `<b>${lv.id}</b> ${lv.name}`;
        label.addEventListener('click', () => this.selectLevel(lv.id));
        const dup = el('button', 'ls-mini', '⧉');
        dup.title = 'Duplicate';
        dup.addEventListener('click', () => {
          const copy = this.store.duplicate(lv.id);
          this.renderList();
          if (copy) this.selectLevel(copy.id);
        });
        const del = el('button', 'ls-mini', '🗑');
        del.title = 'Delete';
        del.addEventListener('click', () => {
          if (!confirm(`Delete level ${lv.id}?`)) return;
          this.store.remove(lv.id);
          if (this.editingId === lv.id) {
            this.level = null;
            this.editorEl.style.display = 'none';
          }
          this.renderList();
        });
        row.append(label, dup, del);
        list.appendChild(row);
      }
    }
  }

  private selectLevel(id: string): void {
    if (this.dirty && id === this.editingId) return; // re-clicking the open level keeps your edits
    if (this.dirty && !confirm('Discard unsaved changes to this level?')) return;
    const src = this.store.get(id);
    if (!src) return;
    this.level = JSON.parse(JSON.stringify(src)) as Level;
    this.editingId = id;
    this.dirty = false;
    this.clearSelection(); // a fresh deep-cloned level — drop any stale selection
    this.buildTrackMask();
    this.syncInputs();
    this.editorEl.style.display = '';
    this.renderList();
    this.resize();
    this.draw();
    this.validate();
    this.updateSelBar();
    this.status('');
  }

  /* ----------------------------- editor UI ----------------------------- */

  private buildEditorUI(): void {
    const root = el('div', 'ed-editor');
    root.style.display = 'none';

    // metadata row
    const meta = el('div', 'ed-meta');
    const field = (label: string, input: HTMLElement): HTMLElement => {
      const l = el('label', undefined, label + ' ');
      l.appendChild(input);
      return l;
    };
    const txt = (w = 90): HTMLInputElement => {
      const i = el('input');
      i.type = 'text';
      i.style.width = w + 'px';
      return i;
    };
    const num = (): HTMLInputElement => {
      const i = el('input');
      i.type = 'number';
      i.style.width = '52px';
      return i;
    };
    this.inputs = { id: txt(70), name: txt(120), world: num(), cols: num(), rows: num(), budget: num(), passengers: num() };
    meta.append(
      field('id', this.inputs.id),
      field('name', this.inputs.name),
      field('world', this.inputs.world),
      field('cols', this.inputs.cols),
      field('rows', this.inputs.rows),
      field('budget', this.inputs.budget),
      field('passengers', this.inputs.passengers),
    );
    for (const i of Object.values(this.inputs)) i.addEventListener('change', () => this.onMetaChange());

    // tools
    this.toolsEl = el('div', 'ed-tools');
    for (const t of TOOLS) {
      const b = el('button', undefined, t.label);
      b.dataset.tool = t.tool;
      if (t.tool === this.tool) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.tool = t.tool;
        if (this.tool !== 'select') this.clearSelection();
        this.hoverCell = null;
        this.status('');
        for (const c of this.toolsEl.children) c.classList.toggle('sel', (c as HTMLElement).dataset.tool === this.tool);
        this.updateSelBar();
        this.draw();
      });
      this.toolsEl.appendChild(b);
    }

    // options
    const opts = el('div', 'ed-opts');
    this.heading = el('select');
    for (const h of ['E', 'S', 'W', 'N']) this.heading.add(new Option(h, h));
    this.orient = el('select');
    this.orient.add(new Option('↔ horizontal', 'H'));
    this.orient.add(new Option('↕ vertical', 'V'));
    this.color = el('select');
    for (const c of ['red', 'blue', 'green', 'yellow', 'purple', 'orange']) this.color.add(new Option(c, c));
    // Colourless = a master button (opens every gate). Only meaningful for buttons.
    this.color.add(new Option('★ master (opens all)', ''));
    this.openChk = el('input');
    this.openChk.type = 'checkbox';
    const openLabel = el('label', undefined, 'open ');
    openLabel.appendChild(this.openChk);
    opts.append(
      this.optField('facing', this.heading),
      this.optField('track', this.orient),
      this.optField('colour', this.color),
      openLabel,
    );

    // selection bar (Select tool): shown info + rotate / delete the picked piece
    this.selBar = el('div', 'ed-sel');
    this.selLabel = el('span', 'ed-sel-label', '');
    this.selRotBtn = el('button', undefined, '↻ Rotate');
    this.selRotBtn.title = 'Rotate the selected piece (R)';
    this.selRotBtn.addEventListener('click', () => this.rotateSelected());
    this.selDelBtn = el('button', undefined, '🗑 Delete');
    this.selDelBtn.title = 'Delete the selected piece (Del)';
    this.selDelBtn.addEventListener('click', () => this.deleteSelected());
    this.selBar.append(this.selLabel, this.selRotBtn, this.selDelBtn);
    this.updateSelBar();

    // canvas
    const stage = el('div', 'ed-stage');
    stage.appendChild(el('canvas'));

    // validation
    this.validEl = el('div', 'ed-valid');

    // actions
    const actions = el('div', 'ed-actions');
    const save = el('button', 'primary', '💾 Save');
    save.addEventListener('click', () => this.save());
    const test = el('button', 'primary', '▶ Test');
    test.addEventListener('click', () => this.test());
    const exp = el('button', undefined, 'Export this');
    exp.addEventListener('click', () => {
      this.readInputs();
      this.refs.json.value = JSON.stringify(this.level, null, 2);
      this.status('Level JSON exported below.');
    });
    actions.append(save, test, exp);

    root.append(meta, this.toolsEl, opts, this.selBar, stage, this.validEl, actions);
    this.refs.main.appendChild(root);
    this.editorEl = root;
  }

  private optField(label: string, input: HTMLElement): HTMLElement {
    const l = el('label', undefined, label + ' ');
    l.appendChild(input);
    return l;
  }

  private syncInputs(): void {
    if (!this.level) return;
    const L = this.level;
    this.inputs.id.value = L.id;
    this.inputs.name.value = L.name;
    this.inputs.world.value = String(L.world);
    this.inputs.cols.value = String(L.grid.cols);
    this.inputs.rows.value = String(L.grid.rows);
    this.inputs.budget.value = String(L.trackBudget);
    this.inputs.passengers.value = String(L.objectives?.passengers ?? 0);
  }
  private readInputs(): void {
    if (!this.level) return;
    const L = this.level;
    L.id = this.inputs.id.value.trim() || L.id;
    L.name = this.inputs.name.value.trim() || 'Untitled';
    L.world = Math.max(1, Math.floor(Number(this.inputs.world.value) || 1));
    L.trackBudget = Math.max(0, Math.floor(Number(this.inputs.budget.value) || 0));
    // Preserve any authored objective keys / non-default couple mode; only the
    // passengers field is editable here.
    L.objectives = { ...(L.objectives ?? {}), couple: L.objectives?.couple ?? 'all-in-order', passengers: Math.max(0, Math.floor(Number(this.inputs.passengers.value) || 0)) };
  }

  private onMetaChange(): void {
    if (!this.level) return;
    const cols = Math.max(2, Math.min(16, Math.floor(Number(this.inputs.cols.value) || 7)));
    const rows = Math.max(2, Math.min(12, Math.floor(Number(this.inputs.rows.value) || 5)));
    this.readInputs();
    if (cols !== this.level.grid.cols || rows !== this.level.grid.rows) {
      this.clearSelection(); // a resize can filter out the selected piece
      this.level.grid = { cols, rows };
      const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
      this.level.fixedTiles = this.level.fixedTiles.filter((t) => inb(t.x, t.y));
      this.level.wagons = (this.level.wagons ?? []).filter((w) => inb(w.x, w.y));
      this.level.wagons.forEach((w, i) => (w.number = i + 1)); // keep 1..N contiguous after a shrink
      this.level.movers = (this.level.movers ?? []).filter((m) => inb(m.x, m.y));
      for (const k of [...this.trackMask.keys()]) {
        const [x, y] = k.split(',').map(Number);
        if (!inb(x, y)) this.trackMask.delete(k);
      }
      this.rebuildTrackTiles();
    }
    this.inputs.cols.value = String(cols);
    this.inputs.rows.value = String(rows);
    this.renderer.setTheme(typeof this.level.world === 'number' ? this.level.world : 1);
    this.dirty = true;
    this.resize();
    this.draw();
    this.validate();
    this.updateSelBar();
  }

  /* ----------------------------- painting ----------------------------- */

  /** Clear the in-progress gesture flags (not the selection). */
  private resetGesture(): void {
    this.dragging = false;
    this.painting = false;
    this.last = null;
    this.dragHover = null;
    this.outside = false;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button > 0) return; // only the primary button paints/picks (ignore middle/right-click)
    // Ignore extra pointers only while a real gesture still holds the pointer.
    // If the active flag is stale (a prior up/cancel was missed) the capture is
    // already gone, so we recover and start fresh instead of locking up.
    if (this.activeId !== null && this.activeId !== e.pointerId) {
      let held = false;
      try {
        held = this.canvas.hasPointerCapture(this.activeId);
      } catch {
        held = false;
      }
      if (held) return;
    }
    this.resetGesture();
    e.preventDefault();
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    if (!cell) return;
    this.activeId = e.pointerId;
    this.downXY = { x: e.clientX, y: e.clientY };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported / synthetic pointer */
    }
    this.hoverCell = null; // a gesture is starting; drop the hover highlight
    if (this.tool === 'select') {
      this.selection = this.pick(cell.x, cell.y);
      this.dragging = this.selection !== null;
      this.updateSelBar();
      this.draw();
      return;
    }
    this.painting = true;
    this.last = cell;
    if (this.tool !== 'track') this.placeAt(cell.x, cell.y);
  };
  private onMove = (e: PointerEvent): void => {
    if (this.activeId !== null && e.pointerId !== this.activeId) return; // ignore other fingers
    if (this.tool === 'select') {
      if (!this.dragging || !this.selection || !this.level) return;
      const cell = this.renderer.cellAt(e.clientX, e.clientY);
      if (!cell) return;
      if (this.dragHover && this.dragHover.x === cell.x && this.dragHover.y === cell.y) return;
      e.preventDefault();
      this.dragHover = cell;
      this.draw(); // shows the green/red drop tint live
      return;
    }
    if (this.tool === 'erase' && !this.painting && this.level) {
      // Hover (desktop): highlight the cell and name the piece the next click removes.
      const cell = this.renderer.cellAt(e.clientX, e.clientY);
      const same = (!cell && !this.hoverCell) || (!!cell && !!this.hoverCell && cell.x === this.hoverCell.x && cell.y === this.hoverCell.y);
      if (same) return;
      this.hoverCell = cell;
      const tn = cell ? this.eraseTargetName(cell.x, cell.y) : null;
      this.status(tn ? `Erase → ${tn}` : '');
      this.draw();
      return;
    }
    if (!this.painting || !this.level) return;
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    if (!cell) {
      this.outside = true; // left the board — break the paint trail so we don't bridge across it
      return;
    }
    if (this.outside) {
      this.last = cell; // re-entered elsewhere; resume from here without a bridging line
      this.outside = false;
      return;
    }
    if (this.last && cell.x === this.last.x && cell.y === this.last.y) return;
    e.preventDefault();
    if (this.tool === 'track' && this.last) {
      this.walkLayTrack(this.last, cell); // interpolate so fast drags don't skip cells
      this.afterEdit();
    } else if (DRAG_TOOLS.has(this.tool)) {
      this.placeAt(cell.x, cell.y);
    }
    this.last = cell;
  };
  private onUp = (e: PointerEvent): void => {
    if (this.activeId !== null && e.pointerId !== this.activeId) return;
    if (this.refs.panel.classList.contains('show') && this.tool === 'select' && this.dragging) {
      const to = this.dragHover;
      const from = this.selectedPos();
      // Only treat it as a move if the pointer actually travelled — a tap with a
      // little jitter near a cell border should just (re)select, not relocate.
      const threshold = this.renderer.layout.cell * 0.4;
      const travelled = this.downXY ? Math.hypot(e.clientX - this.downXY.x, e.clientY - this.downXY.y) > threshold : true;
      if (travelled && to && from && (to.x !== from.x || to.y !== from.y)) {
        if (this.canDropAt(to.x, to.y)) {
          this.moveSelectedTo(to.x, to.y);
          this.afterEdit();
          this.updateSelBar();
        } else {
          this.status('Can’t drop there.');
        }
      }
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.resetGesture();
    this.activeId = null;
    this.draw();
  };
  /** A touch/pen gesture was interrupted (scroll, palm, OS back-swipe), or pointer
   *  capture was lost: abandon it cleanly — never commit a move — and clear state. */
  private onCancel = (e: PointerEvent): void => {
    if (this.activeId !== null && e.pointerId !== this.activeId) return;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.resetGesture();
    this.activeId = null;
    this.draw();
  };
  /** Backstop: whenever the canvas loses the captured pointer (up/cancel/loss),
   *  guarantee a clean slate so a missed event can never leave the editor stuck. */
  /** Pointer left the board with no gesture in flight — drop the erase hover ring. */
  private onLeave = (): void => {
    if (this.activeId === null && this.hoverCell) {
      this.hoverCell = null;
      this.status('');
      this.draw();
    }
  };
  private onLost = (): void => {
    this.resetGesture();
    this.activeId = null;
  };
  private onKey = (e: KeyboardEvent): void => {
    if (!this.refs.panel.classList.contains('show')) return;
    if (this.tool !== 'select' || !this.selection || !this.level) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const nudge = (dx: number, dy: number): void => {
      const p = this.selectedPos();
      if (!p) return;
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (this.canDropAt(nx, ny)) {
        this.moveSelectedTo(nx, ny);
        this.afterEdit();
        this.updateSelBar();
      }
    };
    switch (e.key) {
      case 'r': case 'R': e.preventDefault(); this.rotateSelected(); break;
      case 'Delete': case 'Backspace': e.preventDefault(); this.deleteSelected(); break;
      case 'Escape': this.clearSelection(); this.updateSelBar(); this.draw(); break;
      case 'ArrowLeft': e.preventDefault(); nudge(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); nudge(1, 0); break;
      case 'ArrowUp': e.preventDefault(); nudge(0, -1); break;
      case 'ArrowDown': e.preventDefault(); nudge(0, 1); break;
    }
  };

  private placeAt(x: number, y: number): void {
    if (!this.level) return;
    const L = this.level;
    const h = this.heading.value as Heading;
    const edgesHV: Heading[] = this.orient.value === 'V' ? ['N', 'S'] : ['W', 'E'];
    const color = this.color.value;

    const removeEntities = (): void => {
      L.wagons = (L.wagons ?? []).filter((w) => !(w.x === x && w.y === y));
      L.movers = (L.movers ?? []).filter((m) => !(m.x === x && m.y === y));
      L.wagons.forEach((w, i) => (w.number = i + 1));
    };
    const removeTiles = (): void => {
      L.fixedTiles = L.fixedTiles.filter((t) => t.type === 'track' || !(t.x === x && t.y === y));
    };
    const removeTrack = (): void => {
      this.trackMask.delete(`${x},${y}`);
      this.rebuildTrackTiles();
    };

    switch (this.tool) {
      case 'erase':
        this.eraseAt(x, y); // smart, layered: one piece at a time, keeping the rail
        break;
      case 'start':
        removeEntities();
        removeTiles();
        L.locomotive = { x, y, heading: h };
        break;
      case 'exit':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'exit', heading: h });
        this.absorbTrackInto(x, y); // don't leave an orphan rail under the exit
        break;
      case 'rock':
        removeEntities();
        removeTiles();
        removeTrack();
        L.fixedTiles.push({ x, y, type: 'rock' });
        break;
      case 'tunnel':
        removeEntities();
        removeTiles();
        removeTrack();
        L.fixedTiles.push({ x, y, type: 'tunnel', edges: [h], pairId: this.nextPairId() });
        break;
      case 'gate':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'gate', edges: edgesHV, color, open: this.openChk.checked });
        this.absorbTrackInto(x, y);
        break;
      case 'button':
        removeEntities();
        removeTiles();
        // No colour selected => master button (opens every gate).
        L.fixedTiles.push({ x, y, type: 'button', edges: edgesHV, color: color || undefined });
        this.absorbTrackInto(x, y);
        break;
      case 'signal':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'signal', edges: edgesHV, open: this.openChk.checked });
        this.absorbTrackInto(x, y);
        break;
      case 'switch':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'switch', edges: edgesHV, color });
        this.absorbTrackInto(x, y);
        break;
      case 'wagon':
        removeEntities();
        (L.wagons ??= []).push({ x, y, number: (L.wagons?.length ?? 0) + 1 });
        break;
      case 'mover':
        removeEntities();
        (L.movers ??= []).push({ x, y, heading: h });
        break;
    }
    this.afterEdit();
  }

  /* ----------------------------- erase (smart / layered) ----------------------------- */

  /** The through-track mask a rail-bearing obstacle carries (button/gate/signal/
   *  switch). Other tiles (rock/tunnel/exit) carry no through-rail to preserve. */
  private railMaskOf(t: LevelTile): number {
    if (t.type !== 'button' && t.type !== 'gate' && t.type !== 'signal' && t.type !== 'switch') return 0;
    return (typeof t.mask === 'number' ? t.mask : 0) | (t.edges ?? []).reduce((m, e) => addEdge(m, e), 0);
  }

  /** Removing a rail-bearing obstacle leaves its rail behind as a real track tile,
   *  so the track and the obstacle are independently deletable (no entanglement). */
  private preserveRail(t: LevelTile): void {
    const m = this.railMaskOf(t);
    if (m !== 0) this.trackMask.set(`${t.x},${t.y}`, (this.trackMask.get(`${t.x},${t.y}`) ?? 0) | m);
  }

  /** When a tile lands on a cell that already holds laid track, reconcile the two
   *  rail definitions into one: a rail-bearing obstacle aligns to (absorbs) the
   *  existing rail; either way the orphan trackMask entry is cleared so a cell
   *  never carries two independent rails (which buildGrid mis-merges into a
   *  phantom crossing). No-op when there is no laid track there. */
  private absorbTrackInto(x: number, y: number): void {
    const m = this.trackMask.get(`${x},${y}`) ?? 0;
    if (m === 0 || !this.level) return;
    const tile = this.level.fixedTiles.find((t) => t.type !== 'track' && t.x === x && t.y === y);
    if (tile && (tile.type === 'gate' || tile.type === 'button' || tile.type === 'signal' || tile.type === 'switch')) {
      tile.edges = edgeList(m); // snap the obstacle to the rail it was dropped on
      delete tile.mask;
    }
    this.trackMask.delete(`${x},${y}`);
    this.rebuildTrackTiles();
  }

  /** What the next erase click on this cell would remove (top-most first), or null. */
  private eraseTargetName(x: number, y: number): string | null {
    const L = this.level;
    if (!L) return null;
    if ((L.wagons ?? []).some((w) => w.x === x && w.y === y)) return 'wagon';
    if ((L.movers ?? []).some((m) => m.x === x && m.y === y)) return 'mover';
    const tile = L.fixedTiles.find((t) => t.type !== 'track' && t.x === x && t.y === y);
    if (tile) return tile.type;
    if ((this.trackMask.get(`${x},${y}`) ?? 0) !== 0) return 'track';
    return null;
  }

  /** Erase the single top-most piece in a cell: an entity, else an obstacle (its
   *  rail stays as track), else the track. So an obstacle sitting on a rail peels
   *  off in two clicks instead of nuking the cell. */
  private eraseAt(x: number, y: number): void {
    const L = this.level;
    if (!L) return;
    if ((L.wagons ?? []).some((w) => w.x === x && w.y === y) || (L.movers ?? []).some((m) => m.x === x && m.y === y)) {
      L.wagons = (L.wagons ?? []).filter((w) => !(w.x === x && w.y === y));
      L.movers = (L.movers ?? []).filter((m) => !(m.x === x && m.y === y));
      L.wagons.forEach((w, i) => (w.number = i + 1));
      return;
    }
    const tile = L.fixedTiles.find((t) => t.type !== 'track' && t.x === x && t.y === y);
    if (tile) {
      this.preserveRail(tile);
      L.fixedTiles = L.fixedTiles.filter((t) => t !== tile);
      this.rebuildTrackTiles();
      return;
    }
    if ((this.trackMask.get(`${x},${y}`) ?? 0) !== 0) {
      this.trackMask.delete(`${x},${y}`);
      this.rebuildTrackTiles();
    }
  }

  /* ----------------------------- selection (Select tool) ----------------------------- */

  /** What's at a cell, top-most first: loco > wagon > mover > obstacle tile.
   *  Plain track is left to the Track/Erase tools, so it is not selectable. */
  private pick(x: number, y: number): Selection | null {
    const L = this.level;
    if (!L) return null;
    if (L.locomotive.x === x && L.locomotive.y === y) return { kind: 'loco' };
    const w = (L.wagons ?? []).find((w) => w.x === x && w.y === y);
    if (w) return { kind: 'wagon', ref: w };
    const m = (L.movers ?? []).find((m) => m.x === x && m.y === y);
    if (m) return { kind: 'mover', ref: m };
    const t = L.fixedTiles.find((t) => t.type !== 'track' && t.x === x && t.y === y);
    if (t) return { kind: 'tile', ref: t };
    return null;
  }

  private selectedPos(): { x: number; y: number } | null {
    const s = this.selection;
    if (!s || !this.level) return null;
    if (s.kind === 'loco') return { x: this.level.locomotive.x, y: this.level.locomotive.y };
    return { x: s.ref.x, y: s.ref.y };
  }

  private selectedName(): string {
    const s = this.selection;
    if (!s) return '';
    if (s.kind === 'loco') return 'Locomotive';
    if (s.kind === 'wagon') return `Wagon ${s.ref.number}`;
    if (s.kind === 'mover') return 'Mover';
    return s.ref.type.charAt(0).toUpperCase() + s.ref.type.slice(1);
  }

  private moveSelectedTo(x: number, y: number): void {
    const s = this.selection;
    if (!s || !this.level) return;
    if (s.kind === 'loco') {
      this.level.locomotive.x = x;
      this.level.locomotive.y = y;
    } else {
      s.ref.x = x;
      s.ref.y = y;
      if (s.kind === 'tile') this.absorbTrackInto(x, y); // a tile dropped on track absorbs it (no double rail)
    }
  }

  /** Strict: refuse any drop that stacks two pieces in one cell (an obstacle can
   *  still share a cell with laid track, exactly as gates/tunnels do in real
   *  levels), or that drops a rock onto rail. Out of bounds is refused too. */
  private canDropAt(x: number, y: number): boolean {
    const s = this.selection;
    const L = this.level;
    if (!s || !L) return false;
    if (x < 0 || y < 0 || x >= L.grid.cols || y >= L.grid.rows) return false;
    const cur = this.selectedPos();
    if (cur && cur.x === x && cur.y === y) return false;
    const locoHere = !(s.kind === 'loco') && L.locomotive.x === x && L.locomotive.y === y;
    const wagonHere = (L.wagons ?? []).some((w) => !(s.kind === 'wagon' && s.ref === w) && w.x === x && w.y === y);
    const moverHere = (L.movers ?? []).some((m) => !(s.kind === 'mover' && s.ref === m) && m.x === x && m.y === y);
    const tileHere = L.fixedTiles.some((t) => t.type !== 'track' && !(s.kind === 'tile' && s.ref === t) && t.x === x && t.y === y);
    if (locoHere || wagonHere || moverHere || tileHere) return false; // one piece per cell
    if (s.kind === 'tile' && s.ref.type === 'rock') {
      const trackHere = (this.trackMask.get(`${x},${y}`) ?? 0) !== 0;
      if (trackHere) return false; // a rock can't sit on rail
    }
    return true;
  }

  private rotateSelected(): void {
    const s = this.selection;
    if (!s || !this.level) return;
    if (s.kind === 'loco') {
      this.level.locomotive.heading = ROT_CW[this.level.locomotive.heading];
    } else if (s.kind === 'mover') {
      s.ref.heading = ROT_CW[s.ref.heading];
    } else if (s.kind === 'tile') {
      const t = s.ref;
      // Effective mask = authored raw mask OR'd with its edge list (buildGrid does
      // the same); we then rewrite edges and drop the stale raw mask so a tile
      // authored with `mask` rotates correctly instead of accumulating bits.
      const effMask = (typeof t.mask === 'number' ? t.mask : 0) | (t.edges ?? []).reduce((m, e) => addEdge(m, e), 0);
      const firstEdge = edgeList(effMask)[0];
      if (t.type === 'exit') {
        delete t.mask;
        t.heading = ROT_CW[t.heading ?? firstEdge ?? 'E'];
        t.edges = [t.heading];
      } else if (t.type === 'tunnel') {
        delete t.mask;
        t.edges = [ROT_CW[(t.edges && t.edges[0]) ?? firstEdge ?? 'E']];
      } else if (t.type === 'gate' || t.type === 'signal' || t.type === 'button' || t.type === 'switch') {
        const horiz = (effMask & 2) !== 0 || (effMask & 8) !== 0; // E=2, W=8
        delete t.mask;
        t.edges = horiz ? ['N', 'S'] : ['W', 'E']; // 90° flip (the piece is symmetric across the track)
      } else {
        this.status('Rocks have no orientation.');
        return;
      }
    } else {
      this.status('Wagons follow the train — nothing to rotate.');
      return;
    }
    this.afterEdit();
    this.updateSelBar();
  }

  private deleteSelected(): void {
    const s = this.selection;
    const L = this.level;
    if (!s || !L) return;
    if (s.kind === 'loco') {
      this.status('Every level needs its locomotive — it can’t be deleted.');
      return;
    }
    if (s.kind === 'wagon') {
      L.wagons = (L.wagons ?? []).filter((w) => w !== s.ref);
      L.wagons.forEach((w, i) => (w.number = i + 1));
    } else if (s.kind === 'mover') {
      L.movers = (L.movers ?? []).filter((m) => m !== s.ref);
    } else {
      this.preserveRail(s.ref); // keep the rail under a deleted obstacle
      L.fixedTiles = L.fixedTiles.filter((t) => t !== s.ref);
      this.rebuildTrackTiles();
    }
    this.selection = null;
    this.afterEdit();
    this.updateSelBar();
  }

  private clearSelection(): void {
    this.selection = null;
    this.dragging = false;
    this.dragHover = null;
  }

  private updateSelBar(): void {
    const inSelect = this.tool === 'select';
    this.selBar.style.display = inSelect ? '' : 'none';
    const has = inSelect && this.selection !== null;
    this.selLabel.textContent = has
      ? `Selected: ${this.selectedName()} — drag to move · ↻ / R to rotate`
      : 'Tap a piece (train, wagon, mover, obstacle) to move or rotate it.';
    const noRot = !this.selection || this.selection.kind === 'wagon' || (this.selection.kind === 'tile' && this.selection.ref.type === 'rock');
    this.selRotBtn.disabled = noRot;
    this.selDelBtn.disabled = !this.selection || this.selection.kind === 'loco';
  }

  /** Selection ring + (during a drag) the green/red drop-target tint. Drawn on
   *  the editor canvas after the renderer, so render.ts stays untouched. */
  private drawOverlays(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { ox, oy, cell } = this.renderer.layout;
    // Erase tool: ring the hovered cell (what the next click removes).
    if (this.tool === 'erase' && this.hoverCell) {
      const lw = Math.max(2, cell * 0.06);
      ctx.save();
      ctx.strokeStyle = '#e0653f';
      ctx.lineWidth = lw;
      ctx.setLineDash([cell * 0.16, cell * 0.12]);
      ctx.strokeRect(ox + this.hoverCell.x * cell + lw, oy + this.hoverCell.y * cell + lw, cell - 2 * lw, cell - 2 * lw);
      ctx.restore();
    }
    if (this.tool !== 'select') return;
    if (this.dragHover) {
      const cur = this.selectedPos();
      if (cur && (this.dragHover.x !== cur.x || this.dragHover.y !== cur.y)) {
        const ok = this.canDropAt(this.dragHover.x, this.dragHover.y);
        ctx.save();
        ctx.fillStyle = ok ? 'rgba(80,180,100,0.40)' : 'rgba(210,85,63,0.40)';
        ctx.fillRect(ox + this.dragHover.x * cell + 2, oy + this.dragHover.y * cell + 2, cell - 4, cell - 4);
        ctx.restore();
      }
    }
    const p = this.selectedPos();
    if (p) {
      const lw = Math.max(2, cell * 0.06);
      ctx.save();
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = lw;
      ctx.setLineDash([cell * 0.16, cell * 0.12]);
      ctx.strokeRect(ox + p.x * cell + lw, oy + p.y * cell + lw, cell - 2 * lw, cell - 2 * lw);
      ctx.restore();
    }
  }

  /* ----------------------------- fixed track ----------------------------- */

  private buildTrackMask(): void {
    this.trackMask.clear();
    if (!this.level) return;
    for (const t of this.level.fixedTiles) {
      if (t.type !== 'track') continue;
      // Match buildGrid's edgesToMask precedence exactly (a raw mask wins over
      // edges) so the editor and the game agree on the shape.
      const m = typeof t.mask === 'number' ? t.mask : (t.edges ?? []).reduce((a, e) => addEdge(a, e), 0);
      this.trackMask.set(`${t.x},${t.y}`, m);
    }
  }
  /** A cell that can hold (or connect to) track: empty, existing track, or a
   *  rail-bearing fixed tile (start/exit/tunnel/gate/button/signal/switch). */
  private trackTargetAt(x: number, y: number): 'lay' | 'connect' | 'no' {
    if (!this.level) return 'no';
    // A cell may hold both a rail-bearing tile and laid track; prefer the tile.
    const tile =
      this.level.fixedTiles.find((t) => t.type !== 'track' && t.x === x && t.y === y) ??
      this.level.fixedTiles.find((t) => t.type === 'track' && t.x === x && t.y === y);
    if (!tile) return 'lay';
    if (tile.type === 'track') return 'lay';
    if (tile.type === 'rock') return 'no';
    return 'connect'; // start/exit/tunnel/gate/etc.
  }
  /** Lay along an orthogonal path so a quick drag doesn't leave gaps. */
  private walkLayTrack(from: { x: number; y: number }, to: { x: number; y: number }): void {
    if (!this.level) return;
    const max = this.level.grid.cols + this.level.grid.rows + 2;
    let cur = { ...from };
    let guard = 0;
    while ((cur.x !== to.x || cur.y !== to.y) && guard++ < max) {
      const next = { ...cur };
      if (cur.x !== to.x) next.x += Math.sign(to.x - cur.x);
      else next.y += Math.sign(to.y - cur.y);
      this.layTrack(cur, next);
      cur = next;
    }
  }
  private layTrack(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const h = headingBetween(a.x, a.y, b.x, b.y);
    if (!h) return;
    const ta = this.trackTargetAt(a.x, a.y);
    const tb = this.trackTargetAt(b.x, b.y);
    if (ta === 'no' || tb === 'no') return;
    if (ta === 'lay') this.addTrackEdge(a.x, a.y, h);
    if (tb === 'lay') this.addTrackEdge(b.x, b.y, OPPOSITE[h]);
    this.rebuildTrackTiles();
  }
  private addTrackEdge(x: number, y: number, h: Heading): void {
    const key = `${x},${y}`;
    this.trackMask.set(key, addEdge(this.trackMask.get(key) ?? 0, h));
  }
  private rebuildTrackTiles(): void {
    if (!this.level) return;
    this.level.fixedTiles = this.level.fixedTiles.filter((t) => t.type !== 'track');
    for (const [key, mask] of this.trackMask) {
      if (mask === 0) continue;
      const [x, y] = key.split(',').map(Number);
      this.level.fixedTiles.push({ x, y, type: 'track', edges: edgeList(mask) });
    }
  }
  private nextPairId(): number {
    const counts = new Map<number, number>();
    for (const t of this.level?.fixedTiles ?? [])
      if (t.type === 'tunnel' && t.pairId !== undefined) counts.set(t.pairId, (counts.get(t.pairId) ?? 0) + 1);
    for (let id = 1; ; id++) if ((counts.get(id) ?? 0) < 2) return id;
  }

  /* ----------------------------- render / validate ----------------------------- */

  private afterEdit(): void {
    this.dirty = true;
    this.draw();
    this.validate();
  }
  private resize(): void {
    if (this.level) this.renderer.resize(this.level.grid.cols, this.level.grid.rows);
  }
  private draw(): void {
    if (!this.level) return;
    const grid = buildGrid(this.level);
    const ents: DrawEntity[] = [];
    for (const d of this.level.decor ?? []) ents.push({ kind: 'decor', x: d.x, y: d.y, heading: 'N', sprite: d.sprite, scale: d.scale });
    for (const w of this.level.wagons ?? []) ents.push({ kind: 'wagon', x: w.x, y: w.y, heading: 'N', number: w.number });
    for (const m of this.level.movers ?? []) ents.push({ kind: 'mover', x: m.x, y: m.y, heading: m.heading });
    ents.push({ kind: 'loco', x: this.level.locomotive.x, y: this.level.locomotive.y, heading: this.level.locomotive.heading });
    this.renderer.draw(grid, ents);
    this.drawOverlays();
  }
  private validate(): Issue[] {
    if (!this.level) return [];
    this.readInputs();
    const issues = validateLevel(this.level);
    this.validEl.replaceChildren();
    if (!issues.length) {
      this.validEl.appendChild(el('span', 'ok', '✓ No problems found.'));
    } else {
      for (const i of issues) this.validEl.appendChild(el('div', i.level === 'error' ? 'err' : 'warn', (i.level === 'error' ? '✕ ' : '⚠ ') + i.msg));
    }
    return issues;
  }

  /* ----------------------------- actions ----------------------------- */

  private save(): void {
    if (!this.level) return;
    this.readInputs();
    // Refuse a rename that would clobber a different existing level.
    if (this.level.id !== this.editingId && this.store.get(this.level.id)) {
      this.status(`A level with id "${this.level.id}" already exists — pick another id.`);
      this.level.id = this.editingId;
      this.inputs.id.value = this.editingId;
      return;
    }
    // Don't silently persist a level that can't be played.
    const issues = this.validate();
    if (issues.some((i) => i.level === 'error') && !confirm('This level has errors and may be unplayable. Save anyway?')) {
      this.status('Fix the errors before saving.');
      return;
    }
    if (this.level.id !== this.editingId) this.store.remove(this.editingId);
    this.store.save(this.level);
    this.editingId = this.level.id;
    this.dirty = false;
    this.renderList();
    this.status('Saved.');
  }
  private test(): void {
    if (!this.level) return;
    const issues = this.validate();
    if (issues.some((i) => i.level === 'error')) {
      this.status('Fix the errors before testing.');
      return;
    }
    this.close();
    this.onTest(JSON.parse(JSON.stringify(this.level)) as Level);
  }
  private status(msg: string): void {
    this.refs.status.textContent = msg;
  }
}

// Keep the LevelTile type referenced (used by callers / future tooling).
export type { LevelTile };
