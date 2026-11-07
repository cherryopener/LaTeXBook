// 통합 시험: 견본 책 → render(renderBook) → layout(buildDocument, 미리보기) → PDF
// 교사용·학생용 × A4·도련판. 결과물: out/integration/
// 확인: 쪽 크기, 대체 글꼴 없음, 두 판의 쪽수와 문항 쪽 같음, 학생용 PDF에 정답·해설·교사 메모 글자 없음, 기대 경고
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openBrowser, ROOT } from "./lib/browser.mjs";
import { assembleBook } from "../src/book.js";
import { renderBook } from "../src/render/index.js";
import { buildDocument } from "../src/layout/index.js";

const PORT = 8805;
const BOOK_DIR = path.join(ROOT, "samples/sample-book");
const OUT = path.join(ROOT, "out/integration");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
const mm = (pt) => (pt * 25.4) / 72;

// 책 폴더 읽기
const files = {};
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(json|md)$/.test(f.name)) files[path.relative(BOOK_DIR, p)] = fs.readFileSync(p, "utf8");
  }
})(BOOK_DIR);
const book = assembleBook("sample-book", files);
const exists = (src) => fs.existsSync(path.join(BOOK_DIR, src));
const resolveAsset = (src) => (exists(src) ? `http://localhost:${PORT}/samples/sample-book/${src}` : null);
const readSvg = (src) => (src.endsWith(".svg") && exists(src) ? fs.readFileSync(path.join(BOOK_DIR, src), "utf8") : null);

const ALLOWED_FONT = /^(KaTeX_|NotoSerifKR|Pretendard|Rajdhani|RubikGlitch|Wallpoet|Tinos|EBGaramond)/;
const SIZE = { a4: [210, 297], "a4-bleed": [216, 303] };

const t = await openBrowser({ port: PORT });
const results = {};
for (const paper of ["a4", "a4-bleed"]) {
  for (const edition of ["teacher", "student"]) {
    const name = `book-${edition}-${paper}`;
    const r = renderBook(book, { edition, resolveAsset, readSvg });
    const doc = buildDocument(r.html, { paper, edition, theme: book.print.theme, print: { ...book.print, paper }, resolveAsset, title: "견본 물리", baseUrl: `http://localhost:${PORT}/` });
    fs.writeFileSync(path.join(OUT, `${name}.html`), doc);
    const page = await t.page(`/tests/pages/integration.html?doc=/out/integration/${name}.html`);
    await page.waitForFunction(() => window.__result, null, { timeout: 180000 });
    const res = await page.evaluate(() => window.__result);
    if (res.error) { check(false, `${name}: 조판 오류 ${res.error}`); continue; }
    const pdf = path.join(OUT, `${name}.pdf`);
    await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
    await page.close();
    results[name] = { ...res, renderWarnings: r.warnings };
    console.log(`${name}: ${res.pages}쪽, 조판 ${res.ms}ms, 경고(변환) ${r.warnings.map((w) => w.code).join(",")} / (조판) ${res.warnings.map((w) => w.code).join(",")}`);

    const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(sh("pdfinfo", [pdf])).map(Number);
    const [ew, eh] = SIZE[paper];
    check(Math.abs(mm(w) - ew) <= 0.5 && Math.abs(mm(h) - eh) <= 0.5, `${name}: 크기 ${mm(w).toFixed(1)}×${mm(h).toFixed(1)}mm`);
    const fonts = sh("pdffonts", [pdf]).split("\n").slice(2).map((l) => l.split(/\s+/)[0].replace(/^[A-Z]{6}\+/, "")).filter(Boolean);
    const bad = [...new Set(fonts.filter((f) => !ALLOWED_FONT.test(f)))];
    check(bad.length === 0, `${name}: 대체 글꼴 없음 ${bad.length ? bad.join(",") : ""}`);
    fs.writeFileSync(path.join(OUT, `${name}.txt`), sh("pdftotext", ["-layout", pdf, "-"]));
  }
}

