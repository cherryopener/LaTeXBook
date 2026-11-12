// 변환 1·2단계: 인쇄에서 뺄 것 지우기, 번호 매기기(제목·수식·그림·문항). renderChapter와 exportPhysiklar가 함께 씀
import { parseBody, text, isPlusPlus, isBlockDirective } from "./util.js";

export const HIDDEN = new Set(["quiz", "exp", "anim"]);
const LABEL_RE = /\\label\s*\{([^{}]*)\}/g;

/** 수식 글자에서 \label 이름들 */
export function labelsOf(tex) {
  return [...String(tex).matchAll(LABEL_RE)].map((m) => m[1].trim()).filter(Boolean);
}
export const stripLabels = (tex) => String(tex).replace(LABEL_RE, "");

/** 목록 안에서 인쇄 제외 처리(안쪽 상자까지 재귀) */
function prune(list, omit) {
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (isPlusPlus(n) || (isBlockDirective(n) && HIDDEN.has(n.name))) list.splice(i, 1);
  }
  // omitSections: 그 제목부터 같은 단계 이상의 다음 제목 직전까지
  for (let i = 0; i < list.length; ) {
    const n = list[i];
    if (n.type === "heading" && omit.has(text(n).trim())) {
      let j = i + 1;
      while (j < list.length && !(list[j].type === "heading" && list[j].depth <= n.depth)) j++;
      list.splice(i, j - i);
    } else i++;
  }
  for (const n of list) if (n.children && n.type !== "heading") prune(n.children, omit);
  // 내용이 비게 된 제목 지우기(뒤에서부터 → 연쇄로 빈 상위 제목도 지워짐)
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i];
    if (n.type !== "heading") continue;
    const next = list[i + 1];
    if (!next || (next.type === "heading" && next.depth <= n.depth)) list.splice(i, 1);
  }
}

function walk(list, fn, anc = []) {
  for (const n of list) {
    fn(n, anc);
    if (n.children) walk(n.children, fn, [...anc, n]);
  }
}

/**
 * 원고 본문을 읽어 구간을 나누고 번호를 매긴다. 노드에 _no, _id 등을 적어 둔다.
 * @returns {{theory:Array, problems:Array|null, labels:Map, meta:Object}}
 */
// 식·그림 번호의 앞자리 N은 책 전체에서 몇 번째 장인지(chapterSeq). 부가 바뀌어도 이어진다(책은 한 권으로 나오므로, 사용자 결정 2026-11-07)
/**
 * "**:blank[알짜힘]**이란"처럼 굵은 빈칸 바로 뒤에 한글이 오면 마크다운 규칙상 굵게가 닫히지 않아 ** 가 그대로 찍힌다.
 * 그래서 "**:blank[…]**" 는 미리 ":blank[…]{.strong}" 으로 바꾸고, 빈칸이 스스로 굵게 그린다(줄 수는 그대로).
 */
export function boldBlanks(body) {
  return String(body).replace(/\*\*(:blank\[[^\]\n]*\])\*\*/g, "$1{.strong}");
}

