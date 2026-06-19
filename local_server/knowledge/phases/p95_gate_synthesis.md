# p95 게이트 통합 운영 문서 (A + B 종합)

> 입력: `p95_gate_A_design.md` (러너/게이트 측정 설계) + `p95_gate_B_ops_policy.md` (운영 SLO·알람·롤백).
> 본 문서는 **측정(A) → 보고(B) → 알람·롤백·SLO 명문화** 한 흐름의 단일 운영 문서.
> 작성: 2026-06-03 · 제약: A/B md 및 코드 미수정(설계만). 기존 md 갱신은 §5 의사코드로만 제시.

---

## 0. 한눈에 (통합 요약)

| # | 단계 | A(측정) | B(운영) | 통합 결론 |
|---|------|---------|---------|----------|
| 1 | 단위 정의 | `pure_ms` / `backoff_ms` (러너 내부) | `net` / `raw` (보고·SLO) | **`pure_ms ≡ net`, `pure_ms + backoff_ms ≡ raw`** (§1 명명 통일표) |
| 2 | 임계 | 평가셋 3000 · sentinel 4000 · freevar 5000 | 핵심 SLO p95 5000 + intent×engine 변형(web_search 7000) | freevar 임계 = 핵심 SLO. **충돌 없음**, B의 변형표는 freevar 5000을 부분집합으로 포함(§2 충돌·정합 매트릭스) |
| 3 | 위반 처리 | PR block(sentinel) / warning(코멘트) / nightly dashboard | INFO/WARN/CRIT 3계층 + 자동강등 → revert → 회귀가드 | **단일 SOP**: CI 게이트 = 머지 차단(A), 런타임 = 알람·강등·revert(B) (§3 통합 SOP) |
| 4 | 보고 | `pure p95` + 참고 `wall-clock = pure + backoff` | `raw / net / 차이` 표 + 5분/24h 윈도우 | 러너 출력 = B의 표 양식 채택, **러너는 `pure_ms`/`backoff_ms` 필드, 보고 라벨만 `net`/`raw`** (§4 보고 포맷) |
| 5 | cross_cutting 패치 | §7.3 DoD p95 행 갱신 (베이스라인) | §0/§2(b)/§2(c)/§2(e)/§7.1/§7.3 다섯 곳 | 6곳 통합 패치 (§5 의사코드) |
| 6 | assistant_log 연계 | (직접 연계 없음 — 러너 한정) | `latencyMs`/`tokenUsage`/`error` 일·주 리포트 | **스키마 v1.1: `backoffMs` 신규 필드** 필수 (§6 연계) |
| 7 | 적용 순서 | 러너 패치 → 측정 → CI 게이트 | env 플래그 → 알람 → 롤백 SOP | **5단계 롤아웃** (§7) |

---

## 1. 변수명·단위 통일 (A·B 정합 점검)

A 는 러너 내부 변수, B 는 운영 보고 라벨로 다른 이름을 쓰지만 **동일 양**이다.
혼선 방지를 위해 **러너↔보고↔로그 3축의 정식 매핑표**를 고정한다.

| 의미 | A (러너 내부 dict) | B (보고/대시보드 라벨) | assistant_log (제안 v1.1) | 단위 |
|------|--------------------|--------------------|------------------------|------|
| 마지막 성공 시도 단일 latency | `metrics["pure_ms"]` | **`net`** | `latencyMs - backoffMs` (파생) | ms (int) |
| 429 백오프 누적 sleep | `metrics["backoff_ms"]` | **백오프(차이)** | **`backoffMs`** (신규 필드) | ms (int) |
| 벽시계(사용자 체감) = pure + backoff | (러너 보고만, 별도 누적 없음) | **`raw`** | **`latencyMs`** (기존, 의미 명확화) | ms (int) |
| 시도 횟수 | `metrics["attempts"]` | (보고 안 함) | (옵션) `attempts` | int |

