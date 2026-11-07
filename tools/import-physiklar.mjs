// Physiklar 책(들)을 이 편집기의 책 폴더 하나로 옮긴다(8단계). 메인 세션 담당.
//
//   node tools/import-physiklar.mjs --physiklar <Physiklar 폴더> --out <textbooks/books/<새 책 id>> --config <설정.json>
//
// 설정.json(비공개 내용은 넣지 않아도 됨. 책 제목 등은 이 파일에서 받는다):
//   { "book": { …새 book.json… },
//     "sources": [ { "book": "bridge-mechanics", "palette": "red", "cover": { "title": "Mechanics" } }, … ] }
//
// 하는 일
// 1) 원본 책마다 부(part.json 폴더)를 차례로 새 번호(1-, 2-, …)로 옮긴다. part.json은 원래 칸을 그대로 두고
//    print.palette와(원본 책의 첫 부에만) print.cover를 더한다 → 원본 책 하나가 큰 표지(Part) 하나가 된다.
// 2) 장 원고(.md)는 그림 경로만 바꾼다: "/books/<원본 책 id>/파일" → "images/파일". 다른 글자는 한 글자도 바꾸지 않는다.
// 3) SVG 그림은 화면용 색(어두운 바탕)을 흰 종이용 인쇄 색으로 바꿔 images/에 넣는다(아래 RECOLOR). 두 책 그림 이름이 겹치면 멈춘다.
// 4) 검사: (a) 결과 원고에서 그림 경로를 되돌리면 원본과 바이트까지 같은지, (b) 대응표에 없는 색이 남지 않았는지.
// 5) 인쇄에서 빠지는 퀴즈·웹 실험·실험 절을 가리키는 듯한 문장 목록을 --report 파일로 쓴다(문장은 고치지 않음).
// 6) 사용자가 정한 글자 고침(설정의 "edits")만 마지막에 적용한다. 줄과 고칠 횟수를 정확히 적고, 맞지 않으면 멈춘다.
//    { "file": "<새 부 폴더>/<장>.md" 또는 "images/<그림>.svg", "line": 줄 번호(그림은 생략), "from": "화면", "to": "종이면", "count": 1 }
import fs from "node:fs";
import path from "node:path";

// ---- 그림 색 대응표: 화면용(어두운 남색 바탕 #1e293b) → 흰 종이 4도 인쇄용 ----
// 진한 색은 편집기 인쇄 색(themes/cyber/theme.css의 --ink, --ink-red/blue/green)과 맞춘다.
// CMYK 값은 7단계에서 이 표의 오른쪽 색마다 정한다(DECISIONS.md 3절).
export const RECOLOR = {
  // 바탕·무채색
  "#1e293b": "#ffffff", // 바탕(판은 지움), 바퀴 구멍 등 바탕색 칠, 진한 원 위의 글자 → 종이 흰색
  "#273449": "#eef1f5", // 바탕보다 조금 밝은 면 → 아주 옅은 회색
  "#3b4a63": "#dfe4ea", // 〃
  "#334155": "#e3e7ec", // 물체 면(도르래 등) → 옅은 회색
  "#475569": "#c8d0d9", // 물체 면(나무토막 등, 위에 글자가 놓임) → 중간 옅은 회색
  "#64748b": "#6b7280", // 보조선·축
  "#94a3b8": "#4b5563", // 윤곽선·보조 글자 → 진한 회색
  "#e2e8f0": "#1a1a1a", // 주 글자·주 선 → 본문 검정(--ink)
  "#ffffff": "#ffffff", // 자석(진한 빨강·파랑) 위 흰 글자 → 그대로
  // 색(화면 파스텔 → 흰 종이에서 보이는 진한 색)
  "#fdba74": "#e27100", // 주황(힘·전기장 화살표). 작은 글자도 읽히게 조금 진하게
  "#fca5a5": "#c8102e", // 빨강(+전하 등). 주황과 벌리려고 자홍 쪽으로
  "#ef4444": "#c81e1e", // 진한 빨강(자석 N극)
  "#93c5fd": "#1f5fb4", // 파랑(−전하 등) = --ink-blue
  "#3b82f6": "#1f5fb4", // 진한 파랑(자석 S극)
  "#86efac": "#178a52", // 초록 = --ink-green
  "#fde68a": "#7a8a00", // 노랑 → 올리브(노랑은 흰 종이에서 안 보임. 주황과 짝지어 쓰여서 황토가 아닌 올리브로 구분)
  "#c4b5fd": "#6b3fc4", // 보라
  "#a16207": "#8a5a12", // 나무색(탁자 등)
  // 중등 역학·전자기·파동 그림에서 더 나온 색(2026-11-07)
  "#0f172a": "#f3f5f8", // 바탕보다 진한 칸 바탕 → 아주 옅은 회색
  "#60a5fa": "#1f5fb4", // 파랑
  "#1d4ed8": "#1d4ed8", // 진한 파랑 그대로
  "#67e8f9": "#0e7490", // 하늘색 → 진한 청록
  "#22d3ee": "#0e7490", // 〃
  "#22c55e": "#178a52", // 초록
  "#f97316": "#e27100", // 주황
  "#facc15": "#9a7b00", // 노랑 → 진한 황토
  "#b45309": "#a0520a", // 진한 주황 갈색
  "#78350f": "#6b3410", // 갈색
  "#7c2d12": "#7c2d12", // 진한 갈색 그대로
  "#ec4899": "#c2185b", // 분홍 → 진한 자홍
};
const BG_RECT = /^\s*<rect width="\d+(?:\.\d+)?" height="\d+(?:\.\d+)?" rx="\d+(?:\.\d+)?" fill="#1e293b"\/>\s*\n?/m;

