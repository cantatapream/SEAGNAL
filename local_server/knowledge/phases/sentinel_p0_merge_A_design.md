# Sentinel → Phase 0 게이트 통합 설계 (시점 A · 러너 통합)

옵션 라 합류 시점 A. `phase0_runner.py` 가 `phase0_golden.jsonl`(38) 과 `phase2b_sentinel.jsonl`(20) 을 한 게이트에서 직렬 평가한다. 코드는 미수정, 설계만 기술.

---

## 1. 스키마 호환성 분석

### 1.1 두 스키마 비교

| 항목 | phase0_golden (38) | phase2b_sentinel (20) |
|---|---|---|
| 식별자 | `id` | `id` |
| 분류 키 | `domain` (예: "예보-해역") | `jikgun` + `category` (1~8) |
| 입력 | `query`, `profile?`, `memory?`, `focus?` | `query`, `profile?`, `prev_id?` |
| 어서션 컨테이너 | `case["asserts"]{...}` **중첩** | 케이스 루트 **평탄** |
| 도구 OR | `asserts.tools_include` | `expect_tools_any` |
| 도구 AND | `asserts.tools_all` | `expect_tools_all` |
| 도구 NOT | `asserts.tools_exclude` | (없음) |
| 호출 경로 | `asserts.method` ∈ internal/web/any | (없음) |
| 숫자 | `asserts.numeric` | (없음) |
| 거절 금지 | `asserts.not_nodata` | (없음, 오히려 REFUSAL 은 환각 가드의 보호장치) |
| 본문 금지/매칭 | `asserts.answer_excludes/_matches` | (없음) |
| 환각 가드 | (없음) | `expect_no_halluc` (HALLUC_RE & not REFUSAL_RE) |
| CoT 누수 가드 | (없음) | `expect_no_cot` (COT_RE) |
| 결정 단어 | (없음) | `expect_decision` (DECISION_RE) |
| 메타 요약 | (없음) | `expect_meta_summary` (tools≤1 & 10~200자) |
| 후속 연속성 | (없음 — `focus` 입력으로 수동 동봉) | `prev_id` → `expect_zone_match` (체이닝 자동) |
| 옵셔널 | `asserts.optional=true` → SKIP | (없음 — 모두 하드) |
| STT 교정 | `asserts.corrected` | (없음) |
| 재시도 정책 | 백오프 3s·6s, 최대 2회 | 429 만 5/10/15s, 최대 3회 |
| 케이스간 페이싱 | `time.sleep(0.15)` | `PACING_S = 3.0` |

### 1.2 통합 방안 — 어댑터 vs 분리 평가

두 어서션 모델은 **의미가 상보적**(골든=구조 불변식 + 보안 / sentinel=환각·CoT·연속성 행동축) 이며, 어서션 키도 겹치지 않는다. 따라서 **단일 평가기로 융합하지 않고 케이스별 분기 평가** 가 안전하다.

- 식별 방식: 케이스 dict 에 `"asserts"` 키가 있으면 **골든 경로**, 없고 `expect_*` 가 하나라도 있으면 **sentinel 경로**.
- `domain` 누락 시 sentinel 은 `jikgun:category` 합성 라벨로 출력 정렬 통일.
- 호출 본문 차이 흡수: 골든은 `memory/focus` 입력, sentinel 은 `prev_id` 체이닝. **체이닝 상태(chain_focus dict)** 는 sentinel 케이스에만 적용. 골든은 영향 없음.
- 페이싱: 골든 0.15s 유지, sentinel 케이스에만 3.0s 추가 sleep. (sentinel 은 Gemini quota·연속성 검증 안전 마진이 필요)
- 재시도: 골든의 3s/6s 백오프는 KHOA 콜드스타트 흡수용이라 그대로. sentinel 은 429 발생 시에만 추가 5/10/15s.

### 1.3 import vs 복사

`phase2b_eval_freevar_runner.py` 의 `evaluate()`, `COT_RE`, `HALLUC_RE`, `DECISION_RE`, `REFUSAL_RE` 를 phase0 가 **import** 하는 것이 단일 진실원천에 부합한다.

