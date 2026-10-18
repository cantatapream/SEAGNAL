# 실행과 검증

저장소 루트에서 `npm ci --legacy-peer-deps` 후 `node local_server/server.js`로 서버를 실행한다. 실제 앱은 `/`, 같은 제품 모듈만 담은 검증 화면은 `/risk_forecast_preview.html`이다. 미리보기는 실제 API를 사용한다. URL의 `fixture=1`로 운영 자료를 바꾸지 않는다. 자동 브라우저 시험의 예시 응답은 요청 가로채기로 주입한다.

지도 클릭은 `ocean_map.js`의 `_riskForecastTryHandleClick`으로 들어온다. 해양안전에서만 버튼이 나타나며, `life_safety.js` 단독 오버레이 목록에 등록되어 기존 레이어와 동작을 맞춘다. 계산 모듈을 프론트엔드에 복사하지 않는다.

## 연안 합계 배수 설명 — 과제15

~~연안 상세에서 “사고 배수는 어떻게 합쳤나요?”를 펼치면 서버가 반환한 요소별 점수·합계와 사망·실종 계수의 곱을 확인한다. `RiskSheet.coastCalculation`은 `rows.score` 합계와 `score/rr`, `rows.fatalRr` 곱과 `fatalRr`의 일치를 확인하고 설명한다. 계수를 다시 추정하거나 판정하지 않는다. 계약이 맞지 않으면 계산식을 만들어 표시하지 않는다.~~ **(2026-10-18 삭제 — 사용자 「빼자.」: 계산 방법은 [기준 상세] 「배수를 읽는 법」·PDF 「연안 위험지수 산출근거」에 있어 시트의 「사고 배수는 어떻게 합쳤나요?」 아코디언과 `RiskSheet.coastCalculation` 을 없앴다.)**

**2026-10-18 보충**: 지운 아코디언의 설명 가운데 [기준 상세]·PDF 에 실제로 없던 것(반올림 표시값을 다시 곱하면 조금 다를 수 있음 · 사망·실종 배수는 사람·위험구역·월별 계수만 반올림 전에 곱하고 행사·너울·이안류는 곱하지 않음 · 계산 예)을 확인해 [기준 상세] 「요소마다 곱해서 → 위험지수」·「사망·실종 사고 배수」와 PDF 연안 6.6절 「위험지수 상자의 두 배수를 만드는 법」에 넣었다(종전 문구가 가리킨 「배수를 읽는 법」에는 계산 방법이 없었다). README 「기준 상세 문안·산출근거 PDF — 최근 화면 변경 반영 (2026-10-18)」.

사람 평소의 8배·위험구역 11곳(연안사고 위험구역 6·사망사고 발생구역 2·연안사고 다발구역 3)·10월 예시는 `2.91 + 2.452601 + 0.07 = 5.432601`, `2^5.432601 ≈ 43.2배`, 사망·실종은 `3.652264 × 5.646016 × 1.06 ≈ 21.9배`다(U81, 2026-10-15 — 종전 「사람3단계·위험구역11곳·사망사고 구역」 예시 `2.91 + 1.74 + 0.37 + 0.02 = 5.04`는 이력). 월 요인과 반올림 차이를 설명한다. 너울·이안류 정책 점수는 전체 사고 점수에만 더하며 사망 계수를 추가하지 않는다. 입력이 빠지면 확인된 요소 기준의 상대 지표이며, 실제 사고확률(%) 또는 개인 확률이라고 표시하지 않는다. 색상 범위·지수·기존 모델 계수는 이 과제에서 변경하지 않는다.

## 정적 공간 자료

`local_server/config/coastal_safety/risk_spots.json`은 1,354개 관광지의 인접 관광지 분할 및 육지 교차 다각형과 주변 위험구역을 보관한다. `rip_spot_map.json`은 이안류 관측 매핑이다. 원본 공간 자료가 바뀌면 아래 명령으로 다시 만든다.

```sh
python3 -m pip install shapely==2.2.0 pyproj==3.8.0
node local_server/scripts/build_risk_static.js
```

34개 관광지는 육지 교차 면이 없거나 같은 좌표의 영역을 다른 관광지가 소유해 빈 MultiPolygon으로 남는다. 관광지 정보와 유효한1,320개 면을 유지하며 빈 면은 중심점으로 선택한다. 같은 좌표의 관광지는 이름 선택 목록을 표시한다. 바다에 새 연안 면을 만들지 않으며, 빈 면을 OpenLayers에 전달해 나머지 표시가 실패하지 않도록 처리한다.

Python·Shapely·pyproj는 정적 자료를 만드는 때만 필요하다. 앱 서버는 생성한 JSON을 읽으며 Python을 실행하지 않는다. 섬 외곽선은 API의 `islands`로 받는다(섬 `features` 만 — 2026-10-16 공통 육지 geometry `landGeometry` 는 화면이 쓰지 않아 응답에서 뺐다, README 「지도 버벅임 1단계」). 특보 경계(`/api/warn-zones`)는 읽지 않는다(2026-10-15 특보 영역 미표시).

## 응답과 결측

`meta`의 `now`와 `timeline.coast/sea.times`를 슬라이더에 사용한다. `versions.spots/cells`가 바뀌면 대응 표를 다시 읽는다. `coast/frame`의 `spots`와 `sea/frame`의 `cells`는 정적 표의 `i`를 참조하는 배열이다. 두 층의 프레임·상세에는 슬라이더에서 선택한 같은 시각을 전달하고 원천 예보의 간격 매칭은 서버가 한다. 상세 응답의 `score/index/band/rr`를 그대로 표시하고, `rows`, `notices`, `missing`을 문장 틀로 옮긴다. 특보 없는 날의 예보 배수·사유·반영 여부는 파고·풍속 행에 표시한다. 후보가 동률이면 파고 행 한 곳만 반영 표시한다. 기준 PDF는 `report/sea`와 `report/coast`에서 내려받는다.

초기 일부 요청이 실패해도 다시 켜기나 다음 60초 갱신에서 재시도한다. 꺼진 뒤 늦게 도착한 오류는 배너를 다시 열지 않는다. API 캐시는 지점·섬 1일, 해상 칸 1시간, 상세·프레임·meta 1분이며 주기 meta 요청은 캐시를 건너뛴다. 수집기의 상태·자료 시각은 서버가 판단한다. 상태 계산은 `missing/error/stale`를 구분한다. 공통 원천 오류 안내와 마지막 정상 수집시각은 관리자 AI 사고예측 오류현황으로 이전했고 공개 지도 배너는 숨긴다. 월말 행사는 선택 날짜의 월별 상태를 사용한다. `/status`는 매 요청 최신 상태를 읽고 집중률 매칭수·전체수와 행사 마지막 시도시각도 전달한다. 실패 진단 로그에는 오류 종류와 숫자 HTTP 상태만 넣어 원천 URL·API 키·응답 본문을 출력하지 않는다. 특히 혼잡도 수집 실패에는 날씨 위험색을 유지하고 자료 없음으로 표시한다.

## 공공 API 명세 대조

관광지 집중률은 사용자 첨부 `한국관광공사_OpenAPI_활용매뉴얼(관광지집중률방문자추이예측정보)_v4.1`을 기준으로 한다. 호출 주소는 `B551011/TatsCnctrRateService/tatsCnctrRatedList`이며 필수 항목은 `serviceKey`, `MobileOS`, `MobileApp`, `areaCd`, `signguCd`다. `_type=json`, `pageNo`, `numOfRows`를 함께 보내고 선택 검색 항목은 `tAtsNm`이다. 응답 관광지명도 대소문자를 포함해 **`tAtsNm`**이며, `baseYmd`와 `cnctrRate`로 날짜별 값을 연결한다. 공식 XML 예제의 7개 응답 필드를 수집기 회귀 검사에 반영했다. 앱의 시군구 코드 60개는 첨부 코드표에 모두 있다.

사용자가 제공한 해양교통 혼잡 예보 REST 화면과 당일 F12 성공 기록에서 GET 주소 `B554035/sea-tfc-congst-fcst/get_sea_tfc_congst_fcst`, `fcstDate=YYYYMMDD`, `fcstTime=HHmm`, `gridLevel=4`, `type=json`, `pageNo`, `numOfRows`를 확인했다. 공공데이터포털의 공개 Swagger2.0 명세도 같은 필수 항목7개를 제공한다. 기존 서버 키와 사용자 키의 디코딩 후 일치 여부를 확인했고 값은 기록하지 않았다.

사용자의 2026-10-11 13:00·격자4 직접 GET은 HTTP200·`200 / NORMAL_SERVICE`, 전체5,666개였다. 첫10개 응답은 현재 파서가 모두 받아들이며 같은 시각 MTIS 표의 좌표·혼잡 단계·풍속·파고와 불일치0건이다. 공통 요청기는 정상 코드200/메시지 조합을 허용하고 `153 / NOT_FOUND_DATA`를 성공으로 취급하지 않는다. 과거10월10일12시 성공의 전체6,165개와 당일 자료를 구분한다.

클라우드에서는 동일 경로·조건·인코딩의 공공 API 요청이 HTTP400·코드10을 반환한다. 사용자 성공 요청의 실제 주소를 이미 확보했으므로 주소 미확보를 남은 조건으로 제시하지 않는다. 일반 브라우저 헤더와 Node/curl 전송도 대조했지만 원인은 미확정이다. 인증키나 쿠키를 문서·시험 파일에 기록하지 않으며 오류를 정상 자료로 대체하지 않는다.

MTIS 공개 웹의 지도·표 POST는 새 익명 세션으로 클라우드에서 HTTP200·5,666개를 확인했다. 이 웹 계약의 실제 좌표는 `ctrptYCrd=경도`, `ctrptXCrd=위도`이며, 지도 문자열 `"null"`과 표 JSON null은 결측으로 해석한다. 응답과 엑셀 설정에는 수치 `congestionIndex`와 생성시각 `fcstCreateDateTime`이 없어 기존 공식 수집기의0.1 필터·상세값을 대체할 수 없다. 단계에서 숫자 혼잡지수를 만들어 넣지 않는다. 구체적인 증거와 실제 수집의 남은 제한은 [검증 기록](validation.md)에 남긴다. (2026-10-15: MTIS 웹 화면 자동 접속은 이용약관 때문에 코드에서 없앴다 — 이 단락은 조사 기록으로만 남긴다. 아래 「MTIS 웹 수집 제거」.)

