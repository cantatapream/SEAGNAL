#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""위키 전체의 **시행일 마커 짝·형식**을 검사하는 게이트(V5-12).

[왜 게이트인가 — 2026-09-10 독립 검토 high]
마커가 하나만 깨져도, **시행일이 되는 순간** 그 페이지의 뒷부분이 답변에서 사라졌다(런타임은 이제
깨진 페이지를 접지 않고 넘어가지만, 그러면 옛·새 서술이 함께 나가 답이 어수선해진다). 시행 전에는
아무 증상이 없어 사람 눈으로는 못 잡는다 — 그래서 기계가 커밋 전에 본다.

쓰는 법:
    python3 lint_stage_markers.py            깨진 페이지를 찍고, 있으면 종료코드 1
    python3 lint_stage_markers.py --list     마커가 든 페이지 전부와 마커 수를 함께 찍는다

[연계] ← scripts/refactor/verify_all.sh(V5-12) · loop/stage_markers.py(검사 규칙)
        services/effective_date.js checkStageMarkers 와 같은 규칙이다.
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stage_markers import check_markers, has_markers, INLINE_RE, OPEN_LINE_RE  # noqa: E402

LEGAL = os.environ.get('NRYA_LEGAL_DIR') or os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')


def main(argv):
    show = '--list' in argv
    pages = bad = marks = 0
    rows = []
    for p in sorted(glob.glob(os.path.join(WIKI, '*', '*.md'))):
        try:
            src = open(p, encoding='utf-8').read()
        except Exception as e:
            print('  ⚠ 못 읽음 %s — %s' % (os.path.relpath(p, WIKI), e))
            continue
        if not has_markers(src):
            continue
        pages += 1
        n = sum(1 for line in src.split('\n')
                for _ in ([1] if OPEN_LINE_RE.match(line) else [])) + len(INLINE_RE.findall(src))
        marks += n
        errs = check_markers(src)
        if errs:
            bad += 1
            rows.append((os.path.relpath(p, WIKI), errs))
        elif show:
            print('  ✅ %-70s 마커 %d' % (os.path.relpath(p, WIKI), n))

    print('\n── 시행일 마커 짝·형식 ──')
    print('  마커가 든 위키 %d쪽 · 마커 %d개' % (pages, marks))
    if not rows:
        print('  ✅ 깨진 마커 없음')
        return 0
    print('  ❌ 깨진 페이지 %d쪽 — 시행일이 되면 이 페이지들이 옛·새 서술을 함께 내보낸다' % bad)
    for rel, errs in rows:
        print('     %s' % rel)
        for line, msg in errs[:5]:
            print('        %d행 %s' % (line, msg))
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