> **결정**: 러너 코드는 `pure_ms`/`backoff_ms` 유지(A의 명명 그대로). 단 **stdout 보고와 대시보드 라벨은 `net`/`raw`** 로 표기(B). 러너 헤더 한 줄에 "net = pure_ms, raw = pure_ms + backoff_ms" 범례 출력으로 둘을 묶는다.
> **불일치 해소**: A는 `wall-clock = pure_p95 + backoff_p95` 로 합성된 값을 "참고"로 둠. B의 `raw p95` 는 케이스별 합산 후 분위수다. **케이스별 합산 후 분위수(B)가 정확**(분위수의 합 ≠ 합의 분위수). → 러너는 케이스별로 `raw_ms = pure_ms + backoff_ms` 를 따로 적재해 raw p95 산출(아래 §4.1 코드 의사코드 참조).

`assistant_log_schema.md §2.1` 스키마 확장 제안(별도 PR, 본 문서는 의사코드만):

```diff
  "latencyMs": { "type": ["integer", "null"], "minimum": 0,
-                 "description": "요청 수신→응답 직전 경과(ms)." },
+                 "description": "요청 수신→응답 직전 경과(ms) = 벽시계(raw). net 산출은 backoffMs를 빼서 파생." },
+ "backoffMs":  { "type": ["integer", "null"], "minimum": 0,
+                 "description": "429 등 백오프로 인한 누적 sleep(ms). raw - backoffMs = net." },
```

---

## 2. 임계 일치/충돌 매트릭스

A는 측정 대상(러너) 축, B는 intent×engine(런타임) 축으로 임계를 정의 → **축이 다르므로 직접 충돌은 없음**. 단 다음 정합 점검 필요.

| 축 (A) | 임계 (A) | 대응 B 카테고리 | 임계 (B) | 정합 판정 |
|--------|---------|----------------|---------|----------|
| 평가셋 v4 (eval 10×N) | ≤ 3000 | `marine_weather` synth · `warning` 등 결정/단순 합성 | 2500~3500 (p95) | **정합** — 평가셋은 결정+간단 synth 위주 |
| sentinel 20케이스 | ≤ 4000 | `both`(=marine+weather 합성) · `brain` (lite, 도구 1~2회) | 3500~5500 | **부분 정합** — sentinel 임계 4000이 brain 임계 5500보다 보수. sentinel은 외부의존 SKIP 후의 내부 회귀용이므로 OK |
| 자유변칙 440 (freevar) | ≤ 5000 | `*` × `*` 자유변칙 평가 라운드 (DoD 게이트) | ≤ 5000 (불변) | **완전 일치** — DoD §7.3 그대로 |
| (A에 없음) | — | `brain` × `web_search` (gemini-2.5-flash 그라운딩) | ≤ 7000 | **B 신규** — A의 freevar 평가에 web_search 케이스가 포함된다면 B의 가중치 0.5 분리 카운트 규칙 적용. 미포함이면 무관 |

**불일치 1건(잠재)**: B §1.2 표의 `brain`/`gemini-2.5-flash-lite` p95 **5500ms** 가 A의 sentinel 임계 **4000ms** 와 sentinel 케이스 중 brain 경로가 있을 때 충돌처럼 보임. → **해소**: sentinel은 "결정론 직타 + 외부의존 SKIP" 회귀용으로 brain plan+synth 2회는 적게 포함되며, 어떤 sentinel 케이스가 brain 경로면 **sentinel 임계(4000)가 우선**(더 엄격). 런타임 SLO(5500)는 카테고리 일반화용이고, sentinel은 회귀 직타용이므로 더 강한 임계가 적용되는 것이 의도.

**불일치 2건(실측 베이스라인 불일치)**:
- A §1.1: "현 `ms` 는 사실상 마지막 성공 attempt 의 pure latency" 라고 추정 — 즉 backoff 노이즈가 측정값에 미포함이라는 가설.
- B §4.1 예시: 자유변칙 v4 `raw p95 = 4820 / net p95 = 4820` (동일) 의 한편, v3 가설표는 `raw 6712 / net (미측정)`.
- → A가 맞다면 v3 의 6712도 사실은 net에 가깝다(=백오프 분리 후에도 5000 초과). **A의 가설을 시점 B 첫 측정에서 반증 가능** — 첫 freevar v4 백오프-분리 측정 결과 net이 6000 부근이면 A 가설 기각, net이 3500 부근이면 A 가설 확정. 둘 다 운영 동작(롤백/회귀가드)에 영향 → 운영 SOP는 분기 무관하게 작동해야 함(§3 통합 SOP가 양쪽 대비).

