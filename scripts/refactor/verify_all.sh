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

# ── 실패 항목을 **마지막에 한 번 더 모아 찍는다**(2026-08-27 신설, L-196) ────────────
# [왜] 이 스크립트는 검사를 위에서 아래로 찍어 내려간다. 그래서 출력이 200줄을 넘고,
#   읽는 쪽이 `head`·`tail` 로 자르면 **가운데 실패를 통째로 놓친다.**
#   실제로 그렇게 됐다: 2026-08-27 에 오케스트레이터가 두 번에 걸쳐 "위키 게이트 전부 통과"라고
#   보고했는데, 그 아래 V5-7 이 **기준선 대비 나빠진 문항 3개**를 찍고 있었다.
#   전체 판정이 ❌ 인 것을 보고 "원인은 전부 HTTP 000(서버 미기동)"이라고 단정한 뒤
#   나머지를 안 읽은 것이 원인이다.
# [무엇을 하나] 모든 출력을 로그로 함께 받아 두었다가, 끝에서 `❌`·`나빠진` 줄만 다시 모아 찍는다.
#   **자르고 읽어도 마지막 블록에 실패가 전부 남는다.**
_VA_LOG="$(mktemp)"
exec > >(tee "$_VA_LOG") 2>&1
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
        test_parent_release_debounce
        test_zone_tree_wiring test_ask_context test_naver_term_step test_article_images test_chat_render
        test_glossary_parse test_citation_chain
  test_clarify_options test_unverified_review test_accident_sheet test_pending_law
  test_hazard_rocks_tide test_guide_tabs test_tab_structure test_usage_keys test_maintenance_tree
  test_overlay_solo test_wiki_brief_bulk test_review_marker_registered test_stale_reopen
  test_pressure_card)
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
# ── V5-0 계기판 최신성 — **게이트가 낡은 색인을 읽고 있지 않은가** (2026-08-29 신설, L-209) ──
# [왜] V5-7(골든체인)·V5-8(링크 도달성)·V5-10(한쪽만 걸린 링크) 세 게이트는 위키 마크다운이
#   아니라 **생성물 `_dashboard/index.json` 을 읽는다.** 그런데 그 파일은 위키를 고칠 때
#   자동으로 다시 만들어지지 않는다. 실제로 몇 라운드 동안 색인이 낡은 채였고, 게이트는
#   **낡은 스냅샷과 낡은 기준선을 비교하며 "변화 없음"을 보고**하고 있었다.
#   2026-08-29 에 색인을 다시 만들자 그동안 쌓인 실제 상태가 한꺼번에 드러났다(한쪽만 걸린
#   링크 2,702 → 2,710). **숫자가 나빠진 게 아니라 원래 그랬던 것이 이제 보인 것이다.**
#   "변화 없음"은 두 가지 뜻이다 — 정말 안 변했거나, **안 보고 있거나.**
# [무엇을] 위키 마크다운 중 가장 최근에 고쳐진 것이 색인보다 새로우면 실패시킨다.
#   고치는 법도 함께 찍는다(자동으로 다시 만들지는 않는다 — 검증이 트리를 바꾸면 안 된다).
echo; echo "── V5-0 계기판 최신성(색인이 위키보다 낡지 않았나) ──"
IDX=local_server/knowledge/legal/_dashboard/index.json
if [ ! -f "$IDX" ]; then
  echo "  ❌ 색인이 아예 없다: $IDX"; FAIL=1
else
  # ⚠`wiki/_backbone.md` 는 **생성물**이다(lint_build.py 가 lint_index.py 뒤에 만든다).
  #   그래서 항상 색인보다 새롭다 — 위키 소스로 세면 늘 실패한다. 빼고 센다.
  FIND_SRC=(find local_server/knowledge/legal/wiki -name '*.md' ! -name '_backbone.md' -newer "$IDX")
  NEWEST=$("${FIND_SRC[@]}" -print -quit 2>/dev/null)
  if [ -n "$NEWEST" ]; then
    N=$("${FIND_SRC[@]}" 2>/dev/null | wc -l)
    echo "  ❌ 색인이 위키보다 낡았다 — 위키 ${N}장이 색인보다 새롭다"
    echo "     예: ${NEWEST#local_server/knowledge/legal/}"
    echo "     ⚠이 상태에서는 V5-7(골든체인)·V5-8(링크 도달성)·V5-10(한쪽만 걸린 링크)이"
    echo "       **낡은 자료를 재고 있어 숫자를 믿을 수 없다.**"
    echo "     고치려면: python3 local_server/knowledge/legal/_dashboard/loop/lint_index.py \\"
    echo "            && python3 local_server/knowledge/legal/_dashboard/loop/lint_build.py"
    echo "     그리고 다시 만든 생성물을 **소스와 같은 커밋에 담는다**(L-209)."
    FAIL=1
  else
    echo "  ✅ 색인이 위키보다 최신이다 — 아래 게이트가 현재 상태를 잰다"
  fi
