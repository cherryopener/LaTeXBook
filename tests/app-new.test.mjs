// 빈 원고 저장소에서 새 책 → 새 장 → 새 부 만들기(가짜 GitHub API)
import { openBrowser } from "./lib/browser.mjs";
import { createFakeGitHub } from "./fixtures/storage-fake-github.mjs";

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };

const fake = createFakeGitHub();
fake.setFile("LICENSE", "x\n");
fake.setFile("fonts/KoPubWorld_Batang_Light.ttf", Buffer.alloc(10));
const t = await openBrowser({ port: 8815, viewport: { width: 1400, height: 900 } });
await t.context.route("https://api.github.com/**", fake.handle);
const page = await t.page("/index.html?sample=1");
await page.waitForFunction(() => window.__app?.ready, null, { timeout: 60000 });

await page.click("#btn-github");
await page.fill("#inp-token", fake.token);
await page.click("#btn-connect");
await page.waitForFunction(() => window.__app.state.source?.kind === "github" && !document.querySelector("#banner").hidden, null, { timeout: 60000 });
check((await page.locator("#banner").textContent()).includes("아직 책이 없습니다"), "빈 저장소 안내");
check(await page.locator("#banner button", { hasText: "새 책 만들기" }).count() === 1, "새 책 만들기 단추");

// 새 책
await page.click("#banner button");
await page.fill("#new-book", "브릿지 물리");
await page.fill("#new-part", "운동과 힘");
await page.fill("#new-chapter", "속도: 정의와 \"부호\"");
await page.selectOption("#new-pal", "red");
await page.click('#dlg-new button[value="ok"]');
await page.waitForFunction(() => window.__app.book?.config?.title === "브릿지 물리" && window.__app.lastRender, null, { timeout: 60000 });
const files = [...fake.files.keys()].filter((p) => p.startsWith("books/"));
check(files.length === 3, `책 파일 3개 만듦: ${files.join(", ")}`);
const bookJson = JSON.parse(fake.files.get(files.find((p) => p.endsWith("book.json"))).toString());
check(bookJson.print.palette === "red" && bookJson.print.fonts?.bodyFile?.includes("KoPub"), "책 설정: 붉은 색, KoPub 글꼴");
const md = fake.files.get(files.find((p) => p.endsWith(".md"))).toString();
check(md.includes('title: "속도: 정의와 \\"부호\\""'), "장 제목의 따옴표·콜론이 안전하게 들어감");
check((await page.locator("#sel-chapter").textContent()).includes('1. 속도: 정의와 "부호"'), "장 목록에 새 장(따옴표 없이 제목만)");
const titleOk = await page.waitForFunction(() => [...document.querySelectorAll("#preview .chapter-title")].some((e) => e.textContent.trim() === '속도: 정의와 "부호"'), null, { timeout: 20000 }).then(() => true, () => false);
check(titleOk, "미리보기 장 제목도 따옴표 없이");

// 새 장
await page.click("#btn-add");
await page.selectOption("#new-kind", "chapter");
await page.fill("#new-chapter", "가속도");
await page.click('#dlg-new button[value="ok"]');
await page.waitForFunction(() => window.__app.book?.parts[0]?.chapters.length === 2, null, { timeout: 60000 });
check(await page.waitForFunction(() => document.querySelector("#sel-chapter").value === "1:2", null, { timeout: 20000 }).then(() => true, () => false), "새 장이 열림");

// 새 부
await page.click("#btn-add");
await page.selectOption("#new-kind", "part");
await page.fill("#new-part", "전기");
await page.fill("#new-chapter", "정전기");
await page.selectOption("#new-pal", "teal");
await page.click('#dlg-new button[value="ok"]');
await page.waitForFunction(() => window.__app.book?.parts.length === 2, null, { timeout: 60000 });
check(await page.waitForFunction(() => document.querySelector("#sel-chapter").value === "2:1", null, { timeout: 20000 }).then(() => true, () => false), "새 부의 첫 장이 열림");
const b2 = await page.evaluate(() => window.__app.book.parts[1].palette);
check(b2 === "teal", "새 부 색 청록");

const errs = t.errors.filter((e) => !/status of (404|409)/.test(e));
check(errs.length === 0, `브라우저 오류 없음 ${errs.slice(0, 3).join(" | ")}`);
await t.close();
console.log(`\n새로 만들기 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"}`);
process.exit(fails.length ? 1 : 0);
