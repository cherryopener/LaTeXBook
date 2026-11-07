// 조판·인쇄 — 담당: C. 약속: docs/INTERFACES.md 7절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
const todo = (n) => { throw new Error(`layout.${n}: 아직 만들지 않음`); };
/** @returns {string} 전체 HTML 문서 */
export function buildDocument(bodyHtml, settings) { todo("buildDocument"); }
/** @returns {{show:Function, goToPage:Function, pageOfLine:Function, destroy:Function}} */
export function createPreview(container) { todo("createPreview"); }
export function printPdf(docHtml, opts) { todo("printPdf"); }
