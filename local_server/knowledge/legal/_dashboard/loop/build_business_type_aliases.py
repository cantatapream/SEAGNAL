#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
"사업자 유형" ↔ 기존 선박종류 트리(vessel_doc_tree.json) 별칭 매핑 빌더 겸 검증기.
(H-32/H-36 후속 — `H32_hierarchy_candidates.md` G절 "사업자 유형별 의무 계층" 평가 결과)

역할(초보자용):
  사용자는 자기 배를 "여객선"이 아니라 "유선사업 해요"·"낚시어선업 신고했어요"처럼
  **사업 유형**으로 소개한다. 그런데 이 사업 유형들은 이미 만들어 둔 선박종류 트리와
  상당 부분 겹친다(낚시어선업↔낚시어선, 유선사업↔유선). 그래서 새 트리를 또 만들지 않고,
  "사업 유형명 → 그 트리의 어느 노드로 들어가면 되는지"만 적은 **별칭 사전**을 만든다.
  사람이 인용문을 타이핑하지 않는다 — 아래 SPEC에는 "어느 법 몇 조에 이런 문구가 있다"만
  적고, 실제 인용문은 이 스크립트가 raw 파일을 직접 열어 뽑아 온다. 문구가 raw에 없으면
  그 자리에서 빌드를 실패시킨다(환각 0).

★중요 — vessel_doc_tree.json 은 **읽기 전용**이다. 이 스크립트는 그 파일에서 노드 id 목록만
  읽어(대응노드id가 실재하는지 검증하려고) 쓰지 않는다. 절대 수정하지 않는다.

[연계]
  읽기: local_server/knowledge/legal/raw/**/{법률,시행령}.txt · 각 법 _meta.json(법령ID)
        _dashboard/loop/audit12_groups.json + audit12_groups_run.json (74법 목록)
        _dashboard/vessel_doc_tree.json (노드 id 검증용, 읽기만)
  쓰기: _dashboard/business_type_aliases.json (이 파일만)
  설계 근거: _dashboard/H32_hierarchy_candidates.md G절 · _dashboard/H32_vessel_doc_tree_design.md
             MASTER_PLAN.md H-36 · H-32

실행: python3 local_server/knowledge/legal/_dashboard/loop/build_business_type_aliases.py
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
TREE = os.path.join(DASH, 'vessel_doc_tree.json')          # ★읽기 전용
OUT = os.path.join(DASH, 'business_type_aliases.json')
KST = timezone(timedelta(hours=9))

TIER_FILE = {'법률': '법률.txt', '시행령': '시행령.txt', '시행규칙': '시행규칙.txt'}
RE_ART = re.compile(r'^\[제(\d+)조(?:의(\d+))?\]')

ERRORS = []


# ── 74법 목록 ────────────────────────────────────────────────────
def load_laws():
    """74법 = audit12_groups.json(73) ∪ audit12_groups_run.json에만 있는 1법.
    근거: H29_design.md §2 · L-74(그룹 json drift 사고) — 트리 빌더와 같은 소스를 쓴다."""
    def flat(p):
        g = json.load(open(p, encoding='utf-8'))
        return [it for k in sorted(g, key=int) for it in g[k]]
    base = flat(os.path.join(HERE, 'audit12_groups.json'))
    run = flat(os.path.join(HERE, 'audit12_groups_run.json'))
    slugs = {x['slug'] for x in base}
    return base + [x for x in run if x['slug'] not in slugs]


LAWS = load_laws()
BY_SLUG = {x['slug']: x for x in LAWS}
_cache = {}


def split_articles(text):
    """법률계열 raw(`[제10조] 제목 …`)를 조 단위로 쪼갠다.
    ※ 고시계열은 마커 형식이 달라(L-54) 이 함수로 못 읽는다 — 이 SPEC은 법률계열만 쓴다."""
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
    f = fam.get(tier)
    if isinstance(f, list):
        f = f[0] if f else None
    return (f or {}).get('법령ID')


def rel(slug, tier):
    return os.path.relpath(os.path.join(BY_SLUG[slug]['raw'], TIER_FILE[tier]), LEGAL)


def quote_of(slug, tier, article, anchor, where):
    """anchor가 들어 있는 **줄 하나**를 원문에서 그대로 뽑아 인용문으로 쓴다.

    왜 줄 단위인가 — 이 자산이 인용하는 것은 대부분 정의 조항의 호(`   6.  "낚시어선업"이란 …`)라,
    줄 하나가 곧 정의 하나다. 문장 경계를 추정해 자르면(트리 빌더 §6이 실제로 겪은 5건 오류)
    괄호 안 "…말한다."에서 잘못 잘린다. 줄을 그대로 쓰면 그 실패 모드가 아예 없다.

    @param where 실패 메시지에 찍을 항목 이름
    @returns 인용문(문자열). 못 찾으면 None + ERRORS 적재 → 빌드 실패.
    [연계] 검증: verify_independent()가 이 인용문을 "파일 통짜 문자열의 부분문자열"로 재확인.
    """
    body = article_body(slug, tier, article)
    if body is None:
        ERRORS.append('%s: %s %s %s 조문을 raw에서 못 찾음' % (where, slug, tier, article))
        return None
    for line in body.split('\n'):
        s = re.sub(r'\s+', ' ', line).strip()
        if anchor in s:
            return s[:500]
    ERRORS.append('%s: %s %s %s 본문에 앵커 없음 — "%s"' % (where, slug, tier, article, anchor))
    return None


