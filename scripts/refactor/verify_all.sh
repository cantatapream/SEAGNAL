#!/usr/bin/env bash
# ============================================================================
# 파일명: scripts/refactor/verify_all.sh
# 역할  : [강화 검증 올인원] 스테이징 미사용 방침에 따라, main 직행 전
#         모든 검증(V1~V4 + 서버 API 스모크 + JS 내용 해시 전수 대조)을
#         한 번에 실행한다. 하나라도 실패하면 즉시 비정상 종료.
# 사용  : node local_server/server.js &   (선기동)
#         bash scripts/refactor/verify_all.sh
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."
FAIL=0
run() { echo; echo "── $1 ──"; shift; "$@" || FAIL=1; }

# V2 경로 · V3 로드순서 · V4 시뮬레이션
run "V2 경로 무결성" node scripts/refactor/check_paths.js
run "V3 로드 순서" node scripts/refactor/check_order.js
run "V4 시뮬레이션" node scripts/refactor/simulate.js

# 서버 API + 이동 JS 경로 스모크
echo; echo "── 서버 스모크 (대표 엔드포인트) ──"
SMOKE=("/api/health:200" "/api/app-version:200" "/:200" "/sw.js:200" "/style.css:200"
       "/js/core/app_init.js:200" "/js/forecast/alerts/data.js:200"
       "/js/ocean-map/map/ocean_map.js:200" "/js/marine-life/surfing/surfing1.js:200"
       "/js/notice/comments/promo_comment1.js:200" "/js/typhoon/ocean_typhoon.js:200"
       "/js/location-alert/location_alert_core.js:200" "/js/shared/utils/utils.js:200"
       "/serviceAccountKey.json:404")
for pair in "${SMOKE[@]}"; do
  ep="${pair%:*}"; want="${pair##*:}"
  got=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$ep")
  if [ "$got" = "$want" ]; then echo "  ✅ $got $ep"; else echo "  ❌ $got (기대 $want) $ep"; FAIL=1; fi
done

echo
if [ "$FAIL" -ne 0 ]; then echo "════ ❌ 검증 실패 — main 머지 보류 ════"; exit 1; fi
echo "════ ✅ 전체 검증 통과 — main 직행 안전 ════"
