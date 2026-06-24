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

import { buildGrid, Level, LevelTile } from './level.js';
import { DrawEntity, Renderer } from './render.js';
import { AssetManager } from './assets.js';
import { LevelStore } from './levelStore.js';
import { Issue, validateLevel } from './levelValidate.js';
import { Heading, OPPOSITE, addEdge, edgeList, headingBetween } from './types.js';

type Tool =
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

const TOOLS: { tool: Tool; label: string }[] = [
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
    window.addEventListener('pointerup', () => (this.painting = false));
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
    if (this.dirty && this.editingId !== id && !confirm('Discard unsaved changes to this level?')) return;
    const src = this.store.get(id);
    if (!src) return;
    this.level = JSON.parse(JSON.stringify(src)) as Level;
    this.editingId = id;
    this.dirty = false;
    this.buildTrackMask();
    this.syncInputs();
    this.editorEl.style.display = '';
    this.renderList();
    this.resize();
    this.draw();
    this.validate();
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
        for (const c of this.toolsEl.children) c.classList.toggle('sel', (c as HTMLElement).dataset.tool === this.tool);
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
    for (const c of ['red', 'blue', 'green', 'yellow']) this.color.add(new Option(c, c));
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

    root.append(meta, this.toolsEl, opts, stage, this.validEl, actions);
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
    L.objectives = { couple: 'all-in-order', passengers: Math.max(0, Math.floor(Number(this.inputs.passengers.value) || 0)) };
  }

  private onMetaChange(): void {
    if (!this.level) return;
    const cols = Math.max(2, Math.min(16, Math.floor(Number(this.inputs.cols.value) || 7)));
    const rows = Math.max(2, Math.min(12, Math.floor(Number(this.inputs.rows.value) || 5)));
    this.readInputs();
    if (cols !== this.level.grid.cols || rows !== this.level.grid.rows) {
      this.level.grid = { cols, rows };
      const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
      this.level.fixedTiles = this.level.fixedTiles.filter((t) => inb(t.x, t.y));
      this.level.wagons = (this.level.wagons ?? []).filter((w) => inb(w.x, w.y));
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
  }

  /* ----------------------------- painting ----------------------------- */

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.painting = true;
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    if (!cell) return;
    this.last = cell;
    if (this.tool !== 'track') this.placeAt(cell.x, cell.y);
  };
  private onMove = (e: PointerEvent): void => {
    if (!this.painting || !this.level) return;
    const cell = this.renderer.cellAt(e.clientX, e.clientY);
    if (!cell || (this.last && cell.x === this.last.x && cell.y === this.last.y)) return;
    e.preventDefault();
    if (this.tool === 'track' && this.last) {
      this.walkLayTrack(this.last, cell); // interpolate so fast drags don't skip cells
      this.afterEdit();
    } else if (DRAG_TOOLS.has(this.tool)) {
      this.placeAt(cell.x, cell.y);
    }
    this.last = cell;
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
        removeEntities();
        removeTiles();
        removeTrack();
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
        break;
      case 'button':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'button', edges: edgesHV, color });
        break;
      case 'signal':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'signal', edges: edgesHV, open: this.openChk.checked });
        break;
      case 'switch':
        removeEntities();
        removeTiles();
        L.fixedTiles.push({ x, y, type: 'switch', edges: edgesHV, color });
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

  /* ----------------------------- fixed track ----------------------------- */

  private buildTrackMask(): void {
    this.trackMask.clear();
    if (!this.level) return;
    for (const t of this.level.fixedTiles) {
      if (t.type !== 'track') continue;
      let m = typeof t.mask === 'number' ? t.mask : 0;
      if (t.edges) for (const e of t.edges) m = addEdge(m, e);
      this.trackMask.set(`${t.x},${t.y}`, m);
    }
  }
  /** A cell that can hold (or connect to) track: empty, existing track, or a
   *  rail-bearing fixed tile (start/exit/tunnel/gate/button/signal/switch). */
  private trackTargetAt(x: number, y: number): 'lay' | 'connect' | 'no' {
    if (!this.level) return 'no';
    const tile = this.level.fixedTiles.find((t) => t.x === x && t.y === y);
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
