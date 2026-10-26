import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { VehicleSpec } from "../sim/vehicle";

/**
 * Procedural cars at real dimensions: side profile with wheel arches, narrower glasshouse,
 * clear-coated paint, glass, lamps, bumpers and turning wheels.
 * Mesh origin = physics body origin (centre of the car at axle height).
 */

type Shape = {
  deck: number;
  belt: number;
  hood: number;
  /** x as a fraction of length from the rear bumper */
  rearGlass: number;
  roofRear: number;
  roofFront: number;
  windshield: number;
};

const SHAPES: Record<VehicleSpec["kind"], Shape> = {
  hatch: { deck: 0.98, belt: 0.95, hood: 0.9, rearGlass: 0.03, roofRear: 0.11, roofFront: 0.56, windshield: 0.73 },
  sedan: { deck: 1.0, belt: 0.96, hood: 0.88, rearGlass: 0.18, roofRear: 0.32, roofFront: 0.6, windshield: 0.75 },
  suv: { deck: 1.12, belt: 1.12, hood: 1.08, rearGlass: 0.03, roofRear: 0.07, roofFront: 0.63, windshield: 0.77 },
  pickup: { deck: 1.18, belt: 1.18, hood: 1.16, rearGlass: 0.43, roofRear: 0.45, roofFront: 0.66, windshield: 0.77 },
  van: { deck: 1.05, belt: 1.08, hood: 1.02, rearGlass: 0.01, roofRear: 0.02, roofFront: 0.8, windshield: 0.89 },
  truck: { deck: 1.5, belt: 1.65, hood: 1.5, rearGlass: 0.72, roofRear: 0.73, roofFront: 0.93, windshield: 0.985 },
};

type Parts = {
  lower: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  cargo: THREE.BufferGeometry | null;
};

const cache = new Map<string, Parts>();

function extrude(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function build(spec: VehicleSpec): Parts {
  const sh = SHAPES[spec.kind];
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const r = spec.wheelRadius;
  const clear = spec.kind === "truck" ? 0.32 : spec.kind === "suv" || spec.kind === "pickup" ? 0.24 : 0.17;
  const xr = -L / 2;
  const xf = L / 2;
  const X = (f: number) => xr + f * L;
  const wf = spec.wheelbase / 2;
  const wr = -spec.wheelbase / 2;
  const arch = r + 0.05;
  // y is measured from the ground; the mesh is shifted down by r at the end
  const lower = new THREE.Shape();
  lower.moveTo(xr + 0.06, clear + 0.08);
  lower.lineTo(xr, clear + 0.2);
  lower.lineTo(xr + 0.02, sh.deck - 0.08);
  lower.quadraticCurveTo(xr + 0.04, sh.deck, xr + 0.18, sh.deck);
  if (spec.kind === "truck") {
    lower.lineTo(X(sh.rearGlass) - 0.1, sh.deck);
  } else {
    lower.lineTo(X(sh.rearGlass), sh.belt);
  }
  lower.lineTo(X(sh.windshield), sh.belt);
  lower.quadraticCurveTo(X(sh.windshield) + 0.2, sh.hood + 0.02, xf - 0.3, sh.hood);
  lower.quadraticCurveTo(xf - 0.02, sh.hood - 0.03, xf, sh.hood - 0.22);
  lower.lineTo(xf - 0.02, clear + 0.18);
  lower.lineTo(xf - 0.1, clear + 0.05);
  // underside with real wheel arches
  lower.lineTo(wf + arch + 0.02, clear + 0.05);
  lower.absarc(wf, r, arch, 0, Math.PI, false);
  lower.lineTo(wr + arch + 0.02, clear + 0.05);
  lower.absarc(wr, r, arch, 0, Math.PI, false);
  lower.lineTo(xr + 0.06, clear + 0.08);

  const cabinW = spec.kind === "truck" ? W * 0.98 : W * 0.86;
  const cabin = new THREE.Shape();
  const rr = X(sh.rearGlass);
  const rf = X(sh.windshield);
  const tr = X(sh.roofRear);
  const tf = X(sh.roofFront);
  cabin.moveTo(rr, sh.belt - 0.02);
  cabin.lineTo(tr - 0.05, H - 0.06);
  cabin.quadraticCurveTo(tr, H, tr + 0.15, H);
  cabin.lineTo(tf - 0.15, H);
  cabin.quadraticCurveTo(tf, H, tf + 0.06, H - 0.05);
  cabin.lineTo(rf, sh.belt - 0.02);
  cabin.lineTo(rr, sh.belt - 0.02);

  // glass: the same outline pulled in a little so the roof rails and pillars stay painted
  const glass = new THREE.Shape();
  const inset = 0.07;
  glass.moveTo(rr + inset * 1.4, sh.belt + 0.02);
  glass.lineTo(tr + inset * 0.4, H - inset);
  glass.lineTo(tf - inset * 0.4, H - inset);
  glass.lineTo(rf - inset * 1.4, sh.belt + 0.02);
  glass.lineTo(rr + inset * 1.4, sh.belt + 0.02);

  const lowerG = extrude(lower, W, 0.06);
  const cabinG = extrude(cabin, cabinW, 0.04);
  const glassG = extrude(glass, cabinW + 0.03, 0.0);

  // bumpers, sills, mirrors, B-pillars, grille: black plastic trim
  const trimParts = [
    box(0.12, 0.2, W * 0.98, xr + 0.04, clear + 0.22, 0),
    box(0.12, 0.2, W * 0.98, xf - 0.04, clear + 0.22, 0),
    box(spec.wheelbase - arch * 2 - 0.1, 0.08, W + 0.01, 0, clear + 0.08, 0),
    box(0.04, sh.hood - clear - 0.45, W * 0.55, xf + 0.005, clear + 0.32 + (sh.hood - clear - 0.45) / 2, 0),
    box(0.14, 0.09, 0.08, rf - 0.08, sh.belt + 0.12, W / 2 + 0.03),
    box(0.14, 0.09, 0.08, rf - 0.08, sh.belt + 0.12, -W / 2 - 0.03),
  ];
  if (spec.kind !== "truck") {
    const bx = X((sh.roofRear + sh.roofFront) / 2 + 0.02);
    trimParts.push(box(0.09, H - sh.belt - 0.1, cabinW + 0.04, bx, (H + sh.belt) / 2 - 0.02, 0));
  }
  if (spec.kind === "pickup") {
    // open bed: floor and tailgate
    trimParts.push(box(X(sh.rearGlass) - xr - 0.25, 0.04, W * 0.86, (xr + X(sh.rearGlass)) / 2, sh.deck - 0.02, 0));
  }
  const trim = mergeGeometries(trimParts)!;

  const lampY = sh.hood - 0.16;
  const head = mergeGeometries([box(0.06, 0.1, 0.32, xf - 0.02, lampY, W / 2 - 0.25), box(0.06, 0.1, 0.32, xf - 0.02, lampY, -W / 2 + 0.25)])!;
  const tailY = spec.kind === "truck" ? clear + 0.45 : sh.deck - 0.16;
  const tail = mergeGeometries([box(0.05, 0.12, 0.3, xr - 0.005, tailY, W / 2 - 0.22), box(0.05, 0.12, 0.3, xr - 0.005, tailY, -W / 2 + 0.22)])!;

  let cargo: THREE.BufferGeometry | null = null;
  if (spec.kind === "truck") {
    const len = X(sh.rearGlass) - xr - 0.15;
    cargo = new THREE.BoxGeometry(len, H - clear - 0.55, W);
    cargo.translate(xr + len / 2, clear + 0.55 + (H - clear - 0.55) / 2, 0);
  }

  for (const g of [lowerG, cabinG, glassG, trim, head, tail, cargo]) g?.translate(0, -r, 0);
  return { lower: lowerG, cabin: cabinG, glass: glassG, trim, head, tail, cargo };
}

const paint = new Map<string, THREE.MeshPhysicalMaterial>();
function paintFor(color: string) {
  let m = paint.get(color);
  if (!m) {
    const c = new THREE.Color(color);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    m = new THREE.MeshPhysicalMaterial({
      color: c,
      metalness: hsl.s < 0.1 && hsl.l > 0.3 && hsl.l < 0.85 ? 0.75 : 0.35,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    paint.set(color, m);
  }
  return m;
}

export const MAT = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0d1318, metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.7 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 1, roughness: 0.28 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.6, roughness: 0.1 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.25, roughness: 0.3 }),
  brake: new THREE.MeshStandardMaterial({ color: 0x8a0000, emissive: 0xff1a10, emissiveIntensity: 2.4, roughness: 0.3 }),
  cargo: new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.6, metalness: 0.2 }),
};

