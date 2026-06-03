# routes/assistant.js 모듈 분리 리팩터링 설계안

> 상태: **설계만**. 실제 분리/수정은 별도 PR. `routes/assistant.js`(현 2183줄)는 본 문서 작성 시점에 **읽기만** 함.
> 목표: 단일 거대 파일을 책임별 모듈로 나누되 **동작 100% 동일**(게이트 무회귀), 점진적 PR.

---

## 0. 현황 요약 (코드 경계)

| 구분 | 위치(줄) | 내용 |
|---|---|---|
| 부트스트랩 | 35~46 | express/fs/path, `dataCache`, `DATA_DIR`/`SERVER_PORT`(config) |
| 내부 API | 49~88 | `internalGet`/`internalPost`/`_sleep`/`fetchTideTimes` |
| 정적 로더(파싱) | 95~157 | `BUOY_BY_ID` `TIDE_STATIONS` `ZONE_COORDS` `HAEGU_COORDS` (require 불가한 브라우저 스크립트/JSON 파싱) |
| 카탈로그 | 161~173 | `CATALOG_DIGEST` (data_catalog.json) |
| 직군 KB | 181~291 | `JIKGUN_META` `JIKGUN_KB` `JIKGUN_THRESHOLDS` + `thresholdDigest`/`detectJikgun`/`jikgunDigest` |
| 지식그래프 | 300~318 | `GRAPH_RT`(전역 mutable) 로딩 |
| 임베딩 | 321~353 | `TOPIC_EMBED`(서비스 핸들) + `scheduleToolEmbedWarmup` |
| 외부 서비스 핸들 | 357~364 | `gemini` `assistantLog` |
| 참조표(상수) | 373~433 | `ZONE_NAME_TO_CODE` `ZONE_NAMES` `WIND_DIR_KO` `NUM_EF_LABEL` |
| 해역/의도 유틸 | 440~813 | `normalize` `detectZoneDeterministic` `detectIntentDeterministic` `buildForecastSummary` `findWarning` `composeAnswerFallback` `composeAnswerAI` `buildPersonalContext` `profileDefaultZone` `detectWithAI` |
| 레이트리밋 | 814~851 | `RATE_LIMIT_*` `_rateBuckets` `getClientIp` `checkRateLimit` `_rateCleanup` |
| health 라우트 | 853~869 | `GET /health` |
| 도구 인프라 | 871~1266 | `BRAIN_MODEL` `TOOL_CATALOG` `APP_CAPABILITIES` `resolveZoneName` `coordsFor` `getZoneForecastAt` `getBuoyObs` `getVisibility` `rankZones` `getTyphoonStatus` `TOOL_EXEC` |
| 플래너/두뇌 | 1271~1602 | `deriveFocus` `planQuery` `webSearchAnswer` `needsReplan` `runBrain`(+synth 프롬프트·cleanAnswer) |
| ask 라우트 | 1604~1776 | `POST /ask` |
| 링크/조석 헬퍼 | 1782~1935 | `extractTidePlace` `haversineKm` `findBuoysNearZone` `findNearestBuoys` `composeBuoyListAnswer` `findBuoyInQuery` `resolveTidePoint` `buildLinks` |
| 온보딩 | 1937~2040 | `ONBOARD_SCRIPT` `ONBOARD_FIELDS` `onboardScripted` `onboardWithAI` + `POST /onboard` |
| 음성 | 2042~2181 | `pcmToWav` + `POST /tts` `/transcribe` `/style-digest` |
| export | 2183 | `module.exports = router` |

**핵심 관찰**
- 전역 mutable 상태: `GRAPH_RT`, `TOPIC_EMBED`, `_rateBuckets`, 로더 산출 상수(`BUOY_BY_ID` 등). → 분리 시 **단일 인스턴스 공유**가 관건.
- 모든 도메인 데이터 출처는 `dataCache`(require 안전, 싱글턴) + 내부 HTTP(`internalGet`).
- `gemini`/`assistantLog`/`TOPIC_EMBED`는 이미 외부 서비스 require(로드 실패 시 null 폴백) → 모듈 간 공유 자연스러움.

---

## 1. 목표 모듈 트리 (`routes/assistant/`)

