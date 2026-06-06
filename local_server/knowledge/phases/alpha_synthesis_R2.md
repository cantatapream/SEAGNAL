# α 옵션 R2 합성 — A·B 8커밋 통합 PR 적용 절차서

> 입력
> - `alpha_patch_A_impl.md` (C1~C5: ANG-2-01b 부이 좌표 폴백 + LG-1-01 관내 OVERVIEW)
> - `alpha_patch_B_impl.md` (C6~C8: 정량 synth bullet + 임계표 unshift + DECISION_RE 확장)
> - `patch_synthesis.md` (이전 라운드 — 8커밋 권고 + 충돌 봉합 4건 + S1~S7 위험)
>
> 본 문서는 **설계 합성만**(코드 수정 금지). 신규 결정: ①두 산출물간 라인·식별자·블록 순서 정합 재검증, ②C1→C8 의 단일 PR 커밋 순서 확정, ③회귀 가드 게이트 통합, ④C5(부이) revert 만 했을 때의 회귀 의사코드, ⑤위험 등급(1~5)+머지 순서 권고, ⑥PR 본문 초안.

---

## 1. 충돌 점검 — A 산출물 ↔ B 산출물 동시 적용 시

### 1.1 라인 위치 충돌 매트릭스

| # | 영역 | A 가 손대는 위치 | B 가 손대는 위치 | git diff 충돌 | 의미 충돌 |
|---|-----|----------------|----------------|--------------|----------|
| 1 | helper | L110 직후 신규 (`buoyToCoords`) | 없음 | 0 | 0 |
| 2 | `buildPersonalContext` | 없음 | L711 시그니처 + L723~724 본문 + L1570 호출부 | 0 | 0 |
| 3 | `TOOL_EXEC.get_warning` | L1135 함수 본문 교체 | 없음 (단, **응답 키 가설은 B §4 가 의존**) | 0 | **있음 — §1.3 #1** |
| 4 | `deriveFocus` | L1273~1287 분기 보강 | 없음 | 0 | 0 |
| 5 | runBrain 진입부 (L1450) | **A 가 공유 상수 4개 1회 선언**: `VAGUE_LOCAL_RE`/`MONITOR_JIKGUN`/`OVERVIEW_RE`/`_jikgunSlug` | 없음 | 0 | 0 |
| 6 | runBrain L1502 직후 신규 블록 #1 (부이 폴백) | A C4 — `const _buoyPlanTools = new Set(...)` | 없음 | 0 | **있음 — §1.3 #2** |
| 7 | runBrain L1502 직후 신규 블록 #2 (LG 강제) | A C5-a — `const _lgPlanTools = new Set(...)` | 없음 | 0 | 0 |
| 8 | runBrain L1548 `isDomainQuery` | A C5-b — `monitorOverview` AND-narrow 추가 | 없음 | 0 | 0 |
| 9 | runBrain synth template L1574 | 없음 | B C7+ — 환각금지 bullet 끝에 응답 키 양방향 해석 한 줄 추가 | 0 | **있음 — §1.3 #1** |
| 10 | runBrain synth template L1579 직후 | 없음 | B C7 — "가설·조건문" bullet 신규 추가 | 0 | **있음 — §1.3 #3** |
| 11 | `phase2b_eval_freevar_runner.py` L59 | 없음 | B C8 — `DECISION_RE` 교체 + `DECISION_RE_WEAK` 신규 | 0 | 0 |

**라인 영역이 서로 분리** — 동일 라인을 양쪽이 동시에 손대는 케이스는 0. git rebase / merge 충돌은 발생하지 않음 (라인 drift 만 누적).

### 1.2 식별자 충돌 점검 (A 내부 ↔ A·B 결합)

A 산출물(`alpha_patch_A_impl.md` §1.3 + §2.3) 이 *이미* synthesis 의 충돌 봉합 #1, #2 를 흡수:

- **#1 `planTools` 중복 → 분리**: A 의 C4 블록은 `_buoyPlanTools`, C5-a 블록은 `_lgPlanTools` 로 식별자 분리됨 (A §2.3 line 230 `const _lgPlanTools = new Set(plan.steps.map(s => s.tool));`). **재충돌 위험 0**.
- **#2 공유 상수 함수 상단 1회 선언**: A 가 L1450 의 `canonZone` 정의 직전에 `VAGUE_LOCAL_RE`/`MONITOR_JIKGUN`/`OVERVIEW_RE`/`_jikgunSlug` 4개를 1회 선언 (A §2.1 line 159~162). C4·C5-a·C5-b 모두 이 상수를 참조. **재선언 충돌 0**.
- **B 가 추가하는 신규 식별자**: `NUM_UNIT_RE` (B §2.3), `enrichedTdig` (B §2.3), `probe` / `lastTurn` (B §3.3), `DECISION_RE_WEAK` / `DECISION_WEAK_PAIR_RE` (B §5.3) — 모두 함수 로컬 스코프 (`buildPersonalContext` 또는 runner.py 모듈 스코프) 로 한정. A 의 runBrain 식별자와 **스코프 분리 → 충돌 0**.

