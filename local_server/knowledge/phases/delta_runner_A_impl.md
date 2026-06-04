# 옵션 δ — p95 게이트화 raw_ms 적재 시점 A (러너 패치 diff)

> 입력: `p95_gate_synthesis.md` (raw_ms 케이스별 적재 채택 + A 분위수 합성 오류 정정) · `p95_gate_A_design.md` (ask() 반환 `(data, metrics, err)` 설계).
> 본 문서는 **양 러너의 `ask()` + main() + 출력 포맷 변경**을 patch diff 로만 제시.
> **제약**: 코드 수정 금지 — 본 문서는 *patch 의사코드* 만. 실제 적용은 별도 PR.
> 작성: 2026-06-04.

---

## 0. 한눈에 (변경 5축)

| 축 | 변경 | 양 러너 공통 여부 |
|---|------|----------------|
| 1 | `ask()` 시그니처: `(data, ms, err)` → `(data, metrics, err)` · `metrics = {pure_ms, backoff_ms, attempts, last_attempt_ms}` | **공통** (동일 함수 시그니처) |
| 2 | main(): 케이스별 `raw_ms = pure_ms + backoff_ms` 적재 (`latencies_net` + `latencies_raw` 두 리스트) — **분위수의 합 금지, 합의 분위수만 사용** | **공통** |
| 3 | 통계 보고: p50/p95 를 net·raw 둘 다 노출 + backoff_ms 평균/최대 + 429 발생 카운트 | **공통** (포맷 라벨 동일) |
| 4 | 카테고리 임계 검사 → `EVAL_P95_MS`(3000) / `SENTINEL_P95_MS`(4000) / `FREEVAR_P95_MS`(5000). 위반 시 `sys.exit(1)` | 평가셋 러너 = `EVAL_P95_MS`, 자유변칙 러너 = `FREEVAR_P95_MS` 기본값. sentinel 은 freevar 러너 진입점 재사용 — `SENTINEL_P95_MS` 가 설정되면 그 값 우선. |
| 5 | freevar 러너 DoD 5항목(PASS%/직군 floor/카테고리 floor/환각/p95) → 모두 게이트화, 위반 시 `sys.exit(1)` | 자유변칙 러너 전용 |

**A↔B 정합**: synthesis §1 의 명명 매핑(`pure_ms` ≡ `net`, `pure_ms + backoff_ms` ≡ `raw`) 그대로. stdout 라벨은 `net`/`raw` 채택.

**합성 오류 정정**: A design §1.2 의 "wall-clock p95 = pure_p95 + backoff_p95" 합성 → **폐기**. 케이스별 `raw_ms` 적재 후 `percentile(latencies_raw, 0.95)` 직접 계산.

---

## 1. 평가셋 러너 `phase2b_eval_runner.py` patch diff

### 1.1 헤더 import + 상수 (라인 34~41)

**Before** (라인 34~41):

```python
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL = HERE / "phase2b_eval.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask"
TIMEOUT = 60
```

**After** (라인 34~46):

```python
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL = HERE / "phase2b_eval.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask"
TIMEOUT = 60

# p95 게이트 임계 — 환경변수로 카테고리별 오버라이드 (synthesis §0 항목2)
# 평가셋 default 3000 · sentinel(외부 진입점)은 SENTINEL_P95_MS 로 덮어쓰기.
P95_GATE_MS = int(os.environ.get(
    "SENTINEL_P95_MS",
    os.environ.get("EVAL_P95_MS", "3000")
))
RAW_GATE_RATIO = float(os.environ.get("RAW_GATE_RATIO", "1.5"))  # raw WARN 비율
```

### 1.2 `ask()` 함수 (라인 43~68)

**Before** (라인 43~68):

```python
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
```

**After** (라인 43~80):

