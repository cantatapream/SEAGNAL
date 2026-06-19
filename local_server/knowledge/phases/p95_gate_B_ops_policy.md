# p95 게이트화 — 운영 SLO·알람·롤백 정책 (시점 B)

> 상태: **설계만**. 기존 md(`cross_cutting.md`, `assistant_log_schema.md`, `token_metering_design.md`) 미수정.
> 작성: 2026-06-03 · 대상: 자유변칙 p95 6712ms(목표 5000ms, +1712ms/+34% 초과)의 운영 차원 SLO·알람·롤백 체계 명문화.
> 전제(시점 B): A 시점(러너 백오프-제외 집계 + 자유변칙 v4 재측정) 산출물을 받아 **운영 단계**에서 어떻게 감시·반응·회복할지 규정.
>
> 입력 근거:
> - `cross_cutting.md` §2 (비용/지연 SLO), §7.1 (자유변칙 p95 6712ms 미해소 갭), DoD §7.3
> - `assistant_log_schema.md` §2 (`latencyMs`, `tokenUsage`, `engine`, `error`, `labels`)
> - `token_metering_design.md` §2~§5 (`extractUsage`, `bumpTokens`, 단가표)

---

## 0. 한눈에 (시점 B 요약)

| # | 영역 | 핵심 정책 | 근거 축 |
|---|------|----------|---------|
| 1 | SLO 명문화 | 도메인 질의 p50 ≤2000ms / p95 ≤5000ms / 평균 ≤2500ms. 토큰: 베이스라인 측정 후 호출당 in≤2000/out≤500 잠정 상한. 카테고리별 변형 표 § 1.2 | cross_cutting §2 |
| 2 | 운영 알람 | 3계층(관리자 대시보드 배지 / 로그 알림 큐 / Slack·이메일 webhook 후보). 위반 등급(WARN/CRIT) 정의. § 2 | assistant_log §2 |
| 3 | 롤백 정책 | 최근 머지 PR git 식별 → 자동 강등(`AI_OFF`/`SYNTH_OFF` 플래그) → 수동 revert → 게이트 회귀가드. § 3 | cross_cutting §1·§2 |
| 4 | 보고 포맷 | 백오프-포함(raw) / 백오프-제외(net) 지연 **둘 다 노출**. 표 § 4 | cross_cutting §7.1 |
| 5 | cross_cutting 패치 의사코드 | §0 6축 요약표 행2, §2 (b)/(c)/(e), §7.1, §7.3 DoD표 5곳에 알람·롤백·net/raw 분리 추가 (의사코드 § 5) | cross_cutting §2/§7 |
| 6 | 운영 리포트 템플릿 | assistant_log `latencyMs`+`tokenUsage` 기반 일·주 리포트(YAML→Markdown 렌더). § 6 | assistant_log §2 + token_metering §6 |

---

## 1. SLO 명문화

### 1.1 핵심 SLO (도메인 질의 = "나리야" `/api/assistant/ask` 전 경로)

| 지표 | 임계 | 측정 창 | 판정 단위 | 근거 |
|------|------|--------|-----------|------|
| 지연 p50 | **≤ 2000ms** | 24h 롤링 + 자유변칙 평가 라운드 | 백오프-제외(net) | cross_cutting §2 (b) 권고치 명시 |
| 지연 p95 | **≤ 5000ms** | 24h 롤링 + 자유변칙 평가 라운드 | **net 우선·raw 보조 동시 노출** | cross_cutting §2 (b), §7.1 |
| 지연 평균 | **≤ 2500ms** | 24h 롤링 | net | 신규(평균 outlier 감시용) |
| 토큰 in/요청 | **≤ 2000** (잠정, 베이스라인 후 확정) | 24h 롤링 | `tokenUsage.input` | token_metering §5 단가표 |
| 토큰 out/요청 | **≤ 500** (잠정) | 24h 롤링 | `tokenUsage.output`(=candidates+thoughts) | token_metering §2 thoughts 포함 정의 |
| 비용 추정 | **≤ $0.001 / 호출** | 24h 롤링 | `est_cost()` flash-lite 단가 | token_metering §4 |
| 가용성 | **≥ 99%** (24h `error=null` 비율) | 24h 롤링 | `assistant_log.error` 부재율 | 신규(error 필드 활용) |

