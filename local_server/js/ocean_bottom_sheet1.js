/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet1.js
 * 역할: 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸
 * ============================================================================
 *
 * [설명]
 * 지도(모드 A) 클릭 시 떠오르는 바텀시트의 핵심 모듈입니다.
 * 5개 파일(ocean_bottom_sheet1~5.js)로 분할되어 있으며,
 * 이 파일이 가장 먼저 로드되어 공용 네임스페이스 `window.OceanSheet`를 만들고
 * 다른 파일들이 그 안에 메서드/렌더러를 붙이는 구조입니다.
 *
 * [분할 구성]
 *  1.js  코어/상태/진입점/공용 유틸           ← 본 파일
 *  2.js  헤더(날짜네비/📍토글/✕) 렌더 + 컨트롤
 *  3.js  조석 카드 (TideBED 폴링 + 렌더링 3모드)
 *  4.js  동해북부 IDW 우회 + 천문 카드 (SunCalc)
 *  5.js  6개 일반카드 + 저질 분석 + 오케스트레이터
 *
 * [의존]
 * - tide.js (전역 함수: getLunarDate, getAstronomyInfo, findNearestStationsWithData,
 *            interpolateTideByIDW, convertIDWToTideBedFormat, loadTideData,
 *            getClientAdjacentDates) — typeof 가드 후 호출
 * - SunCalc (CDN 전역 객체)
 * ============================================================================
 */

(function () {
    'use strict';

    /* --------------------------------------------------------------
     * 공용 네임스페이스
     * ------------------------------------------------------------ */
    // window.OceanSheet 라는 단일 네임스페이스 안에 5개 파일이 메서드를 붙입니다.
    // 다른 파일에서 OceanSheet.state, OceanSheet.renderHeader 등으로 접근.
    var OS = window.OceanSheet = window.OceanSheet || {};

    /* --------------------------------------------------------------
     * 시트 상태 (현재 클릭된 좌표 + 보고 있는 날짜)
     * ------------------------------------------------------------ */
    OS.state = {
        lat: null,        // 클릭한 위도
        lon: null,        // 클릭한 경도
        date: new Date(), // 현재 시트가 표시 중인 날짜 (오늘 기준 시작)
        coordVisible: false, // 📍 토글 상태
        bound: false,     // 헤더 컨트롤 이벤트 바인딩 여부 (1회만)
    };

    /* --------------------------------------------------------------
     * 풍향 도(°) → 16방위 텍스트 변환 (다른 파일에서 재사용)
     * ------------------------------------------------------------ */
    var WIND_DIR_NAMES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    OS.windDirToText = function (deg) {
        if (deg == null || isNaN(deg)) return '--';
        var idx = Math.round(deg / 22.5) % 16;
        return WIND_DIR_NAMES[idx];
    };

    /* --------------------------------------------------------------
     * 날짜 → YYYYMMDD 정수 (TideBED API가 기대하는 형식)
     * ------------------------------------------------------------ */
    OS.formatDateInt = function (date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return parseInt(y + '' + m + '' + d);
    };

    /* --------------------------------------------------------------
     * "오늘"과 같은 날인지 비교 (날짜만, 시각 무시)
     * ------------------------------------------------------------ */
    OS.isToday = function (date) {
        var t = new Date();
        return date.getFullYear() === t.getFullYear()
            && date.getMonth() === t.getMonth()
            && date.getDate() === t.getDate();
    };

    /* --------------------------------------------------------------
     * 카드 표시/숨김 (DOM display 속성 토글)
     * ------------------------------------------------------------ */
    OS.showCard = function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    };
    OS.hideCard = function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    };

    /* --------------------------------------------------------------
     * 일반 6카드의 값 자리에 무한 진행바를 다시 그려 넣기
     *  (날짜 변경 시 카드 reset에 사용)
     * ------------------------------------------------------------ */
    OS.resetCardToProgress = function (valId) {
        var el = document.getElementById(valId);
        if (!el) return;
        el.classList.remove('ocean-skeleton');
        el.innerHTML = '<div class="ocean-progress-bar"><div class="ocean-progress-bar-fill"></div></div>';
    };

    /* --------------------------------------------------------------
     * 6카드 값 텍스트 설정 (응답 도착 시 진행바를 텍스트로 교체)
     * ------------------------------------------------------------ */
    OS.setCardValue = function (valId, text) {
        var el = document.getElementById(valId);
        if (!el) return;
        el.classList.remove('ocean-skeleton');
        el.textContent = text;
    };

    /* --------------------------------------------------------------
     * 시트 닫기
     * ------------------------------------------------------------ */
    // 뒤로가기 처리: 시트가 열려있는 동안 history 스택에 더미 state를 1개 push.
    // popstate가 발생하면(=뒤로가기) 시트를 닫고 끝. 닫기 버튼/✕로 닫을 때는
    // history.back()을 호출해서 그 더미 state도 같이 정리.
    OS._historyPushed = false;
    OS._closing = false;

    OS.closeSheet = function () {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;
        sheet.classList.remove('open');
        setTimeout(function () { sheet.style.display = 'none'; }, 300);
        // 사용자 클릭으로 닫는 경우: 푸시했던 더미 state를 history에서 제거
        if (OS._historyPushed && !OS._closing) {
            OS._closing = true;
            try { window.history.back(); } catch (e) {}
        }
        OS._historyPushed = false;
        OS._closing = false;
    };

    // popstate (뒤로가기 버튼) — 시트가 열려있으면 닫음
    window.addEventListener('popstate', function () {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;
        if (sheet.classList.contains('open')) {
            // popstate로 진입했으므로 history.back()을 다시 호출하지 않도록 _closing 플래그 설정
            OS._closing = true;
            OS._historyPushed = false;
            sheet.classList.remove('open');
            setTimeout(function () { sheet.style.display = 'none'; }, 300);
            OS._closing = false;
        }
    });

    /* --------------------------------------------------------------
     * 진입점 — 지도 클릭 시 ocean_map.js가 호출
     *
     * @param {number} lat 위도
     * @param {number} lon 경도
     * @param {Object} [stationInfo] 표준항 마커 정보 (현재 미사용)
     * ------------------------------------------------------------ */
    window.showOceanBottomSheet = function (lat, lon, stationInfo) {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;

        // 상태 초기화: 항상 "오늘" 부터 시작
        OS.state.lat = lat;
        OS.state.lon = lon;
        OS.state.date = new Date();

        // 시트 표시 (살짝 지연 후 transition 클래스 부여)
        sheet.style.display = 'block';
        setTimeout(function () { sheet.classList.add('open'); }, 10);

        // 휴대폰 뒤로가기 버튼으로 닫기 가능하도록 history state 푸시
        if (!OS._historyPushed) {
            try {
                window.history.pushState({ oceanSheet: true }, '');
                OS._historyPushed = true;
            } catch (e) {}
        }

        // 헤더 컨트롤 1회 바인딩 (2.js 정의)
        if (!OS.state.bound && OS.bindControls) {
            OS.bindControls();
            OS.state.bound = true;
        }

        // 헤더 렌더 (2.js)
        if (OS.renderHeader) OS.renderHeader();

        // 전체 데이터 로딩 시작 (5.js)
        if (OS.loadAllForDate) OS.loadAllForDate();
    };

    /* --------------------------------------------------------------
     * (호환) 기존 ocean_map.js의 stub getOceanDate를 더 이상 사용하지 않음.
     *   Step 5에서 stub 자체가 제거됨.
     * ------------------------------------------------------------ */
})();
