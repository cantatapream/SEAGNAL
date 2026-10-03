# SEA:GNAL 소개서 — 근거자료 (검증용, NotebookLM 에 넣지 않음)

> 「SEAGNAL_소개.md」의 숫자·출처·공개 여부를 어디서 어떻게 확인했는지 적은 문서입니다.
> - **코드 기준**: `origin/main` 463eed4 (2026-09-29 08:47 KST 머지)
> - **작성일**: 2026-10-03
> - **작성 방식**: 저장소 코드·데이터 파일을 직접 세거나 읽어서 확인했습니다. 일부는 조사 에이전트가 보고한 뒤 다시 세어 대조했습니다. 대조하지 못한 항목은 「미대조」로 표시했습니다.

---

## A. 운영 실적 숫자 — 저장소에서 확인할 수 없음

| 숫자 | 값 | 출처 | 비고 |
|---|---|---|---|
| 총 설치자 | 1,800여 명 이상 | 사용자 제공 HWP 초안, 10/1 관리자 화면 | 코드에 "설치자"라는 지표 이름은 없음(`grep 설치자\|installCount` 0건). 가장 가까운 값은 FCM 구독자 수(`GET /api/push-subscriber-stats`, `local_server/routes/push.js:913`) |
| 총 정보 제공 | 51,496회 이상 | 같음 | 기능별 사용 건수 `GET /api/stats/usage` (`routes/usage.js:296`)로 추정 |
| 특보 알림 | 2,267회 · 708,471개 | 같음 | `GET /api/push-counter` → `data/push_counter.json` 의 `totalSends`(발송 횟수)·`totalCount`(받은 기기 수 합). 위치기반 발송도 같은 카운터에 더해짐(`location_alert_dispatch.js`) |
| 제보 반영 | 16건 중 12건 | HWP 초안 | 이 문장은 5/28 기획서와 같은 숫자. 10/1 기준으로 다시 셀지 확인 필요 |
| 5/28 값 | 1,143명 구독, 방문 11,711, 526회·155,958개, 직군 분포 | 5/28 기획서 붙임 p.1 캡처 | |
| 수상 | 2026 해경청 AI 경진대회 우수상 | HWP 초안 | |

---

## B. 숫자 직접 센 기록

