// 식 해석기 — eval/Function 없이 직접 구현. DOM을 쓰지 않는다(Node·브라우저 공용).
// 문법: + - * / ^, 괄호, 단항 음수, 곱셈 생략(2x, 3(x+1), 2pi, x sin x),
//       sin cos tan sqrt exp ln abs, 상수 pi e. 변수는 x(식에 x가 없고 낯선 글자가 하나뿐이면 그 글자를 변수로 봄).
// 우선순위: ^ (오른쪽 결합) > 단항 − > * / 와 곱셈 생략(같은 단계, 왼쪽부터) > + −
//   -x^2 = -(x^2),  1/2x = (1/2)x,  2^3x = (2^3)x,  sin 2x^2 = sin(2x^2),  sin x cos x = (sin x)(cos x)

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt,
  exp: Math.exp, ln: Math.log, abs: Math.abs,
};
const CONSTS = { pi: Math.PI, e: Math.E };
const MAX_LEN = 400;
const MAX_DEPTH = 40;

const SUP = { "⁰": 0, "¹": 1, "²": 2, "³": 3, "⁴": 4, "⁵": 5, "⁶": 6, "⁷": 7, "⁸": 8, "⁹": 9 };

/** 입력 글자 정리: 소문자, 유니코드 기호, 위첨자 숫자 */
function normalize(src) {
  let s = String(src).toLowerCase()
    .replace(/[−–﹣－]/g, "-").replace(/[×·∙⋅]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi")
    .replace(/\*\*/g, "^").replace(/\s+/g, " ").trim();
  s = s.replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m) => "^" + [...m].map((c) => SUP[c]).join(""));
  return s;
}

function tokenize(s, varName) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) throw new Error(`숫자 모양이 올바르지 않습니다("${s.slice(i, i + 6)}")`);
      toks.push({ k: "num", v: parseFloat(m[1]), pos: i });
      i += m[1].length;
      if (s[i] === ".") throw new Error(`숫자에 점이 둘 이상 있습니다("${s.slice(Math.max(0, i - 3), i + 3)}")`);
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      const run = s.slice(i, j);
      let p = 0;
      while (p < run.length) {
        let hit = null;
        for (const w of ["sqrt", "sin", "cos", "tan", "exp", "abs", "ln", "pi"]) if (run.startsWith(w, p)) { hit = w; break; }
        if (!hit) hit = run[p] === "e" ? "e" : run[p] === varName ? varName : null;
        if (!hit) throw new Error(`알 수 없는 이름 "${run.slice(p)}"입니다`);
        toks.push({ k: hit in FUNCS ? "fn" : hit === varName ? "var" : "const", v: hit, pos: i + p });
        p += hit.length;
      }
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) { toks.push({ k: "op", v: c, pos: i }); i++; continue; }
    if ("[{".includes(c)) { toks.push({ k: "op", v: "(", pos: i }); i++; continue; }
    if ("]}".includes(c)) { toks.push({ k: "op", v: ")", pos: i }); i++; continue; }
    throw new Error(`쓸 수 없는 글자 "${c}"가 있습니다`);
  }
  return toks;
}

/** 식에서 변수 글자를 정한다: 기본 x, 식에 x가 없고 낯선 글자가 하나면 그 글자 */
function pickVariable(s, declared) {
  if (declared) return declared;
  const rest = s.replace(/sqrt|sin|cos|tan|exp|abs|ln|pi/g, " ").replace(/[^a-z]/g, "");
  const other = [...new Set(rest)].filter((c) => c !== "x" && c !== "e");
  if (other.length === 0) return "x";
  if (other.length === 1 && !rest.includes("x")) return other[0];
  return "x"; // 이후 토큰화에서 "알 수 없는 이름" 오류가 난다
}