```
routes/
  assistant.js                 # 얇은 진입점: 서브모듈 require + router 조립 + module.exports
  assistant/
    runtime.js                 # 공유 런타임 컨텍스트(싱글턴): config·dataCache·gemini·assistantLog·GRAPH_RT 핸들
    catalog_loader.js          # CATALOG_DIGEST, APP_CAPABILITIES, BRAIN_MODEL, TOOL_CATALOG(문자열)
    geodata.js                 # 정적 로더: BUOY_BY_ID·TIDE_STATIONS·ZONE_COORDS·HAEGU_COORDS + 참조표(ZONE_NAME_TO_CODE 등)
    jikgun.js                  # JIKGUN_META/KB/THRESHOLDS + thresholdDigest·detectJikgun·jikgunDigest
    graph_runtime.js           # GRAPH_RT 로드/조회 (jikgun.js 가 소비)
    embedding.js               # TOPIC_EMBED 핸들 + scheduleToolEmbedWarmup + nearest 헬퍼 래퍼
    forecast.js                # normalize·detectZone·detectIntent·buildForecastSummary·findWarning·resolveZoneName·coordsFor·getZoneForecastAt·rankZones·getTyphoonStatus·buoy/visibility 조회
    answer.js                  # composeAnswerFallback·composeAnswerAI·buildPersonalContext·profileDefaultZone·detectWithAI·composeBuoyListAnswer
    tools.js                   # TOOL_EXEC (forecast/geodata/internal 의존)
    planner.js                 # deriveFocus·planQuery·needsReplan
    web_search.js              # webSearchAnswer
    brain.js                   # runBrain (planner+tools+web_search+answer 조립, synth 프롬프트·cleanAnswer)
    focus.js                   # (deriveFocus 를 planner 와 분리하고 싶을 때) — 1차에선 planner.js 동거 허용
    links.js                   # extractTidePlace·findBuoyInQuery·resolveTidePoint·buildLinks·haversineKm·findBuoysNearZone·findNearestBuoys
    ratelimit.js               # RATE_LIMIT_*·_rateBuckets·getClientIp·checkRateLimit·_rateCleanup
    internal_api.js            # internalGet·internalPost·_sleep·fetchTideTimes
    routes_ask.js              # POST /ask + GET /health
    routes_onboard.js          # ONBOARD_* + onboardScripted·onboardWithAI + POST /onboard
    routes_voice.js            # pcmToWav + POST /tts·/transcribe·/style-digest
```

> 비고: `focus.js`는 옵션. `deriveFocus`는 `planner.js`/`brain.js`에서만 쓰이므로 1차에서는 planner 동거가 단순. 과분할 지양.

---

## 2. 의존 그래프 (방향 = "→는 의존")

```
                 runtime.js  (config, dataCache, gemini, assistantLog 핸들 — leaf)
                     ▲   ▲   ▲
   geodata.js ───────┘   │   └────── internal_api.js
   (참조표·좌표 leaf)     │                 ▲
        ▲   ▲            │                 │
        │   │       graph_runtime.js       │
        │   │            ▲                 │
        │   │        jikgun.js             │
        │   │            ▲                 │
   catalog_loader.js  embedding.js         │
        ▲   ▲             ▲                │
        │   └──── forecast.js ─────────────┤  (geodata + dataCache + internal_api)
        │            ▲                     │
        │        answer.js (forecast,gemini,jikgun)
        │            ▲
        │        tools.js (forecast, geodata, internal_api, catalog APP_CAPABILITIES)
        │            ▲
        │        planner.js (catalog, jikgun, embedding, forecast, geodata, gemini)
        │            ▲          web_search.js (gemini)
        │            └────────────┐  ▲
        │                     brain.js (planner, tools, web_search, answer, forecast, jikgun)
        │                         ▲
   links.js (geodata,forecast,internal_api) ratelimit.js
                         ▲             ▲
        routes_ask.js (brain, forecast, answer, links, ratelimit, runtime)
        routes_onboard.js (gemini, runtime)
        routes_voice.js (gemini, runtime)
                         ▲
                   assistant.js (얇은 조립 — 위 라우트 모듈 require, router 합침)
```

