#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
기상특보 출항·운항통제 자산 빌더 겸 검증기 (H-36 14번째 계층자산).

역할(초보자용):
  "기상특보가 뜨면 내 배는 나갈 수 있나?"를 가르는 규정은 구역(B 해역 트리)이 아니라
  **선종(어선/낚시어선/유·도선/내항여객선/수상레저기구/그 밖의 선박) × 특보종류(현상·등급)**
  라는 별개의 두 축으로 갈린다. 이 스크립트는 그 두 축과, 축이 만나는 칸마다의 통제규정을
  raw 원문에서 직접 읽어 JSON 자산으로 만든다.
  사람이 인용문을 손으로 타이핑하지 않는다 — 아래 SPEC에는 "어느 법 몇 조에 이런 문구가
  있다"(앵커)만 적고, 인용문·법령ID·파일경로는 이 스크립트가 raw를 열어 채운다.
  앵커가 raw에 없거나 뽑아낸 인용문에 앵커가 안 담기면 **그 자리에서 빌드를 실패**시킨다(환각 0).

[연계]
  읽기: raw/03_해상교통안전/해상교통안전법/{법률,시행령,시행규칙}.txt + 별표/시행규칙_별표10.txt
        raw/05_수산어업/어선안전조업…/{법률,시행령,시행규칙}.txt + 별표/시행규칙_별표{1,2}.txt
        raw/09_레저관광/낚시관리및육성법/{법률,시행령}.txt
        raw/10_항만물류/유선및도선사업법/{법률,시행령,시행규칙}.txt + 별표/{시행령_별표2,시행규칙_별표1}.txt
        raw/09_레저관광/수상레저안전법/{법률,시행령}.txt + 별표/시행령_별표14.txt
        raw/03_해상교통안전/선박교통관제에관한법률/{법률,시행령}.txt + 행정규칙/선박교통관제에관한규정.txt
        raw/15_관련타부처/기상법/{법률_발췌,시행령_발췌}.txt  (특보 등급체계의 근거 — ⚠발췌수집본)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록·커버리지 스캔용)
  쓰기: _dashboard/weather_warning_tree.json
  설계: _dashboard/H32_weather_warning_design.md
  검증: _dashboard/loop/verify_weather_warning_tree.py (빌더 로직 미재사용 독립 재대조)
  매칭: _dashboard/loop/match_weather_warning_tree.py (암시 하강 — 이번 라운드 배선 없음)
  선례: _dashboard/loop/build_zone_tree.py (조문분리·인용추출 헬퍼를 그대로 이식했다.
        두 빌더가 서로를 import하지 않는 이유는 각 자산이 독립적으로 재현 가능해야 하기 때문)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_weather_warning_tree.py
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
OUT = os.path.join(DASH, 'weather_warning_tree.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')
RE_ART_NB = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)')   # 고시계열(L-54)

ERRORS = []


def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법.
    근거: H29_design.md §2 — 서류·해역 트리가 이미 쓰는 같은 목록(L-74)."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}

# ── 74법 밖의 타법(발췌수집본) ────────────────────────────────────────────
# 기상법은 74법 체계 밖이지만, 이 자산의 **특보 등급체계 자체의 근거**라 빼면 축을 지어내는 셈이
# 된다(D의 유·도선 시행령 확장과 같은 성격). raw에 발췌본만 있고 파일 머리에 ⚠REVIEW가 붙어
# 있으므로 provenance에 그 사실을 그대로 싣는다.
OTHER_LAWS = {
    '기상법': {
        'name': '기상법',
        'raw': os.path.join(RAW, '15_관련타부처', '기상법'),
        'files': {'법률(발췌)': '법률_발췌.txt', '시행령(발췌)': '시행령_발췌.txt'},
        '주의': 'raw가 발췌수집본이다(파일 머리에 ⚠REVIEW 표기). 74법 체계 밖의 타법이라 전문이 아니라 '
                '인용조문만 수집돼 있고, 특보 기준표(시행령 별표1·별표2)는 수집범위 밖이다.',
    },
}


def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다."""
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


def split_articles_plain(text):
    """발췌본·고시계열 raw(`제13조의2(특보) …`, 대괄호 없음)를 조 단위로 쪼갠다(L-54)."""
    out, cur, buf = {}, None, []
    for line in text.split('\n'):
        m = RE_ART_NB.match(line.strip())
        if m:
            if cur:
                out[cur] = '\n'.join(buf)
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            buf = [line.rstrip()]
        else:
            if cur is not None:
                buf.append(line.rstrip())
    if cur:
        out[cur] = '\n'.join(buf)
    return out


_cache = {}


def article_body(slug, tier, article):
    """(법, 계층, 조) → 그 조의 raw 원문 전체. 없으면 None."""
    key = (slug, tier)
    if key not in _cache:
        if slug in OTHER_LAWS:
            p = os.path.join(OTHER_LAWS[slug]['raw'], OTHER_LAWS[slug]['files'][tier])
            _cache[key] = split_articles_plain(open(p, encoding='utf-8', errors='replace').read()) \
                if os.path.exists(p) else {}
        else:
            law = BY_SLUG.get(slug)
            p = os.path.join(law['raw'], TIER_FILE[tier]) if law else None
            _cache[key] = split_articles(open(p, encoding='utf-8', errors='replace').read()) \
                if p and os.path.exists(p) else {}
    return _cache[key].get(article)


def notice_body(slug, filename, article):
    """행정규칙(고시) raw에서 조 단위 본문을 꺼낸다. 마커가 무대괄호 형식이라 별도 분리기를 쓴다(L-54)."""
    key = ('__notice__', slug, filename)
    if key not in _cache:
        p = os.path.join(BY_SLUG[slug]['raw'], '행정규칙', filename)
        _cache[key] = split_articles_plain(open(p, encoding='utf-8', errors='replace').read()) \
            if os.path.exists(p) else {}
    return _cache[key].get(article)


def notice_id(slug, filename):
    """고시 raw 머리말의 `ID:...`(행정규칙ID)를 읽는다."""
    p = os.path.join(BY_SLUG[slug]['raw'], '행정규칙', filename)
    if not os.path.exists(p):
        return None
    head = open(p, encoding='utf-8', errors='replace').read(400)
    m = re.search(r'ID:(\d+)', head)
    return m.group(1) if m else None


def annex_lines(slug, tier, no):
    """별표 파일(raw/<법>/별표/<계층>_별표<번호>.txt)을 줄 단위로 읽는다."""
    key = ('__annex__', slug, tier, no)
    if key not in _cache:
        p = os.path.join(BY_SLUG[slug]['raw'], '별표', '%s_별표%s.txt' % (tier, no))
        _cache[key] = [ln.rstrip() for ln in open(p, encoding='utf-8', errors='replace').read().split('\n')] \
            if os.path.exists(p) else []
    return _cache[key]


def law_id(slug, tier):
    """_meta.json의 families.<계층>.법령ID — 법령명이 바뀌어도 추적이 끊기지 않게(H-29 11항·L-74)."""
    if slug in OTHER_LAWS:
        p = os.path.join(OTHER_LAWS[slug]['raw'], '_meta.json')
        if not os.path.exists(p):
            return None
        meta = json.load(open(p, encoding='utf-8'))
        fam = meta.get('families', {})
        f = fam.get(tier.replace('(발췌)', ''))
        if isinstance(f, list):
            f = f[0] if f else None
        return (f or {}).get('법령ID')
    law = BY_SLUG.get(slug)
    if not law:
        return None
    p = os.path.join(law['raw'], '_meta.json')
    if not os.path.exists(p):
        return None
    fam = json.load(open(p, encoding='utf-8')).get('families', {})
    f = fam.get(tier)
    if isinstance(f, list):
        f = f[0] if f else None
    return (f or {}).get('법령ID')


def rel_law(slug, tier):
    if slug in OTHER_LAWS:
        return os.path.relpath(os.path.join(OTHER_LAWS[slug]['raw'], OTHER_LAWS[slug]['files'][tier]), LEGAL)
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], TIER_FILE[tier]), LEGAL)


def rel_notice(slug, filename):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], '행정규칙', filename), LEGAL)


def rel_annex(slug, tier, no):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], '별표', '%s_별표%s.txt' % (tier, no)), LEGAL)


IMG_RE = re.compile(r'<img[^>]*>|</img>')


def flatten(body):
    """조문 원문을 한 줄로 편다. 이미지 태그만 지운다(raw에 그림으로 들어간 한자 대응)."""
    return re.sub(r'\s+', ' ', IMG_RE.sub(' ', body)).strip()


HANG_RE = re.compile(r'[①-⑳]')
HO_RE = re.compile(r'(?<![\d.])(\d{1,2}(?:의\d+)?)\. ')
MOK_RE = re.compile(r'(?:^| )([가-하])\. ')
CLEAN_START_RE = re.compile(r'^(\[제|제\d|[①-⑳]|\d{1,2}(?:의\d+)?\. |[가-하]\. |"|「|“)')


def with_proviso(q, flat, end, cap=520):
    """인용문 뒤에 "다만 …" 단서가 붙어 있으면 함께 싣는다.

    단서를 떨어뜨리면 화면의 "원문"이 **예외 없는 규정**으로 보여 원문보다 엄격해진다
    (build_zone_tree.py의 같은 함수·커밋 22bc398d6의 재발방지 규약을 그대로 이식)."""
    tail = flat[end:]
    if not tail.lstrip().startswith('다만'):
        return q
    p = end + (len(tail) - len(tail.lstrip()))
    pends = [p + 300, len(flat)]
    m = HANG_RE.search(flat, p + 2)
    if m:
        pends.append(m.start())
    m = HO_RE.search(flat, p + 2)
    if m:
        pends.append(m.start())
    k = flat.find('다. ', p + 2)
    if k > 0:
        pends.append(k + 2)
    clause = re.sub(r'\s(?:[가-하]|\d{1,2}(?:의\d+)?)\.$', '', flat[p:min(pends)].strip()).strip()
    if not clause:
        return q
    if len(q) + 1 + len(clause) <= cap:
        return q + ' ' + clause
    room = cap - len(q) - 2
    return (q + ' ' + clause[:room].rstrip() + '…') if room > 10 else (q + ' 다만, …')


def quote_of(body, anchor, span=340, wide=False, cap=520):
    """anchor를 포함한 대목을 원문에서 그대로 잘라 인용문으로 쓴다(사람이 타이핑하지 않는다).

    build_zone_tree.py의 같은 함수를 이식하되 **`mark_cut`을 항상 켠다** — 그 자산은 기존
    항목의 회귀조건 때문에 고시 항목에만 켜 두어 법률계열 1건이 표시 없이 잘려 있었다
    (H32_zone_tree_design.md §11.5 ④). 이 자산은 신규라 그 제약이 없으므로 처음부터 켠다.
    @returns {str|None} 앵커를 담은 인용문. 범위 계산이 실패하면 None(→ 빌드 실패).
    """
    flat = flatten(body)
    i = flat.find(anchor)
    if i < 0:
        return None
    marks = [m.start() for m in HANG_RE.finditer(flat[:i])]
    marks += [m.start() for m in HO_RE.finditer(flat[:i])]
    marks += [m.start(1) for m in MOK_RE.finditer(flat[:i])]
    mark = max(marks) if marks else None
    sent = flat.rfind('. ', 0, i)
    sent = sent + 2 if sent >= 0 else None
    if mark is not None and (sent is None or sent - mark <= 6):
        start = mark
    else:
        start = max([x for x in (mark, sent) if x is not None], default=0)
    after = i + len(anchor)
    ends = [i + span]
    m = HANG_RE.search(flat, after)
    if m:
        ends.append(m.start())
    if not wide:
        k = flat.find('다. ', max(0, after - 1))
        if k > 0:
            ends.append(k + 2)
        m = HO_RE.search(flat, after)
        if m:
            ends.append(m.start())
    end = min(ends)
    cut = flat[start:end].strip()
    q = cut[:cap]
    if end < len(flat):
        q = re.sub(r'\s(?:[가-하]|\d{1,2}(?:의\d+)?)\.$', '', q).strip()
    q = re.sub(r'(?<=다\.)(?:[가-하]|\d{1,2}(?:의\d+)?)\.$', '', q).strip()
    q = re.sub(r'\s*<(?:개정|신설|삭제|전문개정)[^>]*$', '', q).strip()
    if q == cut:
        q = with_proviso(q, flat, end, cap=cap)
        q = re.sub(r'\s*<(?:개정|신설|삭제|전문개정)[^>]*$', '', q).strip()
    if (len(cut) > cap or (end == i + span and end < len(flat))) and not q.endswith('…'):
        q = q + ' …'
    if anchor not in q:
        return None
    return q if CLEAN_START_RE.match(q) else '… ' + q


def block_of(lines, anchor, before=0, after=0):
    """별표(표) 원문에서 앵커가 있는 **줄 블록을 그대로** 인용한다.

    왜 문장으로 안 뽑나 — 별표 1·2·10·14는 괘선(┌─┬┐)으로 그린 표라, 한 칸의 뜻이 여러 줄에
    걸쳐 있고 flatten하면 옆 칸 글자와 섞인다. H(자격면허등급) 자산이 별표 병합셀을 구조화하려다
    "새 값/이어지는 값"을 구별할 수 없어 포기하고 표를 verbatim으로 담은 것과 같은 판단이다
    (MASTER_PLAN H-36 H절 "환각0 모범사례"). 억지 구조화로 오답을 만들지 않는다.
    @returns {str|None} 앵커를 담은 줄 블록(원문 그대로). 앵커가 없으면 None(→ 빌드 실패).
    """
    idx = [k for k, ln in enumerate(lines) if anchor in ln]
    if not idx:
        return None
    k = idx[0]
    lo, hi = max(0, k - before), min(len(lines), k + after + 1)
    out = '\n'.join(lines[lo:hi]).rstrip()
    return out if anchor in out else None


# ── 값 도메인(빌더·검증기가 함께 검사) ─────────────────────────────────
KINDS = ['출항·운항 통제', '활동금지', '안전조치', '완화·예외', '적용대상', '적용제외', '관할', '처벌']
# 기상법 시행령 제8조의2제1항(특보 10종) + 제9조제4항(해양기상특보 3종)
PHENOMENA = ['호우', '대설', '태풍', '강풍', '황사', '건조', '한파', '폭염', '풍랑', '폭풍해일']
GRADES = ['주의보', '경보', '중대경보']
EXPR = ['포괄', '열거', '시계제한', '특보아님', '해당없음']


def warn(expr, 원문표현=None, 현상=None, 등급=None, 등급표현=None,
         확장근거=None, 시계=None, 예비특보=False, 조합=None):
    """통제항목의 `특보` 필드를 만든다 — 이 자산의 두 번째 축을 표현하는 자리.

    ★"전체 발효 시" vs "개별 특보만"을 가르는 것이 `표현` 필드다:
      - `포괄`: 원문이 특보를 통째로 가리킨다(유·도선법 제8조④ "기상특보 발효 시 운항할 수 없다").
               그 포괄어가 실제로 어떤 현상을 가리키는지는 **다른 조문이 말해 줄 때만** `현상`을 채우고
               그 조문을 `확장근거`에 남긴다. 근거가 없으면 `현상`은 null로 둔다(지어내지 않는다).
      - `열거`: 원문이 현상을 직접 열거한다(수상레저안전법 제22조제1호 6종).
      - `시계제한`: 특보가 아니라 시정·가시거리 기준이지만 같은 조문에서 함께 출항·운항을 가른다.
      - `특보아님`: 기상·해상 상태를 기준으로 삼지만 **특보라는 낱말을 쓰지 않는** 규정
                   (예: 낚시 시행령 제19조제1호의 "초당 풍속 12미터 이상 … 예보"). 특보 갈래를
                   가르지 않으므로 질문 생성에서 빠지되, 답변에는 그대로 실린다.
      - `해당없음`: 기상과 무관한 항목(관할·정의·양벌 등).
    ★`조합` — 한 항목 안에서 현상마다 등급이 다를 때 쓴다.
      실측: 어선안전조업법 시행규칙 별표 1 제1호는 "태풍주의보ㆍ태풍경보ㆍ풍랑경보"를 한 칸에 묶는다
      (태풍은 등급 불문, 풍랑은 경보만). `현상=[태풍,풍랑] 등급=[주의보,경보]`로만 적으면
      **풍랑주의보에도 이 행이 걸리는 것으로 코드가 읽어** 답이 틀린다(자체 시험 데모에서 실제로 발견).
      산문 `등급표현`에 적어 두는 것으로 갈음하면 사람은 알아보고 코드는 못 읽는다 — L-79가 지적한
      바로 그 실패다. 그래서 `조합=[{현상:[…], 등급:[…]}, …]`으로 데이터에 적는다.
      `현상`·`등급`은 그 합집합으로 남겨 두어 표시·호환에 쓴다(빌더가 합집합 일치를 검사한다).
    @param expr 위 5값 중 하나 @param 현상 PHENOMENA 부분집합 @param 등급 GRADES 부분집합
    @returns {dict} 특보 필드
    """
    if expr not in EXPR:
        ERRORS.append('특보.표현 값 오류: %r' % expr)
    for p in (현상 or []):
        if p not in PHENOMENA:
            ERRORS.append('특보.현상 값 오류: %r' % p)
    for g in (등급 or []):
        if g not in GRADES:
            ERRORS.append('특보.등급 값 오류: %r' % g)
    if 조합:
        u현상, u등급 = set(), set()
        for r in 조합:
            u현상 |= set(r.get('현상') or [])
            u등급 |= set(r.get('등급') or [])
        if u현상 != set(현상 or []) or u등급 != set(등급 or []):
            ERRORS.append('특보.조합의 합집합이 현상/등급과 다름: %r' % 조합)
    return {
        '표현': expr, '원문표현': 원문표현, '현상': 현상, '등급': 등급,
        '등급표현': 등급표현, '조합': 조합, '확장근거': 확장근거, '시계': 시계, '예비특보': 예비특보,
    }


NO_WARN = lambda: warn('해당없음')


def _entry(title, kind, slug, tier, article, quote, path, lawid,
           특보=None, who=None, cond=None, excl=None, note=None, review=None,
           annex=None, ruleid=None, delegate=None, 적용제외_대상법=None):
    if kind not in KINDS:
        ERRORS.append('유형 값 오류: %r (%s)' % (kind, title))
    e = {
        '제목': title,
        '유형': kind,
        '대상': who,
        '특보': 특보 if 특보 is not None else NO_WARN(),
        '근거법령': (OTHER_LAWS[slug]['name'] if slug in OTHER_LAWS else BY_SLUG[slug]['name']),
        '근거법령_slug': slug,
        '계층': tier,
        '근거조문': article,
        '법령ID': lawid,
        '파일': path,
        '인용': quote,
        '조건': cond,
        '적용제외': excl,
        '위임': delegate,
        '주의': note,
        'REVIEW': review,
        '적용제외_대상법': 적용제외_대상법,
    }
    if annex:
        e['별표'] = annex
    if ruleid:
        e['행정규칙ID'] = ruleid
    return e


def rule(title, slug, tier, article, anchor, kind, span=340, wide=False, cap=520, also=None, **kw):
    """법률계열(법률·시행령·시행규칙) 조문 1건을 통제항목으로 만든다.
    앵커가 raw에 없거나 인용문에 안 담기면 오류를 쌓아 빌드를 실패시킨다."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('조문 없음: %s %s %s (%s)' % (slug, tier, article, title))
        return None
    q = quote_of(body, anchor, span=span, wide=wide, cap=cap)
    if not q:
        ERRORS.append('앵커 미검출: %s %s %s ← %r (%s)' % (slug, tier, article, anchor, title))
        return None
    for a in (also or []):
        if a not in flatten(body):
            ERRORS.append('보조앵커 미검출: %s %s %s ← %r (%s)' % (slug, tier, article, a, title))
    return _entry(title, kind, slug, tier, article, q,
                  rel_law(slug, tier), law_id(slug, tier), **kw)


