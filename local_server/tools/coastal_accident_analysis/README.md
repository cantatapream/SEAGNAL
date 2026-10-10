# coastal_accident_analysis — 해안·해상 안전 예보 가중치용 과거 사고 분석 스크립트

해안·해상 안전 예보(`client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` §10)의 가중치를
과거 사고(인명 2020~24, 선박 2020~25)로 검증한 분석 스크립트 모음. 결과 보고서·표·가공 자료는
`local_server/config/coastal_safety/accident_analysis/` 에 있다.

- 실행 순서: `run_all.sh` (원본 — 해구 예측 zip·AWS 시간자료·DataLab 원문 — 은 크기 때문에 저장소에 없다.
  분석 당시 세션의 작업 폴더 경로가 박혀 있으니, 다시 돌릴 때는 원본을 다시 받고 경로를 바꿔야 한다)
- 키(data.go.kr·기상청 API허브)는 파일에서 읽는다 — 스크립트에 들어 있지 않다.
- 방법: 시간층화 사례교차(= 조건부 포아송), `ccr.py`. 검산 `test_ccr.py`.
- `17_event_days.py`: 행사일 vs 같은 시군구·같은 달·같은 요일 비교(설계서 §7.1). 다른 스크립트와 달리 저장소 안 파일만으로 돈다.
