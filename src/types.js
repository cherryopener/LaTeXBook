// 모듈끼리 주고받는 데이터의 모양 (docs/INTERFACES.md 3절). 메인 세션 담당.

/** @typedef {"teacher"|"student"} Edition */
/** @typedef {"teal"|"red"} Palette */
/** @typedef {"a4"} Paper  도련판은 만들지 않음(인쇄소가 처리) */
/**
 * @typedef {Object} PrintConfig
 * @property {string} theme
 * @property {Palette} palette
 * @property {Paper} paper
 * @property {{label:string[], tag?:string}} [series]
 * @property {string} [logo]
 * @property {{body?:string, bodyFile?:string}} [fonts]
 * @property {string[]} omitSections
 * @property {boolean} headingNumbers
 * @property {"000"|"0"} problemNumber
 * @property {"right"|"any"} chapterStart
 * @property {"outside"|"left"} sideColumn
 */
/**
 * @typedef {Object} BookSource
 * @property {string} id
 * @property {Object} config
 * @property {PrintConfig} print
 * @property {Array<{dir:string, config:Object, palette:Palette, chapters:Array<{path:string, source:string, sha?:string}>}>} parts
 */
/** @typedef {{code:string, message:string, line?:number, path?:string}} Warning */

export const PRINT_DEFAULTS = Object.freeze({
  theme: "cyber",
  palette: "teal",
  paper: "a4",
  omitSections: ["실험으로 확인하기", "직접 해 보기"],
  headingNumbers: true,
  problemNumber: "000",
  chapterStart: "right",
  sideColumn: "outside",
});

/** book.json 전체를 받아 print 칸에 기본값을 채운 PrintConfig를 돌려준다 */
export function withPrintDefaults(bookConfig = {}) {
  const p = bookConfig.print ?? {};
  return { ...PRINT_DEFAULTS, ...p, omitSections: p.omitSections ?? [...PRINT_DEFAULTS.omitSections] };
}

/** part.json과 책 설정에서 그 부의 색 묶음을 정한다 */
export function partPalette(partConfig = {}, print = PRINT_DEFAULTS) {
  return partConfig.print?.palette ?? print.palette;
}