```python
def ask(query, profile=None, max_retry=3):
    """호출 + 429 백오프 재시도. (data, metrics, err) 반환.
    metrics = {pure_ms, backoff_ms, attempts, last_attempt_ms}
      · pure_ms        : 마지막 성공 attempt 의 (t_end - t_start)
      · backoff_ms     : 누적 sleep(429 백오프) 시간 ms
      · attempts       : 실제 시도 수 (1=즉시 성공)
      · last_attempt_ms: 실패 종료 시 마지막 시도 ms (성공 시 None)
    raw_ms = pure_ms + backoff_ms 는 호출자(main)에서 케이스별 합산.
    """
    body = {"query": query, "memory": []}
    if profile is not None:
        body["profile"] = profile
    payload = json.dumps(body).encode("utf-8")
    backoff_ms = 0
    last_pure = 0
    for attempt in range(max_retry + 1):
        req = urllib.request.Request(URL, data=payload,
            headers={"Content-Type": "application/json"}, method="POST")
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
                wait_s = 4 + attempt * 5    # 4s → 9s → 14s
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
                  "last_attempt_ms": last_pure}, "HTTP 429(retry exhausted)"
```

### 1.3 main() 적재 (라인 106~135)

**Before** (라인 106~135):

```python
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
```

**After**:

```python
    npass = nfail = 0
    latencies_net = []          # pure_ms 누적 — p95 게이트 판정 대상
    latencies_raw = []          # pure_ms + backoff_ms 누적 — raw 보고용
    backoff_per_case_ms = []    # 케이스별 backoff_ms (평균/최대 산출용)
    n_429 = 0                   # 429 발생 케이스 수 (backoff_ms > 0)
    fails = []
    flaky = []

    for cidx, c in enumerate(cases):
        cid = c["id"]; q = c["query"]; prof = c.get("profile")
        any_req = c.get("expect_tools_any") or []
        all_req = c.get("expect_tools_all") or []
        passes = 0; fails_n = 0
        case_lat = []
        first_err = None
        last_tools = []; last_ans = ""
        if cidx > 0: time.sleep(1.5)
        for i in range(N):
            if i > 0: time.sleep(0.8)
            data, m, err = ask(q, prof)
            if err:
                fails_n += 1
                if first_err is None: first_err = err
                # backoff 만 발생하고 결국 실패한 경우도 백오프는 적재
                if m["backoff_ms"]:
                    backoff_per_case_ms.append(m["backoff_ms"]); n_429 += 1
                continue
            pure = m["pure_ms"]; bo = m["backoff_ms"]
            case_lat.append(pure)
            latencies_net.append(pure)
            latencies_raw.append(pure + bo)     # ← 케이스별 raw (합성 금지)
            backoff_per_case_ms.append(bo)
            if bo: n_429 += 1
            tools = (data.get("data") or {}).get("toolsUsed") or []
            ans = data.get("answer") or ""
            last_tools = tools; last_ans = ans
            ok = bool(ans)
            if any_req: ok = ok and any(t in tools for t in any_req)
            if all_req: ok = ok and all(t in tools for t in all_req)
            passes += 1 if ok else 0
            fails_n += 0 if ok else 1
```

### 1.4 출력 포맷 + 게이트 판정 (라인 151~163)

**Before** (라인 151~163):

```python
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
```

**After**:

```python
    print()
    print("------ 요약 ------")
    print(f"PASS {npass} / FAIL {nfail} / 총 {len(cases)} (다수결 N={N})")
    if flaky:
        print(f"비결정성(flaky, N회 중 일부만 통과) {len(flaky)}건:", ",".join(flaky))

    if latencies_net:
        p50_net = percentile(latencies_net, 0.5)
        p95_net = percentile(latencies_net, 0.95)
        p50_raw = percentile(latencies_raw, 0.5)
        p95_raw = percentile(latencies_raw, 0.95)
        bo_avg = sum(backoff_per_case_ms) // len(backoff_per_case_ms) if backoff_per_case_ms else 0
        bo_max = max(backoff_per_case_ms) if backoff_per_case_ms else 0
        print(f"지연 SLO (net = pure_ms, raw = pure + backoff)")
        print(f"  net  p50={p50_net}ms  p95={p95_net}ms  (gate ≤{P95_GATE_MS}ms)")
        print(f"  raw  p50={p50_raw}ms  p95={p95_raw}ms  (raw WARN >{int(P95_GATE_MS*RAW_GATE_RATIO)}ms)")
        print(f"  backoff 평균 {bo_avg}ms · 최대 {bo_max}ms · 429 발생 {n_429}/{len(latencies_net)}건")
        print(f"  n={len(latencies_net)} 호출")
    else:
        p95_net = 0; p95_raw = 0

    violations = []
    if fails:
        violations.append(f"FAIL {len(fails)}건")
    if p95_net > P95_GATE_MS:
        violations.append(f"net p95 {p95_net}>{P95_GATE_MS}")
    warn_raw = p95_raw > int(P95_GATE_MS * RAW_GATE_RATIO)
    if warn_raw:
        print(f"⚠ raw p95 {p95_raw}ms > {int(P95_GATE_MS*RAW_GATE_RATIO)}ms (외부쿼터 WARN — exit 영향 없음)")

    if fails:
        print("실패(다수결) 케이스:", ",".join(fails))
    if violations:
        print("\nVIOLATION:", " · ".join(violations))
        sys.exit(1)
    print("다수결+지연 게이트 모두 통과 ✅")
    sys.exit(0)
```

