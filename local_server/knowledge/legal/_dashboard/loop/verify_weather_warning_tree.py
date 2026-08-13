#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
기상특보 출항·운항통제 자산 **독립 재대조 검증기** (L-75 2단계).

역할(초보자용):
  `weather_warning_tree.json`이 말하는 것이 raw 원문에 실제로 있는지를 **빌더 로직을 하나도 쓰지 않고**
  처음부터 다시 확인한다. 빌더가 조문을 딕셔너리로 쪼개 인용을 뽑았다면, 이 스크립트는 파일을
  **통짜 문자열**로 읽어 위치를 계산한다 — 같은 버그를 두 번 통과시키지 않기 위해서다.

검사 항목
  ① 인용문이 그 파일에 실제로 있는가(법률계열은 공백 접기 후 부분문자열, 별표는 줄 블록 그대로)
  ② 그 인용문의 **위치가 그 조(條) 구간 안**인가(조문 머리 위치를 직접 훑어 구간 계산)
  ③ 법령ID가 `_meta.json`과 맞는가 · 행정규칙ID가 고시 파일 머리말과 맞는가
  ④ 값 도메인(유형·특보.표현·현상·등급) · 트리 구조 무결성(질문/선택지/next/라벨==label)
  ⑤ `추가확인[].영향`이 실재하는 항목 제목만 가리키는가
  ⑥ 리프의 `특보질문`을 **여기서 다시 계산**해 저장값과 같은가(빌더 계산을 믿지 않는다)
  ⑦ `summary` 수치가 실제 개수와 맞는가

실행: python3 local_server/knowledge/legal/_dashboard/loop/verify_weather_warning_tree.py
음성 테스트(게이트가 실제로 잡는지): … verify_weather_warning_tree.py --negative
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
DOC = os.path.join(DASH, 'weather_warning_tree.json')

KINDS = ['출항·운항 통제', '활동금지', '안전조치', '완화·예외', '적용대상', '적용제외', '관할', '처벌']
PHENOMENA = ['호우', '대설', '태풍', '강풍', '황사', '건조', '한파', '폭염', '풍랑', '폭풍해일']
GRADES = ['주의보', '경보', '중대경보']
EXPR = ['포괄', '열거', '시계제한', '특보아님', '해당없음']
GATING = {'출항·운항 통제', '활동금지', '안전조치', '완화·예외'}
VIS = '제한된 시계'

FAIL = []


def fail(msg):
    FAIL.append(msg)


_txt = {}


def whole(relpath):
    if relpath not in _txt:
        p = os.path.join(LEGAL, relpath)
        _txt[relpath] = open(p, encoding='utf-8', errors='replace').read() if os.path.exists(p) else None
    return _txt[relpath]


def squash(s):
    """공백 접기 + 이미지 태그 제거 — 빌더의 flatten과 결과는 같아야 하지만 코드를 공유하지 않는다."""
    return re.sub(r'\s+', ' ', re.sub(r'<img[^>]*>|</img>', ' ', s)).strip()


def article_span(text, article, plain):
    """조문 머리를 **줄 첫머리에서만** 훑어 (시작, 끝) 구간을 구한다.

    ★줄 첫머리를 요구하는 이유(실측): 고시 raw의 머리말이 `위임근거: … 시행령 제8조(제8조제1항제1호)`
      처럼 다른 조문을 괄호와 함께 인용해, 줄 위치를 안 보면 그 머리말이 "제8조의 시작"으로 잡힌다.
    @param plain True면 무대괄호 형식(고시·발췌본), False면 대괄호 형식(법률계열)"""
    pat = re.compile(r'^\s*제(\d+)조(?:의(\d+))?\s*\(', re.M) if plain \
        else re.compile(r'^\s*\[제(\d+)조(?:의(\d+))?\]', re.M)
    heads = []
    for m in pat.finditer(text):
        name = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
        heads.append((m.start(), name))
    for i, (pos, name) in enumerate(heads):
        if name == article:
            end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
            return pos, end
    return None


