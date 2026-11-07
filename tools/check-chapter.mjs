// 장 원고 하나를 변환해 보고 경고(수식 오류, 없는 그림, 모르는 문법 등)를 보여 준다.
//   node tools/check-chapter.mjs <책 폴더> <부 폴더/장.md>
import fs from "node:fs";
import path from "node:path";
import { renderChapter } from "../src/render/index.js";
import { withPrintDefaults, partPalette } from "../src/types.js";
const [bookDir, rel] = process.argv.slice(2);
const print = withPrintDefaults(JSON.parse(fs.readFileSync(path.join(bookDir, "book.json"), "utf8")));
const pconf = JSON.parse(fs.readFileSync(path.join(bookDir, path.dirname(rel), "part.json"), "utf8"));
const exists = (s) => fs.existsSync(path.join(bookDir, s));
const ctx = { edition: "student", partNo: 1, chapterNo: 1, chapterSeq: 1, palette: partPalette(pconf, print), print,
  resolveAsset: (s) => (exists(s) ? s : null), readSvg: (s) => (s.endsWith(".svg") && exists(s) ? fs.readFileSync(path.join(bookDir, s), "utf8") : null) };
const r = renderChapter(fs.readFileSync(path.join(bookDir, rel), "utf8"), ctx);
const t = renderChapter(fs.readFileSync(path.join(bookDir, rel), "utf8"), { ...ctx, edition: "teacher" });
console.log(`${rel}: 제목 "${r.meta.title}", 절 ${r.meta.headings.length}, 그림 ${r.meta.figures.length}, 빈칸 ${t.meta.blanks}`);
const ws = r.warnings.filter((w) => w.code !== "low-dpi");
// 굵게(**)가 닫히지 않아 글자로 찍히는 곳: 예) "**(가)**는" 처럼 닫는 ** 앞이 문장 부호이고 뒤가 한글일 때.
// 고치는 법: 굵게 안의 끝 문장 부호를 밖으로 빼거나, 조사까지 굵게 안에 넣는다.
const plain = r.html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
for (const m of plain.matchAll(/.{0,15}\*\*.{0,15}/g)) ws.push({ code: "bold-unclosed", message: `굵게(**)가 글자로 남음: …${m[0]}…` });
for (const w of ws) console.log(`  경고 ${w.code} (줄 ${w.line ?? "?"}): ${w.message}`);
process.exit(ws.length ? 1 : 0);
