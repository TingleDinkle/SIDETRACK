/**
 * Soft economy persisted to localStorage: coins + gems, an owned-booster stock,
 * and the daily-reward / scratch cadence. Everything is *earnable* — there is no
 * real-money IAP; coins come from solving levels, the daily reward and scratch
 * cards, and are spent on booster uses in the shop. Degrades to in-memory when
 * storage is unavailable (private mode), mirroring Progress.
 */
const KEY = 'sidetrack.economy.v1';
export const BOOSTER_IDS = ['reverse', 'track', 'hold', 'boost'];
const fresh = () => ({
    coins: 200,
    gems: 5,
    boosters: { reverse: 2, track: 3, hold: 2, boost: 2 },
    dailyDay: 0,
    lastDaily: null,
});
/** Coin / gem price to buy one use of each booster. */
export const BOOSTER_PRICE = {
    reverse: { coins: 80, gems: 15 },
    track: { coins: 60, gems: 12 },
    hold: { coins: 100, gems: 18 },
    boost: { coins: 70, gems: 14 },
};
/** Day 1..7 of the daily-reward cycle. */
export const DAILY = [
    { coins: 50 },
    { coins: 75 },
    { coins: 100, gems: 2 },
    { coins: 125 },
    { coins: 150, gems: 3 },
    { coins: 200 },
    { coins: 300, gems: 10 },
];
export class Economy {
    constructor() {
        /** Fired on any balance/stock change so the UI can refresh. */
        this.onChange = null;
        let d = fresh();
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const p = JSON.parse(raw);
                // per-key backfill so a partial/older save keeps the fresh starting stock
                d = { ...d, ...p, boosters: { ...fresh().boosters, ...(p.boosters ?? {}) } };
            }
        }
        catch {
            /* storage unavailable */
        }
        if (!Number.isInteger(d.dailyDay) || d.dailyDay < 0 || d.dailyDay > 7)
            d.dailyDay = 0;
        this.data = d;
    }
    persist() {
        try {
            localStorage.setItem(KEY, JSON.stringify(this.data));
        }
        catch {
            /* ignore quota / disabled storage */
        }
        this.onChange?.();
    }
    get coins() {
        return this.data.coins;
    }
    get gems() {
        return this.data.gems;
    }
    boosterCount(id) {
        return this.data.boosters[id] ?? 0;
    }
    addBooster(id, n = 1) {
        this.data.boosters[id] = this.boosterCount(id) + n;
        this.persist();
    }
    /** Consume one owned booster. Returns false (no change) if the stock is empty. */
    useBooster(id) {
        if (this.boosterCount(id) <= 0)
            return false;
        this.data.boosters[id]--;
        this.persist();
        return true;
    }
    applyReward(r) {
        if (r.coins)
            this.data.coins += r.coins;
        if (r.gems)
            this.data.gems += r.gems;
        if (r.booster)
            this.data.boosters[r.booster] = this.boosterCount(r.booster) + 1;
        this.persist();
    }
    /** Buy one use of a booster with coins or gems. False if unaffordable. */
    buy(id, currency) {
        const price = BOOSTER_PRICE[id][currency];
        if (currency === 'coins') {
            if (this.data.coins < price)
                return false;
            this.data.coins -= price;
        }
        else {
            if (this.data.gems < price)
                return false;
            this.data.gems -= price;
        }
        this.data.boosters[id] = this.boosterCount(id) + 1;
        this.persist();
        return true;
    }
    /* --------------------------- daily reward --------------------------- */
    static iso(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    today() {
        return Economy.iso(new Date());
    }
    yesterday() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return Economy.iso(d);
    }
    canClaimDaily() {
        return this.data.lastDaily !== this.today();
    }
    /** The 1..7 day that the next claim will grant (continuing or restarting the streak). */
    nextDailyDay() {
        if (this.data.lastDaily === this.today())
            return this.data.dailyDay; // already claimed today
        const continued = this.data.lastDaily === this.yesterday() && this.data.dailyDay >= 1 && this.data.dailyDay < 7;
        return continued ? this.data.dailyDay + 1 : 1;
    }
    /** True once today's reward has been collected (for marking the card). */
    claimedToday() {
        return this.data.lastDaily === this.today();
    }
    /** Claim today's reward. Returns {reward, day} or null if already claimed. */
    claimDaily() {
        if (!this.canClaimDaily())
            return null;
        const day = this.nextDailyDay();
        this.data.dailyDay = day;
        this.data.lastDaily = this.today();
        const reward = DAILY[day - 1];
        this.applyReward(reward); // persists + fires onChange
        return { reward, day };
    }
    /* --------------------------- scratch & win --------------------------- */
    /** Reveal one scratch reward (random). Repeatable — the UI gives a fresh board
     *  on every visit and on page refresh (no daily lock). */
    scratch() {
        const roll = Math.random();
        let reward;
        if (roll < 0.55)
            reward = { coins: 25 + Math.floor(Math.random() * 6) * 25 }; // 25..150
        else if (roll < 0.85)
            reward = { gems: 1 + Math.floor(Math.random() * 5) }; // 1..5
        else
            reward = { booster: BOOSTER_IDS[Math.floor(Math.random() * BOOSTER_IDS.length)] };
        this.applyReward(reward); // persists + fires onChange
        return reward;
    }
}
//# sourceMappingURL=economy.js.map