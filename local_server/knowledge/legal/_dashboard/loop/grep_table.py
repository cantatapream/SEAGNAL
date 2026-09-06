#!/usr/bin/env python3
"""표(테두리) 안에서 낱말이 줄 경계로 쪼개져 grep 이 놓치는 것을 찾아 준다.

[왜 있나 — 2026-09-03, L-245]
국가법령정보센터 별표는 표를 아스키 테두리(┃│ 등)로 그린다. 셀 안의 글이 길면
칸 너비에서 줄이 바뀌는데, 그때 **낱말이 두 줄로 쪼개진다.**

    ┃9. …목적 외의   │ 가. 스케이트장·…·탈의장·골프          ┃
    ┃점용·사용        │장을 위한 점용·사용은 인접한 토지가격의…  ┃

이러면 `grep 골프장` 이 **0건**이다. 실제로 공유수면법 위키가 이 때문에
"이 법에 골프장이라는 말이 없다(raw 전수 검색 0건)"고 잘못 적어 두고 있었다
(32회차에 사서가 발견, 시행규칙 별표2 제9호가목에 요율이 멀쩡히 있다).

[무엇을 하나]
각 줄을 테두리로 잘라 **칸(column) 단위로 세로로 이어 붙인 뒤** 낱말을 찾는다.
그냥 공백을 지우고 붙이면 옆 칸 글자까지 붙어 엉뚱한 낱말이 생기므로 그렇게 하지 않는다.

사용법:
  python3 _dashboard/loop/grep_table.py "골프장" raw/07_해양환경생태/공유수면관리및매립에관한법률
  python3 _dashboard/loop/grep_table.py "낱말" raw            # 저장소 전체(느리다)
[연계] ← 사서·오케스트레이터가 "raw 에 그 말이 없다"고 쓰기 전에 한 번 더 확인할 때.
"""
import os, re, sys

BOX = '┃│┠┼┨─━┏┓┗┛┣┫┳┻┌┐└┘├┤┬┴'
SEP = re.compile('[┃│┣┫├┤]')
RULE = re.compile('^[\\s' + BOX + ']*$')

def columns(text):
    """표 블록을 칸 단위로 세로 연결한 문자열들을 돌려준다."""
    out, buf = [], []
    for line in text.split('\n'):
        if RULE.match(line) or not SEP.search(line):
            if buf: out += _join(buf); buf = []
            if not SEP.search(line): out.append(line)
            continue
        buf.append([c.strip() for c in SEP.split(line)])
    if buf: out += _join(buf)
    return out

def _join(rows):
    n = max(len(r) for r in rows)
    return [''.join(r[i] for r in rows if i < len(r)) for i in range(n)]

def main():
    if len(sys.argv) < 3:
        print(__doc__); return 1
    word, base = sys.argv[1], sys.argv[2]
    hit = 0
    for root, _, files in os.walk(base):
        for f in files:
            if not f.endswith('.txt'): continue
            p = os.path.join(root, f)
            try: s = open(p, encoding='utf-8', errors='ignore').read()
            except Exception: continue
            if word in s: continue          # 그냥 grep 으로 잡히는 것은 뺀다
            for col in columns(s):
                if word in col:
                    i = col.find(word)
                    print(f'{p}\n    …{col[max(0,i-60):i+60]}…')
                    hit += 1
                    break
    print(f'\n그냥 grep 으로는 안 잡히는데 표를 세로로 이어 붙이면 나오는 파일: {hit}개')
    return 0

if __name__ == '__main__':
    sys.exit(main())
