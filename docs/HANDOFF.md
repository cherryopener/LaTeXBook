# 인수인계 (새 세션용)

- 작성: 2026-11-07. 이전 세션이 길어져 새 세션으로 넘깁니다.
- 새 세션은 **이 문서 → [PLAN.md](PLAN.md) → [DECISIONS.md](DECISIONS.md) → [FORMAT.md](FORMAT.md) → [INTERFACES.md](INTERFACES.md)** 순서로 읽고 시작합니다.
- 다음 할 일: **8단계 — Physiklar의 브릿지 역학·전자기를 이 편집기 형식으로 옮기기**(아래 4절).
- **2026-11-07 갱신: 8단계 1차 완료(4-5절).** 남은 것은 사용자 확인과 textbooks 반영.

## 1. 무엇을 만들었나

물리 교사(비기술자)가 마크다운 + LaTeX(KaTeX) 수식으로 교재를 쓰고, 오른쪽에서 인쇄 페이지를 보며, 교사용·학생용 PDF를 뽑는 웹 편집기.

| 무엇 | 어디 | 공개 |
|---|---|---|
| 편집기 프로그램 | 저장소 `cherryopener/LaTeXBook`, 작업 브랜치 `claude/textbook-webapp-plan-4xtu34` → GitHub Pages `https://cherryopener.github.io/LaTeXBook/` (사용자가 이 브랜치로 Pages를 켬) | 공개 |
| 교재 원고·그림·글꼴 | 저장소 `cherryopener/textbooks`(브랜치 `main`). `books/<책 id>/…`, `fonts/*.ttf`(KoPub 5종) | 비공개 |
| Physiklar | 저장소 `cherryopener/Physiklar`(Next.js, 사용자의 다른 서비스). 이 편집기와 **원고 문법만 같게** 맞춤 | 비공개 |

- `textbooks`에는 `books/sample-book`(견본 물리)이 있다: 로고 `images/image01.png`(학원 로고, 비공개), 본문 KoPub, 책 첫 쪽 영어 제목 "Physics Bridge", 머리말 이름 태그.
- 편집기는 사용자가 만든 fine-grained 토큰(textbooks 하나, Contents 읽기·쓰기)으로 브라우저에서 GitHub API를 직접 부른다. 서버 없음.

## 2. 지금 상태 (모두 완료, 시험 12개 통과)

- 0~3단계 완료: 원고 변환(`src/render`), 조판·테마(`src/layout`, `themes/cyber`), 그래프(`src/plot`), 편집 화면(`src/editor`), GitHub 저장(`src/storage`), 앱 화면(`index.html`, `src/app.js`), 보안 검토 반영(CSP, 원고 HTML·SVG 거르기).
- 이후 사용자 요청으로 더한 것: 새 책·부·장 만들기(＋ 단추), 미리보기 전체 스크롤, **1쪽 책 제목 + 자동 쪽수 목차**, **부 표지·개념 시작·문제 시작 모두 짝수 쪽**(chapterStart: left), **장 번호·식 번호·그림 번호 책 전체로 이어 매김**, 216×303 재단 여유판(재단선판은 없음).
- 아직 없는 것: 책 설정(머리말 태그·로고·색) 화면에서 고치기, 장 이름·순서 바꾸기·지우기, 7단계(인쇄소용 CMYK PDF, 맥에서 실행), 그림 올리는 중 장을 바꾸면 그림 줄이 다른 장에 들어갈 수 있는 작은 문제.

## 3. 일하는 법(이 저장소 규칙)

- 사용자에게는 한국어 합니다체. 결론 먼저, 쉬운 말. 큰 작업 전엔 계획을 보여 주고 동의받음.
- 커밋·push는 작업 브랜치에. PR은 요청할 때만. 커밋 메시지는 한국어 + 끝에 세션이 주는 꼬리말.
- **비공개 내용(Physiklar 원고·그림, 학원 로고·이름, 토큰)을 LaTeXBook(공개)에 넣지 않는다.** 이식한 책은 `textbooks`에만.
- 시험: `npm install` 후 `npm test`(12개). 브라우저 시험은 전역 Playwright, `tests/lib/browser.mjs`의 `openBrowser({port})`(시험마다 포트 다르게). 이 작업 환경은 CDN(jsdelivr) 접속이 막혀 있어 시험 도구가 CDN 주소를 `node_modules`로 연결한다.
- 서브에이전트 모델 배정은 사용자의 다른 저장소(`cherryopener.github.io`) `CLAUDE.md` 4절 사다리를 따른다(엔진·레이아웃 2=sonnet/high, 구조 변경 4=opus/high, 기계적 0=haiku/low, 검토는 작성보다 한 단계 위). 서브에이전트는 `isolation: "worktree"`로, 각자 맡은 폴더만.
- 비공개 책을 로컬에서 조판해 보는 방법: 이전 세션의 스크립트 요지 — `textbooks/books/<id>`의 json·md를 읽어 `assembleBook` → `renderBook` → `buildDocument(…, { baseUrl })` → `tests/pages/integration.html?doc=…`로 열어 `page.pdf`. 그림·글꼴은 `out/` 아래로 복사해 로컬 서버로 제공(커밋 안 됨).

## 4. 8단계: 브릿지 역학·전자기 이식 (다음 할 일)

### 4-1. 원본

- `cherryopener/Physiklar`의 `content/books/bridge-mechanics/`, `content/books/bridge-electromagnetism/`
  - 각각 `book.json`, 부 4개(`1-kinematics/part.json` 등), 장(원고 .md) 12개 → 합계 24개 .md
  - 그림: `public/books/bridge-mechanics/*.svg` 22개, `public/books/bridge-electromagnetism/*.svg` 23개
  - 원고 문법 설명: Physiklar `docs/WRITING_GUIDE.md`, 처리 코드: `lib/markdown.tsx`
