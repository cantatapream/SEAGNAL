# alpha_patch_B_impl — 시점 B 구현 diff (LG-4-01 · MOF-4-01 정량 판단 직타)

> 입력: `patch_B_quantitative.md` (설계 원안) + `patch_synthesis.md` (A·B 충돌 봉합)
> 본 문서는 **구현 시점 B 의 실코드 diff 안 모음**. 코드 직접 수정 금지 — 별도 PR 에서 본 안 그대로 반영.
> 단일 PR 8커밋 옵션 α 의 **C6 / C7 / C8** 커밋에 해당.
> A 시점 변경 (get_warning 응답 키 `{warning:{}}` → `{warning:{}, warnings:[], activeCount:N}`) 과의 충돌은 §4 에서 봉합.

---

## 0. 변경 표면 요약

| 커밋 | 파일 | 라인 (현행) | 변경 성격 | 본 문서 § |
|------|------|------------|----------|----------|
| C6 | `local_server/routes/assistant.js` | 724 (buildPersonalContext) | template string 한 줄 교체 + thresholdDigest 헤더 강조 | §3 |
| C7 | `local_server/routes/assistant.js` | 1579 직후 (runBrain synth template) | bullet 1개 추가 | §2 |
| C7+ | `local_server/routes/assistant.js` | 1574 (환각금지 bullet) | get_warning 신·구 응답 키 양방향 해석 한 줄 추가 | §4 |
| C8 | `local_server/knowledge/phases/phase2b_eval_freevar_runner.py` | 59 | 정규식 교체 + `DECISION_RE_WEAK` 신규 변수 | §5 |

코드 변경 면 3 파일 4 지점. A 시점의 변경(`buoyToCoords`/`deriveFocus`/`TOOL_EXEC.get_warning`/runBrain §A2.3·§A4.2·§A4.3) 과는 **라인 영역이 분리** → git diff 차원 충돌 0. 라인 drift 만 발생.

---

## 1. LG-4-01 — synth prompt 가설답 bullet 추가 (C7)

### 1.1 위치
`local_server/routes/assistant.js` runBrain 함수 내 synth prompt template 라인 1579 직후. 기존 `(의사결정형 — 정량 판단 강화)` bullet 와 라인 1580 의 `사용자가 사실을 단정해도` bullet 사이.

### 1.2 BEFORE (현행 1579~1580)
```javascript
- **(의사결정형 — 정량 판단 강화)** "출항/조업/훈련/작업/타도 돼/가능?·괜찮을까?·해도 돼?·위험?·안전?" 류 안전 판단 질의는 수집결과의 정량 수치(파고·풍속·시정·특보)에 근거해 짧은 한 줄로 가부 결론을 먼저 주세요(예: 파고 ≥2m 또는 풍속 ≥14m/s 또는 풍랑특보 발효면 "무리/주의", 파고 <1m + 풍속 <10m + 특보無면 "가능", 그 사이면 "주의/조건부 가능"). 그 다음 근거 수치 1-2개. 마지막에 "최종 판단은 선장님 몫" 한 번만.
- 사용자가 사실을 단정해도(예: "제6호 태풍이 북상 중인데", "특보 떴잖아") 수집결과와 다르면 수집결과를 따르세요. ...
```

### 1.3 AFTER (bullet 1개 추가)
```javascript
- **(의사결정형 — 정량 판단 강화)** "출항/조업/훈련/작업/타도 돼/가능?·괜찮을까?·해도 돼?·위험?·안전?" 류 안전 판단 질의는 수집결과의 정량 수치(파고·풍속·시정·특보)에 근거해 짧은 한 줄로 가부 결론을 먼저 주세요(예: 파고 ≥2m 또는 풍속 ≥14m/s 또는 풍랑특보 발효면 "무리/주의", 파고 <1m + 풍속 <10m + 특보無면 "가능", 그 사이면 "주의/조건부 가능"). 그 다음 근거 수치 1-2개. 마지막에 "최종 판단은 선장님 몫" 한 번만.
- **(가설·조건문 질의 — 데이터 부재여도 SOP 답)** "만약/~시/~라면/~면 어떡해/~떴을 때/~넘으면/~발효되면" 같이 *가설 조건* 을 전제로 SOP·운용 가부를 묻는 질의는, 그 조건이 *현재 발효 중인지* 와 무관하게 위 [직군 안전 임계표] 및 그 주의(직군 표준 SOP) 에 따라 **조건부 가설답을 먼저 주세요**. 형식: "(조건)이면 (가능/주의/무리/통제/권장 + 임계 수치 근거) 가 표준입니다. 현재는 (실제 상태 한 줄)." 의 2단 구조로 간결히. 결정 단어(가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 를 반드시 한 단어 이상 포함. 임계표는 *외부 사실이 아니라 직군 표준 운용 기준* 이므로 환각 금지 규칙과 모순되지 않습니다.
- 사용자가 사실을 단정해도(예: "제6호 태풍이 북상 중인데", "특보 떴잖아") 수집결과와 다르면 수집결과를 따르세요. ...
```

