# pc-layout — PC 화면(A안 · 지도 중심형)

## 이 기능은 무엇인가
넓은 PC 브라우저에서만 쓰는 **숨은 배치**다. 켜면 화면이
「위 막대(56px) · 왼쪽 통합 메뉴(280px) · 가운데 지도 · 오른쪽 칸(440px, 글자 크게 470px)」으로 바뀐다.
새 기능을 만든 것이 아니라 **지금 있는 요소를 PC 자리로 다시 놓은 것**이다(지점 창·통합 메뉴·특보 카드·뉴스 목록 전부 기존 것).
유일하게 새로 그리는 것은 「특보 및 전망」 가운데의 **특보 전용 지도**(`pc_alert_map.js`)다.

사용자 확정(원문): 「a안이 좋겠어 … 해양종합정보를 10회 터치하여야만 들어갈 수 있도록」 ·
「휴대폰에서는 표출하지말고 pc에서만 10회누르면 나타나는 것으로」 ·
「새모드는 저장하지 않음. 껐다 켜면 원래대로.(일반 사용자에게 영향 없도록)」 · (추가) 태블릿·터치 기기는 PC 로 보지 않는다.
설계 상세: `pc_layout.design.md`.

## 들어가는 법 · 나가는 법
- **조건**(전부 맞아야 한다 — `pc_layout.js _isPcDevice()`·`_canShow()` 한 곳):
  앱(Capacitor)이 아니다 · 터치가 안 되는 기기(`navigator.maxTouchPoints == 0`, `any-pointer: coarse` 아님) ·
  주 입력이 마우스(`hover: hover` + `pointer: fine`) · 창 폭 **1200px 이상** · 통합 메뉴 화면(`body.om-mode`).
- **들어가기**: 아래 「해양종합정보」 탭을 **3초 안에 10번** 누른다(누름 사이가 3초를 넘거나 다른 탭을 누르면 처음부터).
  조건이 안 맞으면 조용히 아무 일도 없다. 켜지면 「PC 화면으로 바뀌었습니다 · 새로고침(F5)하면 원래 화면으로 돌아갑니다」.
- **나가기**: 위 막대 오른쪽 끝 **[원래 화면으로]** · 같은 탭을 다시 10번 · 새로고침(F5).
  창을 1200 미만으로 줄이면 평소 화면으로 쉬었다가, 다시 넓히면 PC 화면으로 돌아온다(다시 누를 필요 없음).
- **저장하지 않는다** — `localStorage`·`sessionStorage`·주소·`history` 어디에도 남기지 않는다.

## 파일 구성
| 파일 | 하는 일 |
|---|---|
| `pc_layout.js` | 판정 · 10번 누름 · 켜고 끄기(`_apply`) · 새 요소 만들기(`_build`) · 요약 알약 베끼기 · 뉴스 새로 받기 · 특보 카드 → 지도 · ＋− |
| `pc_alert_map.js` | 특보 전용 지도 `window.PcAlertMap = { ensure, focus, refresh }` — 해양종합정보 지도와 상태를 나누지 않는다 |
| `pc_layout.css` | PC 배치 전부. **첫 규칙(새 요소 숨김) 한 줄 말고는 전부 `body.pc-mode` 아래** · `:root`·`@media`·`@keyframes`·`@font-face` 없음 |
| `pc_layout.design.md` | 설계(사용자 원문 · 판정식 · 칸 구성 · 합의 기록 · 시안과 달라진 것 · 하지 않는 것) |

로드 순서(`client/index2.html`): `ocean_menu.css` 다음 줄에 `pc_layout.css` · `ocean_menu.js` 다음에 `pc_alert_map.js` → `pc_layout.js`.
시험: `node local_server/scripts/test_pc_layout_ui.js` (verify_all SUITES 등록).

## 주요 함수
| 함수 | 하는 일 |
|---|---|
| `_isPcDevice()` · `_canShow()` | PC 기기인가 · 지금 보여 줄 수 있나(폭 1200 · `om-mode`) |
| `_onTabClick(e)` | 탭 줄 누름을 센다 — 페이지가 뜰 때 붙이는 유일한 리스너(막지 않는다) |
| `arm(toast)` · `disarm(toast)` | 켠다 · 끈다(안내 토스트 선택) |
| `_apply()` | `pc-mode === (켜 둠 && 보여 줄 수 있음)` 이 되게 붙이거나 뗀다 · 창 크기가 바뀔 때마다 |
| `_kick()` | resize 를 0ms·400ms 두 번 보낸다(지도 크기·탭 높이 값을 다시 맞춘다) |
| `_build()` | 처음 켤 때 한 번 — `#pc-pill`·`#pc-exit`·`#pc-side-hint`·`#pc-zoom`·`#pc-read-hint`·`#pc-news-refresh` 와 관찰자들 |
| `_copyPill()` | 「해역별 특보현황」 머리의 요약 배지를 위 막대 알약에 베낀다 |
| `_afterTab()` | 「특보 및 전망」이 보이면 `PcAlertMap.ensure()` |
| `_onAlertCardClick(e)` | 특보 카드를 누르면 `PcAlertMap.focus(해역)` |
| `PcAlertMap.ensure()` / `refresh()` / `focus(zone)` | 전용 지도 만들기·크기 맞춤 / 점검·특보 색 다시 맞춤 / 그 해역 부모 구역으로 이동 + 노란 테두리 |
| `window.PcLayout` | 시험·점검용 창구 `{ isArmed, isOn, arm, disarm }` |

