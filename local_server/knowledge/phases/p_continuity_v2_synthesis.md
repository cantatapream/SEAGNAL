# P_continuity_v2 합성 — A·B 통합 코드 적용 가능 설계서

> 입력
> - `p_continuity_v2_A_design.md` (워커-A: PRONOUN_RE 확장 + focus.zone 5단 폴백 + G1~G5 분류)
> - `p_continuity_v2_B_design.md` (워커-B: deriveFocus 6단 폴백 + isChainFollowup + zone-arg 3단 + 회귀 가드 5)
> - `alpha_synthesis_R2.md` (충돌 봉합 패턴 — `_buoyPlanTools`/`_lgPlanTools` 식별자 분리·공유 상수 1회 선언)
>
> 본 문서는 **설계 합성만(코드 수정 0)**. 출력은 ①A·B 충돌·시너지, ②5단↔6단 폴백을 단일 **7단계**로 통합, ③신규 헬퍼 시그니처·위치, ④runBrain 분기 위치 확정, ⑤회귀 가드 합집합, ⑥**5 hunks patch diff 안**, ⑦hunk 별 위험 등급(1~5), ⑧검증 시나리오.

---

## 1. A vs B 충돌·시너지 분석

### 1.1 직접 충돌(라인·식별자) — 0건

A·B 모두 동일 라인을 직접 수정하지 않는다. 양쪽 모두 **deriveFocus(L1322–1358) zone 폴백 블록**과 **runBrain L1530 PRONOUN 분기**를 중심으로 *확장*만 제안한다. α R2 의 식별자 격리 패턴(`_buoyPlanTools`/`_lgPlanTools`) 을 그대로 차용해 본 패치도 `_chainGate`·`_zoneFallbackTier` 식 격리 식별자를 권고한다.

### 1.2 의미 충돌(개념 정합) — 3건, 모두 통합으로 해소

| # | 영역 | A 입장 | B 입장 | 합성 결정 |
|---|-----|--------|--------|---------|
| **M1** | **트리거 게이트** | `PRONOUN_RE` 확장 (명시 대명사 매칭 강화 — "그 곳/그 위치/같은 해역/방금 거…") | `isChainFollowup`(focus 동봉 자체로 후속 판정 — 대명사 없어도) | **양쪽 OR 결합**. `isFollowup = isPronounFollowup ∥ isChainFollowup`. **A 가 매칭 면을 넓히고, B 가 매칭 누락 자체를 우회**. 둘 다 false 인 케이스만 zone 주입 비활성. 회귀 안전. |
| **M2** | **focus.zone 폴백 단계 수** | A=5단(focus.zone → buoy 역추론 → memory fuzzy → profile default → 거절) | B=6단(zone → items[0] → detectZone → haegu → buoy → rankedItems) | **단일 7단계로 통합**(§2). A 의 profile default(4) + 거절(5) 가 B 의 6단 *뒤*에 붙는 안전망. **거절은 항상 최종**. |
| **M3** | **거짓양성 대응** | A: PRONOUN_RE 확장 시 "그때/여기/근처" 제외 명시 + sentinel 6건 | B: `isChainFollowup` 도입 시 빈 객체 `{}` 가드(`hasAnyKey`) + 회귀 가드 5건 | **양쪽 가드 합집합**. A 의 6건 + B 의 5건 + 신규 거짓양성 3건(§5) = **총 14건 가드**. 중복 제거 후 sentinel 9 + 거짓양성 5. |

### 1.3 시너지 — 3건

| # | 시너지 포인트 | 효과 |
|---|------------|-----|
| **S1** | A 의 PRONOUN_RE 확장이 B 의 `isChainFollowup` *불필요한 케이스를 줄임* | 대명사 매칭 면이 넓어지면 chain 게이트 의존도↓, **PRONOUN 만으로 처리되는 후속이 증가** → focus 동봉 실수에도 회복력↑ |
| **S2** | B 의 deriveFocus 폴백이 A 의 PRONOUN 우선순위 2단(buoy 역추론) *를 흡수* | A 가 runBrain 안에서 buoy→zone 역추론을 별도로 하지 않고, **deriveFocus 가 미리 채워 보냄** → runBrain 분기 간소화 |
| **S3** | A 의 G4(buoy 군집) + B 의 P2(부이만 잡힘) 동일 결함 | **단일 패치(`buoyToZone` 신설)** 로 양쪽 해소. 코드 중복 0. |

### 1.4 결론

**충돌 0건, 의미 정합 3건은 합성으로 자연 해소, 시너지 3건**. A·B 분리 머지 금지 없음 (alpha 처럼 강한 의존 없음 — 단, 7단계 폴백의 일관성을 위해 **단일 커밋 권장**).

---

## 2. 5단 ↔ 6단 폴백 → **단일 7단계 통합**

