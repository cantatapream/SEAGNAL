# 위험예측 구현 설계서 (risk_forecast.impl_design)

> **한 줄 요약**: 「위험예측」(연안 위험 예측·분석 + 해상 위험 예측·분석)을 **서버가 점수를 계산하고, 화면은 받은 값으로 문구를 조립하는** 구조로 만든다.
> 새로 만드는 서버 부분은 **수집기 3개(해양교통 혼잡도·관광지 집중률·행사) + 정적 표 빌드 + 점수 엔진 + API 1묶음**이다.
> 화면은 `index2.html` 에 연결하지 않고 **별도 미리보기 페이지**(`client/risk_forecast_preview.html`)로 띄운다(선례: `client/admin_zone_editor.html`).
> 기존 수집기(`scheduler.js`·`marine_warning_crawler.js`·`gale_warning_store.js`)와 푸시 코드는 **고치지 않는다** — 그 파일들이 이미 쓰는 결과 파일을 **읽기만** 한다.

- 작성: 2026-10-10 (KST). 이번 단계는 설계만이다. 코드는 짜지 않았다.
- 기준 문서: 요구 `risk_forecast_ui.spec.md`(R·K·B·C 번호) · 결정 `coastal_safety_forecast.design.md`(U 번호) · 시안 `mock/risk_layer_mock.html`(판 23) · 점수 `local_server/config/coastal_safety/accident_analysis/v3/points_v31.md`·`report.md`.
- 다음 단계 담당: **화면 = 소넷**, **점수 계산·서버 자료 연결 = 오퍼스**(§7).

---

## 0. 읽는 법

### 0.1 표기
| 표기 | 뜻 |
|---|---|
| `파일:줄` | 이번 작성 때 그 줄을 직접 읽어 확인했다. |
| **[실측]** | 이번 작성 때 스크립트로 직접 세거나 계산했다(방법을 옆에 적음). |
| **[미확인]** | 확인하지 못했다. 지어내지 않았다. |
| **[설계 판단]** | 근거 문서에 정해진 것이 없어 이 설계서가 고른 것. 고른 이유를 적었고 §6.2 에서 사용자 확인 대상으로 다시 묶었다. |
| R·K·B·C | 명세(`risk_forecast_ui.spec.md`)의 요구·미결·어긋남·시안전용 번호 |
| U | 설계서(`coastal_safety_forecast.design.md`) §1 사용자 확정 번호 |

### 0.2 범위
| 구분 | 내용 |
|---|---|
| 이번 설계 범위 | 명세 §0.4 「이번 범위」 전부: 지도(연안·해상)·슬라이더·바텀시트·[기준 상세]·숫자 규칙·점수 규칙·데이터 입력 + 그것을 받쳐 줄 서버 수집·계산·API |
| 하지 않음 | `index2.html` 연결(사용자 원문 *"단, INDEX2 메인페이지에는 아직 반영하지말자."*) · 메인 브리핑 아코디언(설계서 §11, U43) · 브리핑 AI(U61·U62) · 푸시 |
| 연결 단계로 미룸 | 해양안전 탭 버튼 마크업·`SOLO_BTN_IDS` 편입(`life_safety.js:893`)·`ocean_map.js` 클릭 훅 한 줄 — §7 단계 6 |

### 0.3 이번 작성에서 하지 않은 것
- HANDOFF 착수/완료 기록(`handoff.py`)은 남기지 않았다 — 이번 지시가 「만드는 파일은 이 설계서 하나뿐, git 명령 금지」라서다. 다음 단계 착수 때 남긴다.
- `verify_all.sh` 는 돌리지 않았다(코드 변경 없음).

---

## 1. 현재 자산 조사표 (명세 §9)

> 찾는 방법: 각 항목마다 `grep -rn`(local_server·client, node_modules 제외)과 파일 직접 읽기. 로컬 `local_server/data/` 에 있는 파일 목록도 `ls` 로 확인했다
> (이 작업 환경에는 `weather_alerts.json`·`zone_forecasts.json`·`gale_warnings.json` 이 **없다** — 운영 서버(Fly 볼륨)에만 생기는 파일이라 **실제 내용 표본은 못 봤다**. 모양은 코드로만 확인했다).

### 1.1 한눈에
| # | 자료 | 서버에 있나 | 새로 만들 것 |
|---|---|---|---|
| 1 | 특보·예비특보(풍랑·태풍) | **있음** — `data/weather_alerts.json`, `GET /api/weather-alerts` | 예비 범위 **시작** 시각 해석기 · 칸/관광지 ↔ 특보구역 매칭 · 미래 시각의 상태 규칙 |
| 2 | 해구 파고·풍속 예보 | **있음** — `data/zone_forecasts.json`, 메모리 `dataCache.zoneForecasts` | 「가장 가까운 3시간 값」 고르기 · 대해구 하루 최대값 |
| 3 | 해양교통 혼잡도 | **없음** | **수집기 신설** + 칸 위치표 |
| 4 | 관광지 1,354곳 | **있음**(파일) — `config/coastal_safety/coastal_spots.json` | 관광지 ID·주소 |
| 4′ | 관광지 집중률 | **없음** | **수집기 신설** |
| 5 | 연안위험구역 GeoJSON + 3km 안 개수 | 파일 **있음**, 개수 표는 **없음** | 빌드 단계에서 관광지별 개수 계산 |
| 6 | 사망사고 발생구역 | 위 파일 안 「구역분류」 | 위와 같음 |
| 7 | 행사 | **없음**(과거 조사 파일만) | **수집기 신설**(관광공사 공식 목록 + Gemini 웹 검색) |
| 8 | 너울(파주기) | **있음** — `services/swell_smallzone.js` 메모리 캐시 | 관광지 → 소해구 연결 |
| 9 | 이안류(13곳) | **있음** — `data/ripcurrent_index.json` (현재 관측값만) | 이안류 지점 → 관광지 연결표 |
| 10 | 강풍 저장소 | **있음**(파일만) — `data/gale_warnings.json`, **API 없음** | 읽기·구역 이름 맞추기 |
| 11 | 해구 번호·소해구 | **있음** — `client/marine_zone_area.json` + `vsby_smallzone.pointToCellKey` | 격자 칸 → 대표 소해구 표 |
| 12 | 주요지명 165곳 | **있음**(브라우저 전역 상수만) — `client/tide.js:201` | 서버가 쓸 수 있게 빌드 때 뽑아 쓰기 |
| 13 | 파출소 관할 | **있음**(파일) — `config/coastal_safety/coastguard_stations.geojson` | 관광지 → 파출소 판정 규칙(K-20) |
| 14 | 해수욕장 여부 | 규칙만 있음(이름에 해수욕장·해변·비치, U56) | 빌드 때 표시 |

### 1.2 항목별 상세

#### ① 특보·예비특보(풍랑·태풍)
| 항목 | 내용 |
|---|---|
| 만드는 곳 | `local_server/marine_warning_crawler.js` `_writeWeatherAlertsJson` (`:3447`, 호출 `:4444`·`:4610`) → `local_server/data/weather_alerts.json`. 원자적 쓰기(tmp → rename, `:3494~3495`) |
| 갱신 주기 | **1분** — `scheduler.js:2686` (1분 `setInterval` 안의 `marineWarningCrawler.run()`) |
| 메모리 | `services/cache_manager.js` `dataCache.warnings` — 5초마다 mtime 이 바뀌면 다시 읽음(`:75~117`) |
| API | `GET /api/weather-alerts` (`routes/weather.js:243`), `Cache-Control: public, max-age=30` |
| 구조 | `{ updatedAt, previous, current }`. `current` 는 바다 → 해상 → 앞/먼바다 → **잎 구역**(44개) 나무. 잎 = `{ current, upcoming, history, children }` (`:3130~3135` 주석, 뼈대 `_createZoneSkeleton`). `current` = 발효(주의보·경보), `upcoming` = 예비 |
| 한 덩어리의 필드 | `toBlock` (`:3355~3374`): `wrnTp`(한글 종류 「풍랑」「태풍」), `wrnTpNm`, `wrnLvl`·`wrnLvlNm`(주의보·경보·예비 — 발효 중 공존 예비는 **실제 단계** `wrnLvlReal`), `tmFc`, **`tmEf`**, `tmYn`, `tmCc`·`clrNtcTm`(해제예고), `source` |
| `tmEf` 꼴 | `normalizeMmisTime` (`:3301~3347`) 이 바꾼 글자: ①「`22일 밤(21시~24시)`」(월 없음) ②「`2026년 06월 02일 밤(23시~23시)`」 ③ 정확 시각 「`2026년 05월 21일 06시 00분`」 ④ 분 58/59 코드 → 「`2026년 06월 01일 00시~06시`」 ⑤ 그 밖은 원문 그대로 |
| 종류 | 이 파일에는 **풍랑(V)·태풍(T)만** 들어간다(설계서 §2.1, 크롤러가 나머지를 버림). 강풍은 ⑩ |
| 구역 폴리곤 | 부모 44: `client/assets/warn_zones.geojson`(`GET /api/warn-zones`, `weather.js:274`, 속성 `name`·`WarnCode`). 자식 49: `client/assets/warn_zones_sub.geojson`(`GET /api/warn-zones-sub`, `:317`) — 자식 이름은 `client/js/ocean-map/warnings/ocean_warn_zone.js:53` `SUBZONE_LABEL_MAP`(49개 **[실측]** — 코드에서 객체를 꺼내 셈) |
| ⚠ 이름이 안 맞음 | **[실측]** GeoJSON 이름 44개 중 **15개**가 나무의 잎 이름과 글자가 다르다(띄어쓰기, `.` ↔ `·`. 예 「동해중부 안쪽먼바다」↔「동해중부안쪽먼바다」, 「인천.경기남부앞바다」↔「인천·경기남부앞바다」). 화면 코드는 이미 `_normalizeZoneName`(`ocean_warn_zone.js:170` — 마침표→가운뎃점, 공백 제거)으로 맞춘다. **서버도 같은 규칙을 써야 한다.** |
| ⚠ 예비의 목표 단계 | 일반 예비는 `wrnLvl` 이 「예비」로만 온다. 실제 단계(주의보/경보)는 ef/list 보강분·발효 중 공존 예비에만 실린다(`:4027`·`:4078~4089`·`:3363~3366`). 일반 예비 행에 목표 단계가 따로 실리는지는 **[미확인]**(실제 응답 표본 없음) |
| 서버에 없는 것 | 예비 범위의 **시작** 시각을 꺼내는 함수. 크롤러 `_mmisEndMs`(`:1180`)는 **원시 형식의 끝** 시각만 꺼내고, 정규화된 글자(①~④)는 다루지 않는다 |
| **새로 만들 것** | ⓐ `tmEf` → `{시작, 끝}` 해석기(①~④ 전부, 자정 넘김 「18~00시」 포함) ⓑ 칸 중심·관광지 ↔ 특보구역 매칭 ⓒ 슬라이더 미래 시각에서의 상태 규칙(§3.4.2, §6 N2) |

#### ② 해구 파고·풍속 예보
| 항목 | 내용 |
|---|---|
| 만드는 곳 | `scheduler.js` `collectZoneForecasts` (`:542`), 저장 `saveData('zone_forecasts.json', …)` (`:594`) |
| 받는 것 | 기상청 API허브 `SEA_ZONE_LARGE`(`:555`·`:577`), 기준시각(UTC 00 또는 12) + **0~75시간, 3시간 간격 26개** (`:569~571`) |
| 갱신 주기 | **09:30·21:30 KST** (`:2614`) + 서버 기동 때 1회(`:2478`) |
| 저장 구조 | `{ updatedAt, baseTmUtf, data: { "<대해구번호>": [ {tm, lzone, wh, wp, waveDir, ws, windDir}, … ] }, count }`. 필드 출처 `parseKmaTable` (`:515~537`): `wh`=WH_SIG(유의파고 m) · **`wp`=WVPRD_MAX(최대 파주기 s)** · `ws`=WS(풍속 m/s) · `windDir`=WD. **`tm` 은 UTC 10자리 `YYYYMMDDHH`** (`getUtcTm` `:268~274` — 주석 `:265` 은 12자리라 적었으나 코드는 10자리) |
| 대해구 번호 | `data` 의 키 = `client/marine_zone_area.json` 의 `marine_zone_no`. 화면 `client/js/forecast/alerts/marine.js:71~98` 이 「123-4」에서 앞 번호만 떼어 `/api/marine-zone-forecasts/123` 을 부르는 것으로 확인 |
| 메모리·API | `dataCache.zoneForecasts`(cache_manager `:86`). `GET /api/marine-zone-forecasts`(`weather.js:784`, 전체 약 5.86MB — 코드 주석 값) · `/:zoneId`(`:854`) |
| **새로 만들 것** | 「그 시각에 가장 가까운 3시간 값」 고르기(§3.2) · (대해구, KST 날짜) 하루 최대 파고·풍속(§3.4 「내일 예보만 특보급」·§3.5 3일째 판정) |

#### ③ 해양교통 혼잡도 예보 — **없음**
| 항목 | 내용 |
|---|---|
| 찾은 방법 | `grep -rln "B554035\|sea-tfc\|congestionIndex"` (local_server·client·scripts, `*.js *.py *.json`) → 분석 도구 `local_server/tools/coastal_accident_analysis/12_traffic.py`·`m14_landmask_check.js` 두 개뿐. 둘 다 세션 임시 파일(`mtc4_1010_03.json` 등)을 읽는 일회성 분석이다. **앱 서버 수집기·저장소·API 없음** |
| 원천(설계서 §4) | 한국해양교통안전공단 `B554035/sea-tfc-congst-fcst/get_sea_tfc_congst_fcst`, 필수 `fcstDate·fcstTime·gridLevel·type·pageNo·numOfRows`, 4단계, 시각당 1회(`numOfRows=7000`), 예보 생성 하루 1번(03:56~03:57), 개발계정 **일 100건** |
| 응답 칸(설계서 §4.2 실측) | `gridId`(예 `GR4_F2I24_L3`) · `latitude·longitude`(칸 중심) · `fcstDate·fcstTime` · `fcstCreateDateTime` · `congestionIndex` · `congestionLevel` (+ 받지 않을 `forecastWindSpeed·forecastWaveHeight`, U9) |
| 칸 크기 | 0.025° 칸(U65 「0.025° 칸」) — 위도 0.025° ≈ 2.78km, 경도 0.025°×cos35° ≈ 2.28km(어림) |
| 키 | 공공데이터포털 키가 코드에 박혀 있는 것은 `scheduler.js:713` `FISHING_API_KEY` 하나(국립해양조사원 지수들이 공유). **이 키에 B554035 활용신청이 되어 있는지는 [미확인]** — 설계 때 쓴 키가 어느 것인지도 [미확인] |
| **새로 만들 것** | 수집기 `services/sea_traffic_collector.js` + 저장 `data/risk_forecast/sea_traffic.json.gz` + 칸 위치표 `data/risk_forecast/sea_cells.json` (§2.2) |

