# 이미 구현된 기능 인벤토리 (보존·회귀 대상 정본)

> 마스터플랜 §2.5 요약표의 **정식 확장본**입니다. 각 기능의 {최초 의도 · 코드 위치(파일:대략 라인) · 커밋 해시 · 회귀 대상(어느 게이트)} 를 매핑합니다.
> 원칙(검토 지적): 빈틈은 "미구현"이 아니라 **"미추적"**. 이미 코드에 있는 의도는 로드맵의 **보존·회귀 대상**으로 등재한다.
> 최종 갱신: **2026-06-03** · 근거: `routes/assistant.js` / `js/assistant.js` / `js/assistant_deeplink.js` / `android/.../voice/*.java` 직접 대조 + `git log` 커밋 검증(11개 해시 전부 실재 확인).
> 회귀 게이트 정의: **P0 골든셋** = `phases/phase0_golden.jsonl`(38케이스) + 러너 `phases/phase0_runner.py`(정적 보안검사·카탈로그 드리프트·그래프 무결성 포함). **자유변칙 게이트(예정)** = `phases/phase2b_eval_freevar*.{py,jsonl}`(440케이스). **직군 평가셋** = `phases/phase2b_eval*.{py,jsonl}`(10케이스).

---

## 1차 — 기능별 인벤토리 표

