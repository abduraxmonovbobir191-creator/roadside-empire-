import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type RAPIER from "@dimforge/rapier3d-compat";
import { addStaticBox } from "../sim/physics";
import { FORECOURT, ISLAND_Z, LANE, PUMP_X, ROAD_END, ROAD_HALF, ROWS, SHOP, SLOTS, TILL } from "../game/layout";
import * as tex from "./textures";

const CANOPY_H = 5.4;

function plane(w: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

export class StationView {
  readonly group = new THREE.Group();
  private dispensers: THREE.Group[] = [];
  private buyMarkers: THREE.Mesh[] = [];
  private shopSign: THREE.Mesh;
  private shopLights: THREE.Mesh;
  private priceMesh: THREE.Mesh;
  private billboard: THREE.Group;
  private tillCoins: THREE.InstancedMesh;
  private attendants: THREE.Group[] = [];
  readonly tillPos = new THREE.Vector3(TILL.x, 1.1, TILL.z);
  private shown = { pumps: -1, shop: -1, sign: -1, price: "", attendant: -1 };

  constructor(world: RAPIER.World) {
    const g = this.group;

    // ---- ground and road
    g.add(plane(1600, 1600, new THREE.MeshStandardMaterial({ map: tex.grass([160, 160]), roughness: 1 }), 0, 0, 0));
    const asphaltMat = new THREE.MeshStandardMaterial({ map: tex.asphalt([ROAD_END / 4, 2]), roughness: 0.92 });
    g.add(plane(ROAD_END * 2 + 40, ROAD_HALF * 2, asphaltMat, 0, 0.012, 0));
    const shoulder = new THREE.MeshStandardMaterial({ color: 0x8c8473, roughness: 1 });
    g.add(plane(ROAD_END * 2 + 40, 1.4, shoulder, 0, 0.008, ROAD_HALF + 0.7));
    g.add(plane(ROAD_END * 2 + 40, 1.4, shoulder, 0, 0.008, -ROAD_HALF - 0.7));

    // lane paint: solid edges, dashed centre (3 m dash, 9 m gap)
    const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
    const marks: THREE.BufferGeometry[] = [];
    const strip = (x: number, z: number, w: number, d: number) => {
      const p = new THREE.PlaneGeometry(w, d);
      p.rotateX(-Math.PI / 2);
      p.translate(x, 0.016, z);
      marks.push(p);
    };
    strip(-ROAD_END / 2 - 30, -ROAD_HALF + 0.15, ROAD_END - 20, 0.15);
    strip(ROAD_END / 2 + 30, -ROAD_HALF + 0.15, ROAD_END - 20, 0.15);
    strip(-ROAD_END / 2 - 35, ROAD_HALF - 0.15, ROAD_END - 30, 0.15);
    strip(ROAD_END / 2 + 35, ROAD_HALF - 0.15, ROAD_END - 30, 0.15);
    for (let x = -ROAD_END; x < ROAD_END; x += 12) strip(x, 0, 3, 0.13);
    // stop / give-way line at the exit
    strip(44, 6.3, 0.3, 4.6);
    g.add(new THREE.Mesh(mergeGeometries(marks)!, paint));

    // forecourt: asphalt apron with concrete under the canopy
    const apron = new THREE.Shape();
    apron.moveTo(-70, ROAD_HALF);
    apron.lineTo(70, ROAD_HALF);
    apron.lineTo(52, 8);
    apron.lineTo(FORECOURT.x1, FORECOURT.z1);
    apron.lineTo(FORECOURT.x0, FORECOURT.z1);
    apron.lineTo(-52, 8);
    apron.lineTo(-70, ROAD_HALF);
    const apronGeo = new THREE.ShapeGeometry(apron);
    apronGeo.rotateX(Math.PI / 2);
    const apronMesh = new THREE.Mesh(apronGeo, new THREE.MeshStandardMaterial({ map: tex.asphalt([0.12, 0.12]), roughness: 0.9, side: THREE.DoubleSide }));
    apronMesh.position.y = 0.01;
    apronMesh.receiveShadow = true;
    // ShapeGeometry UVs are in metres; scale the texture to ~8 m
    apronMesh.material.map!.repeat.set(1 / 8, 1 / 8);
    g.add(apronMesh);
    g.add(plane(56, 15.5, new THREE.MeshStandardMaterial({ map: tex.concrete([7, 2]), roughness: 0.85 }), 0, 0.02, ISLAND_Z));
    g.add(plane(SHOP.w + 8, 6, new THREE.MeshStandardMaterial({ map: tex.concrete([3.5, 0.8]), roughness: 0.85 }), SHOP.x, 0.021, SHOP.z - SHOP.d / 2 - 2.5));

    // ---- canopy, islands, dispensers
    const steel = new THREE.MeshStandardMaterial({ color: 0xe8e9ea, metalness: 0.5, roughness: 0.35 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8281e, roughness: 0.45 });
    const kerb = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 });
    const canopy = new THREE.Group();
    // the roof skin is see-through from the game camera; fascia, bands and LEDs stay solid
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(48, 0.9, 15),
      new THREE.MeshStandardMaterial({ color: 0xe8e9ea, metalness: 0.4, roughness: 0.4, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    roof.position.set(0, CANOPY_H + 0.45, ISLAND_Z);
    roof.castShadow = true;
    canopy.add(roof);
    for (const z of [ISLAND_Z - 7.5, ISLAND_Z + 7.5]) {
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(48, 0.9, 0.12), steel);
      fascia.position.set(0, CANOPY_H + 0.45, z);
      fascia.castShadow = true;
      canopy.add(fascia);
      const band = new THREE.Mesh(new THREE.BoxGeometry(48.1, 0.32, 0.16), red);
      band.position.set(0, CANOPY_H + 0.45, z);
      canopy.add(band);
    }
    for (const x of [-24, 24]) {
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 15), steel);
      fascia.position.set(x, CANOPY_H + 0.45, ISLAND_Z);
      canopy.add(fascia);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 15.1), red);
      band.position.set(x, CANOPY_H + 0.45, ISLAND_Z);
      canopy.add(band);
    }
    const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 1.4 });
    for (const x of [-18, -6, 6, 18])
      for (const z of [ROWS[0], ROWS[1]]) {
        const led = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.8), ledMat);
        led.rotation.x = Math.PI / 2;
        led.position.set(x, CANOPY_H - 0.01, z);
        canopy.add(led);
      }
    for (const x of [-18, 6, 18]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, CANOPY_H, 0.45), steel);
      col.position.set(x, CANOPY_H / 2, ISLAND_Z);
      col.castShadow = true;
      canopy.add(col);
      addStaticBox(world, x, CANOPY_H / 2, ISLAND_Z, 0.23, CANOPY_H / 2, 0.23);
    }
    g.add(canopy);

    const screenTex = tex.pumpScreen();
    for (const x of PUMP_X) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 1.3), kerb);
      island.position.set(x, 0.09, ISLAND_Z);
      island.castShadow = true;
      island.receiveShadow = true;
      g.add(island);
      addStaticBox(world, x, 0.09, ISLAND_Z, 2.6, 0.09, 0.65);
    }
    for (const slot of SLOTS) {
      // one dispenser per island serves both rows; build it for the row-0 slot
      if (slot.row !== 0) continue;
      const d = this.makeDispenser(steel, red, screenTex);
      d.position.set(slot.x, 0.18, ISLAND_Z);
      d.visible = false;
      g.add(d);
      this.dispensers.push(d);
      addStaticBox(world, slot.x, 1, ISLAND_Z, 0.5, 0.9, 0.3);
    }
    // "buy here" markers on empty bays
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85 });
    for (const slot of SLOTS) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 40), markerMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(slot.x, 0.04, slot.z);
      ring.visible = false;
      g.add(ring);
      this.buyMarkers.push(ring);
    }

    // ---- shop building
    const plaster = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.9 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1b2a33, metalness: 0.1, roughness: 0.05, clearcoat: 1 });
    const shop = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(SHOP.w, 4.2, SHOP.d), plaster);
    body.position.set(0, 2.1, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    shop.add(body);
    const roofTop = new THREE.Mesh(new THREE.BoxGeometry(SHOP.w, 0.2, SHOP.d), new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 }));
    roofTop.position.set(0, 4.3, 0);
    shop.add(roofTop);
    for (const [w, d, x, z] of [
      [SHOP.w + 0.4, 0.2, 0, -SHOP.d / 2 - 0.1],
      [SHOP.w + 0.4, 0.2, 0, SHOP.d / 2 + 0.1],
      [0.2, SHOP.d, -SHOP.w / 2 - 0.1, 0],
      [0.2, SHOP.d, SHOP.w / 2 + 0.1, 0],
    ]) {
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), red);
      parapet.position.set(x, 4.4, z);
      parapet.castShadow = true;
      shop.add(parapet);
    }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(SHOP.w - 3, 2.6), glassMat);
    front.position.set(0, 1.5, -SHOP.d / 2 - 0.01);
    front.rotation.y = Math.PI;
    shop.add(front);
    this.shopLights = new THREE.Mesh(
      new THREE.PlaneGeometry(SHOP.w - 3.4, 2.3),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe9c4, emissiveIntensity: 0.0, transparent: true, opacity: 0.35 }),
    );
    this.shopLights.position.set(0, 1.5, -SHOP.d / 2 + 0.05);
    this.shopLights.rotation.y = Math.PI;
    shop.add(this.shopLights);
    // mullions
    for (let i = 0; i <= 6; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.4 }));
      m.position.set(-(SHOP.w - 3) / 2 + ((SHOP.w - 3) * i) / 6, 1.5, -SHOP.d / 2 - 0.03);
      shop.add(m);
    }
    this.shopSign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.25), new THREE.MeshStandardMaterial({ map: tex.shopSign("KASSA"), emissive: 0xffffff, emissiveIntensity: 0.15 }));
    this.shopSign.position.set(0, 3.55, -SHOP.d / 2 - 0.02);
    this.shopSign.rotation.y = Math.PI;
    shop.add(this.shopSign);
    shop.position.set(SHOP.x, 0, SHOP.z);
    g.add(shop);
    addStaticBox(world, SHOP.x, 2.1, SHOP.z, SHOP.w / 2, 2.1, SHOP.d / 2);

    // till cash: a stack of notes that grows while nobody collects it
    const noteGeo = new THREE.BoxGeometry(0.34, 0.05, 0.16);
    this.tillCoins = new THREE.InstancedMesh(noteGeo, new THREE.MeshStandardMaterial({ color: 0x5fae5a, roughness: 0.6 }), 40);
    this.tillCoins.count = 0;
    this.tillCoins.castShadow = true;
    g.add(this.tillCoins);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.5 }));
    counter.position.set(TILL.x, 0.5, TILL.z);
    counter.castShadow = true;
    g.add(counter);

    // ---- price totem by the entrance
    const totem = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
    pole.position.y = 3.5;
    totem.add(pole);
    this.priceMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.8, 0.35), [steel, steel, steel, steel, new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()]);
    this.priceMesh.position.y = 5.2;
    this.priceMesh.castShadow = true;
    totem.add(this.priceMesh);
    totem.position.set(-62, 0, 8.5);
    totem.rotation.y = -Math.PI / 2 + 0.35;
    g.add(totem);

    // ---- billboard for passing traffic
    this.billboard = new THREE.Group();
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), steel);
    legs.position.set(-3, 3, 0);
    const legs2 = legs.clone();
    legs2.position.x = 3;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(9, 4.5, 0.3),
      [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: tex.billboard(["YOQILG'I", "800 m o'ngda", "24/7"]), emissive: 0xffffff, emissiveIntensity: 0.12 }), steel],
    );
    board.position.y = 7.8;
    board.castShadow = true;
    this.billboard.add(legs, legs2, board);
    this.billboard.position.set(-140, 0, 11);
    this.billboard.rotation.y = -Math.PI / 2 + 0.5;
    g.add(this.billboard);

    this.scenery(g, world);
  }

  private makeDispenser(steel: THREE.Material, red: THREE.Material, screen: THREE.Texture) {
    const d = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.55), steel);
    body.position.y = 0.95;
    body.castShadow = true;
    d.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.3, 0.59), red);
    top.position.y = 2.0;
    d.add(top);
    const scr = new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.9 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), scr);
      p.position.set(0, 1.45, s * 0.281);
      if (s < 0) p.rotation.y = Math.PI;
      d.add(p);
      // nozzle holster + hose
      const hose = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([new THREE.Vector3(0.35, 1.7, s * 0.28), new THREE.Vector3(0.6, 0.5, s * 0.5), new THREE.Vector3(0.45, 1.0, s * 0.3)]),
          16,
          0.025,
          6,
        ),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
      );
      d.add(hose);
      const noz = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: 0x1f8f3a, roughness: 0.4 }));
      noz.position.set(0.45, 1.05, s * 0.31);
      d.add(noz);
    }
    return d;
  }

  private scenery(g: THREE.Group, world: RAPIER.World) {
    const r = seeded(42);
    // trees (instanced): trunk + two crowns, kept off the road and forecourt
    const n = 170;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 2.4, 7), new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 }), n);
    const crownGeo = new THREE.IcosahedronGeometry(1.6, 1);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), n * 2);
    trunk.castShadow = crown.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = (r() - 0.5) * 460;
        z = (r() - 0.5) * 220;
        const onRoad = Math.abs(z) < ROAD_HALF + 4;
        const onSite = x > -80 && x < 80 && z > 0 && z < 45;
        const nearBoard = Math.abs(x + 140) < 10 && Math.abs(z - 11) < 8;
        if (!onRoad && !onSite && !nearBoard) break;
      }
      const s = 0.8 + r() * 0.7;
      m.compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
      for (let c = 0; c < 2; c++) {
        const cs = s * (1 - c * 0.3) * (0.9 + r() * 0.3);
        q.setFromEuler(new THREE.Euler(r(), r() * 6, r()));
        m.compose(new THREE.Vector3(x + (r() - 0.5) * 0.6, (2.6 + c * 1.3) * s, z + (r() - 0.5) * 0.6), q, new THREE.Vector3(cs, cs * 0.9, cs));
        crown.setMatrixAt(k, m);
        col.setHSL(0.24 + r() * 0.06, 0.38 + r() * 0.2, 0.22 + r() * 0.1);
        crown.setColorAt(k, col);
        k++;
      }
      q.identity();
    }
    g.add(trunk, crown);

    // utility poles along the far side of the road
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.9 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 8), poleMat, 26);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 2.2), poleMat, 26);
    for (let i = 0; i < 26; i++) {
      const x = -250 + i * 20;
      m.compose(new THREE.Vector3(x, 4.5, -ROAD_HALF - 3.5), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 8.6, -ROAD_HALF - 3.5), q, new THREE.Vector3(1, 1, 1));
      arms.setMatrixAt(i, m);
    }
    poles.castShadow = true;
    g.add(poles, arms);

    // street lights on the forecourt edge
    for (const x of [-34, 34]) {
      const lp = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0x5b6067, metalness: 0.6, roughness: 0.4 }));
      post.position.y = 4;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.35), new THREE.MeshStandardMaterial({ color: 0x5b6067, emissive: 0xfff3d6, emissiveIntensity: 0.3 }));
      head.position.set(0, 8, -0.3);
      lp.add(post, head);
      lp.position.set(x, 0, 6.2);
      post.castShadow = true;
      g.add(lp);
      addStaticBox(world, x, 2, 6.2, 0.1, 2, 0.1);
    }

    // distant low hills close the horizon
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f7d58, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hillMat);
      const a = (i / 14) * Math.PI * 2;
      hill.scale.set(90 + r() * 80, 18 + r() * 22, 70 + r() * 50);
      hill.position.set(Math.cos(a) * 520, -6, Math.sin(a) * 420);
      g.add(hill);
    }

    // wooden fence behind the station
    const fence = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x7b5f43, roughness: 1 }), 60);
    for (let i = 0; i < 60; i++) {
      m.compose(new THREE.Vector3(-60 + i * 2, 0.6, 44), q, new THREE.Vector3(1, 1, 1));
      fence.setMatrixAt(i, m);
    }
    g.add(fence);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(120, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x7b5f43, roughness: 1 }));
    rail.position.set(0, 0.95, 44);
    g.add(rail);
    void LANE;
  }

  /** Sync visuals with the economy state. */
  update(opts: { pumps: number; shop: number; sign: number; priceText: string; till: number; attendant: number; t: number }) {
    if (opts.pumps !== this.shown.pumps) {
      this.shown.pumps = opts.pumps;
      // dispensers: island i is used once any of its two slots is unlocked
      SLOTS.forEach((slot, i) => {
        const island = PUMP_X.indexOf(slot.x);
        if (i < opts.pumps) this.dispensers[2 - island].visible = true;
      });
      this.buyMarkers.forEach((mk, i) => (mk.visible = i === opts.pumps));
    }
    const mk = this.buyMarkers[opts.pumps];
    if (mk) {
      const s = 1 + Math.sin(opts.t * 3) * 0.08;
      mk.scale.set(s, s, s);
    }
    if (opts.shop !== this.shown.shop) {
      this.shown.shop = opts.shop;
      const mat = this.shopSign.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = tex.shopSign(opts.shop > 0 ? "MARKET 24/7" : "KASSA");
      mat.needsUpdate = true;
      (this.shopLights.material as THREE.MeshStandardMaterial).emissiveIntensity = opts.shop > 0 ? 0.9 : 0.05;
    }
    if (opts.sign !== this.shown.sign) {
      this.shown.sign = opts.sign;
      const s = 0.8 + Math.min(opts.sign, 15) * 0.04;
      this.billboard.scale.set(s, s, s);
    }
    if (opts.priceText !== this.shown.price) {
      this.shown.price = opts.priceText;
      const t = tex.priceBoard(
        [
          { label: "AI-92", price: opts.priceText, color: "#1f8f3a" },
          { label: "AI-95", price: (parseFloat(opts.priceText) * 1.1).toFixed(2), color: "#1d5fae" },
          { label: "DT", price: (parseFloat(opts.priceText) * 1.05).toFixed(2), color: "#333" },
        ],
        "ROADSIDE",
      );
      const mats = this.priceMesh.material as THREE.MeshStandardMaterial[];
      for (const i of [4, 5]) {
        mats[i].map?.dispose();
        mats[i] = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
      }
    }
    // cash stack at the till
    const notes = Math.min(40, Math.ceil(Math.sqrt(opts.till) * 1.5));
    if (this.tillCoins.count !== notes) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < notes; i++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 0.37) % 0.6);
        m.compose(new THREE.Vector3(TILL.x - 0.4 + (i % 3) * 0.38, 1.03 + Math.floor(i / 3) * 0.05, TILL.z - 0.05), q, new THREE.Vector3(1, 1, 1));
        this.tillCoins.setMatrixAt(i, m);
      }
      this.tillCoins.count = notes;
      this.tillCoins.instanceMatrix.needsUpdate = true;
    }
    if (opts.attendant !== this.shown.attendant) {
      this.shown.attendant = opts.attendant;
      for (const a of this.attendants) this.group.remove(a);
      this.attendants = [];
      for (let i = 0; i < Math.min(opts.attendant, 3); i++) {
        const p = person(0xc8281e);
        p.position.set(PUMP_X[2 - i] - 1.6, 0.18, ISLAND_Z + (i % 2 ? 0.9 : -0.9));
        this.group.add(p);
        this.attendants.push(p);
      }
    }
    for (const [i, a] of this.attendants.entries()) a.rotation.y = Math.sin(opts.t * 0.7 + i) * 0.8;
  }
}

/** A simple standing figure (1.75 m) in a uniform. */
export function person(shirt: number) {
  const p = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7b, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.9 });
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.7, 4, 8), dark);
  legs.position.set(0, 0.47, 0);
  legs.scale.set(1.6, 1, 1);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.45, 4, 10), cloth);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), skin);
  head.position.y = 1.62;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.07, 14), cloth);
  cap.position.y = 1.72;
  for (const o of [legs, torso, head, cap]) {
    o.castShadow = true;
    p.add(o);
  }
  return p;
}
