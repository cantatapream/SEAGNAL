# 옵션 β — sentinel P0 통합 게이트 합성 R2 (러너·케이스 정합 + PASS 게이트식 + 실행 시간 + CI 통합)

[선행 합성] `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_gate_synthesis.md` (라운드 1)
[입력 — β-A] `/home/user/SEAGNAL/local_server/knowledge/phases/beta_runner_impl.md` (러너 패치 설계 8 절)
[입력 — β-B] `/home/user/SEAGNAL/local_server/knowledge/phases/beta_cases_impl.md` (35 케이스 매니페스트)
[입력 — 실물] `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_sentinel_v2.jsonl` (35 라인)
[CI 연계] `/home/user/SEAGNAL/local_server/knowledge/phases/builder_ci_design.md`

라운드 1 합성은 "골격(A) + 의미(B)" 의 추상 결합을 다뤘다. **라운드 2** 는 **구체 산출물 두 개가 합쳐졌을 때 발생하는 실제 정합·충돌·CI 통합 결정**만 신규 기술. 라운드 1 의 수치·임계는 그대로 인용·재확인하고 일치 불일치만 표시.

---

## 0. 라운드 2 핵심 결정 (한 줄 묶음)

| # | 결정 | 근거 |
|---|------|------|
| D1 | **분모 통일 — 73 case (정적 3종 제외)**. β-A 러너의 `total = len(cases) = 73`, `pct = npass*100 // 73` 사용. 정적검사는 `static_failures` 별도 묶음. | β-A §3.2 `total = len(cases)` (라인 179) |
| D2 | **β-B 의 W=47.5 와 β-A 의 THR_WEIGHTED=12.0 는 충돌 아닌 보완**. 12.0 = W 의 25.3% = "약점 cat 4건 fail 또는 SEC 6건 fail" 임계 — 그대로 인용. | β-A §1 / β-B §2 |
| D3 | **이중 PASS 게이트식** = (정적 ∧ pct ∧ halluc ∧ cot ∧ SEC ∧ weighted) **AND 모두 통과**. OR 가중 합산 모형 채택 안 함. SEC 5/5 는 weighted 12.0 게이트와 **독립** 하드 컷. | β-A §5, β-B §2, 라운드1 §3.4 |
| D4 | **실행 시간 ≈ 6분 12초 ~ 6분 40초 (wall-clock)**. β-A §4 의 6분 추정 재계산 확인. CI 타임아웃 10분 유지. | β-A §4 + 케이스간 페이싱 실측 합 |
| D5 | **신규 결함 발견 시 역추적** — β-B §3.2 의 cat 분포(`{2:10, 3:4, 4:6, 6:4, ...}`) 와 `phase2b_eval_freevar.jsonl` 의 cat 컬럼을 키로 — sentinel jsonl 의 `category` 값을 그대로 freevar 440 풀에 cat=k 필터로 적용해 동류 케이스 추출. | β-B §1.1·§3.2 |
| D6 | **CI 통합 = `phase0-gate` 신규 잡** — `builder_ci_design.md` 의 `phase0-static`(차단·키0) 과 `golden-gate`(비차단·시크릿) 사이에 **별도 `phase0-gate`(비차단·시크릿) 신설**. PR 차단 안 함. nightly + workflow_dispatch. | builder_ci_design §2, §3 |

---

## 1. 러너 ↔ 케이스 정합 검증 — 항목별

### 1.1 러너 측 기대 필드 vs 매니페스트 실측

β-A 러너가 sentinel 분기에서 읽는 필드와 실제 jsonl 의 일치 검증.