---

## 3. 통합 SOP — 측정 → CI 게이트 → 런타임 알람 → 롤백

A의 5단계(PR block / warning / nightly dashboard / hard block / soft fail)와 B의 3계층(L1/L2/L3 + INFO/WARN/CRIT) 을 **시간축**으로 합친다. **충돌 없음, 보완 관계**: A는 머지 전(CI), B는 머지 후(런타임).

```
[코드 변경 PR]
      │
      ▼
 ┌────────────────────────── CI 게이트 (A 영역) ──────────────────────────┐
 │ sentinel-gate (≤5분, PR 차단)                                          │
 │   - PASS<16/20  → exit 1 → PR block  (A §4 "PR block")                │
 │   - net p95 > 4000ms  → exit 1 → PR block                              │
 │   - CoT 누수 ≥1 / 환각 ≥1  → exit 1 → **hard block** (A §4)            │
 │   - net p95 3500~4000ms  → exit 0 + 라벨 `perf-warning` (A "warning") │
 │   - 외부의존 케이스 spike (MARINE_DISABLE 후 잔존) → SKIP, soft fail    │
 │                                                                         │
 │ freevar-gate-nightly (≤40분, 스케줄 차단·PR 비차단)                    │
 │   - DoD 5항목 中 1개라도 실패 → exit 1 → nightly dashboard 알림         │
 │   - 3일 연속 실패 → PR 라벨 `freevar-blocked` 자동 부여                 │
 └─────────────────────────────────────────────────────────────────────────┘
      │ (머지 후)
      ▼
 ┌────────────────────────── 런타임 알람 (B 영역) ───────────────────────┐
 │ 5분 윈도우 net p95 모니터링                                            │
 │   - 4000~5000ms  → INFO  → L1 노란 배지 (B §2.2)                       │
 │   - 5000~6000ms  → WARN  → L1 빨강 + L2 NDJSON 큐                      │
 │   - >6000ms 또는 위반비율 >15%  → CRIT → L1+L2+L3(Slack/이메일)        │
 │   - raw p95 > net p95 ×1.5  → WARN(외부쿼터) → 신선도축 라우팅 (B §4.3)│
 │                                                                         │
 │ CRIT 3분 미해소 → 자동 강등 시퀀스 (B §3.2)                            │
 │   ① WEB_SEARCH_OFF=1  (5분 관찰)                                       │
 │   ② THINKING_BUDGET=0 (5분 관찰)                                       │
 │   ③ BRAIN_OFF=1       (결정론만 — 최후수단)                            │
 │                                                                         │
 │ 강등으로도 미해소 → 수동 롤백 (B §3.3)                                 │
 │   1) webhook violators_top3 + recent_merges 로 triage                  │
 │   2) git bisect + sentinel 20케이스(≤3분) 로 회귀 커밋 식별            │
 │   3) git revert <SHA> + 회귀 가드 sentinel 영구 추가 (B §3.4)          │
 │   4) revert PR 머지는 위 CI 게이트 통과 필수(A 영역 재진입)            │
 └─────────────────────────────────────────────────────────────────────────┘
```

**A와 B의 책임 경계**:
- **A(CI 게이트)**: 머지 전 회귀 차단. 결정론적, 동일 인풋·동일 출력. 외부 의존은 SKIP/MARINE_DISABLE로 노이즈 제거.
- **B(런타임 알람)**: 머지 후 실 트래픽 + 외부 의존 포함. 5분 윈도우의 통계적 판정. raw/net 동시 노출로 외부 vs 자체 회귀 분리.
- **공통**: sentinel 20케이스는 양쪽에서 사용(A=CI 게이트, B=git bisect 진단). 같은 케이스셋 → 진단 일관성.

**A 표의 "Hard block(불변식)" 과 B 의 "CRIT" 의 관계**: Hard block 은 CoT 누수/관리자 누설 등 **보안 불변식**(cross_cutting §6). CRIT 은 **성능 임계** 위반. 두 사건은 독립적이며 동시 발생 시 보안이 우선(서버 측에서 즉시 차단).

---

## 4. 보고 포맷 (A러너 + B대시보드 통합)

