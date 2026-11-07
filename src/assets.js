// 외부 파일 주소 모음(CDN, 버전 고정). 버전을 바꿀 때는 package.json과 함께 바꾼다.
// 시험 환경에서는 tests/lib/browser.mjs가 이 주소들을 node_modules의 같은 파일로 연결한다.
export const CDN = "https://cdn.jsdelivr.net/npm";

export const FONT_CSS = {
  pretendard: `${CDN}/pretendard@1.3.9/dist/web/static/pretendard.css`,
  notoSerifKr400: `${CDN}/@fontsource/noto-serif-kr@5.3.1/400.css`,
  notoSerifKr700: `${CDN}/@fontsource/noto-serif-kr@5.3.1/700.css`,
  rubikGlitch: `${CDN}/@fontsource/rubik-glitch@5.3.0/400.css`,
  wallpoet: `${CDN}/@fontsource/wallpoet@5.3.0/400.css`,
  rajdhani500: `${CDN}/@fontsource/rajdhani@5.3.0/500.css`,
  rajdhani600: `${CDN}/@fontsource/rajdhani@5.3.0/600.css`,
};

export const KATEX_CSS = `${CDN}/katex@0.16.47/dist/katex.min.css`;

/** 인쇄 문서 <head>에 넣을 공통 스타일시트 주소 목록 (테마 CSS는 layout이 덧붙인다) */
export const BASE_STYLESHEETS = [
  FONT_CSS.pretendard, FONT_CSS.notoSerifKr400, FONT_CSS.notoSerifKr700,
  FONT_CSS.rubikGlitch, FONT_CSS.wallpoet, FONT_CSS.rajdhani500, FONT_CSS.rajdhani600,
  KATEX_CSS,
];
