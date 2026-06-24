/**
 * LevelStore — the persistent level library that backs both the player's level
 * select and the in-app manager/editor. Seeded from the built-in library on
 * first run, then kept in localStorage so authored levels survive reloads.
 *
 * Everything edits a single working copy here; the editor reads/writes through
 * the store, the level-select lists from it, and the whole thing can be exported
 * to / imported from the same JSON shape the game ships in `levels.json`.
 */
import { validateLevel } from './levelLoader.js';
const KEY = 'sidetrack.levels.v1';
const clone = (v) => JSON.parse(JSON.stringify(v));
export function blankLevel(id, world) {
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
    constructor(defaults) {
        this.defaults = defaults;
        const loaded = this.read();
        if (loaded && loaded.levels.length) {
            this.worldList = loaded.worlds;
            this.levelList = loaded.levels;
        }
        else {
            this.worldList = clone(defaults.worlds);
            this.levelList = clone(defaults.levels);
            this.persist();
        }
    }
    worlds() {
        return this.worldList;
    }
    levels() {
        return this.levelList;
    }
    get(id) {
        return this.levelList.find((l) => l.id === id);
    }
    index(id) {
        return this.levelList.findIndex((l) => l.id === id);
    }
    /** Upsert a level by id (keeps list order; appends if new). */
    save(level) {
        const i = this.index(level.id);
        if (i >= 0)
            this.levelList[i] = clone(level);
        else
            this.levelList.push(clone(level));
        this.ensureWorld(level.world);
        this.persist();
    }
    remove(id) {
        this.levelList = this.levelList.filter((l) => l.id !== id);
        this.persist();
    }
    create(world = 9) {
        const lvl = blankLevel(this.uniqueId(world), world);
        this.levelList.push(lvl);
        this.ensureWorld(world);
        this.persist();
        return lvl;
    }
    duplicate(id) {
        const src = this.get(id);
        if (!src)
            return undefined;
        const copy = clone(src);
        copy.id = this.uniqueId(typeof src.world === 'number' ? src.world : 9);
        copy.name = `${src.name} copy`;
        const at = this.index(id);
        this.levelList.splice(at + 1, 0, copy);
        this.persist();
        return copy;
    }
    resetDefaults() {
        this.worldList = clone(this.defaults.worlds);
        this.levelList = clone(this.defaults.levels);
        this.persist();
    }
    exportJSON() {
        return JSON.stringify({ version: 1, worlds: this.worldList, levels: this.levelList }, null, 2);
    }
    /** Replace the whole library from a JSON bundle (validates each level). */
    importJSON(text) {
        try {
            const data = JSON.parse(text);
            const levels = (data.levels ?? []).map(validateLevel);
            if (!levels.length)
                throw new Error('no levels in bundle');
            this.levelList = levels;
            this.worldList = data.worlds && data.worlds.length ? data.worlds : this.worldsFromLevels(levels);
            this.persist();
            return { ok: true };
        }
        catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    /* ----------------------------- internals ----------------------------- */
    uniqueId(world) {
        for (let n = 1;; n++) {
            const id = `${world}-${n}`;
            if (!this.get(id))
                return id;
        }
    }
    ensureWorld(worldId) {
        const id = typeof worldId === 'number' ? worldId : Number(worldId) || 9;
        if (!this.worldList.some((w) => w.id === id)) {
            this.worldList.push({ id, name: id === 9 ? 'Custom' : `World ${id}`, blurb: '' });
            this.worldList.sort((a, b) => a.id - b.id);
        }
    }
    worldsFromLevels(levels) {
        const ids = [...new Set(levels.map((l) => (typeof l.world === 'number' ? l.world : 9)))].sort((a, b) => a - b);
        return ids.map((id) => this.worldList.find((w) => w.id === id) ?? { id, name: `World ${id}`, blurb: '' });
    }
    read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw)
                return null;
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    persist() {
        try {
            localStorage.setItem(KEY, this.exportJSON());
        }
        catch {
            /* storage unavailable — keep in memory only */
        }
    }
}
//# sourceMappingURL=levelStore.js.map