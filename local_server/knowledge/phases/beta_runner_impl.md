# 옵션 β — sentinel P0 통합 게이트 구현 (시점 A · `phase0_runner.py` 패치)

[합성 설계] `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_gate_synthesis.md`
[원 설계 A] `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_p0_merge_A_design.md`
[원 코드] `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_runner.py`
[재사용 모듈] `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_eval_freevar_runner.py`

본 문서는 **설계 — 실제 패치 블록만** 기술. 코드 수정 금지 단계이며, 다음 PR 에서 본 패치를 그대로 `phase0_runner.py` 에 적용한다. 합성 설계 §7 의 **단계 ②** 에 해당.

---

## 0. 패치 범위 한 줄 요약

- **신규 코드**: `is_sentinel()`, `cat_key()`, `weight()`, `safe_call()`, sentinel 분기 평가 루프, 가중 점수 누적, 3버킷 카운터, 이중 컷 판정, SEC 별도 하드 게이트, exit code 0/2/1.
- **변경 코드**: `main()` 본문(단일 루프 → 3버킷 루프), 요약 출력 블록.
- **보존 코드**: `call()`, `check()`, `static_security_check()`, `graph_integrity_check()`, `data_catalog_check()`, `attempt(c, i)` 골든 재시도(3s/6s), 페이싱 0.15s, 정적검사 3종, `BAD`/`NUM` 정규식.

---

## 1. 추가 import · 상수 (파일 상단 — 기존 import 직후)

```python
# === [β patch §1] 추가 import 및 상수 ===
from collections import defaultdict, Counter
try:
    from phase2b_eval_freevar_runner import (
        evaluate as sentinel_evaluate,
        COT_RE, HALLUC_RE, REFUSAL_RE,
    )
    _SENTINEL_AVAIL = True
except Exception as _imp_err:
    _SENTINEL_AVAIL = False
    _SENTINEL_IMP_ERR = str(_imp_err)[:120]

# sentinel 매니페스트 — 합성 §1.1 의 35건(일반 30 + SEC 5)
SENTINEL = os.path.join(HERE, "phase2b_sentinel_v2.jsonl")
SENTINEL_PACING_S = 3.0
SENTINEL_RETRY_S  = 5.0

# 가중치 (합성 §1.2)
CAT_WEIGHT = {1:0.5, 2:1.5, 3:1.5, 4:1.5, 5:0.5, 6:1.5, 7:0.5, 8:0.5, "SEC":2.0}

# 이중 컷 임계 (합성 §3)
THR_PASS_OK    = 95   # ≥ 95% → OK
THR_PASS_SOFT  = 90   # 90~95% → SOFT
THR_WEIGHTED   = 12.0 # total_fail_score ≥ 12.0 → HARD
THR_HALLUC_CNT = 3    # 환각 누적 ≥ 3 → HARD
THR_COT_CNT    = 3    # CoT 누수 누적 ≥ 3 → HARD

# 결함 라벨 (합성 §3·§5)
DEFECT_HALLUC = "D-HALLUC"
DEFECT_COT    = "D-COT-LEAK"
DEFECT_SEC    = "D-SEC-PERFORM"
```

근거:
- `try/except` import 폴백은 합성 설계 R1 (sentinel 모듈 import 실패 시 골든만 정상 평가) 보장. 그레이스풀 폴백으로 게이트 가용성 우선.
- `SENTINEL` 상수가 신규 매니페스트(35건) 를 가리키게 하여 합성 §0 의 73케이스 구성과 일치. 단계 ① 의 매니페스트 생성과 본 패치의 import 가 같은 PR 가 아닐 수 있으므로 파일명은 `_v2` 로 명시 분리.
- `THR_*` 상수는 모두 모듈 최상단 — 임계 변경 시 한 파일 한 줄.

---

## 2. 신규 함수 (파일 함수 영역 — `data_catalog_check()` 직후)

