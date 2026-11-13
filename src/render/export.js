// Physiklar로 내보내기 (docs/FORMAT.md 4절). 원고 글자를 자리 그대로 고친다
import { withPrintDefaults } from "../types.js";
import { renderPlot } from "../plot/index.js";
import { parseBody, text, splitFrontMatter, hash8, plotWidth, cleanSvg } from "./util.js";
import { prepare, labelsOf } from "./prepare.js";

const UNWRAP = new Set(["columns", "figs", "def"]);
const DROP_LEAF = new Set(["pagebreak", "columnbreak", "space"]);
const DROP_BOX = new Set(["teacher", "source", "solution"]);

export function exportPhysiklarImpl(source, ctx = {}) {
  const { head, body } = splitFrontMatter(source);
  const C = ctx.chapterNo ?? 1;
  const print = ctx.print ?? withPrintDefaults({});
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  // 번호는 인쇄와 같게(인쇄에서 빠진 절의 \label은 번호 없이 지움)
  const { labels } = prepare(body, { print, partNo: ctx.partNo ?? 1, chapterNo: C, warn: () => {}, lineOf: () => undefined });

  const tree = parseBody(body);
  const edits = []; // [시작, 끝, 새 글자]
  const files = [];
  const at = (n) => [n.position.start.offset, n.position.end.offset];
  const lineStart = (i) => body.lastIndexOf("\n", i - 1) + 1;
  const lineEnd = (i) => { const j = body.indexOf("\n", i); return j < 0 ? body.length : j + 1; };
  // 줄 통째 지우기(앞뒤가 빈 줄이면 빈 줄 하나도 함께)
  const dropLines = (s, e) => {
    let a = lineStart(s), b = lineEnd(Math.max(s, e - 1));
    const prevBlank = a === 0 || (body[a - 1] === "\n" && (a < 2 || body[a - 2] === "\n"));
    if (prevBlank && body[b] === "\n") b++;
    edits.push([a, b, ""]);
  };

  const cut = tree.children.find((n) => n.type === "leafDirective" && n.name === "problems");
  const cutAt = cut ? lineStart(cut.position.start.offset) : Infinity;

  const visit = (list) => {
    for (const n of list) {
      if (!n.position || n.position.start.offset >= cutAt) continue;
      const [s, e] = at(n);
      if (n.type === "containerDirective" && DROP_BOX.has(n.name)) { dropLines(s, e); continue; }
      if (n.type === "leafDirective" && DROP_LEAF.has(n.name)) { dropLines(s, e); continue; }
      if (n.type === "containerDirective" && UNWRAP.has(n.name)) {
        dropLines(s, s);
        const ls = lineStart(e);
        if (/^:{3,}\s*$/.test(body.slice(ls, e)) && ls > s) dropLines(ls, e);
        visit(n.children.filter((c) => !c.data?.directiveLabel));
        continue;
      }
      if (n.type === "containerDirective" && n.name === "side") {
        const m = /^(:+)side/.exec(body.slice(s));
        if (m) edits.push([s + m[1].length, s + m[0].length, "note"]);
      }
      // 예제 → 참고 상자. 제목이 없으면 [예제]를 붙인다
      if (n.type === "containerDirective" && n.name === "example") {
        const m = /^(:+)example(\[)?/.exec(body.slice(s));
        if (m) edits.push([s + m[1].length, s + m[1].length + "example".length + (m[2] ? 1 : 0), m[2] ? "note[예제 · " : "note[예제]"]);
      }
      if (n.type === "textDirective" && n.name === "blank") {
        const k = n.children;
        if (!k.length) { edits.push([s, e, ""]); continue; }
        edits.push([s, k[0].position.start.offset, ""], [k[k.length - 1].position.end.offset, e, ""]);
      }
      if (n.type === "textDirective" && n.name === "ref") {
        const t = labels.get(text(n).trim());
        edits.push([s, e, t ? (t.kind === "eq" ? `(${t.no})` : `그림 ${t.no}`) : text(n).trim()]);
        continue;
      }
      if ((n.type === "math" || n.type === "inlineMath") && labelsOf(n.value).length) {
        const src = body.slice(s, e);
        let first = true;
        for (const m of src.matchAll(/\\label\s*\{([^{}]*)\}/g)) {
          const t = labels.get(m[1].trim());
          const rep = n.type === "math" && first && t ? `\\tag{${t.no}}` : "";
          if (rep) first = false;
          edits.push([s + m.index, s + m.index + m[0].length, rep]);
        }
        continue;
      }
      if (n.type === "code" && n.lang === "plot") {
        try {
          const r = (ctx.plot ?? renderPlot)(n.value ?? "", { palette: ctx.palette ?? print.palette ?? "teal" });
          if (!r?.svg) throw new Error((r?.errors ?? []).join(" ") || "빈 그래프");
          const path = `images/plot-${hash8(n.value ?? "")}.svg`;
          files.push({ path, text: cleanSvg(r.svg, "") + "\n" });
          edits.push([s, e, `::fig{src=${path} w=${plotWidth(n.value)}}`]);
        } catch (err) {
          warn("plot-error", `그래프를 SVG로 바꾸지 못해 원래 블록을 남겼습니다: ${String(err?.message ?? err)}`);
        }
        continue;
      }
      if (n.children) visit(n.children);
    }
  };
  visit(tree.children);
  if (cut) edits.push([cutAt, body.length, ""]);

  // 뒤에서부터 적용(겹치면 앞의 것만)
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = body, limit = Infinity;
  for (const [s, e, rep] of edits) {
    if (e > limit) continue;
    out = out.slice(0, s) + rep + out.slice(e);
    limit = s;
  }
  if (cut) out = out.replace(/\s+$/, "") + "\n";
  // 중복 파일 제거(같은 그래프 두 번)
  const seen = new Set();
  const uniq = files.filter((f) => (seen.has(f.path) ? false : seen.add(f.path)));
  return { source: head + out, files: uniq, warnings };
}