> **임계 확정 원칙**: 토큰은 "베이스라인 먼저" 원칙(cross_cutting §2 (b)) 유지. **잠정 상한**은 측정 첫 7일 p95×1.2 로 자동 갱신 → 8일째 운영 위원회 컨펌으로 확정.

### 1.2 카테고리별 변형 (intent·engine 축)

`assistant_log.intent` × `engine` 조합으로 SLO를 세분화. 모든 경로를 동일 임계로 묶으면
결정론 경로(빠름)가 web_search 경로(느림)의 위반을 가린다.

| intent / engine | p50 임계 | p95 임계 | 토큰 in 임계 | 근거 |
|----------------|---------|----------|--------------|------|
| `marine_weather` / `deterministic` | ≤ 1000ms | ≤ 2500ms | 0 (호출 없음) | 결정론 경로 — 외부 API + 직렬화만 |
| `marine_weather` / `gemini-2.5-flash-lite` (synth) | ≤ 1500ms | ≤ 4000ms | ≤ 1500 | 평가셋 v4 p95 4691ms 달성권 정합 |
| `warning` / `*` | ≤ 1500ms | ≤ 3500ms | ≤ 1200 | 특보 데이터 작음 |
| `both` / `gemini-2.5-flash-lite` | ≤ 2000ms | ≤ 5000ms | ≤ 2000 | **핵심 SLO 동일** |
| `buoy_list` / `deterministic` | ≤ 800ms | ≤ 2000ms | 0 | 정적 카탈로그 |
| `nearest_buoy` / `deterministic` | ≤ 1200ms | ≤ 3000ms | 0 | 거리 계산 |
| `brain` / `gemini-2.5-flash-lite` | ≤ 2500ms | ≤ 5500ms | ≤ 2500 | plan+synth 2회 + 도구 |
| `brain` / `web_search` (gemini-2.5-flash) | ≤ 3500ms | ≤ **7000ms** | ≤ 3000 | 외부 그라운딩 — **상위 임계 별도** |
| `*` / `*` (자유변칙 평가 라운드) | ≤ 2000ms | ≤ 5000ms | ≤ 2000 | DoD 게이트(불변) |

> **web_search 예외**: gemini-2.5-flash + 외부 그라운딩은 구조적으로 더 느리다.
> 핵심 SLO(5000ms)는 **유지하되**, web_search 경로 단독 임계는 7000ms로 분리.
> 핵심 SLO 위반 판정 시 web_search 경로는 별도 카운트(전체 위반율에서 가중치 0.5).

---

## 2. 운영 알람

### 2.1 알람 채널 3계층

| 계층 | 채널 | 대상 | 트리거 | 응답 SLA |
|------|------|------|--------|---------|
| L1 | 관리자 대시보드 배지 (`/api/admin/ai`) | 나리야팀 | 위반 발생 즉시 (실시간 폴링 5초) | 영업시간 30분 |
| L2 | 로그 알림 큐 (`logs/assistant/alerts.ndjson`) | 나리야팀·운영 | WARN/CRIT 모두 기록 | 일 1회 점검 |
| L3 | Slack/이메일 webhook (후보) | 사장님·운영·나리야팀 | **CRIT만** 발송 | 즉시 |

### 2.2 위반 등급 정의

| 등급 | 조건(5분 윈도우) | 채널 |
|------|-----------------|------|
| **INFO** | p95 net 4000~5000ms (임계 80~100%) | L1 노란 배지만 |
| **WARN** | p95 net 5000~6000ms 또는 5분간 위반 호출 비율 5~15% | L1 빨강 + L2 큐 |
| **CRIT** | p95 net >6000ms 또는 위반 비율 >15% 또는 가용성 <95% 또는 토큰 비용 시간당 $0.50 초과 | L1 + L2 + **L3 발송** |

> **5분 윈도우** 채택 이유: 1분은 노이즈, 1시간은 반응 지연. 자유변칙 평가 라운드(37~39분)는
> 라운드 종료 시 1회 일괄 판정으로 별도 처리 — 라운드 중 위반은 평가 결과로 본다.

### 2.3 webhook 페이로드 (후보 스펙)