def arule(title, slug, tier, no, anchor, kind, before=0, after=0, sub=None, **kw):
    """별표 1건을 통제항목으로 만든다(표는 줄 블록 verbatim — block_of 참조)."""
    lines = annex_lines(slug, tier, no)
    if not lines:
        ERRORS.append('별표 파일 없음: %s %s 별표%s (%s)' % (slug, tier, no, title))
        return None
    q = block_of(lines, anchor, before=before, after=after)
    if not q:
        ERRORS.append('별표 앵커 미검출: %s %s 별표%s ← %r (%s)' % (slug, tier, no, anchor, title))
        return None
    art = '별표 %s' % no + (' %s' % sub if sub else '')
    return _entry(title, kind, slug, tier, art, q,
                  rel_annex(slug, tier, no), law_id(slug, tier),
                  annex={'번호': '별표 %s' % no, '형식': '표(원문 줄 그대로 인용)'}, **kw)


def nrule(title, slug, filename, article, anchor, kind, span=420, wide=False, cap=900, **kw):
    """행정규칙(고시) 조문 1건을 통제항목으로 만든다."""
    body = notice_body(slug, filename, article)
    if body is None:
        ERRORS.append('고시 조문 없음: %s/%s %s (%s)' % (slug, filename, article, title))
        return None
    q = quote_of(body, anchor, span=span, wide=wide, cap=cap)
    if not q:
        ERRORS.append('고시 앵커 미검출: %s/%s %s ← %r (%s)' % (slug, filename, article, anchor, title))
        return None
    return _entry(title, kind, slug, '행정규칙', article, q,
                  rel_notice(slug, filename), law_id(slug, '법률'),
                  ruleid=notice_id(slug, filename), **kw)


