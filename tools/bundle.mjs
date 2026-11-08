// vendor/ 묶음 파일을 다시 만든다: npm install && npm run bundle
// 배포에는 빌드 단계가 없다. 여기서 만든 파일을 저장소에 그대로 넣는다(docs/DECISIONS.md 2절).
import * as esbuild from "esbuild";
import fs from "node:fs";

const banner = (name, license) => ({ js: `/* ${name} — npm 패키지 묶음. 라이선스: ${license}. 다시 만들기: npm run bundle */` });
const bundles = [
  {
    out: "vendor/remark.js",
    license: "MIT (unified·remark·rehype 계열, KaTeX)",
    // 브라우저와 Node(시험·맥에서 인쇄 PDF 만들기) 양쪽에서 돌아야 하므로 브라우저 전용 변형을 쓰지 않는다
    neutral: true,
    src: `
export { unified } from "unified";
export { default as remarkParse } from "remark-parse";
export { default as remarkGfm } from "remark-gfm";
export { default as remarkMath } from "remark-math";
export { default as remarkDirective } from "remark-directive";
export { default as remarkRehype } from "remark-rehype";
export { default as rehypeKatex } from "rehype-katex";
export { default as rehypeStringify } from "rehype-stringify";
export { visit, SKIP, CONTINUE, EXIT } from "unist-util-visit";
export { toString as mdToString } from "mdast-util-to-string";
export { toString as hastToString } from "hast-util-to-string";
export { default as katex } from "katex";
export { fromHtml } from "hast-util-from-html";
export { toHtml } from "hast-util-to-html";
`,
  },
  {
    out: "vendor/vivliostyle.js",
    license: "AGPL-3.0 (Vivliostyle.js, https://github.com/vivliostyle/vivliostyle.js)",
    src: `
import * as V from "@vivliostyle/core";
export const { CoreViewer, ReadyState, PageViewMode, ZoomType, Navigation, PageProgression, printHTML } = V;
`,
  },
  {
    out: "vendor/codemirror.js",
    license: "MIT (CodeMirror 6, @replit/codemirror-vim)",
    src: `
export { basicSetup, minimalSetup } from "codemirror";
export * from "@codemirror/state";
export * from "@codemirror/view";
export * from "@codemirror/commands";
export * from "@codemirror/language";
export * from "@codemirror/search";
export * from "@codemirror/autocomplete";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { vim, Vim, getCM } from "@replit/codemirror-vim";
`,
  },
];
for (const b of bundles) {
  await esbuild.build({
    stdin: { contents: b.src, resolveDir: ".", loader: "js" },
    bundle: true, format: "esm", minify: true, target: "es2022",
    outfile: b.out, banner: banner(b.out, b.license), logLevel: "warning",
    legalComments: "none",
    ...(b.neutral ? { platform: "neutral", mainFields: ["module", "main"], conditions: ["import", "default"] } : {}),
  });
  console.log(b.out, (fs.statSync(b.out).size / 1024).toFixed(0) + " KB");
}
