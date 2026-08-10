#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""법령·위임고시 변동감지(H-29 1~4·8~12항) — 소관부처 단위 "광역질의" 몇 번으로 최근 변동을
   훑고, baseline(우리 raw가 아는 법령ID·고시제목)과 매치되는 것만 깊이 파고들어 변경조문까지
   뽑아 큐에 쌓는다. 판정은 100% 로직이며 raw·위키를 절대 고치지 않는다(AI 트리아지·사람 승인은 후속).
[연계] 입력: _dashboard/law_change_baseline.json(build_change_baseline.py 산출)
       API : lawSearch.do?target=eflaw(법령 광역질의) · target=admrul(행정규칙 광역질의)
             lawService.do?target=eflaw&MST=…&efYd=…(매치건만 조문단위 딥다이브)
             lawService.do?target=admrul&ID=…(발령일자 직접비교용, 후보건만)
       출력: _dashboard/law_change_queue.json (status:pending 누적 — H-29 5~7항 승인방이 소비할 스키마)
[로드 순서] backfill_lawid.py → build_change_baseline.py → 이 스크립트(주기 실행, 기본 최근 7일).
            사용법: python3 detect_law_changes.py [--days 7]
            실측 API 스펙·설계 근거는 _dashboard/H29_design.md §4·§6·§7.
"""
import json, os, re, sys, time, urllib.request
from datetime import date, timedelta

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
BASELINE = f"{LEGAL}/_dashboard/law_change_baseline.json"
QUEUE = f"{LEGAL}/_dashboard/law_change_queue.json"
SLEEP = 0.25
MAX_PAGES = 10          # 광역질의 페이징 안전상한(1페이지 100건)
PENDING_YEARS = 5       # 시행예정 전수질의(W3)가 훑을 미래 범위

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_change_baseline import norm_title  # noqa: E402  (baseline과 같은 정규화 규칙을 공유)


def api(url):
    """DRF API 1회 호출(JSON). 3회까지 재시도하고 그래도 안 되면 None.
    예: api('https://www.law.go.kr/DRF/lawSearch.do?…') → {'LawSearch': {...}}
    @param {str} url 완성된 요청 URL
    @returns {dict|None}
    [연계] collect_contacts.py·recollect_jomun.py와 같은 호출 관례(OC=hyoo1431, User-Agent 지정).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1.5)
    return None


def search_rows(target, key, extra):
    """lawSearch 광역질의를 페이징하며 행 목록을 모은다.
    예: search_rows('eflaw','law','&org=1192000&ancYd=20260803~20260810') → [{법령ID:…}, …]
    @param {str} target eflaw(법령) 또는 admrul(행정규칙)
    @param {str} key 응답 안의 행 배열 키('law' 또는 'admrul')
    @param {str} extra 추가 쿼리스트링(앞에 & 포함)
    @returns {list[dict]} 실패 시 빈 리스트
    [연계] target=law가 아니라 eflaw를 쓰는 이유는 H29_design.md §4 — law는 현행본만 색인해
           시행예정(예고)본을 통째로 놓친다(수산업법 285535 실측).
    """
    rows, page = [], 1
    while page <= MAX_PAGES:
        d = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target={target}"
                f"&display=100&page={page}{extra}")
        if not d:
            break
        box = d.get("LawSearch") or d.get("AdmRulSearch") or {}
        got = box.get(key) or []
        if isinstance(got, dict):
            got = [got]
        rows.extend(got)
        total = int(box.get("totalCnt") or 0)
        if len(rows) >= total or not got:
            break
        page += 1
        time.sleep(SLEEP)
    return rows


def index_baseline(base):
    """baseline을 조회용 인덱스 2개로 편다 — 법령ID→(법,층) / 정규화고시제목→(법,고시).
    예: by_lawid['001486'] → (수산업법 dict, '법률', {MST:'270747',…})
    @param {dict} base law_change_baseline.json 내용
    @returns {tuple[dict, dict]}
    [연계] 광역질의 결과와의 대조는 전부 이 인덱스로만 한다(법령명 문자열 대조 금지 — H-29 11항).
    """
    by_lawid, by_admrul = {}, {}
    for law in base["laws"]:
        for layer, fam in law["families"].items():
            by_lawid[fam["법령ID"]] = (law, layer, fam)
        for a in law["admruls"]:
            by_admrul.setdefault(a["제목정규화"], []).append((law, a))
    return by_lawid, by_admrul