---

## 2. 자유변칙 러너 `phase2b_eval_freevar_runner.py` patch diff

### 2.1 헤더 import + 상수 (라인 31~42)

**Before** (라인 31~42):

```python
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
```

**After** (라인 31~52):

```python
import json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
EVAL = HERE / "phase2b_eval_freevar.jsonl"
PORT = int(os.environ.get("PORT", "3001"))
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask"
TIMEOUT = 60
PACING_S = 3.0
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
```

### 2.2 `ask()` 함수 (라인 64~87)

**Before** (라인 64~87):

```python
def ask(query, profile=None, focus=None, max_retry=3):
    body = {"query": query, "memory": []}
    if profile is not None: body["profile"] = profile
    if focus is not None: body["focus"] = focus
    payload = json.dumps(body).encode("utf-8")
    last_ms = 0
    for attempt in range(max_retry + 1):
        req = urllib.request.Request(URL, data=payload,
            headers={"Content-Type":"application/json"}, method="POST")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8")
                elapsed = int((time.monotonic()-t0)*1000)
                return json.loads(raw), elapsed, None
        except urllib.error.HTTPError as e:
            last_ms = int((time.monotonic()-t0)*1000)
            if e.code == 429 and attempt < max_retry:
                wait = 5 + attempt * 5  # 5, 10, 15
                time.sleep(wait); continue
            return None, last_ms, f"HTTP {e.code}"
        except Exception as e:
            return None, int((time.monotonic()-t0)*1000), f"{type(e).__name__}: {e}"
    return None, last_ms, "HTTP 429(exhausted)"
```

**After** (라인 64~99):

```python
def ask(query, profile=None, focus=None, max_retry=3):
    """(data, metrics, err) 반환 — 평가셋 러너와 동일 시그니처.
    metrics = {pure_ms, backoff_ms, attempts, last_attempt_ms}
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
```

### 2.3 main() 적재 (라인 173~208)

**Before** (라인 173~208):

```python
    chain_focus = {}  # case_id → focus
    by_jg = defaultdict(lambda: {"pass":0, "fail":0, "total":0})
    by_jg_cat = defaultdict(lambda: defaultdict(lambda: {"pass":0, "total":0}))
    latencies = []
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
        data, ms, err = ask(c["query"], c.get("profile"), focus)
        ev = evaluate(c, data, ms, err)
        if data is not None: latencies.append(ms)
        jg = c["jikgun"]; cat = c["category"]
        by_jg[jg]["total"] += 1
        by_jg_cat[jg][cat]["total"] += 1
        if ev["ok"]:
            by_jg[jg]["pass"] += 1
            by_jg_cat[jg][cat]["pass"] += 1
        else:
            by_jg[jg]["fail"] += 1
            fails.append((c["id"], jg, cat, ev.get("notes",[]), ev.get("ans_short","")))
```

**After**:

```python
    chain_focus = {}
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
```

### 2.4 출력 포맷 + DoD 5항목 게이트 판정 (라인 227~247)

**Before** (라인 227~247):

