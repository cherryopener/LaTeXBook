// 편집 화면(src/editor) 시험
// 1부: 명령이 만드는 글자를 Node에서 정확히 비교 (화면 없이)
// 2부: 브라우저(Playwright)에서 도구 막대·단축키·자동 완성·경고·그림 붙여넣기·한글 입력 확인 + 확인용 그림을 out/editor/에 저장
import fs from "node:fs";
import path from "node:path";
import { EditorState, EditorSelection } from "../vendor/codemirror.js";
import { COMMANDS, scanStructure, findBlanks, tableText } from "../src/editor/commands.js";
import { formatShortcut } from "../src/editor/toolbar.js";
import { openBrowser, ROOT } from "./lib/browser.mjs";

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failures.push(name);
  console.log(`  실패: ${name}${detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`);
}
const eq = (name, got, want) => check(name, got === want, { got, want });

// ───────────── 1부: 명령 문자열 ─────────────
/** 표기: "|" 는 커서, "⟦ ⟧" 는 선택 범위(원고의 [ ] 와 겹치지 않게). 결과도 같은 표기로 돌려줌 */
function parse(marked) {
  const a = marked.indexOf("⟦"), b = marked.indexOf("⟧");
  if (a >= 0 && b > a) return { doc: marked.slice(0, a) + marked.slice(a + 1, b) + marked.slice(b + 1), from: a, to: b - 1 };
  const c = marked.indexOf("|");
  if (c >= 0) return { doc: marked.replace("|", ""), from: c, to: c };
  return { doc: marked, from: marked.length, to: marked.length };
}
function run(marked, name, arg) {
  const { doc, from, to } = parse(marked);
  let state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  const spec = COMMANDS[name](state, arg);
  state = state.update(spec).state;
  const t = state.doc.toString(), r = state.selection.main;
  const shown = r.empty ? t.slice(0, r.from) + "|" + t.slice(r.from) : t.slice(0, r.from) + "⟦" + t.slice(r.from, r.to) + "⟧" + t.slice(r.to);
  return { text: t, shown };
}
const T = (name, marked, cmd, want, arg) => eq(name, run(marked, cmd, arg).shown, want);

// 굵게·수식
T("굵게: 선택 감싸기", "이것은 ⟦중요⟧합니다", "bold", "이것은 **⟦중요⟧**합니다");
T("굵게: 다시 누르면 풀기(선택이 바깥)", "이것은 **⟦중요⟧**합니다", "bold", "이것은 ⟦중요⟧합니다");
T("굵게: 기호까지 선택하면 풀기", "이것은 ⟦**중요**⟧합니다", "bold", "이것은 ⟦중요⟧합니다");
T("굵게: 커서만 있으면 빈 틀", "가|나", "bold", "가**|**나");
T("굵게: 커서가 빈 틀 안이면 풀기", "가**|**나", "bold", "가|나");
T("굵게: 양끝 공백은 밖으로", "가⟦ 나다 ⟧라", "bold", "가 **⟦나다⟧** 라");
T("글 속 수식: 감싸기", "속도 ⟦v⟧ 는", "inlineMath", "속도 $⟦v⟧$ 는");
T("글 속 수식: 풀기", "속도 $⟦v⟧$ 는", "inlineMath", "속도 ⟦v⟧ 는");
T("글 속 수식: 빈 틀", "|", "inlineMath", "$|$");
T("별도 수식: 빈 틀", "문장입니다.|", "displayMath", "문장입니다.\n\n$$\n|\n$$");
T("별도 수식: 선택 줄 감싸기", "앞\n⟦F = ma⟧\n뒤", "displayMath", "앞\n\n$$\nF = ma|\n$$\n\n뒤");

// 빈칸
T("빈칸: 선택 감싸기", "이것을 ⟦알짜힘⟧이라 한다", "blank", "이것을 :blank[⟦알짜힘⟧]이라 한다");
T("빈칸: 이미 감싸져 있으면 풀기(내용 선택)", "이것을 :blank[⟦알짜힘⟧]이라 한다", "blank", "이것을 ⟦알짜힘⟧이라 한다");
T("빈칸: 안에 커서만 있어도 풀기", "이것을 :blank[알짜|힘]이라 한다", "blank", "이것을 알짜|힘이라 한다");
T("빈칸: 토큰 전체 선택해도 풀기", "이것을 ⟦:blank[알짜힘]⟧이라", "blank", "이것을 ⟦알짜힘⟧이라");
T("빈칸: 커서만 있으면 빈 틀", "이것은 |", "blank", "이것은 :blank[|]");
T("빈칸: 수식 감싸기", "그래서 ⟦$v=at$⟧ 이다", "blank", "그래서 :blank[⟦$v=at$⟧] 이다");
T("빈칸: 대괄호가 든 내용도 풀기", "가 :blank[$x_{[1]}$|] 나", "blank", "가 $x_{[1]}$| 나");
T("빈칸: 다른 빈칸 밖이면 새로 감싸기", "A :blank[가] B ⟦나⟧ C", "blank", "A :blank[가] B :blank[⟦나⟧] C");
eq("findBlanks", JSON.stringify(findBlanks("a :blank[x] b :blank[y[1]]")), '[{"start":2,"open":8,"close":10},{"start":14,"open":20,"close":25}]');

