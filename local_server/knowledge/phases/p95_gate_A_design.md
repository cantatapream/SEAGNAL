# p95 게이트화 설계 (시점 A — 백오프-제외 순수 지연 측정)

> §6 #25 DoD `p95 ≤ 5000ms` 항목을 실측 가능한 게이트로 만든다.
> 현재 자유변칙 p95 = 6712ms (v2) — DoD 초과 +1712ms. 단, 현 측정값은
> 클라이언트 wall-clock 으로 **429 백오프 sleep 4/9/15s 포함** → 노이즈로
> 갭이 과대평가될 수 있음. 이 문서는 (1) 백오프-제외 순수 지연 측정,
> (2) 카테고리별 p95 임계, (3) 회귀 게이트 통합, (4) 위반 처리 절차,
> (5) before/after 러너 스니펫을 정의한다.
>
> **제약**: 본 문서는 *설계* 만. 러너 코드 수정은 별도 PR.
> 최종 갱신: 2026-06-03.

---

## 0. 한눈에

| 항목 | 현재 (시점 A 이전) | 시점 A 이후 (설계 목표) |
|---|---|---|
| 측정 시점 | `t0 = monotonic()` (각 시도 직전) — 429 백오프 `sleep()` 누적됨 | **마지막 성공 시도** 의 `(t_end - t_start)` 만. 백오프 sleep 별도 누적 보고 |
| 통계 입력 | `elapsed_ms` (백오프 포함) | `pure_latency_ms` (백오프 제외) |
| 카테고리별 임계 | 없음(단일 5000ms) | 자유변칙 5000 · sentinel 4000 · 평가셋 3000 |
| 게이트 처리 | 출력만, 종료코드는 PASS/FAIL 만 본다 | p95 위반 시 `exit 1` — 회귀게이트가 차단 |
| CI 통합 | sentinel/freevar 둘 다 `workflow_dispatch` (비차단) | sentinel = PR 차단(빠르므로) · freevar = 스케줄 차단·PR 비차단 |
| 위반 처리 | 콘솔 출력만 | PR block(sentinel) / warning(freevar) / dashboard 알림 단계화 |

---

## 1. 백오프-제외 순수 지연 측정 방안

### 1.1 문제

현 `ask()` (양 러너 동일 구조):

```python
for attempt in range(max_retry + 1):
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            return json.loads(raw), elapsed_ms, None
    except HTTPError as e:
        last_ms = int((time.monotonic() - t0) * 1000)
        if e.code == 429 and attempt < max_retry:
            time.sleep(4 + attempt * 5)   # ← 이 sleep 이 다음 attempt 의 t0 직전에 흘러감
            continue
```

각 attempt 의 `t0` 가 직전 sleep 직후 시각이므로, **반환되는 `elapsed_ms` 는 마지막 성공 시도의 순수 latency** 다. 그러나:

- 러너 본체(`main()`)는 케이스 사이 `time.sleep(PACING_S)` 후 `ask()` 를 호출해 `data, ms, err = ask(...)` 의 `ms` 를 `latencies` 에 적재.
- `ask()` 내부 백오프 sleep 시간은 어디에도 보고되지 않음. → 운영자가 "sleep 이 측정값에 포함됐는가?" 를 사후 확인 불가.
- 또한 평가셋 러너(`phase2b_eval_runner.py`)는 반복(N=3) 사이 `time.sleep(0.8)` 도 있음 — 이건 ask() 외부라 측정 무관, OK.

결론: **현 측정값 `ms` 는 사실상 "마지막 성공 시도의 순수 latency"** 다. 단, (i) 명시적 분리 기록이 없어 검증 곤란, (ii) 429 가 누적 발생한 케이스의 wall-clock 비용(=사용자가 실제 느낄 비용 + 운영 비용) 도 별도 추적 필요.

### 1.2 측정 시점 A 의 정의 (제안)

`ask()` 가 (data, ms, err) 대신 (data, metrics, err) 를 반환. metrics 는 dict:

| 필드 | 정의 | 통계 사용 |
|---|---|---|
| `pure_ms` | 마지막 성공 attempt 의 `t_end - t_start` (ms) | **p50/p95 입력 (게이트 판정용)** |
| `backoff_ms` | 누적 sleep(백오프) 시간 (ms) | 보고 전용. wall-clock = pure_ms + backoff_ms |
| `attempts` | 실제 시도 수 (1=성공즉시, 2=1회 429 후 성공) | 보고 전용 |
| `last_attempt_ms` | 실패 종료 시 마지막 시도 시간 (성공 시 None) | 디버그 |

