# admin  `local_server/js/admin/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `admin.js` | 통합 관리자 시스템 (인증, 대시보드, 특보 관리) | `getStoredAdminToken`, `saveAdminToken`, `clearAdminToken`, `setAdminAuthState`, `_getDeviceToken`, `renderUnifiedAiTab`, `renderAiForecastSubtab` |
| `admin_data_status.js` | 관리자 → 점검 → 데이터 수집현황 화면(수집 목록·현재 원천 상태·오류·복구 이력) | `renderDataCollectionTab`, `renderDataCollectionList` |
| `admin_station_briefing.js` | 관리자 → AI → 「AI 브리핑」 하위 탭(2026-11-16 시안 A2 로 정리 — 설계서 §11.10.50). 위에서부터 머리(「연안 안전 브리핑」 한 줄 · 상태 알약 · [↻] · [지금 다시 만들기](409)) → 상태 카드(숫자 3칸 다음 판·마지막 실행·처리 안 된 오류 · 칩 한 줄 AI·재사용·규칙 분석·오류·「쓴 AI」(`stats.byProvider`) · 관광지 자료 이상 없음/문제 있을 때만 펼침(§11.10.21) · 있을 때만 건너뜀(`lastRun.skipped`)·공개 예정·특보 변경 대기·실행 실패 줄 · 실행 중 진행 게이지 — 전체 막대·단계 4칸·묶음 칩·관할 칩, 2.5초마다 `status?only=progress`) → 오류 카드(세그먼트 탭 「처리 안 된 오류」 = §11.10.48 누적 유형 목록·[md로 저장]·[복사]·[남은 N개 완료 처리] / 「실행별」 = 최근 3일 실행 드롭다운·관할별 한글 풀이·[복사]·[md로 저장] §11.10.7·§11.10.31 — 0건이면 버튼 숨김) → 정시 판 기록 표(판·소요·AI·재사용·규칙·오류, 마감 걸린 판만 「마감 N곳」, 줄 누르면 실행별) → 설정(접힘 — AI 분석 스위치 `method` 'ai'/'template' · 노출 범위·묶음 단위 세그먼트 · 바뀐 곳만 스위치, AI 모델·순서는 「AI 모델 설정」 ④ 로 옮김) → 관할 하나 미리보기(접힘). 카드는 `.admin-card`, 세그먼트는 특보 관리 `.admin-sub-tabs` 꼴(`/api/admin/station-briefing/*`) | `renderStationBriefingAdmin`, `drawConfig`, `drawStatus`, `providersText`, `drawSpotFail`, `drawEditionTimes`, `mmss`, `drawProgress`, `startPoll`, `drawErrorCard`, `drawRunErrors`, `drawOpenErrors`, `runGroups`, `errorsByStation`, `codeText`, `reasonTexts`, `errorsMarkdown`, `rejectedMarkdown`, `cumulativeMarkdown`, `familyText`, `saveMarkdown`, `copyText`, `doneMark`, `drawPreview`, `nextEdition`, `collapsible`, `card` |
| `admin_bulletin_ai.js` | 관리자 → AI → 「AI 모델 설정」 하위 탭(2026-11-16 이름 바꿈, 종전 「AI 특보 분석」) — 맨 위 「AI 챗봇 모델」(나리야 답변 AI 순서·일반 사용자 적용·ChatGPT 실행 위치 — `ai_chat.js` `renderModelSettingsInto` 가 그림, 종전 자리 AI 챗봇 → 🤖 AI 모델) · 그 아래 「AI 특보 분석」 — ① 특보 통보문 읽기 · ② 참고사항 해석 · ③ 해상 기상 전망 색칠(2026-11-16, 종전 Gemini 고정 — 운영에서 바로 쓰임, 기본 Gemini 만)마다 AI 우선순위(▲▼·삭제·다시 추가, Gemini 는 뺄 수 없음) · 칸별 모델·노력 · ChatGPT 칸은 모델과 실행 위치(Fly 서버/VM, 연결 상태 표시). 바꾸면 바로 저장(`GET·POST /api/admin/bulletin-ai/config` → `services/bulletin_ai.js`). ⚠① 은 운영에서 아직 꺼져 있다(순서만 저장) · **④ 연안 안전 브리핑**(§11.10.51, 2026-11-16) — AI 브리핑이 실제로 쓰는 순서(처음 클로드 키2→키1→업스테이지→ChatGPT(VM)→Gemini). ④ 에만 칸별 시도 횟수 「최대 1~3번」(`data-bai-attempts`)·Gemini 모델 고르기·맨 아래 고정 줄 「규칙 분석」(`data-bai-rule`). 카드마다 `data-bai-feature`. 시험 `test_bulletin_ai_ui.js` | `renderBulletinAiAdmin`, `drawFeature`, `draw`, `save` |
| `admin_collect.js` | 특보 수집 테스트, 결과 팝업, 방문자 통계 차트 · 「저장소」 탭(서버 디스크·Cloudinary·GCS — 아래 「저장소」 절) | `isAdminTestMode`, `getAdminToken`, `getTestModeParams`, `renderATMStatus`, `renderATMCollect`, `renderATMForecast` |
| `admin_bulletin_watch.js` | 관리자 → 특보 관리 → 「통보문 관찰」 탭 — 방재기상플랫폼 통보문 관찰기록 내려받기, 참고사항 AI 실시간 해석 기록 내려받기(2026-11-16 — `services/bulletin_ai_live.js`), 참고사항 AI 시험(표본 200건, 서버 ChatGPT) 시작·멈춤·결과 내려받기 | `renderBulletinWatchAdminTab`, `trialText`, `refreshTrial`, `trialAction` |
| `admin_location_status.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `readPrefFirst`, `readPos`, `fmtAgo`, `fmtAbs`, `esc`, `seaLandOf` |
| `admin_report.js` | 관리자 제보 관리 + 차단 관리 UI | `escapeHTML`, `_reportDisplayName`, `loadReportList`, `renderReportList`, `_loadCommentReportList`, `_renderCommentReportList` |
| `admin_survey.js` | 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과분석/이력관리) | `renderUnifiedSurveyContent`, `escSvAttr`, `renderSurveyCreateTab`, `renderQuestionsList`, `renderSurveyStatusTab`, `_reloadSurveyStatusKeepPage` |
| `admin_trigger.js` | 관리자 트리거(15회 클릭), 공지/점검/오류 팝업 | `initAdminTrigger`, `checkNoticeStatus`, `showAdminNoticeModal`, `loadPromoListForNoticeLegacy`, `requestNoticeUpdate`, `showNoticePopup` |
| `cctv7.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `toggleCctvEditMode`, `handleCctvEditClick`, `_selectEditFeature`, `_moveSelectedFeature`, `_clearEditSelection`, `_updateEditPanel` |
| `pagination_helper.js` | 관리자 리스트 화면용 공용 페이지네이션 UI helper | `buildPageList`, `renderStandardPagination`, `resolveScrollTarget`, `normalize` |