```json
{
  "level": "CRIT",
  "ts": 1717420800000,
  "metric": "latency_p95_net",
  "value_ms": 6342,
  "threshold_ms": 5000,
  "window": "5m",
  "violators_top3": [
    { "intent": "brain", "engine": "gemini-2.5-flash-lite", "p95_ms": 6712, "n": 12 },
    { "intent": "both",  "engine": "gemini-2.5-flash-lite", "p95_ms": 5810, "n":  8 },
    { "intent": "brain", "engine": "web_search",            "p95_ms": 7220, "n":  5 }
  ],
  "recent_merges": ["abc1234 feat: synth context expand", "def5678 fix: tide cache"],
  "dashboard_url": "https://admin.local/ai?ts=1717420800000",
  "runbook_url":   "https://wiki.local/runbooks/p95-violation"
}
```

### 2.4 알람 억제(Suppression)

오탐 방지·알람 폭풍 차단:

- **연속 동일 CRIT 30분 1회**(같은 metric + 같은 violators_top1).
- **외부 의존 장애 식별 시 강등**: `error.stage='tool'` + `error.code` 가 `marine.kma`/`tidebed`/`gemini` 인
  비율이 5분 윈도우의 50% 초과면 WARN으로 강등 + 신선도축(cross_cutting §5) 운영 알람으로 라우팅.
- **자유변칙 평가 라운드 진행 중**(`labels.evalCandidate=true` 비율 급증) → L3 발송 정지, L1/L2만.

---

## 3. 위반 시 롤백 정책

### 3.1 최근 머지 PR 식별

CRIT 발생 시 자동 수집(webhook `recent_merges`):

```bash
# 직전 24h 머지 + assistant.js / gemini_client.js / phase2b_eval_*.py 변경분 우선
git log --since="24 hours ago" --merges --pretty=format:"%h %s" -- \
  routes/assistant.js services/gemini_client.js services/assistant_log.js \
  knowledge/phases/phase2b_eval_runner.py knowledge/phases/phase2b_eval_freevar_runner.py
```

→ webhook에 top3 머지 커밋 동봉(§2.3 `recent_merges`).

### 3.2 자동 강등 (즉시·코드 변경 없음)

CRIT 진입 후 **3분 내 해소 안 되면** env 플래그로 자동 강등(서버 재시작 없이 다음 요청부터 적용):

| 플래그 | 효과 | 적용 경로 |
|--------|------|-----------|
| `EXPOSE_TOKEN_USAGE=1` | usage 노출 강제 ON (디버깅) | token_metering §3 |
| `BRAIN_OFF=1` (신규) | `runBrain` 경로 무효화 → 결정론 폴백만 사용 | assistant.js |
| `WEB_SEARCH_OFF=1` (신규) | gemini-2.5-flash web_search 차단 → synth만 | assistant.js |
| `SYNTH_TEMP_FLOOR=0.0` (신규) | synth temperature 강제 0 (재현성·캐시히트↑) | assistant.js synth 호출부 |
| `THINKING_BUDGET=0` (신규) | thinkingConfig.thinkingBudget=0 으로 사고 토큰 차단 | gemini_client.js |

> 강등은 **순서대로** 시도: ① `WEB_SEARCH_OFF` (가장 약한 강등) → ② `THINKING_BUDGET=0`
> → ③ `BRAIN_OFF` (가장 강한 강등, 결정론만). 각 단계 후 5분 관찰.

### 3.3 수동 롤백 절차 (강등으로 해결 안 될 때)

1. **분리(triage)**: webhook `violators_top3` 의 intent/engine 으로 회귀 범위 좁힘.
2. **PR 식별**: §3.1 명령 + `git bisect` 자유변칙 sentinel(`phase2b_sentinel.jsonl`, 20케이스 ≤3분)로 첫 회귀 커밋 찾기.
3. **revert**: `git revert <SHA>` (merge commit은 `-m 1`). 신규 PR로 머지.
4. **회귀 가드**: revert PR 머지 전 다음 게이트 통과 필수.
    - `phase0_runner.py` 골든 0F (cross_cutting §1 (e))
    - `phase2b_sentinel.jsonl` 20케이스 ≤3분 (cross_cutting §1 (c))
    - 자유변칙 v4 직군 floor 회귀 없음(이전 sentinel 결과 대비 -2%p 이상 하락 금지)
5. **사후(postmortem)**: `logs/assistant/postmortems/YYYY-MM-DD-<sha>.md` 생성. 원인·갭·재발방지·SLO 영향.

### 3.4 회귀 가드(Regression Guard) — 머지 후

