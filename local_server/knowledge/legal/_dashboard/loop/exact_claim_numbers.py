#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""인용 없이 「원문과 EXACT 일치」라고만 적은 주장을 **숫자로** 다시 맞춰 본다. (G-29 · 3-33)

[왜 이 자가 필요한가]
  `exact_claim_recheck.py` 는 **따옴표 인용이 있는 주장**만 잰다. 인용이 없는 **425줄**은
  「잴 수 없음」으로 두고 게이트가 늘지 못하게만 막아 두었다(V5-43).
  그런데 실측해 보니 그 425줄 중 **394줄은 무엇과 대조했다는지 원문을 짚을 수 있다** —
  *"raw 시행규칙_별표3.txt 원문과 EXACT 일치"* 처럼 파일은 말하면서 **인용만 없다.**
  ⇒ 인용이 없어도 **숫자는 맞춰 볼 수 있다.** 2라운드가 네 벌 모두에서 얻은 결론이
    *"돈·형량 같은 수치는 거의 정확하고, 흐트러지는 것은 조건·단서·괄호"* 였으므로,
    숫자가 어긋나면 그것은 **드문 만큼 무거운 신호**다.

[세는 법 — 무엇을 숫자로 보나]
  · **단위가 붙은 수만** 본다: 원·만원·억·년·월·일·개월·시간·분·톤·미터·m·km·%·배·회·명·인·세·kW
  · **빼는 것**: 조문 번호(제N조·항·호·목) · 날짜(2026-09-24·2026. 9. 24.) · 법령 번호 ·
    전화번호 · 별표 번호. 이것들은 「수치」가 아니라 **이름**이다.
  · 맞았다고 보는 것: 공백을 지운 원문 안에 그 수와 단위가 **붙어서** 있다.
    (`1천만원` ↔ `1,000만원` 처럼 적는 꼴이 달라 못 찾는 것이 있다 — 그래서
     **「없다」를 오류라고 말하지 않는다.** 사람이 볼 후보로만 낸다.)

⚠**이 자는 판정자가 아니다.** 「없다」가 곧 오기는 아니다 — 적는 꼴 차이·다른 법 인용·
  우리 계산값이 섞인다. 그래서 게이트로 삼지 않고 **후보 목록**만 낸다(3-33 과 같은 태도).

