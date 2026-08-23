#!/usr/bin/env python3
"""고쳐진 이미지 판독본(sidecar)을 원문 안의 【이미지판독】 블록에 다시 반영한다.

왜 필요한가:
  merge_byl_ocr.py 는 이미 삽입된 【이미지판독 N】 블록을 건너뛴다(재실행 안전을 위해서다).
  그래서 나중에 sidecar 를 고쳐도 원문은 옛 판독본을 계속 들고 있게 된다.
  2026-08-23 재확인에서 "500미터 → 50미터", "연속되지 않는 → 연속되어 있는"(의미가 정반대)
  같은 수정이 나왔는데, 이 스크립트가 없으면 그 수정이 원문에 닿지 않는다.

어떻게 하나 — 경계를 추정하지 않는다
  ★첫 판(2026-08-23)은 블록의 끝을 정규식으로 "다음 <img> 또는 다음 판독 블록 전까지"로 잡았다가
  그 사이에 있던 조문 머리 줄(제32조·제33조)까지 지웠다. 원문은 한 줄에 여러 조문이 이어 붙어
  있어서 그런 경계 추정이 통하지 않는다.
  지금은 **git 에 커밋된 옛 sidecar 내용을 그대로 꺼내** 원문에서 그 문자열을 찾아
  새 내용으로 1:1 치환한다. 찾지 못하면 아무것도 하지 않고 보고만 한다.

[연계]
  - 읽음: git show <ref>:_이미지/<id>.txt (옛 판독본) · _이미지/<id>.txt (새 판독본) · 원문 *.txt
  - 씀:   원문 *.txt (그 문자열만)
사용법: python3 refresh_ocr_blocks.py <목록파일> [--ref HEAD]   (각 줄 "<폴더><탭><id>")
"""
import os, subprocess, sys
from _touched import Touched

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
REF = 'HEAD'
if '--ref' in sys.argv:
    REF = sys.argv[sys.argv.index('--ref') + 1]


def git_show(path):
    rel = os.path.relpath(path, REPO)
    r = subprocess.run(['git', '-C', REPO, 'show', '%s:%s' % (REF, rel)],
                       capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def main():
    touched = Touched('refresh_ocr_blocks')
    pairs = []
    for ln in open(sys.argv[1], encoding='utf-8'):
        ln = ln.rstrip('\n')
        if ln:
            d, i = ln.split('\t')
            pairs.append((d, i))

    changed = same = 0
    missing, nochange = [], []
    for d, iid in pairs:
        side = os.path.join(d, iid + '.txt')
        if not os.path.exists(side):
            continue
        new = open(side, encoding='utf-8').read().strip()
        old = git_show(side)
        if old is None:
            missing.append((iid, 'git 에 옛 판독본이 없음(이번에 새로 만든 것)'))
            continue
        old = old.strip()
        if old == new:
            nochange.append(iid)
            continue
        parent = os.path.dirname(d)
        hit = False
        for fn in sorted(os.listdir(parent)):
            if not fn.endswith('.txt'):
                continue
            p = os.path.join(parent, fn)
            t = open(p, encoding='utf-8', errors='replace').read()
            if '【이미지판독 %s】' % iid not in t or old not in t:
                continue
            open(p, 'w', encoding='utf-8').write(t.replace(old, new, 1))
            touched.add(p)
            changed += 1
            hit = True
            print('갱신 %s ← %s' % (os.path.relpath(p, LEGAL), iid), flush=True)
        if not hit:
            missing.append((iid, '원문에서 옛 판독본 문자열을 못 찾음 — 손대지 않았다'))

    touched.save()
    print('\n블록 갱신 %d · 내용 동일 %d · 처리 못 함 %d' % (changed, len(nochange), len(missing)))
    for iid, why in missing:
        print('  · %s — %s' % (iid, why))


if __name__ == '__main__':
    main()
