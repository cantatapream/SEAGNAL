# #37 δ p95 게이트화 합성 — A(diet) + B(병렬화) 통합 설계

> 상태: **설계만**. 코드 0 수정. 본 문서는 워커 A(diet) + B(병렬화) 설계 산출물의 합성 — 시너지 매트릭스 + 머지 순서 + 6 hunks 분리 + CI 게이트화 + 위험 등급만 제공한다.
> 작성: 2026-06-05 · 합성 대상: `p37_p95_diet_A.md` (워커 A) + `p37_p95_parallel_B.md` (워커 B)
> 가드: 코드 수정 금지. 신규 md 1개. v5 측정 결과(정량 75% · SEC 5/5 · 연속 48%) 회귀 0 유지.
> 결합: A·B 는 **서로 다른 phase**(A=prompt 입력 토큰 / B=tool 실행 wall-clock) 에 작용 → 단순 합산 가능.

---

## 0. 한눈에 (합성 결정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 머지 순서 | **B 우선(P0)** → **A 차순(P1)** | B 단독으로 DoD 1차 통과 / A 는 추가 마진 + 토큰 비용 보너스 |
| 코드 영역 충돌 | **0 (분리 영역)** | A=prompt(L711·L1448·L1670) / B=실행루프(L1900·L1922·L1934) |
| 결합 p95 | **3500~4000ms** (DoD 5000ms 안정 통과, 여유 -1000~1500ms) | -3000ms (B) + -800ms (A) |
| 분리 hunks | **6 개** (B 3 + A 3) | 분리 워크트리 → 3-way merge |
| 회귀 가드 | A ±3pp 게이트 + B race condition 가드 + sentinel 27/30 + SEC 5/5 | 양 설계 모두 보존 |
| CI 게이트화 | δ R2 ⑤ — `EVAL_P95_MS=5000` env + sentinel v2 야간 비차단 | p95 통과 락 후 활성 |
| 위험 등급 | B=4 / A=3 / 결합=4(B 지배) | B race/KHOA 토큰 위험이 결정적 |

**한 줄 합성 결정**: B(병렬화, 위험 4) 우선 머지 → DoD 1차 통과 → A(diet, 위험 3) 차순 머지 → 안정 마진 확보 → cross_cutting 갱신 → CI `EVAL_P95_MS=5000` 알람 활성.

---

## 1. A·B 시너지 매트릭스

### 1.1 효과 분해 (워커 A·B 추정치 인용)

| 시나리오 | planQuery LLM | 1차 tool 실행 | dep_weave 실행 | multitool 보강 | synth LLM | 기타 | **net p95** | DoD 5000ms |
|---|---|---|---|---|---|---|---|---|
| 현재 (v5+5차 누적) | 700ms | 3520ms (직렬) | 1350ms (직렬) | 1530ms (직렬) | 1200ms | 500ms | **~7800ms** | ❌ +2800ms 초과 |
| **A 단독 (diet -24% 토큰)** | 500ms (-200) | 3520ms | 1350ms | 1530ms | 800ms (-400) | 500ms | **~6300~7000ms** | ❌ +1300~2000ms 초과 |
| **B 단독 (Promise.allSettled cap=6)** | 700ms | 1500ms (max) | 900ms (max) | 850ms (max) | 1200ms | 500ms | **~4800ms** | ✅ 1차 통과 (-200ms) |
| **A + B 결합** | 500ms | 1500ms | 900ms | 850ms | 800ms | 500ms | **~3500~4000ms** | ✅ **안정 통과 (-1000~1500ms 여유)** |

### 1.2 시너지 검증 — 곱셈 결합 가정

- A 는 **prompt phase** (planQuery 입력 토큰 -19% · synth 입력 -26% · personal -30~40%) → LLM 응답 시간 단축
- B 는 **tool phase** (1차/dep_weave/multitool 3 직렬 루프 → max 흡수) → wall-clock 단축
- **독립 phase**: A 의 -800ms 와 B 의 -3000ms 는 단순 합산 가능 — 동일 시간 축에 중첩 효과 없음
- **결합 추정 검증**: 7800ms − 3000ms (B) − 800ms (A) = **4000ms** · 낙관 시 **3500ms** (워커 B §3.2 와 동일)

