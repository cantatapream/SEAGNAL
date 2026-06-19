# G2 — 매트릭스 룰 제거 분류 (JIKGUN_RULES·R1~R12·ZONE_alias·EXPECT_TOOLS_MIN 등)

## 0. 분류 범례

| 카테고리 | 의미 | 코드 처리 |
|----------|------|-----------|
| **REMOVE** | LLM brain 자율로 동일 효과. 회귀 위험 ≤ 5%. | 코드 삭제, prompt 한 줄도 불필요. |
| **MOVE-TO-PROMPT** | 효과는 필요하나 코드 매트릭스 아닌 prompt 자연어 가이드라인으로 충분. | 코드 삭제, planQuery 시스템 prompt 에 1~2줄 추가. |
| **KEEP-GUARD** | LLM 자율 가능성 60~85% 이지만 회귀 risk 가 무겁다. 결정론 안전판 유지. | 그대로 둠. |
| **KEEP-DATA** | 룰이 아니라 외부 표준(기상청 코드 등) 데이터 매핑. 룰 제거 논의 무관. | 그대로 둠(단 alias 12 키만 분리 평가). |

회귀 검증 기준: phase2b_sentinel.jsonl + v5_run5_freevar 의 케이스 IDs.

---

## 1. 매트릭스 6 종 개요 (위치 · 라운드 · 라인)

| # | 매트릭스 | 라인 | 라운드(추가 이유) | 현재 효과 | 분류 결론 |
|---|----------|------|-------------------|-----------|-----------|
| M1 | `R_TABLE` (R1~R12 12 룰) | 1544-1558 (15 라인) | 5차 #31 P_multitool — multi-tool 보장. | planQuery prompt 에 직군+활동 매칭 룰만 노출. | **MOVE-TO-PROMPT** |
| M2 | `COMMON_RULES` | 1566 (1 라인) | 7차 C2 — `R4·R5` 회귀 복구. | 모든 직군에 R1·R7 강제. | **MOVE-TO-PROMPT** (M1 과 함께) |
| M3 | `ACTIVITY_RULES` (12 정규식) | 1567-1580 (14 라인) | 7차 C2 — 직군 무관 활동 어휘 매칭. | "다이빙" → R4, "요트" → R5 강제. | **MOVE-TO-PROMPT** |
| M4 | `JIKGUN_RULES` (8 직군) | 1582-1591 (10 라인) | 7차 C2 — 12 룰 전체 노출 토큰 -18%. | 직군별 핵심 룰 3.3 평균. | **MOVE-TO-PROMPT** |
| M5 | `ZONE_NAME_TO_CODE` 광역 alias 12 키 | 560-565 (6 라인, 일부) | 6차 #36 P36 — "동해광역" 같은 비표준 어휘 정규화. | "동해광역" → '12C20100' 매핑. | **REMOVE** (룰 아님, 표준 어휘 강제 = 룰 효과) |
| M5b | `ZONE_NAME_TO_CODE` 본체 (기상청 표준명) | 513-559 (46 라인) | 1차 (KMA 정적 데이터) | 표준 해역명 ↔ 구역코드. | **KEEP-DATA** |
| M6 | `EXPECT_TOOLS_MIN` (8 직군 floor) | 1741-1750 (10 라인) | 5차 #31 P_multitool — multi-tool 분기 발동 조건. | 직군별 floor (예 fishery=3) 미충족시 보강. | **KEEP-GUARD** (회귀 risk 큼) |
| M7 | `FOCUS_ZONE_ARG` (13 도구 args 매핑) | 1889-1903 (15 라인) | 4차 #27 — 후속 focus.zone 도구별 정확 주입. | get_visibility→'place', get_tide→'place', get_fishing_index→'location' 등. | **KEEP-GUARD** (도구 스키마 종속 — LLM 환각 위험) |

**원시 매트릭스 합계: ~117 라인** (주석 제외 ~95 라인).

---

## 2. 매트릭스별 상세 분석

### M1. R_TABLE (R1~R12) — MOVE-TO-PROMPT

**정확한 효과**
- planQuery 시스템 prompt 의 "다중 도구 패턴" 섹션에 직군+활동 매칭 룰 텍스트를 삽입.
- 예: `R4 marine_leisure + "다이빙/스쿠버" :: get_visibility + get_buoy_observation`.
- LLM 이 룰 ID 를 따라 도구 합집합(중복 제거)을 steps 에 채우게 유도.

