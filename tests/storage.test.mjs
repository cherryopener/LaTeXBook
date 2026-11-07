// GitHub 저장(src/storage) 시험
// 1부: Node에서 순수 함수(경로 검사·오류 문장) 확인
// 2부: Playwright 브라우저 + 가짜 GitHub API(tests/fixtures/storage-fake-github.mjs)로 전체 동작 확인
//      (실제 GitHub에는 요청하지 않는다. 토큰은 누가 봐도 가짜인 값)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assembleBook } from "../src/book.js";
import { isRepoPath, resolveRepoPath } from "../src/storage/paths.js";
import { httpError, StorageError } from "../src/storage/errors.js";
import { openBrowser, ROOT } from "./lib/browser.mjs";
import { createFakeGitHub, gitBlobSha } from "./fixtures/storage-fake-github.mjs";

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failures.push(name);
  console.log(`  실패: ${name}${detail !== undefined ? "  → " + JSON.stringify(detail).slice(0, 600) : ""}`);
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const hangul = /[가-힣]/;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const TOKEN = "github_pat_TEST_FAKE_0000000000000000000000";
const WRONG = "github_pat_TEST_WRONG_1111111111111111111111";
const ALL_TOKENS = [TOKEN, WRONG];

// ───────────── 1부: 순수 함수 ─────────────
for (const p of ["books/x/book.json", "books/x/1-a/01-b.md", "fonts/a.ttf", "books/한글 책/1-부/01-장.md"]) check(`경로 허용: ${p}`, isRepoPath(p));
for (const p of ["", "books", "books/", "../x", "books/../x", "books/x/../../etc", "/books/x", "books//x", "books/./x", "other/x.md", "books\\x", "books/x\u0000", "books/.git/config", "src/app.js", null, 3])
  check(`경로 거부: ${JSON.stringify(p)}`, !isRepoPath(p));
eq("resolve: 그림", resolveRepoPath("books/x", "images/a.svg"), "books/x/images/a.svg");
eq("resolve: 글꼴(../../fonts)", resolveRepoPath("books/x", "../../fonts/K.ttf"), "fonts/K.ttf");
eq("resolve: ./ 정리", resolveRepoPath("books/x", "./images/./a.svg"), "books/x/images/a.svg");
eq("resolve: 저장소 밖으로 나가면 null", resolveRepoPath("books/x", "../../../etc/passwd"), null);
eq("resolve: books/fonts 밖이면 null", resolveRepoPath("books/x", "../../src/app.js"), null);
eq("resolve: 주소면 null", resolveRepoPath("books/x", "https://evil.example/a.png"), null);
eq("resolve: //주소면 null", resolveRepoPath("books/x", "//evil.example/a.png"), null);
eq("resolve: 앞 / 는 저장소 기준", resolveRepoPath("books/x", "/books/y/images/a.png"), "books/y/images/a.png");

const he = (status, headers = {}) => httpError(status, new Headers(headers), "books/x/a.md");
check("오류 401 한국어", he(401) instanceof StorageError && /토큰/.test(he(401).message) && hangul.test(he(401).message));
check("오류 403 권한", /권한/.test(he(403).message) && he(403).kind === "forbidden");
check("오류 403 한도(남은 시간 분)", /한도/.test(he(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) }).message) && /10분/.test(he(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) }).message));
check("오류 403 보조 한도(retry-after)", /한도/.test(he(403, { "retry-after": "30" }).message) && /30초/.test(he(403, { "retry-after": "30" }).message));
check("오류 429 한도", he(429).kind === "ratelimit");
check("오류 404", /찾을 수 없/.test(he(404).message) && he(404).kind === "notfound");
check("오류 500", he(502).kind === "server");

// ───────────── 2부: 브라우저 ─────────────
const fake = createFakeGitHub({ token: TOKEN });
const SAMPLE = path.join(ROOT, "samples/sample-book");
const walk = (dir, rel = "") => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
const sampleFiles = {};
for (const rel of walk(SAMPLE)) {
  const buf = fs.readFileSync(path.join(SAMPLE, rel));
  fake.setFile(`books/sample-book/${rel}`, buf);
  if (/\.(json|md)$/.test(rel)) sampleFiles[rel] = buf.toString("utf8");
}
const expectBook = assembleBook("sample-book", sampleFiles);
const sampleTitle = JSON.parse(sampleFiles["book.json"]).title;
fake.setFile("books/other-book/book.json", JSON.stringify({ title: "다른 책 — 한글 제목" }));
fake.setFile("books/other-book/1-부/part.json", JSON.stringify({ title: "부" }));
fake.setFile("books/other-book/1-부/01-장.md", "# 장\n");
fake.setFile("books/no-json-book/README.txt", "book.json 없는 폴더");
const FONT = "fonts/Test-Font.ttf";
const fontBytes = crypto.randomBytes(12 * 1024 * 1024);
fake.setFile(FONT, fontBytes);
fake.setFile("README.md", "저장소 루트 파일(books/fonts 밖)");