## 기존 파일에 넣은 분기 (전부 `body.pc-mode` 일 때만 다르게 움직인다)
| 파일 | 넣은 것 |
|---|---|
| `ocean-map/map/ocean_map.js` 지도 클릭 | 「지점 창이 열려 있으면 다른 지점 무시」를 PC 화면에서는 건너뛴다(지도가 가려지지 않으므로) |
| `ocean-map/bottom-sheet/ocean_bottom_sheet1.js` `showOceanBottomSheet` | 같은 가드 — PC 화면이면 열린 창을 닫고 새 지점으로 다시 연다 |
| `ocean-map/warnings/ocean_warn_active3.js` | 색칠 스타일 본체를 `_styleAlways`(켜짐 여부 무관)로 이름을 바꾸고, `_styler` 는 「켜졌을 때만 `_styleAlways`」로 감쌌다 — 해양종합정보 지도 동작은 종전과 같다 |
| `ocean-map/warnings/ocean_warn_zone.js` | `OceanWarnZone.onlyFill`·`onlyStrokeAndText`·`loadFeatures()` 공개(주소 상수 `MAIN_URL`·`SUB_URL` 로 묶음) |
| `forecast/alerts/render.js` `createAlertElement` | 카드에 `data-zone`(해역 이름) |
| `ocean-map/menu/ocean_menu.js` | 코드 변화 없음 — `window.OceanMenu` 주석에 「PC 화면이 켤 때 `close()` 만 부른다」 |

## 수정 시 주의
- **꺼져 있을 때 0 영향**: 페이지가 뜰 때 붙이는 것은 탭 줄 리스너 하나. 요소·관찰자·나머지 리스너는 처음 켤 때 만든다.
  CSS 는 `body.pc-mode` 아래에만 쓴다(시험 18 이 막는다). JS 분기는 `document.body.classList.contains('pc-mode')` 로만.
- **기존 버튼을 프로그램으로 누르지 않는다**(`.click()` 금지) — 버튼이 스스로 저장·집계하므로 저장값이 새고 사용량이 두 번 센다.
- **새 단추가 부르는 것은 넷뿐**: `switchMainTab('weather-group')`(알약 — 그 함수가 점검 차단을 스스로 본다) · `NoticeHub._ptr.refresh()` · 지도 확대·축소 · `disarm`.
  설정·제보·로고(새로 받기)·AI 챗봇은 **기존 요소를 그대로** 쓴다 → 점검 차단(사람의 누름만 보는 `index2.html` 창 단계 가로채기)과 집계가 그대로 걸린다.
  `openChat`·`openSettingsModal`·`openReportModal`·챗봇 내부 객체를 PC 코드에서 부르지 않는다(시험 19).
- AI 챗봇·AI 연안 안전 브리핑의 **노출 조건을 바꾸지 않는다**. 새 집계 키를 만들지 않는다.
- **`#main-accordion-body` 에 `display` 를 쓰지 않는다** — 「해역별 특보현황」이 점검으로 막히면 그 몸통에 인라인 `display:none` 이 걸린다(`index2.html applyFeatureBlocks`). 덮으면 막은 목록이 PC 에서만 보인다(시험 13).
- 특보 전용 지도는 `weather-alert`·`ov-warn-zone`·`ov-warn-active`·`main-ocean` 중 하나가 막히면 구역을 그리지 않는다(관리자 기기 제외).
- **resize 를 두 번 보내는 까닭**: 한 번이면 끄거나 좁힌 뒤 `<html>` 의 `--main-tab-height` 가 탭 버튼 `transition`(.2s) 도중에 재여 48px 로 굳는다(실제 67px). `<html>` 의 그 값은 PC 코드가 건드리지 않는다.
- 「해역별 특보현황」 머리 높이는 강제할 수 없다(`settings.js` 의 전역 `height:auto !important`) — 배지가 많으면 두 줄. 그래서 `pc_layout.js` 가 머리 높이를 재어 `--pc-acc-h` 로 주고 몸통이 그 아래에서 시작한다.

## 알려진 한계
- 새로고침(F5)하면 꺼진다(「껐다 켜면 원래대로」). 자료는 로고를 누르면 새로 받는다(특보정보로 옮겨 간다).
- 「해양종합정보」 탭이 **점검으로 막혀 있으면 들어갈 수 없다**(사람의 누름이 창 단계에서 끊겨 세어지지 않는다).
- **터치 화면이 달린 노트북은 켜지지 않는다**(「터치 기기는 PC 로 보지 않는다」를 글자 그대로 따랐다 — 풀려면 판정식 한 줄).
- 인쇄용 배치는 없다(앱에 `@media print` 가 0건 — 고정 3칸은 첫 화면만 찍힌다).
- 안내 토스트는 바닥에서 68px 위에 뜬다(`<html>` 의 탭 높이 값을 읽는다 — 고치지 않았다).
- 지도를 더블클릭해 확대하면 지점 창도 함께 열린다(기존 동작).
- 「서버 연결 불가」 창이 떠 있을 때 뒤로가기는 새로고침이다(기존 동작).
- [보기] 화면에서 항행경보·출입통제·낚시금지·관제구역·항로 상세는 가운데 팝업, 위험지형·사고이력은 지도 말풍선 그대로다. 오른쪽 칸에는 위험예측·사고 통계·생활 지점 창만 온다(나머지 화면에서는 빈 안내만 보인다).
- **실제 자료가 든 화면은 확인하지 못했다**(개발 환경은 서버 자료가 없다): 지점 창에 값이 찼을 때의 폭 · 범례·시간 막대·천기 막대·태풍 패널·CCTV 창·항행경보 날짜 줄의 PC 자리 · 실제 특보구역 경계에서의 4층 색칠. 특보 카드는 가짜 특보 3건으로 400px 칸에 들어가는 것만 봤다(글자 보통·크게).