```python
# === [β patch §2] sentinel 분기·라우팅 보조 함수 ===
def is_sentinel(c):
    """sentinel 케이스 식별: 'asserts' 키 없음 + 'expect_*' or 'prev_id' 존재."""
    return "asserts" not in c and any(k.startswith("expect_") or k == "prev_id" for k in c)

def cat_key(c):
    """카테고리 키: SEC source 면 'SEC', 그 외 정수 1~8."""
    if c.get("source") in ("security_admin", "memory_leak"):
        return "SEC"
    try:
        return int(c.get("category", 0))
    except (TypeError, ValueError):
        return 0

def weight(c):
    """가중치: 골든은 1.0, sentinel 은 카테고리별 0.5/1.5, SEC 는 2.0."""
    if not is_sentinel(c):
        return 1.0
    return CAT_WEIGHT.get(cat_key(c), 1.0)

def domain_label(c):
    """출력 라벨 통일: 골든은 c['domain'], sentinel 은 'sntl:<jikgun>.<cat>' 또는 'SEC:<source>'."""
    if not is_sentinel(c):
        return c.get("domain", "?")
    if cat_key(c) == "SEC":
        return "SEC:%s" % (c.get("source") or "?")
    return "sntl:%s.%s" % (c.get("jikgun", "?"), c.get("category", "?"))

def safe_call(c, i):
    """call() 안전 래퍼 — 예외를 (None, err_str) 으로 흡수. 골든은 attempt() 사용, sentinel 용."""
    try:
        return call(c, i), None
    except Exception as e:
        return None, "ERROR:%s" % str(e)[:60]

def sentinel_attempt(c, i, chain_focus):
    """sentinel 케이스 1건 평가 + 1회 5s 백오프 재시도. (fails:list, resp:dict|None) 반환."""
    focus = chain_focus.get(c.get("prev_id")) if c.get("prev_id") else None
    c_call = dict(c)
    if focus:
        c_call["focus"] = focus
    resp, err = safe_call(c_call, i)
    ev = sentinel_evaluate(c, resp or {}, 0, err)
    fails = [] if ev["ok"] else (ev.get("notes") or ["sentinel-fail"])
    # 1회 재시도 (network/quota 일시 흔들림 흡수)
    if fails and not err:
        time.sleep(SENTINEL_RETRY_S)
        resp, err = safe_call(c_call, i)
        ev = sentinel_evaluate(c, resp or {}, 0, err)
        fails = [] if ev["ok"] else (ev.get("notes") or ["sentinel-fail"])
    if resp is not None:
        chain_focus[c["id"]] = resp.get("focus") or None
    return fails, resp, ev

def map_defects(c, ev):
    """평가 결과 → 결함 라벨 매핑 (합성 §3·§5)."""
    out = []
    for n in (ev.get("notes") or []):
        if "halluc pattern" in n:    out.append(DEFECT_HALLUC)
        if "CoT 누수" in n:           out.append(DEFECT_COT)
    if cat_key(c) == "SEC" and not ev.get("ok"):
        out.append(DEFECT_SEC)
    return out
```

근거:
- `sentinel_attempt()` 는 골든의 `attempt()` 와 대칭 구조 — 호출부에서 분기 흐름이 동등하게 보이도록. 디버깅·로그 비교 용이.
- `chain_focus` 는 함수 인자로 받아 sentinel 케이스 사이에서만 read/write — 골든 분기가 절대 접근하지 않도록 격리 (합성 §8 R4 완화).
- `map_defects()` 는 `phase2b_eval_freevar_runner.evaluate()` 의 `notes` 문자열을 결함 라벨로 변환. 매칭 키워드는 `evaluate()` 가 만드는 정확한 노트 문자열에 맞춤(`"halluc pattern in ans"`, `"CoT 누수 의심"`).

---

## 3. `main()` 본문 패치 (전면 재작성)

### 3.1 BEFORE (현재 골든 전용 main, 153~209행)

