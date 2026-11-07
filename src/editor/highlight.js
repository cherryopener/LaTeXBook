// 문법 색칠 — 마크다운 + 디렉티브 + 수식. 줄 단위로 훑어 Decoration을 만든다.
// (CodeMirror의 마크다운 파서는 디렉티브·수식을 모르므로 파서 대신 정규식으로 직접 칠한다.)
import { Decoration, ViewPlugin, RangeSetBuilder } from "../../vendor/codemirror.js";
import { matchBracket } from "./commands.js";

const cache = new Map();
const markDeco = (cls) => cache.get("m" + cls) ?? (cache.set("m" + cls, Decoration.mark({ class: cls })), cache.get("m" + cls));
const lineDeco = (cls) => cache.get("l" + cls) ?? (cache.set("l" + cls, Decoration.line({ class: cls })), cache.get("l" + cls));
const safe = (s) => s.replace(/[^\w-]/g, "");

/** 수식 속 `\명령` 칠하기 */
function mathInner(t, from, to, marks, base) {
  const re = /\\(?:[a-zA-Z]+|.)/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(t)) && m.index < to) marks.push([base + m.index, base + Math.min(to, m.index + m[0].length), "pl-math-cmd"]);
}

/** `{속성}` 뒤쪽 처리: t[i]가 `{`면 닫는 `}`까지 칠하고 다음 위치를 돌려줌 */
function attrs(t, i, marks, base) {
  if (t[i] !== "{") return i;
  const j = t.indexOf("}", i);
  if (j < 0) return i;
  marks.push([base + i, base + j + 1, "pl-attr"]);
  return j + 1;
}

/** 줄 안 글 칠하기 (t[from, to) 범위, 재귀) */
function inline(t, from, to, marks, base) {
  let i = from;
  while (i < to) {
    const c = t[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") {
      const j = t.indexOf("`", i + 1);
      if (j > i && j < to) { marks.push([base + i, base + j + 1, "pl-icode"]); i = j + 1; continue; }
    } else if (c === "$") {
      const dbl = t[i + 1] === "$";
      let j = -1;
      if (dbl) j = t.indexOf("$$", i + 2);
      else for (let k = i + 1; k < to; k++) { if (t[k] === "\\") k++; else if (t[k] === "$") { j = k; break; } }
      const len = dbl ? 2 : 1;
      if (j > i + len && j < to) {
        marks.push([base + i, base + j + len, "pl-math"], [base + i, base + i + len, "pl-math-delim"], [base + j, base + j + len, "pl-math-delim"]);
        mathInner(t, i + len, j, marks, base);
        i = j + len; continue;
      }
      i += len; continue;
    } else if (c === "*") {
      if (t[i + 1] === "*") {
        const j = t.indexOf("**", i + 2);
        if (j > i + 2 && j < to) {
          marks.push([base + i, base + j + 2, "pl-strong"], [base + i, base + i + 2, "pl-syn"], [base + j, base + j + 2, "pl-syn"]);
          inline(t, i + 2, j, marks, base);
          i = j + 2; continue;
        }
        i += 2; continue;
      }
      if (t[i + 1] && !/\s/.test(t[i + 1])) {
        const j = t.indexOf("*", i + 1);
        if (j > i + 1 && j < to && !/\s/.test(t[j - 1])) {
          marks.push([base + i, base + j + 1, "pl-em"]);
          inline(t, i + 1, j, marks, base);
          i = j + 1; continue;
        }
      }
    } else if (c === ":" && (i === 0 || !/[\w:]/.test(t[i - 1]))) {
      const m = /^[A-Za-z][\w-]*/.exec(t.slice(i + 1, to));
      if (m) {
        const name = m[0], k = i + 1 + name.length;
        if (t[k] === "[") {
          const e = matchBracket(t, k);
          if (e > 0 && e < to) {
            const isBlank = name === "blank";
            marks.push([base + i, base + k + 1, isBlank ? "pl-blank-syn" : "pl-dir-name"], [base + e, base + e + 1, isBlank ? "pl-blank-syn" : "pl-dir-name"]);
            if (isBlank) marks.push([base + i, base + e + 1, "pl-blank"]);
            else marks.push([base + i, base + e + 1, "pl-dir-" + safe(name)]);
            inline(t, k + 1, e, marks, base);
            i = attrs(t, e + 1, marks, base);
            continue;
          }
        } else if (t[k] === "{") {
          marks.push([base + i, base + k, "pl-dir-name"]);
          i = attrs(t, k, marks, base);
          continue;
        }
      }
    }
    i++;
  }
}

/** 상자 머리줄·세 칸 이상 콜론 줄 뒤쪽: `[제목]{속성}` */
function directiveTail(t, i, marks, base) {
  if (t[i] === "[") {
    const e = matchBracket(t, i);
    if (e > 0) {
      marks.push([base + i + 1, base + e, "pl-dir-label"]);
      inline(t, i + 1, e, marks, base);
      i = e + 1;
    }
  }
  attrs(t, i, marks, base);
}