#### ④ 관광지 1,354곳 / ④′ 집중률
| 항목 | 내용 |
|---|---|
| 관광지 파일 | `local_server/config/coastal_safety/coastal_spots.json` = `{ _about, spots:[…] }`. **[실측]** `spots` 1,354행, 행 필드 `sgg·sgg_name·name·lat·lon·coast_km·on·rule·coord_src·kor2_title·note`(일부 행만 note). `on`: mainland 659 · island 479 · sea 216. 시군구 코드 60종, 시도 앞자리 10종(48·51·44·50·28·26·47·52·41·31 — **전남 46·12 없음**) |
| ID | **ID 필드가 없다.** (sgg, name) 쌍은 1,354행 모두 서로 다르다 **[실측]** → ID = `"{sgg}|{name}"` 로 쓴다 [설계 판단] |
| ⚠ 주소 | **주소 필드가 없다**(위 필드 목록). 시트 부제 「{주소} · {파출소} 관할」(R4-27)의 주소 원천이 없다 → §6 N1 |
| 집중률 | **없음** — `grep "TatsCnctrRate\|tatsCnctr"` → `coastal_spots.json` 의 `_about` 설명 한 곳뿐 |
| 원천(설계서 §2.1) | 한국관광공사 `B551011/TatsCnctrRateService/tatsCnctrRatedList` — 시도·시군구 코드 필수, 오늘부터 30일, 관광지별 날짜 1행, 상대값, 일 1회 갱신, 개발계정 일 1,000건. 좌표 없음 → 관광지 이름으로 맞춘다(관광지 목록 자체가 이 API 이름에서 왔다 — `_about.what`) |
| **새로 만들 것** | 수집기 `services/tour_concentration_collector.js` → `data/risk_forecast/tour_concentration.json` (시군구 60개 호출 + 쪽 넘김) |

#### ⑤ 연안위험구역 GeoJSON + 관광지별 3km 안 개수 / ⑥ 사망사고 발생구역
| 항목 | 내용 |
|---|---|
| 파일 | `local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson` **[실측]** 820개(Polygon 817 · MultiPolygon 3), 구역분류 연안사고 위험구역 527 · **사망사고 발생구역 201** · 연안사고 다발구역 92, 장소형태 14종. 속성 `name·소속서·관할파출소·구역분류·장소명·장소형태·주소`(주소는 「(인근)대한민국 부산광역시 …」 꼴) |
| 세는 규칙(분석 원본) | `local_server/tools/coastal_accident_analysis/04_geo.py:198` `hzT.query(spP, predicate='dwithin', distance=3000)` — **관광지 점에서 폴리곤까지 거리 ≤ 3,000m**, 좌표는 EPSG:5179(m) 투영(`:2`·`:23`). 분류 구분 없이 **전부** 센다(`cnt[a,0]`). |
| 개수 표 | 저장소에 **없다**. 분석 결과 `spots_features.csv` 는 세션 임시 폴더에만 있다(`find /` 로 확인 — 저장소 밖) |
| 재현 | **[실측]** 위 규칙을 위경도 국소 환산(km)으로 다시 세었더니 0곳/1~2/3~5/6+ = **222 / 397 / 505 / 230** — 보고서 v3 `report.md:481` 의 「출발안 [222, 397, 505, 230]」과 **같다**. 3km 안에 사망사고 발생구역이 있는 관광지 **583곳**(같은 어림 방식 — 빌드 스크립트 결과와 대조할 기준값 후보) |
| **새로 만들 것** | 빌드 스크립트가 관광지마다 `{count, bucket, fatal, zoneIds[]}` 를 계산해 정적 파일로 둔다(§2.2) |

#### ⑦ 행사 — **없음**
| 항목 | 내용 |
|---|---|
| 있는 것 | `local_server/config/coastal_safety/events/`(2020~2025 과거 조사 `events_2020_2025.csv·.json`·`notes.md`) — 분석용. 현재 행사를 모으는 서비스는 없다(`grep searchFestival2\|KorService2` → `coastal_spots.json` 설명 한 곳) |
| Gemini 웹 검색 선례 | ⚠ 설계서 §7 은 *"지금 코드에는 웹 검색이 없다(grep 확인)"* 고 적었으나, **`routes/assistant.js:1694~1720` `webSearchAnswer` 가 이미 `gemini.callGeminiRaw({ model:'gemini-2.5-flash', config:{ tools:[{googleSearch:{}}] } })` 로 웹 검색을 쓰고, `groundingMetadata.groundingChunks[].web` 에서 출처 링크를 꺼낸다.** 설계서 문장은 `gemini_client.js` 에 한정하면 맞지만 저장소 전체로는 낡았다. 행사 수집기는 이 선례를 따른다 |
| 공유 위험 | `services/gemini_client.js` 는 키를 모듈 안에서 공유하고 429 쿨다운(70초~3시간, `:28~31`)도 공유한다 — 행사 수집이 429 를 맞으면 같은 키를 쓰는 챗봇·특보 분석(`ai_report_parser.js`)도 멈춘다(§8) |
| 판정 근거(주말) | 분석 `17c_event_ccr.py:35` `wk.append(d.weekday() >= 5)` = **토·일만**, 행사 단위 = **(시군구, 날짜)** (`:20~27`). 보고서 `report.md` §4.5 표 「주말(토·일)」 |
| **새로 만들 것** | 수집기 `services/coastal_events_collector.js` → `data/risk_forecast/events_YYYYMM.json` |

#### ⑧ 너울(파주기)
| 항목 | 내용 |
|---|---|
| 서비스 | `local_server/services/swell_smallzone.js`. 캐시 `{ baseTm, collectedAt, fctTimes:[19개, 3시간 간격], cells:{ "대해구-소": { lvl[], wh[], **wp[]** } } }` (`:58~62`, 채우기 `:197~213`) |
| 12초 판정 필드 | **`wp`(파주기 s)** — 명세 §9 의 「필드명 미확인」은 이것으로 풀린다(`:12~13` 주석 「wp(파주기 s)」, `:209~212`) |
| 갱신 | 1시간마다 생산시각(baseTm)이 바뀌었는지 보고 바뀌면 재수집(`:51`·`:280~283`), 기동 `server.js:513` |
| 제공 | 같은 프로세스 안에서 `require('./swell_smallzone').getCell(key)` (`:353~357`) · HTTP `GET /api/swell-smallzone/cell?key=` (`routes/swell_smallzone.js`) |
| 범위 | 19 × 3시간 ≈ 54시간 → **3일째 일부 공백**(설계서 §2.1) |
| 관광지 → 소해구 | U57 「너울 화면 해안선이 속한 해구」 = `client/coastline_segments.json` **[실측]** 해안 소해구 233개·해안선 조각 1,123개, 조각마다 `z`(소해구 키). 관광지에서 가장 가까운 조각의 `z` 를 쓴다 [설계 판단 — U57 문장을 코드로 옮긴 것] |
| 참고 | 해구 예보 ②에도 `wp`(WVPRD_MAX, 대해구)가 있으나 U29·U75 는 「앱 너울 자료」를 지목 → 소해구 `wp` 를 쓴다 |

#### ⑨ 이안류(13곳)
| 항목 | 내용 |
|---|---|
| 만드는 곳 | `scheduler.js` `collectRipCurrentIndex` (`:1885`), 저장 `ripcurrent_index.json` (`:1955`), **30분마다**(매시 05·35분, `:2636`) |
| 13곳의 정체 | 해양조사원 10곳 `RIP_BEACHES` (`:1848~1859`) + 기상청 3곳 `KMA_RIP_BEACHES`(강문·안목·신지명사십리, `:2072~2076`) = **13** — 명세 §9 「13곳 목록 위치 미확인」은 이것으로 풀린다 |
| ⚠ 시간축 | **현재 값 하나만** 저장한다: 해양조사원은 최신 관측(`:1898~1915`), 기상청은 「지금에 가장 가까운 예보 시각」 한 건(`_nearestByFctTm` `:2086~2098`, `:2131`). 설계서 §2.1 의 「KMA 예보 16곳 7일」은 **코드에 없다**(3곳·한 시각뿐) |
| 값 | `places[이름] = { code, lat, lot, hasData, level(관심/주의/경계/위험), score, obsrvnDt, … }` (`:1901~1915`, 등급표 `:2069`) |
| API | `GET /api/ripcurrent-index` (`routes/fishing.js:272`), 메모리 `dataCache.ripCurrentIndex` |
| 지금 파일 | **[실측]** 로컬 `ripcurrent_index.json` updatedAt 「2026. 10. 10. 오전 1:44:18」, 13곳 모두 `hasData:false`(운영 기간 6~9월 밖 — `:1868` 주석) |
| 관광지 연결 | **[실측]** 이름이 관광지와 글자까지 같은 곳 6/13(속초·고래불·대천·임랑·송정·해운대). 나머지는 이름이 다르다(「낙산 해수욕장」「강릉 경포해수욕장」「망상해변」「중문·색달 해변」「강문해변」「안목해변», 모두 0.04~0.5km 안). **신지명사십리(완도, 전남)는 관광지 목록에 없다**(가장 가까운 관광지 62km — 전남 공백) |
| **새로 만들 것** | 손 연결표 `config/coastal_safety/rip_spot_map.json`(12곳 연결 + 신지명사십리 「연결 없음」 명시) |

#### ⑩ 강풍 저장소
| 항목 | 내용 |
|---|---|
| 만드는 곳 | `services/gale_warning_store.js` `save()` — 크롤러가 매 주기 부름(`marine_warning_crawler.js:4387~4388`, 실패해도 크롤러 진행) |
| 파일 | `data/gale_warnings.json` = `{ savedAt, count, rows:[{ src, live, zoneCd, zoneNm, lvl, tmFc, tmEf, tmEd, clrNtcTm }] }` (`:57~67`·`:103`) + 기록 `gale_warnings_log.jsonl` |
| 시각 꼴 | 원시 MMIS 글자 그대로(`tm_ef || st_tm`) — ①의 정규화 꼴이 **아니다** |
| API | **없다** — `grep -rn "gale" local_server/routes/` 0건. 파일 머리 주석도 「읽는 곳: (구현 예정)」 |
| 육상 해안 구역 | `client/assets/warn_zones_land_coastal.geojson` **[실측]** 109개, 속성 `name`(예 「안산」)·`parents` — **코드 칸 없음**. 정적 경로 `/assets/warn_zones_land_coastal.geojson`(`accident_info.js:3239` 가 이 경로로 받음) |
| ⚠ 미실측 | 강풍(W)이 MMIS 에 실제로 오는지, `zoneNm` 이 109곳 이름과 맞는지 **[미확인]**(설계서 M10 — 다음 강풍특보 때 확인). 그래서 화면은 **맞춰진 행만** 쓰고, 못 맞춘 행은 상태 API 에 숫자로 드러낸다(§8.3) |

#### ⑪ 해구 번호·소해구
| 항목 | 내용 |
|---|---|
| 대해구 폴리곤 | `client/marine_zone_area.json` **[실측]** 1,331개, 속성 `marine_zone_no` |
| 점 → 소해구 | `services/vsby_smallzone.js` `pointToCellKey(lat, lon)` (`:128~140`) — 대해구 외곽 상자를 3×3 으로 나누고 번호 = 행×3+열+1(북서 1 → 남동 9). `pointToMajorNo` (`:143`), `smallZoneCenter` (`:95`) 모두 export(`:446~465`) |
| 격자 칸 → 대표 소해구 | **표가 없다.** U65 의 「7,574칸·걸침 1,420칸·최소 44%」는 세션 실측 기록뿐 |
| **새로 만들 것** | 칸 위치표를 만들 때 칸 상자(중심 ±0.0125°)와 소해구 상자의 겹친 넓이로 대표를 고른다(§3.3) |

#### ⑫ 주요지명
| 항목 | 내용 |
|---|---|
| 위치 | `client/tide.js:201` `const TIDE_REFERENCE_STATIONS = [...]` **[실측]** 165개(DT 62 · SO 101 · IE 2), `{code, name, lat, lon}` |
| ⚠ | 브라우저 전역 상수다. 서버에 복사본이 없다 |
| **새로 만들 것** | 빌드 스크립트가 `tide.js` 글자에서 배열을 꺼내 칸마다 「가장 가까운 지명·방위각·거리」를 미리 계산한다. **복사본을 따로 두지 않는다**(_RULES §2 「규칙은 한 곳에만」). 검사가 165개인지 확인 |

#### ⑬ 파출소 관할
| 항목 | 내용 |
|---|---|
| 파일 | `config/coastal_safety/coastguard_stations.geojson` **[실측]** 97개(Polygon 88 · MultiPolygon 9), 속성 `name`(「영흥파출소」)·`station`·`address`·`area_lines_raw`(마지막 줄 「점을 연결한 내측해역」 — **바다 쪽 관할 폴리곤**) |
| 관광지 포함 여부 | **[실측]**(shapely, 위경도 국소 km 환산) 관광지 1,354곳 중 **809곳**이 어느 파출소 폴리곤 안(그중 2곳은 두 폴리곤에 겹침), **545곳**은 밖. 밖인 곳의 가장 가까운 폴리곤까지: 1km 이하 246 · 1~3km 173 · 3~10km 101 · **10km 넘음 25**(울릉 「천장굴」·「독도」 약 81km, 김포·김제 내륙 시설 12~18km 등) |
| 위험구역 쪽 | 위험구역 GeoJSON 의 `관할파출소` 필드(예 「감천」)는 **그 구역**의 관할이다 — 아코디언(R4-37)에 그대로 쓴다 |
| **새로 만들 것** | 관광지 → 파출소 판정 규칙(K-20) + 빌드 때 미리 계산 |

#### ⑭ 해수욕장 여부
- 규칙 U56: 관광지 이름에 「해수욕장·해변·비치」가 든 곳. **[실측]** 정규식 `해수욕장|해변|비치` 로 세면 **313곳** — 설계서 숫자와 같다. 빌드 때 `beach:true` 로 표시한다.

#### 그 밖에 쓰는 것
| 자료 | 위치·확인 |
|---|---|
| 해안선(격자 자르기) | `client/land_mask_korea.json` **[실측]** 고리 1,873개(`{rings}`), `GET /api/ocean/land-mask` (`routes/ocean1.js:549`) |
| 섬 테두리 | `config/coastal_safety/island_outlines.geojson` **[실측]** 21개 |
| 산출 근거 PDF | `config/coastal_safety/accident_analysis/v3/public/해상_위험지수_산출근거.pdf`(1,692,140 B) · `연안_위험지수_산출근거.pdf`(2,023,759 B) **[실측 ls]** |
| 충돌·접촉 배수 원문 | `…/v3/public/해상_위험지수_산출근거.md:263~310` (5.1·5.2 표) — K-13 근거 |

### 1.3 근거 문서와 코드가 다른 곳 (구현 전에 알아 둘 것)
| # | 문서 서술 | 코드·실측 | 처리 |
|---|---|---|---|
| D-1 | 설계서 §7 「지금 코드에는 웹 검색이 없다」 | `routes/assistant.js:1700` 이 이미 `googleSearch` 사용 | 이 선례를 따른다 |
| D-2 | 명세 §9 너울 「12초 판정 필드명 미확인」 | `wp` (`swell_smallzone.js:209~212`) | 풀림 |
| D-3 | 명세 §9 이안류 「13곳 목록 위치 미확인」·설계서 「KMA 예보 16곳 7일」 | 10 + 3 = 13곳, **현재 값 하나만** 저장 | 미래 시각 적용은 K-24 |
| D-4 | `scheduler.js:265` 주석 「12자리」 | `getUtcTm` 은 10자리 반환 | 해석기는 10자리로 |
| D-5 | 명세 §7.2 「내일 예보만 특보급」 점수 0.706 | log₂(1.63) = **0.7049** **[실측 node]**. 지수는 둘 다 23 | 0.7049 를 쓴다(지수 동일) |
| D-6 | `points_v31.md` 에 「이틀 전 예보 1.63」 행이 없다(사흘 전 0.63·1.07·1.84 만) | 1.63 의 원문은 `report.md` §12.4 표 「선박 기상민감 4종 · 파고≥2 또는 풍속≥12 · 이틀 전 예보 1.63 (1.36–1.96) [574]」 | 상수 모듈 주석에 출처를 이 줄로 단다 |

