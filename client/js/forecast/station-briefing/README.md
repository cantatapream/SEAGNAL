# station-briefing  `client/js/forecast/station-briefing/`

해양예보 탭(기상정보 > 특보 및 전망) 「🔭 기상청 해상 기상 전망」 바로 아래의 **「🧭 활동지점 안전 브리핑」 아코디언**이다.
파출소 관할 하나를 고르면 서버가 하루 세 번(08:00·17:30·23:00) + 특보가 바뀔 때 만든 그 관할의 해상·육상 안전 브리핑을 보여 준다.
요구사항은 `client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` §11, 서버 계약은 같은 폴더 `briefing.contract.md`.
파일별 상세(함수·데이터 흐름·주의사항)는 [station_briefing.guide.md](station_briefing.guide.md).

> ⚠**처음에는 관리자 기기에만 보인다**(서버 노출 기본값 「관리자에게만」). 일반 사용자 화면은 아코디언이 없는 지금 화면 그대로다.
> 노출 범위는 통합관리자 → AI → 「AI 브리핑」(`client/js/admin/admin_station_briefing.js`)에서 바꾼다.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `station_briefing.js` | 아코디언 본체 — 노출 판정·설정 흐름(관할 고르기·건너뛰기·숨김)·N 뱃지·바로가기·설정 팝업 칸 | `refreshDisplay`, `loadBriefing`, `renderSetup`, `finishSetup`, `renderConfirm`, `toggle`, `openSetup`, `updateBadge`, `openInRisk`, `renderSettings`, `applyVisibility`, `toast` |
| `station_briefing_render.js` | 브리핑 본문 그리기(서버 글은 textContent 로만) — 관리자 미리보기도 같은 렌더러 · 출처 한 벌 `SOURCES` | `render`, `summaryBodyV2`(§11.10.1 총평), `summaryBody`(§11.10 판), `legacyOverview`(옛 브리핑), `renderRest`, `timeBar`, `seaCard`, `landCard`, `tide`, `colorOf`, `dayWord`, `nextText` |
| `station_briefing_basis.js` | [기준 상세] 문안(위험예측 기준 상세 창 `RiskBasis.open('briefing')` 으로 연다) | (문자열 `RiskBasisContent.briefing`) |
| `station_briefing.css` | `.sb-*` 모양(바깥 아코디언·안쪽 칸·조석 게이지·기준 창은 기존 CSS 재사용) | — |

## 화면에서 찾아가는 법

해양예보 탭 → 「기상청 해상 기상 전망」 아래 「활동지점 안전 브리핑」(관리자 기기: 통합관리자 센터에서 관리자 모드 체크 + 관리자 기기 등록, 또는 관리자 로그인 토큰).
설정 팝업(오른쪽 위 ⚙) → 관심해역 탭 아래 「활동지점 안전 브리핑」 칸에서 표시/숨김·관할 설정.

## 로드 순서

`index2.html` 에서 `life_safety.js` 다음 — `station_briefing_render.js` → `station_briefing_basis.js` → `station_briefing.js`.
`station_briefing_basis.js` 는 `risk_basis_content.js`(RiskBasisContent 를 새로 만드는 파일)보다 **뒤**여야 문안이 덮이지 않는다.
CSS 는 `<head>` 의 `risk_forecast.css` 다음.

## 2단계 독립 검토 반영(2026-10-16) — 알아 둘 동작

- **위험예측 미리보기 잠금**: [위험예측에서 보기 ›]는 **관리자 모드일 때만** 위험예측 미리보기 잠금(10번 누름)을 푼다. 일반 기기는 잠금을 그대로 두고 「위험예측은 아직 미리보기 기능이라 이 기기에서는 바로 열 수 없습니다」 토스트만 띄운다.
  ⚠**브리핑을 일반 사용자에게 공개할 때 이 잠금을 어떻게 할지는 사용자가 따로 정할 문제**다(설계서 §11.9.1 A2).
