import { beforeAll, describe, expect, test } from "vitest";
import { initPhysics, createWorld } from "../src/sim/physics";
import { Traffic, type Car } from "../src/game/traffic";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

beforeAll(async () => {
  await initPhysics();
});

describe("traffic through the station", () => {
  for (const pumps of [1, 6]) {
    test(`${pumps} pump(s): cars refuel, pay and leave without crashing or jamming`, () => {
      const world = createWorld();
      let paid = 0, missed = 0, despawned = 0, spawned = 0;
      const still = new Map<number, number>();
      const traffic = new Traffic(world, {
        pullInChance: () => 0.6,
        pumps: () => pumps,
        serviceTime: (l) => l / 3 + 4,
        onPaid: () => { paid++; },
        onMissed: () => { missed++; },
        onSpawn: () => { spawned++; },
        onDespawn: () => { despawned++; },
      }, rng(pumps * 7 + 1));
      let maxStill = 0, worstTilt = 0;
      const steps = 60 * 60 * 6; // 6 simulated minutes
      for (let i = 0; i < steps; i++) {
        traffic.step();
        world.step();
        traffic.cleanup();
        for (const c of traffic.cars as Car[]) {
          const v = Math.abs(c.vehicle.speed());
          const q = c.vehicle.body.rotation();
          const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
          worstTilt = Math.max(worstTilt, Math.acos(Math.min(1, upY)));
          if (v < 0.2 && c.state !== "fueling") {
            const n = (still.get(c.id) ?? 0) + 1;
            still.set(c.id, n);
            maxStill = Math.max(maxStill, n);
          } else still.set(c.id, 0);
        }
      }
      console.log(`pumps=${pumps} spawned=${spawned} paid=${paid} missed=${missed} despawned=${despawned} alive=${traffic.cars.length} maxStill=${(maxStill / 60).toFixed(1)}s tilt=${(worstTilt * 57.3).toFixed(1)}deg`);
      expect(paid).toBeGreaterThan(pumps === 1 ? 6 : 15);
      expect(maxStill / 60).toBeLessThan(90);
      expect(worstTilt * 57.3).toBeLessThan(12);
    }, 120000);
  }
});
