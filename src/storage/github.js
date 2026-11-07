// GitHub 저장소(REST API) 저장소 어댑터. 서버 없이 브라우저에서 fine-grained 토큰으로 직접 부른다.
//
// 보안 규칙
// - 토큰은 이 파일의 클로저에만 있고, https://api.github.com 으로 가는 요청의 Authorization 머리글에만 쓴다.
// - 주소(URL)·로그·오류 문장·캐시·커밋 메시지에는 넣지 않는다. 오류 응답 본문은 읽지도 보여 주지도 않는다.
// - fetch는 credentials "omit", referrerPolicy "no-referrer", cache "no-store".
import { assembleBook } from "../book.js";
import { ConflictError, StorageError, httpError, networkError } from "./errors.js";
import { assertRepoPath, encodePath, isRepoPath, mimeOf, MAX_UPLOAD } from "./paths.js";
import { base64ToBytes, blobToBase64, bytesToText, textToBlob } from "./bytes.js";
import { cacheGet, cachePut } from "./cache.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const ACCEPT_JSON = "application/vnd.github+json";
const ACCEPT_RAW = "application/vnd.github.raw+json";
const ACCEPT_OBJECT = "application/vnd.github.object+json";
const CONCURRENCY = 5;            // 동시에 보내는 요청 수
const INLINE_LIMIT = 1_000_000;   // 이 크기 이하는 JSON(base64)으로, 넘으면 raw로 받는다
const TIMEOUT = 60_000;
const TIMEOUT_BIG = 300_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 동시 실행 수를 제한해 items를 처리. 하나라도 실패하면 나머지를 마저 돌리지 않고 첫 오류를 던진다 */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  let firstError;
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (e) { if (!failed) { failed = true; firstError = e; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw firstError;
  return results;
}

/** 책 폴더 안에서 assembleBook이 쓰는 파일인가(book.json, <부>/part.json, <부>/<장>.md) */
const isBookTextFile = (rel) => rel === "book.json" || /^\d+-[^/]+\/part\.json$/.test(rel) || /^\d+-[^/]+\/\d+-[^/]+\.md$/.test(rel);

export function createGitHubStore({ owner, repo, branch = "main", token } = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner ?? "") || !/^[A-Za-z0-9_.-]+$/.test(repo ?? "")) {
    throw new StorageError("저장소 이름이 올바르지 않습니다.", { kind: "other" });
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
    throw new StorageError("브랜치 이름이 올바르지 않습니다.", { kind: "other" });
  }
  token = String(token ?? "").trim();
  if (!token) throw new StorageError("GitHub 토큰이 없습니다. 토큰을 먼저 입력해 주세요.", { kind: "auth" });
  if (!/^[A-Za-z0-9_.-]{8,400}$/.test(token)) {
    throw new StorageError("토큰에 올바르지 않은 글자가 있습니다. 복사할 때 공백이나 줄바꿈이 섞이지 않았는지 확인해 주세요.", { kind: "auth" });
  }
  const authorization = `Bearer ${token}`;
  const ref = encodeURIComponent(branch);

  // ───── 상태 ─────
  /** 경로 → {sha, size}: 마지막으로 받은 파일 목록(트리). 내가 쓴 파일도 갱신 */
  let index = new Map();
  const textBySha = new Map();     // sha → 글자 (원고·SVG)
  const urlBySha = new Map();      // `${sha}:${mime}` → blob 주소
  const urlByPath = new Map();     // 경로 → {sha, url}
  const inflight = new Map();      // 경로 → 진행 중인 assetUrl 약속
  let writeChain = Promise.resolve();

  // ───── 요청 ─────
  /** 저장소 API 호출. read: json|bytes|none. allow: 오류로 던지지 않고 돌려줄 상태 코드 */
  async function send(method, route, { body, accept = ACCEPT_JSON, read = "json", allow = [], what, timeout = TIMEOUT } = {}) {
    const url = `${API}/repos/${owner}/${repo}${route}`;
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      let res;
      let data = null;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Accept: accept,
            Authorization: authorization,
            "X-GitHub-Api-Version": API_VERSION,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          redirect: "follow",
          signal: ctl.signal,
        });
        if (new URL(res.url).origin !== API) throw new StorageError("GitHub가 예상하지 못한 주소로 안내했습니다. 요청을 중단했습니다.", { kind: "other" });
        if (res.ok && read === "json") data = await res.json();
        else if (res.ok && read === "bytes") data = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        if (e instanceof StorageError) throw e;
        if (e instanceof SyntaxError) throw new StorageError("GitHub 응답을 이해할 수 없습니다.", { kind: "other" });
        throw networkError(ctl.signal.aborted);
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) return { status: res.status, data };
      try { res.body?.cancel(); } catch { /* 무시 */ }
      if (allow.includes(res.status)) return { status: res.status, data: null };
      if (method === "GET" && attempt === 0 && [502, 503, 504].includes(res.status)) { await sleep(400); continue; }
      throw httpError(res.status, res.headers, what);
    }
  }

  // ───── 파일 목록(트리) ─────
  const treeUrl = (sha, recursive) => `/git/trees/${encodeURIComponent(sha)}${recursive ? "?recursive=1" : ""}`;
  function addEntries(out, t, prefix) {
    for (const e of t.tree ?? []) {
      if (e.type === "blob" && String(e.mode).startsWith("100") && isRepoPath(prefix + e.path)) out.set(prefix + e.path, { sha: e.sha, size: e.size ?? 0 });
    }
  }
  /** 트리가 잘렸을 때(너무 큰 저장소) 폴더별로 내려가며 모은다 */
  async function collectTruncated(sha, prefix, out) {
    const t = (await send("GET", treeUrl(sha, true), { what: "파일 목록" })).data;
    if (!t.truncated) return addEntries(out, t, prefix);
    const flat = (await send("GET", treeUrl(sha, false), { what: "파일 목록" })).data;
    addEntries(out, flat, prefix);
    for (const e of flat.tree ?? []) {
      if (e.type !== "tree") continue;
      if (prefix === "" && e.path !== "books" && e.path !== "fonts") continue;
      await collectTruncated(e.sha, `${prefix}${e.path}/`, out);
    }
  }
  /** 저장소 전체 파일 목록을 새로 받아 index를 바꾼다 */
  async function refreshIndex() {
    const r = await send("GET", treeUrl(branch, true), { what: "파일 목록", allow: [409] });
    const out = new Map();
    if (r.status === 409) { index = out; return index; } // 빈 저장소
    if (!r.data.truncated) addEntries(out, r.data, "");
    else await collectTruncated(branch, "", out);
    index = out;
    return index;
  }

  // ───── 내용 받기 ─────
  /** sha로 파일 바이트를 받는다(작으면 JSON, 크면 raw) */
  async function blobBytes(sha, size) {
    if (size > INLINE_LIMIT) {
      const r = await send("GET", `/git/blobs/${encodeURIComponent(sha)}`, { accept: ACCEPT_RAW, read: "bytes", timeout: TIMEOUT_BIG, what: "파일" });
      return r.data;
    }
    const d = (await send("GET", `/git/blobs/${encodeURIComponent(sha)}`, { what: "파일" })).data;
    if (d.encoding === "base64") return base64ToBytes(d.content);
    if (d.encoding === "utf-8") return new TextEncoder().encode(d.content);
    throw new StorageError("GitHub가 알 수 없는 형식으로 파일을 보냈습니다.", { kind: "other" });
  }

  /**
   * contents API로 파일 정보를 받는다. 1MB 이하면 내용(bytes)도 함께.
   * 기본 형식은 1MB를 넘는 파일에 403(too_large)을 주므로 object 형식을 쓰고(1~100MB도 sha·size는 줌),
   * 그래도 403이면 파일 목록(트리)에서 sha를 찾는다.
   */
  async function getContent(path) {
    let d;
    try {
      d = (await send("GET", `/contents/${encodePath(path)}?ref=${ref}`, { accept: ACCEPT_OBJECT, what: path })).data;
    } catch (e) {
      if (!(e instanceof StorageError && e.kind === "forbidden")) throw e;
      await refreshIndex();
      const info = index.get(path);
      if (!info) throw e;
      return { sha: info.sha, size: info.size, bytes: null };
    }
    if (!d || Array.isArray(d) || d.type !== "file") throw new StorageError(`파일이 아니라 폴더이거나 특수 항목입니다: ${path}`, { kind: "other" });
    index.set(path, { sha: d.sha, size: d.size });
    const bytes = d.encoding === "base64" && typeof d.content === "string" ? base64ToBytes(d.content) : null;
    return { sha: d.sha, size: d.size, bytes };
  }

  async function fetchText(sha, size) {
    if (textBySha.has(sha)) return textBySha.get(sha);
    const text = bytesToText(await blobBytes(sha, size));
    textBySha.set(sha, text);
    return text;
  }

  async function readFile(path) {
    assertRepoPath(path);
    const m = await getContent(path);
    const bytes = m.bytes ?? (await blobBytes(m.sha, m.size));
    const text = bytesToText(bytes);
    textBySha.set(m.sha, text);
    return { text, sha: m.sha };
  }

  async function readBinary(path) {
    assertRepoPath(path);
    const m = await getContent(path);
    const bytes = m.bytes ?? (await blobBytes(m.sha, m.size));
    return { blob: new Blob([bytes], { type: mimeOf(path) }), sha: m.sha };
  }

  // ───── 책 목록·불러오기 ─────
  async function listBooks() {
    const idx = await refreshIndex();
    const ids = new Set();
    for (const p of idx.keys()) { const m = /^books\/([^/]+)\//.exec(p); if (m) ids.add(m[1]); }
    const list = await pool([...ids].sort((a, b) => a.localeCompare(b)), CONCURRENCY, async (id) => {
      const info = idx.get(`books/${id}/book.json`);
      let title = id;
      if (info) {
        try {
          const t = JSON.parse(await fetchText(info.sha, info.size))?.title;
          if (typeof t === "string" && t.trim()) title = t;
        } catch (e) { if (e instanceof StorageError) throw e; /* book.json 형식 오류: 폴더 이름으로 */ }
      }
      return { id, title };
    });
    return list;
  }

  async function loadBook(id) {
    const prefix = `books/${id}/`;
    assertRepoPath(`${prefix}book.json`);
    if (String(id).includes("/")) throw new StorageError("책 폴더 이름이 올바르지 않습니다.", { kind: "path" });
    const idx = await refreshIndex();
    const rels = [];
    let any = false;
    for (const [p, info] of idx) {
      if (!p.startsWith(prefix)) continue;
      any = true;
      const rel = p.slice(prefix.length);
      if (isBookTextFile(rel)) rels.push([rel, info]);
    }
    if (!any) throw new StorageError(`책 폴더(books/${id})를 저장소에서 찾을 수 없습니다.`, { kind: "notfound" });
    if (!rels.some(([rel]) => rel === "book.json")) throw new StorageError(`책 폴더(books/${id})에 book.json이 없습니다.`, { kind: "notfound" });
    const files = {};
    await pool(rels, CONCURRENCY, async ([rel, info]) => { files[rel] = await fetchText(info.sha, info.size); });
    const book = assembleBook(id, files);
    for (const part of book.parts) for (const ch of part.chapters) ch.sha = idx.get(prefix + ch.path)?.sha;
    return book;
  }

  // ───── 그림·글꼴 ─────
  function makeUrl(sha, mime, buffer) {
    const key = `${sha}:${mime}`;
    let url = urlBySha.get(key);
    if (!url) { url = URL.createObjectURL(new Blob([buffer], { type: mime })); urlBySha.set(key, url); }
    return url;
  }
  const toBuffer = (b) => (b instanceof ArrayBuffer ? b : b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

  async function loadAsset(path) {
    const mime = mimeOf(path);
    const known = index.get(path);
    const mem = urlByPath.get(path);
    if (mem && (!known || known.sha === mem.sha)) return mem.url;
    let sha, size, bytes = null;
    if (known) ({ sha, size } = known);
    else ({ sha, size, bytes } = await getContent(path));
    let buffer = null;
    if (!urlBySha.has(`${sha}:${mime}`)) {
      if (bytes) buffer = toBuffer(bytes);
      else { const hit = await cacheGet(sha); if (hit) buffer = hit.buffer; }
      if (!buffer) {
        buffer = toBuffer(await blobBytes(sha, size));
        await cachePut(sha, buffer, mime);
      } else if (bytes) {
        await cachePut(sha, buffer, mime);
      }
    }
    const url = makeUrl(sha, mime, buffer);
    if (mime === "image/svg+xml" && buffer && !textBySha.has(sha)) textBySha.set(sha, bytesToText(new Uint8Array(buffer)));
    urlByPath.set(path, { sha, url });
    return url;
  }

  /** 비공개 그림·글꼴 → blob: 주소. 같은 세션은 메모리, 다음 방문은 IndexedDB(sha 기준)에서 */
  async function assetUrl(path) {
    assertRepoPath(path);
    let p = inflight.get(path);
    if (!p) { p = loadAsset(path).finally(() => inflight.delete(path)); inflight.set(path, p); }
    return p;
  }

  /** assetUrl이 이미 끝난 경로의 주소(동기). 아직이거나 파일이 바뀌었으면 null */
  function cachedAssetUrl(path) {
    const mem = urlByPath.get(path);
    if (!mem) return null;
    const known = index.get(path);
    return known && known.sha !== mem.sha ? null : mem.url;
  }

  /** prefetch로 받아 둔 SVG 원문(동기). 없으면 null */
  function readSvgCached(path) {
    const mem = urlByPath.get(path);
    if (!mem) return null;
    const known = index.get(path);
    if (known && known.sha !== mem.sha) return null;
    return textBySha.get(mem.sha) ?? null;
  }

  /** 여러 그림·글꼴·SVG를 미리 받아 cachedAssetUrl·readSvgCached로 동기 조회할 수 있게 한다. 없는 파일은 missing에 */
  async function prefetch(paths) {
    const uniq = [...new Set(paths)];
    const ok = [];
    const missing = [];
    await pool(uniq, CONCURRENCY, async (p) => {
      if (!isRepoPath(p)) { missing.push(p); return; }
      try { await assetUrl(p); ok.push(p); } catch (e) {
        if (e instanceof StorageError && e.kind === "notfound") missing.push(p);
        else throw e;
      }
    });
    return { ok, missing };
  }

  // ───── 쓰기 ─────
  const enqueue = (fn) => {
    const p = writeChain.then(fn);
    writeChain = p.catch(() => {}); // 쓰기는 한 줄로(같은 브랜치에 동시에 쓰면 GitHub가 409를 냄)
    return p;
  };

  /** 충돌 확인용으로 원격의 지금 모습을 읽는다. 파일이 없으면 null */
  async function peekRemote(path, withText) {
    try {
      const m = await getContent(path);
      if (!withText) return { text: "", sha: m.sha };
      const bytes = m.bytes ?? (await blobBytes(m.sha, m.size));
      return { text: bytesToText(bytes), sha: m.sha };
    } catch (e) {
      if (e instanceof StorageError && e.kind === "notfound") return null;
      throw e;
    }
  }

  async function put(path, base64, size, { sha, message }, isText) {
    const msg = String(message || `원고 저장: ${path}`).split(token).join("");
    const body = JSON.stringify({ message: msg, content: base64, branch, ...(sha ? { sha } : {}) });
    for (let attempt = 0; ; attempt++) {
      const r = await send("PUT", `/contents/${encodePath(path)}`, { body, allow: [409, 422], what: path, timeout: TIMEOUT_BIG });
      if (r.status === 200 || r.status === 201) {
        const newSha = r.data?.content?.sha;
        if (!newSha) throw new StorageError("GitHub 응답에 저장 결과가 없습니다.", { kind: "other" });
        index.set(path, { sha: newSha, size });
        return newSha;
      }
      // 409·422: 먼저 바뀐 것인지, 같은 브랜치에 다른 커밋이 겹친 것인지 가려 본다
      const remote = await peekRemote(path, isText);
      if (remote && remote.sha !== sha) {
        throw new ConflictError(
          sha ? "다른 곳에서 이 파일이 먼저 저장되었습니다. 덮어쓰지 않았습니다." : "같은 이름의 파일이 이미 저장소에 있습니다. 덮어쓰지 않았습니다.",
          remote,
        );
      }
      if (r.status === 409 && attempt < 2) { await sleep(400 * (attempt + 1)); continue; } // 파일은 그대로 → 다른 커밋과 겹쳤을 뿐
      throw httpError(r.status, null, path);
    }
  }

  async function writeFile(path, text, opts = {}) {
    assertRepoPath(path);
    const blob = textToBlob(String(text));
    return enqueue(async () => {
      const sha = await put(path, await blobToBase64(blob), blob.size, opts, true);
      textBySha.set(sha, String(text));
      return { sha };
    });
  }

  async function writeBinary(path, blob, opts = {}) {
    assertRepoPath(path);
    if (!(blob instanceof Blob)) throw new StorageError("올릴 파일이 올바르지 않습니다.", { kind: "other" });
    if (blob.size > MAX_UPLOAD) throw new StorageError(`파일이 너무 큽니다(${Math.ceil(blob.size / 1048576)}MB). ${MAX_UPLOAD / 1048576}MB 이하만 올릴 수 있습니다.`, { kind: "toolarge" });
    return enqueue(async () => {
      const sha = await put(path, await blobToBase64(blob), blob.size, opts, false);
      // 방금 올린 그림은 다시 받지 않고 바로 쓸 수 있게 해 둔다(실패해도 상관없음)
      try {
        const mime = mimeOf(path);
        const buffer = await blob.arrayBuffer();
        await cachePut(sha, buffer, mime);
        urlByPath.set(path, { sha, url: makeUrl(sha, mime, buffer) });
        if (mime === "image/svg+xml") textBySha.set(sha, bytesToText(new Uint8Array(buffer)));
      } catch { /* 무시 */ }
      return { sha };
    });
  }

  // ───── 조회용 덧붙임 ─────
  /** 마지막으로 받은 파일 목록에서 prefix 아래 파일들(loadBook·listBooks·쓰기 뒤에 최신) */
  function listFiles(prefix = "") {
    return [...index].filter(([p]) => p.startsWith(prefix)).map(([path, v]) => ({ path, sha: v.sha, size: v.size }));
  }
  const hasFile = (path) => index.has(path);

  /** 만든 blob: 주소를 모두 풀어 준다 */
  function dispose() {
    for (const u of urlBySha.values()) { try { URL.revokeObjectURL(u); } catch { /* 무시 */ } }
    urlBySha.clear(); urlByPath.clear(); textBySha.clear();
  }

  return {
    listBooks, loadBook, readFile, readBinary, assetUrl, writeFile, writeBinary,
    // 덧붙임
    prefetch, cachedAssetUrl, readSvgCached, listFiles, hasFile, dispose,
  };
}
