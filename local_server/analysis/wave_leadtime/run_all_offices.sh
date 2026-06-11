#!/usr/bin/env bash
# 청 단위 전체기간 풍랑주의보 리드타임 배치 (6청 순차 — 단일 dmdw 계정 세션 충돌 방지)
set -u
cd "$(dirname "$0")"
OFFICES=("제주도" "부산·울산·경상남도" "광주·전라남도" "대구·경상북도" "강원특별자치도" "대전·세종·충청남도")
for o in "${OFFICES[@]}"; do
  echo "===== [$(date +%H:%M:%S)] $o 시작 ====="
  node runLeadtime.js --office="$o" --from=2023-06-01 --to=2026-06-04 \
       --leads=12,24,48,72 --level=주의보 2>&1 | tail -25
  echo "===== [$(date +%H:%M:%S)] $o 완료 ====="
done
echo "ALL DONE $(date +%H:%M:%S)"
