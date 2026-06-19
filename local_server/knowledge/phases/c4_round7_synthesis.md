# C4 — 7차 라운드 통합 단일 PR 합성 설계 (C1 + C2 + C3)

> **상태**: 합성 설계 전용. 코드 수정 0건. 신규 md 1개 (본 파일).
> **목적**: C1(정량 룰 복구) · C2(multi-tool 룰 복구) · C3(NAV-2-01b 수정) 3개 산출물을 단일 PR 적용 가능한 4 hunks 매트릭스로 통합. 충돌 0건 확인 + 적용 순서 + 위험 등급 + 누적 응답시간/PASS% 예측.
> **입력**: `phases/c1_quant_restore_design.md` 안 (b) / `phases/c2_multitool_restore_design.md` 안 (c) / `phases/c3_nav_fix_design.md` 안 (a)+(b).
> **타깃 파일**: `local_server/routes/assistant.js` 단일 — 3-way merge 불요, 단일 worktree.

---

## 0. 한눈에 (통합 결정 + 결과 예측)

| 항목 | 합성 결과 |
|---|---|
| 충돌 hunks | **0건** (영역 분리 또는 의도 정합 확인 완료) |
| 적용 hunks 수 | **4** (H1=C2 / H2=C1 / H3=C3.b / H4=C3) |
| 토큰 누적 | **+280~330 토큰/케이스** |
| p95 누적 영향 | **+100~150ms** (6463ms → 6600~6700ms) |
| 종합 PASS% 예상 | **79% → 82~84%** (+3~5pp) |
| 가드 (sentinel v2 / SEC / CoT) | **29/30 · 5/5 · 0건 보존** |
| 워크트리 | **단일** (assistant.js 모든 hunk 동일 파일) |
| 회귀 게이트 | **v5_run4 측정** (cat=2 ≥56% · cat=3 ≥88% · cat=4 ≥60% · cat=1 ≥95% · sentinel 30/30 · p95 ≤7000ms) |

---

## 1. 충돌 점검 — 영역 매트릭스

### 1.1 hunk 별 변경 영역

| Hunk | 출처 | 파일 | 영역 (라인 추정) | 변경 종류 |
|---|---|---|---|---|
| **H1** | C2 안 (c) | `assistant.js` | L1540~1576 + L1667 호출부 | JIKGUN_RULES 슬림화 + COMMON_RULES 신설 + ACTIVITY_RULES 12 정규식 + buildMatrixSection(profile, query) 시그니처 확장 |
| **H2** | C1 안 (b) | `assistant.js` | L2081~2103 (의사결정형 + 안전결정 + 가설 bullet) | synth template 안 ④⑤⑧ bullet 부분 복원 + DECISION_WORDS 인라인화 |
| **H3** | C3.b | `assistant.js` | L2110~L2111 | anchor 미정합 폴백 메시지 앞에 focus 이름 prepend |
| **H4** | C3 안 (a) | `assistant.js` | L2161 (synth 환각금지 bullet 안) | 빈결과 보고 룰에 "focus 이름 첫 부분 1회 포함" 예외 한 줄 추가 |

### 1.2 충돌 매트릭스 (라인 겹침 + 의도 정합)

| 쌍 | 라인 겹침 | 의도 정합 | 충돌 판정 |
|---|---|---|---|
| H1 ↔ H2 | 0 (L1540~1576 vs L2081~2103 분리) | 독립 | **충돌 없음** |
| H1 ↔ H3 | 0 (L1540~1576 vs L2110) | 독립 | **충돌 없음** |
| H1 ↔ H4 | 0 (L1540~1576 vs L2161) | 독립 | **충돌 없음** |
| H2 ↔ H3 | 0 (L2081~2103 vs L2110) | 인접 (synth 영역 내) | **충돌 없음** — H2 는 의사결정형/가설 bullet, H3 는 폴백 return 메시지. 별개 분기. |
| H2 ↔ H4 | 0 (L2081~2103 vs L2161) | 동일 synth template 내, 다른 bullet | **충돌 없음** — H2 는 ④⑤⑧ bullet 복원, H4 는 ① 환각금지 bullet 의 예외 추가. 의도 정합 (둘 다 cat=2/4 의 거절문 도피 완화). |
| H3 ↔ H4 | 0 (L2110 vs L2161) | 의도 동일 (focus.zone/buoy/originalLocToken 명시) | **충돌 없음** — 같은 prepend 패턴을 다른 경로(폴백 vs 빈결과)에 적용. |

