// 원고 변환(render) 시험: 견본 3개 장을 교사용·학생용으로 변환해 samples/README.md의 기대 결과를 HTML 구조로 확인
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderChapter, renderBook, exportPhysiklar } from "../src/render/index.js";
import { withPrintDefaults, partPalette } from "../src/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOK = path.join(ROOT, "samples/sample-book");
const OUT = path.join(ROOT, "out/render");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log("  실패:", name, extra === undefined ? "" : JSON.stringify(extra)); }
}
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });
const count = (s, re) => (s.match(re) ?? []).length;
const all = (s, re) => [...s.matchAll(re)].map((m) => m[1]);
// KaTeX 내용·SVG·코드를 걷어 낸 글자(남은 디렉티브 확인용)
const plain = (h) => h.replace(/<span class="katex[\s\S]*?<\/annotation>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<code>[\s\S]*?<\/code>/g, "");

const bookConfig = JSON.parse(fs.readFileSync(path.join(BOOK, "book.json"), "utf8"));
const print = withPrintDefaults(bookConfig);
const exists = (src) => fs.existsSync(path.join(BOOK, src));
const FAKE_SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs><g clip-path="url(#clip)"><line x1="0" y1="0" x2="10" y2="10"/></g></svg>';
const fakePlot = (spec, opts) => ({ svg: FAKE_SVG.replace("<line", `<line data-palette="${opts.palette}"`), errors: [] });
const base = {
  resolveAsset: (src) => (exists(src) ? "/samples/sample-book/" + src : null),
  readSvg: (src) => (exists(src) ? fs.readFileSync(path.join(BOOK, src), "utf8") : null),
  plot: fakePlot,
};
const read = (p) => fs.readFileSync(path.join(BOOK, p), "utf8");
const chapters = [
  { key: "1-1", file: "1-mechanics/01-velocity.md", partNo: 1, chapterNo: 1, palette: "red" },
  { key: "1-2", file: "1-mechanics/02-force.md", partNo: 1, chapterNo: 2, palette: "red" },
  { key: "2-1", file: "2-electricity/01-charge.md", partNo: 2, chapterNo: 1, palette: "teal" },
];
const R = {};
for (const c of chapters) {
  for (const edition of ["teacher", "student"]) {
    const r = renderChapter(read(c.file), { ...base, edition, partNo: c.partNo, chapterNo: c.chapterNo, palette: c.palette, print });
    R[`${c.key}-${edition}`] = r;
    fs.writeFileSync(path.join(OUT, `${c.key}-${edition}.html`), r.html);
  }
}
const slots = (h) => count(h, /class="slot"/g);
const blanksOf = (h) => [...h.matchAll(/<span class="blank (answer|empty)">([\s\S]*?)<\/span><\/span>/g)].map((m) => m[2]);

console.log("공통: 견본 3개 장 × 두 판");
for (const c of chapters) {
  for (const edition of ["teacher", "student"]) {
    const { html, warnings, meta } = R[`${c.key}-${edition}`];
    const t = `${c.key} ${edition}`;
    ok(html.startsWith(`<section class="chapter" id="ch-${c.partNo}-${c.chapterNo}" data-palette="${c.palette}" data-part="${c.partNo}" data-chapter="${c.chapterNo}" data-edition="${edition}">`), `${t}: 장 머리 section`);
    ok(html.includes('<header class="chapter-head" data-mode="theory"><nav class="tabs"><span class="tab tab-theory on">THEORY</span><span class="tab tab-problems">PROBLEMS</span></nav>'), `${t}: THEORY 탭`);
    ok(html.includes('<header class="chapter-head" data-mode="problems"><nav class="tabs"><span class="tab tab-theory">THEORY</span><span class="tab tab-problems on">PROBLEMS</span></nav>'), `${t}: PROBLEMS 탭`);
    ok(html.includes(`<h1 class="chapter-title">${meta.title}</h1>`) && meta.title, `${t}: 장 제목`);
    ok(count(html, /<div class="theory-body">/g) === 1 && count(html, /<div class="problem-list">/g) === 1, `${t}: 구간 2개`);
    const p = plain(html);
    ok(!/:{2,}\w|:blank|:ref|:hl|:red|:blue|\\label|\+\+\+/.test(p), `${t}: 남은 디렉티브 없음`, p.match(/:{2,}\w+|:blank|:ref|\\label|\+\+\+/g));
    ok(edition === "teacher" || (count(html, /class="solution"/g) === 0 && count(html, /class="teacher-only"/g) === 0), `${t}: 학생용에 해설·교사용 내용 없음(교사용 메모는 placeholder로만)`);
    ok(blanksOf(html).every((b) => edition === "teacher" ? !/<span class="slot"><\/span>/.test(b) : !/<span class="slot">[^<]/.test(b)), `${t}: 빈칸 글자 판별`);
    ok(meta.blanks === count(html, /class="blank /g), `${t}: meta.blanks`, [meta.blanks]);
    // 원고 줄 번호: 제목 줄이 원본 파일의 그 줄인지
    const lines = read(c.file).split("\n");
    ok(meta.headings.every((h) => /^#{2,3} /.test(lines[h.line - 1]) && lines[h.line - 1].includes(h.text)), `${t}: 제목 data-line`);
    ok(meta.problems.every((q) => lines[q.line - 1].startsWith("::::problem")), `${t}: 문항 data-line`);
    ok(all(html, /<article class="problem" data-line="(\d+)"/g).length === meta.problems.length, `${t}: 문항 article`);
  }
  const T = R[`${c.key}-teacher`].html, S = R[`${c.key}-student`].html;
  eq(slots(T), slots(S), `${c.key}: 두 판의 빈칸 칸 수 같음`);
  eq(count(T, /class="gap"/g), count(S, /class="gap"/g), `${c.key}: 두 판의 간격 수 같음`);
  eq(count(T, /class="blank answer math"/g), count(S, /class="blank empty math"/g), `${c.key}: 수식 빈칸`);
  eq(R[`${c.key}-teacher`].meta.headings, R[`${c.key}-student`].meta.headings, `${c.key}: 두 판의 제목 같음`);
  eq(R[`${c.key}-teacher`].meta.figures, R[`${c.key}-student`].meta.figures, `${c.key}: 두 판의 그림 번호 같음`);
}

console.log("1-1 속도와 가속도");
{
  const T = R["1-1-teacher"], S = R["1-1-student"];
  const h = S.html;
  eq(all(h, /<span class="sec-no">([^<]*)<\/span>/g), ["1.", "2.", "(1)", "(2)", "3."], "절 번호");
  eq(all(h, /<h2 [^>]*class="sec" id="([^"]+)"/g), ["s-1-1-1", "s-1-1-2", "s-1-1-3"], "절 id");
  ok(h.includes('<span class="sec-no">1.</span> 위치와 변위</h2>'), "절 제목 모양");
  ok(!/실험으로 확인하기|직접 해 보기|도전 문제|화면의 수레|가속도 막대|3초 동안|처음 속도 2 m\/s, 가속도/.test(h), "빼는 절·퀴즈·빈 제목 사라짐");
  ok(!/cart-velocity|uniform-accel|quiz/.test(h), "exp·anim·quiz 사라짐");
  ok(h.includes("비율 1:abc 처럼"), "모르는 글자 디렉티브는 그대로");
  // 빈칸
  const sb = blanksOf(h), tb = blanksOf(T.html);
  eq(sb[0], '<span class="slot"></span><span class="gap"></span><span class="slot"></span><span class="slot">', "학생용 + 방향: 칸1 + 간격 + 칸2");
  eq(tb[0], '<span class="slot">+</span><span class="gap"></span><span class="slot">방</span><span class="slot">향', "교사용 + 방향: 글자");
  ok(sb.length === 2 && tb.length === 2, "글자 빈칸 2개");
  ok(count(h, /<span class="blank empty math"><span class="katex">/g) === 1, "학생용 수식 빈칸: 같은 KaTeX에 empty");
  ok(count(T.html, /<span class="blank answer math"><span class="katex">/g) === 1, "교사용 수식 빈칸");
  eq(S.meta.blanks, 3, "빈칸 3개");
  // 옆 단
  eq(all(h, /<aside class="side"[^>]*><p class="side-title">([^<]*)<\/p>/g), ["변위", "속력"], "옆 단 2개");
  // 수식 번호
  ok(/<div class="eq" id="eq-disp" data-no="1.1" data-line="17"><span class="katex-display">/.test(h), "식 disp (1.1)");
  ok(/<div class="eq" id="eq-avgv" data-no="1.2" data-line="38">/.test(h), "식 avgv (1.2)");
  ok(/<span class="tag">[\s\S]*?1\.1/.test(h) && h.includes("<annotation encoding=\"application/x-tex\">\\Delta x = x_{\\text{나중}} - x_{\\text{처음}}\n\\tag{1.1}</annotation>"), "\\label → \\tag{1.1}");
  eq(S.meta.equations, [{ id: "eq-disp", number: "1.1", line: 17 }, { id: "eq-avgv", number: "1.2", line: 38 }], "meta.equations");
  // 그림
  ok(/<figure class="fig" id="fig-numline" data-no="1.1" data-line="22"><div class="fig-body" style="width:80%"><svg /.test(h), "그림 1.1, 폭 80%, SVG 직접");
  ok(h.includes('<figcaption><span class="fig-no">그림 1.1</span> 출발점 2 m에서'), "그림 설명 띠");
  ok(h.includes('<a class="ref" href="#fig-numline">그림 1.1</a>의 물체') && h.includes('식 <a class="ref" href="#eq-disp">(1.1)</a>에 따라'), "참조 해결");
  // 상자
  ok(h.includes('<aside class="callout warn" data-line="26"><p class="callout-title">변위의 크기와 이동 거리</p>'), "warn 상자");
  ok(h.includes('<aside class="callout tip" data-line="56"><p class="callout-title">팁</p>'), "tip 기본 제목 팁");
  ok(h.includes('<aside class="callout note" data-line="87"><p class="callout-title">넓이 = 변위</p>'), "note 상자");
  ok(h.includes("<mark>0</mark>"), "형광펜");
  ok(count(h, /<table data-line="47">/g) === 1, "표");
  // 그래프
  ok(/<figure class="fig plot" data-line="77"><div class="fig-body" style="width:60%"><svg [^>]*>.*clipPath id="svg1-1-\d+-clip".*url\(#svg1-1-\d+-clip\).*data-palette="red"/.test(h), "그래프: 폭 60%, id 접두어, 색 묶음 전달");
  ok(!/<\?xml/.test(h), "XML 머리 제거");
  ok(!/<figure class="fig plot"[^>]*data-no/.test(h), "그래프는 번호 없음");
  // 교사용
  eq(count(T.html, /<div class="teacher-only" data-line="91">/g), 1, "교사용 메모");
  ok(/class="teacher-only placeholder"[^>]*>[\s\S]*수업 메모/.test(h) && !/class="teacher-only"/.test(h), "학생용 메모는 자리만(placeholder, 테마가 숨김)");
  // 문항
  eq(all(h, /<div class="problem-no">([^<]*)<\/div>/g), ["001", "002", "003"], "문항 번호");
  eq(all(h, /<article class="problem" data-line="\d+" id="([^"]+)"/g), ["pr-1-1-001", "pr-1-1-002", "pr-1-1-003"], "문항 id");
  eq(count(h, /<div class="space" style="height:25mm" data-line="\d+"><\/div>/g), 2, "학생용 공간 25mm ×2");
  eq(count(T.html, /<div class="space" style="height:25mm"/g), 2, "교사용 공간 25mm ×2");
  eq(count(T.html, /<\/div><div class="solution" data-line="\d+">/g), 3, "교사용 해설 3개(문항 본문 바로 뒤)");
  eq(S.meta.problems.map((p) => [p.number, p.hasSolution]), [["001", true], ["002", true], ["003", true]], "meta.problems");
  eq(S.warnings, [], "경고 없음");
}

console.log("1-2 힘과 운동");
{
  const T = R["1-2-teacher"], S = R["1-2-student"];
  const h = S.html;
  eq(blanksOf(h), ['<span class="slot"></span><span class="slot"></span><span class="slot">'], "알짜힘 빈칸 3칸");
  ok(h.includes("이 알짜힘은 빈칸이 되지 않는다"), "두 번째 알짜힘은 그대로");
  ok(h.includes('<span class="c-red">알짜힘</span>') && h.includes('<span class="c-blue">질량</span>'), "색 글자");
  ok(h.includes('<a class="ref" href="#eq-newton2">(2.1)</a>') && h.includes('<div class="eq" id="eq-newton2" data-no="2.1"'), "식 번호·참조 (2.1)");
  ok(h.includes('<aside class="callout think" data-line="17"><p class="callout-title">생각해 보기</p>'), "think 기본 제목");
  ok(h.includes('<div class="center" data-line="21">') && h.includes('<div class="right" data-line="25">'), "가운데·오른쪽");
  eq(count(h, /<div class="pagebreak" data-line="29"><\/div>/g), 1, "쪽 나눔");
  eq(count(h, /<div class="columns-2" data-line="33">/g), 1, "대칭 2단 구간");
  ok(h.includes("<code>:::columns</code>"), "인라인 코드 속 글자는 그대로");
  ok(/<\/article>\s*<div class="columnbreak" data-line="47"><\/div>\s*<article/.test(h), "문제 구간 단 나눔");
  eq(count(T.html, /class="solution"/g), 1, "교사용 해설 1개");
  const second = (x) => /<article class="problem"[^>]*id="pr-1-2-002">[\s\S]*?<\/article>/.exec(x)[0];
  eq(second(T.html), second(h), "해설 없는 문항은 두 판이 같음");
  eq(S.warnings, [], "경고 없음");
}

console.log("2-1 정전기");
{
  const T = R["2-1-teacher"], S = R["2-1-student"];
  const h = S.html;
  ok(h.includes('data-palette="teal" data-part="2" data-chapter="1"'), "2부 청록");
  ok(/<aside class="side" data-line="12"><p class="side-title">대전열<\/p>[\s\S]*?<figure class="fig" data-line="15"><div class="fig-body" style="width:100%"><svg [\s\S]*?<figcaption>작은 그림<\/figcaption><\/figure><\/aside>/.test(h), "옆 단 안의 작은 그림(번호 없음)");
  ok(/<div class="figs" data-line="31"><figure class="fig" id="fig-unlike" data-no="1.1"[\s\S]*?<span class="fig-no">그림 1.1<\/span> 다른 종류의 전하<\/figcaption><\/figure><figure class="fig" id="fig-like" data-no="1.2"[\s\S]*?<span class="fig-no">그림 1.2<\/span> 같은 종류의 전하<\/figcaption><\/figure><\/div>/.test(h), "그림 묶음: 1.1, 1.2");
  eq(S.meta.figures.map((f) => [f.id, f.number]), [["fig-unlike", "1.1"], ["fig-like", "1.2"], ["fig-2-1-3", "1.3"]], "meta.figures");
  // 같은 SVG 두 번 + id 충돌 없음
  const ids = all(h, /\sid="(svg[^"]+)"/g);
  ok(new Set(ids).size === ids.length, "SVG id 겹침 없음");
  ok(h.includes('<a class="ref" href="#fig-unlike">그림 1.1</a>처럼') && h.includes('<a class="ref" href="#eq-coulomb">(1.1)</a>'), "그림·식 참조");
  eq(S.warnings.map((w) => [w.code, w.line]), [["missing-image", 38], ["unknown-ref", 40]], "경고 missing-image, unknown-ref");
  ok(S.warnings.every((w) => typeof w.message === "string" && /[가-힣]/.test(w.message)), "경고 문장 한국어");
  ok(/<span class="katex has-frac">/.test(T.html), "분수가 든 인라인 수식 has-frac(교사용 해설)");
  ok(!/<span class="katex-display"><span class="katex has-frac">/.test(T.html + h), "가운데 수식에는 has-frac 없음");
  eq(count(T.html, /class="solution"/g), 2, "교사용 해설 2개");
  eq(count(T.html, /<div class="space" style="height:230mm"/g), 1, "해설 안 공간");
}

console.log("결정성");
for (const c of chapters) {
  for (const edition of ["teacher", "student"]) {
    const ctx = { ...base, edition, partNo: c.partNo, chapterNo: c.chapterNo, palette: c.palette, print };
    const a = renderChapter(read(c.file), ctx), b = renderChapter(read(c.file), ctx);
    ok(a.html === b.html && JSON.stringify(a.meta) === JSON.stringify(b.meta) && JSON.stringify(a.warnings) === JSON.stringify(b.warnings), `${c.key} ${edition}: 같은 입력 같은 출력`);
  }
}

console.log("renderBook");
const book = {
  id: "sample-book",
  config: bookConfig,
  print,
  parts: ["1-mechanics", "2-electricity"].map((dir) => {
    const config = JSON.parse(fs.readFileSync(path.join(BOOK, dir, "part.json"), "utf8"));
    const files = fs.readdirSync(path.join(BOOK, dir)).filter((f) => f.endsWith(".md")).sort();
    return { dir, config, palette: partPalette(config, print), chapters: files.map((f) => ({ path: `${dir}/${f}`, source: read(`${dir}/${f}`) })) };
  }),
};
for (const edition of ["teacher", "student"]) {
  const r = renderBook(book, { ...base, edition });
  fs.writeFileSync(path.join(OUT, `book-${edition}.html`), r.html);
  const h = r.html;
  eq(all(h, /<div class="part-no">(\d+)<\/div>/g), ["01", "02"], `${edition}: 부 번호 01, 02`);
  ok(h.includes('<section class="part-cover" id="part-1" data-palette="red" data-part="1">') && h.includes('<section class="part-cover" id="part-2" data-palette="teal" data-part="2">'), `${edition}: 부 색 묶음`);
  ok(h.includes('<h1 class="part-title">운동과 힘</h1>') && h.includes('<h1 class="part-title">전기</h1>'), `${edition}: 부 제목`);
  ok(h.includes('<section class="part-toc" data-palette="red" data-part="1">\n<ol><li><span class="toc-no">1.</span> 속도와 가속도</li><li><span class="toc-no">2.</span> 힘과 운동</li></ol>'), `${edition}: 부 목차`);
  eq(all(h, /<section class="chapter" id="([^"]+)"/g), ["ch-1-1", "ch-1-2", "ch-2-1"], `${edition}: 장 3개`);
  eq(r.toc, [{ part: 1, title: "운동과 힘" }, { part: 1, chapter: 1, seq: 1, title: "속도와 가속도" }, { part: 1, chapter: 2, seq: 2, title: "힘과 운동" }, { part: 2, title: "전기" }, { part: 2, chapter: 1, seq: 3, title: "정전기" }], `${edition}: toc`);
  // 장 번호는 책 전체로 이어진다(사용자 결정 2026-11-07): 전기 부의 첫 장이 3
  ok(/id="ch-2-1"[\s\S]*?<span class="chapter-no">3<\/span>/.test(h), `${edition}: 2부 첫 장 번호 3`);
  ok(h.includes('<li><span class="toc-no">3.</span> 정전기</li>'), `${edition}: 부 목차의 장 번호 이어짐`);
  eq(r.warnings.map((w) => [w.code, w.path]), [["missing-image", "2-electricity/01-charge.md"], ["unknown-ref", "2-electricity/01-charge.md"]], `${edition}: 경고에 path`);
  ok(h.indexOf('id="part-2" data-palette="teal"') > h.indexOf('id="ch-1-2"'), `${edition}: 순서`);
  // 책 첫 쪽: 제목 + 목차(부·장 링크). 맨 앞에 있어야 함
  ok(h.trimStart().startsWith('<section class="book-front"') && h.includes('<h1 class="book-title">견본 물리</h1>'), `${edition}: 책 첫 쪽(제목)`);
  eq(all(h, /<li class="toc-(?:part|chapter)"><a href="#([^"]+)"/g), ["part-1", "ch-1-1", "ch-1-2", "part-2", "ch-2-1"], `${edition}: 책 목차 링크`);
}
{
  const p2 = renderBook(book, { ...base, edition: "student", range: { part: 2 } });
  ok(!p2.html.includes('data-part="1"') && p2.html.includes('<div class="part-no">02</div>') && p2.html.includes('id="ch-2-1"'), "range 부 하나");
  const c12 = renderBook(book, { ...base, edition: "student", range: { part: 1, chapter: 2 } });
  ok(!c12.html.includes("part-cover") && /^<section class="chapter" id="ch-1-2"/.test(c12.html) && c12.toc.length === 1, "range 장 하나");
  eq(renderBook(book, { ...base, edition: "student" }).html, renderBook(book, { ...base, edition: "student" }).html, "renderBook 결정성");
}

console.log("여러 경우");
const ctx0 = { ...base, edition: "student", partNo: 1, chapterNo: 3, palette: "teal", print };
const rc = (src, extra = {}) => renderChapter(src, { ...ctx0, ...extra });
{
  const r = rc("---\ntitle: t\n---\n## 가\n### 나\n글\n", { print: { ...print, headingNumbers: false } });
  ok(!r.html.includes("sec-no") && r.html.includes('<h2 data-line="4" class="sec" id="s-1-3-1">가</h2>'), "headingNumbers 거짓");
  eq(r.meta.headings[1].number, "(1)", "meta에는 번호");
}
{
  const r = rc("::problems\n\n::::problem\n가\n::::\n", { print: { ...print, problemNumber: "0" } });
  ok(r.html.includes('<div class="problem-no">1</div>') && r.html.includes('id="pr-1-3-001"'), "problemNumber 0");
}
{
  const r = rc("## 가\n\n## 나\n\n### 다\n\n## 다음\n\n:::note\n### 퀴즈만\n:::quiz\n문제\n:::\n:::\n\n본문\n");
  eq(r.meta.headings.map((h) => h.text), ["다음"], "빈 제목 연쇄 삭제");
  ok(!r.html.includes("퀴즈만") && r.html.includes("본문"), "상자 안 빈 제목 삭제");
}
{
  const r = rc("## 가\n\n:::note\n### 직접 해 보기\n지울 글\n### 남김\n남는 글\n:::\n");
  ok(!r.html.includes("지울 글") && r.html.includes("남는 글"), "상자 안 omitSections");
}
{
  const r = rc("수식 $\\frac{1}{$ 와\n\n$$\n\\badcommand{x}\n$$\n\n끝");
  eq(r.warnings.map((w) => [w.code, w.line]), [["bad-math", 1], ["bad-math", 3]], "bad-math 경고, 멈추지 않음");
  ok(r.html.includes("끝"), "오류 뒤 내용 유지");
}
{
  const r = rc("분수 $\\frac{a}{b}$ 와 $x$");
  eq(count(r.html, /<span class="katex has-frac">/g), 1, "has-frac 하나만");
}
{
  const r = rc(":::foo\n안쪽\n:::\n\n::bar{x=1}\n\n글 :baz[글자]{a=1} 끝\n");
  eq(r.warnings.map((w) => [w.code, w.line]), [["unknown-directive", 1], ["unknown-directive", 5]], "모르는 블록 디렉티브 경고");
  ok(r.html.includes("안쪽") && r.html.includes("글 :baz[글자]{a=1} 끝"), "모르는 글자 디렉티브는 원래 글자");
}
{
  const r = rc("::problems\n\n:::side[옆]\n글\n:::\n");
  eq(r.warnings.map((w) => w.code), ["side-outside-theory"], "문제 구간 side 경고");
  ok(r.html.includes('<aside class="callout note" data-line="3"><p class="callout-title">옆</p>'), "보통 상자로");
}
{
  const r = rc("$$\na\n\\label{x}\n$$\n\n$$\nb\n\\label{x}\n$$\n\n::fig[가]{src=images/charges.svg #x}\n");
  ok(r.warnings.filter((w) => w.code === "duplicate-label").length === 2, "duplicate-label 경고");
  const ids = all(r.html, /\sid="((?:eq|fig)-[^"]+)"/g);
  ok(new Set(ids).size === ids.length, "겹친 이름도 id는 다름", ids);
}
{
  const r = rc("```plot\nx: 0 .. 1\nw: 50\n```\n", { plot: () => { throw new Error("고장"); } });
  ok(r.warnings.length === 1 && r.warnings[0].code === "plot-error" && r.warnings[0].line === 1, "plot 예외 → plot-error");
  ok(r.html.includes('<figure class="fig plot" data-line="1"><div class="fig-body empty" style="width:50%"></div></figure>'), "빈 그림 자리");
  const r2 = rc("```plot\nx: 0 .. 1\n```\n", { plot: () => ({ svg: FAKE_SVG, errors: ["식 오류"] }) });
  ok(r2.warnings.map((w) => w.code).join() === "plot-error" && r2.html.includes('style="width:70%"><svg'), "plot errors → 경고 + 그림, 기본 폭 70%");
  const { plot: _p, ...noPlot } = ctx0;
  const r3 = renderChapter("```plot\nx: 0 .. 1\ny: 0 .. 1\nf: y = x\n```\n", noPlot);
  ok(r3.html.includes("<svg") || r3.warnings.some((w) => w.code === "plot-error"), "ctx.plot 없으면 src/plot 사용(만드는 중이면 plot-error)");
}
{
  const seen = [];
  const r = rc("::fig[가]{src=/books/sample-book/charges.svg}\n\n![그림](/books/sample-book/images/logo.svg)\n", {
    readSvg: (s) => { seen.push(s); return base.readSvg(s); },
  });
  eq(seen, ["images/charges.svg"], "Physiklar 경로 → images/");
  ok(r.html.includes('src="/samples/sample-book/images/logo.svg"'), "마크다운 그림 경로");
}
{
  const r = rc("::fig[가]{src=images/a.svg}\n\n::fig[나]{src=images/b.svg}\n", { readSvg: () => FAKE_SVG, resolveAsset: (s) => s });
  const ids = all(r.html, /clipPath id="([^"]+)"/g);
  ok(ids.length === 2 && ids[0] !== ids[1] && r.html.includes(`url(#${ids[1]})`), "SVG id 접두어");
}
{
  const r = rc("가 :blank[등가속도  운동] 나 :blank[a😀b]");
  eq(blanksOf(r.html)[0], '<span class="slot"></span><span class="slot"></span><span class="slot"></span><span class="slot"></span><span class="gap"></span><span class="slot"></span><span class="slot">', "등가속도 운동: 4칸 + 간격 + 2칸");
  eq(count(blanksOf(r.html)[1] + "</span>", /class="slot"/g), 3, "Array.from 글자 분리");
}
{
  const r = rc("+++\n\n가\n\n::pagebreak\n");
  ok(!r.html.includes("+++") && r.html.includes("pagebreak"), "+++ 무시");
  ok(!r.html.includes('<section class="problems">'), "::problems 없으면 개념 구간만");
}

console.log("exportPhysiklar");
{
  const out = {};
  for (const c of chapters) {
    out[c.key] = exportPhysiklar(read(c.file), { chapterNo: c.chapterNo, plot: fakePlot });
    fs.writeFileSync(path.join(OUT, `export-${c.key}.md`), out[c.key].source);
  }
  const a = out["1-1"].source, b = out["1-2"].source, d = out["2-1"].source;
  for (const [k, s] of Object.entries({ a, b, d })) {
    ok(!/:blank|:::teacher|:::solution|::problems|::::problem|\\label|:ref\[|::pagebreak|::columnbreak|::space|:::columns|:::figs|:::side/.test(s.replace(/`[^`\n]*`/g, "")), `${k}: 편집기 문법 없음`);
    ok(s.startsWith("---\ntitle: "), `${k}: 머리 부분 유지`);
    ok(s.endsWith("\n") && !s.endsWith("\n\n"), `${k}: 끝 줄바꿈`);
  }
  ok(a.includes("한쪽을 + 방향으로") && a.includes("$v = v_0 + at$가 성립"), "빈칸 → 글자");
  ok(a.includes("\\tag{1.1}") && a.includes("\\tag{1.2}") && a.includes("그림 1.1의 물체") && a.includes("식 (1.1)에 따라"), "식 번호·참조 글자");
  ok(a.includes(":::note[변위]") && a.includes(":::note[속력]"), "side → note");
  ok(!a.includes("수업 메모") && a.includes(":::quiz{answer=\"1\"}") && a.includes("::exp{id=cart-velocity}") && a.includes("+++") && a.includes("### 실험으로 확인하기"), "Physiklar 문법은 남김");
  ok(!a.includes("```plot") && /::fig\{src=images\/plot-[0-9a-f]{8}\.svg w=60\}/.test(a), "plot → ::fig");
  ok(out["1-1"].files.length === 1 && out["1-1"].files[0].path.startsWith("images/plot-") && out["1-1"].files[0].text.startsWith("<svg"), "plot SVG 파일");
  ok(!a.includes("직선 위에서 물체가") && a.trimEnd().endsWith(":::"), "문제 구간 지움");
  ok(!b.includes("::pagebreak") && b.includes("이 구간은 `:::columns` 문법") && b.includes("\n\n## 대칭 2단 구간 시험\n\n이 구간은"), "columns 풀고 내용 유지");
  ok(d.includes("::fig[다른 종류의 전하]{src=images/charges.svg #unlike}\n::fig[같은 종류의 전하]") && d.includes("그림 1.1처럼") && d.includes("식 (1.1)에서"), "figs 안의 fig만 남김");
  eq(exportPhysiklar(read(chapters[0].file), { chapterNo: 1, plot: fakePlot }), out["1-1"], "내보내기 결정성");
  const np = exportPhysiklar("```plot\nx: 0 .. 1\n```\n", { chapterNo: 1, plot: () => { throw new Error("x"); } });
  ok(np.source.includes("```plot") && np.files.length === 0, "plot 실패 시 블록 유지");
}

console.log(`\nrender 시험: ${pass}개 통과, ${fail}개 실패 (결과: out/render/)`);
process.exit(fail ? 1 : 0);