### 1.3 의미·합성 정합 충돌 — **신규 결정 필요한 3건**

#### **#1. `get_warning` 응답 키 변경 (A C3) ↔ B synth bullet (B C7+) 응답 형태 가정 정합**

- A C3 가 zone 비움 호출 시 응답을 `{zone:'전국', activeCount:N, warnings:[...], warning:null}` 로 변경.
  단, A 의 패치는 `warning:null` 도 함께 포함시켜 **양쪽 분기 모두 zone 키 + warning 키 항상 존재** (A §2.2 line 188, 207).
- B C7+ 가 synth prompt 의 환각금지 bullet 끝에 응답 키 양방향 해석 한 줄을 추가 (B §4.3 line 159~161):
  - "특정 해역 호출 시 `{zone, warning}` (단일 객체 또는 null), 전국 집계 호출 시 `{zone:'전국', activeCount:N, warnings:[…]}`"
- **정합성**: ✅ A 의 실제 응답 키(`zone` + `warning` + `warnings` + `activeCount` 모두 포함) ⊇ B 의 prompt 가설 (양 형태 분기 안내). 회귀 0.
- **신규 결정 (R2)**: B C7+ bullet 의 "전국 집계 호출 시 응답에 `warning` 키 미포함" 가설은 *틀린* 가정 — 실제로 A 는 `warning:null` 도 포함. 그러나 prompt 가 *더 좁게* 안내해도 LLM 이 `null` 무시할 수 있어 무해. **B C7+ 의 prompt 문구는 그대로 유지**, 단 PR 본문 §검증에 "A 가 `warning:null` 도 포함하므로 prompt 가설보다 키가 1개 많아도 무해" 명시.

#### **#2. C4·C5-a 신규 블록의 순서 의존**

- A 가 L1502 직후에 **블록 #1 (C4 부이) → 블록 #2 (C5-a LG)** 순서로 삽입 (A §2.3 line 213 "§1.3 의 부이 폴백 블록 *직후*").
- 의미 의존: C5-a 가 `plan.steps.map(s => s.tool)` 으로 `_lgPlanTools` 재계산할 때, C4 가 추가한 `get_buoy_observation` / `get_buoys_with_obs` 도 set 에 포함됨. C5-a 의 unshift/push 가 부이 도구와 충돌하지 않음(다른 도구명) — 의미 충돌 0.
- **신규 결정 (R2)**: 머지 단계에서 PR 의 file diff hunk 순서가 C4 hunk → C5-a hunk 임을 PR 본문 §검증에 명시. 만약 누군가 hunk 순서를 뒤집어 리베이스하면 `_buoyPlanTools` 와 `_lgPlanTools` 식별자가 forward-reference 되어도 무해(둘 다 자기 블록 안에서만 사용) — **순서 뒤집어도 컴파일은 OK, 단 의미상 C4 → C5-a 권장**.

#### **#3. B C7 "가설답 bullet" 효과가 A C5-a 의 도구 호출 결과에 의존 (LG-4-01)**

- B C7 의 가설답 bullet 가 "현재는 (실제 상태 한 줄)" 부기를 강제 — synth 입력에 `get_warning` 결과 객체가 있어야 자연스럽게 작성 가능.
- A C5-a 가 local_gov + 모호어 + GPS·default·focus zone 미존재 시 `get_warning({})` 강제 호출 → 결과 객체 ≥ 1 보장.
- **정합성**: ✅ A·B 동일 PR 머지 시 LG-4-01 의 두 결함(빈 도구 결과 + 결정 단어 부재) 동시 해소.
- **분리 머지 위험**: B 만 머지하고 A C5-a 빠지면 LG-4-01 케이스에서 `get_warning` 미호출 → 가설답은 생성되나 부기 "현재 상태" 가 환각 가드에 막혀 빈 응답. **결정: A·B 분리 머지 금지** (단일 PR 강제).

### 1.4 충돌 점검 결론

- git diff 충돌: 0건.
- 식별자 중복: 0건 (A 가 이미 봉합 완료).
- 의미·합성 정합: 3건 (모두 *A·B 동시 머지로 자연 해소*) — 분리 머지만 금지하면 됨.
- 추가 위생 작업: 0건 (A 산출물이 supersede).

---

## 2. C1→C8 단일 PR 커밋 순서 확정

각 커밋: **메시지 / 파일·라인 / 검증 시나리오 한 줄**.

