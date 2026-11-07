// 편집기 앱: 왼쪽 원고 편집, 오른쪽 인쇄 미리보기, 저장·PDF. 메인 세션 담당.
// 모듈 약속: docs/INTERFACES.md
import { createEditor, createToolbar } from "./editor/index.js";
import { renderBook } from "./render/index.js";
import { splitFrontMatter } from "./render/util.js";
import { buildDocument, createPreview, printPdf } from "./layout/index.js";
import * as storage from "./storage/index.js";
import { createSampleSource, createGitHubSource, collectAssetSrcs } from "./sources.js";

const BASE = new URL("../", import.meta.url).href; // 편집기가 올라간 주소(끝에 /)
const REPO = { owner: "cherryopener", repo: "textbooks" };
const RENDER_DELAY = 400; // 입력이 멈추고 미리보기를 다시 그리기까지(ms)
const DRAFT_DELAY = 1500;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const state = {
  source: null, book: null, cur: { part: 1, chapter: 1 },
  edition: "teacher", paper: "a4", scope: "chapter",
  warnings: [], rendering: false, again: false, lastPage: null,
};
const app = (window.__app = { state }); // 시험·디버깅용

// ---------- 화면 부품 ----------
const editor = createEditor($("#editor"), {
  doc: "",
  onChange: onEdit,
  onCursorLine: (line) => { clearTimeout(onCursorTimer); onCursorTimer = setTimeout(() => followCursor(line), 150); },
  onSave: () => saveCurrent(),
  onImage: async (file) => {
    if (!state.source?.uploadImage) throw new Error("견본 책에는 그림을 올릴 수 없습니다. GitHub에 연결하세요.");
    return state.source.uploadImage(file);
  },
});
let onCursorTimer = 0;
createToolbar($("#toolbar"), editor);
app.editor = editor;

let preview = null;
function makePreview() {
  preview?.destroy();
  const w = $("#preview").clientWidth;
  const zoom = Math.max(0.35, Math.min(1, (w - 32) / 830)); // A4 폭이 화면에 맞게
  preview = createPreview($("#preview"), { zoom });
  app.preview = preview;
  app.zoom = zoom;
}

// ---------- 책·장 ----------
const chapterAt = ({ part, chapter }) => state.book?.parts[part - 1]?.chapters[chapter - 1] ?? null;
const draftKey = (ch) => `${state.source.kind}:${state.book.id}/${ch.path}`;

async function useSource(source, bookId) {
  if (!confirmLeave()) return false; // 먼저 묻고, 동의했을 때만 출처를 바꾼다(보안 검토 지적 7)
  state.source = source;
  $("#source-label").textContent = source.label;
  $("#btn-save").disabled = source.readOnly;
  const books = await source.listBooks();
  if (!books.length) {
    state.book = null;
    $("#book-title").textContent = "책 없음";
    $("#sel-chapter").innerHTML = "";
    editor.setText("");
    setBanner("이 저장소에 아직 책이 없습니다.", [["새 책 만들기", () => newThing("book")]]);
    return true;
  }
  await openBook(bookId && books.some((b) => b.id === bookId) ? bookId : books[0].id, { asked: true });
  return true;
}

async function openBook(id, { asked = false, at = null } = {}) {
  if (!asked && !confirmLeave()) return;
  setBanner(null);
  $("#book-title").textContent = "불러오는 중…";
  const book = await state.source.loadBook(id);
  for (const p of book.parts) for (const ch of p.chapters) ch.saved = ch.source; // 저장된 내용(고침 여부 판단)
  state.book = book;
  app.book = book;
  $("#book-title").textContent = book.config.title ?? id;
  const sel = $("#sel-chapter");
  sel.innerHTML = "";
  let seq = 0; // 장 번호는 책 전체로 이어진다
  book.parts.forEach((p, pi) => {
    const g = document.createElement("optgroup");
    g.label = `${pi + 1}부 ${p.config.title ?? p.dir}`;
    p.chapters.forEach((ch, ci) => {
      const o = document.createElement("option");
      o.value = `${pi + 1}:${ci + 1}`;
      o.textContent = `${++seq}. ${splitFrontMatter(ch.source).meta.title ?? ch.path}`;
      g.appendChild(o);
    });
    sel.appendChild(g);
  });
  await state.source.prepareAssets(collectAssetSrcs(book));
  await openChapter(at?.part ?? 1, at?.chapter ?? 1);
}

