const UNITS = ["", "K", "M", "B", "T", "aa", "ab", "ac"];

/** 950 -> "950", 12 340 -> "12.3K", 4 500 000 -> "4.50M" */
export function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v < 1000) return v < 10 ? v.toFixed(v % 1 ? 1 : 0) : Math.floor(v).toString();
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + UNITS[i];
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} soat ${m} daq`;
  if (m) return `${m} daq ${s % 60} s`;
  return `${s} s`;
}

export function h(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