---

## 2. 구조

### 2.1 코드의 자리 (배치 결정 트리)
| 물음(DEVELOPMENT_GUIDE §1) | 답 |
|---|---|
| Q3 4개 탭 중 하나의 화면 기능? | **예** — 해양안전생활 탭 > 해양안전 탭(R1-1). 이 탭의 폴더는 `client/js/marine-life/` (ARCHITECTURE §3 「marine-life ← [탭3] 해양생활」, 같은 탭 오버레이 `marine-life/safety/*.js`) |
| Q5 서버 코드? | `local_server/routes/` · `local_server/services/` (services 는 지금 하위 폴더 없이 평평하다 — 같은 꼴로) |

- **화면 코드 폴더 = `client/js/marine-life/risk-forecast/`** (새 기능 폴더, 영문 소문자+하이픈 — DEVELOPMENT_GUIDE §2).
- ⚠ 그런데 근거 문서 셋(설계서·명세·이 설계서)과 시안은 `client/js/ocean-map/coastal-risk/`(탭2 「해양종합정보」 폴더)에 있다. 트리대로면 코드와 문서가 갈라진다 → §6 N8 에서 사용자에게 묻는다. **권장**: 코드는 트리대로 `marine-life/risk-forecast/`, 새 폴더 `README.md` 에 문서 위치를 링크(문서 이동은 별도 작업).

### 2.2 파일 목록

#### 서버 (오퍼스)
| 경로 | 역할(한 줄) | 성격 |
|---|---|---|
| `local_server/services/risk_points.js` | 점수표 상수(v3.1 + 이틀 전 예보 1.63 + 충돌·접촉) · 지수 환산 · 단계 말. **숫자의 유일한 자리**(K-21) | 순수 함수 |
| `local_server/services/risk_time.js` | KST 시각·「오늘/내일/모레」·슬라이더 시간축 · 예비 범위 `{시작,끝}` 해석 · 가장 가까운 3시간 값 | 순수 함수 |
| `local_server/services/risk_geo.js` | 점-다각형(홀 포함) · 하버사인 거리 · 방위각·방위 낱말 · 상자 겹친 넓이 | 순수 함수(외부 라이브러리 없음) |
| `local_server/services/sea_traffic_collector.js` | 해양교통 혼잡도 수집(하루 1회) → `data/risk_forecast/sea_traffic.json.gz` · 칸 위치표 갱신 | 외부 호출 |
| `local_server/services/risk_sea_cells.js` | 칸 위치표 `data/risk_forecast/sea_cells.json` — 새 칸이 오면 대해구·대표 소해구·주요지명·특보구역·육지 여부를 계산해 덧붙임 | 파일 쓰기(자기 파일만) |
| `local_server/services/tour_concentration_collector.js` | 관광지 집중률 수집(하루 1회) → `data/risk_forecast/tour_concentration.json` | 외부 호출 |
| `local_server/services/coastal_events_collector.js` | 행사 수집(매월 말일 3일 전, U33) → `data/risk_forecast/events_YYYYMM.json` | 외부 호출(관광공사 + Gemini) |
| `local_server/services/risk_score.js` | 점수 엔진 — 입력 묶음을 받아 칸·관광지별 점수와 요소 목록을 낸다 | 순수 함수(입력은 인자로) |
| `local_server/services/risk_store.js` | 입력 모으기(dataCache·새 저장 파일·swell 캐시) + 프레임 미리 계산·메모리 보관 + 자료 상태(신선도) | 읽기 전용 + 메모리 |
| `local_server/routes/risk_forecast.js` | `/api/risk-forecast/*` (§4) + PDF 전송 | 라우터 |
| `local_server/scripts/build_risk_static.js` | 정적 표 빌드 → `config/coastal_safety/risk_spots.json` (관광지별 ID·해수욕장·위험구역 개수·사망사고구역·특보구역·강풍구역·해안 소해구·파출소·이안류 연결·3km 원 분할 다각형) | 개발 때 1회 실행(배포에 실리는 결과 파일만) |
| `local_server/config/coastal_safety/rip_spot_map.json` | 이안류 13곳 → 관광지 ID (손 연결표) | 정적 |
| `local_server/server.js` (**수정**) | 라우트 1줄 + 기동 블록에 수집기 3개 시작(각각 try/catch) | 기존 파일 — §8.1 |

#### 화면 (소넷) — `client/js/marine-life/risk-forecast/` (N8 결정 전 기준)
| 경로 | 역할(한 줄) |
|---|---|
| `risk_format.js` | 숫자 글자 규칙: `fmt`·`amt`·`tone`·`col`(그라데이션)·`ink`(상자 글자색)·말풍선 일시 꼴 — 시안 함수를 그대로 옮김 |
| `risk_api.js` | `/api/risk-forecast/*` 부르기 · 메모리 캐시 · 실패 상태 보관 |
| `risk_map_layer.js` | OpenLayers 층: 해상 칸(색·점·격자선) · 연안 원(분할 다각형) · 특보 테두리 · 3일째 점선 · 위험구역 폴리곤 · 선택 표시 · 해안선 자르기 · 클릭 판정 `window._riskForecastTryHandleClick(map, evt)` |
| `risk_slider.js` | 시트 안 시간 슬라이더 + 말풍선(앱 CSS 클래스 `.ocean-sheet-slider*`·`.ocean-sheet-tooltip` 재사용, 동작 로직은 새로 — §5.4) |
| `risk_sheet.js` | 바텀시트 렌더러(해상·연안), 위험지수 상자, 요소 줄, 안내 문구, 위험구역 아코디언, 자료 없음 표시 |
| `risk_basis.js` | [기준 상세] 창(해상 §12.1 확정 문안 · 연안 시안 문안) + PDF 버튼 |
| `risk_forecast.js` | 진입점 `window.RiskForecast.mount({ map, sheetEl, legendEl, switchEl })` — 스위치 두 개·상태·다른 모듈 조율 |
| `risk_forecast.css` | 이 기능 전용 CSS(시트·상자·줄·창·범례). `.banzone-legend` 스위치 값은 **사본을 만들지 않고** 클래스 이름을 그대로 쓴다(§5.1) |
| `README.md` · `risk_forecast.guide.md` | 폴더 개요(코드 여러 개 → README + guide, DEVELOPMENT_GUIDE §2) |
| `client/risk_forecast_preview.html` | **미리보기 페이지**(§2.7) |

#### 검사 (각 단계 담당 모델) — 전부 `local_server/scripts/test_*.js`, 끝줄 `N PASS / M FAIL`, **만든 즉시 `verify_all.sh` `SUITES` 에 등록**(CLAUDE.md 결정로그 2026-08-09)
| 스위트 | 무엇을 고정하나 |
|---|---|
| `test_risk_points` | 상수가 `points_v31.md` 표·`report.md` §12.4·공개판 5.1/5.2 표와 같은가(문서를 읽어 대조 — 숫자를 검사 안에 다시 쓰지 않음), 지수·단계 말·반올림 경계 |
| `test_risk_time` | 예비 범위 해석 — **크롤러가 export 하는 `normalizeMmisTime` 으로 만든 글자를 다시 풀어** 같은 시각이 나오는가(두 자가 갈리지 않게), 자정 넘김, 「22일」(월 없음) 월 넘김, 가장 가까운 3시간 값 |
| `test_risk_static` | 빌드 결과: 1,354곳 · 해수욕장 313 · 위험구역 구간 222/397/505/230(보고서 `:481`) · 이안류 연결 12+1 · 주요지명 165 · 원 분할 다각형이 서로 안 겹침 |
| `test_risk_score_sea` | §3.4 표의 시나리오 전부(행 하나 = 검사 하나) |
| `test_risk_score_coast` | §3.5 표의 시나리오 전부 |
| `test_risk_collectors` | 새 수집기 3개가 **푸시 모듈을 부르지 않음**(require 목록 검사 — `test_gale_store.js:95` 선례), 자기 파일 밖에 쓰지 않음, 호출 상한, 실패 시 직전 파일 유지 |
| `test_risk_api` | 고정 입력(fixture)으로 라우트 응답 모양·필드·상태 블록 |
| `test_risk_format` | 화면 `risk_format.js` 를 `vm` 으로 읽어(`test_accident_sheet.js` 선례) `fmt`·`amt`·`tone`·`col`·`ink` 값 고정 — 빨강 상자 글자 흰색(R4-10) 포함 |
| `test_risk_preview` | 미리보기 페이지의 `.banzone-legend` 사본 블록이 `index2.html:1047~1120` 원본과 글자까지 같은가 · `index2.html` 에 위험예측 흔적이 **없는가**(연결 금지 지킴) |

### 2.3 로드 순서 (미리보기 페이지 — `index2.html` 은 건드리지 않음)
```
/assets/vendor/ol/ol.css · /style.css · js/marine-life/risk-forecast/risk_forecast.css
/assets/vendor/ol/ol.js
js/ocean-map/map/ocean_map.js        ← 배경지도 함수(window.oceanCreateKhoaLayer·oceanCreateVworldLayer)만 빌려 씀 (admin_zone_editor.html:144 선례)
js/marine-life/risk-forecast/risk_format.js
js/marine-life/risk-forecast/risk_api.js
js/marine-life/risk-forecast/risk_map_layer.js
js/marine-life/risk-forecast/risk_slider.js
js/marine-life/risk-forecast/risk_sheet.js
js/marine-life/risk-forecast/risk_basis.js
js/marine-life/risk-forecast/risk_forecast.js   ← 마지막. 페이지 끝 인라인 스크립트가 지도를 만들고 mount() 호출
```
- 각 파일 헤더 `[로드 순서]` 에 위 앞뒤를 적는다. 연결 단계에서 `index2.html` 에 넣을 자리는 그때 정한다(`life_safety.js` 앞 — 같은 탭 오버레이들이 `life_safety.js` 바로 앞에 모여 있음, `accident_info.js:40` 「navigational_warning.js 다음 · life_safety.js 바로 앞」).

### 2.4 데이터 흐름
```
[외부]                      [수집 — 서버 프로세스 안]                         [저장]
MMIS 특보 ──(1분, 기존)──> marine_warning_crawler.js ─────────────────> data/weather_alerts.json   (풍랑·태풍)
                                       └─(기존) gale_warning_store.save ─> data/gale_warnings.json    (강풍, 푸시 없음)
API허브 해구예보 ─(09:30·21:30, 기존)─> scheduler.collectZoneForecasts ─> data/zone_forecasts.json
MMIS 너울 WFS ─(1시간 폴링, 기존)──> services/swell_smallzone.js ──────> 메모리 + data/swell_smallzone.json.gz
KHOA·KMA 이안류 ─(30분, 기존)──> scheduler.collectRipCurrentIndex ───> data/ripcurrent_index.json
공단 혼잡도 ─(하루 1회 05:10, 신설)─> services/sea_traffic_collector.js ─> data/risk_forecast/sea_traffic.json.gz
                                                              └────> data/risk_forecast/sea_cells.json (칸 위치표, 늘어나기만)
관광공사 집중률 ─(하루 1회, 신설)─> services/tour_concentration_collector.js ─> data/risk_forecast/tour_concentration.json
관광공사 행사 + Gemini ─(매월 말일 3일 전, 신설)─> coastal_events_collector.js ─> data/risk_forecast/events_YYYYMM.json
(개발 때 1회) build_risk_static.js ──────────────────────────────────> config/coastal_safety/risk_spots.json

                     [점수 — 서버]
risk_store.js : 위 파일·메모리를 **읽기만** 해서 입력 묶음 구성 ─> risk_score.js (순수 함수)
             : 입력 중 하나라도 바뀌면(파일 mtime·baseTm) 30초 뒤 전체 프레임 재계산(해상 ≤48시각 × 칸, 연안 ≤24시각 × 1,354곳)
             : 결과를 메모리에 보관 + 자료 상태(신선도) 기록

                     [API]                                       [화면 — 미리보기 페이지]
routes/risk_forecast.js ── /meta · /sea/cells · /sea/frame · /sea/cell ──> risk_api.js ─> risk_map_layer.js (지도)
                        ── /coast/spots · /coast/frame · /coast/spot            └──────> risk_sheet.js (시트: 숫자를 문구 틀에 채움)
                        ── /hazard-zones · /report/:kind · /status                       risk_slider.js · risk_basis.js
```

### 2.5 점수를 어디서 계산하나 — **서버**
| 근거 | 내용 |
|---|---|
| 입력이 서버에만 있다 | 해구 예보 전체 약 5.86MB(코드 주석 `weather.js:819`), 혼잡도 48시각 원본 약 75MB·압축 저장 0.45MB(설계서 §4.3 어림). 화면이 이것을 다 받을 수 없다 |
| 같은 함수를 여러 곳이 쓴다 | 검사(_RULES §2 「검사는 제품이 쓰는 그 함수를 부른다」, L-136) · 나중의 브리핑(설계서 §11.3 「서버가 하루 한 번 관할별로」 — 같은 점수가 필요) |
| 모든 사용자에게 같은 답 | 휴대폰 시계·지역 설정이 달라도 KST 하루 경계·주말 판정이 같다 |
| 화면이 맡는 것 | **글자 꼴만** — 배수를 「+68%」「약 4.5배」로, 점수를 색으로, 문장 틀에 값 채우기(U66 「AI 없이 계산과 틀로」). 숫자 판정(어느 요소가 반영됐나, 지수, 단계 말)은 서버가 정해 보낸다 — 화면이 다시 계산하지 않는다(두 자가 갈리지 않게) |

### 2.6 캐시와 갱신 시각
| 자료 | 갱신 | 서버 보관 | HTTP 캐시 |
|---|---|---|---|
| 특보(풍랑·태풍) | 1분(기존) | `dataCache.warnings` 5초 mtime 확인(기존) | — |
| 강풍 | 1분(기존, 바뀔 때만 씀) | `risk_store` 가 30초마다 mtime 확인 | — |
| 해구 예보 | 09:30·21:30 KST(기존) | `dataCache.zoneForecasts`(기존) | — |
| 너울 | 1시간 폴링(기존) | swell 모듈 메모리(기존) — `getStatus().baseTm` 로 변화 감지 | — |
| 이안류 | 30분(기존) | `dataCache.ripCurrentIndex`(기존) | — |
| 혼잡도 | **05:10 KST 하루 1회**(신설). 공단 예보 생성 03:56~03:57(설계서 §2.1) 뒤 여유. 실패 시 06:10·07:10 재시도, 하루 호출 상한 90건 | 파일 + 메모리 | — |
| 집중률 | **하루 1회**(신설). 관광공사 갱신 시각 **[미확인]**(매뉴얼상 「일 1회」만) → 첫 주는 하루 두 번(06:20·12:20) 받아 바뀌는 시각을 기록해 정한다 | 파일 + 메모리 | — |
| 행사 | 매월 (말일−3)일 03:20 KST(U33) + 기동 때 이번 달 파일이 없으면 1회 | 파일 | — |
| 정적 표(관광지·원 분할) | 빌드 때 | 메모리 | `max-age=86400` + `?v=<표 해시>` |
| 칸 위치표 | 혼잡도 수집 때 새 칸만 덧붙임 | 파일 + 메모리 | `max-age=3600` + `?v=<칸 수>` |
| 프레임(지도) | 입력 변화 30초 뒤 전체 재계산 | 메모리 | `max-age=60` |
| 상세(시트) | 프레임에서 바로 | 메모리 | `max-age=60` |
| 상태 | 요청마다 | — | `no-store` |
| PDF | 파일 그대로 | — | `max-age=86400` |

