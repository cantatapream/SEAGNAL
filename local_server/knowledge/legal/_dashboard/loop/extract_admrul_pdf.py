#!/usr/bin/env python3
"""admrul_pdf_triage.json에서 kind=text(PDF 텍스트밀도 충분) 또는 hwpx(PDF 없이 HWPX만)로
분류된 126건을 실제로 추출해 raw 파일에 반영한다(L-29 후속, 사용자 지시: "126건부터 진행").
[연계] 입력: admrul_pdf_triage.json(분류 결과) + audit9_groups.json(raw 경로) + 각 법의 _admrul.json(위임 정보)
       출력: raw/<법>/행정규칙/<제목>.txt 전체 교체(PyMuPDF/HWPX-XML 직접 파싱, 원문 그대로) + _admrul.json ID 갱신
[로드 순서] 단독 실행. AI 불필요(순수 추출, LLM 미사용). 재실행 안전(status=done이면 skip).
"""
import json, os, re, threading, zipfile, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
import fitz

OC = "hyoo1431"
LEGAL = "/home/user/SEAGNAL/local_server/knowledge/legal"
TRIAGE_FILE = f"{LEGAL}/_dashboard/admrul_pdf_triage.json"
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
LOG_FILE = f"{LEGAL}/_dashboard/admrul_pdf_extract_log.json"
TMP_DIR = "/tmp/admrul_pdf_extract"
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
    open(path, "wb").write(data)

def safe_filename(title):
    return re.sub(r'[\\/:*?"<>|]', '', title).replace(' ', '')[:60]