def changed_articles(mst, efyd):
    """개정본 조문 배열에서 "이번에 바뀐 조문"만 뽑는다(조문변경여부=Y).
    예: changed_articles('285535','20261022') → [{'조문번호':'8','조문제목':'마을어업 등의 면허',…}, …]
    @param {str} mst 법령일련번호  @param {str} efyd 그 버전의 시행일자(YYYYMMDD)
    @returns {tuple[list, dict]} (변경조문 목록, 기본정보) — 조회 실패 시 ([], {})
    [연계] recollect_jomun.py가 이미 쓰는 필드(조문번호/조문제목/조문시행일자/조문제개정유형)를
           그대로 읽는다. ★시행예정본은 efYd를 함께 줘야 응답이 온다(안 주면 {} — 2026-08-10 실측).
    """
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=eflaw&type=JSON"
            f"&MST={mst}&efYd={efyd}")
    body = (d or {}).get("법령") or {}
    jos = ((body.get("조문") or {}).get("조문단위")) or []
    if isinstance(jos, dict):
        jos = [jos]
    out = []
    for j in jos:
        if j.get("조문변경여부") != "Y":
            continue
        out.append({"조문번호": str(j.get("조문번호", "")), "조문가지번호": str(j.get("조문가지번호", "") or ""),
                    "조문제목": j.get("조문제목", ""), "조문제개정유형": j.get("조문제개정유형", ""),
                    "조문시행일자": str(j.get("조문시행일자", ""))})
    return out, body.get("기본정보") or {}