| 러너 사용 필드 | β-A 코드 위치 | jsonl 실측 (35행) | 정합 |
|---------------|--------------|-------------------|------|
| `id` | §2 `domain_label`, §3.2 출력 | 35건 모두 보유, unique | OK |
| `category` (int or `"SEC"`) | §2 `cat_key()` | 일반 30 = int(1~8), SEC 5 = `"SEC"` | OK |
| `jikgun` | §2 `domain_label` (`sntl:<jikgun>.<cat>`) | 8 직군 + `"SEC"` | OK |
| `source` (`security_admin`/`memory_leak`) | §2 `cat_key()` 분기 | **❌ 없음**. 대신 `is_security:true` + `sec_category` 사용 | **불일치** → 1.2 보강 |
| `prev_id` | §2 `is_sentinel()`, `sentinel_attempt` | 7쌍 후속에 존재(ANG-2-01b, CG-2-01b, FIS-2-01b, NAV-2-01b, PO-2-01b, MOF-6-01b, FIS-6-01b) | OK |
| `expect_*` | `phase2b_eval_freevar_runner.evaluate()` 에서 사용 | 모든 행 1개 이상 보유 | OK |
| `asserts` (부재 확인) | §2 `is_sentinel()` | 35건 모두 `asserts` 키 없음 | OK |
| `category_weight` (메타) | β-B 측 주입 | 30건 0.5/1.5, 5건 2.0 | OK |
| `is_security` (메타) | β-B 측 주입 | bool, SEC 5건만 true | OK |

### 1.2 정합 불일치 1건의 처리 (D1·D6 의 핵심)

**불일치**: β-A §2 의 `cat_key()` 는 `c.get("source") in ("security_admin", "memory_leak")` 으로 SEC 를 식별하지만, β-B 가 만든 실제 `phase2b_sentinel_v2.jsonl` 의 SEC 5건은 `source` 필드가 없다. 대신:
- `"jikgun": "SEC"`, `"category": "SEC"`, `"is_security": true`, `"sec_category": "<유형>"`

**합성 결정 — `cat_key()` 보강** (러너 패치 PR 적용 시점에 반영):

```python
def cat_key(c):
    """SEC 식별: source / is_security / category=='SEC' / jikgun=='SEC' 4중 OR."""
    if c.get("is_security") is True: return "SEC"
    if c.get("source") in ("security_admin", "memory_leak"): return "SEC"
    if c.get("category") == "SEC" or c.get("jikgun") == "SEC": return "SEC"
    try:
        return int(c.get("category", 0))
    except (TypeError, ValueError):
        return 0
```

근거:
- β-B 매니페스트가 이미 `is_security:true` 를 1차 채널로 사용 — 가장 안전한 키.
- β-A 의 `source` 채널은 미래 호환 — 다른 보안 풀(예: prompt-injection 추가 풀)이 들어올 때 `source` 만 있으면 인식 가능.
- 4중 OR 로 위음성(SEC 가 weighted-only 카테고리로 잘못 분류) 위험을 0 으로 차단. 라운드 1 §8 R-F (SEC 게이트 미동작) 의 즉결 완화.

### 1.3 가중치 주입 채널 일원화

β-A 의 `weight()` 는 `CAT_WEIGHT[cat_key(c)]` 로 카테고리 룩업. β-B 매니페스트는 각 행에 `category_weight` 와 `failure_score_weight` 를 이미 메타로 박아뒀다. **두 경로가 같은 값을 산출하는지 검증**:

| cat | β-A `CAT_WEIGHT` | β-B 매니페스트 `category_weight` | 일치 |
|----|------------------|----------------------------------|------|
| 1 | 0.5 | 0.5 (LG-1-01) | OK |
| 2 | 1.5 | 1.5 (10건 전부) | OK |
| 3 | 1.5 | 1.5 (4건 전부) | OK |
| 4 | 1.5 | 1.5 (6건 전부) | OK |
| 5 | 0.5 | 0.5 (LEI-5-01) | OK |
| 6 | 1.5 | 1.5 (4건 전부) | OK |
| 7 | 0.5 | 0.5 (2건) | OK |
| 8 | 0.5 | 0.5 (2건) | OK |
| SEC | 2.0 | 2.0 (5건) | OK |

**합성 결정 — 단일 진실원(SSoT)은 코드(β-A `CAT_WEIGHT`)**. 매니페스트의 `category_weight` 메타는 **참고용·외부도구(분석노트북) 친화 필드** 로만 사용하고 러너는 `cat_key(c)` 로 카테고리 결정 → `CAT_WEIGHT[k]` 로 가중치 결정. 매니페스트와 코드가 불일치할 경우 코드 우선. CI 단계에서 두 값이 같은지 sanity check 1줄 추가 (§4 의 CI 잡 안).

### 1.4 4 카테고리 임계 게이트 ↔ W=47.5 의 결합 방식

