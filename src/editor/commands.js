// 편집 명령 — 문서 문자열을 바꾸는 순수 함수 모음. 화면(DOM)을 쓰지 않아 Node에서도 시험할 수 있다.
// 각 명령은 (state, arg) => 트랜잭션 명세(또는 null)를 돌려준다. 원고 문법은 docs/FORMAT.md.
import { EditorSelection } from "../../vendor/codemirror.js";

/** 단축키(Mod = 맥 Cmd, 그 밖 Ctrl). 도구 막대 설명과 keymap이 함께 쓴다. */
export const SHORTCUTS = {
  save: "Mod-s",
  bold: "Mod-b",
  blank: "Mod-u", // 밑줄(U)처럼 "빈칸 = 밑줄 칸"으로 외우기 쉬움. 맥에서 Cmd+U는 브라우저 기본 기능이 없음
  inlineMath: "Mod-Shift-m", // Cmd+M은 맥 OS의 "창 최소화"라서 쓸 수 없음
  displayMath: "Mod-Shift-d",
  heading2: "Mod-Alt-2",
  heading3: "Mod-Alt-3",
  pagebreak: "Mod-Enter", // 워드의 쪽 나누기(Ctrl+Enter)와 같음
};

export const CALLOUTS = {
  note: "참고",
  tip: "팁",
  warn: "주의",
  think: "생각해 보기",
};
const CALLOUT_ALIAS = { 참고: "note", 팁: "tip", 주의: "warn", "생각해 보기": "think" };

const isBlank = (s) => !s.trim();

// ───────────────────────── 블록 넣기 공통 ─────────────────────────

/**
 * 블록(여러 줄 틀)을 앞뒤 빈 줄을 맞춰 넣는다.
 *  o.at       넣을 자리(없으면 커서). 그 줄이 비어 있으면 그 줄을 대신하고, 아니면 그 줄 아래에 넣는다.
 *  o.from/to  줄 단위로 감쌀 범위(감싸기). 이 줄들을 블록으로 바꾼다.
 *  o.sel      블록 안에서 고를 글자 범위 [시작, 끝] (블록 문자열 기준)
 *  o.after    넣은 뒤 커서를 블록 다음 빈 줄에 둔다
 */
export function placeBlock(state, block, o = {}) {
  const doc = state.doc;
  const hasRange = o.from != null;
  const fromLine = doc.lineAt(hasRange ? o.from : (o.at ?? state.selection.main.head));
  const toLine = hasRange ? doc.lineAt(o.to) : fromLine;
  const replace = hasRange || isBlank(fromLine.text);
  const prev = fromLine.number > 1 ? doc.line(fromLine.number - 1) : null;
  const next = toLine.number < doc.lines ? doc.line(toLine.number + 1) : null;
  let rf, rt, lead, tail;
  if (replace) {
    rf = fromLine.from; rt = toLine.to;
    lead = prev && !isBlank(prev.text) ? "\n" : "";
    tail = next && !isBlank(next.text) ? "\n" : "";
  } else {
    rf = rt = toLine.to;
    lead = "\n\n";
    tail = next && !isBlank(next.text) ? "\n" : "";
  }
  if (next && /^:{3,}\s*$/.test(next.text)) tail = ""; // 다음 줄이 상자 닫는 줄이면 빈 줄을 두지 않음
  if (!next && o.after) tail += "\n";
  const base = rf + lead.length;
  const end = base + block.length;
  let selection;
  if (o.sel) selection = EditorSelection.range(base + o.sel[0], base + o.sel[1]);
  else if (o.after) selection = EditorSelection.cursor(tail || next ? end + 1 : end);
  else selection = EditorSelection.cursor(end);
  return {
    changes: { from: rf, to: rt, insert: lead + block + tail },
    selection,
    scrollIntoView: true,
    userEvent: "input",
  };
}

/** 선택이 걸친 줄 범위(마지막 줄 맨 앞에서 끝난 선택은 그 줄을 빼기). 선택이 없으면 null */
function selectedLines(state) {
  const r = state.selection.main;
  if (r.empty) return null;
  let to = r.to;
  if (state.doc.lineAt(to).from === to && to > r.from) to -= 1;
  const a = state.doc.lineAt(r.from), b = state.doc.lineAt(to);
  return { from: a.from, to: b.to, text: state.doc.sliceString(a.from, b.to) };
}

