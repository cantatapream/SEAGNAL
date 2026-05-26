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
 * [로딩 표시 — 단일 소유 패턴]
 *   스켈레톤(.ocean-progress-bar) 초기화는 5.js 의 loadAllForDate 가 다른 5개 카드와
 *   함께 OS.resetCardToProgress 로 4셀 일괄 처리(경로 A). 슬라이더 release 등 5.js 를
 *   거치지 않는 단독 진입(경로 B) 에서는 본 파일 진입부의 _ensureLoadingSkeleton() 이
 *   "비어있을 때만" 깔아 보강. 응답 도착 후 _renderData 가 텍스트로 교체.
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

    /**
     * 4 셀에 스켈레톤이 없으면 깔기 — 슬라이더 release 등 5.js 를 거치지 않는
     * 단독 진입 경로에서 스켈레톤 누락 방지. 이미 progress-bar 가 있으면 그대로 둠.
     *
     * 스켈레톤 초기화는 5.js 의 `OS.loadAllForDate` 가 `OS.resetCardToProgress` 로 4셀
     * 일괄 처리(단일 소유 패턴); 본 함수는 그 경로를 거치지 않는 단독 호출에서만 사용.
     */
    function _ensureLoadingSkeleton() {
        ['sky', 'rain', 'sno', 'tmp'].forEach(function (id) {
            var el = document.getElementById('ocean-val-wx-' + id);
            if (!el) return;
            if (!el.querySelector('.ocean-progress-bar')) {
                _setCell(id, null);
            }
        });
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

        _setCell('sky',  hasSky ? data.sky.label                              : '하늘 정보 없음');
        _setCell('rain', _buildRainText(data.pty, data.pcp, data.pop));         // 자체적으로 8 case 처리 (없으면 "강수 정보 없음")
        // 적설 — 정상값에도 "적설 " prefix 부착. cm 단위만으로는 어느 카테고리인지 모호 → 사용자 요구.
        _setCell('sno',  hasSno ? ('적설 ' + _fmtNum(data.sno.value) + 'cm')   : '적설 예보 없음');
        // 기온 — 정상값에도 "기온 " prefix 부착. 같은 시트의 수온 카드(17°C)와 식별 분리.
        _setCell('tmp',  hasTmp ? ('기온 ' + _fmtNum(data.tmp.value) + '°C')   : '기온 정보 없음');
        _show(true);

        // [사용량] 천기 카드 표출 성공 → 천기도(C)와 통합 key 로 각 요소 +1.
        //   ★중요: 슬라이더 드래그(input→onTimelineChanged→loadWeatherCard) 로 매번
        //     _renderData 가 불려도 중복 카운트되지 않도록 loadAllForDate epoch 로 게이팅.
        //     (loadAllForDate 는 open / 날짜 nav / 슬라이더 release 에서만 epoch 증가)
        try {
            var ep = (OS.state && OS.state._loadEpoch) || 0;
            if (window.trackUsageMany && OS._wxUsageCountedEpoch !== ep) {
                OS._wxUsageCountedEpoch = ep;
                var keys = [];
                if (hasSky) keys.push('shrt.sky');
                // 강수 셀: 강수량(pcp)·강수확률(pop)·강수형태(pty) 표출 종류별로 통합 key
                if (hasPcp) keys.push('shrt.rain_amount');
                if (hasPop) keys.push('shrt.rain_prob');
                if (hasPty && !hasPcp && !hasPop) keys.push('shrt.rain_prob'); // 형태만 있을 때 대표 key
                if (hasSno) keys.push('shrt.snow');
                if (hasTmp) keys.push('shrt.temp_air');
                if (keys.length) window.trackUsageMany(keys);
            }
        } catch (e) { /* 카운트 실패는 무시 */ }
    }

    /**
     * [공개 API] 천기 카드 로드.
     *
     * @param {number} lat - 위도 (EPSG:4326)
     * @param {number} lon - 경도
     * @param {Date}   date - 표시할 시각 (KMA 가장 가까운 정시로 round)
     * @param {boolean} [forceRefresh=false] - true 면 imgList 캐시 무시 + 새 KMA fetch 강제.
     *
     * 호출 시점:
     *   - 바텀시트가 열린 직후 (해점 클릭) → forceRefresh=true (사용자 의도적 갱신)
     *   - 날짜 nav ◀▶ 버튼 → loadAllForDate → forceRefresh=true (새 날짜 = 새 데이터 의도)
     *   - 타임라인 슬라이더 이동 (OS.onTimelineChanged) → forceRefresh=false (캐시 사용)
     *
     * 동작:
     *   1) 좌표가 KMA extent 밖이면 카드 hide (이른 종료)
     *   2) [신규 — forceRefresh] 6 카테고리 imgList 캐시 무효화
     *   3) date → fct_tm 변환 (window._shrtForecastNearestFctTm)
     *   4) 카드 show + (단독 진입 보강) 4 셀 스켈레톤이 없으면 깔기 — 5.js 가 이미 깔았으면 noop
     *   5) samplePointAt 호출 → 응답 받으면 텍스트로 교체
     *   6) 응답 사이 슬라이더 이동 → token 검증으로 오래된 응답 무시
     */
    OS.loadWeatherCard = function (lat, lon, date, forceRefresh) {
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

        // [C-cache] 사용자 의도적 갱신 (해점 클릭 / 날짜 nav) 시 imgList 캐시 무효화 →
        //   다음 sample 이 KMA 에서 새로 fetch. 슬라이더 이동은 forceRefresh=false 라
        //   캐시 사용 → KMA 부하 절약.
        if (forceRefresh && typeof window._shrtForecastInvalidateImgListCache === 'function') {
            window._shrtForecastInvalidateImgListCache();
        }

        var fctTm = window._shrtForecastNearestFctTm(date || new Date());
        var token = ++_fetchToken;
        _show(true);
        // 스켈레톤 초기화 — 5.js 의 loadAllForDate 가 4셀에 progress-bar 를 먼저 깔아주는
        //   단일 소유 패턴(경로 A: 해점 클릭/날짜 nav). 슬라이더 release(경로 B) 등 5.js 를
        //   거치지 않는 단독 진입에서도 누락되지 않도록 "없으면 깔기" 조건부 처리.
        //   동일 tick 에서 5.js + 여기가 함께 깔아 innerHTML 을 두 번 덮어쓰던 이중 호출 제거.
        _ensureLoadingSkeleton();

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