def admrul_detail(admrul_id):
    """행정규칙 1건의 발령일자·시행일자·안정ID를 조회한다(ID 크기 비교 금지, 날짜로 판단).
    예: admrul_detail('2100000282754') → {'발령일자':'20260720','시행일자':'20261021','행정규칙ID':'61410',…}
    @param {str} admrul_id 행정규칙일련번호
    @returns {dict|None}
    [연계] L-59 — lsDelegated/검색이 주는 ID는 최신본을 보장하지 않는다. 그래서 "ID가 다르다"는
           신호가 나오면 반드시 양쪽 발령일자를 실제로 받아 비교한다.
    """
    d = api(f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&type=JSON&ID={admrul_id}")
    info = ((d or {}).get("AdmRulService") or {}).get("행정규칙기본정보")
    return info or None


def make_item(kind, law, layer, ident, before, after, arts, evidence):
    """큐 항목 1건을 H-29 5~7항(승인방)이 그대로 소비할 스키마로 만든다.
    예: make_item('law_pending', 수산업법, '법률', {'법령ID':'001486'}, before, after, arts, {'query':'W3'})
    @returns {dict} status/scheduled_for/ai_recommendation은 후속 단계가 채울 자리(지금은 pending/null)
    [연계] 스키마 정의는 H29_design.md §7. dedupe_key로 재실행 시 중복 적재를 막는다.
    """
    key_id = ident.get("법령ID") or ident.get("행정규칙ID") or ident.get("ID", "")
    ver = (after or {}).get("MST") or (after or {}).get("ID", "")
    when = (after or {}).get("시행일자") or (after or {}).get("발령일자", "")
    return {
        "id": f"chg_{time.strftime('%Y%m%d')}_{abs(hash((kind, key_id, ver, when))) % 0xFFFFFF:06x}",
        "dedupe_key": f"{kind}|{key_id}|{ver}|{when}",
        "detected_at": time.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "kind": kind,
        "law": {"slug": law["slug"], "name": law["name"], "raw": law["raw"]},
        "layer": layer,
        "식별자": ident,
        "before": before,
        "after": after,
        "공포일자": (after or {}).get("공포일자") or (after or {}).get("발령일자", ""),
        "시행일자": (after or {}).get("시행일자", ""),
        "changed_articles": arts,
        "ai_recommendation": None,
        "status": "pending",
        "scheduled_for": None,
        "evidence": evidence,
    }


def scan_laws(base, by_lawid, days):
    """법령 광역질의 3종(W1 공포범위·W2 시행범위·W3 시행예정전수)을 돌리고, 법령ID가 baseline에
    있는 행만 골라 MST/법령명/소관부처명 차이를 항목으로 만든다.
    @param {dict} base baseline  @param {dict} by_lawid 법령ID 인덱스  @param {int} days 최근 N일
    @returns {tuple[list, int]} (큐 항목들, 실행한 질의 수)
    [연계] W1만으로는 오래전 공포·이제 시행되는 법(W2)과 공포일이 창 밖인 예고본(W3)을 놓친다
           — 셋 다 두는 근거는 H29_design.md §6. W1·W2는 부처 필터 없이 전부처를 훑는다
           (최근 7일 실측 61·36건으로 작고, org로 좁히면 법이 다른 부처로 이관됐을 때 그 법이
           질의 결과에서 통째로 사라져 H-29 9항 부처변경을 영영 못 잡는다). W3만 부처별.
    """
    today = date.today()
    frm = (today - timedelta(days=days)).strftime("%Y%m%d")
    to = today.strftime("%Y%m%d")
    tomorrow = (today + timedelta(days=1)).strftime("%Y%m%d")
    far = (today + timedelta(days=365 * PENDING_YEARS)).strftime("%Y%m%d")
    queries = 0
    seen, items = set(), []
    plans = [("W1", "", f"&ancYd={frm}~{to}"), ("W2", "", f"&efYd={frm}~{to}")]
    plans += [("W3", org, f"&org={org}&efYd={tomorrow}~{far}") for org in base["ministries"]]
    for tag, org, extra in plans:
        queries += 1
        for row in search_rows("eflaw", "law", extra):
            lid = str(row.get("법령ID", ""))
            hit = by_lawid.get(lid)
            if not hit:
                continue
            law, layer, fam = hit
            mst, efyd = str(row.get("법령일련번호", "")), str(row.get("시행일자", ""))
            if (lid, mst, efyd) in seen:
                continue
            seen.add((lid, mst, efyd))
            status = row.get("현행연혁코드", "")
            after = {"MST": mst, "법령명": row.get("법령명한글", ""),
                     "공포번호": str(row.get("공포번호", "")), "공포일자": str(row.get("공포일자", "")),
                     "시행일자": efyd, "소관부처명": row.get("소관부처명", ""),
                     "현행연혁코드": status}
            ev = {"query": tag, "org": org}
            # 소관부처 이관(H-29 9항) — MST가 그대로여도 부처명만 바뀔 수 있어 따로 본다
            if row.get("소관부처명") and row["소관부처명"] != fam.get("소관부처명"):
                items.append(make_item("law_dept_changed", law, layer, {"법령ID": lid},
                                       {"소관부처명": fam.get("소관부처명", "")},
                                       {"소관부처명": row["소관부처명"], "MST": mst, "시행일자": efyd},
                                       [], ev))
            if mst == fam["MST"]:
                continue    # 우리가 이미 가진 바로 그 버전 — 변동 아님
            # 법령명 변경(H-29 11항) — 법령ID가 같은데 이름이 다르면 개명
            if row.get("법령명한글") and row["법령명한글"] != fam.get("법령명"):
                items.append(make_item("law_renamed", law, layer, {"법령ID": lid},
                                       {"법령명": fam.get("법령명", ""), "MST": fam["MST"]},
                                       after, [], ev))
            if status == "연혁" and str(row.get("공포일자", "")) <= fam.get("공포일자", ""):
                continue    # 우리 것보다 오래된 과거 버전 — 무시
            arts, info = changed_articles(mst, efyd)
            time.sleep(SLEEP)
            if info.get("소관부처"):
                소관 = info["소관부처"]
                after["소관부처명"] = 소관.get("content", after["소관부처명"]) if isinstance(소관, dict) else after["소관부처명"]
            kind = "law_pending" if status == "시행예정" else "law_amended"
            before = {k: fam.get(k, "") for k in ("MST", "법령명", "공포번호", "공포일자", "시행일자", "소관부처명")}
            items.append(make_item(kind, law, layer, {"법령ID": lid}, before, after, arts, ev))
        time.sleep(SLEEP)
    return items, queries


def scan_admruls(base, by_admrul, days):
    """행정규칙 광역질의(발령일자 내림차순 페이징)로 최근 N일 발령분을 훑어, 우리가 아는 고시의
    개정본(admrul_amended)과 우리 목록에 없는 신규 발령(admrul_unknown_new)을 가른다.
    @returns {tuple[list, int]} (큐 항목들, 실행한 질의 수)
    [연계] date 파라미터는 범위(~)를 지원하지 않음이 실측 확인돼(H29_design.md §4) sort=ddes로
           페이징하며 컷오프에서 끊는다. 개정 확정은 반드시 양쪽 발령일자 비교(L-59).
    """
    cutoff = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
    items, queries = [], 0
    for org in base["ministries"]:
        queries += 1
        rows, page = [], 1
        while page <= MAX_PAGES:
            got = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target=admrul"
                      f"&display=100&page={page}&org={org}&sort=ddes")
            box = (got or {}).get("AdmRulSearch") or {}
            batch = box.get("admrul") or []
            if isinstance(batch, dict):
                batch = [batch]
            if not batch:
                break
            rows.extend([r for r in batch if str(r.get("발령일자", "")) >= cutoff])
            if str(batch[-1].get("발령일자", "")) < cutoff:
                break
            page += 1
            time.sleep(SLEEP)
        for row in rows:
            title = row.get("행정규칙명", "")
            nt = norm_title(title)
            m = re.search(r"ID=(\d+)", row.get("행정규칙상세링크", "") or "")
            new_id = m.group(1) if m else ""
            ev = {"query": "A1", "org": org, "발령일자": str(row.get("발령일자", ""))}
            hits = by_admrul.get(nt)
            if not hits:
                law0 = {"slug": "", "name": "", "raw": ""}
                items.append(make_item("admrul_unknown_new", law0, "행정규칙",
                                       {"행정규칙ID": str(row.get("행정규칙ID", "")), "ID": new_id},
                                       {}, {"제목": title, "ID": new_id,
                                            "발령일자": str(row.get("발령일자", "")),
                                            "시행일자": str(row.get("시행일자", "")),
                                            "소관부처명": row.get("소관부처명", ""),
                                            "제개정구분명": row.get("제개정구분명", "")}, [], ev))
                continue
            for law, a in hits:
                if not new_id or new_id == a["ID"]:
                    continue
                cur, old = admrul_detail(new_id), admrul_detail(a["ID"])
                time.sleep(SLEEP)
                if not cur or not old:
                    continue
                if str(cur.get("행정규칙ID", "")) != str(old.get("행정규칙ID", "")):
                    continue    # 제목이 비슷해도 다른 문서 — 행정규칙ID(개정돼도 불변)가 다르면 개정본이 아니다
                if str(cur.get("발령일자", "")) <= str(old.get("발령일자", "")):
                    continue    # L-59: ID가 달라도 실제로는 더 오래된 판 — 오탐이므로 버린다
                items.append(make_item("admrul_amended", law, "행정규칙",
                                       {"행정규칙ID": str(cur.get("행정규칙ID", "")), "ID": new_id},
                                       {"제목": a["제목"], "ID": a["ID"], "행정규칙ID": str(old.get("행정규칙ID", "")),
                                        "발령일자": str(old.get("발령일자", "")),
                                        "시행일자": str(old.get("시행일자", ""))},
                                       {"제목": title, "ID": new_id, "발령일자": str(cur.get("발령일자", "")),
                                        "시행일자": str(cur.get("시행일자", "")),
                                        "소관부처명": cur.get("소관부처명", ""),
                                        "제개정구분명": cur.get("제개정구분명", "")}, [], ev))
        time.sleep(SLEEP)
    return items, queries


