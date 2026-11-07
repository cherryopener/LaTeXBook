// 원고(마크다운 + Physiklar 디렉티브) → 인쇄용 HTML 조각
// Physiklar lib/markdown.tsx 와 같은 라이브러리·같은 디렉티브 이름을 쓴다.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { visit, SKIP } from "unist-util-visit";
import { toString } from "mdast-util-to-string";

const CALLOUTS = ["tip", "note", "warn", "think"];
const CALLOUT_LABEL = { tip: "팁", note: "참고", warn: "주의", think: "생각해 보기" };
const COLORS = ["red", "blue", "green"];
const PRINT_HIDDEN = ["quiz", "exp", "anim"]; // 인쇄하지 않음(원고에는 남김) — 결정 C·D

export function splitFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function printDirectives(opts) {
  return () => (tree) => {
    let fig = 0;
    visit(tree, (node, index, parent) => {
      // Physiklar 화면 쪽 나눔 "+++" 은 인쇄에서 무시
      if (node.type === "paragraph" && parent && toString(node).trim() === "+++") {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      if (!["containerDirective", "leafDirective", "textDirective"].includes(node.type)) return;
      const a = node.attributes ?? {};
      const data = (node.data ??= {});
      const name = node.name;
      if (PRINT_HIDDEN.includes(name) && node.type !== "textDirective") {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      if (name === "center" || name === "right") {
        data.hName = "div"; data.hProperties = { className: [name] };
      } else if (CALLOUTS.includes(name)) {
        data.hName = "aside"; data.hProperties = { className: ["callout", name] };
        const label = node.children.find((c) => c.data?.directiveLabel);
        if (label) label.data.hProperties = { className: ["callout-title"] };
        else node.children.unshift({ type: "paragraph", children: [{ type: "text", value: CALLOUT_LABEL[name] }], data: { hProperties: { className: ["callout-title"] } } });
      } else if (name === "fig") {
        fig++;
        data.hName = "figure"; data.hProperties = { className: ["fig"] };
        const caption = toString(node);
        const src = opts.mapSrc ? opts.mapSrc(a.src ?? "") : a.src ?? "";
        // SVG는 본문에 직접 넣는다: <img>로 넣으면 그림 속 글자가 웹 글꼴을 못 써서 다른 글꼴로 찍힌다
        const svg = opts.inlineSvg && src.endsWith(".svg") ? opts.inlineSvg(src) : null;
        node.children = [
          svg ? { type: "html", value: `<div class="fig-body" style="width:${a.w ?? 100}%;margin:0 auto">${svg}</div>` }
              : { type: "image", url: src, alt: caption, data: { hProperties: { style: `width:${a.w ?? 100}%` } } },
          { type: "paragraph", data: { hName: "figcaption" }, children: [
            { type: "strong", children: [{ type: "text", value: `그림 ${opts.chapterNo}.${fig}` }] },
            { type: "text", value: caption ? "  " + caption : "" } ] },
        ];
      } else if (name === "columns") {
        data.hName = "div"; data.hProperties = { className: ["columns-2"] };
      } else if (name === "pagebreak") {
        data.hName = "div"; data.hProperties = { className: ["pagebreak"] };
      } else if (name === "hl") {
        data.hName = "mark";
      } else if (COLORS.includes(name)) {
        data.hName = "span"; data.hProperties = { className: ["c-" + name] };
      } else if (node.type === "textDirective" && parent) {
        parent.children[index] = { type: "text", value: ":" + name + (node.children.length ? `[${toString(node)}]` : "") };
      }
    });
  };
}

// 인쇄에서 뺀 요소 때문에 내용이 비게 된 제목(예: 퀴즈만 있던 "도전 문제")을 지운다
function dropEmptyHeadings() {
  const sweep = (node) => {
    const c = node.children ?? [];
    c.forEach(sweep);
    for (let i = c.length - 1; i >= 0; i--) {
      if (c[i].type !== "heading") continue;
      const next = c[i + 1];
      if (!next || (next.type === "heading" && next.depth <= c[i].depth)) c.splice(i, 1);
    }
  };
  return (tree) => sweep(tree);
}

// 분수가 든 인라인 수식 표시(줄 간격 보정용 클래스)
function markInlineFractions() {
  return (tree) => {
    const has = (n) => (n.properties?.className ?? []).includes("mfrac") || (n.children ?? []).some(has);
    visit(tree, "element", (n, i, parent) => {
      const cls = n.properties?.className ?? [];
      if (cls.includes("katex") && !(parent?.properties?.className ?? []).includes("katex-display") && has(n)) cls.push("has-frac");
    });
  };
}

export function renderChapter(src, opts = {}) {
  const { meta, body } = splitFrontMatter(src);
  const html = String(
    unified()
      .use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective)
      .use(printDirectives(opts))
      .use(dropEmptyHeadings)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex, { strict: false })
      .use(markInlineFractions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .processSync(body)
  );
  return { meta, html };
}