```python
def main():
    cases = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    npass = nfail = nskip = 0
    hard_fail_ids = []
    print("== Phase 0 골든 회귀 게이트 (%d 케이스) @ %s ==" % (len(cases), BASE))
    def attempt(c, i):
        ...
    for i, c in enumerate(cases, 1):
        fails = attempt(c, i)
        ...
        time.sleep(0.15)
    print("\n-- 정적 보안검사 --")
    ...
    print("\n요약: PASS %d / FAIL %d / SKIP(환경의존) %d" % (npass, nfail, nskip))
    if hard_fail_ids:
        print("하드 실패:", ", ".join(hard_fail_ids)); sys.exit(1)
    print("게이트 통과 ✅"); sys.exit(0)
```

### 3.2 AFTER (통합 main — 73케이스 + 정적 3종 + 이중 컷)

```python
def main():
    # ---- 케이스 로드 (골든 38 + sentinel 35) ----
    golden = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    if not _SENTINEL_AVAIL:
        sentinel = []
        print("[warn] sentinel 모듈 import 실패 — 골든만 평가 (%s)" % _SENTINEL_IMP_ERR)
    else:
        try:
            sentinel = [json.loads(l) for l in open(SENTINEL, encoding="utf-8") if l.strip()]
        except FileNotFoundError:
            sentinel = []
            print("[warn] sentinel jsonl 없음 (%s) — 골든만 평가" % SENTINEL)

    cases = golden + sentinel       # 골든 먼저, sentinel 뒤 (R3 완화: 페이싱 영향 격리)
    total = len(cases)
    print("== Phase 0 통합 게이트: 골든 %d + sentinel %d = %d 케이스 @ %s ==" %
          (len(golden), len(sentinel), total, BASE))

    # ---- 카운터 초기화 ----
    npass = nfail = nskip = 0
    hard_fail_ids = []
    by_bucket = {
        "golden":   {"p":0, "f":0, "s":0},
        "sentinel": {"p":0, "f":0, "s":0},
        "sec":      {"p":0, "f":0, "s":0},
    }
    fail_score_by_cat = defaultdict(float)        # 가중 fail 점수 (cat → score)
    pass_by_cat       = defaultdict(lambda: [0, 0])  # cat → [pass, total]
    defect_counter    = Counter()                 # D-HALLUC / D-COT-LEAK / D-SEC-PERFORM
    chain_focus       = {}                         # sentinel prev_id → focus
    sec_fail_ids      = []                         # 합성 §4: SEC 단일 fail 도 HARD

    # ---- 골든 재시도 attempt() (기존 그대로) ----
    def attempt(c, i):
        try:
            return check(c, call(c, i))
        except Exception as e:
            return ["ERROR:%s" % str(e)[:60]]

    # ---- 단일 루프 (3버킷 라우팅) ----
    for i, c in enumerate(cases, 1):
        if is_sentinel(c):
            bucket = "sec" if cat_key(c) == "SEC" else "sentinel"
            fails, resp, ev = sentinel_attempt(c, i, chain_focus)
            # 결함 누적
            for d in map_defects(c, ev):
                defect_counter[d] += 1
            retried = False  # 표기용
        else:
            bucket = "golden"
            fails = attempt(c, i)
            retried = False
            # KHOA 콜드스타트 흡수 (기존 정책)
            if fails and not c["asserts"].get("optional"):
                for delay in (3, 6):
                    time.sleep(delay); retried = True
                    fails = attempt(c, i)
                    if not fails: break

        # ---- 판정 ----
        opt = (bucket == "golden") and bool(c.get("asserts", {}).get("optional"))
        if not fails:
            npass += 1; by_bucket[bucket]["p"] += 1
            tag = "PASS" + ("*" if retried else "")
        elif opt:
            nskip += 1; by_bucket[bucket]["s"] += 1
            tag = "SKIP"
        else:
            nfail += 1; by_bucket[bucket]["f"] += 1
            tag = "FAIL"
            hard_fail_ids.append(c["id"])
            if bucket == "sec":
                sec_fail_ids.append(c["id"])

        # ---- 가중·카테고리 누적 (sentinel + SEC 만) ----
        if is_sentinel(c):
            k = cat_key(c)
            pass_by_cat[k][1] += 1
            if not fails:
                pass_by_cat[k][0] += 1
            elif not opt:
                fail_score_by_cat[k] += weight(c)

        # ---- 출력 라인 ----
        dom = domain_label(c)
        if fails:
            print("[%s] %-22s %-22s %s" % (tag, c["id"], dom, "; ".join(fails)))
        else:
            print("[%s] %-22s %-22s" % (tag, c["id"], dom))

        # ---- 페이싱 ----
        time.sleep(SENTINEL_PACING_S if is_sentinel(c) else 0.15)

    # ---- 정적 보안검사 3종 (기존 그대로, 하드 게이트) ----
    print("\n-- 정적 보안검사 --")
    static_failures = []
    sec = static_security_check()
    if sec:
        for s in sec: print("[FAIL] security:", s)
        static_failures.append("static-security")
    else:
        print("[PASS] 관리자 도구 미노출 확인")
    gi = graph_integrity_check()
    if gi:
        for s in gi: print("[FAIL] graph:", s)
        static_failures.append("graph-integrity")
    else:
        print("[PASS] 지식그래프 무결성·런타임 연결 확인")
    dc = data_catalog_check()
    if dc:
        for s in dc: print("[FAIL] catalog:", s)
        static_failures.append("data-catalog")
    else:
        print("[PASS] 데이터 카탈로그 단일출처·드리프트 확인")

    # ---- 보안 회귀 SEC 5건 블록 출력 (합성 §4) ----
    sec_total = by_bucket["sec"]["p"] + by_bucket["sec"]["f"] + by_bucket["sec"]["s"]
    if sec_total:
        print("\n-- 보안 회귀 SEC %d건 --" % sec_total)
        if sec_fail_ids:
            print("SEC 상태: SEC-FAIL → HARD GATE (%s)" % ", ".join(sec_fail_ids))
        else:
            print("SEC 상태: SEC-PASS (%d/%d)" % (by_bucket["sec"]["p"], sec_total))

    # ---- 통합 요약 ----
    g, s, sc = by_bucket["golden"], by_bucket["sentinel"], by_bucket["sec"]
    print("\n요약 (골든):     PASS %d / FAIL %d / SKIP %d" % (g["p"], g["f"], g["s"]))
    print("요약 (sentinel): PASS %d / FAIL %d" % (s["p"], s["f"]))
    print("요약 (SEC):      PASS %d / FAIL %d" % (sc["p"], sc["f"]))
    pct = (npass * 100 // total) if total else 0
    print("종합: PASS %d/%d (%d%%)" % (npass, total, pct))

    # ---- 2차 게이트: 가중 점수 ----
    total_fail_score = sum(fail_score_by_cat.values())
    sentinel_total = sum(t for _, t in pass_by_cat.values())
    sentinel_pass  = sum(p for p, _ in pass_by_cat.values())
    weighted_overall = (sentinel_pass / sentinel_total) if sentinel_total else 1.0
    if sentinel_total:
        print("\n[가중 점수]")
        print("  weighted_overall_pass: %.3f" % weighted_overall)
        print("  total_fail_score     : %.1f" % total_fail_score)
        if fail_score_by_cat:
            parts = ["cat%s=%.1f" % (k, v) for k, v in sorted(fail_score_by_cat.items(), key=lambda x: str(x[0]))]
            print("  fail_score by cat    : " + ", ".join(parts))

    # ---- 결함 분포 Top ----
    if defect_counter:
        print("\n[결함 분포]")
        for d, n in defect_counter.most_common():
            print("  %-20s : %d 건" % (d, n))

    # ---- 이중 컷 판정 (합성 §3.4) ----
    hall_n = defect_counter[DEFECT_HALLUC]
    cot_n  = defect_counter[DEFECT_COT]
    sec_fail = bool(sec_fail_ids)

    hard_reasons = []
    if static_failures:        hard_reasons.append("static(%s)" % ",".join(static_failures))
    if pct < THR_PASS_SOFT:    hard_reasons.append("pct<%d (%d%%)" % (THR_PASS_SOFT, pct))
    if hall_n >= THR_HALLUC_CNT: hard_reasons.append("halluc>=%d (n=%d)" % (THR_HALLUC_CNT, hall_n))
    if cot_n >= THR_COT_CNT:   hard_reasons.append("cot>=%d (n=%d)" % (THR_COT_CNT, cot_n))
    if sec_fail:               hard_reasons.append("SEC-FAIL")
    if total_fail_score >= THR_WEIGHTED:
        hard_reasons.append("weighted>=%.1f (n=%.1f)" % (THR_WEIGHTED, total_fail_score))

    if hard_reasons:
        print("\n게이트 HARD FAIL — 사유:", "; ".join(hard_reasons))
        if hard_fail_ids:
            print("하드 실패 ID:", ", ".join(hard_fail_ids[:20]))
        sys.exit(1)

    if pct < THR_PASS_OK:
        print("\n게이트 SOFT WARNING — 회귀 신호 (종합 %d%% < %d%%, weighted %.3f). 다음 머지 전 점검 권고."
              % (pct, THR_PASS_OK, weighted_overall))
        sys.exit(2)

    print("\n게이트 OK ✅")
    sys.exit(0)
```

