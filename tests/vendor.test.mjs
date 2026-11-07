// vendor 묶음 3개와 CDN 글꼴 연결이 브라우저에서 동작하는지 확인
import { openBrowser } from "./lib/browser.mjs";
const t = await openBrowser();
const page = await t.page("/tests/pages/vendor-smoke.html");
await page.waitForFunction(() => window.__done, null, { timeout: 60000 });
const r = await page.evaluate(() => window.__done);
const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family); });
await t.close();
const ok = r.katex && r.editor && t.errors.length === 0;
console.log(ok ? "통과" : "실패", JSON.stringify(r), "오류:", t.errors);
process.exit(ok ? 0 : 1);
