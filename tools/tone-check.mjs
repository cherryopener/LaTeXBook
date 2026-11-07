// 말투만 바꾼 원고가 내용은 그대로인지 검사한다. 메인 세션 담당.
//
//   node tools/tone-check.mjs <바꾸기 전.md> <바꾼 뒤.md>
//
// 같아야 하는 것(순서까지): 머리 부분, 제목, 수식($…$, $$…$$), 그림·상자·디렉티브 줄, 굵은 글씨(**…**), 표의 줄 수,
//                         수식 밖의 숫자
// 남으면 안 되는 것: "~요." 같은 해요체 끝말
// 결과: 다른 곳 목록(없으면 통과). 문장 표현 자체는 사람이 본다.
import fs from "node:fs";

const strip = (s) => s.replace(/\r/g, "");
function parts(src) {
  const t = strip(src);
  const fm = /^---\n[\s\S]*?\n---\n/.exec(t)?.[0] ?? "";
  const body = t.slice(fm.length);
  const display = [...body.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1].trim());
  const noDisplay = body.replace(/\$\$[\s\S]*?\$\$/g, " ");
  const inline = [...noDisplay.matchAll(/\$([^$\n]+)\$/g)].map((m) => m[1].trim());
  const plain = noDisplay.replace(/\$[^$\n]+\$/g, " ");
  return {
    "머리 부분": [fm],
    "제목": [...body.matchAll(/^#{2,6} .*$/gm)].map((m) => m[0]),
    "블록 수식": display,
    "본문 속 수식": inline,
    "그림·상자·디렉티브 줄": [...body.matchAll(/^:{2,}.*$/gm)].map((m) => m[0]),
    "굵은 글씨": [...plain.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1].replace(/\s+/g, " ").trim()),
    "표 줄 수": [String((body.match(/^\|.*\|\s*$/gm) ?? []).length)],
    "수식 밖 숫자": [...plain.replace(/\{[^}]*\}/g, " ").matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]),
  };
}

export function toneCheck(before, after) {
  const a = parts(before), b = parts(after);
  const diffs = [];
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) { diffs.push(`${k} ${i + 1}번째: 전 「${x[i] ?? "(없음)"}」 → 뒤 「${y[i] ?? "(없음)"}」`); break; }
    if (x.length !== y.length) diffs.push(`${k}: 개수 ${x.length} → ${y.length}`);
  }
  // 해요체 끝말이 남았는지(수식·코드 제외한 글자에서)
  const left = strip(after).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[^$\n]+\$/g, "")
    .split("\n").map((l, i) => [i, l]).filter(([, l]) => /[가-힣](요|죠)[.?!)\s]*($|[.?!])/.test(l) || /(요|죠)[.?!]/.test(l));
  for (const [, l] of left.slice(0, 10)) diffs.push(`해요체가 남음: ${l.trim().slice(0, 80)}`);
  return diffs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [b, a] = process.argv.slice(2);
  const d = toneCheck(fs.readFileSync(b, "utf8"), fs.readFileSync(a, "utf8"));
  if (d.length) { console.log(`다른 곳 ${d.length}개\n- ` + d.join("\n- ")); process.exit(1); }
  console.log("통과: 머리 부분·제목·수식·그림·상자·굵은 글씨·표·숫자가 같고, 해요체가 남지 않음");
}
