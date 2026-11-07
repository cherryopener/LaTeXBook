// layout 시험용 견본 본문 HTML을 만든다(render 담당 B가 내놓을 모양을 손으로 흉내 냄, INTERFACES.md 6절).
// 실행: node tests/fixtures/layout-make.mjs → tests/fixtures/layout-teacher.html, layout-student.html
// 글은 시험용으로 새로 쓴 것이다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const katex = require("katex");
const dir = path.dirname(fileURLToPath(import.meta.url));

/** 견본 본문. edition: "teacher" | "student" */
export function makeBody(edition) {
  const T = edition === "teacher";
  let line = 1; // 가짜 원고 줄 번호
  const L = (n = 3) => `data-line="${(line += n)}"`;
  const m = (tex) => {
    const h = katex.renderToString(tex, { throwOnError: false });
    return /\\frac|\\dfrac|\\tfrac/.test(tex) ? h.replace('<span class="katex">', '<span class="katex has-frac">') : h;
  };
  const dm = (tex) => katex.renderToString(tex, { displayMode: true, throwOnError: false });
  const eq = (id, no, tex) => `<div class="eq" id="eq-${id}" data-no="${no}" ${L()}>${dm(`${tex}\\tag{${no}}`)}</div>`;
  // 빈칸: 글자마다 slot, 띄어쓰기는 gap
  const blank = (word) => {
    const inner = [...word].map((c) => (c === " " ? '<span class="gap"></span>' : `<span class="slot">${T ? c : ""}</span>`)).join("");
    return `<span class="blank ${T ? "answer" : "empty"}">${inner}</span>`;
  };
  const mblank = (tex) => `<span class="blank ${T ? "answer" : "empty"} math">${m(tex)}</span>`;
  const sol = (html) => (T && html ? `<div class="solution">${html}</div>` : "");
  const teacher = (html) => (T ? `<div class="teacher-only">${html}</div>` : "");
  const side = (title, html) => `<aside class="side" ${L()}><p class="side-title">${title}</p>${html}</aside>`;
  const callout = (kind, title, html) => `<aside class="callout ${kind}" ${L()}><p class="callout-title">${title}</p>${html}</aside>`;
  const P = (html) => `<p ${L()}>${html}</p>`;
  const head = (mode, no, title) => `<header class="chapter-head" data-mode="${mode}">
<nav class="tabs"><span class="tab tab-theory${mode === "theory" ? " on" : ""}">THEORY</span><span class="tab tab-problems${mode === "problems" ? " on" : ""}">PROBLEMS</span></nav>
<div class="band"><span class="chapter-no">${no}</span><h1 class="chapter-title">${title}</h1></div>
</header>`;
  const problem = (id, no, body, solution) => `<article class="problem" id="pr-${id}-${no}" ${L(8)}>
<div class="problem-no">${no}</div>
<div class="problem-body">${body}</div>
${sol(solution)}
</article>`;

  // 그림: 글자는 CSS 글꼴을 쓰도록 font-family를 쓰지 않는다
  const svgCar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 90">
<line x1="10" y1="70" x2="290" y2="70" stroke="#333" stroke-width="1.5"/>
${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="${30 + i * 40}" y1="65" x2="${30 + i * 40}" y2="75" stroke="#333"/><text x="${30 + i * 40}" y="88" font-size="11" text-anchor="middle">${i - 2}</text>`).join("")}
<circle cx="110" cy="50" r="9" fill="var(--plot-1, #1c6862)"/><circle cx="230" cy="50" r="9" fill="var(--plot-2, #0adead)"/>
<path d="M120 40 Q170 10 220 40" fill="none" stroke="var(--plot-3, #555)" stroke-width="1.5" marker-end="url(#a)"/>
<defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--plot-3, #555)"/></marker></defs>
<text x="170" y="18" font-size="12" text-anchor="middle">변위 Δx</text></svg>`;
  const svgGraph = (kind) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140">
<line x1="25" y1="120" x2="190" y2="120" stroke="#333"/><line x1="25" y1="120" x2="25" y2="10" stroke="#333"/>
<text x="185" y="135" font-size="11">t</text><text x="8" y="18" font-size="11">${kind}</text>
${kind === "v" ? `<polygon points="25,120 25,90 160,30 160,120" fill="var(--plot-fill, rgba(0,0,0,.1))"/><line x1="25" y1="90" x2="160" y2="30" stroke="var(--plot-1, #1c6862)" stroke-width="2.5"/>`
    : `<path d="M25 115 Q100 110 170 25" fill="none" stroke="var(--plot-2, #0adead)" stroke-width="2.5"/>`}
</svg>`;
  const svgCharge = (same) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
<circle cx="60" cy="40" r="16" fill="var(--plot-1, #1c6862)"/><text x="60" y="46" font-size="18" text-anchor="middle" fill="#fff">+</text>
<circle cx="140" cy="40" r="16" fill="${same ? "var(--plot-1, #1c6862)" : "var(--plot-2, #0adead)"}"/><text x="140" y="46" font-size="18" text-anchor="middle" fill="#fff">${same ? "+" : "−"}</text>
<line x1="${same ? 40 : 80}" y1="40" x2="${same ? 15 : 100}" y2="40" stroke="#333" stroke-width="2"/><line x1="${same ? 160 : 120}" y1="40" x2="${same ? 185 : 100}" y2="40" stroke="#333" stroke-width="2"/>
<text x="100" y="74" font-size="11" text-anchor="middle">${same ? "서로 밀어냄" : "서로 당김"}</text></svg>`;
  const svgSmall = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="5" y="10" width="45" height="30" rx="4" fill="var(--plot-fill, #ddd)" stroke="var(--plot-1, #333)"/><rect x="70" y="10" width="45" height="30" rx="4" fill="none" stroke="var(--plot-2, #333)"/><text x="27" y="30" font-size="10" text-anchor="middle">유리</text><text x="92" y="30" font-size="10" text-anchor="middle">비단</text></svg>`;

  const filler = (n, s) => Array.from({ length: n }, () => s).join(" ");

  // ---- 1부: 운동과 힘(붉은) ----
  const part1 = `<section class="part-cover" data-palette="red" data-part="1">
<div class="part-no">01</div>
<h1 class="part-title">운동과 힘</h1>
</section>
<section class="part-toc" data-palette="red" data-part="1">
<ol><li><span class="toc-no">1.</span> 속도와 가속도</li><li><span class="toc-no">2.</span> 힘과 운동</li></ol>
</section>`;

  const ch11 = `<section class="chapter" id="ch-1-1" data-palette="red" data-part="1" data-chapter="1" data-edition="${edition}">
<section class="theory">
${head("theory", 1, "속도와 가속도")}
<div class="theory-body">
<h2 class="sec" id="s-1-1-1" ${L()}><span class="sec-no">1.</span> 위치와 변위</h2>
<h3 class="sub" id="s-1-1-1-1" ${L()}><span class="sec-no">(1)</span> 기준점과 위치</h3>
${side("위치", `<p>기준점에서 물체까지의 방향과 거리를 함께 나타낸 양. 직선 위에서는 부호로 방향을 나타낸다.</p>`)}
${P(`물체가 어디에 있는지 말하려면 먼저 기준점을 정해야 한다. 직선 위에서 기준점의 오른쪽을 ${blank("+ 방향")}으로 정하면, 왼쪽에 있는 물체의 위치는 음수로 나타난다. 같은 물체라도 기준점을 어디에 두느냐에 따라 위치의 값은 달라지지만, 두 위치 사이의 차이는 기준점과 관계없이 같다.`)}
${P(`위치는 크기와 방향을 함께 가지므로 ${blank("벡터")}량이다. 이 장에서는 직선 위의 운동만 다루므로 방향을 부호 ${m("+")}, ${m("-")} 하나로 나타낸다.`)}
<figure class="fig" id="fig-numline" data-no="1.1" ${L()}><div class="fig-body" style="width:80%">${svgCar}</div><figcaption><span class="fig-no">그림 1.1</span> 수직선 위에서 움직인 물체의 변위</figcaption></figure>
<h3 class="sub" id="s-1-1-1-2" ${L()}><span class="sec-no">(2)</span> 변위</h3>
${side("변위", `<p>나중 위치에서 처음 위치를 뺀 값.</p><p>${m("\\Delta x = x_2 - x_1")}</p>`)}
${P(`처음 위치가 ${m("x_1")}이고 나중 위치가 ${m("x_2")}일 때, 위치의 변화량을 변위라 한다.`)}
${eq("disp", "1.1", "\\Delta x = x_2 - x_1")}
${P(`<a class="ref" href="#fig-numline">그림 1.1</a>에서 물체는 ${m("x_1 = 0")}에서 ${m("x_2 = 3\\,\\text{m}")}로 옮겨 갔으므로 변위는 식 <a class="ref" href="#eq-disp">(1.1)</a>에 따라 ${m("+3\\,\\text{m}")}이다. 이동 거리는 실제로 움직인 길의 길이이므로 왕복 운동에서는 변위와 다를 수 있다.`)}
${callout("warn", "주의", `<p>이동 거리는 언제나 ${m("0")} 이상이지만, 변위는 음수일 수 있다. 출발점으로 되돌아오면 변위는 ${m("0")}이다.</p>`)}
<h2 class="sec" id="s-1-1-2" ${L()}><span class="sec-no">2.</span> 속도</h2>
<h3 class="sub" id="s-1-1-2-1" ${L()}><span class="sec-no">(1)</span> 평균 속도</h3>
${side("속력", `<p>단위 시간 동안 움직인 거리. 방향이 없는 양이다.</p>`)}
${P(`걸린 시간 ${m("\\Delta t")} 동안의 변위를 시간으로 나눈 값을 평균 속도라 한다. 분수가 든 인라인 수식 ${m("\\bar v = \\frac{\\Delta x}{\\Delta t}")}처럼 줄 사이가 좁아도 윗줄과 겹치지 않아야 한다. ${filler(2, "평균 속도의 방향은 변위의 방향과 같고, 크기는 단위 시간 동안의 변위 크기이다.")}`)}
${eq("avgv", "1.2", "\\bar v = \\frac{\\Delta x}{\\Delta t} = \\frac{x_2 - x_1}{t_2 - t_1}")}
<div class="table-wrap" ${L()}><table><thead><tr><th>양</th><th>방향</th><th>단위</th></tr></thead><tbody><tr><td>이동 거리</td><td>없음</td><td>m</td></tr><tr><td>변위</td><td>있음</td><td>m</td></tr><tr><td>속력</td><td>없음</td><td>m/s</td></tr><tr><td>속도</td><td>있음</td><td>m/s</td></tr></tbody></table></div>
${callout("tip", "팁", `<p>단위를 꼭 함께 쓰자. ${m("1\\,\\text{m/s} = 3.6\\,\\text{km/h}")}이다.</p>`)}
<h3 class="sub" id="s-1-1-2-2" ${L()}><span class="sec-no">(2)</span> 순간 속도</h3>
${side("순간 속도", `<p>시간 간격을 매우 짧게 잡았을 때의 평균 속도. 위치-시간 그래프의 접선 기울기와 같다.</p>`)}
${P(`시간 간격을 아주 짧게 하면 평균 속도는 한 값에 가까워진다. 이 값을 그 순간의 속도라 한다. ${filler(3, "위치-시간 그래프에서 접선의 기울기가 순간 속도이며, 기울기가 클수록 빠르게 움직인다.")}`)}
<div class="figs" ${L()}>
<figure class="fig" id="fig-xt" data-no="1.2"><div class="fig-body">${svgGraph("x")}</div><figcaption><span class="fig-no">그림 1.2</span> 위치-시간 그래프</figcaption></figure>
<figure class="fig" id="fig-vt" data-no="1.3"><div class="fig-body">${svgGraph("v")}</div><figcaption><span class="fig-no">그림 1.3</span> 속도-시간 그래프</figcaption></figure>
</div>
<h2 class="sec" id="s-1-1-3" ${L()}><span class="sec-no">3.</span> 가속도</h2>
${side("가속도", `<p>단위 시간 동안의 속도 변화량.</p><p>${m("a = \\frac{\\Delta v}{\\Delta t}")}</p>`)}
${P(`속도가 일정하게 변하는 운동을 ${blank("등가속도 운동")}이라 한다. 처음 속도가 ${m("v_0")}이고 가속도가 ${m("a")}이면 시간 ${m("t")}가 지난 뒤의 속도는 ${mblank("v = v_0 + at")}이다.`)}
${P(`속도-시간 그래프에서 그래프 아래의 넓이는 변위와 같다. <mark>기울기는 가속도</mark>, 넓이는 변위라는 두 가지를 기억하자. ${filler(2, "그래프가 시간 축 아래에 있으면 그 부분의 넓이는 음의 변위를 뜻한다.")}`)}
<figure class="fig plot" data-no="" ${L()}><div class="fig-body" style="width:60%">${svgGraph("v")}</div></figure>
${dm("s = v_0 t + \\frac{1}{2} a t^2, \\qquad v^2 - v_0^2 = 2as")}
${callout("note", "참고", `<p>자유 낙하는 가속도가 <span class="c-red">${m("g \\approx 9.8\\,\\text{m/s}^2")}</span>인 등가속도 운동이다.</p>`)}
${teacher(`<p>교사용 메모: 부호 약속을 칠판에 먼저 적고 시작한다. 학생들이 자주 틀리는 곳은 감속 운동의 가속도 부호이다.</p>`)}
${side("등가속도 운동의 평균 속도", `<p>처음 속도와 나중 속도의 산술 평균과 같다.</p>`)}
${P(filler(4, "물체가 빗면을 따라 내려올 때처럼 가속도가 일정한 운동은 위의 세 식으로 모두 풀 수 있다. 어떤 식을 쓸지는 주어진 양과 구하는 양을 보고 정한다."))}
<ul ${L()}><li>시간이 주어지지 않으면 ${m("v^2 - v_0^2 = 2as")}를 쓴다.</li><li>나중 속도가 주어지지 않으면 ${m("s = v_0 t + \\frac{1}{2}at^2")}를 쓴다.</li></ul>
${P(filler(5, "속도와 가속도의 방향이 같으면 빨라지고, 반대이면 느려진다. 이때 느려지는 운동도 가속도가 있는 운동이다."))}
</div>
</section>
<section class="problems">
${head("problems", 1, "속도와 가속도")}
<div class="problem-list">
${problem("1-1", "001", `<p>직선 위에서 물체가 ${m("x = -2\\,\\text{m}")}에서 출발하여 ${m("x = 5\\,\\text{m}")}까지 갔다가 ${m("x = 1\\,\\text{m}")}로 돌아왔다.</p><p>(1) 물체의 변위를 구하시오.</p><div class="space" style="height:25mm"></div><p>(2) 물체의 이동 거리를 구하시오.</p>`,
    `<p>(1) ${m("1 - (-2) = 3\\,\\text{m}")} (2) ${m("7 + 4 = 11\\,\\text{m}")}</p>`)}
${problem("1-1", "002", `<p>정지해 있던 자동차가 ${m("2\\,\\text{m/s}^2")}의 가속도로 ${m("5")}초 동안 달렸다. 이 동안 이동한 거리를 구하시오.</p><figure class="fig"><div class="fig-body" style="width:70%">${svgGraph("v")}</div></figure>`,
    `<p>${m("s = \\frac{1}{2}at^2 = \\frac{1}{2}\\times 2 \\times 5^2 = 25\\,\\text{m}")}</p>`)}
${problem("1-1", "003", `<p>그림은 물체의 속도-시간 그래프이다. ${m("0")}초부터 ${m("4")}초까지의 평균 속도를 구하시오.</p><figure class="fig"><div class="fig-body" style="width:60%">${svgGraph("v")}</div></figure>`,
    `<p>그래프 아래 넓이가 변위이다. 변위를 시간으로 나누면 평균 속도이다.</p>`)}
${problem("1-1", "004", `<p>빈칸 시험: 속도의 변화량을 시간으로 나눈 값은 ${blank("가속도")}이다.</p>`, "")}
</div>
</section>
</section>`;

  // ---- 2부: 전기(청록) ----
  const part2 = `<section class="part-cover" data-palette="teal" data-part="2">
<div class="part-no">02</div>
<h1 class="part-title">전기</h1>
</section>
<section class="part-toc" data-palette="teal" data-part="2">
<ol><li><span class="toc-no">1.</span> 정전기</li></ol>
</section>`;

  const ch21 = `<section class="chapter" id="ch-2-1" data-palette="teal" data-part="2" data-chapter="1" data-edition="${edition}">
<section class="theory">
${head("theory", 1, "정전기")}
<div class="theory-body">
<h2 class="sec" id="s-2-1-1" ${L()}><span class="sec-no">1.</span> 전하</h2>
<h3 class="sub" id="s-2-1-1-1" ${L()}><span class="sec-no">(1)</span> 대전</h3>
${side("대전열", `<p>전자를 잃기 쉬운 순서로 물질을 늘어놓은 것.</p><figure class="fig" data-no=""><div class="fig-body" style="width:100%">${svgSmall}</div></figure>`)}
${P(`서로 다른 두 물체를 문지르면 전자가 한 물체에서 다른 물체로 옮겨 가며 두 물체가 전기를 띤다. 이를 ${blank("대전")}이라 한다. ${filler(2, "전자를 잃은 물체는 양전하를, 전자를 얻은 물체는 음전하를 띤다.")}`)}
<h3 class="sub" id="s-2-1-1-2" ${L()}><span class="sec-no">(2)</span> 전하량 보존</h3>
${side("기본 전하량", `<p>전자 하나의 전하량 크기. ${m("e \\approx 1.6\\times10^{-19}\\,\\text{C}")}</p>`)}
${P(`전자가 옮겨 갈 뿐 새로 생기거나 사라지지 않으므로, 두 물체의 전하량을 더한 값은 변하지 않는다. ${filler(3, "고립된 계에서 전하량의 합은 언제나 일정하게 유지된다.")}`)}
<h2 class="sec" id="s-2-1-2" ${L()}><span class="sec-no">2.</span> 쿨롱 법칙</h2>
${side("쿨롱 상수", `<p>${m("k \\approx 9\\times10^9\\,\\text{N·m}^2/\\text{C}^2")}</p>`)}
${P(`두 점전하 사이의 전기력은 전하량의 곱에 비례하고, 거리의 제곱에 반비례한다.`)}
${eq("coulomb", "1.1", "F = k\\frac{q_1 q_2}{r^2}")}
<div class="figs" ${L()}>
<figure class="fig" id="fig-unlike" data-no="1.1"><div class="fig-body">${svgCharge(false)}</div><figcaption><span class="fig-no">그림 1.1</span> 다른 종류의 전하</figcaption></figure>
<figure class="fig" id="fig-like" data-no="1.2"><div class="fig-body">${svgCharge(true)}</div><figcaption><span class="fig-no">그림 1.2</span> 같은 종류의 전하</figcaption></figure>
</div>
${P(`<a class="ref" href="#fig-unlike">그림 1.1</a>처럼 다른 종류의 전하는 서로 당기고, <a class="ref" href="#fig-like">그림 1.2</a>처럼 같은 종류의 전하는 서로 밀어낸다. 식 <a class="ref" href="#eq-coulomb">(1.1)</a>에서 ${m("k")}는 쿨롱 상수이다.`)}
${callout("think", "생각해 보기", `<p>거리가 절반으로 줄면 전기력은 몇 배가 될까? ${mblank("4")}배</p>`)}
${P(filler(4, "전기력은 두 전하를 잇는 직선 방향으로 작용하며, 작용 반작용 법칙에 따라 두 전하가 받는 힘의 크기는 같다."))}
</div>
</section>
<section class="problems">
${head("problems", 1, "정전기")}
<div class="problem-list">
${problem("2-1", "001", `<p>두 점전하 사이의 거리를 2배로 늘리면 전기력은 몇 배가 되는지 구하시오.</p>`, `<p>${m("F \\propto 1/r^2")} 이므로 ${m("\\tfrac{1}{4}")} 배이다.</p>`)}
${problem("2-1", "002", `<p>해설이 단을 넘치는지 시험하는 문항이다.</p>`, `<p>이 해설은 일부러 길게 쓴다. 해설이 단을 넘치면 편집기가 경고를 내야 한다.</p><div class="space" style="height:230mm"></div><p>끝.</p>`)}
${problem("2-1", "003", `<p>대전된 막대를 검전기에 가까이 하면 금속박이 벌어지는 까닭을 쓰시오.</p><div class="space" style="height:20mm"></div>`, `<p>정전기 유도로 금속박에 같은 종류의 전하가 모여 서로 밀어내기 때문이다.</p>`)}
</div>
</section>
</section>`;

  return [part1, ch11, part2, ch21].join("\n");
}

/** 같은 쪽 안에서 왼쪽 단 → 오른쪽 단으로 해설이 넘치는 경우(교사용) */
export function makeOverflowBody() {
  const head = (mode) => `<header class="chapter-head" data-mode="${mode}"><nav class="tabs"><span class="tab tab-theory${mode === "theory" ? " on" : ""}">THEORY</span><span class="tab tab-problems${mode === "problems" ? " on" : ""}">PROBLEMS</span></nav><div class="band"><span class="chapter-no">3</span><h1 class="chapter-title">넘침 시험</h1></div></header>`;
  return `<section class="chapter" id="ch-1-3" data-palette="teal" data-part="1" data-chapter="3" data-edition="teacher">
<section class="theory">${head("theory")}<div class="theory-body"><p data-line="5">개념 한 줄.</p></div></section>
<section class="problems">${head("problems")}<div class="problem-list">
<article class="problem" id="pr-1-3-001" data-line="10"><div class="problem-no">001</div><div class="problem-body"><p>왼쪽 단에서 시작한 해설이 오른쪽 단으로 넘친다.</p></div><div class="solution"><p>길게.</p><div class="space" style="height:215mm"></div><p>끝.</p></div></article>
<article class="problem" id="pr-1-3-002" data-line="20"><div class="problem-no">002</div><div class="problem-body"><p>짧은 문항.</p></div><div class="solution"><p>짧은 해설.</p></div></article>
</div></section>
</section>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const ed of ["teacher", "student"]) {
    fs.writeFileSync(path.join(dir, `layout-${ed}.html`), `<!-- node tests/fixtures/layout-make.mjs 로 만든 견본 본문(${ed}) -->\n${makeBody(ed)}\n`);
  }
  fs.writeFileSync(path.join(dir, "layout-overflow.html"), `<!-- node tests/fixtures/layout-make.mjs 로 만든 넘침 시험 본문 -->\n${makeOverflowBody()}\n`);
  console.log("만듦: layout-teacher.html, layout-student.html, layout-overflow.html");
}
