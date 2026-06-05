#!/usr/bin/env python3
"""
Phase 2b 자유 변칙 평가 *러너* — phase2b_eval_freevar.jsonl 직렬 실행.

[핵심 설계]
- 단일 직렬 (Gemini quota 안전). 케이스 사이 sleep 3s.
- 429 백오프: 5/10/20s 3회 재시도.
- prev_id 있으면 그 응답의 focus 를 body 의 focus 에 동봉(연속성 검증).
- 카테고리별 + 직군별 통계 + 결함 신호 추출.

[평가 어서션]
- expect_tools_any: 하나라도 toolsUsed 에 → ok
- expect_tools_all: 모두 toolsUsed 에 → ok
- expect_zone_match: 답 텍스트에 zone 명 포함 → ok (후속 연속성)
- expect_meta_summary: 답이 비짧고 도구 호출 ≤ 1 (메모리 활용)
- expect_no_halluc: 답이 환각 패턴 안 보임 + "정보 없어요/모릅니다" 거절 OK
- expect_no_cot: 답에 CoT 누수 패턴("thinking:/먼저 ~를 확인/내가 생각해/sources:") 없음
- expect_decision: 답에 "가능/가능합/주의/무리/안전/위험/적합" 등 결론 단어

[실행]
- python3 knowledge/phases/phase2b_eval_freevar_runner.py [--jikgun=slug] [--limit=N]
- 옵션: --jikgun 으로 한 직군만, --limit 으로 처음 N건만
- 출력: 진행 라인 + 마지막 직군별·카테고리별 종합

[보고]
- 직군별 PASS/총 (5축 따로 카운트)
- 카테고리별 통계
- 결함 신호 샘플
- 지연 SLO p50/p95
"""
import json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
EVAL = HERE / "phase2b_eval_freevar.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask"
TIMEOUT = 60
PACING_S = 3.0     # 케이스 사이 sleep
LOG_EVERY = 10

# p95 게이트 임계 (synthesis §0 항목2)
# sentinel 진입점에서 freevar 러너를 import 재사용 시 SENTINEL_P95_MS 가 우선.
P95_GATE_MS = int(os.environ.get(
    "SENTINEL_P95_MS",
    os.environ.get("FREEVAR_P95_MS", "5000")
))
RAW_GATE_RATIO   = float(os.environ.get("RAW_GATE_RATIO", "1.5"))
DOD_PASS_PCT     = int(os.environ.get("FREEVAR_DOD_PASS_PCT",     "85"))
DOD_JIKGUN_FLOOR = int(os.environ.get("FREEVAR_DOD_JIKGUN_FLOOR", "70"))
DOD_CAT_FLOOR    = int(os.environ.get("FREEVAR_DOD_CAT_FLOOR",    "70"))
DOD_HALLUC_MAX   = int(os.environ.get("FREEVAR_DOD_HALLUC_MAX",   "2"))

# CoT 누수 의심 패턴
COT_PATTERNS = [
    r"thinking\s*[:：]", r"sources\s*[:：]", r"먼저\s+\S+를?\s+확인",
    r"내가\s+생각", r"추론\s*과정", r"reasoning\s*[:：]",
    r"단계\s*\d+\s*[:：]", r"step\s*\d+\s*[:：]",
]
COT_RE = re.compile("|".join(COT_PATTERNS), re.IGNORECASE)

# 환각 의심 패턴 (도구 결과에 흔히 없는 단정형 + 비도메인 답)
HALLUC_INDICATORS = [
    "약 \\d+km", "약 \\d+제곱", "통계는", "법령\\s*제\\d+조",
    "약 \\d+년", "약 \\d+\\.\\d+", "약 \\d+퍼센트",
]
HALLUC_RE = re.compile("|".join(HALLUC_INDICATORS))

