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
  (book?.parts ?? []).forEach((part, pi) => {
    const P = pi + 1;
    if (range.part && range.part !== P) return;
    const palette = part.palette ?? partPalette(part.config ?? {}, print);
    const partTitle = part.config?.title ?? part.dir ?? "";
    const one = range.part && range.chapter ? range.chapter : null;
    const chapters = (part.chapters ?? []).map((ch, ci) => {
      if (one && one !== ci + 1) return null;
      const r = renderChapterImpl(ch.source ?? "", { ...base, partNo: P, chapterNo: ci + 1, palette, print });
      for (const w of r.warnings) warnings.push(ch.path ? { ...w, path: ch.path } : w);
      return { no: ci + 1, ...r };
    }).filter(Boolean);
    if (!one) {
      toc.push({ part: P, title: partTitle });
      html.push(
        `<section class="part-cover" data-palette="${esc(palette)}" data-part="${P}">\n` +
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
  return { html: html.join("\n"), toc, warnings };
}

/** @returns {{source:string, files:Array<{path:string,text:string}>}} */
export function exportPhysiklar(source, ctx) {
  return exportPhysiklarImpl(source, ctx ?? {});
}