```python
# 설계(코드 수정 금지 — 시점 B 에서 구현)
def ask(query, profile=None, focus=None, max_retry=3):
    backoff_ms = 0
    last_pure = 0
    for attempt in range(max_retry + 1):
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                pure = int((time.monotonic() - t0) * 1000)
                return json.loads(r.read().decode("utf-8")), {
                    "pure_ms": pure,
                    "backoff_ms": backoff_ms,
                    "attempts": attempt + 1,
                    "last_attempt_ms": None,
                }, None
        except urllib.error.HTTPError as e:
            last_pure = int((time.monotonic() - t0) * 1000)
            if e.code == 429 and attempt < max_retry:
                wait_s = 4 + attempt * 5    # 또는 freevar: 5 + attempt*5
                time.sleep(wait_s)
                backoff_ms += int(wait_s * 1000)
                continue
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1, "last_attempt_ms": last_pure}, f"HTTP {e.code}"
        except Exception as e:
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                          "attempts": attempt + 1,
                          "last_attempt_ms": int((time.monotonic()-t0)*1000)}, f"{type(e).__name__}: {e}"
```

러너 main() 측:
- `latencies_pure.append(m["pure_ms"])` → p50/p95 입력
- `backoff_total_ms += m["backoff_ms"]` · `backoff_cases += 1 if m["backoff_ms"] else 0`
- 보고 라인:
  - `지연(pure)  p50=… p95=… (게이트 판정 대상)`
  - `백오프(별도)  총 …s · 발생 …건 / …건 · 평균 …ms/건`
  - `wall-clock(참고)  p95 = pure_p95 + backoff_p95`

### 1.3 호환성

- 외부 호출자(아무도 없음, 단일 파일 main) 영향 없음.
- `evaluate()` 등은 `ms` 만 보던 곳이 있으면 `m["pure_ms"]` 로 치환.
- JSONL 출력(없음) 도입 시 metrics 그대로 dump 가능.

---

## 2. 카테고리별 p95 임계 권장

DoD 의 단일 5000ms 는 자유변칙(440)을 가정한 보수 값. 평가셋·sentinel 은 도메인이 좁고 빠른 도구가 많아 더 엄격한 임계를 권장.

| 측정 대상 | 케이스 수 | 권장 p95 임계 | 근거 |
|---|---|---|---|
| **자유변칙** (freevar 440) | 440 | **≤ 5000ms** | §6 #25 DoD 원문. 8 직군 × 8 카테고리 분포의 평균적 어려움(다중 도구·연속·외부 의존). |
| **sentinel** (20케이스) | 20 | **≤ 4000ms** | 핵심 결함 직타용 빠른 회귀. 외부 의존이 적고(20케이스 중 marine 의존 ≤ 6), 자유변칙 만점 라운드 평가셋 p95(3255~4691) 보다 약간 보수. 2026-06-03 측정 p95 6588ms 는 m**arine 외부 의존 1건 spike** 가 끌어올린 값 — 백오프-제외/외부의존 SKIP 분리 후 4000ms 권장. |
| **평가셋** (eval 10) | 10 | **≤ 3000ms** | 만점 라운드 실측 p95 3255ms(2026-05-30) → 4691ms(v4 패치 후). 룰베이스 직군 디지스트 + multi-tool 한정. n=30(N=3 다수결 × 10) 충분히 분산 작아 3000ms 권장. |

추가 권장:
- **p50 임계도 함께 보고**: 평가셋 ≤ 2000ms · sentinel ≤ 2500ms · freevar ≤ 3000ms (warning 만).
- **외부의존 spike 격리**: marine.kma 등 외부 API 의존 케이스는 별도 그룹으로 집계 → 외부 장애 시 p95 폭증을 본체 갭과 분리. (구현: 케이스 메타에 `external_dep: marine_kma` 필드, 통계에 `latencies_internal` / `latencies_external` 분리)
- **임계 미달성 시점은 베이스라인 갱신 후 락**: 현재 자유변칙 p95 미해소 → 백오프-제외 측정 후 첫 베이스라인을 마스터플랜 §7 에 기록하고, 이후 회귀 방지 임계로 사용.

