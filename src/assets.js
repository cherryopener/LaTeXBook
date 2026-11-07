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

// 본문·옆 단의 영어 글자용 글꼴(외국 소설책 느낌). 로마자와 숫자만 이 글꼴로, 한글은 본문 글꼴 그대로.
// 숫자는 테마가 lining-nums(높이가 가지런한 숫자)로 찍는다(2026-11-07 사용자 요청).
// Tinos: Times New Roman과 글자 폭이 같은 Apache-2.0 글꼴. EB Garamond: 소설책에 흔한 가라몬드(OFL)
export const LATIN_FONTS = {
  "Tinos": { pkg: "@fontsource/tinos@5.3.0", file: "tinos" },
  "EB Garamond": { pkg: "@fontsource/eb-garamond@5.3.0", file: "eb-garamond" },
};
const LATIN_RANGE = "U+0030-0039, U+0041-005A, U+0061-007A, U+00C0-00D6, U+00D8-00F6, U+00F8-024F, U+2018-201E";
/** 영어 글꼴 @font-face(가족 이름 "BookLatin") */
export function latinFontCss(name = "Tinos") {
  const f = LATIN_FONTS[name] ?? LATIN_FONTS.Tinos;
  return [400, 700].flatMap((w) => ["normal", "italic"].map((st) => ["latin", "latin-ext"].map((sub) =>
    `@font-face { font-family: "BookLatin"; font-style: ${st}; font-weight: ${w}; font-display: block; ` +
    `src: url("${CDN}/${f.pkg}/files/${f.file}-${sub}-${w}-${st}.woff2") format("woff2"); unicode-range: ${LATIN_RANGE}; }`).join("\n"))).join("\n");
}

export const KATEX_CSS = `${CDN}/katex@0.16.47/dist/katex.min.css`;

/** 인쇄 문서 <head>에 넣을 공통 스타일시트 주소 목록 (테마 CSS는 layout이 덧붙인다) */
export const BASE_STYLESHEETS = [
  FONT_CSS.pretendard, FONT_CSS.notoSerifKr400, FONT_CSS.notoSerifKr700,
  FONT_CSS.rubikGlitch, FONT_CSS.wallpoet, FONT_CSS.rajdhani500, FONT_CSS.rajdhani600,
  KATEX_CSS,
];
