/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet_weather.js
 * 역할: 바텀시트 천기 카드 — 클릭한 해점의 KMA 단기예보 6 카테고리 종합 표시
 * ============================================================================
 *
 * [한 줄 설명]
 *   해양종합기상에서 사용자가 해점을 클릭해 바텀시트가 열리면, 천기 카드가 그
 *   좌표의 하늘상태 / 강수량 / 적설 / 기온 4개 정보를 4셀(2×2) 형태로 표시한다.
 *
 * [위치]
 *   index2.html — 조석 카드 바로 아래, 그리드(파고/풍향·속/유향·속/...) 위.
 *
 * [데이터 흐름]
 *   1) OS.loadWeatherCard(lat, lon, date) 가 호출되면 (시트 열림 또는 슬라이더 이동 시)
 *   2) date → KMA 가장 가까운 정시 fct_tm 문자열로 변환 (window._shrtForecastNearestFctTm)
 *   3) window._shrtForecastSamplePointAt(lat, lon, fctTm) 호출 (천기 popup 과 동일 함수)
 *   4) 응답 도착 → 4셀 채움 (sky / 강수량 통합 / sno / tmp)
 *   5) 4 셀 모두 데이터 없음 → 카드 hide
 *
 * [로딩 표시]
 *   호출 즉시 4셀 모두 .ocean-progress-bar 스켈레톤 → 응답 후 텍스트로 교체.
 *   다른 카드 (파고/바람/조류 등) 와 동일한 로딩 패턴.
 *
 * [데이터 없음 정책]
 *   - 하늘 상태 없음 → "정보 없음"
 *   - 강수량 통합 없음 → 8가지 케이스 (예: "강수 정보 없음" / "비 0.5mm (60%)")
 *   - 적설 없음 → "예보 없음"
 *   - 기온 없음 → "정보 없음"
 *   - 4 셀 모두 null → 카드 자체 hide (해당 좌표가 KMA extent 밖이거나 fct_tm 미존재)
 *
 * [의존]
 *   - js/shrt_forecast_layer.js: window._shrtForecastSamplePointAt, _shrtForecastNearestFctTm
 *   - js/ocean_bottom_sheet1.js: window.OceanSheet (OS) 네임스페이스
 *   - index2.html: #ocean-card-weather, #ocean-val-wx-{sky,rain,sno,tmp}
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

    /**
     * 강수량 줄 텍스트 빌드 — pty/pcp/pop 8가지 조합별 메시지.
     * 천기 popup 의 _buildRainText 와 동일 정책 (사용자 명세).
     */
    function _buildRainText(pty, pcp, pop) {
        var hasPty = !!(pty && pty.label);
        var hasPcp = !!(pcp && pcp.value != null);
        var hasPop = !!(pop && pop.value != null);
        var ptyText = hasPty ? pty.label : '강수';
        var pcpText = hasPcp ? (_fmtNum(pcp.value) + 'mm') : null;
        if (hasPty) {
            if (hasPcp && hasPop)  return ptyText + ' ' + pcpText + ' (' + pop.value + '%)';
            if (hasPcp && !hasPop) return ptyText + ' ' + pcpText;
            if (!hasPcp && hasPop) return ptyText + ' (' + pop.value + '%)';
            return ptyText;
        }
        if (hasPcp && hasPop)  return '강수 ' + pcpText + ' (' + pop.value + '%)';
        if (hasPcp && !hasPop) return '강수 ' + pcpText;
        if (!hasPcp && hasPop) return '강수확률 ' + pop.value + '%';
        return '강수 정보 없음';
    }

    /**
     * 4 셀 값 영역에 텍스트 또는 스켈레톤 채움.
     * @param {string} id - 'sky' | 'rain' | 'sno' | 'tmp'
     * @param {string|null} text - null 이면 스켈레톤 (progress-bar)
     */
    function _setCell(id, text) {
        var el = document.getElementById('ocean-val-wx-' + id);
        if (!el) return;
        if (text == null) {
            el.innerHTML = '<div class="ocean-progress-bar"><div class="ocean-progress-bar-fill"></div></div>';
        } else {
            el.textContent = text;
        }
    }

    /** 4 셀 모두 스켈레톤 (로딩 상태) */
    function _renderLoading() {
        _setCell('sky', null);
        _setCell('rain', null);
        _setCell('sno', null);
        _setCell('tmp', null);
    }

    /** 카드 보임/숨김 */
    function _show(visible) {
        var card = document.getElementById('ocean-card-weather');
        if (!card) return;
        card.style.display = visible ? '' : 'none';
    }

    /**
     * 응답 데이터 → 4 셀 텍스트 채움. 4 셀 모두 데이터 없으면 카드 hide.
     *
     * [라벨 없는 디자인 — 카테고리명을 값에 포함]
     *   라벨/콜론 제거 후 4 셀에 값만 표시되므로, 데이터가 없을 때 사용자가 어느 카테고리
     *   인지 알 수 있도록 메시지에 카테고리명을 포함:
     *     - 하늘 → "하늘 정보 없음"
     *     - 강수 → "강수 정보 없음"  (8가지 case 안에 자체 정의되어 있음)
     *     - 적설 → "적설 예보 없음"  (사용자 명시 — '적설' 단어 + '예보 없음' 어미)
     *     - 기온 → "기온 정보 없음"
     */
    function _renderData(data) {
        if (!data) { _show(false); return; }
        var hasSky  = !!(data.sky && data.sky.label);
        var hasPty  = !!(data.pty && data.pty.label);
        var hasPcp  = !!(data.pcp && data.pcp.value != null);
        var hasPop  = !!(data.pop && data.pop.value != null);
        var hasSno  = !!(data.sno && data.sno.value != null);
        var hasTmp  = !!(data.tmp && data.tmp.value != null);
        var hasRain = hasPty || hasPcp || hasPop;   // 강수 라인은 셋 중 하나라도 있으면 표출
        var hasAny  = hasSky || hasRain || hasSno || hasTmp;
        if (!hasAny) { _show(false); return; }

        _setCell('sky',  hasSky ? data.sky.label                          : '하늘 정보 없음');
        _setCell('rain', _buildRainText(data.pty, data.pcp, data.pop));     // 자체적으로 8 case 처리 (없으면 "강수 정보 없음")
        _setCell('sno',  hasSno ? (_fmtNum(data.sno.value) + 'cm')         : '적설 예보 없음');
        // 기온 — 정상값에도 "기온 " prefix 부착. 이유: 같은 시트에 수온 카드 (17°C 식)
        // 가 있어 "17°C" 만으로는 어느 것인지 식별 곤란 — 사용자 요구로 카테고리명 노출.
        _setCell('tmp',  hasTmp ? ('기온 ' + _fmtNum(data.tmp.value) + '°C') : '기온 정보 없음');
        _show(true);
    }

    /**
     * [공개 API] 천기 카드 로드.
     *
     * @param {number} lat - 위도 (EPSG:4326)
     * @param {number} lon - 경도
     * @param {Date}   date - 표시할 시각 (KMA 가장 가까운 정시로 round)
     *
     * 호출 시점:
     *   - 바텀시트가 열린 직후 (ocean_bottom_sheet5.js loadAllForDate)
     *   - 타임라인 슬라이더 이동 시 (OS.onTimelineChanged 가 자체 호출하거나
     *     loadAllForDate 가 매 변경 시 다시 호출)
     *
     * 동작:
     *   1) 좌표가 KMA extent 밖이면 카드 hide (이른 종료)
     *   2) date → fct_tm 변환 (window._shrtForecastNearestFctTm)
     *   3) 4 셀 스켈레톤 표시 + 카드 show
     *   4) samplePointAt 호출 → 응답 받으면 텍스트로 교체
     *   5) 응답 사이 슬라이더 이동 → token 검증으로 오래된 응답 무시
     */
    OS.loadWeatherCard = function (lat, lon, date) {
        var card = document.getElementById('ocean-card-weather');
        if (!card) return;

        // KMA extent 검사 (천기 popup 과 동일)
        if (lon < 123.27 || lon > 132.88 || lat < 31.58 || lat > 43.45) {
            _show(false);
            return;
        }
        // shrt_forecast_layer.js 가 로드되지 않았으면 (init 전) — 카드 hide
        if (typeof window._shrtForecastSamplePointAt !== 'function' ||
            typeof window._shrtForecastNearestFctTm !== 'function') {
            _show(false);
            return;
        }

        var fctTm = window._shrtForecastNearestFctTm(date || new Date());
        var token = ++_fetchToken;
        _show(true);
        _renderLoading();

        window._shrtForecastSamplePointAt(lat, lon, fctTm)
            .then(function (data) {
                if (token !== _fetchToken) return;     // 더 새 fetch 가 시작됨 → 무시
                _renderData(data);
            })
            .catch(function (e) {
                if (token !== _fetchToken) return;
                console.warn('[weather-card] sample 실패:', e && e.message);
                _show(false);    // 에러 시 카드 hide (다른 카드 영향 X)
            });
    };

    /** [공개 API] 카드 강제 숨김 — 시트 닫힐 때 호출 */
    OS.hideWeatherCard = function () {
        _show(false);
        _fetchToken++;   // 진행 중 fetch 결과 무시
    };
})();
