## 옵션 δ — p95 게이트화 운영 정책 patch 시점 B (cross_cutting + assistant_log + 알람 + 롤백)

> 입력: `p95_gate_synthesis.md` (SOP·임계·알람·롤백 통합) · `p95_gate_B_ops_policy.md` (3계층 알람·자동강등·revert) · `cross_cutting.md` (현 SLO·DoD 명시, R2 검토에서 p95 갭 미검증가설로 강등됨) · `assistant_log_schema.md` (latencyMs·tokenUsage·backoffMs 추가 제안).
> 본 문서는 **시점 A(러너 net/raw 분리 측정 patch — `delta_runner_A_impl.md`) 완료 후** 운영 문서·스키마·알람·롤백 4종을 patch 의사코드로 묶는다.
> **제약**: 기존 md/코드 미수정. 본 신규 md 1개만 생성. 한국어. 한 줄 요약은 §6.
> 작성: 2026-06-04.

---

### 0. 한눈에 (B 시점 운영 문서 patch 5축)

| 축 | 대상 | 변경 형식 | 출처 정합 |
|---|---|---|---|
| 1 | `cross_cutting.md` 6곳 | diff 의사코드 (§0 / §2(b)(c)(e) / §7.1 / §7.3 DoD) | synthesis §5 + B §5 + R2 검토(미검증가설 강등) 반영 |
| 2 | `assistant_log_schema.md` v1→v1.1 | 신규 필드 `backoffMs` · `pureLatencyMs` · `rawLatencyMs` 분리 + `latencyMs` 의미 명확화 | synthesis §1 명명표 + B §6.3 주석(v1.1 가정) |
| 3 | 알람 정책 SOP 신규 md (`p95_gate_alarm_policy.md`) | 3계층 L1/L2/L3 + WARN/CRIT 등급 + 5분 윈도우 + 억제 규칙 | B §2 + synthesis §3 결합 |
| 4 | 롤백 절차 신규 md (`p95_gate_rollback_runbook.md`) | env 자동 강등 → bisect → revert → 회귀 가드 sentinel 영구 추가 | B §3 + synthesis §3 결합 |
| 5 | 적용 순서 | 러너 patch(δ-A) → 측정(베이스라인) → cross_cutting 갱신 → 알람 활성화 → CI 게이트화 | synthesis §7 5단계 롤아웃 |

**핵심 결정 1건**: assistant_log v1.1 에서 `latencyMs` 는 **벽시계(=raw) 의미로 명확화** 하되, 별칭 `rawLatencyMs` 도 동시 노출(diff). 그리고 `backoffMs` + `pureLatencyMs(=net)` 신규 — 둘 중 하나만 있어도 `net = rawLatencyMs - backoffMs` 파생 가능하지만, **`pureLatencyMs` 를 명시 저장**해 합산 정확도(분위수의 합 금지 원칙)를 보장.

---

### 1. cross_cutting.md 6곳 patch 의사코드

> 본 문서는 의사코드만 제시 — 적용은 별도 PR. R2 검수 반영(2026-06-03)으로 §0/§2/§7.1/§7.3/§8에 이미 "p95 갭 미해소" 가 명시되어 있으므로, 본 patch 는 그 위에 net/raw 분리 + 알람·롤백 SOP 연계만 덧붙인다.

#### 1.1 §0 6축 요약표 행 2 (SLO + 게이트·러너 열 교체)

```diff
- | 2 | 비용/지연 SLO | 평가셋 p95 3.2k(달성)·자유변칙 p95 6712ms(**목표 초과 +1712ms/+34%**) | **p95 ≤ 5000ms** · 토큰 계측 | 평가 러너 지연 집계(토큰 미계측) |
+ | 2 | 비용/지연 SLO | 평가셋 net p95 [δ-A 시점 산출] · 자유변칙 raw 6712ms / net [δ-A 시점] · web_search 별도 임계 7000ms | **net p95 ≤ 5000ms** · 카테고리 변형(p95_gate_synthesis §2) · 토큰 베이스라인→상한 | 러너 net/raw 동시 출력 + 5분 윈도우 운영 알람(L1/L2/L3, p95_gate_alarm_policy.md) + CI sentinel-gate(PR차단) + freevar-nightly(스케줄차단) + 롤백 SOP(p95_gate_rollback_runbook.md) |
```

