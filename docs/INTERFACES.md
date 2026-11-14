# 모듈 사이 약속

편집기를 이루는 모듈과, 모듈끼리 주고받는 함수·데이터·HTML 모양입니다. 2단계의 병렬 개발은 이 문서만 맞추면 서로 기다리지 않고 진행할 수 있습니다. 약속을 바꿔야 하면 직접 바꾸지 말고 보고서에 **제안**으로 적습니다. 메인 세션이 이 문서를 고친 뒤 알립니다.

- 확정: 2026-11-07 (1단계)
- 원고 문법: [FORMAT.md](FORMAT.md). 결정 근거: [DECISIONS.md](DECISIONS.md).

---

## 1. 전체 흐름

```
 [storage]  GitHub 비공개 저장소 ⇄ BookSource
     │
 [editor]  원고 편집 ──(입력 멈춤 0.4초)──▶ [render] renderChapter / renderBook ──▶ 본문 HTML + meta + 경고
                                                │  └─ ```plot 블록 ──▶ [plot] renderPlot ──▶ SVG
                                                ▼
                                [layout] buildDocument ──▶ 인쇄 문서 HTML ──▶ createPreview().show() (Vivliostyle)
                                                                         └──▶ printPdf()  (브라우저 PDF 저장)
 [app] (메인 세션, 3단계) 위 모듈을 한 화면으로 묶음
```

- 모든 모듈은 **빌드 없는 ES 모듈**입니다. 외부 라이브러리는 `vendor/*.js`에서만 가져옵니다(`import { … } from "../../vendor/remark.js"`).
- `render`와 `plot`은 **브라우저와 Node 양쪽**에서 돌아야 합니다(시험, 맥에서 인쇄 PDF 만들기). DOM(`document`, `window`)을 쓰지 않습니다.
- `editor`, `layout`, `storage`는 브라우저 전용입니다.

## 2. 폴더와 담당

| 폴더·파일 | 담당 | 비고 |
|---|---|---|
| `src/editor/` | A. 편집 화면 | |
| `src/render/` | B. 원고 변환 | |
| `src/layout/`, `themes/` | C. 조판·인쇄 | |
| `src/plot/` | D. 함수 그래프 | |
| `src/storage/` | E. GitHub 저장 | |
| `tests/<모듈>*`, `tests/pages/<모듈>-*`, `tests/fixtures/<모듈>-*` | 각 모듈 담당 | 자기 이름으로 시작하는 파일만 |
| `docs/`, `src/assets.js`, `src/types.js`, `vendor/`, `tools/`, `tests/lib/`, `tests/run-all.mjs`, `samples/`, `package.json`, `index.html`, `src/app.js` | 메인 세션 | 바꿀 것이 있으면 제안 |

## 3. 공통 데이터 (`src/types.js`에 JSDoc으로도 있음)

```js
/** 편집기 판 */
type Edition = "teacher" | "student";
type Palette = "teal" | "red";
type Paper = "a4" | "a4-bleed";   // 재단선판은 만들지 않음(인쇄소가 처리)

/** book.json의 print 칸에 기본값을 채운 것 (FORMAT.md 1-1절) */
type PrintConfig = {
  theme: string; palette: Palette; paper: Paper;
  series?: { label: string[]; tag?: string };
  logo?: string;                       // 책 폴더 기준 경로
  fonts?: { body?: string; bodyFile?: string; bodyBoldFile?: string };
  omitSections: string[]; headingNumbers: boolean;
  problemNumber: "000" | "0"; problemNumbering?: "book" | "chapter"; chapterStart: "left" | "right" | "any";
  sideColumn: "outside" | "left";
  fontSizes?: { body?: number; side?: number; problem?: number }; // pt. layout의 FONT_SIZES·fontSizesOf 참고
};

/** 저장소에서 읽은 책 하나 */
type BookSource = {
  id: string;                          // 폴더 이름
  config: object;                      // book.json 전체
  print: PrintConfig;                  // config.print에 기본값을 채운 것
  parts: Array<{
    dir: string;                       // "1-mechanics"
    config: object;                    // part.json 전체
    palette: Palette;                  // part.print.palette ?? print.palette
    chapters: Array<{ path: string; source: string; sha?: string }>;
  }>;
};

