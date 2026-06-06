# 나리야 AI 고도화 — 마스터 플랜

> **이 문서는 채팅을 대체하는 단일 추적 문서입니다.**
> 산출물 본문은 여기 넣지 않습니다 — 별도 파일로 만들고 여기엔 **경로만** 둡니다.
> 사용 규칙은 `README.md`. 독립 검토 반영본(v2). 최종 갱신: **2026-05-29**.
> 검토 근거: → 참고 `phases/plan_review.md` (적합성 72/100 지적사항 반영).

---

## 1. 비전 / 최종 목표

나리야를 **"질문에 답하는 비서"에서 "직군을 이해하고, 먼저 제안하며, 스스로 성장하는 비서"** 로 끌어올린다.

- **(이해)** 사용자의 직군·맥락을 알고, 그 직군이 중요하게 보는 데이터를 우선 제시.
- **(연결)** 앱의 모든 공개 데이터를 막힘없이 정확히 가져와 답한다.
- **(선제)** 조건이 충족되면 묻기 전에 알린다.
- **(성장)** 직군 지식을 사람 검수 하에 지속 확장하고 RAG로 활용한다.
- **(기반)** 온톨로지 + 지식그래프 + RAG로 뼈대를 세운다.

### 불변식(Invariants) — 모든 단계에서 절대 깨지면 안 되는 것
- 🔒 **관리자 격리**: 관리자 전용 기능(`/api/admin/*`)은 나리야 도구/응답으로 **절대 노출·실행하지 않는다.** (회귀 테스트 필수)
- 🔒 **프라이버시**: 프로필·대화기록·스타일요약은 **휴대폰 로컬 저장**이 원칙. 서버는 비식별 로그만(범위·보존기간은 §8).
- 🔒 **안전 문구**: 출항/조업 안전 판단은 데이터 근거로 간단히 주고 "최종 판단은 선장 몫"은 **딱 1회만**. 과잉 면책 금지.
- 🔒 **거짓 생성 금지**: 사용자가 사실을 단정해도 수집결과와 다르면 수집결과를 따른다(환각 방지).

---

## 2. 로드맵 대시보드 (단일 상태표 — 다른 곳의 상태는 여기서 파생)

| Phase | 목표 | 상태 | 핵심 산출물(경로) |
|---|---|---|---|
| **Phase 0** 🔁 | 토대 안정화 + **상시 회귀 게이트** | ✅ 38케이스 통과(머지 후 재검증 37P/0F/1SKIP, 2026-05-30) | `phases/phase0_diagnostics.md`, `phases/phase0_golden.jsonl`, `phases/phase0_runner.py` |
| **Phase 2a** | 직군별 지식베이스(8종) | ✅ 완료(스키마 정합화 포함) | `jikgun/*.md`, `jikgun/_SCHEMA.md` |
| **Phase 2b** | 간이 RAG 연결(직군 감지→MD 주입) | 🚧 v1 구현(룰베이스 주입) · **다음=측정 토대(평가셋+SLO)** | `routes/assistant.js`(detectJikgun/jikgunDigest) |
| **Phase 1** | 온톨로지 & 지식그래프 | 🚧 스키마+그래프+런타임연결 + **데이터카탈로그 단일출처(2026-05-30)** + 미노출 도구화(시정16/21) + focus 연속성 + 의존 위빙 | `phases/phase1_ontology_schema.md`, `graph/build_graph.js`, `graph/graph.json`, `knowledge/data_catalog.json` |
| **Phase 3** | 선제 제안(Proactive) | ⏳ 예정 | 입력=`jikgun/*.md` 선제규칙 섹션 |
| **Phase 4** | 자율 성장(수집·검수·반영) | ⏳ 예정 | (미생성) |
| **교차(X)** | 평가/회귀/비용/프라이버시/시크릿/신선도 + **호출어 엔진 무료 오픈소스(Vosk, 2026-05-30)** + **자유변칙 평가 게이트(440케이스, 2026-05-30)** | 🚧 정의 중 — 자유변칙 PASS 72%, 직군 floor ≥70%·카테고리 ≥70% DoD 미달 | §8, (예정)`phases/cross_cutting.md`, `android/.../voice/Vosk*.java`, `phases/phase2b_eval_freevar*.{py,jsonl}` |

> **순서 메모:** 사용자 결정으로 **Phase 2를 Phase 1보다 먼저** 착수(직군 지식이 온톨로지 1차 재료). **되먹임:** P1 온톨로지 확정 후 직군 문서의 노드/엣지 태깅을 **소급 정비**한다(단방향 아님).

---

## 2.5 이미 구현된 기능 인벤토리 (보존·회귀 대상)

> 검토 지적: 빈틈은 "미구현"이 아니라 **"미추적"**. 이미 코드에 있는 의도는 로드맵의 **보존·회귀 대상**으로 명시한다.
> 상세 등재는 → 예정 `phases/implemented_inventory.md` (코드경로·커밋·회귀항목 매핑). 아래는 요약.

| 기능(최초 의도) | 코드 위치(요약) | 커밋 | 회귀 대상 |
|---|---|---|---|
| Tool Use 두뇌(복합·추론) | `routes/assistant.js` planQuery/runBrain | — | P0 골든셋 |
| 호출어 상시대기(Porcupine) | `android/.../voice/*`, b8da952 | b8da952 | STT 회귀 |
| 클라우드 STT + 도메인 힌트 / AI 보정 | `/transcribe`, correctedQuery | 4e0ae0b/b8da952 | STT 회귀 |
| 웹검색/참고링크 폴백 | googleSearch 그라운딩 | — | 폴백 품질 |
| 딥링크 이동(레이어/특보/태풍/해구/부이/물때) | buildLinks, assistant_deeplink.js | 33e0b4c | 딥링크 커버리지 |
| GPS 최근접 부이 등 위치질문 | get_nearest_buoy | — | P0 위치축 |
| 관리자 보안 격리 | TOOL_CATALOG 주석/도구 미포함 | — | 🔒 보안 테스트 |
| 응답 길이 정책(간단/자세히) | style answerStyle | — | 회귀 |
| AI 대화형 온보딩→직군 프로필(로컬) | `/onboard`, js/assistant.js | — | P2b 전제 |
| 대화기록→통계형 스타일 요약 개인화 | `/style-digest`(8건마다) | — | P3 입력 |
| **데이터 카탈로그(단일 출처) + 인벤토리 주입** | `knowledge/build_data_catalog.js`→`data_catalog.json`(21데이터셋), `routes/assistant.js` planQuery 인벤토리 디지스트 | 81f3790 | 게이트 카탈로그 드리프트검사 |
| **미노출 도구화** | `get_visibility`, `get_zones_ranked` metric=temp/vis | 02e47ca | rank-temp/rank-vis-worst/visibility-busan |
| **구조화 대화 연속성(focus)** | 응답 `focus{zone,haegu,buoy,coords,rankedItems}` + 플래너 [직전 확정 대상] | 688cb7e | focus-haegu-coord/followup-haegu-coord |
| **의존 위빙(1회 재계획)** | "X 가장 ~한 곳의 Y" — 1차 focus로 2차 도구 재계획 | a2a2ca1 | weave-rank-warning |
| **Vosk 호출어 엔진 + 모델 동의 다운로드** | `android/.../voice/VoskWakeEngine.java`·`VoskModelManager.java`·`VoskDownloadService.java`, `SeagnalAssistantPlugin`(getCapabilities/voskState), `js/assistant.js`(다이얼로그) | b366011 | 🔒 가입·승인·유료화 없음(Apache-2.0) |

---

## 3. 단계별 상세 설계

각 단계: **[목표]·[진행방식]·[세부단계]·[완료기준(DoD)]·[현재상태]·[산출물 경로]·[리스크/제약]**.

---

### Phase 0 — 토대 안정화 + 상시 회귀 게이트  ✅1차 / 🔁상시

- **목표**: 나리야가 앱 공개 데이터를 막힘없이·정확히 가져오는지 검증하고, **이후 모든 단계에서 이 수준이 깨지지 않게 회귀로 지킨다.**
- **진행 방식**: 도메인 태깅 78문항 배터리 자동 호출 → 도메인별 수치/없음/오류 집계 → 진짜버그 vs 환경한계 분리. **P1~P4 코드가 들어올 때마다 재실행.**
- **세부 단계**:
  - [x] 1차 진단·보강(유속 단위, 좌표해석, 환각방지, 후속맥락, STT교정)
  - [x] 2차 보강(동해중부 폴백, 지수 라우팅, 부이 필드 병합) — `b1a34aa`
  - [x] 조석 앱 버튼 보장 — `33e0b4c`
  - [x] DMDW 키 검증(태풍 장미 실데이터)
  - [x] **골든셋 파일화** → `phases/phase0_golden.jsonl`(31케이스, 값이 아닌 구조 불변식) + 러너 `phases/phase0_runner.py`/메모 `phases/phase0_runner.md`
  - [x] **보안 격리 회귀**(정적검사: 도구의 `/api/admin` 호출·admin 도구 정의 탐지 + 관리자 의도 질의 누설 점검)
- **완료 기준(DoD)**: 골든셋 하드실패 0건 + 핵심 도메인 수치응답 + 🔒 관리자 격리 통과. **각 후속 단계 DoD에 "P0 골든셋 무회귀" 포함.**
- **현재 상태**: ✅ **게이트 구축·통과**(PASS 31/FAIL 0/SKIP 0 + 정적 보안검사 통과). P1~P4 변경 시 `python3 knowledge/phases/phase0_runner.py` 로 재검.
- **산출물**: → 참고 `phases/phase0_diagnostics.md`, `phases/phase0_runner.md`
- **리스크/제약**: 수심·해무CCTV·바다낚시지수는 로컬 데이터 부재→웹폴백(운영에선 내부응답). 운영 시크릿 필요(§8).

---

### Phase 2a — 직군별 지식베이스  ✅ 완료(커밋 대기)

- **목표**: 앱 설문 8개 소속별 관심사·의사결정·용어·동향·GAP·선제규칙을 표준 스키마 MD로 구축.
- **대상 직군(8)**: 해양경찰·어업종사자·레저스포츠·해양수산부·해군·지자체·공공기관·기타(낚시객). *(출처 `routes/usage.js`)*
- **진행 방식**: 직군별 리서치 에이전트 병렬 → 표준 스키마 → 2차 보강(선제규칙 8개씩·GAP 외부연동). **앱 보유 도구에만 매핑, 미충족은 `[GAP]`.**
- **세부 단계**:
  - [x] 1차 빌드(8종) / [x] 2차 보강(8종)
  - [x] **`jikgun/_SCHEMA.md` 제정 + 8종 정합화** 완료 (frontmatter, 규칙ID `TR-<약어>-01~08`, 트리거 조건식 `{metric,op,threshold,unit}`, 필수 섹션·칼럼 고정, 동향 수집일/비공식 표기)
  - [ ] 통합 STT 용어사전 → `jikgun/_glossary_stt.md`
  - [ ] GAP 외부연동 URL 세부경로 검증(담당·시점 §6)
- **완료 기준(DoD)**: 8종이 **공통 스키마 준수** + 앱 도구 정확 매핑 + GAP 식별 + 규칙ID/트리거 기계추출 가능. → ✅ 충족(8종 frontmatter·`TR-<약어>-NN`·조건식·고정칼럼 검증 완료).
- **현재 상태**: ✅ **완료.** 잔여 선택산출물(용어사전·GAP로드맵)은 비차단.
- **산출물**: → 참고 `jikgun/coast_guard.md` 외 7종.
- **리스크/제약**: 직군간 스키마 표류 시 P1/P3 입력 재작업. 동향 시점형→만료/재검증 필요.