// 제목
T("절 제목: 붙이기", "위치와 변위|", "heading2", "## 위치와 변위|");
T("절 제목: 한 번 더 누르면 풀기", "## 위치와 변위|", "heading2", "위치와 변위|");
T("소제목: 절 제목에서 바꾸기", "## 단위|", "heading3", "### 단위|");
T("절 제목: 여러 줄 선택", "⟦가\n나⟧", "heading2", "## ⟦가\n## 나⟧");

// 상자류
T("상자(참고): 현재 줄 아래, 앞뒤 빈 줄", "문장.|\n뒤 문단", "callout", "문장.\n\n:::note\n⟦내용⟧\n:::\n\n뒤 문단", "note");
T("상자(팁)", "|", "callout", ":::tip\n⟦내용⟧\n:::", "tip");
T("상자(주의)", "|", "callout", ":::warn\n⟦내용⟧\n:::", "warn");
T("상자(생각해 보기)", "|", "callout", ":::think\n⟦내용⟧\n:::", "think");
T("상자: 한국어 이름도 받음", "|", "callout", ":::warn\n⟦내용⟧\n:::", "주의");
T("상자: 인자 없으면 참고", "|", "callout", ":::note\n⟦내용⟧\n:::");
T("상자: 빈 줄 하나뿐인 곳은 그 줄을 대신함", "앞\n|\n뒤", "callout", "앞\n\n:::note\n⟦내용⟧\n:::\n\n뒤", "note");
T("상자: 선택 줄 감싸기", "앞\n⟦설명 한 줄\n둘째 줄⟧\n뒤", "callout", "앞\n\n:::tip\n설명 한 줄\n둘째 줄|\n:::\n\n뒤", "tip");
T("옆 단: 틀", "|", "side", ":::side[⟦용어⟧]\n풀이\n:::");
T("옆 단: 선택 줄 감싸기", "⟦짧은 풀이⟧", "side", ":::side[⟦용어⟧]\n짧은 풀이\n:::");
T("해설(문항 밖): 틀", "|", "solution", ":::solution\n⟦풀이⟧\n:::");
T("풀이 공간", "|", "space", "::space{h=⟦30⟧}");
T("쪽 나눔: 다음 빈 줄에 커서", "문장.|", "pagebreak", "문장.\n\n::pagebreak\n|");
T("쪽 나눔: 뒤에 글이 있어도 빈 줄을 두고 그 줄에 커서", "문장.|\n뒤", "pagebreak", "문장.\n\n::pagebreak\n|\n뒤");
T("그림: 틀", "|", "figure", "::fig[⟦설명⟧]{src=images/파일이름.png w=80}");
T("그림: 경로 지정", "|", "figure", "::fig[⟦설명⟧]{src=images/a.png w=80}", "images/a.png");
T("그림: 경로에 공백이 있으면 따옴표", "|", "figure", '::fig[⟦설명⟧]{src="images/내 그림.png" w=80}', "images/내 그림.png");
T("그래프: 견본 틀", "|", "plot", '```plot\nx: 0 .. 5\ny: 0 .. 10\nf: y = ⟦2x + 1⟧            "y=2x+1"\nw: 70\n```');
T("표: 3줄 × 2칸", "|", "table", "| ⟦제목 1⟧ | 제목 2 |\n|---|---|\n|   |   |\n|   |   |", { rows: 3, cols: 2 });
T("표: 문자열 인자", "|", "table", "| ⟦제목 1⟧ | 제목 2 |\n|---|---|\n|   |   |", "2x2");
eq("표 글자: 열 세 개", tableText(2, 3), "| 제목 1 | 제목 2 | 제목 3 |\n|---|---|---|\n|   |   |   |");
T("상자 닫는 줄 바로 앞에 넣을 때 빈 줄을 만들지 않음", "::::problem\n본문|\n::::", "solution", "::::problem\n본문\n\n:::solution\n⟦풀이⟧\n:::\n::::");

