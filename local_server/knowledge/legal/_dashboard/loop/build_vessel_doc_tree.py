#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
선박종류 × 비치서류 계층 트리 빌더 겸 검증기 (H-32 확장 파일럿).

역할(초보자용):
  74법 raw 원문을 훑어 "이 종류 배는 이 서류를 배에 갖춰 둬야 한다"를 근거조문과 함께
  트리(JSON)로 만든다. 사람이 손으로 인용문을 타이핑하지 않는다 — 아래 SPEC에는
  "어느 법 몇 조에 이런 문구가 있다"만 적고, 실제 인용문은 이 스크립트가 raw 파일을
  직접 열어 뽑아 온다. 문구가 raw에 없으면 그 자리에서 빌드를 실패시킨다(환각 0).

[연계]
  읽기: local_server/knowledge/legal/raw/**/{법률,시행령,시행규칙}.txt · 각 법 _meta.json(법령ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/vessel_doc_tree.json
  설계: _dashboard/H32_vessel_doc_tree_design.md (스키마·방법론·검증 기준)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_vessel_doc_tree.py
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.dirname(HERE)
LEGAL = os.path.dirname(DASH)
RAW = os.path.join(LEGAL, 'raw')
OUT = os.path.join(DASH, 'vessel_doc_tree.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')


def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법(자연유산법).
    근거: _dashboard/H29_design.md §2 (같은 목록을 H-29가 이미 채택)."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}


def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다.
    ※ 고시계열은 마커 형식이 달라(L-54) 이 함수로 못 읽는다 — SPEC은 법률계열만 쓴다."""
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
        if not law:
            _cache[key] = {}
        else:
            p = os.path.join(law['raw'], TIER_FILE[tier])
            _cache[key] = split_articles(open(p, encoding='utf-8', errors='replace').read()) \
                if os.path.exists(p) else {}
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


def quote_of(body, anchor, span=200):
    """anchor를 포함한 문장을 원문에서 뽑아 인용문으로 쓴다(사람이 타이핑하지 않는다)."""
    flat = re.sub(r'\s+', ' ', body)
    i = flat.find(anchor)
    if i < 0:
        return None
    # 항 기호(①…)가 앞에 있으면 그 자리를 문장 시작으로 본다. 기호가 없을 때만 ". "로 자른다.
    # (괄호 안의 "…말한다. 이하 같다)" 때문에 문장이 중간부터 잘리는 것을 막는다.)
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


ERRORS = []

# ── 74법 전수 스캔(커버리지 산출용) ────────────────────────────────
# 설계 §5.2의 3중 조건(동사 × 서류명사 × 장소구). 트리 내용을 만들지는 않고,
# "어디까지 훑었는지"를 수치로 남기기 위해 매 빌드마다 실제로 다시 돌린다.
RE_ART_NB = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)')   # 고시계열(L-54)
SCAN_VERB = re.compile(r'(갖추어\s*두|갖춰\s*두|비치하|비치할|비치해|게시하|지니고\s*있|휴대하)')
SCAN_PLACE = re.compile(r'(선박|선내|어선|여객선|유선|도선|낚싯배|수상레저기구|조타실|기관실|선교|해당 선|그 선|배)')
SCAN_DOC = re.compile(r'(서류|증서|증명서|증명원|면허증|허가증|등록증|신고필증|신고증|검사증|수첩|카드|원부'
                      r'|일지|기록부|기록장|해도|증표|확인증|선언서|명부|장부|허가서|승인서|성적서|계획서'
                      r'|매뉴얼|목록|서면|사본|자료|도서|간행물)')
SCAN_EXC = re.compile(r'(권한을 표시하는 증표|권한을 나타내는 증표|신청서에|첨부하여)')


def scan_corpus():
    """74법 raw 전체(법률계열 + 행정규칙계열)를 훑어 커버리지 수치를 만든다.
    @returns {files, articles, candidates, laws_with_candidates:[slug…]}"""
    files = articles = cands = 0
    hit = set()
    for law in LAWS:
        targets = [(os.path.join(law['raw'], f), True)
                   for f in sorted(os.listdir(law['raw'])) if f.endswith('.txt')]
        ad = os.path.join(law['raw'], '행정규칙')
        if os.path.isdir(ad):
            targets += [(os.path.join(ad, f), False)
                        for f in sorted(os.listdir(ad)) if f.endswith('.txt')]
        for path, bracket in targets:
            files += 1
            text = open(path, encoding='utf-8', errors='replace').read()
            if bracket:
                arts = list(split_articles(text).items())
            else:
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
            articles += len(arts)
            for _, body in arts:
                t = re.sub(r'\s+', ' ', body)
                for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)|(?<=없다\.)', t):
                    s = s.strip()
                    if not s or len(s) > 700 or SCAN_EXC.search(s):
                        continue
                    if not (SCAN_DOC.search(s) and SCAN_PLACE.search(s)):
                        continue
                    for m in SCAN_VERB.finditer(s):
                        if SCAN_PLACE.search(s[max(0, m.start() - 90):m.start()]):
                            cands += 1
                            hit.add(law['slug'])
                            break
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_candidates': sorted(hit)}


def doc(name, slug, tier, article, anchor, kind='필수', cond=None,
        excl=None, deleg=None, note=None, also=None):
    """서류 항목 1건.
    anchor  = 인용문을 뽑을 자리이자 1차 검증 문구. 그 조문 원문에 없으면 빌드 실패.
    also    = 서류명이 여러 서류를 묶은 경우, 그 개별 서류명이 실제로 같은 조문에 있는지
              추가 검증하는 문구들(인용문에는 안 들어가도 검증은 통과해야 한다)."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_of(body, anchor)
    if q is None:
        ERRORS.append('원문에 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    flat = re.sub(r'\s+', ' ', body)
    for a in (also or []):
        if a not in flat:
            ERRORS.append('also 문구 없음: %s %s %s ← "%s"' % (slug, tier, article, a))
            return None
    e = {
        '서류명': name, '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug,
        '계층': tier, '근거조문': article, '법령ID': law_id(slug, tier),
        '파일': rel(slug, tier), '인용': q, '구분': kind, '조건': cond,
    }
    if excl:
        e['적용제외'] = excl
    if deleg:
        e['위임'] = deleg
    if note:
        e['주의'] = note
    return e


def prov(slug, tier, article, anchor, disp=None):
    """노드 출처 1건 — 출처 없는 노드는 만들지 않는다(사용자 확정 4항)."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('provenance 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_of(body, anchor)
    if q is None:
        ERRORS.append('provenance 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    return {'법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': tier,
            '조문': disp or article, '법령ID': law_id(slug, tier),
            '파일': rel(slug, tier), '인용': q}


# ═══════════════════════════════════════════════════════════════════
# 장비 축 확장 (설계 §11) — 아래는 전부 "추가"다. 위쪽 서류 로직은 건드리지 않는다.
#   고시(행정규칙) 계열은 조문 마커·항 기호 형식이 법률계열과 달라(L-54) 전용 함수를 따로 둔다.
# ═══════════════════════════════════════════════════════════════════
RE_ART_ADM = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(')
ADM = '행정규칙'


def split_articles_admrul(text):
    """고시계열 raw(`제7조(제목) ①…`, 대괄호 없음)를 조 단위로 쪼갠다(L-54).

    ★첫 등장만 채택한다 — 「어선설비기준」처럼 본문 뒤에 이미지 표 전사 부록이 붙고
    그 줄이 `제104조(거주구역 및 업무구역의 소방설비) 제1항 표 (…)` 형태라 조문 마커에
    다시 걸리는 파일이 있어, 나중 것이 본문을 덮어쓰면 인용문이 부록에서 잡힌다.
    @returns {'제104조': '조문 원문 …', …}
    [연계] eq()가 이 결과에서 anchor·수량조건을 찾아 인용문을 만든다."""
    out, cur, buf = {}, None, []
    for line in text.split('\n'):
        s = line.strip()
        m = RE_ART_ADM.match(s)
        if m:
            if cur and cur not in out:
                out[cur] = '\n'.join(buf)
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            buf = [s]
        else:
            if cur is not None:
                buf.append(line)
    if cur and cur not in out:
        out[cur] = '\n'.join(buf)
    return out


_adm_cache = {}
_adm_meta = {}


def admrul_path(slug, notice):
    """(법, 고시명) → 그 고시 raw txt의 절대경로."""
    return os.path.join(BY_SLUG[slug]['raw'], ADM, notice + '.txt')


def admrul_body(slug, notice, article):
    """(법, 고시명, 조) → 그 조의 raw 원문 전체. 없으면 None."""
    key = (slug, notice)
    if key not in _adm_cache:
        p = admrul_path(slug, notice)
        _adm_cache[key] = split_articles_admrul(
            open(p, encoding='utf-8', errors='replace').read()) if os.path.exists(p) else {}
    return _adm_cache[key].get(article)


def admrul_id(slug, notice):
    """행정규칙/_admrul.json 의 ID(일련번호). ★개정되면 바뀌는 값이다(L-73) — 설계 §11.10 참조."""
    p = os.path.join(BY_SLUG[slug]['raw'], ADM, '_admrul.json')
    if p not in _adm_meta:
        _adm_meta[p] = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    d = _adm_meta[p]
    # _admrul.json 의 키는 공백이 들어간 원제목("선박 구명설비기준")일 수 있어 공백을 지워 대조한다.
    flat = {re.sub(r'\s+', '', k): v for k, v in d.items()}
    return (flat.get(re.sub(r'\s+', '', notice)) or {}).get('ID')


def rel_admrul(slug, notice):
    return os.path.relpath(admrul_path(slug, notice), LEGAL)


HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'


RE_HO = re.compile(r'(?<= )\d{1,2}\.\s')


def quote_of_admrul(body, anchor, span=260):
    """장비 항목 전용 인용문 추출 — anchor를 포함한 문장을 원문에서 뽑는다.

    quote_of()와 따로 두는 이유 두 가지(설계 §11.5):
      ① 고시는 항 기호 뒤 공백이 없는 경우가 많아(`①고정식 비상소화펌프는…`)
         quote_of()의 `'① '`(공백 포함) 탐지가 헛돈다.
      ② 장비 요건은 각 호에 흩어져 있는 경우가 많아(유도선법 시행령 제17조제1항 각 호),
         항 기호에서 시작하면 400자 상한에 잘려 정작 anchor를 못 담는다 → 호 번호도 시작점으로 본다.
    기존 quote_of()를 고치면 서류 56건 인용문이 전부 흔들리므로 건드리지 않고 새로 만들었다.
    @returns 원문 부분문자열(최대 400자) 또는 None"""
    flat = re.sub(r'\s+', ' ', body)
    i = flat.find(anchor)
    if i < 0:
        return None
    start = 0                       # 조문 첫머리(제N조(제목))가 기본 시작점
    for mark in HANG:
        j = flat.rfind(mark, 0, i)
        if j > start:
            start = j
    j = flat.rfind('다. ', 0, i)
    while j >= 0:                     # 괄호 안의 "…제외한다. 이하 …"를 문장 시작으로 잡지 않는다
        seg = flat[j + 3:i]
        if seg.count(')') <= seg.count('(') and seg.count('）') <= seg.count('（'):
            break
        j = flat.rfind('다. ', 0, j)
    if j >= 0 and j + 3 > start:      # ★rfind가 -1일 때 start를 2로 밀어 조문 머리("제43")를 잘라먹지 않게
        start = j + 3
    for m in RE_HO.finditer(flat, 0, i):
        if m.start() > start:
            start = m.start()          # 호 번호("3. ")부터 — 번호를 잘라먹으면 몇 호인지 알 수 없다
    # 문장 끝 탐지: 괄호 안의 "…제외한다. 이하 …"에서 끊기지 않도록 괄호가 닫힌 자리만 문장 끝으로 본다
    # (서류 파일럿에서 실제로 5건을 망가뜨렸던 것과 같은 함정 — 설계 §6 "초안에서 실제로 걸러낸 오류").
    end, j = None, max(i, i + len(anchor) - 1)
    while True:
        k = flat.find('다. ', j)
        if k < 0:
            break
        seg = flat[start:k]
        if seg.count('(') == seg.count(')') and seg.count('（') == seg.count('）'):
            end = k + 2
            break
        j = k + 1
    if end is None or end <= i:
        end = min(len(flat), i + span)
    return flat[start:end].strip()[:400]


def eq(name, slug, tier, article, anchor, notice=None, kind='비치수량',
       qty=None, qty_src='조문본문', cond=None, also=None, note=None):
    """장비 항목 1건(설계 §11.2).

    anchor  = 인용문을 뽑을 자리이자 1차 검증 문구. 그 조문 원문에 없으면 빌드 실패.
    qty     = 수량조건. ★원문 부분문자열이어야 한다 — 숫자를 요약하다 틀리면 곧바로 오답이
              되므로 빌더가 원문에서 다시 찾는다. 별표에만 있어 모르면 None(지어내지 않는다).
    qty_src = 조문본문 | 조문본문 표(이미지판독·⚠REVIEW) | 별표(raw 미수집)
    notice  = 고시명(tier='행정규칙'일 때 필수)
    [연계] 설계 §11.2 스키마 · §11.6 수량출처 3분류 · §11.8 독립 재대조."""
    if tier == ADM:
        body = admrul_body(slug, notice, article)
        where = '%s %s %s' % (slug, notice, article)
    else:
        body = article_body(slug, tier, article)
        where = '%s %s %s' % (slug, tier, article)
    q = quote_of_admrul(body, anchor) if body is not None else None
    if body is None:
        ERRORS.append('장비: 조문 없음: %s' % where)
        return None
    if q is None:
        ERRORS.append('장비: 원문에 앵커 없음: %s ← "%s"' % (where, anchor))
        return None
    if anchor not in re.sub(r'\s+', ' ', q):
        # 인용문이 400자 상한에 잘려 정작 anchor를 안 담은 경우 — 조용히 넘기면 엉뚱한 인용이 된다.
        ERRORS.append('장비: 인용문에 앵커가 안 담김(문장 경계 탐지 실패): %s ← "%s"' % (where, anchor))
        return None
    flat = re.sub(r'\s+', ' ', body)
    for a in (also or []):
        if a not in flat:
            ERRORS.append('장비: also 문구 없음: %s ← "%s"' % (where, a))
            return None
    if qty is not None and qty not in flat:
        ERRORS.append('장비: 수량조건이 원문에 없음: %s ← "%s"' % (where, qty))
        return None
    if qty is None and qty_src == '조문본문':
        ERRORS.append('장비: 수량조건 없이 수량출처가 조문본문임: %s' % where)
        return None
    e = {
        '장비명': name, '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug,
        '계층': tier, '근거조문': article,
        '파일': rel_admrul(slug, notice) if tier == ADM else rel(slug, tier),
        '인용': q, '요건유형': kind, '수량조건': qty, '수량출처': qty_src, '조건': cond,
    }
    if tier == ADM:
        e['고시명'] = notice
        e['고시ID'] = admrul_id(slug, notice)
    else:
        e['법령ID'] = law_id(slug, tier)
    if note:
        e['주의'] = note
    return e


# 설계 §11.1 — 안전장비(구명·소방설비) 주제의 고시 전수 스캔용 어휘.
SCAN_EQ = re.compile(r'(구명정|구명뗏목|구명부기|구명부환|구명조끼|구명줄발사기|구명줄|구조정'
                     r'|방수복|보온구|노출보호복|자기점화등|자기발연신호|신호홍염|발연부신호'
                     r'|로켓낙하산신호|소화기|소화펌프|소화전|소화호스|소방원장구|소화장치|소화설비'
                     r'|구명설비|소방설비|인명구조용 장비|인명안전장비)')
SCAN_EQ_VERB = re.compile(r'(비치하여야|비치해야|갖추어야|갖춰야|갖추어 두어야|갖추어두어야'
                          r'|갖추어 둘|설치하여야|설치해야|착용하여야|착용해야|비치하도록|갖추어 두도록)')


def scan_admrul_corpus():
    """74법 raw의 고시(행정규칙) 파일 전수를 훑어 "장비 비치 요건 후보"의 커버리지를 만든다.

    서류 파일럿의 scan_corpus()와 같은 목적(정확도가 아니라 "어디까지 봤는지"를 밝히는 것).
    @returns {files, articles, candidates, laws_with_candidates:[…], notices_with_candidates:[…]}
    [연계] 설계 §6 성공기준 1번(커버리지 수치 공개) · §11.4."""
    files = articles = cands = 0
    laws, notices = set(), set()
    for law in LAWS:
        ad = os.path.join(law['raw'], ADM)
        if not os.path.isdir(ad):
            continue
        for f in sorted(os.listdir(ad)):
            if not f.endswith('.txt'):
                continue
            files += 1
            arts = split_articles_admrul(
                open(os.path.join(ad, f), encoding='utf-8', errors='replace').read())
            articles += len(arts)
            hit = False
            for _, body in arts.items():
                t = re.sub(r'\s+', ' ', body)
                for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)', t):
                    s = s.strip()
                    if not s or len(s) > 700:
                        continue
                    if SCAN_EQ.search(s) and SCAN_EQ_VERB.search(s):
                        cands += 1
                        hit = True
                        break
            if hit:
                laws.add(law['slug'])
                notices.add('%s / %s' % (law['slug'], f[:-4]))
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_candidates': sorted(laws), 'notices_with_candidates': sorted(notices)}


# ═══════════════════════════════════════════════════════════════════
# 보험 축 확장 (설계 §12) — 아래도 전부 "추가"다. 위쪽 서류·장비 로직은 건드리지 않는다.
#   인용문 추출은 괄호를 인식하는 quote_of_admrul()을 그대로 재사용한다(수정하지 않고 호출만).
#   보험 조문은 "…보장계약(이하 "보장계약"이라 한다)을 체결하여야 한다"처럼 괄호가 잦아,
#   괄호를 모르는 quote_of()로 뽑으면 서류 파일럿에서 실제로 났던 인용 절단이 재현된다(§6).
# ═══════════════════════════════════════════════════════════════════
L_본문 = '조문본문'
L_위임 = '다른 조문·하위법령 위임(이 조문에는 금액 없음)'
L_없음 = '해당없음(금액 규정 아님)'


def ins(name, slug, tier, article, anchor, who, kind='가입의무', limit=None,
        limit_src=L_없음, sort='필수', cond=None, deleg=None, also=None, note=None,
        notice=None):
    """보험 항목 1건(설계 §12.2).

    anchor    = 인용문을 뽑을 자리이자 1차 검증 문구. 그 조문 원문에 없으면 빌드 실패.
    who       = 가입대상("누가/어떤 배가"). ★원문 부분문자열이어야 한다 — 이 트리의 답이
                "어떤 배가 무슨 보험을 드나"이므로, 대상을 요약하다 틀리면 곧바로 오답이 된다.
    limit     = 보장한도(가입금액 하한 등). ★null이 아니면 같은 조문 원문의 부분문자열이어야 한다.
                금액을 하위법령에 위임했거나 금액 규정이 아니면 None(지어내지 않는다).
    limit_src = 조문본문 | 다른 조문·하위법령 위임(이 조문에는 금액 없음) | 해당없음(금액 규정 아님)
    kind      = 가입의무(가입 자체를 명하는 조문) | 가입요건(보험의 종류·금액·기간을 정하는 조문)
    @returns 보험 항목 dict 또는 None(오류는 ERRORS에 누적돼 빌드가 실패한다)
    [연계] 설계 §12.2 스키마 · §12.4 노드 매핑 · §12.6 독립 재대조."""
    if tier == ADM:
        body = admrul_body(slug, notice, article)
        where = '%s %s %s' % (slug, notice, article)
    else:
        body = article_body(slug, tier, article)
        where = '%s %s %s' % (slug, tier, article)
    if body is None:
        ERRORS.append('보험: 조문 없음: %s' % where)
        return None
    q = quote_of_admrul(body, anchor)
    if q is None:
        ERRORS.append('보험: 원문에 앵커 없음: %s ← "%s"' % (where, anchor))
        return None
    if anchor not in re.sub(r'\s+', ' ', q):
        ERRORS.append('보험: 인용문에 앵커가 안 담김(문장 경계 탐지 실패): %s ← "%s"' % (where, anchor))
        return None
    flat = re.sub(r'\s+', ' ', body)
    if who not in flat:
        ERRORS.append('보험: 가입대상이 원문에 없음: %s ← "%s"' % (where, who))
        return None
    for a in (also or []):
        if a not in flat:
            ERRORS.append('보험: also 문구 없음: %s ← "%s"' % (where, a))
            return None
    if limit is not None and limit not in flat:
        ERRORS.append('보험: 보장한도가 원문에 없음: %s ← "%s"' % (where, limit))
        return None
    if (limit is None) != (limit_src != L_본문):
        ERRORS.append('보험: 보장한도와 보장한도출처가 어긋남: %s (limit=%r, src=%r)'
                      % (where, limit, limit_src))
        return None
    e = {
        '보험종류': name, '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug,
        '계층': tier, '근거조문': article,
        '파일': rel_admrul(slug, notice) if tier == ADM else rel(slug, tier),
        '인용': q, '요건유형': kind, '가입대상': who, '구분': sort, '조건': cond,
        '보장한도': limit, '보장한도출처': limit_src,
    }
    if tier == ADM:
        e['고시명'] = notice
        e['고시ID'] = admrul_id(slug, notice)
    else:
        e['법령ID'] = law_id(slug, tier)
    if deleg:
        e['위임'] = deleg
    if note:
        e['주의'] = note
    return e


# 설계 §12.3 — 보험·공제 가입의무 주제의 74법 전수 스캔용 어휘(법률계열 + 고시계열 모두).
SCAN_INS = re.compile(r'(보험|공제|보장계약|재정보증)')
SCAN_INS_VERB = re.compile(r'(가입하여야|가입해야|가입하거나|가입할 것|가입하도록|가입하게'
                           r'|가입되어 있어야|가입한 후|가입하지 아니하고는|가입하지 아니한'
                           r'|체결하여야|체결해야|체결할 것|체결하도록|체결하지 아니하고는'
                           r'|체결하지 아니한|당연가입자|들어야 한다)')


def scan_insurance_corpus():
    """74법 raw 전체(법률계열 + 고시계열)를 훑어 "보험·공제 가입의무 후보"의 커버리지를 만든다.

    서류·장비 스캔과 같은 목적 — 정확도가 아니라 "어디까지 봤는지"를 수치로 남긴다.
    @returns {files, articles, candidates, laws_with_candidates:[…], laws_with_vocab:[…]}
    [연계] 설계 §6 성공기준 1번 · §12.3."""
    files = articles = cands = 0
    hit, vocab = set(), set()
    for law in LAWS:
        targets = [(os.path.join(law['raw'], f), True)
                   for f in sorted(os.listdir(law['raw'])) if f.endswith('.txt')]
        ad = os.path.join(law['raw'], ADM)
        if os.path.isdir(ad):
            targets += [(os.path.join(ad, f), False)
                        for f in sorted(os.listdir(ad)) if f.endswith('.txt')]
        for path, bracket in targets:
            files += 1
            text = open(path, encoding='utf-8', errors='replace').read()
            if SCAN_INS.search(text):
                vocab.add(law['slug'])
            arts = split_articles(text) if bracket else split_articles_admrul(text)
            articles += len(arts)
            for _, body in arts.items():
                t = re.sub(r'\s+', ' ', body)
                for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)|(?<=없다\.)', t):
                    s = s.strip()
                    if not s or len(s) > 800:
                        continue
                    if SCAN_INS.search(s) and SCAN_INS_VERB.search(s):
                        cands += 1
                        hit.add(law['slug'])
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_candidates': sorted(hit), 'laws_with_vocab': sorted(vocab)}


# ───────────────────────────────────────────────────────────────────
# SPEC — 여기에는 "어느 법 몇 조" 와 "그 조문에 있어야 할 문구(anchor)" 만 적는다.
#         인용문·법령ID·파일경로는 전부 위 함수들이 raw에서 읽어 채운다.
# ───────────────────────────────────────────────────────────────────
S_어선 = '어선법'
S_선박 = '선박법'
S_선안 = '선박안전법'
S_선직 = '선박직원법'
S_선원 = '선원법'
S_해환 = '해양환경관리법'
S_평형 = '선박평형수(船舶平衡水)관리법'
S_보안 = '국제항해선박및항만시설의보안에관한법률'
S_유배 = '유류오염손해배상보장법'
S_해교 = '해상교통안전법'
S_낚시 = '낚시관리및육성법'
S_유도 = '유선및도선사업법'
S_레저 = '수상레저안전법'
S_수산 = '수산업법'
S_원양 = '원양산업발전법'
S_해운 = '해운법'
S_수색 = '수상에서의수색ㆍ구조등에관한법률'
S_EEZ = '배타적경제수역에서의외국인어업등에대한주권적권리의행사에관한법률'
S_과조 = '해양과학조사법'
S_생명 = '해양수산생명자원의확보ㆍ관리및이용등에관한법률'
S_폐기 = '해양폐기물및해양오염퇴적물관리법'

# 장비 축(설계 §11) — 고시명은 raw/<법>/행정규칙/<이름>.txt 의 파일명 그대로.
S_레저등록 = '수상레저기구의등록및검사에관한법률'
N_구명 = '선박구명설비기준'
N_소방 = '선박소방설비기준'
N_어선설비 = '어선설비기준'
N_소형어선 = '총톤수10톤미만소형어선의구조및설비기준'
N_레저검사 = '동력수상레저기구안전검사기준'
N_설비 = '선박설비기준'          # 2026-08-10 그룹1 감사 지적으로 추가(설계 §11.12)
# 보험 축(설계 §12) — 새로 등장하는 법만 추가한다(기존 상수는 그대로 재사용).
S_어재보 = '어선원및어선재해보상보험법'
S_항표 = '항로표지법'
S_해적 = '국제항해선박등에대한해적행위피해예방에관한법률'
Q_별표 = '별표·표(raw 미수집)'
Q_OCR = '조문본문 표(이미지판독·⚠REVIEW)'
Q_없음 = '해당없음(수량 규정 아님)'


def build():
    root = {
        'id': 'ship', '라벨': '선박',
        '정의': '수상 또는 수중에서 항행용으로 사용하거나 사용할 수 있는 배 종류',
        'provenance': [
            prov(S_선박, '법률', '제1조의2', '"선박"이란 수상 또는 수중에서 항행용으로', '제1조의2제1항'),
            prov(S_선안, '법률', '제2조', '"선박"이라 함은 수상(水上) 또는 수중(水中)에서', '제2조제1호'),
        ],
        '질문': '어떤 배에 관한 것인가요?',
        '선택지': [
            {'label': '어선', 'hint': '어업·어획물운반업·수산물가공업에 종사하거나 어선등록을 한 배 (어선법 제2조제1호)', 'next': 'fishing_vessel'},
            {'label': '수상레저기구', 'hint': '수상레저활동에 사용되는 모터보트·수상오토바이·요트 등 (수상레저안전법 제2조제3호)', 'next': 'water_leisure_craft'},
            {'label': '그 밖의 선박', 'hint': '어선도 수상레저기구도 아닌 배 — 여객선·화물선 등 (선박법 제1조의2제1항)', 'next': 'general_ship'},
        ],
        '서류': [
            doc('선박오염물질기록부(폐기물기록부·기름기록부·유해액체물질기록부)', S_해환, '법률', '제30조',
                '선박오염물질기록부', '조건부',
                '조문 각 호의 구분에 따른 기록부 — 폐기물기록부는 "해양수산부령이 정하는 일정 규모 이상의 선박"',
                also=['폐기물기록부', '기름기록부', '유해액체물질기록부']),
            doc('전자기록부 적합확인서', S_해환, '법률', '제30조의2',
                '전자기록부 적합확인서를 해당 선박에 비치', '조건부',
                '선박오염물질기록부를 전자기록부로 관리하는 경우'),
            doc('선박해양오염비상계획서', S_해환, '법률', '제31조',
                '선박해양오염비상계획서', '조건부',
                '대상 선박의 범위는 해양수산부령으로 정함(같은 조 제3항)',
                deleg=[{'법령': '해양환경관리법', '계층': '시행규칙', '조문': '제25조 이하(범위 위임)'}]),
            doc('해양오염방지관리인 임명 증빙서류', S_해환, '법률', '제32조',
                '해양오염방지관리인을 임명한 증빙서류를 선박 안에 비치', '조건부',
                '해양오염방지관리인을 임명하여야 하는 선박'),
            doc('해양오염방지검사증서등', S_해환, '법률', '제57조',
                '해양오염방지검사증서등을 비치', '조건부', '해양오염방지검사증서등을 교부받은 선박'),
            doc('오존층파괴물질기록부', S_해환, '법률', '제42조',
                '오존층파괴물질기록부', '조건부', '오존층파괴물질을 배출하거나 충전하는 선박',
                note='이 조항은 "작성하여 비치하여야 한다"라고만 하고 비치 장소(선박 안)를 명시하지 않는다. '
                     '같은 법의 다른 기록부 조항(제30조)과 달리 장소 문구가 없다는 점을 그대로 기록한다.'),
            doc('선박에너지효율관리계획서', S_해환, '법률', '제41조의3',
                '선박에너지효율관리계획서', '조건부',
                '국제항해에 사용되는 총톤수 400톤 이상의 선박 중 해양수산부령으로 정하는 선박'),
        ],
        '장비': [],
        '장비메모': '모든 배에 공통으로 걸리는 안전장비 비치 조문은 raw에서 확인되지 않았다 — '
                    '구명·소방설비 기준은 어선/수상레저기구/선박안전법 대상선박으로 갈려 각각 다른 고시가 정한다.',
        '보험': [],
        '보험메모': '어선·수상레저기구를 포함한 "모든 배"에 한 조문으로 걸리는 보험 가입의무는 raw에서 확인되지 않았다. '
                    '선원법의 보험 3종은 「선박법」에 따른 대한민국 선박과 「어선법」에 따른 어선에 걸리지만 '
                    '수상레저기구 계열은 다른 법(수상레저안전법)이 따로 정하므로, 서류 축에서 선원법 제20조를 '
                    '어선·그 밖의 선박 두 노드에 나눠 단 것과 같은 방식으로 이 트리에서도 두 노드에 나눠 달았다.',
        'children': [],
    }

    fishing = {
        'id': 'fishing_vessel', '라벨': '어선',
        '정의': '어업·어획물운반업·수산물가공업에 종사하는 선박, 수산업 시험·조사·지도·단속·교습 선박, 건조허가를 받아 건조 중이거나 건조한 선박, 어선등록을 한 선박',
        'provenance': [prov(S_어선, '법률', '제2조', '"어선"이란 다음 각 목의 어느 하나에 해당하는 선박', '제2조제1호')],
        '구분근거': [prov(S_선안, '법률', '제3조', '「어선법」 제2조제1호에 따른 어선', '제3조제1항제2호의2')],
        '질문': '그 어선으로 낚시 손님을 태우시나요?',
        '선택지': [
            {'label': '낚시어선', 'hint': '어선법에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선 (낚시 관리 및 육성법 제2조제7호)', 'next': 'angling_vessel'},
            {'label': '그 밖의 어선', 'hint': '낚시어선업에 쓰지 않는 어선 — 조업·운반·시험조사 등', 'next': 'other_fishing_vessel'},
        ],
        '서류': [
            doc('선박국적증서·선적증서 또는 등록필증', S_어선, '법률', '제15조',
                '선박국적증서등"이라 한다)을 어선에 갖추어 두어야', '필수',
                '어선을 항행하거나 조업 목적으로 사용할 경우',
                excl='내수면어업·양식업에 사용하는 어선 등 해양수산부령으로 정하는 어선(시행규칙 제33조의2)',
                deleg=[{'법령': '어선법', '계층': '시행규칙', '조문': '제33조의2'}]),
            doc('어선검사증서·어선특별검사증서 또는 임시항행검사증서', S_어선, '법률', '제29조',
                '어선에 비치하여야 한다', '필수', '어선을 항행 또는 조업의 목적으로 사용할 경우',
                excl='내수면어업·양식업에 사용하는 어선 등 해양수산부령으로 정하는 어선(같은 조 단서)'),
            doc('복원성에 관한 자료', S_어선, '법률', '제3조의2',
                '복원성에 관한 자료를 제공받은 선장은 해당 자료를 어선 안에 비치', '조건부',
                '복원성 자료를 제공받은 어선'),
            doc('제한하중등 확인증', S_어선, '시행규칙', '제61조',
                '제한하중등 확인증을 어선에 갖추어두고', '조건부', '하역설비를 갖춘 어선'),
            doc('하역설비검사기록부', S_어선, '시행규칙', '제61조',
                '하역설비검사기록부를 어선에 갖추어 두어야', '조건부', '하역설비를 갖춘 어선'),
            doc('선원명부·항해일지·화물에 관한 서류(선박국적증서 포함)', S_선원, '법률', '제20조',
                '선장은 다음 각 호의 서류를 선내에 갖추어 두어야', '조건부',
                '선원법이 적용되는 어선 — 총톤수 20톤 미만인 어선으로서 해양수산부령으로 정하는 선박은 적용 제외(선원법 제3조제1항제3호)',
                also=['선박국적증서', '선원명부', '항해일지', '화물에 관한 서류'],
                deleg=[{'법령': '선원법', '계층': '시행규칙', '조문': '제13조제2항'}]),
            doc('선박검사증서·해도·기관일지·속구목록·승무정원증서 등', S_선원, '시행규칙', '제13조',
                '속구목록', '조건부',
                '선원법 제20조제1항제5호 위임 — 「2006 해사노동협약」 도서는 항해선이 아닌 선박과 어선은 제외',
                also=['선박검사증서', '항행하는 해역의 해도', '기관일지', '선박의 승무정원증서']),
            doc('해기사 면허증 또는 승무자격증', S_선직, '법률', '제15조',
                '면허증이나 승무자격증을 선장에게 제출', '조건부',
                '해기사가 선박직원으로 승무하는 경우(선박직원법 제3조제1항 — 한국선박)'),
            doc('어업허가증 사본', S_수산, '시행규칙', '제38조',
                '어업허가증을 어선에 갖추어 둘 수 있도록', '조건부',
                '근해어업·연안어업 및 구획어업의 허가를 받은 어선',
                note='이 조항은 허가권자의 "사본 발급" 의무 형식으로 적혀 있고 어선 비치 의무를 직접 명령하는 문장은 아니다. '
                     '다만 어선법 시행규칙 제33조의2제3호가 "어업허가증을 갖춰 두고 있는 어선"을 전제로 하고 있어 비치가 예정돼 있다.'),
            doc('어구관리기록부', S_수산, '법률', '제76조의2',
                '어구관리기록부"라 한다)를 작성하여 어선에 비치하고 이를 3년간 보존', '조건부',
                '어구의 사용과 유실이 많이 발생하는 어업으로서 해양수산부령으로 정하는 어업'),
            doc('원양어업허가증 원본 또는 사본', S_원양, '시행규칙', '제22조',
                '원양어업허가증의 원본 또는 사본을 어선에 비치', '조건부', '원양어업자등'),
            doc('어업활동 허가증(외국인)', S_EEZ, '시행규칙', '제6조',
                '허가증을 허가받은 선박의 조타실에 갖추어 두어야', '조건부',
                '배타적 경제수역에서 어업활동 허가를 받은 외국인의 선박(부속선이 있으면 부속선 조타실에 사본)'),
        ],
        '장비': [
            eq('구명정 또는 구명뗏목', S_어선, ADM, '제43조',
               '최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목을 비치하여야', notice=N_어선설비,
               qty='배의 길이 20미터 이상의 어선에는 최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목',
               cond='배의 길이 20미터 이상의 어선. 다만 권현망어업 종사 어선 및 면허어업의 관리선으로 지정된 어선은 제외'),
            eq('구명부환', S_어선, ADM, '제44조', '구명부환을 비치하여야', notice=N_어선설비,
               qty='배의 길이 20미터 이상의 어선에는 4개, 배의 길이 20미터 미만의 어선에는 2개의 구명부환',
               cond='모든 어선(길이 구간별로 수가 다름)'),
            eq('구명조끼', S_어선, ADM, '제45조', '구명조끼를 최대승선인원과 같은 수', notice=N_어선설비,
               qty='구명조끼를 최대승선인원과 같은 수 만큼', cond='모든 어선'),
            eq('방수복', S_어선, ADM, '제45조의2', '방수복을 최대승선인원과 같은 수만큼 비치하여야',
               notice=N_어선설비, qty='최대승선인원과 같은 수만큼',
               cond='원양어업허가를 받은 어선 중 베링해 및 남빙양에서 조업활동을 하는 어선'),
            eq('자기점화등·자기발연신호', S_어선, ADM, '제46조',
               '각각 2개의 자기점화등 및 자기발연신호를 비치하여야', notice=N_어선설비,
               qty='배의 길이 20미터 이상의 어선에는 각각 2개의 자기점화등 및 자기발연신호',
               cond='배의 길이 20미터 이상/미만으로 갈림',
               also=['배의 길이 20미터 미만의 어선에는 1개의 자기점화등']),
            eq('구명조끼등(구명조끼에 부착하는 등)', S_어선, ADM, '제47조', '구명조끼등을 부착하여야',
               notice=N_어선설비, kind='비치', qty_src=Q_없음,
               cond='야간항해를 하는 총톤수 10톤 이상의 어선'),
            eq('로켓낙하산신호', S_어선, ADM, '제48조', '로켓낙하산신호를 비치하여야', notice=N_어선설비,
               qty='배의 길이 20미터 이상의 어선에는 4개의 로켓낙하산신호',
               cond='배의 길이 20미터 이상의 어선'),
            eq('소화펌프', S_어선, ADM, '제99조', '소화펌프를 비치하여야', notice=N_어선설비,
               qty='총톤수 1,000톤 이상의 어선에는 2대, 총톤수 80톤 이상 1,000톤 미만의 어선에는 1대의 소화펌프',
               cond='총톤수 80톤 이상의 어선'),
            eq('소화호스 및 노즐', S_어선, ADM, '제102조', '소화호스 및 노즐을 해당 소화전 근처',
               notice=N_어선설비,
               qty='소화전 1개에 대하여 1개, 기타 장소에 있어서는 길이 30미터 또는 그 단수마다 1개의 소화호스 및 노즐',
               cond='총톤수 80톤 이상의 어선'),
            eq('내연기관이 있는 장소의 소방설비', S_어선, ADM, '제103조',
               '소방설비를 비치하여야', notice=N_어선설비, kind='비치', qty_src=Q_없음,
               cond='내연기관이 있는 장소 — 총톤수 1,000톤 미만/이상으로 각 호의 설비가 갈림',
               note='이 조는 총톤수·무인기관실 여부에 따라 각 호로 갈리는 설비 목록이라 단일 수량으로 요약되지 않는다. '
                    '구체 목록은 인용한 조문 원문을 그대로 볼 것.'),
            eq('휴대식소화기(거주구역·업무구역)', S_어선, ADM, '제104조',
               '휴대식소화기를 적당히 분산하여 비치하여야', notice=N_어선설비, qty_src=Q_OCR,
               qty='| 1,000톤 이상 | 5개 | | 500톤 이상 1,000톤 미만 | 4개 | | 80톤 이상 500톤 미만 | 3개 | '
                   '| 20톤 이상 80톤 미만 | 2개 | | 20톤 미만 | 1개 |',
               cond='모든 어선(총톤수 구간별). 총톤수 500톤 이상은 도료창고·인화성액체창고 출입구 부근에 1개 추가',
               note='수량표가 원문에서는 이미지(<img>)였고, 그 이미지판독(OCR) 전사본이 조문 본문에 이어 붙어 있다. '
                    'raw 자체가 "⚠REVIEW 처벌·금액·수치는 사람확인 필요"로 표시한 값이다.'),
            eq('소방원장구', S_어선, ADM, '제105조', '소방원장구를 용이하게 접근할 수 있는', notice=N_어선설비,
               qty='총톤수 1,000톤 이상의 어선에는 1조의 소방원장구', cond='총톤수 1,000톤 이상의 어선'),
            eq('예비소화제', S_어선, ADM, '제111조', '예비소화제를 비치하여야', notice=N_어선설비,
               qty='휴대식소화기 또는 간이식소화기의 수에 각각 50퍼센트의 예비소화제', cond='모든 어선'),
            eq('구명설비(종류·수량)', S_어선, ADM, '제52조', '별표 3에 따른 구명설비를 갖추어 두도록',
               notice=N_소형어선, qty=None, qty_src=Q_별표,
               cond='총톤수 10톤 미만의 어선(소형어선) — 「어선설비기준」의 일반 기준에 우선한다(같은 기준 제3조)',
               note='별표 3(소형어선의 구명설비 비치종류·수량)의 표 내용이 raw에 없다 — 이 고시 파일에는 별표 절 자체가 '
                    '수집돼 있지 않다. 몇 개인지는 이 자산으로 답할 수 없다.'),
            eq('소화기', S_어선, ADM, '제59조', '소화기를 설치장소의 출입구 가까운 곳에 갖추어 두어야',
               notice=N_소형어선, qty=None, qty_src=Q_별표,
               cond='총톤수 10톤 미만의 어선(소형어선)',
               note='"다음 표에 따른 비치수량"이라고만 하고 그 표가 원문에서 이미지(<img id="143033895">)이며, '
                    '이 파일에는 이미지판독 전사본이 없다.'),
            eq('구명뗏목·한국형 구명뗏목 또는 구명부기', S_어선, ADM, '제64조',
               '구명뗏목이나 한국형 구명뗏목 또는 구명부기를 갖추어 두어야', notice=N_소형어선,
               qty='최대승선인원이 13인 이상인 경우에는 최대승선인원을 수용할 수 있는 구명뗏목이나 한국형 구명뗏목 또는 구명부기',
               cond='총톤수 10톤 미만 어선으로서 최대승선인원이 13인 이상인 경우',
               note='인용문은 제1항 후단("이 경우 …")이다 — 제1항 전단은 최대승선인원 산정 방법을 정한다. '
                    '한국형 구명뗏목은 「낚시 관리 및 육성법」 제25조에 따라 낚시어선업 신고를 한 어선에 한정된다(같은 항 단서).'),
        ],
        '보험': [
            ins('어선원등의 재해보상보험(어선원보험)', S_어재보, '법률', '제16조',
                '당연히 어선원등의 재해보상보험', '이 법을 적용받는 어선의 소유자',
                cond='「어선원 및 어선 재해보상보험법」이 적용되는 어선 — 같은 법 제6조제1항은 "이 법은 모든 어선에 적용한다"고 '
                     '하되, 원양어업 허가를 받은 어선·수산물 운송에 종사하는 어선·대통령령으로 정하는 어선은 특별한 규정이 '
                     '있는 경우에만 적용한다. 대통령령으로 정하는 어선(제6조제1항제3호)의 소유자는 중앙회 승인을 받아 임의로 가입한다.',
                note='이 항은 "가입하여야 한다"가 아니라 "당연히 …보험가입자(당연가입자)가 된다"라고 정한다 — '
                     '신청 없이 법으로 보험관계가 성립하는 형식이다(성립일은 같은 법 제18조).'),
            ins('선원 재해보상보험등', S_선원, '법률', '제106조',
                '재해보상을 완전히 이행할 수 있도록 대통령령으로 정하는 보험 또는 공제', '선박소유자',
                sort='조건부',
                limit='보험가입 금액은 승선평균임금 이상으로 하여야 한다', limit_src=L_본문,
                cond='선원법이 적용되는 어선 — 총톤수 20톤 미만인 어선으로서 해양수산부령으로 정하는 선박은 적용 제외'
                     '(선원법 제3조제1항제3호)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제32조(보험·공제의 종류)'}],
                note='같은 어선에 「어선원 및 어선 재해보상보험법」 제16조제1항의 당연가입 의무도 별도로 있다'
                     '(이 노드의 다른 항목). 두 의무의 관계는 조문에 명시돼 있지 않아 이 자산은 판단하지 않는다.'),
            ins('유기구제보험등', S_선원, '법률', '제42조의2',
                '유기된 선원을 구제하기 위하여 대통령령으로 정하는 보험 또는 공제',
                '대통령령으로 정하는 선박소유자', sort='조건부', limit_src=L_위임,
                cond='국제항해에 종사하는 선박의 선박소유자(선원법 시행령 제5조제1항)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제5조'}],
                note='보장 범위는 같은 조 제2항 각 호(송환비용·송환수당·선상생활에 필요한 재화·서비스 비용)이고, '
                     '가입금액의 하한을 정한 문구는 이 조에 없다.'),
            ins('임금채권보장보험등(또는 기금)', S_선원, '법률', '제56조',
                '지급을 보장하기 위하여 대통령령으로 정하는 보험 또는 공제에 가입하거나 기금을 조성하여야',
                '선박소유자(선박소유자 단체를 포함한다. 이하 이 조에서 같다)', sort='조건부',
                limit='제52조에 따른 임금의 최종 4개월분', limit_src=L_본문,
                also=['제55조에 따른 퇴직금의 최종 4년분'],
                cond='선원법이 적용되는 어선의 선박소유자. 다른 법률에 따라 선원의 체불임금 지급을 보장하기 위한 기금의 '
                     '적용을 받는 선박소유자는 제외(같은 항 단서)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제18조의3(보험·공제·기금의 종류)'}],
                note='여기의 `보장한도`는 원(₩) 단위 금액이 아니라 "보장해야 하는 체불임금의 최소 범위"다'
                     '(같은 조 제2항 — 임금 최종 4개월분·퇴직금 최종 4년분).'),
        ],
        'children': [],
    }

    angling = {
        'id': 'angling_vessel', '라벨': '낚시어선',
        '정의': '「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선',
        'provenance': [prov(S_낚시, '법률', '제2조', '"낚시어선"이란', '제2조제7호')],
        '서류': [
            doc('낚시어선업 신고확인증(승객이 잘 볼 수 있도록 게시)', S_낚시, '법률', '제32조',
                '낚시어선업 신고확인증', '필수', None,
                deleg=[{'법령': '낚시 관리 및 육성법', '계층': '시행규칙', '조문': '제23조(게시방법·별표3)'}]),
            doc('승선자명부 사본(3개월간)', S_낚시, '법률', '제33조',
                '승선자명부(전자문서로 된 명부는 제외한다)의 사본을 3개월 동안 갖추어 두어야', '필수',
                '전자문서로 된 명부는 제외'),
        ],
        '장비': [
            eq('구명조끼(승선자 전원 착용)', S_낚시, '법률', '제29조',
               '승선자 전원에게 구명조끼를 착용하도록 하여야', kind='착용',
               qty='낚시어선에 승선한 승객 등 승선자 전원',
               cond='낚시어선업자 및 선원의 의무 — 승객이 착용하지 아니하면 승선을 거부할 수 있다'),
        ],
        '보험': [
            ins('낚시어선업자의 보험 또는 공제', S_낚시, '법률', '제48조',
                '낚시어선의 승객 및 선원의 피해를 보전(補塡)하기 위하여 보험이나 공제에 가입하여야',
                '낚시터업자와 낚시어선업자', limit_src=L_위임,
                cond='낚시어선업자 — 낚시어선의 승객 및 선원의 피해 보전',
                deleg=[{'법령': '낚시 관리 및 육성법', '계층': '시행령', '조문': '제22조'}],
                note='이 조는 낚시터업자와 낚시어선업자를 함께 규정한다. 낚시터업(육상·수면 낚시터)은 이 트리의 축'
                     '(선박 종류)이 아니므로 이 노드에는 낚시어선업자 부분만 해당한다.'),
            ins('낚시어선업자의 보험 또는 공제(가입금액)', S_낚시, '시행령', '제22조',
                '법 제48조에 따라 다음 각 호의 구분에 따른 보험이나 공제에 가입하여야',
                '낚시터업자와 낚시어선업자', kind='가입요건',
                also=['2. 낚시어선업자의 경우: 어선검사증서에 기재된 낚시어선의 최대승선인원의 피해를 보전하기 위한 보험이나 공제'],
                limit='가입금액은 「자동차손해배상 보장법 시행령」 제3조제1항에 따른 금액 이상으로 한다',
                limit_src=L_본문,
                cond='낚시어선업자의 경우 — 어선검사증서에 기재된 낚시어선의 최대승선인원분',
                note='선원의 경우 가입금액은 「어선원 및 어선 재해보상보험법」 제2조제1항제6호에 따른 어선원등의 재해를 '
                     '보상할 수 있는 금액 이상이어야 하고(같은 조 제2항 단서), 가족어선원에 대한 보험·공제는 가입하지 '
                     '아니할 수 있다(같은 조 제1항 단서).'),
        ],
        '추가확인': [],
        'children': [],
    }

    other_fish = {
        'id': 'other_fishing_vessel', '라벨': '그 밖의 어선',
        '정의': '낚시어선업에 쓰이지 않는 어선(조업·운반·시험조사 등)',
        'provenance': [prov(S_어선, '법률', '제2조', '"어선"이란 다음 각 목의 어느 하나에 해당하는 선박', '제2조제1호')],
        '구분근거': [prov(S_낚시, '법률', '제2조', '"낚시어선"이란', '제2조제7호(반대해석 — 낚시어선업에 쓰이지 않는 어선)')],
        '서류': [],
        '메모': '이 리프에만 붙는 고유 서류는 raw에서 확인되지 않았다. 필요한 서류는 부모(어선·선박) 노드에서 상속된다.',
        '장비': [],
        '장비메모': '이 리프에만 붙는 고유 장비 요건은 raw에서 확인되지 않았다 — 「어선설비기준」·「총톤수 10톤 미만 '
                    '소형어선의 구조 및 설비기준」이 정하는 요건을 부모(어선) 노드에서 그대로 상속한다.',
        '보험': [],
        '보험메모': '이 리프에만 붙는 고유 보험 가입의무는 raw에서 확인되지 않았다 — 어선원보험(어선원 및 어선 재해보상보험법 '
                    '제16조)과 선원법의 보험 3종을 부모(어선) 노드에서 그대로 상속한다. '
                    '낚시 관리 및 육성법 제48조의 보험은 낚시어선업자에게만 걸리므로 이 리프에는 오지 않는다.',
        '추가확인': [],
        'children': [],
    }

    leisure = {
        'id': 'water_leisure_craft', '라벨': '수상레저기구',
        '정의': '수상레저활동에 사용되는 선박이나 기구 — 동력수상레저기구와 무동력수상레저기구로 구분',
        'provenance': [prov(S_레저, '법률', '제2조', '"수상레저기구"란 수상레저활동에 사용되는 선박이나 기구', '제2조제3호')],
        '구분근거': [prov(S_선안, '시행령', '제2조', '안전검사를 받은 수상레저기구', '제2조제1항제2호')],
        '질문': '추진기관(엔진)이 달려 있나요?',
        '선택지': [
            {'label': '동력수상레저기구', 'hint': '추진기관이 부착돼 있거나 수시로 부착·분리할 수 있는 것 — 수상오토바이·모터보트·고무보트·세일링요트 등 (수상레저안전법 제2조제4호)', 'next': 'powered_craft'},
            {'label': '무동력수상레저기구', 'hint': '동력수상레저기구 외의 수상레저기구 (수상레저안전법 제2조제5호)', 'next': 'unpowered_craft'},
        ],
        '서류': [],
        '장비': [
            eq('구명조끼 등 인명안전장비(착용)', S_레저, '법률', '제20조',
               '구명조끼 등 인명안전에 필요한 장비를', kind='착용', qty=None, qty_src=Q_없음,
               cond='수상레저활동을 하는 사람 — 구체적 착용 방법·대체장비는 수상레저안전법 시행규칙 제23조',
               note='이 의무는 기구가 아니라 "수상레저활동을 하는 사람"에게 걸린다. 동력·무동력을 가리지 않으므로 '
                    '부모 노드에 두어 두 리프가 상속하게 했다.'),
        ],
        '보험': [
            ins('수상레저사업자의 보험등', S_레저, '법률', '제49조',
                '수상레저사업자는 대통령령으로 정하는 바에 따라 그 종사자와 이용자의 피해를 보전하기 위하여 보험등에 가입하여야',
                '수상레저사업자', limit_src=L_위임,
                cond='수상레저사업자 — 그 종사자와 이용자의 피해 보전',
                deleg=[{'법령': '수상레저안전법', '계층': '시행령', '조문': '제31조'}],
                note='이 의무는 기구 종류(동력·무동력)가 아니라 "수상레저사업자"에게 걸리므로 부모 노드에 두어 '
                     '두 리프가 상속하게 했다(같은 노드의 인명안전장비 착용 의무와 같은 이유).'),
            ins('수상레저사업자의 보험등(가입요건)', S_레저, '시행령', '제31조',
                '수상레저사업자는 법 제49조제2항에 따라 다음 각 호의 요건을 모두 갖춘 보험등에 가입해야',
                '수상레저사업자', kind='가입요건',
                limit='가입금액: 「자동차손해배상 보장법 시행령」 제3조제1항에 따른 금액 이상으로 할 것',
                limit_src=L_본문,
                also=['가입기간: 수상레저사업자의 사업기간 동안 계속하여 가입할 것'],
                cond='피보험자·피공제자는 수상레저사업에 종사하는 사람이나 수상레저기구 이용자'),
        ],
        'children': [],
    }

    powered = {
        'id': 'powered_craft', '라벨': '동력수상레저기구',
        '정의': '추진기관이 부착되어 있거나 추진기관을 부착·분리하는 것이 수시로 가능한 수상레저기구',
        'provenance': [prov(S_레저, '법률', '제2조', '"동력수상레저기구"란', '제2조제4호')],
        '서류': [
            doc('동력수상레저기구 조종면허증', S_레저, '법률', '제16조',
                '면허증을 지니고 있어야', '필수', '조종하는 사람이 직접 지닐 것'),
        ],
        '메모': '등록증·안전검사증을 기구에 비치하라는 명시 조문은 「수상레저기구의 등록 및 검사에 관한 법률」 raw에서 확인되지 않았다'
                '(발급·재발급·반납 조문만 존재 — 제8조·제16조·제10조). 없는 의무를 지어내지 않고 그대로 남긴다.',
        '장비': [
            eq('구명뗏목', S_레저등록, ADM, '제44조', '충분한 구명뗏목을 비치해야', notice=N_레저검사,
               qty='연해이상 모터보트에는 승선정원을 수용하는데 충분한 구명뗏목',
               cond='모터보트(연해구역 이상을 운항구역으로 하는 것). 곤란하면 구명부기 또는 승선정원 3명당 1개 이상의 구명부환으로 대체 가능'),
            eq('구명부환', S_레저등록, ADM, '제46조', '모터보트에는 최소 2개 이상의 구명부환', notice=N_레저검사,
               qty='모터보트에는 최소 2개 이상의 구명부환',
               cond='모터보트. 총톤수 2톤 미만이면 최소 1개 이상'),
            eq('구명조끼', S_레저등록, ADM, '제47조', '승선정원에 해당하는 수 이상의 구명조끼를 비치해야',
               notice=N_레저검사, qty='승선정원에 해당하는 수 이상의 구명조끼',
               cond='모터보트. 어린이를 승선시킬 경우 어린이용 구명조끼 추가'),
            eq('자기발연신호·자기점화등', S_레저등록, ADM, '제48조', '자기발연신호를 1개 이상을 갖추어야',
               notice=N_레저검사, qty='승선정원 13명 이상의 연해이상 모터보트에는 자기발연신호를 1개 이상',
               cond='모터보트 — 자기점화등은 모든 모터보트에 1개 이상(주간에만 운항하면 제외 가능)',
               also=['모터보트에는 자기점화등 1개 이상을 비치해야']),
            eq('휴대식소화기', S_레저등록, ADM, '제51조', '이상의 휴대식소화기를 즉시 사용할 수 있도록 비치해야',
               notice=N_레저검사, qty='모터보트에는 2개(길이 12미터 미만인 모터보트에는 1개) 이상의 휴대식소화기',
               cond='모터보트. 총톤수 2톤 미만이면 간이식소화기 1개만 비치 가능'),
            eq('구명뗏목', S_레저등록, ADM, '제75조', '충분한 구명뗏목을 비치해야', notice=N_레저검사,
               qty='연해이상 세일링요트에는 승선정원을 수용하는데 충분한 구명뗏목',
               cond='세일링요트(연해구역 이상을 운항구역으로 하는 것)'),
            eq('구명부환', S_레저등록, ADM, '제77조', '세일링요트에는 최소 2개 이상의 구명부환',
               notice=N_레저검사, qty='세일링요트에는 최소 2개 이상의 구명부환',
               cond='세일링요트. 총톤수 2톤 미만이면 최소 1개 이상'),
            eq('구명조끼', S_레저등록, ADM, '제78조', '승선정원에 해당하는 수 이상의 구명조끼를 비치해야',
               notice=N_레저검사, qty='승선정원에 해당하는 수 이상의 구명조끼', cond='세일링요트'),
            eq('자기발연신호·자기점화등', S_레저등록, ADM, '제79조', '자기발연신호를 1개 이상을 갖추어야',
               notice=N_레저검사, qty='승선정원 13명 이상의 연해이상 세일링요트에는 자기발연신호를 1개 이상',
               cond='세일링요트', also=['세일링요트에는 자기점화등 1개 이상을 비치해야']),
            eq('휴대식소화기', S_레저등록, ADM, '제82조', '이상의 휴대식소화기를 즉시 사용할 수 있도록 비치해야',
               notice=N_레저검사, qty='세일링요트에는 2개(길이 12미터 미만인 세일링요트에는 1개) 이상의 휴대식소화기',
               cond='세일링요트. 총톤수 2톤 미만이면 간이식소화기 1개만 비치 가능'),
            eq('구명조끼', S_레저등록, ADM, '제106조', '승선정원에 해당하는 수 이상의 구명조끼를 비치해야',
               notice=N_레저검사, qty='승선정원에 해당하는 수 이상의 구명조끼',
               cond='길이 6미터 미만의 모터보트 및 세일링요트(같은 기준 제98조 적용대상)'),
            eq('간이식소화기', S_레저등록, ADM, '제107조', '간이식소화기 1개 이상이 비치되어야', notice=N_레저검사,
               qty='간이식소화기 1개 이상', cond='길이 6미터 미만의 모터보트 및 세일링요트'),
            eq('예비노', S_레저등록, ADM, '제111조', '예비노가 비치되어야', notice=N_레저검사,
               qty='2개 이상의 예비노', cond='길이 6미터 미만의 모터보트'),
            eq('구명조끼·구명부환', S_레저등록, ADM, '제120조', '승선정원에 해당하는 수 이상의 구명조끼를 비치해야',
               notice=N_레저검사, qty='승선정원에 해당하는 수 이상의 구명조끼',
               cond='고무보트. 연해구역 이상을 운항구역으로 지정받으려면 구명부환 2개 이상(길이 12미터 미만은 1개 이상)',
               also=['구명부환 2개 이상을 비치해야']),
            eq('간이식소화기', S_레저등록, ADM, '제121조', '간이식소화기 1개 이상이 비치되어야', notice=N_레저검사,
               qty='간이식소화기 1개 이상', cond='고무보트'),
            eq('예비노', S_레저등록, ADM, '제125조', '예비노가 비치되어야', notice=N_레저검사,
               qty='2개 이상의 예비노', cond='고무보트'),
            eq('구명조끼', S_레저등록, ADM, '제134조', '승선정원에 해당하는 수 이상의 구명조끼를 비치해야',
               notice=N_레저검사, qty='승선정원에 해당하는 수 이상의 구명조끼',
               cond='수상오토바이. 어린이를 승선시킬 경우 어린이용 구명조끼 추가'),
        ],
        '보험': [
            ins('등록 대상 동력수상레저기구 소유자의 보험등', S_레저, '법률', '제49조',
                '소유한 날로부터 1개월 이내에 대통령령으로 정하는 바에 따라 보험이나 공제(이하 "보험등"이라 한다)에 가입하여야',
                '등록 대상 동력수상레저기구의 소유자', limit_src=L_위임,
                cond='등록 대상 동력수상레저기구를 소유한 날로부터 1개월 이내. 동력수상레저기구의 사용으로 다른 사람이 '
                     '사망하거나 부상한 경우의 피해자 보상용',
                deleg=[{'법령': '수상레저안전법', '계층': '시행령', '조문': '제30조'}]),
            ins('등록 대상 동력수상레저기구 소유자의 보험등(가입요건)', S_레저, '시행령', '제30조',
                '등록대상 동력수상레저기구의 소유자는 법 제49조제1항에 따라',
                '등록대상 동력수상레저기구의 소유자', kind='가입요건',
                limit='가입금액: 「자동차손해배상 보장법 시행령」 제3조제1항에 따른 금액 이상으로 할 것',
                limit_src=L_본문,
                also=['가입기간: 동력수상레저기구의 등록기간 동안 계속하여 가입할 것'],
                cond='동력수상레저기구의 등록기간 동안 계속 가입'),
        ],
        '추가확인': [],
        'children': [],
    }

    unpowered = {
        'id': 'unpowered_craft', '라벨': '무동력수상레저기구',
        '정의': '동력수상레저기구 외의 수상레저기구로서 대통령령으로 정하는 것',
        'provenance': [prov(S_레저, '법률', '제2조', '"무동력수상레저기구"란', '제2조제5호')],
        '서류': [],
        '메모': '무동력수상레저기구에 비치·소지를 의무화한 서류 조문은 raw에서 확인되지 않았다(조종면허는 동력수상레저기구에만 해당).',
        '장비': [],
        '장비메모': '무동력수상레저기구만을 대상으로 한 장비 비치 수량 조문은 raw에서 확인되지 않았다 — '
                    '「동력수상레저기구 안전검사기준」은 이름 그대로 동력 기구만 다룬다. '
                    '부모(수상레저기구) 노드의 인명안전장비 착용 의무는 그대로 상속된다.',
        '보험': [],
        '보험메모': '무동력수상레저기구만을 대상으로 한 보험 가입의무 조문은 raw에서 확인되지 않았다 — '
                    '수상레저안전법 제49조제1항의 보험은 "등록 대상 동력수상레저기구"에만 걸린다. '
                    '수상레저사업자의 보험(같은 조 제2항)은 부모(수상레저기구) 노드에서 상속된다.',
        '추가확인': [],
        'children': [],
    }

    general = {
        'id': 'general_ship', '라벨': '그 밖의 선박(일반선박)',
        '정의': '어선도 수상레저기구도 아닌 선박 — 선박법에 따라 등록하고 선박안전법에 따라 검사받는 배',
        'provenance': [
            prov(S_선박, '법률', '제1조의2', '"선박"이란 수상 또는 수중에서 항행용으로', '제1조의2제1항'),
            prov(S_선안, '법률', '제3조', '이 법은 대한민국 국민 또는 대한민국 정부가 소유하는 선박에 대하여 적용', '제3조제1항'),
        ],
        '중첩주의': '2단계(여객선·유도선·화물선)는 1단계와 달리 완전 배타가 아니다 — 예컨대 유·도선도 13인 이상 여객을 태울 수 있으면 선박안전법 제2조제10호의 "여객선"에 해당할 수 있다.',
        '질문': '그 배를 어떤 용도로 쓰시나요?',
        '선택지': [
            {'label': '여객선', 'hint': '13인 이상의 여객을 운송할 수 있는 선박 (선박안전법 제2조제10호)', 'next': 'passenger_ship'},
            {'label': '유선·도선', 'hint': '해운법을 적용받지 않는 유락(遊樂)용 유선 또는 내수면·바다목 운송용 도선 (유선 및 도선 사업법 제2조제1호·제2호)', 'next': 'excursion_ferry'},
            {'label': '화물선·그 밖의 선박', 'hint': '화물을 싣고 운송하는 배나 위 어느 것도 아닌 배', 'next': 'cargo_ship'},
        ],
        '서류': [
            doc('선박국적증서 또는 임시선박국적증서', S_선박, '법률', '제10조',
                '선박 안에 갖추어 두지 아니하고는 대한민국 국기를 게양하거나 항행할 수 없다', '필수',
                '한국선박', excl='선박을 시험운전하는 경우 등 대통령령으로 정하는 경우(시행령 제3조)',
                deleg=[{'법령': '선박법', '계층': '시행령', '조문': '제3조'}]),
            doc('국제톤수증서', S_선박, '법률', '제13조',
                '선박 안에 갖추어 두지 아니하고는 그 선박을 국제항해에 종사하게', '조건부',
                '길이 24미터 이상인 한국선박이 국제항해에 종사하는 경우',
                also=['국제톤수증서', '길이 24미터 이상인 한국선박']),
            doc('선박검사증서등(선박검사증서·임시변경증·임시항해검사증서·국제협약검사증서·예인선항해검사증서)',
                S_선안, '법률', '제17조',
                '그 선박 안에 선박검사증서등(전자적 형태의 증서를 포함한다)을 갖추어 두어야', '필수',
                '선박검사증서등을 발급받은 선박',
                also=['선박검사증서', '임시변경증', '임시항해검사증서', '국제협약검사증서', '예인선항해검사증서']),
            doc('항해용 간행물(해도·조석표 등)', S_선안, '법률', '제32조',
                '항해용 간행물을 해양수산부령으로 정하는 바에 따라 선박에 비치', '필수',
                '구체적 종류(해도·조석표·등대표·항로지·항행통보)는 시행규칙 제74조에서 정함',
                also=['해도(海圖)', '조석표(潮汐表)'],
                deleg=[{'법령': '선박안전법', '계층': '시행규칙', '조문': '제74조(종류)·제75조(비치 방법)'}]),
            doc('하역설비검사기록부 등 하역설비 검사 관련 서류', S_선안, '법률', '제35조',
                '하역설비에 대한 검사와 관련된 해양수산부령으로 정하는 서류를 선박에 비치', '조건부',
                '하역설비를 설치한 선박', also=['하역설비검사기록부'],
                deleg=[{'법령': '선박안전법', '계층': '시행규칙', '조문': '제77조제2항(서류의 종류)'}]),
            doc('예인선항해검사증서', S_선안, '법률', '제43조',
                '예인선항해검사증서를 해당 예인선에 비치', '조건부', '예인선'),
            doc('해기사 면허증 또는 승무자격증', S_선직, '법률', '제15조',
                '면허증이나 승무자격증을 선장에게 제출', '조건부',
                '해기사가 선박직원으로 승무하는 경우(선박직원법 제3조제1항 — 한국선박)'),
            doc('선원명부·항해일지·화물에 관한 서류(선박국적증서 포함)', S_선원, '법률', '제20조',
                '선장은 다음 각 호의 서류를 선내에 갖추어 두어야', '조건부',
                '선원법 적용 선박 — 총톤수 5톤 미만 비항해선, 호수·강·항내만 항행하는 선박, 부선 등은 적용 제외(선원법 제3조제1항)',
                also=['선박국적증서', '선원명부', '항해일지', '화물에 관한 서류'],
                deleg=[{'법령': '선원법', '계층': '시행규칙', '조문': '제13조제2항'}]),
            doc('선박검사증서·해도·기관일지·속구목록·승무정원증서 등', S_선원, '시행규칙', '제13조',
                '속구목록', '조건부', '선원법 제20조제1항제5호 위임',
                also=['선박검사증서', '항행하는 해역의 해도', '기관일지', '선박의 승무정원증서']),
            doc('선원명부(선박별)', S_선원, '법률', '제44조',
                '선박별로 선원명부를 작성하여 선박과 육상사무소에 갖추어 두어야', '조건부', '선원법 적용 선박'),
            doc('근로시간·휴식시간·시간외근로 기록 서류', S_선원, '법률', '제62조',
                '시간외근로를 기록할 서류를 선박에 갖추어 두고', '조건부', '선원법 적용 선박'),
            doc('해사노동적합증서 및 해사노동적합선언서', S_선원, '법률', '제136조',
                '해사노동적합증서', '조건부',
                '선원법 제135조에 해당하는 선박(사본 각 1부는 선내 잘 보이는 곳에 게시)'),
            doc('단체협약·취업규칙 등 게시서류 / 이 법을 적은 서류·선원근로계약서 사본 등 비치서류', S_선원, '법률', '제151조',
                '서류를 선박 내의 보기 쉬운 곳에 게시', '조건부', '대통령령으로 정하는 선박소유자',
                also=['단체협약 및 취업규칙을 적은 서류', '다음 각 호의 서류를 선박 내에 갖추어 두어야',
                      '선원근로계약서 사본 1부'],
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제50조의7'}]),
            doc('선박안전관리증서(또는 임시선박안전관리증서) 원본 및 안전관리적합증서 사본', S_해교, '법률', '제51조',
                '선박안전관리증서나 임시선박안전관리증서의 원본과 안전관리적합증서', '조건부',
                '안전관리체제 인증심사 대상 선박'),
            doc('선박평형수관리계획서', S_평형, '법률', '제9조',
                '선박평형수관리계획서를 선박에 비치', '조건부',
                '국제항해에 취항하는 선박(선박평형수관리법 제3조제1항)'),
            doc('선박평형수관리기록부', S_평형, '법률', '제10조',
                '선박평형수관리기록부', '조건부', '국제항해에 취항하는 선박',
                deleg=[{'법령': '선박평형수(船舶平衡水)관리법', '계층': '시행규칙', '조문': '제20조제2항(2년간 선박 비치)'}]),
            doc('전자기록부 적합확인서', S_평형, '법률', '제10조의2',
                '전자기록부 적합확인서를 해당 선박에 비치', '조건부', '선박평형수관리기록부를 전자기록부로 관리하는 경우'),
            doc('승인받은 선박평형수관리설비 도면', S_평형, '법률', '제11조',
                '승인을 받은 도면을 선박에 비치', '조건부', '선박평형수관리설비 형식승인 도면'),
            doc('선박평형수 검사증서', S_평형, '법률', '제12조',
                '검사증서를 받은 경우에는 그 선박에 비치', '조건부', '정기검사 검사증서를 받은 경우'),
            doc('선박보안계획서', S_보안, '법률', '제10조',
                '선박보안계획서', '조건부', '국제항해선박'),
            doc('국제선박보안증서 또는 임시국제선박보안증서 원본', S_보안, '법률', '제12조',
                '국제선박보안증서등"이라 한다)의 원본을 해당 선박에 비치', '조건부', '국제항해선박'),
            doc('선박보안기록부', S_보안, '법률', '제15조',
                '선박보안기록부', '조건부', '국제항해선박(시행규칙 제15조제4항 — 최근 3년간 내용 수록)',
                deleg=[{'법령': '국제항해선박 및 항만시설의 보안에 관한 법률', '계층': '시행규칙', '조문': '제15조제4항'}]),
            doc('선박이력기록부', S_보안, '법률', '제16조',
                '선박이력기록부', '조건부', '국제항해선박'),
            doc('손해배상 보장계약 증명서', S_유배, '법률', '제50조',
                '손해배상 보장계약 증명서를 선박 안에 갖추어 두어야', '조건부',
                '대한민국 국적을 가진 총톤수 1천톤을 초과하는 일반선박(외국적 일반선박은 국내항 입출항·계류시설 이용 시)'),
            doc('해양폐기물 처리대장', S_폐기, '법률', '제21조',
                '처리대장을 작성하여 해당 선박 또는 시설에 비치', '조건부', '해양폐기물관리업자'),
            doc('해양과학조사 허가서 또는 동의서', S_과조, '시행령', '제5조',
                '허가서 또는 동의서를 항시 조사선박내에 비치', '조건부', '허가서·동의서를 교부받은 외국인등의 조사선박'),
            doc('해양수산생명자원 조사·확보 허가증', S_생명, '법률', '제11조',
                '허가증을 비치', '조건부', '허가를 받은 외국인등의 선박'),
        ],
        '장비': [
            eq('로켓낙하산신호', S_선안, ADM, '제102조', '로켓낙하산신호를 비치하여야', notice=N_구명,
               qty=None, qty_src=Q_별표,
               cond='제1종선등(제1종선·제2종선·제3종선 및 제4종선 전부). 호수·하천 및 항내만 항행하는 것은 제외',
               note='수량이 "별표 10에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('구명조끼등(구명조끼·방수복·노출보호복에 부착)', S_선안, ADM, '제101조',
               '구명조끼등을 부착하여야', notice=N_구명, kind='비치', qty_src=Q_없음,
               cond='선박에 비치하는 구명조끼·방수복·노출보호복. 평수구역 이하를 항해구역으로 하는 제4종선은 제외'),
            eq('소방원장구', S_선안, ADM, '제72조', '소방원장구를 용이하게 접근할 수 있는', notice=N_소방,
               qty_src=Q_OCR,
               qty='| 탱커 | 제3종선 및 근해구역이상을 항해구역으로 하는 총톤수 2,000톤이상의 제4종선 | 4조 |',
               cond='선박의 구분(탱커 여부)×항행구역×총톤수로 갈림 — 표 참조',
               note='수량표가 원문에서는 이미지였고 이미지판독(OCR) 전사본이 본문에 이어 붙어 있다(raw가 ⚠REVIEW로 표시). '
                    '표 전체는 인용한 조문 원문을 볼 것.'),
            eq('예비소화제', S_선안, ADM, '제92조', '예비소화제를 비치하여야', notice=N_소방, qty_src=Q_OCR,
               qty='구분: 제1종선 및 제3종선 등 | 비치 비율: 처음 10개에 대하여는 100퍼센트, 10개를 초과하는 것에 대하여는 50퍼센트 비치',
               cond='모든 선박 — 휴대식·간이식 소화기 수에 표의 비율을 곱한 수',
               note='비율표가 이미지판독(OCR) 전사본이다(raw가 ⚠REVIEW로 표시).'),
            # ↓ 2026-08-10 그룹1 독립 감사가 찾아낸 누락 2건(설계 §11.12). 둘 다 「선박설비기준」 —
            #   선박안전법 제26조에 따른 일반기준이라 선박안전법 적용 선박 전반에 걸리므로 general_ship에 둔다(§11.3 규약).
            eq('구명부환(자기점화등 부착) — 도선사용사다리 비치 선박', S_선안, ADM, '제102조',
               '도선사용사다리를 비치하여야', notice=N_설비,
               qty='자기점화등을 갖춘 1개의 구명부환',
               also=['다음 각 호의 설비를 갖추어야', '자기점화등을 갖춘 1개의 구명부환'],
               cond='국제항해에 종사하는 선박 및 국제항해에 종사하지 아니하는 총톤수 1,000톤 이상의 선박'
                    '(도선사를 필요로 하지 아니하는 선박은 제외 — 같은 조 제1항 단서)',
               note='인용은 도선사용사다리 비치 의무를 정한 제1항이다. 구명부환 1개는 같은 조 제2항제3호에 있고 '
                    '`수량조건`에 원문 그대로 담았다 — 제2항은 의무(항 본문)와 품목(각 호)이 떨어져 있어 한 문장으로 '
                    '인용하면 목(가·나·다) 중간에서 끊긴다.'),
            eq('휴대용 소화기(선원대피처)', S_선안, ADM, '제56조의5',
               '휴대용 소화기(1개)', notice=N_설비,
               qty='휴대용 소화기(1개)',
               also=['선원대피처에는 다음 각 호의 요건에 적합한 기본설비 및 비품을 갖추어야'],
               cond='위험해역을 항행하는 선박에 설치하는 선원대피처(같은 기준 제56조의2 — "위험해역"은 「국제항해선박 및 '
                    '항만시설의 보안에 관한 법률 시행규칙」 제17조제3항에 따른 해적위험해역)'),
        ],
        '보험': [
            ins('유류오염 손해배상 보장계약(일반선박·유류저장부선)', S_유배, '법률', '제47조',
                '유류오염 손해배상 보장계약(이하 "손해배상 보장계약"이라 한다)을 체결하여야',
                '다음 각 호의 어느 하나에 해당하는 선박의 소유자', sort='조건부', limit_src=L_위임,
                also=['총톤수 1천톤을 초과하는 대한민국 국적의 일반선박',
                      '200톤 이상의 유류를 저장하는 유류저장부선',
                      '총톤수 1천톤을 초과하는 외국 국적의 일반선박'],
                cond='① 총톤수 1천톤을 초과하는 대한민국 국적의 일반선박(연료유를 싣지 아니한 선박 등 해양수산부령으로 '
                     '정하는 일반선박은 제외) 및 200톤 이상의 유류를 저장하는 유류저장부선 ② 총톤수 1천톤을 초과하는 '
                     '외국 국적의 일반선박으로서 국내항에 입항·출항하거나 국내의 계류시설을 사용하려는 경우(같은 조 제2항)',
                deleg=[{'법령': '유류오염손해배상보장법', '계층': '법률', '조문': '제48조제3항(계약금액 하한)'},
                       {'법령': '유류오염손해배상보장법', '계층': '시행규칙', '조문': '제8조의2(체결대상 제외 선박)'}],
                note='이 트리에 이미 있는 서류 항목 "손해배상 보장계약 증명서"(같은 법 제50조)의 앞단계 의무다 — '
                     '체결(제47조) → 증명서 발급(제49조에서 제18조 준용) → 선박 안에 비치(제50조).'),
            ins('유류오염 손해배상 보장계약의 계약금액 하한(일반선박·유류저장부선)', S_유배, '법률', '제48조',
                '손해배상 보장계약은 다음 각 호의 금액보다 적어서는 아니 된다',
                '일반선박 또는 유류저장부선의 선박소유자', kind='가입요건', sort='조건부',
                limit='일반선박마다 「상법」 제770조제1항제3호에 따른 책임한도액', limit_src=L_본문,
                also=['유류저장부선마다 제8조에 따른 책임한도액'],
                cond='제47조에 따라 손해배상 보장계약을 체결하는 일반선박·유류저장부선',
                note='계약을 체결할 수 있는 보험자등의 범위는 같은 조 제2항이 제15조제2항을 준용한다.'),
            ins('선원 재해보상보험등', S_선원, '법률', '제106조',
                '재해보상을 완전히 이행할 수 있도록 대통령령으로 정하는 보험 또는 공제', '선박소유자',
                sort='조건부',
                limit='보험가입 금액은 승선평균임금 이상으로 하여야 한다', limit_src=L_본문,
                cond='선원법 적용 선박 — 총톤수 5톤 미만 비항해선, 호수·강·항내만 항행하는 선박, 부선 등은 적용 제외'
                     '(선원법 제3조제1항)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제32조(보험·공제의 종류)'}]),
            ins('유기구제보험등', S_선원, '법률', '제42조의2',
                '유기된 선원을 구제하기 위하여 대통령령으로 정하는 보험 또는 공제',
                '대통령령으로 정하는 선박소유자', sort='조건부', limit_src=L_위임,
                cond='국제항해에 종사하는 선박의 선박소유자(선원법 시행령 제5조제1항)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제5조'}],
                note='보장 범위는 같은 조 제2항 각 호(송환비용·송환수당·선상생활에 필요한 재화·서비스 비용)이고, '
                     '가입금액의 하한을 정한 문구는 이 조에 없다.'),
            ins('임금채권보장보험등(또는 기금)', S_선원, '법률', '제56조',
                '지급을 보장하기 위하여 대통령령으로 정하는 보험 또는 공제에 가입하거나 기금을 조성하여야',
                '선박소유자(선박소유자 단체를 포함한다. 이하 이 조에서 같다)', sort='조건부',
                limit='제52조에 따른 임금의 최종 4개월분', limit_src=L_본문,
                also=['제55조에 따른 퇴직금의 최종 4년분'],
                cond='선원법 적용 선박의 선박소유자. 다른 법률에 따라 선원의 체불임금 지급을 보장하기 위한 기금의 '
                     '적용을 받는 선박소유자는 제외(같은 항 단서)',
                deleg=[{'법령': '선원법', '계층': '시행령', '조문': '제18조의3(보험·공제·기금의 종류)'}],
                note='여기의 `보장한도`는 원(₩) 단위 금액이 아니라 "보장해야 하는 체불임금의 최소 범위"다'
                     '(같은 조 제2항 — 임금 최종 4개월분·퇴직금 최종 4년분).'),
            ins('해상특수경비원 무기사용 관련 손해보장 보험', S_해적, '법률', '제36조',
                '그 밖의 손해 등을 보장하는 보험에 가입하여야', '해상특수경비업자와 선박소유자등',
                sort='조건부', limit_src=L_없음,
                cond='위험해역을 통항하는 국제항해선박등(같은 법 제4조 적용범위) — 같은 법 제3조제3항의 '
                     '"선박소유자등"은 국제항해선박등의 소유자·관리자·운영자',
                note='①이 의무는 선박소유자등뿐 아니라 해상특수경비업자에게도 함께 걸린다. 가입된 보험 계약기간은 '
                     '해상특수경비업무 계약 종료 시까지 유지되어야 한다(같은 조 제2항). '
                     '②조문 자체는 "해상특수경비원을 승선시키는 선박"으로 대상을 좁히지 않는다 — 승선 절차는 '
                     '같은 법 제30조가 따로 정한다. ③★어선에도 미칠 수 있다: 같은 법 시행령 제2조는 '
                     '"국제항해선박"을 「선박안전법」 제2조제1호의 선박 정의로 받고(적용제외 조항인 같은 법 제3조가 '
                     '아니다), 같은 법 제30조제4항은 "원양어선의 선박소유자등"을 명시한다. 다만 제36조 본문에 어선을 '
                     '가리키는 문구가 없어 어선 노드에 복제하지 않고 이 주의로만 남긴다(트리 상속 규약상 어선 '
                     '리프에는 상속되지 않는다).'),
        ],
        'children': [],
    }

    passenger = {
        'id': 'passenger_ship', '라벨': '여객선',
        '정의': '13인 이상의 여객을 운송할 수 있는 선박',
        'provenance': [prov(S_선안, '법률', '제2조', '"여객선"이라 함은 13인 이상의 여객을 운송할 수 있는 선박', '제2조제10호')],
        '서류': [
            doc('여객선비상수색구조계획서', S_수색, '법률', '제9조',
                '해당 여객선 및 선박 소유자의 주된 사무실에 비치', '필수',
                '국제항해에 취항하는 여객선 등 — 관할 해양경찰서장에게 신고하고 확인을 받아 비치',
                also=['여객선비상수색구조계획서', '구조본부의 비상연락망']),
            doc('여객선 이력관리장부', S_해운, '시행규칙', '제10조의3',
                '여객선 이력관리장부를 선박 및 사업소에 비치', '조건부', '내항여객운송사업자'),
        ],
        '장비': [
            eq('구명정 및 구명뗏목', S_선안, ADM, '제64조',
               '각현에 최대승선인원의 37.5퍼센트를 수용하는데 충분한 구명정', notice=N_구명,
               qty='각현에 최대승선인원의 37.5퍼센트를 수용하는데 충분한 구명정',
               cond='제1종선(국제항해에 종사하는 여객선). 각 호의 구명정·구명뗏목을 모두 비치',
               also=['각현에 최대승선인원의 12.5퍼센트를 수용하는데 충분한 구명정 또는 구명뗏목',
                     '최대승선인원의 25퍼센트를 수용하는데 충분한 구명뗏목']),
            eq('구조정', S_선안, ADM, '제67조', '구조정을 비치하여야', notice=N_구명,
               qty='총톤수 500톤 이상의 제1종선에는 각현에 1척의 구조정',
               cond='제1종선. 총톤수 500톤 미만이면 1척',
               also=['총톤수 500톤 미만의 제1종선에는 1척의 구조정']),
            eq('구명부환', S_선안, ADM, '제70조', '구명부환을 비치하여야', notice=N_구명,
               qty=None, qty_src=Q_별표, cond='제1종선',
               note='수량이 "별표 5에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('구명조끼', S_선안, ADM, '제71조', '구명조끼를 비치하여야', notice=N_구명,
               qty='제1종선에는 최대승선인원과 같은 수의 구명조끼',
               cond='제1종선 — 어린이용·당직원용·최대승선인원의 5퍼센트 추가분이 각 항으로 더 붙는다',
               also=['최대승선인원의 5퍼센트에 해당하는 구명조끼']),
            eq('방수복·보온구·노출보호복', S_선안, ADM, '제72조', '방수복 또는 노출보호복을 비치하여야',
               notice=N_구명, qty='구조정의 승무원으로 지정되어 있는 사람과 같은 수의 방수복 또는 노출보호복',
               cond='제1종선', also=['각 구명정에는 3벌이상의 방수복']),
            eq('구명줄발사기', S_선안, ADM, '제73조', '구명줄발사기를 비치하여야', notice=N_구명,
               qty='제1종선에는 1개 이상의 구명줄발사기', cond='제1종선'),
            eq('구명정 또는 구명뗏목', S_선안, ADM, '제74조', '구명정 또는 구명뗏목', notice=N_구명,
               qty='최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목',
               cond='근해구역 이상을 항해구역으로 하는 제2종선(국제항해에 종사하지 아니하는 여객선)'),
            eq('구명정 또는 구명뗏목', S_선안, ADM, '제75조', '구명정 또는 구명뗏목을 비치하여야', notice=N_구명,
               qty='최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목',
               cond='연해구역을 항해구역으로 하는 제2종선 — 항해거리 요건을 만족하면 구명뗏목+구명부기/구명부환으로 대체 가능(같은 조 제2항)'),
            eq('구명정·구명뗏목·구명부기 또는 구명부환', S_선안, ADM, '제76조', '구명부기 또는 구명부환을 비치하여야',
               notice=N_구명,
               qty='최대승선인원의 50퍼센트(호수·하천만을 항해하는 제2종선에 있어서는 25퍼센트)를 수용하는데 충분한 구명정·구명뗏목·구명부기 또는 구명부환',
               cond='평수구역을 항해구역으로 하는 제2종선'),
            eq('구조정', S_선안, ADM, '제77조', '구조정을 비치하여야', notice=N_구명,
               qty='근해구역이상을 항해구역으로 하는 제2종선에는 최소한 1척의 구조정',
               cond='근해구역 이상을 항해구역으로 하는 제2종선'),
            eq('구명부환', S_선안, ADM, '제79조', '구명부환을 비치하여야', notice=N_구명,
               qty=None, qty_src=Q_별표, cond='제2종선',
               note='수량이 "별표 6에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('구명조끼', S_선안, ADM, '제80조', '구명조끼를 비치하여야', notice=N_구명,
               qty='제2종선에는 최대승선인원과 같은 수의 구명조끼',
               cond='제2종선 — 어린이용·여객실 외부 10퍼센트 추가분이 각 항으로 더 붙는다',
               also=['최대승선인원의 10퍼센트에 해당하는 추가의 구명조끼를 여객실 외부에 비치']),
            eq('자기점화등·자기발연신호', S_선안, ADM, '제98조', '자기점화등 및 자기발연신호를 비치하여야',
               notice=N_구명, qty=None, qty_src=Q_별표,
               cond='제1종선 및 제2종선. 호수·하천 및 항내만 항행하는 것은 자기발연신호를 비치하지 아니할 수 있다',
               note='수량이 "별표 8에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('소화펌프', S_선안, ADM, '제39조', '소화펌프를 비치하여야', notice=N_소방,
               qty='총톤수 4,000톤 이상의 제1종선 및 제2종선에는 3대',
               cond='제1종선 및 제2종선 — 총톤수·항해구역 구간별로 3대/2대/1대',
               also=['연해구역이하를 항해구역으로 하는 총톤수 1,000톤 미만의 제2종선에는 1대의 소화펌프']),
            eq('거주구역·업무구역·제어장소의 소방설비', S_선안, ADM, '제54조', '소방설비를 비치하여야',
               notice=N_소방, qty_src=Q_OCR,
               qty='총톤수 1,000톤 이상의 제1종선에는 최소한 5개의 휴대식소화기',
               cond='제1종선 및 제2종선(연해구역 이하를 항해구역으로 하는 총톤수 1,000톤 미만의 제2종선은 제외)',
               note='장소별 소화기 종류·수 표가 이미지판독(OCR) 전사본으로 본문에 이어 붙어 있다(raw가 ⚠REVIEW로 표시).'),
            eq('소방원장구', S_선안, ADM, '제56조', '소방원장구를 비치하여야', notice=N_소방,
               qty='소방원장구 2조', cond='제1종선 — 여객구역·업무구역 길이와 주수직구역 수에 따라 조수가 더 붙는다',
               also=['80미터 또는 그 단수마다 소방원장구 2조']),
        ],
        '보험': [
            ins('해상여객운송사업자의 보험 또는 공제', S_해운, '법률', '제4조의3',
                '해상여객운송사업자는 여객 등의 피해에 대비하여 해양수산부령으로 정하는 바에 따라 보험 또는 공제에 가입하여야',
                '해상여객운송사업자', limit_src=L_위임,
                cond='해상여객운송사업자 — 여객 등의 피해 대비',
                deleg=[{'법령': '해운법', '계층': '시행규칙', '조문': '제3조의4'}]),
            ins('해상여객운송사업자의 보험 또는 공제(가입할 수 있는 종류)', S_해운, '시행규칙', '제3조의4',
                '해상여객운송사업자가 가입하여야 하는 보험 또는 공제는 다음 각 호의 어느 하나와 같다',
                '해상여객운송사업자', kind='가입요건', limit_src=L_없음,
                also=['「한국해운조합법」에 따라 설립된 한국해운조합', '선주상호보험조합의 보험'],
                cond='보험회사의 보험 · 한국해운조합의 공제 · 선주상호보험조합의 보험 · 해양수산부장관이 고시한 '
                     '외국 보험·공제 중 하나',
                note='이 조는 가입할 수 있는 보험·공제의 종류만 정하고 가입금액은 정하지 않는다. 가입한 사업자는 '
                     '보험증서 또는 공제증서 사본을 운항개시일 전까지 제출해야 한다(같은 조 제2항).'),
        ],
        '추가확인': [],
        'children': [],
    }

    ferry = {
        'id': 'excursion_ferry', '라벨': '유선·도선',
        '정의': '유선사업(유락용 선박 대여·승선)·도선사업(내수면 또는 바다목 운송)에 쓰이는 선박으로서 해운법을 적용받지 않는 것',
        'provenance': [
            prov(S_유도, '법률', '제2조', '"유선사업"이란', '제2조제1호'),
            prov(S_유도, '법률', '제2조', '"도선사업"이란', '제2조제2호'),
        ],
        '구분근거': [prov(S_유도, '법률', '제2조의2', '이 법은 다음 각 호의 경우에는 적용하지 아니한다', '제2조의2(수상레저사업·낚시어선업·마리나업 적용배제)')],
        '서류': [
            doc('승객 안전 매뉴얼(선실이나 통로에 비치)', S_유도, '법률', '제12조',
                '매뉴얼로 작성하여 유선장 및 행정안전부령 또는 해양수산부령으로 정하는 유선의 선실이나 통로에 비치', '조건부',
                '유선 — 대상 유선은 시행규칙 제13조의2',
                deleg=[{'법령': '유선 및 도선 사업법', '계층': '시행규칙', '조문': '제13조의2'}]),
            doc('승객 안전 매뉴얼(선실이나 통로에 비치)', S_유도, '법률', '제16조',
                '매뉴얼로 작성하여 도선장 및 행정안전부령 또는 해양수산부령으로 정하는 도선의 선실이나 통로에 비치', '조건부',
                '도선 — 대상 도선은 시행규칙 제15조의2',
                deleg=[{'법령': '유선 및 도선 사업법', '계층': '시행규칙', '조문': '제15조의2'}]),
        ],
        '장비': [
            eq('구명조끼(유선)', S_유도, '시행령', '제17조',
               '승선 정원의 120퍼센트 이상에 해당하는 수의 구명조끼',
               qty='승선 정원의 120퍼센트 이상에 해당하는 수의 구명조끼(구명조끼 중 승선 정원의 20퍼센트에 해당하는 수의 구명조끼는 소아용으로 하여야 한다)',
               cond='유선 — 유선사업자가 갖추어야 하는 인명구조용 장비(법 제22조제2항 위임)',
               note='같은 조 제3항: 유선에 갖추어 두어야 하는 인명구조용 장비는 해양수산부장관이 고시하는 '
                    '「선박구명설비기준」에 적합한 것이어야 한다.'),
            eq('구명부환(유선)', S_유도, '시행령', '제17조', '구명부환(救命浮環)을 갖출 것',
               qty='승선 정원이 5명 이상이거나 추진기관을 설치한 유선에는 그 승선 정원의 30퍼센트 이상에 해당하는 수의 구명부환',
               cond='승선 정원 5명 이상이거나 추진기관을 설치한 유선. 구명정·구명뗏목·구명부기를 일정 비율 갖춘 경우 15퍼센트로 완화(같은 호 단서)'),
            eq('구명줄 또는 드로우 백(유선)', S_유도, '시행령', '제17조', '드로우 백(throw bag) 1개 이상을 갖출 것',
               qty='승선 정원이 13명 이상인 유선에는 유선마다 지름 10밀리미터 이상, 길이 30미터 이상의 구명줄 1개 이상이나 드로우 백(throw bag) 1개 이상',
               cond='승선 정원 13명 이상인 유선'),
            eq('소화기(유선)', S_유도, '시행령', '제17조', '1개 이상의 소화기를 갖출 것',
               qty='승선 정원이 13명 이상인 유선에는 유선마다 선실ㆍ조타실 및 기관실별로 1개 이상의 소화기',
               cond='승선 정원 13명 이상인 유선'),
            eq('인명구조용 장비(도선 — 구명조끼·구명부환)', S_유도, '시행령', '제18조',
               '제17조제1항제1호 및 제3호에 해당하는 인명구조용 장비를 갖출 것',
               qty='제17조제1항제1호 및 제3호에 해당하는 인명구조용 장비',
               cond='도선 — 유선의 구명조끼(제17조제1항제1호)·구명부환(제3호) 기준을 그대로 준용'),
            eq('구명줄 또는 드로우 백(도선)', S_유도, '시행령', '제18조', '드로우 백 1개 이상을 갖출 것',
               qty='도선마다 지름 10밀리미터 이상, 길이 30미터 이상의 구명줄 1개 이상이나 드로우 백 1개 이상',
               cond='모든 도선'),
            eq('소화기·소화설비(도선)', S_유도, '시행령', '제18조', '1개 이상의 소화기를 갖추고',
               qty='승객을 주로 운송하는 도선에는 도선마다 선실ㆍ조타실 및 기관실별로 1개 이상의 소화기',
               cond='승객을 주로 운송하는 도선. 화물을 주로 운송하는 도선은 화물 화재를 진압할 수 있는 소화설비'),
        ],
        '보험': [
            ins('유·도선사업자의 보험 또는 공제', S_유도, '법률', '제33조',
                '승객, 선원, 그 밖의 종사자의 피해보상을 위하여 보험 또는 공제에 가입하여야',
                '유ㆍ도선사업자', limit_src=L_위임,
                cond='유·도선사업자 — 승객, 선원, 그 밖의 종사자의 피해보상',
                deleg=[{'법령': '유선 및 도선 사업법', '계층': '시행령', '조문': '제27조'}]),
            ins('유·도선사업자의 보험 또는 공제(가입시기·가입금액)', S_유도, '시행령', '제27조',
                '사업 개시 전까지(보험 또는 공제의 유효기간이 만료되는 경우에는 그 만료일 전까지) 보험 또는 공제에 가입하여야',
                '유ㆍ도선사업자', kind='가입요건',
                limit='보험 또는 공제의 가입금액은 「자동차손해배상 보장법 시행령」 제3조제1항에 따른 금액 이상으로 한다',
                limit_src=L_본문,
                cond='사업 개시 전까지(유효기간 만료 시에는 만료일 전까지) 가입'),
        ],
        '추가확인': [],
        'children': [],
    }

    cargo = {
        'id': 'cargo_ship', '라벨': '화물선·그 밖의 선박',
        '정의': '여객선·유도선이 아닌 선박 — 화물 운송선 등',
        'provenance': [prov(S_선안, '법률', '제2조', '"선박"이라 함은 수상(水上) 또는 수중(水中)에서', '제2조제1호')],
        '질문': '싣는 화물이 산적(散積) 유류인가요?',
        '선택지': [
            {'label': '유조선', 'hint': '산적 유류를 화물로 싣고 운송하기 위해 건조·개조된 항해선(부선 포함) (유류오염손해배상 보장법 제2조제1호)', 'next': 'tanker'},
            {'label': '그 밖의 화물선·선박', 'hint': '유조선·유류저장부선을 제외한 모든 선박 (유류오염손해배상 보장법 제2조제2호 "일반선박")', 'next': 'other_cargo'},
        ],
        '서류': [],
        '장비': [
            eq('구명정 및 구명뗏목', S_선안, ADM, '제82조',
               '각현에 최대승선인원을 수용하는데 충분한 구명정', notice=N_구명,
               qty='각현에 최대승선인원을 수용하는데 충분한 구명정',
               cond='제3종선(여객선 이외의 선박으로서 국제항해에 종사하는 총톤수 500톤 이상). 산적화물선은 제외',
               also=['최대승선인원을 수용하는데 충분한 구명뗏목']),
            eq('구조정', S_선안, ADM, '제84조', '구조정을 비치하여야', notice=N_구명,
               qty='제3종선에는 최소한 1척의 구조정', cond='제3종선'),
            eq('구명부환', S_선안, ADM, '제86조', '구명부환을 비치하여야', notice=N_구명,
               qty=None, qty_src=Q_별표, cond='제3종선',
               note='수량이 "별표 7에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('구명조끼', S_선안, ADM, '제87조', '구명조끼를 비치하여야', notice=N_구명,
               qty='제3종선에는 최대승선인원과 같은 수의 구명조끼',
               cond='제3종선 — 당직원용·추가 구명뗏목 정원분이 제2항으로 더 붙는다'),
            eq('방수복', S_선안, ADM, '제88조', '방수복을 비치하여야', notice=N_구명,
               qty='제3종선에는 최대승선인원과 같은 수의 방수복', cond='제3종선'),
            eq('구명줄발사기', S_선안, ADM, '제89조', '구명줄발사기를 비치하여야', notice=N_구명,
               qty='제3종선에는 최소한 1개의 구명줄발사기', cond='제3종선'),
            eq('구명정 또는 구명뗏목', S_선안, ADM, '제90조', '구명정 또는 구명뗏목', notice=N_구명,
               qty='각현에 최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목',
               cond='근해구역 이상을 항해구역으로 하는 제4종선(여객선 이외의 선박으로서 제3종선 이외의 것)'),
            eq('구명정 또는 구명뗏목', S_선안, ADM, '제91조', '구명정 또는 구명뗏목을 비치하여야', notice=N_구명,
               qty='최대승선인원을 수용하는데 충분한 구명정 또는 구명뗏목',
               cond='연해구역을 항해구역으로 하는 제4종선 — 요건을 만족하면 구명부기·구명부환으로 갈음 가능(같은 조 제2항)'),
            eq('구명부환', S_선안, ADM, '제93조', '구명부환을 비치하여야', notice=N_구명,
               qty='선박길이 30미터이상의 제4종선에는 최소한 4개의 구명부환',
               cond='제4종선 — 선박길이 30미터 이상/미만으로 갈림',
               also=['선박길이 30미터미만의 제4종선에는 최소한 2개의 구명부환']),
            eq('구명조끼', S_선안, ADM, '제94조', '구명조끼를 비치하여야', notice=N_구명,
               qty='제4종선에는 최소한 최대승선인원과 같은 수의 구명조끼', cond='제4종선'),
            eq('자기점화등·자기발연신호', S_선안, ADM, '제99조', '자기점화등 및 자기발연신호를 비치하여야',
               notice=N_구명, qty=None, qty_src=Q_별표,
               cond='제3종선 및 제4종선. 호수·하천 및 항내만 항행하는 것은 자기발연신호를 비치하지 아니할 수 있다',
               note='수량이 "별표 9에 의한 수"인데 이 고시 raw에는 별표 제목만 있고 표 내용이 없다.'),
            eq('소화펌프', S_선안, ADM, '제61조', '소화펌프를 비치하여야', notice=N_소방,
               qty='총톤수 1,000톤 이상의 것에는 2대 이상',
               cond='제3종선등(제3종선 및 근해구역 이상을 항해구역으로 하는 제4종선) — 총톤수 구간별',
               also=['총톤수 300톤 이상의 제4종선']),
            eq('화물구역의 소방설비', S_선안, ADM, '제65조', '고정식가스소화장치 또는 고정식고팽창포말소화장치를 설치하여야',
               notice=N_소방, kind='비치', qty_src=Q_없음,
               cond='총톤수 2,000톤 이상의 제3종선 또는 제4종선으로서 탱커 외의 것'),
            eq('거주구역·업무구역·제어장소의 소방설비', S_선안, ADM, '제71조', '소방설비를 비치하여야',
               notice=N_소방, qty_src=Q_OCR,
               qty='거주구역 및 업무구역에 비치하여야 할 소화기의 수는 5개 이상',
               cond='총톤수 1,000톤 이상의 제3종선등. 그 밖의 선박은 제3항의 총톤수 구간별 휴대식소화기 표',
               note='장소별 소화기 표와 총톤수별 휴대식소화기 표가 모두 이미지판독(OCR) 전사본으로 본문에 이어 붙어 있다(raw가 ⚠REVIEW로 표시).'),
        ],
        '보험': [
            ins('내항 화물운송사업 등록조건으로 붙는 보험 또는 공제', S_해운, '시행규칙', '제16조의3',
                '여객, 선원 및 선박의 피해에 대비하여 제3조의4제1항 각 호에 따른 보험 또는 공제에 가입할 것',
                '내항 화물운송사업의 등록을 하는 경우', kind='가입요건', sort='조건부', limit_src=L_없음,
                also=['「유류오염손해배상 보장법」에 따라 유류를 운송하는 선박의 경우에는 유류오염 손해배상 보장계약의 체결'],
                cond='석유제품 및 석유화학제품을 운송하지 않는 총톤수 100톤 미만의 선박과 부선(艀船)은 제외하며, '
                     '최초 운항 전까지 가입하도록 할 수 있다(같은 호 단서)',
                note='★이 조는 "지방해양수산청장은 … 다음 각 호의 사항을 조건으로 붙일 수 있다"는 재량 규정이다 — '
                     '법이 곧바로 모든 화물선에 보험 가입을 명하는 조문이 아니라, 내항 화물운송사업 등록 시 '
                     '조건으로 부과될 수 있는 사항이다. 답변에 쓸 때 이 성격을 반드시 함께 밝혀야 한다. '
                     '`가입대상` 칸에 사람이 아닌 문구가 들어간 것도 같은 이유다 — 이 조문은 의무 주체를 직접 '
                     '적지 않고 "등록을 하는 경우"의 조건으로만 쓰기 때문에, 주체를 지어내지 않고 원문 문구를 그대로 뒀다.'),
            ins('항로표지 설치·관리 및 위탁관리업 선박의 보험 또는 공제', S_항표, '법률', '제23조의2',
                '승선한 사람의 피해를 보전하기 위하여 대통령령으로 정하는 바에 따라 보험이나 공제에 가입하여야',
                '항로표지 설치ㆍ관리 및 위탁관리업에 이용되는 선박의 소유자 또는 임차인',
                sort='조건부', limit_src=L_위임,
                cond='항로표지 설치·관리 및 위탁관리업에 이용되는 선박',
                deleg=[{'법령': '항로표지법', '계층': '시행령', '조문': '제13조의2'}],
                note='조문은 선박의 종류·크기를 한정하지 않고 "항로표지 설치·관리 및 위탁관리업에 이용되는 선박"이라는 '
                     '용도로만 대상을 정한다. 이 트리에서는 여객선·유·도선이 아닌 배가 모이는 이 노드에 달았다 '
                     '(설계 §12.4 매핑표).'),
            ins('항로표지 설치·관리 및 위탁관리업 선박의 보험 또는 공제(가입요건)', S_항표, '시행령', '제13조의2',
                '항로표지 설치ㆍ관리 및 위탁관리업에 이용되는 선박의 소유자나 임차인은 법 제23조의2제1항에 따라',
                '항로표지 설치ㆍ관리 및 위탁관리업에 이용되는 선박의 소유자나 임차인',
                kind='가입요건', sort='조건부',
                limit='보상한도액: 「자동차손해배상 보장법 시행령」 제3조제1항에 따른 금액 이상으로 할 것',
                limit_src=L_본문,
                also=['가입기간: 항로표지의 설치ㆍ관리 기간 또는 위탁관리 계약기간 동안 계속하여 가입할 것'],
                cond='피보험자·피공제자는 항로표지 설치·관리 또는 위탁관리업에 종사하는 사람'),
        ],
        'children': [],
    }

    tanker = {
        'id': 'tanker', '라벨': '유조선',
        '정의': '산적 유류를 화물로 싣고 운송하기 위하여 건조되거나 개조된 모든 형태의 항해선(부선 포함)',
        'provenance': [prov(S_유배, '법률', '제2조', '"유조선"이란', '제2조제1호')],
        '서류': [
            doc('보장계약 증명서', S_유배, '법률', '제20조',
                '보장계약 증명서를 선박 안에 갖추어 두어야', '조건부',
                '200톤 이상의 산적 유류를 화물로 싣고 운송하는 유조선(외국적 유조선은 국내항 입출항·계류시설 사용 시 책임협약 서면)'),
            doc('선박대선박 기름화물이송계획서', S_해환, '법률', '제32조의2',
                '선박대선박 기름화물이송계획서', '조건부', '해상에서 유조선 간에 기름화물을 이송하려는 경우'),
            doc('휘발성유기화합물관리계획서', S_해환, '법률', '제47조의2',
                '휘발성유기화합물관리계획서', '조건부', '원유를 운송하는 유조선'),
        ],
        '장비': [
            eq('화물펌프실의 고정식 소화장치', S_선안, ADM, '제70조',
               '고정식가스소화장치·고정식고팽창포말소화장치 또는 고정식가압수분무소화장치를 비치하여야',
               notice=N_소방, kind='비치', qty_src=Q_없음,
               cond='총톤수 2,000톤(유탱커의 경우에는 총톤수 500톤) 이상의 제3종선 및 제4종선으로서 탱커인 것'),
            eq('인화성고압가스를 운송하는 유탱커의 소방설비', S_선안, ADM, '제86조', '소방설비를 비치하여야',
               notice=N_소방, kind='비치', qty_src=Q_없음,
               cond='인화성고압가스를 운송하는 유탱커 — 고정식가스소화장치·살수장치·휴대식소화기 등 각 호의 설비'),
        ],
        '보험': [
            ins('유류오염 손해배상 보장계약(유조선)', S_유배, '법률', '제14조',
                '유류오염 손해배상 보장계약(이하 "보장계약"이라 한다)을 체결하여야',
                '대한민국 국적을 가진 유조선으로 200톤 이상의 산적 유류를 화물로 싣고 운송하는 유조선의 선박소유자',
                sort='조건부', limit_src=L_위임,
                also=['대한민국 국적을 가진 선박 외의 유조선으로서 200톤 이상의 산적 유류를 화물로 싣고 국내항에 '
                      '입항ㆍ출항하거나 국내의 계류시설을 사용하려는 유조선의 선박소유자'],
                cond='① 대한민국 국적 유조선으로 200톤 이상의 산적 유류를 화물로 싣고 운송하는 경우 ② 외국적 유조선으로 '
                     '200톤 이상의 산적 유류를 싣고 국내항에 입항·출항하거나 국내 계류시설을 사용하려는 경우(같은 조 제2항)',
                deleg=[{'법령': '유류오염손해배상보장법', '계층': '법률', '조문': '제15조제3항(계약금액 하한)'},
                       {'법령': '유류오염손해배상보장법', '계층': '시행규칙', '조문': '제2조(보장계약을 체결하는 자)'}],
                note='이 트리에 이미 있는 서류 항목 "보장계약 증명서"(같은 법 제20조)의 앞단계 의무다 — '
                     '체결(제14조) → 증명서 발급(제18조) → 선박 안에 비치(제20조). 위반하면 항행정지를 명할 수 있다(같은 조 제3항).'),
            ins('유류오염 손해배상 보장계약의 보험자등·계약금액 하한(유조선)', S_유배, '법률', '제15조',
                '재정능력이 있는 해양수산부령으로 정하는 보험자등과 보장계약을 체결하여야',
                '유조선의 선박소유자', kind='가입요건', sort='조건부',
                limit='보험금액 또는 배상의무이행담보금액은 유조선마다 제8조에 따른 책임한도액보다 적어서는 아니 된다',
                limit_src=L_본문,
                cond='제14조에 따라 보장계약을 체결하는 유조선',
                deleg=[{'법령': '유류오염손해배상보장법', '계층': '시행규칙', '조문': '제2조'}],
                note='보장계약은 책임협약 제7조제5항에 적합한 경우에 한정하여 효력을 상실하게 하거나 내용을 변경할 수 '
                     '있어야 한다(같은 조 제4항).'),
        ],
        '추가확인': [],
        'children': [],
    }

    other_cargo = {
        'id': 'other_cargo', '라벨': '그 밖의 화물선·선박',
        '정의': '유조선과 유류저장부선을 제외한 모든 선박(유류오염손해배상 보장법상 "일반선박")',
        'provenance': [prov(S_유배, '법률', '제2조', '"일반선박"이란 유조선과 유류저장부선을 제외한 모든 선박', '제2조제2호')],
        '서류': [],
        '메모': '이 리프에만 붙는 고유 서류는 raw에서 확인되지 않았다. 필요한 서류는 부모(그 밖의 선박·선박) 노드에서 상속된다.',
        '장비': [],
        '장비메모': '이 리프에만 붙는 고유 장비 요건은 raw에서 확인되지 않았다 — 「선박구명설비기준」·「선박소방설비기준」의 '
                    '제3종선·제4종선 요건을 부모(화물선·그 밖의 선박) 노드에서 그대로 상속한다.',
        '보험': [],
        '보험메모': '이 리프에만 붙는 고유 보험 가입의무는 raw에서 확인되지 않았다. 유류오염 손해배상 보장계약'
                    '(유류오염손해배상 보장법 제47조)은 이 리프의 정의와 같은 "일반선박"을 대상으로 하지만, 조문상 '
                    '여객선·유·도선도 일반선박에 포함되므로 서류 항목 "손해배상 보장계약 증명서"(제50조)와 같은 자리인 '
                    '부모(그 밖의 선박) 노드에 두어 상속되게 했다.',
        '추가확인': [],
        'children': [],
    }

    fishing['children'] = [angling, other_fish]
    leisure['children'] = [powered, unpowered]
    cargo['children'] = [tanker, other_cargo]
    general['children'] = [passenger, ferry, cargo]
    root['children'] = [fishing, leisure, general]

    # 리프의 잔여 축(추가확인) — 트리로 안 쪼갠 조건을 되묻기가 이어서 물을 수 있게 문구까지 데이터로.
    intl = {
        '축': '국제항해',
        '질문': '이 선박이 국제항해에 종사하나요?',
        '선택지': [{'label': '국제항해'}, {'label': '국내항해만'}],
        '영향': ['국제톤수증서', '선박보안계획서', '국제선박보안증서 또는 임시국제선박보안증서 원본',
                 '선박보안기록부', '선박이력기록부', '선박평형수관리계획서', '선박평형수관리기록부',
                 '선박평형수 검사증서', '선박에너지효율관리계획서', '해사노동적합증서 및 해사노동적합선언서'],
    }
    tonnage = {
        '축': '총톤수·길이',
        '질문': '선박의 총톤수(또는 길이)는 어느 정도인가요?',
        '선택지': [{'label': '총톤수 1천톤 초과'}, {'label': '총톤수 400톤 이상'},
                   {'label': '길이 24미터 이상'}, {'label': '그 미만'}],
        '영향': ['국제톤수증서', '손해배상 보장계약 증명서', '선박에너지효율관리계획서'],
    }
    for lf in (passenger, ferry, tanker, other_cargo):
        lf['추가확인'] = [intl, tonnage]
    # 어선 계열 공통 잔여 축 — 선원법 제3조제1항제3호(총톤수 20톤 미만 어선 중 해수부령으로 정하는
    # 선박은 선원법 적용 제외)가 상속되는 서류 2건을 켜고 끄므로, 두 리프 모두에 붙인다.
    fish_axis = {
        '축': '선원법 적용',
        '질문': '그 어선의 총톤수가 20톤 이상인가요?',
        '선택지': [{'label': '20톤 이상'}, {'label': '20톤 미만'}],
        '영향': ['선원명부·항해일지·화물에 관한 서류(선박국적증서 포함)',
                 '선박검사증서·해도·기관일지·속구목록·승무정원증서 등'],
    }
    angling['추가확인'] = [fish_axis]
    other_fish['추가확인'] = [fish_axis]

    # ── 장비 축 확장(설계 §11.9) — 트리 노드는 그대로 두고, 장비 요건을 실제로 가르는
    #    잔여 축만 리프의 `추가확인`에 "추가"한다. 기존 축(국제항해·톤수·선원법)은 손대지 않는다.
    nav_axis = {
        '축': '항해구역',
        '질문': '그 배의 항해구역은 어디인가요?',
        '선택지': [{'label': '평수구역'}, {'label': '연해구역'}, {'label': '근해구역 이상'}],
        '영향': ['구명정 및 구명뗏목', '구명정 또는 구명뗏목', '구명정·구명뗏목·구명부기 또는 구명부환',
                 '구조정', '소화펌프', '거주구역·업무구역·제어장소의 소방설비', '소방원장구'],
    }
    for lf in (passenger, tanker, other_cargo):
        lf['추가확인'] = lf['추가확인'] + [nav_axis]
    fish_len_axis = {
        '축': '배의 길이·총톤수',
        '질문': '그 어선의 배의 길이(또는 총톤수)는 어느 정도인가요?',
        '선택지': [{'label': '길이 20미터 이상'}, {'label': '길이 20미터 미만'},
                   {'label': '총톤수 10톤 미만(소형어선)'}],
        '영향': ['구명정 또는 구명뗏목', '구명부환', '자기점화등·자기발연신호', '로켓낙하산신호',
                 '소화펌프', '휴대식소화기(거주구역·업무구역)', '소방원장구',
                 '구명설비(종류·수량)', '소화기'],
    }
    angling['추가확인'] = angling['추가확인'] + [fish_len_axis]
    other_fish['추가확인'] = other_fish['추가확인'] + [fish_len_axis]
    craft_axis = {
        '축': '기구 종류·운항구역',
        '질문': '어떤 동력수상레저기구이고, 운항구역은 어디인가요?',
        '선택지': [{'label': '모터보트'}, {'label': '세일링요트'}, {'label': '고무보트·수상오토바이'}],
        '영향': ['구명뗏목', '구명부환', '구명조끼', '자기발연신호·자기점화등', '휴대식소화기',
                 '간이식소화기', '예비노', '구명조끼·구명부환'],
    }
    powered['추가확인'] = powered['추가확인'] + [craft_axis]
    ferry['추가확인'] = ferry['추가확인'] + [{
        '축': '승선 정원',
        '질문': '그 유선·도선의 승선 정원은 몇 명인가요?',
        '선택지': [{'label': '13명 이상'}, {'label': '5명 이상 13명 미만'}, {'label': '5명 미만'}],
        '영향': ['구명부환(유선)', '구명줄 또는 드로우 백(유선)', '소화기(유선)'],
    }]
    return root


def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def validate(root):
    """§6 검증 3·4번 — provenance 존재, 질문·선택지 무결성, next 참조 무결성."""
    ids = {n['id'] for n in walk(root)}
    for n in walk(root):
        if not n.get('provenance') or any(p is None for p in n['provenance']):
            ERRORS.append('provenance 없음/실패: %s' % n['id'])
        if any(d is None for d in n.get('서류', [])):
            ERRORS.append('서류 항목 빌드 실패 포함: %s' % n['id'])
        if any(d is None for d in n.get('장비', [])):
            ERRORS.append('장비 항목 빌드 실패 포함: %s' % n['id'])
        if any(d is None for d in n.get('보험', [])):
            ERRORS.append('보험 항목 빌드 실패 포함: %s' % n['id'])
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
            if any(k in n for k in ('추가확인',)) and n['추가확인']:
                ERRORS.append('비-리프에 추가확인이 붙음: %s' % n['id'])
        else:
            if n.get('질문') or n.get('선택지'):
                ERRORS.append('리프에 질문/선택지가 붙음: %s' % n['id'])
        _ = ids


def main():
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
    entries = [d for n in nodes for d in n.get('서류', [])]
    per_law = {}
    for d in entries:
        per_law[d['근거법령_slug']] = per_law.get(d['근거법령_slug'], 0) + 1

    # ── 장비 축(설계 §11) 집계 — 서류 집계는 위쪽 그대로 두고 따로 센다.
    adm_scan = scan_admrul_corpus()
    eq_entries = [(n, d) for n in nodes for d in n.get('장비', [])]
    eq_per_node, eq_per_law, eq_per_notice = {}, {}, {}
    for n, d in eq_entries:
        eq_per_node[n['id']] = eq_per_node.get(n['id'], 0) + 1
        eq_per_law[d['근거법령_slug']] = eq_per_law.get(d['근거법령_slug'], 0) + 1
        src = d.get('고시명') or ('%s %s' % (d['근거법령'], d['계층']))
        eq_per_notice[src] = eq_per_notice.get(src, 0) + 1

    # ── 보험 축(설계 §12) 집계 — 서류·장비 집계는 위쪽 그대로 두고 따로 센다.
    ins_scan = scan_insurance_corpus()
    ins_entries = [(n, d) for n in nodes for d in n.get('보험', [])]
    ins_per_node, ins_per_law = {}, {}
    for n, d in ins_entries:
        ins_per_node[n['id']] = ins_per_node.get(n['id'], 0) + 1
        ins_per_law[d['근거법령_slug']] = ins_per_law.get(d['근거법령_slug'], 0) + 1

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 파일럿 — 74법 raw 전수 스캔으로 만든 "선박종류 × 선박에 비치·구비하는 서류" 계층 트리. '
                 '설계·방법론·연동설계는 _dashboard/H32_vessel_doc_tree_design.md 참조.',
        'semantics': {
            '서류_상속': '어떤 선박에 필요한 서류 = 루트에서 그 리프까지 경로상 모든 노드의 `서류`를 합집합으로 모은 것. '
                         '같은 서류를 리프마다 복제하지 않기 위한 규약이다.',
            '질문_선택지': '비-리프 노드의 `질문`/`선택지`는 decideClarify()가 즉석 생성하지 않고 그대로 꺼내 쓰라고 미리 박아둔 데이터다. '
                           '`선택지[].next`는 그 노드의 자식 id.',
            '추가확인': '리프의 잔여 축(국제항해·톤수 등) — 트리 레벨로 쪼개지 않은 조건을 되묻기가 이어서 물을 수 있게 문구까지 담았다.',
            '장비_상속': '어떤 선박에 필요한 안전장비 = 루트에서 그 리프까지 경로상 모든 노드의 `장비`를 합집합으로 모은 것 '
                         '— 서류와 완전히 같은 규약이다(설계 §11.2).',
            '장비_수량출처': '`수량조건`은 raw 원문의 부분문자열이며 빌더가 매번 원문에서 다시 찾아 검증한다. '
                             '`수량출처`가 "별표·표(raw 미수집)"이면 `수량조건`은 반드시 null — "몇 개인지 모른다"를 '
                             '그대로 남긴 것이지 요건이 없다는 뜻이 아니다(설계 §11.6).',
            '장비_요건유형': '비치수량(몇 개를 갖춰야 하는가) · 비치(수량 규정 없이 갖출 의무) · 착용(사람이 착용할 의무).',
            '보험_상속': '어떤 선박에 필요한 보험 = 루트에서 그 리프까지 경로상 모든 노드의 `보험`을 합집합으로 모은 것 '
                         '— 서류·장비와 완전히 같은 규약이다(설계 §12.2).',
            '보험_가입대상': '`가입대상`은 "누가/어떤 배가 들어야 하는가"이며 raw 원문의 부분문자열이다(빌더가 매번 다시 찾아 '
                             '검증한다). 요약·의역이 아니라 조문이 쓴 말 그대로다 — 대상을 요약하다 틀리면 곧바로 오답이 되기 때문.',
            '보험_보장한도': '`보장한도`는 가입금액의 하한 등 조문이 정한 한도이며, null이 아니면 그 조문 원문의 부분문자열이다. '
                             '금액을 다른 조문·하위법령에 위임했으면 null + `보장한도출처`="다른 조문·하위법령 위임…"으로, '
                             '애초에 금액 규정이 아니면 null + "해당없음(금액 규정 아님)"으로 남긴다(설계 §12.5).',
            '보험_요건유형': '가입의무(가입 자체를 명하는 조문) · 가입요건(들 수 있는 보험의 종류·금액·기간·피보험자를 정하는 조문).',
        },
        'caveats': [
            '1단계 분기(어선/수상레저기구/그 밖의 선박)만 조문상 배타성이 확인됐다(선박안전법 제3조제1항제2호의2·같은 법 시행령 제2조제1항제2호). '
            '2단계(여객선·유도선·화물선)는 중첩 가능하며 해당 노드에 `중첩주의`로 표시했다.',
            '총톤수·길이·국제항해·화물종류·항해구역은 트리 레벨이 아니라 서류 항목의 `조건`과 리프의 `추가확인`으로만 표현된다.',
            '`조건`은 원문 문구를 옮긴 것이지 우리가 해석해 정규화한 값이 아니다 — 톤수 구간 등을 프로그램이 판정하려면 별도 파싱이 필요하다.',
            '행정규칙(고시) 665개 파일도 스캔했으나, 고시의 "비치" 문장은 대부분 설비(구명부환·해도 등) 기준이라 서류 항목으로 채택된 것이 없다. '
            '트리의 모든 항목은 법률·시행령·시행규칙 계열에서 나왔다.',
            '「수상레저기구의 등록 및 검사에 관한 법률」에는 등록증·안전검사증을 기구에 비치하라는 명시 조문이 raw에서 확인되지 않았다(발급·재발급·반납 조문만 존재). '
            '없는 의무를 지어내지 않고 그대로 남긴다 — 실제로 없는 것인지 우리가 못 찾은 것인지는 소관부서 확인이 필요하다.',
            '이 트리는 "raw 원문에 비치·구비 의무가 문장으로 적혀 있는 서류"만 담는다. 실무 관행·별지 서식으로만 존재하는 서류는 원리적으로 잡지 못한다.',
            '자치법규(raw/_자치법규/)·국제협약 텍스트·별표 디렉토리는 이번 스캔 대상이 아니다.',
            '군함·경찰용 선박·인력만으로 운전하는 선박 등 선박안전법 제3조제1항 각 호의 적용제외 선박은 트리 노드로 만들지 않았다(비치서류 요건 자체가 없거나 별도 체계).',
            '★[장비 축] 위 4번 caveat의 "트리의 모든 항목은 법률·시행령·시행규칙 계열에서 나왔다"는 서류 항목에 대한 말이다. '
            '2026-08-10에 더한 `장비` 항목은 반대로 대부분 고시(행정규칙)에서 나왔다 — 「선박구명설비기준」·「선박소방설비기준」·'
            '「어선설비기준」·「총톤수 10톤 미만 소형어선의 구조 및 설비기준」·「동력수상레저기구 안전검사기준」.',
            '★[장비 축] 담은 것은 "무엇을 몇 개 갖춰야 하는가"뿐이다. 장비의 성능·구조·재료 요건(예: 구명부환은 담수 중에서 '
            '14.5킬로그램의 철편을 달고…)과 비치 장소·방법(양현에 비치 등), 정비·유효기간은 담지 않았다 — 선박종류 축으로 갈리지 '
            '않는 제품 규격이라 이 트리의 축이 아니다(설계 §11.1).',
            '★[장비 축·별표 한계] 수량이 별표·표에만 있고 그 표가 raw에 없는 항목이 있다 — 「선박구명설비기준」 제70조·제79조·'
            '제86조(제1·2·3종선 구명부환, 별표 5·6·7), 제98조·제99조(자기점화등, 별표 8·9), 제102조(로켓낙하산신호, 별표 10), '
            '「총톤수 10톤 미만 소형어선의 구조 및 설비기준」 제52조(별표 3)·제59조(소화기 표). 이 고시 파일들은 별표 제목만 '
            '수집돼 있고 표 내용이 없다. 해당 항목은 `수량조건: null` + `수량출처: "별표·표(raw 미수집)"`로 남겼다 — 몇 개인지는 '
            '이 자산으로 답할 수 없다.',
            '★[장비 축·OCR 한계] 반대로 「어선설비기준」 제104조, 「선박소방설비기준」 제54조·제71조·제72조·제92조는 표가 '
            '이미지였는데 이미지판독(OCR) 전사본이 조문 본문에 이어 붙어 있어 값을 읽을 수 있었다. 다만 raw 자체가 그 값을 '
            '"⚠REVIEW 처벌·금액·수치는 사람확인 필요"로 표시하고 있다 — `수량출처: "조문본문 표(이미지판독·⚠REVIEW)"`인 항목은 '
            '사람이 원본 이미지로 다시 확인해야 한다.',
            '★[장비 축·중첩] 「선박구명설비기준」의 제3·4종선은 "여객선 이외의 선박"이라 문언상 여객선이 아닌 유·도선도 포함될 수 '
            '있다. 그러나 유·도선의 인명구조용 장비는 「유선 및 도선 사업법 시행령」 제17조·제18조가 따로 정하고(그 제17조제3항이 '
            '「선박구명설비기준」 적합성을 요구), 트리에서 유선·도선 노드는 화물선 노드의 형제라 상속되지 않는다. 이 중첩을 '
            '모른 척하지 않고 그대로 적어 둔다.',
            '★[장비 축·계열] 착수 지시는 고시(행정규칙) 전수 스캔이었으나, 유·도선의 장비 수량은 고시가 아니라 「유선 및 도선 '
            '사업법 시행령」 제17조·제18조(대통령령)에 있어 그대로 담았다. 낚시어선 구명조끼 착용(「낚시 관리 및 육성법」 제29조)·'
            '수상레저활동 인명안전장비 착용(「수상레저안전법」 제20조)도 같은 이유로 담았다. 법률계열 장비 항목은 이 4건뿐이며 '
            '`계층` 필드로 구분된다(설계 §11.4).',
            '★[장비 축·2026-08-10 보완] 그룹1 독립 감사(`H32_audit_group1_report.md`)가 「선박설비기준」의 수량 요건 2건이 '
            '빠졌다고 지적해 그대로 더했다 — 제102조(도선사용사다리를 비치하는 선박의 "자기점화등을 갖춘 1개의 구명부환")와 '
            '제56조의5(선원대피처의 "휴대용 소화기(1개)"). 둘 다 general_ship에 넣었다. '
            '왜 처음에 빠졌나(정직 기록): ①제56조의5는 의무 동사가 항 본문("…갖추어야 한다")에 있고 장비명은 각 호에 있어, '
            '고시 스캔이 "한다." 뒤에서 문장을 끊는 바람에 어휘×동사 2중 조건을 한 문장 안에서 만족하지 못해 후보에 잡히지 '
            '않았다(구조적 원인). ②제102조는 반대로 스캔 후보에는 잡혔고 「선박설비기준」도 `equipment_scan.'
            'notices_with_candidates`에 올라 있었는데, 33개 후보 고시 중 8종만 채택하는 단계에서 이 고시를 검토하지도 '
            '제외 사유를 적지도 않은 채 지나쳤다 — 다른 미채택 고시는 전부 사유를 남겼으므로 이 자산의 원칙에서 벗어난 '
            '누락이었다(문서화 실패).',
            '★[장비 축·「선박설비기준」 전수확인] 위 보완과 함께 같은 원인(각 호 분리)으로 더 빠진 것이 있는지 이 고시 163개 '
            '조문을 조 단위(문장 단위가 아니라)로 다시 훑었다. 어휘×동사가 같은 조 안에 있는 조문은 9개였고, 그중 새로 담을 '
            '것은 위 2건뿐이다 — 제13조(객석설비)·제15조(여객실 출입구)·제48조·제51조(탈출설비)·제53조(비상조명장치)는 '
            '구명설비를 "언급"할 뿐 탈출로·조명 구조 요건이라 수량 요건이 아니고, 제143조·제144조(제5편 제5장 잠수설비 — '
            '내압동체 내의 구명조끼·소화기)는 배가 아니라 모선에 실린 잠수설비에 갖추는 것이라 담지 않았다'
            '(`unmapped.장비_유형_단위` 참조 — 이 판단은 뒤집힐 수 있어 사유를 남긴다).',
            '★[장비 축·미채택] 「소형선박의 구조 및 설비기준」·「플레저보트 검사기준」·「범선의 구조 및 설비 등에 관한 기준」 등 '
            '선박안전법의 다른 선종별 고시와, 「유ㆍ도선의 규격 및 시설ㆍ설비기준」(설비 세부기준이 별표에 있고 그 별표는 점검 '
            '항목표라 수량 규정이 아님)은 이번 라운드에 담지 않았다 — 트리 리프와 1:1로 맞는 선종 축이 아니거나 수량 요건이 아니다. '
            '`unmapped.장비_유형_단위` 참조.',
            '★[보험 축] 담은 것은 "어떤 배·어떤 사업자가 무슨 보험·공제에 들어야 하는가"와 그 조문이 정한 가입요건·보장한도뿐이다. '
                '보험금 지급·청구 절차, 보험료·보험료율 산정, 보험사업 운영·감독(수산업협동조합 공제사업 감독기준 등), '
                '미가입에 대한 과태료는 담지 않았다 — 선박 종류 축으로 갈리지 않거나 다른 자산(A 처벌강도)의 소관이다.',
            '★[보험 축·유배법과 기존 서류의 관계] 이 트리에는 「유류오염손해배상 보장법」의 보장계약 "증명서 비치" 서류 2건'
                '(제20조·제50조)이 이미 있었다. 이번에 더한 것은 그 앞단계인 "계약 체결" 의무(제14조·제47조)와 계약금액 하한'
                '(제15조·제48조)이며, 기존 서류 2건은 한 글자도 바꾸지 않았다 — 같은 배에 대해 체결(보험)·비치(서류) 두 항목이 '
                '함께 뜨는 것은 중복이 아니라 서로 다른 의무다.',
            '★[보험 축·재량 규정] 「해운법 시행규칙」 제16조의3제1호(내항 화물운송사업 등록조건)는 "지방해양수산청장은 … '
                '조건으로 붙일 수 있다"는 재량 규정이라, 법이 곧바로 모든 화물선에 보험을 명하는 조문이 아니다. 그럼에도 '
                '화물선에 실제로 걸리는 유일한 보험 규정이라 담고 항목 `주의`에 그 성격을 적었다 — 답변에 쓸 때 반드시 함께 밝혀야 한다.',
            '★[보험 축·"당연가입"] 「어선원 및 어선 재해보상보험법」 제16조제1항은 "가입하여야 한다"가 아니라 "당연히 …보험가입자가 '
                '된다"라고 정한다(신청 없이 법으로 보험관계가 성립). 같은 법 제49조의 어선보험(어선재해보상보험)은 "가입할 수 '
                '있다"는 임의가입이라 이 트리에 담지 않았다 — `unmapped.보험_유형_단위` 참조.',
            '★[보험 축·사업자만의 의무] 트리에 대응 노드가 없는 사업자에게 걸리는 보험 가입의무는 담지 않았다 — 마리나업 '
                '등록사업자(마리나항만법 제28조의8), 연안체험활동 운영자(연안사고예방법 제13조), 어선중개업자(어선법 제31조의9), '
                '선박관리업자(해운법 제34조), 구난업자(수색구조법 제20조), 수상구조사 교육기관(같은 법 제30조의9) 등. '
                '전부 `unmapped.보험_법_단위`에 사유와 함께 남겼다 — "없다"가 아니라 "이 트리의 축이 아니다"라는 뜻이다.',
            '★[보험 축·중복 배치] 선원법의 보험 3종(재해보상·유기구제·임금채권보장)은 어선과 그 밖의 선박에 모두 걸리므로 '
                '두 노드에 각각 달았다(조건 문구만 각 노드의 적용제외에 맞게 다르다). 이는 서류 축이 선원법 제20조를 '
                '같은 방식으로 두 노드에 나눠 단 것과 같은 규약이다 — 루트에 올리지 않은 이유는 수상레저기구 계열에는 '
                '선원법이 그대로 걸리지 않기 때문이다.',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned': scan['files'],
            'articles_scanned': scan['articles'],
            'scan_candidates': scan['candidates'],
            'laws_with_scan_candidates': len(scan['laws_with_candidates']),
            'laws_without_scan_candidates': len(LAWS) - len(scan['laws_with_candidates']),
            'laws_with_doc_requirement_in_tree': len(per_law),
            'nodes': len(nodes),
            'leaves': len(leaves),
            'document_entries': len(entries),
            'entries_by_kind': {
                '필수': sum(1 for d in entries if d['구분'] == '필수'),
                '조건부': sum(1 for d in entries if d['구분'] == '조건부'),
            },
            'entries_by_tier': {
                t: sum(1 for d in entries if d['계층'] == t) for t in ('법률', '시행령', '시행규칙')
            },
            'per_law': dict(sorted(per_law.items(), key=lambda kv: -kv[1])),
            'equipment_entries': len(eq_entries),
            'equipment_by_requirement_type': {
                t: sum(1 for _, d in eq_entries if d['요건유형'] == t)
                for t in ('비치수량', '비치', '착용')
            },
            'equipment_by_quantity_source': {
                s: sum(1 for _, d in eq_entries if d['수량출처'] == s)
                for s in ('조문본문', Q_OCR, Q_별표, Q_없음)
            },
            'equipment_by_tier': {
                t: sum(1 for _, d in eq_entries if d['계층'] == t)
                for t in ('법률', '시행령', '시행규칙', ADM)
            },
            'equipment_by_node': eq_per_node,
            'equipment_per_law': dict(sorted(eq_per_law.items(), key=lambda kv: -kv[1])),
            'equipment_per_source': dict(sorted(eq_per_notice.items(), key=lambda kv: -kv[1])),
            'admrul_files_scanned': adm_scan['files'],
            'admrul_articles_scanned': adm_scan['articles'],
            'admrul_scan_candidates': adm_scan['candidates'],
            'admrul_laws_with_candidates': len(adm_scan['laws_with_candidates']),
            'admrul_notices_with_candidates': len(adm_scan['notices_with_candidates']),
            'insurance_entries': len(ins_entries),
            'insurance_by_requirement_type': {
                t: sum(1 for _, d in ins_entries if d['요건유형'] == t) for t in ('가입의무', '가입요건')
            },
            'insurance_by_kind': {
                t: sum(1 for _, d in ins_entries if d['구분'] == t) for t in ('필수', '조건부')
            },
            'insurance_by_tier': {
                t: sum(1 for _, d in ins_entries if d['계층'] == t)
                for t in ('법률', '시행령', '시행규칙', ADM)
            },
            'insurance_by_limit_source': {
                s: sum(1 for _, d in ins_entries if d['보장한도출처'] == s)
                for s in (L_본문, L_위임, L_없음)
            },
            'insurance_by_node': ins_per_node,
            'insurance_per_law': dict(sorted(ins_per_law.items(), key=lambda kv: -kv[1])),
            'insurance_scan_files': ins_scan['files'],
            'insurance_scan_articles': ins_scan['articles'],
            'insurance_scan_candidates': ins_scan['candidates'],
            'insurance_laws_with_vocab': len(ins_scan['laws_with_vocab']),
            'insurance_laws_with_candidates': len(ins_scan['laws_with_candidates']),
            'insurance_laws_in_tree': len(ins_per_law),
        },
        'insurance_scan': {
            '설명': '74법 raw 전체(법률계열 + 고시계열)를, 보험 어휘(보험·공제·보장계약·재정보증) × 가입 의무 동사'
                    '(가입하여야·체결하여야·당연가입자 등) 2중 조건으로 훑은 결과(설계 §12.3). 후보 문장이 곧 '
                    '"어떤 배가 무슨 보험을 드나"는 아니다 — 벌칙 조항의 위반행위 나열, 보험사업 운영·감독 규정, '
                    '시설·사업장 보험 등이 섞여 있어 사람이 추려 트리에 넣었다.',
            'laws_with_vocab': ins_scan['laws_with_vocab'],
            'laws_with_candidates': ins_scan['laws_with_candidates'],
        },
        'equipment_scan': {
            '설명': '74법 raw의 고시(행정규칙) 파일 전수를, 안전장비 어휘(구명·소방설비 등) × 의무 동사(비치·갖추어야·설치·착용) '
                    '2중 조건으로 훑은 결과(설계 §11). 후보 문장이 곧 비치 수량 요건은 아니다 — 장비의 성능·구조 요건, '
                    '검사 방법, 정비 주기 등이 섞여 있어 사람이 추려 트리에 넣었다.',
            'laws_with_candidates': adm_scan['laws_with_candidates'],
            'notices_with_candidates': adm_scan['notices_with_candidates'],
        },
        'scan': {
            '설명': '설계 §5.2의 3중 조건(동사 × 서류명사 × 장소구, 장소구는 동사 앞 90자 이내)으로 74법 raw 전수를 훑은 결과. '
                    '후보 문장이 곧 서류 요건은 아니다 — 설비 기준·사무소 비치·신청서류 등이 섞여 있어 사람이 추려 트리에 넣었다.',
            'laws_with_candidates': scan['laws_with_candidates'],
            'laws_without_candidates': sorted({l['slug'] for l in LAWS} - set(scan['laws_with_candidates'])),
        },
        'unmapped': {
            '설명': '스캔 후보에는 걸렸으나 "선박에 비치·구비하는 서류"가 아니어서 트리에 넣지 않은 것들. '
                    '무엇을 왜 뺐는지 남겨두어야 다음 사람이 같은 판단을 반복하지 않는다(설계 §5.4).',
            '법_단위': [
                {'법': '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률',
                 '사유': '후보 문장이 과태료 조항의 위반행위 나열(제58조)과 어선안전보건표지·시정조치 명령 게시(제29조·제33조), '
                         '어선안전보건위원회 회의록 작성·비치(시행령)였다 — 배에 갖춰 두는 "서류" 요건이 아니다.'},
                {'법': '폐기물관리법',
                 '사유': '유해성 정보자료를 수집·운반차량·보관장소·처리시설에 게시·비치(제18조의2제4항) — 선박이 아니다.'},
                {'법': '해양조사와 해양정보 활용에 관한 법률',
                 '사유': '"항해용 간행물"의 정의 조항(제2조제12호, "선박에 비치할 목적으로 제작한")일 뿐 비치 의무 조문이 아니다. '
                         '실제 의무는 선박안전법 제32조에 있고 그것은 트리에 들어가 있다.'},
            ],
            '유형_단위': [
                {'유형': '사무소·사업장·영업소 비치', '예': '유선 및 도선 사업법 제23조제2항(영업소 선원명부) · 신항만건설 촉진법 시행령 제28조(주된 사무소 토지상환채권원부)'},
                {'유형': '관청이 비치하는 등록원부', '예': '항만법 제25조제2항 · 마리나항만법 제22조제1항'},
                {'유형': '공무원 신분 증표', '예': '"권한을 표시하는 증표를 지니고" — 스캔 단계에서 제외'},
                {'유형': '서류가 아닌 설비·장비의 비치', '예': '선박구명설비기준·어선설비기준 등 고시의 구명부환·구명조끼 비치'},
                {'유형': '신청·첨부 서류', '예': '"신청서에 다음 각 호의 서류를 첨부하여" — 스캔 단계에서 제외'},
                {'유형': '선박 종류와 무관한 개인 휴대 의무', '예': '출입국관리법 제27조(체류 외국인의 여권등 휴대) — 선박 종류로 갈리지 않아 이 트리의 축이 아니다'},
            ],
            '장비_유형_단위': [
                {'유형': '장비의 성능·구조·재료 요건',
                 '예': '선박구명설비기준 제34조(구명부환의 요건)·어선설비기준 제25조~제37조 — 선박종류로 갈리지 않는 제품 규격이라 이 트리의 축이 아니다'},
                {'유형': '비치 장소·방법',
                 '예': '선박구명설비기준 제117조(구명부환의 비치방법 — 양현에 비치)·제118조(구명조끼의 비치방법) — 수량이 아니라 배치 규정'},
                {'유형': '정비·유효기간·수압시험',
                 '예': '선박구명설비기준 제129조~제134조 · 선박소방설비기준 제29조의2 — 축이 다르다(검사 주기 계층 후보)'},
                {'유형': '항해용구·무선·조타·계선설비',
                 '예': '어선설비기준 제171조(해도)·제177조(자기컴퍼스)·제185조(위성항법장치), 동력수상레저기구 안전검사기준 제53조(별표 15 항해용구) '
                       '— 이번 주제(안전장비=구명·소방설비) 밖'},
                {'유형': '선종별 검사기준 고시로서 트리 리프와 1:1이 아닌 것',
                 '예': '소형선박의 구조 및 설비기준 · 플레저보트 검사기준 · 범선/부유식 해상구조물/공기부양정/잠수선 기준 등 — '
                       '트리 노드가 아직 그 선종을 구분하지 않아 억지로 끼워넣지 않았다'},
                {'유형': '설비 상태 점검표(수량 규정 아님)',
                 '예': '유ㆍ도선의 규격 및 시설ㆍ설비기준 제5조 별표 — "추진기관 시동상태에서 심한 진동 및 이상 음이 없을 것"처럼 '
                       '검사 점검 항목이라 비치 수량이 아니다. 유·도선의 실제 장비 수량은 시행령 제17조·제18조에 있고 트리에 들어가 있다'},
                {'유형': '배가 아니라 배에 실린 잠수설비에 갖추는 장비',
                 '예': '선박설비기준 제143조(내압동체 내 탑승인원수의 구명조끼)·제144조(내압동체 내 소화기) — 대상이 '
                       '"내압동체"(모선에 실린 잠수설비, 같은 기준 제134조·제141조 정의)라 선박 종류 축과 1:1이 아니다. '
                       '2026-08-10 「선박설비기준」 전수확인에서 확인한 항목이며, 잠수설비를 트리 노드로 세우기로 하면 '
                       '바로 담을 수 있다(같은 이유로 「잠수선기준」도 미채택 상태)'},
                {'유형': '구명설비를 언급하지만 수량이 아니라 탈출로·조명 구조 요건',
                 '예': '선박설비기준 제15조(여객실 출입구)·제48조·제51조(거주구역·기관구역 탈출설비)·제53조(비상조명장치)·'
                       '제13조(객석설비) — "구명정 승정갑판으로 통하는 통로"처럼 구명설비를 기준점으로 쓸 뿐 몇 개를 '
                       '갖추라는 조문이 아니다'},
                {'유형': '사업장·시설(배가 아닌 곳)의 장비',
                 '예': '유선 및 도선 사업법 시행령 제17조제1항제2호·제5호·제9호~제12호(유선장의 비상구조선·예비 노도·승강장 설비 등) — '
                       '선박이 아니라 유선장(시설)에 갖추는 것이라 이 트리의 축이 아니다'},
            ],
            '보험_법_단위': [
                {'법': '마리나항만의 조성 및 관리 등에 관한 법률', '조문': '제28조의8 · 시행령 제32조의4',
                 '사유': '마리나업 등록사업자(종사자·이용자 피해 보전)에게 걸리는 의무다. 이 트리에는 마리나업·마리나선박 리프가 '
                         '없어 억지로 끼워넣지 않았다 — 사업자 유형 매핑은 별도 자산(business_type_aliases.json) 소관.'},
                {'법': '연안사고 예방에 관한 법률', '조문': '제13조 · 시행령 제5조·제6조',
                 '사유': '연안체험활동 운영자의 의무이고, 대상이 "수상이나 수중에서 이루어지는 연안체험활동"이라 선박 종류로 '
                         '갈리지 않는다(배 없이 하는 체험활동도 포함).'},
                {'법': '어선법', '조문': '제31조의9 · 시행령 제9조',
                 '사유': '어선중개업자(매매·임대차 중개 시 손해배상책임 보장 보증보험)의 의무다 — 배를 운항하는 사람의 의무가 '
                         '아니라 중개업자의 영업 보증이라 이 트리의 축이 아니다.'},
                {'법': '해운법', '조문': '제34조 · 시행규칙 제24조·제25조',
                 '사유': '선박관리업자의 영업보증금 예치 또는 보증보험 가입(관리선원 수에 따른 금액) — 사업자 영업보증이라 '
                         '선박 종류로 갈리지 않는다.'},
                {'법': '수상에서의 수색ㆍ구조 등에 관한 법률', '조문': '제20조 · 제30조의9',
                 '사유': '제20조는 "조난된 선박등을 구난하려는 자"(구난업자)가 구난작업 시작 전에 드는 보험이라 배의 종류가 '
                         '아니라 작업 행위를 기준으로 하고, 제30조의9는 수상구조사 교육기관의 의무다.'},
                {'법': '어선원 및 어선 재해보상보험법', '조문': '제49조 · 시행령 제36조',
                 '사유': '어선보험(어선재해보상보험)은 "가입할 수 있다"는 임의가입이다 — 가입의무 계층에 넣으면 '
                         '의무인 것처럼 읽힌다. 같은 법 제16조제1항의 어선원보험(당연가입)만 트리에 담았다.'},
                {'법': '수산업협동조합법', '조문': '시행규칙 제9조의2 · 「수산업협동조합공제사업감독기준」 전반',
                 '사유': '공제사업을 운영·감독하는 규정(공제상품 설계·요율 산출·책임준비금 등)이지 누가 가입해야 하는지를 '
                         '정한 조문이 아니다.'},
                {'법': '항만법', '조문': '「무역항등의 항만시설 사용 및 사용료에 관한 규정」 제23조 · 「묵호항 하역시설 운영세칙」 제14조',
                 '사유': '항만시설 사용허가를 받은 자·하역시설 운용자가 그 시설에 드는 손해보험이다 — 선박이 아니라 시설이 대상.'},
                {'법': '선원법', '조문': '「해외취업선원 재해보상에 관한 규정」 제17조',
                 '사유': '해외취업선원(외국 선박 등에 취업한 선원)의 재해보상용 보험이라 대상이 이 트리의 선박 종류 축과 다르다. '
                         '국내 선박의 선원 재해보상보험은 선원법 제106조로 트리에 들어가 있다.'},
                {'법': '수상레저안전법', '조문': '「수상레저사업장 종사 인명구조요원·래프팅가이드 자격관리규칙」 제16조',
                 '사유': '인명구조요원 교육기관 대표자가 교육·평가 중 사고에 대비해 드는 보험이다 — 교육기관의 의무이지 '
                         '기구 소유자·수상레저사업자의 의무가 아니다.'},
                {'법': '갯벌 및 그 주변지역의 지속가능한 관리와 복원에 관한 법률 · 해양치유자원의 관리 및 활용에 관한 법률',
                 '조문': '각 고시(갯벌생태해설사 양성기관 규정 제14조 · 해양치유 전문인력 양성기관 고시 제17조)',
                 '사유': '교육·양성기관이 교육생을 위해 드는 보험이라 선박과 무관하다.'},
                {'법': '폐기물관리법', '조문': '제41조',
                 '사유': '폐기물 처리 공제조합의 "설립" 규정이지 가입의무 조문이 아니다.'},
                {'법': '선박안전법', '조문': '제60조제2항',
                 '사유': '"선박보험의 가입·유지를 위하여" 선급법인에 검사업무를 대행하게 할 수 있다는 조문이다 — '
                         '선박보험 가입의무를 정한 조문이 아니라 검사 대행의 근거다. 스캔 후보에는 걸렸으나 트리에 넣지 않았다.'},
            ],
            '보험_유형_단위': [
                {'유형': '벌칙·과태료 조항의 위반행위 나열',
                 '예': '해운법 제57조제1호(제4조의3 위반 미가입) · 유류오염손해배상 보장법 제60조 · 항로표지법 제55조 · '
                       '연안사고예방법 제25조 · 수색구조법 제46조 등 — 의무 조문 자체는 트리에 들어가 있고, 제재는 '
                       'A(처벌강도) 자산 소관이라 여기서는 뺐다'},
                {'유형': '미가입자 관리·통지·정보제공 절차',
                 '예': '수상레저안전법 제50조~제54조(가입정보 제공·전산망·미가입자 조치) · 선원법 제42조의4·제106조의2'
                       '(보험 해지 제한) · 어선원보험법 제64조의4(입출항 시 가입 여부 확인) — 가입의무 자체가 아니라 '
                       '그 이행을 관리하는 절차다'},
                {'유형': '보험료·보험급여·보험관계 성립소멸 등 보험사업 내부 규정',
                 '예': '어선원 및 어선 재해보상보험법 제18조~제55조 대부분 — 이 트리는 "누가 무슨 보험을 들어야 하나"만 담는다'},
                {'유형': '보험자(보험회사·공제조합) 쪽 의무',
                 '예': '수상레저안전법 제53조제1항(보험회사등의 통지의무) — 가입자가 아니라 보험자의 의무'},
            ],
        },
        'tree': root,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('OK → %s' % OUT)
    print('  노드 %d · 리프 %d · 서류항목 %d · 기여법 %d'
          % (len(nodes), len(leaves), len(entries), len(per_law)))
    print('  스캔: %d법 · %d파일 · %d조문 · 후보문장 %d건 · 후보가 나온 법 %d개'
          % (len(LAWS), scan['files'], scan['articles'], scan['candidates'],
             len(scan['laws_with_candidates'])))
    print('  장비: 항목 %d건 · 노드 %d곳 · 근거 소스 %d종'
          % (len(eq_entries), len(eq_per_node), len(eq_per_notice)))
    print('  고시스캔: %d파일 · %d조문 · 후보문장 %d건 · %d법 %d고시'
          % (adm_scan['files'], adm_scan['articles'], adm_scan['candidates'],
             len(adm_scan['laws_with_candidates']), len(adm_scan['notices_with_candidates'])))
    print('  보험: 항목 %d건 · 노드 %d곳 · 기여법 %d개'
          % (len(ins_entries), len(ins_per_node), len(ins_per_law)))
    print('  보험스캔: %d파일 · %d조문 · 후보문장 %d건 · 어휘출현 %d법 · 후보가 나온 법 %d개'
          % (ins_scan['files'], ins_scan['articles'], ins_scan['candidates'],
             len(ins_scan['laws_with_vocab']), len(ins_scan['laws_with_candidates'])))


if __name__ == '__main__':
    main()
