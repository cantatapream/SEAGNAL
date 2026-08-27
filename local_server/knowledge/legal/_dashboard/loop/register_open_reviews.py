#!/usr/bin/env python3
"""위키 본문에 **⚠REVIEW 표시는 있는데 승인 대기열에 항목이 없는** draft 페이지를 대기열에 올린다.

[왜 있나 — 2026-08-27, 사용자 지시로 만듦]
위키 페이지가 `draft`(미승인)로 묶여 있으면 챗봇이 그 근거를 못 꺼낼 수 있다.
그런데 draft 300장을 갈라 보니 이런 상태였다:
  · A **72장** — 대기열에 등록돼 있다 → 사람이 승인만 하면 된다
  · B **96장** — **본문에 ⚠REVIEW 표시는 있는데 대기열에 항목이 없다**
  · C **66장** — REVIEW 표시가 아예 없다(왜 draft 인지 따로 봐야 한다)
B 가 병목이다. **사람이 검증해 주려 해도 승인 화면에 안 뜬다.** 실제로 갯벌법 REVIEW-04 는
그 상태로 16라운드(10R→25R), 해양사고심판법 REVIEW-05 는 그 전에 14라운드를 그렇게 보냈다.
사서는 `review_queue.md` 가 공유 파일이라 못 넣고, 라운드마다 "미등록"이라고 보고만 했다.

[무엇을 하나 — 지어내지 않는다]
페이지 본문의 `⚠REVIEW…` 표시 **옆에 적힌 설명을 그대로 옮겨** 대기열 항목을 만든다.
  · 설명이 **25자 이상** 있는 것만 만든다(실측 70장).
  · 설명이 없는 것(실측 26장)은 **만들지 않는다** — 무엇을 확인해야 하는지 우리가 모르는데
    항목을 만들면 사람이 승인 화면에서 빈 카드를 보게 된다. 목록으로 따로 뽑아 준다.
  · 문장을 다듬거나 요약하지 않는다. 페이지의 말과 파일·줄번호를 그대로 싣는다.

[페이지에도 표시를 남긴다]
만든 항목의 ID 를 그 페이지의 마커 옆에 적어 둔다(`⚠REVIEW` → `⚠REVIEW-<ID번호>`).
안 그러면 다음 라운드 사서가 또 "미등록"이라고 보고한다 — 실제로 그렇게 반복됐다.

[쓰는 법]
  python3 register_open_reviews.py            → 무엇을 만들지 보여만 준다
  python3 register_open_reviews.py --apply     → review_queue.md 와 위키 페이지에 실제로 쓴다
  python3 register_open_reviews.py --list-bare → 설명이 없어 못 만드는 것 목록
[연계] ↔ _dashboard/review_queue.md · wiki/**/*.md
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

MARK = re.compile(r'⚠\s*REVIEW[^\s]*\s*[(:：\-–—]?\s*([^|\n]{0,300})')
NAMED = re.compile(r'REVIEW-[^\s,)\]|]+?-\d+')
MIN_WHY = 25


def law_of(path):
    base = os.path.basename(path)[:-3]
    return base.split('__')[0]


def scan():
    """(페이지, 줄번호, 설명) — 대기열에 없고 설명이 있는 것 / 설명이 없는 것."""
    q = open(QUEUE, encoding='utf-8').read()
    known = set(re.findall(r'^###\s+(REVIEW-[^\s:]+)', q, re.M))
    rich, bare = [], []
    for d in ('concepts', 'statutes', 'comparisons', 'annexes'):
        for p in sorted(glob.glob(os.path.join(WIKI, d, '*.md'))):
            t = open(p, encoding='utf-8').read()
            if not re.search(r'^status:\s*draft', t, re.M):
                continue
            if set(NAMED.findall(t)) & known:
                continue                       # 이미 대기열에 있는 항목이 달린 페이지
            best, line = '', 0
            for i, ln in enumerate(t.split('\n'), 1):
                # 변경 이력 표는 **지난 기록**이다 — 지금 열려 있는 검토가 아니다.
                if ln.startswith('| 20') or '변경 이력' in ln:
                    continue
                m = MARK.search(ln)
                if not m:
                    continue
                why = m.group(1).strip(' `)')
                if len(why) > len(best):
                    best, line = why, i
            if best and len(best) >= MIN_WHY:
                rich.append((p, line, best))
            elif re.search(r'⚠\s*REVIEW', t):
                bare.append((p, line, best))
    return rich, bare


def next_no(q, law):
    """그 법의 다음 항목 번호. 기존 번호와 안 겹치게."""
    used = [int(x) for x in re.findall(r'^###\s+REVIEW-' + re.escape(law) + r'-(\d+):', q, re.M)]
    return max(used) + 1 if used else 901      # 901부터 = 이번에 기계로 올린 것


def entry(rid, page, line, why):
    rel = os.path.relpath(page, LEGAL)
    title = re.sub(r'\s+', ' ', why)[:70].rstrip(' ·,')
    return (
        '### %s: %s\n'
        '- 대상 페이지: %s (본문 %d행의 ⚠REVIEW 표시)\n'
        '- 페이지가 적어 둔 확인 사항(**원문 그대로 옮김, 다듬지 않음**):\n'
        '  > %s\n'
        '- 왜 대기열에 없었나: 이 페이지는 위 표시 때문에 `draft` 로 묶여 있었는데 승인 대기열에는\n'
        '  항목이 없어 **사람이 승인하려 해도 화면에 뜨지 않았다.** 사서는 `review_queue.md` 가\n'
        '  공유 파일이라 넣을 수 없어 라운드마다 보고만 해 왔다.\n'
        '  2026-08-28 `register_open_reviews.py` 가 기계로 올렸다.\n'
        '- ⚠**이 항목의 내용은 페이지가 적어 둔 말을 옮긴 것이다.** 그 판단이 맞는지까지는\n'
        '  확인하지 않았다 — 승인 전에 원문을 함께 본다.\n'
        '- 승인: [ ] 대기\n\n'
    ) % (rid, title, rel, line, re.sub(r'\s+', ' ', why))


def main():
    argv = sys.argv[1:]
    rich, bare = scan()
    if '--list-bare' in argv:
        print('■ ⚠REVIEW 표시는 있으나 **무엇을 확인해야 하는지 안 적힌** draft %d장' % len(bare))
        print('   → 항목을 만들지 않는다(지어낼 수 없다). 사람이나 다음 라운드가 사유를 채워야 한다.\n')
        for p, _, _ in bare:
            print('   ', os.path.relpath(p, LEGAL))
        return

    q = open(QUEUE, encoding='utf-8').read()
    made, counter = [], {}
    for p, line, why in rich:
        law = law_of(p)
        if law not in counter:
            counter[law] = next_no(q, law)
        rid = 'REVIEW-%s-%d' % (law, counter[law])
        counter[law] += 1
        made.append((rid, p, line, why))

    print('■ 승인 대기열에 올릴 항목 %d건 (설명이 없어 못 만드는 것 %d건은 제외)' % (len(made), len(bare)))
    for rid, p, line, why in made[:8]:
        print('   %-46s %s:%d' % (rid[:46], os.path.basename(p)[:34], line))
    if len(made) > 8:
        print('   … 그 밖 %d건' % (len(made) - 8))
    if '--apply' not in argv:
        print('\n(--apply 를 붙이면 review_queue.md 와 위키 페이지에 실제로 쓴다)')
        print('(--list-bare 로 설명이 없어 못 만드는 %d장을 볼 수 있다)' % len(bare))
        return

    # ① 대기열에 붙인다(맨 끝 — 기존 항목을 건드리지 않는다)
    add = ''.join(entry(rid, p, line, why) for rid, p, line, why in made)
    head = ('\n\n## 기계로 올린 열린 검토 (2026-08-28 · register_open_reviews.py)\n\n'
            '> 아래는 **위키 본문에 ⚠REVIEW 표시가 있는데 대기열에는 없던** 항목들이다.\n'
            '> 내용은 각 페이지가 적어 둔 말을 **그대로 옮긴 것**이고, 그 판단이 맞는지까지는\n'
            '> 확인하지 않았다. 승인 전에 원문을 함께 본다.\n\n')
    open(QUEUE, 'a', encoding='utf-8').write(head + add)

    # ② 페이지 마커 옆에 ID 를 남긴다 — 안 그러면 다음 라운드가 또 "미등록"이라 보고한다
    for rid, p, line, why in made:
        t = open(p, encoding='utf-8').read().split('\n')
        i = line - 1
        if 0 <= i < len(t) and '⚠REVIEW' in t[i] and rid not in t[i]:
            t[i] = t[i].replace('⚠REVIEW', '⚠REVIEW〔%s 대기열 등록됨〕' % rid, 1)
            open(p, 'w', encoding='utf-8').write('\n'.join(t))
    print('\n✅ review_queue.md 에 %d건 추가 · 위키 %d장에 등록 표시를 남겼다.' % (len(made), len(made)))
    print('   설명이 없어 못 만든 %d장은 --list-bare 로 따로 본다.' % len(bare))


main()