### 2.7 띄워 보는 방법 — 미리보기 페이지
- **선례**: `client/admin_zone_editor.html` — `index2.html` 밖의 독립 페이지가 `/assets/vendor/ol/ol.js` 와 `js/ocean-map/map/ocean_map.js` 를 직접 불러 자기 지도를 만든다(`:24~26`, `:144~145`, `admin_zone_editor.js:840~858`). 정적 루트가 `client/` 라(`server.js:216`·`:227`) `client/risk_forecast_preview.html` 은 `/risk_forecast_preview.html` 로 열린다.
- 다른 선례 `client/assistant_overlay_preview.html` 은 스타일을 복사한 **가짜 화면**이라 실제 모듈을 안 쓴다 — 이번 목적(실제 코드를 띄워 보기)에 안 맞는다.
- 페이지 구성: 폰 폭 틀(최대 430px) 안에 지도(위) + 바텀시트(아래, 늘 열린 상태로 보이되 처음엔 「지도에서 칸이나 관광지를 누르세요」) — 시안 판 23 의 배치를 따른다. 위험예측 버튼은 「버튼이 켜진 상태」를 흉내 낸 고정 표시로만 둔다(실제 오버레이 줄은 연결 단계).
- 고정 입력 모드: `?fixture=1` 이면 서버 대신 `local_server/scripts/fixtures/risk_forecast/*.json` 과 같은 내용을 쓰는 가짜 응답(서버 라우트 `GET /api/risk-forecast/*?fixture=1` 이 그 파일을 돌려줌, **운영에서는 끔** — `process.env.FLY_ALLOC_ID` 가 있으면 무시). 소넷이 서버 완성 전에 화면을 만들 수 있게 하려는 것.
- 주의: 이 페이지는 링크가 없지만 **주소를 알면 누구나 열 수 있다**(정적 루트). `<meta name="robots" content="noindex">` 를 넣는다. 사용자 노출이 문제면 §6 N8 과 함께 묻는다.

---

## 3. 점수 계산 명세

### 3.1 공통
| 항목 | 규칙 | 근거 |
|---|---|---|
| 점수 | 요소별 점수 = 표의 「점수」값(대부분 log₂ 배수를 소수 둘째 자리로 적은 값) | U18 · `points_v31.md` |
| 지수 | `index = Math.round( min(3, max(0, S)) / 3 × 100 )` — 0~100 정수. `Math.round` 는 .5 를 올린다(음수는 0 으로 막은 뒤라 문제 없음) | R4-6 |
| 단계 말 | **화면 지수**로: `<33` 평소 수준 · `<67` 다소 높음 · `<100` 높음 · `=100` 매우 높음 | R6-8 · R6-9 |
| 색 | 점수(0~3 으로 막은 값)의 연속 그라데이션 — 화면이 계산(`col`) | R6-13~15 |
| 배수 글자 | 화면이 계산(`fmt`·`amt`) — 서버는 **배수 숫자**를 보낸다 | R6-1~4 |
| 시각 | 모든 판정은 **KST**. 「오늘」= 서버 현재 KST 날짜, 「내일」= +1, 「모레」= +2 | CLAUDE.md 시간 표기 |

**예시 검산 [실측 node]**: 주의보 0.75 → 25 · 경보 2.16 → 72 · 풍속14 2.09 → 70 · 17m/s 3.39 → 100 · 4m 3.86 → 100 · log₂(1.63)=0.7049 → 23.

### 3.2 시간 매칭
| 화면 | 슬라이더 칸 | 각 입력을 그 칸에 붙이는 법 |
|---|---|---|
| **해상** | 1시간 간격, 오늘·내일(U52) | 특보: 그 시각의 상태(§3.4.2) · 파고·풍속: 그 대해구의 **가장 가까운 3시간 예보값**(공개판 5.2 표 자료줄 「사고 시각에 가장 가까운 3시간 값」 — 근거가 같은 방식으로 잼. 정시 단위라 동률 없음: +1시간은 앞 값, +2시간은 뒤 값) · 혼잡도: 그 시각(fcstDate·fcstTime) 값 · 「내일 예보만 특보급」: 그 칸의 **KST 날짜**와 대해구의 그날 하루 최대값(§3.4.3) |
| **연안** | 3시간 간격, 오늘·내일·모레(U1·U52) | 집중률·행사·주말·달: 그 칸의 **KST 날짜** · 너울·바람(떠밀림): 가장 가까운 3시간 예보값 · 이안류: K-24 · 특보 안내: 그 시각의 **자료상 상태**(예비 가정 없음 — §3.5.4) · 3일째 판정: 날짜 기준 하루 최대값 |
| 시간축(서버가 `/meta` 로 줌) | K-9 확정 전 기본값 [설계 판단]: 앱 해양종합정보 규칙(`ocean_sheet_timeline.js:18~34`)과 같게 **0 = 지금(분 그대로)**, 그다음은 정시 격자(해상 1시간·연안 3시간). 끝 = **해상 내일 23:00 · 연안 모레 21:00** | R3-10 |
| 0번 칸의 자료 | 「지금」은 분이 붙어 있으므로 혼잡도는 현재 정시 값, 예보는 가장 가까운 3시간 값 |  |

### 3.3 공간 매칭
| 대상 | 무엇에 붙이나 | 규칙 | 근거 |
|---|---|---|---|
| 해상 칸 → 특보(풍랑·태풍) | 특보구역 부모 44 | **칸 중심이 든 구역**(`geometry` 로 판정 — `_holedGeometry` 아님). 자식 구역(49)이 따로 상태를 가지면 자식 우선 — **자식 상태의 뜻(값이 null 일 때 「부모를 따름」인지 「제외」인지)은 [미확인]** → 단계 1 에서 오퍼스가 크롤러 `_purgeExcludedChildren`·`_buildZoneTreeFromSnapshot` 을 끝까지 읽고 정한다 | 설계서 §3.2 |
| 해상 칸 → 해구 | 대해구 | 칸 상자(중심 ±0.0125°)와 가장 많이 겹치는 대해구(U65 실측상 7,574칸 모두 한 대해구 안) | U65 |
| 해상 칸 → 대표 소해구 | 소해구 | 그 대해구 상자를 3×3 으로 나눈 소해구 중 **겹친 넓이가 가장 큰 것**. 동률이면 번호가 작은 쪽(북서 우선) [설계 판단 — §6 N6] | U64③ · U65 |
| 해상 칸 → 주요지명 | 165곳 | 칸 중심에서 하버사인 거리 최소. 방위각 = 지명 → 칸 중심 초기 방위(진북 0°, 시계방향). 거리 해리 = km ÷ 1.852 | U60 |
| 해상 칸 → 파고·풍속 | 대해구 | 위 대해구의 `zone_forecasts` 시계열 | 설계서 §3.2 |
| 관광지 → 3km 위험구역 | 820 폴리곤 | 점에서 폴리곤까지 거리 **≤ 3,000m**(경계 포함), 분류 상관없이 전부 셈 | `04_geo.py:198` |
| 관광지 → 사망사고 발생구역 | 201 폴리곤 | 위와 같은 거리 안에 「사망사고 발생구역」이 하나라도 | `04_geo.py:200~201` |
| 관광지 → 풍랑·태풍 특보구역 | 부모 44 | 가장 가까운 구역, 거리 **≤ 3km**(포함이면 0km). 3km 안에 없으면 「연결 없음」 | 설계서 §3.2 「사고정보 탭과 같은 규칙」 |
| 관광지 → 강풍 구역 | 육상 해안 109 | 관광지가 **든** 구역. 들지 않으면(바다 위 216곳 등) 가장 가까운 구역 ≤ 3km [설계 판단 — 사고정보 탭 강풍 규칙 `build_accident_warn_flags.js:14~18` 과 같게. 설계서 §3.2 는 「든 구역」만 적음 → §6 N12] | 설계서 §3.2 · 사고정보 탭 |
| 관광지 → 바람(떠밀림)·너울 | 해안 소해구 | 가장 가까운 해안선 조각(`coastline_segments.json`)의 `z` → 너울은 그 소해구 `wp`, 바람은 그 소해구의 대해구 `ws` | U57 |
| 관광지 → 3일째 특보급 | 대해구 | 위 바람용 대해구의 그날 하루 최대 파고·풍속 | U20 · 분석 단위 `32_fcst_leads.py:4~6` |
| 관광지 → 집중률 | 관광지 이름 | 같은 시군구 코드 + 같은 관광지 이름 | 관광지 목록이 이 API 이름에서 옴 |
| 관광지 → 행사 | 시군구 또는 3km | **§6 N3** (분석 단위는 (시군구, 날짜)) | `17c_event_ccr.py:20~27` |
| 관광지 → 이안류 | 13곳 | 손 연결표 `rip_spot_map.json` | ⑨ |
| 관광지 → 파출소 | 97 폴리곤 | **K-20** | ⑬ |
| 3km 원 겹침 | 관광지끼리 | 원을 **이웃 관광지와의 수직이등분선**으로 잘라 「가장 가까운 관광지 몫」으로 나눈다(볼록 다각형 반평면 자르기, 24각형). 빌드 때 계산해 `risk_spots.json` 에 넣는다 | U16 · R2-8 |

### 3.4 해상 점수

#### 3.4.1 입력 (칸 c, 시각 t)
| 입력 | 값 | 출처 |
|---|---|---|
| `ci` | 혼잡지수(0.1~100) — 그 시각 응답에 칸이 없으면 「칸 없음」 | ③ |
| `warn` | 그 시각의 특보 상태: `{ type:풍랑|태풍, level:주의보|경보, state:발효|예비가정|예비(가정 전), from }` 또는 없음 | ① + §3.4.2 |
| `wh`·`ws` | 대해구의 가장 가까운 3시간 파고·풍속 | ② |
| `dayMax` | 대해구의 그 KST 날짜 하루 최대 `wh`·`ws` | ② |

#### 3.4.2 특보 상태를 시각 t 에서 정하는 법
| 자료상 상태(지금) | 시각 t 에서 | 근거 |
|---|---|---|
| 발효 중(`current`, 주의보·경보) | 발효. 끝은 **§6 N2**(해제예고가 있으면 그 범위 끝까지 / 없으면 슬라이더 끝까지 — 권장안) | U64② |
| 예비(`upcoming`), 범위 `[s, e)` | `t < s` → **예비(가정 전)**: 점수 없음, 테두리 노랑 · `t ≥ s` → **예비 가정**: 그 특보가 발효된 것으로 계산. 가정은 슬라이더 끝까지 유지(U31 「해제 또는 실제 특보로 바뀔 때까지」 — 미래 시각에서는 둘 다 알 수 없음) | U21 · U31 · R7-7 |
| 예비의 단계 | `wrnLvl`(=실제 단계)이 주의보/경보면 그것, 「예비」로만 오면 **주의보로 가정** [설계 판단 — 시안 `cellState` 의 「예비 → 주의보 0.75」와 같음, §6 N6] | ① 표 · 시안 |
| 예비 정확 시각(범위 아님) | `s` = 그 시각 | `normalizeMmisTime` ③ |
| 발효 + 예비 공존(격상 예고) | 시각마다 높은 쪽 | U64② 「발효 중인 것 기준」은 테두리 색 |

#### 3.4.3 후보 점수 — **가장 높은 하나만**(겹쳐 세지 않음, 더하지 않음)
| 후보 | 조건(모두 `≥` = 경계 포함) | 점수 | 배수(표) | 충돌·접촉 배수(K-13) |
|---|---|---|---|---|
| `warn_adv` | 특보(발효 또는 예비 가정) 주의보 | 0.75 | 1.68 | 0.40 |
| `warn_wrn` | 특보 경보 | 2.16 | 4.46 | 0.70 |
| `wind14` | 특보 중 `14 ≤ ws < 17` | 2.09 | 4.27 | 0.41 |
| `wind17` | 특보 중 `ws ≥ 17` | 3.39 | 10.46 | **추정 보류**(3건) → §6 N13 |
| `wave4m` | 특보 중 `wh ≥ 4.0` | 3.86 | 14.55 | 0.89 |
| `fcst_only` | 그 시각에 특보(발효·예비 가정) **없음** + t 의 KST 날짜 = **내일** + `dayMax.wh ≥ 2` 또는 `dayMax.ws ≥ 12` | 0.7049 | 1.63 | 0.59 |
| (없음) | 위에 하나도 안 걸림 | 0 | 1 | 1 |

- `S = max(후보 점수, 0)`. **상자 배수 = 고른 후보의 「표」 배수**(2^S 가 아님 — 2^2.16 = 4.469 와 표 4.46 이 시트에서 엇갈리지 않게) [설계 판단].
- 동점이면 **위쪽 줄**(줄 순서 혼잡 → 특보 → 파고 → 풍속)의 후보에 「위험지수에 반영」 꼬리표(R4-20).
- 예비 가정 중에도 「특보 중」 조건(`wind14`·`wind17`·`wave4m`)을 적용한다 [설계 판단 — [기준 상세] 표 「발효 예정 범위가 시작되는 시각부터 그 특보로 계산」을 「그 특보가 있는 것으로 본다」로 읽음 → §6 N12].
- 「내일 예보만 특보급」을 **오늘** 시각에 쓸지는 §6 K-14. 기본값은 쓰지 않음(U74② 문구 「내일 예보만」).
- 근거 출처: 0.75·2.16·2.09·3.39·3.86 = `points_v31.md` 해상 행 · 1.63 = `report.md` §12.4 · 충돌·접촉 = 공개판 `해상_위험지수_산출근거.md:263~310`, 0.59 = `report.md` §12.4 「선박 충돌·접촉 · 파고≥2 또는 풍속≥12 · 이틀 전 0.59」.

#### 3.4.4 출력과 표시 판정
| 출력 | 규칙 |
|---|---|
| `score` | S |
| `index`·`band` | §3.1 |
| `rr` | 고른 후보의 표 배수(없으면 1 → 화면 「평소 수준」) |
| `ciLevel` | `ci < 1` 0(낮음) · `< 10` 1(보통) · `< 20` 2(높음) · 그 이상 3(매우높음) — 경계 **아래쪽 포함**(1 은 보통) | R2-12 · 시안 `ciLevel` |
| `clickable` | `S > 0` 또는 `ciLevel ≥ 1` (R2-26) |
| 지도에 그림 | 그 시각 응답에 칸이 있을 때만(U42). 단 혼잡도 수집이 **실패**해 그 시각 자료가 통째로 없으면 칸 위치표 전체로 날씨 색만 그리고 「배 혼잡도 자료 없음」을 드러낸다 [설계 판단 — §6 N13, §8.3] |
| 주말·달·너울·충돌 | 점수에 넣지 않음(R7-4) |

