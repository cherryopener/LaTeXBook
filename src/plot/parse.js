// plot 블록 글자 → 그래프 설명(plot 객체). DOM 없음.
import { compileExpr, evalConst } from "./expr.js";

const KEYS = new Set(["x", "y", "grid", "w", "fill", "slope", "point", "xlabel", "ylabel", "xstep", "ystep"]);
export const DEFAULT_W = 70;

const unquote = (s) => s.replace(/[“”]/g, '"');

/** 줄 끝의 "이름표"를 떼어 낸다 */
function splitLabel(text) {
  const t = unquote(text);
  const i = t.indexOf('"');
  if (i < 0) return { body: t.trim(), label: null };
  const j = t.indexOf('"', i + 1);
  if (j < 0) return { body: t.slice(0, i).trim(), label: t.slice(i + 1).trim(), unclosed: true };
  return { body: t.slice(0, i).trim(), label: t.slice(i + 1, j), rest: t.slice(j + 1).trim() };
}

/** "a .. b" 범위. 식(pi 등)을 쓸 수 있다 */
function parseRange(text, what) {
  const i = text.indexOf("..");
  if (i < 0) return { error: `${what}: 범위는 "a .. b" 모양으로 써야 합니다("${text.trim()}")` };
  const l = evalConst(text.slice(0, i)), r = evalConst(text.slice(i + 2).replace(/^\./, ""));
  if (!l.ok) return { error: `${what}: 범위의 시작값 오류: ${l.error}` };
  if (!r.ok) return { error: `${what}: 범위의 끝값 오류: ${r.error}` };
  return { a: l.value, b: r.value, usesPi: /pi|π/i.test(text) };
}

