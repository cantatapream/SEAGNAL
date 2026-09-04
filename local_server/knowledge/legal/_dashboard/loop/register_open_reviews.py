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

# ★2026-09-03 정정 — 종전 `⚠\s*REVIEW[^\s]*` 는 **공백 앞까지를 통째로 마커로 먹었다.**
#   그래서 본문이 `⚠REVIEW(신규, 미등록…): 설명` 꼴이면 "(신규," 까지를 마커로 삼고
#   그 **다음 낱말부터** 사유로 떠 왔다 — 제목이 문장 한가운데서 시작해 무슨 논점인지
#   알 수 없는 항목이 실제로 생겼다. 이제 마커 뒤 꼬리를 아래처럼 **형태별로** 끊는다.
#   (draft 페이지의 ⚠REVIEW 줄 577개로 옛 방식과 대조해 181줄이 달라지고,
#    그중 짧아진 13줄을 전부 눈으로 확인했다 — 전부 앞쪽 군더더기가 빠진 것이었다.)
MARK = re.compile(
    r'⚠\s*REVIEW'          # 마커
    r'`?'                    # `⚠REVIEW`로 처럼 코드표시 백틱이 붙는 경우
    r'(?:[가-힣]{1,3})?'      # ⚠REVIEW로 / ⚠REVIEW를 — 마커에 바로 붙은 조사
    r'(?:〔[^〕]*〕)?'         # 〔REVIEW-법-7 대기열 등록됨〕 같은 ID 표기
    r'(?:-[^\s(（:：|]+)?'    # -해양경비법-07 / -02 같은 ID 꼬리
    r'\s*')
SEP = re.compile(r'^[:：\-–—]?\s*')
# (신규, 미등록) (출처미확인) 처럼 **상태만 적은 괄호**는 사유가 아니라 꼬리표다 — 건너뛴다.
PAREN = re.compile(r'^[(（][^)）]{0,60}[)）][*\s]*[:：\-–—]?\s*')
# 다만 괄호 뒤가 조사로 이어지면(…등)를 포함하기 때문") 그 괄호가 곧 내용이다 — 남긴다.
JOSA = re.compile(r'^[를을이가는은와과로의에도만][\s가-힣]')
TRIM = ' `)*,、·.:：'


def why_of(ln):
    """⚠REVIEW 표시 줄에서 **사유 문장**만 뽑는다.
       예) '⚠REVIEW(신규, 미등록): 제3조 정의가 …' → '제3조 정의가 …'
       [연계] scan() 이 대기열 제목·인용을 만들 때 쓴다. 표시가 없으면 None."""
    m = MARK.search(ln)
    if not m:
        return None
    rest = SEP.sub('', ln[m.end():], count=1)
    cand = rest.split('|')[0][:300].strip(TRIM)
    pm = PAREN.match(rest)
    if pm:
        tail = rest[pm.end():]
        after = tail.split('|')[0][:300].strip(TRIM)
        if len(after) >= 15 and not JOSA.match(tail):
            return after
    return cand


NAMED = re.compile(r'REVIEW-[^\s,)\]|]+?-\d+')
# 페이지가 자기 안에 검토 질문을 소제목으로 적어 둔 경우 — 그 질문이 곧 사유다
HEAD = re.compile(r'^###\s+(REVIEW-[^\s:]+):\s*(.+)$', re.M)
REASON_FIELD = re.compile(r'^review_reason:\s*(.+)$', re.M)
MIN_WHY = 25


def law_of(path):
    base = os.path.basename(path)[:-3]
    return base.split('__')[0]


def is_log(ln):
    """변경 이력 표의 줄인가. 거기 적힌 REVIEW 는 **지난 기록**이지 지금 열린 검토가 아니다."""
    return ln.startswith('| 20') or '변경 이력' in ln


def cell_text(ln):
    """표 줄을 사람이 읽을 수 있게 편다(칸 구분 | → · )."""
    if ln.startswith('|'):
        cells = [c.strip() for c in ln.strip('|').split('|') if c.strip()]
        return ' · '.join(cells)
    return ln.lstrip('> -').strip()


