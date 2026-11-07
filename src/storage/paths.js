// 저장소 경로 검사·변환. 원고 저장소에서는 books/ 와 fonts/ 아래만 다룬다.
import { StorageError } from "./errors.js";

const ROOTS = ["books", "fonts"];
export const MAX_UPLOAD = 50 * 1024 * 1024; // 올릴 수 있는 최대 크기(GitHub 경고 기준)

/** books/·fonts/ 아래의 정규화된 경로인가(.. · 빈 칸 · 역슬래시 · 제어 문자 거부) */
export function isRepoPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 500) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(p)) return false;
  const segs = p.split("/");
  if (segs.length < 2 || !ROOTS.includes(segs[0])) return false;
  return segs.every((s) => s !== "" && s !== "." && s !== ".." && s.length <= 255 && s.toLowerCase() !== ".git");
}

export function assertRepoPath(p) {
  if (!isRepoPath(p)) {
    throw new StorageError("원고 저장소의 books/ 또는 fonts/ 아래 경로만 사용할 수 있습니다.", { kind: "path" });
  }
  return p;
}

/**
 * baseDir 기준의 상대 경로 rel을 저장소 경로로 풀어 준다. 예: ("books/x", "../../fonts/a.ttf") → "fonts/a.ttf".
 * 앞이 "/"면 저장소 루트 기준. 주소(http: 등)이거나 books/·fonts/ 밖이면 null.
 */
export function resolveRepoPath(baseDir, rel) {
  if (typeof rel !== "string" || typeof baseDir !== "string") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith("//")) return null;
  const stack = rel.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!stack.length) return null; stack.pop(); continue; }
    stack.push(seg);
  }
  const out = stack.join("/");
  return isRepoPath(out) ? out : null;
}

/** URL 경로 칸에 넣을 인코딩(칸마다) */
export const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", pdf: "application/pdf",
  json: "application/json", md: "text/markdown", css: "text/css",
};
export function mimeOf(path) {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return (m && MIME[m[1].toLowerCase()]) || "application/octet-stream";
}