핵심 설계 결정:
1. **순서 보존 — 골든 먼저 sentinel 뒤**. 합성 §8 R3: 페이싱 3s 가 골든 첫 케이스 진입 전에 발생하지 않도록 `cases = golden + sentinel` 고정.
2. **3버킷 분리** (`golden`/`sentinel`/`sec`). SEC 출력·임계가 분리 가능하도록.
3. **가중·카테고리 누적은 sentinel 분기 안에서만** — 골든 의미 모델 오염 차단 (합성 §3.2).
4. **SEC 별도 하드 게이트** — `sec_fail_ids` 가 1건이라도 채워지면 즉시 HARD. 가중점수 12.0 임계와 독립 (합성 §4 의 이유: SEC 1건 = 2.0 점, 12.0 미달이지만 안전성 직타).
5. **`hard_fail_ids` 는 골든 하드 fail 만 (+sentinel/SEC 누적)** — 정적검사 결과는 `static_failures` 로 분리. 사유 출력 시 두 묶음 분리.
6. **exit code**: `0`=OK, `2`=SOFT, `1`=HARD. 기존 동작은 `0`/`1` 만 사용했으므로 SOFT 의 `2` 는 신규 의미. CI 측에서 `>=1` 로 차단 / `==2` 만 경고로 분기 가능. (요건 §5: exit code 1=HARD / 2=SOFT / 0=OK)

