// 도구 막대 — 한국어 단추 묶음. 단추는 editor.command(...)만 부른다.
import { SHORTCUTS, CALLOUTS } from "./commands.js";

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "");

/** "Mod-Shift-m" → 맥 "⇧⌘M", 그 밖 "Ctrl+Shift+M" */
export function formatShortcut(spec, mac = isMac()) {
  const parts = spec.split("-");
  const key = parts.pop();
  const has = (m) => parts.includes(m);
  const name = key.length === 1 ? key.toUpperCase() : key === "Enter" ? (mac ? "↩" : "Enter") : key;
  if (mac) return (has("Alt") ? "⌥" : "") + (has("Shift") ? "⇧" : "") + (has("Mod") ? "⌘" : "") + name;
  return [has("Mod") && "Ctrl", has("Alt") && "Alt", has("Shift") && "Shift", name].filter(Boolean).join("+");
}

const ariaShortcut = (spec) => spec.replace("Mod", isMac() ? "Meta" : "Control").replace(/-/g, "+");

const KIND_HINT = { note: "개념 보충", tip: "알아 두면 좋은 것", warn: "틀리기 쉬운 것", think: "스스로 생각해 볼 것" };

// 단추 정의. glyph: 단추 안 그림 글자. name: 화면 글자. desc: 마우스를 올렸을 때 설명
const GROUPS = [
  { label: "글자", items: [
    { cmd: "bold", glyph: "B", name: "굵게", desc: "고른 글자를 굵게", glyphClass: "g-bold" },
    { cmd: "blank", glyph: "가", name: "빈칸", desc: "고른 글자를 학생용에서 빈칸으로 (한 번 더 누르면 풀림)", glyphClass: "g-blank" },
  ] },
  { label: "수식", items: [
    { cmd: "inlineMath", glyph: "x²", name: "글 속 수식", desc: "글 속에 들어가는 수식 $…$" },
    { cmd: "displayMath", glyph: "∑", name: "별도 수식", desc: "가운데 따로 놓이는 수식 $$…$$" },
  ] },
  { label: "제목", items: [
    { cmd: "heading2", glyph: "H2", name: "절 제목", desc: "현재 줄을 절 제목(##)으로", glyphClass: "g-small" },
    { cmd: "heading3", glyph: "H3", name: "소제목", desc: "현재 줄을 소제목(###)으로", glyphClass: "g-small" },
  ] },
  { label: "상자", items: [
    { menu: "callout", glyph: "▤", name: "상자", desc: "참고·팁·주의·생각해 보기 상자", options: Object.entries(CALLOUTS).map(([k, v]) => ({ cmd: "callout", arg: k, name: v, hint: KIND_HINT[k], kind: k })) },
    { cmd: "side", glyph: "▌", name: "옆 단", desc: "개념 구간의 좁은 옆 단에 놓는 용어 풀이" },
  ] },
  { label: "넣기", items: [
    { menu: "figure", glyph: "▣", name: "그림", desc: "그림 넣기" },
    { cmd: "plot", glyph: "∿", name: "그래프", desc: "함수 그래프 견본 틀" },
    { menu: "table", glyph: "▦", name: "표", desc: "표 넣기 (칸 수 고르기)" },
    { cmd: "pagebreak", glyph: "⏎", name: "쪽 나눔", desc: "다음 쪽에서 계속" },
  ] },
  { label: "문제", items: [
    { cmd: "problem", glyph: "Q", name: "문제 추가", desc: "문항 틀(풀이 포함)을 넣기. 문제 구간이 없으면 장 끝에 만듦" },
    { cmd: "solution", glyph: "해", name: "해설", desc: "문항 안에 해설(:::solution) 넣기" },
    { menu: "choices", glyph: "①", name: "선지", desc: "5지선다(:::choices). 한 줄에 하나씩 쓰면 ①②③④⑤가 차례로 붙음", options: [
      { cmd: "choices", arg: "plain", name: "보통 선지", hint: "한 줄에 하나: ①②③④⑤" },
      { cmd: "choices", arg: "pair", name: "짝짓기 선지", hint: "(가)·(나)에 들어갈 말: 칸은 | 로 나눔, 인쇄에 테두리 없음" },
    ] },
    { cmd: "bogi", glyph: "ㄱ", name: "보기", desc: "<보기> 상자(:::bogi). 한 줄에 하나씩 쓰면 ㄱ. ㄴ. ㄷ.이 차례로 붙음" },
    { cmd: "space", glyph: "↕", name: "풀이 공간", desc: "학생이 풀 빈 공간 (::space)" },
  ] },
];