**LLM 자율 가능성**: 75%.
- Gemini brain 은 "다이빙 갈 수 있을까?" 입력 시 visibility 가 가장 핵심임을 자율 인지 가능 (학습 데이터에 다이빙 = 수중 가시거리 강한 상식).
- 하지만 `get_buoy_observation` 동시 호출은 "다이빙 = 부이 실측" 이라는 SEAGNAL 고유 도메인 규칙. LLM 추론 신뢰도 50% 이하.
- 도구명 자체가 다소 비대칭(get_visibility 는 자명, get_buoy_observation 은 자율 호출 모호).

**제거 시 회귀 sentinel/v5 케이스**
- phase2b_sentinel: ML-DIV-01 (다이빙 visibility), ML-YACHT-02 (요트 zones_ranked).
- v5_run5: marine_leisure cat=3 multi-tool 성공률 -8pp (정확히 7차 C2 가 복구한 수치).

**prompt 한 줄 대체 가능?**: 가능. 12 룰 텍스트 → 1 줄.
> "다중 도구가 필요한 도메인 질의(예: 다이빙/요트/낚시/태풍/특보 종합) 면 forecast+warning 을 기본 페어로, 활동 어휘에 맞는 보조 도구(visibility·tide·surfing_index·typhoon_status 등)를 합쳐 steps 에 채우세요."

**라인 절감**: 15 (코드) → 3~5 (prompt). 순절감 ~10 라인.

---

### M2. COMMON_RULES — MOVE-TO-PROMPT (M1 과 함께)

**효과**: R1 (forecast+warning) · R7 (typhoon+warning) 을 모든 직군에 강제 노출.
**LLM 자율**: forecast+warning 페어는 LLM brain 이 직군 무관 거의 자율 도출 가능 (안전판단형 상식). R7 태풍은 질의에 "태풍" 어휘 있을 때만 자율로 잡힘 — 충분.
**회귀 risk**: 낮음. M1 prompt 가이드라인이 흡수.
**라인 절감**: 1.

---

### M3. ACTIVITY_RULES (12 정규식) — MOVE-TO-PROMPT

**효과**: 직군과 무관하게 query 의 어휘 매칭으로 룰 동적 추가.
- `다이빙/스쿠버` → R4, `요트/카약` → R5, `갯바위/포인트` → R2 등.

**LLM 자율 가능성**: 80%.
- 정규식 12 개 모두 LLM 학습 데이터에 풍부한 활동 어휘. Gemini 가 "다이빙"="시정" 매핑 자율 가능.
- 단 ACTIVITY_RULES 는 **prompt 의 매트릭스 텍스트 노출량을 늘려서** LLM 의 결정론적 도구 선택을 강화하는 메커니즘이지, 정규식 자체가 어떤 hard logic 도 아님.

**제거 시 회귀**: 7차 C2 복구분의 50% (활동 어휘 측). marine_leisure cat=3 multi-tool 회귀 -3~5pp 예상.

**prompt 한 줄 대체**: 가능. "활동 어휘(다이빙·요트·서핑·낚시·수색·태풍·잠수함·정책·해수욕장·재난·관내)가 질의에 있으면 해당 도메인 도구를 우선 합집합." (M1 통합).

**라인 절감**: 14.

---

### M4. JIKGUN_RULES (8 직군 매핑) — MOVE-TO-PROMPT

**효과**: 직군 → 핵심 룰 ID 배열. `marine_leisure: ['R3', 'R4', 'R5']`.

**LLM 자율 가능성**: 70%.
- profile 의 jikgun 은 이미 별도 prompt 라인에 노출되어 있음 (planQuery 입력의 직군 컨텍스트). LLM 이 "navy" 인지하면 잠수함·수심 자율 연상 가능.
- 하지만 `mof → R9 midterm_forecast` 같은 매핑은 SEAGNAL 도메인 특수. LLM 신뢰도 60%.

**제거 시 회귀**: M1·M3 와 결합 제거 시 -5~10pp 가능. 단독 제거는 prompt 직군 라인이 흡수.

**prompt 대체**: 가능. M1 텍스트에 "[직군 angler] R2 핵심 …" 같이 풀어 적기. 또는 더 압축적으로 직군별 도구 1~2 줄 가이드.

**라인 절감**: 10.

---

### M5. ZONE_NAME_TO_CODE 광역 alias 12 키 — REMOVE

