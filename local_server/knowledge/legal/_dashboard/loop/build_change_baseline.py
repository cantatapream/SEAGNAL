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
import json, os, re
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))   # 컨테이너는 UTC로 도니 KST는 명시 변환(CLAUDE.md 시간 표기 규칙)
# 이 파일 기준 상대경로(…/_dashboard/loop → legal) — 절대경로는 서비스 컨테이너(/app)에서 깨진다(2026-09-10).
LEGAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
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


def norm_title_keep_org(s):
    """`norm_title` 과 같은데 **기관 괄호 접두어를 남긴다.** 파일↔목록 1:1 짝짓기 전용.

    예: norm_title_keep_org('(태안해양경찰서) 수상레저활동 금지구역 지정 고시')
          → '(태안해양경찰서)수상레저활동금지구역지정고시'
    ★왜 따로 있나 (2026-09-10, 만들자마자 실측으로 걸림): `norm_title` 은 접두어를 지우므로
      태안·창원·제주·보령… 지방해경의 같은 이름 고시가 **전부 한 키로 뭉친다.** 그 키로
      "우리가 가진 ID"를 찾으면 아무 지방청 파일의 번호가 전부에게 붙는다 —
      실제로 수상레저 13건이 같은 번호(2100000248176), 해양레저 18건이 같은 번호가 됐다.
      `norm_title` 의 주석이 경고하던 바로 그 함정이다(L-270 과 같은 뿌리).
    """
    return re.sub(r"[\s·ㆍ.,‧・「」『』\-–—_\[\]]", "", s or "")


