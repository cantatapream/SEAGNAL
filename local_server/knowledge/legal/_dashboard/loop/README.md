# 감사·수정·재감사 루프 — 자동화 스크립트 체크포인트

> 원본은 세션 스크래치패드(`/tmp/.../scratchpad/`)에서 돌지만, 컨테이너가 사라지면 스크래치패드가 날아가므로
> **여기에 백업**한다. 컨테이너 재시작 시 이 폴더 파일을 스크래치패드로 복사해 상태(`audit_loop_state.json`)의
> phase/round/run_ids로 이어서 재개한다(위키·감사 산출물은 이미 git에 커밋되어 별개로 안전).

## 핵심 (루프)
- `audit_sim.js` — 감사 워크플로(질문 생성→위키만으로 답변→구멍 판정 + 답변방식 준수 점검). args: {groupsPath, groupIndex, round}
- `fix_wiki.js` — 수정 워크플로(감사 리포트대로 페이지 생성·심화·별표/고시 반영). args: {groupsPath, groupIndex}
- `audit_loop_state.json` — 상태(phase, round, run_ids). 오케스트레이터가 읽어 전진
- `audit_groups.json` — 65 tier-1 법을 5그룹으로 쪼갠 것(boot가 groupIndex로 읽음)
- `build_data.json`·`tier1.json` — 법 메타(name/slug/domain/tier/raw/group)
- `gen_index.py` — index.md 목차 재생성(→ 상위 `_dashboard/gen_index.py`와 동일)

## 파이프라인(재사용)
- 수집: `collect.py`·`collect_admrul.py`(고시)·`collect_ordin.py`(조례)·`recollect_byl.py`(별표)·`recollect_jomun.py`(조문)
- 빌드: `full_build.js`(풀깊이)·`wiki_build.js`·`topicmap.js`·`sonnet_pilot.js`(모델 검증)
- lint: `lint_index.py`·`lint_build.py`·`lint_hubs.js`·`lint2.js`(색인·그래프·백본·테마허브)
- 프로토타입: `chatbot_proto.py`(순수코드 검색+점진공개 검증용)

## 정리(cleanup) 정책
- **루프 진행 중에는 삭제 금지** — 이 폴더가 컨테이너 소멸 대비 안전망.
- **루프 완료(phase=done) 후**: 일회성 상태(`audit_loop_state.json`·`audit_missing.json`·`audit_rerun.json`)만 삭제 가능. 재사용 기계(`audit_sim.js`·`fix_wiki.js`·`collect_*.py`·`lint_*`·`gen_index.py`)는 Phase D 재수집·개정 diff 재인제스트·미래 재감사에 다시 쓰므로 유지.
- 참고: git 작업트리에서 지워도 히스토리엔 남아 레포 용량은 줄지 않는다("메모리 확보" 효과 미미). 삭제의 실익은 정리(깔끔함)뿐.

<!-- 자목록:자동 -->
### 자 목록 — 누가 부르나 (기계가 씀 · `loop_tool_census.js --index`)

자 **254자루** · 게이트 **58** · 코드 **84** · 글만 **110** · 없음 **2**

