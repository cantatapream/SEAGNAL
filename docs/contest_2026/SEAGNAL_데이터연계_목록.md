# SEA:GNAL 앱이 실제로 쓰는 외부 데이터 원천 전수 목록

- 기준 코드: `origin/main` 0137b1287 (작업 트리가 아니라 `git archive origin/main` 으로 푼 사본에서 읽음 — 줄 번호는 origin/main 기준과 같음)
- 작성: 2026-10-19 (읽기 전용 조사 · 파일 수정·커밋 없음)
- 근거 경로 표기: 접두어 없는 `scheduler.js` 등은 `local_server/` 아래, `client …` 는 `client/` 아래. 줄 번호는 origin/main 기준.
- 셀 단위: **1종 = 앱 안에서 별개로 취급되는 데이터 1개**. 같은 데이터를 범위·형식만 달리 내는 엔드포인트(예: 특보의 부모/자식/예비/최신, JTWC 텍스트/KMZ/GIF, 태풍 통보문/TD/그림)와 로그인·목록 조회용 보조 호출은 한 줄로 합쳤다. 엔드포인트별로 세면 몇 개인지는 맨 아래 「엔드포인트 기준」에 따로 적었다.
- 분류: A=공공 API(실시간·주기) / B=공공 정적 파일(받아서 앱에 넣은 것) / C=공공 웹 화면·통보문·영상 읽기 / D=해외 기관 / E=민간·기타 / L=링크만(집계 제외).
  - A 안의 꼬리표: **정식**=공공데이터포털·API허브·MTIS 등 키를 신청해 쓰는 공식 오픈API / **포털JSON·포털WMS·타일**=기관 포털이 화면용으로 내는 공개 주소를 서버·단말이 직접 호출(별도 이용신청 키 없음, 비공식 성격). 발표자료에 「공공 API」라고만 쓸지, 「공식 오픈API N + 포털 공개 데이터 M」으로 나눠 쓸지는 아래 집계로 고르면 된다.

## 1. 전수 표