## 점검 탭 — 선택 차단 트리 (2026-09-10 갱신)

`admin.js` 의 `featureTree` 가 관리자가 고를 수 있는 "잠글 기능" 목록이고, 실제로 잠그는 코드는
`client/index2.html` 의 `applyFeatureBlocks()`(버튼·탭·아코디언 매핑)와 `survey_user.js`(설문 팝업)다.
**트리에 id 를 더하면 같은 커밋에서 그 매핑에도 더한다** — 빠지면 `local_server/scripts/test_maintenance_tree.js`
(verify_all)가 실패한다. 화면 접근만 막는 것이 목적이라 서버 API 는 막지 않는다(사용자 확정 2026-09-10).
점검 중 "푸시 알림 차단"은 특보 푸시·태풍 푸시·**위치기반 특보 알림**(`services/location_alert_dispatch.js`) 모두에 적용된다.

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## AI 사고예측 → 오류현황

> ⚠**위치 바뀜 (2026-10-15)** — 이 화면은 이제 **점검 → 데이터 수집현황**의 「현재 원천 상태」·「오류·복구 이력」 하위 탭이다(아래 절). AI 탭에서는 빠졌다. 사용자 원문: 「빠져서 점검 탭 아래로 가는게 맞음」. 아래 설명의 내용(필터·색·상세)은 그대로 맞다.

