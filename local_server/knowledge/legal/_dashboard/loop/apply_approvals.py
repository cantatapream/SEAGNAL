#!/usr/bin/env python3
"""서버(볼륨)에 쌓인 **사람 승인 기록**을 저장소에 반영한다.

[왜 있나 — 2026-08-28]
관리자 화면에서 사람이 승인을 누르면 서버는 세 곳에 쓴다:
  ① `review_queue.md` 의 승인 줄  ② 위키 페이지의 `status: canonical`  ③ 승인 이력 JSON
그런데 ①②는 **컨테이너 이미지 안**이라 재배포하면 이미지의 옛 내용으로 되돌아간다.
즉 **사람이 승인한 것이 배포 한 번에 전부 사라진다.** ③도 같은 자리에 있어 함께 사라졌다.

2026-08-28 에 ③을 볼륨(`local_server/data/review_approvals.json`)으로 옮겨 살아남게 했다.
이 도구는 그 ③을 받아 ①②를 저장소에 다시 만들어 커밋할 수 있게 한다.
저장소에 들어가야 다음 배포의 이미지에 실려 영구히 남는다.

[쓰는 법]
  1) 서버에서 승인 이력을 받는다(관리자 토큰 필요):
     curl -H "X-Admin-Token: <토큰>" https://<서버>/api/legal/reviews/approvals > approvals.json
  2) 반영해 본다(무엇이 바뀔지 보여만 준다):
     python3 apply_approvals.py approvals.json
  3) 실제로 쓴다:
     python3 apply_approvals.py approvals.json --apply

[안 하는 것]
- 사람이 안 누른 것을 승인하지 않는다. **입력 파일에 있는 것만** 반영한다.
- 이미 반영돼 있으면 다시 쓰지 않는다(여러 번 돌려도 결과가 같다).
[연계] ← routes/legal.js `GET /api/legal/reviews/approvals` · → _dashboard/review_queue.md · wiki/**
       ⚠공유 파일을 쓴다. 사서가 도는 중에는 돌리지 않는다(오케스트레이터 단독).
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
QUEUE = os.path.join(LEGAL, '_dashboard', 'review_queue.md')


def load(path):
    d = json.load(open(path, encoding='utf-8'))
    return d['approvals'] if isinstance(d, dict) and 'approvals' in d else d


def mark_of(a):
    day = (a.get('at') or '')[:10]
    if a.get('decision') == 'reject':
        return '- 승인: [ ] 반려(%s, %s)' % (a.get('by') or '관리자', day)
    v = a.get('correctedValue')
    tail = ' · 확정값: %s' % v if v not in (None, '') else ''
    return '- 승인: [x] 승인(%s, %s)%s' % (a.get('by') or '관리자', day, tail)


def apply_queue(txt, a):
    """그 항목 블록 안의 `- 승인:` 줄만 바꾼다. 이미 같으면 그대로 둔다."""
    esc = re.escape(a['id'])
    rx = re.compile(r'(###\s+' + esc + r':[\s\S]*?)-\s*승인:\s*\[[ xX]\][^\n]*')
    m = rx.search(txt)
    if not m:
        return txt, '항목 없음'
    new = mark_of(a)
    if m.group(0).endswith(new):
        return txt, '이미 반영됨'
    return rx.sub(lambda mm: mm.group(1) + new, txt, count=1), '반영'


def apply_page(rel, a):
    p = os.path.join(LEGAL, rel)
    if not os.path.exists(p):
        return '페이지 없음'
    t = open(p, encoding='utf-8').read()
    stamp = '> ✅ 사람검증 확정(%s, %s) · %s' % ((a.get('at') or '')[:10], a.get('by') or '관리자', a['id'])
    changed = False
    t2 = re.sub(r'^(status:\s*)(review-pending|draft)\s*$', r'\1canonical', t, count=1, flags=re.M)
    if t2 != t:
        t, changed = t2, True
    if stamp not in t:
        t += '\n' + stamp + '\n'
        changed = True
    if not changed:
        return '이미 반영됨'
    open(p, 'w', encoding='utf-8').write(t)
    return '반영'


def main():
    argv = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not argv:
        print(__doc__)
        return
    apply_it = '--apply' in sys.argv[1:]
    rows = load(argv[0])
    txt = open(QUEUE, encoding='utf-8').read()
    n = {'반영': 0, '이미 반영됨': 0, '항목 없음': 0, '페이지 없음': 0}
    for a in rows:
        txt, r = apply_queue(txt, a)
        n[r] = n.get(r, 0) + 1
        print('%-34s 대기열 %s' % (a['id'][:34], r))
        if a.get('decision') != 'approve':
            continue
        for rel in (a.get('targetPages') or []):
            r2 = apply_page(rel, a) if apply_it else '(미리보기)'
            n[r2] = n.get(r2, 0) + 1
            print('%-34s   %s → %s' % ('', rel, r2))
    if apply_it:
        open(QUEUE, 'w', encoding='utf-8').write(txt)
        print('\n✅ review_queue.md 갱신.')
    else:
        print('\n(--apply 를 붙여야 실제로 쓴다)')
    print('   ' + ' · '.join('%s %d' % (k, v) for k, v in n.items() if v))


main()
