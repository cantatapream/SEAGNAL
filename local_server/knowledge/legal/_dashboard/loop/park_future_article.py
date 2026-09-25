#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""park_future_article.py — ★**아직 시행되지 않은 조문이 현행 파일에 섞여 있을 때** 그것을 `_대기/<시행일>/` 로 옮긴다. (3-37 · 3-25 후속)

[왜 있나 — 2026-09-25]
`3-37` 을 재는 중에 노인복지법 발췌본에서 `[제26조의2] 정당한 편의제공의무` 를 찾았다.
2026-09-24 에는 *"이 조는 현행 노인복지법에 없다 · **어느 법 것인지 우리 저장소에서 못 찾았고
추측하지 않는다**"* 로 표시만 해 두었다. 오늘 API 로 확인했다 —
**남의 법이 아니었다. 노인복지법 자신의 조문인데 아직 시행 전이다**:
  `[본조신설 2024.10.22]` · 시행예정 판 **MST 281919 · 시행 2026-12-31**
현행 판(MST 259093, 시행 2026-01-24)에는 당연히 없다.

★**이 꼴은 하나가 아니다.** 앞서 *"raw 5개 파일에 미시행 판 조문 31개"* 가 있었다.
그래서 한 번 쓰고 버리는 손질이 아니라 **자**로 만든다.

[왜 옮기나 — 그냥 두면 무엇이 나쁜가]
`services/article_text.js:2164` 가 `법률.txt` 와 **`법률_발췌.txt` 를 둘 다 읽는다.**
그러니 미시행 의무가 **현행 근거자료로 모델에게 넘어갈 수 있다**(P-19).
「아직 오지 않은 시행일」은 이 저장소가 게이트로 막는 것이다(**V5-14**) —
그 게이트는 `_대기/` 를 뺀다. 즉 **`_대기/` 로 옮기는 것이 규약이 정한 자리다.**

[★옮기기 전에 증거를 다시 잰다 — 옮기고 나서 「아니었다」가 되면 원문을 잃는다]
  ① 현행 판에 그 조가 **없다**(`lawService.do?target=law&MST=<현행>`)
  ② 시행예정 판에 그 조가 **있다**(`lawService.do?target=eflaw&MST=<예정>&efYd=<시행일>`)
  ⚠②는 `efYd` 가 없으면 HTTP 200 과 함께 **HTML 오류쪽**이 온다(L-294 · collect_pending_law 주석).
  둘 다 맞아야 옮긴다. 하나라도 어긋나면 **아무것도 안 하고 까닭을 찍는다.**

[⚠옮긴 뒤에도 자동으로 살아나지 않는다 — 알고 옮긴다]
`services/effective_date.js` 의 `isStageApproved()` 는 **큐 승인 기록(queue_id)이 없으면 닫는다.**
이 자는 큐를 거치지 않으므로, 옮긴 대기본은 **시행일이 와도 런타임이 쓰지 않는다.**
그것이 지금 옳다 — **미시행 조문이 현행으로 새는 것**을 막는 것이 먼저이고,
시행일에 무엇을 할지는 그때 `collect_pending_law.py` 가 큐로 정식 처리한다.
그래서 옮긴 자리에 **그 사실을 적어 둔다**(숨기지 않는다).

쓰는 법:
  python3 park_future_article.py <법폴더> <계층파일> <조표기> --ef <시행일8자리> [--pend-mst N] [--cur-mst N] [--apply]
  예: python3 park_future_article.py 15_관련타부처/노인복지법 법률_발췌.txt 제26조의2 \
        --ef 20261231 --pend-mst 281919 --apply
  `--apply` 없으면 **무엇을 할지만 찍는다**(아무 파일도 안 건드린다).

[연계] → raw/<법>/_대기/<시행일>/{계층파일,_meta.json} · `_touched` 기록.
       ← `collect_pending_law.py`(정식 큐 경로 · 지도 만들기) · `services/effective_date.js`(지도를 읽는 쪽)
       ← 등록부 `3-37` · `V5-14`(아직 오지 않은 시행일) · L-294(eflaw 오류쪽).
