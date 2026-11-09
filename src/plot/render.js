// plot 객체 → SVG 문자열. DOM 없음(Node·브라우저 공용). 같은 입력이면 항상 같은 출력.
import { parsePlot, sortErrors } from "./parse.js";
import { clipPolyline, clipPolygon, simplify, makeTicks, niceRange, formatNum } from "./geom.js";
import { parseRich, richWidth, richTspans, esc, FONT_MAIN } from "./rich.js";

// 인쇄 색 묶음의 대체 색(CSS 변수 --plot-1~4, --plot-fill 이 없을 때). 테마가 변수를 정의하면 그 값을 쓴다.
const PALETTES = {
  teal: { lines: ["#1c6862", "#b4571e", "#3b5f9e", "#7a6a14"], fill: "rgba(28,104,98,0.22)" },
  red: { lines: ["#690000", "#1f5a85", "#2d6a3a", "#8a5d00"], fill: "rgba(105,0,0,0.18)" },
  violet: { lines: ["#3d1066", "#b4571e", "#1f6f8b", "#7a6a14"], fill: "rgba(61,16,102,0.18)" },
};

const BASE_W = 360;          // w=70%일 때 그림 너비(단위). w가 다르면 비례 → 글자 크기가 종이에서 일정
const FS = 10, FS_LABEL = 11, FS_AXIS = 12;
const ARROW = 11; // 범위 끝에서 화살촉 끝까지
const SAMPLES = 900;
const f2 = (v) => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };
const pathOf = (pts) => "M" + pts.map((p) => f2(p[0]) + " " + f2(p[1])).join("L");

/** 함수를 [a,b]에서 표본 추출해 끊김 없이 이어진 조각들로 돌려준다(데이터 좌표). 불연속에서 끊는다 */
function sampleRuns(fn, a, b, yrange, n = SAMPLES) {
  const runs = [];
  let cur = [], prev = null, any = false;
  for (let i = 0; i <= n; i++) {
    const x = i === n ? b : a + ((b - a) * i) / n;
    let y;
    try { y = fn(x); } catch { y = NaN; }
    if (!Number.isFinite(y) || Math.abs(y) > 1e9) { if (cur.length) runs.push(cur); cur = []; prev = null; continue; }
    any = true;
    if (prev && prev[1] * y < 0 && Math.abs(y - prev[1]) > yrange) { if (cur.length) runs.push(cur); cur = []; } // 점근선 등
    cur.push([x, y]);
    prev = [x, y];
  }
  if (cur.length) runs.push(cur);
  return { runs, any };
}

const overlap = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