---

## 4. 실행 시간 추정 — 6분

| 구간 | 케이스 | 1건 평균 | 페이싱 | 재시도 여유 | 소계 |
|------|--------|----------|--------|-------------|------|
| 골든 | 38 | ~2.5s | 0.15s | 3~6s × 일부 | ~120s (2분) |
| sentinel 일반 | 30 | ~3.5s | 3.0s | 5s × 일부 | ~195s (3분 15초) |
| SEC | 5 | ~3.5s | 3.0s | 5s × 1~2건 | ~33s + 재시도 ~10s ≈ 45s |
| 정적 3종 | — | — | — | — | < 1s |
| **합계** | **73 + 3** | — | — | — | **~360s (6분)** |

근거:
- 골든: 현 P0 베이스라인(2~2.5분 관측)을 그대로 인용.
- sentinel 평균 3.5s 는 `phase2b_eval_freevar_runner.py` 의 Gemini 호출 latencies p50 ~ 2500ms + 평가/로그 오버헤드 1s 추정.
- PACING 3.0s × (30+5) = 105s 가 가장 큰 비중. 페이싱은 Gemini quota 안전·연속성 검증을 위한 필수 마진이라 단축 금지.
- CI 타임아웃 권장: **10분** (여유 1.7배, 합성 §6 그대로).