# ── SPEC ─────────────────────────────────────────────────────────
# 확신도 척도(이 파일 안에서의 정의 — semantics에도 그대로 싣는다):
#   high   : 명시적 조문 근거. ①그 사업의 정의(또는 직결 조문)가 트리 노드를 정의하는 바로 그
#            용어·조문을 지칭하거나 ②다른 법의 명시적 적용배제 조항이 경계를 그어 준다.
#   medium : 원문이 "이 사업은 이런 배로 한다"를 명시하지만, 트리 노드의 정의 조문을 직접
#            인용하지는 않는다(같은 낱말을 쓸 뿐).
#   low    : 열거 대조·반대해석 등 유추. 원문이 직접 말하지 않는다.
# ※ 착수 지시는 high/low 2단이었으나, 위 medium에 해당하는 사례(원양어업 등)를 low로 뭉뜽그리면
#   "열거 대조로 짐작한 것"과 구별이 사라져 정직하지 않다고 판단해 3단으로 나눴다(최종 보고 대상).

B_유도선_적용배제 = ('유선및도선사업법', '법률', '제2조의2')
B_수상레저_적용배제 = ('수상레저안전법', '법률', '제3조')
B_등록검사_적용배제 = ('수상레저기구의등록및검사에관한법률', '법률', '제4조')

# 유·도선사업 쪽에서 본 배타 관계 — 6개 호 전부를 싣는다(대표 한 호만 실으면 나머지가 감춰진다)
A_유도선_배제전체 = ['이 법은 다음 각 호의 경우에는 적용하지 아니한다',
                '「수상레저안전법」에 따른 수상레저사업',
                '「체육시설의 설치ㆍ이용에 관한 법률」에 따른 체육시설업',
                '「낚시 관리 및 육성법」에 따른 낚시어선업',
                '「마리나항만의 조성 및 관리 등에 관한 법률」에 따른 마리나업',
                '「수중레저활동의 안전 및 활성화 등에 관한 법률」에 따른 수중레저사업',
                '「항로표지법」에 따른 항로표지']
M_유도선_배제전체 = ('유·도선사업의 배타 경계 — 수상레저사업·체육시설업·낚시어선업·마리나업·'
              '수중레저사업·항로표지 위탁관리업은 이 법(유선 및 도선 사업법) 적용 밖이다.')