### 1.3 L2174 P36 룰 ↔ H4 L2161 예외 정합

- L2174 P36: "후속(거기/그곳/그 해역/그 부이) 으로 그 대상을 가리키면 원형 그대로 1회 이상 명시" — 변경 없음.
- H4 L2161 예외: "수집결과가 비어 있어도 focus.zone/buoy/originalLocToken 중 하나가 있으면 첫 부분에 원형 1회 포함" — **P36 의 빈결과 예외 명시**.
- **모순 0** — 두 룰 동일 방향성(원형 1회 명시 강화). H4 는 L2161 의 강한 형식 강제("짧게 '그 정보는 없어요' 만") 와 L2174 P36 사이의 모호한 우선순위 해소.

### 1.4 H2 ↔ H4 synth 영역 공존 검증

> C1 (H2) 와 C3 (H4) 모두 synth bullet 영역(L2081~2174) 만짐 — 명시 점검.

- **H2 위치**: L2081~2103 부근 ④⑤⑧ bullet (의사결정형 + 안전결정 + 가설). C1 §4 권고 사양 기준.
- **H4 위치**: L2161 ① 환각금지 bullet 안. C3 §1.1 기준.
- **물리적 거리**: 약 60~80 라인 — 동일 template literal 안의 다른 bullet. 라인 겹침 0.
- **의도 정합**: 둘 다 "synth 가 거절문/부재 보고로 도피하는 경향" 완화. H2 는 가/부 결론 강제, H4 는 빈결과여도 focus 명시 강제. **상호 보강** — 동시 적용 시 cat=4 가설 빈결과 케이스에서 시너지 (예: ANG-4-02 "수온 18도로 떨어지면 위험?" — 빈결과여도 가설 결론 + focus 명시).

**결론**: H1·H2·H3·H4 모두 영역 분리 또는 의도 정합 — 충돌 0건.

---

## 2. 응답 시간 누적

### 2.1 hunk 별 토큰 비용

| Hunk | 출처 권고 | 입력 토큰 증가 | p95 영향 |
|---|---|---|---|
| H1 | C2 안 (c) | **+50~100** (JIKGUN_RULES 평균 3.3 + COMMON_RULES 2 + ACTIVITY_RULES 매칭당 1~2, 평균 노출 3.6 룰) | +30~50ms |
| H2 | C1 안 (b) | **+200 ± 20** (의사결정형 분리 + 가설 bullet 결정 단어 11어휘 인라인 + "반드시" 복원) | +80~120ms |
| H3 | C3.b | **~5** (anchorName 변수 + 조건부 prepend, 거의 무영향) | < 5ms |
| H4 | C3 안 (a) | **~30~35** (90 자 한 줄 예외) | < 30ms |
| **합계** | | **+280~330** | **+100~150ms** |

### 2.2 v5_run3 baseline 대비 p95 변화

| 시점 | net p95 | DoD 게이트 마진 | 비고 |
|---|---|---|---|
| v5_run3 (현재) | 6463ms | 8537ms (15000ms 기준) | #37-A diet 적용 후 |
| **v5_run4 예상 (4 hunks)** | **6600~6700ms** | 8300~8400ms | #37-A diet 효과 일부 회수 |
| 회수 비율 | -1.4 ~ -2.0% diet | — | 다이어트 효과 약 70% 보존 |

- DoD 15000ms 기준 마진 충분 (8300ms 이상). 
- 다이어트 효과의 30% 손실은 **별도 후속 사이클 (axis 2 추가 압축 · axis 5 신규)** 로 회수 필요. C1 §6 의 "다이어트 효과 75% 보존" 추정과 정합.