#### 1.2 §2 (b) 목표/SLO — 추가 5줄

```diff
  - **지연: p95 ≤ 5000ms** (P2b DoD 및 §6 #25 게이트 임계). p50 목표 ≤2000ms(권고).
  - **토큰: 단계별 상한 측정·기록**(절대 임계는 계측 가동 후 베이스라인으로 확정 — "베이스라인 먼저" 원칙).
+ - **net/raw 구분**: 게이트 판정은 **net(=벽시계 - 429 백오프 sleep)** 기준. raw는 외부 쿼터 알람용 동시 노출. raw p95 > net p95 ×1.5 → 외부쿼터 WARN(§5 신선도축 라우팅).
+ - **카테고리별 변형**: intent×engine 조합으로 세분화(p95_gate_synthesis §2). brain/web_search 경로는 별도 임계 7000ms, 핵심 SLO 위반 카운트에 가중치 0.5.
+ - **평균 ≤ 2500ms** (outlier 감시용 신규) · **가용성 ≥ 99%** (`assistant_log.error=null` 비율, 24h 롤링).
+ - **러너 임계(δ-A)**: 평가셋 net p95 ≤3000 · sentinel ≤4000 · freevar ≤5000(DoD). sentinel 임계가 카테고리 SLO보다 엄격할 때는 sentinel 우선(동일 케이스 적용 시).
+ - **운영 윈도우**: 5분 롤링(알람) · 24h 롤링(SLO 보고). 평가 라운드(37~39분) 진행 중 L3 발송 정지(억제).
```

#### 1.3 §2 (c) 측정 방법 — 추가 3줄

```diff
  - 지연: 평가 러너가 케이스별 ms 집계 → p50/p95/평균 산출. 자유변칙 게이트에 p95 임계 판정 포함.
  - 토큰: **(예정)** synth/planQuery 응답에 `usageMetadata`(prompt/candidates/total) 노출 → 러너 누적.
+ - **net/raw 동시 산출**: 러너가 케이스별 `pure_ms`(=net), `backoff_ms`(429 sleep), `raw_ms = pure_ms + backoff_ms` 적재 → 분위수는 각각 직접 계산(**분위수의 합 금지**). 합성 분위수 사용 시 통계 부정확.
+ - **assistant_log v1.1 스키마 확장**: `pureLatencyMs`(=net) · `rawLatencyMs`(=벽시계) · `backoffMs` 3 필드. 기존 `latencyMs` 는 raw 별칭으로 유지(하위 호환). `net = rawLatencyMs - backoffMs` 파생 가능하지만 합산 정확도 위해 `pureLatencyMs` 직접 저장.
+ - **런타임 측정 대시보드**: `/api/admin/ai` 카드 = 5분 윈도우 net/raw p95 + INFO/WARN/CRIT 배지(p95_gate_alarm_policy.md §2).
```

#### 1.4 §2 (e) 위반 시 조치 — 교체

```diff
- - p95 > 5000ms → 원인 분리(외부 API 지연 vs 자체 로직 vs 임베딩). 외부의존이면 신선도축(§5)으로, 자체면 web_search 폴백 절제·임베딩 타임아웃 조정.
- - 토큰 상한 초과(임계 확정 후) → 다이제스트 주입량·컨텍스트 길이 절감.
+ - **CI(머지 전)**: sentinel-gate 위반(net p95>4000, PASS<16/20, CoT≥1, 환각≥1) → exit 1 → PR block. freevar-nightly DoD(자유변칙 ≥85%·직군 ≥70%·카테고리 ≥70%·환각 ≤2·net p95 ≤5000) 위반 → dashboard 알림 + 3일 연속 시 `freevar-blocked` 라벨.
+ - **런타임(머지 후)**: net p95>5000ms (5분 윈도우) → 등급 산출(INFO 4000~5000 / WARN 5000~6000 / CRIT >6000 또는 위반비율>15%). CRIT 3분 미해소 → **자동 강등 시퀀스** `WEB_SEARCH_OFF` → `THINKING_BUDGET=0` → `BRAIN_OFF` (각 5분 관찰, 상세 p95_gate_rollback_runbook.md §2).
+ - **강등으로 미해소**: webhook `violators_top3` + `recent_merges` 로 triage → `git bisect` + sentinel 20케이스(≤3분)로 회귀 커밋 식별 → `git revert <SHA>` + **회귀 가드 sentinel 영구 추가**(p95_gate_rollback_runbook.md §3).
+ - **raw p95 > net p95 ×1.5** → 외부 쿼터 WARN, §5 신선도축 운영 라우팅(코드 회귀 아님).
+ - **외부의존 spike(sentinel)** → `MARINE_DISABLE=1` + SKIP 라벨로 soft fail.
+ - 토큰 상한 초과(임계 확정 후) → 다이제스트 주입량·컨텍스트 길이 절감.
```