기존 통합 관리자 인증으로 로그인한 뒤 **AI → AI 사고예측 → 오류현황**에서 현재 원천 상태와 오류·복구 이력을 확인한다. `renderAiForecastSubtab`은 `GET /api/admin/risk-forecast/errors`를 호출한다. 기존 `adminAwareFetch`가 토큰을 붙이고 401을 처리한다. 원천·상태 필터, 30건 페이지, 수동 새로고침을 제공하며 KST 시각과 최종 상태 확인 시각을 표시한다. 탭을 떠난 뒤 늦게 도착한 응답은 무시한다. 비밀번호를 새로 만들거나 코드에 넣지 않는다.

**필터는 두 구역에 함께 걸린다(2026-10-15 수정).** 전에는 서버 `risk_error_history.list()`가 원천·상태 조건을 이력(`data`)에만 걸고 현재 상태(`current`)는 그대로 돌려줘, 원천을 골라도 위쪽 「현재 원천 상태」가 바뀌지 않았다(사용자 지적 「필터가 제대로 작동하지 않는다」). 지금은 원천·상태가 현재 상태와 이력 둘 다를 거르고, 기간(`from/to`)만 이력 전용이다. 상태 선택지에 「비운영 기간」(`offseason`)도 넣었다.

**모양**: 같은 AI 탭의 AI 비서·서버 로그와 같은 어두운 상자·버튼·선택칸 꼴을 그대로 쓴다(새 CSS 없음, 인라인 스타일). 원천마다 카드 한 장, 왼쪽 띠와 상태 배지 색은 정상 초록 `#34d399`·자료 오래됨 노랑 `#fbbf24`·일부 실패 주황 `#fb923c`·수집 실패 빨강 `#f87171`·자료 없음 회색 `#94a3b8`·비운영 기간 청록 `#22d3ee`. 카드 안은 「마지막 정상 수집·최신화 확인·분류·상세」(이력은 「기록 시각·최초 감지·분류·상세」)를 이름 칸/값 칸 두 줄로 맞춘다. 분류가 상태와 같은 말(`stale`·`missing`)이면 겹치므로 생략한다. 조건에 맞는 것이 없으면 각 구역에 빈 안내가 나온다. 검사: `test_risk_errors_filter_ui`(실제 라우터 + Chromium, 380px).

**「일부 실패」(`partial`, 2026-10-15)** — 자료는 저장되어 쓰이고 있지만 일부가 빠졌다는 뜻이다. 지금은 **행사** 수집에서 Gemini 보충검색이 일부 시도(시·도)에서 실패했을 때만 쓴다(분류 「Gemini 일부 실패」, 상세에 「시도 실패 경상남도(Gemini 호출 실패)」처럼 시도와 사유). 실패한 시도는 다음 03:20(또는 재기동)에 그 시도만 다시 묻고, 모두 성공하면 이력에 「복구」가 남는다. 사용자 원문: *"우리 앱에 저장실패했다는 내용을 알려야하겠지? 우리 기능 중 오류를 기록하는 기능이 있잖아? 서버 기록 말고. 통합관리자 센터에서."* 상태 선택지에도 「일부 실패」가 있다. 검사: `test_risk_errors`·`test_risk_errors_filter_ui`·`test_risk_collectors` 9·`test_risk_history_sources`.

**「일부 실패」 갱신(2026-10-15 D7·3차 검토)** — 위 「Gemini 보충검색이 일부 시도에서 실패했을 때만」·「분류 Gemini 일부 실패」는 낡았다. 지금은 행사 수집의 실패한 부분(Gemini·카카오로 실패한 시도, 공식 목록 받기·공식 행사 위치 연결)이 있으면 「일부 실패」이고, 분류는 원인별 고정 이름이다: `행사 일부 실패 — Gemini` / `— 카카오` / `— 공식 목록`, 여러 원인이면 `— Gemini·카카오` 처럼 묶음(원인을 모르는 옛 상태 파일은 `행사 일부 실패`, 이 변경 전 이력의 `Gemini 일부 실패` 도 그대로 읽힌다). 원인이 바뀌면 이력에 「문제 변경」이 남는다. 상세 예: `공식 목록 다시 받기 실패(HTTP 500) · 저장된 행사 유지(공식 목록 마지막 성공 10-01 03:20 KST) · 시도 실패 10곳(카카오 키 없음(설정))` — 실패 시도는 사유별로 묶고(3곳까지 이름) 200자를 넘지 않게 줄인다. **지난 달 닫기**: 1분 감시가 더 보지 않는 지난 달 행사의 문제 상태(일부 실패·실패 등)는 이력에 **「수집 종료」**(상태 배지 「비운영 기간」, 상세 「지난 달 — 더 수집하지 않음(마지막 상태: …)」)를 남기고 현재 상태에서 빠진다 — 종전엔 약 3개월 동안 현재 상태에 남았다(`phaseName`: recovered 사건인데 상태가 offseason 이면 「수집 종료」). 검사: `test_risk_errors`(지난 달 닫기·원인별 분류)·`test_risk_errors_filter_ui`(수집 종료 표시)·`test_risk_collectors` 19~23.