- **노출 판정 다시 받기**: 10분마다(모든 기기) · 관리자 로그인·로그아웃·관리자 모드·관리자 기기 등록이 바뀔 때 바로(`admin.js` → `seagnal-admin-change` 사건) · 조회가 실패하면 직전 판정을 유지하고 5초·20초·60초 뒤 다시.
- **점검 차단**: 통합관리자 점검 트리 「특보정보 > 특보 및 전망 > 활동지점 안전 브리핑」(`station-briefing`)으로 이 아코디언만 막을 수 있다(index2.html featureMap·bodyMap).
- **설정 팝업 [관할 설정]**: 팝업에 저장하지 않은 다른 변경이 있으면 묻는다([확인] 저장하고 이동 / [취소] 팝업에 남기 — `settings.js settingsModalHasUnsaved`).
- **출처 한 벌**: 본문 꼬리 「출처」 줄과 [기준 상세] 출처 표는 `StationBriefingRender.SOURCES` 하나를 같이 쓴다 — 출처를 고칠 때는 그 배열만.
- **긴 본문**: 펼친 아코디언과 안쪽 칸은 높이 상한을 풀었다(`max-height:none` — 카드 최대치에서 아래가 잘리던 것).

## 「총평과 권고」 새 모양(2026-10-17 사용자 결정 — 설계서 §11.10)

- 육상(보일 때)·해상마다 **단계 배지 → 결론 한 줄(굵게) → (근거) 목록 → (권고) → (물때, 육상만) → AI 해설(있으면 「해설 · ChatGPT」)**.
  결론·근거·권고·물때는 서버가 만든 `briefing.summary`, 해설만 AI(`overview.land/sea`, 1~2문장). 종전 「근거 ▸」 접힘은 없앴다(근거가 늘 보인다).
- 틀(AI 없음·AI 실패)이면 해설 칸이 없고 작게 「AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.」
- `summary` 가 없는 브리핑(이 바꿈 전에 저장된 파일)은 종전 문단·「근거 ▸」 모양 그대로(`legacyOverview`).
- 관리자 「AI 브리핑」 탭(`client/js/admin/admin_station_briefing.js`)은 최근 3일 오류를 모두 목록으로 보이고 [복사](마크다운)·[md로 저장](`station_briefing_errors_YYYYMMDD_HHmm.md`)을 준다.
- **같은 날 후속 결정(설계서 §11.10.1)** — 순서가 **결론(육상·해상) → (기상) → (물때) → 육상 근거·권고 → 해상 근거·권고 → AI 해설**로 바뀌었다(`summaryBodyV2`, `[data-sb-part]` = conclusion·weather·tide·land·sea·commentary).
  (기상) = 가장 가까운 앞바다의 지방기상청 단기 해상예보 오전·오후 두 줄 + 출처, (특이사항) = 그 지방청 단기 전망에서 그날 것만 최대 3줄(서버 규칙 — AI 아님). 자료가 없으면 「기상예보 자료를 확인하지 못했습니다」.
  근거 줄의 예보·예측 값에는 「예상」(방문객 평소의 N배(예상) 등). `summary.weather` 가 없는 §11.10 판 브리핑은 `summaryBody`(물때가 육상 덩어리 안) 그대로.
- **같은 날 독립 검토 12건 반영(설계서 §11.10.2)** — (특이사항)은 원문 방향(높아짐·낮아짐)·지역·「(곳에 따라)」「(○○특보 가능성)」을 지키고, 가장 가까운 특보구역 줄을 먼저 넣는다.
  그날 토막이 있었는데 뽑지 못하면 「없습니다」 대신 「단기 전망에서 항목을 뽑지 못했습니다 — 원문(…)을 확인하세요」(`notesEmptyText`).
  가장 가까운 앞바다가 30km 넘게 멀면(울릉·흑산) 서버가 먼바다 예보로 바꾸거나 「가장 가까운 앞바다 특보구역(약 N km 떨어짐) 예보입니다」를 `weather.note` 로 주고 화면이 그대로 보인다(`[data-sb-wx-note]`).
  관리자 오류 마크다운은 이유 글의 역슬래시·세로줄·백틱·꺾쇠(< >)를 이스케이프한다(`admin_station_briefing.js errorsMarkdown`).

## 시험

`local_server/scripts/test_station_briefing_ui.js`(verify_all SUITES) — 실제 Chromium 으로 index2.html 전체를 띄워 일반·관리자 기기, 설정 흐름, 본문 상태(새 총평 모양·옛 브리핑 대체·「AI 해설 없음」), textContent, 바로가기, N 뱃지, [기준 상세], 관리자 「AI 브리핑」 탭(오류 목록 [복사]·[md로 저장] 포함)을 본다.