def scan():
    """(페이지, 줄번호, 설명) 세 갈래.
       rich = 사유를 찾은 것 / bare = 살아 있는 ⚠REVIEW 는 있는데 사유를 못 찾은 것 /
       nomark = draft 인데 살아 있는 REVIEW 표시가 아예 없는 것(= C 그룹)."""
    q = open(QUEUE, encoding='utf-8').read()
    known = set(re.findall(r'^###\s+(REVIEW-[^\s:]+)', q, re.M))
    # 이미 올려 둔 (페이지, 줄). 페이지 안의 ID 표시가 안 남는 경우가 있어(⚠ 와 REVIEW 사이 공백 등)
    # ID 만으로 거르면 같은 자리를 두 번 올린다 — 실제로 내수면어업법 42행이 두 번 올라갔다.
    # 이 도구는 한 페이지에 한 항목만 올린다. 줄번호로 거르면 같은 페이지가 두 번 올라간다
    # (사유를 머리말에서 찾았을 때와 표시 줄에서 찾았을 때 줄번호가 달라진다).
    done = set(re.findall(r'^- 대상 페이지: (\S+).*?본문 \d+행', q, re.M))
    rich, bare, nomark = [], [], []
    for d in ('concepts', 'statutes', 'comparisons', 'annexes'):
        for p in sorted(glob.glob(os.path.join(WIKI, d, '*.md'))):
            t = open(p, encoding='utf-8').read()
            if not re.search(r'^status:\s*draft', t, re.M):
                continue
            if set(NAMED.findall(t)) & known:
                continue                       # 이미 대기열에 있는 항목이 달린 페이지
            rel_here = os.path.relpath(p, LEGAL)
            live = [(i, ln) for i, ln in enumerate(t.split('\n'), 1) if not is_log(ln)]
            # ① 표시 옆에 적힌 설명(종전 방식)
            best, line, marker_line = '', 0, 0
            for i, ln in live:
                why = why_of(ln)
                if why is None:
                    continue
                if not marker_line:
                    marker_line = i          # 표시가 있는 첫 줄(설명이 표시 뒤에 없어도 기억한다)
                why = why.strip(TRIM)
                if len(why) > len(best):
                    best, line, marker_line = why, i, i
            rid = None
            # ② 페이지가 자기 안에 적어 둔 검토 질문 소제목 — 있으면 그 질문과 그 ID 를 쓴다
            for hid, htext in HEAD.findall(t):
                if hid in known:
                    continue
                if len(htext.strip()) > len(best):
                    rid, best = hid, htext.strip()
                    line = t[:t.index('### ' + hid)].count('\n') + 1
            # ③ 머리말의 review_reason 필드
            fm = REASON_FIELD.search(t)
            if fm and len(fm.group(1).strip()) > len(best):
                best, line = fm.group(1).strip(), marker_line or 1
            # ④ 그래도 짧으면 **표시가 있는 줄 전체**를 옮긴다(설명이 표시 앞에 적힌 경우)
            if len(best) < MIN_WHY and marker_line:
                whole = cell_text(dict(live)[marker_line])
                if len(whole) >= MIN_WHY:
                    best, line = whole, marker_line
            has_live_mark = any(re.search(r'⚠\s*REVIEW', ln) for _, ln in live)
            if rel_here in done:
                continue                       # 같은 자리를 이미 올렸다
            if best and len(best) >= MIN_WHY and (has_live_mark or rid or fm):
                rich.append((p, line, best, rid, marker_line))
            elif has_live_mark:
                bare.append((p, marker_line, best, None, marker_line))
            else:
                nomark.append((p, 0, '', None, 0))
    return rich, bare, nomark


_WIKI_IDS = None


def _wiki_used():
    """위키 전체에서 이미 쓰인 REVIEW 번호를 법별로 모은다(한 번만 훑는다).

    ★2026-09-04 신설 — 종전 next_no 는 `review_queue.md` 만 보고 번호를 붙였다.
      그런데 **위키 페이지 자신도 `### REVIEW-<법>-<번호>:` 소제목을 갖는다.**
      그래서 큐에 없고 위키에만 있는 번호를 다시 발급해 **같은 번호가 서로 다른 논점 둘에
      붙는 사고**가 났다(39회차 항만운송사업법 사서가 발견 — 804 가 큐에서는 "자가운송",
      위키에서는 "일반 이메일 제출"이었다. 805 도 같았다).
      이제 큐와 위키를 **둘 다** 보고 그 다음 번호를 준다.
    """
    global _WIKI_IDS
    if _WIKI_IDS is None:
        _WIKI_IDS = {}
        pat = re.compile(r'REVIEW-([^\s:|,)\]]+?)-(\d+)')
        for d in ('concepts', 'statutes', 'comparisons', 'annexes'):
            for p in glob.glob(os.path.join(WIKI, d, '*.md')):
                try:
                    t = open(p, encoding='utf-8').read()
                except Exception:
                    continue
                for law, no in pat.findall(t):
                    _WIKI_IDS.setdefault(law, set()).add(int(no))
    return _WIKI_IDS