### 2.1 A·B 폴백 정의 (재요약)

- **A(5단)** : `focus.zone` → buoy 역추론 → memory fuzzy → profile default → 거절
- **B(6단)** : `plan.zone/zoneName` → `top.zone(items)` → `detectZoneDeterministic(query)` → `haeguToZone(focus.haegu)` → `buoyToZone(focus.buoy)` → `rankedItems[0].zone/지점`

### 2.2 통합 7단계 폴백 (zone 결정 사다리)

| 단 | 출처 | 신뢰도 | 출처 워커 | 비고 |
|----|-----|--------|---------|-----|
| **1** | `plan.zone` / `zoneName` (planQuery 가 결정한 표준 해역명) | 매우 높음 | B | 기존 보존 |
| **2** | `top.zone` — 1차 결과 `items[0].zone` | 높음 | B | 기존 보존 |
| **3** | `detectZoneDeterministic(query)` (query 텍스트 fuzzy) | 중상 | A·B 공통 | 기존 L1354 |
| **4** | `haeguToZone(focus.haegu)` — 해구번호 역인덱스 | 중상 | B | 신규 §3 |
| **5** | `buoyToZone(focus.buoy)` — 부이→좌표→최근접 해역 | 중 | A·B 공통 | 신규 §3 |
| **6** | `rankedItems[0].zone ∥ ['해역'] ∥ ['지점']` | 중 | B | 신규 |
| **7** | `profileDefaultZone(profile)` — 모호어("관내/관할") 폴백 | 낮음 | A | **B 누락**, A 가 추가 |
| **거절** | 위 1~7 모두 null → 명시적 거절 응답("어느 해역 말씀이실까요?") | — | A·B 공통 | runBrain 안전망 |

> **핵심 통합 결정**:
> - 1~6 단은 **`deriveFocus` 안에서** 처리 (이미 `deriveFocus` 가 focus 객체를 반환할 때 zone 채움). 신뢰도 높음 → 중 순으로 *덮지 않는 폴백*.
> - 7 단(profile default)은 **`runBrain` 안에서** 처리. 이유: deriveFocus 는 profile 객체 미보유 — 인자 추가 시 호출처 3곳 (L1625/L1677/L1713) 변경 필요. **시그니처 안정성 우선**.
> - **거절**은 runBrain 의 새 가드(§4.3) 에서. L1665 의 `isDomainQuery && results.length===0` 가드와 별개로, *chain 후속 + zone 미해소 + 결과는 있지만 anchor 불일치* 케이스 직타.

### 2.3 단계별 fall-through 코드 도식 (의사 코드)

```
// [deriveFocus 안 — 1~6 단]
if (!focus.zone) focus.zone = plan.zone || zoneName;                // 1
if (!focus.zone) focus.zone = top.zone;                              // 2 (기존 L1348)
if (!focus.zone) focus.zone = detectZoneDeterministic(query);        // 3 (기존 L1354)
if (!focus.zone) focus.zone = haeguToZone(focus.haegu);              // 4 ★ NEW
if (!focus.zone) focus.zone = buoyToZone(focus.buoy);                // 5 ★ NEW (B 신규)
if (!focus.zone && focus.rankedItems?.length) {                      // 6 ★ NEW
    const t = focus.rankedItems[0];
    focus.zone = t.zone || t['해역'] || t['지점'] || null;
}

// [runBrain 안 — 7 단 + 거절]
let chainZone = (focus && focus.zone) || null;
if (!chainZone && isFollowup) {
    const _pz = profileDefaultZone(profile);                         // 7
    if (_pz) chainZone = _pz;
}
// (거절은 §4.3 의 새 가드)
```

---

## 3. 신규 헬퍼 시그니처 — `haeguToZone` / `buoyToZone` / `nearestZoneByCoords`

### 3.1 위치 — α `buoyToCoords` L112 영역과 동일 모듈 스코프

α R2 §1.1 은 `buoyToCoords` 를 L110 직후 신규 함수로 추가했다. 본 패치는 같은 영역(**L121 직후**, `buoyToCoords` 정의 직후) 에 신규 2~3개 헬퍼를 *연속 배치*. 모듈 스코프 1회 정의 → 호출처 다수.

### 3.2 명명 규칙 일관성 (α `buoyToCoords` 와 동일 패턴)

| 헬퍼 | 시그니처 | α 와의 패턴 일치 |
|------|---------|----------------|
| `buoyToCoords(name)` | `(name:string) → {lat,lon} \| null` | 기준(α C1) |
| **`buoyToZone(name)`** | `(name:string) → string \| null` | ✅ `buoy→X` 패턴 — 동일 입력 정규화(`replace(/[\s·]/g,'')`) |
| **`haeguToZone(haeguId)`** | `(haeguId:string\|number) → string \| null` | ✅ `haegu→X` 패턴 — `String(haeguId)` 정규화 |
| **`nearestZoneByCoords(lat,lon)`** | `(lat:number, lon:number) → string \| null` | ✅ 좌표→X 패턴 — `SEA_ZONE_COORDINATES` 역검색 |