### 4.1 러너 stdout — B §4.1 표 양식 채택, 라벨은 net/raw

```
=== Phase 2b 자유변칙 평가 v4 (440케이스, n=1) ===
...
=== p95 게이트 결과 (자유변칙 DoD) ===  (A §4 형식)
  PASS              [npass]/[total] (gate ≥85%)        [✅/❌]
  직군 floor        [min%] (gate ≥70%)                  [✅/❌]
  카테고리 floor    [min%] (gate ≥70%)                  [✅/❌]
  환각 의심         [n] (gate ≤2)                       [✅/❌]
  net p95           [p95_net]ms (gate ≤5000ms)         [✅/❌]
  ── 참고(외부쿼터 감시) ──────────────────────────────
  raw p95           [p95_raw]ms (raw 게이트 ≤7500ms)   [✅/⚠/❌]
  백오프(차이)      총 [tot_s]s · 발생 [n]/[total]건
  429 발생          [n_429]건

판정: net PASS ([net]<=5000) · raw [PASS/WARN] ([raw] vs 7500)
VIOLATION 시: exit 1 (CI는 머지 차단)
```

**핵심 변경**: A의 "wall-clock p95 = pure_p95 + backoff_p95" (합성값) 대신 **케이스별 raw_ms = pure_ms + backoff_ms 적재 후 분위수** 산출.

```python
# main() — 케이스별 raw 적재 (A §5.2 After 패치에 추가)
if data is not None:
    pure = m["pure_ms"]; bo = m["backoff_ms"]
    latencies_net.append(pure)
    latencies_raw.append(pure + bo)  # ← 신규: 케이스별 raw
    backoff_total_ms += bo
    if bo: backoff_cases += 1

p95_net = percentile(latencies_net, 0.95)
p95_raw = percentile(latencies_raw, 0.95)   # 합성 아닌 직접 분위수

violations = []
if p95_net > P95_GATE_MS:
    violations.append(f"net p95 {p95_net}>{P95_GATE_MS}")
# raw 는 1.5x 초과 시 stdout WARN, exit 1은 net 기준만
warn_raw = p95_raw > int(P95_GATE_MS * 1.5)
```

### 4.2 일일 운영 리포트 (B §6.1 그대로) — 데이터원: `assistant_log` + 신규 `backoffMs`

`latencyMs`(raw) - `backoffMs` = net 으로 일일·주간 p95 산출. 카테고리(intent×engine) 별 표는 B §6.1 양식 채택.

### 4.3 어드민 대시보드 카드 (B §2.1 L1)

| 메트릭 | 임계 | 현재(5분) | 현재(24h) | 상태 |
|--------|------|-----------|-----------|------|
| net p95 | 5000ms | [x] | [y] | INFO/WARN/CRIT 배지 |
| raw p95 | 7500ms (=net×1.5) | [x] | [y] | (raw 단독 WARN) |
| 가용성 | ≥99% | [x]% | [y]% | (B §1.1) |
| 토큰 in p95 | 잠정 2000 | [x] | [y] | (B §1.1) |

---

## 5. cross_cutting.md 패치 의사코드 (통합판)

> A·B의 패치 제안을 합쳐 cross_cutting.md 6곳을 단일 PR로 갱신. 본 문서는 의사코드만 제시.

### 5.1 §0 6축 요약표 행 2 (B §5.1 + A §3.2 라벨 통일)

```diff
- | 2 | 비용/지연 SLO | 평가셋 p95 3.2k(달성)·자유변칙 p95 6712ms(**목표 초과 +1712ms/+34%**) | **p95 ≤ 5000ms** · 토큰 계측 | 평가 러너 지연 집계(토큰 미계측) |
+ | 2 | 비용/지연 SLO | 평가셋 net p95 [TBD] · 자유변칙 raw 6712ms / net [A시점 산출] · web_search 별도 임계 7000ms | **net p95 ≤ 5000ms** · 카테고리 변형(p95_gate_synthesis §2) · 토큰 베이스라인→상한 | 러너 net/raw 동시 출력 + 5분 윈도우 운영 알람(L1/L2/L3) + CI sentinel-gate(PR차단)+freevar-nightly(스케줄차단) |
```

