// 앱 화면 시험(견본 책 모드): 열기 → 미리보기 → 입력하면 갱신 → 판 바꾸기 → 장 바꾸기·경고 → PDF 문서 만들기
import fs from "node:fs";
import path from "node:path";
import { openBrowser, ROOT } from "./lib/browser.mjs";

const OUT = path.join(ROOT, "out/app");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };

const t = await openBrowser({ port: 8808, viewport: { width: 1500, height: 950 } });
const page = await t.page("/index.html?sample=1");
const waitRender = async (after = 0) => page.waitForFunction((a) => window.__app?.lastRender?.at > a, after, { timeout: 60000 });

await page.waitForFunction(() => window.__app?.ready, null, { timeout: 60000 });
await waitRender();
let r = await page.evaluate(() => window.__app.lastRender);
check(r.pages >= 3, `처음 미리보기 ${r.pages}쪽, ${r.ms}ms`);
check(await page.locator("#book-title").textContent() === "견본 물리", "책 제목 표시");
check(await page.locator("#sel-chapter option").count() === 3, "장 목록 3개");
check((await page.locator("#save-state").textContent()).includes("견본"), "견본 책은 저장 안 됨 표시");
await page.screenshot({ path: path.join(OUT, "app-teacher.png") });

// 입력하면 미리보기가 다시 그려짐
const before = r.at;
await page.locator(".cm-content").click();
await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
await page.keyboard.insertText("\n\n추가한 문장 시험입니다.\n");
await waitRender(before);
const has = await page.evaluate(() => [...document.querySelectorAll("#preview [data-vivliostyle-page-container]")].some((p) => p.textContent.includes("추가한 문장 시험입니다")));
check(has, "입력한 문장이 미리보기에 나옴");

// 학생용
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-edition", "student");
await waitRender(r.at);
const blanks = await page.evaluate(() => document.querySelectorAll("#preview .blank.empty").length);
check(blanks >= 3, `학생용 빈칸 ${blanks}개`);
await page.screenshot({ path: path.join(OUT, "app-student.png") });

// 장 바꾸기 → 경고(그림 없음, 참조 없음)
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-chapter", "2:1");
await waitRender(r.at);
const warn = await page.locator("#btn-warn").textContent();
check(/경고 [1-9]/.test(warn), `정전기 장 경고 표시: ${warn}`);
const codes = await page.evaluate(() => window.__app.state.warnings.map((w) => w.code));
check(codes.includes("missing-image") && codes.includes("unknown-ref"), `경고 종류 ${codes.join(",")}`);

// 책 전체 미리보기
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-scope", "book");
await waitRender(r.at);
const rb = await page.evaluate(() => window.__app.lastRender);
check(rb.pages >= 10, `책 전체 미리보기 ${rb.pages}쪽, ${rb.ms}ms`);
// 모든 쪽이 화면에 이어져 보이고 스크롤로 끝까지 갈 수 있어야 함(처음에는 한 쪽만 보이던 문제)
const sc = await page.evaluate(() => {
  const vp = document.querySelector(".layout-preview-vp");
  const shown = [...document.querySelectorAll("#preview [data-vivliostyle-page-container]")].filter((p) => getComputedStyle(p).display !== "none").length;
  vp.scrollTop = vp.scrollHeight;
  return { shown, scrollable: vp.scrollHeight > vp.clientHeight * 5 };
});
await page.waitForTimeout(300);
const lastNo = await page.evaluate(() => window.__app.preview.currentPage());
check(sc.shown === rb.pages && sc.scrollable && lastNo >= rb.pages - 1, `책 전체: ${sc.shown}쪽 모두 보이고 끝까지 스크롤(마지막 화면 ${lastNo}쪽)`);
check(/\d+ \/ \d+쪽/.test(await page.locator("#pages").textContent()), "아래 막대에 지금 쪽 번호");
// 커서를 장의 문제 구간으로 옮기면 그 쪽으로 따라감
// goToLine은 미리보기를 움직이지 않으므로(되돌아 울림 방지) 한 줄 위로 옮긴 뒤 ↓ 키로 사용자 커서 이동을 만든다. 먼저 미리보기를 맨 위로
await page.evaluate(() => { document.querySelector(".layout-preview-vp").scrollTop = 0; const ed = window.__app.editor; const n = ed.getText().split("\n").findIndex((l) => l.startsWith("::problems")) + 1; ed.goToLine(n + 2); });
await page.locator(".cm-content").focus();
await page.keyboard.press("ArrowDown"); // 줄이 바뀌어야 따라감
await page.waitForTimeout(800);
const cur = await page.evaluate(() => window.__app.preview.currentPage());
const probPage = await page.evaluate(() => { const ps = [...document.querySelectorAll("#preview [data-vivliostyle-page-container]")]; return ps.findIndex((p) => p.querySelector('[data-part="2"][data-chapter="1"] article.problem')) + 1; });
check(cur === probPage, `커서 따라가기: 정전기 장 문제 쪽(${probPage})으로 이동 → ${cur}`);

