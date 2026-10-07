#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_excerpt.py — ★raw 파일이 **스스로 발췌본이라고 밝혔는가**를 읽는 단 한 곳. (3-85)

원문결손 점검(`mok_audit.py`)이 「원본보다 목이 적다」 를 셀 때, 발췌본은 모자란 것이 정상이라 결함에서 뺀다.
그 판정을 여기 한 곳에 둔다 — 스크립트 안에 두면 시험이 불러 쓸 수 없다(`mok_audit.py` 는 불러오는 순간 점검이 돈다).
⚠raw 를 고치지 않는다. 이미 적혀 있는 선언(파일 이름·머리말·조문 머리줄·폴더 _meta.json 비고)을 읽을 뿐이다.

[연계] ← mok_audit.py(excerpt_reason) ← local_server/scripts/test_mok_excerpt.js
"""
import json
import os
import re

# ★"이 파일은 일부러 일부만 받아온 것"이라고 스스로 밝힌 표시(2026-08-23 신설).
#   `raw/15_관련타부처/` 밑에는 다른 부처 법을 **연결된 조문만** 발췌한 파일이 많다.
#   원본 전체와 목 개수를 비교하면 당연히 모자라므로 "누락"으로 잡히는데, 이건 결함이 아니라
#   의도된 설계다. 실측: 첫 전수 실행에서 누락 68건 중 66건이 이 경우였고, 사람이 파일을
#   하나씩 열어 머리말을 읽고 걸러 냈다. 그 판단을 도구가 대신하게 한다.
#   ⚠표시가 없는 발췌본은 여전히 못 가른다 — 그건 누락으로 잡히고 사람이 봐야 한다.
EXCERPT_MARK = re.compile(
    r'부분\s*수집|발췌\s*수집|\[발췌|연결\s*조문만|전체를\s*편입하지\s*않|일부만\s*수집|해당\s*조문만')


# ★발췌본을 알아보는 길을 넓혔다 (2026-10-07, 3-85 · 사장님 승인 「추천대로 해」).
#   원문결손 72건을 하나씩 열어 보니 **약 65건이 스스로 발췌라고 밝힌 파일**이었는데 위 표시를 못 읽어
#   「누락」 카드로 올라왔다 — 그리고 「해당없음」 으로 닫아도 **매주 다시 떴다**(reopenStillMissing).
#   읽는 자리를 넷으로 늘린다(raw 는 고치지 않는다 — 이미 적혀 있는 선언을 읽는 것이다):
#     ①파일 이름 — `…_발췌` · `…연결조문` · `…_제N조…`(그 조만 받은 파일) — 386파일이 이 꼴
#     ②위 EXCERPT_MARK(종전 그대로)
#     ③조문 머리줄 자체가 「발췌」라고 적은 것 — `[제2조] 정의 (시행 …, 발췌: 제3호·제16호)` · `— 17호 발췌`
#     ④폴더 _meta.json 「비고」 가 「전체 아님」/「발췌 수집」 이라 밝힌 것(신선도 점검이 이미 이 줄로 제외한다)
#   ⚠**머리말에 「발췌」 낱말만 있다고 발췌로 보지 않는다** — 전수로 재 보니 전문 파일 둘이 옛 내력을 적으며
#     그 낱말을 쓴다(UNCLOS 법률.txt 320조 · 폐기물관리법 시행규칙.txt 157조 「발췌본을 전문으로 바꿨다」).
#   ⚠머리말이 「전문 수집」 이라 밝히면 위 넷보다 **그것이 이긴다**(공직자이해충돌방지법 — 폴더 분류는 「연결 조문만」 이지만 파일은 전문).
EXCERPT_NAME = re.compile(r'발췌|연결조문|_제\d+조')
EXCERPT_ARTLINE = re.compile(r'^\[제\d+조[^\]]*\][^\n]*발췌', re.M)
FULL_MARK = re.compile(r'\[전문\s*수집\]|전문\s*수집')
META_EXCERPT = re.compile(r'전체\s*아님|발췌\s*수집')


def excerpt_reason(path):
    """그 파일이 발췌본이라고 **스스로 밝힌 자리**. 아니면 ''.
    예: excerpt_reason('…/유통산업발전법/법률.txt') → '조문 머리줄'"""
    try:
        with open(path, encoding='utf-8') as f:
            head = ''.join(next(f, '') for _ in range(12))
    except Exception:
        return ''
    if FULL_MARK.search(head):
        return ''
    name = os.path.basename(path)[:-4] if path.endswith('.txt') else os.path.basename(path)
    if EXCERPT_NAME.search(name):
        return '파일 이름'
    if EXCERPT_MARK.search(head):
        return '머리말 표시'
    if EXCERPT_ARTLINE.search(head):
        return '조문 머리줄'
    if '전체 아님' in head:
        return '머리말 「전체 아님」'
    try:
        meta = json.load(open(os.path.join(os.path.dirname(path), '_meta.json'), encoding='utf-8'))
        if META_EXCERPT.search(str(meta.get('비고') or '')):
            return '_meta.json 비고'
    except Exception:
        pass
    return ''


def is_excerpt(path):
    """그 파일이 '나는 발췌본이다'라고 밝히고 있나(excerpt_reason 참고)."""
    return bool(excerpt_reason(path))