fi

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

echo; echo "── V5-8 조문 링크 도달성(눌러서 원문이 열리나) ──"
# 사용자가 실제로 만나는 근거는 **답변 본문의 조문 하이퍼링크**다 — 2026-08-18 확정으로 근거 카드
#   목록(아코디언)을 없앴기 때문이다. 그런데 V5-3·V5-5·V5-7 은 그 없어진 목록을 기준으로 재고 있었다
#   (L-152). 이 검사는 계기판을 사용자 쪽으로 한 칸 옮긴다: 그 링크가 열 파일이 정해지는가,
#   그 파일에 그 조가 실제로 있는가. 판정은 생산 함수(article_text.resolveBase·pickNoticeFile·
#   listArticleNumbers)를 그대로 태워서 한다(L-136). AI 안 쓴다.
node local_server/knowledge/legal/_dashboard/loop/link_ready.js \
  --base local_server/knowledge/legal/_dashboard/loop/pinned/link_ready_base.json --gate || FAIL=1

echo; echo "── V5-8c 고시 지도 최신성(다른 부처 고시를 찾을 수 있나) ──"
# 고시는 그 위키가 속한 법 폴더에서만 찾는데, 위키는 남의 부처 고시도 짚는다(독도법 페이지가
#   국가유산청 고시를 짚는 식). 그래서 `_dashboard/notice_index.json`(고시 이름 → 법 폴더)을
#   두고, 자기 폴더에서 못 찾았을 때만 그 지도를 본다. **고시를 새로 받아 놓고 지도를 안 돌리면
#   그 고시는 남의 법 페이지에서 계속 안 열린다** — 그래서 어긋남을 여기서 막는다.
python3 local_server/knowledge/legal/_dashboard/loop/sync_notice_index.py --check || FAIL=1

echo; echo "── V5-11 별표 도달성(고시 별표를 눌러 열 수 있나) ──"
# V5-8(link_ready)은 **조문 칸에 조(條)가 있는 줄**만 본다. 조문 칸이 `별표1`·`별지 제3호서식`
#   뿐인 줄은 "조문 칸이 아님"으로 빼 놓아, 고시 별표를 863건 새로 채운 2026-08-31에도
#   **몇 건이나 열리게 됐는지 잴 방법이 없었다**(품질 4축 ③ 도달의 구멍).
#   판정은 생산 함수(extractAttachments·parseBylFile·pickNoticeFile·resolveBase)를 그대로 태운다(L-136).
node local_server/knowledge/legal/_dashboard/loop/annex_ready.js \
  --base local_server/knowledge/legal/_dashboard/loop/pinned/annex_ready_base.json --gate || FAIL=1

echo; echo "── V5-8b 원문 덮어쓰기 신호 — 같은 폴더에 같은 ID 가 둘 ──"
# 재수집이 이름 바뀐 고시를 갈아끼우며 **옛 판본을 통째로 덮어쓴** 사고가 있었다(2026-08-23, L-183).
#   위키가 인용하던 근거가 raw 에서 사라졌는데, 적대검증관이 지적하고 나서야 드러났다.
#   같은 폴더에 같은 ID 가 둘이면 덮어쓰기가 일어난 것이다 — 이건 코드 몇 줄로 즉시 안다.
#   ⚠게이트로 걸지 않는다(FAIL 로 안 만든다): 남은 3건은 위키가 인용하지 않는 중복 수집본이고,
#   지우려면 사용자 승인이 필요하다. 보이게만 해 둔다.
python3 local_server/knowledge/legal/_dashboard/loop/dup_id_check.py || true

echo; echo "── V5-8c 도달(품질 4축 ③) — 본문에 있는데 표에 없어 챗봇이 못 꺼내는 조문 ──"
# ★있던 도달 검사의 빈틈이다(2026-08-24, 사서 보고로 발견). V5-5(reach_eval) 는 "표에 **있는**
#   행이 뜨는가"를, V5-3(citation_table_scan) 은 "표 칸이 규칙에 맞나"를 본다 — 둘 다
#   **표에 없는 것**은 구조상 못 본다. 그래서 어선안전조업법은 본문에 제5조·제6조를 옮겨 놓고도
#   표에 행이 없어 여덟 달 가까이 챗봇이 그 조문을 인용하지 못했고, 백로그 8건이 그 하나가 원인이었다.
#   ⚠게이트로 걸지 않는다(FAIL 로 안 만든다): 지금 802건이라 걸면 매번 실패한다 —
#   실패가 일상이 되면 점검표를 무시하는 습관이 생겨 게이트가 오히려 무력해진다.
#   그리고 이건 판정이 아니라 **확인 목록**이다(오탐이 섞인다). 사서가 보고 cite_row.js 로 넣는다.
# ★`| head -8` 로 자르지 않는다(2026-08-28) — 파이프가 닫히면서 SIGPIPE 로 파이썬이
# BrokenPipeError 역추적을 토해내 점검표가 지저분해졌고, 무엇보다 **가운데를 잘라 읽는 것**
# 자체가 CLAUDE.md §7 이 금지한 것이다. 출력은 20줄 남짓이라 통째로 둔다.
python3 local_server/knowledge/legal/_dashboard/loop/body_cite_gap.py || true

