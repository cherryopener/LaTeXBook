#!/usr/bin/env python3
"""docx(저자의 Word 교재) → LaTeXBook 책 원고(.md) 기계 변환.

쓰는 법: python3 -I tools/import-docx.py <원본.docx> <설정.json> <출력 책 폴더> <보고.json>

- 단락 스타일로 구조를 읽는다: Chapter1(=부 표지 번호) / Chapter1Text(부 제목) / Chapter2Text(장 목록)
  / Body1(##) / Body2(###) / BodySectionSign(#### §) / BodyMain(본문) / BodyEquation(수식) / BodyBullet(목록)
  / SideTitle·SideBody·SideEquation(옆 단) / BodyTable*(표) / Problem*·Choice*(문제: 뺌).
- 수식(OMML)은 pandoc이 LaTeX로 바꾼다. 단락마다 표지 글자(⟦P:스타일|번호⟧)를 넣어 pandoc 결과에서 스타일을 되찾는다.
- 본문 글자는 바꾸지 않는다(서식 견본 글자만 뺌, 보고서에 적음).
"""
import json, os, re, shutil, subprocess, sys, tempfile, zipfile
from html import unescape

SRC, CONF, OUT, REPORT = sys.argv[1:5]
conf = json.load(open(CONF, encoding="utf8"))
JUNK = set(conf.get("junk", []))  # 빼는 서식 견본 글자(단락 전체가 이 글자일 때)

tmp = tempfile.mkdtemp()
with zipfile.ZipFile(SRC) as z:
    z.extractall(tmp)
W = os.path.join(tmp, "word")
doc = open(os.path.join(W, "document.xml"), encoding="utf8").read()
rels = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', open(os.path.join(W, "_rels/document.xml.rels"), encoding="utf8").read()))
styles_xml = open(os.path.join(W, "styles.xml"), encoding="utf8").read()
numbering_xml = open(os.path.join(W, "numbering.xml"), encoding="utf8").read() if os.path.exists(os.path.join(W, "numbering.xml")) else ""

# ---------- 번호 매기기(글머리표) 정보 ----------
abstract = {}
for m in re.finditer(r'<w:abstractNum [^>]*w:abstractNumId="(\d+)".*?</w:abstractNum>', numbering_xml, re.S):
    lv = {}
    for l in re.finditer(r'<w:lvl [^>]*w:ilvl="(\d+)".*?</w:lvl>', m.group(0), re.S):
        fmt = re.search(r'<w:numFmt w:val="([^"]+)"', l.group(0))
        txt = re.search(r'<w:lvlText w:val="([^"]*)"', l.group(0))
        lv[int(l.group(1))] = (fmt.group(1) if fmt else "", txt.group(1) if txt else "")
    abstract[m.group(1)] = lv
nums = {n: a for n, a in re.findall(r'<w:num w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"', numbering_xml)}
style_num, based_on = {}, {}
for m in re.finditer(r'<w:style [^>]*w:styleId="([^"]+)".*?</w:style>', styles_xml, re.S):
    n = re.search(r'<w:numId w:val="(\d+)"', m.group(0))
    il = re.search(r'<w:ilvl w:val="(\d+)"', m.group(0))
    b = re.search(r'<w:basedOn w:val="([^"]+)"', m.group(0))
    if b: based_on[m.group(1)] = b.group(1)
    if n: style_num[m.group(1)] = (n.group(1), int(il.group(1)) if il else 0)
for st in list(based_on):  # 번호 매기기는 바탕 스타일에서 물려받는다
    cur, seen = st, set()
    while cur not in style_num and cur in based_on and cur not in seen:
        seen.add(cur); cur = based_on[cur]
    if st not in style_num and cur in style_num: style_num[st] = style_num[cur]

