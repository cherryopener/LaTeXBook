// 경고 표시 — 해당 줄에 배경색 + 줄 옆 표시, 마우스를 올리면 한국어 설명.
// 경고는 줄 맨 앞 위치로 저장되어 입력으로 줄이 밀려도 따라간다(다음 setWarnings 전까지).
import { StateField, StateEffect, Decoration, EditorView, ViewPlugin, GutterMarker, gutter, RangeSet } from "../../vendor/codemirror.js";

/** 경고 코드별 기본 설명(Warning.message가 비었을 때만 씀. docs/FORMAT.md 6절) */
export const WARNING_TEXT = {
  "unknown-directive": "모르는 상자·블록 이름입니다.",
  "missing-image": "그림 파일을 찾을 수 없습니다.",
  "low-dpi": "인쇄 크기에서 해상도가 300dpi보다 낮습니다.",
  "bad-math": "수식을 해석하지 못했습니다.",
  "unknown-ref": "참조한 수식·그림 이름이 없습니다.",
  "duplicate-label": "같은 이름이 두 번 쓰였습니다.",
  "side-outside-theory": "옆 단은 개념 구간에서만 쓸 수 있습니다.",
  "source-overflow": "교사용 정답(:::source)이 단을 넘칩니다. 교사용과 학생용의 쪽 번호가 어긋날 수 있습니다.",
  "source-spill": "교사용 정답(:::source)이 칸을 넘쳐 다음 칸에 겹칩니다.",
  "solution-outside-problem": "해설(:::solution)은 문항(::::problem) 안에 씁니다.",
  "plot-error": "그래프의 식이나 범위에 오류가 있습니다.",
  "page-multiple": "전체 쪽수가 인쇄소 배수에 맞지 않습니다.",
  "toc-overflow": "책 첫 쪽 목차가 한 쪽에 다 들어가지 않습니다. print.tocDepth를 1로 줄여 보세요.",
};

export const setWarningsEffect = StateEffect.define();

class WarnMarker extends GutterMarker {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "pl-warn-marker";
    el.textContent = "!";
    el.dataset.warn = this.text;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "경고: " + this.text);
    return el;
  }
}

/** 칸 너비만 잡아 두는 빈 표시 */
class Spacer extends GutterMarker {
  toDOM() { const el = document.createElement("span"); el.className = "pl-warn-spacer"; return el; }
}

const warnField = StateField.define({
  create: () => ({ lines: Decoration.none, marks: RangeSet.empty }),
  update(v, tr) {
    for (const e of tr.effects) {
      if (!e.is(setWarningsEffect)) continue;
      const doc = tr.state.doc;
      const byLine = new Map();
      for (const w of e.value) {
        if (!Number.isInteger(w.line) || w.line < 1) continue;
        const n = Math.min(w.line, doc.lines);
        const text = (w.message || WARNING_TEXT[w.code] || w.code || "경고").trim();
        const list = byLine.get(n) ?? [];
        if (!list.includes(text)) list.push(text);
        byLine.set(n, list);
      }
      const decos = [], marks = [];
      for (const n of [...byLine.keys()].sort((a, b) => a - b)) {
        const from = doc.line(n).from, text = byLine.get(n).join("\n");
        decos.push(Decoration.line({ class: "pl-warn-line", attributes: { "data-warn": text } }).range(from));
        marks.push(new WarnMarker(text).range(from));
      }
      return { lines: Decoration.set(decos), marks: RangeSet.of(marks) };
    }
    if (tr.docChanged) return { lines: v.lines.map(tr.changes), marks: v.marks.map(tr.changes) };
    return v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.lines),
});

export const warningGutter = gutter({
  class: "pl-warn-gutter",
  markers: (view) => view.state.field(warnField).marks,
  initialSpacer: () => new Spacer(),
});

/** 마우스를 올리면 설명 상자 */
const tooltip = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.tip = null;
    this.over = (e) => {
      const el = e.target instanceof Element ? e.target.closest("[data-warn]") : null;
      if (el && view.dom.contains(el)) this.show(el, e); else this.hide();
    };
    this.hide = () => { this.tip?.remove(); this.tip = null; };
    view.dom.addEventListener("mouseover", this.over);
    view.dom.addEventListener("mouseleave", this.hide);
    view.scrollDOM.addEventListener("scroll", this.hide);
  }
  show(el, e) {
    this.hide();
    const tip = document.createElement("div");
    tip.className = "pl-warn-tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = el.dataset.warn;
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const x = el.classList.contains("pl-warn-marker") ? r.right + 6 : Math.max(r.left, Math.min(e.clientX, r.right - 40));
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + "px";
    const below = r.bottom + 4;
    tip.style.top = (below + h > window.innerHeight ? Math.max(4, r.top - h - 4) : below) + "px";
    this.tip = tip;
  }
  update(u) { if (u.docChanged) this.hide(); }
  destroy() {
    this.hide();
    this.view.dom.removeEventListener("mouseover", this.over);
    this.view.dom.removeEventListener("mouseleave", this.hide);
    this.view.scrollDOM.removeEventListener("scroll", this.hide);
  }
});

export const warningExtensions = [warnField, tooltip];

/** 경고 목록을 화면에 반영 (line은 1부터, 줄 번호가 없는 경고는 표시하지 않음) */
export function applyWarnings(view, list) {
  view.dispatch({ effects: setWarningsEffect.of(Array.isArray(list) ? list : []) });
}