/** 경고 (FORMAT.md 6절의 코드) */
type Warning = { code: string; message: string; line?: number; path?: string };
```

- 기본값 채우기: `src/types.js`의 `withPrintDefaults(config)`(메인 세션 제공).

## 4. render (B) — `src/render/index.js`

```js
renderChapter(source: string, ctx: RenderContext): { html: string, meta: ChapterMeta, warnings: Warning[] }
renderBook(book: BookSource, opts: BookRenderOptions): { html: string, toc: TocEntry[], warnings: Warning[] }
exportPhysiklar(source: string, ctx: { chapterNo: number, plot?, palette?, print? }): { source: string, files: Array<{ path: string, text: string }>, warnings: Warning[] }

type RenderContext = {
  edition: Edition;
  partNo: number;                      // 1부터
  chapterNo: number;                   // 부 안에서 1부터
  palette: Palette;
  print: PrintConfig;
  resolveAsset(src: string): string | null;   // 원고의 그림 경로 → 문서에서 쓸 URL. 파일이 없으면 null(→ missing-image 경고)
  readSvg(src: string): string | null; // SVG 원문(동기). null이면 <img>로 넣음
  plot?(spec: string, opts: { palette: Palette }): { svg: string, errors: string[] };  // 없으면 src/plot 사용
};
type BookRenderOptions = Omit<RenderContext, "partNo" | "chapterNo" | "palette" | "print"> & {
  range?: { part?: number; chapter?: number };   // 없으면 책 전체
};
type ChapterMeta = {
  title: string;
  headings: Array<{ level: 2 | 3; number: string; text: string; id: string; line: number }>;
  figures: Array<{ id: string; number: string; caption: string; line: number }>;
  equations: Array<{ id: string; number: string; line: number }>;
  problems: Array<{ number: string; hasSolution: boolean; line: number }>;
  blanks: number;
};
type TocEntry =
  | { cover: number; label: string; no: string; title: string; palette: Palette }   // 큰 표지(Part) 모드의 큰 표지("PART" "II")
  | { part: number; chapter?: number; seq?: number; title: string; palette: Palette };
```

- `renderChapter`가 내놓는 `html`은 `<section class="chapter">` 하나입니다(6절). `renderBook`은 부 표지·부 목차·장들을 이어 붙인 본문입니다. `<html>`, `<head>`는 만들지 않습니다(layout 담당).
- 같은 원고·같은 `ctx`면 결과가 항상 같아야 합니다(시험 비교용).
- 원고 줄 번호: 원고의 큰 덩어리(문단, 제목, 상자, 그림, 수식, 문항)에 `data-line="줄번호"`(1부터)를 붙입니다. 편집기와 미리보기의 위치 맞춤에 씁니다.

## 5. plot (D) — `src/plot/index.js`

```js
renderPlot(spec: string, opts: { palette: Palette }): { svg: string, errors: string[] }
parsePlot(spec: string): { ok: boolean, plot?: object, errors: string[] }
svgToPng(svg: string, scale?: number): Promise<Blob>   // 브라우저 전용, 내려받기용
```

- `spec`은 ` ```plot ` 블록 안의 글자입니다(FORMAT.md 3-9절).
- `svg`는 `<svg xmlns=… viewBox=…>`로 시작하는 문자열입니다. 폭은 지정하지 않습니다(render가 `w`로 감쌈).
- 색은 6절의 CSS 변수를 씁니다: `stroke="var(--plot-1, #1c6862)"`처럼 변수 + 대체 색.
- 오류가 있으면 `errors`에 사람이 읽을 한국어 문장을 넣고, 그릴 수 있는 만큼 그립니다.

## 6. render ↔ layout HTML 모양

render가 이 모양으로 내놓고, layout의 테마 CSS가 이 클래스에 모양을 입힙니다. **두 쪽 모두 이 표를 정답으로 삼습니다.**

