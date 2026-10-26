import { DT, GRAVITY } from "./physics";
import type { Path } from "./path";
import type { Vehicle } from "./vehicle";

/** Comfort limits of a calm driver. */
const LAT_ACCEL = 2.6; // m/s², cornering
const COMFORT_DECEL = 2.2; // m/s², IDM b
const MAX_ACCEL = 1.6; // m/s², IDM a
const HEADWAY = 1.3; // s
const JAM_GAP = 2.2; // m, bumper to bumper when stopped
const STOP_GAP = 0.15; // m, how close the front bumper parks to a stop mark

export type Leader = { gap: number; speed: number } | null;

/**
 * Drives a Vehicle along a Path like a person would:
 * pure-pursuit steering from the rear axle, Intelligent Driver Model for following and stopping,
 * curve speed from the path's curvature, and an accel controller that turns the wanted
 * acceleration into throttle / brake through the car's own drivetrain numbers.
 */
export class Driver {
  path: Path;
  s = 0;
  lateral = 0;
  /** cruise speed for this path, m/s */
  cruise: number;
  /** arc length where the front bumper must stop (pump, give-way line), or null */
  stopAt: number | null = null;
  private lastV = 0;
  private accelFiltered = 0;
  private integ = 0;
  wantedAccel = 0;

  constructor(
    readonly car: Vehicle,
    path: Path,
    cruise: number,
  ) {
    this.path = path;
    this.cruise = cruise;
    this.s = path.project(car.position()).s;
  }

  setPath(path: Path, cruise = this.cruise) {
    this.path = path;
    this.cruise = cruise;
    this.s = path.project(this.car.position()).s;
    this.stopAt = null;
  }

  /** arc length of the front bumper */
  frontS(): number {
    return this.s + this.car.spec.length / 2;
  }

  /** distance left until the front bumper reaches the stop mark (Infinity when none) */
  stopDistance(): number {
    return this.stopAt === null ? Infinity : this.stopAt - this.frontS() - STOP_GAP;
  }

  private curveSpeed(v: number): number {
    // the slowest speed needed by any bend we could still brake for
    const horizon = Math.max(25, (v * v) / (2 * COMFORT_DECEL) + 15);
    let limit = this.cruise;
    for (let d = 0; d <= horizon; d += 2) {
      const k = Math.abs(this.path.curvatureAt(this.s + d));
      if (k < 1e-4) continue;
      const vc = Math.sqrt(LAT_ACCEL / k);
      const reach = Math.sqrt(vc * vc + 2 * COMFORT_DECEL * Math.max(0, d - this.car.spec.length / 2));
      if (reach < limit) limit = reach;
    }
    return Math.max(2.5, limit);
  }

  private idm(v: number, v0: number, gap: number, dv: number): number {
    const sStar = JAM_GAP + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(MAX_ACCEL * COMFORT_DECEL)));
    const free = 1 - Math.pow(Math.max(0, v) / Math.max(0.1, v0), 4);
    return MAX_ACCEL * (free - (sStar / Math.max(0.1, gap)) ** 2);
  }

  update(leader: Leader) {
    const car = this.car;
    const spec = car.spec;
    const pos = car.position();
    const proj = this.path.project({ x: pos.x, z: pos.z }, this.s);
    this.s = proj.s;
    this.lateral = proj.lateral;
    const v = car.speed();

    // ---- steering: pure pursuit around the rear axle
    const yaw = car.yaw();
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const rx = pos.x - fx * spec.wheelbase * 0.5;
    const rz = pos.z - fz * spec.wheelbase * 0.5;
    const look = Math.max(4.5, Math.min(20, 2.5 + 0.55 * Math.abs(v)));
    const target = this.path.pointAt(this.s + look - spec.wheelbase * 0.5);
    const tx = target.x - rx;
    const tz = target.z - rz;
    const ld = Math.hypot(tx, tz) || 1;
    // angle to the target, + = left (toward -Z of the car's heading)
    const alpha = Math.atan2(-(tz * fx - tx * fz), tx * fx + tz * fz);
    car.steerTarget = Math.atan((2 * spec.wheelbase * Math.sin(alpha)) / ld);

    // ---- longitudinal: IDM against the leader, the stop mark and the curves
    const v0 = Math.min(this.cruise, this.curveSpeed(v));
    let a = this.idm(v, v0, Infinity, 0);
    if (leader) a = Math.min(a, this.idm(v, v0, leader.gap, v - leader.speed));
    const toStop = this.stopDistance();
    if (toStop < 200) {
      // a stop mark acts like a parked car with no jam gap: brake to exactly reach it
      const need = toStop <= 0.05 ? -COMFORT_DECEL * 2 : -(v * v) / (2 * toStop);
      const idmStop = this.idm(v, v0, toStop + JAM_GAP, v);
      a = Math.min(a, v > 0.3 && need < -0.4 * COMFORT_DECEL ? Math.min(need * 1.05, idmStop) : idmStop);
    }
    this.wantedAccel = Math.max(-GRAVITY * 0.8, Math.min(MAX_ACCEL * 1.5, a));
    this.actuate(this.wantedAccel, v);
  }

  /** Feed-forward through the drivetrain + a small PI on the measured acceleration. */
  private actuate(aWanted: number, v: number) {
    const car = this.car;
    const s = car.spec;
    const measured = (v - this.lastV) / DT;
    this.lastV = v;
    this.accelFiltered += (measured - this.accelFiltered) * 0.15;

    if (Math.abs(v) < 0.25 && aWanted <= 0.05) {
      // standing: hold the foot brake, no creeping
      car.throttle = 0;
      car.brake = 0.35;
      this.integ = 0;
      return;
    }
    this.integ = Math.max(-1, Math.min(1, this.integ + (aWanted - this.accelFiltered) * DT * 0.6));
    const resist = (0.5 * 1.225 * s.cd * s.frontalArea * v * v + 0.012 * s.mass * GRAVITY) / s.mass;
    const need = aWanted + resist; // what the tyres must deliver, m/s²
    if (need > 0) {
      const ratio = s.gears[car.gear - 1] * s.finalDrive;
      const maxForce = (s.maxTorque * 0.95 * ratio * 0.88) / s.wheelRadius;
      car.throttle = Math.max(0, Math.min(1, (need * s.mass) / maxForce + this.integ));
      car.brake = 0;
    } else {
      car.throttle = 0;
      // coasting already gives ~resist of deceleration
      const b = (-aWanted - resist * 0.6) / (GRAVITY * s.mu * 0.95) - this.integ * 0.5;
      car.brake = Math.max(0, Math.min(1, b));
    }
  }
}
