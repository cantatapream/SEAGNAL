#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선박종류 세분화(원양어선·산적화물선) 독립 재대조기 (H-32 설계 §13.7).

역할(초보자용):
  빌더(build_vessel_doc_tree.py)가 새로 만든 선박종류 노드 2개(원양어선·산적화물선)와
  그 노드에 달린 서류·장비 항목, 그리고 노드 출처(provenance)의 인용문이 정말 raw 원문에
  있는 말인지 **빌더와 전혀 다른 방법으로** 다시 확인한다. 빌더의 조문분리·인용추출 함수를
  일절 import하지 않고, raw 파일을 통짜 문자열로 읽어 문자열 검색만으로 대조한다.
  "구현자가 만든 테스트는 구현자의 가정을 공유한다"(L-75)를 피하기 위한 두 번째 눈이다.

검사 항목(설계 §13.7):
  1. 새 노드가 예상한 자리(부모·형제)에 있고, 부모의 `선택지`가 자식과 1:1로 맞는가
  2. 새 노드의 `provenance`·`구분근거` 인용문이 그 `조문` 구간 안에 실재하는가
     (조문 경계를 빌더와 다른 방식 — 줄머리 마커 스캔 — 으로 따로 구해 확인)
  3. 새 노드에 달린 서류·장비 항목의 `인용`(과 `수량조건`)이 그 조문 구간 안에 실재하는가
  4. 행정규칙 근거는 `고시명`·`고시ID`가 그 법의 `행정규칙/_admrul.json`과 일치하는가
  5. ★"상선"의 정의 조문이 caveats가 말한 그 자리에 그 건수만큼 있는지 74법 raw를 다시 훑어 확인한다
     (caveats가 주장하는 사실을 스크립트가 매번 다시 증명한다 — 이 검사가 실제로 초안의
      "0건" 주장을 뒤집어 「선박직원법 시행령」 제2조제3호를 찾아냈다)
  6. 트리 전체 불변식 — 비-리프의 선택지 ≤3, `선택지[].next`가 실재 자식 id