| # | 커밋 메시지 | 파일·라인 | 검증 시나리오 (한 줄) |
|---|-----------|---------|------------------|
| **C1** | `helper: add buoyToCoords for buoy-name→coords lookup` | `local_server/routes/assistant.js` L110 직후 신규 | 호출처 없음 → lint·unit 만 통과. `BUOY_BY_ID` 미초기화 시 `null` 반환 안전. |
| **C2** | `focus: derive buoy coords from BUOY_BY_ID into focus.coords` | `assistant.js` L1273~1287 (`deriveFocus` 의 `get_buoy_observation` / `nearest` 분기) | sentinel ANG-2-01a 단독 (선행 턴) — focus.coords 신규 채움이 동턴 답에 영향 없는지(memory 만 변동). |
| **C3** | `tools: get_warning supports nationwide aggregate with backward-compatible keys` | `assistant.js` L1135 (`TOOL_EXEC.get_warning` 본문 교체) | zone 있는 기존 호출 회귀 (해역 지정 케이스 N=5) — `{zone, warning}` 키 그대로 반환되는지. zone 비움 호출 시 `{zone:'전국', activeCount, warnings, warning:null}` 형태 확인. |
| **C5-pre** | `brain: declare shared constants (VAGUE_LOCAL_RE/MONITOR_JIKGUN/OVERVIEW_RE/_jikgunSlug) once at runBrain entry` | `assistant.js` L1450 (`canonZone` 정의 직전, 신규 4줄) | 컴파일·lint 통과. 다른 함수와 식별자 중복 없는지 grep 점검. |
| **C4** | `brain: buoy follow-up fallback for wind/vis/temp/wave (force get_buoy_observation + get_buoys_with_obs)` | `assistant.js` L1502 직후 신규 블록 #1 (`_buoyPlanTools` 사용) | sentinel ANG-2-01a→ANG-2-01b 2턴 — `toolsUsed ⊇ {get_buoy_observation}` + 답 ≥ 15자 + `expect_no_halluc` PASS. CG-2-01a/b·MOF-6-01a/b 무회귀. |
| **C5** | `brain: local_gov vague-area force-call get_warning + isDomainQuery monitorOverview AND-narrow` | `assistant.js` L1502 직후 신규 블록 #2 (`_lgPlanTools`) + L1548 `isDomainQuery` 확장 | sentinel LG-1-01 단독 — `toolsUsed ⊇ {get_warning}` + web_search 호출 0회. LG-4-01·LG-8-01·"회식 어때"(monitorOverview false-positive 가드) 무회귀. |
| **C6** | `personal: threshold rule accepts numeric/hypothetical (unshift enrichedTdig when NUM_UNIT_RE matches)` | `assistant.js` L711 시그니처 + L723~724 본문 (`enrichedTdig` + `NUM_UNIT_RE`) + L1570 호출부 인자 추가 | sentinel MOF-4-01 단독 — 임계표가 prompt 상단 배치되는지(`═══ 직군 임계표 ═══` 헤더 출현). 비정량 일반 질의("오늘 부산 날씨") unshift 비발동 확인. |
| **C7** | `synth: add hypothetical conditional bullet + bidirectional get_warning response-key parsing` | `assistant.js` L1574 (환각금지 bullet 끝 보강) + L1579 직후 (가설답 bullet 신규) | sentinel LG-4-01 단독 — 답에 결정 단어(통제/가능 등) 포함. "회식 어때"(cat5) 가설 어휘 미매치로 bullet 비발동. |
| **C8** | `eval: extend DECISION_RE with SOP vocabulary + DECISION_RE_WEAK pair check` | `local_server/knowledge/phases/phase2b_eval_freevar_runner.py` L59 (`DECISION_RE` 교체 + `DECISION_RE_WEAK` + `DECISION_WEAK_PAIR_RE` 신규 + 호출부 분기) | freevar cat4 PASS율 ≥ 60% (15%→60%+). "운영" 단독 매치 시 비통과 확인 (WEAK 보조 신호 분기). |

**총 9개 hunk → 8 커밋** (C5 가 §A4.2 + §A4.3 의 2 hunk 를 1 커밋으로 묶음 — synthesis §3.1 권고와 동일).

**커밋 순서 권고**: C1 → C2 → C3 → C5-pre → C4 → C5 → C6 → C7 → C8 (위 표 순서). 단계별 회귀 게이트(§3) 가 각 커밋 직후 PASS 해야 다음 커밋 진행.

---

## 3. 회귀 가드 — 통합 게이트 표

A 산출물 §4 + B 산출물 §6 + synthesis §3.2 통합. **단일 PR 머지 전 모든 Stage 가 GREEN 이어야 머지 허용**.

### 3.1 Stage I — sentinel 4 케이스 직타 (N=4)

