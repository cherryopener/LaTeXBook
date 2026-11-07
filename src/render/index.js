// 원고 변환 — 담당: B. 약속: docs/INTERFACES.md 4절·6절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
import { withPrintDefaults, partPalette } from "../types.js";
import { esc } from "./util.js";
import { renderChapterImpl } from "./chapter.js";
import { exportPhysiklarImpl } from "./export.js";

/** @returns {{html:string, meta:Object, warnings:Array}} */
export function renderChapter(source, ctx) {
  return renderChapterImpl(source, ctx ?? {});
}

/** 부 표지 + 부 목차 + 장들. range로 부·장 하나만 고를 수 있음 */
/** @returns {{html:string, toc:Array, warnings:Array}} */
export function renderBook(book, opts = {}) {
  const print = book?.print ?? withPrintDefaults(book?.config ?? {});
  const range = opts.range ?? {};
  const { range: _r, ...base } = opts;
  const html = [], toc = [], warnings = [];
  let seq = 0; // 책 전체에서 몇 번째 장인지(식·그림 번호 앞자리). 미리보기로 일부만 그려도 같은 번호가 나오게 건너뛴 장도 센다
  (book?.parts ?? []).forEach((part, pi) => {
    const P = pi + 1;
    const seqBase = seq;
    seq += (part.chapters ?? []).length;
    if (range.part && range.part !== P) return;
    const palette = part.palette ?? partPalette(part.config ?? {}, print);
    const partTitle = part.config?.title ?? part.dir ?? "";
    const one = range.part && range.chapter ? range.chapter : null;
    const chapters = (part.chapters ?? []).map((ch, ci) => {
      if (one && one !== ci + 1) return null;
      const r = renderChapterImpl(ch.source ?? "", { ...base, partNo: P, chapterNo: ci + 1, chapterSeq: seqBase + ci + 1, palette, print });
      for (const w of r.warnings) warnings.push(ch.path ? { ...w, path: ch.path } : w);
      return { no: ci + 1, ...r };
    }).filter(Boolean);
    if (!one) {
      toc.push({ part: P, title: partTitle });
      html.push(
        `<section class="part-cover" id="part-${P}" data-palette="${esc(palette)}" data-part="${P}">\n` +
        `<div class="part-no">${String(P).padStart(2, "0")}</div>\n<h1 class="part-title">${esc(partTitle)}</h1>\n</section>`,
        `<section class="part-toc" data-palette="${esc(palette)}" data-part="${P}">\n<ol>` +
        chapters.map((c) => `<li><span class="toc-no">${c.no}.</span> ${esc(c.meta.title)}</li>`).join("") +
        `</ol>\n</section>`,
      );
    }
    for (const c of chapters) {
      toc.push({ part: P, chapter: c.no, title: c.meta.title });
      html.push(c.html);
    }
  });
  // 책 전체를 만들 때는 맨 앞에 책 첫 쪽(제목 + 한 쪽짜리 목차). 쪽수는 조판기가 링크 대상의 쪽 번호로 채운다
  if (!range.part) html.unshift(bookFront(book, print, toc, base.resolveAsset));
  return { html: html.join("\n"), toc, warnings };
}

/** 책 첫 쪽: 시리즈 글씨, 책 제목·부제, 목차(부·장, 쪽수 자동) */
function bookFront(book, print, toc, resolveAsset = (s) => s) {
  const cfg = book?.config ?? {};
  const series = (print.series?.label ?? []).join(" · ");
  // 윗부분 그림(print.front.image)과 그 위의 영어 제목(print.front.title). 그림이 없으면 색 띠로 대신한다
  const front = print.front ?? {};
  const img = front.image ? resolveAsset(front.image) : null;
  const art = `<div class="front-art${img ? " has-image" : ""}">` +
    (img ? `<img class="front-image" src="${esc(img)}" alt="">` : "") +
    `<div class="front-caption">${series ? `<p class="front-series">${esc(series)}</p>` : ""}` +
    `<p class="front-title">${esc(front.title ?? cfg.title ?? "")}</p>` +
    `<h1 class="book-title">${esc(cfg.title ?? book?.id ?? "")}</h1>` +
    `${cfg.subtitle ? `<p class="book-subtitle">${esc(cfg.subtitle)}</p>` : ""}</div></div>`;
  const item = (cls, href, no, title) =>
    `<li class="${cls}"><a href="#${href}"><span class="toc-no">${esc(no)}</span><span class="toc-title">${esc(title)}</span><span class="toc-fill"></span></a></li>`;
  const items = toc.map((t) => t.chapter
    ? item("toc-chapter", `ch-${t.part}-${t.chapter}`, `${t.chapter}`, t.title)
    : item("toc-part", `part-${t.part}`, String(t.part).padStart(2, "0"), t.title)).join("");
  return `<section class="book-front" data-palette="${esc(print.palette ?? "teal")}">\n` +
    `${art}\n` +
    `<nav class="book-toc"><h2>CONTENTS</h2><ol>${items}</ol></nav>\n</section>`;
}

/** @returns {{source:string, files:Array<{path:string,text:string}>}} */
export function exportPhysiklar(source, ctx) {
  return exportPhysiklarImpl(source, ctx ?? {});
}
