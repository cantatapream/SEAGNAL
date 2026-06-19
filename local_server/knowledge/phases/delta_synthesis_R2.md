# 옵션 δ — R2 합성: 러너·로그·알람·롤백 통합 종합본

> 입력: `delta_runner_A_impl.md` (δ-A · ask() metrics 분리 patch + DoD 5항목 게이트) · `delta_ops_B_impl.md` (δ-B · cross_cutting 6곳 + assistant_log v1.1 + 알람 SOP + 롤백 runbook + 5단계 롤아웃) · `p95_gate_synthesis.md` (R1 합성 — SOP·임계·알람·롤백) · `cross_cutting.md` (R2 검수에서 p95 갭 미검증가설 강등 상태 반영).
> 본 문서는 **설계 합성만** — 코드/기존 md 수정 금지. 신규 md 1개. 한국어.
> 작성: 2026-06-04.

---

## 0. 한눈에 (R2 합성 6축)

| 축 | 합의 결정 | 출처 정합 |
|---|---|---|
| 1 | **러너 metrics ↔ assistant_log 필드 매핑**: `pure_ms ≡ pureLatencyMs ≡ net`, `pure_ms + backoff_ms = rawLatencyMs ≡ raw(케이스단위)`, `backoff_ms ≡ backoffMs`. **둘 다 직접 저장**(파생 금지) — 합산 정확도(분위수의 합 ≠ 합의 분위수) 보존. | δ-A §1.2/§2.2 + δ-B §2.1 + R1 §1 |
| 2 | **5단계 롤아웃 시점**: ① 러너 patch(δ-A) → ② 측정 1회(γ 옵션 = 베이스라인 산출) → ③ cross_cutting 갱신(δ-B §1) → ④ 알람·로그 활성화(δ-B §3·§2) → ⑤ CI 게이트화(builder_ci_design.md 연계). 누적 위험은 단계 5에서 최대(PR 차단), 롤백 지점은 각 PR 단위. | δ-B §5 + R1 §7 |
| 3 | **러너 종료코드 ↔ 3계층 알람**: `sys.exit(1)` 은 CI(머지 전) 책임 — 런타임 알람(L1/L2/L3) 과 **시간축 분리**. 단 sentinel 잡 실패는 L3 CRIT **상시 동기화 의무 없음**(별도 SOP). 매핑 규칙은 §3 표. | δ-A §1.4/§2.4 + δ-B §3 + R1 §3 |
| 4 | **env 임계 ↔ 자동강등 3단계**: 러너 env(`EVAL_P95_MS`/`SENTINEL_P95_MS`/`FREEVAR_P95_MS`)와 런타임 강등 env(`WEB_SEARCH_OFF`/`THINKING_BUDGET`/`BRAIN_OFF`)는 **다른 네임스페이스**. 강등은 게이트 임계를 변경하지 않고 **트래픽 경로**만 좁힘. 임계 자체 완화는 §4의 비상 절차에서만. | δ-A §1.1/§2.1 + δ-B §4 §3 |
| 5 | **R2 강등 상태 해소 기준**: `cross_cutting.md` §7.1/§7.3 "백오프 노이즈 미검증가설"의 검증/기각 임계 = **`net p95` 단독**(raw 무관). 분기: net ≤ 5000 → 가설 확정·DoD 달성 선언, net > 5000 → 가설 기각·자체로직 패치 사이클. `raw - net` 갭은 **외부쿼터 진단 보조 지표**만. | cross_cutting §7.1 + δ-A §6 + δ-B §5 단계 2 |
| 6 | **R2 검수 봉합(우선순위)**: R1(`p95_gate_synthesis.md`)과 본 라운드 워커 산출 충돌 시 **워커(δ-A/δ-B) 우선**(구현 상세도 + R2 강등 상태 반영). R1은 통합 SOP 단일 진실원 유지(임계·SOP 골자 변경 없음 — δ가 더 명세적). | R1 §0/§3 + δ-A·δ-B 합치 |

