// 원고 속 날 HTML과 저장소 SVG를 본문에 넣기 전에 거른다(보안 검토 2026-11-07 지적 1·2).
// 미리보기는 편집기와 같은 문서에 그려지므로, 원고나 그림 파일에 숨은 스크립트가 실행되면 토큰을 빼 갈 수 있다.
// Node와 브라우저 양쪽에서 돌도록 DOM 없이 hast(HTML 구문 트리)로 처리한다.
import { fromHtml, toHtml } from "../../vendor/remark.js";

// 원고에 직접 쓸 수 있는 HTML: 속성 없는 간단한 글자 꾸밈 태그만
const RAW_OK = new Set(["br", "sup", "sub", "b", "i", "u", "s", "em", "strong", "small", "mark"]);
const SIMPLE_TAG = /^<\s*(\/?)\s*([a-zA-Z]+)\s*(\/?)\s*>$/;

/**
 * 원고 속 날 HTML 한 조각을 판정한다.
 * @returns {{ok: true, value: string} | {ok: false}}  ok가 거짓이면 글자 그대로 보이게(이스케이프) 처리할 것
 */
export function checkRawHtml(value) {
  const v = String(value ?? "").trim();
  if (!v) return { ok: true, value: "" };
  if (/^<!--[\s\S]*-->$/.test(v)) return { ok: true, value: "" }; // 주석은 지움
  const m = SIMPLE_TAG.exec(v);
  if (m && RAW_OK.has(m[2].toLowerCase())) return { ok: true, value: `<${m[1]}${m[2].toLowerCase()}${m[3] ? " /" : ""}>` };
  return { ok: false };
}

// SVG에서 지우는 요소(스크립트 실행·외부 문서 끼워 넣기·속성 바꿔치기 수단)
const DROP = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas", "set", "animate", "handler", "listener", "a"]);
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i;

function clean(node) {
  if (!node || typeof node !== "object") return node;
  if (node.type === "element") {
    const name = node.tagName.toLowerCase();
    if (DROP.has(name)) return null;
    const props = node.properties ?? {};
    for (const k of Object.keys(props)) {
      const lk = k.toLowerCase();
      const v = Array.isArray(props[k]) ? props[k].join(" ") : String(props[k]);
      if (lk.startsWith("on")) { delete props[k]; continue; }                       // onload, onerror …
      if (lk === "href" || lk === "xlinkhref" || lk === "src") {
        const t = v.trim();
        const ok = t.startsWith("#") || (name === "image" && /^data:image\/(png|jpe?g|gif|webp);/i.test(t));
        if (!ok) delete props[k];
        continue;
      }
      if (lk === "style" && UNSAFE_STYLE.test(v)) { delete props[k]; continue; }
      if (/^(fill|stroke|filter|mask|clippath|clip-path|markerstart|markermid|markerend|marker)$/.test(lk) && /url\s*\(\s*['"]?(?!#)/i.test(v)) delete props[k]; // 외부 url() 참조
    }
    if (name === "image" && !props.href && !props.xLinkHref) return null;
    if (name === "use" && !props.href && !props.xLinkHref) return null;
    if (name === "style") {
      const css = (node.children ?? []).map((c) => c.value ?? "").join("");
      if (UNSAFE_STYLE.test(css)) return null;
    }
  }
  if (node.children) node.children = node.children.map(clean).filter(Boolean);
  return node;
}

/**
 * SVG 원문을 안전하게 거른다. 스크립트, 이벤트 속성(on*), foreignObject, 외부·javascript: 링크, 위험한 CSS를 지운다.
 * @returns {string|null} 거른 SVG 문자열. <svg>가 없으면 null
 */
export function sanitizeSvg(svgText) {
  const tree = fromHtml(String(svgText ?? ""), { fragment: true });
  let svg = null;
  (function find(n) { if (svg || !n) return; if (n.type === "element" && n.tagName.toLowerCase() === "svg") { svg = n; return; } (n.children ?? []).forEach(find); })(tree);
  if (!svg) return null;
  clean(svg);
  return toHtml(svg, { space: "svg" });
}