## 검사

```sh
node local_server/scripts/test_risk_format.js
node local_server/scripts/test_risk_preview.js
node local_server/scripts/test_risk_lifecycle.js
node local_server/scripts/test_risk_map_layer.js
bash scripts/refactor/verify_all.sh
```

서식 검사는 0~100 모든 숫자 상자의 명암비, 색 기준, DMS 올림과 HTML/URL 보호를 검증한다. 전체 지도 자료 검사는 실제 1,354개 관광지, 육지 원천, 21개 섬을 제품 OpenLayers에 넣어 빈 형상 처리와 반복 렌더링을 검증한다. `PW_CHROME` 또는 `SIM_CHROMIUM`으로 설치된 브라우저 실행 파일을 지정할 수 있다. 생명주기 검사는 초기 부분 실패의 복구, OFF 뒤 늦은 응답, KST 날짜 이동 및 API TTL을 검증한다. 전체 검사의 `simulate.js`는 실제 앱 위험예측 버튼의 기본 층과 OFF 동작을 확인하며, 이 새 시나리오는 기존 기준선에 없어도 실패를 보고한다. 외부 지도·기상 API 연결의 환경 실패는 실제 코드 오류와 구분해서 검사 결과에 남긴다.

브라우저에서는 초기 연안만 켜짐·시트 닫힘, 선택 후 DMS, 해상 16방위·3자리 방위각, 선택 층 OFF의 시트 닫힘, 기준 상세의 Escape와 초점 복원, 위험구역 주소 클릭의 지도 이동을 확인한다.


## 2026-10-11 설계 대조 수정의 데이터 계약

서버는 입력 파일의 mtime·size·inode를30초마다 확인해 변경 시 프레임·상세 캐시를 모두 무효화한다. 같은 입력·KST 날짜·자료 상태·시각의 계산은 재사용한다. 프레임 최근8개와 상세 최근6,000개만 보관하여 한계 없이 메모리가 늘지 않게 한다. 모든 미래시각을 선계산하지 않고 요청한 시각만 계산한다. `/status`는 이30초 확인을 기다리지 않고 최신 상태를 읽는다.

집중률 첫 주에는06:20/12:20 수집 결과의 변경 여부와 관측시각을 기록한다. 원천 갱신시각이 응답에 없으므로 관측 간격을 원천의 정확한 갱신시각이라고 부르지 않는다. 행사 수집은 공식 TourAPI 목록과 Gemini 검색을 병합하며, 주소·날짜·출처를 확인하고 Kakao 검색 결과의 실제 주소를 검증한다. 공식 목록의 출처는 `sourceType=tourapi`·`contentId`와 함께 원천 API로 표시하며 추정한 행사 기사 링크를 만들지 않는다. 행사월별 상태를 보관하고 누락/실패한 당월 및 예정일 이후 다음 달을 하루03:20에 다시 시도한다. 정상 월은 재수집하지 않는다.

공공 API 혼잡도 수집 계약은 오늘00시~내일23시48시각으로 통일한다. 화면 시간축은 지금부터이며, 과거시각까지 수집하는 계약과 구분한다. 공식 API00시 제공 여부와 실제 운영 수집 성공은 모의 검사로 증명하지 않는다. 모든 행사 검색이 빈 결과일 때는 계속 실패로 표시한다. ‘실제 행사0건’과 ‘조사 실패’를 구분할 원천 근거 없이 정상0건으로 저장하지 않는다.

공식 행사 목록은 매뉴얼의 목표월 시작·종료일 조건으로 조회하고, 직전 월에서 목표월까지 이어지는 행사는 보충 검색 후보로 전달한다. 이전 캐시만으로 당월 개최를 확정하지 않고 현재 원문 검색에서 재확인된 결과만 반영한다. 이전에 시작한 장기행사가 빠질 수 있어 `coverage.completeOngoing=false`로 표시한다. 임의 기간을 과거로 확장해 완전 수집이라고 주장하지 않는다. Gemini 보충 검색도 모든 행사를 찾는다는 보장은 아니다.

집중률·행사의 실패·낡음 상태에서는 보존한 이전 파일을 정상 점수에 쓰지 않고 해당 요소를 결측0점으로 처리한다.
**사람 혼잡(U81, 2026-10-15)**: 점수 = `0.97 × max(0, log2(오늘 집중률 ÷ 그 관광지 30일 기하평균))`(연속값, 평균 이하 0). 30일 기하평균은 수집기가 원천 응답 전부(오늘부터 약30일)로 관광지마다 계산해 `tour_concentration.json` 의 `avg30:{관광지id:{gm,days}}` 에 숫자 하나만 남긴다(0 제외 · 30일 값 자체는 버림 — 「가」의 예외). `avg30` 이 없는 파일이면 사람 요소는 결측이며, 운영 재기동 때 오늘 파일이라도 `avg30` 이 없으면 한 번 다시 받는다. 시트 사람 줄 표시(2026-10-15 검토): 30일 평균은 소수 한 자리(17.3205 → 17.3), 배수는 2배 미만이면 소수 둘째 자리(1.03배 — 뒤의 「N% 높은」이 정수 %라 같은 1% 단위로 맞춤, 종전 소수 한 자리로는 「1.0배라 3% 높은」처럼 어긋나 보였다)·2배 이상은 소수 한 자리(`risk_sheet.js` `crowdTimes`·`crowdBase`, 시험 `test_risk_format`). 2배 판정은 소수 둘째 자리로 반올림한 값으로 한다(1.995 → 「2.0배」, 2차 검토 D8). 사고 가능성이 반올림해 0% 면(예: 1.00배) 점수가 0보다 커도 사람 줄을 그리지 않는다. 30일 평균이 없으면(null·빈 값) 「0.0」이 아니라 빈칸. **위험구역(U81)**: 종류마다 `0.43914 × log2(min(개수,3)+1)` 을 세 종류 더한다(사망사고 발생구역 가산 줄 `fatalZone` 없앰). 구역 종류(`zones[].구역분류`)를 확인할 수 없으면 위험구역은 결측이다. 근거: 보고서 v3 §13. 집중률 첫주 관측 요약은 `/status`의 `sources.tourConcentration.observation`에도 KST ISO 시각으로 전달한다.


## 공식 선박 사고예보와 혼잡예보 통합 — 2026-10-11

이 항목은 기존 해상 자체 분석 표시보다 우선하는 사용자 결정이다. 연안 관광객 분석에는 MTIS 선박 사고예보를 적용하지 않는다.

- 공식 API: `GET https://mtisopenapi.komsa.or.kr/eopt/api/sea-acdnt-risk-fcst-info`. 사고 전용 `MTIS_ACCIDENT_SERVICE_KEY`를 환경 시크릿으로 사용한다. 혼잡 API의 ROMS 키와 분리하며 클라이언트·로그·커밋에 키를 넣지 않는다.
- 수집기: `sea_accident_collector.js`. 오늘00시~내일21시의 16개 3시간 예보를 순차 수집한다(종전 모레21시·24개 — 아래 「해상 공식 사고예보 2일 제한 — 2026-10-15」). 기상 항목은 저장하지 않으며 격자표는 공통으로, 각 시간대는 `[i, accidentRiskIndex, accidentRiskLevel]`로 저장한다.
- 격자 경계: `mtis_accident_grid.js`. API 중심점에서 그 칸의 경계를 계산한다(웹 메르카토르 5,000m 격자 — 종전에 공개 MTIS 사고 지도에서 받아 운영에 저장한 5,406칸과 최대 8.5e-14도 차이). 중심이 칸 한가운데에서 1e-6도 넘게 벗어나면 격자 정의 변경으로 보고 정상 캐시를 교체하지 않는다. (2026-10-15 전: 공개 웹의 새 익명 세션에서 경계를 받았다 — 이용약관 때문에 없앴다.)
- 갱신: Fly 운영에서 최초 누락본 수집 및03:10·15:10 KST 버전 확인,04:10·16:10 재확인. 생성시각이 같은 완전한 당일 자료는 다시16개 받지 않는다. 페이지와 시간대의 생성본이 섞이거나 부분 실패하면 기존 정상 파일을 보존한다.
- 저장: `data/risk_forecast/sea_accident.json.gz`. 공통 격자표와 작은 프레임 배열만 보관한다. 메모리 측정에서의 전체 웹 원문24개 유지 방식과 다르다. 실제 운영 메모리는 격자 수·동시 갱신·압축 버퍼에 영향을 받는다.
- API: `sea/accident-cells`, `sea/accident-frame?t=...`, `sea/accident-cell?id=...&t=...&lon=...&lat=...`. `meta.timeline.accident`와 `versions.accident`로 시간축·공통 도형을 갱신한다. 상세의 클릭 좌표가 해당 사고 도형에 포함되는지 검사한 뒤 겹치는 원래 GR4 혼잡칸을 찾는다. 경계 위에서 여러 혼잡칸에 포함되면 `congestionMatches`로 모두 전달한다.
- 시간: 혼잡은2일·1시간, 사고는2일·3시간이다(종전 사고3일 — 2026-10-15 2일 제한). 예를 들어13시 선택의 혼잡은13시, 사고는12시 원본이며 각각 실제 예보 시각을 표시한다. 종전의 「모레에는 사고예보만 표시」 구간은 2일 제한으로 없어졌고, 혼잡을 다른 시각 값으로 연장하지 않는 규칙은 그대로다. 사고지수·단계를 보간하거나 사고 발생 확률로 변환하지 않는다.
- 기상: 사고 예보 정시와 같은 시각의 해구별 예보를 사용한다. 기상청 출처·실제 예보 시각·해구를 표시하고 공단 모델 입력값과 같다고 주장하지 않는다. 기상 항목이 없으면0으로 채우지 않는다.

운영 키는 Fly.io 시크릿에 설정한다. Codex 클라우드 시크릿과 Fly.io 시크릿은 서로 자동 전달되지 않는다. 환경 설정에 이름·대상 도메인을 저장한 사실은 키 주입·실제 API 수집 성공을 뜻하지 않는다. 실제 API의 응답 외피·페이지 최대행·호출 허용량은 실호출로 확인해야 한다. 구현의 일90건 장부는 앱 자체의 보수적 제한이며 제공기관의 허용량이라고 표시하지 않는다.