/** 틀 문자열에서 placeholder 위치를 찾아 sel 범위로 */
function selOf(block, word) {
  const i = block.indexOf(word);
  return i < 0 ? undefined : [i, i + word.length];
}

/** 선택한 줄을 감싸는 상자류: head, tail 줄 사이에 선택 줄을 넣음. 선택이 없으면 자리표시 글자를 넣음 */
function wrapOrInsert(state, head, tailLine, placeholder, selWord) {
  const lines = selectedLines(state);
  if (lines) {
    const block = `${head}\n${lines.text}\n${tailLine}`;
    const bodyEnd = head.length + 1 + lines.text.length;
    const spec = placeBlock(state, block, { from: lines.from, to: lines.to });
    // 감싼 뒤에는 머리말 줄의 고를 글자(제목 자리)를 고르거나, 없으면 본문 끝에 커서
    const baseOffset = spec.changes.insert.indexOf(head);
    const s = selWord ? selOf(head, selWord) : null;
    spec.selection = s
      ? EditorSelection.range(spec.changes.from + baseOffset + s[0], spec.changes.from + baseOffset + s[1])
      : EditorSelection.cursor(spec.changes.from + baseOffset + bodyEnd);
    return spec;
  }
  const block = `${head}\n${placeholder}\n${tailLine}`;
  const sel = selWord ? selOf(head, selWord) : selOf(block, placeholder);
  return placeBlock(state, block, { sel });
}

/** 줄마다 번호가 붙는 상자(선지·보기). 고른 줄이 있으면 감싸고, 없으면 빈 상자를 넣고 안쪽 첫 줄에 커서 */
function listBox(state, head) {
  if (selectedLines(state)) return wrapOrInsert(state, head, ":::", "");
  return placeBlock(state, `${head}\n\n:::`, { sel: [head.length + 1, head.length + 1] });
}

// ───────────────────────── 글 속 서식 ─────────────────────────

/** 양쪽 공백은 감싸는 범위에서 뺀다("**a **" 같은 깨진 서식 방지) */
function trimRange(doc, r) {
  let { from, to } = r;
  while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++;
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--;
  return { from, to };
}

/** 굵게·글 속 수식: 앞뒤 기호로 감싸기/풀기 */
function toggleWrap(state, open, close, { guard } = {}) {
  const doc = state.doc;
  return state.changeByRange((range) => {
    const { from, to } = range.empty ? range : trimRange(doc, range);
    const inner = doc.sliceString(from, to);
    const around = (a, b) => doc.sliceString(Math.max(0, from - a), from) === open && doc.sliceString(to, Math.min(doc.length, to + b)) === close;
    // 기호가 선택 안에 들어 있는 경우
    if (!range.empty && inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)
      && (!guard || guard(from, to, true))) {
      const body = inner.slice(open.length, inner.length - close.length);
      return { changes: { from, to, insert: body }, range: EditorSelection.range(from, from + body.length) };
    }
    // 기호가 선택 바깥에 붙어 있는 경우(커서만 있어도 포함)
    if (around(open.length, close.length) && (!guard || guard(from, to, false))) {
      return {
        changes: [{ from: from - open.length, to: from }, { from: to, to: to + close.length }],
        range: EditorSelection.range(from - open.length, to - open.length),
      };
    }
    if (from === to) {
      return { changes: { from, insert: open + close }, range: EditorSelection.cursor(from + open.length) };
    }
    return {
      changes: [{ from, insert: open }, { from: to, insert: close }],
      range: EditorSelection.range(from + open.length, to + open.length),
    };
  });
}

/** `$` 하나짜리 수식인지(`$$`의 일부는 제외) */
const singleDollar = (doc) => (from, to, inside) => {
  if (inside) return !doc.sliceString(from, from + 2).startsWith("$$");
  return doc.sliceString(Math.max(0, from - 2), from) !== "$$" && doc.sliceString(to, to + 2) !== "$$";
};

/** 한 줄 안에서 짝이 맞는 `]` 자리. 없으면 -1 */
export function matchBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return -1;
}

