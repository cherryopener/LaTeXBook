// 함수 그래프 — 담당: D. 약속: docs/INTERFACES.md 5절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
const todo = (n) => { throw new Error(`plot.${n}: 아직 만들지 않음`); };
/** @returns {{svg:string, errors:string[]}} */
export function renderPlot(spec, opts) { todo("renderPlot"); }
/** @returns {{ok:boolean, plot?:Object, errors:string[]}} */
export function parsePlot(spec) { todo("parsePlot"); }
/** 브라우저 전용 @returns {Promise<Blob>} */
export async function svgToPng(svg, scale = 3) { todo("svgToPng"); }
