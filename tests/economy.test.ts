import { describe, expect, test } from "vitest";
import * as eco from "../src/game/economy";

describe("economy", () => {
  test("buying spends money and raises the level", () => {
    const s = eco.newState(0);
    s.money = 1000;
    const cost = eco.upgradeCost(s, "pumps");
    expect(eco.buy(s, "pumps")).toBe(true);
    expect(s.levels.pumps).toBe(2);
    expect(s.money).toBe(1000 - cost);
  });

  test("cannot buy without money or past max", () => {
    const s = eco.newState(0);
    s.money = 0;
    expect(eco.buy(s, "flow")).toBe(false);
    s.money = 1e9;
    s.levels.cashier = 1;
    expect(eco.buy(s, "cashier")).toBe(false);
    expect(eco.upgradeCost(s, "cashier")).toBe(Infinity);
  });

  test("without a cashier money waits at the till", () => {
    const s = eco.newState(0);
    const paid = eco.payForCar(s, 40, 1, 0);
    expect(s.till).toBeCloseTo(paid);
    expect(s.money).toBe(120);
    expect(eco.collectTill(s)).toBeCloseTo(paid);
    expect(s.money).toBeCloseTo(120 + paid);
    expect(s.till).toBe(0);
  });

  test("boost doubles pay while active", () => {
    const s = eco.newState(0);
    s.levels.cashier = 1;
    const a = eco.payForCar(s, 40, 1, 0);
    s.boostUntil = 10_000;
    const b = eco.payForCar(s, 40, 1, 5_000);
    expect(b).toBeCloseTo(a * 2);
  });

  test("offline earnings need a cashier, are capped and paid at half rate", () => {
    const s = eco.newState(0);
    s.rate = 10;
    expect(eco.offlineEarnings(s, 3600_000).amount).toBe(0);
    s.levels.cashier = 1;
    expect(eco.offlineEarnings(s, 600_000).amount).toBe(3000);
    expect(eco.offlineEarnings(s, 10 * 3600_000).seconds).toBe(eco.OFFLINE_CAP_S);
  });

  test("goals pay once and complete the chapter", () => {
    const s = eco.newState(0);
    expect(eco.claimGoal(s, 1)).toBe(0);
    s.levels.pumps = 6;
    s.levels.cashier = 1;
    s.levels.flow = 10;
    s.levels.shop = 1;
    s.levels.sign = 6;
    s.levels.price = 10;
    for (const g of eco.GOALS) expect(eco.claimGoal(s, g.id)).toBeGreaterThan(0);
    expect(eco.claimGoal(s, 1)).toBe(0);
    expect(eco.chapterComplete(s)).toBe(true);
    const life = s.lifetime;
    eco.nextChapter(s, 0);
    expect(s.chapter).toBe(2);
    expect(s.levels.pumps).toBe(1);
    expect(s.lifetime).toBe(life);
    expect(eco.upgradeCost(s, "flow")).toBe(3 * eco.UPGRADES.flow.cost(1));
  });

  test("load repairs bad or hostile saves", () => {
    expect(eco.load("not json").money).toBe(120);
    const s = eco.load(JSON.stringify({ version: 1, money: -5, levels: { pumps: 99, flow: "x" }, chapter: 0, goalsClaimed: "no" }));
    expect(s.money).toBe(120);
    expect(s.levels.pumps).toBe(eco.MAX_PUMPS);
    expect(s.levels.flow).toBe(1);
    expect(s.chapter).toBe(1);
    expect(s.goalsClaimed).toEqual([]);
  });
});

describe("daily reward", () => {
  const day = (n: number) => new Date(2026, 0, 1 + n, 12).getTime();

  test("first claim is day 1, a second claim on the same day is refused", () => {
    const s = eco.newState(0);
    expect(eco.dailyNext(s, day(0))).toBe(0);
    expect(eco.claimDaily(s, day(0), false)).toBeGreaterThan(0);
    expect(eco.dailyNext(s, day(0))).toBeNull();
    expect(eco.claimDaily(s, day(0), false)).toBe(0);
  });

  test("streak grows on consecutive days, wraps after 7, resets after a gap", () => {
    const s = eco.newState(0);
    for (let i = 0; i < 7; i++) {
      expect(eco.dailyNext(s, day(i))).toBe(i);
      eco.claimDaily(s, day(i), false);
    }
    expect(eco.dailyNext(s, day(7))).toBe(0);
    eco.claimDaily(s, day(7), false);
    expect(eco.dailyNext(s, day(9))).toBe(0);
  });

  test("an ad doubles the gift", () => {
    const a = eco.newState(0);
    const b = eco.newState(0);
    expect(eco.claimDaily(b, day(0), true)).toBe(eco.claimDaily(a, day(0), false) * 2);
  });
});
