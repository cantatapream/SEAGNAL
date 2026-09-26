#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""admrul_id_recover.py — ★판번호가 **저장소 어디에도 없는** 행정규칙의 번호를 제목으로 되찾는다. (P-19b)

[어디까지 왔나 — 2026-09-25]
`_admrul_id.py` 가 전수로 재서 **928개 중 885개는 번호를 이미 갖고 있다**는 것을 밝혔다
(라벨이 `행정규칙일련번호:`·`MST` 이거나 폴더 꼬리표 `_admrul.json` 에 있었다).
**남은 43** 만이 정말 없는 것이고, 이 자가 그 43을 맡는다.

[43 을 다시 가르면 — 받아 올 수 없는 것을 받으러 가지 않는다]
  ① **2** 우리 메모·수집시도 기록 (`…확인메모.txt` · `_수집시도_…불확실.txt`)
     → **행정규칙이 아니다.** 번호가 있을 수 없다. 조회하지 않는다(지우지도 않는다).
  ② **22** 기관 표시가 붙은 지역 공고 (`(강릉해양경찰서)하조대해변갯바위_출입통제장소`)
     → 표본 3/3 이 `이름불일치`. 해경서·지자체 공고는 이 창구 밖일 수 있다.
       ⚠**표본 3 으로 단정하지 않는다** — 전수로 조회하고 사유를 그대로 적는다.
  ③ **19** 여느 제목 → 표본 5 중 **2 가 `현행확인`**. 일부는 지금 받을 수 있다.

[★raw 를 고치지 않는다 — 곁 파일에 적는다]
번호를 raw 머리에 써 넣으면 `_touched`·`V5-41`(실측 칸)이 따라붙고 원문이 바뀐다.
`_admrul.json` 에 써 넣으면 그 파일을 함께 쓰는 자들(`build_delegation_graph` 등)의
입력이 바뀐다. 그래서 **곁 파일** `_dashboard/admrul_id_recovered.json` 에 적고,
`_admrul_id.find_id()` 가 그것을 **다섯째 자리**로 본다.
(같은 길을 앞서 걸었다 — 승급 1차 기록을 canonical 본문에 적었다가 `V5-7` 이 빨간불이 되어
 곁 파일 `promote_first_pass.json` 로 옮긴 일. 결심 ⑪ⓓ.)

[★번호를 지어 붙이지 않는다]
`admrul_fresh.api_current()`(A-1 이 쓰는 그 함수)를 그대로 부르고, 사유가 **`현행확인`**
(= 공식명이 우리 제목과 같다)일 때만 적는다. `이름불일치`·`응답없음` 은 **후보만 기록**하고
**고르지 않는다**(G-34). 이름이 바뀐 것인지 폐지인지는 사람이 본다.

쓰는 법:
  python3 admrul_id_recover.py              무엇을 할지만 찍는다(조회는 한다, 파일은 안 쓴다)
  python3 admrul_id_recover.py --apply      곁 파일에 적는다
  python3 admrul_id_recover.py --limit N    앞 N건만 (시험용)

[연계] ← 등록부 `P-19b`. → `_dashboard/admrul_id_recovered.json`(곁 파일) ·
       `_admrul_id.find_id()`(그 파일을 읽는 쪽) · `admrul_fresh.py`(조회 함수의 임자).