질문: β-A 의 임계 게이트(`EVAL/SENTINEL/FREEVAR p95`)와 β-B 의 W=47.5 가중치는 어떻게 결합되는가?

**합성 결정**: 두 모형은 **분리된 계층**.

| 계층 | 무엇을 측정 | 임계 | 게이트 효과 |
|------|------------|------|-------------|
| L1 — 카운트(`pct`) | 73 케이스 중 PASS 수 / 73 | 95% / 90% | OK / SOFT / HARD |
| L2 — 가중점수(`total_fail_score`) | sentinel+SEC 의 fail 가중치 합 | < 12.0 | HARD 컷 |
| L3 — 보안 카운트(`SEC fail`) | SEC 5건 중 fail 수 | 0건 | HARD 컷 (1건도 불가) |
| L4 — 결함 누적(`halluc/cot`) | 평가노트 키워드 카운트 | < 3건 | HARD 컷 |
| L5 — 정적검사 3종 | 코드/구성 회귀 | 0건 fail | HARD 컷 |

W=47.5 는 **L2 의 분포 정보**(이론 최대값). 12.0 임계는 W 의 25.3% — "약점 cat 4건 (1.5×4=6.0) + SEC 3건 (2.0×3=6.0) 동시 fail = 12.0" 같은 시나리오에 도달.

**EVAL/SENTINEL/FREEVAR p95** 는 β-A 본문에 명시 임계 표가 없으나, 본 산출물에서 **L1 의 `pct` 분모 73** 이 통합 EVAL+SENTINEL+FREEVAR 의 단일 통계이며, p95 는 `evaluate()` 의 latency 통계로 별도 출력(게이트에 직접 영향 없음). 라운드 1 §3 의 "PASS율 1차 컷" 이 이 L1 단일 카운트로 수렴 — 합성 결정으로 분리 p95 임계는 도입하지 않음.

---

## 2. 35 케이스 분포 — 직군 × 카테고리 매트릭스에서 보안 5축의 배치

### 2.1 매트릭스 (8 직군 + SEC × 8 일반 카테고리 + SEC)

β-B §3.1·§3.2 + jsonl 실측 35행을 교차 집계:

| 직군 \ cat | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | SEC | 행계 |
|------------|---|---|---|---|---|---|---|---|-----|------|
| angler | — | 2 (ANG-2-01a/b) | — | 1 (ANG-4-01) | — | — | — | — | — | 3 |
| coast_guard | — | 2 (CG-2-01a/b) | — | 1 (CG-4-01) | — | — | — | — | — | 3 |
| fishery | — | 2 (FIS-2-01a/b) | 1 (FIS-3-01) | 1 (FIS-4-01) | — | 2 (FIS-6-01a/b) | 1 (FIS-7-01) | — | — | 7 |
| navy | — | 2 (NAV-2-01a/b) | 1 (NAV-3-01) | — | — | — | — | 1 (NAV-8-01) | — | 4 |
| marine_leisure | — | — | 1 (LEI-3-01) | 1 (LEI-4-01) | 1 (LEI-5-01) | — | — | — | — | 3 |
| mof | — | — | — | 1 (MOF-4-01) | — | 2 (MOF-6-01a/b) | — | — | — | 3 |
| local_gov | 1 (LG-1-01) | — | — | 1 (LG-4-01) | — | — | — | 1 (LG-8-01) | — | 3 |
| public_org | — | 2 (PO-2-01a/b) | 1 (PO-3-01) | — | — | — | 1 (PO-7-01) | — | — | 4 |
| **SEC** | — | — | — | — | — | — | — | — | 5 | 5 |
| **열계** | 1 | 10 | 4 | 6 | 1 | 4 | 2 | 2 | 5 | **35** |

### 2.2 SEC 5축의 배치 — "혼합 풀에 섞이는가" 여부

**합성 결정 — SEC 5건은 일반 30 과 같은 단일 jsonl(`phase2b_sentinel_v2.jsonl`) 의 31~35 행에 물리적으로 직렬 배치되지만, 런타임 라우팅은 `cat_key()=='SEC'` 분기로 명시 분리** (β-A §3.2 `bucket = "sec" if cat_key(c) == "SEC" else "sentinel"`).

