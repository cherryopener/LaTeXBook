// IndexedDB 열기(DB 이름 latexbook). 임시 저장(drafts)과 그림·글꼴 캐시(assets, assetMeta)가 함께 쓴다.
import { StorageError } from "./errors.js";

export const DB_NAME = "latexbook";
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new StorageError("이 브라우저에서는 임시 저장 공간(IndexedDB)을 쓸 수 없습니다."));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return reject(new StorageError("이 브라우저에서는 임시 저장 공간(IndexedDB)을 쓸 수 없습니다.")); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "path" });
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets", { keyPath: "sha" });
      if (!db.objectStoreNames.contains("assetMeta")) db.createObjectStore("assetMeta", { keyPath: "sha" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(new StorageError("임시 저장 공간(IndexedDB)을 열지 못했습니다."));
    req.onblocked = () => reject(new StorageError("다른 탭이 임시 저장 공간을 쓰고 있습니다. 다른 탭을 닫고 다시 시도해 주세요."));
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

/**
 * 한 번의 트랜잭션. fn(...stores)은 IDBObjectStore들을 받아 요청을 건다.
 * fn이 IDBRequest를 돌려주면 그 결과를, 아니면 반환값을, 트랜잭션이 끝난 뒤 돌려준다.
 */
export async function withStores(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try { tx = db.transaction(names, mode); } catch { return reject(new StorageError("임시 저장 공간을 읽거나 쓰지 못했습니다.")); }
    const stores = names.map((n) => tx.objectStore(n));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new StorageError("임시 저장 공간을 읽거나 쓰지 못했습니다."));
    tx.onabort = () => reject(new StorageError("임시 저장 공간을 읽거나 쓰지 못했습니다(저장 공간이 부족할 수 있습니다)."));
    try {
      const r = fn(...stores);
      if (r && typeof r === "object" && "onsuccess" in r) r.addEventListener("success", () => { result = r.result; });
      else result = r;
    } catch (e) { try { tx.abort(); } catch { /* 무시 */ } reject(e); }
  });
}
