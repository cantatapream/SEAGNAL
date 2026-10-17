# alerts  `local_server/js/forecast/alerts/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `alert_history.js` | 특보 히스토리 팝업 모달 (해역별 통보문 이력 조회) | `createZoneBulletinItem`, `formatBulletinTime`, `createHistoryItem`, `loadBulletinContent`, `renderBulletinContent`, `renderFallbackContent` |
| `data.js` | 데이터 수집(fetchAllData), 부이 데이터, API 상태 관리 | `fetchAllData`, `loadBackgroundData`, `refreshAlertData`, `flattenAlertsData`, `recursiveFind`, `_isExactSingleTime` |
| `marine.js` | 해구별 기상정보 모달, 해양 차트 렌더링 · 소해구(「233-5」)는 소해구 예보 값으로 바꿔 그림 | `parseMarineZoneData`, `_tmKst`, `formatMarineTime`, `trimPastMarineRows`, `_mmisFctTmToUtcKey`, `_kstTmToMs`, `applySmallZoneForecast` |
| `render.js` | 메인 UI 렌더링 (renderApp, createAlertElement) · 「해역별 특보현황」 관심해역 ⚙ | `renderApp`, `createAlertElement`, `syncAlertZoneGear`, `openAlertZoneSetup` |
| `render_coastal.js` | 연안 구역 렌더링, 부이 데이터 표시, 로딩/시간 업데이트 | `displayBuoyInfo`, `createDataBox`, `formatBuoyTime`, `createCoastalElement`, `updateLoading`, `toggleSection` |
| `zone_avg.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `onReady`, `_flushReady`, `_normalizeName`, `_buildNameIndex`, `init`, `_parseTm` |

## 「해역별 특보현황」 관심해역 ⚙ (2026-10-17 사용자 확정)

> 사용자 원문: *"해역별 특보현황에서도 동일하게 오른쪽 끝에 설정버튼을 두고, 그 설정 버튼을 누르면 팝업으로 2, 3, 4 이미지 순으로 이게 나오고 선택될 수 있도록 하자. 그리고 그 설정 완료 후 언제 든 메인화면의 설정버튼 - 관심해역 탭에서 변경할 수 있다고 남겨두고 해역별 특보현황 아코디언 오른쪽에 있던 설정버튼은 자연스럽게 사라질 수 있도록 해줘. 지금처럼. 아코디언에 설정버튼 반영방법은 이미지 5처럼 반영해줘(기상청 해상 기상 전망도 마찬가지로)"*
> (이미지 2·3·4 = 온보딩 `onboarding/zone_setup.js` 의 안내 → 해역 고르기 → 지도에서 구역 고르기, 이미지 5 = 「활동지점 안전 브리핑」 머리 오른쪽 끝 ⚙)

- 자리: `#main-accordion-header` 오른쪽 끝(`.accordion-head-right` 묶음 = 상태 배지 `.header-status` + ⚙ `#alert-zone-settings-btn`). 모양은 `style.css .accordion-gear-btn`(브리핑 ⚙ 인라인 값을 옮김).
- 보이는 때: **관심해역을 아직 안 골랐을 때만** — `UserSettings.hasInterestZones()` 가 거짓(제목이 「관심해역별」로 바뀌는 규칙과 같음). `renderApp()` 이 그릴 때마다 `syncAlertZoneGear()` 로 맞춘다(설정 [저장]·온보딩 저장 뒤 모두 `renderApp` 이 불린다).
- 누르면 `window.openZoneSetup(끝나면, {testFlag:false})` — 온보딩 화면을 「시험 모드」 딱지 없이 그대로 연다. [건너뛰기] = 닫기만(⚙ 그대로).
- 마치면(구역을 하나라도 골라 저장됐을 때): zone_setup 이 설정 [저장]과 같은 뒷정리(푸시 대상·특보·기상현황·예보 다시 그리기)를 하고, 아래쪽 안내 띠 4초 「관심해역은 언제든 메인 화면 설정 ⚙ → 관심해역 탭에서 바꿀 수 있습니다.」(설정 창 제목 「설정」·탭 「관심해역」 그대로) → ⚙ 가 0.4초 흐려지며 사라짐(움직임 줄이기 설정이면 바로).
- 「지금처럼」 확인: 종전 온보딩 저장 뒤에는 안내 띠가 **없었다**(zone_setup `_save` 는 다시 그리기만). 이번 안내 띠는 새로 넣은 것이고, 모양은 `settings/zone_guide.js` 의 「언제든 설정에서 해역을 변경할 수 있어요」 띠와 같다.
- 시험: `local_server/scripts/test_forecast_gear_ui.js`.

## 해구 기상전망 창 — 소해구 예보 (2026-10-17, 설계서 `ocean-map/coastal-risk/coastal_safety_forecast.design.md` §11.10.18)

> 사용자 원문: *"사용자가 확대해서 소해구를 클릭했을 때는 … 이 API를 통해서 해당 소해구의 정보를 요청해서 받아오면 될것 같거든"*