ALIASES = [
    # ── 어선 계열 ────────────────────────────────────────────────
    dict(name='어업', slug='수산업법', tier='법률', art='제2조',
         anchor='"어업"이란 수산동식물을',
         node='fishing_vessel', conf='high',
         basis='「어선법」 제2조제1호가목이 "어업…에 종사하는 선박"을 어선으로 정의한다 — 트리 fishing_vessel 노드의 provenance와 같은 조문.',
         bounds=[('어선법', '법률', '제2조', '어업(「양식산업발전법」에 따른 양식업을 포함한다. 이하 같다), 어획물운반업 또는 수산물가공업',
                  '어선의 정의 — 이 사업들에 종사하는 선박이 곧 어선')],
         note='같은 어선이 낚시어선업을 겸하면 angling_vessel에도 해당한다(트리 1단계와 달리 2단계는 배타가 아님).'),
    dict(name='양식업', slug='수산업법', tier='법률', art='제2조',
         anchor='"양식업"이란',
         node='fishing_vessel', conf='high',
         basis='어선법 제2조제1호가목 괄호가 "「양식산업발전법」에 따른 양식업을 포함한다"고 명시.',
         bounds=[('어선법', '법률', '제2조', '어업(「양식산업발전법」에 따른 양식업을 포함한다. 이하 같다), 어획물운반업 또는 수산물가공업',
                  '양식업을 어업에 포함시켜 어선 범위에 넣는 조문')],
         note='육상 양식장만 운영해 선박을 쓰지 않으면 이 트리의 대상이 아니다.'),
    dict(name='어획물운반업', slug='수산업법', tier='법률', art='제2조',
         anchor='"어획물운반업"이란',
         node='fishing_vessel', conf='high',
         basis='어선법 제2조제1호가목이 "어획물운반업…에 종사하는 선박"을 어선으로 정의.',
         bounds=[('어선법', '법률', '제2조', '어업(「양식산업발전법」에 따른 양식업을 포함한다. 이하 같다), 어획물운반업 또는 수산물가공업',
                  '어선의 정의')],
         note=None),
    dict(name='수산물가공업', slug='수산업법', tier='법률', art='제2조',
         anchor='"수산물가공업"이란',
         node='fishing_vessel', conf='low',
         basis='어선법 제2조제1호가목이 "수산물가공업에 종사하는 선박"을 어선에 넣기는 하나, 수산물가공업 자체는 통상 육상 사업이라 선박을 쓰는 경우로 한정된다.',
         bounds=[('어선법', '법률', '제2조', '어업(「양식산업발전법」에 따른 양식업을 포함한다. 이하 같다), 어획물운반업 또는 수산물가공업',
                  '어선의 정의')],
         note='배를 전혀 쓰지 않는 육상 가공공장은 이 트리 대상이 아니다 — "종사하는 선박"이 있을 때만 어선이다.'),
    dict(name='원양어업', slug='원양산업발전법', tier='법률', art='제2조',
         anchor='"원양어업"이란',
         node='fishing_vessel', conf='medium',
         basis='같은 법 제6조제1항이 "원양어업을 하려는 자는 어선마다 …허가를 받아야 한다"고 해 어선 사용을 명시한다. 다만 그 "어선"이 「어선법」상 어선임을 이 법이 직접 인용하지는 않는다.',
         bounds=[('원양산업발전법', '법률', '제6조', '원양어업을 하려는 자는 어선마다 해양수산부장관의 허가를 받아야 한다',
                  '원양어업 허가는 어선 단위 — 이 사업이 어선으로 이뤄짐을 명시')],
         note=None),
    dict(name='내수면어업', slug='내수면어업법', tier='법률', art='제2조',
         anchor='"내수면어업"이란',
         node='fishing_vessel', conf='low',
         basis='"내수면에서 수산동식물을 포획ㆍ채취하는 사업"이라 수산업법 제2조제2호의 어업과 같은 성질이나, 이 법 원문은 이 사업에 쓰는 배의 종류를 정의하지 않는다.',
         bounds=[],
         note='내수면어업법 원문은 어선 정의를 두지 않는다(몰수 조항에 "어선"이 등장할 뿐). 어선법상 어선으로 등록했는지는 개별 확인이 필요하다.'),
    dict(name='낚시어선업', slug='낚시관리및육성법', tier='법률', art='제2조',
         anchor='"낚시어선업"이란 낚시인을',
         node='angling_vessel', conf='high',
         basis='같은 조 제7호 "낚시어선"이란 「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선 — 트리 angling_vessel 노드의 provenance와 같은 조문.',
         bounds=[B_유도선_적용배제 + ('「낚시 관리 및 육성법」에 따른 낚시어선업', '유·도선사업이 아님'),
                 B_수상레저_적용배제 + ('「낚시 관리 및 육성법」에 따른 낚시어선업', '수상레저사업이 아님'),
                 B_등록검사_적용배제 + ('「낚시 관리 및 육성법」에 따른 낚시어선업', '동력수상레저기구 등록·검사 대상이 아님')],
         note=None),

    # ── 수상레저기구 계열 ────────────────────────────────────────
    dict(name='수상레저사업', slug='수상레저안전법', tier='법률', art='제37조',
         anchor='(이하 "수상레저사업"이라 한다)',
         node='water_leisure_craft', conf='high',
         basis='정의문 자체가 "수상레저기구를 빌려 주는 사업 또는 …수상레저기구에 태우는 사업"이라, 트리 water_leisure_craft 노드를 정의하는 용어(같은 법 제2조제3호 수상레저기구)를 그대로 쓴다.',
         bounds=[B_유도선_적용배제 + ('「수상레저안전법」에 따른 수상레저사업', '유·도선사업이 아님'),
                 ('수상레저기구의등록및검사에관한법률', '법률', '제15조',
                  '「수상레저안전법」 제37조에 따른 수상레저사업에 이용되는 동력수상레저기구',
                  '수상레저사업에 쓰이는 동력수상레저기구는 정기검사 주기가 1년')],
         note='동력·무동력 수상레저기구를 모두 쓸 수 있어 powered_craft 한쪽에 붙이지 않고 부모 노드에 매핑했다.'),
    dict(name='마리나업', slug='마리나항만의조성및관리등에관한법률', tier='법률', art='제2조',
         anchor='"마리나업"이란 마리나선박을',
         node='water_leisure_craft', conf='low',
         basis='유추 — 마리나선박 열거(같은 법 시행령 제3조: 모터보트·고무보트·요트·윈드서핑용 선박·수상오토바이·공기부양정·카누·카약)가 수상레저기구 열거(수상레저안전법 시행령 제2조)에 모두 들어 있다. 두 법이 서로를 인용하지는 않는다.',
         bounds=[B_유도선_적용배제 + ('「마리나항만의 조성 및 관리 등에 관한 법률」에 따른 마리나업', '유·도선사업이 아님')],
         note='마리나업은 배를 운항하는 사업이 아니라 대여·보관·정비·물품공급 서비스라, 사업자 자신이 배를 갖추는 관계가 아닐 수 있다. 또 마리나선박 중에는 「선박법」상 일반선박으로 등록된 요트도 있을 수 있어 general_ship과 겹칠 여지가 있다.'),

    # ── 유선·도선 ────────────────────────────────────────────────
    dict(name='유선사업', slug='유선및도선사업법', tier='법률', art='제2조',
         anchor='"유선사업"이란 유선 및 유선장',
         node='excursion_ferry', conf='high',
         basis='트리 excursion_ferry 노드의 provenance와 같은 조문(유선 및 도선 사업법 제2조제1호).',
         bounds=[B_유도선_적용배제 + (A_유도선_배제전체, M_유도선_배제전체),
                 ('선원법', '시행령', '제21조',
                  '「유선 및 도선 사업법」 제2조제1호 또는 제2호에 따른 유선사업 또는 도선사업을 위하여 사용되는 선박은 제외한다',
                  '선박안전법 제2조제10호 여객선이더라도 유·도선은 따로 다룬다 — 트리 general_ship의 중첩주의와 같은 취지')],
         note='정의 자체에 "「해운법」을 적용받지 아니하는 것"이라는 단서가 붙어 해상여객운송사업과 배타적이다.'),
    dict(name='도선사업', slug='유선및도선사업법', tier='법률', art='제2조',
         anchor='"도선사업"이란 도선 및 도선장',
         node='excursion_ferry', conf='high',
         basis='트리 excursion_ferry 노드의 provenance와 같은 조문(유선 및 도선 사업법 제2조제2호).',
         bounds=[B_유도선_적용배제 + (A_유도선_배제전체, M_유도선_배제전체),
                 ('선원법', '시행령', '제21조',
                  '「유선 및 도선 사업법」 제2조제1호 또는 제2호에 따른 유선사업 또는 도선사업을 위하여 사용되는 선박은 제외한다',
                  '선박안전법 제2조제10호 여객선이더라도 유·도선은 따로 다룬다')],
         note='★혼동 주의 — 「도선법」의 "도선(導船)"(도선사가 선박에 승선해 안전 운항을 유도하는 것)과는 전혀 다른 개념이다. 여기 도선사업은 나룻배(渡船) 운송업이다. 문자열이 같아 검색이 섞이기 쉽다.'),
    dict(name='유ㆍ도선사업', slug='유선및도선사업법', tier='법률', art='제3조',
         anchor='유선사업 및 도선사업(이하 "유ㆍ도선사업"이라 한다)',
         node='excursion_ferry', conf='high',
         basis='같은 법이 유선사업·도선사업을 묶어 부르는 총칭 — 두 사업 모두 excursion_ferry로 대응한다.',
         bounds=[B_유도선_적용배제 + (A_유도선_배제전체, M_유도선_배제전체)],
         note='면허·신고 조문·행정처분 등에서 실제로 가장 많이 쓰이는 표기다.'),

    # ── 해운 ─────────────────────────────────────────────────────
    dict(name='해상여객운송사업', slug='해운법', tier='법률', art='제2조',
         anchor='"해상여객운송사업"이란',
         node='passenger_ship', conf='high',
         basis='같은 조 제1호의2가 "여객선"을 「선박안전법」 제2조제10호에 따른 선박으로 정의한다 — 트리 passenger_ship 노드의 provenance와 같은 조문.',
         bounds=[('해운법', '법률', '제2조', '"여객선"이란 「선박안전법」 제2조제10호에 따른 선박',
                  '해운법의 여객선 = 선박안전법 제2조제10호 = 트리 passenger_ship의 정의 조문'),
                 ('유선및도선사업법', '법률', '제2조',
                  ['"유선사업"이란 유선 및 유선장', '"도선사업"이란 도선 및 도선장'],
                  '유선사업·도선사업은 정의 자체가 "「해운법」을 적용받지 아니하는 것"으로 한정된다 — 해상여객운송사업과의 경계')],
         note='정의가 "여객선 또는 「선박법」 제1조의2제1항제1호에 따른 수면비행선박"이라, 수면비행선박으로 하는 경우는 트리에 대응 노드가 없다(unmapped 참조). 하위 종류(내항/외항 정기·부정기, 순항, 복합)는 같은 법 제3조에 있으나 배 종류가 갈리지 않아 별도 별칭으로 만들지 않았다.'),
    dict(name='해상화물운송사업', slug='해운법', tier='법률', art='제2조',
         anchor='"해상화물운송사업"이란',
         node='cargo_ship', conf='low',
         basis='유추 — "선박으로 물건을 운송하는 사업"이 트리 cargo_ship("여객선·유도선이 아닌 선박 — 화물 운송선 등")과 부합하나, 두 조문이 서로를 인용하지 않는다. 원문은 화물선이라는 선박 종류를 정의하지 않는다.',
         bounds=[],
         note='정의문 안에 "「항만운송사업법」 제2조제2항에 따른 항만운송사업 외의 것"·"수산업자가 어장에서 자기의 어획물이나 그 제품을 운송하는 사업은 제외"라는 경계가 이미 들어 있어 별도 경계근거를 두지 않았다. 산적 유류를 싣는 경우에는 트리에서 한 단계 더 내려간 tanker(유조선, 유류오염손해배상 보장법 제2조제1호)에 해당할 수 있다.'),
]