---

## 3. phase0/sentinel 게이트 통합

### 3.1 현재 흐름

- `phase0_runner.py` = 골든 38케이스(구조 불변식). 지연 측정 없음.
- `phase2b_sentinel.jsonl` 20케이스 = freevar 러너로 실행, sentinel 게이트화는 §6 #25 next.
- CI: `ci_workflow_draft.yml` 의 `phase0-static`(머지 차단·서버 불요) / `golden-gate`(스케줄·비차단). sentinel 잡 미정의.

### 3.2 통합 설계

**(a) 신규 잡 `sentinel-gate` 추가** — sentinel 20케이스 + p95 ≤ 4000 게이트.

- 트리거: `pull_request` (paths 동일) + `push` + `workflow_dispatch`.
- 차단 여부: **PR 차단**(빠르고 결정적, ≤ 5분). 단 외부 API spike 위양성 회피를 위해 **외부의존 케이스는 SKIP 라벨** 후 PASS 카운트에서 분리.
- 시크릿: `golden-gate` 와 동일(서버 부팅 필요). MARINE_DISABLE=1 로 외부의존 축소.
- 종료 코드: 러너가 `pass_fail` OR `p95_violation` OR `flaky_above_threshold` 중 하나라도 → exit 1.

**(b) 신규 잡 `freevar-gate-nightly`** — 440케이스 + p95 ≤ 5000.

- 트리거: 스케줄 (예: 매일 04:00 KST, golden 03:00 직후) + workflow_dispatch.
- 차단 여부: **PR 비차단(시간 ≈ 38분)**. nightly 실패 시 dashboard 알림 + 다음날 PR 라벨 강제(예: `freevar-failing`).
- 종료 코드: PASS ≥ 85% AND 직군 floor ≥ 70% AND 카테고리 ≥ 70% AND 환각 ≤ 2 AND **pure p95 ≤ 5000** 모두 충족 → exit 0. 하나라도 실패 → exit 1.

**(c) `phase0_runner.py` 변경 (시점 B)** — 지연 게이트는 sentinel/freevar 가 담당, phase0 은 구조 불변식만 유지. 단, **phase0 도 `pure_ms` 보고 추가**(평균/p95 로깅) 해 트렌드 추적.

### 3.3 CI 워크플로 영향

`ci_workflow_draft.yml` 에 두 잡 추가 (개념):

```yaml
sentinel-gate:
  name: sentinel 회귀 + p95 (≤4000) — 머지 차단
  if: github.event_name == 'pull_request' || github.event_name == 'push'
  needs: [lint, builders, phase0-static]
  runs-on: ubuntu-latest
  # (서버 부팅 단계는 golden-gate 와 동일, MARINE_DISABLE=1)
  steps:
    - name: sentinel 20케이스 + p95 게이트
      env:
        SENTINEL_P95_MS: '4000'
      run: |
        cd knowledge/phases
        python3 -c "
        import phase2b_eval_freevar_runner as r
        from pathlib import Path
        r.EVAL = Path('phase2b_sentinel.jsonl').resolve()
        r.P95_GATE_MS = int(__import__('os').environ['SENTINEL_P95_MS'])
        r.main()
        "

freevar-gate-nightly:
  name: 자유변칙 440 + DoD (p95 ≤5000) — 스케줄 차단·PR 비차단
  if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
  runs-on: ubuntu-latest
  timeout-minutes: 60
  # (서버 부팅 동일)
  steps:
    - run: |
        cd knowledge/phases
        FREEVAR_P95_MS=5000 \
        FREEVAR_DOD_PASS_PCT=85 \
        FREEVAR_DOD_JIKGUN_FLOOR=70 \
        FREEVAR_DOD_CAT_FLOOR=70 \
        FREEVAR_DOD_HALLUC_MAX=2 \
        python3 phase2b_eval_freevar_runner.py
```

브랜치 보호 규칙에 `sentinel-gate` 를 required status check 로 추가. `freevar-gate-nightly` 는 비required(스케줄 통계만).

---

## 4. 게이트 위반 시 처리 단계