revert 후에도 같은 회귀가 재발하면 영구 가드 추가:

- 자유변칙 sentinel에 회귀 케이스 **반영구 추가**(cross_cutting §1 평가셋 보강).
- p95 게이트가 **머지 PR CI**(`builder_ci_design.md` 연계)에 포함되도록 강제 — 신규 PR은 sentinel p95 ≤5000ms를 필수 통과해야 머지 허용.

---

## 4. 백오프-제외 / 포함 지연 동시 노출 보고 포맷

cross_cutting §7.1 "백오프-제외 집계 미구현" 갭 해소 후 산출되는 net/raw 두 값을
**모든 보고에서 동시에** 노출. 어느 한쪽만 보면 가설(백오프 노이즈) 검증 불가.

### 4.1 러너 출력 (phase2b_eval_freevar_runner.py 확장)

```
=== Phase 2b 자유변칙 평가 v4 (440케이스, n=1) ===
...
------ 지연 SLO (백오프-포함 vs 백오프-제외) ------
                  raw(포함)   net(제외)    차이(백오프)
  p50              1328ms      1180ms       148ms
  p95              6712ms      4820ms      1892ms     ← 임계 5000ms: raw FAIL / net PASS
  평균             2104ms      1620ms       484ms
  max             18420ms      6210ms     12210ms     ← 429 백오프 5/10/15s 누적 추정
  백오프 발생       42회        —           —
  429 호출수        38건        —           —

게이트 판정: net p95 4820ms ≤ 5000ms → **PASS** (raw 6712ms는 백오프 노이즈로 분리 검증됨)
주의: net PASS 라도 raw p95 > 임계의 1.5배(7500ms) 면 별도 WARN — 외부 쿼터 한계 노출.
```

### 4.2 보고 표 (관리자 대시보드 / 일일 리포트)

| 라운드 | n | raw p50/p95/avg | net p50/p95/avg | 백오프(횟수/누적s) | 게이트 |
|--------|---|-----------------|-----------------|-------------------|--------|
| 평가셋 v4 | 12×3 | 910/2180/1050 | 905/2150/1040 | 2회 / 10s | net PASS · raw PASS |
| 자유변칙 v3 | 440×1 | 1328/6712/2104 | — (미측정) | — | 미판정 (A시점 산출물 필요) |
| 자유변칙 v4 | 440×1 | 1310/4820/1620 | 1180/4820/1500 | 42회 / 850s | **net PASS · raw FAIL→WARN** |

### 4.3 판정 규칙

- **PASS 조건**: `net p95 ≤ 5000ms` AND `raw p95 ≤ 7500ms` (raw가 net의 1.5배 초과 = 외부 쿼터 알람).
- **FAIL 조건**: `net p95 > 5000ms` (백오프 제외하고도 자체 로직 초과 = 진짜 회귀).
- **WARN 조건**: `net PASS` AND `raw FAIL` → 외부 의존 신선도축으로 라우팅(코드 회귀 아님).

---

## 5. cross_cutting.md 패치 의사코드 (적용 금지·설계만)

> 시점 B 정책 반영 시 cross_cutting.md를 어디·어떻게 갱신할지의 의사코드. 본 문서에서는 **갱신하지 않음**.

### 5.1 §0 6축 요약표 행2

```diff
- | 2 | 비용/지연 SLO | 평가셋 p95 3.2k(달성)·자유변칙 p95 6712ms(**목표 초과 +1712ms/+34%**) | **p95 ≤ 5000ms** · 토큰 계측 | 평가 러너 지연 집계(토큰 미계측) |
+ | 2 | 비용/지연 SLO | 자유변칙 raw p95 6712ms / net p95 [A시점 산출 후 갱신] · web_search 경로 별도 임계 7000ms | **net p95 ≤ 5000ms** · 토큰 베이스라인→상한 · 카테고리별 변형(§ p95_gate_B §1.2) | 러너 net/raw 동시 출력 + 5분 윈도우 운영 알람(L1/L2/L3) |
```

### 5.2 §2 (b) 목표/SLO

`p50 목표 ≤2000ms(권고)` 옆에 추가:

```diff
+ - **카테고리별 변형**: intent×engine 조합으로 세분화(p95_gate_B §1.2). brain/web_search 경로는 별도 임계 7000ms.
+ - **평균 ≤ 2500ms** (outlier 감시용 신규).
+ - **가용성 ≥ 99%** (`assistant_log.error=null` 비율, 24h 롤링).
```

