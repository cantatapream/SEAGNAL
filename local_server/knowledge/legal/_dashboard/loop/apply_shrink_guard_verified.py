#!/usr/bin/env python3
"""shrink_guard_inspect.json에서 genuine_fulltext_shorter/ambiguous(사람이 실물 확인 후
승인)로 판정된 40건을 실제로 raw에 반영한다. delta_only(개정문뿐, 전문 없음) 4건은
원문을 그대로 두고 건드리지 않는다(사용자 지시: 축소감지 보류분 정리, L-29 후속).
[연계] 입력: shrink_guard_inspect.json(판정) + admrul_pdf_triage.json(new_id/attach_name)
       출력: raw/<법>/행정규칙/<제목>.txt 교체 + _admrul.json ID 갱신
[로드 순서] 단독 실행. AI 불필요. 재실행 안전(admrul_pdf_extract_log.json에 done으로 남으면 skip).
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import extract_admrul_pdf as ex

LEGAL = ex.LEGAL
INSPECT_FILE = f"{LEGAL}/_dashboard/shrink_guard_inspect.json"
APPROVED_VERDICTS = ("genuine_fulltext_shorter", "ambiguous")

def main():
    inspect = json.load(open(INSPECT_FILE, encoding="utf-8"))
    triage = json.load(open(ex.TRIAGE_FILE, encoding="utf-8"))
    groups = json.load(open(ex.TARGET_LAWS_FILE, encoding="utf-8"))
    laws_by_slug = {l["slug"]: l for g in groups.values() for l in g}

    try:
        log = json.load(open(ex.LOG_FILE, encoding="utf-8"))
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

    approved = [(k, v) for k, v in inspect.items() if v.get("verdict") in APPROVED_VERDICTS]
    print(f"승인된 {len(approved)}건 적용 시작", flush=True)

    affected_slugs = set()
    for key, iv in approved:
        if log.get(key, {}).get("status") == "done":
            print(f"{key}: 이미 done, skip", flush=True)
            continue
        slug, title = key.split("/", 1)
        if slug not in laws_by_slug:
            continue
        raw_dir = laws_by_slug[slug]["raw"]
        entry = get_admrul_entry(slug, raw_dir, title)
        tv = triage[key]
        kind = tv.get("kind")
        if kind == "no_pdf_attachment":
            task_kind, attach_name = ex._classify_no_pdf(tv.get("attach_names") or [])
        else:
            task_kind, attach_name = kind, tv.get("attach_name")
        # 이미 사람이 실물을 확인해 승인했으므로 shrink-guard를 우회하는 전용 강제 기록 경로 사용
        _force_write(key, tv["new_id"], task_kind, attach_name, raw_dir, entry, log)
        affected_slugs.add(slug)

    for slug in affected_slugs:
        ex._update_admrul_json(slug, laws_by_slug[slug]["raw"], log)

    from collections import Counter
    print("최종:", dict(Counter(v.get("status") for v in log.values())), flush=True)

def _force_write(key, new_id, kind, attach_name, raw_dir, admrul_entry, log):
    title = key.split("/", 1)[1]
    path_out = f"{raw_dir}/행정규칙/{ex.safe_filename(title)}.txt"
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

        if kind == "text":
            tmp_path = f"{ex.TMP_DIR}/{new_id}.pdf"
            ex.download(links[idx], tmp_path)
            pages = ex.extract_pdf_text(tmp_path)
            os.remove(tmp_path)
            body = "\n\f\n".join(pages)
            method = (f'첨부파일 "{names[idx]}"(총 {len(pages)}쪽)를 PyMuPDF로 텍스트 추출한 전문입니다. '
                      f"표·서식의 2차원 시각적 배치는 줄바꿈으로 근사될 수 있습니다.")
            source_note = "첨부파일 전사"
        elif kind == "hwpx":
            tmp_path = f"{ex.TMP_DIR}/{new_id}.hwpx"
            ex.download(links[idx], tmp_path)
            body = ex.extract_hwpx_text(tmp_path)
            os.remove(tmp_path)
            method = f'첨부파일 "{names[idx]}"(HWPX)의 XML 본문을 직접 파싱한 전문입니다.'
            source_note = "첨부파일(HWPX) 전사"
        else:
            raise ValueError(f"미지원 kind: {kind}")

        header = ex.build_header(info, title, new_id, method, source_note, ex.delegation_note(admrul_entry))
        text = header + body.strip() + "\n"
        with open(path_out, "w", encoding="utf-8") as f:
            f.write(text)
        log[key] = {"status": "done", "new_id": new_id, "kind": kind, "chars": len(text),
                    "file": os.path.basename(path_out), "note": "shrink_guard 사람확인 후 승인 반영"}
        print(f"{key}: 완료 ({kind}, {len(text)}자, 사람확인승인)", flush=True)
    except Exception as e:
        log[key] = {"status": "error", "reason": str(e)}
        print(f"{key}: 에러 {e}", flush=True)
    json.dump(log, open(ex.LOG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