```python
# phase0_runner.py 상단
from phase2b_eval_freevar_runner import (
    evaluate as sentinel_evaluate,
    COT_RE, HALLUC_RE, REFUSAL_RE,  # 샘플 캡처용
)
```

단, 둘이 같은 디렉터리이므로 `sys.path` 손댈 필요 없음(`HERE` 가 모듈 경로 == 자기 자신). 임포트 실패 시 그레이스풀 폴백(sentinel 케이스만 SKIP) 로 게이트 가용성 우선.

---

## 2. `phase0_runner.py` 패치 설계

### 2.1 상수 추가

```python
SENTINEL = os.path.join(HERE, "phase2b_sentinel.jsonl")
SENTINEL_PACING_S = 3.0
```

### 2.2 BEFORE (현재 main 루프 발췌)

```python
def main():
    cases = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    npass = nfail = nskip = 0
    hard_fail_ids = []
    print("== Phase 0 골든 회귀 게이트 (%d 케이스) @ %s ==" % (len(cases), BASE))
    ...
    for i, c in enumerate(cases, 1):
        fails = attempt(c, i)
        ...  # 골든 어서션만
        time.sleep(0.15)
    print("\n-- 정적 보안검사 --")
    ...
    print("\n요약: PASS %d / FAIL %d / SKIP(환경의존) %d" % (npass, nfail, nskip))
```

### 2.3 AFTER (통합 후 골격)

```python
def is_sentinel(c):
    return "asserts" not in c and any(k.startswith("expect_") or k == "prev_id" for k in c)

def domain_label(c):
    return c.get("domain") or f"sntl:{c.get('jikgun','?')}.{c.get('category','?')}"

def main():
    golden = [json.loads(l) for l in open(GOLDEN, encoding="utf-8") if l.strip()]
    try:
        sentinel = [json.loads(l) for l in open(SENTINEL, encoding="utf-8") if l.strip()]
    except FileNotFoundError:
        sentinel = []
        print("[warn] sentinel jsonl 없음 — 골든만 평가")
    cases = golden + sentinel
    total = len(cases)
    print("== Phase 0 통합 게이트: 골든 %d + sentinel %d = %d 케이스 @ %s =="
          % (len(golden), len(sentinel), total, BASE))

    npass = nfail = nskip = 0
    hard_fail_ids = []
    by_bucket = {"golden": {"p":0,"f":0,"s":0}, "sentinel": {"p":0,"f":0,"s":0}}
    chain_focus = {}  # sentinel prev_id → focus

    for i, c in enumerate(cases, 1):
        bucket = "sentinel" if is_sentinel(c) else "golden"
        # 호출
        if bucket == "sentinel":
            focus = chain_focus.get(c.get("prev_id"))
            # call() 재사용을 위해 focus 를 case 에 임시 주입
            c_call = dict(c); 
            if focus: c_call["focus"] = focus
            try:
                resp = call(c_call, i)
                err = None
            except Exception as e:
                resp, err = None, "ERROR:%s" % str(e)[:60]
            ev = sentinel_evaluate(c, resp or {}, 0, err)
            fails = [] if ev["ok"] else (ev.get("notes") or ["sentinel-fail"])
            # 재시도: sentinel 은 한 번만 5s 백오프
            if fails and not err:
                time.sleep(5)
                try:
                    resp = call(c_call, i)
                    ev = sentinel_evaluate(c, resp or {}, 0, None)
                    fails = [] if ev["ok"] else (ev.get("notes") or ["sentinel-fail"])
                except Exception as e:
                    fails = ["ERROR:%s" % str(e)[:60]]
            if resp is not None:
                chain_focus[c["id"]] = (resp.get("focus") or None)
        else:
            fails = attempt(c, i)
            if fails and not c["asserts"].get("optional"):
                for delay in (3, 6):
                    time.sleep(delay)
                    fails = attempt(c, i)
                    if not fails: break

        # 옵셔널/SKIP 판정 (sentinel 은 모두 하드)
        opt = (bucket == "golden") and c["asserts"].get("optional")
        if not fails:
            npass += 1; by_bucket[bucket]["p"] += 1; tag = "PASS"
        elif opt:
            nskip += 1; by_bucket[bucket]["s"] += 1; tag = "SKIP"
        else:
            nfail += 1; by_bucket[bucket]["f"] += 1; tag = "FAIL"
            hard_fail_ids.append(c["id"])

        dom = domain_label(c)
        if fails:
            print("[%s] %-22s %-12s %s" % (tag, c["id"], dom, "; ".join(fails)))
        else:
            print("[%s] %-22s %-12s" % (tag, c["id"], dom))
        time.sleep(SENTINEL_PACING_S if bucket == "sentinel" else 0.15)

    print("\n-- 정적 보안검사 --")
    # (기존 3종 그대로)
    ...

    # 통합 요약 (3절 참조)
    g, s = by_bucket["golden"], by_bucket["sentinel"]
    print("\n요약 (골든):   PASS %d / FAIL %d / SKIP %d" % (g["p"], g["f"], g["s"]))
    print("요약 (sentinel): PASS %d / FAIL %d" % (s["p"], s["f"]))
    print("종합: PASS %d/%d (%d%%)" % (npass, total, npass*100//total if total else 0))
    # 4절 임계 적용
    ...
```

