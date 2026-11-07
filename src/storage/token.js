// 토큰 보관. remember가 참이면 localStorage(이 컴퓨터에 계속), 거짓이면 sessionStorage(탭을 닫을 때까지).
import { StorageError } from "./errors.js";

export const TOKEN_KEY = "latexbook.github-token";

function area(name) {
  try { return globalThis[name] ?? null; } catch { return null; }
}

export function saveToken(token, remember) {
  const t = String(token ?? "").trim();
  if (!t) throw new StorageError("토큰이 비어 있습니다.", { kind: "other" });
  const target = area(remember ? "localStorage" : "sessionStorage");
  const other = area(remember ? "sessionStorage" : "localStorage");
  try {
    target.setItem(TOKEN_KEY, t);
  } catch {
    throw new StorageError("이 브라우저에서는 토큰을 저장할 수 없습니다(저장 공간이 막혀 있습니다).", { kind: "other" });
  }
  try { other?.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
}

export function loadToken() {
  for (const name of ["sessionStorage", "localStorage"]) {
    try {
      const v = area(name)?.getItem(TOKEN_KEY);
      if (v) return v;
    } catch { /* 무시 */ }
  }
  return null;
}

export function clearToken() {
  for (const name of ["sessionStorage", "localStorage"]) {
    try { area(name)?.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  }
}
