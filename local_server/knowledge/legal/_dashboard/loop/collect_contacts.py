#!/usr/bin/env python3
"""law.go.kr DRF API의 연락부서(법률/시행령/시행규칙)·담당부서기관(행정규칙) 필드를 수집한다.
[연계] 입력: raw/**/_meta.json(families의 MST) + raw/**/_admrul.json(행정규칙 ID)
       출력: _dashboard/contacts_collected.json ({법명: {법률/시행령/시행규칙: [...], 행정규칙: {...}}})
       실패기록: _dashboard/contacts_collect_failures.json
[로드 순서] 단독 실행(python3 collect_contacts.py). Workflow/Agent 불필요(순수 API 호출).
"""
import os
import json, glob, time, sys, threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

OC = "hyoo1431"
LEGAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
TARGET_LAWS_FILE = f"{LEGAL}/_dashboard/loop/audit9_groups.json"
OUT_FILE = f"{LEGAL}/_dashboard/contacts_collected.json"
FAIL_FILE = f"{LEGAL}/_dashboard/contacts_collect_failures.json"

def api_get(target, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"https://www.law.go.kr/DRF/lawService.do?OC={OC}&target={target}&type=JSON&{q}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def extract_law_contacts(mst):
    d = api_get("law", MST=mst)
    info = (d.get("법령") or {}).get("기본정보", {})
    dept = info.get("연락부서", {}).get("부서단위")
    if dept:
        if isinstance(dept, dict):
            dept = [dept]
        return [{"부서명": x.get("부서명"), "전화번호": x.get("부서연락처"), "소관부처명": x.get("소관부처명")} for x in dept]
    # 폴백: 연락부서 없으면 기본정보.전화번호 + 소관부처
    phone = info.get("전화번호")
    if phone:
        소관 = info.get("소관부처", {})
        소관명 = 소관.get("content") if isinstance(소관, dict) else 소관
        return [{"부서명": None, "전화번호": phone, "소관부처명": 소관명}]
    return []

def extract_admrul_contact(admrul_id):
    d = api_get("admrul", ID=admrul_id)
    info = d.get("AdmRulService", {}).get("행정규칙기본정보", {})
    if not info:
        return None
    return {
        "담당부서기관명": info.get("담당부서기관명"),
        "전화번호": info.get("전화번호"),
        "소관부처명": info.get("소관부처명"),
        "상위부처명": info.get("상위부처명"),
    }

_lock = threading.Lock()

def _save(results, failures):
    with _lock:
        json.dump(results, open(OUT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        json.dump(failures, open(FAIL_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def _worker(i, total, law, results, failures):
    slug = law["slug"]
    raw_dir = law["raw"]
    print(f"[{i}/{total}] {slug} 시작", flush=True)
    law_result = {"families": {}, "행정규칙": {}}
    local_failures = []
    try:
        _collect_one_law(slug, raw_dir, law_result, local_failures)
    except Exception as e:
        local_failures.append({"law": slug, "layer": "전체", "reason": f"예상치 못한 오류로 이 법 스킵: {e}"})
    with _lock:
        results[slug] = law_result
        failures.extend(local_failures)
    _save(results, failures)
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
    try:
        failures = json.load(open(FAIL_FILE, encoding="utf-8"))
    except Exception:
        failures = []

    todo = [(i, law) for i, law in enumerate(laws, 1) if law["slug"] not in results]
    print(f"전체 {len(laws)}법 중 미완료 {len(todo)}법을 워커 {workers}개로 병렬 수집", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_worker, i, len(laws), law, results, failures) for i, law in todo]
        for f in as_completed(futs):
            f.result()  # 예외 있으면 여기서 raise

    print(f"완료: {len(results)}법, 실패건 {len(failures)}건", flush=True)


def _collect_one_law(slug, raw_dir, law_result, failures):
        meta_path = f"{raw_dir}/_meta.json"
        try:
            meta = json.load(open(meta_path, encoding="utf-8"))
        except Exception as e:
            failures.append({"law": slug, "layer": "_meta.json", "reason": str(e)})
            meta = {}

        for fam_name, fam in (meta.get("families") or {}).items():
            # 일부 법(예: 해양경찰법)은 하나의 family가 단일 dict가 아니라
            # 위임근거별로 분산된 대통령령 여러 건(list)이거나, "없음"(str)일 수 있음.
            if isinstance(fam, str):
                continue  # "없음 — ..." 같은 설명문, 실제 항목 아님
            if fam_name == "행정규칙" and isinstance(fam, dict) and "MST" not in fam:
                continue  # 일부 법(예: 해운법)은 families.행정규칙이 개수·비고 요약일 뿐 — 실제 항목은 _admrul.json에서 별도 처리
            sub_items = fam if isinstance(fam, list) else [fam]
            for idx, sub in enumerate(sub_items):
                sub_label = fam_name if len(sub_items) == 1 else f"{fam_name}[{idx}:{sub.get('법령명', '')}]"
                mst = sub.get("MST") if isinstance(sub, dict) else None
                if not mst:
                    failures.append({"law": slug, "layer": sub_label, "reason": "MST 없음"})
                    continue
                try:
                    contacts = extract_law_contacts(mst)
                    law_result["families"][sub_label] = contacts
                    if not contacts:
                        failures.append({"law": slug, "layer": sub_label, "reason": "API 응답에 연락부서/전화번호 필드 자체가 없음"})
                except Exception as e:
                    failures.append({"law": slug, "layer": sub_label, "reason": f"API 호출 실패: {e}"})
                time.sleep(0.3)

        admrul_path = f"{raw_dir}/행정규칙/_admrul.json"
        try:
            admruls = json.load(open(admrul_path, encoding="utf-8"))
        except Exception:
            admruls = {}
        for title, entry in admruls.items():
            if title.startswith("_") or not isinstance(entry, dict):
                continue  # 메모성 키(_미확인 등) — 실제 admrul 항목 아님
            aid = entry.get("ID")
            if not aid:
                continue
            try:
                c = extract_admrul_contact(aid)
                if c:
                    law_result["행정규칙"][title] = c
                else:
                    failures.append({"law": slug, "layer": f"행정규칙:{title}", "reason": "API 응답에 담당부서 정보 없음"})
            except Exception as e:
                failures.append({"law": slug, "layer": f"행정규칙:{title}", "reason": f"API 호출 실패: {e}"})
            time.sleep(0.3)

if __name__ == "__main__":
    main()
