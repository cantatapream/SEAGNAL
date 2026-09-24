#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-54 뒤쪽 (결심 ⑥ⓑ) — **번호 없는 별표에 「원문에 번호가 없다」고 적는다.**

[결심] 2026-09-24 사장님 ⓑ — *`0` 그대로 두고 「원문에 번호가 없다」고 적는다.*

[무엇이 문제였나]
  별표 파일 이름이 `별표0.txt`·`서식0.txt` 인 것이 있다. 제공처 API 가 `별표번호: "0000"` 을
  주기 때문인데, 이름만 보면 **수집기가 고장 나서 0을 박은 것처럼 보인다.**
  ★그래서 「1부터 다시 매기자」는 말이 되풀이 올라왔다. 그것은 **원문에 없는 번호를 우리가
  지어내는 것**이라 환각 0 위반이다.

[재어 보고 적는다 — 짐작하지 않는다]
  ★**39개 전부** `bylDeclLine()` 이 선언줄을 못 찾는다(2026-09-24 전수 실측).
    곧 `■ … [별표 3]` 같은 **번호를 밝히는 줄이 원문 어디에도 없다.**
    그 문서에 별표가 하나뿐이라 원문이 번호를 안 붙인 것이다.
  ⚠종전 기록에 「24개」라고 적혀 있었는데 그것은 **선언줄까지 없는 부분집합**이었다.
    지금 자로 다시 세면 **39개**다. 옛 숫자를 지우지 않고 여기 정정해 둔다.

[무엇을 적나]
  파일 머리에 한 줄을 더한다 — **반드시 한 줄로.** 들여쓴 이어짐 줄을 쓰면
  `bylBodyKind()` 가 그 줄을 본문으로 세어 갈래가 뒤집힌다(2026-09-24 에 하루 두 번 겪었다).

[연계] → `_SCHEMA.md` §6-G 앞 「증보 2026-09-24 결심 ⑥」
사용법: python3 nonum_byl_note.py [--apply]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
APPLY = '--apply' in sys.argv

# ★머리말 이름은 **`주의:`** 여야 한다. `주의(번호):` 처럼 괄호를 붙였더니 `BYL_META_RE` 가
#   못 알아봐 이 줄이 **본문 글로 세어졌고**, 「삭제뿐인 별표」 2개가 「글이 있다」로 뒤집혔다
#   (2026-09-24 실측 — 오늘 이 병만 세 번째다).
NOTE = ('주의: ★**원문에 이 별표의 번호가 없다.** 그 문서에 별표가 하나뿐이라 원문이 번호를 '
        '안 붙였고, 제공처 API 도 `별표번호: "0000"` 을 준다. 파일 이름의 `0` 은 **수집 실수가 아니라 '
        '그 사실의 표시**다. 번호를 우리가 지어 붙이지 않는다(2026-09-24 결심 ⑥ⓑ · 환각 0).')


def targets():
    out = []
    for root, dirs, files in os.walk(RAW):
        dirs[:] = [d for d in dirs if d != '_대기']
        for f in sorted(files):
            if f.endswith('별표0.txt') or f.endswith('서식0.txt'):
                out.append(os.path.join(root, f))
    return sorted(out)


def main():
    touched = Touched('nonum_byl_note.py')
    n = skip = 0
    for p in targets():
        txt = open(p, encoding='utf-8').read()
        if '원문에 이 별표의 번호가 없다' in txt:
            skip += 1
            continue
        lines = txt.split('\n')
        # 머리(제목·출처·주의…) 다음에 끼운다 — 본문 한가운데 넣지 않는다
        at = 1
        while at < len(lines) and lines[at].strip() and (
                lines[at].startswith(('출처:', '주의', '고시명:', '법령명:', 'ID:', '별표서식', '첨부'))):
            at += 1
        lines.insert(at, NOTE)
        print('▣', os.path.relpath(p, RAW))
        if APPLY:
            open(p, 'w', encoding='utf-8').write('\n'.join(lines))
            touched.add(p); n += 1
    if APPLY:
        touched.save()
        print(f'\n적은 파일 {n}개 · 이미 적혀 있던 것 {skip}개')
    else:
        print(f'\n적을 파일 {len(targets()) - skip}개 (미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
