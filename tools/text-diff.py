#!/usr/bin/env python3
"""기계 변환본(기준 커밋)과 지금 원고의 '글자' 차이만 뽑는다.
빈칸 :blank[x] → x, 굵게·정의 상자·그림 설명·옆 단 울타리 등 꾸밈은 걷어 내고 비교한다.
쓰는 법: python3 -I tools/text-diff.py <textbooks 폴더> <기준 커밋> <책 id>
"""
import difflib, re, subprocess, sys, glob, os

root, base, book = sys.argv[1:4]

def strip(s):
    s = re.sub(r"^---\n.*?\n---\n", "", s, flags=re.S)
    s = re.sub(r"::fig\[[^\]]*\]\{[^}]*\}", "", s)          # 그림 줄(설명 포함)
    s = re.sub(r"^:::+\w*(\[[^\]]*\])?\s*$", lambda m: (m.group(1) or "")[1:-1] if m.group(1) else "", s, flags=re.M)
    s = re.sub(r":blank\[([^\]]*)\]", r"\1", s)
    s = s.replace("**", "")
    s = re.sub(r"^#+\s*(§\s*)?", "", s, flags=re.M)
    s = re.sub(r"^\s*[-*]\s+", "", s, flags=re.M)
    s = re.sub(r"\\([\[\]*_$`\\])", r"\1", s)
    return s

def tokens(s):
    # 수식은 한 덩어리, 나머지는 어절
    out = []
    for m in re.finditer(r"\$\$.*?\$\$|\$[^$]*\$|\S+", s, flags=re.S):
        out.append(re.sub(r"\s+", " ", m.group(0)))
    return out

for f in sorted(glob.glob(f"{root}/books/{book}/*/*.md")):
    rel = os.path.relpath(f, root)
    old = subprocess.run(["git", "-C", root, "show", f"{base}:{rel}"], capture_output=True, text=True).stdout
    new = open(f, encoding="utf8").read()
    a, b = tokens(strip(old)), tokens(strip(new))
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    ch = [op for op in sm.get_opcodes() if op[0] != "equal"]
    print(f"## {rel}: 바뀐 곳 {len(ch)}")
    for tag, i1, i2, j1, j2 in ch:
        ctx = " ".join(a[max(0, i1 - 3):i1])
        print(f"- …{ctx} [{' '.join(a[i1:i2])}] → [{' '.join(b[j1:j2])}]")
    print()