**한 줄 요약(끝부분 §7 재진술)**: 러너는 `(pure_ms, backoff_ms)` 케이스별 적재 → assistant_log v1.1 의 `pureLatencyMs`/`rawLatencyMs`/`backoffMs` **3필드 직접 저장**(파생 금지) → CI 게이트(`sys.exit(1)`)는 머지 전 차단, 런타임 알람(L1/L2/L3)은 머지 후 5분 윈도우로 **시간축 분리** 운영, R2 강등 상태(`cross_cutting §7.1`)는 **net p95 단독**으로 검증/기각.

---

## 1. 러너 metrics ↔ assistant_log 정합 (필드 매핑 + 분위수 합산 함정 회피)

### 1.1 4축 매핑표 (러너 dict / 보고 라벨 / 로그 필드 / 단위)

| 의미 | 러너 (δ-A `metrics` dict) | 보고 라벨 (δ-A stdout · δ-B 대시보드) | assistant_log v1.1 (δ-B §2.1) | 단위 |
|---|---|---|---|---|
| 마지막 성공 시도 단일 latency | `metrics["pure_ms"]` | **`net`** | **`pureLatencyMs`** (직접 저장) | ms (int) |
| 429 백오프 누적 sleep | `metrics["backoff_ms"]` | **`백오프 평균/최대/총`** | **`backoffMs`** (직접 저장) | ms (int) |
| 벽시계 = pure + backoff | (러너는 `pure + backoff_ms` 케이스별 합산) | **`raw`** | **`rawLatencyMs`** (직접 저장) + `latencyMs` 별칭 유지 | ms (int) |
| 시도 횟수 | `metrics["attempts"]` | (보고 안 함) | (옵션) `attempts` | int |
| 실패 종료시 마지막 시도 ms | `metrics["last_attempt_ms"]` | (오류 trace 보조) | (현재 미저장 — 운영 결정 후 추가) | ms (int) |

### 1.2 직접 저장 vs 파생 — 합의

**합의**: assistant_log v1.1 은 `pureLatencyMs`/`rawLatencyMs`/`backoffMs` **3필드 모두 직접 저장**.

**근거(분위수의 합 함정 회피)**:
- 산술적으로는 케이스 단위로 `pureLatencyMs = rawLatencyMs - backoffMs` 가 성립 → 두 필드만 저장하고 하나는 파생해도 무방해 보임.
- 그러나 **집계(분위수 산출) 단계**에서 파생 방식은 위험: 일부 파이프라인이 raw·backoff 의 분위수를 따로 산출한 뒤 `net_p95 = raw_p95 - backoff_p95` 로 합성하면 **분위수의 합 ≠ 합의 분위수** 부등식에 빠짐.
- 직접 저장 시: 집계 코드가 `pureLatencyMs` 만 가져와 `percentile(values, 0.95)` 직접 산출 → 부정확성 원천 차단.
- 디스크 비용: `int` 3필드 추가 = 레코드당 ~24B 증가. NDJSON 일일 ~10MB(현 인메모리 300건 × 영속화 가정) 기준 무시 가능.

**δ-A 측 정합**: §1.3/§2.3 main() 패치에서 `latencies_net.append(pure)` + `latencies_raw.append(pure + bo)` **양쪽 모두 케이스 단위로 리스트 적재** → 분위수 직접 산출. 러너 단에서 같은 원칙을 이미 반영.

### 1.3 R1 §1 의 결정과의 정합

R1 `p95_gate_synthesis.md` §1 은 `assistant_log` 에 `backoffMs` 1필드만 신설하고 `net = latencyMs - backoffMs` 파생을 허용했다(스키마 diff 예시도 2필드만).
**R2 합의**: δ-B §2.1 의 3필드 분리 방안을 채택 — R1 의 2필드 안은 케이스 단위 파생만 가능하고 집계 단계 함정을 막지 못함. **워커(δ-B) 우선** 원칙 (§0 축6).

