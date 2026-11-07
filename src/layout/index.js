// 조판·인쇄 — 담당: C. 약속: docs/INTERFACES.md 7절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
import { BASE_STYLESHEETS } from "../assets.js";
// Vivliostyle은 브라우저 전용이라 필요할 때만 불러온다(buildDocument는 Node에서도 쓰므로)
let V = null;
const loadVivliostyle = async () => (V ??= await import("../../vendor/vivliostyle.js"));

/** 인쇄소 배수(전체 쪽수가 이 수의 배수여야 함) */
export const PAGE_MULTIPLE = 16;

/** 판형별 @page 규칙 */
export const PAPER_CSS = {
  "a4": "@page { size: 210mm 297mm; }",
  "a4-bleed": "@page { size: 210mm 297mm; bleed: 3mm; marks: none; }",
  // 재단선판(marks)은 만들지 않는다: 인쇄소가 자기 장비에 맞춰 처리(사용자 결정 2026-11-07)
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
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
    const name = print.fonts.body || "BookBody";
    fontCss = `@font-face { font-family: "${esc(name)}"; src: url("${toAbs(resolveAsset(print.fonts.bodyFile))}"); font-display: block; }
:root { --font-body: "${esc(name)}", "Noto Serif KR", serif; }`;
  } else if (print.fonts?.body) {
    fontCss = `:root { --font-body: "${esc(print.fonts.body)}", "Noto Serif KR", serif; }`;
  }

  const links = [...BASE_STYLESHEETS, themeUrl(theme, baseUrl)].map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join("\n");
  const attrs = [
    `lang="ko"`, `data-edition="${esc(edition)}"`, `data-paper="${esc(paper)}"`,
    `data-side="${print.sideColumn === "left" ? "left" : "outside"}"`,
    `data-chapter-start="${print.chapterStart === "any" ? "any" : "right"}"`,
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
      if (el.querySelector(".solution")) e.hasSolution = true;
      seen.set(id, e);
    }
    pg.style.display = old;
  });
  for (const [id, e] of seen) {
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
    st.textContent = "@media print{.layout-preview-vp{position:static!important;overflow:visible!important}}";
    doc.head.appendChild(st);
  }
  let viewer = null;
  let url = null;
  let lineMap = []; // [줄, 쪽] 줄 순서
  let pending = null;
  // 첫 show()에서 엔진을 불러와 viewer를 만든다
  const ensureViewer = async () => {
    if (viewer) return viewer;
    const { CoreViewer, ReadyState } = await loadVivliostyle();
    viewer = new CoreViewer({ viewportElement: vp, window: win }, {
      renderAllPages: true, autoResize: true, zoom: opts.zoom ?? 1,
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

  return {
    async show(docHtml) {
      const t0 = performance.now();
      await ensureViewer();
      const old = url;
      url = URL.createObjectURL(new Blob([docHtml], { type: "text/html" }));
      const done = new Promise((ok, fail) => { pending = { ok, fail }; });
      viewer.loadDocument({ url });
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
      return { pages: pages.length, ms: Math.round(performance.now() - t0), warnings: collectWarnings(pages) };
    },
    goToPage(n) {
      if (viewer && V) viewer.navigateToPage(V.Navigation.EPAGE, Math.max(0, n - 1));
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

/** 브라우저 인쇄 창을 연다(PDF로 저장). 문서를 숨은 iframe에서 다시 조판한다. */
export function printPdf(docHtml, opts = {}) {
  return loadVivliostyle().then(({ printHTML }) => printHTML(docHtml, {
    title: opts.title ?? "",
    printCallback: (w) => w.print(),
    errorCallback: (m) => console.error("printPdf:", m),
    hideIframe: true,
    removeIframe: true,
  }));
}
