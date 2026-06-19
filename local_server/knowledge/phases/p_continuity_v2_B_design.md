# P_continuity_v2 패치 — 설계 시점 B

> 시점 A(`patch_A_continuity_localgov.md`)가 sentinel 2건(ANG-2-01b · LG-1-01)을 직타한 데 비해, 본 시점 B는 v5 1회차 자유변칙 **cat2(연속) 42건 실패**를 모집단으로 잡아 **focus 전파 + prev_id chain** 두 축을 일반화한다. **본 문서는 설계만**이며 코드 수정은 0건이다.

전제 컨텍스트:

- v5 1회차 종합 PASS 347/440 (78%), cat2 PASS 48%(실패 42건). 카테고리별 차트는 `v5_run1_report.md` §2.
- runner 의 chain 모델은 `chain_focus[c["prev_id"]]` 를 다음 요청의 `body.focus` 로 동봉(`phase2b_eval_freevar_runner.py` line 218, 235-238, 267-268). 즉, **러너 측 chain 구조 자체는 검증 완료**, 결함은 서버 측 `deriveFocus` / `runBrain` 의 focus 사용 게이트.
- 시점 A 가 이미 `buoyToCoords` 헬퍼(L114-122) + `focus.coords` 부이 폴백(L1329-1337) + ANG-2-01b 가드(L1579-1594) + LG-1-01 가드(L1596-1613) 를 코드에 반영해둠. 본 설계는 그 위에 *얹는다*.

---

## 1. prev_id chain 통계 — v5 실패 42건 분포

### 1.1 모집단 구조 (`phase2b_eval_freevar.jsonl`)

- 총 cat2 80건. 그 중 **`prev_id` 보유(=후속 잇기) 40건**, 선행 40건. `expect_zone_match` 어서션은 **40건 모두 후속에만** 부여.
- 후속 40건 = 8 직군 × 5쌍. zone 명 분포:
  - 표준 ZONE_NAMES 부분문자열: FIS/CG/NAV/MOF/PO 25건 (예: "동해중부", "서해광역").
  - 섬·부이 지명: ANG 5건 (거문도/마라도/추자도/홍도/위도).
  - 해변(beach): LEI 5건 (양양/송정/해운대/협재/광안리).
  - 모호 지명(local_gov 어휘): LG 5건 ("관내/우리시/관할/연안").

### 1.2 실패 42건의 prev_id 비율

> 로그(`v5_run1_freevar.log.gz`)는 실패 샘플 처음 10건만 텍스트 노출. 따라서 직접 매핑 가능한 ID 는 10건, 나머지 32건은 직군×cat2 카운트 차분(85% PASS 가정 + 직군별 PASS/총)에서 추정.

#### 직군별 cat2 실패 분해 (v5_run1_report.md §1, freevar 러너 출력 기준)

| 직군 | cat2 PASS | cat2 실패 | 선행/후속 추정 분포 |
|------|-----------|-----------|---------------------|
| angler | 5/10 | **5** | 선행 1(2-04a, get_visibility 만 호출) + 후속 4(01b/03b/04b/05b) |
| coast_guard | 5/10 | **5** | 선행 ≤1 + 후속 ≥4 (CG-2-0xb 중 다수, 동해/서해 zone-miss 가능성) |
| fishery | 5/10 | **5** | 선행 ≤1 + 후속 ≥4 (FIS-2-03a 환각 1건 + 03b/05b 등) |
| local_gov | 5/10 | **5** | 선행 0~1 + 후속 ≥4 (LG-2-0xb "관내/우리시" expect_zone_match 가 *모호어 자체* 라 zone canon 실패) |
| marine_leisure | 4/10 | **6** | 선행 ≥2(beach 케이스의 도구 미스) + 후속 ≤4 |
| mof | 7/10 | **3** | 선행 0 + 후속 3 (잇기에서 zone 누락) |
| navy | 4/10 | **6** | 선행 1~2 + 후속 ≥4 |
| public_org | 3/10 | **7** | 선행 ≥2 + 후속 ≤5 (광역/연안/항만 — ZONE_NAMES 미존재 어휘) |
| **합계** | **38/80** | **42** | 후속(prev_id) ≥ **30/42 ≈ 71%**, 선행 ≤ **12/42 ≈ 29%** |

#### 핵심 신호

