#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-28 / G-24 — **`(⚠REVIEW)` 표시 1,067개가 무엇을 가리키는지 갈라 센다.**

[왜 먼저 가르나]
  등록부는 *"「원문 대조 필요」 표시가 남아 있다 → 대조해서 없앤다"* 라고만 적혀 있다.
  그런데 **무엇을 대조하는 표시인지**가 안 적혀 있었다. 열어 보니 하나가 아니다:
    ① **표 행** — 그림 속 표를 기계가 옮겨 적은 줄 (`| 몸무게(킬로그램) | 15 미만 | … |(⚠REVIEW)`)
    ② **도해 설명** — 그림을 기계가 말로 풀어 쓴 줄 (`그림 4 - … 조건식 "a≥10°" 가 표기됨(⚠REVIEW)`)
    ③ **머리 경고** — 파일 첫머리의 `⚠REVIEW / 출처: …` (수집 방식 표시이지 값이 아니다)
    ④ 그 밖
  ★**셋은 대조하는 법이 서로 다르다.**
    ①은 **원본 그림과 숫자를 맞추면 된다** — 사람이 눈으로 확인할 수 있고, 맞으면 표시를 뗀다.
    ②는 **말로 푼 설명**이라 「맞다/틀리다」가 아니라 「충분한가」다 — 판정 기준부터 달라야 한다.
    ③은 **결함이 아니다.** 「이 파일은 이렇게 받았다」는 기록이다. 여기 섞어 세면 숫자가 부푼다.
  ⇒ 섞어서 「803개를 대조한다」고 잡으면 **끝낼 수 없는 일**이 된다(뿌리 사슬 ⑥).

[또 하나 — 원본 그림이 있어야 대조가 된다]
  ①②는 **원본 PNG 가 있어야** 사람이 맞춰 볼 수 있다. 없으면 대조 자체가 불가능하다.
  그래서 그림이 곁에 있는지도 같이 센다. **없는 것은 「못 한다」가 아니라 「그림부터 받아야 한다」**로 적는다.

[그리고 — 위키가 그 파일을 인용하나]
  인용하지 않는 파일의 표시는 **사용자에게 안 닿는다.** 먼저 할 것과 나중 할 것을 가르는 자다.

[연계] ← `raw/**/행정규칙/*.txt` · 세는 범위는 `_counting.js ADMRUL_SCOPE` 와 같다
        → `build_review_html.py`(사람이 눈으로 맞추는 쪽)
사용법: python3 review_mark_census.py [--list]
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
WIKI = os.path.join(LEGAL, 'wiki')
LIST = '--list' in sys.argv

MARK = re.compile(r'⚠\s*REVIEW')
TABLE_ROW = re.compile(r'^\s*\|.*\|')                 # 표 행
HEAD_NOTE = re.compile(r'^\s*⚠\s*REVIEW\s*/')          # 머리의 수집 표시
DOHAE = re.compile(r'(그림|도해|이미지판독|\[도해\])')
IMG_REF = re.compile(r'원본이미지\s*:\s*([^\s)]+)')


def admrul_files():
    out = []
    for root, dirs, fs in os.walk(RAW):
        if os.path.basename(root) != '행정규칙':
            continue
        for f in sorted(fs):
            if f.endswith('.txt'):
                out.append(os.path.join(root, f))
    return out


def wiki_mentions():
    """위키가 짚는 행정규칙 파일 경로(raw/…) 를 모은다."""
    seen = set()
    pat = re.compile(r'raw/[^\s`"“”,)]+\.txt')
    for root, dirs, fs in os.walk(WIKI):
        for f in fs:
            if not f.endswith('.md'):
                continue
            try:
                t = open(os.path.join(root, f), encoding='utf-8').read()
            except Exception:
                continue
            for m in pat.findall(t):
                if '/행정규칙/' in m:
                    seen.add(m)
    return seen


def main():
    cited = wiki_mentions()
    kind = collections.Counter()
    per_file = collections.Counter()
    img_have = img_none = 0
    cited_files = set()
    ex = collections.defaultdict(list)
    for p in admrul_files():
        rel = os.path.relpath(p, os.path.dirname(RAW)).replace(os.sep, '/')
        try:
            lines = open(p, encoding='utf-8', errors='replace').read().split('\n')
        except Exception:
            continue
        hit = False
        # 그 파일 곁에 원본 그림 폴더가 있나
        imgdir = os.path.join(os.path.dirname(p), '_이미지')
        has_img_dir = os.path.isdir(imgdir)
        for i, l in enumerate(lines):
            if not MARK.search(l):
                continue
            hit = True
            per_file[rel] += 1
            if HEAD_NOTE.match(l):
                k = '③머리 수집표시(결함 아님)'
            elif TABLE_ROW.match(l):
                k = '①표 행(그림에서 옮김)'
            elif DOHAE.search(l) or (i and DOHAE.search(lines[i - 1])):
                k = '②도해 설명(말로 푼 것)'
            else:
                k = '④그 밖'
            kind[k] += 1
            if len(ex[k]) < 3:
                ex[k].append(f'{rel}:{i+1}  {l.strip()[:96]}')
            if k in ('①표 행(그림에서 옮김)', '②도해 설명(말로 푼 것)'):
                if has_img_dir:
                    img_have += 1
                else:
                    img_none += 1
        if hit and rel in cited:
            cited_files.add(rel)
    tot = sum(kind.values())
    print(f'  `(⚠REVIEW)` 표시 {tot}개 · 파일 {len(per_file)}개 (행정규칙 폴더 바로 아래 .txt)\n')
    for k in sorted(kind):
        print(f'    {k:24} {str(kind[k]).rjust(5)}')
    print(f'\n    ①②(사람이 그림과 맞춰야 하는 것) 가운데')
    print(f'      · 곁에 원본 그림 폴더가 있다   {img_have}')
    print(f'      · ★그림이 없다 — 대조 불가     {img_none}   먼저 그림부터 받아야 한다')
    print(f'\n    표시를 가진 파일 {len(per_file)}개 중 **위키가 인용하는 것 {len(cited_files)}개**'
          f'  ({round(100*len(cited_files)/max(1,len(per_file)))}%)')
    print('      ⇒ 인용하지 않는 파일의 표시는 사용자에게 닿지 않는다. 먼저 할 것을 가르는 자다.')
    if LIST:
        print('\n  갈래별 보기')
        for k in sorted(ex):
            for e in ex[k]:
                print(f'    [{k}] {e}')
        print('\n  표시가 많은 파일 상위 10')
        for f, n in per_file.most_common(10):
            print(f'    {str(n).rjust(4)}  {"★인용" if f in cited_files else "    "}  {f[4:88]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