/** @returns {{svg:string, errors:string[]}} */
export function renderPlot(spec, opts = {}) {
  const parsed = parsePlot(spec);
  const errors = [...parsed.errors];
  const pal = PALETTES[opts.palette] ?? PALETTES.teal;
  const plot = parsed.plot;

  // ----- 크기·여백 -----
  const W = Math.max(220, Math.round((BASE_W * plot.w) / 70));
  const H = Math.round(W * 0.75);
  const [xa, xb] = plot.x;

  // y 자동 범위
  if (plot.yAuto) {
    const vals = [];
    for (const f of plot.funcs) {
      for (const run of sampleRuns(f.fn, xa, xb, Infinity, 300).runs) for (const p of run) vals.push(p[1]);
    }
    for (const p of plot.points) vals.push(p.y);
    vals.sort((u, v) => u - v);
    if (vals.length) {
      const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
      let a = lo, b = hi;
      if (a > 0 && a < 0.5 * b) a = 0;
      if (b < 0 && b > 0.5 * a) b = 0;
      const pad = (b - a) * 0.06 || 1;
      plot.y = niceRange(a - pad, b + pad);
    } else plot.y = [-5, 5];
  }
  const [ya, yb] = plot.y;
  const yrange = yb - ya;

  const cx = Math.min(Math.max(0, xa), xb), cy = Math.min(Math.max(0, ya), yb);
  const varName = plot.funcs[0]?.variable ?? "x";
  const xlabel = plot.xlabel ?? varName, ylabel = plot.ylabel ?? "y";

  const wOf = (s) => richWidth(parseRich(s), FS);
  const mt = ylabel ? 24 : 14, mr = xlabel ? 28 : 16;
  const mbBase = cy === ya ? 22 : 12;
  const mb = mbBase;
  // 눈금은 여백 계산 전에 대략의 길이로 만든 뒤 확정한다
  const tickLenY = H - mt - mb;
  const yTicks = makeTicks(ya, yb, tickLenY, plot.yPi ? 40 : 30, plot.yPi, wOf);
  const widest = Math.max(0, ...yTicks.map((t) => wOf(t.label)));
  const ml = cx === xa ? Math.max(18, Math.ceil(widest) + 12) : 14;
  const L = ml, R = W - mr, T = mt, B = H - mb;
  const xTicks = makeTicks(xa, xb, R - L, plot.xPi ? 54 : 40, plot.xPi, wOf);

  const sx = (x) => L + ((x - xa) / (xb - xa)) * (R - L);
  const sy = (y) => B - ((y - ya) / yrange) * (B - T);
  const xAx = sx(cx), yAx = sy(cy); // 축 위치

  const out = [];       // 그림 순서대로
  const boxes = [];     // 글자 상자(충돌 검사)
  const obstacles = []; // 곡선·보조선 위의 점(글자가 피함)
  const line = (i) => `var(--plot-${(i % 4) + 1}, ${pal.lines[i % 4]})`;

  const placeBox = (b) => boxes.push(b);
  const textEl = (x, y, segs, size, anchor, extra = "") =>
    `<text x="${f2(x)}" y="${f2(y)}" font-size="${size}" text-anchor="${anchor}"${extra}>${richTspans(segs, size)}</text>`;
  const halo = (color) => ` fill="${color ?? "currentColor"}" stroke="#fff" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round"`;
  const box = (x, y, w, h, anchor) => { // 글자 기준점 → 상자
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    return { x0, x1: x0 + w, y0: y - h * 0.78, y1: y + h * 0.28 };
  };

  // ----- 눈금선 -----
  if (plot.grid) {
    let g = "";
    for (const t of xTicks) g += `M${f2(sx(t.v))} ${f2(T)}V${f2(B)}`;
    for (const t of yTicks) g += `M${f2(L)} ${f2(sy(t.v))}H${f2(R)}`;
    out.push(`<path d="${g}" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="0.9"/>`);
  }

  // ----- 곡선 계산 -----
  const curves = plot.funcs.map((f, i) => {
    const { runs, any } = sampleRuns(f.fn, xa, xb, yrange);
    if (!any) errors.push(`${f.line}번째 줄: 함수 "${f.name}"는 x 범위 안에서 값을 구할 수 없어 그리지 않습니다`);
    const screenRuns = runs.map((r) => r.map((p) => [sx(p[0]), sy(p[1])]));
    const pieces = [];
    for (const r of screenRuns) pieces.push(...clipPolyline(r, L, T, R, B));
    if (any && !pieces.length) errors.push(`${f.line}번째 줄: 함수 "${f.name}"는 y 범위 밖에 있어 보이지 않습니다`);
    return { f, i, pieces };
  });
  const fnByName = (name) => [...plot.funcs].reverse().find((f) => f.name === name);

  // ----- 칠하기 -----
  const fillPaths = [];
  for (const fl of plot.fills) {
    const f = fnByName(fl.f), g = fl.g ? fnByName(fl.g) : null;
    const a = Math.max(fl.a, xa), b = Math.min(fl.b, xb);
    if (!(b > a)) { errors.push(`${fl.line}번째 줄: 칠할 구간이 x 범위 밖이라 그리지 않습니다`); continue; }
    const n = 500;
    const top = [], bot = [];
    for (let k = 0; k <= n; k++) {
      const x = k === n ? b : a + ((b - a) * k) / n;
      let u, v = 0;
      try { u = f.fn(x); if (g) v = g.fn(x); } catch { u = NaN; }
      top.push([x, u, v]);
    }
    // 값이 정의된 구간마다 따로 칠한다
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const up = simplify(run.map((r) => [sx(r[0]), sy(r[1])]), 0.05);
        const lo = simplify(run.map((r) => [sx(r[0]), sy(r[2])]), 0.05).reverse();
        const poly = clipPolygon([...up, ...lo], L, T, R, B);
        if (poly.length >= 3) fillPaths.push(pathOf(poly) + "Z");
      }
      run = [];
    };
    for (const r of top) {
      if (Number.isFinite(r[1]) && Number.isFinite(r[2]) && Math.abs(r[1]) < 1e9 && Math.abs(r[2]) < 1e9) {
        if (run.length && Math.abs(r[1] - run[run.length - 1][1]) > yrange && r[1] * run[run.length - 1][1] < 0) flush();
        run.push(r);
      } else flush();
    }
    flush();
    if (!fillPaths.length) errors.push(`${fl.line}번째 줄: 칠할 영역이 y 범위 밖이거나 값이 없어 그리지 않습니다`);
  }
  if (fillPaths.length) out.push(`<path d="${fillPaths.join("")}" fill="var(--plot-fill, ${pal.fill})" stroke="none"/>`);

  // ----- 축 -----
  let axisText = ""; // 눈금 글자는 곡선 위에 그려 곡선에 가려지지 않게 한다
  {
    const tip = ARROW, hl = 6.5, hw = 2.5;
    let d = `M${f2(L)} ${f2(yAx)}H${f2(R + tip - hl + 1)}M${f2(xAx)} ${f2(B)}V${f2(T - tip + hl - 1)}`;
    for (const t of xTicks) { const x = sx(t.v); d += `M${f2(x)} ${f2(yAx - 2.6)}V${f2(yAx + 2.6)}`; }
    for (const t of yTicks) { const y = sy(t.v); d += `M${f2(xAx - 2.6)} ${f2(y)}H${f2(xAx + 2.6)}`; }
    out.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.1"/>`);
    out.push(`<path d="M${f2(R + tip)} ${f2(yAx)}L${f2(R + tip - hl)} ${f2(yAx - hw)}L${f2(R + tip - hl)} ${f2(yAx + hw)}ZM${f2(xAx)} ${f2(T - tip)}L${f2(xAx - hw)} ${f2(T - tip + hl)}L${f2(xAx + hw)} ${f2(T - tip + hl)}Z" fill="currentColor"/>`);
    placeBox({ x0: L, x1: R + tip, y0: yAx - 1.5, y1: yAx + 1.5 });
    placeBox({ x0: xAx - 1.5, x1: xAx + 1.5, y0: T - tip, y1: B });

    const originIsO = cx === 0 && cy === 0;
    let t = "";
    for (const k of xTicks) {
      if (originIsO && k.v === 0) continue;
      const segs = parseRich(k.label);
      const x = sx(k.v), y = yAx + 5 + FS * 0.8;
      t += textEl(x, y, segs, FS, "middle");
      placeBox(box(x, y, richWidth(segs, FS), FS, "middle"));
    }
    for (const k of yTicks) {
      if (originIsO && k.v === 0) continue;
      const segs = parseRich(k.label);
      const x = xAx - 6, y = sy(k.v) + FS * 0.35;
      t += textEl(x, y, segs, FS, "end");
      placeBox(box(x, y, richWidth(segs, FS), FS, "end"));
    }
    if (originIsO) {
      const segs = parseRich("O");
      const x = xAx - 5, y = yAx + 5 + FS * 0.8;
      t += textEl(x, y, segs, FS, "end");
      placeBox(box(x, y, richWidth(segs, FS), FS, "end"));
    }
    if (xlabel) {
      const segs = parseRich(xlabel);
      const x = R + tip + 4, y = yAx + FS_AXIS * 0.35;
      t += textEl(x, y, segs, FS_AXIS, "start");
      placeBox(box(x, y, richWidth(segs, FS_AXIS), FS_AXIS, "start"));
    }
    if (ylabel) {
      const segs = parseRich(ylabel);
      const x = xAx, y = T - tip - 4;
      t += textEl(x, y, segs, FS_AXIS, "middle");
      placeBox(box(x, y, richWidth(segs, FS_AXIS), FS_AXIS, "middle"));
    }
    axisText = `<g fill="currentColor" stroke="#fff" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round">${t}</g>`;
  }

  // ----- 곡선 그리기 -----
  for (const c of curves) {
    if (!c.pieces.length) continue;
    const d = c.pieces.map((p) => pathOf(simplify(p, 0.06))).join("");
    out.push(`<path d="${d}" fill="none" stroke="${line(c.i)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    for (const p of c.pieces) for (let k = 0; k < p.length; k += 2) obstacles.push(p[k]);
  }

  // ----- 기울기 삼각형 -----
  const slopeOut = [];
  const slopeLabels = [];
  for (const s of plot.slopes) {
    const f = fnByName(s.f);
    const ci = plot.funcs.indexOf(f);
    let ya0, yb0;
    try { ya0 = f.fn(s.a); yb0 = f.fn(s.b); } catch { ya0 = NaN; }
    if (!Number.isFinite(ya0) || !Number.isFinite(yb0)) { errors.push(`${s.line}번째 줄: 기울기 구간 끝에서 "${s.f}"의 값을 구할 수 없어 그리지 않습니다`); continue; }
    const P = [sx(s.a), sy(ya0)], Q = [sx(s.b), sy(ya0)], S = [sx(s.b), sy(yb0)];
    const mid = f.fn((s.a + s.b) / 2);
    const linear = Math.abs(mid - (ya0 + yb0) / 2) <= 1e-9 * (1 + Math.abs(ya0) + Math.abs(yb0));
    let d = "";
    for (const [u, v] of [[P, Q], [Q, S], ...(linear ? [] : [[P, S]])]) {
      for (const seg of clipPolyline([u, v], L, T, R, B)) d += pathOf(seg);
    }
    if (d) slopeOut.push(`<path d="${d}" fill="none" stroke="${line(ci)}" stroke-width="1.3" stroke-dasharray="4.5 3.2" stroke-linecap="butt"/>`);
    for (const [u, v] of [[P, Q], [Q, S]]) {
      const n = Math.max(2, Math.ceil(Math.hypot(v[0] - u[0], v[1] - u[1]) / 3));
      for (let k = 0; k <= n; k++) obstacles.push([u[0] + ((v[0] - u[0]) * k) / n, u[1] + ((v[1] - u[1]) * k) / n]);
    }
    const dx = s.b - s.a, dy = yb0 - ya0;
    slopeLabels.push({ at: [(P[0] + Q[0]) / 2, P[1]], dirs: dy >= 0 ? [[0, 1], [0, -1]] : [[0, -1], [0, 1]], text: `Δx = ${formatNum(dx)}`, color: line(ci) });
    slopeLabels.push({ at: [Q[0], (Q[1] + S[1]) / 2], dirs: [[1, 0], [-1, 0]], text: `Δy = ${formatNum(dy)}`, color: line(ci) });
  }
  out.push(...slopeOut);
  out.push(axisText);

  // ----- 글자 놓기: 기준점 p에서 방향 dir로 간격 gap만큼 떨어뜨려 상자를 놓는다 -----
  const valid = (b) => {
    if (b.x0 < 1 || b.x1 > W - 1 || b.y0 < 1 || b.y1 > H - 1) return false;
    for (const o of boxes) if (overlap(b, o, 1)) return false;
    for (const p of obstacles) if (p[0] > b.x0 - 1.5 && p[0] < b.x1 + 1.5 && p[1] > b.y0 - 1.5 && p[1] < b.y1 + 1.5) return false;
    return true;
  };
  const place = (p, dirs, w, h, gap) => {
    const tries = [];
    for (const dir of dirs) {
      const len = Math.hypot(dir[0], dir[1]) || 1;
      const nx = dir[0] / len, ny = dir[1] / len;
      const ext = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
      const cxm = p[0] + nx * (gap + ext), cym = p[1] + ny * (gap + ext);
      tries.push({ x0: cxm - w / 2, x1: cxm + w / 2, y0: cym - h / 2, y1: cym + h / 2 });
    }
    return tries.find(valid) ?? null;
  };
  const drawLabel = (b, segs, size, color) => {
    const x = (b.x0 + b.x1) / 2;
    const y = b.y0 + (b.y1 - b.y0) * 0.72; // 상자 중심선 → 기준선
    out.push(textEl(x, y, segs, size, "middle", halo(color)));
    placeBox(b);
  };
  const dirs8 = [[1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [-1, 0], [0, 1]];

  // 함수 이름표: 곡선 끝에서 시작해 안쪽으로 후보 위치를 옮겨 가며 빈 곳을 찾는다
  for (const c of curves) {
    if (!c.f.label || !c.pieces.length) continue;
    const segs = parseRich(c.f.label);
    const w = richWidth(segs, FS_LABEL) + 2, h = FS_LABEL * 1.1;
    const pts = c.pieces.flat();
    let chosen = null;
    const nearAxis = (p) => Math.abs(p[1] - yAx) < 14 || Math.abs(p[0] - xAx) < 14;
    for (const strict of [true, false]) { // 먼저 축에서 떨어진 곳, 안 되면 어디든
      for (const frac of [1, 0.94, 0.88, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0]) {
        const idx = Math.min(pts.length - 1, Math.round(frac * (pts.length - 1)));
        if (strict && nearAxis(pts[idx])) continue;
        const k = Math.max(1, Math.round(pts.length * 0.01));
        const a = pts[Math.max(0, idx - k)], b = pts[Math.min(pts.length - 1, idx + k)];
        const tx = b[0] - a[0], ty = b[1] - a[1];
        const nl = Math.hypot(tx, ty) || 1;
        let n1 = [ty / nl, -tx / nl]; // 곡선 진행 방향의 법선
        if (n1[1] > 0) n1 = [-n1[0], -n1[1]]; // 위쪽을 먼저
        const dirs = [n1, [-n1[0], -n1[1]]];
        if (frac === 1) dirs.push([tx / nl, ty / nl]); // 끝점에서는 바깥쪽도
        chosen = place(pts[idx], dirs, w, h, 4);
        if (chosen) break;
      }
      if (chosen) break;
    }
    if (!chosen) { // 빈 곳이 없으면 끝점 위에 겹치더라도 그린다
      const p = pts[pts.length - 1];
      const x0 = Math.min(Math.max(1, p[0] - w / 2), W - 1 - w);
      chosen = { x0, x1: x0 + w, y0: Math.max(1, p[1] - 4 - h), y1: Math.max(1, p[1] - 4 - h) + h };
    }
    drawLabel(chosen, segs, FS_LABEL, line(c.i));
  }

  // 점
  for (const pt of plot.points) {
    if (pt.x < xa - 1e-9 || pt.x > xb + 1e-9 || pt.y < ya - 1e-9 || pt.y > yb + 1e-9) {
      errors.push(`${pt.line}번째 줄: 점 (${formatNum(pt.x)}, ${formatNum(pt.y)})가 그래프 범위 밖이라 그리지 않습니다`);
      continue;
    }
    const p = [sx(pt.x), sy(pt.y)];
    out.push(`<circle cx="${f2(p[0])}" cy="${f2(p[1])}" r="3.4" fill="currentColor" stroke="#fff" stroke-width="1"/>`);
    obstacles.push(p);
    if (pt.label) {
      const segs = parseRich(pt.label);
      const w = richWidth(segs, FS_LABEL) + 2, h = FS_LABEL * 1.1;
      const b = place(p, dirs8, w, h, 4.5);
      if (b) drawLabel(b, segs, FS_LABEL);
      else {
        const x0 = Math.min(Math.max(1, p[0] + 5), W - 1 - w);
        drawLabel({ x0, x1: x0 + w, y0: p[1] - 5 - h, y1: p[1] - 5 }, segs, FS_LABEL);
      }
    }
  }

  // 기울기 이름표
  for (const sl of slopeLabels) {
    const segs = parseRich(sl.text);
    const w = richWidth(segs, FS_LABEL) + 2, h = FS_LABEL * 1.1;
    const b = place(sl.at, sl.dirs, w, h, 3) ?? place(sl.at, [...sl.dirs, ...dirs8], w, h, 3);
    if (b) drawLabel(b, segs, FS_LABEL, sl.color);
    else {
      const x0 = Math.min(Math.max(1, sl.at[0] + 4), W - 1 - w), y0 = Math.min(Math.max(1, sl.at[1] + 4), H - 1 - h);
      drawLabel({ x0, x1: x0 + w, y0, y1: y0 + h }, segs, FS_LABEL, sl.color);
    }
  }

  const aria = plot.funcs.length
    ? "함수 그래프: " + plot.funcs.map((f) => `${f.name}: y = ${f.expr}`).join(", ")
    : "함수 그래프";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-w="${f2(plot.w)}" role="img" aria-label="${esc(aria)}" ` +
    `font-family="${FONT_MAIN}" font-size="${FS}">${out.join("")}</svg>`;
  return { svg, errors: sortErrors(errors) };
}