echo; echo "── V5-9 수집(품질 4축 ①) — 가져야 할 원문이 손에 있나 ──"
# 사용자가 정한 품질 4축 중 **①수집만 게이트가 아예 없었다**(H-45). ②는 V5-3, ③은 V5-5·V5-7·V5-8,
#   ④는 V5-2·V5-10 이 본다. 이 검사는 기준법 74개의 raw 를 지금 직접 세어, 그 법에 **실제로 존재하는
#   계층**(_meta.json families)인데 파일이 없거나 비어 있는 것만 잡는다 — 애초에 시행규칙이 없는 법을
#   결손으로 세지 않기 위해서다(사용자 요건: "구조적으로 못 얻는 것"과 "안 한 것"을 반드시 가른다).
node local_server/knowledge/legal/_dashboard/loop/collect_eval.js \
  --base pinned/collect_eval_base.json --gate || FAIL=1

echo; echo "── V5-10 연결(품질 4축 ④) — 한쪽만 걸린 링크 ──"
# V5-2 는 **깨진 링크**만 본다. A→B 는 있는데 B→A 가 없는 것은 아무도 안 세고 있었고, 계기판이
#   읽던 200 이라는 수는 lint_index.py 가 목록을 200개에서 자른 값이었다(실제 2,666건).
#   모든 링크가 대칭일 필요는 없으므로 0을 요구하지 않고 **기준선보다 늘지 않는 것**만 본다.
node local_server/knowledge/legal/_dashboard/loop/link_sym.js \
  --base pinned/link_sym_base.json --gate || FAIL=1

echo; echo "── V5-2 위키 링크 무결성 ──"
( cd local_server/knowledge/legal && python3 _dashboard/loop/xref_check.py wiki ) || FAIL=1

# V5-12 시행일 마커 짝·형식 (2026-09-10 신설)
# [왜] 마커(`<!--시행 d-->`)의 닫는 짝이 없거나 종류가 어긋나면, 접기 코드가 그 블록 아래를 파일 끝까지
#   버렸다 — **시행일이 되는 순간** 그 페이지의 뒷부분(근거 조문 표 포함)이 답변에서 사라졌다.
#   시행 전에는 아무 증상이 없어 사람 눈으로는 못 잡는다. 런타임은 이제 깨진 페이지를 접지 않고 넘기지만
#   그러면 옛·새 서술이 함께 나가므로, 커밋 전에 여기서 막는다(독립 검토 high, `H29_stage_review_2026-09-10.json`).
python3 local_server/knowledge/legal/_dashboard/loop/lint_stage_markers.py || FAIL=1

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
# ── 실패 항목 총정리(L-196) — 여기만 봐도 무엇이 실패했는지 다 보인다 ──────────────
sleep 0.3                     # tee 가 마지막 줄까지 쓰도록 잠깐 기다린다
echo "════ 실패·악화 항목 총정리 ════"
_VA_BAD="$(grep -nE '❌|나빠진 문항|^  ↓' "$_VA_LOG" | grep -v '기대 200\|기대 404\|총정리' || true)"
if [ -z "$_VA_BAD" ]; then
  echo "  (없음)"
else
  echo "$_VA_BAD" | sed 's/^/  /'
  echo
  echo "  ⚠위 목록이 비어 있을 때만 \"전부 통과\"라고 말할 수 있다."
  echo "    한 줄이라도 있으면 그 줄을 **하나도 빠짐없이** 보고해야 한다(L-196)."
fi
_VA_HTTP="$(grep -cE '기대 200|기대 404' "$_VA_LOG" || true)"
if [ "${_VA_HTTP:-0}" -gt 0 ]; then
  echo "  · HTTP 스모크 실패 $_VA_HTTP 건은 위 목록에서 뺐다(서버 미기동 환경에서 항상 난다)."
  echo "    ⚠단 \"그러니 나머지도 서버 탓\"이라고 넘겨짚지 말 것 — 위 목록을 따로 읽어라."
fi
rm -f "$_VA_LOG"

echo
if [ "$FAIL" -ne 0 ]; then echo "════ ❌ 검증 실패 — main 머지 보류 ════"; exit 1; fi
echo "════ ✅ 전체 검증 통과 — main 직행 안전 ════"