# 매핑할 트리 노드가 없는 사업 유형(정직 기록 — 억지로 끼워맞추지 않는다)
UNMAPPED = [
    dict(name='낚시터업', slug='낚시관리및육성법', tier='법률', art='제2조',
         anchor='"낚시터업"이란 영리를',
         reason='수면을 구획하거나 시설을 설치해 장소·편의를 제공하는 영업이라 선박을 쓰지 않는다. 선박종류 트리에 대응 노드가 없다.'),
    dict(name='수중레저사업', slug='수중레저활동의안전및활성화등에관한법률', tier='법률', art='제2조',
         anchor='"수중레저사업"이란',
         reason='이 사업이 쓰는 "수중레저기구"(같은 조 제5호)가 「선박법」에 따른 선박과 「수상레저안전법」에 따른 동력수상레저기구 **양쪽**이라, 트리의 단일 노드(general_ship / powered_craft)에 대응하지 않는다. 공통 조상은 루트뿐이라 매핑해도 정보가 없다.'),
    dict(name='선박대여업', slug='해운법', tier='법률', art='제2조',
         anchor='"선박대여업"이란',
         reason='자기가 소유한 선박을 빌려주는 사업이라 선박의 **종류**를 특정하지 않는다. 빌려주는 배가 여객선일 수도 화물선일 수도 있다.'),
    dict(name='선박관리업', slug='해운법', tier='법률', art='제2조',
         anchor='"선박관리업"이란',
         reason='선박관리 업무를 수탁하는 사업이라 특정 선박종류에 대응하지 않는다.'),
    dict(name='해운중개업', slug='해운법', tier='법률', art='제2조',
         anchor='"해운중개업"이란',
         reason='운송·대여·매매의 중개업이라 사업자가 배를 운항하지 않는다.'),
    dict(name='해운대리점업', slug='해운법', tier='법률', art='제2조',
         anchor='"해운대리점업"이란',
         reason='운송사업자를 위한 거래 대리업이라 사업자가 배를 운항하지 않는다.'),
    dict(name='예선업', slug='선박의입항및출항등에관한법률', tier='법률', art='제24조',
         anchor='(이하 "예선업"이라 한다)',
         reason='무역항에서 예선(曳船)업무를 하는 사업. 예선은 이 트리에 노드가 없다 — cargo_ship 하위로 볼 근거 조문이 없어 억지로 붙이지 않았다.'),
    dict(name='해상특수경비업', slug='국제항해선박등에대한해적행위피해예방에관한법률', tier='법률', art='제2조',
         anchor='"해상특수경비업"이란',
         reason='국제항해선박에 경비원을 승선시켜 경비업무를 제공하는 영업이라, 사업자 자신의 선박 종류를 정하는 개념이 아니다.'),
    dict(name='항만운송관련사업', slug='항만운송사업법', tier='법률', art='제2조',
         anchor='"항만운송관련사업"이란',
         reason='항만용역업·선용품공급업·선박연료공급업·선박수리업·컨테이너수리업으로, 다른 사람의 선박에 물품·역무를 제공하는 사업이다. 자기 선박의 종류를 정하지 않는다.'),
    dict(name='어선건조ㆍ개조업', slug='어선법', tier='법률', art='제9조',
         anchor='(이하 "어선건조ㆍ개조업"이라 한다)',
         reason='어선을 만들거나 고치는 사업이라 어선을 운항하는 관계가 아니다.'),
    dict(name='어선중개업', slug='어선법', tier='법률', art='제31조의2',
         anchor='(이하 "어선중개업"이라 한다)',
         reason='어선 매매·임대차 중개업이라 어선을 운항하는 관계가 아니다.'),
    dict(name='해양환경관리업', slug='해양환경관리법', tier='법률', art='제70조',
         anchor='(이하 "해양환경관리업"이라 한다)',
         reason='해양오염방제업·유창청소업으로, 설비·장비를 갖추라고만 하고 선박 종류를 특정하지 않는다.'),
]