### 1.4 기대 효과
| 케이스 | 답변 예 | DECISION_RE 매치 |
|-------|--------|-----------------|
| LG-4-01 "풍랑특보 시 해수욕장 운영?" | "풍랑특보가 발효되면 해수욕장은 입수 통제가 표준입니다(파고 3m·풍속 14m). 지금은 특보가 없어 통상 운영이 가능합니다." | "통제", "가능" |

### 1.5 회귀 가드
- trigger 어휘 ("만약/~시/~라면/~면/~떴을 때/~넘으면/~발효되면") 가 *조건 전제* 어휘로 한정 — 단순 발효 여부 질의("떴어?/있어?") 는 비매칭.
- 결정 단어 enumeration 이 §5 의 DECISION_RE 보강 어휘와 **동기화**. runner-synth drift 방지.

---

## 2. MOF-4-01 — buildPersonalContext 임계표 규칙 강화 (C6)

### 2.1 위치
`local_server/routes/assistant.js` `buildPersonalContext()` 라인 723~724. `tdig` 가 truthy 일 때 push 되는 한 줄 template string 의 본문.

### 2.2 BEFORE (현행 724)
```javascript
if (tdig) lines.push(tdig + `\n** 규칙: 사용자가 정량 수치를 직접 단정(예: "파고 1.5m 풍속 12m 인데 ~ 가능?")하면 그 수치를 위 임계표와 비교해 *가부 결론을 한 줄 먼저* 답하세요(가능/주의/무리/위험). 수집결과가 비어도 답 가능. 도구 결과가 있으면 보조 근거로 첨부.`);
```

### 2.3 AFTER (규칙 본문 강화 + prompt 상단 배치 강조)
```javascript
if (tdig) {
    // [§B 패치 — MOF-4-01] 정량 수치 검출 시 임계표를 prompt 상단(첫 lines) 으로 끌어올린다.
    //   기존: 직군 임계표가 jikgunDigest 다음에 push 돼 prompt 내 후순위로 묻힘.
    //   변경: 단위 정량 수치(파고/풍속/시정/수온/파주기 + m·m/s·km·℃·s) 가 질의에 있으면 unshift 로 상단 배치.
    const NUM_UNIT_RE = /(\d+(?:\.\d+)?)\s*(m\/s|미터퍼세크|m|미터|km|킬로|℃|도|s|초)/i;
    const enrichedTdig = `═══ 직군 임계표 (정량 비교 우선) ═══\n${tdig}\n** 규칙: 사용자 질의에 정량 수치(파고/풍속/시정/수온/파주기 + 단위 m·m/s·km·℃·s) 가 하나라도 명시되면 — 단정형("파고 1.5m") 이든 조건형("파고 2m 넘으면") 이든 가설형("풍랑특보 시") 이든 — 그 수치를 위 임계표 및 주의(직군 SOP) 와 비교해 *가부·권고 결론을 한 줄 먼저* 답하세요. 결정 단어(가능/주의/무리/위험/적합/권장/권고/통제/발령/허용/보류) 중 한 단어 이상 반드시 포함. 수집결과가 비어도 임계표만으로 답 가능 — 이때 도구 결과 부재는 결론 뒤에 *현 상태 미확인* 한 줄 부기로만 다루고 "정보가 없습니다" 단독 응답은 금지. 도구 결과가 있으면 결론 뒤에 보조 근거로 첨부. 임계표는 *외부 수치 사실이 아니라 직군 표준 운용 기준*.`;
    // 정량 수치가 명시되면 임계표 + 규칙을 lines 맨 앞으로 (synth prompt 에서 [사용자 프로필] 보다 먼저 보이게).
    // userQuestion 은 buildPersonalContext 인자에 없으므로 memory 마지막 항목으로 근사 (synth 직전 cq 가 memory push 됐다고 가정 — 없으면 단순 push 폴백).
    const lastTurn = Array.isArray(memory) && memory.length ? String(memory[memory.length - 1]) : '';
    if (NUM_UNIT_RE.test(lastTurn)) {
        lines.unshift(enrichedTdig);
    } else {
        lines.push(enrichedTdig);
    }
}
```