**규칙: 의존은 위→아래 한 방향만.** leaf(`runtime`,`geodata`,`internal_api`)는 누구도 import 하지 않게(서로 import 금지). brain/routes 가 최상위 소비자.

**추가 의존(위 ASCII 누락분 보정)**: `embedding.js → graph_runtime.js`. 현 코드(321~332줄)에서 `TOPIC_EMBED` 로드 직후 토픽 워밍업 항목을 `GRAPH_RT.jikgun`을 순회해 만든다. 즉 embedding은 로드 시점에 채워진 `GRAPH_RT`를 읽어야 한다 → `graph_runtime`이 embedding보다 먼저 평가돼야 함(단방향, 순환 없음).

---

## 3. 모듈별 export 면 (계약)

| 모듈 | export | 비고 |
|---|---|---|
| `runtime` | `{ config:{DATA_DIR,SERVER_PORT}, dataCache, gemini, assistantLog }` | gemini/assistantLog 는 null 가능(폴백 유지) |
| `internal_api` | `internalGet, internalPost, fetchTideTimes` | `_sleep` 내부 비공개 |
| `geodata` | `BUOY_BY_ID, TIDE_STATIONS, ZONE_COORDS, HAEGU_COORDS, ZONE_NAME_TO_CODE, ZONE_NAMES, WIND_DIR_KO, NUM_EF_LABEL, normalize` | 모듈 로드 시 1회 파싱(현 IIFE 그대로). `normalize`는 공용이라 여기 둠 |
| `catalog_loader` | `CATALOG_DIGEST, APP_CAPABILITIES, BRAIN_MODEL, TOOL_CATALOG` | TOOL_CATALOG 파싱은 embedding 이 소비 |
| `graph_runtime` | `GRAPH_RT, loadGraph()` | GRAPH_RT 는 **읽기 전용 공유 객체**(아래 §6) |
| `jikgun` | `detectJikgun, jikgunDigest, thresholdDigest` | GRAPH_RT·JIKGUN_KB 내부 보유 |
| `embedding` | `topicEmbed(=핸들 or null), nearestTopics, nearestTools, scheduleToolEmbedWarmup` | isReady/toolsReady 래핑. 핸들 실제 메서드는 `warmup`/`warmupTools`/`nearestTopics`/`nearestTools`/`isReady`/`toolsReady`(→§4 검증). 로드 시 `graph_runtime.GRAPH_RT.jikgun`을 읽어 토픽 워밍업 |
| `forecast` | `detectZoneDeterministic, detectIntentDeterministic, resolveZoneName, coordsFor, buildForecastSummary, findWarning, getZoneForecastAt, getBuoyObs, getVisibility, rankZones, getTyphoonStatus` | dataCache·geodata 소비 |
| `answer` | `composeAnswerFallback, composeAnswerAI, buildPersonalContext, profileDefaultZone, detectWithAI, composeBuoyListAnswer` | |
| `links` | `buildLinks, extractTidePlace, resolveTidePoint, findBuoyInQuery, haversineKm, findBuoysNearZone, findNearestBuoys` | `haversineKm`는 forecast(getVisibility)도 사용 → §5 순환 주의 |
| `tools` | `TOOL_EXEC` | |
| `web_search` | `webSearchAnswer` | |
| `planner` | `planQuery, deriveFocus, needsReplan` | |
| `brain` | `runBrain` | |
| `ratelimit` | `checkRateLimit, getClientIp` | _rateCleanup 은 모듈 로드 시 setInterval |
| `routes_*` | `router`(Express.Router) | assistant.js 가 `router.use()`로 결합 |

---

## 4. 이동표 (함수/상수 → 목적지)

