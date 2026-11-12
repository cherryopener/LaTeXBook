// 원고 변환 — 담당: B. 약속: docs/INTERFACES.md 4절·6절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
import { withPrintDefaults, partPalette } from "../types.js";
import { esc, isExerciseChapter, EXERCISE_NO } from "./util.js";
import { renderChapterImpl } from "./chapter.js";
import { exportPhysiklarImpl } from "./export.js";

/** @returns {{html:string, meta:Object, warnings:Array}} */
export function renderChapter(source, ctx) {
  return renderChapterImpl(source, ctx ?? {});
}

/** 장 원고 속 문항(::::problem) 수. 미리보기에서 건너뛴 장의 문항을 셀 때 쓴다(코드 블록 안은 세지 않음) */
function countProblems(src) {
  let n = 0, fence = null;
  for (const line of String(src ?? "").split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
    if (!fence && /^\s*:{3,}problem(?=$|[\s{\[])/.test(line)) n++;
  }
  return n;
}

/** 로마 숫자(Part I, II, …) */
const roman = (n) => [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]
  .reduce((out, [v, r]) => { while (n >= v) { out += r; n -= v; } return out; }, "");

/**
 * 표지 + 부 쪽 + 장들. range로 부·장 하나만 고를 수 있음.
 * 구성은 두 가지(docs/FORMAT.md 1-2절):
 * - 큰 표지(Part) 모드: 어느 part.json에든 print.cover가 있으면, 그 부 앞에만 큰 표지("PART I" + 영어 제목)를 넣고,
 *   모든 부에는 흰 바탕 부 쪽(부 제목 + 장 목록)을 넣는다. Griffiths 책의 Part → Chapter 위계와 같다.
 * - 기본 모드: print.cover가 하나도 없으면 부마다 큰 표지(01 + 부 제목)와 부 목차를 넣는다(예전 방식).
 */
/** @returns {{html:string, toc:Array, warnings:Array}} */
export function renderBook(book, opts = {}) {
  const print = book?.print ?? withPrintDefaults(book?.config ?? {});
  const range = opts.range ?? {};
  const { range: _r, ...base } = opts;
  const html = [], toc = [], warnings = [];
  const parts = book?.parts ?? [];
  const coverOf = (part) => { const c = part?.config?.print?.cover; return c && typeof c === "object" ? c : c ? {} : null; };
  const coverMode = parts.some(coverOf);
  let seq = 0; // 책 전체에서 몇 번째 장인지(식·그림 번호 앞자리). 미리보기로 일부만 그려도 같은 번호가 나오게 건너뛴 장도 센다. 연습문제 장(Q)은 세지 않는다
  let coverNo = 0; // 큰 표지 번호(I, II, …). 건너뛴 부의 표지도 센다
  // 문항 번호: print.problemNumbering "book"(기본)이면 책 전체로 이어 매긴다. 건너뛴 장의 문항도 센다
  const bookWide = (print.problemNumbering ?? "book") !== "chapter";
  let prSeq = 0;
  parts.forEach((part, pi) => {
    const P = pi + 1;
    // 장마다 번호(연습문제 장은 "Q", 번호를 쓰지 않음)
    const seqs = (part.chapters ?? []).map((ch) => (isExerciseChapter(ch.source) ? EXERCISE_NO : ++seq));
    const cover = coverOf(part);
    if (cover) coverNo += 1;
    if (range.part && range.part !== P) { for (const ch of part.chapters ?? []) prSeq += countProblems(ch.source); return; }
    const palette = part.palette ?? partPalette(part.config ?? {}, print);
    const partTitle = part.config?.title ?? part.dir ?? "";
    const one = range.part && range.chapter ? range.chapter : null;
    const chapters = (part.chapters ?? []).map((ch, ci) => {
      const problemStart = bookWide ? prSeq : 0;
      if (one && one !== ci + 1) { prSeq += countProblems(ch.source); return null; }
      const r = renderChapterImpl(ch.source ?? "", { ...base, partNo: P, chapterNo: ci + 1, chapterSeq: seqs[ci], problemStart, exercise: seqs[ci] === EXERCISE_NO, palette, print });
      prSeq += r.meta.problems.length;
      for (const w of r.warnings) warnings.push(ch.path ? { ...w, path: ch.path } : w);
      return { no: ci + 1, seq: seqs[ci], ...r };
    }).filter(Boolean);
    if (!one) {
      const list = `<ol>` + chapters.map((c) => `<li><span class="toc-no">${c.seq}.</span> ${esc(c.meta.title)}</li>`).join("") + `</ol>`;
      if (coverMode) {
        if (cover) {
          const label = cover.label ?? "PART", no = roman(coverNo), title = cover.title ?? partTitle;
          toc.push({ cover: coverNo, label, no, title, palette });
          html.push(
            `<section class="part-cover big" id="cover-${coverNo}" data-palette="${esc(palette)}" data-cover="${coverNo}">\n` +
            `<div class="part-label">${esc(label)}</div>\n<div class="part-no">${esc(no)}</div>\n<h1 class="part-title">${esc(title)}</h1>\n</section>`,
          );
        }
        toc.push({ part: P, title: partTitle, palette });
        html.push(
          `<section class="part-toc titled" id="part-${P}" data-palette="${esc(palette)}" data-part="${P}">\n` +
          `<h1 class="part-toc-title">${esc(partTitle)}</h1>\n${list}\n</section>`,
        );
      } else {
        toc.push({ part: P, title: partTitle, palette });
        html.push(
          `<section class="part-cover" id="part-${P}" data-palette="${esc(palette)}" data-part="${P}">\n` +
          `<div class="part-no">${String(P).padStart(2, "0")}</div>\n<h1 class="part-title">${esc(partTitle)}</h1>\n</section>`,
          `<section class="part-toc" data-palette="${esc(palette)}" data-part="${P}">\n${list}\n</section>`,
        );
      }
    }
    for (const c of chapters) {
      toc.push({ part: P, chapter: c.no, seq: c.seq, title: c.meta.title, palette });
      // print.tocDepth 2: 책 첫 쪽 목차에 장 아래 절(##)까지
      if ((print.tocDepth ?? 1) >= 2) {
        for (const h of c.meta.headings ?? []) {
          if (h.level === 2 && h.id) toc.push({ part: P, chapter: c.no, section: h.id, no: h.number, title: h.text, palette });
        }
      }
      html.push(c.html);
    }
  });
  // 책 전체를 만들 때는 맨 앞에 책 첫 쪽(제목 + 한 쪽짜리 목차). 쪽수는 조판기가 링크 대상의 쪽 번호로 채운다
  if (!range.part) html.unshift(bookFront(book, print, toc, base.resolveAsset, coverMode));
  return { html: html.join("\n"), toc, warnings };
}

/** 책 첫 쪽: 시리즈 글씨, 책 제목·부제, 목차(큰 표지·부·장, 쪽수 자동) */
function bookFront(book, print, toc, resolveAsset = (s) => s, coverMode = false) {
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
  // 목차 줄은 그 부의 색 묶음으로(역학 붉은, 전자기 청록)
  const item = (cls, href, no, title, palette) =>
    `<li class="${cls}"${palette ? ` data-palette="${esc(palette)}"` : ""}><a href="#${href}"><span class="toc-no">${esc(no)}</span><span class="toc-title">${esc(title)}</span><span class="toc-fill"></span></a></li>`;
  const items = toc.map((t) => t.cover
    ? item("toc-cover", `cover-${t.cover}`, `${t.label} ${t.no}`, t.title, t.palette)
    : t.section
      ? item("toc-section", t.section, t.no ?? "", t.title, t.palette)
    : t.chapter
      ? item("toc-chapter", `ch-${t.part}-${t.chapter}`, `${t.seq ?? t.chapter}`, t.title, t.palette)
      : item("toc-part", `part-${t.part}`, String(t.part).padStart(2, "0"), t.title, t.palette)).join("");
  const covers = toc.filter((t) => t.cover).length;
  const deep = toc.some((t) => t.section);
  return `<section class="book-front${coverMode ? " has-covers" : ""}${deep ? " toc-deep" : ""}"${coverMode ? ` data-covers="${covers}"` : ""} data-palette="${esc(print.palette ?? "teal")}">\n` +
    `${art}\n` +
    `<nav class="book-toc"><h2>CONTENTS</h2><ol>${items}</ol></nav>\n</section>`;
}

/** @returns {{source:string, files:Array<{path:string,text:string}>}} */
export function exportPhysiklar(source, ctx) {
  return exportPhysiklarImpl(source, ctx ?? {});
}