| 케이스 | 입력 | 통과 기준 | 책임 커밋 |
|-------|-----|---------|---------|
| **ANG-2-01b** | "거문도 파고"→"거기 풍속은?" (낚시, GPS 무) | `toolsUsed ⊇ {get_buoy_observation}` + `expect_no_halluc` + 답 ≥ 15자 | C1·C2·C4 |
| **LG-1-01** | "관내 어때" (시청, GPS 무, default 해역 무) | `toolsUsed ⊇ {get_warning}` + `web_search` 호출 0 + `expect_no_halluc` | C3·C5-pre·C5 |
| **LG-4-01** | "풍랑특보 시 해수욕장 운영?" (local_gov) | `DECISION_RE` ⊇ {통제, 가능} + `toolsUsed ⊇ {get_warning}` (A C5 와 결합) | C3·C5·C7·C8 |
| **MOF-4-01** | "파고 2m 어업관리 권고?" (mof) | `DECISION_RE` ⊇ {권장/권고} + 임계표 unshift 헤더(`═══ 직군 임계표 ═══`) 출현 | C6·C8 |

### 3.2 Stage II — sentinel 잔여 18 케이스 무회귀 (N=18)

| 케이스 군 | 점검 포인트 | 회귀 우려 커밋 |
|---------|----------|--------------|
| ANG-2-01a (선행 단독) | C2 의 coords 폴백이 동턴 답에 부작용 없음 (memory 만 변동) | C2 |
| CG-2-01a/b, MOF-6-01a/b (zone 있는 follow-up) | C4 게이트 `!focusZone` 가 보존 → 미발동 | C4 |
| LG-4-01·LG-8-01 (구체 지명) | `VAGUE_LOCAL_RE` 미매칭 → C5 미발동 | C5 |
| PO-3-01 (public_org) | `monitorOverview` AND-narrow → OVERVIEW + VAGUE 동시 필요 | C5 |
| 모든 zone 있는 get_warning 호출 | C3 의 분기 `if (!zone || /^전국$/)` 미진입 → 기존 키 유지 | C3 |
| 비정량 일반 질의("오늘 부산 날씨") | C6 의 `NUM_UNIT_RE` 미매칭 → unshift 안 됨 | C6 |
| "회식 어때" (모니터링 직군 비도메인) | C5 의 monitorOverview AND-narrow 차단 + C7 가설 어휘 미매칭 | C5, C7 |
| "어선법 제5조" (환각가드 cat7) | C7 가설 bullet 비발동 (~시/~라면 없음) | C7 |
| 메타 자기요약 ("방금 결정 사유") | synth 의 메타 분기 selected → 가설 bullet 비발동 | C7 |
| 태풍 단정 정정 케이스 | C6 unshift 미발동 (정량 수치 0) | C6 |
| `expect_decision=false` 케이스 | C8 의 DECISION_RE 분기 미사용 | C8 |

### 3.3 Stage III — 평가셋 N=3 (sentinel + 구 eval + freevar)

| 셋 | 합격선 |
|----|------|
| `phase2b_sentinel.jsonl` (N=20) | 20/20 (낙관) ~ 18/20 (보수). 95% 가 SLA 약속선 |
| `phase2b_eval.jsonl` (구) | 기존 PASS율 ±2pp |
| `phase2b_eval_freevar.jsonl` (N=440) | cat4 ≥ 60% (15%→60%+, B 핵심), cat2 +5~17pp (A C4 효과), cat1·5·7 ±2pp |

### 3.4 Stage IV — 자유변칙 N=3 표 (교집합 수동 샘플)

| 케이스 군 | 입력 예 | 점검 위험 ID |
|---------|--------|-------------|
| cat2 ∩ cat4 | "거기서 출항해도 돼?" | S2 (부이 군집 결과로 SOP 결정 반복 출력) |
| LG × 정량 | "우리 시 관할 풍랑 떴어?" / "관내 출항 가능?" | S4 (LG-1-01 ∩ LG-4-01 정보 혼합) |
| 모니터링 직군 × 비도메인 | "회식 어때", "팀 분위기 어때" | S3 (monitorOverview false-positive) |

### 3.5 추가 게이트 — synthesis 누락 위험

| 항목 | 게이트 |
|-----|------|
| TTS 음성 출력 ("파고 3m") | "삼엠" 으로 어색하게 읽히지 않는지 음성 샘플 N=3 점검 |
| `needsReplan` 의 results 6개 cap | C4 가 plan.steps 에 +2 추가해도 1차 results ≤ 6 유지 — 부이 follow-up 평균 plan.steps 1~2개로 안전 |
| `detectJikgun` 호출 횟수 | C5-pre 의 `_jikgunSlug` 캐시로 runBrain 진입 시 1회 |
| `personal context` 의 `style.zoneCounts` drift | C4 의 `get_buoys_with_obs` 자동 추가가 zone 카운터에 영향 없음 (focus.buoy 만 변경) |

---

## 4. 롤백 절차 — C8 머지 후 C5(부이 폴백)만 revert