### 1.4 하위 호환 (v1 → v1.1)

| 구분 | `latencyMs` | `rawLatencyMs` | `pureLatencyMs` | `backoffMs` | 처리 |
|---|---|---|---|---|---|
| 구 v1 레코드 | 존재(=raw 또는 의미 불명) | 없음 | 없음 | 없음 | `latencyMs` 를 raw 로 간주, `pureLatencyMs` 미상 → 보고 시 "backoff 미계측" 라벨. net 분위수 산출에서 **제외**(누락 표기). |
| 신규 v1.1 레코드 | (선택, raw 별칭) | 필수 | 필수 | 필수(0 포함) | 집계에서 `pureLatencyMs` 직접 사용. |

`schemaVersion=2` 가 분기점 (δ-B §2.4).

---

## 2. 5단계 롤아웃 일정 — 누적 위험·롤백 지점·γ 옵션 측정

### 2.1 5단계 시퀀스 + 누적 위험

| 단계 | 작업 (대표 산출) | PR 단위 | 누적 위험 (위↓후↑) | 롤백 지점 |
|---|---|---|---|---|
| **① 러너 patch(δ-A)** | `phase2b_eval_runner.py` + `phase2b_eval_freevar_runner.py` `ask()` 시그니처 변경 + main net/raw 분리 + DoD 5항목 게이트 + env 5종 신설 | PR1 | 낮음 — 러너만 변경, 서버·CI 무영향. 기존 stdout 라벨 변경(`SLO p50/p95` → `net/raw`)이 외부 파서 의존이 있다면 깨질 수 있으나 의존 없음(현재 사람 read 전용). | `git revert <PR1>` 로 즉시 원복. |
| **② 측정 1회(γ 옵션 — 베이스라인 산출)** | 자유변칙 v4 1회 + 평가셋 v4 1회 실행 → net p95 산출. 결과를 stdout/로그로 보존(문서 미반영). | (코드 변경 없음) | 없음 — 측정만. 단 측정 결과가 단계 ③ 의 임계 인 박는 데 사용되므로 **측정 신뢰도가 다음 단계의 위험원**. n=1 의존이면 σ 미상. | 측정 자체는 롤백 불요. 신뢰도 낮으면 단계 ③ 보류 + 추가 라운드. |
| **③ cross_cutting 갱신(δ-B §1)** | `cross_cutting.md` 6곳 patch — §0 요약표·§2(b)(c)(e)·§7.1·§7.3 DoD 표·§8 변경이력. | PR2 | 중 — 문서 단일 진실원이 바뀜. R2 강등 상태 해소(§7.1) 가 측정 결과에 의존 → 측정 부정확 시 임계 락 실수. | `git revert <PR2>` — 문서만 변경이므로 안전. |
| **④ 알람·로그 활성화(δ-B §3 §2 §4 부분)** | (a) `assistant_log` v1.1 코드 적용(gemini_client.js backoff 누적 + assistant.js 핸들러 propagate) (b) `/api/admin/ai` 대시보드 카드(L1) (c) `logs/assistant/alerts.ndjson` 큐(L2) (d) L3 webhook 스펙 동결(발송은 운영 결정 후) (e) env 강등 플래그 5종 코드화(첫 1주 수동 트리거) (f) `p95_gate_alarm_policy.md` + `p95_gate_rollback_runbook.md` 신규 md 생성 | PR3~PR5 (a~b/c~d/e~f 분리) | 중상 — 코드 변경 다수. assistant.js 핸들러 + gemini_client.js 동시 수정. 백오프 누적 변수 누락 시 `backoffMs=0` 만 기록 → net == raw 동일값 다수 → 통계 무의미. **계측 검증 필수**(분리 PR 권장). | PR 단위 revert. 알람 false-positive 시 임계 env 임시 상향. |
| **⑤ CI 게이트화(builder_ci_design.md 연계)** | `.github/workflows/ci.yml` `sentinel-gate`(PR 차단, required check) + `freevar-gate-nightly`(스케줄, 비차단). 첫 1주 `continue-on-error: true`. 브랜치 보호 규칙 등록. | PR6 (CI) + PR7 (브랜치 보호 — 사장님 승인) | 최고 — PR 차단 영향. 위양성 시 머지 정체. 외부 API 일시장애가 sentinel-gate 위반으로 직결되면 안 됨 → `MARINE_DISABLE=1` + SKIP 라벨 SOP 가 단계 ④ 에서 정착돼야 함. | `continue-on-error: true` 유지(soft) 또는 required check 해제. revert 는 거의 불필요. |

