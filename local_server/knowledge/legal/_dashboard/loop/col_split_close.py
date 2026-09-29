#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""**되살릴 길이 없는 「열로 풀린 표」에 한계 표시를 단다.** 선언: `_dashboard/col_split_closed.json` (3-36 · 확인판 B4 ⓐ)

[왜] 사장님 확인판 B4 ⓐ(2026-09-29) — 「별표 32쪽은 다시 시도하고, 나머지는 『표 모양 복원 불가 — 원본 참조』
  표시를 달고 닫는다. 수산업법 별표2 는 『그림 번호라 원래 모양』으로 적는다.」
  ★짝을 넘겨짚어 표를 만들지 않는다(P-8 「그것이 바로 환각이다」). 대신 **그 한계를 파일 안에 적는다** —
  raw 는 챗봇 근거자료로 그대로 넘어가므로(P-19), 표시도 같이 넘어가야 모델이 그 표의 행·열 짝을 믿지 않는다.

[무엇을 적나] 파일 머리(첫 빈 줄 앞)에 한 줄을 **덧붙인다**(옛 줄은 건드리지 않는다):
    ⚠표 모양 복원 불가 — 원본 참조: <원본>. 이 파일의 표 N덩이는 칸이 열 단위로 풀려 … (까닭 · 결정)
    ⚠표 아님 — <까닭>. (결정)
  `col_split_scan.js` 가 이 줄을 보고 그 파일의 덩이를 「닫음」으로 따로 센다.

쓰는 법:
    python3 _dashboard/loop/col_split_close.py            # 마른 실행
    python3 _dashboard/loop/col_split_close.py --apply    # 표시를 단다(이미 단 파일은 건너뛴다)

[연계] ← `_dashboard/col_split_closed.json`(선언 · 판단은 여기에만) · V5-20 `col_split_scan.js`
        → `raw/**` 머리 한 줄 · `_touched.py`(되돌리기)
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
DECL = os.path.join(LEGAL, '_dashboard', 'col_split_closed.json')
sys.path.insert(0, HERE)
APPLY = '--apply' in sys.argv
MARK = ('⚠표 모양 복원 불가', '⚠표 아님')      # col_split_scan.js 의 CLOSED 와 같아야 한다


def blocks_by_file():
    out = subprocess.run(['node', os.path.join(HERE, 'col_split_scan.js'), '--list', '--all'],
                         capture_output=True, text=True, check=True).stdout
    n = {}
    for l in out.splitlines():
        if '줄 ' not in l:
            continue
        f = l.split()[1].rsplit(':', 1)[0]
        n[f] = n.get(f, 0) + 1
    return n


def main():
    from _touched import Touched
    decl = json.load(open(DECL, encoding='utf-8'))
    nb = blocks_by_file()
    touched = Touched('col_split_close') if APPLY else None
    today = time.strftime('%Y-%m-%d')
    done = skip = bad = 0
    for it in decl['닫음']:
        p = os.path.join(RAW, it['쪽'])
        if not os.path.exists(p):
            print('  ❌ 없다:', it['쪽']); bad += 1; continue
        L = open(p, encoding='utf-8').read().split('\n')
        if any(l.startswith(MARK) for l in L[:15]):
            print('  ⏭️  이미 표시가 있다:', it['쪽'][:80]); skip += 1; continue
        k = next((i for i, l in enumerate(L[:12]) if not l.strip()), None)
        if k is None or k == 0:
            print('  ❌ 머리(첫 빈 줄 앞)를 못 찾았다:', it['쪽']); bad += 1; continue
        n = nb.get(it['쪽'], 0)
        if n == 0:
            print('  ❌ 이 파일에 센 덩이가 없다 — 선언이 낡았다:', it['쪽']); bad += 1; continue
        if it['꼴'] == '복원 불가':
            line = ('⚠표 모양 복원 불가 — 원본 참조: %s. 이 파일의 표 %d덩이는 칸이 열 단위로 풀려 있어 '
                    '어느 값이 어느 행·열의 것인지 흐리다 — 값을 옮기거나 답할 때는 원본 표로 확인한다. '
                    '(까닭: %s · %s 사장님 확인판 B4 ⓐ — col_split_close.py)'
                    % (it['원본'], n, it['까닭'], today))
        elif it['꼴'] == '표 아님':
            line = ('⚠표 아님 — 짧은 줄이 세로로 이어진 자리 %d곳은 표가 풀린 것이 아니다: %s. '
                    '(원본: %s · %s 사장님 확인판 B4 ⓐ — col_split_close.py)'
                    % (n, it['까닭'], it['원본'], today))
        else:
            print('  ❌ 모르는 꼴:', it['꼴']); bad += 1; continue
        print('  ✅ %-9s %2d덩이  %s' % (it['꼴'], n, it['쪽'][:80]))
        if APPLY:
            L.insert(k, line)
            new = '\n'.join(L)
            open(p, 'w', encoding='utf-8').write(new)
            touched.add(p)
            if open(p, encoding='utf-8').read() != new:
                print('     ❌ 쓴 뒤 다시 읽은 글이 다르다'); bad += 1
        done += 1
    print('\n  표시 %d%s · 이미 있음 %d · 막힘 %d' % (done, '' if APPLY else '(마른 실행)', skip, bad))
    if APPLY and done:
        touched.save()
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