# 원문이 배제·인용만 하고 74법 raw에 정의 원문이 없는 것(정직 기록)
OUTSIDE = [
    dict(name='체육시설업', 근거='「체육시설의 설치ㆍ이용에 관한 법률」',
         reason='유선 및 도선 사업법 제2조의2제2호·수상레저안전법 제3조제1항제2호가 명시적으로 배제하는 사업 유형이지만, 그 정의 원문이 있는 「체육시설의 설치·이용에 관한 법률」은 74법 raw 수집 범위 밖이라 정의를 대조할 수 없다.'),
    dict(name='수면비행선박 운송', 근거='「선박법」 제1조의2제1항제1호',
         reason='해운법 제2조제2호가 해상여객운송사업의 수단으로 여객선과 나란히 드는데, 선박종류 트리에는 수면비행선박 노드가 없다(트리는 어선/수상레저기구/그 밖의 선박 3분기).'),
]


# ── 빌드 ─────────────────────────────────────────────────────────
def node_ids():
    """vessel_doc_tree.json에서 노드 id·라벨을 읽는다(★읽기만 한다)."""
    d = json.load(open(TREE, encoding='utf-8'))
    out = {}

    def walk(n):
        out[n['id']] = n.get('라벨')
        for c in n.get('children', []):
            walk(c)
    walk(d['tree'])
    return out