### 5.2 §2 (b) 목표/SLO

```diff
+ - **net/raw 구분**: 게이트 판정은 **net(=벽시계 - 429 백오프 sleep)** 기준. raw는 외부 쿼터 알람용 동시 노출.
+ - **카테고리별 변형**: intent×engine 조합으로 세분화(p95_gate_synthesis §2). brain/web_search는 별도 7000ms.
+ - **평균 ≤ 2500ms** (outlier 감시용) · **가용성 ≥ 99%** (`assistant_log.error=null` 비율, 24h 롤링).
+ - **러너 임계(A)**: 평가셋 net p95 ≤3000 · sentinel ≤4000 · freevar ≤5000(DoD).
```

### 5.3 §2 (c) 측정 방법

```diff
+ - **net/raw 동시 산출**: 러너가 케이스별 `pure_ms`(=net), `backoff_ms`(429 sleep), `raw_ms = pure_ms+backoff_ms` 적재 → 분위수는 각각 직접 계산(합성 금지).
+ - **운영 측정 윈도우**: 5분 롤링(알람), 24h 롤링(SLO 보고). 평가 라운드(37~39분) 진행 중에는 L3 발송 정지(억제).
+ - **assistant_log v1.1 스키마 확장**: `backoffMs` 신규 필드(`latencyMs - backoffMs = net`).
```

### 5.4 §2 (e) 위반 시 조치 (A 5단계 + B 자동강등 통합)

```diff
- - p95 > 5000ms → 원인 분리(외부 API 지연 vs 자체 로직 vs 임베딩). 외부의존이면 신선도축(§5)으로, 자체면 web_search 폴백 절제·임베딩 타임아웃 조정.
+ - **CI(머지 전)**: sentinel-gate 위반(net p95>4000, PASS<16/20, CoT≥1, 환각≥1) → exit 1 → PR block. freevar-nightly DoD 위반 → dashboard 알림 + 3일 연속 시 `freevar-blocked` 라벨.
+ - **런타임(머지 후)**: net p95>5000ms (5분 윈도우) → INFO/WARN/CRIT 등급 산출(p95_gate_synthesis §3). CRIT 3분 미해소 → 자동 강등 시퀀스 `WEB_SEARCH_OFF` → `THINKING_BUDGET=0` → `BRAIN_OFF` (각 5분 관찰). 미해소 시 git bisect + sentinel 20케이스로 회귀 커밋 식별 → revert + 회귀 가드 sentinel 영구 추가.
+ - **raw p95 > net p95 ×1.5** → 외부 쿼터 WARN, §5 신선도축 라우팅.
+ - **외부의존 spike (sentinel)** → MARINE_DISABLE=1 + SKIP 라벨로 soft fail.
```

### 5.5 §7.1 SLO 실측 정합성

```diff
- 결론: 임계값 자체(5000ms)는 평가셋 실측과 정합하나, 게이트 판정 대상인 자유변칙 p95는 현재 초과 상태이며 (a)러너의 백오프-제외 집계 구현 (b)자유변칙 v4 재측정 둘 다 완료해야 달성 여부를 확정할 수 있다.
+ 결론: 임계값(5000ms)은 평가셋 실측과 정합. 자유변칙 raw p95 6712ms 미해소는 (a)러너 net/raw 분리 측정(A시점) + (b)v4 재측정 후 net 값으로 판정. 운영 단계에서는 net/raw 동시 노출(시점 B §4, 통합 §4) · net 위반은 §3 롤백 SOP · raw 위반(외부쿼터)은 §5 신선도축 라우팅.
```

### 5.6 §7.3 DoD 표 p95 행

```diff
- | p95 ≤5000ms | 자유변칙 v2 6712ms(평가셋 4.7k) | **+1712ms 초과** · 백오프-제외 집계+v4 재측정 필요 | 2.비용/지연 |
+ | net p95 ≤5000ms | raw 6712ms / net [A시점 측정 후] | net 산출 후 판정. CI sentinel-gate(≤4000)+freevar-nightly(≤5000) 게이트화 완료. 런타임 3계층 알람+자동강등+revert SOP 정책화 완료(p95_gate_synthesis). | 2.비용/지연 |
```

---

