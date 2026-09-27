# -*- coding: utf-8 -*-
"""위키 표준 절 이름을 하나로 맞춘다 — `## 근거 조문`. (3-5)

왜 지금 할 수 있나 — ★열을 새로 만들 필요가 없다
  등록부는 *"`(전체 사슬)` 을 없애는 것이 아깝다면 표 안에 **`사슬` 열**을 두자 — 사장님 판단"* 이라고
  적어 두었다. **그 열은 이미 있다.** 실측:

      `## 근거 조문 (전체 사슬)` 447개 중 **407개**의 표 첫 칸이 `단계`
      `## 근거 조문`            840개 중 **218개**도 첫 칸이 `단계`

  ⇒ 「사슬」이라는 정보는 **꼬리표가 아니라 `단계` 열**이 담고 있고, 그 열은 **두 이름 모두에서 쓰인다.**
    `legal_retriever` 도 이미 그렇게 읽는다(*"사슬 마디를 뜻하는 이름은 `단계` 하나뿐이었다"*).
    ⇒ **이름을 통일해도 잃는 것이 없다.**

무엇을 바꾸나
  `## 근거 조문 (전체 사슬)`            → `## 근거 조문`            (445곳)
  `## 근거 조문 (전체 사슬) — <설명>`   → `## 근거 조문 — <설명>`   (2곳 · ★설명은 남긴다)
  ~~`## 근거` → `## 근거 조문` (28곳)~~ ★**하지 않는다 — 등록부가 틀렸다(아래)**

★2026-09-24 — **`## 근거` 를 `## 근거 조문` 으로 바꾸려 했다가 되돌렸다.**
  등록부(`06_STANDARD_SECTIONS.md §5`)는 *"`## 근거` → `## 근거 조문` **28쪽**"* 이라고 적어 뒀다.
  그런데 그 28쪽은 **`## 근거 조문` 표를 이미 갖고 있다.** `## 근거` 는 **다른 절**이다 —
  줄글로 적은 출처 메모(예: *"선박직원법 시행령 별표3(제22조제1항 관련), 2025-10-01 시행."*)다.
  바꾸고 나니 한 쪽에 `## 근거 조문` 이 **두 번** 생겨 표를 읽는 쪽이 **하나만 읽었다** —
  실측 **근거 조문 줄 17,904 → 17,774(-130)**, V5-11 고시 별표 도달성 **321 → 298**, 게이트 빨간불.
  ⇒ **이름이 비슷하다고 같은 절이 아니다.** 바꾸기 전에 **그 쪽에 이미 그 절이 있는지** 본다.

무엇을 안 바꾸나
  `## 위임 근거 (공통)`·`## 관련 개념·활동` 처럼 **뜻이 다른 절**은 손대지 않는다.
  소비자는 이미 `startsWith('## 근거 조문')` 으로 읽으므로 **이 바꿈으로 깨지는 곳은 없다**
  (`legal_retriever.MUST_SECTIONS`). 코드에서 `전체 사슬` 이라는 글자를 쓰는 곳은 **0곳**이다(실측).

[연계] → `wiki/**/*.md` 절 머리줄 · 읽는 곳 `legal_retriever.MUST_SECTIONS`·인용사슬 파서 · 다음 `3-4`(이 이름을 요구하는 검사)
사용법: python3 section_name_unify.py [--apply]
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
WIKI = os.path.join(LEGAL, 'wiki')

RULES = [
    (re.compile(r'^## 근거 조문 \(전체 사슬\) — (.*)$', re.M), r'## 근거 조문 — \1', '사슬꼬리표+설명'),
    (re.compile(r'^## 근거 조문 \(전체 사슬\)\s*$', re.M), '## 근거 조문', '사슬꼬리표'),
]


def main():
    apply_ = '--apply' in sys.argv
    tally = collections.Counter()
    files = 0
    for root, _d, fs in os.walk(WIKI):
        for f in sorted(fs):
            if not f.endswith('.md'):
                continue
            p = os.path.join(root, f)
            t0 = open(p, encoding='utf-8').read()
            t = t0
            for rx, rep, label in RULES:
                t, n = rx.subn(rep, t)
                tally[label] += n
            if t != t0:
                files += 1
                if apply_:
                    open(p, 'w', encoding='utf-8').write(t)
    for k in ('사슬꼬리표', '사슬꼬리표+설명'):
        print(f'  {k:16s} {tally[k]}')
    print(f'  {"바뀐 파일":16s} {files}')
    if not apply_:
        print('\n(맛보기다 — 실제로 바꾸려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