#### 3.4.5 해상 예시 (검산용, 지어낸 칸)
| # | 입력 | 결과 |
|---|---|---|
| S1 | 특보 없음, 오늘, ci 0.4 | S 0 · ciLevel 0 → **눌리지 않음, 색·점 없음** |
| S2 | 특보 없음, 오늘, ci 12 | S 0 → 지수 0 「평소 수준」, 혼잡 줄 「지수 12.0 (높음)」, 파고·풍속 줄 값만 |
| S3 | 풍랑주의보 발효, wh 2.6, ws 13 | `warn_adv` 0.75 → 지수 **25 「평소 수준」**, 상자 「+68%」, 충돌·접촉 「60% 낮음」 (※ 단계 말이 「평소 수준」으로 나오는 것은 규칙 그대로의 결과 — §6 관찰 O-1) |
| S4 | 풍랑경보, wh 4.4, ws 18 | 후보 2.16·3.86·3.39 → `wave4m` **3.86 → 100 「매우 높음」**, 상자 「약 15배」, 꼬리표는 파고 줄, 충돌·접촉 「11% 낮음」 |
| S5 | 예비 「내일 밤(21시~24시)」, 내일 20:00 | 예비(가정 전) → S 0, 테두리 노랑, 특보 줄 「예비 풍랑주의보」 점수 없음 (줄을 보일지 → R4-19 는 「특보가 없으면 줄 없음」; 예비는 특보로 보아 줄을 보인다, 설명 문구 없음) |
| S6 | 같은 예비, 내일 21:00 | 예비 가정 → 0.75 → 25, 특보 줄 설명 「예비 풍랑주의보(21시부터 특보로 가정) 발효 시 평소 대비 68% 높은 사고 발생 가능성」 |
| S7 | 특보 없음, 내일 15:00, 그 대해구 내일 하루 최대 wh 2.3 | `fcst_only` → 0.7049 → **23**, 상자 「+63%」, 충돌·접촉 「41% 낮음」 |
| S8 | 예비 범위 「18~00시」(자정 넘김), 오늘 23:00 | s = 오늘 18:00 → 가정 중 |

### 3.5 연안 점수

#### 3.5.1 요소 (관광지 p, 시각 t, 날짜 d = KST date(t)) — **더한다**
| 요소 | 값 | 점수 | 줄 배수(사고) | 사망·실종 배수(곱에 넣나) |
|---|---|---|---|---|
| 사람 혼잡 | 집중률 `cr`(관광지, d) → 단계 `n`: `cr < 12.5` 0 · `< 25` 1 · `< 50` 2 · 그 이상 3 (경계 포함 방향은 **K-18**, 기본값 = 위쪽 단계에 포함) | `0.97 × n` | `1.96^n` | `1.54^n` (넣음) |
| 위험구역(3km 안) | 개수 k (정적) | k=0 0 · 1~2 0.70 · 3~5 1.24 · 6+ 1.74 | 1 · 1.62 · 2.36 · 3.34 | 1 · 1.18 · 2.12 · 2.25 (넣음) |
| 사망사고 발생구역 | 3km 안 있음(정적) | 0.37 | 1.29 | 1.30 (넣음) |
| 행사 | 그날 연결된 행사가 있음 + d 가 **토·일** | 1.09 | 2.14 | 곱하지 않음(추정 보류) |
| 〃 | 그날 행사가 있음 + 평일 | 0 (줄은 보임) | — | — |
| 달 | d 의 월 → 표(§7.3 명세 · `points_v31.md`) 1월 −0.78 … 8월 +0.66 | 표 점수 | 표 배수 | 표 사망 배수 (넣음) |
| 너울 | 소해구 `wp ≥ 12`초(가장 가까운 3시간 값) | 0.3 (정책값) | 화면 문구용 분석 1.25 | 곱하지 않음 |
| 이안류 | 연결된 지점 단계 ∈ {주의, 경계, 위험} | 0.3 (정책값) | — | 곱하지 않음 |
| 〃 | 단계 「관심」 | 0 (줄은 보임 — K-24) | — | — |
| 특보 | — | **넣지 않음**(U24) — 안내 문구만 | — | — |

- `S = Σ 점수`(음수 가능). `index`·`band` 는 §3.1(0 으로 막음). **상자 배수 `rr = 2^S`**(U23·R4-29 — 연안은 표 배수가 아니라 합계에서). 사망·실종 `fatalRr = 1.54^n × 위험구역 사망배수 × (사망사고구역 ? 1.30 : 1) × 달 사망배수`.
- 값이 없는 요소(집중률 없음·너울 범위 밖 등)는 **§6 N4** — 기본값 [설계 판단]: 점수 0 으로 더하되 줄에 「자료 없음」을 보이고 상자 아래에 「일부 요소 자료 없음」 한 줄(조용한 0 금지).
- 근거: 모든 숫자 `points_v31.md`(= `report.md` §12.9). 주말 정의 `17c_event_ccr.py:35`. 너울·이안류 정책값 U29·U46.

#### 3.5.2 연안 예시 (검산용 [실측 node])
| # | 입력 | 결과 |
|---|---|---|
| C1 | 8월 토요일, 집중률 31(→2단계), 위험구역 4곳, 사망사고구역 있음, 주말 행사 | S = 1.94 + 1.24 + 0.37 + 1.09 + 0.66 = **5.30** → 지수 100 「매우 높음」, 상자 `2^5.30 = 39.40` → 「약 39배」, 사망·실종 `1.54²×2.12×1.30×1.66 = 10.85` → 「약 11배」 |
| C2 | 1월 평일, 집중률 5(→0단계), 위험구역 0 | S = −0.78 → 지수 0(초록), 상자 `2^−0.78 = 0.582` → 「−42%」, 단계 말 「평소 수준」(R4-29 — 음수 문구가 최종인지는 시안 미시연, 명세도 「미확인」) |
| C3 | 집중률 행 없음(전남은 관광지 자체가 없음 — 그 밖의 누락) | 사람 혼잡 줄 「자료 없음」, 점수 0, 상자 아래 「일부 요소 자료 없음」(N4 기본값) |

#### 3.5.3 문구용 값 (시트가 문장을 조립하는 데 필요한 것)
| 줄 | 서버가 보내는 필드 |
|---|---|
| 사람 혼잡 | `stage`, `cr`(집중률 숫자), `rr`(1.96^n), `fatalRr`(1.54^n) |
| 위험구역 | `count`, `rr`, `fatalRr`, `zones[]`(장소명·장소형태·구역분류·주소·관할파출소·id) |
| 사망사고 발생구역 | `rr` 1.29, `fatalRr` 1.30 |
| 행사 | `name`, `weekend`(bool), `rr`(주말 2.14 · 평일 null), `src`(출처 링크), `dateRange` |
| N월 분석 | `month`, `rr`, `fatalRr` |
| 너울 | `periodS`(wp, 소수 1자리), `analysisRr` 1.25, `policyScore` 0.3 |
| 이안류 | `level`, `obsAt`, `source`(KHOA/KMA) |
| 상자 | `score`, `index`, `band`, `rr`, `fatalRr` |

#### 3.5.4 안내 문구 판정 (상자 아래, 순서 ①특보 ②3일째 ③떠밀림)
| 안내 | 조건 | 보내는 값 |
|---|---|---|
| ① 특보 | 관광지에 연결된 풍랑·태풍 구역(§3.3) + 강풍 구역의 **시각 t 에서 자료상 상태**. 예비는 예비 그대로(연안은 예비 가정 없음 — R7-7 「가정은 해상 점수·해상 시트에만」) | `effective[]`(예 「풍랑주의보」), `prelim[]`, 정렬 순서는 K-15 |
| ② 3일째 | t 가 **모레**(KST) + 관광지 대해구의 그날 하루 최대 `wh ≥ 2` 또는 `ws ≥ 12` | `true` |
| ③ 떠밀림 | `beach` + 그 시각 대해구 `ws ≥ 8` | `windMs`(정수 반올림 `Math.round`) |
- 강풍은 **이름이 맞춰진 행만** 쓴다(⑩ M10). 못 맞춘 행 수는 `/status` 에 드러낸다.

### 3.6 경계값 한눈에 (전부 「이상」= 포함, 아래는 예외)
| 값 | 포함 방향 |
|---|---|
| 파고 4m · 풍속 14·17m/s · 파고 2m·풍속 12m/s(특보급) · 떠밀림 8m/s · 너울 12초 | **이상(≥)** — 근거 표 이름이 「이상」 |
| 풍속 14 구간 | `14 ≤ ws < 17` (표 「14~17」) |
| 혼잡지수 1·10·20 | 아래 경계 포함(`ci < 1` 낮음, 1 은 보통) — 시안 `ciLevel` |
| 집중률 12.5·25·50 | **K-18**(기본값: 위쪽 단계에 포함) |
| 3km | 거리 ≤ 3,000m(포함) — `dwithin` |
| 예비 범위 시작 | `t ≥ s` 부터 가정 |
| 행사 기간 | 시작일·끝날 모두 포함 |
| 지수 단계 | `<33`·`<67`·`<100` |
| 글자색 | `<1.5` 초록 · `<4` 노랑 · `<8` 주황 · 그 이상 빨강 (R6-10) |
| 대해구 상자 | 경도 `≥ min, < max`, 위도 `≥ min, < max` (`pointToCellKey` 와 같음) |

---

## 4. API 설계 — `local_server/routes/risk_forecast.js`

> 모든 응답 JSON, 시각은 KST ISO(`2026-10-10T14:00:00+09:00`). 실패는 `{ ok:false, error, sources }` 와 HTTP 503(자료 준비 전) / 400(인자 잘못) / 404(대상 없음). **빈 성공(`ok:true` + 빈 배열)으로 실패를 감추지 않는다**(§8.3).

### 4.1 목록
| 메서드·경로 | 인자 | 쓰는 곳 |
|---|---|---|
| `GET /api/risk-forecast/meta` | — | 처음 한 번: 시간축·자료 상태·정적 표 버전 |
| `GET /api/risk-forecast/sea/cells` | `v` | 칸 위치표(정적에 가까움) |
| `GET /api/risk-forecast/sea/frame` | `t`(시간축 값 그대로) | 해상 지도 한 시각 |
| `GET /api/risk-forecast/sea/cell` | `id`, `t` | 해상 시트 |
| `GET /api/risk-forecast/coast/spots` | `v` | 관광지 표 + 원 분할 다각형 |
| `GET /api/risk-forecast/coast/frame` | `t` | 연안 지도 한 시각 |
| `GET /api/risk-forecast/coast/spot` | `id`, `t` | 연안 시트 |
| `GET /api/risk-forecast/hazard-zones` | `ids`(쉼표) | 주소 누를 때 폴리곤(R2-23) |
| `GET /api/risk-forecast/report/:kind` | `kind`=`sea`·`coast` | PDF 내려받기(K-16) |
| `GET /api/risk-forecast/status` | — | 자료 신선도(사람·검사용) |

### 4.2 응답 예시

**`/meta`**
```json
{
  "ok": true,
  "now": "2026-10-10T14:37:00+09:00",
  "timeline": {
    "sea":   { "stepH": 1, "times": ["2026-10-10T14:37:00+09:00", "2026-10-10T15:00:00+09:00", "…", "2026-10-11T23:00:00+09:00"] },
    "coast": { "stepH": 3, "times": ["2026-10-10T14:37:00+09:00", "2026-10-10T15:00:00+09:00", "…", "2026-10-12T21:00:00+09:00"],
               "day3From": "2026-10-12T00:00:00+09:00" }
  },
  "versions": { "spots": "a1b2c3", "cells": 7612 },
  "sources": { "…": "§4.2 /status 와 같은 꼴" }
}
```

**`/sea/cells`** — 배열 순서가 칸 번호(프레임이 번호로 가리킴)
```json
{
  "ok": true, "v": 7612, "cellDeg": 0.025,
  "cells": [
    { "i": 0, "id": "GR4_F2I24_L3", "lat": 35.0125, "lon": 129.0375,
      "haegu": { "major": 163, "sub": 6, "label": "163-6" },
      "ref": { "name": "부산", "bearingDeg": 135, "bearingWord": "남동", "distNm": 5.0 } }
  ]
}
```

**`/sea/frame?t=…`**
```json
{
  "ok": true, "t": "2026-10-10T15:00:00+09:00",
  "cells": [[0, 3.86, 12.3], [5, 0, 1.4], [9, 0.75, null]],
  "cellsNote": "[칸번호, 점수, 혼잡지수(그 시각 응답에 없으면 null)] — 응답에 없는 칸은 빠짐",
  "borders": [
    { "zone": "부산앞바다", "color": "wrn", "state": "발효" },
    { "zone": "남해동부안쪽먼바다", "color": "adv", "state": "예비가정", "from": "2026-10-10T15:00:00+09:00" },
    { "zone": "남해동부바깥먼바다", "color": "pre", "state": "예비" }
  ],
  "degraded": ["congestion"]
}
```
- `degraded` = 이 프레임에서 빠진 입력. 화면은 이것이 비어 있지 않으면 경고 줄을 띄운다(§5.3).
- 테두리 `color`: `pre`(예비, 가정 전) · `adv`(주의보, 발효 또는 가정) · `wrn`(경보). 같은 구역에 둘이면 높은 쪽 하나(R2-18).

**`/sea/cell?id=GR4_F2I24_L3&t=…`**
```json
{
  "ok": true, "t": "2026-10-10T15:00:00+09:00",
  "title": { "major": 163, "sub": 6 },
  "subtitle": { "name": "부산", "bearingDeg": 135, "bearingWord": "남동", "distNm": 5.0 },
  "clickable": true,
  "score": 3.86, "index": 100, "band": "매우 높음", "rr": 14.55,
  "rows": [
    { "key": "congestion", "ci": 12.3, "level": 2, "levelName": "높음" },
    { "key": "warning", "type": "풍랑", "level": "경보", "name": "풍랑경보", "state": "발효", "assumedFromHour": null,
      "rr": 4.46, "score": 2.16, "used": false },
    { "key": "wave", "value": 4.4, "cond": "wave4m", "rr": 14.55, "score": 3.86, "used": true },
    { "key": "wind", "value": 18.2, "cond": "wind17", "rr": 10.46, "score": 3.39, "used": false }
  ],
  "kinds": { "sensitive": { "rr": 14.55 }, "collision": { "rr": 0.89, "status": "ok" } },
  "inputs": { "forecastAt": "2026-10-10T15:00:00+09:00", "zoneForecastBase": "2026101000", "congestionCreated": "2026-10-10T03:56:00+09:00" },
  "missing": []
}
```
- `warning.state` ∈ `발효`·`예비가정`·`예비`; 예비 가정이면 `assumedFromHour`(예 21) — 「(21시부터 특보로 가정)」.
- `wave`·`wind` 의 `cond` 가 null 이면 「설명 없이 값만」(R4-19 표). 글자색은 화면이 값으로 정한다(K-11).
- `fcst_only` 가 고른 후보면 `{ "key":"forecastOnly", "dayMaxWh":2.3, "dayMaxWs":11.0, "rr":1.63, "score":0.7049, "used":true }` 줄이 들어간다(표시 위치·문구는 K-14).
- `collision.status` ∈ `ok`·`withheld`(추정 보류, `wind17`)·`none`(평소 수준).
- `clickable:false` 면 `rows` 없이 온다 → 시트 「이 시각에는 날씨 위험도 없고 배도 적은 칸입니다(지도에 색이 없음).」(R2-27).

