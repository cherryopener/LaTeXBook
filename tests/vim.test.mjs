// Vim 모드 시험(2026-11-08): 켜기·끄기, 노멀/입력 모드, 이동·지우기·되돌리기, :w 저장, 한글 자판 상태의 노멀 모드 글쇠
import { openBrowser } from "./lib/browser.mjs";

const fails = [];
const check = (ok, msg, detail) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}${ok ? "" : " " + JSON.stringify(detail ?? "")}`); if (!ok) fails.push(msg); };

const t = await openBrowser({ port: 8931 });
const page = await t.page("/tests/pages/editor-demo.html?nowarn=1");
await page.waitForFunction(() => window.__ready);
const text = () => page.evaluate(() => window.__ed.getText());
const reset = async (doc) => {
  await page.evaluate((d) => { window.__ed.setText(d); window.__ed.focus(); window.__ed.view.dispatch({ selection: { anchor: 0 } }); }, doc);
  await page.keyboard.press("Escape");
};

// 도구 막대 단추로 켜기
const btn = page.locator(".pl-group-vim .pl-btn");
check(await btn.count() === 1, "도구 막대에 Vim 단추");
await btn.click();
check(await page.evaluate(() => window.__ed.vim) === true && (await btn.getAttribute("aria-pressed")) === "true", "단추로 켜짐");
check(await page.evaluate(() => localStorage.getItem("pl-editor-vim")) === "1", "켜짐을 기억");

await reset("abc def ghi\n둘째 줄\n");
await page.keyboard.type("x");
check(await text() === "bc def ghi\n둘째 줄\n", "노멀 모드 x", await text());
await page.keyboard.type("dw");
check(await text() === "def ghi\n둘째 줄\n", "dw", await text());
await page.keyboard.type("u");
check(await text() === "bc def ghi\n둘째 줄\n", "u 되돌리기", await text());
await page.keyboard.type("jdd");
check(await text() === "bc def ghi\n", "j 내려가서 dd", await text());
await page.keyboard.type("ggA끝");
await page.keyboard.press("Escape");
check(await text() === "bc def ghi끝\n", "A 줄 끝에 입력(한글) 후 Esc", await text());
await page.keyboard.type("0yyp");
check(await text() === "bc def ghi끝\nbc def ghi끝\n", "yy p", await text());
await page.keyboard.type("2x");
check((await text()).startsWith("bc def ghi끝\n def ghi끝"), "숫자 반복 2x", await text());
const before = await page.evaluate(() => window.__stats.saves);
await page.keyboard.type(":w");
await page.keyboard.press("Enter");
check(await page.evaluate(() => window.__stats.saves) === before + 1, ":w 가 저장을 부름");
check(await page.locator(".cm-vim-panel").count() >= 1, "Vim 상태 줄");

// 한글 자판이 켜진 채 노멀 모드: 'ㅌ'(x 자리) → x
await reset("한글 자판 시험\n");
await page.evaluate(() => {
  const el = document.querySelector(".pl-editor .cm-content");
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "ㅌ", code: "KeyX", bubbles: true, cancelable: true }));
});
check(await text() === "글 자판 시험\n", "한글 자모 ㅌ → x", await text());
await page.evaluate(() => {
  const el = document.querySelector(".pl-editor .cm-content");
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", code: "KeyX", keyCode: 229, bubbles: true, cancelable: true }));
});
check(await text() === " 자판 시험\n", "IME Process + KeyX → x", await text());

// 끄면 보통 편집
await btn.click();
await reset("abc\n");
await page.keyboard.type("x");
check(await text() === "xabc\n" && await page.evaluate(() => window.__ed.vim) === false, "끄면 x가 그대로 입력", await text());
check(t.errors.length === 0, "콘솔 오류 없음", t.errors);
await t.close();

console.log(fails.length ? `\nVim 시험 실패 ${fails.length}건` : "\nVim 시험 통과");
process.exit(fails.length ? 1 : 0);
