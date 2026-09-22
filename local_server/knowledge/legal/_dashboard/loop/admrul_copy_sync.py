#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
# 파일명: _dashboard/loop/admrul_copy_sync.py
# 역할: **같은 고시를 여러 폴더에 두었을 때 사본끼리 판이 어긋났는지** 센다(V5-15).
# ============================================================================
#
# [왜 있나 — 2026-09-21]
#   한 고시가 여러 법 폴더에 사본으로 들어 있는 일이 흔하다(「울산항 항만시설 운영세칙」은
#   항만법·항만운송사업법·선박입출항법 세 곳에 있다). 재수집이 **한 벌만** 갱신하면
#   나머지는 낡은 채로 남고, 챗봇은 어느 쪽을 집을지 모른다.
#
#   ★**A-1(`admrul_fresh.py`)은 이것을 못 잡는다.** 판정이 이렇게 돼 있다 —
#       elif cur['serial'] in held:  verdict = '현행'
#     `held` 는 **모든 사본의 ID 를 합친 집합**이라, **한 벌만 현행이면 그 제목은 통째로
#     '현행'** 이 된다. 실제로 2026-09-21 A-1 재검증은 6건 중 1건만 잡았고, 그것도
#     사본 전부가 낡았던 건이었다. 나머지 5건은 **소리 없이 통과**했다.
#     → A-1 을 고치는 대신 **다른 각도로 재는 장치**를 하나 더 둔다. 고치면 A-1 의 다른
#       판정(이름불일치·미래판보유 등)까지 흔들리고, 그쪽은 이미 실측으로 다듬어 놓았다.
#
# [무엇을 세나]
#   `raw/**/행정규칙/*.txt` 를 **파일 이름으로 묶어**, 한 묶음 안에서 머리글 `ID:` 값이
#   둘 이상 갈리면 어긋난 것으로 센다.
#   ⚠`_구판/` 은 뺀다 — 일부러 남긴 옛 판이라 다른 것이 정상이다.
#   ⚠`ID:` 가 아예 없는 파일은 **따로 센다** — 낡은 것이 아니라 옛 수집 형식일 수 있다.
#
# [한계] "어느 쪽이 현행인가"는 말해 주지 못한다 — 그건 A-1 의 몫이다. 이 장치는
#   **"우리 안에서 말이 엇갈린다"**만 잡는다. 그것만으로 충분히 위험하다.
#
# [쓰는 법]
#   python3 _dashboard/loop/admrul_copy_sync.py             숫자
#   python3 _dashboard/loop/admrul_copy_sync.py --examples  어느 고시인지
#   python3 _dashboard/loop/admrul_copy_sync.py --base <json> --gate   기준선보다 늘면 실패
#   python3 _dashboard/loop/admrul_copy_sync.py --save <json>          기준선 저장
# ============================================================================
import collections
import json
import os
import re
import sys

LEGAL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(LEGAL, 'raw')
IDRE = re.compile(r'ID:\s*(\d{6,})')
argv = sys.argv[1:]


def arg(k):
    return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else ''


groups = collections.defaultdict(list)
for base, dirs, names in os.walk(RAW):
    parts = (base + os.sep).split(os.sep)
    if '_구판' in parts:
        continue
    if os.path.basename(base) != '행정규칙':
        continue
    for n in names:
        if not n.endswith('.txt'):
            continue
        p = os.path.join(base, n)
        try:
            head = open(p, encoding='utf-8').read(600)
        except Exception:
            continue
        m = IDRE.search(head)
        groups[n].append((os.path.relpath(p, LEGAL), m.group(1) if m else None))

multi = {k: v for k, v in groups.items() if len(v) > 1}
split_id, no_id = [], []
for k, v in sorted(multi.items()):
    ids = set(x[1] for x in v if x[1])
    if len(ids) > 1:
        split_id.append((k, v))
    elif any(x[1] is None for x in v):
        no_id.append((k, v))

now = {'groups': len(groups), 'multi': len(multi), 'split_id': len(split_id), 'no_id': len(no_id)}
base = {}
if arg('--base') and os.path.exists(arg('--base')):
    base = json.load(open(arg('--base'), encoding='utf-8'))


def delta(k):
    if k not in base:
        return ''
    d = now[k] - base[k]
    return '' if d == 0 else '  (%+d)' % d


print('■ 같은 고시 사본끼리 판이 맞나 (`_구판/` 제외)')
print('   행정규칙 이름 %d종 · 그중 여러 폴더에 있는 것 %d종' % (now['groups'], now['multi']))
print('   %s 사본끼리 ID 가 갈린다      %d종%s' % ('❌' if split_id else '✅', now['split_id'], delta('split_id')))
print('   %s 사본 중 ID 가 없는 것이 있다 %d종%s   (옛 수집 형식일 수 있다 — 결손 아님)'
      % ('⚠' if no_id else '✅', now['no_id'], delta('no_id')))
if '--examples' in argv:
    for title, v in split_id:
        print('\n   ■ %s' % title)
        for p, i in sorted(v, key=lambda x: -(int(x[1]) if x[1] else 0)):
            print('        %-16s %s' % (i or '(ID없음)', p))
    for title, v in no_id:
        print('\n   ⚠ %s (ID 없는 사본)' % title)
        for p, i in v:
            print('        %-16s %s' % (i or '(ID없음)', p))
if arg('--save'):
    json.dump(dict(now, examples={'split_id': [t for t, _ in split_id], 'no_id': [t for t, _ in no_id]}),
              open(arg('--save'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n스냅샷 저장: %s' % arg('--save'))
if '--gate' in argv:
    if not base:
        print('\n  ⏭️  기준선이 없어 게이트를 건너뜁니다(--base 로 지정).')
        sys.exit(0)
    if now['split_id'] > base.get('split_id', 0):
        print('\n  ❌ 사본끼리 갈린 고시가 기준선(%d)보다 늘었습니다(%d).'
              % (base.get('split_id', 0), now['split_id']))
        sys.exit(1)
    print('\n  ✅ 기준선 대비 나빠지지 않음')
