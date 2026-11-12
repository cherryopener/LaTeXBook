// plot 모듈 시험(Node). 실패하면 종료 코드 1. 실행: node tests/plot.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlot, renderPlot, svgToPng, compileExpr, evalConst } from "../src/plot/index.js";
import { parseRich } from "../src/plot/rich.js";
import { EXAMPLES } from "./fixtures/plot-examples.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0, total = 0;
function test(name, fn) {
  total++;
  try { fn(); }
  catch (e) { failed++; console.log(`  실패: ${name}\n    ${String(e.message).split("\n").join("\n    ")}`); }
}
const ok = (c, msg = "조건이 거짓") => { if (!c) throw new Error(msg); };
const near = (a, b, eps = 1e-9, msg = "") => { if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} 기대 ${b}, 실제 ${a}`); };
const text = (svg) => svg.replace(/<[^>]*>/g, "");
const hangul = (s) => /[가-힣]/.test(s);
const val = (src, x = 0) => { const c = compileExpr(src); if (!c.ok) throw new Error(`"${src}" 해석 실패: ${c.error}`); return c.fn(x); };

// ----- 식 해석 -----
test("곱셈 생략", () => {
  near(val("2x", 3), 6); near(val("3(x+1)", 2), 9); near(val("2pi"), 2 * Math.PI);
  near(val("x sin x", 2), 2 * Math.sin(2)); near(val("(x+1)(x-1)", 3), 8); near(val("2x^2", 3), 18);
  near(val("x(x+1)", 2), 6); near(val("2 pi x", 1), 2 * Math.PI); near(val("xe", 2), 2 * Math.E);
});
test("연산 우선순위", () => {
  near(val("1+2*3"), 7); near(val("(1+2)*3"), 9); near(val("2^3^2"), 512); near(val("-x^2", 3), -9);
  near(val("(-x)^2", 3), 9); near(val("2^-1"), 0.5); near(val("10-4-3"), 3); near(val("8/4/2"), 1);
  near(val("1/2x", 4), 2, 1e-12, "1/2x는 (1/2)x"); near(val("x^2/2", 4), 8); near(val("--x", 2), 2); near(val("-2^2"), -4);
});
test("함수와 상수", () => {
  near(val("sin(pi/2)"), 1); near(val("cos 0"), 1); near(val("tan(pi/4)"), 1, 1e-12); near(val("sqrt(16)"), 4);
  near(val("exp(1)"), Math.E); near(val("ln(e)"), 1); near(val("abs(-3)"), 3); near(val("e^2"), Math.E ** 2);
  near(val("sin 2x", 1), Math.sin(2)); near(val("sin x^2", 2), Math.sin(4)); near(val("sin x cos x", 1), Math.sin(1) * Math.cos(1));
  near(val("sin(x)^2", 1), Math.sin(1) ** 2); near(val("sqrt x + 1", 4), 3); near(val("2sin(x)", 1), 2 * Math.sin(1));
  near(val("π"), Math.PI); near(val("x²+1", 3), 10); near(val("2 × 3 ÷ 4"), 1.5); near(val("3 − 1"), 2); near(val("X+1", 1), 2);
  near(val("1.5x", 2), 3); near(val(".5+.25"), 0.75);
});
test("정의 안 되는 값은 NaN/무한", () => {
  ok(Number.isNaN(val("sqrt(x)", -1))); ok(Number.isNaN(val("ln x", -1))); ok(!Number.isFinite(val("1/x", 0)));
});
test("변수 글자: t 등은 x 대신으로 인정", () => {
  const c = compileExpr("2t + 2"); ok(c.ok && c.variable === "t"); near(c.fn(3), 8);
  ok(compileExpr("2x + t").ok === false, "x와 t를 섞으면 오류");
  ok(compileExpr("2x + 2").variable === "x");
});
test("식 오류는 한국어 문장", () => {
  for (const bad of ["", "2x +", "(x+1", "x+1)", "foo(x)", "2 3", "sin", "x $ 2", "()", "x^", "*3", "2..3x"]) {
    const c = compileExpr(bad);
    ok(c.ok === false, `"${bad}"가 오류여야 함`);
    ok(hangul(c.error), `한국어 메시지여야 함: ${c.error}`);
  }
  ok(compileExpr("x".repeat(500)).ok === false, "너무 긴 식은 거부");
  ok(compileExpr("(".repeat(100) + "x" + ")".repeat(100)).ok === false, "너무 깊은 괄호는 거부");
});
test("상수식(evalConst)", () => {
  near(evalConst("2pi").value, 2 * Math.PI); near(evalConst("-1.5").value, -1.5);
  ok(evalConst("x").ok === false); ok(evalConst("1/0").ok === false);
});
test("eval·Function을 쓰지 않는다", () => {
  for (const f of ["expr.js", "parse.js", "render.js", "rich.js", "geom.js", "png.js", "index.js"]) {
    const src = fs.readFileSync(path.join(here, "../src/plot", f), "utf8").replace(/\/\/.*$/gm, "");
    ok(!/\beval\s*\(/.test(src) && !/new\s+Function|\bFunction\s*\(/.test(src), `${f}에 eval/Function`);
    if (f !== "png.js") ok(!/\b(document|window)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), `${f}에서 DOM 사용`);
  }
});

// ----- 블록 해석 -----
const SAMPLE = fs.readFileSync(path.join(here, "../samples/sample-book/1-mechanics/01-velocity.md"), "utf8").match(/```plot\n([\s\S]*?)```/)[1];
test("견본 원고의 plot 블록", () => {
  const r = parsePlot(SAMPLE);
  ok(r.ok, `오류: ${r.errors}`);
  const p = r.plot;
  ok(p.x[0] === 0 && p.x[1] === 5 && p.y[0] === 0 && p.y[1] === 12);
  ok(p.funcs.length === 1 && p.funcs[0].name === "v" && p.funcs[0].label === "v = 2t + 2");
  ok(p.fills.length === 1 && p.fills[0].f === "v" && p.fills[0].g === null && p.fills[0].a === 0 && p.fills[0].b === 4);
  ok(p.slopes.length === 1 && p.slopes[0].a === 1 && p.slopes[0].b === 3);
  ok(p.points.length === 1 && p.points[0].x === 0 && p.points[0].y === 2 && p.points[0].label === "v₀");
  ok(p.w === 60 && p.grid === false);
  near(p.funcs[0].fn(1), 4);
  ok(!("fn" in JSON.parse(JSON.stringify(p)).funcs[0]), "plot 객체는 JSON으로 직렬화 가능해야 함");
});
test("FORMAT.md 3-9절 예시", () => {
  const spec = EXAMPLES.find((e) => e.name === "spec-format").spec;
  const r = parsePlot(spec);
  ok(r.ok, r.errors.join("/"));
  ok(r.plot.funcs.map((f) => f.name).join() === "f,g" && r.plot.w === 70);
  ok(r.plot.funcs[0].label === "y=2x+1" && r.plot.funcs[1].label === null);
});
test("fill 두 함수 사이, grid, 이름 없는 함수, 이름표 없는 점", () => {
  const r = parsePlot("x: -1 .. 3\ny: 0 .. 9\ny = x^2\nf: y = 2x + 3\nfill: f1, f, 0 .. 2\ngrid: on\npoint: (1, 2)");
  ok(r.ok, r.errors.join("/"));
  ok(r.plot.funcs[0].name === "f1" && r.plot.fills[0].g === "f" && r.plot.grid === true && r.plot.points[0].label === null);
});
test("범위에 식(2pi)과 소수", () => {
  const r = parsePlot("x: -2pi .. 2pi\ny: -1.5 .. 1.5\nf: y = sin x");
  ok(r.ok); near(r.plot.x[1], 2 * Math.PI); ok(r.plot.xPi === true);
  const r2 = parsePlot("x: 0.5..2.5\ny: 0..1\nf: y = x");
  ok(r2.ok && r2.plot.x[0] === 0.5 && r2.plot.x[1] === 2.5, r2.errors.join("/"));
});
test("t 변수와 f(t) = 형태", () => {
  const r = parsePlot("x: 0 .. 5\ny: 0 .. 12\nv: y = 2t + 2\nu: u(t) = 3t");
  ok(r.ok, r.errors.join("/")); ok(r.plot.funcs[0].variable === "t"); near(r.plot.funcs[1].fn(2), 6);
});
test("오류: 줄 번호가 붙은 한국어 문장, 그릴 수 있는 만큼 그림", () => {
  const spec = "x: 0 .. 5\ny: 0 .. 10\nf: y = 2x +\ng: y = x\nfill: z, 0 .. 2\nslope: g, 3 .. 3\npoint: (1)\nw: abc\nh = 3\nzzz";
  const r = parsePlot(spec);
  ok(r.ok === false && r.errors.length >= 6, r.errors.join("/"));
  ok(r.errors.every(hangul), "모든 오류가 한국어");
  ok(r.errors.some((e) => e.startsWith("3번째 줄")), "식 오류는 3번째 줄");
  ok(r.errors.some((e) => e.startsWith("5번째 줄") && e.includes("z")), "fill 오류는 5번째 줄");
  ok(r.errors.some((e) => e.startsWith("7번째 줄")) && r.errors.some((e) => e.startsWith("8번째 줄")));
  const lines = r.errors.map((e) => +/^(\d+)번째/.exec(e)?.[1]).filter(Boolean);
  ok(lines.join() === [...lines].sort((a, b) => a - b).join(), "줄 번호 순");
  const out = renderPlot(spec, { palette: "teal" });
  ok(out.svg.startsWith("<svg") && out.svg.endsWith("</svg>") && out.svg.includes('stroke="var(--plot-1'), "g는 그려야 함");
  ok(out.errors.length >= 6);
});
test("x·y 범위 빠짐/뒤집힘/같음", () => {
  const a = parsePlot("f: y = x");
  ok(!a.ok && a.errors.some((e) => e.includes("x 범위")) && a.errors.some((e) => e.includes("y 범위")));
  const b = parsePlot("x: 5 .. 0\ny: 0 .. 5\nf: y = x");
  ok(!b.ok && b.plot.x[0] === 0 && b.plot.x[1] === 5 && b.errors[0].startsWith("1번째 줄"));
  ok(!parsePlot("x: 1 .. 1\ny: 0 .. 1\nf: y = x").ok);
  ok(!parsePlot("x: 0 .. 1\nx: 0 .. 2\ny: 0 .. 1\nf: y = x").ok, "중복 지정");
});
test("빈 입력·잡음 입력에도 예외 없음", () => {
  for (const s of ["", "   \n\n", "```", "x:", ":::", "f: y =", 'f: y = x "미완', "fill:", "point:", "slope: , ,", "\u0000\u0001", "x: .. ..", "y = ", "f: y = ((((", "w: 1e9"]) {
    const r = renderPlot(s, { palette: "teal" });
    ok(typeof r.svg === "string" && r.svg.startsWith("<svg") && Array.isArray(r.errors), `입력 ${JSON.stringify(s)}`);
  }
  ok(renderPlot(undefined, { palette: "red" }).svg.startsWith("<svg"));
  ok(renderPlot("x: 0 .. 1\ny: 0 .. 1\nf: y = x").svg.includes("#1c6862"), "palette 생략 시 teal");
});

