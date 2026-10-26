/** Pure game rules: prices, upgrade curves, offline earnings, chapter goals. No rendering, no physics. */

export const MAX_PUMPS = 6;

export type UpgradeId = "pumps" | "flow" | "price" | "sign" | "shop" | "cashier" | "attendant";

export type State = {
  version: 1;
  money: number;
  /** money earned this chapter, for goals */
  earned: number;
  lifetime: number;
  chapter: number;
  levels: Record<UpgradeId, number>;
  /** money waiting at the till until a cashier is hired */
  till: number;
  /** epoch ms of last save, for offline earnings */
  savedAt: number;
  /** rolling income per second, used for offline earnings and gifts */
  rate: number;
  boostUntil: number;
  giftReadyAt: number;
  cars: number;
  missed: number;
  goalsClaimed: number[];
  noAds: boolean;
  /** daily reward: 0..6 = day of the streak that was claimed last, and its local date (YYYY-MM-DD) */
  dailyDay: number;
  dailyDate: string;
};

export function newState(now = Date.now()): State {
  return {
    version: 1,
    money: 120,
    earned: 0,
    lifetime: 0,
    chapter: 1,
    levels: { pumps: 1, flow: 1, price: 1, sign: 1, shop: 0, cashier: 0, attendant: 0 },
    till: 0,
    savedAt: now,
    rate: 0,
    boostUntil: 0,
    giftReadyAt: now,
    cars: 0,
    missed: 0,
    goalsClaimed: [],
    noAds: false,
    dailyDay: -1,
    dailyDate: "",
  };
}

type Upgrade = {
  id: UpgradeId;
  max: number;
  /** cost to go from `level` to `level + 1` */
  cost: (level: number) => number;
};

const geo = (base: number, growth: number) => (level: number) => Math.round(base * Math.pow(growth, level - 1));

export const UPGRADES: Record<UpgradeId, Upgrade> = {
  pumps: { id: "pumps", max: MAX_PUMPS, cost: (l) => [0, 180, 650, 1800, 4800, 12000][l] ?? Infinity },
  flow: { id: "flow", max: 25, cost: geo(40, 1.32) },
  price: { id: "price", max: 25, cost: geo(60, 1.34) },
  sign: { id: "sign", max: 15, cost: geo(90, 1.45) },
  shop: { id: "shop", max: 10, cost: (l) => (l === 0 ? 900 : Math.round(500 * Math.pow(1.5, l))) },
  cashier: { id: "cashier", max: 1, cost: () => 350 },
  attendant: { id: "attendant", max: 5, cost: (l) => Math.round(700 * Math.pow(2.1, l)) },
};

/** Later chapters cost more and pay more (like moving to a busier road). */
export function chapterScale(chapter: number): number {
  return Math.pow(3, chapter - 1);
}

export function upgradeCost(s: State, id: UpgradeId): number {
  const u = UPGRADES[id];
  const lvl = s.levels[id];
  if (lvl >= u.max) return Infinity;
  return Math.round(u.cost(lvl) * chapterScale(s.chapter));
}

export function canBuy(s: State, id: UpgradeId): boolean {
  const c = upgradeCost(s, id);
  return Number.isFinite(c) && s.money >= c;
}

export function buy(s: State, id: UpgradeId): boolean {
  if (!canBuy(s, id)) return false;
  s.money -= upgradeCost(s, id);
  s.levels[id] += 1;
  return true;
}

/** Litres per second of one nozzle. A real forecourt pump gives ~0.6-0.7 L/s; upgrades go well past that. */
export function flowRate(s: State): number {
  return 2.0 * Math.pow(1.13, s.levels.flow - 1);
}

/** Money per litre. */
export function fuelPrice(s: State): number {
  return 0.35 * (1 + 0.12 * (s.levels.price - 1)) * chapterScale(s.chapter);
}

