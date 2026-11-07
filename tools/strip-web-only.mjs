// 인쇄용 원고에서 웹 전용 부분을 걷어낸다(인쇄에서 어차피 빠지는 것만). 메인 세션 담당.
//
//   node tools/strip-web-only.mjs <장.md> [<장.md> …] [--omit "실험으로 확인하기,직접 해 보기"] [--dry]
//
// 걷어내는 것(docs/FORMAT.md 3-3절과 같음)
// - :::quiz … ::: 블록, ::exp·::anim 한 줄, +++ 한 줄
// - omitSections 제목의 절(그 제목부터 같은 단계 이상의 다음 제목 직전까지)
// - 위 처리로 내용이 비게 된 제목(예: 퀴즈만 있던 "도전 문제")
// - 연달아 생긴 빈 줄은 하나로
// 2026-11-07 사용자 결정: 인쇄용 원고(textbooks)는 Physiklar 원고와 갈라진다. 인쇄에 안 나오는 것은 원고에서도 지워도 된다.
import fs from "node:fs";

export function stripWebOnly(source, omitSections = ["실험으로 확인하기", "직접 해 보기"]) {
  const lines = source.split("\n");
  const out = [];
  const removed = { quiz: 0, exp: 0, anim: 0, sep: 0, sections: [], emptyHeadings: [] };
  let i = 0;
  // 머리 부분은 그대로
  if (lines[0] === "---") { const end = lines.indexOf("---", 1); out.push(...lines.slice(0, end + 1)); i = end + 1; }
  let fence = false, omitLevel = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && /^(#{2,6})\s+(.*?)\s*$/.exec(line);
    if (h) {
      const lv = h[1].length;
      if (omitLevel && lv <= omitLevel) omitLevel = 0;
      if (!omitLevel && omitSections.includes(h[2])) { omitLevel = lv; removed.sections.push(h[2]); continue; }
    }
    if (omitLevel) continue;
    if (!fence && /^:::quiz\b/.test(line)) {
      removed.quiz += 1;
      while (i + 1 < lines.length && !/^:::\s*$/.test(lines[i + 1])) i++;
      i++; // 닫는 줄
      continue;
    }
    if (!fence && /^::exp\b/.test(line)) { removed.exp += 1; continue; }
    if (!fence && /^::anim\b/.test(line)) { removed.anim += 1; continue; }
    if (!fence && /^\+\+\+\s*$/.test(line)) { removed.sep += 1; continue; }
    out.push(line);
  }
  // 내용 없는 제목 지우기: 다음 제목(같은 단계 이상)이나 끝까지 빈 줄뿐이면
  const isHead = (l) => /^(#{2,6})\s/.exec(l)?.[1].length ?? 0;
  let changed = true;
  let body = out;
  while (changed) {
    changed = false;
    for (let k = 0; k < body.length; k++) {
      const lv = isHead(body[k]);
      if (!lv) continue;
      let j = k + 1;
      while (j < body.length && body[j].trim() === "") j++;
      const next = j < body.length ? isHead(body[j]) : 1;
      if (j >= body.length || (next && next <= lv)) {
        removed.emptyHeadings.push(body[k].replace(/^#+\s*/, ""));
        body = [...body.slice(0, k), ...body.slice(k + 1)];
        changed = true;
        break;
      }
    }
  }
  const text = body.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  return { text, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const oi = args.indexOf("--omit");
  const omit = oi >= 0 ? args[oi + 1].split(",") : undefined;
  const files = args.filter((a, k) => !a.startsWith("--") && (oi < 0 || k !== oi + 1));
  const total = { quiz: 0, exp: 0, anim: 0, sep: 0, sections: 0, emptyHeadings: 0 };
  for (const f of files) {
    const { text, removed } = stripWebOnly(fs.readFileSync(f, "utf8"), omit);
    for (const k of Object.keys(total)) total[k] += Array.isArray(removed[k]) ? removed[k].length : removed[k];
    if (removed.emptyHeadings.length) console.log(`${f}: 빈 제목 지움 — ${removed.emptyHeadings.join(", ")}`);
    if (!dry) fs.writeFileSync(f, text);
  }
  console.log(`파일 ${files.length}개: 퀴즈 ${total.quiz}, 웹 실험 ${total.exp}, 움직이는 그림 ${total.anim}, +++ ${total.sep}, 실험 절 ${total.sections}, 빈 제목 ${total.emptyHeadings}${dry ? " (시험 실행, 쓰지 않음)" : ""}`);
}