- **prev_id 가진 후속이 실패의 약 70%** — chain_focus 갱신/전파가 실효되지 않는다는 신호.
- 단, "선행 케이스 실패"(약 30%) 도 무시할 수 없다 — 선행이 빈 응답을 내면 **다음 턴이 받는 focus 가 비거나 잘못된 zone 으로 오염**되어 후속 실패가 연쇄.

### 1.3 chain_focus 갱신 누락 의심 케이스 식별

ID 표본 기준 4 패턴.

| 패턴 | 대표 ID | 증상 | chain_focus 상태 |
|------|---------|------|------------------|
| **P1 — 선행 빈 도구** | ANG-2-04a ("홍도 시정") | `tools=['get_visibility']` 만 → `focus=null` 반환(line 1358, focus 5필드 모두 null 시 null). 다음 턴 focus 미동봉. | `chain_focus['ANG-2-04a'] = null` 가능성↑ |
| **P2 — 부이만 잡힘** | ANG-2-01b 직전(ANG-2-01a) | 거문도 부이 obs 정상이나 zone 미감지(섬 지명은 ZONE_NAMES 외) → focus={buoy:거문도, coords:…}, zone=null. 후속 "거기 풍속" 에서 `focusZone=null` → FOCUS_ZONE_ARG 매핑 미발동 → LLM 이 마라도/간여암 등 엉뚱한 부이로 응답. | 갱신은 되나 zone 키가 비어 후속 전파 효과↓ |
| **P3 — beach focus 미보존** | LEI-2-02a("송정 파고") | get_surfing_index(beach="송정") 또는 get_marine_forecast 결과의 zoneId/items 가 zone 필드를 못 채움 → focus.zone=null, focus.buoy=null. 다음 "그곳 풍속?" 잇기에서 송정 식별 불가. | 갱신은 되나 zone/buoy 둘 다 null |
| **P4 — 광역/모호어 zone** | PO-2-01a("동해광역 …"), LG-2-01a("관내 어때") | ZONE_NAMES 에 "동해광역/관내/우리시" 없음 → focus.zone=null. 후속 잇기는 expect_zone_match 자체가 "동해광역/관내" 인데, 답에 그 어휘가 들어가야 PASS. | 갱신은 되나 *zone 의미적 매칭 어려움* |

### 1.4 진단 요약

- 후속 실패의 직접 원인은 **`focus.zone` 미설정**. 우선순위 폴백이 좌표(C2)밖에 없는 점이 한계.
- 선행 케이스 실패가 *후속 케이스 chain 을 끊는다*: focus=null 이면 러너가 다음 요청에 focus 미동봉 → 후속이 첫 턴처럼 동작 → expect_zone_match 실패.
- 따라서 본 시점 B 는 (a) `deriveFocus` 의 zone 폴백 다중화, (b) `runBrain` 의 zone 적용 우선순위 강화, **두 축 동시 적용**해야 한다.

---

## 2. deriveFocus 강화 설계 — buoy/haegu/rankedItems 폴백 추가

### 2.1 현재 구조 (line 1322-1358)

zone 결정 우선순위:
1. `zoneName` 또는 `plan.zone` (planQuery 가 채워준 표준 해역명).
2. `top.zone` (rankedItems 1위가 zone 필드 보유 시).
3. `detectZoneDeterministic(query)` (line 1354-1356, 결함 1 patch).

→ 빈 자리: **buoy → zone**, **haegu → zone**, **rankedItems[0].해구 → zone**.

### 2.2 패치 — focus.zone 폴백 사다리 v2

`deriveFocus` 의 마지막 zone 보강 블록(line 1354-1356)을 다음으로 *대체*:

```js
// [패치 B — focus.zone 폴백 사다리 v2]
// 우선순위: (1) zoneName/plan.zone (이미 위에서 적용) → (2) top.zone(items)
//   → (3) detectZoneDeterministic(query) → (4) haegu→zone (HAEGU_TO_ZONE)
//   → (5) buoy→zone (BUOY_TO_ZONE)  → (6) rankedItems[0].zone/지점
// 각 단계는 위 단계가 비어있을 때만 다음으로 내려간다 — 더 신뢰도 높은 값 보존.
if (!focus.zone && typeof query === 'string') {
    const z = detectZoneDeterministic(query);
    if (z) focus.zone = z;
}
if (!focus.zone && focus.haegu) {
    const z = haeguToZone(focus.haegu);            // 해구번호 → 소속 해역명
    if (z) focus.zone = z;
}
if (!focus.zone && focus.buoy) {
    const z = buoyToZone(focus.buoy);              // 부이 지점 → 가장 가까운 해역명
    if (z) focus.zone = z;
}
if (!focus.zone && focus.rankedItems && focus.rankedItems.length) {
    const top = focus.rankedItems[0];
    focus.zone = top.zone || top['해역'] || top['지점'] || null;
}
```

