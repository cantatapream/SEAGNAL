/**
 * ============================================================================
 * 파일명: local_server/scripts/khoa_oceanmap_probe.js
 * 역할  : 국립해양조사원(KHOA) 오션맵(khoa.go.kr/oceanmap)이 인명사고 마커를
 *         표시할 때 내부적으로 호출하는 API(XHR/JSON/WMS/WFS 등)를 찾아낸다.
 *         [배경] 사용자가 오션맵 화면에서는 인명사고 위치가 정확하게 찍혀
 *         보이는데, 우리 앱은 국립해양조사원이 배포한 원본 엑셀의 "위치텍스트"를
 *         지오코딩으로 역산해야 해서 오차가 크다(별도 조사: 498건 의심 후보).
 *         오션맵이 쓰는 원본 API를 알아내면 더 정확한 좌표를 직접 받을 수
 *         있는지 확인하려는 것 — 이 스크립트는 그 API를 "찾기만" 한다(수집·
 *         저장은 하지 않음, 읽기 전용 정찰).
 * [실행환경] 이 저장소의 개발 샌드박스(Claude Code on the web)는 khoa.go.kr·
 *   data.go.kr 접속이 프록시 정책상 막혀 있어(2026-08-31 curl 403 확인,
 *   WebFetch도 EGRESS_BLOCKED) 여기서 실행할 수 없다. GitHub Actions
 *   (ubuntu-latest, 외부망 열림)에서 대신 돌린다 — 카카오맵 지오코딩 검증
 *   스크립트(accident_geocode_check.js)와 같은 우회 패턴.
 * [2026-09-01 수정1] 1차 실행: "사고정보" 클릭 타임아웃(오버레이 문제). 페이지
 *   로드만으로 listOLMPData.json 호출 확인 → 본문을 콘솔에 직접 출력하도록 함.
 * [2026-09-01 수정2] 2차 실행: listOLMPData.json 은 "레이어 정의 목록"(가공선로·
 *   해저케이블 등 WMS 레이어 메타데이터)이었고 buoyList.json 은 항로표지(등부표)
 *   좌표였다 — 둘 다 인명사고 데이터가 아니다. page.evaluate() 로 DOM에서 직접
 *   .click() 을 호출하는 방식으로 바꿔 actionability 검사를 우회했지만, 텍스트가
 *   "사고정보"인 요소가 페이지 안에 여러 곳(상단 메뉴·이 화면의 사이드바 카탈로그·
 *   진입 후 breadcrumb)에 있어 첫 번째로 찾은(상단 메뉴) 걸 클릭해 "Element is
 *   not visible"로 계속 실패했다.
 * [2026-09-01 수정3] 사용자가 실제 화면 스크린샷을 캡처해 정확한 경로를 알려줬다 —
 *   상단 메뉴가 아니라 **좌측 "데이터셋" 탭 → "안전" 카테고리 펼치기 → "사고정보"
 *   하위메뉴(화살표로 진입하는 별도 화면) → "선박사고밀도" 섹션 펼치기 → "인명사고
 *   (25년)" 토글**이 진짜 경로다. "사고정보"·"안전" 처럼 페이지에 여러 번 나오는
 *   텍스트는 첫 번째 매치가 아니라 "그 화면에서만 같이 보이는 이웃 텍스트"로
 *   범위를 좁혀야 정확한 요소를 찾을 수 있다(예: "안전"은 "지형/지명"·"항해지원"과
 *   같은 목록에 있는 것만, "사고정보"는 "갯골(상세)"와 같은 목록에 있는 것만).
 *   evalClickScoped() 가 이 방식으로 클릭 대상을 찾는다.
 * [2026-09-01 수정4] 4차 실행: "데이터셋→안전→사고정보" 3단계는 전부 성공(로그로
 *   확인, breadcrumb "안전 > 사고정보" 화면 도달). 마지막 "인명사고" 토글만
 *   실패("컨테이너 안에서 target 못 찾음") — 이웃 텍스트로 준 "선박사고(해양"가
 *   실제 DOM 텍스트와 정확히 안 맞았을 가능성이 크다(사용자 스크린샷 재확인 결과
 *   "선박사고분석"·"선박사고밀도"는 아코디언이 아니라 그 아래 "선박사고(해양…)"
 *   ×2행 + "인명사고(25년)"행이 처음부터 같이 보이는 목록형 화면이었다). 화면
 *   텍스트 스냅샷도 150개 제한에 걸려 "인명사고"가 나오기 전에 잘렸다. 이번엔
 *   ①스냅샷 한도를 늘리고 ②"인명사고" 클릭은 이 화면 안에서 유일할 가능성이
 *   높아 스코프 없이 바로 시도(실패하면 스코프를 "선박사고분석" 하나로만)한다.
 *   사용자가 실제 마커를 클릭해 보여준 팝업(전북 고창군 구시포항(신항)·
 *   사고발생일 20180228·사고유형 ATY001)은 지명이 이미 해석돼 있어, 토글을
 *   켰을 때 뜨는 벌크 API 응답에 있을 가능성이 가장 높다 — watchAllJson 으로
 *   그 응답을 통째로 잡는다.
 * [2026-09-01 수정5] 5차 실행: "인명사고" 토글 클릭은 성공했지만(evalClick ok:true),
 *   그 직후 새로 뜬 요청은 지도 배경 WMS 타일 이미지·메뉴 로그뿐이었다 — 마커
 *   데이터 API가 없었다. 사용자가 원인을 확인해줬다: 전국 축소 화면에서는 "3032"
 *   같은 뭉친 숫자(클러스터)만 뜨고, **여러 단계 확대해야** 개별 마커가 나오고
 *   그제서야 데이터가 로드되는 방식이다(같은 위치에 여러 건이 겹쳐 있으면 마커
 *   하나 클릭 시 그 아래 여러 건이 목록으로 함께 뜬다고도 확인해줌). 이번엔 토글
 *   직후 지도 캔버스를 찾아 사고가 밀집한 남해안(부산·거제·제주 방향)으로 마우스
 *   휠 확대를 여러 단계 실행한 뒤, 그 지점 주변 여러 좌표를 클릭해 마커를 맞춰
 *   본다(정확한 마커 픽셀 위치를 모르므로 격자로 여러 점을 시도).
 * [2026-09-01 수정6] 6차 실행: 마우스 휠 확대 8단계 + 격자 클릭 9곳 시도했지만 새로
 *   뜬 API(selectOLMPData.json)는 인명사고와 무관한 부이(buoy_A01) 실시간 데이터
 *   주기 조회였다(응답도 다 {"list":null}) — 격자 클릭도 전부 "새 응답 없음".
 *   사용자 확인: 마우스 휠 8단계로는 부족하고, 스크린샷상 개별 마커가 나오려면
 *   더 많은 단계 확대가 필요했다. 픽셀 좌표를 계속 추측하는 대신 OpenLayers Map
 *   인스턴스를 window 에서 직접 찾아 setCenter/setZoom(부산 인근, 줌 15)으로
 *   정확히 이동을 시도하고, 못 찾으면 더블클릭 확대(15회, 휠보다 예측 가능)로
 *   대체한다. 격자 클릭 범위도 화면 정중앙 기준으로 더 촘촘하게(20px 간격) 늘림.
 * [2026-09-01 수정7] 7차 실행: window 에 OL Map 인스턴스가 없었고(번들이 안 감쌈),
 *   더블클릭 확대 15회 뒤 격자 클릭 13곳도 전부 "새 응답 없음"이었다 — 클릭
 *   자동화로 마커에 명중시키는 접근을 8차례 시도했지만 계속 못 맞췄다. 방향을
 *   바꿔서, 클릭으로 추측하는 대신 **페이지가 실제로 로드하는 JS 번들 소스를
 *   직접 읽어** 마커 클릭 시 호출되는 함수·엔드포인트 이름을 찾는다
 *   (scanLoadedScripts) — 훨씬 확실한 방법이다.
 * [2026-09-01 수정8] 8차 실행 결과 확인: JS 번들 스캔이 핵심 단서를 찾았다 —
 *   "인명사고" 토글 클릭 직후 POST listOLMPData.json 응답에
 *   `{"layr_nm":"vi_nshpac_p","service":"CLUSTER","tile_yn":"Y","clickyn":"Y",...}`
 *   가 확인됐다(레이어 메타데이터). tile_yn:"Y" 는 이 레이어가 서버에서 미리
 *   PNG로 구운 지도 타일(wmsVectordata.do?REQUEST=GetMap)로 그려진다는 뜻이고,
 *   ol-ext.min.js 안에 `getFeatureInfoUrl`/`getFeatureInfo`(GetMap→GetFeatureInfo로
 *   치환해 좌표별 속성을 조회하는 OpenLayers 표준 패턴)가 있다는 것도 확인됨.
 *   즉 마커를 클릭하면 이 타일 URL을 GetFeatureInfo로 바꿔 그 픽셀 좌표의
 *   사고정보를 서버에 물어보는 구조로 추정된다 — 하지만 8차까지의 격자 클릭
 *   (총 22회)이 전부 "새 응답 없음"이었던 건 실제 마커 픽셀을 못 맞췄기 때문일
 *   가능성이 높다(전국 축소 화면에서 더블클릭 15회로는 개별 마커가 보일 만큼
 *   확대됐는지 불확실 — window 에 지도 인스턴스가 없어 setCenter/setZoom 직접
 *   호출도 실패했었음).
 *   olmp.js/datasetolmp.js 소스에는 `var olmp = null;`/`var datasetolmp = null;`
 *   가 최상위(전역) 선언이라 클래식 `<script>` 태그로 로드되면 `window.olmp`·
 *   `window.datasetolmp` 로 접근 가능해야 한다 — 7차의 실패 원인은 duck-typing
 *   스캔이 `window[key]` 1단계만 검사해서다(실제 OL Map은 `olmp.map` 처럼
 *   한 단계 더 안쪽에 있음, OLMP.prototype.init 에서 `this.map = ...`로 생성).
 *   9차: ①이름을 확정해서(window.olmp, window.datasetolmp) 직접 `.map` 접근
 *   ②찾으면 클릭 좌표 계산 대신, **레이어의 벡터소스에서 이미 로드된 피처를
 *   getFeatures()로 직접 읽어버린다** — CLUSTER 서비스는 보통 OpenLayers
 *   Cluster소스가 내부 벡터소스를 감싸는 구조라, 화면에 뜬 순간 이미 브라우저
 *   메모리에 전체 피처(속성 포함)가 올라와 있을 가능성이 높다(클릭·픽셀 명중이
 *   전혀 필요 없는 방법). ③olmp-click.js·otms-clickinfo.js·otms-popup.js·
 *   otms-data.js(파일명으로 봐서 클릭·팝업 처리 담당으로 추정, 7차 키워드
 *   스캔에서는 매치가 0건이었지만 그건 NSHPAC 같은 리터럴이 없어서일 뿐 —
 *   범용 클릭 핸들러라 레이어명을 변수로 받을 것이다)의 전체 소스를 무조건
 *   덤프해 실제 클릭→조회 흐름을 코드로 확인한다.
 * [2026-09-01 수정9] 9차 실행 결과 확인: 이번엔 window.olmp 를 이름으로 바로 찾는 데
 *   성공했다(7차의 실패 원인이 맞았음 — duck-typing이 1단계만 봐서 놓쳤던 것).
 *   setZoom(15) 호출도 성공했지만 실제로는 12로 클램프됐다(olmp.js 소스에 있는
 *   `resolutions` 배열 길이와 일치 — 이 지도의 최대 줌은 12가 맞다). 그런데 벡터
 *   피처 직접 읽기는 등부표(buoy_A01) 레이어만 찾았고 인명사고(vi_nshpac_p)는
 *   0건이었다 — 줌을 최대(12)까지 올리고 재조회해도 마찬가지였다. 이건 8차의
 *   tile_yn:"Y" 추정과 일치한다: 인명사고 레이어는 브라우저에 벡터로 캐시되는 게
 *   아니라 진짜 서버가 구운 래스터(PNG) 타일이라 getFeatures() 로는 애초에 안
 *   잡힌다 — 클릭 시 서버에 물어보는 방식이 맞을 가능성이 더 커졌다.
 *   한편 dumpFullFileContents 로 4개 파일(olmp-click.js 54825자·otms-data.js
 *   4144자·otms-clickinfo.js 60137자·otms-popup.js 16384자)을 모두 무사히
 *   가져왔지만, 각 파일을 6000자까지만 잘라서 찍었더니 정작 필요한 부분(각
 *   파일의 나머지 대부분, 특히 올림프클릭 필터 표에서 VI_NSHPAC_P 항목이 있을
 *   자리 및 그 값을 실제로 서버에 보내는 함수 본문)이 전부 "...생략"으로
 *   잘려나갔다 — 확인 안 하고 넘어갈 뻔한 케이스라 이번엔 자르지 않는다(추측
 *   금지 — 실제로 다 읽어야 함). 10차: FULL_DUMP_MAX_CHARS 를 6000→70000으로
 *   올려 4개 파일 전부를 통째로(총 약 13만5천자) 출력한다.
 * [2026-09-01 수정10] 10차 실행 결과 확인: 잘림을 없애자 핵심 코드가 다 나왔다 —
 *   `otms-popup.js`에 `clusterPopupNS.vi_nshpac_p = function(feature, data){...}`
 *   가 있고, 그 안에서 `data.result[i].accymd`(사고발생일)·`acctyp`(사고유형)·
 *   `accloc`(사고지점, 탭 제목으로 씀) 3개 필드를 꺼내 팝업을 그린다. 이 `data`가
 *   어디서 오는지도 같은 파일 `fn_cluster_selected(features)`에서 확인됨 —
 *   클릭된 피처들의 `layerNm`·`gid`를 모아 **`POST {ctxPath}/map/cmm/
 *   clickCluster.json`**  본문 `{LAYER:layerNm, ARRGID:[gid,...]}`로 던지면
 *   `{result:[{accymd,acctyp,accloc,...}]}` 를 돌려주는 구조였다(실제 엔드포인트
 *   이름·요청/응답 스키마를 코드로 확정 — 추측 아님). 다만 이 gid 값 자체가 어디서
 *   브라우저에 로드되는지는 여전히 못 봤다(9차 벡터스캔에서 인명사고 레이어는
 *   0건이었음 — gid를 미리 받아두는 별도 벌크 로드 API가 있을 텐데 10차까지
 *   한 번도 안 잡혔음, 등부표의 `buoyList.json`과 같은 역할을 하는 무언가로 추정).
 *   11차: 지도 클릭·줌 흉내를 계속 추측하는 대신, **이 clickCluster.json 엔드포인트를
 *   지도 조작 없이 직접 호출**해본다 — 등부표 gid가 0부터 시작하는 작은 정수였던
 *   것처럼 인명사고 gid도 그럴 가능성이 있어, gid 0~99 를 무작정 넣어 응답이 오는지
 *   시험한다(선행 조건 없이도 동작하면 지도 자동화 전체가 필요 없어짐 — 클릭 한 번
 *   없이 전체 데이터를 gid 순회로 받아올 길이 열릴 수 있다).
 * [2026-09-01 수정11] 11차 실행 결과 확인: clickCluster.json 은 지도 조작 없이도
 *   바로 됐다(gid 0~499 무작정 넣어 실제 사고 레코드 다수 확인 — 예: gid 26 =
 *   "2022-12-02, 울산항 SK6부두 인근 해상"). **하지만 응답에 위도/경도 좌표가 아예
 *   없다** — accloc(지명 텍스트)·accymd(날짜)·acctyp(유형)·accckr(전부 null)뿐이라,
 *   이건 우리가 이미 갖고 있는 원본 엑셀의 "위치텍스트"와 같은 성격의 정보다(오히려
 *   좌표가 없어 우리가 가진 것보다 적음). 즉 클릭 시 뜨는 이 API는 사고 "속성"만
 *   주지 "좌표"는 안 준다 — 지도에 마커를 정확히 찍는 진짜 좌표는 여전히 다른
 *   경로(9차에서 찾다 만 gid+좌표 벌크로더, 등부표의 buoyList.json에 해당하는
 *   무언가)에 있다. 12차: 그 로더의 실체를 코드로 확정하려고 `olmp.js`·
 *   `datasetolmp.js`(9차 keyword-scan 이 15건 매치 제한에 걸려 앞부분만 봤던 —
 *   `changeSqlLayer` 함수 시작부만 보였음)를 dumpFullFileContents 대상에 추가해
 *   전체 본문을 읽는다. 추가로, 9차의 setCenter/setZoom 직접 호출이 진짜 사용자
 *   이동처럼 로딩을 트리거했는지 불확실했으므로(zoom 15→12로 클램프된 것만 확인,
 *   moveend 이후 뜨는 벌크 요청은 못 봤음), 확대 후 작은 추가 이동(pan)을 한 번 더
 *   넣어 moveend 계열 이벤트가 확실히 발생하게 만든 뒤 벡터 피처를 재조회한다.
 * [2026-09-01 수정12] 12차 실행 결과 확인: 로그가 하도 커져(45만자) 이번엔 내가
 *   불러온 로그 조회 도구 자체가 앞부분(olmp.js 전체덤프·JS 번들 스캔 목록)을
 *   잘라먹었다 — 그런데 그 덕에 datasetolmp.js 뒷부분(잘리지 않은 tail)에서
 *   결정적인 대목이 나왔다: `datasetOLMP.prototype.addEvents` 안에
 *   `this.map.on('moveend', function(e){ ... if(this.checkZoom()){ ...
 *   this.changeSqlLayer(zoom); ... } })` 로 등록돼 있었다 — **줌 "레벨이
 *   변경되었을 경우"(checkZoom() true)에만** changeSqlLayer 가 불린다. 12차의
 *   추가 이동(pan)은 줌은 그대로 두고 중심좌표만 옮겼으므로 checkZoom() 이 false였을
 *   것이다(그래서 재조회해도 여전히 인명사고 0건) — 자체 버그였다. 13차: moveend
 *   이벤트가 실제로 뜨는지 계속 흉내내는 대신, **`changeSqlLayer(zoom)` 를
 *   `window.olmp`/`window.datasetolmp` 인스턴스에서 직접 호출**한다(메서드명·호출
 *   패턴을 소스에서 실제로 확인했으므로 추측이 아님 — `this.changeSqlLayer(zoom)`
 *   그대로). 이러면 이벤트 발생 여부와 무관하게 그 함수가 실행되어, 안에서 실제로
 *   무슨 네트워크 요청을 쏘는지(우리가 찾던 gid+좌표 벌크로더일 가능성) 바로 확인
 *   가능하다.
 * [2026-09-01 수정13] 13차 실행 결과 확인: changeSqlLayer(zoom) 직접 호출은
 *   에러 없이 성공했다(olmp, zoom 12) — 그런데도 재조회 결과는 여전히 인명사고
 *   0건이었다. 네트워크 캡처 전체를 다시 훑어보니 **1~13차 통틀어 단 한 번도
 *   인명사고 레이어(vi_nshpac_p) 관련 타일·데이터 요청 자체가 뜬 적이 없었다** —
 *   listOLMPData.json 메타데이터 조회만 매번 떴을 뿐. 즉 "인명사고" 토글 클릭이
 *   화면상 성공(evalClick ok:true)으로 찍혀도, 실제로 레이어를 켜는 동작까지는
 *   한 번도 완결되지 못했다는 뜻 — changeSqlLayer 를 직접 불러도 애초에 "켜진
 *   레이어" 목록에 인명사고가 없으니 처리할 게 없었을 것이다.
 *   otms-gis.js 에서 확인한 다른 토글(연안재해취약성평가, fn_pd_click) 패턴을
 *   보면 진짜 스위치는 `<input type="checkbox" onclick="fn_xxx_click(this,
 *   'layerNm^type')">` 이고 `$this.is(':checked')` 로 상태를 직접 확인해
 *   addLayer 를 부른다 — 지금까지는 "인명사고" 텍스트를 소유한 요소를 찾아
 *   `.click()` 했을 뿐이라, 그 요소가 checkbox 와 `<label for=..>` 로 정식
 *   연결돼 있지 않으면 checkbox 자체는 안 눌렸을 수 있다(텍스트 요소 클릭이
 *   checkbox 로 이벤트를 전파 안 시켰을 가능성). 14차: 텍스트 근처에서 진짜
 *   `<input type="checkbox">` 를 찾아 그것 자체를 `.click()`(checked 토글 +
 *   click/change 이벤트 정상 발생)한다 — 못 찾으면 주변 마크업을 그대로 찍어
 *   다음 판단 근거로 남긴다.
 * [출력] 콘솔 요약(엔드포인트 목록) + JS 번들 스캔 결과 + local_server/data/khoa_probe_result.json
 *   (호출된 API 목록·샘플 응답 일부) + 스크린샷 다수(단계별 확인용)
 * [연계] .github/workflows/khoa-oceanmap-probe.yml
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_JSON = path.join(OUT_DIR, 'khoa_probe_result.json');
const SHOT_DIR = path.join(OUT_DIR, 'khoa_probe_shots');

const TARGET_URL = 'https://www.khoa.go.kr/oceanmap/main.do';

// API처럼 보이는 응답을 가려내는 기준 — GIS 사이트는 흔히 WMS/WFS/ArcGIS
// REST(OGC 표준) 아니면 자체 /api/ 를 쓴다.
const API_URL_HINT = /(api|\.json|geojson|wms|wfs|arcgis|featureserver|mapserver|rest\/services|ogc|geoserver|accident|person|인명)/i;
const INTERESTING_CONTENT_TYPE = /json|xml|geo\+json/i;

function isInteresting(url, contentType) {
    return API_URL_HINT.test(url) || INTERESTING_CONTENT_TYPE.test(contentType || '');
}

const KEY_ENDPOINT_HINT = /(listOLMPData|buoyList|accident|person|인명|nshpac)/i;

/** 텍스트를 직접 소유한(자식 텍스트노드 기준) 요소 목록 — {el, text}. */
function collectTextOwners(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
        const own = Array.from(node.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .join('');
        if (own) out.push({ el: node, text: own });
    }
    return out;
}

