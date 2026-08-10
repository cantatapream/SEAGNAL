#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""인허가 유형(면허/허가/신고/등록) 계층 트리 빌더 겸 검증기 (H-32 확장).

역할(초보자용):
  74법 raw 원문을 훑어 "이 일을 하려면 이 법에서 무엇(면허·허가·등록·신고)을 받아야 하고,
  그때 무슨 의무가 따라오는가"를 근거조문과 함께 트리(JSON)로 만든다.
  ★법마다 따로 만든다 — 같은 "신고"라도 법마다 강도가 달라서, 법을 가로질러 하나로 합치면 틀린다.
  사람이 인용문을 타이핑하지 않는다. 아래 SPEC에는 "어느 법 몇 조에 이런 문구가 있다"(앵커)만
  적고, 실제 인용문은 이 스크립트가 raw 파일을 직접 열어 뽑아 온다. 앵커가 raw에 없으면
  그 자리에서 빌드를 실패시킨다(환각 0).

[연계]
  읽기: local_server/knowledge/legal/raw/**/{법률,시행령,시행규칙}.txt · 각 법 _meta.json(법령ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
  쓰기: _dashboard/permit_tree.json
  설계: _dashboard/H32_permit_tree_design.md (스키마·방법론·검증 기준·연동 설계)
  선례: _dashboard/H32_vessel_doc_tree_design.md · loop/build_vessel_doc_tree.py (구조 관례를 그대로 이식)

실행:
  python3 local_server/knowledge/legal/_dashboard/loop/build_permit_tree.py            # 빌드(검증 포함)
  python3 local_server/knowledge/legal/_dashboard/loop/build_permit_tree.py --verify   # 독립 재대조
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
OUT = os.path.join(DASH, 'permit_tree.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]\s*(.*)$')
RE_ART_NB = re.compile(r'^제(\d+)조(?:의(\d+))?\s*\(([^)]*)\)')   # 고시계열(L-54)
HANG = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'


def load_laws():
    """74법 목록 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법(자연유산법).
    근거: _dashboard/H29_design.md §2 · 선례 build_vessel_doc_tree.py가 채택한 것과 같은 목록."""
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
    ※ 고시계열은 마커 형식이 달라(L-54) 이 함수로 못 읽는다 — SPEC은 법률계열만 쓴다.
    @returns ({'제10조': '조문 원문 …'}, {'제10조': '조 제목'})"""
    out, title, cur, buf = {}, {}, None, []
    for line in text.split('\n'):
        s = line.strip()
        m = RE_ART.match(s)
        if m:
            if cur:
                out[cur] = '\n'.join(buf)
            cur = '제%s조' % m.group(1) + ('의%s' % m.group(2) if m.group(2) else '')
            title[cur] = m.group(3).split(' (시행')[0].strip()
            buf = [s]
        else:
            if cur is not None:
                buf.append(line)
    if cur:
        out[cur] = '\n'.join(buf)
    return out, title


_cache = {}


def _load(slug, tier):
    key = (slug, tier)
    if key not in _cache:
        law = BY_SLUG.get(slug)
        p = os.path.join(law['raw'], TIER_FILE[tier]) if law else None
        _cache[key] = split_articles(open(p, encoding='utf-8', errors='replace').read()) \
            if p and os.path.exists(p) else ({}, {})
    return _cache[key]


def article_body(slug, tier, article):
    """(법, 계층, 조) → 그 조의 raw 원문 전체. 없으면 None."""
    return _load(slug, tier)[0].get(article)


def article_title(slug, tier, article):
    return _load(slug, tier)[1].get(article, '')


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


def strip_head(flat):
    """평문화한 조문 앞머리의 `[제106조] 벌칙 (시행 20260423 · 일부개정) `를 떼어낸다."""
    return re.sub(r'^\[제\d+조(?:의\d+)?\]\s*[^(]*\([^)]*\)\s*', '', flat)


def sentence_end(flat, start, i, span):
    """문장 끝('…다. ')을 찾되 **괄호 안은 건너뛴다**.

    왜 필요한가(실측): 양식산업발전법 제10조제1항은
    `… 시장ㆍ군수ㆍ구청장(서울특별시 한강의 경우에는 … 관장하는 기관을 말한다. 이하 같다)의 면허를 받아야 한다.`
    인데, 괄호 안의 "말한다."에서 문장을 자르면 인용문이 **정작 의무 문구("면허를 받아야 한다")를 안 담는다.**
    선례 build_vessel_doc_tree.py가 겪었던 5건의 오류와 같은 원인이라, 여기서는 괄호 깊이를 세어
    깊이 0인 자리의 '다. '만 문장 끝으로 인정한다.
    @returns 문장 끝 인덱스(없으면 i+span)"""
    depth = 0
    for k in range(start, len(flat)):
        c = flat[k]
        if c == '(':
            depth += 1
        elif c == ')':
            depth = max(0, depth - 1)
        elif k >= i and depth == 0 and flat.startswith('다. ', k):
            return k + 2
    return min(len(flat), i + span)


def quote_of(body, anchor, span=220):
    """anchor를 포함한 문장을 원문에서 뽑아 인용문으로 쓴다(사람이 타이핑하지 않는다).

    선례 build_vessel_doc_tree.py의 quote_of()와 같은 규약: 항 기호(①…)가 앞에 있으면
    그 자리를 문장 시작으로 본다. 기호가 없을 때만 ". "로 자른다.
    문장 끝은 sentence_end()가 괄호 밖에서만 찾는다.
    @returns 원문 부분문자열(최대 400자) 또는 None"""
    flat = strip_head(re.sub(r'\s+', ' ', body))
    i = flat.find(anchor)
    if i < 0:
        return None
    start = -1
    for mark in HANG:
        j = flat.rfind(mark, 0, i)
        if j > start:
            start = j
    if start < 0:
        start = max(0, flat.rfind('. ', 0, i) + 1)
    return flat[start:sentence_end(flat, start, i, span)].strip()[:400]


ERRORS = []


# ── 74법 전수 스캔(커버리지 산출용) ────────────────────────────────
# 설계 §5.2의 2중 조건(의도구 × 인허가 동사). 트리 내용을 만들지는 않고,
# "어디까지 훑었는지"를 수치로 남기기 위해 매 빌드마다 실제로 다시 돌린다.
SCAN_INTENT = re.compile(r'(하려는|하려면|하고자 하는|경영하려|영위하려|업으로 하려|받으려는)')
SCAN_PERMIT = [('면허', re.compile(r'면허를\s*받아야')),
               ('허가', re.compile(r'허가를\s*받아야')),
               ('등록', re.compile(r'등록을\s*하여야|등록하여야')),
               ('신고', re.compile(r'신고하여야|신고를\s*하여야')),
               ('지정', re.compile(r'지정을\s*받아야'))]


def scan_corpus():
    """74법 raw 전체(법률계열 + 행정규칙계열)를 훑어 커버리지 수치를 만든다.

    정확도가 아니라 "어디까지 봤는지"를 정직하게 밝히기 위한 것이다(설계 §6-1).
    @returns {files, articles, candidates, by_kind, laws_with_candidates:[slug…], admrul_candidates}
    [연계] 설계 §5.1(계열별 이중 형식·L-54) · §5.2(2중 조건)."""
    files = articles = cands = adm_cands = 0
    hit, by_kind = set(), {}
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
                arts = list(split_articles(text)[0].items())
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
                for s in re.split(r'(?=[①-⑳])|(?<=한다\.)|(?<=된다\.)|(?<=아니한다\.)', t):
                    s = s.strip()
                    if not s or len(s) > 700 or not SCAN_INTENT.search(s):
                        continue
                    for kind, rx in SCAN_PERMIT:
                        if rx.search(s):
                            cands += 1
                            by_kind[kind] = by_kind.get(kind, 0) + 1
                            hit.add(law['slug'])
                            if not bracket:
                                adm_cands += 1
                            break
    return {'files': files, 'articles': articles, 'candidates': cands,
            'by_kind': dict(sorted(by_kind.items(), key=lambda kv: -kv[1])),
            'admrul_candidates': adm_cands, 'laws_with_candidates': sorted(hit)}


# ── 트리 조각 만들기 ──────────────────────────────────────────────
def prov(slug, tier, article, anchor, disp=None):
    """노드 출처 1건 — 출처 없는 노드는 만들지 않는다(설계 §2.2).
    @param anchor 그 조문 원문에 실재해야 하는 문구(없으면 빌드 실패)
    @param disp   표시용 조문 표기(항까지 밝히고 싶을 때). 없으면 article 그대로."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('provenance 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_of(body, anchor)
    if q is None:
        ERRORS.append('provenance 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    if anchor not in re.sub(r'\s+', ' ', q):
        ERRORS.append('provenance 인용문에 앵커가 안 담김: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    return {'법령': BY_SLUG[slug]['name'], '법령_slug': slug, '계층': tier,
            '조문': disp or article, '법령ID': law_id(slug, tier),
            '파일': rel(slug, tier), '인용': q}


def duty(name, slug, tier, article, anchor, kind='취득', note=None, disp=None):
    """의무 항목 1건(설계 §2.3).
    @param kind 취득 | 유효기간 | 후속신고  (제재는 사람이 안 쓴다 — penalties()가 자동 생성)
    @param anchor 인용문을 뽑을 자리이자 검증 문구. 그 조문 원문에 없으면 빌드 실패."""
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('의무: 조문 없음: %s %s %s' % (slug, tier, article))
        return None
    q = quote_of(body, anchor)
    if q is None:
        ERRORS.append('의무: 원문에 앵커 없음: %s %s %s ← "%s"' % (slug, tier, article, anchor))
        return None
    if anchor not in re.sub(r'\s+', ' ', q):
        # 인용문이 400자 상한에 잘려 정작 anchor를 안 담은 경우 — 조용히 넘기면 엉뚱한 인용이 된다.
        ERRORS.append('의무: 인용문에 앵커가 안 담김(문장 경계 탐지 실패): %s %s %s ← "%s"'
                      % (slug, tier, article, anchor))
        return None
    e = {'의무명': name, '유형': kind,
         '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug, '계층': tier,
         '근거조문': disp or article, '법령ID': law_id(slug, tier),
         '파일': rel(slug, tier), '인용': q}
    if note:
        e['비고'] = note
    return e


# 호(號) 경계. ★"3의2." 같은 가지번호를 함께 봐야 한다 — 숫자+마침표만 보면 개정으로 끼워넣은
# 가지 호가 앞 호에 통째로 붙어 인용문이 엉킨다(_LESSONS.md L-61·L-62와 같은 함정).
RE_ITEM = re.compile(r'(?<= )(?=\d{1,2}(?:의\d{1,2})?\. )')


def penalties(slug, artrefs, cap=4):
    """★사람이 안 쓰고 자동 연결하는 '제재' 의무(설계 §5.3).

    그 법 법률.txt의 제목이 `벌칙`·`과태료`인 조문을 열어, 인자로 준 근거조문(예 '제40조')을
    참조하는 호(號)를 찾아 그 문장을 그대로 인용으로 싣는다. 금액·형량을 사람이 옮겨 적다
    틀리는 것을 원천 차단한다(결정론적 추출 — H-28·H-33의 "구멍탐지류는 로직 우선"과 같은 적용).

    @param artrefs ['제40조', …] — 조 단위 참조. '제40조의2'는 정규식으로 배제한다.
    @param cap 한 리프에 붙일 제재 항목 상한(넘으면 비고에 남은 건수를 기록)
    @returns [의무항목…]  (못 찾으면 빈 배열 — 없는 것을 지어내지 않는다)
    [연계] 설계 §5.3 · §7 caveat 4(조문번호로 참조하지 않는 벌칙은 못 잡는다)."""
    pats = [re.compile(re.escape(a) + r'(?!의\d)') for a in artrefs]
    found, seen = [], set()
    arts, titles = _load(slug, '법률')
    for art in arts:
        t = titles.get(art, '')
        if '벌칙' not in t and '과태료' not in t:
            continue
        flat = strip_head(re.sub(r'\s+', ' ', arts[art]))
        for part in re.split(r'(?=[①-⑳])', flat):
            part = part.strip()
            if not part:
                continue
            head = re.split(r'(?<= )(?=1\. )', part, maxsplit=1)
            m = re.search(r'([^.]*?(?:처한다|부과한다|과한다)\.)', head[0])
            level = re.sub(r'^[①-⑳]\s*', '', m.group(1)).strip() if m else None
            if not level:
                continue
            items = RE_ITEM.split(head[1]) if len(head) > 1 else [head[0]]
            for it in items:
                it = it.strip()
                if not any(p.search(it) for p in pats):
                    continue
                key = (art, it[:60])
                if key in seen:
                    continue
                seen.add(key)
                found.append({
                    '의무명': '위반 시 제재', '유형': '제재',
                    '근거법령': BY_SLUG[slug]['name'], '근거법령_slug': slug, '계층': '법률',
                    '근거조문': art, '법령ID': law_id(slug, '법률'),
                    '파일': rel(slug, '법률'), '인용': it[:300], '수준': level,
                })
    out = found[:cap]
    if len(found) > cap:
        out[-1] = dict(out[-1], 비고='같은 근거조문을 참조하는 벌칙·과태료 호가 %d건 더 있다(상한 %d).'
                       % (len(found) - cap, cap))
    return out


def node(nid, label, slug, define, provs, ptype=None, target=None, question=None,
         options=None, children=None, duties=None, note=None):
    """트리 노드 1개(설계 §2.2). 비-리프는 question/options 필수, 리프는 duties 필수."""
    n = {'id': nid, '라벨': label, '법령': BY_SLUG[slug]['name'], '법령_slug': slug,
         '인허가유형': ptype, '정의': define, 'provenance': provs}
    if target:
        n['대상'] = target
    if question:
        n['질문'] = question
    if options:
        n['선택지'] = options
    if duties:
        n['의무'] = duties
    if note:
        n['비고'] = note
    n['children'] = children or []
    return n


def opt(label, hint, nxt):
    return {'label': label, 'hint': hint, 'next': nxt}


# ═══════════════════════════════════════════════════════════════════
# SPEC — 법령별 하위트리. ★서브트리 사이를 잇는 상위 노드는 만들지 않는다(설계 §1.2).
#   앵커 문구는 전부 raw 원문에서 확인한 것이며, 인용문은 빌더가 raw에서 직접 읽어 채운다.
# ═══════════════════════════════════════════════════════════════════
S_수산 = '수산업법'
S_양식 = '양식산업발전법'
S_내수 = '내수면어업법'
S_원양 = '원양산업발전법'
S_EEZ = '배타적경제수역에서의외국인어업등에대한주권적권리의행사에관한법률'
S_낚시 = '낚시관리및육성법'
S_유도 = '유선및도선사업법'
S_수레 = '수상레저안전법'
S_수중 = '수중레저활동의안전및활성화등에관한법률'
S_마리 = '마리나항만의조성및관리등에관한법률'
S_해운 = '해운법'
S_항운 = '항만운송사업법'
S_입출 = '선박의입항및출항등에관한법률'
S_도선 = '도선법'
S_어선 = '어선법'
S_평형 = '선박평형수(船舶平衡水)관리법'
S_해환 = '해양환경관리법'
S_해폐 = '해양폐기물및해양오염퇴적물관리법'
S_부산 = '수산부산물재활용촉진에관한법률'
S_항표 = '항로표지법'
S_해교 = '해상교통안전법'
S_해조 = '해양조사와해양정보활용에관한법률'
S_해적 = '국제항해선박등에대한해적행위피해예방에관한법률'
S_종자 = '수산종자산업육성법'
S_과조 = '해양과학조사법'
S_공수 = '공유수면관리및매립에관한법률'


def build():
    """26개 법령별 서브트리를 만든다. @returns [서브트리 루트…]"""
    T = []

    # ── 수산업법 — 법 스스로 제2장 면허어업 / 제3장 허가어업과 신고어업 / 제4장 어획물운반업으로 편제 ──
    T.append(node(
        'susaneop', '수산업법', S_수산,
        '수산업(어업·양식업·어획물운반업 등)을 하려는 자가 받아야 하는 면허·허가·신고·등록을 정한 법',
        [prov(S_수산, '법률', '제2조', '"수산업"이란 「수산업ㆍ어촌 발전 기본법」', '제2조제1호')],
        question='「수산업법」에서 어떤 일을 하시려는 건가요?',
        options=[
            opt('어업', '수산동식물을 포획ㆍ채취하는 사업 (수산업법 제2조제2호) — 면허ㆍ허가ㆍ신고로 갈립니다', 'susaneop__eoeop'),
            opt('어획물운반업', '어업현장에서 양륙지까지 어획물이나 그 제품을 운반하는 사업 (같은 조 제4호) — 등록 대상', 'susaneop__unban'),
            opt('어구생산업ㆍ어구판매업', '어구를 생산하여 판매ㆍ유통하거나 판매하는 업 (수산업법 제71조제1항) — 신고 대상', 'susaneop__eogu'),
        ],
        children=[
            node('susaneop__eoeop', '어업', S_수산,
                 '수산동식물을 포획ㆍ채취하는 사업과 염전에서 소금을 생산하는 사업',
                 [prov(S_수산, '법률', '제2조', '"어업"이란 수산동식물을 포획ㆍ채취하는 사업', '제2조제2호')],
                 question='그 어업은 면허ㆍ허가ㆍ신고 중 어디에 해당하나요? (모르시면 어떤 어업인지로 골라 주세요)',
                 options=[
                     opt('면허어업', '정치망어업ㆍ마을어업 — 시장ㆍ군수ㆍ구청장의 면허 (제7조제1항)', 'susaneop__myeonheo'),
                     opt('허가어업', '근해어업(총톤수 10톤 이상 동력어선)ㆍ연안어업ㆍ구획어업 — 허가 (제40조)', 'susaneop__heoga'),
                     opt('신고어업', '제7조ㆍ제40조ㆍ제43조ㆍ제46조에 따른 어업 외의 어업으로서 대통령령으로 정하는 어업 — 신고 (제48조제1항)', 'susaneop__singo'),
                 ],
                 children=[
                     node('susaneop__myeonheo', '면허어업', S_수산,
                          '정치망어업ㆍ마을어업을 하려는 자가 시장ㆍ군수ㆍ구청장에게 받아야 하는 면허',
                          [prov(S_수산, '법률', '제7조', '어업을 하려는 자는 시장ㆍ군수ㆍ구청장의 면허를 받아야 한다', '제7조제1항')],
                          ptype='면허', target='어업',
                          note='면허 없이 어업을 경영한 경우의 벌칙은 제106조제1항제1호("이 법에 따른 어업권을 취득하지 아니하고 '
                               '어업을 경영한 자")인데, 그 호가 제7조를 조문번호로 참조하지 않고 행위로만 서술해 자동 연결에서 빠졌다 '
                               '— 설계 §5.3 한계의 실례다. 아래 `제재`는 "거짓·부정한 방법으로 면허를 받은 경우"만 잡힌 것이다.',
                          duties=[duty('정치망어업ㆍ마을어업 면허 취득', S_수산, '법률', '제7조',
                                       '어업을 하려는 자는 시장ㆍ군수ㆍ구청장의 면허를 받아야 한다', disp='제7조제1항')]
                                 + penalties(S_수산, ['제7조'])),
                     node('susaneop__heoga', '허가어업', S_수산,
                          '근해어업ㆍ연안어업ㆍ구획어업을 하려는 자가 어선ㆍ어구ㆍ시설마다 받아야 하는 허가',
                          [prov(S_수산, '법률', '제40조', '(이하 "근해어업"이라 한다)을 하려는 자는 어선 또는 어구마다 해양수산부장관의 허가를 받아야 한다', '제40조제1항')],
                          ptype='허가', target='어업',
                          duties=penalties(S_수산, ['제40조']),
                          question='어떤 허가어업인가요? (사용하는 어선 톤수와 조업 방식으로 갈립니다)',
                          options=[
                              opt('근해어업', '총톤수 10톤 이상의 동력어선을 사용하는 어업 — 해양수산부장관 허가 (제40조제1항)', 'susaneop__heoga_geunhae'),
                              opt('연안어업', '무동력어선ㆍ총톤수 10톤 미만 동력어선을 사용하는 어업 중 근해ㆍ구획어업 외의 어업 — 시ㆍ도지사 허가 (제40조제2항)', 'susaneop__heoga_yeonan'),
                              opt('구획어업', '일정 수역에 어구를 설치하거나 무동력어선ㆍ총톤수 5톤 미만 동력어선을 사용하는 어업 — 시장ㆍ군수ㆍ구청장 허가 (제40조제3항)', 'susaneop__heoga_guhoek'),
                          ],
                          children=[
                              node('susaneop__heoga_geunhae', '근해어업', S_수산,
                                   '총톤수 10톤 이상의 동력어선 등을 사용하는 어업',
                                   [prov(S_수산, '법률', '제40조', '총톤수 10톤 이상의 동력어선(動力漁船)', '제40조제1항')],
                                   ptype='허가', target='어업',
                                   duties=[duty('근해어업 허가 취득(어선 또는 어구마다)', S_수산, '법률', '제40조',
                                                '해양수산부장관의 허가를 받아야 한다', disp='제40조제1항')]),
                              node('susaneop__heoga_yeonan', '연안어업', S_수산,
                                   '무동력어선ㆍ총톤수 10톤 미만 동력어선을 사용하는 어업으로서 근해어업ㆍ구획어업 외의 어업',
                                   [prov(S_수산, '법률', '제40조', '(이하 "연안어업"이라 한다)을 하려는 자는 어선 또는 어구마다 시ㆍ도지사의 허가를 받아야 한다', '제40조제2항')],
                                   ptype='허가', target='어업',
                                   duties=[duty('연안어업 허가 취득(어선 또는 어구마다)', S_수산, '법률', '제40조',
                                                '(이하 "연안어업"이라 한다)을 하려는 자는 어선 또는 어구마다 시ㆍ도지사의 허가를 받아야 한다', disp='제40조제2항')]),
                              node('susaneop__heoga_guhoek', '구획어업', S_수산,
                                   '일정한 수역을 정하여 어구를 설치하거나 무동력어선ㆍ총톤수 5톤 미만 동력어선을 사용하는 어업',
                                   [prov(S_수산, '법률', '제40조', '(이하 "구획어업"이라 한다)을 하려는 자는 어선ㆍ어구 또는 시설마다 시장ㆍ군수ㆍ구청장의 허가를 받아야 한다', '제40조제3항')],
                                   ptype='허가', target='어업',
                                   duties=[duty('구획어업 허가 취득(어선ㆍ어구 또는 시설마다)', S_수산, '법률', '제40조',
                                                '(이하 "구획어업"이라 한다)을 하려는 자는 어선ㆍ어구 또는 시설마다 시장ㆍ군수ㆍ구청장의 허가를 받아야 한다', disp='제40조제3항')]),
                          ]),
                     node('susaneop__singo', '신고어업', S_수산,
                          '면허ㆍ허가 대상이 아닌 어업 중 대통령령으로 정하는 어업 — 시장ㆍ군수ㆍ구청장에게 신고',
                          [prov(S_수산, '법률', '제48조', '에 따른 어업 외의 어업으로서 대통령령으로 정하는 어업을 하려는 자', '제48조제1항')],
                          ptype='신고', target='어업',
                          duties=[duty('어업 신고(주소 요건 있음)', S_수산, '법률', '제48조',
                                       '에 따른 어업 외의 어업으로서 대통령령으로 정하는 어업을 하려는 자', disp='제48조제1항'),
                                  duty('신고의 유효기간 5년', S_수산, '법률', '제48조',
                                       '신고의 유효기간은 신고를 수리', kind='유효기간', disp='제48조제4항')]
                                 + penalties(S_수산, ['제48조'])),
                 ]),
            node('susaneop__unban', '어획물운반업', S_수산,
                 '어업현장에서 양륙지까지 어획물이나 그 제품을 운반하는 사업 — 어선마다 등록',
                 [prov(S_수산, '법률', '제2조', '"어획물운반업"이란 어업현장에서 양륙지', '제2조제4호')],
                 ptype='등록', target='사업',
                 duties=[duty('어획물운반업 등록(사용 어선마다)', S_수산, '법률', '제51조',
                              '어획물운반업을 경영하려는 자는 그 어획물운반업에 사용하려는 어선마다', disp='제51조제1항')]
                        + penalties(S_수산, ['제51조'])),
            node('susaneop__eogu', '어구생산업ㆍ어구판매업', S_수산,
                 '어구를 생산하여 판매ㆍ유통ㆍ공급하거나 판매(수입 유통 포함)하는 업 — 시장ㆍ군수ㆍ구청장에게 신고',
                 [prov(S_수산, '법률', '제71조', '(이하 "어구생산업"이라 한다)을 업으로 하려는 자', '제71조제1항')],
                 ptype='신고', target='사업',
                 duties=[duty('어구생산업ㆍ어구판매업 신고', S_수산, '법률', '제71조',
                              '(이하 "어구생산업"이라 한다)을 업으로 하려는 자', disp='제71조제1항'),
                         duty('변경ㆍ폐업 시 30일 이내 신고', S_수산, '법률', '제71조',
                              '그 업을 폐업하였을 때에는 30일 이내에', kind='후속신고', disp='제71조제2항')]
                        + penalties(S_수산, ['제71조'])),
        ]))

    # ── 양식산업발전법 — 제3장 양식업의 면허 / 제4장 양식업의 허가 ──
    T.append(node(
        'yangsik', '양식산업발전법', S_양식,
        '양식업을 하려는 자가 받아야 하는 면허ㆍ허가를 정한 법(제3장 면허, 제4장 허가)',
        [prov(S_양식, '법률', '제10조', '양식업을 하려는 자는 시장ㆍ군수ㆍ구청장', '제10조제1항')],
        question='어떤 양식업인가요? (면허 대상과 허가 대상이 조문으로 갈라져 있습니다)',
        options=[
            opt('면허 대상 양식업', '해조류양식업ㆍ패류양식업ㆍ어류등양식업 등 — 시장ㆍ군수ㆍ구청장 면허(외해양식업은 시ㆍ도지사) (제10조제1항)', 'yangsik__myeonheo'),
            opt('허가 대상 양식업', '육상해수양식업ㆍ육상등 내수양식업 — 시장ㆍ군수ㆍ구청장 허가 (제43조제1항)', 'yangsik__heoga'),
        ],
        children=[
            node('yangsik__myeonheo', '면허 양식업', S_양식,
                 '해수면의 일정 수면을 구획해 양식하는 양식업 등 — 면허 대상',
                 [prov(S_양식, '법률', '제10조', '양식업을 하려는 자는 시장ㆍ군수ㆍ구청장', '제10조제1항')],
                 ptype='면허', target='사업',
                 duties=[duty('양식업 면허 취득', S_양식, '법률', '제10조',
                              '양식업을 하려는 자는 시장ㆍ군수ㆍ구청장', disp='제10조제1항'),
                         duty('면허사항 변경 시 변경신고', S_양식, '법률', '제24조',
                              '양식업권자가 면허받은 사항을 변경하려면', kind='후속신고', disp='제24조제1항')]
                        + penalties(S_양식, ['제10조'])),
            node('yangsik__heoga', '허가 양식업', S_양식,
                 '육상해수양식업ㆍ육상등 내수양식업 — 허가 대상',
                 [prov(S_양식, '법률', '제43조', '양식업을 하려는 자는 시장ㆍ군수ㆍ구청장의 허가를 받아야 한다', '제43조제1항')],
                 ptype='허가', target='사업',
                 duties=[duty('양식업 허가 취득', S_양식, '법률', '제43조',
                              '양식업을 하려는 자는 시장ㆍ군수ㆍ구청장의 허가를 받아야 한다', disp='제43조제1항'),
                         duty('허가사항 변경 시 변경허가 또는 변경신고', S_양식, '법률', '제48조',
                              '허가받은 사항을 변경하려면', kind='후속신고', disp='제48조제1항')]
                        + penalties(S_양식, ['제43조'])),
        ]))

    # ── 내수면어업법 — 면허어업(제6조)/허가어업(제9조)/신고어업(제11조) ──
    T.append(node(
        'naesumyeon', '내수면어업법', S_내수,
        '내수면(하천ㆍ댐ㆍ호소ㆍ저수지 등)에서 어업을 하려는 자의 면허ㆍ허가ㆍ신고를 정한 법',
        [prov(S_내수, '법률', '제6조', '내수면에서 다음 각 호의 어느 하나에 해당하는 어업을 하려는 자', '제6조제1항')],
        question='내수면에서 하시려는 어업이 면허ㆍ허가ㆍ신고 중 어디에 해당하나요?',
        options=[
            opt('면허어업', '내수면에서 조문 각 호의 어업을 하려는 경우 — 시장ㆍ군수ㆍ구청장 등의 면허 (제6조제1항)', 'naesumyeon__myeonheo'),
            opt('허가어업', '내수면에서 조문 각 호의 어업을 하려는 경우 — 시장ㆍ군수ㆍ구청장 등의 허가 (제9조제1항)', 'naesumyeon__heoga'),
            opt('신고어업', '제6조ㆍ제9조에 따른 어업 외의 어업으로서 대통령령으로 정하는 어업 — 신고 (제11조제1항)', 'naesumyeon__singo'),
        ],
        children=[
            node('naesumyeon__myeonheo', '면허어업', S_내수, '내수면에서 면허를 받아야 하는 어업',
                 [prov(S_내수, '법률', '제6조', '내수면에서 다음 각 호의 어느 하나에 해당하는 어업을 하려는 자', '제6조제1항')],
                 ptype='면허', target='어업',
                 duties=[duty('내수면 면허어업 면허 취득', S_내수, '법률', '제6조',
                              '내수면에서 다음 각 호의 어느 하나에 해당하는 어업을 하려는 자', disp='제6조제1항')]
                        + penalties(S_내수, ['제6조'])),
            node('naesumyeon__heoga', '허가어업', S_내수, '내수면에서 허가를 받아야 하는 어업',
                 [prov(S_내수, '법률', '제9조', '내수면에서 다음 각 호의 어느 하나에 해당하는 어업을 하려는 자', '제9조제1항')],
                 ptype='허가', target='어업',
                 duties=[duty('내수면 허가어업 허가 취득', S_내수, '법률', '제9조',
                              '내수면에서 다음 각 호의 어느 하나에 해당하는 어업을 하려는 자', disp='제9조제1항')]
                        + penalties(S_내수, ['제9조'])),
            node('naesumyeon__singo', '신고어업', S_내수,
                 '면허ㆍ허가 대상 외의 어업으로서 대통령령으로 정하는 어업(사유수면 포함)',
                 [prov(S_내수, '법률', '제11조', '에 따른 어업을 제외한 어업으로서 대통령령으로 정하는 어업을 하려는 자', '제11조제1항')],
                 ptype='신고', target='어업',
                 duties=[duty('내수면 신고어업 신고', S_내수, '법률', '제11조',
                              '에 따른 어업을 제외한 어업으로서 대통령령으로 정하는 어업을 하려는 자', disp='제11조제1항'),
                         duty('사유수면에서 같은 어업을 하려는 경우에도 신고', S_내수, '법률', '제11조',
                              '사유수면에서', disp='제11조제2항')]
                        + penalties(S_내수, ['제11조'])),
        ]))

    # ── 원양산업발전법 ──
    T.append(node(
        'wonyang', '원양산업발전법', S_원양,
        '원양어업ㆍ원양어업관련사업을 하려는 자의 허가ㆍ신고를 정한 법',
        [prov(S_원양, '법률', '제6조', '원양어업을 하려는 자는 어선마다 해양수산부장관의 허가를 받아야 한다', '제6조제1항')],
        question='「원양산업발전법」에서 어떤 일을 하시려는 건가요?',
        options=[
            opt('원양어업', '어선마다 해양수산부장관의 허가 (제6조제1항)', 'wonyang__heoga'),
            opt('해외현지법인 원양어업', '외국인과 합작해 설립한 해외현지법인으로 원양어업을 하려는 경우 — 신고 (제6조제7항)', 'wonyang__hyeonji'),
            opt('원양어업관련사업', '사업계획을 해양수산부장관에게 신고 (제23조제1항)', 'wonyang__gwanryeon'),
        ],
        children=[
            node('wonyang__heoga', '원양어업 허가', S_원양, '원양어업을 하려는 자가 어선마다 받아야 하는 허가',
                 [prov(S_원양, '법률', '제6조', '원양어업을 하려는 자는 어선마다 해양수산부장관의 허가를 받아야 한다', '제6조제1항')],
                 ptype='허가', target='어업',
                 duties=[duty('원양어업 허가 취득(어선마다)', S_원양, '법률', '제6조',
                              '원양어업을 하려는 자는 어선마다 해양수산부장관의 허가를 받아야 한다', disp='제6조제1항')]
                        + penalties(S_원양, ['제6조제1항'])),
            node('wonyang__hyeonji', '해외현지법인 원양어업 신고', S_원양,
                 '외국인과 합작하여 설립한 해외현지법인으로 원양어업을 하려는 경우의 신고',
                 [prov(S_원양, '법률', '제6조', '해외현지법인으로 원양어업을 하려는 자는 해양수산부장관에게 신고하여야 한다', '제6조제7항')],
                 ptype='신고', target='어업',
                 duties=[duty('해외현지법인 원양어업 신고', S_원양, '법률', '제6조',
                              '해외현지법인으로 원양어업을 하려는 자는 해양수산부장관에게 신고하여야 한다', disp='제6조제7항')]
                        + penalties(S_원양, ['제6조제7항'])),
            node('wonyang__gwanryeon', '원양어업관련사업 신고', S_원양,
                 '원양어업관련사업을 하려는 자가 사업계획을 신고하는 것',
                 [prov(S_원양, '법률', '제23조', '원양어업관련사업을 하고자 하는 자는', '제23조제1항')],
                 ptype='신고', target='사업',
                 duties=[duty('원양어업관련사업 사업계획 신고', S_원양, '법률', '제23조',
                              '원양어업관련사업을 하고자 하는 자는', disp='제23조제1항')]
                        + penalties(S_원양, ['제23조'])),
        ]))

    # ── 배타적 경제수역 외국인어업법 — 인허가 체계가 하나(허가)뿐이라 루트가 곧 리프 ──
    T.append(node(
        'eez_oegugin', '배타적 경제수역에서의 외국인어업 허가', S_EEZ,
        '외국인이 특정금지구역이 아닌 배타적 경제수역에서 어업활동을 하려면 선박마다 받아야 하는 허가',
        [prov(S_EEZ, '법률', '제5조', '어업활동을 하려면 선박마다 해양수산부장관의 허가를 받아야 한다', '제5조제1항')],
        ptype='허가', target='어업',
        duties=[duty('외국인 어업활동 허가 취득(선박마다)', S_EEZ, '법률', '제5조',
                     '어업활동을 하려면 선박마다 해양수산부장관의 허가를 받아야 한다', disp='제5조제1항'),
                duty('허가받아야 하는 사항(어업 종류ㆍ어선 규모ㆍ부속선 수ㆍ포획대상)', S_EEZ, '시행령', '제3조',
                     '허가를 받아야 하는 사항은 다음 각 호와 같다', disp='제3조제1항')]
               + penalties(S_EEZ, ['제5조'])))

    # ── 낚시 관리 및 육성법 — 원문 편제(제3장 낚시터업 / 제4장 낚시어선업)를 그대로 따름 ──
    T.append(node(
        'naksi', '낚시 관리 및 육성법', S_낚시,
        '낚시터업(허가ㆍ등록)과 낚시어선업(신고)의 진입 요건을 정한 법',
        [prov(S_낚시, '법률', '제10조', '수면 등에서 낚시터업을 하려는 자는', '제10조제1항')],
        question='낚시터를 운영하시려는 건가요, 낚싯배로 손님을 태우시려는 건가요?',
        options=[
            opt('낚시터업', '일정한 수면 등에서 낚시터를 운영하는 업 — 수면에 따라 허가 또는 등록 (제3장)', 'naksi__naksiteo'),
            opt('낚시어선업', '어선으로 낚시 손님을 태우는 업 — 시장ㆍ군수ㆍ구청장에게 신고 (제25조제1항)', 'naksi__eoseoneop'),
        ],
        children=[
            node('naksi__naksiteo', '낚시터업', S_낚시,
                 '수면 등에서 낚시터를 운영하는 업 — 어느 수면이냐에 따라 허가와 등록으로 갈린다',
                 [prov(S_낚시, '법률', '제10조', '수면 등에서 낚시터업을 하려는 자는', '제10조제1항')],
                 question='낚시터를 두시려는 곳이 어디인가요? (수면 종류에 따라 허가와 등록으로 갈립니다)',
                 options=[
                     opt('허가 대상 수면', '제3조제1호부터 제4호까지의 수면 등 — 시장ㆍ군수ㆍ구청장의 허가 (제10조제1항)', 'naksi__naksiteo_heoga'),
                     opt('등록 대상 수면', '제3조제5호 또는 제6호의 수면 — 시장ㆍ군수ㆍ구청장에게 등록 (제16조제1항)', 'naksi__naksiteo_deungrok'),
                 ],
                 children=[
                     node('naksi__naksiteo_heoga', '낚시터업 허가', S_낚시,
                          '제3조제1호부터 제4호까지의 수면 등에서 하는 낚시터업 — 허가 대상',
                          [prov(S_낚시, '법률', '제10조', '수면 등에서 낚시터업을 하려는 자는', '제10조제1항')],
                          ptype='허가', target='사업',
                          duties=[duty('낚시터업 허가 취득', S_낚시, '법률', '제10조',
                                       '수면 등에서 낚시터업을 하려는 자는', disp='제10조제1항')]
                                 + penalties(S_낚시, ['제10조'])),
                     node('naksi__naksiteo_deungrok', '낚시터업 등록', S_낚시,
                          '제3조제5호 또는 제6호의 수면에서 하는 낚시터업 — 등록 대상',
                          [prov(S_낚시, '법률', '제16조', '수면에서 낚시터업을 하려는 자는', '제16조제1항')],
                          ptype='등록', target='사업',
                          duties=[duty('낚시터업 등록', S_낚시, '법률', '제16조',
                                       '수면에서 낚시터업을 하려는 자는', disp='제16조제1항')]
                                 + penalties(S_낚시, ['제16조'])),
                 ]),
            node('naksi__eoseoneop', '낚시어선업 신고', S_낚시,
                 '어선으로 낚시 손님을 태우는 업 — 신고요건(선령ㆍ설비ㆍ안전성검사ㆍ선장 자격ㆍ전문교육)을 갖춰 신고',
                 [prov(S_낚시, '법률', '제25조', '낚시어선업을 하려는 자는 낚시어선의 대상', '제25조제1항')],
                 ptype='신고', target='사업',
                 duties=[duty('낚시어선업 신고(신고요건 구비)', S_낚시, '법률', '제25조',
                              '낚시어선업을 하려는 자는 낚시어선의 대상', disp='제25조제1항'),
                         duty('폐업 시 신고', S_낚시, '법률', '제39조',
                              '낚시어선업을 폐업하려는 자는', kind='후속신고', disp='제39조제1항')]
                        + penalties(S_낚시, ['제25조'])),
        ]))

    # ── 유선 및 도선 사업법 — 면허/신고 경계가 시행령 제3조에 숫자로 있다 ──
    T.append(node(
        'yudoseon', '유선 및 도선 사업법', S_유도,
        '유선사업ㆍ도선사업을 하려는 자가 규모ㆍ영업구역에 따라 받아야 하는 면허 또는 신고',
        [prov(S_유도, '법률', '제3조', '유ㆍ도선사업"이라 한다)을 하려는 자는', '제3조제1항')],
        question='운항하시려는 배의 규모와 영업구역이 어떻게 되나요?',
        options=[
            opt('면허 대상', '총톤수 5톤 이상, 또는 5톤 미만이라도 정원 13명 이상, 또는 영업구역 2해리 이상 (시행령 제3조제1항)', 'yudoseon__myeonheo'),
            opt('신고 대상', '위 면허 대상에 해당하지 않는 유ㆍ도선사업 (시행령 제3조제2항)', 'yudoseon__singo'),
        ],
        children=[
            node('yudoseon__myeonheo', '유ㆍ도선사업 면허', S_유도,
                 '총톤수 5톤 이상 등 시행령 제3조제1항 각 호에 해당하는 유ㆍ도선사업',
                 [prov(S_유도, '시행령', '제3조', '면허를 받아야 하는 대상은', '제3조제1항')],
                 ptype='면허', target='사업',
                 duties=[duty('유ㆍ도선사업 면허 취득', S_유도, '법률', '제3조',
                              '유ㆍ도선사업"이라 한다)을 하려는 자는', disp='제3조제1항'),
                         duty('면허 대상의 기준(총톤수 5톤 이상ㆍ정원 13명 이상ㆍ영업구역 2해리 이상)',
                              S_유도, '시행령', '제3조', '면허를 받아야 하는 대상은', disp='제3조제1항')]
                        + penalties(S_유도, ['제3조'])),
            node('yudoseon__singo', '유ㆍ도선사업 신고', S_유도,
                 '시행령 제3조제1항에 해당하지 아니하는 유ㆍ도선사업',
                 [prov(S_유도, '시행령', '제3조', '신고를 하여야 하는 유ㆍ도선사업은', '제3조제2항')],
                 ptype='신고', target='사업',
                 duties=[duty('유ㆍ도선사업 신고', S_유도, '법률', '제3조',
                              '유ㆍ도선사업"이라 한다)을 하려는 자는', disp='제3조제1항'),
                         duty('신고 대상의 범위', S_유도, '시행령', '제3조',
                              '신고를 하여야 하는 유ㆍ도선사업은', disp='제3조제2항')]
                        + penalties(S_유도, ['제3조'])),
        ]))

    # ── 수상레저안전법 — 사람의 자격(조종면허)과 사업 진입(등록)이 한 법에 같이 있다 ──
    T.append(node(
        'surejeo', '수상레저안전법', S_수레,
        '동력수상레저기구 조종면허(사람의 자격)와 수상레저사업 등록(사업 진입)을 정한 법',
        [prov(S_수레, '법률', '제5조', '동력수상레저기구를 조종하는 사람은', '제5조제1항')],
        question='본인이 직접 조종하시려는 건가요, 사업을 하시려는 건가요?',
        options=[
            opt('조종면허', '동력수상레저기구를 조종하는 사람이 면허시험에 합격한 후 받는 해양경찰청장의 면허 (제5조제1항)', 'surejeo__myeonheo'),
            opt('수상레저사업 등록', '수상레저기구를 빌려 주거나 사람을 태우는 사업 — 해양경찰서장 또는 시장ㆍ군수ㆍ구청장에게 등록 (제37조제1항)', 'surejeo__saeop'),
        ],
        children=[
            node('surejeo__myeonheo', '동력수상레저기구 조종면허', S_수레,
                 '동력수상레저기구를 조종하는 사람이 받아야 하는 면허(일반조종면허 1ㆍ2급, 요트조종면허)',
                 [prov(S_수레, '법률', '제5조', '동력수상레저기구를 조종하는 사람은', '제5조제1항')],
                 ptype='면허', target='자격',
                 duties=[duty('조종면허 취득(면허시험 합격 후)', S_수레, '법률', '제5조',
                              '동력수상레저기구를 조종하는 사람은', disp='제5조제1항'),
                         duty('조종면허의 발급대상 구분', S_수레, '시행령', '제4조',
                              '조종면허의 발급대상은 다음 각 호의 구분과 같다', disp='제4조제2항')]
                        + penalties(S_수레, ['제5조'])),
            node('surejeo__saeop', '수상레저사업 등록', S_수레,
                 '수상레저기구를 빌려 주는 사업 또는 사람을 수상레저기구에 태우는 사업의 등록',
                 [prov(S_수레, '법률', '제37조', '(이하 "수상레저사업"이라 한다)을 경영하려는 자는', '제37조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('수상레저사업 등록', S_수레, '법률', '제37조',
                              '(이하 "수상레저사업"이라 한다)을 경영하려는 자는', disp='제37조제1항'),
                         duty('30일 이상 휴업ㆍ폐업ㆍ재개업 시 신고', S_수레, '법률', '제41조',
                              '30일 이상 휴업하거나 폐업하려는 경우에는', kind='후속신고', disp='제41조제1항')]
                        + penalties(S_수레, ['제37조'])),
        ]))

    # ── 수중레저활동법 ──
    T.append(node(
        'sujungrejeo', '수중레저사업 등록', S_수중,
        '수중레저사업을 하려는 자가 해양수산부령으로 정하는 기준을 갖춰 해양경찰청장에게 하는 등록',
        [prov(S_수중, '법률', '제15조', '수중레저사업을 하려는 자는', '제15조제1항')],
        ptype='등록', target='사업',
        duties=[duty('수중레저사업 등록', S_수중, '법률', '제15조',
                     '수중레저사업을 하려는 자는', disp='제15조제1항'),
                duty('휴업ㆍ폐업ㆍ재개업 시 신고', S_수중, '법률', '제18조',
                     '휴업ㆍ폐업 또는 재개업하려는 경우에는', kind='후속신고', disp='제18조제1항')]
               + penalties(S_수중, ['제15조'])))

    # ── 마리나항만법 ──
    T.append(node(
        'marina', '마리나업 등록', S_마리,
        '마리나선박 대여업ㆍ보관계류업 등 마리나업을 하려는 자가 시ㆍ도지사에게 하는 등록',
        [prov(S_마리, '법률', '제28조의2', '마리나업 중 다음 각 호의 업을 하려는 자는', '제28조의2제1항')],
        ptype='등록', target='사업',
        duties=[duty('마리나업 등록(대통령령 기준 구비)', S_마리, '법률', '제28조의2',
                     '마리나업 중 다음 각 호의 업을 하려는 자는', disp='제28조의2제1항'),
                duty('휴업ㆍ재개업ㆍ폐업 시 신고', S_마리, '법률', '제28조의4',
                     '휴업ㆍ재개업 또는 폐업하려는 경우에는', kind='후속신고')]
               + penalties(S_마리, ['제28조의2'])))

    # ── 해운법 — 제2장 해상여객운송사업(면허) / 제3장 해상화물운송사업(등록) / 제4장 해운중개업 등(등록) ──
    T.append(node(
        'haeun', '해운법', S_해운,
        '해상여객운송사업(면허)ㆍ해상화물운송사업(등록)ㆍ해운중개업등(등록)의 진입 요건을 정한 법',
        [prov(S_해운, '법률', '제4조', '해상여객운송사업을 경영하려는 자는', '제4조제1항')],
        question='어떤 해운 사업을 하시려는 건가요?',
        options=[
            opt('해상여객운송사업', '사람을 태워 나르는 사업 — 사업 종류별ㆍ항로마다 해양수산부장관의 면허 (제4조제1항)', 'haeun__yeogaek'),
            opt('해상화물운송사업', '내항ㆍ외항 화물운송사업 — 해양수산부장관에게 등록 (제24조)', 'haeun__hwamul'),
            opt('해운중개업ㆍ해운대리점업ㆍ선박대여업ㆍ선박관리업', '해운 관련 서비스업 — 해양수산부장관에게 등록 (제33조제1항)', 'haeun__junggae'),
        ],
        children=[
            node('haeun__yeogaek', '해상여객운송사업 면허', S_해운,
                 '해상여객운송사업을 경영하려는 자가 사업 종류별로 항로마다 받아야 하는 면허',
                 [prov(S_해운, '법률', '제4조', '해상여객운송사업을 경영하려는 자는', '제4조제1항')],
                 ptype='면허', target='사업',
                 duties=[duty('해상여객운송사업 면허 취득(항로마다)', S_해운, '법률', '제4조',
                              '해상여객운송사업을 경영하려는 자는', disp='제4조제1항'),
                         duty('사업계획 변경 시 미리 신고', S_해운, '법률', '제12조',
                              '여객운송사업자가 사업계획을 변경하려면', kind='후속신고', disp='제12조제1항')]
                        + penalties(S_해운, ['제4조'])),
            node('haeun__hwamul', '해상화물운송사업 등록', S_해운,
                 '내항 화물운송사업ㆍ외항 정기(부정기) 화물운송사업의 등록',
                 [prov(S_해운, '법률', '제24조', '내항 화물운송사업을 경영하려는 자는', '제24조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('내항 화물운송사업 등록', S_해운, '법률', '제24조',
                              '내항 화물운송사업을 경영하려는 자는', disp='제24조제1항'),
                         duty('외항화물운송사업 등록', S_해운, '법률', '제24조',
                              '(이하 "외항화물운송사업"이라 한다)을 경영하려는 자는', disp='제24조제2항'),
                         duty('등록사항 변경 시 변경신고', S_해운, '법률', '제24조',
                              '등록한 사항을 변경하려는 경우에는', kind='후속신고', disp='제24조제4항')]
                        + penalties(S_해운, ['제24조'])),
            node('haeun__junggae', '해운중개업등 등록', S_해운,
                 '해운중개업ㆍ해운대리점업ㆍ선박대여업ㆍ선박관리업의 등록',
                 [prov(S_해운, '법률', '제33조', '(이하 "해운중개업등"이라 한다)을 경영하려는 자는', '제33조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('해운중개업등 등록', S_해운, '법률', '제33조',
                              '(이하 "해운중개업등"이라 한다)을 경영하려는 자는', disp='제33조제1항')]
                        + penalties(S_해운, ['제33조'])),
        ]))

    # ── 항만운송사업법 ──
    T.append(node(
        'hangman_unsong', '항만운송사업법', S_항운,
        '항만운송사업ㆍ항만운송관련사업ㆍ항만종합서비스업의 등록ㆍ신고를 정한 법',
        [prov(S_항운, '법률', '제4조', '항만운송사업을 하려는 자는', '제4조제1항')],
        question='어떤 항만 관련 사업을 하시려는 건가요?',
        options=[
            opt('항만운송사업', '제3조에 따른 사업 종류별로 관리청에 등록 (제4조제1항)', 'hangman_unsong__unsong'),
            opt('항만운송관련사업', '항만별ㆍ업종별로 관리청에 등록(선용품공급업은 신고) (제26조의3)', 'hangman_unsong__gwanryeon'),
            opt('항만종합서비스업', '자본금ㆍ노동력 기준을 갖춰 관리청에 등록 (제26조의2제1항)', 'hangman_unsong__jonghap'),
        ],
        children=[
            node('hangman_unsong__unsong', '항만운송사업 등록', S_항운,
                 '항만운송사업을 하려는 자가 사업 종류별로 관리청에 하는 등록',
                 [prov(S_항운, '법률', '제4조', '항만운송사업을 하려는 자는', '제4조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('항만운송사업 등록(사업 종류별)', S_항운, '법률', '제4조',
                              '항만운송사업을 하려는 자는', disp='제4조제1항')]
                        + penalties(S_항운, ['제4조'])),
            node('hangman_unsong__gwanryeon', '항만운송관련사업 등록ㆍ신고', S_항운,
                 '항만운송관련사업의 등록(선용품공급업은 신고)',
                 [prov(S_항운, '법률', '제26조의3', '항만운송관련사업을 하려는 자는', '제26조의3제1항')],
                 ptype='복합', target='사업',
                 duties=[duty('항만운송관련사업 등록(항만별ㆍ업종별)', S_항운, '법률', '제26조의3',
                              '항만운송관련사업을 하려는 자는', disp='제26조의3제1항'),
                         duty('선용품공급업은 등록이 아니라 신고', S_항운, '법률', '제26조의3',
                              '선용품공급업을 하려는 자는', disp='제26조의3제1항 단서')]
                        + penalties(S_항운, ['제26조의3'])),
            node('hangman_unsong__jonghap', '항만종합서비스업 등록', S_항운,
                 '항만종합서비스업을 하려는 자가 자본금ㆍ노동력 기준을 갖춰 하는 등록',
                 [prov(S_항운, '법률', '제26조의2', '항만종합서비스업을 하려는 자는', '제26조의2제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('항만종합서비스업 등록', S_항운, '법률', '제26조의2',
                              '항만종합서비스업을 하려는 자는', disp='제26조의2제1항')]
                        + penalties(S_항운, ['제26조의2'])),
        ]))

    # ── 선박의 입항 및 출항 등에 관한 법률 — 같은 법 안에서 등록/허가/신고가 서로 다른 대상에 붙는 실례 ──
    T.append(node(
        'ipchulhang', '선박의 입항 및 출항 등에 관한 법률', S_입출,
        '무역항에서의 예선업 등록, 수상구역등에서의 행위 허가, 계선 신고를 정한 법',
        [prov(S_입출, '법률', '제24조', '(이하 "예선업"이라 한다)을 하려는 자는', '제24조제1항')],
        question='무역항에서 무엇을 하시려는 건가요?',
        options=[
            opt('예선업', '무역항에서 예선업무를 하는 사업 — 관리청에 등록 (제24조제1항)', 'ipchulhang__yeseon'),
            opt('수상구역등에서의 행위', '선박수리ㆍ공사ㆍ선박경기ㆍ부유물 관련 행위 — 관리청의 허가 (제37조ㆍ제41조ㆍ제42조ㆍ제43조)', 'ipchulhang__haengwi'),
            opt('선박 계선', '총톤수 20톤 이상 선박을 수상구역등에 계선 — 관리청에 신고 (제7조제1항)', 'ipchulhang__gyeseon'),
        ],
        children=[
            node('ipchulhang__yeseon', '예선업 등록', S_입출,
                 '무역항에서 예선업무를 하는 사업의 등록',
                 [prov(S_입출, '법률', '제24조', '(이하 "예선업"이라 한다)을 하려는 자는', '제24조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('예선업 등록', S_입출, '법률', '제24조',
                              '(이하 "예선업"이라 한다)을 하려는 자는', disp='제24조제1항')]
                        + penalties(S_입출, ['제24조'])),
            node('ipchulhang__haengwi', '수상구역등에서의 행위 허가', S_입출,
                 '무역항의 수상구역등에서 선박수리ㆍ공사ㆍ행사ㆍ부유물 관련 행위를 하려는 자의 허가',
                 [prov(S_입출, '법률', '제41조', '공사 또는 작업을 하려는 자는', '제41조제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('용접 등 방법의 선박수리 허가', S_입출, '법률', '제37조',
                              '방법으로 수리하려는 경우 해양수산부령으로 정하는 바에 따라 관리청의 허가를 받아야 한다', disp='제37조제1항'),
                         duty('공사 또는 작업 허가', S_입출, '법률', '제41조',
                              '공사 또는 작업을 하려는 자는', disp='제41조제1항'),
                         duty('선박경기 등 행사 허가', S_입출, '법률', '제42조',
                              '행사를 하려는 자는', disp='제42조제1항'),
                         duty('부유물 관련 행위 허가', S_입출, '법률', '제43조',
                              '어느 하나에 해당하는 행위를 하려는 자는', disp='제43조제1항')]
                        + penalties(S_입출, ['제37조', '제41조', '제42조', '제43조'])),
            node('ipchulhang__gyeseon', '선박 계선 신고', S_입출,
                 '총톤수 20톤 이상의 선박을 무역항의 수상구역등에 계선하려는 자의 신고',
                 [prov(S_입출, '법률', '제7조', '계선하려는 자는', '제7조제1항')],
                 ptype='신고', target='행위',
                 duties=[duty('계선 신고', S_입출, '법률', '제7조', '계선하려는 자는', disp='제7조제1항')]
                        + penalties(S_입출, ['제7조'])),
        ]))

    # ── 도선법 ──
    T.append(node(
        'doseonsa', '도선사면허', S_도선,
        '도선사가 되려는 사람이 받아야 하는 해양수산부장관의 면허(1~4급 등급별ㆍ도선구별)',
        [prov(S_도선, '법률', '제4조', '도선사가 되려는 사람은 해양수산부장관의 면허를 받아야 한다', '제4조제1항')],
        ptype='면허', target='자격',
        duties=[duty('도선사면허 취득', S_도선, '법률', '제4조',
                     '도선사가 되려는 사람은 해양수산부장관의 면허를 받아야 한다', disp='제4조제1항'),
                duty('면허 요건ㆍ등급별 기준을 갖춰 신청', S_도선, '법률', '제4조',
                     '도선사면허를 받으려는 사람은', disp='제4조제4항')]
               + penalties(S_도선, ['제4조제1항'])))

    # ── 어선법 ──
    T.append(node(
        'eoseonbeop', '어선법', S_어선,
        '어선 자체의 등록과 어선 관련 사업(어선건조ㆍ개조업ㆍ어선중개업)의 등록을 정한 법',
        [prov(S_어선, '법률', '제13조', '어선원부에 어선의 등록을 하여야 한다', '제13조제1항')],
        question='배 자체를 등록하시려는 건가요, 어선 관련 사업을 하시려는 건가요?',
        options=[
            opt('어선의 등록', '어선 소유자가 선적항 관할 시장ㆍ군수ㆍ구청장에게 어선원부 등록 (제13조제1항)', 'eoseonbeop__eoseon'),
            opt('어선건조ㆍ개조업', '어선을 건조ㆍ개조하거나 안전성에 영향을 미치는 수리를 하는 사업 — 등록 (제9조제1항)', 'eoseonbeop__geonjo'),
            opt('어선중개업', '어선ㆍ어선설비등의 매매ㆍ임대차를 중개하는 사업 — 등록 (제31조의2)', 'eoseonbeop__junggae'),
        ],
        children=[
            node('eoseonbeop__eoseon', '어선의 등록', S_어선,
                 '어선 소유자가 선적항을 관할하는 시장ㆍ군수ㆍ구청장에게 어선원부에 하는 등록',
                 [prov(S_어선, '법률', '제13조', '어선원부에 어선의 등록을 하여야 한다', '제13조제1항')],
                 ptype='등록', target='선박',
                 duties=[duty('어선원부 등록(선박등기 대상은 등기 후 등록)', S_어선, '법률', '제13조',
                              '어선원부에 어선의 등록을 하여야 한다', disp='제13조제1항')]
                        + penalties(S_어선, ['제13조'])),
            node('eoseonbeop__geonjo', '어선건조ㆍ개조업 등록', S_어선,
                 '어선을 건조ㆍ개조하거나 안전성에 영향을 미치는 수리를 하는 사업의 등록',
                 [prov(S_어선, '법률', '제9조', '(이하 "어선건조ㆍ개조업"이라 한다)을 하려는 자는', '제9조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('어선건조ㆍ개조업 등록', S_어선, '법률', '제9조',
                              '(이하 "어선건조ㆍ개조업"이라 한다)을 하려는 자는', disp='제9조제1항')]
                        + penalties(S_어선, ['제9조'])),
            node('eoseonbeop__junggae', '어선중개업 등록', S_어선,
                 '어선 및 어선설비등에 대한 매매 또는 임대차를 중개하는 사업의 등록',
                 [prov(S_어선, '법률', '제31조의2', '(이하 "어선중개업"이라 한다)을 하려는 자는', '제31조의2')],
                 ptype='등록', target='사업',
                 duties=[duty('어선중개업 등록(요건 구비)', S_어선, '법률', '제31조의2',
                              '(이하 "어선중개업"이라 한다)을 하려는 자는', disp='제31조의2')]
                        + penalties(S_어선, ['제31조의2'])),
        ]))

    # ── 선박평형수관리법 ──
    T.append(node(
        'ballast', '선박평형수처리업 등록', S_평형,
        '선박평형수ㆍ침전물을 수거ㆍ처리하는 사업을 영위하려는 자의 등록',
        [prov(S_평형, '법률', '제21조', '(이하 "선박평형수처리업"이라 한다)을 영위하려는 자는', '제21조제1항')],
        ptype='등록', target='사업',
        duties=[duty('선박평형수처리업 등록', S_평형, '법률', '제21조',
                     '(이하 "선박평형수처리업"이라 한다)을 영위하려는 자는', disp='제21조제1항')]
               + penalties(S_평형, ['제21조'])))

    # ── 해양환경관리법 ──
    T.append(node(
        'haeyang_hwangyeong', '해양환경관리업 등록', S_해환,
        '해양오염방제업ㆍ유창청소업 등 해양환경관리업을 영위하려는 자의 등록(해양경찰청장)',
        [prov(S_해환, '법률', '제70조', '(이하 "해양환경관리업"이라 한다)을 영위하려는 자는', '제70조제1항')],
        ptype='등록', target='사업',
        duties=[duty('해양환경관리업 등록', S_해환, '법률', '제70조',
                     '(이하 "해양환경관리업"이라 한다)을 영위하려는 자는', disp='제70조제1항')]
               + penalties(S_해환, ['제70조'])))

    # ── 해양폐기물 및 해양오염퇴적물 관리법 ──
    T.append(node(
        'haeyang_pyegimul', '해양폐기물 및 해양오염퇴적물 관리법', S_해폐,
        '해양폐기물관리업의 등록과 폐기물 해양배출ㆍ해양지중저장 등 행위의 허가ㆍ신고를 정한 법',
        [prov(S_해폐, '법률', '제19조', '(이하 "해양폐기물관리업"이라 한다)을 영위하려는 자', '제19조제1항')],
        question='사업으로 하시려는 건가요, 개별 배출ㆍ활용 행위를 하시려는 건가요?',
        options=[
            opt('해양폐기물관리업', '폐기물해양배출업ㆍ해양폐기물수거업 등 — 해양수산부장관에게 등록 (제19조제1항)', 'haeyang_pyegimul__saeop'),
            opt('해양배출ㆍ해양지중저장 허가', '폐기물을 고립 방법으로 해양배출하거나 이산화탄소 스트림을 해양지중저장 — 허가 (제9조제2항ㆍ제10조제2항)', 'haeyang_pyegimul__heoga'),
            opt('배출ㆍ활용 신고', '제2항 전단 폐기물의 해양배출, 준설물질등의 활용 — 신고 (제7조제4항ㆍ제18조제2항)', 'haeyang_pyegimul__singo'),
        ],
        children=[
            node('haeyang_pyegimul__saeop', '해양폐기물관리업 등록', S_해폐,
                 '폐기물해양배출업ㆍ해양폐기물수거업 등 해양폐기물관리업의 등록',
                 [prov(S_해폐, '법률', '제19조', '(이하 "해양폐기물관리업"이라 한다)을 영위하려는 자', '제19조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('해양폐기물관리업 등록', S_해폐, '법률', '제19조',
                              '(이하 "해양폐기물관리업"이라 한다)을 영위하려는 자', disp='제19조제1항')]
                        + penalties(S_해폐, ['제19조'])),
            node('haeyang_pyegimul__heoga', '해양배출ㆍ해양지중저장 허가', S_해폐,
                 '폐기물을 고립시키는 방법으로 해양에 배출하거나 이산화탄소 스트림을 해양지중저장하려는 자의 허가',
                 [prov(S_해폐, '법률', '제9조', '고립시키는 방법으로 해양에 배출하려는 자는', '제9조제2항')],
                 ptype='허가', target='행위',
                 duties=[duty('폐기물 고립 배출(매립) 허가', S_해폐, '법률', '제9조',
                              '고립시키는 방법으로 해양에 배출하려는 자는', disp='제9조제2항'),
                         duty('이산화탄소 스트림 해양지중저장 허가', S_해폐, '법률', '제10조',
                              '이산화탄소 스트림을 해양지중저장하려는 자는', disp='제10조제2항')]
                        + penalties(S_해폐, ['제9조제2항', '제10조제2항'])),
            node('haeyang_pyegimul__singo', '해양배출ㆍ준설물질 활용 신고', S_해폐,
                 '폐기물의 해양배출 처리, 준설물질등의 활용을 하려는 자의 신고',
                 [prov(S_해폐, '법률', '제18조', '준설물질등을 제1항 각 호에 따른 용도로 활용하려는 자는', '제18조제2항')],
                 ptype='신고', target='행위',
                 duties=[duty('폐기물 해양배출 처리 신고', S_해폐, '법률', '제7조',
                              '해양에 배출하는 방법으로 처리하려는 자는', disp='제7조제4항'),
                         duty('준설물질등 활용 신고', S_해폐, '법률', '제18조',
                              '준설물질등을 제1항 각 호에 따른 용도로 활용하려는 자는', disp='제18조제2항')]
                        + penalties(S_해폐, ['제7조제4항', '제18조제2항'])),
        ]))

    # ── 수산부산물 재활용 촉진법 ──
    T.append(node(
        'susan_busanmul', '수산부산물 처리업 허가', S_부산,
        '수산부산물 처리업을 하려는 자가 시설ㆍ장비ㆍ인력을 갖춰 시ㆍ도지사에게 받는 허가',
        [prov(S_부산, '법률', '제9조', '수산부산물 처리업을 하려는 자는', '제9조제1항')],
        ptype='허가', target='사업',
        duties=[duty('수산부산물 처리업 허가 취득', S_부산, '법률', '제9조',
                     '수산부산물 처리업을 하려는 자는', disp='제9조제1항')]
               + penalties(S_부산, ['제9조'])))

    # ── 항로표지법 ──
    T.append(node(
        'hangnopyoji', '항로표지법', S_항표,
        '사설항로표지 위탁관리업의 등록과 사설항로표지 현황변경 허가를 정한 법',
        [prov(S_항표, '법률', '제23조', '(이하 "위탁관리업"이라 한다)을 하려는 자는', '제23조제1항')],
        question='위탁관리 사업을 하시려는 건가요, 이미 설치한 사설항로표지를 바꾸시려는 건가요?',
        options=[
            opt('위탁관리업 등록', '사설항로표지의 관리업무를 위탁받아 수행하는 사업 — 해양수산부장관에게 등록 (제23조제1항)', 'hangnopyoji__witak'),
            opt('사설항로표지 현황변경 허가', '사설항로표지 소유자가 현황변경을 하려는 경우 — 해양수산부장관의 허가 (제19조제1항)', 'hangnopyoji__byeongyeong'),
        ],
        children=[
            node('hangnopyoji__witak', '위탁관리업 등록', S_항표,
                 '사설항로표지의 관리업무를 위탁받아 수행하는 사업의 등록',
                 [prov(S_항표, '법률', '제23조', '(이하 "위탁관리업"이라 한다)을 하려는 자는', '제23조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('위탁관리업 등록(등록기준 구비)', S_항표, '법률', '제23조',
                              '(이하 "위탁관리업"이라 한다)을 하려는 자는', disp='제23조제1항')]
                        + penalties(S_항표, ['제23조'])),
            node('hangnopyoji__byeongyeong', '사설항로표지 현황변경 허가', S_항표,
                 '사설항로표지 소유자가 현황변경을 하려는 경우 받아야 하는 허가',
                 [prov(S_항표, '법률', '제19조', '사설항로표지의 현황변경을 하려면', '제19조제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('사설항로표지 현황변경 허가', S_항표, '법률', '제19조',
                              '사설항로표지의 현황변경을 하려면', disp='제19조제1항'),
                         duty('설치 목적 소멸로 폐지하려는 경우 신고', S_항표, '법률', '제19조',
                              '사설항로표지를 폐지하려는 경우에는', kind='후속신고', disp='제19조제2항')]
                        + penalties(S_항표, ['제19조'])),
        ]))

    # ── 해상교통안전법 ──
    T.append(node(
        'haesang_gyotong', '해상교통안전법', S_해교,
        '안전관리대행업ㆍ안전진단대행업의 등록과 해상 공사ㆍ작업 허가를 정한 법',
        [prov(S_해교, '법률', '제53조', '(이하 "안전관리대행업"이라 한다)을 경영하려는 자는', '제53조제1항')],
        question='「해상교통안전법」에서 어떤 일을 하시려는 건가요?',
        options=[
            opt('안전관리대행업', '선박소유자로부터 안전관리체제 업무를 위탁받아 대행하는 업 — 등록 (제53조제1항)', 'haesang_gyotong__anjeon'),
            opt('안전진단대행업', '해상교통안전진단을 대행하려는 자 — 기술인력ㆍ장비 자격을 갖춰 등록 (제18조제2항)', 'haesang_gyotong__jindan'),
            opt('해상 공사ㆍ작업', '교통안전특정해역에서 해저전선ㆍ해저파이프라인 부설, 준설, 측량, 침몰선 인양작업 등 — 해양경찰청장의 허가 (제10조제1항)', 'haesang_gyotong__gongsa'),
        ],
        children=[
            node('haesang_gyotong__anjeon', '안전관리대행업 등록', S_해교,
                 '선박소유자로부터 안전관리체제의 수립ㆍ시행 업무를 위탁받아 대행하는 업의 등록',
                 [prov(S_해교, '법률', '제53조', '(이하 "안전관리대행업"이라 한다)을 경영하려는 자는', '제53조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('안전관리대행업 등록(법인ㆍ사업장 안전관리체제 구비)', S_해교, '법률', '제53조',
                              '(이하 "안전관리대행업"이라 한다)을 경영하려는 자는', disp='제53조제1항')]
                        + penalties(S_해교, ['제53조'])),
            node('haesang_gyotong__jindan', '안전진단대행업 등록', S_해교,
                 '해상교통안전진단을 대행하려는 자가 기술인력ㆍ장비 등 자격을 갖춰 하는 등록',
                 [prov(S_해교, '법률', '제18조', '해상교통안전진단을 대행하려는 자', '제18조제2항')],
                 ptype='등록', target='사업',
                 duties=[duty('안전진단대행업 등록', S_해교, '법률', '제18조',
                              '해상교통안전진단을 대행하려는 자', disp='제18조제2항')]
                        + penalties(S_해교, ['제18조'])),
            node('haesang_gyotong__gongsa', '공사 또는 작업 허가', S_해교,
                 '교통안전특정해역에서 선박 항행에 지장을 줄 우려가 있는 공사ㆍ작업을 하려는 자가 받아야 하는 해양경찰청장의 허가',
                 [prov(S_해교, '법률', '제10조', '공사나 작업을 하려는 자는', '제10조제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('해상 공사ㆍ작업 허가', S_해교, '법률', '제10조',
                              '공사나 작업을 하려는 자는', disp='제10조제1항')]
                        + penalties(S_해교, ['제10조'])),
        ]))

    # ── 해양조사와 해양정보 활용에 관한 법률 ──
    T.append(node(
        'haeyang_josa', '해양조사와 해양정보 활용에 관한 법률', S_해조,
        '해양조사ㆍ정보업의 등록과 일반수로측량 신고를 정한 법',
        [prov(S_해조, '법률', '제30조', '해양조사ㆍ정보업을 하려는 자', '제30조제1항')],
        question='사업으로 등록하시려는 건가요, 측량을 하시려는 건가요?',
        options=[
            opt('해양조사ㆍ정보업 등록', '해양조사ㆍ정보업을 하려는 자 — 해양수산부장관에게 등록 (제30조제1항)', 'haeyang_josa__saeop'),
            opt('일반수로측량 신고', '일반수로측량을 하려는 자 — 해양수산부장관에게 신고 (제20조제3항)', 'haeyang_josa__cheugryang'),
        ],
        children=[
            node('haeyang_josa__saeop', '해양조사ㆍ정보업 등록', S_해조,
                 '해양조사ㆍ정보업을 하려는 자의 등록',
                 [prov(S_해조, '법률', '제30조', '해양조사ㆍ정보업을 하려는 자', '제30조제1항')],
                 ptype='등록', target='사업',
                 duties=[duty('해양조사ㆍ정보업 등록', S_해조, '법률', '제30조',
                              '해양조사ㆍ정보업을 하려는 자', disp='제30조제1항')]
                        + penalties(S_해조, ['제30조'])),
            node('haeyang_josa__cheugryang', '일반수로측량 신고', S_해조,
                 '일반수로측량을 하려는 자의 신고',
                 [prov(S_해조, '법률', '제20조', '일반수로측량을 하려는 자는', '제20조제3항')],
                 ptype='신고', target='행위',
                 duties=[duty('일반수로측량 신고', S_해조, '법률', '제20조',
                              '일반수로측량을 하려는 자는', disp='제20조제3항')]
                        + penalties(S_해조, ['제20조제3항'])),
        ]))

    # ── 국제항해선박등에 대한 해적행위 피해예방에 관한 법률 ──
    T.append(node(
        'haesang_gyeongbi', '해상특수경비업 허가', S_해적,
        '해상특수경비업을 영위하려는 자가 받아야 하는 해양수산부장관의 허가',
        [prov(S_해적, '법률', '제16조', '해상특수경비업을 영위하려는 자는 해양수산부장관의 허가를 받아야 한다', '제16조제1항')],
        ptype='허가', target='사업',
        duties=[duty('해상특수경비업 허가 취득', S_해적, '법률', '제16조',
                     '해상특수경비업을 영위하려는 자는 해양수산부장관의 허가를 받아야 한다', disp='제16조제1항'),
                duty('유효기간 만료 후 계속하려면 갱신허가', S_해적, '법률', '제20조',
                     '계속하여 해상특수경비업을 영위하려는 해상특수경비업자는', kind='유효기간', disp='제20조제2항')]
               + penalties(S_해적, ['제16조'])))

    # ── 수산종자산업육성법 ──
    T.append(node(
        'susan_jongja', '수산종자생산업 허가', S_종자,
        '수산종자생산업을 하려는 자가 생산시설마다 받아야 하는 시장ㆍ군수ㆍ구청장의 허가',
        [prov(S_종자, '법률', '제21조', '수산종자생산업을 하려는 자는 생산시설마다', '제21조제1항')],
        ptype='허가', target='사업',
        duties=[duty('수산종자생산업 허가 취득(생산시설마다)', S_종자, '법률', '제21조',
                     '수산종자생산업을 하려는 자는 생산시설마다', disp='제21조제1항'),
                duty('허가의 유효기간 5년', S_종자, '법률', '제21조',
                     '허가의 유효기간은 5년으로 한다', kind='유효기간', disp='제21조제4항')]
               + penalties(S_종자, ['제21조'])))

    # ── 해양과학조사법 ──
    T.append(node(
        'haeyang_gwahak', '해양과학조사법', S_과조,
        '외국인등이 영해에서 해양과학조사를 하거나 조사선박이 기항하려는 경우의 허가를 정한 법',
        [prov(S_과조, '법률', '제6조', '해양과학조사를 실시하려는 외국인등은 해양수산부장관의 허가를 받아야 한다', '제6조제1항')],
        question='조사를 하시려는 건가요, 조사선박이 항만에 기항하시려는 건가요?',
        options=[
            opt('영해에서의 해양과학조사 허가', '대한민국 영해에서 해양과학조사를 실시하려는 외국인등 (제6조제1항)', 'haeyang_gwahak__josa'),
            opt('조사선박 기항 허가', '허가ㆍ동의를 받지 않은 외국인등의 조사선박이 대한민국 항만에 기항하려는 경우 (제15조의2제1항)', 'haeyang_gwahak__gihang'),
        ],
        children=[
            node('haeyang_gwahak__josa', '영해 해양과학조사 허가', S_과조,
                 '대한민국의 영해에서 해양과학조사를 실시하려는 외국인등의 허가',
                 [prov(S_과조, '법률', '제6조', '해양과학조사를 실시하려는 외국인등은 해양수산부장관의 허가를 받아야 한다', '제6조제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('영해 해양과학조사 허가 취득', S_과조, '법률', '제6조',
                              '해양과학조사를 실시하려는 외국인등은 해양수산부장관의 허가를 받아야 한다', disp='제6조제1항'),
                         duty('조사 실시 예정일 6개월 전까지 조사계획서 제출', S_과조, '법률', '제6조',
                              '해양과학조사 실시 예정일 6개월 전까지', disp='제6조제2항')]
                        + penalties(S_과조, ['제6조'])),
            node('haeyang_gwahak__gihang', '조사선박 기항 허가', S_과조,
                 '허가ㆍ동의를 받지 아니한 외국인등의 해양과학조사 선박이 대한민국 항만에 기항하려는 경우의 허가',
                 [prov(S_과조, '법률', '제15조의2', '기항(寄港)하려는 경우', '제15조의2제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('해양과학조사 선박 기항 허가', S_과조, '법률', '제15조의2',
                              '기항(寄港)하려는 경우', disp='제15조의2제1항')]
                        + penalties(S_과조, ['제15조의2'])),
        ]))

    # ── 공유수면 관리 및 매립에 관한 법률 ──
    T.append(node(
        'gongyusumyeon', '공유수면 관리 및 매립에 관한 법률', S_공수,
        '공유수면의 점용ㆍ사용허가와 매립면허를 정한 법',
        [prov(S_공수, '법률', '제8조', '어느 하나에 해당하는 행위를 하려는 자는', '제8조제1항')],
        question='공유수면을 쓰시려는 건가요, 메우시려는 건가요?',
        options=[
            opt('점용ㆍ사용허가', '공유수면에 시설을 설치하거나 공유수면을 점용ㆍ사용하려는 경우 — 공유수면관리청의 허가 (제8조제1항)', 'gongyusumyeon__jeomyong'),
            opt('매립면허', '공유수면을 매립하려는 경우 — 매립면허관청의 면허 (제28조제1항)', 'gongyusumyeon__maerip'),
        ],
        children=[
            node('gongyusumyeon__jeomyong', '공유수면 점용ㆍ사용허가', S_공수,
                 '공유수면에 부두ㆍ방파제ㆍ교량 등을 설치하거나 공유수면을 점용ㆍ사용하려는 자의 허가',
                 [prov(S_공수, '법률', '제8조', '어느 하나에 해당하는 행위를 하려는 자는', '제8조제1항')],
                 ptype='허가', target='행위',
                 duties=[duty('공유수면 점용ㆍ사용허가 취득', S_공수, '법률', '제8조',
                              '어느 하나에 해당하는 행위를 하려는 자는', disp='제8조제1항')]
                        + penalties(S_공수, ['제8조'])),
            node('gongyusumyeon__maerip', '공유수면 매립면허', S_공수,
                 '공유수면을 매립하려는 자가 매립목적을 밝혀 매립면허관청에서 받는 면허',
                 [prov(S_공수, '법률', '제28조', '공유수면을 매립하려는 자는', '제28조제1항')],
                 ptype='면허', target='행위',
                 duties=[duty('공유수면 매립면허 취득', S_공수, '법률', '제28조',
                              '공유수면을 매립하려는 자는', disp='제28조제1항')]
                        + penalties(S_공수, ['제28조'])),
        ]))

    return T


# ── 검증 ──────────────────────────────────────────────────────────
def walk(n):
    yield n
    for c in n.get('children', []):
        yield from walk(c)


def validate(subtrees):
    """설계 §6의 검증 3~6번 — provenance·질문/선택지·법단위 분리·리프 최소 내용."""
    seen_ids = set()
    for root in subtrees:
        slug = root['법령_slug']
        for n in walk(root):
            if n['id'] in seen_ids:
                ERRORS.append('id 중복: %s' % n['id'])
            seen_ids.add(n['id'])
            if not n.get('provenance') or any(p is None for p in n['provenance']):
                ERRORS.append('provenance 없음/실패: %s' % n['id'])
            # ★법단위 분리(설계 §1.2·§6-5) — 서브트리 안에 다른 법이 섞이면 이 트리의 존재 이유가 무너진다.
            if n['법령_slug'] != slug:
                ERRORS.append('서브트리에 다른 법 노드 혼입: %s (%s ≠ %s)' % (n['id'], n['법령_slug'], slug))
            for p in n.get('provenance') or []:
                if p and p['법령_slug'] != slug:
                    ERRORS.append('provenance가 다른 법: %s ← %s' % (n['id'], p['법령_slug']))
            for d in n.get('의무', []):
                if d is None:
                    ERRORS.append('의무 항목 빌드 실패 포함: %s' % n['id'])
                elif d['근거법령_slug'] != slug:
                    ERRORS.append('의무가 다른 법 근거: %s ← %s' % (n['id'], d['근거법령_slug']))
            kids = n.get('children', [])
            if kids:
                if len(kids) < 2:
                    ERRORS.append('자식이 1개뿐인 가짜 갈림길: %s' % n['id'])
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
            else:
                if n.get('질문') or n.get('선택지'):
                    ERRORS.append('리프에 질문/선택지가 붙음: %s' % n['id'])
                if not n.get('의무'):
                    ERRORS.append('리프에 의무가 없음: %s' % n['id'])


def verify_independent(path=OUT):
    """★독립 재대조(설계 §6-8) — 빌더의 조문분리 로직을 **재사용하지 않고**, raw 파일을
    통짜 문자열로 읽어 공백 정규화한 뒤 인용문이 부분문자열로 실재하는지 다시 확인한다.
    "빌드가 통과했다"와 "내용이 맞다"는 다른 문제다(선례 §6에서 실제로 5건이 걸러졌다)."""
    data = json.load(open(path, encoding='utf-8'))
    cache, fail, checked = {}, [], 0

    def whole(rel_path):
        if rel_path not in cache:
            p = os.path.join(LEGAL, rel_path)
            cache[rel_path] = re.sub(r'\s+', ' ', open(p, encoding='utf-8', errors='replace').read()) \
                if os.path.exists(p) else None
        return cache[rel_path]

    def check(kind, nid, item):
        nonlocal checked
        checked += 1
        text = whole(item['파일'])
        if text is None:
            fail.append('%s %s: 파일 없음 %s' % (kind, nid, item['파일']))
            return
        if re.sub(r'\s+', ' ', item['인용']).strip() not in text:
            fail.append('%s %s: 인용문이 raw에 없음 (%s %s)' % (kind, nid, item.get('근거조문') or item.get('조문'), item['파일']))
            return
        # 조문 경계도 독립적으로 구한다 — 인용문이 정말 그 조문 안에서 나오는지.
        art = re.sub(r'제(\d+)조(?:의(\d+))?.*', lambda m: '제%s조%s' % (m.group(1), '의' + m.group(2) if m.group(2) else ''),
                     item.get('근거조문') or item.get('조문'))
        for marker in ('[%s]' % art, '%s(' % art, '%s ' % art):
            i = text.find(marker)
            if i >= 0:
                nxt = re.search(r'\[제\d+조(?:의\d+)?\]', text[i + len(marker):])
                seg = text[i:i + len(marker) + (nxt.start() if nxt else 20000)]
                if re.sub(r'\s+', ' ', item['인용']).strip() in seg:
                    return
                break
        fail.append('%s %s: 인용문이 %s 범위 밖에서 발견됨 (%s)' % (kind, nid, art, item['파일']))

    for root in data['subtrees']:
        for n in walk(root):
            for p in n.get('provenance', []):
                check('노드출처', n['id'], p)
            for d in n.get('의무', []):
                check('의무', n['id'], d)
    print('독립 재대조: %d건 검사, 실패 %d건' % (checked, len(fail)))
    for f in fail:
        print('  -', f)
    return len(fail) == 0


def main():
    if '--verify' in sys.argv:
        sys.exit(0 if verify_independent() else 1)

    subtrees = build()
    validate(subtrees)
    if ERRORS:
        print('빌드 실패 — raw 대조/무결성 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS:
            print('  -', e, file=sys.stderr)
        sys.exit(1)

    scan = scan_corpus()
    nodes = [n for r in subtrees for n in walk(r)]
    leaves = [n for n in nodes if not n.get('children')]
    duties = [d for n in nodes for d in n.get('의무', [])]
    per_law, by_kind, by_tier, by_type = {}, {}, {}, {}
    for d in duties:
        per_law[d['근거법령_slug']] = per_law.get(d['근거법령_slug'], 0) + 1
        by_kind[d['유형']] = by_kind.get(d['유형'], 0) + 1
        by_tier[d['계층']] = by_tier.get(d['계층'], 0) + 1
    for n in nodes:
        if n.get('인허가유형'):
            by_type[n['인허가유형']] = by_type.get(n['인허가유형'], 0) + 1
    tree_slugs = {r['법령_slug'] for r in subtrees}

    out = {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': 'H-32 확장 — 74법 raw 전수 스캔으로 만든 "인허가 유형(면허/허가/신고/등록)" 법령별 계층 트리. '
                 '설계·방법론·연동설계는 _dashboard/H32_permit_tree_design.md 참조.',
        'semantics': {
            '법단위_분리': '★최상위가 단일 루트가 아니라 `subtrees`(법령별 하위트리 배열)다. 같은 "신고"라도 법마다 강도가 달라 '
                           '(수산업법 제48조 신고어업 = 진입규제 vs 낚시법 제33조 출입항 신고 = 절차), 법을 가로지르는 단일 강도 서열을 '
                           '만들면 그건 지어낸 것이 된다. 빌더가 서브트리 안의 모든 노드·의무의 법령 slug 일치를 강제한다.',
            '의무_상속': '어떤 인허가에 따르는 의무 = 서브트리 루트에서 그 리프까지 경로상 모든 노드의 `의무`를 합집합으로 모은 것. '
                         '같은 벌칙을 리프마다 복제하지 않기 위한 규약이다(선례 vessel_doc_tree의 `서류` 상속과 같다).',
            '질문_선택지': '비-리프 노드의 `질문`/`선택지`는 decideClarify()가 즉석 생성하지 않고 그대로 꺼내 쓰라고 미리 박아둔 데이터다. '
                           '`선택지[].next`는 그 노드의 자식 id이며, 선택지는 3개 이하(CLARIFY_OPTION_MAX).',
            '의무_유형': '취득(그 인허가를 받아야 한다는 근거) · 유효기간 · 후속신고(변경·휴업·폐업 등) · 제재(벌칙·과태료). '
                         '`제재`는 사람이 쓰지 않고 빌더가 그 법의 벌칙·과태료 조문에서 근거조문을 참조하는 호를 찾아 자동 생성한다.',
            '진입점': '이 트리는 루트 질문("어느 법인가요?")으로 시작할 수 없다 — 사용자는 법 이름을 모른다. 기존 search()가 법을 좁힌 뒤 '
                      '그 법의 서브트리로 들어가는 것을 전제로 설계했다(설계 §1.3·§9).',
        },
        'caveats': [
            '★법을 가로지르는 인허가 강도 서열은 이 트리에 없다. 어떤 법의 "신고"가 다른 법의 "허가"보다 무거울 수 있다 '
            '(낚시법 제25조 낚시어선업 신고는 선령·설비·안전성검사·선장 자격·전문교육을 요건으로 하는 사실상 허가급이다). '
            '서브트리끼리 비교하면 안 된다.',
            '이 트리는 진입규제(사업·행위를 개시하려면 받아야 하는 것)만 담는다. 변경·휴업·폐업 신고는 리프의 `의무`에 '
            '`유형:"후속신고"`로만 담고 트리 노드로 만들지 않았다. 출입항 신고·사고 신고·행정계획 승인·기관 지정·개인 신분 등록은 제외했다.',
            '근거는 법률·시행령·시행규칙 계열에서만 채택했다. 행정규칙(고시) 파일도 전수 스캔했고 후보 40건이 나왔으나, 전수로 읽어보니 '
            '전부 항만시설 사용허가·항만 내 사진촬영/견학 허가·입출항 및 화물반출입 신고·승무정원 감원 협의 등 시설 이용·절차였고 '
            '사업 진입규제는 하나도 없었다. 그래서 인허가 근거로 채택된 것은 없다.',
            '`유형:"제재"` 의무는 벌칙 조문이 근거조문을 조문번호로 참조한 경우에만 자동 연결된다. '
            '"이 법에 따른 어업권을 취득하지 아니하고 어업을 경영한 자"처럼 행위만 서술한 벌칙은 못 잡는다(빈 배열로 남긴다).',
            '유효기간·후속신고는 원문에서 확인된 것만 담았다. 어떤 리프에 없다고 해서 제도상 없다는 뜻이 아니다.',
            '자격면허(수상레저안전법 제5조 조종면허·도선법 제4조 도선사면허)는 "사업 진입"이 아니라 "사람의 자격"이지만 '
            '질문 축과 조문 문형이 같아 채택했고, 노드의 `대상` 필드로 구분해 표시했다.',
            '`hint`의 수치(톤수·정원·해리 등)는 원문 문구를 옮긴 것이지 우리가 해석해 정규화한 값이 아니다.',
            '후보가 나온 법 중 이번 라운드에 서브트리를 만들지 않은 법이 있다(unmapped.법_단위). '
            '"인허가가 없다"가 아니라 "이번에 안 만들었다"이다.',
            '자치법규(raw/_자치법규/)·별표/별지 서식은 이번 스캔 대상이 아니다.',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'files_scanned': scan['files'],
            'articles_scanned': scan['articles'],
            'scan_candidates': scan['candidates'],
            'scan_candidates_by_kind': scan['by_kind'],
            'laws_with_scan_candidates': len(scan['laws_with_candidates']),
            'laws_without_scan_candidates': len(LAWS) - len(scan['laws_with_candidates']),
            'subtrees': len(subtrees),
            'nodes': len(nodes),
            'leaves': len(leaves),
            'duty_entries': len(duties),
            'duties_by_kind': dict(sorted(by_kind.items(), key=lambda kv: -kv[1])),
            'duties_by_tier': dict(sorted(by_tier.items(), key=lambda kv: -kv[1])),
            'permit_types': dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
            'nodes_per_subtree': {r['법령_slug']: len(list(walk(r))) for r in subtrees},
            'per_law_duties': dict(sorted(per_law.items(), key=lambda kv: -kv[1])),
        },
        'scan': {
            '설명': '설계 §5.2의 2중 조건(의도구 × 인허가 동사)으로 74법 raw 전수(법률계열 + 행정규칙계열)를 훑은 결과. '
                    '후보 문장이 곧 진입규제는 아니다 — 변경·휴업·폐업 신고, 계획 승인, 기관 지정 등이 섞여 있어 사람이 추려 트리에 넣었다. '
                    '★반대 방향의 한계도 실측으로 드러났다: 도선법은 후보가 0건인데도 서브트리가 있다. 제4조제1항이 '
                    '"도선사가 되려는 사람은…"이라 의도구("하려는")에 안 걸렸기 때문이다. 즉 이 스캔의 recall은 100%가 아니며, '
                    '스캔 후보가 0건인 31법 중에도 다른 문형의 인허가 조문이 있을 수 있다.',
            'laws_with_candidates': scan['laws_with_candidates'],
            'laws_without_candidates': sorted({l['slug'] for l in LAWS} - set(scan['laws_with_candidates'])),
            'admrul_candidates': scan['admrul_candidates'],
        },
        'unmapped': {
            '설명': '스캔 후보에는 걸렸으나 서브트리를 만들지 않은 것들. 무엇을 왜 뺐는지 남겨두어야 '
                    '다음 사람이 같은 판단을 반복하지 않는다(설계 §5.4). "없다"와 "안 했다"를 구분해 적는다.',
            '유형_단위': [
                {'유형': '이미 인허가받은 자의 후속 절차', '예': '해운법 제18조(휴업·폐업 신고) · 수상레저안전법 제41조 · 마리나항만법 제28조의4',
                 '처리': '트리 노드로는 안 만들고, 해당 리프의 `의무`에 `유형:"후속신고"`로 담았다.'},
                {'유형': '매 회차 절차 신고', '예': '낚시법 제33조(출입항 신고) · 선박입출항법 제4조(출입 신고) · 어선안전조업법 제8조',
                 '처리': '진입규제가 아니라 운항 절차다. 제외.'},
                {'유형': '사고·발견 신고', '예': '항로표지법 제17조 · 수상에서의 수색·구조 등에 관한 법률 제19조', '처리': '제외.'},
                {'유형': '행정계획·실시계획 승인', '예': '항만법 제10조 · 신항만건설촉진법 · 해양공간계획법 · 공유수면법 제17조',
                 '처리': '사업자 진입이 아니라 계획 절차다. 제외.'},
                {'유형': '기관 지정(공적 업무 위탁)', '예': '농수산물품질관리법 제9조·제64조 · 폐기물관리법 제17조의2 · 수산물유통법 제14조',
                 '처리': '사업 진입이 아니라 공적 업무를 맡길 기관을 고르는 것이다. 제외.'},
                {'유형': '개인 신분 등록', '예': '출입국관리법 제31조(외국인등록) · 선원법 제109조(구직·구인등록)', '처리': '제외.'},
            ],
            '법_단위': [
                {'법': '물환경보전법', '사유': '폐수처리업 허가(제62조)·배출시설 설치 허가·신고(제33조)·측정기기 관리대행업 등록(제38조의6)으로 '
                                              '진입규제 체계가 실재한다. 다만 해양·수산 사용자의 질문 축(배·어업·항만)과 거리가 있어 이번 라운드에서 제외했다 — '
                                              '"인허가가 없다"가 아니라 "안 만들었다"이다.'},
                {'법': '폐기물관리법', '사유': '폐기물처리업 허가(제25조)·전용용기 제조업 등록(제25조의2)·폐기물처리 신고(제46조)가 실재한다. 위와 같은 사유로 제외.'},
                {'법': '농수산물품질관리법', '사유': '생산·가공시설등 등록(제74조) 등이 있으나 대부분 인증기관·검사기관 지정이라 진입규제 축이 다르다.'},
                {'법': '출입국관리법', '사유': '체류자격 변경허가·근무처 변경허가 등은 사업 진입규제가 아니라 개인 체류 관리다.'},
                {'법': '자연유산의보존및활용에관한법률', '사유': '천연기념물 현상변경 허가(제17조) 등 개별 행위 허가이나 해양·수산 축과 거리가 있어 제외.'},
                {'법': '수산물유통의관리및지원에관한법률', '사유': '산지중도매인 지정(제14조)·산지매매참가인 신고(제15조)·이력추적관리 등록(제27조)이 '
                                                              '있으나 도매시장 내 자격 부여 성격이라 이번 라운드에서 제외.'},
                {'법': '어촌ㆍ어항법', '사유': '어항시설 사용허가(제38조)·준공 전 사용허가 등 시설 사용 허가가 중심이라 사업 진입규제와 축이 다르다.'},
                {'법': '항만법', '사유': '항만개발사업 시행자 지정·실시계획 승인·시설장비 신고가 중심이다(계획·시설 축).'},
                {'법': '수산자원관리법', '사유': '유해어법 사용허가(시행령 제13조) 등 개별 행위 허가로, 어업 진입 자체는 수산업법 서브트리에 있다.'},
                {'법': '해양생태계의보전및관리에관한법률 · 해양수산생명자원법 · 해양치유자원법 등',
                 '사유': '포획·채취 허가, 국외반출 승인 등 개별 행위 규제가 중심이라 이번 인허가 유형 축과 부분적으로만 겹친다.'},
            ],
            '서브트리를_만든_법': sorted(tree_slugs),
            '후보는_있으나_서브트리를_만들지_않은_법': sorted(set(scan['laws_with_candidates']) - tree_slugs),
            '서브트리는_있으나_스캔후보가_없던_법': sorted(tree_slugs - set(scan['laws_with_candidates'])),
        },
        'subtrees': subtrees,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    s = out['summary']
    print('permit_tree.json 생성 — 서브트리 %d · 노드 %d · 리프 %d · 의무 %d건'
          % (s['subtrees'], s['nodes'], s['leaves'], s['duty_entries']))
    print('  스캔: %d법 %d파일 %d조문 → 후보 %d건(%d법)'
          % (s['laws_in_scope'], s['files_scanned'], s['articles_scanned'],
             s['scan_candidates'], s['laws_with_scan_candidates']))
    print('  의무 유형:', s['duties_by_kind'])


if __name__ == '__main__':
    main()
