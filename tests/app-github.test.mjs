// 앱 + GitHub 저장 시험(가짜 GitHub API). 실제 GitHub에는 요청하지 않는다.
// 연결 창에 토큰 입력 → 책 불러오기 → 미리보기(비공개 그림) → 고치고 저장 → 다른 곳에서 먼저 저장된 경우(충돌) 처리 → 토큰 유출 검사
import fs from "node:fs";
import path from "node:path";
import { openBrowser, ROOT } from "./lib/browser.mjs";
import { createFakeGitHub } from "./fixtures/storage-fake-github.mjs";

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };
const OUT = path.join(ROOT, "out/app");
fs.mkdirSync(OUT, { recursive: true });

// 가짜 저장소에 견본 책을 books/sample-book/ 으로 넣는다
const fake = createFakeGitHub();
const BD = path.join(ROOT, "samples/sample-book");
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else fake.setFile(`books/sample-book/${path.relative(BD, p).split(path.sep).join("/")}`, fs.readFileSync(p));
  }
})(BD);
fake.setFile("LICENSE", "Copyright (c) 2026 test. All rights reserved.\n");

const t = await openBrowser({ port: 8811, viewport: { width: 1500, height: 950 } });
await t.context.route("https://api.github.com/**", fake.handle);
const outside = []; // api.github.com 밖으로 나간 요청
t.context.on("request", (r) => { const u = r.url(); if (!u.startsWith("https://api.github.com/") && !u.startsWith(`http://localhost:8811/`) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u); });
const page = await t.page("/index.html?sample=1");
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.waitForFunction(() => window.__app?.ready && window.__app.lastRender, null, { timeout: 60000 });

// 연결
await page.click("#btn-github");
await page.fill("#inp-token", fake.token);
await page.click("#btn-connect");
await page.waitForFunction(() => window.__app.state.source?.kind === "github" && window.__app.book, null, { timeout: 60000 });
let r0 = await page.evaluate(() => window.__app.lastRender?.at ?? 0);
await page.waitForFunction((a) => window.__app.lastRender?.at > a, r0, { timeout: 60000 });
check((await page.locator("#source-label").textContent()).includes("GitHub"), "GitHub 출처로 바뀜");
check(await page.evaluate(() => localStorage.getItem("latexbook.github-token") !== null || Object.keys(localStorage).some((k) => k.includes("token"))), "토큰 기억(이 컴퓨터에 기억하기)");
const svgInPreview = await page.evaluate(() => !!document.querySelector("#preview figure.fig svg"));
check(svgInPreview, "비공개 저장소의 SVG 그림이 미리보기에 들어감");
await page.screenshot({ path: path.join(OUT, "app-github.png") });

// 고치고 저장
const chPath = "books/sample-book/1-mechanics/01-velocity.md";
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.insertText("\n저장 시험 문장.\n");
await page.waitForFunction(() => document.querySelector("#save-state").textContent.includes("저장 안 한"), null, { timeout: 10000 });
await page.click("#btn-save");
await page.waitForFunction(() => document.querySelector("#save-state").textContent === "저장됨", null, { timeout: 30000 });
check(fake.files.get(chPath).toString("utf8").includes("저장 시험 문장."), "저장소에 저장됨");
check(fake.commits.some((c) => (c.message ?? "").includes("원고 저장")), "커밋 메시지 한국어");

// 충돌: 다른 곳에서 먼저 저장
fake.setFile(chPath, fake.files.get(chPath).toString("utf8") + "\n다른 컴퓨터에서 쓴 문장.\n");
await page.keyboard.insertText("이 창에서 쓴 문장.\n");
await page.waitForFunction(() => document.querySelector("#save-state").textContent.includes("저장 안 한"), null, { timeout: 10000 });
await page.click("#btn-save");
await page.waitForSelector("#dlg-conflict[open]", { timeout: 30000 });
const remoteShown = await page.inputValue("#cf-remote");
check(remoteShown.includes("다른 컴퓨터에서 쓴 문장."), "충돌 창에 저장소 내용 표시");
await page.click('#dlg-conflict button[value="mine"]');
await page.waitForFunction(() => document.querySelector("#save-state").textContent === "저장됨", null, { timeout: 30000 });
const final = fake.files.get(chPath).toString("utf8");
check(final.includes("이 창에서 쓴 문장.") && !final.includes("다른 컴퓨터에서 쓴 문장."), "내 내용으로 덮어씀");

// 토큰 유출 검사
const tok = fake.token;
check(outside.every((u) => !u.includes(tok)) , "api.github.com 밖 요청 주소에 토큰 없음");
check(fake.state.requests.every((q) => !q.url.includes(tok)), "api 요청 주소에 토큰 없음");
check(logs.every((l) => !l.includes(tok)), "콘솔에 토큰 없음");
const pageText = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input")].map((i) => i.value).join(""));
check(!pageText.includes(tok), "화면·입력칸에 토큰 남지 않음");
check(fake.commits.every((c) => !JSON.stringify(c).includes(tok)), "커밋에 토큰 없음");
console.log(`  (api 밖 요청 ${outside.length}건: ${[...new Set(outside.map((u) => new URL(u).host))].join(", ")})`);

// 견본의 없는 그림(404)과 일부러 만든 충돌(409)은 브라우저가 "Failed to load resource"로 찍는 것이 정상
const errs = t.errors.filter((e) => !/Failed to load resource: the server responded with a status of (404|409)/.test(e));
check(errs.length === 0, `브라우저 오류 없음 ${errs.slice(0, 3).join(" | ")}`);
await t.close();
console.log(`\n앱+GitHub 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"}`);
process.exit(fails.length ? 1 : 0);