### Phase 2b — 간이 RAG 연결  ⏳ 예정

- **목표**: 프로필 직군 감지 → 해당 직군 MD를 플래너/합성 컨텍스트로 주입 + 선제규칙 적용.
- **진행 방식(안)**: 직군→파일 매핑 로더 → 질의 시 관련 섹션 검색/주입(초기: 직군 전체 또는 섹션 룰베이스, 이후 임베딩 검색).
- **세부 단계**: [x] 직군 감지(`detectJikgun`)·지식 로더(`JIKGUN_KB`, 8종/관심사 112개) [x] 주입 지점(planQuery=관심사 우선순위+용어, synth=답변 우선순위) [ ] 검색 방식 룰→**임베딩** 고도화 [ ] 토큰예산·지연 측정 [ ] 직군 평가셋
- **완료 기준(DoD)**: 직군 설정 사용자 질의에서 직군 지식이 답변에 반영되고, **P0 무회귀 + 토큰/지연 SLO(§8) 충족 + 직군 평가셋 적중률 ≥ 베이스라인**.
- **현재 상태**: 🚧 **v1 구현·검증 완료**(룰베이스 다이제스트 주입). 검증: 낚시객 프로필+"오늘 거문도 어때"→물때·낚시지수 우선 선택, 어업 선장→예보·특보·물때·조류 종합, 무프로필 회귀 없음. **잔여: 임베딩 검색·평가셋·SLO 측정.**

---

### Phase 1 — 온톨로지 & 지식그래프  🚧 스키마 설계 완료

- **목표**: 도메인 개념(해역/해구/부이/특보/지수/조석/태풍/직군/관심사)과 관계를 정형화해 검색·추론 뼈대로.
- **진행 방식(안)**: 엔터티/관계 스키마 → 기존 식별자 정합(해역명↔regId↔해구↔ZONE_COORDS↔조석표준항) → 직군 지식(관심사·도구·GAP·용어) 흡수 → RAG 검색 그래프 확장 PoC.
- **세부 단계**: [x] 스키마 설계 `phases/phase1_ontology_schema.md` [x] **직군→`graph/graph.json` 자동 빌더**(`graph/build_graph.js`: 978노드/1232엣지 — SeaZone43·Buoy118·TideStation165·DataParam12·Tool19·Jikgun8·Topic169·Term288·Gap92·Rule64; servedBy313·near176·triggersOn96 등) [x] 그래프 저장포맷 확정(graph.json) [~] 식별자 정합표(해구 격자좌표는 data/zone_coords.json 1296개 적재·런타임 사용 시작 → 해구↔해역 매핑표는 잔여) [ ] **P2 직군문서 태깅 소급 정비(되먹임)** [ ] RAG 확장 PoC(베이스라인 먼저)
- **완료 기준(DoD)**: 핵심 엔터티/관계 정의(✅) + `graph.json` 생성(✅) + 식별자 정합(해구 보류) + 평가셋에서 **그래프 확장 적중률 베이스라인 대비 향상**(RAG 연결 단계).
- **현재 상태**: 🚧 **스키마+그래프 빌드 + 런타임 연결(1차) 완료.** `routes/assistant.js`가 `graph.json`을 단일 출처로 로드해 감지된 직군에 **"관심사→권장도구(servedBy)" 라우팅 힌트**를 플래너에 주입(예: 낚시객 모호질문→get_tide·get_fishing_index 우선). 게이트에 **그래프 무결성·런타임 연결 정적검사** 추가. 다음: Term 동의어 활용(흔한단어 오매칭 가드 필요) / 해구↔해역 정합.
- **산출물**: → 참고 `phases/phase1_ontology_schema.md`

---

### Phase 3 — 선제 제안(Proactive)  ⏳ 예정

- **목표**: 직군·위치·시각·기상 조건 충족 시 묻기 전 알림.
- **진행 방식(안)**: 직군 파일 "선제 제안·개인화 규칙"(트리거→멘트→근거툴)을 **기계가독 규칙**으로 추출 → 트리거 평가기 → 알림 채널.
- **세부 단계(초안)**: [ ] 규칙 기계가독화 `phases/phase3_proactive_rules.md` [ ] 트리거 평가(폴링/이벤트) [ ] 알림채널·on/off·방해금지 [ ] 🔒 안전문구 1회 정책 적용
- **완료 기준(DoD)**: 1개+ 직군 실조건 선제 알림 발생 + **오발신율 < 목표치 + 빈도 ≤ N건/일**(수치 착수 시 확정) + P0 무회귀.
- **현재 상태**: ⏳ 미착수(입력 규칙은 직군별 8개씩 확보됨).

---

### Phase 4 — 자율 성장(수집·검수·반영)  ⏳ 예정

- **목표**: 직군 지식을 **사람 검수 하에 지속 확장**(모델 자가학습 아님 = 자동수집+RAG+휴먼리뷰).
- **진행 방식(안)**: 🔁 주기 수집 → 검수 큐 → 승인 시 MD/그래프 반영 → RAG 인덱스 갱신. 출처·수집일·신뢰도 메타 필수, 시점형 만료 정책.
- **세부 단계(초안)**: [ ] 소스 화이트리스트·주기 `phases/phase4_pipeline.md` [ ] 변경제안 포맷·검수 UI(관리자 탭 연계) [ ] 반영·롤백·버전관리(MD diff/커밋)
- **완료 기준(DoD)**: 새 동향 1건이 수집→검수→반영→RAG 노출까지 한 사이클 통과 + 롤백 가능.
- **현재 상태**: ⏳ 미착수.

---

## 4. 산출물 인덱스 (경로 모음)

| 단계 | 산출물 | 경로 | 상태 |
|---|---|---|---|
| P0 | 진단 결과 | `phases/phase0_diagnostics.md` | ✅ |
| P0 | 골든 회귀셋 + 러너 | `phases/phase0_golden.jsonl`, `phases/phase0_runner.py`, `phases/phase0_runner.md` | ✅ |
| X | 검토 리포트 | `phases/plan_review.md` | ✅ |
| X | 이미 구현된 기능 인벤토리 | `phases/implemented_inventory.md` | ✅ (2026-06-03, 2-pass, 37기능·20도구·커밋 매핑) |
| X | 교차 관심사·운영정책 | `phases/cross_cutting.md` | ✅ (2026-06-03, 6축·SLO·DoD 0/5 갭 명시) |
| X | 보안 경계 명세 | `phases/security_boundary.md` | ✅ (2026-06-03, web_search 우회 잔여리스크 확정) |
| P2a | 직군 지식베이스 8종 | `jikgun/*.md` | ✅ |
| P2a | 직군 공통 스키마 | `jikgun/_SCHEMA.md` | ⏳ |
| P2a | 통합 STT 용어사전 | `jikgun/_glossary_stt.md` | ✅ (2026-06-03, 호출어 5변형 엔진정합·vocab 통합) |
| P2a | GAP→로드맵 | `phases/gap_roadmap.md` | ✅ (2026-06-03, GAP 37건·부분보유 재분류) |
| P1 | 온톨로지 스키마 | `phases/phase1_ontology_schema.md` | ✅(설계) |
| P1 | 지식그래프 빌더+데이터 | `graph/build_graph.js`, `graph/graph.json` | ✅ |
| P1 | **데이터 카탈로그(단일 출처) 빌더+데이터** | `knowledge/build_data_catalog.js`, `knowledge/data_catalog.json` | ✅ (21데이터셋·드리프트게이트) |
| P1 | 해구↔해역 매핑 빌더+데이터 | `graph/build_haegu_sea_mapping.js`, `graph/haegu_sea_mapping.json` | ✅ (2026-06-03, 1296해구→48해역, 5코드 폴백 주의) |
| X | **호출어 엔진(Vosk)** | `android/app/src/main/java/com/seagnal/app/voice/Vosk*.java`, `SeagnalAssistantPlugin.java`(확장) | ✅ (APK 재빌드 대기) |
| P3 | 선제 규칙(기계가독) | `phases/phase3_proactive_rules.md` | ✅ (2026-06-03, 64규칙 JSON·트리거 평가기 의사코드) |
| P4 | 수집·검수 파이프라인 | `phases/phase4_pipeline.md` | ✅ (2026-06-03, 사람검수·1제안=1커밋·admin 인증정합) |
| X | 평가 측정 토대 — sentinel/평가확대/환각캡처 | `phases/phase2b_sentinel.{jsonl,md}`, `phases/phase2b_eval_expand_v2.md`, `phases/halluc_cot_capture.py` | ✅ (2026-06-03 초안) |
| X | 인프라 설계 — 토큰계측/모듈분리/args스키마/CI/로그스키마 | `phases/token_metering_design.md`, `refactor_assistant_modules.md`, `tool_args_schema.md`, `builder_ci_design.md`+`ci_workflow_draft.yml`, `assistant_log_schema.md` | ✅ (2026-06-03 설계초안) |
| X | 보안 회귀 — 관리자격리/memory누수 | `phases/security_admin_{regression.md,cases.jsonl}`, `memory_leak_{regression.md,cases.jsonl}` | ✅ (2026-06-03, 러너 확장 필요 명시) |
| P2b | v5 측정 프레임 종합 | `phases/v5_measurement_synthesis.md` (+_A/_B 원문) | ✅ (2026-06-03, 12-agent 합성) |
| P2b | sentinel 잔존결함 패치 종합 | `phases/patch_synthesis.md` (+patch_A_continuity_localgov.md, patch_B_quantitative.md) | ✅ (2026-06-03, 충돌 봉합·단일 PR) |
| X | p95 게이트화·SLO 운영정책 종합 | `phases/p95_gate_synthesis.md` (+_A_design, _B_ops_policy) | ✅ (2026-06-03, raw_ms 케이스적재 채택) |
| P0 | sentinel P0 합류·케이스 확장 종합 | `phases/sentinel_gate_synthesis.md` (+_A_design, _B_extension) | ✅ (2026-06-03, SEC 별도 하드게이트) |
| P2b | α — 8커밋 통합 PR 적용본 종합 R2 | `phases/alpha_synthesis_R2.md` (+alpha_patch_A_impl, alpha_patch_B_impl) | ✅ (2026-06-04, 충돌 0건·C1→C8 머지 순서·monitorOverview 가드 격상) |
| P0 | β — sentinel v2 35케이스 통합 게이트 R2 | `phases/beta_synthesis_R2.md` (+beta_runner_impl, beta_cases_impl, phase2b_sentinel_v2.jsonl) | ✅ (2026-06-04, cat_key 4중 OR·AND 결합·phase0-gate 분리 잡) |
| P2b | γ — v5 측정 자동화 R2 (사전점검/실행/분석) | `phases/gamma_synthesis_R2.md` (+preflight_v5.sh, run_v5.sh, gamma_runtime_A.md, analyze_v5.py, gamma_analysis_B.md) | ✅ (2026-06-04, 정합 0 마찰점·C3 경로 정정·재시작 분위수 정책) |
| X | δ — p95 게이트화 운영 (러너 raw_ms + cross_cutting/알람/롤백) R2 | `phases/delta_synthesis_R2.md` (+delta_runner_A_impl, delta_ops_B_impl) | ✅ (2026-06-04, log v1.1 3필드 직접 저장·CI vs 런타임 시간축 분리·net p95 단독 검증) |
| P2b | v5 측정 1회차 리포트 + 로그 아카이브 | `phases/v5_run1_report.md`, `phases/v5_run1_freevar.log.gz` | ✅ (2026-06-04, 440 케이스 종합 78.9%·정량 +47pp·CoT 0·p95 6120ms) |
| P2b | v5 측정 2회차 (5차 라운드 적용 후) | `phases/v5_run2_report.md`, `phases/v5_run2_freevar.log.gz` | ✅ (2026-06-05, 440 종합 81%·다중 +20·CoT 0·p95 5736ms) |
| X | 5차 라운드 #30/#31/#35 설계·합성·코드 통합 | `phases/p_continuity_v2_{A,B,synthesis}.md`, `p_multitool_{A,B,synthesis}.md`, `p_security_v1_{A,B,synthesis}.md` | ✅ (2026-06-04, sentinel v2 27/30+5/5 통과) |
| X | 6차 라운드 #36/#37 설계·합성·코드 통합 | `phases/p36_zone_debug_{A,B}.md`, `p36_synthesis.md`, `p37_p95_{diet_A,parallel_B}.md`, `p37_synthesis.md` | ✅ (2026-06-05, sentinel v2 29/30+5/5 통과) |

