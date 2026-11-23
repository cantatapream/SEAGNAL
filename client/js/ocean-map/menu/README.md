# ocean-map/menu — 해양종합정보 통합 메뉴(새 메뉴 화면)

## 이 기능은 무엇인가
해양종합정보 지도 오른쪽에 세로로 늘어선 버튼 줄을 **[메뉴] 버튼 하나 + 오른쪽 사이드바**로 바꾸고,
해양안전생활 탭의 화면(해양안전·해양생활 활동)도 그 사이드바에서 **[보기]** 로 여는 화면이다.
**2026-11-23 부터 앱이 뜨면 바로 이 화면이다**(사용자 「이제 트리거없이 메인화면에 그대로 반영되도록 하자」).
그 전(2026-11-22~23)에는 「해양종합정보」 탭을 10번 눌러야 켜지는 숨은 화면이었다 — 그 누름 장치는 없앴다.
코드 안의 이름 「새 모드」·`body.om-mode` 는 이 화면이 켜진 상태를 뜻한다.

## 화면에서 찾아가는 법
1. 아래 「해양종합정보」 탭.
2. 지도 오른쪽 위 **[전체 메뉴]** → 사이드바.
   - **즐겨찾기** — 줄 오른쪽 ☆ 를 누른 기능이 모인다(휴대폰에 저장).
   - **해양기상정보** — 스위치. 특보구역·현황 / 파고·파향 / 풍향·풍속 / 유향·유속 / 천기 는 **하나만** 켜진다.
     기상부이·해구기상·태풍(·CCTV)은 함께 켤 수 있다.
   - **해양안전정보 · 해양생활지수** — **[보기]**. 한 번에 하나만 열리고, 보는 동안 맨 위에
     「○○ 화면 표출 중 해양기상정보는 표시되지 않습니다. [끄기]」 줄이 뜬다.
3. 사이드바는 ✕ · 왼쪽 「접기」 손잡이 · 지도(바깥) 누르기 · 휴대폰 뒤로가기로 닫는다.

## 파일 구성
| 파일 | 하는 일 |
|---|---|
| `ocean_menu.js` | 앱이 뜰 때 새 메뉴 화면을 켜고, 사이드바·[메뉴]·안내 줄을 만들고 그린다. 기능은 **원래 버튼을 대신 눌러** 켠다 |
| `ocean_menu.css` | 새 메뉴 화면의 모양. **모든 규칙이 `body.om-mode` 아래** — 옛 화면(시험용)에 영향이 없어야 한다 |

## 만드는 방식 — 옮기지 않고 「대신 누른다」
- 사이드바의 스위치는 `#ocean-overlay-controls` 안 **원래 버튼의 `.click()`** 을 부르고, 켜짐 표시는 그 버튼의 `.active` 를 읽는다.
  원래 버튼 줄은 지우지 않고 `visibility:hidden` 으로만 감춘다.
- **[보기]** 는 지금의 해양안전생활 화면으로 **실제로 이동**(`switchMainTab`/`switchSubTab`)한 뒤 그 화면의 버튼을 눌러 준다.
  「기상정보를 숨겼다가 [끄기]에 되살리기」는 `life_safety.js` 가 원래 하던 일(`_suspendOceanOverlays`/`_restoreOceanOverlays`)이다.
- 보는 동안 사이드바 스위치를 바꾸면 `_pending` 에만 적어 두었다가, 해양종합정보 지도로 돌아온 직후 지도에 반영한다.

## 주요 함수
| 함수 | 하는 일 |
|---|---|
| `_setMode(on)` | 새 모드 켜고 끄기(`body.om-mode`) |
| `_toggle(id)` | 스위치 누름 — 함께 못 켜는 묶음 처리, [보기] 중이면 미뤄 둠 |
| `_lockNorth(on)` | 새 모드에서는 「진북 정렬」 버튼을 감추고 지도를 늘 진북 고정으로 둔다(끄면 켜기 전 상태로 · 고정은 저장하지 않음) |
| `_setLive(id,on)` | 원래 버튼을 대신 눌러 지도에 반영(특보구역·현황은 두 버튼, 천기는 버튼 줄) |
| `_arbitrateBasemap()` | 배경지도 — 태풍=세계지도 > 해구기상=기본맵 > 파고·풍향·유향·특보구역·현황=해안도 > 원래 배경 |
| `_openView(id)` / `_closeView()` | [보기] / [끄기] |
| `_pressSafety(def)` · `_setAccident(def)` | 해양안전 지도에서 그 화면의 버튼만 켜고, 사고정보는 분석/현황·선박/인명까지 맞춤 |
| `_afterNav(pre)` | 탭이 바뀔 때마다 우리 상태를 실제 화면에 맞춤(다른 길로 들어온 경우 포함) |
| `_probeWx()` · `_pickWx(id)` | 천기 버튼별 자료 유무 확인 · 버튼 누름(자료 없으면 알림) |
| `_fetchBeach()` · `_anyBeachOpen(json)` | 개장 해수욕장 유무(해양종합정보 탭에 들어올 때 받아 둠) |
| `window.OceanMenu` | 시험·점검용 창구(`setMode`·`state` 등) |