def bound_entries(bounds, where):
    """경계근거를 만든다. 앵커는 하나일 수도, 여럿일 수도 있다(적용배제 조항처럼 호가 여러 개면
    호마다 한 줄씩 뽑아 배열로 싣는다 — 대표 한 호만 실으면 나머지 배제 대상이 감춰진다).
    `인용`은 항상 **문자열 배열**로 통일한다(소비자가 타입 분기를 안 하도록)."""
    out = []
    for slug, tier, art, anchors, meaning in bounds:
        if isinstance(anchors, str):
            anchors = [anchors]
        qs = [quote_of(slug, tier, art, a, '%s 경계근거' % where) for a in anchors]
        out.append({
            '법령': BY_SLUG[slug]['name'] if slug in BY_SLUG else slug,
            '법령_slug': slug, '계층': tier, '조문': art,
            '파일': rel(slug, tier), '인용': qs, '뜻': meaning,
        })
    return out


def build():
    nodes = node_ids()
    aliases = []
    for a in ALIASES:
        if a['node'] not in nodes:
            ERRORS.append('%s: 대응노드id "%s"가 vessel_doc_tree.json에 없음' % (a['name'], a['node']))
        aliases.append({
            '사업유형명': a['name'],
            '근거법령': BY_SLUG[a['slug']]['name'],
            '근거법령_slug': a['slug'],
            '계층': a['tier'],
            '근거조문': a['art'],
            '법령ID': law_id(a['slug'], a['tier']),
            '파일': rel(a['slug'], a['tier']),
            '인용': quote_of(a['slug'], a['tier'], a['art'], a['anchor'], a['name']),
            '대응노드id': a['node'],
            '대응노드라벨': nodes.get(a['node']),
            '확신도': a['conf'],
            '매핑근거': a['basis'],
            '경계근거': bound_entries(a['bounds'], a['name']),
            '주의': a['note'],
        })

    unmapped = [{
        '사업유형명': u['name'],
        '근거법령': BY_SLUG[u['slug']]['name'],
        '근거법령_slug': u['slug'],
        '계층': u['tier'],
        '근거조문': u['art'],
        '파일': rel(u['slug'], u['tier']),
        '인용': quote_of(u['slug'], u['tier'], u['art'], u['anchor'], u['name']),
        '대응노드id': None,
        '사유': u['reason'],
    } for u in UNMAPPED]

    scan = scan_corpus()
    conf_count = {}
    for a in aliases:
        conf_count[a['확신도']] = conf_count.get(a['확신도'], 0) + 1
    node_count = {}
    for a in aliases:
        node_count[a['대응노드id']] = node_count.get(a['대응노드id'], 0) + 1

    return {
        'generated': datetime.now(KST).isoformat(timespec='seconds'),
        'scope': '74법 raw 전수 — "사업자 유형"(낚시어선업·유선사업·수상레저사업 등)을 '
                 '기존 vessel_doc_tree.json의 선박종류 노드에 이어 붙이는 별칭 사전. 새 트리가 아니다.',
        'semantics': {
            '이 파일이 아닌 것': 'vessel_doc_tree.json과 별개의 새 계층 트리가 아니다. 이 빌드는 그 파일을 '
                            '읽기만 했고 한 글자도 수정하지 않았다(다른 에이전트가 같은 시간에 확장 중이라 동시쓰기 금지).',
            '쓰는 법': '사용자가 "낚시어선업 신고했는데…"처럼 사업 유형으로 자기를 소개하면 '
                    'aliases[].사업유형명으로 찾아 대응노드id를 트리 진입점으로 삼는다. '
                    '되묻기(decideClarify)가 root부터 물어 내려가는 대신 중간 노드로 바로 점프하는 용도.',
            '확신도': {
                'high': '명시적 조문 근거 — 그 사업의 정의(또는 직결 조문)가 트리 노드를 정의하는 바로 그 '
                        '용어·조문을 지칭하거나, 다른 법의 명시적 적용배제 조항이 경계를 그어 준다.',
                'medium': '원문이 "이 사업은 이런 배로 한다"를 명시하지만, 트리 노드의 정의 조문을 직접 인용하지는 않는다.',
                'low': '열거 대조·반대해석 등 유추. 원문이 직접 말하지 않는다.',
            },
            '경계근거': '그 사업이 다른 사업과 배타임을 보이는 조문(적용배제 조항 등). 이 자산의 핵심 — '
                    '사업 유형은 이름이 비슷해 사용자가 자기가 어디에 속하는지 헷갈리기 때문이다.',
        },
        'caveats': [
            '이 파일은 "사업 유형 → 선박 종류" 한 방향 별칭 사전이다. 사업 유형별 **의무**(무엇을 갖춰야 하나)는 '
            '트리 쪽 서류·장비 데이터를 그대로 따르며, 여기서 새로 만들지 않았다.',
            '2단계 노드(여객선·유선/도선·화물선)는 트리 자신의 caveat대로 완전 배타가 아니다 — 유·도선이 '
            '선박안전법 제2조제10호 여객선에 해당할 수 있는 것처럼, 한 사업자가 둘 이상 노드에 걸릴 수 있다.',
            '확신도 low 항목(마리나업·해상화물운송사업·수산물가공업·내수면어업)은 원문이 직접 잇지 않은 유추다. '
            '실서빙에 쓸 때 이 항목만으로 단정적 답을 만들면 안 된다.',
            '「도선법」의 도선(導船, 도선사 업무)과 「유선 및 도선 사업법」의 도선사업(渡船, 나룻배 운송업)은 '
            '전혀 다른 개념인데 문자열이 같다. 검색·매칭 로직은 반드시 법령명을 함께 봐야 한다.',
            '체육시설업은 유도선법·수상레저안전법이 명시적으로 배제하는데도 그 정의 원문(「체육시설의 설치·이용에 '
            '관한 법률」)이 74법 raw 범위 밖이라 대조하지 못했다 — outside_scope에 기록.',
            '이 스캔은 "…업/…사업"을 원문이 따옴표로 정의한 것만 본다. 정의 없이 쓰이는 업종 표기'
            '(예: 고시·별표에만 나오는 세부 업종)는 원리적으로 못 잡는다.',
            '행정규칙(고시)은 이번 스캔 대상이 아니다 — 사업 유형 정의는 전부 법률·시행령 계열에 있었다.',
            '★트리와의 결합 규약 — 이 파일은 vessel_doc_tree.json의 **노드 id**에만 의존한다. 같은 트리에 '
            '`장비` 배열이나 서류 항목을 더하는 확장은 노드 id를 바꾸지 않으므로 이 파일을 다시 만들 필요가 없다. '
            '반대로 노드 id가 바뀌거나 노드가 새로 갈라지면 이 빌더를 다시 돌려야 하고, 없는 id는 빌드가 그 자리에서 '
            '실패시킨다(추측으로 넘어가지 않는다).',
        ],
        'summary': {
            'laws_in_scope': len(LAWS),
            'aliases': len(aliases),
            'unmapped': len(unmapped),
            'outside_scope': len(OUTSIDE),
            'by_confidence': conf_count,
            'by_node': node_count,
            '경계근거_건수': sum(len(a['경계근거']) for a in aliases),
        },
        'scan': scan,
        'aliases': aliases,
        'unmapped': unmapped,
        'outside_scope': [{'사업유형명': o['name'], '근거': o['근거'], '사유': o['reason']} for o in OUTSIDE],
    }