| 번호 | 분류 | 제공 기관 | 데이터 이름 | 엔드포인트/파일 | 앱의 어느 기능에 쓰이나 | 근거 파일:줄 |
|---|---|---|---|---|---|---|
| 1 | A (정식) | 기상청 | 해구별 기상예보(0.5° 칸 파고·풍속 등, 하루 2판) | apihub.kma.go.kr /api/typ06/url/marine_large_zone.php | 해양종합정보 파고·바람 오버레이·해구 예보창·위험예측 날씨 | scheduler.js:184,577,613 · 30분마다 scheduler.js:2691 · 화면 ocean_overlay.js:1110 |
| 2 | A (정식) | 기상청 | 소해구 예보(브리핑용) | apihub.kma.go.kr /api/typ06/url/marine_small_zone.php | 해구 상세·연안 안전 브리핑 | services/smallzone_forecast.js:46 · routes/weather.js:896 |
| 3 | A (정식) | 기상청 | 해양기상 부이 관측(API허브) | apihub.kma.go.kr /api/typ01/url/sea_obs.php | 해양종합정보 부이 표시 | scheduler.js:170,314 · 매시 5·35분 :2666 · client core/config.js:35 |
| 4 | A (정식) | 기상청 | 해상 단기예보(구역별) | apihub.kma.go.kr /api/typ02/openApi/VilageFcstMsgService/getSeaFcst | 예보 탭 단기예보 | scheduler.js:512 · 05:15·11:15·17:15 :2686 · client forecast.js:564 |
| 5 | A (정식) | 기상청 | 중기 해상예보 | apihub.kma.go.kr /api/typ02/openApi/MidFcstInfoService/getMidSeaFcst | 예보 탭 중기예보 | scheduler.js:703 · 06:15·18:15 :2694 · client forecast.js:536 |
| 6 | A (정식) | 기상청 | 융합기상 실황(좌표별 풍향·풍속·기온·강수) | apihub.kma.go.kr /api/typ01/url/sfc_nc_var.php | 해양종합정보 바텀시트(바람 카드) | routes/ocean3.js:33 · client ocean-map/bottom-sheet/ocean_bottom_sheet5.js:253 |
| 7 | A (포털JSON) | 기상청 | 기상부이(B형) 관측 | marine.kma.go.kr /mmis_marine_api/v1/kma/obs/buoy/list | 부이 표시 | scheduler.js:179,442 · 매시 3·13분 :2677 · client core/config.js:38 |
| 8 | A (포털JSON) | 기상청 | 파고부이(C형) 관측 | marine.kma.go.kr /mmis_marine_api/v1/kma/obs/wh-buoy/list | 부이 표시 | scheduler.js:180,424 · client core/config.js:39 |
| 9 | A (포털JSON) | 기상청 | 등표(L형) 관측 | marine.kma.go.kr /mmis_marine_api/v1/kma/obs/lh/list | 부이 표시 | scheduler.js:181,459 · client core/config.js:40 |
| 10 | A (포털JSON) | 기상청 | 시정계 관측 | marine.kma.go.kr /mmis_marine_api/v1/kma/obs/vs/list | 수집·저장 후 AI 비서 답변에 사용(화면 표출은 안 함: core/config.js:41 주석) | scheduler.js:182,476 · routes/assistant.js:1196 |
| 11 | A (포털JSON) | 기상청 | 해상 특보 현황(발효·예비, 부모/자식 해역, 최신 통보) | marine.kma.go.kr /mmis_marine_api/v1/kma/warn/list · warn/ready · warn-sasc/list · warn-sasc/ready · warn/latest · warn-sasc/latest (엔드포인트 6) | 특보 표시·푸시 알림·위험예측(강풍특보 포함) | services/marine_client.js:89-94 · marine_warning_crawler.js:4387,4424-4425 · 1분마다 scheduler.js:2763 |
| 12 | A (포털JSON(로그인)) | 기상청 | 해역별 특보 통보문 이력 + 원문 PDF | marine.kma.go.kr /mmis_marine_api/v1/kma/warn/ef/list · warn/ntfctn/list (로그인) + PDF 파일 | 특보 구역 옆 통보문 목록·PDF 보기 | services/marine_client.js:95-96 · routes/weather.js:1021,1048,1070,1094 · client alert_history.js:411 |
| 13 | A (포털JSON) | 기상청 | 너울 위험등급(소해구) | marine.kma.go.kr /geoserver/mmis/ows (WFS marine_zone_swell) + /mdl/swell/kim/3h/marinezone/forecast-times | 해양생활 너울 탭·해안선 색칠 | services/swell_smallzone.js:45-46 · client marine-life/swell/swell.js:57 |
| 14 | A (포털JSON) | 기상청 | 시정 예측(RDPS) 그림 | marine.kma.go.kr /mmis_marine_api/v1/kma/mdl/rdps/imgList + /resources/mdl/khope/mvis/*.png | 시정 레이어·소해구 시정 뱃지 | services/vsby_smallzone.js:57 · client layers/vsby_forecast_layer.js:98 · routes/weather.js:1457 |
| 15 | A (포털JSON) | 기상청 | 천기(단기예보 격자 그림: 하늘·강수·기온 등) | marine.kma.go.kr /mmis_marine_api/v1/kma/shrt/netcdf/imgList + /resources/fct/shrt_gemd_img/*.png | 해양종합정보 「천기」 버튼 | client layers/shrt_forecast_layer.js:88 · routes/weather.js:1457 |
| 16 | A (포털JSON) | 기상청 | 이안류 등급(기상청 보강 3지점) | marine.kma.go.kr /mmis_marine_api/v1/kma/mdl/ripcrnt-1h | 이안류 지수(강문·안목·신지명사십리) | scheduler.js:2142,2185 |
| 17 | A (포털JSON) | 기상청 | 해상일기도 — 해상풍·파고 예측도 | weather.go.kr /w/wnuri-img/rest/cht/images/ocean-wave.do (+GIF) | 예보 탭 해상일기도(파고) | routes/marine_chart.js:50 · client forecast/marine-chart/marine_chart1.js:236 |
| 18 | A (포털JSON) | 기상청 | 해상일기도 — 폭풍해일고 예측도 | weather.go.kr /w/wnuri-img/rest/cht/images/ocean-forecast.do (+GIF) | 해상일기도(폭풍해일) | routes/marine_chart.js:51 |
| 19 | A (포털JSON) | 기상청 | 해상일기도 — 해류 예측도 | weather.go.kr /w/wnuri-img/rest/cht/images/ocean-forecast.do (자료 접두어만 다름 — 위 폭풍해일과 같은 엔드포인트) | 해상일기도(해류) | routes/marine_chart.js:52 |
| 20 | A (포털JSON) | 기상청 | 해상일기도 — 해수면온도(위성) | weather.go.kr /w/wnuri-img/rest/sat/images/water-temp.do (+GIF) | 해상일기도(수온) | routes/marine_chart.js:53 |
| 21 | A (정식) | 국립해양조사원 | 바다낚시 지수 | apis.data.go.kr /1192136/fcstFishingv2/GetFcstFishingApiServicev2 | 해양생활 낚시 | scheduler.js:763 · 09:10·09:40 :2702 · client marine-life/fishing/fishing.js:490 |
| 22 | A (정식) | 국립해양조사원 | 서핑 지수 | apis.data.go.kr /1192136/fcstSurfingv2/GetFcstSurfingApiServicev2 | 해양생활 서핑 | scheduler.js:2247 · client marine-life/surfing/surfing1.js:384 |
| 23 | A (정식) | 국립해양조사원 | 바다갈라짐 체험지수 | apis.data.go.kr /1192136/fcstSeaSplitv2/GetFcstSeaSplitApiServicev2 | 해양생활 바다갈라짐 | scheduler.js:1045 · client marine-life/sea-parting/sea_parting.js:97 |
| 24 | A (정식) | 국립해양조사원 | 갯벌체험 지수 | apis.data.go.kr /1192136/fcstMudflatv2/GetFcstMudflatApiServicev2 | 해양생활 갯벌 | scheduler.js:1292 · client marine-life/mudflat/mudflat.js:312 |
| 25 | A (정식) | 국립해양조사원 | 스킨스쿠버 지수 | apis.data.go.kr /1192136/fcstSkinScubav2/GetFcstSkinScubaApiServicev2 | 해양생활 스쿠버 | scheduler.js:1536 · client marine-life/scuba/scuba.js:365 |
| 26 | A (정식) | 국립해양조사원 | 해수욕 지수 | apis.data.go.kr /1192136/fcstBeachv2/GetFcstBeachApiServicev2 | 해양생활 해수욕 | scheduler.js:1722 · client marine-life/swimming/swimming.js:302 |
| 27 | A (정식 + 포털JSON) | 국립해양조사원 | 이안류 지수(+망상은 해양조사원 내부 RCData.do 보강) | apis.data.go.kr /1192136/ripCurrent/GetRipCurrentApiService · www.khoa.go.kr/oceandata/oceaninfo/ripcurrent/RCData.do | 이안류 지수·위험예측(risk_store.js:60,81) | scheduler.js:1889,2091 · 매시 5·35분 :2713 · client ripcurrent.js:292(화면 탭은 현재 숨김: marine-life/safety/README.md) |
| 28 | A (정식) | 국립해양조사원 | 항행경보(공식 텍스트) | apis.data.go.kr /1192136/NavigationalWarning/getNavigationalWarningInfo | 해양안전 「항행경보」 버튼 | routes/navigational_warning.js:50 · client marine-life/safety/navigational_warning.js:37 |
| 29 | A (정식) | 국립해양조사원 | 조석 예측(TideBED, 임의 좌표 3일치) | apis.data.go.kr /1192136/tidebed/GetTidebedApiService | 조석 지도·물빠짐·간출암 잠김경고·브리핑 물때 | services/tide_collector.js:44,272 · 매일 23:30 앵커 수집 scheduler.js:2844 · client tide.js:1122 |
| 30 | A (정식) | 국립해양조사원 | 해무 CCTV 스틸컷(9개 항) | apis.data.go.kr /1192136/seafogCctv/GetSeafogCctvApiService | CCTV 「해무」 지점 | routes/cctv_seafog.js:60,71(10분마다) · client ocean-map/cctv/cctv4.js:565 |
| 31 | A (포털JSON) | 국립해양조사원 | 해류·수온 예측 벡터(해아름, 현재~+72시간) | www.khoa.go.kr/oceandata/oceaninfo/prediction/dynamic-stream-vector.do | 해양종합정보 유향·유속 오버레이·바텀시트 | services/khoa_stream_cache.js:56 · 30분마다 scheduler.js:2593 · client ocean_overlay.js:879 |
| 32 | A (포털JSON) | 국립해양조사원 | 항행경보 구역·좌표 보강(미문서화 내부 API) | www.khoa.go.kr/nwb/getDocList.do · getDocAreaPoint.do | 항행경보 지도 구역 | routes/navigational_warning.js:51,347,361 |
| 33 | A (포털WMS) | 국립해양조사원 | 배경지도 — 기본맵(해아름 WMS) | www.khoa.go.kr/oceanmap/BASEMAP_RLTM3857/wmsVectordata.do | 지도 배경(기본) | routes/ocean1.js:238 · client ocean_map.js:58 |
| 34 | A (포털WMS) | 국립해양조사원 | 배경지도 — 전자해도(해아름 WMS) | www.khoa.go.kr/oceanmap/BASEMAP_ENC573857/wmsVectordata.do | 지도 배경(전자해도) | routes/ocean1.js:238 · client ocean_map.js:59 |
| 35 | A (포털WMS) | 국립해양조사원 | 배경지도 — 해안도(해아름 WMS) | www.khoa.go.kr/oceanmap/BASEMAP_RLTMCOAST3857/wmsVectordata.do | 지도 배경(해안도) | routes/ocean1.js:238 · client ocean_map.js:60 |
| 36 | A (정식) | 한국해양교통안전공단 | 해양교통 혼잡 예보(48시간) | apis.data.go.kr /B554035/sea-tfc-congst-fcst/get_sea_tfc_congst_fcst | 위험예측(해상 혼잡) | services/sea_traffic_collector.js:9 |
| 37 | A (정식) | 한국해양교통안전공단 | 선박사고 위험 예보(2일·3시간) | mtisopenapi.komsa.or.kr /eopt/api/sea-acdnt-risk-fcst-info | 위험예측(해상 사고위험) | services/sea_accident_collector.js:13 |
| 38 | A (정식) | 한국해양교통안전공단 | 실시간 선박 교통(격자별 척수·밀집도, 5분) | mtisopenapi.komsa.or.kr /api/v2/traffic/realtime | 위험예측(실시간 교통) | services/sea_realtime_collector.js:13 |
| 39 | A (정식) | 한국관광공사 | 관광지 집중률 예측 | apis.data.go.kr /B551011/TatsCnctrRateService/tatsCnctrRatedList | 위험예측(연안 사람 혼잡) | services/tour_concentration_collector.js:10 |
| 40 | A (정식) | 한국관광공사 | 지역 행사(공식 행사 목록) | apis.data.go.kr /B551011/KorService2/searchFestival2 | 위험예측(행사일 가산) | services/coastal_events_collector.js:15 |
| 41 | A (정식) | 기상청(공공데이터포털) | 해수욕장 단기예보(419곳) | apis.data.go.kr /1360000/BeachInfoservice/getVilageFcstBeach | 연안 해수욕장 날씨 | services/beach_weather_collector.js:37,246 |
| 42 | A (정식) | 기상청(공공데이터포털) | 해수욕장 수온 관측(419곳) | apis.data.go.kr /1360000/BeachInfoservice/getTwBuoyBeach | 연안 해수욕장 수온 | services/beach_weather_collector.js:37,260 |
| 43 | A (타일) | 국토교통부 | 브이월드 위성지도(영상+지명 라벨) | api.vworld.kr/req/wmts/1.0.0/{키}/Satellite·Hybrid (단말이 직접 호출) | 지도 배경(위성) | client ocean_map.js:204 · routes/ocean1.js:331 |
| 44 | B | 국립해양조사원 | 노출암·간출암·세암·암암(전자해도) — 6,829점 | client/hazard_rocks.json (원본: 전자해도 TL_UWTROC_P_LV5·TL_LNDARE_P_LV5) | 해양안전 「위험지형」+ 간출암 잠김경고 | client js/marine-life/safety/hazard_rocks.js:34 · scripts/build_hazard_rocks.js 머리말 |
| 45 | B | 국립해양조사원 | 갯바위 면(전자해도) — 9,959면(서·남해만) | client/shore_rocks.json (원본: TL_LEIHAZ_TROTSE_A) | 「위험지형」 갯바위 | client js/marine-life/safety/hazard_rocks.js:34-36 · scripts/build_shore_rocks.js:5 |
| 46 | B | 국립해양조사원 | 낚시통제구역 주제도 — 236곳 | client/fishing_ban_zones.json (원본: TL_RESARE_ENS) | 해양안전 「금지구역」 낚시금지 | client js/marine-life/safety/fishing_ban.js:20 · life_safety.js:1011 |
| 47 | B | 해양경찰청(각 해양경찰서 고시) | 출입통제구역 — 49곳 | client/access_control_zones.json (각 해경서 고시·공고 원문 좌표 전사) | 해양안전 「금지구역」 출입통제 | client js/marine-life/safety/access_control.js:24 · life_safety.js:1011 |
| 48 | B | 해양경찰청 | 선박교통관제(VTS) 구역 — 33곳 | client/vts_zones.json (kcg.go.kr 20개 VTS센터 공고 좌표) | 해양안전 「관제구역」 | client js/marine-life/safety/vts_zone.js:21 · life_safety.js:1038 |
| 49 | B | 국립해양조사원 · 해양수산부 | 항로·해역(항로 141 + 한중·한일 어업협정 수역 3) — 144개 | client/seaway_zones.json (개방海 WFS vi_seaway; 매월 말일 서버가 WFS와 대조·갱신) / 어업협정 수역 3은 해양수산부 협정 | 해양안전 「항로해역」 | client js/marine-life/safety/seaway.js:25 · services/seaway_refresh.js:46 · scheduler.js:2811 · life_safety.js:1044 |
| 50 | B | 국립해양조사원(원 자료 해양경찰청 기록) | 선박사고(해경) — 59,664행 | client/accident_ships_hk.json (원본: 개방海 TL_SHPACC_HK_P) | 해양안전 「사고정보」·브리핑 과거사고 | client js/marine-life/safety/accident_info.js:41 · scripts/build_accidents.js 머리말 · station_briefing_render.js:141 |
| 51 | B | 국립해양조사원(원 자료 해양경찰청 기록) | 인명사고 — 14,354행 | client/accident_persons.json (원본: 개방海 TL_NSHPAC) | 「사고정보」·연안 위험지수 과거사고(coast_accidents.json) | client js/marine-life/safety/accident_info.js:41 · scripts/build_coast_accidents.py 머리말 |
| 52 | B | 해양경찰청 | 연안사고 위험구역 — 820곳(2023-01-01 SHP) | local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson | 위험예측(연안 위험구역 개수)·브리핑 | services/risk_store.js:291 · client ocean-map/coastal-risk/coastal_safety_forecast.design.md:385 |
| 53 | B | 해양경찰청 | 파출소 관할 해역 — 97곳(각 지방해양경찰청 사무분장 규칙 별표1) | local_server/config/coastal_safety/coastguard_stations.geojson | 연안 안전 브리핑 관할 구분 | config/coastal_safety/coastguard_stations.geojson:1(_about.source) · services/risk_store.js:47 · station_briefing_inputs.js:80 |
| 54 | B | 한국관광공사 | 연안 관광지 목록·좌표 — 1,354곳(집중률 API 목록 + 국문관광정보 좌표) | local_server/config/coastal_safety/coastal_spots.json | 위험예측(연안 표시 기준점) | config/coastal_safety/coastal_spots.json:3(_about) · services/tour_concentration_collector.js:78 |
| 55 | B | 기상청 | 전국 해수욕장 목록·위경도 — 419곳(+몰운대 제외) | local_server/config/coastal_safety/beach_sources/kma_beaches.json → beach_weather_static.json | 해수욕장 날씨 수집 대상·관광지 연결 | beach_sources/kma_beaches.json:3 · services/beach_weather_collector.js:190 |
| 56 | B | 해양수산부 | 2026 지정·개장 해수욕장 일정 — 283행 | local_server/config/coastal_safety/beach_sources/mof_open_2026.json → beach_weather_static.json | 해수욕장 개장·폐장 표시 | beach_sources/mof_open_2026.json:3 · scripts/build_beach_weather_static.py 머리말 |
| 57 | B | 국립해양조사원(앱 안내문 표기) | 연간 조석표 2026~2028 — 조위관측소 27곳(CSV 원본 + tide_data_연도.js) | client/tide_data/tide_data_2026.js · 2027 · 2028 | 조석 지도(연간 표) | client tide.js:184 · life_safety.js:979(「연간 조석표」 출처 줄) ※파일 자체엔 기관 표기가 없음 |
| 58 | B | 국립해양조사원 | 수심 격자 BADA2024(위경도 정수별 59개 파일, Fly 볼륨) | local_server/data/bathymetry/ (저장소에는 없음 — 볼륨) | 바텀시트 수심 카드 | routes/ocean1.js:12-22,41 · client ocean_bottom_sheet5.js:126 · life_safety.js:1027 |
| 59 | B | 국립해양조사원 | 전자해도 해안선(자연·인공) 격자 — 물빠짐/고립판정 "마른 땅" 시드 | local_server/data/tide_field/coastline_cells.json | 물빠짐·간출암 고립판정, 너울 해안선 | scripts/build_coastline_cells.js:5 · scripts/build_coastline_segments.js 머리말 |
| 60 | B | 기상청 | 해상 특보구역 폴리곤 — 부모 44 + 자식(연안바다·평수구역) 49 | client/assets/warn_zones.geojson(MMIS WFS shp_wrn_poly) · warn_zones_sub.geojson(warnArea2Poly202106) | 특보구역 표시 | routes/weather.js:268-275,318 |
| 61 | B | 기상청 | 육상 특보구역(해안 접한 109개) | client/assets/warn_zones_land_coastal.geojson (원본 wrnArea_land.geojson — 기상청 날씨누리 파일) | 강풍특보(육상) 판정·사고정보 | scripts/build_coastal_land_zones.js 머리말 · client accident_info.js:3239 · risk_store.js:63 |
| 62 | B | 기상청 | 해구 격자 0.5° — 1,331칸(MMIS marine_zone/area) | client/marine_zone_area.json | 해구 번호·경계 | client ocean_map.js:236 · warnings/ocean_warn_vsby.js:169 |
| 63 | B | 기상청 | 과거 특보 구간 이력 2016-08~2025-12 — 290구역 | client/warn_intervals.json (원본: 기상청 통보문 CSV FCT_WRN 2016~2025) | 사고정보 「특보 발효 일수」 | scripts/build_warn_intervals.js:4 · scripts/warn_zone_parser.js:8 · client accident_info.js:3143 · life_safety.js:1002 |
| 64 | B | 법제처 | 법령 원문 — 법률·시행령·시행규칙(+별표·서식) | local_server/knowledge/legal/raw/*/*/법률.txt·시행령.txt·시행규칙.txt (국가법령정보센터 OpenAPI·DRF로 수집) | 나리야 법률 챗봇 지식(위키·검색) | raw/*/_meta.json "source" · services/admrul_fresh_scanner.js:9-11 · server.js:367(매일 01:00 개정감지) |
| 65 | B | 법제처 | 행정규칙(고시·훈령) 원문 | local_server/knowledge/legal/raw/*/*/행정규칙/ (target=admrul) | 나리야 법률 챗봇 | raw/*/_meta.json "source"(target=admrul) · services/admrul_fresh_scanner.js:9 · server.js:386(주 1회 점검) |
| 66 | B | 법제처 | 자치법규(조례·규칙) 원문 | local_server/knowledge/legal/raw/_자치법규/ | 나리야 법률 챗봇 | services/admrul_fresh_scanner.js:11 · server.js:386(주 1회 원문신선도 점검에 포함) |
| 67 | C | 기상청 | 해상 기상 전망 통보문(초단기·단기 해설) | www.weather.go.kr/w/special-report/list.do (HTML 읽기 + AI 정리) | 예보 탭 해상 기상 전망 | marine_forecast_processor.js:33 · 10분마다 scheduler.js:2781 · client marine_forecast.js:325 |
| 68 | C | 기상청 | 지방기상청 단기 전망 통보문(7개 지방청) | www.weather.go.kr/w/special-report/list.do?stn={지방청} | 예보 탭 지방청 단기 전망 | regional_bulletin_collector.js:83 · scheduler.js:2577,2746 · client marine_forecast.js:970 |
| 69 | C | 기상청 | 지방기상청 단기예보 PDF | www.weather.go.kr/w/repositary/xml/fct/rpt_wid_day_{시각}_{청}.pdf | 예보 탭 지방청 단기예보 | regional_forecast_collector.js:192 · scheduler.js:2716 |
| 70 | C | 기상청 | 태풍 통보문·예보표(+TD정보·통보문 그림) — 방재기상플랫폼 로그인 | dmdw.kma.go.kr /rsw/mfp/typ/rswTypInfoRetrieve · rswTypTdRetrieve · /rsw/rest/mfp/typ/file?mode=img | 태풍 탭·태풍 푸시·위치기반 태풍 반경 알림 | typhoon_crawler.js:59,74-75,454 · 10분마다 scheduler.js:2789 · routes/typhoon.js:93 · ※운영 계정 설정 여부는 코드로 확인 불가 |
| 71 | C (CCTV) | 거제시 | 거제시 재난 CCTV(HLS 영상) — 27지점 | www.geoje.go.kr/safety/stream/v1/hls/vurix/100001/{id}/0/0 | CCTV 레이어 | client ocean-map/cctv/cctv1.js:128-151 |
| 72 | C (CCTV) | 옹진군 | 옹진군 재난 CCTV(iframe) — 85지점 | http://218.148.169.193/content/channelView.hu?cctv_idx={id} | CCTV 레이어 | client cctv1.js:201-230 |
| 73 | C (CCTV) | 부산광역시 | 부산시 안전ON CCTV(iframe) — 48지점 | safecity.busan.go.kr/#/cctv?cnt=&cctv_cd= | CCTV 레이어 | client cctv1.js:338-379 |
| 74 | C (CCTV) | 해양수산부 | 연안침식 모니터링 CCTV(이미지, 3초 갱신) — 38지점(하맹방 2대 → 카메라 39대) | http://220.95.232.18/camera/{beach}_{cam}.jpg (서버가 대신 받아 전달) | CCTV 레이어 | client cctv1.js:450-479 · routes/ocean1.js:352,362 |
| 75 | C (CCTV) | KBS(공영방송 — 행정기관 아님) | KBS 파노라마 CCTV(iframe) — 30지점 | md.kbs.co.kr/special/cctvShare?cctvId={id} | CCTV 레이어 | client cctv1.js:45-77 |
| 76 | D | 미국 해군 합동태풍경보센터(JTWC) | 태풍 경보(통보문 텍스트 + 위험구역·지나온 경로 KMZ + 경고 그림 GIF) | www.metoc.navy.mil/jtwc/products/abpwweb.txt·abioweb.txt·wp*web.txt·wp*.kmz·wp*.gif | 태풍 탭 출처 「미국(JTWC)」 | routes/typhoon_foreign.js:78,85-89 · client typhoon/ocean_typhoon.js:96 |
| 77 | D | 일본 기상청(JMA) | 태풍 예보(targetTc·specifications·forecast.json) | www.jma.go.jp/bosai/typhoon/data/ | 태풍 탭 출처 「일본(JMA)」 | routes/typhoon_foreign.js:95,336,343,347 · client ocean_typhoon.js:100 |
| 78 | D | 유럽중기예보센터(ECMWF) | IFS 모델 태풍 경로(BUFR, CC-BY-4.0) | data.ecmwf.int/forecasts/{날짜}/{시}z/ifs/0p25/oper/*-oper-tf.bufr | 태풍 탭 출처 「유럽(ECMWF)」 | routes/typhoon_foreign.js:97,417 · client ocean_typhoon.js:105 |
| 79 | E (AI) | Google | Gemini API(해설 분석·나리야 답변·웹검색 근거·행사 보충검색·임베딩) | @google/genai (모델 gemini-2.5-flash 등; googleSearch 도구) | AI 비서·나리야·특보/전망 AI 정리·행사 보충 | services/gemini_client.js:22 · routes/assistant.js:1700 · services/coastal_events_collector.js:244 · services/topic_embedding.js:26 |
| 80 | E (AI) | OpenAI | ChatGPT(Codex 중계) — 브리핑 AI 문단 기본 방식 + 관리자 모드 나리야 | services/codex_bridge.js (VM 작업자 경유) | 연안 안전 브리핑 AI 총평(기본 method=chatgpt, 실패 시 Gemini)·관리자 기기 나리야 답변 | services/station_briefing.js:140,191-192 · services/codex_bridge.js:10 · 일반 사용자 나리야는 기본 Gemini(codexForUsers 기본 꺼짐) |
| 81 | E | 카카오 | 카카오 로컬 API(장소 키워드 검색·행사 주소→좌표) | dapi.kakao.com/v2/local/search/keyword.json | 조석 지도 장소 검색 · 행사 좌표 변환 | routes/tide.js:486 · client tide.js:504 · services/coastal_events_collector.js:65 |
| 82 | E | 네이버 | 네이버 검색 API(나리야 「모르는 구어」 뜻 확인) | naverapihub.apigw.ntruss.com | 나리야 답변 보조(근거로 인용하지 않음) | services/naver_search.js:23 · routes/legal.js:2013 |
| 83 | E | OpenWeather | 해면기압(현재·3시간 예보 5일) | api.openweathermap.org/data/2.5 (weather·forecast) | 바텀시트 기압 카드 | routes/pressure.js:49 · client ocean_bottom_sheet5.js:225 · index2.html:4672(출처 표기) |
| 84 | E (타일) | OpenStreetMap | OSM 세계지도 타일 | ol.source.OSM() (tile.openstreetmap.org) | 지도 배경 「세계지도」·시정 팝업 지도 | client ocean_map.js:835 · warnings/ocean_warn_vsby.js:802 |
| 85 | E (임베드) | Windy | Windy 임베드 지도(파고·ECMWF) | embed.windy.com/embed2.html | 해구 상세창 「Windy」 | client forecast/alerts/marine.js:566 |
| 86 | E (정적) | 오픈 지리데이터(@geo-maps/earth-lands-10m) | 세계 육지 폴리곤(정적 파일) | client/land_mask_korea.json (npm 패키지에서 생성) | 육지 마스크·해안선 판정 | scripts/generate_land_mask.js:24 · routes/ocean1.js:540 |

### 링크만 (집계에서 제외)

| 번호 | 내용 | 근거 |
|---|---|---|
| L1 | Windy 지점 링크 45개(해역별 windy.com 바로가기) | client/js/core/config.js:290 |
| L2 | 기상청 「통보문」「특보종합」 웹페이지 팝업(iframe) | client/index2.html:3140,3142 · shared/ui/ui_modal.js:38 |
| L3 | 예비특보 통보문 바로가기(weather.go.kr list.do?kind=pwn) | local_server/routes/weather.js:1161 |
| L4 | CCTV 팝업 외부 버튼(KBS재난포털·거제시·부산 안전ON·연안포털·해양데이터포털) | client/js/ocean-map/cctv/cctv1.js:60-63,142,368,466,566 |
| L5 | law.go.kr 원문·별표 파일 링크 | client/js/ai-chat/ai_chat.js:1541,2094 · local_server/routes/legal.js:2317 |
| L6 | PDF 통보문 보기(Google Docs 뷰어) | client/js/forecast/alerts/alert_history.js:503 |
| L7 | OpenWeather 출처 표기 링크 | client/index2.html:4672 |

## 2. 집계

| 항목 | 값 |
|---|---|
| A 공공 API(실시간·주기) | **43종** (정식 오픈API 23 + 포털 공개 JSON·지도 20) |
| B 공공 정적 파일 | **23종** |
| C 공공 웹 화면·통보문·영상 읽기 | **9종** (통보문·PDF·태풍 4 + 지자체·부처 CCTV 영상 5) |
| **공공(A+B+C) 합계** | **75종** |
| D 해외 기관 | **3종** (기관 3곳) |
| E 민간·기타 | **8종** (제공자 8곳: Google·OpenAI·카카오·네이버·OpenWeather·OpenStreetMap·Windy·오픈 지리데이터) |
| 전체(A~E) | **86종** |
| L 링크만 | 7묶음(집계 제외) |

**국내 공공 제공 기관: 11곳** — 기상청 · 국립해양조사원 · 한국해양교통안전공단 · 해양경찰청 · 한국관광공사 · 법제처 · 해양수산부 · 국토교통부(브이월드) · 거제시 · 부산광역시 · 옹진군
  - 중앙·공공기관 8곳 + 지자체 3곳. KBS(공영방송, 행정기관 아님)는 CCTV 1종을 내므로 넣으면 12곳.
  - 공공데이터포털(data.go.kr)은 통로라서 기관으로 세지 않았다(기상청·국립해양조사원·해양교통안전공단·한국관광공사의 API가 그 통로로 들어옴).
  - 해양경찰청은 코드가 직접 호출하는 API가 아니라 **정적 파일**(위험구역·파출소 관할·VTS·출입통제)과 개방海 사고자료의 원 기록으로만 쓰인다.
**해외 기관: 3곳** — 미국 해군 합동태풍경보센터(JTWC) · 일본 기상청(JMA) · 유럽중기예보센터(ECMWF)
**민간·기타 제공자: 8곳(8종)** — Google Gemini · OpenAI ChatGPT · 카카오 · 네이버 · OpenWeather · OpenStreetMap · Windy · 오픈 지리데이터(@geo-maps).

### CCTV

| 구분 | 기관 | 지점 | 비고 |
|---|---|---|---|
| 국립해양조사원 해무 CCTV | 국립해양조사원 | 9 | 공공데이터포털 API, 스틸컷(10분 갱신) |
| 거제시 재난 CCTV(HLS 영상) | 거제시 | 27 | www.geoje.go.kr/safety/stream/v1/hls/vurix/100001/{id}/0/0 |
| 옹진군 재난 CCTV(iframe) | 옹진군 | 85 | http://218.148.169.193/content/channelView.hu?cctv_idx={id} |
| 부산시 안전ON CCTV(iframe) | 부산광역시 | 48 | safecity.busan.go.kr/#/cctv?cnt=&cctv_cd= |
| 연안침식 모니터링 CCTV(이미지, 3초 갱신) | 해양수산부 | 38 | http://220.95.232.18/camera/{beach}_{cam}.jpg |
| KBS 파노라마 CCTV(iframe) | KBS(공영방송 — 행정기관 아님) | 30 | md.kbs.co.kr/special/cctvShare?cctvId={id} |

**CCTV 제공처 6곳**(국립해양조사원·해양수산부·거제시·부산광역시·옹진군 = 공공기관 5곳, + KBS) · **지점 237개**(9+27+85+48+38+30) · 카메라 238대(연안침식 하맹방 1지점이 카메라 2대: cctv1.js:498).
  - 셈 방법: `cctv1.js` 를 node 로 불러 `CCTV_PROVIDERS` 의 `items.length` 를 합산(아래 명령 9번). 지점 id·좌표 모두 중복 없음 확인.

### 엔드포인트 기준(상한) · 보수적 묶음 기준(하한)

- **엔드포인트/파일 기준으로 풀어 세면**(코드에서 확인한 주소 개수를 위 표 기준에 더하고 뺀 값, 로그인·목록 조회 같은 보조 호출은 제외): A 43 → **51** (해상특보 6엔드포인트 +5 · 특보통보문이력 2 +1 · 너울 2 +1 · 이안류지수 2 +1 · 항행경보 보강 2 +1 · 해상일기도 폭풍해일/해류가 같은 ocean-forecast.do -1), B 23 그대로, C 9 → **10** (태풍 dmdw 3 +2 · 해상전망과 지방청 전망이 같은 list.do -1), D 3 → **9** (JTWC 5 +4 · JMA 3 +2), E 8 그대로 → 합계 **101**, 공공(A+B+C) **84**. 발표 숫자는 위 「종」 기준(공공 75 / 전체 86)을 쓰는 것을 권한다.
- **보수적으로 묶으면**(전부 같은 서비스로 보고 줄이는 경우): 해아름 배경지도 3→1(-2), 해상일기도 4→1(-3), 기상청 MMIS 부이 3종 →1(-2), 생활해양지수 6→1(-5), CCTV 5→1(-4) 을 모두 적용하면 공공 75종 → 59종. 이 묶음은 선택 사항이며 근거 없는 강제가 아니라 「발표에서 숫자를 줄여 말하고 싶을 때」의 참고다.

## 3. 확인 못함 / 제외한 것과 이유

- **ROMS 유향·유속·수온 API (apis.data.go.kr/1192136/roms/GetRomsApiService)** — 서버 라우트(routes/ocean2.js:34,86,192)·합성(ocean4.js:301)은 있으나 **클라이언트가 /api/ocean/roms*·/api/ocean/all 을 호출하는 곳을 못 찾음**(client/js·index2.html 전수 grep). 현재 화면 해류는 31번(해아름 dynamic-stream-vector)이 대신함. → 제외.
- **기상청 API허브 fct_afs_dl.php (SEA_FORECAST)** — scheduler.js:183 에 주소 상수만 있고 호출하는 줄이 없음(grep). → 제외.
- **기상청 API허브 kma_buoy.php (KMA_BUOY)** — collectKmaBuoys() 첫 줄에 `return;` — 2026-04-25 폐기(scheduler.js:354-356). → 제외.
- **MMIS fct/netcdf/small-area/latlon/data/detail (해구 시정 상세)** — client/js/forecast/alerts/marine.js:297 에 상수만 있고 사용하는 줄 없음(전수 grep 1건). → 제외.
- **방재기상플랫폼 특보 크롤러(dmdw_warn_crawler.js)·날씨누리 특보 크롤러(weather_alerts_crawler.js)** — scheduler.js 에서 호출 줄이 주석 처리됨(scheduler.js:2761 weatherAlertsCrawler.run, :2776-2777 dmdwWarnCrawler.run). 특보는 MMIS 단일 출처(11번)로 통합. → 제외.
- **OpenStreetMap Nominatim (accident_geocode_review.js:112)** — 사고 지오코딩 검수 화면. 트리거 비활성화됨(marine-life/safety/README.md:161 「트리거 비활성화됨(2026-08-23)」). → 제외.
- **관할서 경계 검수 레이어(coastguard_jurisdiction_boundaries.json, 법제처 별표 기반)** — 사고정보 버튼 20회 연타로만 열리는 숨김 검수 화면(scripts/build_jurisdiction_boundaries.js 머리말). 일반 기능이 아님 → 제외(원자료: 법제처 별표 byl2_jurisdiction_raw.txt).
- **client/assets/sea_sterm_zones.geojson (서버 /api/sea-sterm-zones, weather.js:302)** — 서버가 서빙하지만 client/js·index2.html 어디에도 이 주소를 부르는 줄이 없음. → 제외.
- **분석 단계 전용 입력(앱 실행 중 호출 아님)** — 가중치·점수를 정하려고 개발 때 받은 자료: 관광데이터랩(방문자, 한국관광공사)·기상청 API허브/포털 AWS·해구 예측 과거분·특보 이력·웹조사 행사 163행 등 (local_server/tools/coastal_accident_analysis/README.md, config/coastal_safety/accident_analysis/). 앱이 실행 중에 호출하지 않음 → 집계 제외. 결과(가중치)만 코드에 반영됨.
- **events_2020_2025.csv (과거 행사 163행, 웹 조사)** — 공공데이터가 아니라 개발자가 뉴스 등으로 조사한 자체 기록(events/notes.md). Gemini 행사 보충검색 프롬프트 예시로만 쓰임(coastal_events_collector.js:13,139). → 제외.
- **인프라성 외부 호출** — Firebase(푸시)·Cloudinary(사진 업로드)·Google Cloud Storage(백업)·DuckDNS·구글 접속 확인(scheduler.js:100)·GitHub API(법령 원문 읽기: services/github_raw.js:15, 자체 저장소) — 데이터 원천이 아니라 앱 운영 도구. → 제외.
- **연간 조석표(64번)의 제공 기관** — 파일 헤더에는 기관 표기가 없다(tide_data_2026.js:1-4 「자동 생성됨」). 앱 안내문 life_safety.js:979 가 「국립해양조사원 … 연간 조석표」로 한 줄에 묶어 적었을 뿐이라, **기관은 안내문 표기에 의존**. 발표에 쓰려면 원본 다운로드 출처를 사용자가 확인해야 함. (표에는 넣되 꼬리 표기)
- **수심 격자 BADA2024(65번) 원본** — 저장소에는 파일이 없고 Fly 볼륨에만 있음(ocean1.js:41). 기관은 life_safety.js:1027 안내문 표기(국립해양조사원)로만 확인. 파일 자체는 확인 못함.
- **운영 비밀값(실제로 값이 설정돼 있는지)** — 태풍 dmdw 계정(KMA_DMDW_USER_ID/PWD)·네이버 키·OpenWeather 키·카카오 키 등은 Fly secrets 라 저장소에서 확인 불가. 코드상 사용 경로만 확인함(미설정이면 해당 기능이 조용히 꺼짐: typhoon_crawler.js 상단 enabled 가드, pressure.js 머리말 no_key 처리).
- **데이터 수집 목록표 개수** — 사용자 지시문은 「33개」, 실제 `data_collection_manifest.json` 의 items 는 **32개**, 제공처 9곳(JSON 파싱으로 셈). 그중 stationBriefing 은 외부 호출 없는 자체 생성이라 외부 원천은 31개. 이 표는 위 31개 중 gale 은 11번(특보)에 합쳐졌고 나머지는 모두 포함 + 목록에 없던 항목을 더함.
- **KBS·옹진군 CCTV 영상의 실제 운영 기관 이름** — KBS/옹진군/부산/거제는 cctv1.js 의 `name` 표기를 기관으로 적었다. 옹진군 호스트(218.148.169.193)가 실제 누구 소유인지는 코드로 확인하지 못함(표기 의존).

## 4. 숫자를 어떻게 셌나 (명령)

1. `git archive origin/main client local_server/routes local_server/services local_server/advisory local_server/scheduler.js local_server/server.js local_server/config local_server/*.js | tar -x -C <scratchpad>/src` — origin/main 사본 추출(줄 번호 = origin/main).
2. `grep -rnoE "https?://[A-Za-z0-9._-]+" local_server --include=*.js (tools·scripts·test 제외)` / `grep ... client/js index2.html` — 외부 호스트 호출 후보 전수 추출 후, 후보마다 호출 코드가 실행 경로(스케줄러·server.js 등록 라우트·클라이언트 fetch)에 있는지 `grep -n` 으로 확인. 호스트가 같아도 주석뿐이거나 상수만 있는 것은 제외(3절).
3. `python3 -c "import json;d=json.load(open(manifest));print(len(d['items']),len(d['providers']))"` → 32 9.
4. `grep -rn "process.env\.[A-Z_]*" local_server --include=*.js -o | sort | uniq -c` — 키가 필요한 원천(ROMS_SERVICE_KEY·GEMINI·KAKAO·NAVER·OPENWEATHER·VWORLD·KMA_DMDW_*·MARINE_USER_* 등) 교차확인.
5. `python3 ev.py` (표의 근거 줄 번호를 정규식으로 찾아 file:line 출력) — 모든 `파일:줄` 은 이 스크립트 또는 `grep -n` 으로 얻음.
6. 정적 데이터 개수: `python3 -c "json.load(...)['features']"` — fishing_ban 236 · access_control 49 · vts 33 · seaway 144(category 카운트 항로(면)77·통항분리수역26·통항분리대17·지정항로12·주의해역5·선회장4·해역3) · hazard_rocks 6,829(k=0:4,287 / k=1:1,778 / k=2:658 / k=3:106) · shore_rocks 9,959 · warn_zones 44 · warn_zones_sub 49 · warn_zones_land_coastal 109 · marine_zone_area 1,331 · warn_intervals zones 290(2016-08-26~2025-12-28) · accident_ships_hk rows 59,664 · accident_persons rows 14,354 · coastguard_stations 97 · coastal_hazard_zones 820 · coastal_spots 1,354 · kma_beaches 420행(몰운대 제외 419) · mof_open_2026 283행.
7. 법령 원문 규모: `git ls-tree -r --name-only origin/main -- local_server/knowledge/legal/raw | wc -l` → 15,713파일(별표 9,099 · 행정규칙 4,255 · 법률.txt 305 · 시행령.txt 160 · 시행규칙.txt 116 · _meta.json 484). 「행정규칙 653건·법령 222건·자치법규 416건」은 services/admrul_fresh_scanner.js:9-11 주석 숫자이며 내가 다시 세지는 않음.
8. 국내 기관 11곳: 위 표의 `제공 기관` 열에서 중복 제거(법제처·해양수산부·국토교통부·지자체 3 포함). 해외 3·민간 8 도 같은 방식.
9. CCTV: `cd client/js/ocean-map/cctv && node -e "global.window={};eval(require('fs').readFileSync('cctv1.js','utf8')+';global.P=CCTV_PROVIDERS');..."` → kbs 30 · geoje 27 · ongjin 85 · busan 48 · coastal 38 · seafog 9 = 237, 각 provider 의 cctvId·좌표 중복 0. 연안침식 하맹방 `cameraCount: 2`(cctv1.js:498) → 카메라 238대.
10. 분류별 종 수: 이 문서를 만든 생성 스크립트(gen.py)가 표 행의 분류 칸을 `Counter` 로 합산 — 수동 계산 아님.

### 부기 (조사 중 눈에 띈 것, 발표 숫자와 무관)
- 코드에 공공데이터포털 서비스키·MMIS 로그인 계정·브이월드 키가 평문 상수로 들어 있다(예: routes/cctv_seafog.js:54, services/marine_client.js:53-58, routes/ocean1.js:329). 값은 이 문서에 옮기지 않았다. 저장소가 비공개라는 전제(주석)이며, 발표·공개 자료에는 절대 넣지 말 것.