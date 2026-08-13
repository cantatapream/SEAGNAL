#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
기상특보 출항·운항통제 자산의 **암시 하강(implicit descent) 매칭기** — 이번 라운드는 실서빙 미배선.

역할(초보자용):
  사용자가 "낚시어선인데 풍랑주의보 뜨면 나갈 수 있나요?"라고 물으면, 이미 말한 축
  (선종=낚시어선, 특보=풍랑주의보)은 **다시 묻지 않고** 아직 모르는 축만 되묻는다.
  `legal_retriever.js`의 `resolveZoneTreePath()`가 하는 것과 같은 원리이고, 다른 점은
  이 자산이 **축을 두 개** 가진다는 것이다.

★질문 순서를 고정하지 않는 이유와, 그런데도 선종을 먼저 묻게 되는 이유(사용자 확정 설계)
  - 순서는 규칙으로 못 박지 않는다. 질문에 이미 나온 축은 건너뛴다.
  - 다만 **특보 질문의 선택지는 그 선종에 실재하는 특보로만 만들어진다**(자산의 리프마다
    `특보질문`이 따로 계산돼 있다). 그래서 선종이 정해지기 전에는 특보를 물을 수 없다 —
    순서가 우리가 정한 규칙이 아니라 **데이터 의존관계**에서 나온다.

[연계]
  읽기: _dashboard/weather_warning_tree.json
  설계: _dashboard/H32_weather_warning_design.md §8
  ❌ 이 모듈은 아직 `local_server/services/legal_retriever.js`·`routes/legal.js`에 배선하지 않는다
     (기존 13개 자산과 같은 절차 — 구축 먼저, 배선은 별도 확인 후).

실행(자체 시험): python3 local_server/knowledge/legal/_dashboard/loop/match_weather_warning_tree.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
DOC = os.path.join(DASH, 'weather_warning_tree.json')

CLARIFY_JOINER = ' — '          # legal_retriever.js와 같은 구분자
VIS = '제한된 시계'
PHENOMENA = ['호우', '대설', '태풍', '강풍', '황사', '건조', '한파', '폭염', '풍랑', '폭풍해일']
# 일상어와 겹쳐 오탐이 나는 현상어 — "건조된 선박"의 `건조`처럼. 이들은 뒤에 주의보/경보/특보가
# 따라올 때만 인정한다(L-78의 "이게 있으면 무엇이 안 걸리게 되나"를 반대로 물어 정한 선).
AMBIGUOUS = {'호우', '대설', '황사', '건조', '한파', '폭염'}
GRADES = ['주의보', '경보']
VIS_WORDS = ['가시거리', '시정', '시계', '안개']
GENERIC = ['해양기상특보', '기상특보', '기상 특보', '특보']

# 답변 조립 규약(배선 전 필수 규약④ "물어본 것에만 답한다"의 이 자산 적용):
#   이 자산에 오는 질문은 "나갈 수 있나 / 어디까지 다닐 수 있나"라 **통제 가부 자체가 물어본 것**이다.
#   그래서 통제·완화·안전조치·적용제외는 바로 답하고, 처벌·관할·적용대상은 확인을 거쳐서만 펼친다.
CORE_KINDS = ['출항·운항 통제', '활동금지', '완화·예외', '안전조치', '적용제외']
ASK_FIRST_KINDS = ['처벌', '관할', '적용대상']


def load(path=DOC):
    doc = json.load(open(path, encoding='utf-8'))
    axes = {a['id']: a for a in doc['축']}
    return doc, axes['vessel_kind']['tree'], axes['weather_warning']


def walk(n, depth=0, path=()):
    yield n, depth, path + (n['id'],)
    for c in n.get('children', []):
        yield from walk(c, depth + 1, path + (n['id'],))


# ── 라벨 매칭 (L-78 재발방지) ─────────────────────────────────────────
_HANGUL = re.compile(r'[0-9A-Za-z가-힣]')


def _strip_map(s):
    """공백을 지운 문자열과, 그 인덱스를 원문 인덱스로 되돌리는 표를 함께 만든다.
    ★L-78: 비교는 정규화한 문자열에서, **경계 판정은 원문에서** 한다."""
    out, idx = [], []
    for i, ch in enumerate(s):
        if not ch.isspace():
            out.append(ch)
            idx.append(i)
    return ''.join(out), idx