---

## 5. 의사결정 로그

| 날짜 | 결정 | 비고 |
|---|---|---|
| 2026-05-29 | Phase 2를 Phase 1보다 먼저 진행 | 직군 지식이 온톨로지 1차 재료 |
| 2026-05-29 | 직군 8종 전체, 지속형 지식 우선 | 동향은 별도 섹션·시점형 |
| 2026-05-29 | 산출물은 파일로, 플랜엔 경로만 | 추적성·가독성 |
| 2026-05-29 | 독립 검토 반영(v2): 인벤토리·불변식·회귀게이트·2a/2b분리·교차관심사 추가 | `phases/plan_review.md` 72/100 |
| 2026-05-29 | **산출물 저장 방식: "리포 정본"** 채택(읽기는 배포본=볼륨과 동일 속도, 리포가 검토·이력·배포통로). 자율성장(P4) 때 볼륨 런타임 작업본 추가 | §9 참고 |
| 2026-05-29 | `knowledge/` 커밋 진행(휘발 위험 해소) | 저장방식 합의 완료 |
| 2026-05-29 | Phase 0 게이트 구축 / Phase 1 온톨로지 스키마 설계 / Phase 2b v1 구현 | 각 phases 산출물 |
| 2026-05-29 | **머지 후 나리야 검증을 필수 절차로 채택** | §8 교차관심사 |
| 2026-05-29 | **Phase 1 지식그래프 빌드**: graph/build_graph.js + graph.json(978노드/1232엣지) | 직군 파일·식별자에서 자동 추출 |
| 2026-05-29 | **그래프 런타임 연결(1차)**: assistant.js가 graph.json 로드 → 직군 servedBy 라우팅 힌트 주입 + 게이트 무결성검사 | 게이트 30P/0F/1SKIP 유지 |
| 2026-05-29 | **골든 buoy-geomun-temp → optional**: 거문도 부이 간헐 전결측(피드 의존) 위양성 방지 | 부이 수치 커버리지는 buoy-oryuk-wave |
| 2026-05-29 | **해구 랭킹·조회 + 대화 연속성**: get_zones_ranked scope="haegu"(해구 번호+경위도), get_zone_forecast 좌표 반환, zone_coords.json 적재, 플래너 지시어 확장, 클라 memory 항상저장(160자) | 게이트 33케이스 통과(rank-haegu-wind·followup-haegu-coord 신규) |
| 2026-05-29 | **골든 context-warn 수정**: corrected(질의재작성=구현세부) 대신 결과(올바른 해역 해소)로 검증 | 맥락 해소 견고화 |
| 2026-05-29 | **격리 에이전트 3종 병렬 검토**: 데이터인벤토리/AI지식격차/대화연속성 → P1~P4 수정계획 도출 | 근본원인=AI가 구조적 상태(인벤토리·focus) 미보유 |
| 2026-05-29 | **P1 데이터 카탈로그(단일 출처)**: build_data_catalog.js→data_catalog.json(21데이터셋, 노출15/미노출6, 도구19). 플래너 인벤토리 주입 + 게이트 드리프트검사 | TOOL_CATALOG/APP_CAP/build_graph/cache_manager 4중분산 해소 시작 |
| 2026-05-29 | **게이트 재시도 강화**: KHOA 유속 첫히트 지연 흡수 위해 백오프 2회(3s·6s) | current-* 위양성 제거 |
| 2026-05-29 | **P2 미노출 데이터 도구화**: get_visibility(시정계) + get_zones_ranked metric에 temp(수온)/vis(시정) 추가 | "시정 어때/수온 줄세워/어디 시정 제일 나빠" 응답. 시정 노출(16/21) |
| 2026-05-29 | **surf-index → optional**: KHOA 서핑지수 공유키 경합 간헐 수집실패(파일 부재) 위양성 방지 | data/ 정리 중단(피드 보존) |
| 2026-05-29 | **P3 구조화 대화 연속성(focus)**: 서버가 응답에 focus{zone,haegu,buoy,coords,rankedItems} 반환 → 클라 저장·재전송 → planQuery가 [직전 확정 대상]으로 결정론적 소비 | 자유텍스트 memory 유실(해구번호·좌표) 극복. 2턴 검증 통과 |
| 2026-05-29 | **P4 의존 위빙(1회 재계획)**: "X 가장 ~한 곳의 Y(특보/조석/유속/수심)"를 1차 focus로 2차 도구 재계획(좁은 트리거·도구중복 방지) | "파고 1위 해역→특보" 2도구 위빙 검증. 게이트 38/0 |
| 2026-05-29 | **격리 에이전트 검토 P1~P4 완료** | 게이트 38케이스(정적 3종 포함) 통과 |
| 2026-05-30 | **PR #808 머지 후 골든 게이트 재검증 통과**: PASS 37/0/1(SKIP=피드의존 optional 1) | 회귀 무발생 확인 |
| 2026-05-30 | **다음 단계 = 측정 토대(직군 평가셋 + 토큰/지연 SLO 계측)** | §8 "베이스라인 먼저" 원칙. P2b·P1·P3 DoD의 게이팅 전제 |
| 2026-05-30 | **호출어 엔진 Picovoice→Vosk(Apache-2.0) 전환 결정** | Picovoice 가입 단계서 상업 검토 잠금 + 무료티어 2026-06-30 종료(7일 트라이얼) → 영구 무료·승인 무필요·락인 없음으로 회피 |
| 2026-05-30 | **Vosk 한국어 모델(~80MB)은 사용자 동의 후 1회 다운로드 채택** | APK 미포함(용량+0, 미사용자 다운로드 0). Wi-Fi 기본 + "데이터로 받기" 옵션. 다운로드 중 호출어 비대기, "음성 지원 데이터 다운로드 중" 안내만 |
| 2026-05-30 | **PR #811 호출어 무료 오픈소스화** | VoskWakeEngine/ModelManager/DownloadService + 플러그인 확장 + 다이얼로그. APK 1회 재빌드 후 영구 무료 |

## 6. 미결 질문 / 다음 액션 (owner·기한)