def next_no(q, law):
    """그 법의 다음 항목 번호. **대기열과 위키 양쪽**의 기존 번호와 안 겹치게."""
    used = [int(x) for x in re.findall(r'^###\s+REVIEW-' + re.escape(law) + r'-(\d+):', q, re.M)]
    used += sorted(_wiki_used().get(law, ()))
    return max(used) + 1 if used else 901      # 901부터 = 이번에 기계로 올린 것


def entry(rid, page, line, why):
    rel = os.path.relpath(page, LEGAL)
    title = re.sub(r'\s+', ' ', why)[:70].rstrip(' ·,')
    return (
        '### %s: %s\n'
        '- 대상 페이지: %s (사유가 적힌 자리: 본문 %d행 — 머리말 review_reason 필드에서 온 경우 1행)\n'
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
    rich, bare, nomark = scan()
    if '--list-bare' in argv:
        print('■ ⚠REVIEW 표시는 있으나 **무엇을 확인해야 하는지 안 적힌** draft %d장' % len(bare))
        print('   → 항목을 만들지 않는다(지어낼 수 없다). 사람이나 다음 라운드가 사유를 채워야 한다.\n')
        for p, _, _, _, _ in bare:
            print('   ', os.path.relpath(p, LEGAL))
        return

    q = open(QUEUE, encoding='utf-8').read()
    made, counter = [], {}
    for p, line, why, own, mline in rich:
        if own:                            # 페이지가 이미 자기 ID 를 적어 뒀으면 그걸 쓴다
            rid = own
        else:
            law = law_of(p)
            if law not in counter:
                counter[law] = next_no(q, law)
            rid = 'REVIEW-%s-%d' % (law, counter[law])
            counter[law] += 1
        made.append((rid, p, line, why, mline))

    print('■ 승인 대기열에 올릴 항목 %d건 (설명이 없어 못 만드는 것 %d건은 제외)' % (len(made), len(bare)))
    for rid, p, line, why, _ in made[:8]:
        print('   %-46s %s:%d' % (rid[:46], os.path.basename(p)[:34], line))
    if len(made) > 8:
        print('   … 그 밖 %d건' % (len(made) - 8))
    if '--apply' not in argv:
        print('\n(--apply 를 붙이면 review_queue.md 와 위키 페이지에 실제로 쓴다)')
        print('(--list-bare 로 설명이 없어 못 만드는 %d장을 볼 수 있다)' % len(bare))
        print('(REVIEW 표시가 아예 없는 draft %d장은 별개 — C 그룹)' % len(nomark))
        return

    # ① 대기열에 붙인다(맨 끝 — 기존 항목을 건드리지 않는다)
    add = ''.join(entry(rid, p, line, why) for rid, p, line, why, _ in made)
    head = ('\n\n## 기계로 올린 열린 검토 (2026-08-28 · register_open_reviews.py)\n\n'
            '> 아래는 **위키 본문에 ⚠REVIEW 표시가 있는데 대기열에는 없던** 항목들이다.\n'
            '> 내용은 각 페이지가 적어 둔 말을 **그대로 옮긴 것**이고, 그 판단이 맞는지까지는\n'
            '> 확인하지 않았다. 승인 전에 원문을 함께 본다.\n\n')
    open(QUEUE, 'a', encoding='utf-8').write(head + add)

    # ② 페이지 마커 옆에 ID 를 남긴다 — 안 그러면 다음 라운드가 또 "미등록"이라 보고한다
    for rid, p, line, why, mline in made:
        t = open(p, encoding='utf-8').read().split('\n')
        i = (mline or 0) - 1
        if 0 <= i < len(t) and rid not in t[i] and re.search(r'⚠\s*REVIEW', t[i]):
            t[i] = re.sub(r'(⚠\s*REVIEW)', r'\1〔%s 대기열 등록됨〕' % rid, t[i], count=1)
            open(p, 'w', encoding='utf-8').write('\n'.join(t))
    print('\n✅ review_queue.md 에 %d건 추가 · 위키 %d장에 등록 표시를 남겼다.' % (len(made), len(made)))
    print('   설명이 없어 못 만든 %d장은 --list-bare 로 따로 본다.' % len(bare))


main()