- 원고 속 개수(2026-11-07): `:::quiz` 148, `::exp` 17, `::anim` 5, `### 실험으로 확인하기` 5, `### 직접 해 보기` 9, `## 도전 문제`·`### 도전 문제` 18(퀴즈만 있으면 자동으로 빠짐), `+++` 81.

### 4-2. 규칙(사용자 확정)

- **본문 문장은 한 글자도 고치지 않는다.** 말투·내용 보강은 사용자가 직접 한다. 이식 후 원본과 결과의 글자를 비교하는 검사로 확인.
- 퀴즈·웹 실험·"실험으로 확인하기"·"직접 해 보기"는 **원고에 남기고 인쇄에서만 빠진다**(이미 편집기가 처리. `omitSections` 기본값).
- 빠진 실험·퀴즈를 가리키는 문장("아래 실험에서…" 등) 목록을 만들어 사용자에게 준다(고치지 않음).
- 결과는 비공개 `textbooks`의 새 책 폴더에만(예: `books/bridge/`). 역학 부는 붉은(`red`), 전자기 부는 청록(`teal`).
- 장 번호·식 번호는 책 전체로 이어진다(이미 구현).
- 인쇄 4도. 책 첫 쪽 영어 제목은 "Physics Bridge"(그림은 사용자가 나중에).

### 4-3. 먼저 사용자에게 물을 것: 책 구성

편집기 형식은 "부 → 장(.md 하나)"이다. Physiklar는 "책 → 단원(part.json) → 원고(.md)" 구조. 두 가지 중 고르게 한다.

| 안 | 구성 | 장점 | 단점 |
|---|---|---|---|
| A | 부 2개(역학·전자기), 장 24개(.md 하나 = 장 하나) | 부 표지가 2개뿐 | Physiklar 단원(운동의 기술 등) 구분이 목차에서 사라짐 |
| B | 부 8개(Physiklar 단원 그대로), 장 24개 | 단원 구분 유지, 옮기기가 기계적 | 부 표지·부 목차가 8쌍(짝수 쪽 시작이라 빈 쪽이 늘 수 있음) |

### 4-4. 할 일과 배정(계획서 PLAN.md 8단계 표 참고)

| 작업 | 내용 | 배정 |
|---|---|---|
| 8-1 원고 이식 스크립트 | 폴더 구조 만들기(4-3 결정대로), `book.json`/`part.json`에 `print` 설정, 그림 경로(`/books/<id>/x.svg` → `images/x.svg`, 편집기가 이미 읽어 줌), 두 책 그림 이름이 겹치면 접두어 | sonnet/high |
| 8-2 그림 색 변환 | 45개 SVG: 화면용(배경 `#1e293b` 진한 남색, 글자 `#e2e8f0`, 파스텔 선 11색) → 흰 종이용. 4도 인쇄 기준 진한 색 대응표 하나로 일괄 변환. 0단계 임시 대응표가 `spike/build.mjs`의 `RECOLOR`에 있음(출발점) | sonnet/high |
| 8-3 그림 검토 | 변환 전후 나란히 보고 안 보이는 색·겹침·사라진 요소 찾기 | opus/medium |
| 8-4 문장 불변 검사 | 원본과 결과의 글자 비교(처리 대상 문법 제외) | haiku/low 또는 스크립트 |
| 8-5 사용자 확인 | 이식된 책 교사용·학생용 PDF | — |

- Physiklar 저장소는 **읽기만**. 그쪽 파일은 고치지 않는다.
- 새 세션에서는 `Physiklar`·`textbooks` 저장소를 세션에 연결(add_repo)하고 clone해야 한다.

### 4-5. 8단계 1차 결과 (2026-11-07)

- **책 구성 결정(사용자)**: 큰 표지(Part) → 부 → 장 3단계. Griffiths QM의 Part I·II를 본뜸.
  - Part I Mechanics(붉은), Part II Electromagnetics(청록). 큰 표지는 짝수 쪽, 영어 제목.
  - 부 8개(Physiklar 단원 그대로)마다 흰 바탕 부 쪽(부 제목 크게 + 장 목록), 언제나 홀수 쪽.
  - 형식: `part.json`의 `print.cover`(FORMAT.md 1-2절). 편집기 구현: `src/render/index.js`, `themes/cyber/theme.css`, 시험 `tests/render.test.mjs`.
- **이식 도구**: `tools/import-physiklar.mjs`(비공개 내용 없음. 책 제목 등은 설정 파일로 받음). 원고는 그림 경로만 바꾸고, 바꾼 경로를 되돌리면 원본과 바이트까지 같은지 스스로 검사. 그림 색 대응표 `RECOLOR`(+ 면·선 자리별 회색 2개).
  - 그림 검토(opus/medium) 반영: 노랑→올리브(주황과 구분), 빨강→자홍 쪽, 보조 점선 진하게, 회색 면 옅게.
- 결과: 111쪽(빈 쪽 8, 쪽수 배수 16에 1쪽 모자람), 변환 경고 0. 원고에 빈칸·해설이 없어 교사용·학생용이 같다.
- **남은 문제**: ✓ 場 ∝ ⊙ 네 글자가 테마 글꼴에 없어 시스템 글꼴(Unifont, WenQuanYi)로 찍힘 → 7단계 전에 글꼴 대체 목록 정하기. 원고의 "화면 밖(⊙)" 같은 화면 표현 7줄(종이에서는 보통 "지면").
- textbooks 쓰기 권한이 이 세션에 없어 `books/bridge/`는 아직 저장소에 올리지 못함(로컬 생성만).