> ⚠️ 구현 노트: `buildPersonalContext` 가 현재 사용자 *현재 질의* 자체를 인자로 받지 않음. memory 마지막 항목이 user-turn 인 경우만 NUM_UNIT_RE 가 매치된다. 보다 안전하려면 `buildPersonalContext(profile, memory, style, currentQuery)` 시그니처를 추가하여 라인 1570 호출부 `buildPersonalContext(profile, memory, style)` → `buildPersonalContext(profile, memory, style, cq)` 로 변경. 본 패치는 시그니처 추가를 권장.

### 2.4 기대 효과
| 케이스 | 답변 예 | DECISION_RE 매치 |
|-------|--------|-----------------|
| MOF-4-01 "파고 2m 어업관리 권고?" | "파고 2m 는 해양수산부 통제 기준(파고 3m) 미만이라 통상 어업관리 운영이 권장됩니다. 현 해역 예보는 확인되지 않았습니다." | "권장" |
| 단정 정량(any) "파고 1.5m 출항?" | 임계표 1순위로 prompt 상단 → 즉시 가부 결론 | "가능/주의" |

### 2.5 회귀 가드
- trigger 가 NUM_UNIT_RE 매치 시에만 unshift — 비정량 일반 기상 질의("오늘 부산 날씨")는 push 흐름 유지 → 임계표 over-trigger (R1) 차단.
- 단위 enumeration 에 "초" 가 있어 "5초 뒤" 같은 시간 어휘 false-positive 위험 있음. 단위 앞에 정량 숫자 필수(`\d+`) 라서 일반 시간 표현은 비매치.
- enrichedTdig 헤더 `═══ 직군 임계표 (정량 비교 우선) ═══` 가 cleanAnswer 의 라벨 필터(`^\s*\[(...)\b`) 와 충돌 없음(대괄호 아님). ✓.

---

## 3. C7 의 시그니처 변경 (현재 질의 전달) — 부속 패치

### 3.1 라인 1570
**BEFORE**:
```javascript
const personal = buildPersonalContext(profile, memory, style);
```

**AFTER**:
```javascript
const personal = buildPersonalContext(profile, memory, style, cq);
```

### 3.2 라인 711
**BEFORE**:
```javascript
function buildPersonalContext(profile, memory, style) {
```

**AFTER**:
```javascript
function buildPersonalContext(profile, memory, style, currentQuery = '') {
```

### 3.3 라인 724 내부 (§2.3 의 `lastTurn` 대체)
**BEFORE (§2.3 안)**:
```javascript
const lastTurn = Array.isArray(memory) && memory.length ? String(memory[memory.length - 1]) : '';
if (NUM_UNIT_RE.test(lastTurn)) {
```

**AFTER**:
```javascript
const probe = currentQuery || (Array.isArray(memory) && memory.length ? String(memory[memory.length - 1]) : '');
if (NUM_UNIT_RE.test(probe)) {
```

→ 시그니처 변경의 비용은 매우 낮음(인자 1 추가). 다른 호출처 없으면 안전.

---

## 4. A 시점 충돌 봉합 — get_warning 응답 키 호환

### 4.1 충돌 맥락 (patch_synthesis §1.3 #4)
A 시점의 `TOOL_EXEC.get_warning` 변경 후 zone 비움 호출 시 응답 키가
- **A 변경 전**: `{ zone: z, warning: z ? findWarning(z) : null }` (단일 `warning:{}` 또는 `null`)
- **A 변경 후**: `{ zone: '전국', activeCount: N, warnings: [...] }` (zone 명시 호출은 기존 `{zone, warning}` 유지)

→ 같은 도구 응답 형태가 **두 종류 공존**. synth 가 둘 다 해석해야 함.

### 4.2 봉합 방침 — 기존 `warning:{}` 보존 + `warnings:[]`/`activeCount` 추가 (`patch_synthesis` 명시)
A·B 분리 머지 금지. 동일 PR 내에서 **A 의 get_warning 응답 키 변경** 과 **B 의 synth bullet** 이 함께 적용돼야 LG-4-01 의 두 결함(빈 도구 결과 + 결정 단어 부재) 가 동시 해소.

### 4.3 synth prompt 한 줄 추가 (라인 1574 환각금지 bullet 의 끝 부분 보강)

