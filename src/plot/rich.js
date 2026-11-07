// 이름표 글자 → SVG <tspan>. 수식 느낌(변수 기울임, 아래·위첨자)만 흉내 낸다. DOM 없음.
//   v_0, v_{max}, t^2, v₀(유니코드 아래첨자도 같게), \Delta x, \mathrm{kg}, \text{…}
// 글자는 KaTeX 글꼴(조판 문서에 이미 로드됨) → Noto Serif KR → serif 순으로 찾는다.

export const FONT_MAIN = "KaTeX_Main, 'Noto Serif KR', serif";
export const FONT_MATH = "KaTeX_Math, KaTeX_Main, 'Noto Serif KR', serif";

const SUB_UNI = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t" };
const SUP_UNI = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "ⁿ": "n", "ⁱ": "i" };
const MACROS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", eta: "η", theta: "θ", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Omega: "Ω",
  cdot: "·", times: "×", pm: "±", degree: "°", circ: "°", infty: "∞", rightarrow: "→", to: "→",
};
const WORDS = new Set(["sin", "cos", "tan", "ln", "log", "exp", "abs", "sqrt", "max", "min"]);
const isLowerGreek = (c) => /[α-ωϑϕϖ]/.test(c);

/** 유니코드 첨자 묶음을 _{…} ^{…} 로 바꾸고 \이름 기호를 글자로 바꾼다 */
function pre(s) {
  s = s.replace(/[₀-₉₊₋ₐₑₒₓₕₖₗₘₙₚₛₜ]+/g, (m) => "_{" + [...m].map((c) => SUB_UNI[c]).join("") + "}");
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿⁱ]+/g, (m) => "^{" + [...m].map((c) => SUP_UNI[c]).join("") + "}");
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (name in MACROS ? MACROS[name] : m));
  // 빼기 기호: 한글 옆의 -만 붙임표로 두고 나머지는 −(U+2212)
  return s.replace(/-/g, (m, i, all) => (/[가-힣]/.test(all[i - 1] ?? "") || /[가-힣]/.test(all[i + 1] ?? "") ? m : "−"));
}

/**
 * 글자 → 조각 목록. 조각: { t:글자, it:기울임?, sh:0|1|-1(0 보통, 1 아래첨자, -1 위첨자) }
 * @param {string} str
 */
export function parseRich(str, shift = 0) {
  const s = shift ? str : pre(String(str));
  const out = [];
  const push = (t, it, sh) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.it === it && last.sh === sh) last.t += t;
    else out.push({ t, it, sh });
  };
  let i = 0;
  const group = () => { // _ ^ 뒤의 한 덩어리
    if (s[i] === "{") {
      let d = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}" && --d === 0) break; }
      const inner = s.slice(i + 1, j);
      i = Math.min(s.length, j + 1);
      return inner;
    }
    const ch = s[i] ?? "";
    i += ch ? 1 : 0;
    return ch;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\(text|mathrm|mathit|mathbf)\s*\{/.exec(s.slice(i));
      if (m) {
        i += m[0].length - 1;
        const inner = group();
        for (const seg of parseRich(inner, shift || 0)) push(seg.t, m[1] === "mathit" ? true : false, seg.sh || shift);
        // \mathit은 기울임, 나머지는 곧게
        continue;
      }
      i++; continue;
    }
    if ((c === "_" || c === "^") && !shift) {
      i++;
      const inner = group();
      const sh = c === "_" ? 1 : -1;
      for (const seg of parseRich(inner, sh)) push(seg.t, seg.it, sh);
      continue;
    }
    if (c === "{" || c === "}") { i++; continue; }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      const run = s.slice(i, j);
      i = j;
      if (run.length >= 3 || WORDS.has(run)) push(run, false, shift);
      else push(run, true, shift);
      continue;
    }
    if (isLowerGreek(c)) { push(c, true, shift); i++; continue; }
    push(c, false, shift); i++;
  }
  return out;
}

/** 어림 폭(글자 크기 size 기준). 충돌 검사용 */
export function richWidth(segs, size) {
  let w = 0;
  for (const s of segs) {
    const k = s.sh ? 0.7 : 1;
    for (const ch of s.t) {
      const cp = ch.codePointAt(0);
      let e = 0.55;
      if (ch === " ") e = 0.28;
      else if (/[0-9]/.test(ch)) e = 0.5;
      else if (/[A-Za-z]/.test(ch)) e = s.it ? 0.5 : 0.5;
      else if (cp >= 0x1100 && (cp <= 0x11ff || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xac00 && cp <= 0xd7a3))) e = 1.0;
      else if ("=+−-×".includes(ch)) e = 0.78;
      else if (".,:;'|/".includes(ch)) e = 0.3;
      w += e * size * k;
    }
  }
  return w;
}

export const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 조각 → <tspan> 문자열(첨자는 dy로 올리고 내리며 끝나면 되돌린다) */
export function richTspans(segs, size) {
  const SUB = 0.22 * size, SUP = -0.38 * size, f2 = (v) => +v.toFixed(2);
  let cur = 0; // 지금 baseline 이동량
  let out = "";
  for (const s of segs) {
    const target = s.sh === 1 ? SUB : s.sh === -1 ? SUP : 0;
    const attrs = [];
    if (target !== cur) { attrs.push(`dy="${f2(target - cur)}"`); cur = target; }
    if (s.sh) attrs.push(`font-size="${f2(size * 0.7)}"`);
    if (s.it) attrs.push(`font-family="${FONT_MATH}" font-style="italic"`);
    out += attrs.length ? `<tspan ${attrs.join(" ")}>${esc(s.t)}</tspan>` : `<tspan>${esc(s.t)}</tspan>`;
  }
  return out;
}