핵심 변경점 5가지:
1. `is_sentinel()` 분기 함수.
2. `cases = golden + sentinel` 단일 루프 — 정적 검사·종료 흐름 재사용.
3. sentinel 만 `chain_focus` 와 `expect_*` 어서션, 재시도 1회/5s.
4. `domain_label()` 로 출력 라벨 통일 (`예보-해역` ↔ `sntl:angler.2`).
5. 버킷별 카운터 + 종합 카운터 분리 출력.

---

## 3. 통합 후 게이트 출력 예시

```
== Phase 0 통합 게이트: 골든 38 + sentinel 20 = 58 케이스 @ http://127.0.0.1:3001 ==
[PASS] forecast-jeju-n       예보-해역
[PASS] forecast-busan-wind   예보-해역
...
[PASS] ANG-2-01a             sntl:angler.2
[PASS] ANG-2-01b             sntl:angler.2
[FAIL] LEI-5-01              sntl:marine_leisure.5  B: halluc pattern in ans
...

-- 정적 보안검사 --
[PASS] 관리자 도구 미노출 확인
[PASS] 지식그래프 무결성·런타임 연결 확인
[PASS] 데이터 카탈로그 단일출처·드리프트 확인

요약 (골든):    PASS 36 / FAIL 0 / SKIP 2
요약 (sentinel): PASS 18 / FAIL 2

카테고리별 합산:
  골든:
    예보-해역      8/8
    예보-해구      4/4
    조석           5/5
    유속(KHOA)     3/3   (옵셔널 1 SKIP)
    특보           4/4
    보안/거절      6/6
    ...
  sentinel:
    1.기본         1/1
    2.연속         3/4
    3.다중         4/4
    4.정량         4/4
    5.비도메인     0/1
    6.메타         2/2
    7.환각         2/2
    8.변칙         2/2

종합: PASS 54/58 (93%)
게이트 상태: SOFT WARNING (90%~95% 구간)
```

카테고리별 합산은 골든의 `domain` 과 sentinel 의 `category` 를 각자의 분류로 집계(통합 카테고리 강제 매핑 금지 — 의미가 다르므로 혼합 시 해석 오염).

---

## 4. 실패 임계

종합 PASS 율을 임계로 삼되, **정적 검사 3종은 무조건 하드 게이트**(기존 동작 보존).

