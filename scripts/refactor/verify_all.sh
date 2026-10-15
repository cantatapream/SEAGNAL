#!/usr/bin/env bash
# ============================================================================
# 파일명: scripts/refactor/verify_all.sh
# 역할  : [강화 검증 올인원] 스테이징 미사용 방침에 따라, main 직행 전
#         모든 검증(V1~V4 + 서버 API 스모크 + JS 내용 해시 전수 대조)을
#         한 번에 실행한다. 하나라도 실패하면 즉시 비정상 종료.
# 사용  : node local_server/server.js &   (선기동 — **권유가 아니라 필수**, 아래 D-17 블록 참조)
#         bash scripts/refactor/verify_all.sh
# ============================================================================
# ── ★서버를 먼저 띄우지 않으면 **언제나 exit 1** 이다 (2026-09-25 신설, D-17 · D-16) ──
# [왜 적나] 위 「사용」줄이 `node local_server/server.js &` 를 **권하는 말투**로만 적혀 있어서,
#   여러 세션이 서버 없이 돌린 뒤 **"내가 뭘 깨뜨렸나"** 하고 헤맸다. 사실은 이렇다 —
#   · 서버가 없으면 **HTTP 스모크 21건**(아래 `SMOKE` 배열 실측)이 전부 `000` 으로 실패한다.
#   · V4 시뮬레이션도 브라우저가 붙을 곳이 없어 `ERR_CONNECTION_REFUSED` 로 죽는다.
#   · 그래서 **코드가 완벽해도 판정은 ❌** 이고 종료값은 1 이다. 선기동은 권유가 아니라 **전제**다.
#   · 끝의 총정리 블록은 이 HTTP 실패 21건을 **일부러 뺀다**(아래 「⚠HTTP 스모크는 뺀다」 줄).
#     그래서 총정리가 짧은데 exit 1 인 상황이 생긴다 — 그건 버그가 아니라 이 규약이다.
#
# [V4 의 playwright 는 어디서 오나 — D-16, 2026-09-25 재실측]
#   `simulate.js` 는 `require("playwright-core")` 하는데 그 꾸러미는 **어떤 `package.json` 에도
#   선언돼 있지 않다**(`grep -rn playwright --include=package.json` → **0건**).
#   CI 는 `.github/workflows/verify-all-gate.yml` 이 `--no-save` 로 따로 깔아서 통과한다.
#   ⚠그러니 V4 가 빨간불일 때 **먼저 볼 것은 서버**이고, 의존성은 그 다음이다
#   (2026-09-21 에 이 순서를 거꾸로 짚어 「playwright 부재 탓」으로 잘못 적었다 — D-15).

set -uo pipefail
cd "$(dirname "$0")/../.."
FAIL=0