#### 1.5 §7.1 SLO 실측 정합성 — 결론 교체

```diff
- 결론: 임계값 자체(5000ms)는 평가셋 실측과 정합하나, 게이트 판정 대상인 자유변칙 p95는 현재 초과 상태이며 (a)러너의 백오프-제외 집계 구현 (b)자유변칙 v4 재측정 둘 다 완료해야 달성 여부를 확정할 수 있다. "백오프 노이즈" 주장은 아직 미검증 가설로, 초과 갭을 해소된 것으로 간주하지 않는다.
+ 결론: 임계값(5000ms)은 평가셋 실측과 정합. 자유변칙 raw p95 6712ms 미해소는 (a) 러너 net/raw 분리 측정(δ-A 시점, `delta_runner_A_impl.md`) + (b) 자유변칙 v4 재측정 후 **net 값으로 판정**. 운영 단계에서는 net/raw 동시 노출(p95_gate_synthesis §4) + net 위반은 §3 자동 강등→revert SOP(p95_gate_rollback_runbook.md) + raw 위반(외부 쿼터)은 §5 신선도축 라우팅. **"백오프 노이즈" 가설은 δ-A 측정 결과로 검증/기각**: net ≤ 5000 → 확정, net > 5000 → 기각하고 자체 로직 패치 사이클로 전환.
```

#### 1.6 §7.3 DoD 표 p95 행 + 환각 행 비고 — 교체

```diff
- | p95 ≤5000ms | 자유변칙 v2 6712ms(평가셋 4.7k) | **+1712ms 초과** · 백오프-제외 집계+v4 재측정 필요 | 2.비용/지연 |
+ | net p95 ≤5000ms | raw 6712ms / net [δ-A 측정 후] | net 산출 후 판정. CI sentinel-gate(≤4000) + freevar-nightly(≤5000) 게이트화 완료 + 런타임 3계층 알람·자동강등·revert SOP 정책화 완료(p95_gate_synthesis · p95_gate_alarm_policy · p95_gate_rollback_runbook). | 2.비용/지연 |
```

#### 1.7 §8 변경 이력 1줄 추가 (의사코드)

```diff
+ | 2026-06-04 | **δ 옵션 적용**: 시점 A(러너 net/raw 분리 patch — `delta_runner_A_impl.md`) + 시점 B(cross_cutting 6곳·assistant_log v1.1·알람 SOP·롤백 SOP — `delta_ops_B_impl.md`). p95 게이트 통합 운영 문서(`p95_gate_synthesis.md`) 반영. |
```

---

### 2. assistant_log_schema.md v1.1 patch 의사코드

> 본 patch 는 §2.1 JSON Schema + §2.2 매핑표 + §6.2 프라이버시 재확인 + §8(신설) 마이그레이션 v0→v1→v1.1 셋을 묶는다. **기존 v1 필드는 보존**(상위집합), `latencyMs` 의미만 명확화.

#### 2.1 §2.1 JSON Schema diff (v1 → v1.1)