원천 상태에 「**상세**」 줄이 붙으면 수집기가 남긴 실패·제외 사유다(2026-10-15, 현재 실시간 선박 교통만). 예: 「API HTTP 503 · 웹 invalid response(접속 페이지에 보안 토큰 없음)」, 「API 2줄: 밀집도 범위 밖(척수는 유지) 1, 격자번호 형식 1」. 고정 문구와 숫자뿐이라 키·주소는 나오지 않는다.

원천 목록에는 2026-10-15부터 **해구별 시정 예측**(`visibility`)이 포함된다. imgList 확인이 3회 연속 실패하면 「수집 실패」, 마지막 래스터 수집이 36시간을 넘으면 「자료 오래됨」으로 보이며, 「마지막 정상 수집」에 마지막 수집 시각이 나온다. 경계와 근거는 `00_docs/operations/risk-forecast-error-history.md`.

## 저장소 탭 (2026-11-15 — 종전 「외부 저장소」)

운영 서버 디스크가 꽉 차(ENOSPC — `df` 974M 중 947M) 23:00 판 브리핑을 저장하지 못한 뒤 사용자 결정(원문): 「통합 관리자 센터에 "외부 저장소"라는 곳이 있는데, 그 탭 이름을 저장소로 바꾸고 그 안에서 종류별로 내용을 나눠서 표출할 수 있도록 하자. 또한 80%가 넘으면 푸시 알림을 보내는 방안은 좋은 것 같아. 그리고 80%가 넘으면 그 저장소라는 곳에 n 뱃지가 붙도록 해줘.」

| 칸 | 무엇 | 그리는 함수 / 서버 |
|---|---|---|
| 서버 디스크(Fly 볼륨 `local_server/data`) | 사용량 게이지(df 와 같은 식 — 사용 ÷ (사용 + 남은 양)) · 남은 공간 · 디스크 크기 · 마지막 자동 점검(없음·실패도 그대로) · 80% 넘음 알림 기록 · **종류별 크기**(data/ 바로 아래 이름으로 나눔 — 펼치면 폴더·파일 이름·크기·파일 수) | `admin_collect.js _renderDiskCard` → `GET /api/admin/disk-usage`(`services/disk_usage.js snapshot`) |
| 클라우드 저장소 | 종전 그대로 Cloudinary · Google Cloud Storage 카드 | `_renderCloudinaryCard`·`_renderGcsCard` → `GET /api/admin/storage-usage` |