### 3.3 의존성 결정 (신규 헬퍼 내부 동작)

- **`haeguToZone(haeguId)`** — 우선 `ZONE_NAME_TO_CODE` 의 역인덱스(zoneId → zoneName). `dataCache.haegu` 가 따로 있으면 우선 사용. **없으면 null 반환(안전)**.
- **`buoyToZone(name)`** — 2단 합성: `buoyToCoords(name) → nearestZoneByCoords(lat,lon)`. **buoyToCoords 미스 시 null**, 좌표는 있는데 해역 매칭 실패도 null.
- **`nearestZoneByCoords(lat,lon)`** — `SEA_ZONE_COORDINATES.js` 의 (zoneName, 중심좌표) 배열을 순회하며 Haversine 최단거리. **반경 200km 초과 시 null** (오매칭 차단).

### 3.4 `neighbor` 함수 위치 (B 가 명시 없음 — 본 합성에서 확정)

B 는 `nearestZoneByCoords` 를 "기존 헬퍼 또는 신규"로 모호하게 둠. 본 합성은 **신규 헬퍼**로 확정 — 위 §3.1 의 L121 직후 위치에 `buoyToZone` 과 함께 묶음 배치. **모듈 스코프 read-only**. (`SEA_ZONE_COORDINATES` 미로드 시 null 반환 → 안전.)

---

## 4. runBrain 분기 위치 — 어디서 발동하는가

### 4.1 분기 배치 원칙 — `deriveFocus` vs `runBrain` 분리

| 단계 | 위치 | 사유 |
|-----|-----|-----|
| **폴백 1~6 (deriveFocus)** | L1322–1358 안에 *대체* — 기존 L1354–1356 의 detectZoneDeterministic 블록을 6단 fall-through 로 확장 | focus 객체 결정은 **결정론**. profile 미의존. 호출처 3곳(L1625/L1677/L1713) 모두 자동 수혜. |
| **7단(profile default)** | runBrain L1572 직후 신규 블록(`_chainZoneFallback`) | profile 인자가 runBrain 만 보유. deriveFocus 시그니처 변경 회피(α R2 §1.2 식별자 분리 원칙). |
| **거절 폴백** | runBrain L1665 의 `isDomainQuery && results.length===0` *직후* 새 if 블록 | 도구 1+개 실행 + chain 후속 + anchor 불일치 케이스 직타. 기존 환각 가드와 분리. |
| **isFollowup 통합** | runBrain L1530 직후 — `isPronounFollowup` 정의 직후 `isChainFollowup` + `isFollowup` 정의 | 기존 L1530 PRONOUN_RE 라인은 *보존*(다른 분기 의존 가능성). |

### 4.2 신규 함수 도입 여부 — `resolveZoneWithChain` 별도 함수?

**도입 안 함**. 사유:
- 7단 폴백은 deriveFocus(6단) + runBrain(1단 + 거절) 으로 *자연 분할*되어 별도 wrapper 함수 불필요.
- α R2 의 함수 상단 1회 선언 원칙과 일관 — 신규 함수 추가는 시그니처 변경 = 호출처 추적 부담.
- 만약 향후 chain 폴백을 다른 함수(예: 새 도구)에서도 재사용한다면 그때 wrapper 도입.

### 4.3 분기 위치 다이어그램

```
runBrain(query, profile, memory, style, location, focus)
 ├─ L1505 plan = planQuery(...)
 ├─ L1515–1525 공유 상수 (α C5-pre 보존)
 ├─ L1529 PRONOUN_RE = /…/ (★ HUNK#3 으로 확장)
 ├─ L1530 isPronounFollowup
 │        ★ HUNK#4: isChainFollowup + isFollowup 추가
 │
 ├─ L1552–1572 for step in plan.steps: focus 주입
 │        ★ HUNK#4: isPronounFollowup → isFollowup 치환
 │        ★ HUNK#4: zone-arg 3단 폴백 (canonZone → focusZone → detectZone)
 │
 ├─ L1574–1594 부이 follow-up 게이트 (α C4 — 보존)
 ├─ L1596–1613 LG 강제 게이트 (α C5 — 보존)
 │
 │  ★ HUNK#4b: 신규 _chainZoneFallback (profile default = 7단)
 │
 ├─ L1615–1621 도구 실행
 ├─ L1623–1638 needsReplan (보존)
 ├─ L1665 환각 가드 (보존)
 │
 │  ★ HUNK#5: chain zone-miss 거절 폴백 (anchor 불일치 검사)
 │
 └─ L1681–1713 synth + cleanAnswer + deriveFocus 재호출
```

