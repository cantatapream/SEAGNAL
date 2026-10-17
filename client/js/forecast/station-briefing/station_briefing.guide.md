# 연안 안전 브리핑(종전 「활동지점 안전 브리핑」) — 화면 가이드 (`station_briefing*.js`)

## 이 기능은 무엇인가
파출소 관할 하나의 바다(해상)와 해안 관광지·위험구역(연안)을 서버 규칙으로 판단한 브리핑을 보여 주는 아코디언이다. 제목 「HH:MM AI 연안 안전 브리핑」(보이는 판의 시각).
판단은 전부 서버(`local_server/services/station_briefing_rules.js`)가 하고, 「총평과 권고」의 결론·근거·권고·물때(`summary`)와 AI 가 실패했을 때의 규칙 분석 문단(`summary.analysis`)도 서버가 만든다.
AI 는 결론 아래 연안·해상 분석 문단(각 3~5문장)만 쓴다(2026-10-17 — 설계서 §11.10.4, 그 전 §11.10 은 1~2문장 해설). 화면은 받은 것을 옮기기만 한다.

## 화면에서 찾아가는 법
- 해양예보 탭 → 「🔭 기상청 해상 기상 전망」 바로 아래 「🧭 HH:MM AI 연안 안전 브리핑」(노출 판정 display:true 일 때만).
- 설정 팝업(오른쪽 위 ⚙) → 관심해역 탭 맨 아래 칸.
- 통합관리자 → AI → 「AI 브리핑」(관리자 설정 — `client/js/admin/admin_station_briefing.js`).

## 데이터 흐름
0. 설정 화면 「지도에서 선택하기」에서 해역을 처음 누르면 `GET /api/station-briefing/areas`(관할 폴리곤·해역 — 같은 노출 판정·같은 관리자 정보, 한 번 받으면 다시 묻지 않음). 해역 규칙은 README 「관할 고르기 탭 두 개」·계약 §1.1b.
1. 시작(DOMContentLoaded) → `GET /api/station-briefing/stations` — 관리자 정보는 특보 예측(`advisory_prediction.js _adminAuth`)과 같은 방식:
   관리자 모드(`seagnal_admin_mode`)일 때만 `push_token` 을 쿼리 `adminToken` 으로, 로그인 토큰(`seagnal_admin_token`)을 `X-Admin-Token` 헤더로.
2. `display:false` → 머리·몸 `display:none` 그대로(일반 화면 변화 없음). `display:true` → 보이고, 고른 관할이 있으면
   `GET /api/station-briefing?station={key}&day=auto` → `StationBriefingRender.render`.
3. 10분마다 노출 판정부터 다시 받고(모든 기기 — 「노출 안 함」 전환이 관할 미설정 기기에도 반영), 보임이면 브리핑도 받는다. 접었다 펼 때 10분이 지났으면 다시 받는다(판은 하루 세 번 + 특보 변경 때만 바뀐다 — 정시 판은 서버가 07:30·17:30·23:00 공개 시각까지 이전 판을 주므로 공개 뒤 최대 10분 안에 바뀐다, §11.10.4).
   받을 때마다 제목을 그 판 시각으로(`setTitle` → `StationBriefingRender.titleText` — 정시 판은 `publishAt`, 그 밖은 `generatedAt`).
4. 노출 판정 조회가 실패하면 직전 판정을 유지하고 5초·20초·60초 뒤 다시 묻는다(그 뒤는 10분 주기). 관리자 상태가 바뀌면(`admin.js` 의 `seagnal-admin-change` 사건 — 로그인·로그아웃·관리자 모드·관리자 기기 등록) 바로 다시 받는다.

## 저장(이 기기 — localStorage `seagnal_station_briefing_v1`)
`{station, name, office, seaOnly, showSea, showLand, hidden, seen:{관할: 마지막으로 펼쳐 본 generatedAt}}` — 관심해역(`weatherAppSettings_v1`)·지방청(`officeManualSettings`)과 같은 관례.
저장소가 막혀 있으면 기본값으로 동작한다(그때는 매번 설정 전 상태).

