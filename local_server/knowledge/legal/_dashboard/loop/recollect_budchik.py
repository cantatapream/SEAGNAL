#!/usr/bin/env python3
"""budchik_check.json에서 mismatch(raw엔 없는데 API엔 있음)로 확인된 건들의
부칙을 실제로 API에서 받아와 raw 파일 끝에 추가한다(H-26 후속, 파이프라인 결함 복구).
[연계] 입력: _dashboard/budchik_check.json + raw/**/_meta.json(MST)
       출력: raw/<법>/<법률|시행령|시행규칙>.txt 끝에 "부칙" 섹션 추가(원문 그대로, 재가공 없음)
[로드 순서] 단독 실행. AI 불필요. 이미 파일 끝에 "부칙"(정확히 그 줄)이 있으면 skip(재실행 안전).
"""
import json, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
CHECK_FILE = f"{LEGAL}/_dashboard/budchik_check.json"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
LOG_FILE = f"{LEGAL}/_dashboard/budchik_recollect_log.json"
FILE_MAP = {"법률": "법률.txt", "시행령": "시행령.txt", "시행규칙": "시행규칙.txt"}

def api_get(mst):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=law&MST={mst}&type=JSON"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def format_budchik(bu):
    unit = bu.get("부칙단위")
    if isinstance(unit, dict):
        unit = [unit]
    if not unit:
        return None
    lines = ["부칙", ""]
    for u in unit:
        content = u.get("부칙내용")
        if not content:
            continue
        for block in content:
            if isinstance(block, list):
                lines.extend(block)
            else:
                lines.append(block)
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"

_lock = threading.Lock()
def _save(log):
    with _lock:
        json.dump(log, open(LOG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(law_slug, layer, raw_dir, mst, log):
    key = f"{law_slug}/{layer}"
    fname = FILE_MAP.get(layer)
    path = f"{raw_dir}/{fname}"
    try:
        existing = open(path, encoding="utf-8").read()
    except Exception as e:
        with _lock:
            log[key] = {"status": "error", "reason": f"파일 읽기 실패: {e}"}
        _save(log)
        return
    if "\n부칙\n" in existing or existing.strip().endswith("부칙") or existing.startswith("부칙\n"):
        with _lock:
            log[key] = {"status": "skip", "reason": "이미 부칙 있음(재확인)"}
        _save(log)
        return
    try:
        d = api_get(mst)
        bu = d.get("법령", {}).get("부칙", {})
        text = format_budchik(bu)
        if not text:
            with _lock:
                log[key] = {"status": "no_budchik", "reason": "API 재확인 결과도 부칙 없음(변경됐을 수 있음)"}
            _save(log)
            return
        with open(path, "a", encoding="utf-8") as f:
            if not existing.endswith("\n"):
                f.write("\n")
            f.write("\n" + text)
        with _lock:
            log[key] = {"status": "added", "chars": len(text)}
    except Exception as e:
        with _lock:
            log[key] = {"status": "error", "reason": f"API 호출 실패: {e}"}
    _save(log)
    print(f"{key}: 완료", flush=True)
    time.sleep(0.2)

def main(workers=20):
    check = json.load(open(CHECK_FILE, encoding="utf-8"))
    groups = json.load(open(TARGET_LAWS_FILE, encoding="utf-8"))
    laws_by_slug = {l["slug"]: l for g in groups.values() for l in g}

    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = {}

    tasks = []
    for slug, layers in check.items():
        if "error" in layers or slug not in laws_by_slug:
            continue
        raw_dir = laws_by_slug[slug]["raw"]
        meta = json.load(open(f"{raw_dir}/_meta.json", encoding="utf-8"))
        for layer, info in layers.items():
            if not info.get("mismatch"):
                continue
            key = f"{slug}/{layer}"
            if key in log:
                continue
            fam = meta.get("families", {}).get(layer)
            if not isinstance(fam, dict) or "MST" not in fam:
                continue
            tasks.append((slug, layer, raw_dir, fam["MST"]))

    print(f"재수집 대상 {len(tasks)}건, 워커 {workers}개 병렬", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, *t, log) for t in tasks]
        for f in as_completed(futs):
            f.result()

    ok = sum(1 for v in log.values() if v.get("status") == "added")
    print(f"완료: {ok}건 추가 / 전체 {len(log)}건 처리", flush=True)

if __name__ == "__main__":
    main()