### 2.3 신규 헬퍼 — haeguToZone / buoyToZone

`buoyToCoords`(L114) 직후 동일 패턴으로 신설:

```js
// 해구번호 → 표준 해역명 (HAEGU_INDEX 가 zoneId 와 zone 매핑을 이미 가짐 — 그 역인덱스 사용).
function haeguToZone(haeguId) {
    if (haeguId == null) return null;
    const rec = HAEGU_INDEX && HAEGU_INDEX[String(haeguId)];
    return rec && rec.zone ? rec.zone : null;
}
// 부이 지점 → 좌표 → 가장 가까운 해역명 (이미 있는 좌표↔해역 매핑 재활용).
function buoyToZone(buoyName) {
    const co = buoyToCoords(buoyName);
    if (!co) return null;
    return nearestZoneByCoords(co.lat, co.lon);    // 좌표 기반 해역 검색 (기존 헬퍼 또는 신규)
}
```

> `HAEGU_INDEX` / `nearestZoneByCoords` 가 없으면 (a) `dataCache.haegu` 트리에서 1회 빌드 또는 (b) 기존 `resolve_location` 로직 일부 재사용. 신규 헬퍼는 *zone 추정용*이므로 정확도보다 *연속성 보장*이 우선 — 매칭 실패 시 null 반환(안전).

### 2.4 focus 필드별 우선순위 (요약 표)

| focus 필드 | 우선순위 | 신뢰도 | 후속 활용처 |
|-----------|----------|--------|-------------|
| **zone** | (1) plan.zone (2) items[0].zone (3) detectZoneDeterministic (4) haegu→zone (5) buoy→zone (6) rankedItems[0].지점 | 높음(1,2) → 중(3,4) → 낮음(5,6) | FOCUS_ZONE_ARG 전체 도구 |
| **haegu** | (1) v.zoneId (2) top.해구 | 높음 | get_zone_forecast |
| **buoy** | (1) v.name(get_buoy_observation) (2) v.nearest.name | 높음 | get_buoy_observation |
| **coords** | (1) v.위도/경도 (2) v.nearest.lat/lon (3) buoyToCoords(buoy) (4) items[0].위도 | 높음(1,2,3) → 중(4) | COORD_TOOLS |
| **rankedItems** | items 배열 5개 cap | 중 | 합성 보조 |

→ **새로 추가되는 폴백은 모두 "더 낮은 신뢰도" 슬롯**이므로, 기존 정확값을 *덮지 않는다*. 회귀 위험 최저.

---

## 3. runBrain 흐름 보강 — zone 적용 우선순위 + PRONOUN_RE 분리

### 3.1 현 흐름의 결함

L1530 `isPronounFollowup = PRONOUN_RE.test(cq)` 가 **모든 focus 주입의 게이트**. 따라서:

- 후속 잇기인데 대명사 없는 경우 — 예: FIS-2-01b 가 "거기 풍속은?" 이라 PRONOUN_RE 매칭은 되지만, PO-2-05b("거기 파고?")처럼 짧고 단어 한두 개여서 LLM 이 zone 을 직접 채우지 못하는 경우 — focus.zone 이 있어도 `step.args[zoneArg]` 가 LLM 출력 그대로 비어 있을 수 있다.
- **`prev_id` 가 있으나 대명사 없는 잇기**(예: "수온?", "파고?" 같은 한 단어 후속)는 PRONOUN_RE 미매칭으로 *전혀 보강 안 됨*. v5 cat2 후속에 이런 패턴이 약 20% 존재(육안 검토).

### 3.2 chain-flag 도입 — `isChainFollowup`

서버 측에 prev_id 신호가 직접 들어오진 않으나, **focus 객체 비어있지 않음 = chain 의 표지**.