def prov(slug, tier, article, anchor, span=300, wide=False, note=None):
    """노드의 provenance 1건(출처 없는 노드 금지)."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('노드출처 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_of(body, anchor, span=span, wide=wide)
    if not q:
        ERRORS.append('노드출처 앵커 미검출: %s %s %s ← %r' % (slug, tier, article, anchor))
        return None
    d = {'법령': (OTHER_LAWS[slug]['name'] if slug in OTHER_LAWS else BY_SLUG[slug]['name']),
         '법령_slug': slug, '계층': tier, '조문': article,
         '법령ID': law_id(slug, tier), '파일': rel_law(slug, tier), '인용': q}
    if note:
        d['주의'] = note
    return d


def aprov(slug, tier, no, anchor, before=0, after=0, sub=None, note=None):
    """노드의 provenance 1건 — 근거가 별표에 있을 때."""
    lines = annex_lines(slug, tier, no)
    q = block_of(lines, anchor, before=before, after=after) if lines else None
    if not q:
        ERRORS.append('노드출처 별표 앵커 미검출: %s %s 별표%s ← %r' % (slug, tier, no, anchor))
        return None
    d = {'법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': tier,
         '조문': '별표 %s' % no + (' %s' % sub if sub else ''),
         '법령ID': law_id(slug, tier), '파일': rel_annex(slug, tier, no), '인용': q}
    if note:
        d['주의'] = note
    return d


# ══════════════════════════════════════════════════════════════════════
# SPEC ① — 특보 축(두 번째 축). 트리가 아니라 **목록**이다.
# ══════════════════════════════════════════════════════════════════════
def build_warning_axis():
    """특보종류 축을 만든다 — 현상 10종 × 등급 3종, 그리고 해양기상특보(3종) 계열.

    ★왜 이 축을 트리로 안 만드나: 특보 현상들 사이에는 상하·포함 관계가 없다(태풍이 풍랑의
      상위가 아니다). 계층이 없는 것을 트리로 만들면 근거 없는 상위 노드를 지어내야 한다
      (L-82 · zone_tree 설계 §3.2와 같은 판단). 그래서 **평면 목록 + 등급**으로 둔다.
    """
    lex = [
        prov('기상법', '법률(발췌)', '제13조의2',
             '기상청장은 기상현상으로 인하여 강수량, 온도, 풍속 등이 대통령령으로 정하는 기준에 도달하여',
             span=300),
        prov('기상법', '법률(발췌)', '제14조',
             '기상현상으로 인하여 풍속, 파고 등이 대통령령으로 정하는 기준에 도달하여', span=340),
        prov('기상법', '시행령(발췌)', '제8조의2',
             '법 제13조의2제1항에 따른 특보는 다음 각 호의 기상현상을 대상으로 한다', span=420, wide=True),
        prov('기상법', '시행령(발췌)', '제9조',
             '법 제14조제2항에 따른 해양기상특보(이하 "해양기상특보"라 한다)는 다음 각 호의 기상현상을 대상으로 한다',
             span=300, wide=True),
    ]
    marine = ['태풍', '풍랑', '폭풍해일']
    현상 = []
    for p in PHENOMENA:
        현상.append({
            'id': {'호우': 'heavy_rain', '대설': 'heavy_snow', '태풍': 'typhoon', '강풍': 'strong_wind',
                   '황사': 'yellow_dust', '건조': 'dryness', '한파': 'cold_wave', '폭염': 'heat_wave',
                   '풍랑': 'high_seas', '폭풍해일': 'storm_surge'}[p],
            '라벨': p,
            '계열': ['특보'] + (['해양기상특보'] if p in marine else []),
            '근거': '기상법 시행령 제8조의2제1항' + (' · 제9조제4항' if p in marine else ''),
        })
    등급 = [
        {'id': 'advisory', '라벨': '주의보', '근거': '기상법 시행령 제8조의2제1항 후단 · 제9조제4항 후단'},
        {'id': 'warning', '라벨': '경보', '근거': '기상법 시행령 제8조의2제1항 후단 · 제9조제4항 후단'},
        {'id': 'grave', '라벨': '중대경보', '근거': '기상법 시행령 제8조의2제1항 후단',
         '주의': '폭염에만 있는 등급이다(같은 항 제8호). 이 자산이 담은 6개 법 어디에서도 쓰이지 않는다 — '
                 '그래서 어느 통제항목의 `특보.등급`에도 나타나지 않는다.'},
    ]
    return {
        'id': 'weather_warning',
        '라벨': '기상특보 종류',
        '종류': '목록',
        '설명': '기상특보는 "현상(무엇에 대한 특보인가) × 등급(주의보/경보)"으로 정해진다. '
                '바다에는 육상과 별개로 「기상법」 제14조제2항의 **해양기상특보**(태풍·풍랑·폭풍해일)가 따로 있고, '
                '이 자산의 6개 법은 둘을 섞어 쓴다(예: 유·도선법 제8조제4항은 해양기상특보만, '
                '수상레저안전법 제22조제1호는 육상특보 6종을 열거).',
        'provenance': [x for x in lex if x],
        '현상': 현상,
        '등급': 등급,
        '진입키워드': ['기상특보', '해양기상특보', '특보', '주의보', '경보', '예비특보',
                       '태풍', '풍랑', '폭풍해일', '호우', '대설', '강풍', '한파', '황사', '건조', '폭염',
                       '시정', '시계', '가시거리'],
        '주의': [
            '「기상법」 raw는 74법 체계 밖의 **발췌수집본**이라 특보 기준표(시행령 별표 1·별표 2)가 수집돼 있지 않다. '
            '그래서 "풍속 몇 m/s부터 풍랑주의보인가" 같은 수치는 이 자산에 없다(지어내지 않는다).',
            '**예비특보**(기상법 제13조의2제2항)와 **시계·가시거리 제한**은 특보가 아니지만 같은 조문에서 함께 '
            '출항·운항을 가르므로, 통제항목의 `특보.예비특보`·`특보.시계` 필드로 표시한다.',
        ],
    }


# ══════════════════════════════════════════════════════════════════════
# SPEC ② — 선종 축(트리). D(vessel_doc_tree.json)의 노드 id·라벨을 최대한 그대로 쓴다.
# ══════════════════════════════════════════════════════════════════════
def n_root():
    """루트 `선박` — 해상교통안전법 제36조(선박 일반의 출항통제 근거)와 VTS 운항통제를 담는다."""
    es = [
        rule('기상특보가 발표되거나 시계가 제한되면 해양수산부장관이 선박의 출항통제를 명할 수 있다',
             '해상교통안전법', '법률', '제36조',
             '기상특보가 발표되거나 제한된 시계 등으로', '출항·운항 통제',
             who='선박소유자·선장',
             특보=warn('포괄', 원문표현='기상특보', 현상=None, 등급=None,
                       시계='제한된 시계(구체적 기준은 시행규칙 별표 10)'),
             note='이 항은 **선박 일반**에 대한 출항통제 명령의 근거다. 그런데 구체적 통제기준(시행규칙 별표 10)은 '
                  '내항여객선(제1호)과 "내항여객선 외의 선박"(제2호)에만 있고, 제2호는 수상레저기구·낚시어선·'
                  '유선 및 도선·어선을 명시적으로 적용대상에서 뺀다. 두 문언의 관계(제외된 배에도 제36조제1항 명령 '
                  '자체는 가능한지)는 원문에 적혀 있지 않다.',
             review='시행령 제28조제4항은 "여객선과 어선에 대한 출항통제 권한"을 해양경찰서장에게 위임한다고 적어, '
                    '어선에 대한 제36조 출항통제 권한이 실재함을 전제하는 것으로 읽힌다. 반면 별표 10 제2호는 어선을 '
                    '적용대상에서 뺀다. 이 둘을 잇는 문구는 raw 어디에도 없다 — 사람 확인 필요.',
             delegate=[{'법령': '해상교통안전법', '계층': '시행규칙', '조문': '제33조 · 별표 10'}]),
        rule('출항통제 명령을 위반하면 300만원 이하의 벌금', '해상교통안전법', '법률', '제116조',
             '다음 각 호의 어느 하나에 해당하는 자는 300만원 이하의 벌금에 처한다', '처벌',
             span=260, wide=True, also=['제36조제1항에 따른 명령을 위반한 자'],
             who='제36조제1항에 따른 명령을 위반한 자',
             note='법정형이지 선고형이 아니다(배선 전 필수 규약①). 초안(위키 comparisons/출항통제_기상특보.md)이 '
                  '"제116조 형량 도입문 원문추출 누락 — 상한 확인 필요"로 남겨 둔 `REVIEW`는 이번에 원문으로 '
                  '**해소**했다: 도입문이 "300만원 이하의 벌금에 처한다"이고 제1호가 제36조제1항 명령 위반이다.'),
        rule('양벌규정 — 법인·개인에게도 같은 벌금형', '해상교통안전법', '법률', '제117조',
             '제111조부터 제116조까지의 어느 하나에 해당하는 위반행위를 하면', '처벌',
             who='법인 또는 개인(대표자·대리인·사용인·종업원의 위반행위)'),
        rule('여객선·어선을 뺀 선박의 출항통제 명령 권한은 지방해양수산청장에게 위임',
             '해상교통안전법', '시행령', '제28조',
             '법 제36조에 따른 선박 출항통제의 명령(여객선 및 어선은 제외한다)', '관할', span=200),
        rule('여객선·어선에 대한 출항통제 권한은 해양경찰서장에게 위임',
             '해상교통안전법', '시행령', '제28조',
             '법 제36조에 따른 여객선과 어선에 대한 출항통제 권한을 해양경찰서장에게 위임한다', '관할'),
        # ── VTS(선박교통관제) — 장소(관제구역) 조건이 하나 더 붙는 중첩 규제
        nrule('관제구역 안에서 풍랑·폭풍해일·태풍 특보가 발효되거나 시계 500m 이하면 관제센터의 선박운항통제(대피지시 포함)에 따라야 한다',
              '선박교통관제에관한법률', '선박교통관제에관한규정.txt', '제8조',
              '해상교통관제센터의 선박운항통제', '출항·운항 통제', span=500, wide=True,
              who='관제대상선박의 선장',
              특보=warn('열거', 원문표현='기상특보(풍랑ㆍ폭풍해일ㆍ태풍)',
                        현상=['풍랑', '폭풍해일', '태풍'], 등급=None,
                        시계='시계(視界)가 500미터 이하로 제한된 경우'),
              cond='선박교통관제구역 안에 있는 관제대상선박일 것(법 제3조제1항). 「해상교통안전법」 제36조제1항에 따라 '
                   '출항이 통제된 경우도 같은 조 제2호로 통제 대상이 된다.',
              note='이 고시의 위임근거는 법 제12조제1항 → 시행령 제7조제1항제3호다(이 항목의 `위임` 참조). '
                   '관제구역이라는 **장소 조건**이 추가로 걸리는 중첩 규제라, 어느 선종이든 관제대상선박이면 걸린다.',
              delegate=[{'법령': '선박교통관제에관한법률', '계층': '법률', '조문': '제12조제1항'},
                        {'법령': '선박교통관제에관한법률', '계층': '시행령', '조문': '제7조제1항제3호'}]),
        rule('선박운항통제의 위임근거 — 기상악화·시계제한 시의 선박운항통제는 고시로 정한다',
             '선박교통관제에관한법률', '시행령', '제7조',
             '기상이 악화되거나 시계(視界)가 제한된 경우의 선박운항통제에 관한 사항', '관할', span=200),
        rule('관제대상선박 — 국제항해선·총톤수 300톤 이상·위험화물운반선 등',
             '선박교통관제에관한법률', '법률', '제2조', '"관제대상선박"이란', '적용대상',
             span=330, wide=True,
             note='나목 단서가 **내항어선**(국내항 사이만 항행하는 어선)을 총톤수 300톤 기준에서 뺀다. '
                  '다만 어선·수상레저기구가 관제대상선박에서 일반적으로 빠진다는 문구는 raw에 없다.',
             review='초안 위키는 "어선·레저기구는 원칙 비대상"이라고 적었으나, 원문이 명시적으로 배제하는 것은 '
                    '나목 단서의 내항어선뿐이다. 고시 제5조제3호사목은 어업지도선을 오히려 관제대상에 넣는다 — 사람 확인 필요.'),
        nrule('관제대상선박의 범위(고시) — 여객선, 그리고 300톤 미만이라도 AIS를 단 예인선·유선·예선·도선선 등',
              '선박교통관제에관한법률', '선박교통관제에관한규정.txt', '제5조',
              '관제대상선박은 다음 각 호와 같다', '적용대상', span=760, wide=True,
              note='제3호나목이 「유선 및 도선 사업법」 제2조제1호의 **유선**을 명시한다 — 유선이 자동식별장치(AIS)를 '
                   '달고 관제구역 안에 있으면 300톤 미만이라도 관제대상선박이 되어, 유·도선법의 운항금지와 '
                   'VTS 운항통제가 같은 사건에 함께 걸릴 수 있다(설계문서 §7.3).'),
        rule('관제대상선박의 선장은 선박교통관제사의 지시에 따라야 한다',
             '선박교통관제에관한법률', '법률', '제14조',
             '관제대상선박의 선장은 제18조제1호에 따른 선박교통관제사의 지시에 따라야 한다',
             '출항·운항 통제', who='관제대상선박의 선장'),
        rule('선박교통관제사의 지시에 정당한 사유 없이 따르지 않으면 1년 이하 징역 또는 1천만원 이하 벌금',
             '선박교통관제에관한법률', '법률', '제26조',
             '제14조제1항 본문에 따른 선박교통관제사의 지시에 정당한 사유 없이 따르지 아니한 사람은', '처벌',
             who='선박교통관제사의 지시에 따르지 아니한 사람',
             note='법정형이지 선고형이 아니다(배선 전 필수 규약①).',
             review='고시 제8조(선박운항통제) 위반이 곧 법 제14조제1항(선박교통관제사의 지시) 위반이어서 이 벌칙이 '
                    '걸리는지는 **원문에 연결 문구가 없다**. 고시 제8조의 의무주체는 "해상교통관제센터의 선박운항통제에 '
                    '따라야 한다"이고, 법 제26조의 구성요건은 "선박교통관제사의 지시"다. 초안 위키가 남긴 같은 REVIEW를 '
                    '이번에 원문으로 재확인했으나 해소되지 않아 그대로 유지한다 — 사람 확인 필요.'),
    ]
    return {
        'id': 'ship', '라벨': '선박',
        '정의': '수상 또는 수중에서 항행용으로 사용하거나 사용할 수 있는 배 종류',
        'provenance': [x for x in [
            prov('해상교통안전법', '법률', '제3조',
                 '이 법은 다음 각 호의 어느 하나에 해당하는 선박과 해양시설에 대하여 적용한다',
                 span=300, wide=True),
        ] if x],
        '질문': '어떤 배에 관한 것인가요?',
        '선택지': [
            {'label': '어선', 'hint': '어업·어획물운반업·수산물가공업에 종사하거나 어선등록을 한 배 (어선법 제2조제1호)',
             'next': 'fishing_vessel'},
            {'label': '수상레저기구', 'hint': '수상레저활동에 쓰는 모터보트·수상오토바이·요트·서프보드 등 (수상레저안전법 제2조제3호)',
             'next': 'water_leisure_craft'},
            {'label': '그 밖의 선박(일반선박)', 'hint': '여객선·유도선·화물선 등 어선도 수상레저기구도 아닌 배 (선박법 제1조의2제1항)',
             'next': 'general_ship'},
        ],
        '통제': [x for x in es if x],
        'children': [n_fishing(), n_leisure(), n_general()],
    }


def n_fishing():
    """어선 — 어선안전조업법 제10조·시행규칙 제4조·별표 1·별표 2·제49조."""
    S = '어선안전조업및어선원의안전ㆍ보건증진등에관한법률'
    es = [
        rule('기상특보가 발효되면 신고기관의 장이 어선의 출항·조업을 제한할 수 있다',
             S, '법률', '제10조', '신고기관의 장은 해상에 대하여 기상특보가 발효된 때에는',
             '출항·운항 통제', who='어선(신고기관의 장이 제한)',
             특보=warn('포괄', 원문표현='기상특보', 현상=None, 등급=None),
             delegate=[{'법령': '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률',
                        '계층': '시행규칙', '조문': '제4조 · 별표 1 · 별표 2'}]),
        rule('기상예비특보·기상특보가 발표·발효되면 선장은 해양수산부령의 안전조치·준수사항을 따라야 한다',
             S, '법률', '제10조', '어선의 선장은 해상에 대하여 기상예비특보', '안전조치',
             who='어선의 선장',
             특보=warn('포괄', 원문표현='기상예비특보 … 또는 기상특보', 현상=None, 등급=None, 예비특보=True)),
        arule('태풍주의보·태풍경보·풍랑경보 → 모든 어선의 출항 및 조업 제한',
              S, '시행규칙', '1', '│1. 태풍주의보ㆍ │모든 어선의 출항', '출항·운항 통제',
              before=0, after=3, sub='제1호',
              who='모든 어선',
              특보=warn('열거', 원문표현='태풍주의보ㆍ태풍경보ㆍ풍랑경보',
                        현상=['태풍', '풍랑'], 등급=['주의보', '경보'],
                        등급표현='태풍은 주의보·경보 모두, 풍랑은 경보만',
                        조합=[{'현상': ['태풍'], '등급': ['주의보', '경보']},
                              {'현상': ['풍랑'], '등급': ['경보']}]),
              note='표의 "구분" 칸이 태풍주의보·태풍경보·풍랑경보를 한 칸에 묶고 있어, 태풍은 등급 불문이고 '
                   '풍랑은 경보일 때만 이 행에 걸린다(풍랑주의보는 제2호 행).'),
        arule('풍랑주의보 → 총톤수 15톤 미만 어선의 출항 및 조업 제한',
              S, '시행규칙', '1', '│2. 풍랑주의보   │총톤수 15톤 미만인', '출항·운항 통제',
              before=0, after=4, sub='제2호',
              who='총톤수 15톤 미만인 어선',
              특보=warn('열거', 원문표현='풍랑주의보', 현상=['풍랑'], 등급=['주의보']),
              note='초안 위키(comparisons/출항통제_기상특보.md)에는 이 **15톤 기준 자체가 없었다**. '
                   '15톤 이상 어선은 풍랑주의보만으로는 이 표의 출항·조업 제한 대상이 아니다(단, 11월~3월은 '
                   '시행규칙 제4조제2항이 30톤 미만을 금지한다 — 이 노드의 다음 항목).'),
        arule('폭풍해일주의보·폭풍해일경보 → 출항·조업 제한 기준은 없고("-") 안전조치만 붙는다',
              S, '시행규칙', '1', '│3. 폭풍해일주의 │-', '안전조치',
              before=0, after=8, sub='제3호',
              who='조업 또는 항행 중인 어선',
              특보=warn('열거', 원문표현='폭풍해일주의보ㆍ폭풍해일경보',
                        현상=['폭풍해일'], 등급=['주의보', '경보']),
              note='"출항 및 조업 제한 기준" 칸이 `-`다 — 폭풍해일 특보만으로는 어선의 출항·조업이 제한되지 않고 '
                   '대피명령 준수·무선설비 청취 의무만 걸린다. 초안 위키에는 이 구분이 없었다.'),
        arule('기상특보 발효가 예상되는 경우에도 신고기관의 장이 출항·조업을 제한할 수 있다',
              S, '시행규칙', '1', '1. 신고기관의 장은 기상특보가 발효될 것으로 예상되는 경우에는',
              '출항·운항 통제', before=0, after=1, sub='비고 제1호',
              who='어선', 특보=warn('포괄', 원문표현='기상특보가 발효될 것으로 예상되는 경우', 예비특보=True)),
        arule('기상예비특보·기상특보 발효가 예상되면 어업지도선·함정이 이동 및 대피 명령을 내릴 수 있다',
              S, '시행규칙', '1', '2. 해양수산부 또는 지방자치단체의 어업지도선, 해양경찰관서의 함정은 기상예비특보',
              '안전조치', before=0, after=2, sub='비고 제2호',
              who='조업 또는 항행 중인 어선', 특보=warn('포괄', 원문표현='기상예비특보 … 기상특보', 예비특보=True)),
        arule('기상특보가 발표되면 신고기관의 장이 선장·소유자에게 문자메시지 등으로 알려야 한다',
              S, '시행규칙', '1', '3. 신고기관의 장은 기상특보가 발표된 때에는 해당 기상특보의 대상구역에서 조업하',
              '안전조치', before=0, after=5, sub='비고 제3호',
              who='신고기관의 장 → 어선의 선장·소유자', 특보=warn('포괄', 원문표현='기상특보')),
        arule('기상특보가 발효되면 안전본부가 1시간마다 방송하고 대피 상황을 4시간마다 보고한다',
              S, '시행규칙', '1', '4. 안전본부는 기상특보가 발효된 경우 기상특보의 내용과 어선의 안전조치 및 준수사',
              '안전조치', before=0, after=3, sub='비고 제4호',
              who='안전본부', 특보=warn('포괄', 원문표현='기상특보')),
        rule('11월 1일~3월 31일 풍랑주의보 시에는 총톤수 30톤 미만 어선의 출항·조업 금지(15톤 이상은 3요건 충족 시 가능)',
             S, '시행규칙', '제4조', '11월 1일부터 다음 해 3월 31일까지의 기간에 풍랑주의보가 발효된 경우에는',
             '출항·운항 통제', span=460, wide=True,
             who='총톤수 30톤 미만의 어선(단서: 총톤수 15톤 이상 어선)',
             특보=warn('열거', 원문표현='풍랑주의보', 현상=['풍랑'], 등급=['주의보']),
             cond='11월 1일부터 다음 해 3월 31일까지의 기간',
             excl='총톤수 15톤 이상 어선은 ①어선위치발신장치·무선설비 정상 작동 ②2척 이상 선단 편성(어선 간 최대 '
                  '6해리 이내) ③관할 안전본부 사전통지를 **모두** 갖추면 출항·조업할 수 있다.',
             note='제1호는 2026.4.24 개정으로 삭제됐다(raw에 "1. 삭제 <2026.4.24>"로 남아 있다) — 원문 그대로 싣는다.'),
        rule('풍랑주의보라도 별표 2의 해역·기간이면 총톤수 5톤 이상 어선의 출항·조업을 허용할 수 있다',
             S, '시행규칙', '제4조', '별표 2에 따른 해역 및 기간에 한정하여 어선이 출항하여 조업할 수 있다고 인정되면',
             '완화·예외', who='총톤수 5톤 이상 어선',
             특보=warn('열거', 원문표현='풍랑주의보', 현상=['풍랑'], 등급=['주의보']),
             cond='별표 2의 해역·기간에 한정 + 신고기관의 장이 출항·조업 가능하다고 인정할 것',
             delegate=[{'법령': '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률',
                        '계층': '시행규칙', '조문': '별표 2'}]),
        arule('풍랑주의보 발효 시 출항 가능 해역 및 기간(별표 2) — 인천·경기, 강원(해안선 7마일), 충남 천수만, 전남, 경북(3마일), 경남, 그 밖의 내만',
              S, '시행규칙', '2', '│1. 인천ㆍ경기도 연안', '완화·예외',
              before=0, after=22,
              who='총톤수 5톤 이상 어선',
              특보=warn('열거', 원문표현='풍랑주의보', 현상=['풍랑'], 등급=['주의보']),
              note='좌표가 아니라 지형지물로 서술된 해역이라 프로그램이 판정할 수 없다 — 표를 원문 그대로 싣는다. '
                   '해역 자체의 계층은 B(zone_tree.json)의 축이지 이 자산의 축이 아니다(L-82).'),
        rule('출항·조업 제한 위반 또는 안전조치 불이행 → 어업허가등의 취소 또는 3개월 이내 정지 요청(행정처분)',
             S, '법률', '제49조',
             '다음 각 호의 어느 하나에 해당하는 경우에는 해당 어업 또는 양식업의 허가', '처벌',
             span=560, wide=True, cap=700,
             also=['제10조제1항에 따른 출항 및 조업 제한을 위반하거나 같은 조 제2항에 따른 어선의 안전조치 및 준수사항에 따르지 아니한 경우'],
             who='어업허가·면허·신고·등록을 받은 자(제1항제2호)',
             note='이 법의 제10조 위반은 **형벌도 과태료도 아니라 행정처분**이다 — 벌칙 조문(제55조)과 과태료 조문'
                  '(제58조) 어디에도 제10조가 없고, 제49조제1항제2호가 제10조제1항·제2항 위반을 어업허가등 '
                  '취소·정지 요청 사유로 명시한다.'),
        rule('이 법의 적용범위 — 대한민국 국민·정부가 소유하는 모든 어선(대통령령으로 일부 제외)',
             S, '법률', '제3조', '이 법은 대한민국 국민', '적용대상', span=340),
        rule('적용제외 — 시험·조사·지도·단속·교습 선박, 원양어업 어선, 내수면어업·내수면양식업 어선',
             S, '시행령', '제3조', '법 제3조 단서에 따라 다음 각 호의 어선에 대해서는 법의 전부를 적용하지 않는다',
             '적용제외', span=420, wide=True),
    ]
    return {
        'id': 'fishing_vessel', '라벨': '어선',
        '정의': '어업·어획물운반업·수산물가공업에 종사하는 선박 등 「어선법」 제2조제1호의 선박',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'fishing_vessel', '라벨': '어선', '관계': '동일'},
        'provenance': [x for x in [
            prov(S, '법률', '제2조', '"어선"이란 「어선법」 제2조제1호 각 목의 어느 하나에 해당하는 선박을 말한다'),
        ] if x],
        '질문': '그 어선을 어떤 일에 쓰시나요?',
        '선택지': [
            {'label': '낚시어선', 'hint': '「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선 (낚시 관리 및 육성법 제2조제7호)',
             'next': 'angling_vessel'},
            {'label': '원양어선', 'hint': '「원양산업발전법」에 따른 원양어업에 종사하는 어선 — 이 법이 통째로 적용되지 않는다',
             'next': 'ocean_fishing_vessel'},
            {'label': '그 밖의 어선', 'hint': '낚시어선업·원양어업에 쓰지 않는 일반 어선(연안·근해 조업 등)',
             'next': 'other_fishing_vessel'},
        ],
        '통제': [x for x in es if x],
        'children': [n_angling(), n_ocean(), n_other_fishing()],
    }


def n_angling():
    """낚시어선 — 낚시법 제34조·시행령 제19조. 어선안전조업법 항목은 부모(어선)에서 상속된다."""
    L = '낚시관리및육성법'
    es = [
        rule('출입항신고기관의 장이 시간·기상·해상 상황을 고려해 낚시어선의 출항을 제한할 수 있다',
             L, '법률', '제34조', '출입항신고기관의 장은 시간, 기상 및 해상 상황에 관한 정보 등을 고려하여',
             '출항·운항 통제', who='낚시어선',
             특보=warn('특보아님', 원문표현='시간, 기상 및 해상 상황에 관한 정보'),
             delegate=[{'법령': '낚시 관리 및 육성법', '계층': '시행령', '조문': '제19조'}]),
        rule('출항제한 사유① 초당 풍속 12m 이상 또는 파고 2m 이상 예보',
             L, '시행령', '제19조',
             '「기상법 시행령」 제8조제1항에 따라 초당 풍속 12미터 이상 또는 파고(波高) 2미터 이상으로 예보가 발표된 경우',
             '출항·운항 통제', who='낚시어선',
             특보=warn('특보아님', 원문표현='초당 풍속 12미터 이상 또는 파고 2미터 이상으로 예보가 발표된 경우'),
             note='특보가 아니라 **예보** 단계의 수치 기준이다.'),
        rule('출항제한 사유② 호우·대설·태풍·강풍·풍랑·폭풍해일 특보 또는 태풍·풍랑·폭풍해일 해양기상특보 발표',
             L, '시행령', '제19조', '호우ㆍ대설ㆍ태풍ㆍ강풍ㆍ풍랑ㆍ폭풍해일에 관한 특보', '출항·운항 통제',
             who='낚시어선',
             특보=warn('열거', 원문표현='호우ㆍ대설ㆍ태풍ㆍ강풍ㆍ풍랑ㆍ폭풍해일에 관한 특보 또는 … 태풍ㆍ풍랑ㆍ폭풍해일에 관한 해양기상특보',
                       현상=['호우', '대설', '태풍', '강풍', '풍랑', '폭풍해일'], 등급=None,
                       확장근거={'법령': '기상법', '계층': '시행령', '조문': '제8조의2제1항제1호~제4호·제9호·제10호 · 제9조제4항'}),
             note='등급(주의보/경보)을 가리지 않는다 — 원문이 "특보"라고만 쓴다.'),
        rule('출항제한 사유③ 주의보·경보 발표 전의 사전 안내 정보(예비특보)',
             L, '시행령', '제19조',
             '기상청장이 제2호에 따른 주의보 또는 경보를 발표하기 전에 이를 사전에 알리기 위한 정보를 발표한 경우',
             '출항·운항 통제', who='낚시어선',
             특보=warn('열거', 원문표현='제2호에 따른 주의보 또는 경보를 발표하기 전에 이를 사전에 알리기 위한 정보',
                       현상=['호우', '대설', '태풍', '강풍', '풍랑', '폭풍해일'], 등급=None, 예비특보=True),
             note='원문이 "제2호에 따른"이라고 스스로 가리키므로 현상 목록은 제2호와 같다 — 지어낸 것이 아니다.'),
        rule('출항제한 사유④ 안개 등으로 해상 시계가 1km 이내',
             L, '시행령', '제19조', '안개 등으로 인하여 해상에서의 시계가 1킬로미터 이내인 경우',
             '출항·운항 통제', who='낚시어선',
             특보=warn('시계제한', 원문표현='해상에서의 시계가 1킬로미터 이내인 경우', 시계='시계 1킬로미터 이내')),
        rule('출항제한 사유⑤ 일출 전 또는 일몰 후(설비·영업시간 요건을 갖추면 제외)',
             L, '시행령', '제19조', '일출 전 또는 일몰 후', '출항·운항 통제', who='낚시어선',
             note='기상특보와 무관한 사유다. 이 자산의 주제 밖이지만, 낚시어선 출항제한 기준 6가지 중 하나만 빼면 '
                  '화면에 "기준이 5가지"인 것처럼 보여 **거짓 공백**이 되므로 그대로 싣는다(D의 유·도선 시행령 확장과 같은 판단).'),
        rule('출항제한 사유⑥ 해상상황의 급작스런 악화 등으로 출항이 어렵다고 판단되는 경우',
             L, '시행령', '제19조', '해상상황의 급작스런 악화 등으로 인하여 낚시어선의 출항이 어렵다고 판단하는 경우',
             '출항·운항 통제', who='낚시어선', 특보=warn('특보아님', 원문표현='해상상황의 급작스런 악화')),
        rule('출항제한 조치를 위반하고 출항하면 6개월 이하 징역 또는 500만원 이하 벌금',
             L, '법률', '제53조',
             '다음 각 호의 어느 하나에 해당하는 자는 6개월 이하의 징역 또는 500만원 이하의 벌금에 처한다',
             '처벌', span=900, wide=True, cap=1000,
             also=['제34조제1항에 따른 출항제한 조치를 위반하고 출항한 자'],
             who='제34조제1항에 따른 출항제한 조치를 위반하고 출항한 자',
             note='법정형이지 선고형이 아니다(배선 전 필수 규약①).'),
        rule('양벌규정 — 법인·개인에게도 같은 벌금형', L, '법률', '제54조',
             '제53조의 위반행위를 하면 그 행위자를 벌하는 외에', '처벌',
             who='법인 또는 개인'),
        rule('낚시어선은 총톤수 10톤 미만의 동력어선이어야 한다(낚시어선업 신고요건)',
             L, '시행령', '제16조', '총톤수 10톤 미만의 동력어선일 것', '적용대상',
             who='낚시어선',
             review='이 요건(10톤 미만)과 어선안전조업법 시행규칙 별표 1 제2호(풍랑주의보 시 **15톤 미만** 어선 '
                    '출항·조업 제한)를 겹쳐 읽으면 "낚시어선은 언제나 15톤 미만이므로 풍랑주의보 시 항상 제한 대상"이 '
                    '된다. 그러나 두 조문을 잇는 문구는 raw에 없고, 어선안전조업법이 낚시어선에 그대로 적용되는지 '
                    '자체가 아래 `중첩주의`의 REVIEW 대상이다 — 사람 확인 필요.'),
    ]
    return {
        'id': 'angling_vessel', '라벨': '낚시어선',
        '정의': '「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'angling_vessel', '라벨': '낚시어선', '관계': '동일'},
        'provenance': [x for x in [
            prov(L, '법률', '제2조', '"낚시어선"이란 「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선을 말한다'),
        ] if x],
        '구분근거': [x for x in [
            prov('해상교통안전법', '시행규칙', '제33조',
                 '법 제36조제1항에 따른 선박 출항통제의 기준 및 절차는 별표 10과 같다', span=200,
                 note='그 별표 10 제2호 가목 2)가 "「낚시 관리 및 육성법」에 따른 낚시어선"을 적용대상에서 뺀다.'),
            prov(L, '법률', '제4조', '낚시어선업에 대하여는 「유선 및 도선사업법」을 적용하지 아니한다'),
        ] if x],
        '중첩주의': '낚시어선도 「어선법」에 따라 등록된 **어선**이므로, 부모 노드(어선)의 어선안전조업법 항목이 '
                    '경로 상속으로 함께 붙는다. 낚시법 제4조제1항이 배제하는 것은 「유선 및 도선사업법」뿐이고 '
                    '어선안전조업법은 배제하지 않는다.',
        '중첩주의_REVIEW': '다만 "낚시어선의 출항"이 어선안전조업법 제10조제1항의 "어선의 출항 및 조업"에 그대로 '
                           '해당하는지(낚시영업 출항도 포함하는지)를 직접 말하는 문구는 raw에 없다. 두 법을 함께 '
                           '적용해야 한다는 명시적 연결조문이 없으므로 AI 연결로 표시한다 — 사람 확인 필요.',
        '통제': [x for x in es if x],
        '추가확인': [
            {'축': '기상특보활동신고', '질문': None, '영향': [],
             '주의': '이 축은 수상레저기구에만 있다(수상레저안전법 제22조 단서). 낚시어선에는 그런 예외가 없다.'},
        ],
        'children': [],
    }


def n_ocean():
    """원양어선 — 어선안전조업법 자체가 통째로 적용되지 않는다."""
    S = '어선안전조업및어선원의안전ㆍ보건증진등에관한법률'
    es = [
        rule('원양어업에 종사하는 어선에는 어선안전조업법의 전부를 적용하지 않는다 → 이 법의 기상특보 출항·조업 제한도 걸리지 않는다',
             S, '시행령', '제3조', '「원양산업발전법」 제2조제2호에 따른 원양어업에 종사하는 어선', '적용제외',
             who='원양어업에 종사하는 어선',
             적용제외_대상법='어선안전조업및어선원의안전ㆍ보건증진등에관한법률',
             note='그래서 이 리프에서는 부모(어선) 노드의 어선안전조업법 항목이 **경로 상속으로 붙되 적용되지 않는다**. '
                  '이 자산은 항목을 지우지 않고 이 적용제외 항목을 함께 실어 그 사실을 드러낸다 — 답변 조립 시 '
                  '반드시 함께 보여야 한다(L-79: 상속은 범위 필드를 함께 봐야 한다).'),
    ]
    return {
        'id': 'ocean_fishing_vessel', '라벨': '원양어선',
        '정의': '「원양산업발전법」에 따른 원양어업에 종사하는 어선',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'ocean_fishing_vessel', '라벨': '원양어선', '관계': '동일'},
        'provenance': [x for x in [
            prov(S, '시행령', '제3조', '「원양산업발전법」 제2조제2호에 따른 원양어업에 종사하는 어선'),
        ] if x],
        '통제': [x for x in es if x],
        'children': [],
    }


def n_other_fishing():
    """그 밖의 어선 — 자체 항목 없이 부모(어선)의 어선안전조업법 항목을 그대로 상속한다."""
    S = '어선안전조업및어선원의안전ㆍ보건증진등에관한법률'
    return {
        'id': 'other_fishing_vessel', '라벨': '그 밖의 어선',
        '정의': '낚시어선업·원양어업에 쓰이지 않는 어선(연안·근해 조업, 어획물운반 등)',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'other_fishing_vessel', '라벨': '그 밖의 어선', '관계': '동일'},
        'provenance': [x for x in [
            prov(S, '법률', '제2조', '"어선"이란 「어선법」 제2조제1호 각 목의 어느 하나에 해당하는 선박을 말한다'),
        ] if x],
        '통제': [],
        '추가확인': [
            {'축': '총톤수', '질문': '그 어선의 총톤수가 몇 톤인가요?',
             '선택지': [{'label': '15톤 미만'}, {'label': '15톤 이상 30톤 미만'}, {'label': '30톤 이상'}],
             '영향': ['풍랑주의보 → 총톤수 15톤 미만 어선의 출항 및 조업 제한',
                      '11월 1일~3월 31일 풍랑주의보 시에는 총톤수 30톤 미만 어선의 출항·조업 금지(15톤 이상은 3요건 충족 시 가능)',
                      '풍랑주의보라도 별표 2의 해역·기간이면 총톤수 5톤 이상 어선의 출항·조업을 허용할 수 있다'],
             '주의': '톤수는 이 자산의 축이 아니라 **E(tonnage_facet.json)의 축**이다(L-82). 여기서는 어느 통제항목이 '
                     '켜지는지만 가리키고, 구간 선택지는 이 리프의 항목이 실제로 쓰는 경계(5·15·30톤)를 그대로 옮겼다.'},
            {'축': '조업 해역·기간', '질문': '풍랑주의보 때 나가려는 곳이 별표 2의 연안 해역인가요?',
             '선택지': [{'label': '별표 2의 해역·기간에 해당'}, {'label': '해당하지 않음'}],
             '영향': ['풍랑주의보 발효 시 출항 가능 해역 및 기간(별표 2) — 인천·경기, 강원(해안선 7마일), 충남 천수만, 전남, 경북(3마일), 경남, 그 밖의 내만'],
             '주의': '해역 자체의 계층은 B(zone_tree.json) 소관이다. 별표 2는 좌표가 아니라 지형지물 서술이라 '
                     '프로그램이 판정할 수 없다 — 표 원문을 그대로 보여 사람이 판단하게 한다.'},
        ],
        'children': [],
    }


def n_leisure():
    """수상레저기구 — 수상레저안전법 제22조(활동 자체를 금지한다). 동력·무동력을 가리지 않는다."""
    W = '수상레저안전법'
    es = [
        rule('태풍·풍랑·폭풍해일·호우·대설·강풍 주의보 이상의 기상특보가 발효되거나 가시거리 0.5km 이내면 수상레저활동 금지',
             W, '법률', '제22조', '누구든지 수상레저활동을 하려는 구역이 다음 각 호의 어느 하나에 해당하는 경우에는',
             '활동금지', span=460, wide=True,
             who='수상레저활동을 하는 사람(누구든지)',
             특보=warn('열거', 원문표현='태풍ㆍ풍랑ㆍ폭풍해일ㆍ호우ㆍ대설ㆍ강풍과 관련된 주의보 이상의 기상특보',
                       현상=['태풍', '풍랑', '폭풍해일', '호우', '대설', '강풍'],
                       등급=['주의보', '경보'], 등급표현='주의보 이상',
                       시계='가시거리가 0.5킬로미터 이내로 제한되는 경우'),
             excl='파도 또는 바람만을 이용하는 수상레저기구의 특성을 고려해 대통령령으로 정하는 경우(시행령 제21조)',
             note='이 법은 배(기구)의 출항이 아니라 **활동 자체**를 금지한다 — 동력·무동력을 가리지 않는다. '
                  '그래서 D(vessel_doc_tree.json)가 두는 동력/무동력 하위 노드를 이 자산은 만들지 않았다(답이 갈리지 않는다).',
             delegate=[{'법령': '수상레저안전법', '계층': '시행령', '조문': '제21조'}]),
        rule('예외 — 풍랑·폭풍해일·호우·대설·강풍 "주의보"일 때 기상특보활동신고서를 내면 활동할 수 있다',
             W, '시행령', '제21조', '기상특보 중 풍랑ㆍ폭풍해일ㆍ호우ㆍ대설ㆍ강풍 주의보가 발효된 경우로서',
             '완화·예외', span=460,
             who='파도 또는 바람만을 이용하는 수상레저기구로 수상레저활동을 하려는 사람',
             특보=warn('열거', 원문표현='기상특보 중 풍랑ㆍ폭풍해일ㆍ호우ㆍ대설ㆍ강풍 주의보',
                       현상=['풍랑', '폭풍해일', '호우', '대설', '강풍'], 등급=['주의보']),
             cond='관할 해양경찰서장 또는 시장·군수·구청장에게 기상특보활동신고서를 제출할 것',
             note='★**태풍이 빠져 있다.** 법 제22조제1호는 6종(태풍 포함)을 금지하는데, 시행령 제21조의 예외는 5종'
                  '(태풍 제외)에만 열린다. 또 예외는 **주의보에 한정**되므로 경보에는 열리지 않는다. '
                  '초안 위키는 이 예외를 "윈드서핑 등 … 기상특보활동신고서 제출 시 예외"라고만 적어 이 두 제한을 놓쳤다.'),
        rule('위반 시 50만원 이하의 과태료', W, '법률', '제64조',
             '다음 각 호의 어느 하나에 해당하는 자에게는 50만원 이하의 과태료를 부과한다', '처벌',
             span=460, wide=True, cap=560,
             also=['제22조를 위반하여 기상에 따른 수상레저활동이 제한되는 구역에서 수상레저활동을 한 사람'],
             who='제22조를 위반하여 기상에 따른 수상레저활동이 제한되는 구역에서 수상레저활동을 한 사람(제2항제4호)',
             note='이 법에서 이 위반은 형벌이 아니라 **과태료**다. 부과·징수는 해수면이면 해양경찰청장·지방해양경찰청장·'
                  '해양경찰서장, 내수면이면 시장·군수·구청장이 한다(같은 조 제3항).'),
        arule('과태료 개별 금액 — 1회 20만원 / 2회 30만원 / 3회 이상 50만원',
              W, '시행령', '14', '마. 법 제22조를 위반하여 기상에 따', '처벌',
              before=1, after=4, sub='제2호 마목',
              who='제22조 위반자',
              note='별표 14 머리글이 "과태료(단위: 만원)"라고 밝힌다. 최근 1년간 같은 위반으로 부과처분을 받은 경우에만 '
                   '가중되고(일반기준 가목), 사소한 부주의 등은 2분의 1 범위에서 감경될 수 있다(일반기준 다목).'),
        rule('적용배제 — 유·도선사업, 체육시설업, 낚시어선업에는 이 법을 적용하지 않는다',
             W, '법률', '제3조', '「유선 및 도선사업법」에 따른 유ㆍ도선사업 및 그 사업과 관련된 수상에서의 행위를 하는 경우',
             '적용제외', span=380, wide=True),
    ]
    return {
        'id': 'water_leisure_craft', '라벨': '수상레저기구',
        '정의': '수상레저활동에 사용되는 선박이나 기구 — 동력수상레저기구와 무동력수상레저기구로 구분',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'water_leisure_craft', '라벨': '수상레저기구',
                   '관계': '동일(단, D의 하위 2노드 동력/무동력은 이 자산에서 만들지 않았다 — 제22조가 둘을 가르지 않는다)'},
        'provenance': [x for x in [
            prov(W, '법률', '제2조', '"수상레저기구"란 수상레저활동에 사용되는 선박이나 기구로서'),
            prov(W, '법률', '제2조', '"수상레저활동"이란 수상(水上)에서 수상레저기구를 사용하여'),
        ] if x],
        '구분근거': [x for x in [
            prov('해상교통안전법', '시행규칙', '제33조',
                 '법 제36조제1항에 따른 선박 출항통제의 기준 및 절차는 별표 10과 같다', span=200,
                 note='그 별표 10 제2호 가목 1)이 "「수상레저안전법」에 따른 수상레저기구"를 적용대상에서 뺀다.'),
        ] if x],
        '통제': [x for x in es if x],
        '추가확인': [
            {'축': '기구 특성', '질문': '파도 또는 바람만을 이용하는 수상레저기구인가요?',
             '선택지': [{'label': '파도·바람만 이용(윈드서핑 등)'}, {'label': '그 밖의 기구'}],
             '영향': ['예외 — 풍랑·폭풍해일·호우·대설·강풍 "주의보"일 때 기상특보활동신고서를 내면 활동할 수 있다'],
             '주의': '법 제22조 단서가 이 축을 만든다. 시행령 제21조는 "파도 또는 바람만을 이용하는 수상레저기구"의 '
                     '구체적 목록을 두지 않고 신고 절차만 정한다 — 어떤 기구가 여기 드는지는 원문에 열거돼 있지 않다.'},
        ],
        'children': [],
    }


def n_general():
    """그 밖의 선박(일반선박) — 유·도선, 내항여객선, 내항여객선 외의 선박으로 갈린다."""
    return {
        'id': 'general_ship', '라벨': '그 밖의 선박(일반선박)',
        '정의': '어선도 수상레저기구도 아닌 선박 — 여객선·유도선·화물선 등',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'general_ship', '라벨': '그 밖의 선박(일반선박)', '관계': '동일'},
        'provenance': [x for x in [
            prov('해상교통안전법', '시행규칙', '제33조',
                 '법 제36조제1항에 따른 선박 출항통제의 기준 및 절차는 별표 10과 같다', span=200),
        ] if x],
        '질문': '그 배가 어떤 배인가요?',
        '선택지': [
            {'label': '내항여객선', 'hint': '국제항해에 종사하지 않는 여객선 및 여객용 수면비행선박 (해상교통안전법 시행규칙 별표 10 제1호 가목)',
             'next': 'domestic_passenger_ship'},
            {'label': '유선·도선', 'hint': '유락·관광용 선박 대여·승선(유선)과 내수면·바다목 운송(도선) — 「해운법」을 적용받지 않는 배 (유선 및 도선 사업법 제2조)',
             'next': 'excursion_ferry'},
            {'label': '내항여객선 외의 선박', 'hint': '화물선·유조선·국제항해 여객선·예부선 결합선박·수면비행선박 등 (해상교통안전법 시행규칙 별표 10 제2호 가목)',
             'next': 'other_general_ship'},
        ],
        '통제': [],
        'children': [n_domestic_passenger(), n_excursion(), n_other_general()],
    }


def n_excursion():
    """유선·도선 — 유도선법 제8조④~⑥. 기상특보 발효 시 원칙 운항금지, 평수구역 예외."""
    U = '유선및도선사업법'
    es = [
        rule('유·도선은 기상특보(해양기상특보) 발효 시 운항할 수 없다',
             U, '법률', '제8조', '유ㆍ도선은 기상특보(「기상법」 제14조제2항에 따른 해양기상특보를 말한다. 이하 같다) 발효 시 운항할 수 없다',
             '출항·운항 통제', who='유·도선',
             특보=warn('포괄', 원문표현='기상특보(「기상법」 제14조제2항에 따른 해양기상특보)',
                       현상=['태풍', '풍랑', '폭풍해일'], 등급=['주의보', '경보'],
                       확장근거={'법령': '기상법', '계층': '시행령', '조문': '제9조제4항',
                                 '인용_위치': '축[1].provenance 의 기상법 시행령 제9조 항목'}),
             note='★이 조항이 "포괄 표현"의 대표 사례다 — 원문은 특보를 통째로 가리키고, 그 포괄어가 무엇을 뜻하는지는 '
                  '**같은 항이 스스로 인용한** 「기상법」 제14조제2항이 말해 준다. 그래서 `특보.현상`을 채울 수 있었고 '
                  '그 근거를 `확장근거`에 남겼다(육상특보 10종이 아니라 해양기상특보 3종이다).'),
        rule('예외 — 평수구역에서 운항하는 유·도선은 정해진 기준·절차에 따라 기상특보 발효 시에도 운항할 수 있다',
             U, '법률', '제8조', '평수구역(平水區域)(평수구역이 없는 해수면의 경우에는 대통령령으로 정하는 범위의 해수면을 말한다)에서 운항하는 유ㆍ도선은',
             '완화·예외', span=460, who='평수구역에서 운항하는 유·도선',
             특보=warn('포괄', 원문표현='기상특보(대통령령으로 정하는 기상특보에 한정한다)',
                       현상=['풍랑', '폭풍해일'], 등급=['주의보'],
                       확장근거={'법령': '유선 및 도선 사업법', '계층': '시행령', '조문': '제9조제2항'}),
             note='평수구역인지 여부는 **B(zone_tree.json)의 항해구역 축**이다(L-82) — 이 자산은 그 축을 복제하지 않고 '
                  '리프의 `추가확인`에서 가리키기만 한다.',
             delegate=[{'법령': '유선 및 도선 사업법', '계층': '시행령', '조문': '제9조제1항·제2항 · 별표 2'},
                       {'법령': '유선 및 도선 사업법', '계층': '시행규칙', '조문': '제7조 · 별표 1'}]),
        rule('그 예외로 운항이 허용돼도 관할관청이 실제 기상상태를 확인해 운항을 제한할 수 있다',
             U, '법률', '제8조', '해당 영업구역의 실제 기상상태를 확인하여 안전운항에 지장이 있다고 판단할 때에는',
             '출항·운항 통제', who='시장·군수·구청장 또는 해양경찰서장 → 유·도선'),
        rule('평수구역 예외가 열리는 기상특보는 해양기상특보 중 "주의보"뿐이고 태풍은 빠진다',
             U, '시행령', '제9조', '「기상법 시행령」 제9조제4항(같은 항 제1호는 제외한다)에 따른 해양기상특보(주의보로 한정한다)',
             '완화·예외', who='평수구역에서 운항하는 유·도선',
             특보=warn('열거', 원문표현='해양기상특보(주의보로 한정한다), 「기상법 시행령」 제9조제4항 중 제1호 제외',
                       현상=['풍랑', '폭풍해일'], 등급=['주의보'],
                       확장근거={'법령': '기상법', '계층': '시행령', '조문': '제9조제4항'}),
             note='★"같은 항 제1호는 제외한다"의 제1호가 **태풍**이다(기상법 시행령 제9조제4항 제1호 태풍 · 제2호 풍랑 · '
                  '제3호 폭풍해일). 즉 태풍특보와 모든 경보에서는 평수구역 예외가 열리지 않는다. '
                  '초안 위키는 "주의보 한정(경보·태풍특보 제외)"까지는 맞게 적었으나 근거 조문을 시행령 제9조②로만 '
                  '가리키고 태풍이 제1호라는 대응을 밝히지 않았다.'),
        rule('평수구역이 없는 해수면의 범위는 별표 2로 정한다',
             U, '시행령', '제9조', '별표 2에 따른 기상특보 발효 시 운항할 수 있는 해수면의 범위', '완화·예외',
             delegate=[{'법령': '유선 및 도선 사업법', '계층': '시행령', '조문': '별표 2'}]),
        rule('운항 허용의 기준·절차는 시행규칙 별표 1로 정한다',
             U, '시행규칙', '제7조', '별표 1에 따른 기상특보 발효 시 유ㆍ도선의 운항 허용 기준 및 절차', '완화·예외',
             delegate=[{'법령': '유선 및 도선 사업법', '계층': '시행규칙', '조문': '별표 1'}]),
        arule('공통기준 — 관할관청이 실제 기상상황을 종합 판단해 안전운항에 지장이 없는 경우에만 허용',
              U, '시행규칙', '1', '1) 관할관청은 기상특보 발효 시 실제 기상상황을 종합 판단하여 유ㆍ도선의',
              '완화·예외', before=0, after=1, sub='제1호 가목 1)',
              who='평수구역에서 운항하는 유·도선', 특보=warn('포괄', 원문표현='기상특보')),
        arule('공통기준 — 시정(視程)이 1km 미만이면 운항을 허용할 수 없다',
              U, '시행규칙', '1', '2) 관할관청은 기상상황으로 시정(視程)이 1 km 미만인 경우에는 운항을 허용',
              '출항·운항 통제', before=0, after=1, sub='제1호 가목 2)',
              who='평수구역에서 운항하는 유·도선',
              특보=warn('시계제한', 원문표현='시정(視程)이 1 km 미만인 경우', 시계='시정 1km 미만')),
        arule('호우·폭풍해일·강풍·풍랑 주의보 → 톤수별 풍속·파고 기준에 해당하면 운항 불허(10톤 미만 10㎧·1.5m / 10~30톤 10㎧·2m / 30~100톤 12㎧·2.5m / 100톤 이상 14㎧·2.5m)',
              U, '시행규칙', '1', '1) 호우, 폭풍해일, 강풍, 풍랑 주의보가 발표된 경우', '출항·운항 통제',
              before=0, after=10, sub='제1호 나목 1)',
              who='평수구역에서 운항하는 유·도선(톤수 구간별)',
              특보=warn('열거', 원문표현='호우, 폭풍해일, 강풍, 풍랑 주의보',
                        현상=['호우', '폭풍해일', '강풍', '풍랑'], 등급=['주의보']),
              note='★이 별표는 **육상특보 호우·강풍까지** 포함한다 — 시행령 제9조제2항이 예외를 여는 특보는 해양기상특보'
                   '(풍랑·폭풍해일) 주의보뿐인데, 별표 1의 세부기준은 호우·강풍·한파·대설·황사·건조·폭염까지 다룬다. '
                   '두 조문의 범위가 어긋나는 것으로 읽히나 이를 조정하는 문구는 raw에 없다.',
              review='시행령 제9조제2항(해양기상특보 주의보 한정, 태풍 제외)과 시행규칙 별표 1 제1호 나목(호우·강풍·한파·'
                     '대설·황사·건조·폭염 주의보까지 기준을 둠)의 범위 불일치 — 사람 확인 필요.'),
        arule('한파 주의보 → 운항로가 결빙되면 운항 불허(결빙 제거 후 강선에 한정해 허용 가능)',
              U, '시행규칙', '1', '2) 한파 주의보가 발표된 경우', '출항·운항 통제',
              before=0, after=3, sub='제1호 나목 2)',
              who='평수구역에서 운항하는 유·도선',
              특보=warn('열거', 원문표현='한파 주의보', 현상=['한파'], 등급=['주의보'])),
        arule('대설·황사·건조·폭염 주의보 → 시정 등 실제 기상상황을 종합 판단해 운항을 허용한다',
              U, '시행규칙', '1', '3) 대설, 황사, 건조, 폭염 주의보가 발표된 경우', '완화·예외',
              before=0, after=1, sub='제1호 나목 3)',
              who='평수구역에서 운항하는 유·도선',
              특보=warn('열거', 원문표현='대설, 황사, 건조, 폭염 주의보',
                        현상=['대설', '황사', '건조', '폭염'], 등급=['주의보'])),
        arule('운항 허용 절차 — 기상상태 판단(현장 확인) → 허용·통제 통보 → 이행 확인 → 기상특보 확인 후 해제',
              U, '시행규칙', '1', '2. 운항 허용 절차: 다음 각 목의 절차에 따른다', '완화·예외',
              before=0, after=4, sub='제2호',
              who='관할관청'),
        rule('기상특보 발효 시 운항하거나 운항제한에 따르지 않으면 6개월 이하 징역 또는 500만원 이하 벌금',
             U, '법률', '제41조',
             '다음 각 호의 어느 하나에 해당하는 자는 6개월 이하의 징역 또는 500만원 이하의 벌금에 처한다', '처벌',
             span=340, wide=True, cap=460,
             also=['제8조제4항 또는 제6항을 위반하여 기상특보 발효 시 유ㆍ도선을 운항하거나 유ㆍ도선의 운항제한에 따르지 아니한 자'],
             who='제8조제4항 또는 제6항을 위반한 자',
             note='★벌칙이 걸리는 것은 제8조**제4항**(운항금지)과 **제6항**(관할관청의 운항제한) 위반이다. '
                  '초안 위키는 제8조제4항만 적었다. 법정형이지 선고형이 아니다(배선 전 필수 규약①).'),
        rule('양벌규정 — 법인·개인에게도 같은 벌금형', U, '법률', '제42조',
             '제40조 또는 제41조의 위반행위를 하면', '처벌', who='법인 또는 개인'),
        rule('적용배제 — 수상레저사업·체육시설업·낚시어선업·마리나업·수중레저사업·항로표지 관련 행위에는 이 법을 적용하지 않는다',
             U, '법률', '제2조의2', '이 법은 다음 각 호의 경우에는 적용하지 아니한다', '적용제외',
             span=460, wide=True),
    ]
    return {
        'id': 'excursion_ferry', '라벨': '유선·도선',
        '정의': '유선사업(유락용 선박 대여·승선)·도선사업(내수면 또는 바다목 운송)에 쓰이는 선박으로서 「해운법」을 적용받지 않는 것',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'excursion_ferry', '라벨': '유선·도선', '관계': '동일'},
        'provenance': [x for x in [
            prov(U, '법률', '제2조', '"유선사업"이란 유선 및 유선장(遊船場)을 갖추고'),
            prov(U, '법률', '제2조', '"도선사업"이란 도선 및 도선장을 갖추고'),
        ] if x],
        '구분근거': [x for x in [
            prov('해상교통안전법', '시행규칙', '제33조',
                 '법 제36조제1항에 따른 선박 출항통제의 기준 및 절차는 별표 10과 같다', span=200,
                 note='그 별표 10 제2호 가목 3)이 "「유선 및 도선 사업법」에 따른 유선 및 도선"을 적용대상에서 뺀다.'),
        ] if x],
        '중첩주의': '유선이 자동식별장치(AIS)를 달고 선박교통관제구역 안에 있으면 총톤수 300톤 미만이라도 '
                    '「선박교통관제에 관한 규정」 제5조제3호나목에 따라 **관제대상선박**이 된다. 그러면 루트에서 상속되는 '
                    'VTS 운항통제(고시 제8조)가 유·도선법 제8조제4항의 운항금지와 같은 사건에 함께 걸릴 수 있다.',
        '통제': [x for x in es if x],
        '추가확인': [
            {'축': '항해구역', '질문': '그 유·도선이 평수구역에서 운항하나요?',
             '선택지': [{'label': '평수구역'}, {'label': '평수구역이 없는 해수면(시행령 별표 2의 구역)'},
                        {'label': '그 밖'}],
             '영향': ['예외 — 평수구역에서 운항하는 유·도선은 정해진 기준·절차에 따라 기상특보 발효 시에도 운항할 수 있다',
                      '평수구역 예외가 열리는 기상특보는 해양기상특보 중 "주의보"뿐이고 태풍은 빠진다'],
             '자산참조': {'자산': 'zone_tree.json', '트리': 'navigation_zone', '노드': 'smooth_water_area'},
             '주의': '항해구역은 이 자산의 축이 아니라 B(zone_tree.json)의 축이다(L-82) — 질문·선택지를 복제하지 않고 '
                     '그 자산을 가리킨다.'},
            {'축': '총톤수', '질문': '그 유·도선의 총톤수가 몇 톤인가요?',
             '선택지': [{'label': '10톤 미만'}, {'label': '10톤 이상 100톤 미만'}, {'label': '100톤 이상'}],
             '영향': ['호우·폭풍해일·강풍·풍랑 주의보 → 톤수별 풍속·파고 기준에 해당하면 운항 불허(10톤 미만 10㎧·1.5m / 10~30톤 10㎧·2m / 30~100톤 12㎧·2.5m / 100톤 이상 14㎧·2.5m)'],
             '주의': '톤수는 E(tonnage_facet.json)의 축이다(L-82). 선택지 3개 상한 때문에 원문의 4구간(10 미만 / '
                     '10~30 / 30~100 / 100 이상)을 3개로 묶었다 — 정확한 구간은 항목의 표 원문을 봐야 한다.'},
        ],
        'children': [],
    }


def n_domestic_passenger():
    """내항여객선 — 해상교통안전법 시행규칙 별표 10 제1호."""
    M = '해상교통안전법'
    es = [
        arule('적용선박 — 국제항해에 종사하지 않는 여객선 및 여객용 수면비행선박("내항여객선")',
              M, '시행규칙', '10', '가. 적용선박: 「해운법」 제2조제1호의2에 따른 여객선 중 국제항해에 종사하지',
              '적용대상', before=0, after=1, sub='제1호 가목'),
        arule('출항통제권자는 해양경찰서장', M, '시행규칙', '10', '나. 출항통제권자: 해양경찰서장',
              '관할', sub='제1호 나목'),
        arule('풍랑·폭풍해일주의보 → 평수구역 밖을 운항하는 내항여객선 통제(앞바다 운항선·총톤수 2,000톤 이상은 출항정지조건등에 해당하지 않으면 허용 가능)',
              M, '시행규칙', '10', '1) 「선박안전법 시행령」', '출항·운항 통제',
              before=0, after=21, sub='제1호 다목 표 풍랑·폭풍해일주의보 1)',
              who='평수구역 밖을 운항하는 내항여객선',
              특보=warn('열거', 원문표현='풍랑ㆍ폭풍해일주의보', 현상=['풍랑', '폭풍해일'], 등급=['주의보']),
              excl='「기상법 시행령」 제9조에 따른 해상예보의 구역 중 앞바다에서 운항하는 내항여객선과 총톤수 2,000톤 '
                   '이상 내항여객선은, 운항항로의 해상상태가 「해운법」 제21조 운항관리규정의 출항정지조건·운항정지조건에 '
                   '해당하지 않는 경우에 한정해 출항을 허용할 수 있다.',
              note='초안 위키는 이 행을 "풍랑·폭풍해일주의보 시 평수구역 밖 여객선 통제"로만 적어 **앞바다·2,000톤 이상 '
                   '예외를 통째로 빠뜨렸다**. 표를 원문 줄 그대로 싣는다.'),
        arule('풍랑·폭풍해일주의보 → 평수구역 안을 운항하는 내항여객선은 출항정지조건등에 해당해 위험하다고 판단될 때에만 통제',
              M, '시행규칙', '10', '2) 평수구역 안에서 운항', '출항·운항 통제',
              before=0, after=7, sub='제1호 다목 표 풍랑·폭풍해일주의보 2)',
              who='평수구역 안에서 운항하는 내항여객선',
              특보=warn('열거', 원문표현='풍랑ㆍ폭풍해일주의보', 현상=['풍랑', '폭풍해일'], 등급=['주의보']),
              note='표의 "기상상태" 칸(풍랑ㆍ폭풍해일주의보)이 위 1) 행에 병합돼 있어, 이 줄 블록만 보면 어떤 특보인지 '
                   '보이지 않는다 — 원문 표를 그대로 인용한 결과다. 어떤 특보인지는 이 항목의 `특보` 필드를 봐야 한다.'),
        arule('풍랑·폭풍해일경보, 태풍주의보·경보 → 모든 내항여객선의 출항을 통제해야 한다',
              M, '시행규칙', '10', '│모든 내항여객선           │', '출항·운항 통제',
              before=0, after=2, sub='제1호 다목 표 풍랑·폭풍해일경보·태풍주의보·경보',
              who='모든 내항여객선',
              특보=warn('열거', 원문표현='풍랑ㆍ폭풍해일경보, 태풍주의보ㆍ경보',
                        현상=['풍랑', '폭풍해일', '태풍'], 등급=['주의보', '경보'],
                        등급표현='풍랑·폭풍해일은 경보, 태풍은 주의보·경보 모두',
                        조합=[{'현상': ['풍랑', '폭풍해일'], '등급': ['경보']},
                              {'현상': ['태풍'], '등급': ['주의보', '경보']}])),
        arule('제한된 시계 → 시정 1km 이내면 모든 내항여객선(여객용 수면비행선박 제외), 시정 11km 이내면 여객용 수면비행선박의 출항을 통제해야 한다',
              M, '시행규칙', '10', '모든 내항여객선(여객용', '출항·운항 통제',
              before=0, after=8, sub='제1호 다목 표 제한된 시계',
              who='모든 내항여객선 / 여객용 수면비행선박',
              특보=warn('시계제한', 원문표현='제한된 시계 — 시정 1킬로미터 이내 / 여객용 수면비행선박은 시정 11킬로미터 이내',
                        시계='시정 1킬로미터 이내(여객용 수면비행선박은 11킬로미터 이내)'),
              note='초안 위키는 "시정 1km 이내 통제"만 적어 **여객용 수면비행선박의 11km 기준을 빠뜨렸다**.'),
        arule('비고 — 기상특보 발표 기준은 「기상법 시행령」에 따르고, "여객용 수면비행선박"·"총톤수"의 뜻을 정한다',
              M, '시행규칙', '10', '1. 기상특보의 발표 기준은 「기상법 시행령」 제8조에 따른다', '적용대상',
              before=0, after=5, sub='제1호 다목 표 비고',
              review='비고 제1호가 「기상법 시행령」 **제8조**를 가리키는데, 현행 「기상법 시행령」(시행 2026.6.30) '
                     '제8조는 "기상현상 및 기상영향에 대한 예보"이고 **특보는 제8조의2**(해양기상특보는 제9조)다. '
                     '기상법 시행령이 2024.2.6 전문개정되면서 조문 번호가 바뀐 것으로 보이나, 별표 10이 그 인용을 '
                     '따라가지 않은 것인지 다른 뜻인지는 raw만으로 단정할 수 없다 — 사람 확인 필요.'),
        rule('별표 10 위임 근거 — 선박 출항통제의 기준 및 절차', M, '시행규칙', '제33조',
             '법 제36조제1항에 따른 선박 출항통제의 기준 및 절차는 별표 10과 같다', '관할', span=200,
             delegate=[{'법령': '해상교통안전법', '계층': '시행규칙', '조문': '별표 10'}]),
    ]
    return {
        'id': 'domestic_passenger_ship', '라벨': '내항여객선',
        '정의': '「해운법」 제2조제1호의2에 따른 여객선 중 국제항해에 종사하지 않는 여객선 및 여객용 수면비행선박',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'passenger_ship', '라벨': '여객선',
                   '관계': '★이 자산에만 있는 파생 분류 — D의 `여객선`을 **국제항해 여부**로 가른 하위 개념이다. '
                           'D는 국제항해를 노드가 아니라 리프의 `추가확인` 축으로 두므로 D에는 이 노드가 없다. '
                           '지시대로 D를 고치지 않고 이 자산에서만 만들었다(L-82: 축이 다르면 억지로 합치지 않는다).'},
        'provenance': [x for x in [
            aprov(M, '시행규칙', '10', '가. 적용선박: 「해운법」 제2조제1호의2에 따른 여객선 중 국제항해에 종사하지',
                  after=1, sub='제1호 가목'),
        ] if x],
        '통제': [x for x in es if x],
        '추가확인': [
            {'축': '항해구역', '질문': '그 내항여객선이 평수구역 밖을 운항하나요?',
             '선택지': [{'label': '평수구역 밖'}, {'label': '평수구역 안'}],
             '영향': ['풍랑·폭풍해일주의보 → 평수구역 밖을 운항하는 내항여객선 통제(앞바다 운항선·총톤수 2,000톤 이상은 출항정지조건등에 해당하지 않으면 허용 가능)',
                      '풍랑·폭풍해일주의보 → 평수구역 안을 운항하는 내항여객선은 출항정지조건등에 해당해 위험하다고 판단될 때에만 통제'],
             '자산참조': {'자산': 'zone_tree.json', '트리': 'navigation_zone', '노드': 'smooth_water_area'},
             '주의': '항해구역은 B(zone_tree.json)의 축이다(L-82).'},
            {'축': '여객용 수면비행선박 여부', '질문': '여객용 수면비행선박인가요?',
             '선택지': [{'label': '여객용 수면비행선박'}, {'label': '그 밖의 내항여객선'}],
             '영향': ['제한된 시계 → 시정 1km 이내면 모든 내항여객선(여객용 수면비행선박 제외), 시정 11km 이내면 여객용 수면비행선박의 출항을 통제해야 한다'],
             '주의': '시계제한 기준이 1km/11km로 갈린다. 이 구분은 D(vessel_doc_tree.json)에 없는 분류다.'},
        ],
        'children': [],
    }


def n_other_general():
    """내항여객선 외의 선박 — 해상교통안전법 시행규칙 별표 10 제2호."""
    M = '해상교통안전법'
    es = [
        arule('적용선박 — 내항여객선을 제외한 선박(수상레저기구·낚시어선·유선 및 도선·어선은 적용하지 않는다)',
              M, '시행규칙', '10', '가. 적용선박: 내항여객선을 제외한 선박',
              '적용대상', before=0, after=5, sub='제2호 가목',
              note='★이 자산의 선종 축이 "지어낸 분류"가 아닌 이유가 여기 있다 — 별표 10 제2호 가목이 **법 스스로** '
                   '수상레저기구·낚시어선·유·도선·어선을 이 기준에서 빼고 각자 소관법으로 보낸다.'),
        arule('출항통제권자는 지방해양수산청장', M, '시행규칙', '10', '나. 출항통제권자: 지방해양수산청장',
              '관할', sub='제2호 나목'),
        arule('풍랑·폭풍해일주의보 → 평수구역 밖 운항 선박 중 총톤수 250톤·길이 35m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박, 수면비행선박',
              M, '시행규칙', '10', '1) 평수구역 밖을 운항하는 선박 중 총톤', '출항·운항 통제',
              before=0, after=5, sub='제2호 다목 표 풍랑·폭풍해일주의보',
              who='평수구역 밖 운항 · 총톤수 250톤 미만 & 길이 35m 미만 · 국제항해에 종사하지 않는 선박 / '
                  '국제항해에 종사하는 예부선 결합선박 / 수면비행선박(여객용 제외)',
              특보=warn('열거', 원문표현='풍랑ㆍ폭풍해일주의보', 현상=['풍랑', '폭풍해일'], 등급=['주의보']),
              note='초안 위키는 "평수구역 밖 250톤·35m 미만"만 적어 **국제항해 예부선 결합선박·수면비행선박 2줄과 '
                   '"국제항해에 종사하지 않는"이라는 한정을 빠뜨렸다**.'),
        arule('풍랑·폭풍해일경보 → 총톤수 1,000톤·길이 63m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박',
              M, '시행규칙', '10', '1) 총톤수 1,000톤 미만으로서 길이 63미', '출항·운항 통제',
              before=0, after=3, sub='제2호 다목 표 풍랑·폭풍해일경보',
              who='총톤수 1,000톤 미만 & 길이 63m 미만 · 국제항해에 종사하지 않는 선박 / 국제항해에 종사하는 예부선 결합선박',
              특보=warn('열거', 원문표현='풍랑ㆍ폭풍해일경보', 현상=['풍랑', '폭풍해일'], 등급=['경보']),
              note='경보 행에는 "평수구역 밖"이라는 장소 한정이 없다 — 주의보 행에만 있다. '
                   '오른쪽 칸에 보이는 "선박의 출항을 통제해 / 야 한다."는 4개 행에 병합된 "통제절차" 칸의 조각이다.'),
        arule('태풍주의보·경보 → 총톤수 7,000톤 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박',
              M, '시행규칙', '10', '1) 총톤수 7,000톤 미만의 국제항해에 종', '출항·운항 통제',
              before=0, after=2, sub='제2호 다목 표 태풍주의보 및 경보',
              who='총톤수 7,000톤 미만 · 국제항해에 종사하지 않는 선박 / 국제항해에 종사하는 예부선 결합선박',
              특보=warn('열거', 원문표현='태풍주의보 및 경보', 현상=['태풍'], 등급=['주의보', '경보'])),
        arule('제한된 시계 → 시정 0.5km 이내면 화물 적재 유조선·가스운반선·화학제품운반선(향도선 활용 시 제외)과 레이더·VHF 미비 선박, 시정 11km 이내면 수면비행선박',
              M, '시행규칙', '10', '1) 화물을 적재한 유조선ㆍ가스운반선', '출항·운항 통제',
              before=0, after=9, sub='제2호 다목 표 제한된 시계',
              who='화물을 적재한 유조선·가스운반선·화학제품운반선 / 레이더 및 초단파 무선전화(VHF) 통신설비를 갖추지 '
                  '않은 선박 / 수면비행선박(여객용 제외)',
              특보=warn('시계제한', 원문표현='제한된 시계 — 시정 0.5킬로미터 이내 / 수면비행선박은 시정 11킬로미터 이내',
                        시계='시정 0.5킬로미터 이내(수면비행선박은 11킬로미터 이내)'),
              excl='향도선(嚮導船)을 활용하는 경우는 제외한다',
              note='초안 위키는 "레이더·VHF 미비 선박"과 "수면비행선박 11km"를 빠뜨렸다.'),
        arule('통제절차 — 출항통제권자가 출항신고 선박의 총톤수·길이·항행구역 등을 확인해 통제대상 여부를 판단한 후 출항을 통제해야 한다',
              M, '시행규칙', '10', '│출항통제권자는 해당       │', '관할',
              before=0, after=8, sub='제2호 다목 표 통제절차',
              who='출항통제권자(지방해양수산청장)',
              note='별표 10 제2호 표의 "통제절차" 칸은 4개 기상상태 행 전체에 걸쳐 병합돼 있다. 그래서 이 줄 블록에는 '
                   '왼쪽 두 칸(풍랑·폭풍해일주의보 행 등)의 글자가 함께 보인다 — 원문 표를 그대로 인용한 결과이고, '
                   '이 항목이 말하는 것은 오른쪽 "통제절차" 칸이다.'),
        arule('완화 — 안전운항 확보·항만의 효율적 운영·재난안전관리를 위해 필요하면 출항통제를 완화하거나 적용하지 않을 수 있다',
              M, '시행규칙', '10', '1. 출항통제권자는 선박의 안전운항 확보', '완화·예외',
              before=0, after=2, sub='제2호 다목 표 비고 제1호',
              who='출항통제권자'),
        arule('"총톤수"·"길이"의 뜻 — 선박국적증서·선적증서 기재값이고, 예부선 결합선박은 예선톤수만을 말한다',
              M, '시행규칙', '10', '“총톤수” 및 “길이”란 선박국적증서', '적용대상',
              before=0, after=2, sub='제2호 다목 표 비고 제2호'),
    ]
    return {
        'id': 'other_general_ship', '라벨': '내항여객선 외의 선박',
        '정의': '내항여객선을 제외한 선박(수상레저기구·낚시어선·유선 및 도선·어선은 제외) — 화물선·유조선·'
                '국제항해 여객선·예부선 결합선박·수면비행선박 등',
        'D_대응': {'자산': 'vessel_doc_tree.json', 'id': 'cargo_ship', '라벨': '화물선·그 밖의 선박',
                   '관계': '★부분 대응 — D의 `cargo_ship`(여객선·유도선이 아닌 선박)보다 넓다. 이 노드에는 '
                           '**국제항해 여객선**도 든다(별표 10 제1호가 내항여객선만 다루기 때문). D의 하위 3노드'
                           '(유조선/산적화물선/그 밖의 화물선)는 이 자산에서 노드로 만들지 않았다 — 별표 10은 화물 종류로 '
                           '갈리지 않고, 시정 0.5km 행에서만 유조선·가스운반선·화학제품운반선을 지목하므로 그 행의 '
                           '`대상` 필드로 표현했다.'},
        'provenance': [x for x in [
            aprov(M, '시행규칙', '10', '가. 적용선박: 내항여객선을 제외한 선박', after=5, sub='제2호 가목'),
        ] if x],
        '통제': [x for x in es if x],
        '추가확인': [
            {'축': '국제항해', '질문': '그 배가 국제항해에 종사하나요?',
             '선택지': [{'label': '국제항해에 종사'}, {'label': '국제항해에 종사하지 않음'}],
             '영향': ['풍랑·폭풍해일주의보 → 평수구역 밖 운항 선박 중 총톤수 250톤·길이 35m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박, 수면비행선박',
                      '풍랑·폭풍해일경보 → 총톤수 1,000톤·길이 63m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박',
                      '태풍주의보·경보 → 총톤수 7,000톤 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박'],
             '주의': '별표 10 제2호의 톤수·길이 기준은 **국제항해에 종사하지 않는 선박**에만 걸린다. 국제항해선은 '
                     '예부선 결합선박일 때만 통제대상으로 열거된다.'},
            {'축': '총톤수·길이', '질문': '그 배의 총톤수와 길이가 얼마인가요?',
             '선택지': [{'label': '250톤 미만이면서 35m 미만'}, {'label': '1,000톤 미만이면서 63m 미만'},
                        {'label': '7,000톤 미만'}],
             '영향': ['풍랑·폭풍해일주의보 → 평수구역 밖 운항 선박 중 총톤수 250톤·길이 35m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박, 수면비행선박',
                      '풍랑·폭풍해일경보 → 총톤수 1,000톤·길이 63m 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박',
                      '태풍주의보·경보 → 총톤수 7,000톤 미만의 국제항해 비종사 선박, 국제항해 예부선 결합선박'],
             '주의': '톤수·길이는 E(tonnage_facet.json)의 축이다(L-82). 선택지 3개는 특보 등급별 경계를 그대로 옮긴 것이라 '
                     '서로 배타적이지 않다 — 배선 시 렌더링 방식을 따로 정해야 한다(E의 CLARIFY_OPTION_MAX 미결과 같은 성격).'},
            {'축': '화물 종류·설비', '질문': '화물을 적재한 유조선·가스운반선·화학제품운반선이거나, 레이더·VHF가 없는 배인가요?',
             '선택지': [{'label': '유조선·가스운반선·화학제품운반선(화물 적재)'},
                        {'label': '레이더·VHF 미비 선박'}, {'label': '그 밖'}],
             '영향': ['제한된 시계 → 시정 0.5km 이내면 화물 적재 유조선·가스운반선·화학제품운반선(향도선 활용 시 제외)과 레이더·VHF 미비 선박, 시정 11km 이내면 수면비행선박'],
             '주의': '시계제한 행에서만 갈리는 축이다.'},
        ],
        'children': [],
    }


# ══════════════════════════════════════════════════════════════════════
# 특보 질문 계산 — "묻지 않아도 답이 같으면 묻지 않는다"
# ══════════════════════════════════════════════════════════════════════
GATING = {'출항·운항 통제', '활동금지', '안전조치', '완화·예외'}
VIS = '제한된 시계'


def applies_to(e, key):
    """통제항목 e가 특보 갈래 key(현상 이름 또는 '제한된 시계')에 걸리는가.

    ★이 함수 하나가 "이 항목이 이 칸에 실릴 자격이 있는가"를 결정한다 — 상속·질문생성·검증이
      모두 같은 규칙을 쓰게 하려는 것이다(L-79 교훈③: 규약을 한 함수로 모아라).
    """
    w = e.get('특보') or {}
    expr = w.get('표현')
    if key == VIS:
        return bool(w.get('시계'))
    if expr == '시계제한':
        return False
    if expr == '해당없음':
        return False
    ph = w.get('현상')
    if expr == '포괄':
        return True if ph is None else (key in ph)
    if expr == '열거':
        return key in (ph or [])
    return False


def grade_applies(e, grade, keys=None):
    """등급(주의보/경보) 갈래에 걸리는가. 등급을 밝히지 않은 항목은 등급을 가리지 않는다.

    `조합`이 있으면 **현상과 등급을 쌍으로** 본다 — "태풍은 등급 불문, 풍랑은 경보만"처럼
    한 항목 안에서 현상마다 등급이 다른 경우를 등급 목록의 합집합으로 읽으면 답이 틀린다.
    """
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


def warning_questions(entries):
    """리프에 상속된 통제항목들로부터 특보 축의 질문·선택지를 **데이터에서 계산**한다.

    규칙: 어떤 갈래를 골라도 걸리는 항목 집합이 같으면 **그 질문은 하지 않는다**
          (zone_tree 설계 §3.4 "답이 달라지지 않는 질문만 하나 늘기"와 같은 원리).
    @param entries 루트→리프 경로상 모든 `통제` 항목(합집합)
    @returns {dict} {'현상': {...}, '등급': [...]}
    """
    gate = [e for e in entries if e['유형'] in GATING and (e.get('특보') or {}).get('표현') != '해당없음']
    keys = []
    for p in PHENOMENA:
        if any((e.get('특보') or {}).get('현상') and p in e['특보']['현상'] for e in gate):
            keys.append(p)
    if any((e.get('특보') or {}).get('시계') for e in gate):
        keys.append(VIS)
    groups = {}
    for k in keys:
        sig = frozenset(e['제목'] for e in gate if applies_to(e, k))
        # ★"제한된 시계"는 걸리는 항목 집합이 어느 특보와 같더라도 **절대 묶지 않는다**.
        #   시계제한은 기상특보가 아니라 시정 기준이라, "태풍·제한된 시계"처럼 한 선택지로 묶으면
        #   사용자에게 "제한된 시계가 특보의 일종"이라는 없는 사실을 만들어 보여 준다(실측: 수상레저기구
        #   리프에서 태풍과 집합이 같아 실제로 묶였다).
        groups.setdefault((sig, k == VIS), []).append(k)
    # 표시 순서는 PHENOMENA 순서 → 시계 마지막
    order = {k: i for i, k in enumerate(PHENOMENA + [VIS])}
    glist = sorted(groups.values(), key=lambda g: min(order[k] for k in g))
    q현상 = {'필요': len(glist) > 1, '질문': None, '선택지': []}
    if len(glist) > 1:
        q현상['질문'] = '지금 어떤 기상특보가 발효돼 있나요?'
        for g in glist:
            g = sorted(g, key=lambda k: order[k])
            label = '·'.join(g)
            src = sorted({(e.get('특보') or {}).get('원문표현') or ''
                          for e in gate if any(applies_to(e, k) for k in g)} - {''})
            q현상['선택지'].append({
                'label': label,
                'hint': ' / '.join(src)[:200] if src else None,
                '현상': g,
                '항목수': len(frozenset(e['제목'] for e in gate if any(applies_to(e, k) for k in g))),
            })
    q등급 = []
    for g in glist if len(glist) > 1 else ([glist[0]] if glist else []):
        g = sorted(g, key=lambda k: order[k])
        if g == [VIS]:
            continue
        sub = [e for e in gate if any(applies_to(e, k) for k in g)]
        gg = {}
        for grade in ['주의보', '경보']:
            sig = frozenset(e['제목'] for e in sub if grade_applies(e, grade, g))
            gg.setdefault(sig, []).append(grade)
        need = len(gg) > 1
        q등급.append({
            '현상': g,
            '필요': need,
            '질문': ('그 특보가 주의보인가요, 경보인가요?' if need else None),
            '선택지': ([{'label': gr, '등급': [gr],
                        '항목수': len(frozenset(e['제목'] for e in sub if grade_applies(e, gr, g)))}
                       for gr in ['주의보', '경보']] if need else []),
        })
    return {'현상': q현상, '등급': q등급}


# ══════════════════════════════════════════════════════════════════════
# 74법 전수 스캔(커버리지 수치 — 트리 내용을 만들지는 않는다)
# ══════════════════════════════════════════════════════════════════════
SCAN_WARN = re.compile(r'기상특보|해양기상특보|기상예비특보|예비특보|풍랑|폭풍해일|태풍|강풍|호우|대설|한파|황사|폭염|주의보|경보')
SCAN_CTRL = re.compile(r'출항|운항|조업|수상레저활동|대피|통제')
SCAN_LIMIT = re.compile(r'제한|금지|통제|아니 된다|할 수 없다|따라야|명할 수 있다')


def scan_corpus():
    """74법 raw 전체(법률계열 + 행정규칙계열 + 별표)를 훑어 커버리지 수치를 만든다.
    3중 조건(특보어 × 출항·운항어 × 제한어)을 같은 조각(700자 이내) 안에서 요구한다."""
    files = articles = cands = 0
    warn_hit, cand_hit = set(), set()
    per_law = {}
    for law in LAWS:
        targets = []
        for f in sorted(os.listdir(law['raw'])):
            if f.endswith('.txt'):
                targets.append((os.path.join(law['raw'], f), True))
        for sub in ('행정규칙', '별표'):
            d = os.path.join(law['raw'], sub)
            if os.path.isdir(d):
                for f in sorted(os.listdir(d)):
                    if f.endswith('.txt'):
                        targets.append((os.path.join(d, f), False))
        for path, legal_tier in targets:
            files += 1
            text = open(path, encoding='utf-8', errors='replace').read()
            units = split_articles(text) if legal_tier else split_articles_plain(text)
            if not units:
                units = {'(전문)': text}
            articles += len(units)
            for body in units.values():
                flat = flatten(body)
                if SCAN_WARN.search(flat):
                    warn_hit.add(law['slug'])
                for i in range(0, max(1, len(flat)), 600):
                    piece = flat[i:i + 700]
                    if SCAN_WARN.search(piece) and SCAN_CTRL.search(piece) and SCAN_LIMIT.search(piece):
                        cands += 1
                        cand_hit.add(law['slug'])
                        per_law[law['slug']] = per_law.get(law['slug'], 0) + 1
                        break
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_warning_term': sorted(warn_hit), 'laws_with_candidates': sorted(cand_hit),
            'per_law_candidates': per_law}


# ══════════════════════════════════════════════════════════════════════
# 검증(빌드 게이트) · 조립 · 출력
# ══════════════════════════════════════════════════════════════════════
def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def path_entries(root, target_id):
    """루트→그 노드 경로상 모든 `통제`의 합집합(경로 상속)."""
    def rec(n, acc):
        acc2 = acc + n.get('통제', [])
        if n['id'] == target_id:
            return acc2
        for c in n.get('children', []):
            r = rec(c, acc2)
            if r is not None:
                return r
        return None
    return rec(root, []) or []


def split_effective(entries):
    """상속된 항목을 **실제로 걸리는 것 / 적용제외로 걸리지 않는 것**으로 가른다.

    ★없으면 뭐가 잘못되나(CLAUDE.md 결정로그): 원양어선 리프는 어선안전조업법이 통째로 적용되지
      않는데(시행령 제3조제1항제2호), 경로 상속만 하면 그 법의 태풍·풍랑·폭풍해일 통제가 그대로
      답으로 나가고 특보 질문까지 그 법 기준으로 만들어진다 — 명백한 오답이다.
      L-79가 지적한 것과 같은 계열의 결함(상속은 범위 필드를 함께 봐야 한다)이라, 산문 `주의`로
      갈음하지 않고 `적용제외_대상법` 필드로 데이터에 적어 코드가 읽게 한다.
    @returns (적용되는 항목[], 적용제외로 멈춘 항목[])
    """
    excl = {e['적용제외_대상법'] for e in entries
            if e['유형'] == '적용제외' and e.get('적용제외_대상법')}
    live, dead = [], []
    for e in entries:
        if e['근거법령_slug'] in excl and e['유형'] != '적용제외':
            dead.append(e)
        else:
            live.append(e)
    return live, dead


def validate(root):
    ids = [n['id'] for n in walk(root)]
    if len(ids) != len(set(ids)):
        ERRORS.append('노드 id 중복: %r' % ids)
    for n in walk(root):
        if not n.get('provenance'):
            ERRORS.append('출처 없는 노드: %s' % n['id'])
        kids = n.get('children', [])
        if kids:
            if not n.get('질문') or not n.get('선택지'):
                ERRORS.append('비-리프에 질문/선택지 없음: %s' % n['id'])
            opts = n.get('선택지', [])
            if len(opts) != len(kids):
                ERRORS.append('선택지 수 ≠ 자식 수: %s (%d/%d)' % (n['id'], len(opts), len(kids)))
            if len(opts) > 3:
                ERRORS.append('선택지 3개 초과(CLARIFY_OPTION_MAX): %s' % n['id'])
            kid_by_id = {c['id']: c for c in kids}
            for o in opts:
                c = kid_by_id.get(o.get('next'))
                if not c:
                    ERRORS.append('깨진 next 참조: %s → %r' % (n['id'], o.get('next')))
                    continue
                # ★L-77 재발방지 불변식 — 화면에 찍히는 선택지 label과 노드 라벨이 다르면
                #   그 노드는 경로 복원에서 영영 도달 불가가 될 수 있다. 이 자산은 둘을 **같게 고정**한다.
                if o.get('label') != c.get('라벨'):
                    ERRORS.append('선택지 label ≠ 자식 라벨(L-77): %s: %r vs %r'
                                  % (n['id'], o.get('label'), c.get('라벨')))
        else:
            if n.get('질문') or n.get('선택지'):
                ERRORS.append('리프에 질문/선택지가 있음: %s' % n['id'])
        titles = {e['제목'] for e in path_entries(root, n['id'])}
        for a in n.get('추가확인', []):
            for t in a.get('영향', []):
                if t not in titles:
                    ERRORS.append('추가확인.영향이 실재하지 않는 항목을 가리킴: %s ← %r' % (n['id'], t))
        for e in n.get('통제', []):
            if e['유형'] not in KINDS:
                ERRORS.append('유형 값 오류: %s / %s' % (n['id'], e['제목']))
            if not e.get('인용'):
                ERRORS.append('인용 없음: %s / %s' % (n['id'], e['제목']))
            if e.get('법령ID') is None and e['근거법령_slug'] not in OTHER_LAWS:
                ERRORS.append('법령ID 없음: %s / %s' % (n['id'], e['제목']))
            w = e.get('특보') or {}
            if w.get('표현') not in EXPR:
                ERRORS.append('특보.표현 오류: %s / %s' % (n['id'], e['제목']))
            # ★불변식 — 인용문은 오직 raw에서 읽어 채운 `인용` 필드에만 있다.
            #   초안에서 `특보.확장근거`에 사람이 타이핑한 인용문을 넣었다가 사람 정독에서 잡혔다
            #   (원문의 괄호 삽입구가 빠져 있었다). 손으로 쓴 인용은 검증기가 대조하지 못해
            #   **환각이 그대로 통과하는 유일한 통로**가 되므로 필드 자체를 막는다.
            if isinstance(w.get('확장근거'), dict) and '인용' in w['확장근거']:
                ERRORS.append('특보.확장근거에 손으로 쓴 인용 금지: %s / %s' % (n['id'], e['제목']))


def main():
    axis = build_warning_axis()
    root = n_root()
    validate(root)

    leaves = [n for n in walk(root) if not n.get('children')]
    over = []
    for lf in leaves:
        ent = path_entries(root, lf['id'])
        live, dead = split_effective(ent)
        lf['특보질문'] = warning_questions(live)
        lf['상속항목수'] = len(ent)
        lf['적용항목수'] = len(live)
        if dead:
            lf['적용제외로_멈춘_항목'] = [e['제목'] for e in dead]
        if len(lf['특보질문']['현상'].get('선택지', [])) > 3:
            over.append({'리프': lf['id'], '선택지수': len(lf['특보질문']['현상']['선택지']),
                         '선택지': [o['label'] for o in lf['특보질문']['현상']['선택지']]})

    all_entries = [e for n in walk(root) for e in n.get('통제', [])]
    if ERRORS:
        print('❌ 빌드 실패 — %d건' % len(ERRORS))
        for x in ERRORS:
            print('  -', x)
        sys.exit(1)

    scan = scan_corpus()
    by_kind, by_tier, by_law = {}, {}, {}
    for e in all_entries:
        by_kind[e['유형']] = by_kind.get(e['유형'], 0) + 1
        by_tier[e['계층']] = by_tier.get(e['계층'], 0) + 1
        by_law[e['근거법령_slug']] = by_law.get(e['근거법령_slug'], 0) + 1

    doc = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': '74법 raw 전수 스캔 — "기상특보가 발효되면 출항·운항·활동을 어디까지 막는가"를 '
                 '선종 × 특보종류 두 축으로 구조화한 자산(H-36 14번째)',
        'semantics': {
            '축이_둘인_이유': '이 주제는 구역(B, zone_tree.json)으로 갈리지 않는다. 같은 풍랑주의보라도 '
                              '어선이냐 유·도선이냐 수상레저기구냐에 따라 근거법·요건·처벌축이 통째로 달라지고, '
                              '그 위에 어떤 특보가 어느 등급으로 떴는지가 다시 갈린다. 두 축은 서로 포함관계가 '
                              '아니므로 한 트리로 합치지 않았다(L-82).',
            '선종축': '트리다. 별표 10 제2호 가목이 수상레저기구·낚시어선·유·도선·어선을 명시적으로 빼고 각자 '
                      '소관법으로 보내므로, 1단계 배타성이 **법 스스로 그은 경계**다(D의 1단계와 같은 성격).',
            '특보축': '트리가 아니라 목록이다. 특보 현상들 사이에는 상하관계가 없다(태풍이 풍랑의 상위가 아니다).',
            '경로_상속': '어떤 배에 걸리는 규정 = 루트에서 그 리프까지 경로상 모든 `통제`의 합집합. '
                         '단 `적용제외` 유형 항목이 함께 실린 리프(원양어선)에서는 상속된 항목이 적용되지 않는다 — '
                         '항목을 지우지 않고 적용제외 항목을 함께 보여 그 사실을 드러낸다(L-79).',
            '특보질문': '리프마다 **데이터에서 계산**한다 — 어떤 특보를 골라도 걸리는 항목 집합이 같으면 그 질문은 '
                        '하지 않는다. 그래서 수상레저기구는 등급 질문이 없고, 어선은 풍랑에서만 등급이 갈린다.',
            '질문_순서': '고정하지 않는다(암시 하강). 질문에 이미 나온 축은 건너뛴다. 다만 **특보 질문의 선택지는 '
                         '그 선종에 실재하는 특보로만 만들어지므로**, 선종이 정해지기 전에는 특보를 물을 수 없다 — '
                         '순서가 규칙이 아니라 데이터 의존관계에서 나온다. 자세한 것은 match_weather_warning_tree.py.',
            '별표_인용': '별표 1·2·10·14는 괘선으로 그린 표라 문장으로 뽑으면 옆 칸 글자와 섞인다. '
                         '억지로 구조화하지 않고 **줄 블록을 원문 그대로** 싣는다(H 자산의 표_원문 규약과 같다).',
        },
        'caveats': [
            '이 자산은 "기상특보 때문에 출항·운항·활동이 막히는가"만 담는다. 출항 자체의 신고·절차(출입항신고 등)는 '
            '별도 자산(port_entry_flow.json) 소관이고, 그 구역에서 갖출 서류·장비는 D·B 소관이다(L-80에 따라 각각 열어 확인했다).',
            '★초안이던 위키 `wiki/comparisons/출항통제_기상특보.md`(status: draft, 사람 미검증)의 수치·조문을 '
            '6개 법 raw와 전량 재대조했고 **누락·부정확 9건을 확인**했다(설계문서 §6.1). 이 자산의 값은 그 재대조 결과다.',
            '해상교통안전법 제116조 벌금 상한(300만원 이하)은 초안의 `REVIEW`를 원문으로 **해소**했다. '
            '반면 선박교통관제법 고시 제8조 위반 ↔ 법 제26조 벌칙의 연결은 원문에 문구가 없어 `REVIEW`로 **유지**한다.',
            '「기상법」 raw는 74법 밖의 발췌수집본(파일 머리 ⚠REVIEW)이라 특보 기준표(시행령 별표 1·2)가 없다. '
            '"풍속 몇 m/s부터 풍랑주의보인가"는 이 자산에 없다.',
            '해역·항해구역(평수구역 등)·톤수·길이는 이 자산의 축이 아니라 각각 B(zone_tree.json)·E(tonnage_facet.json)의 '
            '축이다(L-82). 리프의 `추가확인`에서 가리키기만 하고 질문·선택지를 복제하지 않았다.',
            '★특보 축의 선택지가 3개(CLARIFY_OPTION_MAX)를 넘는 리프가 있다 — `summary.특보선택지_상한초과` 참조. '
            '억지로 묶지 않았다(E 톤수 사전이 9구간을 그대로 둔 것과 같은 판단). 배선 시 렌더링 방식을 따로 정해야 한다.',
            '별표 2(어선 출항가능 해역)·별표 2(유·도선 해수면 범위)는 좌표·지형지물 서술이라 프로그램이 판정할 수 없다. '
            '표 원문을 그대로 보여 사람이 판단하게 한다.',
            '자치법규·국제협약은 스캔 대상이 아니다. 스캔의 3중 조건을 통과하지 못한 법이 곧 "이 주제 규정이 없는 법"은 '
            '아니다(zone_tree §5.2와 같은 사각지대).',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned': scan['files'],
            'articles_scanned': scan['articles'],
            'laws_contributing': len(by_law),
            'nodes': len(list(walk(root))),
            'leaves': len(leaves),
            'entries': len(all_entries),
            'entries_by_kind': dict(sorted(by_kind.items(), key=lambda x: -x[1])),
            'entries_by_tier': dict(sorted(by_tier.items(), key=lambda x: -x[1])),
            'entries_by_law': dict(sorted(by_law.items(), key=lambda x: -x[1])),
            'entries_with_REVIEW': sum(1 for e in all_entries if e.get('REVIEW')),
            'leaf_inherited': {lf['id']: lf['상속항목수'] for lf in leaves},
            'leaf_effective': {lf['id']: lf['적용항목수'] for lf in leaves},
            '특보선택지_상한초과': over,
        },
        'scan': {
            '설명': '3중 조건(특보어 × 출항·운항어 × 제한어)을 같은 조각 안에서 요구했다. 후보가 0건이라고 해서 '
                    '그 법에 이 주제 규정이 없다는 확증은 아니다(합성 정의어·문장분리 경계 사각지대).',
            'laws_with_warning_term': len(scan['laws_with_warning_term']),
            'laws_with_candidates': len(scan['laws_with_candidates']),
            'candidate_pieces': scan['candidates'],
            'per_law_candidates': dict(sorted(scan['per_law_candidates'].items(), key=lambda x: -x[1])),
            'laws_without_candidates': sorted(
                {l['slug'] for l in LAWS} - set(scan['laws_with_candidates']) - set(by_law)),
        },
        'unmapped': {
            '유형_단위': [
                {'유형': '출입항 신고 절차 자체', '표시': '출입항 신고',
                 '예': '어선안전조업법 제8조·제9조, 낚시법 제33조, 선박입출항법',
                 '사유': '기상특보로 갈리는 축이 아니다 — 별도 자산 port_entry_flow.json 소관(실제로 열어 확인했다, L-80).'},
                {'유형': '구역별 설비·장비 수량', '표시': '구역별 설비 기준',
                 '예': '「선박설비기준」·「선박구명설비기준」의 항해구역별 기준',
                 '사유': 'B(zone_tree.json)가 2026-08-11 고시 확장으로 이미 담았다(적용항목 107건). 열어서 확인했다.'},
                {'유형': '기상특보와 무관한 운항 제한', '표시': '야간·시간 제한',
                 '예': '유·도선법 제8조제2항(영업시간), 수상레저안전법 제26조(야간 수상레저활동 금지)',
                 '사유': '기상특보가 트리거가 아니다. 다만 낚시법 시행령 제19조제5호(일출 전·일몰 후)는 같은 조의 '
                         '출항제한 기준 6가지 중 하나라, 빼면 "기준이 5가지"로 보이는 거짓 공백이 생겨 그대로 실었다.'},
                {'유형': '기상특보로 인한 다른 효과', '표시': '기상특보의 다른 효과',
                 '예': '낚시법 시행령 제6조제1호(낚시터업 허가 유효기간 단축 사유 중 기상특보), '
                       '어선안전조업법 시행규칙 제8조·제9조(선단 이탈·조업자제해역 항행의 예외 사유 중 "기상특보 발효에 따라 대피하는 경우")',
                 '사유': '출항·운항·활동을 막는 규정이 아니라 다른 제도의 예외·사유로 기상특보를 쓰는 것이라 이 축이 아니다. '
                         '다음 라운드 검토 대상으로 남긴다.'},
                {'유형': '연안사고 예방법의 출입통제구역', '표시': '연안 출입통제구역',
                 '예': '연안사고 예방에 관한 법률 제10조',
                 '사유': '기상특보가 아니라 **상시 위험장소**를 기준으로 하는 제도다(초안 위키도 "인접 테마"로 구분했다). '
                         '축이 달라 담지 않는다(L-82).'},
            ],
            '스캔밖_표시': '자치법규(raw/_자치법규/)·국제협약 텍스트',
        },
        '축': [
            {'id': 'vessel_kind', '종류': '트리', '라벨': '선종',
             '설명': '어떤 배·어떤 활동이냐 — 근거법과 처벌축을 통째로 가른다.',
             '진입키워드': ['어선', '낚시어선', '낚싯배', '원양어선', '수상레저', '제트스키', '모터보트', '요트',
                            '유선', '도선', '유람선', '여객선', '내항여객선', '카페리', '화물선', '상선', '유조선',
                            '예부선', '수면비행선박', '관제대상선박'],
             'D_대응_요약': 'D(vessel_doc_tree.json)의 선종 계층과 8개 노드가 id·라벨 그대로 겹친다. '
                            '겹치지 않는 2개(내항여객선 · 내항여객선 외의 선박)는 이 자산에만 있는 파생 분류로 두고 '
                            'D를 고치지 않았다(지시·L-82).',
             'tree': root},
            axis,
        ],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    print('✅ %s' % os.path.relpath(OUT, LEGAL))
    print('   노드 %d · 리프 %d · 통제항목 %d · 기여법 %d'
          % (doc['summary']['nodes'], doc['summary']['leaves'],
             doc['summary']['entries'], doc['summary']['laws_contributing']))
    print('   유형별: %s' % doc['summary']['entries_by_kind'])
    print('   계층별: %s' % doc['summary']['entries_by_tier'])
    print('   REVIEW %d건 · 특보선택지 상한초과 리프 %d개'
          % (doc['summary']['entries_with_REVIEW'], len(over)))


if __name__ == '__main__':
    main()
