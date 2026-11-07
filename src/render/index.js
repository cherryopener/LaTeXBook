// 원고 변환 — 담당: B. 약속: docs/INTERFACES.md 4절·6절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
const todo = (n) => { throw new Error(`render.${n}: 아직 만들지 않음`); };
/** @returns {{html:string, meta:Object, warnings:Array}} */
export function renderChapter(source, ctx) { todo("renderChapter"); }
/** @returns {{html:string, toc:Array, warnings:Array}} */
export function renderBook(book, opts) { todo("renderBook"); }
/** @returns {{source:string, files:Array<{path:string,text:string}>}} */
export function exportPhysiklar(source, ctx) { todo("exportPhysiklar"); }
