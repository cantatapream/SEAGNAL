#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/future_date_guard.py
# 역할: raw 원문이 **아직 오지 않은 시행일**을 현행인 양 적고 있는지 센다(V5-14).
# ============================================================================
#
# [왜 있나 — 2026-09-21, L-295 의 직접 후속]
#   `lawService.do?target=law&MST=` 는 한 MST 가 시행일 판을 둘 이상 가지면 **어느 판이 올지
#   고를 수 없고**, 실측상 **시행예정 판**을 준다:
#       형사소송법 281865 → 20271231 (현행 20260701)
#       농수산물품질관리법 시행령 288973 → 20270101 (현행 20260825)
#   이 결함으로 raw 5개 파일 31개 조문이 미시행 판의 시행일을 달고 있었다. 법문은 마침
#   현행과 같았지만 **그건 운이었다.** 코드 쪽은 `law_api_guard.fetch_law_body` 로 막았고,
#   이 게이트는 **막힌 게 맞는지 눈으로 다시 재는 장치**다.
#
# [무엇을 세나]
#   `raw/**/*.txt` 의 조문머리 `[제N조] … (시행 YYYYMMDD …)` 중 그 날짜가 **오늘보다 뒤**인 것.
#   ⚠단 `_대기/<시행일>/` 안은 뺀다 — `collect_pending_law.py` 가 **일부러** 받아 두는
#     시행예정 대기본이고, 그 폴더 이름이 이미 "이건 아직 시행 전"이라고 말하고 있다.
#   ⚠`_구판/` 도 뺀다 — 보존용 옛 사본이라 지금 값을 말하는 파일이 아니다.
#
# [쓰는 법]
#   python3 _dashboard/loop/future_date_guard.py            숫자만 본다
#   python3 _dashboard/loop/future_date_guard.py --examples  어느 파일 어느 조인지 본다
#   python3 _dashboard/loop/future_date_guard.py --gate      1건이라도 있으면 실패(exit 1)
#
# [연계]
#   - 막는 쪽: law_api_guard.fetch_law_body (현행 시행일을 efYd 로 못 박는다)
#   - 부르는 곳: scripts/refactor/verify_all.sh V5-14
#   - 기록: _LESSONS.md L-295 · _dashboard/d_stage_2026-09-20/D2_DONE_AND_FUTURE_DATE.md
# ============================================================================
import os
import re
import sys
import time

LEGAL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(LEGAL, 'raw')
# 컨테이너는 UTC 로 도니 KST 로 옮겨 오늘을 정한다(CLAUDE.md 시간 표기 규칙).
TODAY = time.strftime('%Y%m%d', time.gmtime(time.time() + 9 * 3600))

HEAD = re.compile(r'^\[(제\d+조(?:의\d+)?)\][^\n]*?\(시행 (\d{8})')
SKIP = (os.sep + '_대기' + os.sep, os.sep + '_구판' + os.sep)

hits = []
files = 0
for base, dirs, names in os.walk(RAW):
    if any(s in base + os.sep for s in SKIP):
        continue
    for n in names:
        if not n.endswith('.txt'):
            continue
        p = os.path.join(base, n)
        files += 1
        try:
            t = open(p, encoding='utf-8').read()
        except Exception:
            continue
        for m in HEAD.finditer(t):
            if m.group(2) > TODAY:
                hits.append((os.path.relpath(p, LEGAL), m.group(1), m.group(2)))

print('■ 미시행 시행일 표기 점검 (오늘 %s 기준, `_대기/`·`_구판/` 제외)' % TODAY)
print('   훑은 원문 파일 %d개' % files)
print('   %s 아직 오지 않은 시행일을 단 조문머리 %d개' % ('❌' if hits else '✅', len(hits)))
if hits and '--examples' in sys.argv:
    for f, a, d in hits[:40]:
        print('      · %s  %s  (시행 %s)' % (f, a, d))
    if len(hits) > 40:
        print('      … 그리고 %d개 더' % (len(hits) - 40))
if hits:
    print('   고치는 법: 그 법을 `law_api_guard.fetch_law_body` 로 다시 받는다.')
    print('             (`target=law&MST=` 만으로 받으면 시행예정 판이 올 수 있다 — L-295)')
if '--gate' in sys.argv and hits:
    sys.exit(1)