## 기존 파일에 넣은 「새 모드」 분기 (전부 `body.om-mode` 일 때만)
| 파일 | 분기 |
|---|---|
| `ocean-map/map/ocean_map.js` `switchBaseLayer` | 배경이 해안도가 아니어도 파고·풍향·유향을 끄지 않는다 |
| `ocean-map/warnings/ocean_warn_active3.js` | 경보 빗금을 ✕ 격자로(범례는 `ocean_menu.css`) |
| `ocean-map/warnings/ocean_warn_active5.js` `tryHandleClick` | 특보 상자를 띄우지 않고 해점 바텀시트로 넘긴다 |
| `marine-life/safety/life_safety.js` | 관제구역 + 항로·해역은 서로 끄지 않는다(`_isOmPair`) · `_lsDropParkedSafety` |
| `marine-life/safety/vts_zone.js` · `seaway.js` | 관제구역 색을 청록으로 · 항로 이름 글자를 그리지 않는다 |
| `marine-life/safety/accident_info.js` | 「선택 초기화」는 필터가 걸렸을 때만 |
| `typhoon/ocean_typhoon.js` · `layers/shrt_forecast_layer.js` · `shared/ui/locate_toast.js` | 읽기 통로 추가(`hasActive`·`_shrtForecastHasFrames`·`showLocateStyleNotice`) — 평소 화면 동작은 그대로 |

## 관리자 점검(선택 차단)과 사용량 통계 (2026-11-23)
- **점검**: 사이드바 줄마다 관리자 점검 목록의 id 가 있다(`BLOCK_IDS` — `admin.js featureTree` 와 같은 이름).
  막힌 줄은 회색 + 「점검 중」으로 보이고, 눌러도·미뤄 둔 값을 반영할 때도 켜지지 않는다(`_blocked`).
  사이드바는 숨은 원래 버튼을 프로그램으로 대신 누르기 때문에, 「사람이 누른 것만 막는」 기존 차단(index2.html)만으로는 뚫렸다.
  이미 켜져 있는 기능을 강제로 끄지는 않는다(옛 화면의 차단과 같다) — 끄는 것은 막지 않는다.
  줄을 더하면 `BLOCK_IDS` 와 `featureTree` 에 같이 넣는다(`test_maintenance_tree.js` 가 빠진 것을 잡는다).
- **통계**: 스위치를 켜면 1건(끌 때는 안 셈). 원래 버튼이 스스로 세는 것(파고·풍향·유향 등)은 그 버튼이 세고,
  스스로 안 세는 것(특보구역·현황·기상부이·해구기상·CCTV)과 [보기] 중 미뤄 둔 스위치는 `_countSwitch` 가 센다.
  [전체 메뉴] 열기·즐겨찾기 담기·사고 세 갈래도 여기서 센다. 이름표는 `shared/utils/usage_keys.js`(「묶음 · 기능 · 한 일」).

## 수정 시 주의사항
- **옛 화면이 달라지면 안 된다**(옛 화면 시험이 밑바탕 기능을 지킨다). CSS 는 `body.om-mode` 아래에만, JS 분기는 `document.body.classList.contains('om-mode')` 로만 건다.
- `#ocean-overlay-controls` 의 버튼 id·`data-layer`·`data-shrt` 가 바뀌면 `SWITCHES`/`VIEWS`/`WX_SUBS` 도 같이 고친다.
- 사고정보의 분석/현황 단추는 **이미 그 모드면 누르지 않는다** — 같은 모드를 다시 누르면 필터 줄이 접힌다.
- 로드 순서: `life_safety.js` **다음**(그 파일이 감싼 탭 전환 위에 한 겹 더 얹는다).
- 시험: `NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_ocean_menu_ui.js` (verify_all SUITES 등록).
- **옛 화면은 시험에서만 뜬다.** 페이지가 뜨기 전에 `window.__SEAGNAL_OLD_OCEAN_SCREEN = true` 를 넣으면 새 메뉴 화면을 켜지 않는다
  (앱 화면에는 이 값을 넣는 곳이 없다). 쓰는 시험: `test_overlay_solo` · `test_life_safety_tab_keep` · `test_risk_coast_day`.
  새 화면은 옛 버튼·옛 화면을 대신 누르는 구조라, 이 시험들이 그 밑바탕을 지킨다.
- 남은 정리(아직 안 함): 옛 버튼 줄·해양안전생활 탭 마크업을 실제로 걷어 내기 · 배경(§7)을 `style.css` 로 옮기기.