# ── 74법 전수 스캔(커버리지 수치) ────────────────────────────────
# 매 빌드마다 실제로 다시 돌린다 — "어디까지 훑었는지"를 감이 아니라 수치로 남기기 위해서.
DEF_PATS = [
    re.compile(r'["“]([가-힣A-Za-z0-9ㆍ·一-鿿 ]{1,20}?(?:업|사업))["”]\s*(?:이란|이라 함은|란)'),
    re.compile(r'\(이하\s*["“]([가-힣A-Za-z0-9ㆍ·一-鿿 ]{1,20}?(?:업|사업))["”]\s*(?:이라|라)\s*한다\)'),
]
# G절(H32_hierarchy_candidates.md)이 확산도 25법을 잰 정규식 — 같은 값이 재현되는지 확인용
G_RE = re.compile(r'낚시어선업|수상레저사업|유선사업|도선사업|마리나업|해상여객운송사업')
# G절 정규식의 "도선사업"은 법령명 「유선 및 도선사업법」 안에서도 걸린다 — 실질 히트와 구분하려고
# 법령명을 지운 뒤 다시 재본다(G절 25법 수치의 위양성 검증).
G_TITLE = re.compile(r'유선\s*및\s*도선\s*사업법|유선및도선사업법')


def scan_corpus():
    """74법 법률·시행령·시행규칙에서 ①"…업/…사업" 정의 후보 ②G절 정규식 히트를 센다."""
    defs, files, g_laws, g_real = set(), 0, set(), set()
    for law in LAWS:
        for tier, fn in TIER_FILE.items():
            p = os.path.join(law['raw'], fn)
            if not os.path.exists(p):
                continue
            files += 1
            t = open(p, encoding='utf-8', errors='replace').read()
            if G_RE.search(t):
                g_laws.add(law['slug'])
                if G_RE.search(G_TITLE.sub('§', t)):
                    g_real.add(law['slug'])
            for pat in DEF_PATS:
                for nm in pat.findall(t):
                    nm = nm.strip()
                    if nm.startswith(('대통령령', '해양수산부령')) or '정하는' in nm:
                        continue
                    defs.add((law['slug'], nm))
    covered = {(a['slug'], a['name']) for a in ALIASES} | {(u['slug'], u['name']) for u in UNMAPPED}
    missing = sorted(covered - defs)
    if missing:
        ERRORS.append('SPEC에 적은 사업유형이 스캔에 안 잡힘(오타 의심): %s' % missing)
    return {
        'files_scanned': files,
        '사업정의_후보': len(defs),
        '사업정의_후보_법수': len({s for s, _ in defs}),
        'G절정규식_히트법수': len(g_laws),
        'G절정규식_히트법': sorted(g_laws),
        'G절정규식_실질히트법수': len(g_real),
        'G절정규식_법령명뿐인법': sorted(g_laws - g_real),
        'G절정규식_주의': 'H32_hierarchy_candidates.md G절이 확산도를 "25법"으로 적어뒀는데, 그중 %d법은 '
                    '본문에 사업 유형이 나오는 게 아니라 법령명 「유선 및 도선사업법」을 인용한 것이 '
                    '정규식에 걸린 위양성이다(실질 %d법). 확산도는 참고치일 뿐이라는 G절 자신의 '
                    '단서와 같은 취지의 실측 확인.' % (len(g_laws - g_real), len(g_real)),
        '후보중_이파일이다룬것': len(covered),
        '후보중_다루지않은것': len(defs) - len(covered),
        '다루지않은것_사유': '개발·정비·처리·양식 세부업종 등 선박 운용과 무관한 사업명이다. '
                      '이 파일의 편입 기준은 "정의 조문(또는 직결 조문)이 선박·기구를 사업 수단으로 명시하는 것".',
    }


