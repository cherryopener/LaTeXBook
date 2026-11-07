// Physiklar 그림(SVG, 어두운 바탕) 하나를 흰 종이 인쇄용 색으로 바꾼다. 대응표: tools/import-physiklar.mjs 의 RECOLOR
//   node tools/recolor-svg.mjs <입력.svg> <출력.svg>
import fs from "node:fs";
import { recolorSvg } from "./import-physiklar.mjs";
const [inp, out] = process.argv.slice(2);
if (!inp || !out) { console.error("사용: node tools/recolor-svg.mjs <입력.svg> <출력.svg>"); process.exit(2); }
const { svg, unknown } = recolorSvg(fs.readFileSync(inp, "utf8"));
fs.writeFileSync(out, svg);
if (unknown.length) { console.error(`대응표에 없는 색(그대로 둠): ${unknown.join(", ")}`); process.exit(1); }
console.log(`바꿈: ${out}`);