쓰는 법: python3 exact_claim_numbers.py [--list] [--save <파일>]
"""
import os, re, sys, json, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exact_claim_recheck as E          # ★주장 고르기·원문 모으기는 그 자를 그대로 쓴다(L-136)

UNIT = r'(?:원|만원|억원|억|년|개월|월|일|시간|분|톤|미터|m|km|%|퍼센트|배|회|명|인|세|kW|마력|노트)'
NUM = re.compile(r'(\d[\d,]*(?:\.\d+)?)\s*(' + UNIT + r')')
DROP_CTX = re.compile(r'제\s*$|별표\s*$|별지\s*$|호\s*$')
DATE = re.compile(r'20\d\d[.\-\s년]')

# ★첫 판이 34.5%를 「원문에 없다」로 냈다 — 재 보니 **내 자가 작업 기록을 법 수치로 셌다.**
#   `28회차 백로그`·`1982년(UNCLOS)`·`#8, 2026-08-16 재검증` 같은 것들이다.
#   ⇒ 세는 자리를 **법을 말하는 본문**으로 좁힌다. 2라운드 실측(수치는 910개 중 1개만 어긋남)과
#     자릿수가 맞아야 이 자를 믿을 수 있다.
WORKLOG = re.compile(r'백로그|라운드|회차|재검증|감사|승급|패스|커밋|세션|점검표|검토자|W\d+-\d+|P\d+-\d+|#\d+')
YEARISH = re.compile(r'^(19|20)\d\d$')

def body_only(text):
    """법을 말하는 본문만 — 「변경 이력」 아래와 작업 기록 줄은 뺀다."""
    out = []
    for line in text.split('\n'):
        if re.match(r'^#{2,3}\s*변경\s*이력', line):
            break                                   # 변경 이력부터 끝까지는 작업 기록이다
        if WORKLOG.search(line):
            continue                                # 한 줄짜리 작업 기록도 뺀다
        out.append(line)
    return '\n'.join(out)

def numbers(text):
    """그 쪽이 말하는 **법 수치** — (수, 단위) 짝."""
    out = []
    for m in NUM.finditer(text):
        head = text[max(0, m.start() - 6):m.start()]
        if DROP_CTX.search(head):
            continue
        n, u = m.group(1).replace(',', ''), m.group(2)
        if u == '년' and YEARISH.match(n):
            continue                                # 1982년 = 연도이지 기간이 아니다
        if u in ('년', '월', '일') and DATE.search(text[max(0, m.start() - 8):m.end() + 2]):
            continue
        if u == '회' and re.search(r'회차', text[m.start():m.end() + 3]):
            continue                                # 「28회차」는 우리 작업 번호다
        out.append((n, u))
    return out

def main():
    lmap, cache = E.law_map(), {}
    tot = collections.Counter()
    rows = []
    for page, ln, text in E.claims():
        quotes = [q for q in (a or b for a, b in E.QUOTE.findall(text)) if len(q) >= 8]
        quotes = [q for q in quotes if not E.OURS.search(q)]
        if quotes:
            continue                                   # 인용이 있는 주장은 V5-43 소관
        pool = E.raw_pool(page, text, lmap, cache)
        if not pool:
            tot['원문 못 찾음'] += 1
            continue
        body = body_only(open(page, encoding='utf-8').read())
        nums = numbers(body)
        if not nums:
            tot['숫자가 없다'] += 1
            continue
        # ★세 번째로 틀렸던 자리 — **쉼표를 한쪽에서만 뗐다.**
        #   위키는 `1,100만원`, 내 `numbers()` 는 `1100만원` 으로 바꿔 놓고
        #   원문 쪽은 `1,100만원` 그대로 뒤졌다. 그러니 있는 것도 「없다」가 됐다.
        #   ⇒ **양쪽 다** 쉼표를 뗀 판으로 견준다.
        # ★네 번째로 틀렸던 자리 — **원문 표는 단위를 머리말에 한 번만 적는다.**
        #   `(단위: 만원)` 이라 적고 칸에는 `120` 만 쓴다. 위키는 `120만원` 이라 쓴다.
        #   그래서 있는 값이 「없다」로 나왔다. ⇒ 그런 표를 가진 원문에서는 **맨 수도** 맞다고 본다.
        bodies = [b.replace(',', '').replace('，', '') for _a, b in pool]
        unit_head = {u for b in bodies for u in re.findall(r'단위[:：]\s*(만원|원|톤|미터|m|일|시간|%)', b)}
        miss = []
        for n, u in dict.fromkeys(nums):
            flat = E.flat(n + u).replace(',', '')
            hit = any(flat in b for b in bodies)
            if not hit and u in unit_head:           # 단위를 머리말에 적은 표 — 맨 수로 찾는다
                hit = any(re.search(r'(?<![0-9])' + re.escape(n) + r'(?![0-9])', b) for b in bodies)
            if not hit:
                miss.append(n + u)
        # ★「없다」를 한 덩이로 두면 고치러 갈 수가 없다 — **어디에도 없나, 남의 법에 있나**로 가른다.
        #   남의 법에 있으면 그건 **내 자가 좁은 것**(그 쪽이 타법을 인용한 것)이고,
        #   어디에도 없으면 **우리 계산값이거나, 원문을 아직 안 받은 것**이다 — 뒤가 무겁다.
        elsewhere = []
        if miss:
            wide = [b.replace(',', '') for _a, b in E.wide_pool()]
            for t in list(miss):
                if any(E.flat(t).replace(',', '') in b for b in wide):
                    elsewhere.append(t)
            miss = [t for t in miss if t not in elsewhere]
        tot['남의 법에 있다'] += len(elsewhere)
        tot['잰 주장'] += 1
        tot['잰 숫자'] += len(dict.fromkeys(nums))
        tot['어디에도 없다'] += len(miss)
        if miss:
            rows.append({'쪽': os.path.relpath(page, E.LEGAL), '줄': ln,
                         '숫자': len(dict.fromkeys(nums)), '없는것': miss[:12]})
    rows.sort(key=lambda r: -len(r['없는것']))
    print(f"인용 없는 EXACT 주장 중 **숫자로 다시 맞춰 본 것** {tot['잰 주장']}줄")
    print(f"  · 원문 못 찾음   {tot['원문 못 찾음']}")
    print(f"  · 숫자가 없다    {tot['숫자가 없다']}")
    print(f"  · 잰 숫자        {tot['잰 숫자']}")
    print(f"  · 제 법 원문엔 없지만 **남의 법 raw 에 있다** {tot['남의 법에 있다']}"
          f"  ({100 * tot['남의 법에 있다'] / tot['잰 숫자']:.1f}%) — 그 쪽이 타법을 인용한 것이다")
    print(f"  · ⚠**어디에도 없다** {tot['어디에도 없다']}"
          f"  ({100 * tot['어디에도 없다'] / tot['잰 숫자']:.1f}%)  — 우리 계산값이거나 **원문을 아직 안 받은 것**")
    print(f"  · 못 찾은 숫자가 있는 쪽 {len(rows)}")
    if '--list' in sys.argv:
        for r in rows[:25]:
            print(f"   · {r['쪽']}:{r['줄']}  숫자 {r['숫자']}개 중 {len(r['없는것'])}개 — {', '.join(r['없는것'][:8])}")
    if '--save' in sys.argv:
        out = os.path.join(HERE, '..', 'exact_claim_numbers.json')
        json.dump(rows, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('  저장:', out)
    return 0

if __name__ == '__main__':
    sys.exit(main())