# ── 독립 재대조 검증 ─────────────────────────────────────────────
# 위 빌드 로직(split_articles/quote_of)을 **재사용하지 않는다**. 산출된 JSON만 놓고
# 파일을 통짜 문자열로 다시 읽어 대조한다 — "빌드가 통과했다"와 "내용이 맞다"는 별개 문제이기 때문
# (H32_vessel_doc_tree_design.md §6이 이 방식으로 실제 5건의 오류를 걸러냈다).
def verify_independent(out):
    fails = []
    tree_text = open(TREE, encoding='utf-8').read()
    checked = 0

    def check_quote(path, quote, art, where):
        nonlocal checked
        checked += 1
        full = os.path.join(LEGAL, path)
        if not os.path.exists(full):
            fails.append('%s: 파일 없음 %s' % (where, path))
            return
        raw = re.sub(r'\s+', ' ', open(full, encoding='utf-8', errors='replace').read())
        if not quote or quote not in raw:
            fails.append('%s: 인용문이 %s 안에 없음' % (where, path))
            return
        # 조문 경계를 빌더와 다른 방법(헤더 문자열 검색)으로 구해, 인용이 그 안에서 나오는지 확인
        head = '[%s] ' % art
        i = raw.find(head)
        if i < 0:
            fails.append('%s: 조문 헤더 "%s" 없음' % (where, head))
            return
        nxt = re.search(r'\[제\d+조(?:의\d+)?\] ', raw[i + len(head):])
        end = i + len(head) + (nxt.start() if nxt else len(raw))
        if raw.find(quote, i, end) < 0:
            fails.append('%s: 인용문이 %s 범위 밖에서 나옴' % (where, art))

    for a in out['aliases']:
        check_quote(a['파일'], a['인용'], a['근거조문'], '별칭 %s' % a['사업유형명'])
        if a['대응노드id'] and ('"id": "%s"' % a['대응노드id']) not in tree_text:
            fails.append('별칭 %s: 대응노드id "%s"가 vessel_doc_tree.json 텍스트에 없음'
                         % (a['사업유형명'], a['대응노드id']))
        if a['대응노드라벨'] is None:
            fails.append('별칭 %s: 대응노드라벨 미해결' % a['사업유형명'])
        for b in a['경계근거']:
            for q in b['인용']:
                check_quote(b['파일'], q, b['조문'], '별칭 %s 경계근거(%s %s)'
                            % (a['사업유형명'], b['법령'], b['조문']))
    for u in out['unmapped']:
        check_quote(u['파일'], u['인용'], u['근거조문'], 'unmapped %s' % u['사업유형명'])
    return checked, fails


def main():
    out = build()
    if ERRORS:
        print('빌드 실패 — raw 대조 오류 %d건:' % len(ERRORS), file=sys.stderr)
        for e in ERRORS:
            print('  -', e, file=sys.stderr)
        sys.exit(1)
    checked, fails = verify_independent(out)
    if fails:
        print('독립 재대조 실패 %d건:' % len(fails), file=sys.stderr)
        for f in fails:
            print('  -', f, file=sys.stderr)
        sys.exit(1)
    out['verification'] = {
        '방법': '빌더의 조문분리 로직을 재사용하지 않는 별도 함수(verify_independent)로, '
              '파일을 통짜 문자열로 읽어 ①인용문이 실재하는지 ②그 인용이 근거조문 범위 안에서 나오는지 '
              '③대응노드id가 vessel_doc_tree.json에 실재하는지를 다시 확인했다.',
        '재대조_건수': checked,
        '실패': 0,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    s = out['summary']
    print('OK  별칭 %d · unmapped %d · 범위밖 %d · 경계근거 %d · 독립재대조 %d건 전부 통과'
          % (s['aliases'], s['unmapped'], s['outside_scope'], s['경계근거_건수'], checked))
    print('    확신도:', s['by_confidence'], '| 노드별:', s['by_node'])
    print('    스캔: %d파일 · 사업정의 후보 %d건(%d법) · G절정규식 %d법'
          % (out['scan']['files_scanned'], out['scan']['사업정의_후보'],
             out['scan']['사업정의_후보_법수'], out['scan']['G절정규식_히트법수']))
    print('   ->', OUT)


if __name__ == '__main__':
    main()