function el(tag, cls, attrs = {}, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} parent
 * @param {{command:(name:string,arg?:any)=>void, pickImage?:()=>void, canPickImage?:boolean}} editor
 */
export function createToolbar(parent, editor) {
  const bar = el("div", "pl-toolbar", { role: "toolbar", "aria-label": "원고 서식 도구 막대" });
  const menus = []; // 열린 메뉴 닫기용
  const closeAll = (except) => { for (const m of menus) if (m !== except) m.close(); };

  const tip = (item) => {
    const spec = SHORTCUTS[item.cmd];
    return spec ? `${item.desc} (${formatShortcut(spec)})` : item.desc;
  };

  function baseButton(item) {
    const b = el("button", "pl-btn", { type: "button" });
    b.append(el("span", "pl-glyph" + (item.glyphClass ? " " + item.glyphClass : ""), { "aria-hidden": "true" }, item.glyph), el("span", "pl-name", {}, item.name));
    const spec = SHORTCUTS[item.cmd];
    b.title = tip(item);
    b.setAttribute("aria-label", spec ? `${item.name} (${formatShortcut(spec)})` : `${item.name}: ${item.desc}`);
    if (spec) b.setAttribute("aria-keyshortcuts", ariaShortcut(spec));
    b.addEventListener("mousedown", (e) => e.preventDefault()); // 편집기의 선택과 커서를 그대로 둠
    return b;
  }

  /** 누르면 아래로 펼쳐지는 단추 */
  function menuButton(item, buildPanel) {
    const wrap = el("span", "pl-menu-wrap");
    const b = baseButton(item);
    b.classList.add("pl-has-menu");
    b.setAttribute("aria-haspopup", "true");
    b.setAttribute("aria-expanded", "false");
    b.dataset.menu = item.menu;
    b.append(el("span", "pl-caret", { "aria-hidden": "true" }, "▾"));
    const panel = el("div", "pl-menu", { hidden: "" });
    buildPanel(panel, () => api.close());
    wrap.append(b, panel);
    const api = {
      open() { closeAll(api); panel.hidden = false; b.setAttribute("aria-expanded", "true"); },
      close() { panel.hidden = true; b.setAttribute("aria-expanded", "false"); },
      get isOpen() { return !panel.hidden; },
      panel, button: b,
    };
    menus.push(api);
    b.addEventListener("click", () => (api.isOpen ? api.close() : api.open()));
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); api.open(); panel.querySelector("button")?.focus(); }
    });
    panel.addEventListener("keydown", (e) => {
      const items = [...panel.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); api.close(); b.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    });
    return { wrap, api };
  }

  function menuItem(label, hint, onPick, extra = {}) {
    const b = el("button", "pl-menu-item", { type: "button", role: "menuitem" });
    b.append(el("span", "pl-menu-name", {}, label));
    if (hint) b.append(el("span", "pl-menu-hint", {}, hint));
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", onPick);
    for (const [k, v] of Object.entries(extra)) b.dataset[k] = v;
    return b;
  }

  function buildMenu(item) {
    if (item.menu === "callout") {
      return menuButton(item, (panel, close) => {
        panel.setAttribute("role", "menu");
        for (const o of item.options) {
          const mi = menuItem(o.name, o.hint, () => { close(); editor.command("callout", o.arg); }, { cmd: "callout", arg: o.arg });
          mi.prepend(el("span", `pl-dot pl-dot-${o.kind}`, { "aria-hidden": "true" }));
          panel.append(mi);
        }
      });
    }
    if (item.menu === "choices") {
      return menuButton(item, (panel, close) => {
        panel.setAttribute("role", "menu");
        for (const o of item.options) panel.append(menuItem(o.name, o.hint, () => { close(); editor.command(o.cmd, o.arg); }, { cmd: o.cmd, arg: o.arg }));
      });
    }
    if (item.menu === "figure") {
      return menuButton(item, (panel, close) => {
        panel.setAttribute("role", "menu");
        if (editor.canPickImage) {
          panel.append(menuItem("사진 파일 고르기…", "저장소에 올리고 바로 넣음 (붙여넣기·끌어다 놓기도 됨)", () => { close(); editor.pickImage(); }, { cmd: "figure-pick" }));
        }
        panel.append(menuItem("그림 틀 넣기", "이미 올린 그림의 경로를 직접 적을 때", () => { close(); editor.command("figure"); }, { cmd: "figure" }));
      });
    }
    // 표: 칸 수 고르기 격자
    return menuButton(item, (panel, close) => {
      panel.classList.add("pl-menu-grid");
      const ROWS = 6, COLS = 8;
      const label = el("div", "pl-grid-label", { "aria-live": "polite" }, "칸을 눌러 크기를 고르세요");
      const grid = el("div", "pl-grid", { role: "grid", "aria-label": "표 크기" });
      const cells = [];
      const paint = (r, c) => {
        for (const cell of cells) cell.classList.toggle("on", +cell.dataset.r <= r && +cell.dataset.c <= c);
        label.textContent = r ? `${r}줄 × ${c}칸 (첫 줄은 제목 줄)` : "칸을 눌러 크기를 고르세요";
      };
      for (let r = 1; r <= ROWS; r++) {
        for (let c = 1; c <= COLS; c++) {
          const cell = el("button", "pl-grid-cell", { type: "button", "aria-label": `${r}줄 ${c}칸 표`, tabindex: r === 1 && c === 1 ? "0" : "-1" });
          cell.dataset.r = r; cell.dataset.c = c; cell.dataset.table = `${r}x${c}`;
          cell.addEventListener("mousedown", (e) => e.preventDefault());
          cell.addEventListener("mouseenter", () => paint(r, c));
          cell.addEventListener("focus", () => paint(r, c));
          cell.addEventListener("click", () => { close(); editor.command("table", { rows: r, cols: c }); });
          cells.push(cell);
          grid.append(cell);
        }
      }
      grid.addEventListener("mouseleave", () => paint(0, 0));
      grid.addEventListener("keydown", (e) => {
        const i = cells.indexOf(document.activeElement);
        const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
        if (d && i >= 0 && cells[i + d]) { e.preventDefault(); cells[i].tabIndex = -1; cells[i + d].tabIndex = 0; cells[i + d].focus(); }
      });
      panel.append(grid, label);
    });
  }

  for (const g of GROUPS) {
    const group = el("div", "pl-group", { role: "group", "aria-label": g.label });
    for (const item of g.items) {
      if (item.menu) {
        group.append(buildMenu(item).wrap);
      } else {
        const b = baseButton(item);
        b.dataset.cmd = item.cmd;
        b.addEventListener("click", () => { closeAll(); editor.command(item.cmd); });
        group.append(b);
      }
    }
    bar.append(group);
  }

  // Vim 모드 켜기·끄기(편집기가 지원할 때만)
  if (typeof editor.setVim === "function") {
    const group = el("div", "pl-group pl-group-vim", { role: "group", "aria-label": "편집 방식" });
    const b = baseButton({ glyph: "Vi", name: "Vim", desc: "Vim처럼 편집(노멀·입력 모드, :w 저장). 다시 누르면 끔" });
    b.classList.add("pl-toggle");
    const sync = () => { b.setAttribute("aria-pressed", editor.vim ? "true" : "false"); b.classList.toggle("on", !!editor.vim); };
    b.addEventListener("click", () => { closeAll(); editor.setVim(!editor.vim); sync(); });
    sync();
    group.append(b);
    bar.append(group);
  }

  // 바깥을 누르거나 Esc를 누르면 펼침 닫기
  const onDocDown = (e) => { if (!bar.contains(e.target)) closeAll(); };
  const onDocKey = (e) => {
    if (e.key !== "Escape") return;
    const open = menus.find((m) => m.isOpen);
    if (open) { open.close(); editor.focus?.(); }
  };
  document.addEventListener("mousedown", onDocDown);
  document.addEventListener("keydown", onDocKey);
  // 도구 막대 안에서 좌우 화살표로 단추 이동
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.target.closest(".pl-menu")) return;
    const btns = [...bar.querySelectorAll(".pl-group > .pl-btn, .pl-group > .pl-menu-wrap > .pl-btn")];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length].focus();
  });

  parent.append(bar);
  return { element: bar, destroy() { document.removeEventListener("mousedown", onDocDown); document.removeEventListener("keydown", onDocKey); bar.remove(); } };
}
