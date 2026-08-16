#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
톤수·길이 기준값 사전(facet dictionary) 빌더 겸 검증기 (H-32 확장 · candidates E절).

역할(초보자용):
  74법 raw 원문을 훑어 "총톤수 20톤 미만", "길이 24미터 이상"처럼 **의무를 가르는
  숫자 기준값**을 전부 찾아, 그 기준값이 **어느 법 몇 조에서 무엇을 가르는지**와 함께
  "이 배는 어느 구간인가요?" 되묻기용 **질문 + 구간 선택지**로 만든다.
  트리(vessel_doc_tree.json 등)가 톤수 갈림길을 만나면 이 사전 항목을 가리켜 재사용한다.

  ★사람이 숫자를 타이핑하지 않는다 — 임계값·인용문은 전부 raw에서 직접 읽어 채우고,
  raw에서 다시 못 찾으면 그 자리에서 빌드를 실패시킨다(환각 0).

[연계]
  읽기: local_server/knowledge/legal/raw/**/{법률,시행령*,시행규칙*}.txt · 각 법 _meta.json(법령ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/tonnage_facet.json  (이 스크립트만 이 파일을 쓴다)
  설계: _dashboard/H32_tonnage_facet_design.md (스키마·추출규칙·검증기준·트리 연동 제안)
  자매: _dashboard/loop/build_vessel_doc_tree.py (선박종류 트리 — 헤더 규약·provenance 규약 동일)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_tonnage_facet.py
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
OUT = os.path.join(DASH, 'tonnage_facet.json')
KST = timezone(timedelta(hours=9))

ERRORS = []

# ── 74법 목록 ────────────────────────────────────────────────────
def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법(자연유산법).
    근거: _dashboard/H29_design.md §2 · build_vessel_doc_tree.py와 같은 소스를 쓴다(L-74)."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}

# ── 조문 분리 ────────────────────────────────────────────────────
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')      # 법률계열(L-54)
RE_ART_NB = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(')          # 고시계열(L-54, 커버리지 집계용)
RE_BUCHIK = re.compile(r'^부칙(\s|<|$)')


def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다.

    ★`부칙` 줄에서 자른다 — 부칙에는 1984년 승무기준표 같은 옛 경과조치가 그대로 붙어 있어,
    자르지 않으면 **마지막 조가 부칙 전체를 삼켜** 엉뚱한 조문의 기준값으로 둔갑한다
    (실측: 어선법 시행규칙 제77조는 "삭제"인데 부칙 표의 톤수 4종이 딸려 왔었다).
    241개 법률계열 파일 전수 확인 결과 첫 `부칙` 줄 뒤에 `[제N조]` 마커가 다시 나오는 파일은 0개라
    이 컷은 안전하다.

    @returns {'제10조': {'body': '조문 원문', 'title': '제목', 'marker': '[제10조] 제목 (시행 …)'}}
    [연계] scan_file()이 이 결과에서 임계값을 뽑는다. 독립 재대조 스크립트는 이 함수를 쓰지 않는다."""
    out, cur, buf, title, marker = {}, None, [], '', ''
    for line in text.split('\n'):
        s = line.strip()
        if RE_BUCHIK.match(s):
            break
        m = RE_ART.match(s)
        if m:
            if cur and cur not in out:
                out[cur] = {'body': '\n'.join(buf), 'title': title, 'marker': marker}
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            title = re.sub(r'\s*\(시행.*$', '', m.group(3)).strip()
            marker, buf = s, [s]
        elif cur is not None:
            buf.append(line)
    if cur and cur not in out:
        out[cur] = {'body': '\n'.join(buf), 'title': title, 'marker': marker}
    return out


# ── 임계값 정규식 ────────────────────────────────────────────────
# 축(어떤 수치인가) × 숫자 × 단위 × (괄호 삽입구) × 비교어. 비교어가 없으면 "가르는 기준"이
# 아니라 단순 서술(예: "총톤수는 9.77톤")일 수 있어 구간을 만들지 않고 `보류`에 남긴다.
AXIS_WORDS = ['국제총톤수', '총톤수', '재화중량톤수', '적재톤수', '선박길이', '선체의 길이', '길이']
AXIS_UNIT = {'국제총톤수': '톤', '총톤수': '톤', '재화중량톤수': '톤', '적재톤수': '톤',
             '선박길이': '미터', '선체의 길이': '미터', '길이': '미터'}
AXIS_CODE = {'국제총톤수': 'gt_intl', '총톤수': 'gt', '재화중량톤수': 'dwt', '적재톤수': 'load_t',
             '선박길이': 'ship_len', '선체의 길이': 'hull_len', '길이': 'len'}
# '넘는'→초과 · '넘지(아니하는)'→이하 · '이내'→이하 는 표현만 다른 같은 뜻이라 정규화한다.
# ('이내'는 법률계열 전수에서 "총톤수 3톤 이내" 1건뿐 — 수산업법 시행령 제37조.)
CMP_NORM = {'이상': '이상', '미만': '미만', '초과': '초과', '이하': '이하',
            '넘는': '초과', '넘지': '이하', '이내': '이하'}
RE_TH = re.compile(
    r'(' + '|'.join(AXIS_WORDS) + r')'          # 1 축
    r'\s*(?:가|이|는|은|을|를)?\s*'
    r'([0-9][0-9,]*(?:\.[0-9]+)?)'              # 2 숫자
    r'\s*(만|천)?\s*'                            # 3 만/천
    r'(톤|미터)'                                 # 4 단위
    r'(?:\s*\([^)]{0,120}\))?'                  # (괄호 삽입구 — "총톤수 100톤(군함…200톤) 미만")
    r'(?:\s*(?:을|를|이|가|인|의)?\s*(이상|미만|초과|이하|넘는|넘지|이내))?')   # 5 비교어


def parse_value(num, mult):
    """'20,000'+None → 20000.0 · '5'+'천' → 5000.0. 자릿수 구분이 깨진 표기는 None(해석보류).

    예: 선박직원법 시행령 raw에 실재하는 '총톤수 2,00톤 이상'은 원문 표기 자체가 불완전해
    200인지 2,000인지 정할 수 없다 → 지어내지 않고 None을 돌려 구간 계산에서 제외한다."""
    if ',' in num:
        head, *rest = num.split(',')
        if not head or len(head) > 3 or any(len(r) != 3 for r in rest):
            return None
    v = float(num.replace(',', ''))
    if mult == '만':
        v *= 10000
    elif mult == '천':
        v *= 1000
    return v


def notation(num, mult, unit):
    """라벨용 표기 — 원문 숫자 표기를 그대로 살린다('1천톤', '20,000톤')."""
    return '%s%s%s' % (num, mult or '', unit)


RE_HO = re.compile(r'(?:^|\s)(?:\d+\.\s|\d+\)\s|[가-하]\.\s|[①-⑳])')


def quote_of(flat, at, span=220):
    """임계값이 들어 있는 문장을 원문에서 그대로 뽑는다(사람이 타이핑하지 않는다).

    시작점은 **임계값 바로 앞의 경계**(항 기호 ①… · 호 번호 '1.' · 문장 끝 '. ')로 잡는다.
    다만 그 경계가 **괄호 안**이면(예: "…라 한다. 이하 같다)") 문장이 중간부터 잘리므로
    괄호 균형을 확인해 더 앞의 경계로 물러난다 — build_vessel_doc_tree.py가 초안에서
    실제로 5건의 잘린 인용을 만들었던 바로 그 함정이다(설계 §6 "정직 기록").

    @param flat 공백 정규화된 조문 원문 · at 임계값 매치 시작 위치
    @returns 원문의 부분문자열(최대 400자). 반환값은 빌드 검증에서 다시 원문 대조된다."""
    cands = [0]
    for m in RE_HO.finditer(flat[:at]):
        cands.append(m.start() if m.group(0)[0] not in ' \t' else m.start() + 1)
    for m in re.finditer(r'\.\s', flat[:at]):
        cands.append(m.end())
    start = 0
    for c in sorted(set(cands), reverse=True):
        seg = flat[c:at]
        if seg.count(')') <= seg.count('('):      # 괄호 안에서 시작하지 않았는가
            start = c
            break
    end = flat.find('다. ', at)
    end = (end + 2) if end > 0 else min(len(flat), at + span)
    if at - start > 360:
        # 경계가 너무 멀면 400자 컷에 임계값 자체가 잘려 나간다 — 매치 가까이로 당긴다.
        start = max(0, at - 120)
        sp = flat.find(' ', start)
        if 0 <= sp < at:
            start = sp + 1
    tight = flat[start:end].strip()[:400]

    # ★상위 인용 — 호(1.·가.) 단위로 잘리면 "이 숫자가 무엇을 정의하는지"가 사라진다.
    #   예: 선박법 제1조의2제2항은 항 문장에 "소형선박"이 있고 호에 숫자만 있어,
    #   호만 인용하면 20톤이 소형선박 기준이라는 사실이 통째로 빠진다.
    #   ※400자를 넘으면 잘라 담지 않고 아예 비운다 — 앞부분만 남기면 정작 임계값이 빠진
    #     '맥락 없는 맥락'이 되어 오히려 오해를 부른다.
    up = 0
    for m in re.finditer(r'[①-⑳]', flat[:at]):
        up = m.start()
    upper = flat[up:end].strip()
    if len(upper) > 400 or upper == tight or len(upper) <= len(tight):
        upper = None
    return tight, upper


# ── raw 스캔 ─────────────────────────────────────────────────────
def tier_of(fname):
    """파일명 → 계층. 채택 대상이 아니면 None.

    · 부칙 파일(부칙.txt·부칙_시행령.txt 등)은 제외 — 조문 본문의 부칙 컷과 같은 이유(경과조치).
    · '_발췌' 파일은 **다른 법의 조문**을 이 법 폴더에 발췌해 둔 것이라 제외한다
      (그대로 쓰면 provenance가 엉뚱한 법으로 붙는다).
    · '시행령_○○규정.txt'처럼 단일 통합 시행령이 없이 개별 명칭 대통령령으로 흩어진 법도
      시행령 계열로 받는다(L-64에서 확인된 형태)."""
    if '부칙' in fname or '발췌' in fname:
        return None
    if fname == '법률.txt':
        return '법률'
    if fname == '시행령.txt' or fname.startswith('시행령_'):
        return '시행령'
    if fname == '시행규칙.txt' or fname.startswith('시행규칙_'):
        return '시행규칙'
    return None


def law_id(slug, tier):
    """_meta.json의 families.<계층>.법령ID — 법령명이 바뀌어도 추적이 끊기지 않게(H-29 11항·L-74)."""
    p = os.path.join(BY_SLUG[slug]['raw'], '_meta.json')
    if not os.path.exists(p):
        return None
    fam = json.load(open(p, encoding='utf-8')).get('families', {})
    return (fam.get(tier) or {}).get('법령ID')


def scan_all():
    """74법 raw 전수 스캔. 법률계열은 사전 재료로 쓰고, 고시계열은 커버리지 수치만 센다.

    @returns (occs, cov) — occs: 채택 계열의 임계값 등장 목록, cov: 커버리지 집계
    [연계] build()가 occs로 facet을 만들고, main()이 cov를 summary/scan에 싣는다."""
    occs = []
    cov = {'files_statute': 0, 'files_admrul': 0, 'articles_statute': 0, 'articles_admrul': 0,
           'hits_statute': 0, 'hits_admrul': 0, 'laws_statute': set(), 'laws_admrul': set(),
           'skipped_files': [], 'admrul_by_notice': {}}
    for law in LAWS:
        slug = law['slug']
        for fname in sorted(os.listdir(law['raw'])):
            if not fname.endswith('.txt'):
                continue
            tier = tier_of(fname)
            path = os.path.join(law['raw'], fname)
            text = open(path, encoding='utf-8', errors='replace').read()
            if tier is None:
                n = len(RE_TH.findall(re.sub(r'\s+', ' ', text)))
                if n:
                    cov['skipped_files'].append({'법': slug, '파일': fname, '등장': n,
                                                 '사유': '부칙(경과조치) 또는 타법 발췌 파일'})
                continue
            cov['files_statute'] += 1
            arts = split_articles(text)
            cov['articles_statute'] += len(arts)
            for art, meta in arts.items():
                flat = re.sub(r'\s+', ' ', meta['body'])
                for m in RE_TH.finditer(flat):
                    cov['hits_statute'] += 1
                    cov['laws_statute'].add(slug)
                    axis = m.group(1)
                    tight, upper = quote_of(flat, m.start())
                    occs.append({
                        'slug': slug, 'tier': tier, 'file': fname, 'path': path,
                        'article': art, 'title': meta['title'], 'axis': axis,
                        '문구': m.group(0), '값': parse_value(m.group(2), m.group(3)),
                        '표기': notation(m.group(2), m.group(3), m.group(4)),
                        '단위': m.group(4), '비교': CMP_NORM.get(m.group(5)) if m.group(5) else None,
                        '인용': tight, '상위인용': upper,
                    })
        ad = os.path.join(law['raw'], '행정규칙')
        if os.path.isdir(ad):
            for fname in sorted(os.listdir(ad)):
                if not fname.endswith('.txt'):
                    continue
                cov['files_admrul'] += 1
                text = open(os.path.join(ad, fname), encoding='utf-8', errors='replace').read()
                cov['articles_admrul'] += sum(1 for l in text.split('\n') if RE_ART_NB.match(l.strip()))
                n = len(RE_TH.findall(re.sub(r'\s+', ' ', text)))
                if n:
                    cov['hits_admrul'] += n
                    cov['laws_admrul'].add(slug)
                    key = fname[:-4]
                    cov['admrul_by_notice'][key] = cov['admrul_by_notice'].get(key, 0) + n
    return occs, cov


# ── 구간(band) 계산 ──────────────────────────────────────────────
def cut_points(occ_list):
    """임계값들 → 구간 경계. 경계마다 '그 값 자체가 어느 구간에 속하는지'까지 정한다.

    이상/미만은 경계값이 **위 구간**에 속하고(20톤 이상 ↔ 20톤 미만),
    초과/이하는 경계값이 **아래 구간**에 속한다(1천톤 초과 ↔ 1천톤 이하).
    한 경계에 두 방식이 섞이면(예: 수산업법 시행령 제37조의 "3톤 미만"과 "3톤 이내(=이하)")
    경계값을 어느 쪽에 붙여도 그 구간 안에서 조건의 참·거짓이 갈려버린다
    → **그 값만 따로 떼어 '정확히 N톤' 구간**으로 만든다(귀속='단독').
    ※ 이 처리는 독립 재대조 스크립트가 표본 스윕으로 잡아낸 실제 결함을 고친 것이다.

    @returns [{'값':20.0, '표기':'20톤', '귀속':'위'|'아래'|'단독'}, …] 오름차순
    """
    by_val = {}
    for o in occ_list:
        if o['값'] is None or not o['비교']:
            continue
        d = by_val.setdefault(o['값'], {'표기': {}, 'styles': set()})
        d['표기'][o['표기']] = d['표기'].get(o['표기'], 0) + 1
        d['styles'].add('위' if o['비교'] in ('이상', '미만') else '아래')
    cuts = []
    for v in sorted(by_val):
        d = by_val[v]
        best = sorted(d['표기'].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        cuts.append({'값': v, '표기': re.sub(r'\s+', '', best),
                     '귀속': '단독' if len(d['styles']) > 1 else list(d['styles'])[0]})
    return cuts


def satisfies(occ, lo, hi, lo_closed, hi_closed):
    """구간 [lo,hi]가 통째로 이 임계값 조건을 만족하는가(구간 안에서 참/거짓이 갈리지 않는다).

    구간 경계는 모든 임계값 지점에서 잘려 있으므로, 구간 내부의 대표점 하나로 판정하면 된다.
    @param lo,hi 구간 하한/상한(None=무한) · lo_closed,hi_closed 경계 포함 여부
    @returns bool"""
    v = occ['값']
    if v is None or not occ['비교']:
        return False
    if lo is not None and hi is not None and lo == hi:
        x = lo
    elif lo is None:
        x = (hi - 1) if hi is not None else 0.0
    elif hi is None:
        x = lo if lo_closed else lo + 1
    else:
        x = lo if lo_closed else (hi if hi_closed else (lo + hi) / 2.0)
    c = occ['비교']
    return {'이상': x >= v, '미만': x < v, '초과': x > v, '이하': x <= v}[c]


def bands_of(cuts, occ_list, axis, unit):
    """경계값 배열 → 선택지(구간) 배열. 라벨은 원문 표기를 그대로 쓴다.

    경계를 하나씩 지나며 구간을 닫고 여는 방식이라, 귀속이 '위'/'아래'/'단독' 어느 쪽이든
    **빈틈도 겹침도 생기지 않는다**(빌더 validate와 독립 재대조가 둘 다 이걸 검사한다).
    @returns [{label, 이상, 초과, 미만, 이하, 단위, 결과[], hint}] — 되묻기가 그대로 쓰는 선택지"""
    segs = []            # (lo, lo_closed, lo_cut, hi, hi_closed, hi_cut)
    cur = [None, True, None]
    for c in cuts:
        if c['귀속'] == '위':
            segs.append(tuple(cur) + (c['값'], False, c))
            cur = [c['값'], True, c]
        elif c['귀속'] == '아래':
            segs.append(tuple(cur) + (c['값'], True, c))
            cur = [c['값'], False, c]
        else:                                   # 단독 — 경계값만 따로 한 구간
            segs.append(tuple(cur) + (c['값'], False, c))
            segs.append((c['값'], True, c, c['값'], True, c))
            cur = [c['값'], False, c]
    segs.append(tuple(cur) + (None, True, None))

    out = []
    for lo, lo_c, lo_cut, hi, hi_c, hi_cut in segs:
        if lo is not None and hi is not None and lo == hi:
            label = '%s 정확히 %s' % (axis, lo_cut['표기'])
        elif lo is None:
            label = '%s %s %s' % (axis, hi_cut['표기'], '이하' if hi_c else '미만')
        elif hi is None:
            label = '%s %s %s' % (axis, lo_cut['표기'], '이상' if lo_c else '초과')
        else:
            label = '%s %s %s %s %s' % (axis, lo_cut['표기'], '이상' if lo_c else '초과',
                                        hi_cut['표기'], '이하' if hi_c else '미만')
        hits = [i for i, o in enumerate(occ_list) if satisfies(o, lo, hi, lo_c, hi_c)]
        res = [{'문구': occ_list[i]['문구'], '인용': occ_list[i]['인용'], '임계값': i} for i in hits]
        hint = ('이 구간에는 이 조문의 %s 조건이 적용되지 않는다(원문에 해당 조건 없음).' % axis
                if not res else
                '원문 조건: ' + ' / '.join(r['문구'] for r in res))
        out.append({
            'label': label,
            '이상': lo if lo_c else None, '초과': None if lo_c else lo,
            '미만': None if hi_c else hi, '이하': hi if hi_c else None,
            '단위': unit, '결과': res, 'hint': hint,
        })
    return out


# ── facet 조립 ───────────────────────────────────────────────────
def build(occs):
    """등장 목록 → facet(법·조문·축 단위 기준값 항목) 배열 + 보류 목록.

    ★facet 키를 (법, 계층, 조문, 축)으로 잡는 이유: 같은 '20톤'이라도 선박법의 20톤(소형선박
    정의)과 해양환경관리법의 20톤(오염물질 수거 대상)은 **가르는 대상이 다르다**. 하나의
    통합 구간표로 합치면 그 차이가 사라진다(candidates.md C절이 경고한 것과 같은 함정)."""
    groups = {}
    holds = []
    for o in occs:
        key = (o['slug'], o['tier'], o['file'], o['article'], o['axis'])
        groups.setdefault(key, []).append(o)

    facets = []
    for (slug, tier, fname, art, axis), lst in sorted(groups.items()):
        usable = [o for o in lst if o['값'] is not None and o['비교']]
        for o in lst:
            if o in usable:
                continue
            holds.append({
                '법령': BY_SLUG[slug]['name'], '근거법령_slug': slug, '계층': tier,
                '근거조문': art, '축': axis, '문구': o['문구'], '인용': o['인용'],
                '상위인용': o['상위인용'],
                '사유': ('숫자 표기의 자릿수 구분이 불완전해 값을 확정할 수 없음(원문 그대로 기록)'
                         if o['값'] is None else
                         '이상·미만·초과·이하 같은 비교어가 없어 "가르는 기준"이 아님(단순 서술)'),
            })
        if not usable:
            continue
        cuts = cut_points(usable)
        unit = AXIS_UNIT[axis]
        name = BY_SLUG[slug]['name']
        ctx = lst[0]['title']
        q = '이 선박의 %s는 어느 구간에 속하나요? (「%s」 %s%s 기준)' % (
            axis, name, art, ' 「%s」' % ctx if ctx else '')
        f = {
            'id': '%s__%s__%s__%s' % (AXIS_CODE[axis], slug, tier, art),
            '축': axis, '단위': unit,
            '맥락': ctx or '(조문 제목 없음)',
            '근거법령': name, '근거법령_slug': slug, '계층': tier, '근거조문': art,
            '법령ID': law_id(slug, tier),
            '파일': os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], fname), LEGAL),
            '질문': q,
            '선택지': bands_of(cuts, usable, axis, unit),
            '임계값': [{'문구': o['문구'], '값': o['값'], '표기': o['표기'], '단위': o['단위'],
                        '비교': o['비교'], '인용': o['인용'], '상위인용': o['상위인용']}
                       for o in usable],
            '경계': [{'값': c['값'], '표기': c['표기'], '경계값_귀속': c['귀속']} for c in cuts],
        }
        notes = []
        if any(c['귀속'] == '단독' for c in cuts):
            notes.append('같은 경계값에 이상/미만 방식과 초과/이하 방식이 함께 쓰여, 그 값 자체는 '
                         '"정확히 N" 구간으로 따로 뒀다.')
        if len(f['선택지']) >= 5:
            notes.append('선택지가 %d개다 — 되묻기 UI에 그대로 쓰기엔 많아 사람 확인이 필요하다.'
                         % len(f['선택지']))
        if notes:
            f['주의'] = ' '.join(notes)
        facets.append(f)
    return facets, holds


def value_index(facets):
    """단위별 임계값 오름차순 색인 — "5톤은 어떤 법들이 쓰나"를 한눈에 보게 한다.
    ※ 값이 같다고 뜻이 같은 것은 아니다(각 항목의 맥락을 함께 싣는 이유)."""
    idx = {}
    for f in facets:
        for c in f['경계']:
            d = idx.setdefault(f['단위'], {}).setdefault(c['값'], {'표기': c['표기'], '항목': []})
            d['항목'].append({'facet': f['id'], '법령': f['근거법령'], '조문': f['근거조문'],
                              '맥락': f['맥락'], '축': f['축']})
    return {u: [{'값': v, '표기': d['표기'], '쓰는_항목_수': len(d['항목']), '항목': d['항목']}
                for v, d in sorted(vals.items())] for u, vals in sorted(idx.items())}


RE_TERM = re.compile(r'"([^"]{2,30})"\s*(?:이?란|이?라 함은|이?라 한다|이?라고|을 말한다|를 말한다)')
# "대통령령으로 정하는 소형선박" 처럼 위임 문구가 앞에 붙은 형태는 그 접두어를 떼어 같은 용어로 본다.
RE_DELEG_PREFIX = re.compile(r'^(?:대통령령|해양수산부령|총리령|행정안전부령|부령)으로 정하는\s*')
TERM_STOP = {'선박', '어선', '기구', '시설', '사업', '수역'}


def term_conflicts(facets):
    """같은 법률 용어를 법마다 **다른 숫자**로 정의하는 사례를 원문에서 뽑는다.

    사용자가 강조한 지점("어떤 법은 소형선박을 20톤 미만으로, 다른 법은 5톤 미만으로 본다")을
    억지 판단 없이 드러내기 위한 기계적 탐지 — facet 인용문에서 큰따옴표로 묶인 정의 용어를
    찾아, 같은 용어가 서로 다른 법에서 다른 경계값으로 쓰이면 함께 묶는다.
    (판단이 아니라 원문 대조다 — 무엇이 맞는지는 말하지 않고 "다르다"만 보여준다.)"""
    by_term = {}
    for f in facets:
        terms = set()
        for t in f['임계값']:
            for raw in RE_TERM.findall((t.get('상위인용') or '') + ' ' + t['인용']):
                term = RE_DELEG_PREFIX.sub('', raw).strip()
                if len(term) >= 3 and term not in TERM_STOP:
                    terms.add(term)
        for term in terms:
            by_term.setdefault(term, []).append(f)
    out = []
    for term, fs in sorted(by_term.items()):
        laws = {f['근거법령_slug'] for f in fs}
        cuts = {tuple(c['값'] for c in f['경계']) for f in fs}
        if len(laws) >= 2 and len(cuts) >= 2:
            out.append({
                '용어': term,
                '설명': '같은 용어가 나오는 항목들인데 경계값이 다르다 — 하나로 합치면 안 된다. '
                        '★자동 탐지 결과다: "소형선박"처럼 정말 법마다 다르게 정의한 경우도 있고, '
                        '용어는 같지만 그 숫자가 그 용어를 정의하는 것은 아닌 경우도 섞인다. '
                        '판단하지 말고 각 항목의 `인용`·`상위인용`을 직접 볼 것.',
                '항목': sorted([{'facet': f['id'], '법령': f['근거법령'], '계층': f['계층'],
                                 '조문': f['근거조문'], '맥락': f['맥락'],
                                 '경계': [c['표기'] for c in f['경계']]} for f in fs],
                               key=lambda x: (x['법령'], x['조문'])),
            })
    return out


# ── 검증 (실패하면 JSON을 만들지 않는다) ─────────────────────────
def validate(facets):
    """§검증 — raw 재대조 + 구간 무결성. 하나라도 어긋나면 빌드 실패.

    ①`문구`·`인용`이 그 조문 원문(공백 정규화)에 **부분문자열로 실재**하는가
      — 캐시가 아니라 파일을 다시 열어 다시 쪼개 확인한다.
    ②조문 마커 줄이 파일에 실재하는가
    ③구간이 (-∞,∞)를 빈틈·겹침 없이 덮는가 · 선택지 수 = 경계 수 + 1
    ④선택지의 `결과`가 satisfies() 재계산과 일치하는가(라벨과 내용이 어긋나지 않게)
    ⑤id 중복 없음"""
    seen = set()
    for f in facets:
        if f['id'] in seen:
            ERRORS.append('id 중복: %s' % f['id'])
        seen.add(f['id'])
        path = os.path.join(LEGAL, f['파일'])
        if not os.path.exists(path):
            ERRORS.append('파일 없음: %s' % f['파일'])
            continue
        arts = split_articles(open(path, encoding='utf-8', errors='replace').read())
        meta = arts.get(f['근거조문'])
        if meta is None:
            ERRORS.append('조문 없음: %s %s' % (f['파일'], f['근거조문']))
            continue
        flat = re.sub(r'\s+', ' ', meta['body'])
        if meta['marker'] not in meta['body']:
            ERRORS.append('조문 마커 불일치: %s %s' % (f['파일'], f['근거조문']))
        for t in f['임계값']:
            if t['문구'] not in flat:
                ERRORS.append('원문에 문구 없음: %s %s ← "%s"' % (f['파일'], f['근거조문'], t['문구']))
            for key in ('인용', '상위인용'):
                if t.get(key) and re.sub(r'\s+', ' ', t[key]) not in flat:
                    ERRORS.append('원문에 %s 없음: %s %s ← "%s"'
                                  % (key, f['파일'], f['근거조문'], t[key][:40]))
            if t['문구'] not in t['인용']:
                ERRORS.append('인용에 임계값 문구가 빠짐: %s %s ← "%s"'
                              % (f['파일'], f['근거조문'], t['문구']))
        # 구간 무결성
        expect = len(f['경계']) + 1 + sum(1 for c in f['경계'] if c['경계값_귀속'] == '단독')
        if len(f['선택지']) != expect:
            ERRORS.append('선택지 수 불일치(기대 %d, 실제 %d): %s' % (expect, len(f['선택지']), f['id']))
        prev_hi, prev_hi_closed = None, None
        for i, b in enumerate(f['선택지']):
            lo = b['이상'] if b['이상'] is not None else b['초과']
            hi = b['미만'] if b['미만'] is not None else b['이하']
            if i == 0:
                if lo is not None:
                    ERRORS.append('첫 구간에 하한이 있음: %s' % f['id'])
            else:
                if lo != prev_hi:
                    ERRORS.append('구간이 이어지지 않음: %s (%s ≠ %s)' % (f['id'], lo, prev_hi))
                if (b['이상'] is not None) == prev_hi_closed:
                    ERRORS.append('경계값이 두 구간에 겹치거나 어디에도 없음: %s @%s' % (f['id'], lo))
            if i == len(f['선택지']) - 1 and hi is not None:
                ERRORS.append('마지막 구간에 상한이 있음: %s' % f['id'])
            prev_hi, prev_hi_closed = hi, (b['이하'] is not None)
            # ④ 결과 재계산
            recomputed = [j for j, t in enumerate(f['임계값'])
                          if satisfies({'값': t['값'], '비교': t['비교']},
                                       lo, hi, b['이상'] is not None, b['이하'] is not None)]
            if recomputed != [r['임계값'] for r in b['결과']]:
                ERRORS.append('구간-조건 매핑 불일치: %s @%s' % (f['id'], b['label']))
        if not f['임계값'] or not f['선택지']:
            ERRORS.append('빈 항목: %s' % f['id'])


def main():
    occs, cov = scan_all()
    facets, holds = build(occs)
    validate(facets)
    if ERRORS:
        print('빌드 실패 — raw 대조/무결성 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    by_axis = {}
    for f in facets:
        by_axis[f['축']] = by_axis.get(f['축'], 0) + 1
    by_law = {}
    for f in facets:
        by_law[f['근거법령_slug']] = by_law.get(f['근거법령_slug'], 0) + 1
    top_notice = sorted(cov['admrul_by_notice'].items(), key=lambda kv: -kv[1])[:15]

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 — 74법 raw 전수 스캔으로 만든 "톤수·길이 기준값 사전(facet dictionary)". '
                 '단독 트리가 아니라 다른 계층 트리(선박종류·해역 등)가 톤수 갈림길에서 참조하는 공통 자산이다. '
                 '설계·추출규칙·연동 제안은 _dashboard/H32_tonnage_facet_design.md 참조.',
        'semantics': {
            '항목_단위': 'facet 1건 = (법령 · 계층 · 조문 · 축) 하나. 같은 숫자라도 법·조문이 다르면 '
                         '가르는 대상이 다르므로 별도 항목이다 — 통합 구간표로 합치지 않는다.',
            '질문_선택지': '`질문`+`선택지`는 되묻기가 그대로 꺼내 쓰라고 미리 박아둔 데이터다. '
                           '숫자 입력을 받지 않고 **구간을 눌러 고르게** 한다(사용자가 정확한 톤수를 몰라도 고를 수 있다).',
            '선택지_경계': '`이상`/`초과`는 하한, `미만`/`이하`는 상한. null인 쪽은 무한(제한 없음)이다. '
                           '이상·미만 쌍에서는 경계값이 위 구간에, 초과·이하 쌍에서는 아래 구간에 속한다. '
                           '한 경계에 두 방식이 섞이면 그 값만 떼어 "정확히 N톤" 단일점 구간을 만든다'
                           '(이상=이하인 구간이 그것이다).',
            '결과': '그 구간에서 실제로 적용되는 **원문 조건과 원문 문장**이다. 우리가 요약·해석한 값이 아니다.',
            '임계값': '그 조문에서 뽑은 기준값 목록. `문구`·`인용`은 raw 원문의 부분문자열이며 빌드 시 재대조된다.',
        },
        'caveats': [
            '이 사전은 "무엇을 하라"를 말하지 않는다 — **어느 구간인지만** 가른다. 구간에 따른 의무는 '
            '각 조문(인용)과 다른 트리가 정한다. 단독으로 답변 근거로 쓰면 안 된다.',
            '★한 조문 안에 **대상이 서로 다른 조건**이 섞여 있을 수 있다. 예: 선박법 제1조의2제2항은 '
            '"총톤수 20톤 미만인 기선 및 범선"과 "총톤수 100톤 미만인 부선"을 함께 정하는데, 구간 계산은 '
            '숫자만 보므로 20톤 미만 구간의 `결과`에 부선 조건도 함께 뜬다. 숫자 구간만으로 답을 확정하지 말고 '
            '반드시 `인용`의 대상(기선·범선·부선·동력어선 등)을 함께 봐야 한다.',
            "'이내'는 '이하'로, '넘는'은 '초과'로 정규화했다(표현만 다른 같은 뜻). 법률계열 전수에서 "
            "'이내'는 수산업법 시행령 제37조 '총톤수 3톤 이내' 1건뿐이다.",
            '항목 단위가 (법·조문·축)이라 같은 법 안에서도 조문마다 항목이 따로 있다. 이는 중복이 아니라 '
            '조문마다 가르는 대상이 다르기 때문이다(예: 선박법 제1조의2 소형선박 정의 vs 제26조 적용제외).',
            '행정규칙(고시) 계열은 커버리지 집계만 하고 사전에는 담지 않았다 — 등장의 대부분이 '
            '「선박설비기준」·「어선설비기준」류의 **설비 규격표**이고(선박종류 트리의 `장비` 축 소관), '
            '표·OCR 전사본이 섞여 있어 값의 신뢰 수준이 계열마다 다르다. 수치는 `scan.행정규칙`에 그대로 공개한다.',
            '부칙(경과조치)과 타법 발췌 파일은 제외했다 — 부칙에는 1984년 승무기준표 같은 옛 수치가 남아 있어 '
            '현행 기준으로 오인될 수 있다. 제외한 파일과 그 등장 수는 `scan.제외파일`에 남겼다.',
            '별표·별지 서식은 이번 스캔 대상이 아니다(법률계열 별표는 별도 파일로 수집돼 있다). '
            '승무기준표처럼 **별표에만 있는 톤수 구간**은 이 사전에 없다.',
            '`맥락`은 조문 제목을 그대로 옮긴 것이다 — 그 조문이 "무엇을 가르는지"를 한 문장으로 요약한 값이 아니다. '
            '정확한 의미는 항상 `인용`(원문)을 봐야 한다.',
            '선택지가 5개 이상인 항목(그 항목의 `주의` 참조)은 되묻기 UI에 그대로 쓰기엔 많다 — '
            '사람이 보고 묶을지 결정해야 한다(억지로 3개로 줄이지 않았다).',
            '"길이"·"선박길이"·"국제총톤수" 등 서로 다른 법률 용어는 합치지 않았다. 법마다 측정 방법·정의 조문이 '
            '다르기 때문이다(예: 선박안전법 제2조의 "선박길이" 정의).',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned_statute': cov['files_statute'],
            'files_scanned_admrul': cov['files_admrul'],
            'articles_scanned_statute': cov['articles_statute'],
            'articles_scanned_admrul': cov['articles_admrul'],
            'threshold_hits_statute': cov['hits_statute'],
            'threshold_hits_admrul': cov['hits_admrul'],
            'laws_with_threshold_statute': len(cov['laws_statute']),
            'laws_with_threshold_admrul': len(cov['laws_admrul']),
            'facets': len(facets),
            'facets_by_axis': dict(sorted(by_axis.items(), key=lambda kv: -kv[1])),
            'facets_by_law': dict(sorted(by_law.items(), key=lambda kv: (-kv[1], kv[0]))),
            'laws_contributing_facets': len(by_law),
            'threshold_entries': sum(len(f['임계값']) for f in facets),
            'band_options': sum(len(f['선택지']) for f in facets),
            'held_occurrences': len(holds),
            'term_conflicts': None,   # 아래에서 채운다
        },
        'scan': {
            '설명': '축(총톤수·길이 등) × 숫자 × 단위 × 비교어(이상/미만/초과/이하) 정규식으로 74법 raw 전수를 훑은 결과. '
                    '비교어가 없는 등장은 "가르는 기준"이 아니라고 보고 `보류`에 남겼다.',
            'laws_with_threshold_statute': sorted(cov['laws_statute']),
            'laws_without_threshold_statute': sorted({l['slug'] for l in LAWS} - cov['laws_statute']),
            '행정규칙': {
                '설명': '이번 사전에는 담지 않았다(caveats 3번). 다음 라운드가 이어받을 수 있게 수치만 남긴다.',
                '등장': cov['hits_admrul'], '법_수': len(cov['laws_admrul']),
                '상위_고시': [{'고시': k, '등장': v} for k, v in top_notice],
            },
            '제외파일': cov['skipped_files'],
        },
        '임계값_색인': None,      # 아래에서 채운다
        '용어_충돌': None,        # 아래에서 채운다
        'facets': facets,
        '보류': {
            '설명': '스캔에 걸렸으나 구간을 만들지 않은 등장 — 비교어가 없거나 원문 표기가 불완전한 경우. '
                    '지어내지 않고 그대로 남긴다.',
            '항목': holds,
        },
    }
    out['임계값_색인'] = value_index(facets)
    out['용어_충돌'] = term_conflicts(facets)
    out['summary']['term_conflicts'] = len(out['용어_충돌'])

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('OK → %s' % OUT)
    print('  facet %d개 · 기준값 %d건 · 구간선택지 %d개 · 기여법 %d · 보류 %d건 · 용어충돌 %d건'
          % (len(facets), out['summary']['threshold_entries'], out['summary']['band_options'],
             len(by_law), len(holds), len(out['용어_충돌'])))
    print('  스캔: %d법 · 법률계열 %d파일/%d조문(등장 %d) · 고시계열 %d파일/%d조문(등장 %d, 미채택)'
          % (len(LAWS), cov['files_statute'], cov['articles_statute'], cov['hits_statute'],
             cov['files_admrul'], cov['articles_admrul'], cov['hits_admrul']))


if __name__ == '__main__':
    main()