| 항목 | 값 | 명령·근거 |
|---|---|---|
| 특보구역 | 44 | `jq '.features\|length' client/assets/warn_zones.geojson` |
| 특정관리해역 | 49 | `jq '.features\|length' client/assets/warn_zones_sub.geojson`. 서버 `MMIS_CODE_TO_NAME` 93 = 44 + 49 (`marine_warning_crawler.js:141`, 에이전트 보고) |
| 기상부이 | 118 | `grep -cE '^\s*"[^"]+": \{ name:' client/buoyLocations.js` |
| 부이 종류 | B 47 · C 61 · L 9 · J 1 | `grep -oE 'type: "[A-Z]+"' client/buoyLocations.js \| sort \| uniq -c`. 문서에는 B=해양기상부이, C=파고부이, L=등표, J=기상1호로 적음 |
| 해구 격자 | 1,331 | `jq '.features\|length' client/marine_zone_area.json`. 예보가 실제로 들어오는 칸 수는 실시간 값이라 세지 못함 |
| 지방청 | 7 | `REGIONAL_OFFICES` (config.js:604, 에이전트 보고) |
| CCTV | 237 (KBS 30 · 옹진 85 · 해수부 38 · 거제 27 · 부산 48 · 해무 9) | `client/js/.../cctv1.js` `CCTV_PROVIDERS` 길이를 node 로 셈(에이전트 2명이 따로 세어 같은 값) |
| 위험지형 암초 | 6,829 (k0 4,287 · k1 1,778 · k2 658 · k3 106) | `client/hazard_rocks.json` features 를 node 로 셈 |
| 갯바위 면 | 9,959 | `client/shore_rocks.json` features |
| 선박사고 | 59,664건, 2008~2025 | `client/accident_ships_hk.json` rows 수, OCRN_YMD 연도 최소·최대 |
| 인명사고 | 14,354건, 2009~2024 | `client/accident_persons.json` rows 수 |
| 출입통제구역 | 49 | `client/access_control_zones.json` |
| 낚시금지구역 | 236 | `client/fishing_ban_zones.json` |
| 관제(VTS)구역 | 33 | `client/vts_zones.json` |
| 항로·해역 | 144 | `client/seaway_zones.json` (141 + 한중·한일 수역 3, 내역은 에이전트 보고) |
| 너울 소해구 | 233 | 코드 주석(`swell.js:22`, `routes/swell_smallzone.js:9`)에 적힌 값. 실시간 응답으로 세지는 않음 |
| 기준 법률 | 70 | `raw/0*`~`raw/1[0-4]*` 아래 `법률.txt` 70개 (`local_server/knowledge/legal/raw`) |
| 기준 시행령 | 68 (+ 별도 대통령령 3) | `시행령.txt` 68개. 별도 대통령령: `시행령_해양경찰위원회규정`, `시행령_해양경찰분야과학기술진흥에관한규정`, `시행령_긴급중요사건범위등에관한규정` |
| 기준 시행규칙 | 61 | `시행규칙.txt` 61개. 그 밖에 `항만시설장비관리규칙.txt` 1개, 종전 조문 보관본 2개는 세지 않음 |
| 기준 행정규칙 | **704종** | `행정규칙/` 폴더 바로 아래 `.txt` 739개 → 이름 중복(여러 법에 걸친 같은 규칙) 빼면 706 → 수집 메모 파일 2개(`수집시도_…_불확실`, `…확인메모`) 빼면 704 |
| ⚠ 정정 | 처음 보고한 "행정규칙 2,049건"은 틀림 | 그 값은 `행정규칙/` 아래 모든 `.txt`였음. 그림 판독 텍스트(`_이미지/`) 1,287개, 옛 판(`_구판/`) 19개 등이 섞여 있었음 |
| 기준 별표 | 2,173 (법률 1 · 시행령 242 · 시행규칙 408 · 행정규칙 1,522) | `별표/` 폴더 바로 아래 `.txt` 5,212개를 파일 이름으로 나눔: 이름에 "서식/별지" 없고 "별표" 있음 → 별표. 앞머리 `법률_`/`시행령_`/`시행규칙_` 로 층을 나누고, 나머지는 행정규칙 등 |
| 기준 서식(별지) | 3,034 (시행령 2 · 시행규칙 1,617 · 행정규칙 1,415) | 이름에 "서식" 또는 "별지". 그 밖에 `_별도` 5개 |
| 연계 법령 | 폴더 513개 = 전문 234 · 발췌 263 · 국제협약 12 · 기타 4 | `raw/15_관련타부처` 를 python 으로 분류: `법률.txt` 있으면 전문, `*발췌*` 파일만 있으면 발췌, 이름에 국제협약/SOLAS 등이면 협약. 기타 4: 무역특별조치고시, 보안업무규정, 자원재활용법(시행령만), 해양수산부 직제 |
| 연계 전문 법령의 하위법령 | 시행령 89 · 시행규칙 52 | 전문 234개 폴더 안의 `시행령.txt`·`시행규칙.txt` |
| 자치법규 | 조례 412 + 규칙 4 (14개 시·도) | `raw/_자치법규/<시도>/<조례명>/법률.txt` 412개, `시행규칙.txt` 4개. 그 밖에 별표 파일 25개. 처음 보고한 "441"은 별표 파일까지 센 값 |
| 위키 | 1,288 (개념 963 · 법령 74 · 별표 199 · 비교 49 · 활동 1 · 루트 2) | `find wiki -name '*.md' \| wc -l`, 폴더별로 셈 |
| 검수 큐 | 762 (승인 675 · 대기 1 · 제외 86) | 에이전트 보고(미대조) |
| 해점 카드 | 11 | `index2.html:4520-4637` (에이전트 보고) |
| 천기 | 7종 (6종 + 시정예측 RDPS) | 에이전트 보고 |
| 배경지도 | 5종 (07-31 위성지도 추가) | `index2.html:3655-3672` |
| 해상일기도 수치파랑 | 5영역 · 변수 22 | 에이전트 보고. 5/28 기획서는 "4영역". 파랑실황도가 추가됨 |
| 커밋 수 | 5월 445 · 6월 525 · 7월 2,053 · 8월 1,920 · 9월 1,266 (merge 제외) | `git log origin/main --since --until --no-merges --oneline \| wc -l`. 5/1 이전은 shallow clone 이라 세지 않음 |
| PR 머지 | 431 (5/28 이후) | `git log --merges \| grep -c 'Merge pull request'` |
| 앱 버전 | 1.2.2 (versionCode 14) | `android/app/build.gradle` |

---

## C. 일반 사용자에게 보이지 않는 기능 — 소개서에서 뺀 것