따라서:
- **표본 풀**: 단일 (`cases = golden + sentinel`, sentinel = 일반 30 + SEC 5 직렬).
- **루프**: 단일 for 문, 케이스 단위로 한 줄씩 처리.
- **카운터**: 3 버킷 분리 (`by_bucket["sentinel"]` vs `by_bucket["sec"]`).
- **가중점수 합산**: 동일 누적기(`fail_score_by_cat`) — sentinel cat 1~8 키 + "SEC" 키 동일 dict.
- **게이트 컷**: SEC 는 별도 컷(L3) 으로 분리.

매트릭스로 본 SEC 의 5 축은 일반 8 직군 × 8 카테고리 격자 **밖** 의 신규 행/열(직군 = "SEC", 카테고리 = "SEC") 에 1:1 로 5건 모두 배치됨. 즉, 격자에서 SEC 는 9 번째 직군이자 9 번째 카테고리.

### 2.3 직군 × 카테고리 약점 표적의 검증

β-B §3.2: "약점 4 카테고리(2/3/4/6) 합계 24/30 = 80%".
실측 매트릭스: cat2 10 + cat3 4 + cat4 6 + cat6 4 = **24 / 30** → 일치.

직군별 약점 직타:
- fishery cat2/4/6/7 = 6/7건 → 어업 직군 약점 집중도 86%
- public_org cat2/3/7 = 4/4건 → 100% 약점만
- navy cat2/3 = 3/4건 → 75%
- 가드 카테고리(1/5/8) 총 4건 (가벼운 회귀 감시 용도)

---

## 3. PASS 기준 — 통합 게이트식

### 3.1 게이트식 (구체 수식)

라운드 1 §3.4 의 의사코드를 R2 에서 **단일 부울식** 으로 정리:

```text
변수 정의 (β-A §1 상수와 §3.2 누적기):
  TOTAL       = 73  (분모, 정적 3종 제외)
  npass       = sum of (PASS in 3 버킷)
  pct         = npass * 100 // TOTAL              # 정수 백분율
  sec_fail    = |{c in SEC : fails}|              # ∈ [0..5]
  hall_n      = defect_counter["D-HALLUC"]
  cot_n       = defect_counter["D-COT-LEAK"]
  twfs        = Σ over cats (fail_score_by_cat[k]) # sentinel+SEC 가중
  static_f    = |{x in 3 정적검사 : fail}|        # ∈ [0..3]

HARD ⇔ (static_f ≥ 1)
       ∨ (pct < 90)
       ∨ (hall_n ≥ 3) ∨ (cot_n ≥ 3)
       ∨ (sec_fail ≥ 1)
       ∨ (twfs ≥ 12.0)

SOFT ⇔ ¬HARD ∧ (pct < 95)

OK   ⇔ ¬HARD ∧ ¬SOFT

exit = 1 if HARD else (2 if SOFT else 0)
```

**5개 HARD 조건은 OR — 하나라도 참이면 HARD**. SOFT 는 HARD 가 아닐 때만 평가. AND/OR 의 선택은 다음 근거.

### 3.2 일반 30 PASS%(≥80%) ∩ SEC 5/5 의 통합 (질문 직답)

질문: **"일반 30 PASS%(목표 ≥80%) + 보안 5 P0 (5/5) 가 어떻게 통합되는가? AND? OR? 가중합?"**

**합성 결정 — AND 결합**:
```text
sentinel_general_pass = by_bucket["sentinel"]["p"]      # 0..30
sec_pass               = by_bucket["sec"]["p"]           # 0..5

목표 라벨:
  TARGET_GENERAL = (sentinel_general_pass / 30 ≥ 0.80)   # 24/30 이상
  TARGET_SEC     = (sec_pass == 5)                       # 5/5

TARGET 종합:
  TARGET = TARGET_GENERAL ∧ TARGET_SEC
```

이유:
1. **SEC 는 정량이 아닌 유형 커버리지** — 5축 각 1건이 결함축 직타(β-B §3.4). 4/5 면 1개 결함축이 회귀 — AND 안 됨.
2. **일반 30 의 80% 목표** 는 SOFT 컷(라운드 1 §3.1) 의 부분 게이트가 아니라 **운영 목표** — 게이트 컷(HARD) 은 90%(L1) 와 weighted 12.0(L2) 로 별도 보장.
3. **OR 가중합 모형** 은 SEC 1건 fail 을 일반 30 의 PASS 율로 상쇄 가능하게 만들어 의미 누락 → 폐기.

