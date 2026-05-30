#!/usr/bin/env python3
"""
Phase 2b 측정 토대 v1 — 직군 품질 평가셋 + 지연 SLO 베이스라인.

[목적]
  골든 게이트(P0)는 *구조 불변식* — 답이 들어왔나/도구가 호출됐나 — 만 검증한다.
  여기선 한 단계 위 *품질* 을 잰다: "직군 프로필이 실제로 도구 선택을 바꾸는가",
  그리고 SLO 베이스라인(p50·p95 지연)을 기록해 P2b 임베딩·P3 선제의 비교 기준을 만든다.

[케이스 스키마]
  phase2b_eval.jsonl 각 줄:
    id          : 케이스 식별자
    jikgun      : 기대 직군 슬러그 (정보용, 단 baseline 은 null)
    profile     : /ask 본문에 그대로 넣는 객체 (없으면 null)
    query       : 한국어 질의
    expect_tools_any : 이 중 하나라도 toolsUsed 에 들면 PASS (관심사 1순위 도구 풀)
    expect_tools_all : 모두 들어야 PASS (다중 도구 강제)
    note        : 사람이 읽는 설명

[자동 어서션]
  - PASS = expect_tools_any/all 조건 충족 + HTTP 200 + 답변 비어있지 않음.
  - 지연 = 클라이언트 wall-clock(ms). 토큰/내부 지연은 v2 에서 어시스턴트 응답 메타로 노출 예정.

[프린트]
  케이스별 PASS/FAIL + 사용된 도구 목록 + 지연.
  말미에 합계와 지연 통계(p50/p95/평균).

[사용]
  서버가 켜진 상태에서:
    python3 knowledge/phases/phase2b_eval_runner.py
  PORT 환경변수로 포트 변경 가능(기본 3001).
  exit 0 = 모두 PASS, 1 = FAIL 있음(어서션 실패).
"""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL = HERE / "phase2b_eval.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask"
TIMEOUT = 60

def ask(query, profile=None, max_retry=3):
    """호출 + 429(Gemini rate limit) 백오프 재시도. 429 외 오류는 즉시 반환."""
    body = {"query": query, "memory": []}
    if profile is not None:
        body["profile"] = profile
    payload = json.dumps(body).encode("utf-8")
    last_ms = 0
    for attempt in range(max_retry + 1):
        req = urllib.request.Request(URL, data=payload,
            headers={"Content-Type": "application/json"}, method="POST")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8")
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                return json.loads(raw), elapsed_ms, None
        except urllib.error.HTTPError as e:
            last_ms = int((time.monotonic() - t0) * 1000)
            if e.code == 429 and attempt < max_retry:
                # 백오프: 4s → 9s → 16s. Gemini quota 회복 대기.
                time.sleep(4 + attempt * 5)
                continue
            return None, last_ms, f"HTTP {e.code}"
        except Exception as e:
            return None, int((time.monotonic() - t0) * 1000), f"{type(e).__name__}: {e}"
    return None, last_ms, "HTTP 429(retry exhausted)"

def percentile(values, p):
    if not values: return 0
    s = sorted(values)
    k = (len(s) - 1) * p
    f = int(k); c = min(f + 1, len(s) - 1)
    if f == c: return s[f]
    return int(s[f] + (s[c] - s[f]) * (k - f))

def main():
    if not EVAL.exists():
        print("[error] eval JSONL 없음:", EVAL); sys.exit(2)
    cases = []
    for line in EVAL.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line: continue
        cases.append(json.loads(line))

    # N회 반복(다수결) — LLM 비결정성 흡수. CLI 인수 우선, 환경변수 EVAL_N, 기본 3.
    N = 3
    for a in sys.argv[1:]:
        if a.startswith("--n="):
            try: N = max(1, int(a.split("=", 1)[1]))
            except: pass
        elif a == "--n" or a == "-n":
            pass  # 다음 인수에서 처리
    try:
        if "--n" in sys.argv or "-n" in sys.argv:
            idx = (sys.argv.index("--n") if "--n" in sys.argv else sys.argv.index("-n"))
            N = max(1, int(sys.argv[idx + 1]))
    except: pass
    if os.environ.get("EVAL_N"):
        try: N = max(1, int(os.environ["EVAL_N"]))
        except: pass

    print(f"=== Phase 2b 품질 평가 + 지연 SLO ({len(cases)}케이스 × N={N}회 다수결) ===\n")
    npass = nfail = 0
    latencies = []
    fails = []
    flaky = []  # 케이스별로 N회 결과가 갈린(=비결정성) 항목

    for cidx, c in enumerate(cases):
        cid = c["id"]; q = c["query"]; prof = c.get("profile")
        any_req = c.get("expect_tools_any") or []
        all_req = c.get("expect_tools_all") or []
        passes = 0; fails_n = 0
        case_lat = []
        first_err = None
        last_tools = []; last_ans = ""
        if cidx > 0: time.sleep(1.5)   # 케이스 간 짧은 페이싱 — Gemini quota 보호
        for i in range(N):
            if i > 0: time.sleep(0.8)   # 반복 간 페이싱
            data, ms, err = ask(q, prof)
            if err:
                fails_n += 1
                if first_err is None: first_err = err
                continue
            case_lat.append(ms); latencies.append(ms)
            tools = (data.get("data") or {}).get("toolsUsed") or []
            ans = data.get("answer") or ""
            last_tools = tools; last_ans = ans
            ok = bool(ans)
            if any_req: ok = ok and any(t in tools for t in any_req)
            if all_req: ok = ok and all(t in tools for t in all_req)
            passes += 1 if ok else 0
            fails_n += 0 if ok else 1

        # 다수결: passes > N/2 → PASS
        majority_pass = passes > (N / 2)
        tag = "PASS" if majority_pass else "FAIL"
        if majority_pass: npass += 1
        else: nfail += 1; fails.append(cid)
        is_flaky = (passes != 0 and passes != N)  # 일부만 통과 = 비결정성
        if is_flaky: flaky.append(cid)

        prof_tag = ("[+" + (prof.get("occupation") or prof.get("affiliation") or prof.get("purpose") or "?") + "]") if prof else "[baseline]"
        med = (sorted(case_lat)[len(case_lat) // 2] if case_lat else 0)
        flaky_tag = " (flaky)" if is_flaky else ""
        print(f"[{tag}] {cid:35s} {prof_tag:18s} {passes}/{N}{flaky_tag:8s}  med={med:>4d}ms  last_tools={','.join(last_tools) if last_tools else '-'}")
        if tag == "FAIL" or is_flaky:
            print(f"        any={any_req} all={all_req}  last_ans={last_ans[:80]!r}{(' err=' + first_err) if first_err else ''}")

    print()
    print("------ 요약 ------")
    print(f"PASS {npass} / FAIL {nfail} / 총 {len(cases)} (다수결 N={N})")
    if flaky:
        print(f"비결정성(flaky, N회 중 일부만 통과) {len(flaky)}건:", ",".join(flaky))
    if latencies:
        print(f"지연 SLO  p50={percentile(latencies,0.5)}ms  p95={percentile(latencies,0.95)}ms  "
              f"평균={sum(latencies)//len(latencies)}ms  min={min(latencies)}ms  max={max(latencies)}ms  n={len(latencies)} 호출")
    if fails:
        print("실패(다수결) 케이스:", ",".join(fails))
        sys.exit(1)
    print("다수결 기준 모두 통과 ✅")
    sys.exit(0)

if __name__ == "__main__":
    main()
