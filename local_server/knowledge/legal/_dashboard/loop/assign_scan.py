#!/usr/bin/env python3
"""배정용 스캐너 — 백로그의 "실작업 N건"이 진짜 실작업인지 줄 단위로 세어 준다.

[왜 만들었나] 41회차까지 나는 배정할 때 `## REVIEW` 절 밖의 열린 줄을 "실작업"으로 셌다.
그런데 41회차에 사서 여섯이 각자 세어 보니 **그 줄의 대부분이 이미 앞 회차에 갈래가 매겨진
REVIEW 이거나 감사 집계행**이었다(brief §5-25, PENDING_DECISIONS H-2). 절 이름만 보면
실작업이 많아 보이는 법을 고르게 되고, 배정이 왜곡된다.

[무엇을 하나] 절 이름이 아니라 **줄 안의 글자**를 본다. 줄에 이미 판정·보류 흔적
(REVIEW·유권해석·사람 판단·갈래·집계·묶음·질문 원문 부재 등)이 있으면 "판정 흔적 있음"으로
세고, 없는 줄만 "순실작업 후보"로 센다.

[한계 — 반드시 읽어라]
  · 이건 **글자 검색이지 판정이 아니다.** 흔적이 없어도 실작업이 아닐 수 있고(예: 40회차
    수상레저 13줄은 "14R 질문 원문 부재"라 아래 낱말에 안 걸린다), 흔적이 있어도 사서가
    처리할 수 있는 것이 섞여 있다.
  · 그러니 이 숫자로 **배정 후보를 좁히는 데만** 쓰고, 배정 전에 그 법의 줄을 직접 훑어라.
  · 브리프에 이 숫자를 적을 때는 "글자 검색값"이라고 밝혀라(★추측 금지).

[쓰는 법] python3 _dashboard/loop/assign_scan.py [--all]
"""
import glob, re, os, sys

MARK = re.compile(
    r'REVIEW|사람 판단|사람이 판단|유권해석|법제처|갈래|승인 대기|승인 필요|승인만|'
    r'scope_out|분모 제외|집계|요약 행|묶음|오케스트레이터|판정 완료|다음 회차|'
    r'사서 범위 밖|담당이 아니|질문 원문|원문 부재|복원 불가|수집 요청|미수집|판독')

def scan(path):
    sec = None; out = {'review': 0, 'marked': 0, 'plain': 0}
    for ln in open(path, encoding='utf-8'):
        if ln.startswith('## '):
            sec = ln.strip('# \n'); continue
        if not ln.startswith('- [ ]'):
            continue
        if sec and sec.startswith('REVIEW'):
            out['review'] += 1
        elif MARK.search(ln):
            out['marked'] += 1
        else:
            out['plain'] += 1
    return out

def main():
    show_all = '--all' in sys.argv
    rows = []
    tot = {'review': 0, 'marked': 0, 'plain': 0}
    for p in sorted(glob.glob(os.path.join(os.path.dirname(__file__),
                                           '..', 'backlog', '*.md'))):
        s = scan(p)
        for k in tot: tot[k] += s[k]
        if sum(s.values()):
            rows.append((s['plain'], s, os.path.basename(p)[:-3]))
    rows.sort(key=lambda r: (r[0], sum(r[1].values())), reverse=True)
    total = sum(tot.values())
    print(f"열린 줄 {total}개 = REVIEW 절 {tot['review']} · "
          f"판정 흔적 있음 {tot['marked']} · 흔적 없음(순실작업 후보) {tot['plain']}")
    print("⚠글자 검색값이다. 배정 후보를 좁히는 데만 쓰고, 그 법의 줄은 직접 훑어라.\n")
    print(" 순후보 / REVIEW / 흔적 / 합   법")
    for plain, s, name in (rows if show_all else rows[:25]):
        print(f"{plain:>6} / {s['review']:>6} / {s['marked']:>4} / "
              f"{sum(s.values()):>3}   {name}")
    if not show_all and len(rows) > 25:
        print(f"\n… 나머지 {len(rows)-25}개 법은 --all 로 본다.")

main()
