#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Phase 0 상시 회귀 게이트 러너.
golden(phase0_golden.jsonl)의 각 케이스를 /api/assistant/ask 로 호출해 구조 불변식을 검사한다.
실데이터 값(파고 수치 등)은 매일 바뀌므로 '정확값'이 아니라 '구조'를 검증한다:
  - tools_include : toolsUsed 가 목록 중 하나 이상 포함
  - tools_exclude : toolsUsed 가 목록의 어떤 것도 포함하지 않음
  - method        : internal(웹폴백 아님) / web / any
  - numeric       : 답변에 숫자 포함
  - not_nodata    : 답변이 '없음/모름' 류가 아님
  - corrected     : STT 교정(correctedQuery) 발생
  - answer_excludes: 답변에 금지 문구 미포함(보안)
  - optional=true : 환경의존(키/피드) 케이스 — 실패해도 SKIP(게이트 비차단)
추가: routes/assistant.js 정적 보안검사 — TOOL_CATALOG/TOOL_EXEC 에 admin 도구 미노출.

사용: python3 phase0_runner.py [BASE_URL]
  BASE_URL 기본값 http://127.0.0.1:3001
종료코드: 하드 실패 0건이면 0, 아니면 1.
"""
import json, sys, re, time, urllib.request, os

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3001"
HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(HERE, "phase0_golden.jsonl")
ASSISTANT_JS = os.path.normpath(os.path.join(HERE, "..", "..", "routes", "assistant.js"))

BAD = re.compile(r"없어요|없습니다|모르|못\s*(가져|불러|찾|들|알아)|준비\s*중|알 수 없|정보가? ?없|찾지 못")
NUM = re.compile(r"\d")

def call(case, i):
    body = {"query": case["query"]}
    if case.get("profile"): body["profile"] = case["profile"]
    if case.get("memory"):  body["memory"]  = case["memory"]
    ip = "70.%d.%d.%d" % ((i//65536)%256, (i//256)%256, i%256)
    req = urllib.request.Request(BASE + "/api/assistant/ask",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Forwarded-For": ip})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def check(case, resp):
    a = case["asserts"]; fails = []
    ans = (resp.get("answer") or "")
    tu  = (resp.get("data", {}) or {}).get("toolsUsed") or []
    if "tools_include" in a and not (set(tu) & set(a["tools_include"])):
        fails.append("tools_include%s≠%s" % (a["tools_include"], tu))
    if "tools_exclude" in a and (set(tu) & set(a["tools_exclude"])):
        fails.append("tools_exclude hit %s" % (set(tu) & set(a["tools_exclude"])))
    if a.get("method") == "internal" and (not tu or tu == ["web_search"]):
        fails.append("method!=internal(%s)" % tu)
    if a.get("method") == "web" and tu != ["web_search"]:
        fails.append("method!=web(%s)" % tu)
    if a.get("numeric") and not NUM.search(ans):
        fails.append("no-number")
    if a.get("not_nodata") and BAD.search(ans):
        fails.append("nodata-answer")
    if a.get("corrected") and not resp.get("corrected"):
        fails.append("not-corrected")
    for bad in a.get("answer_excludes", []):
        if bad in ans:
            fails.append("leaked:%s" % bad)
    return fails

def static_security_check():
    """관리자 격리 불변식 정적 확인: 어떤 도구도 admin 엔드포인트를 호출하지 않고,
    admin 이름의 도구가 정의되지 않았는지 본다(브라우저 가독 휴리스틱 아닌 구체 패턴)."""
    try:
        src = open(ASSISTANT_JS, encoding="utf-8").read()
    except Exception as e:
        return ["assistant.js 읽기 실패: %s" % e]
    problems = []
    # 도구 실행부가 admin 엔드포인트를 호출하는 구체 패턴
    if re.search(r"""internal(?:Get|Post)\(\s*['"`]/api/admin""", src):
        problems.append("도구가 /api/admin 엔드포인트를 호출함")
    # admin 이름의 도구 정의(예: adminUsage: async ...) — 도구맵 노출 위험
    if re.search(r"^\s*admin\w*\s*:\s*(?:async\b|\()", src, re.M):
        problems.append("admin 접두 도구 정의 발견")
    return problems

def main():
    cases = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    npass = nfail = nskip = 0
    hard_fail_ids = []
    print("== Phase 0 골든 회귀 게이트 (%d 케이스) @ %s ==" % (len(cases), BASE))
    for i, c in enumerate(cases, 1):
        try:
            resp = call(c, i)
            fails = check(c, resp)
        except Exception as e:
            fails = ["ERROR:%s" % str(e)[:60]]
        opt = c["asserts"].get("optional")
        if not fails:
            npass += 1; tag = "PASS"
        elif opt:
            nskip += 1; tag = "SKIP"
        else:
            nfail += 1; tag = "FAIL"; hard_fail_ids.append(c["id"])
        if fails:
            print("[%s] %-22s %-8s %s" % (tag, c["id"], c["domain"], "; ".join(fails)))
        else:
            print("[%s] %-22s %-8s" % (tag, c["id"], c["domain"]))
        time.sleep(0.15)
    print("\n-- 정적 보안검사 --")
    sec = static_security_check()
    if sec:
        for s in sec: print("[FAIL] security:", s)
        hard_fail_ids.append("static-security")
    else:
        print("[PASS] 관리자 도구 미노출 확인")
    print("\n요약: PASS %d / FAIL %d / SKIP(환경의존) %d" % (npass, nfail, nskip))
    if hard_fail_ids:
        print("하드 실패:", ", ".join(hard_fail_ids)); sys.exit(1)
    print("게이트 통과 ✅"); sys.exit(0)

main()
