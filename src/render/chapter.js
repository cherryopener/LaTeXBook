// 장 원고 → <section class="chapter"> (docs/INTERFACES.md 6절의 HTML 모양)
import { unified, remarkRehype, rehypeStringify, katex } from "../../vendor/remark.js";
import { withPrintDefaults } from "../types.js";
import { renderPlot } from "../plot/index.js";
import { esc, text, splitFrontMatter, mapAssetPath, cleanSvg, plotWidth, clampPct, fixTables } from "./util.js";
import { prepare, stripLabels, HIDDEN } from "./prepare.js";
import { checkRawHtml, sanitizeSvg } from "./sanitize.js";

const CALLOUT_TITLE = { note: "참고", tip: "팁", warn: "주의", think: "더 생각해 보기" };
const COLORS = new Set(["red", "blue", "green"]);
// 5지선다 번호와 <보기> 번호(2026-11-10 사용자 요청). 줄 하나 = 항목 하나
const CHOICE_NO = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
const BOGI_NO = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 상자 안의 글을 줄(엔터)마다 나눈다. 문단 안의 줄바꿈·빈 줄 모두 항목 경계. 문단이 아닌 덩어리(식 등)는 그 자체로 한 항목 */
function splitLines(kids) {
  const items = [];
  for (const k of kids) {
    if (k.type !== "paragraph") { items.push([k]); continue; }
    let cur = [];
    const push = () => { if (cur.some((c) => c.type !== "text" || c.value.trim())) items.push(cur); cur = []; };
    for (const c of k.children ?? []) {
      if (c.type === "break") { push(); continue; }
      if (c.type !== "text" || !c.value.includes("\n")) { cur.push(c); continue; }
      c.value.split("\n").forEach((part, i) => { if (i) push(); if (part) cur.push({ ...c, value: part }); });
    }
    push();
  }
  // 줄 앞뒤 공백 정리
  for (const it of items) {
    const a = it[0], b = it[it.length - 1];
    if (a?.type === "text") it[0] = { ...a, value: a.value.replace(/^\s+/, "") };
    if (b?.type === "text") it[it.length - 1] = { ...it[it.length - 1], value: it[it.length - 1].value.replace(/\s+$/, "") };
  }
  return items;
}

/** 한 줄(인라인 노드들)을 | 로 칸 나눔. 수식 안의 |는 나누지 않음. 맨 앞·맨 끝의 |는 있어도 없어도 됨 */
function splitCells(nodes) {
  const cells = [[]];
  for (const c of nodes) {
    if (c.type !== "text" || !c.value.includes("|")) { cells[cells.length - 1].push(c); continue; }
    c.value.split("|").forEach((part, i) => { if (i) cells.push([]); if (part) cells[cells.length - 1].push({ ...c, value: part }); });
  }
  const trim = (cell) => {
    const out = cell.map((x) => x);
    if (out[0]?.type === "text") out[0] = { ...out[0], value: out[0].value.replace(/^\s+/, "") };
    const k = out.length - 1;
    if (out[k]?.type === "text") out[k] = { ...out[k], value: out[k].value.replace(/\s+$/, "") };
    return out.filter((x) => x.type !== "text" || x.value);
  };
  const t = cells.map(trim);
  if (t.length > 1 && !t[0].length) t.shift();
  if (t.length > 1 && !t[t.length - 1].length) t.pop();
  return t;
}
const hasPipe = (nodes) => nodes.some((c) => c.type === "text" && c.value.includes("|"));

