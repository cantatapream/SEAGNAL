#!/usr/bin/env python3
"""budchik_check.json에서 mismatch(raw엔 없는데 API엔 있음)로 확인된 건들의
부칙을 실제로 API에서 받아와 raw 파일 끝에 추가한다(H-26 후속, 파이프라인 결함 복구).
[연계] 입력: _dashboard/budchik_check.json + raw/**/_meta.json(MST)
       출력: raw/<법>/<법률|시행령|시행규칙>.txt 끝에 "부칙" 섹션 추가(원문 그대로, 재가공 없음)
[로드 순서] 단독 실행. AI 불필요. 이미 파일 끝에 "부칙"(정확히 그 줄)이 있으면 skip(재실행 안전).
"""
import json, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import law_api_guard                 # DRF 오류쪽 판별 + 현행 시행일 판 고정(L-294·L-295)

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
CHECK_FILE = f"{LEGAL}/_dashboard/budchik_check.json"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
LOG_FILE = f"{LEGAL}/_dashboard/budchik_recollect_log.json"
FILE_MAP = {"법률": "법률.txt", "시행령": "시행령.txt", "시행규칙": "시행규칙.txt"}

def api(url):
    """DRF 한 번 호출(JSON). 프록시가 종종 끊으므로 재시도하고, 오류쪽이면 사유를 찍는다."""
    for _ in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                body = resp.read().decode("utf-8", "replace")
            if body.lstrip()[:1] in "{[":
                return json.loads(body)
            reason = law_api_guard.block_reason(body)
            if reason:
                law_api_guard.announce(reason, url)
                if law_api_guard.is_fatal(reason):
                    return None
        except Exception:
            pass
        time.sleep(1.5)
    return None


def api_get(mst):
    """그 MST 의 **현행 시행일 판** 본문. 못 받으면 None.

    ★2026-09-21 수정. 종전에는 `target=law&MST=` 를 재시도 없이 한 번 불렀다. 두 가지가 틀렸다 —
      ① 한 MST 가 시행일 판을 둘 이상 가지면 `target=law` 는 **어느 판이 올지 못 고른다.**
         해양환경관리법 시행규칙 287955 는 `target=law` 로 20260701 판(부칙 **52**)이 오는데
         현행은 20260828 판(부칙 **53**)이다. **부칙을 세는 도구가 다른 판의 부칙을 세고 있었다.**
      ② 실패해도 그냥 예외로 터졌다(재시도 없음).
    이제 law_api_guard 가 현행 시행일자를 조회해 `efYd` 로 못 박고, 못 정하면 None 을 준다.
    """
    return law_api_guard.fetch_law_body(api, OC, mst)

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