**현재 동작**
- `'동해광역': '12C20100'` 등 광역/전역/권역/전체 4 토큰 × 동해/서해/남해 3 권역 = 12 키.
- 사용자가 "동해광역" 입력 시 `detectZoneDeterministic` 의 Stage 3 nqTokens (≥2 임계) 통과 + ZONE_NAME_TO_CODE 매핑으로 '12C20100' = '동해중부앞바다' 대표 zone 으로 정규화.

**이게 데이터인가 룰인가?**
- KEEP-DATA 처럼 보이지만, **본질은 룰**:
  - 기상청 표준 명에는 "동해광역" 같은 어휘가 **존재하지 않음**. 코드 6 차에서 인공 alias 추가한 것.
  - 데이터 매핑이 아니라 "광역 어휘를 들으면 중부 대표를 쓴다" 는 **결정론 룰**.

**LLM 자율 가능성**: 90%.
- LLM brain 이 "동해광역" 들으면 "동해 전반 답을 주거나, 어느 구역(북부/중부/남부) 인지 명확화 요청" 이라는 자연스러운 대응이 더 사용자 친화적.
- 강제 중부 매핑은 **사용자의 광역 의도를 임의로 좁히는 부작용** (남부 거주자가 "동해광역" 하면 강원 답을 받는 UX 손해).

**제거 시 회귀 sentinel/v5 케이스**
- p36_zone_debug 의 alias 통과 케이스 (광역/전역/권역/전체 12 키).
- v5_run5 freevar 에서 비표준 광역 어휘 케이스 (~3% 의 비도시 사용자).

**대체 전략**
- 코드 제거 + planQuery prompt 에 "광역/전역/권역/전체 어휘만 있고 구체 지역이 없으면, 직군 default zone 또는 가장 가까운 권역을 쓰고 답변 끝에 '북부/중부/남부 중 어느 곳을 원하시나요?' 명확화 초대를 포함." (1 줄).
- detectZoneDeterministic 의 `REGION_DIR_RE` 의 광역/전역/권역/전체 4 토큰만은 보존(Stage 3 nqTokens 안정성).

**라인 절감**: 6 (alias 키만, 본체 46 라인 유지).

---

### M5b. ZONE_NAME_TO_CODE 본체 (기상청 표준) — KEEP-DATA

**근거**
- 라인 513-559 의 기상청 단기예보 구역코드 정적 매핑 (예: '울산앞바다': '12C10101').
- 변경 빈도 거의 0. LLM 자율 불가 (특정 8 자리 코드는 LLM 환각 100%).
- forecast.js 와 동일 표 (이중 정의는 별도 모듈화 이슈, G1 영역).

**분류**: KEEP-DATA. 매트릭스 룰 정리 대상 아님.

---

### M6. EXPECT_TOOLS_MIN (직군별 floor) — KEEP-GUARD

**현재 동작**
- 8 직군 × { min: 2~3, hint: [...] } 매핑.
- `needsReplan` 함수가 multitool 분기에서 `realCount < minSpec.min` 이면 `pickMissingTools` 결정론 보강 호출 (cap=2, LLM 호출 0).
- fishery: 3, 나머지: 2.

**LLM 자율 가능성**: 60%.
- LLM brain 이 직군 인지하고 1차에서 도구 2~3 개 자율 호출은 종종 가능. 하지만 brain 이 단일 도구 plan 으로 끝내는 회귀 case 가 v5_run3·4 에서 반복 관찰됨.
- `pickMissingTools` 는 **LLM 호출 0** 의 비용 자유로운 안전판. 제거하면 회귀 시 재호출 토큰 ↑.

**제거 시 회귀**
- P_multitool synthesis 의 핵심 가드. 제거 시 fishery cat=2 multi-tool -10pp 이상 예상.
- 7차 C2 복구분과는 별개 layer (M1~M4 가 1차 plan 강화, M6 는 결과 검사 후 보강).

**대체 가능성**
- 완전 제거는 비추. floor min 만 prompt 로 "직군별 안전 도구 페어는 forecast+warning 기본" 으로 옮기되, hint 배열 + needsReplan 보강 로직은 KEEP.
- 8 직군 × 2 필드 = 16 항목은 매트릭스 dataset 이라기보다 결정론 fallback 의 입력. **알고리즘 일부**.

**분류**: KEEP-GUARD (코드 유지). 라인 절감 0.

---

### M7. FOCUS_ZONE_ARG (13 도구 args 매핑) — KEEP-GUARD

