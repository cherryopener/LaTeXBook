// 0단계 시험판 만들기: Physiklar 원고(비공개)를 읽어 out/ 에 인쇄용 HTML을 만든다.
// out/ 은 .gitignore 대상. Physiklar 원고와 그림은 이 저장소에 커밋하지 않는다.
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { renderChapter } from "./src/render.mjs";

const PHYSIKLAR = process.env.PHYSIKLAR ?? "/home/user/physiklar";
const BOOK = "bridge-mechanics";
const OUT = "out";
const NM = "node_modules";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/images`, { recursive: true });

const cp = (a, b) => fs.cpSync(a, b, { recursive: true });

// 글꼴·KaTeX·Vivliostyle (배포 때는 CDN 주소, 버전 고정)
cp(`${NM}/katex/dist/katex.min.css`, `${OUT}/katex/katex.min.css`);
cp(`${NM}/katex/dist/fonts`, `${OUT}/katex/fonts`);
cp(`${NM}/pretendard/dist/web/static`, `${OUT}/fonts/pretendard`);
for (const w of ["400", "700"]) cp(`${NM}/@fontsource/noto-serif-kr/${w}.css`, `${OUT}/fonts/noto-serif-kr/${w}.css`);
cp(`${NM}/@fontsource/noto-serif-kr/files`, `${OUT}/fonts/noto-serif-kr/files`);
await esbuild.build({ stdin: { contents: `import * as V from "@vivliostyle/core"; window.Vivliostyle = V;`, resolveDir: "." },
  bundle: true, format: "iife", minify: true, outfile: `${OUT}/vendor/vivliostyle.js`, logLevel: "warning" });
await esbuild.build({ entryPoints: ["src/render.mjs"], bundle: true, format: "esm", minify: true,
  outfile: `${OUT}/vendor/render.js`, logLevel: "warning" });
for (const f of ["book.css", "paper-a4.css", "paper-a4-bleed.css", "paper-a4-marks.css"]) cp(`src/${f}`, `${OUT}/${f}`);
cp("src/viewer.html", `${OUT}/viewer.html`);
cp("src/live.html", `${OUT}/live.html`);
fs.writeFileSync(`${OUT}/sample.md`, fs.readFileSync(path.join(PHYSIKLAR, "content/books", BOOK, "1-kinematics/02-uniform-acceleration-formulas.md"), "utf8"));

// 화면용(어두운 배경) 그림 → 흰 종이용 임시 색 변환. 정식 대응표는 8단계에서 만든다.
const RECOLOR = {
  "#1e293b": "#ffffff", "#e2e8f0": "#1f2937", "#94a3b8": "#4b5563", "#64748b": "#6b7280",
  "#334155": "#d1d5db", "#475569": "#9ca3af", "#ffffff": "#111827",
  "#fdba74": "#e0561b", "#86efac": "#1f9d55", "#93c5fd": "#2563eb", "#fde68a": "#b7791f",
  "#fca5a5": "#d63c3c", "#c4b5fd": "#7c3aed", "#a16207": "#7a4a07", "#ef4444": "#c81e1e",
};
const recolor = (svg) => svg
  .replace(/<rect width="(\d+)" height="(\d+)" rx="12" fill="#1e293b"\/>/, "") // 배경 판 제거
  .replace(/#[0-9a-fA-F]{6}\b/g, (c) => RECOLOR[c.toLowerCase()] ?? c);

// 장 고르기: 1단원 3개 장 + 2단 시험용 1개 장(4장 전체를 2단으로)
const md = (p) => fs.readFileSync(path.join(PHYSIKLAR, "content/books", BOOK, p), "utf8");
const chapters = [
  ["1-kinematics/01-displacement-velocity.md", false],
  ["1-kinematics/02-uniform-acceleration-formulas.md", false],
  ["1-kinematics/03-vertical-motion.md", false],
  ["2-force-laws/04-torque-equilibrium.md", true],
];
const used = new Set();
const body = chapters.map(([file, twoCol], i) => {
  let src = md(file);
  if (twoCol) src = src.replace(/^(---[\s\S]*?---\n)([\s\S]*)$/, (_, fm, rest) => `${fm}\n::::columns\n${rest}\n::::\n`);
  const no = i + 1;
  const inlineSvg = (s) => {
    const f = path.join(PHYSIKLAR, "public/books", BOOK, path.basename(s));
    return fs.existsSync(f) ? recolor(fs.readFileSync(f, "utf8")).replace(/<\?xml[^>]*>/, "") : null;
  };
  const { meta, html } = renderChapter(src, { chapterNo: no, inlineSvg, mapSrc: (s) => { used.add(path.basename(s)); return "images/" + path.basename(s); } });
  return `<section class="chapter">
<header class="chapter-head"><p class="chapter-no">${String(no).padStart(2, "0")}</p><h1>${meta.title}</h1><p class="summary">${meta.summary ?? ""}</p></header>
${html}
</section>`;
}).join("\n");
for (const f of used) {
  const s = path.join(PHYSIKLAR, "public/books", BOOK, f);
  if (fs.existsSync(s)) fs.writeFileSync(`${OUT}/images/${f}`, recolor(fs.readFileSync(s, "utf8")));
  else console.warn("그림 없음:", f);
}

const doc = (paper) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>브릿지 물리 — 0단계 시험판</title>
<link rel="stylesheet" href="fonts/pretendard/pretendard.css">
<link rel="stylesheet" href="fonts/noto-serif-kr/400.css">
<link rel="stylesheet" href="fonts/noto-serif-kr/700.css">
<link rel="stylesheet" href="katex/katex.min.css">
<link rel="stylesheet" href="book.css">
<link rel="stylesheet" href="${paper}">
</head><body>
${body}
</body></html>`;
fs.writeFileSync(`${OUT}/book-a4.html`, doc("paper-a4.css"));
fs.writeFileSync(`${OUT}/book-bleed.html`, doc("paper-a4-bleed.css"));
fs.writeFileSync(`${OUT}/book-marks.html`, doc("paper-a4-marks.css"));
console.log("완료: 장", chapters.length, "그림", used.size);
