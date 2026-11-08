// 책 폴더(예: textbooks/books/mid-1)를 이 컴퓨터에서 조판해 교사용·학생용 PDF로 만든다.
//   node tools/build-book.mjs <책 폴더> <출력 이름> [teacher|student|both] [a4|a4-bleed]
// 결과: out/private/<출력 이름>/{teacher,student}.pdf, .html, summary.json(쪽별 정보·경고). out/은 커밋하지 않는다.
// 그림은 책 폴더의 images/, 글꼴은 책 폴더 기준 ../../fonts 를 out/ 아래로 복사해 로컬 서버로 쓴다.
// 전역 Playwright가 필요하다(tests/lib/browser.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { openBrowser } = await import(`${ROOT}/tests/lib/browser.mjs`);
const { assembleBook } = await import(`${ROOT}/src/book.js`);
const { renderBook } = await import(`${ROOT}/src/render/index.js`);
const { buildDocument } = await import(`${ROOT}/src/layout/index.js`);
const [bookArg, name, eds = "both", paper = "a4"] = process.argv.slice(2);
if (!bookArg || !name) { console.error("사용: node tools/build-book.mjs <책 폴더> <출력 이름> [teacher|student|both] [a4|a4-bleed]"); process.exit(2); }
const bookDir = path.resolve(bookArg);
const PORT = 8899 + Math.floor(Math.random() * 50);
const OUTREL = `out/private/${name}`;
const OUT = path.join(ROOT, OUTREL);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "books/b"), { recursive: true });
// 그림·글꼴을 out/ 아래로 복사(로컬 서버로 제공, 커밋 안 됨)
fs.cpSync(path.join(bookDir, "images"), path.join(OUT, "books/b/images"), { recursive: true });
if (fs.existsSync(path.join(bookDir, "../../fonts"))) fs.cpSync(path.join(bookDir, "../../fonts"), path.join(OUT, "fonts"), { recursive: true });
const files = {};
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "images") walk(p); } else if (/\.(json|md)$/.test(f.name)) files[path.relative(bookDir, p)] = fs.readFileSync(p, "utf8"); } })(bookDir);
const book = assembleBook(path.basename(bookDir), files);
const local = (src) => path.join(OUT, "books/b", src);
const resolveAsset = (src) => { const p = path.normalize(local(src)); return fs.existsSync(p) ? `http://localhost:${PORT}/${path.relative(ROOT, p)}` : null; };
const readSvg = (src) => (src.endsWith(".svg") && fs.existsSync(local(src)) ? fs.readFileSync(local(src), "utf8") : null);
const t = await openBrowser({ port: PORT });
const summary = {};
for (const edition of eds === "both" ? ["teacher", "student"] : [eds]) {
  const r = renderBook(book, { edition, resolveAsset, readSvg });
  const doc = buildDocument(r.html, { paper, edition, theme: book.print.theme, print: { ...book.print, paper }, resolveAsset, title: book.config.title, baseUrl: `http://localhost:${PORT}/` });
  fs.writeFileSync(path.join(OUT, `${edition}.html`), doc);
  const page = await t.page(`/tests/pages/integration.html?doc=/${OUTREL}/${edition}.html`);
  await page.waitForFunction(() => window.__result, null, { timeout: 600000 });
  const res = await page.evaluate(() => window.__result);
  if (res.error) { console.error(edition, res.error); continue; }
  await page.pdf({ path: path.join(OUT, `${edition}.pdf`), preferCSSPageSize: true, printBackground: true, timeout: 600000 });
  await page.close();
  const codes = (ws) => Object.entries(ws.reduce((m, w) => ((m[w.code] = (m[w.code] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join(", ");
  summary[edition] = { pages: res.pages, ms: res.ms, renderWarn: r.warnings, layoutWarn: res.warnings, pageInfo: res.pageInfo };
  console.log(`${edition}: ${res.pages}쪽, ${res.ms}ms, 변환 경고 [${codes(r.warnings)}], 조판 경고 [${codes(res.warnings)}]`);
}
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
await t.close();
