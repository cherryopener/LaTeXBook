// 보안 회귀 시험(보안 검토 2026-11-07): 원고·SVG·책 설정에 숨긴 스크립트가 편집기 화면에서 실행되지 않아야 한다.
import { openBrowser } from "./lib/browser.mjs";

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };

const t = await openBrowser({ port: 8813, viewport: { width: 1400, height: 900 } });
const outside = [];
t.context.on("request", (r) => { const u = r.url(); if (/evil\.example/.test(u)) outside.push(u); });
const page = await t.page("/index.html?sample=1");
await page.waitForFunction(() => window.__app?.ready && window.__app.lastRender, null, { timeout: 60000 });

const waitRender = async () => {
  const a = await page.evaluate(() => window.__app.lastRender.at);
  await page.waitForFunction((x) => window.__app.lastRender.at > x, a, { timeout: 60000 });
  await page.waitForTimeout(500);
};

// 1) 원고 속 날 HTML·그림 설명 속 HTML
await page.evaluate(() => {
  window.__app.state.source.svgText = () => `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned='svg-onload'"><script>window.__pwned='svg-script'</script><image href="x" onerror="window.__pwned='svg-image'"/><foreignObject><img src="x" onerror="window.__pwned='svg-fo'"></foreignObject><a href="javascript:window.__pwned='svg-js'"><text>t</text></a><rect width="9" height="9" style="fill:url(https://evil.example/leak)"/></svg>`;
  window.__app.editor.setText([
    "---", "title: 시험", "---", "",
    `본문 <img src=x onerror="window.__pwned='img'"> <script>window.__pwned='script'</script>`, "",
    `<details open ontoggle="window.__pwned='details'">x</details>`, "",
    `::fig[설명 <b onmouseover="window.__pwned='cap'">굵게</b>]{src=images/number-line.svg}`, "",
    "링크 [누르기](javascript:window.__pwned='link')", "",
    "수식 $\\href{javascript:alert(1)}{x}$", "",
    "![외부](https://evil.example/track.png)", "",
  ].join("\n"));
});
// setText는 onChange를 부르지 않으므로 한 글자 입력해 미리보기를 다시 그리게 한다
await page.locator(".cm-content").click();
await page.keyboard.insertText(" ");
await waitRender();
check(await page.evaluate(() => window.__pwned === undefined), `원고·SVG의 스크립트 실행 안 됨 (${await page.evaluate(() => window.__pwned)})`);
const leftovers = await page.evaluate(() => {
  const root = document.querySelector("#preview");
  const els = [...root.querySelectorAll("*")];
  return {
    on: els.filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
    scripts: root.querySelectorAll("script").length,
    fo: root.querySelectorAll("foreignObject").length,
  };
});
check(leftovers.on === 0 && leftovers.scripts === 0 && leftovers.fo === 0, `미리보기에 이벤트 속성·script·foreignObject 없음 ${JSON.stringify(leftovers)}`);
check(outside.length === 0, `외부(evil.example)로 요청 안 나감 ${outside.join(" ")}`);

// 2) 책 설정의 글꼴 이름으로 CSS 끼워 넣기
await page.evaluate(() => {
  window.__app.book.print.fonts = { body: 'X"\n} .chapter{background:url(https://evil.example/css)} .y{', bodyFile: "../../fonts/none.ttf" };
});
await page.keyboard.insertText(" ");
await waitRender();
check(outside.length === 0, `글꼴 이름 CSS 주입 막힘 ${outside.join(" ")}`);

const viol = t.errors.filter((e) => /Content Security Policy/i.test(e));
console.log(`  (보안 정책이 막은 시도 ${viol.length}건 — 막혔다는 뜻이므로 정상)`);
await t.close();
console.log(`\n보안 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"}`);
process.exit(fails.length ? 1 : 0);