- **80% 알림**: 운영 서버(`FLY_ALLOC_ID`)가 10분마다 디스크를 재어(`disk_usage.start` — 첫 점검은 켜진 뒤 1분) 80% 이상이면 관리자 푸시 1통. 사용률은 df 와 같은 식·같은 올림(정수 %). 75% 아래로 내려갔다가 다시 넘을 때만 또 보낸다(79~81% 를 오가며 반복되지 않게). **실제로 1대 이상에 전달됐을 때만** 「보냄」으로 적고(`data/disk_usage_alert.json` — 서버가 다시 켜져도 같은 상태로는 다시 안 보냄), 전달 0건·실패면 화면에 「보내지 못함」을 띄우고 다음 점검 때 다시 보낸다. 스테이징(앱 이름이 `seagnal-server` 가 아님)은 제목 앞에 `[앱 이름]`.
- **독립 검토(2026-11-15)** 반영: 보내기 전에 「보냄」을 적던 것(한 통도 안 갔는데 화면은 「보냄」) · 반올림(79.x% 에서 df 는 80%) · 못 잴 때 뱃지 꺼짐 · 게이지 분모와 「크기」 칸이 달랐던 것 · 상태 파일 바로 덮어쓰기 · 분류 이름 누락.
- **N 뱃지**: 관리자 센터를 열 때 `refreshStorageBadge` 가 `GET /api/admin/disk-usage?only=summary`(폴더를 훑지 않는 가벼운 응답)로 80% 이상이면 「저장소」 탭에 공지사항과 같은 `.new-badge` 「N」. 디스크를 재지 못했을 때도 켠다(「80% 미만」과 「못 잼」이 같아 보이지 않게 — 탭 안에 사유). 탭을 열어 다시 재면 그 값으로 다시 맞춘다.
- **종류 나누기는 이름 기준**(`disk_usage.CATEGORIES`)이라 틀릴 수 있다 — 그래서 종류 아래에 실제 이름을 함께 보인다. 모르는 이름은 「기타」.
- 검사: `test_disk_usage`(사용률 식 · 알림 규칙 표 행마다 · 재기 실패 · 다시 켜진 서버 · 종류별 크기 · 화면 카드 · N 뱃지 · 탭 이름).

## 점검 → 데이터 수집현황 (2026-10-15)

관리자 센터 **점검** 탭의 네 번째 하위 탭. 그 안에 하위 탭이 셋 있다(마지막으로 연 탭을 기억 — `localStorage seagnal_datastatus_subtab`).

| 하위 탭 | 무엇 | 그리는 함수 / 서버 |
|---|---|---|
| 수집 목록 | 앱이 모으는 데이터마다 카드 한 장, 출처별 묶음 | `admin_data_status.js renderDataCollectionList` → `GET /api/admin/data-collection`(`routes/data_collection.js` → `services/data_collection_status.js`) |
| 현재 원천 상태 | 종전 「AI 사고예측 → 오류현황」의 위쪽 구역 | `admin.js renderAiForecastSubtab(host, {view:'current'})` |
| 오류·복구 이력 | 종전 화면의 아래쪽 구역(「일부 실패」 포함) | `renderAiForecastSubtab(host, {view:'history'})` |

②·③은 종전 화면을 그대로 쓰고(합치지 않음) `view` 로 한 구역만 그린다. `view` 를 안 주면 두 구역을 함께 그린다(검사 `test_risk_errors_ui`·`test_risk_errors_filter_ui` 가 그 꼴을 본다).

**사용자 확정(2026-10-15, 원문)**: 「1-목록범위 : 앱 수집 데이터 전체 2-공식 갱신 시기 - 추천대로 3-빠져서 점검 탭 아래로 가는게 맞음 4- 맞아.」
→ ①앱이 모으는 데이터 전체(1단계 위험예측 자료 11종, 2단계 그 밖) ②공식 갱신 시기는 근거가 있는 것만, 없으면 「확인 필요」, 직접 잰 값은 「실측」 ③점검 탭 아래 ④이름 끝에 출처 「○○ (기상청 MMIS)」.

**목록표(manifest)** — `local_server/config/data_collection_manifest.json`. 새 데이터는 `items` 에 한 줄만 더하면 화면에 나온다. 칸의 뜻은 파일 맨 위 `_about`. 근거(`evidence`)는 `{file, quote}` 로 적고, 서버가 그 인용을 찾아 줄 번호를 매번 센다(줄이 밀려도 낡지 않음). 출처 표기 없는 코드 주석은 근거로 치지 않고 `reference`(「참고」)에만 둔다.

**카드 칸**: 공식 갱신 · 우리 수집 시각(코드 일정) · 마지막 수집 · 자료 기준 시각(판·예보 날짜·API 등록시각 — 파일에 있을 때만) · 다음 기대 시각 · 상태 근거 · 상세 · 근거 보기(받는 곳·근거 파일:줄·상태를 읽은 곳). 읽을 곳이 없으면 「기록 없음」.

