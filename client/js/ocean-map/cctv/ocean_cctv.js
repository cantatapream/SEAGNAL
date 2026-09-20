/**
 * ocean_cctv.js
 * ============================================================================
 * [역할]
 *   index2 (종합기상 > 해양종합) 에서 CCTV 기능을 oceanMap 위에 통합하는 모듈.
 *   우측 컨트롤의 "CCTV" 토글 버튼 / 유의사항 버튼 을 바인딩하고,
 *   활성화 시 CCTV 마커 클러스터를 oceanMap 에 표시한다.
 *
 * [왜 index2 전용 별도 모듈인가?]
 *   - index1(index.html) 의 해안CCTV 서브탭은 `cctv2~7.js` 를 그대로 사용하여
 *     독립 OpenLayers 지도(#cctv-map) 로 제공됨. 이 동작은 변함없이 유지.
 *   - index2 에서만 해양종합(oceanMap) 에 CCTV 를 통합하여 하위 탭을 없앰.
 *     이를 위해 기존 cctv*.js 는 건드리지 않고, 이 파일이 oceanMap 대상 전용
 *     로직을 새로 구현.
 *   - 공유 파일: cctv1.js (CCTV_PROVIDERS 데이터) / cctv4.js (showCctvPopup 팝업)
 *
 * [페이지 가드]
 *   index1 에서도 이 파일이 실수로 로드될 경우를 대비해 최상위에서
 *   `window.__SEAGNAL_PAGE === 'index2'` 가 아니면 전체 스킵.
 *
 * [연계]
 *   - index2.html
 *     · #ocean-cctv-toggle-btn   : CCTV 토글 버튼 (기상부이 아래)
 *     · #ocean-cctv-notice-btn   : 유의사항 버튼 (내위치 아래, CCTV ON 시만 표시)
 *     · #cctv-modal-backdrop     : CCTV 영상 팝업 컨테이너 (cctv4.js 가 채움)
 *   - js/cctv1.js  window.CCTV_PROVIDERS — 지점 데이터
 *   - js/cctv4.js  window.showCctvPopup  — 영상 팝업
 *   - js/ocean_map.js window.getOceanMap() — oceanMap 인스턴스 조회
 *
 * [index1 무영향]
 *   - 기존 cctv1~7.js 코드 수정 없음
 *   - index1 의 #cctv-section / cctvMap / CctvFavorites 그대로 동작
 *   - localStorage 키도 분리 (index1 은 cctv_favorites_v1, index2 는 후속
 *     그룹에서 별도 키 도입 예정)
 * ============================================================================
 */
