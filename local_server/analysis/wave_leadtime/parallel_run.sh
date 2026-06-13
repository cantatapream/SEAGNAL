#!/usr/bin/env bash
# 6청 병렬 전체기간(2023-06~2026-06) 풍랑주의보 리드타임 (청단위+per-zone)
cd "$(dirname "$0")"
declare -A OFF=( [jeju]="제주도" [busn]="부산·울산·경상남도" [gwju]="광주·전라남도"
  [degu]="대구·경상북도" [gawn]="강원특별자치도" [dajn]="대전·세종·충청남도" )
for code in "${!OFF[@]}"; do
  nohup node runLeadtime.js --office="${OFF[$code]}" --from=2023-06-01 --to=2026-06-04 \
    --leads=12,24,48,72 --level=주의보 > "out/logs/full_${code}.log" 2>&1 &
  echo "launched $code (${OFF[$code]}) pid=$!"
done
wait
echo "ALL FULL RUNS DONE"
