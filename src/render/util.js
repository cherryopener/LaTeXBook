// 원고 변환 공용 도구: 머리 부분, 파서, 글자 이스케이프, SVG 정리
import { unified, remarkParse, remarkGfm, remarkMath, remarkDirective, mdToString } from "../../vendor/remark.js";

export const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);

/** 원고 → mdast (위치 정보 포함) */
export function parseBody(body) {
  return parser.runSync(parser.parse(body));
}

export const text = (n) => mdToString(n);

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 머리 부분(--- … ---) 분리. lineOffset: 본문 1줄이 원본의 몇 줄 뒤인지 */
export function splitFrontMatter(source) {
  const src = String(source ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { meta: {}, head: "", body: src, lineOffset: 0 };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    let v = line.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    meta[line.slice(0, i).trim()] = v;
  }
  const head = m[0];
  return { meta, head, body: src.slice(head.length), lineOffset: (head.match(/\n/g) ?? []).length };
}

/** Physiklar 그림 경로 /books/<id>/파일 → images/파일 */
export function mapAssetPath(src) {
  const s = String(src ?? "").trim();
  const m = /^\/books\/[^/]+\/(.+)$/.exec(s);
  if (!m) return s;
  return m[1].startsWith("images/") ? m[1] : "images/" + m[1];
}

/** SVG 원문을 본문에 넣을 수 있게 정리: XML 머리·주석 제거, id 충돌 방지 접두어 */
export function cleanSvg(svg, prefix) {
  let s = String(svg ?? "").replace(/^﻿/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const i = s.search(/<svg[\s>]/i);
  if (i > 0) s = s.slice(i);
  const ids = new Set([...s.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2]));
  if (!ids.size || !prefix) return s;
  s = s.replace(/(\sid\s*=\s*)(["'])([^"']*)\2/g, (m, a, q, v) => (ids.has(v) ? a + q + prefix + v + q : m));
  s = s.replace(/#([^\s"'()#;,{}<>]+)/g, (m, v) => (ids.has(v) ? "#" + prefix + v : m));
  return s;
}

/** 짧고 결정적인 해시(FNV-1a 32비트, 16진수 8자리) */
export function hash8(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** ```plot 블록의 w: 값(기본 70) */
export function plotWidth(spec) {
  const m = /^\s*w\s*:\s*(\d+(?:\.\d+)?)\s*$/m.exec(spec ?? "");
  return m ? clampPct(m[1], 70) : 70;
}

export function clampPct(v, def) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, 100);
}

export const isPlusPlus = (n) => n.type === "paragraph" && text(n).trim() === "+++";
export const isDirective = (n) => n.type === "containerDirective" || n.type === "leafDirective" || n.type === "textDirective";
export const isBlockDirective = (n) => n.type === "containerDirective" || n.type === "leafDirective";
