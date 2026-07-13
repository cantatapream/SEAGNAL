/**
 * ============================================================================
 * 바텀시트 '시정' 카드 — ocean_bottom_sheet_vsby.js
 * ============================================================================
 *
 * 역할:
 *   클릭한 해점(lat/lon)이 속한 '소해구'의 래스터 시정 시계열을 받아,
 *   현재 선택 시각에 가장 가까운 값을 시정 카드(수심 오른쪽)로 표출.
 *
 * 데이터 경로:
 *   1) GET /api/vsby-smallzone/point?lat&lon
 *        → {success, cell:"144-9", baseTm, series:[{t:"2026.06.12 02:00", v:<km>}, ...], cached}
 *        series.t = "YYYY.MM.DD HH:mm" (KST, 1시간 간격), v = km (11단계 버킷)
 *   2) 현재 선택 시각(OS.state.date)에 가장 가까운 series 시각의 v 를 선택
 *   3) 값 → 카드 텍스트 ('Nkm' / '20km' / '정보 없음')
 *
 * 캐시:
 *   - 같은 좌표면 재요청 없이 캐시된 series 로 시각만 갱신 (슬라이더 이동 즉답).
 *
 * 의존:
 *   - OS.setCardValue (ocean_bottom_sheet1.js)
 *   - OS.state.date  (현재 선택 시각, ocean_bottom_sheet2.js onTimelineChanged 가 갱신)
 *
 * 호출처(시그니처 유지):
 *   - ocean_bottom_sheet5.js loadAllForDate  : OS.loadVsbyCard(lat, lon, date)
 *   - ocean_bottom_sheet2.js onTimelineChanged: OS.loadVsbyCard(lat, lon, date)
 *   - ocean_bottom_sheet1.js closeSheet       : OS.hideVsbyCard()
 * ============================================================================
 */
