/**
 * The one curve every line graph draws (Nitsan, 2026-11-16: "use this style for
 * all line graphs, gradient fill fluid line much cleaner — so all graphs styles
 * are similar across"). See `components/line-style.tsx` for the fill, grid and
 * hover dot that go with it.
 *
 * Monotone cubic (Fritsch–Carlson) rather than Catmull-Rom: just as fluid, but
 * the curve never swings past the points it joins — a month of zero hours is
 * not drawn dipping below the axis, and a peak is not drawn higher than it was.
 * Points are expected in increasing x.
 */
export type Pt = { x: number; y: number };

export function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }
  // tangent at each point
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  m[n - 1] = slope[n - 2];
  // Fritsch–Carlson: keep each segment monotone
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  const r = (v: number) => Math.round(v * 100) / 100;
  let d = `M${r(pts[0].x)},${r(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const k = dx[i] / 3;
    d += ` C${r(p.x + k)},${r(p.y + m[i] * k)} ${r(q.x - k)},${r(q.y - m[i + 1] * k)} ${r(q.x)},${r(q.y)}`;
  }
  return d;
}

/** The closed shape under a line, down to `baseY` — what the gradient fills. */
export function areaPath(pts: Pt[], baseY: number): string {
  if (pts.length < 2) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${smoothPath(pts)} L${last.x},${baseY} L${first.x},${baseY} Z`;
}