/** "target" 이라는 텍스트가 페이지에 여러 번 나올 때, "neighborTexts" 를 전부
 * 같이 갖고 있는 가장 작은 컨테이너 안에서만 target 을 찾아 클릭한다 — 상단
 * 메뉴·사이드바·breadcrumb 처럼 같은 단어가 여러 화면 영역에 나오는 문제를
 * "이웃 문맥"으로 구분한다(2026-09-01, 사용자 스크린샷으로 정확한 경로 확인 후). */
async function evalClickScoped(page, target, neighborTexts, log) {
    try {
        const result = await page.evaluate(({ target, neighborTexts }) => {
            function collectTextOwners(root) {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                const out = [];
                let node;
                while ((node = walker.nextNode())) {
                    const own = Array.from(node.childNodes)
                        .filter((n) => n.nodeType === 3)
                        .map((n) => n.textContent.trim())
                        .join('');
                    if (own) out.push({ el: node, text: own });
                }
                return out;
            }
            const all = document.querySelectorAll('*');
            let best = null, bestSize = Infinity;
            for (const el of all) {
                const nodes = collectTextOwners(el);
                const texts = nodes.map((n) => n.text);
                if (neighborTexts.every((t) => texts.some((x) => x.includes(t)))) {
                    const size = el.querySelectorAll('*').length;
                    if (size < bestSize) { bestSize = size; best = el; }
                }
            }
            if (!best) return { ok: false, reason: '이웃 문맥을 만족하는 컨테이너 못 찾음' };
            const nodes = collectTextOwners(best);
            const targetNode = nodes.find((n) => n.text.includes(target));
            if (!targetNode) return { ok: false, reason: '컨테이너 안에서 target 못 찾음' };
            targetNode.el.click();
            return { ok: true };
        }, { target, neighborTexts });
        log.push({ step: `evalClickScoped:"${target}" (이웃:${neighborTexts.join(',')})`, ok: result.ok, reason: result.reason || null });
        return result.ok;
    } catch (e) {
        log.push({ step: `evalClickScoped:"${target}"`, ok: false, reason: String(e.message || e).slice(0, 200) });
        return false;
    }
}