async function openChapter(part, chapter) {
  state.cur = { part, chapter };
  $("#sel-chapter").value = `${part}:${chapter}`;
  const ch = chapterAt(state.cur);
  editor.setText(ch.source);
  state.lastPage = null;
  updateSaveState();
  // 임시 저장된 내용이 있으면 알림
  try {
    const d = readDraft(await storage.loadDraft(draftKey(ch)));
    if (d && d.text !== ch.source) {
      setBanner(`이 장에 저장하지 않은 임시 내용이 있습니다(${new Date(d.savedAt).toLocaleString("ko-KR")}).`, [
        // 임시 내용이 바탕으로 한 저장소 판(sha)으로 되돌려 두면, 그 뒤 다른 곳에서 저장된 내용이 있을 때 저장 시 충돌 창이 뜬다
        ["불러오기", () => { ch.source = d.text; if (d.sha) ch.sha = d.sha; editor.setText(d.text); updateSaveState(); scheduleRender(0); setBanner(null); }],
        ["버리기", () => { storage.clearDraft(draftKey(ch)).catch(() => {}); setBanner(null); }],
      ]);
    } else setBanner(null);
  } catch { /* 임시 저장 기능이 없으면 넘어감 */ }
  scheduleRender(0);
}

/** 임시 저장 기록 → {text, sha, savedAt}. 바탕 sha를 함께 저장한다(보안 검토 지적 6: 오래된 임시 내용이 새 원격본을 조용히 덮어쓰지 않게) */
function readDraft(d) {
  if (!d) return null;
  try { const o = JSON.parse(d.text); if (o && o.v === 1) return { text: o.text, sha: o.sha, savedAt: d.savedAt }; } catch {}
  return { text: d.text, sha: null, savedAt: d.savedAt };
}

// ---------- 편집 → 미리보기 ----------
let renderTimer = 0, draftTimer = 0;
function onEdit(text) {
  const ch = chapterAt(state.cur);
  if (!ch) return;
  ch.source = text;
  updateSaveState();
  scheduleRender(RENDER_DELAY);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => storage.saveDraft(draftKey(ch), JSON.stringify({ v: 1, text, sha: ch.sha ?? null })).catch(() => {}), DRAFT_DELAY);
}

function scheduleRender(delay) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, delay);
}

async function renderNow() {
  if (!state.book) return;
  if (state.rendering) { state.again = true; return; }
  state.rendering = true;
  try {
    const src = state.source;
    // 새로 쓴 그림 경로가 있으면 먼저 받아 둔다
    await src.prepareAssets(collectAssetSrcs(state.book));
    const range = state.scope === "chapter" ? state.cur : undefined;
    const r = renderBook(state.book, {
      edition: state.edition, range,
      resolveAsset: (s) => src.assetUrl(s), readSvg: (s) => src.svgText(s),
    });
    const doc = buildDocument(r.html, {
      paper: state.paper, edition: state.edition, theme: state.book.print.theme,
      print: { ...state.book.print, paper: state.paper },
      resolveAsset: (s) => src.assetUrl(s) ?? "data:,", // 없는 로고·글꼴은 빈 주소(외부로 요청하지 않음) title: state.book.config.title ?? "", baseUrl: BASE,
    });
    const res = await preview.show(doc);
    const path = chapterAt(state.cur)?.path;
    state.warnings = [
      ...r.warnings.filter((w) => !w.path || w.path === path),
      ...res.warnings.filter((w) => w.code !== "page-multiple" || state.scope === "book"),
    ];
    editor.setWarnings(state.warnings.filter((w) => w.line));
    showWarnings();
    app.lastRender = { pages: res.pages, ms: res.ms, at: Date.now() };
    showPageNo();
    state.lastPage = null;
  } catch (e) {
    console.error(e);
    $("#pages").textContent = `미리보기 오류: ${e.message}`;
  } finally {
    state.rendering = false;
    if (state.again) { state.again = false; scheduleRender(0); }
  }
}

