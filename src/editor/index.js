// 편집 화면 — 담당: A. 약속: docs/INTERFACES.md 8절. 원고 문법: docs/FORMAT.md
//
// 사용법
//   import { createEditor, createToolbar } from "./editor/index.js";
//   const editor = createEditor(왼쪽칸, { doc, onChange, onCursorLine, onSave, onImage });
//   createToolbar(도구막대칸, editor);
// - 왼쪽칸은 높이가 정해진 요소(예: height:100%)여야 한다. 편집기가 그 안에서 스스로 스크롤한다.
// - 스타일(editor.css)은 createEditor가 자동으로 불러온다. 직접 넣으려면 <link rel="stylesheet" href=".../src/editor/editor.css">.
// - setText()는 onChange를 부르지 않는다(바꾼 쪽이 이미 아는 글이므로). goToLine()은 onCursorLine을 부르지 않는다(되돌아 울림 방지).
import {
  vim, Vim, getCM, Compartment,
  EditorView, EditorState, keymap, Prec, markdown, markdownLanguage, history, historyKeymap, defaultKeymap,
  drawSelection, dropCursor, highlightActiveLine, highlightSpecialChars, lineNumbers, placeholder,
  search, searchKeymap, Annotation, EditorSelection,
} from "../../vendor/codemirror.js";
import { COMMANDS, COMMAND_NAMES, SHORTCUTS, tableNavigate } from "./commands.js";
import { syntaxColors } from "./highlight.js";
import { mathCompletion } from "./completions.js";
import { warningExtensions, warningGutter, applyWarnings } from "./warnings.js";
import { imageSupport } from "./images.js";
import { createToolbar } from "./toolbar.js";

export { createToolbar, COMMAND_NAMES, SHORTCUTS };

// ───── Vim 모드(2026-11-08 사용자 요청) ─────
// @replit/codemirror-vim: 노멀·입력·비주얼 모드, 이동(hjkl w b e 0 $ gg G), 편집(x dd yy p u Ctrl-r . ciw 등), 숫자 반복,
// 검색(/ ? n N), 매크로(q), 마크(m '), 레지스터. :w 는 저장. .vimrc는 읽지 않는다.
const VIM_KEY = "pl-editor-vim";
const vimPref = { get() { try { return localStorage.getItem(VIM_KEY) === "1"; } catch { return false; } },
  set(on) { try { localStorage.setItem(VIM_KEY, on ? "1" : "0"); } catch { /* 저장 못 해도 동작 */ } } };
let vimSave = null; // :w 가 부를 저장 함수(지금 편집기의 onSave)
let vimExReady = false;
function defineVimEx() {
  if (vimExReady) return;
  vimExReady = true;
  Vim.defineEx("write", "w", () => vimSave?.());
  Vim.defineEx("wq", "wq", () => vimSave?.());
  Vim.defineEx("xit", "x", () => vimSave?.());
}
// 노멀 모드에서 한글 자판이 켜져 있어도 명령이 되게: 입력된 한글이 아니라 **눌린 키의 자리(event.code)** 를 미국 자판 글쇠로 바꿔 Vim에 넘긴다.
// 그래서 두벌식·세벌식(390, 최종) 어느 자판이든 H 자리 = h. 세벌식은 숫자 줄·기호 자리에도 한글이 있으므로 숫자·기호도 자리로 바꾼다.
// 영문 자판일 때(입력된 글자가 ASCII)는 손대지 않는다. event.code가 없을 때만 두벌식 자모 표로 짐작한다.
const CODE_KEYS = {
  Digit1: ["1", "!"], Digit2: ["2", "@"], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
  Digit6: ["6", "^"], Digit7: ["7", "&"], Digit8: ["8", "*"], Digit9: ["9", "("], Digit0: ["0", ")"],
  Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"], Backslash: ["\\", "|"],
  Semicolon: [";", ":"], Quote: ["'", '"'], Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Backquote: ["`", "~"],
};
const keyFromCode = (code, shift) => {
  if (/^Key[A-Z]$/.test(code)) return shift ? code.slice(3) : code.slice(3).toLowerCase();
  const k = CODE_KEYS[code];
  return k ? k[shift ? 1 : 0] : null;
};
const JAMO = { "ㅂ": "q", "ㅈ": "w", "ㄷ": "e", "ㄱ": "r", "ㅅ": "t", "ㅛ": "y", "ㅕ": "u", "ㅑ": "i", "ㅐ": "o", "ㅔ": "p",
  "ㅁ": "a", "ㄴ": "s", "ㅇ": "d", "ㄹ": "f", "ㅎ": "g", "ㅗ": "h", "ㅓ": "j", "ㅏ": "k", "ㅣ": "l",
  "ㅋ": "z", "ㅌ": "x", "ㅊ": "c", "ㅍ": "v", "ㅠ": "b", "ㅜ": "n", "ㅡ": "m",
  "ㅃ": "Q", "ㅉ": "W", "ㄸ": "E", "ㄲ": "R", "ㅆ": "T", "ㅒ": "O", "ㅖ": "P" };
