#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
"""법령 공식 약칭 수집 — 우리가 가진 모든 법(raw/*/*/_meta.json)의 **공식 약칭**을
   law.go.kr DRF에서 한 번에 긁어 `_dashboard/law_aliases.json` 표 하나로 만든다.

[왜 필요한가 — 초보자용]
  답변 문장은 「어선안전조업법」처럼 짧게 쓰는데, 근거 목록·위키는 정식 명칭
  「어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률」로 적혀 있다. 글자가 다르면
  프로그램은 다른 법으로 본다 — 그래서 본문 조문 링크·검색이 헛돈다. 이 표가 그 둘을 잇는다.

[환각 0 — 이 스크립트의 계약]
  - 약칭은 **API가 준 값만** 쓴다(우리가 만들어내지 않는다). 못 받은 법은 그냥 비워 둔다.
  - 유일한 파생은 `<약칭> 시행령`·`<약칭> 시행규칙`인데, 이것도 **그 시행령·시행규칙이 실제로
    검색에 존재할 때만** 만든다(정식 명칭 = `<정식법률명> 시행령`이라는 1:1 명명규칙의 반영일 뿐).
    파생 항목은 `derived:true`로 표시해 API 원본값과 구분한다.
  - 같은 약칭이 두 법에 걸리거나 다른 법의 정식명과 겹치면 `충돌`에 기록만 한다(둘 중
    하나를 골라 확정하지 않는다 — 쓰는 쪽에서 "애매하면 링크하지 않는다"로 처리).

[실측 — 추측 아님]
  - 약칭은 `lawSearch.do`(검색) 응답의 `법령약칭명`에만 있다. `lawService.do`(상세) 응답의
    `법령명약칭`은 같은 법인데도 빈 문자열이었다(어선안전조업법 013575로 확인, 2026-08-17).
  - 약칭은 **법률에만** 붙는다. 그 법의 시행령·시행규칙 행은 `법령약칭명`이 빈 값이다.

[연계] 입력: raw/*/*/_meta.json(법령명) · API: lawSearch.do?target=law
       출력: _dashboard/law_aliases.json
       소비: (예정) legal_retriever.js 검색·ai_chat.js 본문 조문 링크,
             detect_law_changes.py(약칭 신설·변경 감지 시 이 표 갱신)
[로드 순서] 단독 실행. 사용법: python3 collect_law_aliases.py [--limit N]
            위키·raw를 전혀 건드리지 않는다(새 파일 하나만 쓴다 — 병렬 작업과 경합 없음).
"""
import json, glob, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))   # 컨테이너는 UTC로 돈다(CLAUDE.md 시간 표기 규칙)
OC = "hyoo1431"                      # detect_law_changes.py·collect_contacts.py와 같은 계정
LEGAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
RAW = f"{LEGAL}/raw"
OUT = f"{LEGAL}/_dashboard/law_aliases.json"
SLEEP = 0.25                         # API 예의(다른 수집 스크립트와 같은 값)