```diff
   "schemaVersion": { "type": "integer", "const": 1 },
+  "schemaVersion": { "type": "integer", "enum": [1, 2], "description": "v1=기존, v2=net/raw 분리(=v1.1 호환 별칭). 본 문서에서 v1.1 = schemaVersion 2." },
   ...
   "latencyMs": { "type": ["integer", "null"], "minimum": 0,
-                  "description": "요청 수신→응답 직전 경과(ms)." },
+                  "description": "요청 수신→응답 직전 경과(ms) = 벽시계(raw). v1.1부터 rawLatencyMs 별칭 권장. net 산출 = latencyMs - backoffMs (또는 pureLatencyMs 직접 저장)." },
+  "rawLatencyMs": { "type": ["integer", "null"], "minimum": 0,
+                  "description": "v1.1 신규. latencyMs 와 동의어(벽시계). 둘 중 하나 채우면 됨 — 둘 다 있으면 동일 값이어야 함(스키마 외 검증). 권장: rawLatencyMs 사용, latencyMs 는 하위 호환 별칭." },
+  "pureLatencyMs": { "type": ["integer", "null"], "minimum": 0,
+                  "description": "v1.1 신규. 백오프 sleep 제외한 마지막 성공 시도 latency = net. pureLatencyMs ≡ rawLatencyMs - backoffMs. 분위수의 합 금지 원칙상 직접 저장 권장(파생 계산은 합산 정확도 손실)." },
+  "backoffMs":   { "type": ["integer", "null"], "minimum": 0,
+                  "description": "v1.1 신규. 429 등 백오프로 인한 누적 sleep(ms). 백오프 없으면 0. raw - backoffMs = net. p95 게이트 판정 대상은 net(=pureLatencyMs)." },
   "tokenUsage": { ... 기존 그대로 ... },
   "engine": { ... 기존 그대로 ... },
```

#### 2.2 §2.2 필드 출처 매핑 추가 3행

```diff
  | `latencyMs` | 핸들러 진입 `t0`와 push 시각 차 (신규 계측) |
+ | `rawLatencyMs` | `latencyMs` 와 동일(t0→push) — 별칭. 신규 코드는 이쪽 권장. |
+ | `pureLatencyMs` | gemini_client.js 가 최종 성공 시도 latency 를 별도 누적해 전달(`assistant.js` 핸들러에 propagate). 백오프 sleep 미포함. |
+ | `backoffMs` | gemini_client.js 백오프 sleep 누적(429 4s/9s/16s 합) → 핸들러에서 누적. 다중 도구 호출 시 모두 합산. |
  | `tokenUsage` | `obj.data?.usage` (token_metering v2 적용 후) |
```

#### 2.3 §6.2 프라이버시 재확인 — 신규 필드 안전성 1줄 추가

```diff
+ - v1.1 신규 3 필드(`rawLatencyMs`/`pureLatencyMs`/`backoffMs`) 는 모두 **순수 시간 측정값(int ms)** → PII 무관, 불변식 영향 없음. additionalProperties:false 그대로 적용.
```

#### 2.4 §8 마이그레이션 (신설)

```diff
+ ## 8. 마이그레이션 v0 → v1 → v1.1
+
+ | 단계 | 변경 | 호환 |
+ |------|------|------|
+ | v0 → v1 | 6필드(ts, query, answer, zone, intent, aiUsed, tools) → 14필드 + schemaVersion=1. tools null → []. focus rankedItems 제거. | 상위집합. 구레코드는 schemaVersion 부재 = v0 로 읽고 누락 필드 null 채움. |
+ | v1 → v1.1 | `latencyMs` 의미 명확화(=raw 별칭) + `rawLatencyMs`/`pureLatencyMs`/`backoffMs` 3필드 신설. schemaVersion=2. | 상위집합. 구 v1 레코드(backoffMs 부재)는 net = latencyMs - 0 = latencyMs 로 간주(보고 시 "backoff 미계측" 라벨 노출). 신규 레코드는 backoffMs 필수 채움(0 포함). |
+
+ **선행 의존**: gemini_client.js 백오프 누적 계측 필요(현재 sleep 호출 시점에 누적 변수 미존재). assistant.js 핸들러가 누적값을 push 호출에 전달하는 코드 1줄 추가.
```

---

### 3. 알람 정책 SOP 신규 md (`p95_gate_alarm_policy.md`) 골자