| 구간 | 라벨 | 종료코드 | 의미 |
|---|---|---|---|
| 종합 PASS ≥ 95% | **OK** | `exit(0)` | 게이트 통과. CI/배포 진행 가능. |
| 90% ≤ 종합 PASS < 95% | **SOFT WARNING** | `exit(0)` + 경고배너 | 회귀 신호. 다음 머지 전 점검 권고. 배포 차단 아님. |
| 종합 PASS < 90% | **HARD FAIL** | `exit(1)` | 게이트 차단. 즉시 분석. |
| 정적 검사 1건 이상 실패 | **HARD FAIL** | `exit(1)` | PASS 율 무관. 보안/그래프/카탈로그 회귀는 무조건 차단. |
| sentinel 환각/CoT 누수 의심 ≥ 3 | **HARD FAIL** | `exit(1)` | 안전성 강한 신호 (PASS 율과 독립). |

판정 의사코드:

```python
pct = npass * 100 // total if total else 0
cot_n = ...  # sentinel 평가 중 COT_RE 매칭 누적
hall_n = ... # sentinel 평가 중 HALLUC_RE 매칭(거절 제외) 누적
hard = bool(static_failures) or pct < 90 or cot_n >= 3 or hall_n >= 3
soft = (not hard) and pct < 95
if hard:
    print("게이트 HARD FAIL"); sys.exit(1)
if soft:
    print("게이트 SOFT WARNING — 회귀 신호, 다음 머지 전 점검")
else:
    print("게이트 OK")
sys.exit(0)
```

근거:
- 골든 38 중 옵셔널이 약 2개 가량(환경의존). 최악 케이스에 옵셔널 모두 SKIP 가정해도 36개 모두 PASS 면 36/56=64% 인데, sentinel 20 중 18 PASS 가산 시 54/58≈93%. 따라서 95% 임계는 실데이터 변동 + sentinel 1~2건 실패 여유를 허용.
- 90% 미만은 5건 이상 회귀 — 단일 빌드 단위로 무시 불가.
- 환각/CoT 누수는 안전성 직결이라 PASS 율과 독립 임계.

---

## 5. 실행 시간 추정

| 구간 | 케이스 | 1건당 평균 | 페이싱 | 재시도 여유 | 소계 |
|---|---|---|---|---|---|
| 골든 | 38 | ~2.5s (도구 호출) | 0.15s | 3~6s × 일부 | **~2분** |
| sentinel | 20 | ~3.5s (Gemini 포함) | 3.0s | 5s × 일부 | **~2분** |
| 정적 검사 3종 | — | — | — | — | **<1s** |
| **합계** | **58** | — | — | — | **~4분** |

추정 근거:
- 골든 평균 2.5s × 38 = 95s + 페이싱 5.7s ≈ 100s. 일부 KHOA 재시도 포함 시 ~120s.
- sentinel 평균 3.5s × 20 = 70s + PACING 3.0s × 20 = 60s ≈ 130s. 5s 재시도 1~2회 가산.
- 직렬 강제(병렬화 금지) — Gemini quota 안전 + 응답 캐시 경합 회피.
- CI 타임아웃 권장: **8분** (여유 2배).

---

## 6. 배포 체크리스트 (코드 패치 단계에서 확인)

- [ ] `phase2b_sentinel.jsonl` 이 항상 같은 디렉터리에 존재(없으면 그레이스풀 경고 후 골든만).
- [ ] `from phase2b_eval_freevar_runner import evaluate, COT_RE, HALLUC_RE, REFUSAL_RE` 가 같은 패키지 경로에서 가능 (`HERE` 동일).
- [ ] 임포트 실패 시 sentinel 케이스 전체 SKIP 폴백 + 경고 1회 출력 (게이트 가용성 우선).
- [ ] 골든 출력 포맷(`[TAG] id domain ...`) 폭은 그대로, sentinel 라벨이 `sntl:jikgun.cat` 으로 12자 안에 들어가도록 `%-12s` 로 패딩 조정.
- [ ] 종료코드 의미 변경 없음 — 기존 자동화(웹훅·CI) 호환.
- [ ] README/CLAUDE.md 에 "P0 = 58케이스 + 정적 3종, 약 4분" 한 줄 갱신은 별도 작업(이 시점 A 의 코드 패치 PR 에서 함께).

---

**참고 파일 경로 (절대경로)**
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_runner.py`
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_golden.jsonl`
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_sentinel.jsonl`
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_eval_freevar_runner.py`
