import RAPIER from "@dimforge/rapier3d-compat";

export { RAPIER };

/** Fixed physics step: 60 Hz, same on every device so the cars behave the same everywhere. */
export const DT = 1 / 60;
export const GRAVITY = 9.81;

let ready: Promise<void> | null = null;

export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Collision groups: cars hit cars, the ground and props; wheel rays only see the ground. */
export const GROUP_GROUND = 0x0001;
export const GROUP_CAR = 0x0002;
export const GROUP_PROP = 0x0004;

export function groups(member: number, filter: number): number {
  return (member << 16) | filter;
}

export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  // A big flat slab: the asphalt and the grass are both on y = 0.
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000)
      .setTranslation(0, -0.5, 0)
      .setFriction(1)
      .setCollisionGroups(groups(GROUP_GROUND, GROUP_CAR | GROUP_PROP)),
    ground,
  );
  return world;
}

/** A static box obstacle (building wall, pump island kerb). */
export function addStaticBox(world: RAPIER.World, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.6).setCollisionGroups(groups(GROUP_PROP, GROUP_CAR)),
    body,
  );
  return body;
}