// 문제
const THEORY = "---\ntitle: 장\n---\n\n## 절\n\n본문 문장.";
{
  const r = run(THEORY, "problem");
  eq("문제: ::problems가 없으면 장 끝에 먼저 넣고 그 뒤에 문항", r.text, THEORY + "\n\n::problems\n\n::::problem\n문제 내용\n\n:::solution\n풀이\n:::\n::::");
  eq("문제: 문항 글자를 골라 둠", r.shown.slice(r.shown.indexOf("⟦") + 1, r.shown.indexOf("⟧")), "문제 내용");
  const again = run(r.text.replace("문제 내용", "|문제 내용"), "problem");
  eq("문제: 문항 안에서 또 누르면 그 문항 뒤에 새 문항(::problems는 하나)", (again.text.match(/^::problems$/gm) || []).length + "/" + (again.text.match(/^::::problem$/gm) || []).length, "1/2");
  check("문제: 첫 문항이 닫힌 뒤에 둘째가 시작", /::::\n\n::::problem\n문제 내용/.test(again.text), again.text);
  const empty = run("", "problem");
  eq("문제: 빈 원고에서도 동작", empty.text, "::problems\n\n::::problem\n문제 내용\n\n:::solution\n풀이\n:::\n::::");
}
{
  const withProblems = "본문\n\n::problems\n\n::::problem\n가\n:::solution\n나\n:::\n::::\n\n끝";
  const a = run("|" + withProblems, "problem"); // 개념 구간에 커서 → 문제 구간 끝
  check("문제: 개념 구간에서 누르면 문제 구간 끝에 넣음", a.text.indexOf("::::problem", a.text.indexOf("끝")) > 0 && (a.text.match(/^::problems$/gm) || []).length === 1, a.text);
  const b = run("본문\n\n::problems\n\n|", "problem"); // ::problems 뒤 빈 줄
  eq("문제: ::problems 뒤 커서 자리에 넣음", b.text, "본문\n\n::problems\n\n::::problem\n문제 내용\n\n:::solution\n풀이\n:::\n::::");
  eq("scanStructure", JSON.stringify(scanStructure(EditorState.create({ doc: withProblems }).doc)), '{"problemsLine":3,"blocks":[{"open":5,"close":10,"solution":7}]}');
  eq("scanStructure: 코드 울타리 안은 무시", scanStructure(EditorState.create({ doc: "```\n::problems\n```\n\n본문" }).doc).problemsLine, null);
  eq("scanStructure: ::problems{per=4} 도 문제 구간", scanStructure(EditorState.create({ doc: "# 장\n\n::problems{first=4 per=6}\n\n::::problem\n문\n::::" }).doc).problemsLine, 3);
  const s = run("::problems\n\n::::problem\n본문|\n::::", "solution");
  eq("해설: 문항 안에서 닫는 줄 앞에 넣음", s.text, "::problems\n\n::::problem\n본문\n\n:::solution\n풀이\n:::\n::::");
  const s2 = run("::::problem\n본문|\n\n:::solution\n내용\n:::\n::::", "solution");
  check("해설: 이미 있으면 새로 넣지 않고 그리로 이동", s2.text === "::::problem\n본문\n\n:::solution\n내용\n:::\n::::" && s2.shown.includes("내용|"), s2.shown);
}
eq("단축키 표기(맥)", formatShortcut("Mod-Shift-m", true), "⇧⌘M");
eq("단축키 표기(그 밖)", formatShortcut("Mod-Alt-2", false), "Ctrl+Alt+2");
eq("단축키 표기(Enter)", formatShortcut("Mod-Enter", true), "⌘↩");

// ───────────── 2부: 브라우저 ─────────────
const OUT = path.join(ROOT, "out/editor");
fs.mkdirSync(OUT, { recursive: true });
const t = await openBrowser({ port: 8801, viewport: { width: 1180, height: 780 } });

async function open(query = "") {
  const page = await t.page("/tests/pages/editor-demo.html" + query);
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  return page;
}
const text = (page) => page.evaluate(() => window.__ed.getText());
const stats = (page) => page.evaluate(() => ({ ...window.__stats, last: undefined }));
/** 원고를 바꾸고(마커 표기는 위 parse와 같음) 편집기에 초점 */
async function load(page, marked) {
  const { doc, from, to } = parse(marked);
  await page.evaluate(({ doc, from, to }) => {
    const ed = window.__ed;
    ed.setText(doc);
    ed.view.dispatch({ selection: { anchor: from, head: to } });
    ed.view.focus();
  }, { doc, from, to });
}
const btn = (page, cmd) => page.locator(`.pl-toolbar [data-cmd="${cmd}"]`);

