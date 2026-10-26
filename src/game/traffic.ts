import type RAPIER from "@dimforge/rapier3d-compat";
import { DT } from "../sim/physics";
import { Driver, type Leader } from "../sim/driver";
import type { Path } from "../sim/path";
import { SPECS, Vehicle, type VehicleSpec } from "../sim/vehicle";
import { EAST, GIVE_WAY, LANE, MERGE_X, ROAD_END, ROW_PATHS, SLOTS, WEST, type Slot } from "./layout";

export type CarState = "road" | "toPump" | "fueling" | "leaving" | "merging";

export type Car = {
  id: number;
  vehicle: Vehicle;
  driver: Driver;
  color: string;
  state: CarState;
  slot: Slot | null;
  litres: number;
  timer: number;
  serviceTotal: number;
  /** east cars decide at this x whether they pull in */
  decided: boolean;
  wantsFuel: boolean;
};

export type TrafficHooks = {
  pullInChance: () => number;
  pumps: () => number;
  serviceTime: (litres: number) => number;
  onPaid: (car: Car, slot: Slot) => void;
  onMissed: () => void;
  onSpawn: (car: Car) => void;
  onDespawn: (car: Car) => void;
};

const KINDS: [VehicleSpec["kind"], number][] = [
  ["hatch", 0.24],
  ["sedan", 0.34],
  ["suv", 0.18],
  ["pickup", 0.08],
  ["van", 0.1],
  ["truck", 0.06],
];

/** Real-world paint mix: lots of white, grey, black, silver; a few colours. */
const PAINT: [string, number][] = [
  ["#f2f2f0", 0.24],
  ["#1a1b1e", 0.17],
  ["#8a8d91", 0.14],
  ["#c4c7cb", 0.13],
  ["#1f3c6e", 0.08],
  ["#8e1b1b", 0.08],
  ["#2f4a3a", 0.04],
  ["#c9b38a", 0.04],
  ["#d0601e", 0.03],
  ["#e8c547", 0.05],
];

function pick<T>(table: [T, number][], r: number): T {
  let acc = 0;
  for (const [v, w] of table) {
    acc += w;
    if (r <= acc) return v;
  }
  return table[table.length - 1][0];
}

const DECIDE_X = -75;
const KMH = 1 / 3.6;

export class Traffic {
  cars: Car[] = [];
  /** car id parked at / heading to each slot */
  slotCar: (number | null)[] = SLOTS.map(() => null);
  private nextId = 1;
  private spawnEast = 1;
  private spawnWest = 3;
  private giveWayS: number[];
  /** mean seconds between cars, per direction */
  interval = 5.5;

  constructor(
    private world: RAPIER.World,
    private hooks: TrafficHooks,
    private rnd: () => number = Math.random,
  ) {
    this.giveWayS = ROW_PATHS.map((p) => p.project(GIVE_WAY).s);
  }

  private spawn(path: Path, east: boolean) {
    const kind = pick(KINDS, this.rnd());
    const spec = SPECS[kind];
    const start = path.pointAt(0);
    // keep a safe gap to the last car on this lane
    for (const c of this.cars) {
      const p = c.vehicle.position();
      if (Math.abs(p.x - start.x) < 30 && Math.abs(p.z - start.z) < 2.5) return;
    }
    const yaw = east ? 0 : Math.PI;
    const vehicle = new Vehicle(this.world, spec, { x: start.x, y: 0.05, z: start.z }, yaw);
    const cruise = (kind === "truck" ? 70 : 80 + this.rnd() * 20) * KMH;
    // start rolling at cruise speed so the highway looks alive at once
    vehicle.body.setLinvel({ x: east ? cruise * 0.9 : -cruise * 0.9, y: 0, z: 0 }, true);
    const driver = new Driver(vehicle, path, cruise);
    const car: Car = {
      id: this.nextId++,
      vehicle,
      driver,
      color: pick(PAINT, this.rnd()),
      state: "road",
      slot: null,
      litres: spec.tank * (0.4 + this.rnd() * 0.45),
      timer: 0,
      serviceTotal: 0,
      decided: !east,
      wantsFuel: east && this.rnd() < this.hooks.pullInChance(),
    };
    this.cars.push(car);
    this.hooks.onSpawn(car);
  }

  /** Front-most free slot whose row has nobody parked behind it. */
  freeSlot(): Slot | null {
    const n = Math.min(SLOTS.length, this.hooks.pumps());
    for (let i = 0; i < n; i++) {
      const slot = SLOTS[i];
      if (this.slotCar[i] !== null) continue;
      const blocked = SLOTS.some((o, j) => o.row === slot.row && o.x < slot.x && this.slotCar[j] !== null);
      if (!blocked) return slot;
    }
    return null;
  }