async function evalClickByText(page, text, log) {
    try {
        const clicked = await page.evaluate((needle) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
                const own = Array.from(node.childNodes)
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent.trim())
                    .join('');
                if (own.includes(needle)) {
                    node.click();
                    return true;
                }
            }
            return false;
        }, text);
        log.push({ step: `evalClick:"${text}"`, ok: clicked, reason: clicked ? null : '요소 못 찾음' });
        return clicked;
    } catch (e) {
        log.push({ step: `evalClick:"${text}"`, ok: false, reason: String(e.message || e).slice(0, 200) });
        return false;
    }
}

/** 지도를 그리는 가장 큰 canvas 요소의 화면상 위치를 찾는다(줌·클릭 좌표 계산용). */
async function findMapCanvasBox(page) {
    return page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (!canvases.length) return null;
        let best = null, bestArea = 0;
        canvases.forEach((c) => {
            const r = c.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) { bestArea = area; best = r; }
        });
        return best ? { x: best.left, y: best.top, width: best.width, height: best.height } : null;
    });
}

// 마커 클릭 관련 함수/엔드포인트를 코드에서 직접 찾는다 — 7차 실행까지 클릭
// 자동화(휠 확대·더블클릭·격자 클릭)로는 못 찾았고, window 에도 지도 인스턴스가
// 노출돼 있지 않았다(2026-09-01). 추측성 클릭 대신 페이지가 실제로 로드하는
// JS 번들 소스 안에서 관련 키워드를 직접 찾는 게 더 확실하다.
const JS_SCAN_KEYWORDS = /(NSHPAC|nshpac|인명사고|selectNSH|olmp|OLMP|getFeatureInfo|markerClick|popupInfo|acdntInfo|ACDNT_TYPE|nonShip|non_ship)/;