## 설정 흐름(§11.2 + §11.6 Q3)
| 상황 | 화면 |
|---|---|
| 관할 없음 | 「연안 안전 브리핑 지역이 설정되지 않았습니다」 + [설정하기] |
| [설정하기]·⚙ | 고르기 탭 두 개(`station_briefing_picker.js` — 2026-10-17): 「지도에서 선택하기」(해역 단추 4개 → 그 해역 관할 폴리곤 지도, 눌러 고르기) · 「파출소로 선택하기」(지방청 → 해양경찰서 → 파출소 아코디언, 남항 두 곳은 경찰서로 구분, 「해상만」 표시, 이름 찾기 — 찾으면 맞는 묶음 저절로 펼침) · 해상/연안 보기 칸(고르기 칸 위 한 줄 · 「연안 브리핑 보기」 — §11.10.4 전 「육상」)(해상만 관할은 연안 칸 끔) · 「선택: …」 줄 · 머리 오른쪽 [건너뛰기](관할 없을 때) / [취소](이미 설정했을 때 — 바꾸지 않고 브리핑으로). 아래 단추 줄은 없다(2026-10-17 §11.9.2) |
| 관할을 누름(지도 폴리곤·칩) | 칠하고 가운데 확인 창 「○○해양경찰서 ○○파출소 — 이 관할을 선택하셨습니까? 저장하시겠습니까?」 [취소] [저장](`StationBriefingPicker.confirm`). [저장] = 곧바로 저장 → 브리핑 · [취소]·Esc·바깥·뒤로가기 = 누르기 전으로(다른 관할을 누를 수 있다) |
| [건너뛰기] 또는 관할을 골랐지만 해상·육상 모두 끔 | 「해상·연안 모두 설정하지 않았습니다 — 이 아코디언을 더 이상 표시하지 않을까요?」 [예, 표시하지 않기] [아니요] |
| 예 | 숨김(`hidden:true`) + 「오른쪽 위 설정(⚙) 버튼에서 언제든 다시 표시할 수 있습니다」(`showSeagnalModal`) |
| 설정 팝업 칸 | 「해양예보 탭에 표시」 스위치 · 지금 관할 · [관할 설정](팝업을 닫고 해양예보 탭에서 고르기 화면) — **누르는 즉시 적용**(팝업 [저장]·[취소] 스냅샷과 따로). 팝업에 저장하지 않은 다른 변경이 있으면 [관할 설정]이 묻는다([확인] 저장하고 이동 / [취소] 남기 — `settings.js settingsModalHasUnsaved`) |

