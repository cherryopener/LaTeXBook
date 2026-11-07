// 시험용 브라우저 도구.
// - 저장소 폴더를 로컬 서버로 띄운다.
// - CDN(jsdelivr) 요청을 node_modules의 같은 파일로 돌려준다(이 작업 환경은 CDN 접속이 막혀 있음).
// 사용: const t = await openBrowser(); const page = await t.page("/tests/pages/x.html"); ... await t.close();
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // 전역 설치본 사용
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".otf": "font/otf",
};
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";

function startServer(port) {
  const srv = createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": typeOf(p) });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, () => ok(srv)));
}

/** https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<file> → node_modules/<pkg>/<file> */
export function cdnToLocal(url) {
  const m = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\/(.*)$/.exec(url.split("?")[0]);
  if (!m) return null;
  const [, pkg, ver, file] = m;
  const dir = path.join(ROOT, "node_modules", pkg);
  const installed = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  if (installed !== ver) throw new Error(`CDN 버전(${pkg}@${ver})과 설치본(${installed})이 다릅니다`);
  return path.join(dir, file);
}

export async function openBrowser({ port = 8790, viewport = { width: 1280, height: 1600 } } = {}) {
  const srv = await startServer(port);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  await context.route("https://cdn.jsdelivr.net/npm/**", async (route) => {
    try {
      const file = cdnToLocal(route.request().url());
      if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: typeOf(file), body: fs.readFileSync(file), headers: { "access-control-allow-origin": "*" } });
    } catch (e) { console.error(String(e)); return route.fulfill({ status: 500, body: "" }); }
  });
  const errors = [];
  return {
    base: `http://localhost:${port}`,
    context, errors,
    async page(urlPath) {
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
      await page.goto(`http://localhost:${port}${urlPath}`);
      return page;
    },
    async close() { await browser.close(); srv.close(); },
  };
}
