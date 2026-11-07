// 편집 화면 — 담당: A. 약속: docs/INTERFACES.md 8절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
const todo = (n) => { throw new Error(`editor.${n}: 아직 만들지 않음`); };
/** @returns {{getText:Function, setText:Function, goToLine:Function, setWarnings:Function, command:Function, destroy:Function}} */
export function createEditor(parent, opts) { todo("createEditor"); }
export function createToolbar(parent, editor) { todo("createToolbar"); }