```html
<!-- 책 첫 쪽: 제목 + 한 쪽짜리 목차 (renderBook으로 책 전체를 만들 때만, 맨 앞). 쪽수는 테마가 target-counter로 채움 -->
<section class="book-front" data-palette="teal">
  <div class="front-art has-image"><img class="front-image" src="…"><div class="front-caption"><p class="front-series">PHYSICS · LECTURE NOTES</p><p class="front-title">Physics Bridge</p><h1 class="book-title">책 제목</h1><p class="book-subtitle">부제</p></div></div>
  <nav class="book-toc"><h2>CONTENTS</h2><ol>
    <li class="toc-part"><a href="#part-1"><span class="toc-no">01</span><span class="toc-title">운동과 힘</span><span class="toc-fill"></span></a></li>
    <li class="toc-chapter"><a href="#ch-1-1"><span class="toc-no">1</span><span class="toc-title">속도와 가속도</span><span class="toc-fill"></span></a></li>
  </ol></nav>
</section>
<!-- 부 표지 (renderBook만) -->
<section class="part-cover" id="part-1" data-palette="red" data-part="1">
  <div class="part-no">01</div>
  <h1 class="part-title">운동과 평형</h1>
</section>
<!-- 부 목차 (renderBook만) -->
<section class="part-toc" data-palette="red" data-part="1">
  <ol><li><span class="toc-no">1.</span> 속도와 가속도</li>…</ol>
</section>

<!-- 큰 표지(Part) 모드(어느 part.json에든 print.cover가 있을 때. FORMAT.md 1-2절): 위 두 가지 대신 -->
<section class="part-cover big" id="cover-1" data-palette="red" data-cover="1">
  <div class="part-label">PART</div>
  <div class="part-no">I</div>
  <h1 class="part-title">Mechanics</h1>
</section>
<!-- 모든 부마다(홀수 쪽). 큰 표지 모드에서는 책 첫 쪽에 class="book-front has-covers"(data-covers=큰 표지 수), 목차 줄 li.toc-cover(href="#cover-1")가 더해짐.
     큰 표지가 5개 이상이면 book-front에 toc-many, 둘째 단을 시작하는 큰 표지 줄 하나에 li.toc-cover.toc-colbreak (2026-11-14) -->
<section class="part-toc titled" id="part-1" data-palette="red" data-part="1">
  <h1 class="part-toc-title">운동의 기술</h1>
  <ol><li><span class="toc-no">1.</span> 위치·변위·속도</li>…</ol>
</section>

<!-- 장 -->
<section class="chapter" id="ch-1-1" data-palette="red" data-part="1" data-chapter="1" data-edition="student">
  <section class="theory">
    <header class="chapter-head" data-mode="theory">
      <nav class="tabs"><span class="tab tab-theory on">THEORY</span><span class="tab tab-problems">PROBLEMS</span></nav>
      <div class="band"><span class="chapter-no">1</span><h1 class="chapter-title">속도와 가속도</h1></div>
    </header>
    <div class="theory-body"> … 아래 요소들 … </div>
  </section>
  <section class="problems">
    <header class="chapter-head" data-mode="problems"> … 탭 중 tab-problems에 on … </header>
    <div class="problem-list">
      <article class="problem" id="pr-1-1-001" data-line="88">
        <div class="problem-no">001</div>
        <div class="problem-body"> … </div>
        <div class="source"> … </div>            <!-- :::source, 교사용만. :::solution은 여기 없음(meta.solutions → 책 맨 뒤) -->
      </article>
    </div>
  </section>
</section>
```

