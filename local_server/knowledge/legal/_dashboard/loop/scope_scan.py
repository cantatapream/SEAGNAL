#!/usr/bin/env python3
"""`_CHATBOT.md` §5-2(판례·법리·다툼 = 스코프 밖) 처리 후보를 골라 센다.

[왜 있나 — 2026-09-06]
소유자가 "유권해석을 받아 정답을 채우는 대신, §5-2 대로 **명확한 조문까지만 안내하고 끊어** 닫는다"를
택했다(ⓐ). 그런데 **어느 줄이 그 대상인지**를 눈으로 고르면 또 틀린다(L-253 — 요약표를 믿고
다섯 중 셋을 틀렸다). 그래서 **줄 안의 글자**로 후보를 좁히는 자를 따로 둔다.

[무엇을 하나]
열린 줄(`- [ ]`)만 보고, 그 줄 자체가 §5-2 성격을 적고 있는지로 세 갈래를 만든다.
  scope_out   : 법리·판례·유권해석·해석다툼·개별사안 — §5-2 그대로 닫을 수 있는 후보
  gap_only    : 원문에 없다/원문공백/미제정 — §5-3·정직표기로 닫을 수 있는 후보
  other       : 위 어느 것도 아님 — 사람이 직접 봐야 한다

⚠**이건 글자 검색이지 판정이 아니다.** `assign_scan.py` 머리말과 같은 한계다.
   후보를 좁히는 데만 쓰고, **닫기 전에 그 줄과 그 위키 페이지를 반드시 직접 읽어라.**
   특히 "명확한 조문까지는 답이 채워져 있는가"는 이 자가 볼 수 없다 — §5-2 는
   **끊기만 하는 것이 아니라 조문까지는 반드시 답하는 것**이기 때문이다(§5-1).

[쓰는 법]
  python3 scope_scan.py            → 법별 표
  python3 scope_scan.py --all      → 전체 법
  python3 scope_scan.py --law <법> → 그 법의 후보 줄을 하나씩 보여 준다
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKLOG = os.path.normpath(os.path.join(HERE, '..', 'backlog'))

SCOPE_OUT = re.compile(
    r'법리|판례|유권해석|법제처|해석다툼|해석 다툼|개별 사안|개별사안|'
    r'결론이 하나로|하나로 좁혀지지|확정 불가|단정할 수 없|단정하지 않|'
    r'실무 확인|관할청 확인|관할 부서|소관부서 확인')
GAP_ONLY = re.compile(
    r'원문에 없|원문 부재|원문공백|원문 공백|확인된 부재|미제정|규정 없음|'
    r'조문 자체가 없|근거가 없다|수집 불가|구조적으로 못')
ALREADY = re.compile(r'분모제외')


def rows():
    for fn in sorted(os.listdir(BACKLOG)):
        if not fn.endswith('.md'):
            continue
        law = fn[:-3]
        with open(os.path.join(BACKLOG, fn), encoding='utf-8') as f:
            for i, line in enumerate(f, 1):
                if line.startswith('- [ ] '):
                    yield law, i, line


def classify(line):
    if ALREADY.search(line):
        return 'tagged'
    if SCOPE_OUT.search(line):
        return 'scope_out'
    if GAP_ONLY.search(line):
        return 'gap_only'
    return 'other'


def main():
    args = sys.argv[1:]
    if '--law' in args:
        want = args[args.index('--law') + 1]
        for law, no, line in rows():
            if law != want:
                continue
            print(f"[{classify(line):9}] {no:5}  {line.rstrip()[:300]}")
        return

    tally = {}
    for law, _no, line in rows():
        t = tally.setdefault(law, {'scope_out': 0, 'gap_only': 0, 'tagged': 0, 'other': 0})
        t[classify(line)] += 1

    tot = {'scope_out': 0, 'gap_only': 0, 'tagged': 0, 'other': 0}
    for t in tally.values():
        for k in tot:
            tot[k] += t[k]
    n = sum(tot.values())
    print(f"열린 줄 {n}개 = §5-2 후보 {tot['scope_out']} · 원문공백 후보 {tot['gap_only']} · "
          f"이미 분모제외 표시 {tot['tagged']} · 그 밖 {tot['other']}")
    print("⚠글자 검색값이다. 닫기 전에 그 줄과 위키 페이지를 직접 읽어라(§5-1: 조문까지는 반드시 답한다).\n")
    print(" §5-2 / 공백 / 표시됨 / 그밖 / 합   법")
    rank = sorted(tally.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    if '--all' not in args:
        rank = rank[:25]
    for law, t in rank:
        s = sum(t.values())
        print(f"{t['scope_out']:6} /{t['gap_only']:5} /{t['tagged']:7} /{t['other']:5} /{s:4}   {law}")
    if '--all' not in args and len(tally) > 25:
        print(f"\n… 나머지 {len(tally) - 25}개 법은 --all 로 본다.")


if __name__ == '__main__':
    main()