| # | 기능 (최초 의도) | 코드 위치 (파일:대략 라인) | 커밋 | 회귀 대상 (게이트·케이스) |
|---|---|---|---|---|
| 1 | **Tool Use 두뇌** — 자연어→도구계획→실행→합성 (복합·추론·재계획) | `routes/assistant.js` planQuery `:1297`, runBrain `:1440`, synth 프롬프트 `:1571`, TOOL_CATALOG `:873`, TOOL_EXEC `:1128` | — (초기 골격) | P0 골든셋 전체. 특히 `compound-jeju`, `compound-fishing` |
| 2 | **단기 해상예보(명명 해역)** — 풍향/풍속/파고/하늘 | `get_marine_forecast` → `buildForecastSummary` `:523`; `ZONE_NAME_TO_CODE` `:373` | — | `forecast-jeju-n`, `forecast-busan-wind` |
| 3 | **해구(격자번호) 예보 + 좌표 반환** — N시간 후 파고·풍속 + 그 해구 경위도 | `get_zone_forecast` `:1134` → `getZoneForecastAt`; `HAEGU_COORDS`(zone_coords.json) `:146` | bc1e30d, 688cb7e | `zone-325-wave`, `zone-325-48h`, `followup-haegu-coord`, `focus-haegu-coord` |
| 4 | **중기 해상예보(3~10일)** | `get_midterm_forecast` `:1166` | — | `midterm-jeju` |
| 5 | **해상 특보(주의보/경보/예비특보)** | `get_warning` → `findWarning` 재귀 트리탐색 `:570`; 폴백 합성 `:614` | — | `warn-jeju-n`, `context-warn` |
| 6 | **기상부이 관측** — 목록·관측값 병합 | `list_buoys_near`, `get_buoys_with_obs`, `get_buoy_observation`, `get_current`, `get_depth` (TOOL_EXEC `:1128~`); `BUOY_BY_ID` 파싱 `:95` | b1a34aa(부이 필드 병합) | `buoy-oryuk-wave`, `buoy-list-jeju`, `current-jeju-n`, `current-donghae`, `depth-jeju` · (`buoy-geomun-temp`=optional, 피드의존) |
| 7 | **조석(고조/저조·물때)** | `get_tide` → `fetchTideTimes`(save_tide_input 폴링) `:68` | 33e0b4c | `tide-mokpo` |
| 8 | **태풍 현황** — DMDW 통보문 연동(현재위치·강도·이동) | `get_typhoon_status` (TOOL_EXEC); 환각 정정 규칙 synth `:1580` | 6ad0969 | `typhoon-now`, `hallu-jangmi`(환각 방지) |
| 9 | **생활지수(낚시·서핑·바다갈라짐)** | `get_fishing_index`, `get_surfing_index`, `get_sea_split_index` (TOOL_CATALOG `:889`) | b1a34aa(지수 라우팅) | `surf-index`(optional, 공유키 경합), `scuba-route`(오안내 방지), `compound-fishing` |
| 10 | **미노출 데이터 도구화** — 시정 조회 + 수온/시정 랭킹 | `get_visibility` `:1142`→`getVisibility`; `get_zones_ranked` metric=temp/vis `:1163`→`rankZones` | 02e47ca | `visibility-busan`, `rank-temp`, `rank-vis-worst` |
| 11 | **비교/집계 랭킹(해역·해구)** — "제일/가장/줄세워/N 넘는" | `get_zones_ranked(scope=zone|haegu)` `:895`, `:1163` | bc1e30d | `rank-wave-high`, `rank-wind-thr`, `rank-haegu-wind` |
| 12 | **구조화 대화 연속성(focus)** — 해역/해구/부이/좌표/랭킹을 응답에 반환→재전송 | `deriveFocus` `:1271`; planQuery focusLine `:1308`; runBrain focus 결정론 주입(`FOCUS_ZONE_ARG` `:1466`, `PRONOUN_RE` `:1459`) | 688cb7e, 5f36c5c(#22), 64e6cba(#27) | `focus-haegu-coord`, `followup-haegu-coord` |
| 13 | **의존 위빙(1회 재계획)** — "X 가장 ~한 곳의 Y" 2차 도구 재계획 | `needsReplan` `:1429`; runBrain 2차 plan `:1513` | a2a2ca1 | `weave-rank-warning` |
| 14 | **GPS 위치질문(최근접 부이 등)** | `get_nearest_buoy(lat,lon)` `:1255`; planQuery locLine `:1298`; ask 좌표 수신 | 94919d2 | P0 위치축(`current-*`/`depth-*` 좌표경로), 자유변칙 |
| 15 | **딥링크 앱 이동** — 레이어(유속/풍/파고/CCTV/부이)·특보·태풍·해구·물때 | `buildLinks` `:1883`(서버); `js/assistant_deeplink.js` `:30~`(클라, `ALLOWED_TABS` 화이트리스트 `:47`) | 33e0b4c | 딥링크 커버리지(수동). 골든=`tide-mokpo` 버튼 보장 |
| 16 | **웹검색 그라운딩 폴백 + 도메인 가드** — 비도메인만 web_search 허용 | planQuery `googleSearch` config `:1408`; runBrain `DOMAIN_RE` `:1546`/`isDomainQuery` `:1548`/빈결과 차단 `:1554` | 727dfcb(#11), 1493c4e(#14·15) | `baseline-geomun`, 자유변칙 환각/기본 카테고리 |
| 17 | **직군 개인화(8종)** — 직군 감지→관심사·용어 다이제스트 주입 | `JIKGUN_META` `:181`/`JIKGUN_KB` `:192`; `detectJikgun` `:253`/`jikgunDigest` `:273`; planQuery·synth 주입 | c9d5622, ea75c42 | `jikgun-angler`, `jikgun-fishery`, `noprofile-regress`(무프로필 회귀), 직군 평가셋 |
| 18 | **데이터 카탈로그(단일 출처) + 인벤토리 주입** | `CATALOG_DIGEST`(data_catalog.json) `:161`; 빌더 `knowledge/build_data_catalog.js` | 81f3790 | P0 카탈로그 **드리프트 검사**(정적, runner 내) |
| 19 | **지식그래프 런타임 연결** — 직군 "관심사→권장도구(servedBy)" 라우팅 힌트 | `GRAPH_RT`(graph.json 로드) `:300`; 빌더 `graph/build_graph.js`; jikgunDigest 그래프 우선 `:276` | 3f763b2, 222caf2 | P0 그래프 **무결성·런타임 연결 정적검사**(runner 내) |
| 20 | **임베딩 의미검색 PoC(토픽+도구)** — 룰베이스 우회표현 보완 | `services/topic_embedding.js`(gemini-embedding-001, 3072d); planQuery `simLine` `:1337`/`toolSimLine` `:1352`; 워밍업 `:320`/`scheduleToolEmbedWarmup` `:340` | 4a7743b(토픽), 9c7ed95(도구) | 직군 평가셋(베이스라인 대비), 자유변칙 |
| 21 | **정량 임계 판정기** — 직군 안전 임계표로 사용자 제시 수치 즉시 가부 | `JIKGUN_THRESHOLDS`(`_thresholds.json`) `:225`; `thresholdDigest` `:236`; 임계표 주입(buildPersonalContext) `:724`; synth 정량 판단 규칙 `:1579` | 5f36c5c(#21) | 자유변칙 **정량 카테고리**(15%→28%↑) |
| 22 | **응답 길이 정책(간단/자세히)** | 폴백 `composeAnswerFallback` brief 분기 `:615`; 온보딩 `answerStyle` 수집 `:1945` | — | 회귀(스타일 반영, 수동 스팟체크) |
| 23 | **AI 대화형 온보딩→직군 프로필(로컬 저장)** | `/api/assistant/onboard` `:2017`; `onboardWithAI` `:1972`/`onboardScripted`(키없음 폴백) `:1948`; 클라 `js/assistant.js` onboard `:794~` | — | P2b 전제(프로필 생성). 🔒 서버 미저장(클라 로컬) |
| 24 | **대화기록→통계형 스타일 요약 개인화** | `/api/assistant/style-digest` `:2149`; 클라 8건마다 호출 `STYLE_REFRESH_EVERY` `js/assistant.js:169` | — | P3 입력. 회귀(개인화 컨텍스트 `buildPersonalContext` `:711`) |
| 25 | **자연 음성 TTS(Gemini)** — 키없음 시 내장TTS 폴백 | `/api/assistant/tts` `:2062`; `pcmToWav` `:2042` | b8da952 | (보조) 키없음 503 폴백 동작 |
| 26 | **클라우드 STT + 도메인 힌트** — 호출어 후 녹음→고정밀 받아쓰기 | `/api/assistant/transcribe` `:2109`(해역명·부이명·해구번호 힌트); planQuery `correctedQuery` AI 보정 `:1320`; 클라 MediaRecorder `js/assistant.js:322~` | b8da952, 4e0ae0b | STT 회귀: `corr-jeju-nambang`, `corr-325-hangul`, `corr-jeyuk-busan` |
| 27 | **호출어 상시대기 — 엔진 추상화 + 3단 폴백** | `WakeWordEngine`(interface); `PorcupineWakeEngine.java`; `AndroidSpeechWakeEngine.java`; 우선순위 분기 `VoiceAssistantService.java:122~130` | b8da952 | STT/호출어 회귀(기기 수동) |
| 28 | **Vosk 무료 오픈소스 호출어 엔진(Apache-2.0)** — 오프라인 한국어 KWS + 동의 후 모델 1회 다운로드 | `VoskWakeEngine.java`(GRAMMAR 제한 `:44`, WAKE_VARIANTS `:42`); `VoskModelManager.java`(MODEL_URL `:40`, ~82MB); `VoskDownloadService.java`(전경서비스·진행률); 플러그인 `SeagnalAssistantPlugin.java` getCapabilities `:139`/requestVoskDownload `:157`/voskState `:49`; 클라 다이얼로그 `js/assistant.js:627~789` | b366011 | 🔒 가입·승인·유료화 없음(Apache-2.0). 기기 수동 검증(다운로드·진행률·"나리야" 호출) |
| 29 | **음성 비서 P3 focus 연속성** — 자바 경로가 focus 동봉/갱신 | `VoiceAssistantService.java` `lastFocusJson:99`, askServer 동봉 `:301`, 응답 갱신 `:329` | e305566 | 음성 후속("232 해구→거기 경위도?") 수동(APK 재빌드 후) |
| 30 | **음성 비서 자연어 memory 동봉** — 비도메인 후속 연속성(focus 미포함 화제) | `VoiceAssistantService.java` `recentMemory`(ArrayDeque, MEMORY_MAX=8) `:105`, body 동봉 `:307`, 적재 `:342` | 3d5f4c1 | 비도메인 후속("뽀로로파크→이용금액?") 수동 |
| 31 | **🔒 관리자 보안 격리** — admin 도구 미정의 + `/api/admin` 미호출 + 관리자 의도 누설 차단 | TOOL_CATALOG/TOOL_EXEC 에 admin 도구 부재; synth 컨텍스트 격리 `:1576`; 비도메인 거절 `:1577` | — | P0 **정적 보안검사** + `sec-admin-usage`, `sec-admin-push` |
| 32 | **🔒 프라이버시 컨텍스트 격리** — 프롬프트 라벨/타사용자 정보 응답 누설 차단 | synth 격리 규칙 `:1576`; 후처리 `cleanAnswer` 라벨 라인 제거 `:1595` | 5f36c5c(#24), 64e6cba(#28) | 자유변칙 환각/누수(ANG-6-03b 해소), 메타 카테고리 |
| 33 | **메타 질의(앱 능력·자기요약)** | `get_app_capabilities`(TOOL_CATALOG `:902`); synth 메타·자기요약 규칙 `:1578` | — | `meta-caps`, 자유변칙 메타 카테고리 |
| 34 | **환각 방지(전제 정정)** — 사용자 단정≠수집결과면 수집결과 우선 | synth 규칙 `:1574`,`:1580`; 빈결과 차단 884b583 | — | `hallu-jangmi`, `context-warn`, 자유변칙 환각 카테고리 |
| 35 | **안전문구 1회 정책** — 출항/조업 가부 후 "최종 판단은 선장 몫" 1회만 | synth 의사결정 규칙 `:1579`,`:1586` | — | 🔒 불변식(자유변칙 정량·의사결정 카테고리) |
| 36 | **해무 CCTV 조회** — 항구 해무 카메라 최신 영상(이미지 링크) | `get_seafog_cctv(harbor)` TOOL_CATALOG `:885`/TOOL_EXEC `:1223`; 보안검사 secTools 포함 `:1436`; args 매핑 `:1479` | — | (보조) 딥링크 `cctv` 버튼(`buildLinks` `:1907`)과 연동, 수동 |
| 37 | **지명→좌표 변환 헬퍼** — 임의 지명(항/해수욕장/마을)을 좌표로 변환해 좌표기반 도구 보조 | `resolve_location(text)` TOOL_CATALOG `:903`/TOOL_EXEC `:1249`; 플래너 사용 가이드 `:1373~1374`(해역명이면 zone 인자 직접 사용) | — | 좌표경로 보조(`get_current`/`get_depth`/`get_tide` 좌표 확보). 직접 골든케이스 없음 |

---

## 2차 — 자체 검토 (누락·매핑정확성·중복)

### (A) §2.5 요약표(13행) → 본 인벤토리(37행) 대조: 누락 없음 + 확장
§2.5의 13개 항목은 모두 포함되었고, 코드 직접 대조로 **§2.5에 없던 24개 의도를 추가 등재**(미추적이던 것):
- 데이터축 분해: 예보(#2~4) · 특보(#5) · 관측/부이/유속/수심(#6) · 조석(#7) · 태풍(#8) · 생활지수(#9) · 랭킹(#11) · 해무CCTV(#36) · 지명→좌표(#37) — §2.5는 "Tool Use 두뇌" 1행으로 뭉쳐 있었음.
- 측정·고도화: 임베딩(#20) · 정량임계(#21) · 카탈로그 드리프트/그래프 무결성 게이트(#18·#19).
- 음성 3건: P3 focus(#29) · memory(#30) — §2.5 Vosk 행에 미분리.
- 안전·프라이버시 불변식의 **코드 거점**: 보안격리(#31) · 컨텍스트격리(#32) · 환각방지(#34) · 안전문구(#35).
- **TOOL_EXEC 20도구 전수 커버 확인**: `get_marine_forecast`·`get_zone_forecast`·`get_warning`·`list_buoys_near`·`get_buoy_observation`·`get_buoys_with_obs`·`get_visibility`·`get_tide`·`get_typhoon_status`·`get_zones_ranked`·`get_app_capabilities`·`get_midterm_forecast`·`get_fishing_index`·`get_surfing_index`·`get_sea_split_index`·`get_seafog_cctv`·`get_current`·`get_depth`·`resolve_location`·`get_nearest_buoy` → 모두 위 표(#2~#14·#33·#36·#37)에 귀속(고아 도구 없음).

### (B) git log 변경이력 대조 — 커밋 11개 전부 실재 확인
`b8da952·4e0ae0b·33e0b4c·81f3790·02e47ca·688cb7e·a2a2ca1·b366011·b1a34aa·e305566·3d5f4c1` 모두 `git log -1` 통과. 추가로 그래프(3f763b2·222caf2)·해구랭킹(bc1e30d)·임베딩(4a7743b·9c7ed95)·도메인가드(727dfcb·1493c4e)·트랙1 패치(5f36c5c·64e6cba·884b583·66d404d) 매핑 보강.
- **장미(데코) 항목 없음**: 마스터플랜에 "구현"으로 기재됐으나 코드 부재인 기능은 발견되지 않음.
- **APK 재빌드 대기(런타임 미반영) 주의**: #28 Vosk(b366011) · #29 focus(e305566) · #30 memory(3d5f4c1) 는 안드로이드/JS 변경분으로 **APK 1회 재빌드 후에야 기기에서 동작**(마스터플랜 §6 #26 묶음 권고). 서버측 focus 수신 경로는 이미 활성.

### (C) 회귀 매핑 정확성 — 골든셋 38케이스 전부 귀속 확인
`phase0_golden.jsonl`의 38개 case id를 기능에 1:1 귀속(중복·고아 없음):
- optional(피드 의존, SKIP 허용): `buoy-geomun-temp`, `surf-index` → #6/#9에 표기.
- 정적검사(케이스 외, runner 내장): 보안격리(#31) · 카탈로그 드리프트(#18) · 그래프 무결성(#19).
- 자유변칙 카테고리(정량/연속/다중/메타/기본/환각) → #12·#16·#21·#32·#33·#34 에 분산 귀속.

### (D) 중복 제거
- "구조화 연속성(#12)"과 "음성 focus(#29)"는 **서버 로직 vs 자바 전송경로**로 분리(중복 아님 — 회귀 게이트가 다름: 골든 자동 vs 기기 수동).
- "클라우드 STT(#26)"와 "호출어 대기(#27)"는 **받아쓰기(서버) vs 깨우기(온디바이스)**로 분리. b8da952 가 둘의 공통 커밋이나 코드 거점·회귀축이 달라 별행 유지.
- "웹검색 폴백(#16)"은 §2.5의 "웹검색/참고링크 폴백"과 "도메인 가드"를 통합(같은 코드경로 `runBrain` 폴백 분기).

---

## 부록 — 회귀 게이트 빠른 참조

| 게이트 | 파일 | 범위 | 비고 |
|---|---|---|---|
| P0 골든셋 | `phases/phase0_golden.jsonl`(38) + `phase0_runner.py` | 구조 불변식·수치응답·🔒보안·카탈로그/그래프 정적검사 | 모든 단계 DoD에 "P0 무회귀" |
| 직군 평가셋 | `phases/phase2b_eval.jsonl`(10) + `phase2b_eval_runner.py` | 직군 개인화 적중(N=3 다수결) | PASS 10/10 달성 |
| 자유변칙 게이트(예정) | `phases/phase2b_eval_freevar.jsonl`(440) + `phase2b_eval_freevar_runner.py` | 내용·연속·환각·정량(8직군×55) | Phase 3 착수 게이트(DoD: PASS≥85%·직군 floor≥70%) |
| 음성/호출어(수동) | 기기 — APK 재빌드 후 | "나리야"→해구→"거기 경위도?"→비도메인 후속 | #28~#30 묶음 검증 |
