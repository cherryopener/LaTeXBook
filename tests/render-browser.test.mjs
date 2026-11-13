// 원고 변환이 브라우저에서도 도는지 확인(포트 8802)
import { openBrowser } from "./lib/browser.mjs";
const t = await openBrowser({ port: 8802 });
const page = await t.page("/tests/pages/render-smoke.html");
await page.waitForFunction(() => window.__done, null, { timeout: 60000 });
const r = await page.evaluate(() => window.__done);
await t.close();
const ok = r.chapters === 3 && r.answers === 6 && r.slots === 7 && r.oneSlots === 7 && r.svgs === 5 &&
  r.warnings.join() === "missing-image,unknown-ref" && r.exported && t.errors.length === 0;
console.log(ok ? "통과" : "실패", JSON.stringify(r), "오류:", t.errors);
process.exit(ok ? 0 : 1);