// ----- SVG 결과 -----
const strokeCount = (svg) => (svg.match(/stroke-width="[\d.]+"/g) ?? []).map((s) => parseFloat(s.slice(14)));
function balanced(svg) { // 태그 짝 검사(간이)
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}
test("SVG 모양: viewBox, 폭 미지정, id 없음, foreignObject·script 없음", () => {
  for (const ex of EXAMPLES) {
    const { svg } = renderPlot(ex.spec, { palette: ex.palette });
    ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/.test(svg), `${ex.name}: 시작 모양`);
    const root = svg.slice(0, svg.indexOf(">"));
    ok(!/\swidth=|\sheight=/.test(root), `${ex.name}: 루트에 width/height`);
    ok(!/\sid="|url\(#|<foreignObject|<script|<style|<image/.test(svg), `${ex.name}: 금지 요소`);
    ok(balanced(svg), `${ex.name}: 태그 짝`);
    ok(!/NaN|Infinity|undefined/.test(svg), `${ex.name}: 숫자 오류`);
    ok(strokeCount(svg).every((w) => w >= 0.9), `${ex.name}: 선이 너무 가늘다 ${strokeCount(svg)}`);
  }
});
test("w는 data-w로 알려 주고, 글자 크기가 종이에서 일정하도록 그림 너비가 w에 비례", () => {
  const vb = (w) => { const s = renderPlot(`x: 0 .. 1\ny: 0 .. 1\nf: y = x${w ? `\nw: ${w}` : ""}`).svg; return [/data-w="([\d.]+)"/.exec(s)[1], +/viewBox="0 0 ([\d.]+)/.exec(s)[1]]; };
  ok(vb()[0] === "70" && vb(40)[0] === "40" && vb(60)[0] === "60");
  ok(vb(40)[1] < vb(70)[1] && vb(70)[1] < vb(100)[1]);
});
test("색: 변수 + 대체 색, palette별 대체 색", () => {
  const t = renderPlot(SAMPLE, { palette: "teal" }).svg, r = renderPlot(SAMPLE, { palette: "red" }).svg;
  ok(t.includes('stroke="var(--plot-1, #1c6862)"') && t.includes("var(--plot-fill, rgba(28,104,98"));
  ok(r.includes('stroke="var(--plot-1, #690000)"') && !r.includes("#1c6862") && r.includes("var(--plot-fill, rgba(105,0,0"));
  ok(!t.includes("#690000"));
  const four = renderPlot(EXAMPLES.find((e) => e.name === "four-curves").spec, { palette: "teal" }).svg;
  for (const i of [1, 2, 3, 4]) ok(four.includes(`var(--plot-${i},`), `--plot-${i}`);
});
test("결정성: 같은 입력이면 같은 출력", () => {
  for (const ex of EXAMPLES) {
    const a = renderPlot(ex.spec, { palette: ex.palette }), b = renderPlot(ex.spec, { palette: ex.palette });
    ok(a.svg === b.svg && JSON.stringify(a.errors) === JSON.stringify(b.errors), ex.name);
  }
});
test("그래프 여러 개를 한 문서에 넣어도 id 충돌 없음(id를 쓰지 않음)", () => {
  const html = EXAMPLES.map((e) => renderPlot(e.spec, { palette: e.palette }).svg).join("\n");
  ok(!/\sid=/.test(html));
});

/** SVG 첫 번째 stroke 곡선 path들의 좌표를 모두 읽는다 */
const coords = (d) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
const curvePaths = (svg) => [...svg.matchAll(/<path d="([^"]+)" fill="none" stroke="var\(--plot-\d[^"]*" stroke-width="2"/g)].map((m) => m[1]);
const viewBox = (svg) => /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg).slice(1).map(Number);

test("범위 밖은 잘라낸다: 곡선이 그림 영역 안에 있다", () => {
  const { svg } = renderPlot("x: -2 .. 2\ny: 0 .. 3\nf: y = x^2\ng: y = 10x", { palette: "teal" });
  const [W, H] = viewBox(svg);
  const paths = curvePaths(svg);
  ok(paths.length === 2);
  // 영역: 가로 L..R, 세로 T..B. 축 화살표 위치로 영역을 알아낸다(여백 안쪽이면 충분)
  for (const d of paths) for (const [x, y] of coords(d)) ok(x >= 0 && x <= W && y >= 0 && y <= H, `밖의 점 ${x},${y}`);
  // y=x²는 y>3에서 잘려 곡선 위쪽 끝이 영역 위 가장자리에 있다
  const ys = coords(paths[0]).map((p) => p[1]);
  const topEdge = Math.min(...coords(paths[1]).map((p) => p[1]));
  near(Math.min(...ys), topEdge, 0.02, "x² 위쪽 가장자리");
});
test("불연속(tan, 1/x)에서 선을 잇지 않는다", () => {
  const tan = renderPlot("x: -2pi .. 2pi\ny: -4 .. 4\nf: y = tan x", { palette: "teal" }).svg;
  const d = curvePaths(tan)[0];
  ok((d.match(/M/g) ?? []).length === 5, `조각 수 ${(d.match(/M/g) ?? []).length} (기대 5)`);
  const inv = renderPlot("x: -4 .. 4\ny: -4 .. 4\nf: y = 1/x", { palette: "teal" }).svg;
  ok((curvePaths(inv)[0].match(/M/g) ?? []).length === 2, "1/x는 두 조각");
  const sq = renderPlot("x: -4 .. 4\ny: -1 .. 3\nf: y = sqrt(x)\ng: y = ln(x)", { palette: "teal" });
  ok(sq.errors.length === 0, sq.errors.join("/")); ok(curvePaths(sq.svg).length === 2, "정의역 밖은 그리지 않되 오류는 아님");
});
test("완전히 범위 밖이거나 값이 없는 함수는 알린다", () => {
  const a = renderPlot("x: 0 .. 5\ny: 0 .. 5\nf: y = 100 + x");
  ok(a.errors.some((e) => e.includes("y 범위 밖")), a.errors.join("/"));
  const b = renderPlot("x: 1 .. 5\ny: 0 .. 5\nf: y = sqrt(-x)");
  ok(b.errors.some((e) => e.includes("값을 구할 수 없")), b.errors.join("/"));
});
test("칠하기: x축과 사이, 두 함수 사이, 범위 밖 잘림", () => {
  const one = renderPlot("x: 0 .. 4\ny: 0 .. 10\nf: y = 2x + 1\nfill: f, 1 .. 3", { palette: "teal" });
  const m = /<path d="([^"]+Z)" fill="var\(--plot-fill/.exec(one.svg);
  ok(m, "칠하기 path 없음");
  ok(m[1].startsWith("M") && m[1].endsWith("Z"));
  ok(coords(m[1]).length === 4, `사다리꼴 꼭짓점 4개여야 함: ${m[1]}`);
  const two = renderPlot("x: 0 .. 4\ny: 0 .. 10\nf: y = 2x + 1\ng: y = x\nfill: f, g, 0 .. 4", { palette: "red" });
  ok(/fill="var\(--plot-fill, rgba\(105,0,0/.test(two.svg) && coords(/<path d="([^"]+Z)" fill="var\(--plot-fill/.exec(two.svg)[1]).length === 4);
  const cut = renderPlot("x: 0 .. 4\ny: 0 .. 4\nf: y = 2x\nfill: f, 0 .. 10", { palette: "teal" });
  const [W, H] = viewBox(cut.svg);
  for (const [x, y] of coords(/<path d="([^"]+Z)" fill="var\(--plot-fill/.exec(cut.svg)[1])) ok(x <= W && y >= 0 && y <= H);
  ok(cut.errors.length === 0, cut.errors.join("/"));
  const none = renderPlot("x: 0 .. 4\ny: 0 .. 4\nf: y = x\nfill: f, 8 .. 9");
  ok(none.errors.some((e) => e.includes("칠할 구간")) && !none.svg.includes("--plot-fill"));
});
test("기울기 삼각형: 점선과 Δx, Δy 이름표", () => {
  const { svg, errors } = renderPlot("x: 0 .. 5\ny: 0 .. 12\nv: y = 2x + 2\nslope: v, 1 .. 3", { palette: "teal" });
  ok(errors.length === 0, errors.join("/"));
  ok(svg.includes('stroke-dasharray="'), "점선");
  const t = text(svg);
  ok(t.includes("Δx = 2") && t.includes("Δy = 4"), `이름표: ${t}`);
  const down = renderPlot("x: 0 .. 10\ny: -10 .. 10\nf: y = 5 - 2x\nslope: f, 1 .. 4", { palette: "teal" });
  ok(text(down.svg).includes("Δy = −6"), "음수는 − 기호");
  // 곡선이면 빗변(할선)도 점선으로
  const q = renderPlot("x: 0 .. 4\ny: 0 .. 9\nf: y = x^2\nslope: f, 1 .. 3");
  const dash = (s) => /stroke-dasharray[^>]*>/.exec(s) && /<path d="([^"]+)"[^>]*stroke-dasharray/.exec(s)[1];
  const lin = renderPlot("x: 0 .. 4\ny: 0 .. 9\nf: y = x\nslope: f, 1 .. 3");
  ok((dash(q.svg).match(/M/g) ?? []).length > (dash(lin.svg).match(/M/g) ?? []).length, "곡선은 빗변이 더해짐");
});
test("점과 이름표, 범위 밖 점", () => {
  const a = renderPlot("x: 0 .. 5\ny: 0 .. 5\nf: y = x\npoint: (2, 2) \"교점\"");
  ok(a.errors.length === 0 && a.svg.includes("<circle") && text(a.svg).includes("교점"));
  const b = renderPlot("x: 0 .. 5\ny: 0 .. 5\nf: y = x\npoint: (9, 2) \"밖\"");
  ok(b.errors.some((e) => e.includes("범위 밖")) && !b.svg.includes("<circle"));
  const c = renderPlot("x: 0 .. 2pi\ny: -1 .. 1\nf: y = sin x\npoint: (pi/2, 1) \"최댓값\"");
  ok(c.errors.length === 0 && c.svg.includes("<circle"));
});
test("축: 화살표, 눈금 숫자, 원점 O, grid", () => {
  const off = renderPlot("x: -2 .. 2\ny: -2 .. 2\nf: y = x").svg, on = renderPlot("x: -2 .. 2\ny: -2 .. 2\ngrid: on\nf: y = x").svg;
  ok(on.length > off.length && /stroke-opacity="0\.2"/.test(on) && !/stroke-opacity="0\.2"/.test(off), "grid on일 때만 눈금선");
  const t = text(off);
  ok(t.includes("O") && t.includes("−2") && t.includes("2") && t.includes("x") && t.includes("y"), `눈금 글자: ${t}`);
  ok(/<path d="M[^"]+Z[^"]*Z" fill="currentColor"/.test(off) || (off.match(/Z/g) ?? []).length >= 2, "화살촉");
  const pi = text(renderPlot("x: 0 .. 2pi\ny: -1 .. 1\nf: y = sin x").svg);
  ok(pi.includes("π") && pi.includes("2π"), `π 눈금: ${pi}`);
  const noO = text(renderPlot("x: 1 .. 5\ny: 1 .. 5\nf: y = x").svg);
  ok(!/O/.test(noO), "원점이 범위 밖이면 O 없음");
  const custom = text(renderPlot("x: 0 .. 5\ny: 0 .. 5\nxlabel: t\nylabel: v\nf: y = x").svg);
  ok(custom.endsWith("tv") || (custom.includes("t") && custom.includes("v")));
  const none = renderPlot("x: 0 .. 5\ny: 0 .. 5\nxlabel: off\nylabel: off\nf: y = x");
  ok(!/>x<|>y</.test(none.svg), "라벨 끄기");
});
test("눈금 간격이 자동으로 알맞다", () => {
  const labels = (spec) => text(renderPlot(spec).svg);
  const big = labels("x: 0 .. 1000\ny: 0 .. 1\nf: y = 0");
  ok(/200/.test(big) || /250/.test(big) || /500/.test(big), big);
  ok(!/0\.30000000/.test(labels("x: 0 .. 1\ny: 0 .. 1\nf: y = x")), "부동소수점 잡음 없음");
  ok(text(renderPlot("x: 0 .. 1\ny: 0 .. 1\nf: y = x").svg).includes("0.5"));
});

