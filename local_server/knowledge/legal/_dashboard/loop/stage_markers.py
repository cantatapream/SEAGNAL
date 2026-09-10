#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""시행일 마커(`<!--시행 d-->`·`<!--시행전 d-->`)의 **짝과 형식**을 검사한다 — 한 곳에서 정한 규칙.

[왜 있나 — 2026-09-10 독립 검토에서 나온 high 결함]
마커의 닫는 짝이 없거나 종류가 어긋나면, 접기 코드가 그 블록 아래를 **파일 끝까지 버렸다.**
그러면 시행일이 되는 순간 그 페이지의 뒷부분(근거 조문 표 포함)이 답변에서 통째로 사라지는데,
시행 전에는 멀쩡해 보여서 사서도 게이트도 못 잡았다. 이제 세 곳이 같은 검사를 쓴다:
  · services/effective_date.js checkStageMarkers  — 런타임(깨졌으면 접지 않고 마커만 걷어낸다)
  · loop/fold_effective.py                        — 정리 단계(깨진 페이지는 건너뛴다)
  · loop/lint_stage_markers.py                    — 게이트(verify_all.sh 가 부른다)

[규약 — `_SCHEMA.md` §10]
  · 블록형: 여는·닫는 마커가 각각 **한 줄을 통째로** 차지한다. 중첩 없음.
  · 인라인형: 한 줄 안에서 열고 닫는다. **표 칸 안에서는 이것만** 쓴다(게이트가 표를 줄 단위로 읽는다).
  · 날짜는 8자리(`20260918`). `2026-09-18` 처럼 적으면 접히지 않고 본문에 그대로 남는다.

[연계] ← fold_effective.py · lint_stage_markers.py · collect_pending_law.py status()
[로드 순서] 의존 없음(표준 라이브러리만) — 어느 쪽에서 import 해도 순환이 생기지 않는다.
"""
import re

INLINE_RE = re.compile(r'<!--(시행전|시행) (\d{8})-->(.*?)<!--/\1-->')
OPEN_LINE_RE = re.compile(r'^\s*<!--(시행전|시행) (\d{8})-->\s*$')
CLOSE_LINE_RE = re.compile(r'^\s*<!--/(시행전|시행)-->\s*$')
ANY_MARK_RE = re.compile(r'<!--\s*/?\s*시행')


def has_markers(body):
    """마커가 하나라도 있나(닫는 것만 있는 경우도 잡는다). @param {str} body @returns {bool}"""
    return '<!--시행' in body or '<!--/시행' in body


def check_markers(body):
    """짝·형식을 검사한다.
    예: check_markers('<!--시행전 20260918-->\\n옛\\n') → [(1, '블록 마커가 닫히지 않았다')]
    @param {str} body - 위키 본문
    @returns {list[tuple[int, str]]} (줄번호, 사유) — 비어 있으면 정상
    [연계] services/effective_date.js checkStageMarkers 와 **같은 규칙**이어야 한다(테스트가 대조한다).
    """
    if not has_markers(body):
        return []
    errs, open_kind, open_line = [], None, 0
    for i, line in enumerate(body.split('\n'), 1):
        o = OPEN_LINE_RE.match(line)
        if o:
            if open_kind:
                errs.append((i, '블록 마커가 닫히기 전에 또 열렸다(%d행 <!--%s-->)' % (open_line, open_kind)))
            else:
                open_kind, open_line = o.group(1), i
            continue
        c = CLOSE_LINE_RE.match(line)
        if c:
            if not open_kind:
                errs.append((i, '닫는 블록 마커에 짝이 없다'))
            elif open_kind != c.group(1):
                errs.append((i, '닫는 종류가 다르다(연 것은 <!--%s-->)' % open_kind))
                open_kind = None
            else:
                open_kind = None
            continue
        if ANY_MARK_RE.search(INLINE_RE.sub('', line)):
            errs.append((i, '형식이 어긋난 마커 — 블록은 줄 전체, 인라인은 한 줄 안에서 열고 닫기, 날짜는 8자리'))
    if open_kind:
        errs.append((open_line, '블록 마커가 닫히지 않았다'))
    return errs
