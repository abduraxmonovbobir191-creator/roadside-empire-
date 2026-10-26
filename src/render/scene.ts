import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

const MOBILE = matchMedia("(pointer: coarse)").matches;

/** Renderer, sky, sun and a touch camera (drag = pan, pinch = zoom, two-finger twist = rotate). */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly target = new THREE.Vector3(2, 0, 14);
  private yaw = -0.62;
  private pitch = 0.74;
  dist = 70;
  private userZoomed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastPinch = 0;
  private lastAngle = 0;
  private moved = 0;
  onTap: ((x: number, y: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE || devicePixelRatio < 2, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.75 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 1400);

    // physically based sky; the same sky lights the scene through a pre-filtered env map
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    Object.assign(envSky.material.uniforms.sunPosition.value, sunDir);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"] as const) envSky.material.uniforms[k].value = u[k].value;
    envScene.add(envSky);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.22;
    this.scene.fog = new THREE.Fog(0xb9c6cf, 320, 900);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    this.sun.position.copy(sunDir).multiplyScalar(120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75;
    sc.right = 75;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 10;
    sc.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xe2e9ef, 0x5a5144, 0.35));

    this.bindInput(canvas);
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // portrait phones see less width: pull back so the whole forecourt fits
    this.camera.fov = w < h ? 52 : 34;
    this.camera.updateProjectionMatrix();
    if (!this.userZoomed) {
      // fit ~64 m of forecourt across the screen
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
      const vfov = THREE.MathUtils.degToRad(this.camera.fov);
      this.dist = THREE.MathUtils.clamp(Math.max(27 / Math.tan(hfov / 2), 24 / Math.tan(vfov / 2)), 40, 120);
    }
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, -90, 90);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -20, 45);
    this.dist = THREE.MathUtils.clamp(this.dist, 22, 140);
  }

  update() {
    this.clampTarget();
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
    // keep the shadow frustum on what the camera looks at
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).add(this.sunOffset);
  }

  private sunOffset = new THREE.Vector3().setFromSphericalCoords(140, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(215));

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private pan(dx: number, dy: number) {
    const k = this.dist / innerHeight;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    // the ground follows the finger: screen right is (-c, -s), "away from the camera" is (-s, c)
    this.target.x += (dx * c - dy * s) * k * 1.2;
    this.target.z += (dx * s + dy * c) * k * 1.2;
  }

  private bindInput(el: HTMLCanvasElement) {
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.lastAngle = Math.atan2(b.y - a.y, b.x - a.x);
      }
    });
    el.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size === 1) {
        if (e.buttons === 2) this.yaw += dx * 0.005;
        else this.pan(dx, dy);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.lastPinch > 0) {
          this.dist *= this.lastPinch / d;
          this.userZoomed = true;
        }
        this.yaw -= ang - this.lastAngle;
        this.lastPinch = d;
        this.lastAngle = ang;
      }
    });
    const up = (e: PointerEvent) => {
      if (this.pointers.size === 1 && this.moved < 8) this.onTap?.(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.lastPinch = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", (e) => this.pointers.delete(e.pointerId));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.dist *= Math.exp(e.deltaY * 0.001);
        this.userZoomed = true;
      },
      { passive: false },
    );
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(v: THREE.Vector3, out = new THREE.Vector3()): { x: number; y: number } | null {
    out.copy(v).project(this.camera);
    if (out.z > 1) return null;
    return { x: (out.x * 0.5 + 0.5) * innerWidth, y: (-out.y * 0.5 + 0.5) * innerHeight };
  }
}
