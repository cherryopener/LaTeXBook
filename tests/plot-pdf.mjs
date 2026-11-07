// plot SVG를 넣은 문서를 Vivliostyle로 조판해 out/plot/plot.pdf 로 저장한다(브라우저 필요, 포트 8804).
// 실행: node tests/plot-pdf.mjs   (pdftoppm이 있으면 쪽별 PNG도 만든다)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openBrowser, ROOT } from "./lib/browser.mjs";

const outDir = path.join(ROOT, "out", "plot");
fs.mkdirSync(outDir, { recursive: true });
const t = await openBrowser({ port: 8804, viewport: { width: 1200, height: 1600 } });
let failed = false;
try {
  const page = await t.page("/tests/pages/plot-pdf.html");
  await page.waitForFunction(() => window.__state === "complete", null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(() => ({ pages: window.__pages, errors: window.__errors ?? [] }));
  const pdf = path.join(outDir, "plot.pdf");
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  console.log(`조판 ${info.pages}쪽, 조판 오류 ${JSON.stringify(info.errors)}, PDF ${pdf}`);
  if (info.errors.length) failed = true;
  const r = spawnSync("pdftoppm", ["-r", "110", "-png", pdf, path.join(outDir, "plot-pdf")]);
  if (r.status !== 0) console.log("pdftoppm 없음 또는 실패: PNG 변환 생략");
  if (t.errors.length) { console.log("브라우저 오류:", t.errors); failed = true; }
} finally {
  await t.close();
}
process.exit(failed ? 1 : 0);
