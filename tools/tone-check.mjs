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
  const diffs = [], toneBold = [];
  // 굵은 글씨 안의 문장 끝(마지막 낱말의 끝말)은 바뀌어도 된다: "**밀어내요.**" → "**밀어낸다.**"
  // 마지막 낱말 앞부분이 같고, 마지막 낱말의 첫 글자 첫소리가 같고, 바뀐 쪽이 "-다"류로 끝날 때만
  const cho = (ch) => { const c = ch.codePointAt(0) - 0xac00; return c >= 0 && c < 11172 ? Math.floor(c / 588) : ch; };
  const boldKey = (t) => { const m = /^(.*?)(\S+?)([.?!]?)$/.exec(t); return m ? `${m[1]}|${cho(m[2][0])}` : t; };
  // 제목 줄·상자 줄(콜론 줄)도 같은 규칙: "## 직렬연결: 전압을 나눠 가져요" → "… 나눠 가진다"
  for (const k of ["굵은 글씨", "제목", "그림·상자·디렉티브 줄"]) {
    if (a[k].length !== b[k].length) continue;
    a[k].forEach((x, i) => {
      const y = b[k][i];
      const core = (t) => (k === "굵은 글씨" ? t : t.replace(/\]\{.*$|\]\s*$/, ""));
      const tail = (t) => (k === "굵은 글씨" ? "" : t.slice(core(t).length));
      const cx = core(x), cy = core(y);
      if (x !== y && tail(x) === tail(y) && /(요|죠)[.?!]?$/.test(cx) && /(다|까)[.?!]?$/.test(cy) && boldKey(cx) === boldKey(cy)) { b[k][i] = x; toneBold.push(`${cx} → ${cy}`); }
    });
  }
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) { diffs.push(`${k} ${i + 1}번째: 전 「${x[i] ?? "(없음)"}」 → 뒤 「${y[i] ?? "(없음)"}」`); break; }
    if (x.length !== y.length) diffs.push(`${k}: 개수 ${x.length} → ${y.length}`);
  }
  // 해요체 끝말이 남았는지(수식·코드 제외한 글자에서)
  const left = strip(after).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[^$\n]+\$/g, "")
    .split("\n").map((l, i) => [i, l]).filter(([, l]) => /[가-힣](요|죠)[.?!)\s]*($|[.?!])/.test(l) || /(요|죠)[.?!]/.test(l) || /[가-힣](요|죠)[.?!]?\*\*/.test(l));
  for (const [, l] of left.slice(0, 10)) diffs.push(`해요체가 남음: ${l.trim().slice(0, 80)}`);
  return Object.assign(diffs, { toneBold });
}

/**
 * 살 붙이기 검사: 원래 원고의 수식·숫자·굵은 글씨·그림·상자·제목이 순서대로 모두 남아 있는지(사이에 더한 것은 허용).
 * 돌려주는 것: 빠진 것 목록
 */
export function growCheck(before, after) {
  const a = parts(before), b = parts(after);
  const miss = [];
  for (const k of Object.keys(a)) {
    if (k === "표 줄 수") { if (Number(b[k][0]) < Number(a[k][0])) miss.push(`${k}: ${a[k][0]} → ${b[k][0]}`); continue; }
    let j = 0;
    for (const x of a[k]) {
      while (j < b[k].length && b[k][j] !== x) j++;
      if (j >= b[k].length) { miss.push(`${k}: 「${x}」가 없거나 순서가 바뀜`); break; }
      j++;
    }
  }
  return miss;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "--grow") {
    const [b, a] = process.argv.slice(3);
    const m = growCheck(fs.readFileSync(b, "utf8"), fs.readFileSync(a, "utf8"));
    if (m.length) { console.log(`빠진 것 ${m.length}개\n- ` + m.join("\n- ")); process.exit(1); }
    console.log("통과(살 붙이기): 원래의 수식·숫자·굵은 글씨·그림·상자·제목이 순서대로 모두 남아 있음");
    process.exit(0);
  }
  const [b, a] = process.argv.slice(2);
  const d = toneCheck(fs.readFileSync(b, "utf8"), fs.readFileSync(a, "utf8"));
  if (d.length) { console.log(`다른 곳 ${d.length}개\n- ` + d.join("\n- ")); process.exit(1); }
  console.log("통과: 머리 부분·제목·수식·그림·상자·굵은 글씨·표·숫자가 같고, 해요체가 남지 않음");
  if (d.toneBold.length) console.log(`(굵은 글씨·제목·상자 제목의 끝말만 바뀜 ${d.toneBold.length}곳: ${d.toneBold.join(" / ")})`);
}
