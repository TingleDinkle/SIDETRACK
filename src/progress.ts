/**
 * Player progress persisted to localStorage: which levels are solved and the
 * best (fewest) tick count for each. Safe to use when storage is unavailable
 * (private mode / disabled) — it degrades to an in-memory store.
 */

const KEY = 'sidetrack.progress.v1';

interface Record_ {
  ticks: number;
}
interface Data {
  completed: Record<string, Record_>;
}

export class Progress {
  private data: Data = { completed: {} };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) as Data;
      if (!this.data.completed) this.data.completed = {};
    } catch {
      /* storage unavailable — keep the in-memory default */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  isComplete(id: string): boolean {
    return !!this.data.completed[id];
  }
  bestTicks(id: string): number | null {
    return this.data.completed[id]?.ticks ?? null;
  }
  completedCount(): number {
    return Object.keys(this.data.completed).length;
  }

  /** Record a win; keeps the best (lowest) tick count. Returns true if improved. */
  markComplete(id: string, ticks: number): boolean {
    const prev = this.data.completed[id];
    if (prev && prev.ticks <= ticks) return false;
    this.data.completed[id] = { ticks };
    this.persist();
    return true;
  }

  reset(): void {
    this.data = { completed: {} };
    this.persist();
  }
}
