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
SUITES=(test_child_relevance test_child_unknown_gate test_child_confirm test_ef_exact_refine
        test_cancel_verdict_room test_push_pagination test_bulletin_cancel_scanner
        test_zone_tree_wiring test_ask_context test_naver_term_step test_article_images test_chat_render
        test_glossary_parse test_citation_chain
  test_clarify_options test_unverified_review)
for suite in "${SUITES[@]}"; do
  f="local_server/scripts/${suite}.js"
  if [ ! -f "$f" ]; then echo "  ❌ 없음 $f"; FAIL=1; continue; fi
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -oE "[0-9]+ PASS / [0-9]+ FAIL" | tail -1)
  if [ -z "$line" ]; then echo "  ❌ $suite — 실행 실패(결과줄 없음)"; echo "$out" | tail -3; FAIL=1; continue; fi
  if echo "$line" | grep -qE "/ 0 FAIL$"; then echo "  ✅ $suite — $line"
  else echo "  ❌ $suite — $line"; echo "$out" | grep "❌" | head -5; FAIL=1; fi
done

# ============================================================================
# V5-2 위키 링크 무결성 (2026-08-17 신설)
#   [배경] 위키 문서끼리 잇는 `[[링크]]`가 실제 파일과 어긋나면 챗봇이 그 문서에 도달하지
#   못한다. 지금까지는 법별 AI 74명이 각자 자기 법만 보며 고쳐, ①`_glossary.md`처럼 어느
#   법의 소유도 아닌 파일은 담당자가 없어 21라운드 동안 116건이 방치됐고 ②판단이 매번 달라
#   같은 링크가 고쳐졌다 말았다 했다. 209건을 전역 수리로 0으로 만든 뒤 이 게이트를 건다.
#   [주의] 실패하면 `_dashboard/loop/xref_fix.py <wiki> --apply` 로 기계 수리 후, 남은
#          것(후보가 여럿이거나 대상 문서가 없는 것)만 사람이 판단한다.
# ============================================================================
# ============================================================================
# V5-3 근거 조문 표 무결성 (2026-08-19 신설)
#   [배경] 챗봇은 개념 페이지의 `## 근거 조문` 표에서만 근거를 만든다. 그 표에 `이 법`·`동법`
#   처럼 어느 법인지 알 수 없게 적히거나 표가 아예 없으면, 내용이 위키에 멀쩡히 있어도
#   사용자 앞에서는 근거가 통째로 사라진다(22차 라이브 검증에서 절반이 재현 안 된 최대 원인).
#   243건을 0으로 만들었는데, 위키는 계속 편집되므로 **게이트가 없으면 그대로 되돌아간다.**
#   [주의] 실패하면 fix_deictic_law_cells.js 로 기계 수리 후, 남은 것만 사람이 표를 손본다.
# ============================================================================
echo; echo "── V5-3 근거 조문 표 무결성 ──"
node local_server/knowledge/legal/_dashboard/loop/citation_table_scan.js --gate || FAIL=1

echo; echo "── V5-4 정답 페이지 도달 ──"
# 사람이 정답이라고 확인한 개념 페이지가 검색 후보에, 그리고 모델에게 넘어가는 자료에 들어오는가.
# 순위엔 문턱을 두지 않는다(위키가 바뀌면 자연히 흔들린다) — "아예 못 닿는다"만 실패로 본다.
node local_server/knowledge/legal/_dashboard/loop/page_eval.js --gate || FAIL=1
node local_server/knowledge/legal/_dashboard/loop/context_eval.js --gate || FAIL=1

# ============================================================================
# V5-5 근거 조문 행 도달성 (2026-08-20 신설)
#   [배경] V5-3은 **우리가 아는 결함 다섯 가지**를 센다. 그것이 0이 된 뒤 "그럼 나머지는 다
#   뜨는가"를 처음 전수로 물었더니, 10,882행 중 76행(0.70%)이 **어떤 답변으로도** 근거가 될
#   수 없었다(가운뎃점 묶음에 가지조가 섞인 칸 42행, 여러 법을 한 칸에 적은 행 등).
#   아는 병을 세는 검사만으로는 이런 행이 영원히 안 보인다.
#   [주의] 0을 요구하지 않는다 — 조문 구조가 없는 고시가 실재한다. 기준선보다 늘면 실패한다.
#   기준선 갱신: node local_server/knowledge/legal/_dashboard/loop/reach_eval.js \
#                  --save local_server/knowledge/legal/_dashboard/loop/pinned/reach_eval_base.json
# ============================================================================
echo; echo "── V5-5 근거 조문 행 도달성 ──"
node local_server/knowledge/legal/_dashboard/loop/reach_eval.js --gate || FAIL=1