/** 한 줄의 `:blank[…]` 목록: { start, open(`[` 자리), close(`]` 자리) } */
export function findBlanks(text) {
  const out = [];
  const re = /:blank\[/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > 0 && /[\w:]/.test(text[m.index - 1])) continue;
    const open = m.index + 6;
    const close = matchBracket(text, open);
    if (close < 0) continue;
    out.push({ start: m.index, open, close });
    re.lastIndex = close + 1;
  }
  return out;
}

function blank(state) {
  const doc = state.doc;
  return state.changeByRange((range) => {
    const line = doc.lineAt(range.from);
    const sameLine = range.to <= line.to;
    if (sameLine) {
      const hit = findBlanks(line.text).find((b) => line.from + b.start <= range.from && range.to <= line.from + b.close + 1);
      if (hit) { // 이미 빈칸 → 풀기
        const s = line.from + hit.start, o = line.from + hit.open, c = line.from + hit.close;
        const pos = (p) => Math.min(Math.max(p - (o + 1 - s), s), c - (o + 1 - s));
        return {
          changes: [{ from: s, to: o + 1 }, { from: c, to: c + 1 }],
          range: EditorSelection.range(pos(range.anchor), pos(range.head)),
        };
      }
    }
    const { from, to } = range.empty ? range : trimRange(doc, range);
    if (from === to) return { changes: { from, insert: ":blank[]" }, range: EditorSelection.cursor(from + 7) };
    return {
      changes: [{ from, insert: ":blank[" }, { from: to, insert: "]" }],
      range: EditorSelection.range(from + 7, to + 7),
    };
  });
}

// ───────────────────────── 제목 ─────────────────────────

function heading(state, level) {
  const doc = state.doc;
  const r = state.selection.main;
  let to = r.to;
  if (!r.empty && doc.lineAt(to).from === to && to > r.from) to -= 1;
  const a = doc.lineAt(r.from).number, b = doc.lineAt(to).number;
  const mark = "#".repeat(level) + " ";
  const changes = [];
  for (let n = a; n <= b; n++) {
    const line = doc.line(n);
    if (isBlank(line.text) && a !== b) continue;
    const m = /^(#{1,6})[ \t]+/.exec(line.text);
    if (m && m[1].length === level) changes.push({ from: line.from, to: line.from + m[0].length });
    else changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: mark });
  }
  return { changes, scrollIntoView: true, userEvent: "input" };
}

// ───────────────────────── 구조(문제 구간) ─────────────────────────

/** 장 구조 훑기: `::problems` 줄 번호, `::::problem` 블록들. 코드 울타리 안은 건너뜀 */
export function scanStructure(doc) {
  let fence = null, problemsLine = null, cur = null;
  const blocks = [];
  for (let n = 1; n <= doc.lines; n++) {
    const t = doc.line(n).text;
    const f = /^\s*(`{3,}|~{3,})/.exec(t);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^\s*[`~]+\s*$/.test(t)) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (problemsLine == null && /^::problems(\{[^}]*\})?\s*$/.test(t)) problemsLine = n; // ::problems{per=4} 도
    if (/^::::problem(?![\w-])/.test(t)) { if (cur) blocks.push(cur); cur = { open: n, close: null, solution: null }; continue; }
    if (cur) {
      if (/^::::\s*$/.test(t)) { cur.close = n; blocks.push(cur); cur = null; }
      else if (cur.solution == null && /^:::solution(?![\w-])/.test(t)) cur.solution = n;
    }
  }
  if (cur) blocks.push(cur);
  return { problemsLine, blocks };
}

const blockEnd = (doc, b) => b.close ?? doc.lines;

const PROBLEM_BLOCK = "::::problem\n문제 내용\n\n:::solution\n풀이\n:::\n::::";

function problem(state) {
  const doc = state.doc;
  const { problemsLine, blocks } = scanStructure(doc);
  const headLine = doc.lineAt(state.selection.main.head).number;
  if (problemsLine == null) {
    const block = "::problems\n\n" + PROBLEM_BLOCK;
    const i = block.indexOf("문제 내용");
    return placeBlock(state, block, { at: doc.length, sel: [i, i + "문제 내용".length] });
  }
  let at;
  const inside = blocks.find((b) => b.open <= headLine && headLine <= blockEnd(doc, b));
  if (headLine < problemsLine) at = doc.length;
  else if (inside) at = inside.close ? doc.line(inside.close).from : doc.length;
  else at = state.selection.main.head;
  return placeBlock(state, PROBLEM_BLOCK, { at, sel: selOf(PROBLEM_BLOCK, "문제 내용") });
}