| 원고 | HTML |
|---|---|
| `##` | `<h2 class="sec" id="s-1-1-1"><span class="sec-no">1.</span> 제목</h2>` (`headingNumbers`가 거짓이면 `sec-no` 없음) |
| `###` | `<h3 class="sub" id="…"><span class="sec-no">(1)</span> 제목</h3>` |
| `####` | `<h4>` |
| 상자 | `<aside class="callout note"><p class="callout-title">참고</p> … </aside>` (`tip`·`warn`·`think`도 같은 꼴) |
| `:::side[제목]` | `<aside class="side"><p class="side-title">제목</p> … </aside>` |
| `::fig` | `<figure class="fig" id="fig-wave" data-no="1.2"><div class="fig-body" style="width:80%">(SVG 또는 img)</div><figcaption><span class="fig-no">그림 1.2</span> 설명</figcaption></figure>` |
| `:::figs` | `<div class="figs"> figure.fig 여러 개 </div>` |
| ` ```plot ` | `<figure class="fig plot" data-no="…"><div class="fig-body" style="width:70%">(SVG)</div></figure>` (설명 없으면 figcaption 없음, 번호 없음) |
| 번호 없는 `$$` | KaTeX의 `<span class="katex-display">…` 그대로 |
| 분수가 든 인라인 수식 | 바깥 `<span class="katex">`에 `has-frac` 클래스 추가(줄 겹침 방지용, DECISIONS 1-1절 2) |
| `\label{x}` 있는 `$$` | `<div class="eq" id="eq-x" data-no="1.3"> (KaTeX, \tag{1.3}) </div>` |
| `:ref[x]` | `<a class="ref" href="#eq-x">(1.3)</a>` 또는 `<a class="ref" href="#fig-x">그림 1.2</a>` |
| `:blank[알짜힘]` 교사용 | `<span class="blank answer"><span class="slot">알</span><span class="slot">짜</span><span class="slot">힘</span></span>` |
| `:blank[알짜힘]` 학생용 | `<span class="blank empty"><span class="slot"></span><span class="slot"></span><span class="slot"></span></span>` |
| `:blank[등가속도 운동]` | 띄어쓰기 자리에 `<span class="gap"></span>` |
| `:blank[$F=ma$]` | `<span class="blank answer math">(KaTeX)</span>` / 학생용은 같은 KaTeX에 `empty` 클래스(글자는 CSS로 숨기고 폭은 유지) |
| `:::teacher` | 교사용 `<div class="teacher-only"> … </div>`, 학생용 `<div class="teacher-only placeholder"> … </div>`(테마가 글자를 숨기고 자리만 유지) |
| `:::source` | 교사용 `<div class="source"> … </div>`, 학생용은 없음 |
| `:::solution` | 문제 쪽에는 없음. `renderChapter`의 `meta.solutions`(`{number, id, html, line}`)로 넘기고, `renderBook`이 책 맨 뒤 `<section class="chapter answers" id="answers">`(장 머리 번호 `A`, `.answer-list` 2단, 부마다 `.answer-group` + `h2.answer-part`, 문항마다 `<div class="answer" id="ans-pr-…"><span class="answer-no">001</span><div class="answer-body">…</div></div>`)로 모음. 두 판 모두. toc 끝에 `{ answers: true, no: "A", title: "정답과 해설" }` |
| `::space{h=30}` | `<div class="space" style="height:30mm"></div>` |
| `::pagebreak` | `<div class="pagebreak"></div>` |
| `::columnbreak` | `<div class="columnbreak"></div>` |
| `:::columns` | `<div class="columns-2"> … </div>` |
| `:hl[…]` | `<mark>…</mark>` |
| `:red[…]` 등 | `<span class="c-red">…</span>` |
| `:::center` / `:::right` | `<div class="center">` / `<div class="right">` |

- **빈칸의 폭 규칙**: 교사용과 학생용 모두 글자 하나를 `.slot` 하나로 감쌉니다. 테마 CSS가 `.slot`의 폭을 고정(한글 한 글자 폭)하므로 두 판의 줄바꿈이 같아집니다.
- 테마 내부 변수(테마 전용, render는 쓰지 않음): `--c-title`, `--c-hi`, `--c-frame`, `--c-em`(교사용 답 글자), `--c-tint`, `--c-mark`. 색 원본 값은 `themes/cyber/theme.css`의 `:root` 한 곳에만 있음(CMYK 전환 시 여기만 고침).
- 색 변수(테마가 `[data-palette]`마다 정의, 그래프·그림도 사용): `--c-base`, `--c-dark`, `--c-accent`(번호 상자), `--c-side`(옆 띠·탭), `--c-big`(부 표지 숫자), `--c-shadow`, `--c-rule`(머리말 선), `--plot-1`~`--plot-4`(그래프 선), `--plot-fill`(칠하기).

## 7. layout (C) — `src/layout/index.js`, `themes/`

```js
buildDocument(bodyHtml: string, settings: LayoutSettings): string        // <!doctype html>… 전체 문서
createPreview(container: HTMLElement, opts?: { spread?: boolean; zoom?: number }): Preview
printPdf(docHtml: string, opts?: { title?: string }): Promise<void>   // 조판 엔진을 필요할 때 불러오므로 Promise               // 브라우저 인쇄 창(PDF 저장)