// 커서 줄이 들어 있는 쪽으로 미리보기를 옮긴다. 책 전체 미리보기에서는 장마다 줄 번호가 겹치므로 지금 장 안에서만 찾는다
function followCursor(line) {
  const { part, chapter } = state.cur;
  const pages = [...document.querySelectorAll("#preview [data-vivliostyle-page-container]")];
  let best = null, bestLine = -1;
  pages.forEach((pg, i) => {
    for (const el of pg.querySelectorAll(`[data-part="${part}"][data-chapter="${chapter}"] [data-line]`)) {
      const l = Number(el.getAttribute("data-line"));
      if (l <= line && l >= bestLine) { best = i + 1; bestLine = l; }
    }
  });
  const p = best ?? preview?.pageOfLine(line);
  if (p && p !== state.lastPage) { state.lastPage = p; preview.goToPage(p); }
}

// 지금 보고 있는 쪽 번호
function showPageNo() {
  if (!app.lastRender || !preview?.currentPage) return;
  $("#pages").textContent = `${preview.currentPage()} / ${app.lastRender.pages}쪽 · 조판 ${(app.lastRender.ms / 1000).toFixed(1)}초`;
}
$("#preview").addEventListener("scroll", () => requestAnimationFrame(showPageNo), { capture: true, passive: true });

// ---------- 경고 ----------
function showWarnings() {
  const n = state.warnings.length;
  const b = $("#btn-warn");
  b.textContent = `경고 ${n}개`;
  b.classList.toggle("ui-has", n > 0);
  const list = $("#warn-list");
  list.innerHTML = "";
  for (const w of state.warnings) {
    const it = document.createElement("button");
    it.innerHTML = `<span class="ui-code"></span><span class="ui-msg"></span>`;
    it.querySelector(".ui-code").textContent = w.line ? `${w.line}줄` : "";
    it.querySelector(".ui-msg").textContent = w.message;
    it.onclick = () => { if (w.line) editor.goToLine(w.line); list.hidden = true; };
    list.appendChild(it);
  }
  if (!n) list.hidden = true;
}
$("#btn-warn").onclick = () => { if (state.warnings.length) $("#warn-list").hidden = !$("#warn-list").hidden; };

// ---------- 저장 ----------
function updateSaveState() {
  const s = $("#save-state");
  const dirty = state.book?.parts.some((p) => p.chapters.some((c) => c.source !== c.saved));
  s.textContent = state.source?.readOnly ? "견본 책: 저장 안 됨" : dirty ? "저장 안 한 내용 있음" : "저장됨";
  s.className = state.source?.readOnly ? "ui-muted" : dirty ? "ui-dirty" : "ui-saved";
}
function confirmLeave() {
  const dirty = state.book?.parts.some((p) => p.chapters.some((c) => c.source !== c.saved));
  return !dirty || state.source?.readOnly || confirm("저장하지 않은 내용이 있습니다. 그래도 다른 책을 열까요? (고친 내용은 임시 저장되어 있습니다)");
}
window.addEventListener("beforeunload", (e) => {
  if (state.source?.readOnly) return;
  if (state.book?.parts.some((p) => p.chapters.some((c) => c.source !== c.saved))) e.preventDefault();
});