function solution(state) {
  const doc = state.doc;
  const headLine = doc.lineAt(state.selection.main.head).number;
  const { blocks } = scanStructure(doc);
  const inside = blocks.find((b) => b.open <= headLine && headLine <= blockEnd(doc, b));
  if (inside) {
    if (inside.solution) { // 이미 있음 → 거기로 이동
      const body = doc.line(Math.min(inside.solution + 1, doc.lines));
      return { selection: EditorSelection.cursor(body.to), scrollIntoView: true };
    }
    const at = inside.close ? doc.line(inside.close - 1).from : doc.length;
    return placeBlock(state, ":::solution\n풀이\n:::", { at, sel: selOf(":::solution\n풀이\n:::", "풀이") });
  }
  return wrapOrInsert(state, ":::solution", ":::", "풀이");
}

// ───────────────────────── 표 ─────────────────────────

export function tableText(rows = 3, cols = 3) {
  rows = Math.max(1, Math.min(30, rows | 0)); cols = Math.max(1, Math.min(12, cols | 0));
  const line = (cells) => "| " + cells.join(" | ") + " |";
  const head = line(Array.from({ length: cols }, (_, i) => `제목 ${i + 1}`));
  const sep = "|" + "---|".repeat(cols);
  const row = "|" + "   |".repeat(cols);
  return [head, sep, ...Array(rows - 1).fill(row)].join("\n");
}

/** 표 줄의 칸 범위(줄 안 위치). 칸 안 글자(공백 뺀)를 고르거나 빈 칸이면 커서 */
function cellRanges(text) {
  const pipes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "|") pipes.push(i);
  }
  const cells = [];
  for (let k = 0; k + 1 < pipes.length; k++) {
    const a = pipes[k] + 1, b = pipes[k + 1];
    let s = a, e = b;
    while (s < e && text[s] === " ") s++;
    while (e > s && text[e - 1] === " ") e--;
    cells.push(s === e ? { from: Math.min(a + 1, b), to: Math.min(a + 1, b), lo: pipes[k], hi: b } : { from: s, to: e, lo: pipes[k], hi: b });
  }
  return cells;
}

const isTableLine = (t) => /^\s*\|/.test(t);
const isSepLine = (t) => /^\s*\|[\s:|-]*-[\s:|-]*$/.test(t);

/** 표 안에서 Tab / Shift+Tab: 칸 옮기기(맨 끝 칸에서는 새 줄). 표가 아니면 false */
export function tableNavigate(view, dir) {
  const state = view.state, doc = state.doc;
  const head = state.selection.main.head;
  const line = doc.lineAt(head);
  if (!isTableLine(line.text)) return false;
  const cells = cellRanges(line.text);
  if (!cells.length) return false;
  const pos = head - line.from;
  let idx = cells.findIndex((c) => pos > c.lo && pos <= c.hi);
  if (idx < 0) idx = pos <= cells[0].lo ? 0 : cells.length - 1;
  const goto = (ln, c) => {
    const r = cellRanges(ln.text)[c];
    view.dispatch({ selection: EditorSelection.range(ln.from + r.from, ln.from + r.to), scrollIntoView: true });
    return true;
  };
  if (dir > 0) {
    if (idx + 1 < cells.length) return goto(line, idx + 1);
    let n = line.number + 1;
    while (n <= doc.lines && isSepLine(doc.line(n).text)) n++;
    if (n <= doc.lines && isTableLine(doc.line(n).text)) return goto(doc.line(n), 0);
    const row = "|" + "   |".repeat(cells.length);
    view.dispatch({
      changes: { from: line.to, insert: "\n" + row },
      selection: EditorSelection.cursor(line.to + 3), scrollIntoView: true, userEvent: "input",
    });
    return true;
  }
  if (idx > 0) return goto(line, idx - 1);
  let n = line.number - 1;
  while (n >= 1 && isSepLine(doc.line(n).text)) n--;
  if (n >= 1 && isTableLine(doc.line(n).text)) { const l = doc.line(n); return goto(l, cellRanges(l.text).length - 1); }
  return false;
}

// ───────────────────────── 명령표 ─────────────────────────

const FIG_DEFAULT = "::fig[설명]{src=images/파일이름.png w=80}";

