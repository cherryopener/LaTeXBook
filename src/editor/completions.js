// 수식 자동 완성 — `$…$`, `$$…$$` 안에서 `\`를 치면 자주 쓰는 LaTeX 명령을 제안한다.
import { autocompletion, snippetCompletion } from "../../vendor/codemirror.js";

/** pos가 수식 안인지. 문서 앞에서부터 `$`, `$$`를 세어 판단(코드 울타리 안은 수식이 아님) */
export function inMath(state, pos) {
  const doc = state.doc;
  const last = doc.lineAt(pos);
  let display = false, fence = false;
  for (let n = 1; n <= last.number; n++) {
    const line = doc.line(n);
    const text = n === last.number ? line.text.slice(0, pos - line.from) : line.text;
    if (!display && /^\s*(```|~~~)/.test(text)) { fence = !fence; continue; }
    if (fence) continue;
    let inline = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") { i++; continue; }
      if (c !== "$") continue;
      if (text[i + 1] === "$") { display = !display; inline = false; i++; }
      else if (!display) inline = !inline;
    }
    if (n === last.number) return display || inline;
  }
  return false;
}

// [명령, 설명, 넣을 글(snippet; ${1} 칸 사이를 Tab으로 이동), 우선순위]
const TABLE = [
  ["\\frac", "분수 a/b", "\\frac{${1}}{${2}}", 10],
  ["\\sqrt", "제곱근", "\\sqrt{${1}}", 9],
  ["\\vec", "벡터 화살표", "\\vec{${1}}", 8],
  ["\\Delta", "Δ 변화량", null, 8],
  ["\\text", "수식 안 글자(한글)", "\\text{${1}}", 7],
  ["\\times", "× 곱", null, 6],
  ["\\cdot", "⋅ 점곱", null, 6],
  ["\\approx", "≈ 거의 같음", null, 5],
  ["\\propto", "∝ 비례", null, 5],
  ["\\hat", "단위벡터 모자", "\\hat{${1}}", 3],
  ["\\bar", "평균 막대", "\\bar{${1}}", 3],
  ["\\dot", "시간 미분 점", "\\dot{${1}}", 3],
  ["\\ddot", "이계 미분 점 두 개", "\\ddot{${1}}", 2],
  ["\\mathrm", "곧은 글자(단위)", "\\mathrm{${1}}", 3],
  ["\\mathbf", "굵은 글자", "\\mathbf{${1}}", 2],
  ["\\overline", "윗줄", "\\overline{${1}}", 1],
  ["\\left(", "자동 크기 괄호", "\\left( ${1} \\right)", 2],
  ["\\label", "수식 번호 이름", "\\label{${1}}", 2],
  ["\\begin{aligned}", "여러 줄 정렬", "\\begin{aligned}\n${1}\n\\end{aligned}", 1],
  ["\\sin", "sin 사인", null, 4],
  ["\\cos", "cos 코사인", null, 4],
  ["\\tan", "tan 탄젠트", null, 4],
  ["\\ln", "ln 자연로그", null, 2],
  ["\\log", "log 로그", null, 2],
  ["\\exp", "exp 지수", null, 1],
  ["\\lim", "lim 극한", null, 1],
  ["\\sum", "Σ 합", null, 2],
  ["\\int", "∫ 적분", null, 2],
  ["\\oint", "∮ 닫힌 적분", null, 1],
  ["\\partial", "∂ 편미분", null, 1],
  ["\\nabla", "∇ 나블라", null, 1],
  ["\\pm", "± 플러스마이너스", null, 2],
  ["\\div", "÷ 나누기", null, 1],
  ["\\leq", "≤ 작거나 같음", null, 3],
  ["\\geq", "≥ 크거나 같음", null, 3],
  ["\\neq", "≠ 같지 않음", null, 3],
  ["\\ll", "≪ 훨씬 작음", null, 1],
  ["\\gg", "≫ 훨씬 큼", null, 1],
  ["\\sim", "∼ 비슷함", null, 1],
  ["\\equiv", "≡ 항등", null, 1],
  ["\\infty", "∞ 무한대", null, 2],
  ["\\rightarrow", "→ 화살표", null, 2],
  ["\\leftarrow", "← 화살표", null, 1],
  ["\\Rightarrow", "⇒ 그러므로", null, 1],
  ["\\leftrightarrow", "↔ 양쪽 화살표", null, 1],
  ["\\circ", "° 도(각도는 ^\\circ)", null, 2],
  ["\\hbar", "ħ 플랑크 상수/2π", null, 1],
  ["\\ell", "ℓ 필기체 엘", null, 1],
  ["\\perp", "⊥ 수직", null, 1],
  ["\\parallel", "∥ 평행", null, 1],
  ["\\angle", "∠ 각", null, 1],
  ["\\cdots", "⋯ 가운뎃점 줄임", null, 1],
  ["\\ldots", "… 줄임", null, 1],
  ["\\quad", "넓은 띄어쓰기", null, 1],
  ["\\,", "좁은 띄어쓰기", null, 3],
  ["\\alpha", "α 알파", null, 4], ["\\beta", "β 베타", null, 4], ["\\gamma", "γ 감마", null, 4],
  ["\\delta", "δ 델타", null, 4], ["\\epsilon", "ε 엡실론", null, 3], ["\\varepsilon", "ε 엡실론(다른 모양)", null, 2],
  ["\\zeta", "ζ 제타", null, 1], ["\\eta", "η 에타", null, 2], ["\\theta", "θ 세타", null, 4],
  ["\\lambda", "λ 람다", null, 4], ["\\mu", "μ 뮤", null, 4], ["\\nu", "ν 뉴", null, 2],
  ["\\xi", "ξ 크사이", null, 1], ["\\pi", "π 파이", null, 4], ["\\rho", "ρ 로", null, 3],
  ["\\sigma", "σ 시그마", null, 3], ["\\tau", "τ 타우", null, 3], ["\\phi", "φ 파이", null, 3],
  ["\\varphi", "φ 파이(다른 모양)", null, 2], ["\\chi", "χ 카이", null, 1], ["\\psi", "ψ 프사이", null, 2],
  ["\\omega", "ω 오메가", null, 4],
  ["\\Gamma", "Γ 대문자 감마", null, 1], ["\\Theta", "Θ 대문자 세타", null, 1], ["\\Lambda", "Λ 대문자 람다", null, 1],
  ["\\Sigma", "Σ 대문자 시그마", null, 1], ["\\Phi", "Φ 대문자 파이", null, 1], ["\\Psi", "Ψ 대문자 프사이", null, 1],
  ["\\Omega", "Ω 대문자 오메가", null, 3],
];

// 보이는 순서: 우선순위(boost) 높은 것부터, 같으면 표의 순서
const OPTIONS = TABLE.map(([label, detail, snip, boost], i) => {
  const info = { label, detail, type: "keyword" };
  return { boost, i, option: snip ? snippetCompletion(snip, info) : info };
}).sort((a, b) => b.boost - a.boost || a.i - b.i).map((x) => x.option);

/** `\` 뒤에 친 글자로 시작하는 것만 보여 줌(대소문자 무시). 흩어진 글자 맞춤은 엉뚱한 제안이 많아 쓰지 않음 */
function mathSource(context) {
  const m = context.matchBefore(/\\[a-zA-Z]*/);
  if (!m || !inMath(context.state, m.from)) return null;
  const typed = m.text.toLowerCase();
  return { from: m.from, filter: false, options: OPTIONS.filter((o) => o.label.toLowerCase().startsWith(typed)) };
}

export const mathCompletion = autocompletion({
  override: [mathSource],
  icons: false,
  maxRenderedOptions: 30,
  tooltipClass: () => "pl-complete",
});