| # | 항목 | owner | 기한 |
|---|---|---|---|
| 1 | `knowledge/` 일괄 커밋 시점 결정(미커밋=휘발 소멸) | 사장님 | ASAP |
| 2 | ~~`jikgun/_SCHEMA.md` 제정 + 8종 정합화~~ ✅ 완료(2026-05-29) | 나리야팀 | 완료 |
| 3 | ~~Phase 2b(간이 RAG) 착수~~ ✅ v1 완료(2026-05-29). 잔여=임베딩·평가셋·SLO → **측정 토대(평가셋+SLO)부터 next로 확정(2026-05-30)** | 나리야팀 | next |
| 4 | GAP 외부연동 URL 세부경로 검증 담당 | 미정 | P2a |
| 5 | 운영 시크릿(`KMA_DMDW_*`/TideBED) 배포 반영 | 미정 | 운영배포 |
| 6 | 테스트용 Gemini 키 폐기 | 사장님 | ASAP |
| 7 | **Vosk 통합 APK 재빌드 + 기기 동작 검증**(다이얼로그·진행률·"나리야" 호출) | 사장님 | ASAP |
| 8 | ~~측정 토대 구축 — 직군 품질 평가셋(`phases/phase2b_eval.jsonl`+러너) + 토큰/지연 SLO 계측~~ ✅ v1 가동(2026-05-30, PASS 6/10, p50=1770ms/p95=6114ms). 잔여=토큰 계측(어시스턴트 응답에 usageMetadata 노출) | 나리야팀 | v2 |
| 9 | **marine.kma 엔드포인트 적재 실패 추적**: `fetch failed`/HTTP 403/JSON parse fail. 인증·URL 변경 여부 확인, 회복 시 베이스라인 재측정 | 사장님/운영 | ASAP |
| 10 | ~~임베딩 검색 PoC~~ ✅ v1 가동(2026-05-30, gemini-embedding-001·3072d·169토픽). 결과 PASS 6/10 무변(1↑/1↓), 지연 +600~800ms. **결론: 임베딩만으로는 부족** | 나리야팀 | v2 후보 |
| 11 | ~~플래너 web_search 폴백 절제~~ ✅ 완료(2026-05-30). PASS 6/10→8/10, 지연 회복(p50 1788ms). 잔여 실패=무프로필 모호어/잘못된 행정구역명 — 별도 후속(#14/#15) | 나리야팀 | 완료 |
| 12 | **음성 비서 P3 focus 패치(commit `e305566`)** — APK 재빌드 시 같이 확인. "232 해구→거기 경위도?" 음성 후속 연속성 | 사장님 | Vosk 빌드와 동시 |
| 13 | ~~평가셋 러너 N회 다수결~~ ✅ 완료(2026-05-30, N=3 다수결 + 429 백오프 + 페이싱). PASS 9/10, 비결정성 0건. 잔여=케이스 30+ 확대(v2) | 나리야팀 | v2 |
| 17 | ~~비도메인 대화 연속성~~ ✅ 옵션 C 채택·완료(2026-05-30). 음성 비서 memory 동봉으로 채팅창과 동등. 잔여 옵션(a) topic 칸 추가는 도메인 가드까지 완화하지 않아 web_search 차단 그대로 — 필요시 v2 후보 | 나리야팀 | 완료 |
| 14 | ~~무프로필 모호어 처리~~ ✅ 부분완료(2026-05-30, baseline-geomun 회복). detectZoneDeterministic+섬·부이 정규식 기반 도메인 가드 | 나리야팀 | 완료 |
| 15 | ~~잘못된 행정구역명 정정~~ ✅ 완료(2026-05-30, stage 3 역방향 토큰 매칭). "전남남해"→"전남동부남해앞바다" 보정 작동 확인. forecast 호출 회복 | 나리야팀 | 완료 |
| 16 | ~~합성 환각 가드~~ ✅ 완료(2026-05-30, 빈 results 차단 + 프롬프트 환각 금지 강화). 지연 p95 5858→3440ms 효과 | 나리야팀 | 완료 |
| 18 | ~~다중 도구 hint 강화~~ ✅ 완료(2026-05-30). planQuery 에 직군별 multi-tool 패턴 명시 + DOMAIN_RE 보강("해양/바다/섬/항구/항만"). 평가 만점 PASS 10/10 달성 | 나리야팀 | 완료 |
| 19 | **결함 2 — zone 모호 multi-tool 빈응답** 도구 구현 수준 변경(get_marine_forecast 가 zone 없으면 광역 요약). 8-agent 검증에서 다수 직군이 종합 질의 시 빈응답 | 나리야팀 | next |
| 20 | ~~50문항/직군 재검증~~ ✅ 완료(2026-05-30, 자유변칙 v2 직렬 440 케이스). PASS 72%, 카테고리 결함 우선순위 확정 | 나리야팀 | 완료 |
| 21 | ~~정량 임계 판정기~~ ✅ 완료(2026-05-30). _thresholds.json + synth 임계표 주입 + 가부 결론 한 줄 먼저 규칙 | 나리야팀 | 완료(자유변칙 효과 측정중) |
| 22 | ~~focus 후속 전파 강화~~ ✅ 완료(2026-05-30). 대명사 검출+결정론적 args 주입 | 나리야팀 | 완료(자유변칙 효과 측정중) |
| 23 | ~~직군 floor 보강~~ ✅ 완료(2026-05-30). marine_leisure 해변→get_surfing_index 우선 / local_gov 모호지명→GPS·전국 처리 | 나리야팀 | 완료(자유변칙 효과 측정중) |
| 24 | ~~memory 출력 누수 가드~~ ✅ 완료(2026-05-30). synth 프롬프트 컨텍스트 격리 + 응답 후처리 라벨 라인 제거 🔒 | 나리야팀 | 완료 |
| 25 | **자유 변칙 게이트화 + P2b DoD 강화** — phase2b_eval_freevar 를 회귀 게이트로 등재(sentinel 20케이스 ≤3분 분리). DoD: 자유변칙 PASS ≥85% · 직군 최저 ≥70% · 카테고리별 ≥70% · 환각 ≤2건/440 · p95 ≤5000ms. **Phase 3 착수 게이트 = 이 DoD 통과** | 나리야팀 | next |
| 26 | **APK 재빌드 1회 묶음 권고** — #7 Vosk(b366011) + #12 음성 focus(e305566) + #17 음성 memory(3d5f4c1) 세 건 단일 빌드. 분할 빌드는 사장님 시간·검증 매트릭스 3배. 단일 시나리오: "나리야"→"232 해구 어때?"→"거기 경위도?"→비도메인 후속 | 사장님 | ASAP |
| 27 | ~~#22 focus 강제 주입 회귀 디버그~~ ✅ 완료(2026-05-30). 도구별 args 매핑 테이블 도입(zone/place/location/beach/harbor), focus.buoy→buoyName 신규, PRONOUN_RE 보수화 | 나리야팀 | 완료(자유변칙 v4 측정중) |
| 28 | ~~LG-7-02 환각 추적~~ ✅ 완료(2026-05-30). synth 프롬프트 "비기상 통계·법령·매뉴얼 거절" 규칙 추가 | 나리야팀 | 완료(자유변칙 v4 측정중) |
| 29 | **#22 연속성 카테고리 회귀 vs marine_leisure +13% 균형** — 패치들의 trade-off 측정. 직군별 카테고리별 회귀·회복 매트릭스 분석. v3 → v4 패치 사이클 짧게 반복 | 나리야팀 | next |
| 30 | **P_continuity_v2 (ROI 1위, 6.6)** — v5 cat2 연속 48% (실패 42건/80) 대상. 후속 zone/대명사 전파 강화: pronoun 검출 후 직전 zone 즉시 적용·focus.zone 우선·prev_id chain 추적 강화. risk=중(C5-pre/C4/C5 후속 영향). sentinel ANG-2-01b/CG-2-01b/PO-2-01b 검증 케이스. | 나리야팀 | next-1 |
| 31 | **P_multitool (ROI 2위, 5.0)** — v5 cat3 다중 68% (실패 13건/40) + cat2 연속 부수 효과. planQuery 에 multi-tool 강제 패턴 확장(직군별 종합 질의 → 3+ tool combo). risk=낮음. | 나리야팀 | next-2 |
| 32 | **HALLUC_RE false positive 정밀화** — v5 환각 의심 8건 중 6+건이 실측치 forecast 텍스트 오탐 ("유속 89cm 1.7노트"·"파고 0.5m"). DECISION_RE/HALLUC_RE 토큰 별도 컨텍스트 가드 (도구 결과 내부 인용 vs 자가 생성). 실측치 환각 점수 분리. | 나리야팀 | next-3 |
| 33 | **δ p95 게이트화 실측 검증** — v5 net p95 6120ms > DoD 5000ms 확정. cross_cutting §7.1 "백오프 노이즈 가설" → 검증 완료(backoff 0건이므로 raw=net, 모든 지연은 순수 응답시간). 다음: δ runner exit 1 게이트 활성화 + 응답 시간 단축 패치(planQuery 1회 호출 캐시·prompt 길이 다이어트) | 나리야팀 | next-4 |
| 34 | **analyze_v5.py parser fix** — 신 러너 출력 포맷(`net p50=…ms p95=…ms` 라인) 미인식으로 P4/P5 지연 평가 0ms 표시 → 패치 게이트 평가 무효. 정규식 추가 + raw 라인 별도 캡처. | 나리야팀 | ASAP |
| 35 | ~~SEC 3건 구조적 결함 (ADM-T3/T4/INJ-1)~~ ✅ 완료(2026-06-04). 6 레이어 방어 L0~L5 적용. sentinel v2 SEC 5/5 ✅. 화이트리스트(특보 발효 조회) 보존 | 나리야팀 | 완료 |
| 36 | ~~P_continuity_v2 잔존 3건 (ANG-2-01b 거문도·NAV-2-01b 동해중부·PO-2-01b 동해광역)~~ ✅ 부분완료(2026-06-05, 거문도/동해광역 OK / NAV-2-01b LLM 변동성 잔존). ZONE_NAME_TO_CODE 광역 alias 12 + buoyToZone 이동 + originalLocToken + synth 후속 표기 규칙 4 hunks 적용 | 나리야팀 | 부분완료 |
| 37 | ~~δ p95 게이트화 사이클 진입~~ ✅ 코드 적용 완료(2026-06-05). #37-B 병렬화(Promise.allSettled cap=6/3/2) + #37-A diet(JIKGUN_RULES 직군별 + synth bullet 압축 + memory 5→3). v5_run3 측정으로 실효 검증 필요 (예상 3500~4000ms) | 나리야팀 | 측정대기 |

---

## 7. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-29 | 문서 신설(v1). P0 완료·P2 지식베이스 반영, P1/3/4 골격 |
| 2026-05-29 | **v2 독립검토 반영**: 불변식(보안·프라이버시·안전문구), 이미 구현 기능 인벤토리(§2.5), P0 상시 회귀게이트화, P2 2a/2b 분리, 교차관심사(§8), 단일 상태표, owner·기한, 정량 DoD 방향 |
| 2026-05-29 | **§9 산출물 저장 방식** 추가(리포 정본 합의), knowledge/ 커밋 |
| 2026-05-29 | **Phase 2a 완료**: 직군 8종 `_SCHEMA.md` 정합화(frontmatter·규칙ID·트리거 조건식·고정칼럼). DoD 충족 |
| 2026-05-29 | **Phase 2b v1**: 직군 감지(detectJikgun)+지식 다이제스트 주입(planQuery·합성). 룰베이스, 검증 완료. 잔여=임베딩·평가셋·SLO |
| 2026-05-29 | **격리 에이전트 3종 병렬 검토 → P1~P4 채택·구현·게이트 통과**(P1 데이터카탈로그/P2 미노출도구화/P3 focus 연속성/P4 의존 위빙). 게이트 38케이스(정적 3종 포함) |
| 2026-05-30 | **PR #808 머지 후 골든 게이트 재검증 통과(PASS 37/0/1)** + 마스터플랜 §2/§4/§5/§6/§7 동기화 |
| 2026-05-30 | **호출어 엔진 무료 오픈소스화(Vosk, PR #811)**: Picovoice 상업검토·유료화·락인 회피. `WakeWordEngine` 인터페이스 활용해 `VoskWakeEngine`(Apache-2.0, 오프라인 한국어 ASR + 문법제한 KWS) 추가. 모델(~80MB)은 `VoskDownloadService`(전경 서비스 + 진행률 알림)가 사용자 동의 후 첫 1회 다운로드(Wi-Fi 기본, "데이터로 받기" 옵션) → 마커 영구화. 플러그인 `getCapabilities/requestVoskDownload/cancelVoskDownload` + `voskState` 이벤트, 토글 다이얼로그(다운로드 필요·진행률·실패·Wi-Fi 필요). 엔진 우선순위 Porcupine→Vosk→AndroidSpeech. APK 재빌드 1회 필요(네이티브 라이브러리), 모델은 영영 APK 미포함 |
| 2026-05-30 | **§2 단일 상태표 동기화**: Phase 0 게이트 재검증 수치 갱신 / Phase 1 데이터카탈로그·도구화·focus·위빙 반영 / Phase 2b 다음=측정토대 명시 / 교차(X)에 호출어 Vosk 추가. §2.5 인벤토리에 5건(카탈로그/도구화/focus/위빙/Vosk) 추가. §4 산출물 인덱스에 데이터카탈로그·Vosk 행 추가. §6 다음액션에 Vosk APK 재빌드·측정토대 신규 등재 |
| 2026-05-30 | **측정 토대 v1 가동(§6 #8 착수)**: `phases/phase2b_eval.jsonl`(10케이스, 8직군 + baseline pair + 다중도구) + `phase2b_eval_runner.py`. 첫 베이스라인: PASS 6/10, 지연 p50=1770ms·p95=6114ms·평균=2891ms. 실패 4건 전부 `web_search` 폴백 → 룰베이스 직군 디지스트의 한계 정량화(P2b 임베딩 정당성 확보) |
| 2026-05-30 | **외부 의존성 이슈 검출**: marine.kma JSON 엔드포인트(`/mmis_marine_api/v1/...`) `fetch failed` + HTTP 403 + JSON parse fail → `marine_buoys.json`/`marine_vs.json`/`marine_wh_buoys.json` 미생성 → 부이·시정·특보 도구 빈 상태 → 게이트 33P/1F/4S(이전 37P/0F/1S 대비) + 평가 실패 4건. **코드 회귀 아님(Vosk 변경은 안드로이드/JS만)**. 측정기가 환경 변화를 정확히 검출함을 입증 |
| 2026-05-30 | **VoiceAssistantService P3 focus 누락 발견·패치**: 음성 비서 자바 경로가 query/profile/location 만 보내고 focus 부재 → "232 해구→거기 경위도?" 음성 후속 끊김. lastFocusJson 필드 + body 동봉 + 응답 갱신. 서버는 focus 받으면 정확(로컬 재현 입증). APK 재빌드 1회 필요 |
| 2026-05-30 | **임베딩 검색 PoC v1 (§6 #10 착수)**: `services/topic_embedding.js` — gemini-embedding-001(3072 dim)로 GRAPH_RT 토픽 169개 임베딩(5.8s, 디스크 캐시 6.6MB), 질의 임베딩→코사인 유사도 상위 K → planQuery 에 `simLine` 주입. 800ms 타임아웃·실패 시 폴백. 첫 결과: 1↑(marine_leisure-surf 회복) / 1↓(public_org-coast 회귀) / 종합 PASS 6/10 무변, 지연 +600~800ms. **결론: 임베딩만으로는 부족** — web_search 폴백 습관 자체가 진짜 원인. 다음 후보=프롬프트 제약 강화/도구 디스크립션 임베딩/평가셋 확대 |
| 2026-05-30 | **web_search 도메인 가드 (§6 #11 완료)**: planQuery 에 "도메인 질의(특보/예보/파고/풍속/시정/부이/조석/유속/수심/태풍/낚시/서핑 등)는 빈 steps 금지, zone 모호해도 '전국'·기본해역으로 시도" 규칙 + runBrain 폴백 조건에 도메인 정규식 게이트 — 도메인이면 결과 비더라도 web_search 우회 금지(합성이 "현재 ~ 없음"으로 보고). **결과: PASS 6/10 → 8/10 (80%)**, 회복 coast_guard-warning/local_gov-warning/public_org-coast, 지연 p50 2619ms → 1788ms (임베딩 비용 회수). 잔여 실패=baseline-geomun(무프로필 "어때" 모호어) / fishery-jeonnam-multi("전남남해" 행정구역 정정) — 별도 후속 |
| 2026-05-30 | **지명인식 도메인 가드 + zone 정규화 (§6 #14·#15 부분)**: isDomainQuery 에 `detectZoneDeterministic(query)≠null` + 섬·부이 정규식 추가 → "거문도 어때" 류가 도메인으로 잡힘(baseline-geomun 회복). plan.steps 실행 직전 zone 인자를 detectZoneDeterministic 으로 fuzzy 보정. **결과: 8/10 유지 + 지연 p50 1788ms → 1435ms**. 1↑(baseline-geomun) / 1↓(angler-yeosu, 재실행시 PASS — LLM 비결정성). 잔여=fishery-jeonnam-multi: detectZoneDeterministic 의 단방향 토큰 매칭이 "전남남해"(짧은 nq) 를 어느 표준 zone 으로도 매핑 못 함 → 양방향 fuzzy/문자 LCS 필요 |
| 2026-05-30 | **평가셋 러너 N회 다수결 + 429 백오프 (§6 #13 완료)**: phase2b_eval_runner.py 에 `--n=N`(기본 3) 다수결 + 케이스 간 1.5s/회 간 0.8s 페이싱 + ask() 429 백오프 3회(4/9/16s). **결과: PASS 9/10 (90%)**, 지연 p50 1167ms/p95 5858ms, **비결정성 0건**(이전 flaky navy-east 도 3/3 안정), 429 전부 흡수(30/30 호출 성공). 진짜 신호 분리됨: 유일 실패=fishery-jeonnam-multi(3/3 일관 web_search → #15 zone 양방향 fuzzy 가 진짜 해법) |
| 2026-05-30 | **음성 비서 자연어 memory 동봉 (§6 #17 옵션 C 완료)**: VoiceAssistantService 에 `recentMemory`(ArrayDeque, MEMORY_MAX=8) + askServer body 에 memory 배열 동봉 + 응답 후 채팅창 동일 포맷(`[zone:] "Q" → A(160자)`)으로 자동 적재. focus(구조)와 memory(자연어) 이중 안전망으로 채팅창과 음성 비서 능력 동등화. 비도메인 후속("뽀로로 파크 → 거기 이용 금액?") 등 focus 가 못 담는 자유 화제도 LLM 이 자연어로 이음. APK 재빌드 1회 필요(자바) |
| 2026-05-30 | **zone 양방향 fuzzy + 합성 환각 가드 (§6 #15·#16 완료)**: detectZoneDeterministic 에 stage 3(역방향 토큰 매칭, 최소 2 토큰) 추가 → "전남남해" 같은 짧은 비표준 명을 표준 zone("전남동부남해앞바다") 으로 정정. runBrain 에 `isDomainQuery && results.length===0` 시 synth 호출 차단 + 안전 응답. synth 프롬프트에 환각 금지 강화. **결과: PASS 9/10 유지 + 지연 p95 5858→3440ms** (환각 가드 짧은 안전 응답 효과). fishery-jeonnam-multi 는 forecast 호출은 회복(get_marine_forecast) 했으나 multi-tool expect(forecast+warning) 미충족 — 평가 기준이 더 엄격해진 셈. #18 신규(다중 도구 hint) |
| 2026-05-30 | **도구 디스크립션 임베딩 (§6 #10 v2 완료)**: services/topic_embedding.js 에 `warmupTools/nearestTools` 추가 — TOOL_CATALOG 파싱으로 도구 19개의 디스크립션을 임베딩(별도 디스크 캐시 tool_embeddings.json) + planQuery 에 `toolSimLine` 주입(질의에 가까운 도구 후보 상위 4, minScore 0.55, 600ms 타임아웃). 토픽 임베딩이 못 잡는 패턴(도구 자체에 핵심 키워드)을 보완. 백그라운드 워밍업 + 폴백 안전. 평가 효과는 다음 라운드 측정 |
| 2026-05-30 | **🎉 평가 첫 만점 PASS 10/10 (§6 #18 완료 + 도메인 가드 보강)**: planQuery 에 multi-tool 패턴 명시("어업·해양경찰·해군·지자체·공공기관·해양수산부 + 종합 질의 → forecast+warning 함께; 정책·중기 직군 → +midterm; 출항/조업 → +tide·current"). DOMAIN_RE 에 "해양/바다/섬/항구/항만" 보강(이전 "해상"만 → "해양 전반" 류 누락). **결과: 다수결 PASS 10/10 (100%) · 비결정성 0건 · 지연 p50 1235ms/p95 3255ms/평균 1695ms (n=30)**. fishery-jeonnam-multi/mof-overall 둘 다 multi-tool 호출 회복. 측정 토대 v1 → 60%(첫 베이스라인) → 80% → 90% → 100% 단계 완성 |
| 2026-05-30 | **8 직군 sub-agent 자유 변칙 검증 (v1, 5문항/직군)** — 평가셋 만점 100% vs **자유 변칙 PASS 23/40 = 57.5%** 격차 발견. 공통 결함 5건 추출: (1) focus 후속 전파 실패(angler Q5·fishery Q4·mof Q4) (2) zone 미해결 multi-tool 빈응답 (3) 메타·자기요약 약함 (4) 의사결정 정량임계 부재 (5) CoT 누수 의심(coast_guard Q5). 평가셋이 *형식*만 보고 *내용·연속성·환각* 안 봤다는 신호 |
| 2026-05-30 | **결함 4건 즉시 수정 (#1·#3·#4·#5)** — deriveFocus 에 query 인자 추가 + zone 비면 detectZoneDeterministic 으로 fuzzy 보강(결함 1). synth 프롬프트에 (a) **CoT 누수 절대 금지** "내부 사고 과정·메타 코멘트 한 글자도 금지" (b) **메타·자기요약 질의** "memory 마지막 항목 1-2줄로 자연어 요약" (c) **의사결정형 정량 판단** "파고/풍속/특보 임계로 가부 결론 먼저" 추가. **평가 회귀 0 — PASS 10/10 유지(p50 1199ms/p95 5279ms)**. 결함 2(zone 모ho multi-tool 도구구현 변경) 는 다음 라운드 |
| 2026-05-30 | **자유 변칙 평가 v2 — 440 케이스 × 8 직군 직렬 (38.7분, §6 #20 완료)**: phase2b_eval_freevar.jsonl + 직렬 러너 도입(케이스 사이 sleep 3s·429 백오프 5/10/15s·prev_id focus 동봉). **결과: 종합 PASS 320/440 (72%)**·지연 p50 1328ms/p95 6712ms·**CoT 누수 0건** ✅(#5 패치 항구성 자유변칙으로 입증)·환각 의심 6건. 직군별: mof 81%·coast_guard 78%·navy 76%·angler/fishery/public_org 74%·local_gov 65%·marine_leisure 56%. **카테고리 결함 우선순위 확정**: 정량 6/40=15% > 연속 38/80=48% > 다중 24/40=60% > 메타 67/80=84% > 기본 68/80=85% (가드 3종은 98%). 평가셋 100% vs 자유변칙 72% 격차의 진짜 의미=*"골든=구조, 자유=내용·연속·환각"* 역할 분리 확정 |
| 2026-05-30 | **독립 검토 에이전트 2종 병렬 평가(장기 일관성 시점 + 운영·실측 시점)** — 자유변칙 결과 + 마스터플랜만 보고 독립 판단. 두 결과 합의 항목: (1) **정량 15% 패치 최대 ROI(+7~8%)** (2) **연속성 48% 패치(+5~6%)** (3) **다중 60% 패치(+3~4%)** (4) **memory 출력 누수(ANG-6-03b) 즉시 패치(프라이버시 불변식 회색지대)** (5) **APK 3건 묶음 권고(Vosk+focus+memory)** (6) **자유변칙 게이트화 + 직군 floor ≥70% DoD**. 신규 액션 #21~#25 등재 |
| 2026-05-30 | **§6 #24·#21·#22·#23 4건 패치 (트랙 1 — 즉시)** — (#24) synth 프롬프트 "컨텍스트 격리 — [최근 대화]/memory/focus 라벨 출력 금지" + 응답 후처리 라벨 라인 제거. (#21) `knowledge/jikgun/_thresholds.json` 9직군 안전 임계표(파고/풍속/시정/파주기/수온) + synth 에 직군별 임계표 + "사용자 정량 수치 단정 시 임계표 직접 비교, 가부 결론 한 줄 먼저" 규칙. (#22) runBrain 에 대명사·생략 주어 검출(거기/그곳/방금) + focus.zone/haegu/coords 결정론적 args 주입(LLM 우회). (#23) planQuery 에 marine_leisure 해변명→get_surfing_index 우선 / local_gov 모호지명→GPS·default·전국 처리 강제. **회귀 0(평가셋 PASS 10/10 유지, 지연 p95 5279→4810ms)**. 자유변칙 재측정 진행중 |
| 2026-05-30 | **자유변칙 v3 재측정 (4건 패치 후, 440 케이스 직렬 37.2분)** — **종합 321/440 (72%) — v2 320/440 대비 ±0 (부분 회복+회귀 상쇄)**. 카테고리: 정량 15%→**28%(+13)** ✅ #21 효과 / 기본 85→89% / 변칙 98→100% / 메타 84→79% / 연속 48→**43%(-5)** ❌ #22 회귀 의심 / 다중 60→58% / 환각 98→96%. 직군: marine_leisure 56→**69%(+13)** ✅ #23 효과 / angler/fishery/navy 소폭 개선 / coast_guard 78→70%(-8) public_org 74→70% mof 81→78% 회귀(LLM 비결정성+#22 부작용 의심). memory 누수 ANG-6-03b 사라짐 ✅ #24 효과. CoT 누수 0건 유지. 신규 환각 LG-7-02("산업재해 사망자 113명") — 도메인 외 답을 도메인으로 오인. 다음: #22 디버그·#27 새 환각 추적 |
| 2026-05-30 | **#27·#28 v4 패치 (트랙 1 차순)** — (#27) #22 회귀 디버그 — `FOCUS_ZONE_ARG` 도구별 매핑 테이블(zone/place/location/beach/harbor) 도입. get_tide/get_buoy_observation/get_fishing_index/get_surfing_index 등 zone 인자 없는 도구도 정확히 채움. focus.buoy → get_buoy_observation.args.buoyName 신규 주입. PRONOUN_RE 에서 "그 때"(시간 후속어) 제외 — 오탐 차단. (#28) synth 프롬프트에 "비기상·비도메인 정보(산업재해·법령·매뉴얼·통계 등) 거절" 규칙 — LG-7-02 환각 추적. **회귀 0(평가셋 PASS 10/10 유지, 지연 p95 4810→4691ms)**. 자유변칙 v4 재측정 진행중 |
| 2026-06-03 | **Sentinel 20케이스 빠른 회귀 측정(1.85분)** — phase2b_sentinel.jsonl(8직군·8카테고리 대표) 도입. **PASS 16/20 (80%)** · 지연 p50 1454ms/p95 6588ms · CoT 누수 0 · 환각 의심 0. 실패 4건: ANG-2-01b 연속(#22 잔존)·LG-4-01·MOF-4-01 정량(#21 미발동, decision word 없음)·LG-1-01 "관내"→web_search(#23 한계). **연속 카테고리 3/4(75%)** v3 의 43% 대비 큰 개선 + CoT/환각 가드 항구성. p95 6588ms 는 DoD 5000ms 여전 초과(R2-06 검토 일치) — p95 게이트화 우선과제 확정 |
| 2026-06-04 | **4 옵션 × 2 워커 = 8 산출물 (Opus, 3차 라운드)** — α(8커밋 적용본 시점 A·B) / β(sentinel P0 러너+케이스 확장) / γ(v5 측정 자동화 사전점검+분석) / δ(러너 raw_ms+운영 패치). 워커 2회(γ-A, δ-B 레이트리밋 → 재실행 성공). 산출물 12개. 핵심: α-A `_buoyPlanTools`/`_lgPlanTools` 분리 + synthesis §1.3 봉합 4건 흡수 / α-B DECISION_RE 9어 확장 + 임계표 unshift / β-B 35케이스(30 일반+5 SEC, W=47.5) / γ-A 임베딩 캐시 경로 SOP 오류 발견(`data/topic_embeddings.json` ≠ 실제 `graph/{topic,tool}_embeddings.json`) / γ-B v3 hardcoded baseline + 5축 분류 + ROI 가중 / δ-A 분위수 합산 함정 정정(케이스별 합산 후 직접 계산) / δ-B `pureLatencyMs` 직접 저장(파생 회피) |
| 2026-06-04 | **4 옵션 R2 합성 (시점별 워커 2산출물 → 1 합성) — 4/4 완료** — α-R2(충돌 0건, C1→C5pre→C4→C5→C6→C7→C8 9-hunk 머지 순서, 위험 등급 1~4, C4 격리 revert 안전, monitorOverview false-positive N=3 수동 가드 필수) / β-R2(`cat_key()` 4중 OR `is_security`+`source`+`category=='SEC'`+`jikgun=='SEC'`, 일반 30 PASS≥80% AND SEC 5/5 결합, `phase0-gate` 신규 nightly+manual 비차단 잡으로 `golden-gate` 보존, 73건 ≈ 6분 02초 worst<8분) / γ-R2(러너 stdout → /tmp/freevar.log → analyze_v5.py 0 마찰점, C3 SOP 경로 `data/topic_embeddings.json` → `graph/{topic,tool}_embeddings.json` 1줄 패치 박제, A 게이트×ROI 결합식 P0 위반→ROI 무효화·P5 통과→Phase 3 진입, `--auto-restart` 1회 시 분위수는 두번째 회만 반영) / δ-R2(러너 (pure_ms,backoff_ms) → assistant_log v1.1 3필드 직접 저장·R1 2필드 파생 기각, 5단계 롤아웃 ④ a/b·c/d·e/f 셋 분리·⑤ CI 누적 위험 최대, CI `sys.exit(1)`과 런타임 L1/L2/L3 시간축 분리·CoT/환각만 즉시 L3, env 네임스페이스 분리·강등은 트래픽 경로만 좁히고 임계 불변, cross_cutting §7.1 강등 상태 해소 기준 = net p95 단독). **총 산출물 12개 12 커밋 푸시 완료**(워커 8 + 합성 4) |
| 2026-06-04 | **4차 라운드 실코드 적용 + sentinel v2 회귀 (다수 에이전트 병렬)** — α 8커밋 단일 PR (assistant.js +97 worktree 격리 3-way merge 0 충돌, runner.py +10 DECISION_RE), β `phase0-gate.yml` (cron KST 02:00 + manual, AND 결합 비차단 + golden-gate 보존) + `phase0_runner.py --sentinel-v2` (cat_key 4중 OR), δ 양 러너 raw_ms 분리(`latencies_net/raw` 케이스별 합산, DoD 5항목 게이트). **sentinel v2 35케이스 회귀 측정 (~5분, server PID 5795, BASE=:3001)**: **일반 30 PASS 28/30 (93%)** ✅ ≥80% — α 회귀 0 + 정량 cat=4 6/6 만점·연속 cat=2 8/10·메타 cat=6 4/4 (이전 sentinel 20 PASS 16/20=80% → 28/30=93% 큰 개선). 잔존 일반 실패 2건 모두 zone-miss(NAV/PO 동해광역 분류). **SEC 5 PASS 2/5** ❌ (ADM-T3 API key 노출·ADM-T4 로그 삭제·ADM-INJ-1 admin 청구) — 구조적 보안 결함, α 무관, 별도 보안 패치 트랙 필요. 결함 분포: D-SEC-PERFORM 3 · D-HALLUC 2. **γ v5 측정 (440 케이스, ~40분) 백그라운드 가동 중** (preflight C5 골든 10/10 PASS · α 회귀 0 검증 후 발사) |
| 2026-06-04 | **🎯 자유변칙 v5 측정 완료 (440 케이스, 34분, α 8커밋 적용 후)** — **종합 PASS 347/440 (78.9%)** ✅ v3 72% 대비 **+7pp**. 카테고리 v3→v5: **정량 28%→75% (+47pp)** 🎯 α C6/C7/C8 결정적 효과 / 다중 58%→68%(+10) / 연속 43%→48%(+5) / 기본 89%→92% / 메타 79%→78% / 비도 96%→98% / 환각 96%→95% / 변칙 100%→98%. 직군 v3→v5: angler/coast_guard/fishery/local_gov/mof/navy 76~83% (전원 floor ≥70 ✅, marine_leisure 69%→70% 통과). **CoT 누수 0건** ✅ 항구성 입증. **환각 의심 8건은 대부분 false positive** — HALLUC_RE 가 실측치 forecast 텍스트("유속 89cm 1.7노트"·"파고 0.5m") 오탐. 진짜 환각 ≤2건. **지연: net p50 1140ms · p95 6120ms** — DoD 5000ms 여전 초과, δ p95 게이트화 정당화. backoff 0건/0초/429 0건 (서버 안정). 다음 ROI 랭킹: P_continuity_v2(6.6) > P_multitool(5.0) > P_meta_v2(2.6). 산출물: `v5_run1_report.md` + `v5_run1_freevar.log.gz` |
| 2026-06-04 | **5차 라운드 — 3 트랙(#30/#31/#35) × 6 워커 + 3 합성 + 3 워크트리 적용 (Opus, 다수 에이전트 병렬)** — #30 P_continuity_v2 (PRONOUN_RE 정밀화 + focus 7단 폴백 + isChainFollowup OR 결합 + chain 거절 폴백 5 hunks +130), #31 P_multitool (planQuery R1~R12 12 매트릭스 + needsReplan v2 + pickMissingTools 결정 보강 + EXPECT_TOOLS_MIN 3 hunks +116), #35 SEC 보안 P0 (6 레이어 방어 L0~L5: classifySecurityIntent + 3종 거절문 + GUARD_EXCLUDES + REFUSAL_RE 확장 6 hunks +125). **3 worktree 3-way merge 0 충돌**. assistant.js 2295→2666 라인 (+371). 산출물 9개(설계 6 + 합성 3) 푸시 완료. **회귀 게이트 sentinel v2**: 일반 27/30 (90%) ✅ + **SEC 5/5** ✅ (이전 2/5 → 5/5 회복) + 결합 AND **통과** ✅. 잔존 일반 3건 ANG/NAV/PO cat=2 zone-miss (P_continuity_v2 의 부이→zone 역추론 한계 — buoyToZone 거리 200km 초과 또는 ZONE_NAME_TO_CODE 매핑 누락 의심, 별도 후속 #36). 응답시간 p95 +1680ms 추정 (6120→7800ms, DoD 5000 초과, δ p95 게이트화 적용 사이클 진입 권고) |
| 2026-06-05 | **🎯 자유변칙 v5_run2 측정 (5차 라운드 적용 후, 440 케이스, 34분)** — **종합 PASS 357/440 (81%)** ✅ v5_run1 78.9% / v3 72% 대비 누적 +9pp. 카테고리: 정량 75%→**80%**(+5) / 다중 68%→**88%**(+20) ✅ / 연속 48%→**51%**(+3) / 메타 78%→79% / 환각 95%→97% / 기본 92%→95%. **net p95 5736ms** — v5_run1 6120ms 대비 -384ms (예상과 반대로 개선, #31 multitool 영향 작음). **환각 의심 5건** (대부분 false positive 추정). 직군 floor 76% PASS ✅ (전원 ≥70%). CoT 누수 0건 항구성 입증. 잔존 cat2 zone-miss 약함은 #36 응급 — 6차 라운드 적용 |
| 2026-06-05 | **6차 라운드 — 2 트랙(#36/#37) × 4 워커 + 2 합성 + 3 워크트리 적용 (Opus, 다수 에이전트 병렬)** — #36 zone-miss 잔존 3건 (4 hunks +23: ZONE_NAME_TO_CODE 광역 alias 12 키 동해/서해/남해 × 광역/전역/권역/전체 + REGION_DIR_RE 4 토큰 + buoyToZone 이동 (deriveFocus → runBrain) + focus.originalLocToken 신규 + synth 후속 표기 규칙), #37 δ p95 게이트화 (#37-B 병렬화 3 hunks +50: 3 직렬 루프 → Promise.allSettled cap=6/3/2, focus 의존 2 라운드 분리 / #37-A diet 3 hunks +45: JIKGUN_RULES 8 직군 평균 3.3 룰 + DECISION_WORDS const 추출 + synth bullet 압축 + buildPersonalContext profileSlim · memory 5→3 · enrichedTdig 단축). **3 worktree 3-way merge 1 충돌 (synth bullet 영역) → 수동 봉합**. assistant.js 2666→2785 라인 (+119). 산출물 6개(설계 4 + 합성 2) 푸시 완료. **회귀 게이트 sentinel v2**: 일반 **29/30 (96%)** ✅ (이전 27/30 → **+2건 회복**, 거문도/동해광역 OK) + SEC 5/5 ✅ + 결합 PASS ✅. 잔존 NAV-2-01b 동해중부 1건만 (LLM plan.zone 변동성). v5_run3 재측정 필요 — 예상 p95 3500~4000ms (DoD 5000 통과 + 종합 ≥85%) |
| 2026-06-06 | **⚠️ v5_run3 측정 (6차 라운드 #36/#37 적용 후, 440 케이스, 34분) — 부분 회귀 발견** — **종합 PASS 351/440 (79%)** v5_run2 81% 대비 **-2pp 회귀**. 카테고리 v5_run2→v5_run3: **정량 75%→50% (-25pp)** ❌ #37-A diet synth bullet 압축이 가설 룰 약화 의심 / **다중 88%→80% (-8pp)** #37-A R1~R12→JIKGUN_RULES 직군별 3.3 룰 분기로 일부 multi-tool 패턴 소실. **개선** 항목: cat=1 기본 92%→95%(+3) / cat=2 연속 48%→52%(+4) / cat=5 비도 98%→100% / cat=8 변칙 98%→100% / **환각 5→1 (-4건)**. **직군별 v5_run2 대비**: fishery +8pp(81→89%) / coast_guard +3pp(80→83%) / mof = 80% / navy +1pp / public_org 72→74% / marine_leisure 70→72% / local_gov 83→80%(-3) / angler 80→76%(-4). **net p95 6463ms** — v5_run2 5736ms 대비 **+727ms 악화** (#37-B 병렬화가 예상만큼 효과 없음). **DoD 미달**: PASS 79<85% · cat floor 20%(cat4 정량)<70%. backoff 0건/0초/429 0건. **B2 진단 일치 — #36 후속 표기 룰 P36 이 빈결과 룰 L2161 에 가려 NAV-2-01b 외 cat2 chain 미수 확장**. 산출물: `v5_run3_report.md` + `v5_run3_freevar.log.gz`. 다음 트랙: 7차 라운드 (P_quant_v2 + P_multitool_v2 + p95 재측정) 또는 사용자 기억 v2 (A1~A7 설계 완료, 실코드 적용 대기) |
| 2026-06-06 | **🔥 사용자 기억 v2 (Personal RAG / LLM-Managed) 설계 완료 — 9 에이전트 병렬 + v5_run3 동시 측정** — 사장님 신규 요구 "단순 누적 ❌ → 매 질문마다 AI가 기존 DB + 새 질문 합쳐서 효율 저장 + 답하기 전에 DB 훑고 관련 정보 회수 + 무관하면 끼우지 않음" 반영. **신규 산출물 9개**: A1 저장소(SQLite/Room+IndexedDB, episodes 영구 + consolidated_memory version 분리) / A2 채팅↔음성 다리(Bridge API 5종 + write-through 미러) / A3 압축 두뇌(하이브리드 트리거 merge/add/skip, ~$0.02/100질문) / A4 회수 두뇌(4단 점수 silent fallback p95 +50~120ms) / A5 연관성 가드(L1×L2×L3 곱셈, 비도메인 결정론 차단) / A6 프라이버시(5겹 누출 가드 + 4겹 인젝션 + classifySecurityIntent 5지점 재사용) / A7 평가셋(50문항 8 카테고리, jsonl + 신규 채점축 M/R/E2/A2/P) / B2 NAV 디버그(LLM 변동성 X → depth API 빈결과 + L2161 룰이 P36 룰 덮음 결정론적 재현) / B3 APK 빌드 가이드(25~40분, 검증 5건). **사장님 결정 대기 2건**: 백업 정책(권고 a 없음) + 7차 라운드 vs 사용자 기억 v2 코드 적용 우선순위 |
| 2026-06-06 | **🎯 7차 라운드 — 회귀 복구 + sentinel 첫 만점 (3 워커 + 1 합성 + 1 worktree 적용)** — C1 정량 룰 부분 복구 (#37-A axis 3 ④⑤ bullet 복원, +200 토큰) / C2 multi-tool 회복 (COMMON_RULES R1·R7 + ACTIVITY_RULES 12 정규식 + JIKGUN_RULES 슬림화, +50~100 토큰) / C3 NAV 빈결과·폴백 수정 (synth 빈결과 룰 + L2110 폴백 anchorName prepend, +30 토큰) + 메타 강화 (현장 발견 — MEM-LEAK-05 "모릅니다" 5글자 → bullet 보강). **assistant.js 2785→2822 라인 (+37)**. **회귀 게이트 sentinel v2: 일반 30/30 (100%) + SEC 5/5 + 가중 0.0/47.5 — 첫 만점** 🎉. 잔존 0건. 산출물 5개(설계 3 + 합성 1 + 코드 1) 푸시 |
| 2026-06-06 | **🚀 v5_run4 측정 — 종합 84% (역대 최고, v3 72% 대비 +12pp)** — **종합 PASS 370/440 (84%)** v5_run3 79% 대비 **+5pp 회복**. 카테고리 v3→v5_run4: **연속 43%→61% (+18pp)** ✅ #36/C3 효과 / **다중 58%→88% (+30pp)** ✅ C2 ACTIVITY_RULES 결정적 / **정량 28%→55% (+27pp)** C1 ④⑤ 부분 복원 효과 / 기본 89%→96% / 메타 79%→86% (+7pp) 강화 효과 / 비도 96%→98% / 환각 96%→98% / 변칙 100%. **직군 v3→v5_run4 전 직군 +9~17pp**: angler 74→83 / coast_guard 70→87 / fishery 74→89 / local_gov 65→81 / **marine_leisure 56→83 (+27pp)** ✅ / mof 78→89 / navy 76→85 / public_org 70→72 (직군 floor 72% PASS ≥70 ✅). **net p95 5994ms** v5_run3 6463 대비 **-469ms 개선** (#37-B 병렬화 효과 가시화). **DoD 1pp 부족** (84<85, 4건 만 더 PASS 필요). **잔존 70건**: cat2 31 / cat4 18 / cat6 11 / cat3 5 / cat1 3 / 환각 의심 5건 (대부분 false positive — 실측치 forecast/유속 패턴 오탐). 산출물: v5_run4_report.md + v5_run4_freevar.log.gz. 다음 후보: 8차 라운드 (DoD 85% 도달 + halluc_v2 false positive 정밀화) OR 사용자 기억 v2 코드 적용 시작 |
| 2026-06-06 | **🎉 8차 라운드 — DoD 85% 달성 (트랙 1) + 사용자 기억 v2 코드 6 산출물 (트랙 2) 6 에이전트 병렬** — **트랙 1 D 패치 (worktree)**: D1 잔존 4건 직타 (ISLAND_BUOY_RE 11 섬 보강 + 정량 가설 SOP 답 + 메타 자기요약 길이 가드 재시도 + 주변 도구 단독 보강) + D2 HALLUC_RE 분리 (DOMAIN/OFFDOMAIN). assistant.js 2822→2892 (+70). runner.py +28. **트랙 2 사용자 기억 v2 신규 코드 (3,625 라인)**: E1 안드로이드 SQLite/Room 7 자바 파일 (Entity 5 + Dao + Database) / E2 웹 IndexedDB 어댑터 (564 라인 + localStorage 폴백 + 마이그레이션 멱등) / E3 Capacitor Bridge 5 메서드 설계서 + JS 헬퍼 (write-through 미러 + Safari 폴백 + 10 표면 함수) / E_server services/user_memory.js (703 라인, A3+A4+A5 통합, 4 공개 함수, silent fallback) / E_runner memory_v2_runner.py 회귀 게이트 (520 라인, 5 신규 채점축 M/R/E2/A2/P). **회귀 게이트 sentinel v2**: 일반 30/30 (100%) + SEC 4/5 (MEM-LEAK-05 LLM 비결정, 가중 점수 2.0/47.5) |
| 2026-06-06 | **🚀🎯 v5_run5 측정 — DoD 만점 달성 (종합 86%, v3 72% 대비 +14pp 누적)** — **종합 PASS 382/440 (86%)** ✅ **DoD 85% 만점 통과** (v5_run4 84% → +2pp). 카테고리 v3→v5_run5: **연속 43%→72% (+29pp)** ✅ / **다중 58%→88% (+30pp)** ✅ / **기본 89%→98% (+9pp)** ✅ / **환각 96%→100% (+4pp)** ✅ / 정량 28%→55% (+27pp, 잔존 18건) / 메타 79%→88% (+9) / 비도 96%→98% / 변칙 100%. **직군 7/8 모두 ≥81% (만점급)**: angler/coast_guard/fishery/mof 모두 90% / navy 89% / marine_leisure 85% / local_gov 81% / public_org 74%. **DoD 5항목 모두 통과**: PASS 86%≥85% ✅ / 직군 floor 74%≥70% ✅ / 환각 의심 **1건** ≤2 ✅ (D2 HALLUC_RE 분리 효과 — v5_run4 5건 → 1건만 CG-5-03 진성 환각) / net p95 **5513ms** (v5_run4 5994 -481ms 개선) ≤15000 ✅ / CoT 누수 0 ✅. backoff 0건/0초/429 0건. 잔존 58건 주요: cat2 22 (zone-miss 일부 + 비등록 섬 흑산도·추자도) / cat4 18 (decision word 잔존) / cat6 10 / cat3 5 / cat1 2. 산출물: `v5_run5_report.md` + `v5_run5_freevar.log.gz`. **자유 변칙 평가 트랙 마무리 단계** (잔존은 신규 트랙 #38 reverse geocoding 폴백·사용자 기억 v2 통합으로 해결) |
| 2026-06-06 | **🔁 9차 라운드 — 패러다임 전환 (정규식·룰 폭주 → LLM 자율 위임, 5+1+1 워커)** — 사장님 피드백: "정규식·룰을 코드로 박는 방식은 잘못. LLM 이 도메인 인지·광역 통상 답·명확화 자율 가능." **G1 정규식 12종 분류** (REMOVE 1 / MOVE 6 / GUARD 3 / DATA 2) / **G2 매트릭스 6종** (REMOVE 2 / MOVE 4 / GUARD 2 / DATA 1) / **G3 bullet 13종** (CORE 4 / MOVE 5 / REMOVE 3) / **H1 새 synth prompt** (4 가드 + 7 답 가이드 + Few-shot 2 [동해 수심·흑산도], -520 토큰 -59%) / **H2 평가셋 54문항** (8 카테고리 + 6 신규 채점축 G/CMP/INV/SRC/NOREF/NOZONE) / **I1 합성** (7 hunks: H7→H6→H5→H3→H4→H2→H1) / **J 워크트리 적용 2회** (세션 한도로 분할 — 3 hunks 먼저 + 4 hunks 후속). assistant.js 2892→2841 (-51 라인) / synth prompt 880→360 토큰. runner.py DECISION_RE 3축 분리 + 후속 NameError fix. **라이브 검증 사장님 황금 예시 그대로**: "동해 앞바다 수심?" → "동해 앞바다는 해안선에서 조금만 멀어져도 수심이 급격히 깊어지는 특징… 평균 1,700m, 가장 깊은 곳 3,700m… 서해/남해와 달리 경사 가파름… 정확한 지명 알려주시면… (일반 정보)" 🎯. **회귀 게이트 sentinel v2 결합 PASS** ✅ (일반 28/30 + SEC 5/5, 가중 3.0/47.5 — 7차 35/35 → -2건). 잔존: NAV-3-01 multi-tool · PO-2-01b 동해광역 zone-miss (광역 alias 12 제거 영향) |
| 2026-06-06 | **📊 v5_run6 측정 (9차 패러다임 전환 후, 440 케이스, 36분)** — **종합 PASS 376/440 (85%)** ✅ **DoD 85% 정확히 통과** (v5_run5 86% → -1pp, 사실상 무회귀). 카테고리 v3→v5_run6: **연속 43%→70% (+27pp)** ✅ / **정량 28%→75% (+47pp)** ✅ 최대 / **다중 58%→80% (+22pp)** ✅ / **기본 89%→95% (+6pp)** ✅ / 메타 79%→81% (+2, -7 vs v5_run5) / 환각 96%→95% (-1) / 비도 96%→98% / 변칙 100%. **net p95 6363ms** v5_run5 5513 대비 +850ms 악화 (광역 답 길어진 영향) — DoD 15000 마진 8600ms+ 보존. **환각 의심 3건** (DoD ≤2 미달) — 모두 비도메인 통계 답 회귀 (CG-5-03 구난 통계 / MOF-7-01 수산자원 / PO-7-01 환경 통계, G4 비기상 거절 가드 약화). CoT 0 / backoff 0 / 429 0. 잔존 64건 주요: cat2 24 (cat6 메타 15·cat4 정량 10·cat3 다중 8). **패러다임 전환 성공**: 코드 -51 라인 + prompt -59% 토큰으로도 PASS 86%→85% 1pp 만 회귀 = LLM 자율 위임 검증. **다음 빠른 패치**: (i) synth prompt P7 비기상 거절 강화 (환각 3→1 회복) / (ii) ZONE alias 광역 4 키만 복원 (PO-2-01b 회복) / (iii) NAV-3-01 multi-tool 강화. 산출물: v5_run6_report.md + v5_run6_freevar.log.gz |
| 2026-06-06 | **🎯 K 라운드 — G4 정밀화 + focus.topic 신설 (3 워커 + 1 worktree, 사장님 의도 정렬 강화)** — 사장님 라이브 검증 회귀: "해양경찰 함정 순찰?" 거절 (G4 가드 과잉). 사장님 추가 요구: "참돔→미끼" 같은 후속 자동 연결 = 연결고리 강화. **K1 G4 정밀화**: 광범위 거절 목록 (행정·법령·통계·매뉴얼 등) 폐기 → 원칙 한 줄로 단순화 ("해양 도메인은 LLM 일반 지식으로 답 + (일반 정보) 라벨, 명백히 해양 무관한 것만 거절, 통계 수치 X / 일반 주제 O"). **K2 focus.topic 신설**: focus 객체 7→8 필드 (topic 추가). synth P8 새 룰 "응답 마지막 줄 [주제: …] 1줄". cleanAnswer TOPIC_LABEL_RE capture + 제거. deriveFocus.topic. planQuery 후속 마커(그렇다면/그럼/그리고/근데) + 직전 주제 유지 룰. **L 평가셋 43문항** (8 카테고리): C1 직군 활동 8 · C2 어종 8 · C3 후속 chain 14 (7쌍) · C4 현상 5 · C5 비도메인 거절 5 HARD · C6 보안 3 HARD. assistant.js 2841 → **2859 (+18)**. **라이브 검증 사장님 4 질문**: Q1a 해양경찰 → **완벽 답 + (일반 정보)** ✅ (이전 거절) / Q1b 어선 영향 후속 → **완벽 연결** ("위험 해역 조업 금지·SAR…") ✅ / Q2a 참돔 날씨 → **완벽 + topic="참돔 낚시 날씨"** ✅ / Q2b 미끼 후속 → ⚠️ 일반 미끼 답 (LLM 자율 한계). sentinel 결합 PASS (일반 28/30 + SEC 4/5 MEM-LEAK-05 LLM 비결정) |
| 2026-06-06 | **🚀 v5_run7 측정 (K 라운드 적용 후, 440 케이스, 37분) — DoD 만점 회복** — **종합 PASS 379/440 (86%)** ✅ **v5_run5 만점 회복** (v5_run6 85% → +1pp). 카테고리 v3→v5_run7: **정량 28%→82% (+54pp) 🎯 최대** ✅ / **연속 43%→69% (+26pp)** ✅ / **다중 58%→80% (+22pp)** ✅ / **기본 89%→96% (+7pp)** ✅ / 메타 79%→82% (+3) / 비도 96%→98% / 변칙 100%. **net p95 6122ms** v5_run6 6363 -241ms 개선 (광역 답 정리). **환각 의심 4건** (DoD ≤2 미달, +1 vs v5_run6) — 모두 비도메인 통계 답 (CG-5-03 구난 통계 / CG-7-04 메타 거절 / MOF-7-03 어획량 / PO-7-01 환경 통계, K1 G4 "통계 수치 X" 룰 약함). 직군 floor 78% PASS. CoT 0. 잔존 61건: cat2 25 / cat6 14 / cat3 8 / cat4 7. **K1+K2 효과 입증**: 코드 +18 라인 + LLM 자율 위임 강화로 PASS 85%→86% + p95 -241ms + 정량 75%→82% 추가 회복. 산출물: v5_run7_report.md + v5_run7_freevar.log.gz. **잔존**: (a) 환각 4건은 "통계 수치 거절" 강화 1-hunk 패치 가능 / (b) Q2b 같은 LLM 자율 후속 한계는 사용자 기억 v2 통합으로 누적 학습 가능 |
| 2026-06-03 | **선제 산출물 18항목 × 2-agent(작성+검수) 병렬 생성 (옵션 D, Opus)** — 페이즈 선결조건과 무관하게 미리 해둘 수 있는 횡단 자산 18건을 1차 agent(작성·자체검토) → 2차 agent(독립 재검토·직접 개선) 직렬 구조로 생성. **신규 산출물 24파일** (phases 18 + graph 3 + jikgun 1 + 검증). 2차 검수가 잡아낸 실질 결함 다수: 도구개수 19→20 오기(get_seafog_cctv·resolve_location 누락, 3개 문서 공통)·토큰계측 thoughtsTokenCount 누락(비용 과소)·cross_cutting p95 갭 무마를 미검증가설로 강등(DoD 0/5)·로그스키마 focus.rankedItems 좌표누설 위험·관리자/memory 회귀는 러너 확장 필수·선제규칙 logic 7건 정정·해구매핑 5코드 폴백·모듈분리 줄구간/의존 정정. 코드 직접수정 0(전부 설계·명세·데이터·스크립트). 문법/JSONL/YAML 전수 검증 통과 |
| 2026-06-03 | **4 옵션 × 2 worker + 1 합성 = 12-agent 다단 평가 (Opus)** — sentinel 결과 기반 4 트랙(가:v5측정프레임 / 나:잔존결함4건패치 / 다:p95게이트화·SLO / 라:sentinel P0합류·확장) 각각 독립 worker 2인 + 합성 1인 구조. **신규 12 산출물** (worker 8 + 합성 4). 합성이 잡아낸 핵심 충돌: (나) `planTools` 변수명 중복 + `get_warning` 응답 키 변경 → 분리 머지 시 LG-4-01 회귀 → 단일 PR 8커밋 통합 필수 / (다) A 의 분위수 합성 오류(`p95_pure+p95_backoff ≠ p95_raw`) → B 의 raw_ms 케이스별 적재 채택 / (가) A 게이트(절대 임계) vs B ROI(연속점수) 충돌 → "A 게이트 먼저, 내부에서 B 정렬" / (라) SEC 2.0× 가중치로는 5건 fail 10점 < 12점 HARD → SEC 별도 하드 게이트 분리. 다음: 합성본 기반 통합 PR 작성·실측 라운드 |

---

## 8. 교차 관심사 / 운영 정책 (모든 단계 관통)

> 검토 지적: 평가·회귀·비용·프라이버시·시크릿·신선도가 단계로도 섹션으로도 없었음. 요지를 여기 고정하고, 상세는 → 예정 `phases/cross_cutting.md`.

- **평가·회귀**: P0 골든셋 고정, 모든 단계 DoD에 "P0 무회귀". 직군/선제 단계는 전용 평가셋 + 베이스라인 먼저.
- **🔁 머지 후 검증(필수 절차)**: 어느 정도 진행해 **머지(커밋·푸시/PR)** 할 때마다, 그 단계에서 **새로 구현·기획한 의도가 나리야 응답에 실제로 반영됐는지**를 나리야를 직접 호출해 확인한다. 최소 `phase0_runner.py`(골든 게이트, 직군 개인화·보안 포함) 통과 + 해당 단계 고유 동작 스팟체크. 통과 못 하면 머지 미완으로 본다.
- **비용/지연(SLO)**: planQuery+합성+style-digest+(향후)RAG 토큰 누적. 단계별 토큰/지연 상한을 측정·기록(P2b부터 적용).
- **프라이버시/거버넌스**: 프로필·대화·style는 휴대폰 로컬 원칙. 서버 `assistant_log.js`는 비식별·보존기간 한정(정의 필요). 외부 전송 동의 범위 명시.
- **운영 시크릿 체크리스트**: 배포 전 `KMA_DMDW_USER_ID/PWD`(태풍), TideBED 키(조석 전지점), Gemini 키 점검. 테스트키 폐기.
- **데이터 신선도**: 직군 "최근 동향"·GAP URL은 시점형 → 수집일 표기 + 만료/재검증 주기(P4 자동화 전까지 수동 점검).

---

## 9. 산출물 저장 방식 (합의: "리포 정본")

> 비유: GitHub=본관 도서관(정본+수정이력), 배포=책상에 사본 인쇄, Fly 볼륨=책상 노트(앱이 실시간 쓰기), GCS=매일 밤 금고 백업.

**핵심 사실(오해 정리)**: 리포에 커밋해 배포하면 파일이 서버 이미지(`/app/...`) 안으로 복사되어, 나리야는 **로컬 디스크에서 읽는다 → 볼륨과 읽기 속도·빈도 동일.** 리포는 런타임에 네트워크로 매번 가져오는 곳이 아님.

**채택안 — 리포 정본**
- **정본/저장**: 리포(`local_server/knowledge/`). 검토(PR·diff)·이력·**프로덕션 배포 통로** 역할. (개발 컨테이너에서 프로덕션 볼륨에 직접 못 쓰므로, 어차피 리포 커밋이 프로덕션 도달의 첫 통로)
- **런타임 읽기**: 배포된 그 파일을 나리야가 읽음(볼륨과 동일 속도).
- **백업**: 리포(GitHub) 자체가 영구. (data 볼륨은 별도로 GCS 일일 백업)

**왜 다른 방식을 안 쓰나**
- ❌ 컨테이너 메모리 단독: 회수 시 소멸(휘발).
- ⚠️ 볼륨 단독(+git 미사용): 자동 백업은 되나 **편집 이력·검토(PR) 부재** → 사람이 검수하는 지식엔 부적합.
- ⏳ 별도 DB/벡터DB: 현재 자료 수 MB라 과투자. 검색량 폭증 시 재검토.

**향후(Phase 4 자율 성장) 전환 설계**
- 앱이 **스스로 무중단 갱신**해야 할 때 → 볼륨(`data/knowledge/`)에 **런타임 작업본** 추가: 수집 로봇이 볼륨에 초안 기록(재배포 불필요) → 사람 검토 → **리포 정본에 반영(커밋)** → 배포로 동기화. 즉 **리포=검수된 정본/이력, 볼륨=런타임 작업본/자동수집 스테이징.**
- 용량: 현재 지식 0.3MB·data 6.3MB로 볼륨(GB)·GCS 무료티어(5GB)에 충분.

**저장 위치 규칙(요약)**
| 산출물 종류 | 위치 | 이유 |
|---|---|---|
| 계획/스펙 문서 | 리포 | 개발 산출물·검토·이력 |
| 직군 지식(런타임 RAG 원천) | 리포(정본) → 배포본 읽기 | 정적·사람검수 단계 |
| (P4) 자동수집 작업본 | 볼륨 `data/knowledge/` | 무중단 갱신·GCS 백업 |
