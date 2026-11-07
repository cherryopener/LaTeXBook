import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { createServer } from "node:http"; import fs from "node:fs"; import path from "node:path";
const T = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".md": "text/markdown; charset=utf-8" };
const srv = createServer((q, r) => { const p = path.join("out", decodeURIComponent(new URL(q.url, "http://x").pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": T[path.extname(p)] ?? "application/octet-stream" }); fs.createReadStream(p).pipe(r); }).listen(8766);
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1200, height: 1600 } });
pg.on("pageerror", (e) => console.log("오류:", e.message));
await pg.goto("http://localhost:8766/live.html");
await pg.waitForFunction(() => window.__result, null, { timeout: 60000 });
console.log(JSON.stringify(await pg.evaluate(() => window.__result)));
await pg.screenshot({ path: "out/live.png" }); await b.close(); srv.close();