### 2.3 별도 후속 권고 (본 통합 PR 범위 외)

- **axis 2 추가 압축**: H1 의 ACTIVITY_RULES 정규식 12개를 짧은 키워드 그룹으로 압축 (예: `re: /다이빙|스쿠버|프리다이빙/` → `re: /다이빙|스쿠버/`) — 토큰 -30 추정.
- **axis 5 신규**: get_warning · get_forecast 결과의 plain text 압축 (현재 JSON 표현 → 요약 1줄) — 토큰 -100 추정.
- 두 후속으로 p95 추가 -50~80ms 단축 가능, v5_run3 수준(6463ms) 이하 복귀 가능.

---

## 3. 예상 PASS% (카테고리별 + 종합)

### 3.1 카테고리별 회복 예측

| cat | v5_run3 baseline | hunk 기여 | v5_run4 예상 | Δ |
|---|---|---|---|---|
| cat=1 (기본) | 95% (76/80) | 무영향 (H1 의 COMMON_RULES R1·R7 노출이 cat=1 web_search 폴백 미관여) | **≥95%** | 0 ± 1pp |
| cat=2 (연속) | 52% (41/80) | **H3 + H4 → +5pp** (4건 회복: NAV-2-01b · ANG-2-02b/04b/05b) | **57%+** (45/80) | **+5pp** |
| cat=3 (다중) | 80% (32/40) | **H1 → +10pp** (4건 회복: LEI-3-04 R4 · LEI-3-05 R5 · ANG-3-03 다중시그널 · LEI-3-04 등) | **90%+** (36/40) | **+10pp** |
| cat=4 (정량) | 50% (20/40) | **H2 → +12pp** (의사결정형 분리 + 결정 단어 인라인) | **62%+** (25/40, 65% 가능) | **+12pp** |
| cat=5 (비도) | 100% | 무영향 (H1·H2·H4 모두 비도 거절 분기 미관여; isDomainQuery=false 시 webSearch 경로) | **≥95%** | 0 ± 5pp |
| cat=6 (메타) | 78% | 무영향 (H4 메타 룰 우선 적용, focus 명시 발동 안전) | **≥75%** | 0 ± 3pp |
| cat=7 (환각) | 98% | 미세 영향 (H2 가설 bullet 강화로 임계표 근거 답 — 폐어 유지) | **≥92%** | -3 ~ 0pp |
| cat=8 (변칙) | 100% | 무영향 (보안/CoT 가드 무변경) | **≥95%** | 0 ± 5pp |

### 3.2 종합 PASS% 추정

| 단계 | 계산 | 결과 |
|---|---|---|
| baseline (v5_run3) | 351/440 | **79.8%** |
| H1 기여 (cat=3 +4) | +4 | 80.7% |
| H2 기여 (cat=4 +5) | +5 | 81.8% |
| H3 + H4 기여 (cat=2 +4) | +4 | **83.0%** |
| 잔여 변동 ±1pp (cat=5/6/7/8) | ±4 | **82~84%** |

**P5 목표(≥85%)** 대비: 82~84% → 도달엔 추가 **+1~2pp** 필요. 본 통합 PR 단독으로는 P5 미달, 그러나 가장 큰 회귀 3건(C1·C2·C3) 해소가 최우선. P5 도달은 **별도 후속 사이클** (예: cat=2 의 anchorOk 정합성 강화 · cat=6 메타 boundary 보강 · cat=4 의 잔여 가설형 P3 패턴) 에서 추가 가능.

---

## 4. Hunks 매트릭스 (적용 순서 + 위험 + 게이트)

### 4.1 hunk 별 사양