const hangulKeys = EditorView.domEventHandlers({
  keydown(e, view) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const cm = getCM(view);
    const vs = cm?.state?.vim;
    if (!vs || vs.insertMode) return false;
    const ascii = e.key.length === 1 && e.key.charCodeAt(0) < 128;
    if (ascii || ["Escape", "Enter", "Backspace", "Tab", "Shift", "CapsLock"].includes(e.key) || e.key.startsWith("Arrow")) return false;
    const k = (e.code && keyFromCode(e.code, e.shiftKey)) ?? JAMO[e.key] ?? null;
    if (!k) return false;
    e.preventDefault();
    Vim.handleKey(cm, k, "user");
    // i·a·o 등으로 입력 모드가 되면, 같은 키로 입력기가 이미 시작한 한글 조합(예: 세벌식 390의 I 자리 'ㅁ')이 본문에 들어온다.
    // 웹 페이지는 조합 시작을 막을 수 없으므로, 조합을 강제로 끝낸 뒤(포커스를 잠깐 뺐다가 되돌림) 그때 들어온 한글 한 글자를 지운다.
    if (cm.state.vim?.insertMode) swallowComposition(view);
    return true;
  },
});
const HANGUL = /^[\u1100-\u11FF\u3131-\u318E\uAC00-\uD7A3]{1,2}$/;
function swallowComposition(view) {
  const pos = view.state.selection.main.head;
  const len = view.state.doc.length;
  const cleanup = () => {
    const added = view.state.doc.length - len;
    if (added < 1 || added > 2) return;
    const text = view.state.doc.sliceString(pos, pos + added);
    if (HANGUL.test(text)) view.dispatch({ changes: { from: pos, to: pos + added }, selection: { anchor: pos }, userEvent: "delete.ime" });
  };
  setTimeout(() => {
    const el = view.contentDOM;
    el.blur();
    view.focus();
    setTimeout(cleanup, 30);
    setTimeout(cleanup, 150); // 입력기가 늦게 확정하는 경우
  }, 0);
}

const fromGoTo = Annotation.define();

