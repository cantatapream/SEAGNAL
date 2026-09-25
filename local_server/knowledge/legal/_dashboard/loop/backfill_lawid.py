#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
"""74법 `_meta.json`의 families 각 층(법률/시행령/시행규칙 등)에 `법령ID`를 채워 넣는다.
   법령ID는 법령명이 바뀌어도 절대 변하지 않는 고유식별자라(H-29 11항 실측), 이름 기반 추적이
   개명 시 깨지는 문제를 없애기 위한 백필이다. 부산물로 층별 API 스냅샷도 남겨 baseline 빌더가
   같은 조회를 두 번 하지 않게 한다.
[연계] 입력: _dashboard/loop/audit12_groups.json + audit12_groups_run.json(대상 74법 목록, 근거는
            _dashboard/H29_design.md §2) · raw/**/_meta.json(families.MST)
       API : law.go.kr DRF lawService.do?target=law&MST=… (기본정보.법령ID·소관부처코드)
       출력: raw/**/_meta.json (families.<층>.법령ID 키 1개만 추가 — 다른 필드 불변)
             _dashboard/lawid_backfill.json (층별 스냅샷 + 실패 목록 → build_change_baseline.py가 소비)
       ⚠경합위험: 74개 공유 raw `_meta.json`에 쓴다. 반드시 단독(직렬) 실행 — 병렬 디스패치 금지.
[로드 순서] 단독 실행(python3 backfill_lawid.py). 이 스크립트 → build_change_baseline.py →
            detect_law_changes.py 순서로 돈다.
"""
import json, os, time, urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))   # 컨테이너는 UTC로 도니 KST는 명시 변환(CLAUDE.md 시간 표기 규칙)
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import law_api_guard                 # DRF 오류쪽 판별 + 현행 시행일 판 고정(L-294·L-295)

OC = "hyoo1431"
LEGAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
GROUPS = f"{LEGAL}/_dashboard/loop/audit12_groups.json"
GROUPS_RUN = f"{LEGAL}/_dashboard/loop/audit12_groups_run.json"
OUT = f"{LEGAL}/_dashboard/lawid_backfill.json"
SLEEP = 0.25


def load_target_laws():
    """대상 법 목록을 audit12_groups.json ∪ audit12_groups_run.json(추가분)으로 만든다.
    예: [{'slug':'항만법','name':'항만법','domain':'10_항만물류','raw':'/…/항만법','source':'audit12_groups.json'}, …]
    @returns {list[dict]} slug 오름차순 74건
    [연계] H29_design.md §2의 canonical 목록 결정을 그대로 코드로 옮긴 것 —
           build_change_baseline.py도 이 함수를 import해 같은 목록을 쓴다.
    """
    def flat(path):
        g = json.load(open(path, encoding="utf-8"))
        out = []
        for k in sorted(g, key=int):
            out.extend(g[k])
        return out

    laws = {}
    for x in flat(GROUPS):
        laws[x["slug"]] = dict(x, source="audit12_groups.json")
    for x in flat(GROUPS_RUN):
        if x["slug"] not in laws:
            laws[x["slug"]] = dict(x, source="audit12_groups_run.json")
    return [laws[s] for s in sorted(laws)]


def api(url):
    """DRF 한 번 호출(JSON). 오류쪽이면 사유를 찍는다(law_api_guard, L-294·L-295)."""
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "replace")
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


def fetch_law_meta(mst):
    """MST 1건의 기본정보를 조회해 baseline·백필에 필요한 필드만 뽑는다.
    예: fetch_law_meta('283707') → {'법령ID':'001737','법령명':'항만법','소관부처코드':'1192000',…}
    @param {str} mst 법령일련번호
    @returns {dict|None} 실패 시 None(호출측이 실패 목록에 기록)
    [연계] law.go.kr DRF lawService.do — 필드명은 2026-08-10 실측(H29_design.md §4) 기준.
    """
    # ★2026-09-21 수정. 종전에는 `target=law&MST=` 를 직접 불렀는데, 한 MST 가 시행일 판을
    #   둘 이상 가지면 **어느 판이 올지 못 고른다** — 288973 은 `target=law` 로 **20270101
    #   시행예정** 판이 오고 현행은 20260825 다. 여기서 뽑는 `시행일자`·`공포번호` 가 그대로
    #   baseline 이 되고, `detect_law_changes.py` 는 그것을 `lawSearch`(eflaw)의 **현행 행**과
    #   견준다. 즉 **미시행 판이 baseline 에 박히면 없는 개정을 보고하거나 있는 개정을 놓친다.**
    #   이제 현행 시행일자를 조회해 `efYd` 로 못 박고, 못 정하면 None 을 준다(law_api_guard).
    return fetch_law_meta_why(mst)[0]