## 본문 칸(§8 뼈대·안 A + 해상 시간 막대)
| 칸 | 내용(서버 필드) |
|---|---|
| 머리 | 관할·경찰서, 「10월 17일 17:30 기준 브리핑 (다음 브리핑 갱신 23:00 또는 특보 변경 시)」(§11.10.9 ⑦ — 종전 「10월 17일(토) 브리핑 · 08:00 판 · 생성 시각」), [기준 상세] |
| ① 총평과 권고 | **§11.10.4(`summary.analysis` 있음 — 「가」 모양, `summaryBodyV3`)**: `[data-sb-part]` 순서 `land`(칩 「연안 ○○ 필요」 + 결론 → `[data-sb-analysis="land"]` 분석 문단(이름표 `.sb-an-tag` 「AI 분석 · ChatGPT/Gemini」 = `overview.land`, 없으면 「규칙 분석」 = `summary.analysis.land`) → `[data-sb-x="basis-land"]` (§11.10.9 부터: 문단 마지막 「따라서 …」 → 「(권고) …」 줄 `[data-sb-advice]`) → 오른쪽 알약 배지 「연안 분석 근거 상세 보기」(처음 접힘 — 펼치면 (근거) `basisList`, (권고)는 문단에서 못 뗐을 때만)) → `sea`(칩 「해상 ○○ 필요」 + 결론 + `[data-sb-level-note]` → 해상 분석 문단 → `[data-sb-now]` 지금 밀집(오늘 판) → 배지 「해상 분석 근거 상세 보기」) → `weather`(`weatherPart` — 「{구역} 기상 현황」) → `tide`(`tidePart`) · 맨 아래 `[data-sb-source]` 줄은 §11.10.9 부터 없음. **§11.10.1(`summary.weather` 있음, analysis 없음)**: `[data-sb-part]` 순서 — `conclusion`(육상·해상 단계 배지 + 결론 `summary.*.headline`, 해상 분석 단계가 더 높으면 `[data-sb-level-note]`) → `weather`(「(기상) 구역」 + `rows` 오전·오후(`.sb-wx-rows`) + `source` · 「(특이사항)」 `notes`(`.sb-wx-notes`) + `notesSource`, 자료 없으면 `[data-sb-wx-missing]` 「기상예보 자료를 확인하지 못했습니다」 · 특이사항이 비면 칸째 없음(§11.10.11 부터 — 종전 `[data-sb-wx-notes-empty]` 「뽑지 못했습니다」·「단기 전망 자료를 확인하지 못했습니다」 안내와 `notesEmptyText` 는 없앴다) · 앞바다가 30km 넘게 멀면 `[data-sb-wx-note]` 에 서버 `weather.note`(§11.10.2)) → `tide`(「(물때)」 `summary.tide` + §11.10.3 「(고립 주의)」 `[data-sb-isolation]` — `summary.isolation` 이 있을 때) → `land`·`sea`(`[data-sb-summary]` — 「(근거)」·「(권고)」, 해상 근거 줄은 `summary.sea.detail` 에 따라 ▸ 지도 펼침·풀이, 해상 근거 끝에 지금 밀집 `li.sb-now`) → `commentary`(「해설 · ChatGPT · 육상/해상」, 틀이면 없음) · 작게 `[data-sb-source]`. **§11.10 판(summary 만)**: 육상(보일 때)·해상마다 `[data-sb-summary]` 덩어리: 단계 배지(육상 `land.level`·해상 `sea.overviewLevel`) → 결론 `summary.*.headline`(굵게 `.sb-headline`) → 「(근거)」 `basis[]`(`.sb-sum-basis`) → 「(권고)」 `advice` → 「(물때)」 `tide[]`(육상만) → AI 해설 `overview.land/sea`(`[data-sb-commentary]`, 이름표 「해설 · ChatGPT/Gemini」 — 틀이면 없음). 해상 분석 단계(`sea.level`)가 더 높으면 해상 덩어리에 한 줄(`[data-sb-level-note]` — `levelNoteText`) · 지금 밀집(`now.text`, 오늘 판만) · 작게(`[data-sb-source]`): AI 해설 표시 또는 「AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.」. **`summary` 가 없는 옛 브리핑**은 종전 모양(육상/해상 문단 `[data-sb-overview]` · 근거 ▸ · 틀 문장 표시) — `legacyOverview` |
| ① 총평과 권고 | **§11.10.4(`summary.analysis` 있음 — 「가」 모양, `summaryBodyV3`)**: `[data-sb-part]` 순서 `land`(칩 「연안 ○○ 필요」 + 결론 → `[data-sb-analysis="land"]` 분석 문단(이름표 `.sb-an-tag` 「AI 분석 · ChatGPT/Gemini」 = `overview.land`, 없으면 「규칙 분석」 = `summary.analysis.land`) → `[data-sb-x="basis-land"]` (§11.10.9 부터: 문단 마지막 「따라서 …」 → 「(권고) …」 줄 `[data-sb-advice]`) → 오른쪽 알약 배지 「연안 분석 근거 상세 보기」(처음 접힘 — 펼치면 (근거) `basisList`, (권고)는 문단에서 못 뗐을 때만)) → `sea`(칩 「해상 ○○ 필요」 + 결론(칩 오른쪽 KOMSA 배지 `[data-sb-komsa]` — §11.10.12) → 해상 분석 문단 → `[data-sb-now]` 지금 밀집(오늘 판) → 배지 「해상 분석 근거 상세 보기」) → `weather`(`weatherPart` — 「{구역} 기상 현황」) → `tide`(`tidePart`) · 맨 아래 `[data-sb-source]` 줄은 §11.10.9 부터 없음. **§11.10.1(`summary.weather` 있음, analysis 없음)**: `[data-sb-part]` 순서 — `conclusion`(육상·해상 단계 배지 + 결론 `summary.*.headline`, 해상 칩 오른쪽 KOMSA 배지 `[data-sb-komsa]` — §11.10.12, 종전 노란 한 줄 `[data-sb-level-note]` 없앰) → `weather`(「(기상) 구역」 + `rows` 오전·오후(`.sb-wx-rows`) + `source` · 「(특이사항)」 `notes`(`.sb-wx-notes`) + `notesSource`, 자료 없으면 `[data-sb-wx-missing]` 「기상예보 자료를 확인하지 못했습니다」 · 특이사항이 비면 `[data-sb-wx-notes-empty]` — `notesFound` 면 「단기 전망에서 항목을 뽑지 못했습니다 — 원문(…)을 확인하세요」(`unparsed`), 아니면 「…없습니다」(`none`) — 글은 `notesEmptyText` · 앞바다가 30km 넘게 멀면 `[data-sb-wx-note]` 에 서버 `weather.note`(§11.10.2)) → `tide`(「(물때)」 `summary.tide` + §11.10.3 「(고립 주의)」 `[data-sb-isolation]` — `summary.isolation` 이 있을 때) → `land`·`sea`(`[data-sb-summary]` — 「(근거)」·「(권고)」, 해상 근거 줄은 `summary.sea.detail` 에 따라 ▸ 지도 펼침·풀이, 해상 근거 끝에 지금 밀집 `li.sb-now`) → `commentary`(「해설 · ChatGPT · 육상/해상」, 틀이면 없음) · 작게 `[data-sb-source]`. **§11.10 판(summary 만)**: 육상(보일 때)·해상마다 `[data-sb-summary]` 덩어리: 단계 배지(육상 `land.level`·해상 `sea.overviewLevel`) → 결론 `summary.*.headline`(굵게 `.sb-headline`) → 「(근거)」 `basis[]`(`.sb-sum-basis`) → 「(권고)」 `advice` → 「(물때)」 `tide[]`(육상만) → AI 해설 `overview.land/sea`(`[data-sb-commentary]`, 이름표 「해설 · ChatGPT/Gemini」 — 틀이면 없음). 해상 칩 오른쪽 KOMSA 배지(`[data-sb-komsa]` — `komsaBadges`, §11.10.12) · 지금 밀집(`now.text`, 오늘 판만) · 작게(`[data-sb-source]`): AI 해설 표시 또는 「AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.」. **`summary` 가 없는 옛 브리핑**은 종전 모양(육상/해상 문단 `[data-sb-overview]` · 근거 ▸ · 틀 문장 표시) — `legacyOverview` |
| ② ~~특별 상황~~ | 2026-10-17(§11.10.16 소절 D)부터 그리지 않는다(옛 판도). 특보는 같은 날 E 부터 총평 분석 문단의 특보 말 링크 → 「기상특보 현황」 창(`openWarnPopup`·`warnBox` — 서버 `summary.sea/land.warnings`)·해상 근거 안 같은 상자·특보 말이 없을 때 「(특보) …」 한 줄(`warnFallback`). 서버 `special[]` 은 AI 입력용으로 그대로 |
| ③ 해상 분석 | 단계·출처, (§11.10.16 부터 검토 줄 없음 — 아래 괄호는 이력) 검토 칸 수·관심 이상 칸 수(§11.10.3 부터 칸 = 해역 묶음 `reviewedRegions`, 해양사고 위험예보만 위험 단계인 해역 수 · 카드 10곳 넘으면 「카드는 단계 높은 순 10곳까지」), 빠진 자료(`sea.missing`·`missingSlots`), 해구 흐름(`sea.weather.text`), **시간 막대**(`timeBar` — 칸 색 = 단계, ⚑ = 사건, 보는 시각에 끝난 칸은 흐리게 `.sb-slot-past` · §11.10.13 부터 칸 아래 설명 줄·칸 누르기 없음 — 칸은 `role=img`+`aria-label`), 해역 카드(`cards` — §11.10.13 부터 [사고현황('21~'25년)](`traits.label`·`text`)·[기상 예보](`today.weatherLines`+`today.forecast`)·[그 밖의 근거](`today.otherLines`)·`historyNote`·맨 끝 [권고](`advice`)·[위험예측에서 보기 ›], `advice` 없는 옛 판은 [특성]·[오늘 예상]·틀 문장 · §11.10.15 규칙 v16 카드는 꼬리표 대신 출처별 배지 `badges`(글자 색 = 그 예보 등급 색) + 상세 줄 → [사고현황] → `historyNote` → [기상 예보](`today.forecast`) → [권고]) |
| ④ 육상 분석 | 단계·출처, ~~검토 관광지 수~~(§11.10.16 부터 없음 — 「관광지 N곳 자료 확인 불가」 줄도 같은 날 추가 결정 A 로 없음, 서버 `land.failedSpots` 만 남음), 관광지 카드(`land.cards`), 「상시 위험 장소」 접힘(`land.constant`). 해상만 관할은 `seaOnlyReason` 한 줄 |
| ⑤ 조석 | 해양종합정보 조석 게이지(`OceanSheet.tideGaugeHtml` — 바텀시트 `renderTideData` 와 같은 함수) + 밀물·잠기는 바위 문구(`tide.text` — 「잠기는 바위(간출암) N곳」은 (물때) 칸과 같은 지도 링크, §11.10.10) |
| ⑥ 꼬리 | 기준 시각·다루는 시간·출처(`SOURCES` — [기준 상세] 출처 표와 같은 배열)·「참고 정보이며 안전을 보장하지 않습니다」 |
| 브리핑 없음 | (§11.10.10 F 부터 「아직 이 관할의 브리핑이 없습니다」 줄 없음 — `[data-sb-empty]` 안에 다음 공개 안내만) `nextExpectedAt`(공개 시각 — 「다음 브리핑 공개: …」, 이미 지났으면 「다음 브리핑을 준비 중입니다(… 공개 예정)」, 없으면 「07:30 · 17:30 · 23:00에 보입니다 — 각 20분 전부터 …」) · `fallback` 이면 오늘 판을 그대로(§11.10.9 ⑦ 부터 「…아직 없어 오늘 브리핑」 상자 없음) · 관리자 미리보기의 공개 전 판 안내 상자(`[data-sb-pending]` 「예정 — …」)는 §11.10.10 F 로 없앰(머리 글 시각만) |

