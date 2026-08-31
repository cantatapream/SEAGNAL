/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/accident_info.js
 * 역할  : 해양안전 지도에 "사고정보" 버튼을 얹는다. 클릭하면 왼쪽으로 선박(해경)·
 *         인명 2개 소스 버튼(천기 팝아웃과 같은 개별 아이콘 버튼 스타일)이 뜨고,
 *         고르면 팝아웃이 접히며 데이터가 켜진다(선박(심판원) 소스는 2026-08-21에
 *         제외 — 해경 데이터를 쓰기로 사용자 확정). 이미 켜진
 *         상태에서 사고정보 버튼을 다시 누르면 access_control.js 등과 동일하게
 *         전부 끈다(사용자 확정 2026-08-19). "현황"(개별 사고 마커, hazard_rocks.js
 *         와 같은 클러스터 방식) ↔ "분석"(지도 화면을 격자로 나눠 격자별 건수를
 *         색으로 표시, 격자 클릭 시 통계 바텀시트) 토글은 사고정보가 켜진 동안만
 *         좌측 상단(#ocean-topleft-controls, 기본맵·안내 버튼 아래)에 나온다.
 *         낱개 마커는 사고유형별 이미지 아이콘(hazard_rocks.js 와 같은 120px
 *         캔버스 방식)이고, 여러 건이 뭉친 클러스터는 그 안에서 가장 많은
 *         사고유형의 이미지를 대표로 보여준다(hazard_rocks.js 는 "켜진 버튼"
 *         기준이라 다름 — 사용자 확정 2026-08-18). 켜면 access_control.js 등과
 *         같은 패턴으로 배경지도가 위성지도로 자동 전환된다(사용자 확정 2026-08-19).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/shared/utils/accident_codes.js(코드값→한글 라벨,
 *                    ACCIDENT_TYPE_ICONS 마커 이미지 경로, ACCIDENT_TYPE_EXCLUDED
 *                    표출 제외 목록), client/images/accident_markers/*.png,
 *                    OpenLayers(ol.*), assets/vendor/chartjs/chart.umd.min.js
 *                    (분석 뷰 차트 — admin_survey.js 와 같은 Chart.js, 2026-08-29)
 *  - 서버 API      : GET /accident_ships_hk.json · /accident_persons.json
 *                    (정적, 소스 버튼을 처음 누를 때만 지연 로드 — hazard_rocks.js
 *                    와 동일한 절약 방식)
 *  - 마크업        : index2.html 의 #ocean-accident-toggle-btn(버튼),
 *                    #ocean-accident-wrap/#ocean-accident-popup(소스 선택 팝아웃),
 *                    #ocean-accident-source-list, #ocean-accident-mode-toggle
 *                    (현황/분석 — #ocean-topleft-controls 안, 해양안전 화면이
 *                    빌려 쓰는 해양종합정보 기본맵·안내 버튼 바로 아래),
 *                    #accident-stats-sheet/#accident-stats-body(격자 클릭 시 통계),
 *                    #accident-filter-bar(필터 버튼 7개 — 사고유형/관할서/시간대/계절/
 *                    특보/선박용도/톤수, #ocean-accident-mode-toggle 바로 아래)
 *  - 나를 쓰는 곳  : ocean_map.js handleMapClick → window._accidentInfoTryHandleClick
 *                    (access_control.js 와 동일하게 window.getOceanMap 폴링으로
 *                    스스로 설치 — ocean_map.js buildMap() 수정 불필요)
 *                    window.oceanGetBasemap/oceanSetBasemap(ocean_map.js, 배경지도
 *                    자동 전환/복귀)
 * [로드 순서] navigational_warning.js 다음 · life_safety.js 바로 앞
 * [데이터 출처] 국립해양조사원 개방海 "선박사고(해경)"·"인명사고" —
 *   local_server/scripts/build_accidents.js 로 생성(원본 CSV는 레포에 없음).
 * [좌표 이상치 필터] 원본 좌표(ORGNL_XCDNT/YCDNT) 자체에 개별 오류가 소수 섞여
 *   있다(사용자 보고: 지도상 위치가 주소 텍스트와 안 맞음 — 조사 결과 좌표 변환
 *   로직 문제가 아니라 원본 데이터 오류로 확인, 사용자 확정 2026-08-20: 이상치는
 *   지도에서 제외). ensureRawFeatures 가 같은 "사고발생위치" 텍스트를 가진 행들의
 *   좌표 중앙값과 비교해 0.3도(≈33km) 이상 벗어난 행을 제외한다(findCoordOutliers).
 *   같은 텍스트가 1건뿐이면 비교 대상이 없어 판정하지 않는다. 선박(심판원)은 이
 *   위치텍스트 컬럼이 원본에 없어 이 필터를 적용하지 못한다(그대로 노출).
 * [위치 미상 뭉침 필터] 사용자 보고(2026-08-20): "화면을 최대로 확대해도 여전히
 *   뭉쳐있는 클러스터가 있다" — 조사 결과 좌표 반올림이 아니라 위치텍스트가 완전히
 *   빈 값인 사고들이 관할 해양경찰서의 대표 좌표(청사 근처)로 채워져 완전히 동일한
 *   좌표를 갖고 있었다(hk 최대 30건까지 겹침, 실측 606건). 완전 동일 좌표는 클러스터
 *   distance=0(SPREAD_ZOOM 이상 줌)이어도 갈라지지 않으므로 최대 줌에서도 하나로
 *   보인다 — 실제 사고 위치가 아니라서 지도에서 뺀다(findMissingLocationClusters).
 * [육지 표출 — 재조사(2026-08-20 사용자 재확인 요청)] "여전히 육지에 마커가 많다"는
 *   재보고로 다시 판 결과, 두 가지 별개 원인을 찾았다:
 *   1) 클러스터 대표점 문제(주된 원인) — ol.source.Cluster 는 기본적으로 클러스터
 *      위치를 멤버 평균 좌표(centroid)로 계산하는데, 굴곡진 해안선(특히 서해)에서는
 *      흩어진 항구 여러 곳의 평균이 육지(반도) 한가운데로 나온다(실측: 태안 인근
 *      5,545건의 평균좌표가 육지 판정). createCluster 콜백으로 평균 대신 "멤버 중
 *      하나의 실제 좌표"를 대표점으로 쓰도록 고쳤다(createClusterAtRealPoint) —
 *      실제 좌표는 이미 정확하므로(아래) 이 방식이면 클러스터가 항상 진짜 사고
 *      지점 위에 놓인다.
 *   2) 원본 데이터베이스의 위도 입력 오타(정확히 ±1도, 소수) — LAT_OFFSET_FIXES 참고.
 *   [좌표 정확성 검증] 사용자가 khoa.go.kr 개방海 사이트 F12로 확인해준 실제 API
 *   (POST /oceanmap/map/cmm/selectListCluster.json, layer=tl_shpacc_hk_p)가 주는
 *   x/y(EPSG:5179)를 WGS84로 변환해 우리 데이터와 대조한 결과 13개 샘플이 100%
 *   정확히 일치했다 — build_accidents.js 의 좌표 변환 로직과 원본 CSV 좌표 자체는
 *   정확하다(API 를 다시 받아도 달라지지 않는다는 뜻). 즉 "육지에 있는 것처럼 보이는"
 *   마커 대다수는 좌표 오류가 아니라 위 클러스터 평균점 문제이거나, 실제로 항구·
 *   방파제·양식장처럼 해안에 매우 가까운 정확한 위치다(위성지도 배경에서 육지처럼
 *   보일 뿐). ocean_overlay.js 의 기존 육지 마스크(/api/ocean/land-mask)는 국소적
 *   오차가 있어(해안선 근처 일부 지점 — 서울시청·태평양·하와이 등 명백한 지점은
 *   정확) 단독 필터링 근거로는 못 쓰지만, 시군구 지명 참조표와 함께 "위도 ±1 오타"
 *   후보를 좁히는 이중검증 용도로는 활용했다(아래 LAT_OFFSET_FIXES).
 * [3차 재조사 — 강원 산악 내륙·범위밖 재확인(2026-08-20, 머지 후 재보고)] "머지 후에도
 *   완전 내륙(강원 산악)에 마커가 있고, '완도군' 사고가 필리핀 근처에 표시된다"는
 *   스크린샷 재보고로 다시 조사:
 *   - "완도군 금일읍 장도" 사고(hk, [4.08333, 127.16667])는 재확인 결과 KOREA_BOUNDS
 *     (latMin 24)로 이미 걸러짐을 확인(코드·서버 서빙 바이트까지 대조). 화면에 남아
 *     있었다면 배포 반영 지연/캐시가 원인일 가능성이 크다 — sw.js 는 정적 자원을
 *     stale-while-revalidate 로 캐시하지만 CACHE_VERSION 이 배포마다 bump 되어(Docker
 *     빌드 단계) 새 배포 후 재접속하면 새 캐시로 교체된다.
 *   - 강원 산악 내륙 클러스터는 원본이 "OO-00N, OO-00E"처럼 도(度) 단위로만 기록된
 *     저정밀 좌표(예: [38,128]) 때문으로 확인 — 양양군 사고 4건이 정확히 [38,128]로
 *     겹쳐 있었다(사용자가 본 "산속 클러스터"로 추정). 서해안처럼 해안이 완만한 곳은
 *     1도 반올림이어도 우연히 바다 근처에 남지만, 강원 동해안은 해안선 바로 뒤가
 *     태백산맥이라 반올림만으로 산속에 놓인다. isIntegerDegreeCoord + isLandPoint
 *     (land-mask 재사용, 이번엔 "정수도 좌표"로만 범위를 좁혀 적용 — 전체 좌표에
 *     적용하면 해안가 실제 사고까지 대량 오탐 제외됨, 실측 16%) 로 제외.
 *   - 위 두 필터로 못 잡는 개별 오류 4건(hk 2건: "OO 동방 N해리" 텍스트인데 좌표는
 *     반대로 산속에 있음 · person 2건: 통영시 사고인데 좌표가 강원권, 3도 이상
 *     어긋남 — ±1 오타도 이상치 비교군도 없음)은 KNOWN_BAD_COORDS 로 개별 제외.
 * [검수 모드 (2026-08-20 추가)] 자동/AI 판정만으론 못 잡는 개별 좌표 오류가 더
 *   있을 수 있어, 사용자가 실제 앱 화면(실제 위성지도·실제 마커 이미지)에서 직접
 *   눈으로 보고 골라낼 수 있게 만든 기능. 사고정보를 켜면 하단 중앙에 항상 함께
 *   뜬다(처음엔 ?debug=review 쿼리로 숨겼으나, 매번 쿼리를 붙이기 번거롭다는
 *   요청으로 상시 노출로 변경 — 패널은 기본 접힌 한 줄이라 평소엔 거의 안 보임).
 *   낱개 마커를 클릭하면 기존 상세 팝업이 그대로 뜨고(무슨 사고인지 보고 판단하도록)
 *   추가로 빨간 테두리가 켜지며 패널 목록에 쌓인다. 뭉친 클러스터를 클릭하면
 *   기존과 동일하게 그 범위로 확대만 될 뿐 선택되지 않는다 — 여러 건이 한 픽셀에
 *   뭉쳐 있을 때 실수로 전부 선택되는 걸 막기 위함(사용자 확정 2026-08-20). "내보내기"
 *   를 누르면 {hk:[origIndex,...], person:[...]} 형식 JSON 을 텍스트
 *   상자에 채운다 — KNOWN_BAD_COORDS 등 제외 목록에 반영할 원본 행 인덱스.
 * [선박(심판원) 소스 완전 제외(2026-08-21)] 선박(해경)·선박(심판원) 둘 다 원본 CSV에
 *   WGS84 경위도 컬럼이 그대로 있어 정확도 차이는 없지만, 해경 데이터가 위치텍스트·
 *   발생원인·선박종류·관할해경서까지 더 상세해 해경 쪽을 쓰기로 사용자 확정(2026-08-20
 *   에 반대로 해경을 빼고 심판원만 남긴 적이 있었으나, 다시 뒤집혔다 — git으로 그
 *   변경을 되돌리고 이번엔 심판원 쪽을 제거). 버튼·데이터 fetch·필터·팝업·통계 등
 *   hs 관련 코드를 전부 제거했다(정적 파일도 삭제).
 * [선박(해경) 좌표 오류 95건 원본 데이터에서 삭제(2026-08-21)] 검수 모드로 사용자가
 *   눈으로 직접 확인해 "내보내기"한 목록을 JS 필터가 아니라 `client/accident_ships_hk.json`
 *   원본에서 행 자체를 지웠다 — 사용자 확정: "제외 = 데이터베이스에서 삭제, 현황·분석
 *   양쪽 다 사라져야 함". 현황·분석 둘 다 같은 `ensureRawFeatures`/`rawFeatures` 캐시를
 *   쓰므로 JS 필터로도 양쪽 다 사라지긴 하지만, 원본에서 지우는 쪽이 더 확실하고
 *   목록도 KNOWN_BAD_COORDS처럼 하드코딩 배열로 계속 늘어나지 않는다. 42,583 → 42,488건.
 *   [주의] `build_accidents.js`를 원본 CSV로 재실행하면 이 95건이 되살아난다(원본 CSV가
 *   레포에 없어 당장 재실행될 위험은 낮지만, 다음에 데이터 갱신할 일이 생기면 이 95건을
 *   다시 지워야 한다는 뜻 — 정확한 좌표값은 이 커밋의 diff에서 확인 가능).
 * [선박(해경) 좌표 오류 2차 102건 삭제(2026-08-21)] 같은 방식으로 검수 모드 2회차
 *   결과를 반영 — 42,488 → 42,386건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [선박(해경) 좌표 오류 3차 447건 삭제(2026-08-21)] 같은 방식으로 검수 모드 3회차
 *   결과를 반영 — 42,386 → 41,939건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [선박(해경) 좌표 오류 4차 137건 삭제(2026-08-21)] 같은 방식으로 검수 모드 4회차
 *   결과를 반영 — 41,939 → 41,802건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [선박(해경) 좌표 오류 5차 27건 삭제(2026-08-21)] 같은 방식으로 검수 모드 5회차
 *   결과를 반영 — 41,802 → 41,775건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [선박(해경) 좌표 오류 6차 107건 삭제(2026-08-21)] 같은 방식으로 검수 모드 6회차
 *   결과를 반영 — 41,775 → 41,668건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [선박(해경) 좌표 오류 7차 103건 삭제(2026-08-21)] 같은 방식으로 검수 모드 7회차
 *   결과를 반영 — 41,668 → 41,565건. 위와 같은 build_accidents.js 재실행 주의사항 적용.
 * [위치 미상 뭉침 필터 — 중복레코드 분리(2026-08-21)] 사용자 지적("같은 좌표라도 사고종류가
 *   다르면 통째로 지우면 안 된다")으로 재조사한 결과, findMissingLocationClusters 가 걸러내던
 *   135개 뭉침 그룹 중 62개는 날짜·시각·사고유형까지 완전히 같은 "중복 입력"이었다(예: 화재
 *   사고 1건이 30번 겹쳐 있었음). 이런 경우는 관할서 대표좌표 문제와 무관하므로 1건만 남기고
 *   중복분만 제외하도록 로직을 바꿨다(hk 기준 숨김 606→502건, 104건이 정상 노출로 복원됨).
 *   나머지 73개 그룹(날짜·시각·유형이 다 다른데 좌표만 소수점까지 완전 일치)은 실제 GPS로는
 *   사실상 불가능한 값이라 기존처럼 관할서 대표좌표로 보고 계속 숨긴다.
 * [지오코딩 검수 1회차 — 7건 삭제 + 10건 좌표수정(2026-08-22)] accident_geocode_review.js
 *   화면으로 사용자가 직접 확인한 1회차 결과를 반영 — 저장된 좌표가 명백히 틀린 7건은
 *   삭제, 위치텍스트로 계산한 좌표가 맞다고 판단된 10건은 그 좌표로 수정했다(단순 삭제가
 *   아니라 좌표 자체를 고친 첫 사례). 41,565 → 41,558건.
 * [지오코딩 검수 2회차 — 8건 삭제 + 9건 좌표수정(2026-08-23)] accident_geocode_review.js
 *   화면 내보내기 결과에 브라우저 localStorage가 1회차 판정을 그대로 다시 포함해서 보냈음을
 *   발견(삭제 15건 중 7건·좌표수정 19건 중 10건이 origIndex·좌표값까지 1회차와 완전히 동일).
 *   그 1회차 재중복분은 "이미 원본번호 기준으로 처리 완료"라 현재(1회차 삭제로 밀린) 번호
 *   기준으로 다시 적용하면 엉뚱한 행을 건드리므로 걸러내고, 진짜 2회차 신규 판정만 반영했다
 *   (신규 삭제 8건 + 신규 좌표수정 9건). "유지" 135건은 후보목록(candidates.json)에서 제외해
 *   다음 검수부터 다시 안 뜨도록 처리(14건은 마찬가지로 1회차 원본번호 잔재라 판단 보류, 다음
 *   회차에 현재 번호로 다시 노출됨). 41,558 → 41,550건.
 * [지오코딩 검수 3회차 — 37건 삭제 + 42건 좌표수정(2026-08-23)] accident_geocode_review.js
 *   판정 키를 내용 기반으로 바꾼 뒤 첫 회차 — 내보내기 422/37/42건 전부 "지금 후보목록에
 *   실존하는 항목"으로만 나와, 2회차 때 겪은 1회차 재중복 문제가 재발하지 않았다(반영 전
 *   교차검증으로 확인). "유지" 422건은 후보목록에서 제외. 41,550 → 41,513건.
 * [지오코딩 검수 4회차 — 45건 삭제 + 40건 좌표수정(2026-08-23)] accident_geocode_review.js
 *   "유지" 379건까지 후보목록에서 제외하면서 후보목록(accident_geocode_candidates.json)이
 *   0건이 됨 — 2026-08-21 1차 전수조사로 뽑은 의심 후보 1,134건을 4회차에 걸쳐 전부
 *   검토 완료. 41,513 → 41,468건.
 * [기존 검수 모드(REVIEW_MODE) 28건 삭제 + 위치텍스트 빈값 전량 삭제(2026-08-23)]
 *   사용자가 지도에서 직접 골라 낸(한국 근해를 크게 벗어난 명백한 이상좌표) 28건 삭제 —
 *   이 검수 모드는 flaggedItems 가 브라우저 저장 없이 세션 메모리에만 있어(localStorage
 *   미사용) 지오코딩 검수화면과 달리 origIndex 밀림 문제가 없다. 이어서 위치텍스트가
 *   빈 문자열인 행(팝업에 "-"로 표시) 15,450건도 전량 삭제 — 사용자에게 "이미 화면에서만
 *   숨겨둔 502건(관할서 대표좌표 뭉침, `findMissingLocationClusters`)만 뜻하는지 위치텍스트
 *   없는 전체 15,457건을 뜻하는지" 확인받아(전자는 좌표만 있고 텍스트만 없는 정상 기록도
 *   섞여있어 규모 차이가 큼) 후자로 확정. 41,468 → 25,990건. 이 삭제로
 *   `findMissingLocationClusters`(위치 미상 뭉침 필터)가 걸러낼 대상(빈 위치텍스트 행)이
 *   더는 없어 사실상 상시 공집합을 반환하는 상태가 됐다 — 에러는 없으나 로직 자체는 휴면
 *   상태, 코드는 그대로 둠(관계된 다른 정리와 함께 나중에 정리).
 * [관할 미상(orgCd=0) 전량 삭제(2026-08-23)] 사용자 요청으로 관할해경서 코드가 0(원본 CSV
 *   빈 값, `accident_codes.js`에서 "관할 미상"으로 표시되던 것)인 행 2,448건 삭제.
 *   25,990 → 23,542건.
 * [필터 바 — 사고유형·관할서·시간대·계절(2026-08-24 사용자 확정)] "지금은 사고마커에
 *   관한 모든 정보가 다 표출되는데, 필터로 손쉽게 골라 보고 싶다"는 요청으로 추가.
 *   처음엔 현황(마커 표출)은 사고유형 필터만, 분석(격자 집계)은 관할서·사고유형·시간대·
 *   계절 4개를 지원했으나, 현황에서도 똑같이 다양한 필터를 쓰고 싶다는 요청으로 5개
 *   전부(+특보) 현황·분석 공통 노출로 바뀌었다(2026-08-25 사용자 확정 — index2.html
 *   버튼의 data-mode-only 속성 제거, updateFilterBarModeVisibility 는 이제 위치
 *   재계산만 함). #ocean-accident-mode-toggle 바로 아래 #accident-filter-bar,
 *   index2.html 정적 마크업 + style.css). 버튼을 누르면 체크박스 다중선택 팝업(관할서·
 *   유형·계절 공용) 또는 시간대 전용 팝업(4시간 간격 프리셋 다중토글 + 임의 범위를
 *   칩으로 추가하는 직접 설정)이 뜨고, 확인을 누르면 버튼 라벨이 "N개 선택"으로
 *   바뀐다. 옵션 목록은 정적 코드표가 아니라 지금 활성 소스(rawFeatures[state.source])
 *   에 실제로 존재하는 값만 건수와 함께 보여준다(0건짜리 선택지를 안 보여주기 위함).
 *   필터는 현황·분석 공용 하나의 상태(passesFilters)로 판정해 마커(applyFiltersToMarkers,
 *   ol.source.Cluster 의 내부 ol.source.Vector features 를 갈아끼움)와 격자(recomputeGrid)
 *   양쪽에 똑같이 적용된다 — 모드를 바꿔도 걸어둔 필터가 유지된다. person 소스는 발생시각
 *   컬럼이 없어 시간대 필터를 통과시킨다(판단 불가를 "해당 없음 취급"하는 기존 원칙과 동일).
 * [특보발표여부 필터 — 5번째 필터로 추가(2026-08-24)] 위에서 "뒤로 미뤘다"고 적었던
 *   특보 필터를 실제로 구현했다. 사고 하나하나에 "그 시각(또는 그 날) 태풍·풍랑·강풍
 *   특보가 실제로 발효 중이었는지"를 빌드타임에 미리 계산해(로컬 서버, 클라이언트 아님)
 *   `client/accident_ships_hk.json`·`accident_persons.json` 각 행 끝에 필드로 붙여뒀다
 *   — 화면에서는 그 값만 읽어 필터링(런타임 계산 없음). 계산 스크립트·근거는
 *   `local_server/scripts/build_accident_warn_flags.js`(실행 방법·검증 결과 전부 그
 *   파일 헤더에). 요약:
 *   - hk(선박)는 태풍·풍랑만(강풍은 육상 개념이라 배 사고와 무관), person(인명)은
 *     태풍·풍랑·강풍 셋 다. hk 는 발생시각(hm)이 있어 정확한 시각 기준, person 은
 *     시각이 없어 그 날짜 전체와 겹치면 발효중으로 본다.
 *   - 마커는 대부분 해상인데 강풍구역은 육상 단위라 "점이 폴리곤 안"이 항상 실패함
 *     — 그래서 강풍만 "사고 지점이 육상구역 경계에서 3km 이내면 가장 가까운 구역
 *     기준으로 판정"(사용자 확정: "해안에서 3km 이내면 특보 영향권으로 보자").
 *   - 필터에서 여러 특보종류(예: 강풍+풍랑)를 동시에 켜면 OR — 그 중 하나라도
 *     발효중이면 통과(passesFilters 의 filters.warnTypes 처리 참고). AND로 하면
 *     해상 사고는 강풍과 원래 무관해 대부분 사라져버리기 때문(사용자 지적).
 *   - 위 "①~④ 확정 규칙"(부모→자식 전개·CSV 표기 일관성·통보문 단위 뭉침·구분자 분리)
 *     은 강풍(육상)·태풍·풍랑(해상) 양쪽 다 실제로 그대로 맞았다 — 해상 쪽 부모→자식
 *     전개표는 이미 `local_server/config/zone_group_map.js` 에 있던 걸 재사용(사용자가
 *     "이미 되어있는데 확인해봐"라고 짚어줌).
 * [필터 개선 4가지(2026-08-25 사용자 확정)]
 *   - 사고유형 옵션에서 "-"(코드 없음)·정확히 "기타"인 것만 목록에서 제외(buildTypeOptions).
 *     "기타(인명)"·"기타(선박)" 등 구체적인 것은 남긴다.
 *   - 체크박스 팝업(사고유형·관할서·계절·특보)에 "전체 선택" 행 추가 — 한 번에 다 켜고/끈다.
 *   - 옵션별 건수를 "이 축만 단독"이 아니라 "지금까지 고른 다른 필터와의 교집합"으로 바꿈
 *     (passesFiltersExcept — 팝업을 열 때 그 축만 빼고 나머지 필터를 이미 건 채로 센다).
 *     예: 사고유형=전복 선택 후 관할서 팝업을 열면, 각 관할서 옆 숫자는 "전복이면서 그
 *     관할서인" 건수. 시간대 프리셋 버튼에도 같은 방식으로 건수를 표시.
 *   - 모드토글 오른쪽에 "선택 초기화" 버튼 추가(#accident-filter-reset-btn) — 걸어둔
 *     필터 5개(types·orgs·hourRanges·seasons·warnTypes) 전부 null 로 되돌린다.
 *   - 사고유형 체크박스 순서를 충돌·침몰·전복·화재·좌초·좌주·폭발·표류·접촉 9개 먼저,
 *     나머지는 원래 순서(건수 내림차순) 그대로 뒤에 붙도록 고정(TYPE_ORDER_PRIORITY).
 * [현황도 필터 5개 다 노출(2026-08-25 사용자 확정)] 관할서·시간대·계절·특보가 분석
 *   모드에서만 보였는데, 현황(마커)에서도 똑같이 다양한 필터를 쓰고 싶다는 요청으로
 *   5개 전부 현황·분석 공통 노출로 바꿈. passesFilters() 는 원래 모드와 무관하게
 *   전부 판정하므로 코드 로직 변경은 없고, index2.html 버튼의 data-mode-only 속성만
 *   제거(updateFilterBarModeVisibility 도 위치 재계산만 하도록 단순화).
 * [바텀시트(그리드형 사고분석)가 하단 탭 바에 가려 잘리던 문제 수정(2026-08-25)]
 *   `.accident-stats-sheet` 가 `bottom:0` 이라 index2.html #bottom-tab-bar(하단
 *   메인탭)와 겹쳐 "사고발생상세" 탭 등 아래쪽 내용이 잘려 보였다(사용자 스크린샷
 *   확인). index2.html이 다른 하단 고정 요소(#ocean-map-section 등)에 이미 쓰는
 *   `--main-tab-height`(JS 실측, safe-area 포함) 로 `bottom` 값을 바꿔 탭 바 위에
 *   앉도록 수정(style.css).
 * [orgCd=1750000("국민안전처") 데이터 삭제(2026-08-25)] "관할 미상"(orgCd=0)과 같은 성격
 *   (다른 1750xxx 코드는 전부 구체적 해양경찰서로 매핑됐는데 이것만 특정 못 한 값)이라
 *   사용자 요청으로 원본 데이터에서 삭제(hk 115건·person 4건). 근거는
 *   `shared/utils/accident_codes.js` 헤더 참고.
 * [선박(해경) 좌표 오류 9차 6건 삭제(2026-08-25)] 검수 모드로 사용자가 직접 확인해
 *   내보낸 목록을 원본에서 삭제 — 같은 방식으로 8차까지 이어온 것과 동일.
 *   23,427 → 23,421건.
 * [심판원 신규 CSV 좌표 검수 레이어 추가(2026-08-25)] 검수 모드(10회 연타)로 들어간
 *   상태에서 같은 버튼을 5회 더 누르면, 아직 앱 정식 데이터가 아닌 해양안전심판원
 *   신규 CSV(2021~2025)의 좌표만 파란 점으로 지도에 뿌려 도분초→십진도 변환이
 *   맞는지 눈으로 확인할 수 있게 했다("경위도 정보가 제대로 반영되었는지 보기 위해"
 *   — 사용자 요청). 데이터는 local_server/scripts/build_tribunal_review.js 가
 *   client/accident_tribunal_review.json 으로 미리 변환해둔 것을 그대로 fetch —
 *   필터·팝업 없이 좌표만 있는 확인 전용 레이어라 SOURCES 정식 등록은 안 함.
 * [위 레이어를 hk/person 과 같은 클러스터링으로 교체(2026-08-25)] 처음엔 순수
 *   ol.source.Vector 에 고정 스타일(파란 점)만 얹어 줌과 무관하게 16,889건이
 *   전부 그대로 찍혔다 — 사용자가 "우리가 설정한 클러스터 모양이 아니라 낱개
 *   포인터로, 줌 레벨과 무관하게 다 뜬다. 동일하게 맞춰 달라고 했잖아"라고 지적.
 *   buildClusterLayer(hk/person 이 쓰는 바로 그 함수)를 재사용해 줌 기반 뭉치기
 *   (CLUSTER_DISTANCE·SPREAD_ZOOM)·클러스터 대표점 계산까지 동일하게 맞췄다.
 *   원본 CSV엔 사고유형 컬럼이 없어(row=[lat,lon,caseNo] 3필드) 유형별 아이콘은
 *   못 붙이지만, 그 부분만 빼면 뭉치는 거리·줌 임계값은 완전히 같다(낱개는
 *   fallbackStyle 파란 점, 클러스터는 숫자만 있는 빨간 원 — 실제 레이어에서
 *   아이콘 없는 유형을 그릴 때와 같은 스타일).
 * [사고유형 필터 — "좌초/좌주"를 "좌초"에 합침(2026-08-25)] 심판원 데이터 통합 논의 중
 *   hk 사고유형 필터에 좌초(ATY023)·좌주(ATY022)·좌초/좌주(ATY041) 3개가 따로 나오는 걸
 *   확인, 사용자가 좌초/좌주를 좌초로 합치자고 확정. 근거: 좌주(ATY022) 단독코드는
 *   2013년까지만 쓰이고 이후 hk 원본 자체가 안 씀 — 지금 다루는 기간(2016~)엔 사실상
 *   좌초·좌초/좌주 둘뿐이라 하나로 봐도 정보 손실이 없다. `typeFilterCode()`로 필터
 *   옵션 집계·매칭에서만 ATY041→ATY023 취급(마커 아이콘·상세 팝업은 원래 코드 유지).
 * [해양안전심판원 데이터 통합 — B안(2026-08-25 사용자 확정)] hk(해경) 데이터는
 *   2016년·2021~2024년이 원래는 있었으나 이전 위치텍스트 정제(2026-08-23) 때
 *   같이 지워져 비어 있었다. 이 구간을 심판원 CSV(2016~2025)와 "완벽히 동일한
 *   사고"(3km 이내 + 5분 이내, 사고유형 불문 — 사용자 확정: "위치가 동일한데
 *   5분 이내라면 동일한 사고로 인정")로 매칭되는 hk 원본 행만 복원하고, 매칭 안
 *   된 나머지는 계속 지운 채로 둔다(local_server/scripts/build_tribunal_merge.js).
 *   복원된 행에는 심판원의 선박용도·톤수·계절·사건번호를 얹는다. 2025년은 hk가
 *   원래부터 없는(원본 자체 공백) 해라 심판원 행을 단독으로 추가하고, 관할서는
 *   해양경찰청 직제 시행규칙 [별표 2](법령 원문 PDF) 기반으로 재구성한 21개 서
 *   경계 폴리곤(local_server/config/coastguard_jurisdiction_faces.json, 순도
 *   기준 신뢰 면 263개) + 최근접이웃 보정으로 추정한다. 강릉해양경찰서(2025-03-31
 *   개서)는 그 날짜 이후 사고에만 적용하고(coastguard_gangneung_zone.json), 그
 *   이전엔 옛 관할서(동해/속초)로 판정한다 — 사용자 확정: "강릉서나 사천서나
 *   새롭게 생기기 전과 후를 고려해서 그 시점을 기준으로". 사고유형은 매칭된 행에서
 *   해경·심판원이 접촉/충돌로 서로 다르면 항상 충돌로 통일(사용자 확정). 결과:
 *   23,421 → 35,027건(2016 복원 1,268 + 2021~24 복원 6,498 + 2025 단독 3,840,
 *   합쳐서 11,606건 신규/복원). row 스키마가 13필드→17필드로 늘어(선박용도[13]·
 *   톤수[14]·계절[15]·사건번호[16] 추가, 매칭 없는 기존 행은 전부 null)
 *   popupRowsFor()가 null 아닌 값만 팝업에 추가로 보여준다(사건번호는 사용자에게
 *   의미 없어 팝업 미노출).
 * [신규/복원 행 특보발표여부 소급 계산(2026-08-25)] 병합 직후엔 신규/복원 11,606건의
 *   warnFlags(row[12])가 자리만 맞춘 빈 배열([])이라 특보 필터에서 "발효 없음"과
 *   구분이 안 됐다. build_accident_warn_flags.js 는 모든 행에 무조건 push 하는
 *   1회성 스크립트라 그대로 재실행하면 이미 값이 있는 기존 23,421건까지 다시 밀려
 *   스키마가 깨진다 — local_server/scripts/patch_new_accident_warn_flags.js 를
 *   새로 만들어, build_tribunal_merge.js 최종 조립 순서(기존 행이 항상 배열
 *   앞쪽 23,421개, 신규 행이 그 뒤로 이어 붙음)로 "새 행"만 골라 row[12] 를 실제
 *   계산값으로 덮어썼다(계산 로직은 build_accident_warn_flags.js 의 함수를 그대로
 *   재사용). 결과: 신규 11,606건 중 344건(2.96%)에 특보 발효(WV 342·TY+WV 2) —
 *   기존 23,421건의 발효 비율(499건, 2.13%)과 비슷해 정상 범위로 판단.
 * [필터 바에 선박용도·톤수 추가(2026-08-25)] 심판원 통합으로 생긴 두 필드도 다른
 *   5개(사고유형·관할서·시간대·계절·특보)와 같은 방식으로 필터에 얹었다 — hk 전용,
 *   값이 없는 행(대부분 — 신규/복원 11,606건 중에도 매칭 안 된 필드는 null)은 판단
 *   불가로 통과시킨다(hourRanges 와 같은 원칙, warnTypes 와는 다름 — 그쪽은 "발효
 *   없음"이 확정값이라 다르게 취급). 선박용도는 이미 한글 문자열이라 체크박스
 *   팝업(openCheckboxFilterPopup) 그대로 재사용. 톤수는 연속값이라 시간대와 같은
 *   "구간 프리셋 + 직접 설정" 방식이 맞아, 시간대 팝업(openHourRangeFilterPopup)의
 *   로직을 openRangeFilterPopup(cfg) 로 일반화해 재사용했다(90줄 가까운 로직을
 *   두 번 베끼지 않으려고 — 프리셋 배열·라벨 포맷·비교값 추출 함수만 cfg 로 갈아
 *   끼움, CSS 클래스는 시간대 때 이름을 그대로 씀). 톤수 구간(0~5·5~10·10~20·20~50·
 *   50~100·100~500·500~1,000·1,000톤 이상)은 실측 분포(hk 10,338건) 기준.
 * [톤수 팝업 프리셋 건수 버그 수정(2026-08-25)] 사용자가 톤수 팝업 스크린샷에서
 *   모든 프리셋이 24,000~29,000건대로 거의 비슷하게 나온다고 지적 — presetCount
 *   가 시간대 팝업에서 물려받은 로직 그대로 "값 없는(null) 행도 무조건 카운트"
 *   하고 있었는데, hk 는 시각 데이터가 거의 항상 있어(0/35,027 null) 시간대에선
 *   안 드러났지만 톤수는 35,027건 중 24,689건(70%)이 null이라 모든 버킷에 이
 *   24,689건이 그대로 더해져 버킷 간 차이가 안 보였다. 실제 필터링(passesFilters,
 *   null=판단불가로 통과)은 그대로 두고 건수 표시만 "실제로 값이 있는 행"만
 *   세도록 고쳐 buildValueOptions·buildWarnOptions 등 다른 필터 옵션 건수 표시와
 *   같은 원칙으로 통일했다. 같은 원인으로 person 소스 시간대 팝업도 모든 프리셋이
 *   전체 person 건수로 나오고 있었는데(발생시각 컬럼 자체가 없어 항상 null) 함께
 *   고쳐졌다 — 수정 후 person 은 전부 0건, hk 는 24시간대별 뚜렷한 분포로 확인.
 * [톤수·선박용도 필터 — "판단 불가=통과"를 "정보 없음=제외"로 정정(2026-08-25)]
 *   바로 위 항목에서 hourRanges와 같은 원칙으로 만들었던 걸, 사용자가 "5톤 미만만
 *   골랐는데 화면엔 훨씬 많이 남아있다"고 재지적해 뒤집었다. hourRanges·warnTypes는
 *   "그 소스엔 거의 항상 값이 있는데 극히 일부만 없음"이라 판단불가 통과가 맞지만,
 *   선박용도·톤수는 심판원 매칭 연도(선박용도: 2016·2021~2025 / 톤수: 2021~2025)
 *   에만 값이 있고 그 외 연도는 통째로 없어서, "통과"로 두면 필터를 걸어도 거의 안
 *   줄어드는 것처럼 보였다. passesFilters() 에서 이 두 필드만 null=제외로 바꾸고,
 *   필터를 실제로 걸 때(전체→선택) window._showOceanToast 로 "OO 정보는 YYYY년
 *   사고에만 있다"는 안내를 띄운다(formatYearRanges+yearsWithValue 로 연도 범위를
 *   실제 데이터에서 매번 계산 — 하드코딩 아님, 나중에 데이터가 늘어나도 자동으로
 *   맞음). 처음엔 이 토스트도 한 줄(nowrap+ellipsis) 스타일로 호출해 좁은 화면에서
 *   "..."로 잘려 보였다(사용자 스크린샷 지적) — _showOceanToast 의 4번째 인자
 *   (multiLine)를 true 로 넘겨 index2_patch.js 의 기존 .multi-line 스타일(어절
 *   단위 줄바꿈, 최대 75vw)을 그대로 쓰도록 고쳤다.
 * [2025 단독 행 사고유형코드(typeCd) 누락으로 마커가 전부 아이콘 없이 나오던 문제
 *   수정(2026-08-25)] 사용자가 "군집에서 가장 많은 유형으로 표현돼야 하는데 왜 이렇게
 *   나오냐"고 스크린샷으로 지적 — 2025년 단독 3,840건은 hk 원본이 없어 typeCd(row[5])
 *   가 애초에 null 이었는데(build_tribunal_merge.js 가 매핑 로직 없이 만듦),
 *   dominantTypeCode() 가 클러스터 안에서 가장 많은 유형을 뽑을 때 "코드 없음"이
 *   하나의 큰 덩어리로 뭉쳐 실제 사고유형(15종 이상으로 흩어짐)보다 더 자주 이겨
 *   버려 거의 모든 클러스터가 아이콘 없는 빨간 원+숫자로 보였다. 심판원 CSV의
 *   "해양사고종류1" 텍스트가 accident_codes.js ACCIDENT_TYPE_LABELS 와 같은 한글
 *   이라 build_tribunal_merge.js 에 SEA_TYPE_TO_ATY 역매핑을 추가(2021~2025 전체
 *   실측 20종 전부 매핑, unmapped 0건)하고, 이미 병합된 파일은 통째로 재실행하면
 *   중복이 생겨 local_server/scripts/patch_2025_type_codes.js 로 2025 구간(배열
 *   맨 끝 3,840개, 사건번호로 원본 CSV와 재대조)만 좁혀 typeCd 를 채웠다.
 * [심판원 검수 레이어를 "좌표만 보기"에서 "진짜 검수(클릭·선택·내보내기)"로 확장
 *   (2026-08-25)] "이 레이어 마커는 왜 클릭이 안 되고 아이콘도 없냐"는 지적에
 *   "원본 CSV엔 사고유형이 없다"고 답했는데 — 사용자가 원본 CSV(TL_SHPACC_HS_NEW.csv)
 *   를 직접 보여주며 "해양사고종류1" 컬럼이 있다고 정정: 잘못은 build_tribunal_review.js
 *   가 좌표·사건번호만 뽑고 사고유형은 버렸던 것이었다(설명 실수 인정). 이어서
 *   검수 목적 자체를 재확인: "해경과 병합된 것도, 병합 안 된 것도 전부 심판원
 *   데이터를 검수해서 육지에 찍힌 것 같은 문제를 걸러내려는 것" — 병합된 11,606건은
 *   기존 hk 검수모드(10회)로 이미 되지만, 병합 안 된 나머지는 hk 에 아예 없어서
 *   그쪽으로는 검수가 안 된다. 그래서:
 *   - build_tribunal_review.js 가 이제 row=[lat,lon,ymd,hm,typeCd,caseNo,merged]
 *     로 사고유형(SEA_TYPE_TO_ATY 역매핑, 실측 20종 전부 매핑)과 hk 병합 여부까지
 *     담는다(전체 17,036건, hk 병합됨 10,489건 — 이전 문서의 "16,889건"은 예전에
 *     있었다가 없어진 범위필터의 잔재 표기였고 지금은 무필터 전체 건수가 맞다).
 *   - ensureTribunalReviewLayer 가 feature 에 row·typeCode·origIndex 를 얹어
 *     hk/person 과 똑같이 dominantTypeCode 기반 아이콘이 뜬다(더는 아이콘 없는
 *     빨간 원 전용이 아님).
 *   - _accidentInfoTryHandleClick 이 TRIBUNAL_REVIEW_ON 일 때 tryHandleClusterClick
 *     을 'tribunal' 키로도 시도 — 낱개 클릭 시 popupRowsFor('tribunal', row) 가
 *     사고발생일·사고유형·사건번호·"해경 병합 여부"를 팝업으로 보여주고,
 *     toggleFlag(map,'tribunal',feature) 로 빨간 테두리 선택도 hk/person 과 동일하게
 *     동작한다 — 코드 변경 없이 기존 flaggedItems/내보내기(JSON 의 "tribunal" 키)
 *     메커니즘이 key 문자열만 다르게 그대로 재사용됨(export 는 애초에 item.key 로
 *     그룹핑하도록 일반화돼 있었다).
 *   Playwright 확인: 클릭 시 팝업에 "해경 병합 여부: 병합 안 됨(단독 심판원)" 등
 *   정상 표시, 선택 1건으로 카운트, 내보내기 JSON `{"tribunal":[0]}` 확인.
 * [병합된 행 팝업에 해경(hk) 데이터도 같이 표시(2026-08-25)] 위 팝업이 "해경 병합
 *   여부: 병합됨"만 보여주고 정작 그 hk 행 내용은 안 보여줘, 사용자가 "병합돼
 *   있으면 해경에서 표출하는 데이터도 함께 표출해줘 — 지금은 심판원 정보만
 *   표출한 거잖아, 종합적으로 판단할 수 있게" 라고 지적. ensureHkRowByCaseNo() 가
 *   fetchSource('hk') 결과로 사건번호(caseNo)→hk row 맵을 만들어두고,
 *   ensureTribunalReviewLayer() 가 레이어를 켤 때 Promise.all 로 이 맵도 함께
 *   준비해둔다(popupRowsFor 는 동기 함수라 클릭 시점엔 이미 준비돼 있어야 함).
 *   merged=1 인 행을 클릭하면 팝업에 해경 사고발생일·사고유형·위치텍스트·관할과
 *   더불어 haversineKm 으로 계산한 "심판원-해경 좌표 차이"까지 이어서 보여준다
 *   (매칭 허용 반경이 3km 라 완전히 같은 사고여도 좌표가 다를 수 있음 — 이 차이가
 *   바로 "육지에 찍힘" 같은 문제를 판단하는 핵심 단서). Playwright 로 실측 확인:
 *   BS-2021-0010(병합됨) 클릭 시 해경 사고유형=충돌(일치)·관할=창원해양경찰서·
 *   좌표차이 0.18km 로 정상 표시, 미병합 행은 기존과 동일하게 4줄만 표시.
 * [관할해경서 오분류 감사 → 지도(폴리곤) 수정 → 재분류·삭제(2026-08-25)] "관할이
 *   아닌 서 이름으로 들어간 데이터는 삭제해야" 는 사용자 지적에 따라
 *   audit_hk_jurisdiction_mismatch.js(읽기전용 감사)로 집계했더니 울진·속초만
 *   유독 높게 나와 재조사 → 두 서 폴리곤 자체가 부정확했음을 확인, 법령 원문
 *   기반으로 재구성(coastguard_jurisdiction_faces.json 커밋 참고, 울진 40.6%→1.6%·
 *   속초 17.9%→10.2%). 이어서 "폴리곤이 바뀌었으니 심판원 관할 분류 작업도
 *   다시 해야 하지 않냐"는 지적에 따라 reclassify_after_polygon_fix.js 신설 —
 *   classifyOrg() 로 관할서를 추정해 채웠던 행만(2016 복원 전체 + 2025 심판원
 *   단독 전체, 총 5,108건) 새 폴리곤으로 재분류(114건 orgCd 변경, 그중 92건이
 *   포항→울진). 이때 build_tribunal_merge.js classifyOrg() 에 강릉 외 신설서
 *   (평택·창원·보령·부안·울진·사천) 개서일 게이트도 함께 추가(이전엔 강릉만 있어
 *   울진 폴리곤이 정밀해지며 2017-11-28 이전 사고까지 울진으로 잘못 분류될
 *   위험이 커진 상태였음 — 게이트 걸리면 배열의 다음 매치, 대개 전신 서로 넘어감).
 *   사용자 확정으로 속초 잔여 "확실한" 불일치 59건(전부 폴리곤에서 12km 이상
 *   떨어진 원거리 오분류, 2건 제외 전부 속초와 무관한 원거리 좌표)도 함께 삭제
 *   → hk 35,027건→34,968건, 심판원 검수용 병합 카운트 10,489→10,487(삭제된
 *   행 중 사건번호 있던 2건). 최종 재감사 결과 속초 확실한 불일치 0.0%(0/521).
 * [관할서 불일치 검수 레이어 신설 — 사고정보 20회 연타(2026-08-25)] 남은 419건
 *   (제주⇄서귀포·부산⇄울산 등, 울진·속초는 위 항목으로 이미 해소)은 폴리곤 자동
 *   판정만으로 지우지 말고 사람이 직접 지도에서 보고 고르자는 사용자 지시("검수모드로
 *   하자... 관할서 경계선을 그려주고... 내가 사고 하나하나를 띄워주면 그걸 보고
 *   해당 경찰서명을 클릭하면서 검수")에 따라 검수 레이어를 하나 더 추가했다.
 *   - 검수 서브모드가 단순 on/off 두 단계(기본검수 10회 + 심판원 5회 더)에서 3단
 *     순환(꺼짐→심판원→관할서불일치, 5회 더 연타마다 한 단계)으로 바뀜 — 총 20회
 *     연타로 진입. 어떤 검수모드인지 헷갈리지 않게 단계가 바뀔 때마다 토스트로
 *     알려준다(사용자 확정: "모드 바뀔때마다 어떤거 검수모드인지 알려줄 수 있도록").
 *   - build_jurisdiction_boundaries.js 가 coastguard_jurisdiction_faces.json(21개서
 *     경계 폴리곤)을 client/coastguard_jurisdiction_boundaries.json 으로 내보내고,
 *     ensureJurisdictionBoundaryLayer 가 서마다 다른 색 외곽선(채움 없음)으로 그려
 *     경계선을 눈으로 볼 수 있게 한다.
 *   - build_jurisdiction_mismatch_review.js 가 audit_hk_jurisdiction_mismatch.js 와
 *     같은 판정 로직(사본)으로 "확실한" 불일치 419건을 client/accident_jurisdiction_
 *     mismatch.json 으로 내보내고, ensureJurisdictionMarkerLayer 가 낱개 마커(클러스터
 *     안 함 — 검수자가 하나씩 클릭해야 해서)로 찍는다.
 *   - 마커를 클릭하면 renderJurisdictionPopup 이 사고 정보 + 21개 관할서 버튼을
 *     보여준다(기록된 관할서=주황, 폴리곤 판정=초록 테두리로 미리 표시). 버튼을
 *     누르면 chooseJurisdiction 이 flaggedItems 에 {key:'jurisdiction', chosen}
 *     으로 저장 — 검수 모드 패널 내보내기가 이 chosen 값까지 JSON에 담는다
 *     (사용자 확정: "선택만 모아뒀다가 일괄 반영"). apply_jurisdiction_review.js 가
 *     그 내보내기 결과를 accident_ships_hk.json 에 실제로 반영(orgCd 수정)한다 —
 *     아직 실행 전(검수 자체가 아직 안 됨), 사람이 다 고른 뒤 별도로 돌릴 것.
 * [관할서 불일치 검수 레이어 범위·버튼 단순화(2026-08-25, 위 항목 병합 직후 사용자
 *   피드백)] "전국 419건이 다 나온다"·"21개 버튼 다 있을 필요 있냐" 두 지적으로
 *   위 구현을 수정:
 *   - build_jurisdiction_mismatch_review.js 에 SCOPE_PAIRS 추가 — 부산⇄울산·
 *     제주⇄서귀포 두 쌍(419건 중 164건, 가장 큰 두 쌍)만 내보낸다. 다른 쌍은
 *     이번 라운드 범위 밖(SCOPE_PAIRS 만 넓히면 나중에 확장 가능).
 *   - ensureJurisdictionBoundaryLayer 도 지금 후보에 실제 등장하는 서만 그리도록
 *     바뀜(21개 전체 → 부산·울산·제주·서귀포 4개) — relevantOwners 를 mismatch
 *     후보에서 동적으로 뽑아 넘기므로 SCOPE_PAIRS 가 바뀌면 자동으로 따라감.
 *   - renderJurisdictionPopup 의 21개 관할서 버튼(chooseJurisdiction)을 "적용"
 *     (기록된 관할을 폴리곤 판정으로 정정)·"삭제"(사고 기록 자체를 지움) 2버튼
 *     (pickJurisdictionAction)으로 교체 — 후보 자체가 이미 recorded/expected 두
 *     값으로 좁혀져 있으니 그 이상 고를 필요가 없다는 지적(사용자 확정: "적용할지
 *     삭제할지만 선택할 수 있으면 되는거 아니야?").
 *   - 내보내기 형식이 {idx, chosen:관할서명} → {idx, action:'apply'|'delete'} 로
 *     바뀜. apply_jurisdiction_review.js 도 함께 수정 — action='apply'면 후보 목록의
 *     "폴리곤 판정" 값으로 orgCd 정정, action='delete'면 그 hk 행을 통째로 삭제.
 * [부산⇄울산·제주⇄서귀포 검수 결과 반영(2026-08-25)] 사용자가 화면에서 164건 중
 *   162건을 직접 검수해 전부 "적용"으로 내보냈고(2건은 미검토 — 추측 반영 안 함,
 *   accident_jurisdiction_mismatch.json 에 그대로 남아있음), apply_jurisdiction_
 *   review.js 로 accident_ships_hk.json 에 반영했다. 재감사 결과 이 두 쌍의 확실한
 *   불일치는 사실상 해소(제주 3.3%→0.5%·서귀포 2.5%→0.3%·부산 3.3%→0.4%·
 *   울산 0.4%→0.1%), 전체 확실한 불일치는 419건→257건. 이 검수는 2025년 심판원
 *   단독 데이터는 대상이 아니었고(감사 스크립트가 처음부터 제외), 부산⇄울산·
 *   제주⇄서귀포 두 쌍 외 나머지 17개 서 조합(257건)도 아직 미검수 — "전체가
 *   다시 정렬됐다"는 아님(사용자 질문에 답하며 확인).
 * [관할서 검수 완전 재설계 — 워크스루 방식(2026-08-26)] 사용자가 남은 3가지를
 *   지적: ①기존 원본 hk 데이터도 마저 검수해야 ②2021~2024 복원분도 마저 ③2025
 *   심판원 단독은 애초에 "기록값"이 없어 지금 방식(기록 vs 판정)으로는 검증이
 *   안 됨. 이어서 "지금은 마커를 하나하나 지도에서 찾아 클릭해야 해서 불편하다"는
 *   지적으로 검수 흐름 자체를 다시 짰다:
 *   - build_jurisdiction_mismatch_review.js 의 SCOPE_PAIRS(부산⇄울산·제주⇄서귀포
 *     하드코딩)를 없애 전체 19개 조합(257건)을 다 내보내고, 화면에 "검수할 대상"
 *     드롭다운을 둬 코드 수정 없이 아무 조합이나 골라 검수할 수 있게 함.
 *   - build_jurisdiction_2025_review.js 신설 — 2025 단독행은 recorded 가 없어
 *     "기록≠판정" 비교가 안 되므로, classifyOrg 가 그 값을 정한 경로(직접 폴리곤
 *     적중/경계 근접 보정/최근접이웃)를 등급(tier)으로 노출해 저신뢰(신뢰 면
 *     경계 3.3km 이내 포함, 3,840건 중 2,211건)만 검수 대상으로 뽑는다. 이때도
 *     classifyOrg 는 reclassify_after_polygon_fix.js 사본을 그대로 써서 개서일
 *     날짜 게이트(강릉 등)를 그대로 지킨다(사용자 강조: "개소 시점을 고려해야").
 *   - 지도에서 마커를 찾아 클릭하는 방식을 버리고, 드롭다운으로 대상을 고르면
 *     시스템이 후보를 하나씩 자동으로 화면 중앙에 놓고(focusMapOnCandidate,
 *     좌우상하 0.4도 버퍼로 인접 경계가 같이 보이는 줌까지 자동 조정) 위쪽
 *     jurisdiction-walk-panel 에 "확인(그대로 유지)·변경·삭제" 3버튼만 띄운다
 *     (사용자 확정: "확인 그대로 유지, 변경 버튼도 있어야"). 아무 버튼이나 누르면
 *     flaggedItems 에 기록하고 자동으로 다음 미검수 후보로 넘어간다(사용자 확정:
 *     "그 버튼을 누르면 다음으로 자동으로 넘어가는 형식").
 *   - "변경"은 21개 관할서를 다 보여주지 않고, redrawBoundaryForExtent 가 지금
 *     화면에 그린(=인접) 관할서 이름만 작은 버튼으로 띄운다(사용자 확정: "화면에
 *     보이는 서만"). 그래서 대개 2~4개 버튼으로 끝남.
 *   - flaggedItems·검수 패널(선택 목록·내보내기)은 hk/person/tribunal 과 완전히
 *     같은 메커니즘을 그대로 재사용(코드 변경 없음) — jurisdiction 키의 내보내기
 *     형식만 {idx, action:'confirm'|'change'|'delete', to(변경일 때만)} 로 확장.
 *     apply_jurisdiction_review.js 도 세 액션 처리 + 두 후보 목록(mismatch·2025)을
 *     합쳐 idx 드리프트를 검증하도록 다시 씀.
 * [17개 조합 전체 검수 결과 반영(2026-08-26)] 사용자가 새 워크스루 화면에서 257건
 *   중 242건(15건은 미검토로 남김)을 직접 검수해 내보낸 결과를 apply_jurisdiction_
 *   review.js 로 반영 — 231건 변경(그중 3건 삭제), 5건 확인(무변경), 6건은 idx
 *   드리프트로 자동 스킵(추측 반영 안 함, 다음 라운드 후보에 남음). 재감사 결과
 *   "확실한" 불일치 257건 → 30건(대부분 태안⇄평택 조합 미검토분). ⚠행 삭제가
 *   있으면 그 뒤(배열상 나중) 모든 행의 idx 가 밀린다 — 2025 단독행은 배열 맨
 *   끝이라 특히 영향을 받으므로, 삭제가 낀 반영 직후엔 build_jurisdiction_
 *   mismatch_review.js 뿐 아니라 build_jurisdiction_2025_review.js 도 반드시
 *   다시 돌려야 한다(안 그러면 다음 검수 라운드의 idx 가 전부 어긋남 — 실제로
 *   이번에 이 문제를 발견해 즉시 재생성함).
 * [PR 머지 지연 → 화면이 옛 데이터로 검수됨(2026-08-29 발견·수정)] "30건→25건"
 *   반영분(PR #1182)이 사흘 넘게 안 머지된 채였고, 그 사이 사용자가 화면에서
 *   진행한 검수(46건 내보내기)의 idx 상당수가 그 이전(30건) 기준이라 지금 후보
 *   목록엔 아예 없었다 — apply_jurisdiction_review.js 를 고쳐 change·delete 는
 *   idx 가 "지금도" 두 후보 파일 중 하나에 있어야만 실행하게 해 안전하게 걸러냈다
 *   (confirm 은 데이터를 안 건드리므로 그대로 허용). 걸러내는 과정에서 별개 버그도
 *   하나 더 발견 — 후보 파일은 좌표를 소수 5자리로 반올림해 저장하는데 드리프트
 *   비교는 hk 원본의 더 긴 소수와 strict 비교를 해서, 멀쩡한 후보 3건이 반올림
 *   오차 때문에 드리프트로 오판되고 있었다(LATLON_EPS 허용오차 비교로 수정).
 *   PR #1182 는 이 문제를 근본적으로 없애기 위해 곧바로 머지함. 결과: 46건 중
 *   7건만 지금도 유효해 반영(6건 변경 + 1건 삭제), 나머지는 이미 해소됐거나 옛
 *   idx라 안전하게 스킵, "확실한" 불일치 25건 → 18건(대부분 태안⇄평택 잔여).
 * [2025 단독 검수 범위 좁힘(2026-08-29 사용자 확정)] "2025 단독은 폴리곤 판정대로
 *   하되, 인천·속초·동해·강릉만 따로 검증" — orgCd 는 이미 classifyOrg 값이 최종값
 *   이므로(재작업 불필요), build_jurisdiction_2025_review.js 의 검수 대상만 그
 *   4개 관할서로 좁힘(REVIEW_ONLY_ORGS). 저신뢰 2,211건 → 169건.
 * [선박(해경) 좌표 오류 10차 28건 삭제(2026-08-29)] 검수 모드로 사용자가 직접
 *   확인해 내보낸 목록을 원본에서 삭제 — 같은 방식으로 9차까지 이어온 것과 동일.
 *   다만 내보내기의 origIndex 는 화면(main 브랜치 배포본)이 기준이라, 이 세션에서
 *   그 사이 앞서 관할서 검수로 1건을 이미 지운 상태와 어긋났다 — main 브랜치의
 *   accident_ships_hk.json(git show origin/main)을 기준선으로 각 origIndex 의
 *   행 전체를 그대로 대조해 지금 배열에서의 실제 위치로 정확히 매핑한 뒤 삭제(추측
 *   반영 안 함, 28건 전부 완전 일치 확인). 34,962 → 34,934건. 삭제로 인덱스가 또
 *   밀려 build_jurisdiction_mismatch_review.js·build_jurisdiction_2025_review.js
 *   둘 다 재실행.
 * [분석 뷰 — 년/월/일 드릴다운 + 새 분석축 구현(2026-08-29)] 2026-08-25 에 사용자가
 *   "분석 화면 그래프를 꺾은선으로, 년도별→월별→일별로 세분화하고 싶다"고 했다가
 *   "아직 수정하지말고, 같이 고민해보자"로 브레인스토밍만 하고 멈췄던 항목 — 그 뒤
 *   심판원 데이터 통합·관할서 검수로 화제가 넘어가며 그대로 미착수 상태였던 걸
 *   2026-08-29 재확인 요청으로 발견, 이번에 실제 구현.
 *   - 격자 클릭 시 뜨는 통계 바텀시트(#accident-stats-sheet)에 "분석 뷰" 탭 5개를
 *     새로 얹음: 연도별 추이(Chart.js line, 점 클릭 시 연도→월→일로 드릴다운,
 *     #accident-trend-back 으로 한 단계씩 되돌아감) · 시간대별(hk 전용, 0~23시
 *     line, accidentIsDaytimeFromHM 로 주/야간 점 색만 구분) · 요일별(bar) ·
 *     관할서별(가로 bar, 최대 21개 다 보여줌 — 기존 사고발생상세 tabs 의
 *     "상위 6개만" 관례와 달리 자르지 않음) · 특보발효비율(doughnut).
 *   - 기존 CSS 스파크라인(.accident-spark)·주야간 2-바(.accident-daynight)는
 *     이번 시간대별 line 차트가 더 세밀한 상위호환이라 완전히 대체 — 죽은 CSS로
 *     남기지 않고 그 자리에서 삭제(admin_survey.js 의 Chart.js 사용 패턴 그대로
 *     재사용 — new Chart(canvas,...), 다시 그리기 전 반드시 destroy).
 *   - 브레인스토밍 후보 중 "월별 캘린더 히트맵"은 뺐다 — 연도별 추이가 이미 월별·
 *     일별까지 드릴다운되므로 별도 차트 타입(Chart.js 기본 미지원, 플러그인 필요)
 *     을 새로 들이는 비용 대비 얻는 정보가 크지 않다고 판단(더 단순한 방법이
 *     있으면 말한다는 원칙). "인명피해 추이"도 별도 축을 안 만들었다 — person
 *     소스 자체가 인명피해 기록이라 기존 연도별 추이 탭이 person 을 볼 때 이미
 *     그 역할을 한다(hk 격자와 person 격자를 지리적으로 교차 대조하는 건 별개의
 *     큰 작업이라 이번 스코프에서 제외, 필요하면 다음에 별도로).
 *   - "바텀시트 자체 필터 탭" 브레인스토밍은 격자별 데이터를 다시 필터링하는
 *     기능이 아니라, 위 5개 분석 뷰를 전환하는 탭으로 구현(사고발생상세 탭과
 *     같은 .accident-detail-tab 스타일 재사용, accident-view-tab 클래스로만 구분).
 * [관할서 검수 화면에 신설서 개서일 노출(2026-08-31 사용자 확정)] 후보 생성 단계
 *   (build_jurisdiction_*_review.js)는 이미 ESTABLISHED_YMD 로 개서 이전 사고를
 *   걸러내지만, 검수 화면 자체엔 그 표가 없어 "변경" 버튼으로 사람이 직접 개서
 *   이전 서를 골라도 막지 못하는 구멍이 있었다 — 사용자 지적으로 발견. 서버 표와
 *   동일한 JW_ESTABLISHED_YMD 를 클라이언트에도 둬 ①검수 카드에 판정된 서가
 *   신설서면 개서일을 표시 ②"변경" 후보 목록에서 사고 시점에 아직 개서 전인 서는
 *   제외(화면에 경계가 보여도). Playwright 로 2017년 동해⇄속초 건과 2025-01-14
 *   건(둘 다 강릉 개서 2025-03-31 이전) 둘 다 강릉이 후보에서 정확히 빠지는 것 확인.
 * ============================================================================
 */

(function () {
    'use strict';

    var SOURCES = {
        hk: { url: '/accident_ships_hk.json' },
        person: { url: '/accident_persons.json' }
    };

    // px — hazard_rocks.js 는 45(점이 훨씬 적어 그대로 둬도 안 빽빽함). 사고정보는
    // 건수가 많아 45면 화면에 클러스터가 너무 많이 보여(사용자 확정 2026-08-19) 100으로 키움.
    var CLUSTER_DISTANCE = 100;
    var SPREAD_ZOOM = 14;
    var GRID_COLS = 6, GRID_ROWS = 5; // 분석 모드 격자 — 화면 현재 범위를 이 칸수로 나눔
    var ICON_SCALE = 0.2875;    // hazard_rocks.js 와 동일 — 아이콘 원본이 같은 120px 캔버스

    var dataPromises = {};    // key -> Promise<row[]>
    var rawFeatures = {};     // key -> ol.Feature[] (EPSG:3857, 낱개 — 격자 집계용)
    var clusterLayers = {};   // key -> ol.layer.Vector (현황 모드)
    var gridLayer = null;     // 분석 모드 — 소스 전환/모드 전환마다 내용만 갈아끼움
    var gridSource = null;
    var bubbleOverlay = null; // 현황 모드 마커 팝업

    var state = { source: null, mode: 'status' };
    var _activeDetailTab = {};        // source key -> 현재 선택된 "사고발생상세" 탭
    var _statsKey = null;             // 통계 시트에 지금 표시 중인 source key
    var _statsMembers = null;         // 통계 시트에 지금 표시 중인 격자 셀의 feature 목록
    var _statsView = {};              // source key -> 현재 선택된 "분석 뷰" 탭('trend'|'hourly'|'weekday'|'org'|'warn')
    var _trendDrill = null;           // 연도별 추이 드릴다운: null(연도별) | {year} | {year,month}
    var _warnExpanded = false;        // 특보발효 도넛 — "특보 중" 조각을 눌러 유형×심각도로 펼친 상태인지
    var _statsCharts = [];            // 지금 그려진 Chart.js 인스턴스 — 다시 그리기 전 반드시 destroy

    /**
     * [필터 — 사고유형/관할서/시간대/계절/특보발표여부/선박용도/톤수(2026-08-24~25
     * 사용자 확정)] 현황(마커 표출)·분석(격자 집계) 양쪽에 공통으로 적용되는 필터
     * 상태. 각 값이 null 이면 "전체"(필터 없음), Set/Array 가 있으면 그 안에 든
     * 것만 통과.
     *   - types      : Set<typeCode> | null — 사고유형(ACDNT_TYPE_CD)
     *   - orgs       : Set<orgCd>    | null — 관할해경서
     *   - hourRanges : [[startHour,endHour), ...] | null — 시간대(발생시각 hm 기준,
     *                  endHour 는 미포함이라 [0,4)=00~03시대). person 소스는 hm 컬럼이
     *                  없어(발생시각 정보 없음) 이 필터를 통과시킨다(숨기지 않음 —
     *                  판단 불가를 "해당 없음 취급"으로 처리, findCoordOutliers 등
     *                  기존 필터들과 같은 원칙).
     *   - seasons    : Set<'spring'|'summer'|'fall'|'winter'> | null — ymd 월 기준
     *   - warnTypes  : Set<'TY'|'WV'|'GW'> | null — 사고 시각(또는 날)에 발효중이던
     *                  특보종류(build_accident_warn_flags.js 가 미리 계산해 각 행 끝에
     *                  붙여놓은 배열, WARN_FLAGS_POS_IDX 위치). 여러 종류를 동시에 켜면
     *                  OR(그 중 하나라도 발효중이면 통과) — AND 로 하면 해상 사고는
     *                  강풍과 원래 무관해 대부분 사라져버리기 때문.
     *   - shipUses      : Set<string> | null — 선박용도(SHIPUSE_POS_IDX 위치, 심판원
     *                     통합 2026-08-25로 생긴 값). hk 전용, 심판원 매칭 연도(2016·
     *                     2021~2025)에만 값이 있고 그 외 연도(2008~2015·2017~2020)는
     *                     전부 null. 값 없는 행은 **제외**(hourRanges/warnTypes와
     *                     다름 — 그쪽은 "그 소스엔 거의 항상 값이 있는데 극히 일부만
     *                     없음"이라 판단 불가로 통과시켜도 되지만, 선박용도·톤수는
     *                     아예 없는 연도가 통째로 있어 "통과"로 두면 필터를 걸어도
     *                     거의 안 줄어드는 것처럼 보인다 — 사용자 확정 2026-08-25).
     *                     실제 필터를 걸면(전체→선택) window._showOceanToast 로
     *                     "OO 정보는 YYYY년 사고에만 있다"는 안내를 함께 띄운다.
     *   - tonnageRanges : [[minTon,maxTon), ...] | null — 톤수(TONNAGE_POS_IDX 위치).
     *                     hk 전용, shipUses 와 같은 이유로 값 없는 행(null)은 제외.
     */
    var filters = { types: null, orgs: null, hourRanges: null, seasons: null, warnTypes: null, shipUses: null, tonnageRanges: null };

    var SEASON_LABELS = { spring: '봄', summer: '여름', fall: '가을', winter: '겨울' };
    var SEASON_ORDER = ['spring', 'summer', 'fall', 'winter'];

    /** ymd("YYYYMMDD")의 월로 계절 판정. 월 정보가 없으면 null(필터 통과 취급). */
    function seasonOf(ymd) {
        if (!ymd || String(ymd).length < 6) return null;
        var mm = parseInt(String(ymd).slice(4, 6), 10);
        if (mm >= 3 && mm <= 5) return 'spring';
        if (mm >= 6 && mm <= 8) return 'summer';
        if (mm >= 9 && mm <= 11) return 'fall';
        return 'winter'; // 12, 1, 2
    }

    /** hk 전용 — hm("H:MM"~"HH:MM") 문자열의 시(hour). 파싱 실패/없음이면 null. */
    function hourOf(hm) {
        if (!hm) return null;
        var h = parseInt(String(hm).split(':')[0], 10);
        return isNaN(h) ? null : h;
    }

    /** 소스별 관할해경서(orgCd) 컬럼 위치. person 도 hk 와 마찬가지로 이 컬럼이 있다. */
    var ORG_POS_IDX = { hk: 8, person: 5 };

    /** 소스별 "발효중 특보종류" 컬럼 위치(build_accident_warn_flags.js 가 미리 계산해
     * 각 행 끝에 붙여놓은 배열, 예: ["TY","WV"]). 없으면(계산 전 구버전 데이터) 빈 배열
     * 취급. hk 는 태풍·풍랑만 값이 들어있고(강풍은 육상 개념이라 배 사고와 무관),
     * person 은 태풍·풍랑·강풍 셋 다 들어있을 수 있다. */
    var WARN_FLAGS_POS_IDX = { hk: 12, person: 10 };
    var WARN_TYPE_LABELS = { TY: '태풍', WV: '풍랑', GW: '강풍' };
    var WARN_TYPE_ORDER = { hk: ['TY', 'WV'], person: ['TY', 'WV', 'GW'] };

    /** 심각도(주의보/경보) 포함 특보 필드 — build_accident_warn_flags.js 가 2026-08-31
     * 통계 도넛 세분화용으로 새로 추가한 위치(["TY_경보","WV_주의보"] 형태). 위
     * WARN_FLAGS_POS_IDX(유형만, 필터가 씀)와는 별개 필드라 필터 동작에 영향 없음. */
    var WARN_SEVERITY_POS_IDX = { hk: 17, person: 11 };
    var WARN_SEVERITY_ORDER = ['TY_경보', 'TY_주의보', 'WV_경보', 'WV_주의보', 'GW_경보', 'GW_주의보'];
    var WARN_SEVERITY_LABELS = {
        TY_경보: '태풍 경보', TY_주의보: '태풍 주의보',
        WV_경보: '풍랑 경보', WV_주의보: '풍랑 주의보',
        GW_경보: '강풍 경보', GW_주의보: '강풍 주의보'
    };
    var WARN_SEVERITY_COLORS = {
        TY_경보: '#ff5252', TY_주의보: '#ff8a65',
        WV_경보: '#7c4dff', WV_주의보: '#b388ff',
        GW_경보: '#26c6da', GW_주의보: '#80deea'
    };

    /** 선박용도·톤수 컬럼 위치 — hk 전용(심판원 통합 2026-08-25로 생긴 필드, person 엔
     * 없다). person 소스에서 이 두 필터를 걸어도 SHIPUSE_POS_IDX.person/TONNAGE_POS_IDX.person
     * 이 undefined 라 row[undefined] === undefined 로 항상 null 취급되어 자동 통과된다. */
    var SHIPUSE_POS_IDX = { hk: 13 };
    var TONNAGE_POS_IDX = { hk: 14 };

    /**
     * 현재 filters 상태를 기준으로 이 행이 통과하는지 — 현황(마커)·분석(격자) 양쪽이
     * 공유하는 단일 판정 함수. 판단 불가(해당 컬럼이 그 소스에 아예 없음/빈 값)한
     * 축은 막지 않고 통과시킨다.
     * @param {string} key - 'hk' | 'person'
     * @param {Array} row
     * @returns {boolean}
     */
    function passesFilters(key, row) {
        if (filters.types && !filters.types.has(typeFilterCode(typeCodeOf(key, row)))) return false;
        if (filters.orgs) {
            var org = row[ORG_POS_IDX[key]];
            if (!filters.orgs.has(org)) return false;
        }
        if (filters.hourRanges && key === 'hk') {
            var hour = hourOf(row[3]);
            if (hour != null) {
                var inAny = filters.hourRanges.some(function (r) { return hour >= r[0] && hour < r[1]; });
                if (!inAny) return false;
            }
        }
        if (filters.seasons) {
            var season = seasonOf(row[2]);
            if (season && !filters.seasons.has(season)) return false;
        }
        if (filters.warnTypes) {
            var active = row[WARN_FLAGS_POS_IDX[key]] || [];
            // 여러 특보종류를 동시에 켜면 OR(그 중 하나라도 발효중이면 통과) — 사용자 확정
            // 2026-08-24: "강풍+풍랑 둘 다 켰다고 AND로 하면 해상 사고는 강풍과 원래
            // 무관해서 대부분 사라져버린다"
            var anyActive = active.some(function (code) { return filters.warnTypes.has(code); });
            if (!anyActive) return false;
        }
        if (filters.shipUses) {
            // 톤수와 달리 여기는 "판단 불가=통과"가 아니라 "정보 없음=제외"다(사용자
            // 확정 2026-08-25) — hourRanges/warnTypes 처럼 값이 그 소스에 거의 항상
            // 있는 게 아니라, 선박용도·톤수는 심판원 매칭 연도(2016·2021~2025)에만
            // 있고 그 외 연도(2008~2015·2017~2020)엔 아예 없다. "값 없음=통과"로
            // 두면 이 필터를 걸어도 데이터 없는 연도가 전부 같이 남아 필터가 거의
            // 안 먹는 것처럼 보인다(사용자가 스크린샷으로 지적).
            var shipUse = row[SHIPUSE_POS_IDX[key]];
            if (shipUse == null || !filters.shipUses.has(shipUse)) return false;
        }
        if (filters.tonnageRanges) {
            // 위 shipUses 와 같은 이유로 "정보 없음=제외".
            var tonnage = row[TONNAGE_POS_IDX[key]];
            if (tonnage == null) return false;
            var inAnyT = filters.tonnageRanges.some(function (r) { return tonnage >= r[0] && tonnage < r[1]; });
            if (!inAnyT) return false;
        }
        return true;
    }

    /** 필터에 걸려있는 게 하나라도 있는지 — 필터바 버튼 강조 등에 씀. */
    function hasActiveFilters() {
        return !!(filters.types || filters.orgs || filters.hourRanges || filters.seasons || filters.warnTypes ||
            filters.shipUses || filters.tonnageRanges);
    }

    /** passesFilters 를 excludeKey 축만 빼고 판정 — 팝업을 열 때 "다른 축은 이미 걸린
     * 채로 이 축의 옵션별 건수"를 셀 때 씀(사용자 확정 2026-08-25: "관할서 팝업 열 때
     * 옆 숫자는 먼저 고른 사고유형 필터와의 교집합이어야 한다"). filters 를 잠깐
     * 바꿨다 되돌리는 방식 — 동기 단일스레드라 안전. */
    function passesFiltersExcept(key, row, excludeKey) {
        var saved = filters[excludeKey];
        filters[excludeKey] = null;
        var ok = passesFilters(key, row);
        filters[excludeKey] = saved;
        return ok;
    }

    /**
     * [검수 모드 — 사고정보 버튼 10회 연타로만 켜진다(사용자 확정 2026-08-23)]
     * 실제 지도(위성지도)·실제 마커 이미지 위에서 육지에 잘못 찍힌 개별 마커를 직접
     * 클릭으로 골라 제외 후보 목록을 만드는 기능 — 별도 웹페이지 검수 도구는 실제
     * 위성지도 타일을 못 불러와서, 실제 앱 화면 그대로 검수하고 싶다는 요청으로 추가.
     * 처음엔 ?debug=review 쿼리 → 이후 상시 노출(2026-08-20)로 바뀌었다가, 지오코딩
     * 검수화면(accident_geocode_review.js)의 후보 목록이 4회차로 소진되면서 그 화면이
     * 쓰던 "사고정보 버튼 10회 연타" 트리거를 이 검수 모드로 넘겨받았다(트리거 하나를
     * 두 화면이 동시에 쓸 수 없어 이관, 일반 사용자에게 항상 노출되던 것도 함께 해소).
     * 켜지면 패널은 기본 접힌 한 줄(헤더)이라 평소엔 거의 눈에 안 띈다. 낱개 마커를
     * 클릭하면 기존 상세 팝업은 그대로 뜨고, 추가로 빨간 테두리가 켜지며 내보내기
     * 목록에 쌓인다. 다시 클릭하면 빠진다.
     */
    var REVIEW_MODE = false;
    var REVIEW_MODE_TAP_THRESHOLD = 10;
    var REVIEW_MODE_TAP_RESET_MS = 3000;
    var _reviewModeTapCount = 0;
    var _reviewModeTapTimer = null;
    var flaggedItems = new Map(); // "key:origIndex" -> {key, idx, row[, chosen]}
    var flagLayer = null;         // 빨간 테두리 오버레이(소스 무관 공용)

    /**
     * [검수 서브모드 3단 순환(2026-08-25)] 처음엔 심판원 레이어 하나만 검수 모드
     * 진입 후 같은 버튼 5회 더 연타로 토글하는 단순 on/off 였는데, 관할서 불일치
     * 검수 레이어를 그 다음 단계(5회 더, 총 20회)로 추가하면서 "매번 토글"이 아니라
     * "none → 심판원 → 관할서불일치 → none → ..." 순환으로 바꿨다(사용자 확정
     * 2026-08-25: "20회로 하고" + "모드 바뀔때마다 어떤 검수모드인지 화면에 표출").
     * TRIBUNAL_REVIEW_ON·JURISDICTION_REVIEW_ON 은 기존 코드(클릭 라우팅 등)와
     * 호환을 위해 _reviewSubMode 에서 파생시킨 boolean 으로 계속 둔다.
     */
    var REVIEW_SUBMODE_NONE = 0, REVIEW_SUBMODE_TRIBUNAL = 1, REVIEW_SUBMODE_JURISDICTION = 2;
    var REVIEW_SUBMODE_LABELS = ['심판원 검수 꺼짐', '심판원 데이터 검수모드', '관할서 불일치 검수모드'];
    var _reviewSubMode = REVIEW_SUBMODE_NONE;
    var REVIEW_SUBMODE_TAP_THRESHOLD = 5;
    var _reviewSubModeTapCount = 0;
    var _reviewSubModeTapTimer = null;
    var TRIBUNAL_REVIEW_ON = false;
    var tribunalReviewLayer = null;
    var tribunalReviewPromise = null;
    var JURISDICTION_REVIEW_ON = false;
    var jurisdictionBoundaryLayer = null;  // 현재 워크스루 지점 주변 관할 경계선만(동적 필터)
    var jurisdictionFocusLayer = null;     // 지금 보고 있는 후보 1건 강조 마커
    var jurisdictionMismatchPromise = null; // accident_jurisdiction_mismatch.json(①·② 기록≠판정)
    var jurisdiction2025Promise = null;     // accident_jurisdiction_2025_review.json(③ 2025 단독 저신뢰)
    var jurisdictionBoundaryPromise = null; // coastguard_jurisdiction_boundaries.json(21개서 경계 원본)
    // 워크스루 상태 — 서 조합/2025 중 하나를 고르면 그 목록을 순서대로 자동 진행한다
    // (2026-08-26 사용자 확정: "화면에서 조합 선택 드롭다운" + "자동으로 다음 마커로
    // 넘어가는 워크스루" — 더는 지도에서 마커를 직접 찾아 클릭하지 않는다).
    var jwList = [];       // 현재 선택된 데이터셋의 정규화된 후보 배열
    var jwPos = -1;        // jwList 안에서 지금 보고 있는 위치
    var jwChangeOpen = false; // "변경" 눌러서 인접 관할서 목록이 펼쳐진 상태인지

    // ── 데이터 로드 ─────────────────────────────────────────────────────────
    function fetchSource(key) {
        if (!dataPromises[key]) {
            dataPromises[key] = fetch(SOURCES[key].url).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { return data.rows || []; });
        }
        return dataPromises[key];
    }

    /** 소스별 사고유형(ACDNT_TYPE_CD) 컬럼 위치 — popupRowsFor·aggregateCounts 와 동일 인덱스. */
    function typeCodeOf(key, row) {
        if (key === 'hk') return row[5];
        return row[4]; // person
    }

    /** 사고유형 필터 전용 — "좌초/좌주"(ATY041)를 "좌초"(ATY023)로 합쳐서 센다(사용자
     * 확정 2026-08-25). hk 좌주 단독코드(ATY022)는 2013년까지만 쓰이고 이후엔 안 써서
     * 심판원 통합 대상 기간(2016~)엔 사실상 좌초/좌초·좌주 둘뿐이라 하나로 봐도 무방
     * — 마커 아이콘·팝업 상세는 원래 코드 그대로 두고, 필터 옵션·매칭에만 적용한다. */
    function typeFilterCode(code) {
        return code === 'ATY041' ? 'ATY023' : code;
    }

    /**
     * 소스별 "사고발생위치" 텍스트(ACDNT_PSTN) 컬럼 위치 — 좌표 이상치 탐지에 쓴다.
     * hs(선박·심판원)는 이 텍스트 컬럼이 원본 CSV에 아예 없어 탐지 대상에서 뺀다
     * (사고해역코드는 "남해영해"처럼 범위가 넓어 이 방식의 비교 기준으로 못 씀).
     */
    var COORD_OUTLIER_POS_IDX = { hk: 4, person: 3 };

    /** 좌표 이상치 판정 기준 — 같은 위치텍스트 그룹의 중앙값에서 이만큼(도) 벗어나면 원본 데이터
     * 오류로 본다. 0.3도 ≈ 33km(사용자 보고 사례: "하동군 금남면 송문리" 위도가 같은 지명의
     * 다른 건들과 정확히 1도 어긋나 있었음 — build_accidents.js 헤더 주석 및 README 참고). */
    var COORD_OUTLIER_THRESHOLD_DEG = 0.3;

    /** 대한민국 근해를 넉넉히 포괄하는 범위(build_accidents.js 의 육지 마스크 bbox와 동일 감각).
     * 원본 CSV(build_accidents.js 의 isPlausibleLatLon 는 "위경도로서 물리적으로 가능한가"만
     * 검사해 전 세계 어디든 통과시킨다)에 대만·뉴질랜드·경도 0(대서양)처럼 명백히 엉뚱한
     * 좌표가 소수 섞여 있었다(hk 13건·hs 130건, 사용자 재확인 요청 2026-08-20으로 발견 —
     * 클러스터 좌표를 직접 뽑아보다가 남반구·적도 근처 값이 나와 알아챔). */
    var KOREA_BOUNDS = { latMin: 24, latMax: 44, lonMin: 118, lonMax: 144 };
    function isOutOfKoreaBounds(row) {
        return row[0] < KOREA_BOUNDS.latMin || row[0] > KOREA_BOUNDS.latMax ||
            row[1] < KOREA_BOUNDS.lonMin || row[1] > KOREA_BOUNDS.lonMax;
    }

    function median(nums) {
        var sorted = nums.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    /**
     * 같은 "사고발생위치" 텍스트를 가진 행들끼리 좌표를 비교해 이상치를 걸러낸다.
     * 같은 텍스트가 1건뿐이면 비교 대상이 없어 판정하지 않는다(그대로 둔다) — 오탐보다
     * 놓치는 쪽이 안전하다는 판단(사용자 확정 2026-08-20).
     * @param {Array<Array>} rows - 원본 소스의 전체 행
     * @param {number} posIdx - 위치텍스트 컬럼 인덱스
     * @returns {Set<Array>} 이상치로 판정된 행의 집합
     */
    function findCoordOutliers(rows, posIdx) {
        var groups = {};
        rows.forEach(function (row) {
            var pos = row[posIdx];
            if (!pos) return;
            (groups[pos] || (groups[pos] = [])).push(row);
        });
        var outliers = new Set();
        Object.keys(groups).forEach(function (pos) {
            var g = groups[pos];
            if (g.length < 2) return;
            var medLat = median(g.map(function (r) { return r[0]; }));
            var medLon = median(g.map(function (r) { return r[1]; }));
            g.forEach(function (row) {
                if (Math.abs(row[0] - medLat) > COORD_OUTLIER_THRESHOLD_DEG ||
                    Math.abs(row[1] - medLon) > COORD_OUTLIER_THRESHOLD_DEG) {
                    outliers.add(row);
                }
            });
        });
        return outliers;
    }

    /** 위치텍스트가 없는 행 중 완전히 동일한 좌표를 가진 게 이만큼 이상이면 "위치 미상
     * → 관할서 대표좌표로 채움"으로 본다(사용자 보고 2026-08-20: 최대 줌으로 확대해도
     * 안 갈라지는 뭉치가 있음 — 조사 결과 hk 606건이 위치텍스트 완전 공란 + 같은 관할서
     * 좌표에 최대 30건까지 겹쳐 있었다. 실제 사고 위치가 아니라서 지도에서 뺀다). */
    var DUPLICATE_COORD_MIN_COUNT = 3;

    /**
     * 위치텍스트가 없는 행들끼리 좌표로 묶어, 완전히 겹친 뭉치(관할서 대표좌표로 의심)를 찾는다.
     * [중복레코드 분리(2026-08-21)] 실측 결과 135개 뭉침 그룹 중 62개는 날짜·시각·사고유형까지
     * 완전히 같은 "같은 사고의 중복 입력"이었다(예: 화재 사고 1건이 30번 겹쳐 있었음) — 이런
     * 경우는 원래 관할서 대표좌표 문제와 무관하므로 그룹 판정 전에 먼저 1건만 남기고 나머지
     * 중복분만 제외한다(사용자 지적: "같은 좌표라도 사고종류가 다르면 통째로 지우면 안 된다").
     * 중복 제거 후에도 서로 다른 레코드가 임계값 이상 남으면(=날짜·시각·유형이 다 다른데
     * 좌표만 소수점까지 완전 일치 — 실제 GPS로는 사실상 불가능) 그건 여전히 관할서 대표좌표로
     * 본다. person 소스는 시각(hm) 컬럼이 없어 날짜+유형만으로 중복을 판정한다.
     * @param {string} srcKey - 'hk' | 'person'
     * @param {Array<Array>} rows
     * @param {number} posIdx
     * @returns {Set<Array>}
     */
    function findMissingLocationClusters(srcKey, rows, posIdx) {
        var groups = {};
        rows.forEach(function (row) {
            if (row[posIdx]) return; // 위치텍스트가 있으면 대상 아님
            var key = row[0] + ',' + row[1];
            (groups[key] || (groups[key] = [])).push(row);
        });
        var flagged = new Set();
        Object.keys(groups).forEach(function (key) {
            var g = groups[key];
            if (g.length < DUPLICATE_COORD_MIN_COUNT) return;
            var seenDupKeys = new Set();
            var uniqueRows = [];
            g.forEach(function (row) {
                var dupKey = row[2] + '|' + (srcKey === 'hk' ? row[3] : '') + '|' + typeCodeOf(srcKey, row);
                if (seenDupKeys.has(dupKey)) { flagged.add(row); } // 완전 중복분 — 이 건만 제외
                else { seenDupKeys.add(dupKey); uniqueRows.push(row); }
            });
            if (uniqueRows.length >= DUPLICATE_COORD_MIN_COUNT) {
                uniqueRows.forEach(function (row) { flagged.add(row); });
            }
        });
        return flagged;
    }

    /**
     * 원본 데이터베이스의 위도 입력 오타(정확히 ±1도) — 사용자 보고(2026-08-20: "거제도"
     * 관련 사고 여러 건이 위도만 1도 높게 찍혀 대구 부근 내륙에 표출됨)로 발견했다.
     * 시군구 지명 참조표(위치텍스트에 있는 지명의 대략적 중심좌표)와 국립해양조사원
     * 육지 마스크(/api/ocean/land-mask)를 함께 대조해, "원좌표는 육지인데 위도를
     * ±1 하면 그 지명 근처의 바다가 되는" 경우만 이중검증으로 골라냈다(hk 24건·
     * person 10건, 자동 판정을 넓게 걸면 오탐이 섞여 목록으로 못박음). KHOA
     * selectListCluster.json API 좌표와 100% 일치 확인 — 원본 DB 자체의 오타라
     * API를 다시 받아도 그대로다. [원위도, 경도, 보정위도] 형식.
     */
    var LAT_OFFSET_FIXES = {
        hk: [
            [37.06667,128.83333,38.06667],
            [36.8,126.45,35.8],
            [36.98333,126.51389,35.98333],
            [36.84417,126.43222,35.84417],
            [36.93611,126.52972,35.93611],
            [36.99722,126.70556,35.99722],
            [35.29056,126.43333,36.29056],
            [37.9,126.11667,36.9],
            [36.94694,126.43889,35.94694],
            [33.32028,126.8275,34.32028],
            [36.15083,129.28194,35.15083],
            [37.96111,126.83611,36.96111],
            [37.98333,126.76667,36.98333],
            [35.94444,129.06306,34.94444],
            [37.11917,128.64889,38.11917],
            [35.975,128.72389,34.975],
            [34.23639,126.60139,33.23639],
            [37.45056,126.49028,36.45056],
            [34.99806,126.95417,33.99806],
            [36.00639,128.57556,35.00639],
            [35.81306,128.74222,34.81306],
            [35.71694,127.73417,34.71694],
            [37.935,126.85167,36.935],
            [35.97806,128.57694,34.97806]
        ],
        person: [
            [36.31583,126.62,37.31583],
            [35.975,128.58444,34.975],
            [35.89056,128.70444,34.89056],
            [36.66056,126.49583,35.66056],
            [34.14444,125.94472,35.14444],
            [34.14361,125.94528,35.14361],
            [37.12417,128.63306,38.12417],
            [34.99139,126.92111,33.99139],
            [35.825,128.09861,34.825],
            [35.83806,128.43778,34.83806]
        ]
    };

    /** row[0](위도)를 보정 목록과 정확히 일치하면 그 자리에서 고친다(hs는 목록 없어 no-op). */
    function applyLatOffsetFix(key, row) {
        var fixes = LAT_OFFSET_FIXES[key];
        if (!fixes) return;
        for (var i = 0; i < fixes.length; i++) {
            if (fixes[i][0] === row[0] && fixes[i][1] === row[1]) { row[0] = fixes[i][2]; return; }
        }
    }

    /**
     * [정수도 좌표 + 육지판정 필터 — 사용자 재확인 2026-08-20] "강원 산악 내륙에 마커가
     * 여전히 있다"는 재보고로 조사한 결과, 원본 위치가 "OO-00N, OO-00E" 처럼 도(度)
     * 단위로만 기록된 저정밀 좌표(예: [38,128])가 소수 섞여 있었다. 서해안처럼 해안이
     * 완만한 곳에서는 1도 반올림이어도 우연히 바다 근처에 남지만, 강원 동해안처럼 해안선
     * 바로 뒤가 태백산맥인 곳에서는 반올림만으로 산속에 놓인다(실측: 양양군 사고 4건이
     * 정확히 [38,128]로 겹쳐 있었음 — 사용자가 본 "산속 클러스터"로 추정).
     * ocean_overlay.js 가 쓰는 /api/ocean/land-mask 를 이 필터 전용으로 재사용하되,
     * 육지 마스크 자체의 국소 오차 때문에(README 참고) 전체 좌표에 적용하면 해안가
     * 실제 사고(해수욕장·방파제 등)까지 대량 오탐 제외된다(실측: 필터 통과분의 16%가
     * 육지 판정 — 그중 다수가 진짜 해변 사고). 그래서 "정수도 좌표"(전체의 0.1% 미만,
     * 애초에 정밀도가 낮아 보정 불가능한 값)로만 적용 범위를 좁혔다.
     */
    var LAND_MASK_URL = '/api/ocean/land-mask';
    var landMaskPromise = null;
    function ensureLandMask() {
        if (!landMaskPromise) {
            landMaskPromise = fetch(LAND_MASK_URL).then(function (r) { return r.json(); })
                .then(function (data) { return (data && data.success && data.rings) ? data.rings : null; })
                .catch(function () { return null; });
        }
        return landMaskPromise;
    }

    /** ray-casting: (lat,lon)이 육지 마스크 링(들) 안인지. ring = [[lon,lat],...]. */
    function isLandPoint(landRings, lat, lon) {
        if (!landRings) return false;
        var inside = false;
        for (var ri = 0; ri < landRings.length; ri++) {
            var ring = landRings[ri];
            for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
            }
        }
        return inside;
    }

    /** row[0]/row[1] 둘 다 정수도(소수부 없음)면 원본이 도 단위로만 기록된 저정밀 좌표. */
    function isIntegerDegreeCoord(row) {
        return Number.isInteger(row[0]) && Number.isInteger(row[1]);
    }

    /**
     * [개별 좌표 오류 — 위 필터들로 못 잡는 케이스] 정수도도 아니고 ±1 오타도 아닌데
     * 위치텍스트와 좌표가 전혀 다른 지역을 가리키는 개별 오류(사용자 재확인 2026-08-20
     * 강원 산악 내륙 조사 중 발견). 예: "통영시 사량면 돈지리 수우도"(경남 통영, 실제
     * 34.8N대)인데 좌표는 37.9N대(강원권)로 3도 이상 어긋나 있다 — 보정 규칙이 없어
     * ±1 오타처럼 되돌릴 수 없고, 이상치와 달리 같은 텍스트의 비교군도 없다(1건뿐).
     * 정확한 값을 추정할 근거가 없어 위 DUPLICATE/OUTLIER 필터와 같은 원칙(이상치는
     * 지도에서 제외)으로 개별 나열해 뺀다. [원위도, 원경도] 형식.
     */
    var KNOWN_BAD_COORDS = {
        hk: [
            [37.97333, 128.31917], // "강릉시 주문진 동방 21해리 해상" — 동방(동쪽) 표기인데 좌표는 주문진 서쪽 산속
            [38.11667, 128.2]      // "양양군 수산항 동방 25해리 해상" — 위와 동일 유형
        ],
        person: [
            [37.93028, 128.10611], // "통영시 사량면 돈지리 수우도" — 실제는 경남(34.8N대)
            [37.79333, 128.43917]  // "통영시 산양읍 영운리 앞 해상" — 실제는 경남(34.8N대)
        ]
    };
    function isKnownBadCoord(key, row) {
        var bad = KNOWN_BAD_COORDS[key];
        if (!bad) return false;
        for (var i = 0; i < bad.length; i++) {
            if (bad[i][0] === row[0] && bad[i][1] === row[1]) return true;
        }
        return false;
    }

    function rowToFeature(key, row, origIndex) {
        var coord = ol.proj.fromLonLat([row[1], row[0]]); // row=[lat,lon,...]
        var f = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        f.set('row', row);
        f.set('typeCode', typeCodeOf(key, row));
        f.set('origIndex', origIndex); // 검수 모드 내보내기용 — 원본 JSON rows 배열 안의 위치
        return f;
    }

    function ensureRawFeatures(key) {
        if (rawFeatures[key]) return Promise.resolve(rawFeatures[key]);
        return Promise.all([fetchSource(key), ensureLandMask()]).then(function (results) {
            var rows = results[0];
            var landRings = results[1];
            var origIndexOf = new Map();
            rows.forEach(function (row, i) { origIndexOf.set(row, i); });
            rows.forEach(function (row) { applyLatOffsetFix(key, row); });
            var posIdx = COORD_OUTLIER_POS_IDX[key];
            var outliers = posIdx != null ? findCoordOutliers(rows, posIdx) : null;
            var missingLocClusters = posIdx != null ? findMissingLocationClusters(key, rows, posIdx) : null;
            var feats = rows
                .filter(function (row) { return !isOutOfKoreaBounds(row); })
                .filter(function (row) { return !ACCIDENT_TYPE_EXCLUDED[typeCodeOf(key, row)]; })
                .filter(function (row) { return !outliers || !outliers.has(row); })
                .filter(function (row) { return !missingLocClusters || !missingLocClusters.has(row); })
                .filter(function (row) { return !isIntegerDegreeCoord(row) || !isLandPoint(landRings, row[0], row[1]); })
                .filter(function (row) { return !isKnownBadCoord(key, row); })
                .map(function (row) { return rowToFeature(key, row, origIndexOf.get(row)); });
            rawFeatures[key] = feats;
            return feats;
        });
    }

    // ── 현황 모드: 클러스터 레이어 ──────────────────────────────────────────
    // 마커는 사고유형별 이미지 아이콘(ACCIDENT_TYPE_ICONS, hazard_rocks.js 와 같은
    // 120px 캔버스 방식)을 쓰고, 매핑에 없는 코드만 파란 점으로 대체한다.
    var _fallbackStyleCache = null;
    function fallbackStyle() {
        if (!_fallbackStyleCache) {
            _fallbackStyleCache = new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 6,
                    fill: new ol.style.Fill({ color: '#448aff' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
                })
            });
        }
        return _fallbackStyleCache;
    }

    var _iconStyleCache = {};
    function singleStyleFor(typeCode) {
        var src = ACCIDENT_TYPE_ICONS[typeCode];
        if (!src) return fallbackStyle();
        if (!_iconStyleCache[typeCode]) {
            _iconStyleCache[typeCode] = new ol.style.Style({
                image: new ol.style.Icon({ src: src, scale: ICON_SCALE, anchor: [0.5, 0.5] })
            });
        }
        return _iconStyleCache[typeCode];
    }

    /** 클러스터 안에서 가장 많은 사고유형의 코드를 찾는다(동점이면 먼저 나온 쪽). */
    function dominantTypeCode(members) {
        var counts = {}, topCode = null, topCount = 0;
        members.forEach(function (f) {
            var tc = f.get('typeCode');
            var c = (counts[tc] || 0) + 1;
            counts[tc] = c;
            if (c > topCount) { topCount = c; topCode = tc; }
        });
        return topCode;
    }

    var _clusterIconStyleCache = {};
    function clusterIconStyle(typeCode, count) {
        var text = String(count); // 999+ 로 뭉개지 않고 실제 건수를 그대로 보여준다(사용자 확정 2026-08-19)
        var src = ACCIDENT_TYPE_ICONS[typeCode];
        if (src) {
            var cacheKey = typeCode + '|' + text;
            if (!_clusterIconStyleCache[cacheKey]) {
                _clusterIconStyleCache[cacheKey] = new ol.style.Style({
                    image: new ol.style.Icon({ src: src, scale: ICON_SCALE, anchor: [0.5, 0.5] }),
                    text: new ol.style.Text({
                        text: text,
                        font: 'bold 11px sans-serif',
                        fill: new ol.style.Fill({ color: '#fff' }),
                        stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.65)', width: 2.5 }),
                        offsetY: 4
                    })
                });
            }
            return _clusterIconStyleCache[cacheKey];
        }
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: Math.min(11 + Math.log(count) * 3, 26),
                fill: new ol.style.Fill({ color: 'rgba(255,82,82,0.85)' }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 1.5 })
            }),
            text: new ol.style.Text({
                text: text,
                font: 'bold 11px sans-serif',
                fill: new ol.style.Fill({ color: '#fff' })
            })
        });
    }

    function clusterStyleFn(clusterFeature) {
        var members = clusterFeature.get('features');
        if (members.length === 1) return singleStyleFor(members[0].get('typeCode'));
        return clusterIconStyle(dominantTypeCode(members), members.length);
    }

    /**
     * ol.source.Cluster 는 기본적으로 클러스터 위치를 멤버들의 평균 좌표(centroid)로
     * 계산한다. 서해안처럼 해안선이 굴곡진 지역은 흩어진 항구·포구 여러 곳의 평균이
     * 육지(반도) 한가운데로 계산될 수 있다(사용자 보고 2026-08-20: 넓은 뷰에서 큰
     * 숫자 클러스터가 육지에 떠 보임 — 태안 인근 5,545건의 평균좌표로 실측 재현·확인).
     * 대표 위치를 평균 대신 "멤버 중 하나의 실제 좌표"로 바꾸면 클러스터가 항상 실제
     * 사고 지점(바다) 위에 놓인다.
     * @param {ol.geom.Point} point - 기본 계산된 평균 좌표(안 씀)
     * @param {ol.Feature[]} members
     * @returns {ol.Feature}
     */
    function createClusterAtRealPoint(point, members) {
        var geom = members.length ? members[0].getGeometry() : point;
        return new ol.Feature({ geometry: geom, features: members });
    }

    var clusterVectorSources = {}; // key -> ol.source.Vector — 필터 변경 시 features 만 갈아끼우는 용도

    /** hazard_rocks.js buildClusterLayer 와 동일한 줌 기반 뭉치기 조절 패턴. */
    function buildClusterLayer(map, key, features) {
        var innerSource = new ol.source.Vector({ features: features });
        clusterVectorSources[key] = innerSource;
        var clusterSource = new ol.source.Cluster({
            distance: CLUSTER_DISTANCE,
            source: innerSource,
            createCluster: createClusterAtRealPoint
        });
        var applyDistanceForZoom = function () {
            var zoom = map.getView().getZoom();
            var target = (typeof zoom === 'number' && zoom >= SPREAD_ZOOM) ? 0 : CLUSTER_DISTANCE;
            if (clusterSource.getDistance() !== target) clusterSource.setDistance(target);
        };
        map.getView().on('change:resolution', applyDistanceForZoom);
        applyDistanceForZoom();
        var layer = new ol.layer.Vector({ source: clusterSource, style: clusterStyleFn, visible: false, zIndex: 56 });
        map.addLayer(layer);
        return layer;
    }

    function ensureClusterLayer(map, key) {
        if (clusterLayers[key]) return Promise.resolve(clusterLayers[key]);
        return ensureRawFeatures(key).then(function (features) {
            var layer = buildClusterLayer(map, key, features);
            clusterLayers[key] = layer;
            return layer;
        });
    }

    /**
     * filters 상태가 바뀔 때 현황(마커) 쪽에 반영 — 격자(분석) 쪽은 recomputeGrid 가
     * 매번 rawFeatures 에서 다시 계산하므로 별도 갱신 불필요.
     * @param {string} key - 필터를 적용할 소스(보통 state.source)
     * [연계] ← 필터 팝업 확인 버튼
     */
    function applyFiltersToMarkers(key) {
        var innerSource = clusterVectorSources[key];
        if (!innerSource) return;
        var all = rawFeatures[key] || [];
        var filtered = hasActiveFilters()
            ? all.filter(function (f) { return passesFilters(key, f.get('row')); })
            : all;
        innerSource.clear();
        innerSource.addFeatures(filtered);
    }

    // ── 마커 팝업 ───────────────────────────────────────────────────────────
    function ensureBubble(map) {
        if (bubbleOverlay) return bubbleOverlay;
        var el = document.createElement('div');
        el.className = 'accident-popup';
        // stopEvent:false 라 pointerdown 이 지도까지 그대로 버블링돼, 관할서 검수 팝업의
        // 버튼(renderJurisdictionPopup)을 누르면 그 클릭이 지도 singleclick 으로도 잡혀
        // 팝업이 다시 그려지기 직전에 사라지는 문제가 있었다 — pointerdown 단계에서
        // 먼저 막아 버튼의 click 리스너까지는 정상 도달하게 한다.
        el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        bubbleOverlay = new ol.Overlay({ element: el, positioning: 'bottom-center', offset: [0, -8], stopEvent: false });
        map.addOverlay(bubbleOverlay);
        return bubbleOverlay;
    }

    function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
    function formatYmd(ymd) {
        if (!ymd || ymd.length !== 8) return ymd || '-';
        return ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
    }
    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * 소스별 마커 팝업에 보여줄 [라벨, 값] 목록.
     * [연계] accident_codes.js 의 ACCIDENT_*_LABELS · accidentLabel()
     */
    function popupRowsFor(key, row) {
        if (key === 'hk') {
            var rows = [
                ['사고발생일', formatYmd(row[2]) + (row[3] ? ' ' + row[3] : '')],
                ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[5])],
                ['위치', row[4] || '-'],
                ['관할', accidentLabel(ACCIDENT_ORG_LABELS, row[8])]
            ];
            // 심판원 매칭/단독 행에만 있는 정보(2026-08-25) — 없으면(null) 아예 안 보여줌.
            if (row[13] != null) rows.push(['선박용도', row[13]]);
            if (row[14] != null) rows.push(['톤수', row[14] + '톤']);
            if (row[15] != null) rows.push(['계절', row[15]]);
            return rows;
        }
        if (key === 'tribunal') {
            // row=[lat,lon,ymd,hm,typeCd,caseNo,merged] — build_tribunal_review.js 참고.
            var tribRows = [
                ['사고발생일', formatYmd(row[2]) + (row[3] ? ' ' + row[3] : '')],
                ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[4])],
                ['사건번호', row[5] || '-'],
                ['해경 병합 여부', row[6] ? '병합됨(hk에 있음)' : '병합 안 됨(단독 심판원)']
            ];
            // 병합된 행이면 해경(hk) 쪽 데이터도 같이 보여준다(사용자 확정 2026-08-25:
            // "병합이 되어 있으면 해경에서 표출하는 데이터도 함께 표출해 종합 판단하도록"
            // — 심판원 정보만으론 판단이 안 된다는 지적). hkRowByCaseNo 는
            // ensureTribunalReviewLayer 가 레이어를 켤 때 미리 채워둔다.
            var hkRow = row[6] && hkRowByCaseNo ? hkRowByCaseNo.get(row[5]) : null;
            if (hkRow) {
                var distKm = haversineKm(row[0], row[1], hkRow[0], hkRow[1]);
                tribRows.push(
                    ['해경 사고발생일', formatYmd(hkRow[2]) + (hkRow[3] ? ' ' + hkRow[3] : '')],
                    ['해경 사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, hkRow[5])],
                    ['해경 위치텍스트', hkRow[4] || '-'],
                    ['해경 관할', accidentLabel(ACCIDENT_ORG_LABELS, hkRow[8])],
                    ['심판원-해경 좌표 차이', distKm < 0.01 ? '거의 동일' : distKm.toFixed(2) + 'km']
                );
            }
            return tribRows;
        }
        // person
        return [
            ['사고발생일', formatYmd(row[2])],
            ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[4])],
            ['위치', row[3] || '-'],
            ['사상자', '구조 ' + row[7] + ' · 사망 ' + row[8] + ' · 실종 ' + row[9]]
        ];
    }

    function renderPopup(map, key, feature) {
        var bubble = ensureBubble(map);
        var rows = popupRowsFor(key, feature.get('row'));
        bubble.getElement().innerHTML = rows.map(function (r) {
            return '<div class="row"><span>' + r[0] + '</span><span>' + escapeHtml(r[1]) + '</span></div>';
        }).join('');
        bubble.setPosition(feature.getGeometry().getCoordinates());
    }

    /** 검수 모드 목록에 보여줄 한 줄 요약(popupRowsFor 와 같은 컬럼을 재사용).
     * jurisdiction 키는 datasetKind(item, 있으면)에 따라 row 스키마가 달라(①·②는
     * recorded/expected, ③2025는 currentOrg/tier) 셋째 인자로 item 을 받는다. */
    function reviewLabelFor(key, row, item) {
        if (key === 'hk') return formatYmd(row[2]) + ' · ' + (row[4] || accidentLabel(ACCIDENT_TYPE_LABELS, row[5]));
        if (key === 'tribunal') return formatYmd(row[2]) + ' · ' + accidentLabel(ACCIDENT_TYPE_LABELS, row[4]) + (row[6] ? ' (병합됨)' : '');
        if (key === 'jurisdiction') {
            if (item && item.datasetKind === 'y2025') {
                return formatYmd(row[2]) + ' · 2025단독 ' + row[5].replace('해양경찰서', '') + '(' + row[6] + ')';
            }
            return formatYmd(row[2]) + ' · 기록 ' + row[5].replace('해양경찰서', '') +
                ' → 판정 ' + row[6].replace('해양경찰서', '');
        }
        return formatYmd(row[2]) + ' · ' + (row[3] || accidentLabel(ACCIDENT_TYPE_LABELS, row[4]));
    }

    /** 검수 모드 패널을 처음 한 번만 만든다(사고정보 버튼 10회 연타로 REVIEW_MODE 가 켜질 때 호출). */
    function ensureReviewPanel() {
        if (document.getElementById('accident-review-panel')) return;
        var style = document.createElement('style');
        style.textContent =
            // 우측 세로 버튼 레일(출입통제·낚시금지 등)·하단 탭바와 안 겹치게 하단 중앙에 띄운다.
            // 기본은 한 줄(헤더)만 보이는 접힌 상태 — 목록·버튼은 헤더를 눌러야 펼쳐진다
            // (사용자 보고 2026-08-20: 목록이 펼쳐진 채로 고정돼 있어 지도 화면을 거의 다 가림).
            '#accident-review-panel{position:fixed;left:12px;right:12px;max-width:360px;margin:0 auto;' +
            'bottom:78px;background:rgba(20,26,32,0.94);color:#fff;font-size:12px;border-radius:10px;' +
            'z-index:900;box-shadow:0 4px 16px rgba(0,0,0,0.4);font-family:sans-serif;overflow:hidden;}' +
            '#accident-review-panel .arp-hdr{display:flex;align-items:center;gap:6px;font-weight:700;' +
            'padding:10px;cursor:pointer;user-select:none;}' +
            '#accident-review-panel .arp-hdr b{color:#ff5f74;}' +
            '#accident-review-panel .arp-hdr .arp-chevron{margin-left:auto;color:#aaa;font-size:11px;}' +
            '#accident-review-panel .arp-body{display:none;flex-direction:column;gap:8px;padding:0 10px 10px;}' +
            '#accident-review-panel.expanded .arp-body{display:flex;}' +
            '#accident-review-panel .arp-list{max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;}' +
            '#accident-review-panel .arp-item{display:flex;gap:6px;align-items:flex-start;background:rgba(255,255,255,0.06);' +
            'border-radius:6px;padding:5px 7px;}' +
            '#accident-review-panel .arp-item span{flex:1;line-height:1.4;word-break:break-word;}' +
            '#accident-review-panel .arp-item button{flex:none;background:none;border:none;color:#aaa;cursor:pointer;font-size:13px;}' +
            '#accident-review-panel .arp-actions{display:flex;gap:6px;}' +
            '#accident-review-panel .arp-actions button{flex:1;padding:6px;border-radius:6px;border:1px solid #555;' +
            'background:#2a333a;color:#fff;font-size:12px;cursor:pointer;}' +
            '#accident-review-panel .arp-actions button.primary{background:#ff5f74;border-color:#ff5f74;font-weight:700;}' +
            '#accident-review-panel textarea{width:100%;height:90px;font-size:11px;border-radius:6px;border:1px solid #555;' +
            'background:#11161a;color:#fff;padding:6px;box-sizing:border-box;}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'accident-review-panel';
        panel.innerHTML =
            '<div class="arp-hdr" id="accident-review-toggle">검수 모드 — 선택 <b id="accident-review-count">0</b>건' +
            '<span class="arp-chevron" id="accident-review-chevron">펼치기 ▾</span></div>' +
            '<div class="arp-body">' +
            '<div class="arp-list" id="accident-review-list"></div>' +
            '<div class="arp-actions">' +
            '<button type="button" id="accident-review-clear">전체 해제</button>' +
            '<button type="button" id="accident-review-export" class="primary">내보내기</button>' +
            '</div>' +
            '<textarea id="accident-review-export-text" readonly style="display:none;"></textarea>' +
            '</div>';
        document.body.appendChild(panel);

        document.getElementById('accident-review-toggle').addEventListener('click', function () {
            panel.classList.toggle('expanded');
            var expanded = panel.classList.contains('expanded');
            document.getElementById('accident-review-chevron').textContent = expanded ? '접기 ▴' : '펼치기 ▾';
        });
        document.getElementById('accident-review-clear').addEventListener('click', function () {
            flaggedItems.clear();
            var map = window.getOceanMap && window.getOceanMap();
            if (map) rebuildFlagLayer(map);
            renderReviewPanel();
        });
        document.getElementById('accident-review-export').addEventListener('click', function () {
            var out = {};
            flaggedItems.forEach(function (item) {
                if (!out[item.key]) out[item.key] = [];
                // jurisdiction 은 단순 삭제 후보가 아니라 "확인(유지)·변경·삭제" 액션이
                // 필요해서 idx 만으론 부족 — apply_jurisdiction_review.js 가 읽는 형식에
                // 맞춰 {idx, action, to} 로 담는다(action='change' 일 때만 to 가 있음).
                if (item.key === 'jurisdiction') {
                    out[item.key].push({ idx: item.idx, action: item.action || null, to: item.to || null });
                } else {
                    out[item.key].push(item.idx);
                }
            });
            var ta = document.getElementById('accident-review-export-text');
            ta.value = JSON.stringify(out);
            ta.style.display = 'block';
            ta.focus();
            ta.select();
        });
        renderReviewPanel();
    }

    function renderReviewPanel() {
        var countEl = document.getElementById('accident-review-count');
        var listEl = document.getElementById('accident-review-list');
        if (!countEl || !listEl) return;
        countEl.textContent = flaggedItems.size;
        listEl.innerHTML = '';
        flaggedItems.forEach(function (item, flagKey) {
            var row = document.createElement('div');
            row.className = 'arp-item';
            var label = document.createElement('span');
            var actionLabel = item.action === 'confirm' ? '확인'
                : item.action === 'change' ? '변경→' + (item.to || '').replace('해양경찰서', '')
                    : item.action === 'delete' ? '삭제' : '';
            label.textContent = '[' + item.key + '] ' + reviewLabelFor(item.key, item.row, item) +
                (actionLabel ? ' — ' + actionLabel : '');
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.textContent = '✕';
            rm.addEventListener('click', function () {
                flaggedItems.delete(flagKey);
                var map = window.getOceanMap && window.getOceanMap();
                if (map) rebuildFlagLayer(map);
                renderReviewPanel();
            });
            row.appendChild(label);
            row.appendChild(rm);
            listEl.appendChild(row);
        });
        var ta = document.getElementById('accident-review-export-text');
        if (ta) ta.style.display = 'none'; // 목록이 바뀌면 다시 눌러야 최신 상태로 채워짐
    }

    // ── 검수 모드(사고정보 켜면 항상 함께 뜸) — 낱개 마커를 클릭하면 상세 팝업은 그대로 뜨고,
    // 추가로 빨간 테두리를 켜서 내보내기 목록에 쌓는다. ───────────────────────
    function ensureFlagLayer(map) {
        if (flagLayer) return flagLayer;
        var source = new ol.source.Vector();
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 16,
                stroke: new ol.style.Stroke({ color: '#ff2d55', width: 3 }),
                fill: new ol.style.Fill({ color: 'rgba(255,45,85,0.15)' })
            })
        });
        flagLayer = new ol.layer.Vector({ source: source, style: style, zIndex: 58 });
        map.addLayer(flagLayer);
        return flagLayer;
    }

    function rebuildFlagLayer(map) {
        var layer = ensureFlagLayer(map);
        var source = layer.getSource();
        source.clear();
        flaggedItems.forEach(function (item) {
            source.addFeature(new ol.Feature({ geometry: new ol.geom.Point(item.coord) }));
        });
    }

    /** 심판원 검수용 좌표 JSON 을 한 번만 fetch 한다. */
    function fetchTribunalReview() {
        if (!tribunalReviewPromise) {
            tribunalReviewPromise = fetch('/accident_tribunal_review.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { return data.rows || []; });
        }
        return tribunalReviewPromise;
    }

    var hkRowByCaseNo = null; // 사건번호(caseNo) -> hk row — 심판원 검수 팝업의 "병합됨" 비교용
    /** 사건번호로 hk row 를 찾기 위한 맵을 한 번만 만든다(hk 소스를 아직 안 골랐어도
     * fetchSource('hk') 는 dataPromises 캐시를 공유해 중복 fetch 없음). */
    function ensureHkRowByCaseNo() {
        if (hkRowByCaseNo) return Promise.resolve(hkRowByCaseNo);
        return fetchSource('hk').then(function (rows) {
            hkRowByCaseNo = new Map();
            rows.forEach(function (r) { if (r[16]) hkRowByCaseNo.set(r[16], r); });
            return hkRowByCaseNo;
        });
    }

    /** 두 좌표 사이 거리(km) — build_tribunal_merge.js 의 haversineKm 과 같은 공식. */
    function haversineKm(lat1, lon1, lat2, lon2) {
        var R = 6371.0;
        var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
        var dphi = (lat2 - lat1) * Math.PI / 180;
        var dl = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    /** hk/person 과 똑같은 줌 기반 클러스터링(buildClusterLayer) 재사용(사용자 확정
     * 2026-08-25: "동일하게 맞춰 달라") — 낱개 점만 찍던 이전 구현은 줌과 무관하게
     * 전부 다 보여 실제 서비스 마커와 다르게 보였다. build_tribunal_review.js 가
     * 이제 사고유형(typeCd)도 담아주므로(초판엔 좌표만 있었다 — 아래 항목 참고)
     * 클러스터 대표 이미지·낱개 아이콘까지 hk/person 과 완전히 동일하게 뜬다.
     * feature 에 'row'(popupRowsFor/toggleFlag 용)·'typeCode'(클러스터 대표 이미지
     * 계산용)·'origIndex'(검수 선택 식별용, hk/person 의 rowToFeature 와 같은 패턴)
     * 를 얹는다. zIndex 만 검수용 레이어(flagLayer=58) 위에 오도록 59로 따로 얹는다
     * (buildClusterLayer 기본값 56은 hk/person 레이어와 같은 층). */
    function ensureTribunalReviewLayer(map) {
        if (tribunalReviewLayer) return Promise.resolve(tribunalReviewLayer);
        // hk 데이터도 함께 미리 받아둔다 — "병합됨" 팝업에서 해경 쪽 데이터를 바로
        // 보여주려면 클릭 시점엔 이미 준비돼 있어야 한다(2026-08-25 사용자 확정:
        // "병합이 되어 있으면 해경에서 표출하는 데이터도 함께 표출해 종합 판단하도록").
        return Promise.all([fetchTribunalReview(), ensureHkRowByCaseNo()]).then(function (results) {
            var rows = results[0];
            var features = rows.map(function (row, i) {
                var f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([row[1], row[0]])) });
                f.set('row', row);
                f.set('typeCode', row[4]);
                f.set('origIndex', i);
                return f;
            });
            tribunalReviewLayer = buildClusterLayer(map, 'tribunal', features);
            tribunalReviewLayer.setZIndex(59);
            return tribunalReviewLayer;
        });
    }

    // 관할서 경계선 색상 — 문자열 해시로 고정 배정(재로드해도 서마다 항상 같은 색).
    var JURISDICTION_COLORS = [
        '#e6194b', '#3cb44b', '#ffcc00', '#4363d8', '#f58231', '#b366ff', '#42d4d4',
        '#f032e6', '#9acd32', '#ff8fa3', '#00b3b3', '#c48eff', '#c19a6b', '#ffe680',
        '#ff6666', '#7fffb0', '#a3a300', '#ffb366', '#6699ff', '#bfbfbf', '#66ffcc'
    ];
    function colorForOwner(owner) {
        var h = 0;
        for (var i = 0; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) >>> 0;
        return JURISDICTION_COLORS[h % JURISDICTION_COLORS.length];
    }

    /** 신설 관할서 개서일(YYYYMMDD) — build_jurisdiction_mismatch_review.js·
     * build_jurisdiction_2025_review.js 의 ESTABLISHED_YMD 와 동일한 표(서버가 이미
     * 이 날짜로 후보 생성 단계에서 개서 이전 사고를 걸러내지만, 검수 화면 자체는 이
     * 표가 없어 "변경" 버튼으로 개서 전 서를 골라도 막지 못했다 — 2026-08-31 사용자
     * 지적으로 발견해 추가: ①검수 카드에 개서일 표시 ②"변경" 후보 목록에서 사고
     * 시점에 아직 없던 서는 제외). */
    var JW_ESTABLISHED_YMD = {
        평택해양경찰서: '20110401', 창원해양경찰서: '20121227', 보령해양경찰서: '20140401',
        부안해양경찰서: '20160421', 울진해양경찰서: '20171128', 사천해양경찰서: '20220331',
        강릉해양경찰서: '20250331'
    };

    /** ①·② 관할서 불일치 후보(build_jurisdiction_mismatch_review.js 산출, 기록≠판정)를
     * 한 번만 fetch 한다. row=[lat,lon,ymd,hm,typeCd,recorded,expected,distKm,hkIdx]. */
    function fetchJurisdictionMismatch() {
        if (!jurisdictionMismatchPromise) {
            jurisdictionMismatchPromise = fetch('/accident_jurisdiction_mismatch.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { return data.rows || []; });
        }
        return jurisdictionMismatchPromise;
    }

    /** ③ 2025 심판원 단독 저신뢰 후보(build_jurisdiction_2025_review.js 산출)를 한 번만
     * fetch. row=[lat,lon,ymd,hm,typeCd,currentOrg,tier,distKm,hkIdx]. */
    function fetchJurisdiction2025Review() {
        if (!jurisdiction2025Promise) {
            jurisdiction2025Promise = fetch('/accident_jurisdiction_2025_review.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }).then(function (data) { return data.rows || []; });
        }
        return jurisdiction2025Promise;
    }

    /** 관할서 경계 폴리곤 JSON(build_jurisdiction_boundaries.js 산출, 21개서 원본)을
     * 한 번만 fetch — 실제 화면에 그릴 때는 이 중 지금 보고 있는 후보 주변 것만
     * focusMapOnCandidate 가 매번 걸러서 그린다. */
    function fetchJurisdictionBoundaries() {
        if (!jurisdictionBoundaryPromise) {
            jurisdictionBoundaryPromise = fetch('/coastguard_jurisdiction_boundaries.json').then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            });
        }
        return jurisdictionBoundaryPromise;
    }

    function ensureJurisdictionBoundaryLayer(map) {
        if (jurisdictionBoundaryLayer) return jurisdictionBoundaryLayer;
        jurisdictionBoundaryLayer = new ol.layer.Vector({ source: new ol.source.Vector(), visible: false, zIndex: 57 });
        map.addLayer(jurisdictionBoundaryLayer);
        return jurisdictionBoundaryLayer;
    }

    /** 지금 보는 후보 1건을 강조하는 전용 레이어(빨간 테두리 flagLayer 와는 별개 —
     * flagLayer 는 "이미 결정한 것", 이건 "지금 보고 있는 것"). */
    function ensureJurisdictionFocusLayer(map) {
        if (jurisdictionFocusLayer) return jurisdictionFocusLayer;
        var style = new ol.style.Style({
            image: new ol.style.Circle({
                radius: 12,
                stroke: new ol.style.Stroke({ color: '#0aff9d', width: 3 }),
                fill: new ol.style.Fill({ color: 'rgba(10,255,157,0.25)' })
            })
        });
        jurisdictionFocusLayer = new ol.layer.Vector({ source: new ol.source.Vector(), style: style, visible: false, zIndex: 61 });
        map.addLayer(jurisdictionFocusLayer);
        return jurisdictionFocusLayer;
    }

    /** 순수 bbox 겹침만 보면 인천처럼 해안선을 따라가는 커다란(그러나 가느다란)
     * 면이 전혀 안 지나가는 먼 지역까지 "겹친다"고 잘못 판정된다(실측 확인 —
     * 울진 근처인데 "변경" 후보에 인천이 뜸, 인천 면 bbox 가 lon 119~135 로
     * 한반도 전체를 덮을 만큼 큼). 꼭짓점이 범위 안에 있거나, 범위의 네 꼭짓점
     * 중 하나가 폴리곤 안에 있으면 실제로 겹친다고 본다(변이 딱 관통만 하고
     * 꼭짓점도 코너도 안 걸리는 극단적인 경우는 놓칠 수 있으나, 버퍼가 작고
     * 폴리곤이 굵은 편이라 실무적으로 충분).
     */
    function pointInPolygonLL(lon, lat, coords) {
        var inside = false;
        for (var i = 0, j = coords.length - 1; i < coords.length; j = i++) {
            var xi = coords[i][0], yi = coords[i][1], xj = coords[j][0], yj = coords[j][1];
            var intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
    function polygonIntersectsExtent(coords, lonMin, latMin, lonMax, latMax) {
        for (var i = 0; i < coords.length; i++) {
            var c = coords[i];
            if (c[0] >= lonMin && c[0] <= lonMax && c[1] >= latMin && c[1] <= latMax) return true;
        }
        var corners = [[lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax]];
        for (var k = 0; k < corners.length; k++) {
            if (pointInPolygonLL(corners[k][0], corners[k][1], coords)) return true;
        }
        return false;
    }

    /**
     * 관할서 경계선을 lonMin/latMin~lonMax/latMax 범위와 겹치는 것만 색칠해서 다시
     * 그린다(21개 전체를 늘 그리면 "전국이 다 나온다"는 지적이 재발하므로, 지금
     * 보는 후보 주변만). 같은 서가 여러 조각이면 이 범위 안에서 좌표가 가장 많은
     * 조각에만 이름 라벨을 단다.
     * @returns {string[]} 이번에 그려진(=화면에 보이는) 관할서 이름 목록 — "변경" 버튼의
     *   후보 목록으로도 그대로 쓴다(사용자 확정 2026-08-26: "화면에 보이는 서들만").
     */
    function redrawBoundaryForExtent(map, lonMin, latMin, lonMax, latMax) {
        return fetchJurisdictionBoundaries().then(function (allFaces) {
            var faces = allFaces.filter(function (f) {
                return polygonIntersectsExtent(f.coords, lonMin, latMin, lonMax, latMax);
            });
            var labelFaceByOwner = {};
            faces.forEach(function (f) {
                var cur = labelFaceByOwner[f.owner];
                if (!cur || f.coords.length > cur.coords.length) labelFaceByOwner[f.owner] = f;
            });
            var layer = ensureJurisdictionBoundaryLayer(map);
            var source = layer.getSource();
            source.clear();
            faces.forEach(function (f) {
                var ring = f.coords.map(function (c) { return ol.proj.fromLonLat(c); });
                var feature = new ol.Feature({ geometry: new ol.geom.Polygon([ring]) });
                var color = colorForOwner(f.owner);
                var styleOpts = { stroke: new ol.style.Stroke({ color: color, width: 2 }) };
                if (labelFaceByOwner[f.owner] === f) {
                    styleOpts.text = new ol.style.Text({
                        text: f.owner.replace('해양경찰서', ''),
                        font: 'bold 11px sans-serif',
                        fill: new ol.style.Fill({ color: '#fff' }),
                        stroke: new ol.style.Stroke({ color: '#000', width: 3 })
                    });
                }
                feature.setStyle(new ol.style.Style(styleOpts));
                source.addFeature(feature);
            });
            layer.setVisible(true);
            return Object.keys(labelFaceByOwner);
        });
    }

    /**
     * 검수 서브모드를 지도에 반영 — TRIBUNAL_REVIEW_ON·JURISDICTION_REVIEW_ON 을
     * _reviewSubMode 에서 다시 계산하고, 심판원 레이어 표시 여부를 맞춘 뒤 지금 어떤
     * 검수모드인지 토스트로 알려준다(사용자 확정 2026-08-25: "모드 바뀔때마다
     * 어떤거 검수모드인지 알려줄 수 있도록 화면에 잠깐 표출"). 관할서 불일치 쪽은
     * 레이어 on/off 가 아니라 ensureJurisdictionWalkPanel 로 진입/이탈을 처리한다
     * (워크스루 방식이라 "데이터셋을 고르기 전엔 아무것도 안 뜬다"가 자연스러움).
     */
    function applyReviewSubMode(map) {
        TRIBUNAL_REVIEW_ON = (_reviewSubMode === REVIEW_SUBMODE_TRIBUNAL);
        JURISDICTION_REVIEW_ON = (_reviewSubMode === REVIEW_SUBMODE_JURISDICTION);
        ensureTribunalReviewLayer(map).then(function (layer) { layer.setVisible(TRIBUNAL_REVIEW_ON); });
        var panel = document.getElementById('jurisdiction-walk-panel');
        if (JURISDICTION_REVIEW_ON) {
            ensureJurisdictionWalkPanel(map);
        } else {
            if (panel) panel.style.display = 'none';
            if (jurisdictionBoundaryLayer) jurisdictionBoundaryLayer.setVisible(false);
            if (jurisdictionFocusLayer) jurisdictionFocusLayer.setVisible(false);
        }
        if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(REVIEW_SUBMODE_LABELS[_reviewSubMode], 'top', 2200);
        }
    }

    /** 낱개 마커 클릭 시 상세 팝업과 별개로 빨간 테두리 선택을 토글한다(검수 모드 전용). */
    function toggleFlag(map, key, feature) {
        if (!REVIEW_MODE) return;
        var idx = feature.get('origIndex');
        if (idx == null) return;
        var flagKey = key + ':' + idx;
        if (flaggedItems.has(flagKey)) {
            flaggedItems.delete(flagKey);
        } else {
            flaggedItems.set(flagKey, { key: key, idx: idx, row: feature.get('row'), coord: feature.getGeometry().getCoordinates() });
        }
        rebuildFlagLayer(map);
        renderReviewPanel();
    }

    // ── 관할서 검수 워크스루(2026-08-26 재설계) ──────────────────────────────
    // 처음엔 마커를 지도에서 직접 찾아 클릭하는 방식이었는데, 사용자 지적으로
    // 완전히 바꿨다: ①"서 조합 선택" 드롭다운(①·② 기록≠판정 불일치, 부산⇄울산
    // 두 쌍만 코드에 박아뒀던 걸 화면에서 아무 조합이나 고르게) + ②2025 심판원
    // 단독 저신뢰 후보까지 같은 화면에서, ③시스템이 후보를 하나씩 자동으로 지도
    // 중앙에 띄우고 인접 경계가 보이는 줌으로 맞춘 뒤 "확인/변경/삭제" 3버튼만
    // 누르면 자동으로 다음 후보로 넘어가는 워크스루(사용자 확정: "자동으로 그
    // 다음 마커로 넘어가는... 마커는 화면 중앙에 위치하되 주변 경계 구역들이 잘
    // 보일 수 있는 줌 레벨로"). "변경"은 21개 전체가 아니라 지금 화면에 경계선이
    // 보이는 서만 고르게 한다(사용자 확정: "확인/변경/삭제 두 버튼만 있어도 되냐"
    // → "변경도 필요, 화면에 보이는 서만").

    /** mismatch.json 행 → 워크스루 공통 후보 객체. */
    function normalizeMismatchRow(row) {
        return {
            idx: row[8], lat: row[0], lon: row[1], ymd: row[2], hm: row[3], typeCd: row[4],
            kind: 'pair', recorded: row[5], expected: row[6], currentOrg: row[5], tier: null, distKm: row[7]
        };
    }
    /** 2025_review.json 행 → 워크스루 공통 후보 객체. */
    function normalize2025Row(row) {
        return {
            idx: row[8], lat: row[0], lon: row[1], ymd: row[2], hm: row[3], typeCd: row[4],
            kind: 'y2025', recorded: null, expected: null, currentOrg: row[5], tier: row[6], distKm: row[7]
        };
    }

    /** 워크스루 패널을 처음 한 번만 만들고, 데이터셋 선택 드롭다운을 채운다. */
    function ensureJurisdictionWalkPanel(map) {
        var existing = document.getElementById('jurisdiction-walk-panel');
        if (existing) { existing.style.display = ''; return Promise.resolve(existing); }

        var style = document.createElement('style');
        style.textContent =
            '#jurisdiction-walk-panel{position:fixed;left:12px;right:12px;max-width:360px;margin:0 auto;' +
            'top:calc(env(safe-area-inset-top,0px) + 64px);background:rgba(20,26,32,0.96);color:#fff;' +
            'font-size:12px;border-radius:10px;z-index:910;box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
            'font-family:sans-serif;padding:10px;box-sizing:border-box;}' +
            '#jurisdiction-walk-panel select{width:100%;padding:6px;border-radius:6px;border:1px solid #555;' +
            'background:#11161a;color:#fff;font-size:12px;box-sizing:border-box;}' +
            '#jurisdiction-walk-panel .jwp-progress{margin-top:8px;color:#aaa;font-size:11px;}' +
            '#jurisdiction-walk-panel .jwp-info{margin-top:4px;display:flex;flex-direction:column;gap:2px;}' +
            '#jurisdiction-walk-panel .jwp-info .row{display:flex;justify-content:space-between;gap:8px;}' +
            '#jurisdiction-walk-panel .jwp-info .row span:first-child{color:#aaa;flex:none;}' +
            '#jurisdiction-walk-panel .jwp-info .row span:last-child{text-align:right;}' +
            '#jurisdiction-walk-panel .jwp-done-msg{color:#8fd;padding:6px 0;}' +
            '#jurisdiction-walk-panel .jwp-actions{display:flex;gap:6px;margin-top:8px;}' +
            '#jurisdiction-walk-panel .jwp-btn{flex:1;padding:8px;border-radius:6px;border:1px solid #555;' +
            'background:#2a333a;color:#fff;font-size:12px;cursor:pointer;}' +
            '#jurisdiction-walk-panel .jwp-btn.jwp-confirm{border-color:#30d158;color:#30d158;}' +
            '#jurisdiction-walk-panel .jwp-btn.jwp-delete{border-color:#ff453a;color:#ff453a;}' +
            '#jurisdiction-walk-panel .jwp-change-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}' +
            '#jurisdiction-walk-panel .jwp-owner-btn{padding:6px 10px;border-radius:6px;border:1px solid #555;' +
            'background:#11161a;color:#fff;font-size:12px;cursor:pointer;}' +
            '#jurisdiction-walk-panel .jwp-no-owner{color:#aaa;font-size:11px;}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'jurisdiction-walk-panel';
        panel.innerHTML =
            '<select id="jwp-select"><option value="">검수할 대상 선택…</option></select>' +
            '<div class="jwp-progress" id="jwp-progress"></div>' +
            '<div class="jwp-info" id="jwp-info"></div>' +
            '<div class="jwp-actions" id="jwp-actions" style="display:none">' +
            '<button type="button" class="jwp-btn jwp-confirm" data-act="confirm">확인</button>' +
            '<button type="button" class="jwp-btn jwp-change" data-act="change">변경</button>' +
            '<button type="button" class="jwp-btn jwp-delete" data-act="delete">삭제</button>' +
            '</div>' +
            '<div class="jwp-change-list" id="jwp-change-list" style="display:none"></div>';
        document.body.appendChild(panel);

        document.getElementById('jwp-select').addEventListener('change', function (e) {
            startJurisdictionWalk(map, e.target.value);
        });
        document.getElementById('jwp-actions').addEventListener('click', function (e) {
            var btn = e.target.closest('.jwp-btn');
            if (!btn) return;
            handleJwAction(map, btn.dataset.act);
        });
        document.getElementById('jwp-change-list').addEventListener('click', function (e) {
            var btn = e.target.closest('.jwp-owner-btn');
            if (!btn) return;
            commitJwDecision(map, jwList[jwPos], 'change', btn.dataset.org);
        });

        return Promise.all([fetchJurisdictionMismatch(), fetchJurisdiction2025Review()]).then(function (results) {
            var mismatchRows = results[0], y2025Rows = results[1];
            var pairCounts = {};
            mismatchRows.forEach(function (r) {
                var key = [r[5], r[6]].sort().join('|');
                pairCounts[key] = (pairCounts[key] || 0) + 1;
            });
            var select = document.getElementById('jwp-select');
            Object.keys(pairCounts).sort(function (a, b) { return pairCounts[b] - pairCounts[a]; }).forEach(function (key) {
                var names = key.split('|').map(function (n) { return n.replace('해양경찰서', ''); });
                var opt = document.createElement('option');
                opt.value = 'pair:' + key;
                opt.textContent = names.join('⇄') + ' — 기록≠판정 (' + pairCounts[key] + '건)';
                select.appendChild(opt);
            });
            var opt2025 = document.createElement('option');
            opt2025.value = 'y2025';
            opt2025.textContent = '2025 심판원 단독 저신뢰 (' + y2025Rows.length + '건)';
            select.appendChild(opt2025);
            return panel;
        });
    }

    /** 드롭다운에서 데이터셋을 고르면 그 목록을 만들고 첫 미검수 후보로 진입. */
    function startJurisdictionWalk(map, datasetKey) {
        if (!datasetKey) { jwList = []; jwPos = -1; renderJwIdle(); return; }
        var listPromise;
        if (datasetKey === 'y2025') {
            listPromise = fetchJurisdiction2025Review().then(function (rows) { return rows.map(normalize2025Row); });
        } else {
            var pairNames = datasetKey.slice('pair:'.length).split('|');
            listPromise = fetchJurisdictionMismatch().then(function (rows) {
                return rows.filter(function (r) {
                    return (r[5] === pairNames[0] && r[6] === pairNames[1]) || (r[5] === pairNames[1] && r[6] === pairNames[0]);
                }).map(normalizeMismatchRow);
            });
        }
        listPromise.then(function (list) {
            jwList = list;
            jwPos = -1;
            advanceJurisdictionWalk(map);
        });
    }

    /** 이미 결정한(flaggedItems 에 있는) 건은 건너뛰고 다음 미검수 후보로. 다 봤으면 완료 표시. */
    function advanceJurisdictionWalk(map) {
        jwChangeOpen = false;
        do { jwPos++; } while (jwPos < jwList.length && flaggedItems.has('jurisdiction:' + jwList[jwPos].idx));
        if (jwPos >= jwList.length) { renderJwDone(); return; }
        focusMapOnCandidate(map, jwList[jwPos]);
    }

    /** 후보를 화면 중앙에 두고 인접 경계가 보이는 줌으로 맞춘 뒤(사용자 확정 —
     * "마커는 화면 중앙에 위치하되 주변 경계 구역이 잘 보이는 줌 레벨로 자동 조정"),
     * 그 범위 안 경계선만 다시 그리고 카드를 채운다. */
    function focusMapOnCandidate(map, cand) {
        var buf = 0.4; // 도 단위 — 인접 1~3개 서 경계가 대개 같이 보이는 정도(실측 확인)
        var lonMin = cand.lon - buf, lonMax = cand.lon + buf, latMin = cand.lat - buf, latMax = cand.lat + buf;
        var extent3857 = ol.proj.transformExtent([lonMin, latMin, lonMax, latMax], 'EPSG:4326', 'EPSG:3857');
        map.getView().fit(extent3857, { duration: 300, maxZoom: 10 });

        var focusLayer = ensureJurisdictionFocusLayer(map);
        focusLayer.getSource().clear();
        focusLayer.getSource().addFeature(new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([cand.lon, cand.lat])) }));
        focusLayer.setVisible(true);

        redrawBoundaryForExtent(map, lonMin, latMin, lonMax, latMax).then(function (visibleOwners) {
            cand._visibleOwners = visibleOwners;
            renderJwCard(cand);
        });
    }

    function renderJwCard(cand) {
        document.getElementById('jwp-progress').textContent = (jwPos + 1) + ' / ' + jwList.length;
        var rows = [
            ['사고발생일', formatYmd(cand.ymd) + (cand.hm ? ' ' + cand.hm : '')],
            ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, cand.typeCd)]
        ];
        if (cand.kind === 'pair') {
            rows.push(['기록된 관할', cand.recorded]);
            rows.push(['폴리곤 판정', cand.expected + ' (경계에서 ' + cand.distKm + 'km)']);
        } else {
            var tierLabel = cand.tier === 'direct' ? '신뢰 면 안(경계 근처)'
                : cand.tier === 'boundary' ? '신뢰 면 밖 — 가장 가까운 경계로 보정'
                    : '최근접이웃(kNN) 추정 — 가장 불확실';
            rows.push(['현재 관할(추정)', cand.currentOrg]);
            rows.push(['추정 근거', tierLabel + (cand.distKm >= 0 ? ' · 경계에서 ' + cand.distKm + 'km' : '')]);
        }
        // 신설서(개서일 있는 서)면 사고 시점과 나란히 보여준다 — 사용자 확정
        // 2026-08-31: "검수 페이지에 개서 시점도 나와야". 판정된 서에만 표시.
        var judgedOrg = cand.kind === 'pair' ? cand.expected : cand.currentOrg;
        var estYmd = JW_ESTABLISHED_YMD[judgedOrg];
        if (estYmd) rows.push([judgedOrg.replace('해양경찰서', '') + ' 개서일', formatYmd(estYmd)]);
        document.getElementById('jwp-info').innerHTML = rows.map(function (r) {
            return '<div class="row"><span>' + r[0] + '</span><span>' + escapeHtml(r[1]) + '</span></div>';
        }).join('');
        document.getElementById('jwp-actions').style.display = 'flex';
        var changeList = document.getElementById('jwp-change-list');
        changeList.style.display = 'none';
        changeList.innerHTML = '';
    }

    function renderJwIdle() {
        document.getElementById('jwp-progress').textContent = '';
        document.getElementById('jwp-info').innerHTML = '';
        document.getElementById('jwp-actions').style.display = 'none';
        document.getElementById('jwp-change-list').style.display = 'none';
        if (jurisdictionBoundaryLayer) jurisdictionBoundaryLayer.setVisible(false);
        if (jurisdictionFocusLayer) jurisdictionFocusLayer.setVisible(false);
    }

    function renderJwDone() {
        document.getElementById('jwp-progress').textContent = '검수 끝';
        document.getElementById('jwp-info').innerHTML = '<div class="jwp-done-msg">이 목록은 다 확인했습니다 — 위 드롭다운에서 다른 조합을 선택하세요.</div>';
        document.getElementById('jwp-actions').style.display = 'none';
        document.getElementById('jwp-change-list').style.display = 'none';
    }

    /** 확인/변경/삭제 버튼 처리 — "변경"은 바로 결정하지 않고 화면에 보이는 인접
     * 서 목록을 펼친다(그중 하나를 눌러야 commitJwDecision 이 실제로 호출됨). */
    function handleJwAction(map, act) {
        var cand = jwList[jwPos];
        if (!cand) return;
        if (act === 'change') {
            var listEl = document.getElementById('jwp-change-list');
            jwChangeOpen = !jwChangeOpen;
            if (!jwChangeOpen) { listEl.style.display = 'none'; return; }
            // 화면에 보이는 서라도 사고 시점에 아직 개서 전이면 고를 수 없는 값이라
            // 후보에서 뺀다(사용자 확정 2026-08-31 — "개서 시점을 고려해야").
            var owners = (cand._visibleOwners || []).filter(function (o) {
                if (o === cand.currentOrg) return false;
                var est = JW_ESTABLISHED_YMD[o];
                return !est || est <= cand.ymd;
            });
            listEl.innerHTML = owners.length
                ? owners.map(function (o) {
                    return '<button type="button" class="jwp-owner-btn" data-org="' + escapeHtml(o) + '">' +
                        escapeHtml(o.replace('해양경찰서', '')) + '</button>';
                }).join('')
                : '<span class="jwp-no-owner">화면에 다른 관할서 경계가 안 보입니다 — 지도를 줌아웃해 확인하세요.</span>';
            listEl.style.display = 'flex';
            return;
        }
        commitJwDecision(map, cand, act);
    }

    /** 결정을 flaggedItems 에 저장(기존 hk/person/tribunal 과 같은 맵, 검수 패널
     * 목록·내보내기가 그대로 재사용됨) 하고 자동으로 다음 후보로 넘어간다. */
    function commitJwDecision(map, cand, action, toOrg) {
        var row = cand.kind === 'pair'
            ? [cand.lat, cand.lon, cand.ymd, cand.hm, cand.typeCd, cand.recorded, cand.expected, cand.distKm, cand.idx]
            : [cand.lat, cand.lon, cand.ymd, cand.hm, cand.typeCd, cand.currentOrg, cand.tier, cand.distKm, cand.idx];
        flaggedItems.set('jurisdiction:' + cand.idx, {
            key: 'jurisdiction', idx: cand.idx, row: row, action: action, to: toOrg || null,
            datasetKind: cand.kind, coord: ol.proj.fromLonLat([cand.lon, cand.lat])
        });
        rebuildFlagLayer(map);
        renderReviewPanel();
        advanceJurisdictionWalk(map);
    }

    /**
     * 클러스터 클릭 처리 — hazard_rocks.js tryHandleLayerClick 과 같은 방식.
     * 멤버 2개 이상이면 그 범위로 확대(더 갈라지도록), 낱개면 상세 팝업(검수 모드면
     * 팝업과 함께 빨간 테두리 선택도 토글 — 어떤 사고인지 보면서 골라야 하기 때문).
     */
    function tryHandleClusterClick(map, evt, key, layer) {
        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === layer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === layer; } });
        if (!hit) return false;

        var members = hit.get('features');
        if (members.length > 1) {
            var view = map.getView();
            var extent = ol.extent.createEmpty();
            members.forEach(function (f) { ol.extent.extend(extent, f.getGeometry().getExtent()); });
            var atMaxZoom = view.getZoom() >= view.getMaxZoom() - 0.05;
            if (!atMaxZoom) {
                view.fit(extent, { padding: [60, 60, 60, 60], maxZoom: view.getMaxZoom(), duration: 300 });
            } else {
                renderPopup(map, key, members[0]); // 최대 줌에서도 안 갈라짐 — 대표 1건만
                toggleFlag(map, key, members[0]);
            }
            return true;
        }
        renderPopup(map, key, members[0]);
        toggleFlag(map, key, members[0]);
        return true;
    }

    // ── 분석 모드: 격자 히트맵 ──────────────────────────────────────────────
    function lerpColor(t) {
        var a = [255, 215, 64], b = [255, 82, 82]; // 노랑(낮음) → 빨강(높음)
        var r = Math.round(a[0] + (b[0] - a[0]) * t);
        var g = Math.round(a[1] + (b[1] - a[1]) * t);
        var bl = Math.round(a[2] + (b[2] - a[2]) * t);
        return 'rgba(' + r + ',' + g + ',' + bl + ',0.82)';
    }

    function gridCellStyle(feature) {
        var count = feature.get('count');
        var maxCount = feature.get('_maxInView') || 1;
        var t = Math.min(count / maxCount, 1);
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: lerpColor(t) }),
            stroke: new ol.style.Stroke({ color: 'rgba(255,255,255,0.35)', width: 1 }),
            text: new ol.style.Text({
                text: String(count),
                font: 'bold 12px "Roboto Mono", monospace',
                fill: new ol.style.Fill({ color: t > 0.5 ? '#2a0000' : '#241a00' })
            })
        });
    }

    function ensureGridLayer(map) {
        if (gridLayer) return gridLayer;
        gridSource = new ol.source.Vector();
        gridLayer = new ol.layer.Vector({ source: gridSource, style: gridCellStyle, visible: false, zIndex: 57 });
        map.addLayer(gridLayer);
        return gridLayer;
    }

    /**
     * 현재 지도 화면(extent)을 GRID_COLS×GRID_ROWS 칸으로 나눠 활성 소스의
     * 포인트를 세어 격자 폴리곤 feature 로 다시 그린다. 줌/이동(moveend)마다
     * 다시 호출되므로 격자 크기가 화면 범위에 맞춰 자동으로 재계산된다.
     * @param {ol.Map} map
     */
    function recomputeGrid(map) {
        if (!gridSource || !state.source) return;
        var feats = rawFeatures[state.source] || [];
        if (hasActiveFilters()) {
            var key = state.source;
            feats = feats.filter(function (f) { return passesFilters(key, f.get('row')); });
        }
        var extent = map.getView().calculateExtent(map.getSize());
        var w = (extent[2] - extent[0]) / GRID_COLS;
        var h = (extent[3] - extent[1]) / GRID_ROWS;
        if (!(w > 0) || !(h > 0)) return;

        var buckets = {}; // "col,row" -> ol.Feature[]
        feats.forEach(function (f) {
            var c = f.getGeometry().getCoordinates();
            if (c[0] < extent[0] || c[0] > extent[2] || c[1] < extent[1] || c[1] > extent[3]) return;
            var col = Math.min(Math.floor((c[0] - extent[0]) / w), GRID_COLS - 1);
            var row = Math.min(Math.floor((c[1] - extent[1]) / h), GRID_ROWS - 1);
            var k = col + ',' + row;
            (buckets[k] || (buckets[k] = [])).push(f);
        });

        gridSource.clear();
        var maxCount = 0;
        Object.keys(buckets).forEach(function (k) { if (buckets[k].length > maxCount) maxCount = buckets[k].length; });
        Object.keys(buckets).forEach(function (k) {
            var parts = k.split(',');
            var col = parseInt(parts[0], 10), row = parseInt(parts[1], 10);
            var x0 = extent[0] + col * w, x1 = x0 + w;
            var y0 = extent[1] + row * h, y1 = y0 + h;
            var cellFeature = new ol.Feature({
                geometry: new ol.geom.Polygon([[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]])
            });
            cellFeature.set('count', buckets[k].length);
            cellFeature.set('members', buckets[k]);
            cellFeature.set('_maxInView', maxCount);
            gridSource.addFeature(cellFeature);
        });
        closeStatsSheet(); // 격자가 다시 그려졌으니 이전 선택은 무효
    }

    // ── 통계 바텀시트 ───────────────────────────────────────────────────────
    function yearOf(row) {
        var raw = row[2]; // OCRN_YMD(문자열)
        return (raw && String(raw).length >= 4) ? parseInt(String(raw).slice(0, 4), 10) : null;
    }
    function monthOf(row) {
        var raw = String(row[2] || '');
        return raw.length >= 6 ? parseInt(raw.slice(4, 6), 10) : null;
    }
    function dayOfMonthOf(row) {
        var raw = String(row[2] || '');
        return raw.length >= 8 ? parseInt(raw.slice(6, 8), 10) : null;
    }

    var WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
    /** row[2](ymd)를 요일로 — Date.getDay()는 0=일이라 0=월로 회전. 형식이 이상하면 null. */
    function weekdayOf(row) {
        var raw = String(row[2] || '');
        if (raw.length !== 8) return null;
        var d = new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
        return isNaN(d.getTime()) ? null : (d.getDay() + 6) % 7;
    }

    /** hk 의 OCRN_HM("6:05" 형식)에서 시(0~23)만 뽑는다. person 은 이 컬럼이 없어 null. */
    function hourOf(row) {
        var hm = row[3];
        if (hm == null) return null;
        var h = parseInt(String(hm).split(':')[0], 10);
        return isNaN(h) ? null : h;
    }

    /**
     * "연도별 사고현황" 드릴다운 차트 데이터(2026-08-29 — 예전에 "년도별 월별
     * 일별로 그래프가 세분화되도록" 요청했던 부분을 이번에 반영). drill 이 없으면
     * 연도별, {year} 면 그 해의 월별, {year,month} 면 그 달의 일별로 좁혀 집계.
     * [연계] renderActiveChart 의 line 차트 onClick 이 drill 을 한 단계씩 넣는다.
     */
    function trendBuckets(members, drill) {
        var counts = {};
        members.forEach(function (f) {
            var row = f.get('row');
            var y = yearOf(row);
            if (!y) return;
            if (!drill) { counts[y] = (counts[y] || 0) + 1; return; }
            if (y !== drill.year) return;
            if (!drill.month) {
                var m = monthOf(row);
                if (m) counts[m] = (counts[m] || 0) + 1;
                return;
            }
            if (monthOf(row) !== drill.month) return;
            var d = dayOfMonthOf(row);
            if (d) counts[d] = (counts[d] || 0) + 1;
        });
        var keys = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
        var unit = !drill ? '년' : (!drill.month ? '월' : '일');
        return {
            labels: keys.map(function (k) { return k + unit; }),
            values: keys.map(function (k) { return counts[k]; }),
            keys: keys
        };
    }

    /** 시간대별(0~23시) 사고건수 — hk 전용(person 은 발생시각 컬럼이 없음). */
    function hourlyBuckets(members) {
        var counts = new Array(24).fill(0);
        members.forEach(function (f) {
            var h = hourOf(f.get('row'));
            if (h != null) counts[h]++;
        });
        return counts;
    }

    /** 월별(1~12월) 사고건수 — 연도 구분 없이 전체 기간 합산(2026-08-31 사용자 확정:
     * "월별은 연도 선택 없이 전체기간 합산"). 연도별 드릴다운으로 들어가는 "연도별" 탭과
     * 역할이 겹치지 않도록 최상위 탭에서 별도로 구성. */
    function monthlyBuckets(members) {
        var counts = new Array(12).fill(0);
        members.forEach(function (f) {
            var m = monthOf(f.get('row'));
            if (m) counts[m - 1]++;
        });
        return counts;
    }

    /** 요일별(월~일) 사고건수. */
    function weekdayBuckets(members) {
        var counts = new Array(7).fill(0);
        members.forEach(function (f) {
            var w = weekdayOf(f.get('row'));
            if (w != null) counts[w]++;
        });
        return counts;
    }

    /** 특보(태풍·풍랑·강풍 등) 발효 중이었던 사고 비율 — 기존 특보발표여부 필터와
     * 같은 WARN_FLAGS_POS_IDX 플래그를 재사용(2026-08-24 필터 신설분). */
    function warnBuckets(key, members) {
        var active = 0, inactive = 0;
        members.forEach(function (f) {
            var flags = f.get('row')[WARN_FLAGS_POS_IDX[key]] || [];
            if (flags.length) active++; else inactive++;
        });
        return { active: active, inactive: inactive };
    }

    /** "특보 중" 조각을 유형×심각도(태풍/풍랑/강풍 × 주의보/경보)로 쪼갠 값 — 0건짜리
     * 조합은 목록에서 뺀다(2026-08-31 사용자 확정). 한 사고가 두 유형 이상(예: 태풍+풍랑)
     * 동시 발효 중이면 두 조각에 같이 잡혀 합계가 warnBuckets().active 보다 클 수 있다. */
    function warnSeverityBuckets(key, members) {
        var counts = {};
        members.forEach(function (f) {
            var sev = f.get('row')[WARN_SEVERITY_POS_IDX[key]] || [];
            sev.forEach(function (code) { counts[code] = (counts[code] || 0) + 1; });
        });
        return WARN_SEVERITY_ORDER.filter(function (c) { return counts[c] > 0; }).map(function (c) {
            return { code: c, label: WARN_SEVERITY_LABELS[c], count: counts[c], color: WARN_SEVERITY_COLORS[c] };
        });
    }

    /** 소스별 "분석 뷰" 탭 구성 — hourly 는 hk 에만(person 은 발생시각 없음).
     * "월별"은 2026-08-31 사용자 확정으로 드릴다운 없이 최상위 탭으로 추가. */
    function statsViewsFor(key) {
        var views = [
            { id: 'trend', label: '연도별' },
            { id: 'month', label: '월별' },
            { id: 'weekday', label: '요일별' },
            { id: 'org', label: '관할서별' },
            { id: 'warn', label: '특보발효' }
        ];
        if (key === 'hk') views.splice(2, 0, { id: 'hourly', label: '시간대별' });
        return views;
    }

    /** "사고발생상세" 탭 구성 — 소스마다 실제 CSV 에 있는 컬럼만큼만 보여준다. */
    function detailTabsFor(key) {
        if (key === 'hk') return ['발생유형', '발생원인', '선박종류'];
        return ['사고유형'];
    }

    /** members 를 getter(row)→labelTable 라벨로 묶어 [라벨,건수] 목록(건수 내림차순)으로. */
    function countByLabel(members, getter, labelTable) {
        var counts = {};
        members.forEach(function (f) {
            var label = accidentLabel(labelTable, getter(f.get('row')));
            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.keys(counts).map(function (label) { return [label, counts[label]]; })
            .sort(function (a, b) { return b[1] - a[1]; });
    }

    function aggregateCounts(members, getter, labelTable) {
        return countByLabel(members, getter, labelTable).slice(0, 6); // 상위 6개만
    }

    /** "관할서별" 분석 뷰 — 상위 6개로 자르지 않고 전부 보여준다(최대 21개 관할서). */
    function orgBuckets(key, members) {
        return countByLabel(members, function (r) { return r[ORG_POS_IDX[key]]; }, ACCIDENT_ORG_LABELS);
    }

    function detailDataFor(key, tab, members) {
        if (key === 'hk') {
            if (tab === '발생유형') return aggregateCounts(members, function (r) { return r[5]; }, ACCIDENT_TYPE_LABELS);
            if (tab === '발생원인') return aggregateCounts(members, function (r) { return r[6]; }, ACCIDENT_CAUSE_LABELS);
            return aggregateCounts(members, function (r) { return r[7]; }, ACCIDENT_SHIP_KIND_LABELS);
        }
        return aggregateCounts(members, function (r) { return r[4]; }, ACCIDENT_TYPE_LABELS);
    }

    /**
     * "분석 뷰" 탭(연도별 추이·시간대별·요일별·관할서별·특보발효) HTML —
     * 실제 Chart.js 인스턴스는 body.innerHTML 반영 후 renderActiveChart()가 그린다
     * (canvas 는 DOM에 붙어 있어야 Chart.js가 그릴 수 있음).
     */
    function buildChartViewHtml(key) {
        var views = statsViewsFor(key);
        if (!_statsView[key] || !views.some(function (v) { return v.id === _statsView[key]; })) _statsView[key] = 'trend';
        var activeView = _statsView[key];
        var viewTabsHtml = views.map(function (v) {
            return '<button class="accident-detail-tab accident-view-tab' + (v.id === activeView ? ' active' : '') +
                '" data-view="' + v.id + '">' + v.label + '</button>';
        }).join('');

        var backHtml = '';
        if (activeView === 'trend' && _trendDrill) {
            var crumb = _trendDrill.year + '년' + (_trendDrill.month ? ' ' + _trendDrill.month + '월' : '');
            backHtml = '<button class="accident-trend-back" id="accident-trend-back">◀ ' + crumb + ' — 전체로</button>';
        }

        return '<div class="accident-stats-block">' +
            '<div class="accident-stats-label">분석 뷰</div>' +
            '<div class="accident-detail-tabs">' + viewTabsHtml + '</div>' +
            backHtml +
            '<div class="accident-chart-wrap" id="accident-chart-wrap"><canvas id="accident-stats-chart"></canvas></div>' +
            '<div class="accident-chart-caption" id="accident-chart-caption"></div>' +
            '</div>';
    }

    function buildStatsHtml(key, members) {
        var tabs = detailTabsFor(key);
        if (!_activeDetailTab[key] || tabs.indexOf(_activeDetailTab[key]) === -1) _activeDetailTab[key] = tabs[0];
        var activeTab = _activeDetailTab[key];
        var detailItems = detailDataFor(key, activeTab, members);
        var maxDetail = Math.max.apply(null, detailItems.map(function (d) { return d[1]; }).concat([1]));
        // 게이지에 채움 비율(%)이 눈에 보이게(2026-08-31 사용자 확정) — 전체 건수 대비 비율.
        var barsHtml = detailItems.map(function (d) {
            var pct = members.length ? Math.round(d[1] / members.length * 100) : 0;
            return '<div class="accident-bar-row"><span class="name">' + escapeHtml(d[0]) + '</span>' +
                '<span class="track"><span class="fill" style="width:' + Math.round(d[1] / maxDetail * 100) + '%"></span></span>' +
                '<span class="n">' + d[1] + '건 · ' + pct + '%</span></div>';
        }).join('');
        var tabsHtml = tabs.map(function (t) {
            return '<button class="accident-detail-tab' + (t === activeTab ? ' active' : '') + '" data-tab="' + t + '">' + t + '</button>';
        }).join('');

        return '<h3>그리드형 사고분석 <span class="cellcount">' + members.length + '건</span></h3>' +
            buildChartViewHtml(key) +
            '<div class="accident-stats-block"><div class="accident-stats-label">사고발생상세</div>' +
            '<div class="accident-detail-tabs">' + tabsHtml + '</div>' + barsHtml + '</div>';
    }

    /** 지금 그려진 Chart.js 인스턴스를 전부 정리 — 다시 그리기 전/시트 닫을 때 필수
     * (안 하면 같은 canvas id 재사용 시 이전 차트가 겹쳐 그려지거나 누수됨). */
    function destroyStatsCharts() {
        _statsCharts.forEach(function (c) { c.destroy(); });
        _statsCharts = [];
    }

    var CHART_COLOR = { blue: '#448aff', yellow: '#ffd740', green: '#69f0ae', red: '#ff5252' };
    var CHART_AXIS_OPTS = {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#64748b', precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } }
    };
    // 차트에 값을 항상(호버 없이) 보여달라는 요청(2026-08-31 사용자 확정) — 이미 로드돼
    // 있던 chartjs-plugin-datalabels 를 등록. 기본은 꺼두고(다른 화면에 이 Chart.js를
    // 재사용할 일이 없어 안전하지만 명시적으로), 값 표시가 필요한 차트에서만 개별로 켠다.
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined' && !Chart.registry.plugins.get('datalabels')) {
        Chart.register(ChartDataLabels);
        Chart.defaults.set('plugins.datalabels', { display: false });
    }
    var DATALABEL_COLOR = '#e2e8f0';

    /** 지금 선택된 "분석 뷰" 탭에 맞는 Chart.js 차트 하나를 그린다(그 전에 이전 걸 destroy). */
    function renderActiveChart(key, members) {
        destroyStatsCharts();
        var canvas = document.getElementById('accident-stats-chart');
        var wrap = document.getElementById('accident-chart-wrap');
        var caption = document.getElementById('accident-chart-caption');
        if (!canvas || !wrap) return;
        var view = _statsView[key] || 'trend';
        if (caption) caption.textContent = '';
        wrap.style.height = '200px';

        if (view === 'trend') {
            var t = trendBuckets(members, _trendDrill);
            if (!t.labels.length && caption) caption.textContent = '표시할 데이터가 없습니다.';
            _statsCharts.push(new Chart(canvas, {
                type: 'line',
                data: { labels: t.labels, datasets: [{
                    data: t.values, borderColor: CHART_COLOR.blue, backgroundColor: 'rgba(68,138,255,0.18)',
                    fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: CHART_COLOR.blue,
                    datalabels: { display: true, color: DATALABEL_COLOR, anchor: 'end', align: 'top', font: { size: 9, weight: 600 } }
                }] },
                options: {
                    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    scales: CHART_AXIS_OPTS,
                    onClick: function (evt, elements) {
                        if (!elements.length) return;
                        var k = t.keys[elements[0].index];
                        if (!_trendDrill) _trendDrill = { year: k };
                        else if (!_trendDrill.month) _trendDrill = { year: _trendDrill.year, month: k };
                        else return; // 일별까지 가면 더 드릴다운 없음
                        renderStatsBody();
                    }
                }
            }));
            return;
        }

        if (view === 'month') {
            var mo = monthlyBuckets(members);
            _statsCharts.push(new Chart(canvas, {
                type: 'line',
                data: { labels: mo.map(function (_, i) { return (i + 1) + '월'; }), datasets: [{
                    data: mo, borderColor: CHART_COLOR.blue, backgroundColor: 'rgba(68,138,255,0.18)',
                    fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: CHART_COLOR.blue,
                    datalabels: { display: true, color: DATALABEL_COLOR, anchor: 'end', align: 'top', font: { size: 9, weight: 600 } }
                }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: CHART_AXIS_OPTS }
            }));
            return;
        }

        if (view === 'hourly') {
            var hours = hourlyBuckets(members);
            var pointColors = hours.map(function (_, h) {
                return accidentIsDaytimeFromHM(h + ':00') ? CHART_COLOR.yellow : CHART_COLOR.blue;
            });
            var totalDay = 0, totalNight = 0;
            hours.forEach(function (n, h) { if (accidentIsDaytimeFromHM(h + ':00')) totalDay += n; else totalNight += n; });
            if (caption) caption.textContent = '주간(' + ACCIDENT_DAY_START_HOUR + '~' + ACCIDENT_DAY_END_HOUR + '시) ' + totalDay + '건 · 야간 ' + totalNight + '건';
            _statsCharts.push(new Chart(canvas, {
                type: 'line',
                data: { labels: hours.map(function (_, h) { return h + '시'; }), datasets: [{
                    data: hours, borderColor: CHART_COLOR.blue, backgroundColor: 'rgba(68,138,255,0.12)',
                    fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: pointColors,
                    datalabels: { display: true, color: DATALABEL_COLOR, anchor: 'end', align: 'top', font: { size: 8, weight: 600 } }
                }] },
                options: {
                    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
                        y: CHART_AXIS_OPTS.y
                    }
                }
            }));
            return;
        }

        if (view === 'weekday') {
            var wk = weekdayBuckets(members);
            var wkTotal = wk.reduce(function (a, b) { return a + b; }, 0);
            _statsCharts.push(new Chart(canvas, {
                type: 'bar',
                data: { labels: WEEKDAY_LABELS, datasets: [{
                    data: wk, backgroundColor: CHART_COLOR.green, borderRadius: 4,
                    datalabels: {
                        display: true, color: DATALABEL_COLOR, anchor: 'end', align: 'top', font: { size: 10, weight: 600 },
                        formatter: function (v) { return [v + '건', (wkTotal ? Math.round(v / wkTotal * 100) : 0) + '%']; }
                    }
                }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: CHART_AXIS_OPTS }
            }));
            return;
        }

        if (view === 'org') {
            var org = orgBuckets(key, members);
            wrap.style.height = Math.max(200, org.length * 20) + 'px'; // 최대 21개 관할서 — 가로막대라 세로로 늘림
            _statsCharts.push(new Chart(canvas, {
                type: 'bar',
                data: { labels: org.map(function (o) { return o[0]; }), datasets: [{
                    data: org.map(function (o) { return o[1]; }), backgroundColor: CHART_COLOR.blue, borderRadius: 4,
                    datalabels: { display: true, color: DATALABEL_COLOR, anchor: 'end', align: 'end', font: { size: 9, weight: 600 } }
                }] },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    scales: {
                        x: { beginAtZero: true, ticks: { color: '#64748b', precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                        y: { ticks: { color: '#cbd5e1', font: { size: 10 } }, grid: { display: false } }
                    }
                }
            }));
            return;
        }

        if (view === 'warn') {
            var w = warnBuckets(key, members);

            if (!_warnExpanded || !w.active) {
                _statsCharts.push(new Chart(canvas, {
                    type: 'doughnut',
                    data: { labels: ['특보 중', '평시'], datasets: [{
                        data: [w.active, w.inactive], backgroundColor: [CHART_COLOR.red, 'rgba(255,255,255,0.12)'], borderWidth: 0
                    }] },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } },
                            datalabels: { display: true, color: '#05070d', font: { size: 11, weight: 700 }, formatter: function (v) { return v || ''; } }
                        },
                        onClick: function (evt, elements) {
                            // "특보 중" 조각(index 0)을 누르면 유형×심각도로 펼친다(2026-08-31 사용자 확정).
                            if (!elements.length || elements[0].index !== 0 || !w.active) return;
                            _warnExpanded = true;
                            renderActiveChart(key, members);
                        }
                    }
                }));
                if (caption) caption.textContent = w.active ? '"특보 중" 조각을 누르면 태풍·풍랑·강풍별로 나눠 볼 수 있습니다.' : '';
                return;
            }

            var sv = warnSeverityBuckets(key, members);
            var labels = sv.map(function (s) { return s.label; });
            var data = sv.map(function (s) { return s.count; });
            var colors = sv.map(function (s) { return s.color; });
            if (w.inactive) { labels.push('평시'); data.push(w.inactive); colors.push('rgba(255,255,255,0.12)'); }
            _statsCharts.push(new Chart(canvas, {
                type: 'doughnut',
                data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 10 } },
                        datalabels: { display: true, color: '#05070d', font: { size: 10, weight: 700 }, formatter: function (v) { return v || ''; } }
                    },
                    onClick: function () { _warnExpanded = false; renderActiveChart(key, members); }
                }
            }));
            if (caption) caption.textContent = '한 사고에 특보가 두 종류 이상 겹쳐 있으면 두 조각에 같이 잡혀 합계가 "특보 중" 건수보다 클 수 있습니다. 다시 누르면 접힙니다.';
        }
    }

    function renderStatsBody() {
        var body = document.getElementById('accident-stats-body');
        if (!body || !_statsKey || !_statsMembers) return;
        body.innerHTML = buildStatsHtml(_statsKey, _statsMembers);
        renderActiveChart(_statsKey, _statsMembers);
    }

    function openStatsSheet(key, members) {
        var sheet = document.getElementById('accident-stats-sheet');
        if (!sheet) return;
        _statsKey = key;
        _statsMembers = members;
        _trendDrill = null; // 새 셀을 열 때마다 드릴다운 상태 초기화
        _warnExpanded = false;
        renderStatsBody();
        sheet.classList.add('open');
    }

    function closeStatsSheet() {
        var sheet = document.getElementById('accident-stats-sheet');
        if (sheet) sheet.classList.remove('open');
        destroyStatsCharts();
        _statsKey = null;
        _statsMembers = null;
    }

    function tryHandleGridClick(map, evt) {
        if (!gridLayer || !gridLayer.getVisible()) return false;
        var hit = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, lyr) {
            if (lyr === gridLayer) { hit = feature; return true; }
        }, { layerFilter: function (l) { return l === gridLayer; } });
        if (!hit) { closeStatsSheet(); return false; }
        openStatsSheet(state.source, hit.get('members'));
        return true;
    }

    // ── 필터 바 + 팝업(사고유형·관할서·시간대·계절·특보·선박용도·톤수,
    //    2026-08-24~25 사용자 확정) ──────
    // [연계] 마크업 index2.html #accident-filter-bar(정적, 버튼 7개) · CSS style.css
    //   ".accident-filter-*" · 적용 대상 applyFiltersToMarkers()·recomputeGrid()

    var HOUR_PRESETS = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24]];
    function hourPresetLabel(r) { return pad2(r[0]) + '~' + pad2(r[1] === 24 ? 0 : r[1]) + '시'; }

    // 톤수 구간 프리셋 — 실측 분포(hk 10,338건, 5톤 미만이 절반 가까이) 기준으로 구간을 나눔.
    var TONNAGE_PRESETS = [[0, 5], [5, 10], [10, 20], [20, 50], [50, 100], [100, 500], [500, 1000], [1000, Infinity]];
    function tonnagePresetLabel(r) {
        if (r[1] === Infinity) return r[0].toLocaleString('ko-KR') + '톤 이상';
        if (r[0] === 0) return r[1].toLocaleString('ko-KR') + '톤 미만';
        return r[0].toLocaleString('ko-KR') + '~' + r[1].toLocaleString('ko-KR') + '톤';
    }

    /** 현재 활성 소스(rawFeatures[state.source])에서, 이 축(excludeKey)만 빼고 나머지
     * 필터를 이미 건 상태로 실제 존재하는 값만 옵션으로 뽑는다 — 0건짜리 선택지를 안
     * 보여주기 위함이자, count 를 "지금까지 고른 다른 필터와의 교집합"으로 보여주기
     * 위함(사용자 확정 2026-08-25). */
    function buildValueOptions(getValue, labelTable, excludeKey) {
        var key = state.source;
        var feats = (key && rawFeatures[key]) || [];
        var counts = {}; // value -> count
        feats.forEach(function (f) {
            var row = f.get('row');
            if (!passesFiltersExcept(key, row, excludeKey)) return;
            var v = getValue(row);
            if (v == null) return;
            counts[v] = (counts[v] || 0) + 1;
        });
        return Object.keys(counts).map(function (vStr) {
            // 코드가 숫자(orgCd·typeCode 는 문자열, orgCd 만 숫자 — Object 키는 항상 문자열이라 되돌린다)
            var v = /^-?\d+$/.test(vStr) ? Number(vStr) : vStr;
            return { value: v, label: accidentLabel(labelTable, v), count: counts[vStr] };
        }).sort(function (a, b) { return b.count - a.count; });
    }

    // 사고유형 체크박스 순서(2026-08-25 사용자 확정) — 이 9개는 이 순서로 먼저,
    // 나머지는 원래 순서(건수 내림차순) 그대로 뒤에.
    var TYPE_ORDER_PRIORITY = ['충돌', '침몰', '전복', '화재', '좌초', '좌주', '폭발', '표류', '접촉'];

    /** 사고유형 옵션 — "-"(코드 없음)·"기타"(정확히 그 라벨인 것만, "기타(인명)" 등은
     * 남김)는 목록에서 뺀다(사용자 확정 2026-08-25). */
    function buildTypeOptions() {
        var opts = buildValueOptions(function (r) { return typeFilterCode(typeCodeOf(state.source, r)); }, ACCIDENT_TYPE_LABELS, 'types')
            .filter(function (o) { return o.value != null && o.value !== '' && o.label !== '기타'; });
        opts.forEach(function (o, i) { o.__origIdx = i; }); // 건수 내림차순이던 원래 순서 보존
        return opts.sort(function (a, b) {
            var pa = TYPE_ORDER_PRIORITY.indexOf(a.label), pb = TYPE_ORDER_PRIORITY.indexOf(b.label);
            if (pa === -1 && pb === -1) return a.__origIdx - b.__origIdx;
            if (pa === -1) return 1;
            if (pb === -1) return -1;
            return pa - pb;
        });
    }
    /** 관할서 옵션 — buildValueOptions 을 그대로 쓰면 같은 서가 신·구 관할서코드
     * (1532xxx 현재 / 1750xxx 2014~2017 "국민안전처" 시절 코드, ACCIDENT_ORG_LABELS
     * 참고)로 갈라져 있어 같은 이름 버튼이 두 개씩 뜬다(2026-08-31 관할서 팝업 개편
     * 스크린샷에서 발견 — 인천·평택·태안·보령·목포·여수·군산·완도 등 8곳). 이름으로
     * 묶어 버튼 하나로 보여주고, codes 에 실제 코드들을 모아둬 선택 시 전부 포함한다. */
    function buildOrgOptions() {
        var key = state.source;
        var feats = (key && rawFeatures[key]) || [];
        var byName = {};
        feats.forEach(function (f) {
            var row = f.get('row');
            if (!passesFiltersExcept(key, row, 'orgs')) return;
            var code = row[ORG_POS_IDX[key]];
            if (code == null) return;
            var label = accidentLabel(ACCIDENT_ORG_LABELS, code);
            var entry = byName[label] || (byName[label] = { codes: [], count: 0 });
            if (entry.codes.indexOf(code) === -1) entry.codes.push(code);
            entry.count++;
        });
        return Object.keys(byName).map(function (label) {
            return { value: label, label: label, codes: byName[label].codes, count: byName[label].count };
        }).sort(function (a, b) { return b.count - a.count; });
    }

    // 선박용도 버튼 순서(2026-08-31 사용자 확정) — 원본 값이 이미 이 7종 그대로라 합칠 필요는
    // 없고 순서만 고정한다.
    var SHIPUSE_ORDER_PRIORITY = ['어선', '여객선', '수상레저기구', '예인선', '화물선', '유조선', '기타선'];

    /** 선박용도 옵션 — 값 자체가 이미 한글 문자열(코드 아님)이라 라벨표 없이 그대로 쓴다. */
    function buildShipUseOptions() {
        var opts = buildValueOptions(function (r) { return r[SHIPUSE_POS_IDX.hk]; }, null, 'shipUses');
        opts.forEach(function (o, i) { o.__origIdx = i; });
        return opts.sort(function (a, b) {
            var pa = SHIPUSE_ORDER_PRIORITY.indexOf(a.label), pb = SHIPUSE_ORDER_PRIORITY.indexOf(b.label);
            if (pa === -1 && pb === -1) return a.__origIdx - b.__origIdx;
            if (pa === -1) return 1;
            if (pb === -1) return -1;
            return pa - pb;
        });
    }

    /** 연속된 연도들을 "2016, 2021~2025"처럼 구간으로 묶어 표기(선박용도·톤수 필터를
     * 실제로 걸 때 "이 정보는 몇 년도 사고에만 있다" 안내 토스트에 씀). */
    function formatYearRanges(years) {
        var sorted = Array.from(years).map(Number).sort(function (a, b) { return a - b; });
        var ranges = [];
        var start = null, prev = null;
        sorted.forEach(function (y) {
            if (start == null) { start = y; prev = y; return; }
            if (y === prev + 1) { prev = y; return; }
            ranges.push(start === prev ? String(start) : start + '~' + prev);
            start = y; prev = y;
        });
        if (start != null) ranges.push(start === prev ? String(start) : start + '~' + prev);
        return ranges.map(function (r) { return r + '년'; }).join(', ');
    }

    /** posIdx 위치에 실제 값이 있는 hk 행들의 발생연도 집합 — 위 formatYearRanges 와 짝. */
    function yearsWithValue(posIdx) {
        var feats = rawFeatures.hk || [];
        var years = new Set();
        feats.forEach(function (f) {
            var row = f.get('row');
            if (row[posIdx] != null) years.add(String(row[2]).slice(0, 4));
        });
        return years;
    }

    /** 특보종류 옵션 — 소스별로 의미있는 종류만(hk 는 태풍·풍랑, person 은 +강풍).
     * 값이 배열(다중 발효 가능)이라 buildValueOptions 의 단일값 카운트 방식을 못 쓰고 별도 구현. */
    function buildWarnOptions() {
        var key = state.source;
        var feats = (key && rawFeatures[key]) || [];
        var counts = {};
        feats.forEach(function (f) {
            var row = f.get('row');
            if (!passesFiltersExcept(key, row, 'warnTypes')) return;
            var active = row[WARN_FLAGS_POS_IDX[key]] || [];
            active.forEach(function (code) { counts[code] = (counts[code] || 0) + 1; });
        });
        return (WARN_TYPE_ORDER[key] || []).filter(function (code) { return counts[code] > 0; }).map(function (code) {
            return { value: code, label: WARN_TYPE_LABELS[code], count: counts[code] };
        });
    }

    // ── 팝업 셸(버튼그리드 목록·시간대 전용 몸통 공용, 2026-08-31 화면 중앙 모달로 변경) ──
    var _filterPopupEls = null;
    function ensureFilterPopup() {
        if (_filterPopupEls) return _filterPopupEls;
        var overlay = document.createElement('div');
        overlay.className = 'accident-filter-popup-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML =
            '<div class="accident-filter-popup">' +
            '<div class="accident-filter-popup-hdr"><span id="afp-title">필터</span><span class="count" id="afp-count"></span>' +
            '<button type="button" class="accident-filter-popup-close" id="afp-close" aria-label="닫기">&times;</button></div>' +
            '<div class="accident-filter-popup-body" id="afp-body"></div>' +
            '<div class="accident-filter-popup-footer">' +
            '<button type="button" id="afp-cancel">취소</button>' +
            '<button type="button" id="afp-reset">전체 해제</button>' +
            '<button type="button" class="primary" id="afp-confirm">확인</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFilterPopup(); });
        document.getElementById('afp-close').addEventListener('click', closeFilterPopup);
        document.getElementById('afp-cancel').addEventListener('click', closeFilterPopup);
        _filterPopupEls = {
            overlay: overlay,
            title: document.getElementById('afp-title'),
            count: document.getElementById('afp-count'),
            body: document.getElementById('afp-body'),
            resetBtn: document.getElementById('afp-reset'),
            confirmBtn: document.getElementById('afp-confirm')
        };
        return _filterPopupEls;
    }

    function closeFilterPopup() {
        if (_filterPopupEls) _filterPopupEls.overlay.style.display = 'none';
    }

    /**
     * 버튼그리드 다중선택 팝업(사고유형·계절·선박용도·특보 공용, 2026-08-31 체크박스→
     * 버튼그리드로 개편 — 3개씩 배치, 선택된 버튼은 파란 배경으로 표시).
     * @param {string} title
     * @param {Array<{value, label, count}>} options
     * @param {Set|null} currentSelected - null 이면 "전체"(아무 버튼도 안 눌린 상태로 시작)
     * @param {function(Set|null)} onConfirm - 확인 눌렀을 때, 하나도 안 골랐으면 null(전체)로 넘김
     */
    function openCheckboxFilterPopup(title, options, currentSelected, onConfirm) {
        var els = ensureFilterPopup();
        els.title.textContent = title;
        els.count.textContent = options.length + '개 항목';
        var selected = new Set(currentSelected || []);

        function render() {
            if (!options.length) {
                els.body.innerHTML = '<div class="accident-filter-empty">지금 불러온 데이터에 표시할 항목이 없습니다.</div>';
                return;
            }
            var allActive = selected.size === options.length;
            els.body.innerHTML =
                '<button type="button" class="accident-filter-select-all' + (allActive ? ' active' : '') + '" id="afp-check-all">전체 선택</button>' +
                '<div class="accident-filter-btn-grid">' +
                options.map(function (o, i) {
                    var active = selected.has(o.value) ? ' active' : '';
                    return '<button type="button" class="accident-filter-opt-btn' + active + '" data-i="' + i + '">' +
                        '<span class="label">' + escapeHtml(o.label) + '</span><span class="n">' + o.count + '건</span></button>';
                }).join('') + '</div>';

            var checkAll = document.getElementById('afp-check-all');
            checkAll.addEventListener('click', function () {
                if (allActive) selected.clear();
                else options.forEach(function (o) { selected.add(o.value); });
                render();
            });
            Array.prototype.forEach.call(els.body.querySelectorAll('.accident-filter-opt-btn'), function (btn) {
                btn.addEventListener('click', function () {
                    var o = options[Number(btn.dataset.i)];
                    if (selected.has(o.value)) selected.delete(o.value); else selected.add(o.value);
                    render();
                });
            });
        }
        render();

        els.resetBtn.onclick = function () { selected.clear(); render(); };
        els.confirmBtn.onclick = function () {
            onConfirm(selected.size ? selected : null);
            closeFilterPopup();
        };
        els.overlay.style.display = 'flex';
    }

    // 관할서 팝업 지방청 그룹 구성(2026-08-31 웹서칭으로 확인, 사용자 확정) — 21개 관할서 전부 포함.
    var ORG_REGION_ORDER = ['중부청', '서해청', '동해청', '남해청', '제주청'];
    var ORG_REGION_OF = {
        인천해양경찰서: '중부청', 평택해양경찰서: '중부청', 태안해양경찰서: '중부청', 보령해양경찰서: '중부청',
        군산해양경찰서: '서해청', 부안해양경찰서: '서해청', 목포해양경찰서: '서해청', 완도해양경찰서: '서해청', 여수해양경찰서: '서해청',
        속초해양경찰서: '동해청', 강릉해양경찰서: '동해청', 동해해양경찰서: '동해청', 울진해양경찰서: '동해청', 포항해양경찰서: '동해청',
        부산해양경찰서: '남해청', 울산해양경찰서: '남해청', 창원해양경찰서: '남해청', 통영해양경찰서: '남해청', 사천해양경찰서: '남해청',
        제주해양경찰서: '제주청', 서귀포해양경찰서: '제주청'
    };
    function orgShortName(label) { return label.replace(/해양경찰서$/, ''); }

    /**
     * 관할서 전용 팝업(2026-08-31) — 지방청(중부→서해→동해→남해→제주)별로 묶어 보여준다.
     * 지방청 라벨을 누르면 그 청 소속 전체를 한 번에 선택/해제(사용자 확정).
     * options 는 buildOrgOptions() 가 신·구 관할서코드를 이름으로 합친 것 — 팝업 내부
     * 선택 상태는 이름(o.label) 기준으로 관리하고, 확인 시 그 이름의 codes 전부를 담은
     * Set<orgCd> 로 펼쳐서 onConfirm 에 넘긴다(filters.orgs·passesFilters 는 그대로 코드
     * 기준이라 이 경계에서만 변환).
     * @param {Array<{value, label, codes, count}>} options
     * @param {Set<number>|null} currentSelectedCodes - 지금 filters.orgs 값
     * @param {function(Set<number>|null)} onConfirm
     */
    function openOrgFilterPopup(options, currentSelectedCodes, onConfirm) {
        var els = ensureFilterPopup();
        els.title.textContent = '관할서';
        els.count.textContent = options.length + '개 항목';
        var currentCodes = currentSelectedCodes || new Set();
        var selected = new Set(); // Set<label>
        options.forEach(function (o) {
            if (o.codes.some(function (c) { return currentCodes.has(c); })) selected.add(o.label);
        });

        var byRegion = {};
        options.forEach(function (o) {
            var region = ORG_REGION_OF[o.label] || '기타';
            (byRegion[region] || (byRegion[region] = [])).push(o);
        });
        var regions = ORG_REGION_ORDER.filter(function (r) { return byRegion[r] && byRegion[r].length; });
        Object.keys(byRegion).forEach(function (r) { if (regions.indexOf(r) === -1) regions.push(r); });

        function regionState(region) {
            var opts = byRegion[region];
            var n = opts.filter(function (o) { return selected.has(o.label); }).length;
            if (n === 0) return 'none';
            return n === opts.length ? 'all' : 'some';
        }

        function render() {
            if (!options.length) {
                els.body.innerHTML = '<div class="accident-filter-empty">지금 불러온 데이터에 표시할 항목이 없습니다.</div>';
                return;
            }
            els.body.innerHTML = regions.map(function (region) {
                var opts = byRegion[region];
                var st = regionState(region);
                var optsHtml = opts.map(function (o) {
                    var active = selected.has(o.label) ? ' active' : '';
                    return '<button type="button" class="accident-filter-opt-btn' + active + '" data-i="' + options.indexOf(o) + '">' +
                        '<span class="label">' + escapeHtml(orgShortName(o.label)) + '</span><span class="n">' + o.count + '건</span></button>';
                }).join('');
                return '<div class="accident-filter-org-region' + (st === 'all' ? ' all-selected' : st === 'some' ? ' some-selected' : '') + '" data-region="' + escapeHtml(region) + '">' +
                    '<span class="label">' + escapeHtml(region) + '</span><span class="hint">' + (st === 'all' ? '전체 해제' : '전체 선택') + '</span></div>' +
                    '<div class="accident-filter-btn-grid">' + optsHtml + '</div>';
            }).join('');

            Array.prototype.forEach.call(els.body.querySelectorAll('.accident-filter-opt-btn'), function (btn) {
                btn.addEventListener('click', function () {
                    var o = options[Number(btn.dataset.i)];
                    if (selected.has(o.label)) selected.delete(o.label); else selected.add(o.label);
                    render();
                });
            });
            Array.prototype.forEach.call(els.body.querySelectorAll('.accident-filter-org-region'), function (hdr) {
                hdr.addEventListener('click', function () {
                    var region = hdr.dataset.region;
                    var opts = byRegion[region];
                    var toAll = regionState(region) !== 'all';
                    opts.forEach(function (o) { if (toAll) selected.add(o.label); else selected.delete(o.label); });
                    render();
                });
            });
        }
        render();

        els.resetBtn.onclick = function () { selected.clear(); render(); };
        els.confirmBtn.onclick = function () {
            if (!selected.size) { onConfirm(null); closeFilterPopup(); return; }
            var codeSet = new Set();
            options.forEach(function (o) { if (selected.has(o.label)) o.codes.forEach(function (c) { codeSet.add(c); }); });
            onConfirm(codeSet);
            closeFilterPopup();
        };
        els.overlay.style.display = 'flex';
    }

    /**
     * 범위형(구간) 필터 팝업 공용 뼈대 — 프리셋(다중 토글) + 직접 설정(임의 범위
     * 추가, 칩으로 표시). 시간대(2026-08-24)로 처음 만들었다가 톤수(2026-08-25)에
     * 그대로 재사용하려고 일반화했다 — CSS 클래스 이름은 시간대 때 이름
     * (".accident-filter-hour-*")을 그대로 쓴다(스타일은 완전히 같아 새로 안 만듦).
     * @param {Object} cfg
     * @param {string} cfg.title
     * @param {string} cfg.filterKey - filters 객체의 키(예: 'hourRanges'), passesFiltersExcept 에 씀
     * @param {Array<[number,number]>} cfg.presets
     * @param {function([number,number]):string} cfg.formatLabel
     * @param {function(string,Array):(number|null)} cfg.valueOf - (srcKey, row) -> 비교할 값
     * @param {string} cfg.inputType - 'time' | 'number'
     * @param {string} cfg.defaultStartVal
     * @param {string} cfg.defaultEndVal
     * @param {function(string):number} cfg.parseInputVal - input.value -> 숫자(NaN 이면 무효)
     * @param {string} [cfg.inputStep] - inputType='number' 일 때 <input step>
     * @param {Array<[number,number]>|null} current
     * @param {function(Array<[number,number]>|null)} onConfirm
     */
    function openRangeFilterPopup(cfg, current, onConfirm) {
        var els = ensureFilterPopup();
        els.title.textContent = cfg.title;
        els.count.textContent = '';
        var ranges = (current || []).slice(); // 작업용 사본

        function isPresetActive(preset) {
            return ranges.some(function (r) { return r[0] === preset[0] && r[1] === preset[1]; });
        }
        function togglePreset(preset) {
            var idx = ranges.findIndex(function (r) { return r[0] === preset[0] && r[1] === preset[1]; });
            if (idx >= 0) ranges.splice(idx, 1); else ranges.push(preset.slice());
        }
        function isCustomRange(r) { return !cfg.presets.some(function (p) { return p[0] === r[0] && p[1] === r[1]; }); }

        /** 프리셋 옆에 보여줄 건수 — "이 구간에 실제로 값이 있는" 행만 센다(이 축만
         * 빼고 이미 걸린 다른 필터와의 교집합, 사용자 확정 2026-08-25). 값이 없는
         * (null) 행은 세지 않는다 — buildValueOptions·buildWarnOptions 등 다른 필터
         * 옵션의 건수 표시와 같은 원칙(체크박스 옵션들도 null은 옵션 자체에서 뺀다).
         * ⚠주의: passesFilters() 의 실제 필터링 동작은 이와 다르다 — 거기서는 값이
         * 없는 행을 "판단 불가"로 통과시킨다(hourRanges 필터를 실제로 걸었을 때
         * person 소스가 숨지 않는 것과 같은 원칙). 처음엔 이 카운트 함수도 같은
         * "null=통과"로 세다가, 톤수(hk 35,027건 중 24,689건이 null)에서 모든
         * 프리셋 버튼이 전부 24,000~29,000건대로 나와 사실상 의미 없는 숫자가
         * 되는 걸 사용자가 스크린샷으로 지적해 분리했다 — hourRanges 는 hk 소스의
         * 시각 데이터가 거의 항상 있어(0/35,027 null) 이 차이가 드러나지 않았을
         * 뿐, person 소스로 시간대 팝업을 열면 (hour 컬럼 자체가 없어) 같은 문제가
         * 있었다(이번에 같이 고침). */
        function presetCount(preset) {
            var srcKey = state.source;
            var feats = (srcKey && rawFeatures[srcKey]) || [];
            var cnt = 0;
            feats.forEach(function (f) {
                var row = f.get('row');
                if (!passesFiltersExcept(srcKey, row, cfg.filterKey)) return;
                var v = cfg.valueOf(srcKey, row);
                if (v != null && v >= preset[0] && v < preset[1]) cnt++;
            });
            return cnt;
        }

        function render() {
            var presetsHtml = cfg.presets.map(function (p, i) {
                return '<button type="button" class="accident-filter-hour-preset' + (isPresetActive(p) ? ' active' : '') +
                    '" data-preset-i="' + i + '">' + cfg.formatLabel(p) + '<span class="n">' + presetCount(p) + '건</span></button>';
            }).join('');
            var customRanges = ranges.filter(isCustomRange);
            var chipsHtml = customRanges.length ? customRanges.map(function (r, i) {
                return '<span class="accident-filter-hour-chip">' + cfg.formatLabel(r) +
                    '<button type="button" data-custom-i="' + i + '">&times;</button></span>';
            }).join('') : '<span style="color:var(--text-sub);font-size:0.76rem;">추가된 범위 없음</span>';
            els.body.innerHTML =
                '<div class="accident-filter-hour-presets">' + presetsHtml + '</div>' +
                '<div class="accident-filter-hour-custom">' +
                '<div class="accident-filter-hour-custom-label">직접 설정</div>' +
                '<div class="accident-filter-hour-custom-row">' +
                '<input type="' + cfg.inputType + '" id="afp-range-start"' + (cfg.inputStep ? ' step="' + cfg.inputStep + '"' : '') + ' value="' + cfg.defaultStartVal + '">' +
                '<span>~</span>' +
                '<input type="' + cfg.inputType + '" id="afp-range-end"' + (cfg.inputStep ? ' step="' + cfg.inputStep + '"' : '') + ' value="' + cfg.defaultEndVal + '">' +
                '<button type="button" id="afp-range-add">추가</button>' +
                '</div>' +
                '<div class="accident-filter-hour-chips">' + chipsHtml + '</div>' +
                '</div>';
            Array.prototype.forEach.call(els.body.querySelectorAll('.accident-filter-hour-preset'), function (btn) {
                btn.addEventListener('click', function () { togglePreset(cfg.presets[Number(btn.dataset.presetI)]); render(); });
            });
            Array.prototype.forEach.call(els.body.querySelectorAll('[data-custom-i]'), function (btn) {
                btn.addEventListener('click', function () {
                    var target = customRanges[Number(btn.dataset.customI)];
                    var idx = ranges.indexOf(target);
                    if (idx >= 0) ranges.splice(idx, 1);
                    render();
                });
            });
            document.getElementById('afp-range-add').addEventListener('click', function () {
                var startVal = document.getElementById('afp-range-start').value;
                var endVal = document.getElementById('afp-range-end').value;
                var start = startVal ? cfg.parseInputVal(startVal) : NaN;
                var end = endVal ? cfg.parseInputVal(endVal) : NaN;
                if (isNaN(start) || isNaN(end) || start >= end) {
                    window.alert('시작 값이 종료 값보다 작아야 합니다.');
                    return;
                }
                ranges.push([start, end]);
                render();
            });
        }
        render();

        els.resetBtn.onclick = function () { ranges = []; render(); };
        els.confirmBtn.onclick = function () {
            onConfirm(ranges.length ? ranges : null);
            closeFilterPopup();
        };
        els.overlay.style.display = 'flex';
    }

    /** 시간대 팝업 — openRangeFilterPopup 에 시간대 전용 설정을 얹은 얇은 래퍼. */
    function openHourRangeFilterPopup(current, onConfirm) {
        openRangeFilterPopup({
            title: '시간대', filterKey: 'hourRanges', presets: HOUR_PRESETS, formatLabel: hourPresetLabel,
            valueOf: function (srcKey, row) { return srcKey === 'hk' ? hourOf(row[3]) : null; },
            inputType: 'time', defaultStartVal: '09:00', defaultEndVal: '18:00',
            parseInputVal: function (v) { return parseInt(v.split(':')[0], 10); },
        }, current, onConfirm);
    }

    /** 톤수 팝업 — openRangeFilterPopup 에 톤수 전용 설정을 얹은 얇은 래퍼(2026-08-25). */
    function openTonnageRangeFilterPopup(current, onConfirm) {
        openRangeFilterPopup({
            title: '톤수', filterKey: 'tonnageRanges', presets: TONNAGE_PRESETS, formatLabel: tonnagePresetLabel,
            valueOf: function (srcKey, row) { return srcKey === 'hk' ? row[TONNAGE_POS_IDX.hk] : null; },
            inputType: 'number', inputStep: '0.1', defaultStartVal: '5', defaultEndVal: '10',
            parseInputVal: function (v) { return parseFloat(v); },
        }, current, onConfirm);
    }

    /** 필터 버튼 라벨을 지금 filters 상태에 맞춰 갱신("전체" 또는 "N개 선택"). */
    function updateFilterButtonLabel(filterKey, prefix) {
        var btn = document.getElementById('accident-filter-btn-' + filterKey);
        if (!btn) return;
        var val = filters[filterKey];
        var n = val ? val.size != null ? val.size : val.length : 0;
        // 관할서는 같은 서가 신·구 코드 2개로 잡혀 있을 수 있어(buildOrgOptions 참고)
        // 코드 개수 그대로 세면 "인천 1곳만 골랐는데 2개 선택"으로 오해를 준다 —
        // 이름 기준 고유 개수로 센다(2026-08-31).
        if (filterKey === 'orgs' && val) {
            var names = new Set();
            val.forEach(function (code) { names.add(accidentLabel(ACCIDENT_ORG_LABELS, code)); });
            n = names.size;
        }
        btn.textContent = prefix + ': ' + (n ? n + '개 선택' : '전체');
        btn.classList.toggle('has-selection', n > 0);
    }

    function updateAllFilterButtonLabels() {
        updateFilterButtonLabel('types', '사고유형');
        updateFilterButtonLabel('orgs', '관할서');
        updateFilterButtonLabel('hourRanges', '시간대');
        updateFilterButtonLabel('seasons', '계절');
        updateFilterButtonLabel('warnTypes', '특보');
        updateFilterButtonLabel('shipUses', '선박용도');
        updateFilterButtonLabel('tonnageRanges', '톤수');
    }

    /** 필터가 바뀔 때마다 현황 마커·분석 격자 양쪽에 다시 반영. */
    function onFiltersChanged(map) {
        updateAllFilterButtonLabels();
        if (state.source) applyFiltersToMarkers(state.source);
        if (state.mode === 'analysis' && state.source) recomputeGrid(map);
        closeStatsSheet(); // 선택돼 있던 격자 셀 구성이 필터로 바뀌었을 수 있어 무효화
    }

    /** 사고정보가 켜져 있는 동안(showModeToggle 과 동일 시점)만 필터 바를 보여준다. */
    function showFilterBar(show) {
        _filterBarCollapsed = false; // 새로 소스를 고르거나 끌 때마다 접힘 상태 초기화
        var bar = document.getElementById('accident-filter-bar');
        if (bar) bar.style.display = show ? 'flex' : 'none';
        if (show) positionFilterBar();
    }

    // 현황/분석 버튼을 "지금 활성 모드"로 다시 누르면(재클릭) 필터 바 행만 접었다 편다
    // (모드 자체는 그대로 유지 — 2026-08-31 사용자 확정). 소스를 새로 고르면 초기화.
    var _filterBarCollapsed = false;
    function toggleFilterBarCollapse() {
        var bar = document.getElementById('accident-filter-bar');
        if (!bar) return;
        // 사고정보 자체가 꺼져 필터 바가 없는 상태(display:none)라면 토글 대상이 아니다.
        // _filterBarCollapsed 로 "내가 접어서 none인지"와 구분한다 — 안 그러면 한 번
        // 접은 뒤 재클릭해도 style.display==='none' 이라 계속 안 펴지는 버그가 생긴다.
        if (bar.style.display === 'none' && !_filterBarCollapsed) return;
        _filterBarCollapsed = !_filterBarCollapsed;
        bar.style.display = _filterBarCollapsed ? 'none' : 'flex';
    }

    /** 필터 바 위치 재계산 — 모드 전환 시 모드토글 높이가 바뀔 수 있어 호출된다.
     * (예전엔 관할서·시간대·계절을 분석 모드에서만 보였으나, 현황에서도 똑같이
     * 다양한 필터를 쓰고 싶다는 요청으로 5개 다 항상 노출로 바뀌어 이제 위치
     * 재계산만 한다 — 사용자 확정 2026-08-25.) */
    function updateFilterBarModeVisibility() {
        positionFilterBar();
    }

    /** 필터 바의 top 을 모드토글 실측 높이 기준으로 인라인 설정 — 글자 크기 설정에
     * 따라 모드토글 높이가 달라져 고정 px로 못 잡는다(같은 이유로 이미 JS로 위치를
     * 계산하는 다른 오버레이 패턴은 없어 이 파일 안에서 새로 계산). */
    function positionFilterBar() {
        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        var bar = document.getElementById('accident-filter-bar');
        if (!modeToggle || !bar || bar.style.display === 'none') return;
        bar.style.top = (modeToggle.offsetTop + modeToggle.offsetHeight + 6) + 'px';
    }

    function bindFilterBar(map) {
        var bar = document.getElementById('accident-filter-bar');
        if (!bar) return;
        bar.addEventListener('click', function (e) {
            var btn = e.target.closest('.accident-filter-btn');
            if (!btn) return;
            var key = btn.dataset.filter;
            if (key === 'types') {
                openCheckboxFilterPopup('사고유형', buildTypeOptions(), filters.types, function (sel) {
                    filters.types = sel;
                    onFiltersChanged(map);
                });
            } else if (key === 'orgs') {
                openOrgFilterPopup(buildOrgOptions(), filters.orgs, function (sel) {
                    filters.orgs = sel;
                    onFiltersChanged(map);
                });
            } else if (key === 'hourRanges') {
                openHourRangeFilterPopup(filters.hourRanges, function (val) {
                    filters.hourRanges = val;
                    onFiltersChanged(map);
                });
            } else if (key === 'seasons') {
                var seasonOptions = SEASON_ORDER.map(function (s) {
                    var feats = (state.source && rawFeatures[state.source]) || [];
                    var count = feats.filter(function (f) {
                        var row = f.get('row');
                        return passesFiltersExcept(state.source, row, 'seasons') && seasonOf(row[2]) === s;
                    }).length;
                    return { value: s, label: SEASON_LABELS[s], count: count };
                });
                openCheckboxFilterPopup('계절', seasonOptions, filters.seasons, function (sel) {
                    filters.seasons = sel;
                    onFiltersChanged(map);
                });
            } else if (key === 'warnTypes') {
                openCheckboxFilterPopup('특보', buildWarnOptions(), filters.warnTypes, function (sel) {
                    filters.warnTypes = sel;
                    onFiltersChanged(map);
                });
            } else if (key === 'shipUses') {
                openCheckboxFilterPopup('선박용도', buildShipUseOptions(), filters.shipUses, function (sel) {
                    filters.shipUses = sel;
                    if (sel && typeof window._showOceanToast === 'function') {
                        window._showOceanToast(
                            '선박용도 정보는 ' + formatYearRanges(yearsWithValue(SHIPUSE_POS_IDX.hk)) + ' 사고에만 있어, 그 외 사고는 결과에서 제외됩니다.',
                            'bottom', 3500, true);
                    }
                    onFiltersChanged(map);
                });
            } else if (key === 'tonnageRanges') {
                openTonnageRangeFilterPopup(filters.tonnageRanges, function (val) {
                    filters.tonnageRanges = val;
                    if (val && typeof window._showOceanToast === 'function') {
                        window._showOceanToast(
                            '톤수 정보는 ' + formatYearRanges(yearsWithValue(TONNAGE_POS_IDX.hk)) + ' 사고에만 있어, 그 외 사고는 결과에서 제외됩니다.',
                            'bottom', 3500, true);
                    }
                    onFiltersChanged(map);
                });
            }
        });

        var resetBtn = document.getElementById('accident-filter-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                filters.types = null;
                filters.orgs = null;
                filters.hourRanges = null;
                filters.seasons = null;
                filters.warnTypes = null;
                filters.shipUses = null;
                filters.tonnageRanges = null;
                onFiltersChanged(map);
            });
        }
    }

    // ── 버튼·팝아웃 UI ──────────────────────────────────────────────────────
    function closePopout() {
        var wrap = document.getElementById('ocean-accident-wrap');
        if (wrap) wrap.classList.remove('popup-open');
    }

    function updateSourceButtonsUi() {
        var list = document.getElementById('ocean-accident-source-list');
        if (!list) return;
        Array.prototype.forEach.call(list.children, function (btn) {
            btn.classList.toggle('active', btn.dataset.source === state.source);
        });
    }

    function updateModeToggleUi() {
        var toggle = document.getElementById('ocean-accident-mode-toggle');
        if (!toggle) return;
        Array.prototype.forEach.call(toggle.children, function (btn) {
            btn.classList.toggle('active', btn.dataset.mode === state.mode);
        });
    }

    function applyModeVisibility(map) {
        var key = state.source;
        Object.keys(clusterLayers).forEach(function (k) {
            clusterLayers[k].setVisible(k === key && state.mode === 'status');
        });
        if (state.mode !== 'status' && bubbleOverlay) bubbleOverlay.setPosition(undefined);
        if (state.mode === 'analysis' && key) {
            ensureGridLayer(map).setVisible(true);
            recomputeGrid(map);
        } else {
            if (gridLayer) gridLayer.setVisible(false);
            closeStatsSheet();
        }
    }

    // ON 시점의 배경지도를 기억해 뒀다 OFF 시 되돌린다(access_control.js/fishing_ban.js 와 동일 패턴).
    var _prevBasemap = null;

    // 데이터 로딩 중(fetch 완료 전) 사고정보 버튼을 눌러 끈 경우, 나중에 로딩이 끝나면서
    // 꺼진 상태를 덮어쓰고 다시 켜지는 레이스 컨디션이 있었다(사용자 보고 2026-08-20:
    // "꺼도 지도에 남아있음" — 헤드리스 브라우저로 네트워크 지연을 인위로 걸어 재현
    // 확인). turnOff() 가 이 카운터를 올려 진행 중이던 selectSource 콜백을 무효화한다.
    var _selectSeq = 0;

    function showModeToggle(show) {
        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (modeToggle) modeToggle.style.display = show ? 'flex' : 'none';
    }

    /** "선택 초기화" 버튼(2026-08-25 사용자 확정) — 모드토글과 같이 보이고 같이 숨는다. */
    function showFilterResetBtn(show) {
        var btn = document.getElementById('accident-filter-reset-btn');
        if (btn) btn.style.display = show ? 'block' : 'none';
    }

    function selectSource(map, key) {
        var seq = ++_selectSeq;
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        var iconEl = toggleBtn && toggleBtn.querySelector('i');
        var originalIconClass = iconEl ? iconEl.className : '';
        if (iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin';
        ensureClusterLayer(map, key).then(function () {
            if (iconEl) iconEl.className = originalIconClass;
            if (seq !== _selectSeq) return; // 그 사이 껐거나 다른 소스를 골랐으면 이 결과는 버린다
            state.source = key;
            Object.keys(clusterLayers).forEach(function (k) { clusterLayers[k].setVisible(false); });
            applyModeVisibility(map);
            closePopout();
            updateSourceButtonsUi();
            showModeToggle(true);
            showFilterResetBtn(true);
            showFilterBar(true);
            updateFilterBarModeVisibility();
            updateAllFilterButtonLabels();
            if (hasActiveFilters()) applyFiltersToMarkers(key); // 이전 소스에서 걸어둔 필터를 새 소스에도 반영
            if (toggleBtn) toggleBtn.classList.add('active');
            // 마커를 실제 지형과 대조해 보기 쉽도록 배경지도를 위성지도로 자동 전환(사용자 확정 2026-08-19)
            if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                _prevBasemap = window.oceanGetBasemap();
                if (_prevBasemap !== 'vworld') window.oceanSetBasemap('vworld');
            }
            if (window.trackUsage) window.trackUsage('ocean.accident_info');
        }).catch(function (e) {
            if (seq !== _selectSeq) return;
            if (iconEl) iconEl.className = originalIconClass;
            console.warn('[AccidentInfo] 데이터 로드 실패:', e.message);
        });
    }

    /**
     * 사고정보를 완전히 끈다 — 마커/격자 레이어 숨김, 소스 선택 해제, 배경지도 복귀.
     * 사고정보 버튼을 다시 누르면 호출(사용자 확정 2026-08-19: 재클릭으로 켜져 있던
     * 데이터를 끌 수 있어야 함 — access_control.js 등 다른 토글 레이어와 동일한 동작).
     * _selectSeq 를 올려 진행 중이던 selectSource 로딩 결과가 나중에 도착해도
     * 무시되게 한다(사용자 보고 2026-08-20 레이스 컨디션 수정).
     * [연계] ← bindUi() toggleBtn 클릭
     */
    function turnOff(map) {
        _selectSeq++;
        state.source = null;
        applyModeVisibility(map);
        closePopout();
        updateSourceButtonsUi();
        showModeToggle(false);
        showFilterResetBtn(false);
        showFilterBar(false);
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        if (toggleBtn) toggleBtn.classList.remove('active');
        if (_prevBasemap && _prevBasemap !== 'vworld' && typeof window.oceanSetBasemap === 'function') {
            window.oceanSetBasemap(_prevBasemap);
        }
        _prevBasemap = null;
    }

    function setMode(map, mode) {
        state.mode = mode;
        applyModeVisibility(map);
        updateModeToggleUi();
        updateFilterBarModeVisibility();
    }

    function bindUi(map) {
        var toggleBtn = document.getElementById('ocean-accident-toggle-btn');
        var wrap = document.getElementById('ocean-accident-wrap');
        if (toggleBtn && wrap) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (state.source) { turnOff(map); return; } // 이미 데이터가 켜져 있으면 전체 끄기
                // 아직 안 켜졌어도(소스 선택 직후 fetch 로딩 중일 수 있음) 진행 중인 로딩을
                // 취소한다 — 안 그러면 몇 초 후 로딩이 끝나면서 "끈" 데이터가 다시 나타난다
                // (사용자 보고 2026-08-20: 꺼도 지도에 남아있음 — 로딩 중 재현 확인).
                _selectSeq++;
                wrap.classList.toggle('popup-open'); // 소스 선택 팝아웃 열기/닫기
            });
            document.addEventListener('click', function (e) {
                if (!wrap.contains(e.target)) wrap.classList.remove('popup-open');
            });
            // 검수 모드 트리거 — 위 팝아웃 열기/닫기와 별개로 같은 버튼에 탭 횟수만 센다.
            toggleBtn.addEventListener('click', function () {
                if (REVIEW_MODE) {
                    // 검수 모드 안에서는 같은 버튼 5회 더 연타마다 서브모드를 한 단계씩
                    // 순환(꺼짐→심판원→관할서불일치→꺼짐→...). 2026-08-25 이전엔 심판원
                    // 레이어 하나만 단순 on/off였는데, 관할서 불일치 검수를 그 다음
                    // 단계(총 20회)로 추가하며 순환식으로 바꿨다.
                    _reviewSubModeTapCount++;
                    clearTimeout(_reviewSubModeTapTimer);
                    _reviewSubModeTapTimer = setTimeout(function () { _reviewSubModeTapCount = 0; }, REVIEW_MODE_TAP_RESET_MS);
                    if (_reviewSubModeTapCount < REVIEW_SUBMODE_TAP_THRESHOLD) return;
                    _reviewSubModeTapCount = 0;
                    _reviewSubMode = (_reviewSubMode + 1) % 3;
                    var map = window.getOceanMap && window.getOceanMap();
                    if (map) applyReviewSubMode(map);
                    return;
                }
                _reviewModeTapCount++;
                clearTimeout(_reviewModeTapTimer);
                _reviewModeTapTimer = setTimeout(function () { _reviewModeTapCount = 0; }, REVIEW_MODE_TAP_RESET_MS);
                if (_reviewModeTapCount < REVIEW_MODE_TAP_THRESHOLD) return;
                _reviewModeTapCount = 0;
                REVIEW_MODE = true;
                ensureReviewPanel();
                if (typeof window._showOceanToast === 'function') {
                    window._showOceanToast('기본 검수모드(해경·인명 좌표오류) 진입', 'top', 2200);
                }
            });
        }

        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (modeToggle) {
            modeToggle.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                if (btn.dataset.mode === state.mode) { toggleFilterBarCollapse(); return; }
                setMode(map, btn.dataset.mode);
            });
        }

        bindFilterBar(map);

        var sourceList = document.getElementById('ocean-accident-source-list');
        if (sourceList) {
            sourceList.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
                selectSource(map, btn.dataset.source);
            });
        }

        var closeBtn = document.getElementById('accident-stats-close');
        if (closeBtn) closeBtn.addEventListener('click', closeStatsSheet);

        // "사고발생상세" 탭·"분석 뷰" 탭·드릴다운 뒤로가기 — 바텀시트 본문은 매번
        // 다시 그려지므로 delegation(2026-08-29 분석 뷰·뒤로가기 추가).
        var statsBody = document.getElementById('accident-stats-body');
        if (statsBody) {
            statsBody.addEventListener('click', function (e) {
                if (!_statsKey) return;
                var viewBtn = e.target.closest('.accident-view-tab');
                if (viewBtn) {
                    _statsView[_statsKey] = viewBtn.dataset.view;
                    _trendDrill = null; // 뷰를 바꾸면 이전 뷰의 드릴다운 상태는 무효
                    renderStatsBody();
                    return;
                }
                var backBtn = e.target.closest('#accident-trend-back');
                if (backBtn) {
                    _trendDrill = (_trendDrill && _trendDrill.month) ? { year: _trendDrill.year } : null;
                    renderStatsBody();
                    return;
                }
                var detailBtn = e.target.closest('.accident-detail-tab');
                if (!detailBtn) return;
                _activeDetailTab[_statsKey] = detailBtn.dataset.tab;
                renderStatsBody();
            });
        }

        // 분석 모드일 때만 줌/이동에 맞춰 격자 재계산(현황 모드에선 불필요한 연산 생략).
        map.on('moveend', function () {
            if (state.mode === 'analysis' && state.source) recomputeGrid(map);
        });
    }

    /**
     * [외부 API] 지도 클릭이 사고정보 레이어(격자 또는 마커)를 눌렀는지 확인한다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨
     * [연계] ← ocean_map.js handleMapClick
     */
    window._accidentInfoTryHandleClick = function (map, evt) {
        if (tryHandleGridClick(map, evt)) return true;
        if (state.mode === 'status' && state.source && clusterLayers[state.source]) {
            if (tryHandleClusterClick(map, evt, state.source, clusterLayers[state.source])) return true;
        }
        // 심판원 검수 레이어(사고정보 15회 연타로 켜짐) — state.source 와 무관하게 항상
        // 켜져 있으면 클릭을 받는다(사용자 확정 2026-08-25: 병합 여부와 무관하게 심판원
        // 데이터 전체를 검수 대상으로 삼음).
        if (TRIBUNAL_REVIEW_ON && tribunalReviewLayer) {
            if (tryHandleClusterClick(map, evt, 'tribunal', tribunalReviewLayer)) return true;
        }
        // 관할서 불일치 검수(20회 연타)는 지도 클릭이 아니라 jurisdiction-walk-panel
        // 의 확인/변경/삭제 버튼으로 진행하는 워크스루 방식이라 여기서 클릭을 받지
        // 않는다(2026-08-26 재설계 — 마커를 직접 찾아 클릭하지 않아도 됨).
        if (bubbleOverlay) bubbleOverlay.setPosition(undefined);
        return false;
    };

    /**
     * oceanMap 이 만들어질 때까지 폴링해 UI를 설치한다.
     * [연계] ← DOMContentLoaded → bindUi() (access_control.js 와 동일 패턴)
     */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) { bindUi(map); return; }
            setTimeout(_try, 250);
        }
        _try();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installWhenReady);
    } else {
        _installWhenReady();
    }
})();