| 식별자 | 현 줄 | → 모듈 |
|---|---|---|
| `internalGet/Post`, `_sleep`, `fetchTideTimes` | 49~88 | internal_api |
| `BUOY_BY_ID`/`TIDE_STATIONS`/`ZONE_COORDS`/`HAEGU_COORDS` 로더 | 95~157 | geodata |
| `ZONE_NAME_TO_CODE`/`ZONE_NAMES`/`WIND_DIR_KO`/`NUM_EF_LABEL` | 373~433 | geodata |
| `normalize` | 440 | geodata |
| `CATALOG_DIGEST` | 161~173 | catalog_loader |
| `BRAIN_MODEL`/`TOOL_CATALOG`/`APP_CAPABILITIES` | 871~923 | catalog_loader |
| `JIKGUN_META/KB/THRESHOLDS`,`thresholdDigest`,`detectJikgun`,`jikgunDigest` | 181~291 | jikgun |
| `GRAPH_RT` 로드 | 300~318 | graph_runtime |
| `TOPIC_EMBED` 로드,`scheduleToolEmbedWarmup`,임베딩 워밍업 | 321~353,907 | embedding |
| `gemini`/`assistantLog`/config | 35~46,357~364 | runtime |
| `detectZoneDeterministic`/`detectIntentDeterministic` | 451~522 | forecast |
| `buildForecastSummary`/`findWarning` | 523~613 | forecast |
| `resolveZoneName`/`coordsFor`/`getZoneForecastAt`/`getBuoyObs`/`getVisibility`/`rankZones`/`getTyphoonStatus` | 926~1125 | forecast |
| `composeAnswerFallback`/`composeAnswerAI`/`buildPersonalContext`/`profileDefaultZone`/`detectWithAI` | 614~813 | answer |
| `composeBuoyListAnswer` | 1824~1830 | answer (물리적으로 links 블록 1782~1935 안에 있으나 목적지는 answer — 식별자 단위로 추출) |
| `RATE_LIMIT_*`/`_rateBuckets`/`getClientIp`/`checkRateLimit`/`_rateCleanup` | 814~851 | ratelimit |
| `TOOL_EXEC` | 1128~1266 | tools |
| `deriveFocus`/`planQuery`/`needsReplan` | 1271~1399, 1429~1438 | planner |
| `webSearchAnswer` | 1403~1425 | web_search |
| `runBrain`(+synth 프롬프트,cleanAnswer) | 1440~1602 | brain |
| `extractTidePlace`/`findBuoyInQuery`/`resolveTidePoint`/`buildLinks` | 1782~1793, 1831~1935 | links |
| `haversineKm`/`findBuoysNearZone`/`findNearestBuoys` | 1793~1823 | **geodata**(§5-1: 순수 수학·부이근접을 leaf로) |
| `GET /health` | 853~869 | routes_ask |
| `POST /ask` | 1604~1776 | routes_ask |
| `ONBOARD_*`/`onboardScripted`/`onboardWithAI`/`POST /onboard` | 1937~2040 | routes_onboard |
| `pcmToWav`/`POST /tts`,`/transcribe`,`/style-digest` | 2042~2181 | routes_voice |

> **줄 구간 비연속 주의(식별자 단위 추출 필수)**:
> - planner 3함수는 연속 블록이 아니다 — `webSearchAnswer`(1403~1425)가 `planQuery`(1297~1399)와 `needsReplan`(1429~1438) **사이에 끼어** 있다. 구간 통째 컷하면 web_search까지 따라가므로 `deriveFocus`/`planQuery`/`needsReplan`만 식별자 단위로 옮길 것.
> - links 블록(1782~1935) 안에 목적지가 다른 함수가 섞여 있다: `haversineKm`/`findBuoysNearZone`/`findNearestBuoys`(→geodata), `composeBuoyListAnswer`(→answer). links 추출 시 이 4개는 남기고 분리.

---

## 5. 순환 의존 방지

위험 지점 3곳:

1. **`forecast` ↔ `links`**: `forecast.getVisibility`가 `haversineKm`/`findBuoysNearZone` 사용, 반대로 `links`는 `forecast.resolveZoneName`/`detectZoneDeterministic` 사용 → 양방향 위험.
   - 해소: 순수 수학 헬퍼 `haversineKm`와 부이 근접 조회(`findBuoysNearZone`/`findNearestBuoys`)는 **geodata(leaf)** 로 내린다. forecast·links 모두 geodata 만 바라봄(단방향).
2. **`tools` ↔ `forecast`**: `TOOL_EXEC`가 forecast/links 함수를 다수 호출. 역참조는 없음 → tools가 상위 소비자가 되도록 단방향 유지(forecast/links가 tools를 import하지 않게).
3. **`jikgun` ↔ `graph_runtime`**: jikgun이 GRAPH_RT를 읽음. graph_runtime은 jikgun 미참조 → graph_runtime을 leaf 쪽으로(단방향).