/** 쉼표를 괄호 바깥에서만 나눈다 */
function splitTop(text) {
  const out = []; let d = 0, cur = "";
  for (const c of text) {
    if (c === "(") d++; if (c === ")") d--;
    if (c === "," && d === 0) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 줄 번호가 있는 오류는 번호 순, 줄 번호 없는 것은 뒤에(원래 순서 유지) */
export const sortErrors = (errs) => errs.map((e, i) => [e, i, /^(\d+)번째 줄/.exec(e)?.[1] ?? 1e9])
  .sort((a, b) => (a[2] === b[2] ? a[1] - b[1] : a[2] - b[2])).map((t) => t[0]);

/** @returns {{ok:boolean, plot?:Object, errors:string[]}} */
export function parsePlot(spec) {
  const errors = [];
  const plot = {
    x: null, y: null, xPi: false, yPi: false, grid: false, w: DEFAULT_W,
    xlabel: null, ylabel: null, xstep: null, ystep: null, funcs: [], fills: [], slopes: [], points: [],
  };
  const seen = new Set();
  const err = (n, msg) => errors.push(`${n}번째 줄: ${msg}`);
  const lines = String(spec ?? "").replace(/\r\n?/g, "\n").split("\n");
  const pending = []; // fill/slope는 함수가 다 정해진 뒤 검사

  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;

    // 이름 없이 "y = 식"만 쓴 줄
    let m = /^y\s*=\s*(.*)$/i.exec(line);
    let key, value;
    if (m) { key = ""; value = line; }
    else {
      m = /^([^\s:：]+)\s*[:：]\s*(.*)$/.exec(line);
      if (!m) return err(n, `"키: 값" 모양이 아닙니다("${line.slice(0, 20)}"). 예: x: 0 .. 5, f: y = 2x + 1`);
      key = m[1]; value = m[2];
    }
    const lk = key.toLowerCase();

    if (KEYS.has(lk) && !(lk === "y" && /^\s*y\s*=/.test(value))) {
      if (["x", "y", "grid", "w", "xlabel", "ylabel", "xstep", "ystep"].includes(lk)) {
        if (seen.has(lk)) err(n, `"${lk}:"가 두 번 나왔습니다. 뒤의 것을 씁니다`);
        seen.add(lk);
      }
      if (lk === "x" || lk === "y") {
        const r = parseRange(value, `${lk}`);
        if (r.error) return err(n, r.error);
        let { a, b } = r;
        if (a === b) return err(n, `${lk} 범위의 시작과 끝이 같습니다`);
        if (a > b) { err(n, `${lk} 범위의 시작값이 끝값보다 큽니다. 순서를 바꿔 그립니다`); [a, b] = [b, a]; }
        plot[lk] = [a, b];
        plot[lk + "Pi"] = r.usesPi;
      } else if (lk === "grid") {
        const v = value.trim().toLowerCase();
        if (["on", "켜기", "true", "예"].includes(v)) plot.grid = true;
        else if (["off", "끄기", "false", "아니오"].includes(v)) plot.grid = false;
        else err(n, `grid는 on 또는 off여야 합니다("${value.trim()}")`);
      } else if (lk === "w") {
        const v = parseFloat(value.replace("%", ""));
        if (!Number.isFinite(v) || !/^\s*[\d.]+\s*%?\s*$/.test(value)) err(n, `w는 숫자(단 너비 %)여야 합니다("${value.trim()}")`);
        else if (v < 20 || v > 100) err(n, `w는 20~100 사이여야 합니다(받은 값 ${v}). 기본값 ${DEFAULT_W}를 씁니다`);
        else plot.w = v;
      } else if (lk === "xstep" || lk === "ystep") {
        // 눈금 간격을 직접 정함(2026-11-12). 예: ystep: 100
        const v = Number(value.trim());
        if (!Number.isFinite(v) || v <= 0) err(n, `${lk}는 0보다 큰 수여야 합니다("${value.trim()}")`);
        else plot[lk] = v;
      } else if (lk === "xlabel" || lk === "ylabel") {
        const s = splitLabel(value);
        const t = (s.label ?? s.body).trim();
        plot[lk] = t === "" || t.toLowerCase() === "off" ? "" : t;
      } else if (lk === "fill") {
        pending.push({ n, kind: "fill", value });
      } else if (lk === "slope") {
        pending.push({ n, kind: "slope", value });
      } else if (lk === "point") {
        const s = splitLabel(value);
        const b = s.body.trim();
        if (!b.startsWith("(") || !b.endsWith(")")) return err(n, `point는 "(x, y) "이름"" 모양이어야 합니다`);
        const parts = splitTop(b.slice(1, -1));
        if (parts.length !== 2) return err(n, `점의 좌표는 (x, y) 두 값이어야 합니다("${b}")`);
        const px = evalConst(parts[0]), py = evalConst(parts[1]);
        if (!px.ok) return err(n, `점의 x 좌표 오류: ${px.error}`);
        if (!py.ok) return err(n, `점의 y 좌표 오류: ${py.error}`);
        plot.points.push({ x: px.value, y: py.value, label: s.label, line: n });
      }
      return;
    }

    // 함수 줄: 이름: y = 식 "이름표"
    const s = splitLabel(value);
    if (s.unclosed) err(n, `이름표의 닫는 따옴표(")가 없습니다`);
    let body = s.body, declared = null;
    const eq = /^(?:y|([a-zA-Z가-힣_]\w*)\s*\(\s*([a-zA-Z])\s*\))\s*=(?!=)\s*(.*)$/i.exec(body);
    if (eq) { body = eq[3]; declared = eq[2] ? eq[2].toLowerCase() : null; }
    else if (body.includes("=")) return err(n, `함수 식은 "y = 식" 모양이어야 합니다("${body.slice(0, 24)}")`);
    if (!body) return err(n, `함수 "${key || "y"}"의 식이 비어 있습니다`);
    const name = key || `f${plot.funcs.length + 1}`;
    if (plot.funcs.some((f) => f.name === name)) err(n, `함수 이름 "${name}"이 겹칩니다. 앞의 것을 가립니다`);
    const c = compileExpr(body, declared ? { variable: declared } : {});
    if (!c.ok) return err(n, `함수 "${name}"의 식 오류: ${c.error}`);
    const f = { name, expr: body, label: s.label, variable: c.variable, line: n };
    Object.defineProperty(f, "fn", { value: c.fn, enumerable: false });
    plot.funcs.push(f);
  });

  // 함수가 정해진 뒤에 fill·slope 검사
  const findFn = (name) => [...plot.funcs].reverse().find((f) => f.name === name);
  for (const p of pending) {
    const parts = splitTop(p.value).map((t) => t.trim());
    const rangeText = parts.pop() ?? "";
    const r = parseRange(rangeText, p.kind);
    if (r.error) { err(p.n, r.error); continue; }
    const names = parts.filter((t) => t !== "");
    const want = p.kind === "fill" ? [1, 2] : [1];
    if (!want.includes(names.length)) {
      err(p.n, p.kind === "fill" ? `fill은 "fill: 이름, a .. b" 또는 "fill: 이름1, 이름2, a .. b" 모양이어야 합니다` : `slope는 "slope: 이름, a .. b" 모양이어야 합니다`);
      continue;
    }
    const fs = names.map(findFn);
    const bad = names.find((nm, i) => !fs[i]);
    if (bad !== undefined) { err(p.n, `${p.kind}: "${bad}"라는 함수가 없습니다`); continue; }
    let { a, b } = r;
    if (a === b) { err(p.n, `${p.kind}: 구간의 시작과 끝이 같습니다`); continue; }
    if (a > b) { err(p.n, `${p.kind}: 구간의 시작값이 끝값보다 큽니다. 순서를 바꿔 그립니다`); [a, b] = [b, a]; }
    if (p.kind === "fill") plot.fills.push({ f: names[0], g: names[1] ?? null, a, b, line: p.n });
    else plot.slopes.push({ f: names[0], a, b, line: p.n });
  }
  plot.fills.sort((u, v) => u.line - v.line); plot.slopes.sort((u, v) => u.line - v.line);

  if (!plot.x) { errors.push("x 범위(x: a .. b)가 없습니다. -5 .. 5로 그립니다"); plot.x = [-5, 5]; plot.xDefault = true; }
  if (!plot.y) { errors.push("y 범위(y: a .. b)가 없습니다. 함수 값에 맞춰 자동으로 정합니다"); plot.yAuto = true; }
  if (!plot.funcs.length && !plot.points.length) errors.push("그릴 함수나 점이 없습니다(예: f: y = 2x + 1)");
  return { ok: errors.length === 0, plot, errors: sortErrors(errors) };
}