echo; echo "── V5-6 근거 조문 인용 존재성 ──"
# 근거 조문 표의 **법령 칸과 조문 칸이 짝이 맞는지** 원문으로 대조한다(2026-08-20 신설).
#   왜: '조문 번호는 맞는데 주인이 틀린' 행은 지금까지 어떤 검사도 못 잡았다 — 링크는 걸리고
#   표는 멀쩡해 보이지만 사용자가 눌러 보면 다른 내용이 나온다. 신설 당일 2건이 실재했다.
#   ⚠이 검사를 만들고도 여기 안 걸어 뒀던 것을 독립 검토자가 지적해 등록한다(L-105 재발).
node local_server/knowledge/legal/_dashboard/loop/cite_exists.js --gate || FAIL=1

echo; echo "── V5-7 골든 문항 근거 도달성 ──"
# 문항마다 **기대 근거(법령+조문)가 인용 후보까지 닿는가**를 잰다(H-47 ①, 2026-08-20 신설).
#   왜: 다른 채점판들은 '법이 오나'·'페이지가 오나'·'행이 도달 가능한 꼴인가'까지만 재고,
#   "이 질문에 기대되는 그 조문이 실제로 근거 후보에 들어오는가"를 재는 자가 없었다.
#   2026-08-18 라이브 검증에서 감사 full 판정의 52%가 근거를 못 댄 것이 이 층의 실패였는데
#   지금까지는 유료 라이브 검증으로만 잡혔다. 이제 무료·자동으로 잡는다.
#   ⚠AI 채점을 쓰지 않는다(L-133: 채점자가 AI면 라운드 간 42%가 뒤집힘). 문자열 대조만.
node local_server/knowledge/legal/_dashboard/loop/golden_eval.js \
  --base local_server/knowledge/legal/_dashboard/loop/pinned/golden_eval_base.json --gate || FAIL=1

echo; echo "── V5-2 위키 링크 무결성 ──"
( cd local_server/knowledge/legal && python3 _dashboard/loop/xref_check.py wiki ) || FAIL=1

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

# ============================================================================
# V6 API 자식 데이터 오염 가드 (2026-08-09 신설)
#   [배경] /api/weather-alerts 는 장부(weather_alerts.json)를 그대로 주지 않고
#   폐기된 dmdw 소스를 자식 노드에 머지해 왔다. dmdw 크롤러는 v7 에서 껐는데 머지만
#   살아남았고, dmdw_alerts.json 은 영구 볼륨에 있어 배포해도 안 지워져 **5월 파일이
#   3개월째 자식 시각을 덮어썼다**. 관리자 장부는 파일 직독이라 정상으로 보여
#   "서버는 맞는데 카드만 틀리다"는 오진을 유발했다.
#   [가드] 응답의 어떤 자식도 폐기 소스(DMDW) 표식을 달고 있으면 안 된다.
#   데이터 파일이 없는 환경(신규 클론 등)에서는 200 이 아니므로 자동 skip.
# ============================================================================
echo; echo "── V6 API 자식 오염 가드 ──"
WA=$(curl -s -o /tmp/_wa.json -w "%{http_code}" "http://localhost:3001/api/weather-alerts")
if [ "$WA" != "200" ]; then
  echo "  ⏭️  skip — /api/weather-alerts 미제공(HTTP $WA, 데이터 파일 부재 환경)"
else
  node -e '
    const fs=require("fs");
    const t=JSON.parse(fs.readFileSync("/tmp/_wa.json","utf8"));
    const bad=[];
    (function walk(n){
      if(!n||typeof n!=="object")return;
      if(n.children&&typeof n.children==="object"){
        for(const[k,v]of Object.entries(n.children)){
          if(v&&typeof v==="object"&&/DMDW/i.test(String(v.source||"")))bad.push(k+" (source="+v.source+")");
        }
      }
      for(const v of Object.values(n))if(v&&typeof v==="object")walk(v);
    })(t.current||{});
    if(bad.length){console.log("  ❌ 폐기 소스(DMDW)가 자식에 머지됨: "+bad.slice(0,5).join(", "));process.exit(1);}
    console.log("  ✅ 자식 노드에 폐기 소스 머지 없음");
  ' || FAIL=1
fi
rm -f /tmp/_wa.json

echo
if [ "$FAIL" -ne 0 ]; then echo "════ ❌ 검증 실패 — main 머지 보류 ════"; exit 1; fi
echo "════ ✅ 전체 검증 통과 — main 직행 안전 ════"