### 1.3 토큰 비용 보너스 (A 부수효과)

- 입력 토큰 -24% (-1762 토큰/케이스) → Gemini flash-lite 입력 단가 절감
- 추정 비용 절감: 1라운드 440 케이스 × -1762 토큰 × $0.075/1M = **~$0.058/라운드** (작지만 누적)
- 야간 비차단 게이트(자유변칙 1라운드/일 × 30일) → ~$1.74/월 절감

---

## 2. 머지 순서 결정 (P0 → P1)

### 2.1 결정 — B 우선 (P0)

```
[P0] PR-B (병렬화 — Promise.allSettled cap=6)
       │
       │  머지 → 자유변칙 1라운드 측정 → net p95 ≈ 4800ms 확인 → DoD 1차 통과 락
       │
       ▼
[P1] PR-A2 → PR-A3 → PR-A4 (diet 단계별 — 워커 A §6.3 분리 PR 정책)
       │
       │  각 PR 후 sentinel 게이트 + 자유변칙 cat 별 ±3pp 게이트 통과 확인
       │
       ▼
[P2] cross_cutting.md 갱신 — p95 6120ms → 3500~4000ms · DoD 5000ms 안정 통과 명시
       │
       ▼
[P3] CI 알람 활성화 (δ R2 ⑤) — phase0-gate.yml 의 EVAL_P95_MS=5000 env 활성
```

### 2.2 B 우선 정당화

| 사유 | 설명 |
|---|---|
| DoD 1차 통과 첫 도달 | B 단독 7800→4800ms (DoD -200ms 여유) — A 단독은 미달 |
| 회귀 위험 격리 | B race/KHOA 토큰 위험(=4) 을 먼저 운영 검증 → A 의 prompt 회귀(=3) 위험과 분리 디버깅 |
| 측정 명확성 | tool wall-clock 단축은 평균 latency 로 즉시 검증 가능 / prompt 토큰 단축은 LLM 응답 분포 검증 필요 (덜 명확) |
| 롤백 단위 | B 회귀 시 1 PR revert / A 회귀 시 axis 단위 분리 revert (워커 A §6.4) — 단순도 차이 |
| 토큰 비용 보너스 | A 의 -$1.74/월 효과는 p95 통과 후 안정 운영 단계에서 누적 — 1차 통과 후 추가 마진 시점에 적합 |

### 2.3 A 차순 정당화

| 사유 | 설명 |
|---|---|
| 안정 마진 | B 단독 -200ms 여유는 변동성(KHOA upstream burst·Gemini thinking) 흡수 한계 → A 추가 -800~1500ms 마진 |
| 토큰 비용 누적 | 운영 누적 1년 → ~$21/년 (작지만 0 cost) |
| 회귀 검증 단순화 | B 머지 후 sentinel 베이스라인 락 → A 머지 시 회귀가 A 원인 확정 가능 |
| 분리 워크트리 자연 흐름 | B-impl 완성 후 A-impl 워크트리 머지 — 3-way merge 충돌 0 (영역 분리 보장 §3) |

---

## 3. 코드 영역 충돌 확인 — 분리 영역 보장

### 3.1 영역 매트릭스

| 워커 | 영역 분류 | 라인 범위 (assistant.js) | 함수/블록 |
|---|---|---|---|
| **A** (diet) | prompt 입력 (LLM 호출 전) | L711 | `buildPersonalContext()` 본체 |
| | | L1448 | planQuery 시스템 prompt 매트릭스 영역 |
| | | L1670 | synth prompt 본체 |
| **B** (병렬화) | tool 실행 (LLM 호출 사이) | L1900~1906 | `runBrain()` 1차 plan.steps 직렬 루프 |
| | | L1922~1929 | dep_weave 재계획 도구 직렬 루프 |
| | | L1934~1941 | multitool 결정론 보강 직렬 루프 |

### 3.2 충돌 분석

