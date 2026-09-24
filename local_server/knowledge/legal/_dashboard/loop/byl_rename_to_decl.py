# -*- coding: utf-8 -*-
"""별표 파일 **이름을 그 속이 말하는 번호에 맞춘다.** (3-34 = ⓒ 앞쪽)

무엇이 어긋났나 (실측 178개)
  파일 이름은 `별표18.txt` 인데 안에는 `[별표 18의2]` 가 들어 있다 —
  수집할 때 **가지번호 「의M」이 떨어진** 것이다.
  ⇒ 챗봇이 「별표18」을 물으면 **18의2 내용**을 보게 되고, 진짜 별표18 은 어디에도 없다.

무엇을 재고 나서 하나 (넘겨짚지 않는다)
  · **도메인**: 177개가 `15_관련타부처`(타법 발췌), 1개가 해양환경관리법.
  · **부딪힘**: 내용 번호 파일이 **이미 있는 것 1개** — 그건 손대지 않고 사람에게 넘긴다.
  · **위키가 파일명 번호를 짚나**: 전수 검색 결과 **0개**. 그래서 이름을 고쳐도
    **깨지는 인용이 없다.** 반대로 내용 번호를 짚는 인용이 있으면 **살아난다.**

무엇을 안 하나
  ★**「진짜 별표N」을 다시 받는 일은 이 도구가 하지 않는다.** 재 보니 그 번호를 **짚는 곳이
    하나도 없다** — 읽는 곳이 없는 자료를 채우는 것은 죽은 데이터다(L-375).
    받을지는 사람이 정한다(3-34 뒤쪽).
  ★내용은 **한 글자도 안 건드린다.** `git mv` 로 자리만 옮긴다.

[연계] ← `_dashboard/loop/byl_bare_ready.js --list 번호어긋남`
        → `raw/**/별표/<내용번호>.txt` (git mv)
사용법: python3 byl_rename_to_decl.py [--apply]
"""
import os, re, sys, subprocess, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.dirname(os.path.dirname(HERE))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(LEGAL)))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, HERE)
from _touched import Touched                                      # noqa: E402

ROW = re.compile(r'^(\S+)\s+파일명=(\S+)\s+내용=(\S+)\s*$')


def rows():
    p = subprocess.run(['node', os.path.join(HERE, 'byl_bare_ready.js'), '--list', '번호어긋남'],
                       capture_output=True, text=True, cwd=LEGAL)
    out = []
    for ln in p.stdout.split('\n'):
        m = ROW.match(ln.strip())
        if m:
            out.append(m.groups())
    return out


def main():
    apply_ = '--apply' in sys.argv
    touched = Touched('byl_rename_to_decl') if apply_ else None
    tally = collections.Counter()
    plan, hold = [], []
    for rel, fname, cname in rows():
        src = os.path.join(RAW, rel)
        dst = os.path.join(os.path.dirname(src), cname + '.txt')
        if not os.path.exists(src):
            tally['원본이 없다'] += 1; continue
        if os.path.exists(dst):
            tally['★부딪힘 — 사람이 정한다'] += 1
            hold.append((rel, f'{cname}.txt 가 **이미 있다** — 어느 쪽이 참인지 사람이 정한다'))
            continue
        plan.append((rel, fname, cname, src, dst))
        tally['이름을 고친다'] += 1
    print('=== 이름을 고친다 (내용이 말하는 번호로) ===')
    for rel, fname, cname, _s, _d in plan[:12]:
        print(f'  ✅ {rel:64s} {fname} → {cname}')
    if len(plan) > 12:
        print(f'  … 그 밖 {len(plan) - 12}개')
    if hold:
        print('\n=== 사람이 정해야 하는 것 (G-34) ===')
        for rel, why in hold:
            print(f'  ⬜ {rel}\n       {why}')
    print()
    for k in sorted(tally):
        print(f'  {k:28s} {tally[k]}')
    if apply_:
        for _rel, _f, _c, src, dst in plan:
            subprocess.run(['git', 'mv', src, dst], cwd=REPO, check=True)
            # ⚠`Touched.add()` 는 **cwd 기준**으로 abspath 한다 — 저장소 기준 경로를 넘기면
            #   `…legal/local_server/knowledge/legal/raw/…` 로 **두 번 겹쳐** 기록이 무효가 된다
            #   (실측 2026-09-24: 그 때문에 raw_touch_guard 가 58→220 으로 빨간불을 냈다).
            #   **절대경로를 넘긴다.**
            touched.add(dst)
        touched.save()
        print(f'\n  → git mv {len(plan)}개 (내용은 한 글자도 안 건드렸다)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