def num_kind(num_id, ilvl):
    a = abstract.get(nums.get(num_id, ""), {})
    fmt, txt = a.get(ilvl, ("", ""))
    if num_id == "0" or not fmt: return ""
    if fmt == "bullet":
        return "bullet"  # 글머리표 모양(•, ▪, Wingdings 등)은 모두 목록으로
    if fmt == "decimal" and re.fullmatch(r"%\d\.", txt): return "decimal"
    return "fmt:" + fmt + ":" + txt

# ---------- 그림 정보 ----------
images = []  # i → dict
def drawing_repl(m):
    d = m.group(0)
    e = re.search(r'<wp:extent cx="(\d+)" cy="(\d+)"', d)
    r = re.search(r'r:embed="(rId\d+)"', d)
    if not (e and r): return ""
    crop = re.search(r'<a:srcRect ([^/]*)/>', d)
    crop = {k: int(v) for k, v in re.findall(r'(\w)="(-?\d+)"', crop.group(1))} if crop else {}
    images.append({"target": rels[r.group(1)], "cx": int(e.group(1)), "cy": int(e.group(2)), "anchor": "<wp:anchor" in d, "crop": crop})
    return f'<w:t xml:space="preserve">⟦IMG:{len(images)-1}⟧</w:t>'

# Wingdings 기호(w:sym)를 글자로(▪ 글머리, ➔ 화살표 등)
SYM = {("Wingdings", "F0A7"): "▪", ("Wingdings", "F0E8"): "→", ("Wingdings", "F0E0"): "→", ("Wingdings", "F0D8"): "➢",
       ("Wingdings", "F0FC"): "✓", ("Wingdings", "F06C"): "●", ("Symbol", "F0B7"): "•", ("Wingdings 3", "F0C6"): "→"}
def sym_repl(m):
    ch = SYM.get((m.group(1), m.group(2).upper()), "")
    if not ch: print("모르는 기호:", m.group(1), m.group(2), file=sys.stderr)
    return f'<w:t xml:space="preserve">{ch}</w:t>' if ch else ""
doc = re.sub(r'<w:sym w:font="([^"]+)" w:char="([0-9A-Fa-f]+)"\s*/>', sym_repl, doc)
# 장식 사각형(wps)은 통째로 지운다
doc = re.sub(r'<mc:AlternateContent>.*?</mc:AlternateContent>', "", doc, flags=re.S)
doc = re.sub(r'<w:drawing>.*?</w:drawing>', drawing_repl, doc, flags=re.S)
doc = doc.replace('<w:br w:type="column"/>', '<w:t xml:space="preserve">⟦COL⟧</w:t>')
doc = doc.replace('<w:br w:type="page"/>', '<w:t xml:space="preserve">⟦PG⟧</w:t>')

def para_repl(m):
    p = m.group(0)
    s = re.search(r'<w:pStyle w:val="([^"]+)"', p)
    st = s.group(1) if s else "Normal"
    n = re.search(r'<w:numPr>.*?</w:numPr>', p, re.S)
    kind = ""
    if n:
        ni = re.search(r'<w:numId w:val="(\d+)"', n.group(0)); il = re.search(r'<w:ilvl w:val="(\d+)"', n.group(0))
        kind = num_kind(ni.group(1) if ni else "0", int(il.group(1)) if il else 0)
        lvl = int(il.group(1)) if il else 0
    elif st in style_num:
        kind = num_kind(*style_num[st]); lvl = style_num[st][1]
    else: lvl = 0
    p = re.sub(r'<w:numPr>.*?</w:numPr>', "", p, flags=re.S)
    mark = f'<w:r><w:t xml:space="preserve">⟦P:{st}|{kind}|{lvl}⟧</w:t></w:r>'
    if "</w:pPr>" in p: return p.replace("</w:pPr>", "</w:pPr>" + mark, 1)
    return re.sub(r'^(<w:p[^>]*>)', r'\1' + mark, p)

