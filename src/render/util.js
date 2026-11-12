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
    // YAML 따옴표 값: "…"는 JSON 규칙(\" \\ 등), '…'는 '' → '
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    meta[line.slice(0, i).trim()] = v;
  }
  const head = m[0];
  return { meta, head, body: src.slice(head.length), lineOffset: (head.match(/\n/g) ?? []).length };
}

/** 표 줄의 칸들(GFM 규칙: 앞뒤 |는 떼고, \\|가 아닌 |로 나눔) */
function tableCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * 표의 칸 수가 줄마다 다르면(첫 줄 6칸, 둘째 줄 |---| 5칸 등) GFM은 표로 보지 않고 글자로 찍는다.
 * 가장 많은 칸 수에 맞춰 첫 줄·둘째 줄을 고쳐 표가 되게 한다(내용은 버리지 않음). 줄 수는 그대로라 줄 번호가 맞는다.
 * @param {(line:number, message:string)=>void} onFix 고친 표마다(본문 기준 줄 번호, 1부터)
 */
export function fixTables(body, onFix = () => {}) {
  const lines = String(body).split("\n");
  let fence = null;
  for (let i = 1; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i - 1]);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const head = lines[i - 1], delim = lines[i];
    if (!delim.includes("|") || !TABLE_DELIM.test(delim) || !head.includes("|") || TABLE_DELIM.test(head)) continue;
    let end = i + 1;
    while (end < lines.length && lines[end].trim() && lines[end].includes("|")) end++;
    const h = tableCells(head), d = tableCells(delim), rows = lines.slice(i + 1, end).map(tableCells);
    const n = Math.max(h.length, d.length, ...rows.map((r) => r.length));
    if (h.length !== n || d.length !== n) {
      const pad = (a, v) => [...a, ...Array(n - a.length).fill(v)];
      const lastAlign = d[d.length - 1] || "---";
      const indent = /^\s*/.exec(head)[0];
      lines[i - 1] = `${indent}| ${pad(h, "").join(" | ")} |`;
      lines[i] = `${indent}|${pad(d, lastAlign).join("|")}|`;
      onFix(i, `표의 칸 수가 줄마다 달라(첫 줄 ${h.length}칸, 둘째 줄 ${d.length}칸${rows.length ? `, 내용 줄 최대 ${Math.max(...rows.map((r) => r.length))}칸` : ""}) ${n}칸으로 맞춰 그렸습니다. 원고의 첫 줄·둘째 줄(|---|)의 칸 수를 맞춰 주세요.`);
    }
    i = end - 1;
  }
  return lines.join("\n");
}

/** 문제 구간 시작 줄(::problems, ::problems{per=4} 등) */
export const PROBLEMS_LINE = /^::problems(\{[^}]*\})?[ \t]*$/;
/** 연습문제 장(Q 장)의 번호 자리 글자 */
export const EXERCISE_NO = "Q";

/**
 * 문제만 있는 장(연습문제 장)인가: 머리 부분 뒤, 첫 ::problems 줄 앞에 아무것도 없음(빈 줄·HTML 주석만).
 * 이런 장은 장 번호를 쓰지 않고(뒤 장 번호가 밀리지 않음) 번호 자리에 Q를 쓰며, 빈 개념 쪽을 만들지 않는다.
 */
export function isExerciseChapter(source) {
  const lines = splitFrontMatter(source).body.split("\n");
  const i = lines.findIndex((l) => PROBLEMS_LINE.test(l));
  if (i < 0) return false;
  return lines.slice(0, i).join("\n").replace(/<!--[\s\S]*?-->/g, "").trim() === "";
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
