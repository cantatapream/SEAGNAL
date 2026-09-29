#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""**글자 하나씩 한 줄로 쪼개져 저장된 raw** 를 다시 잇는다. (3-36 · 확인판 B4 ⓐ · 2026-09-29)

[무엇이 문제였나]
  V5-20(`col_split_scan.js`)이 「표가 열 단위로 펼쳐진 덩이」로 세던 83덩이 가운데 **별표 폴더의 29파일은 표가 아니었다.**
  열어 보니 `[별지 제10호서식] 삭제` 같은 **짧은 글이 글자 하나씩 한 줄**로 들어 있다.
  API 의 `별표내용` 이 **문자열**인 응답을 수집기가 리스트로 착각해 글자마다 줄을 바꾼 것이다
  (`admrul_fill_annex.py` `body_rows` 주석 — 2026-09-25 에 같은 뿌리를 12파일에서 잡고 고쳤다.
  이 29파일은 그보다 앞선 **2026-08-31 수집분**이라 그때 쓸기에서 빠졌다).

[왜 짐작이 아닌가 — 되돌리기가 **정확히** 정해진다]
  `'\\n'.join(list(s))` 로 쓰인 글은 **홀수 자리가 전부 줄바꿈**이다. 그러면 원래 글은 `본문[0::2]` 하나뿐이다
  (원래 글에 줄바꿈이 있었어도 같은 식으로 되돌아온다). 이 꼴을 **한 글자도 어기지 않는 파일만** 고친다.

[증명 — 하나라도 못 넘으면 쓰지 않는다]
  ① 본문의 홀수 자리가 전부 `\\n` 이다(쪼개진 꼴이 맞다)
  ② 이은 글을 다시 `'\\n'.join(list(·))` 하면 **옛 본문과 한 글자도 다르지 않다**(잃은 것·지은 것 0)
  ③ 쓴 뒤 다시 읽어 증명한 글과 같다
  ④ 이은 글이 **별표 머리꼴**(`[별…` `〔별…` `■ …` `<…`)로 시작한다 — 한 줄에 한 값씩 적힌 **진짜 열**
     (예: 숫자 `1 2 3 …` 가 한 줄씩)은 ①②를 똑같이 넘기 때문에, 이 자가 없으면 그것을 붙여 망가뜨린다

[머리말] 첫 빈 줄 앞까지(`[…] 별지N — …` · `출처: …` · 링크)는 **우리가 붙인 것**이라 그대로 두고,
  한 줄을 **덧붙인다**(옛 줄을 지우지 않는다).

쓰는 법:
    python3 _dashboard/loop/char_split_join.py            # 마른 실행 — 재기만 한다
    python3 _dashboard/loop/char_split_join.py --apply    # 증명을 넘은 것만 쓴다

[연계] ← V5-20 `col_split_scan.js --list` · `admrul_fill_annex.py`(같은 뿌리 · 수집 쪽은 이미 고쳐짐)
        → `raw/**/별표/*.txt` · `_touched.py`(되돌리기) · `_dashboard/char_split_join.json`(보고)
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
REPORT = os.path.join(LEGAL, '_dashboard', 'char_split_join.json')
sys.path.insert(0, HERE)
APPLY = '--apply' in sys.argv
RUN_MIN = 12           # 본문 안 덩이: 한 글자짜리 줄이 이만큼 이어져야 본다
MIN_CHARS = 6          # 이보다 짧은 본문은 우연히 꼴이 맞을 수 있다 — 건드리지 않는다


def split_head(t):
    L = t.split('\n')
    for i, l in enumerate(L[:12]):
        if not l.strip():
            return L[:i], '\n'.join(L[i + 1:])
    return None, None