**가정**: 단일 PR 가 main 에 squash-merge 또는 8 커밋 그대로 머지된 상태. 운영 중 ANG-2-01b 직타에서 회귀(예: `get_buoys_with_obs` 의 ws 배열이 다른 케이스에서 오답을 유발) 발견 → C4(부이 follow-up 블록)만 되돌리고 싶다.

> ⚠️ 본 절차서의 "C5(부이) revert" 는 의미상 **C4 커밋(`brain: buoy follow-up fallback`)** 의 revert 를 가리킴 (C5 커밋은 LG 강제 호출). 입력 지시문의 "C5(부이) 만 revert" 명명을 그대로 인용해 의사코드 작성.

### 4.1 revert 의사코드

```
# 1) revert 대상 식별
git log --oneline | grep "buoy follow-up fallback"
# → SHA_C4 = <C4 커밋 해시>

# 2) revert 시도 — C4 단독 revert
git revert SHA_C4 --no-edit

# 3) 충돌 점검 — C5-pre 의 공유 상수는 그대로 두고, C4 블록만 제거
#    C4 블록은 L1502 직후 _buoyPlanTools 식별자를 사용하는 첫 if 블록.
#    C5 블록(_lgPlanTools) 은 L1502 직후 두번째 if 블록 — C4 와 라인 인접 → revert 시 conflict 가능.
#    해결: 두번째 if 블록(_lgPlanTools) 은 보존, 첫 if 블록(_buoyPlanTools) 만 제거.

# 4) 회귀 분석 — C4 revert 후 어디까지 회귀하는가?
```

### 4.2 회귀 범위 의사코드

```python
def regression_after_C4_revert(sentinel_results_pre_revert):
    """
    C4 revert 후 sentinel·freevar 회귀 시뮬레이션.
    pre_revert: 단일 PR 머지 직후 = 20/20 (낙관) 가정.
    """
    rollback_state = sentinel_results_pre_revert.copy()

    # ANG-2-01b 직타 회귀 → FAIL (C4 가 직접 책임)
    rollback_state['ANG-2-01b'] = 'FAIL'
    # 이유: focus.coords 는 C2 가 채워주므로 살아있으나,
    #       plan.steps 에 get_buoy_observation 강제 unshift 가 없어
    #       LLM plan 이 zone 기반 도구(빈 응답) → "그 정보는 없어요"

    # ANG-2-01a (선행 단독) → PASS 유지 (C2 만으로 충분, 동턴엔 부작용 없음)
    # LG-1-01 → PASS 유지 (C3 + C5 = LG 강제 호출 블록 보존)
    # LG-4-01 → PASS 유지 (C3 + C5 + C7 + C8)
    # MOF-4-01 → PASS 유지 (C6 + C8, C4 무관)

    # 잔여 16건 → 무회귀 (C4 가 추가하던 부이 도구 사라져 기존 동작 복원)

    # freevar cat2 회귀:
    #   pre_revert cat2 = ~58~65% (A C4 효과 +10~17pp 가산)
    #   post_revert cat2 = ~48% (revert 로 가산분 소실)

    # freevar cat4 변동 없음 (B C6·C7·C8 보존)
    # freevar cat5 변동 없음 (C5-b monitorOverview 보존)

    return {
        'sentinel': '19/20 (ANG-2-01b 회귀)',
        'freevar_cat2': '48% (10~17pp 하락)',
        'freevar_cat4': '60%+ 유지',
        'freevar_cat5': '±2pp 유지',
        'side_effects': [
            '_buoyPlanTools 식별자 미사용 — lint warning 가능 (C5-pre 의 공유 상수와 무관)',
            'C1 buoyToCoords / C2 focus.coords 폴백은 남아 있으나 호출처 사라짐 → memory drift 위험 (focus.coords 가 채워졌으나 plan 이 이를 활용 안 함). 다음 턴 후속에서 LLM 이 직접 coords 인식하면 무해, 못 하면 빈 응답.',
        ],
    }
```

### 4.3 revert 후 추가 수습

```
# 4-1) C1 (buoyToCoords) 도 같이 revert 권고? — NO
#   C2 가 buoyToCoords 호출하므로 C2 와 함께 revert 해야 함.
#   C2 revert 가 deriveFocus 라인 1273~1287 의 분기 4줄 추가만 되돌리므로 안전.
#   단, ANG-2-01a 후속 턴의 focus.coords 채움이 사라져
#   "거기" 가 zone 기반 도구로 안전하게 라우팅되지 않을 수 있음 — 회귀 우려 낮음(원본 행동 복원).

# 4-2) freevar cat2 회귀 SLA 약속선 위반 시 → C4 만 revert 가 아니라 전체 PR revert 후 재설계.

# 4-3) revert 커밋 메시지 형식:
git commit -m "revert: brain buoy follow-up fallback (rollback C4 due to <원인>)"
```