type LayoutSettings = {
  paper: Paper; edition: Edition; theme: string;
  print: PrintConfig;
  resolveAsset(src: string): string;   // 로고·본문 글꼴 파일 주소
  title?: string;
  baseUrl?: string;                    // 편집기 주소(끝에 /). Node에서 문서를 만들 때 필수(테마 CSS 주소 기준)
};
type Preview = {
  show(docHtml: string): Promise<{ pages: number; ms: number; warnings: Warning[] }>;  // source-overflow, source-spill, page-multiple, toc-overflow 등
  goToPage(n: number): void;
  currentPage(): number;                     // 화면 위쪽에 보이는 쪽
  pageOfLine(line: number): number | null;   // data-line → 쪽 번호
  readonly zoom: number;                     // 지금 배율(1 = 실제 크기)
  setZoom(z: number, at?: { x: number; y: number }): Promise<void>;  // 배율만 바꿈(다시 조판 안 함). at(화면 좌표)에 보이던 곳을 그 자리에
  destroy(): void;
};
```

- 문서 `<head>`에는 `src/assets.js`의 `BASE_STYLESHEETS`, 테마 CSS(`themes/<theme>/theme.css`), 판형 CSS를 넣습니다. 문서가 Blob 주소로 열리므로 **모든 주소는 절대 주소**여야 합니다.
- 본문 글꼴: `print.fonts.bodyFile`이 있으면 `@font-face`로 불러오고, 없으면 Noto Serif KR. 제목 글꼴은 `"Apple SD Gothic Neo", "Pretendard"` 순서(맥에서는 설치된 글꼴, 그 밖에는 Pretendard).
- 개념 구간의 좁은 단(`sideColumn: "outside"`): 쪽 여백을 `@page :left`/`:right`로 거울처럼 바꾸고, `.side`는 `float: outside; margin: 0 -<단 폭+간격>`으로 바깥 여백에 걸칩니다. Vivliostyle이 `outside`를 쪽마다 왼쪽·오른쪽으로 바꿔 줍니다(2026-11-07 시험으로 확인). `"left"`면 항상 왼쪽.
- 머리말(왼쪽 쪽: 시리즈 글씨 + 이름 태그, 오른쪽 쪽: 로고 + 장 제목), 꼬리말(바깥쪽 쪽 번호), 장 첫 쪽·빈 쪽 머리말 숨김, 장 오른쪽 시작은 0단계 시험의 방식을 이어받습니다(`spike/src/book.css`, DECISIONS 1-1절).

## 8. editor (A) — `src/editor/index.js`

```js
createEditor(parent: HTMLElement, opts: {
  doc: string;
  onChange(text: string): void;           // 입력할 때마다(지연은 app이 처리)
  onCursorLine?(line: number): void;      // 커서 줄이 바뀔 때(미리보기 위치 맞춤)
  onSave?(): void;                        // Ctrl/Cmd+S
  onImage?(file: File): Promise<string>;  // 그림 붙여넣기·끌어다 놓기 → 원고에 쓸 경로를 돌려줌(storage가 올림)
}): Editor

type Editor = {
  getText(): string; setText(text: string): void;   // setText는 onChange를 부르지 않고 되돌리기·경고를 비움(app이 setWarnings를 다시 부를 것)
  vim: boolean; setVim(on: boolean): void;        // Vim 모드(약속 밖 덧붙임, 2026-11-08). @replit/codemirror-vim. 켜짐은 브라우저 localStorage "pl-editor-vim"에 기억. :w = onSave
  focus(): void; pickImage(): void;                 // 덧붙임(2단계 A)
  goToLine(line: number): void;
  setWarnings(list: Warning[]): void;     // 해당 줄에 표시
  command(name: EditorCommand, arg?: any): void;
  destroy(): void;
};
type EditorCommand = "bold" | "blank" | "inlineMath" | "displayMath" | "callout" | "side" | "figure"
  | "plot" | "problem" | "source" | "solution" | "space" | "table" | "pagebreak" | "heading2" | "heading3";
