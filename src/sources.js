// 책을 어디서 읽고 어디에 저장하는지(원고 출처). app이 쓴다. 메인 세션 담당.
//
// 출처는 모두 같은 모양을 가진다:
//   kind, label, readOnly
//   listBooks() → [{id, title}]
//   loadBook(id) → BookSource
//   save(path, text, sha) → {sha}            (path는 책 폴더 기준. readOnly면 없음)
//   prepareAssets(srcs) → Promise            (그림·글꼴을 미리 받아 둠. 그 뒤 url/svg를 동기로 쓸 수 있음)
//   assetUrl(src) → string|null              (동기. 준비되지 않았거나 없으면 null)
//   svgText(src) → string|null               (동기)
//   uploadImage(file) → Promise<string>      (원고에 쓸 경로. readOnly면 없음)
// src는 원고 속 경로(책 폴더 기준: "images/a.svg", "../../fonts/x.ttf").
import { assembleBook } from "./book.js";

/** 책 폴더 기준 경로를 정규화한다("../../fonts/x" → 저장소 기준 "fonts/x"는 repoPath에서) */
export function normalize(src) {
  const parts = [];
  for (const p of String(src).split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop(); else parts.push(p);
  }
  return parts.join("/");
}
/** 책 폴더 기준 경로 → 저장소 기준 경로 */
export function repoPath(bookId, src) {
  return normalize(`books/${bookId}/${src}`);
}

/** 저장소(GitHub 등) 기준이 아닌, 이 편집기와 함께 올라간 견본 책(samples/). 읽기 전용, 임시 저장만 됨 */
export function createSampleSource(baseUrl) {
  const indexUrl = new URL("samples/index.json", baseUrl).href;
  let index = null;
  let cur = null; // {id, files:Set}
  const svgs = new Map();
  const getIndex = async () => (index ??= await (await fetch(indexUrl)).json());
  const fileUrl = (id, p) => new URL(`samples/${id}/${p}`, baseUrl).href;
  return {
    kind: "sample", label: "견본 책(저장 안 됨)", readOnly: true,
    async listBooks() { return (await getIndex()).books.map(({ id, title }) => ({ id, title })); },
    async loadBook(id) {
      const b = (await getIndex()).books.find((x) => x.id === id);
      if (!b) throw new Error(`견본 책 "${id}"이 없습니다.`);
      const texts = {};
      await Promise.all(b.files.filter((f) => /\.(json|md)$/.test(f)).map(async (f) => { texts[f] = await (await fetch(fileUrl(id, f))).text(); }));
      cur = { id, files: new Set(b.files) };
      svgs.clear();
      return assembleBook(id, texts);
    },
    async prepareAssets(srcs) {
      if (!cur) return;
      await Promise.all(srcs.map(normalize).filter((p) => p.endsWith(".svg") && cur.files.has(p) && !svgs.has(p))
        .map(async (p) => { svgs.set(p, await (await fetch(fileUrl(cur.id, p))).text()); }));
    },
    assetUrl(src) { const p = normalize(src); return cur && cur.files.has(p) ? fileUrl(cur.id, p) : null; },
    svgText(src) { return svgs.get(normalize(src)) ?? null; },
  };
}

/**
 * GitHub 비공개 저장소(storage 모듈의 Store)를 출처 모양으로 감싼다.
 * 그림·글꼴은 store.prefetch로 미리 받아(sha 기준 IndexedDB 캐시) 동기 함수(cachedAssetUrl, readSvgCached)로 쓴다.
 * @param {object} store createGitHubStore(...) 결과
 * @param {{owner:string, repo:string, resolveRepoPath:(base:string, rel:string)=>string|null}} opts
 */
export function createGitHubSource(store, { owner, repo, resolveRepoPath }) {
  let bookId = null;
  const base = () => `books/${bookId}`;
  const rp = (src) => resolveRepoPath(base(), src); // books/·fonts/ 밖이면 null
  return {
    kind: "github", label: `GitHub: ${owner}/${repo}`, readOnly: false,
    listBooks: () => store.listBooks(),
    async loadBook(id) { bookId = id; return store.loadBook(id); },
    async save(path, text, sha) {
      const p = repoPath(bookId, path);
      return store.writeFile(p, text, { sha, message: `원고 저장: ${p}` });
    },
    async prepareAssets(srcs) {
      const paths = [...new Set(srcs.map(rp).filter(Boolean))];
      if (paths.length) await store.prefetch(paths);
    },
    assetUrl(src) { const p = rp(src); return p ? store.cachedAssetUrl(p) : null; },
    svgText(src) { const p = rp(src); return p ? store.readSvgCached(p) : null; },
    /** 저장소 기준 경로의 파일이 있는지(마지막으로 받은 목록 기준) */
    hasRepoFile: (p) => store.hasFile(p),
    /** 새 파일 만들기. files: 책 폴더 기준 경로 → 글자. 책 id를 주면 그 책 폴더에 */
    async createFiles(files, id = bookId) {
      for (const [rel, text] of Object.entries(files)) {
        const p = repoPath(id, rel);
        await store.writeFile(p, text, { message: `새로 만듦: ${p}` });
      }
    },
    async uploadImage(file) {
      const safe = file.name.normalize("NFC").replace(/[^\w.\-가-힣]+/g, "_");
      const src = `images/${Date.now().toString(36)}-${safe}`;
      const p = repoPath(bookId, src);
      await store.writeBinary(p, file, { message: `그림 올림: ${p}` });
      await store.prefetch([p]);
      return src;
    },
  };
}

/** 원고들과 책 설정에서 그림·글꼴 경로를 모은다(미리 받기용) */
export function collectAssetSrcs(book) {
  const out = new Set();
  const p = book.print ?? {};
  if (p.logo) out.add(p.logo);
  if (p.front?.image) out.add(p.front.image);
  if (p.fonts?.bodyFile) out.add(p.fonts.bodyFile);
  if (p.fonts?.bodyBoldFile) out.add(p.fonts.bodyBoldFile);
  for (const part of book.parts) for (const ch of part.chapters) {
    for (const m of ch.source.matchAll(/\bsrc=("([^"]+)"|[^\s}]+)/g)) out.add(m[2] ?? m[1]);
  }
  return [...out].map((s) => s.replace(/^\/books\/[^/]+\//, "images/"));
}
