#!/usr/bin/env python3
"""admrul_pdf_extract_log.json의 skipped_shrink_guard 44건을, 실제로는 완전본인지
(구법이 과대수집이었거나 진짜 짧아진 경우) 아니면 첨부 PDF 자체가 델타(개정문)뿐이라
여전히 전문이 아닌지 판별한다(사용자 지시: 축소감지 보류분부터 정리).
[연계] 입력: admrul_pdf_extract_log.json(skipped_shrink_guard) + admrul_pdf_triage.json(new_id/attach_name)
       출력: _dashboard/shrink_guard_inspect.json ({법/제목: {verdict, new_len, old_len, has_article1, ...}})
[로드 순서] 단독 실행. AI 불필요(구조 마커 탐지). raw 파일은 건드리지 않음(조사만).
"""
import json, os, re, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(__file__))
import extract_admrul_pdf as ex

LEGAL = ex.LEGAL
LOG_FILE = f"{LEGAL}/_dashboard/admrul_pdf_extract_log.json"
TRIAGE_FILE = ex.TRIAGE_FILE
TARGET_LAWS_FILE = ex.TARGET_LAWS_FILE
OUT_FILE = f"{LEGAL}/_dashboard/shrink_guard_inspect.json"

DELTA_MARKERS = ("다음과 같이 개정한다", "일부를 다음과 같이", "신설한다", "본문에 " )

def classify_body(body, old_len):
    has_art1 = bool(re.search(r"제\s*1\s*조\s*\(", body))
    has_many_articles = len(re.findall(r"제\s*\d+\s*조\s*\(", body)) >= 3
    looks_delta = any(m in body[:3000] for m in DELTA_MARKERS) and not has_many_articles
    if has_art1 and has_many_articles:
        verdict = "genuine_fulltext_shorter"   # 구조 갖춘 완전본 — 실제로 짧아진 게 맞음, 적용 가능
    elif looks_delta:
        verdict = "delta_only"                 # 개정문(델타)뿐 — 전문 아님, 적용 보류
    else:
        verdict = "ambiguous"                  # 애매 — 사람 확인
    return verdict, has_art1, has_many_articles

_lock = threading.Lock()
def _save(results):
    with _lock:
        json.dump(results, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(key, triage_entry, old_len, laws_by_slug, results):
    if key in results:
        return
    kind = triage_entry.get("kind")
    new_id = triage_entry.get("new_id")
    if kind == "no_pdf_attachment":
        task_kind, attach_name = ex._classify_no_pdf(triage_entry.get("attach_names") or [])
    else:
        task_kind, attach_name = kind, triage_entry.get("attach_name")
    if task_kind not in ("text", "hwpx") or not attach_name:
        with _lock:
            results[key] = {"verdict": "not_supported", "kind": kind}
        _save(results)
        return
    try:
        d = ex.api_get(new_id)
        node = d.get("AdmRulService", {})
        attach = node.get("첨부파일", {}) or {}
        links = attach.get("첨부파일링크") or []
        names = attach.get("첨부파일명") or []
        if isinstance(links, str):
            links = [links]
        if isinstance(names, str):
            names = [names]
        idx = names.index(attach_name)
        if task_kind == "text":
            tmp = f"{ex.TMP_DIR}/inspect_{new_id}.pdf"
            ex.download(links[idx], tmp)
            pages = ex.extract_pdf_text(tmp)
            os.remove(tmp)
            body = "\n\f\n".join(pages)
        else:
            tmp = f"{ex.TMP_DIR}/inspect_{new_id}.hwpx"
            ex.download(links[idx], tmp)
            body = ex.extract_hwpx_text(tmp) or ""
            os.remove(tmp)
        verdict, has_art1, has_many = classify_body(body, old_len)
        with _lock:
            results[key] = {"verdict": verdict, "new_len": len(body), "old_len": old_len,
                             "has_article1": has_art1, "has_many_articles": has_many,
                             "attach_name": attach_name, "new_id": new_id}
        print(f"{key}: {verdict} (new={len(body)} old={old_len})", flush=True)
    except Exception as e:
        with _lock:
            results[key] = {"verdict": "error", "reason": str(e)}
    _save(results)

def main(workers=6):
    log = json.load(open(LOG_FILE, encoding="utf-8"))
    triage = json.load(open(TRIAGE_FILE, encoding="utf-8"))
    groups = json.load(open(TARGET_LAWS_FILE, encoding="utf-8"))
    laws_by_slug = {l["slug"]: l for g in groups.values() for l in g}

    try:
        results = json.load(open(OUT_FILE, encoding="utf-8"))
    except Exception:
        results = {}

    targets = [(k, v) for k, v in log.items() if v.get("status") == "skipped_shrink_guard"]
    print(f"대상 {len(targets)}건", flush=True)

    tasks = []
    for key, v in targets:
        m = re.search(r"\((\d+)->(\d+)자\)", v.get("reason", ""))
        old_len = int(m.group(1)) if m else 0
        tasks.append((key, triage[key], old_len))

    with ThreadPoolExecutor(max_workers=workers) as exctr:
        futs = [exctr.submit(_worker, k, t, o, laws_by_slug, results) for k, t, o in tasks]
        for f in as_completed(futs):
            f.result()

    from collections import Counter
    print("판정 결과:", dict(Counter(v.get("verdict") for v in results.values())), flush=True)

if __name__ == "__main__":
    main()
