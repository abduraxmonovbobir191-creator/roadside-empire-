export type P2 = { x: number; z: number };

const STEP = 0.5;

/**
 * A drivable centre line on the ground plane, sampled every 0.5 m.
 * Corners are rounded with real arcs so the curvature (and the speed a car can carry) is known.
 */
export class Path {
  readonly pts: P2[] = [];
  /** arc length at each sample */
  readonly s: number[] = [];
  /** signed curvature at each sample, 1/m */
  readonly k: number[] = [];

  constructor(pts: P2[]) {
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      this.pts.push(pts[i]);
      this.s.push(acc);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 2)];
      const b = pts[i];
      const c = pts[Math.min(pts.length - 1, i + 2)];
      this.k.push(curvature(a, b, c));
    }
  }

  get length(): number {
    return this.s[this.s.length - 1];
  }

  private index(s: number): number {
    if (s <= 0) return 0;
    if (s >= this.length) return this.pts.length - 2;
    let lo = 0;
    let hi = this.s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number): P2 {
    const n = this.pts.length;
    if (s >= this.length) {
      // extend straight past the end so look-ahead never runs out
      const a = this.pts[n - 2];
      const b = this.pts[n - 1];
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const over = s - this.length;
      return { x: b.x + ((b.x - a.x) / d) * over, z: b.z + ((b.z - a.z) / d) * over };
    }
    const i = this.index(s);
    const seg = this.s[i + 1] - this.s[i] || 1;
    const t = (s - this.s[i]) / seg;
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Heading as an angle from +X toward -Z (same convention as Vehicle.yaw). */
  headingAt(s: number): number {
    const i = this.index(Math.min(s, this.length - 1e-6));
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return Math.atan2(-(b.z - a.z), b.x - a.x);
  }

  curvatureAt(s: number): number {
    return this.k[this.index(s)];
  }

  /** Arc length of the closest point, searched around a hint (cars move a little each step). */
  project(p: P2, hint = -1, window = 30): { s: number; lateral: number; dist: number } {
    let from = 0;
    let to = this.pts.length - 2;
    if (hint >= 0) {
      from = Math.max(0, this.index(hint - window));
      to = Math.min(this.pts.length - 2, this.index(hint + window) + 1);
    }
    let best = { s: 0, lateral: 0, dist: Infinity };
    for (let i = from; i <= to; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const d = Math.hypot(p.x - qx, p.z - qz);
      if (d < best.dist) {
        // + lateral = to the right of the direction of travel
        const cross = dx * (p.z - a.z) - dz * (p.x - a.x);
        best = { s: this.s[i] + t * Math.sqrt(len2), lateral: Math.sign(cross) * d, dist: d };
      }
    }
    return best;
  }
}

function curvature(a: P2, b: P2, c: P2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const bcx = c.x - b.x;
  const bcz = c.z - b.z;
  const acx = c.x - a.x;
  const acz = c.z - a.z;
  const cross = abx * bcz - abz * bcx;
  const d = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(acx, acz);
  return d < 1e-9 ? 0 : (2 * cross) / d;
}

/**
 * Build a path from corner points with every inner corner rounded to `radius`
 * (clamped so neighbouring arcs never overlap).
 */
export function roundedPath(corners: P2[], radius: number | number[]): Path {
  const out: P2[] = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const p0 = corners[i - 1];
    const p1 = corners[i];
    const p2 = corners[i + 1];
    const r0 = Array.isArray(radius) ? radius[i - 1] ?? radius[radius.length - 1] : radius;
    const ux = p0.x - p1.x;
    const uz = p0.z - p1.z;
    const vx = p2.x - p1.x;
    const vz = p2.z - p1.z;
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    const cos = (ux * vx + uz * vz) / (lu * lv);
    const theta = Math.acos(Math.max(-1, Math.min(1, cos))); // inner angle
    if (theta > Math.PI - 1e-3) {
      out.push(p1);
      continue;
    }
    let tangent = r0 / Math.tan(theta / 2);
    const maxT = Math.min(lu, lv) * 0.5;
    if (tangent > maxT) tangent = maxT;
    const r = tangent * Math.tan(theta / 2);
    const a = { x: p1.x + (ux / lu) * tangent, z: p1.z + (uz / lu) * tangent };
    const b = { x: p1.x + (vx / lv) * tangent, z: p1.z + (vz / lv) * tangent };
    // arc centre along the bisector
    const bx = ux / lu + vx / lv;
    const bz = uz / lu + vz / lv;
    const bl = Math.hypot(bx, bz);
    const h = r / Math.sin(theta / 2);
    const c = { x: p1.x + (bx / bl) * h, z: p1.z + (bz / bl) * h };
    const a0 = Math.atan2(a.z - c.z, a.x - c.x);
    const a1 = Math.atan2(b.z - c.z, b.x - c.x);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    pushLine(out, a);
    const n = Math.max(2, Math.ceil((Math.abs(da) * r) / STEP));
    for (let j = 1; j <= n; j++) {
      const ang = a0 + (da * j) / n;
      out.push({ x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r });
    }
  }
  pushLine(out, corners[corners.length - 1]);
  return new Path(out);
}

function pushLine(out: P2[], to: P2) {
  const from = out[out.length - 1];
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(1, Math.ceil(d / STEP));
  for (let j = 1; j <= n; j++) out.push({ x: from.x + ((to.x - from.x) * j) / n, z: from.z + ((to.z - from.z) * j) / n });
}
