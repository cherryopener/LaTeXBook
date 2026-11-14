// tests/*.test.mjs 를 차례로 돌린다. 하나라도 실패하면 종료 코드 1.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
// 시험은 글꼴·KaTeX·CodeMirror를 node_modules에서 읽는다. 설치 전에 돌리면 8개 묶음이 코드와 무관하게 실패하므로 먼저 막는다.
const root = path.join(dir, "..");
const deps = Object.keys(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).devDependencies ?? {});
const missing = deps.filter((d) => !existsSync(path.join(root, "node_modules", d, "package.json")));
if (missing.length) {
  console.error(`시험을 돌리지 않음: 의존 패키지 ${missing.length}개가 설치되지 않았습니다(${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 등" : ""}).\n먼저 저장소 폴더에서 npm ci 를 실행하세요.`);
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  console.log(`${r.status === 0 ? "통과" : "실패"}  ${f}`);
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length}개 중 ${files.length - failed}개 통과`);
process.exit(failed ? 1 : 0);
