/**
 * ============================================================================
 * 바텀시트 '시정' 카드 — ocean_bottom_sheet_vsby.js
 * ============================================================================
 *
 * 역할:
 *   해점 좌표 + 선택 시각의 시정(RDPS, km)을 카드(수심 오른쪽)로 표출.
 *   지도 시정/천기 클릭 팝업과 '동일한' 점 샘플러를 재사용한다.
 *
 * 데이터 경로:
 *   1) date → KMA 가장 가까운 정시 fct_tm 문자열 (window._shrtForecastNearestFctTm)
 *   2) window._vsbyForecastSamplePointAt(lat, lon, fctTm) 호출
 *      → {value: km|null}  (vsby_forecast_layer.js, imgList+프록시 PNG 샘플)
 *   3) 값 → 카드 텍스트 ('Nkm' / '20km 이상' / '정보 없음')
 *
 * 의존:
 *   - js/vsby_forecast_layer.js : window._vsbyForecastSamplePointAt
 *   - js/shrt_forecast_layer.js : window._shrtForecastNearestFctTm
 *   - OS.setCardValue (ocean_bottom_sheet1.js)
 *
 * 호출처:
 *   - ocean_bottom_sheet5.js loadAllForDate  (해점 클릭 / 날짜 nav)
 *   - ocean_bottom_sheet2.js onTimelineChanged (슬라이더 이동)
 *   - ocean_bottom_sheet1.js closeSheet → hideVsbyCard
 * ============================================================================
 */
(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    // 동시성 토큰 — 빠른 슬라이더 이동 시 오래된 응답이 새 응답 덮지 않도록
    var _fetchToken = 0;

    /** 작은 숫자 포맷: 0 → '0', 0.5 → '0.5', 4 → '4' (소수점 1자리 반올림) */
    function _fmtNum(v) {
        if (v == null) return '';
        if (v === 0) return '0';
        return String(Math.round(v * 10) / 10);
    }

    /** km 값 → 카드 텍스트. 20 이상은 '맑음' 의미로 '20km 이상'. (클릭 팝업 행과 동일 표기) */
    function _fmtVis(v) {
        if (v == null) return '정보 없음';
        return (v >= 20) ? '20km 이상' : (_fmtNum(v) + 'km');
    }

    function _setValue(text) {
        if (OS.setCardValue) OS.setCardValue('ocean-val-vsby', text);
    }

    /**
     * [공개 API] 시정 카드 로드.
     *
     * @param {number} lat  - 위도 (EPSG:4326)
     * @param {number} lon  - 경도
     * @param {Date}   date - 표시할 시각 (KMA 가장 가까운 정시로 round)
     *
     * 동작:
     *   - 샘플러/시각변환 함수 미로드면 '정보 없음' (카드는 유지 → 수심|시정 정렬 안정)
     *   - 응답 사이 슬라이더 이동 → token 검증으로 오래된 응답 무시
     *   - 값 없음/extent 밖 → '정보 없음'
     */
    OS.loadVsbyCard = function (lat, lon, date) {
        var card = document.getElementById('ocean-card-vsby');
        if (!card) return;

        if (typeof window._vsbyForecastSamplePointAt !== 'function' ||
            typeof window._shrtForecastNearestFctTm !== 'function') {
            _setValue('정보 없음');
            return;
        }

        var fctTm = window._shrtForecastNearestFctTm(date || new Date());
        var token = ++_fetchToken;

        window._vsbyForecastSamplePointAt(lat, lon, fctTm)
            .then(function (res) {
                if (token !== _fetchToken) return;     // 더 새 fetch 가 시작됨 → 무시
                _setValue(_fmtVis(res && res.value != null ? res.value : null));
            })
            .catch(function () {
                if (token !== _fetchToken) return;
                _setValue('정보 없음');
            });
    };

    /** [공개 API] 진행 중 fetch 무효화 (시트 닫힐 때). 카드 DOM 은 그대로 둠. */
    OS.hideVsbyCard = function () {
        _fetchToken++;
    };
})();
