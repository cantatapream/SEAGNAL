#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""**본문이 「별표 N과 같다」고 가리키는데 그 별표 파일이 없는 자리**를 센다. (2026-09-24 신설)

[어떻게 찾았나 — 곁가지에서 나왔다]
  G-29(인용 없는 EXACT 주장)를 숫자로 맞춰 보다가, 「국제항해선박…해적행위 피해예방법」
  위키가 과태료 표(120·160·240만원)를 *"원문과 EXACT 일치"* 라고 적어 둔 것을 보았다.
  그런데 그 법 raw 어디에도 그 숫자가 없었다. 시행령을 열어 보니 —
    `[제15조] 과태료의 부과기준 … 법 제47조에 따른 과태료의 부과기준은 **별표 2**와 같다.`
  그리고 `별표/` 폴더에는 **`시행령_별표2.txt` 가 없었다.** 시행규칙 별표만 있었다.
  ⇒ **법이 "여기 있다"고 가리키는 표를 우리가 안 갖고 있다.** 그런데 위키는 그 표를 싣고
    「원문과 일치」라고 적었다 — 무엇과 일치하는지 우리는 확인할 길이 없다.

[세는 법]
  · 대상  각 법 폴더의 `법률.txt`·`시행령.txt`·`시행규칙.txt`
  · 가리킴  `별표 N` 뒤에 조사·서술이 붙은 것(`별표 2와 같다`·`별표 3에 따라`…).
           ⚠**「별표」 낱말만 있는 것은 안 센다** — 무엇을 가리키는지 모른다.
  · 있다고 보는 것  `별표/<계층>_별표N.txt` 또는 `별표/별표N.txt`
  · **기준법(01~14)과 15_관련타부처를 갈라 센다** — 타부처 법은 **발췌 수집이 정상**이라
    같은 잣대로 세면 숫자가 부풀어 아무도 안 보게 된다(뿌리 사슬 ④의 흔한 죽음).

⚠이 자는 **판정자가 아니다.** 「없다」가 곧 결함은 아니다 — 폐지된 별표, 이미지로만 있는 별표가
  섞인다. 사람이 볼 **후보 목록**으로 낸다.

쓰는 법: python3 byl_ref_gap.py [--list] [--all]   (--all 은 15_관련타부처도 함께 본다)
"""
import os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
TIER = {'법률.txt': '법률', '시행령.txt': '시행령', '시행규칙.txt': '시행규칙'}
# 「별표 N」 뒤에 조사·서술이 붙어야 **가리킨 것**으로 본다.
REF = re.compile(r'별표\s*(\d+(?:의\d+)?)\s*(?:와|과|에|의|를|은|는|같다|에서|에\s*따)')
BASE_DOM = re.compile(r'^(0[1-9]|1[0-4])_')

def scan():
    rows = []
    for dom in sorted(os.listdir(RAW)):
        dp = os.path.join(RAW, dom)
        if dom.startswith('_') or not os.path.isdir(dp):
            continue
        grp = '기준법' if BASE_DOM.match(dom) else ('타부처' if dom.startswith('15_') else '그밖')
        for law in sorted(os.listdir(dp)):
            lp = os.path.join(dp, law)
            if not os.path.isdir(lp):
                continue
            byl = os.path.join(lp, '별표')
            have = set(os.listdir(byl)) if os.path.isdir(byl) else set()
            for fn, tier in TIER.items():
                fp = os.path.join(lp, fn)
                if not os.path.exists(fp):
                    continue
                try:
                    t = open(fp, encoding='utf-8').read()
                except Exception:
                    continue
                for num in sorted({m.group(1) for m in REF.finditer(t)}):
                    ok = (f'{tier}_별표{num}.txt' in have) or (f'별표{num}.txt' in have)
                    rows.append({'군': grp, '법': f'{dom}/{law}', '계층': tier, '번호': num, '있다': ok})
    return rows

def main():
    rows = scan()
    show = ['기준법'] + (['타부처', '그밖'] if '--all' in sys.argv else [])
    for g in ['기준법', '타부처', '그밖']:
        sub = [r for r in rows if r['군'] == g]
        if not sub:
            continue
        miss = [r for r in sub if not r['있다']]
        print(f'  {g:5s} 가리킴 {len(sub):5d} · **없다** {len(miss):4d}  ({100 * len(miss) / len(sub):.1f}%)')
    g = [r for r in rows if r['군'] in show and not r['있다']]
    print(f'\n★사람이 볼 후보 {len(g)}건 (법 {len({r["법"] for r in g})}개)')
    if '--list' in sys.argv:
        by = collections.defaultdict(list)
        for r in g:
            by[r['법']].append(f"{r['계층']} 별표{r['번호']}")
        for law, v in sorted(by.items(), key=lambda x: -len(x[1])):
            print(f'  {len(v):3d}  {law}  — {", ".join(v[:6])}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