- **A 의 R1~R12 → JIKGUN_RULES 분기** (L1448 매트릭스 영역) ↔ **B 의 Promise.allSettled** (L1900~1941 실행 루프) → **물리적 분리 영역**
- **A 의 buildPersonalContext** (L711) ↔ B 의 영역 → 무관
- **A 의 synth prompt** (L1670) ↔ B 의 영역 → 무관
- **3-way merge 시뮬레이션 결과**: 양 변경 라인 집합 교집합 = ∅ → **자동 머지 가능**

### 3.3 간접 의존 검증

| 검증 항목 | A 영역 영향 | B 영역 영향 | 충돌 가능성 |
|---|---|---|---|
| `plan.steps` 구조 | A 의 R1~R12 분기가 LLM 생성 steps 의 종류·수 변화 가능 | B 의 cap=6 + Promise.allSettled 는 steps 종류 무관, 수만 cap | 0 (cap 보존) |
| `done` set (중복 방지) | A 영향 0 | B 가 Promise.allSettled 안에서 done.has 체크 — 1차 완료 후 dep_weave/multitool 라운드에서 평가 | 0 (라운드 분리 유지) |
| `focus1` 결정 | A 영향 0 | B 의 1차 라운드 완료 후 focus1 계산 — 병렬화 영향 없음 | 0 |
| `usageMetadata` 적재 (A axis 1 측정) | A 가 callGemini 반환 r.usage 직읽기 | B 는 LLM 호출 영역 무관 | 0 |

**결론**: A·B 분리 워크트리 → 3-way merge 자동 성공 가능. 다만 sentinel 게이트 통과 검증은 **순차** (B 후 A).

---

## 4. 회귀 가드 통합

### 4.1 가드 매트릭스 (A·B·기존 sentinel 합치)