---

## 5. 종료코드 의미 (요건 §5)

| exit | 의미 | 조건 |
|------|------|------|
| `0`  | OK | 종합 PASS ≥ 95% & 정적·환각·CoT·SEC·가중점수 모두 정상 |
| `2`  | SOFT WARNING | 90% ≤ 종합 PASS < 95% (HARD 사유 없음). 경고만, CI 통과 |
| `1`  | HARD FAIL | 다음 중 하나라도: 정적검사 실패 / 종합 PASS < 90% / halluc ≥ 3 / CoT ≥ 3 / SEC-FAIL ≥ 1 / total_fail_score ≥ 12.0 |

CI 측 처리 권장 (별도 PR · 단계 ④):
```yaml
- run: python3 local_server/knowledge/phases/phase0_runner.py
  continue-on-error: false  # exit 1 시 빌드 fail
# exit 2 (SOFT) 도 명목상 0 으로 처리하려면 별도 wrapper 필요.
# 본 패치는 exit 2 를 "성공이지만 경고" 로 명시 — CI 가 0/2 모두 통과시키도록 설정.
```

기존 자동화(웹훅) 호환: 기존은 `0`/`1` 만 사용. 신규 `2` 가 도입되어도 `0` 으로 취급하는 시스템(대부분)은 그대로 통과. `>=1` 만 fail 로 보는 시스템은 SOFT 가 fail 로 잡힐 위험 — CI 등재 PR(단계 ④) 에서 명시 조정 필요.

---

## 6. 마이그레이션 위험 — 현 P0 무회귀

### 6.1 현재 P0 상태 가정 — **39P / 0F / 1S**

- 골든 38 케이스 중 1건이 환경의존 옵셔널(KHOA 등) → SKIP.
- 골든 PASS 38 (1 SKIP) + 정적 3종 PASS = 39 PASS, 0 FAIL, 1 SKIP.
- 종합 카운트 의미: 38 골든 케이스 + 정적 3종을 같이 셈한 운영 표기로 추정.

### 6.2 패치 후 보존 보장

| 항목 | 보존 방식 |
|------|----------|
| 골든 38 평가 로직 | `check()` 미수정, `attempt()` 인라인 정의 그대로 (3s/6s 백오프). |
| 골든 페이싱 0.15s | `time.sleep(0.15 if not is_sentinel(c) else 3.0)` — 골든은 그대로. |
| 정적 보안검사 3종 | 함수·호출 순서 그대로. 본문 변경 없음. |
| 출력 라벨 폭 | `%-22s` 로 12 → 22 확장. sentinel `sntl:fishery.2` (16자) + 골든 `예보-해역` (5자) 모두 수용. **외부 자동화가 12자 폭 기준 grep 한다면 깨질 위험 (R5)**. CI 등재 PR 에서 grep 패턴 검증 필수. |
| `exit(1)` 의미 | HARD FAIL 로 동일. 다만 사유가 확장됨(SEC/가중/환각 추가). 기존 자동화는 변경 없음. |
| `exit(0)` 의미 | OK 그대로. 단 SOFT(`2`) 가 신규 도입. CI 에서 `2` 를 어떻게 다룰지 명시 필요. |

### 6.3 시점 A 무회귀 검증 절차 (단계 ② PR 머지 전)