async function scanLoadedScripts(page) {
    const scriptUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]')).map((s) => s.src)
    );
    console.log(`\n[JS 번들 스캔] 로드된 script 태그 ${scriptUrls.length}개`);
    scriptUrls.forEach((u) => console.log('  -', u));

    let totalMatches = 0;
    for (const url of scriptUrls) {
        if (totalMatches >= 50) break;
        let text;
        try {
            text = await page.evaluate((u) => fetch(u).then((r) => r.text()), url);
        } catch (e) {
            console.log(`  [가져오기 실패] ${url}: ${e.message}`);
            continue;
        }
        const matches = [];
        let m;
        const re = new RegExp(JS_SCAN_KEYWORDS.source, 'g');
        while ((m = re.exec(text)) && matches.length < 15) {
            const start = Math.max(0, m.index - 80);
            const end = Math.min(text.length, m.index + 120);
            matches.push(text.slice(start, end).replace(/\s+/g, ' '));
        }
        if (matches.length) {
            console.log(`\n  [매치 ${matches.length}건] ${url}`);
            matches.forEach((snippet, i) => console.log(`    #${i + 1}: ...${snippet}...`));
            totalMatches += matches.length;
        }
    }
    console.log(`\n[JS 번들 스캔 완료] 총 매치 ${totalMatches}건`);
}