# 결정 단어 (decision 케이스)
# [§B 패치 — sentinel #4 결정 단어 확장 (C8)]
# synth prompt 의 결정 단어 enumeration 과 동기화 — runner-synth drift 방지.
# 추가 9개: 권장/권고/발령/통제/허용/중지/중단/보류/이행/지속
DECISION_RE = re.compile(
    r"가능|적합|주의|무리|안전|위험|불가|곤란|어렵|좋습|괜찮|조심|"
    r"권장|권고|발령|통제|허용|중지|중단|보류|이행|지속"
)
# "운영" 은 명사구 부분문자열로 흔히 등장("해수욕장 운영", "어업관리 운영") → 단독 신호로는 약함.
# 다른 결정 어휘(가능/불가/중지/통제/허용/미만/초과/이하/이상)와 동시 매칭 시에만 보조 신호로 통과.
DECISION_RE_WEAK = re.compile(r"운영")
DECISION_WEAK_PAIR_RE = re.compile(r"가능|불가|중지|중단|통제|허용|미만|초과|이하|이상")

# 거절·정보없음 (no-halluc 보호장치 — 거절은 안 환각)
# §6 #35 SEC P0 — 보안 거절 어휘 확장. 3종 거절문 정확 일치 + 변형 흡수.
REFUSAL_RE = re.compile(
    r"없어요|모릅|가져오지|찾지\s*못|지원하지|범위.*벗어|확인할\s*수\s*없"
    r"|제공하지\s*않|받지\s*않|거부(?:됩니다|합니다|돼요)"
    r"|관리자\s*권한\s*정보|시스템\s*변경\s*명령|권한\s*상승\s*시도"
)

def ask(query, profile=None, focus=None, max_retry=3):
    """(data, metrics, err) 반환 — 평가셋 러너와 동일 시그니처.
    metrics = {pure_ms, backoff_ms, attempts, last_attempt_ms}
      · pure_ms        : 마지막 성공 attempt 의 (t_end - t_start)
      · backoff_ms     : 누적 sleep(429 백오프) 시간 ms
      · attempts       : 실제 시도 수 (1=즉시 성공)
      · last_attempt_ms: 실패 종료 시 마지막 시도 ms (성공 시 None)
    raw_ms = pure_ms + backoff_ms 는 호출자(main)에서 케이스별 합산.
    """
    body = {"query": query, "memory": []}
    if profile is not None: body["profile"] = profile
    if focus is not None:   body["focus"]   = focus
    payload = json.dumps(body).encode("utf-8")
    backoff_ms = 0
    last_pure = 0
    for attempt in range(max_retry + 1):
        req = urllib.request.Request(URL, data=payload,
            headers={"Content-Type":"application/json"}, method="POST")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8")
                pure = int((time.monotonic() - t0) * 1000)
                return json.loads(raw), {
                    "pure_ms": pure,
                    "backoff_ms": backoff_ms,
                    "attempts": attempt + 1,
                    "last_attempt_ms": None,
                }, None
        except urllib.error.HTTPError as e:
            last_pure = int((time.monotonic() - t0) * 1000)
            if e.code == 429 and attempt < max_retry:
                wait_s = 5 + attempt * 5    # 5s → 10s → 15s (freevar 백오프)
                time.sleep(wait_s); backoff_ms += wait_s * 1000
                continue
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1,
                          "last_attempt_ms": last_pure}, f"HTTP {e.code}"
        except Exception as e:
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1,
                          "last_attempt_ms": int((time.monotonic() - t0) * 1000)}, \
                   f"{type(e).__name__}: {e}"
    return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                  "attempts": max_retry + 1,
                  "last_attempt_ms": last_pure}, "HTTP 429(exhausted)"

def percentile(values, p):
    if not values: return 0
    s = sorted(values); k = (len(s)-1)*p
    f = int(k); c = min(f+1, len(s)-1)
    return int(s[f] + (s[c]-s[f])*(k-f)) if f != c else s[f]

