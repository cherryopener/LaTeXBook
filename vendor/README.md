# vendor

npm 패키지를 묶어 만든 파일입니다. 직접 고치지 않습니다. 다시 만들기: `npm install && npm run bundle` (`tools/bundle.mjs`).

| 파일 | 내용 | 라이선스 |
|---|---|---|
| `remark.js` | unified, remark-parse/gfm/math/directive, remark-rehype, rehype-katex/stringify, unist-util-visit, KaTeX 0.16.47 | MIT |
| `vivliostyle.js` | @vivliostyle/core 2.46.0 | **AGPL-3.0** — <https://github.com/vivliostyle/vivliostyle.js> |
| `codemirror.js` | CodeMirror 6 | MIT |

Vivliostyle.js는 AGPL-3.0입니다. 이 파일을 포함해 배포하는 편집기 전체는 AGPL 조건을 따릅니다(docs/DECISIONS.md 4절). 원본 소스는 위 주소에 있습니다.