| 자 | 누가 부르나 | 무엇을 하는 자인가 |
|---|---|---|
| `admrul_annex_survey.py` | 코드 | 고시(행정규칙) raw 에 **별표·별지서식이 빠져 있는지**를 API 와 대조해 세기만 한다(읽기 전용). |
| `admrul_byl_file_links.py` | 글만 | 행정규칙 별표 `.txt` 에 **내려받기 주소를 적어 넣는다**. (3-53) |
| `admrul_byl_links.py` | 글만 | 행정규칙에서 온 별표의 **원본 파일 링크(PDF·HWP)** 를 `_links.json` 에 채운다. (3-21 · 3-36) |
| `admrul_current_check.py` | 글만 | 받아 둔 행정규칙이 **현행판인지** 확인하고, 아니면 현행판으로 바꿔 받는다. |
| `admrul_diff_wiki.py` | 코드 | 재수집으로 달라진 행정규칙 조문을 뽑고, 그 조문을 인용하는 위키 셀을 찾아낸다. |
| `admrul_fill_addenda.py` | 글만 | 고시(행정규칙) raw 파일에 빠져 있는 **부칙**을 API에서 받아 뒤에 덧붙인다. |
| `admrul_fill_annex.py` | 코드 | 고시(행정규칙) raw 에 빠져 있는 **별표·별지서식**을 API 에서 받아 채운다. |
| `admrul_fresh_pass2.py` | 코드 | admrul_fresh.py 의 '조회실패'를 다시 판정하는 2차 대조. |
| `admrul_recollect_stale.py` | 코드 | admrul_fresh 가 '구버전'으로 판정한 행정규칙을 현행본으로 다시 받아 raw를 갱신한다. |
| `admrul_restore_ocr.py` | 글만 | 재수집으로 사라진 이미지 판독 전사분을, 그림이 같은 것만 골라 되살린다. |
| `admrul_review_verify.py` | 글만 | 3-28 / G-24 — **「DRF 자동수집 … 원문 대조 필요」 표시를 기계가 실제로 대조한다. |
| `annex_gap.py` | 글만 | 별표(법에 딸린 표) 수치가 위키에 옮겨졌는지 기계적으로 판정한다 (H-40 P1). |
| `annex_rowcount_fill.js` | 글만 | §6-F 항목수 대조 줄의 **기계 몫**을 채운다. (Q-18 결심 ① 뒤끝, 2026-09-24) |
| `apply_approvals.py` | 코드 | 서버(볼륨)에 쌓인 **사람 승인 기록**을 저장소에 반영한다. |
| `apply_resolutions.py` | 글만 | review_resolve 판정을 **단독(직렬)** 적용. (공유파일 쓰기는 여기 한 곳에서만 = ⚠경합없음) |
| `apply_shrink_guard_verified.py` | 글만 | shrink_guard_inspect.json에서 genuine_fulltext_shorter/ambiguous(사람이 실물 확인 후 |
| `article_block.js` | 코드 | raw 파일 글 안에서 **조문 한 덩이**를 집고 갈아 끼운다. |
| `article_range_parse.py` | 코드 | 꼬리표의 **사람 말 `조문범위`** 를 기계가 읽는 조문 번호 목록으로 편다. (3-3 = ⓐ) |
| `ask_live.js` | 코드 | 프로덕션 나리야 챗봇에 **실제 앱과 똑같은 방식으로** 질문하는 감사용 도구. |
| `assign_scan.py` | 코드 | 배정용 스캐너 — 백로그의 "실작업 N건"이 진짜 실작업인지 줄 단위로 세어 준다. |
| `audit_backlog_gap.py` | 코드 | 감사 파일에는 **결함으로 적혀 있는데 백로그에 안 올라온 줄**을 전수로 찾는다. |
| `audit_fix_cell.js` | 코드 | 6차(직전) 감사 gap을 입력으로 각 법의 위키를 content+lint 동시 수정한다(H-7 통합수정). |
| `audit_sim.js` | 코드 | ⚠★**이 파일은 `node` 로 돌리는 스크립트가 아니다.** (2026-09-23, 3-38) |
| `auto_promote.js` | 글만 | ① 비민감 draft 자동 승급: 각 법의 draft 개념 중 사람검증 불필요한 것만 canonical로. |
| `backfill_lawid.py` | 코드 | 74법 `_meta.json`의 families 각 층(법률/시행령/시행규칙 등)에 `법령ID`를 채워 넣는다. |
| `backfill_retry.py` | 글만 | backfill_lawid.py 가 **못 받은 층만** 다시 받아 스냅샷에 채워 넣는다. |
| `backlog_by_article.py` | 글만 | 백로그 항목을 **그 항목이 가리키는 근거 조문**으로 묶어 준다. |
| `backlog_denom.py` | 글만 | 백로그의 **진짜 분모**를 재려 한다 — 그리고 어디까지 잴 수 있는지 정직하게 밝힌다. |
| `backlog_extract.js` | 코드 | 감사 파일에서 **아직 안 고쳐진 thin·missing 만** 뽑아 법별 백로그 파일로 분리한다. |
| `backlog_fix.js` | 글만 | 법별 **미해소 백로그**(_dashboard/backlog/<법>.md)를 사서가 확인·처리한다(H-43). |
| `backlog_id.py` | 코드 | 백로그 항목에 **고정 ID**를 붙인다 — 지금은 같은 문제가 몇 번 중복됐는지도 못 센다. |
| `backlog_refresh.py` | 글만 | 백로그 목록을 **현재 상태로 다시 고른다** — 낡은 목록으로 헛일하지 않도록. |
| `backlog_rollup_close.py` | 글만 | 백로그의 **집계 줄**(질문이 아니라 라운드 요약)을 닫는다 — 단, 안전 조건을 만족할 때만. |
| `backlog_stale_scan.py` | 글만 | 백로그 미해소 항목 중 **이미 위키가 답하고 있을 가능성이 있는 것**을 추려 낸다(후보 목록). |
| `backlog_triage.js` | 글만 | 백로그 "확인만" 패스. **18,794건 중 실제로 손댈 수 있는 게 몇 건인지**를 센다. |
| `build_business_type_aliases.py` | 글만 | 사업자 유형" ↔ 기존 선박종류 트리(vessel_doc_tree.json) 별칭 매핑 빌더 겸 검증기. |
| `build_change_baseline.py` | 코드 | 변동감지의 비교 기준점(baseline) 스냅샷을 조립한다 — "지금 우리 raw가 알고 있는 법령/고시가 |
| `build_cite_review_html.py` | 글만 | 본문 인용 **뜻풀이 판정**을 눈으로 하는 HTML 검토장을 만든다. (3-41 ②) |
| `build_delegation_graph_73.js` | 코드 | H-34 측정: 파일럿 추출기를 73법 전체에 돌려 커버리지만 집계 |
| `build_delegation_graph.js` | 코드 | H-34 파일럿: 조문 단위 위임그래프를 원문에서 기계추출(3법 한정) |
| `build_fix_tasks.py` | 글만 | 최신 감사 라운드 결과(저널)에서 법×유형 작업큐(fix_tasks.json) 재생성 + fix3 마커 초기화(새 수정라운드). |
| `build_golden.js` | 글만 | 감사 파일에서 골든 문항 **후보**를 뽑아 `pinned/golden_questions.json` 초안을 만든다. |
| `build_inspection_cycle_table.py` | 코드 | 검사 주기 표 빌더 겸 검증기 (H-32 확장 — F절 "검사 주기", ★트리 아님). |
| `build_penalty_tree.py` | 코드 | 처벌 강도(벌칙) × 위반행위 유형 계층 트리 빌더 겸 검증기 (H-32 확장, A안). |
| `build_permit_tree.py` | 글만 | 인허가 유형(면허/허가/신고/등록) 계층 트리 빌더 겸 검증기 (H-32 확장). |
| `build_pollutant_tree.py` | 코드 | 오염물질 종류별 배출규제 계층 트리 빌더 겸 검증기 (H-32/H-36 확장). |
| `build_port_entry_flow.py` | 글만 | 출입항 신고 · 위치보고" 절차 플로우 빌더 겸 검증기 (H-32 확장). |
| `build_qualification_tree.py` | 글만 | 자격·면허 등급 계층 트리 빌더 겸 검증기 (H-32 확장 · H-36 두 번째 트리). |
| `build_review_html.py` | 코드 | 그림 속 표를 **눈으로 대조**하는 HTML 검토장을 만든다. (3-28) |
| `build_rowcount_html.js` | 코드 | §6-F 항목수 대조의 **사람 몫**을 눌러서 확정하는 쪽을 만든다. (2026-09-24) |
| `build_scope_html.py` | 글만 | 3-6 (결심 ②ⓐ) — **고시 11쪽의 「적용범위」를 사람이 눌러서 확정하는 HTML 을 만든다. |
| `build_tonnage_facet.py` | 글만 | 톤수·길이 기준값 사전(facet dictionary) 빌더 겸 검증기 (H-32 확장 · candidates E절). |
| `build_training_table.py` | 글만 | 교육·훈련 의무" 표 빌더 겸 검증기 (H-32 확장 — 트리 아님, 표). |
| `build_tree_wiki_crossref.py` | 글만 | H-36 후속 — 13개 계층자산(트리·표·플로우) ↔ 기존 위키(statutes+concepts) 조문 단위 연결지도 빌더. |
| `build_vessel_doc_tree.py` | 코드 | 선박종류 × 비치서류 계층 트리 빌더 겸 검증기 (H-32 확장 파일럿). |
| `build_weather_warning_tree.py` | 글만 | 기상특보 출항·운항통제 자산 빌더 겸 검증기 (H-36 14번째 계층자산). |
| `build_zone_tree.py` | 코드 | 해역·항해구역 계층 트리 빌더 겸 검증기 (H-32 확장 · H-36 두 번째 주제). |
| `byl_image_ocr_cell.js` | 글만 | 별표/조문 이미지(<img id="N">)를 비전 OCR해 이미지 옆에 <id>.txt(sidecar)로 남긴다. |
| `byl_links_pdf.py` | 글만 | 3-21 · P-17 — 별표 `_links.json` 에 **PDF 링크**를 채운다. |
| `byl_ref_gap.py` | 없음 | 본문이 「별표 N과 같다」고 가리키는데 그 별표 파일이 없는 자리**를 센다. (2026-09-24 신설) |
| `byl_rename_to_decl.py` | 글만 | 별표 파일 **이름을 그 속이 말하는 번호에 맞춘다.** (3-34 = ⓒ 앞쪽) |
| `byl_tier_fill.py` | 글만 | 3-46 — V5-32 가 「파일이 없다」고 짚은 **계층 별표 빈자리**를 골라서 메운다. |
| `chatbot_proto.py` | 글만 | 나리야 법률 챗봇 검색+답변 프로토타입 (순수 코드, 임베딩 키 불필요). |
| `check_budchik.py` | 글만 | 73법 raw(법률/시행령/시행규칙)에 부칙 섹션이 빠져있는지 전수 점검한다(H-26 후속). |
| `cite_number_check.py` | 코드 | 본문 인용 목록(3-41)에서 **숫자·금액 인용만 골라 원문과 기계로 맞대어 본다. |
| `cite_number_raw.js` | 코드 | 3-41 ① — 본문 인용의 **값 숫자**(금액·기간·비율·치수)를 **raw 원문과 맞대어 본다. |
| `collect_admrul_by_name.py` | 글만 | 고시(행정규칙)를 **이름으로 찾아** 그 법 폴더에 받아 둔다. |
| `collect_admrul.py` | 코드 | 고시(행정규칙) 정밀 수집: lsDelegated(위임법령) API로 '그 법이 실제 위임한 고시만' 수집. |
| `collect_contacts.py` | 코드 | law.go.kr DRF API의 연락부서(법률/시행령/시행규칙)·담당부서기관(행정규칙) 필드를 수집한다. |
| `collect_fix_cell.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `collect_gap.py` | 코드 | 추가 수집: (A) 기준법 시행령/시행규칙 미수집분 전수조사·수집  (B) 타법 원문 표적 수집. |
| `collect_law_aliases.py` | 코드 | 법령 공식 약칭 수집 — 우리가 가진 모든 법(raw/*/*/_meta.json)의 **공식 약칭**을 |
| `collect_missing_admrul.py` | 글만 | `delegated_sweep` 이 "확인 필요"로 찍은 위임 행정규칙을 실제로 받아 온다. |
| `collect_ordin.py` | 글만 | 조례(자치법규) 수집: 해양·수산 키워드로 target=ordin 검색 → 지역별 저장. |
| `collect_pending_law.py` | 코드 | 예고본(시행예정 개정 법령) 원문을 **시행일 전에 미리** 받아 `raw/<도메인>/<법>/_대기/<시행일>/<층>.txt` 로 둔다. |
| `collect_raw.js` | 글만 | H-12③ 재수집: collect_queue의 "수집 가능" 원문을 DRF로 가져와 raw/에만 저장(위키 편집 X). |
| `collect.py` | 코드 | ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속). |
| `collection_hole_graceful.js` | 글만 | 재확인된 a_genuine/b_structural collection_hole에 H-30 3요건(위임체인+경계선언+소관부서 연락처)을 붙여 "정직한 답변"으로 완성 |
| `collection_hole_recollect.js` | 코드 | collection_hole_reverify.js가 확정한 action=recollect 백로그를 실제로 수집·위키 반영 |
| `collection_hole_reverify.js` | 코드 | H-26 기준(_SCHEMA.md §6-B) collection_hole a/b/c 재분류·재검증 |
| `concept_new.js` | 글만 | statutes 허브에만 있어 챗봇이 못 꺼내는 내용을 **개념 페이지로 옮긴다**(결정 ④⑤). |
| `content_gap_reverify.js` | 글만 | thin(content_gap) 판정이 정말 "원문 자체에 없는 것"인지 raw 재대조로 전수 재검증 |
| `context_size.js` | 코드 | 한 질문에 **모델로 넘어가는 근거자료가 몇 자인가**를 골든 291문항 전수로 잰다. |
| `crawl.py` | 코드 | ★JSON 이 아니면 **왜 아닌지**를 본다 (2026-09-21, L-294 후속). |
| `defect_triage.js` | 글만 | 남은 결손의 **원인을 자동으로 가른다**(AI 안 씀, 비용 0). |
| `delegated_sweep.py` | 코드 | 위임 행정규칙 조회 기록을 만든다 — "규정이 없다"고 말하려면 이 기록이 있어야 한다(_SCHEMA.md §6-B-1 ⓑ). |
| `delegation_gap.py` | 글만 | 법이 "대통령령·부령으로 정한다"고 위임했는데, **그 법의 시행령·시행규칙에 대응 조문이 없는 자리**를 찾는다. |
| `detect_law_changes.py` | 코드 | 법령·위임고시 변동감지(H-29 1~4·8~12항) — 소관부처 단위 "광역질의" 몇 번으로 최근 변동을 |
| `draft_reverify.js` | 코드 | 초안승인(draft) 재검증 v2: 자동승급이 과보수적으로 남긴 draft를 원문 grounding으로 재판정. |
| `e6_fix.js` | 글만 | §6-E 빈틈 메우기. 본문은 인용하는데 `## 근거 조문` 표에 행이 없는 조문을 채운다. |
| `empty_byl_stub.py` | 글만 | 3-55 — **까닭도 없이 빈 별표 6개**에 내려받기 주소를 달아 정직하게 만든다. |
| `exact_claim_fix.py` | 글만 | 3-33 뒤쪽(결심 ①ⓐ) — **「원문 그대로」라던 인용 24건을 원문 글자에 맞춘다. |
| `exact_claim_numbers.py` | 없음 | 인용 없이 「원문과 EXACT 일치」라고만 적은 주장을 **숫자로** 다시 맞춰 본다. (G-29 · 3-33) |
| `exhaustive_delegation_scan.py` | 글만 | H-28 전수조사: 73법 전체 조문의 위임체인을 lsDelegated API로 전수 대조해 collection_hole을 |
| `expansion_probe.js` | 글만 | AI 검색어 확장이 정답 페이지를 밀어낼 위험이 **몇 건짜리인지** 잰다(AI 안 씀, 비용 0). |
| `extract_11_remaining.py` | 글만 | H-28 전수조사(c)uncollected 43건 중 텍스트 API로 저장 안 된 나머지를 PDF 첨부에서 직접 추출. |
| `extract_admrul_hwp.py` | 글만 | admrul_pdf_triage.json에서 kind=no_pdf_attachment이고 첨부가 구형 HWP(바이너리)인 |
| `extract_admrul_pdf.py` | 코드 | admrul_pdf_triage.json에서 kind=text(PDF 텍스트밀도 충분) 또는 hwpx(PDF 없이 HWPX만)로 |
| `fix_admrul_ids.py` | 글만 | admrul_id_check.json에서 mismatch(구버전 ID 의심)로 확인된 290건을, |
| `fix_cell.js` | 코드 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `fix_png_transparency.py` | 글만 | 그림이 화면에서 안 보이게 만드는 잘못된 "투명 색" 설정을 떼어낸다. |
| `fix_wiki.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `fold_effective.py` | 코드 | 시행일이 **지난** 예고본을 현행으로 승격하고 위키의 시행일 마커를 평문으로 접는다(H-29 트랙 C 정리 단계). |
| `full_build.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `gap6e_fix.js` | 글만 | 고정 문제집이 "위키에 근거 행이 없다(§6-E)"고 찍은 문항을 법마다 한 명씩 고친다. |
| `golden_merge.js` | 글만 | 사서(에이전트)들이 확인한 라벨을 고정 문제집에 합친다. |
| `golden_verify.js` | 코드 | 골든 문항의 **라벨을 사서가 확인**한다(H-47 ①). 라벨이 틀리면 채점판이 틀린다. |
| `grep_table.py` | 코드 | 표(테두리) 안에서 낱말이 줄 경계로 쪼개져 grep 이 놓치는 것을 찾아 준다. |
| `handoff.py` | 코드 | 인계인수 로그를 HANDOFF.md "작업 로그"에 일관된 형식으로 append(계정 간 연속성). |
| `hwpx_table.py` | 글만 | HWPX 첨부파일에서 본문과 표를 구조 그대로 뽑아낸다. |
| `img_worksheet.py` | 코드 | 사람이 눈으로 봐 줘야 하는 "그림으로만 있는 표" 작업지를 HTML 한 장으로 만든다. |
| `inspect_shrink_guard.py` | 글만 | admrul_pdf_extract_log.json의 skipped_shrink_guard 44건을, 실제로는 완전본인지 |
| `law_api_guard.py` | 코드 | 권한이 없다"와 "네트워크가 흔들린다"를 갈라서, 앞의 것은 재시도를 멈추게 한다. |
| `law_fresh.py` | 코드 | 법령 신선도 대조 — 우리가 받아 둔 **법률·시행령·시행규칙** 원문이 지금도 현행판인지 확인한다. |
| `link_live.js` | 코드 | 실제 배포 챗봇에 물어, **답변 본문의 조문 링크가 걸리는지·눌러서 원문이 열리는지**를 잰다. |
| `lint_build.py` | 코드 | lint 2단계(알고리즘 산출): 백본 지도·대시보드 인덱스·개념 그래프 생성. |
| `lint_coverage.py` | 코드 | H-33 조문-위키 커버리지 전수조사: 각 법의 raw 원문 전체 조문 목록과, 위키(statutes+concepts)가 |
| `lint_full.js` | 글만 | 전수 린트: 각 법의 페이지에서 비대칭 역링크·허브 링크·dangling을 자기 법 파일 안에서 완성한다. |
| `lint_hubs.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `lint_verify.py` | 글만 | lint 검증(사후 확인): 전수 린트가 실제로 촘촘한지 3개 실질 지표로 측정. |
| `lint_xref.js` | 글만 | 보강 린트: 타법연결 표의 "평문 우리70법 인용"을 [[링크]]로 전환. |
| `lint2.js` | 글만 | 피인용 최다 백본 법 — 정의 허브(개념 페이지) 신설/강화 |
| `live_article_probe.js` | 글만 | [왜] 2-11(github_raw 로컬 폴백)로 조문 원문·서식(§5-5)·별표 이미지(§5-9) 경로가 |
| `live_probe.js` | 코드 | [왜 있나 — 2026-09-22, 일감 L-1·L-4·L-5·L-6] |
| `live_verify.js` | 코드 | ★재검증(전후 대조) 쓰는 법: laws 각 항목에 `question`(지난번에 실제로 물은 문장)·`expected`·`prev` |
| `map_scope_cell.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `master_laws.py` | 글만 | 해양·수산 법률 마스터 목록 (77개, 확정). 키=도메인 폴더명. |
| `match_weather_warning_tree.py` | 코드 | 기상특보 출항·운항통제 자산의 **암시 하강(implicit descent) 매칭기** — 이번 라운드는 실서빙 미배선. |
| `merge_byl_ocr.py` | 코드 | 이미지 OCR sidecar(_이미지/<id>.txt)를 원문 raw의 <img id="N"> 자리에 접어 넣는다. |
| `merge_legacy_tier_files.py` | 글만 | 옛날 이름으로 흩어져 있는 계층 파일을 `<계층>_발췌.txt` 하나로 모은다. |
| `merge_review_gen.py` | 글만 | review_gen/*.md 법별 partial 카드를 공유 review_queue.md에 **단독(직렬)** 병합. |
| `meta_id_home.py` | 글만 | 꼬리표 판번호를 **제자리(`families.<계층>`)로** 옮긴다 — 3-37 이 「계층 불명」으로 남긴 것. (3-9) |
| `meta_measured_refresh.js` | 코드 | V5-41 의 짝 — **「실측」 칸을 다시 재어 새 날짜로 적는다.** (2026-09-24 신설) |
| `meta_mst_align.py` | 코드 | V5-18 「어긋남」 — **같은 계층을 두 자리가 다르게 말하는** `_meta.json` 을 맞춘다. |
| `meta_mst_recover.py` | 코드 | 3-37 — **판번호가 아예 없는 `_meta.json` 68곳**에 번호를 되찾아 준다. |
| `mok_audit.py` | 코드 | raw 조문 파일에 **목(가.·나.·다.)이 통째로 빠진 곳**을 원본과 직접 대조해 찾는다. |
| `nonum_byl_note.py` | 글만 | 3-54 뒤쪽 (결심 ⑥ⓑ) — **번호 없는 별표에 「원문에 번호가 없다」고 적는다. |
| `notice_scope_prep.py` | 코드 | 고시 쪽의 **`## 적용범위·제외` · `## 타법 연결`** 에 넣을 **원문을 미리 뽑아 둔다**. (3-6 준비) |
| `num_exact_check.py` | 글만 | 위키 쪽이 적은 **숫자로 된 법적 효과**가 raw 원문에 글자 그대로 있는지 기계로 센다. |
| `ocr_review_verify.js` | 글만 | 별표 OCR값확정 대기 카드(review_gen/) Opus 비전 2차 재검증. |
| `ocr_wiki.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `ordin_byl_links.py` | 코드 | 3-49 — 조례 별표는 **본문이 안 온다.** 그러면 **원본으로 가는 길이라도 적어 둔다. |
| `ordin_byl_stub.py` | 글만 | 조례 별표 빈자리에 **내려받기 주소만 담은 파일**을 만든다. (3-49 = ⓐ) |
| `ordin_byl_stub7.py` | 글만 | 3-49 남은 7자리 (결심 ⑤ⓑ) — **조례 별표 7자리를 정직하게 채운다. |
| `ordin_recollect.py` | 코드 | 3-43 — 조 머리줄(`[제N조]`) 이 하나도 없는 자치법규 원문을 **다시 받아** 제 꼴로 바꾼다. |
| `ordin_to_folder.py` | 코드 | 조례(자치법규) 원문을 **챗봇이 열 수 있는 꼴**로 바꿔 폴더에 넣는다. |
| `pick_audit_wave.py` | 글만 | 감사 라운드 R의 다음 파도(≤N, 기본35) 선정+예약. 마커 audit_r<R>_<slug>.done 없는 법 중 서로 다른 법. |
| `pick_wave.py` | 글만 | 다음 파도(≤N, 기본35) 선정 후 예약(.launched). 서로 다른 법(파일충돌 방지)·미완(.done 없음)·비-in-flight(.launched 25분내 없음). |
| `probe.py` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `promote_verify.js` | 글만 | 새로 만든 개념 페이지의 수치를 **raw 원문과 대조해** 승격 여부를 정한다(_SCHEMA §5). |
| `quote_fix.js` | 글만 | "원문 발췌"라고 인용부호를 달아 놓고 다듬어 쓴 문장을 **원문 복붙으로 되돌린다**(L-148). |
| `recollect_budchik.py` | 글만 | budchik_check.json에서 mismatch(raw엔 없는데 API엔 있음)로 확인된 건들의 |
| `recollect_byl.py` | 코드 | 별표 충돌 버그 수정: 법률/시행령/시행규칙 별표를 층별 접두어로 재수집. |
| `recollect_jomun.py` | 코드 | 조문 텍스트 재추출: 벌칙/과태료 등 '호 직속' 조문의 chapeau(형량 도입문) 누락 버그 수정. |
| `recollect_stale_2.py` | 코드 | staleness_audit.py 가 찾은 시행규칙 MST 불일치 2건(무인도서법·선박안전법)만 재수집한다. |
| `recollect_tier.py` | 코드 | law_fresh.py 가 '구버전'으로 판정한 법률·시행령·시행규칙 층을 현행 판(MST)으로 다시 받아 raw 를 갱신한다. |
| `refresh_ocr_blocks.py` | 글만 | 고쳐진 이미지 판독본(sidecar)을 원문 안의 【이미지판독】 블록에 다시 반영한다. |
| `register_demoted_drafts.py` | 글만 | 한때 canonical 이었다가 draft 로 되돌려진** 페이지를 승인 대기열에 올린다. |
| `register_open_reviews.py` | 코드 | 위키 본문에 **⚠REVIEW 표시는 있는데 승인 대기열에 항목이 없는** draft 페이지를 대기열에 올린다. |
| `regrade.js` | 코드 | 저장해 둔 라이브 검증 결과를 **규칙으로 다시 채점**한다(AI 안 씀, 비용 0). |
| `repeat_probe.js` | 코드 | **같은 질문을 여러 번** 던져 응답이 어디서 갈리는지 본다(비결정성 진단). |
| `reverify_admrul_id.py` | 글만 | 73법의 _admrul.json에 저장된 ID(lsDelegated 출처)가 최신 버전인지, |
| `review_gen.js` | 글만 | ①절충: 민감 draft의 "AI 제안값 + 출처"를 리뷰큐에 미리 채우는 앞단 생성기. |
| `review_mark_census.py` | 코드 | 3-28 / G-24 — **`(⚠REVIEW)` 표시 1,067개가 무엇을 가리키는지 갈라 센다. |
| `review_resolve.js` | 글만 | ③ 리뷰큐 자동 트리아지: 미승인 엔트리를 재검증해 resolved/needs_collect/human 판정. |
| `scope_scan.py` | 글만 | `_CHATBOT.md` §5-2(판례·법리·다툼 = 스코프 밖) 처리 후보를 골라 센다. |
| `scope.py` | 코드 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `scope2.py` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `search_eval.js` | 코드 | 검색이 **그 질문의 법을 후보로 올리는가**를 고정 질문 65개로 채점한다(AI 안 씀, 비용 0). |
| `search_gap.js` | 코드 | 고정 문제집의 `search` 실패(행은 위키에 있는데 그 페이지가 후보에 안 옴)를 |
| `search_live.js` | 글만 | 고정 문제집에서 `search` 로 찍힌 문항이 **실제 배포 챗봇에서도 실패하는지**를 잰다. |
| `section_name_unify.py` | 글만 | 위키 표준 절 이름을 하나로 맞춘다 — `## 근거 조문`. (3-5) |
| `shared_refs_cell.js` | 글만 | 마스터 워크리스트 A표(공용 타법 2개 법 이상). 각 항목: 필요한 "그 조문"만 발췌(전체 개념화 금지). |
| `sonnet_pilot.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `staleness_audit.py` | 코드 | raw 최신성 전수 재검증(읽기 전용) — 74개 핵심법의 법률/시행령/시행규칙 MST와 |
| `staleness_correct.py` | 글만 | staleness_audit.py 1차 결과의 "위임고시 ID 불일치" 항목을 발령일자 직접 대조로 보정한다. |
| `stub_rules_cell.js` | 글만 | 첨부파일 포인터 스텁(3줄) — 실제 내용은 다운로드 필요. 안전 핵심 설비·구조 기준 우선. |
| `sync_law_paths.py` | 코드 | `law_raw_paths.json`(법 이름 → raw 폴더 지도)을 **실제 raw 폴더와 맞춘다. |
| `synth_lint.js` | 글만 | 통합수정 후 공유허브(신경망)를 단독으로 재봉합한다(H-9 lint). ⚠경합위험이라 반드시 단독. |
| `synth_scope.js` | 글만 | 6차 감사 리포트를 읽어 각 법의 '스코프-밖 질문 수'를 판정해 스코프-내 full률을 산출한다. |
| `table_split_scan.py` | 글만 | 표 안에서 **줄 경계로 쪼개진 낱말**을 낱말 목록 없이 전수로 찾아 준다. |
| `tech_standard_wiki_cell.js` | 글만 | 기술기준(설비·구조 고시) 기준법-급 위키 구축 셀 |
| `tier_fill.py` | 코드 | `_meta.json` 의 `tier`(1군·2군·3군)를 규약대로 채운다. (3-1) |
| `topicmap.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `triage_admrul_pdf.py` | 글만 | admrul_fix_log.json에서 skipped(첨부파일형/축소감지)로 남은 150건을, |
| `trty_to_excerpt.py` | 글만 | 조약 raw(`조약_*.txt`)를 챗봇이 읽을 수 있는 `법률_발췌.txt` 로 모은다. |
| `verify_claims.py` | 글만 | 감사가 보고한 결함 주장을 **사람(에이전트)이 하나씩 실측 확인**하도록 배치를 짠다. |
| `verify_penalty_tree.py` | 코드 | penalty_tree.json 독립 재대조 — 빌더 로직을 한 줄도 재사용하지 않는다. |
| `verify_vessel_equipment.py` | 글만 | 선박종류 트리의 `장비` 항목 전량 독립 재대조기 (H-32 장비 축 확장, 설계 §11.8). |
| `verify_vessel_subtypes.py` | 코드 | 선박종류 세분화(원양어선·산적화물선) 독립 재대조기 (H-32 설계 §13.7). |
| `verify_weather_warning_tree.py` | 코드 | 기상특보 출항·운항통제 자산 **독립 재대조 검증기** (L-75 2단계). |
| `verify_zone_tree.py` | 글만 | zone_tree.json 독립 재대조 검증기 (설계 §6). |
| `wiki_build.js` | 글만 | (머리말 없음 — 무엇을 하는 자인지 안 적혀 있다) |
| `wiki_rebuild.js` | 코드 | 새로 수집된 raw(별표 이미지판독·별표·신규 고시/타법)를 반영해 법별 위키를 재빌드한다. |
| `xref_fix.js` | 코드 | `## 타법 연결` 표에만 있는 근거를 `## 근거 조문` 표로 옮긴다(결정 ①ⓐ, 2026-08-20). |
| `xref_todo.js` | 글만 | `## 타법 연결` 표에는 있는데 `## 근거 조문` 표에는 없는 행을 뽑아 |

> 게이트가 부르는 자는 `verify_all.sh` 에서 바로 보이므로 이 표에 넣지 않는다.
<!-- /자목록 -->
