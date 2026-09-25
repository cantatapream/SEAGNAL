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

⚠★**이 자는 판정자가 아니다 — 그리고 만들면서 내가 여섯 번 틀렸다** (2026-09-24)
  처음 「기준법 36건 미수집」이라고 냈는데, **후보를 하나씩 열어 보니 전부 딴 것이었다**:
    ① 부칙·개정문 속 언급(`별표 14 및 별표 15를 각각 삭제한다`)          36 → 12
    ② 남의 법 별표(`「선박직원법 시행령」 별표 3에 따른`)                 12 → 7
    ③ 남의 계층(`영 별표 6` — 시행규칙 본문에서 「영」은 시행령)           7 → 1
    ④ 법 이름이 멀리 있는 남의 법(`「수산업법 시행령」 제52조…및 별표 10`)
  ★**남은 7건도 API 로 확인하니 그 법에 그 번호의 별표가 아예 없었다**(양식산업발전법 시행령은
    별표 1~3뿐, 낚시법 시행규칙은 1·2·2의2·3·4뿐). 전부 **타법·타계층 인용**이었다.
  ⇒ **2026-09-24 실측 결론: 기준법 도메인의 「본문이 가리키는데 없는 별표」는 사실상 0이다.**
    내가 처음 낸 36 은 **결함이 아니라 내 자의 흠**이었다.

[한계 — 알고 쓸 것]
  · `영 제21조의2 및 별표 5의2` 처럼 **계층어가 멀리 있는 꼴을 아직 못 가린다.** 걸러 보려 했더니
    제 별표를 말하는 문장(`법 제10조 … 별표 3과 같다`)까지 빠져 분모가 563 → 172 로 주저앉았다.
    **과교정은 미교정보다 나쁘다** — 없는 것을 없다고 하려다 있는 것까지 안 보이게 된다.
  · 그래서 이 자가 내는 「없다」는 **반드시 하나씩 열어 봐야 한다.** 게이트로 삼지 않는다.

★★**결심 ⑫ — 사장님 확정 (2026-09-25): 타부처 별표는 결함이 아니다**
  물음은 *"`15_관련타부처` 를 어디까지 받을 것인가"* 였고, 확정은 **ⓒ 발췌로 둔다** 다.
  까닭: 타부처 법은 우리 소관이 아니고, 152건을 다 받으면 **판 관리(MST·신선도 점검) 부담이
  152건 더 붙는다.** 기준법(01~14)은 이미 사실상 0 이다.
  ⇒ 이 자가 내는 타부처 숫자는 **「받을 일감」이 아니라 「알고 두는 상태」**다.
    다시 결함으로 등재하지 말 것 — 그 왕복을 막으려고 여기 적는다.

  ⚠★**「정직문구를 붙인다」는 붙일 자리가 없었다 — 재서 알았다 (2026-09-25)**
    처음 추천은 *"그 자리에 「여기는 발췌다 · 전문은 law.go.kr」 을 적는다(3-7 정직문구 B 꼴)"* 였다.
    두 가지가 틀렸다:
      ① **B 문구를 쓰면 안 된다** — `honest_phrases.json` 의 B 가 스스로 못박고 있다:
         *"★이것은 「우리가 안 받았다」와 다른 말이다. 안 받은 것이면 이 문구를 쓰면 안 된다."*
      ② **붙일 자리가 없다** — 없는 별표 **153건 중 위키가 입에 올리는 것은 8건**(쪽 9개)이고,
         그 8건을 한 줄씩 열어 보니 **전부 남의 법 별표를 가리키는 평범한 상호참조**였다
         (`「국가기술자격법 시행규칙」 별표2 비파괴검사분야 자격보유자` 꼴). 그중 2건은 **변경이력 줄**,
         1건은 내 패턴이 잘못 잡은 것이었다. **원문에 없는 내용을 실어 놓은 자리는 0 이다.**
    ⇒ 표시를 145자리에 붙이는 것은 **아무도 안 읽는 칸을 채우는 일**이다(L-375). 붙이지 않았다.
      대신 **수를 기준선으로 잠가** 늘면 사람이 한 번 보게 한다(아래 `--gate`).

쓰는 법: python3 byl_ref_gap.py [--list] [--all] [--gate]
  --gate  기준선(`baseline/byl_ref_gap.json`)보다 **늘면** 1 로 죽는다. 0 을 요구하지 않는다 —
          타부처는 결심 ⑫ⓒ 로 「두는 것」이고, 기준법 1 은 이 자가 아직 못 가리는 꼴이다
          (`영 제21조의2 및 별표 5의2` — 위 [한계] 참조).
