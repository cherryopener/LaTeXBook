// 미리보기 화면(Vivliostyle)을 Chromium으로 열어 PDF로 저장 — 브라우저 "PDF로 저장"과 같은 경로
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { createServer } from "node:http";
import fs from "node:fs"; import path from "node:path";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
const srv = createServer((req, res) => {
  const p = path.join("out", decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(8765);
const browser = await chromium.launch();
for (const name of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("  [console]", m.text().slice(0, 200)); });
  const t0 = Date.now();
  await page.goto(`http://localhost:8765/viewer.html?src=${name}.html`);
  await page.waitForFunction(() => window.__state === "complete", null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  const pages = await page.evaluate(() => window.__pages);
  console.log(`${name}: 조판 ${(Date.now() - t0) / 1000}s, ${pages}쪽, 오류 ${JSON.stringify(await page.evaluate(() => window.__errors ?? []))}`);
  await page.pdf({ path: `out/${name}.pdf`, preferCSSPageSize: true, printBackground: true });
  await page.close();
}
await browser.close(); srv.close();