"""
import importlib.util
import io
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _admrul_id import find_id, walk_admrul, RAW          # noqa: E402

LEGAL = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(LEGAL, '_dashboard', 'admrul_id_recovered.json')
APPLY = '--apply' in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0

MEMO_RE = re.compile(r'메모|_수집시도|불확실|Stage-')
TITLE_RE = re.compile(r'^\[[^\]]*\]\s*(.+?)\s*$')


def load_af():
    """A-1(`admrul_fresh.py`)을 모듈로 불러 그 조회 함수를 쓴다 — 다시 짜지 않는다(L-136)."""
    spec = importlib.util.spec_from_file_location('af_mod', os.path.join(HERE, 'admrul_fresh.py'))
    m = importlib.util.module_from_spec(spec)
    sys.modules['af_mod'] = m
    spec.loader.exec_module(m)
    return m


def title_of(path):
    """파일 머리의 `[…] 제목` 줄. 없으면 파일이름을 쓴다(밑줄은 공백으로)."""
    try:
        with io.open(path, encoding='utf-8', errors='replace') as f:
            for _ in range(6):
                ln = f.readline()
                if ln.startswith('['):
                    m = TITLE_RE.match(ln.strip())
                    if m:
                        return m.group(1)
    except OSError:
        pass
    return os.path.basename(path)[:-4].replace('_', ' ')


def kind_of(path):
    b = os.path.basename(path)
    if MEMO_RE.search(b):
        return '① 우리 메모(행정규칙이 아니다)'
    if b.startswith('('):
        return '② 기관 표시가 붙은 지역 공고'
    return '③ 여느 제목'


def main():
    af = load_af()
    miss = [p for p in walk_admrul() if not find_id(p)[0]]
    todo = [p for p in miss if kind_of(p) != '① 우리 메모(행정규칙이 아니다)']
    skipped = [p for p in miss if p not in todo]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f'판번호가 저장소 어디에도 없는 행정규칙 {len(miss)}개')
    print(f'  · 조회하지 않는다(우리 메모) {len(skipped)}개')
    print(f'  · 조회한다 {len(todo)}개' + (f' (--limit {LIMIT})' if LIMIT else ''))

    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(io.open(OUT, encoding='utf-8')).get('되찾음', {})
        except Exception:
            prev = {}
    found, why_c = dict(prev), {}
    hold = []
    for i, p in enumerate(todo, 1):
        rel = os.path.relpath(p, RAW)
        t = af.strip_org(title_of(p))
        try:
            info, why, cands = af.api_current(t)
        except Exception as e:
            info, why, cands = None, '던졌다:' + str(e)[:50], []
        why_c[why] = why_c.get(why, 0) + 1
        if why == '현행확인' and info:
            # ⚠칸 이름은 **`serial`** 이다 — 처음 `ID`·`행정규칙일련번호` 로 찾다가
            #   `현행확인` 2건을 그냥 흘렸다(0건으로 찍혔다). 부르는 함수의 반환 꼴을 먼저 읽는다.
            rid = str(info.get('serial') or info.get('ID') or info.get('행정규칙일련번호') or '')
            if rid:
                found[rel] = {
                    'ID': rid, '제목': t, '공식명': info.get('title') or info.get('행정규칙명') or t,
                    '발령일자': info.get('issued') or '', '발령번호': info.get('no') or '',
                    '확인일': time.strftime('%Y-%m-%d'),
                    '근거': 'admrul_fresh.api_current 제목조회 — 사유 현행확인',
                    '갈래': kind_of(p),
                }
                print(f'  [{i}/{len(todo)}] ✔ {t[:44]} → ID {rid}')
                continue
        hold.append({'파일': rel, '제목': t, '사유': why, '갈래': kind_of(p),
                     '후보': [c if isinstance(c, str) else str(c)[:80] for c in (cands or [])][:5]})
        print(f'  [{i}/{len(todo)}] · {t[:44]} → {why}'
              + (f' (후보 {len(cands)})' if cands else ''))

    print('\n  사유별')
    for k, v in sorted(why_c.items(), key=lambda x: -x[1]):
        print(f'    {v:4d}  {k}')
    print(f'\n  ⇒ 번호를 되찾은 것 {len(found) - len(prev)}건(누적 {len(found)}) · '
          f'사람이 볼 것 {len(hold)}건')
    print('  ⚠`이름불일치`·`응답없음` 은 **고르지 않는다** — 이름이 바뀐 것인지 폐지인지는 사람이 본다(G-34).')

    if not APPLY:
        print('\n  (`--apply` 를 안 줬다 — 곁 파일을 쓰지 않았다)')
        return 0
    json.dump({
        '잰날': time.strftime('%Y-%m-%d'),
        '자': 'admrul_id_recover.py (P-19b)',
        '뜻': ('판번호가 raw 머리·`_admrul.json` 어디에도 없던 행정규칙의 번호를 **제목 조회로** 되찾은 것. '
              'raw 를 고치지 않으려고 곁 파일에 둔다 — `_admrul_id.find_id()` 가 다섯째 자리로 읽는다.'),
        '되찾음': found,
        '사람이볼것': hold,
    }, io.open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    io.open(OUT, 'a', encoding='utf-8').write('\n')
    print(f'\n  곁 파일에 적었다: {os.path.relpath(OUT, LEGAL)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
