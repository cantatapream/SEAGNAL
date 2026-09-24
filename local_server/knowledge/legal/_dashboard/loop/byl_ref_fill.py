#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3-62 — `byl_ref_gap.py` 가 짚은 **본문이 가리키는데 없는 별표**를 받아서 메운다.

[3-46(`byl_tier_fill.py`)과 무엇이 다른가]
  3-46 은 **위키 근거 줄이 짚은** 빈자리를 메운다(V5-32 의 목록).
  이 자는 **raw 본문 자신이 「별표 N과 같다」고 가리키는** 빈자리를 메운다 — 위키가 아직
  안 짚었어도 **법이 있다고 말하는 표**이므로, 없으면 언젠가 그 자리에서 막힌다.

[베끼지 않고 부른다 (L-136)]
  · 목록  `byl_ref_gap.scan()` — 여기서 다시 세지 않는다
  · 받기  `law_api_guard.fetch_law_body` (현행 시행일을 못 박아 부르는 공용 함수)
  · 적기  `recollect_byl.extract_layer(only=…, overwrite=False)` — 별표 적는 꼴은 그 함수에만 있다

[무엇을 안 하나]  이미 있는 파일은 건드리지 않는다 · `_meta.json` 은 안 고친다 ·
  `_links.json` 은 합친다 · 기준법(01~14)만 본다(타부처는 발췌 수집이 정상일 수 있다 → 따로 정한다)

쓰는 법: python3 byl_ref_fill.py            # 무엇을 어디서 받을지만 보여준다
        python3 byl_ref_fill.py --apply    # 실제로 받아 메운다
"""
import os, sys, json, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import byl_ref_gap, law_api_guard, recollect_byl
import collect as C                    # ★`api()`(재시도·차단사유 판별 포함)를 그대로 빌린다 — L-136

LEGAL = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(LEGAL, 'raw')
# ⚠`fetch_law_body(api, …)` 의 첫 인자는 **주소가 아니라 부를 수 있는 함수**다.
#   이름만 보고 URL 을 넘겼다가 `'str' object is not callable` 로 죽었다(L-382 그대로).
API = C.api                                   # collect.py 의 api() — 4회 재시도 + 차단사유 판별
OC = os.environ.get('LAW_OC', C.OC)           # 저장소 관례와 같은 값. 환경변수로 덮을 수 있다.
TIER_FAM = {'법률': '법률', '시행령': '시행령', '시행규칙': '시행규칙'}

def plan():
    """법 폴더마다 {계층: 받을 파일이름 집합}."""
    want = collections.defaultdict(lambda: collections.defaultdict(set))
    for r in byl_ref_gap.scan():
        if r['군'] != '기준법' or r['있다']:
            continue
        want[r['법']][r['계층']].add(f"{r['계층']}_별표{r['번호']}.txt")
    return want

def mst_of(lawdir, tier):
    """그 계층의 MST — 꼬리표(`_meta.json`)의 families 에서 읽는다. 없으면 None."""
    try:
        meta = json.load(open(os.path.join(lawdir, '_meta.json'), encoding='utf-8'))
    except Exception:
        return None, None
    fam = (meta.get('families') or {})
    ent = fam.get(TIER_FAM.get(tier, tier)) if isinstance(fam, dict) else None
    if isinstance(ent, dict):
        return ent.get('법령일련번호') or ent.get('MST'), ent.get('법령ID')
    return None, None

def main():
    apply_ = '--apply' in sys.argv
    want = plan()
    got = filled = 0
    for law, tiers in sorted(want.items()):
        lawdir = os.path.join(RAW, law)
        for tier, names in sorted(tiers.items()):
            mst, lid = mst_of(lawdir, tier)
            mark = 'MST 있음' if mst else '★MST 없음 — 받을 수 없다'
            print(f"  {law}  {tier}  {sorted(names)}  {mark}")
            if not (apply_ and mst):
                continue
            body = law_api_guard.fetch_law_body(API, OC, mst, lid)
            if not body:
                print('     ✘ 본문을 못 받았다 (재시도 뒤에도)')
                continue
            got += 1
            outdir = os.path.join(lawdir, '별표')
            os.makedirs(outdir, exist_ok=True)
            lp = os.path.join(outdir, '_links.json')
            try:
                links = json.load(open(lp, encoding='utf-8'))
            except Exception:
                links = {}
            before = set(os.listdir(outdir))
            recollect_byl.extract_layer(body, tier, outdir, links, only=names, overwrite=False)
            after = set(os.listdir(outdir))
            new = sorted(after - before)
            filled += len(new)
            json.dump(links, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f"     ✅ 새로 적음 {len(new)}개 {new if new else ''}")
    print(f"\n계획 {sum(len(v) for t in want.values() for v in t.values())}자리 · "
          f"본문 받음 {got} · 실제로 적은 파일 {filled}")
    if not apply_:
        print('  (보기만 했다 — 실제로 받으려면 --apply)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