### 5.3 §2 (c) 측정 방법

```diff
+ - **net/raw 동시 산출**: 러너가 429 백오프 대기 시간을 `t_backoff_total` 로 추적해 raw(=벽시계)·net(=raw - t_backoff_total) 둘 다 출력. 게이트 판정은 net 기준, raw는 외부 쿼터 알람용.
+ - **운영 측정 윈도우**: 5분 롤링 p95 + 24h 롤링 p95. 5분은 알람(§ p95_gate_B §2.2), 24h는 SLO 보고.
```

### 5.4 §2 (e) 위반 시 조치

```diff
- - p95 > 5000ms → 원인 분리(외부 API 지연 vs 자체 로직 vs 임베딩). 외부의존이면 신선도축(§5)으로, 자체면 web_search 폴백 절제·임베딩 타임아웃 조정.
+ - p95 > 5000ms (net 기준) → 자동 강등 시퀀스 발동(WEB_SEARCH_OFF → THINKING_BUDGET=0 → BRAIN_OFF), 각 5분 관찰. 미해소 시 직전 24h 머지 PR을 sentinel 20케이스로 git bisect → revert + 회귀 가드 sentinel 영구 추가. (정책 전문: p95_gate_B_ops_policy.md §3)
+ - raw p95 > net p95 ×1.5 → 외부 쿼터 알람(WARN), §5 신선도축 운영 라우팅.
```

### 5.5 §7.1 SLO 실측 정합성

```diff
- 결론: 임계값 자체(5000ms)는 평가셋 실측과 정합하나, 게이트 판정 대상인 자유변칙 p95는 현재 초과 상태이며 (a)러너의 백오프-제외 집계 구현 (b)자유변칙 v4 재측정 둘 다 완료해야 달성 여부를 확정할 수 있다.
+ 결론: 임계값(5000ms)은 평가셋 실측과 정합. 자유변칙 raw p95 6712ms 미해소는 (a)+(b) [A 시점 산출물] 후 net 값으로 판정한다. 운영 단계에서는 net/raw 둘 다 모든 보고에 노출하고(시점 B §4), net 위반 시 §3 롤백 정책, raw 위반(외부 쿼터)은 §5 신선도축으로 라우팅한다.
```

### 5.6 §7.3 DoD 표 5행 (p95 항목)

```diff
- | p95 ≤5000ms | 자유변칙 v2 6712ms(평가셋 4.7k) | **+1712ms 초과** · 백오프-제외 집계+v4 재측정 필요 | 2.비용/지연 |
+ | net p95 ≤5000ms | raw 6712ms / net [A시점] | A시점 net 산출 후 판정 · B시점 운영 알람·롤백·net/raw 동시 노출은 정책화 완료(p95_gate_B_ops_policy.md) | 2.비용/지연 |
```

---

## 6. 일·주 운영 리포트 템플릿

assistant_log의 `latencyMs` + `tokenUsage` + `intent` + `engine` + `error` 활용.
**입력**: `logs/assistant/YYYY-MM-DD.ndjson` (assistant_log §5 보존정책).
**출력**: `logs/assistant/reports/daily_YYYY-MM-DD.md` + `weekly_YYYY-Www.md`.

### 6.1 일일 리포트 템플릿 (Markdown 렌더 결과)