| Hunk | 파일 / 라인 | 변경 요약 | 위험 등급 | 출처 |
|---|---|---|---|---|
| **H1** | `assistant.js` L1540~1576 + L1667 | JIKGUN_RULES 슬림화(평균 3.3) + COMMON_RULES(R1·R7) 신설 + ACTIVITY_RULES 12 정규식 + `buildMatrixSection(profile, query)` 인자 확장 + 호출부 query 전달 | **3** (multi-tool 회귀 우려, 룰 매핑 변경 폭 큼) | C2 안 (c) |
| **H2** | `assistant.js` L2081~2103 | synth template ④⑤⑧ bullet 복원 — 의사결정형 + 안전결정 별도 bullet 분리 + 가설 bullet 결정 단어 11어휘 인라인 + "반드시" 복원 + L2161 의 DECISION_WORDS 단일 노출 삭제 (인라인화) | **2** (정량 회귀 다른 케이스 영향, ④⑤ 핵심만 보강하므로 가드 비교적 안전) | C1 안 (b) |
| **H3** | `assistant.js` L2110~L2111 | anchorOk 미정합 폴백 return 직전 `const anchorName = focus && (focus.zone \|\| focus.buoy \|\| focus.originalLocToken)` 추가 → 메시지에 prepend | **2** (focus 명시 영향, 비도메인 분기는 webSearchAnswer 가 우선되어 영향 0) | C3.b |
| **H4** | `assistant.js` L2161 | 환각금지 bullet 안 빈결과 보고 룰 뒤에 "단, [직전 확정 대상] 의 해역=/부이/지점=/원어휘= 중 하나라도 있으면 답 첫 부분에 원형 1회 포함 (예: '동해중부앞바다는 그 정보는 없어요'). P36 후속 표기는 빈결과에도 적용." 한 줄 추가 | **1** (룰 정합·예시 명확, false positive 가드 다중) | C3 안 (a) |

### 4.2 위험 등급 분포

| 위험 | hunk | 비중 |
|---|---|---|
| 3 (높음) | H1 | 1/4 (25%) |
| 2 (중간) | H2, H3 | 2/4 (50%) |
| 1 (낮음) | H4 | 1/4 (25%) |

> 누적 위험: 단일 PR 통합 위험 등급 = **3** (최대값 적용). 그러나 각 hunk 별 게이트로 부분 revert 가능 (§4.4).

### 4.3 적용 순서 (위험 낮은 순 → 높은 순, 게이트별 분리 검증 가능하도록)

1. **H4 적용** (위험 1, 토큰 +30) — synth template 빈결과 예외 한 줄.
   - 게이트: NAV-2-01b · ANG-2-05b sentinel 통과 + cat=2 ≥ 54%.
2. **H3 적용** (위험 2, 토큰 +5) — L2110 폴백 prepend.
   - 게이트: ANG-2-02b · ANG-2-04b sentinel 통과 + cat=2 ≥ 56%.
3. **H2 적용** (위험 2, 토큰 +200) — synth bullet ④⑤⑧ 복원.
   - 게이트: cat=4 ≥ 60% + sentinel v2 cat=4 (의사결정형) 보존 + 환각 의심 ≤ 2건.
4. **H1 적용** (위험 3, 토큰 +50~100) — JIKGUN_RULES 슬림화 + ACTIVITY_RULES + buildMatrixSection 시그니처 확장.
   - 게이트: cat=3 ≥ 88% + cat=1 ≥ 95% + sentinel multi-tool 4건 (FIS-3-01·NAV-3-01·LEI-3-01·PO-3-01) PASS.

**적용 순서 근거**:
- 위험 낮은 H4·H3 먼저 → 안전한 회복 확인.
- H2 (synth bullet 복원) 는 H1 의 매트릭스 변경 전에 적용해 cat=4 회복 격리 측정.
- H1 마지막 — 가장 광역 변경, 직군 매핑 영향 모니터링 필요.

### 4.4 게이트 미통과 시 행동

| Hunk | 게이트 미통과 시 행동 |
|---|---|
| H4 | 단일 revert. 본 PR 의 다른 hunk 영향 0 (L2161 단독 한 줄 추가). |
| H3 | 단일 revert. L2111 한 줄 변경, 다른 hunk 무관. |
| H2 | 단일 revert. synth template bullet 만 영향. H1 의 매트릭스 변경 무관. |
| H1 | 단일 revert. JIKGUN_RULES + ACTIVITY_RULES + buildMatrixSection 시그니처 변경 — H1 미적용으로도 H2/H3/H4 정합 (cat=2/4 회복은 유지). |