// 파일명 자체가 "클릭/팝업 처리 담당"으로 보이는 스크립트는 키워드 매치 여부와
// 무관하게 전체 내용을 덤프한다(범용 핸들러라 레이어명이 리터럴로 안 박혀
// 있을 수 있음, 2026-09-01 8차 결과로 확인).
const FULL_DUMP_URL_SUBSTRINGS = ['olmp-click', 'otms-clickinfo', 'otms-popup', 'otms-data', 'olmp.js'];
// 'olmp.js' 는 olmp.js 자신과 datasetolmp.js(둘 다 파일명이 "olmp.js"로 끝남) 둘 다
// 잡고, olmp-click.js 는 안 잡는다("olmp-click.js" 안에 "olmp.js"라는 연속 문자열이
// 없음 — "olmp" 다음이 "-click.js"지 ".js"가 아님). 12차: changeSqlLayer(줌 게이트
// 걸린 실제 데이터 로더) 전체 본문을 보려고 추가.
const FULL_DUMP_MAX_CHARS = 70000; // 9차에서 6000자로 잘라 핵심 부분(NSHPAC 항목·실제 호출부)을 놓쳤다 — 4개 파일 다 통째로

async function dumpFullFileContents(page) {
    const scriptUrls = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]')).map((s) => s.src)
    );
    for (const url of scriptUrls) {
        if (!FULL_DUMP_URL_SUBSTRINGS.some((s) => url.includes(s))) continue;
        let text;
        try {
            text = await page.evaluate((u) => fetch(u).then((r) => r.text()), url);
        } catch (e) {
            console.log(`\n[전체덤프 가져오기 실패] ${url}: ${e.message}`);
            continue;
        }
        const clipped = text.length > FULL_DUMP_MAX_CHARS ? text.slice(0, FULL_DUMP_MAX_CHARS) + `\n...(이하 ${text.length - FULL_DUMP_MAX_CHARS}자 생략)` : text;
        console.log(`\n[전체덤프] ${url} (전체 ${text.length}자)`);
        console.log(clipped);
    }
}

// 10차 dumpFullFileContents 로 otms-popup.js 안에서 실제 클릭→조회 API를 코드로
// 확정했다: 클릭된 피처의 layerNm·gid 를 모아 POST clickCluster.json 에
// {LAYER, ARRGID} 로 던지면 {result:[{accymd,acctyp,accloc,...}]} 를 준다
// (fn_cluster_selected 함수, otms-popup.js). 지도 클릭 자동화를 계속 추측하는
// 대신, 이 엔드포인트를 gid 를 무작정 순회하며 직접 호출해본다 — 등부표 gid가
// 0부터 시작하는 정수였던 것과 같은 패턴이면 지도 조작 없이 데이터를 받을 수 있다.
async function tryClickClusterDirect(page, layerNm, gidStart, gidEnd, label) {
    const gidArr = [];
    for (let g = gidStart; g <= gidEnd; g++) gidArr.push(g);
    const result = await page.evaluate(async ({ layerNm, gidArr }) => {
        try {
            const res = await fetch('/oceanmap/map/cmm/clickCluster.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ LAYER: layerNm, ARRGID: gidArr }),
            });
            const status = res.status;
            const text = await res.text();
            return { ok: true, status, text: text.slice(0, 8000), textLength: text.length };
        } catch (e) {
            return { ok: false, error: String(e.message || e) };
        }
    }, { layerNm, gidArr });
    console.log(`\n[clickCluster.json 직접 호출·${label}] LAYER=${layerNm} ARRGID=${gidStart}..${gidEnd}`);
    console.log('  결과:', JSON.stringify(result).slice(0, 8500));
    return result;
}

// 13차까지 인명사고 레이어 관련 네트워크 요청이 단 한 번도 안 떴다 — 매번
// evalClickByText 로 텍스트를 소유한 요소를 찾아 .click() 했지만, otms-gis.js
// 에서 확인한 다른 토글(연안재해취약성평가) 패턴을 보면 실제 스위치는
// <input type="checkbox" onclick="fn_xxx_click(this,'layerNm^type')"> 이고
// checked 상태를 직접 확인해 addLayer 를 호출한다 — 텍스트 라벨을 클릭해도
// 그 라벨이 checkbox 와 <label for=..> 로 정식 연결돼 있지 않으면 checkbox 자체가
// 안 눌릴 수 있다. 14차: 텍스트 근처에서 실제 checkbox 를 찾아 그것 자체를
// .click() 한다(checkbox.click() 은 checked 상태 토글 + click/change 이벤트를
// 전부 정상 발생시킴 — 텍스트 요소를 클릭하는 것과 다름). 못 찾으면 주변 마크업을
// 그대로 찍어 다음 판단 근거로 남긴다(추측 대신 실제 구조 확인).
async function findAndToggleCheckbox(page, text, log) {
    const result = await page.evaluate((needle) => {
        function collectTextOwners(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            const out = [];
            let node;
            while ((node = walker.nextNode())) {
                const own = Array.from(node.childNodes)
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent.trim())
                    .join('');
                if (own) out.push({ el: node, text: own });
            }
            return out;
        }
        const owners = collectTextOwners(document.body).filter((o) => o.text.includes(needle));
        if (!owners.length) return { ok: false, reason: '텍스트 소유 요소 못 찾음', matches: 0 };

        for (const owner of owners) {
            // 텍스트 요소 자신 → 부모로 최대 5단계 올라가며 checkbox 탐색
            let container = owner.el;
            for (let depth = 0; depth < 5 && container; depth++) {
                const cb = container.querySelector && container.querySelector('input[type="checkbox"]');
                if (cb) {
                    const before = cb.checked;
                    cb.click();
                    return {
                        ok: true,
                        matches: owners.length,
                        depth,
                        beforeChecked: before,
                        afterChecked: cb.checked,
                        cbOuterHtml: cb.outerHTML.slice(0, 300),
                        containerHtml: container.outerHTML.slice(0, 1500),
                    };
                }
                container = container.parentElement;
            }
        }
        // checkbox 를 못 찾았으면 첫 매치 주변 마크업이라도 남긴다
        const first = owners[0].el;
        let ctx = first;
        for (let i = 0; i < 3 && ctx.parentElement; i++) ctx = ctx.parentElement;
        return { ok: false, reason: '5단계 내 checkbox 못 찾음', matches: owners.length, containerHtml: ctx.outerHTML.slice(0, 2000) };
    }, text);
    console.log(`\n[checkbox 토글] "${text}" 검색 결과:`, JSON.stringify(result).slice(0, 3000));
    log.push({ step: `findAndToggleCheckbox:"${text}"`, ok: result.ok, reason: result.ok ? `depth=${result.depth}, checked ${result.beforeChecked}→${result.afterChecked}` : result.reason });
    return result;
}