def extract_page_gapaware(page, threshold=0.15):
    # law.go.kr 첨부 PDF 중 다수가 한글 어절 사이에 실제 공백 문자 없이(글자 간격만으로)
    # 조판돼 있어, 단순 get_text()는 "미개량기술을확보하고"처럼 붙어버린다.
    # 글자 단위 bbox 간격(gap)이 평균 글자높이의 threshold배를 넘으면 어절 경계로 보고 공백 삽입.
    d = page.get_text("rawdict")
    page_lines = []
    for block in d["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            line_chars = []
            for span in line["spans"]:
                line_chars.extend(span.get("chars", []))
            if not line_chars:
                fallback = "".join(span.get("text", "") for span in line["spans"])
                if fallback.strip():
                    page_lines.append(fallback)
                continue
            heights = [c["bbox"][3] - c["bbox"][1] for c in line_chars]
            avg_h = sum(heights) / len(heights) if heights else 10
            out = []
            prev_x1 = None
            for c in line_chars:
                ch = c["c"]
                x0, y0, x1, y1 = c["bbox"]
                if prev_x1 is not None and ch != " ":
                    gap = x0 - prev_x1
                    if gap > avg_h * threshold:
                        out.append(" ")
                out.append(ch)
                prev_x1 = x1
            page_lines.append(re.sub(r"  +", " ", "".join(out)))
        page_lines.append("")
    return "\n".join(page_lines)

def extract_pdf_text(path):
    doc = fitz.open(path)
    pages = [extract_page_gapaware(doc[i]) for i in range(doc.page_count)]
    doc.close()
    return pages

def extract_hwpx_text(path):
    ns_p = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
    with zipfile.ZipFile(path) as z:
        section_files = sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml", n))
        if not section_files:
            return None
        paras = []
        for sf in section_files:
            root = ET.fromstring(z.read(sf))
            for p in root.iter(f"{ns_p}p"):
                texts = [t.text for t in p.iter(f"{ns_p}t") if t.text]
                if texts:
                    paras.append("".join(texts))
    return "\n".join(paras)

def delegation_note(admrul_entry):
    if not admrul_entry or not admrul_entry.get("위임"):
        return ""
    arts = []
    for w in admrul_entry["위임"]:
        a = w.get("위임조")
        if a and a not in arts:
            arts.append(a)
    return f" · 위임근거: {','.join(arts)}" if arts else ""

def build_header(info, title, new_id, method_note, source_note, deleg_note):
    lines = [
        f"[고시/행정규칙] {title}",
        f"ID:{new_id}{deleg_note}",
        f"⚠REVIEW / 출처: 국가법령정보센터(law.go.kr) 행정규칙 {source_note} / "
        f"시행일: {info.get('시행일자')} ({info.get('소관부처명')}고시 제{info.get('발령번호')}호, {info.get('제개정구분명')})",
        f"소관부서: {info.get('담당부서기관명') or info.get('소관부처명')} · 전화 {info.get('전화번호')}",
        "",
        f"※ 전사 방법 안내: {method_note}",
        "",
        "=" * 80,
        "",
    ]
    return "\n".join(lines)

_lock = threading.Lock()
def _save(log):
    with _lock:
        json.dump(log, open(LOG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(key, new_id, kind, attach_name, raw_dir, admrul_entry, log):
    title = key.split("/", 1)[1]
    path_out = f"{raw_dir}/행정규칙/{safe_filename(title)}.txt"
    old_content = open(path_out, encoding="utf-8").read() if os.path.exists(path_out) else ""
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
        # triage 단계에서 이미 확정한 attach_name(이유서/신구대조표 제외 후 최종 선택본)을 그대로 사용
        # — 여기서 다시 고르면 triage와 다른 파일을 골라 결과가 어긋날 수 있다.
        idx = names.index(attach_name)

        if kind == "text":
            tmp_path = f"{TMP_DIR}/{new_id}.pdf"
            download(links[idx], tmp_path)
            pages = extract_pdf_text(tmp_path)
            os.remove(tmp_path)
            body = "\n\f\n".join(pages)
            method = (f'첨부파일 "{names[idx]}"(총 {len(pages)}쪽)를 PyMuPDF로 텍스트 추출한 전문입니다. '
                      f"표·서식의 2차원 시각적 배치는 줄바꿈으로 근사될 수 있습니다.")
            source_note = "첨부파일 전사"
        elif kind == "hwpx":
            tmp_path = f"{TMP_DIR}/{new_id}.hwpx"
            download(links[idx], tmp_path)
            body = extract_hwpx_text(tmp_path)
            os.remove(tmp_path)
            if not body:
                raise ValueError("HWPX 본문 추출 실패(section xml 없음)")
            method = f'첨부파일 "{names[idx]}"(HWPX)의 XML 본문을 직접 파싱한 전문입니다.'
            source_note = "첨부파일(HWPX) 전사"
        else:
            raise ValueError(f"미지원 kind: {kind}")

        if len(body.strip()) < 200:
            with _lock:
                log[key] = {"status": "skipped_too_short", "reason": f"추출 결과 {len(body)}자 — 유실 의심, 보류"}
            _save(log)
            return

        # L-29 안전장치: 기존 raw 파일이 있는데 새 본문이 절반 이하로 줄면 유실 의심 — 덮어쓰지 않고 보류.
        if old_content and len(old_content) > 500 and len(body) < len(old_content) * 0.5:
            with _lock:
                log[key] = {"status": "skipped_shrink_guard",
                            "reason": f"본문 축소 감지({len(old_content)}->{len(body)}자) — 유실 의심, 사람 확인 필요"}
            _save(log)
            return

        header = build_header(info, title, new_id, method, source_note, delegation_note(admrul_entry))
        text = header + body.strip() + "\n"
        with open(path_out, "w", encoding="utf-8") as f:
            f.write(text)
        with _lock:
            log[key] = {"status": "done", "new_id": new_id, "kind": kind, "chars": len(text),
                        "file": os.path.basename(path_out)}
        print(f"{key}: 완료 ({kind}, {len(text)}자)", flush=True)
    except Exception as e:
        with _lock:
            log[key] = {"status": "error", "reason": str(e)}
    _save(log)

def _update_admrul_json(slug, raw_dir, log):
    path = f"{raw_dir}/행정규칙/_admrul.json"
    try:
        admruls = json.load(open(path, encoding="utf-8"))
    except Exception:
        return
    changed = False
    for title, entry in admruls.items():
        key = f"{slug}/{title}"
        if key in log and log[key].get("status") == "done":
            old_id = entry.get("ID")
            entry["ID"] = log[key]["new_id"]
            entry["ID_수정이력"] = f"{old_id} -> {log[key]['new_id']} (2026-07-27 PDF/HWPX 전문 재수집)"
            changed = True
    if changed:
        json.dump(admruls, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _classify_no_pdf(names):
    primary = next((n for n in names if "제개정이유서" not in n and "신구대조표" not in n), names[0] if names else "")
    if primary.lower().endswith(".hwpx"):
        return "hwpx", primary
    return None, None

def main(workers=6):
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

    tasks = []
    affected_slugs = set()
    for key, v in triage.items():
        kind = v.get("kind")
        if kind == "text":
            task_kind, attach_name = "text", v.get("attach_name")
        elif kind == "no_pdf_attachment":
            task_kind, attach_name = _classify_no_pdf(v.get("attach_names") or [])
        else:
            continue
        if task_kind is None or not attach_name:
            continue
        if key in log and log[key].get("status") == "done":
            continue
        slug, title = key.split("/", 1)
        if slug not in laws_by_slug:
            continue
        raw_dir = laws_by_slug[slug]["raw"]
        entry = get_admrul_entry(slug, raw_dir, title)
        tasks.append((key, v["new_id"], task_kind, attach_name, raw_dir, entry))
        affected_slugs.add(slug)

    print(f"대상 {len(tasks)}건, 워커 {workers}개 병렬", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, *t, log) for t in tasks]
        for f in as_completed(futs):
            f.result()

    for slug in affected_slugs:
        _update_admrul_json(slug, laws_by_slug[slug]["raw"], log)

    from collections import Counter
    c = Counter(v.get("status") for v in log.values())
    print(f"완료: {dict(c)}, _admrul.json {len(affected_slugs)}개 법 갱신", flush=True)

if __name__ == "__main__":
    main()
