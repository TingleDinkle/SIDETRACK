/**
 * Soft economy persisted to localStorage: coins + gems, an owned-booster stock,
 * and the daily-reward / scratch cadence. Everything is *earnable* — there is no
 * real-money IAP; coins come from solving levels, the daily reward and scratch
 * cards, and are spent on booster uses in the shop. Degrades to in-memory when
 * storage is unavailable (private mode), mirroring Progress.
 */

const KEY = 'sidetrack.economy.v1';

export type BoosterId = 'reverse' | 'track' | 'hold' | 'boost';
export const BOOSTER_IDS: readonly BoosterId[] = ['reverse', 'track', 'hold', 'boost'] as const;

export interface Reward {
  coins?: number;
  gems?: number;
  booster?: BoosterId;
}

interface Data {
  coins: number;
  gems: number;
  boosters: Record<BoosterId, number>;
  dailyDay: number; // last claimed day in the 7-day cycle (0 = none yet)
  lastDaily: string | null; // YYYY-MM-DD of the last daily claim
  lastScratch: string | null; // YYYY-MM-DD of the last scratch
}

const fresh = (): Data => ({
  coins: 200,
  gems: 5,
  boosters: { reverse: 2, track: 3, hold: 2, boost: 2 },
  dailyDay: 0,
  lastDaily: null,
  lastScratch: null,
});

/** Coin / gem price to buy one use of each booster. */
export const BOOSTER_PRICE: Record<BoosterId, { coins: number; gems: number }> = {
  reverse: { coins: 80, gems: 15 },
  track: { coins: 60, gems: 12 },
  hold: { coins: 100, gems: 18 },
  boost: { coins: 70, gems: 14 },
};

/** Day 1..7 of the daily-reward cycle. */
export const DAILY: Reward[] = [
  { coins: 50 },
  { coins: 75 },
  { coins: 100, gems: 2 },
  { coins: 125 },
  { coins: 150, gems: 3 },
  { coins: 200 },
  { coins: 300, gems: 10 },
];

export class Economy {
  private data: Data;
  /** Fired on any balance/stock change so the UI can refresh. */
  onChange: (() => void) | null = null;

  constructor() {
    let d = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Data>;
        // per-key backfill so a partial/older save keeps the fresh starting stock
        d = { ...d, ...p, boosters: { ...fresh().boosters, ...(p.boosters ?? {}) } };
      }
    } catch {
      /* storage unavailable */
    }
    if (!Number.isInteger(d.dailyDay) || d.dailyDay < 0 || d.dailyDay > 7) d.dailyDay = 0;
    this.data = d;
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore quota / disabled storage */
    }
    this.onChange?.();
  }

  get coins(): number {
    return this.data.coins;
  }
  get gems(): number {
    return this.data.gems;
  }
  boosterCount(id: BoosterId): number {
    return this.data.boosters[id] ?? 0;
  }

  addBooster(id: BoosterId, n = 1): void {
    this.data.boosters[id] = this.boosterCount(id) + n;
    this.persist();
  }
  /** Consume one owned booster. Returns false (no change) if the stock is empty. */
  useBooster(id: BoosterId): boolean {
    if (this.boosterCount(id) <= 0) return false;
    this.data.boosters[id]--;
    this.persist();
    return true;
  }

  applyReward(r: Reward): void {
    if (r.coins) this.data.coins += r.coins;
    if (r.gems) this.data.gems += r.gems;
    if (r.booster) this.data.boosters[r.booster] = this.boosterCount(r.booster) + 1;
    this.persist();
  }

  /** Buy one use of a booster with coins or gems. False if unaffordable. */
  buy(id: BoosterId, currency: 'coins' | 'gems'): boolean {
    const price = BOOSTER_PRICE[id][currency];
    if (currency === 'coins') {
      if (this.data.coins < price) return false;
      this.data.coins -= price;
    } else {
      if (this.data.gems < price) return false;
      this.data.gems -= price;
    }
    this.data.boosters[id] = this.boosterCount(id) + 1;
    this.persist();
    return true;
  }

  /* --------------------------- daily reward --------------------------- */

  private static iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  private today(): string {
    return Economy.iso(new Date());
  }
  private yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return Economy.iso(d);
  }

  canClaimDaily(): boolean {
    return this.data.lastDaily !== this.today();
  }
  /** The 1..7 day that the next claim will grant (continuing or restarting the streak). */
  nextDailyDay(): number {
    if (this.data.lastDaily === this.today()) return this.data.dailyDay; // already claimed today
    const continued = this.data.lastDaily === this.yesterday() && this.data.dailyDay >= 1 && this.data.dailyDay < 7;
    return continued ? this.data.dailyDay + 1 : 1;
  }
  /** True once today's reward has been collected (for marking the card). */
  claimedToday(): boolean {
    return this.data.lastDaily === this.today();
  }
  /** Claim today's reward. Returns {reward, day} or null if already claimed. */
  claimDaily(): { reward: Reward; day: number } | null {
    if (!this.canClaimDaily()) return null;
    const day = this.nextDailyDay();
    this.data.dailyDay = day;
    this.data.lastDaily = this.today();
    const reward = DAILY[day - 1];
    this.applyReward(reward); // persists + fires onChange
    return { reward, day };
  }

  /* --------------------------- scratch & win --------------------------- */

  canScratch(): boolean {
    return this.data.lastScratch !== this.today();
  }
  /** Reveal one daily scratch reward (random). Null if already scratched today. */
  scratch(): Reward | null {
    if (!this.canScratch()) return null;
    this.data.lastScratch = this.today();
    const roll = Math.random();
    let reward: Reward;
    if (roll < 0.55) reward = { coins: 25 + Math.floor(Math.random() * 6) * 25 }; // 25..150
    else if (roll < 0.85) reward = { gems: 1 + Math.floor(Math.random() * 5) }; // 1..5
    else reward = { booster: BOOSTER_IDS[Math.floor(Math.random() * BOOSTER_IDS.length)] };
    this.applyReward(reward); // persists + fires onChange
    return reward;
  }
}
