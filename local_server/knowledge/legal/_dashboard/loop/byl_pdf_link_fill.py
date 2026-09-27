#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-21 — 별표 `_links.json` 에 **PDF 주소만** 채운다. (파일은 건드리지 않는다)

[왜 빠져 있나] 3-20(부칙)과 **똑같은 꼴**이다 — 원문 제공처가 PDF 를 안 주는 게 아니라
  **우리가 그 칸을 안 읽었다.** 한 항목의 칸을 다 찍어 보니
    `별표서식파일링크`      → 우리가 읽던 것(HWP)
    `별표서식PDF파일링크`   → **안 읽던 칸**
  예전에 받아 둔 폴더는 그 칸이 없는 채로 굳어 있다.

[지금 상태 — 2026-09-24 실측]
  별표 링크 항목 **3,221** 중 PDF 있음 **3,131(97.2%)**.
  PDF 없는 90건의 갈래:
    · **조례 47** — `target=ordin` 은 `원본`·`파일꼴` 을 주고 PDF 를 안 준다. **정상이다.**
    · 계층(법률·시행령·시행규칙) **20** ← 이 자가 채운다
    · 행정규칙 **23** — `target=admrul` 이라 읽는 길이 다르다(`admrul_byl_file_links.py` 소관)

[안 하는 것] 파일(.txt)은 **하나도 쓰지 않는다**(`only=set()`), `_meta.json` 은 안 고친다.
  `extract_layer(links_all=True)` 가 바로 그러라고 있는 문이다(그 함수 주석 참조).

쓰는 법: python3 byl_pdf_link_fill.py [--apply]
"""
import os, sys, json, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import law_api_guard, recollect_byl
import collect as C
import byl_ref_fill as F                 # mst_of() 를 그대로 쓴다 — 꼬리표 읽는 법은 한 곳에만

LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
TIERS = ('법률', '시행령', '시행규칙')

def targets():
    """PDF 가 빠진 **계층** 항목만 — 조례·행정규칙은 여기서 안 본다."""
    out = collections.defaultdict(set)
    for r, _d, _fs in os.walk(RAW):
        if os.path.basename(r) != '별표' or '_자치법규' in r:
            continue
        p = os.path.join(r, '_links.json')
        if not os.path.exists(p):
            continue
        try:
            L = json.load(open(p, encoding='utf-8'))
        except Exception:
            continue
        for k, v in L.items():
            if not (isinstance(v, dict) and v.get('HWP') and not v.get('PDF')):
                continue
            tier = k.split()[0]
            if tier in TIERS:
                out[(os.path.dirname(r), tier)].add(k)
    return out

def main():
    apply_ = '--apply' in sys.argv
    want = targets()
    filled = laws = 0
    for (lawdir, tier), keys in sorted(want.items()):
        rel = os.path.relpath(lawdir, RAW)
        mst, lid = F.mst_of(lawdir, tier)
        print(f'  {rel[:48]:50s} {tier}  {len(keys)}건  {"MST " + str(mst) if mst else "★MST 없음"}')
        if not (apply_ and mst):
            continue
        body = law_api_guard.fetch_law_body(C.api, C.OC, mst, lid)
        if not body:
            print('     ✘ 본문을 못 받았다'); continue
        outdir = os.path.join(lawdir, '별표')
        lp = os.path.join(outdir, '_links.json')
        links = json.load(open(lp, encoding='utf-8'))
        before = sum(1 for v in links.values() if isinstance(v, dict) and v.get('PDF'))
        # ★★한 번 틀렸다 — 「PDF만 채운다」고 적어 놓고 **기존 링크까지 새 판 것으로 갈아치웠다.**
        #   실측: 폐기물관리법 한 폴더에서 **165개 값이 바뀌었다**(찾던 PDF 는 15개인데).
        #   그게 위험한 까닭: 우리가 가진 `.txt` 는 **그때 받은 판**이다. 링크만 새 판으로 바꾸면
        #   **화면에 보이는 표와 내려받는 파일이 서로 다른 판**이 된다 — 3-15 가 겪은 그 병이다.
        #   ⇒ 새로 받은 링크는 **빈 칸을 메울 때만** 쓴다. 이미 있는 값은 건드리지 않는다.
        fresh = {}
        recollect_byl.extract_layer(body, tier, outdir, fresh, only=set(), overwrite=False, links_all=True)
        for k, v in fresh.items():
            if not isinstance(v, dict):
                continue
            cur = links.get(k)
            if not isinstance(cur, dict):
                continue                      # 없는 열쇠는 새로 만들지 않는다(이 자의 몫이 아니다)
            if not cur.get('PDF') and v.get('PDF'):
                cur['PDF'] = v['PDF']         # ★빈 칸 하나만 메운다
        after = sum(1 for v in links.values() if isinstance(v, dict) and v.get('PDF'))
        json.dump(links, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        laws += 1; filled += after - before
        print(f'     ✅ PDF 주소 {before} → {after} (+{after - before})')
    print(f'\n계층 항목 {sum(len(v) for v in want.values())}건 · 법×계층 {len(want)}조합'
          + (f' · 채운 것 {filled}' if apply_ else ' (보기만 했다 — --apply 로 채운다)'))
    return 0

if __name__ == '__main__':
    sys.exit(main())