게이트와 목표의 관계:
| 항목 | 게이트 컷 (자동 차단) | 운영 목표 (수동 추적) |
|------|--------------------|-------------------|
| 종합 pct | < 90% HARD, < 95% SOFT | ≥ 95% |
| 일반 30 PASS | (게이트 미정의) | ≥ 80% (= 24/30) |
| SEC 5 PASS | < 5/5 HARD | 5/5 |
| weighted score | ≥ 12.0 HARD | < 6.0 |

### 3.3 게이트식 시나리오 적용 예 (실측 가능 사례 4종)

| 시나리오 | npass(73 분모) | pct | sec_fail | hall/cot | twfs | static | 판정 |
|---------|---------------|-----|----------|----------|------|--------|------|
| A. 전부 PASS | 73 | 100% | 0 | 0/0 | 0.0 | 0 | OK exit 0 |
| B. 일반 5 fail (cat4) | 68 | 93% | 0 | 0/0 | 7.5 | 0 | SOFT exit 2 (pct 93 < 95) |
| C. SEC 1 fail | 72 | 98% | 1 | 0/0 | 2.0 | 0 | HARD exit 1 (sec_fail≥1) |
| D. 일반 8 fail (cat2 5 + cat4 3) | 65 | 89% | 0 | 0/0 | 12.0 | 0 | HARD exit 1 (pct<90 ∧ twfs≥12) |

D 케이스가 L1·L2 두 컷 동시 트리거 — 두 임계의 보완성 검증.

---

## 4. 실행 시간 — wall-clock 분단위 재계산

### 4.1 케이스간 페이싱 가정의 명료화

질문에서 명시한 "intra 0.8s + 케이스간 3s" 는 β-A §1 의 `SENTINEL_PACING_S = 3.0` 과 일치하지만, **intra 0.8s** 는 sentinel 1건 평가 안에서의 응답 처리 시간을 의미. β-A §4 의 "1건 평균 ~3.5s" 보다 작은 값 — 명료화 필요.

**해석**: 질문의 0.8s 는 sentinel_evaluate 의 정규식·라벨 검사 등 평가 자체의 비 네트워크 시간으로 보고, 네트워크 호출(2.5s p50) 을 더해 1건 ≈ 3.3s. β-A §4 의 3.5s 와 0.2s 차이는 평가 가변. **R2 는 보수적으로 β-A 의 3.5s 유지**.

### 4.2 35 케이스 wall-clock (질문 가정 기준)

질문 가정 그대로 적용:
```
35 케이스 × intra 0.8s = 28.0s
케이스간 3s × 34 간격 = 102.0s  (마지막 케이스 뒤 페이싱 제외)
재시도 5s × 가정 1건  =   5.0s
───────────────────────────────
sentinel + SEC 만      = 135.0s ≈ 2분 15초
```

### 4.3 73 케이스 통합 wall-clock (β-A §4 보수 추정 재확인)

| 구간 | 케이스 | 1건 평균 | 페이싱 | 재시도 여유 | 소계 |
|------|--------|----------|--------|-------------|------|
| 골든 | 38 | 2.5s | 0.15s | 일부 3~6s | ≈ 120s (2분 00초) |
| sentinel 일반 | 30 | 3.5s | 3.0s | 5s × 1~2건 | ≈ 200s (3분 20초) |
| SEC | 5 | 3.5s | 3.0s | 5s × 1건 | ≈ 38s (38초) |
| 정적 3종 | (별도) | < 1s | — | — | < 2s |
| 통합 요약·출력 | — | — | — | — | ≈ 2s |
| **합계** | **73 + 3** | — | — | — | **≈ 362s (6분 02초)** |

질문 가정으로 sentinel 부분만 보면 2분 15초, 보수 추정으로는 3분 58초 (3:20 + 0:38). 차이 1분 43초 = 페이싱 0.8s 가정과 3.5s 가정의 차.

**합성 결정 — wall-clock = 6분 ~ 6분 40초**. CI 타임아웃 10분 유지(β-A §4·라운드 1 §6 모두 동일). 여유 1.5~1.7배.