"""
import os, re, sys, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
TIER = {'법률.txt': '법률', '시행령.txt': '시행령', '시행규칙.txt': '시행규칙'}
# 「별표 N」 뒤에 조사·서술이 붙어야 **가리킨 것**으로 본다.
REF = re.compile(r'별표\s*(\d+(?:의\d+)?)\s*(?:와|과|에|의|를|은|는|같다|에서|에\s*따)')
# ★다섯 번째로 틀렸던 자리 — **부칙·개정문 속 언급을 본문으로 셌다.**
#   `별표 14 및 별표 15를 각각 삭제한다` 는 **지운다는 말**이지 「여기 있다」는 말이 아니다.
#   그 탓에 없는 별표를 「미수집」으로 올릴 뻔했다(그 법의 별표는 1~9 뿐이다).
#   ⇒ 생산(`article_text.articleRegion`)과 같은 자리에서 자른다 — **첫 부칙 머리줄까지만** 본다.
ADDENDA = re.compile(r'\n[ \t]*\[?\s*부\s*칙')

# ★여섯 번째로 틀렸던 자리 — **남의 법 별표를 제 것으로 셌다.**
#   `「선박직원법 시행령」 별표 3에 따른` · `「출입국관리법 시행령」 별표 1의3에 따른` —
#   제 법 본문에 적혀 있지만 **그 별표의 임자는 남**이다. 그것까지 「우리가 안 받았다」로 세면
#   없는 결함이 생긴다(실제로 12건 중 대부분이 이것이었다).
OTHER = re.compile(r'(?:[」』]|법|령|규칙)\s*(?:시행령|시행규칙)?\s*$')
# ★일곱 번째·여덟 번째 — 같은 병이 두 꼴 더 있었다:
#   ⓐ `「수산업법 시행령」 제52조부터 제55조까지 **및 별표 10**` — 법 이름이 **멀리** 있다.
#      한 문장 안에 남의 법 이름이 있으면 그 문장의 별표는 남의 것으로 본다.
#   ⓑ `영 별표 6` — **시행규칙 본문에서 「영」은 시행령**이다. 계층이 다르면 제 것이 아니다.
OTHER_SENT = re.compile(r'[「『][^」』]{2,40}(?:법|령|규칙)[」』]')
TIER_WORD = re.compile(r'(?:^|[^가-힣])(영|법|규칙)\s*$')
# ⓒ `영 제21조의2 **및 별표 5의2**` — 계층어도 **멀리** 있다. 문장 안에 있으면 그 계층 것이다.
TIER_SENT = re.compile(r'(?:^|[^가-힣])(영|법)\s*제\s*\d')

def body_region(t):
    m = ADDENDA.search(t)
    return t[:m.start()] if m else t
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
                body = body_region(t)
                nums = set()
                for m in REF.finditer(body):
                    head = body[max(0, m.start() - 24):m.start()]
                    if OTHER.search(head) or TIER_WORD.search(head):
                        continue                       # 남의 법·남의 계층 별표다
                    # 같은 문장(앞 120자 안, 마침표 뒤부터)에 남의 법 이름이 있으면 그것도 남의 것
                    sent = body[max(0, m.start() - 120):m.start()]
                    sent = sent[sent.rfind('。') + 1:] if '。' in sent else sent
                    sent = sent[sent.rfind('\n') + 1:]
                    if OTHER_SENT.search(sent):
                        continue
                    # ⚠`TIER_SENT`(문장 안 `영 제N`)로도 걸러 봤지만 **과교정**이었다 —
                    #   시행령 본문의 `법 제10조 … 별표 3과 같다` 처럼 **제 별표를 말하는 문장**까지
                    #   빠져 분모가 563 → 172 로 주저앉았다. 그래서 쓰지 않는다.
                    #   ⇒ `영 제21조의2 및 별표 5의2` 같은 꼴은 **아직 못 가린다**(아래 [한계]).
                    nums.add(m.group(1))
                for num in sorted(nums):
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
    if '--gate' in sys.argv:
        return gate(rows)
    return 0


BASE = os.path.join(HERE, 'baseline', 'byl_ref_gap.json')


def gate(rows):
    """결심 ⑫ⓒ — 0 을 요구하지 않고 **늘지 않는 것**만 지킨다.

    까닭: 타부처 별표는 「받을 일감」이 아니라 「알고 두는 상태」다(결심 ⑫ⓒ).
      그러나 **아무도 안 세면 늘어도 모른다** — 그래서 수만 잠근다.
    ⚠이 자의 「없다」는 하나씩 열어 봐야 한다([한계] 참조). 그래서 **줄어도 통과**시킨다 —
      줄어든 것이 수리인지 자가 달라진 것인지 여기서는 못 가린다(L-383).
    """
    now = {g: sum(1 for r in rows if r['군'] == g and not r['있다'])
           for g in ('기준법', '타부처', '그밖')}
    if not os.path.exists(BASE):
        os.makedirs(os.path.dirname(BASE), exist_ok=True)
        with open(BASE, 'w', encoding='utf-8') as f:
            json.dump(now, f, ensure_ascii=False, indent=1)
        print(f'  기준선을 새로 적었다: {now}')
        return 0
    with open(BASE, encoding='utf-8') as f:
        base = json.load(f)
    bad = [(g, base.get(g, 0), n) for g, n in now.items() if n > base.get(g, 0)]
    for g, b, n in bad:
        print(f'  ❌ 늘었다  {g}  {b} → {n}')
    if bad:
        return 1
    print('  ✅ 늘지 않았다  ' + ' · '.join(f'{g} {n}(기준선 {base.get(g, 0)})'
                                        for g, n in now.items()))
    return 0

if __name__ == '__main__':
    sys.exit(main())