  private decide(car: Car) {
    car.decided = true;
    if (!car.wantsFuel) return;
    const slot = this.freeSlot();
    if (!slot) {
      this.hooks.onMissed();
      return;
    }
    this.slotCar[slot.index] = car.id;
    car.slot = slot;
    car.state = "toPump";
    const path = ROW_PATHS[slot.row];
    car.driver.setPath(path, 80 * KMH);
    car.driver.cruise = 80 * KMH;
    // park with the filler neck (rear third of the car) next to the dispenser
    car.driver.stopAt = path.project({ x: slot.x + car.vehicle.spec.length * 0.5 - 1.2, z: slot.z }).s;
  }

  private leader(car: Car): Leader {
    const me = car.vehicle.position();
    const yaw = car.vehicle.yaw();
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const path = car.driver.path;
    let best: Leader = null;
    for (const o of this.cars) {
      if (o === car) continue;
      const p = o.vehicle.position();
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 90) continue;
      const pr = path.project({ x: p.x, z: p.z }, car.driver.s + ahead, 14);
      if (pr.dist > 1.9) continue;
      const gap = pr.s - car.driver.s - car.vehicle.spec.length / 2 - o.vehicle.spec.length / 2;
      if (gap < -1) continue;
      const oyaw = o.vehicle.yaw();
      const speed = o.vehicle.speed() * Math.cos(oyaw - path.headingAt(pr.s));
      if (!best || gap < best.gap) best = { gap: Math.max(0.05, gap), speed };
    }
    return best;
  }

  /** Is the eastbound lane clear enough to join at the merge point? */
  private mergeClear(self: Car): boolean {
    for (const o of this.cars) {
      // one station car joins at a time
      if (o !== self && o.state === "merging") return false;
      if (o.state !== "road" && o.state !== "merging") continue;
      const p = o.vehicle.position();
      if (p.z > LANE + 2.2 || p.z < 0) continue;
      const v = Math.max(1, o.vehicle.speed());
      const dist = MERGE_X - p.x;
      if (dist < -8) continue;
      if (dist < 12 || dist / v < 5) return false;
    }
    return true;
  }

  step() {
    const t = DT;
    this.spawnEast -= t;
    this.spawnWest -= t;
    if (this.spawnEast <= 0) {
      this.spawn(EAST, true);
      this.spawnEast = -Math.log(1 - this.rnd() * 0.95) * this.interval + 1.2;
    }
    if (this.spawnWest <= 0) {
      this.spawn(WEST, false);
      this.spawnWest = -Math.log(1 - this.rnd() * 0.95) * this.interval * 1.15 + 1.2;
    }

    for (const car of this.cars) {
      const pos = car.vehicle.position();
      if (!car.decided && pos.x > DECIDE_X) this.decide(car);

      if (car.state === "toPump" && car.driver.stopDistance() < 0.5 && Math.abs(car.vehicle.speed()) < 0.08) {
        car.state = "fueling";
        car.serviceTotal = this.hooks.serviceTime(car.litres);
        car.timer = car.serviceTotal;
      } else if (car.state === "fueling") {
        car.timer -= t;
        if (car.timer <= 0) {
          car.state = "leaving";
          this.hooks.onPaid(car, car.slot!);
          car.driver.stopAt = this.giveWayS[car.slot!.row];
        }
      } else if (car.state === "leaving") {
        const slot = car.slot;
        if (slot && this.slotCar[slot.index] === car.id && pos.x > slot.x + car.vehicle.spec.length + 1) {
          this.slotCar[slot.index] = null;
          car.slot = null;
        }
        if (car.driver.stopDistance() < 6 && this.mergeClear(car)) {
          car.driver.stopAt = null;
          car.state = "merging";
        }
      } else if (car.state === "merging" && pos.x > MERGE_X + 15) {
        car.state = "road";
        if (car.slot) {
          this.slotCar[car.slot.index] = null;
          car.slot = null;
        }
      }
      car.driver.update(this.leader(car));
    }
    for (const car of this.cars) car.vehicle.step();
  }

  /** Remove cars that left the map (call after the physics step). */
  cleanup() {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const p = car.vehicle.position();
      const gone = Math.abs(p.x) > ROAD_END - 4 && car.driver.s > car.driver.path.length - 8;
      const lost = p.y < -5 || Math.abs(p.z) > 80;
      if (gone || lost) {
        if (car.slot && this.slotCar[car.slot.index] === car.id) this.slotCar[car.slot.index] = null;
        this.hooks.onDespawn(car);
        car.vehicle.dispose();
        this.cars.splice(i, 1);
      }
    }
  }
}