async function saveCurrent() {
  if (!state.source || state.source.readOnly) { alert("견본 책은 저장되지 않습니다. 위의 \"GitHub 연결\"로 원고 저장소에 연결하세요."); return; }
  const chs = state.book.parts.flatMap((p) => p.chapters).filter((c) => c.source !== c.saved);
  if (!chs.length) { updateSaveState(); return; }
  $("#save-state").textContent = "저장 중…";
  for (const ch of chs) {
    try {
      const r = await state.source.save(ch.path, ch.source, ch.sha);
      ch.sha = r.sha; ch.saved = ch.source;
      storage.clearDraft(draftKey(ch)).catch(() => {});
    } catch (e) {
      if (e.name === "ConflictError" && e.remote) { await resolveConflict(ch, e.remote); continue; }
      alert(`저장하지 못했습니다: ${e.message}`);
      break;
    }
  }
  updateSaveState();
}

async function resolveConflict(ch, remote) {
  const dlg = $("#dlg-conflict");
  $("#cf-remote").value = remote.text;
  $("#cf-mine").value = ch.source;
  dlg.showModal();
  const choice = await new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue), { once: true }));
  if (choice === "mine") {
    try {
      const r = await state.source.save(ch.path, ch.source, remote.sha);
      ch.sha = r.sha; ch.saved = ch.source;
    } catch (e) { alert(`저장하지 못했습니다: ${e.message} (고친 내용은 그대로 있습니다)`); }
  } else if (choice === "remote") {
    ch.sha = remote.sha; ch.source = ch.saved = remote.text;
    if (ch === chapterAt(state.cur)) { editor.setText(remote.text); scheduleRender(0); }
  }
}

// ---------- PDF ----------
async function makePdf() {
  let tip = false;
  try { tip = localStorage.getItem("latexbook.pdf-tip-off") === "1"; } catch {}
  if (!tip) {
    const dlg = $("#dlg-pdf");
    dlg.showModal();
    const v = await new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue), { once: true }));
    if (v !== "go") return;
    try { if ($("#chk-pdf-tip").checked) localStorage.setItem("latexbook.pdf-tip-off", "1"); } catch {}
  }
  const src = state.source;
  const r = renderBook(state.book, { edition: state.edition, resolveAsset: (s) => src.assetUrl(s), readSvg: (s) => src.svgText(s) });
  const doc = buildDocument(r.html, {
    paper: state.paper, edition: state.edition, theme: state.book.print.theme,
    print: { ...state.book.print, paper: state.paper },
    resolveAsset: (s) => src.assetUrl(s) ?? "data:,", // 없는 로고·글꼴은 빈 주소(외부로 요청하지 않음) title: `${state.book.config.title ?? ""} (${state.edition === "teacher" ? "교사용" : "학생용"})`, baseUrl: BASE,
  });
  app.lastPdfDoc = doc;
  await printPdf(doc, { title: state.book.config.title ?? "" });
}

// ---------- GitHub 연결 ----------
async function connectGitHub(token, remember, { save = true } = {}) {
  const store = storage.createGitHubStore({ ...REPO, token });
  await store.listBooks(); // 토큰 확인
  if (save) storage.saveToken(token, remember); // 시작할 때 저장된 토큰을 쓸 때는 저장 방식을 바꾸지 않음
  await useSource(createGitHubSource(store, { ...REPO, resolveRepoPath: storage.resolveRepoPath }), params.get("book"));
}
$("#btn-github").onclick = () => {
  let has = false;
  try { has = !!storage.loadToken(); } catch {}
  $("#btn-disconnect").hidden = !has;
  $("#github-msg").hidden = true;
  $("#inp-token").value = "";
  $("#dlg-github").showModal();
};
$("#dlg-github").addEventListener("close", async () => {
  const v = $("#dlg-github").returnValue;
  if (v === "disconnect") {
    if (!(await useSource(createSampleSource(BASE)))) return;
    try { storage.clearToken(); } catch {}
    if (confirm("이 컴퓨터에 남은 임시 저장 원고와 그림·글꼴 캐시도 지울까요? (공용 컴퓨터라면 지우세요)")) {
      try { indexedDB.deleteDatabase("latexbook"); } catch {}
    }
  } else if (v === "connect") {
    const token = $("#inp-token").value.trim();
    $("#inp-token").value = "";
    if (!token) return;
    try { await connectGitHub(token, $("#chk-remember").checked); }
    catch (e) {
      $("#github-msg").textContent = `연결하지 못했습니다: ${e.message}`;
      $("#github-msg").hidden = false;
      $("#dlg-github").showModal();
    }
  }
});

