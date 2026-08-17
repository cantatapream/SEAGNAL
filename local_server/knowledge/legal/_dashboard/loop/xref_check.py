#!/usr/bin/env python3
import os, re, sys, collections
WIKI = sys.argv[1] if len(sys.argv) > 1 else '.'
rels, bases = set(), {}
for dp, dn, fn in os.walk(WIKI):
    for f in fn:
        if f.endswith('.md'):
            rel = os.path.relpath(os.path.join(dp, f), WIKI)[:-3]
            rels.add(rel)
            bases.setdefault(os.path.basename(rel), []).append(rel)
LINK = re.compile(r'\[\[([^\]]+)\]\](\s*\(편입예정\))?')
ok = 0; dead = []; placeholder = 0
for dp, dn, fn in os.walk(WIKI):
    for f in fn:
        if not f.endswith('.md'): continue
        path = os.path.join(dp, f)
        cur = os.path.relpath(dp, WIKI)
        src = os.path.relpath(path, WIKI)
        for m in LINK.finditer(open(path, encoding='utf-8').read()):
            tgt = m.group(1).split('|')[0].split('\\')[0].split('#')[0].strip()
            if not tgt: continue
            cand = os.path.normpath(os.path.join(cur, tgt)) if cur != '.' else tgt
            if cand in rels or tgt in rels or ('/' not in tgt and len(bases.get(tgt, [])) == 1): ok += 1
            elif m.group(2): placeholder += 1
            else: dead.append((src, tgt))
print(f'문서 {len(rels)}개 / 링크 정상 {ok}건 / (편입예정) 표시 {placeholder}건 / 미처리 깨진링크 {len(dead)}건')
if dead:
    print('\n[파일별 집중도]')
    for p, c in collections.Counter(p for p, _ in dead).most_common(8): print(f'  {c:4d}  {p}')
    print('\n[깨진 타깃 상위]')
    for t, c in collections.Counter(t for _, t in dead).most_common(10): print(f'  {c:4d}  [[{t}]]')
sys.exit(1 if dead else 0)