**`/coast/spots`**
```json
{
  "ok": true, "v": "a1b2c3",
  "spots": [
    { "i": 0, "id": "26350|해운대해수욕장", "name": "해운대해수욕장", "lat": 35.1587, "lon": 129.1604,
      "addr": null, "sggName": "부산광역시 해운대구",
      "police": { "name": "해운대파출소", "rule": "contain" },
      "beach": true,
      "cell": [[129.17, 35.15], "… 분할 다각형 (lon,lat) 24점 내외"] }
  ]
}
```
- `addr` 는 N1 결정 전까지 null → 화면은 `sggName` 으로 대신(부제 「부산광역시 해운대구 · 해운대파출소 관할」).
- `police.rule` ∈ `contain`·`nearest`·`none`(none 이면 부제에서 관할을 뺌 — K-20).

**`/coast/frame?t=…`**
```json
{
  "ok": true, "t": "2026-10-12T15:00:00+09:00", "day": 2,
  "spots": [[0, 5.30], [1, -0.78], [2, null]],
  "spotsNote": "[관광지번호, 합계점수(계산 불가면 null)]",
  "borders": [{ "zone": "부산앞바다", "color": "adv", "state": "발효" }],
  "day3Dashed": ["부산앞바다"],
  "degraded": ["tourConcentration"]
}
```
- `day3Dashed` 의 단위는 §6 N11(기본값: 특보구역).

**`/coast/spot?id=…&t=…`**
```json
{
  "ok": true, "t": "2026-10-11T15:00:00+09:00",
  "title": "해운대해수욕장",
  "subtitle": { "addr": null, "sggName": "부산광역시 해운대구", "police": "해운대파출소" },
  "score": 5.30, "index": 100, "band": "매우 높음", "rr": 39.40, "fatalRr": 10.85,
  "notices": [
    { "key": "warning", "effective": ["풍랑주의보"], "prelim": ["강풍주의보"] },
    { "key": "drift", "windMs": 9 }
  ],
  "rows": [
    { "key": "people", "stage": 2, "cr": 31.0, "rr": 3.8416, "fatalRr": 2.3716, "score": 1.94 },
    { "key": "hazard", "count": 4, "rr": 2.36, "fatalRr": 2.12, "score": 1.24,
      "zones": [{ "id": "해운대-1", "place": "미포항", "shape": "항포구(선착장)", "class": "연안사고 위험구역",
                  "addr": "(인근)대한민국 부산광역시 해운대구 …", "police": "해운대" }] },
    { "key": "fatalZone", "rr": 1.29, "fatalRr": 1.30, "score": 0.37 },
    { "key": "event", "name": "○○ 바다축제", "weekend": true, "rr": 2.14, "score": 1.09, "src": "https://…" },
    { "key": "month", "month": 8, "rr": 1.58, "fatalRr": 1.66, "score": 0.66 },
    { "key": "swell", "periodS": 13.2, "analysisRr": 1.25, "score": 0.3 },
    { "key": "rip", "level": "주의", "obsAt": "2026-08-15 09:00", "score": 0.3 }
  ],
  "missing": []
}
```
- 예시 값은 지어낸 것이다(문서 설명용). `missing` 에 들어간 요소는 `rows` 에 `{ "key":"people", "missing":true }` 꼴로도 들어간다(N4).

**`/hazard-zones?ids=해운대-1`** → GeoJSON `FeatureCollection`(원본 820 파일에서 그 id 만).
**`/report/sea`** → `해상_위험지수_산출근거.pdf` 를 `Content-Type: application/pdf`, `Content-Disposition: attachment; filename*=UTF-8''<인코딩한 한글 이름>` 로. 원본 파일을 그대로 읽어 보낸다(복사본 없음).

**`/status`**
```json
{
  "ok": true, "now": "2026-10-10T14:37:00+09:00",
  "sources": {
    "warnings":          { "status": "ok",    "updatedAt": "2026-10-10T14:36:10+09:00" },
    "gale":              { "status": "ok",    "savedAt": "…", "rows": 0, "unmatched": 0 },
    "zoneForecasts":     { "status": "ok",    "base": "2026101000", "updatedAt": "…" },
    "swell":             { "status": "ok",    "baseTm": "2026.10.10 09:00", "frames": 19 },
    "ripCurrent":        { "status": "offseason", "updatedAt": "…", "withData": 0, "total": 13 },
    "congestion":        { "status": "error", "lastSuccess": "2026-10-09T05:14:00+09:00", "lastError": "HTTP 429", "callsToday": 52 },
    "tourConcentration": { "status": "ok",    "date": "2026-10-10", "spotsMatched": 1180, "spotsTotal": 1354 },
    "events":            { "status": "ok",    "month": "2026-10", "count": 37, "lastRun": "…" }
  }
}
```
- `status` ∈ `ok`·`stale`(기준 넘게 안 바뀜)·`error`(마지막 시도 실패)·`missing`(파일 없음)·`offseason`(이안류 6~9월 밖). 「낡음」 기준: 특보 10분 · 해구 예보 15시간 · 너울 24시간 · 혼잡도·집중률 「오늘 날짜가 아님」(06:30 이후) · 행사 「이번 달 파일 없음」.

---

## 5. 화면 설계 (소넷)

### 5.1 층 켜고 끄기 — 스위치
- 마크업: 시안 `.tl` 대신 **앱 범례와 같은 클래스** `<div class="banzone-legend" role="group" aria-label="위험예측 보기"><button class="bzl-row on" aria-pressed="true"><span class="bzl-name">연안 위험 예측·분석</span><span class="bzl-switch"></span></button>…</div>`(R1-5~7).
- CSS: `.banzone-legend` 규칙은 `index2.html:1047~1120` **인라인 스타일**에 있다(`style.css` 에 없음). 연결 뒤에는 그 원본이 그대로 적용되므로 기능 CSS 에 사본을 넣지 않는다. **미리보기 페이지에만** 그 블록 사본을 넣고 `test_risk_preview` 가 원본과 글자 대조한다(어긋나면 실패).
- 변수 `--accent-yellow`·`--text-sub`·`--border-color` 는 `style.css:47~55` — 미리보기가 `/style.css` 를 불러 쓴다.
- 처음 상태·둘 다 끈 때·선택 층을 끈 때: K-3·K-5 결정 전 기본값 [설계 판단] = 둘 다 켬, 시트는 「지도에서 칸이나 관광지를 누르세요」, 선택한 층을 끄면 시트를 비움, 둘 다 끄면 특보 테두리도 숨김.

### 5.2 지도 그리기 (`risk_map_layer.js`, OpenLayers)
| 층(아래 → 위) | 그리는 것 | 스타일(명세) |
|---|---|---|
| 해상 칸 | `/sea/cells` 위치 + `/sea/frame` 점수: 0.025° 사각형. 점수 > 0 이면 `col(score)` 채움 불투명도 .7, 0 이면 투명 채움(클릭 면적용). 점 무늬 개수 0/2/5/9(흰색 반지름 1.25px, .85) — 칸 안 고정 위치(시안 식 `3+((k*7+gx*3)%16)` 를 칸 픽셀 크기 비율로). `clickable:false` 칸은 아예 안 그림 | R2-10~15 · R2-26 |
| 격자선 | 그려지는 칸의 테두리 — 농도는 B-6 미결 → 기본값 시안 `rgba(200,225,240,.12)` 0.5px | R2-14 |
| 해안선 자르기 | 해상 칸 층의 `prerender` 에서 `/api/ocean/land-mask` 고리로 캔버스 `clip()`(땅 고리를 짝홀 규칙으로 빼서 바다만), `postrender` 에서 `restore()`. 섬 테두리 21개(`island_outlines.geojson` — 정적 경로가 없으므로 `/coast/spots` 처럼 서버가 함께 내려주거나 `/api/risk-forecast/islands` 를 추가 — 오퍼스가 단계 3에서 정함)도 땅으로 친다. 선례: `ocean_overlay.js:108~135` 가 `prerender` 훅을 쓴다 | R2-1 · R2-3 |
| 진한 해안선 | 같은 고리를 선 `#5b6576` 2.4px(섬 2px) | R2-2 |
| 연안 원 | `/coast/spots` 의 분할 다각형 + `/coast/frame` 점수: 채움 `col(score)` .5, 테두리 같은 색 2px, 가운데 흰 점 반지름 4. 점수 null 이면 회색 테두리만 + 시트에서 이유 | R2-5~8 |
| 위험구역 폴리곤 | 주소를 누른 구역만: 채움 `#ff8f1f` .55, 테두리 `#ffd740` 2px. 그 관광지가 선택돼 있을 때만 | R2-23~24 |
| 특보 테두리 | `borders`: 구역 폴리곤(`/api/warn-zones` — 이름 `_normalizeZoneName` 규칙으로 맞춤) 테두리만, 3.5px, `pre #ffd740` · `adv #ff8f1f` · `wrn #ff3b30`, 경보를 주의보 위에 | R2-17~19 |
| 3일째 점선 | 연안 스위치 켜짐 + 모레: `day3Dashed` 구역에 `#ffd740` 점선 `[6,5]` 3.5px | R2-21 |
| 선택 표시 | 칸: 흰 테두리 2px(1px 안쪽) · 원: 흰 고리 2.5px | R2-7 · R2-15 |
- 클릭 판정 순서: 연안 원(켜짐) → 해상 칸(켜짐·clickable) → 없음. `window._riskForecastTryHandleClick(map, evt)` 로 노출(연결 단계에서 `ocean_map.js:1147~1220` 의 훅 줄에 한 줄 추가 — 지금은 미리보기 페이지가 `map.on('singleclick')` 에 직접 묶음).
- 범례(R2-29): 짧은 선 + 글자 「예비특보·주의보·경보」, 연안 켜짐이면 점선 「특보급 날씨 가능성(3일째)」, 해상 켜짐이면 「점 = 배 혼잡」. 위치는 K-4(미리보기는 지도 아래).
- 「원 안 바다에 격자를 그릴지」는 §6 N7. 기본값 = 둘 다 그림(시안과 같음).

### 5.3 바텀시트 렌더러 (`risk_sheet.js`)
- 구성(R4-1): 손잡이 → 제목 → 부제 → 슬라이더 → 본문. 시트 CSS 는 시안 `.sheet` 값(R4-2), 본문 `word-break:keep-all; overflow-wrap:break-word`(R4-3), `aria-live="polite"`.
- **해상**: 제목 `{major}-{sub}해구` · 부제 K-10 · 위험지수 상자(R4-8~13: 색 상자 `col(score)` 배경 + `ink()` 글자, 줄1 `band`, 줄2 「평소(특보 없는 때)보다」, 줄3 「선박 사고 가능성 {rr===1 ? 평소 수준 : fmt(rr)}」, 줄4 「사고 종류 : 전복, 침몰, 침수, 표류」, [기준 상세] 버튼 오른쪽 위, 막대 0·50·100) → 요소 줄(혼잡 → 특보 → 파고 → 풍속, R4-18~22, 시안 `seaRows()` 문구 틀) → 사고 종류별 두 줄(R4-24, `collision.status==='withheld'` 이면 N13 결정 문구).
- **연안**: 제목 관광지 이름 · 부제 「{주소 또는 시군구} · {파출소} 관할」 · 상자(R4-28 다섯 줄) · 안내 상자들(R4-39~42, 순서 특보 → 3일째 → 떠밀림) · 요소 줄(사람 혼잡 → 위험구역(+아코디언) → 사망사고 발생구역 → 행사 정보 → {N}월 분석 → 너울 → 이안류, 시안 `spotRows()` 문구 틀 + U69·U75 정리) .
- 문장 틀 함수는 시안 `line()`·`fat()`·`hzAcc()` 를 옮긴다(비교 기준 문구 R4-32, 조사 R4-33).
- **자료 없음 표시**(§8.3): 프레임·상세의 `degraded`/`missing` 이 비어 있지 않으면 본문 맨 위에 회색 상자 「⚠ {자료 이름} 자료를 받지 못해 이 값은 빠져 있습니다 (마지막 수집 {시각})」. API 자체가 실패하면 시트에 「위험예측 자료를 불러오지 못했습니다 — {오류}」 + 다시 시도 버튼. 지도에는 지도 위 띠 한 줄. **빈 지도만 보여 주지 않는다.**

### 5.4 슬라이더 (`risk_slider.js`) — 재사용 판단
| 부품 | 재사용? | 이유 |
|---|---|---|
| CSS `.ocean-sheet-slider`·`.ocean-sheet-tooltip`·`.ocean-sheet-divider` (`style.css:10990~11163`, 전부 **클래스** 선택자) | **그대로 씀** | 「해양종합정보와 같은 모양」(U64④·R3-2·R3-7) — 같은 클래스면 값이 갈라질 수 없다 |
| 동작 `ocean_sheet_timeline.js` (`window.OceanSheet.SheetTL`) | **쓰지 않음, 새로 작성** | 고정 DOM id(`#ocean-sheet-slider` 등)와 `OS.state`·`OS.renderHeader` 에 묶여 있고(`:1~65` 머리 주석 「의존」), 3시간 고정 step 이다. 고쳐서 쓰려면 기존 해양종합정보 시트 코드를 건드려야 한다 — 기존 표출 화면 영향 금지 |
| 말풍선 위치 계산(화면 양끝 안 잘림 + 화살표 추적, `:161~210`) | **알고리즘을 옮김**(같은 식) | 동작이 같아야 한다(R3-4). 옮긴 함수 머리에 원본 줄 번호를 단다 |
| 말풍선 글자 「'26. 5. 5.(화) 07:42」 | 같은 꼴(`:170~174`) | R3-6 · B-3 |
- step: 해상 1·연안 3은 **시간축 배열의 칸 번호**로 다룬다(값 = 칸 번호, `min=0 max=times.length-1 step=1`) — 시각 간격이 0번만 불규칙(지금→정시)해도 손잡이가 고르게 움직인다. 연안↔해상을 오가면 가장 가까운 시각의 칸으로 옮긴다(R3-8).
- 자정 구분선: K-9 기본값 = 있음(앱과 같음, `.ocean-sheet-divider`).
- `input` 마다 지도·시트 갱신(R3-1) — 프레임은 메모리에 있으므로 칸 번호별로 한 번 받은 것은 다시 받지 않는다.

### 5.5 [기준 상세] 창과 PDF (`risk_basis.js`)
- 창: 아래에서 올라오는 시트 + 어두운 막(R5-2), [닫기]·제목·**PDF 버튼(제목 바로 아래)**·본문(R5-3~4). 해상 본문 = 설계서 §12.1 확정 문안 **그대로**(명세 §5.2 블록 — 시안 `BASIS.sea` 와 글자 대조 차이 0 이라고 명세가 적음). 연안 본문 = 시안 `BASIS.coast`(명세 §5.3) + 코드 주석 「사용자 수정 대기(K-17)」.
- 표 글자색을 창 안에서 따로 지정(R5-7 — `th,td{color:#e6edf8}` 등). 미리보기 페이지는 `style.css` 를 불러오므로 **같은 사고(남색 바탕에 검은 표 글자)가 날 수 있다** → `test_risk_format` 대신 브라우저 확인 항목으로 단계 5 에 넣는다.
- 접근성: `role="dialog" aria-modal="true" aria-label="기준 상세"`, 열면 [닫기]로 초점, 닫으면 눌렀던 버튼으로, Esc(R5-8).
- PDF: `<a class="pdf-btn" href="/api/risk-forecast/report/sea" download>` — 서버가 원본 파일을 보낸다(K-16). Capacitor 앱(서버 URL 을 띄우는 구조 — `capacitor.config.json` `server.url`)에서 `download` 속성이 내려받기로 동작하는지는 **[미확인]** → 연결 단계에서 실기기로 확인.

