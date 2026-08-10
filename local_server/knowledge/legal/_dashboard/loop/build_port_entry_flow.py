#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
"출입항 신고 · 위치보고" 절차 플로우 빌더 겸 검증기 (H-32 확장).

역할(초보자용):
  74법 raw 원문을 훑어 "배가 항구를 드나들 때 / 바다에서 위치를 알릴 때 무엇을 어떤 순서로
  해야 하는가"를 근거조문과 함께 순서 있는 흐름(JSON)으로 만든다. 사람이 손으로 인용문이나
  기한을 타이핑하지 않는다 — 아래 SPEC에는 "어느 법 몇 조에 이런 문구가 있다"만 적고,
  인용문은 이 스크립트가 raw 파일을 직접 열어 뽑아 온다. 문구·기한·순서근거가 raw에 없으면
  그 자리에서 빌드를 실패시킨다(환각 0).

  ★이 자산이 트리가 아니라 플로우인 이유: 출입항은 "분류"가 아니라 "순서"다. 자세한 근거는
  설계문서 §0 참조.

[연계]
  읽기: local_server/knowledge/legal/raw/**/{법률,시행령,시행규칙}.txt · raw/**/행정규칙/*.txt
        각 법 _meta.json(법령ID) · 행정규칙/_admrul.json(고시ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/port_entry_flow.json
  설계: _dashboard/H32_port_entry_flow_design.md (스키마·순서근거 3분류·검증 기준)
  이식: _dashboard/H32_vessel_doc_tree_design.md · loop/build_vessel_doc_tree.py
        (헤더 규약·provenance 규약·계열별 조문분리(L-54)를 그대로 따름)

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_port_entry_flow.py
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
OUT = os.path.join(DASH, 'port_entry_flow.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt',
             '시행령_발췌': '시행령_발췌.txt'}
ADM = '행정규칙'
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')       # 법률계열(대괄호)
RE_ART_ADM = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(')          # 고시계열(무대괄호, L-54)
HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

ERRORS = []


def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법.
    근거: build_vessel_doc_tree.py가 채택한 것과 같은 목록(H-29 §2)."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}


# ── 조문 분리 — 계열별 이중 형식(L-54) ──────────────────────────────
def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다."""
    out, cur, buf = {}, None, []
    for line in text.split('\n'):
        m = RE_ART.match(line.strip())
        if m:
            if cur and cur not in out:
                out[cur] = '\n'.join(buf)
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            buf = [line.strip()]
        else:
            if cur is not None:
                buf.append(line)
    if cur and cur not in out:
        out[cur] = '\n'.join(buf)
    return out


def split_articles_admrul(text):
    """고시계열 raw(`제7조(제목) ①…`, 대괄호 없음)를 조 단위로 쪼갠다(L-54).
    ★첫 등장만 채택 — 본문 뒤에 표 전사 부록이 붙어 조 마커에 다시 걸리는 파일이 있다."""
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


_adm_cache = {}
_adm_meta = {}


def admrul_path(slug, notice):
    return os.path.join(BY_SLUG[slug]['raw'], ADM, notice + '.txt')


def admrul_body(slug, notice, article):
    """(법, 고시명(파일명), 조) → 그 조의 raw 원문 전체. 없으면 None."""
    key = (slug, notice)
    if key not in _adm_cache:
        p = admrul_path(slug, notice)
        _adm_cache[key] = split_articles_admrul(
            open(p, encoding='utf-8', errors='replace').read()) if os.path.exists(p) else {}
    return _adm_cache[key].get(article)


def admrul_id(slug, notice):
    """행정규칙/_admrul.json 의 ID(일련번호). ★개정되면 값이 바뀐다(L-73)."""
    p = os.path.join(BY_SLUG[slug]['raw'], ADM, '_admrul.json')
    if p not in _adm_meta:
        _adm_meta[p] = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    flat = {re.sub(r'\s+', '', k): v for k, v in _adm_meta[p].items()}
    return (flat.get(re.sub(r'\s+', '', notice)) or {}).get('ID')


def law_id(slug, tier):
    """_meta.json의 families.<계층>.법령ID — 법령명이 바뀌어도 추적이 끊기지 않게(L-74)."""
    law = BY_SLUG.get(slug)
    if not law:
        return None
    p = os.path.join(law['raw'], '_meta.json')
    if not os.path.exists(p):
        return None
    fam = json.load(open(p, encoding='utf-8')).get('families', {})
    return (fam.get(tier.replace('_발췌', '')) or {}).get('법령ID')


def rel(slug, tier):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], TIER_FILE[tier]), LEGAL)


def rel_admrul(slug, notice):
    return os.path.relpath(admrul_path(slug, notice), LEGAL)


# ── 인용문 추출 — 사람이 타이핑하지 않는다 ──────────────────────────
RE_HO = re.compile(r'(?<= )\d+(?:의\d+)?\.\s')          # 호 마커("1. ", "2의2. ")
RE_MOK = re.compile(r'(?<= )[가나다라마바사아자차카타파하]\.\s')   # 목 마커("가. ", "나. ")


OPEN, CLOSE = '([「<', ')]」>'


def _list_start(flat, i):
    """i 직전의 호 마커 위치 — 여러 호를 나열한 조문에서 인용이 조 첫머리부터 시작해
    400자 상한에 anchor가 잘리는 것을 막는다."""
    last = -1
    for m in RE_HO.finditer(flat, 0, i):
        last = m.start()
    return last


def _end_of(flat, i, span):
    """anchor 위치 i 뒤의 문장 끝을 찾는다.

    ①괄호 안의 "…말한다. 이하 같다)"에서 잘리지 않도록 괄호 깊이가 0인 곳만 문장 끝으로 본다
    ②고시는 "…한다.②"처럼 마침표 뒤 공백이 없으므로 항 기호도 문장 끝 신호로 본다
    ③다음 항(②)·호("2. ")·목("가. ")을 만나면 거기서 끊는다 — 다른 항·호의 내용이 섞이지 않게
    ④"가. 나. 다." 목 마커의 "다."를 문장 끝으로 오인하지 않도록, 앞 글자가 공백이면 건너뛴다
      (이 규칙이 없으면 "…신고 가. 선박명 나. 선박의 위치 다."처럼 잘린 인용이 나온다).
    @returns 문장 끝 인덱스(배타적)"""
    cap = len(flat)
    for rx in (RE_HO, RE_MOK):
        m = rx.search(flat, i + 1)
        if m and m.start() < cap:
            cap = m.start()
    for h in HANG:
        j = flat.find(h, i + 1)
        if j >= 0 and j < cap:
            cap = j
    depth = 0
    j = i
    while j < cap:
        c = flat[j]
        if c in OPEN:
            depth += 1
        elif c in CLOSE:
            depth = max(0, depth - 1)
        elif depth == 0 and flat.startswith('다.', j) and j > 0 and flat[j - 1] != ' ':
            nxt = flat[j + 2:j + 3]
            if nxt == '' or nxt == ' ' or nxt in HANG:
                return j + 2
        j += 1
    return min(cap, i + span) if cap < len(flat) else min(len(flat), i + span)


def quote_of(body, anchor, span=220):
    """법률계열 원문에서 anchor를 포함한 문장을 뽑아 인용문으로 쓴다.
    항 기호(① …)나 호 마커(1. …)가 앞에 있으면 그 자리를 문장 시작으로 본다
    (괄호 안 '…말한다.'에서 잘리거나, 호 나열 조문에서 anchor가 상한에 잘리는 것 방지)."""
    flat = re.sub(r'\s+', ' ', body)
    i = flat.find(anchor)
    if i < 0:
        return None
    start = -1
    for mark in HANG:   # 공백이 붙은 것("① ")·안 붙은 것("①선박의") 둘 다 있다
        j = flat.rfind(mark, 0, i)
        if j > start:
            start = j
    j = _list_start(flat, i)
    if j > start:
        start = j
    if start < 0:
        start = max(0, flat.rfind('. ', 0, i) + 1)
    end = _end_of(flat, i, span)
    if end <= i:
        end = min(len(flat), i + span)
    return flat[start:end].strip()[:420]


def quote_of_admrul(body, anchor, span=280):
    """고시계열 전용 — 고시는 항 기호 뒤 공백이 없는 경우가 많아(`①고정식…`) 별도 함수를 둔다."""
    flat = re.sub(r'\s+', ' ', body)
    i = flat.find(anchor)
    if i < 0:
        return None
    start = 0
    for mark in HANG:
        j = flat.rfind(mark, 0, i)
        if j > start:
            start = j
    j = flat.rfind('다. ', 0, i)
    if j + 3 > start:
        start = j + 3
    j = _list_start(flat, i)
    if j > start:
        start = j
    end = _end_of(flat, i, span)
    if end <= i:
        end = min(len(flat), i + span)
    return flat[start:end].strip()[:420]


def _body_and_quote(slug, tier, article, anchor, notice):
    """(본문, 인용문, 위치설명) — 계열에 맞는 분리·인용 함수를 고른다."""
    if tier == ADM:
        body = admrul_body(slug, notice, article)
        where = '%s / %s / %s' % (slug, notice, article)
        q = quote_of_admrul(body, anchor) if body is not None else None
    else:
        body = article_body(slug, tier, article)
        where = '%s / %s / %s' % (slug, tier, article)
        q = quote_of(body, anchor) if body is not None else None
    return body, q, where


# ── 74법 전수 스캔(커버리지 산출용) ────────────────────────────────
# 설계 §5.2의 3중 조건(사건어 × 행위어 × 주체어). 플로우 내용을 만들지는 않고,
# "어디까지 훑었는지"를 수치로 남기기 위해 매 빌드마다 실제로 다시 돌린다.
SCAN_EVENT = re.compile(r'(출입항|입출항|출항|입항|출어|출역|입역|기항'
                        r'|위치통지|위치보고|위치발신|위치추적|조업상황.{0,6}보고|진입.{0,8}보고)')
SCAN_ACT = re.compile(r'(신고|보고|통보|허가|등록|통지|제출|발신|승인|기록)')
SCAN_WHO = re.compile(r'(선박|어선|여객선|유선|도선|수상레저기구|낚시어선|모터보트|요트'
                      r'|선장|선박소유자|어선의 소유자|사업자)')
SCAN_EXC = re.compile(r'(과태료|벌금|징역|벌칙)')


def scan_corpus():
    """74법 raw 전체(법률계열 + 행정규칙계열)를 훑어 커버리지 수치를 만든다.
    @returns {files, articles, candidates, laws_with_candidates:[slug…]}
    [연계] 설계 §5.2 · §8 성공기준 1번(커버리지 공개)."""
    files = articles = cands = 0
    hit = set()
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
            arts = split_articles(text) if bracket else split_articles_admrul(text)
            articles += len(arts)
            for _, body in arts.items():
                t = re.sub(r'\s+', ' ', body)
                for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)', t):
                    s = s.strip()
                    if not s or len(s) > 800 or SCAN_EXC.search(s):
                        continue
                    if SCAN_EVENT.search(s) and SCAN_ACT.search(s) and SCAN_WHO.search(s):
                        cands += 1
                        hit.add(law['slug'])
                        break
    return {'files': files, 'articles': articles, 'candidates': cands,
            'laws_with_candidates': sorted(hit)}


# ═══════════════════════════════════════════════════════════════════
# 단계·근거 생성기
# ═══════════════════════════════════════════════════════════════════
def prov(slug, tier, article, anchor, notice=None, disp=None):
    """플로우의 `적용대상_근거` 1건 — 출처 없는 플로우는 만들지 않는다."""
    body, q, where = _body_and_quote(slug, tier, article, anchor, notice)
    if body is None:
        ERRORS.append('적용대상근거: 조문 없음: %s' % where)
        return None
    if q is None:
        ERRORS.append('적용대상근거: 원문에 앵커 없음: %s ← "%s"' % (where, anchor))
        return None
    e = {'법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': tier,
         '조문': disp or article,
         '파일': rel_admrul(slug, notice) if tier == ADM else rel(slug, tier),
         '인용': q}
    if tier == ADM:
        e['고시명'] = notice
        e['고시ID'] = admrul_id(slug, notice)
    else:
        e['법령ID'] = law_id(slug, tier)
    return e


def step(no, name, slug, tier, article, anchor, who, act,
         org=None, deadline=None, basis='명시', basis_text=None, basis_why='',
         notice=None, cond=None, prev=None, branch=None, note=None, also=None):
    """단계 1건(설계 §2.3).

    anchor      = 인용문을 뽑을 자리이자 1차 검증 문구. 그 조문 원문에 없으면 빌드 실패.
    deadline    = 기한. ★raw 원문 부분문자열이어야 한다 — 숫자를 요약하다 틀리면 곧바로
                  오답이 되므로 빌더가 원문에서 다시 찾는다. 없으면 None(지어내지 않는다).
    basis       = 순서근거 종류: 명시 | 조건연쇄 | 미확정  (설계 §3)
    basis_text  = 순서근거 문구. 명시/조건연쇄면 원문 부분문자열이어야 하고, 미확정이면 None.
    branch      = {'질문': str, '갈래': [{'조건': str, '다음': [순번…]}, …]}  (설계 §4)
    also        = 인용문에 안 담겨도 그 조문 안에 있어야 하는 추가 검증 문구들.
    @returns 단계 dict 또는 None(오류 시 ERRORS에 기록)
    """
    body, q, where = _body_and_quote(slug, tier, article, anchor, notice)
    if body is None:
        ERRORS.append('단계 %s: 조문 없음: %s' % (no, where))
        return None
    if q is None:
        ERRORS.append('단계 %s: 원문에 앵커 없음: %s ← "%s"' % (no, where, anchor))
        return None
    flat = re.sub(r'\s+', ' ', body)
    if anchor not in re.sub(r'\s+', ' ', q):
        ERRORS.append('단계 %s: 인용문에 앵커가 안 담김(문장 경계 탐지 실패): %s ← "%s"'
                      % (no, where, anchor))
        return None
    for a in (also or []):
        if a not in flat:
            ERRORS.append('단계 %s: also 문구 없음: %s ← "%s"' % (no, where, a))
            return None
    # ★기한 불변식 — 원문 부분문자열이어야 한다(설계 §2.3-3)
    if deadline is not None and deadline not in flat:
        ERRORS.append('단계 %s: 기한이 원문에 없음: %s ← "%s"' % (no, where, deadline))
        return None
    # ★순서근거 불변식 — 설계 §3
    if basis not in ('명시', '조건연쇄', '미확정'):
        ERRORS.append('단계 %s: 순서근거 종류가 잘못됨: %s' % (no, basis))
        return None
    if basis == '미확정':
        if basis_text is not None:
            ERRORS.append('단계 %s: 미확정인데 순서근거 문구가 있음: %s' % (no, where))
            return None
    else:
        if not basis_text:
            ERRORS.append('단계 %s: 순서근거 문구가 없음(%s): %s' % (no, basis, where))
            return None
        if basis_text not in flat:
            ERRORS.append('단계 %s: 순서근거 문구가 원문에 없음: %s ← "%s"'
                          % (no, where, basis_text))
            return None
    e = {
        '순번': no, '단계명': name, '수행주체': who, '상대기관': org, '행위': act,
        '기한': deadline,
        '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug, '계층': tier,
        '근거조문': article,
        '파일': rel_admrul(slug, notice) if tier == ADM else rel(slug, tier),
        '인용': q,
        '순서근거': {'종류': basis, '문구': basis_text, '설명': basis_why},
        '선행단계': prev or [],
        '조건': cond,
    }
    if tier == ADM:
        e['고시명'] = notice
        e['고시ID'] = admrul_id(slug, notice)
    else:
        e['법령ID'] = law_id(slug, tier)
    if basis == '미확정':
        e['순서주의'] = '원문이 이 단계의 선후를 정하지 않았다 — 배열 위치는 읽기 편의일 뿐이다.'
    if branch:
        e['분기'] = branch
    if note:
        e['주의'] = note
    return e


def flow(fid, title, topic, target, target_prov, org, trigger, steps, tree_nodes=None):
    """플로우 1건."""
    return {'id': fid, '제목': title, '주제': topic, '적용대상': target,
            '적용대상_근거': target_prov, '주관기관': org, '트리거': trigger,
            '관련_트리노드': tree_nodes or [], '단계': steps,
            '분기수': sum(1 for s in steps if s and s.get('분기'))}


# ═══════════════════════════════════════════════════════════════════
# SPEC — "어느 법 몇 조"와 "그 조문에 있어야 할 문구"만 적는다.
#         인용문·법령ID·고시ID는 빌더가 raw에서 직접 읽어 채운다.
# ═══════════════════════════════════════════════════════════════════
FS = '어선안전조업및어선원의안전ㆍ보건증진등에관한법률'   # 어선안전조업법
PT = '선박의입항및출항등에관한법률'                        # 선박입출항법
AN = '낚시관리및육성법'
SR = '수상에서의수색ㆍ구조등에관한법률'
VT = '선박교통관제에관한법률'
IS = '국제항해선박및항만시설의보안에관한법률'
BW = '선박평형수(船舶平衡水)관리법'
DW = '원양산업발전법'
IM = '출입국관리법'
EF = '유선및도선사업법'
MA = '마리나항만의조성및관리등에관한법률'
FV = '어선법'
SS = '선박안전법'
WL = '수상레저안전법'
VPASS = '선박패스(V-Pass)장치의설치기준및운영등에관한고시'
PSMA = '항만국조치협정이행에관한고시'


def build():
    flows = []

    # ── 1. 어선의 항포구 출입항 신고 ─────────────────────────────
    flows.append(flow(
        'fishing_vessel_port_report', '어선의 항포구 출입항 신고', '출입항',
        '항포구에 출입항하려는 어선의 소유자 또는 선장',
        [prov(FS, '법률', '제2조', '"항포구"란 어선이 조업 또는 항행 등을 위하여 출항 또는 입항',
              disp='제2조제8호'),
         prov(FS, '법률', '제2조', '"신고기관"이란 어선의 출입항 신고업무를 담당하는',
              disp='제2조제9호')],
        '신고기관(해양경찰서 소속 파출소·출장소·대행신고소)',
        '어선이 항포구에 출항 또는 입항하려는 때',
        [
            step(1, '출입항 신고 의무 발생', FS, '법률', '제8조',
                 '항포구에 출입항하려는 어선의 소유자 또는 선장은 신고기관에 신고하여야 한다',
                 '어선의 소유자 또는 선장', '신고', org='신고기관',
                 basis='명시', basis_text='항포구에 출입항하려는',
                 basis_why='원문이 이 의무의 발생 시점을 "항포구에 출입항하려는" 때로 정했다.',
                 cond='다만 「수산업법」 제27조제1항 관리선 사용지정 어선 등은 특정해역·조업자제해역·'
                      '관할 해양경찰서장이 지정한 해역에 출어하는 경우에만 신고한다(같은 항 단서).',
                 branch={'질문': '어선위치발신장치를 갖추고 정상적으로 작동하면서 출입항하시나요?',
                         '갈래': [
                             {'조건': '어선위치발신장치를 정상 작동하여 출입항 — 출입항 신고를 한 것으로 봄',
                              '다음': [2]},
                             {'조건': '최초로 신고하는 경우 · 승선원 명부 등 어선출입항신고서 내용에 변동이 있는 경우 · '
                                      '특정해역이나 조업자제해역에 출어하는 경우',
                              '다음': [3]},
                             {'조건': '그 밖의 경우(서면·전자·전화 신고)', '다음': [3]}]}),
            step(2, '어선위치발신장치 정상작동에 따른 신고 갈음', FS, '법률', '제8조',
                 '어선위치발신장치를 갖추고 이를 정상적으로 작동하여 출입항하는 어선은 제1항에 따른 출입항 신고를 한 것으로 본다',
                 '어선의 소유자 또는 선장', '신고', org='신고기관',
                 basis='조건연쇄', basis_text='제1항에 따른 출입항 신고를 한 것으로 본다',
                 basis_why='제1항의 신고 의무를 이 장치 작동이 대체한다 — 제1항이 없으면 성립하지 않는다.',
                 prev=[1],
                 cond='최초 신고·신고서 내용 변동·특정해역이나 조업자제해역 출어인 경우에는 갈음되지 않는다.'),
            step(3, '어선출입항신고서 기재사항 작성', FS, '시행규칙', '제3조',
                 '법 제8조제3항에서 "신고인 인적사항, 승선원 명부 등 해양수산부령으로 정하는 사항"이란',
                 '어선의 소유자 또는 선장', '제출', org='신고기관',
                 basis='조건연쇄', basis_text='법 제8조제3항에서',
                 basis_why='법 제8조제3항의 위임을 받아 신고서에 무엇을 적을지 정한 조문이라 신고서 제출보다 앞선다.',
                 prev=[1],
                 cond='신고인 인적사항·승선원 명부·어선의 제원·출항 일시와 출항지·조업 업종 및 해역·'
                      '입항예정 일시 및 장소(출항 시)·입항 일시 및 장소(입항 시)·평균조업일수',
                 also=['입항예정 일시 및 장소(출항하는 경우만 해당한다)', '평균조업일수']),
            step(4, '어선출입항신고(확인)서 제출·확인 후 어선에 갖춰 둠', FS, '시행규칙', '제2조',
                 '어선출입항신고(확인)서를 출입항하려는 항포구를 관할하는 신고기관',
                 '어선의 소유자 또는 선장', '신고', org='신고기관',
                 basis='조건연쇄', basis_text='법 제8조제1항에 따라 출입항 신고를 하려는',
                 basis_why='법 제8조제1항 신고의 구체적 방법을 정한 조문이다.',
                 prev=[1, 3],
                 cond='최초 출입항 신고 · 신고(확인)서 기재 내용 변동 · 특정해역이나 조업자제해역 출어인 '
                      '경우에는 관할 해양경찰서 소속 파출소 및 출장소로 한정한다.',
                 branch={'질문': '어떤 방법으로 신고하시겠어요?',
                         '갈래': [
                             {'조건': '어선출입항신고(확인)서를 직접 제출(원칙)', '다음': [7]},
                             {'조건': '승선원 명부·조업 업종·평균조업일수 변동 — 인터넷 등 전자적 방법',
                              '다음': [5]},
                             {'조건': '총톤수 5톤 미만 어선 — 전화 등', '다음': [6]}]},
                 also=['해당 확인서를 어선에 갖춰 두어야 한다']),
            step(5, '전자적 방법에 의한 출입항 신고', FS, '시행규칙', '제2조',
                 '인터넷 등을 이용한 전자적 방법으로 출입항 신고를 할 수 있다',
                 '어선의 소유자 또는 선장', '신고', org='신고기관',
                 basis='조건연쇄', basis_text='제1항에 따른 어선출입항신고(확인)서의 제출을 갈음하여',
                 basis_why='제1항 서면 제출을 갈음하는 방법이라 제1항 없이는 성립하지 않는다.',
                 prev=[4],
                 cond='변동 사항이 승선원 명부·조업 업종·평균조업일수인 경우. 총톤수 5톤 미만 어선으로서 '
                      '직전 신고 시 승선원 수가 2명 이하이면 전화로도 가능.'),
            step(6, '전화 등에 의한 출입항 신고(총톤수 5톤 미만)', FS, '시행규칙', '제2조',
                 '총톤수 5톤 미만 어선의 소유자 또는 선장은 제1항 각 호의 경우 외에는',
                 '총톤수 5톤 미만 어선의 소유자 또는 선장', '신고', org='신고기관',
                 basis='조건연쇄', basis_text='제1항에 따른 어선출입항신고(확인)서 제출을 갈음하여',
                 basis_why='제1항 서면 제출을 갈음하는 방법이다.',
                 prev=[4],
                 cond='최초 신고·기재내용 변동·특정해역이나 조업자제해역 출어인 경우는 제외한다.'),
            step(7, '출항 후 입항예정 일시·장소 변동 통보', FS, '시행규칙', '제2조',
                 '어선이 출항한 후 어선출입항신고(확인)서에 기재된 입항예정 일시 및 장소에 변동이 있을 때에는',
                 '어선의 소유자 또는 선장', '통보',
                 org='관할 해양경찰서 신고기관 또는 어선안전조업본부',
                 basis='명시', basis_text='어선이 출항한 후',
                 basis_why='원문이 이 통보의 시점을 "어선이 출항한 후"로 못박았다 — 출항 이후 단계다.',
                 prev=[4]),
            step(8, '신고기관의 어선 출항·입항 종합정보시스템 기록·관리', FS, '시행규칙', '제2조',
                 '어선 출항ㆍ입항 종합정보시스템에 제1항에 따라 확인한 내용과 제2항에 따라 신고를 받은 내용을 기록ㆍ관리해야 한다',
                 '신고기관의 장', '기록',
                 basis='조건연쇄', basis_text='제1항에 따라 확인한 내용과 제2항에 따라 신고를 받은 내용을',
                 basis_why='제1항·제2항의 신고가 접수된 뒤에야 기록할 내용이 생긴다.',
                 prev=[4, 5]),
            step(9, '신고기관이 없는 항포구에 입항한 경우 인근 신고기관 신고', FS, '법률', '제9조',
                 '어선이 항포구에 입항한 경우 어선의 선장은 입항한 항포구 인근에 있는 신고기관에 신고하여야 한다',
                 '어선의 선장', '신고', org='입항한 항포구 인근 신고기관',
                 basis='명시', basis_text='어선이 항포구에 입항한 경우',
                 basis_why='원문이 "입항한 경우"로 시점을 정했다 — 입항 이후 단계다.',
                 cond='어선은 신고기관이 설치되지 아니한 항포구에는 출입항할 수 없으나, 기상 악화에 따른 피항, '
                      '기관 고장 등으로 인한 표류, 그 밖의 부득이한 사정이 있는 경우는 예외.',
                 also=['신고기관이 설치되지 아니한 항포구에는 출입항하여서는 아니 된다']),
        ], tree_nodes=['fishing_vessel']))

    # ── 2. 특정해역·조업자제해역 출어(출어등록·선단편성) ──────────
    flows.append(flow(
        'fishing_vessel_special_area_departure', '특정해역·조업자제해역 출어 절차(출어등록·선단 편성)', '출입항',
        '특정해역 또는 조업자제해역에서 조업하려는 어선의 소유자 또는 선장',
        [prov(FS, '법률', '제2조', '"특정해역"이란 동해 및 서해의 조업한계선 이남(以南)해역',
              disp='제2조제4호'),
         prov(FS, '법률', '제2조', '"조업자제해역"이란 북한 및 러시아 등의 배타적 경제수역(EEZ)과 인접한',
              disp='제2조제6호')],
        '관할 해양경찰서 신고기관 · 어선안전조업본부',
        '특정해역 또는 조업자제해역에서 조업하려는 때',
        [
            step(1, '출어등록 신청', FS, '시행규칙', '제6조',
                 '출어등록신청서 및 신분증 사본을 관할 해양경찰서 신고기관의 장에게 제출해야 한다',
                 '어선의 소유자 또는 선장', '등록', org='관할 해양경찰서 신고기관',
                 basis='조건연쇄', basis_text='법 제12조에 따라 출어등록을 하려는 경우에는',
                 basis_why='법 제12조의 출어등록 의무를 이행하는 첫 행위다.',
                 cond='특정해역 또는 조업자제해역에서 조업하려는 어선에 한한다(법 제12조제1항).'),
            step(2, '출어등록번호 부여·출어등록증 발급', FS, '시행규칙', '제6조',
                 '출어등록을 한 자에게 출어등록번호를 부여하고',
                 '해양경찰서 신고기관의 장', '등록',
                 basis='조건연쇄', basis_text='출어등록을 한 자에게 출어등록번호를 부여하고',
                 basis_why='제1항의 신청이 접수돼 "출어등록을 한 자"가 생겨야 성립한다.',
                 prev=[1],
                 also=['출어등록증을 발급해야 한다']),
            step(3, '출어등록대장 기록·보관 및 어업관리단·안전본부 통보', FS, '시행규칙', '제6조',
                 '출어등록대장에 기록ㆍ보관하고, 어업관리단 및 안전본부에 통보해야 한다',
                 '해양경찰서 신고기관의 장', '기록',
                 basis='조건연쇄', basis_text='제2항에 따라 출어등록증을 발급한 경우에는',
                 basis_why='제2항의 발급이 있어야 기록할 사실이 생긴다.',
                 prev=[2]),
            step(4, '출어등록 유효기간 확인(등록일부터 1년)', FS, '시행령', '제7조',
                 '출어등록의 유효기간은 등록일부터 1년으로 한다',
                 '어선의 소유자 또는 선장', '확인', deadline='등록일부터 1년',
                 basis='조건연쇄', basis_text='법 제12조제1항 후단에 따른 출어등록의 유효기간은',
                 basis_why='등록이 있어야 유효기간이 기산된다.',
                 prev=[1]),
            step(5, '선단 편성 및 대표자 선정·편성사실 신고', FS, '시행규칙', '제9조',
                 '선단의 대표자를 선정해야 하며, 선단의 대표자는 해양경찰서 신고기관의 장에게 선단의 편성 사실을 신고해야 한다',
                 '어선의 소유자 또는 선장 · 선단의 대표자', '신고', org='해양경찰서 신고기관',
                 basis='명시', basis_text='선단을 편성한 경우에는',
                 basis_why='법 제15조제1항이 "선단을 편성하여 출항하고 조업하여야 한다"고 정해 출항 전 단계임이 원문으로 확인된다.',
                 cond='특정해역 또는 조업자제해역에서 조업하려는 어선은 선단을 편성하여 출항·조업해야 한다'
                      '(법 제15조제1항). 어획물운반선은 선단을 편성하지 않고 출항할 수 있다(같은 조 제2항).',
                 branch={'질문': '그 어선에 무선설비가 있나요?',
                         '갈래': [
                             {'조건': '무선설비가 있는 어선 — 통상의 선단 편성', '다음': [6]},
                             {'조건': '무선설비가 없는 어선으로서 영해 기선으로부터 12해리 밖 일반해역에서 조업 — '
                                      '무선설비가 있는 어선과 선단을 편성하여 신고기관에 신고',
                              '다음': [6]}]}),
            step(6, '선단 이탈 시 안전본부 통보', FS, '시행규칙', '제9조',
                 '이탈하려는 어선의 선장은 그 사실을 안전본부에 통보해야 한다',
                 '이탈하려는 어선의 선장', '통보', org='어선안전조업본부',
                 basis='조건연쇄', basis_text='선단에 편성된 어선은 같은 항 단서에 따라',
                 basis_why='선단 편성(제5단계)이 있어야 이탈이 성립한다.',
                 prev=[5],
                 cond='어선설비 고장 · 인명사고 · 만선 · 일반해역 이동 · 기상특보 대피 · '
                      '어구ㆍ어법 특성상 가시거리 내 조업이 현저히 곤란한 경우'),
            step(7, '안전본부의 신고기관·어업관리단 통보 및 잔여 어선 재편입', FS, '시행규칙', '제9조',
                 '관할 해양경찰서 신고기관 및 어업관리단에 그 사실을 지체 없이 알려야 하고',
                 '어선안전조업본부', '통보', deadline='지체 없이',
                 basis='조건연쇄', basis_text='제5항에 따른 통보를 받은 경우',
                 basis_why='제5항(제6단계) 통보가 있어야 이 조치가 시작된다.',
                 prev=[6]),
        ], tree_nodes=['fishing_vessel']))

    # ── 3. 기상특보 시 어선 출항·조업 제한 ───────────────────────
    flows.append(flow(
        'fishing_vessel_departure_restriction', '기상특보 발효 시 어선 출항·조업 제한', '출입항',
        '출항하려는 어선의 선장 및 신고기관의 장',
        [prov(FS, '법률', '제10조',
              '신고기관의 장은 해상에 대하여 기상특보가 발효된 때에는 어선의 출항 및 조업을 제한할 수 있다')],
        '신고기관 · 어선안전조업본부',
        '해상에 기상예비특보 또는 기상특보가 발표·발효된 때',
        [
            step(1, '기상특보 발효에 따른 출항·조업 제한', FS, '법률', '제10조',
                 '기상특보가 발효된 때에는 어선의 출항 및 조업을 제한할 수 있다',
                 '신고기관의 장', '처분',
                 basis='명시', basis_text='기상특보가 발효된 때에는',
                 basis_why='원문이 "기상특보가 발효된 때"를 이 조치의 시점으로 정했다.'),
            step(2, '선장의 안전조치·준수사항 이행', FS, '법률', '제10조',
                 '기상예비특보(기상특보를 발표할 것으로 예상될 때 이를 사전에 알리는 것을 말한다) 또는 기상특보가 발표되거나 발효된 때에는',
                 '어선의 선장', '확인',
                 basis='명시', basis_text='기상특보가 발표되거나 발효된 때에는',
                 basis_why='원문이 "발표되거나 발효된 때"를 이행 시점으로 정했다.'),
            step(3, '출항·조업 제한 기준 적용(별표 1)', FS, '시행규칙', '제4조',
                 '어선의 출항 및 조업 제한의 기준과 같은 조 제2항에 따른 어선의 안전조치 및 준수사항은 별표 1과 같다',
                 '신고기관의 장 · 어선의 선장', '확인',
                 basis='조건연쇄', basis_text='법 제10조제1항에 따른',
                 basis_why='법 제10조의 제한을 구체화한 조문이다.',
                 prev=[1],
                 note='구체적 기준은 별표 1에 있으며 이 자산은 별표 본문을 담지 않는다.'),
            step(4, '동절기 풍랑주의보 시 총톤수 30톤 미만 출항·조업 금지와 예외', FS, '시행규칙', '제4조',
                 '풍랑주의보가 발효된 경우에는 총톤수 30톤 미만의 어선은 출항 및 조업이 금지된다',
                 '어선의 소유자 또는 선장', '확인',
                 deadline='11월 1일부터 다음 해 3월 31일까지의 기간',
                 basis='명시', basis_text='11월 1일부터 다음 해 3월 31일까지의 기간',
                 basis_why='원문이 적용 기간을 날짜로 못박았다.',
                 cond='총톤수 15톤 이상 어선은 ①실시간 위치확인이 가능한 어선위치발신장치 및 무선설비를 '
                      '갖추고 정상 작동 ②2척 이상 선단 편성(어선 간 최대 거리 6해리 이내) '
                      '③관할 안전본부에 사전통지를 모두 갖추면 출항·조업할 수 있다.',
                 also=['관할 안전본부에 사전통지를 할 것']),
            step(5, '신고기관 장의 총톤수 5톤 이상 어선 출항 허용', FS, '시행규칙', '제4조',
                 '총톤수 5톤 이상 어선의 출항 및 조업을 허용할 수 있다',
                 '신고기관의 장', '처분',
                 basis='조건연쇄', basis_text='제1항 및 제2항에도 불구하고',
                 basis_why='제1항·제2항의 제한이 있는 상태에서만 이 허용이 의미를 갖는다.',
                 prev=[3, 4],
                 cond='별표 2에 따른 해역 및 기간에 한정한다.'),
        ], tree_nodes=['fishing_vessel']))

    # ── 4. 무역항 출입 신고·허가 ─────────────────────────────────
    flows.append(flow(
        'trade_port_entry', '무역항의 수상구역등 출입 신고·허가', '출입항',
        '무역항의 수상구역등에 출입하려는 선박의 선장',
        [prov(PT, '법률', '제4조',
              '무역항의 수상구역등에 출입하려는 선박의 선장(이하 이 조에서 "선장"이라 한다)은 대통령령으로 정하는 바에 따라 관리청에 신고하여야 한다')],
        '관리청(지방해양수산청장·시ㆍ도지사·항만공사)',
        '무역항의 수상구역등에 입항하거나 그 밖으로 출항하려는 때',
        [
            step(1, '출입 신고 의무 및 면제 대상 확인', PT, '법률', '제4조',
                 '무역항의 수상구역등에 출입하려는 선박의 선장',
                 '선박의 선장', '신고', org='관리청',
                 basis='명시', basis_text='무역항의 수상구역등에 출입하려는',
                 basis_why='원문이 의무 발생 시점을 "출입하려는" 때로 정했다.',
                 cond='총톤수 5톤 미만 선박 · 해양사고구조에 사용되는 선박 · 국내항 간을 운항하는 모터보트와 '
                      '동력요트 · 어선안전조업법 제8조 출입항 신고 대상 어선 · 해양수산부령으로 정하는 선박은 '
                      '출입 신고를 하지 아니할 수 있다.',
                 branch={'질문': '어떤 선박인가요?',
                         '갈래': [
                             {'조건': '국내에서만 운항하는 내항선', '다음': [2]},
                             {'조건': '국내항과 외국항 사이를 운항하는 외항선', '다음': [3]},
                             {'조건': '출입 신고 면제 대상(총톤수 5톤 미만·해양사고구조용·'
                                      '어선안전조업법 제8조 신고 대상 어선 등)', '다음': [6]}]},
                 also=['「어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률」 제8조에 따른 출입항 신고 대상이 되는 어선']),
            step(2, '내항선 출입 신고서 제출', PT, '시행령', '제2조',
                 '내항선(국내에서만 운항하는 선박을 말한다)이 무역항의 수상구역등의 안으로 입항하는 경우에는 입항 전에',
                 '내항선의 선장', '신고', org='관리청', deadline='입항 전에',
                 basis='명시', basis_text='입항 전에',
                 basis_why='원문이 신고 시점을 "입항 전에"·"출항 전에"로 못박았다.',
                 prev=[1],
                 cond='출항하려는 경우에는 출항 전에 제출한다. 화물선의 선장은 승객 명부를 첨부한다'
                      '(시행규칙 제3조제1항).',
                 also=['무역항의 수상구역등의 밖으로 출항하려는 경우에는 출항 전에']),
            step(3, '외항선 출입 신고서·승객 명부·승무원 명부 제출', PT, '시행규칙', '제3조',
                 '외항선 출입신고서에 별지 제1호의2서식에 따른 승객 명부 및 별지 제2호의2서식에 따른 승무원 명부를 첨부하여',
                 '외항선의 선장', '신고',
                 org='지방해양수산청장·시ㆍ도지사·항만공사',
                 basis='조건연쇄', basis_text='법 제4조제1항에 따라 무역항의 수상구역등에 출입하려는',
                 basis_why='법 제4조제1항 신고의 서식·첨부서류를 정한 조문이다.',
                 prev=[1],
                 cond='시행령 제2조제2호에 따라 입항하는 경우에는 입항 전에, 출항하려는 경우에는 출항 전에 제출한다.'),
            step(4, '출항 후 12시간 이내 귀항 시 사실 제출', PT, '시행령', '제2조',
                 '무역항을 출항한 선박이 피난, 수리 또는 그 밖의 사유로 출항 후 12시간 이내에 출항한 무역항으로 귀항하는 경우에는',
                 '선박의 선장', '신고', org='관리청', deadline='출항 후 12시간 이내에',
                 basis='명시', basis_text='출항 후 12시간 이내에',
                 basis_why='원문이 이 특례의 적용 시점을 출항 후 12시간 이내로 정했다.',
                 prev=[2, 3]),
            step(5, '해양사고 회피 등 부득이한 사유로 출입한 경우 사실 제출', PT, '시행령', '제2조',
                 '선박이 해양사고를 피하기 위한 경우나 그 밖의 부득이한 사유로',
                 '선박의 선장', '신고', org='관리청',
                 basis='미확정',
                 basis_why='원문이 이 제출의 시점을 정하지 않았다 — 부득이한 출입 자체가 요건이다.'),
            step(6, '관리청의 신고 수리', PT, '법률', '제4조',
                 '관리청은 제1항에 따른 신고를 받은 경우 그 내용을 검토하여 이 법에 적합하면 신고를 수리하여야 한다',
                 '관리청', '처분',
                 basis='조건연쇄', basis_text='제1항에 따른 신고를 받은 경우',
                 basis_why='제1항 신고가 접수돼야 수리가 성립한다.',
                 prev=[2, 3]),
            step(7, '입항 시 출항 일시가 정해진 경우 입·출항 동시 신고', PT, '시행규칙', '제3조',
                 '해당 선박의 출항 일시가 이미 정해진 경우에는 입항과 출항의 신고를 동시에 할 수 있다',
                 '선박의 선장', '신고',
                 org='지방해양수산청장·시ㆍ도지사·항만공사',
                 basis='명시', basis_text='무역항의 수상구역등으로 입항하는 선박의 선장은',
                 basis_why='입항 신고 시점에 함께 할 수 있는 선택지임이 원문으로 확인된다.',
                 prev=[2, 3]),
            step(8, '출입 일시 변경 시 지체 없이 신고', PT, '시행규칙', '제3조',
                 '해당 선박의 출입 일시가 변경된 경우에는 지체 없이 그 사실을',
                 '선박의 선장', '신고',
                 org='지방해양수산청장·시ㆍ도지사·항만공사', deadline='지체 없이',
                 basis='조건연쇄', basis_text='출입신고서를 제출한 선박의 선장은',
                 basis_why='출입신고서 제출이 있어야 변경 신고가 성립한다.',
                 prev=[2, 3]),
            step(9, '출입 허가 대상 선박의 허가 신청', PT, '시행규칙', '제5조',
                 '무역항의 수상구역등에 출입하기 3일 전까지',
                 '선박의 선장', '허가신청',
                 org='지방해양수산청장 또는 시ㆍ도지사', deadline='출입하기 3일 전까지',
                 basis='명시', basis_text='출입하기 3일 전까지',
                 basis_why='원문이 신청 기한을 "출입하기 3일 전까지"로 못박았다.',
                 cond='북한을 다음 기항 예정지로 하는 외국적 선박, 북한 기항 후 1년 이내 최초 입항 선박, '
                      '전시ㆍ사변 등 국가안전보장상 특별 관리가 필요한 선박 등(시행령 제3조)',
                 note='법 제4조는 2026.5.12 시행 개정으로 항이 밀려 허가 근거가 제4항이 됐으나, '
                      '시행령 제3조~제5조와 이 시행규칙 제5조는 raw 기준으로 여전히 "법 제4조제3항"을 인용한다. '
                      '원문을 고치지 않고 그대로 인용했다.'),
            step(10, '출입 허가 신청서 첨부서류 제출', PT, '시행령', '제4조',
                 '출입 허가 신청서에 다음 각 호의 서류를 첨부하여 입항하거나 출항하기 전에 관리청에 제출해야 한다',
                 '선박의 선장', '허가신청', org='관리청', deadline='입항하거나 출항하기 전에',
                 basis='명시', basis_text='입항하거나 출항하기 전에',
                 basis_why='원문이 제출 시점을 "입항하거나 출항하기 전에"로 정했다.',
                 prev=[9],
                 cond='승무원 명부 · 승객 명부 · 남북교류협력법 시행령 제33조에 따른 수송장비 운행 승인 서류'),
            step(11, '관계 국가보안기관장·출입국관리사무소장과 사전 협의', PT, '시행령', '제5조',
                 '관계 국가보안기관의 장 및 출입국관리사무소장과 미리 협의해야 한다',
                 '관리청', '처분',
                 basis='조건연쇄', basis_text='출입 허가를 하려는 경우에는',
                 basis_why='허가 신청(제9·10단계)이 있어야 허가 절차가 시작된다.',
                 prev=[10]),
        ], tree_nodes=['general_ship']))

    # ── 5. 낚시어선 출입항 신고 ──────────────────────────────────
    flows.append(flow(
        'angling_vessel_port_report', '낚시어선의 출입항 신고', '출입항',
        '승객을 승선하게 하여 항구ㆍ포구 등에 출입항하려는 낚시어선업자',
        [prov(AN, '법률', '제33조',
              '낚시어선업자는 승객을 승선하게 하여 항구ㆍ포구 등에 출항이나 입항')],
        '출입항신고기관(어선의 출입항 신고 업무를 담당하는 기관)',
        '승객을 태우고 항구ㆍ포구에 출항하거나 입항하려는 때',
        [
            step(1, '출입항 신고', AN, '법률', '제33조',
                 '어선의 출입항 신고에 관한 업무를 담당하는 기관(이하 "출입항신고기관"이라 한다)의 장에게 신고하여야 한다',
                 '낚시어선업자', '신고', org='출입항신고기관',
                 basis='명시', basis_text='출항이나 입항',
                 basis_why='원문이 신고 의무의 발생 시점을 "출항이나 입항(이하 출입항)을 하려는 경우"로 정했다.'),
            step(2, '승선자명부 작성(승객)·신분증 확인', AN, '법률', '제33조',
                 '승선하는 승객으로 하여금 해양수산부령으로 정하는 바에 따라 승선자명부를 작성하도록 하여야 한다',
                 '낚시어선업자 · 승객', '확인',
                 basis='명시', basis_text='출항 신고를 하려는 낚시어선업자는 승선하는 승객으로 하여금',
                 basis_why='원문이 "출항 신고를 하려는" 낚시어선업자의 의무로 정해, 출항 신고 전 단계임이 확인된다.',
                 prev=[1],
                 also=['낚시어선업자는 승객에게 신분증을 요구하여 승선자명부 기재내용을 확인하여야 한다']),
            step(3, '승선자명부를 첨부한 신고서 제출', AN, '법률', '제33조',
                 '그 신고서에 해당 낚시어선에 승선할 선원과 승객의 명부(이하 "승선자명부"라 한다)를 첨부하여 출입항신고기관의 장에게 제출하여야 한다',
                 '낚시어선업자', '신고', org='출입항신고기관',
                 basis='조건연쇄', basis_text='제1항에 따라 출항 신고를 하려는 낚시어선업자는',
                 basis_why='제1항 신고의 첨부서류를 정한 조문이다.',
                 prev=[1, 2]),
            step(4, '출입항 신고서 서식·제출처', AN, '시행규칙', '제20조',
                 '출입항 신고서(전자문서로 된 신고서를 포함한다)에 별지 제16호서식의 승선자명부',
                 '낚시어선업자', '신고', org='선박 출항ㆍ입항 신고기관',
                 basis='조건연쇄', basis_text='법 제33조제1항 및 제2항에 따라 출항 또는 입항의 신고를 하려는',
                 basis_why='법 제33조 신고의 서식을 정한 조문이다.',
                 prev=[3],
                 note='이 조문은 raw 기준으로 이미 폐지된 「선박안전 조업규칙」 제9조를 제출처 근거로 인용하고 있다'
                      '(현행 근거는 어선안전조업법 제8조). 원문 그대로 인용했다.'),
            step(5, '승선자명부 미작성·신분증 제시 거부 시 승선 거부', AN, '법률', '제33조',
                 '승객이 정당한 사유 없이 승선자명부를 작성하지 아니하거나',
                 '낚시어선업자', '확인',
                 basis='조건연쇄', basis_text='제3항 후단에 따른 신분증 제시 요구에 따르지 아니하는 경우에는',
                 basis_why='제3항의 명부 작성·신분증 요구가 있어야 이 거부가 성립한다.',
                 prev=[2]),
            step(6, '승선자명부 사본 3개월 비치', AN, '법률', '제33조',
                 '해당 낚시어선에 승선자명부(전자문서로 된 명부는 제외한다)의 사본을 3개월 동안 갖추어 두어야 한다',
                 '낚시어선업자', '기록', deadline='3개월 동안',
                 basis='조건연쇄', basis_text='승선자명부(전자문서로 된 명부는 제외한다)의 사본을',
                 basis_why='승선자명부가 작성된 뒤에야 사본을 비치할 수 있다.',
                 prev=[2]),
            step(7, '출항 제한', AN, '법률', '제34조',
                 '낚시어선업자ㆍ선원ㆍ승객의 안전을 위하여 필요하다고 인정할 때에는 낚시어선의 출항을 제한할 수 있다',
                 '출입항신고기관의 장', '처분',
                 basis='조건연쇄', basis_text='시간, 기상 및 해상 상황에 관한 정보 등을 고려하여',
                 basis_why='출항 신고를 접수한 기관이 출항 전에 하는 처분이다.',
                 prev=[1],
                 branch={'질문': '출항 제한 사유에 해당하나요?',
                         '갈래': [
                             {'조건': '초당 풍속 12미터 이상 또는 파고 2미터 이상 예보 · 호우ㆍ대설ㆍ태풍ㆍ강풍ㆍ'
                                      '풍랑ㆍ폭풍해일 특보 · 시계 1킬로미터 이내 · 일출 전 또는 일몰 후 등'
                                      '(시행령 제19조) — 출항 제한', '다음': [8]},
                             {'조건': '해당 없음 — 출항', '다음': [8]}]}),
            step(8, '출항 제한 사유 확인(시행령)', AN, '시행령', '제19조',
                 '낚시어선의 출항제한은 다음 각 호의 경우에 할 수 있다',
                 '출입항신고기관의 장', '확인',
                 basis='조건연쇄', basis_text='법 제34조제1항에 따른',
                 basis_why='법 제34조제1항 제한의 요건을 정한 조문이다.',
                 prev=[7],
                 also=['안개 등으로 인하여 해상에서의 시계가 1킬로미터 이내인 경우', '일출 전 또는 일몰 후']),
        ], tree_nodes=['angling_vessel']))

    # ── 6. 외국적 국제항해선박 선박보안정보 통보 ─────────────────
    flows.append(flow(
        'intl_ship_security_info', '외국적 국제항해선박의 입항 전 선박보안정보 통보', '출입항',
        '대한민국의 항만에 입항하려는 외국 국적의 국제항해선박',
        [prov(IS, '법률', '제19조',
              '대한민국의 항만에 입항하려는 외국 국적의 국제항해선박은 그 항만에 입항하기 24시간 이전에')],
        '해양수산부장관(지방해양수산청장) · 해양경찰청장',
        '외국 국적 국제항해선박이 대한민국 항만에 입항하려는 때',
        [
            step(1, '입항 24시간 이전 선박보안정보 통보', IS, '법률', '제19조',
                 '그 항만에 입항하기 24시간 이전에 해양수산부령으로 정하는 바에 따라 해당 선박의 보안에 관한 정보',
                 '외국 국적의 국제항해선박', '통보', org='해양수산부장관',
                 deadline='그 항만에 입항하기 24시간 이전에',
                 basis='명시', basis_text='그 항만에 입항하기 24시간 이전에',
                 basis_why='원문이 통보 기한을 입항 24시간 이전으로 못박았다.',
                 branch={'질문': '긴급 입항 등 예외 사유에 해당하나요?',
                         '갈래': [
                             {'조건': '기상악화 등 급박한 위험을 피하기 위한 긴급 입항 · 국제분쟁이나 해적 회피 · '
                                      '위급환자 치료 · 항해시간 24시간 미만 · 기관고장 수리 등 — 입항과 동시에 통보',
                              '다음': [3]},
                             {'조건': '그 밖의 경우 — 입항 24시간 이전 통보', '다음': [2]}]}),
            step(2, '통보 내용 작성(5개 항목)', IS, '시행규칙', '제20조',
                 '지방해양수산청장에게 통보하여야 하는 선박보안정보의 내용은 다음 각 호와 같다',
                 '외국 국적의 국제항해선박', '통보', org='지방해양수산청장',
                 basis='조건연쇄', basis_text='법 제19조제4항 본문에 따라',
                 basis_why='법 제19조제4항 통보의 내용을 정한 조문이다.',
                 prev=[1],
                 cond='선박 제원 · 입항하려는 항만 및 입항 예정시간 · 보안등급과 국제선박보안증서 비치 여부 · '
                      '최근 기항 10개 항만의 보안정보 · 항해 중 발생한 보안사건',
                 also=['최근 기항한 10개 항만의 보안정보 및 해당 항만에서의 보안조치']),
            step(3, '통보 방법(한글·영문 작성, 팩스 또는 선박입출항정보시스템)', IS, '시행규칙', '제22조',
                 '선박보안정보를 한글이나 영문으로 작성하여 팩스나 선박입출항정보시스템으로 통보하여야 한다',
                 '외국 국적의 국제항해선박', '통보',
                 basis='조건연쇄', basis_text='법 제19조제12항에 따라',
                 basis_why='법 제19조 통보의 절차를 정한 조문이다.',
                 prev=[1]),
            step(4, '지방해양수산청장의 해양경찰청장 통보', IS, '시행규칙', '제20조',
                 '통보하여 온 선박보안정보를 해양경찰청장에게 문서(전자문서를 포함한다), 팩스 또는 전자우편으로 통보하여야 한다',
                 '지방해양수산청장', '통보', org='해양경찰청장',
                 basis='조건연쇄', basis_text='법 제19조제5항에 따라',
                 basis_why='선박의 통보(제1~3단계)가 접수된 뒤의 기관 간 절차다.',
                 prev=[2, 3]),
            step(5, '검토 결과에 따른 이동제한·시정요구·선박점검·입항거부', IS, '법률', '제19조',
                 '통보받은 선박보안정보를 검토한 결과',
                 '해양수산부장관', '처분',
                 basis='조건연쇄', basis_text='통보받은 선박보안정보를 검토한 결과',
                 basis_why='통보가 접수돼야 검토·처분이 성립한다.',
                 prev=[4],
                 also=['이동제한ㆍ시정요구ㆍ선박점검 또는 입항거부 등의 조치를 명할 수 있다']),
        ], tree_nodes=['general_ship']))

    # ── 7. 선박평형수 적재선박 입항 보고 ─────────────────────────
    flows.append(flow(
        'ballast_water_arrival_report', '선박평형수 적재선박의 입항 보고', '출입항',
        '관할수역 외의 수역에서 관할수역에 들어오는 선박',
        [prov(BW, '법률', '제5조',
              '관할수역 외의 수역에서 관할수역에 들어오는 선박은 해양수산부령으로 정하는 바에 따라 해양수산부장관에게 입항 보고를 하여야 한다')],
        '입항하려는 항만을 관할하는 지방해양수산청장',
        '관할수역 밖에서 관할수역으로 들어오려는 때',
        [
            step(1, '입항 보고 의무 발생', BW, '법률', '제5조',
                 '관할수역 외의 수역에서 관할수역에 들어오는 선박',
                 '선박', '보고', org='해양수산부장관',
                 basis='명시', basis_text='관할수역에 들어오는',
                 basis_why='원문이 의무 발생 시점을 관할수역 진입으로 정했다.'),
            step(2, '입항 24시간 전까지 선박평형수 입항 보고서 제출', BW, '시행규칙', '제10조',
                 '입항 24시간 전까지 입항하려는 항만을 관할하는 지방해양수산청장',
                 '선박의 선장', '보고', org='지방해양수산청장', deadline='입항 24시간 전까지',
                 basis='명시', basis_text='입항 24시간 전까지',
                 basis_why='원문이 제출 기한을 입항 24시간 전까지로 못박았다.',
                 prev=[1],
                 branch={'질문': '긴급 입항이거나 항해 예정시간이 24시간 미만인가요?',
                         '갈래': [
                             {'조건': '기상악화 등 급박한 위험을 피하기 위한 긴급 입항 — 입항과 동시에 보고',
                              '다음': [3]},
                             {'조건': '출항지에서 입항지까지 항해 예정시간이 24시간 미만 — '
                                      '이전 항만에서 출항하기 전에 보고', '다음': [3]},
                             {'조건': '그 밖의 경우 — 입항 24시간 전까지 보고', '다음': [3]}]},
                 also=['별지 제4호서식에 따른 선박평형수 입항 보고서']),
            step(3, '예외 사유별 보고 시기 적용', BW, '시행규칙', '제10조',
                 '긴급히 입항하는 경우: 입항과 동시에 입항 보고를 할 수 있다',
                 '선박의 선장', '보고', org='지방해양수산청장',
                 basis='조건연쇄', basis_text='법 제5조에 따른 입항 보고의 시기는 다음 각 호의 구분에 따른다',
                 basis_why='제1항의 원칙 기한에 대한 예외라 제1항 없이는 성립하지 않는다.',
                 prev=[2],
                 cond='①긴급 입항: 입항과 동시 ②항해 예정시간 24시간 미만: 이전 항만에서 출항하기 전 '
                      '③출항 후 입항지 변경으로 항해 예정시간이 24시간 미만이 된 경우: 입항지의 변경 즉시',
                 also=['이전 항만에서 출항하기 전에 입항 보고를 해야 한다',
                       '입항지의 변경 즉시 입항 보고를 해야 한다']),
        ], tree_nodes=['general_ship']))

    # ── 8. 해외 어획물 적재선박 입항신고·항만국검색 ──────────────
    flows.append(flow(
        'distant_water_landing_entry', '해외 어획물 적재선박의 입항신고와 항만국 검색', '출입항',
        '해외에서 어획물을 적재하고 국내 항만에 입항하는 선박',
        [prov(DW, '시행규칙', '제23조',
              '해외에서 어획물을 적재한 선박은 별지 제14호서식의 해외 어획물 적재선박 입항신고서')],
        '국립수산물품질관리원장(검색기관지원장) · 항만 관리운영기관장',
        '해외에서 어획물을 적재한 선박이 국내 항만에 입항하려는 때',
        [
            step(1, '해외 어획물 적재선박 입항신고서 제출', DW, '시행규칙', '제23조',
                 '해외에서 어획물을 적재한 선박은 별지 제14호서식의 해외 어획물 적재선박 입항신고서(이하 "입항신고서"라 한다)를 국립수산물품질관리원장에게 제출하여야 한다',
                 '해외 어획물 적재선박', '신고', org='국립수산물품질관리원장',
                 basis='조건연쇄', basis_text='법 제14조제1항에 따라',
                 basis_why='법 제14조(항만국 검색)의 이행을 위한 첫 행위다.',
                 cond='국제수산기구가 관리하는 어종·IUU 방지협정 대상 어종·꽁치 등을 적재한 경우에는 '
                      '어획증명 관련 서류를 첨부한다.',
                 branch={'질문': '어떤 선박인가요?',
                         '갈래': [
                             {'조건': '여객선·컨테이너 전용선·산적화물선 — 선박입출항법 제4조 출입신고서를 '
                                      '입항신고서로 봄', '다음': [3]},
                             {'조건': '그 밖의 선박 — 입항신고서 제출', '다음': [2]}]}),
            step(2, '입항신고서 제출 방법과 접수대장 기록', DW, ADM, '제6조',
                 '해외 어획물 적재 선박 입항신고서는 직접방문 또는 모사전송(FAX), 정보통신 등의 방법으로 검색기관지원장에게 제출하여야 한다',
                 '해외 어획물 적재선박', '신고', org='검색기관지원장', notice=PSMA,
                 basis='조건연쇄', basis_text='규칙 제23조제1항 및 제2항에 따른',
                 basis_why='시행규칙 제23조 신고의 방법을 정한 고시다.',
                 prev=[1],
                 also=['입항신고서 접수대장의 서식으로 전산 또는 서면으로 기록ㆍ관리하여야 한다']),
            step(3, '외항선 출입신고서 제출(선박입출항법 병행)', DW, ADM, '제6조',
                 '외항선 출입신고서를 항만 관리운영기관장에 제출하여야 한다',
                 '해외 어획물 적재선박', '신고', org='항만 관리운영기관장', notice=PSMA,
                 basis='미확정',
                 basis_why='이 고시는 외항선 출입신고서 제출을 함께 요구할 뿐 입항신고서와의 선후를 정하지 않았다.',
                 prev=[1]),
            step(4, '서류 미비 시 입항 보류 또는 사후 보완', DW, '시행규칙', '제23조',
                 '입항신고서를 검토한 결과 필요한 서류가 미비된 경우에는 해당 서류가 보완될 때까지 입항을 보류하거나',
                 '국립수산물품질관리원장', '처분',
                 basis='조건연쇄', basis_text='입항신고서를 검토한 결과',
                 basis_why='입항신고서가 접수돼야 검토·보류가 성립한다.',
                 prev=[1, 2]),
            step(5, '항만국검색관의 선박 검색과 입항 금지·보고', DW, '시행규칙', '제23조',
                 '국제수산기구에서 정한 절차에 따라 선박을 검색하여 불법ㆍ비보고ㆍ비규제어업과 관련 있는 것으로 확인된 경우 해당 선박의 입항을 금지하고',
                 '항만국검색관', '처분', org='해양수산부장관',
                 basis='조건연쇄', basis_text='국제수산기구에서 정한 절차에 따라 선박을 검색하여',
                 basis_why='입항신고 접수 뒤의 검색 단계다.',
                 prev=[4],
                 cond='이미 입항한 선박이 IUU 어업과 관련 있는 것으로 확인된 경우에는 출항 및 항만 이용을 '
                      '금지하거나 양륙ㆍ전재ㆍ포장ㆍ가공, 연료ㆍ물자 공급, 정비ㆍ수리 등 항만 서비스 이용을 '
                      '제한하고 그 사실을 보고한다.'),
            step(6, '입항 거부 결정·요청과 기국·국제기구 통지', DW, ADM, '제7조',
                 '입항을 요청한 선박이 불법어업 또는 이를 지원한 사실이 있는 경우 입항 거부를 결정하고 항만 관리운영기관장에 입항 거부를 요청해야 한다',
                 '검색기관지원장 · 항만 관리운영기관장', '처분', notice=PSMA,
                 basis='조건연쇄', basis_text='제6조제1항에 따라 입항을 요청한 선박이',
                 basis_why='고시 제6조제1항의 입항신고(제2단계)가 있어야 성립한다.',
                 prev=[2, 5],
                 also=['해당 선박의 기국, 관련 연안국, 지역수산관리기구 및 그 밖의 국제기구에 그 사실을 알려야 한다']),
        ], tree_nodes=['fishing_vessel']))

    # ── 9. 출입국항 출입항 사전통보·보고 ─────────────────────────
    flows.append(flow(
        'immigration_port_report', '출입국항에 출·입항하는 선박의 사전통보와 출·입항보고', '출입항',
        '출입국항에 출·입항하는 선박등의 장이나 운수업자',
        [prov(IM, '법률', '제74조',
              '선박등이 출입국항에 출ㆍ입항하는 경우에 그 선박등의 장이나 운수업자는')],
        '지방출입국ㆍ외국인관서',
        '선박이 출입국항(또는 출입국항이 아닌 장소)에 출·입항하는 때',
        [
            step(1, '출·입항 예정통보서 사전 제출', IM, '법률', '제74조',
                 '출ㆍ입항 예정일시와 그 밖에 필요한 사항을 적은 출ㆍ입항 예정통보서를 미리 제출하여야 한다',
                 '선박등의 장이나 운수업자', '통보', org='지방출입국ㆍ외국인관서',
                 deadline='미리',
                 basis='명시', basis_text='출ㆍ입항 예정통보서를 미리 제출하여야 한다',
                 basis_why='원문이 "미리"라는 시점 문구로 사전 단계임을 정했다.',
                 cond='항공기의 불시착이나 선박의 조난 등 불의의 사고가 발생한 경우에는 지체 없이 알린다.'),
            step(2, '사전통보 없이 입항한 경우 입항 즉시 입항통보', IM, '시행규칙', '제67조',
                 '그 선박등이 입항한 즉시 청장ㆍ사무소장 또는 출장소장에게 입항통보를 하여야 한다',
                 '선박등의 장 또는 운수업자', '통보',
                 org='청장ㆍ사무소장 또는 출장소장', deadline='입항한 즉시',
                 basis='명시', basis_text='입항한 즉시',
                 basis_why='원문이 통보 시점을 "입항한 즉시"로 못박았다.',
                 prev=[1],
                 cond='자연의 재해ㆍ기기의 고장ㆍ피난 기타 부득이한 사유로 출입항예정통보를 하지 아니하고 입항한 경우'),
            step(3, '승무원명부·승객명부를 첨부한 출·입항보고서 제출', IM, '법률', '제75조',
                 '승무원명부와 승객명부를 첨부한 출ㆍ입항보고서를 지방출입국ㆍ외국인관서의 장에게 제출하여야 한다',
                 '선박등의 장이나 운수업자', '보고', org='지방출입국ㆍ외국인관서',
                 basis='미확정',
                 basis_why='법 제75조제3항이 제출 시기를 대통령령에 위임했는데, 그 시행령 조문은 raw에 '
                           '발췌만 수집돼 있어 시점을 원문으로 확인하지 못했다.',
                 prev=[1],
                 note='제출 시기는 대통령령 위임 사항인데 해당 시행령 조문이 raw(시행령_발췌.txt)에 없어 '
                      '순서를 미확정으로 남겼다.'),
            step(4, '표준화된 전자문서로 제출', IM, '법률', '제75조',
                 '출ㆍ입항보고서는 표준화된 전자문서로 제출하여야 한다',
                 '선박등의 장이나 운수업자', '보고',
                 basis='조건연쇄', basis_text='제1항에 따른 출ㆍ입항보고서는',
                 basis_why='제1항 보고서가 있어야 제출 형식이 문제 된다.',
                 prev=[3],
                 cond='법무부령으로 정하는 부득이한 사유가 있으면 지체 없이 사유를 밝히고 서류로 제출할 수 있다.'),
            step(5, '여권 미소지자 발견 시 지체 없이 보고·상륙 방지', IM, '법률', '제75조',
                 '여권(선원의 경우에는 여권 또는 선원신분증명서를 말한다)을 가지고 있지 아니한 사람이 그 선박등에 타고 있는 것을 알았을 때에는 지체 없이',
                 '선박등의 장이나 운수업자', '보고',
                 org='지방출입국ㆍ외국인관서', deadline='지체 없이',
                 basis='명시', basis_text='타고 있는 것을 알았을 때에는 지체 없이',
                 basis_why='원문이 "알았을 때에는 지체 없이"로 시점을 정했다.',
                 prev=[3]),
            step(6, '출항 시 상륙허가자 귀선 여부 등 보고', IM, '법률', '제75조',
                 '출항하는 선박등의 장이나 운수업자는 다음 각 호의 사항을 지방출입국ㆍ외국인관서의 장에게 보고하여야 한다',
                 '선박등의 장이나 운수업자', '보고', org='지방출입국ㆍ외국인관서',
                 basis='명시', basis_text='출항하는 선박등의 장이나 운수업자는',
                 basis_why='원문이 "출항하는" 때의 의무로 정했다.',
                 cond='승무원 상륙허가·관광상륙허가를 받은 사람이 선박등으로 돌아왔는지 여부, '
                      '정당한 출국절차를 마치지 아니하고 출국하려는 사람이 있는지 여부'),
        ], tree_nodes=['general_ship']))

    # ── 10. 유·도선 출항·입항 기록·관리 ─────────────────────────
    flows.append(flow(
        'excursion_ferry_log', '유·도선의 출항·입항 기록·관리와 승선신고서', '출입항',
        '운항거리 2해리 이상이거나 운항시간 1시간 초과 유ㆍ도선을 운항하는 유ㆍ도선사업자',
        [prov(EF, '법률', '제25조',
              '유ㆍ도선사업자는 유ㆍ도선의 안전운항과 위해방지를 위하여 대통령령으로 정하는 선박'),
         prov(EF, '시행령', '제22조',
              '운항거리가 2해리 이상이거나 운항시간이 1시간을 초과하는 선박')],
        '유ㆍ도선사업자(관할관청 감독)',
        '대상 유ㆍ도선이 출항하거나 입항하는 때',
        [
            step(1, '출항·입항 시 기록·관리 의무', EF, '법률', '제25조',
                 '그 출항ㆍ입항에 관한 사항을 기록ㆍ관리하여야 한다',
                 '유ㆍ도선사업자', '기록',
                 basis='명시', basis_text='출항ㆍ입항[내수면의 경우에는 출선 및 귀선(歸船)을 말한다] 시에',
                 basis_why='원문이 "출항ㆍ입항 시에"로 시점을 정했다.'),
            step(2, '승객의 승선신고서 작성·제출', EF, '법률', '제25조',
                 '그 선박에 승선하는 승객이 행정안전부령 또는 해양수산부령으로 정하는 바에 따라 승선신고서를 작성하여 제출하도록 하여야 한다',
                 '유ㆍ도선사업자 · 승객', '신고',
                 basis='조건연쇄', basis_text='제1항에 따른 선박을 운항하는 유ㆍ도선사업자는',
                 basis_why='제1항의 기록·관리 대상 선박에만 적용되는 의무다.',
                 prev=[1]),
            step(3, '승객 신분·기재내용 확인', EF, '법률', '제25조',
                 '승선하려는 승객의 신분과 제2항에 따른 승선신고서 기재내용을 확인하여야 한다',
                 '유ㆍ도선사업자', '확인',
                 basis='조건연쇄', basis_text='제2항에 따른 승선신고서 기재내용을 확인하여야 한다',
                 basis_why='제2항의 승선신고서가 제출돼야 확인이 성립한다.',
                 prev=[2]),
            step(4, '미작성·신분확인 거부 시 승선 거부', EF, '법률', '제25조',
                 '승객이 정당한 사유 없이 제2항에 따른 승선신고서를 작성하여 제출하지 아니하거나',
                 '유ㆍ도선사업자', '확인',
                 basis='조건연쇄', basis_text='제3항에 따른 신분확인 요구에 따르지 아니하는 경우에는',
                 basis_why='제2·3항의 요구가 있어야 거부가 성립한다.',
                 prev=[3]),
            step(5, '선박 출항·입항 기록·관리대장 기록', EF, '시행규칙', '제20조',
                 '선박의 출항ㆍ입항에 관한 사항을 별지 제19호서식의 선박 출항ㆍ입항 기록ㆍ관리대장에 기록하여야 한다',
                 '유ㆍ도선사업자', '기록',
                 basis='조건연쇄', basis_text='법 제25조제1항에 따라',
                 basis_why='법 제25조제1항 기록의무의 서식을 정한 조문이다.',
                 prev=[1]),
            step(6, '대장 조타실 비치와 운항 종료 후 3개월 보관', EF, '시행규칙', '제20조',
                 '유ㆍ도선의 운항 중에는 해당 유ㆍ도선의 조타실(操舵室)에 비치하고, 해당 운항이 종료된 후에는',
                 '유ㆍ도선사업자', '기록', deadline='3개월 동안',
                 basis='명시', basis_text='해당 운항이 종료된 후에는',
                 basis_why='원문이 보관 시점을 "운항이 종료된 후"로 정했다.',
                 prev=[5]),
            step(7, '승선신고서 3개월 보관', EF, '법률', '제25조',
                 '제2항에 따라 제출받은 승선신고서를 3개월 동안 보관하여야 한다',
                 '유ㆍ도선사업자', '기록', deadline='3개월 동안',
                 basis='조건연쇄', basis_text='제2항에 따라 제출받은 승선신고서를',
                 basis_why='제2항의 제출이 있어야 보관이 성립한다.',
                 prev=[2]),
        ], tree_nodes=['excursion_ferry']))

    # ── 11. 마리나선박 출항·입항 기록·관리 ──────────────────────
    flows.append(flow(
        'marina_boat_log', '마리나선박의 출항·입항 기록·관리와 승선신고서', '출입항',
        '마리나선박 대여업자',
        [prov(MA, '법률', '제28조의11',
              '마리나선박 대여업자는 마리나선박의 안전운항과 위해방지를 위하여 출항ㆍ입항 시에')],
        '마리나선박 대여업자(해양수산부장관 감독)',
        '마리나선박이 출항하거나 입항하는 때',
        [
            step(1, '출항·입항 시 기록·관리 의무', MA, '법률', '제28조의11',
                 '그 출항ㆍ입항에 관한 사항을 기록ㆍ관리하여야 한다',
                 '마리나선박 대여업자', '기록',
                 basis='명시', basis_text='출항ㆍ입항 시에',
                 basis_why='원문이 "출항ㆍ입항 시에"로 시점을 정했다.'),
            step(2, '마리나선박 출항·입항 기록·관리대장 작성', MA, '시행규칙', '제33조의2',
                 '마리나선박의 출항ㆍ입항에 관한 사항을 별지 제23호의2서식의 마리나선박 출항ㆍ입항 기록ㆍ관리대장에 작성해야 한다',
                 '마리나선박 대여업자', '기록',
                 basis='조건연쇄', basis_text='법 제28조의11제1항에 따라',
                 basis_why='법 제28조의11제1항 기록의무의 서식을 정한 조문이다.',
                 prev=[1]),
            step(3, '승객의 승선신고서 작성·제출', MA, '법률', '제28조의11',
                 '마리나선박에 승선하는 승객이 해양수산부령으로 정하는 바에 따라 승선신고서를 작성하여 제출하도록 하여야 한다',
                 '마리나선박 대여업자 · 승객', '신고',
                 basis='조건연쇄', basis_text='마리나선박에 승선하는 승객이',
                 basis_why='승선이 있어야 승선신고서가 성립한다 — 출항 전 단계다.',
                 prev=[1]),
            step(4, '승객 신분·기재내용 확인', MA, '법률', '제28조의11',
                 '승선하려는 승객의 신분과 제2항에 따른 승선신고서의 기재내용을 확인하여야 한다',
                 '마리나선박 대여업자', '확인',
                 basis='조건연쇄', basis_text='제2항에 따른 승선신고서의 기재내용을 확인하여야 한다',
                 basis_why='제2항의 제출이 있어야 확인이 성립한다.',
                 prev=[3]),
            step(5, '미작성·신분확인 거부 시 승선 거부', MA, '법률', '제28조의11',
                 '승객이 정당한 사유 없이 제2항에 따른 승선신고서를 작성하여 제출하지 아니하거나',
                 '마리나선박 대여업자', '확인',
                 basis='조건연쇄', basis_text='제3항에 따른 신분확인 요구에 따르지 아니하는 경우에는',
                 basis_why='제2·3항의 요구가 있어야 거부가 성립한다.',
                 prev=[4]),
            step(6, '승선신고서 3개월 보관', MA, '시행규칙', '제33조의2',
                 '제출된 승선신고서를 해당 선박이나 영업소에 3개월 동안 보관해야 한다',
                 '마리나선박 대여업자', '기록', deadline='3개월 동안',
                 basis='조건연쇄', basis_text='제2항에 따라 제출된 승선신고서를',
                 basis_why='제2항의 제출이 있어야 보관이 성립한다.',
                 prev=[3]),
        ], tree_nodes=['powered_craft']))

    # ── 12. 어선 교신가입·위치통지 ──────────────────────────────
    flows.append(flow(
        'fishing_vessel_position_notice', '어선의 교신가입과 위치통지', '위치보고',
        '「어선법」 제5조에 따른 무선설비가 설치된 어선의 소유자·선장',
        [prov(FS, '법률', '제21조',
              '「어선법」 제5조에 따른 무선설비가 설치된 어선의 소유자는'),
         prov(FS, '법률', '제2조',
              '"교신가입"이란 무선설비가 설치된 어선의 선주가', disp='제2조제10호')],
        '어선안전조업본부(안전본부)',
        '무선설비가 설치된 어선이 출항하는 때',
        [
            step(1, '어선안전조업본부 교신가입', FS, '법률', '제21조',
                 '어선이 주로 출입항하는 항포구를 관할하는 안전본부에 교신가입하여야 한다',
                 '어선의 소유자', '등록', org='어선안전조업본부',
                 basis='조건연쇄', basis_text='무선설비가 설치된 어선의 소유자는',
                 basis_why='제2항의 위치통지가 "제1항에 따라 교신가입한 어선"을 전제한다.'),
            step(2, '교신가입신청서 출항 전까지 제출', FS, '시행규칙', '제10조',
                 '교신가입신청서에 다음 각 호의 서류를 첨부하여 출항 전까지 안전본부에 제출해야 한다',
                 '어선의 소유자', '등록', org='어선안전조업본부', deadline='출항 전까지',
                 basis='명시', basis_text='출항 전까지',
                 basis_why='원문이 제출 기한을 "출항 전까지"로 못박았다.',
                 prev=[1],
                 cond='무선국 허가증 사본과 양식업면허증·어업면허증·어업허가증(어획물운반선·부속선은 '
                      '어선검사증서) 사본을 첨부한다.'),
            step(3, '교신가입증 발급·어선안전종합관리시스템 기록', FS, '시행규칙', '제10조',
                 '교신가입신청서를 접수한 경우 별지 제6호서식의 교신가입증을 발급하고',
                 '어선안전조업본부', '등록',
                 basis='조건연쇄', basis_text='제1항에 따라 교신가입신청서를 접수한 경우',
                 basis_why='제1항의 신청이 접수돼야 발급이 성립한다.',
                 prev=[2]),
            step(4, '출항 시 지정된 시간에 맞춘 위치통지', FS, '법률', '제21조',
                 '교신가입한 어선이 출항할 때에는 지정된 시간에 맞추어 안전본부에 그 위치를 통지하여야 한다',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 basis='명시', basis_text='교신가입한 어선이 출항할 때에는',
                 basis_why='원문이 "출항할 때"를 위치통지의 시작점으로 정했다.',
                 prev=[1]),
            step(5, '위치통지 방법과 통지 대상 안전본부', FS, '시행령', '제12조',
                 '위치통지(이하 "위치통지"라 한다)는 위도와 경도를 통지하는 방법으로',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 basis='조건연쇄', basis_text='법 제21조제2항에 따른 위치통지',
                 basis_why='법 제21조제2항 위치통지의 방법을 정한 조문이다.',
                 prev=[4],
                 cond='특정해역 출어 시에는 그 특정해역 관할 안전본부, 그 밖에는 출항지 관할 안전본부. '
                      '교신이 불가능하면 인근 안전본부에 한다.',
                 branch={'질문': '어느 해역에 출어하시나요?',
                         '갈래': [
                             {'조건': '특정해역 또는 조업자제해역', '다음': [6]},
                             {'조건': '일반해역', '다음': [7]}]}),
            step(6, '특정해역·조업자제해역 위치통지 횟수', FS, '시행령', '제12조',
                 '특정해역 또는 조업자제해역에 진입할 때 위치통지를 해야 한다',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 deadline='직전의 통지시각을 기준으로 12시간 이내',
                 basis='조건연쇄', basis_text='위치통지의 횟수는 다음 각 호의 구분에 따른다',
                 basis_why='제2항이 제1항 위치통지의 횟수를 구분해 정한다.',
                 prev=[5],
                 cond='①진입 시 ②진입 통지 시각(또는 특정해역 출항 시각) 기준 12시간 이내, 이후에는 직전 '
                      '통지시각 기준 12시간 이내 ③이탈 시',
                 also=['특정해역 또는 조업자제해역에서 이탈할 때 위치통지를 해야 한다']),
            step(7, '일반해역 위치통지 횟수', FS, '시행령', '제12조',
                 '일반해역에 출어하는 어선: 일반해역으로 출항하는 시각 또는 일반해역에 진입하는 시각을 기준으로 24시간 이내에 위치통지를 해야 하고',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 deadline='직전의 통지시각을 기준으로 24시간 이내',
                 basis='조건연쇄', basis_text='일반해역에 출어하는 어선',
                 basis_why='제2항이 제1항 위치통지의 횟수를 해역별로 구분해 정한다.',
                 prev=[5],
                 branch={'질문': '풍랑특보 또는 태풍특보가 발효됐나요?',
                         '갈래': [
                             {'조건': '일반해역에 풍랑특보 발효 — 12시간 이내 주기로 통지', '다음': [8]},
                             {'조건': '태풍특보 발효 중 조업·항행 — 4시간 이내 주기로 통지', '다음': [8]},
                             {'조건': '특보 없음 — 24시간 이내 주기 유지', '다음': [9]}]}),
            step(8, '풍랑특보·태풍특보 발효 시 통지 주기 단축', FS, '시행령', '제12조',
                 '풍랑특보 또는 태풍특보가 발효된 경우에는 다음 각 호의 구분에 따라 위치통지를 해야 한다',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 deadline='해당 태풍특보가 발효된 시각을 기준으로 4시간 이내',
                 basis='조건연쇄', basis_text='제2항제1호나목 및 같은 항 제2호에도 불구하고',
                 basis_why='제2항의 통상 주기가 있어야 이 단축이 의미를 갖는다.',
                 prev=[6, 7],
                 cond='일반해역 풍랑특보: 발효 시각·진입 시각·출항 시각 기준 12시간 이내. '
                      '태풍특보: 발효 시각 기준 4시간 이내.'),
            step(9, '특보 해제 시 통상 주기 복귀', FS, '시행령', '제12조',
                 '풍랑특보 또는 태풍특보가 해제된 경우에는 제2항제1호나목 또는 같은 항 제2호에 따라 위치통지를 해야 한다',
                 '어선의 소유자 또는 선장', '통보', org='어선안전조업본부',
                 basis='조건연쇄', basis_text='제3항에 따른 풍랑특보 또는 태풍특보가 해제된 경우에는',
                 basis_why='제3항의 단축 주기가 적용되던 상태에서만 복귀가 성립한다.',
                 prev=[8]),
            step(10, '위치통지 불이행 시 위치 확인과 수색·구조기관 통보', FS, '법률', '제21조',
                 '지정된 시간까지 위치통지의무를 이행하지 않는 경우 해양수산부장관은 해당 어선의 위치를 확인하고',
                 '해양수산부장관', '처분', org='수색ㆍ구조기관',
                 basis='조건연쇄', basis_text='지정된 시간까지 위치통지의무를 이행하지 않는 경우',
                 basis_why='위치통지 의무(제4단계)가 있어야 불이행이 성립한다.',
                 prev=[4],
                 cond='위치 확인은 무선통신 방송과 어선안전종합관리시스템 등을 활용하며, 해양수산부장관이 '
                      '정하는 시간이 지날 때까지 통지하지 않은 어선을 관할 해양경찰서·어업관리단에 알린다'
                      '(시행령 제13조).'),
        ], tree_nodes=['fishing_vessel']))

    # ── 13. 선박위치통보(수색구조법) ────────────────────────────
    flows.append(flow(
        'ship_position_report_sar', '선박위치통보(항해계획→위치→변경→최종)', '위치보고',
        '국제항해 여객선, 국제항해 총톤수 300톤 이상·항행시간 12시간 이상 선박, 조종불능선·조종제한선·'
        '흘수제약선, 예인선열 200미터 초과 예인선, 위험화물 운송선박의 선장',
        [prov(SR, '시행규칙', '제13조',
              '선박의 위치를 통보하여야 하는 선박의 범위는 다음 각 호와 같다'),
         prov(SR, '법률', '제33조',
              '선장은 선박이 항구 또는 포구로부터 출항하거나 해양경찰청장이 지정ㆍ고시하는 선박위치통보해역에 진입한 때에는')],
        '해상구조조정본부',
        '선박이 항구·포구에서 출항하거나 선박위치통보해역에 진입한 때',
        [
            step(1, '통보 대상 선박 여부 확인', SR, '시행규칙', '제13조',
                 '선박의 위치를 통보하여야 하는 선박의 범위는 다음 각 호와 같다',
                 '선장', '확인',
                 basis='조건연쇄', basis_text='법 제33조제2항에 따라',
                 basis_why='법 제33조 통보 의무의 적용 범위를 정한 조문이라 통보보다 앞선다.',
                 cond='조종불능선·조종제한선·흘수제약선, 예인선열 200미터 초과 예인선, 위험화물 운송선박은 '
                      '세계 해상조난 및 안전제도 통신설비를 설치한 선박으로 한정한다.',
                 branch={'질문': '선박위치발신장치를 갖추고 항행하는 선박인가요?',
                         '갈래': [
                             {'조건': '「선박안전법」 제30조에 따른 선박위치발신장치를 갖추고 항행 — '
                                      '위치통보를 생략할 수 있음', '다음': [3]},
                             {'조건': '그 밖의 선박 — 항해계획통보부터 순서대로', '다음': [2]}]}),
            step(2, '항해계획통보', SR, '시행규칙', '제14조',
                 '항해계획통보: 선박이 항구 또는 포구를 출항하기 직전 또는 그 직후나 해양경찰청장이 지정ㆍ고시하는 선박위치통보해역에 진입한 때',
                 '선장', '통보', org='해상구조조정본부',
                 deadline='출항하기 직전 또는 그 직후',
                 basis='명시', basis_text='출항하기 직전 또는 그 직후',
                 basis_why='원문이 첫 통보의 시점을 출항 직전·직후로 못박았다.',
                 prev=[1]),
            step(3, '위치통보(항해계획 통보 후 약 12시간마다)', SR, '시행규칙', '제14조',
                 '위치통보: 항해계획 통보 후 약 12시간마다',
                 '선장', '통보', org='해상구조조정본부', deadline='항해계획 통보 후 약 12시간마다',
                 basis='명시', basis_text='항해계획 통보 후 약 12시간마다',
                 basis_why='원문이 항해계획통보를 기준으로 이 통보의 주기를 정했다 — 선후가 원문에 있다.',
                 prev=[2]),
            step(4, '변경통보', SR, '시행규칙', '제14조',
                 '변경통보: 항해계획의 내용을 변경한 때, 선박이 예정위치에서 25해리 이상 벗어난 때 또는 목적지를 변경한 때',
                 '선장', '통보', org='해상구조조정본부',
                 basis='조건연쇄', basis_text='항해계획의 내용을 변경한 때',
                 basis_why='항해계획통보(제2단계)가 있어야 그 변경이 성립한다.',
                 prev=[2]),
            step(5, '최종통보', SR, '시행규칙', '제14조',
                 '최종통보: 목적지에 도착하기 직전이나 도착한 때 또는 해양경찰청장이 지정ㆍ고시하는 선박위치통보해역을 벗어난 때',
                 '선장', '통보', org='해상구조조정본부',
                 deadline='목적지에 도착하기 직전이나 도착한 때',
                 basis='명시', basis_text='목적지에 도착하기 직전이나 도착한 때',
                 basis_why='원문이 마지막 통보의 시점을 도착 직전·도착 시로 정했다.',
                 prev=[3, 4]),
            step(6, '통보 방법(서면·유무선통신, 지정 주파수)', SR, '시행규칙', '제14조',
                 '선박위치통보는 서면 제출 또는 유선ㆍ무선통신 등의 방법으로 할 수 있다',
                 '선장', '통보',
                 basis='미확정',
                 basis_why='통보 방법은 모든 통보에 공통으로 적용되며 원문이 다른 단계와의 선후를 정하지 않았다.',
                 cond='무선통신으로 할 때에는 선박 무선국에 지정된 주파수 중 해양경찰청장이 고시하는 주파수를 '
                      '이용한다.'),
        ], tree_nodes=['general_ship']))

    # ── 14. 선박교통관제구역 신고 ───────────────────────────────
    flows.append(flow(
        'vts_area_report', '선박교통관제구역에서의 항행·정박·계류 신고', '위치보고',
        '선박교통관제구역에서 항행하거나 정박·계류하려는 관제대상선박의 선장',
        [prov(VT, '법률', '제14조',
              '관제대상선박의 선장은 선박교통관제구역에서 항행하거나 정박(碇泊) 또는 계류(繫留)하려는 경우에는')],
        '선박교통관제관서(해당 관제구역 관할)',
        '관제대상선박이 관제구역에 들어오거나 관제구역에서 정박·계류하려는 때',
        [
            step(1, '관제구역 진입·통과·항행 개시 시 항행 신고', VT, '시행령', '제8조',
                 '항행 신고: 관제대상선박이 선박교통관제구역으로 들어오거나 선박교통관제구역 중 해양경찰청장이 정하여 고시하는 위치를 통과하려는 경우',
                 '관제대상선박의 선장', '신고', org='선박교통관제관서',
                 basis='명시', basis_text='선박교통관제구역으로 들어오거나',
                 basis_why='원문이 신고 시점을 관제구역 진입·통과·항행 개시로 정했다.',
                 cond='신고 사항: 선박명, 선박의 위치, 목적지, 항행 예정 시각 및 항행 시작 시각(정박·계류 중인 '
                      '선박이 항행하려는 경우), 해양경찰청장이 고시하는 사항',
                 branch={'질문': '관제구역에서 무엇을 하려고 하시나요?',
                         '갈래': [
                             {'조건': '항행(진입·통과·정박이나 계류 중 항행 개시)', '다음': [2]},
                             {'조건': '닻을 내려놓고 항행을 멈춤 — 정박 신고', '다음': [2]},
                             {'조건': '계류시설에 붙들어 맴 — 계류 신고', '다음': [3]}]}),
            step(2, '정박 신고', VT, '시행령', '제8조',
                 '정박 신고: 관제대상선박이 선박교통관제구역에서 닻을 내려놓고 항행을 멈추려는 경우',
                 '관제대상선박의 선장', '신고', org='선박교통관제관서',
                 basis='명시', basis_text='닻을 내려놓고 항행을 멈추려는 경우',
                 basis_why='원문이 신고 시점을 정박하려는 때로 정했다.',
                 prev=[1],
                 cond='신고 사항: 선박명, 정박 위치, 정박 시각, 해양경찰청장이 고시하는 사항'),
            step(3, '계류 신고', VT, '시행령', '제8조',
                 '계류 신고: 관제대상선박을 선박교통관제구역에 있는 계류시설',
                 '관제대상선박의 선장', '신고', org='선박교통관제관서',
                 basis='명시', basis_text='붙들어 매어 놓으려는 경우',
                 basis_why='원문이 신고 시점을 계류하려는 때로 정했다.',
                 prev=[1],
                 cond='신고 사항: 선박명, 계류 위치, 계류 시각, 해양경찰청장이 고시하는 사항'),
            step(4, '관제통신 상시 청취·응답', VT, '법률', '제14조',
                 '관제통신 주파수를 갖추고 관제통신을 항상 청취ㆍ응답하여야 한다',
                 '관제대상선박의 선장', '통보', org='선박교통관제관서',
                 basis='명시', basis_text='선박교통관제구역에서 항행하거나 정박 또는 정류(停留)하는 경우에는',
                 basis_why='원문이 관제구역에서 항행·정박·정류하는 동안의 의무로 정했다.',
                 prev=[1],
                 cond='통신 장애로 지정 주파수 통화가 불가능하면 휴대전화 등 다른 통신주파수를 이용할 수 있다.'),
            step(5, '관제사 지시 이행, 불이행 시 지체 없이 사유 통보', VT, '법률', '제14조',
                 '선박교통관제사의 지시에 따라야 한다',
                 '관제대상선박의 선장', '확인', org='선박교통관제관서', deadline='지체 없이',
                 basis='조건연쇄', basis_text='해당 지시에 따르지 아니한 사유를 지체 없이 선박교통관제사에게 알려야 한다',
                 basis_why='관제사의 지시가 있어야 이행·불이행 통보가 성립한다.',
                 prev=[4]),
            step(6, '항로상 장애물·해양사고 인지 시 지체 없이 신고', VT, '법률', '제14조',
                 '선박교통의 안전을 해치거나 해칠 우려가 있다고 인지한 경우에는 지체 없이 이를 선박교통관제관서에 신고하여야 한다',
                 '관제대상선박의 선장', '신고', org='선박교통관제관서', deadline='지체 없이',
                 basis='명시', basis_text='인지한 경우에는 지체 없이',
                 basis_why='원문이 신고 시점을 "인지한 경우에는 지체 없이"로 정했다.',
                 prev=[1]),
        ], tree_nodes=['general_ship']))

    # ── 15. 어선위치발신장치 고장·분실 신고 ─────────────────────
    flows.append(flow(
        'fishing_vessel_vms_failure', '어선위치발신장치의 작동과 고장·분실 신고', '위치보고',
        '「어선법」 제2조제1호 가목·나목 어선(내수면어업 종사 어선 등 제외)의 소유자 또는 선장',
        [prov(FV, '법률', '제5조의2',
              '어선의 위치를 자동으로 발신하는 장치(이하 "어선위치발신장치"라 한다)를 갖추고 이를 작동하여야 한다')],
        '해양경찰청장 · 관할 파출소장등',
        '어선위치발신장치를 갖추고 작동하는 동안, 그 장치가 고장나거나 분실된 때',
        [
            step(1, '어선위치발신장치 설치·작동', FV, '법률', '제5조의2',
                 '해양수산부장관이 정하는 기준에 따라 어선의 위치를 자동으로 발신하는 장치',
                 '어선의 소유자', '발신',
                 basis='명시', basis_text='어선의 안전운항을 확보하기 위하여',
                 basis_why='이 설치·작동이 있어야 이후 고장·분실 신고 단계가 성립한다.',
                 cond='무선설비가 어선위치발신장치의 기능을 가지고 있으면 갖춘 것으로 본다(같은 조 제2항).'),
            step(2, '고장·분실 시 지체 없이 신고', FV, '법률', '제5조의2',
                 '어선위치발신장치가 고장나거나 이를 분실한 경우 지체 없이 그 사실을 해양경찰청장에게 신고한 후',
                 '어선의 소유자 또는 선장', '신고', org='해양경찰청장', deadline='지체 없이',
                 basis='명시', basis_text='고장나거나 이를 분실한 경우 지체 없이',
                 basis_why='원문이 신고 시점을 "고장나거나 분실한 경우 지체 없이"로 못박았다.',
                 prev=[1]),
            step(3, '고장·분실 신고서 제출', FV, ADM, '제11조',
                 '어선위치발신장치 고장ㆍ분실 신고서를 파출소장등에게 지체 없이 제출해야 한다',
                 '어선소유자등', '신고', org='파출소장등', notice=VPASS, deadline='지체 없이',
                 basis='조건연쇄', basis_text='어선위치발신장치를 고장 또는 분실한 경우',
                 basis_why='법 제5조의2제3항 신고의 서식·제출처를 정한 고시다.',
                 prev=[2],
                 cond='인터넷 어선출입항신고시스템 등 전자적 방법으로도 신고할 수 있다.'),
            step(4, '항해·조업 중 고장 시 무선·휴대전화 신고 → 입항 후 서면 신고', FV, ADM, '제11조',
                 '항해 또는 조업 중에 어선위치발신장치가 고장나거나 분실된 경우',
                 '어선소유자등', '신고',
                 org='파출소장등 · 해양경찰 경비함정장 · 수협 어선안전조업국장',
                 notice=VPASS, deadline='입항 후 지체 없이',
                 basis='명시', basis_text='입항 후 지체 없이',
                 basis_why='원문이 "지체 없이 신고하고 입항 후 지체 없이 제1항의 방법으로 신고"라고 '
                           '두 단계의 선후를 직접 정했다.',
                 prev=[2],
                 cond='신고 사항: 어선의 명칭·위치·비상연락망, 선장 및 승선원 정보, 출항일시와 출항지, '
                      '예정된 입항일시와 입항지',
                 also=['다른 무선설비 또는 휴대전화장치 등을 이용하여']),
            step(5, '접수기관의 파출소장등 통보와 종합정보시스템 입력', FV, ADM, '제11조',
                 '해양경찰 경비함정장 또는 수협 어선안전조업국장이 제2항에 따른 신고를 받은 경우 지체 없이 파출소장등에게 그 내용을 통보해야 한다',
                 '해양경찰 경비함정장 · 수협 어선안전조업국장 · 파출소장등', '통보',
                 notice=VPASS, deadline='지체 없이',
                 basis='조건연쇄', basis_text='제2항에 따른 신고를 받은 경우',
                 basis_why='제2항(제4단계)의 신고가 있어야 통보가 성립한다.',
                 prev=[4],
                 also=['어선출입항 종합정보시스템에 입력해야 한다']),
            step(6, '15일 이내 수리·재설치', FV, '시행령', '제1조의2',
                 '제5조의2제3항에서 "대통령령으로 정하는 기한"이란 15일을 말한다',
                 '어선의 소유자 또는 선장', '확인', deadline='15일',
                 basis='조건연쇄', basis_text='제5조의2제3항에서 "대통령령으로 정하는 기한"이란',
                 basis_why='법 제5조의2제3항이 "신고한 후 대통령령으로 정하는 기한까지" 조치하라고 정해, '
                           '신고 뒤 단계임이 원문으로 확인된다.',
                 prev=[2, 3],
                 cond='천재지변, 기상악화 등 부득이한 사유가 있으면 한 번만 15일의 범위에서 연기할 수 있다.'),
            step(7, '처리기한 연기 신고', FV, ADM, '제12조',
                 '어선위치발신장치의 수리 및 재설치 등의 처리기한을 연기하고자 할 때에는',
                 '어선소유자등', '신고', org='파출소장등', notice=VPASS,
                 basis='조건연쇄', basis_text='제11조제1항에 따른 신고서를 제출한 파출소장등에게',
                 basis_why='제11조제1항 신고(제3단계)가 있어야 연기 신고가 성립한다.',
                 prev=[3, 6],
                 cond='처리기한의 기준일은 연기 신고서를 제출한 다음 날부터 기산한다(같은 조 제1항).'),
            step(8, '수리 후 재사용 신고 또는 교체 신고', FV, ADM, '제13조',
                 '고장 신고된 어선위치발신장치를 수리하여 재사용하고자 하는 경우 그 사실을',
                 '어선소유자등', '신고', org='파출소장등', notice=VPASS,
                 basis='조건연쇄', basis_text='고장 신고된 어선위치발신장치를 수리하여',
                 basis_why='고장 신고(제3단계)가 있어야 재사용 신고가 성립한다.',
                 prev=[3, 6]),
        ], tree_nodes=['fishing_vessel']))

    # ── 16. 선박위치발신장치 작동·중단 ──────────────────────────
    flows.append(flow(
        'ship_vms_operation', '선박위치발신장치의 작동과 해적 출몰 시 중단', '위치보고',
        '해양수산부령으로 정하는 선박의 소유자·선장',
        [prov(SS, '법률', '제30조',
              '해양수산부령으로 정하는 선박의 소유자는 해양수산부장관이 정하여 고시하는 기준에 따라')],
        '해양수산부장관(고시 기준)',
        '대상 선박이 항행하는 동안',
        [
            step(1, '선박위치발신장치 설치·작동', SS, '법률', '제30조',
                 '선박의 위치를 자동으로 발신하는 장치(이하 "선박위치발신장치"라 한다)를 갖추고 이를 작동하여야 한다',
                 '선박의 소유자', '발신',
                 basis='명시', basis_text='선박의 안전운항을 확보하고 해양사고 발생시 신속한 대응을 위하여',
                 basis_why='이 작동이 있어야 이후 중단·기재 단계가 성립한다.'),
            step(2, '무선설비가 기능을 가진 경우 갖춘 것으로 봄', SS, '법률', '제30조',
                 '무선설비가 선박위치발신장치의 기능을 가지고 있는 때에는 선박위치발신장치를 갖춘 것으로 본다',
                 '선박의 소유자', '확인',
                 basis='조건연쇄', basis_text='선박위치발신장치를 갖춘 것으로 본다',
                 basis_why='제1항의 설치 의무를 대체하는 규정이라 제1항 없이는 성립하지 않는다.',
                 prev=[1]),
            step(3, '해적·해상강도 출몰 시 작동 중단과 항해일지 기재', SS, '법률', '제30조',
                 '해적 또는 해상강도의 출몰 등으로 인하여 선박의 안전을 위협할 수 있다고 판단되는 경우 선박위치발신장치의 작동을 중단할 수 있다',
                 '선박의 선장', '확인',
                 basis='조건연쇄', basis_text='선박위치발신장치의 작동을 중단할 수 있다',
                 basis_why='작동(제1단계) 중인 장치만 중단할 수 있다.',
                 prev=[1],
                 also=['그 상황을 항해일지 등에 기재하여야 한다']),
        ], tree_nodes=['general_ship']))

    # ── 17. 원거리 수상레저활동 신고 ────────────────────────────
    flows.append(flow(
        'long_distance_leisure_report', '원거리 수상레저활동의 신고', '위치보고',
        '출발항으로부터 10해리 이상 떨어진 곳에서 수상레저활동을 하려는 사람',
        [prov(WL, '법률', '제23조',
              '출발항으로부터 10해리 이상 떨어진 곳에서 수상레저활동을 하려는 사람은')],
        '해양경찰관서 또는 경찰관서',
        '출발항에서 10해리 이상 떨어진 곳에서 수상레저활동을 하려는 때',
        [
            step(1, '원거리 수상레저활동 신고 의무', WL, '법률', '제23조',
                 '출발항으로부터 10해리 이상 떨어진 곳에서 수상레저활동을 하려는 사람은 해양수산부령으로 정하는 바에 따라 해양경찰관서나 경찰관서에 신고하여야 한다',
                 '수상레저활동을 하려는 사람', '신고', org='해양경찰관서 또는 경찰관서',
                 basis='명시', basis_text='수상레저활동을 하려는 사람은',
                 basis_why='원문이 활동을 "하려는" 때의 사전 의무로 정했다.',
                 branch={'질문': '이미 다른 법에 따른 출입항 신고를 한 선박인가요?',
                         '갈래': [
                             {'조건': '선박입출항법 제4조 출입 신고 또는 「선박안전 조업규칙」 제15조 '
                                      '출항ㆍ입항 신고를 한 선박 — 원거리 신고 대상 아님', '다음': [3]},
                             {'조건': '그 밖의 경우 — 원거리 수상레저활동 신고서 제출', '다음': [2]}]},
                 note='이 단서는 raw 기준으로 이미 폐지된 「선박안전 조업규칙」 제15조를 인용한다'
                      '(현행 근거는 어선안전조업법 제8조). 원문 그대로 인용했다.'),
            step(2, '원거리 수상레저활동 신고서 제출', WL, '시행규칙', '제26조',
                 '원거리 수상레저활동 신고서를 해양경찰관서나 경찰관서에 제출(팩스나 정보통신망을 이용한 전자문서의 제출을 포함한다)해야 한다',
                 '수상레저활동을 하려는 사람', '신고', org='해양경찰관서 또는 경찰관서',
                 basis='조건연쇄', basis_text='법 제23조제1항 본문에 따라 원거리 수상레저활동을 하려는 사람은',
                 basis_why='법 제23조제1항 신고의 서식·제출처를 정한 조문이다.',
                 prev=[1]),
            step(3, '등록 대상이 아닌 수상레저기구의 10해리 이상 활동 금지와 예외', WL, '법률', '제23조',
                 '등록 대상 동력수상레저기구"라 한다)가 아닌 수상레저기구로 수상레저활동을 하려는 사람은 출발항으로부터 10해리 이상 떨어진 곳에서 수상레저활동을 하여서는 아니 된다',
                 '수상레저활동을 하려는 사람', '확인',
                 basis='조건연쇄', basis_text='제1항에도 불구하고',
                 basis_why='제1항의 신고 체계를 전제로 한 별도 금지 규정이다.',
                 prev=[1],
                 cond='연해·근해·원양구역을 운항구역으로 하는 동력수상레저기구와 500미터 이내 거리에서 '
                      '동행하거나, 위치를 확인할 수 있는 통신기기를 갖춘 수상레저기구 2대 이상으로 선단을 '
                      '구성해 500미터(무동력은 200미터) 이내 거리를 유지하면 예외(시행규칙 제26조제2항).'),
        ], tree_nodes=['water_leisure_craft']))

    return flows


# ═══════════════════════════════════════════════════════════════════
def validate(flows):
    """설계 §8 성공기준 5번 — 참조 무결성·순번 연속성·분기 형식."""
    ids = set()
    for f in flows:
        if f['id'] in ids:
            ERRORS.append('플로우 id 중복: %s' % f['id'])
        ids.add(f['id'])
        if not f.get('적용대상_근거') or any(p is None for p in f['적용대상_근거']):
            ERRORS.append('적용대상 근거 없음/실패: %s' % f['id'])
        steps = f['단계']
        if any(s is None for s in steps):
            ERRORS.append('단계 빌드 실패 포함: %s' % f['id'])
            continue
        nos = [s['순번'] for s in steps]
        if nos != list(range(1, len(steps) + 1)):
            ERRORS.append('순번이 1..N 연속이 아님: %s → %s' % (f['id'], nos))
        valid = set(nos)
        for s in steps:
            for p in s['선행단계']:
                if p not in valid:
                    ERRORS.append('선행단계가 실재하지 않음: %s 단계%s → %s' % (f['id'], s['순번'], p))
                if p >= s['순번']:
                    ERRORS.append('선행단계가 자기 순번 이상: %s 단계%s → %s'
                                  % (f['id'], s['순번'], p))
            b = s.get('분기')
            if b:
                if not b.get('질문') or len(b.get('갈래', [])) < 2:
                    ERRORS.append('분기 형식 오류(질문 없음/갈래 2개 미만): %s 단계%s'
                                  % (f['id'], s['순번']))
                for g in b.get('갈래', []):
                    if not g.get('조건'):
                        ERRORS.append('분기 갈래에 조건이 없음: %s 단계%s' % (f['id'], s['순번']))
                    for n in g.get('다음', []):
                        if n not in valid:
                            ERRORS.append('분기 갈래의 다음 순번이 실재하지 않음: %s 단계%s → %s'
                                          % (f['id'], s['순번'], n))


def main():
    flows = build()
    validate(flows)
    if ERRORS:
        print('빌드 실패 — raw 대조/무결성 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    scan = scan_corpus()
    steps = [s for f in flows for s in f['단계']]
    per_law = {}
    for s in steps:
        per_law[s['근거법령_slug']] = per_law.get(s['근거법령_slug'], 0) + 1
    for f in flows:
        for p in f['적용대상_근거']:
            per_law.setdefault(p['법령_slug'], per_law.get(p['법령_slug'], 0))

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 — 74법 raw 전수 스캔으로 만든 "출입항 신고 · 위치보고" 절차 플로우. '
                 '설계·방법론·연동설계는 _dashboard/H32_port_entry_flow_design.md 참조.',
        'semantics': {
            '자료구조': '이 자산은 트리(계층)가 아니라 순서 있는 흐름(flow)이다. 단계 간 관계는 '
                        '"A는 B의 한 종류다"가 아니라 "A를 한 뒤에 B를 한다"이다. 트리로 읽으면 '
                        '"다음 단계"를 "하위 분류"로 오해하게 된다(설계 §0).',
            '순서근거': '모든 단계는 자기가 그 자리에 있는 이유를 `순서근거`로 들고 다닌다. '
                        '종류가 "명시"·"조건연쇄"이면 `문구`가 그 조문 원문의 부분문자열임을 빌더가 검증했고, '
                        '"미확정"이면 원문이 선후를 정하지 않았다는 뜻이라 배열 위치는 읽기 편의일 뿐이다.',
            '기한': '`기한`은 raw 원문의 부분문자열이다(요약 금지). 상대적 표현("지체 없이", "출항 전까지")이 '
                    '그대로 들어 있으며, 날짜 계산을 하려면 별도 파싱이 필요하다.',
            '분기': '`조건`은 그 단계 자체의 적용 요건이고, `분기`는 그 단계 다음이 갈라지는 지점이다. '
                    '`분기.질문`은 되묻기가 그대로 꺼내 쓰라고 미리 박아둔 문장이다.',
            '관련_트리노드': 'vessel_doc_tree.json의 노드 id 참조. 이번 라운드에 코드로 배선하지는 않았다.',
        },
        'caveats': [
            '`순서근거: 미확정`인 단계의 배열 위치는 우리가 정한 것이지 법이 정한 것이 아니다. '
            '개수는 summary.steps_by_order_basis에 공개한다.',
            '`기한`은 원문 문구 그대로다 — "지체 없이"·"출항 전까지" 같은 상대적 표현이 그대로 들어 있다.',
            '각 플로우는 그 절차의 대표 경로다. 모든 예외·면제를 단계로 펼치지 않았고 `조건`·`분기`에 요약했다.',
            '선박입출항법 제4조는 2026.5.12 시행 개정으로 항이 밀렸는데(제3항 신설), 시행령 제3조~제5조와 '
            '시행규칙 제5조는 raw 기준으로 여전히 "법 제4조제3항"을 인용한다. 원문을 고치지 않고 그대로 '
            '인용하고 해당 단계 `주의`에 적었다.',
            '낚시 관리 및 육성법 시행규칙 제20조제1항은 이미 폐지된 「선박안전 조업규칙」 제9조를, '
            '수상레저안전법 제23조제1항 단서는 같은 규칙 제15조를 인용한다(현행 근거는 어선안전조업법 제8조). '
            '원문 그대로 인용하고 `주의`에 적었다.',
            '「선박패스(V-Pass) 장치…고시」는 raw에 제목 표기가 다른 두 파일로 들어와 있고 _admrul.json의 '
            'ID가 둘 다 2100000264514로 같다. 같은 고시가 두 제목으로 중복 수집된 것으로 보이며, 이 플로우는 '
            '소관부서·현행여부 메타가 붙어 있는 쪽을 인용했다(L-73 계열 문제).',
            '항만별 지방 운영세칙(12개 항 항만시설운영세칙 등)은 담지 않았다 — 모법을 항별로 반복하고 '
            '상당수가 폐지된 「개항질서법」 등을 인용하기 때문이다. 그 결과 "동해·묵호항 입항·출항 12시간 전 '
            '신고"처럼 모법에 없는 항별 고유 기한은 이 데이터에 없다.',
            '출입국관리법 제75조제1항 출·입항보고서의 제출 시기는 대통령령 위임 사항인데, 그 시행령 조문이 '
            'raw에 발췌(시행령_발췌.txt)로만 수집돼 있어 확인하지 못했다 — 해당 단계는 순서근거를 미확정으로 뒀다.',
            '자치법규(raw/_자치법규/)·국제협약 원문·별표는 이번 스캔 대상이 아니다(74법 기준법 체계만).',
            '이 자산은 절차의 뼈대다. 각 단계의 별지 서식 내용 자체는 담지 않았다.',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned': scan['files'],
            'articles_scanned': scan['articles'],
            'scan_candidates': scan['candidates'],
            'laws_with_scan_candidates': len(scan['laws_with_candidates']),
            'laws_without_scan_candidates': len(LAWS) - len(scan['laws_with_candidates']),
            'laws_in_flows': len(per_law),
            'flows': len(flows),
            'steps': len(steps),
            'branches': sum(f['분기수'] for f in flows),
            'branch_paths': sum(len(s['분기']['갈래']) for s in steps if s.get('분기')),
            'flows_by_topic': {t: sum(1 for f in flows if f['주제'] == t)
                               for t in ('출입항', '위치보고')},
            'steps_by_order_basis': {b: sum(1 for s in steps if s['순서근거']['종류'] == b)
                                     for b in ('명시', '조건연쇄', '미확정')},
            'steps_with_deadline': sum(1 for s in steps if s['기한']),
            'steps_by_tier': {t: sum(1 for s in steps if s['계층'] == t)
                              for t in ('법률', '시행령', '시행규칙', '행정규칙')},
            'per_law': dict(sorted(per_law.items(), key=lambda kv: -kv[1])),
        },
        'scan': {
            '설명': '설계 §5.2의 3중 조건(사건어 × 행위어 × 주체어, 벌칙 문장 제외)으로 74법 raw 전수를 훑은 결과. '
                    '후보 문장이 곧 절차 단계는 아니다 — 항만시설 사용·예선 운영·사람의 항만 출입 등이 섞여 '
                    '있어 사람이 추려 플로우에 넣었다.',
            'laws_with_candidates': scan['laws_with_candidates'],
            'laws_without_candidates': sorted({l['slug'] for l in LAWS} - set(scan['laws_with_candidates'])),
        },
        'unmapped': {
            '설명': '스캔 후보에는 걸렸으나 "출입항 신고·위치보고 절차"가 아니어서 플로우에 넣지 않은 것들. '
                    '무엇을 왜 뺐는지 남겨두어야 다음 사람이 같은 판단을 반복하지 않는다(설계 §6.3).',
            '유형_단위': [
                {'유형': '항만별 지방 운영세칙의 입출항 신고',
                 '예': '항만법·선박입출항법·항만운송사업법 공용 행정규칙인 포항항·마산항·목포항·평택당진항·'
                       '동해묵호항 등 「항만시설운영세칙」 제6~8조',
                 '사유': '모법(선박입출항법 제4조)을 항별로 반복하고, 상당수가 폐지된 「개항질서법」이나 '
                         '존재하지 않는 시행규칙 조문을 인용하고 있어 그대로 담으면 오정보가 된다.'},
                {'유형': '예선(曳船) 운영세칙',
                 '예': '부산항·여수광양항·대산항·인천항 등 「예선운영세칙」, 「예선운영 및 업무처리요령」',
                 '사유': '예선 사용·타항지원·자율사용 신고 절차이지 본선의 출입항 절차가 아니다.'},
                {'유형': '조업상황·어획실적 보고',
                 '예': '수산업법 시행규칙 제91조 · 「연근해어업의 조업상황 등의 보고에 관한 고시」',
                 '사유': '"입항한 날부터 3일 이내"처럼 입항에 걸린 기한이 있지만 보고 대상이 위치가 아니라 '
                         '어획이라 축이 다르다.'},
                {'유형': '여객선 출항 전 안전점검·출항정지',
                 '예': '해운법 시행규칙 제15조의12·제15조의15',
                 '사유': '출항 전 절차이지만 축이 여객 안전관리(점검·출항정지)다.'},
                {'유형': '사람·차량의 항만보호구역 출입',
                 '예': '국제항해선박및항만시설의보안에관한법률 계열 「항만출입절차에 관한 세부규정」 등',
                 '사유': '선박의 입출항이 아니라 사람·차량의 항만 출입 절차다.'},
                {'유형': '입역·출역 시 표지깃발 게양',
                 '예': '배타적 경제수역에서의 외국인어업 등에 대한 주권적 권리의 행사에 관한 법률 시행규칙 제10조',
                 '사유': '입역·출역 시 깃발을 게양하라는 표지 의무이지 신고·보고가 아니다.'},
                {'유형': '허가의 예외만 정한 조문',
                 '예': '해상교통안전법 제6조(보호수역의 입역)',
                 '사유': '허가 없이 입역할 수 있는 예외만 규정해 절차 단계를 구성하지 못한다.'},
                {'유형': '벌칙·과태료',
                 '예': '각 법 벌칙장(어선안전조업법 제58조, 선박입출항법 제59조 등)',
                 '사유': '축이 다르다(H32_hierarchy_candidates.md A절 별도 주제).'},
            ],
        },
        'flows': flows,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    s = out['summary']
    print('OK — 플로우 %d · 단계 %d · 분기 %d(갈래 %d) → %s'
          % (s['flows'], s['steps'], s['branches'], s['branch_paths'],
             os.path.relpath(OUT, LEGAL)))
    print('   커버리지: %d법 스캔 · %d파일 · %d조문 · 후보발견 %d법 · 플로우반영 %d법'
          % (s['laws_in_scope'], s['files_scanned'], s['articles_scanned'],
             s['laws_with_scan_candidates'], s['laws_in_flows']))
    print('   순서근거: 명시 %d · 조건연쇄 %d · 미확정 %d · 기한명시 단계 %d'
          % (s['steps_by_order_basis']['명시'], s['steps_by_order_basis']['조건연쇄'],
             s['steps_by_order_basis']['미확정'], s['steps_with_deadline']))


if __name__ == '__main__':
    main()
