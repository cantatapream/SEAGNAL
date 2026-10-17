# 활동지점 안전 브리핑 — 화면 가이드 (`station_briefing*.js`)

## 이 기능은 무엇인가
파출소 관할 하나의 바다(해상)와 해안 관광지·위험구역(육상)을 서버 규칙으로 판단한 브리핑을 보여 주는 아코디언이다.
판단은 전부 서버(`local_server/services/station_briefing_rules.js`)가 하고, 「총평과 권고」의 결론·근거·권고·물때(`summary`)도 서버가 만든다. AI 는 그 아래 짧은 해설(육상·해상 각 1~2문장)만 쓴다(2026-10-17 — 설계서 §11.10). 화면은 받은 것을 옮기기만 한다.

## 화면에서 찾아가는 법
- 해양예보 탭 → 「🔭 기상청 해상 기상 전망」 바로 아래 「🧭 활동지점 안전 브리핑」(노출 판정 display:true 일 때만).
- 설정 팝업(오른쪽 위 ⚙) → 관심해역 탭 맨 아래 칸.
- 통합관리자 → AI → 「AI 브리핑」(관리자 설정 — `client/js/admin/admin_station_briefing.js`).

## 데이터 흐름
0. 설정 화면 「지도에서 선택하기」에서 해역을 처음 누르면 `GET /api/station-briefing/areas`(관할 폴리곤·해역 — 같은 노출 판정·같은 관리자 정보, 한 번 받으면 다시 묻지 않음). 해역 규칙은 README 「관할 고르기 탭 두 개」·계약 §1.1b.
1. 시작(DOMContentLoaded) → `GET /api/station-briefing/stations` — 관리자 정보는 특보 예측(`advisory_prediction.js _adminAuth`)과 같은 방식:
   관리자 모드(`seagnal_admin_mode`)일 때만 `push_token` 을 쿼리 `adminToken` 으로, 로그인 토큰(`seagnal_admin_token`)을 `X-Admin-Token` 헤더로.
2. `display:false` → 머리·몸 `display:none` 그대로(일반 화면 변화 없음). `display:true` → 보이고, 고른 관할이 있으면
   `GET /api/station-briefing?station={key}&day=auto` → `StationBriefingRender.render`.
3. 10분마다 노출 판정부터 다시 받고(모든 기기 — 「노출 안 함」 전환이 관할 미설정 기기에도 반영), 보임이면 브리핑도 받는다. 접었다 펼 때 10분이 지났으면 다시 받는다(판은 하루 세 번 + 특보 변경 때만 바뀐다).
4. 노출 판정 조회가 실패하면 직전 판정을 유지하고 5초·20초·60초 뒤 다시 묻는다(그 뒤는 10분 주기). 관리자 상태가 바뀌면(`admin.js` 의 `seagnal-admin-change` 사건 — 로그인·로그아웃·관리자 모드·관리자 기기 등록) 바로 다시 받는다.

## 저장(이 기기 — localStorage `seagnal_station_briefing_v1`)
`{station, name, office, seaOnly, showSea, showLand, hidden, seen:{관할: 마지막으로 펼쳐 본 generatedAt}}` — 관심해역(`weatherAppSettings_v1`)·지방청(`officeManualSettings`)과 같은 관례.
저장소가 막혀 있으면 기본값으로 동작한다(그때는 매번 설정 전 상태).

## 설정 흐름(§11.2 + §11.6 Q3)
| 상황 | 화면 |
|---|---|
| 관할 없음 | 「활동지점이 설정되지 않았습니다」 + [설정하기] |
| [설정하기]·⚙ | 고르기 탭 두 개(`station_briefing_picker.js` — 2026-10-17): 「지도에서 선택하기」(해역 단추 4개 → 그 해역 관할 폴리곤 지도, 눌러 고르기) · 「파출소로 선택하기」(지방청 → 해양경찰서 → 파출소 아코디언, 남항 두 곳은 경찰서로 구분, 「해상만」 표시, 이름 찾기 — 찾으면 맞는 묶음 저절로 펼침) · 「선택: …」 줄 · 해상/육상 보기 칸(해상만 관할은 육상 칸 끔) · [저장] [건너뛰기] ([취소] — 이미 설정했을 때) |
| [건너뛰기] 또는 관할을 골랐지만 해상·육상 모두 끔 | 「해상·육상 모두 설정하지 않았습니다 — 이 아코디언을 더 이상 표시하지 않을까요?」 [예, 표시하지 않기] [아니요] |
| 예 | 숨김(`hidden:true`) + 「오른쪽 위 설정(⚙) 버튼에서 언제든 다시 표시할 수 있습니다」(`showSeagnalModal`) |
| 설정 팝업 칸 | 「해양예보 탭에 표시」 스위치 · 지금 관할 · [관할 설정](팝업을 닫고 해양예보 탭에서 고르기 화면) — **누르는 즉시 적용**(팝업 [저장]·[취소] 스냅샷과 따로). 팝업에 저장하지 않은 다른 변경이 있으면 [관할 설정]이 묻는다([확인] 저장하고 이동 / [취소] 남기 — `settings.js settingsModalHasUnsaved`) |