### 2.2 γ 옵션 (단계 ②) 측정 시점 정합

- δ-A §5 "후속 (시점 B)" 와 δ-B §5 단계 2(측정) 가 **동일 측정 라운드**를 가리킴.
- 측정 1회 = `phase2b_eval_freevar_runner.py` (≈37~39분, 자유변칙 440케이스) + `phase2b_eval_runner.py` (≈5~7분, 평가셋 10×3) 직렬 실행.
- **분기 기준(중요)**: 단계 ② 의 `net p95` 값이 단계 ③ §1.5(`cross_cutting §7.1` 결론) 와 §1.6(`cross_cutting §7.3` DoD 행) 의 [δ-A 측정 후] 자리에 들어감. **net 단독**으로 분기 (§5 합의).
- 단계 ③ 가 단계 ② 측정 없이 진행되면 임계 락 위험 → **순서 위반 금지**.

### 2.3 단계 간 의존성 그래프

```
PR1 (δ-A 러너)
    │
    ▼
측정 (단계 ②, 코드 변경 없음)
    │
    ├──────────────────────┐
    ▼                      ▼
PR2 (cross_cutting)    PR3 (assistant_log v1.1 코드)
    │                      │
    │                      ▼
    │                  PR4 (대시보드 + L2 큐)
    │                      │
    │                      ▼
    │                  PR5 (env 강등 코드화 + 알람·롤백 md)
    │                      │
    └──────────┬───────────┘
               ▼
            PR6 (CI 워크플로) — continue-on-error
               │
               ▼
            PR7 (브랜치 보호 required check — 사장님 승인)
```

PR2 와 PR3~PR5 는 병렬 가능(문서·코드 분리). PR6 는 PR2~PR5 완료 후. PR7 는 첫 1주 안정화 후.

---

## 3. 3계층 알람 ↔ 러너 종료코드 매핑

### 3.1 책임 경계 (시간축 분리)

| 영역 | 도구 | 종료/알람 방식 | 사용 시점 |
|---|---|---|---|
| **CI(머지 전)** | δ-A 러너 `sys.exit(1)` | exit 코드 → GitHub Actions 잡 fail → PR status check 빨강 → 머지 차단 | sentinel-gate(PR push) · freevar-nightly(스케줄) |
| **런타임(머지 후)** | δ-B 3계층(L1 배지 / L2 NDJSON / L3 webhook) | 5분 윈도우 통계 → INFO/WARN/CRIT 등급 산출 | `/api/assistant/ask` 실 트래픽 |

**핵심 합의**: **러너 exit 1 은 L1/L2/L3 으로 자동 라우팅되지 않는다** — 둘은 독립 경로. 단 운영 가시성을 위해 sentinel-gate 잡 결과는 별도 GitHub Actions 알림(이메일·Slack)으로 받되 **L3 webhook 페이로드 스펙(`alarm_policy §4`)은 재사용하지 않음**(metric 축이 다름: 게이트는 boolean, 런타임은 분위수 값).

### 3.2 러너 exit 코드 → 등급 매핑 (참고용 — CI 잡 알림에 사용)

δ-A 의 exit 코드는 단일(0/1)이지만, 위반 사유는 다중 — CI 잡 알림에서 "WARN vs CRIT" 라벨링에 다음 표를 참고.

