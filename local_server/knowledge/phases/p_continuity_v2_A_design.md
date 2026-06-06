# P_continuity_v2 패치 A 설계 — PRONOUN_RE / 검출 흐름 강화 (설계 시점 A)

> 코드 수정 0. 본 문서는 **설계 단서·근거·회귀 가드**만 정리한다. 구현은 시점 B(α/β 합성 후) 진행.

- 대상: 마스터플랜 §6 #30 (ROI 6.6, risk=중)
- 입력 측정: v5 1회차 — 종합 PASS 347/440 (78%), **cat2 연속 48% · 실패 42건/80**
- 핵심 가설: 후속 잇기 질문(prev_id chain)에서 **(a) 대명사 검출 실패** 또는 **(b) 검출했어도 focus.zone 미주입** 또는 **(c) chain_focus[prev_id] 가 끊김** → answer 에 zone 미포함.
- 직접 코드 변경 위치 후보: `local_server/routes/assistant.js`
  - `PRONOUN_RE` (line 1529)
  - `isPronounFollowup` 분기 (1530–1572: FOCUS_ZONE_ARG 주입)
  - `deriveFocus()` (1322–1359: zone fuzzy 보강)
  - `runBrain()` 의 prev_id chain 진입(상위 호출 — runner.py line 268: `chain_focus[c["id"]] = data.get("focus")`)

---

## 1. 실패 케이스 분석 — cat2 실패 zone-miss 원인 분류

### 1.1 원천 데이터
- 로그: `/home/user/SEAGNAL/local_server/knowledge/phases/v5_run1_freevar.log.gz` (105 lines, sample 5건)
- 측정 리포트: `v5_run1_report.md` §2 (cat=2 v3 43→v5 48%, 실패 42건)
- 케이스 정의: `phase2b_eval_freevar.jsonl` (cat=2 b-suffix 후속 80건; 각 직군 5쌍 × 8직군 = 40 쌍 × 2 = 80)

### 1.2 cat2 실패 패턴 분류 (zone-miss 42건의 근접 원인)