def main():
    from _touched import Touched
    touched = Touched('char_split_join') if APPLY else None
    rep = {'언제': time.strftime('%Y-%m-%d %H:%M'), '고침': [], '꼴아님': 0}
    for root, _, files in os.walk(RAW):
        if os.sep + '별표' not in root:
            continue
        for fn in sorted(files):
            if not fn.endswith('.txt'):
                continue
            p = os.path.join(root, fn)
            t = open(p, encoding='utf-8').read()
            head, body = split_head(t)
            if head is None:
                continue
            body = body.rstrip('\n')
            if len(body) < 2 * MIN_CHARS:
                continue
            # ① 홀수 자리가 전부 줄바꿈
            if any(body[k] != '\n' for k in range(1, len(body), 2)):
                rep['꼴아님'] += 1
                continue
            s = body[0::2]
            # ② 되쪼개면 옛 본문과 같다
            if '\n'.join(list(s)) != body:
                print('  ❌', os.path.relpath(p, LEGAL), '— 되쪼갠 글이 옛 본문과 다르다')
                continue
            # ④ 별표 머리꼴 — 진짜 한 값씩 열을 잇지 않는다
            if not re.match(r'^\s*(■|\[|〔|<)', s):
                print('  ⏭️ ', os.path.relpath(p, LEGAL), '— 이은 글이 별표 머리꼴이 아니다(진짜 열일 수 있다) — 건드리지 않는다')
                continue
            note = ('★%s 글자 하나씩 한 줄로 쪼개져 있던 본문을 이었다 — 수집기가 문자열 `별표내용` 을 '
                    '리스트로 착각한 탓(`admrul_fill_annex.py` body_rows 주석). 글자는 하나도 바꾸지 않았다 '
                    '(되쪼개면 옛 본문과 같다 — `char_split_join.py`). ※API 가 준 본문은 이 한 줄뿐이다 — '
                    '삭제된 별표이거나, 내용이 위 첨부(그림·서식)에만 있다.' % time.strftime('%Y-%m-%d'))
            new = '\n'.join(head + [note, '']) + '\n' + s.strip() + '\n'
            rel = os.path.relpath(p, LEGAL)
            print('  ✅ %-80s %3d줄 → %s' % (rel[:80], body.count('\n') + 1, repr(s.strip())[:60]))
            rep['고침'].append({'쪽': rel, '옛줄': body.count('\n') + 1, '글': s.strip()})
            if APPLY:
                open(p, 'w', encoding='utf-8').write(new)
                touched.add(p)
                if open(p, encoding='utf-8').read() != new:      # ③
                    print('     ❌ 쓴 뒤 다시 읽은 글이 다르다')
    # ── 둘째 길: 본문 파일 **안에** 끼어 든 쪼개진 덩이 ─────────────────────────────
    #   행정규칙 본문 끝에 붙은 별지·별표 머리가 같은 까닭으로 한 글자씩 들어온 자리가 있다
    #   (예: 수산관계법령 위반행위 처분 규칙 — `■ 수산관계법령 … [별지 제1호서식] 삭제 <2024. 11. 1.>`).
    #   한 글자짜리 줄이 RUN_MIN 줄 넘게 이어지고, 이은 글이 **별표 머리꼴**일 때만 한 줄로 잇는다(④와 같은 자).
    #   원래 글의 줄바꿈은 빈 줄로 남으므로 덩이가 거기서 끊긴다 — 줄바꿈을 지어내지 않는다.
    rep['본문안'] = []
    for root, _, files in os.walk(RAW):
        for fn in sorted(files):
            if not fn.endswith('.txt'):
                continue
            p = os.path.join(root, fn)
            L = open(p, encoding='utf-8').read().split('\n')
            out, i, hit = [], 0, []
            while i < len(L):
                j = i
                while j < len(L) and len(L[j]) == 1:
                    j += 1
                if j - i >= RUN_MIN:
                    s = ''.join(L[i:j])
                    if re.match(r'^\s*(■|\[|〔|<)', s) and len(s.strip()) >= RUN_MIN:
                        out.append(s.strip() + '  ⟪★%s 한 글자씩 %d줄로 쪼개져 있던 것을 이었다 — char_split_join.py⟫'
                                   % (time.strftime('%Y-%m-%d'), j - i))
                        hit.append((i + 1, j - i, s.strip()))
                        i = j
                        continue
                out.extend(L[i:j] if j > i else [L[i]])
                i = j if j > i else i + 1
            if not hit:
                continue
            rel = os.path.relpath(p, LEGAL)
            for at, n, s in hit:
                print('  ✅ %s:%d  %d줄 → %s' % (rel[:70], at, n, repr(s)[:70]))
                rep['본문안'].append({'쪽': rel, '줄': at, '옛줄': n, '글': s})
            if APPLY:
                new = '\n'.join(out)
                open(p, 'w', encoding='utf-8').write(new)
                touched.add(p)
    print('\n  고친 것 %d%s · 쪼개진 꼴이 아닌 별표 %d · 본문 안 덩이 %d'
          % (len(rep['고침']), '' if APPLY else '(마른 실행)', rep['꼴아님'], len(rep['본문안'])))
    if APPLY:
        touched.save()
        if os.path.exists(REPORT):              # 앞선 실행이 고친 것을 잃지 않는다(다시 돌리면 고칠 것이 0 이다)
            old = json.load(open(REPORT, encoding='utf-8'))
            seen = {x['쪽'] for x in rep['고침']}
            rep['고침'] = [x for x in old.get('고침', []) if x['쪽'] not in seen] + rep['고침']
            seen = {(x['쪽'], x['줄']) for x in rep['본문안']}
            rep['본문안'] = [x for x in old.get('본문안', []) if (x['쪽'], x['줄']) not in seen] + rep['본문안']
        json.dump(rep, open(REPORT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
