#!/usr/bin/env python3
"""73법의 _admrul.json에 저장된 ID(lsDelegated 출처)가 최신 버전인지,
행정규칙명 검색(lawSearch target=admrul)으로 재확인해 구버전 ID 여부를 점검한다(H-26 후속).
[연계] 입력: raw/**/행정규칙/_admrul.json({제목: {ID, ...}})
       출력: _dashboard/admrul_id_check.json ({법명: [{title, stored_id, search_id, match, note}]})
[로드 순서] 단독 실행. AI 불필요(순수 API 대조). search 결과가 모호(0건/2건+)하면 mismatch 판정 안 함(inconclusive).
"""
import json, glob, time, threading, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
OUT_FILE = f"{LEGAL}/_dashboard/admrul_id_check.json"

def search_admrul(title):
    q = urllib.parse.quote(title)
    url = f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&target=admrul&type=JSON&query={q}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    node = d.get("AdmRulSearch", {})
    total = int(node.get("totalCnt", 0) or 0)
    if total == 0:
        return {"status": "not_found"}
    if total > 1:
        return {"status": "ambiguous", "count": total}
    item = node.get("admrul")
    if isinstance(item, list):
        item = item[0]
    return {"status": "found", "id": item.get("행정규칙일련번호"), "name": item.get("행정규칙명")}

_lock = threading.Lock()
def _save(results):
    with _lock:
        json.dump(results, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(i, total, law, results):
    slug = law["slug"]
    raw_dir = law["raw"]
    admrul_path = f"{raw_dir}/행정규칙/_admrul.json"
    print(f"[{i}/{total}] {slug} 확인 중", flush=True)
    try:
        admruls = json.load(open(admrul_path, encoding="utf-8"))
    except Exception:
        with _lock:
            results[slug] = []
        _save(results)
        return

    rows = []
    for title, entry in admruls.items():
        if title.startswith("_") or not isinstance(entry, dict):
            continue
        stored_id = entry.get("ID")
        if not stored_id:
            continue
        try:
            r = search_admrul(title)
        except Exception as e:
            rows.append({"title": title, "stored_id": stored_id, "note": f"검색실패: {e}"})
            time.sleep(0.25)
            continue
        if r["status"] == "found":
            match = (r["id"] == stored_id)
            rows.append({"title": title, "stored_id": stored_id, "search_id": r["id"],
                         "search_name": r.get("name"), "match": match})
        else:
            rows.append({"title": title, "stored_id": stored_id, "note": r["status"]})
        time.sleep(0.25)

    with _lock:
        results[slug] = rows
    _save(results)
    print(f"[{i}/{total}] {slug} 완료 ({len(rows)}건)", flush=True)

def main(workers=20):
    groups = json.load(open(TARGET_LAWS_FILE, encoding="utf-8"))
    laws = []
    for k in sorted(groups.keys(), key=int):
        laws.extend(groups[k])
    try:
        results = json.load(open(OUT_FILE, encoding="utf-8"))
    except Exception:
        results = {}
    todo = [(i, law) for i, law in enumerate(laws, 1) if law["slug"] not in results]
    print(f"전체 {len(laws)}법 중 미완료 {len(todo)}법을 워커 {workers}개로 병렬 재검증", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, i, len(laws), law, results) for i, law in todo]
        for f in as_completed(futs):
            f.result()

    mismatches = []
    for slug, rows in results.items():
        for r in rows:
            if r.get("match") is False:
                mismatches.append(f"{slug} / {r['title']}: stored={r['stored_id']} search={r['search_id']}")
    print(f"완료: {len(results)}법 재검증. ID 불일치(구버전 의심) 건: {len(mismatches)}", flush=True)
    for m in mismatches:
        print(" -", m, flush=True)

if __name__ == "__main__":
    main()
