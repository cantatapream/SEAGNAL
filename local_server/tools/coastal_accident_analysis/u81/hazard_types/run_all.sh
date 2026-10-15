#!/bin/bash
# 위험구역 종류별 재분석 전체 재현. 사용: bash run_all.sh <data 폴더> [결과 폴더]  (약 2분)
set -e
W=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$W/../../../../.." && pwd); TOOLS=$REPO/local_server/tools/coastal_accident_analysis
D=${1:?사용: bash run_all.sh <04_geo.py 등이 만든 data 폴더> [결과 폴더]}   # §4.6 중간 파일(tools/run_all.sh 의 04_geo.py 산출) — 00 이 저장소 원자료와 대조
OUTDIR=${2:-$W/work}
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1   # 다중 스레드 BLAS 가 이 환경에서 적합을 크게 느리게 함
mkdir -p "$OUTDIR"; cd "$OUTDIR"; mkdir -p out repro; SRC=$W
python3 -I "$SRC/00_verify_inputs.py" "$REPO" "$D" out > out/log_00_verify.txt 2>&1
python3 -I "$TOOLS/09_spots.py" "$D" repro > repro/log_09.txt 2>&1
python3 -I "$TOOLS/09c_bins_compare.py" repro > repro/log_09c.txt 2>&1
python3 -I "$SRC/01_type_models.py" "$D" repro out > out/log_01.txt 2>&1
python3 -I "$SRC/02_overlap.py" "$REPO" out > out/log_02.txt 2>&1
python3 -I "$SRC/03_scores.py" out > out/log_03.txt 2>&1
python3 -I "$SRC/04_sensitivity.py" out > out/log_04.txt 2>&1
python3 -I "$SRC/05_oos.py" out > out/log_05.txt 2>&1
python3 -I "$SRC/07_crosscheck.py" out > out/log_07.txt 2>&1
python3 -I "$SRC/06_build_report.py" "$REPO" "$OUTDIR"
echo ALL DONE
