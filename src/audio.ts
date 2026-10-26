/** Tiny synthesized sound effects (WebAudio): no audio files to ship. Starts on the first tap (browser rule). */
const KEY = "roadside-empire:muted";

let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem(KEY) === "1";
} catch {
  /* no storage */
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

let lastCoin = 0;

export const sfx = {
  get muted() {
    return muted;
  },
  setMuted(v: boolean) {
    muted = v;
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  },
  unlock() {
    ac();
  },
  /** cash register ding; throttled so a busy station does not buzz */
  coin() {
    const now = performance.now();
    if (now - lastCoin < 140) return;
    lastCoin = now;
    tone(1318, 0.09, "triangle", 0.09);
    tone(1976, 0.2, "triangle", 0.08, 0.07);
  },
  buy() {
    tone(392, 0.1, "square", 0.05);
    tone(523, 0.1, "square", 0.05, 0.08);
    tone(784, 0.22, "square", 0.05, 0.16);
  },
  reward() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.09, i * 0.09));
  },
  deny() {
    tone(180, 0.18, "sawtooth", 0.05, 0, 120);
  },
  tap() {
    tone(660, 0.05, "sine", 0.05);
  },
};
