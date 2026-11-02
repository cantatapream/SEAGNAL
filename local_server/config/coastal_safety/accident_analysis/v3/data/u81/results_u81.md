# U81 구현 분석 결과 (2026-10-15)

모든 숫자는 이 폴더 스크립트의 출력이다.

## 파일
- `month_relative.py` — 달 재추정(조건부 포아송, 28_fatal_points.py 달 칸과 같은 틀, 노출만 log2(방문자 ÷ 그날부터 30일 기하평균)). 출력 `out/month_relative.csv`(7모형 × 2결과 × 12개월), 로그 `log_month_relative.txt`.
  재현: `OMP_NUM_THREADS=1 python3 -I month_relative.py /home/user/SEAGNAL/local_server/tools/coastal_accident_analysis ../analysis_v3/data out` (약 3분)
- `make_month_md.py` — csv → `out/month_relative.md`(보고서 v3 §13.2 에 그대로 붙인 표).
- `sim_baseline_rerun.txt` — 적대 검토 `coast_redteam/sim_baseline.py` 재실행 출력(1월 −0.94 · 7월 +0.70 · 8월 +0.75 · 9월 +0.77 재현).
- `preview.js` — 10-09 수집 30일 집중률(`coast_alt/base.json`)로 실제 scoreCoast·averages30 를 돌린 단계 분포.

## 달(주 모형 M) — 앱 risk_points.js MONTHS 에 넣은 값
(out/month_relative.md 표 참조) 1월 −0.95 · 2월 −0.60 · 3월 −0.22 · 4월 −0.14 · 5월 +0.19 · 6월 +0.30 · 7월 +0.71 · 8월 +0.74 · 9월 +0.73 · 10월 +0.07 · 11월 −0.27 · 12월 −0.60.
검산: 같은 스크립트 R0(종전 방식)이 종전 표 12개월을 그대로 재현.

## 위험구역 후보 A
계수 0.43914371217365067 = log2(1.355799376249529) — `../hazard_type_analysis/out/type_models.csv` b3= 2023~24 전체. 사망·실종 1.3633303367286298(같은 파일 n_fatal_2023_24 b3=).
구현 대조: risk_spots.json 1,354곳 모두 `s_candA` 와 같음(최대 차이 4.4e-16).

## 미리보기(행사·너울·이안류·특보 없음, 평소 수준/다소 높음/높음/매우 높음)
- 10-15(목): 397 / 879 / 77 / 1 (달만 +0.02 로 바꾸면 407/872/74/1 — 오케스트레이터 사전 계산과 같음)
- 10-17(토): 112 / 852 / 356 / 34 (달만 +0.02 → 127/859/339/29 — 같음)
