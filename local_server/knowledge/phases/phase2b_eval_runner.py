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

def ask(query, profile=None):
    body = {"query": query, "memory": []}
    if profile is not None:
        body["profile"] = profile
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read().decode("utf-8")
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            return json.loads(raw), elapsed_ms, None
    except urllib.error.HTTPError as e:
        return None, int((time.monotonic() - t0) * 1000), f"HTTP {e.code}"
    except Exception as e:
        return None, int((time.monotonic() - t0) * 1000), f"{type(e).__name__}: {e}"

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

    print(f"=== Phase 2b 품질 평가 + 지연 SLO 베이스라인 ({len(cases)}케이스) ===\n")
    npass = nfail = 0
    latencies = []
    fails = []
    for c in cases:
        cid = c["id"]; q = c["query"]; prof = c.get("profile")
        data, ms, err = ask(q, prof)
        if err:
            print(f"[FAIL] {cid:35s}  ERR {err}  ({ms}ms)")
            nfail += 1; fails.append(cid); continue
        latencies.append(ms)
        tools = (data.get("data") or {}).get("toolsUsed") or []
        ans = data.get("answer") or ""
        any_req = c.get("expect_tools_any") or []
        all_req = c.get("expect_tools_all") or []
        ok = bool(ans)
        if any_req: ok = ok and any(t in tools for t in any_req)
        if all_req: ok = ok and all(t in tools for t in all_req)
        if ok:
            npass += 1
            tag = "PASS"
        else:
            nfail += 1; fails.append(cid)
            tag = "FAIL"
        prof_tag = ("[+" + (prof.get("occupation") or prof.get("affiliation") or prof.get("purpose") or "?") + "]") if prof else "[baseline]"
        print(f"[{tag}] {cid:35s} {prof_tag:18s} {ms:>5d}ms  tools={','.join(tools) if tools else '-'}")
        if tag == "FAIL":
            print(f"        any={any_req} all={all_req}  ans={ans[:90]!r}")

    print()
    print("------ 요약 ------")
    print(f"PASS {npass} / FAIL {nfail} / 총 {len(cases)}")
    if latencies:
        print(f"지연 SLO 베이스라인  p50={percentile(latencies,0.5)}ms  p95={percentile(latencies,0.95)}ms  "
              f"평균={sum(latencies)//len(latencies)}ms  min={min(latencies)}ms  max={max(latencies)}ms  n={len(latencies)}")
    if fails:
        print("실패 케이스:", ",".join(fails))
        sys.exit(1)
    print("모두 통과 ✅")
    sys.exit(0)

if __name__ == "__main__":
    main()
