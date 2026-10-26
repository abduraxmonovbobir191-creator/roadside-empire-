import * as THREE from "three";

/** Procedural textures: no image files to download, crisp on any screen. */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], spread: number, dots: number, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * spread;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < dots; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.08})` : `rgba(0,0,0,${0.06 + r() * 0.1})`;
    const x = r() * w;
    const y = r() * h;
    const rad = 0.4 + r() * 1.6;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return r;
}

function finish(c: HTMLCanvasElement, repeat: [number, number], color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function asphalt(repeat: [number, number]) {
  const { c, g } = canvas(512, 512);
  const r = noise(g, 512, 512, [58, 59, 62], 26, 9000, 7);
  // tyre polish along the lanes and a few patched cracks
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = `rgba(20,20,22,${0.15 + r() * 0.15})`;
    g.lineWidth = 0.8 + r();
    g.beginPath();
    let x = r() * 512;
    let y = r() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return finish(c, repeat);
}

export function concrete(repeat: [number, number]) {
  const { c, g } = canvas(512, 512);
  noise(g, 512, 512, [176, 174, 168], 18, 5000, 3);
  // expansion joints every 4 m (texture = 8 m)
  g.strokeStyle = "rgba(70,68,64,0.55)";
  g.lineWidth = 3;
  for (const p of [0, 256]) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 512);
    g.moveTo(0, p);
    g.lineTo(512, p);
    g.stroke();
  }
  return finish(c, repeat);
}

export function grass(repeat: [number, number]) {
  const { c, g } = canvas(512, 512);
  const r = noise(g, 512, 512, [86, 112, 58], 34, 0, 11);
  for (let i = 0; i < 14000; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const shade = r();
    g.strokeStyle = shade > 0.6 ? "rgba(150,170,90,0.35)" : shade > 0.3 ? "rgba(60,90,40,0.35)" : "rgba(120,110,70,0.25)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    g.stroke();
  }
  return finish(c, repeat);
}

export function priceBoard(lines: { label: string; price: string; color: string }[], brand: string) {
  const { c, g } = canvas(256, 512);
  g.fillStyle = "#101418";
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = "#c8281e";
  g.fillRect(0, 0, 256, 120);
  g.fillStyle = "#fff";
  g.font = "800 44px Arial, sans-serif";
  g.textAlign = "center";
  g.fillText(brand, 128, 78);
  lines.forEach((l, i) => {
    const y = 180 + i * 110;
    g.fillStyle = l.color;
    g.fillRect(16, y - 46, 70, 60);
    g.fillStyle = "#fff";
    g.font = "700 30px Arial, sans-serif";
    g.fillText(l.label, 51, y - 6);
    g.fillStyle = "#ffb020";
    g.font = "700 52px 'Courier New', monospace";
    g.textAlign = "right";
    g.fillText(l.price, 242, y);
    g.textAlign = "center";
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function shopSign(text: string) {
  const { c, g } = canvas(1024, 128);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = "#c8281e";
  g.font = "800 84px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function pumpScreen() {
  const { c, g } = canvas(128, 96);
  g.fillStyle = "#0c1a10";
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = "#56f07a";
  g.font = "700 30px 'Courier New', monospace";
  g.textAlign = "right";
  g.fillText("00.00", 120, 38);
  g.fillText("0.00", 120, 80);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function billboard(lines: string[]) {
  const { c, g } = canvas(1024, 512);
  const grad = g.createLinearGradient(0, 0, 1024, 512);
  grad.addColorStop(0, "#c8281e");
  grad.addColorStop(1, "#7a1610");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.font = "800 120px Arial, sans-serif";
  g.fillText(lines[0], 512, 210);
  g.font = "600 64px Arial, sans-serif";
  g.fillText(lines[1] ?? "", 512, 330);
  g.fillStyle = "#ffcf3a";
  g.font = "800 72px Arial, sans-serif";
  g.fillText(lines[2] ?? "", 512, 440);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