def check_quote(e, where):
    """①②③ — 인용문이 그 파일·그 조문 구간 안에 실재하는지."""
    path = e['파일']
    raw = whole(path)
    if raw is None:
        fail('%s: 파일 없음 %s' % (where, path))
        return
    art = e['근거조문']
    q = e['인용']
    if art.startswith('별표'):
        # 별표는 줄 블록 verbatim — 원문 줄과 그대로 맞아야 한다(자산은 줄 끝 공백만 떼어 저장한다).
        lines = '\n'.join(ln.rstrip() for ln in raw.split('\n'))
        if q not in lines:
            fail('%s: 별표 인용이 파일에 없음 (%s %s)' % (where, path, art))
        return
    body = q
    if body.startswith('… '):
        body = body[2:]
    if body.endswith(' …'):
        body = body[:-2]
    if body not in squash(raw):
        fail('%s: 인용문이 파일에 없음 (%s %s)' % (where, path, art))
        return
    plain = ('행정규칙/' in path) or path.endswith('_발췌.txt')
    art_key = re.sub(r'제(\d+)조(의\d+)?.*$', lambda m: '제%s조%s' % (m.group(1), m.group(2) or ''), art)
    span = article_span(raw, art_key, plain)
    if span is None:
        fail('%s: 조문 머리를 찾지 못함 (%s %s)' % (where, path, art))
        return
    if body not in squash(raw[span[0]:span[1]]):
        fail('%s: 인용문이 %s 구간 안에 없음 (%s)' % (where, art, path))


def check_ids(e, where):
    slug = e['근거법령_slug']
    tier = e['계층']
    if tier == '행정규칙':
        raw = whole(e['파일'])
        m = re.search(r'ID:(\d+)', raw[:400]) if raw else None
        if not m or m.group(1) != e.get('행정규칙ID'):
            fail('%s: 행정규칙ID 불일치 (%s)' % (where, e.get('행정규칙ID')))
        return
    if slug == '기상법':
        return
    meta = os.path.join(os.path.dirname(os.path.join(LEGAL, e['파일'])), '_meta.json')
    if not os.path.exists(meta):
        # 별표는 한 단계 아래 폴더다
        meta = os.path.join(os.path.dirname(os.path.dirname(os.path.join(LEGAL, e['파일']))), '_meta.json')
    if not os.path.exists(meta):
        fail('%s: _meta.json 없음' % where)
        return
    fam = json.load(open(meta, encoding='utf-8')).get('families', {}).get(tier)
    if isinstance(fam, list):
        fam = fam[0] if fam else None
    if (fam or {}).get('법령ID') != e['법령ID']:
        fail('%s: 법령ID 불일치 (저장 %s / _meta %s)' % (where, e['법령ID'], (fam or {}).get('법령ID')))


def applies_to(e, key):
    w = e.get('특보') or {}
    expr = w.get('표현')
    if key == VIS:
        return bool(w.get('시계'))
    if expr in ('시계제한', '특보아님', '해당없음'):
        return False
    ph = w.get('현상')
    if expr == '포괄':
        return True if ph is None else (key in ph)
    if expr == '열거':
        return key in (ph or [])
    return False


def grade_ok(e, grade, keys=None):
    """등급 갈래 판정 — `조합`이 있으면 현상과 등급을 **쌍으로** 본다(빌더와 같은 규약을 다시 구현)."""
    w = e.get('특보') or {}
    rows = w.get('조합')
    if rows:
        for r in rows:
            if keys is not None and not (set(r.get('현상') or []) & set(keys)):
                continue
            if not r.get('등급') or grade in r['등급']:
                return True
        return False
    g = w.get('등급')
    return True if not g else (grade in g)