| 러너 종류 | 위반 항목 (δ-A §1.4/§2.4) | exit | CI 알림 등급 | L3 webhook 발송? |
|---|---|---|---|---|
| 평가셋 (`phase2b_eval_runner.py`) | FAIL 다수결 1건 이상 | 1 | **CRIT** (정확성 회귀) | 발송 (운영 정책 결정 후) |
| 평가셋 | `net p95 > EVAL_P95_MS(3000)` | 1 | **CRIT** (성능 회귀) | 발송 |
| 평가셋 | `raw p95 > p95×1.5(=4500)` 만 위반 | 0 (stdout WARN만) | **WARN** (외부쿼터) | 미발송 |
| sentinel (`freevar 러너 + SENTINEL_P95_MS=4000`) | FAIL 또는 net p95>4000 | 1 | **CRIT** (PR 차단) | 발송 |
| sentinel | CoT 누수 ≥1 또는 환각 ≥1 | 1 | **CRIT** (보안 불변식 — Hard block, cross_cutting §6) | **즉시 발송**, 자동강등 SOP 무관 |
| freevar (`FREEVAR_P95_MS=5000`) | DoD 5항목 중 1개라도 실패 | 1 | **WARN** (nightly, PR 비차단) | 미발송. dashboard 알림만. 3일 연속 시 `freevar-blocked` 라벨 + L3 발송 |
| 모두 | exit 0 + raw p95 > net×1.5 | 0 | **INFO** (참고) | 미발송 |

### 3.3 분기 규칙 (CI 잡 알림 → L3 발송 여부)

```python
# pseudo (CI step "post-result")
if exit_code == 1:
    if "CoT 누수" in stdout or "환각" in stdout:
        level = "CRIT_SECURITY"  # Hard block — cross_cutting §6 우선
    elif "net p95" in violations:
        level = "CRIT_PERF"
    elif "FAIL" in violations:
        level = "CRIT_REGRESSION"
    else:
        level = "WARN"
    notify(level, repo, sha, stdout_tail)
elif "raw p95" in stdout and "WARN" in stdout:
    level = "INFO"
    notify_dashboard(level, ...)
```

런타임 5분 윈도우 알람(δ-B §3 §2)은 **별도 모니터링 스레드**가 `assistant_log` 를 읽어 산출 — CI 잡과 무관.

---

## 4. env 자동강등 ↔ 러너 임계 — 네임스페이스 분리

### 4.1 두 env 그룹의 역할 분리

| 그룹 | env 변수 | 효과 영역 | 변경 주체 | 변경 시점 |
|---|---|---|---|---|
| **러너 임계 (δ-A)** | `EVAL_P95_MS`(3000) · `SENTINEL_P95_MS`(4000) · `FREEVAR_P95_MS`(5000) · `RAW_GATE_RATIO`(1.5) · `FREEVAR_DOD_*`(4종) | 러너 stdout 게이트 판정 (exit 0/1) | CI yml 또는 nightly 잡 정의 | 평가 실행 시점 (변경 빈도 낮음 — 임계 락) |
| **런타임 강등 (δ-B §4 §3)** | `WEB_SEARCH_OFF`(1) · `THINKING_BUDGET`(0) · `BRAIN_OFF`(1) · `SYNTH_TEMP_FLOOR`(0.0) · `EXPOSE_TOKEN_USAGE`(1) · `MARINE_DISABLE`(1) | `/api/assistant/ask` 핸들러 동작 경로 (트래픽 좁힘) | 운영자 수동(첫 1주) → CRIT 3분 자동(안정화 후) | CRIT 발생 5분 윈도우 (변경 빈도 가변) |

### 4.2 합의 — 강등은 임계를 변경하지 않는다

