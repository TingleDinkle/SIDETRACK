/**
 * M6 — in-app level editor.
 *
 * Paints fixed tiles and entities onto a grid, edits grid size / budget, and
 * exports a Level in the exact JSON shape the loader consumes (and can import
 * one back). "Test" hands the level to the Game to play immediately.
 *
 * The editor builds a live `Grid` via `buildGrid` from its in-progress Level and
 * reuses the game Renderer for the preview — so what you author is exactly what
 * the game shows.
 */

import { buildGrid, Level, LevelMover, LevelTile, LevelWagon } from './level.js';
import { validateLevel } from './levelLoader.js';
import { DrawEntity, Renderer } from './render.js';
import { Heading } from './types.js';

type Tool =
  | 'start'
  | 'exit'
  | 'rock'
  | 'tunnel'
  | 'gate'
  | 'button'
  | 'signal'
  | 'switch'
  | 'wagon'
  | 'mover'
  | 'erase';

const TOOLS: { tool: Tool; label: string }[] = [
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

export interface EditorRefs {
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
  tools: HTMLElement;
  cols: HTMLInputElement;
  rows: HTMLInputElement;
  budget: HTMLInputElement;
  heading: HTMLSelectElement;
  orient: HTMLSelectElement;
  color: HTMLSelectElement;
  json: HTMLTextAreaElement;
  status: HTMLElement;
}

const blank = (): Level => ({
  id: 'custom-1',
  world: 9,
  name: 'My Level',
  grid: { cols: 7, rows: 5 },
  trackBudget: 8,
  locomotive: { x: 0, y: 2, heading: 'E' },
  fixedTiles: [],
  wagons: [],
  movers: [],
  objectives: { couple: 'all-in-order', passengers: 0 },
});

export class LevelEditor {
  private level: Level = blank();
  private tool: Tool = 'rock';
  private readonly renderer: Renderer;
  private painting = false;

  constructor(
    private readonly refs: EditorRefs,
    private readonly onTest: (level: Level) => void,
  ) {
    this.renderer = new Renderer(refs.canvas);
    this.buildToolButtons();

    refs.canvas.addEventListener('pointerdown', this.onDown, { passive: false });
    refs.canvas.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', () => (this.painting = false));

    refs.cols.addEventListener('change', () => this.resizeGrid());
    refs.rows.addEventListener('change', () => this.resizeGrid());
    refs.budget.addEventListener('change', () => {
      this.level.trackBudget = Math.max(0, Math.floor(Number(refs.budget.value) || 0));
    });

    const ro = new ResizeObserver(() => this.draw());
    ro.observe(refs.canvas);
  }

  open(seed?: Level): void {
    this.level = seed ? structuredCloneLevel(seed) : blank();
    this.syncInputs();
    this.refs.panel.classList.add('show');
    this.resize();
    this.draw();
    this.status('');
  }
  close(): void {
    this.refs.panel.classList.remove('show');
  }

  /* ----------------------------- tools ----------------------------- */

  private buildToolButtons(): void {
    this.refs.tools.replaceChildren();
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.dataset.tool = t.tool;
      if (t.tool === this.tool) b.classList.add('sel');
      b.addEventListener('click', () => {
        this.tool = t.tool;
        for (const el of this.refs.tools.children) el.classList.toggle('sel', (el as HTMLElement).dataset.tool === this.tool);
      });
      this.refs.tools.appendChild(b);
    }
  }

  private syncInputs(): void {
    this.refs.cols.value = String(this.level.grid.cols);
    this.refs.rows.value = String(this.level.grid.rows);
    this.refs.budget.value = String(this.level.trackBudget);
  }

  private resizeGrid(): void {
    const cols = Math.max(2, Math.min(16, Math.floor(Number(this.refs.cols.value) || 7)));
    const rows = Math.max(2, Math.min(12, Math.floor(Number(this.refs.rows.value) || 5)));
    this.level.grid = { cols, rows };
    // Drop anything now off the board.
    const inb = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
    this.level.fixedTiles = this.level.fixedTiles.filter((t) => inb(t.x, t.y));
    this.level.wagons = (this.level.wagons ?? []).filter((w) => inb(w.x, w.y));
    this.level.movers = (this.level.movers ?? []).filter((m) => inb(m.x, m.y));
    if (!inb(this.level.locomotive.x, this.level.locomotive.y)) this.level.locomotive = { x: 0, y: 0, heading: 'E' };
    this.syncInputs();
    this.resize();
    this.draw();
  }

  /* ----------------------------- painting ----------------------------- */

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.painting = true;
    this.place(e.clientX, e.clientY);
  };
  private onMove = (e: PointerEvent): void => {
    if (!this.painting) return;
    // Only paintable tools repeat on drag; singletons (start/exit) place once.
    if (this.tool === 'rock' || this.tool === 'erase') this.place(e.clientX, e.clientY);
  };

  private place(clientX: number, clientY: number): void {
    const cell = this.renderer.cellAt(clientX, clientY);
    if (!cell) return;
    const { x, y } = cell;
    this.removeAt(x, y, this.tool !== 'erase'); // clear the cell first (so one thing per cell)
    if (this.tool === 'erase') {
      this.draw();
      return;
    }

    const heading = this.refs.heading.value as Heading;
    const color = this.refs.color.value;
    const edgesHV: Heading[] = this.refs.orient.value === 'V' ? ['N', 'S'] : ['W', 'E'];

    switch (this.tool) {
      case 'start':
        this.level.locomotive = { x, y, heading };
        break;
      case 'exit':
        this.level.fixedTiles.push({ x, y, type: 'exit', heading });
        break;
      case 'rock':
        this.level.fixedTiles.push({ x, y, type: 'rock' });
        break;
      case 'tunnel':
        this.level.fixedTiles.push({ x, y, type: 'tunnel', edges: [heading], pairId: this.nextPairId() });
        break;
      case 'gate':
        this.level.fixedTiles.push({ x, y, type: 'gate', edges: edgesHV, color, open: false });
        break;
      case 'button':
        this.level.fixedTiles.push({ x, y, type: 'button', edges: edgesHV, color });
        break;
      case 'signal':
        this.level.fixedTiles.push({ x, y, type: 'signal', edges: edgesHV, open: true });
        break;
      case 'switch':
        this.level.fixedTiles.push({ x, y, type: 'switch', edges: edgesHV, color });
        break;
      case 'wagon':
        (this.level.wagons ??= []).push({ x, y, number: this.nextWagonNumber() });
        break;
      case 'mover':
        (this.level.movers ??= []).push({ x, y, heading });
        break;
    }
    this.draw();
  }

  /** Remove whatever occupies a cell. `keepStart` avoids nuking the loco when overwriting with a non-start tile elsewhere. */
  private removeAt(x: number, y: number, _keepStart: boolean): void {
    this.level.fixedTiles = this.level.fixedTiles.filter((t) => !(t.x === x && t.y === y));
    this.level.wagons = (this.level.wagons ?? []).filter((w) => !(w.x === x && w.y === y));
    this.level.movers = (this.level.movers ?? []).filter((m) => !(m.x === x && m.y === y));
    // Wagons renumber so they stay 1..N contiguous.
    this.level.wagons.forEach((w, i) => (w.number = i + 1));
  }

  private nextPairId(): number {
    const counts = new Map<number, number>();
    for (const t of this.level.fixedTiles) if (t.type === 'tunnel' && t.pairId !== undefined)
      counts.set(t.pairId, (counts.get(t.pairId) ?? 0) + 1);
    for (let id = 1; ; id++) if ((counts.get(id) ?? 0) < 2) return id;
  }
  private nextWagonNumber(): number {
    return (this.level.wagons ?? []).length + 1;
  }

  /* ----------------------------- render ----------------------------- */

  private resize(): void {
    this.renderer.resize(this.level.grid.cols, this.level.grid.rows);
  }

  private draw(): void {
    const grid = buildGrid(this.level);
    const ents: DrawEntity[] = [];
    for (const w of this.level.wagons ?? []) ents.push({ kind: 'wagon', x: w.x, y: w.y, heading: 'N', number: w.number });
    for (const m of this.level.movers ?? []) ents.push({ kind: 'mover', x: m.x, y: m.y, heading: m.heading });
    ents.push({ kind: 'loco', x: this.level.locomotive.x, y: this.level.locomotive.y, heading: this.level.locomotive.heading });
    this.renderer.draw(grid, ents);
  }

  /* ----------------------------- io ----------------------------- */

  exportJSON(): void {
    this.refs.json.value = JSON.stringify(this.level, null, 2);
    this.status('Exported — copy the JSON or paste your own and Import.');
  }
  async copyJSON(): Promise<void> {
    this.exportJSON();
    try {
      await navigator.clipboard.writeText(this.refs.json.value);
      this.status('Copied to clipboard.');
    } catch {
      this.status('Select the text to copy.');
    }
  }
  importJSON(): void {
    try {
      const obj = JSON.parse(this.refs.json.value);
      const lvl = validateLevel(obj);
      this.level = structuredCloneLevel(lvl);
      this.syncInputs();
      this.resize();
      this.draw();
      this.status('Imported.');
    } catch (e) {
      this.status('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  clear(): void {
    this.level = { ...blank(), grid: this.level.grid, trackBudget: this.level.trackBudget };
    this.draw();
    this.status('Cleared.');
  }
  test(): void {
    const issues = this.validate();
    if (issues) {
      this.status(issues);
      return;
    }
    this.close();
    this.onTest(structuredCloneLevel(this.level));
  }

  /** Light sanity check before test-play. */
  private validate(): string | null {
    if (!this.level.fixedTiles.some((t) => t.type === 'exit')) return 'Add an Exit tile.';
    return null;
  }

  private status(msg: string): void {
    this.refs.status.textContent = msg;
  }
}

function structuredCloneLevel(l: Level): Level {
  return JSON.parse(JSON.stringify(l)) as Level;
}

// Keep referenced types from being pruned by isolatedModules-style tooling.
export type { LevelTile, LevelWagon, LevelMover };
