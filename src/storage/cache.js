// 그림·글꼴 캐시(IndexedDB). 키는 GitHub 파일의 sha라서 내용이 바뀌면 자동으로 새로 받는다.
// 캐시는 덤이므로 어떤 오류도 삼킨다(캐시가 없어도 동작해야 함). 토큰은 들어가지 않는다.
import { withStores } from "./idb.js";

const MAX_BYTES = 300 * 1024 * 1024; // 넘으면 오래 안 쓴 것부터 지움

export async function cacheGet(sha) {
  try {
    const rec = await withStores(["assets", "assetMeta"], "readwrite", (assets, meta) => {
      const g = assets.get(sha);
      g.onsuccess = () => {
        if (g.result) {
          const m = meta.get(sha);
          m.onsuccess = () => { if (m.result) meta.put({ ...m.result, at: Date.now() }); };
        }
      };
      return g;
    });
    return rec ? { buffer: rec.buffer, type: rec.type } : null;
  } catch { return null; }
}

export async function cachePut(sha, buffer, type) {
  try {
    await withStores(["assets", "assetMeta"], "readwrite", (assets, meta) => {
      assets.put({ sha, buffer, type });
      meta.put({ sha, size: buffer.byteLength, at: Date.now() });
    });
    await prune();
  } catch { /* 저장 공간 부족 등은 무시 */ }
}

async function prune() {
  const metas = await withStores(["assetMeta"], "readonly", (m) => m.getAll());
  let total = metas.reduce((n, m) => n + m.size, 0);
  if (total <= MAX_BYTES) return;
  const old = metas.sort((a, b) => a.at - b.at);
  const drop = [];
  for (const m of old) { if (total <= MAX_BYTES * 0.8) break; drop.push(m.sha); total -= m.size; }
  await withStores(["assets", "assetMeta"], "readwrite", (assets, meta) => { for (const s of drop) { assets.delete(s); meta.delete(s); } });
}