/** 문서 전체를 줄별로 훑어 보이는 범위만 장식 */
function build(view) {
  const doc = view.state.doc;
  const { from: vf, to: vt } = view.viewport;
  const b = new RangeSetBuilder();
  let fence = null, inDisplay = false, inFront = false;
  const stack = []; // 열려 있는 상자(콜론 개수, 이름)
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const t = line.text;
    const visible = line.to >= vf && line.from <= vt;
    const lines = [], marks = [];
    const L = (c) => lines.push(c);
    let dirLine = false;
    const M = (a, e, c) => { if (e > a) marks.push([line.from + a, line.from + e, c]); };

    if (n === 1 && t === "---") { inFront = true; L("pl-fm"); }
    else if (inFront) {
      L("pl-fm");
      if (t === "---") inFront = false;
      else { const k = /^[\w-]+(?=:)/.exec(t); if (k) M(0, k[0].length, "pl-fm-key"); }
    } else if (fence) {
      L("pl-codeblock");
      if (fence.plot) L("pl-plotblock");
      const f = /^\s*(`{3,}|~{3,})\s*$/.exec(t);
      if (f && f[1][0] === fence.ch && f[1].length >= fence.len) { fence = null; L("pl-fence-end"); }
      else if (fence.plot && visible) {
        const k = /^(\s*)([A-Za-z_][\w]*)(\s*:)/.exec(t);
        if (k) M(k[1].length, k[1].length + k[2].length + k[3].length, "pl-plot-key");
        const q = /"[^"]*"\s*$/.exec(t);
        if (q) M(q.index, t.length, "pl-plot-label");
      }
    } else if (/^\s*(`{3,}|~{3,})/.test(t)) {
      const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(t);
      fence = { ch: f[1][0], len: f[1].length, plot: f[2] === "plot" };
      L("pl-codeblock"); L("pl-fence-start"); if (fence.plot) L("pl-plotblock");
    } else if (inDisplay) {
      L("pl-mathblock");
      const j = t.indexOf("$$");
      if (j >= 0) { inDisplay = false; M(j, j + 2, "pl-math-delim"); }
      if (visible) mathInner(t, 0, j >= 0 ? j : t.length, marks, line.from);
    } else if (/^\s*\$\$/.test(t) && (t.match(/\$\$/g) || []).length === 1) {
      inDisplay = true;
      L("pl-mathblock");
      const j = t.indexOf("$$");
      M(j, j + 2, "pl-math-delim");
      if (visible) mathInner(t, j + 2, t.length, marks, line.from);
    } else {
      let m;
      if ((m = /^(#{1,6})(?=\s|$)/.exec(t))) {
        L("pl-h"); L("pl-h" + m[1].length);
        M(0, m[1].length, "pl-h-mark");
        if (visible) inline(t, m[1].length, t.length, marks, line.from);
      } else if ((m = /^(:{3,})([A-Za-z][\w-]*)/.exec(t))) { // 상자 열기
        L("pl-dir"); L("pl-kind-" + safe(m[2]));
        dirLine = true; stack.push({ colons: m[1].length, kind: safe(m[2]) });
        M(0, m[1].length + m[2].length, "pl-dir-name");
        if (visible) directiveTail(t, m[0].length, marks, line.from);
      } else if (/^:{3,}\s*$/.test(t)) { // 상자 닫기
        L("pl-dir"); L("pl-dir-close");
        dirLine = true;
        { const k = t.trim().length; for (let x = stack.length - 1; x >= 0; x--) if (stack[x].colons === k) { L("pl-kind-" + stack[x].kind); stack.length = x; break; } }
        M(0, t.trimEnd().length, "pl-dir-name");
      } else if ((m = /^::([A-Za-z][\w-]*)/.exec(t))) { // 한 줄 디렉티브(::fig, ::space, ::problems …)
        L("pl-leaf"); L("pl-leaf-" + safe(m[1]));
        M(0, m[0].length, "pl-dir-name");
        if (visible) directiveTail(t, m[0].length, marks, line.from);
      } else if (t === "+++") {
        L("pl-leaf"); M(0, 3, "pl-dir-name");
      } else if (visible) {
        if (/^\s*\|/.test(t)) {
          L("pl-table");
          if (/^\s*\|[\s:|-]*-[\s:|-]*$/.test(t)) L("pl-table-sep");
          for (let k = 0; k < t.length; k++) { if (t[k] === "\\") k++; else if (t[k] === "|") M(k, k + 1, "pl-pipe"); }
        }
        let start = 0;
        if ((m = /^(\s*)(>+|[-*+]|\d+[.)])(?=\s)/.exec(t))) { M(m[1].length, m[0].length, "pl-list-mark"); start = m[0].length; }
        inline(t, start, t.length, marks, line.from);
      }
    }

    if (!dirLine && stack.length) L("pl-in pl-in-" + stack[stack.length - 1].kind);
    if (!visible) continue;
    for (const c of lines) b.add(line.from, line.from, lineDeco(c));
    marks.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    for (const [a, e, c] of marks) if (e > a) b.add(a, e, markDeco(c));
  }
  return b.finish();
}

export const syntaxColors = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = build(u.view); }
}, { decorations: (v) => v.decorations });