| 기능 | 상태 | 근거 |
|---|---|---|
| **GPS '내 위치' 버튼 (전부)** | 숨김. 2026-09-09 위치정보법(위치기반서비스사업 신고) 대상에서 벗어나려고 주석 처리 | `client/index2.html:4023`(지도), `:5415`(해양안전생활 레일), 활동 지도 `:4760·4864·4958·5029·5113·5238`. 너울 `#swell-my-location-btn`(`:5311`)은 주석이 아니지만 `body.ls-mode .life-map-controls-topright{display:none}`(`:655`)로 가려지고, `ls-mode` 는 `life_safety.js:104` 에서 항상 켜짐 |
| 위치기반 특보·태풍 반경 알림 | 관리자 단말 전용 | `client/js/location-alert/location_alert_ui.js:19, 123, 335-343, 415-421`. 앱 실행 시 자동 수집 경로(`capacitor-plugins.js:680-694`)도 관리자 토글로만 켜지는 값을 봄 |
| 설정 "내 주변 바다 기상" | 죽은 코드 | `settings.js:983` 의 대상 버튼 `#my-location-btn` 이 마크업에 없음 |
| **AI 법률 챗봇** | 운영값 `exposure: "admin"` (관리자만). 대회 기간에 공개 예정(사용자 확인) | `curl https://seagnal-server.fly.dev/api/legal/config` (2026-10-03 조회): `{"exposure":"admin","answerCanonicalOnly":true,...,"answerModel":"gpt-6-luna","codexForUsers":false}`. 표시 조건은 `ai_chat.js:2693-2704` |
| 기상 음성 비서 「나리야」 | 앱 안에서는 관리자 전용 | 켜는 곳: 관리자센터 AI탭(`admin.js:775-779`), 별도 페이지 `client/assistant.html` |
| 해역별 특보 예측(beta) | 숨김 | `index2.html:3199-3202, 3246` display:none, 서버 기본 `mode:'off'`(`advisory/displayControl.js:34`). 운영값은 미확인 |
| 튜토리얼(77단계)·온보딩 관심해역 마법사 | 숨김. 공지 탭 5연타 시에만 열림 | `tutorial.js:64-65, 3497-3527` |
| 이안류 지수 | 숨김 | `index2.html:5495` |
| 주요지점(조석표준항 165개) 마커 | 숨김(버튼 09-06 삭제) | `ocean_buoy.js:536-538` |
| 사고정보 검수모드 | 숨김(10연타) | `accident_info.js:822, 6367` |

---

## D. 5월 기획서와 달라진 점 (소개서에 반영함)

1. **「해양안전생활」은 새 5번째 탭이 아님**
   - 기존 「해양생활」 탭을 개편한 것. 하단 탭은 여전히 4개
   - 07-31 숨김 화면으로 도입 → 09-10 정식 공개
2. **CCTV는 해양종합정보에서 해양안전생활 > 해양안전으로 옮겨짐**
   - `index2.html:855-856`, 09-09
3. **해수욕·스킨스쿠버·갯벌체험 지수 반영됨**
   - 5월 기획서에는 "향후 반영 예정"이었음
   - 스쿠버·갯벌 06-07, 해수욕 08-03
4. **새로 생긴 것**
   - 해양안전 8종: 위험지형, 사고정보, 금지구역, 항행경보, 물빠짐, CCTV, 관제구역, 항로
   - 너울, 시정예측, 기압 카드, 위성지도, 태풍 해외 출처 3곳(JTWC·JMA·ECMWF, 09-24 전체 공개)
5. **기상 전망 "AI 활용" 서술 정정**
   - 5월 기획서: "사전 지정 규칙으로 강조"
   - 실제 기본 경로: Gemini(`gemini-2.5-flash-lite`)가 `{{loc:}}`·`{{num:}}`·`{{warn:}}` 태그를 붙이고, 앱이 그 태그대로 색칠함(`marine_forecast_processor.js:322-338`, `regional_bulletin_collector.js:277-285`, `marine_forecast.js:122-146`)
   - 규칙(정규식) 강조는 AI가 실패했을 때만 씀(`marine_forecast.js:148-222`)
   - 운영 서버에 키가 실제로 있는지는 미확인
6. **지방청 통보문 횟수**
   - 기획서의 "1일 3회"는 기온 PDF만 맞음
   - 본문 통보문은 하루 2회 발표분. 소개서에는 둘을 나눠 적음
7. **지방청 표시 방식**: 9/27부터 관심해역이 가장 많은 1곳만 자동으로 표시. 톱니 버튼으로 직접 선택 가능
8. **해상일기도 수치파랑**: 4영역 → 5영역
9. **해점 정보**: 10종 → 카드 11개(시정·기압 추가, 천기 카드)
10. **배경지도**: 4종 → 5종
11. **"과거 10년 해양사고 다발 지역"이라는 기능은 없음**
    - 실제로는 18년치(선박 2008~2025) 사고의 현황 지도와 격자 밀도 분석
    - 소개서에는 실제 기능대로 적음

