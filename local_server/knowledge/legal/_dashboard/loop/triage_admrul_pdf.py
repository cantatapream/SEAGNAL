#!/usr/bin/env python3
"""admrul_fix_log.json에서 skipped(첨부파일형/축소감지)로 남은 150건을,
첨부 PDF를 실제로 받아 PyMuPDF로 텍스트밀도·이미지수를 재서 3종(순수텍스트/혼합/이미지형)으로
사전분류한다(L-29 후속, 사용자 지시: 재수집 전에 먼저 규모·유형 파악).
[연계] 입력: _dashboard/admrul_fix_log.json(skipped_* 150건) + admrul_id_check.json(search_id)
       출력: _dashboard/admrul_pdf_triage.json ({법/제목: {new_id, kind, pages, avg_chars_per_page, img_pages_ratio, attach_name}})
[로드 순서] 단독 실행. AI 불필요(순수 API+PyMuPDF 기계적 판정). 재실행 안전(이미 처리된 키 skip).
"""
import json, os, re, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import fitz

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
FIX_LOG = f"{LEGAL}/_dashboard/admrul_fix_log.json"
CHECK_FILE = f"{LEGAL}/_dashboard/admrul_id_check.json"
OUT_FILE = f"{LEGAL}/_dashboard/admrul_pdf_triage.json"
TMP_DIR = "/tmp/admrul_pdf_triage"
os.makedirs(TMP_DIR, exist_ok=True)

def api_get(id_):
    url = f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={id_}&type=JSON"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def download(url, path):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    with open(path, "wb") as f:
        f.write(data)
    return len(data)

BAD_NAME_KEYWORDS = ("이유서", "신구대조표", "취지")

def pick_fulltext_pdf(links, names):
    """첨부파일 중 '조문별제개정이유서'·'신구대조표' 등 본문이 아닌 부속서류를 제외하고,
    본문 후보가 여러 개면 실제로 받아 크기를 비교해 가장 큰(=가장 완전한) 것을 고른다."""
    candidates = [i for i, n in enumerate(names)
                  if n.lower().endswith(".pdf") and not any(kw in n for kw in BAD_NAME_KEYWORDS)]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    sizes = []
    for i in candidates:
        req = urllib.request.Request(links[i], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            sizes.append((i, len(resp.read())))
    return max(sizes, key=lambda x: x[1])[0]

_lock = threading.Lock()
def _save(results):
    with _lock:
        json.dump(results, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def classify(doc):
    n = doc.page_count
    if n == 0:
        return "empty", 0, 0.0, 0.0
    sample_n = min(n, 30)
    step = max(1, n // sample_n)
    idxs = list(range(0, n, step))[:sample_n]
    total_chars = 0
    img_pages = 0
    for i in idxs:
        t = doc[i].get_text()
        total_chars += len(t)
        if len(doc[i].get_images()) > 0:
            img_pages += 1
    avg_chars = total_chars / len(idxs)
    img_ratio = img_pages / len(idxs)
    if avg_chars < 30:
        kind = "image_scanned"       # 텍스트가 거의 없음 — 스캔본, OCR 필수
    elif img_ratio > 0.3 and avg_chars < 400:
        kind = "mixed"               # 텍스트도 있지만 표/도해가 이미지로 다수 — OCR 보강 필요
    else:
        kind = "text"                # 텍스트 밀도 충분 — pdftotext급 추출로 충분
    return kind, n, round(avg_chars, 1), round(img_ratio, 2)

def _worker(key, new_id, results):
    if key in results:
        return
    try:
        d = api_get(new_id)
        node = d.get("AdmRulService", {})
        info = node.get("행정규칙기본정보", {})
        attach = node.get("첨부파일", {}) or {}
        links = attach.get("첨부파일링크") or []
        names = attach.get("첨부파일명") or []
        if isinstance(links, str):
            links = [links]
        if isinstance(names, str):
            names = [names]
        pdf_idx = pick_fulltext_pdf(links, names)
        jomun = node.get("조문내용")
        jomun_len = len(jomun) if isinstance(jomun, str) else 0
        if pdf_idx is None:
            with _lock:
                results[key] = {"new_id": new_id, "kind": "no_pdf_attachment",
                                 "jomun_len": jomun_len, "attach_names": names,
                                 "현행여부": info.get("현행여부")}
            _save(results)
            return
        url = links[pdf_idx]
        name = names[pdf_idx]
        path = f"{TMP_DIR}/{new_id}.pdf"
        size = download(url, path)
        doc = fitz.open(path)
        kind, pages, avg_chars, img_ratio = classify(doc)
        doc.close()
        os.remove(path)
        with _lock:
            results[key] = {"new_id": new_id, "kind": kind, "pages": pages,
                             "avg_chars_per_page": avg_chars, "img_page_ratio": img_ratio,
                             "file_size": size, "attach_name": name, "jomun_len": jomun_len,
                             "현행여부": info.get("현행여부")}
        print(f"{key}: {kind} (pages={pages}, avg_chars={avg_chars}, img_ratio={img_ratio})", flush=True)
    except Exception as e:
        with _lock:
            results[key] = {"new_id": new_id, "kind": "error", "reason": str(e)}
    _save(results)
    time.sleep(0.2)

def main(workers=8):
    fix_log = json.load(open(FIX_LOG, encoding="utf-8"))
    check = json.load(open(CHECK_FILE, encoding="utf-8"))
    # key(법/제목) -> search_id(현재ID) 매핑
    id_by_key = {}
    for slug, rows in check.items():
        for r in rows:
            if r.get("match") is False:
                id_by_key[f"{slug}/{r['title']}"] = r["search_id"]

    targets = [(k, id_by_key[k]) for k, v in fix_log.items()
               if v.get("status") in ("skipped_attachment_type", "skipped_shrink_guard") and k in id_by_key]

    try:
        results = json.load(open(OUT_FILE, encoding="utf-8"))
    except Exception:
        results = {}

    todo = [(k, i) for k, i in targets if k not in results]
    print(f"대상 {len(targets)}건 중 미처리 {len(todo)}건, 워커 {workers}개 병렬", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, k, i, results) for k, i in todo]
        for f in as_completed(futs):
            f.result()

    from collections import Counter
    c = Counter(v.get("kind") for v in results.values())
    print("분류 결과:", dict(c), flush=True)

if __name__ == "__main__":
    main()