def label_hit(text, label):
    """`label`이 `text` 안에 낱말 단위로 나오는가.

    - 한글·영숫자로만 된 단일어절 라벨(`어선`) → **띄어쓰기 토큰의 선두**에서만 인정한다.
      (`낚시어선으로`의 `어선`은 인정하지 않는다 — L-77 ①과 같은 부분문자열 함정)
    - 공백·괄호·가운뎃점이 든 라벨(`유선·도선`, `그 밖의 선박(일반선박)`) → 공백을 무시한
      부분문자열로 찾되, **원문 인덱스로 되돌려** 앞 글자가 한글·영숫자가 아닌지 확인한다.
    """
    if not label:
        return False
    if re.fullmatch(r'[0-9A-Za-z가-힣]+', label):
        return any(tok.startswith(label) for tok in re.split(r'\s+', text) if tok)
    flat_t, idx = _strip_map(text)
    flat_l = re.sub(r'\s+', '', label)
    start = 0
    while True:
        k = flat_t.find(flat_l, start)
        if k < 0:
            return False
        o = idx[k]
        if o == 0 or not _HANGUL.match(text[o - 1]):
            return True
        start = k + 1


# ── 선종 축 — 암시 하강 ───────────────────────────────────────────────
def resolve_vessel(query, root):
    """질의(원질문 + ' — '로 붙은 선택 조각들)에서 선종 축의 현재 노드를 복원한다.

    점수: 조각과 **완전히 같음** 3 > 조각 안에 들어 있음 2 > 원질문 안에 들어 있음 1.
    같은 점수면 **깊은 노드 → 긴 라벨** 순으로 고른다 — `내항여객선`이 `내항여객선 외의 선박`의
    부분문자열이라 둘 다 걸리는 경우를 길이로 가른다(L-77 ①의 `근해구역` ⊂ `근해구역 이상`과 같은 함정).
    @returns {node, depth, 근거, 후보[]}
    """
    parts = query.split(CLARIFY_JOINER)
    head, chosen = parts[0], [p.strip() for p in parts[1:] if p.strip()]
    best = None
    cands = []
    for n, depth, _ in walk(root):
        if n['id'] == root['id']:
            continue
        lab = n['라벨']
        score, why = 0, None
        if any(c == lab for c in chosen):
            score, why = 3, '선택 조각과 일치'
        elif any(label_hit(c, lab) for c in chosen):
            score, why = 2, '선택 조각 안에 나옴'
        elif label_hit(head, lab):
            score, why = 1, '원래 질문에 나옴'
        if score:
            cands.append({'id': n['id'], '라벨': lab, '점수': score, '깊이': depth, '근거': why})
            key = (score, depth, len(lab))
            if best is None or key > best[0]:
                best = (key, n, depth, why)
    if best is None:
        return {'node': root, 'depth': 0, '근거': None, '후보': cands}
    return {'node': best[1], 'depth': best[2], '근거': best[3], '후보': cands}


# ── 특보 축 — 암시 하강 ───────────────────────────────────────────────
def resolve_warning(query):
    """질의에서 특보 축(현상·등급·시계·포괄어)을 읽어 낸다. 없으면 비워 둔다(지어내지 않는다).
    @returns {현상[], 등급[], 시계:bool, 포괄:bool, 수준}
    """
    text = query
    found = []
    for p in PHENOMENA:
        if p in AMBIGUOUS:
            if re.search(re.escape(p) + r'\s*(주의보|경보|특보)', text):
                found.append(p)
        elif label_hit(text, p):
            found.append(p)
    # ★등급어는 `label_hit`(토큰 선두 매칭)로 찾으면 안 된다 — `풍랑주의보`처럼 **현상어에 붙어
    #   한 낱말이 되므로** 토큰 선두에 오는 일이 거의 없다(실측: 자체시험 T4가 이걸 잡았다).
    #   접미사로 붙는 말이라 단순 부분문자열로 찾는다.
    grades = [g for g in GRADES if g in text]
    vis = any(label_hit(text, w) for w in VIS_WORDS)
    generic = any(g in text for g in GENERIC)
    if found and grades:
        level = '확정'
    elif found:
        level = '현상만'
    elif vis:
        level = '시계'
    elif generic:
        level = '포괄'
    else:
        level = '미지정'
    return {'현상': found, '등급': grades, '시계': vis, '포괄': generic, '수준': level}