try {
  // ── 화면 구성, 문법 색칠, 도구 막대
  let page = await open();
  check("편집기가 뜸", (await page.locator(".cm-editor").count()) === 1);
  check("도구 막대 단추", (await page.locator(".pl-toolbar button.pl-btn").count()) >= 14, await page.locator(".pl-toolbar button.pl-btn").count());
  const labels = await page.locator(".pl-toolbar .pl-name").allTextContents();
  check("도구 막대 단추 글자가 한국어", ["굵게", "빈칸", "글 속 수식", "별도 수식", "절 제목", "소제목", "상자", "옆 단", "그림", "그래프", "표", "쪽 나눔", "문제 추가", "해설", "풀이 공간"].every((l) => labels.includes(l)), labels);
  const titles = await page.locator(".pl-toolbar button.pl-btn").evaluateAll((els) => els.map((e) => [e.title, e.getAttribute("aria-label")]));
  check("모든 단추에 title·aria-label", titles.every(([a, b]) => a && b), titles);
  check("단축키가 단추 설명에 표시(굵게)", (await btn(page, "bold").getAttribute("title")).includes("Ctrl+B"), await btn(page, "bold").getAttribute("title"));
  check("단축키가 단추 설명에 표시(빈칸)", (await btn(page, "blank").getAttribute("title")).includes("Ctrl+U"));
  check("toolbar role", (await page.locator('[role="toolbar"]').count()) === 1);
  const lineOf = (re) => page.evaluate((src) => window.__ed.getText().split("\n").findIndex((l) => new RegExp(src).test(l)) + 1, re);
  for (const [cls, re] of [["pl-blank", "^직선 위"], ["pl-math", "^직선 위"], ["pl-dir-name", "^:::side"], ["pl-h2", "^## 위치"], ["pl-mathblock", "^\\$\\$"],
    ["pl-kind-warn", "^:::warn"], ["pl-fm", "^---"], ["pl-attr", "^::fig"], ["pl-table", "^\\| 나누는"], ["pl-strong", "^\\*\\*변위"]]) {
    await page.evaluate((n) => window.__ed.goToLine(n), await lineOf(re));
    await page.waitForTimeout(120);
    check(`색칠: .${cls}`, (await page.locator(`.cm-line .${cls}, .cm-line.${cls}`).count()) > 0, cls);
  }
  // 아직 보이지 않는 줄(문제 구간)까지 확인하려면 스크롤
  check("색칠: 상자 안 줄", (await page.locator(".pl-in").count()) > 0);
  await page.evaluate((n) => window.__ed.goToLine(n), await lineOf("^```plot"));
  await page.waitForTimeout(200);
  check("색칠: 그래프 블록", (await page.locator(".pl-plotblock").count()) > 0 && (await page.locator(".pl-plot-key").count()) > 0);
  await page.evaluate((n) => window.__ed.goToLine(n), await lineOf("^::problems"));
  await page.waitForTimeout(200);
  check("색칠: 문제 구간 ::problems", (await page.locator(".pl-leaf-problems").count()) > 0);
  await page.evaluate(() => window.__ed.goToLine(1));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "highlight.png") });

  // ── 입력과 onChange, 커서 줄
  await load(page, "|");
  const c0 = (await stats(page)).changes;
  await page.keyboard.type("힘은 F = ma 이다.");
  eq("영문·한글 섞어 입력", await text(page), "힘은 F = ma 이다.");
  check("onChange가 입력마다 불림", (await stats(page)).changes - c0 >= 5, (await stats(page)).changes - c0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("둘째 문단");
  eq("onCursorLine: 마지막 줄 번호", (await stats(page)).cursor, 3);
  await page.evaluate(() => window.__ed.view.dispatch({ selection: { anchor: 0 } }));
  eq("onCursorLine: 줄이 바뀌면 불림", (await stats(page)).cursor, 1);
  const before = await stats(page);
  await page.evaluate(() => window.__ed.setText("가\n나\n다\n라"));
  eq("setText는 onChange를 부르지 않음", (await stats(page)).changes, before.changes);
  eq("setText/getText", await text(page), "가\n나\n다\n라");
  await page.evaluate(() => window.__ed.goToLine(3));
  eq("goToLine: 해당 줄에 커서", await page.evaluate(() => window.__ed.view.state.doc.lineAt(window.__ed.view.state.selection.main.head).number), 3);
  eq("goToLine은 onCursorLine을 부르지 않음(되돌아 울림 방지)", (await stats(page)).cursor, before.cursor);
  await page.evaluate(() => window.__ed.goToLine(99));
  eq("goToLine: 범위 밖은 마지막 줄", await page.evaluate(() => window.__ed.view.state.doc.lineAt(window.__ed.view.state.selection.main.head).number), 4);

  // ── 한글 입력: 입력기 조합(IME)
  await load(page, "|");
  const cdp = await t.context.newCDPSession(page);
  let imeOk = true;
  try {
    for (const s of ["ㅎ", "하", "한"]) await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length });
    check("한글 조합 중에도 화면에 글자가 보임", (await text(page)) === "한", await text(page));
    check("조합 중에는 view.composing", await page.evaluate(() => window.__ed.view.composing));
    await cdp.send("Input.insertText", { text: "한" });
    for (const s of ["ㄱ", "그", "글"]) await cdp.send("Input.imeSetComposition", { text: s, selectionStart: s.length, selectionEnd: s.length });
    await cdp.send("Input.insertText", { text: "글" });
    eq("한글 조합 입력 결과", await text(page), "한글");
  } catch (e) { imeOk = false; console.log("  (입력기 조합 시험 건너뜀: " + e.message + ")"); }
  // 조합 중 단축키가 원고를 망가뜨리지 않음
  await load(page, "|");
  if (imeOk) {
    await cdp.send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
    await page.evaluate(() => window.__ed.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "b", code: "KeyB", keyCode: 66, ctrlKey: true, bubbles: true, cancelable: true })));
    await cdp.send("Input.insertText", { text: "하" });
    eq("조합 중 굵게 단축키는 무시되어 글자가 그대로", await text(page), "하");
  }
  await page.keyboard.insertText("나다");
  check("insertText로 한글 이어 입력", (await text(page)).endsWith("나다"), await text(page));
  // 한글 자판 상태의 단축키(key 가 'ㅠ' 로 오는 경우)
  await load(page, "가 ⟦나다⟧ 라");
  await page.evaluate(() => window.__ed.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ㅠ", code: "KeyB", keyCode: 66, ctrlKey: true, bubbles: true, cancelable: true })));
  eq("한글 자판 상태에서도 굵게 단축키", await text(page), "가 **나다** 라");
  await page.keyboard.insertText("한글");
  await load(page, "그래서 ⟦알짜힘⟧이다");
  await page.keyboard.press("Control+u");
  eq("한글 선택에 빈칸 단축키", await text(page), "그래서 :blank[알짜힘]이다");
  await page.keyboard.press("Control+u");
  eq("빈칸 단축키를 한 번 더 누르면 풀림", await text(page), "그래서 알짜힘이다");

  // ── 단축키
  await load(page, "이것은 ⟦중요⟧합니다");
  await page.keyboard.press("Control+b");
  eq("Ctrl+B 굵게", await text(page), "이것은 **중요**합니다");
  await page.keyboard.press("Control+b");
  eq("Ctrl+B 다시 누르면 풀림", await text(page), "이것은 중요합니다");
  await load(page, "속도 ⟦v⟧ 는");
  await page.keyboard.press("Control+Shift+M");
  eq("Ctrl+Shift+M 글 속 수식", await text(page), "속도 $v$ 는");
  await load(page, "|");
  await page.keyboard.press("Control+Shift+D");
  eq("Ctrl+Shift+D 별도 수식", await text(page), "$$\n\n$$");
  await load(page, "|제목");
  await page.keyboard.press("Control+Alt+2");
  eq("Ctrl+Alt+2 절 제목", await text(page), "## 제목");
  await page.keyboard.press("Control+Alt+3");
  eq("Ctrl+Alt+3 소제목", await text(page), "### 제목");
  await load(page, "앞 문장|");
  await page.keyboard.press("Control+Enter");
  eq("Ctrl+Enter 쪽 나눔", await text(page), "앞 문장\n\n::pagebreak\n");
  await load(page, "저장 시험|");
  const s0 = (await stats(page)).saves;
  await page.evaluate(() => { window.__saveDefaultPrevented = null; document.addEventListener("keydown", (e) => { if (e.key === "s") window.__saveDefaultPrevented = e.defaultPrevented; }); });
  await page.keyboard.press("Control+s");
  eq("Ctrl+S 가 onSave를 부름", (await stats(page)).saves, s0 + 1);
  eq("Ctrl+S 는 브라우저 저장 창을 막음(preventDefault)", await page.evaluate(() => window.__saveDefaultPrevented), true);
  eq("Ctrl+S 는 원고를 바꾸지 않음", await text(page), "저장 시험");
  // Meta(맥 Cmd) 조합도 같은 이름으로 들어오는지: Mod 는 플랫폼별로 CodeMirror 가 정함 → 맥 표기만 확인(위 formatShortcut)

  // ── 도구 막대 단추
  const click = async (sel) => { await page.locator(sel).click(); };
  await load(page, "이것은 ⟦중요⟧합니다");
  await click('[data-cmd="bold"]');
  eq("굵게 단추(선택이 유지된 채)", await text(page), "이것은 **중요**합니다");
  await page.keyboard.insertText("X");
  eq("단추를 눌러도 편집기 초점 유지", await text(page), "이것은 **X**합니다");
  await load(page, "이것을 ⟦알짜힘⟧이라 한다");
  await click('[data-cmd="blank"]');
  eq("빈칸 단추: 감싸기", await text(page), "이것을 :blank[알짜힘]이라 한다");
  check("빈칸이 눈에 띄게 칠해짐", (await page.locator(".pl-blank").count()) >= 1);
  await click('[data-cmd="blank"]');
  eq("빈칸 단추: 풀기", await text(page), "이것을 알짜힘이라 한다");
  await load(page, "|");
  await click('[data-cmd="inlineMath"]');
  eq("글 속 수식 단추", await text(page), "$$");
  await load(page, "|");
  await click('[data-cmd="displayMath"]');
  eq("별도 수식 단추", await text(page), "$$\n\n$$");
  await load(page, "|절 이름");
  await click('[data-cmd="heading2"]');
  eq("절 제목 단추", await text(page), "## 절 이름");
  await load(page, "|소절");
  await click('[data-cmd="heading3"]');
  eq("소제목 단추", await text(page), "### 소절");
  // 상자 메뉴
  await load(page, "|");
  await click('[data-menu="callout"]');
  check("상자 메뉴가 열림", await page.locator(".pl-menu-item[data-arg='warn']").isVisible());
  check("상자 메뉴 항목이 한국어 4종", (await page.locator(".pl-menu-item[data-cmd='callout'] .pl-menu-name").allTextContents()).join() === "참고,팁,주의,생각해 보기");
  await page.screenshot({ path: path.join(OUT, "toolbar-callout-menu.png"), clip: { x: 0, y: 0, width: 1180, height: 260 } });
  await click(".pl-menu-item[data-arg='warn']");
  eq("상자 메뉴: 주의", await text(page), ":::warn\n내용\n:::");
  check("메뉴가 닫힘", !(await page.locator(".pl-menu-item[data-arg='warn']").isVisible()));
  await page.keyboard.insertText("조심");
  eq("상자 넣은 뒤 '내용'이 선택되어 바로 덮어씀", await text(page), ":::warn\n조심\n:::");
  await load(page, "|");
  await click('[data-menu="callout"]');
  await page.keyboard.press("Escape");
  check("Esc로 메뉴 닫기", !(await page.locator(".pl-menu-item[data-arg='warn']").isVisible()));
  await click('[data-menu="callout"]');
  await page.mouse.click(600, 500);
  check("바깥 클릭으로 메뉴 닫기", !(await page.locator(".pl-menu-item[data-arg='warn']").isVisible()));
  await load(page, "|");
  await click('[data-cmd="side"]');
  eq("옆 단 단추", await text(page), ":::side[용어]\n풀이\n:::");
  await load(page, "|");
  await click('[data-cmd="plot"]');
  check("그래프 단추", (await text(page)).startsWith("```plot\nx: 0 .. 5\ny: 0 .. 10\nf: y = 2x + 1"), await text(page));
  await load(page, "|");
  await click('[data-cmd="space"]');
  eq("풀이 공간 단추", await text(page), "::space{h=30}");
  await load(page, "|");
  await click('[data-cmd="pagebreak"]');
  eq("쪽 나눔 단추", await text(page), "::pagebreak\n");
  // 표 격자
  await load(page, "|");
  await click('[data-menu="table"]');
  await page.locator('[data-table="3x4"]').hover();
  check("표 격자 안내 글자", (await page.locator(".pl-grid-label").textContent()).includes("3줄 × 4칸"), await page.locator(".pl-grid-label").textContent());
  await page.screenshot({ path: path.join(OUT, "toolbar-table-menu.png"), clip: { x: 0, y: 0, width: 1180, height: 300 } });
  await page.locator('[data-table="3x4"]').click();
  eq("표 단추: 3줄 × 4칸", await text(page), "| 제목 1 | 제목 2 | 제목 3 | 제목 4 |\n|---|---|---|---|\n|   |   |   |   |\n|   |   |   |   |");
  // 표 안에서 Tab (CodeMirror는 Esc를 누른 직후 2초 동안 Tab으로 초점을 옮기게 하므로 기다림)
  await page.waitForTimeout(2200);
  check("표를 넣으면 첫 제목 칸이 선택됨", await page.evaluate(() => { const v = window.__ed.view, r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to) === "제목 1"; }));
  await page.keyboard.press("Tab");
  check("Tab: 다음 칸으로", await page.evaluate(() => { const v = window.__ed.view, r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to) === "제목 2"; }));
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab: 앞 칸으로", await page.evaluate(() => { const v = window.__ed.view, r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to) === "제목 1"; }));
  await page.evaluate(() => { const v = window.__ed.view; v.dispatch({ selection: { anchor: v.state.doc.length - 2 } }); });
  await page.keyboard.press("Tab");
  eq("Tab: 마지막 칸에서 새 줄이 생김", (await text(page)).split("\n").length, 5);
  // 그림 메뉴
  await load(page, "|");
  await click('[data-menu="figure"]');
  check("그림 메뉴(onImage 있음): 파일 고르기 항목", await page.locator('.pl-menu-item[data-cmd="figure-pick"]').isVisible());
  await click('.pl-menu-item[data-cmd="figure"]');
  eq("그림 틀 넣기", await text(page), "::fig[설명]{src=images/파일이름.png w=80}");
  // 문제
  await load(page, "## 절\n\n본문|");
  await click('[data-cmd="problem"]');
  eq("문제 추가 단추: ::problems를 장 끝에 먼저 넣음", await text(page), "## 절\n\n본문\n\n::problems\n\n::::problem\n문제 내용\n\n:::solution\n풀이\n:::\n::::");
  await page.keyboard.insertText("물체의 가속도를 구하시오.");
  await click('[data-cmd="problem"]');
  const t2 = await text(page);
  eq("문제 추가 2회: ::problems는 하나, 문항은 둘", (t2.match(/^::problems$/gm) || []).length + "/" + (t2.match(/^::::problem$/gm) || []).length, "1/2");
  await click('[data-cmd="solution"]');
  check("해설 단추: 이미 있는 해설로 이동(중복 없음)", ((await text(page)).match(/^:::solution$/gm) || []).length === 2);

  // ── 자동 완성
  await load(page, "|");
  await page.keyboard.type("속도는 $v = \\fr");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  const opts = await page.locator(".cm-tooltip-autocomplete .cm-completionLabel").allTextContents();
  check("수식 안 \\ 입력: 제안이 뜸(\\frac 포함)", opts.includes("\\frac"), opts);
  check("제안 설명이 한국어", (await page.locator(".cm-tooltip-autocomplete .cm-completionDetail").first().textContent()).length > 0);
  await page.screenshot({ path: path.join(OUT, "autocomplete.png"), clip: { x: 0, y: 0, width: 800, height: 260 } });
  await page.keyboard.press("Enter");
  eq("\\frac 를 고르면 분수 틀", await text(page), "속도는 $v = \\frac{}{}");
  await page.keyboard.type("\\Delta x");
  await page.keyboard.press("Tab");
  eq("Tab으로 다음 칸 이동", await page.evaluate(() => { const v = window.__ed.view, p = v.state.selection.main.head; return v.state.doc.sliceString(p - 1, p + 1); }), "{}");
  await page.keyboard.type("\\Delta t");
  eq("분수 칸에 입력", await text(page), "속도는 $v = \\frac{\\Delta x}{\\Delta t}");
  await load(page, "|");
  await page.keyboard.type("\\fr");
  await page.waitForTimeout(400);
  check("수식 밖에서는 제안이 뜨지 않음", (await page.locator(".cm-tooltip-autocomplete").count()) === 0);
  await load(page, "|");
  await page.keyboard.type("$$\n");
  await page.keyboard.type("\\sq");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  check("별도 수식($$) 안에서도 제안", (await page.locator(".cm-completionLabel").allTextContents()).includes("\\sqrt"));
  await page.keyboard.press("Escape");
  await load(page, "|");
  await page.keyboard.type("$a$ 끝나고 \\al");
  await page.waitForTimeout(400);
  check("수식이 닫힌 뒤 본문에서는 제안이 뜨지 않음", (await page.locator(".cm-tooltip-autocomplete").count()) === 0);
  // 제안을 고른 뒤 입력이 이어지는지(Esc로 닫기)
  await load(page, "|");
  await page.keyboard.type("$\\al");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
  check("Esc로 제안 닫기", (await page.locator(".cm-tooltip-autocomplete").count()) === 0);

  // ── 찾기
  await load(page, "가나다");
  await page.keyboard.press("Control+f");
  check("Ctrl+F 찾기 창", (await page.locator(".cm-search").count()) === 1);
  check("찾기 창이 한국어", (await page.locator(".cm-search").innerText()).includes("바꾸기") || (await page.locator(".cm-search button[name=next]").getAttribute("value")) === "다음" || (await page.locator(".cm-search").innerHTML()).includes("다음"));
  await page.keyboard.press("Escape");

  // ── 경고
  await page.evaluate(() => window.__ed.setText(""));
  await page.close();
  page = await open();
  const warnLines = await page.evaluate(() => window.__warnLines);
  const distinct = new Set(warnLines).size;
  check("시연 경고가 만들어짐", distinct >= 3, warnLines);
  // 화면에 그려진 줄만 DOM에 있으므로 보이는 범위 안의 경고만 센다
  const visibleWarn = await page.evaluate(() => { const v = window.__ed.view, last = v.state.doc.lineAt(v.viewport.to).number; return new Set(window.__warnLines.filter((n) => n <= last)).size; });
  check("보이는 범위에 경고가 둘 이상", visibleWarn >= 2, visibleWarn);
  eq("경고 줄 표시 수", await page.locator(".pl-warn-line").count(), visibleWarn);
  eq("줄 옆 표시 수", await page.locator(".pl-warn-marker").count(), visibleWarn);
  await page.evaluate((n) => window.__ed.goToLine(n), warnLines[1]);
  await page.waitForTimeout(200);
  await page.locator(".pl-warn-marker").first().hover();
  const tip = await page.locator(".pl-warn-tip").textContent();
  check("줄 옆 표시에 마우스를 올리면 한국어 설명", tip.includes("그림 파일") && tip.includes("찾을 수 없습니다"), tip);
  await page.screenshot({ path: path.join(OUT, "warnings.png"), clip: { x: 0, y: 90, width: 900, height: 420 } });
  await page.mouse.move(700, 8);
  check("마우스를 치우면 설명 사라짐", (await page.locator(".pl-warn-tip").count()) === 0);
  await page.evaluate((n) => window.__ed.goToLine(n), warnLines[2]);
  await page.waitForTimeout(150);
  const bad = page.locator(".pl-warn-line[data-warn*=\"Undefined control\"]");
  await bad.scrollIntoViewIfNeeded();
  await bad.hover({ position: { x: 120, y: 8 } });
  const tip2 = await page.locator(".pl-warn-tip").textContent();
  check("줄 글에 마우스를 올려도 설명(같은 줄 경고 두 개는 줄바꿈으로 함께)", tip2.includes("Undefined control") && tip2.includes("두 번째 경고"), tip2);
  await page.mouse.move(700, 8);
  // 입력으로 줄이 밀려도 경고가 따라감
  const lineOfFirst = await page.evaluate(() => { const v = window.__ed.view; const el = document.querySelector(".pl-warn-line"); return v.state.doc.lineAt(v.posAtDOM(el)).number; });
  eq("경고 줄 번호가 맞음", lineOfFirst, warnLines[0]);
  await page.evaluate(() => { const v = window.__ed.view; v.dispatch({ changes: { from: 0, insert: "새 줄\n\n" } }); });
  const shifted = await page.evaluate(() => { const v = window.__ed.view; const el = document.querySelector(".pl-warn-line"); return v.state.doc.lineAt(v.posAtDOM(el)).number; });
  eq("앞에 줄을 넣으면 경고도 같이 밀림", shifted, warnLines[0] + 2);
  await page.evaluate(() => window.__ed.setText("가\n나\n다"));
  eq("setText는 경고 표시를 비움", await page.locator(".pl-warn-line").count(), 0);
  await page.evaluate(() => window.__ed.setWarnings([{ code: "bad-math", message: "새 경고", line: 1 }, { code: "x", message: "범위 밖", line: 9999 }]));
  eq("setWarnings로 교체(범위 밖 줄은 마지막 줄로)", await page.locator(".pl-warn-marker").count(), 2);
  await page.evaluate(() => window.__ed.setWarnings([{ code: "missing-image", message: "", line: 3 }]));
  await page.locator(".pl-warn-marker").hover();
  eq("메시지가 비면 코드별 기본 한국어 설명", await page.locator(".pl-warn-tip").textContent(), "그림 파일을 찾을 수 없습니다.");
  await page.evaluate(() => window.__ed.setWarnings([]));
  eq("setWarnings([])로 지움", await page.locator(".pl-warn-line").count(), 0);

  // ── 그림 붙여넣기·끌어다 놓기
  const makeFile = (name) => `new File([new Uint8Array([137,80,78,71,13,10,26,10])], ${JSON.stringify(name)}, { type: "image/png" })`;
  await page.evaluate(() => window.__ed.setText("첫째 줄\n둘째 줄\n셋째 줄"));
  await load(page, "첫째 줄|\n둘째 줄\n셋째 줄");
  await page.evaluate(() => { window.__imageDelay = 700; });
  const pasted = await page.evaluate((f) => {
    const dt = new DataTransfer();
    dt.items.add(eval(f));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    window.__ed.view.contentDOM.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, makeFile("스크린샷 1.png"));
  check("그림 붙여넣기를 가로챔", pasted === true);
  await page.waitForTimeout(150);
  eq("올리는 동안 원고는 그대로", await text(page), "첫째 줄\n둘째 줄\n셋째 줄");
  check("올리는 중 안내가 보임", (await page.locator(".pl-editor-status").textContent()).includes("그림 올리는 중"));
  await page.screenshot({ path: path.join(OUT, "image-uploading.png"), clip: { x: 0, y: 0, width: 1000, height: 780 } });
  // 기다리는 동안 다른 곳을 고침 → 자리가 따라가야 함
  await page.evaluate(() => window.__ed.view.dispatch({ changes: { from: 0, insert: "맨 위 추가\n" } }));
  await page.waitForFunction(() => window.__stats.images.length === 1, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__ed.getText().includes("::fig["), null, { timeout: 5000 });
  eq("올림이 끝나면 처음 놓은 줄 아래에 ::fig 삽입(그 사이 고친 내용 유지)", await text(page), "맨 위 추가\n첫째 줄\n\n::fig[설명]{src=images/upload-1-스크린샷_1.png w=80}\n\n둘째 줄\n셋째 줄");
  check("안내가 사라짐", await page.locator(".pl-editor-status").isHidden());
  await page.evaluate(() => { window.__imageDelay = 50; });
  // 끌어다 놓기: 셋째 줄 위에
  await page.evaluate(() => window.__ed.setText("가\n\n나\n\n다"));
  const dropped = await page.evaluate((f) => {
    const v = window.__ed.view;
    const r = v.coordsAtPos(v.state.doc.line(5).from);
    const dt = new DataTransfer();
    dt.items.add(eval(f));
    const ev = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 2, clientY: r.top + 3 });
    v.contentDOM.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, makeFile("a.png"));
  check("그림 끌어다 놓기를 가로챔", dropped === true);
  await page.waitForFunction(() => window.__ed.getText().includes("::fig["), null, { timeout: 5000 });
  eq("끌어다 놓은 줄 아래에 삽입", await text(page), "가\n\n나\n\n다\n\n::fig[설명]{src=images/upload-2-a.png w=80}");
  // 여러 파일은 고른 순서대로
  await page.evaluate(() => window.__ed.setText("끝"));
  await page.evaluate((f) => {
    const dt = new DataTransfer();
    dt.items.add(eval(f[0])); dt.items.add(eval(f[1]));
    window.__ed.view.dispatch({ selection: { anchor: 1 } });
    window.__ed.view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [makeFile("one.png"), makeFile("two.png")]);
  await page.waitForFunction(() => (window.__ed.getText().match(/::fig\[/g) || []).length === 2, null, { timeout: 5000 });
  const two = await text(page);
  check("그림 두 장은 붙여넣은 순서대로", two.indexOf("one.png") > 0 && two.indexOf("one.png") < two.indexOf("two.png"), two);
  // 올리기 실패: 원고를 건드리지 않고 안내
  await page.evaluate(() => { window.__imageFail = true; window.__ed.setText("원고"); });
  await page.evaluate((f) => {
    const dt = new DataTransfer(); dt.items.add(eval(f));
    window.__ed.view.dispatch({ selection: { anchor: 2 } });
    window.__ed.view.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, makeFile("bad.png"));
  await page.locator(".pl-editor-status[data-kind='error']").waitFor({ timeout: 5000 });
  eq("올리기 실패해도 원고는 그대로", await text(page), "원고");
  check("실패 안내가 한국어", (await page.locator(".pl-editor-status").textContent()).includes("올리지 못했습니다"));
  await page.evaluate(() => { window.__imageFail = false; });
  // 글자 붙여넣기는 가로채지 않음
  const textPaste = await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData("text/plain", "그냥 글");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    window.__ed.view.contentDOM.dispatchEvent(ev);
    return window.__ed.getText();
  });
  check("글자 붙여넣기는 평소대로", textPaste.includes("그냥 글"), textPaste);
  // onImage 없으면 그림 메뉴가 틀 넣기만
  await page.close();
  page = await open("?noimage=1");
  await click_(page, '[data-menu="figure"]');
  check("onImage 없으면 파일 고르기 항목 없음", (await page.locator('.pl-menu-item[data-cmd="figure-pick"]').count()) === 0);

  // ── 해제
  await page.evaluate(() => { window.__ed.destroy(); });
  eq("destroy 후 편집기 DOM 제거", await page.locator(".cm-editor").count(), 0);

  check("페이지 오류 없음", t.errors.length === 0, t.errors);
} catch (e) {
  failures.push("시험 중 예외: " + (e?.stack ?? e));
  console.log(e);
} finally {
  await t.close();
}

async function click_(page, sel) { await page.locator(sel).click(); }

console.log(failures.length ? `실패 ${failures.length}건 (통과 ${passed})` : `통과 (${passed}개 확인)`);
if (failures.length) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