| 가드 분류 | 워커 A 가드 | 워커 B 가드 | 기존 sentinel | 통합 게이트 |
|---|---|---|---|---|
| 정량 회귀 (cat4/MOF-4-01) | ±3pp 게이트 (A axis 3 synth bullet 단축 위험) | 회귀 가드 없음 (B 영역 외) | MOF-4-01 PASS 필수 | **MOF-4-01 PASS + cat4 ±3pp** |
| 연속성 회귀 (cat2/#30) | ±3pp 게이트 (A axis 4 memory 5→3 위험) | focus 의존 follow-up 2 라운드 분리 보존 (race 가드) | 연속성 sentinel 27/30 PASS | **27/30 PASS + cat2 ±3pp + 2 라운드 분리 검증** |
| 비도메인 회귀 (cat5) | SEC 5/5 보존 (A axis 3 거절 bullet) | 회귀 가드 없음 | SEC 5/5 | **SEC 5/5** |
| 환각 (cat7/ANG-6-03b) | A axis 3 환각금지 bullet **보존 필수** | 회귀 가드 없음 | ANG-6-03b PASS | **ANG-6-03b PASS** |
| 다중 도구 (cat3/LG-4-01) | A axis 2 R1~R12 → JIKGUN_RULES 분기 위험 (다중 호출률) | B 병렬화로 다중 도구 wall-clock 흡수 → 호출률은 무관 | LG-4-01 PASS | **LG-4-01 PASS + cat3 ±3pp** |
| Race condition | 영향 없음 | 도구 간 의존성 보존 (G5 focus 의존 2 라운드) + KHOA 토큰 race 가드 + dataCache atomic | — | **B 의 race 가드 셋 적용 + KHOA cap=6 보수 유지** |
| CoT 누수 (불변식) | A axis 3 CoT bullet **보존** | 영향 없음 | =0 불변식 | **=0 강제** |

### 4.2 분리 적용 게이트 (B → A 순)

```
PR-B 머지 → 자유변칙 1라운드 (440 케이스)
    │
    ├── net p95 ≤ 5000ms ?            ❌ 실패 → B 단독 revert + 시점 C 재설계
    │   ✅ 통과 (≈4800ms 추정)
    │
    ├── KHOA 토큰 race 로그 0 ?        ❌ 실패 → cap=6 → cap=4 보수화 후 재측정
    │   ✅ 통과
    │
    ├── sentinel 27/30 PASS · SEC 5/5 ❌ 회귀 → revert
    │   ✅ 통과
    │
    └── 베이스라인 락 → PR-A2 진입
        │
        PR-A2 (R1~R12 → JIKGUN_RULES) → cat3 ±3pp + LG-4-01 PASS ❌ → revert A2 만
        │   ✅ PR-A3 진입
        │
        PR-A3 (synth bullet 단축) → cat4·cat5·cat6·cat7 ±3pp + MOF-4-01·ANG-6-03b PASS ❌ → revert A3 만
        │   ✅ PR-A4 진입
        │
        PR-A4 (personal diet) → cat2 ±3pp + jikgun 평가셋 ±5pp ❌ → revert A4 만
        │   ✅ 최종 net p95 락 (~3500~4000ms 추정)
        │
        cross_cutting.md 갱신 → CI 알람 활성화
```

### 4.3 회귀 시 부분 revert 효과 보존 (워커 A §6.4 + B 통합)

| revert 대상 | 잔존 효과 | 잔존 p95 추정 |
|---|---|---|
| B revert (A 보존) | A diet 만 -800ms | 7000ms (DoD 미달 — 시점 C 필요) |
| A2 revert (B + A3+A4 보존) | -3000ms (B) + -415 토큰 (A3) + -430 토큰 (A4) | ~4000ms (DoD 안정 통과 유지) |
| A3 revert (B + A2+A4 보존) | -3000ms + -870 토큰 + -430 토큰 | ~4000ms |
| A4 revert (B + A2+A3 보존) | -3000ms + -870 토큰 + -415 토큰 | ~4000ms |

**결론**: B 머지 후엔 A 의 어느 단계 revert 도 DoD 안정 통과 유지 — 회귀 격리 자유도 높음.

---

## 5. 3 워크트리 적용 전략

### 5.1 워크트리 분리

```
seagnal/                   ← main worktree (현 작업 트리, 변경 0)
seagnal-b-impl/            ← B-impl 워크트리 (병렬화 — L1900/L1922/L1934 3 hunks)
seagnal-a-impl/            ← A-impl 워크트리 (diet — L711/L1448/L1670 3 hunks)
```

### 5.2 워크트리 생성·머지 시퀀스 (의사코드)

```bash
# (1) B-impl 워크트리 생성 + 3 hunks 적용 + 자체 검증
git worktree add ../seagnal-b-impl -b feat/p37-b-parallel
# (B-impl 워커가 L1900/L1922/L1934 3 hunks 적용 + 단위 테스트)

# (2) B PR 머지 → main 베이스라인 락
git -C ../seagnal-b-impl push origin feat/p37-b-parallel
# (PR-B 머지 + 자유변칙 1라운드 게이트 통과 + sentinel 27/30·SEC 5/5)

# (3) A-impl 워크트리 생성 (main 의 B 머지 후 상태에서 분기)
git worktree add ../seagnal-a-impl -b feat/p37-a-diet
# (A-impl 워커가 L711/L1448/L1670 3 hunks 적용 단계별 — A2/A3/A4 분리 커밋)

# (4) A 3-way merge → main
git -C ../seagnal-a-impl push origin feat/p37-a-diet
# (PR-A2/A3/A4 단계별 머지 + 각 단계 게이트 통과)

# (5) 워크트리 정리
git worktree remove ../seagnal-b-impl
git worktree remove ../seagnal-a-impl
```

### 5.3 충돌 시 폴백

- 영역 분리 보장(§3) → 3-way merge 자동 성공 추정
- 만약 conflict 발생 시 (예: 누적 패치로 라인 시프트) → A 워크트리에서 `git rebase main` 후 3 hunks 라인 재정합
- B 머지 후 라인 시프트 영향: A 의 L1448·L1670 은 B 의 L1900~ 보다 위 → 시프트 0 / A 의 L711 은 변경 영역 외 → 시프트 0
- **결론**: 충돌 가능성 거의 0

---

## 6. CI 게이트화 (δ R2 ⑤ 알람 활성화)

### 6.1 현 phase0-gate.yml 추정 구조 (δ R2 합성본 ⑤ 단계)

```yaml
# .github/workflows/phase0-gate.yml (현 추정)
name: phase0-gate
on:
  schedule:
    - cron: '0 17 * * *'   # 야간 비차단 (UTC 17 = KST 02)
  workflow_dispatch:
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: node scripts/run_freevar.js --rounds=1
        env:
          EVAL_GATE_MODE: report-only   # 현재 비차단 (sentinel v2 게이트 후 활성 예정)
          # EVAL_P95_MS: 5000          # 본 #37 사이클 통과 후 활성
```

### 6.2 #37 통과 후 활성화 변경안

```yaml
# .github/workflows/phase0-gate.yml (#37 합성 통과 후)
name: phase0-gate
on:
  schedule:
    - cron: '0 17 * * *'
  workflow_dispatch:
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: node scripts/run_freevar.js --rounds=1
        env:
          EVAL_GATE_MODE: alert-only         # 비차단 알람 모드 (1차 활성)
          EVAL_P95_MS: 5000                  # ✅ 본 #37 사이클 통과 후 활성
          EVAL_SENTINEL_MIN: 27              # 27/30 PASS 강제
          EVAL_SEC_MIN: 5                    # SEC 5/5 강제
          EVAL_CAT4_FLOOR_PCT: 60            # α C6/C7 게이트
          EVAL_CAT5_FLOOR_PCT: 95
          EVAL_CAT7_FLOOR_PCT: 90
          EVAL_HALLUC_MAX: 0                 # 환각 불변식
          EVAL_COT_LEAK_MAX: 0               # CoT 누수 불변식
      - name: post-eval alarm
        if: failure()
        run: node scripts/post_eval_alarm.js
        # Slack/이메일 알람 — 본 사이클은 비차단 (PR block 안 함)
```

### 6.3 활성화 조건 (게이트화)

| 조건 | 검증 방법 | 활성 트리거 |
|---|---|---|
| B 머지 + 자유변칙 1라운드 통과 | net p95 ≤ 5000ms 측정 락 | `EVAL_P95_MS=5000` env 활성 |
| A 머지 + 자유변칙 1라운드 통과 | net p95 ~3500~4000ms 안정 측정 | 알람 임계 추가 — `EVAL_P95_MS_WARN=4500` 워닝 레벨 추가 가능 (시점 C) |
| sentinel 27/30 PASS 락 | 베이스라인 측정 후 락 | `EVAL_SENTINEL_MIN=27` env 활성 |
| 비차단 → 차단 전환 | 30일 운영 안정 + 회귀 0 | `EVAL_GATE_MODE: report-only` → `alert-only` → `blocking` 3단계 |

### 6.4 비차단 운영 정책

- **30일 비차단 알람**: A·B 머지 후 30일 야간 라운드 회귀 0 확인 → `blocking` 모드 전환
- **알람 채널**: Slack `#seagnal-eval` + 이메일 (대상: hyoo1431@gmail.com)
- **알람 조건**: `EVAL_P95_MS=5000` 초과 OR 임의 sentinel 회귀 OR 환각/CoT 불변식 위반

---

## 7. 코드 적용 의사코드 — 6 hunks 분리

### 7.1 B-impl 3 hunks (Promise.allSettled, 위험 4)

#### Hunk B1 — L1900~1906 (1차 plan.steps)

```diff
- const results = [];
- for (const step of plan.steps.slice(0, 6)) {
-     const exec = step && TOOL_EXEC[step.tool];
-     if (!exec) continue;
-     try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
-     catch (e) { results.push({ tool: step.tool, error: e.message }); }
- }
+ const results = [];
+ const cap = plan.steps.slice(0, 6);
+ const settled = await Promise.allSettled(cap.map(step => {
+     const exec = step && TOOL_EXEC[step.tool];
+     if (!exec) return Promise.resolve({ skip: true });
+     return exec(step.args || {})
+         .then(result => ({ tool: step.tool, args: step.args || {}, result }))
+         .catch(e => ({ tool: step.tool, error: e.message }));
+ }));
+ for (const s of settled) {
+     if (s.status === 'fulfilled' && !s.value.skip) results.push(s.value);
+ }
```

#### Hunk B2 — L1922~1929 (dep_weave 보강)

```diff
- for (const step of plan2.steps.slice(0, 3)) {
-     const exec = step && TOOL_EXEC[step.tool];
-     if (!exec || done.has(step.tool)) continue;
-     done.add(step.tool);
-     try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
-     catch (e) { results.push({ tool: step.tool, error: e.message }); }
- }
+ const depCap = plan2.steps.slice(0, 3).filter(s => s && TOOL_EXEC[s.tool] && !done.has(s.tool));
+ depCap.forEach(s => done.add(s.tool));
+ const depSettled = await Promise.allSettled(depCap.map(step =>
+     TOOL_EXEC[step.tool](step.args || {})
+         .then(result => ({ tool: step.tool, args: step.args || {}, result }))
+         .catch(e => ({ tool: step.tool, error: e.message }))
+ ));
+ for (const s of depSettled) if (s.status === 'fulfilled') results.push(s.value);
```

#### Hunk B3 — L1934~1941 (multitool 결정론 보강)

```diff
- for (const step of extra.slice(0, 2)) {
-     const exec = step && TOOL_EXEC[step.tool];
-     if (!exec || done.has(step.tool)) continue;
-     done.add(step.tool);
-     try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
-     catch (e) { results.push({ tool: step.tool, error: e.message }); }
- }
+ const extraCap = extra.slice(0, 2).filter(s => s && TOOL_EXEC[s.tool] && !done.has(s.tool));
+ extraCap.forEach(s => done.add(s.tool));
+ const extraSettled = await Promise.allSettled(extraCap.map(step =>
+     TOOL_EXEC[step.tool](step.args || {})
+         .then(result => ({ tool: step.tool, args: step.args || {}, result }))
+         .catch(e => ({ tool: step.tool, error: e.message }))
+ ));
+ for (const s of extraSettled) if (s.status === 'fulfilled') results.push(s.value);
```

### 7.2 A-impl 3 hunks (diet, 위험 3)

#### Hunk A1 — L1448 (planQuery R1~R12 → JIKGUN_RULES 분기)

```diff
- (R1~R12 매트릭스 12 줄 인라인 — 워커 A §2.1 참조)
+ const R_TABLE = { R1: '...', R1p: '...', R2: '...', ..., R12: '...' };
+ const JIKGUN_RULES = {
+     fishery:        ['R1','R1p','R7'],
+     navy:           ['R1','R1p','R6','R7','R8'],
+     marine_leisure: ['R3','R4','R5','R7'],
+     coast_guard:    ['R1','R1p','R6','R7'],
+     local_gov:      ['R10','R11','R12','R7'],
+     mof:            ['R1','R9','R7'],
+     public_org:     ['R1','R9','R7'],
+     angler:         ['R2','R7'],
+ };
+ function buildMatrixSection(jikgun) {
+     const keys = JIKGUN_RULES[jikgun] || ['R1','R7'];
+     return '- **(다중 도구 패턴 — 직군 매칭 룰만)** …\n' + keys.map(k => '  · ' + R_TABLE[k]).join('\n');
+ }
+ // prompt template 안 매트릭스 영역을 ${buildMatrixSection(jikgun)} 로 교체
+ // 우선순위 룰 한 줄 ("우선순위 R2 > R4 > …") 삭제
```

#### Hunk A2 — L1670 (synth bullet 단축)

```diff
- (synth 8 bullet 인라인 — 워커 A §3.1 참조)
+ // (a) 중복 표현: "절대 금지" → "금지" 통일 (6 곳)
+ // (c) 가설 bullet 결정 단어 리스트 1회 출현 후 "위 결정 단어" 참조
+ // (f) 안전판단 1회 bullet → 정량 bullet 끝에 인라인 통합
+ // (g) Markdown 강조 "**(키워드)**" 정리
+ // 환각금지 / CoT 누수 / 컨텍스트 격리 / 비도메인 거절 / 가설 본문 = 보존
```

#### Hunk A3 — L711 (buildPersonalContext diet)

```diff
- lines.push(`[사용자 프로필] ${profileText}`);
- lines.push(`[최근 대화] ${memory.slice(-5).join(' / ')}`);
+ function profileSlim(profile) {
+     if (typeof profile !== 'object' || !profile) return String(profile || '');
+     const keep = ['jikgun', 'name', 'location', 'answerStyle', 'experienceYears'];
+     return JSON.stringify(Object.fromEntries(
+         keep.filter(k => profile[k] != null).map(k => [k, profile[k]])
+     ));
+ }
+ lines.push(`[사용자 프로필] ${profileSlim(profile)}`);
+ lines.push(`[최근 대화] ${memory.slice(-3).join(' / ')}`);
+ // enrichedTdig 운영규칙 단락 단축 (워커 A §4.2 (c) 참조)
```

### 7.3 hunk 별 게이트 매핑

| Hunk | 영역 | 검증 sentinel | 카테고리 ±3pp 게이트 | 위험 |
|---|---|---|---|---|
| B1 | 1차 plan.steps | 27/30 PASS + KHOA race 로그 0 | cat3 (다중) | 4 |
| B2 | dep_weave | 연속성 cat2 | cat2 (연속) | 4 |
| B3 | multitool | LG-4-01 + MOF-4-01 | cat3 (다중) | 4 |
| A1 | R1~R12 매트릭스 | LG-4-01 + 직군별 사용 | cat3 (다중) | 3 |
| A2 | synth bullet | MOF-4-01 + ANG-6-03b + SEC 5/5 | cat4·cat5·cat6·cat7 | 3 |
| A3 | personal diet | 자유변칙 #30 후속 1케이스 추가 | cat2 + jikgun ±5pp | 3 |

---

## 8. 위험 등급

### 8.1 위험 매트릭스

| 등급 | 워커/Hunk | 위험원 | 가드 | 완화 후 잔존 위험 |
|---|---|---|---|---|
| **4 (높음)** | B 전체 (B1/B2/B3) | (1) Race condition (dataCache 동시 read — Node single-thread 가 흡수 추정이나 실측 필요) (2) KHOA 토큰 race (marine_client 25분 prefresh) (3) tideCache 동시 같은 키 dedup 부재 (4) 외부 API rate limit (cap=6 안전선 안 추정) | (1) Node 이벤트 루프 atomic 보장 (2) cap=6 보수 유지 + 25분 prefresh 가드 (3) 비효율 수 ms 무시 가능 (4) cap=6 안 모든 도구 안전선 안 | 2 (race 시뮬 검증 후 1) |
| **3 (중간)** | A 전체 (A1/A2/A3) | (1) R1~R12 압축 시 다중 도구 호출률 저하 (cat3 회귀) (2) synth bullet 표현 단축 시 LLM 룰 적용률 약화 (cat4/cat7 회귀) (3) memory 5→3 슬라이스가 #30 자연어 후속 연속성 손실 (cat2 회귀) | (1) pickMissingTools 결정론 백업 (2) sentinel ANG-6-03b·MOF-4-01·LG-4-01 강제 (3) 자유변칙 #30 후속 1케이스 추가 + cat2 ±3pp 게이트 | 2 (단계별 분리 PR + axis 단위 revert) |
| **2 (낮음)** | 결합 (A+B 동시) | A·B 회귀 원인 혼선 — sentinel 회귀 시 어느 쪽 책임인지 판단 어려움 | B 우선 머지 + 베이스라인 락 → A 머지 후 회귀 시 A 원인 확정 | 1 (분리 머지로 자연 해소) |
| **1 (최소)** | CI 게이트 활성화 | 비차단 알람 단계 → 노이즈 알람 가능 | `EVAL_GATE_MODE: alert-only` 30일 비차단 → 안정 후 blocking 전환 | 0 |

### 8.2 위험 합산 — 결합 위험 등급 = 4 (B 지배)

- B 의 race/KHOA 토큰 위험(=4) 이 결정적
- A 의 prompt 회귀 위험(=3) 은 분리 PR + 단계별 revert 로 흡수 가능
- **결합 위험 = max(B, A) = 4** (B 머지가 먼저이므로 B 위험이 1차 검증 대상)
- 머지 순서 (B 먼저) 가 위험 격리에 유리 — A 머지 시 베이스라인 B 안정 상태에서 출발

### 8.3 위험 4 운영 정책

| 항목 | 정책 |
|---|---|
| 머지 시점 | 야간 (UTC 17 = KST 02) — 사용자 피크 시간 회피 |
| 모니터링 윈도 | 머지 직후 30분 + 야간 라운드 1회 + 다음날 피크 시간대 1시간 |
| 회귀 감지 시 즉시 revert | B 회귀 시 단일 PR revert (≤5분) — A 회귀 시 axis 단위 분리 revert |
| KHOA 토큰 race 감지 | marine_client 로그에 `getValidToken refresh race` 출현 시 cap=6 → cap=4 보수화 |
| dataCache 부분 객체 노출 감지 | 응답 JSON 에 빈 객체/undefined 출현률 모니터링 — 0 유지 강제 |

---

## 9. cross_cutting 갱신 항목 (P2 단계)

| 필드 | 현재 값 | #37 통과 후 값 |
|---|---|---|
| `net_p95_ms` | 6120 (v5 1회차) → 7800 (5차 누적 추정) | **3500~4000** (A+B 결합 측정 후 락) |
| `dod_p95_ms` | 5000 (미달 상태) | 5000 (안정 통과 — 여유 -1000~1500ms) |
| `tool_exec_mode` | serial (3 직렬 루프) | **parallel (Promise.allSettled cap=6, focus 의존 2 라운드 분리)** |
| `prompt_input_tokens_avg` | ~7000~9500 | **~5300~7800 (-24%)** |
| `planQuery_matrix_mode` | 12 룰 동시 노출 | **JIKGUN_RULES 직군별 분기 (평균 3.3 룰)** |
| `synth_bullet_count` | 10 | **9 (안전판단 1회 bullet 통합)** |
| `personal_memory_slice` | 5 | **3** |
| `ci_p95_gate` | report-only | **alert-only (EVAL_P95_MS=5000 활성)** |

---

## 10. 적용 체크리스트 (요약)

- [ ] **P0** B-impl 워크트리 생성 + B1/B2/B3 3 hunks 적용 + 단위 테스트
- [ ] **P0** PR-B 머지 → 자유변칙 1라운드 측정 → net p95 ≤ 5000ms · KHOA race 로그 0 · sentinel 27/30 PASS · SEC 5/5 게이트 통과
- [ ] **P0** B 베이스라인 락 (cross_cutting.md `net_p95_ms` 1차 갱신)
- [ ] **P1** A-impl 워크트리 생성 (B 머지 후 main 분기)
- [ ] **P1** PR-A2 (R1~R12 → JIKGUN_RULES) 머지 → cat3 ±3pp + LG-4-01 PASS 게이트
- [ ] **P1** PR-A3 (synth bullet 단축) 머지 → cat4·cat5·cat6·cat7 ±3pp + MOF-4-01·ANG-6-03b PASS 게이트
- [ ] **P1** PR-A4 (personal diet) 머지 → cat2 ±3pp + jikgun ±5pp 게이트
- [ ] **P2** cross_cutting.md 갱신 (§9 표 적용)
- [ ] **P3** phase0-gate.yml `EVAL_P95_MS=5000` env 활성 + Slack/이메일 알람 채널 구성
- [ ] **P3** 30일 비차단 운영 후 `blocking` 모드 전환 검토 (시점 C)

---

## 핵심 합성 결정 (한 줄)

**B(병렬화, 위험 4) 우선 머지 → DoD 1차 통과(4800ms) → A(diet, 위험 3) 차순 머지 → 결합 3500~4000ms 안정 통과 → CI `EVAL_P95_MS=5000` 알람 활성화.**