- **자동 강등 ① WEB_SEARCH_OFF**: gemini-2.5-flash web_search 차단 → synth만 → 외부 지연 감소 → net p95 자연 하락. **임계(5000ms) 불변**.
- **자동 강등 ② THINKING_BUDGET=0**: thinking 토큰 차단 → CoT 누수 0 유지 + 응답 시간 감소. **임계 불변**.
- **자동 강등 ③ BRAIN_OFF**: runBrain 무효화 → 결정론 폴백만 → 외부 의존 0 → net p95 최저. **임계 불변** (단 PASS 비율 일시 하락 가능).

**금지**: CRIT 알람 회피 목적으로 `FREEVAR_P95_MS=7000` 등 **임계 자체 완화는 금지**(허수 게이트화). 단 다음 비상 절차에서만 임계 임시 변경 허용:

### 4.3 비상 절차 — 임계 임시 변경 (예외)

| 조건 | 임시 임계 변경 | 절차 |
|---|---|---|
| 외부 API(Gemini) 글로벌 장애 — 24h 이상 | `RAW_GATE_RATIO=2.0` (raw WARN 임계 완화) | 운영 승인 + 회복 후 즉시 원복 + 변경이력 기록 |
| sentinel 케이스 자체 결함 발견 — 단일 케이스 | sentinel 케이스 SKIP 라벨 부여 (임계 불변) | PR + 사후 검토 |
| 자유변칙 데이터셋 v5 도입 — 분포 변화 | `FREEVAR_P95_MS` 재측정 후 갱신 | 베이스라인 측정 라운드 1회 + cross_cutting §2(b) 갱신 |

**자동 강등 발생 시에도 러너 env 임계는 불변** — 다음 sentinel 잡 실행에서 같은 임계로 재판정 → 회귀 확인.

### 4.4 강등 단계 ↔ webhook violators_top3 의 진단 활용

δ-B §4 (rollback runbook) §2 자동강등 시퀀스에서 각 단계 후 5분 관찰. 진단 보조:
- 강등 ① 효과 큼 → `web_search` 경로 회귀 확신 → revert 후보 좁힘.
- 강등 ② 효과 큼 → thinking 토큰 폭증 → 모델 파라미터 회귀.
- 강등 ③ 까지 가야 해소 → 결정론 폴백 외 모든 경로 의심 → bisect 필수.

이 진단 결과는 **러너 임계 변경 근거가 아니라 revert 대상 식별 근거**. (§3.3 §3 매뉴얼 revert 단계 1 "triage" 입력)

---

## 5. cross_cutting §7.1 강등 상태 해소 — 검증/기각 합의

### 5.1 R2 강등 상태 (현 cross_cutting.md §7.1·§7.3 발췌)

> "백오프 노이즈" 주장은 아직 미검증 가설로, 초과 갭을 해소된 것으로 간주하지 않는다.
> p95 ≤5000ms — 자유변칙 v2 6712ms — **+1712ms 초과** · 백오프-제외 집계+v4 재측정 필요.

### 5.2 해소 기준 — net p95 단독

**합의**: 단계 ② 측정에서 산출된 **`net p95` 단독**으로 검증/기각.

| 측정 결과 (자유변칙 v4 n=1) | 가설 판정 | cross_cutting §7.1 패치 결과 | DoD 항목 (§7.3) |
|---|---|---|---|
| `net p95 ≤ 5000ms` | **백오프 노이즈 가설 확정** | "raw 6712ms 는 백오프 누적으로 인한 노이즈였음. net 기준 SLO 달성." | ✅ p95 항목 충족 (DoD 5/5 중 1개 추가 충족) |
| `5000 < net p95 ≤ 6000ms` | 부분 기각 | "자체 로직 회귀 일부 존재. raw 와 net 차이는 외부쿼터 영향 일부 존재." | ❌ 자체로직 패치 사이클 진입 (임베딩·합성비용 절감) |
| `net p95 > 6000ms` | **완전 기각** | "백오프 무관, 자체 로직 회귀. raw 6712ms 는 거의 net." | ❌ Phase 2b DoD 추가 패치 사이클 + 단계 ③ cross_cutting §7.1 결론을 "자체 로직 회귀"로 갱신 |