// 미리보기 배율: 다시 조판하지 않고 미리보기만 확대·축소, 폭 맞춤으로 돌아오기
{
  const z = () => page.evaluate(() => ({
    zoom: window.__app.preview.zoom, at: window.__app.lastRender.at, label: document.querySelector("#zoom-val").textContent,
    w: document.querySelector("#preview [data-vivliostyle-page-container]").getBoundingClientRect().width,
    fit: document.querySelector("#zoom-fit").classList.contains("ui-on"), shell: getComputedStyle(document.querySelector("#top")).fontSize,
  }));
  const z0 = await z();
  check(z0.fit && z0.label === `${Math.round(z0.zoom * 100)}%`, `처음은 폭 맞춤(${z0.label})`);
  await page.click("#zoom-in"); await page.click("#zoom-in");
  await page.waitForTimeout(500);
  const z1 = await z();
  check(z1.zoom > z0.zoom && !z1.fit && Math.abs(z1.w / z0.w - z1.zoom / z0.zoom) < 0.02, `확대 단추 → ${z1.label}, 쪽 폭 ${Math.round(z0.w)}→${Math.round(z1.w)}px`);
  check(z1.at === z0.at && z1.shell === z0.shell, "다시 조판하지 않고 편집기 화면 글자는 그대로");
  await page.mouse.move(1100, 500);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
  await page.waitForTimeout(500);
  const z2 = await z();
  check(z2.zoom > z1.zoom && z2.shell === z0.shell, `Ctrl+휠 → 미리보기만 ${z2.label}`);
  const sc2 = await page.evaluate(() => { const v = document.querySelector(".layout-preview-vp"); v.scrollTop = v.scrollHeight; return v.scrollHeight > v.clientHeight; });
  await page.waitForTimeout(200);
  check(sc2 && await page.evaluate(() => window.__app.preview.currentPage()) >= rb.pages - 1, "확대해도 끝 쪽까지 스크롤");
  await page.click("#zoom-fit");
  await page.waitForTimeout(500);
  const z3 = await z();
  check(z3.fit && Math.abs(z3.zoom - z0.zoom) < 0.01, `폭 맞춤으로 돌아옴(${z3.label})`);
}

// 커서 위치 → 미리보기 쪽 맞춤(오류 없이 동작하는지)
await page.evaluate(() => window.__app.editor.goToLine(20));

// 글자 크기 칸(본문·옆 단·문제): 바꾸면 미리보기의 해당 글자만 바뀜
const sizes = () => page.evaluate(() => {
  const pt = (sel) => { const el = document.querySelector(`#preview ${sel}`); return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 10) / 10 : null; };
  return { body: pt(".theory-body > p"), side: pt(".side"), problem: pt(".problem-body"), solution: pt(".source"), answers: pt(".answer-list") };
});
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-edition", "teacher"); // 해설은 교사용에만
await waitRender(r.at);
const s0 = await sizes();
check(s0.body === 10.4 && s0.side === 7.6 && s0.problem === 9.6 && s0.solution === 9.2 && s0.answers === 8.4, `글자 크기 기본값 ${JSON.stringify(s0)}`);
for (const [kind, v] of [["body", "11.5"], ["side", "8.2"], ["problem", "10.4"]]) {
  r = await page.evaluate(() => window.__app.lastRender);
  await page.fill(`#fs-${kind}`, v);
  await waitRender(r.at);
}
const s1 = await sizes();
check(s1.body === 11.5 && s1.side === 8.2 && s1.problem === 10.4 && Math.abs(s1.solution - 10.4 * 9.2 / 9.6) < 0.15 && Math.abs(s1.answers - 10.4 * 8.4 / 9.6) < 0.15, `글자 크기 바꿈 → 미리보기 ${JSON.stringify(s1)}`);
check((await page.locator("#save-state").textContent()).includes("견본"), "견본 책은 글자 크기를 바꿔도 저장 안 됨 표시");
r = await page.evaluate(() => window.__app.lastRender);
await page.fill("#fs-body", "99");
await page.locator("#fs-body").blur();
await waitRender(r.at);
check(await page.inputValue("#fs-body") === "14" && (await sizes()).body === 14, "범위 밖(99) → 최대 14로 맞춤");

// PDF: 안내 끄고 문서 만들기
await page.evaluate(() => { localStorage.setItem("latexbook.pdf-tip-off", "1"); });
await page.click("#btn-pdf");
await page.waitForFunction(() => window.__app.lastPdfDoc, null, { timeout: 60000 });
const docLen = await page.evaluate(() => window.__app.lastPdfDoc.length);
check(docLen > 10000, `PDF용 문서 만듦(${docLen}자)`);
// 숨은 iframe에서 조판 → 인쇄 호출 → iframe 정리 (보안 정책 아래에서도)
const printed = await page.evaluate(async () => {
  for (let i = 0; i < 100 && !document.querySelector("body > iframe"); i++) await new Promise((ok) => setTimeout(ok, 100));
  const fr = document.querySelector("body > iframe");
  if (!fr) return "iframe 없음";
  for (let i = 0; i < 100 && fr.contentDocument?.readyState !== "complete"; i++) await new Promise((ok) => setTimeout(ok, 100));
  let called = false;
  fr.contentWindow.print = () => { called = true; };
  for (let i = 0; i < 600 && document.contains(fr); i++) await new Promise((ok) => setTimeout(ok, 100));
  return called && !document.contains(fr) ? "ok" : `called=${called} removed=${!document.contains(fr)}`;
});
check(printed === "ok", `PDF 인쇄 창 호출과 정리 (${printed})`);

check(t.errors.length === 0, `브라우저 오류 없음 ${t.errors.slice(0, 3).join(" | ")}`);
await t.close();
console.log(`\n앱 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"} (그림: out/app/)`);
process.exit(fails.length ? 1 : 0);
