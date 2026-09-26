#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""raw 를 다시 받아 글자가 바뀌면, **그 원문을 인용해 둔 나무(tree)의 인용문이 낡는다.**
   그 인용을 **새 원문에서 같은 대목으로 다시 떠 온다**(3-68·3-36 뒤처리).

[무엇이 문제였나 — 2026-09-26 실측]
  3-68 이 선박전기설비기준 raw 를 HWPX 로 다시 받자 `test_zone_tree_wiring` 이 **빨간불**이 됐다:
      ❌ 인용 217건 — 단서 무단 절단 0건 [ 원문불일치 …선박전기설비기준.txt 제18조 · 제133조 · … ]
  까닭은 나무의 인용문이 **옛 PDF 전사본의 낱말 갈라짐을 그대로 담고 있었기** 때문이다 —
      「축전지 2조 로」 · 「국내항 해에」 · 「기관구역무 인화선박」 · 「항해구역으 로」.
  새 원문에는 그 낱말이 **붙어 있다.** 그래서 글자 그대로는 안 맞는다.
  ⚠**raw 를 되돌리거나 시험을 느슨하게 하지 않는다.** 위키·나무가 낡은 것이므로 그쪽을 고친다.

[어떻게 — 지어내지 않는다]
  ①인용에서 **흰칸을 전부 뺀** 글자열을 만든다.
  ②그 조문 본문에서도 흰칸을 뺀 글자열을 만들고 **그 자리를 찾는다.**
  ③찾으면 **새 원문의 그 자리를 글자 그대로** 잘라 새 인용으로 쓴다(내가 짓지 않는다).
  ④못 찾으면 **손대지 않고 적는다** — 사람이 본다. 「비슷한 것」으로 바꾸지 않는다.
  ⑤앞의 `… ` 와 뒤의 `…`(정직한 절단 표시)는 그대로 둔다.

쓰는 법:
    python3 _dashboard/loop/tree_cite_requote.py            # 무엇을 바꿀지만 보여 준다
    python3 _dashboard/loop/tree_cite_requote.py --apply    # 실제로 고친다
    python3 _dashboard/loop/tree_cite_requote.py --only 선박전기설비기준

[연계] → `_dashboard/zone_tree.json` · ← `_touched.py`
        ← 빨간불을 내는 자: `local_server/scripts/test_zone_tree_wiring.js`
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _touched import Touched                                        # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
TREE = os.path.join(LEGAL, '_dashboard', 'zone_tree.json')
APPLY = '--apply' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None


def 조구역(txt, 파일, 단위):
    """시험(`test_zone_tree_wiring.js`)의 `unitSpan` 과 **같은 규칙**으로 조 구역을 찾는다.
    둘이 갈리면 여기서 고친 것이 시험에서 또 틀린다."""
    if '/행정규칙/' not in 파일:
        m = re.search(r'제\d+조(?:의\d+)?', 단위)
        if not m:
            return None
        art = m.group(0)
        s = re.search(r'(?m)^\[' + re.escape(art) + r'\]', txt)
        if not s:
            return None
        뒤 = txt[s.start() + len(art):]
        e = re.search(r'(?m)^\[제\d+조', 뒤)
        return (s.start(), s.start() + len(art) + (e.start() if e else len(뒤)))
    heads, off = [], 0
    for line in txt.split('\n'):
        t = line.strip()
        m = re.match(r'^제(\d+)조(?:의(\d+))?\s*\(', t)
        b = re.search(r'\[별표\s?(\d+)\]\s*$', t)
        if m:
            heads.append(('제' + m.group(1) + '조' + ('의' + m.group(2) if m.group(2) else ''), off))
        elif b:
            heads.append(('별표 ' + b.group(1), off))
        off += len(line) + 1
    for i, h in enumerate(heads):
        if h[0] == 단위:
            return (h[1], heads[i + 1][1] if i + 1 < len(heads) else len(txt))
    return None


def 납작(t):
    return re.sub(r'<img[^>]*>|</img>', ' ', t).replace('\n', ' ')


def main():
    d = json.load(open(TREE, encoding='utf-8'))
    줄 = []

    def 걷기(n):
        if isinstance(n, dict):
            for k in ('적용', 'provenance'):
                for r in (n.get(k) or []):
                    줄.append(r)
            for v in n.values():
                걷기(v)
        elif isinstance(n, list):
            for v in n:
                걷기(v)
    걷기(d)

    고친것, 못한것, 멀쩡 = [], [], 0
    for r in 줄:
        파일 = r.get('파일') or ''
        단위 = r.get('근거조문') or r.get('조문') or ''
        인용 = r.get('인용') or ''
        if not (파일 and 단위 and 인용):
            continue
        if ONLY and ONLY not in 파일:
            continue
        p = os.path.join(LEGAL, 파일)
        if not os.path.exists(p):
            continue
        txt = open(p, encoding='utf-8').read()
        span = 조구역(txt, 파일, 단위)
        if not span:
            못한것.append((파일, 단위, '그 조를 못 찾았다'))
            continue
        본문 = txt[span[0]:span[1]]
        평 = re.sub(r'\s+', ' ', 납작(본문)).strip()
        앞 = '… ' if 인용.startswith('… ') else ''
        q = 인용[2:] if 앞 else 인용
        if q.endswith('…'):
            continue                                   # 정직한 절단 표시 — 시험도 건너뛴다
        if q in 평:
            멀쩡 += 1
            continue
        # ★흰칸을 뺀 자리로 찾는다 — PDF 가 낱말 가운데 넣은 공백 탓이다
        쓴 = [i for i, ch in enumerate(본문) if not ch.isspace()]
        본압 = ''.join(본문[i] for i in 쓴)
        q압 = re.sub(r'\s', '', q)
        i = 본압.find(q압)
        if i < 0:
            못한것.append((파일, 단위, '새 원문에 그 대목이 없다 — 사람이 본다'))
            continue
        새인용 = re.sub(r'\s+', ' ', 본문[쓴[i]:쓴[i + len(q압) - 1] + 1]).strip()
        if 새인용 == q:
            멀쩡 += 1
            continue
        고친것.append((파일, 단위, q, 새인용))
        if APPLY:
            r['인용'] = 앞 + 새인용
            r.setdefault('_인용_다시뜬날', '2026-09-26')
            r.setdefault('_옛인용', q)                 # 지우지 않는다 — 무엇이 바뀌었는지 남긴다

    print('  ── 나무 인용 다시 뜨기 (%s) ──' % ('실제로 고쳤다' if APPLY else '마른 실행'))
    print('  멀쩡 %d · 다시 뜬 것 %d · 못한 것 %d' % (멀쩡, len(고친것), len(못한것)))
    for 파일, 단위, 옛, 새 in 고친것[:12]:
        print('  ✅ %s %s' % (os.path.basename(파일), 단위))
        print('       옛: %s' % 옛[:100])
        print('       새: %s' % 새[:100])
    for 파일, 단위, 까닭 in 못한것[:12]:
        print('  ❌ %s %s — %s' % (os.path.basename(파일), 단위, 까닭))
    if APPLY and 고친것:
        t = Touched('tree_cite_requote')
        json.dump(d, open(TREE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        t.add(TREE)
        t.save()
    return 0 if not 못한것 else 1


if __name__ == '__main__':
    sys.exit(main())
