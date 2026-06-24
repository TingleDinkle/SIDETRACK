/**
 * Player progress persisted to localStorage: which levels are solved and the
 * best (fewest) tick count for each. Safe to use when storage is unavailable
 * (private mode / disabled) — it degrades to an in-memory store.
 */
const KEY = 'sidetrack.progress.v1';
export class Progress {
    constructor() {
        this.data = { completed: {} };
        try {
            const raw = localStorage.getItem(KEY);
            if (raw)
                this.data = JSON.parse(raw);
            if (!this.data.completed)
                this.data.completed = {};
        }
        catch {
            /* storage unavailable — keep the in-memory default */
        }
    }
    persist() {
        try {
            localStorage.setItem(KEY, JSON.stringify(this.data));
        }
        catch {
            /* ignore quota / disabled storage */
        }
    }
    isComplete(id) {
        return !!this.data.completed[id];
    }
    bestTicks(id) {
        return this.data.completed[id]?.ticks ?? null;
    }
    completedCount() {
        return Object.keys(this.data.completed).length;
    }
    /** Record a win; keeps the best (lowest) tick count. Returns true if improved. */
    markComplete(id, ticks) {
        const prev = this.data.completed[id];
        if (prev && prev.ticks <= ticks)
            return false;
        this.data.completed[id] = { ticks };
        this.persist();
        return true;
    }
    reset() {
        this.data = { completed: {} };
        this.persist();
    }
}
//# sourceMappingURL=progress.js.map