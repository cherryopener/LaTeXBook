// 조판(layout) 시험: 견본 본문으로 세 판형 × 교사용·학생용 PDF를 만들어 확인한다.
// - 쪽 크기(pdfinfo), 대체 글꼴 없음(pdffonts), 교사용·학생용 쪽수·문항 쪽 같음, 경고(solution-overflow, page-multiple)
// - 결과물: out/layout/*.pdf, 주요 쪽 그림(*.png), report.json
// 견본 본문을 고쳤으면 먼저: node tests/fixtures/layout-make.mjs
import { openBrowser, ROOT } from "./lib/browser.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(ROOT, "out/layout");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
const mm = (pt) => (pt * 25.4) / 72;

// PDF에 들어가도 되는 글꼴(이 밖의 것은 시스템 대체 글꼴로 본다: WenQuanYi, Liberation, DejaVu 등)
const ALLOWED_FONT = /^(KaTeX_|NotoSerifKR|Pretendard|Rajdhani|RubikGlitch|Wallpoet)/;
const SIZE = { "a4": [210, 297], "a4-bleed": [216, 303] };

const t = await openBrowser({ port: 8803 });

async function render(query) {
  const page = await t.page(`/tests/pages/layout-test.html?${query}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => window.__result);
  return { page, r };
}

function pdfChecks(file, paper) {
  const info = sh("pdfinfo", [file]);
  const [, w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info).map(Number);
  const [W, H] = [mm(w), mm(h)];
  if (SIZE[paper]) {
    const [ew, eh] = SIZE[paper];
    check(Math.abs(W - ew) <= 0.5 && Math.abs(H - eh) <= 0.5, `${path.basename(file)} 크기 ${W.toFixed(1)}×${H.toFixed(1)}mm (기대 ${ew}×${eh})`);
  } else {
    check(W > 216.5 && H > 303.5, `${path.basename(file)} 재단선판 크기 ${W.toFixed(1)}×${H.toFixed(1)}mm (216×303보다 큼)`);
  }
  const rows = sh("pdffonts", [file]).split("\n").slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/));
  const names = [...new Set(rows.map((c) => c[0].replace(/^[A-Z]{6}\+/, "")))];
  const bad = names.filter((n) => !ALLOWED_FONT.test(n));
  const notEmb = rows.filter((c) => c.at(-5) !== "yes").map((c) => c[0]);
  check(bad.length === 0, `${path.basename(file)} 대체 글꼴 없음${bad.length ? ": " + bad.join(", ") : ""}`);
  check(notEmb.length === 0, `${path.basename(file)} 모든 글꼴 포함${notEmb.length ? ": " + notEmb.join(", ") : ""}`);
  return { W, H, fonts: names };
}

const problemPages = (info) => Object.fromEntries(info.flatMap((p) => p.problems.map((id) => [id, p.no])).reverse());
const report = { runs: {}, speed: {} };

for (const paper of ["a4", "a4-bleed", "a4-marks"]) {
  console.log(`[${paper}]`);
  const res = {};
  for (const edition of ["teacher", "student"]) {
    const { page, r } = await render(`edition=${edition}&paper=${paper}&twice=1`);
    check(!r.error, `${edition} 조판 오류 없음 ${r.error ?? ""}`);
    const file = path.join(OUT, `${edition}-${paper}.pdf`);
    await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
    await page.close();
    const pdf = pdfChecks(file, paper);
    const nPdf = Number(/Pages:\s+(\d+)/.exec(sh("pdfinfo", [file]))[1]);
    check(nPdf === r.pages, `${edition} PDF 쪽수(${nPdf}) = 미리보기 쪽수(${r.pages})`);
    res[edition] = { ...r, file, pdf };
    report.runs[`${edition}-${paper}`] = { pages: r.pages, ms: r.ms, ms2: r.ms2, warnings: r.warnings, fonts: pdf.fonts };
  }
  const { teacher: T, student: S } = res;
  check(T.pages === S.pages, `교사용·학생용 쪽수 같음 (${T.pages}, ${S.pages})`);
  check(JSON.stringify(problemPages(T.pageInfo)) === JSON.stringify(problemPages(S.pageInfo)), "교사용·학생용 문항별 쪽 같음");
  const codes = (r) => r.warnings.map((w) => w.code);
  check(codes(T).includes("solution-overflow"), "교사용: 긴 해설에 solution-overflow 경고");
  check(!codes(S).includes("solution-overflow"), "학생용: solution-overflow 경고 없음");
  const pm = T.warnings.find((w) => w.code === "page-multiple");
  check(T.pages % 16 ? !!pm && pm.message.includes(`${16 - (T.pages % 16)}쪽`) : !pm, `page-multiple 경고(${pm?.message ?? "없음"})`);
  check(T.lines.every(([, p]) => Number.isInteger(p) && p >= 1), `pageOfLine ${JSON.stringify(T.lines)}`);

  // 주요 쪽 그림 (도련판에서)
  if (paper === "a4-bleed") {
    const pick = (info, f) => info.find(f)?.no;
    const shots = {
      "cover-red": pick(T.pageInfo, (p) => p.cover && p.palette === "red"),
      "cover-teal": pick(T.pageInfo, (p) => p.cover && p.palette === "teal"),
      "part-toc": pick(T.pageInfo, (p) => p.toc),
      "chapter-head": pick(T.pageInfo, (p) => p.head === "theory"),
      "theory-left": pick(T.pageInfo, (p) => p.theory && !p.head && p.side === "left" && p.sides),
      "theory-right": pick(T.pageInfo, (p) => p.theory && !p.head && p.side === "right" && p.sides),
      "problems-head": pick(T.pageInfo, (p) => p.head === "problems"),
      "problems-left": pick(T.pageInfo, (p) => !p.head && p.problems.length && p.side === "left"),
    };
    for (const [name, no] of Object.entries(shots)) {
      check(!!no, `그림용 쪽 찾음: ${name} (${no ?? "없음"})`);
      if (!no) continue;
      for (const ed of name.startsWith("problems") ? ["teacher", "student"] : ["teacher"]) {
        const out = path.join(OUT, name.startsWith("problems") ? `${name}-${ed}` : name);
        sh("pdftoppm", ["-r", "80", "-png", "-singlefile", "-f", String(no), "-l", String(no), res[ed].file, out]);
      }
    }
    report.shots = shots;
  }
}

// 같은 쪽 안에서 왼쪽 단 → 오른쪽 단으로 넘치는 해설
{
  const { page, r } = await render("edition=teacher&paper=a4&fixture=layout-overflow");
  await page.close();
  check(r.warnings.some((w) => w.code === "solution-overflow" && w.line === 10), "같은 쪽 단 넘침도 solution-overflow");
}

// 장이 오른쪽 쪽에서 끝나면 다음 부 표지 앞에 빈 쪽: 머리말·쪽 번호·바탕색 없음
{
  const { page, r } = await render("edition=teacher&paper=a4&fixture=layout-overflow,layout-teacher");
  const file = path.join(OUT, "teacher-a4-blank.pdf");
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.close();
  const blank = r.pageInfo.find((p, i) => p.text === 0 && r.pageInfo[i + 1]?.cover);
  check(!!blank && blank.margin === 0, `표지 앞 빈 쪽에 머리말·쪽 번호 없음 (${blank ? blank.no + "쪽" : "빈 쪽 없음"})`);
  if (blank) {
    // 바탕이 흰지: 작은 PPM으로 뽑아 밝기 평균
    const ppm = path.join(OUT, "_blank");
    sh("pdftoppm", ["-r", "10", "-singlefile", "-f", String(blank.no), "-l", String(blank.no), file, ppm]);
    const buf = fs.readFileSync(ppm + ".ppm");
    const px = buf.subarray(buf.length - (() => { const [, w, h] = /P6\s+(\d+)\s+(\d+)/.exec(buf.subarray(0, 30).toString("latin1")).map(Number); return w * h * 3; })());
    const mean = px.reduce((a, b) => a + b, 0) / px.length;
    fs.rmSync(ppm + ".ppm");
    check(mean > 250, `표지 앞 빈 쪽 바탕이 흼 (밝기 ${mean.toFixed(0)})`);
  }
}

// 좁은 단 늘 왼쪽(sideColumn: left), 장 시작 아무 쪽(chapterStart: any)
{
  const { page, r } = await render("edition=teacher&paper=a4&side=left&start=any");
  const file = path.join(OUT, "teacher-a4-sideleft.pdf");
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.close();
  check(!r.error && r.pages > 0, `sideColumn left 조판 (${r.pages}쪽)`);
  const no = r.pageInfo.find((p) => p.theory && !p.head && p.side === "right" && p.sides)?.no;
  if (no) sh("pdftoppm", ["-r", "80", "-png", "-singlefile", "-f", String(no), "-l", String(no), file, path.join(OUT, "theory-right-sideleft")]);
}

// 미리보기 속도: 책 전체, 장 하나
for (const [name, q] of [["book", "edition=teacher&paper=a4&twice=1"], ["chapter", "edition=teacher&paper=a4&twice=1&chapter=ch-2-1"]]) {
  const { page, r } = await render(q);
  await page.close();
  report.speed[name] = { pages: r.pages, firstMs: r.ms, againMs: r.ms2 };
  console.log(`  속도 ${name}: ${r.pages}쪽, 처음 ${r.ms}ms, 다시 ${r.ms2}ms`);
}

// printPdf: 숨은 iframe에서 조판한 뒤 인쇄를 부르고 iframe을 치우는지
{
  const page = await t.page("/tests/pages/layout-test.html?edition=student&paper=a4&chapter=ch-1-1");
  await page.waitForFunction(() => window.__result, null, { timeout: 180000 });
  const ok = await page.evaluate(async () => {
    const { printPdf } = await import("/src/layout/index.js");
    let printed = false;
    printPdf(window.__doc, { title: "시험" });
    const fr = document.querySelector("iframe");
    if (!fr) return "iframe 없음";
    // 인쇄 창 대신 표시만
    await new Promise((ok) => fr.addEventListener("load", ok, { once: true }));
    fr.contentWindow.print = () => { printed = true; };
    for (let i = 0; i < 600 && document.contains(fr); i++) await new Promise((ok) => setTimeout(ok, 100));
    return printed && !document.contains(fr) ? "ok" : `printed=${printed} removed=${!document.contains(fr)}`;
  });
  await page.close();
  check(ok === "ok", `printPdf 인쇄 호출·정리 (${ok})`);
}

// 본문 글꼴 파일(print.fonts.bodyFile) → 절대 주소 @font-face
{
  const page = await t.page("/tests/pages/layout-viewer.html");
  const doc = await page.evaluate(async () => {
    const { buildDocument } = await import("/src/layout/index.js");
    return buildDocument("<p>가</p>", { paper: "a4", edition: "student", theme: "cyber", title: "t",
      print: { fonts: { body: "Test Body", bodyFile: "fonts/body.ttf" }, sideColumn: "outside", chapterStart: "right" },
      resolveAsset: (s) => `/books/x/${s}` });
  });
  await page.close();
  check(/@font-face \{ font-family: "Test Body"; src: url\("http:\/\/localhost:\d+\/books\/x\/fonts\/body\.ttf"\)/.test(doc), "bodyFile → 절대 주소 @font-face");
  check(doc.includes('--font-body: "Test Body", "Noto Serif KR", serif'), "bodyFile 글꼴이 본문 글꼴 맨 앞");
  check(/href="https:\/\/cdn\.jsdelivr\.net\/npm\/pretendard/.test(doc) && /href="http:\/\/localhost:\d+\/themes\/cyber\/theme\.css"/.test(doc), "글꼴·테마 CSS 주소가 절대 주소");
}

const errs = t.errors.filter((e) => !/E_INVALID_PROPERTY_VALUE/.test(e));
check(errs.length === 0, `브라우저 오류 없음${errs.length ? ": " + errs.slice(0, 3).join(" / ") : ""}`);
await t.close();
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(fails.length ? `layout 시험 실패 ${fails.length}건` : "layout 시험 통과");
process.exit(fails.length ? 1 : 0);