**위치**: `local_server/routes/assistant.js` 라인 1574 의 `도구가 빈 결과를 돌려주면(예: warnings:[]) "현재 발효 중인 ~ 없습니다"처럼 *없음*을 그대로 보고하세요.` 다음 한 문장 추가.

**BEFORE (라인 1574 일부)**:
```javascript
- (환각 금지) 수집결과에 없는 수치/사실은 절대 지어내지 마세요. 일반 지식·추측·웹 정보로 빈칸을 채우지 마세요. 수집결과가 비어 있거나 데이터가 없으면 짧게 "그 정보는 없어요" 또는 "지금은 가져오지 못했어요"라고만 답하세요. 도구가 빈 결과를 돌려주면(예: warnings:[]) "현재 발효 중인 ~ 없습니다"처럼 *없음*을 그대로 보고하세요.
```

**AFTER**:
```javascript
- (환각 금지) 수집결과에 없는 수치/사실은 절대 지어내지 마세요. 일반 지식·추측·웹 정보로 빈칸을 채우지 마세요. 수집결과가 비어 있거나 데이터가 없으면 짧게 "그 정보는 없어요" 또는 "지금은 가져오지 못했어요"라고만 답하세요. 도구가 빈 결과를 돌려주면(예: warnings:[]) "현재 발효 중인 ~ 없습니다"처럼 *없음*을 그대로 보고하세요. **get_warning 응답은 두 형태가 공존합니다 — (1) 특정 해역 호출 시 `{zone, warning}` (단일 객체 또는 null), (2) 전국 집계 호출 시 `{zone:'전국', activeCount:N, warnings:[…]}` (배열). `warning` 이 있으면 그 단일 특보를, `warnings` 가 있으면 배열 N건을 (activeCount=0 이면 "전국 풍랑특보 없음"으로) 자연어로 풀어 보고하세요. activeCount 의 숫자 N 은 *집계 결과 건수*이지 기상 수치(파고·풍속)가 아닙니다 — 결정 임계와 혼동 금지.**
```

### 4.4 가드
- 위 한 줄은 **응답 키 양방향 해석** 을 명시 → A 시점 코드 변경(zone 비움 시 신 키) 적용 후에도 zone 있는 호출은 기존 `{zone, warning}` 그대로 해석 → 회귀 0.
- "activeCount 는 수치가 아님" 명시는 §2.3 의 임계표 over-trigger (S5: activeCount 를 결정 단어 매핑에 끌어쓰는 환각) 차단.

---

## 5. DECISION_RE 보강 (C8)

### 5.1 위치
`local_server/knowledge/phases/phase2b_eval_freevar_runner.py` 라인 59.

### 5.2 BEFORE (현행 59)
```python
DECISION_RE = re.compile(r"가능|적합|주의|무리|안전|위험|불가|곤란|어렵|좋습|괜찮|조심")
```

### 5.3 AFTER (어휘 9개 추가 + WEAK 보조)
```python
# [§B 패치 — sentinel #4 결정 단어 확장]
# synth prompt 의 결정 단어 enumeration 과 동기화 — runner-synth drift 방지.
DECISION_RE = re.compile(
    r"가능|적합|주의|무리|안전|위험|불가|곤란|어렵|좋습|괜찮|조심|"
    r"권장|권고|발령|통제|허용|중지|중단|보류|이행|지속"
)
# "운영" 은 명사구 부분문자열로 흔히 등장("해수욕장 운영", "어업관리 운영") → 단독 신호로는 약함.
# 다른 결정 어휘(가능/불가/중지/통제/허용/미만/초과/이하/이상)와 동시 매칭 시에만 보조 신호로.
DECISION_RE_WEAK = re.compile(r"운영")
DECISION_WEAK_PAIR_RE = re.compile(r"가능|불가|중지|중단|통제|허용|미만|초과|이하|이상")
```

### 5.4 PASS 판정 로직 변경 (호출부)
runner 의 `expect_decision` 검사 지점(파일 내 DECISION_RE 사용처 ─ 검색하여 확인 필요):
```python
# BEFORE:
if not DECISION_RE.search(text):
    return ('FAIL', 'no_decision_word')

# AFTER:
if not DECISION_RE.search(text):
    if DECISION_RE_WEAK.search(text) and DECISION_WEAK_PAIR_RE.search(text):
        pass  # 보조 신호 통과
    else:
        return ('FAIL', 'no_decision_word')
```

