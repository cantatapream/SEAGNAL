# 실행과 검증

저장소 루트에서 `npm ci --legacy-peer-deps` 후 `node local_server/server.js`로 서버를 실행한다. 실제 앱은 `/`, 같은 제품 모듈만 담은 검증 화면은 `/risk_forecast_preview.html`이다. 미리보기는 실제 API를 사용한다. URL의 `fixture=1`로 운영 자료를 바꾸지 않는다. 자동 브라우저 시험의 예시 응답은 요청 가로채기로 주입한다.

지도 클릭은 `ocean_map.js`의 `_riskForecastTryHandleClick`으로 들어온다. 해양안전에서만 버튼이 나타나며, `life_safety.js` 단독 오버레이 목록에 등록되어 기존 레이어와 동작을 맞춘다. 계산 모듈을 프론트엔드에 복사하지 않는다.

## 정적 공간 자료

`local_server/config/coastal_safety/risk_spots.json`은 1,354개 관광지의 인접 관광지 분할 및 육지 교차 다각형과 주변 위험구역을 보관한다. `rip_spot_map.json`은 이안류 관측 매핑이다. 원본 공간 자료가 바뀌면 아래 명령으로 다시 만든다.

```sh
python3 -m pip install shapely==2.2.0 pyproj==3.8.0
node local_server/scripts/build_risk_static.js
```

현재 34개 관광지는 육지 교차 면이 없거나 같은 좌표의 영역을 다른 관광지가 소유해 빈 MultiPolygon으로 남는다. 관광지 정보는 유지하고 지도 면만 건너뛴다. 빈 면을 OpenLayers에 전달해 나머지 1,320개의 표시까지 실패하지 않도록 처리한다.

Python·Shapely·pyproj는 정적 자료를 만드는 때만 필요하다. 앱 서버는 생성한 JSON을 읽으며 Python을 실행하지 않는다. 섬 외곽선은 API의 `islands`로 받는다. 특보 경계는 `/api/warn-zones`와 `/api/warn-zones-sub`를 함께 읽는다.

## 응답과 결측

`meta`의 `now`와 `timeline.coast/sea.times`를 슬라이더에 사용한다. `versions.spots/cells`가 바뀌면 대응 표를 다시 읽는다. `coast/frame`의 `spots`와 `sea/frame`의 `cells`는 정적 표의 `i`를 참조하는 배열이다. 상세 응답의 `score/index/band/rr`를 그대로 표시하고, `rows`, `notices`, `missing`을 문장 틀로 옮긴다. 기준 PDF는 `report/sea`와 `report/coast`에서 내려받는다.

초기 일부 요청이 실패해도 다시 켜기나 다음 60초 갱신에서 재시도한다. 꺼진 뒤 늦게 도착한 오류는 배너를 다시 열지 않는다. API 캐시는 지점·섬 1일, 해상 칸 1시간, 상세·프레임·meta 1분이며 주기 meta 요청은 캐시를 건너뛴다. 수집기의 상태·자료 시각은 서버가 판단한다. 실패 진단 로그에는 오류 종류와 숫자 HTTP 상태만 넣어 원천 URL·API 키·응답 본문을 출력하지 않는다. 특히 혼잡도 수집 실패에는 날씨 위험색을 유지하고 자료 없음으로 표시한다.

## 공공 API 명세 대조

관광지 집중률은 사용자 첨부 `한국관광공사_OpenAPI_활용매뉴얼(관광지집중률방문자추이예측정보)_v4.1`을 기준으로 한다. 호출 주소는 `B551011/TatsCnctrRateService/tatsCnctrRatedList`이며 필수 항목은 `serviceKey`, `MobileOS`, `MobileApp`, `areaCd`, `signguCd`다. `_type=json`, `pageNo`, `numOfRows`를 함께 보내고 선택 검색 항목은 `tAtsNm`이다. 응답 관광지명도 대소문자를 포함해 **`tAtsNm`**이며, `baseYmd`와 `cnctrRate`로 날짜별 값을 연결한다. 공식 XML 예제의 7개 응답 필드를 수집기 회귀 검사에 반영했다. 앱의 시군구 코드 60개는 첨부 코드표에 모두 있다.

