// tests/*.test.mjs 를 차례로 돌린다. 하나라도 실패하면 종료 코드 1.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  console.log(`${r.status === 0 ? "통과" : "실패"}  ${f}`);
  if (r.status !== 0) failed++;
}
console.log(`\n${files.length}개 중 ${files.length - failed}개 통과`);
process.exit(failed ? 1 : 0);