def load_admruls(raw_dir):
    """그 법의 위임 행정규칙 목록(_admrul.json)을 baseline 형식으로 읽는다.
    예: load_admruls('/…/항만법') → [{'제목':'경인항 항만시설 운영세칙','제목정규화':'경인항항만시설운영세칙','ID':'2100000118676'}, …]
    @param {str} raw_dir 법의 raw 디렉토리
    @returns {list[dict]} 파일이 없으면 빈 리스트
    [연계] `_admrul.json`에는 발령일자가 없다 — 발령일자는 후보가 잡힌 건에 한해
           detect_law_changes.py가 그 자리에서 조회해 비교한다(617건 선백필 회피, H29_design.md §7).
    """
    folder = os.path.join(raw_dir, "행정규칙")
    path = os.path.join(folder, "_admrul.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        return []
    held = held_ids_from_raw(folder)
    out = []
    for title, entry in d.items():
        if title.startswith("_") or not isinstance(entry, dict) or not entry.get("ID"):
            continue
        rec = {"제목": title, "제목정규화": norm_title(title), "ID": str(entry["ID"])}
        # ★기준선에 담을 번호는 **우리가 실제로 갖고 있는 판**이어야 한다(원문 머리글의 `ID:`).
        #   `_admrul.json` 은 목록이라 우리 사본과 어긋날 수 있다 — 2026-09-10 실측으로 10건이 달랐다.
        #   어긋난 채 기준선을 만들면 detect_law_changes 가 `new_id == a["ID"]` 로 비교하므로
        #     · 목록이 우리보다 새 번호면 → 우리 raw 가 낡았는데 "변화 없음"으로 조용히 지나가고,
        #     · 목록이 우리보다 옛 번호면 → 이미 반영한 개정을 매번 새 개정으로 잡는다.
        #   후자가 2026-08-23 에 실제로 났다(「위험물 선박운송 기준」이 2016년 ID 로 들어 있었다).
        #   그때는 **생성된 기준선 파일을 손으로 고쳐** 막았고, 그래서 재생성 한 번이면 되살아날 상태였다(L-177).
        #   이제 생성기가 원문을 보고 만든다. 목록 쪽 번호가 다르면 `목록ID` 로 함께 남겨 사람이 볼 수 있게 한다.
        h = held.get(norm_title_keep_org(title))
        if h and h != rec["ID"]:
            rec["목록ID"] = rec["ID"]
            rec["ID"] = h
        out.append(rec)
    return out


def held_ids_from_raw(folder):
    """행정규칙 폴더의 .txt 머리글에서 {정규화제목: 우리가 가진 ID} 를 만든다.

    예: held_ids_from_raw('/…/선박안전법/행정규칙') → {'위험물선박운송기준': '2100000280940', …}
    [연계] admrul_fresh.scan_files() 와 같은 규칙으로 읽는다 — 앞 6줄에서 `[…] 제목` 과 `ID:` 를 찾는다.
    """
    out = {}
    try:
        names = os.listdir(folder)
    except Exception:
        return out
    for fn in names:
        if not fn.endswith(".txt"):
            continue
        title = rid = None
        try:
            with open(os.path.join(folder, fn), encoding="utf-8", errors="replace") as f:
                for _ in range(6):
                    ln = f.readline()
                    if not ln:
                        break
                    if title is None and ln.startswith("["):
                        m = re.match(r"^\[[^\]]*\]\s*(.+?)\s*$", ln.strip())
                        if m:
                            title = m.group(1)
                    if rid is None:
                        m = re.match(r"^ID:\s*(\d+)", ln.strip())
                        if m:
                            rid = m.group(1)
        except Exception:
            continue
        if title and rid:
            out.setdefault(norm_title_keep_org(title), set()).add(rid)
    # 같은 제목의 파일이 **서로 다른 ID** 를 들고 있으면 어느 쪽을 "가진 판"이라 할지 알 수 없다.
    # 임의로 고르지 않는다 — 그 제목은 빼고 목록(_admrul.json)의 ID 를 그대로 쓴다.
    # (실측 2026-09-10: 선원법 폴더에 「2006 해사노동협약 사무처리 규정 고시」가 ID 다른 두 파일로 있다.
    #  `os.listdir` 순서에 따라 답이 달라지는 것을 그대로 두면 재생성할 때마다 기준선이 흔들린다.)
    return {k: next(iter(v)) for k, v in out.items() if len(v) == 1}


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


def prev_families():
    """직전 baseline 을 (법slug::층) → 항목 으로 편다. 없으면 빈 dict.

    ★왜 필요한가 (2026-09-22) — `lawid_backfill.py` 가 어느 층의 본문을 **못 받으면**
      스냅샷에 그 층이 없고, 종전 코드는 그런 층을 `missing_lawid` 로 **빼 버렸다.**
      그러면 "baseline 을 새로 만들었다"고 해 놓고 **그 층이 개정탐지에서 조용히 사라진다.**
      실측: 2026-09-22 실행에서 성공 160층 / 실패 55층이었다(옛 baseline 은 215층).
      55층이 감시에서 빠지는 것은 **틀린 날짜보다 나쁘다** — 틀린 날짜는 없는 개정을
      보고하지만(시끄럽다), 빠진 층은 **있는 개정을 놓친다**(조용하다).
    @returns {dict}
    """
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        return {}
    out = {}
    for law in old.get("laws", []):
        for tier, fam in (law.get("families") or {}).items():
            if isinstance(fam, dict):
                out["%s::%s" % (law.get("slug"), tier)] = fam
    return out


def run():
    src = json.load(open(SRC, encoding="utf-8"))["families"]
    prev = prev_families()
    today = datetime.now(KST).strftime("%Y%m%d")
    h28 = h28_index()
    laws, ministries = [], {}
    missing_lawid = []
    carried = []
    for law in load_target_laws():
        meta = json.load(open(os.path.join(law["raw"], "_meta.json"), encoding="utf-8"))
        fams = {}
        for label, sub in family_items(meta.get("families")):
            key = f"{law['slug']}::{label}"
            info = src.get(key)
            if not info:
                # ★못 받은 층은 **빼지 않고 직전 값을 승계한다**(위 prev_families 머리말).
                #   ⚠단 **시행일이 미래인 값은 승계하지 않는다** — 그것이 이번에 고치려던
                #     바로 그 버그(`target=law` 가 시행예정 판을 준 것)이므로 되살리면 안 된다.
                old_info = prev.get(key)
                ef = str((old_info or {}).get("시행일자", ""))
                if old_info and not (ef.isdigit() and len(ef) == 8 and ef > today):
                    info = dict(old_info)
                    info["_승계"] = True
                    info["_승계사유"] = "이번 실행에서 law.go.kr 이 본문을 안 줬다(못 받은 것으로 둠)"
                    info["_승계_최근"] = today
                    info.setdefault("_승계_최초", today)
                    carried.append(key)
                else:
                    missing_lawid.append(key + ("(미래 시행일이라 승계 안 함)" if old_info else ""))
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
        "snapshot_at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "law_count": len(laws),
        "ministries": dict(sorted(ministries.items())),
        "missing_lawid": missing_lawid,
        # 이번 실행에서 본문을 못 받아 **직전 baseline 값을 그대로 이어받은** 층.
        # 비어 있는 것이 정상이고, 늘어나면 law.go.kr 이 그만큼 안 준 것이다.
        # ⚠여기 오래 남아 있는 층은 **날짜가 낡았을 수 있다** — 다음 실행에서 꼭 다시 받아라.
        "carried_from_previous": carried,
        # ★이 두 줄은 종전에 **생성된 파일을 손으로 고쳐** 넣어 두던 것이라 재생성 한 번이면 사라졌다(L-177).
        #   이제 생성기가 매번 만든다 — 내용도 "그때 한 번 맞췄다"가 아니라 "언제나 이렇게 만든다"로 바뀐다.
        "admrul_id_source": "raw 원문 머리글의 `ID:`(우리가 실제로 가진 판). 없으면 _admrul.json 의 ID.",
        "admrul_id_sync_note": (
            "기준선이 우리 사본과 다른 ID 를 들고 있으면 detect_law_changes.py 의 비교 기준 자체가 틀린다 — "
            "옛 번호면 이미 반영한 개정을 매번 새 개정으로 잡고(2026-08-23 「위험물 선박운송 기준」 2016년 ID), "
            "새 번호면 우리 raw 가 낡았는데 조용히 지나간다. H-49 참조."),
        "laws": laws,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if carried:
        print(f"⚠직전 값을 이어받은 층 {len(carried)}개 (이번에 본문을 못 받았다):", flush=True)
        for k in carried:
            print("   " + k, flush=True)
    print(f"baseline 생성: {len(laws)}법 · 층 {sum(len(l['families']) for l in laws)}개 · "
          f"행정규칙 {sum(len(l['admruls']) for l in laws)}건 · 부처 {len(ministries)}곳 "
          f"· 법령ID 누락 {len(missing_lawid)}건 → {OUT}", flush=True)
    if missing_lawid:
        print("  누락:", ", ".join(missing_lawid), flush=True)


if __name__ == "__main__":
    run()