### 4.4 결론

C4 단독 revert 시 회귀: **sentinel 19/20** (ANG-2-01b 만 회귀), **freevar cat2 약 10~17pp 하락**, 그 외 무영향.
- 다른 모든 직타·가드는 유지됨 — 즉 **C4 는 격리 가능한 안전한 커밋** (싱글 revert 가능).
- 만약 C5(LG) 만 회귀 발견 시 동일 절차 적용 가능 (단, LG-1-01 + LG-4-01 동시 회귀).

---

## 5. 위험 점수 — 각 커밋 1(low)~5(high) + 머지 순서 권고

| # | 커밋 | 위험 등급 | 근거 | 권장 머지 순서 / 단독 회귀 게이트 |
|---|-----|---------|-----|------------------------------|
| **C1** | `buoyToCoords` 신규 헬퍼 | **1** (low) | 호출처 없음. 함수 정의만. | 1st. lint·unit 만. |
| **C2** | `deriveFocus` coords 폴백 | **2** | 기존 분기 내 if 추가. memory 만 변동 (동턴 답 영향 없음). 오매칭 위험 = `buoyToCoords` 의 정확 일치 우선 매칭으로 차단. | 2nd. sentinel ANG-2-01a 단독 회귀. |
| **C3** | `get_warning` 전국 집계 분기 | **3** (med) | zone 있는 기존 호출은 그대로 통과 (분기 `if(!zone)` 미진입). zone 비움 호출은 신규 키 — synth 가 B C7+ 없이는 해석 안 함. **C7 와 동일 PR 필수**. | 3rd. zone 지정 호출 N=5 회귀 점검. |
| **C5-pre** | 공유 상수 4개 1회 선언 | **1** | const 선언만. 호출처 없음. | 4th. lint·grep 으로 식별자 중복 없음 확인. |
| **C4** | runBrain 부이 follow-up 강제 호출 | **3** | plan.steps 에 +2 도구 자동 추가 → 응답 시간 ↑, 토큰 ↑. `!focusZone` 가드로 zone 있는 follow-up 무회귀. `_buoyPlanTools` 식별자 격리. **격리 revert 가능** (§4). | 5th. sentinel ANG-2-01b PASS + CG-2-01b·MOF-6-01b 무회귀. |
| **C5** | runBrain LG 강제 + `monitorOverview` | **4** | (a) LG 강제 호출이 다른 local_gov 케이스에 발동 위험 — `VAGUE_LOCAL_RE` 매칭 한정으로 차단. (b) `monitorOverview` 가 `OVERVIEW_RE && VAGUE_LOCAL_RE` AND-narrow 됐으나 5 직군 사용자의 "관내 어때" 류 비도메인 잡담을 도메인으로 잡을 수 있음 (S3). false-positive 회귀 우려. **수동 N=3 점검 필수**. | 6th. sentinel LG-1-01 PASS + LG-4-01·LG-8-01·"회식 어때" 무회귀 + monitorOverview false-positive 케이스 수동 점검. |
| **C6** | `buildPersonalContext` 임계표 unshift | **3** | `NUM_UNIT_RE` trigger 가 좁아 일반 질의 미발동. 시그니처 변경(L711, L1570) 은 호출처 1개라 안전. `personal context` 의 prompt 상단 배치 — synth 의 cleanAnswer 라벨 필터와 헤더(`═══`) 호환 확인됨. "초" 단위 false-positive 위험 미미 (`\d+` 필수). | 7th. sentinel MOF-4-01 PASS + 비정량 일반 질의 unshift 비발동. |
| **C7** | synth 가설 bullet + 응답 키 양방향 | **4** | (a) 가설 어휘 trigger 가 광범위(~시/~라면/~넘으면/~발효되면) — 일반 SOP 질의에서 의도외 발동 가능. (b) "결정 단어 한 단어 이상 포함" 강제가 sentinel 외 케이스에서 부자연스러운 답 유도 가능. (c) 응답 키 양방향 해석은 환각 가드 강화. | 8th. sentinel LG-4-01 PASS + cat7 환각가드·cat5 비도메인 무회귀. |
| **C8** | `DECISION_RE` 확장 + `DECISION_RE_WEAK` | **2** | runner.py 만 변경. sentinel·freevar 평가 기준만 영향. `expect_decision=false` 케이스 무관. WEAK 단독 매치 차단으로 false-positive 차단. | 9th. freevar cat4 PASS율 측정 (목표 ≥60%). |

### 5.1 머지 순서 권고

**점진 적용 권고**:

```
C1 → C2 → C3 → C5-pre → C4 → C5 → C6 → C7 → C8
```

