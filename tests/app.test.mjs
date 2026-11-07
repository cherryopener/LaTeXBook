// 앱 화면 시험(견본 책 모드): 열기 → 미리보기 → 입력하면 갱신 → 판 바꾸기 → 장 바꾸기·경고 → PDF 문서 만들기
import fs from "node:fs";
import path from "node:path";
import { openBrowser, ROOT } from "./lib/browser.mjs";

const OUT = path.join(ROOT, "out/app");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  실패"} ${msg}`); if (!ok) fails.push(msg); };

const t = await openBrowser({ port: 8808, viewport: { width: 1500, height: 950 } });
const page = await t.page("/index.html?sample=1");
const waitRender = async (after = 0) => page.waitForFunction((a) => window.__app?.lastRender?.at > a, after, { timeout: 60000 });

await page.waitForFunction(() => window.__app?.ready, null, { timeout: 60000 });
await waitRender();
let r = await page.evaluate(() => window.__app.lastRender);
check(r.pages >= 3, `처음 미리보기 ${r.pages}쪽, ${r.ms}ms`);
check(await page.locator("#book-title").textContent() === "견본 물리", "책 제목 표시");
check(await page.locator("#sel-chapter option").count() === 3, "장 목록 3개");
check((await page.locator("#save-state").textContent()).includes("견본"), "견본 책은 저장 안 됨 표시");
await page.screenshot({ path: path.join(OUT, "app-teacher.png") });

// 입력하면 미리보기가 다시 그려짐
const before = r.at;
await page.locator(".cm-content").click();
await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
await page.keyboard.insertText("\n\n추가한 문장 시험입니다.\n");
await waitRender(before);
const has = await page.evaluate(() => [...document.querySelectorAll("#preview [data-vivliostyle-page-container]")].some((p) => p.textContent.includes("추가한 문장 시험입니다")));
check(has, "입력한 문장이 미리보기에 나옴");

// 학생용
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-edition", "student");
await waitRender(r.at);
const blanks = await page.evaluate(() => document.querySelectorAll("#preview .blank.empty").length);
check(blanks >= 3, `학생용 빈칸 ${blanks}개`);
await page.screenshot({ path: path.join(OUT, "app-student.png") });

// 장 바꾸기 → 경고(그림 없음, 참조 없음)
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-chapter", "2:1");
await waitRender(r.at);
const warn = await page.locator("#btn-warn").textContent();
check(/경고 [1-9]/.test(warn), `정전기 장 경고 표시: ${warn}`);
const codes = await page.evaluate(() => window.__app.state.warnings.map((w) => w.code));
check(codes.includes("missing-image") && codes.includes("unknown-ref"), `경고 종류 ${codes.join(",")}`);

// 책 전체 미리보기
r = await page.evaluate(() => window.__app.lastRender);
await page.selectOption("#sel-scope", "book");
await waitRender(r.at);
const rb = await page.evaluate(() => window.__app.lastRender);
check(rb.pages >= 10, `책 전체 미리보기 ${rb.pages}쪽, ${rb.ms}ms`);

// 커서 위치 → 미리보기 쪽 맞춤(오류 없이 동작하는지)
await page.evaluate(() => window.__app.editor.goToLine(20));

// PDF: 안내 끄고 문서 만들기
await page.evaluate(() => { localStorage.setItem("latexbook.pdf-tip-off", "1"); });
await page.click("#btn-pdf");
await page.waitForFunction(() => window.__app.lastPdfDoc, null, { timeout: 60000 });
const docLen = await page.evaluate(() => window.__app.lastPdfDoc.length);
check(docLen > 10000, `PDF용 문서 만듦(${docLen}자)`);

check(t.errors.length === 0, `브라우저 오류 없음 ${t.errors.slice(0, 3).join(" | ")}`);
await t.close();
console.log(`\n앱 시험: ${fails.length ? `${fails.length}개 실패` : "모두 통과"} (그림: out/app/)`);
process.exit(fails.length ? 1 : 0);