# ── ★★**게이트는 「키 없는 상태」에서 잰다** (2026-09-23 신설, G-49) ──────────────────
# [무슨 일이 있었나] 사용자가 깃허브 시크릿에 `GEMINI_API_KEY_26_8` 을 넣자마자
#   **게이트가 빨간불**이 됐다(run #103). 제품은 손대지 않았는데도다.
#     run #101 (키 0개)  V5-7 search 13 · 나빠진 문항 0
#     run #103 (키 1개)  V5-7 search 11 · 나빠진 2 / 좋아진 4
#   까닭은 `legal_retriever.js` 의 `expandQueryTerms()` 다 — `if (!gemini.hasAnyKey()) return []`.
#   **키가 있으면 Gemini 가 질문을 확장해 검색 후보가 달라진다.**
#
# [왜 키를 빼는가] 전체로는 **나아졌다**(13→11). 그런데도 빼는 이유는 하나다 —
#   ★**자는 움직이면 안 된다.** LLM 은 같은 질문에도 매번 같은 말을 주지 않는다.
#   그걸 기준선과 견주면 게이트는 **영원히 흔들리고**, 그때마다 기준선을 다시 잡게 된다.
#   기준선을 습관적으로 다시 잡는 게이트는 **이미 죽은 게이트**다(G-34).
#   ⚠이건 「시험을 끄는 것」이 아니다 — 검사는 그대로 돌고, **기준선을 재던 그 조건**으로 돌릴 뿐이다.
#
# [그럼 Gemini 는 어디서 보나] **L-8** 에서 본다 — 거기가 「실제로 어떻게 답하나」를
#   보는 자리다. 게이트는 「꺼내는 사슬이 끊기는가」를 보는 자리다. 둘은 다른 물음이다.
#   위 2문항이 옮겨 간 것과 4문항이 좋아진 것은 **버리지 않고** 등록부 G-49 에 적었다.
export GEMINI_API_KEY_26_8=''
export GEMINI_API_KEY=''
echo "── 재는 조건 ──"
echo "  Gemini 키를 **일부러 비우고** 잰다 (G-49) — LLM 이 끼면 같은 질문에도 답이 달라져"
echo "  기준선과 견줄 수 없다. 실제 답변 품질은 L-8 이 본다."

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
# ── 어느 검사가 실패를 세웠는지 **이름을 남긴다** (2026-09-22 신설) ─────────────
# [왜] `FAIL=1` 을 세우는 자리가 26곳인데 **어디서 세웠는지 아무 데도 안 남았다.**
#   그래서 "총정리는 표시줄뿐인데 exit 1" 인 상황이 생긴다 — 실제로 깃허브 run #17 이
#   그랬다. 총정리의 ❌ 여섯 줄이 전부 분류 표시(0건·기준선 이하)인데 종료 코드는 1이었고,
#   **무엇이 실패했는지 로그 어디에도 없었다.** L-196 이 "총정리만 보면 다 보인다"고
#   보장하려 만든 것인데 그 보장이 깨진 것이다.
# [무엇을] `fail <이름>` 으로 세우고, 마지막 총정리에 그 이름 목록을 함께 찍는다.
#   ⚠새 검사를 넣을 때 `|| FAIL=1` 대신 `|| fail "<이름>"` 을 쓸 것.
FAILED_NAMES=""
# 문항이 0개라 「통과」로 셀 수 없는 스위트(G-34). 실패는 아니지만 초록으로 위장하면 안 된다.
SKIPPED_SUITES=""
fail() { FAIL=1; FAILED_NAMES="${FAILED_NAMES}
  · $1"; }
run() { echo; echo "── $1 ──"; local _n="$1"; shift; "$@" || fail "$_n"; }

# V2 경로 · V3 로드순서 · V4 시뮬레이션
run "V2 경로 무결성" node scripts/refactor/check_paths.js
run "V3 로드 순서" node scripts/refactor/check_order.js
# ── V2-b 절대경로 (2026-09-22 신설, G-31) ───────────────────────────────────
#   게이트 7개가 `/home/user/SEAGNAL/…` 를 require 하고 있어 깃허브 CI 에서 진단 한 줄
#   없이 전부 죽고 있었다(run #27). 같은 사고가 이번이 **세 번째**다(2026-09-10 프로덕션 ·
#   2026-09-18 L-289 · 2026-09-22 이것). 교훈을 한 줄 더 적는 대신 재는 것을 둔다.
run "V2-b 절대경로(그 컴퓨터에서만 도는 코드)" node scripts/refactor/check_abs_paths.js
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
# ⚠★**이 스크립트가 도는 동안 이 파일을 고치지 마라** (2026-09-26 실측으로 겪었다).
#   bash 는 스크립트를 **실행하면서 이어 읽는다** — 도는 중에 파일이 바뀌면 읽던 바이트 위치가
#   어긋나 **아무 잘못 없는 줄에서 문법 오류**가 난다(그때 190줄에 `(` 가 없는데 그렇게 났다).
#   `bash -n` 은 통과하므로 **내 수정이 잘못된 것처럼 보여** 엉뚱한 곳을 뒤지게 된다.
#   기다리는 동안 손댈 일이 있으면 **사본으로 돌린다 — 단 사본은 이 폴더 안에 둔다**:
#     `cp scripts/refactor/verify_all.sh scripts/refactor/.verify_run.sh && bash scripts/refactor/.verify_run.sh`
#   ⚠`/tmp` 에 두면 안 된다 — 이 스크립트는 27줄에서 `cd "$(dirname "$0")/../.."` 로 제 뿌리를
#     잡으므로, `/tmp` 에서 돌리면 뿌리가 `/` 가 되어 **전부 「파일 없음」**이 된다(2026-09-26 겪었다).
#   ★「게이트와 raw 쓰기를 겹치지 않는다」와 같은 병이다 — 겹치지 말아야 하는 것은 raw 만이 아니라
#     **게이트가 읽는 모든 파일**이다(→ `_LESSONS.md` L-382 갈래⑧).
echo; echo "── V5 테스트 스위트 ──"
SUITES=(test_child_relevance test_child_unknown_gate test_child_confirm test_ef_exact_refine
  test_unverified_leak test_split_law_ask test_section_name_kinds test_ref_tier_route
        test_cancel_verdict_room test_push_pagination test_bulletin_cancel_scanner
        test_parent_release_debounce
        test_zone_tree_wiring test_ask_context test_naver_term_step test_article_images test_chat_render
        test_glossary_parse test_citation_chain
  test_clarify_options test_unverified_review test_accident_sheet test_pending_law
  test_hazard_rocks_tide test_tide_field_memory test_guide_tabs test_tab_structure test_usage_keys test_maintenance_tree
  test_overlay_solo test_wiki_brief_bulk test_review_marker_registered test_stale_reopen
  test_mok_audit_scanner test_add_other_law_refresh test_pressure_card test_typhoon_source test_typhoon_jma
  test_typhoon_ecmwf test_khoa_https test_khoa_stream_cache_memory
  test_byl_decl test_treaty_caselaw_meta test_context_budget test_table_rows_slice test_counting_dict test_silent_catch
  test_gate_5xx_class test_meta_schema test_admrul_review test_ho_count test_section_ready test_treaty_article test_byl_body_kind test_box_rows test_score_body test_admin_cards
  test_codex_bridge test_fav_tide_prefetch test_picture_text test_ordin_fresh test_scan_fail_honest test_collect_approved test_mok_brief test_mok_excerpt test_scan_catchup test_mok_bulk test_reread_guard test_gale_store
  test_risk_points test_risk_time test_risk_score_sea test_risk_score_coast test_risk_static test_risk_geo
  test_risk_format test_risk_preview test_risk_lifecycle test_risk_map_layer
  test_risk_collectors test_risk_store test_risk_missing_notice test_risk_store_file_cache test_risk_errors test_risk_errors_ui test_risk_history_sources test_risk_routes test_risk_accident test_marine_fusion test_marine_ui test_risk_basemap test_risk_main_time)