## 6. assistant_log 연계 (latencyMs · tokenUsage · backoffMs)

B §6 의 일·주 리포트는 `logs/assistant/YYYY-MM-DD.ndjson` 의 다음 필드를 사용:

| 필드 | 출처 | 용도 | 현재 상태 |
|------|------|------|----------|
| `latencyMs` | assistant.js 핸들러 진입 t0 → push 시각 차 | **raw 산출** | v1 스키마 정의됨, 계측은 §1.7 갭 (cross_cutting §2(d)) |
| `backoffMs` | gemini_client.js 백오프 sleep 누적 (신규) | **net = latencyMs - backoffMs** | **v1.1 신규 필드 필요** (본 통합 §1 제안) |
| `tokenUsage.{input,output,cached}` | token_metering v2 `extractUsage`+`bumpTokens` | 토큰 SLO 추적 (B §1.1) | token_metering v2 미적용 (cross_cutting §2(d)) |
| `intent`, `engine` | assistant.js 메타 | 카테고리 그룹화 (B §1.2 표) | v1 스키마 정의됨 |
| `error.stage`, `error.code` | 도구·plan·synth 오류 | 가용성 산출 · 외부의존 식별 | v1 스키마 정의됨 |
| `labels.hallucinationSuspect`, `labels.evalCandidate` | halluc_cot_capture 라우팅 | 환각 카운트 + 평가셋 자동 보강 | v1 스키마 정의됨 |

**선행 의존성**:
1. assistant_log v1 계측 자체가 미적용 → cross_cutting §2(d) 갭 해소 PR 선행.
2. `backoffMs` 필드 추가 → assistant_log v1.1 스키마 확장 PR.
3. token_metering v2 (extractUsage + bumpTokens) → 토큰 SLO 추적 가능.

위 3개가 모두 적용된 후에야 B §6.3 의 `ops_report_daily.py` 가 정상 동작.

---

## 7. 적용 순서 (5단계 롤아웃)

> 각 단계는 독립 PR. 단계 N 완료 후 N+1 진행. 롤백 단순화 + 게이트 끼임 방지.

### 단계 1 — 러너 패치 (A §5 구현)
- `phase2b_eval_runner.py` · `phase2b_eval_freevar_runner.py` 의 `ask()` 시그니처를 `(data, metrics_dict, err)` 로 변경.
- `metrics_dict = {pure_ms, backoff_ms, attempts, last_attempt_ms}`.
- main: `latencies_net` + `latencies_raw` 두 리스트 적재, 케이스별 raw = pure + backoff (합성 분위수 금지).
- 환경변수: `EVAL_P95_MS`(3000) · `SENTINEL_P95_MS`(4000) · `FREEVAR_P95_MS`(5000) · `FREEVAR_DOD_{PASS_PCT,JIKGUN_FLOOR,CAT_FLOOR,HALLUC_MAX}`.
- 출력: 본 통합 §4.1 양식.
- **수용 기준**: 기존 출력 호환(VIOLATION 라인 추가만), exit 1 동작 확인.

### 단계 2 — 측정 (베이스라인 산출)
- 자유변칙 v4 1회 실행 → net p95 베이스라인 확정.
- 평가셋 v4 1회 실행 → net p95 확인.
- 결과를 cross_cutting.md §7.1·§7.3 갱신용 데이터로 정리(미반영, 단계 3에서 일괄 반영).
- **분기**: net p95 ≤ 5000 → A의 백오프 노이즈 가설 확정, DoD 달성 선언. net p95 > 5000 → 가설 기각, Phase 2b 추가 패치 사이클(임베딩·합성비용 절감) 진행.

### 단계 3 — cross_cutting.md 갱신 (§5 의사코드 적용)
- 본 통합 §5.1~§5.6 의 6곳을 단일 PR로 갱신.
- §7.3 DoD 표는 단계 2 측정 결과를 반영.
- 변경 이력 §8 에 "p95 게이트 통합 적용 (시점 A+B 산출물 반영)" 1줄 추가.