```python
    print()
    if latencies:
        print(f"지연 SLO  p50={percentile(latencies,0.5)}ms  p95={percentile(latencies,0.95)}ms  "
              f"평균={sum(latencies)//len(latencies)}ms  n={len(latencies)}")
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
    print(f"==== 종합 PASS {npass}/{total} ({npass*100//total if total else 0}%) · 소요 {int(time.time()-t_start)}s ====")
```

**After**:

```python
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
    print(f"  PASS              {pass_pct}% (gate ≥{DOD_PASS_PCT}%)            {'✅' if pass_pct>=DOD_PASS_PCT else '❌'}")
    print(f"  직군 floor        {jikgun_min}% (gate ≥{DOD_JIKGUN_FLOOR}%)         {'✅' if jikgun_min>=DOD_JIKGUN_FLOOR else '❌'}")
    print(f"  카테고리 floor    {cat_min}% (gate ≥{DOD_CAT_FLOOR}%)         {'✅' if cat_min>=DOD_CAT_FLOOR else '❌'}")
    print(f"  환각 의심         {len(halluc_samples)} (gate ≤{DOD_HALLUC_MAX})         {'✅' if len(halluc_samples)<=DOD_HALLUC_MAX else '❌'}")
    print(f"  net p95           {p95_net}ms (gate ≤{P95_GATE_MS}ms)       {'✅' if p95_net<=P95_GATE_MS else '❌'}")
    print(f"  ── 참고(외부쿼터 감시) ─────────────────────────")
    print(f"  raw p95           {p95_raw}ms (raw WARN >{int(P95_GATE_MS*RAW_GATE_RATIO)}ms)   {'⚠' if warn_raw else '✅'}")
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
    print("\nALL GATES PASS ✅")
    sys.exit(0)
```

---

## 3. 양 러너 통일 사항 (시그니처/포맷 표준)

| 항목 | 평가셋 러너 | 자유변칙 러너 | 비고 |
|------|------------|---------------|------|
| `ask()` 반환 | `(data, metrics, err)` | `(data, metrics, err)` | **동일 시그니처** |
| `metrics` 필드 | `pure_ms`/`backoff_ms`/`attempts`/`last_attempt_ms` | 동일 | sentinel 진입점이 freevar 러너를 `import` 재사용해도 인터페이스 호환 |
| 백오프 wait | `4 + attempt*5` (4/9/14s) | `5 + attempt*5` (5/10/15s) | **기존 정책 유지** (synthesis §1 변경 없음) — `backoff_ms` 누적 방식만 통일 |
| 분위수 산출 | `latencies_net` + `latencies_raw` 두 리스트 → 각각 `percentile()` | 동일 | **분위수의 합 금지, 합의 분위수만** |
| 게이트 임계 ENV | `EVAL_P95_MS`(3000) · `SENTINEL_P95_MS` (우선) | `FREEVAR_P95_MS`(5000) · `SENTINEL_P95_MS` (우선) | sentinel 진입점에서 `SENTINEL_P95_MS=4000` 설정 시 양쪽 모두 4000 적용 |
| 출력 라벨 | `net p50/p95` + `raw p50/p95` + `backoff 평균/최대/총/429건수` | 동일 + DoD 5항목 게이트 블록 | 라벨 표기 통일 (synthesis §1 명명표 채택) |
| 위반 처리 | `sys.exit(1)` (net p95 초과 또는 FAIL) | `sys.exit(1)` (DoD 5항목 중 1개라도 실패) | `raw` 는 WARN(stdout) 만, exit 영향 없음 |

### 3.1 sentinel 진입점 호환성 (A design §3.2 (a))

```python
# .github/workflows/ci.yml — sentinel-gate 잡 진입점 (변경 없음)
SENTINEL_P95_MS=4000 \
python3 -c "
import phase2b_eval_freevar_runner as r
from pathlib import Path
r.EVAL = Path('phase2b_sentinel.jsonl').resolve()
r.main()
"
```

- `SENTINEL_P95_MS=4000` 환경변수가 freevar 러너 모듈의 `P95_GATE_MS` 를 4000 으로 덮어씀.
- 동일 `ask()` 시그니처라 sentinel/freevar 양쪽 진입점에서 metrics 처리 분기 불필요.