사용자가 제공한 해양교통 혼잡 예보 REST 화면과 당일 F12 성공 기록에서 GET 주소 `B554035/sea-tfc-congst-fcst/get_sea_tfc_congst_fcst`, `fcstDate=YYYYMMDD`, `fcstTime=HHmm`, `gridLevel=4`, `type=json`, `pageNo`, `numOfRows`를 확인했다. 공공데이터포털의 공개 Swagger2.0 명세도 같은 필수 항목7개를 제공한다. 기존 서버 키와 사용자 키의 디코딩 후 일치 여부를 확인했고 값은 기록하지 않았다.

사용자의 2026-10-11 13:00·격자4 직접 GET은 HTTP200·`200 / NORMAL_SERVICE`, 전체5,666개였다. 첫10개 응답은 현재 파서가 모두 받아들이며 같은 시각 MTIS 표의 좌표·혼잡 단계·풍속·파고와 불일치0건이다. 공통 요청기는 정상 코드200/메시지 조합을 허용하고 `153 / NOT_FOUND_DATA`를 성공으로 취급하지 않는다. 과거10월10일12시 성공의 전체6,165개와 당일 자료를 구분한다.

클라우드에서는 동일 경로·조건·인코딩의 공공 API 요청이 HTTP400·코드10을 반환한다. 사용자 성공 요청의 실제 주소를 이미 확보했으므로 주소 미확보를 남은 조건으로 제시하지 않는다. 일반 브라우저 헤더와 Node/curl 전송도 대조했지만 원인은 미확정이다. 인증키나 쿠키를 문서·시험 파일에 기록하지 않으며 오류를 정상 자료로 대체하지 않는다.

MTIS 공개 웹의 지도·표 POST는 새 익명 세션으로 클라우드에서 HTTP200·5,666개를 확인했다. 이 웹 계약의 실제 좌표는 `ctrptYCrd=경도`, `ctrptXCrd=위도`이며, 지도 문자열 `"null"`과 표 JSON null은 결측으로 해석한다. 응답과 엑셀 설정에는 수치 `congestionIndex`와 생성시각 `fcstCreateDateTime`이 없어 기존 공식 수집기의0.1 필터·상세값을 대체할 수 없다. 단계에서 숫자 혼잡지수를 만들어 넣지 않는다. 구체적인 증거와 실제 수집의 남은 제한은 [검증 기록](validation.md)에 남긴다.

## 검사

```sh
node local_server/scripts/test_risk_format.js
node local_server/scripts/test_risk_preview.js
node local_server/scripts/test_risk_lifecycle.js
node local_server/scripts/test_risk_map_layer.js
bash scripts/refactor/verify_all.sh
```

서식 검사는 0~100 모든 숫자 상자의 명암비, 색 기준, DMS 올림과 HTML/URL 보호를 검증한다. 전체 지도 자료 검사는 실제 1,354개 관광지, 육지 원천, 21개 섬 및 하위 특보 경계를 제품 OpenLayers에 넣어 빈 형상 처리와 반복 렌더링을 검증한다. `PW_CHROME` 또는 `SIM_CHROMIUM`으로 설치된 브라우저 실행 파일을 지정할 수 있다. 생명주기 검사는 초기 부분 실패의 복구, OFF 뒤 늦은 응답, KST 날짜 이동 및 API TTL을 검증한다. 전체 검사의 `simulate.js`는 실제 앱 위험예측 버튼의 기본 층과 OFF 동작을 확인하며, 이 새 시나리오는 기존 기준선에 없어도 실패를 보고한다. 외부 지도·기상 API 연결의 환경 실패는 실제 코드 오류와 구분해서 검사 결과에 남긴다.

브라우저에서는 초기 연안만 켜짐·시트 닫힘, 선택 후 DMS, 해상 16방위·3자리 방위각, 두 층 OFF의 특보 경계 숨김, 선택 층 OFF의 시트 닫힘, 기준 상세의 Escape와 초점 복원, 위험구역 주소 클릭의 지도 이동을 확인한다.