- 대해구(「233」)를 누르면 종전 그대로 — `/api/marine-zone-forecasts/233` 한 번.
- 소해구(「233-5」)를 누르면 ① 종전처럼 대해구 233 값으로 바로 그리고 표 위에 안내 한 줄 「대해구 233 예보로 표시 중」
  ② `applySmallZoneForecast` 가 `/api/marine-small-zone-forecasts/233` 의 `data['5']` 를 받아 **풍속·유의파고·파주기·파향·풍향** 칸과 그래프를
  시각(`tm`)마다 소해구 값으로 바꿔 다시 그리고 안내 줄을 지운다(옆으로 밀어 둔 자리는 유지). **시정은 지금 처리 그대로**(시정 API).
- 받지 못하면(404·502·끊김) 값은 대해구 그대로, 안내 줄 「소해구 예보를 받지 못해 대해구 233 예보로 표시합니다」.
  → 2026-10-18 해구 표기(사용자 *"전체적으로 대해구 ## 이렇게 표현하지말고 ##해구 이런식으로 … 소해구는 ##-#해구"* — coastal_safety_forecast.design.md §11.10.22 A): 안내 글은 「233해구 예보로 표시 중」·「소해구 예보를 받지 못해 233해구 예보로 표시합니다」·「233-1해구 예보 값이 없어 233해구 예보로 표시합니다」.
  그 소해구 값이 모두 비었으면(육지 소해구 — 기상청이 -999 를 준다, 예: 233-1·233-2) 「소해구 233-1 예보 값이 없어 대해구 233 예보로 표시합니다」.
  어느 한 시각만 비면 그 칸은 「-」(대해구 값과 섞지 않는다).
- 창이 닫히거나 다른 해구로 바뀐 뒤 늦게 온 응답은 버린다(`window._marineZoneRequestId` — 시정 병합과 같은 방식).
- 서버: `local_server/services/smallzone_forecast.js`(기상청 API허브 `marine_small_zone.php`) · 라우트 `routes/weather.js`.
- 시험: `local_server/scripts/test_marine_smallzone_ui.js`(이 창) · `test_smallzone_forecast.js`(서버).

## 설계 문서 (이 폴더의 `.design.md`)

| 문서 | 내용 | 언제 읽나 |
|------|------|-----------|
| `mmis_history.design.md` | **특보 시스템의 단일 권위 문서.** MMIS 엔드포인트 메커니즘(§2) · 시나리오 상태머신(§4) · 사용자 표출 정책(§5) · **시행착오 timeline(§6)** · 현재 상태(§7) · 부록·용어집(§8) | 특보 관련 코드를 건드리기 전에 **반드시**. 특히 §7 은 현재 운영 상태의 유일한 권위 |
| `child_confirm.design.md` | 자식해역(연안바다·평수구역) **"확정 후 발사"** 설계안 — 관찰창 규칙·이벤트별 발사 정책·사용자 확정 사항(원문 인용 포함) | 자식 한정사·GAP 구간·푸시 발사 시점을 건드릴 때 |
| `fmttime_fix.design.md` | 시각 표기(`formatWarningTime`) 정정 이력 | 시각 포맷을 건드릴 때 |

### 자식해역 오표기 — 반복 사고이므로 먼저 볼 것

`(모든 평수구역/연안바다 포함)` 같은 자식 한정사 오표기는 **6회 재발**했다(6/2·6/19·6/20·7/14·7/18·8/8).
매번 증상이 나온 *경로*만 막고 *집계 기준*을 안 건드려서 수렴하지 않았다.

- 최종 해법 → `mmis_history.design.md` **§7.7.26**(자식 정합 필터) · **§7.7.27**(자식 확정 관찰창)
- 무엇이 왜 틀렸는지 → 같은 문서 **§6.8** (오진 3연속 · 상한 2회 삽입·철회 · 새 게이트가 기존 디바운스를 먹은 건 · 대기 상태 도입의 부작용 · 사용자 의도 왜곡 · 검증 게이트 공백)
- 핵심 원칙 — **모르는 것을 지어내서 메우지 않는다. 모르면 기다린다. 기다려도 없으면 없는 것으로 한다.**

## 회귀 테스트

이 폴더의 표출·푸시 정책은 서버 쪽 스위트가 지킨다. **모두 `scripts/refactor/verify_all.sh` 의 `SUITES` 배열에 등록돼 있어야 돌아간다** — 등록 누락이 위 5회 재발의 근본 조건이었다.

| 스위트 (`local_server/scripts/`) | 지키는 것 |
|---|---|
| `test_child_relevance.js` | 자식 정합 필터 — "이번 특보에 해당하는 자식"만 집계 |
| `test_child_confirm.js` | 자식 확정 관찰창 — 대기·재관찰·만료·폐기·복원 |
| `test_parent_release_debounce.js` | 부모 해제 디바운스 — 발효중 해역이 사라졌을 때 1분 30초 관찰 |
| `test_child_unknown_gate.js` | 자식 정보 '미상' 게이트 — 모르면 침묵 |
| `test_ef_exact_refine.js` | 범위형 → 정확시각 정밀화 통지 |
| `test_cancel_verdict_room.js` | 예비취소 판정 보류실 |
| `test_push_pagination.js` | 푸시 본문 분할 |
| `test_bulletin_cancel_scanner.js` | 통보문 취소 스캐너 |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