// ---------- 새 책·부·장 만들기 ----------
const pad2 = (n) => String(n).padStart(2, "0");
const yaml = (t) => JSON.stringify(String(t)); // 머리 부분 제목(따옴표·콜론 안전)
const chapterText = (title) => `---\ntitle: ${yaml(title)}\n---\n\n## 첫 절 제목\n\n여기에 본문을 씁니다.\n`;

/** kind: "book" | "chapter" | "part" (chapter·part는 대화창에서 고를 수 있음) */
async function newThing(kind) {
  if (!state.source || state.source.readOnly || !state.source.createFiles) {
    alert("견본 책에는 만들 수 없습니다. 위의 \"GitHub 연결\"로 원고 저장소에 연결하세요.");
    return;
  }
  const dlg = $("#dlg-new");
  const isBook = kind === "book";
  $("#new-heading").textContent = isBook ? "새 책 만들기" : "새 장·새 부 만들기";
  $("#new-kind-row").hidden = isBook;
  $("#new-kind").value = isBook ? "chapter" : kind;
  for (const id of ["#new-book", "#new-part", "#new-chapter"]) $(id).value = "";
  $("#new-msg").hidden = true;
  const sync = () => {
    const k = isBook ? "book" : $("#new-kind").value;
    $("#new-book-row").hidden = k !== "book";
    $("#new-part-row").hidden = k === "chapter";
    $("#new-pal-row").hidden = k === "chapter";
  };
  $("#new-kind").onchange = sync;
  sync();
  dlg.showModal();
  const v = await new Promise((ok) => dlg.addEventListener("close", () => ok(dlg.returnValue), { once: true }));
  if (v !== "ok") return;
  const k = isBook ? "book" : $("#new-kind").value;
  if (k !== "book" && state.book?.parts.some((p) => p.chapters.some((c) => c.source !== c.saved))) {
    alert("먼저 저장해 주세요. 저장하지 않은 내용이 있으면 새 장·새 부를 만들 수 없습니다.");
    return;
  }
  const bookT = $("#new-book").value.trim(), partT = $("#new-part").value.trim(), chT = $("#new-chapter").value.trim();
  const pal = $("#new-pal").value;
  if ((k === "book" && !bookT) || (k !== "chapter" && !partT) || !chT) { alert("제목을 모두 적어 주세요."); return newThing(kind); }
  try {
    setBanner("만드는 중…");
    if (k === "book") {
      const id = `book-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
      // 지금 열린 책의 머리말·로고·글꼴 설정을 이어받는다(같은 저장소의 책끼리 모양을 맞춤)
      const prev = state.book?.config?.print ?? {};
      const hasKoPub = state.source.hasRepoFile?.("fonts/KoPubWorld_Batang_Light.ttf");
      const print = { theme: "cyber", palette: pal, paper: "a4" };
      if (prev.series) print.series = prev.series;
      if (prev.fonts) print.fonts = prev.fonts;
      else if (hasKoPub) print.fonts = { body: "KoPubWorld Batang", bodyFile: "../../fonts/KoPubWorld_Batang_Light.ttf", bodyBoldFile: "../../fonts/KoPubWorld_Batang_Bold.ttf" };
      await state.source.createFiles({
        "book.json": JSON.stringify({ title: bookT, print }, null, 2) + "\n",
        "1-part1/part.json": JSON.stringify({ title: partT, print: { palette: pal } }, null, 2) + "\n",
        "1-part1/01-chapter1.md": chapterText(chT),
      }, id);
      await openBook(id);
    } else if (k === "part") {
      const n = state.book.parts.length + 1;
      await state.source.createFiles({
        [`${n}-part${n}/part.json`]: JSON.stringify({ title: partT, print: { palette: pal } }, null, 2) + "\n",
        [`${n}-part${n}/01-chapter1.md`]: chapterText(chT),
      });
      await openBook(state.book.id, { asked: true, at: { part: n, chapter: 1 } });
    } else {
      const part = state.book.parts[state.cur.part - 1];
      const m = part.chapters.length + 1;
      await state.source.createFiles({ [`${part.dir}/${pad2(m)}-chapter${m}.md`]: chapterText(chT) });
      await openBook(state.book.id, { asked: true, at: { part: state.cur.part, chapter: m } });
    }
    setBanner(null);
  } catch (e) {
    setBanner(null);
    alert(`만들지 못했습니다: ${e.message}`);
  }
}
$("#btn-add").onclick = () => newThing("chapter");
$("#btn-newbook").onclick = () => { $("#dlg-books").close(); newThing("book"); };

// ---------- 그 밖의 조작 ----------
$("#btn-book").onclick = async () => {
  const ul = $("#book-list");
  ul.innerHTML = "";
  for (const b of await state.source.listBooks()) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = b.title;
    btn.value = b.id;
    btn.onclick = () => { $("#dlg-books").close(); openBook(b.id); };
    li.appendChild(btn);
    ul.appendChild(li);
  }
  $("#dlg-books").showModal();
};
$("#sel-chapter").onchange = (e) => { const [p, c] = e.target.value.split(":").map(Number); openChapter(p, c); };
$("#sel-edition").onchange = (e) => { state.edition = e.target.value; scheduleRender(0); };
$("#sel-paper").onchange = (e) => { state.paper = e.target.value; scheduleRender(0); };
$("#sel-scope").onchange = (e) => { state.scope = e.target.value; scheduleRender(0); };
$("#btn-save").onclick = () => saveCurrent();
$("#btn-pdf").onclick = () => makePdf().catch((e) => alert(`PDF를 만들지 못했습니다: ${e.message}`));

function setBanner(text, actions = []) {
  const b = $("#banner");
  if (!text) { b.hidden = true; b.innerHTML = ""; return; }
  b.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = text;
  b.appendChild(s);
  for (const [label, fn] of actions) { const x = document.createElement("button"); x.textContent = label; x.onclick = fn; b.appendChild(x); }
  b.hidden = false;
}

// 가운데 막대를 끌어 너비 조절
(() => {
  const split = $("#split"), ed = $("#editor"), main = $("#main");
  let drag = false;
  split.addEventListener("pointerdown", (e) => { drag = true; split.classList.add("drag"); split.setPointerCapture(e.pointerId); });
  split.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = main.getBoundingClientRect();
    ed.style.flexBasis = `${Math.max(20, Math.min(80, ((e.clientX - r.left) / r.width) * 100))}%`;
  });
  split.addEventListener("pointerup", () => { drag = false; split.classList.remove("drag"); refit(); });
})();
let fitTimer = 0;
function refit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const w = $("#preview").clientWidth;
    const z = Math.max(0.35, Math.min(1, (w - 32) / 830));
    if (Math.abs(z - (app.zoom ?? 0)) > 0.04) { makePreview(); scheduleRender(0); }
  }, 300);
}
window.addEventListener("resize", refit);

// ---------- 시작 ----------
makePreview();
(async () => {
  let token = null;
  try { token = params.get("sample") ? null : storage.loadToken(); } catch {}
  try {
    if (token) await connectGitHub(token, true, { save: false });
    else await useSource(createSampleSource(BASE), params.get("book"));
  } catch (e) {
    console.error(e);
    setBanner(`원고 저장소에 연결하지 못해 견본 책을 엽니다: ${e.message}`);
    await useSource(createSampleSource(BASE));
  }
  app.ready = true;
})();
