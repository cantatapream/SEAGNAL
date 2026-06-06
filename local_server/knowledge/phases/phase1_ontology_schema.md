# Phase 1 — 온톨로지 & 지식그래프 스키마 (설계)

> 상위: `../00_MASTER_PLAN.md` (Phase 1). 목적: 해양·기상·직군 개념을 정형화해 검색·추론·RAG의 뼈대로 삼는다.
> 이 문서는 **스키마 설계(정본)**. 실제 그래프 데이터 파일은 후속 단계 산출물(경로는 §8).

---

## 1. 왜 그래프인가
나리야는 지금 도구를 잘 고른다(Phase 0). 하지만 "들물에 여밭 어때?"(낚시 은어), "거기 근처 부이"(지시어), "조업하기 안전한 해구"(해구↔해역↔특보 교차) 같은 질문은 **개념·식별자·관계를 잇는 뼈대**가 있어야 안정적으로 확장·추론된다. 온톨로지는 ① 식별자 정합(해역명↔regId↔해구↔좌표↔조석항) ② 직군 지식의 구조화(관심사↔도구↔GAP↔용어) ③ RAG 검색 확장(동의어·인접개념)을 가능케 한다.

---

## 2. 엔터티(노드) 타입

| 엔터티 | 키 | 핵심 속성 | 원천(코드/파일) |
|---|---|---|---|
| **SeaZone**(해상예보구역) | regId(8자리, 예 `12B10302`) | name, aliases[], coord, parentRegion, farFlag(앞/먼바다) | `ZONE_NAME_TO_CODE`, `seaZoneCoordinates.js` |
| **GridZone**(해구) | lzone(숫자, 예 `325`) | coord?, containingSeaZone? | `get_zone_forecast`(KHOA 격자) |
| **Buoy**(기상/파고부이) | buoyId(예 `22103`) | name, nname, coord, type, observes[] | `buoyLocations.js`(`BUOY_BY_ID`) |
| **TideStation**(조석표준항) | name | coord | `tide.js`(`TIDE_STATIONS`) |
| **WarningArea**(특보구역) | = SeaZone 트리 노드 | current, upcoming | `weather_alerts.json` |
| **DataParam**(관측·예보 변수) | canonicalKey | unit, 표시규칙 | 아래 §4 표준키 |
| **Tool**(나리야 도구) | toolName(예 `get_current`) | provides[](DataParam), inputType | `TOOL_CATALOG`/`TOOL_EXEC` |
| **Jikgun**(직군) | slug(8종) | name, kw[] | `knowledge/jikgun/*.md`, `routes/usage.js` |
| **Topic**(관심사) | id | label, priority | 직군 파일 "핵심 관심사" |
| **Term**(용어/동의어) | id | standard, synonyms[] | 직군 파일 "전문용어·동의어" |
| **Gap**(미충족) | id | label, externalSource?, url? | 직군 파일 "GAP 보완 후보" |
| **ProactiveRule**(선제규칙) | ruleId(`TR-<약어>-NN`) | trigger{metric,op,threshold,unit}, message, basisTool | 직군 파일 "선제 제안" |
| **Typhoon**(동적) | seq/name | current{lat,lon,pressure,wind}, forecast[] | DMDW(`typhoon.json`) |
| **Index**(생활지수) | kind(fishing/surfing/sea_split) | places[] | `*_index.json` |

---

## 3. 관계(엣지) 타입

```
SeaZone   —hasCoord→         Coord
SeaZone   —partOf→           Region             (앞바다/먼바다 계층)
SeaZone   —containsGrid→      GridZone           (지리 포함; 코드 직매핑 아님 → 좌표 기반)
SeaZone   —near→             Buoy | TideStation (Haversine 인접)
SeaZone   —hasWarning→        WarningArea
Tool      —provides→          DataParam
Tool      —accepts→           {zone|coords|buoy|none}
DataParam —observedBy→        Buoy               (예: water_temp ← 부이)
DataParam —forecastBy→        Tool               (예: wave_height ← get_marine_forecast)
Jikgun    —caresAbout→        Topic              (priority 가중)
Topic     —servedBy→          Tool | DataParam
Topic     —isGap→             Gap
Gap       —filledByExternal→  (기관, url)
Jikgun    —usesVocab→         Term
Term      —synonymOf→         Term
Term      —refersTo→          Entity | DataParam (예: "들물"→tide_phase, "여밭"→Topic)
Jikgun    —hasRule→           ProactiveRule
ProactiveRule —triggersOn→    DataParam(metric)
ProactiveRule —basis→         Tool
```

---

## 4. DataParam 표준키 (계측 개념의 단일 어휘 — `_SCHEMA.md` 와 일치)

