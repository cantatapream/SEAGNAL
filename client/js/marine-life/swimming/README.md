# swimming  `client/js/marine-life/swimming/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).

## 이 기능은 무엇인가

해수욕 지수(국립해양조사원 fcstBeachv2 — 전국 해수욕장 파고·수온·기온·풍속 기반 5단계 종합지수)를
스킨스쿠버(`scuba/scuba.js`)와 동일한 지도형(마커+바텀시트) UI로 보여준다.
전에는 `#swimming-section` 이 "해수욕 지수는 개장기간에 제공됩니다" 안내문만 있는
빈 화면이었으나, 이 폴더가 실제 데이터 연동을 담당한다.

## 화면에서 찾아가는 법

해양생활 탭 → 해수욕 서브탭. (해양안전생활 시험 화면의 "해양생활" 하위탭 오른쪽 레일
"해수욕" 버튼도 같은 `#swimming-section` 을 재사용 — `marine-life/safety/life_safety.js` 참고.)

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `swimming.js` | 해수욕 지수 프론트엔드 전체 로직 (지도 초기화, 마커 렌더링, 바텀시트) | `initSwimmingMap`, `getSwimmingMap`, `_renderMarkers`, `_openBottomSheet`, `_buildTimeBlock` |

## 데이터 흐름

`local_server/scheduler.js` 의 `collectSwimmingIndex()` 가 fcstBeachv2 API를 매일
09:10/09:40 KST 에 수집 → `swimming_index.json` 저장 → `dataCache.swimmingIndex` →
`GET /api/swimming-index`(`routes/fishing.js`) → 이 파일이 fetch.

## 연계 파일

| 대상 | 무엇을 |
|------|--------|
| `index2.html` | `#swimming-section` 내 `#swim-*` ID들, `.fishing-*` 스타일(스킨스쿠버와 공유) |
| `routes/fishing.js` | `GET /api/swimming-index` |
| `forecast/alerts/marine.js` | `_onSectionActivated('swimming-section')` 시 `initSwimmingMap()` 호출 |
| `marine-life/safety/life_safety.js` | `ACTIVITIES` 목록의 `swimming-section` 항목이 `getSwimmingMap()` 을 통해 배경지도·위치 이어받기 |

## 수정 시 주의사항

- 데이터 구조·필드명은 스킨스쿠버(`scuba/scuba.js`)와 다르다 — 해수욕은
  `totalIndex`/`maxWvhgt`/`avgWtem`/`avgArtmp`/`maxWspd`/`opnStat`(개장상태) 필드를 쓴다
  (유속·물때 없음).
- 로드 순서: `scuba.js` 다음 · `life_safety.js` 이전 (marine-life 그룹 유지).