// ----- 이름표 글자 -----
test("이름표: 첨자·기울임", () => {
  const sub = (s) => JSON.stringify(parseRich(s));
  ok(sub("v_0") === sub("v₀") && sub("v_0") === sub("v_{0}"), "아래첨자 표기가 같다");
  const segs = parseRich("v_0 = v_{max} + t^2");
  ok(segs[0].it === true && segs[0].t === "v" && segs[1].sh === 1 && segs[1].t === "0");
  ok(segs.some((s) => s.t === "max" && s.sh === 1 && !s.it), "max는 곧게");
  ok(segs.some((s) => s.t === "2" && s.sh === -1), "위첨자");
  ok(parseRich("sin x").some((s) => s.t.startsWith("sin") && !s.it) && parseRich("y절편").some((s) => /절편/.test(s.t) && !s.it));
  ok(parseRich("Δx")[0].t === "Δ" && parseRich("Δx")[0].it === false, "큰 그리스 글자는 곧게");
  ok(parseRich("\\Delta t")[0].t.startsWith("Δ") && parseRich("\\omega")[0].it === true);
  ok(parseRich("\\mathrm{kg}")[0].it === false && parseRich("a-b").some((s) => s.t === "−"), "kg 곧게, 빼기는 −");
  const svg = renderPlot('x: 0 .. 5\ny: 0 .. 5\nf: y = x "v_0 + at^2"').svg;
  ok(/<tspan dy="[\d.]+" font-size="[\d.]+">0<\/tspan>/.test(svg), "아래첨자는 dy+작은 글자");
  ok(svg.includes('font-style="italic"') && svg.includes("KaTeX_Main") && svg.includes("Noto Serif KR"));
  ok(!renderPlot('x: 0 .. 5\ny: 0 .. 5\nf: y = x "a<b & \\"c"').svg.includes("<b "), "특수문자는 이스케이프");
});

// ----- svgToPng -----
test("svgToPng는 함수(브라우저 전용: Node에서는 거부)", () => {
  ok(typeof svgToPng === "function");
});
test("xstep·ystep: 눈금 간격을 직접 정함(2026-11-12)", () => {
  const r = renderPlot("x: 0 .. 5\ny: 0 .. 300\nf: y = 60x\nxstep: 1\nystep: 100\nw: 50", { palette: "teal", scale: 84.5 / 132 });
  const t = text(r.svg);
  for (const s of ["1", "2", "3", "4", "5", "100", "200", "300"]) ok(t.includes(s), `눈금 ${s}`);
  ok(!r.errors.length, r.errors.join(","));
  ok(parsePlot("x: 0 .. 1\ny: 0 .. 1\nf: y = x\nystep: -2").errors.some((e) => e.includes("ystep")), "음수 간격은 오류");
});

total++;
await svgToPng("<svg viewBox=\"0 0 10 10\"></svg>").then(
  () => { failed++; console.log("  실패: Node에서 svgToPng가 성공함(브라우저 전용이어야 함)"); },
  () => {},
);

console.log(`plot 시험: ${total - failed}/${total} 통과`);
process.exit(failed ? 1 : 0);