export function prepare(body, { print, partNo: P, chapterNo: C, chapterSeq, problemStart = 0, warn, lineOf }) {
  const N = chapterSeq ?? C;
  const tree = parseBody(boldBlanks(body));
  const idx = tree.children.findIndex((n) => n.type === "leafDirective" && n.name === "problems");
  const theory = idx >= 0 ? tree.children.slice(0, idx) : tree.children.slice();
  const problems = idx >= 0 ? tree.children.slice(idx + 1) : null;
  const omit = new Set((print.omitSections ?? []).map((s) => String(s).trim()));
  prune(theory, omit);
  if (problems) prune(problems, omit);

  const meta = { headings: [], figures: [], equations: [], problems: [], blanks: 0 };
  const labels = new Map(); // 이름 → { kind, id, no }
  const addLabel = (name, entry, node) => {
    if (labels.has(name)) {
      warn("duplicate-label", `같은 이름 "${name}"이(가) 두 번 쓰였습니다. 앞의 것을 씁니다.`, node);
      return false;
    }
    labels.set(name, entry);
    return true;
  };

  // 제목 번호: 맨 바깥 제목만
  let h2 = 0, h3 = 0;
  for (const list of [theory, problems ?? []]) {
    for (const n of list) {
      if (n.type !== "heading" || (n.depth !== 2 && n.depth !== 3)) continue;
      if (n.depth === 2) { h2++; h3 = 0; n._no = `${h2}.`; n._id = `s-${P}-${C}-${h2}`; }
      else { h3++; n._no = `(${h3})`; n._id = `s-${P}-${C}-${h2}-${h3}`; }
      meta.headings.push({ level: n.depth, number: n._no, text: text(n).trim(), id: n._id, line: lineOf(n) });
    }
  }

  // 수식·그림·문항 번호(문서 순서, 판과 관계없이 같게)
  // 문항 번호는 problemStart 다음부터(책 전체로 이어 매길 때 앞 장들의 문항 수, 2026-11-12 사용자 결정)
  let eq = 0, fig = 0, pr = problemStart;
  const all = [...theory, ...(problems ?? [])];
  const probSet = new Set(problems ?? []); // 문제 구간의 맨 위 노드들
  walk(all, (n, anc) => {
    if (n.type === "math") {
      const names = labelsOf(n.value);
      if (!names.length) return;
      eq++;
      n._no = `${N}.${eq}`;
      n._id = `eq-${names[0]}`;
      if (!addLabel(names[0], { kind: "eq", id: n._id, no: n._no }, n)) n._id = `eq-${P}-${C}-${eq}`;
      for (const name of names.slice(1)) addLabel(name, { kind: "eq", id: n._id, no: n._no }, n);
      meta.equations.push({ id: n._id, number: n._no, line: lineOf(n) });
    } else if (n.type === "leafDirective" && n.name === "fig") {
      const name = (n.attributes?.id ?? "").trim();
      const inSide = anc.some((a) => a.type === "containerDirective" && a.name === "side");
      const inProblems = probSet.has(anc[0] ?? n);
      // 옆 단 안의 작은 그림과 문제 구간의 그림은 #이름이 있을 때만 번호(2026-11-10 사용자 결정: 문제 그림은 번호 없음)
      if ((inSide || inProblems) && !name) return;
      fig++;
      n._no = `${N}.${fig}`;
      n._id = name ? `fig-${name}` : `fig-${P}-${C}-${fig}`;
      if (name && !addLabel(name, { kind: "fig", id: n._id, no: n._no }, n)) n._id = `fig-${P}-${C}-${fig}`;
      meta.figures.push({ id: n._id, number: n._no, caption: text(n).trim(), line: lineOf(n) });
    } else if (n.type === "containerDirective" && n.name === "problem") {
      pr++;
      n._no = print.problemNumber === "0" ? String(pr) : String(pr).padStart(3, "0");
      n._id = `pr-${P}-${C}-${String(pr - problemStart).padStart(3, "0")}`; // id는 장 안 순번(책 전체 번호와 무관하게 고정)
      const hasSolution = n.children.some((c) => c.type === "containerDirective" && c.name === "solution");
      meta.problems.push({ number: n._no, hasSolution, line: lineOf(n) });
    }
  });
  // 한 쪽 문항 수: ::problems{per=4} 가 있으면 그것(2·4·6)
  // 한 쪽 문항 수: ::problems{per=4} (모든 쪽), ::problems{first=4 per=6} (첫 쪽만 4)
  const pa = idx >= 0 ? tree.children[idx].attributes ?? {} : {};
  const problemsPer = Number(pa.per) || null;
  const problemsFirst = Number(pa.first) || null;
  return { theory, problems, labels, meta, problemsPer, problemsFirst };
}