**일반 원칙**
- 순수 데이터/수학/상수 → 항상 아래(leaf)로.
- 조립 로직(brain/routes)만 위로.
- "공유 가변 상태"는 `runtime`/`graph_runtime`/`embedding`이 **객체 참조 한 개**를 export, 소비자는 그 참조를 읽기만(재할당 금지) → 양방향 import 불필요.

---

## 6. 깨질 전역 상태 공유 방법 (자체검토)

| 상태 | 현 형태 | 분리 후 |
|---|---|---|
| `GRAPH_RT` | `const GRAPH_RT={jikgun:{}}` 후 IIFE가 내부 속성 채움(재할당 X) | graph_runtime이 동일 객체를 export. **재할당이 아니라 속성 mutation**이라 require 캐시 싱글턴이면 모든 소비자가 같은 채워진 객체를 봄. 안전. |
| `TOPIC_EMBED` | `let`에 require 결과 대입(실패 시 null) | embedding 내부 `let`로 유지, **함수 래퍼**(`nearestTopics` 등)로만 노출 → 외부에서 핸들 직접 의존 제거(null 폴백 분기 캡슐화) |
| `JIKGUN_KB`/`JIKGUN_THRESHOLDS` | `const`/`let`, 로드 시 채움 | jikgun 내부 보유, 함수로만 노출 |
| 로더 상수(`BUOY_BY_ID` 등) | 모듈 로드 시 동기 파싱 | geodata 로드 시 동기 파싱(현 동작 동일). require 1회 → 1회 파싱 보장 |
| `_rateBuckets`/`_rateCleanup` | `Map` + `setInterval` | ratelimit 내부. setInterval은 모듈 1회 로드 시 1회만 — **중복 등록 주의**(아래) |
| `gemini`/`assistantLog` | `let`(require) | runtime이 보유·export. 여러 모듈이 동일 핸들 공유 |

**부작용(side-effect) 일원화**: 현재 파일 로드 시 ① 콘솔 로더 로그 ② 임베딩 워밍업 ③ setInterval(rate cleanup)이 일어난다. 모듈화 후에도 **각 부작용은 정확히 한 번**만 실행되도록, 부작용 보유 모듈을 `assistant.js`에서 require하는 경로가 유일하게 한 번 평가되게 한다(require 캐시가 보장하나, 순환 require 시 부분 평가 위험 → §5 단방향 준수로 회피).

**load 순서 의존성**: 두 가지를 모두 보존해야 한다.
- ① 토픽 워밍업: 현 코드는 `TOPIC_EMBED` 로드 직후 `GRAPH_RT.jikgun`을 순회(324~332줄)한다. 따라서 `graph_runtime`이 채워진 뒤 `embedding`이 평가돼야 함(`embedding`이 `graph_runtime.GRAPH_RT`를 import) → graph_runtime→embedding 단방향.
- ② 도구 워밍업: 현 코드는 `TOOL_CATALOG` 정의 후 `scheduleToolEmbedWarmup(TOOL_CATALOG)` 호출(907줄)이 필요. 분리 후 이 트리거는 `embedding`이 `catalog_loader.TOOL_CATALOG`를 import해 자기 로드 시 호출하거나, `assistant.js` 조립부에서 1회 호출. catalog→embedding 단방향.

둘 다 위→아래 단방향이라 순환 없음. 단 §8 PR 순서상 `embedding`(PR6)은 `graph_runtime`(PR5)·`catalog_loader`(PR3) 추출 **이후**여야 import 대상이 존재함.

---

## 7. 테스트(게이트) 무회귀 보장

- 기준 게이트: `knowledge/phases/phase2b_eval*.{jsonl,py}`, `phase2b_sentinel.*`, `phase0_*` 러너, golden. **각 PR 전/후 동일 입력으로 답변 동등성** 비교.
- 절차(각 PR):
  1. 분리 전 baseline 게이트 실행 → 출력 스냅샷 저장.
  2. 분리(파일 이동 + require 배선)만 수행, **로직 한 줄도 변경 금지**(순수 이동).
  3. 게이트 재실행 → diff 0 확인. answer 텍스트/toolsUsed/zone/focus 동일해야 함.
