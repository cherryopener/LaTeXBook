// 임시 저장(IndexedDB). 키는 원고 경로(예: books/x/1-a/01-b.md). 글자만 저장하며 토큰은 들어가지 않는다.
import { withStores } from "./idb.js";
import { StorageError } from "./errors.js";

function key(path) {
  if (typeof path !== "string" || !path) throw new StorageError("임시 저장할 경로가 비어 있습니다.");
  return path;
}

export async function saveDraft(path, text) {
  const rec = { path: key(path), text: String(text), savedAt: Date.now() };
  await withStores(["drafts"], "readwrite", (s) => { s.put(rec); });
}

export async function loadDraft(path) {
  const rec = await withStores(["drafts"], "readonly", (s) => s.get(key(path)));
  return rec ? { text: rec.text, savedAt: rec.savedAt } : null;
}

export async function clearDraft(path) {
  await withStores(["drafts"], "readwrite", (s) => { s.delete(key(path)); });
}

/** (덧붙임) 임시 저장된 글의 목록, 최근 것이 먼저 */
export async function listDrafts() {
  const all = await withStores(["drafts"], "readonly", (s) => s.getAll());
  return (all ?? []).map((r) => ({ path: r.path, savedAt: r.savedAt })).sort((a, b) => b.savedAt - a.savedAt);
}