```js
// [패치 B — chain 후속 판별 (PRONOUN_RE 와 별개)]
// 러너가 focus 를 body 에 동봉했다 = prev_id chain. 대명사 없어도 후속으로 본다.
// (러너 line 235-238: focus = chain_focus.get(c["prev_id"]); → body.focus 로 전달.)
const isChainFollowup = !!(focus && (focus.zone || focus.haegu || focus.buoy || focus.coords));
const isFollowup = isPronounFollowup || isChainFollowup;
```

`isPronounFollowup` 사용 지점(L1555, L1579) 을 `isFollowup` 으로 *대체*. PRONOUN_RE 자체는 보존(zone-from-query 추정 등 다른 용도 보존).

### 3.3 zone 적용 우선순위 폴백 — 3단

L1557-1558 의 FOCUS_ZONE_ARG 주입을 다음으로 *확장*:

```js
// [패치 B — zone 인자 폴백 3단]
// (a) step.args[zoneArg] 가 LLM 이 채운 비표준 zone → canonZone 으로 표준화
// (b) 표준화 실패 또는 빈값 + focus.zone 있음 → focus.zone 주입
// (c) (b) 도 없으면 detectZoneDeterministic(cq) 시도 — 대명사 없는 후속 보강
// (d) 그래도 없으면 차후 hasRealData=false → 환각 가드(L1665) 가 거절 폴백
const zoneArg = FOCUS_ZONE_ARG[step.tool];
if (zoneArg) {
    let z = step.args[zoneArg];
    if (typeof z === 'string') z = canonZone(z);
    if (!z && focusZone) z = focusZone;
    if (!z) z = detectZoneDeterministic(cq);       // 마지막 시도 — 표준 해역명 명시 시 (FIS-2-01b 의 "거기" 가 무시되어도 부모 query 잔향 없음 → null 가능)
    if (z) step.args[zoneArg] = z;
}
```

> **포인트**: `detectZoneDeterministic(cq)` 가 후속 query("거기 풍속") 단독으로는 거의 항상 null 이다(zone 키워드 부재). 따라서 (c) 단계는 대명사 없는 zone 명 직접 언급 케이스(예: "동해 풍속?" 가 "거기" 없이 들어온 경우) 에만 활성. 이 단계가 **회귀를 일으키지 않는 안전 폴백**임을 명시.

### 3.4 zone 미해소 → 거절 폴백 명시

L1665 의 `isDomainQuery && results.length === 0` 가드는 *도구 0건* 일 때만 발동. cat2 후속의 진짜 실패 모드는 *도구는 1+건 실행, 그러나 args 가 비어 결과가 다른 zone* 인 경우(예: ANG-2-01b 가 "간여암의 풍속은…" 라고 답).

→ 새 가드 신설 (L1665 블록 직후):

```js
// [패치 B — chain zone-miss 거절 폴백]
// 후속 잇기인데 (focus.zone 없음 + LLM 도 zone 못 채움 + detect 도 null)
// 이고 도구 1+개 실행됐으나 결과가 모두 *zone-mismatch* 인 경우.
// 환각 가드 대신 친절한 명시적 거절 — chain 의 마지막 안전망.
if (isChainFollowup && !focusZone && results.length > 0) {
    // results 의 어떤 v 도 사용자 질의의 *원래 대상*(focus.buoy/haegu) 과
    // 정합하지 않으면 거절. focus.buoy 가 있으면 거기 기준으로 정합 검사.
    const anchorOk = results.some(r => {
        const v = r && r.result;
        if (!v || v.error) return false;
        if (focus.buoy && v.name && String(v.name) === String(focus.buoy)) return true;
        if (focus.haegu && v.zoneId && String(v.zoneId) === String(focus.haegu)) return true;
        return false;
    });
    if (!anchorOk) {
        return {
            answer: '직전 대상에 대한 정보를 다시 가져오지 못했어요. 해역명을 한 번 더 알려주시면 정확히 답해드릴게요.',
            zone: focus.zone || null, toolsUsed: results.map(r => r.tool),
            corrected, focus
        };
    }
}
```

### 3.5 흐름 다이어그램 (의사 코드)

