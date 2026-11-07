// SVG → PNG (브라우저 전용, 내려받기용). 이 파일만 DOM을 쓴다.
// <img>로 그린 SVG는 문서의 CSS 변수·글꼴을 쓸 수 없으므로
//   1) var(--plot-1, 대체색)을 지금 문서의 계산값(없으면 대체색)으로 바꾸고
//   2) 쓰인 글꼴(KaTeX, Noto Serif KR)을 문서의 스타일시트에서 찾아 data: 주소로 SVG 안에 넣는다(실패하면 시스템 글꼴).

const VAR_RE = /var\((--[\w-]+),\s*((?:[^()]|\([^()]*\))*)\)/g;
const cssCache = new Map();   // 스타일시트 주소 → 글자
const fontCache = new Map();  // 글꼴 파일 주소 → base64

function resolveVars(svg) {
  const cs = getComputedStyle(document.documentElement);
  return svg.replace(VAR_RE, (_, name, fallback) => cs.getPropertyValue(name).trim() || fallback.trim());
}

async function fetchText(url) {
  if (!cssCache.has(url)) cssCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  return cssCache.get(url);
}

async function fetchB64(url) {
  if (!fontCache.has(url)) {
    fontCache.set(url, fetch(url).then(async (r) => {
      if (!r.ok) return "";
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }).catch(() => ""));
  }
  return fontCache.get(url);
}

function inRanges(cp, ranges) {
  if (!ranges) return true;
  return ranges.some(([a, b]) => cp >= a && cp <= b);
}
function parseRanges(s) {
  if (!s) return null;
  return s.split(",").map((t) => t.trim().replace(/^U\+/i, "")).filter(Boolean).map((t) => {
    if (t.includes("?")) return [parseInt(t.replace(/\?/g, "0"), 16), parseInt(t.replace(/\?/g, "F"), 16)];
    const [a, b] = t.split("-");
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}

/** 문서에 연결된 스타일시트에서 SVG에 필요한 @font-face만 골라 data: 주소 형태의 CSS로 만든다 */
async function embeddedFontCss(svg) {
  const used = new Set([...svg.replace(/<[^>]*>/g, "")].map((c) => c.codePointAt(0)));
  const wantItalic = /font-style="italic"/.test(svg);
  const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
  let css = "";
  for (const href of hrefs) {
    const text = await fetchText(href);
    for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const body = m[1];
      const fam = /font-family:\s*['"]?([^;'"]+)['"]?/.exec(body)?.[1]?.trim();
      const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
      const weight = /font-weight:\s*(\d+)/.exec(body)?.[1] ?? "400";
      const srcUrl = /url\(\s*['"]?([^)'"]+\.woff2)['"]?\s*\)/.exec(body)?.[1];
      if (!fam || !srcUrl) continue;
      const isKatex = fam === "KaTeX_Main" || fam === "KaTeX_Math";
      const isNoto = fam === "Noto Serif KR";
      if (!isKatex && !isNoto) continue;
      if (weight !== "400") continue;
      if (fam === "KaTeX_Main" && style !== "normal") continue;
      if (fam === "KaTeX_Math" && !(style === "italic" && wantItalic)) continue;
      if (isNoto) {
        const ranges = parseRanges(/unicode-range:\s*([^;]+)/.exec(body)?.[1]);
        if (![...used].some((cp) => cp > 0x7f && inRanges(cp, ranges))) continue;
      }
      const b64 = await fetchB64(new URL(srcUrl, href).href);
      if (!b64) continue;
      const ur = /unicode-range:\s*([^;]+)/.exec(body)?.[1];
      css += `@font-face{font-family:"${fam}";font-style:${style};font-weight:${weight};${ur ? `unicode-range:${ur};` : ""}src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    }
  }
  return css;
}

/**
 * @param {string} svg renderPlot가 만든 SVG 글자
 * @param {number} [scale] 배율(기본 3 → 그림 단위 1이 3픽셀)
 * @returns {Promise<Blob>} 흰 배경의 PNG
 */
export async function svgToPng(svg, scale = 3) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error("svgToPng: SVG에 viewBox가 없습니다");
  const w = Math.round(parseFloat(m[1]) * scale), h = Math.round(parseFloat(m[2]) * scale);
  let src = resolveVars(svg).replace(/currentColor/g, "#111");
  try {
    const css = await embeddedFontCss(src);
    if (css) src = src.replace(/(<svg[^>]*>)/, `$1<style>${css}</style>`);
  } catch { /* 글꼴을 못 넣으면 시스템 글꼴로 그린다 */ }
  src = src.replace("<svg ", `<svg width="${w}" height="${h}" `);
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("svgToPng: PNG 변환 실패"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