- 추가 안전망: `GET /api/assistant/health`로 `aiAvailable`·`dataReady`·`zoneCount`(=`ZONE_NAMES.length`) 부팅 동일성 확인. 로더 콘솔 로그 카운트(부이/조석/해역/해구/직군/그래프 개수)가 분리 전과 동일한지 비교 = 정적 로드 무결성 빠른 검증.
- "순수 이동" 원칙: 이름·시그니처·동작 보존. 리네이밍/시그니처 변경/로직 개선은 **이 리팩터링 PR에서 금지**(별도 후속).

---

## 8. 단계별 PR 계획 (저위험 → 고위험)

> 각 PR은 독립 머지 가능, 게이트 통과 필수. assistant.js는 점진적으로 얇아짐(매 PR마다 require로 대체).

| PR | 범위 | 위험 | 근거 |
|---|---|---|---|
| **PR1** | `runtime.js` + `internal_api.js` 추출 | 저 | leaf, 부작용 없음(internalGet 등 순수 함수). 배선만 |
| **PR2** | `geodata.js`(로더+참조표+normalize+haversineKm+부이근접) | 저~중 | 동기 파싱·순수. 단 §5-1 선반영(haversine/near를 geodata로) |
| **PR3** | `catalog_loader.js` | 저 | 문자열/JSON 상수만 |
| **PR4** | `ratelimit.js` | 저 | setInterval 1회 보장 확인 |
| **PR5** | `graph_runtime.js` + `jikgun.js` | 중 | GRAPH_RT 공유 객체 검증(§6). 직군 게이트 집중 확인 |
| **PR6** | `embedding.js` | 중 | TOPIC_EMBED null 폴백·워밍업 1회. 임베딩 OFF/ON 양쪽 게이트 |
| **PR7** | `forecast.js` | 중~고 | 도메인 핵심. zone/intent 탐지·랭킹 회귀 위험. golden 집중 |
| **PR8** | `answer.js` | 중 | 폴백/AI 답변 경로 |
| **PR9** | `links.js` | 중 | 물때/부이 버튼·tideSearch 신호 회귀 주의 |
| **PR10** | `tools.js`(TOOL_EXEC) | 고 | 14개 도구 전수. 각 도구 단위 입력 게이트 |
| **PR11** | `web_search.js` + `planner.js` + `brain.js` | 고 | runBrain 합성·focus 전파·재계획·도메인 가드. sentinel/연속턴 게이트 전수 |
| **PR12** | `routes_ask.js`·`routes_onboard.js`·`routes_voice.js` + `assistant.js` 얇은 조립 | 중 | 라우트 경로/응답 스키마 동일성. 엔드포인트 스모크 |

**조립부(assistant.js) 최종 형태(설계 의도)**
```js
const express = require('express');
const router = express.Router();
require('./assistant/embedding');           // 워밍업 부작용 1회 트리거(또는 명시 호출)
router.use(require('./assistant/routes_ask'));
router.use(require('./assistant/routes_onboard'));
router.use(require('./assistant/routes_voice'));
module.exports = router;
```

**점진성 보장 트릭**: PR마다 새 모듈을 만들고 assistant.js에서 해당 함수를 `require(...)`로 끌어와 **기존 본문을 삭제**(재선언 충돌 방지). 즉 한 PR 안에서 "추출 + 원본 제거 + require 대체"를 원자적으로. 중간 상태에서도 단일 router export 유지 → 서버 항상 기동 가능.

---

## 9. 리스크 / 주의

- **require 순환**: §5 단방향만 지키면 회피. 의심 시 `madge`로 순환 검사 PR 게이트 추가 권장.
- **부작용 중복**: 로더 로그·setInterval·임베딩 워밍업이 require 경로 분기로 2회 평가되지 않게(단일 진입 require 트리 유지).
- **load 타이밍**: catalog→embedding 워밍업 호출 순서 보존(catalog가 먼저 평가되어야 TOOL_CATALOG 존재).
- **gemini/assistantLog null**: 폴백 경로(키 없음)도 게이트에 포함해 양쪽 검증.
- **focus/연속 턴**: brain↔planner 분리 시 `deriveFocus` 동작이 가장 미묘 — 연속 카테고리 게이트 필수.
