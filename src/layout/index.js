// 조판·인쇄 — 담당: C. 약속: docs/INTERFACES.md 7절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
import { BASE_STYLESHEETS, latinFontCss, LATIN_FONTS } from "../assets.js";
// Vivliostyle은 브라우저 전용이라 필요할 때만 불러온다(buildDocument는 Node에서도 쓰므로)
let V = null;
const loadVivliostyle = async () => (V ??= await import("../../vendor/vivliostyle.js"));

/**
 * 글자 크기(pt) 칸: 본문·옆 단(좁은 단)·문제. book.json의 print.fontSizes = { body, side, problem }.
 * default는 테마(cyber)의 값. 해설은 문제 크기를 따라간다(테마 비율 9.2/9.6).
 */
export const FONT_SIZES = Object.freeze({
  body: Object.freeze({ label: "본문", min: 8, max: 14, default: 10.4 }),
  side: Object.freeze({ label: "옆 단", min: 6, max: 11, default: 7.6 }),
  problem: Object.freeze({ label: "문제", min: 7, max: 13, default: 9.6 }),
});

/** 값 하나 → 쓸 수 있는 수(0.1 단위). 범위 밖·숫자 아님이면 null(테마 기본값 사용) */
export function fontSizeValue(kind, v) {
  const spec = FONT_SIZES[kind];
  if (!spec || v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < spec.min || n > spec.max) return null;
  return Math.round(n * 10) / 10;
}

/** print.fontSizes → { body, side, problem } (각각 수 또는 null) */
export function fontSizesOf(print = {}) {
  const fs = print?.fontSizes ?? {};
  return Object.fromEntries(Object.keys(FONT_SIZES).map((k) => [k, fontSizeValue(k, fs[k])]));
}

/** 글자 크기 CSS(테마 값을 덮어씀). 숫자만 넣으므로 CSS가 깨질 일이 없다 */
function fontSizeCss(print) {
  const { body, side, problem } = fontSizesOf(print);
  const r = (n) => Math.round(n * 100) / 100;
  const out = [];
  if (body !== null) out.push(`html { font-size: ${body}pt; }`);
  if (side !== null) out.push(`.side { font-size: ${side}pt; } .side .side-title { font-size: ${r(side * 8 / 7.6)}pt; }`);
  if (problem !== null) out.push(`.problem-body { font-size: ${problem}pt; } .solution { font-size: ${r(problem * 9.2 / 9.6)}pt; }`);
  return out.join("\n");
}

/** 인쇄소 배수(전체 쪽수가 이 수의 배수여야 함) */
export const PAGE_MULTIPLE = 16;