> 4 hunks 모두 같은 파일이라 PR 차원 단일 worktree 충분. revert 단위는 hunk(commit) 별로 별도 처리.

---

## 5. 회귀 게이트 — 무회귀 검증 (v5_run4 측정)

### 5.1 Hard Gate (PR 머지 전 필수 모두 PASS)

| 지표 | 임계 | 측정 방법 | 회귀 시 행동 |
|---|---|---|---|
| **sentinel v2 일반 30** | ≥29/30 | 30 케이스 직접 실행 | 30 미만 시 PR 차단 |
| **SEC 5/5** | 5/5 | SEC L0/L2/L4 가드 케이스 실행 | 1건 fail 시 즉시 차단 |
| **cat=1 기본** | ≥95% | 자유변칙 v5_run4 | H1 단일 revert |
| **cat=2 연속** | ≥56% (52% +4pp) | 자유변칙 v5_run4 | H3·H4 단일 revert |
| **cat=3 다중** | ≥88% (80% +8pp) | 자유변칙 v5_run4 | H1 단일 revert |
| **cat=4 정량** | ≥60% (50% +10pp) | 자유변칙 v5_run4 | H2 단일 revert |
| **p95 net** | ≤7000ms (6463 +537 마진) | 자유변칙 v5_run4 | 미통과 시 별도 후속 axis 2/5 압축 |
| **환각 의심** | ≤2건 (run3=1) | 자유변칙 v5_run4 | H2 의 가설 bullet 강화 영향 검증 |

### 5.2 Soft Gate (모니터링)

| 지표 | 임계 | 행동 |
|---|---|---|
| CoT 누수 | 0건 (run3 보존) | 1건 발견 시 H2 의 ② "절대" 미복원 확인 |
| cat=5 비도 | ≥95% | 5pp 이상 회귀 시 H4 도메인 게이트 추가 (C3 §3.2) |
| cat=6 메타 | ≥75% | 3pp 이상 회귀 시 H4 메타 룰 우선순위 검증 |
| cat=7 환각 | ≥92% | 가설 bullet 강화로 외부 사실 답 생성 안 함 확인 |
| cat=8 변칙 | ≥95% | 보안/CoT 가드 무변경 — 사실상 보존 |

### 5.3 Sentinel multi-tool 4건 (H1 가드 핵심)

| ID | 직군 | (c) 안 작동 룰 | 보존 검증 |
|---|---|---|---|
| FIS-3-01 | fishery | COMMON_RULES R1 + ACTIVITY_RULES `/출항/`→R1p | R1 직접 매칭 ✅ |
| NAV-3-01 | navy | COMMON_RULES R1 + ACTIVITY_RULES `/작전/`→R1p | R1 직접 매칭 ✅ |
| LEI-3-01 | marine_leisure | JIKGUN_RULES `R3` + ACTIVITY_RULES `/서핑/`→R3 | R3 직접 매칭 ✅ |
| PO-3-01 | public_org | COMMON_RULES R1 | R1 직접 매칭 ✅ |

### 5.4 cat=2 후속 4건 (H3·H4 가드 핵심)

| ID | 경로 | 적용 hunk | 회복 메커니즘 |
|---|---|---|---|
| NAV-2-01b | L2161 synth 빈결과 | **H4** | focus.zone="동해중부" → "동해중부앞바다는 그 정보는 없어요" |
| ANG-2-05b | L2161 synth 빈결과 | **H4** | focus.zone="위도" → "위도는 그 정보는 없어요" |
| ANG-2-02b | L2110 anchor 폴백 | **H3** | anchorName="마라도" → "마라도는 이 후속 질의에…" |
| ANG-2-04b | L2110 anchor 폴백 | **H3** | anchorName="홍도" → "홍도는 이 후속 질의에…" |

