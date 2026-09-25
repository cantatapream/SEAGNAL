#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_admrul_id.py — ★행정규칙 raw 파일의 **판번호를 찾는 단 한 곳.** (등록부 P-19b)

[왜 있나 — 2026-09-25 실측]
`P-19b` 는 *"판번호 없는 행정규칙 58개가 기준법 도메인에 있다 — `ID:` 가 없으면
A-1(신선도 점검)이 그 파일을 **구조적으로 못 따라간다**"* 였다.
그래서 「받아 와야 한다」고 적혀 있었다. **재 보니 그게 아니었다:**

| A-1 의 `^ID:` 가 못 읽는 것 **71** | 실제 사정 |
|---|---|
| **14** | 번호가 **있다.** 라벨이 `행정규칙일련번호:` 다 |
| **1** | 번호가 **있다.** 라벨이 `MST` 다 |
| **20** | 같은 폴더 `_admrul.json` 에 그 제목의 `ID` 가 **있다** |
| 36 | 저장소 어디에도 번호가 없다 ← **이것만이 받아 올 것** |

즉 **71 중 35 는 망을 타지 않고 지금 풀린다.** 받아 올 것은 36 이다.

[왜 한 곳에 모으나 — L-386]
`^ID:` 를 **여섯 자가 각자 다시 구현**하고 있었다(실측):
  `admrul_fresh.py:71` · `admrul_annex_survey.py:62` · `admrul_fill_addenda.py:150` ·
  `admrul_fill_annex.py:54` · `build_change_baseline.py:121` · (+`admrul_recollect_stale.py:158` 는 **쓰는** 쪽)
규칙이 여섯 곳에 있으면 **한 곳만 고쳐도 나머지 다섯은 여전히 못 읽는다.**
그래서 찾는 법을 여기 한 곳에 두고, 부르는 쪽은 이 함수를 쓴다.

⚠**raw 를 고치지 않는다.** 번호는 이미 파일(또는 그 폴더 꼬리표)에 있으므로
  **읽는 자를 고치는 것이 옳다.** raw 는 불변이고, 고치면 `_touched`·V5-41 이 따라붙는다.

[찾는 순서 — 위에서 아래로, 먼저 맞는 것을 쓴다]
  ① `^ID:<숫자>`            지금까지 보던 자리(가장 많다)
  ② `행정규칙일련번호:<숫자>`  같은 것을 다른 라벨로 적은 것
  ③ `MST:<숫자>`            한 건(수산관계법령 위반행위 행정처분 규칙)
  ④ 같은 폴더 `_admrul.json` 의 그 제목 항목의 `ID`
     (제목은 낱말·기호를 지우고 견준다 — 파일이름은 공백을 `_` 로 바꿔 적었다)

쓰는 법(파이썬):
    from _admrul_id import find_id
    rid, where = find_id(path)          # (번호|None, 어디서 찾았나)

쓰는 법(명령):
    python3 _admrul_id.py               행정규칙 전수로 어디서 찾히는지 표를 찍는다
    python3 _admrul_id.py --missing     아직 못 찾는 것의 목록(받아 올 것)

[연계] ← 등록부 `P-19b`. → `admrul_fresh.py`(A-1) 이 이 함수를 부른다.
       아직 안 부르는 자: `admrul_annex_survey` · `admrul_fill_addenda` · `admrul_fill_annex` ·
       `build_change_baseline` — 그 넷은 각자 기준선·산출물이 있어 **한 번에 바꾸지 않았다**(따로 잰다).
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
HEAD_LINES = 8
SKIP_DIRS = ('_구판', '_대기', '_이미지', '_원본첨부')

# 앞 공백을 받는다(넉넉하게 — A-1 은 줄을 `strip()` 한 뒤 본다).
# ⚠**정정**: 처음 나는 `^ID:` 로만 세어 857 이 나왔고 A-1 은 868 을 따라가는 것을 보고
#   *"앞 공백 탓에 11 을 적게 세었다"* 고 적었다. **그 설명은 틀렸다** — 앞 공백을 받게 고쳐도
#   857 그대로였다. 실제 까닭은 **파일 집합이 다른 것**이었다: A-1 은 `_구판`(일부러 남긴 옛 판)
#   **13개까지 훑고**, 이 자의 `walk_admrul()` 은 그것을 뺀다. 그래서 855+13 = 868 이다.
#   (A-1 이 옛 판을 훑는 것은 뒤에서 따로 가려낸다 — `_SCHEMA §0-E` 의 보존본 규약 참고.)
ID_RE = re.compile(r'^[ \t]*ID\s*:\s*(\d+)', re.M)
SERIAL_RE = re.compile(r'행정규칙일련번호\s*:\s*(\d+)')
MST_RE = re.compile(r'MST\s*[:=]\s*(\d+)')


def _norm(s):
    return re.sub(r'[^가-힣A-Za-z0-9]', '', str(s or ''))


def find_id(path, head=None):
    """그 파일의 행정규칙 판번호. → `(번호|None, 어디서)`

    예: find_id('.../행정규칙/어선표지판_규격_및_부착요령.txt')
        → ('2100000079889', '행정규칙일련번호')
    """
    if head is None:
        try:
            with io.open(path, encoding='utf-8', errors='replace') as f:
                head = ''.join([next(f, '') for _ in range(HEAD_LINES)])
        except OSError:
            return None, '파일을 못 읽었다'
    for rx, where in ((ID_RE, 'ID:'), (SERIAL_RE, '행정규칙일련번호'), (MST_RE, 'MST')):
        m = rx.search(head)
        if m:
            return m.group(1), where
    # ④ 같은 폴더 꼬리표
    aj = os.path.join(os.path.dirname(path), '_admrul.json')
    if os.path.exists(aj):
        try:
            d = json.load(io.open(aj, encoding='utf-8'))
        except Exception:
            d = {}
        stem = _norm(os.path.basename(path)[:-4] if path.endswith('.txt') else os.path.basename(path))
        if isinstance(d, dict):
            for title, v in d.items():
                t = _norm(title)
                if not t:
                    continue
                if t == stem or t in stem or stem in t:
                    rid = (v or {}).get('ID') if isinstance(v, dict) else None
                    if rid:
                        return str(rid), '_admrul.json'
    return None, '어디에도 없다'


def walk_admrul():
    """행정규칙 원문 파일 전부(옛 판·대기·이미지·원본첨부는 뺀다)."""
    for dirpath, dirs, files in os.walk(RAW):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if os.path.basename(dirpath) != '행정규칙':
            continue
        for fn in sorted(files):
            if fn.endswith('.txt'):
                yield os.path.join(dirpath, fn)


def main():
    import collections
    c = collections.Counter()
    miss = []
    for p in walk_admrul():
        rid, where = find_id(p)
        c[where] += 1
        if not rid:
            miss.append(os.path.relpath(p, RAW))
    tot = sum(c.values())
    print(f'행정규칙 원문 {tot}개 — 판번호를 어디서 찾았나')
    for k, v in c.most_common():
        print(f'  {v:5d}  {k}')
    found = tot - len(miss)
    print(f'\n  찾음 {found} / {tot} ({100 * found / tot:.1f}%) · ★못 찾음 {len(miss)} ← 이것만이 받아 올 것')
    if '--missing' in sys.argv:
        print('\n  못 찾은 것')
        for m in miss:
            print('   ·', m)
    return 0


if __name__ == '__main__':
    sys.exit(main())