def api(url):
    """DRF API 1회 호출(JSON). 3회까지 재시도하고 그래도 안 되면 None.
    예: api('https://www.law.go.kr/DRF/lawSearch.do?…') → {'LawSearch': {...}}
    @param {str} url 완성된 요청 URL
    @returns {dict|None}
    [연계] detect_law_changes.py api()와 같은 호출 관례(OC·User-Agent·재시도 3회).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1.5)
    return None


def search_law(name):
    """법령명으로 검색해 행 목록을 돌려준다(최대 100건, 1페이지).
    예: search_law('어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률')
        → [{'법령명한글':'…법률','법령약칭명':'어선안전조업법',…}, {'…시행령'}, {'…시행규칙'}]
    @param {str} name 검색할 법령명(정식 명칭)
    @returns {list} 응답 행 목록(실패·무결과면 [])
    [연계] ← collect(). 이 API의 `법령약칭명`이 이 스크립트가 유일하게 믿는 약칭 원천이다.
    """
    q = urllib.parse.quote(name)
    d = api(f"https://www.law.go.kr/DRF/lawSearch.do?OC={OC}&type=JSON&target=law"
            f"&query={q}&display=100")
    if not d:
        return []
    rows = (d.get("LawSearch") or {}).get("law") or []
    return rows if isinstance(rows, list) else [rows]


def law_names():
    """우리가 raw로 갖고 있는 모든 법의 정식 명칭을 모은다(중복 제거, 이름순).
    예: law_names()[:2] → ['가축분뇨의 관리 및 이용에 관한 법률', '갯벌 및 그 주변지역의 …']
    @returns {list[str]}
    [연계] ← collect(). raw/<도메인>/<법폴더>/_meta.json 의 `법령명` 필드만 읽는다
           (스키마가 폴더마다 조금씩 달라 `법령ID`·`families` 는 있는 곳만 있어 쓰지 않는다).
    """
    names = set()
    for f in glob.glob(f"{RAW}/*/*/_meta.json"):
        try:
            with open(f, encoding="utf-8") as fp:
                nm = (json.load(fp) or {}).get("법령명", "")
        except Exception:
            continue
        nm = str(nm).strip()
        # 발췌 수집한 타법은 `_meta.json`에 시행령 이름이 들어 있기도 하다 — 그대로 둔다
        # (그 이름 그대로 답변에 나올 수 있으므로 검색 대상으로 유효하다).
        if nm:
            names.add(nm)
    return sorted(names)


def collect(limit=0):
    """전 법을 훑어 약칭표를 만든다.
    @param {int} limit 0이면 전체, 양수면 앞에서 N개만(시험 실행용)
    @returns {dict} law_aliases.json 에 그대로 쓰는 객체
    [연계] → OUT 파일. 표 구조는 파일 상단 주석 참조.
    """
    names = law_names()
    if limit:
        names = names[:limit]
    entries, by_full, no_alias, not_found = [], {}, 0, []
    for i, nm in enumerate(names, 1):
        rows = search_law(nm)
        time.sleep(SLEEP)
        # 검색 결과 중 **이름이 정확히 같은 행**만 채택한다(부분일치로 고르면 다른 법이 섞인다).
        hit = next((r for r in rows if str(r.get("법령명한글", "")).strip() == nm), None)
        # 폴백: 우리 raw 폴더명이 띄어쓰기 없이 저장된 법이 있어(실측: `자유무역지역의지정및운영에관한법률`)
        # 공백만 다른 경우는 같은 법으로 본다. **공백 외의 글자가 다르면 여전히 채택하지 않는다**
        # (부분일치·유사도 매칭은 하지 않는다 — 다른 법을 그 법인 척 실으면 안 되므로).
        if not hit:
            flat = nm.replace(" ", "")
            hit = next((r for r in rows if str(r.get("법령명한글", "")).replace(" ", "").strip() == flat), None)
        if not hit:
            not_found.append(nm)
            continue
        alias = str(hit.get("법령약칭명", "")).strip()
        full = str(hit.get("법령명한글", "")).strip()
        ent = {
            "법령ID": str(hit.get("법령ID", "")),
            "정식명": full,
            "약칭": alias,
            "구분": str(hit.get("법령구분명", "")),
            "시행일": str(hit.get("시행일자", "")),
            "소관부처": str(hit.get("소관부처명", "")),
            "derived": False,
        }
        entries.append(ent)
        by_full[full] = ent
        if not alias:
            no_alias += 1
            continue
        # 파생: `<약칭> 시행령`·`<약칭> 시행규칙` — 그 하위법이 검색 결과에 **실제로 있을 때만**.
        for suffix in ("시행령", "시행규칙"):
            sub_full = f"{full} {suffix}"
            sub = next((r for r in rows if str(r.get("법령명한글", "")).strip() == sub_full), None)
            if not sub:
                continue
            entries.append({
                "법령ID": str(sub.get("법령ID", "")),
                "정식명": sub_full,
                "약칭": f"{alias} {suffix}",
                "구분": str(sub.get("법령구분명", "")),
                "시행일": str(sub.get("시행일자", "")),
                "소관부처": str(sub.get("소관부처명", "")),
                "derived": True,
            })
        if i % 25 == 0:
            print(f"  … {i}/{len(names)} (약칭 {sum(1 for e in entries if e['약칭'])}건)", flush=True)

    # 충돌 검사 — 쓰는 쪽이 "애매하면 링크하지 않는다"를 판정할 수 있게 미리 뽑아 둔다.
    seen, dup = {}, []
    for e in entries:
        a = e["약칭"]
        if not a:
            continue
        if a in seen and seen[a] != e["정식명"]:
            dup.append({"약칭": a, "법": [seen[a], e["정식명"]]})
        else:
            seen[a] = e["정식명"]
    # 약칭이 **다른 법의 정식명과 같은** 경우(개명 이력 등)도 같은 뜻의 충돌이다.
    same_as_full = [{"약칭": a, "정식명인법": a} for a in seen if a in by_full and by_full[a]["정식명"] != seen[a]]

    return {
        "수집일": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "출처": "law.go.kr DRF lawSearch.do?target=law 의 `법령약칭명` 필드(상세 API에는 값이 없어 검색 API만 쓴다)",
        "대상": f"raw/*/*/_meta.json 의 법령명 {len(names)}건",
        "통계": {
            "조회성공": len(names) - len(not_found),
            "약칭있음": sum(1 for e in entries if e["약칭"] and not e["derived"]),
            "약칭없음": no_alias,
            "파생(시행령·시행규칙)": sum(1 for e in entries if e["derived"]),
            "검색불일치": len(not_found),
        },
        "충돌": {"같은약칭_다른법": dup, "약칭이_다른법_정식명": same_as_full},
        "검색불일치목록": not_found,
        "항목": entries,
    }


if __name__ == "__main__":
    lim = 0
    if "--limit" in sys.argv:
        lim = int(sys.argv[sys.argv.index("--limit") + 1])
    print(f"[약칭수집] 시작 {datetime.now(KST).strftime('%H:%M KST')}", flush=True)
    data = collect(lim)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"[약칭수집] 완료 → {OUT}")
    print(json.dumps(data["통계"], ensure_ascii=False))