**단계 색**: 위험예측 4색(`RiskFormat.BAND_COLORS` 평소 수준 초록 · 다소 높음 노랑 · 높음 주황 · 매우 높음 빨강)을 브리핑 단계 0~3(평소 수준·관심·주의·경계 — §11.10.16 부터 「필요」 없음, 옛 판의 「주의 필요」는 `levelWord` 가 「주의」로)에 순서대로. 「확인 불가」는 회색 `#64748b`. 분석 문단 강조 글자의 빨강(발효 특보·「경계」 단계)만 `.sb-analysis .sb-hl-red` = `#e34842`(§11.10.11 — 어두운 카드 위 대비 4.76, 4색 빨강은 4.21). 지도·배지는 4색 그대로.

**단계 나누기(§11.10.14)**: ③ 해상 분석·④ 연안 분석의 카드는 칸 머리 오른쪽 단계별 개수 배지(접어도 보임 · §11.10.16 부터 글 「주의 5」)와, 펼친 칸 안 카드 위 단계 단추(하나만 고름 — 처음 = 가장 높은 단계)로 나뉜다. 검토 줄·빠진 자료·시간 막대·「상시 위험 장소」는 단추와 무관하게 늘 보인다. 단계가 하나면 단추 없음.

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
| `mount`·`destroy` | station_briefing_picker.js | 고르기 탭 두 개 만들기 · 지도·확인 창 정리(`renderBody` 가 화면을 바꿀 때마다 부름) |
| `confirmPick`(`confirm`)·`closeDialog` | station_briefing_picker.js | 관할을 누르면 뜨는 가운데 확인 창(`role=dialog`·`aria-modal`·초점·Esc·바깥·`PopupStack`·늦은 click 거르기) |
| `mapPanel`·`drawMap`·`zoneStyle`·`loadAreas` | station_briefing_picker.js | 해역 단추 → 관할 폴리곤 지도(온보딩 `zone_setup.js` `_makeMap`·`_zoneStyle` 과 같은 방식·같은 색) · 구역 한 번 받기 |
| `listPanel` | station_briefing_picker.js | 지방청 → 해양경찰서 → 파출소 아코디언 + 찾기(맞는 묶음 펼침) |
| `updateBadge`·`markSeen` | station_briefing.js | N 뱃지 |
| `openInRisk` | station_briefing.js | 바로가기 |
| `renderSettings` | station_briefing.js | 설정 팝업 칸(settings.js `openSettingsModal` 이 부름) |
| `render` | station_briefing_render.js | 본문 전체(관리자 미리보기도) |
| `titleText`·`editionTime`·`editionLabel` | station_briefing_render.js | 제목 「07:30 AI 연안 안전 브리핑」 · 판 시각(정시 판 `publishAt`, 그 밖·옛 판 `generatedAt`) · 「07:30 판」(§11.10.4) |
| `setTitle` | station_briefing.js | `#station-briefing-title` 을 보이는 판의 제목으로(브리핑을 받을 때·관할을 바꿀 때) |
| `highlightSegments`·`highlightNames`·`analysisNodes`·`splitAdvice` | station_briefing_render.js | 분석 문단 강조 토막(순수 함수 — 특보·장소 주어·방문객 배수·단계 말, `[{text,cls,rank}]`) · 그 브리핑의 장소 이름 · 토막을 span(textContent)으로 · 마지막 「따라서 …」를 (권고) 줄로(§11.10.9 ④⑤ — `StationBriefingRender` 로 내보내 node 시험이 vm 으로 확인) |
| `subtitleText`·`editionIso` | station_briefing_render.js | §11.10.9 ⑦ 머리 글 「10월 17일 17:30 기준 브리핑 (다음 브리핑 갱신 23:00 또는 특보 변경 시)」 — 시각은 제목(`titleText`)과 같은 `editionIso`, 다음 갱신은 응답 `nextPublishAt`(오늘 아니면 「내일」). fallback 「아직 없어」 상자는 그리지 않는다 |
| `openMapPopup`·`closeMapPopup`·`mapLink`·`nowNode` | station_briefing_render.js | §11.10.9 ⑥ 팝업 지도 — 가운데 창(`.sb-dlg` 틀, role=dialog·Esc·바깥·✕·PopupStack, 본문 다시 그리면 닫힘) · 글 안 링크 단추 · 「지금 밀집」 줄(「관할 해역 선박 N척」·붐비는 해역 → 선박 격자 + 칸 안 척수, `now.cells`). `miniMap` 다섯째 인자 `{big, cells, dim}` |
| `raisedTable` | station_briefing_render.js | 연안 근거 「평소보다 위험이 높아진 곳 N곳」 버튼 → 「관광지 \| 평소 \| 오늘(예상)」 표(`summary.land.raised` 전부 — 오늘 칸은 단계 배지 + 작은 이유, §11.10.9) |
| `summaryBodyV3`·`weatherPart`·`tidePart` | station_briefing_render.js | §11.10.9: 분석 근거는 오른쪽 알약 배지 「연안/해상 분석 근거 상세 보기」(`expander` 넷째 인자 pill) · (기상) 머리 「{구역} 기상 현황」(`.sb-headline`, `[data-sb-wx-head]`)·거리 줄/먼 구역 안내 없음·특이사항 없으면 칸째 없음 · 맨 아래 `[data-sb-source]` 줄 없음(V3) · 지금 밀집 두 줄(`.sb-now` pre-line). 「가」 모양(결론 → 분석 문단·이름표 → 접힌 분석 근거, 지금 밀집은 해상 분석 아래) · (기상)·(물때) 칸(V2·V3 공용) |
| `summaryBodyV2`·`summaryBody`·`legacyOverview`·`renderRest` | station_briefing_render.js | 「총평과 권고」 §11.10.1 모양(기상·물때 공용 칸) · §11.10 판 모양 · 옛 브리핑 문단 모양 · 그 아래 칸들 |
| `isolationLine`·`isoTable` | station_briefing_render.js | (물때) 아래 「(고립 주의) 저조 시간(…) 전후 과거 고립 사고(N개소 M건)으로 확인 및 주의가 필요합니다.」 — 「과거 고립 사고(N개소 M건)」 버튼(화살표 없음 — `expander` noArrow) → 「지점명 \| 발생 현황」 표 전부(`summary.isolation` head·rows[].status 「22년(1건), 23년(2건)」, §11.10.10 — 옛 판은 §11.10.3 「발생 건수」 그대로) |
| `rocksLine`·`openRockPanel`·`closeRockPanel` | station_briefing_render.js | §11.10.10: 물때 줄의 「잠기는 바위(간출암) N곳」(`summary.rocks.link`) → 팝업 지도(관할 경계 + 바위 마커 `miniMap` opt.points — 서버 `summary.rocks.rows` 위치) → 마커 → 창 위 가운데 간출암 조석 곡선 상자 `.hazard-rock-popup.rock-tide-popup.sb-rockbox`(`window.HazardRockTidePanel.mount` — hazard_rocks.js 의 해양안전 위험지형 팝업과 같은 함수, PopupStack 'sb-rock-panel', Esc 는 상자 먼저) |
| `basisList`·`expander`·`miniMap`·`mapCaption` | station_briefing_render.js | (근거) 목록 — 서버 `summary.sea.detail[line]` 에 상자(`boxes`)와 관할 경계(`area`)가 있으면 그 줄을 ▸ 버튼(`aria-expanded`·`aria-controls`)으로, 누르면 바로 아래 높이 200px 지도(OpenLayers 전역 `ol` · 바탕 해아름 바다지도 `oceanCreateKhoaLayer` — 관심해역 고르기 지도와 같은 방식, 없으면 선만) — 관할 전체에 맞추고 그 칸·대해구 테두리를 600ms 마다 깜빡임. 움직임 줄이기면 깜빡이지 않음(`data-sb-blink="static"`). 풀이(`note`)는 줄 아래 작게(§11.10.3) |
| `levelNoteText` | station_briefing_render.js | 총평 해상 단계 < 해상 분석 단계일 때 결론 아래 한 줄(세 모양 공용 — §11.10.3 부터 「기상·혼잡이 겹치지 않아 … 넣지 않았습니다」 이유 글 없음) |
| `isolationLine`·`isoTable` | station_briefing_render.js | (물때) 아래 「(고립 주의) 저조 시간(…) 전후 사고 지점(N개소) 확인 및 주의가 필요합니다.」 — 「사고 지점(N개소)」 버튼 → 「지점명 \| 발생 건수」 표 전부(`summary.isolation`, §11.10.3) |
| `basisList`·`expander`·`miniMap`·`mapCaption` | station_briefing_render.js | (근거) 목록 — 서버 `summary.sea.detail[line]` 에 상자(`boxes`)와 관할 경계(`area`)가 있으면 그 줄을 ▸ 버튼(`aria-expanded`·`aria-controls`)으로, 누르면 바로 아래 높이 200px 지도(OpenLayers 전역 `ol` · 바탕 해아름 바다지도 `oceanCreateKhoaLayer` — 관심해역 고르기 지도와 같은 방식, 없으면 선만) — 관할 전체에 맞추고 그 칸·대해구 테두리를 600ms 마다 깜빡임. 움직임 줄이기면 깜빡이지 않음(`data-sb-blink="static"`). 풀이(`note`)는 줄 아래 작게(§11.10.3). §11.10.12: 위험예보만 해역 줄(`key:'accidentOnly'` — 「해양사고 위험예보(KOMSA) 기준 등급 '주의'인 해역 N칸」)은 화살표 없음(`expander` 다섯째 인자 bare)·풀이 줄 안 보임(옛 판 note 포함)·지도 캡션 「KOMSA 기준 등급 '주의' 해역」(단계 = 그 줄의 따옴표 말) |
| `komsaBadges` | station_briefing_render.js | §11.10.12: 해상 결론 칩 오른쪽 「N개 해역 주의 필요(KOMSA 예보)」(`[data-sb-komsa]` = 단계, 단계마다 하나·그 단계 색 `.sb-komsa`, N>0 일 때만) — 수는 서버 `summary.sea.accidentOnly`(근거 줄과 같은 수), 그 칸이 없는 옛 판은 해역 카드에 위험예보만 해역이 모두 있을 때만 카드로 셈(아니면 배지 없음). 네 모양 공용. 종전 결론 아래 노란 한 줄(`levelNoteText`·`[data-sb-level-note]`)은 없앴다 |
| `notesEmptyText` | station_briefing_render.js | (특이사항)이 비었을 때의 글 — `notesFound` 면 「뽑지 못했습니다 — 원문 확인」, 아니면 「없습니다」(§11.10.2 독립 검토 3 · `StationBriefingRender.notesEmptyText` 로 내보내 node 시험이 vm 으로 확인) |
| `levelGroups`·`levelBadges`·`levelTabs` | station_briefing_render.js | §11.10.14: 「해상 분석」·「연안 분석」 카드를 단계별로 묶어(경계 → 주의 → 관심, 단계 안 순서는 서버 그대로) 칸 머리 오른쪽에 개수 배지(`[data-sb-sec-badges]` — §11.10.16 부터 「주의 5」·「관심 1」(종전 「주의 필요 5개 해역」), `chip` 색) · 카드 목록 위 단계 단추(`[data-sb-tabs="sea|land"]` role=tablist, 처음 = 가장 높은 단계, 단계 하나면 단추 없음) — 개수는 보이는 카드 수(서버 10곳 상한 안) |
| `appendText`·`levelWord` | station_briefing_render.js | §11.10.16: `appendText(node, text)` — 「다.」로 끝난 문장 뒤(빈칸·한글 이어짐)에 `<br>`(숫자의 점·「다.」」·글 끝은 안 자름, textContent 그대로) · `levelWord('주의 필요')` → 「주의」(옛 판 단계 말). 둘 다 `StationBriefingRender` 로 내보내 UI 시험이 직접 부른다 |

