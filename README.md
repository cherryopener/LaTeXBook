# 교재 편집기 (LaTeXBook)

마크다운과 LaTeX 수식으로 교재 원고를 쓰고, 인쇄될 페이지를 옆에서 바로 보면서 교사용·학생용 PDF를 만드는 웹 편집기입니다.

- 왼쪽: 원고 편집(도구 막대 단추로 빈칸·수식·상자·그림·그래프·문제를 넣음)
- 오른쪽: 인쇄 미리보기(입력을 멈추면 곧 다시 그림)
- 원고 저장소: 비공개 GitHub 저장소(`cherryopener/textbooks`). 어느 컴퓨터에서든 브라우저만 있으면 불러오고 저장합니다.
- 판: 교사용(빈칸 답·해설 보임) / 학생용(빈칸 밑줄, 해설 자리는 풀이 공간). 두 판의 쪽 번호가 같습니다.
- 판형: A4, 216×303mm(A4 + 사방 재단 여유 3mm)

## 쓰는 법

1. 편집기 주소를 엽니다(Chrome 권장). 처음에는 저장되지 않는 **견본 책**이 열립니다.
2. 오른쪽 위 **GitHub 연결** → 안내에 따라 토큰을 만들어 붙여 넣습니다.
   - 토큰은 `cherryopener/textbooks` 저장소 하나에, **Contents: Read and write** 권한만 줍니다.
   - 토큰은 그 브라우저에만 저장되고 GitHub 말고는 어디에도 보내지 않습니다. 대화창·메일에 붙여 넣지 마세요.
   - 공용 컴퓨터에서는 "이 컴퓨터에 기억하기"를 끄세요. 컴퓨터를 잃어버리면 GitHub 토큰 화면에서 지우면 됩니다.
3. 위쪽에서 장을 고르고 원고를 고칩니다. 몇 초마다 브라우저에 임시 저장되고, **저장**(⌘S / Ctrl+S)을 누르면 GitHub에 저장(커밋)됩니다.
4. **PDF로 저장**: 판(교사용·학생용)과 판형을 고른 뒤 누르면 인쇄 창이 열립니다. 대상을 "PDF로 저장"으로 고릅니다.

### 원고 문법 요약

자세한 것은 [docs/FORMAT.md](docs/FORMAT.md). 문법을 외우지 않아도 도구 막대 단추가 틀을 넣어 줍니다.

| 쓰는 법 | 결과 |
|---|---|
| `$F = ma$`, `$$ … $$` | 수식 |
| `$$ … \label{이름} $$`, `:ref[이름]` | 번호 붙은 수식과 참조 |
| `:blank[알짜힘]` | 학생용에서 글자 수만큼 빈칸(⌘U) |
| `:::note[제목]` … `:::` | 상자(note·tip·warn·think) |
| `:::side[용어]` … `:::` | 옆 좁은 단의 용어 풀이 |
| `::fig[설명]{src=images/a.svg w=80}` | 그림 |
| ```` ```plot ```` 블록 | 함수 그래프(칠하기·기울기 삼각형) |
| `::problems` | 여기부터 문제 구간(대칭 2단, 한 단에 한 문항) |
| `::::problem` … `:::solution` … `:::` … `::::` | 문항과 해설(해설은 교사용에만) |
| `:::teacher` … `:::` | 교사용에만 보이는 메모 |

Physiklar 원고의 퀴즈·웹 실험과 "실험으로 확인하기", "직접 해 보기" 절은 인쇄에서 자동으로 빠집니다.

## 문서

- [docs/HANDOFF.md](docs/HANDOFF.md): 새 세션 인수인계(지금 상태와 다음 할 일)
- [docs/PLAN.md](docs/PLAN.md): 구축 계획과 진행 상황
- [docs/DECISIONS.md](docs/DECISIONS.md): 결정 사항과 근거
- [docs/FORMAT.md](docs/FORMAT.md): 원고 형식 명세
- [docs/INTERFACES.md](docs/INTERFACES.md): 모듈 사이 약속(개발용)

## 개발

- 배포에는 빌드가 없습니다. 저장소를 그대로 GitHub Pages에 올립니다.
- `npm install` 후 `npm test`: 모든 시험(브라우저 시험은 Playwright).
- `npm run bundle`: `vendor/` 묶음 파일 다시 만들기.

## 라이선스

이 저장소의 코드는 Apache-2.0입니다(`LICENSE`). 단, `vendor/vivliostyle.js`는 AGPL-3.0인 Vivliostyle.js를 묶은 것이므로 이를 포함한 편집기 전체는 AGPL 조건을 따릅니다([docs/DECISIONS.md](docs/DECISIONS.md) 4절, [vendor/README.md](vendor/README.md)). 원고와 글꼴은 이 저장소에 없습니다.
