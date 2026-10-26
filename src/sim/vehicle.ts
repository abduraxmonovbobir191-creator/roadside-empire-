import { DT, GRAVITY, GROUP_CAR, GROUP_GROUND, GROUP_PROP, RAPIER, groups } from "./physics";

/** Real-world numbers for each body style. Units: SI (kg, m, N·m, rpm). */
export type VehicleSpec = {
  kind: "hatch" | "sedan" | "suv" | "pickup" | "van" | "truck";
  mass: number;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  /** centre of mass above the ground */
  cgHeight: number;
  maxTorque: number;
  peakTorqueRpm: number;
  redline: number;
  gears: number[];
  finalDrive: number;
  drive: "FWD" | "RWD" | "AWD";
  cd: number;
  frontalArea: number;
  /** usable fuel tank, litres */
  tank: number;
  /** tyre-road friction coefficient (dry asphalt ≈ 1.0) */
  mu: number;
  /** suspension natural frequency, Hz */
  rideHz: number;
  maxSteer: number;
};

export const SPECS: Record<VehicleSpec["kind"], VehicleSpec> = {
  hatch: {
    kind: "hatch", mass: 1150, length: 4.05, width: 1.75, height: 1.48, wheelbase: 2.55, track: 1.5, wheelRadius: 0.3,
    cgHeight: 0.52, maxTorque: 160, peakTorqueRpm: 3800, redline: 6300, gears: [3.6, 2.05, 1.38, 1.03, 0.82], finalDrive: 4.06,
    drive: "FWD", cd: 0.31, frontalArea: 2.1, tank: 45, mu: 1.0, rideHz: 1.5, maxSteer: 0.62,
  },
  sedan: {
    kind: "sedan", mass: 1450, length: 4.7, width: 1.83, height: 1.45, wheelbase: 2.8, track: 1.58, wheelRadius: 0.33,
    cgHeight: 0.55, maxTorque: 250, peakTorqueRpm: 4000, redline: 6500, gears: [3.3, 1.96, 1.33, 1.0, 0.8, 0.67], finalDrive: 3.7,
    drive: "FWD", cd: 0.28, frontalArea: 2.25, tank: 60, mu: 1.0, rideHz: 1.4, maxSteer: 0.6,
  },
  suv: {
    kind: "suv", mass: 1950, length: 4.8, width: 1.93, height: 1.75, wheelbase: 2.85, track: 1.65, wheelRadius: 0.37,
    cgHeight: 0.7, maxTorque: 370, peakTorqueRpm: 3500, redline: 6000, gears: [3.5, 2.1, 1.4, 1.0, 0.78, 0.65], finalDrive: 3.9,
    drive: "AWD", cd: 0.36, frontalArea: 2.8, tank: 70, mu: 0.95, rideHz: 1.25, maxSteer: 0.6,
  },
  pickup: {
    kind: "pickup", mass: 2100, length: 5.3, width: 1.9, height: 1.8, wheelbase: 3.1, track: 1.62, wheelRadius: 0.38,
    cgHeight: 0.75, maxTorque: 450, peakTorqueRpm: 2500, redline: 4500, gears: [4.7, 2.9, 1.8, 1.4, 1.0, 0.8], finalDrive: 3.55,
    drive: "RWD", cd: 0.42, frontalArea: 3.0, tank: 80, mu: 0.95, rideHz: 1.3, maxSteer: 0.58,
  },
  van: {
    kind: "van", mass: 2300, length: 5.1, width: 1.95, height: 2.05, wheelbase: 3.2, track: 1.68, wheelRadius: 0.36,
    cgHeight: 0.85, maxTorque: 350, peakTorqueRpm: 2200, redline: 4500, gears: [4.4, 2.6, 1.6, 1.15, 0.87, 0.7], finalDrive: 3.9,
    drive: "FWD", cd: 0.37, frontalArea: 3.6, tank: 75, mu: 0.95, rideHz: 1.35, maxSteer: 0.58,
  },
  truck: {
    kind: "truck", mass: 7500, length: 7.6, width: 2.4, height: 3.2, wheelbase: 4.3, track: 1.9, wheelRadius: 0.48,
    cgHeight: 1.15, maxTorque: 1100, peakTorqueRpm: 1400, redline: 2600, gears: [6.4, 4.0, 2.6, 1.7, 1.25, 1.0, 0.8], finalDrive: 4.1,
    drive: "RWD", cd: 0.6, frontalArea: 6.5, tank: 200, mu: 0.85, rideHz: 1.6, maxSteer: 0.6,
  },
};

const AIR_DENSITY = 1.225;
const ROLLING_RESISTANCE = 0.012;
const DRIVETRAIN_EFFICIENCY = 0.88;
const IDLE_RPM = 850;
const STEER_RATE = 1.6; // rad/s at the road wheels
const SUSPENSION_REST = 0.3;

