// 선 자르기·단순화·눈금 계산. DOM 없음.

/** 선분을 사각형에 맞춰 자른다(Liang–Barsky). 안 보이면 null. t0>0이면 시작점이 잘렸다는 뜻 */
export function clipSeg(x0, y0, x1, y1, L, T, R, B) {
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy], q = [x0 - L, R - x0, y0 - T, B - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return { x0: x0 + t0 * dx, y0: y0 + t0 * dy, x1: x0 + t1 * dx, y1: y0 + t1 * dy, t0, t1 };
}

/** 점 목록(이어진 선)을 사각형으로 잘라 조각 여러 개로 돌려준다 */
export function clipPolyline(pts, L, T, R, B) {
  const out = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const c = clipSeg(ax, ay, bx, by, L, T, R, B);
    if (!c) { if (cur) { out.push(cur); cur = null; } continue; }
    if (cur && c.t0 === 0) cur.push([c.x1, c.y1]);
    else { if (cur) out.push(cur); cur = [[c.x0, c.y0], [c.x1, c.y1]]; }
    if (c.t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/** 다각형을 사각형으로 자른다(Sutherland–Hodgman) */
export function clipPolygon(pts, L, T, R, B) {
  const edges = [
    [(p) => p[0] >= L, (a, b) => [L, a[1] + ((b[1] - a[1]) * (L - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= R, (a, b) => [R, a[1] + ((b[1] - a[1]) * (R - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= T, (a, b) => [a[0] + ((b[0] - a[0]) * (T - a[1])) / (b[1] - a[1]), T]],
    [(p) => p[1] <= B, (a, b) => [a[0] + ((b[0] - a[0]) * (B - a[1])) / (b[1] - a[1]), B]],
  ];
  let poly = pts;
  for (const [inside, cross] of edges) {
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia && ib) next.push(b);
      else if (ia && !ib) next.push(cross(a, b));
      else if (!ia && ib) { next.push(cross(a, b)); next.push(b); }
    }
    poly = next;
    if (!poly.length) break;
  }
  return poly;
}

/** 점을 줄인다(Ramer–Douglas–Peucker, 반복형). eps 이하로 벗어나는 점을 뺀다 */
export function simplify(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let i = s + 1; i < e; i++) {
      const d = len === 0 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const MINUS = "−";
export function formatNum(v) {
  if (Math.abs(v) < 1e-12) return "0";
  const s = String(Number(v.toPrecision(10)));
  return s.startsWith("-") ? MINUS + s.slice(1) : s;
}
/** k·(num/den)π 를 π 분수 글자로 */
function piLabel(p, q) {
  const g = gcd(p, q) || 1;
  p /= g; q /= g;
  if (p === 0) return "0";
  const neg = p < 0;
  p = Math.abs(p);
  const coef = p === 1 ? "π" : `${p}π`;
  return (neg ? MINUS : "") + (q === 1 ? coef : `${coef}/${q}`);
}

const PI_STEPS = [[1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [3, 2], [2, 1], [3, 1], [4, 1], [6, 1], [12, 1]];

/**
 * 눈금 목록. 간격은 1·2·5×10^k (π 범위면 π의 분수)
 * @param {number} a 시작 @param {number} b 끝 @param {number} len 축 길이(그림 단위) @param {number} per 눈금 사이 최소 간격
 * @param {boolean} isPi @param {(label:string)=>number} widthOf 글자 폭 어림
 * @returns {{v:number, label:string}[]}
 */
export function makeTicks(a, b, len, per, isPi, widthOf) {
  let count = Math.max(2, Math.floor(len / per));
  for (let tries = 0; tries < 8; tries++) {
    const ticks = isPi ? piTicks(a, b, count) : plainTicks(a, b, count);
    const stepPx = ticks.length > 1 ? (len * Math.abs(ticks[1].v - ticks[0].v)) / (b - a) : len;
    const wmax = Math.max(0, ...ticks.map((t) => widthOf(t.label)));
    if (wmax + 8 <= stepPx || count <= 2) return ticks;
    count = Math.max(2, Math.floor(count * 0.7));
  }
  return plainTicks(a, b, 2);
}

function plainTicks(a, b, count) {
  const raw = (b - a) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out = [];
  const k0 = Math.ceil(a / step - 1e-9), k1 = Math.floor(b / step + 1e-9);
  for (let k = k0; k <= k1; k++) {
    const v = Number((k * step).toPrecision(12));
    out.push({ v, label: formatNum(v) });
  }
  return out;
}

function piTicks(a, b, count) {
  const raw = (b - a) / count;
  let [num, den] = PI_STEPS[PI_STEPS.length - 1];
  for (const s of PI_STEPS) if ((s[0] / s[1]) * Math.PI >= raw * 0.9) { [num, den] = s; break; }
  const step = (num / den) * Math.PI;
  const out = [];
  const k0 = Math.ceil(a / step - 1e-9), k1 = Math.floor(b / step + 1e-9);
  for (let k = k0; k <= k1; k++) out.push({ v: k * step, label: piLabel(k * num, den) });
  return out;
}

/** 값을 보기 좋은 눈금 간격에 맞춰 바깥으로 넓힌다(y 자동 범위용) */
export function niceRange(lo, hi) {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}