**상태 판정**(`data_collection_status.itemStatus`):
- 위험예측 원천(1단계)은 오류현황의 현재 상태를 그대로 쓴다(같은 화면 묶음에서 같은 뜻).
- 그 위에, **다음 기대 시각 + 여유(`graceMinutes`)가 지났는데 새 자료가 없으면 노랑(자료 오래됨)**. 다음 기대 시각은 ⓐ판 주기가 근거로 확인된 것(`basisCycleHours`, 지금은 해구 예보 12시간)은 「판 시각+주기」 뒤 첫 수집 회차 ⓑ하루 한 번 자료(`oncePerDay`)는 다음 날 첫 회차 ⓒ마지막 확인 기준(`nextFrom:'checked'` — 판이 바뀔 때만 다시 받는 시정·강풍·공식 사고예보) ⓓ그 밖은 마지막 수집 다음 회차. 다음 시각을 정할 수 없으면(`nextFrom:'none'` — 너울·행사) 이유만 보이고 판정하지 않는다.
- 여유가 없으면 수집 한 번 도는 몇 분 동안에도 노랑이 켜진다.
- 2단계는 `scheduler.getStatus()` 가 「실패」이고 새 자료도 없으면 빨강(수집 실패). 1회 실패만으로는 빨강이 아니다(상세에 「마지막 시도 실패」). `scheduler.js` 는 require 하면 수집이 시작되므로 이미 불러온 경우(`require.cache`)만 읽는다. 바다낚시·바다갈라짐·갯벌·스쿠버·해수욕은 `getStatus()` 가 한 카드로 합쳐 내보내 개별 실패를 못 읽는다 — 시각 판정(노랑)만 한다.
- **이안류·기상청 MMIS 수집 실패 기록(2026-10-15)** — 이안류·특보·강풍·너울·MMIS 관측 4종(기상부이·파고부이·등표·시정계)은 수집기가 매 시도의 성공·실패를 `services/collect_fail_alert.js` 에 알리고, 그 기록(`data/collect_fail_alert.json`, 재기동에도 남음)이 상세에 「마지막 수집 실패: HTTP 503 (연속 2회, 10-15 11:13 KST부터)」로 보이고, 연속 실패 중이면 파일 시각과 무관하게 빨강(「수집 실패 중(연속 N회)」 — 이안류는 실패해도 새 시각으로 파일을 쓰기 때문). 관리자 푸시가 전달되지 않았으면 「관리자 푸시 미전달: … (시각)」 한 줄(시정 예측 포함). 시정 예측의 실패 줄은 `vsby_check_state.json` 이 이미 보이므로 겹쳐 적지 않는다. 같은 기록으로 **관리자 푸시**가 실패 시작 때 1번·복구 때 1번 나간다(시정 예측만 연속 3번 실패해야. 특보는 실패가 5분 이상 이어져야 — 2026-10-17 사용자 확정, 그 전에 풀리면 실패·복구 모두 안 보냄. 화면 빨강은 첫 실패부터 그대로). 사용자 원문: 「이안류, mmis는 데이터를 호출했을 때 받아올 수 없다면 그 때 알려줘 보통 천기가 그런 경우가 많아.」 설계·「실패」 정의 표: `00_docs/operations/collect-fail-alert.md`. 검사: `test_collect_fail_alert`·`test_data_collection_status`.

**해구 예보 예**: 00UTC 판(09시 KST)을 가진 채 12UTC 판이 없으면 22:00 KST 부터 노랑(2026-10-16부터 수집은 30분마다 — 다음 기대 21:00 회차 + 여유 60분이라 노랑 시각은 종전과 같다. 기상청 API허브 답변 「생성하는데 6시간 이상이 소요될 수 있습니다」, 사용자 「그냥 아무런 변화 없이 30분에 한번 점검하도록」). 수집기는 「새 판 없음, 기존 판 유지」를 `data/zone_forecasts_status.json` 에 남기고(`services/zone_forecast_guard.js`), 찾은 판이 가진 판보다 오래되면 덮어쓰지 않는다.

검사: `test_data_collection_status`(목록표 규칙·근거 인용 실재·시각 읽기·다음 회차·판정·실제 관리자 인증 401/200·503) · `test_data_collection_ui`(실제 라우터+Chromium 380px — 하위 탭 셋·출처 묶음·배지 색·확인 필요·기록 없음·늦은 응답 무시·AI 탭에서 빠졌는지) · `test_zone_forecast_guard`.

