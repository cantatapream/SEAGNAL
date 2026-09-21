#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/mok_promise_guard.py
# 역할: 원문이 **"다음 각 목/각 호의…"라고 약속해 놓고 그 목(가·나·다)·호(1·2·3)가
#       없는 자리**를 센다(V5-16). 네트워크를 쓰지 않는다 — 파일 스스로 모순인 것만 본다.
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
#     ⚠**`가)`·`1)` 를 "목이 있다"로 쳐 주면 안 된다**(2026-09-21 실측). 그렇게 느슨하게
#       재 보니 자리가 83 → 79 로 줄었는데, 빠진 4자리를 열어 보니 **전부 진짜 결손**이었다
#       (소년법 제4조①3호 · 전기사업법 발췌 2건 · 한국해양진흥공사법 제2조2호 —
#       약속만 하고 글이 끊긴다). 창(400자) 안의 **다른 목록**에 속은 것이다.
#
# [행정규칙을 뺀 것이 옳은지 실측했다 — 2026-09-21]
#   표본만 보고 뺐던 것이 마음에 걸려 행정규칙 전체에 같은 자를 대 봤다.
#   「다음 각 목」인데 `가.` 가 없는 자리 **19곳**(파일 11)이 나왔고, **19곳을 다 열어 봤다.**
#   · 9곳: 목이 **문장 안에** 이어 붙어 있다(`…말한다.가. 목면, 비단, …`) — 글은 다 있다.
#   · 10곳: **원문 자체가** "각 목"이라 해 놓고 `1. 2. 3.`·`가)`·`1)` 로 적는다
#     (선박기관기준 제12조 · 어선설비기준 · 강선의구조기준 등). 수집 결손이 아니라
#     **원문의 표기 불일치**다. 수상레저 금지구역 고시는 그 자리가 **표**, 어선복원성은 **그림**이다.
#   ★즉 **행정규칙에는 진짜 결손이 0곳이다.** 빼는 것이 맞다 — 이제 표본이 아니라 실측이 근거다.
#   · 줄로 없어도 **"각 목" 바로 뒤 400자 안에 `가.` 가 붙어 있으면** 문장 안에 있는 것으로 본다.
#   · `_구판/`·`_대기/` 는 뺀다(보존본·시행예정 대기본).
#
# [쓰는 법]
#   ※목과 호를 **따로** 센다(`files/spots` = 목, `ho_files/ho_spots` = 호).
#
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

# ── 같은 자로 **호(1·2·3)** 도 잰다 (2026-09-21 추가) ─────────────────────────
#   목을 찾다가 "그럼 호는?" 하고 재 봤더니 같은 꼴이 나왔다 — 「다음 각 호」라 해 놓고
#   호가 한 줄도 없는 자리가 **15개 파일 · 29곳**(전부 `15_관련타부처`, 기준법 0).
#   장애인복지법 제32조의2 는 `① … 다음 각 호의 어느 하나에 해당하는 사람은 …할 수 있다.`
#   바로 뒤가 `②` 다 — **누가 등록할 수 있는지가 통째로 없다.**
#   ⚠단 **머리줄이 스스로 밝힌 것은 빼야 한다** — `[제2조] 적용 범위 (… ①본문만 발췌)`
#     처럼 "본문만 받았다"고 적어 둔 발췌는 **결손이 아니라 신고된 범위**다(지방공기업법).
HO_LINE = re.compile(r'^\s{2,}\d+\s*\.')
SAYS_HO = re.compile(r'다음 각 호')
INLINE_HO = re.compile(r'(?<![0-9])1\s*\.\s*\S')
HEAD_LINE = re.compile(r'^\[?제\d+조(?:의\d+)?.*$', re.M)
DECLARED = re.compile(r'본문만|호 생략|각 호 생략|본문 발췌')

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


def ho_gaps():
    """같은 자로 **호**를 잰다. 머리줄이 "본문만"이라 밝힌 자리는 뺀다."""
    out = []
    for base_, dirs_, names_ in os.walk(RAW):
        if any(s in base_ + os.sep for s in SKIP):
            continue
        if os.path.basename(base_) in ('행정규칙', '별표', '_이미지', '_원본첨부'):
            continue
        for n_ in sorted(names_):
            if not TIER.match(n_):
                continue
            p_ = os.path.join(base_, n_)
            try:
                t_ = open(p_, encoding='utf-8').read()
            except Exception:
                continue
            if any(HO_LINE.match(l) for l in t_.split('\n')):
                continue                   # 호 줄이 하나라도 있으면 대상이 아니다
            heads = [(m.start(), m.group(0)) for m in HEAD_LINE.finditer(t_)]
            cnt = 0
            for m in SAYS_HO.finditer(t_):
                if INLINE_HO.search(t_[m.end():m.end() + 400]):
                    continue
                h = ''
                for s, g in heads:
                    if s < m.start():
                        h = g
                    else:
                        break
                if DECLARED.search(h):
                    continue               # 스스로 밝힌 범위다
                cnt += 1
            if cnt:
                out.append({'file': os.path.relpath(p_, LEGAL), 'missing': cnt})
    out.sort(key=lambda r: -r['missing'])
    return out


hrows = ho_gaps()
rows.sort(key=lambda r: -r['missing'])
now = {'files': len(rows), 'spots': sum(r['missing'] for r in rows),
       'ho_files': len(hrows), 'ho_spots': sum(r['missing'] for r in hrows)}
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
print('■ "각 호"라 해 놓고 호가 없는 자리 (머리줄이 "본문만"이라 밝힌 것은 뺌)')
print('   %s 파일 %d개%s · 자리 %d곳%s'
      % ('❌' if hrows else '✅', now['ho_files'], delta('ho_files'),
         now['ho_spots'], delta('ho_spots')))
if hrows and '--examples' in argv:
    for r in hrows[:15]:
        print('      %4d곳  %s' % (r['missing'], r['file']))
    if len(hrows) > 15:
        print('      … 그리고 %d개 더' % (len(hrows) - 15))
if rows or hrows:
    print('   고치는 법: 그 계열을 다시 받는다 — `recollect_jomun.py` 는 지금 목·호를 적는다.')
if arg('--save'):
    json.dump(dict(now, examples=rows[:60], ho_examples=hrows[:40]),
              open(arg('--save'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n스냅샷 저장: %s' % arg('--save'))
if '--gate' in argv:
    if not base:
        print('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).')
        sys.exit(0)
    worse = [k for k in ('files', 'spots', 'ho_files', 'ho_spots')
             if now[k] > base.get(k, 0)]
    if worse:
        print('\n  ❌ 기준선보다 늘었습니다: %s'
              % ' · '.join('%s %d→%d' % (k, base.get(k, 0), now[k]) for k in worse))
        sys.exit(1)
    print('\n  ✅ 기준선 대비 나빠지지 않음')
