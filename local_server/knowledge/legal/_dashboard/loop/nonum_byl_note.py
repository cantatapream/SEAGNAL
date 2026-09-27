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
import json, os, sys
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


# ★이름이 `1` 인데 원문에는 번호가 없는 자리 (2026-09-26, 3-67).
#   위 `NOTE` 는 **이름이 `0` 인 파일**에 붙이는 말이라 여기엔 맞지 않는다 —
#   이 파일들은 이름이 **번호가 있는 척**하고 있기 때문이다. 그 사실을 그대로 적는다.
NOTE_FAKE = ('주의: ★**원문에 이 별표의 번호가 없다.** 원문 선언줄이 `[별표]` 처럼 번호 없이 '
             '적혀 있고 제공처 API 도 `별표번호: "0000"` 을 준다. ⚠**그런데 이 파일의 이름에 붙은 '
             '번호는 원문의 번호가 아니다** — 수집 도구가 번호가 없을 때 `1` 을 넣던 자리다'
             '(2026-09-26 에 도구는 `0` 으로 고쳤고, 이미 만들어진 이 이름은 아직 그대로다). '
             '번호를 우리가 지어 붙이지 않는다(2026-09-24 결심 ⑥ⓑ · 환각 0).')

# ★판정은 **생산 함수**가 한다 — `nonum_byl_scan.js` 가 `article_text.bylDeclLine()`·
#   `parseBylDecl()` 로 골라 낸 목록을 읽어 쓴다(규칙을 파이썬에 다시 적지 않는다, L-136).
FROM = ''
for i, a_ in enumerate(sys.argv):
    if a_ == '--from' and i + 1 < len(sys.argv):
        FROM = sys.argv[i + 1]


def targets():
    out = []
    for root, dirs, files in os.walk(RAW):
        dirs[:] = [d for d in dirs if d != '_대기']
        for f in sorted(files):
            if f.endswith('별표0.txt') or f.endswith('서식0.txt'):
                out.append(os.path.join(root, f))
    return sorted(out)


def fake_targets():
    """`--from <scan.json>` 으로 받은 「이름은 번호를 달았는데 원문엔 없다」 목록."""
    if not FROM:
        return []
    d = json.load(open(FROM, encoding='utf-8'))
    names = {r['파일'] for r in d.get('진짜무번호', [])}
    out = []
    for root, dirs, files in os.walk(RAW):
        dirs[:] = [d_ for d_ in dirs if d_ != '_대기']
        for f in sorted(files):
            if f in names:
                out.append(os.path.join(root, f))
    return sorted(out)


def main():
    touched = Touched('nonum_byl_note.py')
    n = skip = 0
    일감 = [(p, NOTE) for p in targets()] + [(p, NOTE_FAKE) for p in fake_targets()]
    for p, note in 일감:
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
        lines.insert(at, note)
        print('▣', os.path.relpath(p, RAW))
        if APPLY:
            open(p, 'w', encoding='utf-8').write('\n'.join(lines))
            touched.add(p); n += 1
    if APPLY:
        touched.save()
        print(f'\n적은 파일 {n}개 · 이미 적혀 있던 것 {skip}개')
    else:
        print(f'\n적을 파일 {len(일감) - skip}개 (미리보기다. 적용하려면 --apply)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