> 본 디렉터리에 신규 md 생성 — 본 문서(delta_ops_B_impl.md)는 그 골자를 의사코드로만 제시(실제 파일은 별도 PR). 골자는 B §2 + synthesis §3 결합.

```markdown
# p95 게이트화 — 운영 알람 정책 SOP

## 0. 적용 범위
런타임(머지 후) `/api/assistant/ask` 모든 호출. CI(머지 전) 게이트는 `sentinel_gate_synthesis.md` 참조.

## 1. 알람 채널 3계층
| 계층 | 채널 | 트리거 | SLA |
|------|------|--------|-----|
| L1 | `/api/admin/ai` 대시보드 배지 (5초 폴링) | INFO/WARN/CRIT 발생 즉시 | 영업시간 30분 |
| L2 | `logs/assistant/alerts.ndjson` 큐 (append-only) | WARN/CRIT 모두 기록 | 일 1회 점검 |
| L3 | Slack/이메일 webhook (후보) | **CRIT만** 발송 | 즉시 |

## 2. 위반 등급 (5분 윈도우)
| 등급 | 조건 | 채널 |
|------|------|------|
| **INFO** | net p95 4000~5000ms (임계 80~100%) | L1 노란 배지 |
| **WARN** | net p95 5000~6000ms 또는 위반비율 5~15% | L1 빨강 + L2 큐 |
| **CRIT** | net p95 >6000ms 또는 위반비율 >15% 또는 가용성 <95% 또는 토큰 비용 시간당 $0.50 초과 | L1 + L2 + **L3** |

raw p95 > net p95 ×1.5 → WARN(외부쿼터), 신선도축(cross_cutting §5)으로 라우팅.

## 3. 윈도우 선정
5분: 1분은 노이즈, 1시간은 반응 지연 → 절충. 자유변칙 평가 라운드(37~39분)는 라운드 종료 시 1회 일괄 판정.

## 4. webhook 페이로드 스펙
```json
{
  "level": "CRIT",
  "ts": <epoch_ms>,
  "metric": "latency_p95_net",
  "value_ms": <int>,
  "threshold_ms": 5000,
  "window": "5m",
  "violators_top3": [{"intent":..., "engine":..., "p95_ms":..., "n":...}, ...],
  "recent_merges": ["<sha> <subject>", ...],
  "dashboard_url": "...",
  "runbook_url":   "p95_gate_rollback_runbook.md"
}
```

## 5. 알람 억제(Suppression)
- 연속 동일 CRIT 30분 1회(같은 metric + 같은 violators_top1).
- 외부 의존 장애 비율 50% 초과 시 WARN으로 강등.
- 자유변칙 평가 라운드 진행 중 L3 발송 정지(L1/L2 만).
- 야간/주말 INFO 자동 묶음(일 1회 요약).

## 6. CI vs 런타임 책임 경계
- CI(`sentinel_gate_synthesis.md`): 머지 전 회귀 차단, 결정론·외부 SKIP.
- 런타임(본 문서): 머지 후 실 트래픽 + 외부 의존 포함 5분 윈도우.
- 공통: sentinel 20케이스 재사용(CI=PR차단, 런타임=bisect 진단).

## 7. Hard block vs CRIT
Hard block(보안 불변식, cross_cutting §6) > CRIT(성능). 동시 발생 시 보안 우선.
```

---

### 4. 롤백 절차 신규 md (`p95_gate_rollback_runbook.md`) 골자

```markdown
# p95 게이트화 — 롤백 Runbook (env 자동강등 → bisect → revert → 회귀가드)

## 0. 전제
CRIT 진입 후 3분 내 해소 안 됨. webhook payload(`alarm_policy §4`)는 이미 수령.

## 1. 최근 머지 PR 식별 (자동)
```bash
git log --since="24 hours ago" --merges --pretty=format:"%h %s" -- \
  routes/assistant.js services/gemini_client.js services/assistant_log.js \
  knowledge/phases/phase2b_eval_runner.py knowledge/phases/phase2b_eval_freevar_runner.py