---

## E. 출처 표기와 실제 코드가 다른 곳 — 앱 안내문 정정 검토 필요

- **유향·유속, 수온 카드**
  - 앱 안내 팝업과 5월 기획서: "해양수치예측모델(ROMS)"
  - 실제 코드: 국립해양조사원 `www.khoa.go.kr/oceandata/oceaninfo/prediction/dynamic-stream-vector.do`(`khoa_stream_cache.js`, `bottom_sheet5.js:143-160`)
  - 소개서에는 "국립해양조사원 해양예측 자료"로만 적음
- **풍향·풍속, 파고·파향**
  - 안내 문구: "RWW3"(`ocean_cctv.js:92,100`)
  - 실제 호출: `apihub.kma.go.kr/api/typ06/url/marine_large_zone.php`
  - 소개서에는 "기상청 API허브 해상예보"로 적음
- **태풍 버튼 배지**
  - 안내 팝업: "빨간 숫자로 개수 표시"
  - 실제: 'N' 표시, 첫 통보 후 48시간만
- **"해경 알림톡 양식"**
  - 푸시 문구 자체는 `push_helpers.js:224-300` 형식
  - 알림을 누르면 뜨는 **기상특보 안전권고 팝업**(`client/fix_popup_logic.js:125-150`, 어선안전조업법 제49조·수상레저안전법 제22조 문구)이 그 내용에 해당함
  - 설정에 팝업 끄기 있음(`index2.html:6675-6685`)

---

## F. 데이터 출처 상세 (엔드포인트)

| 기능 | 실제 주소 (코드 문자열) | 방식 | 주기 |
|---|---|---|---|
| 특보 | `marine.kma.go.kr/mmis_marine_api/v1/kma/warn/list`, `warn/ready`, `warn-sasc/list·ready·latest`, `warn/ef/list`, `warn/ntfctn/list` (`services/marine_client.js:85-96`) | MMIS 웹 내부 JSON(공식 공공API 아님) | 1분 |
| 예비특보 취소 판정 | `weather.go.kr/w/special-report/list.do?stn=..&kind=met/pwn` | 웹 추출 | 필요할 때 |
| 초단기·단기 전망 | `weather.go.kr/w/special-report/list.do` | 웹 추출 → Gemini | 10분 |
| 지방청 통보문 | 같은 `list.do?stn=109/159/156/105/133/143/184` | 웹 추출 → Gemini | 하루 2회 발표분 |
| 지방청 기온 | `weather.go.kr/w/repositary/xml/fct/rpt_wid_day_{ts}_{청}.pdf` | PDF 파싱 | 05:10 / 11:10 / 17:10 |
| 부이 | `apihub.kma.go.kr/api/typ01/url/sea_obs.php` + MMIS `obs/buoy·wh-buoy·lh·vs/list` | 공공API + MMIS | 30분 / 10분대 |
| 기상예보 표 | apihub `VilageFcstMsgService/getSeaFcst`, `MidFcstInfoService/getMidSeaFcst` | 공공API | 하루 2회 |
| 바람·파고·해구 | apihub `typ06/url/marine_large_zone.php` | 공공API | 하루 2회(09:30 / 21:30) |
| 해상일기도 | `weather.go.kr/w/wnuri-img/rest/cht/images/ocean-wave.do`, `ocean-forecast.do`, `sat/images/water-temp.do` | 웹 이미지 | 요청할 때 |
| 천기·시정 | MMIS `v1/kma/shrt/netcdf/imgList`, `v1/kma/mdl/rdps/imgList` | MMIS 이미지 | — |
| 해류·수온 | `www.khoa.go.kr/oceandata/oceaninfo/prediction/dynamic-stream-vector.do` | 웹 엔드포인트 | 72시간분 |
| 조석 | `apis.data.go.kr/1192136/tidebed/GetTidebedApiService` | 공공API | 3일분 |
| 생활지수 | `apis.data.go.kr/1192136/fcst{Fishing,Surfing,Beach,SkinScuba,Mudflat,SeaSplit}v2` | 공공API | scheduler |
| 해무 CCTV | data.go.kr `seafogCctv/GetSeafogCctvApiService` | 공공API | 10분 |
| 항행경보 | data.go.kr `NavigationalWarning/getNavigationalWarningInfo` + KHOA 상황판 내부 API(좌표) | 공공API + 웹 추출 | 실시간 |
| 너울 | MMIS GeoServer WFS `mmis:marine_zone_swell` | 웹 데이터 | — |
| 항로 | KHOA WFS `vi_seaway` | 웹 데이터 | 매월 말일 |
| 기압 | `api.openweathermap.org/data/2.5/weather`, `/forecast` | 해외 API | — |
| 태풍(기상청) | `dmdw.kma.go.kr/rsw/mfp/typ/rswTypInfoRetrieve`, `rswTypTdRetrieve` | 로그인 후 웹 추출 | — |
| 태풍(해외) | JTWC `www.metoc.navy.mil/jtwc/products/abpwweb.txt` 등, JMA `www.jma.go.jp/bosai/typhoon/data/targetTc.json`, ECMWF `data.ecmwf.int/...-tf.bufr` | 공개 파일 직접 읽기 | 15~30분 캐시 |
| 배경지도 | 해아름 WMS `www.khoa.go.kr/oceanmap/` (BASEMAP_RLTM3857 / ENC573857 / RLTMCOAST3857) + OSM + 브이월드 WMTS | — | — |
| 법령 | `law.go.kr` `lawService.do?target=law&MST=` | 공공API | 개정 감지 스캐너 |
| 법률 챗봇 답변 | Gemini `gemini-2.5-flash`(`legal_retriever.js:85`), Codex(ChatGPT) 모드(`codex_bridge.js`). 운영 설정 `codexForUsers:false` → 일반 사용자는 Gemini | 외부 AI API | — |