**현재 동작**
- `{ get_marine_forecast: 'zone', get_visibility: 'place', get_tide: 'place', get_fishing_index: 'location', get_surfing_index: 'beach', get_seafog_cctv: 'harbor', ... }`.
- 후속 질문 시 focus.zone 을 도구마다 다른 인자 이름에 정확히 주입.

**LLM 자율 가능성**: 30%.
- 도구 스키마(arg 명) 는 SEAGNAL 의 MCP 서버 고유. LLM 이 학습 데이터에서 "get_fishing_index 는 location 인자" 같은 정확한 매핑을 환각 없이 알 확률 낮음.
- 도구 정의(JSONSchema) 가 prompt 에 포함된다면 LLM 신뢰도 50~70% 까지 상승 가능. 하지만 **후속 focus 주입은 LLM 호출 없이 코드 결정론적 처리** — 환각 layer 자체가 끼지 않음.
- 따라서 매트릭스가 아니라 **도구 스키마 매핑 테이블**.

**제거 시 회귀**
- focus continuity 의 핵심 (4 차 #27 케이스 전체). 후속 질문 정확도 -15~25pp 예상.

**분류**: KEEP-GUARD (코드 유지). 룰 매트릭스 아니라 도구 스키마 종속 매핑.

---

## 3. 광역 alias 12 키 특별 분석 (M5 심층)

| 관점 | KEEP-DATA 논거 | REMOVE 논거 |
|------|----------------|-------------|
| 기상청 표준성 | "코드 매핑이라 데이터" | "기상청 명세에 광역/전역/권역/전체 어휘 없음 — 인공 alias" |
| 사용자 어휘 | "비표준 입력 정규화" | "LLM 이 '동해광역' 들으면 직군 default + 명확화 초대가 더 자연스러움" |
| 회귀 risk | "광역 어휘 케이스 ~3%" | "잘못된 중부 강제 → 남부 사용자 UX 손해" |
| LLM 자율 | "결정론 매핑 안전" | "LLM brain 이 광역 모호성을 사용자 친화적으로 처리 (90%)" |
| 코드 라인 | 6 라인 | 절감 가능 |

**결론**: **REMOVE**.
- 본질은 "광역 어휘 = 중부 대표" 라는 룰. 데이터 가장한 룰.
- detectZoneDeterministic 의 REGION_DIR_RE 광역/전역/권역/전체 4 토큰은 보존 (Stage 3 안정성).
- planQuery prompt 1 줄 가이드라인이 흡수.
- 회귀: phase2b_sentinel 광역 케이스 0~1 개 이내, v5 freevar 광역 케이스 ~3% (UX 측면에서 오히려 개선).

---

## 4. EXPECT_TOOLS_MIN 심층 (M6)

**제거 시도 시 시나리오**
1. LLM brain 만으로 직군 floor 보장 가능?
   - fishery 가 "동해 어때" 입력 시 brain 자율로 forecast+warning+tide 3 개 호출할 확률 ≈ 55%.
   - 나머지 45% 는 forecast 단일 plan → cat=2 multi-tool 회귀.
2. 보강 layer 제거하면 평균 도구 수 4.4 → 3.5 추정 (P_multitool 베이스라인 회귀).
3. 다만 EXPECT_TOOLS_MIN.hint 배열은 사실상 사용되지 않음 — `pickMissingTools` 가 직군별 특화 로직으로 다시 결정 (라인 1812-1827). hint 는 데드 필드.

**효과**: hint 필드 제거하면 5 라인 절감 가능 (8 직군 × 1 필드 + 주석). 단 min 필드는 유지.

**분류 최종**
- M6 본체: KEEP-GUARD.
- M6 hint 서브필드: REMOVE (데드 코드). 라인 절감 ~5.

---

## 5. 라인 절감 총합

| 매트릭스 | 분류 | 라인 절감 (코드) | 추가 prompt | 순절감 |
|----------|------|------------------|-------------|--------|
| M1 R_TABLE | MOVE | 15 | +3~5 | ~10 |
| M2 COMMON_RULES | MOVE | 1 | (M1 흡수) | 1 |
| M3 ACTIVITY_RULES | MOVE | 14 | (M1 흡수) | 14 |
| M4 JIKGUN_RULES | MOVE | 10 | (M1 흡수) | 10 |
| M5 광역 alias | REMOVE | 6 | +1 | 5 |
| M5b ZONE_NAME_TO_CODE 본체 | KEEP-DATA | 0 | 0 | 0 |
| M6 EXPECT_TOOLS_MIN 본체 | KEEP-GUARD | 0 | 0 | 0 |
| M6-hint 서브필드 | REMOVE (데드) | 5 | 0 | 5 |
| M7 FOCUS_ZONE_ARG | KEEP-GUARD | 0 | 0 | 0 |
| `buildMatrixSection` 함수 | (M1~M4 와 함께 제거) | ~13 | 0 | 13 |
| **합계** | — | **~64** | **+4~6** | **~58** |

추가 로직 정리분: `buildMatrixSection` 호출 라인 + planQuery 내부 인용 정리 추정 +5 라인. **총 ~63 라인 순절감**.

---

## 6. 회귀 위험 매트릭스

| 회귀 sentinel | 영향 매트릭스 | 위험도 | 완화 |
|---------------|---------------|--------|------|
| phase2b_sentinel ML-DIV-01 (다이빙 vis+buoy) | M1·M3 | 중 | M1 prompt 한 줄 ("다이빙 → visibility + buoy 같이") |
| phase2b_sentinel ML-YACHT-02 (요트 zones_ranked) | M1·M3 | 중 | 동상 |
| phase2b_sentinel ANG-FISH-01 (낚시 tide) | M1·M4 | 낮 (anglerprofile 자체로 자율) | — |
| v5_run5 cat=3 multi-tool 율 | M1~M4 합본 | 중-고 | EXPECT_TOOLS_MIN(M6) 보강 layer 가 흡수 |
| v5_run5 fishery floor | M6 | 고 (제거 시) | M6 KEEP — 위험 없음 |
| p36_zone_debug 광역 alias | M5 | 낮 | LLM 명확화 초대로 UX 오히려 개선 |
| ANG-2-01b 부이 follow-up 풍속 | M7 | 고 (제거 시) | M7 KEEP — 위험 없음 |
| 후속 focus continuity (#27) | M7 | 고 (제거 시) | M7 KEEP — 위험 없음 |

**핵심 회귀 시나리오**: M1~M4 통합 MOVE 시 cat=3 multi-tool 율 -3~8pp 가능. **M6 KEEP-GUARD 가 결정론 보강으로 차폐**. 통합 회귀 ≤ 2pp 추정.

---

## 7. 권장 적용 순서 (참고)

1. M5 광역 alias 6 라인 제거 + REGION_DIR_RE 광역 토큰만 보존 (저위험·즉시).
2. M6 hint 서브필드 5 라인 제거 (데드 코드).
3. M3 ACTIVITY_RULES 제거 + M1 prompt 활동 어휘 한 줄 (중간 위험, sentinel 재검).
4. M2·M4·M1 함께 MOVE — 전체 prompt 가이드라인 1 절로 재구성 (5~10pp 회귀 모니터링).
5. `buildMatrixSection` 함수 자체 삭제.

각 단계마다 phase2b_sentinel + v5_run quick 재검 필수.

---

## 8. KEEP 항목 요약 (제거 금지)

- **M5b ZONE_NAME_TO_CODE 본체** (513-559) — 기상청 정적 데이터, LLM 환각 100%.
- **M6 EXPECT_TOOLS_MIN.min** — multi-tool 회귀 차폐 보강 trigger.
- **M7 FOCUS_ZONE_ARG** — 도구 스키마 종속, focus continuity 핵심.
- **detectZoneDeterministic 본체** — REGION_DIR_RE Stage 1~3 알고리즘 (분류 대상 아님).

---

## 9. 최종 분류 요약

- **REMOVE (2)**: M5 광역 alias 12 키, M6 hint 서브필드.
- **MOVE-TO-PROMPT (4)**: M1 R_TABLE · M2 COMMON_RULES · M3 ACTIVITY_RULES · M4 JIKGUN_RULES (planQuery prompt 1 절 통합).
- **KEEP-GUARD (2)**: M6 EXPECT_TOOLS_MIN.min · M7 FOCUS_ZONE_ARG.
- **KEEP-DATA (1)**: M5b ZONE_NAME_TO_CODE 본체.

**순 라인 절감**: ~58~63 라인 (assistant.js 2892 → ~2830, -2.2%).
**최대 회귀 risk**: cat=3 multi-tool -3~8pp (M6 보강으로 ≤ 2pp 차폐 예상).