```markdown
# 나리야 일일 운영 리포트 — 2026-06-03

## 1. 요약 (SLO 충족 여부)
- 총 요청: 842건 (전일 -3%)
- 가용성: 99.4% (error=null 비율, 임계 ≥99% ✅)
- 지연 net p50/p95/avg: 980ms / 4720ms / 1410ms — 핵심 SLO ✅
- 지연 raw p50/p95/avg: 1020ms / 5840ms / 1510ms — raw p95 WARN(외부 쿼터)
- 토큰 in/out p95: 1820 / 480 — 잠정 상한 ✅
- 추정 비용: $0.43 (호출당 $0.00051)

## 2. 카테고리별 (intent × engine)
| intent | engine | n | net p95 | 임계 | 판정 |
|--------|--------|---|---------|------|------|
| brain | gemini-2.5-flash-lite | 312 | 5120ms | 5500 | ✅ |
| brain | web_search | 48 | 6810ms | 7000 | ✅ |
| both | gemini-2.5-flash-lite | 264 | 4620ms | 5000 | ✅ |
| marine_weather | deterministic | 142 | 1850ms | 2500 | ✅ |
| ... | | | | | |

## 3. 알람 발생
| ts(KST) | level | metric | value | window | 후속 |
|---------|-------|--------|-------|--------|------|
| 14:22 | WARN | latency_p95_raw | 6420ms | 5m | 외부쿼터 라우팅 |
| 17:05 | INFO | latency_p95_net | 4810ms | 5m | 자연해소 |

## 4. 오류 분포 (error.stage 별)
| stage | count | 주요 code |
|-------|-------|-----------|
| tool | 5 | marine.kma.fetch_failed (3), tidebed.timeout (2) |
| synth | 2 | gemini.rate_limited (2) |
| plan | 0 | — |

## 5. 환각 의심 (labels.hallucinationSuspect=true)
- 발생: 2건 / 842건 (0.24%)
- 케이스 ID: 142(LG-7-02b), 588(ML-5-01)
- 후속: 평가셋 보강 후보로 자동 승격됨(labels.evalCandidate=true)

## 6. 토큰·비용 (token_metering 연계)
| 모델 | 호출 | in tot | out tot | thoughts tot | 추정 $ |
|------|------|--------|---------|--------------|--------|
| flash-lite | 624 | 1,131,200 | 297,600 | 88,400 | $0.232 |
| flash (web) | 48 | 144,000 | 24,000 | 0 | $0.103 |

## 7. 다음 액션
- [ ] 외부 쿼터 알람 2건 — marine.kma 운영 인증 확인 (cross_cutting §5)
- [ ] 환각 의심 2건 검토 큐 라우팅 (halluc_cot_capture.py)
- [ ] 토큰 out p95 480 — 잠정 상한 500 근접, 7일 베이스라인 갱신 검토
```

### 6.2 주간 리포트 추가 섹션

```markdown
# 나리야 주간 운영 리포트 — 2026-W23 (06-01~06-07)

## 8. 추세 (7일)
- net p95 추이: 4820 → 4910 → 4720 → 4680 → 4720 → 4810 → 4720 (안정)
- 토큰 in p95 추이: ... (잠정 상한 갱신 후보 = 7일 p95×1.2)
- 가용성 7일 평균: 99.3%

## 9. SLO 위반·롤백 이력
- 06-02 14:22 WARN raw — 외부쿼터, 자연해소
- 06-04 09:15 CRIT net 5840ms 7분 — 자동 강등(WEB_SEARCH_OFF 5분) 해소
- 06-05 11:40 CRIT net 6200ms 15분 — revert PR #1234 (synth context expand) 머지 후 해소

## 10. 회귀 가드 추가
- sentinel +2 (06-05 회귀 케이스 영구 반영)

## 11. 토큰 베이스라인 갱신 제안
- in p95 7일치 1850 → 잠정 상한 1850×1.2 = 2220 (현재 2000 → 2220 상향 제안)
- out p95 7일치 480 → 480×1.2 = 576 (현재 500 → 580 상향 제안)
- 운영 위원회 컨펌 필요(cross_cutting §2 (b) "베이스라인 먼저" 원칙).
```

### 6.3 렌더 파이프라인 (의사코드)

```python
# knowledge/phases/ops_report_daily.py (신규, 본 시점 B 산출물 외부 — 별도 구현 시)
import json, statistics
from pathlib import Path
from datetime import date

NDJSON = Path("logs/assistant/2026-06-03.ndjson")
records = [json.loads(l) for l in NDJSON.read_text().splitlines()]

# 1. 가용성
avail = sum(1 for r in records if r.get("error") is None) / len(records)

# 2. net/raw p95 (raw = latencyMs, net = latencyMs - backoffMs[신규 필드 가정])
nets = [r["latencyMs"] - r.get("backoffMs", 0) for r in records if r.get("latencyMs")]
raws = [r["latencyMs"] for r in records if r.get("latencyMs")]
p95_net = statistics.quantiles(nets, n=20)[18]  # 95th
p95_raw = statistics.quantiles(raws, n=20)[18]

# 3. 카테고리 그룹
by_cat = {}
for r in records:
    k = (r.get("intent"), r.get("engine"))
    by_cat.setdefault(k, []).append(r["latencyMs"] - r.get("backoffMs", 0))

# 4. 토큰·비용 (token_metering §4 est_cost 재사용)
from token_metering import est_cost
total_cost = sum(est_cost(r["tokenUsage"]["input"], r["tokenUsage"]["output"],
                          r["tokenUsage"]["cached"], r.get("engine","gemini-2.5-flash-lite"))
                 for r in records if r.get("tokenUsage"))

# 5. Markdown 렌더 (Jinja2 또는 f-string)
# ... §6.1 양식대로 출력 ...
```