## 종합 통계 → 구독 현황 — 실제 수신자 기준 (2026-11-18)

`admin.js` `renderSubscriberTab()`. 종전의 큰 숫자는 구독자 명단(`data/subscriptions.json`)의 **줄 수(등록표 개수)** 였다 —
알림을 꺼 둔 사람·앱을 지운 기기·바뀌기 전 옛 등록표가 그대로 세어졌다.

| 화면 | 뜻 | 어디서 오나 |
|---|---|---|
| 큰 숫자 「실제 수신자」 | 알림 켬(`options.master !== false`, 발송 필터와 같은 기준) + 같은 기기(`deviceId`)는 1명 | `GET /api/push-subscriber-stats` `activeSubscribers` |
| 등록 기기 · 알림 끔 · 최근 30일 접속 | 명단 줄 수 · 끈 줄 수 · 실제 수신자 중 30일 안에 앱을 연 사람(`updatedAt`) | 같은 응답 `totalSubscribers`·`masterOffCount`·`recent30Count` |
| 증감·그래프·표 | 일별 기록의 `active`(없는 옛 날짜는 `total`) | `GET /api/subscriber-history` |
| 구독 유지율 | 신규(`subscribe`) 대 이탈(`unsubscribe`+`expired`). `replaced`(같은 기기 등록표 교체)·`backlog`(첫 정리 때 나온 묵은 것)는 세지 않는다. 세 번째 칸은 기준이 바뀐 날 이후만 | `GET /api/subscriber-events` |
| 죽은 등록표 점검 카드 | 마지막 점검이 언제·어떻게 끝났나 + [검사만]·[검사 후 정리] | `GET/POST /api/admin/subscriber-audit` |

- 서버 본체는 `local_server/services/subscriber_audit.js` — 세기(`countSubscribers`)·사건 구분(`subscribeEventType`)·지우기(`removeDead`)·점검(`runAudit`).
  발송 뒤 정리(`routes/push.js` 2곳)와 매일 KST 23:40 자동 점검(`server.js`)이 **같은 `removeDead`** 를 쓴다.
- 점검은 FCM 에 「검사만」(dry-run) 요청이라 **실제 알림이 가지 않는다.** 「영구히 죽음」 코드 둘만 지우고, 그 밖의 오류는 「확인 못 함」으로 세기만 한다.
- **한 건도 「살아 있다」고 확인되지 않으면 아무것도 지우지 않고 실패로 남긴다** — firebase-admin 이 FCM 의 일반 404 도 「등록표 죽음」과 같은 코드로 돌려줘, 이 확인이 없으면 FCM·인증 오류 한 번에 명단 전체가 지워질 수 있다. 자동 점검이 실패하면 관리자 푸시가 간다.
- 사건(신규·해지·이탈)은 줄 단위가 아니라 **「실제 수신자 수」가 바뀐 만큼**으로 정한다 — 사건 합계와 숫자가 어긋나지 않게.
- 카드의 「마지막 정리」가 26시간 넘게 옛것이면 빨갛게 뜬다(밤 자동 점검이 실패했거나 안 돈 것).
- **독립 검토(2026-11-18)** 반영: 전체 삭제 안전장치 · 전부 「확인 못 함」을 성공으로 적던 것 · 같은 기기 줄이 여럿일 때 사건이 수와 어긋나던 것 · 검사만 누르면 자동 점검 실패가 가려지던 것 · 기준이 다른 날끼리 빼던 전월·전년 대비 · 오류 글 이스케이프.
- 기준이 바뀐 날(일별 기록에 `active` 가 처음 생긴 날) 앞뒤로 숫자가 한 번 내려간다 — 화면에 그 날짜를 적어 둔다.
- 알 수 없는 것: 폰 설정에서 알림 권한만 끈 경우(앱이 알려 주지 않는다), 앱을 지운 직후(FCM 도 며칠 뒤에 안다).
- 시험: `local_server/scripts/test_subscriber_audit.js` (`verify_all.sh` SUITES 등록).
