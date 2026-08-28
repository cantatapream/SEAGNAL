#!/usr/bin/env python3
"""**한때 canonical 이었다가 draft 로 되돌려진** 페이지를 승인 대기열에 올린다.

[왜 있나 — 2026-08-28, 사용자 지시("C 66장 — 왜 draft인지 조사")로 만듦]
draft 300장 중 **살아 있는 ⚠REVIEW 표시가 아예 없는** 96장을 한 장씩 열어 봤더니,
그중 36장은 변경 이력에 **왜 draft 인지가 또렷이 적혀 있었다**:

  | 2026-07-21 | ★L-15 조치 — canonical→draft 환원. 2026-07-20 "AI 재검증 승급" 배치가
    처벌값 EXACT 일치만 확인하고, 본문에 남은 AI 법리추론형 REVIEW 를 검토하지 않아 …

즉 이 페이지들은 **한 번 canonical 로 올라갔다가 되돌려진 것**이고, 되돌린 사유는
"본문에 AI 법리추론형 REVIEW 가 남아 있다" 였다. 그런데 지금 이 36장에는
**그 REVIEW 표시가 본문에 없다.** 해소된 것인지, 표시만 지워진 것인지는 이 도구가
판단하지 않는다 — 사람이 승인 전에 확인할 일이다. 그 말을 항목에 그대로 적는다.

36장 중 13장은 이미 대기열에 있고, **23장은 어디에도 안 올라 있어 승인 화면에 뜨지 않는다.**
이 도구는 그 23장을 올린다.

[지어내지 않는다]
사유는 **그 페이지의 변경 이력 줄을 그대로 옮긴다.** 요약·재해석하지 않는다.

[쓰는 법]
  python3 register_demoted_drafts.py           → 무엇을 올릴지 보여만 준다
  python3 register_demoted_drafts.py --apply   → review_queue.md 에 실제로 쓴다
[연계] ↔ _dashboard/review_queue.md · wiki/**/*.md · register_open_reviews.py(같은 대기열 형식)
       ⚠공유 파일을 쓴다. **사서가 도는 중에는 돌리지 않는다**(오케스트레이터 단독).
"""
import os
import re
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
WIKI = os.path.join(LEGAL, 'wiki')
QUEUE = os.path.join(LEGAL, '_dashboard', 'review_queue.md')

NAMED = re.compile(r'REVIEW-[^\s,)\]|]+?-\d+')
DEMOTE = re.compile(r'canonical\s*→\s*draft|L-15')


def is_log(ln):
    return ln.startswith('| 20') or '변경 이력' in ln


def scan():
    q = open(QUEUE, encoding='utf-8').read()
    known = set(re.findall(r'^###\s+(REVIEW-[^\s:]+)', q, re.M))
    inqueue = set(re.findall(r'^- 대상 페이지: (\S+)', q, re.M))
    out = []
    for d in ('concepts', 'statutes', 'comparisons', 'annexes'):
        for p in sorted(glob.glob(os.path.join(WIKI, d, '*.md'))):
            t = open(p, encoding='utf-8').read()
            if not re.search(r'^status:\s*draft', t, re.M):
                continue
            lines = t.split('\n')
            if any(re.search(r'⚠\s*REVIEW', ln) for ln in lines if not is_log(ln)):
                continue                       # 살아 있는 표시가 있는 것은 다른 도구 담당
            rel = os.path.relpath(p, LEGAL)
            if rel in inqueue or (set(NAMED.findall(t)) & known):
                continue                       # 이미 대기열에 있다
            hit = [ln for ln in lines if is_log(ln) and DEMOTE.search(ln)]
            if not hit:
                continue
            out.append((p, rel, hit[-1].strip()))
    return out


def next_no(q, law):
    used = [int(x) for x in re.findall(r'^###\s+REVIEW-' + re.escape(law) + r'-(\d+):', q, re.M)]
    return max(used) + 1 if used else 951      # 951부터 = 환원 페이지 승급 검토


def entry(rid, rel, log):
    title = re.sub(r'\s+', ' ', os.path.basename(rel)[:-3].replace('__', ' · '))
    return (
        '### %s: [승급 검토] %s\n'
        '- 대상 페이지: %s\n'
        '- 이 페이지는 **한때 canonical 이었다가 draft 로 되돌려졌다.** 되돌린 기록(변경 이력에서 **그대로 옮김**):\n'
        '  > %s\n'
        '- 지금 상태(기계로 확인한 것): 본문에 **살아 있는 ⚠REVIEW 표시가 없다.**\n'
        '  되돌린 사유가 해소된 것인지, 표시만 지워진 것인지는 **확인하지 않았다.**\n'
        '- 사람이 판단할 것: 위 되돌린 사유가 실제로 해소됐는지 원문과 함께 보고,\n'
        '  해소됐으면 canonical 로 올린다. 처벌·안전수치가 있는 페이지는 H-12② 대상이라\n'
        '  기계가 올릴 수 없다.\n'
        '- 승인: [ ] 대기\n\n'
    ) % (rid, title, rel, re.sub(r'\s+', ' ', log))


def main():
    found = scan()
    print('■ 한때 canonical 이었다가 draft 로 환원됐고, 대기열에는 없는 페이지 %d장' % len(found))
    q = open(QUEUE, encoding='utf-8').read()
    counter, made = {}, []
    for p, rel, log in found:
        law = os.path.basename(rel)[:-3].split('__')[0]
        if law not in counter:
            counter[law] = next_no(q, law)
        rid = 'REVIEW-%s-%d' % (law, counter[law])
        counter[law] += 1
        made.append((rid, rel, log))
    for rid, rel, _ in made[:8]:
        print('   %-40s %s' % (rid[:40], os.path.basename(rel)[:44]))
    if len(made) > 8:
        print('   … 그 밖 %d건' % (len(made) - 8))
    if '--apply' not in sys.argv[1:]:
        print('\n(--apply 를 붙이면 review_queue.md 에 실제로 쓴다)')
        return
    head = ('\n\n## 환원된 페이지의 승급 검토 (2026-08-28 · register_demoted_drafts.py)\n\n'
            '> 아래는 **한때 canonical 이었다가 draft 로 되돌려진** 페이지들이다.\n'
            '> 되돌린 사유는 각 페이지 변경 이력에서 **그대로 옮겼고**, 그 사유가 지금 해소됐는지는\n'
            '> 확인하지 않았다. 승인 전에 원문과 함께 본다.\n\n')
    open(QUEUE, 'a', encoding='utf-8').write(head + ''.join(entry(*m) for m in made))
    print('\n✅ review_queue.md 에 %d건 추가.' % len(made))


main()