- 각 커밋 머지 후 Stage I·II 회귀 게이트 PASS → 다음 커밋 진행.
- C3 와 C7 은 응답 키 호환성으로 묶임 — **두 커밋 동시 머지 (분리 머지 금지)** 또는 C3 → C7 사이를 짧게 유지 (운영 중 새로운 `{warnings:[]}` 응답을 LLM 가 해석 못 하는 기간 최소화).
- 권장 PR 전략: **단일 PR 9 hunks → 8 커밋, squash-merge 가 아니라 8 커밋 그대로 머지** (git log 추적성 + §4 격리 revert 가능성 확보).

### 5.2 종합 위험

- 최고 위험 등급: **C5·C7 (4)** — monitorOverview false-positive 와 가설 bullet trigger 광범위.
- 격리 가능 커밋: C4 (싱글 revert 안전, §4 의사코드 검증).
- 누적 위험: 단일 PR 9 hunks 변경 면 (assistant.js 6 + runner.py 1 + helper 1 + 시그니처 변경 1) → 리뷰 부담 ↑. 8 커밋 분리로 hunk 별 검토 권고.

---

## 6. PR 본문 초안

```markdown
## feat: sentinel 4 결함 일괄 직타 (ANG-2-01b · LG-1-01 · LG-4-01 · MOF-4-01)

### Description
Phase 2b sentinel 평가셋의 잔존 결함 4건을 단일 PR 8커밋으로 일괄 직타.

- **ANG-2-01b** — 부이 follow-up 에서 `focus.buoy` 만 있고 `focus.coords` 가 비면 zone 기반 도구로 잘못 라우팅되어 빈 응답. `buoyToCoords` 헬퍼 + `deriveFocus` coords 폴백 + runBrain 부이 follow-up 강제 호출 블록으로 해결.
- **LG-1-01** — local_gov 사용자가 "관내/우리시" 같은 모호어로 물으면 LLM 이 planQuery 규칙 #23 을 무시해 web_search 폴백으로 빠짐. `TOOL_EXEC.get_warning` 전국 집계 분기 + runBrain LG 강제 호출 블록 + `isDomainQuery` 의 `monitorOverview` AND-narrow 보강으로 해결.
- **LG-4-01** — "풍랑특보 시 해수욕장 운영?" 같은 가설 조건 SOP 질의에서 결정 단어가 누락. synth prompt 에 "가설·조건문" bullet 추가 + get_warning 응답 키 양방향 해석 명시로 해결.
- **MOF-4-01** — "파고 2m 어업관리 권고?" 같은 단정 정량 질의에서 임계표가 prompt 후순위에 묻혀 무시. `buildPersonalContext` 의 `enrichedTdig` unshift + `NUM_UNIT_RE` trigger 로 해결.

8 커밋 (C1~C8). 모든 커밋이 한 PR 안에 묶인 이유는 `충돌 점검 §1.3 #3` 참조 — A·B 가 분리 머지되면 LG-4-01 의 두 결함 중 하나만 해소되어 회귀.

### Commits
| # | 메시지 | 위험 | 검증 |
|---|------|-----|-----|
| C1 | helper: add buoyToCoords | 1 | lint·unit |
| C2 | focus: derive buoy coords from BUOY_BY_ID | 2 | ANG-2-01a |
| C3 | tools: get_warning supports nationwide aggregate | 3 | zone 지정 호출 N=5 |
| C5-pre | brain: declare shared constants once at runBrain entry | 1 | lint·grep |
| C4 | brain: buoy follow-up fallback for wind/vis/temp/wave | 3 | ANG-2-01b PASS |
| C5 | brain: local_gov vague-area force-call + isDomainQuery monitorOverview AND-narrow | 4 | LG-1-01 PASS + S3 점검 |
| C6 | personal: threshold rule accepts numeric/hypothetical | 3 | MOF-4-01 PASS |
| C7 | synth: hypothetical conditional bullet + bidirectional response-key parsing | 4 | LG-4-01 PASS |
| C8 | eval: extend DECISION_RE with SOP vocabulary | 2 | freevar cat4 ≥ 60% |

### Test Plan
- [ ] **Stage I**: sentinel 4 직타 (ANG-2-01b · LG-1-01 · LG-4-01 · MOF-4-01) 4/4 PASS
- [ ] **Stage II**: sentinel 잔여 18건 18/18 유지 (회귀 0)
- [ ] **Stage III**: 평가셋 N=3
  - phase2b_sentinel.jsonl (N=20): 20/20 (낙관) ~ 18/20 (보수, 95% SLA)
  - phase2b_eval.jsonl: 기존 PASS율 ±2pp
  - phase2b_eval_freevar.jsonl (N=440): cat4 ≥ 60%, cat2 +5~17pp, cat1·5·7 ±2pp
