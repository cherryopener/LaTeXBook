// 책 폴더의 파일들로 BookSource(docs/INTERFACES.md 3절)를 만든다. 메인 세션 담당.
// storage(GitHub)와 시험(로컬 파일)이 함께 쓴다.
import { withPrintDefaults, partPalette } from "./types.js";

const num = (name) => { const m = /^(\d+)-/.exec(name); return m ? Number(m[1]) : Infinity; };
const byNum = (a, b) => num(a) - num(b) || a.localeCompare(b);

/**
 * @param {string} id 책 폴더 이름
 * @param {Record<string,string>} files 책 폴더 기준 경로 → 글자 내용 (book.json, <부>/part.json, <부>/<장>.md 가 있어야 함)
 * @returns {import("./types.js").BookSource}
 */
export function assembleBook(id, files) {
  const json = (p) => { try { return JSON.parse(files[p]); } catch { return {}; } };
  const config = json("book.json");
  const print = withPrintDefaults(config);
  const dirs = [...new Set(Object.keys(files).filter((p) => /^\d+-[^/]+\/[^/]+$/.test(p)).map((p) => p.split("/")[0]))].sort(byNum);
  const parts = dirs.map((dir) => {
    const pconf = json(`${dir}/part.json`);
    const chapters = Object.keys(files)
      .filter((p) => p.startsWith(`${dir}/`) && /^\d+-[^/]+\.md$/.test(p.slice(dir.length + 1)))
      .sort((a, b) => byNum(a.split("/")[1], b.split("/")[1]))
      .map((path) => ({ path, source: files[path] }));
    return { dir, config: pconf, palette: partPalette(pconf, print), chapters };
  });
  return { id, config, print, parts };
}