```
runBrain(cq, focus)
 │
 ├─ isPronounFollowup = PRONOUN_RE.test(cq)
 ├─ isChainFollowup   = !!focus && hasAnyKey(focus)        ★ NEW
 ├─ isFollowup        = pronoun OR chain                    ★ NEW
 │
 └─ for step in plan.steps:
     if isFollowup:
        zoneArg ← FOCUS_ZONE_ARG[step.tool]
        if zoneArg:
            z = canonZone(step.args[zoneArg])
            z = z || focus.zone                ★ B 단계
            z = z || detectZoneDeterministic(cq)   ★ C 단계
            if z: step.args[zoneArg] = z
        # buoy/haegu/coords 주입 — 기존 그대로
 │
 ├─ 도구 실행 (L1615-1621)
 ├─ 의존 위빙 needsReplan (L1626-1638)        ← §6 상호작용
 │
 └─ 새 가드: isChainFollowup && !focus.zone && anchorOk(results) == false
     → 명시적 거절 응답                       ★ NEW
```

---

## 4. focus 누수 방지 — α C5-pre 공유 상수 / #24 응답 후처리와의 정합성

### 4.1 α C5-pre 공유 상수 (L1515-1525) 와의 충돌

- 공유 상수: `VAGUE_LOCAL_RE`, `MONITOR_JIKGUN`, `OVERVIEW_RE`, `_jikgunSlug`, `canonZone`. **본 패치는 이들에 read-only 로 접근**. 변경 없음 → 충돌 없음.
- 본 패치가 신설하는 변수: `isChainFollowup`, `isFollowup`, `haeguToZone`/`buoyToZone` (헬퍼).
  - `isFollowup` 은 `isPronounFollowup` 과 동시 존재(별칭처럼 사용) → 함수 스코프 중복 없음.
  - 헬퍼 2개는 `buoyToCoords` 와 동일한 모듈 스코프(L114) → 합쳐도 단일 책임 위반 X.

### 4.2 #24 응답 후처리 (cleanAnswer L1707-1712) 와의 정합성

- cleanAnswer 는 **라벨 라인 제거**(`[직전 확정 대상]`, `[최근 대화]` 등) + `focus:` `memory:` 등 prefix 만 제거.
- 본 패치가 추가하는 거절 응답 텍스트 "직전 대상에 대한 정보를 다시 가져오지 못했어요…" 는 **순수 자연어 1문장**. 라벨/prefix 없음 → cleanAnswer 가 의도치 않게 잘라낼 위험 0.
- 본 패치가 focus.zone 을 *내부적으로* 채우는 경로(deriveFocus 폴백)는 **응답 텍스트에 zone 명을 직접 노출하지 않는다** — synth 가 자연어로 풀어쓰는 통로(L1700 `질문: "${cq}"\n수집결과(JSON): …`)는 *수집결과 JSON* 만 보여주고 focus 는 안 보여줌. 따라서 누수 면에서도 안전.

### 4.3 focus 객체 자체가 클라이언트로 반환되는 경로 (L1713)

- runBrain 결과 `{ focus: deriveFocus(...) }` 는 클라이언트로 그대로 전달. 즉 클라이언트가 다음 턴 요청 시 동일 focus 를 동봉 → chain 갱신은 *클라이언트가 책임*. 러너 코드(line 268) 가 이를 그대로 사용.
- 본 패치로 focus.zone 폴백이 *더 자주* null 이 아니게 채워짐 → 다음 턴이 focus.zone 항상 받음 → P1/P3 패턴 (focus=null 갱신 누락) 해소.

---

## 5. 회귀 가드 — 표본 추출

### 5.1 sentinel zone-miss 4건 (phase2b_sentinel.jsonl)

cat2 zone-miss 직타 가드: 시점 A 가 이미 ANG-2-01b 직타. 본 패치는 추가로:

| Sentinel ID | 현재 상태(v5) | 기대 효과 (시점 B 적용 시) |
|-------------|----------------|----------------------------|
| **ANG-2-01a → 01b** | 시점 A 로 부이/좌표 폴백 통과(예상) | (B) 후속 query 의 zone-arg 폴백 3단으로 `get_marine_forecast(zone=거문도→인근해역)` 도 보강. |
| **CG-2-01a → 01b** | "동해중부 특보" 선행 → "거기 풍속" 후속 | (B) focus.zone="동해중부" 가 정상 잡혀 있다는 전제 + isChainFollowup 게이트로 FOCUS_ZONE_ARG 발동. |
| **MOF-6-01a → 01b** | "동해 정책 우선?" → "방금 결정 사유" (메타) | (B) PRONOUN_RE 매칭("방금") 으로 기존 경로 활용. 본 패치 영향 미미(메타 cat6, zone 무관). |
| **LG-1-01** | "관내 어때" 단일 턴 (focus 없음) | (B) 영향 없음 — 시점 A 의 §C5 LG 가드 그대로 작동. |

### 5.2 v5 cat2 후속 표본 5건

failure log + jsonl 교차로 추출한 *대표 실패* 5건. 패치 후 반드시 회귀 게이트 통과 확인 대상.

| ID | profile | 선행 query | 후속 query | expect_zone | 시점 B 핵심 효과 |
|----|---------|-----------|------------|-------------|------------------|
| **ANG-2-01b** | {purpose:낚시} | "거문도 파고 알려줘" | "거기 풍속은?" | "거문도" | buoy→zone (§2.3) + zone-arg C단(§3.3) — 답 "거문도 풍속…" |
| **ANG-2-04b** | {purpose:낚시} | "홍도 시정" | "거기 부이는?" | "홍도" | 선행 P1(visibility 만) 으로 focus.buoy=null 일 수 있음 → §2.2 (4)(5) 의 buoy→zone 부족. **선행 deriveFocus 가 get_visibility 결과에서도 focus.buoy 채우게 보강 필요** (선행 결함이 chain 끊음). 별도 #추가검토. |
| **FIS-2-03b** | {occupation:어선 선장} | "제주도북부 유속" | "거기 풍향?" | "제주도북부" | focus.zone="제주도북부앞바다"(detectZoneDeterministic) 가 정상이라는 전제 → §3.3 의 (b) 단계로 zone 주입 → get_marine_forecast(zone="제주도북부앞바다") 정상. |
| **PO-2-05b** | {affiliation:해양환경공단} | "PO-2-05a (항만 관련 선행)" | "거기 파고?" | "항만" | "항만" 은 ZONE_NAMES 외 → focus.zone=null. §3.4 의 chain zone-miss 거절 폴백 발동 → "직전 대상에 대한 정보를 다시 가져오지 못했어요" 응답. expect_zone_match("항만") 통과 여부는 *합성 답 텍스트에 "항만" 포함* 인지 별도 검토 — **본 가드는 PASS 가 아니라 환각 차단이 1차 목표**. |
| **LG-2-01b** | {affiliation:시청 방재} | "LG-2-01a (관내 …)" | "거기 풍속?" | "관내" | 선행이 §C5 LG 가드로 get_warning(args={}) 호출 → focus.zone=null 가능성↑. §3.4 의 chain zone-miss 거절 폴백 발동 → 안전 거절. 마찬가지로 expect_zone_match("관내") 직접 PASS 는 어렵지만 환각 의심 카운트는 감소. |

> **표본 통찰**: 후속 PASS 가 직접 달성되는 케이스(ANG-2-01b/FIS-2-03b 류)는 약 60%. 나머지(PO/LG 류 모호어/광역) 는 *환각 차단으로 가드*, expect_zone_match 자체는 별도 P_continuity_v3 에서 zone 어휘 사전 확장으로 해결 권장.

### 5.3 회귀 가드 체크리스트 (게이트 명시)

- [ ] sentinel 20케이스 전체 PASS (시점 A 와 동일 베이스).
- [ ] freevar cat2 PASS ≥ 60% (38/80 → 48/80 목표, +12건).
- [ ] freevar cat1(기본) PASS 유지 92% 이상 — `isChainFollowup` 게이트는 첫 턴(focus 없음) 동작에 영향 없는지 검증.
- [ ] freevar cat5(비도메인) PASS 유지 98% — 거절 폴백이 비도메인 케이스에 잘못 발동 안 하는지(cat5 는 focus 동봉 0% 라 영향 0 예상).
- [ ] 환각 의심 ≤ 4 (현 8건에서 절반 이하). ANG-2-05b/FIS-2-03a 등 zone-miss 환각이 본 패치로 *거절* 로 전환되는지.

---

## 6. #30(continuity_v2) ↔ #31(multitool) 상호작용 검토