def fetch_law_meta_why(mst):
    """`fetch_law_meta` 와 같은 일을 하되 **못 받은 까닭까지** 준다 → `(info|None, 까닭)`.

    ★왜 나눴나 (2026-09-25, 일감 P-20)
      종전에는 **서로 다른 세 가지**가 전부 `None` 하나로 돌아왔고, 호출부는 그 전부를
      *"API 응답에 법령ID 없음(조회 실패 또는 폐지/비법령 MST)"* 이라고 적었다.
      그래서 개정탐지 기준선이 **13층을 승계**한 까닭을 다음 사람이 「폐지된 MST 겠지」로 읽는다.
      **실측으로 아니었다** — 「배타적 경제수역 및 대륙붕에 관한 법률」(MST 192412)을 직접 두들겨 보니
      첫 시도는 `Connection reset by peer`, **두 번째에 법령ID `001437` 이 왔다.**
      즉 그 13층은 **망이 끊긴 것**이고, 사유가 거짓이라 아무도 다시 받지 않았다.
      ⇒ 갈래를 셋으로 가른다. 값은 그대로다(R0) — 까닭만 함께 준다.
    """
    last = "망오류 — 3번 다 실패했다"
    for _ in range(3):
        try:
            d = law_api_guard.fetch_law_body(api, OC, mst)
            if not d:
                # 몸을 아예 못 받았다 = 판을 못 정했다(law_api_guard 가 현행 시행일을 확정 못 함).
                # 종전 코드도 여기서 재시도하지 않고 None 을 줬다 — 그대로 둔다.
                return None, "판을 못 정했다 — law_api_guard 가 현행 시행일(efYd)을 확정하지 못했다"
            info = (d.get("법령") or {}).get("기본정보") or {}
            if not info.get("법령ID"):
                return None, "응답은 왔는데 법령ID 칸이 비었다 — 폐지·비법령 MST 일 수 있다"
            소관 = info.get("소관부처") or {}
            return {
                "MST": str(mst),
                "법령ID": str(info.get("법령ID")),
                "법령명": info.get("법령명_한글", ""),
                "공포번호": str(info.get("공포번호", "")),
                "공포일자": str(info.get("공포일자", "")),
                "시행일자": str(info.get("시행일자", "")),
                "소관부처명": 소관.get("content", "") if isinstance(소관, dict) else str(소관),
                "소관부처코드": 소관.get("소관부처코드", "") if isinstance(소관, dict) else "",
            }, ""
        except Exception as e:
            last = f"망오류 — {type(e).__name__}: {str(e)[:80]}"
            time.sleep(1.5)
    return None, last


def family_items(fams):
    """families 딕셔너리를 (라벨, 항목dict) 목록으로 평탄화한다. 값이 list인 법(해양경찰법 등
    개별 명칭 대통령령 여러 건)과 str인 값("없음 — …" 설명문)을 함께 처리한다.
    예: {'법률':{...},'대통령령':[{...},{...}]} → [('법률',{...}), ('대통령령[0:…]',{...}), …]
    @param {dict} fams _meta.json의 families
    @returns {list[tuple[str, dict]]}
    [연계] collect_contacts.py `_collect_one_law()`가 쓰는 것과 같은 방어 로직(같은 raw 스키마).
    """
    out = []
    for name, fam in (fams or {}).items():
        if isinstance(fam, str):
            continue
        subs = fam if isinstance(fam, list) else [fam]
        for i, sub in enumerate(subs):
            if not isinstance(sub, dict) or not sub.get("MST"):
                continue
            label = name if len(subs) == 1 else f"{name}[{i}:{sub.get('법령명', '')}]"
            out.append((label, sub))
    return out


def detect_indent(text):
    """이 `_meta.json`이 쓰는 들여쓰기 폭을 원문에서 알아낸다(파일마다 1칸/2칸이 섞여 있어,
    고정값으로 다시 쓰면 파일 전체가 diff로 잡히기 때문 — 외과수술식 변경 원칙).
    예: detect_indent('{\\n "법령명": …') → 1
    @param {str} text _meta.json 원문
    @returns {int} 들여쓰기 칸 수(못 찾으면 2)
    [연계] run()의 저장 단계에서만 사용. 423개 raw `_meta.json` 중 21개가 1칸 들여쓰기임을 실측.
    """
    for line in text.split("\n")[1:]:
        stripped = line.lstrip(" ")
        if stripped and stripped != "}":
            return len(line) - len(stripped)
    return 2


def run():
    laws = load_target_laws()
    snapshot, failures = {}, []
    added = skipped = 0
    print(f"대상 {len(laws)}법 — 법령ID 백필 시작", flush=True)
    for n, law in enumerate(laws, 1):
        meta_path = os.path.join(law["raw"], "_meta.json")
        try:
            raw_text = open(meta_path, encoding="utf-8").read()
            meta = json.loads(raw_text)
        except Exception as e:
            failures.append({"law": law["slug"], "layer": "_meta.json", "reason": str(e)})
            print(f"[{n}/{len(laws)}] {law['slug']} — _meta.json 읽기 실패: {e}", flush=True)
            continue
        dirty = False
        for label, sub in family_items(meta.get("families")):
            info, why = fetch_law_meta_why(sub["MST"])   # ★까닭까지 받는다(P-20)
            time.sleep(SLEEP)
            if not info:
                failures.append({"law": law["slug"], "layer": label, "MST": sub["MST"],
                                 "reason": why or "까닭을 못 적었다"})
                continue
            snapshot[f"{law['slug']}::{label}"] = info
            if sub.get("법령ID") != info["법령ID"]:
                sub["법령ID"] = info["법령ID"]   # ★ 추가되는 키는 이것 하나뿐
                dirty = True
                added += 1
            else:
                skipped += 1
        if dirty:
            text = json.dumps(meta, ensure_ascii=False, indent=detect_indent(raw_text))
            open(meta_path, "w", encoding="utf-8").write(text + ("\n" if raw_text.endswith("\n") else ""))
        print(f"[{n}/{len(laws)}] {law['slug']} {'갱신' if dirty else '변경없음'}", flush=True)
    json.dump({"generated_at": datetime.now(KST).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
               "law_count": len(laws), "families": snapshot, "failures": failures},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n=== 완료: 법령ID 추가 {added}건 · 이미 동일 {skipped}건 · 실패 {len(failures)}건 "
          f"· 스냅샷 {len(snapshot)}층 → {OUT} ===", flush=True)
    for f in failures:
        print("  실패:", f, flush=True)


if __name__ == "__main__":
    run()
