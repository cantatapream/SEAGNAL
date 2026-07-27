#!/usr/bin/env python3
"""admrul_id_check.json에서 mismatch(구버전 ID 의심)로 확인된 290건을,
제목검색으로 찾은 현행 ID로 본문을 재수집해 raw 파일을 덮어쓰고 _admrul.json도 갱신한다(H-26 후속).
[연계] 입력: _dashboard/admrul_id_check.json({법: [{title, stored_id, search_id, match}]})
       출력: raw/<법>/행정규칙/<제목>.txt 덮어쓰기(현행 ID로 재수집) + _admrul.json의 ID 갱신
[로드 순서] 단독 실행. AI 불필요(순수 API 대조·재수집). 재실행 안전(status=fixed면 skip).
"""
import json, os, re, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
CHECK_FILE = f"{LEGAL}/_dashboard/admrul_id_check.json"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
LOG_FILE = f"{LEGAL}/_dashboard/admrul_fix_log.json"

def api_get(id_):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={id_}&type=JSON"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def safe_filename(title):
    # collect_admrul.py의 safe()와 동일 규칙(공백 제거·60자 절단)이어야 raw 폴더의
    # 기존 파일명과 일치해 '덮어쓰기'가 되고, 다른 이름의 중복 파일이 새로 생기지 않는다.
    return re.sub(r'[\\/:*?"<>|]', '', title).replace(' ', '')[:60]

def build_text(node, title, new_id):
    info = node.get("행정규칙기본정보", {})
    lines = [f"[고시/행정규칙] {title}",
             f"ID:{new_id} · 소관부서: {info.get('담당부서기관명') or info.get('소관부처명')} · 전화번호: {info.get('전화번호')}",
             f"발령: {info.get('발령번호')} ({info.get('시행일자')}) · 제개정: {info.get('제개정구분명')} · 현행여부: {info.get('현행여부')}",
             ""]
    body = node.get("조문내용")
    if isinstance(body, list):
        lines.extend(str(x) for x in body)
    elif body:
        lines.append(str(body))
    return "\n".join(lines) + "\n"

_lock = threading.Lock()
def _save(log):
    with _lock:
        json.dump(log, open(LOG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(slug, raw_dir, row, log):
    title = row["title"]
    new_id = row["search_id"]
    key = f"{slug}/{title}"
    admrul_dir = f"{raw_dir}/행정규칙"
    fname = safe_filename(title) + ".txt"
    path = f"{admrul_dir}/{fname}"
    old_content = ""
    if os.path.exists(path):
        old_content = open(path, encoding="utf-8").read()
        # L-29: 첨부 PDF를 pdftotext로 전사해 수집한 파일은 API 조문내용이 안 담고 있으므로
        # 자동 덮어쓰기 대상에서 제외한다(스킵). 단순 재확인용 재실행에도 안전(멱등).
        if "전사" in old_content[:1000] or "pdftotext" in old_content or len(old_content) > 20000:
            with _lock:
                log[key] = {"status": "skipped_attachment_type", "reason": "첨부파일 전사본으로 추정 — 자동 덮어쓰기 제외(L-29)"}
            _save(log)
            return
    try:
        d = api_get(new_id)
        node = d.get("AdmRulService", {})
        if not node.get("행정규칙기본정보"):
            with _lock:
                log[key] = {"status": "error", "reason": "현행ID 응답에 기본정보 없음"}
            _save(log)
            return
        text = build_text(node, title, new_id)
        # 안전장치: 기존 파일이 있는데 새 본문이 절반 이하로 줄어들면 유실 의심 — 덮어쓰지 않고 스킵.
        if old_content and len(old_content) > 1000 and len(text) < len(old_content) * 0.5:
            with _lock:
                log[key] = {"status": "skipped_shrink_guard", "reason": f"본문 축소 감지({len(old_content)}->{len(text)}자) — 유실 의심, 사람 확인 필요"}
            _save(log)
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with _lock:
            log[key] = {"status": "fixed", "old_id": row["stored_id"], "new_id": new_id, "file": fname}
        print(f"{key}: 재수집 완료 ({row['stored_id']} -> {new_id})", flush=True)
    except Exception as e:
        with _lock:
            log[key] = {"status": "error", "reason": f"API 호출 실패: {e}"}
    _save(log)
    time.sleep(0.2)

def _update_admrul_json(slug, raw_dir, log):
    """title -> {ID:...} 매핑을 fixed 결과로 갱신"""
    path = f"{raw_dir}/행정규칙/_admrul.json"
    try:
        admruls = json.load(open(path, encoding="utf-8"))
    except Exception:
        return
    changed = False
    for title, entry in admruls.items():
        key = f"{slug}/{title}"
        if key in log and log[key].get("status") == "fixed":
            entry["ID"] = log[key]["new_id"]
            entry["ID_수정이력"] = f"{log[key]['old_id']} -> {log[key]['new_id']} (2026-07-27 H-26 재검증)"
            changed = True
    if changed:
        json.dump(admruls, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def main(workers=20):
    check = json.load(open(CHECK_FILE, encoding="utf-8"))
    groups = json.load(open(TARGET_LAWS_FILE, encoding="utf-8"))
    laws_by_slug = {l["slug"]: l for g in groups.values() for l in g}

    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = {}

    tasks = []
    affected_slugs = set()
    for slug, rows in check.items():
        if slug not in laws_by_slug:
            continue
        raw_dir = laws_by_slug[slug]["raw"]
        for row in rows:
            if row.get("match") is not False:
                continue
            key = f"{slug}/{row['title']}"
            if key in log and log[key].get("status") == "fixed":
                continue
            tasks.append((slug, raw_dir, row))
            affected_slugs.add(slug)

    print(f"재수집 대상 {len(tasks)}건, 워커 {workers}개 병렬", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, *t, log) for t in tasks]
        for f in as_completed(futs):
            f.result()

    for slug in affected_slugs:
        _update_admrul_json(slug, laws_by_slug[slug]["raw"], log)

    ok = sum(1 for v in log.values() if v.get("status") == "fixed")
    print(f"완료: {ok}건 재수집+ID교정 / 전체 {len(log)}건 처리, _admrul.json {len(affected_slugs)}개 법 갱신", flush=True)

if __name__ == "__main__":
    main()