---

## 5. 회귀 가드 통합 — A 6건 + B 5건 + 거짓양성 3건 = 14건

### 5.1 sentinel 직타 가드 (A·B 합집합, 중복 제거)

| ID | 출처 | 시나리오 | 통과 기준 | 책임 hunk |
|----|-----|---------|---------|----------|
| **ANG-2-01b** | A·B | "거문도 파고"→"거기 풍속?" | answer ⊇ "거문도", halluc 없음 | HUNK#1(buoyToZone)·#2(deriveFocus 폴백)·#4(zone-arg) |
| **CG-2-01b** | A·B | "동해중부 특보"→"거기 풍속?" | answer ⊇ "동해중부" | HUNK#4 |
| **PO-2-01b** | A | "동해광역 시정"→"거기 풍속?" | answer ⊇ "동해광역" | HUNK#2(detectZone)·#4 |
| **NAV-2-01b** | A | "동해중부 파고"→"거기 수심?" | get_depth 호출 + zone="동해중부" | HUNK#4 (FOCUS_ZONE_ARG[get_depth]='zone' 작동) |
| **ANG-2-04b** | A·B | "홍도 시정"→"거기 부이는?" | focus.zone="홍도" → list_buoys_near | HUNK#1·#2 (선행이 visibility 만이라도 focus.zone 채움) |
| **ANG-2-05b** | A | "위도 낚시지수"→"그 위도 풍속?" | "그 위도" PRONOUN 매칭 + focus 유지 | HUNK#3 (PRONOUN_RE 확장) |
| **FIS-2-03b** | B | "제주도북부 유속"→"거기 풍향?" | get_marine_forecast(zone="제주도북부앞바다") | HUNK#4 (zone-arg 3단 b 단계) |
| **LG-2-01b** | A·B | "관내 특보"→"거기 풍속?" | profile default 또는 거절 폴백 | HUNK#4b(7단)·#5(거절) |
| **PO-2-05b** | B | "항만 …"→"거기 파고?" | anchor 불일치 → 거절("정보를 다시 가져오지…") | HUNK#5 |

### 5.2 거짓양성(false-positive) 가드 — A 4건 + 신규 3건