def run(days):
    base = json.load(open(BASELINE, encoding="utf-8"))
    by_lawid, by_admrul = index_baseline(base)
    print(f"baseline {base['law_count']}법 · 법령ID {len(by_lawid)} · 고시 {len(by_admrul)} · "
          f"부처 {len(base['ministries'])}곳 — 최근 {days}일 스캔 시작", flush=True)
    law_items, q1 = scan_laws(base, by_lawid, days)
    print(f"법령 광역질의 {q1}회 → 후보 {len(law_items)}건", flush=True)
    adm_items, q2 = scan_admruls(base, by_admrul, days)
    print(f"행정규칙 광역질의 {q2}회 → 후보 {len(adm_items)}건", flush=True)

    try:
        queue = json.load(open(QUEUE, encoding="utf-8"))
    except Exception:
        queue = {"updated_at": "", "scans": [], "items": []}
    known = {i["dedupe_key"] for i in queue["items"]}
    fresh = []
    for i in law_items + adm_items:      # 이번 실행 안에서 생긴 중복(같은 고시가 두 법에 위임 등)도 함께 제거
        if i["dedupe_key"] in known:
            continue
        known.add(i["dedupe_key"])
        fresh.append(i)
    queue["items"].extend(fresh)
    queue["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+09:00")
    queue["scans"].append({"ran_at": queue["updated_at"], "days": days,
                           "queries": q1 + q2, "candidates": len(law_items) + len(adm_items),
                           "new_items": len(fresh)})
    json.dump(queue, open(QUEUE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    by_kind = {}
    for i in fresh:
        by_kind[i["kind"]] = by_kind.get(i["kind"], 0) + 1
    print(f"\n=== 신규 {len(fresh)}건 적재(누적 {len(queue['items'])}건) → {QUEUE}\n    유형별: {by_kind} ===",
          flush=True)


if __name__ == "__main__":
    n = 7
    if "--days" in sys.argv:
        n = int(sys.argv[sys.argv.index("--days") + 1])
    run(n)