### 5.3 raw - net 갭은 보조 지표만

| `raw p95 - net p95` 갭 | 해석 | 운영 액션 |
|---|---|---|
| < 500ms | 백오프 거의 없음 (Gemini quota 여유) | 정상 |
| 500~2000ms | 일부 429 발생 — 외부쿼터 압박 | raw WARN 조건 충족 시 신선도축(cross_cutting §5) 라우팅 |
| > 2000ms | 다수 429 — 외부쿼터 한도 초과 가능성 | 운영팀에 Gemini 쿼터 상향 또는 web_search 사용 빈도 절감 검토 요청 |

**갭은 검증/기각 기준이 아니다** — 단계 ② 측정에서 raw 가 6712ms 라도 net 이 4500ms 이면 가설 확정. 갭은 외부쿼터 모니터링 보조.

### 5.4 측정 신뢰도 — n=1 의 한계

- 단계 ② 자유변칙 1회는 n=1. p95 의 분산이 큼(특히 백오프 발생 시).
- 첫 측정에서 `net p95 ∈ [4800, 5200]` 경계권이면 **2회 추가 측정**(총 3회) 후 중위수로 판정 권장.
- 측정 신뢰도가 낮으면 단계 ③ 갱신 보류 — 임계 락 위험.

### 5.5 §7.3 DoD 표 갱신 양식 (단계 ③ 시 입력)

```diff
- | p95 ≤5000ms | 자유변칙 v2 6712ms(평가셋 4.7k) | **+1712ms 초과** · 백오프-제외 집계+v4 재측정 필요 | 2.비용/지연 |
+ | net p95 ≤5000ms | raw [측정값]ms / net [측정값]ms | [✅ 충족 / ❌ -[gap]ms 미달] · CI sentinel-gate(≤4000) + freevar-nightly(≤5000) 게이트화 완료 + 런타임 3계층 알람·자동강등·revert SOP 정책화 완료(p95_gate_synthesis · delta_synthesis_R2). | 2.비용/지연 |
```

---

## 6. R2 검수 봉합 — R1(p95_gate_synthesis) vs δ-A/δ-B 워커 산출

### 6.1 변경 없음 (R1 그대로 유지)

| R1 §0 결정 | 본 라운드 워커 정합 | 봉합 |
|---|---|---|
| 임계: 평가셋 3000 · sentinel 4000 · freevar 5000 · raw WARN ×1.5 | δ-A §1.1/§2.1 env 5종 동일 채택 | 변경 없음 |
| 통합 SOP: 시간축 (CI 머지 전 + 런타임 머지 후) | δ-B §3 §4 + 본 R2 §3.1 동일 | 변경 없음 |
| 5단계 롤아웃 | δ-B §5 동일, 본 R2 §2 정련 | 변경 없음 (PR 분리 권고 추가) |
| 명명 통일 (pure_ms/backoff_ms/net/raw) | δ-A 전반 + δ-B §2.1 동일 | 변경 없음 |

### 6.2 변경 있음 (워커 우선)

| 항목 | R1 입장 | δ 워커 입장 | 본 R2 합의 |
|---|---|---|---|
| **assistant_log 신규 필드 수** | `backoffMs` 1필드 (`net = latencyMs - backoffMs` 파생) | `rawLatencyMs` + `pureLatencyMs` + `backoffMs` 3필드 (직접 저장) | **δ-B 우선** — 집계 함정 차단 (§1.2 근거). R1 §1 diff 예시는 참고에서 제외, δ-B §2.1 채택. |
| **러너 패치 위치 명세도** | A design 의사코드 수준 | δ-A §1·§2 patch diff(라인 번호 포함) | **δ-A 우선** — 구현 PR 직접 사용. R1 §4.1 코드 의사코드는 δ-A 의 부분집합. |
| **알람·롤백 SOP 위치** | R1 §3 통합 SOP (한 문서 내) | δ-B §3·§4 골자 + 별도 md 2개 신설 예정(`p95_gate_alarm_policy.md`·`p95_gate_rollback_runbook.md`) | **δ-B 우선** — 운영 SOP 는 독립 문서가 검색·참조 용이. R1 §3 통합 그림은 단일 진실원으로 유지(상호 참조). |
| **자동 강등 자동화 시점** | R1 §7 단계 4: "첫 1주 수동 트리거" | δ-B §5 단계 4 + §4 §6: 동일 + "안정화 후 자동화" | **일치** — 차이 없음. |