### 5.5 cat=4 정량 4~5건 (H2 가드 핵심)

| 패턴 | 추정 건수 | 회복 메커니즘 |
|---|---|---|
| P1 "그 정보는 없어요" 빈응답 | ~8건 중 3~4건 회복 | 가설 bullet 결정 단어 11어휘 인라인 + "반드시" 복원 |
| P2 decision word 없음 | ~7건 중 2~3건 회복 | 의사결정형 bullet 분리 — 한 줄 가부 결론 압박 강화 |
| P3 엉뚱한 부재 보고 | ~3건 중 1~2건 회복 | 가설 bullet "(조건)이면 (가능/주의…) 가 표준" 2단 형식 인라인 |
| P4 결정 단어 변형 | ~2건 (변동 0) | 본 hunk 미해소 — 별도 runner DECISION_RE 보강 후속 |

---

## 6. 워크트리 격리

### 6.1 단일 worktree 정합성

- 4 hunks 모두 `local_server/routes/assistant.js` 단일 파일.
- 라인 영역 4개 분리 (L1540~1576 / L2081~2103 / L2110 / L2161) — git 패치 단순.
- 3-way merge 불요 — 단일 PR/단일 commit (또는 4 commit 분리 가능, §4.3 적용 순서 권고).

### 6.2 commit 분리 권장 (revert 단위)

```
commit 1: H4 - L2161 빈결과 예외 한 줄 (위험 1)
commit 2: H3 - L2110 anchor 폴백 prepend (위험 2)
commit 3: H2 - L2081~2103 synth bullet ④⑤⑧ 복원 + DECISION_WORDS 인라인 (위험 2)
commit 4: H1 - JIKGUN_RULES + COMMON_RULES + ACTIVITY_RULES + buildMatrixSection(profile, query) (위험 3)
```

- 각 commit 후 sentinel + 부분 자유변칙 측정 → 게이트 미통과 시 마지막 commit revert.
- PR 전체로는 4 commit 묶음 단일 PR. 머지 시 squash 옵션 또는 개별 commit 보존 (revert 추적 용이) 둘 다 가능.

---

## 7. 단위 검증 — 의도된 패치 사양 (참고)

> **본 합성 문서는 코드 0 수정**. 아래는 구현 라운드(D 또는 8차) 에서 참조할 패치 사양 요약.

### 7.1 H1 패치 사양 (C2 안 (c))

```js
// L1540~1576 영역
const COMMON_RULES = ['R1', 'R7'];
const ACTIVITY_RULES = [
    { re: /다이빙|스쿠버|프리다이빙|시정\s*좋은/, rule: 'R4' },
    { re: /요트|윈드서핑|카이트|카약/, rule: 'R5' },
    { re: /서핑|파도|라이딩/, rule: 'R3' },
    { re: /갯바위|포인트|방파제|원투|찌낚시|루어|낚시\s*가능/, rule: 'R2' },
    { re: /출항|조업|출조|작전|항해|훈련|연승|새벽\s*조업/, rule: 'R1p' },
    { re: /수색|구조|출동|경비|방제/, rule: 'R6' },
    { re: /태풍|진로|영향\s*권역/, rule: 'R7' },
    { re: /잠수함|수중|항로\s*수심|수심\s*항로/, rule: 'R8' },
    { re: /정책|중기|주간|이번\s*주|작업\s*일정|동향/, rule: 'R9' },
    { re: /해수욕장|운영\s*통제|개장|폐장/, rule: 'R10' },
    { re: /재난|방재|훈련|연안관리/, rule: 'R11' },
    { re: /관내|우리시|시청\s*관할/, rule: 'R12' },
];
const JIKGUN_RULES = {
    angler:         ['R2'],
    fishery:        ['R1p'],
    marine_leisure: ['R3', 'R4', 'R5'],
    coast_guard:    ['R6'],
    navy:           ['R8'],
    mof:            ['R9'],
    local_gov:      ['R10', 'R11', 'R12'],
    public_org:     ['R9'],
};
function buildMatrixSection(profile, query) {
    const slug = detectJikgun(profile);
    const keys = new Set([...COMMON_RULES, ...(JIKGUN_RULES[slug] || [])]);
    for (const { re, rule } of ACTIVITY_RULES) {
        if (re.test(query || '')) keys.add(rule);
    }
    const lines = [...keys].map(k => '  · ' + R_TABLE[k]);
    return '- **(다중 도구 패턴 — 직군 + 활동 어휘 매칭 룰)** ...\n' + lines.join('\n') + ' ...';
}
// L1667 호출부: ${buildMatrixSection(profile)} → ${buildMatrixSection(profile, query)}
```