/** Chance that a passing car pulls in (when a pump is free). */
export function pullInChance(s: State): number {
  return Math.min(0.85, 0.35 + 0.04 * (s.levels.sign - 1));
}

/** Seconds of door / card / nozzle handling on top of the pumping itself. */
export function handlingTime(s: State): number {
  return 6 / (1 + 0.45 * s.levels.attendant);
}

export function shopSpend(s: State, rnd: number): number {
  if (s.levels.shop === 0) return 0;
  const chance = Math.min(0.75, 0.35 + 0.04 * s.levels.shop);
  if (rnd > chance) return 0;
  return 2.5 * (1 + 0.35 * (s.levels.shop - 1)) * chapterScale(s.chapter);
}

export function boostMultiplier(s: State, now: number): number {
  return now < s.boostUntil ? 2 : 1;
}

/** Seconds a car spends at the pump for `litres`. */
export function serviceTime(s: State, litres: number): number {
  return litres / flowRate(s) + handlingTime(s);
}

/**
 * Pay for one car. Without a cashier the money waits at the till until the player collects it.
 * Returns the amount for the floating label.
 */
export function payForCar(s: State, litres: number, rnd: number, now: number): number {
  const amount = (litres * fuelPrice(s) + shopSpend(s, rnd)) * boostMultiplier(s, now);
  s.cars += 1;
  if (s.levels.cashier > 0) credit(s, amount);
  else s.till += amount;
  return amount;
}

export function credit(s: State, amount: number) {
  s.money += amount;
  s.earned += amount;
  s.lifetime += amount;
}

export function collectTill(s: State): number {
  const t = s.till;
  if (t <= 0) return 0;
  s.till = 0;
  credit(s, t);
  return t;
}

/** Exponential moving average of income per second (window ≈ 2 minutes). */
export function trackRate(s: State, earnedThisTick: number, dt: number) {
  const a = Math.min(1, dt / 120);
  s.rate = s.rate * (1 - a) + (earnedThisTick / Math.max(dt, 1e-6)) * a;
}

export const OFFLINE_CAP_S = 2 * 3600;

/** Offline earnings: only a hired cashier keeps the till running; half speed, capped at 2 hours. */
export function offlineEarnings(s: State, now: number): { seconds: number; amount: number } {
  const seconds = Math.max(0, Math.min(OFFLINE_CAP_S, (now - s.savedAt) / 1000));
  if (s.levels.cashier === 0 || seconds < 60) return { seconds, amount: 0 };
  return { seconds, amount: Math.floor(s.rate * seconds * 0.5) };
}

export const GIFT_COOLDOWN_MS = 4 * 60 * 1000;

/** A free gift worth ~90 s of income (min 50 × chapter scale). */
export function giftAmount(s: State): number {
  return Math.round(Math.max(50 * chapterScale(s.chapter), s.rate * 90));
}

const DAILY_BASE = [100, 160, 260, 420, 650, 950, 2500];

export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which day of the 7-day streak is up next, or null if today's gift was already taken. */
export function dailyNext(s: State, now: number): number | null {
  const today = dayKey(now);
  if (s.dailyDate === today) return null;
  const yesterday = dayKey(now - 24 * 3600 * 1000);
  return s.dailyDate === yesterday && s.dailyDay >= 0 ? (s.dailyDay + 1) % 7 : 0;
}

export function dailyAmount(s: State, day: number): number {
  return Math.round(Math.max(DAILY_BASE[day] * chapterScale(s.chapter), s.rate * 120 * (1 + day * 0.4)));
}

/** Claim today's gift; `doubled` after watching an ad. Returns the amount (0 when not available). */
export function claimDaily(s: State, now: number, doubled: boolean): number {
  const day = dailyNext(s, now);
  if (day === null) return 0;
  const amount = dailyAmount(s, day) * (doubled ? 2 : 1);
  s.dailyDay = day;
  s.dailyDate = dayKey(now);
  credit(s, amount);
  return amount;
}

