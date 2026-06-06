# #37 δ p95 게이트화 사이클 — prompt 다이어트 시점 A 설계

> 상태: **설계만**. 코드 0 수정. 본 문서는 길이 측정 의사코드·압축 후보·예상 p95 단축·회귀 위험만 제공한다.
> 작성: 2026-06-05 · 대상: v5 1회차 net p95=6120ms (DoD 5000ms 초과) → 5차 라운드 누적분(#31 multitool +1680ms 등) 합산 추정 7800ms 의 입력 토큰 축소를 통한 p95 단축 1차 사이클.
> 가드: 코드 수정 금지. 신규 md 1개. v5 측정 결과(정량 75%·SEC 5/5·연속 48%) 회귀 0 유지.

---

## 0. 한눈에 (다이어트 6축)

| 축 | 결정 | 예상 효과 | 회귀 위험 |
|---|---|---|---|
| 1 | 현 planQuery·synth·personal prompt 토큰 측정 의사코드 — `usageMetadata.promptTokenCount` 직읽기 + 정적 char 길이 추정 폴백 | 1500~3000 토큰 추정 → 측정 1회 후 실측 락 | 0 (측정만) |
| 2 | R1~R12 매트릭스 압축 — 직군 매핑 단일 룰만 인라인, 나머지 룰은 외부 상수표로 참조 | -350~500 입력 토큰(planQuery -25%) | 낮 (도구 floor 보강은 결정론 pickMissingTools 가 백업) |
| 3 | synth 룰 압축 — 환각/CoT/컨텍스트격리/비기상거절/정량/가설 6 bullet 중복 표현 단축, "절대 금지"→"금지" | -250~400 입력 토큰(synth -15%) | 중 (가설 bullet C7 의 결정 단어 강제 문구 약화 시 정량 회귀) |
| 4 | buildPersonalContext 다이어트 — memory 5→3 슬라이스, 임계표 직군 1개만, profile 핵심 필드만 JSON.stringify(slice 200) | -150~300 입력 토큰(personal -40%) | 중 (memory 5→3 축소가 #30 자연어 후속 연속성 회귀 위험) |
| 5 | 예상 p95 단축 — 입력 토큰 -30% × Gemini flash-lite 처리 시간 선형 가정 → -800~1500ms | 7800ms → **6300~7000ms** | DoD 5000ms 여전 초과 — #37-B 병렬화 필수 |
| 6 | 회귀 가드 — 다이어트 적용 전후 sentinel(LG-4-01·MOF-4-01·ANG-6-03b) + 자유변칙 cat2·cat4·cat6 PASS율 측정 의무 | 회귀 감지 시 단계별 revert (axis 2/3/4 분리 커밋) | 0 (게이트 통과 시만 머지) |

**한 줄 요약**: 입력 토큰을 R1~R12 직군별 단일 룰 + synth 표현 단축 + personal memory 3개 슬라이스로 **-30% 압축**해 p95 7800ms → 6300~7000ms (DoD 미달 — #37-B 병렬화 필요), 회귀 위험은 axis3(synth) > axis4(personal) > axis2(매트릭스).

---

## 1. 현 prompt 길이 측정 의사코드 (axis 1)

### 1.1 측정 대상 3개

| 영역 | 함수/위치 | 누적 패치 (현 추정) |
|---|---|---|
| planQuery 시스템 prompt | `routes/assistant.js` `planQuery()` L1504~1620 (prompt template L1571~1613) | TOOL_CATALOG + CATALOG_DIGEST + R1~R12 매트릭스(L1591~1605) + 직군 floor(L1606~1608) + locLine/pzLine/focusLine/memLine/jikgunLine/vocabLine/simLine/toolSimLine |
| synth prompt | `routes/assistant.js` L2039~2058 (template L2040~2058) | 환각금지·CoT 누수금지·컨텍스트 격리(#24)·비기상 거절(#28)·메타·정량(C7+)·가설(C7) + 출항 안전판단 |
| buildPersonalContext 출력 | `routes/assistant.js` `buildPersonalContext()` L846~893 (이후 synth L2056 inline 주입) | profile·jikgun·임계표(enrichedTdig, α C6 unshift)·style 다이제스트·memory 5건 |

### 1.2 측정 의사코드 (token_metering_design.md 기반)

```js
// (a) 실측 — Gemini usageMetadata.promptTokenCount 직접 활용
//   token_metering_design.md §2 의 extractUsage() 가 callGemini 반환에 usage 노출.
//   planQuery / synth / web 각 호출의 r.usage.input(=promptTokenCount) 를 따로 적재.
const planTokens = []; const synthTokens = []; const personalChars = [];

// planQuery 호출 직후
const r = await gemini.callGemini({ ..., caller: 'Assistant-Plan' });
if (r.usage) planTokens.push(r.usage.input);

// synth 호출 직후 (personal 은 synth template 안에 inline 합쳐짐 → synth.input 에 포함)
const r2 = await gemini.callGemini({ ..., caller: 'Assistant-Synth' });
if (r2.usage) synthTokens.push(r2.usage.input);

// personal 영역 분리 측정 — personal 문자열 char 길이를 따로 적재
//   (synth.input 에서 personal 차감 추정 — char→token 비 한국어 ~1.5)
personalChars.push(personal.length);   // personal = buildPersonalContext(...) 반환

// (b) 정적 폴백 — usage 미가용 시 char 길이 추정
//   한국어/혼합 prompt: char ÷ 1.5 ≈ token 수 (Gemini tokenizer 보수적 근사).
//   영문 위주: char ÷ 4. R1~R12 매트릭스 + synth bullet 은 한국어 위주 → 1.5 적용.
function estimateTokens(str, lang = 'ko') {
    const factor = lang === 'ko' ? 1.5 : 4;
    return Math.ceil((str || '').length / factor);
}

// (c) 측정 1회차 산출 형식
//   planQuery: p50 in_tok / p95 in_tok (n=440 자유변칙 1라운드 기준)
//   synth:     p50 in_tok / p95 in_tok
//   personal:  median chars / max chars (synth.input 의 약 N% 차지)
```

### 1.3 현 추정 토큰 수 (정적 char 폴백 — 측정 1회차 전 추정)

| 영역 | 핵심 구성 | 추정 char | 추정 token (÷1.5) |
|---|---|---|---|
| planQuery prompt 골격(R1~R12 + 직군 floor + 룰 18개) | L1571~1613 본문 | ~3600 | ~2400 |
| TOOL_CATALOG | L1022~ (~30 줄) | ~1500 | ~1000 |
| CATALOG_DIGEST | data_catalog.json 빌더 | ~400~800 | ~270~530 |
| locLine + pzLine + focusLine + memLine + jikgunLine + vocabLine | 동적 (없을 수도) | ~200~800 | ~130~530 |
| simLine + toolSimLine | 임베딩 매칭 (없을 수도) | ~100~400 | ~70~270 |
| **planQuery 합계** | | **~6000~7000** | **~4000~4700** |
| synth prompt 골격(8 bullet) | L2040~2055 | ~3200 | ~2130 |
| personal block | L846~893 (jikgun + threshold + style + memory) | ~600~1500 | ~400~1000 |
| 수집결과 JSON.stringify | results 4~6건 | ~800~2500 | ~530~1670 |
| **synth 합계** | | **~4600~7200** | **~3060~4800** |

**현 추정 입력 토큰 총합 (planQuery + synth)**: **~7000~9500 토큰/케이스**
(과거 token_metering_design.md §6 예시는 1370~3010 토큰 합계였으나 R1~R12·#24·#28·C7·#31 multitool 적용 후 2~3배 증가 추정.)

> ⚠️ **측정 락 의무**: 정적 추정은 폴백. 실측은 axis 1 의 (a) 의사코드를 적용한 1회 자유변칙 라운드 후 락. 추정 7000~9500 토큰이 실측 4000~5500 토큰 수준이면 다이어트 ROI 재산정 필요(작은 절댓값에서 -30% 효과 비례 축소).

---

## 2. R1~R12 매트릭스 압축 후보 (axis 2)

### 2.1 현 12 룰 구조 (planQuery L1591~1605)

```
R1  fishery/navy/coast_guard/local_gov/public_org/mof + "어때/상황/괜찮을까/전반/전체/관내/종합" → forecast+warning
R1+ fishery/coast_guard/navy + "출항/조업/출조" → +tide 또는 +current
R2  angler + "갯바위/포인트/방파제/원투/찌낚시/루어" → fishing_index+tide
R3  marine_leisure + "서핑/파도/라이딩" + 해수욕장 → surfing_index+forecast
R4  marine_leisure + "다이빙/스쿠버/프리다이빙/시정" → visibility+buoy
R5  marine_leisure + "요트/윈드서핑/카이트/카약" → forecast+ranked
R6  coast_guard + "수색/구조/출동/경비/방제" → warning+forecast (+typhoon)
R7  전 직군 + "태풍/진로/영향 권역" → typhoon+warning
R8  navy + "잠수함/수중/항로 수심" → depth+forecast
R9  mof/public_org + "정책/중기/주간" → forecast+midterm
R10 local_gov + "해수욕장/운영/통제/개장/폐장" → surfing+forecast+warning
R11 local_gov + "재난/방재/훈련/연안관리" → forecast+warning
R12 전 직군 + "관내/우리시" + 종합 → warning(전국)+forecast
```

추정 char ~1800 / token ~1200 (planQuery 의 약 25~30%).

### 2.2 압축 전략 — 직군별 선택적 주입

**핵심 발상**: 12 룰 중 *해당 직군이 매칭 가능한 룰만* prompt 에 동봉. 12 룰 동시 노출 → 직군별 평균 3~4 룰만 노출.

```
직군별 활성 룰 매핑 (jikgun → applicable rules):
  fishery        : R1, R1+, R7
  navy           : R1, R1+, R6, R7, R8
  marine_leisure : R3, R4, R5
  coast_guard    : R1, R1+, R6, R7
  local_gov      : R10, R11, R12, R7
  mof            : R1, R9, R7
  public_org     : R1, R9, R7
  angler         : R2, R7
  (미감지)        : R1, R7 (안전 폴백 — 최소 forecast+warning 페어)
```

### 2.3 의사코드

```js
// planQuery 시스템 prompt 안 매트릭스 부분 (L1591~1605) 를
//   동적 buildMatrixSection(jikgun) 로 교체.
const R_TABLE = {
    R1:  '[R1 monitoring + "어때/상황/괜찮을까/관내/종합"] :: get_marine_forecast + get_warning',
    R1p: '[R1+ fishery/coast_guard/navy + "출항/조업/출조"] :: 위 + get_tide 또는 get_current',
    R2:  '[R2 angler + "갯바위/포인트/방파제/원투/찌낚시/루어"] :: get_fishing_index + get_tide',
    R3:  '[R3 marine_leisure + "서핑/파도/라이딩" + 해수욕장] :: get_surfing_index + get_marine_forecast',
    R4:  '[R4 marine_leisure + "다이빙/스쿠버/프리다이빙/시정"] :: get_visibility + get_buoy_observation',
    R5:  '[R5 marine_leisure + "요트/윈드서핑/카이트/카약"] :: get_marine_forecast + get_zones_ranked(scope:"haegu")',
    R6:  '[R6 coast_guard + "수색/구조/출동/경비/방제"] :: get_warning + get_marine_forecast (+태풍 시즌: get_typhoon_status)',
    R7:  '[R7 + "태풍/진로/영향 권역"] :: get_typhoon_status + get_warning',
    R8:  '[R8 navy + "잠수함/수중/항로 수심"] :: get_depth + get_marine_forecast',
    R9:  '[R9 mof·public_org + "정책/중기/주간/이번 주"] :: get_marine_forecast + get_midterm_forecast',
    R10: '[R10 local_gov + "해수욕장/운영/통제/개장/폐장"] :: get_surfing_index + get_marine_forecast + get_warning',
    R11: '[R11 local_gov + "재난/방재/훈련/연안관리"] :: get_marine_forecast + get_warning',
    R12: '[R12 + "관내/우리시/시청 관할" + 종합] :: get_warning(zone="전국" 또는 비움) + get_marine_forecast',
};

const JIKGUN_RULES = {
    fishery:        ['R1','R1p','R7'],
    navy:           ['R1','R1p','R6','R7','R8'],
    marine_leisure: ['R3','R4','R5','R7'],
    coast_guard:    ['R1','R1p','R6','R7'],
    local_gov:      ['R10','R11','R12','R7'],
    mof:            ['R1','R9','R7'],
    public_org:     ['R1','R9','R7'],
    angler:         ['R2','R7'],
};

function buildMatrixSection(jikgun) {
    const keys = JIKGUN_RULES[jikgun] || ['R1','R7'];  // 미감지 안전 폴백
    const lines = keys.map(k => '  · ' + R_TABLE[k]);
    return '- **(다중 도구 패턴 — 직군 매칭 룰만)** 아래 매트릭스 중 하나라도 매칭되면 해당 도구들을 **모두** steps 에 넣으세요:\n' + lines.join('\n');
}
```

### 2.4 압축 효과 추정

| 직군 | 노출 룰 수 | 추정 char | 추정 token | 압축률 |
|---|---|---|---|---|
| fishery | 3 | ~450 | ~300 | -75% |
| navy | 5 | ~750 | ~500 | -58% |
| marine_leisure | 4 | ~600 | ~400 | -67% |
| coast_guard | 4 | ~600 | ~400 | -67% |
| local_gov | 4 | ~600 | ~400 | -67% |
| mof | 3 | ~450 | ~300 | -75% |
| public_org | 3 | ~450 | ~300 | -75% |
| angler | 2 | ~300 | ~200 | -83% |
| 미감지 폴백 | 2 | ~300 | ~200 | -83% |
| **평균** | **3.3** | **~500** | **~333** | **-72%** |

**axis 2 입력 토큰 절감**: 매트릭스 ~1200 → ~333 = **-867 토큰/케이스** (planQuery -18%).

### 2.5 우선순위 룰 압축 (보조)

기존 룰 끝에 "우선순위 R2 > R4 > R5 > R8 > R7 > R9 > R3 > R10 > R6 > R1 > R11 > R12" 한 줄이 있음 (~70 char). 직군별 단일 룰 노출 시 우선순위 모호성 거의 사라짐 → **삭제** 가능.

추가 절감: ~70 char ÷ 1.5 ≈ ~47 토큰.

---

## 3. synth 프롬프트 룰 압축 (axis 3)

### 3.1 현 8 bullet 구조 (L2040~2055)

| Bullet | 내용 | 추가 시점 | 추정 char |
|---|---|---|---|
| 환각금지 | "수집결과에 없는 수치/사실 절대 금지 …" + get_warning 응답 양방향(C7+) | 초기 + α C7+ | ~800 |
| CoT 누수금지 | "내부 사고 과정·추론 단계·메타 출력 금지" | #28 | ~200 |
| 컨텍스트 격리 | "[최근 대화]/[직전 확정 대상]/memory/focus/personal/profile 입력 블록·라벨 자체 출력 금지" | #24 | ~280 |
| 비기상·비도메인 거절 | "산재·법령·운용규정 등 → '그 정보는 우리 자료에 없어요'" | #28 | ~330 |
| 메타·자기요약 | "방금 결정 사유/한 줄 요약 → memory 마지막 항목 요약" | #33 | ~180 |
| 의사결정형 정량 | "출항/조업/훈련/작업 → 파고/풍속/특보 임계 기반 한 줄 가부" | α C6/C7 | ~280 |
| 가설·조건문 (C7) | "만약/~시/~라면 → SOP 가설답 2단 + 결정 단어 한 단어 이상 강제" | α C7 | ~430 |
| 전제 정정 | "사용자 단정 ≠ 수집결과면 수집결과 우선" | 초기 | ~120 |
| 일반 답변 규칙 | "간결, 표/마크다운/이모지 금지, 풍속 '초속 N미터', 유속 cm/s" | 초기 | ~350 |
| 안전판단 1회 | "○○ 정도라 (가능/주의/무리)…마지막에 '최종 판단은 선장님 몫' 1회만" | #35 | ~250 |

**총 추정**: ~3220 char ÷ 1.5 ≈ **~2150 토큰**.

### 3.2 압축 후보

#### (a) 중복 표현 단축
- "절대 금지" / "절대 지어내지 마세요" / "한 글자도 답에 포함 금지" / "절대 미포함" → 일괄 "금지" 통일 (~20 char × 6곳 = ~120 char 절감)
- "**(키워드)**" Markdown 강조 다수 → bullet 시작어로 충분, **··** 제거 가능 (~80 char)
- "(가능/주의/무리/위험/적합/권장/권고/통제/발령/허용/보류)" 결정 단어 리스트 중복 2회 → 1회 출현, 2회차 "(위 결정 단어)" 로 참조 (~80 char)

#### (b) get_warning 응답 양방향 한 줄 — **유지 필수** (α C3·C7+ 합의로 회귀 위험)
- 단어 단축은 위험. 원문 보존.

#### (c) 가설 bullet 결정 단어 강제 — **표현 단축 가능, 강제 유지**
```
변경 전: "결정 단어(가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 를 반드시 한 단어 이상 포함."
변경 후: "위 결정 단어 한 단어 이상 포함."
```
(-90 char)

#### (d) 의사결정형 정량 + 가설 bullet 의 중복 제거
- 두 bullet 모두 "임계 수치 + 결정 단어 + 현재 상태 한 줄" 패턴 → 정량 bullet 의 "예: 파고 ≥2m 또는 …" 구체 임계 예시는 임계표(personal context) 와 중복 → **임계표 참조**로 압축 가능.
- 가설 bullet 의 "임계표는 *외부 사실이 아니라 직군 표준 운용 기준*" 한 줄은 환각금지 모순 가드 → **유지 필수**.

#### (e) "음성 구어체 + 표/마크다운 금지 + 풍속 m/s 단위 변환" — **유지** (회귀 위험 높음 — 표 출력 시 TTS 깨짐)

#### (f) 안전판단 1회 정책 (#35) — 정량 bullet 과 거의 중복
- "지금 출항/조업해도 되냐 → …'최종 판단은 선장님 몫'" bullet 은 정량 bullet 의 후반 "최종 판단은 선장님 몫 한 번만" 과 중복.
- **압축안**: 정량 bullet 끝에 "(안전판단 결론 뒤 '최종 판단은 선장님 몫' 1회 부기 — 그 외 질문엔 미부기)" 인라인. 안전판단 1회 정책 bullet 삭제.
- 절감: ~250 char.

#### 추정 총 절감

| 항목 | char 절감 |
|---|---|
| (a) 중복 표현 단축 | -280 |
| (c) 결정 단어 리스트 참조 | -90 |
| (f) 안전판단 1회 bullet 삭제 + 정량 bullet 부기 | -250 (안전판단) + 80 (정량 부기) = -170 |
| (g) Markdown 강조 일괄 정리 | -80 |
| **합계** | **~-620 char ≈ -415 토큰** |

**axis 3 입력 토큰 절감**: synth ~2150 → ~1735 토큰 (-19%).

---

## 4. buildPersonalContext 다이어트 (axis 4)

### 4.1 현 구조 (L846~892)

| 필드 | 출력 | 추정 char |
|---|---|---|
| `[사용자 프로필]` profile JSON 전체 | `JSON.stringify(profile)` 전체 | ~200~600 |
| `[사용자 직군] {name} — 중시 주제: {interests.slice(0,8).join(', ')}` | jikgunDigest 8개 | ~120 |
| `═══ 직군 임계표 ═══` enrichedTdig (α C6) | thresholdDigest 전체 (직군 1개 임계표 + 운영규칙 1단락) | ~500~800 |
| `[사용자 성향]` 자주 보는 해역 3 + 관심 주제 3 + format + styleNote | top3 두 항목 + style | ~150 |
| `[최근 대화]` memory.slice(-5).join(' / ') | 최근 5건 (각 ~100 char 가정) | ~500 |
| 헤더 안내문 | "아래는 이 사용자에 대한 참고 맥락입니다 …" 2줄 | ~120 |

**총 추정**: ~1600~2300 char ÷ 1.5 ≈ **~1070~1530 토큰**.

### 4.2 압축 후보

#### (a) memory 5건 → 3건 슬라이스
```js
// 현재 (L887):
lines.push(`[최근 대화] ${memory.slice(-5).join(' / ')}`);
// 다이어트:
lines.push(`[최근 대화] ${memory.slice(-3).join(' / ')}`);
```
- 절감: ~200 char (memory 항목당 ~100 char × 2)
- **주의**: planQuery 도 memLine 에서 `memory.slice(-3)` 사용 (L1512) — synth 와 슬라이스 길이 정합 → 다이어트 후 둘 다 3 으로 통일됨.
- ⚠️ **#30 자연어 후속 연속성** (jikgun=비도메인 후속 "뽀로로파크→이용금액?") 이 memory 4~5 째 항목에 의존하면 회귀 가능 — sentinel 미커버 → axis 4 의 가장 큰 위험원.

#### (b) profile JSON 핵심 필드만
```js
// 현재 (L850):
lines.push(`[사용자 프로필] ${profileText}`);   // JSON 전체 (~200~600 char)
// 다이어트:
function profileSlim(profile) {
    if (typeof profile !== 'object' || !profile) return String(profile || '');
    const keep = ['jikgun', 'name', 'location', 'answerStyle', 'experienceYears'];
    return JSON.stringify(Object.fromEntries(
        keep.filter(k => profile[k] != null).map(k => [k, profile[k]])
    ));
}
lines.push(`[사용자 프로필] ${profileSlim(profile)}`);
```
- 절감: ~200 char (free-text 필드·온보딩 메타 제외)
- **주의**: profileDefaultZone(profile) 은 `profile.location.zone` 직접 참조 → profile 객체 자체는 보존, JSON 노출만 슬림화. `location.freeText` 는 detectZoneDeterministic 폴백에 사용 → 보존 필요. profileSlim 의 keep 리스트에 `location` 통째로 포함 (sub-tree 보존).

#### (c) threshold digest 직군별 1개만
- 현재 `thresholdDigest(slug)` 는 이미 직군 1개만 반환 (조회 결과). 운영 규칙 단락은 ~500 char.
- **다이어트 안**: enrichedTdig 의 운영 규칙 문장 단축.
```
변경 전: "** 규칙: 사용자 질의에 정량 수치(파고/풍속/시정/수온/파주기 + 단위 m·m/s·km·℃·s) 가 하나라도 명시되면 — 단정형("파고 1.5m") 이든 조건형("파고 2m 넘으면") 이든 가설형("풍랑특보 시") 이든 — 그 수치를 위 임계표 및 주의(직군 SOP) 와 비교해 *가부·권고 결론을 한 줄 먼저* 답하세요. …"
변경 후: "** 규칙: 정량 수치(파고/풍속/시정/수온/파주기 + m·m/s·km·℃·s) 가 질의에 있으면 임계표·SOP 와 비교해 가부 결론 한 줄 먼저. 결정 단어 1+ 포함. 도구 결과 부재해도 임계표만으로 답 가능 — 결론 뒤 '현 상태 미확인' 부기. '정보 없음' 단독 응답 금지. 임계표는 외부 사실 아닌 직군 SOP — 환각금지 위반 아님."
```
- 절감: ~250 char (약 -40%).

#### (d) style digest — 그대로 유지
- 자주 보는 해역 top3 + 관심 주제 top3 는 v3 → v5 회귀 가드 (개인화 직군 평가셋) — 압축 위험.

#### 추정 총 절감

| 항목 | char 절감 |
|---|---|
| (a) memory 5→3 | -200 |
| (b) profile slim | -200 |
| (c) threshold 운영규칙 단축 | -250 |
| **합계** | **~-650 char ≈ -430 토큰** |

**axis 4 입력 토큰 절감**: personal ~1070~1530 → ~640~1100 토큰 (-30~40%).

---

## 5. 예상 p95 단축 (axis 5)

### 5.1 입력 토큰 총 절감

| Axis | 절감 토큰 |
|---|---|
| 2 (R1~R12 매트릭스) | ~-870 |
| 2 (우선순위 룰) | ~-47 |
| 3 (synth) | ~-415 |
| 4 (personal) | ~-430 |
| **합계** | **~-1762 토큰** |

planQuery 입력 ~4000~4700 → ~3100~3800 (-19%).
synth 입력 ~3060~4800 → ~2220~3960 (-26%).
**총 입력 토큰**: ~7000~9500 → ~5300~7800 (**-24%**).

5차 라운드 누적 후 추정 7800ms 의 어디까지가 입력 토큰 비례인지 분해 필요:

| 시간 성분 | 추정 ms | 다이어트 영향 |
|---|---|---|
| planQuery LLM | ~1500 | 입력 -19% → -200ms |
| 도구 실행 (직렬 6 개) | ~3500 | 무관 (#37-B 병렬화 대상) |
| pickMissingTools 결정론 | ~50 | 무관 |
| #31 multitool 보강 호출 | +1680 (5차 신규) | 무관 |
| synth LLM | ~2500 | 입력 -26% → -500ms |
| 백오프 (외부 429) | 변동 | 무관 |
| 후처리 (cleanAnswer + guardScan) | ~70 | 무관 |
| **합계** | **~7800ms** | **-700~800ms** |

### 5.2 p95 단축 추정

- **낙관 시나리오** (입력 토큰 -30% × LLM 처리시간 선형 가정): 7800ms → **6100~6300ms**
- **보수 시나리오** (Gemini flash-lite 의 입력 토큰 응답시간 영향이 비선형, 출력 토큰·thinking 토큰이 지배): 7800ms → **6800~7100ms**
- **중간값**: **6500ms 전후**

### 5.3 DoD 충족 여부

| 지표 | 현 추정 | 다이어트 후 추정 | DoD | 충족 |
|---|---|---|---|---|
| net p95 | 7800ms | 6300~7000ms | ≤5000ms | ❌ **여전 미충족** |
| 평균 | ~3500ms (추정) | ~3000ms | ≤2500ms | ❌ |
| p50 | 1140ms (v5 실측) | ~950ms | ≤2000ms | ✅ |

**결론**: axis 5 다이어트 단독으로 DoD 5000ms 충족 불가. **#37-B 병렬화** (planQuery 도구 직렬 → Promise.all, multitool 보강 + 1차 실행 병렬) 필수.

### 5.4 #37-B 와의 시퀀스

```
#37-A (본 사이클, 다이어트)
    │
    ▼
측정 1회 (자유변칙 1라운드) — 실측 net p95 락
    │
    ├── 6300~7000ms 측정되면 → #37-B 병렬화 사이클 진입 (예상 -1500~2000ms → 4800~5500ms)
    └── 5500ms 이하 측정되면 → #37-B 보류, DoD 추정 충족 — 회귀 가드 우선
```

---

## 6. 회귀 위험 (axis 6)

### 6.1 v5 1회차 측정 결과 기준선

| 카테고리/축 | v5 PASS% | DoD/floor | 다이어트 영향 우려 |
|---|---|---|---|
| cat1 (기본) | 92% | ≥90% | 낮음 |
| cat2 (연속) | 48% | floor 미설정 — 향후 70%+ 목표 | **중상 — axis 4 memory 5→3** |
| cat3 (다중) | 68% | ≥60% | 낮음 (pickMissingTools 결정론 백업) |
| cat4 (정량) | 75% | ≥60% (α C6/C7 게이트) | **중 — axis 3 가설 bullet 표현 단축 위험** |
| cat5 (비도메인) | 98% | ≥95% (SEC 5/5) | 낮음 (axis 3 비기상 거절 bullet 표현 단축 시 위험 — 보수적 압축) |
| cat6 (메타) | 78% | ≥70% | 낮음 |
| cat7 (환각) | 95% | ≥90% (불변식) | **중 — axis 3 환각금지 bullet get_warning 양방향 한 줄 단축 시 위험 — 보존 필수** |
| cat8 (변칙) | 98% | ≥95% (불변식) | 낮음 |
| CoT 누수 | 0건 | =0 (불변식) | 낮음 (axis 3 CoT bullet 보존) |
| 환각 의심 | 8건 | (현 회귀 모니터링 중) | 신규 회귀 우려 없음 |

### 6.2 Axis 별 회귀 위험 매트릭스

| Axis | 위험 등급 (1~5) | 회귀 가능 카테고리/축 | 가드 |
|---|---|---|---|
| 1 (측정) | 1 | 없음 (측정만) | 측정 전후 비교 |
| 2 (R1~R12 매트릭스) | 2 | cat3 (다중) — 직군별 룰 노출이 LLM 의 룰 인식률 영향. 단 EXPECT_TOOLS_MIN + pickMissingTools 결정론 백업 → 회귀 위험 낮음. | cat3 PASS% 측정 + sentinel CG-5-03/FIS-2-03a (다중 도구) |
| 3 (synth) | 4 | cat4 (정량, MOF-4-01), cat6 (메타), cat7 (환각, ANG-6-03b), cat5 (비도메인 거절) — bullet 표현 단축이 LLM 의 룰 적용률 약화 위험. | sentinel LG-4-01·MOF-4-01·ANG-6-03b 모두 PASS 강제 + 자유변칙 cat4·cat6·cat7 PASS% 변동 ±3pp 이내. |
| 4 (personal) | 3 | cat2 (연속, #30 자연어 후속), 개인화 직군 평가셋 (jikgun-angler 등). | 자유변칙 cat2 PASS% 변동 ±3pp 이내 + jikgun 평가셋 직군별 PASS% 변동 ±5pp 이내. |
| 5 (p95 추정) | 1 | 없음 (예측만) | 실측 후 추가 사이클 분기 |
| 6 (가드) | — | — | 본 axis 가 가드 정의 |

### 6.3 단계별 적용 권고 (분리 커밋)

각 axis 를 **분리 PR** 로. 게이트 통과 시만 다음 axis 진행 — 회귀 감지 시 단일 revert.

```
PR-A2  (axis 2 — R1~R12 매트릭스 직군별 분기) → cat3·다중 도구 sentinel 게이트
        │
        ▼
PR-A3  (axis 3 — synth bullet 표현 단축) → cat4·cat6·cat7·cat5 sentinel + 자유변칙 게이트
        │
        ▼
PR-A4  (axis 4 — personal 다이어트) → cat2 자유변칙 + jikgun 평가셋 게이트
        │
        ▼
측정 (자유변칙 1라운드) — net p95 락
        │
        ├── ≤5500ms : #37-B 보류 검토
        └── >5500ms : #37-B 병렬화 사이클 진입
```

### 6.4 회귀 시 롤백 절차

| Axis | revert 단위 | 영향 | 잔존 효과 |
|---|---|---|---|
| 2 | `git revert <PR-A2>` | planQuery 매트릭스 12 룰 원복 | axis 3·4 효과 보존 (-845 토큰) |
| 3 | `git revert <PR-A3>` | synth bullet 원복 | axis 2·4 효과 보존 (-1300 토큰) |
| 4 | `git revert <PR-A4>` | personal context 원복 | axis 2·3 효과 보존 (-1330 토큰) |

부분 revert 만으로도 다이어트 효과 ~50~75% 보존 → 회귀 차단 + p95 일부 개선 양립 가능.

### 6.5 미커버 위험 — 추가 sentinel 권장

| 시나리오 | 위험 | 권장 sentinel 추가 |
|---|---|---|
| memory 4~5 째 항목 의존 후속 (#30 비도메인 연속성) | axis 4 (a) 회귀 | "뽀로로파크 이용금액?" 류 비도메인 후속 1케이스 |
| 가설 bullet 결정 단어 강제 약화 | axis 3 (c) 회귀 | LG-4-01 외 추가 "풍랑특보 시 작업 가능?" 류 가설 정량 1케이스 |
| profile.location.freeText 의존 zone 폴백 | axis 4 (b) 회귀 | profile freeText 만 가진 사용자의 "오늘 어때?" 1케이스 |

**합의**: 본 사이클은 sentinel 추가 없이 진행 가능 (axis 4 의 memory 슬라이스가 가장 큰 위험원 — 측정 1회로 회귀 감지 가능). 단 측정 결과 cat2 가 ≤-3pp 회귀 시 axis 4 (a) revert + sentinel 추가 후 재진입.

---

## 7. 2차 자체 검토

### 7.1 가정의 강도

- **입력 토큰 추정 (정적 char ÷ 1.5)**: 한국어 prompt 기준 보수적 근사. 실측 시 ±20% 변동 가능. axis 1 측정으로 1차 락 의무.
- **p95 단축 선형 가정**: Gemini flash-lite 의 입력 토큰 ↔ 응답시간이 비선형(thinking 토큰 + 출력 토큰 영향) → 보수 시나리오(-500ms) 와 낙관(-1500ms) 사이 변동. token_metering_design.md §6 의 예시(in:p95=2640) 와 본 추정(planQuery 4000+) 간 격차 검증 필요.
- **R1~R12 직군별 매핑의 LLM 룰 인식률**: 현재 12 룰 노출 + 우선순위 명시가 LLM 의 다중 도구 호출률에 얼마나 기여하는지 측정 부재. 직군별 단일 룰 노출이 같은 효과를 낼지 cat3 PASS% 로 검증.

### 7.2 누락 가능성

- **#31 multitool +1680ms 의 분해 미상**: 5차 라운드 신규 추정. pickMissingTools(결정론) 가 LLM 0회 호출이면 1680ms 는 추가 도구 실행 시간(직렬). 다이어트로 단축 불가 — #37-B 병렬화 대상.
- **TOOL_CATALOG 자체 압축 미고려**: TOOL_CATALOG (L1022~) 가 ~1500 char, ~1000 token. 도구 26개 설명 — 직군별 사용 빈도 따라 일부 도구만 노출하는 axis 추가 가능 (예: angler 에 get_typhoon_status 만 노출, 나머지 12개 도구는 hidden). 단 LLM 의 도구 선택 자유도 제약 → 회귀 위험 높음 → **본 사이클 미포함**.
- **CATALOG_DIGEST (data_catalog.json)**: ~400~800 char 으로 작음. 압축 효과 대비 위험 비대칭 → **본 사이클 미포함**.

### 7.3 회귀 가드 정합

- α C6 (MOF-4-01) — axis 4 의 (c) threshold 운영규칙 단축이 결정 단어 강제와 임계표 unshift 정책을 약화하지 않는지 검증 필요. 단축안의 "결정 단어 1+ 포함" 표현이 LLM 에게 충분히 명시적인지 sentinel 로 측정.
- α C7 (LG-4-01) — axis 3 의 (c) 가설 bullet 결정 단어 리스트 참조화가 LLM 의 결정 단어 인식률을 떨어뜨리지 않는지 — 본 가드는 가설 bullet 자체 보존 + 리스트만 1회 출현 + 2회차 "위 결정 단어" 참조 → 인식률 보존 추정.
- #24 (컨텍스트 격리) — axis 3 압축 시 라벨 출력 금지 문구 보존 필수. cleanAnswer 후처리는 살아있지만 prompt 룰 약화 시 cleanAnswer 가 잡지 못한 라벨 노출 위험.

### 7.4 #37-B 와의 분리 정합

- 본 axis (A) 는 **입력 토큰** 만 다룸. axis B 는 **시간 축**(도구 직렬 → 병렬) 다룸.
- 두 사이클 효과 합산 추정:
  - A 단독: 7800 → 6500ms (-17%)
  - A+B: 6500 → 4800~5500ms (-15~25% 추가)
  - **DoD 5000ms 충족 — A+B 합산 필요**
- B 사이클 설계는 본 문서 범위 외 — #37-B 별도 md.

---

## 8. 적용 체크리스트

- [ ] axis 1: token_metering_design.md §2 (extractUsage) + §3 (acc 누적) 적용 후 자유변칙 1라운드 측정 → planQuery/synth/personal 분리 토큰 분포 락.
- [ ] axis 2: planQuery L1591~1605 매트릭스 영역을 `buildMatrixSection(jikgun)` 동적 호출로 교체. JIKGUN_RULES 상수 신설. 우선순위 룰 한 줄 삭제.
- [ ] axis 3: synth bullet 표현 단축(중복 표현·결정 단어 리스트·안전판단 1회 bullet 통합). get_warning 양방향·CoT 누수·컨텍스트 격리·가설 bullet 본문은 **보존**.
- [ ] axis 4: buildPersonalContext memory 5→3, profileSlim 도입, enrichedTdig 운영규칙 단축. style digest 보존.
- [ ] PR-A2/A3/A4 **분리 머지**. 각 PR 직후 sentinel (LG-4-01/MOF-4-01/ANG-6-03b) + 자유변칙 1라운드 게이트 통과 확인.
- [ ] 측정 후 net p95:
  - ≤5500ms → #37-B 보류 후보 검토.
  - >5500ms → #37-B 병렬화 사이클 진입.
- [ ] 회귀 감지 (cat 별 ≤-3pp) 시 해당 axis 단일 revert + 잔존 효과 보존.

---

**핵심 다이어트 결정**: R1~R12 매트릭스를 직군별 단일 룰(평균 3.3 룰) 로 분기 + synth bullet 중복 표현 단축 + personal memory 5→3 슬라이스로 **입력 토큰 -24%(-1762/케이스)** 압축.

**예상 p95**: 7800ms → **6300~7000ms** (DoD 5000ms 여전 미충족 — #37-B 병렬화 사이클 필수, A+B 합산으로 4800~5500ms 추정).