def evaluate(case, data, ms, err):
    """평가 결과: dict {ok, axes:{A,B,C,D,E:bool|None}, notes:[]}"""
    if err: return {"ok": False, "err": err, "axes": {}, "notes": [f"ERR {err}"]}
    tools = (data.get("data") or {}).get("toolsUsed") or []
    ans = data.get("answer") or ""
    if not ans:
        return {"ok": False, "axes": {}, "notes": ["empty ans"]}
    axes = {}; notes = []
    # A. 도구 사용
    any_req = case.get("expect_tools_any") or []
    all_req = case.get("expect_tools_all") or []
    ok_a = True
    if any_req:
        ok_a = any(t in tools for t in any_req)
        if not ok_a: notes.append(f"A: tools={tools} miss any={any_req}")
    if all_req:
        ok_aa = all(t in tools for t in all_req)
        ok_a = ok_a and ok_aa
        if not ok_aa: notes.append(f"A: tools={tools} miss all={all_req}")
    axes["A"] = ok_a
    # B. 환각
    if case.get("expect_no_halluc"):
        is_refusal = bool(REFUSAL_RE.search(ans))
        is_halluc = bool(HALLUC_RE.search(ans)) and not is_refusal
        axes["B"] = not is_halluc
        if is_halluc: notes.append(f"B: halluc pattern in ans")
    else: axes["B"] = True
    # C. 후속 연속성 (zone_match)
    if case.get("expect_zone_match"):
        zone = case["expect_zone_match"]
        ok_c = zone in ans
        axes["C"] = ok_c
        if not ok_c: notes.append(f"C: zone='{zone}' not in ans")
    else: axes["C"] = None
    # D. multi-tool
    if all_req and len(all_req) >= 2:
        axes["D"] = len([t for t in all_req if t in tools]) >= 2
    else: axes["D"] = None
    # E. 메타 요약 (적은 도구 + 답이 짧고 정확)
    if case.get("expect_meta_summary"):
        ok_e = len(tools) <= 1 and 10 <= len(ans) <= 200
        axes["E"] = ok_e
        if not ok_e: notes.append(f"E: meta_summary fail tools={len(tools)} len_ans={len(ans)}")
    else: axes["E"] = None
    # CoT 누수
    if case.get("expect_no_cot"):
        cot = bool(COT_RE.search(ans))
        if cot:
            notes.append("CoT 누수 의심")
            axes["B"] = False
    # 결정 단어
    if case.get("expect_decision"):
        if not DECISION_RE.search(ans):
            # [C8] WEAK 보조 신호 — "운영" 이 다른 결정 어휘와 동시 매칭되면 통과
            if DECISION_RE_WEAK.search(ans) and DECISION_WEAK_PAIR_RE.search(ans):
                pass  # 보조 신호 통과
            else:
                notes.append("decision word 없음")
                axes["A"] = axes.get("A", True) and False
    # 종합 ok = axes 중 명시된 것 모두 True
    explicit = [v for v in axes.values() if v is not None]
    ok = all(explicit) if explicit else True
    return {"ok": ok, "axes": axes, "notes": notes, "tools": tools, "ans_short": ans[:80]}