doc = re.sub(r'<w:p[ >](?:(?!<w:p[ >]).)*?</w:p>', para_repl, doc, flags=re.S)
# 스타일 자체의 번호 매기기를 끈다(pandoc이 목록으로 묶지 않게)
styles_xml2 = re.sub(r'<w:numPr>.*?</w:numPr>', "", styles_xml, flags=re.S)
open(os.path.join(W, "document.xml"), "w", encoding="utf8").write(doc)
open(os.path.join(W, "styles.xml"), "w", encoding="utf8").write(styles_xml2)
mod = os.path.join(tmp, "mod.docx")
with zipfile.ZipFile(mod, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(tmp):
        for f in files:
            full = os.path.join(root, f)
            if full == mod: continue
            z.write(full, os.path.relpath(full, tmp))
ast = json.loads(subprocess.run(["pandoc", "-f", "docx", "-t", "json", mod], capture_output=True, check=True).stdout)

# ---------- pandoc 인라인 → 마크다운 ----------
def esc(s):
    s = s.replace("\\", "\\\\").replace("*", "\\*").replace("_", "\\_").replace("$", "\\$").replace("[", "\\[").replace("]", "\\]").replace("`", "\\`")
    return s

def tex_hangul(t):
    """수식 속 한글은 \\text{}로, ℃·℉는 도 기호 + 글자로(KaTeX 글꼴에 없음)."""
    t = t.replace("℃", "{^\\circ}\\text{C}").replace("℉", "{^\\circ}\\text{F}")
    return re.sub(r"[가-힣]+(?:(?:\\ |\s)+[가-힣]+)*", lambda m: "\\text{" + m.group(0).replace("\\ ", " ") + "}", t)

def tex_fix(t, display=False):
    t = tex_hangul(t.strip())
    if display and "\n" in t:
        # 여러 줄 수식({식1\n}{식2}) → gathered
        segs = [x.strip() for x in re.split(r"\n\s*\}\s*\{", t)]
        if len(segs) > 1:
            segs[0] = segs[0][1:] if segs[0].startswith("{") else segs[0]
            segs[-1] = segs[-1][:-1] if segs[-1].endswith("}") else segs[-1]
            segs = [re.sub(r"\\ $", "", re.sub(r"\s*\n\s*", " ", x)).strip() for x in segs]
            return "\\begin{gathered}" + " \\\\ ".join(segs) + "\\end{gathered}"
    t = re.sub(r"\s*\n\s*", " ", t).strip()
    if t.endswith("\\") and not t.endswith("\\\\"): t = t[:-1].rstrip()  # 끝에 홀로 남은 \
    return t

def inl(xs):
    out = []
    for x in xs:
        t, c = x["t"], x.get("c")
        if t == "Str": out.append(esc(c))
        elif t == "Space": out.append(" ")
        elif t == "SoftBreak": out.append(" ")
        elif t == "LineBreak": out.append("⟦BR⟧")
        elif t == "Math":
            kind = c[0]["t"]; tex = tex_fix(c[1], kind == "DisplayMath")
            if not tex: continue
            out.append(("⟦DM⟧" + tex + "⟦/DM⟧") if kind == "DisplayMath" else ("$" + tex + "$"))
        elif t == "Strong":
            s = inl(c)
            out.append(f"**{s}**" if s.strip() else s)
        elif t == "Emph":
            s = inl(c)
            out.append(f"*{s}*" if s.strip() else s)
        elif t in ("Underline", "SmallCaps", "Strikeout"): out.append(inl(c))
        elif t == "Span": out.append(inl(c[1]))
        elif t == "Superscript": out.append("⟦SUP⟧" + inl(c) + "⟦/SUP⟧")
        elif t == "Subscript": out.append("⟦SUB⟧" + inl(c) + "⟦/SUB⟧")
        elif t == "Quoted":
            q = '"' if c[0]["t"] == "DoubleQuote" else "'"
            out.append(q + inl(c[1]) + q)
        elif t == "Link": out.append(inl(c[1]))
        elif t == "Image": pass  # 그림은 ⟦IMG⟧ 표지로 따로 처리
        elif t == "Note": pass
        elif t == "Code": out.append(esc(c[1]))
        elif t == "RawInline": pass
        else: out.append(f"⟦?{t}⟧")
    return "".join(out)

# 블록을 단락 목록으로 평탄화. 표는 ("TABLE", rows) 하나로.
items = []
def para_text_split(s):
    # 한 pandoc 단락 안에 표지가 여러 개(드묾)일 수 있으므로 나눈다
    parts = re.split(r"(⟦P:[^⟧]*⟧)", s)
    res, cur = [], None
    for p in parts:
        m = re.fullmatch(r"⟦P:([^|]*)\|([^|]*)\|(\d+)⟧", p)
        if m:
            cur = {"style": m.group(1), "num": m.group(2), "lvl": int(m.group(3)), "text": ""}
            res.append(cur)
        elif p:
            if cur is None:
                cur = {"style": "?", "num": "", "lvl": 0, "text": ""}; res.append(cur)
            cur["text"] += p
    return res

def blocks_to_paras(bs):
    out = []
    for b in bs:
        t, c = b["t"], b.get("c")
        if t in ("Para", "Plain"): out += para_text_split(inl(c))
        elif t == "Header": out += para_text_split(inl(c[2]))
        elif t in ("BulletList", "OrderedList"):
            lst = c if t == "BulletList" else c[1]
            for it in lst: out += blocks_to_paras(it)
        elif t in ("Div", "BlockQuote"): out += blocks_to_paras(c[1] if t == "Div" else c)
        elif t == "Table":
            out.append({"style": "TABLE", "rows": table_rows(c)})
        elif t == "HorizontalRule": pass
        else: out.append({"style": "?", "text": f"⟦?{t}⟧", "num": "", "lvl": 0})
    return out

def table_rows(c):
    rows = []
    head, bodies, foot = c[3], c[4], c[5]
    def row_cells(r):
        return [blocks_to_paras(cell[4]) for cell in r[1]]
    for r in head[1]: rows.append(row_cells(r))
    for body in bodies:
        for r in body[2]: rows.append(row_cells(r))
        for r in body[3]: rows.append(row_cells(r))
    for r in foot[1]: rows.append(row_cells(r))
    return rows

items = blocks_to_paras(ast["blocks"])

# ---------- 구조 읽기 ----------
report = {"junk": [], "dropped_normal": [], "warnings": [], "chapters": [], "images": []}
parts = []  # 부: {title, chapters:[titles], blocks per chapter}
state = "pre"  # pre → cover → concept → problems
cur_part = None
chap_i = -1
problems_seen = False
concept_since_problems = False

def is_problem_style(s): return s.startswith("Problem") or s.startswith("Choice")

def clean(t):
    return t.replace("⟦COL⟧", "").replace("⟦PG⟧", "")

seq = []  # (부 index, 장 index, item)
for it in items:
    st = it["style"]
    if st == "TABLE":
        # 표 속 단락 스타일로 판단: Body 스타일이 하나라도 있으면 개념 표
        inner = [p for row in it["rows"] for cell in row for p in cell]
        sts = [p["style"] for p in inner if p.get("style")]
        if not any(s.startswith("Body") for s in sts):
            if state == "concept" and any(is_problem_style(s) for s in sts): state = "problems"
            continue
        if state != "concept": continue
        seq.append((len(parts) - 1, chap_i, it))
        continue
    text = clean(it.get("text", ""))
    plain = re.sub(r"⟦[^⟧]*⟧", "", text).strip()
    if st == "Chapter1":
        if plain.isdigit():
            cur_part = {"no": plain, "title_lines": [], "chapters": []}; parts.append(cur_part); state = "cover"; chap_i = -1
        continue
    if st == "Chapter1Text":
        if plain: cur_part["title_lines"].append(plain)
        continue
    if st == "Chapter2Text":
        if plain: cur_part["chapters"].append(re.sub(r"^\d+\.\s*", "", plain))
        continue
    if state == "pre": continue
    if is_problem_style(st):
        if state == "concept": state = "problems"
        continue
    if st in ("Normal", "?") and state == "problems":
        continue
    if st in ("Normal",) and plain and re.fullmatch(r"문제\d*", plain):
        state = "problems"; continue
    if plain in JUNK or plain.startswith("프라블럼"):
        report["junk"].append(plain); continue
    starts = st in ("SideTitle", "Body1") and (plain or "⟦IMG:" in text)
    if state == "cover":
        if starts: state = "concept"; chap_i = 0
        else: continue
    elif state == "problems":
        if starts: state = "concept"; chap_i += 1
        else:
            if st.startswith(("Body", "Side")) and plain: report["warnings"].append("문제 구간 속 본문 스타일(뺌): " + plain[:30])
            continue
    seq.append((len(parts) - 1, chap_i, it))

# ---------- 장마다 마크다운 만들기 ----------
BODY_W_IN = conf.get("bodyWidthIn", 5.25)
SIDE_W_IN = conf.get("sideWidthIn", 1.45)
os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
img_count = {}

def save_image(i, part_no):
    im = images[i]
    src = os.path.join(W, im["target"])
    ext = os.path.splitext(src)[1].lower().replace(".jpeg", ".jpg")
    img_count[part_no] = img_count.get(part_no, 0) + 1
    name = f"{part_no}-fig{img_count[part_no]:02d}"
    if im.get("crop"):  # docx에서 일부만 잘라 쓴 그림(1/100000 단위)
        from PIL import Image
        c = im["crop"]; pic = Image.open(src); pic.seek(0)
        if ext == ".gif": pic = pic.convert("RGBA")
        Wd, Ht = pic.size
        box = (round(Wd * c.get("l", 0) / 1e5), round(Ht * c.get("t", 0) / 1e5), round(Wd * (1 - c.get("r", 0) / 1e5)), round(Ht * (1 - c.get("b", 0) / 1e5)))
        ext2 = ".png" if ext == ".gif" else ext
        dst = os.path.join(OUT, "images", name + ext2)
        pic.crop(box).save(dst)
        report["images"].append({"file": name + ext2, "from": im["target"], "note": f"잘라 씀 {c}"})
        return "images/" + os.path.basename(dst)
    if ext == ".gif":
        dst = os.path.join(OUT, "images", name + ".png")
        subprocess.run(["convert", src + "[0]", dst], check=True)
        report["images"].append({"file": name + ".png", "from": im["target"], "note": "GIF 첫 장면"})
    else:
        dst = os.path.join(OUT, "images", name + ext)
        shutil.copy(src, dst)
        report["images"].append({"file": name + ext, "from": im["target"]})
    return "images/" + os.path.basename(dst)

def width_pct(i, side):
    win = images[i]["cx"] / 914400
    w = win / (SIDE_W_IN if side else BODY_W_IN) * 100
    return max(15, min(100, int(round(w / 5.0) * 5)))

def fig_line(i, part_no, side=False, caption=""):
    return f"::fig[{caption}]{{src={save_image(i, part_no)} w={width_pct(i, side)}}}"

def fix_inline(s):
    """⟦BR⟧ 줄바꿈, 위·아래 첨자, 표시 수식 표지 정리."""
    s = re.sub(r"⟦SUP⟧(.*?)⟦/SUP⟧", lambda m: "$^{\\text{" + m.group(1) + "}}$" if m.group(1) else "", s)
    s = re.sub(r"⟦SUB⟧(.*?)⟦/SUB⟧", lambda m: "$_{\\text{" + m.group(1) + "}}$" if m.group(1) else "", s)
    return s

def split_imgs(text):
    """단락 글자에서 그림 표지를 뽑아낸다."""
    ids = [int(x) for x in re.findall(r"⟦IMG:(\d+)⟧", text)]
    return re.sub(r"⟦IMG:\d+⟧", "", text), ids

def para_md(p, part_no, ctx_side=False):
    """단락 하나 → (마크다운 줄 목록, 그림 줄 목록)"""
    st = p["style"]
    text, ids = split_imgs(clean(p["text"]))
    text = fix_inline(text)
    figs = [fig_line(i, part_no, ctx_side) for i in ids]
    if len(figs) > 1 and not ctx_side:
        n = len(figs)  # 나란히 놓인 그림: 칸 하나 = 단의 1/n 이므로 원래 비율 × n
        figs = [":::figs"] + [re.sub(r"w=(\d+)", lambda m: "w=" + str(min(100, int(m.group(1)) * n)), f) for f in figs] + [":::"]
    lines = []
    # 표시 수식: 단락에 수식만 있으면 $$ 블록, 글과 섞여 있으면 인라인으로
    dms = re.findall(r"⟦DM⟧(.*?)⟦/DM⟧", text)
    rest = re.sub(r"⟦DM⟧.*?⟦/DM⟧", "", text).replace("⟦BR⟧", "").strip()
    if dms and not rest:
        for d in dms: lines += ["$$", d, "$$"]
        return lines, figs
    text = re.sub(r"⟦DM⟧(.*?)⟦/DM⟧", lambda m: "$" + m.group(1) + "$", text)
    text = re.sub(r"\s*⟦BR⟧\s*", "\\\n", text).strip().strip("\\").strip()
    text = re.sub(r"[ \t]+\n", "\n", text)
    if not re.sub(r"[\s\\]", "", text): return lines, figs
    num = p.get("num", "")
    mb = re.match(r"^[▪•●]\s*", text)
    if mb and st not in ("Body1", "Body2", "BodySectionSign"):  # 글자로 들어간 글머리표(Wingdings 기호)
        text = text[mb.end():]; num = "bullet"
    if st == "Body1": lines.append("## " + text)
    elif st == "Body2": lines.append("### " + text)
    elif st == "BodySectionSign": lines.append("#### § " + text)
    elif num == "bullet":
        ind = "  " * min(p.get("lvl", 0), 2) if st != "BodyBulletindent" else "  "
        lines.append(ind + "- " + text.replace("\n", "\n" + ind + "  "))
    elif num == "decimal":
        lines.append("1. " + text)
    elif num.startswith("lit:"):
        lines.append(num[4:] + " " + text)
    else:
        if num: report["warnings"].append(f"번호 모양 모름 {num}: {text[:30]}")
        lines.append(text)
    return lines, figs

def plain_of(p):
    return re.sub(r"⟦[^⟧]*⟧|[$*\\]", "", p.get("text", ""))

def table_md(t, part_no):
    rows = t["rows"]
    inner = [p for row in rows for cell in row for p in cell]
    sts = {p["style"] for p in inner}
    texts = [[" ".join(plain_of(p).strip() for p in cell).strip() for cell in row] for row in rows]
    # 1) 공식 상자: 첫 칸이 "공식"
    if rows and rows[0] and texts[0][0] in ("공식",):
        out = []
        for row in rows:
            for cell in row[1:]:
                for p in cell:
                    l, f = para_md(p, part_no)
                    out += l + f + [""] if (l or f) else []
        return out, "공식 상자 → 본문 수식"
    # 2) 그림 표: 그림이 든 표 → :::figs (칸의 글자를 그림 설명으로)
    has_img = any("⟦IMG:" in p.get("text", "") for p in inner)
    if has_img:
        out = []
        cols = max(len(r) for r in rows)
        # 열마다 그림과 그 아래 글자를 모은다
        blocks = []
        for r_i, row in enumerate(rows):
            for c_i, cell in enumerate(row):
                ids, caps = [], []
                for p in cell:
                    tx, ii = split_imgs(clean(p["text"]))
                    ids += ii
                    cp = re.sub(r"⟦[^⟧]*⟧", "", fix_inline(tx)).strip()
                    if cp: caps.append(cp)
                blocks.append((r_i, c_i, ids, " ".join(caps)))
        # 그림 칸 바로 아래 줄 같은 열의 글자를 설명으로
        figs, used = [], set()
        for (r, c, ids, cap) in blocks:
            if ids:
                below = next((b for b in blocks if b[0] == r + 1 and b[1] == c and not b[2]), None)
                caption = cap
                if not caption and below: caption = below[3]; used.add((below[0], below[1]))
                for k, i in enumerate(ids):
                    figs.append(f"::fig[{caption if k == 0 else ''}]{{src={save_image(i, part_no)} w=100}}")
        leftovers = [b[3] for b in blocks if not b[2] and b[3] and (b[0], b[1]) not in used]
        if len(figs) > 1: out += [":::figs"] + figs + [":::"]
        else: out += figs
        for l in leftovers: out += ["", l]
        return out, "그림 표 → :::figs"
    # 3) 보통 표 → GFM
    def cell_md(cell):
        s = []
        for p in cell:
            tx, _ = split_imgs(clean(p["text"]))
            tx = fix_inline(tx)
            tx = re.sub(r"⟦DM⟧(.*?)⟦/DM⟧", lambda m: "$" + m.group(1) + "$", tx)
            tx = tx.replace("⟦BR⟧", " ").replace("|", "\\|").strip()
            if tx: s.append(tx)
        return "<br>".join(s) if False else " ".join(s)
    md = [[cell_md(c) for c in row] for row in rows]
    n = max(len(r) for r in md)
    md = [r + [""] * (n - len(r)) for r in md]
    out = ["| " + " | ".join(md[0]) + " |", "|" + "---|" * n]
    for r in md[1:]: out.append("| " + " | ".join(r) + " |")
    return out, "표"

def tokens(s):
    return [w for w in re.findall(r"[가-힣A-Za-z]{2,}", s)]

books_parts = []
for pi, part in enumerate(parts):
    part_no = pi + 1
    chs = []
    for ci, ch_title in enumerate(part["chapters"]):
        its = [it for (a, b, it) in seq if a == pi and b == ci]
        chs.append((ch_title, its))
    extra = [it for (a, b, it) in seq if a == pi and b >= len(part["chapters"])]
    if extra: report["warnings"].append(f"부 {part_no}: 장 목록보다 개념 덩어리가 많음({len(extra)}단락)")
    books_parts.append((part, chs))

def build_chapter(its, part_no):
    # 1) 옆 단 묶음과 본문 블록으로 나눈다
    blocks = []  # ("body", lines, plaintext) | ("side", lines, title)
    side = None
    for it in its:
        st = it["style"]
        if st == "TABLE":
            side = None
            l, kind = table_md(it, part_no)
            blocks.append(("body", l, "", kind)); continue
        if st == "SideTitle":
            title = re.sub(r"⟦[^⟧]*⟧", "", fix_inline(clean(it["text"]))).strip()
            _, ids = split_imgs(clean(it["text"]))
            side = {"title": title, "lines": [], "figs": [fig_line(i, part_no, True) for i in ids]}
            blocks.append(("side", side)); continue
        if st in ("SideBody", "SideEquation"):
            l, f = para_md(it, part_no, ctx_side=True)
            if not l and not f: continue
            if side is None:
                side = {"title": "", "lines": [], "figs": []}; blocks.append(("side", side))
                report["warnings"].append("제목 없는 옆 단: " + plain_of(it)[:30])
            if l: side["lines"].append("\n".join(l))
            side["figs"] += f
            continue
        side = None
        l, f = para_md(it, part_no)
        if not l and not f: continue
        kind = "head" if st in ("Body1", "Body2", "BodySectionSign") else "para"
        if f and kind == "head":
            blocks.append(("body", l, plain_of(it), kind)); blocks.append(("body", f, "", "fig"))
        else:
            blocks.append(("body", l + ([""] + f if (l and f) else f), plain_of(it), kind))
    # 2) 옆 단 묶음을 다음 본문 구간(다음 옆 단 묶음 전까지)에서 관련 문단 앞으로 옮긴다
    body = [b for b in blocks if b[0] == "body"]
    sides_at = {}  # body index → [side]
    bi = 0; k = 0
    groups = []
    while k < len(blocks):
        if blocks[k][0] == "side":
            g = []
            while k < len(blocks) and blocks[k][0] == "side": g.append(blocks[k][1]); k += 1
            start = sum(1 for b in blocks[:k] if b[0] == "body")
            groups.append((start, g))
        else: k += 1
    for gi, (start, g) in enumerate(groups):
        end = groups[gi + 1][0] if gi + 1 < len(groups) else len(body)
        end = max(end, start + 1)
        pos_prev = start
        for sd in g:
            best, best_score = None, 0
            tt = tokens(sd["title"])
            for j in range(start, min(end, len(body))):
                txt = body[j][2]
                if not txt: continue
                if sd["title"] and sd["title"] in txt: score = 100
                else: score = sum(1 for w in tt if w in txt) / max(1, len(tt)) * 10
                if score > best_score + 1e-9: best, best_score = j, score
            pos = best if (best is not None and best_score >= 5) else start
            pos = max(pos, pos_prev)
            pos_prev = pos
            sides_at.setdefault(pos, []).append(sd)
    # 3) 출력
    out = []
    for j, b in enumerate(body + [None]):
        for sd in sides_at.get(j, []):
            out += [f":::side[{sd['title']}]"] + sd["lines"] + sd["figs"] + [":::", ""]
        if b is None: break
        out += b[1] + [""]
    return out

summary = {"parts": []}
for pi, (part, chs) in enumerate(books_parts):
    part_no = pi + 1
    pconf = conf["parts"][pi]
    folder = os.path.join(OUT, f"{part_no}-{pconf['slug']}")
    os.makedirs(folder, exist_ok=True)
    title = " ".join(part["title_lines"])
    pj = {"title": title, "print": {"palette": pconf["palette"]}}
    if pconf.get("cover"): pj["print"]["cover"] = {"title": pconf["cover"]}
    json.dump(pj, open(os.path.join(folder, "part.json"), "w", encoding="utf8"), ensure_ascii=False, indent=2)
    ps = {"title": title, "chapters": []}
    for ci, (ct, its) in enumerate(chs):
        lines = build_chapter(its, part_no)
        md = "---\ntitle: " + ct + "\n---\n\n" + re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"
        fn = f"{ci+1:02d}-{pconf['chapters'][ci]}.md"
        open(os.path.join(folder, fn), "w", encoding="utf8").write(md)
        ps["chapters"].append({"file": f"{part_no}-{pconf['slug']}/{fn}", "title": ct, "paras": len(its)})
    summary["parts"].append(ps)
report["summary"] = summary
report["leftover_markers"] = sorted(set(m for f in [os.path.join(r, x) for r, _, xs in os.walk(OUT) for x in xs if x.endswith(".md")] for m in re.findall(r"⟦[^⟧]*⟧", open(f, encoding="utf8").read())))
json.dump(report, open(REPORT, "w", encoding="utf8"), ensure_ascii=False, indent=2)
shutil.rmtree(tmp)
print(json.dumps(summary, ensure_ascii=False, indent=1))
print("junk:", report["junk"]); print("warnings:", report["warnings"][:20]); print("markers:", report["leftover_markers"])
