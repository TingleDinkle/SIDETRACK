/**
 * LevelStore — the persistent level library that backs both the player's level
 * select and the in-app manager/editor. Seeded from the built-in library on
 * first run, then kept in localStorage so authored levels survive reloads.
 *
 * Everything edits a single working copy here; the editor reads/writes through
 * the store, the level-select lists from it, and the whole thing can be exported
 * to / imported from the same JSON shape the game ships in `levels.json`.
 */

import { Level } from './level.js';
import { World } from './levelData.js';
import { validateLevel } from './levelLoader.js';

const KEY = 'sidetrack.levels.v1';

export interface Bundle {
  worlds: World[];
  levels: Level[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function blankLevel(id: string, world: number): Level {
  return {
    id,
    world,
    name: 'New Level',
    grid: { cols: 7, rows: 5 },
    trackBudget: 8,
    locomotive: { x: 0, y: 2, heading: 'E' },
    fixedTiles: [{ x: 6, y: 2, type: 'exit', heading: 'W' }],
    wagons: [],
    movers: [],
    decor: [],
    objectives: { couple: 'all-in-order', passengers: 0 },
  };
}

export class LevelStore {
  private worldList: World[];
  private levelList: Level[];

  constructor(private readonly defaults: Bundle) {
    const loaded = this.read();
    if (loaded && loaded.levels.length) {
      this.worldList = loaded.worlds;
      this.levelList = loaded.levels;
    } else {
      this.worldList = clone(defaults.worlds);
      this.levelList = clone(defaults.levels);
      this.persist();
    }
  }

  worlds(): World[] {
    return this.worldList;
  }
  levels(): Level[] {
    return this.levelList;
  }
  get(id: string): Level | undefined {
    return this.levelList.find((l) => l.id === id);
  }
  index(id: string): number {
    return this.levelList.findIndex((l) => l.id === id);
  }

  /** Upsert a level by id (keeps list order; appends if new). */
  save(level: Level): void {
    const i = this.index(level.id);
    if (i >= 0) this.levelList[i] = clone(level);
    else this.levelList.push(clone(level));
    this.ensureWorld(level.world);
    this.persist();
  }

  remove(id: string): void {
    this.levelList = this.levelList.filter((l) => l.id !== id);
    this.persist();
  }

  create(world = 9): Level {
    const lvl = blankLevel(this.uniqueId(world), world);
    this.levelList.push(lvl);
    this.ensureWorld(world);
    this.persist();
    return lvl;
  }

  duplicate(id: string): Level | undefined {
    const src = this.get(id);
    if (!src) return undefined;
    const copy = clone(src);
    copy.id = this.uniqueId(typeof src.world === 'number' ? src.world : 9);
    copy.name = `${src.name} copy`;
    const at = this.index(id);
    this.levelList.splice(at + 1, 0, copy);
    this.persist();
    return copy;
  }

  resetDefaults(): void {
    this.worldList = clone(this.defaults.worlds);
    this.levelList = clone(this.defaults.levels);
    this.persist();
  }

  exportJSON(): string {
    return JSON.stringify({ version: 1, worlds: this.worldList, levels: this.levelList }, null, 2);
  }

  /** Replace the whole library from a JSON bundle (validates each level). */
  importJSON(text: string): { ok: boolean; error?: string } {
    try {
      const data = JSON.parse(text) as { worlds?: World[]; levels?: unknown[] };
      const levels = (data.levels ?? []).map(validateLevel);
      if (!levels.length) throw new Error('no levels in bundle');
      this.levelList = levels;
      this.worldList = data.worlds && data.worlds.length ? data.worlds : this.worldsFromLevels(levels);
      this.persist();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* ----------------------------- internals ----------------------------- */

  private uniqueId(world: number): string {
    for (let n = 1; ; n++) {
      const id = `${world}-${n}`;
      if (!this.get(id)) return id;
    }
  }
  private ensureWorld(worldId: Level['world']): void {
    const id = typeof worldId === 'number' ? worldId : Number(worldId) || 9;
    if (!this.worldList.some((w) => w.id === id)) {
      this.worldList.push({ id, name: id === 9 ? 'Custom' : `World ${id}`, blurb: '' });
      this.worldList.sort((a, b) => a.id - b.id);
    }
  }
  private worldsFromLevels(levels: Level[]): World[] {
    const ids = [...new Set(levels.map((l) => (typeof l.world === 'number' ? l.world : 9)))].sort((a, b) => a - b);
    return ids.map((id) => this.worldList.find((w) => w.id === id) ?? { id, name: `World ${id}`, blurb: '' });
  }

  private read(): Bundle | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw) as Bundle;
    } catch {
      return null;
    }
  }
  private persist(): void {
    try {
      localStorage.setItem(KEY, this.exportJSON());
    } catch {
      /* storage unavailable — keep in memory only */
    }
  }
}