async function dumpVisibleTexts(page, label) {
    try {
        const texts = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('body *').forEach((el) => {
                if (out.length > 400) return;
                const own = Array.from(el.childNodes)
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent.trim())
                    .join('');
                if (own && own.length <= 60) out.push(own);
            });
            return out;
        });
        console.log(`[${label} 화면 텍스트 스냅샷·${texts.length}개] ${JSON.stringify(texts)}`);
    } catch (e) {
        console.log(`[${label} 텍스트 덤프 실패]`, e.message);
    }
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    const captured = [];
    let watchAllJson = false;
    page.on('response', async (res) => {
        try {
            const url = res.url();
            const headers = res.headers();
            const contentType = headers['content-type'] || '';
            const jsonLike = /json/i.test(contentType);
            if (!isInteresting(url, contentType) && !(watchAllJson && jsonLike)) return;
            const req = res.request();
            const postData = req.postData();
            let bodySample = null;
            try {
                const buf = await res.body();
                bodySample = buf.toString('utf8').slice(0, 1500);
            } catch (_) { /* 바디 못 읽는 응답(리다이렉트 등)은 무시 */ }
            captured.push({
                url, status: res.status(), contentType,
                method: req.method(), postData, bodySample,
            });
            if (KEY_ENDPOINT_HINT.test(url) || (watchAllJson && jsonLike)) {
                console.log(`\n[핵심API${watchAllJson ? '·클릭후' : ''}] ${req.method()} ${url}`);
                console.log('  요청 본문:', (postData || '(없음)').slice(0, 1000));
                console.log('  응답 본문:', (bodySample || '(없음)').slice(0, 3000));
            }
        } catch (_) { /* 개별 응답 실패는 전체 흐름에 영향 없게 무시 */ }
    });

    const clickLog = [];

    console.log('[1/6] 메인 페이지 접속:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 }).catch((e) => {
        clickLog.push({ step: 'goto', ok: false, reason: String(e.message || e).slice(0, 300) });
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, '1_initial.png'), fullPage: false }).catch(() => {});

    await scanLoadedScripts(page);
    await dumpFullFileContents(page);

    console.log('[1b/6] clickCluster.json 직접 호출 시험 (탐색 이전 — 선행조건 없이도 되는지 확인)');
    await tryClickClusterDirect(page, 'vi_nshpac_p', 0, 99, '탐색전');

    console.log('[2/6] "데이터셋" 탭 진입');
    await evalClickByText(page, '데이터셋', clickLog);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOT_DIR, '2_dataset_tab.png'), fullPage: false }).catch(() => {});

    console.log('[3/6] "안전" 카테고리 펼치기 (이웃: 지형/지명·항해지원)');
    await evalClickScoped(page, '안전', ['지형/지명', '항해지원'], clickLog);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '3_safety_category.png'), fullPage: false }).catch(() => {});

    console.log('[4/6] "사고정보" 하위메뉴 진입 (이웃: 갯골(상세)·편의시설)');
    await evalClickScoped(page, '사고정보', ['갯골(상세)', '편의시설'], clickLog);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOT_DIR, '4_accident_info_screen.png'), fullPage: false }).catch(() => {});
    await dumpVisibleTexts(page, '사고정보 화면 진입 직후');

    console.log('[5/6] "선박사고밀도" 섹션 펼치기 (이웃: 선박사고분석)');
    await evalClickScoped(page, '선박사고밀도', ['선박사고분석'], clickLog);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '5_density_section.png'), fullPage: false }).catch(() => {});
    await dumpVisibleTexts(page, '선박사고밀도 펼친 직후');

    console.log('[6/6] "인명사고" 토글 — checkbox 직접 탐색 우선 시도(14차)');
    watchAllJson = true;
    // 13차까지 텍스트 클릭(evalClickByText)만 썼는데 인명사고 레이어 네트워크
    // 요청이 한 번도 안 떴다 — 실제 스위치가 checkbox 일 가능성이 커서 이번엔
    // 그것부터 찾아 직접 누른다. 실패하면 기존 방식(텍스트 클릭)으로 폴백한다.
    const cbResult = await findAndToggleCheckbox(page, '인명사고', clickLog);
    let personClicked = cbResult.ok;
    if (!personClicked) {
        // 4차 실행에서 이웃 텍스트("선박사고(해양") 기준 스코프가 실패했다 — 이 화면
        // 안에서는 "인명사고"가 유일한 텍스트일 가능성이 높아 스코프 없이 먼저 시도하고,
        // 실패하면 이미 확인된 안전한 이웃("선박사고분석")으로 재시도한다.
        personClicked = await evalClickByText(page, '인명사고', clickLog);
        if (!personClicked) {
            personClicked = await evalClickScoped(page, '인명사고', ['선박사고분석'], clickLog);
        }
    }
    await page.waitForTimeout(5000); // 마커 데이터 로드 대기
    await page.screenshot({ path: path.join(SHOT_DIR, '6_person_layer_on.png'), fullPage: false }).catch(() => {});
    await dumpVisibleTexts(page, '인명사고 토글 클릭 직후');

    console.log('[6b/6] clickCluster.json 직접 호출 재시험 (토글 이후 — 세션 상태가 필요한 경우 대비, 범위 넓힘)');
    await tryClickClusterDirect(page, 'vi_nshpac_p', 0, 499, '토글후');

    console.log('[7/10] window.olmp / window.datasetolmp 이름으로 직접 지도 인스턴스 찾기');
    // 7차 실행은 window[key] 1단계만 duck-typing 스캔해서 실패했다 — 실제 OL Map은
    // olmp.map / datasetolmp.map 처럼 한 단계 안쪽에 있다(olmp.js 소스 확인:
    // "var olmp = null;" 전역선언 + "OLMP.prototype.init"에서 "this.map = ...").
    // 이번엔 이름을 확정해서 바로 접근한다.
    const BUSAN_PROJECTED = [1141273.66, 1679416.70]; // 부산 인근(EPSG:5179 상당)
    const mapApiResult = await page.evaluate((center) => {
        function tryOne(name) {
            try {
                const wrapper = window[name];
                if (!wrapper || !wrapper.map || typeof wrapper.map.getView !== 'function') return null;
                const view = wrapper.map.getView();
                const beforeZoom = view.getZoom();
                view.setCenter(center);
                view.setZoom(15);
                return { name, beforeZoom, afterZoom: view.getZoom() };
            } catch (e) {
                return { name, error: String(e.message || e) };
            }
        }
        const olmpResult = tryOne('olmp');
        const datasetResult = tryOne('datasetolmp');
        const hit = (olmpResult && !olmpResult.error) ? olmpResult : ((datasetResult && !datasetResult.error) ? datasetResult : null);
        return {
            ok: !!hit,
            mapKey: hit ? hit.name : null,
            beforeZoom: hit ? hit.beforeZoom : null,
            afterZoom: hit ? hit.afterZoom : null,
            olmpResult, datasetResult,
        };
    }, BUSAN_PROJECTED);
    console.log('  window.olmp/window.datasetolmp 조회 결과:', JSON.stringify(mapApiResult));
    clickLog.push({ step: 'olmp.map / datasetolmp.map 직접 접근', ok: mapApiResult.ok, reason: mapApiResult.ok ? `key=${mapApiResult.mapKey}, zoom ${mapApiResult.beforeZoom}→${mapApiResult.afterZoom}` : JSON.stringify({ olmp: mapApiResult.olmpResult, dataset: mapApiResult.datasetResult }) });

    console.log('[7b/10] 지도 인스턴스를 찾았으면 벡터 레이어에서 이미 로드된 피처를 직접 읽기 시도 (클릭 불필요)');
    const vectorScanResult = await page.evaluate(() => {
        function describeMap(mapObj, label) {
            if (!mapObj || typeof mapObj.getLayers !== 'function') return null;
            const out = { label, layers: [] };
            function walk(layers) {
                layers.forEach((l) => {
                    try {
                        if (typeof l.getLayers === 'function') { walk(l.getLayers().getArray()); return; }
                        const src = typeof l.getSource === 'function' ? l.getSource() : null;
                        if (!src) return;
                        let inner = src;
                        let kind = src.constructor ? src.constructor.name : '?';
                        if (typeof src.getSource === 'function') {
                            try {
                                const s2 = src.getSource();
                                if (s2) { inner = s2; kind += '>' + (s2.constructor ? s2.constructor.name : '?'); }
                            } catch (_) { /* 클러스터가 아닌 소스는 getSource 접근 시 예외 가능 — 무시 */ }
                        }
                        if (inner && typeof inner.getFeatures === 'function') {
                            const feats = inner.getFeatures();
                            const sample = feats.slice(0, 5).map((f) => {
                                try {
                                    const props = f.getProperties ? Object.assign({}, f.getProperties()) : {};
                                    if (props.geometry) delete props.geometry;
                                    let coord = null;
                                    try {
                                        const g = f.getGeometry && f.getGeometry();
                                        coord = g && g.getCoordinates ? g.getCoordinates() : (g && g.getFirstCoordinate ? g.getFirstCoordinate() : null);
                                    } catch (_) { /* 좌표 추출 실패는 무시 */ }
                                    return { props, coord };
                                } catch (_) { return null; }
                            });
                            out.layers.push({ kind, featureCount: feats.length, sample });
                        }
                    } catch (_) { /* 레이어 하나 실패해도 나머지는 계속 */ }
                });
            }
            try { walk(mapObj.getLayers().getArray()); } catch (_) { /* 전체 실패 시 빈 결과 */ }
            return out;
        }
        const results = [];
        if (window.olmp && window.olmp.map) results.push(describeMap(window.olmp.map, 'olmp'));
        if (window.datasetolmp && window.datasetolmp.map) results.push(describeMap(window.datasetolmp.map, 'datasetolmp'));
        return { hasOlmp: !!(window.olmp && window.olmp.map), hasDatasetolmp: !!(window.datasetolmp && window.datasetolmp.map), results: results.filter(Boolean) };
    });
    console.log('  벡터 피처 직접 읽기 결과:', JSON.stringify(vectorScanResult).slice(0, 8000));
    clickLog.push({ step: '벡터 레이어 getFeatures() 직접 읽기', ok: vectorScanResult.results.some((r) => r.layers.some((l) => l.featureCount > 0)), reason: JSON.stringify({ hasOlmp: vectorScanResult.hasOlmp, hasDatasetolmp: vectorScanResult.hasDatasetolmp, layerCounts: vectorScanResult.results.map((r) => ({ label: r.label, layers: r.layers.map((l) => ({ kind: l.kind, count: l.featureCount })) })) }) });

    const mapBox = await findMapCanvasBox(page);
    if (!mapApiResult.ok && mapBox) {
        // API를 못 찾았으면 더블클릭 줌으로 대체(더블클릭은 OL 기본 상호작용으로 보통
        // 1회당 정확히 1레벨씩 확대돼 휠보다 예측 가능하다). 훨씬 깊게(15회) 시도.
        console.log('  Map API 실패 — 더블클릭 확대로 대체(15회, 남동쪽 부산·거제 방향)');
        const zx = mapBox.x + mapBox.width * 0.60;
        const zy = mapBox.y + mapBox.height * 0.68;
        for (let i = 0; i < 15; i++) {
            await page.mouse.dblclick(zx, zy);
            await page.waitForTimeout(600);
        }
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOT_DIR, '7_zoomed_in.png'), fullPage: false }).catch(() => {});

    console.log('[7b2/10] changeSqlLayer(zoom) 직접 호출 — 12차에서 확인: moveend 안에서도 checkZoom()==true(줌 "레벨"이 실제로 바뀐 경우)일 때만 이 함수가 불린다. 12차의 순수 이동(pan)은 줌을 안 바꿔서 이 조건을 못 만족했을 것 — 이벤트에 기대지 않고 메서드를 직접 부른다(datasetOLMP.prototype.addEvents 소스에서 확인한 실제 호출 패턴 this.changeSqlLayer(zoom) 그대로, 추측 아님)');
    const sqlLayerResult = await page.evaluate(() => {
        function callOne(name) {
            try {
                const w = window[name];
                if (!w || !w.map || typeof w.map.getView !== 'function') return { name, ok: false, reason: '인스턴스 없음' };
                if (typeof w.changeSqlLayer !== 'function') return { name, ok: false, reason: 'changeSqlLayer 메서드 없음' };
                const zoom = w.map.getView().getZoom();
                w.changeSqlLayer(zoom);
                return { name, ok: true, zoom };
            } catch (e) {
                return { name, ok: false, reason: String(e.message || e) };
            }
        }
        return { olmp: callOne('olmp'), datasetolmp: callOne('datasetolmp') };
    });
    console.log('  changeSqlLayer 직접 호출 결과:', JSON.stringify(sqlLayerResult));
    await page.waitForTimeout(3000); // changeSqlLayer 내부 AJAX 응답 대기

    console.log('[7c/10] 확대 후 벡터 피처 재조회 (datasetOLMP.changeSqlLayer 는 일정 줌 레벨 이상에서만 데이터를 채운다 — limitZoom 게이트 확인됨)');
    const vectorScanResult2 = await page.evaluate(() => {
        function describeMap(mapObj, label) {
            if (!mapObj || typeof mapObj.getLayers !== 'function') return null;
            const out = { label, layers: [] };
            function walk(layers) {
                layers.forEach((l) => {
                    try {
                        if (typeof l.getLayers === 'function') { walk(l.getLayers().getArray()); return; }
                        const src = typeof l.getSource === 'function' ? l.getSource() : null;
                        if (!src) return;
                        let inner = src;
                        let kind = src.constructor ? src.constructor.name : '?';
                        if (typeof src.getSource === 'function') {
                            try {
                                const s2 = src.getSource();
                                if (s2) { inner = s2; kind += '>' + (s2.constructor ? s2.constructor.name : '?'); }
                            } catch (_) { /* 무시 */ }
                        }
                        if (inner && typeof inner.getFeatures === 'function') {
                            const feats = inner.getFeatures();
                            const sample = feats.slice(0, 5).map((f) => {
                                try {
                                    const props = f.getProperties ? Object.assign({}, f.getProperties()) : {};
                                    if (props.geometry) delete props.geometry;
                                    let coord = null;
                                    try {
                                        const g = f.getGeometry && f.getGeometry();
                                        coord = g && g.getCoordinates ? g.getCoordinates() : (g && g.getFirstCoordinate ? g.getFirstCoordinate() : null);
                                    } catch (_) { /* 무시 */ }
                                    return { props, coord };
                                } catch (_) { return null; }
                            });
                            out.layers.push({ kind, featureCount: feats.length, sample });
                        }
                    } catch (_) { /* 무시 */ }
                });
            }
            try { walk(mapObj.getLayers().getArray()); } catch (_) { /* 무시 */ }
            return out;
        }
        const results = [];
        if (window.olmp && window.olmp.map) results.push(describeMap(window.olmp.map, 'olmp'));
        if (window.datasetolmp && window.datasetolmp.map) results.push(describeMap(window.datasetolmp.map, 'datasetolmp'));
        return { results: results.filter(Boolean) };
    });
    console.log('  확대 후 벡터 피처 재조회 결과:', JSON.stringify(vectorScanResult2).slice(0, 8000));
    clickLog.push({ step: '확대 후 벡터 레이어 재조회', ok: vectorScanResult2.results.some((r) => r.layers.some((l) => l.featureCount > 0)), reason: JSON.stringify(vectorScanResult2.results.map((r) => ({ label: r.label, layers: r.layers.map((l) => ({ kind: l.kind, count: l.featureCount })) }))) });

    console.log('[8/10] 확대 중심(화면 정중앙) 주변 격자를 클릭해 마커 맞춰보기');
    const centerBox = await findMapCanvasBox(page);
    if (centerBox) {
        const cxBase = centerBox.x + centerBox.width / 2;
        const cyBase = centerBox.y + centerBox.height / 2;
        const offsets = [
            [0, 0], [-20, -20], [20, -20], [-20, 20], [20, 20],
            [0, -40], [0, 40], [-40, 0], [40, 0],
            [-60, -60], [60, -60], [-60, 60], [60, 60],
        ];
        for (let i = 0; i < offsets.length; i++) {
            const [dx, dy] = offsets[i];
            const cx = cxBase + dx, cy = cyBase + dy;
            const beforeCount = captured.length;
            await page.mouse.click(cx, cy);
            await page.waitForTimeout(1000);
            const newCount = captured.length - beforeCount;
            clickLog.push({ step: `마커 격자 클릭 #${i + 1} (${Math.round(cx)},${Math.round(cy)})`, ok: newCount > 0, reason: newCount > 0 ? `새 응답 ${newCount}건` : '새 응답 없음' });
            if (newCount > 0) {
                await page.screenshot({ path: path.join(SHOT_DIR, `8_marker_hit_${i + 1}.png`), fullPage: false }).catch(() => {});
            }
        }
        await page.screenshot({ path: path.join(SHOT_DIR, '9_after_grid_clicks.png'), fullPage: false }).catch(() => {});
        await dumpVisibleTexts(page, '격자 클릭 완료 후');
    } else {
        clickLog.push({ step: '지도 캔버스 찾기(2차)', ok: false, reason: 'canvas 요소를 못 찾음' });
    }

    console.log('[9/9] 추가 대기 후 네트워크 수집 마감');
    await page.waitForTimeout(3000);

    await browser.close();

    const uniqueByUrl = new Map();
    captured.forEach((c) => { if (!uniqueByUrl.has(c.url)) uniqueByUrl.set(c.url, c); });
    const unique = Array.from(uniqueByUrl.values());

    console.log(`\n총 캡처 응답 ${captured.length}건, URL 기준 중복제거 ${unique.length}건`);
    unique.forEach((c) => {
        console.log(`  [${c.status}] ${c.method} ${c.contentType} ${c.url}`);
    });

    console.log('\n클릭 시도 로그:');
    clickLog.forEach((c) => console.log('  ', JSON.stringify(c)));

    fs.writeFileSync(OUT_JSON, JSON.stringify({ target: TARGET_URL, clickLog, captured: unique }, null, 1));
    console.log('\n결과 저장:', OUT_JSON);
}

main().catch((e) => {
    console.error('probe 실패:', e);
    process.exit(1);
});
