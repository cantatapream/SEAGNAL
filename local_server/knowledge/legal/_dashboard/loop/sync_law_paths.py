#!/usr/bin/env python3
"""`law_raw_paths.json`(법 이름 → raw 폴더 지도)을 **실제 raw 폴더와 맞춘다.**

[왜 있나 — 2026-08-28]
챗봇이 "「선박등기규칙」 제23조"를 인용하면 이 지도를 보고 원문 폴더를 찾는다. 지도에 없으면
**원문이 우리 손에 있는데도 "폴더를 못 찾음"으로 실패한다.**
실제로 그런 일이 있었다 — raw 폴더는 546개인데 지도에는 523개뿐이었다. 조문 단위로 타법을
받아 오는 도구(`add_other_law_article.js`)가 폴더는 만들면서 **지도는 갱신하지 않아** 벌어진 일이다.

[무엇을 하나]
`raw/*/<법이름>/` 을 전부 훑어 지도에 없는 것을 채운다. **지우지는 않는다**(사람이 손으로 넣은
별칭 키가 있을 수 있다).

`raw/_자치법규/` 는 한 칸 더 깊다 — `_자치법규/<시도>/<조례이름>/` 이므로 그 층을 본다
(2026-08-28 이전에는 조례가 폴더 없이 `<시도>/<이름>.txt` 로 납작하게 놓여 있어 이 지도의
대상이 아니라고 보고 건너뛰었다. 그 결과 **조례를 인용한 근거 조문 62줄이 "폴더를 못 찾음"으로
죽어 있었다** — `_dashboard/ORDIN_LINK_FINDING.md` 참조. `ordin_to_folder.py` 로 폴더 꼴로
옮긴 뒤부터는 다른 법과 똑같이 다룬다).

[쓰는 법]
  python3 sync_law_paths.py           → 무엇이 빠졌는지 보여만 준다
  python3 sync_law_paths.py --apply   → 실제로 지도에 채운다
[연계] → _dashboard/law_raw_paths.json  ← services/article_text.js resolveBase() · legal_retriever.rawPathOf()
       ⚠공유 파일이다. 사서가 도는 중에는 오케스트레이터만 돌린다.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.normpath(os.path.join(HERE, '..', '..'))
MAP = os.path.join(LEGAL, '_dashboard', 'law_raw_paths.json')
RAW = os.path.join(LEGAL, 'raw')
ORDIN_DOMAIN = '_자치법규'            # 여기만 `<시도>/<조례이름>/` 로 한 칸 더 깊다


def scan():
    """raw 에 실제로 있는 (법이름, 저장소 상대경로) 목록."""
    out = []
    repo = os.path.normpath(os.path.join(LEGAL, '..', '..', '..'))
    for domain in sorted(os.listdir(RAW)):
        d = os.path.join(RAW, domain)
        if not os.path.isdir(d):
            continue
        # 조례는 `<시도>` 층을 한 번 더 내려가야 법(조례) 폴더가 나온다.
        parents = [os.path.join(d, x) for x in sorted(os.listdir(d))
                   if os.path.isdir(os.path.join(d, x))] if domain == ORDIN_DOMAIN else [d]
        for parent in parents:
            for law in sorted(os.listdir(parent)):
                p = os.path.join(parent, law)
                if not os.path.isdir(p) or law.startswith('_'):
                    continue
                out.append((law.replace(' ', ''), os.path.relpath(p, repo)))
    return out


def main():
    m = json.load(open(MAP, encoding='utf-8'))
    known_paths = {str(v).rstrip('/') for v in m.values()}
    add = [(k, v) for k, v in scan() if k not in m and v.rstrip('/') not in known_paths]
    print('지도 %d개 · raw 폴더 %d개 · **지도에 없는 폴더 %d개**' % (len(m), len(scan()), len(add)))
    for k, v in add:
        print('   + %-52s %s' % (k[:52], v))
    if not add:
        print('\n채울 것이 없다.')
        return
    if '--apply' not in sys.argv[1:]:
        print('\n(--apply 를 붙이면 실제로 채운다)')
        return
    for k, v in add:
        m[k] = v
    with open(MAP, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(m.items())), f, ensure_ascii=False, indent=1)
    print('\n✅ %d개를 채웠다. 지도 항목 %d개.' % (len(add), len(m)))


main()