| 군 | 패턴 | 대표 케이스 | 원인 분류 | 비중(추정) |
|----|------|-------------|-----------|-----------|
| **G1** | "거기 / 그곳 / 그 부이 / 그 해역" — 표준 대명사이지만 zone 미반영 | ANG-2-01b("거기 풍속은?"→간여암 응답), CG-2-01b·CG-2-04b·MOF-2-01b·MOF-2-03b | **(b) 검출 OK, focus.zone 주입 실패 / 도구 args 미반영** | ≈50% (21건) |
| **G2** | "그 위도 / 그 해역 시정 / 그 곳" 등 띄어쓰기/조사 변형 | ANG-2-05b("그 위도 풍속?"), LEI-2-04b("그 곳 파고?") | **(a) PRONOUN_RE 미스 (현 패턴은 "그\\s*해역\|그\\s*해구\|그\\s*부이" 만 매칭, "그 위도"/"그 곳" 누락)** | ≈12% (5건) |
| **G3** | 모호 zone(관내·관할·연안·항만) + 후속 대명사 — focus.zone 자체가 prev 응답에서 NULL | LG-2-01b("관내" → "거기"), LG-2-02b, PO-2-04b("연안" → "그 해역"), PO-2-05b("항만" → "거기") | **(c) prev_id chain 끊김 — prev 응답 focus.zone 이 null 또는 모호 raw** | ≈20% (8–9건) |
| **G4** | "거기 부이?" — zone 은 있어도 부이 군집 조회 자체 실패 | ANG-2-04b(홍도→마라도/가파도 응답), CG-2-04b·NAV-2-03b·LEI-2-03b | **(b'/d)** deriveFocus 가 buoy/coords 만 잡고 zone 누락 또는 답변 생성 단계에서 zone token 자연어 누락 | ≈12% (5건) |
| **G5** | 폴백 거절문("가져오지 못했어요") | ANG-2-03b("그곳 조석"→"가져오지 못했어요") | **(d)** 도구 실행 자체 fail → focus 주입 무관 | ≈6% (3건) |

> 직군별 cat2 PASS: angler 5/10 · coast_guard 5/10 · fishery 5/10 · local_gov 5/10 · marine_leisure 4/10 · mof 7/10 · navy 4/10 · public_org 3/10 → 합산 38/80 ⇒ **실패 42**.
> 위 5군 비중은 sample 5건 + JSONL 케이스 정의 + 직군별 PASS 매트릭스로 환산한 추정치.

### 1.3 결론 (#30 패치 1차 타격면)

- **(b) 검출 OK / 주입 실패** 가 최대 단일 원인 (≈50%) — `FOCUS_ZONE_ARG` 매핑 1회 통과는 OK 이나 **focus.zone 자체가 null 인 채로 들어오는** 케이스가 핵심. ⇒ deriveFocus 우선순위 보강.
- **(a) PRONOUN_RE 미스** 는 단독 비중은 낮지만 (≈12%) 회귀 안전성이 가장 높아 **저비용·고확신** 보강 후보.
- **(c) prev_id chain 끊김** (≈20%) — chain_focus[prev_id] 저장 시점에 prev 응답 focus 가 null 인 점이 본질. ⇒ deriveFocus 가 "모호어 zone" 도 raw 보존하도록 완화 필요.

---

## 2. PRONOUN_RE 확장 후보

### 2.1 현 패턴 (line 1529)
```
/거기|그곳|그쪽|그\s*해역|그\s*해구|그\s*부이|방금|아까|그건|그게|저거/
```

### 2.2 추가 후보 (한국어 후속 잇기 표현)

| 후보 토큰 | 채택 | 사유 / 거짓양성 위험 |
|----------|------|-------------------|
| `그\s*곳` | ✅ | "그곳" 은 이미 있으나 띄어쓴 "그 곳"(LEI-2-04b) 누락 — 회귀 안전 |
| `그\s*위치` | ✅ | "그 위치 파고" 류 — 명확 후속 잇기 |
| `그\s*해변` / `그\s*해안` | ✅ | marine_leisure 후속(서핑 해변 follow-up) — 회귀 안전 |
| `그\s*항(만\|구)?` | ✅ | get_seafog_cctv 후속, public_org 케이스 보강 |
| `그\s*섬` | ✅ | angler 섬 후속 — 회귀 안전 |
| `같은\s*(곳\|해역\|위치)` | ✅ | "같은 해역의 풍속은?" — 자주 쓰는 후속 표현 |
| `여기` | ⚠ 조건부 | **거짓양성 위험**: "여기 알려줘" 처럼 사용자 GPS 가리킬 수 있음 → location 객체 우선 분기 후에만 채택. focus.zone 이 있고 location 이 null 일 때만. |
| `이쪽` / `저쪽` | ⚠ 조건부 | "이쪽 바다" 류만 안전. 일반 부사 사용 빈도 높음 → 보수적 제외 1차 |
| `근처` / `주변` / `인근` / `옆` | ❌ | "인근" 은 새 위치를 가리킬 수 있음 (예: "양양 근처는?" — 이미 양양 fixed). 회귀 위험 큼 → 별도 패치 #31(P_multitool) 와 묶어서 처리 |
| `그 부근` | ❌ | 위와 동일. zone 변경 가능성 |
| `방금\s*거` / `방금\s*전` / `조금\s*전` | ✅ | 시간 지시이지만 항상 직전 응답 가리킴 — 회귀 안전 |
| `위에서` / `아까\s*거` | ✅ | "위에서 말한 곳" — 명확 후속 |
| `그것` / `그놈` / `그 자료` | ⚠ 조건부 | "그것" 은 zone 외 객체 가리킬 수 있음 — synth 단계에서 자료 인용으로 흐를 위험. zone 주입은 OK 이나 verify 필요 |

### 2.3 명시적 **제외** 룰 (false positive 차단)

- `그\s*때` — **마스터플랜 §7 2026-05-30 #27 결정 유지** (시간 후속어, "그때 파고" 류는 시간 follow-up 이지 zone 아님). 본 패치에서도 **유지 제외**.
- `그\s*동안` — 시간 범위 표현. zone 미적용.
- `그\s*다음` — 순서 표현.
- `그래서` / `그러면` / `그런데` — 접속 부사.
- `여기에` / `여기서` (어미 확장형) — `여기` 단독 미채택과 일관.

### 2.4 제안 v2 패턴 (설계안 — **구현 금지, 시점 B 에서 검증 후**)

```js
const PRONOUN_RE = /거기|그곳|그\s*곳|그쪽|그\s*해역|그\s*해구|그\s*부이|그\s*해변|그\s*해안|그\s*항(?:만|구)?|그\s*섬|그\s*위치|같은\s*(?:곳|해역|위치)|방금(?:\s*거|\s*전)?|아까(?:\s*거)?|그건|그게|저거|위에서|조금\s*전/;
// 명시적 제외(주석): 그\s*때, 그\s*동안, 그\s*다음, 여기, 이쪽, 저쪽, 근처, 주변, 인근
```

- `(?:…)?` 비캡처 — JS 호환 OK.
- "그쪽" 은 보존, "이쪽/저쪽" 만 제외.

### 2.5 거짓양성 자가 검증 항목 (시점 B 회귀 셋 추가 권고)
1. "그때 파고 알려줘" → `isPronounFollowup === false` (zone 미주입)
2. "그 다음엔 어디가 좋을까?" → `false`
3. "여기 알려줘" + location 객체 있음 → `false` (GPS 우선)
4. "근처 부이" → `false` (별도 #31에서 다룸)

---

## 3. focus.zone 즉시 적용 흐름 — 우선순위 설계

### 3.1 현 흐름 (line 1531–1572)
```
isPronounFollowup → FOCUS_ZONE_ARG[step.tool] 매핑으로 step.args[zoneArg] = focusZone
```
- 한계: `focusZone` 자체가 null 이면 무력. (G3 의 모호 zone 케이스, prev 응답 focus 가 빈 경우)

### 3.2 제안 우선순위 (#30 핵심 설계 — 시점 B 구현 대상)

대명사 검출 시 zone 선택 순서:

```
1) focus.zone (현행) — runner 가 chain_focus[prev_id] 로 넘겨준 값
2) focus.haegu / focus.buoy / focus.coords 의 자체 보강
   - focus.buoy 가 있고 zone 이 없으면 buoy → 좌표 → fuzzy zone 역추론 (buoyToCoords + detectZoneByCoords)
3) memory(직전 3턴) 자유텍스트에서 detectZoneDeterministic 회수
4) profile default zone (profileDefaultZone) — 모호어 폴백 (G3 의 "관내" 류)
5) 어느 것도 없으면 → 거절 응답 폴백
   "어느 해역 말씀이실까요? (예: 거문도, 동해중부)"
   — 환각 방지 우선. web_search 폴백 진입 금지(현재 cat2-G2 일부가 web_search 로 빠져 환각 의심 처리됨).
```

### 3.3 deriveFocus 보강 단서 (코드 수정 0 — 시점 B 설계 자료)

- **(a) zone 누락 보존 완화** — line 1358 의 마지막 `return (focus.zone || focus.haegu || focus.buoy || focus.coords || focus.rankedItems) ? focus : null;` 에서 **모호어 raw zone 도 보존**하는 별도 필드 (`focus.zoneRaw`) 도입 후보. G3 대응.
- **(b) zone fuzzy 보강 확장** — line 1354–1357 의 detectZoneDeterministic 는 직전 query 만 본다. **prev_id chain 의 query 도 함께 검사**하도록 시그니처 확장 — runBrain 의 memory 활용 시 자유텍스트보다 chain_focus 객체 우선.
- **(c) buoy → zone 역추론** — focus.buoy 만 있을 때 buoyToCoords + 해역명 사전(zone area JSON) 으로 zone 채움. G4 케이스 핀포인트.

### 3.4 chain_focus 갱신 신뢰성

- runner: `chain_focus[c["id"]] = data.get("focus") or None` (line 268)
- 서버 응답의 `focus` 필드는 line 1677/1713 의 `deriveFocus(...)` 반환값 그대로. 즉 **서버 deriveFocus 가 null 을 반환하면 chain 끊김**. → G3 대응으로 zoneRaw 보존하면 chain 도 보존.

---

## 4. 회귀 가드 — sentinel 시나리오

### 4.1 핵심 sentinel (마스터플랜 §6 #30 명시)
- **ANG-2-01b** — "거문도 파고" → "거기 풍속은?" → answer 에 "거문도" 포함 + halluc 없음
- **CG-2-01b** — "동해중부 특보" → "거기 풍속?" → answer 에 "동해중부" 포함
- **PO-2-01b** — "동해광역 시정" → "거기 풍속?" → answer 에 "동해광역" 포함

### 4.2 추가 sentinel (#30 트레이드오프 범위 검증)
- **NAV-2-01b** — "동해중부 파고" → "거기 수심?" → answer 에 "동해중부" 포함 + get_depth 호출 확인 (FOCUS_ZONE_ARG[get_depth]='zone' 작동 검증, §C5-pre 영향)
- **ANG-2-05b** — "위도 낚시지수" → "그 위도 풍속?" — **PRONOUN_RE v2 의 "그\\s*위치" 매칭만으로 보강 어려움** (실제는 "그 위도" — `위도`는 명사 island 이름). 별도 가드: PRONOUN_RE 패스 안되면 prev_id chain 에서 명사 "위도"를 zone candidate 로 회수.
- **ANG-2-04b** — "홍도 시정" → "거기 부이는?" — G4 케이스. focus.zone="홍도" 가 buoy 도구 list_buoys_near 의 args.zone 에 정확히 주입되는지.
- **LG-2-01b** — "관내 특보" → "거기 풍속?" — G3 케이스. focus.zoneRaw="관내" 보존 후 chain 으로 전달 시 어떻게 처리할지 (zone 폴백 거절 vs profile default 사용).

### 4.3 거짓양성 회귀 가드 (PRONOUN_RE 확장 부작용)
- **"그때 파고 알려줘"** (시간 후속) → `isPronounFollowup === false`. #27 보수화 결정 보존 검증.
- **"근처 부이"** → `false`. 새 위치 추정 가능성 — #31 P_multitool 영역으로 분리.
- **"여기 어때"** + location 있음 → `false` 또는 location 우선. GPS 좌표 vs focus.zone 의 우선순위 명시.

### 4.4 측정 게이트 (시점 B 통과 기준 — 권고)
- cat2 PASS ≥ 60% (48% → +12pp 최소)
- 직군별 cat2 floor ≥ 4/10 (현 public_org 3/10 → ≥4)
- cat1·cat3 회귀 0pp (인접 카테고리 무영향 검증)
- 환각 의심 ≤ 4 (현 8건; G1·G2 의 web_search 폴백 차단 효과)

---

## 5. 위험 평가 (트레이드오프)

### 5.1 α C5-pre 공유 상수 충돌 (risk=중)
- line 1515–1519: `VAGUE_LOCAL_RE` / `MONITOR_JIKGUN` / `OVERVIEW_RE` 는 §C4·§C5·§C5-b 가 공유.
- #30 가 추가로 `PRONOUN_RE_V2` / 새 zone 폴백 분기 (profile default 우선순위 등) 를 도입할 때 같은 함수 스코프 안에 상수 4종 이상이 누적되면 **상수 라인 가독성·중복 선언 위험**. ⇒ 시점 B 에서 함수 상단에 `const CONTINUITY_CONST = { PRONOUN_RE_V2, VAGUE_LOCAL_RE, MONITOR_JIKGUN, OVERVIEW_RE }` 식 묶음 권고.
- **synthesis §1.3 #2 "함수 상단 1회 선언" 원칙** 준수 — 분기 안에서 정규식 재컴파일 금지.

### 5.2 deriveFocus 인자 시그니처 충돌 (risk=중)
- 현 `deriveFocus(plan, results, zoneName, query)` (line 1322) — 4-인자.
- §3.3 에서 제안한 "prev_id chain query 동시 검사" 는 5번째 인자(`memory` 또는 `chainHistory`) 추가가 필요. ⇒ **호출처 line 1625·1677·1713 동시 수정** 필요. 누락 시 chain 보강 효과 0.
- 대안: 인자 추가 대신 deriveFocus 안에서 `query` 가 chain 의 마지막이라고 가정하고, runBrain 진입 시 `memory.slice(-3).join(' ')` 를 query 앞에 붙여 단일 문자열로 넘기는 변형 — 시그니처 무변. **권고**.

### 5.3 PRONOUN_RE 확장 부작용 (risk=낮음)
- "그것/그놈" 등 의도적 미채택. "여기/근처/인근" 도 미채택.
- 가장 큰 부작용 가능성: "방금 거" 가 일반 회화에서 사용될 때 zone 강제 주입 → 어색한 응답. 회귀 셋에 1건 추가 권고.

### 5.4 focus.zoneRaw 신규 필드 (risk=낮음)
- 응답 스키마 `data.focus` 에 신규 키 추가 — runner 는 객체 그대로 chain 에 보존하므로 호환.
- 단, 외부 소비자(클라이언트 assistant.html) 가 focus 키마다 표시 로직 가지면 무영향 검증 필요.

### 5.5 시점 B 진행 전제 (P0 위반 보류 명시)
- v5 1회차 §8 — **P0 위반(환각 의심 8건 > 가드 2건)**. 마스터플랜 §9 권고는 "다른 패치 전면 보류, 가드 패치 단독 사이클 우선". ⇒ #30 시점 B 진입 전에 **#32 (HALLUC_RE false positive 정밀화)** 가 먼저 완료되어야 일정 안전. 본 설계는 진행하되 구현 큐는 #32 뒤.

---

## 6. 시점 B 진입 체크리스트 (요약)
1. `PRONOUN_RE_V2` 정규식 (§2.4) 의 거짓양성 회귀 셋 4건 (§2.5) 자동 검증 추가
2. `deriveFocus` 시그니처 무변 변형 (§5.2 권고) 채택
3. focus.zoneRaw 보존(G3) — 별도 키 / 응답 호환성 검증
4. buoy → zone 역추론(G4) — 좌표 사전 의존성 확인
5. 폴백 거절 응답 메시지 문구 합의 (§3.2 step 5)
6. sentinel ANG-2-01b/CG-2-01b/PO-2-01b/NAV-2-01b/ANG-2-05b/LG-2-01b 통과 + cat2 PASS ≥ 60% 게이트
7. **선행 #32 완료(P0 위반 해소) 후 #30 시점 B 진행** — 마스터플랜 §9 권고 준수

---

## 7. 한 줄 결정 요약
**`PRONOUN_RE` 를 "그 곳/그 위치/그 해변/같은 해역/방금 거" 등으로 확장하고 (단 "그 때/여기/근처" 는 제외 유지), 검출 시 focus.zone 우선순위를 (focus.zone → buoy 역추론 → memory fuzzy → profile default → 거절) 5단계로 재정의해 cat2 zone-miss 42건 중 G1/G2/G3/G4 군을 단계별로 흡수한다. 단 #30 시점 B 는 #32 (HALLUC_RE 정밀화) 완료 후 진입.**
