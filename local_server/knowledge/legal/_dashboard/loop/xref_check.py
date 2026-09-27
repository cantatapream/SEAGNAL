#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위키 안의 `[[링크]]` 가 **정말 그 문서를 가리키나** 본다. (게이트 V5-2)

★게이트가 매번 부르는 자인데 **머리말이 없었다**(2026-09-24, G-15 실측에서 드러남).
  무엇을 하는 자인지 안 적혀 있으면, 빨간불이 떴을 때 무엇이 깨진 것인지부터 헤맨다.

세는 법
  · 대상  `wiki/` 아래 `.md` 전부(인자로 다른 폴더를 줄 수 있다)
  · 링크  `[[대상]]` · `[[대상|보일 글]]` · `[[대상#절]]` — 대상만 본다
  · 맞았다고 보는 것 셋:
      ① 지금 폴더 기준 상대경로가 문서와 맞다
      ② 저장소 뿌리 기준 경로가 맞다
      ③ 폴더 없이 이름만 썼는데 **그 이름을 가진 문서가 딱 하나**다
        (둘 이상이면 어느 것인지 알 수 없으므로 맞다고 하지 않는다)
  · `(편입예정)` 이 붙은 링크는 **깨진 것으로 세지 않는다** — 아직 안 만든 문서라고 스스로 밝힌 것
  · 그 밖은 깨진 링크. **하나라도 있으면 1 로 죽는다.**

빨간불이 뜨면 파일별 집중도와 깨진 타깃 상위 10개를 함께 찍는다 —
어디부터 고치면 되는지 알려 줘야 고치러 갈 수 있다(3-44 에서 배운 것).
"""
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