## 본문 칸(§8 뼈대·안 A + 해상 시간 막대)
| 칸 | 내용(서버 필드) |
|---|---|
| 머리 | 관할·경찰서, 「10월 17일(토) 브리핑 · 08:00 판 · 생성 시각」, [기준 상세] |
| ① 총평과 권고 | **§11.10.1(`summary.weather` 있음)**: `[data-sb-part]` 순서 — `conclusion`(육상·해상 단계 배지 + 결론 `summary.*.headline`, 해상 분석 단계가 더 높으면 `[data-sb-level-note]`) → `weather`(「(기상) 구역」 + `rows` 오전·오후(`.sb-wx-rows`) + `source` · 「(특이사항)」 `notes`(`.sb-wx-notes`) + `notesSource`, 자료 없으면 `[data-sb-wx-missing]` 「기상예보 자료를 확인하지 못했습니다」 · 특이사항이 비면 `[data-sb-wx-notes-empty]` — `notesFound` 면 「단기 전망에서 항목을 뽑지 못했습니다 — 원문(…)을 확인하세요」(`unparsed`), 아니면 「…없습니다」(`none`) — 글은 `notesEmptyText` · 앞바다가 30km 넘게 멀면 `[data-sb-wx-note]` 에 서버 `weather.note`(§11.10.2)) → `tide`(「(물때)」 `summary.tide` + §11.10.3 「(고립 주의)」 `[data-sb-isolation]` — `summary.isolation` 이 있을 때) → `land`·`sea`(`[data-sb-summary]` — 「(근거)」·「(권고)」, 해상 근거 줄은 `summary.sea.detail` 에 따라 ▸ 지도 펼침·풀이, 해상 근거 끝에 지금 밀집 `li.sb-now`) → `commentary`(「해설 · ChatGPT · 육상/해상」, 틀이면 없음) · 작게 `[data-sb-source]`. **§11.10 판(summary 만)**: 육상(보일 때)·해상마다 `[data-sb-summary]` 덩어리: 단계 배지(육상 `land.level`·해상 `sea.overviewLevel`) → 결론 `summary.*.headline`(굵게 `.sb-headline`) → 「(근거)」 `basis[]`(`.sb-sum-basis`) → 「(권고)」 `advice` → 「(물때)」 `tide[]`(육상만) → AI 해설 `overview.land/sea`(`[data-sb-commentary]`, 이름표 「해설 · ChatGPT/Gemini」 — 틀이면 없음). 해상 분석 단계(`sea.level`)가 더 높으면 해상 덩어리에 한 줄(`[data-sb-level-note]` — `levelNoteText`) · 지금 밀집(`now.text`, 오늘 판만) · 작게(`[data-sb-source]`): AI 해설 표시 또는 「AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.」. **`summary` 가 없는 옛 브리핑**은 종전 모양(육상/해상 문단 `[data-sb-overview]` · 근거 ▸ · 틀 문장 표시) — `legacyOverview` |
| ② 특별 상황 | `special[]` 제목 + 두 줄(해제 예고·예비·이미 해제 — 기상청 시각 그대로) |
| ③ 해상 분석 | 단계·출처, 검토 칸 수·관심 이상 칸 수(§11.10.3 부터 칸 = 해역 묶음 `reviewedRegions`, 해양사고 위험예보만 위험 단계인 해역 수 · 카드 10곳 넘으면 「카드는 단계 높은 순 10곳까지」), 빠진 자료(`sea.missing`·`missingSlots`), 해구 흐름(`sea.weather.text`), **시간 막대**(`timeBar` — 칸 색 = 단계, ⚑ = 사건, 누르면 설명, 보는 시각에 끝난 칸은 흐리게 `.sb-slot-past`), 해역 카드(`cards` — [특성]·[오늘 예상]·틀 문장·[위험예측에서 보기 ›]) |
| ④ 육상 분석 | 단계·출처, 검토 관광지 수, 관광지 카드(`land.cards`), 「상시 위험 장소」 접힘(`land.constant`). 해상만 관할은 `seaOnlyReason` 한 줄 |
| ⑤ 조석 | 해양종합정보 조석 게이지(`OceanSheet.tideGaugeHtml` — 바텀시트 `renderTideData` 와 같은 함수) + 밀물·잠기는 바위 문구(`tide.text`) |
| ⑥ 꼬리 | 기준 시각·다루는 시간·출처(`SOURCES` — [기준 상세] 출처 표와 같은 배열)·「참고 정보이며 안전을 보장하지 않습니다」 |
| 브리핑 없음 | 「아직 이 관할의 브리핑이 없습니다」 + `nextExpectedAt`(이미 지난 시각이면 「다음 브리핑을 준비 중입니다(… 시작)」, 없으면 정시 안내) · `fallback` 이면 「내일 브리핑이 아직 없어 오늘 브리핑」 |

