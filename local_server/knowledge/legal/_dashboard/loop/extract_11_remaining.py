#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""H-28 전수조사(c)uncollected 43건 중 텍스트 API로 저장 안 된 나머지를 PDF 첨부에서 직접 추출.
   extract_admrul_pdf.py의 검증된 추출 로직(PyMuPDF gap-aware)을 재사용하되, 이번 11건 전용 입력으로 실행.
   [연계] 입력: 아래 ITEMS(법 slug·raw경로·admrul ID) / 출력: raw/.../행정규칙/<제목>.txt + _admrul.json 갱신
   [로드 순서] 단독 실행. AI 불필요."""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import extract_admrul_pdf as ex

# ★2026-09-23 (3-39) — 아래 목록에 그 컴퓨터 이름(`/home/user/SEAGNAL/…`)이 박혀 있었다.
#   **다른 데서는 그냥 안 돈다**(G-31). 뿌리를 이 파일 자리에서 세고 상대경로에 붙인다.
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', '..'))
def R(rel):
    """저장소 안의 상대경로를 이 컴퓨터의 절대경로로 바꾼다."""
    return os.path.join(REPO, rel)

ITEMS = [
    {"slug": "해양공간계획및관리에관한법률", "raw": R("local_server/knowledge/legal/raw/01_해양주권정책/해양공간계획및관리에관한법률"), "id": "2100000186935"},
    {"slug": "해양조사와해양정보활용에관한법률", "raw": R("local_server/knowledge/legal/raw/01_해양주권정책/해양조사와해양정보활용에관한법률"), "id": "2100000268414"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000268572"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000264544"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000264500"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000273404"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000248022"},
    {"slug": "연안사고예방에관한법률", "raw": R("local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률"), "id": "2100000264364"},
    {"slug": "수산업협동조합법", "raw": R("local_server/knowledge/legal/raw/05_수산어업/수산업협동조합법"), "id": "2100000271272"},
    {"slug": "수산업협동조합법", "raw": R("local_server/knowledge/legal/raw/05_수산어업/수산업협동조합법"), "id": "2100000271274"},
    {"slug": "공유수면관리및매립에관한법률", "raw": R("local_server/knowledge/legal/raw/07_해양환경생태/공유수면관리및매립에관한법률"), "id": "2100000205689"},
]

TMP_DIR = ex.TMP_DIR
os.makedirs(TMP_DIR, exist_ok=True)


def process(item):
    d = ex.api_get(item["id"])
    node = d.get("AdmRulService", {})
    if not node:
        return {"id": item["id"], "status": "error", "reason": "AdmRulService 없음"}
    info = node.get("행정규칙기본정보", {})
    title = info.get("행정규칙명", item["id"])
    attach = node.get("첨부파일", {}) or {}
    links = attach.get("첨부파일링크") or []
    names = attach.get("첨부파일명") or []
    if isinstance(links, str):
        links = [links]
    if isinstance(names, str):
        names = [names]
    # 제개정이유서·신구대조표 제외하고 본문 파일 선택
    idx = None
    for i, n in enumerate(names):
        if "제개정이유서" not in n and "신구대조표" not in n and "이유서" not in n:
            idx = i
            break
    if idx is None:
        return {"id": item["id"], "title": title, "status": "no_primary_attachment"}

    name = names[idx]
    try:
        if name.lower().endswith(".pdf"):
            tmp_path = f"{TMP_DIR}/{item['id']}.pdf"
            ex.download(links[idx], tmp_path)
            pages = ex.extract_pdf_text(tmp_path)
            os.remove(tmp_path)
            body = "\n\f\n".join(pages)
            method = f'첨부파일 "{name}"(총 {len(pages)}쪽)를 PyMuPDF로 텍스트 추출한 전문입니다.'
            source_note = "첨부파일 전사"
        elif name.lower().endswith(".hwpx"):
            tmp_path = f"{TMP_DIR}/{item['id']}.hwpx"
            ex.download(links[idx], tmp_path)
            body = ex.extract_hwpx_text(tmp_path)
            os.remove(tmp_path)
            if not body:
                return {"id": item["id"], "title": title, "status": "hwpx_extract_fail"}
            method = f'첨부파일 "{name}"(HWPX)의 XML 본문을 직접 파싱한 전문입니다.'
            source_note = "첨부파일(HWPX) 전사"
        else:
            return {"id": item["id"], "title": title, "status": f"미지원 형식: {name}"}

        if len(body.strip()) < 100:
            return {"id": item["id"], "title": title, "status": "too_short", "chars": len(body)}

        header = ex.build_header(info, title, item["id"], method, source_note, "")
        text = header + body.strip() + "\n"
        outdir = os.path.join(item["raw"], "행정규칙")
        os.makedirs(outdir, exist_ok=True)
        fn = ex.safe_filename(title) + ".txt"
        path_out = os.path.join(outdir, fn)
        with open(path_out, "w", encoding="utf-8") as f:
            f.write(text)

        # _admrul.json에 신규 항목 추가
        admrul_path = os.path.join(outdir, "_admrul.json")
        try:
            admrul = json.load(open(admrul_path, encoding="utf-8"))
        except Exception:
            admrul = {}
        admrul[title] = {"ID": item["id"], "위임": [{"출처": "H-28 전수조사 재수집(PDF전사) 2026-07-27"}]}
        json.dump(admrul, open(admrul_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

        return {"id": item["id"], "title": title, "status": "done", "chars": len(text), "file": fn}
    except Exception as e:
        return {"id": item["id"], "title": title, "status": "error", "reason": str(e)}


if __name__ == "__main__":
    results = [process(it) for it in ITEMS]
    for r in results:
        print(r)
    json.dump(results, open(R("local_server/knowledge/legal/_dashboard/pdf_extract_11_log.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