(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    var VSBY_MAX = 20; // km 상한 클램프

    // 동시성 토큰 — 빠른 슬라이더 이동 시 오래된 응답이 새 응답 덮지 않도록
    var _fetchToken = 0;

    // 시계열 캐시 — 같은 좌표면 재요청 없이 시각만 갱신
    //   _cacheKey: "lat,lon" (소수점 4자리), _cacheSeries: 정규화된 [{key:<number>, v:<km|null>}, ...]
    var _cacheKey = null;
    var _cacheSeries = null;

    /** 좌표 캐시 키 (소수점 4자리 ≈ 11m 격자, 소해구 단위로 충분히 안정) */
    function _keyOf(lat, lon) {
        return Number(lat).toFixed(4) + ',' + Number(lon).toFixed(4);
    }

    /** 작은 숫자 포맷: 0 → '0', 0.5 → '0.5', 4 → '4' (소수점 1자리 반올림) */
    function _fmtNum(v) {
        if (v == null) return '';
        if (v === 0) return '0';
        return String(Math.round(v * 10) / 10);
    }

    /** km 값 → 카드 텍스트. 20 이상은 '20km' (상한 클램프). */
    function _fmtVis(v) {
        if (v == null || !isFinite(v)) return '정보 없음';
        if (v >= VSBY_MAX) return VSBY_MAX + 'km';
        return _fmtNum(v) + 'km';
    }

    function _setValue(text) {
        if (OS.setCardValue) OS.setCardValue('ocean-val-vsby', text);
    }

    /**
     * series.t ("YYYY.MM.DD HH:mm", KST) → 비교용 정수 키 (YYYYMMDDHHmm).
     * 타임존 변환 없이 KST 벽시계 그대로 비교하므로 브라우저 TZ 무관.
     * 파싱 실패 시 null.
     */
    function _tKey(t) {
        if (typeof t !== 'string') return null;
        var m = t.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1] + m[2] + m[3] + m[4] + m[5]);
    }

    /**
     * 선택 시각(Date) → KST 벽시계 정수 키 (YYYYMMDDHHmm).
     * 서버 series 가 KST 이므로 Date 도 KST 로 환산해 동일 척도에서 비교.
     */
    function _dateKey(date) {
        var d = (date instanceof Date && !isNaN(date)) ? date : new Date();
        // UTC+9 (KST) 벽시계로 환산
        var kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        var Y = kst.getUTCFullYear();
        var M = kst.getUTCMonth() + 1;
        var D = kst.getUTCDate();
        var h = kst.getUTCHours();
        var mi = kst.getUTCMinutes();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return Number('' + Y + p(M) + p(D) + p(h) + p(mi));
    }

    /**
     * 서버 series → 정규화 배열 [{key:<number>, v:<km|null>}, ...].
     * v 는 숫자만 채택, 격자/버킷 외 값은 null.
     */
    function _normalize(series) {
        var out = [];
        if (!Array.isArray(series)) return out;
        for (var i = 0; i < series.length; i++) {
            var s = series[i];
            if (!s) continue;
            var key = _tKey(s.t);
            if (key == null) continue;
            var v = (typeof s.v === 'number' && isFinite(s.v)) ? s.v : null;
            out.push({ key: key, v: v });
        }
        return out;
    }

    /** 정규화 series + 선택 시각 → 가장 가까운 시각의 km 값 (없으면 null). */
    function _valueAt(norm, date) {
        if (!Array.isArray(norm) || !norm.length) return null;
        var target = _dateKey(date);
        var best = null, bestDiff = Infinity;
        for (var i = 0; i < norm.length; i++) {
            var diff = Math.abs(norm[i].key - target);
            if (diff < bestDiff) { bestDiff = diff; best = norm[i]; }
        }
        return best ? best.v : null;
    }

    /** 캐시된 series 로 카드 값만 갱신 (재요청 없음). */
    function _renderFromCache(date) {
        _setValue(_fmtVis(_valueAt(_cacheSeries, date)));
    }

    /**
     * [공개 API] 시정 카드 로드.
     *
     * @param {number} lat  - 위도 (EPSG:4326)
     * @param {number} lon  - 경도
     * @param {Date}   date - 표시할 시각 (series 중 가장 가까운 시각으로 매칭)
     *
     * 동작:
     *   - 같은 좌표면 캐시 series 로 시각만 갱신 (네트워크 없음)
     *   - 새 좌표면 /api/vsby-smallzone/point 호출 → series 캐시 → 값 표출
     *   - 응답 사이 슬라이더 이동 → token 검증으로 오래된 응답 무시
     *   - 격자 밖/무데이터/실패 → '정보 없음' (카드 DOM 유지 → 수심|시정 정렬 안정)
     */
    OS.loadVsbyCard = function (lat, lon, date) {
        var card = document.getElementById('ocean-card-vsby');
        if (!card) return;

        if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) {
            _setValue('정보 없음');
            return;
        }

        var key = _keyOf(lat, lon);

        // 같은 좌표 → 재요청 없이 시각만 갱신
        if (key === _cacheKey && _cacheSeries) {
            _renderFromCache(date);
            return;
        }

        var token = ++_fetchToken;
        var url = '/api/vsby-smallzone/point?lat=' + encodeURIComponent(lat) +
                  '&lon=' + encodeURIComponent(lon);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (token !== _fetchToken) return;     // 더 새 fetch 가 시작됨 → 무시
                if (!res || res.success !== true || !Array.isArray(res.series) || !res.series.length) {
                    _cacheKey = null; _cacheSeries = null;
                    _setValue('정보 없음');
                    return;
                }
                _cacheKey = key;
                _cacheSeries = _normalize(res.series);
                _renderFromCache(date);
            })
            .catch(function () {
                if (token !== _fetchToken) return;
                _cacheKey = null; _cacheSeries = null;
                _setValue('정보 없음');
            });
    };

    /** [공개 API] 진행 중 fetch 무효화 (시트 닫힐 때). 카드 DOM/캐시 는 그대로 둠. */
    OS.hideVsbyCard = function () {
        _fetchToken++;
    };
})();