"""
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import law_api_guard                                  # noqa: E402
from _touched import Touched                          # noqa: E402

LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
OC = 'hyoo1431'
STAGE_DIR = '_대기'
TIER_OF = {'법률': '법률', '시행령': '시행령', '시행규칙': '시행규칙'}


def arg(flag, default=''):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


def api(url, tries=8):
    """law.go.kr 을 부른다. **HTML 오류쪽을 본문으로 착각하지 않는다**(L-294)."""
    for i in range(tries):
        try:
            b = urllib.request.urlopen(url, timeout=40).read().decode('utf-8', 'replace')
            if b.lstrip()[:1] in '{[':
                return json.loads(b)
            r = law_api_guard.block_reason(b)
            if r:
                law_api_guard.announce(r, url)
                if law_api_guard.is_fatal(r):
                    return None
        except Exception:
            pass
        time.sleep(min(1.2 + 0.4 * i, 6.0))
    return None


def block_of(text, art):
    """`[제26조의2] …` 머리부터 **다음 `[제…]` 머리 앞까지**를 한 덩이로 떼어 온다."""
    head = re.search(r'^\[' + re.escape(art) + r'\][^\n]*$', text, re.M)
    if not head:
        return None, None, None
    start = head.start()
    nxt = re.search(r'^\[제\d+조(?:의\d+)?\]', text[head.end():], re.M)
    end = head.end() + nxt.start() if nxt else len(text)
    return start, end, text[start:end]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    # `--ef 20261231` 의 값처럼 플래그 뒤에 붙은 것은 인자가 아니다
    for flag in ('--ef', '--pend-mst', '--cur-mst'):
        v = arg(flag)
        if v in args:
            args.remove(v)
    if len(args) < 3:
        print(__doc__.split('쓰는 법:')[1].strip())
        return 2
    folder, fname, art = args[0], args[1], args[2]
    ef = arg('--ef')
    pend_mst = arg('--pend-mst')
    apply_ = '--apply' in sys.argv
    if not re.fullmatch(r'\d{8}', ef or ''):
        print('실패: `--ef <시행일 8자리>` 가 필요하다')
        return 2

    base = os.path.join(RAW, folder)
    path = os.path.join(base, fname)
    if not os.path.exists(path):
        print('실패: 그 파일이 없다 —', os.path.relpath(path, RAW))
        return 2
    text = open(path, encoding='utf-8').read()
    s, e, blk = block_of(text, art)
    if blk is None:
        print('실패: `[%s]` 머리줄을 그 파일에서 못 찾았다' % art)
        return 2

    meta = {}
    mp = os.path.join(base, '_meta.json')
    if os.path.exists(mp):
        meta = json.load(open(mp, encoding='utf-8'))
    lawname = meta.get('법령명') or os.path.basename(folder)
    # ★현행 MST 를 어디서 얻나 — 세 자리를 본다.
    #   ⚠실측(2026-09-25): 이 꼴이 생기는 폴더는 애초에 **`_meta.json` 에 MST 가 없는** 발췌본이
    #     많다(그래서 `3-37` 의 `_판번호_보류` 에 올라 있다). 그 보류 기록에 **현행 MST 가 적혀 있다** —
    #     번호를 못 적은 까닭이 바로 「우리 글이 현행과 다르다」였고, 그 다름의 정체가 이 미시행 조문이다.
    cur_mst = str(arg('--cur-mst') or meta.get('MST')
                  or (meta.get('families', {}).get('법률', {}) or {}).get('MST') or '')
    if not cur_mst:
        for h in (meta.get('_판번호_보류') or []):
            if h.get('현행 MST'):
                cur_mst = str(h['현행 MST'])
                print('  · 현행 MST 를 `_meta._판번호_보류` 에서 읽었다: %s (%s)'
                      % (cur_mst, h.get('날짜', '')))
                break

    print('법          %s (%s)' % (lawname, folder))
    print('파일        %s' % fname)
    print('옮길 조     %s  (%d자)' % (art, len(blk)))
    print('시행일      %s' % ef)

    # ── 증거 ① 현행 판에 그 조가 없다 ────────────────────────────────────
    cur_has = None
    if cur_mst:
        d = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=law&type=JSON&MST=%s' % (OC, cur_mst))
        if d is None:
            print('  ⚠현행 판을 못 받았다 — 증거 ①을 못 쟀다')
        else:
            cur_has = art in json.dumps(d, ensure_ascii=False)
            print('  증거① 현행 판(MST %s)에 %s 가 %s' % (cur_mst, art, '있다 ❌' if cur_has else '없다 ✅'))
    else:
        print('  ⚠`_meta.json` 에 현행 MST 가 없다 — 증거 ①을 못 쟀다')

    # ── 증거 ② 시행예정 판에 그 조가 있다 ─────────────────────────────────
    pend_has = None
    if pend_mst:
        d2 = api('https://www.law.go.kr/DRF/lawService.do?OC=%s&target=eflaw&type=JSON&MST=%s&efYd=%s'
                 % (OC, pend_mst, ef))
        if d2 is None:
            print('  ⚠시행예정 판을 못 받았다 — 증거 ②를 못 쟀다')
        else:
            pend_has = art in json.dumps(d2, ensure_ascii=False)
            print('  증거② 시행예정 판(MST %s · 시행 %s)에 %s 가 %s'
                  % (pend_mst, ef, art, '있다 ✅' if pend_has else '없다 ❌'))
    else:
        print('  ⚠`--pend-mst` 를 안 줬다 — 증거 ②를 못 쟀다')

    if not (cur_has is False and pend_has is True):
        print('\n  ⇒ **아무것도 안 한다.** 증거 둘이 다 맞아야 옮긴다 —')
        print('     옮기고 나서 「아니었다」가 되면 원문을 잃는다.')
        return 1

    stage = os.path.join(base, STAGE_DIR, ef)
    out_txt = os.path.join(stage, fname)
    print('\n  옮길 자리  %s' % os.path.relpath(out_txt, RAW))
    if not apply_:
        print('  (`--apply` 를 안 줬다 — 아무 파일도 안 건드렸다)')
        return 0

    touched = Touched('park_future_article')
    os.makedirs(stage, exist_ok=True)
    title = re.match(r'^\[[^\]]+\]\s*(.*)$', blk.split('\n')[0]).group(1).strip()
    body = '\n'.join(blk.split('\n')[1:]).strip('\n')
    head = '[%s] %s (시행 %s · 본조신설)' % (art, title, ef)
    note = ('※ 이 파일은 **시행일 전에 미리 떼어 둔 대기본**이다 — 원래는 `../../%s` 안에\n'
            '   현행 조문과 섞여 있었다(그러면 미시행 의무가 현행 근거자료로 새어 나간다).\n'
            '⚠**런타임은 아직 이 파일을 쓰지 않는다** — `effective_date.js` 의 `isStageApproved()` 가\n'
            '   큐 승인 기록(queue_id)이 없으면 닫기 때문이다. 시행일(%s)이 오면\n'
            '   `collect_pending_law.py` 로 큐를 거쳐 정식으로 처리한다.\n'
            '   옮긴 자: `_dashboard/loop/park_future_article.py` (%s)\n') % (
        fname, ef, time.strftime('%Y-%m-%d'))
    open(out_txt, 'w', encoding='utf-8').write(note + '\n' + head + '\n' + body + '\n')
    touched.add(out_txt)

    json.dump({
        '시행일자': ef,
        'families': {
            '법률': {
                'MST': pend_mst, '법령명': lawname, '시행일자': ef,
                '파일': fname,
                'changed_articles': [{'조문표기': art, '조문제목': title, '조문제개정유형': '본조신설',
                                      '조문시행일자': ef}],
                '수집일': time.strftime('%Y-%m-%d'),
                'source': 'lawService.do?target=eflaw&MST=%s&efYd=%s' % (pend_mst, ef),
                '주의': ('이 대기본은 큐(queue_id)를 거치지 않았다 — `effective_date.isStageApproved()` 가 '
                       '닫으므로 런타임이 쓰지 않는다. 시행일에 `collect_pending_law.py` 로 정식 처리한다.'),
                '만든 자': 'park_future_article.py (3-37)',
            },
        },
    }, open(os.path.join(stage, '_meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    touched.add(os.path.join(stage, '_meta.json'))

    left = (text[:s].rstrip('\n') + '\n\n'
            + '⚠[%s] **`%s` 는 아직 시행되지 않아 이 파일에서 뺐다** — `%s/%s/%s` 로 옮겼다.\n'
              '   시행 %s · `[본조신설 2024.10.22]` · 시행예정 판 MST %s. 현행 판(MST %s)에는 없다.\n'
              '   ⇒ **시행일까지 이 조를 현행으로 인용하지 않는다.**\n'
              % (time.strftime('%Y-%m-%d'), art, STAGE_DIR, ef, fname, ef, pend_mst, cur_mst)
            + text[e:].lstrip('\n'))
    open(path, 'w', encoding='utf-8').write(left)
    touched.add(path)
    touched.save()
    print('  ✅ 옮겼다. 되돌리려면 화면에 찍힌 `_touched --revert` 명령을 쓴다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
