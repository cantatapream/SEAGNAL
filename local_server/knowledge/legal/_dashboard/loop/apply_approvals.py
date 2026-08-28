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
    """서버(routes/legal.js finalizeApproval)가 찍는 승인줄과 **똑같은 문구**를 만든다.
    ⚠종전에는 'reject' 만 따로 보고 나머지를 전부 승인으로 처리해서, **되돌리기(undo)를
      승인으로 뒤집어 반영**했다(2026-08-28 독립 검토에서 발견). 세 결정을 모두 갈라야 한다."""
    day = (a.get('at') or '')[:10]
    who = a.get('by') or '관리자'
    d = a.get('decision')
    if d == 'undo':
        return '- 승인: [ ] 대기(되돌림: %s, %s)' % (who, day)
    if d == 'reject':
        return '- 승인: [ ] 반려(%s, %s)' % (who, day)
    v = a.get('correctedValue')
    tail = ' · 확정값: %s' % v if v not in (None, '') else ''
    return '- 승인: [x] 승인(%s, %s)%s' % (who, day, tail)


# 블록 안에서만 훑는다 — 다음 `###` 헤더를 넘지 않는다.
# ⚠종전에는 `[\s\S]*?` 라서, 그 항목에 `- 승인:` 줄이 없으면 **다음 항목의 승인줄까지 삼켜**
#   남의 승인 기록을 덮어썬다(2026-08-28 독립 검토에서 발견 — 실제 대기열에 그런 항목이 2개 있었다).
INBLOCK = r'(?:(?!\n###\s)[\s\S])*?'


def apply_queue(txt, a):
    """그 항목 블록 안의 `- 승인:` 줄만 바꿈다. 이미 같으면 그대로 둔다.
    승인줄이 아예 없으면 그 블록 끝에 새로 만들어 넣는다."""
    esc = re.escape(a['id'])
    rx = re.compile(r'(###\s+' + esc + r':' + INBLOCK + r')-\s*승인:\s*\[[ xX]\][^\n]*')
    new = mark_of(a)
    m = rx.search(txt)
    if m:
        if m.group(0).endswith(new):
            return txt, '이미 반영됨'
        return rx.sub(lambda mm: mm.group(1) + new, txt, count=1), '반영'
    head = re.compile(r'(###\s+' + esc + r':' + INBLOCK + r')(?=\n###\s|$)')
    if not head.search(txt):
        return txt, '항목 없음'
    return head.sub(lambda mm: mm.group(1).rstrip() + '\n' + new + '\n', txt, count=1), '반영'


def page_path(rel, state):
    """대기열의 '대상 페이지' 표기를 실제 파일 경로로 푼다.
    서버(`routes/legal.js` applyToWikiPages)와 **같은 규칙**을 쓴다 — 종전에는 이 처리가 없어
    `'…시설의귀속.md(신규)'` · `'__정의.md(권한의 위임 절 추가)'` 같은 표기가 전부 '페이지 없음'
    으로 조용히 넘어갔다(2026-08-28 독립 검토에서 발견).
      · `wiki/concepts/` 접두 제거   · `.md` 뒤 설명 절단
      · `__` 로 시작하면 직전 페이지의 법 이름을 물려받는다(멀티페이지 약칭)
    @param state {'law': 직전 법 이름} — 호출 쪽에서 한 승인 안에서 이어 쓴다
    """
    base = re.sub(r'^wiki/concepts/', '', str(rel)).strip()
    base = re.sub(r'\.md\b[\s\S]*$', '', base).strip()
    if not base:
        return ''
    if base.startswith('__') and state.get('law'):
        base = state['law'] + base
    else:
        state['law'] = base.split('__')[0]
    fp = os.path.join(LEGAL, 'wiki', 'concepts', base + '.md')
    root = os.path.realpath(os.path.join(LEGAL, 'wiki', 'concepts')) + os.sep
    if not os.path.realpath(fp).startswith(root):     # 경로 탈출 봉쇄
        return ''
    return fp


def stamp_re(review_id):
    return re.compile(r'^> ✅ 사람검증 확정[^\n]*' + re.escape(review_id) + r'[^\n]*\n?', re.M)


def apply_page(rel, a, state):
    """승인을 페이지에 반영한다 — status 승격 + 확정 각인.
    ⚠재승인 시 **같은 리뷰의 옛 각인을 먼저 지운다**(서버와 같은 동작). 종전에는 문구가 조금만
      달라도(날짜·작성자) 각인이 계속 쌓였다(2026-08-28 독립 검토에서 발견)."""
    p = page_path(rel, state)
    if not p or not os.path.exists(p):
        return '페이지 없음'
    t = before = open(p, encoding='utf-8').read()
    stamp = '> ✅ 사람검증 확정(%s, %s) · %s' % ((a.get('at') or '')[:10], a.get('by') or '관리자', a['id'])
    v = a.get('correctedValue')
    if v not in (None, ''):
        stamp += ' · 확정값: **%s**' % v
    t = re.sub(r'^(status:\s*)(review-pending|draft)\s*$', r'\1canonical', t, count=1, flags=re.M)
    t = stamp_re(a['id']).sub('', t)
    t += '\n' + stamp + '\n'
    if t == before:
        return '이미 반영됨'
    open(p, 'w', encoding='utf-8').write(t)
    return '반영'


def undo_page(rel, a, state):
    """되돌리기를 페이지에 반영한다 — 이 리뷰의 각인만 지우고, 다른 승인의 각인이 남아 있으면
    canonical 을 유지한다(서버 `undoWikiPages` 와 같은 동작)."""
    p = page_path(rel, state)
    if not p or not os.path.exists(p):
        return '페이지 없음'
    t = before = open(p, encoding='utf-8').read()
    t = stamp_re(a['id']).sub('', t)
    if not re.search(r'^> ✅ 사람검증 확정', t, re.M):
        t = re.sub(r'^(status:\s*)canonical\s*$', r'\1draft', t, count=1, flags=re.M)
    if t == before:
        return '이미 반영됨'
    open(p, 'w', encoding='utf-8').write(t)
    return '되돌림'


def main():
    argv = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not argv:
        print(__doc__)
        return
    apply_it = '--apply' in sys.argv[1:]
    rows = load(argv[0])
    txt = open(QUEUE, encoding='utf-8').read()
    n = {'반영': 0, '되돌림': 0, '이미 반영됨': 0, '항목 없음': 0, '페이지 없음': 0}
    for a in rows:
        txt, r = apply_queue(txt, a)
        n[r] = n.get(r, 0) + 1
        print('%-34s 대기열 %s' % (a['id'][:34], r))
        if a.get('decision') not in ('approve', 'undo'):
            continue                            # 반려는 페이지를 건드리지 않는다
        state = {}                              # 한 승인 안에서 `__약칭` 이 물려받을 법 이름
        for rel in (a.get('targetPages') or []):
            if not apply_it:
                r2 = '(미리보기)'
            elif a.get('decision') == 'undo':
                r2 = undo_page(rel, a, state)
            else:
                r2 = apply_page(rel, a, state)
            n[r2] = n.get(r2, 0) + 1
            print('%-34s   %s → %s' % ('', rel, r2))
    if apply_it:
        open(QUEUE, 'w', encoding='utf-8').write(txt)
        print('\n✅ review_queue.md 갱신.')
    else:
        print('\n(--apply 를 붙여야 실제로 쓴다)')
    print('   ' + ' · '.join('%s %d' % (k, v) for k, v in n.items() if v))


main()
