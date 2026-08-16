#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선박종류 트리의 `장비` 항목 전량 독립 재대조기 (H-32 장비 축 확장, 설계 §11.8).

역할(초보자용):
  빌더(build_vessel_doc_tree.py)가 만든 장비 78건이 정말 raw 원문에 있는 말인지
  **빌더와 전혀 다른 방법으로** 다시 확인한다. 빌더의 조문분리·인용추출 함수를 일절
  import하지 않고, raw 파일을 통짜 문자열로 읽어 문자열 검색만으로 대조한다.
  "구현자가 만든 테스트는 구현자의 가정을 공유한다"는 문제를 피하기 위한 두 번째 눈이다.

검사 항목(설계 §11.8):
  1. `파일` 경로가 실재하고, 그 파일 원문에 `인용`이 부분문자열로 실재하는가
  2. `수량조건`이 null이 아니면 그것도 실재하는가
  3. `인용`·`수량조건`이 정말 그 `근거조문`의 구간 안에서 나오는가
     (조문 경계를 빌더와 다른 방식 — 줄머리 마커 스캔 — 으로 따로 구해 확인)
  4. `계층`이 행정규칙이면 `고시명`·`고시ID`가 그 법의 `행정규칙/_admrul.json`과 일치하는가
  5. `요건유형`·`수량출처` 값이 규약 집합 안에 있고, "수량 미확인"인데 수량이 채워져 있지 않은가

[연계]
  읽기: _dashboard/vessel_doc_tree.json · raw/**/{법률,시행령}.txt · raw/**/행정규칙/*.txt · _admrul.json
  설계: _dashboard/H32_vessel_doc_tree_design.md §11.8

실행: python3 local_server/knowledge/legal/_dashboard/loop/verify_vessel_equipment.py
      (실패 0건이면 exit 0, 하나라도 실패하면 목록을 찍고 exit 1)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
T = json.load(open(os.path.join(LEGAL, '_dashboard/vessel_doc_tree.json'), encoding='utf-8'))
OK_TYPE = {'비치수량', '비치', '착용'}
OK_SRC = {'조문본문', '조문본문 표(이미지판독·⚠REVIEW)', '별표·표(raw 미수집)', '해당없음(수량 규정 아님)'}
norm = lambda s: re.sub(r'\s+', ' ', s)


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def article_span(text, art, is_admrul):
    """근거조문의 원문 구간을 독립적으로 계산한다(빌더와 다른 방식: 줄머리 마커 위치 스캔)."""
    m = re.match(r'제(\d+)조(?:의(\d+))?$', art)
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


fail, total = [], 0
for n in walk(T['tree']):
    for d in n.get('장비', []):
        total += 1
        tag = '%s / %s %s %s' % (n['id'], d['근거법령'], d.get('고시명', d['계층']), d['근거조문'])
        p = os.path.join(LEGAL, d['파일'])
        if not os.path.exists(p):
            fail.append('%s: 파일 없음 %s' % (tag, d['파일'])); continue
        text = open(p, encoding='utf-8', errors='replace').read()
        whole = norm(text)
        if norm(d['인용']) not in whole:
            fail.append('%s: 인용이 파일 원문에 없음' % tag); continue
        if d['요건유형'] not in OK_TYPE:
            fail.append('%s: 요건유형 값 이상 %r' % (tag, d['요건유형']))
        if d['수량출처'] not in OK_SRC:
            fail.append('%s: 수량출처 값 이상 %r' % (tag, d['수량출처']))
        if d['수량출처'] in ('별표·표(raw 미수집)', '해당없음(수량 규정 아님)') and d['수량조건'] is not None:
            fail.append('%s: 수량 미확인인데 수량조건이 채워짐' % tag)
        if d['수량출처'] in ('조문본문', '조문본문 표(이미지판독·⚠REVIEW)') and not d['수량조건']:
            fail.append('%s: 수량출처가 본문인데 수량조건이 비었음' % tag)
        is_adm = (d['계층'] == '행정규칙')
        span = article_span(text, d['근거조문'], is_adm)
        if span is None:
            fail.append('%s: 근거조문 마커를 파일에서 못 찾음' % tag); continue
        nspan = norm(span)
        if norm(d['인용']) not in nspan:
            fail.append('%s: 인용이 그 조문 구간 밖에 있음' % tag)
        if d['수량조건'] and norm(d['수량조건']) not in nspan:
            fail.append('%s: 수량조건이 그 조문 구간에 없음' % tag)
        if is_adm:
            ap = os.path.join(os.path.dirname(p), '_admrul.json')
            meta = json.load(open(ap, encoding='utf-8')) if os.path.exists(ap) else {}
            flat = {re.sub(r'\s+', '', k): v for k, v in meta.items()}
            got = (flat.get(re.sub(r'\s+', '', d['고시명'])) or {}).get('ID')
            if got != d['고시ID']:
                fail.append('%s: 고시ID 불일치(json=%s, tree=%s)' % (tag, got, d['고시ID']))
            if os.path.basename(p) != d['고시명'] + '.txt':
                fail.append('%s: 고시명과 파일명 불일치' % tag)

print('독립 재대조: 장비 항목 %d건 검사 · 실패 %d건' % (total, len(fail)))
for f in fail:
    print('  -', f)
sys.exit(1 if fail else 0)