def main():
    if not EVAL.exists():
        print("[error] eval JSONL 없음:", EVAL); sys.exit(2)
    cases = [json.loads(l) for l in EVAL.read_text(encoding="utf-8").splitlines() if l.strip()]
    arg_jikgun = None
    arg_limit = None
    for a in sys.argv[1:]:
        if a.startswith("--jikgun="): arg_jikgun = a.split("=",1)[1]
        elif a.startswith("--limit="): arg_limit = int(a.split("=",1)[1])
    if arg_jikgun:
        cases = [c for c in cases if c.get("jikgun") == arg_jikgun]
    if arg_limit:
        cases = cases[:arg_limit]

    print(f"=== Phase 2b 자유 변칙 평가 — {len(cases)} 케이스 직렬 실행 ===\n")
    chain_focus = {}  # case_id → focus
    by_jg = defaultdict(lambda: {"pass":0, "fail":0, "total":0})
    by_jg_cat = defaultdict(lambda: defaultdict(lambda: {"pass":0, "total":0}))
    latencies_net = []          # pure_ms — 게이트 판정 대상
    latencies_raw = []          # pure_ms + backoff_ms (케이스별 합산)
    backoff_per_case_ms = []
    n_429 = 0
    fails = []
    cot_samples = []
    halluc_samples = []
    t_start = time.time()

    for i, c in enumerate(cases):
        if i > 0 and i % LOG_EVERY == 0:
            elapsed = int(time.time() - t_start)
            print(f"  [{i}/{len(cases)}] 경과 {elapsed}s …")
        focus = None
        if c.get("prev_id"):
            focus = chain_focus.get(c["prev_id"])
        time.sleep(PACING_S)
        data, m, err = ask(c["query"], c.get("profile"), focus)
        # evaluate() 는 ms 만 보던 기존 인터페이스 → m["pure_ms"] 로 치환
        ev = evaluate(c, data, m["pure_ms"] if m else 0, err)
        if data is not None:
            pure = m["pure_ms"]; bo = m["backoff_ms"]
            latencies_net.append(pure)
            latencies_raw.append(pure + bo)       # ← 케이스별 raw 적재
            backoff_per_case_ms.append(bo)
            if bo: n_429 += 1
        elif m and m["backoff_ms"]:
            backoff_per_case_ms.append(m["backoff_ms"]); n_429 += 1

        jg = c["jikgun"]; cat = c["category"]
        by_jg[jg]["total"] += 1
        by_jg_cat[jg][cat]["total"] += 1
        if ev["ok"]:
            by_jg[jg]["pass"] += 1
            by_jg_cat[jg][cat]["pass"] += 1
        else:
            by_jg[jg]["fail"] += 1
            fails.append((c["id"], jg, cat, ev.get("notes",[]), ev.get("ans_short","")))
        # CoT/환각 샘플 캡처
        if data is not None:
            ans = data.get("answer") or ""
            if COT_RE.search(ans):
                cot_samples.append((c["id"], jg, ans[:120]))
            if HALLUC_RE.search(ans) and not REFUSAL_RE.search(ans):
                halluc_samples.append((c["id"], jg, ans[:120]))
        # focus 체이닝 저장
        if data is not None:
            chain_focus[c["id"]] = data.get("focus") or None

    print()
    print("======= 직군별 종합 =======")
    for jg in sorted(by_jg):
        st = by_jg[jg]
        pct = (st["pass"]*100//st["total"]) if st["total"] else 0
        print(f"  {jg:16s}  PASS {st['pass']:>2d}/{st['total']:>2d}  ({pct}%)")
    print()
    print("======= 직군 × 카테고리 (1.기본 2.연속 3.다중 4.정량 5.비도메인 6.메타 7.환각 8.변칙) =======")
    cat_label = {1:"기본",2:"연속",3:"다중",4:"정량",5:"비도",6:"메타",7:"환각",8:"변칙"}
    header = "  " + "직군".ljust(16) + " | " + " ".join(f"{cat_label[c]:>5s}" for c in [1,2,3,4,5,6,7,8])
    print(header)
    for jg in sorted(by_jg_cat):
        row = "  " + jg.ljust(16) + " | "
        for cat in [1,2,3,4,5,6,7,8]:
            s = by_jg_cat[jg][cat]
            row += f"{s['pass']:>2d}/{s['total']:<2d} "
        print(row)
    print()
    # net/raw 둘 다 분위수는 케이스별 적재값으로 직접 산출 (합성 금지)
    p50_net = percentile(latencies_net, 0.5)  if latencies_net else 0
    p95_net = percentile(latencies_net, 0.95) if latencies_net else 0
    p50_raw = percentile(latencies_raw, 0.5)  if latencies_raw else 0
    p95_raw = percentile(latencies_raw, 0.95) if latencies_raw else 0
    bo_avg = (sum(backoff_per_case_ms)//len(backoff_per_case_ms)) if backoff_per_case_ms else 0
    bo_max = max(backoff_per_case_ms) if backoff_per_case_ms else 0
    bo_total_s = sum(backoff_per_case_ms) // 1000

    if latencies_net:
        print("지연 SLO (net = pure_ms, raw = pure + backoff)")
        print(f"  net  p50={p50_net}ms  p95={p95_net}ms  평균={sum(latencies_net)//len(latencies_net)}ms  n={len(latencies_net)}")
        print(f"  raw  p50={p50_raw}ms  p95={p95_raw}ms")
        print(f"  backoff 평균 {bo_avg}ms · 최대 {bo_max}ms · 총 {bo_total_s}s · 429 발생 {n_429}/{len(latencies_net)}건")

    print(f"실패 {len(fails)}건 · CoT 누수 의심 {len(cot_samples)}건 · 환각 의심 {len(halluc_samples)}건")
    if cot_samples:
        print("\n[CoT 누수 샘플]")
        for cid, jg, ans in cot_samples[:5]:
            print(f"  {cid} ({jg}): {ans!r}")
    if halluc_samples:
        print("\n[환각 의심 샘플]")
        for cid, jg, ans in halluc_samples[:5]:
            print(f"  {cid} ({jg}): {ans!r}")
    if fails:
        print(f"\n[실패 샘플 — 처음 10건]")
        for cid, jg, cat, notes, ans in fails[:10]:
            print(f"  {cid} ({jg} cat{cat}): {'; '.join(notes)} | ans={ans!r}")
    print()
    total = sum(s["total"] for s in by_jg.values())
    npass = sum(s["pass"] for s in by_jg.values())
    pass_pct = npass*100//total if total else 0
    print(f"==== 종합 PASS {npass}/{total} ({pass_pct}%) · 소요 {int(time.time()-t_start)}s ====")

    # ── DoD 5항목 게이트 ────────────────────────────────────────
    jikgun_min = min((s["pass"]*100//s["total"]) for s in by_jg.values() if s["total"]) if by_jg else 0
    cat_min = 100
    for jg in by_jg_cat:
        for s in by_jg_cat[jg].values():
            if s["total"]:
                pct = s["pass"]*100//s["total"]
                if pct < cat_min: cat_min = pct
    if not by_jg_cat: cat_min = 0

    warn_raw = p95_raw > int(P95_GATE_MS * RAW_GATE_RATIO)

    print()
    print("=== p95 게이트 결과 (자유변칙 DoD) ===")
    print(f"  PASS              {pass_pct}% (gate >={DOD_PASS_PCT}%)            {'PASS' if pass_pct>=DOD_PASS_PCT else 'FAIL'}")
    print(f"  직군 floor        {jikgun_min}% (gate >={DOD_JIKGUN_FLOOR}%)         {'PASS' if jikgun_min>=DOD_JIKGUN_FLOOR else 'FAIL'}")
    print(f"  카테고리 floor    {cat_min}% (gate >={DOD_CAT_FLOOR}%)         {'PASS' if cat_min>=DOD_CAT_FLOOR else 'FAIL'}")
    print(f"  환각 의심         {len(halluc_samples)} (gate <={DOD_HALLUC_MAX})         {'PASS' if len(halluc_samples)<=DOD_HALLUC_MAX else 'FAIL'}")
    print(f"  net p95           {p95_net}ms (gate <={P95_GATE_MS}ms)       {'PASS' if p95_net<=P95_GATE_MS else 'FAIL'}")
    print(f"  -- 참고(외부쿼터 감시) -----------------------")
    print(f"  raw p95           {p95_raw}ms (raw WARN >{int(P95_GATE_MS*RAW_GATE_RATIO)}ms)   {'WARN' if warn_raw else 'OK'}")
    print(f"  백오프(차이)      총 {bo_total_s}s · 발생 {n_429}/{len(latencies_net) or 1}건")

    violations = []
    if pass_pct < DOD_PASS_PCT:               violations.append(f"PASS {pass_pct}<{DOD_PASS_PCT}%")
    if jikgun_min < DOD_JIKGUN_FLOOR:         violations.append(f"jikgun floor {jikgun_min}<{DOD_JIKGUN_FLOOR}%")
    if cat_min < DOD_CAT_FLOOR:               violations.append(f"cat floor {cat_min}<{DOD_CAT_FLOOR}%")
    if len(halluc_samples) > DOD_HALLUC_MAX:  violations.append(f"halluc {len(halluc_samples)}>{DOD_HALLUC_MAX}")
    if p95_net > P95_GATE_MS:                 violations.append(f"net p95 {p95_net}>{P95_GATE_MS}")

    if violations:
        print(f"\nVIOLATION: {' · '.join(violations)}")
        sys.exit(1)
    print("\nALL GATES PASS")
    sys.exit(0)

if __name__ == "__main__":
    main()