function parse(toks) {
  let i = 0;
  let depth = 0;
  let usesVar = false;
  const peek = () => toks[i];
  const isOp = (t, v) => t && t.k === "op" && t.v === v;
  const startsPrimary = (t) => t && (t.k === "var" || t.k === "const" || t.k === "fn" || isOp(t, "("));

  function enter() { if (++depth > MAX_DEPTH) throw new Error("식의 괄호가 너무 깊습니다"); }

  function expr() {
    let a = term();
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = toks[i++].v;
      a = { t: "b", op, a, b: term() };
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const t = peek();
      if (isOp(t, "*") || isOp(t, "/")) { i++; a = { t: "b", op: t.v, a, b: unary() }; }
      else if (startsPrimary(t)) a = { t: "b", op: "*", a, b: unary() }; // 곱셈 생략
      else if (t && t.k === "num") throw new Error("숫자가 연달아 나옵니다. 사이에 연산 기호가 필요합니다");
      else return a;
    }
  }
  function unary() {
    const t = peek();
    if (isOp(t, "-")) { i++; return { t: "u", a: unary() }; }
    if (isOp(t, "+")) { i++; return unary(); }
    return power();
  }
  function power(noFn) {
    const base = atom(noFn);
    if (isOp(peek(), "^")) { i++; return { t: "b", op: "^", a: base, b: exponent() }; }
    return base;
  }
  function exponent() {
    if (isOp(peek(), "-")) { i++; return { t: "u", a: exponent() }; }
    if (isOp(peek(), "+")) { i++; return exponent(); }
    return power();
  }
  function atom(noFn) {
    const t = toks[i];
    if (!t) throw new Error("식이 도중에 끝났습니다. 값이 더 필요합니다");
    if (t.k === "num") { i++; return { t: "n", v: t.v }; }
    if (t.k === "var") { i++; usesVar = true; return { t: "x" }; }
    if (t.k === "const") { i++; return { t: "n", v: CONSTS[t.v] }; }
    if (t.k === "fn") {
      if (noFn) throw new Error(`"${t.v}" 앞에 연산 기호가 필요합니다`);
      i++;
      const nx = peek();
      if (isOp(nx, "(")) return { t: "f", name: t.v, a: group() };
      if (!nx || (nx.k === "op" && nx.v !== "-" && nx.v !== "+")) throw new Error(`"${t.v}" 뒤에 값이 필요합니다. 예: ${t.v}(x)`);
      return { t: "f", name: t.v, a: funcArg() };
    }
    if (isOp(t, "(")) return group();
    if (isOp(t, ")")) throw new Error("닫는 괄호 ')'가 짝 없이 나왔습니다");
    throw new Error(`여기에 "${t.v}"는 올 수 없습니다`);
  }
  // 괄호 없는 함수 인자: 곱셈 생략으로 이어진 항(함수는 만나면 멈춤). sin 2x, sin x^2, sin -x
  function funcArg() {
    if (isOp(peek(), "-")) { i++; return { t: "u", a: funcArg() }; }
    if (isOp(peek(), "+")) { i++; return funcArg(); }
    if (peek() && peek().k === "fn") return power();
    let a = power(true);
    while (peek() && (peek().k === "var" || peek().k === "const" || isOp(peek(), "("))) a = { t: "b", op: "*", a, b: power(true) };
    return a;
  }
  function group() {
    enter();
    i++; // (
    if (isOp(peek(), ")")) throw new Error("괄호 안이 비어 있습니다");
    const a = expr();
    if (!isOp(peek(), ")")) throw new Error("여는 괄호 '('에 맞는 닫는 괄호 ')'가 없습니다");
    i++;
    depth--;
    return a;
  }

  const tree = expr();
  if (i < toks.length) {
    const t = toks[i];
    if (isOp(t, ")")) throw new Error("닫는 괄호 ')'가 짝 없이 나왔습니다");
    throw new Error(`식을 해석하다 "${t.v}"에서 멈췄습니다`);
  }
  return { tree, usesVar };
}

function compile(node) {
  switch (node.t) {
    case "n": { const v = node.v; return () => v; }
    case "x": return (x) => x;
    case "u": { const a = compile(node.a); return (x) => -a(x); }
    case "f": { const a = compile(node.a), f = FUNCS[node.name]; return (x) => f(a(x)); }
    case "b": {
      const a = compile(node.a), b = compile(node.b);
      switch (node.op) {
        case "+": return (x) => a(x) + b(x);
        case "-": return (x) => a(x) - b(x);
        case "*": return (x) => a(x) * b(x);
        case "/": return (x) => a(x) / b(x);
        default: return (x) => Math.pow(a(x), b(x));
      }
    }
  }
  throw new Error("내부 오류: 알 수 없는 식 노드");
}

/**
 * 식을 읽어 함수로 만든다.
 * @param {string} src 식(오른쪽 변 `2x+1`)
 * @param {{variable?:string, constant?:boolean}} [opts] variable: 변수 글자를 지정(없으면 자동), constant: 변수 없는 상수식만 허용
 * @returns {{ok:true, fn:(x:number)=>number, variable:string, ast:Object, usesVar:boolean}|{ok:false, error:string}}
 */
export function compileExpr(src, opts = {}) {
  try {
    if (String(src).length > MAX_LEN) throw new Error(`식이 너무 깁니다(${MAX_LEN}자 이내)`);
    const s = normalize(src);
    if (!s) throw new Error("식이 비어 있습니다");
    const variable = pickVariable(s, opts.variable);
    const { tree, usesVar } = parse(tokenize(s, variable));
    if (opts.constant && usesVar) throw new Error(`여기에는 변수 없이 숫자만 쓸 수 있습니다("${String(src).trim()}")`);
    return { ok: true, fn: compile(tree), variable, ast: tree, usesVar };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 상수식 값(범위 끝값 등). 실패하면 오류 */
export function evalConst(src) {
  const r = compileExpr(src, { constant: true });
  if (!r.ok) return { ok: false, error: r.error };
  const v = r.fn(0);
  if (!Number.isFinite(v)) return { ok: false, error: `"${String(src).trim()}"의 값을 구할 수 없습니다` };
  return { ok: true, value: v };
}