공식 사고 캐시의 재사용은 `complete`/`validCell` 검사로 공통 셀과16개 정확한 슬롯의 모든 행·인덱스·공식 단계·수치를 확인한 뒤 허용한다. 빈 프레임16개가 있는 손상 파일을 정상본으로 인정하지 않는다. 2일 제한 전에 저장된 24칸 파일도 칸 수가 달라 완료본이 아니며 다음 수집에서 16칸으로 다시 받는다. `accident-frame`과 상세는 경계 버전 `v`를 포함한다. 화면은 표와 프레임의 `v`가 다르면 한 번 새로 조회하고, 계속 다르면 해당 면을 표시하지 않는다. `fresh` 요청은 메모리 캐시뿐 아니라 브라우저 HTTP 캐시도 `cache:no-store`로 우회한다. 경계 버전 변경 시 캐시와 공통 표를 무효화하고 생성시각만 변경되면 경계는 재사용하면서 위험 프레임을 새로 받는다.

## 과제1: 휴대폰 뒤로가기

실제 열린 관광지 선택목록·상세·오류 시트는 기존 `PopupStack`의 `risk-forecast-sheet`에 등록한다. 기준 설명창은 `risk-forecast-basis`에 쌓여 첫 뒤로가기에서 기준창, 다음에서 시트를 닫는다. 주기 상세 갱신은 스택 순서를 바꾸지 않는다. 직접 닫기·층 OFF·전체 OFF·destroy는 항목을 제거하며, 지연 응답이 닫힌 시트를 다시 열지 않는다. 시간 선택은 닫기로 초기화하지 않는다. 후속 과제6의 즉시 스켈레톤도 열린 순간 같은 스택에 등록해야 한다.

## 해상 통합 확장
`risk_marine.js`의 render·briefing·history는 서버 분석을 HTML로 표시하고, 모든 원천 문자열을 escape한다. 공식 단계와 현재 척수의 기준·시각을 분리한다. 해상 상세와 관할 브리핑은 sea/analysis와 sea/briefing의 같은 종합 결과를 사용한다. 현재 수집은 sea_realtime_collector(공식 API 전용, 2026-10-15 웹 수집 제거), 반복 예보 저장은 marine_congestion_codec, 분석은 marine_fusion이다. 상세 계약과 후속 과거자료 작업은 [marine_fusion.design.md](marine_fusion.design.md)에 기록했다.

### 해상 시트 위 카드 [?]·설명 문장 (2026-10-16)

사용자 원문: 「사고위험도는 총 4단계(5km*5km 격자 단위)로 표출 - 낮음(위험도 상위 50% 미만) - 보통(위험도 상위 15~50%) - 주의(위험도 상위 5~15%) - 경계(위험도 상위 5% 이내) 이 내용이 표로 잘 들어가도록 해줄래 ?」 · 「「실시간·예측 결과」 이렇게 반영하자.」 · 「어절단위로 잘라 표시하되 자름으로써 오른쪽 공간이 많이 남으면 자간을 좀 줄여서 꽉 차게 만들어줘.」

`risk_marine.js` `hero`가 두 줄(위험 예측 / 밀집도·혼잡도) 오른쪽 위에 [?](`helpBtn`)를 두고, `attach`가 `openHelp`로 사고 종류 팝업과 같은 틀(`showPop`, `.rf-acc-pop`)에 설명·표를 띄운다. 표 행은 `HELP` 상수 한 곳(혼잡도 표는 2026-10-16 실제 응답 경계 1·10·20 으로 바꿨다 — 사용자 「1-(나)」, 서버 밀집도 단계도 같은 경계 「그럼 ㄱ으로 하자」). 혼잡도·밀집도 색은 위험 예측과 같은 4색이다(「그냥 해양쪽과 같은 색상을 사용하자.」, 상세는 README 「혼잡도·밀집도 색 = 위험 예측 4색」). 위험 예측 설명 문장은 「최근 5년 간의 해양사고, 기상예보 등의 정보를 활용, 인공신경망의 한 종류인 MLP모델을 사용하여 사고위험도를 예측」이며 `fitText`가 어절 단위 줄바꿈 뒤 줄 끝이 많이 비면 자간을 -0.06em 까지 줄여 다음 어절을 당긴다(폭이 바뀌면 다시, 실패하면 원래 문장). 상세는 [README.md](README.md) 「위 카드 [?]·설명 문장 — 2026-10-16」.

### 날씨 아코디언 특보 상자·접힌 제목 줄 「특보」 (2026-10-16)

사용자 원문: 「3-1, 2 추천대로, 3 띄우지마」 (②접혀 있어도 제목 줄에 「특보」 표시 · ③자료가 낡았을 때 「특보 정보 확인 불가」 안내는 띄우지 않음).