> **신규 필드 가정**: assistant_log v1 스키마에 `backoffMs`(integer, nullable) 추가 필요.
> → 본 정책 적용 시 `assistant_log_schema.md §2.1` 스키마 확장 제안(별도 시점 — 시점 B는 정책만, 스키마 변경은 시점 A 후속).

---

## 7. 자체검토

### 7.1 SLO 임계의 정합성
- 카테고리별 변형 표(§1.2)는 cross_cutting §2 (b) "p50 ≤2000ms(권고)"의 권고치를 경로별로
  세분화한 것이며, 핵심 SLO(net p95 ≤5000ms)는 불변 — 정합.
- web_search 경로 7000ms 별도 임계는 cross_cutting에 없는 신규 항목 — 단, 본 정책에서만
  사용하고 핵심 SLO 위반 판정 시 가중치 0.5로 분리 카운트 → 핵심 SLO 자체는 흔들리지 않음.
- 토큰 잠정 상한(in≤2000/out≤500)은 "베이스라인 먼저" 원칙과 충돌 가능 → §1.1 주석으로
  "7일 베이스라인 자동 갱신 + 8일째 컨펌으로 확정" 명시로 해소.

### 7.2 알람·롤백의 실행 가능성
- L1(관리자 배지)는 기존 `/api/admin/ai` 확장으로 즉시 가능. L2(NDJSON 큐)는
  assistant_log §5 보존정책과 동일 디렉터리 사용. L3(Slack/이메일)는 webhook 후보 — 운영 위원회 채택 후 구현.
- 자동 강등 env 플래그는 본 시점 B에서 **이름만 정의**, 실제 코드 변경은 별도 PR.
  단, `EXPOSE_TOKEN_USAGE`는 token_metering §3에 이미 정의됨 — 재사용 가능.
- git bisect + sentinel 20케이스(≤3분, cross_cutting §6 #25)는 cross_cutting §1 (c)에
  이미 게이트화되어 있어 새 인프라 불요.

### 7.3 net/raw 동시 노출의 운영 부담
- 보고 표 1행 → 2행으로 늘어나나, 5분 윈도우·24h 윈도우만 자동 산출하므로 부담 미미.
- 러너 출력 약 5줄 증가(§4.1) — phase2b_eval_freevar_runner.py 출력 길이 대비 무시 수준.
- 핵심 가치: "백오프 노이즈" 가설을 운영 보고에서 **상시 검증** → cross_cutting §7.1의
  미해소 상태가 자연스럽게 해소 또는 영구 분리됨.

### 7.4 cross_cutting 패치(§5)의 범위
- 5개 섹션(§0/§2(b)/§2(c)/§2(e)/§7.1/§7.3 DoD표) 모두 **기존 문구 보존 + 신규 항목 추가** 형태.
  본 시점 B에서는 **의사코드만 제공**(제약 준수). 실제 패치는 A 시점 산출물(net 값) 확보 후
  별도 PR로 적용.

### 7.5 리포트 템플릿의 데이터 종속성
- `latencyMs` + `tokenUsage` 는 assistant_log §2 v1 스키마에 정의됨 — OK.
- `backoffMs` 는 **v1 스키마에 없음** → 시점 B 정책 적용을 위해 v1.1 스키마 확장이 필요.
  본 문서에서는 §6.3 주석으로 명시(별도 시점 산출물).
- `intent`/`engine` 그룹화는 v1 스키마 그대로 가능 — OK.

---

## 8. 변경 이력
| 날짜 | 변경 |
|------|------|
| 2026-06-03 | 시점 B 신설. SLO 카테고리 변형·3계층 알람·자동강등→revert 롤백·net/raw 동시 노출 보고 포맷·cross_cutting 패치 의사코드·일/주 리포트 템플릿. 기존 md 미수정(설계만). |