### 5.6 새로 만들지 다시 쓸지 — 정리
| 부품 | 결정 | 이유 |
|---|---|---|
| 지도·배경 | 다시 씀(`ocean_map.js` 의 배경지도 함수) | `admin_zone_editor` 선례, 연결 뒤 같은 지도 |
| 스위치 | 클래스 다시 씀 | R1-6 「앱 값 그대로」 |
| 슬라이더 CSS | 다시 씀 / 동작은 새로 | §5.4 |
| 특보 구역 폴리곤 | 다시 씀(`/api/warn-zones` 정적 파일) | 같은 구역 |
| 해안선 | 다시 씀(`/api/ocean/land-mask`) | R2-1 |
| 시트·상자·줄·창 | 새로 | 기존에 같은 모양 없음(시안 CSS 를 옮김) |
| 숫자 서식 | 새로(시안 함수 이식) | 기존 앱에 같은 규칙 없음 |
| 히트맵(사고정보 탭 `accident_info.js:2040~`) | 쓰지 않음 | U50 이후 색 = 칸별 날씨 점수(단색), 히트맵은 밀도용 |

---

## 6. 미결 처리안

### 6.1 K-1 ~ K-24
| # | 구분 | 답 또는 질문 | 근거 / 권장안 |
|---|---|---|---|
| K-1 | **(가)** | `index2.html` 은 **한 글자도 바꾸지 않는다** — 버튼 마크업·`SOLO_BTN_IDS`·script 태그 모두 연결 단계로. 대신 미리보기 페이지 | 이번 작업 지시(사용자 원문 *"단, INDEX2 메인페이지에는 아직 반영하지말자."* + 「별도 미리보기 페이지」) · 명세 범위 주의 1. `test_risk_preview` 가 index2 에 흔적이 없는지 검사 |
| K-2 | (나) | 오른쪽 버튼 줄 안 순서·아이콘 | **지금 정하지 않아도 됨**(연결 단계). 권장: 줄 맨 아래, 글자 두 줄 「위험/예측」만 |
| K-3 | (나) | 처음 상태 · 둘 다 끈 때 · 시트 처음 열림 | 권장: 두 스위치 켬(시안) · 시트는 누를 때 열림(U9·U63 「누르면」) · 둘 다 끄면 테두리도 숨김 |
| K-4 | (나) | 기존 범례와 자리 겹침, 지도 범례 위치 | 연결 단계. 권장: 스위치를 `#ocean-legend-stack` 안 범례 하나로 쌓기(같은 클래스라 자연스럽게 세로로 쌓임) |
| K-5 | (나) | 선택한 층을 끌 때 시트 | 권장: **시트를 비운다**(시안처럼 다른 대상을 자동 선택하면 사용자가 고르지 않은 곳이 뜬다) |
| K-6 | (나) | 테두리 「지금 발효 중」의 「지금」 | 권장: **슬라이더 시각** — 같은 시각의 점수 상자와 테두리가 어긋나지 않는다(점수는 그 시각의 예비 가정으로 계산 — R7-7) |
| K-7 | (나) | 예비 가정 구간 테두리 색 | 권장: 시안대로 범위 시작 전 노랑, 시작부터 가정 단계 색(주의보 주황·경보 빨강) — 점수와 같은 판정 |
| K-8 | (나) | 주소 눌렀을 때 이동·확대·해제 | 권장: 폴리곤 범위에 맞춰 이동(여백 40px, 최대 확대 16), 다른 관광지 선택·시트 비움 때 해제 |
| K-9 | (나) | 슬라이더 시작·끝·구분선 | 권장: 0 = 지금(분 그대로), 이후 정시 격자 · 해상 끝 **내일 23:00** · 연안 끝 **모레 21:00** · 자정 구분선 있음(앱과 같음). 자료 범위: 해구 예보 0~75h(`scheduler.js:569`)라 모레 21시까지 덮음, 혼잡도는 내일까지(U8) |
| K-10 | (나) | 해상 부제 표기 | 권장: 요청 표기 **「부산 남동 135도 5.0해리」** = `{지명} {8방위 낱말} {방위각}도 {소수1자리}해리`, 꼬리말 없음. 남은 질문: 방위 낱말 8방위인지 16방위인지, 방위각 3자리 0 채움(「045도」)인지 |
| K-11 | (나) | 배수 아닌 값의 글자색 | 권장: 시안 색 고정(혼잡 보통 노랑·높음 이상 빨강 / 파고 2m↑ 노랑 / 풍속 12↑ 노랑·14↑ 주황·17↑ 빨강 / 떠밀림 풍속 노랑) |
| K-12 | **(가)** + (나) | (가) 해상 **점수에는 강풍을 넣지 않는다** — 해상 값 1.68·4.46 은 풍랑·태풍 기록으로 잰 값(U74① 「주의보(풍랑·태풍)」, 공개판 5.1 표 「특보 있음(풍랑·태풍)」), 선박사고 특보 딱지도 「선박은 태풍·풍랑만」(`build_accident_warn_flags.js:21`). (나) 해상 특보 줄 이름 | 권장: 자료의 종류 이름 그대로 「태풍주의보」「태풍경보」「예비 태풍주의보」. 강풍은 해상 시트에 줄도 두지 않음 |
| K-13 | **(가)** + (나) | (가) 값의 출처: 공개판 `해상_위험지수_산출근거.md:263~310` — 주의보 **0.40** · 경보 **0.70** (보고서 `report.md:992~993`·`:1032~1033` 와도 같음) · 특보&파고4m **0.89** · 특보&풍속14~17 **0.41** · 특보&풍속17↑ **추정 보류(3건)** · 내일 예보만(이틀 전 넓은 기준) **0.59**(`report.md` §12.4). U50 「−38~−46%」= 하루·이틀·사흘 전 0.62·0.59·0.54. 고른 후보와 같은 조건의 값을 쓴다(§3.4.3). (나) 추정 보류 칸 표시 → N13 | |
| K-14 | **(가)** + (나) | (가) 사흘 전 엄격(1.07)·4m/17m/s(1.84)는 **쓰지 않는다** — 사용자 확정 문안(설계서 §12.1) 표에 1.63 행 하나뿐. 판정 단위 = **대해구 · 그 KST 날짜의 하루 최대값**(분석 `32_fcst_leads.py` 가 `wh_max`·`ws_max` 일 단위로 잼). (나) ①시트 어느 줄·문구 ②오늘 시각에도 쓰는지 | 권장: ① 특보 줄 자리에 「특보급 예보」 줄 — 값 「내일 예보 파고 {dayMaxWh}m·풍속 {dayMaxWs}m/s」, 설명 「내일 예보가 특보급(파고 2m·풍속 12m/s 이상)이라 평소 대비 63% 높은 사고 발생 가능성」 ② 오늘은 쓰지 않음(문구가 「내일」) |
| K-15 | **(가)** + (나) | (가) 연안 안내는 **자료상 상태 그대로**: 예비면 「발표 상태」, 실제 발효로 바뀐 뒤에 「발효 상태」 — 예비 가정은 해상에만(R7-7). (나) 이름 정렬 순서 · 발효 중 특보가 미래 시각에 언제까지 이어지나(N2) | 권장: 경보 먼저, 같은 단계면 풍랑 → 강풍 → 태풍(U71 예 「풍랑주의보, 강풍주의보」 순서를 따름) |
| K-16 | **(가)** | 새 라우트 `GET /api/risk-forecast/report/:kind` 가 `config/…/v3/public/*.pdf` **원본을 그대로** 보낸다. 사본을 `client/` 에 두지 않는다 | 원본이 정적 루트(`client/`, `server.js:216`) 밖에 있다 · _RULES §2 「규칙은 한 곳에만」(사본은 갈라진다) · PDF 를 다시 만들면(`40_public_report_pdf.js`) 바로 반영 |
| K-17 | (나) | 연안 [기준 상세] 최종 문안 | 사용자 수정 대기. 구현은 시안 문안 + 코드 주석 「사용자 수정 대기」 |
| K-18 | (나) | 집중률 경계값 소속 | 권장: **이상이면 위 단계**(12.5 → 1단계) — 혼잡지수 경계(1 은 「보통」)·글자색 경계와 같은 방향. 근거 코드 없음(`grep 12\.5` — 분석 도구에 이 경계를 쓴 코드 없음) |
| K-19 | (나) | 터치 영역 최소 크기 | 권장: 스위치 줄·[기준 상세]·주소 링크 높이 **최소 24px**(WCAG 2.2 AA 2.5.8 의 24×24) — 시안 값은 패딩만 늘려 맞춤 |
| K-20 | (나) | 관광지 → 파출소 판정 | 실측(⑬): 포함 809 · 밖 545(1km↓ 246 · 1~3km 173 · 3~10km 101 · 10km↑ 25). 권장: ①폴리곤 안 → 그 파출소(두 곳이면 가까운 경계 쪽 — 2곳뿐) ②밖이면 가장 가까운 폴리곤, **10km 이하만** ③그 밖 25곳은 부제에서 관할을 뺌(지어내지 않음) |
| K-21 | **(가)** | 점수표는 **서버 상수 모듈 한 곳**(`risk_points.js`). 화면은 점수표를 갖지 않는다(서버가 배수를 보냄). 검사가 `points_v31.md`·`report.md` 표를 읽어 대조 | _RULES §2 「규칙은 한 곳에만」·「검사는 제품 함수를 부른다」. 화면 코드에 숫자를 박으면 둘이 된다 |
| K-22 | **(가)** | 「주말」 = **토·일만**. 공휴일인 평일은 평일 | 점수 2.14 를 잰 코드가 `d.weekday() >= 5`(`17c_event_ccr.py:35`), 보고서 표 「주말(토·일)」. 공휴일을 넣으면 근거 밖 정책이 된다(원하시면 바꿀 수 있음) |
| K-23 | **(가)** + (나) | (가) 파도 주기 12초 **미만이면 줄을 뺀다**(R4-31 「해당 없는 요소는 줄을 뺀다」). (나) 3일째 너울 자료 공백 | 권장: 회색 줄 「너울 — 예보 범위 밖」(점수 0) — 조용히 빼면 「12초 미만」과 구분이 안 된다 |
| K-24 | **(가)** + (나) | (가) 「관심」도 **줄을 보이고 0점**(U46 「단계는 지점 상세에 그대로 표시」). (나) 미래 시각에 쓸지 — 수집기가 **현재 값 하나만** 저장(⑨). 시안의 「첫 이틀만」 이유는 시안·설계서에 없음 **[미확인]** | 권장: **오늘 날짜 칸에만** 「{단계}(현재 관측)」으로 쓰고, 내일·모레는 회색 「이안류 — 관측값만 있어 내일 이후 없음」 |

### 6.2 K 목록 밖에서 새로 나온 질문 (구현 전에 사용자 결정 필요)
| # | 질문 | 왜 생겼나(확인 기록) | 권장안 |
|---|---|---|---|
| N1 | 연안 부제의 **주소**를 어디서? | `coastal_spots.json` 행 필드에 주소가 없다(⑤ 필드 목록 [실측]) | 관광공사 KorService2 `addr1` 을 **한 번만** 받아 `risk_spots.json` 에 넣고(1,354곳, 좌표 출처와 같은 API), 못 찾은 곳은 시군구 이름. 그전까지는 시군구 이름 |
| N2 | **발효 중 특보**가 슬라이더의 미래 시각에 언제까지 이어진다고 볼까? | 자료는 「지금 발효 중」만 알려 준다. 해제예고(`tmCc`·`clrNtcTm`)는 있을 때만 있다(① 필드) | 해제예고가 있으면 **그 범위의 끝까지** 발효, 없으면 **슬라이더 끝까지** 발효(안전 쪽 — 예비 가정과 같은 성격) |
| N3 | 행사를 **어느 관광지**에 붙일까? | 점수 2.14 는 **(시군구, 날짜)** 단위로 잰 값(`17c_event_ccr.py:20~27`). Gemini 로 찾은 행사는 좌표가 없을 수 있다 | (가) **같은 시군구의 모든 관광지**(근거와 같은 단위, 좌표 불필요) / (나) 행사 좌표 3km 안 관광지만(좌표 없는 행사는 빠짐). 권장 (가). 단점: 큰 시군구(예: 제주시)에서 먼 관광지에도 행사 줄이 뜸 |
| N4 | 값이 없는 요소는 0점인가 「정보 없음」인가? | 명세 R7-5(옛 규칙 M1②) 미결. 전남은 관광지가 없지만, 그 밖에도 집중률 누락·너울 범위 밖·혼잡도 수집 실패가 생긴다 | 점수는 0 으로 더하되 **줄과 상자에 「자료 없음」을 드러냄**(§3.5.1) — 「한산함(0단계)」과 「모름」이 같아 보이지 않게 |
| N6 | 소해구 대표가 **동률**일 때 · 예비의 **목표 단계**를 모를 때 | U65 「최소 차지 44%·50% 이하 70칸」 — 정확히 50:50 이 있을 수 있음 · 일반 예비는 단계가 「예비」로만 옴(① [미확인]) | 동률 → 번호가 작은 소해구(북서 우선) · 목표 단계 모름 → **주의보로 가정**(시안과 같음) |
| N7 | 관광지 원 **안의 바다**에 해상 격자 색을 그릴까? | R2-8 「원 밖 띠 안의 바다는 선박 격자로 칠한다」는 「원 안은 격자를 안 칠한다」로도, 「원 밖에도 칠한다」로도 읽힌다. 시안은 둘 다 겹쳐 그림 | 시안대로 **둘 다 그림**(원이 반투명 .5 라 격자가 비쳐 보임). 원 안을 비우려면 칸 클릭도 원에 막혀야 한다 |
| N8 | 코드 폴더 위치 · 미리보기 공개 | 배치 트리상 `client/js/marine-life/risk-forecast/`(탭3) 인데 문서·시안은 `client/js/ocean-map/coastal-risk/`(탭2). 미리보기는 주소만 알면 열림(§2.7) | 코드 = `marine-life/risk-forecast/`, 문서는 그대로 두고 링크 · 미리보기는 링크 없이 두되 `noindex` |
| N9 | Gemini **키 공유**를 감수할까? | 키 하나·429 쿨다운 공유(`gemini_client.js:28~31`, `:39` 키 주석 「챗봇이 쓰는 키는 GEMINI_API_KEY_26_8 하나뿐」) | 감수 + 완화: 월 1회 새벽 03:20, 시도 10곳 한 번씩(10회), 429 면 그 자리에서 멈추고 다음 날 같은 시각 재시도(최대 3일) |
| N10 | 공공데이터포털 **활용신청**(혼잡도 B554035 · 집중률·관광정보 B551011) 이 운영 키에 되어 있나? | 코드에 있는 포털 키는 `scheduler.js:713` 하나. 설계 때 쓴 키가 무엇인지 [미확인] | 사용자가 포털에서 확인 → 운영 비밀값(`fly secrets`)으로 넣고 코드에는 이름만(`DATA_GO_KR_KEY` 등). 키 값을 코드·문서에 적지 않는다 |
| N11 | 3일째 **노란 점선의 구역 단위** | 명세 R2-21 은 「특보급 날씨 가능성 구역」만 적음. 판정은 대해구 단위 | **특보구역(44)** 단위: 그 구역 안에 중심이 든 대해구 중 하나라도 기준을 넘으면 그 구역 테두리를 점선으로. 다른 테두리와 같은 모양이라 읽기 쉽다 |
| N12 | 강풍 구역 판정(관광지가 **안 든** 경우) · 예비 가정 중 「특보 중 4m·14·17」 적용 | 설계서 §3.2 는 「관광지가 든 구역」만 · [기준 상세] 「그 특보로 계산」의 범위 | 강풍: 안 들면 3km 안 가장 가까운 구역(사고정보 탭과 같음) · 예비 가정 중에도 4m·14·17 조건 적용 |
| N13 | 충돌·접촉 **추정 보류**(풍속 17m/s↑) 표시 · 혼잡도 수집 **실패** 때 해상 칸 | K-13 · U42 「응답에 없는 칸은 표시 안 함」은 정상 응답 전제 | 보류 → 「충돌·접촉 — 자료가 적어 따로 재지 못함」 회색. 수집 실패 → 칸 위치표 전체로 **날씨 색만** 그리고 「배 혼잡도 자료 없음」 경고(빈 바다로 두지 않음) |