- [ ] **Stage IV**: 자유변칙 교집합 수동 N=3
  - cat2 ∩ cat4: "거기서 출항해도 돼?" (S2)
  - LG × 정량: "우리 시 관할 풍랑 떴어?" (S4)
  - 모니터링 직군 × 비도메인: "회식 어때" (S3)
- [ ] **추가 가드**: TTS 음성 출력 ("파고 3m") N=3 샘플 정합 확인
- [ ] **추가 가드**: `needsReplan` results 6개 cap 안전 (plan.steps 평균 1~2 + C4 의 +2 ≤ 6)

### Risks
- **S1 (응답 길이 ↑)**: LG-4-01 변형 케이스에서 가설답 + 부기로 답 길어짐. synth "간결히" 규칙으로 완화. KPI 답변 길이 게이트 점검.
- **S2 (부이 군집 결과로 SOP 결정 반복)**: cat2 ∩ cat4 교집합 — 수동 N=3 점검 필요.
- **S3 (monitorOverview false-positive)**: AND-narrow 적용해도 5 직군 사용자의 "관내 어때" 잡담 위험. **수동 N=3 점검 필수** — 본 PR 의 최고 위험.
- **S4 (LG-1 ∩ LG-4 정보 혼합)**: "관내 풍랑특보 시 운영 가능?" 같이 두 패치 동시 trigger 케이스 — synth "핵심만" 규칙으로 완화.
- **S5 (`activeCount` 환각)**: B C7+ bullet 에 "수치 데이터 아님" 명시 — 안전.
- **S6 (runner-synth drift)**: 단일 PR 묶음으로 자연 해소.
- **S7 (리뷰 부담)**: 8 커밋 분리 — git log 추적성 확보.

### Rollback Plan
- **단일 커밋 격리 revert 가능 커밋**: C4 (부이), C5 (LG)
- **C4 단독 revert**:
  - ANG-2-01b 회귀 (sentinel 19/20)
  - freevar cat2 ~10~17pp 하락
  - 그 외 무영향 — 격리 안전
- **C5 단독 revert**: LG-1-01·LG-4-01 동시 회귀 (sentinel 18/20)
- **C3 와 C7 동시 revert 필수 조건**: get_warning 응답 키 호환성 — 한쪽만 revert 시 synth 가 새 키 해석 못 함
- **전체 PR revert**: 모든 회귀 발견 시 안전한 fallback

### Validation Evidence
- `alpha_patch_A_impl.md` (C1~C5 실코드 diff)
- `alpha_patch_B_impl.md` (C6~C8 실코드 diff)
- `patch_synthesis.md` (8커밋 권고 + S1~S7 위험 분석)
- 본 문서 `alpha_synthesis_R2.md` (충돌 점검 + 머지 순서 + 롤백 의사코드)
```

---

## 7. 종합 — 신규 결정 (R2 라운드)

A·B 산출물이 이미 synthesis §1.3 의 봉합 4건을 흡수했으므로 R2 라운드에서 *신규로 추가된 결정*은:

1. **머지 순서 확정**: `C1 → C2 → C3 → C5-pre → C4 → C5 → C6 → C7 → C8` (총 8 커밋, 9 hunks).
2. **C3 ↔ C7 동시 머지 강제**: get_warning 응답 키 호환성. 분리 머지 시 LG-4-01 회귀.
3. **C4 격리 revert 가능 확인**: §4 의사코드 — sentinel 19/20, freevar cat2 −10~17pp, 그 외 무영향.
4. **위험 등급표**: C5·C7 = 4 (최고), C3·C4·C6 = 3, C2·C8 = 2, C1·C5-pre = 1.
5. **PR 본문 초안** §6 — Description / Commits / Test Plan / Risks / Rollback / Validation Evidence 6부.
6. **monitorOverview false-positive (S3)**: 수동 N=3 점검을 머지 전 필수 게이트로 격상.
7. **B C7+ bullet 의 `warning:null` 가설 불일치**: 실제는 `warning:null` 도 포함되나 LLM 가 null 무시 → 무해. PR 본문 §검증에 명시.

---

**한 줄 요약 — 핵심 충돌 3개 + 권고 적용 순서**:
충돌 ①C3 의 get_warning 응답 키 변경 ↔ C7+ 의 prompt 가설 정합(`warning:null` 포함하므로 무해, C3·C7 동시 머지 필수), ②C4·C5 신규 블록의 L1502 직후 삽입 순서(부이→LG 고정, `_buoyPlanTools`/`_lgPlanTools` 식별자 분리로 안전), ③B C7 가설 bullet 의 효과가 A C5 의 `get_warning({})` 결과 객체에 의존(A·B 분리 머지 금지) — 권고 적용 순서: **C1 → C2 → C3 → C5-pre → C4 → C5 → C6 → C7 → C8**, C5·C7 가 위험 등급 4 로 monitorOverview false-positive 수동 N=3 점검을 머지 전 필수 게이트로 격상.