---

## G. 법률 챗봇 품질 수치 (내부 참고 — 발표에 쓸지는 판단 필요)

- HANDOFF 기록 기준, 미대조
- **22차** 라이브 검증 정답률: 69.2% (08-20)
- **27차** 실제 챗봇 질의 291문항 중 284문항 채점
  - 원문과 일치 57.7%
  - 일부 일치 7.0%
  - 엉뚱한 조문 4.2%
  - 근거 없음 24.3%
  - 되묻기 6.3%
- 소개서에는 정답률을 쓰지 않고 "27차 품질 감사"만 적었습니다. 숫자를 내세우기에는 아직 개선 중인 단계로 판단했습니다.

---

## H. 운영상 참고 (발표 내용과 별개)

- **법률 챗봇 서버 쪽 공개 범위**
  - `/api/legal/ask` 는 노출 설정을 검사하지 않음(`routes/legal.js:1560~`)
  - 즉 숨김은 앱 화면에서만 걸려 있음
- **기상 음성 비서 서버 쪽 공개 범위**
  - `seagnal-server.fly.dev/assistant.html` 이 외부에서 열림
  - `POST /api/assistant/ask` 는 관리자 인증 없이 IP당 분당 20회 제한만 있음(`routes/assistant.js:1010-1030`)
  - AI 비용이 새어 나갈 수 있는 경로
- **API 키가 코드에 그대로 들어 있음**: `scheduler.js:161` 에 기상청 API허브 인증키
- **업데이트 팝업 기준 파일이 낡음**: `client/app_version.json` 이 `latestVersion 1.1.1` 에 머물러 있어 1.2.2 사용자에게 업데이트 팝업이 뜨지 않음

---

## I. 소개서 서술 중 사용자 현장 판단에 근거한 것

- **7-2 핵심 강점 ②** (기상청 홈페이지가 해제 예고 시 미래 해제 시점을 미리 반영해 띄운다)
  - 사용자(개발자)의 현장 확인 내용이다. 기상청 홈페이지 동작은 저장소에서 확인할 수 없다.
- **앱 쪽 근거**
  - 특보 상태는 기상청 MMIS 의 현재 유효 특보 목록(`warn/list` 등)을 1분마다 받아 정한다.
  - 해제 예정 시각은 카드에 「해제예정」 줄로 따로 표시한다(`client/js/forecast/alerts/render.js:905`, `render_coastal.js:454`).
  - 목록에서 사라진 특보는 해제 예고가 있으면 정상 해제로 처리한다. 예고 없이 사라지면 3분간 지켜본 뒤 해제로 판단한다(`local_server/marine_warning_crawler.js:1575-1585`).
- **7-2 핵심 강점 ①** (다른 국가기관 앱에서 연안바다·평수구역 특보를 찾기 어렵다)
  - 사용자 현장 판단이다. 5월 기획서에는 "특정관리해역 정보까지 제공하는 앱은 유일(기상청 MMIS 는 웹페이지로 제외)"이라고 적었다.
