#!/usr/bin/env python3
"""`notice_index.json`(고시 파일 이름 → 그 파일이 있는 법 폴더) 을 만든다.

[왜 있나 — 2026-08-31]
챗봇은 고시를 **그 위키 페이지가 속한 법 폴더**의 `행정규칙/` 에서만 찾는다. 그런데 위키는
다른 부처 소관 고시를 인용하기도 한다 — 예를 들어 「독도의 지속가능한 이용에 관한 법률」 페이지가
「발굴조사의 방법 및 절차 등에 관한 규정」(국가유산청 고시)을 짚는다. 그 고시 파일은
`raw/15_관련타부처/매장유산보호및조사에관한법률/행정규칙/` 에 멀쩡히 있는데도 **못 찾는다**.
V5-8 게이트 실측: "고시 파일을 못 고름" 79줄 중 **20줄이 이 경우**였다(나머지 59줄은 정말
아직 안 받아온 것이거나 이름이 특정되지 않은 칸 — "위 고시"·"해양수산부고시 제2016-26호" 등).

[무엇을 하나]
`raw/*/*/행정규칙/*.txt` 를 전부 훑어 `{파일이름: [폴더1, 폴더2…]}` 를 만든다.
챗봇은 자기 법 폴더에서 못 찾았을 때만 이 지도를 본다(자기 폴더가 언제나 먼저다).

⚠**같은 이름이 여러 폴더에 있으면 그 이름은 그냥 어느 쪽이든 같은 문서다**(실측 27건 —
  같은 고시를 두 법이 함께 쓰느라 복사해 둔 것). 그래도 폴더를 다 적어 둬서 읽는 쪽이 판단한다.

사용법: python3 sync_notice_index.py [--apply|--check]
        --check 는 지도가 raw 와 어긋나면 실패한다(verify_all 이 이걸 쓴다).
[연계] → _dashboard/notice_index.json  ← services/article_text.js loadArticle()(tier==='notice')
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
REPO = os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))
OUT = os.path.join(LEGAL, '_dashboard', 'notice_index.json')


def main():
    idx = {}
    for domain in sorted(os.listdir(RAW)):
        d = os.path.join(RAW, domain)
        if not os.path.isdir(d):
            continue
        for law in sorted(os.listdir(d)):
            nd = os.path.join(d, law, '행정규칙')
            if not os.path.isdir(nd):
                continue
            rel = os.path.relpath(os.path.join(d, law), REPO).replace(os.sep, '/')
            for n in sorted(os.listdir(nd)):
                if not n.endswith('.txt'):
                    continue
                idx.setdefault(n, []).append(rel)
    dup = sum(1 for v in idx.values() if len(v) > 1)
    print(f'고시 파일 이름 {len(idx)}개 · 그중 여러 법 폴더에 있는 이름 {dup}개')
    # ★숫자만 찍지 않는다 — **어느 이름인지 표본을 함께** 찍는다 (2026-09-23, 2-1).
    #   종전에는 `22개` 라고만 했다. 그 22개가 무엇인지 보려면 사람이 따로 뒤져야 했고,
    #   **표본을 못 여는 숫자는 확인할 수 없는 숫자다**(§0-E 규칙 4 를 자 스스로도 지킨다).
    multi = sorted((k, v) for k, v in idx.items() if len(v) > 1)
    for k, v in multi[:5]:
        print(f'    {k}  ← {len(v)}곳: ' + ' · '.join(sorted(v)[:3]))
    if len(multi) > 5:
        print(f'    … 그 밖 {len(multi) - 5}개 (전부: --list)')
    if '--list' in sys.argv:
        for k, v in multi:
            print(f'{k}\t' + ' · '.join(sorted(v)))
        print(f'  — 겹치는 이름 {len(multi)}개')
        return
    if '--check' in sys.argv:
        # 지도가 raw 와 어긋났으면 실패시킨다 — 고시를 새로 받아 놓고 지도를 안 돌리면
        # 챗봇이 그 고시를 남의 법 페이지에서 못 찾는다(그 지도가 있는 이유 자체다).
        try:
            cur = json.load(open(OUT, encoding='utf-8'))
        except Exception:
            cur = None
        if cur != idx:
            print('  ❌ 고시 지도가 raw 와 어긋났습니다 — python3 _dashboard/loop/sync_notice_index.py --apply')
            sys.exit(1)
        print('  ✅ 고시 지도가 raw 와 같다')
        return
    if '--apply' in sys.argv:
        json.dump(idx, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
        print('썼다:', os.path.relpath(OUT, REPO))
    else:
        print('(--apply 를 붙이면 실제로 쓴다)')


main()