### 6.3 관찰 (결정 요청은 아니지만 알려 둘 것)
- **O-1**: 규칙대로면 **주의보만 있는 칸은 지수 25 → 단계 말 「평소 수준」**인데, 같은 상자에 「선박 사고 가능성 +68%」가 함께 뜬다(§3.4.5 S3). 시안 판 23 의 기본 선택 칸은 경보 칸이라 이 조합이 시안에서 눈에 띄었는지 확인하지 못했다.
- **O-2**: 설계서 §7 「웹 검색 없음」, 명세 §9 의 「미확인」 두 곳, `scheduler.js:265` 주석은 §1.3 대로 낡았다. 이 설계서는 지우지 않고 여기 적어만 둔다.

---

## 7. 단계별 구현 계획

> 공통: 단계가 끝날 때마다 CLAUDE.md 「단계 확인 네 가지」(기계 확인 · 「없다」 판정 근거 · 도구 자체 의심 · 무엇을 어떻게 확인했는지 기록). `node local_server/server.js &` 후 `bash scripts/refactor/verify_all.sh` — **끝의 실패 모음 블록이 비었을 때만** 통과. 커밋은 경로를 하나하나 지정(`git add -A` 금지 — _RULES §4).
> 적대검증 프롬프트에 반드시 넣을 것(CLAUDE.md 결정로그 2026-08-09): ①먼저 읽을 문서 경로(이 설계서·명세·설계서) ②「추측 금지 — 코드나 실행 결과로 확인한 것만」 ③「설계안이 이 경우를 안 다뤘다는 지적은 환영」 ④「못 찾았으면 못 찾았다고」. 검토자는 **각도가 다른 둘 이상**(2026-08-20 결정로그).

| 단계 | 산출물 | 모델 | 검증 | 완료 기준 |
|---|---|---|---|---|
| **0. 결정 받기** | §6 의 (나) 항목 답(특히 N2·N3·N4·N10·K-14·K-18·K-20) | (사람) | — | 답을 이 설계서에 원문 인용으로 덧붙임(지우지 않음) |
| **1. 순수 모듈 + 정적 표** | `risk_points.js` · `risk_time.js` · `risk_geo.js` · `build_risk_static.js` → `risk_spots.json` · `rip_spot_map.json` · 화면용 고정 입력 `local_server/scripts/fixtures/risk_forecast/*.json` | **오퍼스** | `test_risk_points` · `test_risk_time` · `test_risk_static` 신설·SUITES 등록 | 위험구역 구간 222/397/505/230 재현, 해수욕장 313, 주요지명 165, 이안류 12+1, 원 분할 겹침 0, `normalizeMmisTime` 역해석 전부 일치. 자식 구역 상태의 뜻(§3.3)을 크롤러 코드로 확인해 기록 |
| **2. 수집기 3개** | `sea_traffic_collector.js` · `risk_sea_cells.js` · `tour_concentration_collector.js` · `coastal_events_collector.js` + `server.js` 기동 블록(각 try/catch, `FLY_ALLOC_ID` 없으면 외부 호출 안 함 — 물빠짐 선례 `server.js:526~529`) | **오퍼스** | `test_risk_collectors` 신설·등록. **적대검증(별도 에이전트 둘 이상)** — 각도: ⓐ기존 프로세스·푸시를 죽일 수 있는 길(처리 안 된 Promise 거부 — `server.js` 에 `unhandledRejection` 처리기 없음 [실측 grep], Node 20(`Dockerfile:21`)은 기본 설정에서 이 경우 프로세스를 끝낸다 — Node 15 이후 기본 동작이라는 일반 지식이며 이 저장소에서 재현하지는 않음) ⓑ할당량·재시도 폭주 ⓒ「실패가 성공처럼 보이는」 저장(빈 응답으로 덮어쓰기 — `gale_warning_store.js:98~102` 선례) | 하루 호출 수 상한 지킴, 실패 때 직전 파일 유지 + 상태 기록, 푸시 모듈 require 0, 기존 data 파일 쓰기 0 |
| **3. 점수 엔진 + API** | `risk_score.js` · `risk_store.js` · `routes/risk_forecast.js` · `server.js` 라우트 1줄 | **오퍼스** | `test_risk_score_sea` · `test_risk_score_coast` · `test_risk_api` 신설·등록(§3.4.5·§3.5.2 예시가 검사 행). **적대검증(둘 이상)** — 새 판정 기준이므로(CLAUDE.md 2026-08-20 「새 판정 기준 → 독립 검토」) 각도: ⓐ근거 문서 숫자와 코드 대조 ⓑ시간 경계(자정·예비 범위·KST/UTC) ⓒ자료가 비었을 때 | 모든 예시 일치, 자료 없음이 응답에 드러남, 응답 크기(해상 프레임 gzip) 기록 |
| **4. 화면** | `client/js/marine-life/risk-forecast/*.js` · `risk_forecast.css` · `client/risk_forecast_preview.html` | **소넷** | `test_risk_format` · `test_risk_preview` 신설·등록. 브라우저로 미리보기를 열어 명세 R 번호별 확인표(R1~R8) 작성. 단계 3 전에는 `?fixture=1` 로 | 명세 R 요구 중 화면 몫 전부 체크, 미결 항목은 기본값으로 동작하며 화면에 「(결정 대기)」 주석만 코드에 |
| **5. 마무리** | 대비 재측정(R8-2 — 4.5:1 미달 0) · `[기준 상세]` 표 글자색 확인(R5-7) · README·guide · `node scripts/refactor/gen_architecture.js > ARCHITECTURE.md` | **소넷** (대비 측정 결과는 오퍼스가 한 번 검토) | `verify_all.sh` 전체 | 실패 모음 비어 있음, 문서·도면·코드 같은 커밋 |
| 6. 연결(**이번 범위 밖**) | `index2.html` 버튼·script, `SOLO_BTN_IDS`, `ocean_map.js` 클릭 훅 한 줄, `test_overlay_solo` 갱신 | 사용자 지시 후 | V2·V3 기준선 갱신 사유를 커밋에 | — |

- 병렬: 단계 1 이 고정 입력(fixture)과 §4 응답 모양을 먼저 확정하면 **단계 4(소넷)는 단계 2·3(오퍼스)과 동시에** 진행할 수 있다.
- 각 단계 착수·완료 때 HANDOFF 기록(`handoff.py start/done`) — 이번 설계 단계는 지시에 따라 남기지 않았다(§0.3).

---

## 8. 위험과 영향 범위

### 8.1 기존 기능에 닿는 지점
| 지점 | 바꾸나 | 영향과 막는 법 |
|---|---|---|
| `scheduler.js` | **안 바꿈** | 새 수집은 `server.js` 기동 블록에서 각자 타이머(선례: `vsby_smallzone`·`swell_smallzone` `server.js:504~516`). 기존 1분 루프·특보·푸시 순서에 끼어들지 않는다 |
| `marine_warning_crawler.js` · `gale_warning_store.js` · `push_*` | **안 바꿈** | 결과 파일을 읽기만. `test_risk_collectors` 가 새 코드의 require 목록에 푸시 모듈이 없는지 검사 |
| `services/cache_manager.js` | 안 바꿈(읽기만) | 이미 서버가 불러 둔 같은 모듈(require 캐시)이라 5초 타이머가 하나 더 생기지 않는다 |
| `server.js` | **바꿈**(라우트 1줄 + 기동 try/catch 3개) | ⓐ기동 실패가 서버를 멈추지 않게 try/catch(선례 그대로) ⓑ**처리 안 된 Promise 거부 = 프로세스 종료**(Node 20 기본 동작 — 일반 지식, 재현 안 함. `server.js`·`scheduler.js` 에 `unhandledRejection` 처리기 없음 [실측 grep]) → 모든 타이머 콜백을 `.catch()` 로 감싸고 적대검증 ⓐ각도로 확인. 프로세스가 죽으면 **특보 푸시도 같이 멈춘다** — 이번 기능의 가장 큰 위험 |
| `data/`(Fly 볼륨) | 새 하위 폴더 `data/risk_forecast/` 만 | 기존 파일 이름과 안 겹침. 크기: 혼잡도 압축 약 0.45MB+위치표 0.03MB(설계서 §4.3 어림) |
| 메모리(1GB, `fly.toml:31`) | 늘어남 | 혼잡도 원본은 한 시각씩 받아 곧바로 칸 번호·지수 배열로 줄임(원본 75MB 를 한꺼번에 들지 않음). 프레임은 숫자 배열만 |
| `gemini_client.js` | 안 바꿈(호출만) | 429 쿨다운 공유 → 챗봇·특보 분석이 함께 멈출 수 있음(N9). 월 10회 안팎·새벽·429 즉시 중단 |
| `ocean_sheet_timeline.js` · `style.css` · `index2.html` · `life_safety.js` · `ocean_map.js` | **안 바꿈** | 슬라이더 동작 새로 작성, CSS 는 클래스만 빌림, 연결 단계 전까지 index2 무변경(`test_risk_preview` 가 지킴) |
| `verify_all.sh` | `SUITES` 에 9개 추가 | 새 스위트는 시각에 기대지 않게 — 기준일을 고정 입력으로(CLAUDE.md 2026-08-09 「시각 의존 테스트 금지」) |

### 8.2 외부 호출량·비용
| 원천 | 호출 | 한도·비용 | 근거·확인 상태 |
|---|---|---|---|
| 해양교통 혼잡도(공단) | 하루 **43~48건**(지금 시각 ~ 내일 23시, 시각당 1건) + 재시도 → 상한 90건 | 개발계정 일 100건(설계서 §2.1 실측). 무료 | 「끊긴 호출이 한도에 잡히는지 모름」(설계서 §4.1) → 상한을 90으로 둠 |
| 관광지 집중률(관광공사) | 하루 **60건 이상**(시군구 60곳 [실측] × 쪽 수). 쪽 수는 행 수에 따라 — 해안 시군구 77곳 84,810행(설계서 §2.1) 기준 시군구당 평균 약 1,100행 [어림] → `numOfRows=1000` 이면 시군구당 1~3쪽 | 개발계정 일 1,000건. 무료 | 첫 주 하루 2회(§2.6)여도 약 360건 이하 [어림] |
| 행사 — 관광공사 `searchFestival2` | 월 1회, 쪽 넘김 수건 [어림] | 일 1,000건(KorService2 한도 — 설계서에 별도 숫자 없음 **[미확인]**) | — |
| 행사 — Gemini 웹 검색 | 월 **약 10회**(시도 10곳 [실측]에 한 번씩) [어림] | **검색 그라운딩 단가 [미확인]**(설계서 §7 「현재 가격 미확인」). 토큰 단가는 설계서 M25 에 gemini-2.5-flash 입력 $0.30·출력 $2.50/100만 토큰이 「저장소에 적힌 값」으로 있음 | 사용자가 금액을 보고 정하기로 한 M25 는 브리핑 이야기라 이것과 별개 |
| 기존 원천(특보·해구·너울·이안류) | **늘지 않음** — 이미 받은 결과를 읽기만 | — | — |

### 8.3 실패했을 때 화면 (「조용한 것이 이상 없는 것처럼 보이면 안 된다」 — CLAUDE.md 결정로그 2026-09-20)
| 상황 | 서버 | 화면 |
|---|---|---|
| 혼잡도 수집 실패(오늘 자료 없음) | `/status` `congestion.status=error` + 마지막 성공 시각, 프레임 `degraded:["congestion"]` | 지도 위 띠 「⚠ 배 혼잡도 자료를 받지 못했습니다(마지막 수집 10. 9. 05:14)」, 해상 칸은 날씨 색만(N13), 시트 혼잡 줄 「자료 없음」 |
| 집중률 없음 | 같은 꼴 `tourConcentration` | 사람 혼잡 줄 「자료 없음」, 상자 아래 「일부 요소 자료 없음」(N4) |
| 해구 예보 낡음(15시간↑) | `zoneForecasts.status=stale` | 파고·풍속 줄 옆 회색 「예보 기준 {시각}」 + 띠 |
| 특보 파일 낡음(10분↑) | `warnings.status=stale` | 띠 「특보 자료가 {N}분째 갱신되지 않았습니다」 — 특보 테두리가 없을 때 「특보 없음」으로 읽히지 않게 |
| 강풍 이름 못 맞춤 | `gale.unmatched > 0` | 화면엔 맞춘 것만, `/status` 에 숫자. 관리자 확인용(M10) |
| 이안류 비수기 | `ripCurrent.status=offseason` | 이안류 줄 없음(그 관광지에 줄이 생길 일 자체가 없음 — 정상) |
| API 전체 실패 | HTTP 503 + `sources` | 시트 「위험예측 자료를 불러오지 못했습니다 — {오류}」 + [다시 시도]. 빈 지도만 두지 않음 |
| 행사 수집 실패 | `events.status=error` | 행사 줄 대신 상자 아래 「행사 정보를 확인하지 못했습니다」(행사 없음과 구분) |
- `/status` 는 사람이 열어 보는 점검 창이기도 하다 — 각 자료의 「마지막으로 언제·어떻게 끝났나」를 늘 띄운다(결정로그 ②).
- 「사람이 어떻게 알게 되나」(결정로그 ③): 이번 범위엔 푸시가 없으므로 관리자 알림은 만들지 않는다. 연결 단계에서 관리자 화면에 `/status` 카드를 붙일지 따로 묻는다.

---

## 9. 이 설계서의 한계
- 운영 서버의 실제 `weather_alerts.json`·`zone_forecasts.json`·`gale_warnings.json`·혼잡도·집중률 응답 **표본을 보지 못했다**. 모양은 코드로만 확인했다(§1). 단계 1·2 에서 실제 표본으로 다시 확인한다.
- [실측] 숫자 중 거리 계산(위험구역 3km·파출소)은 위경도를 km 로 국소 환산한 어림이다. 위험구역 구간은 분석(EPSG:5179) 결과와 정확히 같게 나왔지만, 사망사고구역 583곳·파출소 분포는 빌드 스크립트 결과와 다시 대조한다.
- 「8방위/16방위」, 행사 단위, 발효 지속 규칙 등은 §6 에서 사용자 답을 받아야 확정된다. 그 전에 짜는 코드는 §6 의 권장 기본값으로 동작하되, 바뀔 자리를 상수 한 곳에 모은다.
