#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-21 · P-17 — 별표 `_links.json` 에 **PDF 링크**를 채운다.

[왜 — 원문 제공처가 안 주는 게 아니라 우리가 안 읽었다]
  등록부(P-17)는 *"서식 다운로드가 **HWP 일변도** — `_links.json` 2,754항목 중 PDF 24개(0.87%)"* 라
  적어 두었다. 실측하니 **PDF 0개**였고(2,834항목: hwp 2,811 · xls 16 · hwpx 1 · 없음 5),
  원인은 **API 응답에 PDF 칸이 있는데 수집기가 그 칸을 안 읽은 것**이었다:

      별표서식파일링크      /LSW/flDownload.do?flSeq=159997579   ← 우리가 읽던 것(HWP)
      별표서식PDF파일링크   /LSW/flDownload.do?flSeq=159997581   ← **안 읽던 것**
      별표PDF파일명        law0022522025123035948KC_000100E.pdf

  3-20 의 부칙과 **똑같은 꼴**이다 — *"구조적으로 못 얻는 것이 아니라 얻을 수 있는데 안 받은 것."*

[무엇을 하나] 이미 있는 `_links.json` 의 **항목은 그대로 두고 `PDF` 칸만 채운다.**
  `.txt` 는 **한 글자도 안 건드린다**(별표 본문 재수집이 아니다).
  꼬리표(`_meta.json`)의 `families` 로 계층별 MST 를 찾아 부르고,
  `recollect_byl.extract_layer` 를 **그대로 부른다**(L-136 — 링크 적는 꼴을 두 벌로 만들지 않는다).

★`--missing` (2026-10-03 · 사장님 결정 「그림은 읽지 않고 원본을 보여 준다」)
  법률계열 별표 폴더 160개 중 **79개에는 `_links.json` 이 아예 없었다** — 그 법들의 별표는
  챗봇 팝업에 **원본 쪽 그림도, 내려받기 단추도 뜨지 않는다**(`article_text.js` ④가 이 파일만 읽는다).
  받을 수 없는 자리가 아니라 **아직 안 만든 자리**다 — API 는 7,045개 전부에 HWP·PDF·쪽 그림을 준다.
  `--missing` 을 주면 그런 폴더에 **새 `_links.json` 을 만든다.** 꼴은 위와 똑같이 `extract_layer` 가 정한다.
  `.txt` 는 여전히 한 글자도 안 건드린다.

쓰는 법:
    python3 _dashboard/loop/byl_links_pdf.py            # 무엇을 채울지만 보여준다
    python3 _dashboard/loop/byl_links_pdf.py --apply    # `_links.json` 에 PDF 칸을 채운다
    python3 _dashboard/loop/byl_links_pdf.py --apply --limit 5
    python3 _dashboard/loop/byl_links_pdf.py --missing --apply   # 없는 폴더에 새로 만든다

[연계] → `raw/**/별표/_links.json` (PDF 칸만) · ← `recollect_byl.py`(내려받기·링크 꼴) · `_touched.py`
"""
import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recollect_byl as RB                                       # noqa: E402
from _touched import Touched                                     # noqa: E402

LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
KINDS = ('법률', '시행령', '시행규칙')


def run():
    apply_ = '--apply' in sys.argv
    limit = None
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    targets = sorted(glob.glob(os.path.join(RAW, '*', '*', '별표', '_links.json')))
    print('별표 `_links.json` %d개' % len(targets))
    if '--missing' in sys.argv:
        # 별표 폴더는 있는데 `_links.json` 이 없는 법률계열만(조례는 `_자치법규/` 아래라 이 꼴에 안 걸린다)
        targets = sorted(os.path.join(d, '_links.json')
                         for d in glob.glob(os.path.join(RAW, '*', '*', '별표'))
                         if os.path.isdir(d) and not os.path.exists(os.path.join(d, '_links.json')))
        print('  → --missing: `_links.json` 이 없는 별표 폴더 %d개만 본다' % len(targets))
    touched = Touched('byl_links_pdf') if apply_ else None
    done = filled = skipped = 0
    for lp in targets:
        base = os.path.dirname(os.path.dirname(lp))
        short = os.path.relpath(base, RAW)
        links = json.load(open(lp, encoding='utf-8')) if os.path.exists(lp) else {}
        have = sum(1 for v in links.values() if isinstance(v, dict) and v.get('PDF'))
        if have and have == len(links):
            skipped += 1
            continue                                             # 이미 다 찼다
        mp = os.path.join(base, '_meta.json')
        if not os.path.exists(mp):
            print('· %s  ⚠꼬리표가 없다 — 어느 판을 부를지 모른다' % short)
            continue
        fams = (json.load(open(mp, encoding='utf-8')).get('families') or {})
        got = {}
        for kind in KINDS:
            mst = (fams.get(kind) or {}).get('MST')
            if not mst:
                continue
            body = RB.fetch_body(str(mst))
            if not body:
                print('· %s  ⚠%s MST=%s 본문을 못 받았다' % (short, kind, mst))
                continue
            # ★링크만 받는다 — 파일은 안 쓴다(`only=set()` 이면 아무것도 안 쓴다).
            # ★파일은 안 쓰고 **링크만** 받는다(`links_all=True` · `only=set()`).
            RB.extract_layer(body, kind, os.path.dirname(lp), got, only=set(), overwrite=False, links_all=True)
        add = 0
        for k, v in got.items():
            if k in links and isinstance(links[k], dict):
                if v.get('PDF') and not links[k].get('PDF'):
                    links[k]['PDF'] = v['PDF']; add += 1
            elif k not in links:
                links[k] = v; add += 1
        done += 1; filled += add
        print('· %-46s 항목 %3d · PDF 새로 채움 %3d' % (short[:46], len(links), add))
        if apply_ and add:
            json.dump(links, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
            touched.add(lp)
        if limit and done >= limit:
            break
    print('\n=== 본 폴더 %d개 · PDF 칸을 채운 항목 %d개 · 이미 찬 폴더 %d개 ===' % (done, filled, skipped))
    if apply_:
        touched.save()
    return 0


if __name__ == '__main__':
    sys.exit(run())