# ── 다음에 물어볼 것 ─────────────────────────────────────────────────
def next_question(leaf, warn):
    """리프에 저장된 `특보질문`에서 아직 답이 안 된 것을 꺼낸다. 없으면 None(=다 좁혀졌다).
    반환 스키마는 `decideClarify()`와 같은 모양이라 배선 시 라우트를 안 고쳐도 된다."""
    q = leaf['특보질문']
    picked = pick_group(leaf, warn)
    if q['현상']['필요'] and picked is None:
        return {'needed': True, '축': '특보.현상',
                'intro': '기상특보에 따라 답이 갈려서 하나만 더 확인할게요.',
                'question': q['현상']['질문'],
                'options': [{'label': o['label'], 'hint': o.get('hint')} for o in q['현상']['선택지']]}
    if picked is None:
        return None
    for g in q['등급']:
        if g['현상'] == picked and g['필요'] and not warn['등급']:
            return {'needed': True, '축': '특보.등급',
                    'intro': '같은 특보라도 등급에 따라 달라져요.',
                    'question': g['질문'],
                    'options': [{'label': o['label'], 'hint': None} for o in g['선택지']]}
    return None


def pick_group(leaf, warn):
    """사용자가 이미 말한 특보가 이 리프의 어느 갈래에 드는가. 못 고르면 None."""
    q = leaf['특보질문']
    opts = q['현상']['선택지']
    if not q['현상']['필요']:
        # 갈래가 하나뿐이면 물을 것도 고를 것도 없다.
        return q['등급'][0]['현상'] if q['등급'] else []
    if warn['현상']:
        for o in opts:
            if set(warn['현상']) & set(o['현상']):
                return o['현상']
    if warn['시계']:
        for o in opts:
            if o['현상'] == [VIS]:
                return o['현상']
    return None


# ── 답변 범위 ────────────────────────────────────────────────────────
def path_entries(root, leaf_id):
    def rec(n, acc):
        acc2 = acc + n.get('통제', [])
        if n['id'] == leaf_id:
            return acc2
        for c in n.get('children', []):
            r = rec(c, acc2)
            if r is not None:
                return r
        return None
    return rec(root, []) or []


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
    """등급 갈래 판정 — `조합`이 있으면 현상과 등급을 **쌍으로** 본다.
    없으면 "태풍주의보ㆍ태풍경보ㆍ풍랑경보"를 한 칸에 묶은 어선 별표 1 제1호가 **풍랑주의보에도**
    걸리는 것으로 읽혀 답이 틀린다(자체 시험 데모에서 실제로 발견)."""
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


def answer_scope(root, leaf, warn, group):
    """좁혀진 조건에 걸리는 항목을 고른다.
    ★적용제외로 멈춘 항목은 **버리지 않고 따로 담는다** — 화면에서 "이 법은 당신 배엔 적용되지
      않는다"를 함께 보여야 하기 때문이다(L-79)."""
    ent = path_entries(root, leaf['id'])
    excl = {e['적용제외_대상법'] for e in ent if e['유형'] == '적용제외' and e.get('적용제외_대상법')}
    live = [e for e in ent if not (e['근거법령_slug'] in excl and e['유형'] != '적용제외')]
    dead = [e for e in ent if e not in live]
    if group:
        sel = [e for e in live
               if e['유형'] not in ('출항·운항 통제', '활동금지', '안전조치', '완화·예외')
               or any(applies_to(e, k) for k in group)
               or (e.get('특보') or {}).get('표현') in ('특보아님', '해당없음')]
    else:
        sel = live
    if warn['등급']:
        sel = [e for e in sel
               if e['유형'] not in ('출항·운항 통제', '활동금지', '안전조치', '완화·예외')
               or any(grade_ok(e, gr, group) for gr in warn['등급'])]
    return {
        '핵심': [e for e in sel if e['유형'] in CORE_KINDS],
        '확인후': [e for e in sel if e['유형'] in ASK_FIRST_KINDS],
        '적용제외로_멈춘_항목': dead,
    }


def match(query, doc=None):
    """이 자산의 진입점 — 질의 하나를 넣으면 "무엇이 정해졌고, 무엇을 더 물어야 하는지"를 돌려준다."""
    if doc is None:
        doc, root, axis = load()
    else:
        axes = {a['id']: a for a in doc['축']}
        root, axis = axes['vessel_kind']['tree'], axes['weather_warning']
    v = resolve_vessel(query, root)
    w = resolve_warning(query)
    node = v['node']
    if node.get('children'):
        return {'matched': True, '선종': node['id'], '선종해결': False, '특보': w,
                'ask': {'needed': True, '축': '선종',
                        'intro': '배 종류에 따라 근거 법과 기준이 완전히 달라져서 먼저 확인할게요.',
                        'question': node['질문'],
                        'options': [{'label': o['label'], 'hint': o.get('hint')} for o in node['선택지']]},
                '답변범위': None}
    group = pick_group(node, w)
    ask = next_question(node, w)
    return {'matched': True, '선종': node['id'], '선종해결': True, '특보': w, '갈래': group,
            'ask': ask, '답변범위': (None if ask else answer_scope(root, node, w, group))}


