# U81 근거 분석 (2026-10-15)

연안 위험지수 U81 개편(사람 = 그 관광지 30일 평균 대비 · 위험구역 = 종류별 후보 A · 달 점수 재추정)의 근거 분석 스크립트.
처음엔 세션 작업 폴더에서 만들었고, 같은 날 저장소로 옮겼다. 결과 파일은 `local_server/config/coastal_safety/accident_analysis/v3/data/u81/`.
설명은 분석 보고서 `v3/report.md` §13, 설계서 `client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` U81.

| 파일 | 하는 일 | 사용 |
|---|---|---|
| `hazard_types/run_all.sh` | 위험구역 종류별(위험·사망사고 발생·다발) 재분석 전체 — §4.6 재현 후 종류별 모형·후보 A 점수표·보고서 | `bash run_all.sh <data 폴더> [결과 폴더]` (data 폴더 = 상위 `run_all.sh` 의 `04_geo.py` 등이 만든 중간 파일, 약 2분) |
| `hazard_types/00~07_*.py` | 위 단계별 스크립트(09_spots·09c 는 상위 폴더 것을 그대로 부름) | run_all.sh 가 부름 |
| `month_relative.py` | 달 점수 재추정 — 노출을 log2(외지인 방문자 ÷ 그날부터 30일 기하평균)으로 바꾼 조건부 포아송(ccr.py) | `python3 -I month_relative.py <tools 폴더> <data 폴더> <결과 폴더>` |
| `make_month_md.py` | 위 결과 CSV → 표 md | `python3 -I make_month_md.py <결과 폴더>` |
| `preview.js` | 새 scoreCoast 로 관광지 1,354곳 단계 분포 미리보기(10-09 수집 30일 집중률 필요 — 저장소에 없음) | `node preview.js <저장소> <base.json>` |

재현 확인: 2026-10-15 저장소 사본 `hazard_types/run_all.sh` 를 다시 돌려 `type_models.csv`·`model_compare.csv`·`equality_tests.csv`·`score_tables.csv`·보고서가 원래 결과와 같음(cmp·diff).
`06_build_report.py` 는 「U81 이전 앱 점수표」와 비교하므로 그 판(커밋 1827a30dc 직전)을 git 에서 읽는다.
