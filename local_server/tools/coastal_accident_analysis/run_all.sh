#!/bin/bash
# 전체 재현 순서(약 15~20분, 원본 zip·csv 가 있을 때). 사용: bash run_all.sh <작업폴더>  (작업폴더 안에 node_stub/@turf/turf 빈 모듈이 있어야 한다 — dump_warn_intervals_exact.js 용)
# 원본: ../kma/marine/zip/*.zip (해구 예측 72개월) · ../kma/aws/csv/*.csv.gz (AWS 시간 풍속) · dl/datalab/raw (DataLab 월별 JSON, 없으면 datalab_dl.py 로 받음)
#       dl/apihub/z_2025123100_h000.txt (해구 좌표·번호 대조용 apihub 응답) · dl/aws_stn/aws_stn_meta_download.bin (AWS 지점정보, 포털)
#       dl/admdong/HangJeongDong_ver20241231.geojson (시군구 경계, vuski/admdongkor, CC BY 4.0)
set -e
# 작업 폴더(원본 dl/·중간 data/·결과 results/ 가 생기는 곳)는 첫 인자, 없으면 지금 폴더. 원본 해구·AWS 는 SCR(기본: 작업 폴더의 상위)/kma/ 아래.
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../.." && pwd); A=$(cd "${1:-.}" && pwd); SCR=${SCR:-$(cd "$A/.." && pwd)}
cd "$A"; mkdir -p data results repo_data
python3 -I "$HERE"/check_zone_numbering.py "$SCR/kma/marine/zip/marine_20251201_20251231.zip" marine_wave_h000_2025123100.txt dl/apihub/z_2025123100_h000.txt "$REPO"
python3 -I "$HERE"/01_marine_series.py "$SCR/kma/marine/zip" dl/apihub/z_2025123100_h000.txt data
python3 -I "$HERE"/02_aws_daily.py "$SCR/kma/aws/csv" dl/aws_stn/aws_stn_meta_download.bin data
[ -d dl/datalab/raw ] || python3 -I "$HERE"/datalab_dl.py dl/datalab/raw 202001 202412
python3 -I "$HERE"/03_events.py "$REPO" data
NODE_PATH="$A/node_stub" node "$HERE"/dump_warn_intervals_exact.js data/warn_intervals_exact.json
python3 -I "$HERE"/04_geo.py "$REPO" "$SCR" data
python3 -I "$HERE"/06_visitors.py dl/datalab/raw data
python3 -I "$HERE"/07_person.py data results
python3 -I "$HERE"/08_ship.py data results
python3 -I "$HERE"/08_ship.py data results --exclude2025
python3 -I "$HERE"/09_spots.py data results
python3 -I "$HERE"/09b_coastgrid.py "$REPO" "$SCR" data results
python3 -I "$HERE"/09c_bins_compare.py results
python3 -I "$HERE"/10_severity.py data results
python3 -I "$HERE"/11_checks.py data results
python3 -I "$HERE"/12_traffic.py "$SCR" data results
python3 -I "$HERE"/14_warn_equiv.py results
python3 -I "$HERE"/15_sensitivity.py data results
python3 -I "$HERE"/13_export.py data results repo_data
python3 -I "$HERE"/16_tables.py results > results/tables.md
echo ALL DONE
