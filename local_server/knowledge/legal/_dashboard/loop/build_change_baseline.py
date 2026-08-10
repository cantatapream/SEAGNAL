#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""변동감지의 비교 기준점(baseline) 스냅샷을 조립한다 — "지금 우리 raw가 알고 있는 법령/고시가
   무엇인가"를 한 파일로 굳혀서, detect_law_changes.py가 law.go.kr 광역질의 결과와 이것만
   대조하면 되게 만든다. API를 한 번도 부르지 않는다(이미 받아둔 것만 조립).
[연계] 입력: _dashboard/lawid_backfill.json(backfill_lawid.py가 남긴 층별 API 스냅샷)
             raw/**/_meta.json(families) · raw/**/행정규칙/_admrul.json(위임고시 제목·ID)
             _dashboard/delegation_scan_result.json(H-28 전수조사 결과 — MST·위임포인트수 재사용)
       출력: _dashboard/law_change_baseline.json
[로드 순서] backfill_lawid.py 실행 후 → 이 스크립트 → detect_law_changes.py.
            설계·스키마 근거는 _dashboard/H29_design.md §3·§7.
"""
import json, os, re, time

LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
SRC = f"{LEGAL}/_dashboard/lawid_backfill.json"
H28 = f"{LEGAL}/_dashboard/delegation_scan_result.json"
OUT = f"{LEGAL}/_dashboard/law_change_baseline.json"

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backfill_lawid import load_target_laws, family_items  # noqa: E402


def norm_title(s):
    """행정규칙 제목을 대조용으로 정규화한다 — 공백·기호·부처명 괄호 접두어를 지운다.
    예: norm_title('(해양수산부) 동물약품감시요령') → '동물약품감시요령'
    @param {str} s 원제목
    @returns {str} 정규화 제목
    [연계] L-37(admrul은 ID가 개정마다 바뀌므로 제목으로 대조해야 한다) 대책. 접두어 제거는
           L-37이 "다음에 같은 패턴 나오면 보강 필요"로 남겨둔 부분을 이번에 반영한 것.
           detect_law_changes.py도 같은 함수를 import해 써야 양쪽 정규화가 어긋나지 않는다.
           ★접두어 제거는 "(한강유역환경청) 통합고시"와 "(원주지방환경청) 통합고시"처럼 지방청만
           다른 별개 문서까지 같은 이름으로 만들어버린다(2026-08-10 라이브 실행에서 실제 오탐 발생).
           그래서 이 정규화는 후보 뽑기(recall)에만 쓰고, 개정 확정은 detect_law_changes.py에서
           행정규칙ID(개정돼도 불변) 일치까지 확인한 뒤에만 한다.
    """
    s = re.sub(r"^\s*\([^)]{1,20}\)\s*", "", s or "")
    return re.sub(r"[\s·ㆍ.,‧・「」『』\-–—_()\[\]]", "", s)


def load_admruls(raw_dir):
    """그 법의 위임 행정규칙 목록(_admrul.json)을 baseline 형식으로 읽는다.
    예: load_admruls('/…/항만법') → [{'제목':'경인항 항만시설 운영세칙','제목정규화':'경인항항만시설운영세칙','ID':'2100000118676'}, …]
    @param {str} raw_dir 법의 raw 디렉토리
    @returns {list[dict]} 파일이 없으면 빈 리스트
    [연계] `_admrul.json`에는 발령일자가 없다 — 발령일자는 후보가 잡힌 건에 한해
           detect_law_changes.py가 그 자리에서 조회해 비교한다(617건 선백필 회피, H29_design.md §7).
    """
    path = os.path.join(raw_dir, "행정규칙", "_admrul.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        return []
    out = []
    for title, entry in d.items():
        if title.startswith("_") or not isinstance(entry, dict) or not entry.get("ID"):
            continue
        out.append({"제목": title, "제목정규화": norm_title(title), "ID": str(entry["ID"])})
    return out


def h28_index():
    """H-28 전수조사 결과를 slug → {위임포인트수, 층별MST} 로 인덱싱한다(재사용, 재계산 안 함).
    예: h28_index()['항만법'] → {'delegation_points':2336,'mst':{'법률':'283707',…}}
    @returns {dict}
    [연계] H-29 4항 "baseline은 H-28 결과를 그대로 쓴다". 값은 provenance 용도 —
           실제 비교 기준은 현재 `_meta.json`/`lawid_backfill.json` 쪽이다.
    """
    try:
        rows = json.load(open(H28, encoding="utf-8"))
    except Exception:
        return {}
    idx = {}
    for r in rows:
        mst = {}
        for k in r.get("api_status", {}):
            kind, _, m = k.partition(":")
            mst[kind] = m
        idx[r["slug"]] = {"delegation_points": r.get("total_delegation_points"), "mst": mst}
    return idx


def run():
    src = json.load(open(SRC, encoding="utf-8"))["families"]
    h28 = h28_index()
    laws, ministries = [], {}
    missing_lawid = []
    for law in load_target_laws():
        meta = json.load(open(os.path.join(law["raw"], "_meta.json"), encoding="utf-8"))
        fams = {}
        for label, sub in family_items(meta.get("families")):
            info = src.get(f"{law['slug']}::{label}")
            if not info:
                missing_lawid.append(f"{law['slug']}::{label}")
                continue
            fams[label] = info
            if info.get("소관부처코드"):
                ministries[info["소관부처코드"]] = info.get("소관부처명", "")
        laws.append({
            "slug": law["slug"], "name": law["name"], "domain": law.get("domain", ""),
            "raw": law["raw"], "source": law["source"],
            "h28": h28.get(law["slug"], {}),
            "families": fams,
            "admruls": load_admruls(law["raw"]),
        })
    out = {
        "snapshot_at": time.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "law_count": len(laws),
        "ministries": dict(sorted(ministries.items())),
        "missing_lawid": missing_lawid,
        "laws": laws,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"baseline 생성: {len(laws)}법 · 층 {sum(len(l['families']) for l in laws)}개 · "
          f"행정규칙 {sum(len(l['admruls']) for l in laws)}건 · 부처 {len(ministries)}곳 "
          f"· 법령ID 누락 {len(missing_lawid)}건 → {OUT}", flush=True)
    if missing_lawid:
        print("  누락:", ", ".join(missing_lawid), flush=True)


if __name__ == "__main__":
    run()