// 글자가 아닌 도형에서 쓰는 자리(면 fill·선 stroke)에 따라 다르게 바꾸는 회색(그림 검토 반영)
const SHAPE_FILL = { "#64748b": "#c8d0d9" };   // 회색 면(추·천장 등) 위에 검정 글자가 놓이므로 옅게
const SHAPE_STROKE = { "#334155": "#b8c1cc" }; // 보조 점선·나눔선은 면보다 진하게(흰 종이에서 사라지지 않게)

export function recolorSvg(svg) {
  const unknown = new Set();
  const map = (c, extra) => { const k = c.toLowerCase(); if (!(k in RECOLOR)) unknown.add(k); return extra?.[k] ?? RECOLOR[k] ?? c; };
  const out = svg
    .replace(BG_RECT, "") // 바탕 판은 지운다(흰 종이가 바탕)
    .replace(/<(\/?)([a-zA-Z]+)([^>]*)>/g, (tag, close, name, attrs) => {
      const isText = /^(text|tspan)$/i.test(name);
      // 한 번에 바꾼다(바꾼 색을 다시 바꾸지 않게)
      const a = attrs.replace(/(?:\b(fill|stroke)(="|:\s*))?(#[0-9a-fA-F]{6})\b/g, (_, prop, sep, c) =>
        prop ? `${prop}${sep}${map(c, isText ? null : prop === "fill" ? SHAPE_FILL : SHAPE_STROKE)}` : map(c));
      return `<${close}${name}${a}>`;
    });
  return { svg: out, unknown: [...unknown] };
}

const num = (name) => { const m = /^(\d+)-/.exec(name); return m ? Number(m[1]) : Infinity; };
const byNum = (a, b) => num(a) - num(b) || a.localeCompare(b);
const imgPath = (bookId) => new RegExp(`/books/${bookId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^\\s"')}]+)`, "g");

// 빠진 실험·퀴즈·움직이는 그림을 가리키는 듯한 낱말(사람이 보고 판단할 후보)
const POINTERS = [/실험/, /퀴즈/, /시뮬레이션/, /애니메이션/, /눌러/, /클릭/, /드래그/, /슬라이더/, /버튼/, /화면/, /직접 해 보/, /바꿔 (?:보세요|가며)/, /움직여 보/, /끌어 보/, /아래 (?:그림|실험|장면)에서/];

/** 원고에서 인쇄에 남는 줄 가운데, 빠지는 것을 가리키는 듯한 줄을 찾는다 */
export function findPointers(source, omitSections) {
  const lines = source.split("\n");
  const hits = [];
  let fence = 0, inQuiz = false, inFront = false, omitLevel = 0;
  lines.forEach((line, i) => {
    if (i === 0 && line === "---") { inFront = true; return; }
    if (inFront) { if (line === "---") inFront = false; return; }
    const h = /^(#{2,6})\s+(.*)$/.exec(line);
    if (h && !fence) {
      const lv = h[1].length;
      if (omitLevel && lv <= omitLevel) omitLevel = 0;
      if (!omitLevel && omitSections.includes(h[2].trim())) omitLevel = lv;
    }
    if (/^```/.test(line)) fence = fence ? 0 : 1;
    if (/^:::quiz\b/.test(line)) { inQuiz = true; return; }
    if (inQuiz) { if (/^:::\s*$/.test(line)) inQuiz = false; return; }
    if (fence || omitLevel || /^::(exp|anim)\b/.test(line) || /^\+\+\+\s*$/.test(line)) return;
    // 웹 실험·움직이는 그림 바로 앞(6줄 안)에서 "…보세요" 같은 해 보라는 말
    const near = lines.slice(i + 1, i + 7).some((l) => /^::(exp|anim)\b/.test(l)) && /보세요|지켜보|확인해 보/.test(line);
    const words = POINTERS.filter((re) => re.test(line)).map((re) => re.source);
    if (line.trim() && (words.length || near)) hits.push({ line: i + 1, text: line.trim(), why: near ? ["바로 뒤 웹 실험·움직이는 그림에서 해 보라는 말", ...words] : words });
  });
  return hits;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  return a;
}

export function importBooks({ physiklar, out, config, report }) {
  const fails = [];
  const pointerRows = [];
  const usedImages = new Map(); // 파일 이름 → 원본 책
  const omit = config.book?.print?.omitSections ?? ["실험으로 확인하기", "직접 해 보기"];
  fs.mkdirSync(path.join(out, "images"), { recursive: true });
  fs.writeFileSync(path.join(out, "book.json"), JSON.stringify(config.book, null, 2) + "\n");
  let partNo = 0, mdCount = 0;
  for (const src of config.sources) {
    const bookDir = path.join(physiklar, "content/books", src.book);
    const parts = fs.readdirSync(bookDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+-/.test(d.name)).map((d) => d.name).sort(byNum);
    parts.forEach((dir, k) => {
      partNo += 1;
      const newDir = `${partNo}-${dir.replace(/^\d+-/, "")}`;
      fs.mkdirSync(path.join(out, newDir), { recursive: true });
      const pconf = JSON.parse(fs.readFileSync(path.join(bookDir, dir, "part.json"), "utf8"));
      pconf.print = { ...(pconf.print ?? {}), palette: src.palette, ...(k === 0 && src.cover ? { cover: src.cover } : {}) };
      fs.writeFileSync(path.join(out, newDir, "part.json"), JSON.stringify(pconf, null, 2) + "\n");
      const mds = fs.readdirSync(path.join(bookDir, dir)).filter((f) => /^\d+-.*\.md$/.test(f)).sort(byNum);
      for (const f of mds) {
        const orig = fs.readFileSync(path.join(bookDir, dir, f), "utf8");
        const re = imgPath(src.book);
        const conv = orig.replace(re, (_, file) => `images/${file}`);
        // (a) 문장 불변: 결과에서 바꾼 그림 경로만 되돌리면 원본과 같아야 한다
        const back = conv.replace(/(src=["']?)images\/([^\s"')}]+)/g, (_, pre, file) => `${pre}/books/${src.book}/${file}`);
        if (back !== orig) fails.push(`${src.book}/${dir}/${f}: 그림 경로 말고 다른 글자가 바뀜`);
        fs.writeFileSync(path.join(out, newDir, f), conv);
        mdCount += 1;
        for (const h of findPointers(orig, omit)) pointerRows.push({ file: `${newDir}/${f}`, ...h });
        for (const m of orig.matchAll(imgPath(src.book))) {
          const file = m[1];
          if (usedImages.has(file) && usedImages.get(file) !== src.book) fails.push(`그림 이름 겹침: ${file}`);
          usedImages.set(file, src.book);
        }
      }
    });
  }
  // 그림: 원고에서 쓴 것 + 폴더에 있는 나머지 SVG 모두(원고에 없더라도 옮겨 둠)
  let svgCount = 0;
  for (const src of config.sources) {
    const imgDir = path.join(physiklar, "public/books", src.book);
    if (!fs.existsSync(imgDir)) continue;
    for (const f of fs.readdirSync(imgDir).sort()) {
      const from = path.join(imgDir, f), to = path.join(out, "images", f);
      if (fs.existsSync(to) && usedImages.get(f) && usedImages.get(f) !== src.book) fails.push(`그림 이름 겹침: ${f}`);
      if (f.endsWith(".svg")) {
        const { svg, unknown } = recolorSvg(fs.readFileSync(from, "utf8"));
        if (unknown.length) fails.push(`${src.book}/${f}: 대응표에 없는 색 ${unknown.join(", ")}`);
        fs.writeFileSync(to, svg);
        svgCount += 1;
      } else fs.copyFileSync(from, to);
    }
  }
  for (const [file] of usedImages) if (!fs.existsSync(path.join(out, "images", file))) fails.push(`원고가 쓰는 그림이 없음: ${file}`);
  // 6) 사용자가 정한 글자 고침
  let edited = 0;
  for (const e of config.edits ?? []) {
    const f = path.join(out, e.file);
    if (!fs.existsSync(f)) { fails.push(`고칠 파일 없음: ${e.file}`); continue; }
    const text = fs.readFileSync(f, "utf8");
    const lines = text.split("\n");
    const idx = e.line ? [e.line - 1] : lines.map((_, i) => i);
    let n = 0;
    for (const i of idx) lines[i] = (lines[i] ?? "").split(e.from).map((seg, k, arr) => { if (k < arr.length - 1) n += 1; return seg; }).join(e.to);
    if (n !== (e.count ?? 1)) { fails.push(`${e.file}${e.line ? `:${e.line}` : ""}: "${e.from}"가 ${e.count ?? 1}번이어야 하는데 ${n}번`); continue; }
    fs.writeFileSync(f, lines.join("\n"));
    edited += n;
  }
  if (report) {
    const rows = pointerRows.map((r) => `| ${r.file}:${r.line} | ${r.text.replace(/\|/g, "\\|")} | ${r.why.join(", ")} |`);
    fs.writeFileSync(report, `# 인쇄에서 빠지는 것을 가리키는 듯한 문장 (후보 ${rows.length}개)\n\n` +
      `퀴즈·웹 실험·움직이는 그림·"${omit.join("\"·\"")}" 절은 인쇄에서 빠집니다. 아래는 인쇄에 남는 줄 가운데 그것을 가리키는 듯한 줄입니다.\n` +
      `낱말로 찾은 후보라 상관없는 줄도 섞여 있습니다. 문장은 고치지 않았습니다.\n\n| 파일:줄 | 문장 | 찾은 까닭 |\n|---|---|---|\n${rows.join("\n")}\n`);
  }
  return { parts: partNo, chapters: mdCount, svgs: svgCount, images: usedImages.size, pointers: pointerRows.length, edited, fails };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.physiklar || !a.out || !a.config) { console.error("사용: --physiklar <폴더> --out <책 폴더> --config <설정.json> [--report <목록.md>]"); process.exit(2); }
  const r = importBooks({ physiklar: a.physiklar, out: a.out, config: JSON.parse(fs.readFileSync(a.config, "utf8")), report: a.report });
  console.log(`부 ${r.parts}개, 장 ${r.chapters}개, SVG ${r.svgs}개(원고가 쓰는 그림 ${r.images}개), 가리키는 문장 후보 ${r.pointers}개, 사용자 지정 고침 ${r.edited}곳`);
  if (r.fails.length) { console.error("실패:\n- " + r.fails.join("\n- ")); process.exit(1); }
  console.log("검사 통과: 그림 경로와 사용자 지정 고침 말고 바뀐 글자 없음, 대응표에 없는 색 없음, 그림 이름 겹침 없음");
}
