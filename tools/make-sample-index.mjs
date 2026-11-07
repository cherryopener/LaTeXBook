// samples/index.json 을 만든다: 견본 책 목록과 파일 목록(앱의 "견본 책" 모드가 씀). 견본을 바꾸면 다시 실행.
import fs from "node:fs";
import path from "node:path";
const root = "samples";
const books = [];
for (const id of fs.readdirSync(root)) {
  const dir = path.join(root, id);
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(path.join(dir, "book.json"))) continue;
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else files.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  })(dir);
  const title = JSON.parse(fs.readFileSync(path.join(dir, "book.json"), "utf8")).title ?? id;
  books.push({ id, title, files: files.sort() });
}
fs.writeFileSync(path.join(root, "index.json"), JSON.stringify({ books }, null, 1) + "\n");
console.log("samples/index.json:", books.map((b) => `${b.id}(${b.files.length})`).join(", "));
