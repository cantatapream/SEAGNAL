#!/usr/bin/env python3
"""admrul_pdf_triage.json에서 kind=no_pdf_attachment이고 첨부가 구형 HWP(바이너리)인
잔여 7건을 pyhwp(hwp5txt+hwp5html 병용)로 실제 전문을 추출해 raw에 반영한다.
[연계] 입력: admrul_pdf_triage.json + audit9_groups.json(raw 경로) + 각 법의 _admrul.json(위임 정보)
       pyhwp는 최신 setuptools와 호환 안 돼(L-32) /tmp/hwpvenv 격리 venv에 설치해 사용.
       출력: raw/<법>/행정규칙/<제목>.txt 전체 교체 + _admrul.json ID 갱신(오케스트레이터가 사후 일괄)
[로드 순서] 단독 실행. AI 불필요(순수 변환). 재실행 안전(status=done이면 skip).
사전조건: python3 -m venv /tmp/hwpvenv && /tmp/hwpvenv/bin/pip install "setuptools<60" wheel six pyhwp
"""
import json, os, re, subprocess, sys, warnings
sys.path.insert(0, os.path.dirname(__file__))
import extract_admrul_pdf as ex
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

HWPVENV = "/tmp/hwpvenv/bin"
LEGAL = ex.LEGAL
TRIAGE_FILE = ex.TRIAGE_FILE
TARGET_LAWS_FILE = ex.TARGET_LAWS_FILE
LOG_FILE = f"{LEGAL}/_dashboard/admrul_hwp_extract_log.json"
TMP_DIR = "/tmp/admrul_hwp_extract"
os.makedirs(TMP_DIR, exist_ok=True)

def table_to_text(table):
    rows = []
    for tr in table.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        rows.append(" | ".join(cells))
    return "\n".join(rows)

def hwp_to_text(hwp_path, work_dir):
    txt_path = f"{work_dir}/out.txt"
    html_dir = f"{work_dir}/html"
    r1 = subprocess.run([f"{HWPVENV}/hwp5txt", hwp_path, "--output", txt_path],
                         capture_output=True, text=True, timeout=600)
    if r1.returncode != 0:
        raise RuntimeError(f"hwp5txt 실패: {r1.stderr[:500]}")
    text = open(txt_path, encoding="utf-8").read()

    if "<표>" not in text:
        return text

    r2 = subprocess.run([f"{HWPVENV}/hwp5html", hwp_path, "--output", html_dir],
                         capture_output=True, text=True, timeout=600)
    if r2.returncode != 0:
        # 표 있는데 html 실패하면 표 위치만 남기고 진행(경고성 표시)
        return text.replace("<표>", "<표: HTML 변환 실패로 내용 누락 — 원본 대조 필요>")
    html = open(f"{html_dir}/index.xhtml", encoding="utf-8").read()
    soup = BeautifulSoup(html, "lxml")
    body = soup.find("body") or soup
    tables = [t for t in body.find_all("table") if not t.find_parent("table")]

    n_placeholders = text.count("<표>")
    if len(tables) != n_placeholders:
        # 개수 불일치 — 순서 매칭 신뢰 불가, 표 있음만 표시
        return text.replace("<표>", f"<표: hwp5txt {n_placeholders}개 vs hwp5html {len(tables)}개 불일치 — 원본 대조 필요>")

    parts = text.split("<표>")
    out = [parts[0]]
    for i, table in enumerate(tables):
        out.append("<표>\n" + table_to_text(table) + "\n</표>")
        out.append(parts[i + 1])
    return "".join(out)

def _worker(key, new_id, attach_name, raw_dir, admrul_entry, log):
    title = key.split("/", 1)[1]
    path_out = f"{raw_dir}/행정규칙/{ex.safe_filename(title)}.txt"
    old_content = open(path_out, encoding="utf-8").read() if os.path.exists(path_out) else ""
    work_dir = f"{TMP_DIR}/{new_id}"
    os.makedirs(work_dir, exist_ok=True)
    try:
        d = ex.api_get(new_id)
        node = d.get("AdmRulService", {})
        info = node.get("행정규칙기본정보", {})
        attach = node.get("첨부파일", {}) or {}
        links = attach.get("첨부파일링크") or []
        names = attach.get("첨부파일명") or []
        if isinstance(links, str):
            links = [links]
        if isinstance(names, str):
            names = [names]
        idx = names.index(attach_name)

        hwp_path = f"{work_dir}/src.hwp"
        ex.download(links[idx], hwp_path)
        body = hwp_to_text(hwp_path, work_dir)

        if len(body.strip()) < 200:
            log[key] = {"status": "skipped_too_short", "reason": f"추출 결과 {len(body)}자 — 유실 의심, 보류"}
            _save(log)
            return
        if old_content and len(old_content) > 500 and len(body) < len(old_content) * 0.5:
            log[key] = {"status": "skipped_shrink_guard",
                        "reason": f"본문 축소 감지({len(old_content)}->{len(body)}자) — 유실 의심, 사람 확인 필요"}
            _save(log)
            return

        method = f'첨부파일 "{attach_name}"(구형 HWP)를 pyhwp(hwp5txt 본문+hwp5html 표 병합)로 추출한 전문입니다.'
        header = ex.build_header(info, title, new_id, method, "첨부파일(HWP) 전사", ex.delegation_note(admrul_entry))
        text = header + body.strip() + "\n"
        with open(path_out, "w", encoding="utf-8") as f:
            f.write(text)
        log[key] = {"status": "done", "new_id": new_id, "chars": len(text), "file": os.path.basename(path_out)}
        print(f"{key}: 완료 ({len(text)}자)", flush=True)
    except Exception as e:
        log[key] = {"status": "error", "reason": str(e)}
        print(f"{key}: 에러 {e}", flush=True)
    _save(log)

def _save(log):
    json.dump(log, open(LOG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def main():
    triage = json.load(open(TRIAGE_FILE, encoding="utf-8"))
    groups = json.load(open(TARGET_LAWS_FILE, encoding="utf-8"))
    laws_by_slug = {l["slug"]: l for g in groups.values() for l in g}
    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = {}

    admrul_cache = {}
    def get_admrul_entry(slug, raw_dir, title):
        if slug not in admrul_cache:
            path = f"{raw_dir}/행정규칙/_admrul.json"
            try:
                admrul_cache[slug] = json.load(open(path, encoding="utf-8"))
            except Exception:
                admrul_cache[slug] = {}
        return admrul_cache[slug].get(title)

    for key, v in triage.items():
        if v.get("kind") != "no_pdf_attachment":
            continue
        names = v.get("attach_names") or []
        primary = next((n for n in names if "이유서" not in n and "신구대조표" not in n), names[0] if names else "")
        if not primary.lower().endswith(".hwp"):
            continue
        if key in log and log[key].get("status") == "done":
            continue
        slug, title = key.split("/", 1)
        if slug not in laws_by_slug:
            continue
        raw_dir = laws_by_slug[slug]["raw"]
        entry = get_admrul_entry(slug, raw_dir, title)
        _worker(key, v["new_id"], primary, raw_dir, entry, log)

    from collections import Counter
    print("완료:", dict(Counter(v.get("status") for v in log.values())), flush=True)

if __name__ == "__main__":
    main()