/** 판형별 @page 규칙 */
export const PAPER_CSS = {
  "a4": "@page { size: 210mm 297mm; }",
  "a4-bleed": "@page { size: 210mm 297mm; bleed: 3mm; marks: none; }",
  // 재단선판(marks)은 만들지 않는다: 인쇄소가 자기 장비에 맞춰 처리(사용자 결정 2026-11-07)
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const cssName = (n) => String(n ?? "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 64);
const strip = (html) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const abs = (rel) => new URL(rel, import.meta.url).href;

/**
 * 테마 CSS의 절대 주소.
 * baseUrl(편집기가 올라가 있는 주소, 끝에 /)을 주면 그 기준으로 만든다. Node에서 문서를 만들 때는 반드시 줘야 한다
 * (주지 않으면 이 파일 위치 기준이라 Node에서는 file:// 주소가 되어 브라우저가 읽지 못함).
 */
export function themeUrl(theme = "cyber", baseUrl) {
  const rel = `themes/${encodeURIComponent(theme)}/theme.css`;
  return baseUrl ? new URL(rel, baseUrl).href : abs(`../../${rel}`);
}

/**
 * 머리말용 running 요소(왼쪽 쪽: 시리즈 글씨 + 이름 태그, 오른쪽 쪽: 로고 + 장 제목).
 * 구간(개념·문제)의 장 머리 안에 넣는다 → first-except로 그 첫 쪽에는 머리말이 없다.
 */
function runningHeads(headHtml, print, resolveAsset) {
  const no = strip(/<span class="chapter-no">([\s\S]*?)<\/span>/.exec(headHtml)?.[1] ?? "");
  const title = strip(/<h1 class="chapter-title">([\s\S]*?)<\/h1>/.exec(headHtml)?.[1] ?? "");
  const s = print.series;
  const label = (s?.label ?? []).map((t, i) => `<span class="s${i + 1}">${esc(t)}</span>`).join("");
  const left = s
    ? `<div class="run-l"><span class="series">${label}</span>${s.tag ? `<span class="bracket"></span><span class="tag"><span>${esc(s.tag)}</span></span>` : ""}</div>`
    : `<div class="run-l"></div>`;
  const logo = print.logo ? `<img class="logo" alt="" src="${esc(resolveAsset(print.logo))}">` : `<span class="logo"></span>`;
  const right = `<div class="run-r">${logo}<span class="run-title">${esc(no ? `${no}. ${title}` : title)}</span></div>`;
  return left + right;
}

/**
 * 본문 HTML(render 결과)을 받아 인쇄 문서 전체를 만든다.
 * @param {string} bodyHtml
 * @param {{paper:string, edition:string, theme:string, print:object, resolveAsset:(s:string)=>string, title?:string}} settings
 * @returns {string}
 */
export function buildDocument(bodyHtml, settings) {
  const { paper = "a4", edition = "teacher", theme = "cyber", print = {}, title = "", baseUrl } = settings;
  const resolveAsset = settings.resolveAsset ?? ((s) => s);
  const toAbs = (u) => { try { return new URL(u, globalThis.location?.href).href; } catch { return u; } };

  // 장 머리마다 머리말 running 요소를 끼운다
  const body = bodyHtml.replace(/(<header class="chapter-head"[^>]*>)([\s\S]*?)(<\/header>)/g,
    (_, open, inner, close) => open + inner + runningHeads(inner, print, (s) => toAbs(resolveAsset(s))) + close);

  // 본문 글꼴: bodyFile이 있으면 @font-face로 불러와 맨 앞에 둔다
  let fontCss = "";
  if (print.fonts?.bodyFile) {
    // 글꼴 이름은 글자·숫자·공백·-·_만(줄바꿈·따옴표·\로 CSS를 끊고 규칙을 끼워 넣는 것을 막음. 보안 검토 지적 5)
    const name = cssName(print.fonts.body) || "BookBody";
    // 굵은 글씨 파일(bodyBoldFile)이 있으면 700으로 따로 등록(없으면 브라우저가 가짜 굵게를 만듦)
    const bold = print.fonts.bodyBoldFile
      ? `\n@font-face { font-family: "${esc(name)}"; src: url("${toAbs(resolveAsset(print.fonts.bodyBoldFile))}"); font-weight: 700; font-display: block; }` : "";
    fontCss = `@font-face { font-family: "${esc(name)}"; src: url("${toAbs(resolveAsset(print.fonts.bodyFile))}"); font-weight: ${print.fonts.bodyBoldFile ? 400 : "normal"}; font-display: block; }${bold}
:root { --font-body: "${esc(name)}", "Noto Serif KR", "KaTeX_Main", "KaTeX_AMS", serif; }`;
  } else if (cssName(print.fonts?.body)) {
    fontCss = `:root { --font-body: "${cssName(print.fonts.body)}", "Noto Serif KR", "KaTeX_Main", "KaTeX_AMS", serif; }`;
  }

  // 영어 글자 글꼴(print.fonts.latin: "Tinos"(기본) | "EB Garamond" | "none"). 테마가 "BookLatin"을 본문·옆 단 맨 앞에 둔다
  const latin = print.fonts?.latin ?? "Tinos";
  if (latin !== "none" && LATIN_FONTS[latin]) fontCss = `${latinFontCss(latin)}\n${fontCss}`;

  // 글자 크기(본문·옆 단·문제)
  const sizeCss = fontSizeCss(print);
  if (sizeCss) fontCss += `\n${sizeCss}`;

  const links = [...BASE_STYLESHEETS, themeUrl(theme, baseUrl)].map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join("\n");
  const attrs = [
    `lang="ko"`, `data-edition="${esc(edition)}"`, `data-paper="${esc(paper)}"`,
    `data-side="${print.sideColumn === "left" ? "left" : "outside"}"`,
    `data-chapter-start="${["right", "any"].includes(print.chapterStart) ? print.chapterStart : "left"}"`,
  ].join(" ");
  return `<!doctype html>
<html ${attrs}>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
${links}
<style>
${PAPER_CSS[paper] ?? PAPER_CSS.a4}
${fontCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** 렌더된 쪽들에서 경고를 찾는다(해설 넘침, 쪽수 배수) */
function collectWarnings(pageEls) {
  const warnings = [];
  const n = pageEls.length;
  if (n % PAGE_MULTIPLE) {
    const need = PAGE_MULTIPLE - (n % PAGE_MULTIPLE);
    warnings.push({ code: "page-multiple", message: `전체 ${n}쪽이 ${PAGE_MULTIPLE}의 배수가 아닙니다. 빈 쪽 ${need}쪽이 더 필요합니다.` });
  }
  // 문항 하나가 둘 이상의 단(또는 쪽)에 걸치면 넘침. 해설이 있는 문항만 경고.
  // 쪽을 넘으면 Vivliostyle이 쪽마다 조각을 만들고(id 유지), 같은 쪽 안에서 단을 넘으면 브라우저 다단 조각이 생긴다.
  // 조각 수 = 쪽별 getClientRects() 수의 합. 보이지 않는 쪽(display:none)은 잠시 보이게 해서 잰다.
  const seen = new Map(); // id → {count, page, line, hasSolution}
  pageEls.forEach((pg, i) => {
    const list = pg.querySelectorAll("article.problem");
    if (!list.length) return;
    const old = pg.style.display;
    pg.style.display = "block";
    for (const el of list) {
      const id = el.id || el.getAttribute("data-line");
      if (!id) continue;
      const e = seen.get(id) ?? { count: 0, page: i + 1, line: Number(el.getAttribute("data-line")) || undefined, hasSolution: false };
      e.count += Math.max(1, el.getClientRects().length);
      // 한 쪽 4·6문항(칸 높이 고정): 내용이 칸을 넘치면 경고
      if (/^[46]$/.test(el.parentElement?.getAttribute("data-per") ?? "")) {
        // 칸(높이 고정)을 넘침 → 경고. 교사용 해설은 흐름 밖(position:absolute)이라 아래 끝 위치로 따로 잰다:
        // 해설이 다음 칸에 겹쳐 찍혀도 괜찮다(2026-11-13 사용자 결정) → 알림만
        const sol = el.querySelector(".solution");
        if (sol && getComputedStyle(sol).position === "absolute") {
          if (sol.getBoundingClientRect().bottom > el.getBoundingClientRect().bottom + 2) e.solutionSpill = true;
          const body = el.querySelector(".problem-body");
          if (body && body.getBoundingClientRect().bottom > el.getBoundingClientRect().bottom + 2) e.overflowFixed = true;
        } else if (el.scrollHeight > el.clientHeight + 2) e.overflowFixed = true;
      }
      if (el.querySelector(".solution")) e.hasSolution = true;
      seen.set(id, e);
    }
    pg.style.display = old;
  });
  for (const [id, e] of seen) {
    if (e.overflowFixed) warnings.push({ code: "problem-overflow", message: `${id.split("-").pop()}번 문항이 칸(한 쪽 4·6문항)을 넘칩니다(${e.page}쪽). 글·그림·::space를 줄이거나 한 쪽 문항 수를 줄이세요.`, line: e.line });
    if (e.solutionSpill) warnings.push({ code: "solution-spill", message: `${id.split("-").pop()}번 문항의 해설이 칸을 넘쳐 다음 칸에 겹칩니다(${e.page}쪽, 교사용).`, line: e.line });
    if (e.count > 1 && e.hasSolution) {
      const no = id.split("-").pop();
      warnings.push({ code: "solution-overflow", message: `${no}번 문항의 해설이 단을 넘칩니다(${e.page}쪽). 교사용과 학생용의 쪽 번호가 어긋납니다.`, line: e.line });
    }
  }
  return warnings;
}

/**
 * 미리보기. container 안에 Vivliostyle 화면을 만든다.
 * @param {HTMLElement} container
 * @param {{spread?:boolean, zoom?:number}} [opts]  spread: 펼친 쪽으로 보기
 */
export function createPreview(container, opts = {}) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (win.getComputedStyle(container).position === "static") container.style.position = "relative";
  const vp = doc.createElement("div");
  vp.className = "layout-preview-vp";
  vp.style.cssText = "position:absolute;inset:0;overflow:auto";
  container.appendChild(vp);
  // 이 화면을 그대로 인쇄할 때(시험의 page.pdf 등) 첫 쪽만 잘려 나오지 않게
  if (!doc.getElementById("layout-preview-print")) {
    const st = doc.createElement("style");
    st.id = "layout-preview-print";
    // 화면: 모든 쪽을 위아래로 이어 스크롤로 넘겨 보게(Vivliostyle은 기본으로 지금 쪽 하나만 보여 줌)
    st.textContent = "@media print{.layout-preview-vp{position:static!important;overflow:visible!important}}"
      + "@media screen{.layout-preview-vp [data-vivliostyle-outer-zoom-box]{overflow:visible!important}"
      + ".layout-preview-vp [data-vivliostyle-spread-container]{display:block!important}"
      + ".layout-preview-vp [data-vivliostyle-page-container]{display:block!important;margin:0 auto 14px!important;box-shadow:0 1px 6px rgba(0,0,0,.28)}}";
    doc.head.appendChild(st);
  }
  let viewer = null;
  let zoom = opts.zoom ?? 1;
  let url = null;
  let lineMap = []; // [줄, 쪽] 줄 순서
  let pending = null;
  // 첫 show()에서 엔진을 불러와 viewer를 만든다
  const ensureViewer = async () => {
    if (viewer) return viewer;
    const { CoreViewer, ReadyState } = await loadVivliostyle();
    viewer = new CoreViewer({ viewportElement: vp, window: win }, {
      renderAllPages: true, autoResize: false, zoom, // 창 크기가 바뀌면 app이 setZoom으로 배율만 바꾼다
      pageViewMode: opts.spread ? "spread" : "singlePage",
    });
    viewer.addListener("readystatechange", () => {
      if (viewer.readyState === ReadyState.COMPLETE && pending) { const p = pending; pending = null; p.ok(); }
    });
    viewer.addListener("error", (p) => {
      const msg = String(p.content?.error ?? p.content?.messages ?? "");
      if (pending && /fatal/i.test(msg)) { const q = pending; pending = null; q.fail(new Error(msg)); }
    });
    return viewer;
  };

  const pageEls = () => [...vp.querySelectorAll("[data-vivliostyle-page-container]")];
  // 바깥 상자는 한 쪽 높이로 고정되어 있으므로 전체 쪽 길이에 맞춘다(스크롤이 끝까지 되게)
  const fitHeight = (pages) => {
    const outer = vp.querySelector("[data-vivliostyle-outer-zoom-box]");
    const last = pages[pages.length - 1];
    if (!outer || !last) return;
    outer.style.height = `${Math.ceil(last.getBoundingClientRect().bottom - outer.getBoundingClientRect().top + 16)}px`;
  };

  return {
    async show(docHtml) {
      const t0 = performance.now();
      await ensureViewer();
      const old = url;
      url = URL.createObjectURL(new Blob([docHtml], { type: "text/html" }));
      const done = new Promise((ok, fail) => { pending = { ok, fail }; });
      viewer.loadDocument({ url }, undefined, { zoom }); // 지금 배율로 그린다(setZoom 직후에도 어긋나지 않게)
      await done;
      if (old) URL.revokeObjectURL(old);
      const pages = pageEls();
      // data-line → 쪽 번호(처음 나오는 쪽)
      const first = new Map();
      pages.forEach((pg, i) => {
        for (const el of pg.querySelectorAll("[data-line]")) {
          const l = Number(el.getAttribute("data-line"));
          if (!first.has(l)) first.set(l, i + 1);
        }
      });
      lineMap = [...first].sort((a, b) => a[0] - b[0]);
      const warnings = collectWarnings(pages);
      fitHeight(pages);
      return { pages: pages.length, ms: Math.round(performance.now() - t0), warnings };
    },
    /** 지금 배율(1 = 실제 크기) */
    get zoom() { return zoom; },
    /**
     * 배율만 바꾼다(다시 조판하지 않음). 기준점(at, 없으면 화면 가운데)에 보이던 곳을 그 자리에 둔다.
     * 아직 문서를 그리기 전이면 다음 show()에 적용된다.
     */
    async setZoom(z, at) {
      if (!(z > 0) || Math.abs(z - zoom) < 1e-4) return;
      // 기준점(화면 좌표, 예: 마우스 위치). 없으면 미리보기 가운데
      const r = vp.getBoundingClientRect();
      const ax = at ? Math.max(0, Math.min(vp.clientWidth, at.x - r.left)) : vp.clientWidth / 2;
      const ay = at ? Math.max(0, Math.min(vp.clientHeight, at.y - r.top)) : vp.clientHeight / 2;
      const fx = (vp.scrollLeft + ax) / Math.max(1, vp.scrollWidth);
      const fy = (vp.scrollTop + ay) / Math.max(1, vp.scrollHeight);
      zoom = z;
      if (!viewer) return;
      const outer = vp.querySelector("[data-vivliostyle-outer-zoom-box]");
      const w0 = outer?.style.width;
      viewer.setOptions({ zoom: z });
      if (!outer) return;
      // Vivliostyle은 다음 차례에 배율을 적용한다: 바깥 상자 폭이 바뀔 때까지 기다린다(최대 약 1초)
      for (let i = 0; i < 60 && outer.style.width === w0; i++) await new Promise((ok) => win.requestAnimationFrame(ok));
      if (zoom !== z) return; // 기다리는 사이 또 바뀜
      fitHeight(pageEls());
      vp.scrollLeft = fx * vp.scrollWidth - ax;
      vp.scrollTop = fy * vp.scrollHeight - ay;
    },
    goToPage(n) {
      // 모든 쪽이 이어져 보이므로 그 쪽으로 스크롤한다
      const el = pageEls()[Math.max(0, n - 1)];
      if (el) vp.scrollTop += el.getBoundingClientRect().top - vp.getBoundingClientRect().top - 8;
    },
    /** 지금 화면 위쪽에 보이는 쪽 번호(1부터) */
    currentPage() {
      const top = vp.getBoundingClientRect().top + 40;
      const ps = pageEls();
      let n = 1;
      ps.forEach((p, i) => { if (p.getBoundingClientRect().top <= top) n = i + 1; });
      return n;
    },
    pageOfLine(line) {
      let page = null;
      for (const [l, p] of lineMap) { if (l > line) break; page = p; }
      return page;
    },
    destroy() {
      pending = null;
      if (url) URL.revokeObjectURL(url);
      vp.remove();
    },
    /** 시험용: 내부 viewer */
    get viewer() { return viewer; },
  };
}

/**
 * 브라우저 인쇄 창을 연다(PDF로 저장). 문서를 숨은 iframe에서 다시 조판한다.
 * Vivliostyle printHTML은 iframe에 인라인 onload를 넣는데, 편집기의 보안 정책(CSP: 인라인 스크립트 금지)에 막힌다.
 * 그래서 만든 직후 iframe 문서에서 onload를 빼고, 같은 일을 load 이벤트로 한다.
 */
export function printPdf(docHtml, opts = {}) {
  return loadVivliostyle().then(({ printHTML }) => {
    printHTML(docHtml, {
      title: opts.title ?? "",
      printCallback: (w) => w.print(),
      errorCallback: (m) => console.error("printPdf:", m),
      hideIframe: true,
      removeIframe: true,
    });
    const inst = window.printInstance;
    const fr = inst?.iframe;
    if (!fr) return;
    fr.srcdoc = fr.srcdoc.replace(/\sonload=(['"])[\s\S]*?\1/, "");
    fr.addEventListener("load", () => inst.runInIframe(fr.contentWindow), { once: true });
  });
}