### 6.1 `needsReplan` (L1493-1502) 트리거 조건

```js
sup = /(가장|제일|최고|최저|높은|낮은|센|약한|많은|적은|상위|랭킹|줄세|순위)/
sec = /(조석|물때|만조|간조|유속|유향|해류|수심|특보|주의보|경보|해무|씨씨티비)/
needsReplan ⇔ focus 존재 && (sup && sec) && 2차 도구 미실행
```

### 6.2 본 패치(continuity_v2)가 `needsReplan` 에 미치는 영향

- **focus 가 더 자주 채워짐** (deriveFocus 폴백 4단 추가) → `needsReplan` 의 "focus 존재" 게이트가 *더 자주 true*. 단, 이는 sup+sec 동시 매칭일 때만 발동 → cat2 후속의 짧은 query("거기 풍속?")는 sup 매칭 0 → 영향 없음.
- *연속 카테고리는 sup 키워드("가장/제일/랭킹") 거의 없음* → cat2 ↔ multitool re-plan 트리거의 *교차는 사실상 0건*.
- 예외: cat3 다중도구 + cat2 후속 잇기가 동시인 가상 케이스 — 본 jsonl 에 없음. 안전.

### 6.3 본 패치가 multitool 의 1차 도구 실행에 미치는 영향

- §3.3 zone-arg C단(detectZoneDeterministic(cq)) 은 cq 에 표준 zone 명이 있을 때만 트리거 → 멀티툴 1차 도구의 zone 정확도 *높임*. 즉, **#31 multitool 의 cat3 PASS 도 보조적으로 상승 기대** (간접 시너지).
- §3.4 chain zone-miss 거절 폴백은 *후속*에서만 발동(isChainFollowup 게이트). 첫 턴 멀티툴 호출엔 영향 0.

### 6.4 결론

**#30 ↔ #31 충돌 없음, 미약한 양의 시너지**. #30 단독 적용 → #31 적용 순서 권장(시점 A 의 적용 순서와 동일).

---

## 7. 적용 순서 권장

1. (헬퍼) `haeguToZone`, `buoyToZone` 추가 — 위험 0.
2. (deriveFocus L1352-1357) zone 폴백 사다리 v2 — 단독 회귀 확인.
3. (runBrain L1530) `isChainFollowup` / `isFollowup` 도입 — sentinel 전체 회귀.
4. (runBrain L1557-1558) zone-arg 폴백 3단 확장.
5. (runBrain 새 가드) chain zone-miss 거절 폴백 — freevar cat2 + cat5 회귀.
6. freevar 440 전수 회귀 → cat2 ≥60% + 환각 ≤4 + cat1/cat5 유지 → 머지.

---

## 8. 미해결 잔존 위험

- **모호어/광역 zone**(LG-2-0x*, PO-2-0x* 의 "관내/관할/광역/항만") 은 expect_zone_match 의 *어휘 자체가 비표준* → 본 패치로는 **환각 차단**만 달성, PASS 직접 상승은 제한적. → P_continuity_v3 에서 zone 동의어 사전(VAGUE_TO_ZONE) 또는 expect_zone_match 어휘 표준화 필요.
- **선행 케이스 P1 결함**(get_visibility/get_fishing_index 만 호출 → focus 5필드 모두 null) 은 본 패치 §2 가 부분 해소(rankedItems/coords 등 채우기). 다만 단일 도구만 호출한 선행의 결과 객체에 `위도/경도` 가 없으면 여전히 chain 끊김. → 각 TOOL_EXEC 의 *반환 객체 표준화*가 별도 phase 에 필요.
- **PRONOUN_RE 의존성 분리** 의 부작용: 클라이언트가 *실수로* 빈 focus 객체 `{}` 를 동봉하면 `isChainFollowup=false` (hasAnyKey 검증). 안전 보강 완료.

---

## 9. 한 줄 핵심 결정

> **cat2 후속 실패의 70%는 `focus.zone` 미설정에 기인 — `deriveFocus` 에 haegu/buoy/rankedItems→zone 폴백 사다리를 얹고, `runBrain` 의 PRONOUN_RE 게이트를 `isChainFollowup`(focus 동봉 자체)로 확장한 뒤, zone 미해소 chain 후속에 거절 폴백을 두 단계로 강화.**