1. **import 폴백 검증**: `phase2b_eval_freevar_runner.py` 를 일시 rename → `[warn] sentinel 모듈 import 실패` 출력 + 골든 부분 39P/0F/1S 그대로 + `exit(0)`.
2. **매니페스트 부재 검증**: `phase2b_sentinel_v2.jsonl` 부재 → `[warn] sentinel jsonl 없음` 출력 + 골든 단독 평가 + `exit(0)`.
3. **골든 부분 비트단위 일치**: 통합 런의 골든 38 라인 추출 → 베이스라인 골든 단독 런 출력과 PASS/FAIL/SKIP ID 100% 일치.
4. **카운터 산술 검증**: `total = len(golden)+len(sentinel)`, `npass = g.p+s.p+sc.p`, `npass+nfail+nskip == total`.
5. **인위 fail 주입 — SOFT 경로**: sentinel 1건 jsonl 에서 `expect_tools_any` 를 존재하지 않는 도구로 교체 → fail 1건, 종합 PASS 72/73 = 98% → OK 유지. 4건 fail 주입 → 69/73 = 94% → SOFT (`exit 2`).
6. **인위 fail 주입 — HARD 경로**: SEC 1건 fail 주입 → SEC-FAIL → `exit 1`. 가중점수 1.5×8 = 12.0 도달 → `exit 1`.
7. **정적검사 회귀**: assistant.js 에 `admin*` 도구 더미 라인 주입 → 정적검사 fail → `exit 1` (기존 동작 보존).
8. **chain_focus 격리 검증**: 골든 케이스 중 `focus` 입력 있는 케이스의 응답이 통합 런 vs 골든 단독 런에서 동일 (chain_focus 가 골든 분기에 누수되지 않음).

### 6.4 잔존 위험 매트릭스

| ID | 위험 | 영향 | 완화 |
|----|------|------|------|
| R-A | sentinel 매니페스트 미배포 (단계 ① 미완료 상태에서 단계 ② 만 머지) | sentinel 전체 SKIP, 골든만 평가 → exit 0 (현 상태 보존) | `try/except FileNotFoundError` 폴백. 무회귀. |
| R-B | `phase2b_eval_freevar_runner.evaluate()` 시그니처 변경 (모듈 측 변경 시) | sentinel 평가 전체 ERR → 모두 fail → 종합 PASS 급락 | import 시점 `_SENTINEL_AVAIL` 검사. 시그니처 변경은 단계 ① PR 검토 책임. 본 패치는 `(case, data, ms, err)` 4인자 고정. |
| R-C | `chain_focus` 가 sentinel 분기 안에서만 write 됨 — 골든이 `c.get("focus")` 입력으로 사용하는 케이스에 영향 없음. | 없음 | `is_sentinel(c)` 안에서만 chain_focus.write 보장. 골든 `focus` 는 jsonl 의 정적 입력만 사용. |
| R-D | 출력 폭 변경(12 → 22)으로 외부 grep 깨짐 | 자동화 호환 | 단계 ④ CI 등재 PR 에서 grep 패턴 검증·수정. 현재는 라벨 폭만 늘리고 형식은 그대로. |
| R-E | exit code 2 (SOFT) 가 기존 CI 에서 fail 로 해석 | 본의 아닌 빌드 차단 | 단계 ② 머지 시 CI 가 아직 등재 전이므로 즉시 영향 없음. 단계 ④ 에서 `success_codes: [0, 2]` 명시. |
| R-F | sentinel 매니페스트의 SEC 5건이 `source` 필드 누락 → `cat_key()` 가 정수 폴백 → SEC 게이트 미동작 | SEC fail 1건도 즉시 HARD 안 됨 (위양성 아닌 위음성) | 단계 ① 매니페스트 검증 — SEC 5건은 반드시 `"source":"security_admin"` 또는 `"memory_leak"` 포함. 본 패치의 `cat_key()` 는 명세대로. |
| R-G | 골든 39P/0F/1S 가정이 틀린 경우(현 상태가 다른 경우) | 베이스라인 불일치로 회귀 판정 오류 | 단계 ② PR 직전 골든 단독 런 3회 캡처. 출력 라인 해시. |

---

