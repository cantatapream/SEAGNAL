#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""자격·면허 등급 계층 트리 빌더 겸 검증기 (H-32 확장 · H-36 두 번째 트리).

역할(초보자용):
  74법 raw 원문을 훑어 "이 자격·면허는 무슨 등급으로 나뉘고, 그 등급을 받으려면 뭐가
  필요하며(자격요건), 그 등급으로 어떤 배에 어떤 자리로 탈 수 있는지(승무기준)"를
  근거조문·별표와 함께 트리(JSON)로 만든다. 사람이 인용문을 타이핑하지 않는다 —
  아래 SPEC에는 "어느 법 몇 조/어느 별표 어느 절"만 적고, 인용문·별표 행 원문은
  이 스크립트가 raw 파일을 직접 열어 뽑아 온다. 없으면 그 자리에서 빌드를 실패시킨다(환각 0).

[연계]
  읽기: legal/raw/**/{법률,시행령,시행규칙}.txt · legal/raw/**/별표/*.txt · 각 법 _meta.json(법령ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/qualification_tree.json
  설계: _dashboard/H32_qualification_tree_design.md (스키마·별표 결합 방식·검증 기준)
  선례: _dashboard/loop/build_vessel_doc_tree.py (같은 규약 — 이 파일은 그 파일을 읽지도 고치지도 않는다)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_qualification_tree.py
독립 재대조: python3 ... build_qualification_tree.py --verify   (빌더 파싱 로직을 재사용하지 않는다)
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
OUT = os.path.join(DASH, 'qualification_tree.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')
ERRORS = []


def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법(자연유산법).
    근거: _dashboard/H29_design.md §2 — H-29·선박종류 트리가 이미 쓰는 같은 목록."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}


# ── 조문 계열(법률·시행령·시행규칙) ────────────────────────────────
def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다.
    ※ 고시계열은 마커 형식이 달라(L-54) 이 함수로 못 읽는다 — 이 트리의 근거는 전부 법률계열이다."""
    out, cur, buf = {}, None, []
    for line in text.split('\n'):
        m = RE_ART.match(line.strip())
        if m:
            if cur:
                out[cur] = '\n'.join(buf)
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            buf = [line.strip()]
        else:
            if cur is not None:
                buf.append(line)
    if cur:
        out[cur] = '\n'.join(buf)
    return out


_cache = {}


def article_body(slug, tier, article):
    """(법, 계층, 조) → 그 조의 raw 원문 전체. 없으면 None."""
    key = (slug, tier)
    if key not in _cache:
        law = BY_SLUG.get(slug)
        p = os.path.join(law['raw'], TIER_FILE[tier]) if law else None
        _cache[key] = split_articles(open(p, encoding='utf-8', errors='replace').read()) \
            if p and os.path.exists(p) else {}
    return _cache[key].get(article)


def law_id(slug, tier):
    """_meta.json의 families.<계층>.법령ID — 법령명이 바뀌어도 추적이 끊기지 않게(H-29 11항·L-74)."""
    law = BY_SLUG.get(slug)
    if not law:
        return None
    p = os.path.join(law['raw'], '_meta.json')
    if not os.path.exists(p):
        return None
    fam = json.load(open(p, encoding='utf-8')).get('families', {})
    return (fam.get(tier) or {}).get('법령ID')


def rel(slug, tier):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], TIER_FILE[tier]), LEGAL)


def quote_of(body, anchor, span=220):
    """anchor를 포함한 문장을 원문에서 뽑아 인용문으로 쓴다(사람이 타이핑하지 않는다).
    항 기호(①…)가 앞에 있으면 그 자리를 문장 시작으로 본다."""
    flat = re.sub(r'\s+', ' ', body)
    i = flat.find(anchor)
    if i < 0:
        return None
    start = -1
    for mark in ['① ', '② ', '③ ', '④ ', '⑤ ', '⑥ ', '⑦ ', '⑧ ', '⑨ ']:
        j = flat.rfind(mark, 0, i)
        if j > start:
            start = j
    if start < 0:
        start = max(0, flat.rfind('. ', 0, i) + 1)
    end = flat.find('다. ', i)
    end = (end + 2) if end > 0 else min(len(flat), i + span)
    return flat[start:end].strip()[:400]


def quote_line(body, anchor):
    """anchor가 들어 있는 '줄'을 통째로 인용한다(호 나열형 조문용 — 제4조제2항 각 호처럼
    한 줄에 항목 하나가 오는 곳에서는 문장 자르기보다 줄 인용이 정확하다).
    @returns 줄 원문(양끝 공백 제거) 또는 None"""
    for line in body.split('\n'):
        if anchor in line:
            return re.sub(r'\s+', ' ', line).strip()[:400]
    return None


# ── 별표 계열 ──────────────────────────────────────────────────────
_annex_cache = {}
SEPCH = '┃│'


def annex_path(slug, tier, num):
    return os.path.join(BY_SLUG[slug]['raw'], '별표', '%s_별표%s.txt' % (tier, num))


def annex_lines(slug, tier, num):
    """별표 파일의 줄 목록(원문 그대로). 없으면 []."""
    key = (slug, tier, num)
    if key not in _annex_cache:
        p = annex_path(slug, tier, num)
        _annex_cache[key] = open(p, encoding='utf-8', errors='replace').read().split('\n') \
            if os.path.exists(p) else []
    return _annex_cache[key]


def cell0(line):
    """박스표 한 줄의 '첫 칸' 텍스트. 표 줄이 아니거나 첫 칸 자리가 가로선이면 None.

    ★줄 전체에 '─'가 있는지로 판정하면 안 된다 — 한 줄이 왼쪽은 본문, 오른쪽은 가로선인
    혼합 줄(`┃신사   │신기능사 이  ├─────┤…`)이 실제로 있어서, 그렇게 판정하면
    '3급 통'+'신사' 같은 등급명이 두 번째 줄에서 끊긴다(실측으로 확인).
    [연계] annex_block()이 '등급이 첫 칸인 별표'에서 등급 블록을 잘라낼 때 쓴다(설계 §5.5)."""
    s = line.strip()
    if not s or s[0] not in SEPCH:
        return None
    idx = [i for i, c in enumerate(s) if c in SEPCH][:2]
    if len(idx) < 2:
        return None
    seg = s[idx[0] + 1:idx[1]]
    return None if ('─' in seg or '━' in seg) else seg


def annex_sections(spec):
    """별표 파일을 '절'로 나눈다. spec['sections'] = [(sid, 제목앵커), …] 순서대로 훑어
    각 절의 줄 범위를 구한다. 앵커를 못 찾으면 빌드 실패.
    @returns {sid: (첫줄, 끝줄)}"""
    lines = annex_lines(spec['slug'], spec['tier'], spec['num'])
    if not lines:
        ERRORS.append('별표 파일 없음: %s %s 별표%s' % (spec['slug'], spec['tier'], spec['num']))
        return {}
    starts, pos = [], 0
    for sid, anchor in spec['sections']:
        found = -1
        for i in range(pos, len(lines)):
            if lines[i].strip().startswith(anchor):
                found = i
                break
        if found < 0:
            ERRORS.append('별표 절 앵커 없음: %s 별표%s ← "%s"'
                          % (spec['slug'], spec['num'], anchor))
            return {}
        starts.append((sid, found))
        pos = found + 1
    out = {}
    for k, (sid, a) in enumerate(starts):
        b = starts[k + 1][1] - 1 if k + 1 < len(starts) else len(lines) - 1
        while b > a and not lines[b].strip():
            b -= 1
        out[sid] = (a, b)
    return out


ANNEX_REG = {}


def annex_key(akey, sid):
    return '%s_%s' % (akey, sid)


def register_annex(akey, sid):
    """별표 절 하나를 최상위 `별표` 레지스트리에 한 번만 담는다(설계 §5.3 — 표를 리프마다
    복제하지 않기 위한 규약). @returns 레지스트리 키"""
    spec = ANNEX[akey]
    key = annex_key(akey, sid)
    if key in ANNEX_REG:
        return key
    rng = annex_sections(spec).get(sid)
    if not rng:
        ERRORS.append('별표 절 범위 없음: %s' % key)
        return key
    a, b = rng
    lines = annex_lines(spec['slug'], spec['tier'], spec['num'])
    ANNEX_REG[key] = {
        '법령': BY_SLUG[spec['slug']]['name'], '법령_slug': spec['slug'],
        '계층': spec['tier'], '법령ID': law_id(spec['slug'], spec['tier']),
        '별표': lines[0].strip() if lines else None,
        '절': lines[a].strip(),
        '근거조문': spec['근거조문'],
        '파일': os.path.relpath(annex_path(spec['slug'], spec['tier'], spec['num']), LEGAL),
        '행범위': [a, b],
        '표_원문': [l.rstrip() for l in lines[a:b + 1]],
    }
    return key


def annex_blocks(akey, sid, label):
    """'등급이 표의 첫 칸인 별표'에서 그 등급의 행 블록을 **전부** 잘라낸다(설계 §5.5).
    첫 칸이 새로 시작되는 줄들을 블록 시작으로 보고, 이어지는 첫 칸 텍스트를 붙여
    (예: '1급'+'항해사') 라벨과 공백 무시 비교한다. 같은 등급이 여러 행으로 나뉜 표
    (전자기관사의 일반/이동식 한정면허 2행)가 실제로 있어 첫 매치만 쓰면 절반을 놓친다.
    @returns [(첫줄, 끝줄), …] — 하나도 없으면 [] (→ 빌드 실패로 기록)"""
    spec = ANNEX[akey]
    rng = annex_sections(spec).get(sid)
    if not rng:
        return []
    a, b = rng
    lines = annex_lines(spec['slug'], spec['tier'], spec['num'])
    starts, prev = [], ''
    for i in range(a, b + 1):
        c = cell0(lines[i])
        if c is None:
            prev = ''
            continue
        if c.strip() and not prev.strip():
            j, txt = i, ''
            while j <= b:
                cj = cell0(lines[j])
                if cj is None or not cj.strip():
                    break
                txt += cj.strip()
                j += 1
            starts.append((i, re.sub(r'\s+', '', txt)))
        prev = c
    want = re.sub(r'\s+', '', label)
    out = []
    for k, (i, txt) in enumerate(starts):
        if want not in txt:
            continue
        end = starts[k + 1][0] - 1 if k + 1 < len(starts) else b
        while end > i and (not lines[end].strip() or cell0(lines[end]) is None):
            end -= 1          # 끝에 붙은 빈 줄·가로선만 있는 줄은 블록에서 뺀다
        out.append((i, end))
    if not out:
        ERRORS.append('별표 등급 블록 없음: %s ← "%s"' % (annex_key(akey, sid), label))
    return out


def annex_hits(akey, sid, token):
    """별표 절 안에서 그 등급 토큰이 나오는 줄을 전부 뽑는다(설계 §5.4 — 표를 구조화하지
    않고 '해당 행 원문'과 '앞선 구분행'만 담는다).
    @returns [{'줄','원문','앞선_구분행'}]"""
    spec = ANNEX[akey]
    rng = annex_sections(spec).get(sid)
    if not rng:
        return []
    a, b = rng
    lines = annex_lines(spec['slug'], spec['tier'], spec['num'])
    out = []
    for i in range(a, b + 1):
        if token not in lines[i]:
            continue
        e = {'줄': i, '원문': lines[i].rstrip()}
        if cell0(lines[i]) is None:
            # 표 밖(비고 등)에서 등급이 언급된 줄 — 표의 '앞선 구분행'을 붙이면 오해를 부른다.
            e['표밖'] = True
        else:
            for j in range(i - 1, a - 1, -1):
                c = cell0(lines[j])
                if c is not None and c.strip():
                    e['앞선_구분행'] = {'줄': j, '원문': lines[j].rstrip()}
                    break
        out.append(e)
    return out


# ── 항목 생성기 ────────────────────────────────────────────────────
def req(요건, slug, tier, article, anchor, line=False, note=None):
    """자격요건 1건(조문본문형). anchor가 그 조문 원문에 없으면 빌드 실패."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('자격요건 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_line(body, anchor) if line else quote_of(body, anchor)
    if q is None:
        ERRORS.append('자격요건 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    e = {'요건': 요건, '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug,
         '계층': tier, '근거조문': article, '법령ID': law_id(slug, tier),
         '파일': rel(slug, tier), '인용': q, '출처유형': '조문본문'}
    if note:
        e['주의'] = note
    return e


def annex_entry(akey, sid, label):
    """별표 행 블록형 항목의 공통 뼈대(자격요건·승무기준이 같이 쓴다)."""
    spec = ANNEX[akey]
    key = register_annex(akey, sid)
    blks = annex_blocks(akey, sid, label)
    if not blks:
        return None
    lines = annex_lines(spec['slug'], spec['tier'], spec['num'])
    body = []
    for a, b in blks:
        body += [l.rstrip() for l in lines[a:b + 1]]
    return {'근거법령': BY_SLUG[spec['slug']]['name'], '근거법령_slug': spec['slug'],
            '계층': spec['tier'], '근거조문': spec['근거조문'],
            '법령ID': law_id(spec['slug'], spec['tier']),
            '별표': key, '행범위': [list(x) for x in blks], '행_원문': body,
            '출처유형': '별표(행 블록)'}


def req_annex(요건, akey, sid, label, note=None):
    """자격요건 1건(별표 행 블록형) — 등급이 첫 칸인 별표에서 그 등급 블록을 통째로 인용."""
    e = annex_entry(akey, sid, label)
    if e is None:
        return None
    e = dict([('요건', 요건)] + list(e.items()))
    if note:
        e['주의'] = note
    return e


def duty_annex_block(구분, akey, sid, label, note=None):
    """승무기준 1건(별표 행 블록형) — 등급이 첫 칸인 별표(수상구조사 업무수행 범위 등)에서
    그 등급의 행 블록을 통째로 인용한다. 토큰 매칭(duty_annex)과 달리 등급명이 줄바꿈으로
    쪼개져 있어도 놓치지 않는다."""
    e = annex_entry(akey, sid, label)
    if e is None:
        return None
    e = dict([('구분', 구분)] + list(e.items()))
    if note:
        e['주의'] = note
    return e


def duty(구분, slug, tier, article, anchor, line=False, note=None):
    """승무기준(그 등급으로 할 수 있는 일) 1건 — 조문본문형."""
    e = req(구분, slug, tier, article, anchor, line=line, note=note)
    if e is None:
        return None
    e['구분'] = e.pop('요건')
    return e


ANNEX_NOTE = ('표의 병합셀(항행구역·톤수 등)은 구조화하지 않았다 — 해당 행만으로는 좌측 조건이 '
              '안 보일 수 있으므로 `별표` 레지스트리의 `표_원문` 전체와 함께 읽어야 한다(설계 §5.4).')


def duty_annex(구분, akey, sid, token, note=ANNEX_NOTE):
    """승무기준 1건(별표 행 매칭형) — 그 절에서 등급 토큰이 나오는 행만 verbatim으로 담는다."""
    spec = ANNEX[akey]
    key = register_annex(akey, sid)
    hits = annex_hits(akey, sid, token)
    if not hits:
        return None
    return {'구분': 구분, '근거법령': BY_SLUG[spec['slug']]['name'], '근거법령_slug': spec['slug'],
            '계층': spec['tier'], '근거조문': spec['근거조문'], '법령ID': law_id(spec['slug'], spec['tier']),
            '별표': key, '절': ANNEX_REG[key]['절'], '해당행': hits, '주의': note}


def prov(slug, tier, article, anchor, disp=None, line=False):
    """노드 출처 1건 — 출처 없는 노드는 만들지 않는다."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('provenance 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_line(body, anchor) if line else quote_of(body, anchor)
    if q is None:
        ERRORS.append('provenance 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    return {'법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': tier,
            '조문': disp or article, '법령ID': law_id(slug, tier),
            '파일': rel(slug, tier), '인용': q}


# ── 74법 전수 스캔(커버리지 산출용) ────────────────────────────────
# 설계 §4의 2중 조건(등급 신호 × 자격 신호). 트리 내용을 만들지는 않고,
# "어디까지 훑었는지"를 수치로 남기기 위해 매 빌드마다 실제로 다시 돌린다.
RE_ART_NB = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(')          # 고시계열(L-54)
SCAN_GRADE = re.compile(r'(제?\s?\d\s?급\s?(?:항해사|기관사|통신사|운항사|도선사|조종면허|선박안전관리사|해기사|수상구조사|응급구조사)'
                        r'|면허의\s?등급|자격의?\s?등급|등급별\s?자격|등급으로\s?구분|등급은\s?[^\n]{0,20}으로\s?하고'
                        r'|특급\s?·?\s?고급|상위등급|하위등급|등급별\s?면허|면허의\s?직종)')
SCAN_QUAL = re.compile(r'(면허|자격증|자격기준|자격시험|해기사|조종사|기술자|자격을\s?취득)')
SCAN_EXC = re.compile(r'(급수시설|급수관|급수설비|먹는물)')


def scan_corpus():
    """74법 raw 전체(법률계열 + 행정규칙 + 별표)를 훑어 커버리지 수치를 만든다.
    선박종류 트리 스캔과 달리 `별표/`도 포함한다 — 이 주제는 별표가 본체이기 때문(설계 §4).
    @returns {files, articles, candidates, laws_with_candidates:[slug…]}"""
    files = articles = cands = 0
    hit = set()
    for law in LAWS:
        for root, _, fs in os.walk(law['raw']):
            for f in sorted(fs):
                if not f.endswith('.txt'):
                    continue
                files += 1
                text = open(os.path.join(root, f), encoding='utf-8', errors='replace').read()
                if '[제' in text[:200] or os.path.basename(root) not in ('행정규칙',):
                    arts = list(split_articles(text).items())
                else:
                    arts = []
                if not arts:
                    arts, cur, buf = [], None, []
                    for line in text.split('\n'):
                        m = RE_ART_NB.match(line.strip())
                        if m:
                            if cur:
                                arts.append((cur, '\n'.join(buf)))
                            cur, buf = m.group(0), [line.strip()]
                        elif cur is not None:
                            buf.append(line)
                    if cur:
                        arts.append((cur, '\n'.join(buf)))
                    if not arts:
                        arts = [('(전문)', text)]
                articles += len(arts)
                for _, body in arts:
                    t = re.sub(r'\s+', ' ', body)
                    for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)', t):
                        s = s.strip()
                        if not s or len(s) > 900 or SCAN_EXC.search(s):
                            continue
                        if SCAN_GRADE.search(s) and SCAN_QUAL.search(s):
                            cands += 1
                            hit.add(law['slug'])
                            break
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_candidates': sorted(hit)}


# ───────────────────────────────────────────────────────────────────
# SPEC — 여기에는 "어느 법 몇 조 / 어느 별표 어느 절" 과 "그 자리에 있어야 할 문구(anchor)"만
#         적는다. 인용문·별표 행 원문·법령ID·파일경로는 전부 위 함수들이 raw에서 읽어 채운다.
# ───────────────────────────────────────────────────────────────────
S_선직 = '선박직원법'
S_도선 = '도선법'
S_레저 = '수상레저안전법'
S_수색 = '수상에서의수색ㆍ구조등에관한법률'
S_해교 = '해상교통안전법'
S_조사 = '해양조사와해양정보활용에관한법률'

ANNEX = {
    '선직_승무기준': {
        'slug': S_선직, 'tier': '시행령', 'num': '3', '근거조문': '제22조제1항(별표3)',
        'sections': [
            ('1', '1. 소형선박을 제외한 선박의 갑판부의 승무기준'),
            ('1가', '가. 어선 외의 선박'), ('1나', '나. 어선'),
            ('2', '2. 소형선박을 제외한 선박의 기관부의 승무기준'),
            ('2가', '가. 어선 외의 선박'), ('2나', '나. 어선'),
            ('3', '3. 통신급(전파통신급에 한정한다)의 승무기준'),
            ('4', '4. 소형선박의 승무기준'),
            ('5', '5. 자동화선박의 승무기준'),
            ('6', '6. 수면비행선박의 승무기준'),
            ('7', '7. 항행구역이 연안수역'),
            ('7가', '가. 어선 외의 선박'), ('7나', '나. 어선'),
        ]},
    '선직_승무경력': {
        'slug': S_선직, 'tier': '시행령', 'num': '1의3', '근거조문': '제5조의2(별표1의3)',
        'sections': [
            ('항해사', '1. 항해사'), ('기관사', '2. 기관사'), ('통신사', '3. 통신사'),
            ('통신사_전파통신급', '가. 전파통신급'), ('통신사_전파전자급', '나. 전파전자급'),
            ('소형선박조종사', '4. 소형선박 조종사'), ('운항사', '5. 운항사'),
            ('수면비행선박조종사', '6. 수면비행선박 조종사'),
        ]},
    '선직_GMDSS': {
        'slug': S_선직, 'tier': '시행령', 'num': '3의2', '근거조문': '제22조의2제1항(별표3의2)',
        'sections': [('전체', '■ 선박직원법 시행령 [별표 3의2]')]},
    '수색_수상구조사': {
        'slug': S_수색, 'tier': '시행령', 'num': '1의2', '근거조문': '제30조의7(별표1의2)',
        'sections': [('자격기준', '자격기준'), ('업무수행범위', '2. 업무수행 범위')]},
    '해교_응시자격': {
        'slug': S_해교, 'tier': '시행령', 'num': '7', '근거조문': '제23조제2항(별표7)',
        'sections': [('전체', '■ 해상교통안전법 시행령 [별표 7]')]},
    '해교_시험방식': {
        'slug': S_해교, 'tier': '시행령', 'num': '8', '근거조문': '제24조제1항(별표8)',
        'sections': [('전체', '■ 해상교통안전법 시행령 [별표 8]')]},
    '조사_등급기준': {
        'slug': S_조사, 'tier': '시행령', 'num': '1', '근거조문': '제11조(별표1)',
        'sections': [('전체', '■ 해양조사와 해양정보 활용에 관한 법률 시행령 [별표 1]')]},
}

# 해기사 직종별 등급 목록과, 그 등급을 찾을 별표 절들.
#   승무기준절 = 별표3에서 이 직종이 등장할 수 있는 절(토큰이 없으면 그 절은 그냥 안 담긴다)
HAEGI = {
    '항해사': {'grades': ['1급 항해사', '2급 항해사', '3급 항해사', '4급 항해사', '5급 항해사', '6급 항해사'],
               '경력절': ['항해사'], '승무절': ['1가', '1나', '4', '5', '7가', '7나'],
               'idbase': 'navigator', '호': '제4조제2항제1호'},
    '기관사': {'grades': ['1급 기관사', '2급 기관사', '3급 기관사', '4급 기관사', '5급 기관사', '6급 기관사'],
               '경력절': ['기관사'], '승무절': ['2가', '2나', '4', '5', '7가', '7나'],
               'idbase': 'engineer', '호': '제4조제2항제2호'},
    '통신사': {'grades': ['1급 통신사', '2급 통신사', '3급 통신사', '4급 통신사'],
               '경력절': ['통신사_전파통신급', '통신사_전파전자급'], '승무절': ['3', '5'],
               'gmdss': True,
               'idbase': 'radio', '호': '제4조제2항제3호'},
    '운항사': {'grades': ['1급 운항사', '2급 운항사', '3급 운항사', '4급 운항사'],
               '경력절': ['운항사'], '승무절': ['5'],
               'idbase': 'operator', '호': '제4조제2항제4호'},
}

# 등급 묶음(설계 §3.3 — UI 선택지 상한 3개 때문에 만든 노드. 법이 정한 분류가 아니다)
BUNDLE_NOTE = 'UI 선택지 상한(3개) 때문에 만든 묶음 노드 — 법이 정한 분류가 아니다(설계 §3.3). ' \
              '묶는 순서는 선박직원법 제4조제3항의 상하 등급 순서를 그대로 따랐다.'


def grade_leaf(node_id, label, 정의, prov_list, reqs, duties, 메모=None, 추가확인=None):
    n = {'id': node_id, '라벨': label, '정의': 정의, 'provenance': prov_list,
         '자격요건': [r for r in reqs if r], '승무기준': [d for d in duties if d],
         '추가확인': 추가확인 or [], 'children': []}
    if 메모:
        n['메모'] = 메모
    return n


def haegi_stem():
    """해기사 등급 노드의 공통 출처 — 제4조제2항 본문(어느 조문이 이 등급들을 열거하는지).
    등급 줄만 인용하면("6급 항해사") 그 줄만으로는 무슨 조문인지 알 수 없어 함께 싣는다."""
    return prov(S_선직, '법률', '제4조', '다음 각 호의 직종과 등급별로 면허를 한다', '제4조제2항')


def build_haegi_job(job):
    """해기사 한 직종(항해사/기관사/통신사/운항사)의 등급 서브트리를 만든다.
    등급이 4개를 넘으면 §3.3의 묶음 노드로 3갈래 이하가 되게 나눈다."""
    cfg = HAEGI[job]
    leaves = []
    for g in cfg['grades']:
        num = g.split('급')[0]
        reqs = [req_annex('%s 면허를 위한 승무경력' % g, '선직_승무경력', sid, g)
                for sid in cfg['경력절']]
        duties = [duty_annex('선박직원의 최저승무기준', '선직_승무기준', sid, g)
                  for sid in cfg['승무절']]
        if cfg.get('gmdss'):
            # 전파전자급 통신사의 승무기준은 별표3이 아니라 별표3의2에 있다(시행령 제22조의2제1항).
            duties.append(duty_annex('GMDSS 관련설비를 갖춘 선박의 전파전자급 통신사 승무기준',
                                     '선직_GMDSS', '전체', g))
        leaves.append(grade_leaf(
            '%s_%s' % (cfg['idbase'], num), g,
            '선박직원법 제4조제2항 %s의 %s 면허 등급' % (cfg['호'], job),
            [haegi_stem(), prov(S_선직, '법률', '제4조', g, cfg['호'], line=True)],
            reqs, duties,
            메모=None if any(duties) else '별표3(최저승무기준)에서 이 등급이 승무자격으로 나오는 행은 확인되지 않았다.',
            추가확인=[AX_한정면허] + ([AX_통신급] if job == '통신사' else [])
                    + ([AX_운항사전문] if job == '운항사' else [])))
    # 묶음(3개 초과일 때만)
    if len(leaves) <= 3:
        kids, opts = leaves, [{'label': l['라벨'], 'hint': l['정의'], 'next': l['id']} for l in leaves]
    else:
        kids, opts = [], []
        for k in range(0, len(leaves), 2):
            pair = leaves[k:k + 2]
            bid = '%s_g%s' % (cfg['idbase'], ''.join(l['라벨'].split('급')[0] for l in pair))
            blabel = '·'.join(l['라벨'].split(' ')[0] for l in pair) + ' ' + job
            kids.append({
                'id': bid, '라벨': blabel,
                '정의': '%s 중 %s' % (job, ' 및 '.join(l['라벨'] for l in pair)),
                '분류근거': BUNDLE_NOTE,
                'provenance': [prov(S_선직, '법률', '제4조',
                                    '직종별 면허의 상하 등급은', '제4조제3항')],
                '질문': '둘 중 어느 등급이신가요?',
                '선택지': [{'label': l['라벨'], 'hint': l['정의'], 'next': l['id']} for l in pair],
                'children': pair})
            opts.append({'label': blabel, 'hint': '선박직원법 제4조제2항 %s의 등급 중 %s'
                                                  % (cfg['호'], ' 및 '.join(l['라벨'] for l in pair)),
                         'next': bid})
    return {'id': cfg['idbase'], '라벨': job,
            '정의': '선박직원법 제4조제2항 %s의 직종' % cfg['호'],
            'provenance': [prov(S_선직, '법률', '제4조', job, cfg['호'], line=True)],
            '질문': '몇 급 %s이신가요?' % job,
            '선택지': opts, 'children': kids}


# 리프의 잔여 축(설계 §3.4) — 트리로 안 쪼갠 조건을 되묻기가 이어서 물을 수 있게 문구까지 데이터로.
AX_한정면허 = {
    '축': '한정면허',
    '질문': '상선·어선 등으로 한정된 면허인가요?',
    '선택지': [{'label': '상선면허'}, {'label': '어선면허'}, {'label': '한정 없음'}],
    '근거': '선박직원법 제4조제2항 후단 · 같은 법 시행령 제4조(한정면허 — 상선/어선/특수선박/특정수역/모터보트·동력요트)',
}
AX_통신급 = {
    '축': '통신사 구분',
    '질문': '전파통신급인가요, 전파전자급인가요?',
    '선택지': [{'label': '전파통신급'}, {'label': '전파전자급'}],
    '근거': '선박직원법 제4조제2항제3호("통신사(전파통신급과 전파전자급으로 구분한다)")',
}
AX_운항사전문 = {
    '축': '운항사 전문분야',
    '질문': '항해전문인가요, 기관전문인가요?',
    '선택지': [{'label': '항해전문'}, {'label': '기관전문'}],
    '근거': '선박직원법 제4조제4항(운항사는 대통령령으로 정하는 전문분야별로 …로 본다)',
}
AX_도선구 = {
    '축': '도선구',
    '질문': '어느 도선구에서 도선하시나요?',
    '선택지': [{'label': '지정된 도선구'}, {'label': '그 밖의 도선구'}],
    '근거': '도선법 제4조제2항(등급으로 구분하여 제17조에 따른 도선구별로 한다) · 같은 법 시행령 제1조의2제2항제2호',
}


def build():
    # ── A. 해기사 면허 ────────────────────────────────────────────
    nav = build_haegi_job('항해사')
    eng = build_haegi_job('기관사')
    radio = build_haegi_job('통신사')
    oper = build_haegi_job('운항사')

    elec = grade_leaf(
        'electro_engineer', '전자기관사', '선박직원법 제4조제2항제2호의2의 면허 직종(등급 구분 없음)',
        [haegi_stem(), prov(S_선직, '법률', '제4조', '전자기관사', '제4조제2항제2호의2', line=True)],
        [req_annex('전자기관사 면허를 위한 승무경력', '선직_승무경력', '기관사', '전자기관사')],
        [duty_annex('선박직원의 최저승무기준', '선직_승무기준', '2가', '전자기관사')],
        추가확인=[AX_한정면허])

    small = grade_leaf(
        'small_ship_operator', '소형선박 조종사',
        '선박직원법 제4조제2항제6호의 면허 직종 — 같은 조 제4항에 따라 6급 항해사 또는 6급 기관사의 하위등급 해기사로 본다',
        [haegi_stem(), prov(S_선직, '법률', '제4조', '소형선박 조종사', '제4조제2항제6호', line=True)],
        [req_annex('소형선박 조종사 면허를 위한 승무경력', '선직_승무경력', '소형선박조종사', '소형선박')],
        [duty_annex('선박직원의 최저승무기준', '선직_승무기준', '4', '소형선박 조종사')],
        추가확인=[AX_한정면허])

    wig_m = grade_leaf(
        'wig_medium', '중형 수면비행선박 조종사',
        '최대 이수중량(離水重量) 10톤 이상 500톤 미만의 수면비행선박만 해당하는 면허(선박직원법 제4조제2항제5호)',
        [haegi_stem(), prov(S_선직, '법률', '제4조', '중형 수면비행선박 조종사', '제4조제2항제5호', line=True)],
        [req_annex('중형 수면비행선박 조종사 면허를 위한 승무경력', '선직_승무경력',
                   '수면비행선박조종사', '중형')],
        [duty_annex('수면비행선박의 승무기준', '선직_승무기준', '6', '중형 수면비행선박 조종사')])
    wig_s = grade_leaf(
        'wig_small', '소형 수면비행선박 조종사',
        '최대 이수중량 10톤 미만의 수면비행선박만 해당하는 면허(선박직원법 제4조제2항제5호)',
        [haegi_stem(), prov(S_선직, '법률', '제4조', '소형 수면비행선박 조종사', '제4조제2항제5호', line=True)],
        [req_annex('소형 수면비행선박 조종사 면허를 위한 승무경력', '선직_승무경력',
                   '수면비행선박조종사', '소형')],
        [duty_annex('수면비행선박의 승무기준', '선직_승무기준', '6', '소형 수면비행선박 조종사')])
    wig = {
        'id': 'wig_operator', '라벨': '수면비행선박 조종사',
        '정의': '선박직원법 제4조제2항제5호의 면허 직종 — 중형·소형으로 나뉜다',
        'provenance': [prov(S_선직, '법률', '제4조', '수면비행선박 조종사', '제4조제2항제5호', line=True)],
        '질문': '중형인가요, 소형인가요?',
        '선택지': [
            {'label': '중형 수면비행선박 조종사', 'hint': '최대 이수중량 10톤 이상 500톤 미만의 선박만 해당', 'next': 'wig_medium'},
            {'label': '소형 수면비행선박 조종사', 'hint': '최대 이수중량 10톤 미만의 선박만 해당', 'next': 'wig_small'},
        ],
        'children': [wig_m, wig_s]}

    haegi_etc2 = {
        'id': 'haegi_etc2', '라벨': '수면비행선박 조종사·소형선박 조종사',
        '정의': '해기사 면허 직종 중 조종사 계열(선박직원법 제4조제2항제5호·제6호)',
        '분류근거': BUNDLE_NOTE,
        'provenance': [prov(S_선직, '법률', '제4조', '소형선박 조종사', '제4조제2항제6호', line=True)],
        '질문': '어느 조종사 면허인가요?',
        '선택지': [
            {'label': '수면비행선박 조종사', 'hint': '수면에 근접해 비행하는 선박의 조종사 면허(선박직원법 제4조제2항제5호)', 'next': 'wig_operator'},
            {'label': '소형선박 조종사', 'hint': '6급 항해사·6급 기관사의 하위등급으로 보는 면허(선박직원법 제4조제2항제6호·제4항)', 'next': 'small_ship_operator'},
        ],
        'children': [wig, small]}

    haegi_etc = {
        'id': 'haegi_etc', '라벨': '통신사·운항사·조종사',
        '정의': '해기사 면허 직종 중 항해사·기관사 계열이 아닌 것',
        '분류근거': BUNDLE_NOTE,
        'provenance': [prov(S_선직, '법률', '제4조', '통신사', '제4조제2항제3호', line=True)],
        '질문': '어느 직종인가요?',
        '선택지': [
            {'label': '통신사', 'hint': '전파통신급과 전파전자급으로 구분되는 면허(선박직원법 제4조제2항제3호)', 'next': 'radio'},
            {'label': '운항사', 'hint': '자동화선박에 승무하는 면허 — 전문분야별로 같은 등급의 항해사·기관사로 본다(선박직원법 제4조제2항제4호·제4항)', 'next': 'operator'},
            {'label': '수면비행선박 조종사·소형선박 조종사', 'hint': '선박직원법 제4조제2항제5호·제6호의 조종사 면허', 'next': 'haegi_etc2'},
        ],
        'children': [radio, oper, haegi_etc2]}

    eng_group = {
        'id': 'engineer_family', '라벨': '기관사·전자기관사',
        '정의': '선박직원법 제4조제2항제2호·제2호의2의 기관 계열 직종',
        '분류근거': BUNDLE_NOTE,
        'provenance': [prov(S_선직, '법률', '제4조', '전자기관사', '제4조제2항제2호의2', line=True)],
        '질문': '기관사인가요, 전자기관사인가요?',
        '선택지': [
            {'label': '기관사', 'hint': '1급부터 6급까지 등급이 있는 기관 직종 면허(선박직원법 제4조제2항제2호)', 'next': 'engineer'},
            {'label': '전자기관사', 'hint': '등급 구분이 없는 별도 직종 면허(선박직원법 제4조제2항제2호의2)', 'next': 'electro_engineer'},
        ],
        'children': [eng, elec]}

    haegi = {
        'id': 'haegi_license', '라벨': '해기사 면허',
        '정의': '선박직원이 되려는 사람이 받아야 하는 해양수산부장관의 면허 — 직종과 등급별로 한다',
        'provenance': [
            prov(S_선직, '법률', '제4조', '선박직원이 되려는 사람은 해양수산부장관의 해기사 면허', '제4조제1항'),
            prov(S_선직, '법률', '제4조', '다음 각 호의 직종과 등급별로 면허를 한다', '제4조제2항'),
        ],
        '상하순서': '직종별 면허의 상하 등급은 제4조제2항 각 호의 등급별 순서에 따른다(선박직원법 제4조제3항).',
        '질문': '어느 직종의 해기사 면허인가요?',
        '선택지': [
            {'label': '항해사', 'hint': '1급부터 6급까지 등급이 있는 갑판 직종 면허(선박직원법 제4조제2항제1호)', 'next': 'navigator'},
            {'label': '기관사·전자기관사', 'hint': '기관 직종 면허 — 기관사는 1~6급, 전자기관사는 등급 구분 없음(같은 항 제2호·제2호의2)', 'next': 'engineer_family'},
            {'label': '통신사·운항사·조종사', 'hint': '통신사(1~4급)·운항사(1~4급)·수면비행선박 조종사·소형선박 조종사(같은 항 제3호~제6호)', 'next': 'haegi_etc'},
        ],
        '자격요건': [
            req('해기사 시험 합격, 등급별 승무경력, 건강상태 확인, 등급별 교육·훈련 이수(통신사는 무선종사자 자격)',
                S_선직, '법률', '제5조', '해양수산부장관은 다음 각 호의 요건을 갖춘 사람이'),
            req('결격사유 — 18세 미만이거나 면허가 취소된 날부터 2년이 지나지 아니한 사람은 해기사가 될 수 없다',
                S_선직, '법률', '제6조', '다음 각 호의 어느 하나에 해당하는 사람은 해기사가 될 수 없다'),
            req('면허의 유효기간은 5년이며 갱신하지 않으면 효력이 정지된다',
                S_선직, '법률', '제7조', '면허의 유효기간은 5년으로 하고'),
        ],
        '승무기준': [
            duty('선박소유자는 선박직원으로 일정 자격의 해기사를 승무시켜야 한다(최저승무기준은 대통령령)',
                 S_선직, '법률', '제11조', '승무기준(이하 "승무기준"이라 한다)에 맞는 해기사'),
            duty('원양수역 항행선박에서 선장·1등 항해사·기관장 등의 직무를 하려면 별표4의 승무경력과 교육과정이 필요하다',
                 S_선직, '시행령', '제22조', '별표4의 규정에 의한 승무경력이 있고'),
        ],
        'children': [nav, eng_group, haegi_etc]}

    # ── B. 도선사 면허 ────────────────────────────────────────────
    pilot_grades = []
    PILOT = [('1급 도선사', '1급 도선사: 2급 도선사로 1년 이상의 기간 동안 200회 이상 도선업무에 종사한 사람',
              '1급 도선사: 다음 각 목의 구분에 따른 선박'),
             ('2급 도선사', '2급 도선사: 3급 도선사로 1년 이상의 기간 동안 200회 이상 도선업무에 종사한 사람',
              '2급 도선사: 총톤수 7만톤 이하인 선박'),
             ('3급 도선사', '3급 도선사: 4급 도선사로 1년 이상의 기간 동안 200회 이상 도선업무에 종사한 사람',
              '3급 도선사: 총톤수 5만톤 이하인 선박'),
             ('4급 도선사', None, '4급 도선사: 총톤수 3만톤 이하인 선박')]
    for label, career, ship in PILOT:
        num = label[0]
        reqs = []
        if career:
            reqs.append(req('%s 면허의 등급별 경력 기준' % label, S_도선, '시행령', '제1조의3', career, line=True))
        pilot_grades.append(grade_leaf(
            'pilot_%s' % num, label, '도선법 제4조제2항의 도선사면허 등급',
            [prov(S_도선, '법률', '제4조', label, '제4조제2항', line=True)],
            reqs,
            [duty('이 등급으로 도선할 수 있는 선박의 종류', S_도선, '시행령', '제1조의2', ship, line=True),
             duty('1급 도선사(경력 1년 이상)와 함께 도선하는 등의 경우에는 모든 선박을 도선할 수 있다',
                  S_도선, '시행령', '제1조의2', '2급 이하 도선사는 제1항에도 불구하고')
             if label != '1급 도선사' else None],
            메모=None if career else '도선법 시행령 제1조의3은 1~3급의 경력 기준만 정하고 4급 도선사의 경력 기준은 두지 않았다 '
                                     '— 4급은 법 제5조 각 호의 공통 요건(총톤수 6천톤 이상 선박 선장 3년 등)만 적용된다.',
            추가확인=[AX_도선구]))

    pilot = {
        'id': 'pilot_license', '라벨': '도선사 면허',
        '정의': '도선사가 되려는 사람이 받아야 하는 해양수산부장관의 면허 — 1급부터 4급까지 등급으로 구분하고 도선구별로 한다',
        'provenance': [
            prov(S_도선, '법률', '제4조', '도선사가 되려는 사람은 해양수산부장관의 면허를 받아야 한다', '제4조제1항'),
            prov(S_도선, '법률', '제4조', '다음 각 호의 등급으로 구분하여 제17조에 따른 도선구별로 한다', '제4조제2항'),
        ],
        '질문': '몇 급 도선사이신가요?',
        '선택지': [
            {'label': '1급 도선사', 'hint': '도선법 제4조제2항제1호 — 경력 1년 이상이면 모든 선박을 도선할 수 있다', 'next': 'pilot_1'},
            {'label': '2급 도선사', 'hint': '도선법 제4조제2항제2호', 'next': 'pilot_2'},
            {'label': '3급·4급 도선사', 'hint': '도선법 제4조제2항제3호·제4호', 'next': 'pilot_g34'},
        ],
        '자격요건': [
            req('총톤수 6천톤 이상 선박의 선장 3년 이상 승무경력, 도선수습생 전형시험 합격·실무수습, 도선사 시험 합격, 신체검사 합격',
                S_도선, '법률', '제5조', '해양수산부장관은 다음 각 호의 요건을 모두 갖춘 사람으로서'),
            req('결격사유 — 대한민국 국민이 아닌 사람, 해기사면허가 취소된 사람 등',
                S_도선, '법률', '제6조', '다음 각 호의 어느 하나에 해당하는 사람은 도선사가 될 수 없다'),
            req('도선사면허의 유효기간은 5년이며 갱신하지 않으면 효력이 정지된다',
                S_도선, '법률', '제6조의2', '도선사면허의 유효기간은'),
        ],
        'children': [pilot_grades[0], pilot_grades[1], {
            'id': 'pilot_g34', '라벨': '3급·4급 도선사',
            '정의': '도선사면허 등급 중 3급 도선사 및 4급 도선사',
            '분류근거': BUNDLE_NOTE,
            'provenance': [prov(S_도선, '법률', '제4조', '3급 도선사', '제4조제2항제3호', line=True)],
            '질문': '3급인가요, 4급인가요?',
            '선택지': [
                {'label': '3급 도선사', 'hint': '도선법 제4조제2항제3호', 'next': 'pilot_3'},
                {'label': '4급 도선사', 'hint': '도선법 제4조제2항제4호', 'next': 'pilot_4'},
            ],
            'children': [pilot_grades[2], pilot_grades[3]]}]}

    # ── C. 동력수상레저기구 조종면허 ───────────────────────────────
    lic1 = grade_leaf(
        'boat_lic_1', '제1급 조종면허',
        '수상레저안전법 제5조제2항제1호의 일반조종면허 중 상위 등급',
        [prov(S_레저, '법률', '제5조', '일반조종면허 : 제1급 조종면허, 제2급 조종면허', '제5조제2항제1호', line=True)],
        [req('발급대상 — 수상레저사업의 종사자, 시험대행기관의 시험관',
             S_레저, '시행령', '제4조', '제1급 조종면허: 법 제37조제1항에 따라 등록된 수상레저사업의 종사자', line=True),
         req('결격사유 — 18세 미만인 사람은 제1급 조종면허를 받을 수 없다',
             S_레저, '법률', '제7조', '14세 미만(제1급 조종면허의 경우에는 18세 미만)인 사람', line=True),
         req('필기시험 합격기준 — 100점 만점에 70점 이상',
             S_레저, '시행령', '제8조', '일반조종면허: 100점을 만점으로 하여 제1급 조종면허는 70점 이상', line=True)],
        [duty('제2급 조종면허를 받은 사람이 제1급 조종면허를 받으면 제2급 조종면허의 효력은 상실된다',
              S_레저, '법률', '제5조', '제2급 조종면허의 효력은 상실된다')])
    lic2 = grade_leaf(
        'boat_lic_2', '제2급 조종면허',
        '수상레저안전법 제5조제2항제1호의 일반조종면허 중 하위 등급',
        [prov(S_레저, '법률', '제5조', '일반조종면허 : 제1급 조종면허, 제2급 조종면허', '제5조제2항제1호', line=True)],
        [req('발급대상 — 조종면허를 받아야 하는 동력수상레저기구(세일링요트 제외)를 조종하려는 사람',
             S_레저, '시행령', '제4조', '제2급 조종면허: 제1항에 따라 조종면허를 받아야 하는 동력수상레저기구', line=True),
         req('결격사유 — 14세 미만인 사람은 조종면허를 받을 수 없다',
             S_레저, '법률', '제7조', '14세 미만(제1급 조종면허의 경우에는 18세 미만)인 사람', line=True),
         req('필기시험 합격기준 — 100점 만점에 60점 이상',
             S_레저, '시행령', '제8조', '일반조종면허: 100점을 만점으로 하여 제1급 조종면허는 70점 이상', line=True)],
        [],
        메모='이 등급으로 조종할 수 있는 기구의 범위는 별도의 업무범위 조문이 아니라 발급대상 조문'
             '(수상레저안전법 시행령 제4조제2항제1호나목 — 위 자격요건에 담겨 있다)에 나타난다.')
    general_lic = {
        'id': 'general_boat_license', '라벨': '일반조종면허',
        '정의': '수상레저안전법 제5조제2항제1호의 조종면허 구분 — 제1급 조종면허와 제2급 조종면허로 나뉜다',
        'provenance': [prov(S_레저, '법률', '제5조', '일반조종면허 : 제1급 조종면허, 제2급 조종면허', '제5조제2항제1호', line=True)],
        '질문': '제1급인가요, 제2급인가요?',
        '선택지': [
            {'label': '제1급 조종면허', 'hint': '수상레저사업 종사자·시험대행기관 시험관이 받는 등급(수상레저안전법 시행령 제4조제2항제1호가목)', 'next': 'boat_lic_1'},
            {'label': '제2급 조종면허', 'hint': '세일링요트를 제외한 동력수상레저기구를 조종하려는 사람이 받는 등급(같은 목 나목)', 'next': 'boat_lic_2'},
        ],
        'children': [lic1, lic2]}
    yacht_lic = grade_leaf(
        'yacht_license', '요트조종면허',
        '수상레저안전법 제5조제2항제2호의 조종면허 — 세일링요트를 조종하려는 사람이 받는다',
        [prov(S_레저, '법률', '제5조', '요트조종면허', '제5조제2항제2호', line=True)],
        [req('발급대상 — 세일링요트를 조종하려는 사람',
             S_레저, '시행령', '제4조', '요트조종면허: 세일링요트를 조종하려는 사람', line=True),
         req('필기시험 합격기준 — 100점 만점에 70점 이상',
             S_레저, '시행령', '제8조', '요트조종면허: 100점을 만점으로 하여 70점 이상일 것', line=True)],
        [],
        메모='이 면허로 조종할 수 있는 기구의 범위는 별도의 업무범위 조문이 아니라 발급대상 조문'
             '(수상레저안전법 시행령 제4조제2항제2호 — 위 자격요건에 담겨 있다)에 나타난다.')
    boat = {
        'id': 'boat_license', '라벨': '동력수상레저기구 조종면허',
        '정의': '동력수상레저기구를 조종하려는 사람이 면허시험에 합격한 후 받아야 하는 해양경찰청장의 면허',
        'provenance': [
            prov(S_레저, '법률', '제5조', '동력수상레저기구 조종면허(이하 "조종면허"라 한다)를 받아야 한다', '제5조제1항'),
            prov(S_레저, '법률', '제5조', '조종면허는 다음 각 호와 같이 구분한다', '제5조제2항'),
        ],
        '질문': '일반조종면허인가요, 요트조종면허인가요?',
        '선택지': [
            {'label': '일반조종면허', 'hint': '제1급·제2급으로 나뉘는 조종면허(수상레저안전법 제5조제2항제1호)', 'next': 'general_boat_license'},
            {'label': '요트조종면허', 'hint': '세일링요트를 조종하려는 사람의 면허(같은 항 제2호)', 'next': 'yacht_license'},
        ],
        '자격요건': [
            req('조종면허를 받으려는 사람은 해양경찰청장이 실시하는 면허시험(필기·실기)에 합격하여야 한다',
                S_레저, '법률', '제8조', '해양경찰청장이 실시하는 시험'),
            req('조종면허를 받아야 하는 동력수상레저기구는 추진기관 최대출력 5마력 이상인 것이다',
                S_레저, '시행령', '제4조', '추진기관의 최대 출력이 5마력 이상'),
        ],
        'children': [general_lic, yacht_lic]}

    # ── D. 수상구조사 ─────────────────────────────────────────────
    rescue_leaves = []
    for nid, label, blk in [('rescue_master', '수상구조사 지도사', '수상구조사 지도사'),
                            ('rescue_1', '수상구조사 1급', '수상구조사 1급'),
                            ('rescue_2', '수상구조사 2급', '수상구조사 2급')]:
        rescue_leaves.append(grade_leaf(
            nid, label, '수상에서의 수색·구조 등에 관한 법률 제30조의2제3항의 수상구조사 등급',
            [prov(S_수색, '법률', '제30조의2', '수상구조사의 등급은 지도사ㆍ1급ㆍ2급으로 하고', '제30조의2제3항')],
            [req_annex('%s의 자격기준' % label, '수색_수상구조사', '자격기준', blk)],
            [duty_annex_block('%s의 업무수행 범위' % label, '수색_수상구조사', '업무수행범위', blk)]))
    rescue = {
        'id': 'rescuer', '라벨': '수상구조사',
        '정의': '수상에서 조난된 사람을 구조하고 안전사고 예방 활동·교육을 수행하는 전문 능력을 인정받아 해양경찰청장이 자격을 부여한 사람',
        'provenance': [
            prov(S_수색, '법률', '제30조의2', '수상구조사 자격을 부여할 수 있다', '제30조의2제1항'),
            prov(S_수색, '법률', '제30조의2', '수상구조사의 등급은 지도사ㆍ1급ㆍ2급으로 하고', '제30조의2제3항'),
        ],
        '질문': '어느 등급의 수상구조사인가요?',
        '선택지': [
            {'label': '수상구조사 지도사', 'hint': '1급 자격 취득 후 3년 이상 경력을 갖추고 지도사 시험에 합격한 사람(시행령 별표1의2)', 'next': 'rescue_master'},
            {'label': '수상구조사 1급', 'hint': '1급 교육과정 이수 후 1급 시험에 합격한 사람 등(같은 별표)', 'next': 'rescue_1'},
            {'label': '수상구조사 2급', 'hint': '2급 교육과정 이수 후 2급 시험에 합격한 사람(같은 별표)', 'next': 'rescue_2'},
        ],
        '자격요건': [
            req('교육기관에서 교육과정을 이수한 후 해양경찰청장이 실시하는 시험에 합격하여야 한다',
                S_수색, '법률', '제30조의2', '교육과정을 이수한 후 해양경찰청장이 실시하는 시험에 합격'),
            req('결격사유 — 이 조 각 호에 해당하는 사람은 수상구조사가 될 수 없다',
                S_수색, '법률', '제30조의3', '다음 각 호의 어느 하나에 해당하는 사람은 수상구조사가 될 수 없다'),
        ],
        'children': rescue_leaves}

    # ── E. 선박안전관리사 ─────────────────────────────────────────
    sm_leaves = []
    for nid, label, blk in [('safety_mgr_1', '1급 선박안전관리사', '1급'),
                            ('safety_mgr_2', '2급 선박안전관리사', '2급'),
                            ('safety_mgr_3', '3급 선박안전관리사', '3급')]:
        sm_leaves.append(grade_leaf(
            nid, label, '해상교통안전법 시행령 제23조제1항이 정한 선박안전관리사 등급',
            [prov(S_해교, '시행령', '제23조', '선박안전관리사의 등급은 1급, 2급 및 3급으로 구분한다', '제23조제1항')],
            [req_annex('%s 자격시험 응시자격' % label, '해교_응시자격', '전체', blk),
             req_annex('%s 자격시험의 방식' % label, '해교_시험방식', '전체', blk)],
            [],
            메모='등급별로 업무 범위를 따로 정한 조문은 raw에서 확인되지 않았다 — '
                 '해상교통안전법 제64조제2항의 선박안전관리사 업무는 등급 구분 없이 공통이며 이 가족 노드에서 상속된다.'))
    safety_mgr = {
        'id': 'ship_safety_manager', '라벨': '선박안전관리사',
        '정의': '해사안전 및 선박·사업장 안전관리를 전문적으로 수행하도록 해양수산부장관이 관리·운영하는 자격',
        'provenance': [
            prov(S_해교, '법률', '제64조', '선박안전관리사 자격제도를 관리ㆍ운영한다', '제64조제1항'),
            prov(S_해교, '시행령', '제23조', '선박안전관리사의 등급은 1급, 2급 및 3급으로 구분한다', '제23조제1항'),
        ],
        '질문': '몇 급 선박안전관리사이신가요?',
        '선택지': [
            {'label': '1급 선박안전관리사', 'hint': '2급 취득 후 4년 이상 실무 또는 2급 항해사·기관사·운항사 이상 면허 후 5년 이상 실무(시행령 별표7)', 'next': 'safety_mgr_1'},
            {'label': '2급 선박안전관리사', 'hint': '3급 취득 후 2년 이상 실무 또는 3급 항해사·기관사·운항사 이상 면허 후 3년 이상 실무(같은 별표)', 'next': 'safety_mgr_2'},
            {'label': '3급 선박안전관리사', 'hint': '응시자격 제한 없음(같은 별표)', 'next': 'safety_mgr_3'},
        ],
        '자격요건': [
            req('대통령령으로 정하는 응시자격을 갖추고 해양수산부장관이 실시하는 자격시험에 합격하여야 한다',
                S_해교, '법률', '제64조', '자격시험에 합격하여야 한다'),
            req('결격사유 — 이 조 각 호에 해당하는 자는 선박안전관리사가 될 수 없다',
                S_해교, '법률', '제66조', '다음 각 호의 어느 하나에 해당하는 자는 선박안전관리사가 될 수 없다'),
        ],
        '승무기준': [
            duty('선박안전관리사의 업무(등급 구분 없이 공통)',
                 S_해교, '법률', '제64조', '선박안전관리사는 다음 각 호의 업무를 수행한다'),
            duty('안전관리체제 대상 선박소유자는 안전관리책임자·안전관리자를 선박안전관리사 자격자 중에서 선임하여야 한다',
                 S_해교, '법률', '제47조', '선박안전관리사 자격을 가진 사람 중에서 선임하여야 한다'),
        ],
        'children': sm_leaves}

    # ── F. 해양조사기술자 ─────────────────────────────────────────
    surv_leaves = []
    for nid, label in [('surveyor_1', '특급 해양조사기술자'), ('surveyor_2', '고급 해양조사기술자'),
                       ('surveyor_3', '중급 해양조사기술자'), ('surveyor_4', '초급 해양조사기술자')]:
        surv_leaves.append(grade_leaf(
            nid, label, '해양조사와 해양정보 활용에 관한 법률 시행령 별표1의 해양조사기술자 등급',
            [prov(S_조사, '법률', '제25조', '해양조사기술자의 등급은 대통령령으로 정하는 바에 따라 나눌 수 있다', '제25조제3항')],
            [req_annex('%s의 등급별 자격기준' % label, '조사_등급기준', '전체', label.split()[0])],
            [],
            메모='등급별로 수행 업무를 따로 정한 조문은 raw에서 확인되지 않았다 — '
                 '해양조사와 항해용 간행물 제작은 해양조사기술자만 할 수 있다는 법 제25조제1항이 등급 구분 없이 적용된다.'))
    surveyor = {
        'id': 'ocean_surveyor', '라벨': '해양조사기술자',
        '정의': '해양조사 및 항해용 간행물의 제작을 할 수 있는 사람 — 대통령령으로 정하는 자격기준을 갖추어야 하고 등급을 나눌 수 있다',
        'provenance': [
            prov(S_조사, '법률', '제25조', '해양조사기술자가 아니면 할 수 없다', '제25조제1항'),
            prov(S_조사, '법률', '제25조', '해양조사기술자의 등급은 대통령령으로 정하는 바에 따라 나눌 수 있다', '제25조제3항'),
        ],
        '질문': '어느 등급의 해양조사기술자이신가요?',
        '선택지': [
            {'label': '특급·고급 해양조사기술자', 'hint': '기술사 취득 후 3년 이상(특급)·기술사 취득(고급) 등 (시행령 별표1)', 'next': 'surveyor_g12'},
            {'label': '중급 해양조사기술자', 'hint': '기사 취득 후 4년 이상 또는 산업기사 취득 후 7년 이상 해양조사업무 수행(같은 별표)', 'next': 'surveyor_3'},
            {'label': '초급 해양조사기술자', 'hint': '산업기사 이상 자격 취득 또는 관련 학과 학력·경력(같은 별표)', 'next': 'surveyor_4'},
        ],
        '자격요건': [
            req('국가기술자격·학력·경력 또는 국제수로기구 인정 국제자격을 가진 사람으로서 대통령령으로 정하는 자격기준을 갖춘 사람',
                S_조사, '법률', '제25조', '대통령령으로 정하는 자격기준을 갖춘 사람으로 한다'),
            req('등급별 자격기준은 시행령 별표1과 같다',
                S_조사, '시행령', '제11조', '해양조사기술자의 등급별 자격기준은 별표 1과 같다'),
        ],
        '승무기준': [
            duty('해양조사 및 항해용 간행물의 제작은 해양조사기술자가 아니면 할 수 없다',
                 S_조사, '법률', '제25조', '해양조사기술자가 아니면 할 수 없다'),
        ],
        'children': [{
            'id': 'surveyor_g12', '라벨': '특급·고급 해양조사기술자',
            '정의': '해양조사기술자 등급 중 특급 및 고급',
            '분류근거': BUNDLE_NOTE,
            'provenance': [prov(S_조사, '시행령', '제11조', '해양조사기술자의 등급별 자격기준은 별표 1과 같다', '제11조')],
            '질문': '특급인가요, 고급인가요?',
            '선택지': [
                {'label': '특급 해양조사기술자', 'hint': '시행령 별표1 제1호', 'next': 'surveyor_1'},
                {'label': '고급 해양조사기술자', 'hint': '시행령 별표1 제2호', 'next': 'surveyor_2'},
            ],
            'children': [surv_leaves[0], surv_leaves[1]]},
            surv_leaves[2], surv_leaves[3]]}

    # ── 루트 ──────────────────────────────────────────────────────
    other2 = {
        'id': 'other_quals2', '라벨': '선박안전관리사·해양조사기술자',
        '정의': '해사안전·해양조사 분야의 등급제 자격',
        '분류근거': BUNDLE_NOTE,
        'provenance': [prov(S_해교, '시행령', '제23조', '선박안전관리사의 등급은 1급, 2급 및 3급으로 구분한다', '제23조제1항')],
        '질문': '어느 자격인가요?',
        '선택지': [
            {'label': '선박안전관리사', 'hint': '선박·사업장 안전관리를 수행하는 1~3급 자격(해상교통안전법 제64조)', 'next': 'ship_safety_manager'},
            {'label': '해양조사기술자', 'hint': '해양조사·항해용 간행물 제작을 할 수 있는 특급~초급 자격(해양조사와 해양정보 활용에 관한 법률 제25조)', 'next': 'ocean_surveyor'},
        ],
        'children': [safety_mgr, surveyor]}
    other = {
        'id': 'other_quals', '라벨': '그 밖의 해양수산 자격·면허',
        '정의': '해기사·도선사 면허 외에 등급 체계가 있는 해양수산 분야 자격·면허',
        '분류근거': BUNDLE_NOTE,
        'provenance': [prov(S_레저, '법률', '제5조', '조종면허는 다음 각 호와 같이 구분한다', '제5조제2항')],
        '질문': '어느 자격·면허인가요?',
        '선택지': [
            {'label': '동력수상레저기구 조종면허', 'hint': '모터보트·요트 등을 조종하려는 사람의 면허(수상레저안전법 제5조)', 'next': 'boat_license'},
            {'label': '수상구조사', 'hint': '수상에서 인명을 구조하는 지도사·1급·2급 자격(수상에서의 수색·구조 등에 관한 법률 제30조의2)', 'next': 'rescuer'},
            {'label': '선박안전관리사·해양조사기술자', 'hint': '해사안전·해양조사 분야의 등급제 자격', 'next': 'other_quals2'},
        ],
        'children': [boat, rescue, other2]}

    root = {
        'id': 'qualification', '라벨': '해양수산 자격·면허',
        '정의': '해양수산 분야에서 법이 등급으로 나누어 부여하는 자격·면허',
        'provenance': [
            prov(S_선직, '법률', '제4조', '다음 각 호의 직종과 등급별로 면허를 한다', '제4조제2항'),
            prov(S_도선, '법률', '제4조', '다음 각 호의 등급으로 구분하여 제17조에 따른 도선구별로 한다', '제4조제2항'),
        ],
        '질문': '어떤 자격·면허에 관한 것인가요?',
        '선택지': [
            {'label': '해기사 면허', 'hint': '선박직원(항해사·기관사·통신사·운항사 등)이 되려는 사람이 받는 면허 (선박직원법 제4조)', 'next': 'haegi_license'},
            {'label': '도선사 면허', 'hint': '선박에 승선해 그 선박을 안전한 수로로 이끄는 도선사의 면허 (도선법 제4조)', 'next': 'pilot_license'},
            {'label': '그 밖의 해양수산 자격·면허', 'hint': '동력수상레저기구 조종면허·수상구조사·선박안전관리사·해양조사기술자', 'next': 'other_quals'},
        ],
        'children': [haegi, pilot, other]}
    return root


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def validate(root):
    """설계 §7의 검증 3·4번 — provenance 존재, 질문·선택지 무결성, next 참조 무결성."""
    ids = [n['id'] for n in walk(root)]
    if len(ids) != len(set(ids)):
        ERRORS.append('중복 id: %s' % [i for i in set(ids) if ids.count(i) > 1])
    for n in walk(root):
        if not n.get('provenance') or any(p is None for p in n['provenance']):
            ERRORS.append('provenance 없음/실패: %s' % n['id'])
        for k in ('자격요건', '승무기준'):
            if any(d is None for d in n.get(k, [])):
                ERRORS.append('%s 항목 빌드 실패 포함: %s' % (k, n['id']))
        kids = n.get('children', [])
        if kids:
            if not n.get('질문') or not n.get('선택지'):
                ERRORS.append('비-리프에 질문/선택지 없음: %s' % n['id'])
                continue
            if len(n['선택지']) != len(kids):
                ERRORS.append('선택지 수 ≠ 자식 수: %s' % n['id'])
            if len(n['선택지']) > 3:
                ERRORS.append('선택지 3개 초과(decideClarify CLARIFY_OPTION_MAX 위반): %s' % n['id'])
            kid_ids = {c['id'] for c in kids}
            for o in n['선택지']:
                if o.get('next') not in kid_ids:
                    ERRORS.append('선택지 next가 자식이 아님: %s → %s' % (n['id'], o.get('next')))
            if n.get('추가확인'):
                ERRORS.append('비-리프에 추가확인이 붙음: %s' % n['id'])
        else:
            if n.get('질문') or n.get('선택지'):
                ERRORS.append('리프에 질문/선택지가 붙음: %s' % n['id'])


# ── 독립 재대조(--verify) ──────────────────────────────────────────
def verify_file(path):
    """빌더의 조문분리·표 파싱 로직을 **재사용하지 않고**, 산출 JSON의 모든 인용문·별표 행을
    raw 파일 통짜 문자열과 직접 대조한다(설계 §7-6).
    @returns (검사건수, 실패목록)"""
    data = json.load(open(path, encoding='utf-8'))
    raw_cache = {}

    def text(rel_path):
        if rel_path not in raw_cache:
            p = os.path.join(LEGAL, rel_path)
            raw_cache[rel_path] = open(p, encoding='utf-8', errors='replace').read() \
                if os.path.exists(p) else None
        return raw_cache[rel_path]

    checked, fails = 0, []

    def flat(s):
        return re.sub(r'\s+', ' ', s)

    # 1) 별표 레지스트리: 모든 줄이 그 파일의 그 위치 줄과 정확히 일치해야 한다
    for key, a in data.get('별표', {}).items():
        t = text(a['파일'])
        checked += 1
        if t is None:
            fails.append('별표 파일 없음: %s (%s)' % (key, a['파일']))
            continue
        lines = t.split('\n')
        s, e = a['행범위']
        if e >= len(lines):
            fails.append('별표 행범위 초과: %s' % key)
            continue
        for k, ln in enumerate(a['표_원문']):
            checked += 1
            if lines[s + k].rstrip() != ln:
                fails.append('별표 줄 불일치: %s 줄%d' % (key, s + k))
                break
        if a['절'] != lines[s].strip():
            fails.append('별표 절 제목 불일치: %s' % key)

    # 2) 트리: 인용문·별표 행 원문
    def visit(n):
        nonlocal checked
        for p in n.get('provenance', []):
            checked += 1
            t = text(p['파일'])
            if t is None or flat(p['인용']) not in flat(t):
                fails.append('provenance 인용 없음: %s ← %s' % (n['id'], p['인용'][:40]))
        for k in ('자격요건', '승무기준'):
            for it in n.get(k, []):
                if it.get('출처유형') == '조문본문' or '인용' in it:
                    checked += 1
                    t = text(it['파일'])
                    if t is None or flat(it['인용']) not in flat(t):
                        fails.append('%s 인용 없음: %s ← %s' % (k, n['id'], it['인용'][:40]))
                if '별표' in it:
                    reg = data['별표'].get(it['별표'])
                    checked += 1
                    if not reg:
                        fails.append('%s 별표 참조 깨짐: %s → %s' % (k, n['id'], it['별표']))
                        continue
                    t = text(reg['파일'])
                    lines = t.split('\n') if t else []
                    for ln in it.get('행_원문', []):
                        checked += 1
                        if ln not in [x.rstrip() for x in lines]:
                            fails.append('%s 별표 행 원문 없음: %s ← %s' % (k, n['id'], ln[:40]))
                    for h in it.get('해당행', []):
                        checked += 1
                        if h['줄'] >= len(lines) or lines[h['줄']].rstrip() != h['원문']:
                            fails.append('%s 별표 해당행 불일치: %s 줄%s' % (k, n['id'], h['줄']))
                        ctx = h.get('앞선_구분행')
                        if ctx:
                            checked += 1
                            if ctx['줄'] >= len(lines) or lines[ctx['줄']].rstrip() != ctx['원문']:
                                fails.append('%s 별표 앞선_구분행 불일치: %s 줄%s' % (k, n['id'], ctx['줄']))
        for c in n.get('children', []):
            visit(c)
    visit(data['tree'])
    return checked, fails


def main():
    if '--verify' in sys.argv:
        checked, fails = verify_file(OUT)
        print('독립 재대조: %d건 검사, 실패 %d건' % (checked, len(fails)))
        for f in fails[:50]:
            print('  -', f)
        sys.exit(1 if fails else 0)

    root = build()
    validate(root)
    if ERRORS:
        print('빌드 실패 — raw 대조/무결성 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    scan = scan_corpus()
    nodes = list(walk(root))
    leaves = [n for n in nodes if not n.get('children')]
    reqs = [r for n in nodes for r in n.get('자격요건', [])]
    duties = [d for n in nodes for d in n.get('승무기준', [])]
    per_law = {}
    for it in reqs + duties:
        per_law[it['근거법령_slug']] = per_law.get(it['근거법령_slug'], 0) + 1
    for n in nodes:
        for p in n.get('provenance', []):
            per_law.setdefault(p['법령_slug'], 0)

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 — 74법 raw 전수 스캔으로 만든 "자격·면허 등급" 계층 트리(직종 × 등급, 별표 결합). '
                 '설계·방법론·연동설계는 _dashboard/H32_qualification_tree_design.md 참조.',
        'semantics': {
            '상속': '어떤 등급의 자격요건·승무기준 = 루트에서 그 리프까지 경로상 모든 노드의 `자격요건`/`승무기준` 합집합. '
                    '같은 조문을 리프마다 복제하지 않기 위한 규약이다.',
            '질문_선택지': '비-리프 노드의 `질문`/`선택지`는 decideClarify()가 즉석 생성하지 않고 그대로 꺼내 쓰라고 미리 박아둔 데이터다. '
                           '`선택지[].next`는 그 노드의 자식 id.',
            '추가확인': '리프의 잔여 축(한정면허·통신급·전문분야·도선구 등) — 트리 레벨로 쪼개지 않은 조건.',
            '별표': '최상위 `별표`는 별표 절 단위 레지스트리다. 리프의 `자격요건[].별표`·`승무기준[].별표`가 이 키를 참조한다. '
                    '표를 리프마다 복제하지 않기 위한 규약이며, 답변 시에는 반드시 `표_원문` 전체와 함께 제시해야 한다.',
            '해당행': '`승무기준[].해당행`은 그 절에서 등급 토큰이 나오는 줄의 원문이다. `앞선_구분행`은 표 안의 행일 때만 붙는 '
                      '위치 기반 참고값(바로 위에서 첫 칸이 비어 있지 않은 가장 가까운 행)이고, 비고처럼 표 밖에서 등급이 '
                      '언급된 줄은 `표밖: true`로 표시하며 `앞선_구분행`을 붙이지 않는다.',
            '행범위': '별표 행 블록형 항목의 `행범위`는 [시작줄, 끝줄] 구간의 **목록**이다 — 같은 등급이 여러 행으로 나뉜 표'
                      '(별표1의3의 전자기관사)가 있어 구간이 둘 이상일 수 있다. 줄 번호는 그 별표 파일의 0-기준 줄 번호다.',
            '분류근거': '이 필드가 붙은 노드는 UI 선택지 상한(3개) 때문에 만든 묶음 노드이지 법이 정한 분류가 아니다.',
        },
        'caveats': [
            '★별표3(선박직원의 최저승무기준) 등 표 형태 별표의 **병합셀을 구조화하지 않았다.** '
            '리프의 `승무기준[].해당행`은 그 등급이 등장하는 행의 원문일 뿐이고, 그 행의 왼쪽 조건(항행구역·총톤수·주기관 추진력)은 '
            '병합셀이라 행 자체에는 비어 있을 수 있다. `앞선_구분행`은 위치 기반 참고값이지 표 구조 해석이 아니다. '
            '정확한 적용은 `별표` 레지스트리의 `표_원문`(=별표 원문 표 전체)을 봐야 한다. 구조화를 세 가지 방법으로 시도했다가 '
            '원문 자체의 정렬 오차·부분 가로선 때문에 정확도를 보장할 수 없어 의도적으로 중단했다(설계 §5.4).',
            '이 트리는 "법·시행령·시행규칙·그 별표가 등급을 스스로 열거한 자격·면허"만 담는다. '
            '등급 구분이 없는 자격(항만운송사업법의 검수사·감정사·검량사 등)은 `unmapped`에 사유와 함께 기록했다.',
            '한정면허(상선/어선/특수선박/특정수역/모터보트·동력요트)·통신사의 전파통신급/전파전자급·운항사의 항해전문/기관전문·'
            '도선구는 등급과 직교하는 축이라 트리 레벨이 아니라 리프의 `추가확인`으로만 표현했다.',
            '선택지 3개 상한(decideClarify CLARIFY_OPTION_MAX) 때문에 만든 묶음 노드가 있다 — `분류근거` 필드가 붙은 노드가 그것이며 '
            '법이 정한 분류가 아니다. 묶는 순서는 법이 정한 상하 등급 순서를 그대로 따랐다.',
            '고시(행정규칙) 계열은 별표가 본문에 이어 붙는 형식이라(L-54) 이번 별표 결합에서 제외했다 — '
            '이 트리의 별표 근거는 전부 법률계열(`별표/<계층>_별표N.txt`)이다. 스캔 자체는 고시 파일도 포함해 돌렸다.',
            '자치법규(raw/_자치법규/)와 국제협약 텍스트는 스캔 대상이 아니다(74법 기준법 체계만).',
            '별표에서 등급 블록을 자르는 규칙(첫 칸 기준)과 승무기준 행을 고르는 규칙(등급 토큰 문자열 포함)은 '
            '기계적 규칙이라, 원문이 등급명을 줄바꿈으로 쪼개 적은 경우(예: 표 폭이 좁아 "6급 항\\n해사"로 끊긴 경우)에는 놓칠 수 있다. '
            '이번 대상 별표에서는 그런 사례가 확인되지 않았으나 원리적 한계로 남는다.',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned': scan['files'],
            'articles_scanned': scan['articles'],
            'scan_candidates': scan['candidates'],
            'laws_with_scan_candidates': len(scan['laws_with_candidates']),
            'laws_without_scan_candidates': len(LAWS) - len(scan['laws_with_candidates']),
            'laws_in_tree': len(per_law),
            'nodes': len(nodes),
            'leaves': len(leaves),
            'requirement_entries': len(reqs),
            'duty_entries': len(duties),
            'entries_by_tier': {
                t: sum(1 for it in reqs + duties if it['계층'] == t) for t in ('법률', '시행령', '시행규칙')
            },
            'entries_by_source': {
                '조문본문': sum(1 for it in reqs + duties if it.get('출처유형') == '조문본문'),
                '별표(행 블록)': sum(1 for it in reqs + duties if it.get('출처유형') == '별표(행 블록)'),
                '별표(행 매칭)': sum(1 for it in duties if '해당행' in it),
            },
            'annex_sections': len(ANNEX_REG),
            'annex_lines': sum(len(a['표_원문']) for a in ANNEX_REG.values()),
            'per_law': dict(sorted(per_law.items(), key=lambda kv: -kv[1])),
        },
        'scan': {
            '설명': '설계 §4의 2중 조건(등급 신호 × 자격 신호)으로 74법 raw 전수(법률계열 + 행정규칙 + 별표)를 훑은 결과. '
                    '후보 문장이 곧 등급 체계는 아니다 — 다른 법의 등급을 인용만 한 경우가 많아 사람이 추려 트리에 넣었다.',
            'laws_with_candidates': scan['laws_with_candidates'],
            'laws_without_candidates': sorted({l['slug'] for l in LAWS} - set(scan['laws_with_candidates'])),
        },
        'unmapped': {
            '설명': '스캔 후보에는 걸렸으나 "등급으로 나뉘는 자격·면허"가 아니어서 트리에 넣지 않은 것들. '
                    '무엇을 왜 뺐는지 남겨두어야 다음 사람이 같은 판단을 반복하지 않는다.',
            '스캔후보였으나_트리에_안_들어간_법': [
                {'법': '선원법', '사유': '해기사 면허 등급을 인용해 승무 자격·정원을 정할 뿐 자체 등급 체계가 없다(선박직원법 인용).'},
                {'법': '해양사고의 조사 및 심판에 관한 법률', '사유': '해기사·도선사 면허 등급을 징계 맥락에서 인용할 뿐 자체 등급 체계가 없다.'},
                {'법': '낚시 관리 및 육성법', '사유': '낚시어선 선장에게 "소형선박 조종사 면허 또는 그 상위등급"을 요구할 뿐(시행령 제16조) 자체 등급이 없다.'},
                {'법': '선박교통관제에 관한 법률', '사유': '관제사 자격을 "5급 항해사 이상의 면허"로 인용할 뿐(시행규칙 제4조) 자체 등급이 없다.'},
                {'법': '선박의 입항 및 출항 등에 관한 법률', '사유': '예선운영자 등의 자격을 "5급 항해사·5급 기관사 또는 4급 운항사 이상"으로 인용할 뿐(시행령) 자체 등급이 없다.'},
                {'법': '원양산업발전법', '사유': '옵서버 등의 자격 기준에서 "5급 항해사 또는 5급 기관사"를 인용할 뿐(시행령 별표2) 자체 등급이 없다.'},
            ],
            '넓은_탐색스캔에서만_확인된_법(최종 2중 조건 후보 아님)': [
                {'법': '항만운송사업법', '사유': '검수사·감정사·검량사는 자격시험 합격 후 등록하는 자격이지만(제7조) '
                                                '등급 구분이 없다 — 등급 축이 없으므로 이 트리(등급 계층)의 대상이 아니다.'},
                {'법': '해운법', '사유': '운항관리자 자격을 "3급 항해사·3급 기관사 또는 3급 운항사 이상"으로 인용할 뿐(시행규칙) 자체 등급이 없다.'},
                {'법': '어선법', '사유': '통신사 등급을 인용해 무선설비 기준을 정할 뿐 자체 등급 체계가 없다.'},
            ],
            '유형_단위': [
                {'유형': '다른 법의 등급을 인용만 하는 조문', '예': '"「선박직원법」 제4조제2항에 따른 2급 항해사 이상의 면허를 받은 후 …"'},
                {'유형': '등급이 아니라 자격의 종류', '예': '검수사/감정사/검량사 · 유선·도선 사업법의 선박운항자'},
                {'유형': '물 급수(給水) 등 동음이의', '예': '"급수설비"·"급수관" — 스캔 단계에서 제외'},
                {'유형': '과태료·처분 기준의 등급', '예': '위반횟수별 부과기준 — 자격의 등급이 아니다'},
                {'유형': '타 부처 자격의 인용', '예': '"1급 응급구조사"(응급의료법) — 해양수산 소관 자격이 아니라 요건으로 인용된 것'},
            ],
        },
        '별표': ANNEX_REG,
        'tree': root,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('OK → %s' % OUT)
    print('  노드 %d · 리프(등급) %d · 자격요건 %d · 승무기준 %d · 별표 절 %d(%d줄) · 기여법 %d'
          % (len(nodes), len(leaves), len(reqs), len(duties), len(ANNEX_REG),
             out['summary']['annex_lines'], len(per_law)))
    print('  스캔: %d법 · %d파일 · %d조문 · 후보문장 %d건 · 후보가 나온 법 %d개'
          % (len(LAWS), scan['files'], scan['articles'], scan['candidates'],
             len(scan['laws_with_candidates'])))


if __name__ == '__main__':
    main()