const t = await openBrowser({ port: 8807 });
const consoleLines = [];     // 모든 console 출력
const thrown = [];           // 시험 중 받은 모든 오류 문장
const reqs = [];             // 모든 요청
const attach = (p) => {
  p.on("console", (m) => consoleLines.push(m.text()));
  p.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`));
};
t.context.on("page", attach);
t.context.on("request", (r) => reqs.push(r));
await t.context.route("https://api.github.com/**", fake.handle);
await t.context.addCookies([{ name: "sid", value: "COOKIE_SECRET_VALUE", url: "https://api.github.com" }]);

async function open() {
  const page = await t.page("/tests/pages/storage-test.html");
  await page.waitForFunction(() => window.__ready === true);
  return page;
}
/** page.evaluate 결과가 attempt 모양이면 오류 문장을 모아 둔다 */
const note = (r) => { if (r && r.ok === false) thrown.push(r.message); return r; };
const mk = (page, token = TOKEN, repo = "textbooks") =>
  page.evaluate(({ token, repo }) => { window.store = window.S.createGitHubStore({ owner: "cherryopener", repo, token }); }, { token, repo });

try {
  let page = await open();
  await mk(page);

  // ── listBooks ──
  fake.state.delayMs = 40;
  let r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("listBooks 성공", r.ok, r);
  eq("listBooks 결과", r.value, [
    { id: "no-json-book", title: "no-json-book" },
    { id: "other-book", title: "다른 책 — 한글 제목" },
    { id: "sample-book", title: sampleTitle },
  ]);
  check("listBooks: 트리 1번 + book.json 2번 이내", fake.count(/git\/trees/) === 1 && fake.count(/git\/blobs/) === 2, fake.state.requests.map((q) => q.url));

  // ── loadBook: Node의 assembleBook과 같은 결과 ──
  await mk(page); // 새 store: 글자 캐시가 비어 있는 상태
  fake.resetLog();
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("sample-book"))));
  check("loadBook 성공", r.ok, r);
  const got = r.value;
  const stripSha = (b) => JSON.parse(JSON.stringify(b, (k, v) => (k === "sha" ? undefined : v)));
  eq("loadBook == assembleBook(Node)", stripSha(got), stripSha(expectBook));
  const chaptersOk = got.parts.every((p) => p.chapters.every((c) => c.sha === fake.shaOf(`books/sample-book/${c.path}`)));
  check("각 장에 sha가 채워짐(git blob sha와 일치)", chaptersOk && got.parts.length === 2 && got.parts[0].chapters.length === 2, got.parts.map((p) => p.chapters.map((c) => c.sha)));
  const nText = Object.keys(sampleFiles).length;
  check(`loadBook 요청 수: 트리 1 + 원고 ${nText}`, fake.count(/git\/trees/) === 1 && fake.count(/git\/blobs/) === nText && fake.count() === nText + 1, fake.count());
  check("동시 요청 2~6개(제한)", fake.state.maxInflight >= 2 && fake.state.maxInflight <= 6, fake.state.maxInflight);
  fake.state.delayMs = 0;
  fake.resetLog();
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("sample-book"))));
  check("다시 불러오면 트리만(원고는 sha 캐시)", r.ok && fake.count() === 1, fake.count());
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("없는-책"))));
  check("없는 책 → 한국어 오류", !r.ok && r.kind === "notfound" && hangul.test(r.message), r);
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("no-json-book"))));
  check("book.json 없는 폴더 → 한국어 오류", !r.ok && /book\.json/.test(r.message), r);
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("../fonts"))));
  check("loadBook 경로 조작 거부", !r.ok && r.kind === "path", r);

  // 트리가 잘리는 큰 저장소(truncated)도 폴더별로 모아서 같은 결과
  fake.state.truncateRecursive = true;
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("sample-book"))));
  eq("트리 truncated 대체 경로: 같은 결과", r.ok && stripSha(r.value), stripSha(expectBook));
  fake.state.truncateRecursive = false;

  // ── 한글 왕복·커밋 메시지·토큰 비노출 ──
  const P1 = "books/sample-book/1-mechanics/99-쓰기시험.md";
  const KO = "# 제목 — 한글 😀 𠮷 ㅋㅋ\r\n둘째 줄\n\n수식 $x^2$ 끝";
  fake.resetLog();
  r = note(await page.evaluate(({ p, text }) => window.attempt(() => window.store.writeFile(p, text, { message: "" })), { p: P1, text: KO }));
  check("새 파일 쓰기(sha 없이)", r.ok && r.value.sha === fake.shaOf(P1), r);
  check("저장소의 바이트가 UTF-8 그대로", fake.files.get(P1)?.toString("utf8") === KO);
  eq("기본 커밋 메시지(한국어)", fake.commits.at(-1)?.message, `원고 저장: ${P1}`);
  const sha1 = r.value?.sha;
  r = note(await page.evaluate(({ p }) => window.attempt(() => window.store.readFile(p)), { p: P1 }));
  eq("한글 원고 읽기 == 쓴 것", r.ok && r.value, { text: KO, sha: sha1 });
  r = note(await page.evaluate(({ p, token }) => window.attempt(() => window.store.writeFile(p, "고친 글", { message: "수정 " + token })), { p: P1, token: TOKEN }));
  check("기존 파일에 sha 없이 쓰기 → ConflictError", !r.ok && r.isConflict && r.remote?.text === KO && r.remote?.sha === sha1, r);
  r = note(await page.evaluate(({ p, sha, token }) => window.attempt(() => window.store.writeFile(p, "고친 글", { sha, message: "수정 " + token })), { p: P1, sha: sha1, token: TOKEN }));
  check("sha 맞으면 갱신됨", r.ok && r.value.sha === fake.shaOf(P1) && r.value.sha !== sha1, r);
  check("커밋 메시지에서 토큰이 지워짐", !fake.commits.at(-1).message.includes(TOKEN) && fake.commits.at(-1).message.startsWith("수정"), fake.commits.at(-1));
  const sha2 = r.value?.sha;

  // ── 충돌: 다른 곳에서 먼저 저장 ──
  fake.setFile(P1, "다른 컴퓨터에서 먼저 저장한 글 🌏");
  const remoteSha = fake.shaOf(P1);
  r = note(await page.evaluate(({ p, sha }) => window.attempt(() => window.store.writeFile(p, "내 수정", { sha, message: "m" })), { p: P1, sha: sha2 }));
  check("ConflictError(이름·remote 내용·sha)", !r.ok && r.isConflict && r.name === "ConflictError" && r.remote?.text === "다른 컴퓨터에서 먼저 저장한 글 🌏" && r.remote?.sha === remoteSha && hangul.test(r.message), r);
  check("충돌 때 원격 파일은 덮어쓰이지 않음", fake.files.get(P1).toString("utf8") === "다른 컴퓨터에서 먼저 저장한 글 🌏");
  // 충돌을 받아들여 remote.sha로 다시 저장하면 성공
  r = note(await page.evaluate(({ p, sha }) => window.attempt(() => window.store.writeFile(p, "합친 글", { sha, message: "합침" })), { p: P1, sha: remoteSha }));
  check("remote.sha로 다시 저장하면 성공", r.ok && fake.files.get(P1).toString("utf8") === "합친 글", r);
  // 같은 브랜치에 다른 커밋이 겹친 409(파일은 그대로) → 자동으로 다시 시도
  fake.resetLog();
  fake.state.putConflictOnce = 1;
  r = note(await page.evaluate(({ p, sha }) => window.attempt(() => window.store.writeFile(p, "겹침 뒤 저장", { sha, message: "겹침" })), { p: P1, sha: fake.shaOf(P1) }));
  check("브랜치 겹침 409는 충돌이 아니라 재시도로 성공", r.ok && fake.count(/PUT/) === 2 && fake.files.get(P1).toString("utf8") === "겹침 뒤 저장", { r, puts: fake.count(/PUT/) });
  // 동시에 여러 번 저장해도 한 줄로 처리됨(자기 자신과 부딪히지 않음)
  fake.setFile("books/sample-book/1-mechanics/97-동시.md", "0");
  const s0 = fake.shaOf("books/sample-book/1-mechanics/97-동시.md");
  r = note(await page.evaluate(async ({ s0 }) => {
    const a = window.attempt(() => window.store.writeFile("books/sample-book/1-mechanics/97-동시.md", "A", { sha: s0, message: "A" }));
    const b = window.attempt(() => window.store.writeFile("books/sample-book/1-mechanics/96-동시.md", "B", { message: "B" }));
    const c = window.attempt(() => window.store.writeFile("books/sample-book/1-mechanics/95-동시.md", "C", { message: "C" }));
    return window.attempt(async () => (await Promise.all([a, b, c])).map((x) => x.ok));
  }, { s0 }));
  eq("동시 저장 3건 모두 성공", r.ok && r.value, [true, true, true]);

  // ── 1MB 넘는 파일 읽기 ──
  const BIG = "books/sample-book/1-mechanics/98-큰원고.md";
  const bigText = "한글과 English와 😀 이모지를 섞은 아주 긴 줄입니다.\n".repeat(30000); // 약 2MB+
  fake.setFile(BIG, bigText);
  check("큰 원고가 1MB를 넘음(시험 전제)", fake.files.get(BIG).length > 1_000_000, fake.files.get(BIG).length);
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const x = await window.store.readFile(p); return { len: x.text.length, sha: x.sha, head: x.text.slice(0, 30), tail: x.text.slice(-30), digest: await window.sha256(x.text) }; }), { p: BIG }));
  check("1MB 넘는 원고 읽기(글자 수·끝 글자·sha 일치)", r.ok && r.value.len === bigText.length && r.value.tail === bigText.slice(-30) && r.value.sha === fake.shaOf(BIG) && r.value.digest === sha256(bigText), r);
  check("큰 파일은 contents(object)+blobs(raw)로 받음", fake.state.requests.some((q) => /vnd\.github\.object/.test(q.headers.accept)) && fake.state.requests.some((q) => /git\/blobs/.test(q.url) && /vnd\.github\.raw/.test(q.headers.accept)), fake.state.requests.map((q) => q.url + " " + q.headers.accept));
  const BIGBIN = "books/sample-book/images/큰그림.bin";
  const bigBin = crypto.randomBytes(3 * 1024 * 1024 + 17);
  fake.setFile(BIGBIN, bigBin);
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const x = await window.store.readBinary(p); return { size: x.blob.size, sha: x.sha, digest: await window.sha256(x.blob) }; }), { p: BIGBIN }));
  check("1MB 넘는 바이너리 읽기", r.ok && r.value.size === bigBin.length && r.value.digest === sha256(bigBin) && r.value.sha === fake.shaOf(BIGBIN), r);
  // object 형식을 못 쓰는 경우(403) 파일 목록에서 sha를 찾아 받음
  fake.state.objectUnsupported = true;
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const x = await window.store.readBinary(p); return { size: x.blob.size, digest: await window.sha256(x.blob) }; }), { p: BIGBIN }));
  check("대체 경로(403 → 트리에서 sha)로도 읽힘", r.ok && r.value.digest === sha256(bigBin) && fake.count(/git\/trees/) === 1, { r, n: fake.count(/git\/trees/) });
  fake.state.objectUnsupported = false;

  // ── 그림 올리기(writeBinary) ──
  const IMG = "books/sample-book/images/올린-그림.png";
  const upBytes = crypto.randomBytes(5 * 1024 * 1024);
  fake.resetLog();
  r = note(await page.evaluate(async ({ p, b64 }) => window.attempt(async () => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return window.store.writeBinary(p, new Blob([u8], { type: "image/png" }), { message: "그림 올림" });
  }), { p: IMG, b64: upBytes.toString("base64") }));
  check("5MB 그림 올리기 → 저장소 바이트 일치", r.ok && Buffer.compare(fake.files.get(IMG) ?? Buffer.alloc(0), upBytes) === 0 && r.value.sha === gitBlobSha(upBytes), r);
  eq("그림 커밋 메시지", fake.commits.at(-1).message, "그림 올림");
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const u = await window.store.assetUrl(p); const b = await (await fetch(u)).blob(); return { u: u.startsWith("blob:"), size: b.size, type: b.type }; }), { p: IMG }));
  check("방금 올린 그림은 다시 받지 않고 바로 쓸 수 있음", r.ok && r.value.u && r.value.size === upBytes.length && r.value.type === "image/png" && fake.count() === 0, { r, n: fake.count() });
  r = note(await page.evaluate(({ p }) => window.attempt(() => window.store.writeBinary(p, new Blob([new Uint8Array([1, 2, 3])]), { message: "중복" })), { p: IMG }));
  check("같은 이름 그림을 sha 없이 올리면 ConflictError", !r.ok && r.isConflict && r.remote?.sha === fake.shaOf(IMG), r);
  fake.resetLog();
  r = note(await page.evaluate(() => window.attempt(() => window.store.writeBinary("books/sample-book/images/huge.bin", new Blob([new Uint8Array(51 * 1024 * 1024)]), { message: "x" }))));
  check("너무 큰 파일은 요청 없이 거부", !r.ok && r.kind === "toolarge" && hangul.test(r.message) && fake.count() === 0, r);

  // ── 경로 조작 거부(요청도 나가지 않음) ──
  fake.resetLog();
  const bad = ["../x", "books/../README.md", "books//a.md", "/books/a.md", "README.md", "src/app.js", "books", "books\\a.md", "books/x/../../README.md"];
  for (const p of bad) {
    const res = await page.evaluate(async ({ p }) => {
      const s = window.store, b = new Blob(["x"]);
      const out = [];
      for (const f of [() => s.readFile(p), () => s.readBinary(p), () => s.assetUrl(p), () => s.writeFile(p, "x", { message: "m" }), () => s.writeBinary(p, b, { message: "m" })]) out.push((await window.attempt(f)));
      return out;
    }, { p });
    res.forEach((x) => thrown.push(x.message ?? ""));
    check(`경로 거부: ${p}`, res.every((x) => !x.ok && x.kind === "path" && hangul.test(x.message)), res);
  }
  check("경로 거부 때 네트워크 요청 없음", fake.count() === 0, fake.count());

  // ── SVG 미리 받기·동기 조회 ──
  const SV1 = "books/sample-book/images/charges.svg", SV2 = "books/sample-book/images/number-line.svg", NOPE = "books/sample-book/images/nope.svg";
  await page.close(); page = await open(); await mk(page);
  r = await page.evaluate(({ a }) => ({ svg: window.store.readSvgCached(a), url: window.store.cachedAssetUrl(a) }), { a: SV1 });
  check("prefetch 전에는 null", r.svg === null && r.url === null, r);
  fake.resetLog();
  r = note(await page.evaluate(({ a, b, c }) => window.attempt(async () => {
    const res = await window.store.prefetch([a, b, c, a]);
    const img = new Image(); img.src = window.store.cachedAssetUrl(a); await img.decode();
    return { res, svgA: window.store.readSvgCached(a), svgB: window.store.readSvgCached(b), svgC: window.store.readSvgCached(c), urlA: window.store.cachedAssetUrl(a), w: img.naturalWidth };
  }), { a: SV1, b: SV2, c: NOPE }));
  check("prefetch: ok/missing 분류", r.ok && r.value.res.ok.sort().join() === [SV1, SV2].sort().join() && r.value.res.missing.join() === NOPE, r);
  check("readSvgCached: 원문 그대로", r.ok && r.value.svgA === fake.files.get(SV1).toString("utf8") && r.value.svgB === fake.files.get(SV2).toString("utf8") && r.value.svgC === null);
  check("cachedAssetUrl: blob 주소이고 <img>로 그려짐(MIME 정상)", r.ok && r.value.urlA?.startsWith("blob:") && r.value.w > 0, r.value);
  check("prefetch는 중복 없이 파일마다 1~2번 요청", fake.count() <= 2 * 3 + 1, fake.count());

  // ── assetUrl 캐시: 12MB 글꼴 ──
  const fontDigest = sha256(fontBytes);
  await page.close(); page = await open(); await mk(page);
  await page.evaluate(() => window.store.loadBook("sample-book"));
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => {
    const u1 = await window.store.assetUrl(p);
    const b = await (await fetch(u1)).arrayBuffer();
    return { u1, len: b.byteLength, digest: await window.sha256(new Uint8Array(b)) };
  }), { p: FONT }));
  check("글꼴 첫 요청: 내려받음(12MB 일치)", r.ok && r.value.len === fontBytes.length && r.value.digest === fontDigest && fake.count(/git\/blobs/) === 1, { r: r.ok ? r.value.len : r, n: fake.count() });
  const u1 = r.value?.u1;
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => ({ u2: await window.store.assetUrl(p), sync: window.store.cachedAssetUrl(p) })), { p: FONT }));
  check("같은 세션 두 번째: 네트워크 요청 없음, 같은 주소", r.ok && r.value.u2 === u1 && r.value.sync === u1 && fake.count() === 0, { r, n: fake.count() });
  // 새로고침 → 새 세션: IndexedDB에서
  await page.reload(); await page.waitForFunction(() => window.__ready === true); await mk(page);
  await page.evaluate(() => window.store.loadBook("sample-book")); // 트리(파일 sha 목록)만 받음
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => {
    const u = await window.store.assetUrl(p);
    const b = await (await fetch(u)).arrayBuffer();
    return { len: b.byteLength, digest: await window.sha256(new Uint8Array(b)) };
  }), { p: FONT }));
  check("새로고침 뒤: IndexedDB에서 꺼냄(요청 0, 내용 일치)", r.ok && r.value.digest === fontDigest && fake.count() === 0, { r, n: fake.count() });
  // loadBook 없이 처음 부르면: 정보 요청 1번(내용은 IndexedDB)
  await page.reload(); await page.waitForFunction(() => window.__ready === true); await mk(page);
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const u = await window.store.assetUrl(p); return (await (await fetch(u)).arrayBuffer()).byteLength; }), { p: FONT }));
  check("트리 없이도 정보 1번만 묻고 내용은 IndexedDB", r.ok && r.value === fontBytes.length && fake.count() === 1 && fake.count(/git\/blobs/) === 0 && fake.count(/contents/) === 1, { r, n: fake.count(), urls: fake.state.requests.map((q) => q.url) });
  // 글꼴이 바뀌면(sha가 달라지면) 새로 받음
  const font2 = crypto.randomBytes(2 * 1024 * 1024);
  fake.setFile(FONT, font2);
  await page.evaluate(() => window.store.loadBook("sample-book"));
  fake.resetLog();
  r = note(await page.evaluate(({ p }) => window.attempt(async () => { const u = await window.store.assetUrl(p); const b = await (await fetch(u)).arrayBuffer(); return { len: b.byteLength, digest: await window.sha256(new Uint8Array(b)) }; }), { p: FONT }));
  check("파일이 바뀌면 새 sha로 다시 받음", r.ok && r.value.digest === sha256(font2) && fake.count(/git\/blobs/) === 1, { r, n: fake.count() });
  const idbScan = await page.evaluate(({ tokens }) => window.scanIdb(tokens), { tokens: ALL_TOKENS });
  check("캐시 IndexedDB에 assets·assetMeta가 있음", idbScan.stores.assets >= 1 && idbScan.stores.assetMeta >= 1, idbScan);

  // ── 오류 문장 ──
  fake.state.requests.length = 0;
  // 401: 틀린 토큰
  await mk(page, WRONG);
  r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("401 → 토큰 안내, 본문(토큰 반사)을 보이지 않음", !r.ok && r.kind === "auth" && r.status === 401 && /토큰/.test(r.message) && hangul.test(r.message) && !r.message.includes(WRONG) && !/Bad credentials/.test(r.message), r);
  await mk(page);
  // 403: 한도 초과(남은 시간)
  fake.state.rateLimitResetAt = Math.floor(Date.now() / 1000) + 5 * 60;
  r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("403 한도 초과 → 남은 시간(분) 안내", !r.ok && r.kind === "ratelimit" && /한도/.test(r.message) && /[45]분/.test(r.message), r);
  fake.state.rateLimitResetAt = null;
  // 403: 쓰기 권한 없는 토큰
  fake.state.readOnly = true;
  r = note(await page.evaluate(({ p }) => window.attempt(() => window.store.writeFile(p, "x", { message: "m" })), { p: "books/sample-book/1-mechanics/94-권한.md" }));
  check("403 쓰기 권한 없음 → 권한 안내", !r.ok && r.kind === "forbidden" && /권한/.test(r.message) && !/Resource not accessible/.test(r.message), r);
  fake.state.readOnly = false;
  // 404: 저장소가 없음 / 파일이 없음
  await mk(page, TOKEN, "no-such-repo");
  r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("404 저장소 없음 → 한국어", !r.ok && r.kind === "notfound" && /찾을 수 없/.test(r.message), r);
  await mk(page);
  r = note(await page.evaluate(() => window.attempt(() => window.store.readFile("books/sample-book/1-mechanics/00-없는파일.md"))));
  check("404 파일 없음 → 한국어", !r.ok && r.kind === "notfound" && /찾을 수 없/.test(r.message), r);
  r = note(await page.evaluate(() => window.attempt(() => window.store.assetUrl("books/sample-book/images/없음.png"))));
  check("404 그림 없음 → 한국어", !r.ok && r.kind === "notfound", r);
  // 5xx: 한 번은 자동 재시도, 계속이면 오류
  fake.state.serverError = 1;
  r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("503 한 번은 자동 재시도로 성공", r.ok, r);
  fake.state.serverError = 5;
  r = note(await page.evaluate(() => window.attempt(() => window.store.listBooks())));
  check("503 계속되면 서버 문제 안내", !r.ok && r.kind === "server" && /서버/.test(r.message), r);
  fake.state.serverError = 0;
  // 네트워크 끊김
  fake.state.offline = true;
  r = note(await page.evaluate(() => window.attempt(() => window.store.loadBook("sample-book"))));
  check("네트워크 끊김 → 연결 안내", !r.ok && r.kind === "network" && /연결/.test(r.message) && hangul.test(r.message), r);
  r = note(await page.evaluate(({ p }) => window.attempt(() => window.store.writeFile(p, "x", { message: "m" })), { p: "books/sample-book/1-mechanics/93-끊김.md" }));
  check("끊김: 쓰기도 한국어 오류", !r.ok && r.kind === "network", r);
  fake.state.offline = false;
  // 토큰 글자 오류
  r = note(await page.evaluate(() => window.attempt(async () => window.S.createGitHubStore({ owner: "a", repo: "b", token: "bad token\nwith space" }))));
  check("토큰에 공백·줄바꿈 → 한국어 오류(토큰 비노출)", !r.ok && hangul.test(r.message) && !r.message.includes("bad token"), r);
  r = note(await page.evaluate(() => window.attempt(async () => window.S.createGitHubStore({ owner: "a/../b", repo: "b", token: "github_pat_TEST_x1234567" }))));
  check("저장소 이름 검사", !r.ok && hangul.test(r.message), r);

  // ── 토큰 보관 ──
  await page.reload(); await page.waitForFunction(() => window.__ready === true);
  const K = "latexbook.github-token";
  const tok = await page.evaluate(({ K, TOKEN }) => {
    const out = {}; const S = window.S;
    const st = () => ({ local: localStorage.getItem(K), session: sessionStorage.getItem(K), load: S.loadToken() });
    out.start = st();
    S.saveToken("  " + TOKEN + " \n", true); out.remember = st();
    S.saveToken(TOKEN, false); out.session = st();
    S.saveToken(TOKEN, true); S.clearToken(); out.cleared = st();
    try { S.saveToken("   ", true); out.empty = "no error"; } catch (e) { out.empty = e.message; }
    S.saveToken(TOKEN, true); // 마지막에 기억 상태로(새로고침 뒤 확인)
    return out;
  }, { K, TOKEN });
  eq("처음엔 비어 있음", tok.start, { local: null, session: null, load: null });
  eq("remember=참 → localStorage(공백 제거)", tok.remember, { local: TOKEN, session: null, load: TOKEN });
  eq("remember=거짓 → sessionStorage, localStorage에서 삭제", tok.session, { local: null, session: TOKEN, load: TOKEN });
  eq("clearToken", tok.cleared, { local: null, session: null, load: null });
  check("빈 토큰은 한국어 오류", hangul.test(tok.empty), tok.empty);
  await page.reload(); await page.waitForFunction(() => window.__ready === true);
  eq("remember=참은 새로고침 뒤에도 남음", await page.evaluate(() => window.S.loadToken()), TOKEN);
  const sessPage = await open(); // 같은 브라우저의 새 탭: sessionStorage는 비어 있고 localStorage는 공유
  eq("새 탭에서도 remember=참 토큰은 보임", await sessPage.evaluate(() => window.S.loadToken()), TOKEN);
  await sessPage.evaluate(() => { window.S.saveToken("github_pat_TEST_SESSION_ONLY_222222", false); });
  eq("remember=거짓: 다른 탭의 sessionStorage에는 안 보임", await page.evaluate(() => sessionStorage.getItem("latexbook.github-token")), null);
  await sessPage.evaluate(() => window.S.clearToken());
  await sessPage.close();

  // ── 임시 저장 ──
  const D1 = "books/sample-book/1-mechanics/01-velocity.md";
  const ds = await page.evaluate(async ({ D1 }) => {
    const S = window.S; const out = {};
    out.none = await S.loadDraft(D1);
    const t0 = Date.now();
    await S.saveDraft(D1, "임시 저장한 한글 원고 😀");
    const a = await S.loadDraft(D1);
    out.a = { text: a.text, recent: a.savedAt >= t0 && a.savedAt <= Date.now() };
    await new Promise((ok) => setTimeout(ok, 5));
    await S.saveDraft(D1, "두 번째");
    await new Promise((ok) => setTimeout(ok, 5));
    await S.saveDraft("books/sample-book/2-electricity/01-charge.md", "다른 장");
    out.b = (await S.loadDraft(D1)).text;
    out.list = (await S.listDrafts()).map((x) => x.path);
    await S.saveDraft("books/sample-book/1-mechanics/03-big.md", "가".repeat(300000));
    out.big = (await S.loadDraft("books/sample-book/1-mechanics/03-big.md")).text.length;
    await S.clearDraft("books/sample-book/1-mechanics/03-big.md");
    out.afterBigClear = await S.loadDraft("books/sample-book/1-mechanics/03-big.md");
    return out;
  }, { D1 });
  eq("임시 저장 없음 → null", ds.none, null);
  eq("saveDraft → loadDraft(글자·시각)", ds.a, { text: "임시 저장한 한글 원고 😀", recent: true });
  eq("덮어쓰기", ds.b, "두 번째");
  eq("목록(최근 먼저)", ds.list, ["books/sample-book/2-electricity/01-charge.md", D1]);
  eq("큰 임시 저장(30만 자)", ds.big, 300000);
  eq("clearDraft 뒤 null", ds.afterBigClear, null);
  await page.reload(); await page.waitForFunction(() => window.__ready === true);
  eq("새로고침 뒤에도 임시 저장이 남음", await page.evaluate(async ({ D1 }) => (await window.S.loadDraft(D1))?.text, { D1 }), "두 번째");
  await page.evaluate(async ({ D1 }) => { await window.S.clearDraft(D1); await window.S.clearDraft("books/sample-book/2-electricity/01-charge.md"); }, { D1 });
  eq("모두 지운 뒤 목록 비어 있음", await page.evaluate(() => window.S.listDrafts()), []);
  await page.evaluate(() => window.S.saveDraft("books/sample-book/1-mechanics/01-velocity.md", "토큰 검사용 임시 글"));

  // ───────────── 토큰 유출 검사 ─────────────
  // 토큰을 쓰는 동작을 한 번 더 크게 돌려 본 뒤, 모은 모든 요청·출력·저장소를 훑는다.
  await page.evaluate((tk) => window.S.saveToken(tk, true), TOKEN);
  await mk(page);
  await page.evaluate(async () => { const b = await window.store.loadBook("sample-book"); await window.store.prefetch(["books/sample-book/images/logo.svg"]); return b.id; });
  await page.evaluate(() => window.attempt(() => window.store.writeFile("books/sample-book/1-mechanics/92-유출검사.md", "x", { message: "유출 검사" })));

  const seen = await Promise.all(reqs.map(async (rq) => {
    let headers;
    try { headers = await Promise.race([rq.allHeaders(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 2000))]); } catch { headers = rq.headers(); }
    let body = null;
    try { body = rq.postData(); } catch { /* 이진 */ }
    return { url: rq.url(), headers, body };
  }));
  const apiReqs = seen.filter((q) => new URL(q.url).origin === "https://api.github.com");
  const other = seen.filter((q) => new URL(q.url).origin !== "https://api.github.com");
  check("요청이 충분히 모임(검사 대상)", apiReqs.length > 50 && other.length > 0, { api: apiReqs.length, other: other.length });
  check("api.github.com 밖으로 나간 요청: 로컬 시험 서버뿐", other.every((q) => new URL(q.url).hostname === "localhost"), other.map((q) => q.url).filter((u) => !u.startsWith("http://localhost")));
  const mentions = (s) => ALL_TOKENS.some((tk) => String(s ?? "").includes(tk));
  check("api 밖 요청의 URL·머리글·본문에 토큰 없음", other.every((q) => !mentions(q.url) && !mentions(JSON.stringify(q.headers)) && !mentions(q.body)));
  check("api 요청: URL·본문에 토큰 없음", apiReqs.every((q) => !mentions(q.url) && !mentions(q.body)), apiReqs.filter((q) => mentions(q.url) || mentions(q.body)).map((q) => q.url));
  check("api 요청: 토큰은 Authorization 머리글에만", apiReqs.every((q) => Object.entries(q.headers).every(([k, v]) => k.toLowerCase() === "authorization" || !mentions(v))));
  check("api 요청: Authorization은 Bearer 형식", apiReqs.every((q) => !q.headers.authorization || /^Bearer github_pat_TEST_/.test(q.headers.authorization)));
  check("api 요청: Referer·Cookie 없음(no-referrer, credentials omit)", apiReqs.every((q) => !("referer" in q.headers) && !("cookie" in q.headers)), apiReqs.filter((q) => q.headers.referer || q.headers.cookie).map((q) => q.headers));
  check("api 요청: X-GitHub-Api-Version 헤더", apiReqs.every((q) => q.headers["x-github-api-version"] === "2022-11-28"));
  check("콘솔·pageerror 출력에 토큰 없음", !consoleLines.some(mentions), consoleLines.filter(mentions));
  check("콘솔에 저장 모듈의 출력이 없음(오류 제외)", consoleLines.every((l) => !/storage|github/i.test(l) || /Failed to load resource|net::ERR/.test(l)), consoleLines);
  check("받은 모든 오류 문장에 토큰·서버 본문 없음", thrown.length > 20 && !thrown.some(mentions) && !thrown.some((m) => /Bad credentials|Resource not accessible|rate limit exceeded|documentation_url/.test(m)), { n: thrown.length, bad: thrown.filter(mentions) });
  check("받은 모든 오류 문장이 한국어", thrown.filter((m) => m).every((m) => hangul.test(m)), thrown.filter((m) => m && !hangul.test(m)));
  check("커밋 메시지에 토큰 없음", fake.commits.every((c) => !mentions(c.message)));
  check("원고 저장소 파일 내용에 토큰 없음", [...fake.files.values()].every((b) => b.length > 1e6 || !mentions(b.toString("utf8"))));
  const scan = await page.evaluate(({ tokens }) => window.scanIdb(tokens), { tokens: ALL_TOKENS });
  check("IndexedDB(캐시·임시 저장)에 토큰 없음", scan.hits.length === 0 && scan.stores.drafts >= 1 && scan.stores.assets >= 1, scan);
  const ls = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), html: document.documentElement.outerHTML }));
  const other_ls = [...ls.local, ...ls.session].filter(([k]) => k !== "latexbook.github-token");
  check("localStorage·sessionStorage: 토큰 키 말고는 토큰 없음", other_ls.every(([k, v]) => !mentions(k) && !mentions(v)), other_ls);
  check("localStorage 토큰 키 값은 입력한 토큰 그대로", ls.local.find(([k]) => k === "latexbook.github-token")?.[1] === TOKEN);
  check("화면(DOM)에 토큰 없음", !mentions(ls.html));
  await page.evaluate(() => window.S.clearToken());
} catch (e) {
  failures.push("시험 중 예외: " + (e?.stack ?? e));
  console.log(e);
} finally {
  await t.close();
}

if (t.errors.length) {
  // 시험 페이지 자체의 pageerror 등. (의도한 네트워크 실패의 콘솔 오류는 제외)
  const real = t.errors.filter((e) => !/Failed to load resource|net::ERR|status of (4|5)\d\d/.test(e));
  check("시험 페이지에 예상 밖의 오류 없음", real.length === 0, real);
}

console.log(`\nstorage 시험: ${passed}개 통과, ${failures.length}개 실패`);
if (failures.length) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
