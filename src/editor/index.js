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

  const extensions = [
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
  const makeState = (doc) => EditorState.create({ doc, extensions });
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
    pickImage: () => pickImage(),
    get canPickImage() { return typeof opts.onImage === "function"; },
    view,
  };
}