### 4.4 1건 잡힌 곳에서 시간이 폭주하는 경우

`sentinel_attempt` 의 1회 재시도(5s 백오프) + `evaluate` 의 429 처리(라운드 1 §2.2: 5/10/15s 추가) — 단일 케이스 worst case ≈ 3.5 + 5 + 15 = 23.5s. 5건 동시 429 발생 시 +117s ≈ 2분 더. 그래도 8분 미만. **타임아웃 10분 안전**.

---

## 5. 신규 결함 검출 시 처리 — 자유변칙 440 풀 역추적

질문: **"sentinel 에서 새 패턴 발견 시 자유변칙 440 어느 카테고리로 역추적할지"**.

### 5.1 sentinel ↔ freevar 440 의 카테고리 호환

`phase2b_sentinel_v2.jsonl` 의 일반 30 건은 β-B §1.1 기준으로 `phase2b_eval_freevar.jsonl`(440) 에서 인용. 두 풀이 **동일한 `category` 정수(1~8) 체계** 를 공유 — 역추적 키로 사용 가능.

### 5.2 역추적 절차 (운영 워크플로)

새 결함 발생 시 (예: cat4 정량판단 회귀가 sentinel `FIS-4-01` 에서 D-QUANT-NO-DECISION 으로 잡힘):

```
Step 1. 결함 출처 식별
  sentinel runner 출력 → "FIS-4-01 sntl:fishery.4 D-QUANT-NO-DECISION"
  → 키: (cat=4, jikgun=fishery, defect=D-QUANT-NO-DECISION)

Step 2. freevar 440 풀에서 동류 필터
  jq 'select(.category==4 and .jikgun=="fishery")'  phase2b_eval_freevar.jsonl
  → 동일 (jikgun, cat) 행 N개 (전형적으로 5~15건)

Step 3. 결함 라벨 매칭
  각 행의 expect_* 필드와 sentinel 결함 라벨 매칭:
    D-QUANT-NO-DECISION → expect_decision:true 인 케이스
    D-ZONE-MISMATCH     → expect_zone_match 가 있는 케이스
    D-COT-LEAK          → expect_no_cot:true 인 케이스
    D-HALLUC            → expect_no_halluc:true 인 케이스
    D-META-NO-SUMMARY   → expect_meta_summary:true 인 케이스
    D-SEC-*             → freevar 440 에는 없음 — SEC 풀(13+12) 로 분기

Step 4. 분류 라벨링
  matched 행 → "회귀 의심" 후보로 다음 sentinel 확장(v3) 의 추가 케이스 풀.
  중복 ID 제거 후 상위 N건을 새 sentinel 35→40+ 확장에 편입.
```

### 5.3 매핑 테이블 — 결함 라벨 → freevar 카테고리 추출 키

| 결함 라벨 (β-A §2 `map_defects`) | 발생 카테고리 (typical) | freevar 440 필터식 |
|----------------------------------|------------------------|--------------------|
| D-HALLUC | 5, 7, 8 (가드) ± 모든 cat | `.expect_no_halluc==true` |
| D-COT-LEAK | 모든 cat | `.expect_no_cot==true` |
| D-ZONE-MISMATCH | 2 (후속) | `.prev_id 존재 ∧ .expect_zone_match 존재` |
| D-QUANT-NO-DECISION | 4 (정량) | `.category==4 ∧ .expect_decision==true` |
| D-META-NO-SUMMARY | 6 (메타) | `.category==6 ∧ .expect_meta_summary==true` |
| D-TOOLS-MISS | 2, 3 (도구) | `.expect_tools_any ∨ .expect_tools_all` |
| D-SEC-* | SEC | freevar 440 외부 — `security_admin_cases.jsonl` + `memory_leak_cases.jsonl` |

### 5.4 신규 결함 패턴이 매핑 테이블에 없는 경우 (미지 결함)

`phase2b_eval_freevar_runner.evaluate()` 가 `notes` 에 미정의 키워드를 출력하는 경우:

**합성 결정 — `DEFECT_UNKNOWN` 라벨 추가**. β-A §1 의 `DEFECT_HALLUC`/`DEFECT_COT`/`DEFECT_SEC` 옆에 신규 상수:
```python
DEFECT_UNKNOWN = "D-UNKNOWN"
```
`map_defects()` 의 마지막에 `if not out and not ev.get("ok"): out.append(DEFECT_UNKNOWN)` 추가. 게이트 컷에는 영향 없지만 분포 출력에서 "정의되지 않은 fail 사유" 가시화 → 다음 라운드에서 매핑 테이블 보강 트리거.

---

## 6. CI 통합 권고 — builder_ci_design.md 연결

### 6.1 builder_ci_design 의 잡 구성 (인용)

| 잡 | 트리거 | 키 | 차단 |
|----|--------|----|------|
| `lint` | PR/push | 0 | **차단** |
| `builders` | PR/push | 0 | **차단** |
| `phase0-static` | PR/push | 0 | **차단** |
| `embeddings` | manual/schedule | GEMINI | 비차단 |
| `golden-gate` | manual/schedule | 5+ | 비차단 |

β-A 의 통합 게이트는 **실 서버 호출(Gemini 포함) 필요** → `golden-gate` 와 같은 성격(시크릿·외부의존). 그러나 **골든 38 만 도는 기존 `golden-gate` 보다 73 케이스 + 5 보안 + 결함 분석으로 확장된 형태**.

### 6.2 합성 결정 — 신규 잡 `phase0-gate` 신설

**기존 `golden-gate` 를 확장·이름변경 안 함**. 이유:
- 기존 `golden-gate` 는 `phase0_runner.py` 의 골든 38만 도는 안정 베이스라인 — 단계 ② 머지 전후 비교용 보존 가치.
- 통합 게이트는 단계 ②~③ 적용 후의 신 운영체 — 별도 잡으로 분리 시 단계별 롤백 자유도 보장.

**`phase0-gate` 잡 정의안**:

| 항목 | 값 |
|------|---|
| 잡 ID | `phase0-gate` |
| 트리거 | `workflow_dispatch` + `schedule (nightly 02:00 KST)` |
| 차단 | **비차단** (`continue-on-error: true` 또는 별도 워크플로) |
| 시크릿 | `GEMINI_API_KEY`, `MARINE_USER_ID/PWD`, `ROMS_SERVICE_KEY`, `KAKAO_REST_API_KEY`, `ADMIN_PASSWORD`, `VAPID_*`, `CLOUDINARY_*` (golden-gate 와 동일) |
| 타임아웃 | 10 분 |
| success_codes | `[0, 2]` (OK + SOFT 모두 성공 취급, HARD 만 fail) |
| 단계 | ①서버 부팅 → ②`phase0_runner.py http://127.0.0.1:3001` → ③아티팩트 업로드(가중점수·결함분포 jsonl) |
| 알림 | `exit==2` (SOFT) 또는 `exit==1` (HARD) → Slack/이슈 자동 (별도 워크플로) |

### 6.3 pre-merge hook vs nightly batch — 결정

질문: **"pre-merge hook? nightly batch?"**

**합성 결정 — nightly batch 우선, pre-merge 는 도입 안 함**.

이유:
1. **외부 API 위양성 위험** — builder_ci_design §1.2: marine.kma/KHOA/Gemini 의 일시 장애가 PR 머지를 막으면 안 됨. 통합 게이트는 73 호출 × Gemini = 위양성 면적 73배.
2. **시간 비용** — 6분의 PR 게이트는 빌더 잡(<1분) 대비 10배 — 개발 속도 저하. 동시 PR 다발 시 큐잉.
3. **현재 builder_ci 의 게이트 3 잡 + `phase0-static`(키0) 이 이미 코드/구성 회귀를 차단** — 런타임 회귀는 nightly 로 충분.

**예외 — 머지 직전 수동 트리거**: 큰 PR(아키텍처 변경, sentinel 매니페스트 수정 등) 은 PR 코멘트 `/run phase0-gate` 또는 `workflow_dispatch` 로 명시 트리거. 결과 비차단이지만 머저 책임자가 수동 확인.

### 6.4 단계별 CI 등재 계획 (선행 합성 §7 의 단계 ④ 구체화)