[연계]
  읽기: _dashboard/vessel_doc_tree.json · raw/**/{법률,시행령,시행규칙}.txt · raw/**/행정규칙/*.txt
  설계: _dashboard/H32_vessel_doc_tree_design.md §13

실행: python3 local_server/knowledge/legal/_dashboard/loop/verify_vessel_subtypes.py
      (실패 0건이면 exit 0, 하나라도 실패하면 목록을 찍고 exit 1)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
T = json.load(open(os.path.join(LEGAL, '_dashboard/vessel_doc_tree.json'), encoding='utf-8'))
norm = lambda s: re.sub(r'\s+', ' ', s)

# 이번 라운드에서 새로 세운 노드와 그 예상 자리(부모 id → 자식 id 순서).
NEW = {'ocean_fishing_vessel': ('fishing_vessel', ['angling_vessel', 'ocean_fishing_vessel',
                                                   'other_fishing_vessel']),
       'bulk_carrier': ('cargo_ship', ['tanker', 'bulk_carrier', 'other_cargo'])}

fail = []


def walk(n, parent=None):
    yield n, parent
    for c in n.get('children', []):
        yield from walk(c, n)


def article_span(text, art, is_admrul):
    """근거조문의 원문 구간을 독립적으로 계산한다(빌더와 다른 방식: 줄머리 마커 위치 스캔)."""
    m = re.match(r'제(\d+)조(?:의(\d+))?$', art)
    if not m:
        return None
    num, branch = m.group(1), m.group(2)
    if is_admrul:
        pat = r'^제%s조%s\s*\(' % (num, ('의' + branch) if branch else '(?!의)')
    else:
        pat = r'^\[제%s조%s\]' % (num, ('의' + branch) if branch else '(?!의)')
    lines = text.split('\n')
    start = None
    for i, ln in enumerate(lines):
        if re.match(pat, ln.strip()):
            start = i
            break
    if start is None:
        return None
    nxt = r'^제\d+조(의\d+)?\s*\(' if is_admrul else r'^\[제\d+조(의\d+)?\]'
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if re.match(nxt, lines[j].strip()):
            end = j
            break
    return '\n'.join(lines[start:end])


def check_quote(tag, path, article, quote, extra=None):
    """인용(과 부가 문구)이 그 조문 구간 안에 실재하는지 파일을 직접 열어 확인한다."""
    p = os.path.join(LEGAL, path)
    if not os.path.exists(p):
        fail.append('%s: 파일 없음 %s' % (tag, path))
        return
    text = open(p, encoding='utf-8', errors='replace').read()
    if norm(quote) not in norm(text):
        fail.append('%s: 인용이 파일 원문에 없음' % tag)
        return
    is_adm = '/행정규칙/' in path.replace('\\', '/')
    span = article_span(text, article, is_adm)
    if span is None:
        fail.append('%s: 근거조문 마커를 파일에서 못 찾음' % tag)
        return
    nspan = norm(span)
    if norm(quote) not in nspan:
        fail.append('%s: 인용이 그 조문 구간 밖에 있음' % tag)
    for e in (extra or []):
        if e and norm(e) not in nspan:
            fail.append('%s: 부가 문구가 그 조문 구간에 없음 ← "%s"' % (tag, e))


def check_admrul_id(tag, path, notice, nid):
    """고시명·고시ID가 그 법의 _admrul.json과 맞는지 확인한다."""
    p = os.path.join(LEGAL, path)
    ap = os.path.join(os.path.dirname(p), '_admrul.json')
    meta = json.load(open(ap, encoding='utf-8')) if os.path.exists(ap) else {}
    flat = {re.sub(r'\s+', '', k): v for k, v in meta.items()}
    got = (flat.get(re.sub(r'\s+', '', notice)) or {}).get('ID')
    if got != nid:
        fail.append('%s: 고시ID 불일치(json=%s, tree=%s)' % (tag, got, nid))
    if os.path.basename(p) != notice + '.txt':
        fail.append('%s: 고시명과 파일명 불일치' % tag)


nodes = {n['id']: (n, p) for n, p in walk(T['tree'])}
checked = 0

# ── 1. 새 노드가 예상한 자리에 있는가 ────────────────────────────────
for nid, (parent_id, order) in NEW.items():
    if nid not in nodes:
        fail.append('새 노드 없음: %s' % nid)
        continue
    n, parent = nodes[nid]
    if not parent or parent['id'] != parent_id:
        fail.append('%s: 부모가 %s가 아님' % (nid, parent_id))
        continue
    got = [c['id'] for c in parent['children']]
    if got != order:
        fail.append('%s: 형제 순서가 다름 %s' % (nid, got))
    labels = [o['label'] for o in parent['선택지']]
    nexts = [o.get('next') for o in parent['선택지']]
    if nexts != order:
        fail.append('%s: 부모 선택지 next가 자식 순서와 다름 %s' % (nid, nexts))
    if len(labels) != len(got):
        fail.append('%s: 부모 선택지 수 ≠ 자식 수' % nid)
    if n.get('children'):
        fail.append('%s: 새 노드가 리프가 아님' % nid)

# ── 2·3·4. 새 노드의 출처·항목 전량 재대조 ──────────────────────────
for nid in NEW:
    if nid not in nodes:
        continue
    n = nodes[nid][0]
    for key in ('provenance', '구분근거'):
        for pv in n.get(key, []):
            checked += 1
            art = re.match(r'(제\d+조(?:의\d+)?)', pv['조문']).group(1)
            tag = '%s.%s %s %s' % (nid, key, pv['법령'], pv['조문'])
            check_quote(tag, pv['파일'], art, pv['인용'])
            if pv['계층'] == '행정규칙':
                check_admrul_id(tag, pv['파일'], pv['고시명'], pv['고시ID'])
    for d in n.get('서류', []):
        checked += 1
        tag = '%s.서류 %s' % (nid, d['서류명'])
        check_quote(tag, d['파일'], d['근거조문'], d['인용'])
    for d in n.get('장비', []):
        checked += 1
        tag = '%s.장비 %s' % (nid, d['장비명'])
        check_quote(tag, d['파일'], d['근거조문'], d['인용'], extra=[d.get('수량조건')])
        if d['계층'] == '행정규칙':
            check_admrul_id(tag, d['파일'], d['고시명'], d['고시ID'])

# ── 5. "상선"의 정의가 어디에 몇 건 있는지를 매번 다시 증명한다 ──────
#   caveat가 주장하는 사실("정의는 「선박직원법 시행령」 제2조제3호 한 곳뿐이고 그 내용은 어선의 여집합")을
#   스크립트가 raw에서 직접 세어 확인한다. 건수나 위치가 달라지면(법령 개정 등) 실패시켜 caveat를 고치게 한다.
#   ★이 검사가 실제로 결함을 잡았다: 초안 caveat는 "0건"이라고 적었는데 여기서 1건이 나왔다(설계 §13.8).
EXPECT_SANGSEON = [('선박직원법', '시행령.txt', '어선이 아닌 선박')]
RE_SANGSEON_DEF = re.compile(r'[“"”]\s*[^"“”]{0,6}상선\s*[”"“]\s*(?:이란|이라 함은|란|라 함은)')
paths = json.load(open(os.path.join(LEGAL, '_dashboard/loop/audit12_groups.json'), encoding='utf-8'))
run = json.load(open(os.path.join(LEGAL, '_dashboard/loop/audit12_groups_run.json'), encoding='utf-8'))
laws = [it for g in (paths, run) for k in sorted(g, key=int) for it in g[k]]
seen, files, hits = set(), 0, []
for law in laws:
    if law['slug'] in seen:
        continue
    seen.add(law['slug'])
    root = law['raw']
    cands = [os.path.join(root, f) for f in ('법률.txt', '시행령.txt', '시행규칙.txt')]
    adm = os.path.join(root, '행정규칙')
    if os.path.isdir(adm):
        cands += [os.path.join(adm, f) for f in sorted(os.listdir(adm)) if f.endswith('.txt')]
    for p in cands:
        if not os.path.exists(p):
            continue
        files += 1
        body = norm(open(p, encoding='utf-8', errors='replace').read())
        for m in RE_SANGSEON_DEF.finditer(body):
            hits.append((law['slug'], os.path.basename(p), body[m.start():m.start() + 80]))
if len(hits) != len(EXPECT_SANGSEON):
    fail.append('"상선" 정의 조문 건수가 caveat와 다름 — 기대 %d건, 실측 %d건: %s'
                % (len(EXPECT_SANGSEON), len(hits), [h[:2] for h in hits]))
else:
    for (gs, gf, gt), (es, ef, et) in zip(hits, EXPECT_SANGSEON):
        if gs != es or gf != ef or et not in gt:
            fail.append('"상선" 정의 위치/내용이 caveat와 다름 — 기대 %s/%s "%s", 실측 %s/%s "%s"'
                        % (es, ef, et, gs, gf, gt))

# ── 6. 트리 전체 불변식 ─────────────────────────────────────────────
for n, _ in walk(T['tree']):
    kids = n.get('children', [])
    if not kids:
        continue
    if len(n.get('선택지', [])) > 3:
        fail.append('%s: 선택지 3개 초과' % n['id'])
    kid_ids = {c['id'] for c in kids}
    for o in n.get('선택지', []):
        if o.get('next') not in kid_ids:
            fail.append('%s: 선택지 next가 자식이 아님 → %s' % (n['id'], o.get('next')))

print('독립 재대조(선박종류 세분화): 새 노드 %d개 · 인용 %d건 검사 · 실패 %d건'
      % (len(NEW), checked, len(fail)))
print('  "상선" 정의 조문 재확인: %d법 %d파일 스캔 → 정의 %d건(기대 %d건) %s'
      % (len(seen), files, len(hits), len(EXPECT_SANGSEON), [h[:2] for h in hits]))
for f in fail:
    print('  -', f)
sys.exit(1 if fail else 0)