### 3.2 출력 포맷 통일 양식

```
=== Phase 2b … 평가 ===
…(케이스별 진행)…

지연 SLO (net = pure_ms, raw = pure + backoff)
  net  p50=[x]ms  p95=[x]ms  (gate ≤[GATE]ms)
  raw  p50=[x]ms  p95=[x]ms  (raw WARN >[GATE×1.5]ms)
  backoff 평균 [x]ms · 최대 [x]ms · 총 [x]s · 429 발생 [n]/[total]건
  n=[total] 호출

[자유변칙만]
=== p95 게이트 결과 (자유변칙 DoD) ===
  PASS              [x]% (gate ≥85%)            [✅/❌]
  직군 floor        [x]% (gate ≥70%)            [✅/❌]
  카테고리 floor    [x]% (gate ≥70%)            [✅/❌]
  환각 의심         [n] (gate ≤2)               [✅/❌]
  net p95           [x]ms (gate ≤5000ms)        [✅/❌]
  ── 참고(외부쿼터 감시) ─────────────────────────
  raw p95           [x]ms (raw WARN >7500ms)    [⚠/✅]
  백오프(차이)      총 [x]s · 발생 [n]/[total]건

VIOLATION: [목록]    ← 있으면 exit 1
ALL GATES PASS ✅   ← 없으면 exit 0
```

---

## 4. 불변식·정합 점검

1. **synthesis §1 명명**: 러너 내부 `pure_ms`/`backoff_ms` 유지, stdout 라벨 `net`/`raw` 로 표기. 헤더 1줄 범례 출력 (`net = pure_ms, raw = pure + backoff`). ✅ §1.4/§2.4 반영.
2. **synthesis §1 분위수 정정**: 케이스별 `raw_ms = pure_ms + backoff_ms` 적재 후 직접 분위수 산출. **합성식 사용 금지**. ✅ §1.3/§2.3 의 `latencies_raw.append(pure + bo)` 로 구현.
3. **synthesis §4.1 게이트 양식**: DoD 5항목 + raw 참고 라인. ✅ §2.4 반영.
4. **A design §3.2 sentinel 진입점**: freevar 러너 `import` 재사용 + `SENTINEL_P95_MS` 우선. ✅ §3.1 반영.
5. **A design §1.3 호환성**: `evaluate()` 가 `ms` 만 보던 기존 인터페이스 — `m["pure_ms"]` 로 치환. ✅ §2.3 `evaluate(c, data, m["pure_ms"] if m else 0, err)` 로 보존.
6. **백오프 wait 정책**: 평가셋 4/9/14s(`4 + attempt*5`), freevar 5/10/15s(`5 + attempt*5`). **기존과 동일** — 본 패치는 누적 기록만 추가. ✅
7. **exit 코드**: 평가셋 = FAIL 또는 net p95 초과 시 1. 자유변칙 = DoD 5항목 중 1개라도 실패 시 1. raw 는 WARN 만 (exit 영향 없음). ✅ §1.4/§2.4.

---

## 5. 후속 (시점 B — 본 패치 적용 PR 메모)

- 적용 위치: `local_server/knowledge/phases/phase2b_eval_runner.py` + `phase2b_eval_freevar_runner.py`.
- 적용 순서: §1 → §2 (평가셋 먼저, sentinel/freevar 다음). 양 러너 동시 적용해야 sentinel 진입점이 호환.
- 첫 측정 후: synthesis §7 단계 2(베이스라인 산출) 수행 → cross_cutting §7.1/§7.3 갱신.
- assistant_log v1.1 `backoffMs` 필드는 본 패치 범위 외 (별도 PR — synthesis §6).

---

## 6. 한 줄 요약

`ask()` 시그니처를 `(data, metrics={pure_ms,backoff_ms,attempts,last_attempt_ms}, err)` 로 통일하고 main 에서 케이스별 `raw_ms = pure_ms + backoff_ms` 를 별도 리스트에 적재해 net·raw p95 를 각각 분위수로 직접 산출(합성 금지), DoD 5항목·net p95 위반 시 `sys.exit(1)`, raw 는 1.5배 초과 시 WARN 만 표기.