```
top3 → webhook `recent_merges` 동봉.

## 2. 자동 강등 시퀀스 (재시작 없이 env 플래그만)
| 단계 | 플래그 | 효과 | 관찰 |
|------|--------|------|------|
| ① | `WEB_SEARCH_OFF=1` | gemini-2.5-flash web_search 차단 → synth만 | 5분 |
| ② | `THINKING_BUDGET=0` | thinkingConfig.thinkingBudget=0 (사고 토큰 차단) | 5분 |
| ③ | `BRAIN_OFF=1` | runBrain 무효화 → 결정론 폴백만 | 5분(최후수단) |

추가:
- `EXPOSE_TOKEN_USAGE=1` (디버깅, token_metering §3 기존).
- `SYNTH_TEMP_FLOOR=0.0` (재현성↑·캐시히트↑).

각 단계 후 net p95 5분 윈도우 재계산. 해소되면 stop, 아니면 다음 단계.

## 3. 수동 롤백 (강등 미해소 시)
1. **분리(triage)**: webhook `violators_top3` 의 intent/engine 으로 회귀 범위 좁힘.
2. **PR 식별**: §1 명령 + `git bisect` + `phase2b_sentinel.jsonl` 20케이스 (≤3분).
3. **revert**: `git revert <SHA>` (merge 는 `-m 1`). 신규 PR로 머지.
4. **회귀 가드(필수 통과)**:
   - `phase0_runner.py` 골든 0F (cross_cutting §1 (e))
   - `phase2b_sentinel.jsonl` 20케이스 ≤3분 (cross_cutting §1 (c))
   - 자유변칙 v4 직군 floor 회귀 없음 (이전 sentinel 결과 대비 -2%p 이상 하락 금지)
5. **사후(postmortem)**: `logs/assistant/postmortems/YYYY-MM-DD-<sha>.md` (원인·갭·재발방지·SLO 영향).

## 4. 회귀 가드 영구 추가
revert 후 재발 시:
- `phase2b_sentinel.jsonl` 에 회귀 케이스 반영구 추가(cross_cutting §1 평가셋 보강).
- CI 게이트가 머지 PR 차단에 sentinel net p95 ≤5000ms 필수 통과로 강제(builder_ci_design.md 연계).

## 5. 보안 불변식 vs 성능 CRIT
보안(Hard block, cross_cutting §6) 발생 시: 본 runbook 정지, 보안 절차 우선.

## 6. 강등 자동화 단계 (롤아웃)
첫 1주: §2 시퀀스는 **수동 트리거**(운영자 승인 후 env 변경).
안정화 후: 자동화 — CRIT 3분 미해소 감지 시 자동 강등.
```

---

### 5. 적용 순서 (5단계 롤아웃, synthesis §7 따름)

> 각 단계 독립 PR. N 완료 후 N+1. 단계 1·2(δ-A 영역)는 별도 PR(`delta_runner_A_impl.md`).

| 단계 | 작업 | 산출물 | 비고 |
|------|------|--------|------|
| **1** | **러너 패치(δ-A)** | `phase2b_eval_runner.py` + `phase2b_eval_freevar_runner.py` net/raw 분리. env 임계 5종(EVAL/SENTINEL/FREEVAR/RAW_RATIO/DOD_*). | 본 문서 외부. `delta_runner_A_impl.md`. |
| **2** | **측정(베이스라인)** | 자유변칙 v4 + 평가셋 v4 각 1회 실행 → net p95 산출. 결과를 §1.1·§1.6 [δ-A 시점] 자리에 반영할 데이터로 정리(이 시점엔 미반영). | 분기: net ≤5000 → 백오프 노이즈 가설 확정·DoD 달성 선언. net >5000 → 가설 기각, 자체 로직 패치 사이클(임베딩·합성비용 절감) 진행. |
| **3** | **cross_cutting.md 갱신** | 본 문서 §1.1~§1.7 단일 PR로 적용. §1.6 DoD 행은 단계 2 측정 결과 반영. §1.7 변경이력 1줄 추가. | 측정 없이 갱신 금지 — 임계 락 위험. |
| **4** | **런타임 알람 활성화** | (a) env 플래그 5종 신설(`BRAIN_OFF`/`WEB_SEARCH_OFF`/`SYNTH_TEMP_FLOOR`/`THINKING_BUDGET`, 기존 `EXPOSE_TOKEN_USAGE` 재사용). (b) `assistant_log` v1.1 적용(본 문서 §2). (c) gemini_client.js backoff 누적 기록. (d) `/api/admin/ai` 5분 윈도우 net/raw p95 카드 + 배지. (e) L2 큐 `logs/assistant/alerts.ndjson` 적재. (f) L3 webhook 후보 스펙(스킬 §4)은 운영 위원회 결정 후. (g) 자동 강등 시퀀스 코드화하되 첫 1주 수동 트리거. | `p95_gate_alarm_policy.md` 신규 + `p95_gate_rollback_runbook.md` 신규. |
| **5** | **CI 게이트화** | `.github/workflows/ci.yml` 에 `sentinel-gate`(PR 차단) + `freevar-gate-nightly`(스케줄, PR 비차단). 브랜치 보호: sentinel-gate = required status check. 첫 1주 `continue-on-error: true`(위양성 모니터), 이후 hard 차단. | 마지막 — 가장 영향 큼. 베이스라인·알람 데이터 충분 확보 후. |

