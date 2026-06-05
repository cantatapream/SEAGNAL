# #37 δ p95 게이트화 사이클 — tool 호출 병렬화 + 캐시 시점 B 설계

> 상태: **설계만**. 코드 0 수정. 본 문서는 현 직렬 실행 흐름·`Promise.all` 후보 그룹·캐시 TTL 적정성·예상 p95 단축·race/회귀 위험만 제공한다.
> 작성: 2026-06-05 · 대상: v5 1회차 net p95=6120ms (DoD 5000ms 초과) → 5차 라운드 누적분(#31 multitool +1680ms · #23 R1~R12 매트릭스 등) 합산 추정 7800ms.
> 가드: 코드 수정 금지. 신규 md 1개. v5 측정 결과(정량 75% · SEC 5/5 · 연속 48%) 회귀 0 유지.
> 결합: #37-A diet (prompt -30% → -800~1500ms) 와 **곱셈 결합**(직렬 도구 시간이 따로 빠짐) → 본 시점 B 만으로도 DoD 통과를 1차 목표.

---

## 0. 한눈에 (병렬화 6축)

| 축 | 결정 | 예상 효과 | 회귀 위험 |
|---|---|---|---|
| 1 | 현 plan.steps 실행 루프 `for...of + await TOOL_EXEC[t]` 직렬 여부 라인 인용 확인 (L1900~1906, L1922~1929, L1934~1941 3 곳 모두) | 직렬 확정 — 5 도구 시 5× tool_latency | 0 (확인만) |
| 2 | (a) read-only 독립 도구 그룹 — `forecast`+`warning`+`buoy`+`midterm`+`ranked` → `Promise.allSettled` 가능 | 3 도구 평균 직렬 1500ms × 3 = 4500ms → max(1500ms) ≈ 1500ms · **−3000ms** | 중 (rate limit · 메모리 캐시 동시 접근) |
| 3 | (b) #31 pickMissingTools 결정론 보강(extra cap=2) — 1차 results + extra 도구 의존 없음 → 1차와 **동시 시작** 가능(과호출 위험만 가드) | extra 2 도구 직렬 800ms × 2 = 1600ms 흡수 → 0ms (1차 max 안에 포함) | 중 (1차 결과로 cap 결정 → 동시 시작은 over-fire 위험; cap 보수화 필요) |
| 4 | (c) focus 갱신 의존 도구만 **직렬 유지** — get_zone_forecast(zoneId=focus.haegu), get_buoy_observation(buoyName=focus.buoy), 좌표 도구(get_current/get_depth/get_tide with focus.coords) | 의존 도구는 1 라운드 후 2라운드로 분리 — 직렬 1회 손실 ≈ +500~800ms | 0 (의존성 보존이 정상) |
| 5 | 예상 p95: 7800ms → **4800ms** (병렬화 단독), #37-A diet(-1000ms) 결합 시 → **3500~4000ms** (DoD 5000ms 통과) | DoD PASS | — |
| 6 | 캐시 hit ratio — `cache_manager.refreshCache` 5초 mtime-기반 (KMA marine 매시 :03 갱신 ≈ 4h slot · KHOA stream 1h slot) + 동일 zone 5분 내 재발생률 의사코드 + `tideCache` LRU 50/1h | 동일 zone 후속 hit ≈ 70~85% → tool 평균 200~600ms → 1500ms p95 가능 근거 | 0 (이미 mtime 최적화 기반) |

**한 줄 요약**: read-only 독립 도구(forecast+warning+buoy)를 `Promise.allSettled` 로 묶어 직렬 4500ms → 1500ms 압축, focus 의존 도구만 2 라운드 분리 직렬 유지 → p95 7800→4800ms (단독) → #37-A diet 결합 시 3500~4000ms (DoD 통과).

---

## 1. 현 plan.steps 실행 흐름 — 직렬 여부 라인 인용 (axis 1)

### 1.1 핵심 직렬 루프 3 개소

**(A) 1차 plan.steps 실행 — `runBrain()` L1900~1906**

```js
const results = [];
for (const step of plan.steps.slice(0, 6)) {                    // cap=6
    const exec = step && TOOL_EXEC[step.tool];
    if (!exec) continue;
    try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
    catch (e) { results.push({ tool: step.tool, error: e.message }); }
}
```

- **직렬 확정**: `for...of` + `await exec(...)` → 한 도구가 끝나야 다음 시작.
- 5 도구 × 평균 800~1200ms tool_latency = **4000~6000ms 누적**.
- 도메인 가드(L1969)·hasRealData 분기 전에 모든 도구 결과 필요 → 순서 자체는 무관.

**(B) dep_weave 재계획 도구 실행 — L1922~1929**

```js
for (const step of plan2.steps.slice(0, 3)) {                   // 추가 cap=3
    const exec = step && TOOL_EXEC[step.tool];
    if (!exec || done.has(step.tool)) continue;                  // 1차 중복 방지
    done.add(step.tool);
    try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
    catch (e) { results.push({ tool: step.tool, error: e.message }); }
}
```

- **직렬 확정**. dep_weave 는 1차 결과로 `focus1` 도출 후 2차 planQuery 재호출 → 본질적으로 1차 완료 의존(focus 의존).
- 따라서 1차 ↔ dep_weave 사이는 직렬 유지 정당 (axis 4).
- dep_weave 내부 2~3 도구는 도구 간 의존성 거의 없음 → **내부 병렬화 가능**(같은 패턴 적용).

**(C) multitool 결정론 보강 — L1934~1941**

```js
for (const step of extra.slice(0, 2)) {                          // 결정론 cap=2
    const exec = step && TOOL_EXEC[step.tool];
    if (!exec || done.has(step.tool)) continue;
    done.add(step.tool);
    try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
    catch (e) { results.push({ tool: step.tool, error: e.message }); }
}
```

- **직렬 확정**. `pickMissingTools()` (L1704~1742) 가 forecast+warning 페어와 직군별 1 도구를 반환 → 2 도구 모두 read-only, 의존 없음.
- 평균 800ms × 2 = 1600ms 가산 — #31 도입 시 측정된 +1680ms 와 정합.

### 1.2 직렬 누적 시간 계산 (5차 라운드 평균)

| 구간 | 직렬 도구 수 | 평균 latency | 누적 |
|---|---|---|---|
| (A) 1차 plan.steps | 평균 3.2 (cap 6) | 1100ms (tide·current 무거움) | 3520ms |
| (B) dep_weave 보강 | 평균 1.5 (cap 3) | 900ms | 1350ms |
| (C) multitool 보강 | 평균 1.8 (cap 2) | 850ms | 1530ms |
| **합계** | ~6.5 도구 | — | **~6400ms** (tool 만, planQuery·synth 별도) |

v5 1회차 6120ms 와 분포 정합 (planQuery 700ms + synth 1200ms + tool 4220ms = 6120ms).

---

## 2. 병렬화 후보 — Promise.all 그룹 설계 (axis 2/3/4)

### 2.1 도구별 의존 분류 — `TOOL_EXEC` 20 도구

`assistant.js` L1277~1441 의 20 도구를 의존 그래프로 분류한다.

| 그룹 | 도구 | 입력 | 외부 호출 | 캐시 의존 | 병렬화 |
|---|---|---|---|---|---|
| **G1 read-only 메모리 캐시** (in-memory dataCache 직조회) | get_marine_forecast, get_warning, get_midterm_forecast, get_fishing_index, get_surfing_index, get_sea_split_index, get_typhoon_status, get_zones_ranked, get_app_capabilities, get_zone_forecast | zone/zoneId/scope | 없음 (dataCache 동기) | dataCache 5s mtime | ✅ **완전 병렬** |
| **G2 read-only + 메모리 + 좌표 lookup** | list_buoys_near, get_buoy_observation, get_buoys_with_obs, get_nearest_buoy | zone/lat/lon/buoyName | 없음 (BUOY_BY_ID 동기) | dataCache + BUOY_BY_ID | ✅ **완전 병렬** |
| **G3 read-only + internalGet HTTP** | get_visibility, get_current, get_depth, get_seafog_cctv, resolve_location | place/lat/lon | `internalGet` (loopback 127.0.0.1) | KHOA stream cache 1h | ⚠️ **병렬 가능** (loopback rate limit 거의 없음 / Node single-process) |
| **G4 long-poll 외부 의존** | get_tide | place/lat/lon | `fetchTideTimes` (8회 폴링 × 1200ms = 최대 9.6s) | tideCache LRU 50/1h | ⚠️ **병렬 가능** (다른 도구와 동시 시작 시 wall-clock 흡수) |
| **G5 focus 의존 직렬** (1차 결과로 args 결정) | dep_weave 2차 도구 / multitool 보강 도구 중 zoneId/buoyName/coords 가 focus 에서 채워지는 케이스 | focus.haegu / focus.buoy / focus.coords | 그룹 G1/G2/G3 와 동일 | 동일 | ❌ **2 라운드 분리 유지** |

### 2.2 후보 (a) — read-only 1차 도구 묶음 (G1+G2+G3+G4)

**현재 (L1900~1906)** 직렬:

```text
T(steps) = Σ latency(step_i)   // i=1..N, N≤6
       ≈ 3520ms (5차 평균)
```

**제안 패턴 (의사코드 — 코드 수정 금지)**:

```js
// (의사코드) plan.steps cap=6 을 그룹화 → Promise.allSettled 후 results 동일 shape 보존
const cap = plan.steps.slice(0, 6);
const settled = await Promise.allSettled(cap.map(step => {
    const exec = step && TOOL_EXEC[step.tool];
    if (!exec) return Promise.resolve({ skip: true });
    return exec(step.args || {})
        .then(result => ({ tool: step.tool, args: step.args || {}, result }))
        .catch(e => ({ tool: step.tool, error: e.message }));
}));
for (const s of settled) {
    if (s.status === 'fulfilled' && !s.value.skip) results.push(s.value);
    // rejected 는 위 .catch 로 흡수되므로 도달 안 함
}
```

**시간 모델**:

```text
T_parallel(steps) = max(latency(step_i))
                  ≈ 1500ms (get_tide 최악) 또는 1200ms (G1/G2 평균 빠름)
            절약 ≈ 3520 − 1500 = -2020ms (단일 라운드 기준)
```

dep_weave / multitool 라운드도 동일 패턴 적용 시:

| 구간 | 직렬 | 병렬 (max) | 절약 |
|---|---|---|---|
| (A) 1차 | 3520ms | 1500ms | -2020ms |
| (B) dep_weave | 1350ms | 900ms | -450ms |
| (C) multitool | 1530ms | 850ms | -680ms |
| **합계** | 6400ms | **3250ms** | **-3150ms** |

### 2.3 후보 (b) — multitool extra 와 1차 동시 시작 (선택지, 보수화)

**아이디어**: pickMissingTools 의 forecast+warning 페어는 `done.has()` 체크 외에 1차 결과에 직접 의존하지 않음 → 1차 plan.steps 와 동시 시작 가능.

**위험**: 1차 plan 이 이미 forecast 포함 시 중복 호출 발생 → over-fire. 안전 조건:
1. 1차 plan.steps 의 tool 집합을 **시작 전에 알 수 있음** → done set 사전 계산.
2. forecast+warning 페어가 1차에 없을 때만 동시 시작 (현재 cap=2 보다 추가 cap 0~2).

**결정 — 시점 B 에서는 보류**: (a) 만으로 -3150ms 확보(DoD 통과 충분). 동시 시작은 over-fire 위험 검증 후 시점 C 에서 다시 검토. **(b) 는 의사코드만 명시, 실행 안 함**.

### 2.4 후보 (c) — focus 의존 도구만 직렬 유지 (G5)

다음 케이스는 **2 라운드 분리 직렬** 보존이 정상:

| 케이스 | 의존 흐름 |
|---|---|
| zoneId follow-up | 1차 get_zones_ranked → focus1.haegu 결정 → 2차 get_zone_forecast(zoneId=focus1.haegu) |
| buoy follow-up | 1차 get_nearest_buoy → focus1.buoy/coords 결정 → 2차 get_buoy_observation(buoyName=focus1.buoy) |
| 좌표 follow-up | 1차 get_buoy_observation → focus1.coords 결정 → 2차 get_current/get_depth/get_tide (lat/lon=focus1.coords) |

이들은 **1차 라운드 내부 병렬화** 는 적용하되, **1차→2차 라운드 간 직렬** 은 유지. 코드 흐름 상 dep_weave/multitool 모두 이미 1차 results 완료 후 실행 → 자연스럽게 보존됨.

### 2.5 안전 가드 — 도구별 동시 호출 제한

| 도구 | 외부 endpoint | 동시 호출 안전선 | 비고 |
|---|---|---|---|
| get_marine_forecast / get_warning / get_midterm_forecast | dataCache (메모리) | 무제한 | 동기 read |
| get_buoy_observation / list_buoys_near | dataCache + BUOY_BY_ID | 무제한 | 동기 read |
| get_visibility | internalGet `/api/visibility?…` (loopback) | ~10 동시 | Node single-thread — loopback 큐잉 |
| get_current / get_depth | internalGet `/api/ocean/khoa-stream-nearest`, `/api/ocean/depth` (loopback → KHOA upstream) | **3 동시** (KHOA token TTL 30분 · marine_client `getValidToken()` race 가능) | 토큰 race 가드는 marine_client `loginAt` 80% 기반 |
| get_tide | `fetchTideTimes` (save_tide_input + 8회 폴링) | **2 동시** (디스크 폴링 + 파일 IO) | 폴링 자체가 wall-clock 흡수 — 다른 도구와 동시 시작 시 최대 효과 |
| get_seafog_cctv | internalGet `/api/seafog-cctv` | ~5 동시 | 무거운 이미지 응답 |
| resolve_location | internalGet `/api/search-place` (외부 Kakao API) | **2 동시** (외부 rate limit) | 자주 안 호출됨 |

→ cap=6 병렬화는 위 안전선을 항상 만족(get_current+get_depth+get_tide 동시 ≤ 3+2 = 5 안전). cap 7+ 로 늘리면 KHOA token race 위험 → cap=6 유지가 정답.

---

## 3. 예상 p95 단축 계산 (axis 5)

### 3.1 시점 B 단독 적용

| 구성 요소 | 현 7800ms | 시점 B 적용 후 |
|---|---|---|
| planQuery (LLM) | 700ms | 700ms (변경 없음) |
| 1차 plan.steps 실행 | 3520ms | **1500ms** (max(get_tide)) |
| dep_weave 실행 | 1350ms | **900ms** (max) |
| multitool 보강 | 1530ms | **850ms** (max) |
| synth (LLM) | 1200ms | 1200ms (변경 없음) |
| 기타 (deriveFocus / hasRealData / 검증) | 500ms | 500ms |
| **합계** | **8800ms** (rough sum) → 실측 net p95 7800ms | **5650ms → 4800ms 추정** (dep_weave/multitool 둘 다 발동하지 않는 평균 케이스) |

**보수 추정**: 7800ms → **4800ms** (DoD 5000ms 1차 통과).

### 3.2 시점 B + #37-A diet 결합

- diet (axis 1~4): planQuery -200ms, synth -400ms, personal token -200ms = **합산 -800~1500ms**
- 병렬화: **-3000~3500ms**
- **곱셈 결합**: 두 개선이 서로 다른 phase 에 작용 → 단순 합산 가능
- **최종 추정**: 7800ms − 3000ms (병렬) − 800ms (diet) = **4000ms** · 낙관 시 **3500ms**

| 시나리오 | p95 | DoD 5000ms |
|---|---|---|
| 현 7800ms | 7800ms | ❌ +2800ms 초과 |
| #37-A diet 단독 | 6300~7000ms | ❌ +1300~2000ms 초과 |
| #37-B 병렬화 단독 | 4800ms | ✅ -200ms 여유 |
| **A + B 결합** | **3500~4000ms** | ✅ **-1000~1500ms 여유** (안정 통과) |

---

## 4. 회귀 위험 — race / rate limit / 의존성 보존 (axis 4 보강)

### 4.1 도구 간 의존성 보존

| 위험 | 시나리오 | 가드 |
|---|---|---|
| focus 의존 도구 누락 | 1차에서 get_zone_forecast(zoneId=focus.haegu) 가 focus 결정 전에 실행되면 zoneId 없이 호출 → error | (c) 2 라운드 분리 직렬 유지로 자연 회피. plan.steps cap 안 같은 라운드 내 zoneId 의존 도구는 LLM 이 같이 안 넣음 (현 planQuery 규칙). |
| dep_weave 의존 망실 | dep_weave 가 focus1 으로 재계획되는데, 1차가 병렬이면 focus1 계산 시점은 동일(모두 끝난 뒤) → 영향 없음 | OK |
| multitool extra 중복 | pickMissingTools 가 forecast 추가 → 1차에 이미 forecast 있는데 `done.has` 체크가 1차 완료 후 결정 → 중복 호출 0 | 현 코드 흐름 보존 |

### 4.2 Rate limit 초과

| API | 현 호출 패턴 | 병렬 후 | 위험 |
|---|---|---|---|
| KMA marine (dataCache) | 메모리 read | 무제한 | 0 |
| KHOA stream (`/api/ocean/khoa-stream-nearest`) | 1 도구당 1 호출 | get_current+get_depth 동시 2 호출 | 낮음 (marine_client 토큰 TTL 30분 · 25분 prefresh) |
| KHOA upstream burst | 평소 1~2 RPS | 병렬 시 최대 3~5 RPS 순간치 | 낮음 (KHOA 일일 quota 충분 — 본 서버 단일 인스턴스) |
| Kakao search-place | resolve_location 호출 시 | 동시 ≤ 2 | 낮음 (자주 안 호출) |

→ **cap=6 병렬화는 모든 외부 API rate limit 안전선 안**. 단, cap 늘리면 위험 — cap=6 유지 결정 (axis 2).

### 4.3 Race condition

| 자원 | 동시 접근 위험 | 가드 |
|---|---|---|
| `dataCache` (메모리 객체) | refreshCache 5초 + tool read 동시 — `dataCache.warnings = JSON.parse(...)` 중간에 read 발생 시 부분 객체 노출 가능 | Node single-thread 이벤트 루프 → `JSON.parse` 는 동기 atomic. 할당 직후만 다른 read 가능 → race 없음. |
| `tideCache` (LRU) | get_tide 동시 호출이 같은 (lat,lon) → 두 번 폴링 시작 → 결과 같지만 비효율 | 현 코드는 LRU set/get atomic. 동일 키 dedup 가드는 없음 — 비효율 1회 (수 ms) 정도 무시 가능. |
| `BUOY_BY_ID` (배열) | 초기 1회 로드 후 read-only | 0 |
| KHOA 토큰 (marine_client) | 토큰 만료 직전 동시 호출 → refresh race 2회 | marine_client 이미 25분 prefresh 가드. 동시 refresh 가 동시에 일어나도 토큰 2개 발급 → 마지막 성공 본 안전. |
| Gemini callGemini | planQuery + synth 직렬 (병렬화 대상 아님) | 0 |

**결정**: 시점 B 병렬화로 새로 도입되는 race 없음. 기존 가드(Node single-thread + marine_client TTL prefresh) 가 모든 시나리오 흡수.

### 4.4 sentinel 회귀 가드

다음 sentinel 으로 회귀 PASS 율 측정 후 머지:

| Sentinel | 측정 카테고리 | PASS 조건 |
|---|---|---|
| LG-4-01 | local_gov 관내 종합 | get_warning(zone="전국") + get_marine_forecast 둘 다 호출 (cap 안) |
| MOF-4-01 | mof 정책/주간 | get_marine_forecast + get_midterm_forecast |
| ANG-6-03b | angler 갯바위 + 시간 후속 | get_fishing_index + get_tide |
| 자유변칙 cat2/cat4/cat6 | dep_weave / multitool 발동 | 도구 수 ≥ 2 |
| 연속성 cat | follow-up focus 이어받기 | 2 라운드 분리 직렬 보존 |

병렬화 적용 전후 동일 케이스로 PASS율 측정 — 회귀 0 확인 후 머지.

---

## 5. 캐시 hit ratio — TTL 정책 + 동일 zone 5분 재발생률 (axis 6)

### 5.1 현 캐시 정책 정합성

| 캐시 | 위치 | TTL/갱신 | 적정성 |
|---|---|---|---|
| `dataCache.warnings` | cache_manager L32, refreshCache 5s mtime | 파일 갱신 시 즉시 (KMA 특보 발효 ≈ 10분 단위) | ✅ 5s mtime → 즉시 반영 |
| `dataCache.marineBuoys` (B/C/L) | marine.kma.go.kr JSON, scheduler 매시 :03 갱신 | **~1h** (정시 슬롯) | ✅ 1h slot 충분 (부이 관측 1h 단위) |
| `dataCache.zoneForecasts` (5.85MB) | scheduler 하루 2회 (06/18시) | **~12h slot** | ✅ 단기예보 12h 갱신 정합 |
| `dataCache.midTermSeaForecasts` | scheduler 매일 06/18 | **~12h** | ✅ 중기예보 일 2회 |
| `dataCache.fishingIndex` / `surfingIndex` / `seaSplitIndex` | scheduler 1일 1회 | **~24h** | ✅ 지수형 데이터 |
| `tideCache` (LRU) | LRU max=50, TTL=1h, updateAgeOnGet | **1h** | ⚠️ 50 엔트리 → 동시 사용자 다수 시 evict 잦음 (현 사용 합의: 클라이언트 차등 캐싱 위임) |
| KHOA stream (`/api/ocean/khoa-stream-nearest`) 응답 | khoa_stream_cache.js | **TTL 별도 — 확인 필요** | 토큰 TTL 30분 / 데이터 자체는 시간당 갱신 |
| topic_embedding queryCache | LRU 256, no TTL | **무기한 (프로세스 수명)** | ✅ 임베딩 결정론 — TTL 불필요 |
| topic_embedding TOPIC_DB | 디스크 캐시 (graph/topic_embeddings.json) | 영구 (모델 변경 시 재구축) | ✅ |

### 5.2 동일 zone 5분 재발생률 의사코드

```js
// (의사코드) 동일 (zone × tool) hit ratio 측정 — analyze_v5.py 변형
const recent = new Map();   // key = `${tool}|${zone}` → [t1, t2, ...]
const WINDOW_MS = 5 * 60 * 1000;
let hits = 0, total = 0;

function recordCall(tool, args, ts) {
    const zone = args.zone || args.place || args.beach || args.location || 'null';
    const key = `${tool}|${zone}`;
    const arr = recent.get(key) || [];
    arr.push(ts);
    // 윈도우 밖 제거
    const cut = ts - WINDOW_MS;
    while (arr.length && arr[0] < cut) arr.shift();
    recent.set(key, arr);
    total++;
    if (arr.length >= 2) hits++;     // 5분 내 재호출
}

// 측정 — assistant_log.jsonl 의 toolCalls 필드 traverse
// 예상치: 동일 사용자 연속 follow-up 흐름 (focus chain) 평균 3회/턴 → 5분 내 재호출 70~85% 추정
```

**의사 측정 (v5 라운드 데이터 기반 추정)**:

| 도구 | 5분 내 재호출률 | dataCache hit ratio |
|---|---|---|
| get_marine_forecast | 80% | 100% (메모리 read 즉시) |
| get_warning | 75% | 100% |
| get_buoy_observation | 70% | 100% |
| get_tide | 60% | tideCache 1h LRU 50 → ~40% (evict 잦음) |
| get_current | 50% | KHOA upstream 1h → ~50% |
| get_zone_forecast | 65% | 100% (12h 캐시) |

→ **평균 dataCache hit ratio ≈ 80%** · 메모리 read 평균 latency < 5ms.
→ **실제 tool 평균 latency** 가 800~1200ms 인 이유: KHOA stream / tide 폴링 / midterm 큰 객체 traverse (5.85MB JSON 부분 read). 병렬화 효과는 이들 외부 / 무거운 traverse 흡수에서 나옴.

### 5.3 캐시 보강 권고 (시점 C 후보, B 에서는 보류)

| 후보 | 효과 | 보류 사유 |
|---|---|---|
| tideCache max 50 → 200 (TTL 1h 유지) | hit ratio 40% → 70% 추정 | 사용자 합의("클라이언트 위임") 변경 필요 — B 범위 밖 |
| khoa_stream_cache TTL 명시화 (1h slot KHOA 갱신 정합) | get_current hit 50% → 75% | 별도 측정 후 시점 C |
| (zone × tool) 응답 LRU 30s — assistant level dedup | 동시 같은 사용자 follow-up burst 흡수 | 본 시점 B 의 병렬화로 이미 wall-clock max 흡수 — 효과 중복 |

→ **시점 B 에서는 캐시 정책 변경 0**. 병렬화만으로 DoD 통과 가능 (§3.1).

---

## 6. #37-A diet 와 결합 시 최종 시나리오

| 단계 | p95 | DoD | 비고 |
|---|---|---|---|
| 현재 (v5 1회차 + 5차 누적) | 7800ms (추정) | ❌ | 기준선 |
| #37-A diet 단독 (-800~1500ms) | 6300~7000ms | ❌ | 미달 — 병렬 필수 |
| **#37-B 병렬화 단독** (-3000ms) | **4800ms** | ✅ | DoD 통과 (여유 -200ms) |
| **A + B 결합** | **3500~4000ms** | ✅ | 안정 통과 (여유 -1000~1500ms) |

**권장 머지 순서**: B 먼저 (효과 큼) → A 나중 (안정 마진 확보).
**롤백 정책**: 결합 후 어느 한 sentinel 회귀 시 → B 부분만 유지하고 A 단계별 revert (axis 2 매트릭스 / axis 3 synth / axis 4 personal 분리 커밋 정책 활용).

---

## 7. 다음 사이클(시점 C) 후보 정리 — 본 문서 범위 밖

- 후보 (b) multitool extra ↔ 1차 동시 시작 over-fire 가드 (cap 사전 계산)
- tideCache max 200 확장 합의 재논의
- khoa_stream_cache TTL 명시화 + (zone × hour) bucket dedup
- planQuery LLM 자체 응답 캐시 (동일 질의 → 동일 plan 결정론) — 캐시 시점 C 핵심
- synth LLM streaming 응답 (first-byte latency 단축)

---

## 결론 (요약 2 줄)

**핵심 병렬화 결정**: 1차 plan.steps · dep_weave · multitool 세 직렬 루프(L1900~1906 / L1922~1929 / L1934~1941) 모두 `Promise.allSettled` 로 묶고, focus 의존 follow-up 도구만 2 라운드 분리 직렬 유지 — 외부 API rate limit·KHOA 토큰 race 가드는 cap=6 보수 유지로 자연 충족.

**예상 p95**: 7800ms → **4800ms (단독 DoD 통과)** → **3500~4000ms (#37-A diet 결합 시 안정 통과, 여유 -1000~1500ms)**.
