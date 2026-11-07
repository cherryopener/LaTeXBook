// 장 원고 → <section class="chapter"> (docs/INTERFACES.md 6절의 HTML 모양)
import { unified, remarkRehype, rehypeStringify, katex } from "../../vendor/remark.js";
import { withPrintDefaults } from "../types.js";
import { renderPlot } from "../plot/index.js";
import { esc, text, splitFrontMatter, mapAssetPath, cleanSvg, plotWidth, clampPct } from "./util.js";
import { prepare, stripLabels, HIDDEN } from "./prepare.js";
import { checkRawHtml, sanitizeSvg } from "./sanitize.js";

const CALLOUT_TITLE = { note: "참고", tip: "팁", warn: "주의", think: "더 생각해 보기" };
const COLORS = new Set(["red", "blue", "green"]);

const toHast = unified().use(remarkRehype, { allowDangerousHtml: true });
const toText = unified().use(rehypeStringify, { allowDangerousHtml: true });
function mdastToHtml(nodes) {
  return String(toText.stringify(toHast.runSync({ type: "root", children: nodes })));
}

// 변환기가 직접 만든 HTML(믿을 수 있음). 원고에서 온 날 HTML은 tx의 "html" 경우에서 따로 거른다
const html = (value) => ({ type: "html", value, data: { trusted: true } });
const el = (tag, props, children = []) => ({ type: "el", data: { hName: tag, hProperties: props }, children });

