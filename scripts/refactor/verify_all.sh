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

# ============================================================================
# V5 테스트 스위트 (2026-08-09 신설)
#   [배경] 스위트 271건이 존재했지만 이 게이트가 **한 번도 호출하지 않아**, 사람이
#   기억해서 수동 실행할 때만 돌았다. 그 결과 같은 자식해역 오표기 사고가 5회
#   재발하는 동안(6/2·6/19·6/20·7/14·8/8) 매번 "verify_all 통과"로 지나갔다.
#   [주의] 새 스위트를 만들면 반드시 이 배열에 등록할 것. 등록 안 하면 안 돌아간다.
#   [주의] 시각 의존 테스트 금지 — 기준일은 '어제' 이전으로 잡아 실행 시각과 무관하게.
#          (test_ef_exact_refine 이 '오늘 01/05시=과거' 가정으로 KST 00~05시에 상시
#           실패하던 것을 2026-08-09 에 기준일 이동으로 수정. 실패가 일상이 되면
#           점검표를 무시하는 습관이 생겨 게이트 자체가 무력해진다.)
# ============================================================================
echo; echo "── V5 테스트 스위트 ──"
SUITES=(test_child_relevance test_child_unknown_gate test_ef_exact_refine
        test_cancel_verdict_room test_push_pagination test_bulletin_cancel_scanner)
for suite in "${SUITES[@]}"; do
  f="local_server/scripts/${suite}.js"
  if [ ! -f "$f" ]; then echo "  ❌ 없음 $f"; FAIL=1; continue; fi
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -oE "[0-9]+ PASS / [0-9]+ FAIL" | tail -1)
  if [ -z "$line" ]; then echo "  ❌ $suite — 실행 실패(결과줄 없음)"; echo "$out" | tail -3; FAIL=1; continue; fi
  if echo "$line" | grep -qE "/ 0 FAIL$"; then echo "  ✅ $suite — $line"
  else echo "  ❌ $suite — $line"; echo "$out" | grep "❌" | head -5; FAIL=1; fi
done

# 서버 API + 이동 JS 경로 스모크
echo; echo "── 서버 스모크 (대표 엔드포인트) ──"
SMOKE=("/api/health:200" "/api/app-version:200" "/:200" "/sw.js:200" "/style.css:200"
       "/js/core/app_init.js:200" "/js/forecast/alerts/data.js:200"
       "/js/ocean-map/map/ocean_map.js:200" "/js/marine-life/surfing/surfing1.js:200"
       "/js/notice/comments/promo_comment1.js:200" "/js/typhoon/ocean_typhoon.js:200"
       "/js/location-alert/location_alert_core.js:200" "/js/shared/utils/utils.js:200"
       "/services/typhoon_radius.js:200" "/services/typhoon_message.js:200"
       "/marine_zone_area.json:200" "/.well-known/assetlinks.json:200"
       "/serviceAccountKey.json:404" "/server.js:404" "/routes/weather.js:404" "/scheduler.js:404")
for pair in "${SMOKE[@]}"; do
  ep="${pair%:*}"; want="${pair##*:}"
  got=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001$ep")
  if [ "$got" = "$want" ]; then echo "  ✅ $got $ep"; else echo "  ❌ $got (기대 $want) $ep"; FAIL=1; fi
done

echo
if [ "$FAIL" -ne 0 ]; then echo "════ ❌ 검증 실패 — main 머지 보류 ════"; exit 1; fi
echo "════ ✅ 전체 검증 통과 — main 직행 안전 ════"