export type Goal = { id: number; text: string; done: (s: State) => boolean; reward: (s: State) => number };

export const GOALS: Goal[] = [
  { id: 1, text: "2-kolonkani o'rnating", done: (s) => s.levels.pumps >= 2, reward: (s) => 120 * chapterScale(s.chapter) },
  { id: 2, text: "Kassir yollang", done: (s) => s.levels.cashier >= 1, reward: (s) => 150 * chapterScale(s.chapter) },
  { id: 3, text: "Quyish tezligi 5-daraja", done: (s) => s.levels.flow >= 5, reward: (s) => 250 * chapterScale(s.chapter) },
  { id: 4, text: "Do'kon oching", done: (s) => s.levels.shop >= 1, reward: (s) => 400 * chapterScale(s.chapter) },
  { id: 5, text: "4 ta kolonka", done: (s) => s.levels.pumps >= 4, reward: (s) => 900 * chapterScale(s.chapter) },
  { id: 6, text: "Reklama taxtasi 6-daraja", done: (s) => s.levels.sign >= 6, reward: (s) => 1200 * chapterScale(s.chapter) },
  { id: 7, text: "Yoqilg'i narxi 10-daraja", done: (s) => s.levels.price >= 10, reward: (s) => 2000 * chapterScale(s.chapter) },
  { id: 8, text: "6 ta kolonka", done: (s) => s.levels.pumps >= 6, reward: (s) => 4000 * chapterScale(s.chapter) },
];

export function claimGoal(s: State, id: number): number {
  const g = GOALS.find((x) => x.id === id);
  if (!g || s.goalsClaimed.includes(id) || !g.done(s)) return 0;
  const r = g.reward(s);
  s.goalsClaimed.push(id);
  credit(s, r);
  return r;
}

export function chapterProgress(s: State): number {
  return s.goalsClaimed.length / GOALS.length;
}

export function chapterComplete(s: State): boolean {
  return s.goalsClaimed.length === GOALS.length;
}

/** Move to the next, busier road: upgrades reset, everything costs and pays 3× more. */
export function nextChapter(s: State, now = Date.now()): void {
  if (!chapterComplete(s)) return;
  const keep = { lifetime: s.lifetime, cars: s.cars, missed: s.missed, noAds: s.noAds, dailyDay: s.dailyDay, dailyDate: s.dailyDate, chapter: s.chapter + 1 };
  const fresh = newState(now);
  Object.assign(s, fresh, keep);
  s.money = 120 * chapterScale(s.chapter);
}

export function load(raw: string | null, now = Date.now()): State {
  const base = newState(now);
  if (!raw) return base;
  try {
    const d = JSON.parse(raw) as Partial<State>;
    if (d.version !== 1) return base;
    const s: State = { ...base, ...d, levels: { ...base.levels, ...(d.levels ?? {}) } };
    for (const k of Object.keys(UPGRADES) as UpgradeId[]) {
      const v = Number(s.levels[k]);
      s.levels[k] = Number.isFinite(v) ? Math.max(k === "pumps" || k === "flow" || k === "price" || k === "sign" ? 1 : 0, Math.min(UPGRADES[k].max, Math.floor(v))) : base.levels[k];
    }
    for (const k of ["money", "earned", "lifetime", "till", "rate", "savedAt", "boostUntil", "giftReadyAt", "cars", "missed"] as const) {
      if (!Number.isFinite(s[k]) || s[k] < 0) s[k] = base[k];
    }
    if (!Number.isInteger(s.chapter) || s.chapter < 1) s.chapter = 1;
    if (!Array.isArray(s.goalsClaimed)) s.goalsClaimed = [];
    s.noAds = s.noAds === true;
    if (!Number.isInteger(s.dailyDay) || s.dailyDay < -1 || s.dailyDay > 6) s.dailyDay = -1;
    if (typeof s.dailyDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.dailyDate)) s.dailyDate = "";
    return s;
  } catch {
    return base;
  }
}
