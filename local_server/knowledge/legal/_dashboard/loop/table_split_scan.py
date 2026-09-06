#!/usr/bin/env python3
"""표 안에서 **줄 경계로 쪼개진 낱말**을 낱말 목록 없이 전수로 찾아 준다.

[왜 있나 — 2026-09-03, L-245 의 뒷면]
`grep_table.py` 는 **찾을 낱말을 알고 있을 때** 쓴다("골프장이 정말 없나?").
그런데 정작 위험한 것은 **무엇이 숨었는지 모르는 경우**다. 33회차 자연유산법
사서가 낱말 12개로 찾았을 때는 0건이었는데, 거꾸로 "쪼개진 자리"를 전부 뽑아
보니 그 법 한 곳에서만 41개 파일에 걸쳐 나왔고 그중 하나가 실제로 답을 바꿨다
(별지 제34호서식 조사원증 뒷면 유의사항이 통째로 쪼개져 있었다 —
`우체통에넣어`·`신고해야합니다`·`유효합니다`·`상반신으로`).

[무엇을 하나]
`grep_table.py` 와 같은 방식으로 칸을 세로로 이어 붙인 뒤, **줄이 바뀌는 자리에서
한글이 한글로 이어지는 지점**을 찾아 그 앞뒤를 보여 준다. 즉 "이 파일에서 이런
말들이 plain grep 으로는 안 잡힌다"를 통째로 뽑아 준다.

새 줄이 문장부호·번호·기호로 시작하면 쪼개진 것이 아니므로 버린다.

사용법:
  python3 _dashboard/loop/table_split_scan.py raw/15_관련타부처/자연유산의보존및활용에관한법률
  python3 _dashboard/loop/table_split_scan.py raw/... --min 6   # 이어붙인 말이 6자 이상인 것만
  python3 _dashboard/loop/table_split_scan.py raw/... --files   # 파일별 건수만

[한계 — 반드시 알고 쓸 것]
쪼개진 자리를 **기계로 이어 붙인 것**이라, 실제 낱말이 아닌 조각도 섞여 나온다
(칸 안에서 문장이 이어졌을 뿐 한 낱말이 아닌 경우). **여기 나온 것을 그대로
"이 법에 이런 말이 있다"의 근거로 쓰지 말고**, 눈에 걸리는 것을 골라
`grep_table.py` 로 되짚어 원문 자리를 확인한 뒤에 쓴다.

[연계] → `grep_table.py`(낱말을 알 때) · ← 사서가 한 법을 맡으면 착수 때 한 번 돌려
"이 법에 표 함정이 있나"를 먼저 본다. `_LESSONS.md` L-245.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grep_table import SEP, RULE

HAN = re.compile('[가-힣]')
# 새 줄이 이런 것으로 시작하면 쪼개진 낱말이 아니다(번호·기호·괄호로 새로 시작한 줄)
STARTS_NEW = re.compile(r'^[\s\d(（\[{『「【<※·•\-–—ㆍ,.]|^[가-힣][.)]|^[0-9]+[.)]')


def split_points(path, minlen):
    """한 파일에서 '줄 경계로 쪼개진 것으로 보이는 자리'를 뽑는다."""
    try:
        text = open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, OSError):
        return []
    rows, hits = [], []
    for line in text.split('\n'):
        if RULE.match(line) or not SEP.search(line):
            rows = []
            continue
        cells = [c.strip() for c in SEP.split(line)]
        if rows:
            for i, cur in enumerate(cells):
                if i >= len(rows):
                    break
                prev = rows[i]
                if not prev or not cur:
                    continue
                if not HAN.search(prev[-1:]) or not HAN.search(cur[:1]):
                    continue
                if STARTS_NEW.match(cur):
                    continue
                joined = (prev[-8:] + cur[:8]).replace(' ', '')
                if len(joined) >= minlen:
                    hits.append(joined)
        rows = cells
    return hits


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    root = args[0] if args else 'raw'
    minlen = 5
    if '--min' in sys.argv:
        minlen = int(sys.argv[sys.argv.index('--min') + 1])
    files_only = '--files' in sys.argv

    total_files = boxed = 0
    per_file = []
    if os.path.isfile(root):
        targets = [root]
    else:
        targets = [os.path.join(b, n) for b, _, ns in os.walk(root)
                   for n in sorted(ns) if n.endswith('.txt')]
    for p in targets:
        if True:
            total_files += 1
            hits = split_points(p, minlen)
            if hits:
                boxed += 1
                per_file.append((p, hits))

    for p, hits in per_file:
        seen, uniq = set(), []
        for h in hits:
            if h not in seen:
                seen.add(h)
                uniq.append(h)
        print('%s — %d곳' % (p, len(uniq)))
        if not files_only:
            for h in uniq:
                print('    …%s…' % h)
    print()
    print('훑은 txt %d개 / 쪼개진 자리가 나온 파일 %d개 / 자리 합계 %d'
          % (total_files, boxed, sum(len(h) for _, h in per_file)))
    print('⚠기계로 이어 붙인 것이라 실제 낱말이 아닌 조각도 섞여 있다.')
    print('  눈에 걸리는 것만 골라 grep_table.py 로 원문 자리를 되짚은 뒤에 근거로 써라.')


if __name__ == '__main__':
    main()
