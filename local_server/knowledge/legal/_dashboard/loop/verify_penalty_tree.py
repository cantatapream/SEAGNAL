#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""penalty_tree.json 독립 재대조 — 빌더 로직을 한 줄도 재사용하지 않는다.

역할(초보자용):
  build_penalty_tree.py 가 만든 트리를 **처음부터 다시** raw 원문과 맞춰본다.
  빌더가 만든 함수를 가져다 쓰면 빌더의 실수를 그대로 따라 하게 되므로
  (CLAUDE.md "구현자가 만든 테스트는 구현자의 가정을 공유한다"),
  조문 찾기·금액 읽기·조문참조 뽑기를 **여기서 따로 구현**해 결과가 같은지 본다.

무엇을 보나 (설계 §5.4.3 ②):
  1. 위반행위 문구가 그 법 raw 파일에 실제로 있는가
  2. 그 문구가 **지목된 벌칙 조문 블록 안**에 있는가(다른 조의 문장을 가져다 붙이지 않았는가)
  3. 형량 인용이 같은 벌칙 조문 블록 안에 있는가 + 금액 표기·정규화 값이 맞는가
  4. ★참조 조문번호를 **위반행위 텍스트에서 독립적으로 다시 뽑아** JSON과 일치하는가
     (= 빌더가 엉뚱한 조문을 골랐으면 여기서 어긋난다 — 가장 위험한 오류 유형)
  5. 참조 인용이 **그 참조 조문 블록 안**에 있는가(+ 항 지정이 있으면 그 항 구간 안인가)
  6. 트리 무결성(선택지 next·개수·상한, 항목 보존)

[연계]
  읽기: _dashboard/penalty_tree.json · raw/**/법률.txt
  설계: _dashboard/H32_penalty_tree_design.md §6

실행: python3 local_server/knowledge/legal/_dashboard/loop/verify_penalty_tree.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
TREE = os.path.join(DASH, 'penalty_tree.json')

FAIL = []
WARN = []


def flatten(s):
    """빌더와 같은 결과를 내야 하는 정규화지만 구현은 따로 한다(태그 제거 → 공백 1칸)."""
    return ' '.join(re.sub(r'<[^>]*>', '', s).split())


_blocks = {}


def blocks(path):
    """파일 → {조: 그 조의 본문 전체(정규화)}.
    빌더처럼 줄 단위 상태기계를 쓰지 않고, 조 머리 위치를 전부 찾아 구간을 잘라낸다."""
    if path in _blocks:
        return _blocks[path]
    txt = open(os.path.join(LEGAL, path), encoding='utf-8', errors='replace').read()
    heads = [(mo.start(), mo.end(), mo.group(1)) for mo in
             re.finditer(r'^\[(제\d+조(?:의\d+)?)\][^\n]*$', txt, re.M)]
    out = {}
    for i, (s, e, name) in enumerate(heads):
        nxt = heads[i + 1][0] if i + 1 < len(heads) else len(txt)
        out[name] = flatten(txt[e:nxt])
    _blocks[path] = out
    return out


HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'


def hang_span(body, hang_label):
    """'제3항' → 그 항 구간 문자열. 없으면 None."""
    n = int(re.sub(r'\D', '', hang_label))
    if n > len(HANG):
        return None
    sym = HANG[n - 1]
    i = body.find(sym)
    if i < 0:
        return None
    j = body.find(HANG[n], i) if n < len(HANG) else -1
    return body[i:j] if j > i else body[i:]


def won2(s):
    """금액 표기 → 원. 빌더와 다른 방식(치환식)으로 구현해 교차검증한다."""
    t = s.replace('원', '')
    m = re.fullmatch(r'(?:(\d+)억)?(?:(\d+)(천|백|십)?)?(만)?', t)
    if not m:
        return None
    eok, num, unit, man = m.groups()
    v = int(eok) * 10 ** 8 if eok else 0
    if num:
        base = int(num) * {'천': 1000, '백': 100, '십': 10}.get(unit, 1)
        v += base * (10 ** 4 if man else 1)
    return v