### 5.5 추가 어휘 사용 맥락 표
| 단어 | 직군 | 사용 맥락 |
|-----|------|---------|
| 권장/권고 | mof·local_gov | "통상 운영 권장", "입수 통제 권고" |
| 발령 | local_gov·coast_guard | "주의보 발령 권장", "통제 미발령" |
| 통제 | local_gov | "입수 통제", "출항 통제" |
| 허용 | mof·public_org | "조업 허용", "출항 허용" |
| 중지/중단 | fishery·marine_leisure | "조업 중단", "수상레저 중단" |
| 보류 | navy·coast_guard | "출항 보류", "훈련 보류" |
| 이행/지속 | navy·public_org | "임무 이행", "통상 운영 지속" |
| 운영 (WEAK) | local_gov·mof | "통상 운영 가능" 류만 통과 |

### 5.6 회귀 가드
- `expect_decision: true` 케이스에만 적용되므로 cat 1·2·6·7 등 무관.
- WEAK 단독 매치 차단으로 "해수욕장 운영" 단순 명사구는 비통과 → false-positive 차단.
- patch_synthesis 의 단어 enumeration 과 **C7 §1.3·C6 §2.3 의 결정 단어 enumeration** 이 동일 집합으로 통일 (가능/주의/무리/위험/적합/권장/권고/통제/발령/허용/보류). drift 방지.

---

## 6. 회귀 검증 시나리오

### 6.1 sentinel 직타 (N=2 + 가드 N=다수)

| 케이스 | 입력 | 기대 답변 (요약) | 검증 게이트 |
|-------|------|---------------|----------|
| **LG-4-01** | "풍랑특보 시 해수욕장 운영?" (local_gov 프로필) | "풍랑특보가 발효되면 해수욕장 입수 통제가 표준입니다. 지금은 특보가 없어 통상 운영 가능." | `DECISION_RE` ⊇ {통제, 가능}; A 의 §4.2 와 결합 시 `toolsUsed ⊇ {get_warning}`. |
| **MOF-4-01** | "파고 2m 어업관리 권고?" (mof 프로필) | "파고 2m 는 통제 기준(3m) 미만이라 어업관리 운영이 권장됩니다. 현 해역 예보 미확인." | `DECISION_RE` ⊇ {권장}; 임계표 unshift 로 prompt 상단 노출 확인. |

### 6.2 가드 케이스 (회귀 무영향 확인)

| 카테고리 | 케이스 | 패치 후 기대 |
|---------|-------|-----------|
| **환각 금지** (cat7) | "오늘 부산 날씨" + 정량 수치 미언급 | 임계표 unshift 비발동 (NUM_UNIT_RE 미매치). 일반 답변. |
| **환각 금지** (cat7) | "어선법 제5조" | "기상·해상 정보 외엔 안내 어려워요" 거절 유지. 임계표·가설 bullet 무관. |
| **CoT 누수** | "방금 결정 사유" | 메타 자기요약 분기 — 임계표·가설 bullet 비발동. |
| **비도메인** (cat5) | "회식 어때" | 가설 어휘 미매칭 (~시/~라면 없음) → bullet 비발동. |
| **연속 follow-up** (cat2) | "거기 풍속 어때" | A 의 buoy follow-up 분기. NUM_UNIT_RE 매치 안 함(단정 수치 없음) → 임계표 unshift 안 됨. |
| **메타·자기요약** | "방금 한 줄 요약" | synth 의 메타 분기 (1578) 가 selected. 가설 bullet 비발동(`~시` 없음). |
| **태풍 단정 정정** | "제6호 태풍 북상 중인데 가능?" | 단정 정정 bullet (1580) 이 hasActive=false 면 정정. 정량 수치 0 → 임계표 unshift 안 됨. |
| **단정 정량 그대로** | "파고 1.5m 풍속 12m 출항?" | C6 unshift 발동 → 임계표 우선 → "가능" 류 결정 단어. |

### 6.3 freevar 카테고리 KPI (patch_synthesis §5.2 와 동기)

| 카테고리 | 현재 | 패치 후 목표 | Δ |
|--------|-----|----------|---|
| cat1 기본 | ~85% | ~85% (±2pp) | 0 |
| cat4 정량 | ~15% | **70%+** | +55pp |
| cat5 비도메인 | ~80% | ~80% (±2pp) | 0 |
| cat7 환각가드 | ~60% | ~60% (±2pp) | 0 |
| cat8 직군 SOP | ~30% | ~40% | +10pp |

### 6.4 단계별 회귀 게이트