def recompute_questions(entries):
    """⑥ 빌더의 warning_questions를 **다시 구현**해 저장값과 대조한다."""
    gate = [e for e in entries if e['유형'] in GATING and (e.get('특보') or {}).get('표현') != '해당없음']
    keys = [p for p in PHENOMENA
            if any((e.get('특보') or {}).get('현상') and p in e['특보']['현상'] for e in gate)]
    if any((e.get('특보') or {}).get('시계') for e in gate):
        keys.append(VIS)
    order = {k: i for i, k in enumerate(PHENOMENA + [VIS])}
    buckets = {}
    for k in keys:
        sig = (frozenset(e['제목'] for e in gate if applies_to(e, k)), k == VIS)
        buckets.setdefault(sig, []).append(k)
    glist = sorted(buckets.values(), key=lambda g: min(order[x] for x in g))
    labels = ['·'.join(sorted(g, key=lambda x: order[x])) for g in glist] if len(glist) > 1 else []
    grades = {}
    for g in (glist if len(glist) > 1 else ([glist[0]] if glist else [])):
        g = sorted(g, key=lambda x: order[x])
        if g == [VIS]:
            continue
        sub = [e for e in gate if any(applies_to(e, k) for k in g)]
        gg = {}
        for gr in ['주의보', '경보']:
            gg.setdefault(frozenset(e['제목'] for e in sub if grade_ok(e, gr, g)), []).append(gr)
        grades['·'.join(g)] = len(gg) > 1
    return labels, grades