### 단계 4 — 런타임 알람 활성화 (B §2·§3 구현)
- env 플래그 5종 신설: `BRAIN_OFF` · `WEB_SEARCH_OFF` · `SYNTH_TEMP_FLOOR` · `THINKING_BUDGET` · (기존 `EXPOSE_TOKEN_USAGE` 재사용).
- assistant_log v1.1: `backoffMs` 필드 추가 + gemini_client.js 백오프 누적 기록.
- 어드민 대시보드 `/api/admin/ai` 확장: 5분 윈도우 net/raw p95 카드 + INFO/WARN/CRIT 배지.
- L2 큐: `logs/assistant/alerts.ndjson` 적재.
- L3 webhook 후보 스펙(B §2.3)은 운영 위원회 결정 후 구현(선택).
- 자동 강등 시퀀스는 본 단계에서 코드화하되 **수동 트리거**로 시작(첫 1주), 안정화 후 자동화.

### 단계 5 — CI 게이트화 (A §3 구현)
- `.github/workflows/ci.yml` 에 `sentinel-gate` (PR 차단) + `freevar-gate-nightly` (스케줄, PR 비차단) 두 잡 추가.
- 브랜치 보호 규칙: `sentinel-gate` 를 required status check 로 등록. `freevar-gate-nightly` 는 비required.
- 첫 1주는 sentinel-gate를 **continue-on-error: true** 로 두고 위양성 모니터, 이후 hard 차단으로 전환.

### 적용 순서 근거
- 단계 1·2 먼저 → 측정 없이 정책 명문화하면 임계 락이 잘못될 위험.
- 단계 3 다음 → 측정 기반 임계 확정 후 문서 단일 진실(single source of truth) 확보.
- 단계 4 → 5: 런타임 알람이 먼저 정착해야 CI 게이트 위양성 시 운영팀이 우회 절차 명확.
- 단계 5 마지막 → PR 차단의 영향이 가장 크므로 충분한 베이스라인·알람 데이터 후 활성화.

---

## 8. 종합 결론

1. **명명 통일**: 러너 내부 `pure_ms`/`backoff_ms` ↔ 보고 라벨 `net`/`raw` ↔ 로그 필드 `latencyMs`(=raw)/`backoffMs` (3축 정식 매핑).
2. **임계 정합**: A 측정-축(평가셋/sentinel/freevar) ↔ B 운영-축(intent×engine) 은 직접 충돌 없음. 동일 케이스에 두 임계가 모두 적용되면 더 엄격한 쪽이 우선(sentinel 4000 > brain 5500).
3. **단일 SOP**: 머지 전(CI 게이트, A) → 머지 후(3계층 알람·자동강등·revert, B) 가 시간축으로 결합된 한 흐름. 양측 모두 sentinel 20케이스 재사용 → 진단 일관성.
4. **보고**: net/raw 동시 노출 + 케이스별 합산 후 분위수(분위수의 합 금지).
5. **cross_cutting 패치**: 6곳 단일 PR로 갱신 (§5 의사코드).
6. **assistant_log v1.1**: `backoffMs` 신규 필드 필수 — 본 통합의 핵심 선행 의존.
7. **5단계 롤아웃**: 러너→측정→문서→런타임 알람→CI 차단 순.

### 발견된 A↔B 불일치 (2건)

1. **분위수 합성 vs 케이스별 raw 분위수**: A §1.2/§5는 "wall-clock p95 = pure_p95 + backoff_p95"의 합성값을 참고로 둠. B §4.1·§4.2는 raw p95 를 그 자체 분위수로 표기. **분위수의 합 ≠ 합의 분위수** 이므로 케이스별 `raw_ms = pure_ms + backoff_ms` 적재 후 분위수가 정확 → **B 방식 채택, 본 통합 §4.1 코드 의사코드로 명시**.
2. **sentinel 4000 vs brain 5500 임계 외견상 충돌**: A의 sentinel 임계(4000)가 B의 `brain`/`gemini-2.5-flash-lite` 임계(5500)보다 보수적. sentinel 케이스 중 brain 경로가 있을 때 헷갈릴 수 있음. **해소**: sentinel은 회귀 직타용(외부의존 SKIP), 런타임 카테고리 SLO는 실 트래픽용. 동일 케이스 적용 시 더 엄격한 쪽(sentinel 4000) 우선 → **본 통합 §2 매트릭스에서 의도된 우선순위로 명시**.