(function () {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // 페이지 가드: index2 에서만 동작
    // ──────────────────────────────────────────────────────────────
    if (window.__SEAGNAL_PAGE !== 'index2') return;

    // ──────────────────────────────────────────────────────────────
    // 모듈 전역 상태
    // ──────────────────────────────────────────────────────────────
    /** CCTV 마커 레이어 (최초 CCTV ON 시 생성) — 격자 샘플링 결과만 들어감 */
    var _cctvLayer = null;
    /** 샘플링 결과를 받는 표시 소스 */
    var _cctvDisplaySource = null;
    /** CCTV 전체 후보 피처 (1회 생성 후 재사용) */
    var _cctvAllFeatures = null;
    /** CCTV 토글 활성 상태 (true 면 마커 표시 중) */
    var _cctvActive = false;
    /** click/pointermove 리스너 바인딩 여부 (1회) */
    var _mapHooksBound = false;

    // ──────────────────────────────────────────────────────────────
    // 안내사항 팝업(ⓘ) — 탭별 본문 정의
    //   지도 좌측 상단 #ocean-info-btn 클릭 시 showSeagnalModal 로 표시.
    //   7개 탭을 한 HTML 문자열로 조합(상단 탭바 + 각 패널).
    // ──────────────────────────────────────────────────────────────
    // [구조] 각 항목은 body(일반 텍스트) 또는 bodyHtml(서식 포함) 로 본문을,
    //        src 로 데이터 출처를 정의한다. _buildInfoHtml 이 src 를 본문 "맨 하단"에
    //        구분선과 함께 작은 글씨(.ocean-info-src)로 자동 부착한다.
    //        (출처가 없는 순수 지도 조작 기능 — 위치 검색·진북 정렬 — 은 src 생략)
    // [탭 순서] 지도 조작(지도 종류·위치 검색·진북 정렬) → 오버레이 버튼 순서 그대로
    //   (풍향·풍속 → 유향·유속 → 파고·파향 → 기상부이 → 해구기상 → 특보구역 → 천기)
    //   → 지도를 눌러 보는 정보(수심·조석). 화면 버튼 순서와 어긋나지 않게 맞춘다.
    // [탭이 곧 그 화면의 버튼이다 — 2026-09-09 사용자 확정]
    //   이 화면에 버튼이 없는 기능은 탭으로 두지 않는다. 그래서 아래 7개를 뺐다:
    //     주요지명·내 위치(버튼이 화면에서 제거됨) · 물빠짐·CCTV·노출암간출암(해양안전 전용으로
    //     옮겨져 이 화면에서는 숨김) · 특보 ON/OFF(별도 버튼이 아니라 특보구역에 딸린
    //     곁가지라 특보구역 탭으로 합침) · 시정(천기 팝아웃의 7번째 항목이라 천기 탭으로 합침).
    // [적지 않는 것] 태풍 버튼의 "활성 태풍이 없을 때 10회 눌러 잠금 해제"는 숨은 기능이라
    //   태풍 탭 본문에 적지 않는다(탭 자체는 2026-09-09 사용자 지시로 신설).
    var INFO_TAB_ITEMS = [
        { id: 'basemap', label: '지도 종류', body:
            '지도 배경을 바꿉니다. 기본맵·전자해도·해안도는 해양 전용 지도이고, '
          + '세계지도는 먼바다까지 넓게 볼 때 씁니다. 전자해도는 수심·항로 표시에 유용합니다. '
          + '위성지도는 실제 항공·위성 사진이라 항구 시설이나 갯바위 모양을 눈으로 확인할 때 좋고, '
          + '다른 지도보다 더 가깝게 확대됩니다.',
          src: '국립해양조사원 해아름 / OpenStreetMap(세계지도) / 국토교통부 브이월드(위성지도)' },
        { id: 'search', label: '위치 검색', body:
            '항이나 지명을 입력하면(예: 속초항, 제주항) 그 위치로 지도를 옮겨줍니다.' },
        { id: 'northup', label: '진북 정렬', body:
            '지도를 정북(위쪽=북) 방향으로 맞춥니다. 누를 때마다 정렬 → 북쪽 고정 → 자유 회전 순으로 바뀝니다.' },
        { id: 'wind', label: '풍향·풍속', body:
            '바람이 부는 방향과 세기를 보여줍니다. 아이콘을 누르면 시간대별 변화를 볼 수 있습니다. '
          + '오늘부터 75시간(약 3일)을 3시간 간격으로 제공합니다.',
          src: '기상청 지역파랑모델(UM·RWW3)' },
        { id: 'current', label: '유향·유속', body:
            '바닷물이 흐르는 방향과 속도를 보여줍니다. 아이콘을 누르면 시간대별 상세 정보가 열립니다. '
          + '오늘부터 72시간(3일)을 1시간 간격으로, 풍향·풍속·파고보다 더 촘촘하게 확인할 수 있습니다.',
          src: '국립해양조사원 해양수치예측모델(ROMS)' },
        { id: 'wave', label: '파고·파향', body:
            '파도의 높이와 진행 방향을 게이지와 함께 보여줍니다. '
          + '오늘부터 75시간(약 3일)을 3시간 간격으로 제공합니다.',
          src: '기상청 지역파랑모델(UM·RWW3)' },
        { id: 'buoy', label: '기상부이', body:
            '바다에 떠 있는 관측장비(부이)의 실시간(매시간) 관측값을 보여줍니다. '
          + '부이 종류(기상부이·파고부이·등표)에 따라 제공 항목이 다를 수 있습니다.',
          src: '기상청 해양기상부이' },
        // 해구기상[2026-09-09 개편] — 옛 이름 "해구도". 격자만 그리는 기능이 아니라
        //   칸을 두 번 누르면 해구별 기상전망(6항목)이 열리므로 그 내용까지 적는다.
        { id: 'seagrid', label: '해구기상', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> 바다를 <strong>0.5°×0.5° 격자 1,331칸(대해구)</strong>으로 나눠 표시합니다. 확대하면 각 칸을 <strong>3×3으로 나눈 소해구</strong>까지 보입니다 — 소해구 경계는 기상청이 제공하지 않아 앱이 대해구를 균등하게 나눠 그린 것입니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 칸을 <strong>두 번 누르면</strong> 그 해구의 <strong>기상전망</strong>이 열립니다 — <strong>풍향 · 풍속 · 유의파고 · 파향 · 파주기 · 시정</strong> 여섯 가지를 3시간 간격으로 최대 75시간까지, 위쪽 그래프와 아래 표로 보여줍니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 버튼을 켜면 격자가 잘 보이도록 <strong>배경지도가 기본맵으로 자동 전환</strong>되고, 끄면 원래 배경지도로 돌아갑니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>소해구를 눌러도 바람·파도 값은 그 소해구가 속한 대해구 값</strong>입니다. 소해구 단위로 실제 달라지는 것은 <strong>시정</strong>뿐입니다.</p>',
          src: '격자: 기상청 해양기상기후정보포털 해구 격자<br>바람·파도: 기상청 API허브 해상 대해구 예보(하루 2회 09:30·21:30 갱신)<br>시정: 기상청 국지예보모델(RDPS) 시정예측(1시간마다 갱신)' },
        // 특보구역[2026-09-09 개편] — "특보 ON" 은 별도 버튼이 아니라 이 버튼에 딸린
        //   곁가지(같은 .ocean-warn-zone-wrap 안 두 조각)라, 옛 "특보 ON/OFF" 탭을 여기 합쳤다.
        { id: 'warnzone', label: '특보구역', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> 해상 특보가 발표되는 <strong>예보구역 경계선</strong>을 보여줍니다. 앞바다·먼바다 등 <strong>44개 구역</strong>이 노란 점선으로 그려지고, 지도를 충분히 확대하면 <strong>연안바다·평수구역 49개</strong>가 청록 점선으로 더 나타납니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> <strong>지금 발효 중이거나 곧 발효될 특보가 있을 때만</strong>, 이 버튼 왼쪽에 <strong>「특보 ON」</strong> 버튼이 함께 나타납니다. 누르면 특보가 걸린 해역을 색으로 칠해 한눈에 보여줍니다(다시 누르면 「특보 OFF」).</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 색은 <strong>풍랑=초록 · 태풍=빨강</strong> 두 가지이며, 발효 전(발표) → 주의보 → 경보 순으로 진해집니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 「특보 ON」이 켜져 있으면 배경지도가 <strong>해안도</strong>로 자동 전환되고, 색칠된 구역을 누르면 특보 종류·등급·발효 시각·해제 예정 시각을 볼 수 있습니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>강풍·폭풍해일 등 다른 종류는 색칠하지 않습니다.</strong> 그런 특보만 발효 중이면 「특보 ON」 버튼 자체가 나타나지 않습니다(경계선 표시는 그대로 나옵니다).</p>',
          src: '기상청 해양기상정보포털(MMIS) — 예보구역 경계 · 해상 특보(1분마다 갱신)' },
        // 태풍[2026-09-09 신설, 사용자 지시] — 버튼은 화면에 있는데 안내 탭이 없었다.
        //   출처는 사용자 확정: 기상청 방재기상플랫폼(typhoon_crawler.js 가 dmdw.kma.go.kr 에서 수집).
        //   ⚠"활성 태풍이 없을 때 10회 눌러 잠금 해제"는 숨은 기능이라 안내에 적지 않는다.
        { id: 'typhoon', label: '태풍', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> 우리 바다에 영향을 주는 태풍의 <strong>예상 진로</strong>를 지도에 그립니다 — 진로선과 시점별 위치(강도에 따라 색이 다릅니다), <strong>70% 확률반경</strong> 원, 시각 라벨이 함께 표시됩니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> <strong>재생(▶)</strong> 버튼을 누르면 지금 시각부터 예보 시각을 따라 태풍이 이동하는 모습을 볼 수 있고, 슬라이더로 원하는 시점으로 옮길 수도 있습니다. 강풍반경·폭풍반경·확률반경과 강도 색도 함께 변합니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 통보문이 여러 회차 나와 있으면 <strong>회차를 골라</strong> 그때 발표된 예상 진로를 볼 수 있습니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 활동 중인 태풍이 있으면 버튼 오른쪽 위에 <strong>빨간 숫자</strong>로 개수가 표시됩니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>활동 중인 태풍이 없으면 버튼이 회색(비활성)</strong> 입니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 예보 자료입니다. 진로와 반경은 새 통보문이 나올 때마다 바뀌므로, 실제 대비는 기상청 발표를 확인하세요.</p>',
          src: '기상청 방재기상플랫폼 태풍정보(통보문·예상 진로, 10분마다 갱신)' },
        // 천기[2026-09-09 신설] — 버튼은 화면에 있는데 안내 탭이 없었다.
        //   옛 "시정" 탭은 이 팝아웃의 7번째 항목(시정예측)이라 여기로 합쳤다.
        { id: 'otherwx', label: '천기', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> 「천기」를 누르면 왼쪽으로 <strong>7가지</strong>가 펼쳐집니다 — <strong>강수확률 · 강수량 · 적설 · 하늘상태 · 강수형태 · 기온 · 시정예측</strong>.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 하나를 고르면 기상청이 만든 <strong>예보 그림을 지도 위에 겹쳐</strong> 보여주고, 아래에 시간 슬라이더와 재생(▶) 버튼, 색상 범례가 나타납니다. 재생을 누르면 시간에 따라 변하는 모습을 이어서 볼 수 있습니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 지도의 아무 지점이나 누르면 그 지점의 <strong>하늘 상태 · 강수량 · 적설 · 기온 · 시정</strong> 다섯 가지를 작은 상자로 보여줍니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 천기를 켜면 유향·유속, 풍향·풍속, 파고·파향은 자동으로 꺼집니다 — 화면 아래 시간 슬라이더를 함께 쓰기 때문입니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 그림이 덮이는 범위는 <strong>한반도와 그 주변 바다</strong>(동경 123.3~132.9 · 북위 31.6~43.5)입니다. 이 범위 밖을 누르면 값이 나오지 않습니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 값은 예보 그림의 <strong>색을 읽어</strong> 되돌린 것이라 단계 값입니다. 시정이 20km를 넘으면 「20km 이상」으로, 읽을 값이 없으면 「정보 없음」으로 적습니다.</p>',
          src: '기상청 해양기상정보포털(MMIS) 단기예보(강수확률·강수량·적설·하늘상태·강수형태·기온)<br>시정예측 · 기상청 국지예보모델(RDPS)' },
        { id: 'depth', label: '수심', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> <strong>지도에서 해점을 누르면</strong> 아래 정보 시트에 그 지점의 바다 깊이가 표시됩니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 연안에서는 오차가 있을 수 있으니, 정확한 수심은 전자해도로 확인해 주세요.</p>',
          src: '국립해양조사원 수심측량자료(BADA2024)' },
        // 조석[2026-09-09 전면 개편] — 옛 문구("전국을 격자로 나눠 표준항 166곳의 관측값을
        //   반영")는 실제 동작과 달랐다. 실제로는 누른 좌표를 그대로 TideBED 에 넣어
        //   3일치를 받아오고, 표준항 3곳 보간은 동해 북부에서만 돈다.
        { id: 'tide', label: '조석', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> <strong>지도에서 해점을 누르면</strong> 아래 정보 시트에 그 지점의 조석(밀물·썰물의 높이·시각) 예측이 표시됩니다. 고조·저조 시각과 조위, 직전 물때 대비 변화량, 오늘이면 현재 예상 조위와 진행 막대까지 함께 나옵니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> <strong>누른 그 지점의 좌표를 그대로 넣어</strong> 어제·오늘·내일 3일치를 계산합니다. 전국을 격자로 나누거나 표준항 값을 옮겨오는 방식이 아닙니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> <strong>동해 북부(북위 36° 이상이면서 동경 128° 이상)는 예외입니다</strong> — 이 해역은 예측 자료가 제공되지 않아, 가까운 <strong>표준항 3곳</strong>의 연간 조석표를 거리에 따라 가중평균해 계산합니다. 이때만 카드에 <strong>「표준항 보간 결과」</strong> 표시가 붙습니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 바깥 자료를 그때그때 받아오므로 처음 열 때 <strong>3~5초</strong>가 걸릴 수 있고, 같은 지점을 다시 누르면 저장해 둔 값으로 즉시 표시됩니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>하루 15회까지</strong> 조회할 수 있습니다(자정에 초기화).</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 예측값입니다. 실제 조위는 그날의 기상·기압에 따라 달라질 수 있습니다.</p>',
          src: '국립해양조사원 조석예측자료(TideBED, 공공데이터포털)<br>동해 북부 · 연간 조석표(표준항 165곳)' },
        // 기압[2026-09-20 신설] — 우리 해양 자료(기상청·KHOA)에 없는 값이라 OpenWeather 에서 받는다.
        //   ⚠출처 줄은 장식이 아니다: 무료 플랜은 공개 라이선스(ODbL/CC BY-SA)라
        //   「문구 + 링크 + 로고」 세 가지를 보이는 자리에 두는 것이 의무다(OpenWeather FAQ).
        //   카드에도 이름을 함께 적어 자료가 보이는 자리마다 출처가 따라가게 했다.
        { id: 'pressure', label: '기압', bodyHtml:
            '<p><i class="fa-solid fa-circle-check"></i> <strong>지도에서 해점을 누르면</strong> 아래 정보 시트에 그 지점의 기압이 표시됩니다. 단위는 <strong>헥토파스칼(hPa)</strong> 이며, 맑은 날 바다에서는 보통 <strong>1010~1020</strong> 사이입니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 바다 높이(해수면)를 기준으로 맞춘 <strong>해면기압</strong>이라, <strong>일기도의 등압선이나 태풍 중심기압과 그대로 비교</strong>하실 수 있습니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 시트 아래 <strong>시간 슬라이더를 옮기면 그 시각의 기압</strong>을 보여줍니다. <strong>3시간 간격으로 최대 5일 뒤까지</strong> 볼 수 있습니다.</p>'
          + '<p><i class="fa-solid fa-circle-check"></i> 기압이 <strong>빠르게 내려가면</strong> 날씨가 나빠지는 쪽, <strong>올라가면</strong> 좋아지는 쪽 신호로 봅니다. 다만 기압만 보고 판단하지 마시고 바람·파도와 함께 보세요.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>지나간 시각의 기압은 제공하지 않습니다.</strong> 날짜를 뒤로 넘기면 기압 카드가 나오지 않습니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> <strong>5일 뒤까지만</strong> 제공됩니다. 그보다 먼 날짜에서도 기압 카드가 나오지 않습니다.</p>'
          + '<p><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 지금 시각의 값은 관측을 바탕으로 한 것이고, 앞으로의 값은 <strong>예보</strong>입니다. 바깥 자료를 받아오는 기능이라 자료를 받지 못하면 카드가 잠시 나오지 않을 수 있습니다.</p>',
          src: '<img src="/images/openweather_logo.png" alt="OpenWeather" '
             + 'style="height:28px;width:auto;display:block;margin:0 0 4px;">'
             + 'Weather data provided by <a href="https://openweathermap.org/" target="_blank" rel="noopener">OpenWeather</a><br>'
             + '현재 날씨(관측 기반) · 3시간 간격 5일 예보' }
    ];

    /** 탭바 + 패널 HTML 문자열 생성 */
    function _buildInfoHtml() {
        var tabsHtml = '<div class="ocean-info-tabs">';
        var panelsHtml = '<div class="ocean-info-panels">';
        for (var i = 0; i < INFO_TAB_ITEMS.length; i++) {
            var it = INFO_TAB_ITEMS[i];
            var activeCls = (i === 0) ? ' active' : '';
            tabsHtml += '<button type="button" class="ocean-info-tab-btn' + activeCls
                      + '" data-info-tab="' + it.id + '" '
                      + 'onclick="window.__oceanInfoSwitch(\'' + it.id + '\')">' + it.label + '</button>';
            var inner = it.bodyHtml || ('<p>' + it.body + '</p>');
            // 출처(src)는 본문 맨 하단에 구분선 + 작은 글씨로 부착. (없으면 생략)
            if (it.src) {
                inner += '<div class="ocean-info-src">출처 · ' + it.src + '</div>';
            }
            panelsHtml += '<div class="ocean-info-panel' + activeCls + '" data-info-panel="' + it.id + '">'
                        + inner + '</div>';
        }
        tabsHtml += '</div>';
        panelsHtml += '</div>';
        return tabsHtml + panelsHtml;
    }

    /**
     * [외부 API] 안내 탭 하나의 본문 HTML 을 돌려준다.
     * 예: window.oceanInfoTabHtml('mudflat') → 물빠짐 설명 문단들 + 출처 줄
     * @param {string} id - 탭 id (예: 'mudflat')
     * @returns {string} 본문 HTML (해당 탭이 없으면 빈 문자열)
     * [연계] 예전에는 js/marine-life/safety/life_safety.js 가 물빠짐·CCTV·노출암간출암
     *   본문을 이 함수로 가져다 썼는데, 2026-09-09 개편으로 **해양안전 안내가 자기 화면에
     *   맞는 문구를 따로 갖게 되어** 현재 호출부가 없다. 전역 함수를 지우면 V4 시뮬레이션의
     *   "사라진 전역함수" 검사에 걸리므로 그대로 남겨 둔다(다른 화면이 다시 쓸 수 있다).
     */
    window.oceanInfoTabHtml = function (id) {
        for (var i = 0; i < INFO_TAB_ITEMS.length; i++) {
            var it = INFO_TAB_ITEMS[i];
            if (it.id !== id) continue;
            var html = it.bodyHtml || ('<p>' + it.body + '</p>');
            if (it.src) html += '<div class="ocean-info-src">출처 · ' + it.src + '</div>';
            return html;
        }
        return '';
    };

    // 탭 전환 — showSeagnalModal 본문 내 onclick 에서 호출
    window.__oceanInfoSwitch = function (tabId) {
        var tabs = document.querySelectorAll('.ocean-info-tab-btn');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-info-tab') === tabId);
        }
        var panels = document.querySelectorAll('.ocean-info-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.toggle('active', panels[j].getAttribute('data-info-panel') === tabId);
        }
    };

    // ──────────────────────────────────────────────────────────────
    // 단일 CCTV 마커 스타일
    // ──────────────────────────────────────────────────────────────
    //
    // [변경 — 클러스터 제거]
    //  종전: ol.source.Cluster + 숫자 원형 클러스터 스타일(2,9,18…)
    //  신규: 격자 샘플링이 단일 피처만 표시 → 클러스터 스타일/색상 헬퍼 모두 제거.
    //  Feature 는 ocean_buoy.js 의 OceanGridSampler 가 직접 전달하므로
    //  feature.get('features') 같은 cluster 래핑 없음.
    function _buildSingleStyle(feature) {
        var name = feature.get('name') || '';
        return [
            // [모바일 히트 영역 확장]
            // CCTV 아이콘(scale 0.07)이 작고 투명 픽셀이 많아 손가락 탭 hit 실패 방지용
            // 거의 보이지 않는(alpha 0.02) 원을 깔아둠.
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 38,
                    fill: new ol.style.Fill({ color: 'rgba(0,0,0,0.02)' })
                })
            }),
            new ol.style.Style({
                image: new ol.style.Icon({
                    src: '/images/cctv_image.png',
                    anchor: [0.5, 1.0],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    scale: 0.07
                }),
                text: new ol.style.Text({
                    text: name,
                    font: '600 11px "Noto Sans KR", sans-serif',
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                    offsetY: -24
                })
            })
        ];
    }

    // ──────────────────────────────────────────────────────────────
    // CCTV 데이터 → ol.Feature 배열
    // ──────────────────────────────────────────────────────────────
    /**
     * window.CCTV_PROVIDERS 구조를 순회하여 각 CCTV 지점을 ol.Feature 로 변환.
     *
     * [데이터 구조 (cctv1.js 기준)]
     *   CCTV_PROVIDERS[providerKey] = {
     *     type:     'iframe' | 'hls',
     *     name:     기관명,
     *     shareUrl: fn(cctvId, item),  (iframe 전용)
     *     streamUrl: fn(cctvId),       (hls 전용)
     *     items:    [ { cctvId, name, subtitle, lat(str), lng(str), ... } ]
     *   }
     *
     * [Feature 속성]
     *   cctv3.js 와 동일 스키마로 저장해 showCctvPopup(data) 에 바로 전달 가능.
     */
    function _buildFeatures() {
        var providers = window.CCTV_PROVIDERS;
        if (!providers) return [];
        var features = [];
        var keys = Object.keys(providers);
        for (var i = 0; i < keys.length; i++) {
            var providerKey = keys[i];
            var provider = providers[providerKey];
            if (!provider || !provider.items) continue;
            for (var j = 0; j < provider.items.length; j++) {
                var item = provider.items[j];
                var lat = parseFloat(item.lat);
                var lng = parseFloat(item.lng);
                if (isNaN(lat) || isNaN(lng)) continue;

                // coastal 마커는 동일 지점에 다른 provider 가 겹칠 때 살짝 offset
                // (cctv3.js 와 동일 처리)
                if (providerKey === 'coastal') lat += 0.0001;

                var f = new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])),
                    // [격자 샘플링 메타] OceanGridSampler 가 사용
                    _sampleType:  'cctv',
                    _sampleLat:   lat,
                    _sampleLon:   lng,
                    cctvId:       item.cctvId,
                    name:         item.name,
                    subtitle:     item.subtitle,
                    providerKey:  providerKey,
                    providerName: provider.name,
                    cnt:          item.cnt         || '1',
                    sensorName:   item.sensorName  || null,
                    cameraCount:  item.cameraCount || 1,
                    obsName:      item.obsName     || null,
                    shareUrl:  provider.type === 'iframe' ? provider.shareUrl(item.cctvId, item) : null,
                    streamUrl: provider.type === 'hls'    ? provider.streamUrl(item.cctvId)     : null
                });
                features.push(f);
            }
        }
        return features;
    }

    // ──────────────────────────────────────────────────────────────
    // 마커 레이어 생성 (지연 생성: CCTV 버튼 처음 ON 시에만)
    // ──────────────────────────────────────────────────────────────
    //
    // [변경 — 클러스터 제거, 격자 샘플링으로 교체]
    //  종전: ol.source.Cluster 가 가까운 마커를 묶어 숫자 원형 표시 + 줌별 distance 조정.
    //  신규: 표시 소스(_cctvDisplaySource) 는 비어있는 상태로 두고,
    //        window.OceanGridSampler 에 'cctv' 타입을 등록.
    //        부이/주요지점/CCTV 가 같은 격자에서 함께 경쟁하여 골고루 분산됨.
    function _ensureCctvLayer(map) {
        if (_cctvLayer) return _cctvLayer;

        // 표시용 소스 (샘플링된 결과만 들어감)
        _cctvDisplaySource = new ol.source.Vector();

        // 전체 후보 피처는 1회만 만들어 메모리에 보관
        _cctvAllFeatures = _buildFeatures();

        _cctvLayer = new ol.layer.Vector({
            source: _cctvDisplaySource,
            style: _buildSingleStyle,
            zIndex: 100,
            updateWhileAnimating: true,
            updateWhileInteracting: true
        });
        map.addLayer(_cctvLayer);

        // 격자 샘플러에 CCTV 등록 (부이/주요지점과 같은 grid 에서 경쟁)
        if (window.OceanGridSampler && typeof window.OceanGridSampler.register === 'function') {
            window.OceanGridSampler.register({
                type: 'cctv',
                getAll: function () { return _cctvAllFeatures || []; },
                getVisible: function () { return _cctvActive; },
                sink: _cctvDisplaySource
            });
            // attach 는 ocean_buoy.js 가 이미 했지만 안전하게 호출 (idempotent)
            if (typeof window.OceanGridSampler.attach === 'function') {
                window.OceanGridSampler.attach(map);
            }
            window.OceanGridSampler.refresh();
        }

        return _cctvLayer;
    }

    // ──────────────────────────────────────────────────────────────
    // 위치 즐겨찾기 마커 레이어 (★ + 이름 라벨)
    //   - 바텀시트 ⭐ 로 저장한 위치 즐겨찾기를 지도 위에 항상 표시
    //   - CCTV 토글 ON/OFF 와 무관하게 항상 visible
    //   - CCTV 즐겨찾기는 여기 대상이 아님 (하단 바 칩으로만 노출)
    //   - zIndex 150: 부이/CCTV 마커(100) 위, 내 위치 Overlay(200) 아래
    // ──────────────────────────────────────────────────────────────
    var _favLocSrc = null;
    var _favLocLayer = null;

    /**
     * 위치 즐겨찾기 피처 스타일.
     *  - 하단: ★ 금색 텍스트 (검은 아웃라인으로 가독성)
     *  - 상단: 이름 라벨 (부이 라벨과 동일 톤: 금색 폰트 + 검은 테두리)
     */
    function _favLocStyle(feature) {
        var name = feature.get('name') || '';
        return [
            // ★ 아이콘
            new ol.style.Style({
                text: new ol.style.Text({
                    text: '★',
                    font: 'bold 22px "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#fcd34d' }),
                    stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
                    offsetY: 2,
                    textAlign: 'center'
                })
            }),
            // 이름 라벨 (별 위쪽)
            new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: 'bold 12px "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#FDD835' }),
                    stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
                    offsetY: -18,
                    textAlign: 'center'
                })
            })
        ];
    }

    /**
     * 레이어 설치(한 번) + localStorage 기반 초기 피처 반영.
     * 이미 설치돼 있으면 피처만 재렌더.
     */
    function _ensureFavLocLayer(map) {
        if (_favLocLayer) {
            _rerenderFavLocFeatures();
            return _favLocLayer;
        }
        _favLocSrc = new ol.source.Vector();
        _favLocLayer = new ol.layer.Vector({
            source: _favLocSrc,
            style: _favLocStyle,
            zIndex: 150,
            updateWhileAnimating: true,
            updateWhileInteracting: true
        });
        map.addLayer(_favLocLayer);
        _rerenderFavLocFeatures();
        return _favLocLayer;
    }

    /**
     * 위치 즐겨찾기 목록 전체를 읽어 source 를 재구성.
     *  - 최대 3개뿐이라 전체 clear + add 방식이 가장 단순/안전.
     *  - lat/lon (또는 lng) 둘 다 지원.
     */
    function _rerenderFavLocFeatures() {
        if (!_favLocSrc) return;
        _favLocSrc.clear();
        var items = (_favLocation && _favLocation.items) || [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var lat = parseFloat(it.lat);
            var lon = parseFloat(it.lon != null ? it.lon : it.lng);
            if (isNaN(lat) || isNaN(lon)) continue;
            var f = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
                id: it.id,
                name: it.name || '',
                kind: 'location-fav'
            });
            _favLocSrc.addFeature(f);
        }
    }

    /**
     * 지도 준비 시점에 위치 즐겨찾기 레이어 설치.
     * 지도가 만들어질 때까지(사용자가 해양종합정보 탭에 진입할 때까지)
     * 시간 제한 없이 계속 폴링한다. 한 번 설치되면 _try() 가 return 으로 종료.
     */
    function _installFavLocLayerWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureFavLocLayer(map);
                return;
            }
            setTimeout(_try, 250);
        }
        _try();
    }
    _installFavLocLayerWhenReady();

    // ──────────────────────────────────────────────────────────────
    // 지도 클릭 훅 — CCTV 마커 클릭 감지
    // ──────────────────────────────────────────────────────────────
    /**
     * 격자 샘플링된 단일 CCTV 피처 클릭 처리.
     *
     * [변경 — 클러스터 제거]
     *  종전에는 ol.source.Cluster 가 만든 래퍼 피처(features 배열 포함)를
     *  꺼내서, 다중이면 fit()으로 줌인, 단일이면 영상 팝업 표시였음.
     *  격자 샘플링은 단일 피처만 표시하므로 cluster 래퍼/줌인 로직 제거.
     *
     * @returns {boolean} 처리했으면 true (다른 핸들러가 더 처리하지 않도록)
     */
    function _handleCctvClick(map, evt) {
        if (!_cctvActive || !_cctvLayer) return false;

        // 후보 중 가장 가까운 피처 선택 (밀집 구역 오인식 방지)
        var candidates = [];
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer !== _cctvLayer) return;
            var geom = feature.getGeometry();
            if (!geom) return;
            var centerPx = map.getPixelFromCoordinate(geom.getCoordinates());
            if (!centerPx) return;
            var dx = centerPx[0] - evt.pixel[0];
            var dy = centerPx[1] - evt.pixel[1];
            candidates.push({ feature: feature, dist: Math.sqrt(dx * dx + dy * dy) });
        }, { hitTolerance: 30 });  // 모바일 손가락 탭 오차 보정 — CCTV 아이콘이 작아 부이보다 크게 잡음

        if (candidates.length === 0) return false;

        candidates.sort(function (a, b) { return a.dist - b.dist; });
        var f = candidates[0].feature;

        if (typeof window.showCctvPopup === 'function') {
            // [사용량] CCTV 아이콘 클릭으로 팝업이 켜질 때만 +1
            if (window.trackUsage) window.trackUsage('ocean.cctv_open');
            window.showCctvPopup({
                cctvId:       f.get('cctvId'),
                name:         f.get('name'),
                subtitle:     f.get('subtitle'),
                providerKey:  f.get('providerKey'),
                providerName: f.get('providerName'),
                shareUrl:     f.get('shareUrl'),
                streamUrl:    f.get('streamUrl'),
                cnt:          f.get('cnt')        || '1',
                sensorName:   f.get('sensorName') || null,
                cameraCount:  f.get('cameraCount')|| 1,
                obsName:      f.get('obsName')    || null
            });
        }
        return true;
    }

    /**
     * 지도 포인터/커서 관련 훅을 oceanMap 에 바인딩 (1회만).
     *
     * [click 은 여기서 바인딩하지 않음]
     *  ocean_map.js 의 handleMapClick 이 이미 click 리스너를 등록해 두었는데,
     *  여기서 별도 click 리스너를 추가하면 두 핸들러가 동시에 실행되어
     *  "CCTV 마커 클릭 시 바텀시트도 같이 열리는" 문제가 발생.
     *  → click 은 handleMapClick 내부에서 window.oceanCctv.tryHandleMapClick 을
     *    먼저 호출해 CCTV 처리가 끝나면 기존 흐름(부이/마커/바텀시트)을 skip 한다.
     *    (ocean_map.js 가드는 window.oceanCctv 존재 여부 체크 → index1 무영향)
     */
    function _bindMapHooks(map) {
        if (_mapHooksBound) return;
        _mapHooksBound = true;

        // 포인터 호버 시 커서 변경 (CCTV 활성일 때만)
        map.on('pointermove', function (evt) {
            if (!_cctvActive || !_cctvLayer) return;
            var hit = false;
            map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
                if (layer === _cctvLayer) hit = true;
            }, { hitTolerance: 30 });  // click 핸들러와 동일 값 — 커서 hover 와 클릭 영역 일치
            if (hit) {
                var target = map.getTargetElement();
                if (target && target.style.cursor !== 'pointer') target.style.cursor = 'pointer';
            }
            // cursor 해제는 다른 레이어 로직(ocean_markers 등)에 위임하여 간섭 방지
        });
    }

    // ──────────────────────────────────────────────────────────────
    // CCTV 토글 (ON / OFF)
    // ──────────────────────────────────────────────────────────────
    /**
     * CCTV 활성/비활성 전환.
     * @param {boolean} on
     */
    function _setCctvActive(on) {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map) return;

        if (on) {
            var layer = _ensureCctvLayer(map);
            layer.setVisible(true);
            _bindMapHooks(map);
            _cctvActive = true;
            document.body.classList.add('ocean-cctv-on');
            // 토글 상태 변경 → 격자 재샘플링 (CCTV 후보 풀 추가)
            if (window.OceanGridSampler && typeof window.OceanGridSampler.refresh === 'function') {
                window.OceanGridSampler.refresh();
            }
            // [제거됨] 종전 CCTV ON 시만 표출되던 #ocean-cctv-notice-btn 은
            //          상시 노출 #ocean-info-btn (탭형 팝업) 으로 대체됨.
        } else {
            if (_cctvLayer) _cctvLayer.setVisible(false);
            _cctvActive = false;
            // 토글 OFF → 격자 재샘플링 (CCTV 후보 풀 제거 → 부이/지명에 슬롯 양보)
            if (window.OceanGridSampler && typeof window.OceanGridSampler.refresh === 'function') {
                window.OceanGridSampler.refresh();
            }
            document.body.classList.remove('ocean-cctv-on');
            // 열려있던 CCTV 영상 팝업도 함께 닫음 (사용자 요구: CCTV OFF 시 팝업 동기 닫힘)
            if (typeof window.closeCctvPopup === 'function') {
                window.closeCctvPopup();
            } else {
                // closeCctvPopup 이 export 되지 않았을 경우의 폴백: 백드롭 직접 닫기
                var backdrop = document.getElementById('cctv-modal-backdrop');
                if (backdrop) {
                    backdrop.style.display = 'none';
                    backdrop.innerHTML = '';
                }
            }
        }

        // 버튼 시각 상태 갱신
        var toggleBtn = document.getElementById('ocean-cctv-toggle-btn');
        if (toggleBtn) toggleBtn.classList.toggle('active', _cctvActive);

        // 하단 즐겨찾기 바 내용 전환 (CCTV ↔ 위치)
        _renderFavBar();
    }

    // ──────────────────────────────────────────────────────────────
    // 안내사항 팝업 — 탭 목록 (유향·유속 / 풍향·풍속 / 파고·파향 / 부이 /
    //                       수심 / 조석 / 물빠짐 / CCTV 등)
    //   지도 좌측 상단 #ocean-info-btn 클릭 시 호출.
    //   showSeagnalModal 은 (title, htmlBody, type) 을 받으므로 본문 전체를
    //   단일 HTML 문자열로 조합하여 전달. 탭 전환은 본문 내부 onclick 에서
    //   window.__oceanInfoSwitch(id) 호출 → 패널 display 토글.
    // ──────────────────────────────────────────────────────────────
    function _openNoticePopup() {
        if (typeof window.showSeagnalModal !== 'function') return;
        window.showSeagnalModal('안내사항', _buildInfoHtml(), 'info');
    }

    // ──────────────────────────────────────────────────────────────
    // 버튼 바인딩 + 초기화
    // ──────────────────────────────────────────────────────────────
    function _bindButtons() {
        var toggleBtn = document.getElementById('ocean-cctv-toggle-btn');
        if (toggleBtn && !toggleBtn.dataset.bound) {
            toggleBtn.addEventListener('click', function () {
                _setCctvActive(!_cctvActive);
            });
            toggleBtn.dataset.bound = '1';
        }
        // 상시 노출 ⓘ 버튼 — 지도 좌측 상단, 기본맵 오른쪽 옆
        //  CCTV ON/OFF 와 무관하게 언제든 안내사항 팝업(7탭) 을 열 수 있음.
        var infoBtn = document.getElementById('ocean-info-btn');
        if (infoBtn && !infoBtn.dataset.bound) {
            infoBtn.addEventListener('click', _openNoticePopup);
            infoBtn.dataset.bound = '1';
        }
    }

    // DOMContentLoaded 후 버튼 바인딩 (oceanMap 생성과 독립적 — 첫 클릭 시 layer 지연 생성)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindButtons);
    } else {
        _bindButtons();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 즐겨찾기 매니저 (oceanFav)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // [역할]
    //   index2 해양종합 전용 즐겨찾기 두 종류를 관리하고, 하단 #ocean-fav-bar
    //   에 최대 3개 칩을 렌더한다.
    //     - cctv     : CCTV 지점 즐겨찾기 (localStorage: cctv_favorites_ocean_v1)
    //     - location : 해역 바텀시트 위치 즐겨찾기 (ocean_location_favorites_v1)
    //
    // [index1 독립]
    //   index1 의 기존 CCTV 즐겨찾기(cctv_favorites_v1)는 전혀 건드리지 않는다.
    //   키 이름이 다르므로 두 페이지의 즐겨찾기는 완전히 분리되어 저장된다.
    //
    // [표시 규칙 (renderAll 이 자동 판단)]
    //   - 해양종합이 active 가 아니면 표시 안 함
    //   - CCTV 토글 ON  → CCTV 즐겨찾기만 표시 (위치 즐겨찾기 숨김)
    //   - CCTV 토글 OFF → 위치 즐겨찾기 표시 (있으면)
    //   - 목록이 비어있으면 .empty 클래스로 바 자체 숨김 (CSS 에서 display:none)
    //
    // [500m 중복 판정 (location)]
    //   위치 즐겨찾기 중복 여부는 반경 500m 이내로 판단(하버사인 거리).
    //
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * 두 지점 사이의 거리(m) 계산 (하버사인).
     * [용도] 위치 즐겨찾기 500m 반경 중복 판정 / 클릭 좌표 매칭
     */
    function _haversineMeters(lat1, lon1, lat2, lon2) {
        var R = 6371000; // 지구 반지름 (m)
        var toRad = Math.PI / 180;
        var dLat = (lat2 - lat1) * toRad;
        var dLon = (lon2 - lon1) * toRad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
              + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
              * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /** 저장소 한쪽의 기본 동작 셋 (cctv / location 공통 로직) */
    function _createFavStore(storageKey, maxCount) {
        return {
            MAX: maxCount,
            STORAGE_KEY: storageKey,
            items: [],

            /** localStorage 에서 읽어와 items 채움 */
            load: function () {
                try {
                    var raw = localStorage.getItem(this.STORAGE_KEY);
                    this.items = raw ? JSON.parse(raw) : [];
                    if (!Array.isArray(this.items)) this.items = [];
                } catch (e) {
                    this.items = [];
                }
            },

            /** items 를 localStorage 에 기록 */
            save: function () {
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
                } catch (e) {
                    console.warn('[oceanFav] 저장 실패:', e);
                }
            },

            /** 3개 제한 검사 — 가득이면 false (거부) */
            canAdd: function () { return this.items.length < this.MAX; },

            /** 항목 추가 (호출자가 먼저 canAdd 확인) */
            push: function (item) {
                this.items.push(item);
                this.save();
            },

            /** id 로 제거 (String 비교 — 숫자/문자열 혼용 방어) */
            removeById: function (id) {
                var key = String(id);
                this.items = this.items.filter(function (it) {
                    return String(it.id) !== key;
                });
                this.save();
            }
        };
    }

    // CCTV 즐겨찾기 저장소 (변경 없음 — 최대 3개)
    // item 구조: { id, cctvId, name, subtitle, providerKey, providerName,
    //              shareUrl, streamUrl, cnt, sensorName, cameraCount, obsName }
    var _favCctv = _createFavStore('cctv_favorites_ocean_v1', 3);

    // 위치 즐겨찾기 저장소 (최대 6개 — 한 줄 3개 × 최대 2줄)
    // item 구조: { id, name, lat, lon, addedAt }
    var _favLocation = _createFavStore('ocean_location_favorites_v1', 6);

    // 둘 다 초기 로드
    _favCctv.load();
    _favLocation.load();
    // 위치 즐겨찾기 → 지도 별 마커 레이어 초기 피처 반영
    // (레이어가 아직 설치 전이면 _rerenderFavLocFeatures() 가 no-op,
    //  설치 시점에 _ensureFavLocLayer 가 다시 호출되어 반영됨)
    _rerenderFavLocFeatures();

    /**
     * CCTV 즐겨찾기: id 로 존재 여부 확인.
     * [사용] 팝업 헤더의 별 버튼 상태 판정 (그룹3 에서 활용)
     */
    function _cctvHas(id) {
        // 외부에서 문자열/숫자가 섞여 들어올 수 있으므로 String 비교로 통일.
        var key = String(id);
        for (var i = 0; i < _favCctv.items.length; i++) {
            if (String(_favCctv.items[i].id) === key) return true;
        }
        return false;
    }

    /**
     * 위치 즐겨찾기: 반경 500m 안에 기존 즐겨찾기가 있으면 그 항목 반환, 없으면 null.
     * [사용] 바텀시트의 ⭐ 버튼 활성 상태 판정 / ⭐ 재클릭 시 제거 대상 찾기
     */
    function _locationFindNear(lat, lon) {
        for (var i = 0; i < _favLocation.items.length; i++) {
            var it = _favLocation.items[i];
            var dist = _haversineMeters(lat, lon, it.lat, it.lon);
            if (dist <= 500) return it;
        }
        return null;
    }

    /** 위치 즐겨찾기: 이름 중복 여부 */
    function _locationHasName(name) {
        for (var i = 0; i < _favLocation.items.length; i++) {
            if (_favLocation.items[i].name === name) return true;
        }
        return false;
    }

    /**
     * 하단 #ocean-fav-bar 에 현재 상태에 맞는 칩들을 렌더한다.
     *
     * [렌더 대상 결정]
     *  - CCTV 토글 ON  → CCTV 즐겨찾기 (최대 3개, 한 줄)
     *  - CCTV 토글 OFF → 위치 즐겨찾기 (최대 6개, 3개씩 두 줄)
     *
     * [행 단위 렌더]
     *  3개씩 .fav-row div 로 묶어 한 줄에 정확히 3개를 강제. flex-wrap 으로
     *  자동 줄바꿈을 쓰지 않는 이유: 짧은 칩 4개가 한 줄에 들어가버려
     *  "한 줄에 3개" 규칙이 깨질 수 있음.
     *
     * [긴 칩만 폰트 축소]
     *  렌더 직후 requestAnimationFrame 으로 각 칩의 .chip-name 이 컨테이너를
     *  넘치는지(scrollWidth > clientWidth) 측정. 넘치면 그 칩에만 .shrunk
     *  클래스 부여 → 폰트 한 단계 축소. 그래도 넘치면 CSS 의 ellipsis 가
     *  자동으로 잘라줌(... 처리).
     *
     * [빈 목록 처리]
     *  렌더 대상이 비어 있으면 .empty 클래스 추가 → CSS 에서 display:none
     */
    function _renderFavBar() {
        var bar = document.getElementById('ocean-fav-bar');
        if (!bar) return;
        bar.innerHTML = '';

        var isCctv = _cctvActive;
        var items  = isCctv ? _favCctv.items : _favLocation.items;

        if (!items || items.length === 0) {
            bar.classList.add('empty');
            return;
        }
        bar.classList.remove('empty');

        var ROW_SIZE = 3;
        var row = null;
        for (var i = 0; i < items.length; i++) {
            if (i % ROW_SIZE === 0) {
                row = document.createElement('div');
                row.className = 'fav-row';
                bar.appendChild(row);
            }
            var it = items[i];
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'ocean-fav-chip';
            chip.dataset.kind = isCctv ? 'cctv' : 'location';
            chip.dataset.id   = it.id;
            // 아이콘: CCTV 는 카메라, 위치는 별
            var iconClass = isCctv ? 'fa-solid fa-video' : 'fa-solid fa-star';
            var labelText = (it.name || '').toString();
            chip.innerHTML = '<i class="chip-icon ' + iconClass + '"></i>'
                           + '<span class="chip-name"></span>';
            chip.querySelector('.chip-name').textContent = labelText;
            chip.addEventListener('click', _handleChipClick);
            row.appendChild(chip);
        }

        // 렌더 후 한 프레임 뒤에 overflow 측정 (layout 완료 보장)
        // 긴 칩만 .shrunk 클래스 부여해 폰트 축소. 그래도 넘치면 CSS ellipsis.
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                var chips = bar.querySelectorAll('.ocean-fav-chip');
                for (var k = 0; k < chips.length; k++) {
                    var nm = chips[k].querySelector('.chip-name');
                    if (nm && nm.scrollWidth > nm.clientWidth + 1) {
                        chips[k].classList.add('shrunk');
                    }
                }
            });
        }
    }

    /**
     * 즐겨찾기 칩 클릭 핸들러.
     *
     *  - CCTV 칩:
     *     1) 지도 해당 좌표로 이동 (lat/lng 있으면)
     *     2) showCctvPopup 으로 영상 팝업 오픈
     *  - 위치 칩:
     *     1) 지도 해당 좌표로 이동
     *     2) showOceanBottomSheet 으로 바텀시트 오픈
     *
     * [stopPropagation 이유]
     *  칩 클릭 이벤트가 상위(#ocean-fav-bar → document)로 버블링되면서
     *  다른 click 리스너(예: index2_patch.js 의 본문 터치 서브탭 닫기,
     *  지도 click 핸들러 등)가 원치 않는 부작용을 일으킬 가능성 차단.
     *  버튼 자체 동작은 이 핸들러에서만 처리.
     */
    function _handleChipClick(e) {
        // 다른 핸들러 간섭 방지
        if (e && e.stopPropagation) e.stopPropagation();

        var chip = e.currentTarget;
        var kind = chip.dataset.kind;
        var id   = chip.dataset.id;
        var map  = window.getOceanMap && window.getOceanMap();

        if (kind === 'cctv') {
            var cctv = null;
            // [타입 주의] chip.dataset.id 는 HTML attribute 특성상 항상 문자열이지만
            //   저장된 items[i].id 는 cctvId(숫자) 일 수 있어 === 비교가 실패함.
            //   String() 으로 양쪽 모두 문자열화해 안전하게 매칭.
            for (var i = 0; i < _favCctv.items.length; i++) {
                if (String(_favCctv.items[i].id) === String(id)) {
                    cctv = _favCctv.items[i];
                    break;
                }
            }
            if (!cctv) return;

            // [하위호환] 이전 버전에서 lat/lng 없이 저장된 즐겨찾기는 런타임에
            // CCTV_PROVIDERS 에서 역조회하여 좌표 복원 후 localStorage 업데이트.
            if ((cctv.lat == null || cctv.lng == null)
                && window.CCTV_PROVIDERS && cctv.providerKey) {
                var prv = window.CCTV_PROVIDERS[cctv.providerKey];
                if (prv && prv.items) {
                    for (var m = 0; m < prv.items.length; m++) {
                        if (prv.items[m].cctvId === cctv.cctvId) {
                            cctv.lat = parseFloat(prv.items[m].lat);
                            cctv.lng = parseFloat(prv.items[m].lng);
                            _favCctv.save();
                            break;
                        }
                    }
                }
            }

            // ① 지도 해당 좌표로 이동 (lat/lng 저장되어 있을 때)
            var hasCoord = (typeof cctv.lat === 'number' && !isNaN(cctv.lat)
                         && typeof cctv.lng === 'number' && !isNaN(cctv.lng));
            if (map && hasCoord) {
                map.getView().animate({
                    center: ol.proj.fromLonLat([cctv.lng, cctv.lat]),
                    zoom: Math.max(map.getView().getZoom() || 6, 12),
                    duration: 400
                });
            }

            // ② 영상 팝업 오픈 (지도 애니메이션과 겹쳐도 무관)
            if (typeof window.showCctvPopup === 'function') {
                window.showCctvPopup(cctv);
            }
            return;
        }

        if (kind === 'location') {
            var loc = null;
            // 동일한 이유로 String 변환 매칭 (위치 id 는 'loc_…' 문자열이지만 방어적)
            for (var j = 0; j < _favLocation.items.length; j++) {
                if (String(_favLocation.items[j].id) === String(id)) {
                    loc = _favLocation.items[j];
                    break;
                }
            }
            if (!loc) return;

            // ① 지도 이동
            if (map) {
                map.getView().animate({
                    center: ol.proj.fromLonLat([loc.lon, loc.lat]),
                    zoom: Math.max(map.getView().getZoom() || 6, 10),
                    duration: 400
                });
            }
            // ② 바텀시트 오픈
            if (typeof window.showOceanBottomSheet === 'function') {
                window.showOceanBottomSheet(loc.lat, loc.lon);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 바텀시트 열림 / 범례 표시 상태 감시 (MutationObserver)
    // ──────────────────────────────────────────────────────────────
    /**
     * .ocean-bottom-sheet 의 class 변화를 감시하여 body.ocean-sheet-open 토글.
     * 바텀시트 열리면 하단 즐겨찾기 바는 자동 숨김 (CSS 에서 처리).
     */
    function _observeBottomSheet() {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;
        var sync = function () {
            document.body.classList.toggle('ocean-sheet-open',
                sheet.classList.contains('open'));
        };
        sync();
        new MutationObserver(sync).observe(sheet, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    /**
     * .ocean-legend 의 style.display 변화를 감시하여 body.ocean-legend-visible 토글.
     * 범례(오버레이 ON) 가 뜨면 즐겨찾기 바를 범례 위로 115px 올림.
     */
    function _observeLegend() {
        var legend = document.getElementById('ocean-legend');
        if (!legend) return;
        var sync = function () {
            // 인라인 display:none 이 있으면 숨김, 아니면 표시
            var hidden = legend.style.display === 'none';
            document.body.classList.toggle('ocean-legend-visible', !hidden);
        };
        sync();
        new MutationObserver(sync).observe(legend, {
            attributes: true,
            attributeFilter: ['style']
        });
    }

    // DOM 준비 후 옵저버 바인딩
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _observeBottomSheet();
            _observeLegend();
            _renderFavBar();
        });
    } else {
        _observeBottomSheet();
        _observeLegend();
        _renderFavBar();
    }

    // ══════════════════════════════════════════════════════════════
    // 바텀시트 ⭐ 위치 즐겨찾기 (그룹 4)
    // ──────────────────────────────────────────────────────────────
    // [UX 흐름]
    //  1) 해역 클릭 → 바텀시트 열림 → showOceanBottomSheet(lat, lon) 호출 감지
    //  2) 현재 좌표를 기준으로 _locationFindNear(500m) 결과가 있으면 ⭐ active
    //     없으면 ⭐ 비활성
    //  3) ⭐ 클릭:
    //     - 비활성 상태: 이름 입력 모달 → 저장 시 oceanFav.locationAdd
    //       * 실패(꽉참/이름중복/반경중복) 시 각각 안내
    //     - 활성 상태: 즉시 제거 (oceanFav.locationRemoveNear)
    //
    // [좌표 추적]
    //  ocean_bottom_sheet1.js 의 window.showOceanBottomSheet(lat, lon) 을 감싸
    //  (monkey-patch) 현재 좌표를 _currentSheetCoord 로 저장.
    //  index2 전용이므로 __SEAGNAL_PAGE 가드 안쪽이라 index1 은 영향 없음.
    // ══════════════════════════════════════════════════════════════

    /** 현재 바텀시트에 표시 중인 좌표 { lat, lon } (없으면 null) */
    var _currentSheetCoord = null;

    /**
     * 바텀시트 ⭐ 버튼의 활성/비활성 UI 를 _currentSheetCoord 기준으로 갱신.
     */
    function _updateSheetFavButton() {
        var btn = document.getElementById('ocean-sheet-fav-btn');
        if (!btn) return;
        var active = false;
        if (_currentSheetCoord) {
            var near = _locationFindNear(_currentSheetCoord.lat, _currentSheetCoord.lon);
            active = !!near;
        }
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = active ? '즐겨찾기 해제' : '즐겨찾기 추가';
        var icon = btn.querySelector('i');
        if (icon) {
            icon.className = active ? 'fa-solid fa-star' : 'fa-regular fa-star';
        }
    }

    /**
     * showOceanBottomSheet(lat, lon, ...) monkey-patch.
     * 원본을 호출한 뒤 현재 좌표 저장 + ⭐ 상태 갱신.
     */
    (function _patchShowBottomSheet() {
        function tryPatch() {
            if (typeof window.showOceanBottomSheet !== 'function') return false;
            if (window.showOceanBottomSheet.__oceanFavPatched) return true;
            var orig = window.showOceanBottomSheet;
            var patched = function (lat, lon, stationInfo) {
                try {
                    if (typeof lat === 'number' && typeof lon === 'number') {
                        _currentSheetCoord = { lat: lat, lon: lon };
                    } else {
                        _currentSheetCoord = null;
                    }
                } catch (e) { _currentSheetCoord = null; }
                var ret = orig.apply(this, arguments);
                // 시트 DOM 이 그려진 다음 프레임에 ⭐ 상태 반영 (원본이 DOM 을 바꿨을 수 있음)
                requestAnimationFrame(_updateSheetFavButton);
                return ret;
            };
            patched.__oceanFavPatched = true;
            window.showOceanBottomSheet = patched;
            return true;
        }
        if (tryPatch()) return;
        // 로드 순서상 ocean_bottom_sheet1.js 이전에 실행될 수 있으므로 DOMContentLoaded 후 재시도
        document.addEventListener('DOMContentLoaded', function () {
            if (tryPatch()) return;
            // 그래도 안 되면 약간의 polling (매우 짧게)
            var tries = 0;
            var iv = setInterval(function () {
                if (tryPatch() || ++tries > 20) clearInterval(iv);
            }, 100);
        });
    })();

    // ──────────────────────────────────────────────────────────────
    // 이름 입력 모달 (showSeagnalModal 과 유사 스타일의 index2 전용 input 모달)
    // ──────────────────────────────────────────────────────────────
    var _NAME_MODAL_ID = 'ocean-loc-fav-name-modal';

    /**
     * 이름 입력 모달을 띄운다.
     * @param {Function} onConfirm(name) — 유효 이름으로 확인 누르면 호출
     */
    function _openNameInputModal(onConfirm) {
        // 기존 모달 있으면 제거
        var existing = document.getElementById(_NAME_MODAL_ID);
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = _NAME_MODAL_ID;
        modal.className = 'seagnal-modal';
        modal.innerHTML =
            '<div class="seagnal-modal-overlay"></div>' +
            '<div class="seagnal-modal-content">' +
              '<div class="seagnal-modal-icon"><i class="fa-solid fa-star"></i></div>' +
              '<div class="seagnal-modal-title">즐겨찾기 이름</div>' +
              '<div class="seagnal-modal-message">이 위치의 이름을 입력하세요 (최대 10자)</div>' +
              '<input type="text" id="ocean-loc-fav-name-input" maxlength="10"' +
                ' style="width:100%; padding:10px 12px; margin-bottom:14px;' +
                       ' background:#0f172a; color:#fff; font-size:0.95rem;' +
                       ' border:1px solid rgba(255,255,255,0.15); border-radius:10px;' +
                       ' box-sizing:border-box;" />' +
              '<div style="display:flex; gap:8px;">' +
                '<button class="seagnal-modal-btn" id="ocean-loc-fav-cancel"' +
                        ' style="flex:1; background:rgba(255,255,255,0.08); color:#e2e8f0;">취소</button>' +
                '<button class="seagnal-modal-btn" id="ocean-loc-fav-ok"' +
                        ' style="flex:1;">저장</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        var input = modal.querySelector('#ocean-loc-fav-name-input');
        var btnOk = modal.querySelector('#ocean-loc-fav-ok');
        var btnCancel = modal.querySelector('#ocean-loc-fav-cancel');
        var overlay = modal.querySelector('.seagnal-modal-overlay');

        function close() {
            modal.classList.add('fade-out');
            setTimeout(function () {
                modal.remove();
                document.body.style.overflow = '';
            }, 180);
        }

        function submit() {
            var name = (input.value || '').trim();
            // 유효성: 빈값 거부
            if (!name) {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('즐겨찾기', '이름을 입력해 주세요.', 'info');
                }
                return;
            }
            // 10자 초과 (input maxlength 가 있지만 방어)
            if (name.length > 10) name = name.substring(0, 10);
            close();
            onConfirm(name);
        }

        btnOk.addEventListener('click', submit);
        btnCancel.addEventListener('click', close);
        overlay.addEventListener('click', close);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') submit();
            else if (ev.key === 'Escape') close();
        });

        // focus 는 약간의 delay 후 (모달 애니메이션 후)
        setTimeout(function () { input.focus(); }, 60);
    }

    /**
     * 바텀시트 ⭐ 버튼 클릭 핸들러
     *  - 이미 저장됨 → 즉시 제거
     *  - 저장 안 됨 → 이름 입력 모달 → 저장
     */
    function _onSheetFavBtnClick() {
        if (!_currentSheetCoord) return;
        var lat = _currentSheetCoord.lat;
        var lon = _currentSheetCoord.lon;

        var near = _locationFindNear(lat, lon);
        if (near) {
            // 이미 등록됨 → 즉시 해제
            var removedLat = near.lat, removedLon = near.lon;
            _favLocation.removeById(near.id);
            _renderFavBar();
            _rerenderFavLocFeatures();
            _updateSheetFavButton();
            // [차등 캐싱 — 2026-05] 영속 조석 캐시 삭제
            try {
                if (window.OceanSheet && typeof window.OceanSheet.dropFromPersist === 'function') {
                    window.OceanSheet.dropFromPersist(removedLat, removedLon);
                }
            } catch (e) { /* ignore */ }
            return;
        }

        // 신규 등록 전 용량/중복 사전 체크
        if (!_favLocation.canAdd()) {
            if (typeof window.showSeagnalModal === 'function') {
                window.showSeagnalModal('즐겨찾기',
                    '위치 즐겨찾기는 최대 6개까지 저장할 수 있습니다.\n기존 항목을 먼저 해제해 주세요.', 'info');
            }
            return;
        }

        _openNameInputModal(function (name) {
            // 이름 중복 검사 (저장 직전 재확인)
            if (_locationHasName(name)) {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('즐겨찾기',
                        '같은 이름의 즐겨찾기가 이미 있습니다. 다른 이름을 사용해 주세요.', 'info');
                }
                return;
            }
            var item = {
                id: 'loc_' + Date.now(),
                name: name,
                lat: lat,
                lon: lon,
                addedAt: Date.now()
            };
            var result = window.oceanFav.locationAdd(item);
            if (!result.ok) {
                var msg = '저장에 실패했습니다.';
                if (result.reason === 'full')         msg = '위치 즐겨찾기가 가득 찼습니다 (최대 6개).';
                else if (result.reason === 'name_exists') msg = '같은 이름의 즐겨찾기가 이미 있습니다.';
                else if (result.reason === 'near_exists') msg = '이미 근처(500m 이내)에 즐겨찾기가 있습니다.';
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('즐겨찾기', msg, 'info');
                }
                return;
            }
            _updateSheetFavButton();
        });
    }

    /** ⭐ 버튼 이벤트 바인딩 (1회) */
    function _bindSheetFavBtn() {
        var btn = document.getElementById('ocean-sheet-fav-btn');
        if (!btn || btn.dataset.bound) return;
        btn.addEventListener('click', _onSheetFavBtnClick);
        btn.dataset.bound = '1';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindSheetFavBtn);
    } else {
        _bindSheetFavBtn();
    }

    // ══════════════════════════════════════════════════════════════
    // 공통 네비게이션 헬퍼 (특보 카드/기상현황 카드 "종합정보" 버튼 공용)
    // ──────────────────────────────────────────────────────────────
    // [역할]
    //  특보구역 이름(zoneName) 으로 ZONE_OVERLAY_CONFIG 의 중심 픽셀을 얻고
    //  pixelToGps() 로 lat/lon 변환 → 해양종합정보 탭 전환 + 지도를 해당
    //  좌표로 "이동만" (현재 줌 유지). 바텀시트는 띄우지 않는다.
    //
    // [의도된 동작]
    //  사용자 요구: "확대도, 바텀시트도 필요없고 그냥 이동되도록만".
    //   - 확대(zoom 변경) 안 함  → 현재 zoom 그대로 center 만 animate
    //   - 바텀시트(showOceanBottomSheet) 호출 안 함
    //
    // [연계]
    //  - render.js (해역별 특보현황 카드의 "종합정보" 버튼)
    //  - windy.js  (해역별 기상현황 카드의 "종합정보" 버튼)
    //
    // [반환]
    //  성공 true / 실패(매핑 없음 등) false — 호출자는 false 시 무시.
    // ══════════════════════════════════════════════════════════════
    function _goToOceanMapByZone(zoneName) {
        if (typeof ZONE_OVERLAY_CONFIG === 'undefined') return false;
        var cfg = ZONE_OVERLAY_CONFIG[zoneName];
        if (!cfg || !cfg.center) return false;
        if (typeof pixelToGps !== 'function') return false;
        var gps = pixelToGps(cfg.center.x, cfg.center.y);
        if (!gps || gps.lat == null || gps.lon == null) return false;

        // 해양종합정보 탭 전환 (이미 활성이면 no-op)
        if (typeof window.switchMainTab === 'function') {
            window.switchMainTab('ocean-map-section');
        }
        // [최초 로드 대응] 탭 전환 경로에 따라 지도 빌드가 지연될 수 있어 지도
        //   초기화를 직접 한 번 더 호출(멱등 — 이미 있으면 updateSize만). 이렇게
        //   하면 getOceanMap() 이 빨리 준비돼 아래 animate 재시도가 곧 성공한다.
        if (typeof window.initOceanMap === 'function') {
            try { window.initOceanMap(); } catch (e) {}
        }

        // 탭 전환 애니메이션/지도 초기화 완료 대기 후 center 이동(줌 유지)
        //
        // [retry 도입 이유]
        //   첫 진입 시 OL 지도가 아직 생성 전이라 getOceanMap() 이 null 인
        //   경우가 있다. 기존엔 단발 setTimeout(300ms) 후 null 이면 조용히
        //   스킵돼서 "처음 클릭은 줌/깜빡임 안 됨, 두번째부터 됨" 증상 발생.
        //   100ms × 최대 20회(=2초) 폴링으로 map 이 준비되면 즉시 animate.
        var attempt = 0;
        var MAX_ATTEMPT = 50;   // 100ms × 50 = 최대 5초 (최초 로드 지도 빌드 커버)
        function tryAnimate() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map && typeof map.getView === 'function') {
                map.getView().animate({
                    center: ol.proj.fromLonLat([gps.lon, gps.lat]),
                    duration: 400
                });
                return;
            }
            if (++attempt < MAX_ATTEMPT) setTimeout(tryAnimate, 100);
        }
        setTimeout(tryAnimate, 300);

        return true;
    }

    // 외부에서 render.js / windy.js 가 호출할 수 있도록 window 로 노출
    window.goToOceanMapByZone = _goToOceanMapByZone;

    // ──────────────────────────────────────────────────────────────
    // 외부 API
    // ──────────────────────────────────────────────────────────────
    // [tryHandleMapClick]
    //  ocean_map.js 의 handleMapClick 내부에서 **가장 먼저** 호출.
    //  true 반환 시 기존 부이/마커/바텀시트 흐름을 모두 skip 해야 함.
    //  CCTV 가 OFF 이거나 CCTV 마커에 맞지 않으면 false 반환 → 기존 흐름 진행.
    //
    // [isActive / setActive]
    //  후속 그룹(즐겨찾기)에서 CCTV 상태를 조회/제어하기 위한 API.
    window.oceanCctv = {
        isActive: function () { return _cctvActive; },
        setActive: _setCctvActive,
        tryHandleMapClick: function (map, evt) {
            return _handleCctvClick(map, evt);
        },
        // [tryHandleFavLocClick]
        //  ocean_map.js 의 handleMapClick 에서 CCTV hit 처리 직후 호출.
        //  위치 즐겨찾기(★) 마커가 클릭됐는지 검사 → hit 이면 그 즐겨찾기의
        //  좌표로 바텀시트 즉시 오픈하고 true 반환 → 일반 지도 클릭 흐름 skip.
        //  미 hit 이면 false 반환해 평소 처리(빈 해역 클릭 → 좌표 기준 바텀시트)
        //  가 그대로 진행됨.
        tryHandleFavLocClick: function (map, evt) {
            return _handleFavLocClick(map, evt);
        }
    };

    // ──────────────────────────────────────────────────────────────
    // 위치 즐겨찾기 ★ 마커 클릭 핸들러 (b 방식: 명시적 hit)
    //  - 클릭 픽셀에서 _favLocLayer 의 피처를 찾아 hit 이면 해당 좌표로
    //    showOceanBottomSheet 직접 호출 (500m 반경 계산 우회 — 정확 매칭).
    //  - hitTolerance 8px: 별 아이콘 크기 고려한 약간의 여유.
    //  - 좌표는 feature 의 geometry 에서 직접 추출 (저장 시점 lat/lon 그대로).
    // ──────────────────────────────────────────────────────────────
    function _handleFavLocClick(map, evt) {
        if (!_favLocLayer || !_favLocSrc) return false;
        var hit = null;
        try {
            map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
                if (layer === _favLocLayer) {
                    hit = feature;
                    return true;
                }
            }, { hitTolerance: 8 });
        } catch (e) { return false; }
        if (!hit) return false;

        var geom = hit.getGeometry();
        if (!geom) return false;
        var coord3857 = geom.getCoordinates();
        var lonLat;
        try { lonLat = ol.proj.toLonLat(coord3857); } catch (e) { return false; }
        var lon = lonLat[0], lat = lonLat[1];
        if (typeof window.showOceanBottomSheet === 'function') {
            try { window.showOceanBottomSheet(lat, lon); } catch (e) {}
        }
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // window.CctvFavorites shim (index2 전용)
    // ──────────────────────────────────────────────────────────────
    // [왜 shim?]
    //  cctv4.js 의 팝업 헤더 별 버튼은 onclick="toggleCctvFavorite()" 로 바인딩되어
    //  있고, 그 핸들러는 `window.CctvFavorites.has / add / remove` 를 호출한다.
    //  index1 에서는 cctv6.js 가 실제 CctvFavorites 를 정의하지만, index2 에서는
    //  cctv6.js 를 로드하지 않아 이 객체가 undefined → 별 버튼이 무동작.
    //
    //  cctv4.js 는 공유 파일이라 수정 금지이므로, index2 에서는 동일 시그니처의
    //  얇은 shim 을 노출하여 기존 별 버튼 로직이 그대로 oceanFav 매니저에
    //  위임되도록 함.
    //
    // [인터페이스 일치]
    //  - has(cctvId)      → oceanFav.cctvHas(cctvId) 로 위임
    //  - remove(cctvId)   → oceanFav.cctvRemove(cctvId)
    //  - add(obj)         → oceanFav.cctvAdd({ id: obj.cctvId, ...obj })
    //    * 성공 true / 실패 false 반환 (cctv4.js 시그니처 유지)
    //    * "full" 거부 시 showSeagnalModal 로 사용자 안내
    //
    // [index1 무영향]
    //  이 파일은 __SEAGNAL_PAGE==='index2' 가드 안에서 실행되므로 index1 에는
    //  shim 이 설치되지 않음 → index1 의 실제 CctvFavorites 그대로 사용.
    // ══════════════════════════════════════════════════════════════
    window.CctvFavorites = {
        has: function (cctvId) {
            return _cctvHas(cctvId);
        },
        remove: function (cctvId) {
            _favCctv.removeById(cctvId);
            _renderFavBar();
        },
        add: function (obj) {
            if (!obj || !obj.cctvId) return false;

            // cctv4.js 의 toggleCctvFavorite 은 좌표를 전달하지 않으므로,
            // CCTV_PROVIDERS 에서 cctvId + providerKey 로 역조회해 lat/lng 보강.
            // (하단 바에서 즐겨찾기 칩 클릭 시 지도를 해당 좌표로 이동시키는 데 사용)
            var lat = null, lng = null;
            try {
                if (window.CCTV_PROVIDERS && obj.providerKey) {
                    var provider = window.CCTV_PROVIDERS[obj.providerKey];
                    if (provider && Array.isArray(provider.items)) {
                        for (var k = 0; k < provider.items.length; k++) {
                            if (provider.items[k].cctvId === obj.cctvId) {
                                lat = parseFloat(provider.items[k].lat);
                                lng = parseFloat(provider.items[k].lng);
                                break;
                            }
                        }
                    }
                }
            } catch (e) { /* 좌표 없으면 지도 이동만 생략, 팝업은 정상 */ }

            // 내부 스키마는 id 필드를 primary key 로 사용
            var item = {
                id:           obj.cctvId,
                cctvId:       obj.cctvId,
                name:         obj.name,
                subtitle:     obj.subtitle,
                providerKey:  obj.providerKey,
                providerName: obj.providerName,
                shareUrl:     obj.shareUrl,
                streamUrl:    obj.streamUrl,
                cameraCount:  obj.cameraCount,
                obsName:      obj.obsName,
                sensorName:   obj.sensorName,
                cnt:          obj.cnt,
                lat:          lat,
                lng:          lng
            };
            // 3개 제한 초과 시 거부 + 안내
            if (!_favCctv.canAdd()) {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('즐겨찾기',
                        '즐겨찾기는 최대 3개까지 저장할 수 있습니다.\n기존 항목을 먼저 해제해 주세요.', 'info');
                }
                return false;
            }
            // 이미 같은 cctvId 가 있으면 중복 거부
            if (_cctvHas(obj.cctvId)) return false;
            _favCctv.push(item);
            _renderFavBar();
            return true;
        },
        /**
         * render: cctv6.js 원본은 지도 우측 상단에 즐겨찾기 버튼 목록을 그리는
         * 함수. index2 에서는 하단 #ocean-fav-bar 가 대체하므로 no-op.
         * 혹시 외부에서 호출되면 하단 바만 갱신.
         */
        render: function () { _renderFavBar(); }
    };

    // ──────────────────────────────────────────────────────────────
    // 즐겨찾기 외부 API (그룹 3/4 에서 연동)
    // ──────────────────────────────────────────────────────────────
    window.oceanFav = {
        // CCTV 즐겨찾기 관련
        cctvHas: _cctvHas,
        cctvAdd: function (item) {
            // 3개 제한 초과 시 거부
            if (!_favCctv.canAdd()) return { ok: false, reason: 'full' };
            if (_cctvHas(item.id)) return { ok: false, reason: 'exists' };
            _favCctv.push(item);
            _renderFavBar();
            return { ok: true };
        },
        cctvRemove: function (id) {
            _favCctv.removeById(id);
            _renderFavBar();
        },
        cctvGetAll: function () { return _favCctv.items.slice(); },

        // 위치 즐겨찾기 관련
        locationFindNear: _locationFindNear,
        locationHasName: _locationHasName,
        locationAdd: function (item) {
            // 3개 제한 초과 시 거부
            if (!_favLocation.canAdd()) return { ok: false, reason: 'full' };
            // 500m 반경 중복 거부
            if (_locationFindNear(item.lat, item.lon)) return { ok: false, reason: 'near_exists' };
            // 이름 중복 거부
            if (_locationHasName(item.name))          return { ok: false, reason: 'name_exists' };
            _favLocation.push(item);
            _renderFavBar();
            _rerenderFavLocFeatures();
            // [차등 캐싱 — 2026-05] 즐겨찾기 신규 추가 시 현재 메모리의 조석 캐시를
            // localStorage 로 즉시 승격. 다음 세션에서도 API 호출 없이 즉시 hit.
            try {
                if (window.OceanSheet && typeof window.OceanSheet.promoteMemoryCacheToPersist === 'function') {
                    window.OceanSheet.promoteMemoryCacheToPersist(item.lat, item.lon);
                }
            } catch (e) { /* ignore */ }
            return { ok: true };
        },
        locationRemoveById: function (id) {
            // 삭제 전 좌표 캡처 — 영속 캐시 정리에 필요
            var removedLat = null, removedLon = null;
            for (var i = 0; i < _favLocation.items.length; i++) {
                if (String(_favLocation.items[i].id) === String(id)) {
                    removedLat = _favLocation.items[i].lat;
                    removedLon = _favLocation.items[i].lon;
                    break;
                }
            }
            _favLocation.removeById(id);
            _renderFavBar();
            _rerenderFavLocFeatures();
            // [차등 캐싱 — 2026-05] 즐겨찾기 해제 시 localStorage 영속 캐시 삭제.
            try {
                if (removedLat !== null && removedLon !== null
                    && window.OceanSheet && typeof window.OceanSheet.dropFromPersist === 'function') {
                    window.OceanSheet.dropFromPersist(removedLat, removedLon);
                }
            } catch (e) { /* ignore */ }
        },
        locationRemoveNear: function (lat, lon) {
            var near = _locationFindNear(lat, lon);
            if (near) {
                var removedLat = near.lat, removedLon = near.lon;
                _favLocation.removeById(near.id);
                _renderFavBar();
                _rerenderFavLocFeatures();
                // [차등 캐싱 — 2026-05] 즐겨찾기 해제 시 localStorage 영속 캐시 삭제.
                try {
                    if (window.OceanSheet && typeof window.OceanSheet.dropFromPersist === 'function') {
                        window.OceanSheet.dropFromPersist(removedLat, removedLon);
                    }
                } catch (e) { /* ignore */ }
                return true;
            }
            return false;
        },
        locationGetAll: function () { return _favLocation.items.slice(); },

        // 재렌더 강제
        rerender: _renderFavBar
    };

})();
