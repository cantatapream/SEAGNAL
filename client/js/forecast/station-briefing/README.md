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
| `station_briefing.js` | 아코디언 본체 — 노출 판정·설정 흐름(관할 고르기·건너뛰기·숨김)·N 뱃지·바로가기·설정 팝업 칸 | `refreshDisplay`, `loadBriefing`, `renderSetup`, `finishSetup`, `renderConfirm`, `toggle`, `openSetup`, `updateBadge`, `openInRisk`, `renderSettings` |
| `station_briefing_render.js` | 브리핑 본문 그리기(서버 글은 textContent 로만) — 관리자 미리보기도 같은 렌더러 | `render`, `timeBar`, `seaCard`, `landCard`, `tide`, `colorOf` |
| `station_briefing_basis.js` | [기준 상세] 문안(위험예측 기준 상세 창 `RiskBasis.open('briefing')` 으로 연다) | (문자열 `RiskBasisContent.briefing`) |
| `station_briefing.css` | `.sb-*` 모양(바깥 아코디언·안쪽 칸·조석 게이지·기준 창은 기존 CSS 재사용) | — |

## 화면에서 찾아가는 법

해양예보 탭 → 「기상청 해상 기상 전망」 아래 「활동지점 안전 브리핑」(관리자 기기: 통합관리자 센터에서 관리자 모드 체크 + 관리자 기기 등록, 또는 관리자 로그인 토큰).
설정 팝업(오른쪽 위 ⚙) → 관심해역 탭 아래 「활동지점 안전 브리핑」 칸에서 표시/숨김·관할 설정.

## 로드 순서

`index2.html` 에서 `life_safety.js` 다음 — `station_briefing_render.js` → `station_briefing_basis.js` → `station_briefing.js`.
`station_briefing_basis.js` 는 `risk_basis_content.js`(RiskBasisContent 를 새로 만드는 파일)보다 **뒤**여야 문안이 덮이지 않는다.
CSS 는 `<head>` 의 `risk_forecast.css` 다음.

## 시험

`local_server/scripts/test_station_briefing_ui.js`(verify_all SUITES) — 실제 Chromium 으로 index2.html 전체를 띄워 일반·관리자 기기, 설정 흐름, 본문 상태, textContent, 바로가기, N 뱃지, [기준 상세], 관리자 「AI 브리핑」 탭을 본다.