def main():
    doc = json.load(open(DOC, encoding='utf-8'))
    if '--negative' in sys.argv:
        inject(doc)

    axes = {a['id']: a for a in doc['축']}
    root = axes['vessel_kind']['tree']
    axis = axes['weather_warning']

    def walk(n):
        yield n
        for c in n.get('children', []):
            yield from walk(c)

    nodes = list(walk(root))
    quotes = 0

    # ─ 노드 provenance·구분근거
    for n in nodes:
        if not n.get('provenance'):
            fail('출처 없는 노드: %s' % n['id'])
        for key in ('provenance', '구분근거'):
            for p in n.get(key) or []:
                quotes += 1
                e = {'파일': p['파일'], '근거조문': p['조문'], '인용': p['인용'],
                     '근거법령_slug': p['법령_slug'], '계층': p['계층'], '법령ID': p.get('법령ID')}
                check_quote(e, '%s.%s' % (n['id'], key))
                check_ids(e, '%s.%s' % (n['id'], key))
    for p in axis.get('provenance') or []:
        quotes += 1
        e = {'파일': p['파일'], '근거조문': p['조문'], '인용': p['인용'],
             '근거법령_slug': p['법령_slug'], '계층': p['계층'], '법령ID': p.get('법령ID')}
        check_quote(e, '특보축.provenance')

    # ─ 통제항목
    entries = []
    for n in nodes:
        for e in n.get('통제', []):
            entries.append((n, e))
            quotes += 1
            where = '%s / %s' % (n['id'], e['제목'][:30])
            check_quote(e, where)
            check_ids(e, where)
            if e['유형'] not in KINDS:
                fail('%s: 유형 도메인 위반 %r' % (where, e['유형']))
            w = e.get('특보') or {}
            if w.get('표현') not in EXPR:
                fail('%s: 특보.표현 도메인 위반 %r' % (where, w.get('표현')))
            for x in (w.get('현상') or []):
                if x not in PHENOMENA:
                    fail('%s: 특보.현상 도메인 위반 %r' % (where, x))
            for x in (w.get('등급') or []):
                if x not in GRADES:
                    fail('%s: 특보.등급 도메인 위반 %r' % (where, x))
            if isinstance(w.get('확장근거'), dict) and '인용' in w['확장근거']:
                fail('%s: 특보.확장근거에 손으로 쓴 인용' % where)
            if w.get('조합'):
                u1, u2 = set(), set()
                for r in w['조합']:
                    u1 |= set(r.get('현상') or [])
                    u2 |= set(r.get('등급') or [])
                if u1 != set(w.get('현상') or []) or u2 != set(w.get('등급') or []):
                    fail('%s: 특보.조합 합집합이 현상/등급과 다름' % where)

    # ─ 트리 구조
    for n in nodes:
        kids = n.get('children', [])
        opts = n.get('선택지') or []
        if kids:
            if not n.get('질문') or len(opts) != len(kids) or len(opts) > 3:
                fail('%s: 질문/선택지 무결성 위반' % n['id'])
            byid = {c['id']: c for c in kids}
            for o in opts:
                c = byid.get(o.get('next'))
                if not c:
                    fail('%s: 깨진 next %r' % (n['id'], o.get('next')))
                elif o.get('label') != c.get('라벨'):
                    fail('%s: 선택지 label ≠ 자식 라벨 (%r/%r)' % (n['id'], o.get('label'), c.get('라벨')))
        elif opts or n.get('질문'):
            fail('%s: 리프에 질문/선택지' % n['id'])

    # ─ 경로 상속 · 추가확인.영향 · 특보질문 재계산
    def path_of(target):
        def rec(n, acc):
            acc2 = acc + n.get('통제', [])
            if n['id'] == target:
                return acc2
            for c in n.get('children', []):
                r = rec(c, acc2)
                if r is not None:
                    return r
            return None
        return rec(root, []) or []

    leaves = [n for n in nodes if not n.get('children')]
    for n in nodes:
        titles = {e['제목'] for e in path_of(n['id'])}
        for a in n.get('추가확인') or []:
            for t in a.get('영향') or []:
                if t not in titles:
                    fail('%s: 추가확인.영향이 없는 항목을 가리킴 %r' % (n['id'], t))
    for lf in leaves:
        ent = path_of(lf['id'])
        if lf.get('상속항목수') != len(ent):
            fail('%s: 상속항목수 불일치 (%s/%s)' % (lf['id'], lf.get('상속항목수'), len(ent)))
        excl = {e['적용제외_대상법'] for e in ent
                if e['유형'] == '적용제외' and e.get('적용제외_대상법')}
        live = [e for e in ent if not (e['근거법령_slug'] in excl and e['유형'] != '적용제외')]
        if lf.get('적용항목수') != len(live):
            fail('%s: 적용항목수 불일치 (%s/%s)' % (lf['id'], lf.get('적용항목수'), len(live)))
        labels, grades = recompute_questions(live)
        got = [o['label'] for o in lf['특보질문']['현상']['선택지']]
        if got != labels:
            fail('%s: 특보질문(현상) 재계산 불일치\n   저장=%r\n   재계산=%r' % (lf['id'], got, labels))
        for g in lf['특보질문']['등급']:
            k = '·'.join(g['현상'])
            if grades.get(k) != g['필요']:
                fail('%s: 특보질문(등급) 재계산 불일치 [%s] 저장=%s 재계산=%s'
                     % (lf['id'], k, g['필요'], grades.get(k)))

    # ─ summary 수치
    s = doc['summary']
    if s['entries'] != len(entries):
        fail('summary.entries 불일치 (%s/%s)' % (s['entries'], len(entries)))
    if s['nodes'] != len(nodes) or s['leaves'] != len(leaves):
        fail('summary.nodes/leaves 불일치')
    bykind = {}
    for _, e in entries:
        bykind[e['유형']] = bykind.get(e['유형'], 0) + 1
    if bykind != s['entries_by_kind']:
        fail('summary.entries_by_kind 불일치')
    if s['entries_with_REVIEW'] != sum(1 for _, e in entries if e.get('REVIEW')):
        fail('summary.entries_with_REVIEW 불일치')

    print('검사한 인용 %d건 · 통제항목 %d건 · 노드 %d개 · 리프 %d개' % (quotes, len(entries), len(nodes), len(leaves)))
    if FAIL:
        print('❌ 실패 %d건' % len(FAIL))
        for x in FAIL:
            print('  -', x)
        sys.exit(1)
    print('✅ 실패 0건')


def inject(doc):
    """음성 테스트 — 결함 6종을 일부러 심어 게이트가 실제로 잡는지 확인한다."""
    root = {a['id']: a for a in doc['축']}['vessel_kind']['tree']
    fish = root['children'][0]
    fish['통제'][0]['근거조문'] = '제99조'                       # ① 없는 조문
    fish['통제'][1]['인용'] = '① 이 법은 모든 어선의 출항을 금지한다.'   # ② 지어낸 인용
    fish['통제'][2]['법령ID'] = '999999'                        # ③ 틀린 법령ID
    root['선택지'][0]['next'] = 'nowhere'                        # ④ 깨진 참조
    doc['summary']['entries'] = 999                              # ⑤ 조작된 요약수치
    leaf = fish['children'][0]
    leaf['특보질문']['현상']['선택지'] = [{'label': '태풍', '현상': ['태풍']}]  # ⑥ 조작된 질문
    print('⚠ 음성 테스트 — 결함 6종 주입')


if __name__ == '__main__':
    main()