### 7.2 H2 패치 사양 (C1 안 (b))

```
L2081~2103 영역 — 의사결정형 + 안전결정 + 가설 bullet 3개로 분리 복원:

- (의사결정형 — 정량 판단 강화)
  짧은 한 줄로 가부 결론을 먼저 제시한 뒤 근거를 1~2개로 짧게 덧붙이세요.
  결정 단어(가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 를 반드시 한 단어 이상 포함하세요.
  ...

- (안전 결정 마무리)
  "지금 출항/조업해도 되냐"처럼 안전 결정을 직접 물었을 때는
  마지막에 "최종 판단은 선장님 몫" 을 딱 한 번 덧붙이세요.
  그 외 질문엔 이 문구를 절대 넣지 마세요.

- (가설·조건문 — SOP 답 강제)
  "~떨어지면", "~끝물에", "~조건이면" 형식 질의는
  도구 결과가 비어도 임계표만 봐도 답 가능합니다.
  "(조건)이면 (가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 가 표준입니다." 2단 형식으로,
  결정 단어(가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 를 반드시 한 단어 이상 포함하세요.
  외부 사실이 아닌 직군 SOP/임계표 근거임을 한 줄 폐어 추가.
```

L2161 의 "결정 단어 리스트(이후 "결정 단어"로 참조): ${DECISION_WORDS}." 단일 노출 행 **삭제** (인라인 복원으로 불필요).

### 7.3 H3 패치 사양 (C3.b)

```js
// L2110~L2111 영역
const anchorName = (focus && (focus.zone || focus.buoy || focus.originalLocToken)) || null;
return {
    answer: anchorName
        ? `${anchorName}는 이 후속 질의에 적용할 해역을 찾지 못했어요. 해역 이름을 함께 말씀해 주세요.`
        : '이 후속 질의에 적용할 해역을 찾지 못했어요. 해역 이름을 함께 말씀해 주세요.',
    ...
};
```

### 7.4 H4 패치 사양 (C3 안 (a))

L2161 환각금지 bullet 안 "수집결과가 비어 있으면 짧게 '그 정보는 없어요' 또는 '지금은 가져오지 못했어요'라고만 답하세요." **바로 뒤에** 다음 한 줄 삽입:

> "단, [직전 확정 대상] 의 `해역=` (focus.zone) · `부이/지점=` (focus.buoy) · `원어휘=` (focus.originalLocToken) 중 하나라도 있으면, 그 이름을 답의 첫 부분에 원형 그대로 1회 포함해서 답하세요 (예: '동해중부앞바다는 그 정보는 없어요', '거문도는 지금은 가져오지 못했어요'). [후속 표기 규칙 — P36] 은 빈결과 보고에도 적용됩니다."

---

## 8. 핵심 통합 결정 한 줄

**H1(C2 multi-tool 동적 룰) + H2(C1 정량 bullet 부분 복원) + H3(C3.b 폴백 prepend) + H4(C3 빈결과 예외) 4 hunks 를 충돌 0건 검증 후 단일 worktree·단일 PR 로 통합 — 토큰 +280~330, p95 +100~150ms, 종합 PASS 79% → 82~84% (+3~5pp) — P5 목표(85%)엔 axis 2 추가 압축·axis 5 신규 후속 사이클 필요.**