// 견본의 정전기 장 002번은 일부러 해설이 단을 넘치게 만든 문항(solution-overflow 시험용)이다.
// 그 문항부터는 교사용 쪽이 밀리는 것이 정상이므로, 그 앞까지만 두 판이 같은지 본다.
const INTENDED_OVERFLOW = "pr-2-1-002";
for (const paper of ["a4", "a4-bleed"]) {
  const T = results[`book-teacher-${paper}`], S = results[`book-student-${paper}`];
  if (!T || !S) continue;
  // 문항이 처음 나오는 쪽
  const where = (R) => { const m = {}; for (const p of R.pageInfo) for (const id of p.problems) m[id] ??= p.no; return m; };
  const wt = where(T), ws = where(S);
  const diff = Object.keys(wt).filter((id) => wt[id] !== ws[id] && id !== INTENDED_OVERFLOW);
  check(Object.keys(wt).length >= 7 && diff.length === 0, `${paper}: 문항 ${Object.keys(wt).length}개의 쪽이 두 판에서 같음(의도된 넘침 문항 제외) ${diff.join(",")}`);
  const cut = wt[INTENDED_OVERFLOW] ?? Infinity;
  const firstLine = (R) => Object.fromEntries(R.pageInfo.filter((p) => p.no <= cut).map((p) => [p.no, Math.min(...p.lines)]));
  const ft = firstLine(T), fsx = firstLine(S);
  const lineDiff = Object.keys(ft).filter((k) => ft[k] !== fsx[k]);
  check(lineDiff.length === 0, `${paper}: ${cut}쪽까지 쪽마다 시작하는 원고 줄이 두 판에서 같음 ${lineDiff.join(",")}`);
  check(T.pages - S.pages <= 1, `${paper}: 쪽수 차이는 의도된 넘침 1쪽 이하 (${T.pages} / ${S.pages})`);
}

// 쪽 배치: 1쪽 책 첫 쪽(제목+목차), 부 표지·개념 시작·문제 시작은 모두 짝수 쪽(chapterStart: left)
for (const name of Object.keys(results)) {
  const P = results[name].pageInfo;
  check(P[0]?.front, `${name}: 1쪽이 책 첫 쪽(제목+목차)`);
  const odd = P.filter((p) => (p.head || p.cover) && p.no % 2 === 1).map((p) => `${p.no}쪽(${p.head ?? p.cover})`);
  check(odd.length === 0, `${name}: 부 표지·개념·문제 시작이 모두 짝수 쪽 ${odd.join(", ")}`);
}
// 목차 쪽수 자동: 1쪽 글자에서 각 항목의 쪽수가 실제 쪽과 같은지
{
  const R = results["book-teacher-a4"];
  const want = {};
  for (const p of R.pageInfo) { if (p.cover) want[`#${p.cover}`] ??= p.no; if (p.head === "theory" && p.headOf) want[`#${p.headOf}`] ??= p.no; }
  const page1 = execFileSync("pdftotext", ["-f", "1", "-l", "1", "-layout", path.join(OUT, "book-teacher-a4.pdf"), "-"], { encoding: "utf8" });
  const nums = [...page1.matchAll(/(\d+)\s*$/gm)].map((m) => Number(m[1]));
  const expect = Object.values(want);
  check(expect.length >= 5 && expect.every((n) => nums.includes(n)), `목차 쪽수 자동(기대 ${expect.join(",")} / 1쪽 숫자 ${nums.join(",")})`);
}

// 학생용 PDF에 정답·해설·교사 메모가 글자로 남지 않아야 함
const stu = fs.readFileSync(path.join(OUT, "book-student-a4.txt"), "utf8");
const tea = fs.readFileSync(path.join(OUT, "book-teacher-a4.txt"), "utf8");
for (const s of ["수업 메모", "한 방향으로만 곧게", "이동 거리 = 10", "6/2 = 3"]) {
  check(tea.includes(s.replace("이동 거리 = 10", "10 + 4")) || tea.includes(s), `교사용에 "${s}" 있음(시험 문장 확인용)`);
  check(!stu.includes(s), `학생용에 "${s}" 없음`);
}
check(!/v\s*=\s*v\s*0/.test(stu), "학생용에 수식 빈칸 정답(v = v0 + at) 없음");
check(/v\s*=\s*v\s*0/.test(tea), "교사용에 수식 빈칸 정답 있음");

// 기대 경고
const wcodes = (n) => [...results[n].renderWarnings.map((w) => w.code), ...results[n].warnings.map((w) => w.code)];
const tw = wcodes("book-teacher-a4");
for (const c of ["missing-image", "unknown-ref", "solution-overflow", "page-multiple"]) check(tw.includes(c), `교사용 경고에 ${c}`);
check(!wcodes("book-student-a4").includes("solution-overflow"), "학생용에는 solution-overflow 없음");

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 1));
await t.close();
console.log(`\n통합 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"} (결과: out/integration/)`);
process.exit(fails.length ? 1 : 0);