createToolbar(parent: HTMLElement, editor: Editor): void   // 위 명령의 단추 묶음(한국어 이름)
```

- `blank`: 고른 글자를 `:blank[…]`로 감쌉니다. 이미 감싸져 있으면 풉니다.
- `problem`: 커서 자리에 `::::problem` 틀(본문 자리, `:::source`·`:::solution` 포함)을 넣습니다. `source`·`solution`: 문항 안이면 정답은 해설 앞, 해설은 문항 끝에 넣고, 이미 있으면 그리로 옮겨 감. 장에 `::problems`가 없으면 장 끝에 먼저 넣습니다.

## 9. storage (E) — `src/storage/index.js`

```js
createGitHubStore(opts: { owner: string; repo: string; branch?: string; token: string }): Store
saveToken(token: string, remember: boolean): void;  loadToken(): string | null;  clearToken(): void;
saveDraft(path: string, text: string): Promise<void>;  loadDraft(path: string): Promise<{ text: string; savedAt: number } | null>;  clearDraft(path: string): Promise<void>;

type Store = {
  listBooks(): Promise<Array<{ id: string; title: string }>>;
  loadBook(id: string): Promise<BookSource>;
  readFile(path: string): Promise<{ text: string; sha: string }>;
  readBinary(path: string): Promise<{ blob: Blob; sha: string }>;
  assetUrl(path: string): Promise<string>;   // 비공개 그림·글꼴을 문서에서 쓸 수 있는 blob: 주소로
  writeFile(path: string, text: string, opts: { sha?: string; message: string }): Promise<{ sha: string }>;
  writeBinary(path: string, blob: Blob, opts: { sha?: string; message: string }): Promise<{ sha: string }>;
};
class ConflictError extends Error { remote: { text: string; sha: string } }
class StorageError extends Error { status?: number; kind: "auth"|"ratelimit"|"forbidden"|"notfound"|"network"|"server"|"path"|"toolarge"|"other" }  // message는 한국어, 서버 응답 본문은 담지 않음

// 덧붙임(3단계 E): render의 resolveAsset/readSvg가 동기이므로 미리 받아 두고 동기로 꺼낸다
Store.prefetch(paths: string[]): Promise<{ ok: string[]; missing: string[] }>   // sha 기준 IndexedDB 캐시
Store.cachedAssetUrl(path: string): string | null    // blob: 주소(동기)
Store.readSvgCached(path: string): string | null     // SVG 원문(동기)
Store.listFiles(prefix: string), Store.hasFile(path: string), Store.dispose()
listDrafts(): Promise<…>
resolveRepoPath(baseDir: string, rel: string): string | null   // ("books/x", "../../fonts/K.ttf") → "fonts/K.ttf". books/·fonts/ 밖이면 null
isRepoPath(path: string): boolean
```

- 저장소는 비공개 `cherryopener/textbooks`, 책은 `books/` 아래(FORMAT.md 1절).
- **토큰은 GitHub API(`api.github.com`) 말고 어디에도 보내지 않습니다.** 화면, 콘솔, 오류 메시지, 원고 저장소에 남기지 않습니다. `remember`가 거짓이면 `sessionStorage`, 참이면 `localStorage`.
- 임시 저장(drafts)은 IndexedDB.

## 10. 시험

- `npm test` → `tests/run-all.mjs`가 `tests/*.test.mjs`를 모두 돌립니다. 각 시험 파일은 실패하면 `process.exit(1)`.
- 브라우저 시험은 `tests/lib/browser.mjs`의 `openBrowser()`를 씁니다. 저장소 폴더를 로컬 서버로 띄우고, CDN 주소를 `node_modules`로 연결합니다(이 작업 환경은 CDN 접속이 막혀 있음).
- **합격 기준**: `samples/sample-book/`이 교사용·학생용, A4·도련판 모두에서 오류 없이 처리되고, 각 모듈의 시험이 통과할 것.
- 시험 결과물(PDF, 그림)은 `out/`(커밋 제외)에 만듭니다.
