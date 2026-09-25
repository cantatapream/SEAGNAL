#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""backfill_lawid.py 가 **못 받은 층만** 다시 받아 스냅샷에 채워 넣는다.

[왜 있나 — 2026-09-22]
  `backfill_lawid.py` 1회 실행 결과가 **성공 160층 · 실패 55층**이었다. 실패는 전부
  `본문을 못 받았다(첫 조회)` 였고 서버가 사유를 말한 `⛔` 는 **한 건도 없었다** —
  권한·인자 문제가 아니라 **터널이 끊긴 쪽**이다(재시도로 풀릴 것이 많다).
  ★그냥 두면 안 되는 까닭: `build_change_baseline.py` 는 스냅샷에 없는 층을
  `missing_lawid` 로 **빼 버린다**. 그대로 baseline 을 만들면 **55개 층이 개정탐지
  대상에서 조용히 사라진다** — "baseline 을 새로 만들었다"고 해 놓고 감시 범위가 주는 것이
  제일 나쁘다.

[무엇을 하나] `lawid_backfill.json` 의 `failures` 만 다시 부른다. 성공하면 `families` 에
  넣고 `failures` 에서 뺀다. **raw `_meta.json` 은 건드리지 않는다**(법령ID 는 이미 다 있다 —
  본 실행이 "추가 0건 · 이미 동일 160건"이었다). 그래서 공유 파일 경합이 없다.

[쓰는 법] python3 _dashboard/loop/backfill_retry.py [--rounds 2]
[연계] ← backfill_lawid.fetch_law_meta(같은 함수를 그대로 쓴다 — 판 고정 포함)
       → _dashboard/lawid_backfill.json (제자리 갱신, 원자적 쓰기 · **건마다** 저장 — 3-66)
"""
import json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from backfill_lawid import fetch_law_meta, OUT  # noqa: E402

argv = sys.argv[1:]
ROUNDS = int(argv[argv.index('--rounds') + 1]) if '--rounds' in argv else 1


def save(d):
    """스냅샷을 **원자적으로** 쓴다(tmp → fsync → replace). 반쯤 쓰인 파일이 남지 않게."""
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fp:
        json.dump(d, fp, ensure_ascii=False, indent=1)
        fp.flush()
        os.fsync(fp.fileno())
    os.replace(tmp, OUT)


def main():
    d = json.load(open(OUT, encoding='utf-8'))
    for rnd in range(1, ROUNDS + 1):
        fails = d.get('failures') or []
        if not fails:
            print('다시 받을 것이 없다.', flush=True)
            break
        print('\n=== %d회차 — 다시 받을 층 %d개 ===' % (rnd, len(fails)), flush=True)
        still, got = [], 0
        for i, f in enumerate(fails, 1):
            key = '%s::%s' % (f['law'], f['layer'])
            info = fetch_law_meta(f['MST'])
            if info:
                d['families'][key] = info
                got += 1
                print('  ✅[%d/%d] %s %s — 시행 %s'
                      % (i, len(fails), f['law'][:22], f['layer'], info.get('시행일자')), flush=True)
            else:
                still.append(f)
                print('  ✗[%d/%d] %s %s (MST %s)'
                      % (i, len(fails), f['law'][:22], f['layer'], f['MST']), flush=True)
            # ★**건마다** 저장한다 (2026-09-25, 일감 3-66).
            #   [무슨 일이 있었나] 여기 주석은 *"중간에 죽어도 받은 것은 남는다"* 고 적어 두었는데,
            #   저장은 **회차 끝**에서 한 번만 했다. 그래서 55층을 도는 도중에 끊기면
            #   **그 회차에 받은 것이 통째로 날아갔다** — 적어 둔 약속이 회차 안에서는 안 지켜졌다.
            #   2026-09-21 HANDOFF 가 「건마다로 고칠 것」이라 적었고 나흘 동안 그대로였다(D-7 재실측).
            #   ★`failures` 에는 **아직 안 해 본 것까지** 함께 남긴다 — 그래야 여기서 죽어도
            #   파일이 «받은 것 + 아직 못 한 것»이라는 **참인 상태**가 된다. 안 그러면 이미 성공한
            #   층이 실패로 남거나(다시 받으면 되니 덜 나쁘다), 반대로 **안 해 본 층이 조용히 사라진다.**
            d['failures'] = still + fails[i:]
            save(d)
            time.sleep(0.25)
        print('  → %d개 받았다 · 남은 실패 %d개 (건마다 저장했다)' % (got, len(still)), flush=True)
        if not still:
            break
    print('\n=== 끝: 스냅샷 %d층 · 남은 실패 %d개 ==='
          % (len(d['families']), len(d.get('failures') or [])), flush=True)
    for f in (d.get('failures') or []):
        print('  남음:', f['law'], f['layer'], f['MST'], flush=True)


if __name__ == '__main__':
    main()