| canonicalKey | 단위 | 동의 표면형(예) | 제공 도구 |
|---|---|---|---|
| wave_height | m | 파고, 물결, 너울, 파도 | get_marine_forecast, get_zone_forecast, get_buoy_observation, get_zones_ranked |
| wind_speed | m/s | 풍속, 바람 세기 | get_marine_forecast, get_buoy_observation, get_zones_ranked |
| wind_dir | deg/방위 | 풍향, 바람 방향, 오프쇼어/온쇼어 | get_marine_forecast |
| wave_period | s | 파주기, 피리어드, 스웰 주기 | get_zone_forecast (스웰 상세는 GAP) |
| water_temp | °C | 수온, 물 온도 | get_buoy_observation |
| visibility | km | 시정, 해무, 안개 | get_buoy_observation, get_seafog_cctv |
| current_speed | cm/s(+노트) | 유속, 조류, 해류 | get_current |
| depth | m | 수심 | get_depth |
| tide_phase | 사리/조금/만조/간조/들물/날물 | 물때, 조석 | get_tide |
| warning | 특보종류 | 풍랑주의보/경보, 강풍 | get_warning |
| typhoon_eta | h | 태풍 도달 | get_typhoon_status |
| sky | 맑음/구름/비 | 하늘, 날씨 | get_marine_forecast |

> 이 표가 **STT 보정·검색 확장·선제규칙 트리거**의 공통 어휘다. Term(동의어)은 모두 canonicalKey 또는 엔터티로 귀결.

---

## 5. 식별자 정합 (Phase 1 핵심 난제)

해상 식별자 체계가 **3종으로 분리**돼 있다. 이름·코드 직매핑이 불가한 구간은 **좌표 기반**으로 잇는다.

| 체계 | 예 | 출처 | 매핑 방법 |
|---|---|---|---|
| 해역명 ↔ regId | 제주도북부앞바다 ↔ `12B10302` | `ZONE_NAME_TO_CODE` | 직접(사전) |
| regId ↔ 좌표 | `12B10302` ↔ (lat,lon) | `seaZoneCoordinates.js` | 직접(동일 코드체계) |
| regId ↔ 중기 권역 | `12B10302` → `12B10000` | 파생규칙(`[:4]+0000`) | 규칙 |
| **해구(lzone) ↔ 해역** | `325` ↔ ? | KHOA 격자 | **좌표 포함 판정**(직매핑 없음) ← 작업 필요 |
| 부이 ↔ 해역 | `22103`(거문도) ↔ 인접 SeaZone | Haversine | 좌표 |
| 조석항 ↔ 해역/해점 | 목포 ↔ 인접 | 좌표 | 좌표 |

→ **정합 산출물**: 위 매핑을 한 파일로 고정(특히 해구↔해역 좌표 포함표). 경로 §8.

---

## 6. 직군 지식 → 그래프 적재 규칙

직군 파일(`jikgun/*.md`, `_SCHEMA.md` 준수)을 다음과 같이 노드/엣지로 흡수한다(자동 추출 가능 — 이미 정합화됨):
- "핵심 관심사" 굵은 항목 → **Topic** 노드, `Jikgun —caresAbout(priority=순위)→ Topic`.
- 관심사의 `[앱매핑]` → `Topic —servedBy→ Tool/DataParam`; `[GAP]` → `Topic —isGap→ Gap`.
- "전문용어·동의어" 행 → **Term**(standard+synonyms), `Term —refersTo→ DataParam|Entity`.
- "GAP 보완 후보" 표 → **Gap**(externalSource,url).
- "선제 제안" `TR-<약어>-NN` → **ProactiveRule**(trigger 조건식 그대로).

---

## 7. RAG 검색에서의 활용 (확장 규칙)
질의 처리 시:
1. **표면형 정규화**: Term 그래프로 은어/구어 → canonicalKey/엔터티 (예 "들물"→tide_phase, "여밭"→angler Topic).
2. **엔터티 해소**: 지명/지시어 → SeaZone/Buoy/GridZone (좌표 인접·맥락).
3. **개념 확장**: 직군 caresAbout → 우선 Topic → servedBy Tool 로 도구 후보 가중(Phase 2b 강화).
4. **인접 확장**: SeaZone near Buoy/TideStation, containsGrid 로 교차 질의 해소("거기 근처 부이").

---

## 8. 저장 포맷(제안) & 범위 결정 필요
- v1 제안: 단일 JSON 그래프 `knowledge/graph/graph.json`(`{nodes:[{id,type,...}], edges:[{from,rel,to}]}`) — 의존성 0, 서버 로컬 읽기(리포 정본 원칙과 일치). 규모상 충분(수천 노드).
- 대안: RDF/.ttl(표준이나 도구 무겁다) → 현재 과투자. 검색량 폭증 시 그래프DB 재검토.
- **결정 필요(마스터플랜 §6 등재)**: ① graph.json 빌더를 직군 파일+식별자에서 자동 생성할지 ② RAG 확장(7장)을 Phase 2b에 바로 연결할지 ③ 해구↔해역 좌표 포함표 우선 작성 여부.

---

## 9. 완료 기준(DoD)
- 엔터티/관계/표준키 스키마 확정(본 문서) ✅
- 식별자 정합표 작성(특히 해구↔해역) — 후속
- 직군→그래프 자동 적재 빌더 + `graph.json` 생성 — 후속
- RAG 확장 PoC: 평가셋에서 그래프 확장 적용 시 도구선택/검색 적중률 **베이스라인 대비 향상** — 후속(베이스라인 먼저 측정)
