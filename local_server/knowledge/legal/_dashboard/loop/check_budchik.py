#!/usr/bin/env python3
"""73법 raw(법률/시행령/시행규칙)에 부칙 섹션이 빠져있는지 전수 점검한다(H-26 후속).
[연계] 입력: raw/**/_meta.json(families MST) — 각 raw txt에 '부칙' 키워드 유무 확인
       + 없으면 DRF API(target=law)로 실제 부칙 존재 여부 재확인
       출력: _dashboard/budchik_check.json ({법명: {layer: {raw_has, api_has, mismatch}}})
[로드 순서] 단독 실행(python3 check_budchik.py). AI 불필요(순수 텍스트+API 대조).
"""
import json, glob, time, threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
OUT_FILE = f"{LEGAL}/_dashboard/budchik_check.json"

FILE_MAP = {"법률": "법률.txt", "시행령": "시행령.txt", "시행규칙": "시행규칙.txt"}

def api_get(mst):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def raw_has_budchik(path):
    try:
        text = open(path, encoding="utf-8").read()
    except Exception:
        return None  # 파일 없음(해당 layer 자체가 없는 법)
    return ("부칙" in text) and ("<부칙>" in text or "부칙 <" in text or "제1조(시행일)" in text or "부칙\n" in text or "부칙제" in text.replace(" ", ""))

def api_has_budchik(mst):
    try:
        d = api_get(mst)
        law = d.get("법령") or {}
        bu = law.get("부칙")
        if not bu:
            return False
        # 부칙단위가 실제 내용 있는지(빈 배열/빈 dict 방지)
        unit = bu.get("부칙단위")
        if isinstance(unit, list):
            return len(unit) > 0
        if isinstance(unit, dict):
            return bool(unit)
        return bool(bu)
    except Exception as e:
        return f"API_ERROR:{e}"

_lock = threading.Lock()
def _save(results):
    with _lock:
        json.dump(results, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(i, total, law, results):
    slug = law["slug"]
    raw_dir = law["raw"]
    print(f"[{i}/{total}] {slug} 확인 중", flush=True)
    meta_path = f"{raw_dir}/_meta.json"
    try:
        meta = json.load(open(meta_path, encoding="utf-8"))
    except Exception as e:
        with _lock:
            results[slug] = {"error": str(e)}
        _save(results)
        return

    law_result = {}
    for fam_name, fam in (meta.get("families") or {}).items():
        if not isinstance(fam, dict) or "MST" not in fam:
            continue
        fname = FILE_MAP.get(fam_name)
        if not fname:
            continue
        path = f"{raw_dir}/{fname}"
        has_raw = raw_has_budchik(path)
        if has_raw is None:
            continue  # 파일 자체 없음(해당 layer 미존재) — 정상, 점검 대상 아님
        entry = {"raw_has_budchik": has_raw}
        if not has_raw:
            # raw에 없다고 나온 것만 API로 재확인(호출 절약)
            entry["api_has_budchik"] = api_has_budchik(fam["MST"])
            entry["mismatch"] = (entry["api_has_budchik"] is True)
            time.sleep(0.3)
        law_result[fam_name] = entry

    with _lock:
        results[slug] = law_result
    _save(results)
    print(f"[{i}/{total}] {slug} 완료", flush=True)

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
    print(f"전체 {len(laws)}법 중 미완료 {len(todo)}법을 워커 {workers}개로 병렬 점검", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, i, len(laws), law, results) for i, law in todo]
        for f in as_completed(futs):
            f.result()

    mismatches = []
    for slug, r in results.items():
        if "error" in r:
            continue
        for fam, e in r.items():
            if e.get("mismatch"):
                mismatches.append(f"{slug}/{fam}")
    print(f"완료: {len(results)}법 점검. raw에 없는데 API엔 있는(=파이프라인 누락) 건: {len(mismatches)}", flush=True)
    for m in mismatches:
        print(" -", m, flush=True)

if __name__ == "__main__":
    main()