function ensureCss() {
  if (document.querySelector("link[data-pl-editor]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./editor.css", import.meta.url).href;
  link.dataset.plEditor = "";
  document.head.append(link);
}

// 찾기 창 한국어
const PHRASES = {
  Find: "찾을 글", Replace: "바꿀 글", next: "다음", previous: "이전", all: "모두", "match case": "대소문자 구분",
  "by word": "낱말 단위", regexp: "정규식", replace: "바꾸기", "replace all": "모두 바꾸기", close: "닫기",
  "current match": "현재 위치", "on line": "줄", replaced: "바꾼 개수", "replaced $ matches": "$개를 바꿈",
  "replaced match on line $": "$번 줄을 바꿈",
};

/**
 * @param {HTMLElement} parent
 * @param {{doc?:string,onChange?:(t:string)=>void,onCursorLine?:(n:number)=>void,onSave?:()=>void,onImage?:(f:File)=>Promise<string>}} opts
 */
export function createEditor(parent, opts = {}) {
  ensureCss();
  const root = document.createElement("div");
  root.className = "pl-editor";
  const body = document.createElement("div");
  body.className = "pl-editor-body";
  const statusEl = document.createElement("div");
  statusEl.className = "pl-editor-status";
  statusEl.setAttribute("role", "status");
  statusEl.hidden = true;
  root.append(body, statusEl);
  parent.append(root);

  let statusTimer = 0;
  const status = {
    set(text, kind = "", ms = 0) {
      clearTimeout(statusTimer);
      statusEl.hidden = !text;
      statusEl.textContent = text;
      statusEl.dataset.kind = kind;
      if (text && ms) statusTimer = setTimeout(() => status.set(""), ms);
    },
  };

  const images = imageSupport(() => opts, status);
  let view; // 아래에서 만듦
  const run = (name) => (v) => {
    if (v.composing) return true; // 한글 조합 중에는 건드리지 않음
    runCommand(name);
    return true;
  };
  const keys = [
    { key: SHORTCUTS.save, run: () => { opts.onSave?.(); return true; }, preventDefault: true },
    ...["bold", "blank", "inlineMath", "displayMath", "heading2", "heading3", "pagebreak"]
      .map((name) => ({ key: SHORTCUTS[name], run: run(name), preventDefault: true })),
    { key: "Tab", run: (v) => !v.composing && tableNavigate(v, 1) },
    { key: "Shift-Tab", run: (v) => !v.composing && tableNavigate(v, -1) },
  ];

  defineVimEx();
  vimSave = () => opts.onSave?.();
  let vimOn = opts.vim ?? vimPref.get();
  const vimComp = new Compartment();
  const vimExt = (on) => (on ? [Prec.highest(hangulKeys), vim({ status: true })] : []);

  const extensions = [
    vimComp.of(vimExt(vimOn)), // Vim 키맵은 다른 키맵보다 앞에
    warningGutter, // 경고 표시 칸은 줄 번호보다 왼쪽
    lineNumbers(),
    history(),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    highlightSpecialChars(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxColors,
    mathCompletion,
    search({ top: true }),
    EditorState.phrases.of(PHRASES),
    placeholder("여기에 원고를 씁니다. 위의 단추로 상자·수식·그림 틀을 넣을 수 있습니다."),
    warningExtensions,
    images.extensions,
    Prec.high(keymap.of(keys)),
    keymap.of([...historyKeymap, ...searchKeymap, ...defaultKeymap]),
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": "원고 편집" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange?.(u.state.doc.toString());
      if (u.docChanged || u.selectionSet) {
        const n = u.state.doc.lineAt(u.state.selection.main.head).number;
        if (n !== lastLine) {
          lastLine = n;
          if (!u.transactions.some((t) => t.annotation(fromGoTo))) opts.onCursorLine?.(n);
        }
      }
    }),
  ];
  let lastLine = 1;
  const makeState = (doc) => EditorState.create({ doc, extensions: [vimComp.of(vimExt(vimOn)), ...extensions.slice(1)] });
  view = new EditorView({ state: makeState(opts.doc ?? ""), parent: body });

  function runCommand(name, arg) {
    const fn = COMMANDS[name];
    if (!fn) throw new Error(`editor.command: 알 수 없는 명령 "${name}"`);
    const spec = fn(view.state, arg);
    if (spec) view.dispatch(spec);
    view.focus();
  }

  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
    input.multiple = true;
    input.addEventListener("change", () => {
      if (input.files?.length) images.handleFiles(view, [...input.files], view.state.selection.main.head);
    });
    input.click();
  }

  return {
    getText: () => view.state.doc.toString(),
    setText(text) {
      text = String(text ?? "");
      if (text === view.state.doc.toString()) return;
      view.setState(makeState(text)); // 되돌리기 기록과 경고 표시는 비워짐
      lastLine = 1;
    },
    goToLine(line) {
      const doc = view.state.doc;
      const l = doc.line(Math.max(1, Math.min(doc.lines, Math.floor(line) || 1)));
      view.dispatch({
        selection: EditorSelection.cursor(l.from),
        effects: EditorView.scrollIntoView(l.from, { y: "center" }),
        annotations: fromGoTo.of(true),
      });
    },
    setWarnings: (list) => applyWarnings(view, list),
    command: runCommand,
    destroy() {
      clearTimeout(statusTimer);
      images.destroy();
      view.destroy();
      root.remove();
    },
    // 약속 밖 덧붙임
    focus: () => view.focus(),
    /** Vim 모드 켜기·끄기(브라우저에 기억) */
    get vim() { return vimOn; },
    setVim(on) {
      vimOn = !!on;
      vimPref.set(vimOn);
      view.dispatch({ effects: vimComp.reconfigure(vimExt(vimOn)) });
      view.focus();
    },
    pickImage: () => pickImage(),
    get canPickImage() { return typeof opts.onImage === "function"; },
    view,
  };
}