type Vec3 = { x: number; y: number; z: number };

/**
 * A car driven by a ray-cast suspension (Rapier) with a real drivetrain:
 * torque curve, automatic gearbox, final drive, aero drag, rolling resistance,
 * friction-limited brakes and Ackermann steering. Local axes: +X forward, +Y up, +Z right.
 */
export class Vehicle {
  readonly spec: VehicleSpec;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  private world: RAPIER.World;

  throttle = 0;
  brake = 0;
  /** desired bicycle-model steering angle, rad (+ = left) */
  steerTarget = 0;
  steer = 0;
  gear = 1;
  rpm = IDLE_RPM;
  private shiftTimer = 0;

  constructor(world: RAPIER.World, spec: VehicleSpec, pos: Vec3, yaw: number) {
    this.world = world;
    this.spec = spec;
    const m = spec.mass;
    const L = spec.length;
    const W = spec.width;
    const H = spec.height;
    const r = spec.wheelRadius;
    // Body origin sits at axle height when the car rests on its springs.
    const staticSag = GRAVITY / (2 * Math.PI * spec.rideHz) ** 2;
    const comY = spec.cgHeight - r;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + r, pos.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setAdditionalMassProperties(
          m,
          { x: 0, y: comY, z: 0 },
          {
            // solid-box approximation, roll (x), yaw (y), pitch (z)
            x: (m / 12) * (W * W + H * H) * 0.8,
            y: (m / 12) * (L * L + W * W) * 0.8,
            z: (m / 12) * (L * L + H * H) * 0.8,
          },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setAngularDamping(0.15)
        .setCanSleep(false),
    );
    const clearance = spec.kind === "truck" ? 0.3 : spec.kind === "suv" || spec.kind === "pickup" ? 0.21 : 0.15;
    const bottom = -r + clearance;
    const lowerH = Math.min(0.75, H * 0.48);
    const carGroups = groups(GROUP_CAR, GROUP_GROUND | GROUP_CAR | GROUP_PROP);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(L / 2, lowerH / 2, W / 2)
        .setTranslation(0, bottom + lowerH / 2, 0)
        .setDensity(0)
        .setFriction(0.4)
        .setCollisionGroups(carGroups),
      this.body,
    );
    const cabinH = H - clearance - lowerH;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(L * 0.3, cabinH / 2, W * 0.44)
        .setTranslation(spec.kind === "pickup" || spec.kind === "truck" ? L * 0.15 : -L * 0.03, bottom + lowerH + cabinH / 2, 0)
        .setDensity(0)
        .setFriction(0.4)
        .setCollisionGroups(carGroups),
      this.body,
    );

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 0;
    const k = (2 * Math.PI * spec.rideHz) ** 2 / 4; // Rapier multiplies by chassis mass
    const c = 2 * Math.sqrt(k);
    const connY = SUSPENSION_REST - staticSag;
    const frontX = spec.wheelbase * 0.5;
    const rearX = -spec.wheelbase * 0.5;
    const half = spec.track / 2;
    for (const [x, z] of [
      [frontX, -half],
      [frontX, half],
      [rearX, -half],
      [rearX, half],
    ]) {
      this.controller.addWheel({ x, y: connY, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, SUSPENSION_REST, r);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, k);
      this.controller.setWheelSuspensionCompression(i, c * 0.3);
      this.controller.setWheelSuspensionRelaxation(i, c * 0.5);
      this.controller.setWheelMaxSuspensionTravel(i, 0.2);
      this.controller.setWheelMaxSuspensionForce(i, m * GRAVITY * 1.5);
      this.controller.setWheelFrictionSlip(i, spec.mu);
      this.controller.setWheelSideFrictionStiffness(i, 1);
    }
  }

  /** Signed speed along the car's nose, m/s. */
  speed(): number {
    const v = this.body.linvel();
    const f = this.forward();
    return v.x * f.x + v.y * f.y + v.z * f.z;
  }

  forward(): Vec3 {
    const q = this.body.rotation();
    return { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) };
  }

  position(): Vec3 {
    return this.body.translation();
  }

  /** Heading on the ground plane: angle of the nose from +X toward -Z (counter-clockwise seen from above). */
  yaw(): number {
    const f = this.forward();
    return Math.atan2(-f.z, f.x);
  }

  private torqueAt(rpm: number): number {
    const s = this.spec;
    const x = (rpm - s.peakTorqueRpm) / (s.redline - IDLE_RPM);
    return s.maxTorque * Math.max(0.45, 1 - 1.6 * x * x);
  }

  private wheelForce(v: number): number {
    const s = this.spec;
    const ratio = s.gears[this.gear - 1] * s.finalDrive;
    const wheelRpm = (Math.abs(v) / s.wheelRadius) * (60 / (2 * Math.PI));
    const engineRpm = wheelRpm * ratio;
    // Below idle the clutch / torque converter slips, so the engine stays near its launch rpm.
    this.rpm = Math.max(IDLE_RPM + this.throttle * 1400, engineRpm);
    if (this.rpm > s.redline) this.rpm = s.redline;
    if (this.throttle > 0) {
      const t = this.rpm >= s.redline ? 0 : this.torqueAt(this.rpm) * this.throttle;
      return (t * ratio * DRIVETRAIN_EFFICIENCY) / s.wheelRadius;
    }
    // engine braking: roughly 12 % of peak torque against the wheels
    return v > 1 ? (-s.maxTorque * 0.12 * ratio) / s.wheelRadius : 0;
  }

  private shift(v: number) {
    const s = this.spec;
    this.shiftTimer = Math.max(0, this.shiftTimer - DT);
    if (this.shiftTimer > 0) return;
    const rpmIn = (g: number) => (Math.abs(v) / s.wheelRadius) * (60 / (2 * Math.PI)) * s.gears[g - 1] * s.finalDrive;
    const up = s.redline * (0.55 + 0.35 * this.throttle);
    if (this.gear < s.gears.length && rpmIn(this.gear) > up) {
      this.gear++;
      this.shiftTimer = 0.35;
    } else if (this.gear > 1 && rpmIn(this.gear - 1) < s.redline * (0.45 + 0.3 * this.throttle) - 300) {
      this.gear--;
      this.shiftTimer = 0.35;
    }
  }

  step() {
    const s = this.spec;
    const v = this.speed();
    this.shift(v);

    // steering: rate-limited, then split per wheel with Ackermann geometry
    const target = Math.max(-s.maxSteer, Math.min(s.maxSteer, this.steerTarget));
    const dmax = STEER_RATE * DT;
    this.steer += Math.max(-dmax, Math.min(dmax, target - this.steer));
    let left = this.steer;
    let right = this.steer;
    if (Math.abs(this.steer) > 1e-4) {
      const R = s.wheelbase / Math.tan(Math.abs(this.steer));
      const inner = Math.atan(s.wheelbase / (R - s.track / 2));
      const outer = Math.atan(s.wheelbase / (R + s.track / 2));
      const sign = Math.sign(this.steer);
      // turning left: the left wheel (index 0, -Z side) is the inner one
      left = sign * (sign > 0 ? inner : outer);
      right = sign * (sign > 0 ? outer : inner);
    }
    this.controller.setWheelSteering(0, left);
    this.controller.setWheelSteering(1, right);

    // drive
    const force = this.wheelForce(v);
    const driven = s.drive === "FWD" ? [0, 1] : s.drive === "RWD" ? [2, 3] : [0, 1, 2, 3];
    // Rapier ignores a wheel's brake while it has an engine force, so engine braking goes through the brake impulse.
    const pushing = force > 0 && this.brake === 0;
    for (let i = 0; i < 4; i++) this.controller.setWheelEngineForce(i, pushing && driven.includes(i) ? force / driven.length : 0);

    // brakes: 65 % front bias. Rapier takes a per-step impulse cap; tyre grip limits it further.
    const brakeForce = this.brake * s.mass * GRAVITY * s.mu * 0.95;
    const engineBrake = pushing ? 0 : -Math.min(0, force);
    for (let i = 0; i < 4; i++) {
      const share = i < 2 ? 0.325 : 0.175;
      const eb = driven.includes(i) ? engineBrake / driven.length : 0;
      this.controller.setWheelBrake(i, (brakeForce * share + eb) * DT);
    }

    // aero drag + rolling resistance at the centre of mass
    this.body.resetForces(true);
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed > 0.05) {
      const drag = 0.5 * AIR_DENSITY * s.cd * s.frontalArea * speed * speed;
      const roll = ROLLING_RESISTANCE * s.mass * GRAVITY * Math.tanh(speed / 0.5);
      const f = (drag + roll) / speed;
      this.body.addForce({ x: -lv.x * f, y: 0, z: -lv.z * f }, true);
    }

    this.controller.updateVehicle(DT, undefined, groups(GROUP_CAR, GROUP_GROUND));
  }

  /** Wheel centre in the chassis frame + its spin and steer, for the renderer. */
  wheel(i: number) {
    const c = this.controller.wheelChassisConnectionPointCs(i)!;
    const len = this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST;
    return {
      x: c.x,
      y: c.y - len,
      z: c.z,
      spin: this.controller.wheelRotation(i) ?? 0,
      steer: this.controller.wheelSteering(i) ?? 0,
    };
  }

  dispose() {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