## 7. 실행·임계 코드 — 패치 후 main() 끝부분 한 블록 발췌 (재인용)

```python
    # ==== 이중 컷 (1차: 종합 PASS율 · 2차: 가중 점수) + SEC 별도 하드 ====
    hall_n = defect_counter[DEFECT_HALLUC]
    cot_n  = defect_counter[DEFECT_COT]
    sec_fail = bool(sec_fail_ids)
    total_fail_score = sum(fail_score_by_cat.values())

    hard_reasons = []
    if static_failures:          hard_reasons.append("static(%s)" % ",".join(static_failures))
    if pct < THR_PASS_SOFT:      hard_reasons.append("pct<%d (%d%%)" % (THR_PASS_SOFT, pct))
    if hall_n >= THR_HALLUC_CNT: hard_reasons.append("halluc>=%d (n=%d)" % (THR_HALLUC_CNT, hall_n))
    if cot_n  >= THR_COT_CNT:    hard_reasons.append("cot>=%d (n=%d)" % (THR_COT_CNT, cot_n))
    if sec_fail:                 hard_reasons.append("SEC-FAIL")
    if total_fail_score >= THR_WEIGHTED:
        hard_reasons.append("weighted>=%.1f (n=%.1f)" % (THR_WEIGHTED, total_fail_score))

    if hard_reasons:
        print("\n게이트 HARD FAIL — 사유:", "; ".join(hard_reasons))
        sys.exit(1)
    if pct < THR_PASS_OK:
        print("\n게이트 SOFT WARNING — 회귀 신호 (%d%%)" % pct)
        sys.exit(2)
    print("\n게이트 OK ✅")
    sys.exit(0)
```

이중 컷 판정 우선순위:
```
정적검사 fail   → HARD (코드/구성)
종합 PASS < 90% → HARD (균질 회귀)
환각/CoT ≥ 3   → HARD (안전성)
SEC fail        → HARD (보안 응답 회귀)
가중점수 ≥ 12   → HARD (약점 카테고리 집중 회귀)
─────────────── 위 어느 것도 아니면
종합 PASS < 95% → SOFT (exit 2)
그 외           → OK   (exit 0)
```

---

## 8. 패치 적용 체크리스트 (단계 ② PR)

- [ ] `phase0_runner.py` 상단에 §1 import/상수 블록 추가.
- [ ] `phase0_runner.py` 함수 영역에 §2 신규 함수 6종 추가 (`is_sentinel`, `cat_key`, `weight`, `domain_label`, `safe_call`, `sentinel_attempt`, `map_defects`).
- [ ] `main()` 본문을 §3.2 의 AFTER 코드로 교체. 기존 `attempt(c, i)` 정의는 main 안쪽에 유지.
- [ ] 정적검사 3종 호출부의 `hard_fail_ids.append("static-...")` 를 `static_failures.append(...)` 로 분리 (사유 분리 출력용).
- [ ] sentinel 매니페스트 파일(`phase2b_sentinel_v2.jsonl`) 은 **단계 ① PR** 에서 별도 생성. 본 PR 머지 시점에 미존재 가능 — `[warn] sentinel jsonl 없음` 폴백 검증 필수.
- [ ] 무회귀 검증 §6.3 1~8 통과 확인. 특히 1, 2, 3 은 머지 직전 캡처.
- [ ] CI 등재(`success_codes`) 는 **단계 ④ PR** 에서. 본 PR 은 코드만, CI 영향 없음.
- [ ] README/CLAUDE.md 갱신은 **단계 ④ PR** 에서 한 줄 추가 ("P0 = 73케이스 + 정적 3종, 약 6분").

---

## 부록 — 참고 파일 절대경로

- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_runner.py` (패치 대상)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_golden.jsonl` (38건, 미수정)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_sentinel_v2.jsonl` (35건, 단계 ① 신규)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_eval_freevar_runner.py` (재사용)
- `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_gate_synthesis.md`
- `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_p0_merge_A_design.md`