**단계 색**: 위험예측 4색(`RiskFormat.BAND_COLORS` 평소 수준 초록 · 다소 높음 노랑 · 높음 주황 · 매우 높음 빨강)을 브리핑 단계 0~3(평소 수준·관심·주의·경계 필요)에 순서대로. 「확인 불가」는 회색 `#64748b`.

## 바로가기([위험예측에서 보기 ›], §11.4)
`openInRisk(target)` → (위험예측 미리보기 잠금이 걸려 있고 관리자 모드가 아니면 탭을 옮기지 않고 토스트로 끝) → `switchMainTab('ocean-life-group')` · 해양안전이 아니면 `switchSubTab('ocean-safety-section')` → 450ms 기다림
(`life_safety.js _enterSafety` 의 200ms 뒤 지도 준비·`_unparkSafety` 가 끝나게) → `RiskForecast.openAt(target)`(risk_forecast.js — 관리자 모드일 때만 미리보기 잠금 해제, 꺼져 있으면 위험예측 버튼 click, `goTo`).
실패(해양안전으로 못 옮김·연안 날짜가 위험예측 날짜 목록에 없음·관광지 표에 없음)는 토스트(`_showOceanToast`)로 알린다 — 다른 날짜를 조용히 열지 않는다.
- 해역: `{kind:'marine', id: link.gridId||'point', location:{lon,lat}, t: link.t}` — 해상 층 켜고 그 시각(지난 시각이면 지금) → 칸 선택·시트·지도 이동.
- 관광지: `{kind:'coast', id: link.spotId, date: link.date, location}` — 그 날짜(오늘이면 지금) → 관광지 시트.

## N 뱃지(§11.3)
`briefing.trigger.kind === 'warning'`(특보 변경 판)이고 이 관할의 `seen` 이 그 `generatedAt` 과 다르면 머리에 `.new-badge`(공지사항과 같은 것). 펼치면 `seen` 에 기록하고 지운다.

## 주요 함수
| 함수 | 파일 | 하는 일 |
|---|---|---|
| `refreshDisplay` | station_briefing.js | 노출 판정·관할 목록 → 보임 결정 → 본문 |
| `loadBriefing` | station_briefing.js | 관할 브리핑 받기(day=auto) |
| `renderSetup`·`finishSetup`·`renderConfirm` | station_briefing.js | 설정 흐름(고르기 칸은 picker 에 맡기고 `choose`·`sync` 로 선택을 받는다) |
| `mount`·`destroy` | station_briefing_picker.js | 고르기 탭 두 개 만들기 · 지도 정리(`renderBody` 가 화면을 바꿀 때마다 부름) |
| `mapPanel`·`drawMap`·`zoneStyle`·`loadAreas` | station_briefing_picker.js | 해역 단추 → 관할 폴리곤 지도(온보딩 `zone_setup.js` `_makeMap`·`_zoneStyle` 과 같은 방식·같은 색) · 구역 한 번 받기 |
| `listPanel` | station_briefing_picker.js | 지방청 → 해양경찰서 → 파출소 아코디언 + 찾기(맞는 묶음 펼침) |
| `updateBadge`·`markSeen` | station_briefing.js | N 뱃지 |
| `openInRisk` | station_briefing.js | 바로가기 |
| `renderSettings` | station_briefing.js | 설정 팝업 칸(settings.js `openSettingsModal` 이 부름) |
| `render` | station_briefing_render.js | 본문 전체(관리자 미리보기도) |
| `summaryBodyV2`·`summaryBody`·`legacyOverview`·`renderRest` | station_briefing_render.js | 「총평과 권고」 §11.10.1 모양(기상·물때 공용 칸) · §11.10 판 모양 · 옛 브리핑 문단 모양 · 그 아래 칸들 |
| `isolationLine`·`isoTable` | station_briefing_render.js | (물때) 아래 「(고립 주의) 저조 시간(…) 전후 사고 지점(N개소) 확인 및 주의가 필요합니다.」 — 「사고 지점(N개소)」 버튼 → 「지점명 \| 발생 건수」 표 전부(`summary.isolation`, §11.10.3) |
| `basisList`·`expander`·`miniMap`·`mapCaption` | station_briefing_render.js | (근거) 목록 — 서버 `summary.sea.detail[line]` 에 상자(`boxes`)와 관할 경계(`area`)가 있으면 그 줄을 ▸ 버튼(`aria-expanded`·`aria-controls`)으로, 누르면 바로 아래 높이 200px 지도(OpenLayers 전역 `ol` · 바탕 해아름 바다지도 `oceanCreateKhoaLayer` — 관심해역 고르기 지도와 같은 방식, 없으면 선만) — 관할 전체에 맞추고 그 칸·대해구 테두리를 600ms 마다 깜빡임. 움직임 줄이기면 깜빡이지 않음(`data-sb-blink="static"`). 풀이(`note`)는 줄 아래 작게(§11.10.3) |
| `levelNoteText` | station_briefing_render.js | 총평 해상 단계 < 해상 분석 단계일 때 결론 아래 한 줄(세 모양 공용 — §11.10.3 부터 「기상·혼잡이 겹치지 않아 … 넣지 않았습니다」 이유 글 없음) |
| `notesEmptyText` | station_briefing_render.js | (특이사항)이 비었을 때의 글 — `notesFound` 면 「뽑지 못했습니다 — 원문 확인」, 아니면 「없습니다」(§11.10.2 독립 검토 3 · `StationBriefingRender.notesEmptyText` 로 내보내 node 시험이 vm 으로 확인) |

