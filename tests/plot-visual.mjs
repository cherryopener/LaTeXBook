// 확인용 그림을 out/plot/*.png 로 저장한다(브라우저 필요, 포트 8804). 실행: node tests/plot-visual.mjs
// - <이름>.png : 화면에서 그린 SVG를 확대 캡처
// - <이름>.download.png : svgToPng(내려받기용 PNG) 결과
import fs from "node:fs";
import path from "node:path";
import { openBrowser, ROOT } from "./lib/browser.mjs";

const outDir = path.join(ROOT, "out", "plot");
fs.mkdirSync(outDir, { recursive: true });
const t = await openBrowser({ port: 8804, viewport: { width: 1400, height: 1000 } });
let failed = false;
try {
  const page = await t.page("/tests/pages/plot-gallery.html");
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "_gallery.png"), fullPage: true });
  const names = await page.$$eval(".ex", (els) => els.map((e) => e.dataset.name));
  for (const name of names) {
    const el = await page.$(`.ex[data-name="${name}"] .box`);
    await el.screenshot({ path: path.join(outDir, `${name}.png`) });
    const b64 = await page.evaluate(async (n) => {
      const { svgToPng } = await import("/src/plot/index.js");
      const svg = document.querySelector(`.ex[data-name="${n}"] svg`).outerHTML;
      const blob = await svgToPng(svg, 3);
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, name);
    fs.writeFileSync(path.join(outDir, `${name}.download.png`), Buffer.from(b64, "base64"));
  }
  console.log(`${names.length}개 저장: ${outDir}`);
  if (t.errors.length) { console.log("브라우저 오류:", t.errors); failed = true; }
} finally {
  await t.close();
}
process.exit(failed ? 1 : 0);