export function renderChapterImpl(source, ctx = {}) {
  const warnings = [];
  const { meta: fm, body, lineOffset } = splitFrontMatter(source);
  const P = ctx.partNo ?? 1, C = ctx.chapterNo ?? 1;
  const print = ctx.print ?? withPrintDefaults({});
  const edition = ctx.edition === "teacher" ? "teacher" : "student";
  const palette = ctx.palette ?? print.palette ?? "teal";
  const resolveAsset = ctx.resolveAsset ?? ((s) => s);
  const readSvg = ctx.readSvg ?? (() => null);
  const teacher = edition === "teacher";

  const lineOf = (n) => (n?.position ? n.position.start.line + lineOffset : undefined);
  const warn = (code, message, n) => {
    const w = { code, message };
    const line = lineOf(n);
    if (line !== undefined) w.line = line;
    warnings.push(w);
  };
  const dl = (n) => { const l = lineOf(n); return l === undefined ? {} : { dataLine: l }; };
  const dlAttr = (n) => { const l = lineOf(n); return l === undefined ? "" : ` data-line="${l}"`; };
  const srcOf = (n) => (n.position ? body.slice(n.position.start.offset, n.position.end.offset) : "");

  const { theory, problems, labels, meta } = prepare(body, { print, partNo: P, chapterNo: C, chapterSeq: ctx.chapterSeq, warn, lineOf });
  let svgCount = 0;

  // KaTeX: 오류는 경고로, 분수가 든 인라인 수식은 has-frac
  function tex(src, display, node) {
    const opt = { displayMode: display, strict: "ignore", output: "htmlAndMathml" };
    let out;
    try {
      out = katex.renderToString(src, { ...opt, throwOnError: true });
    } catch (e) {
      warn("bad-math", `수식을 해석하지 못했습니다: ${String(e?.message ?? e).replace(/^KaTeX parse error:\s*/, "")}`, node);
      try { out = katex.renderToString(src, { ...opt, throwOnError: false }); }
      catch { out = `<span class="katex-error">${esc(src)}</span>`; }
    }
    if (!display && out.includes('class="mfrac"')) out = out.replace('<span class="katex">', '<span class="katex has-frac">');
    return out;
  }

  function svgBody(svg) {
    svgCount++;
    // 스크립트·이벤트 속성·외부 링크를 지운 뒤 넣는다(같은 문서에 그려지므로)
    const safe = sanitizeSvg(svg);
    return safe ? cleanSvg(safe, `svg${P}-${C}-${svgCount}-`) : "";
  }

  // 그림 본문(SVG 직접 삽입 또는 img). 없으면 missing-image
  function figBody(n, w, alt) {
    const raw = n.attributes?.src ?? "";
    const src = mapAssetPath(raw);
    const style = `width:${w}%`;
    if (!src) {
      warn("missing-image", "그림 경로(src)가 없습니다.", n);
      return `<div class="fig-body missing" style="${style}"></div>`;
    }
    const url = resolveAsset(src);
    if (/\.svg$/i.test(src)) {
      let svg = null;
      try { svg = readSvg(src); } catch { svg = null; }
      if (svg) return `<div class="fig-body" style="${style}">${svgBody(svg)}</div>`;
    }
    if (!url) {
      warn("missing-image", `그림 파일이 없습니다: ${src}`, n);
      return `<div class="fig-body missing" style="${style}" data-src="${esc(src)}"></div>`;
    }
    return `<div class="fig-body" style="${style}"><img src="${esc(url)}" alt="${esc(alt)}"></div>`;
  }

  function figure(n, env) {
    const w = clampPct(n.attributes?.w, 100);
    const caption = n.children ?? [];
    const props = { className: ["fig"] };
    if (n._id) props.id = n._id;
    if (n._no) props.dataNo = n._no;
    Object.assign(props, dl(n));
    const kids = [html(figBody(n, w, text(n).trim()))];
    if (n._no || caption.length) {
      const cap = [];
      if (n._no) cap.push(html(`<span class="fig-no">그림 ${n._no}</span>`));
      if (caption.length) cap.push({ type: "text", value: n._no ? " " : "" }, ...txAll(caption, env));
      kids.push(el("figcaption", {}, cap));
    }
    return el("figure", props, kids);
  }

  function plot(n) {
    const spec = n.value ?? "";
    const w = plotWidth(spec);
    let svg = "";
    try {
      const r = (ctx.plot ?? renderPlot)(spec, { palette });
      svg = r?.svg ?? "";
      for (const e of r?.errors ?? []) warn("plot-error", `그래프: ${e}`, n);
    } catch (e) {
      warn("plot-error", `그래프를 그리지 못했습니다: ${String(e?.message ?? e)}`, n);
      svg = "";
    }
    const bodyCls = svg ? "fig-body" : "fig-body empty";
    return html(`<figure class="fig plot"${dlAttr(n)}><div class="${bodyCls}" style="width:${w}%">${svg ? svgBody(svg) : ""}</div></figure>`);
  }

  function blank(n, env) {
    meta.blanks++;
    const hasMath = (x) => x.type === "inlineMath" || (x.children ?? []).some(hasMath);
    if (n.children.some(hasMath)) {
      return el("span", { className: ["blank", teacher ? "answer" : "empty", "math"] }, txAll(n.children, env));
    }
    let out = "", gap = false;
    for (const ch of Array.from(text(n))) {
      if (/\s/.test(ch)) { gap = true; continue; }
      if (gap && out) out += '<span class="gap"></span>';
      gap = false;
      out += `<span class="slot">${teacher ? esc(ch) : ""}</span>`;
    }
    return html(`<span class="blank ${teacher ? "answer" : "empty"}">${out}</span>`);
  }

  function ref(n) {
    const name = text(n).trim();
    const t = labels.get(name);
    if (!t) {
      warn("unknown-ref", `참조 대상 "${name}"이(가) 이 장에 없습니다.`, n);
      return html(`<span class="ref unknown">??</span>`);
    }
    return html(`<a class="ref" href="#${esc(t.id)}">${t.kind === "eq" ? `(${t.no})` : `그림 ${t.no}`}</a>`);
  }

  // 상자 제목: [제목] 라벨이 있으면 그것, 없으면 기본 제목
  function titled(n, env, titleClass, defTitle) {
    const kids = n.children ?? [];
    const lab = kids[0]?.data?.directiveLabel ? kids[0] : null;
    const rest = lab ? kids.slice(1) : kids;
    const out = [];
    if (lab) out.push(el("p", { className: [titleClass] }, txAll(lab.children, env)));
    else if (defTitle) out.push(el("p", { className: [titleClass] }, [{ type: "text", value: defTitle }]));
    return out.concat(txAll(rest, env));
  }
  const unlabeled = (n) => (n.children ?? []).filter((c) => !c.data?.directiveLabel);

  function problem(n, env) {
    const kids = unlabeled(n);
    const isSol = (c) => c.type === "containerDirective" && c.name === "solution";
    const inner = { ...env, inProblem: true };
    const out = [html(`<div class="problem-no">${esc(n._no ?? "")}</div>`), el("div", { className: ["problem-body"] }, txAll(kids.filter((c) => !isSol(c)), inner))];
    if (teacher) for (const s of kids.filter(isSol)) out.push(el("div", { className: ["solution"], ...dl(s) }, txAll(unlabeled(s), inner)));
    const props = { className: ["problem"], ...dl(n) };
    if (n._id) props.id = n._id;
    return el("article", props, out);
  }

  function container(n, env) {
    const name = n.name;
    const box = (cls, kids) => el("div", { className: [cls], ...dl(n) }, kids);
    if (CALLOUT_TITLE[name]) return el("aside", { className: ["callout", name], ...dl(n) }, titled(n, env, "callout-title", CALLOUT_TITLE[name]));
    switch (name) {
      case "side":
        if (env.section !== "theory") {
          warn("side-outside-theory", ":::side는 개념 구간에서만 씁니다. 보통 상자로 넣었습니다.", n);
          return el("aside", { className: ["callout", "note"], ...dl(n) }, titled(n, env, "callout-title", CALLOUT_TITLE.note));
        }
        return el("aside", { className: ["side"], ...dl(n) }, titled(n, { ...env, inSide: true }, "side-title", null));
      case "center": case "right": return box(name, txAll(unlabeled(n), env));
      // 한 문장 정의: 굵게·가운데, 앞뒤에 독일식 따옴표 „ “ (테마가 붙임). 2026-11-07 사용자 요청
      case "def": return box("def", txAll(unlabeled(n), env));
      case "columns": return box("columns-2", txAll(unlabeled(n), env));
      case "figs": return box("figs", txAll(unlabeled(n), env));
      // 학생용도 같은 자리를 차지하게 내보내고(테마가 글자를 숨김) 두 판의 쪽 위치를 맞춘다
      case "teacher": return box(teacher ? "teacher-only" : "teacher-only placeholder", txAll(unlabeled(n), env));
      case "solution": return teacher ? box("solution", txAll(unlabeled(n), env)) : null;
      case "problem": return problem(n, env);
      default:
        if (HIDDEN.has(name)) return null;
        warn("unknown-directive", `모르는 상자 디렉티브 :::${name} — 안의 내용만 넣었습니다.`, n);
        return box("directive", txAll(unlabeled(n), env));
    }
  }

  function leaf(n, env) {
    switch (n.name) {
      case "fig": return figure(n, env);
      case "space": {
        const h = parseFloat(n.attributes?.h);
        return html(`<div class="space" style="height:${Number.isFinite(h) && h > 0 ? h : 10}mm"${dlAttr(n)}></div>`);
      }
      case "pagebreak": return html(`<div class="pagebreak"${dlAttr(n)}></div>`);
      case "columnbreak": return html(`<div class="columnbreak"${dlAttr(n)}></div>`);
      case "problems":
        warn("unknown-directive", "::problems는 장의 맨 바깥에 한 번만 씁니다. 무시했습니다.", n);
        return null;
      default:
        if (HIDDEN.has(n.name)) return null;
        warn("unknown-directive", `모르는 디렉티브 ::${n.name} — 인쇄에서 뺐습니다.`, n);
        return null;
    }
  }

  function inline(n, env) {
    switch (n.name) {
      case "blank": return blank(n, env);
      case "ref": return ref(n);
      case "hl": return el("mark", {}, txAll(n.children, env));
      default:
        if (COLORS.has(n.name)) return el("span", { className: ["c-" + n.name] }, txAll(n.children, env));
        // 모르는 글자 디렉티브는 원래 글자로("비율 1:abc")
        return { type: "text", value: srcOf(n) || ":" + n.name };
    }
  }

  function math(n) {
    if (n._no) {
      const k = tex(stripLabels(n.value) + `\\tag{${n._no}}`, true, n);
      return html(`<div class="eq" id="${esc(n._id)}" data-no="${n._no}"${dlAttr(n)}>${k}</div>`);
    }
    const k = tex(stripLabels(n.value), true, n);
    const l = lineOf(n);
    return html(l === undefined ? k : k.replace('<span class="katex-display">', `<span class="katex-display" data-line="${l}">`));
  }

  function tx(n, env) {
    switch (n.type) {
      case "heading": {
        const props = { ...dl(n) };
        const kids = txAll(n.children, env);
        if (n._no) {
          props.className = [n.depth === 2 ? "sec" : "sub"];
          props.id = n._id;
          if (print.headingNumbers !== false) kids.unshift(html(`<span class="sec-no">${n._no}</span>`), { type: "text", value: " " });
        }
        return { ...n, data: { hProperties: props }, children: kids };
      }
      case "paragraph": case "list": case "table": case "blockquote":
        return { ...n, data: { ...(n.data ?? {}), hProperties: { ...(n.data?.hProperties ?? {}), ...dl(n) } }, children: txAll(n.children, env) };
      case "math": return math(n);
      case "inlineMath": return html(tex(stripLabels(n.value), false, n));
      case "code":
        if (n.lang === "plot") return plot(n);
        return { ...n, data: { hProperties: dl(n) } };
      case "image": {
        const src = mapAssetPath(n.url);
        const url = resolveAsset(src);
        if (!url) {
          // 저장소에 없는 그림(외부 주소 포함)은 주소를 내보내지 않는다(외부 요청·추적 방지. 보안 검토 지적 8)
          warn("missing-image", `그림 파일이 없습니다: ${src}`, n);
          return html(`<span class="fig-body missing" data-src="${esc(src)}"></span>`);
        }
        return { ...n, url };
      }
      case "html": {
        if (n.data?.trusted) return n;
        // 원고 속 날 HTML: 간단한 글자 꾸밈 태그만 허용, 나머지는 글자 그대로 보이게
        const c = checkRawHtml(n.value);
        if (c.ok) return html(c.value);
        warn("raw-html", "원고 속 HTML은 보안상 글자 그대로 둡니다(허용: br sup sub b i u s em strong small mark).", n);
        return { type: "text", value: n.value, position: n.position };
      }
      case "containerDirective": return container(n, env);
      case "leafDirective": return leaf(n, env);
      case "textDirective": return inline(n, env);
      default:
        return n.children ? { ...n, children: txAll(n.children, env) } : n;
    }
  }
  function txAll(list, env) {
    const out = [];
    for (const n of list ?? []) {
      const r = tx(n, env);
      if (r) out.push(r);
    }
    return out;
  }

  const title = fm.title ?? "";
  const head = (mode) =>
    `<header class="chapter-head" data-mode="${mode}"><nav class="tabs">` +
    `<span class="tab tab-theory${mode === "theory" ? " on" : ""}">THEORY</span>` +
    `<span class="tab tab-problems${mode === "problems" ? " on" : ""}">PROBLEMS</span></nav>` +
    `<div class="band"><span class="chapter-no">${ctx.chapterSeq ?? C}</span><h1 class="chapter-title">${esc(title)}</h1></div></header>`;

  // 문항 처리를 위해 개념 구간을 먼저 변환(그림·SVG 순서가 원고 순서와 같게)
  const theoryHtml = mdastToHtml(txAll(theory, { section: "theory" }));
  let out =
    `<section class="chapter" id="ch-${P}-${C}" data-palette="${esc(palette)}" data-part="${P}" data-chapter="${C}" data-edition="${edition}">\n` +
    `<section class="theory">${head("theory")}\n<div class="theory-body">\n${theoryHtml}\n</div>\n</section>\n`;
  if (problems) {
    const probHtml = mdastToHtml(txAll(problems, { section: "problems" }));
    out += `<section class="problems">${head("problems")}\n<div class="problem-list">\n${probHtml}\n</div>\n</section>\n`;
  }
  out += `</section>`;

  return { html: out, meta: { title, ...meta }, warnings };
}