| ID | 시나리오 | 통과 기준 | 책임 hunk |
|----|---------|---------|----------|
| **FP-1** | "그때 파고 알려줘" | `isPronounFollowup === false` (시간 후속, #27 보수화 보존) | HUNK#3 (PRONOUN_RE 에 `그\s*때` 미포함) |
| **FP-2** | "그 다음엔 어디가 좋을까?" | `false` | HUNK#3 |
| **FP-3** | "여기 알려줘" + GPS 객체 보유 | `false` (GPS 우선) | HUNK#3 |
| **FP-4** | "근처 부이" | `false` (#31 multitool 영역 분리) | HUNK#3 |
| **FP-5** ★신규 | 빈 focus 객체 `{}` 동봉 (클라이언트 실수) | `isChainFollowup === false` (`hasAnyKey` 가드) | HUNK#4 (`!!(focus && (focus.zone\|\|focus.haegu\|\|focus.buoy\|\|focus.coords))`) |
| **FP-6** ★신규 | "방금 거" 가 일반 회화 ("방금 거 봤어?") | zone 주입은 되나 결과 자연어가 어색하지 않은지 — answer 길이·결정 단어 정합 | HUNK#3 + synth(영향 없음 검증) |
| **FP-7** ★신규 | cat5 비도메인("회식 어때") + focus 동봉 (이전 턴 잔향) | `isChainFollowup=true` 이나 도메인 미감지 → 거절 폴백 미발동 (cat5 PASS 유지) | HUNK#5 (`isDomainQuery` AND 조건) |

### 5.3 측정 게이트 (A·B 합집합 — 최대값 채택)

- **cat2 PASS** : ≥ 60% (A 권고 = B 권고, 48% → +12pp)
- **직군별 cat2 floor** : ≥ 4/10 (A 권고 — public_org 3/10 → ≥4)
- **cat1·cat3·cat5 회귀** : ±2pp (B 권고)
- **환각 의심** : ≤ 4 (A·B 공통, 현 8건 → 절반)
- **sentinel 통과** : 9/9 직타 + 7/7 거짓양성 = **16/16**

---

## 6. 코드 적용 의사코드 — **5 hunks patch diff 안**

> 라인 번호는 `assistant.js` 현재 head 기준. α C1·C2·C4·C5·C5-pre 이미 반영. **코드 수정 0** — 본 §6 은 *적용 시 예상 diff*.

### 6.1 HUNK #1 — `buoyToZone` / `haeguToZone` / `nearestZoneByCoords` 신규 헬퍼 (L121 직후)

위치: `buoyToCoords` 정의 직후 (L121 의 닫는 `}` 다음 줄). α C1 패턴과 동일 모듈 스코프.

```diff
@@ -121,6 +121,40 @@ function buoyToCoords(name) {
     return hit ? { lat: hit.lat, lon: hit.lon } : null;
 }

+// [P_continuity_v2 — HUNK#1] 부이 이름 → 가장 가까운 표준 해역명.
+//   buoyToCoords 패턴 일관 (α C1). focus.buoy 만 있고 focus.zone 이 비어
+//   chain 후속에서 zone-arg 주입 실패하는 케이스(B §1.3 P2, A G4) 직타.
+function buoyToZone(name) {
+    const co = buoyToCoords(name);
+    if (!co) return null;
+    return nearestZoneByCoords(co.lat, co.lon);
+}
+
+// 해구번호 → 소속 표준 해역명. ZONE_NAME_TO_CODE 의 역인덱스 1회 빌드.
+//   focus.haegu 만 잡힌 케이스(B §2.4 표 — get_zone_forecast 후속) 직타.
+function haeguToZone(haeguId) {
+    if (haeguId == null) return null;
+    const id = String(haeguId);
+    // ZONE_NAME_TO_CODE: { 동해중부: '12B10101', … } → 역인덱스
+    if (!haeguToZone._idx) {
+        haeguToZone._idx = {};
+        try {
+            for (const [zn, code] of Object.entries(ZONE_NAME_TO_CODE || {})) {
+                haeguToZone._idx[String(code)] = zn;
+            }
+        } catch (e) { /* 안전 폴백 */ }
+    }
+    return haeguToZone._idx[id] || null;
+}
+
+// 좌표 → 가장 가까운 표준 해역명. SEA_ZONE_COORDINATES 의 중심점 Haversine.
+//   반경 200km 초과 시 null (오매칭 차단 — A §5.4 zoneRaw 보존 원칙).
+function nearestZoneByCoords(lat, lon) {
+    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
+    let best = null, bestD = Infinity;
+    const tbl = (typeof SEA_ZONE_COORDINATES === 'object' && SEA_ZONE_COORDINATES) || {};
+    for (const [zn, c] of Object.entries(tbl)) {
+        if (!c || c.lat == null || c.lon == null) continue;
+        const dx = (lat - c.lat) * 111, dy = (lon - c.lon) * 88;
+        const d = Math.sqrt(dx*dx + dy*dy);
+        if (d < bestD) { bestD = d; best = zn; }
+    }
+    return (best && bestD <= 200) ? best : null;
+}
```

**위험 등급: 1** — 호출처 없음(현재). 모듈 스코프 read-only. lint·grep 만 통과.

### 6.2 HUNK #2 — `deriveFocus` 폴백 1~6 단 통합 (L1352–1357 *대체*)

위치: 기존 `if (!focus.zone && typeof query === 'string')` 블록을 6단 fall-through 로 확장.

```diff
@@ -1352,8 +1352,28 @@ function deriveFocus(plan, results, zoneName, query) {
-    // [결함 1 — focus 전파 강화] zone 이 비면 query 에서 fuzzy 보강(detectZoneDeterministic).
-    //   결함 분석에서 후속 턴이 focus 못 받아 엉뚱한 해역 추천한 케이스(angler Q5 등) 직타.
-    if (!focus.zone && typeof query === 'string') {
-        const z = detectZoneDeterministic(query);
-        if (z) focus.zone = z;
-    }
+    // [P_continuity_v2 — HUNK#2] focus.zone 폴백 사다리 6단.
+    //   우선순위: (1) plan.zone/zoneName (위에서 이미 적용)
+    //          → (2) top.zone(items)               (L1348 — 이미 적용)
+    //          → (3) detectZoneDeterministic(query) ← 기존 블록 보존
+    //          → (4) haeguToZone(focus.haegu)       ★ NEW (B §2.2)
+    //          → (5) buoyToZone(focus.buoy)         ★ NEW (A·B 공통)
+    //          → (6) rankedItems[0].zone/해역/지점  ★ NEW (B §2.2)
+    //   각 단은 위 단이 비어있을 때만 진행 → 신뢰도 높은 값 보존(덮지 않음).
+    if (!focus.zone && typeof query === 'string') {                       // 3
+        const z = detectZoneDeterministic(query);
+        if (z) focus.zone = z;
+    }
+    if (!focus.zone && focus.haegu) {                                     // 4
+        const z = haeguToZone(focus.haegu);
+        if (z) focus.zone = z;
+    }
+    if (!focus.zone && focus.buoy) {                                      // 5
+        const z = buoyToZone(focus.buoy);
+        if (z) focus.zone = z;
+    }
+    if (!focus.zone && focus.rankedItems && focus.rankedItems.length) {   // 6
+        const t = focus.rankedItems[0];
+        focus.zone = t.zone || t['해역'] || t['지점'] || null;
+    }
     return (focus.zone || focus.haegu || focus.buoy || focus.coords || focus.rankedItems) ? focus : null;
 }
```

**위험 등급: 2** — 폴백 추가만(덮어쓰기 0). 회귀 면 좁음. 호출처 3곳(L1625/L1677/L1713) 자동 수혜.

### 6.3 HUNK #3 — `PRONOUN_RE` 확장 (L1529 *대체*)

위치: 공유 상수 영역(L1515–1525) 직후의 PRONOUN_RE 라인.

```diff
@@ -1529,1 +1529,4 @@
-    const PRONOUN_RE = /거기|그곳|그쪽|그\s*해역|그\s*해구|그\s*부이|방금|아까|그건|그게|저거/;
+    // [P_continuity_v2 — HUNK#3] PRONOUN_RE v2 (A §2.4).
+    //   추가: 그 곳/그 위치/그 해변/그 해안/그 항(만/구)/그 섬/같은 곳·해역·위치/위에서/조금 전.
+    //   제외(보존): "그 때"(#27 시간 후속), "여기"(GPS 우선), "근처/주변/인근"(#31 multitool).
+    const PRONOUN_RE = /거기|그곳|그\s*곳|그쪽|그\s*해역|그\s*해구|그\s*부이|그\s*해변|그\s*해안|그\s*항(?:만|구)?|그\s*섬|그\s*위치|같은\s*(?:곳|해역|위치)|방금(?:\s*거|\s*전)?|아까(?:\s*거)?|그건|그게|저거|위에서|조금\s*전/;
```

**위험 등급: 2** — 매칭 면 확장. FP-1~FP-4 가드로 회귀 차단. 신규 매칭 토큰은 모두 zone 후속 의도 명확.

### 6.4 HUNK #4 — `isChainFollowup` + `isFollowup` + zone-arg 3단 폴백 (L1530 + L1555–1558)

위치: L1530 직후(chain 게이트 정의) + L1555–1558 사이(zone-arg 주입 확장) + L1572 직후(7단 profile default).

```diff
@@ -1530,1 +1530,5 @@
     const isPronounFollowup = PRONOUN_RE.test(cq);
+    // [P_continuity_v2 — HUNK#4 chain 게이트] focus 객체 비어있지 않음 = chain 후속.
+    //   대명사 없는 한 단어 후속("파고?", "수온?")까지 흡수 (B §3.2).
+    //   FP-5: 빈 객체 {} 가드 — hasAnyKey 4필드 모두 검사.
+    const isChainFollowup = !!(focus && (focus.zone || focus.haegu || focus.buoy || focus.coords));
+    const isFollowup = isPronounFollowup || isChainFollowup;
```

```diff
@@ -1552,6 +1557,12 @@
     for (const step of plan.steps || []) {
         if (!step || !step.args || typeof step.args !== 'object') continue;
         if (step.args.zone) step.args.zone = canonZone(step.args.zone);
-        if (!isPronounFollowup) continue;
+        if (!isFollowup) continue;                                       // ★ chain OR pronoun
         // 1) 도구별 zone-인자 주입
         const zoneArg = FOCUS_ZONE_ARG[step.tool];
-        if (focusZone && zoneArg && !step.args[zoneArg]) step.args[zoneArg] = focusZone;
+        // [HUNK#4 zone-arg 3단] (a) LLM 채운 값 canonZone → (b) focusZone → (c) detectZoneDeterministic(cq)
+        if (zoneArg) {
+            let z = step.args[zoneArg];
+            if (typeof z === 'string') z = canonZone(z);
+            if (!z && focusZone) z = focusZone;
+            if (!z) z = detectZoneDeterministic(cq);
+            if (z) step.args[zoneArg] = z;
+        }
```

L1572 직후 신규 7단 블록:

```diff
@@ -1572,0 +1580,10 @@
+    // [P_continuity_v2 — HUNK#4b 7단 profile default 폴백]
+    //   1~6 단은 deriveFocus 안에서 처리됨. chain 후속인데 zone 여전히 null 이면
+    //   profileDefaultZone 으로 최후 폴백(A §3.2 step 4). 결정론적·안전.
+    if (isFollowup && !focusZone) {
+        const _pzChain = profileDefaultZone(profile);
+        if (_pzChain) {
+            // step.args 에 zone-arg 가 정의된 도구만 보강 — 이미 위 루프에서 채워졌으면 skip
+            for (const step of plan.steps || []) {
+                const zA = FOCUS_ZONE_ARG[step && step.tool];
+                if (zA && step.args && !step.args[zA]) step.args[zA] = _pzChain;
+            }
+        }
+    }
```

**위험 등급: 3** — isChainFollowup 게이트로 *FOCUS_ZONE_ARG 발동 빈도가 늘어남*. 기존 도구가 zone 무관 인자 받을 때 오주입 위험. **FOCUS_ZONE_ARG 매핑 자체는 보존**(L1536–1550) 이라 차단. profile default 폴백은 cat5(비도메인) 첫 턴엔 focus null 이라 미발동.

### 6.5 HUNK #5 — chain zone-miss 거절 폴백 (L1673 직후 — `isDomainQuery && results.length===0` 블록 *다음*)

위치: 기존 환각 가드(L1665–1673) 직후. 도구는 1+개 실행됐지만 anchor 불일치인 케이스 직타.

```diff
@@ -1673,0 +1682,22 @@
+    // [P_continuity_v2 — HUNK#5] chain zone-miss 거절 폴백.
+    //   조건: isChainFollowup + focus.zone 여전히 null + 도구 1+개 실행됐지만 결과가
+    //         focus.buoy/focus.haegu 의 원래 대상과 *anchor 불일치*.
+    //   기존 환각 가드(L1665, results.length===0)와 직교. cat2 PASS 목표가 아니라
+    //   환각 차단(B §3.4) 이 1차 목표 — PO-2-05b/LG-2-01b 직타.
+    //   FP-7: 비도메인 케이스는 isDomainQuery=false → 본 블록 미발동 (cat5 PASS 유지).
+    if (isChainFollowup && !focusZone && isDomainQuery && results.length > 0) {
+        const anchorOk = results.some(r => {
+            const v = r && r.result;
+            if (!v || v.error) return false;
+            if (focus.buoy && v.name && String(v.name) === String(focus.buoy)) return true;
+            if (focus.haegu && v.zoneId && String(v.zoneId) === String(focus.haegu)) return true;
+            // zone 일치도 anchor 로 인정 (LLM 이 zone-arg 를 잘못 채운 경우)
+            if (focus.coords && v['위도'] != null && v['경도'] != null
+                && Math.abs(v['위도'] - focus.coords.lat) < 0.5
+                && Math.abs(v['경도'] - focus.coords.lon) < 0.5) return true;
+            return false;
+        });
+        if (!anchorOk) {
+            return {
+                answer: '직전 대상에 대한 정보를 다시 가져오지 못했어요. 해역명을 한 번 더 알려주시면 정확히 답해드릴게요.',
+                zone: focus.zone || null, toolsUsed: results.map(r => r.tool),
+                corrected, focus
+            };
+        }
+    }
```

**위험 등급: 4** — anchor 정합 검사가 *지나치게 엄격*하면 정상 응답을 거절 처리할 위험. 좌표 0.5° 허용은 약 ±50km — 광역 해역 대응. **수동 N=3 점검 필수**(sentinel + PO-2-05b + LG-2-01b).

---

## 7. 위험 등급 종합 + 머지 순서

| Hunk | 영역 | 위험 | 단독 회귀 게이트 |
|-----|-----|-----|----------------|
| **#1** | 헬퍼 3개 신규 | **1** | lint·grep, 호출처 없음 |
| **#2** | deriveFocus 6단 | **2** | sentinel ANG-2-01a/01b + PO-2-01a |
| **#3** | PRONOUN_RE v2 | **2** | FP-1~FP-4 회귀 셋 통과 |
| **#4** | isChainFollowup + zone-arg 3단 + 7단 | **3** | sentinel 9건 + FP-5/6 + cat1 ±2pp |
| **#5** | chain zone-miss 거절 폴백 | **4** | sentinel 9건 + FP-7 (cat5) + 수동 N=3 |

### 7.1 머지 순서 권고

```
HUNK#1(헬퍼) → HUNK#2(deriveFocus) → HUNK#3(PRONOUN) → HUNK#4(chain 게이트) → HUNK#5(거절 폴백)
```

- **HUNK#4 ↔ HUNK#5 동시 머지 강제** — `isChainFollowup` 가 HUNK#5 의 게이트 조건. 분리 머지 시 거절 폴백이 *대명사 후속에만* 발동하여 cat5 비도메인 케이스 회귀 위험.
- 단계별 회귀 게이트(§5.3) PASS 후 다음 hunk 진행.
- 5 hunks 모두 단일 PR (squash 아닌 5 커밋 그대로) — α R2 의 git log 추적성 + 격리 revert 가능성 확보.

### 7.2 격리 revert 가능성

| Hunk | 단독 revert 가능? | 회귀 범위 |
|-----|------------------|---------|
| #1 | YES (호출처 미존재 시) | 0 |
| #2 | YES (단, #4·#5 가 호출하면 동시 revert 필요) | sentinel ANG-2-04b·FIS-2-03b 회귀 |
| #3 | YES | "그 곳/같은 해역" 매칭 케이스만 회귀 |
| #4 | NO (`isFollowup` 식별자가 #5 의존) | #5 도 revert 필요 |
| #5 | YES | PO-2-05b/LG-2-01b 환각 의심 재발 |

---

## 8. 검증 시나리오

### 8.1 sentinel 직타 9건 (§5.1) — 5/5 hunk 적용 후 모두 PASS

| ID | 통과 라인 | 책임 hunk |
|----|---------|----------|
| ANG-2-01b | answer ⊇ "거문도" + halluc=false | #1·#2·#4 |
| CG-2-01b | answer ⊇ "동해중부" | #4 |
| PO-2-01b | answer ⊇ "동해광역" | #2(detect)·#4 |
| NAV-2-01b | tools ⊇ {get_depth} + args.zone="동해중부" | #4 |
| ANG-2-04b | tools ⊇ {list_buoys_near} + zone="홍도" | #1·#2 |
| ANG-2-05b | "그 위도" PRONOUN 매칭 | #3 |
| FIS-2-03b | get_marine_forecast(zone="제주도북부앞바다") | #4 |
| LG-2-01b | profile default 적용 또는 거절 | #4b·#5 |
| PO-2-05b | 거절 응답 ("정보를 다시 가져오지…") | #5 |

### 8.2 거짓양성 가드 7건 (§5.2) — 모두 비발동/정상

- FP-1~FP-4 (PRONOUN 미매칭) — HUNK#3 의 제외 토큰 검증
- FP-5 (빈 focus 객체) — HUNK#4 의 `hasAnyKey` 검증
- FP-6 ("방금 거" 일반회화) — synth 응답 자연어 점검
- FP-7 (cat5 비도메인 + focus 잔향) — HUNK#5 의 `isDomainQuery` AND 검증

### 8.3 v5 cat2 회귀 게이트

- cat2 PASS ≥ 60% (38/80 → ≥48/80)
- 직군별 floor ≥ 4/10
- 환각 의심 ≤ 4
- cat1/cat3/cat5 ±2pp

### 8.4 측정 명령 (참고)

```
# sentinel 9건
node local_server/knowledge/phases/phase2b_sentinel_runner.js --ids=ANG-2-01b,CG-2-01b,PO-2-01b,NAV-2-01b,ANG-2-04b,ANG-2-05b,FIS-2-03b,LG-2-01b,PO-2-05b

# v5 freevar 440건
python local_server/knowledge/phases/phase2b_eval_freevar_runner.py --N=440 --report=v5_run2_report.md
```

---

## 9. 잔존 위험 / 보류 사항

1. **`SEA_ZONE_COORDINATES` 미로드 시** — HUNK#1 의 `nearestZoneByCoords` 가 항상 null 반환. **안전(폴백)**, 단 buoyToZone 효과 0. → 기동 로그에서 좌표 사전 적재 카운트 확인 권고.
2. **거절 폴백 messaging** — HUNK#5 의 "정보를 다시 가져오지 못했어요" 문구가 사용자 경험에 부정적일 수 있음. cat2 PASS 미달 케이스는 *환각보다 거절이 낫다*는 정책 명시 — 마스터플랜 §9 와 정합.
3. **선행 #32 (HALLUC_RE 정밀화) 의존 명시** — A §5.5 권고 (P0 위반 해소 우선). 본 패치 머지 전 #32 완료가 *권고*. 환각 의심 ≤ 4 게이트가 #32 효과에 의존.
4. **모호어/광역 zone (LG 의 "관내", PO 의 "광역")** — 본 패치는 *환각 차단*만 달성. expect_zone_match 직접 PASS 는 P_continuity_v3 의 VAGUE_TO_ZONE 사전 확장 필요 (B §8).

---

## 10. 핵심 합성 결정 (한 줄)

**A 의 PRONOUN_RE 확장(매칭 면)과 B 의 isChainFollowup(매칭 우회) 을 `isFollowup = pronoun ∥ chain` 으로 OR 결합하고, 5단·6단 폴백을 단일 7단계(plan.zone → top.zone → detectZone → haeguToZone → buoyToZone → rankedItems → profileDefaultZone → 거절)로 통합해 deriveFocus(1~6) + runBrain(7+거절) 분리 배치, 5 hunks (#1 헬퍼 3·#2 deriveFocus 6단·#3 PRONOUN_RE v2·#4 chain 게이트+zone-arg 3단+7단 profile·#5 chain zone-miss 거절 폴백) 로 적용하되 #4·#5 는 동시 머지 강제, 총 위험 1·2·2·3·4 등급에서 #5 가 최고 위험으로 anchor 정합 수동 N=3 점검을 머지 전 필수 게이트로 격상.**
