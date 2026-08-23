#!/usr/bin/env python3
"""같은 폴더에 **같은 행정규칙 ID 를 가진 파일이 둘 이상** 있는지 본다.

[왜 있나 — 2026-08-23]
재수집이 이름이 바뀐 고시를 현행본으로 갈아끼우면서 **옛 판본 파일을 통째로 덮어쓴** 사고가 났다.
그 결과 위키가 인용하던 근거(항만법 구 고시의 배점 30점 등)가 raw 에서 사라졌고,
적대검증관이 "위키에 근거 없는 숫자가 있다"고 지적하고 나서야 드러났다(L-183).

**같은 폴더에 같은 ID 가 둘이면 덮어쓰기가 일어난 것이다** — 이건 코드 몇 줄로 즉시 알 수 있다.
실제로 이 검사로 7건을 찾았다(오늘 발생 4건 + 이전 세션 3건).

무엇을 못 보나: ID 가 안 적힌 파일, 폴더가 다른 중복, 이름만 같고 ID 가 다른 판본.
통과했다고 중복이 없다는 뜻이 아니다.

[쓰는 법] python3 dup_id_check.py [--gate]
[연계] raw/**/행정규칙/*.txt 읽기 전용 — 파일을 고치지 않는다.
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.normpath(os.path.join(HERE, '..', '..', 'raw'))
ID_RE = re.compile(r'ID:(\d{6,})')

dups = []
for root, _, files in os.walk(RAW):
    if os.path.basename(root) != '행정규칙':
        continue
    by = collections.defaultdict(list)
    for fn in sorted(files):
        if not fn.endswith('.txt'):
            continue
        try:
            with open(os.path.join(root, fn), encoding='utf-8') as f:
                head = ''.join(next(f, '') for _ in range(8))
        except Exception:
            continue
        m = ID_RE.search(head)
        if m:
            by[m.group(1)].append(fn)
    for i, fs in by.items():
        if len(fs) > 1:
            dups.append((os.path.relpath(root, RAW), i, fs))

print('■ 행정규칙 폴더 안 ID 중복 — 덮어쓰기 사고 신호')
print('   중복: %d곳' % len(dups))
for d, i, fs in dups:
    print('   [%s] ID:%s' % (d, i))
    for f in fs:
        print('       · %s' % f)
if not dups:
    print('   ✅ 없음')
else:
    print('\n   고치는 법: 옛 판본이 필요하면 DRF(target=admrul, ID=<옛 일련번호>)로 다시 받아')
    print('   별도 파일로 복원하고 머리말에 "폐지 판본"을 적는다. 옛 일련번호가 없으면 복원 불가다 —')
    print('   그러니 **교체할 때 반드시 구 일련번호를 파일에 남긴다**(L-183).')

if '--gate' in sys.argv and dups:
    sys.exit(1)
