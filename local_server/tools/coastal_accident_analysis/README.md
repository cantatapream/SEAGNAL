# coastal_accident_analysis — 해안·해상 안전 예보 가중치용 과거 사고 분석 스크립트

해안·해상 안전 예보(`client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` §10)의 가중치를
과거 사고(인명 2020~24, 선박 2020~25)로 검증한 분석 스크립트 모음. 결과 보고서·표·가공 자료는
`local_server/config/coastal_safety/accident_analysis/` 에 있다.

- 실행 순서: `run_all.sh` (원본 — 해구 예측 zip·AWS 시간자료·DataLab 원문 — 은 크기 때문에 저장소에 없다.
  분석 당시 세션의 작업 폴더 경로가 박혀 있으니, 다시 돌릴 때는 원본을 다시 받고 경로를 바꿔야 한다)
- 키(data.go.kr·기상청 API허브)는 파일에서 읽는다 — 스크립트에 들어 있지 않다.
- 방법: 시간층화 사례교차(= 조건부 포아송), `ccr.py`. 검산 `test_ccr.py`.
- `17_event_days.py`: 행사일 vs 같은 시군구·같은 달·같은 요일 비교(설계서 §7.1). 다른 스크립트와 달리 저장소 안 파일만으로 돈다.

## v2 (2026-10-10) — 변사 제외 · 계절별 · 상세 보고서
- 인명 입력(`geo_person.csv`)에서 변사를 뺀 작업 폴더로 07~16 을 다시 돌림. 바뀐 스크립트: `07_person.py`·`09_spots.py`·`10_severity.py`(변사 묶음 제거), `16_tables.py`(신뢰구간 상·하한 비 50배 초과 → "추정 불안정"), `08_ship.py`(시각 맞춤 층 행도 저장).
- 새 스크립트: `18_season.py`(계절별 모형) · `18b_season_desc.py`(계절별 건수표·조건 빈도) · `19_season_tables.py`(계절별 표) · `20_extra_tables.py`(월별 신뢰구간·2025 제외 비교) · `17b_event_table.py`(행사일 표) · `21_build_report.py`(본문 + 표 조립 — 표 숫자를 손으로 옮기지 않음) · `22_check_citations.py`(본문 인용 숫자 ↔ 표 대조).
- 결과: `local_server/config/coastal_safety/accident_analysis/v2/report.md`. 재현 순서는 그 문서 §11.

## v3 (2026-10-10) — 독립 검증 반영
- 군집 = 사고 날짜(`07_person.py`·`08_ship.py`·`10_severity.py`). 표에 ‡(구간비 20~50배) 표시(`16_tables.py`·`19_season_tables.py`), 방문자 보정 요일 표 추가.
- 새 스크립트: `14b_warn_equiv_alldays.py`(특보 상당 표 전체 날짜) · `17c_event_ccr.py`(행사일 조건부 포아송) · `23_checks.py`(계절 간 차이 검정·BH q·2023 충돌 민감도·평소 대비 칸) · `24_points.py`(A안 점수표).
- 결과: `local_server/config/coastal_safety/accident_analysis/v3/report.md`.

## v3.1 (2026-10-10) — 재지 않았던 요소 전수 측정(보고서 §12)
- 새 스크립트: `28_fatal_points.py`(모든 점수 요소의 전체·사망실종 배수, 12개월 1년 평균 대비) · `27_fatality_warn.py`(연안 특보 날 치명률, 계절·유형별) · `26_summer_bonus.py`(여름·9월·달별 대 나머지 8개월) · `30_swell.py`(너울 — 파도 주기 대리값) · `31_extras.py`(사람×위험구역 상호작용 · 주의보 안 파고 4m · 선박 주말·달 · 주말 계절 차이) · `01b_marine_fcst_leads.py`(원자료 zip 에서 하루·이틀·사흘 전 예보 일 최대값) · `32_fcst_leads.py`(예보 lead 별 특보 일치·사고 배수) · `33_prewarn.py`(예비특보 → 실제 특보 전환·예비 범위 시간의 사고 배수) · `34_points_v31.py`(점수표 v3.1). `22_check_citations.py` 는 새 결과 파일까지 대조.
- 예비특보 원자료: 기상청 API허브 `api/typ01/url/wrn_met_data.php?wrn=A&reg=0&tmfc1=YYYYMM010000&tmfc2=YYYYMM<말일>2359&disp=1&help=0`(월 단위, 키는 파일에서), 구역 이름은 `wrn_reg.php?tmfc=0&disp=0&help=1`. 해상 풍랑·태풍만 뽑은 것이 `accident_analysis/v3/data/wrn_sea_VT_2020_2025.csv.gz`(`33_prewarn.py` 의 세 번째 인자로 그대로 쓴다). 예비의 `TM_EF` 는 예정 범위의 **끝**이다.
- `marine_fcst_daily.csv.gz`(11MB)는 크기 때문에 저장소에 없다 — 해구 예측 zip 을 다시 받아 `01b_marine_fcst_leads.py` 로 만든다.