/** 그림 한 개의 원고 글. 경로에 공백 등이 있으면 따옴표로 감쌈 */
export function figureText(src, caption = "설명", w = 80) {
  const s = /[\s}"]/.test(src) ? `"${src.replace(/"/g, "")}"` : src;
  return `::fig[${caption}]{src=${s} w=${w}}`;
}

export const COMMANDS = {
  bold: (state) => ({ ...toggleWrap(state, "**", "**"), scrollIntoView: true, userEvent: "input" }),
  blank: (state) => ({ ...blank(state), scrollIntoView: true, userEvent: "input" }),
  inlineMath: (state) => ({ ...toggleWrap(state, "$", "$", { guard: singleDollar(state.doc) }), scrollIntoView: true, userEvent: "input" }),
  displayMath: (state) => {
    const lines = selectedLines(state);
    if (lines) return wrapOrInsert(state, "$$", "$$", "");
    const block = "$$\n\n$$";
    return placeBlock(state, block, { sel: [3, 3] });
  },
  callout: (state, arg) => {
    const kind = CALLOUTS[arg] ? arg : (CALLOUT_ALIAS[arg] ?? "note");
    return wrapOrInsert(state, `:::${kind}`, ":::", "내용");
  },
  side: (state) => wrapOrInsert(state, ":::side[용어]", ":::", "풀이", "용어"),
  figure: (state, arg) => {
    const a = typeof arg === "string" ? { src: arg } : (arg ?? {});
    const block = a.src ? figureText(a.src, a.caption ?? "설명", a.w ?? 80) : FIG_DEFAULT;
    return placeBlock(state, block, { sel: selOf(block, a.caption ?? "설명"), after: false });
  },
  plot: (state) => {
    const block = "```plot\nx: 0 .. 5\ny: 0 .. 10\nf: y = 2x + 1            \"y=2x+1\"\nw: 70\n```";
    return placeBlock(state, block, { sel: selOf(block, "2x + 1") });
  },
  problem,
  solution,
  // 5지선다·<보기>: 줄마다 ①②③…, ㄱ. ㄴ. ㄷ.이 인쇄에서 자동으로 붙는다. 첫 줄에 커서
  // 정렬: 고른 줄을 :::center / :::right / :::left 로 감쌈
  align: (state, arg) => wrapOrInsert(state, `:::${["center", "right", "left"].includes(arg) ? arg : "center"}`, ":::", "내용"),
  // 탭 맞춤: 고른 줄을 감싸거나, (가)·(나) 틀을 넣고 첫 칸 뒤에 커서
  tab: (state) => {
    if (selectedLines(state)) return wrapOrInsert(state, ":::tab", ":::", "");
    const block = ":::tab\n(가) | \n(나) | \n:::";
    const i = block.indexOf("(가) | ") + "(가) | ".length;
    return placeBlock(state, block, { sel: [i, i] });
  },
  choices: (state, arg) => {
    if (arg !== "pair" || selectedLines(state)) return listBox(state, ":::choices");
    // 짝짓기 선지: 머리 줄 + 빈 줄 다섯. 첫 선지 줄 맨 앞에 커서
    const block = ":::choices\n| (가) | (나)\n | \n | \n | \n | \n | \n:::";
    const i = block.indexOf("\n | ") + 1;
    return placeBlock(state, block, { sel: [i, i] });
  },
  bogi: (state) => listBox(state, ":::bogi"),
  // <제시문>: 번호 없는 보통 글 상자. 고른 줄을 감싸거나 빈 상자를 넣고 안쪽에 커서
  jesi: (state) => listBox(state, ":::jesi"),
  space: (state) => {
    const block = "::space{h=30}";
    return placeBlock(state, block, { sel: selOf(block, "30") });
  },
  table: (state, arg) => {
    const a = typeof arg === "string" ? (/^(\d+)\D+(\d+)$/.exec(arg)?.slice(1).map(Number) ?? []) : [arg?.rows, arg?.cols];
    const block = tableText(a[0] || 3, a[1] || 3);
    return placeBlock(state, block, { sel: selOf(block, "제목 1") });
  },
  pagebreak: (state) => placeBlock(state, "::pagebreak", { after: true }),
  heading2: (state) => heading(state, 2),
  heading3: (state) => heading(state, 3),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