/** 글 폭 어림(em). 한글 1, 로마자·숫자 0.47, 빈칸·좁은 기호 0.25~0.3, 수식은 명령을 한 글자로 쳐서 0.55 + 관계 기호 앞뒤 띄움 */
function textWidthEm(nodes) {
  let w = 0;
  const chars = (s) => { for (const ch of s) w += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : /\s/.test(ch) ? 0.25 : /[.,;:'"()\[\]|/²³¹°]/.test(ch) ? 0.3 : 0.47; };
  const walk = (n) => {
    if (n.type === "text") chars(n.value);
    else if (n.type === "inlineMath" || n.type === "math") {
      const v = String(n.value);
      w += 0.55 * v.replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_\s]/g, "").length + 0.55 * (v.match(/[<>=]|\\(?:le|ge|leq|geq|ne|neq|approx|propto|sim)\b/g) ?? []).length;
    }
    else for (const c of n.children ?? []) walk(c);
  };
  nodes.forEach(walk);
  return w;
}

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
  const { meta: fm, body: rawBody, lineOffset } = splitFrontMatter(source);
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
  // 칸 수가 맞지 않는 표를 고쳐 둔다(안 그러면 표 대신 글자로 찍힘)
  const body = fixTables(rawBody, (line, msg) => warn("table-fixed", msg, { position: { start: { line } } }));
  const dl = (n) => { const l = lineOf(n); return l === undefined ? {} : { dataLine: l }; };
  const dlAttr = (n) => { const l = lineOf(n); return l === undefined ? "" : ` data-line="${l}"`; };
  const srcOf = (n) => (n.position ? body.slice(n.position.start.offset, n.position.end.offset) : "");

  const { theory, problems, labels, meta, problemsPer, problemsFirst } = prepare(body, { print, partNo: P, chapterNo: C, chapterSeq: ctx.chapterSeq, warn, lineOf });
  let svgCount = 0;
  let exampleCount = 0;

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
    const strong = /(^|\s)strong(\s|$)/.test(n.attributes?.class ?? "");
    const hasMath = (x) => x.type === "inlineMath" || (x.children ?? []).some(hasMath);
    if (n.children.some(hasMath)) {
      return el("span", { className: ["blank", teacher ? "answer" : "empty", "math", ...(strong ? ["strong"] : [])] }, txAll(n.children, env));
    }
    let out = "", gap = false;
    for (const ch of Array.from(text(n))) {
      if (/\s/.test(ch)) { gap = true; continue; }
      if (gap && out) out += '<span class="gap"></span>';
      gap = false;
      out += `<span class="slot">${teacher ? esc(ch) : ""}</span>`;
    }
    return html(`<span class="blank ${teacher ? "answer" : "empty"}${strong ? " strong" : ""}">${out}</span>`);
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

  // 5지선다: 줄마다 ①②③④⑤. 한 줄에 몇 개 놓을지(5·3·2·1)는 가장 긴 항목의 글 폭으로 정한다. {cols=…}로 직접 정할 수도 있음
  function choices(n, env) {
    const items = splitLines(unlabeled(n));
    // 짝짓기 선지: 줄에 |가 있으면 표. 첫 줄은 머리((가) | (나)), 다음 줄부터 ①②③… 테두리 없음
    if (items.some(hasPipe)) {
      const rows = items.map(splitCells);
      const head = rows.shift() ?? [];
      const ncol = Math.max(head.length, ...rows.map((r) => r.length));
      if (rows.length > CHOICE_NO.length) warn("too-many-choices", `선지가 ${rows.length}개입니다. ${CHOICE_NO.length}개까지만 번호를 붙입니다.`, n);
      const cells = (r, tag) => Array.from({ length: ncol }, (_, i) => el(tag, {}, txAll(r[i] ?? [], env)));
      // 칸 폭은 colgroup으로 정한다(번호 칸은 좁게, 나머지는 고르게)
      const cols = [el("col", { className: ["c-no"] }, []), ...Array.from({ length: ncol }, () => el("col", { style: `width:${(100 / ncol).toFixed(3)}%` }, []))];
      return el("table", { className: ["choice-table"], dataCols: String(ncol), ...dl(n) }, [
        el("colgroup", {}, cols),
        el("thead", {}, [el("tr", {}, [el("th", { className: ["choice-no"] }, []), ...cells(head, "th")])]),
        el("tbody", {}, rows.map((r, i) => el("tr", {}, [el("td", { className: ["choice-no"] }, [{ type: "text", value: CHOICE_NO[i] ?? "" }]), ...cells(r, "td")]))),
      ]);
    }
    if (items.length > CHOICE_NO.length) warn("too-many-choices", `선지가 ${items.length}개입니다. ${CHOICE_NO.length}개까지만 번호를 붙입니다.`, n);
    const fsz = print.fontSizes ?? {};
    const pt = Number(env.section === "problems" ? fsz.problem ?? 9.6 : fsz.body ?? 10.4) || 10;
    const widthMm = env.section === "problems" ? 84.5 : env.inSide ? 38 : 132; // 문제 한 단 / 옆 단 / 개념 본문 폭
    const lineEm = widthMm / (pt * 0.3528);
    const widths = items.map((it) => textWidthEm(it) + 1.45); // 글 + 번호
    const want = Number(n.attributes?.cols);
    // 다섯 개를 한 줄에: 글 폭대로 놓고 사이를 고르게 벌림(시험지처럼). 사이 최소 0.8em
    const oneRow = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 0.8 <= lineEm;
    // 여러 줄: 같은 폭 칸(3·2·1개). 칸 폭 = 가장 긴 항목 + 오른쪽 띄움 0.6em
    const need = Math.max(0, ...widths) + 0.6;
    const cols = [1, 2, 3, 4, 5].includes(want) ? want : items.length >= 4 && oneRow ? 5 : [3, 2].find((c) => c < items.length && need * c <= lineEm) ?? 1;
    const kids = items.map((it, i) => el("span", { className: ["choice"] }, [html(`<span class="choice-no">${CHOICE_NO[i] ?? ""}</span>`), ...txAll(it, env)]));
    return el("div", { className: ["choices"], dataCols: String(cols), ...dl(n) }, kids);
  }

  // 탭 맞춤(:::tab): 줄마다 | 자리를 탭처럼 세로로 맞춘다. 테두리 없는 표로 만들며, 앞 칸들은 가장 긴 글 폭,
  // 마지막 칸은 남는 폭 전부(긴 글이 다음 줄로 넘어가도 그 칸의 시작에 맞춰짐). |가 없는 줄은 한 칸으로 줄 전체
  function tabBox(n, env) {
    const centered = n.attributes && "center" in n.attributes; // :::tab{center} → 표를 가운데에, 칸도 가운데
    const rows = splitLines(unlabeled(n)).map((it) => (hasPipe(it) ? splitCells(it) : [it]));
    const ncol = Math.max(1, ...rows.map((r) => r.length));
    const trs = rows.map((r) => el("tr", {}, r.map((cell, i) => {
      const props = {};
      if (i === r.length - 1 && r.length < ncol) props.colSpan = ncol - r.length + 1;
      if (!centered && i < ncol - 1 && !props.colSpan) props.className = ["tab-fit"];
      return el("td", props, txAll(cell, env));
    })));
    return el("table", { className: ["tab-table", ...(centered ? ["centered"] : [])], ...dl(n) }, [el("tbody", {}, trs)]);
  }

  // <보기> 상자: 줄마다 ㄱ. ㄴ. ㄷ. … [제목]이 있으면 "보기" 대신 그 제목
  function bogi(n, env) {
    const kids = n.children ?? [];
    const lab = kids[0]?.data?.directiveLabel ? kids[0] : null;
    const items = splitLines(unlabeled(n));
    if (items.length > BOGI_NO.length) warn("too-many-choices", `보기가 ${items.length}개입니다. ${BOGI_NO.length}개까지만 번호를 붙입니다.`, n);
    const title = el("div", { className: ["bogi-title"] }, lab ? txAll(lab.children, env) : [{ type: "text", value: "보기" }]);
    const list = items.map((it, i) => el("div", { className: ["bogi-item"] }, [html(`<span class="bogi-no">${BOGI_NO[i] ?? ""}.</span>`), ...txAll(it, env)]));
    return el("div", { className: ["bogi"], ...dl(n) }, [title, el("div", { className: ["bogi-body"] }, list)]);
  }

  function container(n, env) {
    const name = n.name;
    const box = (cls, kids) => el("div", { className: [cls], ...dl(n) }, kids);
    // 예제(풀이까지 본문에 보이는 계산 예): 장마다 "예제 1, 2, …" 자동 번호, [제목]은 번호 뒤에 붙는다. 2026-11-09 사용자 요청
    if (name === "example") {
      exampleCount++;
      const kids = n.children ?? [];
      const lab = kids[0]?.data?.directiveLabel ? kids[0] : null;
      const title = el("p", { className: ["callout-title"] }, [html(`<span class="example-no">예제 ${exampleCount}</span>`), ...(lab ? [{ type: "text", value: " " }, ...txAll(lab.children, env)] : [])]);
      return el("aside", { className: ["callout", "example"], ...dl(n) }, [title, ...txAll(lab ? kids.slice(1) : kids, env)]);
    }
    if (CALLOUT_TITLE[name]) return el("aside", { className: ["callout", name], ...dl(n) }, titled(n, env, "callout-title", CALLOUT_TITLE[name]));
    switch (name) {
      case "side":
        if (env.section !== "theory") {
          warn("side-outside-theory", ":::side는 개념 구간에서만 씁니다. 보통 상자로 넣었습니다.", n);
          return el("aside", { className: ["callout", "note"], ...dl(n) }, titled(n, env, "callout-title", CALLOUT_TITLE.note));
        }
        return el("aside", { className: ["side"], ...dl(n) }, titled(n, { ...env, inSide: true }, "side-title", null));
      case "center": case "right": case "left": return box(name, txAll(unlabeled(n), env));
      case "tab": return tabBox(n, env);
      // 한 문장 정의: 굵게·가운데, 앞뒤에 독일식 따옴표 „ “ (테마가 붙임). 2026-11-07 사용자 요청
      case "def": return box("def", txAll(unlabeled(n), env));
      case "columns": return box("columns-2", txAll(unlabeled(n), env));
      case "figs": return box("figs", txAll(unlabeled(n), env));
      // 학생용도 같은 자리를 차지하게 내보내고(테마가 글자를 숨김) 두 판의 쪽 위치를 맞춘다
      case "teacher": return box(teacher ? "teacher-only" : "teacher-only placeholder", txAll(unlabeled(n), env));
      case "solution": return teacher ? box("solution", txAll(unlabeled(n), env)) : null;
      case "problem": return problem(n, env);
      case "choices": return choices(n, env);
      case "bogi": return bogi(n, env);
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
  // 연습문제 장(문제만 있는 장, 번호 자리 Q): 빈 개념 쪽을 만들지 않고 바로 문제 구간
  const exercise = !!ctx.exercise && !!problems;
  let out =
    `<section class="chapter${exercise ? " exercise" : ""}" id="ch-${P}-${C}" data-palette="${esc(palette)}" data-part="${P}" data-chapter="${C}" data-edition="${edition}">\n` +
    (exercise ? "" : `<section class="theory">${head("theory")}\n<div class="theory-body">\n${theoryHtml}\n</div>\n</section>\n`);
  if (problems) {
    // 한 쪽에 문항 2개(기본)·4개·6개. 쪽마다 다르게 할 수 있다(2026-11-08 사용자 요청):
    //  - ::problems{per=6}            모든 쪽 6문항
    //  - ::problems{first=4 per=6}    첫 쪽(장 머리 띠가 있는 쪽)만 4문항, 다음 쪽부터 6문항
    //  - 문항 사이 ::page{per=6}       여기서 새 쪽을 시작하고 그 뒤로 6문항씩
    //  책 기본값: print.problemsPerPage
    const ok = (n) => [2, 4, 6].includes(n);
    const per = ok(problemsPer) ? problemsPer : ok(Number(print.problemsPerPage)) ? Number(print.problemsPerPage) : 2;
    const isProblem = (n) => n.type === "containerDirective" && n.name === "problem";
    const isPage = (n) => n.type === "leafDirective" && n.name === "page";
    // 문제 구간의 ::pagebreak(쪽 나눔)도 ::page처럼 새 쪽에서 문항 세기를 다시 시작한다(안 그러면 다음 문항이 "새 단" 규칙에 밀려 왼쪽 단이 빔). 한 쪽 문항 수는 그대로
    const isPageBreak = (n) => n.type === "leafDirective" && n.name === "pagebreak";
    const groups = [{ per: ok(problemsFirst) ? problemsFirst : per, limit: ok(problemsFirst) ? problemsFirst : Infinity, nodes: [], count: 0 }];
    for (const n of problems) {
      let g = groups[groups.length - 1];
      if (isPage(n)) {
        const p = Number(n.attributes?.per);
        groups.push({ per: ok(p) ? p : per, limit: Infinity, nodes: [], count: 0 });
        continue;
      }
      if (isPageBreak(n)) {
        if (!g.nodes.length) continue; // 이미 새 쪽 시작이면 무시
        groups.push({ per: g.limit === Infinity ? g.per : per, limit: Infinity, nodes: [], count: 0 });
        continue;
      }
      if (isProblem(n) && g.count >= g.limit) { g = { per, limit: Infinity, nodes: [], count: 0 }; groups.push(g); }
      g.nodes.push(n);
      if (isProblem(n)) g.count++;
    }
    const lists = groups.filter((g) => g.nodes.length).map((g, i) =>
      `<div class="problem-list${i ? " new-page" : ""}" data-per="${g.per}">\n${mdastToHtml(txAll(g.nodes, { section: "problems" }))}\n</div>`).join("\n");
    out += `<section class="problems">${head("problems")}\n${lists}\n</section>\n`;
  }
  out += `</section>`;

  return { html: out, meta: { title, ...meta }, warnings };
}
