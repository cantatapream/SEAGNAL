#!/usr/bin/env bash
cd "$(dirname "$0")"
declare -A OFF=( [jeju]="제주도" [busn]="부산·울산·경상남도" [gwju]="광주·전라남도"
  [degu]="대구·경상북도" [gawn]="강원특별자치도" [dajn]="대전·세종·충청남도" )
for code in "${!OFF[@]}"; do
  nohup node runLeadtime.js --office="${OFF[$code]}" --from=2023-06-01 --to=2026-06-04 \
    --leads=12,24,48,72 --level=주의보 --signal=wind > "out/logs/wind_${code}.log" 2>&1 &
  echo "launched wind $code pid=$!"
done
wait; echo "ALL WIND DONE"