| `seaCardBadged`·`seaBadges`·`seaCardLink` | station_briefing_render.js | §11.10.15: 규칙 v16 해역 카드(`badges` 있음) — 출처별 배지 `.sb-srcb`(`data-rank` = 글자 색 단계 · `data-sb-src` = accident·congestion·weather, 글은 서버 `text` 그대로 textContent) + 상세 줄 `.sb-srcb-det`(서버 `detail`) → [사고현황] → 사고 한 줄 → [기상 예보] → [권고]. 경계 글자 색은 CSS `.sb-srcb[data-rank="3"]`(#e34842), 관심·주의는 `colorOf`. `badges` 없는 옛 판은 `seaCard` 의 종전 길. `seaCardLink` = 맨 끝 [위험예측에서 보기 ›](두 길 공용). 시안 ④판(규칙 v17): `detail[]` 이 `{title, head, rows}` 면 `srcbTable` 이 제목 `.sb-srcb-dt` + 표 `.sb-srcb-tbl`(상자 `.sb-srcb-tblw` 가로 스크롤, `{text, rank}` 칸 = `.sb-srcb-grade` 그 등급 색), 글 줄(v16 판)이면 종전 한 줄 |

## 수정 시 주의사항
- **서버 글은 텍스트 노드로만**(계약 §5) — `el()`·`appendText`(§11.10.16: 「다.」 문장 끝 뒤에 `<br>` 만 끼우고 글은 그대로, textContent = 서버 글). 새로 서버 글을 붙일 때도 `appendText` 를 쓴다. `innerHTML` 은 조석 게이지(숫자·시각만 — 모양 검사 뒤 `OS.tideGaugeHtml`)와 [기준 상세] 정적 문안뿐.
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