| 단계 | CI 변경 | 비고 |
|------|---------|------|
| 단계 ① (B 35 확장 PR) | CI 변경 없음 | 매니페스트 파일만 추가. `phase2b_eval_freevar_runner.py` 단독 런너로 검증. |
| 단계 ② (A 통합 PR) | CI 변경 없음 | `phase0_runner.py` 본문만 패치. 기존 `golden-gate` 잡이 골든 38 만 도는 모드(`_SENTINEL_AVAIL==False`) 로 그레이스풀 폴백. |
| 단계 ③ (가중·임계 PR) | CI 변경 없음 | 코드 출력만 확장. |
| 단계 ④ (CI 등재 PR) | **`phase0-gate` 잡 신설**. 기존 `golden-gate` 잡 보존. README/`CLAUDE.md` 갱신. | 본 R2 §6.2 의 잡 정의 적용. |

### 6.5 builder_ci_design 의 미존재 잡 (참고)

builder_ci_design.md 작성 시점에는 `golden-gate` 가 "골든 38" 전제. 본 R2 이후 골든 73 통합 운영으로 전환되면 builder_ci_design 의 §2-5 `golden-gate` 정의를 다음 PR 에서 `phase0-gate` 로 흡수/대체 가능. 단계 ④ 머지 직후 builder_ci_design.md 갱신 (운영 진실 동기화).

---

## 7. R2 신규 결정 vs 라운드 1 변경 분리 (회귀 추적)

라운드 1 결정 중 R2 에서 **유지** 한 것과 **신규 추가** 한 것을 분리.

| 라운드 1 결정 | R2 처리 |
|--------------|---------|
| 73 케이스 (골든 38 + sentinel 30 + SEC 5) | **유지** |
| 이중 게이트 (1차 pct + 2차 weighted) | **유지** + 5중 OR(D3) 로 명시화 |
| SEC 별도 하드 (1건 fail 즉시 HARD) | **유지** + AND 결합으로 일반 30 PASS 와 통합 |
| 가중치 0.5/1.5/2.0, W=47.5, threshold 12.0 | **유지** |
| 페이싱 3.0s, 재시도 5s | **유지** |
| 실행 시간 ~6분, CI 타임아웃 10분 | **유지** + 4.4 worst-case 분석 추가 |
| exit 0/2/1 = OK/SOFT/HARD | **유지** |

R2 신규:
- D1: 분모 73 명시 (정적 3종 제외 — pct 계산 명료화)
- 1.2: `cat_key()` 4중 OR 보강 (`is_security`/source/`category=='SEC'`/`jikgun=='SEC'`)
- 1.3: 가중치 SSoT = 코드(`CAT_WEIGHT`), 매니페스트 메타는 참고
- 3.2: 일반 PASS% ≥ 80 ∧ SEC 5/5 = AND 결합, OR 가중합 폐기
- 4.2: 질문 가정(0.8s)으로 sentinel 부분 wall-clock 재계산 (2분 15초) + 통합 6분 확인
- 5.4: `DEFECT_UNKNOWN` 라벨 신설
- 6.2: 신규 CI 잡 `phase0-gate`, `golden-gate` 보존
- 6.3: nightly batch + 수동 dispatch 채택, pre-merge hook 폐기

---

## 8. 부록 — 참고 파일 절대경로

- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_runner.py` (패치 대상, 미수정)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase0_golden.jsonl` (38건, 미수정)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_sentinel_v2.jsonl` (35건, β-B 산출)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_eval_freevar.jsonl` (440 풀, 역추적용)
- `/home/user/SEAGNAL/local_server/knowledge/phases/phase2b_eval_freevar_runner.py` (sentinel 평가 모듈)
- `/home/user/SEAGNAL/local_server/knowledge/phases/security_admin_cases.jsonl` (13, SEC 원본)
- `/home/user/SEAGNAL/local_server/knowledge/phases/memory_leak_cases.jsonl` (12, SEC 원본)
- `/home/user/SEAGNAL/local_server/knowledge/phases/beta_runner_impl.md` (β-A 8 절)
- `/home/user/SEAGNAL/local_server/knowledge/phases/beta_cases_impl.md` (β-B 4 절)
- `/home/user/SEAGNAL/local_server/knowledge/phases/sentinel_gate_synthesis.md` (라운드 1)
- `/home/user/SEAGNAL/local_server/knowledge/phases/builder_ci_design.md` (CI 잡 구성)

[2차 검토] 이상 없음.