let wheelGeo: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null = null;
function wheelParts() {
  if (wheelGeo) return wheelGeo;
  // unit wheel (radius 1, width 0.6), scaled per car; axle along Z
  const prof: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    prof.push(new THREE.Vector2(0.86 + Math.cos(a) * 0.14, Math.sin(a) * 0.3));
  }
  prof.unshift(new THREE.Vector2(0.62, -0.3));
  prof.push(new THREE.Vector2(0.62, 0.3));
  const tyre = new THREE.LatheGeometry(prof, 28);
  tyre.rotateX(Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [];
  const disc = new THREE.CylinderGeometry(0.64, 0.64, 0.5, 24);
  disc.rotateX(Math.PI / 2);
  parts.push(disc);
  const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.62, 12);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.BoxGeometry(0.12, 0.56, 0.08);
    sp.translate(0, 0.32, 0.27);
    sp.rotateZ((k / 5) * Math.PI * 2);
    parts.push(sp);
    const sp2 = sp.clone();
    sp2.translate(0, 0, -0.54);
    parts.push(sp2);
  }
  const rim = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  wheelGeo = { tyre, rim };
  return wheelGeo;
}

export type CarView = {
  root: THREE.Group;
  wheels: { steer: THREE.Group; spin: THREE.Group }[];
  tail: THREE.Mesh;
};

export function makeCar(spec: VehicleSpec, color: string): CarView {
  let parts = cache.get(spec.kind);
  if (!parts) {
    parts = build(spec);
    cache.set(spec.kind, parts);
  }
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };
  const p = paintFor(color);
  add(parts.lower, p);
  add(parts.cabin, spec.kind === "truck" ? MAT.cargo : p);
  add(parts.glass, MAT.glass, false);
  add(parts.trim, MAT.trim);
  add(parts.head, MAT.head, false);
  const tail = add(parts.tail, MAT.tail, false);
  if (parts.cargo) add(parts.cargo, MAT.cargo);

  const wp = wheelParts();
  const wheels: CarView["wheels"] = [];
  const width = spec.kind === "truck" ? 0.32 : spec.kind === "suv" || spec.kind === "pickup" ? 0.27 : 0.22;
  for (let i = 0; i < 4; i++) {
    const steer = new THREE.Group();
    const spin = new THREE.Group();
    steer.add(spin);
    const tyre = new THREE.Mesh(wp.tyre, MAT.tyre);
    const rim = new THREE.Mesh(wp.rim, MAT.rim);
    tyre.castShadow = true;
    spin.add(tyre, rim);
    spin.scale.set(spec.wheelRadius, spec.wheelRadius, width / 0.6);
    root.add(steer);
    wheels.push({ steer, spin });
  }
  return { root, wheels, tail };
}