| 단계 | 조건 | 조치 | 책임 |
|---|---|---|---|
| **PR block** | sentinel-gate: PASS<16/20 OR pure p95 > 4000 OR CoT 누수 ≥1 OR 환각 ≥1 | GitHub status check fail → merge 버튼 비활성. PR comment 봇이 위반 항목 요약 + 백오프-제외 p95/wall-clock p95 비교표 첨부. | PR 작성자 → 나리야팀 |
| **Warning (PR 코멘트)** | sentinel-gate: PASS=17~19/20 (1~3건 회귀) OR p95 3500~4000ms (임계 80~100%) | 봇 코멘트 only — 머지 가능. 단 라벨 `perf-warning` 자동 부여. | 나리야팀 (다음 PR 에서 정리) |
| **Nightly dashboard 알림** | freevar-gate-nightly: 5개 DoD 항목 중 1개라도 실패 | Slack/이메일 알림 + `knowledge/phases/freevar_history.jsonl` 에 일자별 결과 추적. 3일 연속 실패 시 PR 라벨 `freevar-blocked` → 새 PR 머지 시 추가 검토 요구. | 나리야팀 (당일 분석) |
| **Hard block (불변식)** | CoT 누수 ≥1 OR 관리자 누설 ≥1 (sentinel/freevar 어디든) | sentinel/freevar 모두 즉시 exit 1 + PR 차단(스케줄도 nightly 실패로 표시) + on-call 즉시 호출. | 사장님 + 나리야팀 |
| **Soft fail (외부 의존)** | MARINE_DISABLE 미반영 외부 spike 의심 (외부의존 케이스 p95 > 임계, 내부 p95 ≤ 임계) | 내부 p95 만으로 게이트 통과 처리, dashboard 에 외부 spike 별도 표시. | 운영 (marine.kma 확인 — §6 #9) |

위반 메시지 포맷 (러너 stdout — CI 가 그대로 PR 코멘트로 전달):

```
=== p95 게이트 결과 ===
Sentinel 20케이스 · sleep 백오프 제외
  PASS              16/20 (gate ≥16)           ✅
  pure latency p95  4187ms (gate ≤4000ms)     ❌  +187ms
  pure latency p50  1454ms                     (참고)
  wall-clock p95    5012ms                     (백오프 825ms 포함, 참고)
  CoT 누수          0                           ✅
  환각              0                           ✅
  backoff           총 8.3s · 3건/20 발생       (참고)

VIOLATION: pure_latency_p95 (4187 > 4000)
exit 1
```

---

## 5. before/after 러너 스니펫

### 5.1 평가셋 러너 (`phase2b_eval_runner.py`)

**Before** (현행, 라인 43~68 / 156~158):

```python
def ask(query, profile=None, max_retry=3):
    ...
    for attempt in range(max_retry + 1):
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                elapsed_ms = int((time.monotonic() - t0) * 1000)
                return json.loads(raw), elapsed_ms, None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retry:
                time.sleep(4 + attempt * 5)
                continue
            ...

# main():
data, ms, err = ask(q, prof)
case_lat.append(ms); latencies.append(ms)
...
print(f"지연 SLO  p50={percentile(latencies,0.5)}ms  p95={percentile(latencies,0.95)}ms ...")
```

**After**:

```python
P95_GATE_MS = int(os.environ.get("EVAL_P95_MS", "3000"))   # 평가셋 임계

def ask(query, profile=None, max_retry=3):
    backoff_ms = 0
    for attempt in range(max_retry + 1):
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                pure = int((time.monotonic() - t0) * 1000)
                return json.loads(raw), {"pure_ms": pure, "backoff_ms": backoff_ms,
                                          "attempts": attempt + 1}, None
        except urllib.error.HTTPError as e:
            last_pure = int((time.monotonic() - t0) * 1000)
            if e.code == 429 and attempt < max_retry:
                wait_s = 4 + attempt * 5
                time.sleep(wait_s); backoff_ms += wait_s * 1000
                continue
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                           "attempts": attempt + 1, "last_attempt_ms": last_pure}, f"HTTP {e.code}"

# main():
data, m, err = ask(q, prof)
if not err:
    case_lat.append(m["pure_ms"]); latencies.append(m["pure_ms"])
    backoff_total_ms += m["backoff_ms"]
    if m["backoff_ms"]: backoff_cases += 1
...
p95_pure = percentile(latencies, 0.95)
print(f"지연 SLO (pure)  p50={percentile(latencies,0.5)}ms  p95={p95_pure}ms (gate ≤{P95_GATE_MS}ms)")
print(f"백오프 (별도)    총 {backoff_total_ms//1000}s · 발생 {backoff_cases}/{len(latencies)}건")

violations = []
if nfail: violations.append(f"FAIL {nfail}건")
if p95_pure > P95_GATE_MS:
    violations.append(f"pure p95 {p95_pure} > {P95_GATE_MS}")
if violations:
    print("VIOLATION:", " · ".join(violations)); sys.exit(1)
```

### 5.2 자유변칙 러너 (`phase2b_eval_freevar_runner.py`)

**Before** (라인 64~87 / 228~231):

```python
def ask(query, profile=None, focus=None, max_retry=3):
    ...
    for attempt in range(max_retry + 1):
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(...) as r:
                elapsed = int((time.monotonic()-t0)*1000)
                return json.loads(raw), elapsed, None
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retry:
                wait = 5 + attempt * 5    # 5/10/15
                time.sleep(wait); continue
            ...

# main():
data, ms, err = ask(c["query"], c.get("profile"), focus)
if data is not None: latencies.append(ms)
...
print(f"지연 SLO  p50={percentile(latencies,0.5)}ms  p95={percentile(latencies,0.95)}ms ...")
```

**After**:

```python
P95_GATE_MS = int(os.environ.get("FREEVAR_P95_MS", "5000"))
DOD_PASS_PCT      = int(os.environ.get("FREEVAR_DOD_PASS_PCT", "85"))
DOD_JIKGUN_FLOOR  = int(os.environ.get("FREEVAR_DOD_JIKGUN_FLOOR", "70"))
DOD_CAT_FLOOR     = int(os.environ.get("FREEVAR_DOD_CAT_FLOOR", "70"))
DOD_HALLUC_MAX    = int(os.environ.get("FREEVAR_DOD_HALLUC_MAX", "2"))

def ask(query, profile=None, focus=None, max_retry=3):
    backoff_ms = 0
    for attempt in range(max_retry + 1):
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(...) as r:
                pure = int((time.monotonic()-t0)*1000)
                return json.loads(raw), {"pure_ms": pure, "backoff_ms": backoff_ms,
                                          "attempts": attempt + 1}, None
        except urllib.error.HTTPError as e:
            last_pure = int((time.monotonic()-t0)*1000)
            if e.code == 429 and attempt < max_retry:
                wait = 5 + attempt * 5
                time.sleep(wait); backoff_ms += wait * 1000
                continue
            return None, {"pure_ms": 0, "backoff_ms": backoff_ms,
                           "attempts": attempt + 1, "last_attempt_ms": last_pure}, f"HTTP {e.code}"

# main():
data, m, err = ask(c["query"], c.get("profile"), focus)
if data is not None:
    latencies.append(m["pure_ms"])
    backoff_total_ms += m["backoff_ms"]
    if m["backoff_ms"]: backoff_cases += 1
...
# 게이트 판정 (DoD 5항목)
p95_pure = percentile(latencies, 0.95)
pass_pct = npass*100//total if total else 0
jikgun_min = min((s["pass"]*100//s["total"]) for s in by_jg.values() if s["total"]) if by_jg else 0
cat_min = min((s["pass"]*100//s["total"])
              for jg in by_jg_cat for s in by_jg_cat[jg].values() if s["total"])

print(f"\n=== p95 게이트 결과 (자유변칙 DoD) ===")
print(f"  PASS            {pass_pct}% (gate ≥{DOD_PASS_PCT}%)")
print(f"  직군 floor      {jikgun_min}% (gate ≥{DOD_JIKGUN_FLOOR}%)")
print(f"  카테고리 floor  {cat_min}% (gate ≥{DOD_CAT_FLOOR}%)")
print(f"  환각 의심       {len(halluc_samples)} (gate ≤{DOD_HALLUC_MAX})")
print(f"  pure p95        {p95_pure}ms (gate ≤{P95_GATE_MS}ms)")
print(f"  백오프(별도)    총 {backoff_total_ms//1000}s · 발생 {backoff_cases}/{len(latencies)}건")

violations = []
if pass_pct < DOD_PASS_PCT:     violations.append(f"PASS {pass_pct}<{DOD_PASS_PCT}%")
if jikgun_min < DOD_JIKGUN_FLOOR: violations.append(f"jikgun floor {jikgun_min}<{DOD_JIKGUN_FLOOR}%")
if cat_min < DOD_CAT_FLOOR:     violations.append(f"cat floor {cat_min}<{DOD_CAT_FLOOR}%")
if len(halluc_samples) > DOD_HALLUC_MAX: violations.append(f"halluc {len(halluc_samples)}>{DOD_HALLUC_MAX}")
if p95_pure > P95_GATE_MS:       violations.append(f"pure p95 {p95_pure}>{P95_GATE_MS}")

if violations:
    print("\nVIOLATION:", " · ".join(violations))
    sys.exit(1)
print("\nALL GATES PASS ✅")
sys.exit(0)
```

---

## 6. 시점 A → B 전환 체크리스트 (시점 B 에서 구현 시)

- [ ] `ask()` 시그니처 변경 — `(data, metrics, err)` 반환. 양 러너 동시 적용.
- [ ] `latencies` → `latencies_pure` 리네임 + `backoff_total_ms` 누적 추가.
- [ ] 환경변수 게이트 임계 6종 (`EVAL_P95_MS`/`SENTINEL_P95_MS`/`FREEVAR_P95_MS`/`FREEVAR_DOD_*`).
- [ ] sentinel 러너 진입점 — 현재 `python3 -c "import ...; r.EVAL = ..."` 우회 대신 `--eval=PATH` 플래그 추가(시점 B 권장).
- [ ] CI 워크플로 — `sentinel-gate` (PR 차단) + `freevar-gate-nightly` (스케줄) 두 잡 추가.
- [ ] 첫 측정으로 자유변칙 pure p95 베이스라인 산출 → §7 변경이력 + cross_cutting.md §2/§7.1 갱신("백오프 노이즈 가설" 검증/기각).
- [ ] DoD 표 (cross_cutting.md §7.3) 현재충족 카운트 갱신.
- [ ] dashboard 연동 (옵션) — `freevar_history.jsonl` 일자별 적재 + 3일 연속 실패 라벨.

---

## 7. 위험·완화

| 위험 | 영향 | 완화 |
|---|---|---|
| pure p95 도 5000ms 초과로 판명 | DoD 미달 확정 — Phase 3 착수 보류 장기화 | (i) 외부의존 케이스 격리(§2) → 내부 p95 만 게이트, (ii) 카테고리/직군 패치 사이클 가속, (iii) 임베딩·합성 비용 절감(§6 #10 v3) |
| 외부 API spike 가 sentinel 차단 (위양성) | 무관한 PR 차단 | 외부의존 케이스 SKIP 라벨 + `MARINE_DISABLE=1` 강제 + soft fail 단계(§4 표) |
| 429 백오프 자체가 운영 비용 — 측정에서 빼면 시야에서 사라짐 | 실 운영 wall-clock 증가 미인지 | `wall-clock p95 = pure + backoff` 참고 라인 항상 출력 + nightly dashboard 에 backoff 추세 적재 |
| 게이트 임계 락 시점이 너무 빠름 | 초기 변동성에 끌려다님 | 첫 측정 후 3회 평균을 베이스라인으로, 임계는 베이스라인 × 1.1 (10% 여유) 또는 DoD 값 중 큰 값 |
| CI 시간 증가 (sentinel +5분) | PR 피드백 지연 | sentinel 만 PR 차단(≤5분). freevar 38분은 nightly 만 |

---

## 8. 요약

1. **순수 지연 = 마지막 성공 attempt 의 `(t_end - t_start)` 만**. 429 백오프 sleep 은 `backoff_ms` 로 별도 누적·보고.
2. **카테고리별 p95 임계**: 평가셋 ≤3000 · sentinel ≤4000 · 자유변칙 ≤5000.
3. **CI 게이트 통합**: `sentinel-gate` (PR 차단) + `freevar-gate-nightly` (스케줄 차단). 외부의존 spike 격리.
4. **위반 단계**: PR block / warning(코멘트) / nightly dashboard / hard block(불변식) / soft fail(외부의존) 5단계.
5. **러너 변경 최소 침습**: `ask()` 반환 dict 화 + 게이트 임계 환경변수화 + main 말미 violation 누적 후 exit 1. 코드 수정은 시점 B.
