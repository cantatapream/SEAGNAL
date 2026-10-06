#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-80 — law.go.kr 조회가 **왜** 실패했는지를 버리지 않고 센다. (신선도 점검 세 자가 함께 쓴다)

[왜 있나 — 2026-10-06 사장님 화면]
  운영 서버의 원문신선도 방이 「마지막 점검 10.04 · 848건 대조 · 낡은 원문 0건 · **응답없음 848건**」 을
  보이면서 아래에 「✅ 낡은 원문이 없습니다」 라고 적었다. 848건을 **하나도 확인하지 못했는데** 「이상 없음」 으로 읽혔다.
  그리고 점검 자(`admrul_fresh.py` · `law_fresh.py`)는 실패한 호출의 **까닭(예외 문구·받은 첫 글자)을
  버리고** 「응답없음」 이라는 수만 남겼다 — 그래서 운영 서버에서 무엇이 막혔는지(망 · 인증 · 차단) 아무도 알 수 없었다.

[무엇을 하나] 실패할 때마다 짧은 까닭 한 줄을 세어 두었다가, 보고서에 `fail_reasons`(많은 순 5개)로 싣는다.
  관리자 화면은 그 까닭을 「점검 실패」 상자에 그대로 보여 준다(`services/admrul_fresh_scanner.js`).

예: note(ConnectionResetError(104, 'Connection reset by peer')) → top() == [{'why': 'ConnectionResetError: [Errno 104] Connection reset by peer', 'n': 1}]

[연계] ← admrul_fresh.py · law_fresh.py · ordin_fresh.py → 보고서 `fail_reasons` → admrul_fresh_scanner.js
"""
import collections
import re
import threading

FAILS = collections.Counter()
_LOCK = threading.Lock()                 # ordin_fresh.py 는 여러 갈래로 동시에 부른다


def _short(x):
    if isinstance(x, BaseException):
        s = '%s: %s' % (type(x).__name__, x)
    else:
        s = str(x)
    s = re.sub(r'OC=[^&\s]+', 'OC=…', s)              # 열쇠 값은 보고서에 남기지 않는다
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:160]


def note(x):
    """실패 하나를 센다. 예외 객체든 글이든 받는다(글이면 받은 응답의 첫 부분)."""
    with _LOCK:
        FAILS[_short(x)] += 1


def note_body(body):
    """JSON 이 아닌 응답(오류 쪽 HTML 등)이 왔을 때 — 첫 글자를 까닭으로 남긴다."""
    t = re.sub(r'<[^>]+>', ' ', str(body or ''))
    note('JSON 이 아닌 응답: ' + (t.strip()[:120] or '(빈 응답)'))


def top(n=5):
    with _LOCK:
        return [{'why': k, 'n': v} for k, v in FAILS.most_common(n)]
