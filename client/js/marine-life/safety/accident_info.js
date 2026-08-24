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
 *                    OpenLayers(ol.*)
 *  - 서버 API      : GET /accident_ships_hk.json · /accident_persons.json
 *                    (정적, 소스 버튼을 처음 누를 때만 지연 로드 — hazard_rocks.js
 *                    와 동일한 절약 방식)
 *  - 마크업        : index2.html 의 #ocean-accident-toggle-btn(버튼),
 *                    #ocean-accident-wrap/#ocean-accident-popup(소스 선택 팝아웃),
 *                    #ocean-accident-source-list, #ocean-accident-mode-toggle
 *                    (현황/분석 — #ocean-topleft-controls 안, 해양안전 화면이
 *                    빌려 쓰는 해양종합정보 기본맵·안내 버튼 바로 아래),
 *                    #accident-stats-sheet/#accident-stats-body(격자 클릭 시 통계),
 *                    #accident-filter-bar(필터 버튼 4개 — 사고유형/관할서/시간대/계절,
 *                    #ocean-accident-mode-toggle 바로 아래)
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
 *   현황(마커 표출)은 사고유형 필터만, 분석(격자 집계)은 관할서·사고유형·시간대·계절
 *   4개를 전부 지원한다(#ocean-accident-mode-toggle 바로 아래 #accident-filter-bar,
 *   index2.html 정적 마크업 + style.css). 버튼을 누르면 체크박스 다중선택 팝업(관할서·
 *   유형·계절 공용) 또는 시간대 전용 팝업(4시간 간격 프리셋 다중토글 + 임의 범위를
 *   칩으로 추가하는 직접 설정)이 뜨고, 확인을 누르면 버튼 라벨이 "N개 선택"으로
 *   바뀐다. 옵션 목록은 정적 코드표가 아니라 지금 활성 소스(rawFeatures[state.source])
 *   에 실제로 존재하는 값만 건수와 함께 보여준다(0건짜리 선택지를 안 보여주기 위함).
 *   필터는 현황·분석 공용 하나의 상태(passesFilters)로 판정해 마커(applyFiltersToMarkers,
 *   ol.source.Cluster 의 내부 ol.source.Vector features 를 갈아끼움)와 격자(recomputeGrid)
 *   양쪽에 똑같이 적용된다 — 모드를 바꿔도 걸어둔 필터가 유지된다. person 소스는 발생시각
 *   컬럼이 없어 시간대 필터를 통과시킨다(판단 불가를 "해당 없음 취급"하는 기존 원칙과 동일).
 *   특보발표여부 필터는 이번 범위에서 뺐다 — 원본 특보 CSV(FCT_WRN)의 구역명 체계가
 *   특보구역 폴리곤(`client/assets/warn_zones.geojson`)의 44개 구역명과 안 맞고(CSV는
 *   더 뭉뚱그린 이름을 쓰며 시기별로도 표기가 섞여 있음), CSV 문안 파싱·구역명 매칭표
 *   작성·좌표→구역 판정(점-폴리곤)·시간대 매칭까지 4단계가 더 필요해 나머지 4개 필터보다
 *   훨씬 큰 별도 작업이라 사용자와 합의해 뒤로 미뤘다. [사용자 확정 규칙(2026-08-24) —
 *   나중에 구현할 때 그대로 적용]
 *   ① 부모 구역명(예: "동해남부먼바다")이 CSV에 나오면, 그 밑의 4개 세부 구역(예:
 *      "동해남부 남쪽/북쪽 × 안쪽/바깥먼바다") + 그 세부 구역 안의 자식해역(
 *      `warn_zones_sub.geojson`, 49개, COASTAL_MAPPING 이 자식↔부모 대응표를 이미
 *      갖고 있음 — ocean_warn_active2.js `_ensureSubToParent` 참고)까지 전부 발효로
 *      본다.
 *   ② CSV 표기 자체가 이미 일관된 규칙이었다(뭉뚱그림↔잘게쪼갬이 무작위로 섞인 게
 *      아니라) — 구역 "전체"가 발효되면 큰(부모) 이름을, 전체가 아니라 일부만
 *      발효되면 작은(자식) 이름을 그대로 쓴다. 그러니 별도 시기별 체계 변경 가정은
 *      필요 없고, ①의 부모→자식 전개 규칙만 있으면 된다.
 *   ③ 강풍·대설·호우·한파·폭염·건조·황사·폭풍해일처럼 육상 지명(도 단위)이 섞여 나오는
 *      건 데이터가 "통보문" 단위(여러 특보 종류를 한 문서에 같이 발표)로 뭉쳐 있어서다
 *      — 오류 아님, 사고 매칭 대상(해상 특보: 태풍·풍랑, 향후 강풍)이 아닌 것들은
 *      그냥 걸러내고 무시하면 된다.
 *   ④ 한 항목 텍스트에 구역 여러 개가 "."·"/" 로 뭉쳐 나오는 건 지방기상청별 관할
 *      구역이 섞여 있어서다 — 파싱 시 이 구분자로 분리하는 규칙을 적용해야 한다.
 *   [남은 일] 강풍 특보 데이터·강풍 특보구역 폴리곤은 아직 미제공(사용자가 추후 전달
 *   예정) — 인명사고(강풍까지 포함) 매칭은 그거 받은 뒤에나 가능. 선박사고(태풍·풍랑만)
 *   는 지금 있는 44개 폴리곤 + 위 규칙만으로 시작할 수 있다.
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

    /**
     * [필터 — 사고유형/관할서/시간대/계절(2026-08-24 사용자 확정)] 현황(마커 표출)·
     * 분석(격자 집계) 양쪽에 공통으로 적용되는 필터 상태. 각 값이 null 이면 "전체"
     * (필터 없음), Set/Array 가 있으면 그 안에 든 것만 통과. 특보발표여부 필터는
     * 별도 단계로 보류(원본 특보 CSV·특보구역 폴리곤 간 구역명 체계가 달라 매칭표를
     * 새로 만들어야 하는 훨씬 큰 작업이라 사용자와 합의해 뒤로 미룸).
     *   - types      : Set<typeCode> | null — 사고유형(ACDNT_TYPE_CD)
     *   - orgs       : Set<orgCd>    | null — 관할해경서
     *   - hourRanges : [[startHour,endHour), ...] | null — 시간대(발생시각 hm 기준,
     *                  endHour 는 미포함이라 [0,4)=00~03시대). person 소스는 hm 컬럼이
     *                  없어(발생시각 정보 없음) 이 필터를 통과시킨다(숨기지 않음 —
     *                  판단 불가를 "해당 없음 취급"으로 처리, findCoordOutliers 등
     *                  기존 필터들과 같은 원칙).
     *   - seasons    : Set<'spring'|'summer'|'fall'|'winter'> | null — ymd 월 기준
     */
    var filters = { types: null, orgs: null, hourRanges: null, seasons: null };

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

    /**
     * 현재 filters 상태를 기준으로 이 행이 통과하는지 — 현황(마커)·분석(격자) 양쪽이
     * 공유하는 단일 판정 함수. 판단 불가(해당 컬럼이 그 소스에 아예 없음/빈 값)한
     * 축은 막지 않고 통과시킨다.
     * @param {string} key - 'hk' | 'person'
     * @param {Array} row
     * @returns {boolean}
     */
    function passesFilters(key, row) {
        if (filters.types && !filters.types.has(typeCodeOf(key, row))) return false;
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
        return true;
    }

    /** 필터에 걸려있는 게 하나라도 있는지 — 필터바 버튼 강조 등에 씀. */
    function hasActiveFilters() {
        return !!(filters.types || filters.orgs || filters.hourRanges || filters.seasons);
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
    var flaggedItems = new Map(); // "key:origIndex" -> {key, idx, row}
    var flagLayer = null;         // 빨간 테두리 오버레이(소스 무관 공용)

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
            return [
                ['사고발생일', formatYmd(row[2]) + (row[3] ? ' ' + row[3] : '')],
                ['사고유형', accidentLabel(ACCIDENT_TYPE_LABELS, row[5])],
                ['위치', row[4] || '-'],
                ['관할', accidentLabel(ACCIDENT_ORG_LABELS, row[8])]
            ];
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

    /** 검수 모드 목록에 보여줄 한 줄 요약(popupRowsFor 와 같은 컬럼을 재사용). */
    function reviewLabelFor(key, row) {
        if (key === 'hk') return formatYmd(row[2]) + ' · ' + (row[4] || accidentLabel(ACCIDENT_TYPE_LABELS, row[5]));
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
                (out[item.key] || (out[item.key] = [])).push(item.idx);
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
            label.textContent = '[' + item.key + '] ' + reviewLabelFor(item.key, item.row);
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
    function yearOf(key, row) {
        var raw = row[2]; // OCRN_YMD(문자열)
        return (raw && String(raw).length >= 4) ? parseInt(String(raw).slice(0, 4), 10) : null;
    }

    function yearHistogram(key, members) {
        var counts = {};
        members.forEach(function (f) {
            var y = yearOf(key, f.get('row'));
            if (!y) return;
            counts[y] = (counts[y] || 0) + 1;
        });
        return Object.keys(counts).map(Number).sort(function (a, b) { return a - b; })
            .map(function (y) { return [y, counts[y]]; });
    }

    /** person 은 발생 시각 컬럼이 없어 주/야간을 집계할 수 없다 — null 반환. */
    function dayNightCounts(key, members) {
        if (key === 'person') return null;
        var day = 0, night = 0;
        members.forEach(function (f) {
            var row = f.get('row');
            if (accidentIsDaytimeFromHM(row[3])) day++; else night++;
        });
        return { day: day, night: night };
    }

    /** "사고발생상세" 탭 구성 — 소스마다 실제 CSV 에 있는 컬럼만큼만 보여준다. */
    function detailTabsFor(key) {
        if (key === 'hk') return ['발생유형', '발생원인', '선박종류'];
        return ['사고유형'];
    }

    function aggregateCounts(members, getter, labelTable) {
        var counts = {};
        members.forEach(function (f) {
            var label = accidentLabel(labelTable, getter(f.get('row')));
            counts[label] = (counts[label] || 0) + 1;
        });
        return Object.keys(counts).map(function (label) { return [label, counts[label]]; })
            .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6); // 상위 6개만
    }

    function detailDataFor(key, tab, members) {
        if (key === 'hk') {
            if (tab === '발생유형') return aggregateCounts(members, function (r) { return r[5]; }, ACCIDENT_TYPE_LABELS);
            if (tab === '발생원인') return aggregateCounts(members, function (r) { return r[6]; }, ACCIDENT_CAUSE_LABELS);
            return aggregateCounts(members, function (r) { return r[7]; }, ACCIDENT_SHIP_KIND_LABELS);
        }
        return aggregateCounts(members, function (r) { return r[4]; }, ACCIDENT_TYPE_LABELS);
    }

    function buildStatsHtml(key, members) {
        var years = yearHistogram(key, members);
        var maxY = Math.max.apply(null, years.map(function (y) { return y[1]; }).concat([1]));
        var sparkBars = years.map(function (y) {
            return '<i style="height:' + Math.max(6, Math.round(y[1] / maxY * 100)) + '%" title="' + y[0] + ': ' + y[1] + '건"></i>';
        }).join('');
        var yearLabel = years.length ? (years[0][0] + '~' + years[years.length - 1][0]) : '-';

        var dn = dayNightCounts(key, members);
        var dnHtml;
        if (dn) {
            var total = (dn.day + dn.night) || 1;
            var dayPct = Math.round(dn.day / total * 100);
            dnHtml = '<div class="accident-stats-block"><div class="accident-stats-label">주/야간별 (06~18시 근사)</div>' +
                '<div class="accident-daynight">' +
                '<div class="accident-dn-bar"><div class="track"><div class="fill day" style="width:' + dayPct + '%"></div></div><div class="meta">주간 <b>' + dn.day + '</b></div></div>' +
                '<div class="accident-dn-bar"><div class="track"><div class="fill night" style="width:' + (100 - dayPct) + '%"></div></div><div class="meta">야간 <b>' + dn.night + '</b></div></div>' +
                '</div></div>';
        } else {
            dnHtml = '<div class="accident-stats-block"><div class="accident-stats-label">주/야간별</div>' +
                '<div class="accident-stats-empty">이 데이터엔 발생 시각 정보가 없습니다.</div></div>';
        }

        var tabs = detailTabsFor(key);
        if (!_activeDetailTab[key] || tabs.indexOf(_activeDetailTab[key]) === -1) _activeDetailTab[key] = tabs[0];
        var activeTab = _activeDetailTab[key];
        var detailItems = detailDataFor(key, activeTab, members);
        var maxDetail = Math.max.apply(null, detailItems.map(function (d) { return d[1]; }).concat([1]));
        var barsHtml = detailItems.map(function (d) {
            return '<div class="accident-bar-row"><span class="name">' + escapeHtml(d[0]) + '</span>' +
                '<span class="track"><span class="fill" style="width:' + Math.round(d[1] / maxDetail * 100) + '%"></span></span>' +
                '<span class="n">' + d[1] + '</span></div>';
        }).join('');
        var tabsHtml = tabs.map(function (t) {
            return '<button class="accident-detail-tab' + (t === activeTab ? ' active' : '') + '" data-tab="' + t + '">' + t + '</button>';
        }).join('');

        return '<h3>그리드형 사고분석 <span class="cellcount">' + members.length + '건</span></h3>' +
            '<div class="accident-stats-block"><div class="accident-stats-label">연도별 사고현황 (' + yearLabel + ')</div>' +
            '<div class="accident-spark">' + sparkBars + '</div></div>' +
            dnHtml +
            '<div class="accident-stats-block"><div class="accident-stats-label">사고발생상세</div>' +
            '<div class="accident-detail-tabs">' + tabsHtml + '</div>' + barsHtml + '</div>';
    }

    function renderStatsBody() {
        var body = document.getElementById('accident-stats-body');
        if (!body || !_statsKey || !_statsMembers) return;
        body.innerHTML = buildStatsHtml(_statsKey, _statsMembers);
    }

    function openStatsSheet(key, members) {
        var sheet = document.getElementById('accident-stats-sheet');
        if (!sheet) return;
        _statsKey = key;
        _statsMembers = members;
        renderStatsBody();
        sheet.classList.add('open');
    }

    function closeStatsSheet() {
        var sheet = document.getElementById('accident-stats-sheet');
        if (sheet) sheet.classList.remove('open');
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

    // ── 필터 바 + 팝업(사고유형·관할서·시간대·계절, 2026-08-24 사용자 확정) ──────
    // [연계] 마크업 index2.html #accident-filter-bar(정적, 버튼 4개) · CSS style.css
    //   ".accident-filter-*" · 적용 대상 applyFiltersToMarkers()·recomputeGrid()

    var HOUR_PRESETS = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24]];
    function hourPresetLabel(r) { return pad2(r[0]) + '~' + pad2(r[1] === 24 ? 0 : r[1]) + '시'; }

    /** 현재 활성 소스(rawFeatures[state.source])에서 실제 존재하는 값만 옵션으로 뽑는다
     * — 0건짜리 선택지를 안 보여주기 위함. count 는 필터 다른 축은 무시하고 이 축만
     * 단독으로 셌을 때의 건수(다른 필터와 조합했을 때의 정확한 교집합 수는 아님 —
     * 체크박스 목록에서 "대략 몇 건인지" 참고용). */
    function buildValueOptions(getValue, labelTable) {
        var key = state.source;
        var feats = (key && rawFeatures[key]) || [];
        var counts = {}; // value -> count
        feats.forEach(function (f) {
            var v = getValue(f.get('row'));
            if (v == null) return;
            counts[v] = (counts[v] || 0) + 1;
        });
        return Object.keys(counts).map(function (vStr) {
            // 코드가 숫자(orgCd·typeCode 는 문자열, orgCd 만 숫자 — Object 키는 항상 문자열이라 되돌린다)
            var v = /^-?\d+$/.test(vStr) ? Number(vStr) : vStr;
            return { value: v, label: accidentLabel(labelTable, v), count: counts[vStr] };
        }).sort(function (a, b) { return b.count - a.count; });
    }

    function buildTypeOptions() { return buildValueOptions(function (r) { return typeCodeOf(state.source, r); }, ACCIDENT_TYPE_LABELS); }
    function buildOrgOptions() { return buildValueOptions(function (r) { return r[ORG_POS_IDX[state.source]]; }, ACCIDENT_ORG_LABELS); }

    // ── 팝업 셸(체크박스 목록·시간대 전용 몸통 공용) ──
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
            '<button type="button" id="afp-reset">전체 해제</button>' +
            '<button type="button" class="primary" id="afp-confirm">확인</button>' +
            '</div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFilterPopup(); });
        document.getElementById('afp-close').addEventListener('click', closeFilterPopup);
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
     * 체크박스 다중선택 팝업(관할서·사고유형·계절 공용).
     * @param {string} title
     * @param {Array<{value, label, count}>} options
     * @param {Set|null} currentSelected - null 이면 "전체"(체크박스 전부 해제 상태로 시작)
     * @param {function(Set|null)} onConfirm - 확인 눌렀을 때, 하나도 안 골랐으면 null(전체)로 넘김
     */
    function openCheckboxFilterPopup(title, options, currentSelected, onConfirm) {
        var els = ensureFilterPopup();
        els.title.textContent = title;
        els.count.textContent = options.length + '개 항목';
        var selected = new Set(currentSelected || []);
        if (!options.length) {
            els.body.innerHTML = '<div class="accident-filter-empty">지금 불러온 데이터에 표시할 항목이 없습니다.</div>';
        } else {
            els.body.innerHTML = options.map(function (o, i) {
                var checked = selected.has(o.value) ? ' checked' : '';
                return '<label class="accident-filter-check-row"><input type="checkbox" data-i="' + i + '"' + checked + '>' +
                    '<span class="label">' + escapeHtml(o.label) + '</span><span class="n">' + o.count + '건</span></label>';
            }).join('');
        }
        var checkboxes = els.body.querySelectorAll('input[type="checkbox"]');
        Array.prototype.forEach.call(checkboxes, function (cb) {
            cb.addEventListener('change', function () {
                var o = options[Number(cb.dataset.i)];
                if (cb.checked) selected.add(o.value); else selected.delete(o.value);
            });
        });
        els.resetBtn.onclick = function () {
            selected.clear();
            Array.prototype.forEach.call(checkboxes, function (cb) { cb.checked = false; });
        };
        els.confirmBtn.onclick = function () {
            onConfirm(selected.size ? selected : null);
            closeFilterPopup();
        };
        els.overlay.style.display = 'flex';
    }

    /**
     * 시간대 팝업 — 4시간 간격 프리셋(다중 토글) + 직접 설정(임의 범위 추가, 칩으로 표시).
     * @param {Array<[number,number]>|null} current
     * @param {function(Array<[number,number]>|null)} onConfirm
     */
    function openHourRangeFilterPopup(current, onConfirm) {
        var els = ensureFilterPopup();
        els.title.textContent = '시간대';
        els.count.textContent = '';
        var ranges = (current || []).slice(); // 작업용 사본

        function isPresetActive(preset) {
            return ranges.some(function (r) { return r[0] === preset[0] && r[1] === preset[1]; });
        }
        function togglePreset(preset) {
            var idx = ranges.findIndex(function (r) { return r[0] === preset[0] && r[1] === preset[1]; });
            if (idx >= 0) ranges.splice(idx, 1); else ranges.push(preset.slice());
        }
        function isCustomRange(r) { return !HOUR_PRESETS.some(function (p) { return p[0] === r[0] && p[1] === r[1]; }); }

        function render() {
            var presetsHtml = HOUR_PRESETS.map(function (p, i) {
                return '<button type="button" class="accident-filter-hour-preset' + (isPresetActive(p) ? ' active' : '') +
                    '" data-preset-i="' + i + '">' + hourPresetLabel(p) + '</button>';
            }).join('');
            var customRanges = ranges.filter(isCustomRange);
            var chipsHtml = customRanges.length ? customRanges.map(function (r, i) {
                return '<span class="accident-filter-hour-chip">' + hourPresetLabel(r) +
                    '<button type="button" data-custom-i="' + i + '">&times;</button></span>';
            }).join('') : '<span style="color:var(--text-sub);font-size:0.76rem;">추가된 범위 없음</span>';
            els.body.innerHTML =
                '<div class="accident-filter-hour-presets">' + presetsHtml + '</div>' +
                '<div class="accident-filter-hour-custom">' +
                '<div class="accident-filter-hour-custom-label">직접 설정</div>' +
                '<div class="accident-filter-hour-custom-row">' +
                '<input type="time" id="afp-hour-start" value="09:00">' +
                '<span>~</span>' +
                '<input type="time" id="afp-hour-end" value="18:00">' +
                '<button type="button" id="afp-hour-add">추가</button>' +
                '</div>' +
                '<div class="accident-filter-hour-chips">' + chipsHtml + '</div>' +
                '</div>';
            Array.prototype.forEach.call(els.body.querySelectorAll('.accident-filter-hour-preset'), function (btn) {
                btn.addEventListener('click', function () { togglePreset(HOUR_PRESETS[Number(btn.dataset.presetI)]); render(); });
            });
            Array.prototype.forEach.call(els.body.querySelectorAll('[data-custom-i]'), function (btn) {
                btn.addEventListener('click', function () {
                    var target = customRanges[Number(btn.dataset.customI)];
                    var idx = ranges.indexOf(target);
                    if (idx >= 0) ranges.splice(idx, 1);
                    render();
                });
            });
            document.getElementById('afp-hour-add').addEventListener('click', function () {
                var startVal = document.getElementById('afp-hour-start').value;
                var endVal = document.getElementById('afp-hour-end').value;
                var start = startVal ? parseInt(startVal.split(':')[0], 10) : NaN;
                var end = endVal ? parseInt(endVal.split(':')[0], 10) : NaN;
                if (isNaN(start) || isNaN(end) || start >= end) {
                    window.alert('시작 시각이 종료 시각보다 빨라야 합니다.');
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

    /** 필터 버튼 라벨을 지금 filters 상태에 맞춰 갱신("전체" 또는 "N개 선택"). */
    function updateFilterButtonLabel(filterKey, prefix) {
        var btn = document.getElementById('accident-filter-btn-' + filterKey);
        if (!btn) return;
        var val = filters[filterKey];
        var n = val ? val.size != null ? val.size : val.length : 0;
        btn.textContent = prefix + ': ' + (n ? n + '개 선택' : '전체');
        btn.classList.toggle('has-selection', n > 0);
    }

    function updateAllFilterButtonLabels() {
        updateFilterButtonLabel('types', '사고유형');
        updateFilterButtonLabel('orgs', '관할서');
        updateFilterButtonLabel('hourRanges', '시간대');
        updateFilterButtonLabel('seasons', '계절');
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
        var bar = document.getElementById('accident-filter-bar');
        if (bar) bar.style.display = show ? 'flex' : 'none';
        if (show) positionFilterBar();
    }

    /** 모드에 따라 관할서·시간대·계절 버튼을 숨기고(현황) 다시 보인다(분석) — 사고유형은 항상 노출. */
    function updateFilterBarModeVisibility() {
        var bar = document.getElementById('accident-filter-bar');
        if (!bar) return;
        Array.prototype.forEach.call(bar.querySelectorAll('[data-mode-only]'), function (btn) {
            btn.style.display = (btn.dataset.modeOnly === state.mode) ? 'block' : 'none';
        });
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
                openCheckboxFilterPopup('관할서', buildOrgOptions(), filters.orgs, function (sel) {
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
                    var count = feats.filter(function (f) { return seasonOf(f.get('row')[2]) === s; }).length;
                    return { value: s, label: SEASON_LABELS[s], count: count };
                });
                openCheckboxFilterPopup('계절', seasonOptions, filters.seasons, function (sel) {
                    filters.seasons = sel;
                    onFiltersChanged(map);
                });
            }
        });
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
                if (REVIEW_MODE) return;
                _reviewModeTapCount++;
                clearTimeout(_reviewModeTapTimer);
                _reviewModeTapTimer = setTimeout(function () { _reviewModeTapCount = 0; }, REVIEW_MODE_TAP_RESET_MS);
                if (_reviewModeTapCount < REVIEW_MODE_TAP_THRESHOLD) return;
                _reviewModeTapCount = 0;
                REVIEW_MODE = true;
                ensureReviewPanel();
            });
        }

        var modeToggle = document.getElementById('ocean-accident-mode-toggle');
        if (modeToggle) {
            modeToggle.addEventListener('click', function (e) {
                var btn = e.target.closest('button');
                if (!btn) return;
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

        // "사고발생상세" 탭 전환 — 바텀시트 본문은 매번 다시 그려지므로 delegation.
        var statsBody = document.getElementById('accident-stats-body');
        if (statsBody) {
            statsBody.addEventListener('click', function (e) {
                var btn = e.target.closest('.accident-detail-tab');
                if (!btn || !_statsKey) return;
                _activeDetailTab[_statsKey] = btn.dataset.tab;
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