### 6.3 변경 없음 (양쪽 합의 — R2 강등 상태 보존)

| 항목 | 상태 |
|---|---|
| cross_cutting §7.1 "백오프 노이즈 미검증가설" 강등 | R1 §2 "불일치 2건" + δ-B §1.5 + 본 R2 §5 모두 보존. 단계 ② 측정 결과로만 해소 가능. |
| `net p95 단독` 판정 기준 | 본 R2 §5.2 에서 명시화 (R1·δ 양쪽 함의 일치). |

### 6.4 봉합 규칙 — 미래 충돌 시

1. R1(`p95_gate_synthesis.md`)은 **통합 SOP 단일 진실원** — 임계·시간축 SOP·5단계 롤아웃의 골자 변경 시 R1 부터 갱신.
2. δ-A/δ-B 워커 산출은 **구현 명세** — 코드/스키마/문서 patch 의 라인 단위 진실원.
3. 본 R2(`delta_synthesis_R2.md`)는 **운영 합의 메모** — 위 둘 사이의 충돌·정합·우선순위 메모.
4. cross_cutting.md 갱신 시: R1 + δ-B §1 + 본 R2 §5 셋의 합치 결과로 갱신(단계 ③ 시).

---

## 7. 자체 검토 + 한 줄 요약

### 7.1 자체 검토 (제약 준수 확인)

- ✅ 기존 산출물·코드 수정 없음 — δ-A/δ-B/R1/cross_cutting 모두 인용·참조만.
- ✅ 신규 md 1개 (`delta_synthesis_R2.md`).
- ✅ 한국어.
- ✅ 6개 작업(러너↔로그 정합·5단계 일정·알람↔종료코드·env 자동강등·R2 강등 해소·R1 봉합) 모두 다룸.
- ✅ R2 강등 상태(cross_cutting §7.1) 보존 — "백오프 노이즈"를 net p95 단독으로 검증/기각하도록 합의 명시.
- ✅ 분위수 합산 함정 회피(직접 저장 3필드) — δ-A 의 케이스 단위 적재 + δ-B 의 3필드 분리 저장 = 끝-to-끝 일관.
- ✅ CI vs 런타임 시간축 분리 — exit 코드와 L1/L2/L3 알람을 독립 경로로 명문화, sentinel CoT/환각만 보안 예외(Hard block).
- ✅ env 네임스페이스 분리 — 강등 env 는 임계를 건드리지 않음, 임계 임시 변경은 비상 절차로만.

### 7.2 한 줄 요약 (핵심 정합 결정)

러너 `(pure_ms, backoff_ms)` 케이스별 적재 → assistant_log v1.1 `pureLatencyMs`/`rawLatencyMs`/`backoffMs` **3필드 직접 저장**(분위수 합산 함정 회피) → CI `sys.exit(1)`(머지 전 차단)과 런타임 L1/L2/L3(5분 윈도우)은 **시간축 분리**, 런타임 env 강등은 트래픽 경로만 좁히고 **러너 임계는 불변** → cross_cutting §7.1 "백오프 노이즈" 미검증가설은 단계 ② 측정의 **net p95 단독**으로 검증/기각하며 R1 vs 워커 충돌은 **δ-A/δ-B 우선**(R1 통합 SOP 골자는 유지).