## 수정 시 주의사항
- **서버 글은 `textContent` 로만**(계약 §5). `innerHTML` 은 조석 게이지(숫자·시각만 — 모양 검사 뒤 `OS.tideGaugeHtml`)와 [기준 상세] 정적 문안뿐.
- 노출 판정을 화면에서 하지 않는다 — `display` 는 서버가 정한다. 아코디언 머리·몸은 마크업에서 `display:none` 으로 시작한다.
- 탭 이동은 기존 `switchMainTab`·`switchSubTab` 만 쓴다(life_safety.js 탭 상태 유지 규칙과 충돌하지 않게).
- [기준 상세] 문안을 바꿀 때는 서버 규칙(`station_briefing_rules.js`·`station_briefing.js`·`station_briefing_ai.js`)과 설계서 §11.6~§11.8 를 대조한다 — 코드에 없는 규칙을 쓰지 않는다.
- 점검 차단(`station-briefing` — index2.html featureMap·bodyMap)과 노출 판정이 둘 다 몸 보임을 만진다 — `applyVisibility` 가 차단을 보고(일반 기기 숨김·관리자는 열어 둔 것 유지), index2 는 차단을 바꾼 뒤 `StationBriefing.applyVisibility()` 를 부른다.
- 펼친 아코디언·안쪽 칸은 `max-height:none`(station_briefing.css) — 기존 8000px 상한이 카드 최대치 본문을 잘랐다.
- **지도 클래스 이름 두 벌(2026-10-17 합칠 때 겹침)**: 설정 화면 고르기 지도는 `.sb-map`(46vh), 총평 근거 줄 펼침 지도는 `.sb-minimap`(200px). 같은 이름을 쓰면 뒤 규칙이 앞 지도 높이를 덮는다 — 실제로 펼침 지도가 240px 로 커져 UI 시험이 잡았다.
- 고르기 지도는 높이를 화면 비율(`.sb-map` 46vh)로 못박는다 — 부모 높이가 풀리면 ol 지도가 그려져도 터치를 못 받는다(온보딩 zone_setup.js 와 같은 주의).
  다른 탭에 갔다 오면 `updateSize()` 로 크기를 다시 잰다. 지도 이벤트(singleclick)는 바깥(아코디언 머리)으로 번지지 않게 막는다.
- 온보딩(`zone_setup.js`)의 해역 단추·지도 모양을 **복사하지 않고 같은 값으로 다시 썼다**(그 파일은 함수가 밖으로 나와 있지 않다 — 온보딩 동작을 바꾸지 않으려고 손대지 않음). 온보딩 모양을 바꾸면 `.sb-sea-btn`·`zoneStyle` 도 같이 본다.
- **근거 줄 지도 깜빡임은 꼭 멈춘다**(§11.10.3): 접으면 `expander` 가 `miniMap` 의 정리 함수(타이머 해제·`map.setTarget(null)`)를 부르고, 펼친 채 본문을 다시 그려 지도가 떨어지면 다음 깜빡임에서 `isConnected` 를 보고 스스로 멈춘다. 시험은 `StationBriefingRender.blinking()`(지금 깜빡이는 지도 수)으로 본다.
- 지도는 그림처럼 고정(`interactions:[]`·`controls:[]`) — 페이지를 쓸어 내릴 때 손가락을 가로채지 않게. 도형은 서버가 소수 4자리·약 100m 단순화로 줄여 보낸다(`station_briefing_inputs.areaOf`).
- 시험: `local_server/scripts/test_station_briefing_ui.js`.