RE_REF2 = re.compile(r'(?:「([^」]+)」\s*)?제(\d+)조(?:의(\d+))?(?:제(\d+)항)?')


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def main():
    d = json.load(open(TREE, encoding='utf-8'))
    root = d['tree']
    nodes = list(walk(root))
    entries = [e for n in nodes for e in n.get('위반행위', [])]

    checked = {'entry': 0, 'quote': 0, 'ref': 0, 'money': 0}

    for e in entries:
        checked['entry'] += 1
        blk = blocks(e['파일'])
        art = e['벌칙조문']['조']
        if art not in blk:
            FAIL.append('[1] 벌칙 조문이 raw에 없음: %s %s' % (e['근거법령'], art))
            continue
        body = blk[art]

        # 2. 위반행위가 그 벌칙 조문 블록 안에 있는가
        if e['위반행위'] not in body:
            FAIL.append('[2] 위반행위가 지목된 벌칙 조문 안에 없음: %s %s'
                        % (e['근거법령'], e['벌칙조문']['표시']))
        elif e['벌칙조문']['항']:
            span = hang_span(body, e['벌칙조문']['항'])
            if span is None:
                FAIL.append('[2] 벌칙 조문에 그 항이 없음: %s %s'
                            % (e['근거법령'], e['벌칙조문']['표시']))
            elif e['위반행위'] not in span:
                FAIL.append('[2] 위반행위가 지목된 항 구간 밖에 있음: %s %s'
                            % (e['근거법령'], e['벌칙조문']['표시']))
        checked['quote'] += 1

        # 3. 형량 인용 + 금액
        q = (e['형량'] or {}).get('인용')
        if q and q not in body:
            FAIL.append('[3] 형량 인용이 벌칙 조문 안에 없음: %s %s'
                        % (e['근거법령'], e['벌칙조문']['표시']))
        for k in ('벌금', '과태료'):
            v = (e['형량'] or {}).get(k)
            if not v:
                continue
            checked['money'] += 1
            if v['상한_표기'] not in (q or ''):
                FAIL.append('[3] %s 상한 표기가 형량 인용에 없음: %s %s (%s)'
                            % (k, e['근거법령'], e['벌칙조문']['표시'], v['상한_표기']))
            if won2(v['상한_표기']) != v['상한_원']:
                FAIL.append('[3] %s 금액 정규화 불일치: %s %s (%s → JSON %s / 재계산 %s)'
                            % (k, e['근거법령'], e['벌칙조문']['표시'], v['상한_표기'],
                               v['상한_원'], won2(v['상한_표기'])))

        # 4. ★참조 조문번호 독립 재추출 ↔ JSON 대조
        mine = []
        for mo in RE_REF2.finditer(e['위반행위']):
            ln, n, ui, hang = mo.groups()
            mine.append((ln or '', '제%s조' % n + ('의%s' % ui if ui else ''),
                         ('제%s항' % hang) if hang else None))
        theirs = [((r['법령'] if r['표시'].startswith('「') else ''), r['조'], r.get('항'))
                  for r in e['참조해소']]
        if len(mine) != len(theirs):
            FAIL.append('[4] 참조 개수 불일치: %s %s (재추출 %d ≠ JSON %d)'
                        % (e['근거법령'], e['벌칙조문']['표시'], len(mine), len(theirs)))
        else:
            for (l1, a1, h1), (l2, a2, h2) in zip(mine, theirs):
                if (a1, h1) != (a2, h2):
                    FAIL.append('[4] 참조 조/항 불일치: %s %s (재추출 %s%s ≠ JSON %s%s)'
                                % (e['근거법령'], e['벌칙조문']['표시'], a1, h1 or '', a2, h2 or ''))

        # 5. 참조 인용이 그 참조 조문(+항) 안에 있는가
        for r in e['참조해소']:
            checked['ref'] += 1
            if r['해소'] != 'resolved':
                WARN.append('미해소(%s): %s %s ← %s'
                            % (r['해소'], e['근거법령'], e['벌칙조문']['표시'], r['표시']))
                continue
            tb = blocks(r['파일'])
            if r['조'] not in tb:
                FAIL.append('[5] 참조 조문이 raw에 없음: %s ← %s' % (e['근거법령'], r['표시']))
                continue
            target = tb[r['조']]
            if r['인용'] not in target:
                FAIL.append('[5] 참조 인용이 그 조문 안에 없음: %s ← %s' % (e['근거법령'], r['표시']))
                continue
            if r.get('항'):
                span = hang_span(target, r['항'])
                if span is None:
                    FAIL.append('[5] 참조 조문에 그 항이 없음: %s ← %s' % (e['근거법령'], r['표시']))
                elif r['인용'] not in span:
                    FAIL.append('[5] 참조 인용이 지목된 항 구간 밖: %s ← %s' % (e['근거법령'], r['표시']))
            # 조문제목 재확인 — 머리줄에서 다시 읽는다
            txt = open(os.path.join(LEGAL, r['파일']), encoding='utf-8', errors='replace').read()
            mo = re.search(r'^\[%s\]\s*(.*)$' % re.escape(r['조']), txt, re.M)
            title = re.sub(r'\s*\(시행[^)]*\)\s*$', '', mo.group(1)).strip() if mo else None
            if (title or None) != (r['조문제목'] or None):
                FAIL.append('[5] 조문제목 불일치: %s ← %s (raw "%s" ≠ JSON "%s")'
                            % (e['근거법령'], r['표시'], title, r['조문제목']))

    # 6. 트리 무결성
    ids = [n['id'] for n in nodes]
    if len(ids) != len(set(ids)):
        FAIL.append('[6] 노드 id 중복')
    if len(entries) != d['summary']['violation_entries']:
        FAIL.append('[6] 항목 수 불일치: 트리 %d ≠ summary %d'
                    % (len(entries), d['summary']['violation_entries']))
    for n in nodes:
        kids = n.get('children', [])
        if kids:
            opts = n.get('선택지') or []
            if not n.get('질문') or not opts:
                FAIL.append('[6] 비-리프에 질문/선택지 없음: %s' % n['id'])
            if len(opts) != len(kids):
                FAIL.append('[6] 선택지 수 ≠ 자식 수: %s' % n['id'])
            if len(opts) > 3:
                FAIL.append('[6] 선택지 3개 초과: %s' % n['id'])
            kid = {c['id'] for c in kids}
            for o in opts:
                if o.get('next') not in kid:
                    FAIL.append('[6] next가 자식이 아님: %s → %s' % (n['id'], o.get('next')))
        else:
            if len(n.get('위반행위', [])) != n['분포']['항목수']:
                FAIL.append('[6] 리프 분포 항목수 불일치: %s' % n['id'])

    print('독립 재대조 — 항목 %d · 인용 %d · 참조 %d · 금액 %d'
          % (checked['entry'], checked['quote'], checked['ref'], checked['money']))
    print('실패 %d건 · 경고(미해소 참조) %d건' % (len(FAIL), len(WARN)))
    for f in FAIL[:60]:
        print('  ✗', f)
    for w in WARN[:20]:
        print('  ·', w)
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