#### 5.1 적용 순서 근거

- 1·2 먼저: 측정 없이 정책 명문화하면 임계 락이 잘못될 위험.
- 3 다음: 측정 기반 임계 확정 후 단일 진실 확보.
- 4 → 5: 런타임 알람이 먼저 정착해야 CI 게이트 위양성 시 운영팀 우회 절차 명확.
- 5 마지막: PR 차단 영향 최대 → 베이스라인·알람 충분 후.

#### 5.2 단계별 책임주체

| 단계 | 주체 | 검수 |
|------|------|------|
| 1·2 | 나리야팀(러너·측정) | δ-A 담당자 |
| 3 | 나리야팀(문서) | 사장님(요약표·DoD 변경 확인) |
| 4 | 나리야팀(서버·스키마) + 운영(L3 채널 결정) | 운영 위원회 |
| 5 | 나리야팀(CI) + 머지 책임자(브랜치 보호) | 사장님(required check 등록 승인) |

---

### 6. 자체 검토

- **R2 검수(cross_cutting 2026-06-03)와의 정합**: §7.1/§7.3 결론에서 "백오프 노이즈"를 미검증 가설로 강등한 R2 상태를 유지 → 본 patch §1.5 결론은 "δ-A 측정으로 검증/기각" 으로 명확히 분기 명시. R2 강등 취지 보존.
- **분위수 합산 함정**: assistant_log v1.1 에서 `pureLatencyMs` 를 별도 저장하는 이유 = `latencyMs - backoffMs` 도 case 단위로는 동일하지만, **합산 단계에서 케이스별 net 을 따로 집계해야 분위수 정확** → 저장 단계에서 미리 분리 보장(합의 분위수 ≠ 분위수의 합).
- **환각 행과 무관**: cross_cutting §7.3 환각 ≤2 행은 본 patch 범위 밖(신선도+프라이버시 축). 손대지 않음.
- **신규 md 1개 제약**: 본 문서 `delta_ops_B_impl.md` 만 신규. 알람 SOP·롤백 runbook 의 골자는 §3·§4 내부에 의사코드(```markdown 블록)로 포함 — 별도 파일 생성은 단계 4 PR 에서.
- **하위 호환**: assistant_log v1 → v1.1 은 상위집합. 구레코드는 backoffMs 부재로 net = latencyMs 간주(보고 시 "backoff 미계측" 라벨). 신규 코드는 schemaVersion=2 + backoffMs 필수(0 포함).

---

### 7. 한 줄 요약

cross_cutting 6곳 + assistant_log v1.1(`backoffMs`/`pureLatencyMs`/`rawLatencyMs` 분리) + 알람 SOP(L1/L2/L3·INFO/WARN/CRIT·5분 윈도우) + 롤백 Runbook(env 자동강등 3단계 → bisect → revert → 회귀가드 sentinel 영구 추가) 의 patch 의사코드를 5단계 롤아웃(러너 → 측정 → 문서 → 알람 → CI) 순서로 묶었다.