| 함수 | 하는 일 |
|------|---------|
| `activeWarns(m)` | `marine.warnings` 가 `status:'ok'` 이고 `items` 가 있으면 그 목록, 아니면 빈 목록. 아래 두 함수의 **유일한 조건** |
| `warnBoxes(m)` | 펼친 몸통 「파도」 위 특보 상자(`.rf-warn-box`) — `activeWarns` 각 항목. 테두리 점선(2026-10-18): 발효 빨강, `state:'예비'` 항목은 `data-state="예비"` 노랑 「… 예비특보 발표」(지금 서버는 예비를 보내지 않음) |
| `warnBadge(m)` | 제목 줄 꺾쇠 앞 작은 「특보」(`.rf-warn-badge`, 흰 글자·#d32f2f·테두리 #ff4d4f) — `activeWarns` 가 하나라도 있으면 |

- 표시는 펼쳐도 남긴다(제목 줄은 접힘·펼침에 같고 꺾쇠만 돈다). 시각을 바꾸면 `render` 가 다시 그려 함께 바뀐다.
- 수정 시 주의: 상자·표시 조건을 따로 쓰지 말 것 — `activeWarns` 만 고친다. 자료 상태(stale·missing·error)를 화면 안내로 바꾸지 않는다(사용자 「3 띄우지마」). `test_risk_sea_sheet_ui` 가 「표시 있음 ⇔ 상자 1개 이상」·대비 4.5 이상·380px 제목 줄 넘침 없음·「확인 불가」 글자 없음을 잰다.

## 과제11: 월말 행사 수집과 프롬프트

행사 수집은 KST 달력의 말일−3일03:20에 다음 달 누락/실패 자료를 수집한다. 정상 월 캐시는 유지하며 원래 예약과 재시도 로직은 변경하지 않았다. 기존 요약 검색 문구를 수상·해안 육상·낚시·야간·물때·지역/계절축제·해수욕장 개폐장·에어쇼·함정 공개로 확장하고 목표 월 범위를 명시했다. 전월 후보는 현재 공식 원문으로 재확인하며 실제 주소/기간과 HTTPS 원문을 요구한다. 실제 템플릿·검증 범위·grounding/공식 소유 도메인 확인의 한계는 [행사 수집 프롬프트](coastal_events_prompt.design.md)를 본다.

## 2026-10-14 혼잡예보 정기 확인 메모리

`sea_traffic_collector.tick`은 KST04:00/04:30/05:00/05:30, 실패한 날은 06:30~12:30 매시 30분(2026-10-15 변경, 그 전 05:10/06:10/07:10)인지 먼저 확인한 뒤 당일 정상 파일을 읽는다. 다른 분에는 압축된2일치 예보를 읽거나 외부 API를 호출하지 않는다. 시작 시 누락 수집과 부분 실패 재시도는 유지한다. 그래프·운영 로그 분석과 한계는 [분석 기록](../../../../00_docs/operations/2026-10-14-memory-log-analysis.md)에 있다.
## 과제12: 기본 위성지도

위험예측을 켜면(`setEnabled(true)`) 지도 배경이 위성지도(브이월드, `oceanSetBasemap('vworld')`)로 바뀐다. 기존 앱이 위성지도 선택에 쓰는 같은 레이어와 인증키를 그대로 쓰며 새 지도 공급자나 키를 추가하지 않았다. 켜기 전 배경(해안도·기본맵·전자해도·세계지도)은 `oldBase`에 한 번만 기억하고, 끄거나(`setEnabled(false)`) 조율기를 없앨 때(`destroy`) 그 배경으로 되돌린다. 이미 켜진 상태에서 다시 켜도 `oldBase`를 덮어쓰지 않아 위성지도가 원래 배경으로 굳지 않는다. 꺼진 채로는 배경을 전혀 건드리지 않으므로 다른 탭의 지도 배경은 바뀌지 않는다.

위성 인증키를 못 받으면(`window.oceanVworldReady()`가 false) 빈 배경을 정상처럼 두지 않고 켜기 전 배경을 유지하며(원래 배경이 위성지도였다면 해안도) 배너에 “위성지도를 불러오지 못해 기존 배경지도를 유지합니다”를 남긴다. 이 안내는 자료 갱신으로 배너가 다시 쓰여도 유지되고, 위험예측을 끄면 사라진다. 위성 타일 자체의 개별 적재 실패는 감지하지 않는다(기존 위성지도 선택과 같은 한계).

위험예측 격자·원·테두리·육지 마스크는 배경과 별개인 자체 canvas 층(`rf-*-canvas`, zIndex 130 이상)이라 배경이 바뀌어도 코드 변경이 필요 없다. 위성지도는 줌 한계가 19로 올라가고 파티클 오버레이(조류·바람·파고)는 기존 규칙대로 해안도 밖에서는 꺼진다. `test_risk_basemap`이 전환·복원·실패 안내를 고정한다.

## 2026-10-13 해상 지도 조작·성능·실패 복구

`bindApp`의10회 트리거는 현재 페이지에서만 유효하다. `nextTime`은 선택시각을3시간 정시에 내린 뒤3/6/12시간을 더하고 공개48시간 조회축 안에서 선택한다. 예보 없는 시각을 가짜 데이터로 보충하지 않는다. `marineTime`은 고정output과 끝 범위 버튼·전체OFF 가시성을 갱신한다. `modeBadge`는3개 배타적인 하위 스위치·뱃지·아코디언을 연결한다. 기존 위험지형과 동일한 공통 클래스이며 모드별 임의의 중복 색층이 없다.

`refreshMarine`은 연안 frame과 병렬로 실행되어 먼저 완성되는 정상 해상값을 그린다. 부가 경계는 초기 표시의 필수 의존성이 아니고, 일시 fetch 연결 중단/5xx는 API 클라이언트가300/900ms 간격으로 최대3회 시도한다. 영구4xx나 잘못된JSON은 반복하지 않는다. 정상 캐시만 유지한다. 서비스워커는 API를 계속 캐시하지 않고 정적 파일 실패 promise를error Response로 처리한다.

`renderUnified`는0.25도 위치 인덱스로 현재 화면+128px 주변만 골라 그린다. resolution80 이상은 동일 색상을MultiPolygon으로 묶고, 미만은 개별feature를 재사용한다. 색상 스타일은256개로 제한하고 화면 밖 오래된 형상은8,000개 초과 시 버린다. 원시수치·공식 단계는 바꾸지 않으며 클릭은 원래 공통 격자 공간 포함으로 해석한다. blur는 완성된 면 canvas에1회, 육지 마스크는 그 다음이다. `unifiedCells`는 입력 버전과 실시간 파일 서명으로 재사용하고 전달 필드를id/i/lon/lat/displayOnly로 줄인다. 사고 공간 대응은 표 버전당1회 계산한다. 이 렌더링 개선이 서버OOM 해결을 의미하지는 않는다.

이 화면의 관할 브리핑 목록/버튼/자동 관할조회는 제거했다. 서버`sea/briefing`과renderer는 나중 메인 브리핑을 위해 남기되 현재 화면에서는 접근하지 않는다.

관할 문구(2026-10-15)는 `RiskFormat.stationLabel(파출소, 해양경찰서)`로만 만든다 — 해상 부제는 `analysis.marine.station`+`office`, 연안 부제는 `subtitle.police`+`office`, 위험구역 아코디언은 `zones[].police`+`office`. 새 화면에서 「…파출소 관할」을 쓸 때도 문자열을 직접 잇지 말고 이 함수를 쓴다(「파출소」 접미사·출장소·경찰서 없음 처리가 한 곳에 있다). 대응표와 같은 이름 가르기 규칙은 [README.md](README.md)의 같은 이름 절.

## 특보 영역 미표시 (과제14 폐지, 2026-10-15)

> 사용자 원문(2026-10-15): *「이미지를 보면 지도에 특보 영역을 표시하지 말자고 했는데 나오고 있는데 없애주고. 범례를 없앴으니 다시 없애야지.」*

지운 것: 조율기 `refreshWarnings`와 `refresh()`의 `warningJob`, 지도층 `borders`(`rf-borders-canvas`, zIndex 129)·`drawWarnings`·`renderWarnings`·`zonesLoaded`·`zoneKey`·`zoneGeometry`, `boundaries()`의 `/api/warn-zones(-sub)` 내려받기, 서버 `GET /warning-zones`·`risk_store.warningZones`·`borders()`와 frame 응답의 `borders` 필드. 나머지 층의 zIndex는 `130+i`로 순서가 그대로다(특보 층 한 칸이 빠졌을 뿐).

다시 넣지 말 것: 특보 범례(과제13, 「아예 반영하지 않음」)와 함께 특보 면·테두리도 위험예측 지도에서 빠졌다. 되살리려면 사용자 확인이 먼저다. 회귀 시험 — `test_risk_map_layer`(특보 층·함수 없음, `/api/warn-zones` 미요청), `test_risk_lifecycle`(켜기/끄기·시각 변경·재진입에서 `warning-zones` 요청·`drawWarnings` 0회), `test_risk_store`(frame에 `borders` 없음·`warningZones` 없음), `test_risk_routes`(`/warning-zones` 404).

건드리지 않은 공용 부분: `/api/warn-zones`·`/api/warn-zones-sub`(routes/weather.js)와 정적 도형, 해양지도 탭 `ocean_warn_*`, 위치 알림·온보딩, 특보 수집·푸시, 해구 예보. 상세 시트의 특보 행·안내와 해상 점수의 특보 반영도 그대로다.

## 관리자 전용 원천 진단 — 과제16

`risk_forecast.message`는 지도 원천 배너를 비우고 숨긴다. `risk_sheet.show`는 공통 sourceMessages 및 missing 목록을 출력하지 않는다. 개별 행의 null 표시는 유지하고 API의 상태/점수 계산을 수정하지 않는다. 따라서 자료 없는 요소를 정상0으로 간주하면 안 된다. 상세 요청 자체의 실패·재시도는 이용자가 다시 선택할 수 있도록 유지한다. 원천 오류·낡음·누락·복구는 인증된 관리자 오류현황으로 이전한다.

## 없음(정상)과 못 받음(모름)의 구분 — 과제4

`risk_store.coastDetail` 은 행사 월 파일이 정상(`ok`)이면 빈 목록도 「행사 없음」으로 보고 `missing` 에 넣지 않는다. 월 파일이 없거나 오류·손상·낡음이면 `events` 를, 특보·강풍 원천이 정상이 아니면 `warnings`/`gale` 을 `missing` 에 넣고 행사 행은 `missing:true`·점수 0 으로 만든다. 월 경계는 선택한 날짜의 달 파일 상태로 판정하므로 다음 달 미수신이 이번 달 날짜를 흔들지 않는다. 이안류는 `sources().ripCurrent.status==='offseason'` 이면 `rip` 을 `missing` 에서 뺀다(성수기 미관측은 유지). 화면은 `d.missing` 이 비면 「한산하고 위험구역 없는 곳과 비교」, 있으면 「확인된 요소 기준」과 계산 설명의 부분 반영 안내를 쓴다. 실패를 정상 0으로 바꾸지 않으며 공통 원천 경고 목록은 되살리지 않는다.

## 과제2 — 연안·해상 공통 메인 시각 (`risk_forecast.js`)

해상 전용이던 하단 바(`.rf-marine-timebar`, 고정 output + 현재/+3H/+6H/+12H)를 연안·해상 공통 메인 시각으로 쓴다. 새 컨트롤을 따로 만들지 않았다. (2026-10-16: output 을 없애고 5버튼으로 — 아래 「하단 시간 버튼 5개·시각 토스트·연안 색 범례·출처/축척 올림」.) (2026-10-16 T24: 바는 해상이 켜져 있을 때만 — 연안만이면 상단 날짜 넘기기, 아래 「연안 하루 하나·날짜 넘기기」.)
- `mainTimes()`: 연안 ON이면 `meta.timeline.coast.times`(지금 이후, 3시간 칸, 내일 21시까지 — 「가」 2026-10-15) 그대로, 해상만 ON이면 `seaTimes()`(내일 21시까지), 둘 다 ON이면 두 축의 합집합(실서버에서는 두 축의 끝이 같다). `nextTime(+3/6/12)`, 정기 `sync()`의 가까운 칸 맞춤, 층 스위치 변경 시 맞춤이 모두 이 목록을 쓴다. 칸이 없으면 버튼은 비활성이다.
- `marineTime()`: 바는 연안 또는 해상이 켜져 있을 때 보인다(둘 다 OFF면 숨김). 해상 전용 `[data-marine-tools]`는 해상 ON일 때만 보인다. `body.rf-sea-time-on` 클래스 이름은 CSS 호환을 위해 그대로다.
- `refreshMarine()`: 종전에는 연안만 제공되던 모레 구간에서 해상 지도를 비우고 `seaOutOfRange()`로 「해상 예보 범위 밖 (내일까지)」를 띄웠다. 「가」로 연안도 내일 21시에 끝나 이 구간이 없어졌으므로 그 분기와 함수를 삭제했다.
- 시트 시각은 그대로 `selected.at`이며 메인 `t`와 섞이지 않는다. 시트는 열릴 때 가장 가까운 칸으로 메인 `t`를 한 번 받는다. 해상 시트를 열 때 메인 `t`가 해상 범위 밖이면 해상 마지막 칸으로 시작한다.

## 시트 위치와 스크롤 구조 — 과제5·7

- `.rf-sheet`는 `position:fixed; bottom:var(--rf-chrome)`이며 `--rf-chrome`은 `--ls-bottom-chrome`(없으면 `--main-tab-height`, 그것도 없으면 68px)이다. 최대 높이는 (화면 높이 − 하단 탭류) × 66%다.
- 새 시트 내용을 만들 때는 `.rf-body` 안에만 넣는다. 머리(`.rf-sheet-head`)에는 제목·부제·`.rf-timeline`만 둔다. 시트 자체에 `overflow:auto`를 주면 닫기 버튼이 스크롤과 함께 사라진다.
- 검사: `node local_server/scripts/test_risk_sheet_ui.js` (Chromium 필요: `PW_CHROME` 환경변수).

## 시트 고정 일시 — 과제8

- (2026-10-16 T24) 연안 시트에는 슬라이더가 없다(날짜 줄) — 아래 규칙은 해상 시트에 그대로다.
- `RiskSlider.mount(el,times,selected,change)`가 `.rf-time-label`(output)을 슬라이더 위에 만든다. 선택 시각이 새 시간축에 없으면 손잡이는 처음 칸이지만 표시는 `selected`(상세가 실제 보여 주는 시각)를 따른다.
- 말풍선 표시/숨김 타이머와 위치 계산은 없다. 키보드·터치 모두 `input` 이벤트로 표시를 갱신하고 `aria-valuetext`에 같은 문구를 둔다.

## 즉시 열기·스켈레톤 규칙 — 과제6

- `RiskSheet.create(...).loading(hint)`가 시트를 열고 본문을 회색 틀로 채운다(`aria-busy`). `show`·`error`·`choose`·`clear`가 해제한다. 새 시트 종류를 추가해도 응답 처리 쪽에서 반드시 이 넷 중 하나로 끝나야 한다.
- 호출 위치는 `RiskForecast.select`(지점 선택)와 `sliderChanged`(시트 시각 변경)뿐이다. `refresh`·60초 갱신에서 부르지 않는다(읽는 도중 내용이 깜빡이지 않게).
- (2026-10-16) 「연다」는 이제 `present()` 를 거친다 — 시트가 닫혀 있었으면 `select` 가 먼저 부른 `hold(200)` 때문에 내용은 바로 채우되 약 0.2초 뒤에 올라온다. 아래 「선택 테두리·시트 올라오기/내려가기」 절.
- 늦은 응답 보호는 `detail()`의 `n!==detailSeq || selected!==s || (s.at||t)!==at` 검사다. 이를 약화하지 않는다.

## 지도 이동 여백 — 과제10

- `RiskForecast.visiblePadding()`이 [위 30, 오른쪽 40, 아래 (지도 아래 − 시트 윗변) + 30, 왼쪽 40]px를 돌려준다. 지도에 `fit`할 때 이 값을 `padding`으로 쓰면 대상이 시트 위 남은 영역의 정확히 가운데에 온다. 시트가 닫혀 있으면 아래 여백은 30px다.
- 이동 직전에 계산한다(`marinePoint`는 시트가 회색 틀로 바뀌기 전의 높이). 시트 높이는 서브탭 열림 여부에 따라 달라지므로 고정 비율(예전 50%·60%)을 쓰지 않는다.
- 위험구역 이동 뒤 `RiskSheet.markZone(id)`가 목록 표시를 맞춘다.
- **브리핑 바로가기(`goTo`) — 2026-10-17**: `visiblePadding(true)`(opening) 는 시트가 아직 0.2초 대기 중(`.open` 없음)이어도 시트가 다 올라왔을 때의 높이를 뺀다 — 높이는 `sheetTop` 이 잰다(그려져 있으면 `offsetHeight`, 곧 열릴 참이거나 숨어 있으면 CSS `max-height` 와 견줘 큰 쪽, 올라오는 transform 은 뺀 제자리). `frameTo` 가 선택 테두리 범위(`RiskMapLayer.selectionExtent`)를 이 여백으로 맞추고, 상세가 그려진 뒤 실제 높이로 한 번 고친다(`framed`·`ResizeObserver`, 8px 넘게 다를 때만). 종전 `goTo` 는 `.open` 전 `visiblePadding()` 을 불러 아래 여백 30px 로 옮겨 칸이 시트 뒤에 숨었다. 검사 `test_risk_goto_frame`.

## 가 연안 2일 제한 — 2026-10-15

사용자 원문: 「연안 해상 기간 차이 관련해서는 연안도 2일까지 표출하도록 하고, 관련하여 2일 이후 데이터는 받아오지 않도록 하여 메모리 소모 등 문제를 최소화할 수 있도록 해.」 · 「나」(버튼 유지) 「시간 버튼이 앞으로만 감 관련하여 현재 상태로 놔두어. 가.를 처리하면 해결될 것 같은데」

| 위치 | 이전 | 지금 |
|---|---|---|
| `risk_store.coastTimeline(now)` | (없음, 곳곳에 `T.timeline(now,3,3,21)`) | `T.timeline(now,3,2,21)` 한 곳 — meta·validateTime·warningsFor(연안 끝)·galeFor·sourceFiles/refresh의 행사 월 |
| `meta().timeline.coast` | 모레 21시까지 + `day3From` | 내일 21시까지, `day3From` 없음 |
| `coastDetail`/`frame(false)`/`warningZones` | 모레 시각 허용 | 모레 시각 400 「잘못된 예보 시각」 |
| `scoreCoast().notices` | `effective`·`prelim`·`day3`·`windMs` | `effective`·`prelim`·`windMs` (`dayMax` 입력도 없앰) |
| `frame(false)` 응답 | `day3Dashed` 포함 | 없음 |
| `forecast()` 반환 | `dayMax` 포함 | 없음(3일째 안내 전용이었다) |
| `RiskSheet` 안내 | `day3`/`forecastDay3` 문구 | 없음(`forecastDay3`는 서버 어디서도 만들지 않았다) |
| `risk_forecast.js` | `seaOutOfRange()` | 삭제 |
| `tour_concentration_collector.keepTwoDays` | 원천 약30일 전부 저장 | 수집일~+2일만 저장, 범위 안 날짜가 없으면 `empty response`(정상 파일 보존) |

자르지 않은 원천(공용 또는 해상): 해구 예보 `zone_forecasts.json`(scheduler 수집, 예보 탭·weather 경로 공용 — risk_store가 따로 읽은 복사본도 해상 상세·공식 사고 상세가 함께 쓴다), 너울 `swell_smallzone.json.gz`(너울 화면 공용), `weather_alerts.json`·강풍(특보, 날짜별 예보 아님), 이안류(이미 오늘만), 공식 선박 사고예보 수집(해상, 24칸=3일 — 이후 아래 「해상 공식 사고예보 2일 제한」으로 16칸=2일).

## 해상 공식 사고예보 2일 제한 — 2026-10-15

사용자 원문: 「해상 공식 사고예보는 2일까지만」 · 「기준 상세 오늘 내일로」 · 「다른 화면과 같이 쓰는 해구, 예보 등은 건드리지마.」

연안 2일 제한(「가」)에 이어 해상의 공식 선박 사고예보(MTIS)도 **오늘·내일**만 받고, 저장하고, 내보낸다. 끝은 **내일 21시 칸**(내일 21:00~23:59를 덮는다).

| 위치 | 이전 | 지금 |
|---|---|---|
| `sea_accident_collector.slots(now)` | 24칸(오늘00시~모레21시) | 16칸(오늘00시~내일21시). 2일 기간을 정하는 유일한 자리 |
| `collect()`/`complete()`/`start()` | 24칸 기준, `framesReady:24`·`frames:24` | `slots()` 그대로 16칸, `framesReady`·`frames`는 `times.length`(16). 호출 수 = 1행 probe + 16(종전 25 → 17) |
| `risk_store.meta().timeline.accident` | 24개 시각 | 16개 시각(`A.slots`를 그대로 쓴다) |
| `risk_store.accidentTime` (`/sea/accident-frame`·`/sea/accident-cell`) | 오늘00시~모레23:59 | 오늘00시~내일23:59, 모레 시각은 400 「잘못된 사고예보 시각」 |
| `marine_fusion.time` (`/sea/unified-frame`·`/sea/analysis`·`/sea/briefing`) | 지금-3시간~지금+72시간 | 지금-3시간~(오늘00시+48시간) 미만, 모레 시각은 400 「조회 시각 범위 오류」. 끝은 같은 파일 `analyze()`의 앞으로 보기 `end`와 같다 |
| `risk_basis_content.js` 해상 [기준 상세] | 「오늘·내일·모레를 3시간 간격…」 | 「오늘·내일을 3시간 간격…」 |
| `risk_forecast.js` `seaTimes()` | (코드 변경 없음) 주석 「세 날의 사고 예보·모레00·03·06시」 | 주석만 2일로 고침. 화면은 서버가 준 축만 쓰므로 코드는 그대로다 |

**배포 전 24칸 저장본**: `complete()`가 저장된 칸 수(24)와 기대 칸 수(16)가 다르면 완료본으로 보지 않으므로, 생성시각이 같아도 「변경 없음」으로 넘어가지 않고 **16칸 전체를 다시 받는다**(Fly 운영은 시작 즉시 `start()`가, 그 뒤에는 03:10·04:10·15:10·16:10 확인이). 다시 받기 전·실패해 옛 파일이 남은 동안(개발 서버는 자동 수집이 없어 계속 남는다)에도 모레 칸은 `accidentTime`·`marine_fusion.time`이 400으로 막고 시간축(`meta`)에도 없다. 남는 차이는 `sources().accident.frames`(파일의 칸 수를 그대로 세는 상태값)가 다시 받기 전까지 24로 보인다는 것뿐이다. 이 값을 읽는 화면 코드는 `client/js`에서 찾지 못했다(grep).

건드리지 않은 것(사용자 「다른 화면과 같이 쓰는 해구, 예보 등은 건드리지마.」): 해구 예보 `zone_forecasts.json`, 너울, 특보·강풍, 예보 탭, 해상 혼잡 수집기(이미 2일). 앞으로 보기 표(`analyze()`의 `riskTimes`·`upcoming`)는 이미 오늘00시+48시간 미만으로 잘라 두었으므로 바꾸지 않았다.

## MTIS 웹 수집 제거 — 2026-10-15

사용자 결정 원문: 「다른쪽에 이용약관에 사용하면 안된다고 써있어서 오토 스크래핑은 하면 안될 것 같아. 이 부분은 코드에서 제외하도록 수정할 수 있도록 해줘.」 · 「톤수, 선박 종류는 API에서 제공하지않는다고 공식적으로 확인했어. 이용할 수 없을 것 같아.」

- 서버가 `mtis.komsa.or.kr`(웹 화면)에 자동 접속하던 두 곳을 없앴다: 실시간 교통 `mtis_live_web.js`(삭제), 사고예보 격자 경계 `mtis_accident_grid.collectGrid`(계산으로 대체). 공식 Open API(`mtisopenapi.komsa.or.kr`)·공공데이터포털 API 는 그대로 쓴다. 화면의 「MTIS 공식 사고예보」 등 사용자가 누르는 링크는 자동 접속이 아니므로 남겼다.
- 해상 상세 「현재 교통현황」에서 선종·톤수 구성(「선종·톤수 구성을 확인할 수 없습니다」·「▶ 톤수별 구성」)을, 관할 브리핑에서 선종별 척수를 없앴다. 시각은 API 등록시각, 등록시각이 없는 옛 저장본은 「수집시각 … (등록시각 미제공)」으로 쓴다.
- 격자 위치 계산식·대조 수치는 [marine_fusion.design.md](marine_fusion.design.md) 「MTIS 웹 수집 제거」.
- 지키는 시험: `test_no_mtis_web`(verify_all SUITES).

## 시트 머리 [기준 상세]·연안 시각 막대·기준 상세 창 — 2026-10-16 (T7·T8)

사용자 원문은 [README.md](README.md)의 같은 이름 절. 바뀐 자리:

| 위치 | 이전 | 지금 |
|---|---|---|
| `risk_store.coastDetail(id,t)` | 한 시각 상세(캐시 객체 그대로) | `coastScore(id,t)`(종전 본문, 캐시) + `outlook`: `coastTimeline(clock())` 각 시각의 `{forecastAt,score,index,band}`. 지금 칸이 매 요청 달라 응답 자체는 보관하지 않고 칸 계산만 캐시를 쓴다 |
| `risk_store.frame(false,t)` | `coastDetail(p.id,t).score` | `coastScore(p.id,t).score` — 1,354곳마다 outlook 16칸을 만들지 않게 |
| `RiskFormat.BAND_COLORS` | (없음) | `{평소 수준:#2fb36b, 다소 높음:#f2c230, 높음:#fb923c, 매우 높음:#e0322c}` — `RGB` 기준점에서 만든다(키 순서 = 범례 순서) |
| `RiskSlider.mount(..., opts)` | `opts.risk` 면 해상 공식 사고 4색 고정 | `opts.colors`({단계: 색}) 를 받는다(없으면 해상 4색). `levels(rows)` 는 `level`(해상) 또는 `band`(연안)를 읽고 그 색표에 없는 단계는 칠하지 않는다 |
| 범례 `.rf-st-key` | 막대 위 가운데(`left:50%`) | 「지금」 꼬리표 쪽을 inline padding(`꼬리표 위치 + 16px`)으로 비우고 남은 폭 가운데(첫·끝 항목 auto 여백 — 넘치면 꼬리표 반대쪽으로만) |
| `RiskForecast.mountSlider` | 연안 `opts` 없음(파란 막대·자정 구분선) | 연안 `{risk:true,now:meta.now,colors:RiskFormat.BAND_COLORS}` |
| `RiskForecast.detail` | 해상만 `marine.outlook.accident` 를 `selected.levels`·막대로 | 연안은 응답 `outlook` 을 같은 길로(60초 갱신으로 막대를 다시 그려도 칸 색 유지). 교통량 이력 요청은 해상만 그대로 |
| `RiskSheet.create` 머리 | 손잡이·✕·제목·부제·시각 | 부제를 `.rf-sub-row` 로 감싸 오른쪽 끝에 `.rf-head-basis`(숨김 시작). `basisFor(kind)` — `show` 연안 요약·해상 분석이면 보임(`data-basis` coast/sea), `loading(새 지점)`·`choose`·`clear` 는 숨김(숨긴 버튼은 `data-basis` 를 지워 위임에 안 잡힘). 시각만 바꾸는 `loading()` 은 그대로 둔다 |
| `summary()` 연안 카드 | 카드 오른쪽 위 [기준 상세], `padding-top:34px` | 버튼 없음, `padding:10px 12px` |
| `RiskMarine.render` 출처 칸 | `<dl>` + [기준 상세] | `<dl>` 만(이 한 줄만 고침 — hero·혼잡 색은 손대지 않음) |
| `RiskBasis.open` | 문안을 상자에 그대로(상자 전체 스크롤) | 문안 앞의 닫기·`<h3>` 를 떼어 `.rf-basis-head`(제목 → 닫기) 에, 나머지를 `.rf-basis-body`(이것만 스크롤). 첫 초점은 닫기 그대로 |
| `RiskBasisContent` 제목 | 「기준 상세 — …」 | 「공식 선박 사고위험·교통혼잡 예보」·「연안 위험지수」 |
| `.rf-basis a` | 브라우저 기본 파랑(남색 바탕에서 안 보임) | `#8fd3ff` + 밑줄, 방문 후도 같음. 대비 8.3:1(두 끝 중 낮은 쪽) |

수정 시 주의: 버튼은 위아래 음수 여백으로 줄 높이(약 19.8px)보다 높게 잡히지 않는다 — 이 여백을 없애면 한 줄 부제에서 시각 줄이 약 3px 밀린다(`test_risk_sheet_ui` 「한 줄 부제에서 버튼이 시각 줄을 밀어냄」). 기준 상세 문안을 새로 쓸 때도 「닫기 버튼 → h3 → 본문」 순서를 지킨다(머리로 떼어 내는 규칙).


## 연안 시트 주변 연안사고·표기·색·기준 상세 표 — 2026-10-16 (T9)

사용자 원문은 [README.md](README.md)의 같은 이름 절, 결정 표는 설계서 §15. 바뀐 자리:

| 위치 | 이전 | 지금 |
|---|---|---|
| `risk_store` 정적 표 | `risk_spots.json` 만 | + `coast_accidents.json`(`loadCoastAccidents` — 파일 변경 때만 다시 읽음). 해시 불일치 → `status:'stale'` + 로그, 없음 → `missing`, 손상 → `error` + 로그. `meta().coastAccidents`(화면용 저장소만, 감시용 metadataOnly 는 null — `sources()` 에 넣으면 감시 원천과 키가 달라져 `test_risk_history_sources` 가 깨진다) |
| `risk_store.coastDetail` | 상세 + `outlook` | + `history`(`coastHistory(id)`): `{available:true,from,to,area,accidents}` / `{available:false}` |
| `RiskMarine.accidents` | 도넛·범례·인명 줄을 함수 안에서 | `accSort`·`accSummary`(도넛·범례·인명 줄)·`bindAcc`(범례 → `openAcc`, 줄 글자 `line` 선택)·`closePop` 으로 나눠 내보냄 — 해상 모양·시험 그대로 |
| `RiskSheet.show` 연안 본문 | 상자 → 계산 → 안내 → 요소 줄 | + 맨 끝 `coastHistory(d.history)`(응답에 `history` 가 있을 때만), 그린 뒤 `bindAcc`(줄 = 날짜), 다른 관광지·시각이면 `closePop` |
| `RiskSheet.show` 부제 | 연안 「좌표 · 관할」, 옛 사고 격자 「격자 중심 좌표」 | 연안 관할만, 옛 사고 격자 빈칸. `syncSubRow` — 부제가 비고 버튼도 숨었으면 `.rf-sub-row` 숨김 |
| `accidentRows` | 「선택 위치 좌표」 줄 | 없음 |
| `summary` 상자 색 | `F.col(d.score)` | `F.bandColor(band 또는 점수)` |
| `RiskMapLayer` 연안 면·점 테두리 | `RiskFormat.col(score)` | `RiskFormat.bandColor(score)`(해상 옛 점수 면은 `col` 그대로) |
| `RiskFormat` | `BAND_COLORS` | + `scoreIndex`·`bandOf`(서버 `risk_points` 와 같은 식)·`bandColor` |
| `RiskBasis.open` | 문안 그대로 | 본문 표를 `scrollTable` 로 감쌈 |
| `RiskBasisContent` | 해상 제목 「공식 선박 …」, MTIS 밑줄 링크 「·」 이음, 연안 「떠밀림」·「연속 그라데이션」 | 「선박 사고위험·교통혼잡 예보」, `.rf-basis-links` 안 `.link-btn` 두 개, 「표류」·「주변 연안사고 목록」·「단계 말과 같은 4색」 |
| `.rf-txt b.rf-cc` | `#f0c6ff` | `#ffa25e` |

수정 시 주의: 지도 연안 색 경계를 바꿀 때는 서버 `risk_points.scoreBand` 와 `RiskFormat.bandOf` 를 같이 바꾼다(`test_risk_format` 이 −1~4점 전 구간을 대조한다). 집계표를 다시 만들면(`build_coast_accidents.py`) `riskSpotsHash` 가 지금 `risk_spots.json` 해시와 같은지 `/meta` 의 `coastAccidents.status` 로 확인한다.

## 하단 시간 버튼 5개·시각 토스트·연안 색 범례·출처/축척 올림 — 2026-10-16

사용자 원문: 「하단에 시간대 설정이 있는데 -12 -6h - 3h 현재 +3h, +6h +12로 버튼을 만들고 처음에는 - 부분은 회색이었다가 +3으로 가면 -3 활성화 되어서 뒤로 갈 수 있도록 수정 필요(해상도 동일하게,) 그리고 왼쪽에 0월 0일 금요일 10:00은 빼도록 하고 현재 및 시간 이동 버튼 아래에 1.(금) 00:00 라고 버튼 내에 작은 글씨로 써지도록 하고 싶어. 물론 시간 이동에 따라 현재만 제외하고 해당 시간이 바뀌어야지. 더이상 미래로 갈 수 없는 경우에는 해당 시간 버튼은 비활성화 되도록 해주고. 해상도 동일하게 진행.」 · 「그러면 토스트 메시지로 하단에 뜨면 되는거 아니니 ?」 (왼쪽 날짜를 없애면 지금 보는 시각을 알 길이 없어지는 문제에 대한 답) · 「그런데 지금 지도에 색상에 따른 범례가 안보이는데 ?」 · 「이 시안을 보니까 버튼이 높아지네 ? +12 -12버튼은 빼도록 하자. 그리고 버튼을 좀더 넓게 사용하도록 하자.」 (7버튼 시안 화면을 보고) · 「범례는 해상위험예측과 동일한 위치에 배치하도록 해줘. 그리고 각 토글을 on 하면 국토교통부 브이월드가 시간 조정 부분으로 인해 가려지는데 브이월드가 시간 조정 버튼 높이만큼 위로 올라오도록 해줘(축척도 마찬가지로)」 (화면 설명은 README 같은 이름 절)

| 위치 | 이전 | 지금 |
|---|---|---|
| 시간 줄 마크업 | `<output data-map-time aria-live>` + 현재/+3H/+6H/+12H | `<span class="rf-sr-only" data-map-time>`(aria-live 없음) + `data-time-step` = `-6`·`-3`·`now`·`3`·`6`, 버튼 안 `<b>`라벨 + `<small data-time-at>`(두 `<span>` 「16.(금)」「13:00」 사이 공백, 한 줄) |
| `nextTime(hours)` | `+` 만: 선택 시각의 3시간 칸 + hours 이상인 첫 `mainTimes` | 음수도 받음. `-`: 칸(`floor(ms/3h)`)이 목표 칸 이하인 마지막 `mainTimes`. `mainTimes` 첫 칸이 `meta.now` 라 목표가 지금의 칸이면 지금, 그보다 앞이면 `null`(비활성) |
| `marineTime()` | output 글자 + `disabled` | 숨김 글자 「조회 시각 …」 + 버튼마다 `disabled`·`aria-disabled`·작은 글씨(`buttonTime`←`dayTime`), [현재]는 늘 `meta.now`. 바를 숨기면 토스트도 숨김 |
| `timeToast()`·`liftToast()` | (없음) | 시간 버튼 클릭마다 `.rf-time-toast`(role=status, aria-live=polite) 2초(`TOAST_MS`), 연타 시 마지막 것만. 출처·축척·`.rf-color-legend` 와 겹치면 인라인 `bottom` 으로 그 위로 |
| 연안 범례 | (없음 — 해상만) | `[data-coast-key]` 를 `.rf-color-legend` 첫 자식으로, `RiskFormat.BAND_COLORS` 4칸 막대. 보임은 `colorLegendSync()`(층 토글·refresh·setEnabled) — 종전 `colorLegend.hidden=!state.sea` 자리를 모두 대신 |
| CSS 바 | `minmax(0,1.7fr) repeat(4,1fr)`, `height:46px`, 버튼 34px, 비활성 opacity .35 | `repeat(5,1fr)`, `height:var(--rf-time-height,46px)`, 버튼 34px 2줄(라벨 12px·시각 10px, 360px 이하 9px), 비활성 회색 |
| CSS 출처·축척 | `body.rf-sea-time-on .ol-attribution…`(0,2,1) — index2 `body.ls-mode.ls-safety …`(0,3,1) 에 짐 | `body.ls-mode.ls-safety.rf-sea-time-on …`(0,4,1)·물빠짐(0,5,1) 추가 |
| CSS 범례 상자 | `width:150px`, 안의 `[hidden]` 이 `.rf-mini-key{display:block}` 에 져서 안 숨던 칸 있음 | `width:auto!important;min-width:150px`, `.rf-color-legend [hidden]{display:none!important}` |

수정 시 주의:
- 가짜 DOM 시험(`test_risk_lifecycle.js`)의 버튼 흉내는 `querySelector` 가 있어야 한다(작은 글씨 칸을 찾는다). `liftToast` 는 크기를 잴 수 없는 가짜 DOM 에서는 아무것도 하지 않는다.
- `risk_api.js` 의 60초 캐시 때문에 같은 시각으로 돌아오면 `sea/unified-frame` 요청이 다시 나가지 않는다 — 시험은 요청 기록 대신 지도에 다시 그려졌는지를 본다.
- 출처·축척 위치는 `index2.html` 안 `<style>` 규칙과 다툰다. 시험(`test_risk_main_time.js`)은 그 규칙을 index2.html 에서 읽어 시험 화면에 넣는다 — index2 쪽 선택자를 바꾸면 이 시험이 알려 준다.
- `.rf-color-legend .rf-gradient-labels` 처럼 상자 전체를 잡는 선택자는 이제 연안·해상 두 개를 잡는다. 해상만 보려면 `[data-accident-legend]` 를 붙인다.
- 검사: `NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_main_time.js` (선택 `RISK_SHOT_DIR=<폴더>` 로 380·320px 화면 PNG).


## 선택 테두리·시트 올라오기/내려가기 — 2026-10-16

사용자 원문: 「격자를 클릭하면 격자가 선택되었다는 느낌으로 격자 테두리를 표시하고 싶어. 표시 방법은 해구기상에서 해구격자를 선택했을떄와 동일한 스타일로. 그리고 선택이후 약간의 딜레이(0.2초?) 정도 후 바텀시트가 나오도록 하고 바텀시트는 현재 동적 애니메이션은 없는 아래서 위로 올라오는 느낌의 애니메이션이 있으면 좋겠어. 현재 해양종합정보 바텀시트에는 애니메이션이 잘 반영되어있음. 그대로 하면될듯. 닫을때도 마찬가지로 말이야.」 · 「바텀시트 애니메이션 및 클릭 관련해서는 연안에도 적용해줘.」

- **가져온 값**: 테두리 = `ocean-map/map/ocean_map.js` `_styleSelectedMainFeature`(해구도 대해구 첫 클릭) 시안 `#4fc3f7`·2.5px 실선(대시·그림자 없음). 움직임 = `style.css` `.ocean-bottom-sheet` `transform:translateY(100%)` ↔ `.open` `translateY(0)`, `transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)`, 닫기 정리 300ms(`ocean_bottom_sheet1.js` `OS.closeSheet`). 소해구(노랑 `#ffeb3b`·2px)는 쓰지 않았다.
- **지도** (`risk_map_layer.js` `setSelection`): 해상 GR4 칸·연안 관광지 영역·연안 중심 고리 모두 위 값(`SELECTED`). 종전 흰 2.5px(연안·통합 해상)·흰 2px(옛 해상)·흰 고리를 대신한다. 층 순서(선택 136 — 해안선 137·관광지 점 138 아래)는 그대로.
- **시트** (`risk_sheet.js`): `.rf-shown` = 그려져 있음(올라가는 중·열림·내려가는 중), `.open` = 열림(위). `present()` 가 `.rf-shown` → 다시 그림 계산 → `.open` 순서로 붙여 아래에서 올린다. `hold(ms)` 는 **시트가 안 보일 때만** 올리기를 ms 뒤로 미룬다(다시 부르면 처음부터 — 마지막 선택만). `clear()` 는 `.open` 을 바로 떼고(내려감) 300ms 뒤 `.rf-shown` 을 떼고 본문을 비운다 — 내려가는 동안 내용은 그대로 보인다. 그 사이 다시 열면 정리를 취소하고 그 자리에서 다시 올린다. 대기 중 `clear()` 면 예약을 취소하고 바로 비운다.
- **조율** (`risk_forecast.js` `select`): 테두리(`layer.setSelection`)는 누르는 즉시, 이어서 `sheet.hold(OPEN_DELAY_MS=200)` → `loading()`(회색 틀)·상세 요청은 바로 시작. 0.2초 안에 응답이 와도 시트는 0.2초에 올라온다. 닫기(✕·뒤로가기·Escape)·층 토글 끔·`setEnabled(false)`(탭 떠남)·`destroy` 는 모두 `clearSelection` → `sheet.clear()` 로 테두리를 지우고 예약을 취소한다.
- **이미 열린 시트에서 다른 칸**: 내리지 않고 내용만 바꾼다(대기 없음). 해양종합정보 시트는 열린 동안 다른 해점 클릭을 **무시**한다(`ocean_map.js` 「시트 열림 가드 — 사용자 합의 Q3」) — 위험예측은 종전대로 바꿔 보여 주되, 내려갔다 올라오지는 않는다는 점만 맞췄다. **(2026-10-16 T24 「나. 무시」: 지도 클릭은 열린 동안 무시 — `mapSelect`. 내용만 바꾸는 경로는 시트 안 버튼·탭 복귀뿐이다.)**
- **같은 위치 관광지 선택 목록**(`choose`)도 같은 규칙(닫혀 있었으면 0.2초 뒤).
- **탭 복귀**(`life_safety.js` `_unparkSafety` → `select`): 다시 열 때도 테두리 즉시·0.2초 뒤 올라옴.
- **움직임 줄이기**: `prefers-reduced-motion:reduce` 면 `.rf-sheet` transition 을 끈다(바로 제자리·바로 아래). 해양종합정보 시트에는 이 규칙이 없다(`style.css` 확인) — 위험예측에만 더했다. 0.2초 대기는 움직임이 아니라 그대로 둔다.
- **지도 스피너(`waitStart`, 250ms)와는 따로다** — 그것은 지도 색 요청(`refresh`)을 기다릴 때만이고 `select` 는 부르지 않는다. 시트 안의 기다림은 회색 틀이다.
- `visiblePadding()`(위험구역·관할 해역 이동 여백)은 `.open` 시트의 `getBoundingClientRect` 를 쓰는데 올라오는 0.3초 동안은 덜 올라온 위치를 잰다. 이 이동은 열린 시트 안 버튼에서만 시작돼 실제로는 다 올라온 뒤다. (2026-10-17 고침: 이제 `sheetTop` 이 transform 을 뺀 제자리로 잰다 — 올라오는 중이어도 같은 값.)
- 검사: `NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_select_motion.js` (선택 `RISK_MOTION_SHOTS=<폴더>` — 누른 순간·올라오는 중 90/150ms·다 올라옴 380px PNG). 1부는 페이지 안 가짜 타이머로 0.2초·0.3초를 한 칸씩, 2부는 실제 지도 클릭과 계산된 transform(시간을 재지 않고 제자리까지 기다림). 다른 시트 시험(`test_risk_sheet_ui`)은 시트를 잴 때 다 올라오기를 기다린다(`waitUp`).

## 연안 하루 하나·날짜 넘기기·시트 열림 중 지도 클릭 무시 — 2026-10-16 (T24)

사용자 원문은 [README.md](README.md)의 같은 이름 절, 결정 표는 설계서 §16. 바뀐 자리:

| 위치 | 이전 | 지금 |
|---|---|---|
| `routes/risk_forecast.js` `/coast/frame`·`/coast/spot` | `store.frame(false,t)`·`store.coastDetail(id,t)`(한 칸) | `store.coastDayFrame(t)`·`store.coastDayDetail(id,t)` — `t` 가 든 KST 날짜의 하루 값 |
| `risk_store.coastDay(t)` | (없음) | `validateTime` 뒤 그 날짜의 연안 시간축 칸(`coastTimeline(분 단위로 내린 지금)` 중 같은 날짜). 칸이 없으면 400(자정 직후 어제 날짜) |
| `risk_store.coastDayDetail` | (없음) | 칸마다 `coastScore` → 점수가 가장 높은(같으면 이른) 칸의 `coastDetail` + `missing`(그날 칸 합침) + `daily{date,peakAt,times}` |
| `risk_store.dayNotices` (§16.1 ②, 2026-10-16) | (없음 — 안내는 가장 높은 칸의 `notices` 만) | 그날 칸마다의 `notices` 를 묶어 `daily.notices` — 특보 `{key:'warning',name,state:'발효'\|'예비',from,to}`, 표류 `{key:'drift',windMs(묶음 최대),from,to}`. 이어진 칸은 하나, 끊기면 따로, 순서는 처음 나온 칸 → 예비·발효·표류. 맨 위 `notices` 는 그대로(가장 높은 칸) |
| `risk_store.coastDayFrame`·`slotScores` | (없음) | 첫 칸 `frame(false,…)`(degraded·day) + 칸마다 `slotScores`(관광지 표 순서 Float64Array, `coastSlots` 16칸 보관)의 관광지별 최댓값 + `daily` |
| `risk_store.frame(false,t)` | 관광지마다 `coastScore(p.id,t).score` | `slotScores(t)` 를 그대로 — 같은 칸 점수를 하루 값과 함께 쓴다 |
| `risk_store.coastDetail` | 한 칸 상세 + `history` + `outlook`(T7) | 한 칸 상세 + `history`(`outlook` 뺌 — 연안 시트 시각 막대 없앰) |
| `RiskForecast` 하단 바 | 연안 또는 해상이 켜져 있으면 보임 | 해상이 켜져 있을 때만(`marineTime` — `shown=enabled&&state.sea`). `body.rf-sea-time-on` 도 같이 |
| `RiskForecast` `dateNav` | (없음) | 지도 감싸개에 `.navwarn-date-nav.rf-date-nav`(항행경보 클래스) — 연안만 켜면 보임(`dated`). `dayInfo`(글자·꼬리표·앞뒤 가능)·`placeDateNav`(범례와 겹치면 아래로, 창 크기 변경 때도) |
| `RiskForecast` 시간 바 클릭 | `t=…;marineLegend();marineTime();timeToast();waitStart();refresh();` | `setMain(next)` — 같은 순서 + 날짜가 바뀌었고 연안 시트가 열려 있으면 회색 틀·`detail()` 을 바로 |
| `RiskForecast.shiftDay(dir)` | (없음) | 날짜 줄·시트 < > 공통. 연안만 → 그 날짜 첫 칸(`coastT`), 해상 켬 → 그 날짜의 같은 시각이 든 `mainTimes` 칸(지난 시각이면 지금) |
| `RiskForecast.coastT(at)` | (없음) | `at` 이 든 날짜의 첫 연안 칸(오늘=`meta.now`, 내일=00시). `refresh` 의 `coast/frame` 과 `detail` 의 `coast/spot` 요청 시각 — 같은 날짜면 같은 주소(응답 캐시 공유) |
| `RiskForecast.select('coast',…)` | `selected.at = nearest(연안 축, t)` + 연안 4단계 색 막대 | `selected.at = null`(메인 날짜를 따름) + `sheetDay()`(RiskSheet.day). 앱 경로(`RiskMarine` 있음)만 — 옛 경로는 종전대로 |
| `RiskForecast.detail` 늦은 응답 검사 | `(s.at\|\|t)!==at` | `detailAt(s)!==at`(연안은 `coastT(t)` — 같은 날짜 안에서 메인 시각이 바뀌어도 버리지 않음) |
| `RiskMapLayer.create(map, …)` | `select` | `mapSelect` — 시트 `.open` 이면 무시(「나. 무시」) |
| `RiskSheet.day(info)` | (없음) | `.rf-timeline` 에 `.ocean-date-nav-inline.rf-sheet-day`(해양종합정보 시트 날짜 줄 클래스) 를 한 번 그리고 글자·비활성만 바꿈. 날짜가 바뀌면 둘째 줄을 비움 |
| `RiskSheet.show` 연안 | — | 둘째 줄 `[data-sheet-peak]` = `peakText(d.daily)` 「가장 높은 때 HH시 기준」. 팝업 닫기 기준 키를 `d.t` 대신 `daily.date`(오늘 가장 높은 칸이 지금 칸이면 60초마다 `d.t` 가 바뀜) |
| `RiskSheet.dayNotices(daily)` (§16.1 ②, 2026-10-16) | `notices(d.notices)`(가장 높은 칸) | `daily.notices` 가 있으면 시각을 붙여 같은 문구(`notices`)로 — 「HH시~」(그날 마지막 칸까지)·「HH시~HH시」(첫 칸~끝 칸)·「HH시 무렵」(한 칸), 표류 여러 칸이면 「최대 Nm/s」. 없으면 종전 `notices(d.notices)` |
| `RiskSheet.kmaTime`·`dayNotices` 특보 (결정 1, 2026-10-16 — 설계서 §11.8) | 특보도 칸 시각(「11시~15시 풍랑주의보 발효」) | 기상청 시각 그대로 — 발효 「… 발효 중(14시 발표) — 17일 06~09시 해제 예고」 · 예비 「… 예비특보(10:30 발표) — 21~24시 발효 예정」, 못 읽은 것만 칸 시각+「(칸 기준)」. 서버 `daily.notices` 의 `issued`·`effective`·`release`(`risk_store.warnTimes`) |
| `RiskSlider` `opts.colors` | 연안 4단계 색(T7) | 없앰(해상 공식 사고 4색 고정) — 쓰던 곳(연안 시각 막대)이 없어졌다 |
| `risk_forecast.css` | — | `.rf-date-nav[hidden]`·비활성(opacity .3)·해양안전 밖 숨김, `.rf-timeline .rf-sheet-day` 가운데, 바 없을 때 토스트 기본 자리(`body:not(.rf-sea-time-on) .rf-time-toast` — 탭 바로 위) |

바꾼 기존 시험 단언(종전 → 지금):
- `test_risk_main_time`: 「연안만 켠 기본 화면에도 공통 메인 시각 바」 → 「연안만: 바 없음·상단 날짜 줄, 해상을 켜면 5버튼」. 바 사례(+3H 이동·범위 끝·토스트·출처/축척)는 해상을 켠 상태에서. 「연안 지도가 그 시각의 프레임」 → 「그 시각이 든 날짜의 하루 값」(가짜 저장소 `dayScore`), 연안 요청은 날짜 첫 칸으로만(`coastCanonical`). 「둘 다 끔 → 출처·축척 원위치」 → 「연안만이어도 원위치」. 「시트 시각 격리」(연안 슬라이더) → 해상 시트로 옮김.
- `test_risk_sheet_ui`: 과제8 「연안 슬라이더 위 고정 일시」·「시트 시각을 바꿔도 메인 그대로」 → 「연안 날짜 줄·가장 높은 때」·「시트 > 로 내일 → 상단도 내일·다른 지점도 내일」. 「응답 전에도 시각 조작」 → 「응답 전에도 날짜 줄」. 「시트 시각을 바꾸면 늦은 응답…」 → 「날짜를 넘겼다 돌아오면 늦게 온 내일 응답은 안 나옴」. 「T7 연안 시각 막대」 → 「T24 시각 막대 없음·해양종합정보 날짜 꼴」. 380·320px 머리: 범례·「지금」 꼬리표 대신 날짜 줄(가운데·28px·비활성 .3).
- `test_risk_select_motion`: 「열린 시트에서 다른 칸 → 내용만 바꿈·테두리 새 칸」 → 「무시 — 테두리·제목·선택 그대로·요청 없음」 + 예외(끌기·확대, 0.2초 대기 중 다른 칸).
- `test_risk_store`: 「T7 연안 outlook」 → 「T24 하루 값」. `test_risk_routes`: 「T7 outlook 전달」 → 「T24 daily 전달·outlook 없음」.
- `test_risk_lifecycle`: 연안 시트 시각 변경(slide) → 해상 시트 시각 변경. `test_life_safety_tab_keep`: 켜짐 대기를 하단 바 → 상단 날짜 줄.

수정 시 주의:
- 날짜 줄 모양은 `index2.html` 의 항행경보 규칙에서 온다 — 항행경보 쪽 `.navwarn-date-nav` 를 바꾸면 위험예측도 같이 바뀐다(의도). `test_risk_coast_day` 가 두 줄의 계산된 모양을 대조한다. 미리보기(`risk_forecast_preview.html`)와 index2 밖 시험 화면에는 그 규칙이 없어 날짜 줄이 꾸밈 없이 보인다(시험은 필요한 규칙을 index2.html 에서 읽어 넣는다 — `test_risk_main_time`).
- 연안 시트 날짜 줄 모양은 `style.css` 의 해양종합정보 시트 규칙에서 온다(`.ocean-date-nav-btn` 28px 등). style.css 가 없는 화면에서는 꾸밈이 빠진다.
- 시트 안내(특보·표류)는 `daily.notices`(그날 칸 전부, §16.1 ②)에서 온다 — 칸 상세 `notices` 의 꼴(`warning` 의 `effective`·`prelim` 이름 목록, `drift` 의 `windMs`)을 바꾸면 `risk_store.dayNotices` 도 함께 고친다. 시각 글자는 칸 시각(KST 시)이라 「11시~15시」는 11·12·15시 칸에서 확인됐다는 뜻이다(해제 시각 자체가 아님). 시험 `test_risk_store` 「T24 §16.1 ② 하루 안내」·`test_risk_coast_day` 「§16.1 ② 연안 시트 안내」.
- 하루 값의 칸은 서버 연안 시간축 하나에서 정한다(`coastTimeline`). 오늘의 지난 칸을 넣으려면(설계서 §16.1 ①) `validateTime`·`coastDay` 를 함께 바꿔야 한다.
- 지도 클릭 무시는 지도 경로(`mapSelect`)만이다. `select` 자체에 막기를 넣으면 시트 안 관광지 목록·관할 해역 이동·탭 복귀가 막힌다.
- 검사: `NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_risk_coast_day.js` (선택 `RISK_DAY_SHOTS=<폴더>` — 380·1280px 화면 PNG).

## 해상 시트 시안 반영 — 2026-10-18
README 「해상 시트 시안 반영」 절의 확정 사항을 코드로 옮긴 자리.

| 무엇 | 전 | 후 |
|------|----|----|
| `badge` 단계 글자 | 칸 글자색(`F.ink`) 그대로, `display:block` | `<strong style="color:단계색">` + `.rf-lvl strong` 남색 알약(#10151f·800·자간 .06em·여백 3px/1px·안쪽 1px 12px 2px). `.l4` 는 .9rem·자간 0·안쪽 1px 5px 2px |
| `hero` 척수 | `<b>` 굵게 | `<b class="rf-cnt" style="color:밀집도 단계색">` 16px·800(밀집도 모르면 색 없음) |
| `accidents` 제목 | `<span class="rf-src">2021~2025년</span>` | `yearsText` → `<span class="rf-yrs">('21년 ~ '25년)</span>`(#cfe0ff), 카드에 `.rf-sea-acc` |
| 해상 h4 색 | 공용 `.rf-card h4` #cfe0ff | `.rf-traffic h4,.rf-sea-acc h4,.rf-wx-head h4{color:#fff}`(공용 규칙은 그대로) |
| `.rf-leg` | 왼쪽 정렬, `.zh` `margin-left:auto` | `justify-content:center`, `.zh:empty{display:none}` |
| `.rf-wx-body .g` | .68rem·600·#98abc7 | `calc(.68rem + 1pt)`(12.21px)·줄높이 18px·800·#fff, `.rf-wx-body .rf-tile small{font-weight:800}` |
| 시트 제목(해상) | `risk_sheet.js` `show` 가 `.rf-title.textContent = marine.location` | `RiskMarine.title(h3,location)` — 끝 「(…해구)」만 `<span class="rf-haegu">`(textContent), CSS `.rf-title .rf-haegu{font-size:calc(1em - 2pt);font-weight:400}` |
| `.rf-warn-box` | 1.5px solid #ff4d4f | 1.5px dashed #ff4d4f, `[data-state="예비"]` #ffd740·바탕 rgba(255,215,64,.08) |