# ══════════════════════════════════════════════════════════════════════
# 자체 시험 — L-77(리프 전수 도달) · L-78(라벨 × 위치 전수 스윕)
# ══════════════════════════════════════════════════════════════════════
def selftest():
    doc, root, axis = load()
    bad = []
    leaves = [n for n, _, _ in walk(root) if not n.get('children')]

    # T1 — 리프 전수 도달(버튼 클릭 시뮬레이션). 대표 경로 몇 개가 아니라 전수다.
    def click_path(target):
        q, cur = '기상특보가 떴는데 나갈 수 있나요?', root
        while cur.get('children'):
            nxt = None
            for o in cur['선택지']:
                sub = [x['id'] for x, _, _ in walk([c for c in cur['children'] if c['id'] == o['next']][0])]
                if target in sub:
                    nxt = o
                    break
            if nxt is None:
                return None, q
            q += CLARIFY_JOINER + nxt['label']
            cur = [c for c in cur['children'] if c['id'] == nxt['next']][0]
        return cur, q
    for lf in leaves:
        got, q = click_path(lf['id'])
        if got is None or got['id'] != lf['id']:
            bad.append('T1 리프 도달 실패: %s (질의=%r)' % (lf['id'], q))
            continue
        r = match(q)
        if r['선종'] != lf['id']:
            bad.append('T1 매칭 불일치: %s → %s (질의=%r)' % (lf['id'], r['선종'], q))

    # T2 — 모든 노드 라벨 × 문장 내 3위치 전수 스윕(L-78: 대표 라벨 몇 개로는 단일어절만 통과한다)
    for n, _, _ in walk(root):
        if n['id'] == root['id']:
            continue
        lab = n['라벨']
        for tmpl in ('%s 이야기인데 기상특보 뜨면 어떻게 되나요?',
                     '기상특보가 떴는데 %s 나갈 수 있나요?',
                     '풍랑주의보에 대해 알고 싶어요 %s'):
            if not label_hit(tmpl % lab, lab):
                bad.append('T2 라벨 미검출: %r in %r' % (lab, tmpl % lab))

    # T3 — 부분문자열 함정: `내항여객선` ⊂ `내항여객선 외의 선박`
    r = match('기상특보 뜨면 어디까지 갈 수 있나요?' + CLARIFY_JOINER + '그 밖의 선박(일반선박)'
              + CLARIFY_JOINER + '내항여객선 외의 선박')
    if r['선종'] != 'other_general_ship':
        bad.append('T3 부분문자열 함정: → %s (내항여객선으로 새면 안 된다)' % r['선종'])
    r = match('기상특보 뜨면 어디까지 갈 수 있나요?' + CLARIFY_JOINER + '그 밖의 선박(일반선박)'
              + CLARIFY_JOINER + '내항여객선')
    if r['선종'] != 'domestic_passenger_ship':
        bad.append('T3 부분문자열 함정(반대방향): → %s' % r['선종'])

    # T4 — 부분문자열 함정: `어선` ⊂ `낚시어선`. 원질문만으로 낚시어선까지 내려가야 한다.
    r = match('낚시어선인데 풍랑주의보 뜨면 나갈 수 있나요?')
    if r['선종'] != 'angling_vessel':
        bad.append('T4 암시 하강 실패: 낚시어선 → %s' % r['선종'])
    if r['특보']['현상'] != ['풍랑'] or r['특보']['등급'] != ['주의보']:
        bad.append('T4 특보 인식 실패: %r' % r['특보'])
    if r['ask'] is not None:
        bad.append('T4 이미 말한 축을 또 물었다: %r' % r['ask'])

    # T5 — 특보를 안 말했으면 특보를 묻고, 그 선택지는 자산이 계산해 둔 것과 같아야 한다.
    r = match('낚싯배로 나가려는데 기상특보 뜨면 어떻게 되나요?' + CLARIFY_JOINER + '어선'
              + CLARIFY_JOINER + '낚시어선')
    leaf = [l for l in leaves if l['id'] == 'angling_vessel'][0]
    if not r['ask'] or r['ask']['축'] != '특보.현상':
        bad.append('T5 특보 질문이 안 나왔다: %r' % (r['ask'] and r['ask']['축']))
    elif [o['label'] for o in r['ask']['options']] != [o['label'] for o in leaf['특보질문']['현상']['선택지']]:
        bad.append('T5 선택지가 자산과 다르다')

    # T6 — 선종을 안 말했으면 선종부터 묻는다(특보 선택지가 선종에 의존하기 때문)
    r = match('풍랑주의보 뜨면 어디까지 다닐 수 있나요?')
    if not r['ask'] or r['ask']['축'] != '선종':
        bad.append('T6 선종 질문이 먼저 나오지 않았다: %r' % (r['ask'] and r['ask']['축']))
    if r['특보']['현상'] != ['풍랑']:
        bad.append('T6 특보는 이미 인식돼 있어야 한다: %r' % r['특보'])

    # T7 — 원양어선: 어선안전조업법이 통째로 적용제외되므로 그 법 항목이 `핵심`에 들어오면 안 된다
    r = match('원양어선인데 태풍주의보 뜨면 나갈 수 있나요?')
    if r['선종'] != 'ocean_fishing_vessel':
        bad.append('T7 원양어선 매칭 실패: %s' % r['선종'])
    elif r['답변범위'] is None:
        bad.append('T7 원양어선: 더 물을 게 남았다 %r' % (r['ask'] and r['ask']['축']))
    else:
        leak = [e['제목'] for e in r['답변범위']['핵심']
                if e['근거법령_slug'] == '어선안전조업및어선원의안전ㆍ보건증진등에관한법률'
                and e['유형'] != '적용제외']
        if leak:
            bad.append('T7 적용제외된 법의 항목이 새어나옴: %r' % leak[:3])
        if not r['답변범위']['적용제외로_멈춘_항목']:
            bad.append('T7 적용제외로 멈춘 항목이 비어 있다(사용자에게 알릴 근거가 사라진다)')

    # T8 — 일상어 오탐 방지: "건조된 선박"의 `건조`를 특보로 읽으면 안 된다
    w = resolve_warning('작년에 건조된 선박인데 나갈 수 있나요?')
    if '건조' in w['현상']:
        bad.append('T8 일상어 오탐: `건조`를 특보로 읽었다')
    w = resolve_warning('건조주의보가 발효됐는데 유선 운항이 되나요?')
    if '건조' not in w['현상']:
        bad.append('T8 `건조주의보`를 못 읽었다')

    # T9 — 답변 범위 분리(배선 전 필수 규약④): 처벌·관할은 `확인후`로 빠져야 한다
    r = match('유선·도선인데 태풍주의보 뜨면 운항할 수 있나요?')
    if r['답변범위'] is None:
        bad.append('T9 유·도선: 더 물을 게 남았다 %r' % (r['ask'] and r['ask']['축']))
    else:
        if any(e['유형'] in ASK_FIRST_KINDS for e in r['답변범위']['핵심']):
            bad.append('T9 처벌·관할이 핵심 답변에 섞였다')
        if not any(e['유형'] == '처벌' for e in r['답변범위']['확인후']):
            bad.append('T9 처벌 항목이 확인후에도 없다')

    # T10 — 한 항목 안에서 현상마다 등급이 다른 경우(`조합`). 풍랑**주의보**에
    #        "태풍주의보ㆍ태풍경보ㆍ풍랑경보" 행이 딸려 나오면 안 된다.
    r = match('낚시어선인데 풍랑주의보 뜨면 나갈 수 있나요?')
    titles = [e['제목'] for e in r['답변범위']['핵심']]
    if any('태풍주의보·태풍경보·풍랑경보' in t for t in titles):
        bad.append('T10 조합 무시: 풍랑주의보에 풍랑**경보** 행이 딸려 나왔다')
    r2 = match('낚시어선인데 풍랑경보 뜨면 나갈 수 있나요?')
    if not any('태풍주의보·태풍경보·풍랑경보' in e['제목'] for e in r2['답변범위']['핵심']):
        bad.append('T10 조합 과잉배제: 풍랑경보인데 해당 행이 빠졌다')

    print('자체 시험 — 리프 %d개 전수 도달 · 라벨 %d개 × 3위치 스윕 · 함정/오탐/범위/조합 시험 8종'
          % (len(leaves), len(list(walk(root))) - 1))
    if bad:
        print('❌ 실패 %d건' % len(bad))
        for x in bad:
            print('  -', x)
        sys.exit(1)
    print('✅ 실패 0건')


if __name__ == '__main__':
    selftest()
