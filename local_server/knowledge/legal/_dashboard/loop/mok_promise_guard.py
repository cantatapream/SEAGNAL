#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/mok_promise_guard.py
# 역할: 원문이 **"다음 각 목의…"라고 약속해 놓고 그 목(가·나·다)이 없는 자리**를 센다(V5-16).
#       네트워크를 쓰지 않는다 — 파일 스스로 모순인 것만 본다.
# ============================================================================
#
# [왜 있나 — 2026-09-21]
#   A-2(`mok_audit.py`)를 고쳐 다시 돌리다 「문화유산의 보존 및 활용에 관한 법률 시행령」에서
#   이런 줄을 봤다 —
#       2. 다음 각 목의 시설을 갖출 것
#       3. 다음 각 목의 어느 하나에 해당하는 전문인력 1명 이상이 상시 근무할 것
#   **그 "각 목"이 파일에 아예 없다.** 조는 86개로 원본과 똑같은데(100%) 목만 0개였다.
#   목 기능이 없던 옛 수집기로 받은 흔적이다(chapeau 누락 사고와 같은 꼴).
#   챗봇은 이 요건을 **반쪽만** 보여 주게 된다 — "다음 각 목의 시설을 갖출 것" 뒤에 아무것도 없다.
#
# [왜 A-2 와 따로 두나]
#   A-2 는 law.go.kr 에 물어 봐야 알 수 있어 **무겁고**(573계열, 수십 분) 터널이 흔들리면
#   판정 불가가 100건 넘게 나온다. 이 검사는 **파일 하나만 보면 된다** — 원문이 스스로
#   "각 목"이라 했는데 목이 없으면 그 자체로 모순이다. 그래서 상시 게이트에 넣을 수 있다.
#   ⚠대신 **원본에 정말 목이 몇 개인지는 모른다.** "있어야 하는데 없다"까지만 말한다.
#
# [세는 규칙 — 표본을 열어 보고 정했다(2026-09-21)]
#   · 대상은 **법령 계층 파일**(`법률*.txt`·`시행령*.txt`·`시행규칙*.txt`)뿐이다.
#     ⚠**행정규칙(고시)은 뺀다** — 고시 수집기는 목을 줄로 나누지 않고 **문장 안에 이어 붙인다**
#       (`…말한다.가. 목면, 비단, …`). 처음에 고시까지 세어 "398개 파일"이 나왔는데
#       열어 보니 글은 다 있었다. 세기 전에 표본을 연다(_SCHEMA §0-E 규칙 ④).
#   · 세는 것은 **「다음 각 목」 하나뿐**이다 — 뒤에 목이 바로 와야 하는 **약속문**이다.
#     ⚠「제2조제1호 **각 목**」처럼 **다른 조·다른 법을 가리키는 말**은 세지 않는다. 처음엔 이것까지
#       세어 기준법 2건(선박법·어선안전조업법)이 걸렸는데, 열어 보니 둘 다 「어선법」 제2조제1호를
#       가리키는 인용이었다 — 그 파일이 목을 품어야 하는 자리가 아니다(_SCHEMA §0-E 규칙 ④).
#   · 목 줄은 우리 관례대로 **4칸 이상 들여쓴 `가.`** 꼴(`mok_audit.py` 와 같은 규칙).
#   · 줄로 없어도 **"각 목" 바로 뒤 400자 안에 `가.` 가 붙어 있으면** 문장 안에 있는 것으로 본다.
#   · `_구판/`·`_대기/` 는 뺀다(보존본·시행예정 대기본).
#
# [쓰는 법]
#   python3 _dashboard/loop/mok_promise_guard.py              숫자
#   python3 _dashboard/loop/mok_promise_guard.py --examples   어느 파일 어디인지
#   python3 _dashboard/loop/mok_promise_guard.py --base <json> --gate   기준선보다 늘면 실패
#   python3 _dashboard/loop/mok_promise_guard.py --save <json>          기준선 저장
#
# [연계]
#   - 무거운 짝: `mok_audit.py`(원본과 실제 개수를 견준다) · services/mok_audit_scanner.js(수요일 03:00)
#   - 고치는 법: 그 계열을 다시 받는다(`recollect_jomun.py` 가 지금은 목을 적는다).
#   - 기록: _LESSONS.md L-300 · d_stage_2026-09-20/A2_RERUN_RESULT.md
# ============================================================================
import json
import os
import re
import sys

LEGAL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(LEGAL, 'raw')
argv = sys.argv[1:]


def arg(k):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else ''


TIER = re.compile(r'^(법률|시행령|시행규칙)(_.*)?\.txt$')
MOK_LINE = re.compile(r'^\s{4,}[가-힣]\s*\.')
SAYS = re.compile(r'다음 각 목')
INLINE = re.compile(r'가\s*\.\s*\S')
SKIP = (os.sep + '_구판' + os.sep, os.sep + '_대기' + os.sep)

rows = []
for base, dirs, names in os.walk(RAW):
    if any(s in base + os.sep for s in SKIP):
        continue
    if os.path.basename(base) in ('행정규칙', '별표', '_이미지', '_원본첨부'):
        continue
    for n in sorted(names):
        if not TIER.match(n):
            continue
        p = os.path.join(base, n)
        try:
            t = open(p, encoding='utf-8').read()
        except Exception:
            continue
        says = list(SAYS.finditer(t))
        if not says:
            continue
        if any(MOK_LINE.match(l) for l in t.split('\n')):
            continue                       # 목 줄이 하나라도 있으면 이 검사 대상이 아니다
        miss = sum(1 for m in says if not INLINE.search(t[m.end():m.end() + 400]))
        if miss:
            rows.append({'file': os.path.relpath(p, LEGAL), 'says': len(says), 'missing': miss})

rows.sort(key=lambda r: -r['missing'])
now = {'files': len(rows), 'spots': sum(r['missing'] for r in rows)}
base = {}
if arg('--base') and os.path.exists(arg('--base')):
    base = json.load(open(arg('--base'), encoding='utf-8'))


def delta(k):
    if k not in base:
        return ''
    d = now[k] - base[k]
    return '' if d == 0 else '  (%+d)' % d


print('■ "각 목"이라 해 놓고 목이 없는 자리 (법령 계층만 · 네트워크 안 씀)')
print('   %s 파일 %d개%s · 자리 %d곳%s'
      % ('❌' if rows else '✅', now['files'], delta('files'), now['spots'], delta('spots')))
if rows and '--examples' in argv:
    for r in rows[:30]:
        print('      %4d곳  %s' % (r['missing'], r['file']))
    if len(rows) > 30:
        print('      … 그리고 %d개 더' % (len(rows) - 30))
if rows:
    print('   고치는 법: 그 계열을 다시 받는다 — `recollect_jomun.py` 는 지금 목을 적는다.')
if arg('--save'):
    json.dump(dict(now, examples=rows[:60]), open(arg('--save'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('\n스냅샷 저장: %s' % arg('--save'))
if '--gate' in argv:
    if not base:
        print('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).')
        sys.exit(0)
    if now['spots'] > base.get('spots', 0) or now['files'] > base.get('files', 0):
        print('\n  ❌ 기준선(파일 %d · 자리 %d)보다 늘었습니다.' % (base.get('files', 0), base.get('spots', 0)))
        sys.exit(1)
    print('\n  ✅ 기준선 대비 나빠지지 않음')