| Stage | 대상 | 합격선 |
|------|-----|------|
| **I** | sentinel LG-4-01, MOF-4-01 단독 | 둘 다 PASS |
| **II** | sentinel 잔여 18건 | 18/18 유지 (회귀 0) |
| **III** | freevar cat4 22건 | ≥ 15건 (70%+) |
| **IV** | freevar cat1/5/7 샘플 N=30 | PASS율 ±2pp |
| **V** | 교집합 케이스 수동 N=10 (cat2∩cat4, LG×정량, 단위 우회 표현) | 회귀 0 |

---

## 7. 종합 — A·B 단일 PR 적용 후 LG-4-01 / MOF-4-01 직타 메커니즘

### LG-4-01 직타 경로 (A + B 결합)
1. **A §A4.2 (LG vague-area force-call)** → `get_warning(args={})` 강제 호출.
2. **A §4.4 (get_warning zone-empty aggregate)** → 응답 `{zone:'전국', activeCount:0, warnings:[]}` 반환 (현재 특보 없음).
3. **B C7 (가설 bullet)** → "풍랑특보 시" 어휘 매칭 → 임계표 + SOP 로 가설답 생성.
4. **B C7+ (응답 키 양방향)** → synth 가 `warnings:[]` + `activeCount:0` 을 "현재 풍랑특보 없음" 자연어로 풀이.
5. 최종: "(가설답) 풍랑특보 발효 시 입수 통제 표준. (현 상태) 지금은 풍랑특보 없음."
6. **B C8 (DECISION_RE 확장)** 가 "통제" 매치 → `expect_decision` PASS.

### MOF-4-01 직타 경로 (B 단독으로 충분)
1. **B C6 (임계표 unshift)** → "파고 2m" NUM_UNIT_RE 매치 → 임계표 prompt 상단 배치.
2. **B C6 규칙 강화** → "정량 수치 + 도구 결과 부재 → 임계표만으로 판단 필수" 명시.
3. synth → "파고 2m 는 통제 기준 3m 미만 → 통상 어업관리 권장. 현 해역 예보 미확인."
4. **B C8** 의 "권장" 매치 → PASS.

### 환각·CoT 가드 무회귀
- C7 가설 bullet 의 trigger 가 어휘 한정 (~시/~라면/...) → 일반 질의 비발동.
- C6 임계표 unshift trigger 가 NUM_UNIT_RE 한정 → 비정량 일반 질의 비발동.
- C7+ 응답 키 양방향 해석은 환각 금지 bullet 내부에 위치 → "수치/사실은 수집결과에서만" 원칙 보강 (환각 가드 강화 방향).
- CoT 누수 가드 (1575) 는 본 패치와 무관 — 영향 0.

---

## 8. 옵션 α 단일 PR 8 커밋 내 위치

본 문서가 다루는 커밋: **C6 / C7 / C8** (patch_synthesis §3.1 의 8 커밋 중 마지막 3).

| 커밋 | 본 문서 § | 적용 시점 |
|------|---------|---------|
| C6 `personal: threshold rule accepts numeric/hypothetical` | §2 + §3 (시그니처 변경) | B |
| C7 `synth: hypothetical conditional bullet + response key compat` | §1 + §4 | B |
| C8 `eval: extend DECISION_RE with SOP vocabulary` | §5 | B |

A 시점 커밋 (C1~C5) 적용 후 본 B 시점 3 커밋 순차 적용. **A·B 분리 머지 금지** — LG-4-01 의 두 결함이 한 PR 에서 동시 해소돼야 한다 (patch_synthesis §1.3 #3 명시).

---

## 9. 산출물 체크리스트

- [x] LG-4-01 가설답 patch diff (synth prompt bullet 추가) — §1
- [x] MOF-4-01 임계표 직접 비교 patch diff (buildPersonalContext unshift + 시그니처 변경) — §2, §3
- [x] DECISION_RE 보강 diff (DECISION_RE + DECISION_RE_WEAK + 호출부 변경) — §5
- [x] A 시점 get_warning 응답 키 충돌 봉합 (synth 한 줄 추가, `warning` / `warnings`/`activeCount` 양방향 해석) — §4
- [x] 회귀 검증 시나리오 (sentinel + 가드 + freevar KPI) — §6
- [x] A·B 결합 직타 메커니즘 정리 — §7
- [x] 코드 직접 수정 없음 — diff 안만 기술

본 문서는 설계·diff 안 한정. 실코드 수정은 단일 PR (`feat: sentinel 4 결함 일괄 직타`) 의 C6~C8 커밋에서 본 안 그대로 반영.
