/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet5.js
 * 역할: 6개 일반 카드 + 저질 분석 + 전체 오케스트레이터
 * ============================================================================
 *
 * [오케스트레이터 loadAllForDate]
 * 1. 모든 카드 reset (조석/천문은 1.js show, 6카드는 진행바 복원)
 * 2. 천문 카드 즉시 렌더 (SunCalc 동기) — 4.js
 * 3. 조석 카드 비동기 로딩 시작 — 3.js
 * 4. 6개 일반 카드: 오늘이면 호출, 아니면 즉시 숨김
 *    (현재 단계에서 백엔드 오류 시에는 자동으로 카드 숨김)
 * 5. 저질 버튼은 항상 표시
 *
 * [카드 자동 숨김 정책]
 * 응답이 success === false 거나 catch로 빠지면 hideCard() 호출.
 * 백엔드가 정상화되면 자동으로 카드가 다시 나타남.
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    /* --------------------------------------------------------------
     * 오케스트레이터
     *
     * @param {Object} [opts] 선택 옵션
     *   - skipHeavy {boolean}: true 면 조석 API 호출 + 천문 렌더 skip.
     *       시트 슬라이더 release 가 "같은 날 안의 시간 변경" 인 경우 사용.
     *       이 때 호출자가 별도로 OS.refreshTideGaugeForTime() 을 호출해 게이지만 갱신.
     *       천문(일출몰/월령) 은 날짜 같으면 결과 동일이므로 skip 해도 무방.
     *       시간 의존 카드(천기/파고/풍/유향속/수온) 는 skipHeavy 무관하게 항상 갱신.
     * ------------------------------------------------------------ */
    OS.loadAllForDate = function (opts) {
        opts = opts || {};
        var skipHeavy = !!opts.skipHeavy;
        var lat = OS.state.lat;
        var lon = OS.state.lon;
        var d = OS.state.date;

        // (1) 조석/천문/월상 카드 일단 표시 (3.js, 4.js가 채울 자리)
        OS.showCard('ocean-card-tide');
        OS.showCard('ocean-card-astro');
        OS.showCard('ocean-card-moon');

        // (2) 5개 일반카드 reset → 진행바 표시 + 카드 보이기
        ['ocean-val-depth', 'ocean-val-temp', 'ocean-val-current',
         'ocean-val-wind', 'ocean-val-wave'
        ].forEach(function (id) { OS.resetCardToProgress(id); });

        ['ocean-card-depth', 'ocean-card-temp', 'ocean-card-current',
         'ocean-card-wind', 'ocean-card-wave'
        ].forEach(function (id) { OS.showCard(id); });

        // raw 값 초기화 (날짜/위치 변경 시 이전 값 잔류 방지)
        OS.state.rawCrsp = null; OS.state.rawCrdir = null;
        OS.state.rawWindSpeed = null; OS.state.rawWindDir = null;

        // KTS 토글 클릭 핸들러 (해류/바람 아이콘)
        ['ocean-icon-current', 'ocean-icon-wind'].forEach(function (iconId) {
            var el = document.getElementById(iconId);
            if (el) {
                el.onclick = function () {
                    OS.state.useKts = !OS.state.useKts;
                    OS.renderCurrentWindValues();
                    // [양방향 동기] 카드 아이콘 클릭으로도 지도 범례 갱신 — 사용자가 어디서
                    //   토글하든 범례/카드 단위 일관성 유지 (사용자 명세).
                    if (typeof window.oceanOverlayUpdateLegend === 'function') {
                        try { window.oceanOverlayUpdateLegend(); } catch (e) {}
                    }
                };
            }
        });

        // (3) 천문 / 월상 / 조석 — heavy. 같은 날 갱신 시 skip.
        //     - 천문(일출몰/월령): SunCalc 동기 계산. 날짜 같으면 결과 동일 → skip 무해.
        //     - 조석: API 호출 (백엔드/KHOA). 호출 비용 큼 → 같은 날엔 게이지만 클라이언트 재계산.
        if (!skipHeavy) {
            if (OS.renderAstroCard) OS.renderAstroCard(lat, lon, d);
            if (OS.renderMoonCard)  OS.renderMoonCard(lat, lon, d);
            if (OS.fetchTideForSheet) OS.fetchTideForSheet(lat, lon, d);
        }

        // (4) 천기 카드: KMA 단기예보 6 카테고리 종합 (해당 좌표가 KMA extent 안일 때만 표시).
        //     forceRefresh=true (skipHeavy=false): 풀 재로드 — imgList 캐시 무효화 + KMA 새 fetch.
        //     forceRefresh=false (skipHeavy=true): 슬라이더 이동(같은 날) — 기존 캐시 재사용 → KMA 부하 절약.
        if (OS.loadWeatherCard) OS.loadWeatherCard(lat, lon, d, /*forceRefresh*/ !skipHeavy);

        // (5) 시간 의존 카드 — skipHeavy 무관하게 항상 갱신 (시각이 바뀌었으므로).
        //     수심(fetchDepth) 은 시간 무관이지만 같은 lat/lon 이면 백엔드 캐시 적중 → 부담 X.
        fetchDepth(lat, lon);
        fetchRoms(lat, lon, d);
        fetchWeather(lat, lon, d);
        fetchWave(lat, lon, d);

    };

    /* --------------------------------------------------------------
     * 6개 일반 카드 fetch — 응답이 없거나 실패하면 카드 숨김
     * ------------------------------------------------------------ */
    function fetchDepth(lat, lon) {
        fetch('/api/ocean/depth?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success && data.depth != null) {
                    OS.setCardValue('ocean-val-depth', data.depth.toFixed(1) + ' m');
                    OS.showCard('ocean-card-depth');
                } else {
                    // 수심 데이터 없음 → 카드 자체를 숨김
                    OS.hideCard('ocean-card-depth');
                }
            })
            .catch(function () { OS.hideCard('ocean-card-depth'); });
    }

    /**
     * 수온(wtem) + 유향·유속(crsp/crdir) 카드를 KHOA 해아름 stream-vector
     * 격자 캐시로 채움. 이전엔 공공데이터포털 ROMS API 단일좌표 호출이었지만
     * 격자 캐시(서버 1시간 TTL) 가 더 빠르고 안정적이라 교체된 형태.
     *
     * [표시 동작]
     *   - data.wtem 있음 → ocean-val-temp 갱신 + ocean-card-temp 표시
     *   - data.crsp/crdir 있음 → state.rawCrsp/rawCrdir 저장 후
     *     OS.renderCurrentWindValues() 가 단위·방향 텍스트 합성
     *   - 데이터 없음/오류 → "데이터 없음" 텍스트
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date=} dateObj - 미지정 시 now
     */
    function fetchRoms(lat, lon, dateObj) {
        // KHOA 해아름 stream-vector(전 해역 격자) 캐시에서 가장 가까운 점 1개 조회.
        // 기존 공공데이터포털 ROMS API 단일좌표 호출보다 빠르고, 같은 시각이면
        // 서버 캐시(1시간 TTL)로 즉시 응답된다.
        var dateStr = '', hourStr = '';
        try {
            var d = dateObj || new Date();
            dateStr = d.getFullYear() +
                String(d.getMonth() + 1).padStart(2, '0') +
                String(d.getDate()).padStart(2, '0');
            // dateObj는 이미 슬라이더 오프셋이 반영된 시각이므로 해당 시각의 시(hour) 사용
            hourStr = String(d.getHours()).padStart(2, '0');
        } catch (e) { /* fall through */ }

        var url = '/api/ocean/khoa-stream-nearest?lat=' + lat + '&lon=' + lon;
        if (dateStr) url += '&date=' + dateStr + '&hour=' + hourStr;

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    OS.setCardValue('ocean-val-temp', '데이터 없음');
                    OS.setCardValue('ocean-val-current', '데이터 없음');
                    return;
                }
                if (data.wtem != null) {
                    OS.setCardValue('ocean-val-temp', data.wtem.toFixed(1) + '\u00B0C');
                    OS.showCard('ocean-card-temp');
                } else {
                    OS.setCardValue('ocean-val-temp', '데이터 없음');
                }
                if (data.crsp != null && data.crdir != null) {
                    OS.state.rawCrsp = data.crsp;
                    OS.state.rawCrdir = data.crdir;
                    OS.renderCurrentWindValues();
                    OS.showCard('ocean-card-current');
                } else {
                    OS.setCardValue('ocean-val-current', '데이터 없음');
                }
            })
            .catch(function () {
                OS.setCardValue('ocean-val-temp', '데이터 없음');
                OS.setCardValue('ocean-val-current', '데이터 없음');
            });
    }

    /**
     * 풍향·풍속 카드를 /api/ocean/weather 로부터 채움.
     * data.windDir/windSpeed 있을 때만 표시, 없으면 카드 자체 숨김.
     * (예: 좌표가 예보 범위 밖이거나 응답 실패)
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date=} dateObj - 슬라이더 시각 (있으면 ISO 문자열로 ?time=...)
     */
    function fetchWeather(lat, lon, dateObj) {
        var url = '/api/ocean/weather?lat=' + lat + '&lon=' + lon;
        if (dateObj) url += '&time=' + encodeURIComponent(dateObj.toISOString());
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    // 데이터 없음(범위 초과 등) → 카드 자체를 숨김
                    OS.hideCard('ocean-card-wind');
                    return;
                }
                if (data.windDir != null && data.windSpeed != null) {
                    OS.state.rawWindSpeed = data.windSpeed;
                    OS.state.rawWindDir = data.windDir;
                    OS.renderCurrentWindValues();
                    OS.showCard('ocean-card-wind');
                } else {
                    OS.hideCard('ocean-card-wind');
                }
            })
            .catch(function () { OS.hideCard('ocean-card-wind'); });
    }

    /**
     * 파고 카드를 /api/ocean/wave 로부터 채움.
     * data.waveHeight 있을 때만 표시, 없으면 카드 자체 숨김.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date=} dateObj - 슬라이더 시각 (있으면 ISO 문자열로 ?time=...)
     */
    function fetchWave(lat, lon, dateObj) {
        var url = '/api/ocean/wave?lat=' + lat + '&lon=' + lon;
        if (dateObj) url += '&time=' + encodeURIComponent(dateObj.toISOString());
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.success && data.waveHeight != null) {
                    OS.setCardValue('ocean-val-wave', data.waveHeight.toFixed(1) + ' m');
                    OS.showCard('ocean-card-wave');
                } else {
                    // 데이터 없음(범위 초과 등) → 카드 자체를 숨김
                    OS.hideCard('ocean-card-wave');
                }
            })
            .catch(function () { OS.hideCard('ocean-card-wave'); });
    }

    /* --------------------------------------------------------------
     * 해류/바람 단위 렌더 (m/s ↔ kts 토글)
     * rawCrsp(cm/s), rawWindSpeed(m/s) 원시값으로부터 계산.
     * 해류/바람 아이콘 클릭 시 호출.
     * ------------------------------------------------------------ */
    /* 조류·바람 값을 방향(위)과 수치(아래) 2줄로 렌더링합니다.
     * 예시:
     *   동남동       ← 방향 (16방위)
     *   5.3 m/s      ← 수치 (m/s 또는 kts)
     *
     * 아이콘 클릭으로 m/s ↔ kts 전환 시에도 동일 구조를 유지합니다.
     * 값이 없을 때("데이터 없음")는 이 함수가 호출되지 않으므로
     * 2줄 구조는 실제 데이터가 있을 때만 적용됩니다. */
    OS.renderCurrentWindValues = function () {
        var useKts = OS.state.useKts;

        // 조류: cm/s → m/s 또는 kts 변환 후 2줄 HTML로 삽입
        if (OS.state.rawCrsp != null && OS.state.rawCrdir != null) {
            var crMs = OS.state.rawCrsp / 100;
            var crDir = OS.windDirToText(OS.state.rawCrdir);
            var crNum = useKts
                ? (crMs * 1.944).toFixed(2) + ' kts'
                : crMs.toFixed(2) + ' m/s';
            var crEl = document.getElementById('ocean-val-current');
            if (crEl) {
                crEl.classList.remove('ocean-skeleton');
                // 방향 한 줄 + 수치 한 줄 구조로 삽입
                crEl.innerHTML =
                    '<div class="ocean-val-dir-wrap">' +
                      '<span class="ocean-val-dir-text">' + crDir + '</span>' +
                      '<span class="ocean-val-num-text">' + crNum + '</span>' +
                    '</div>';
            }
            var crIcon = document.getElementById('ocean-icon-current');
            if (crIcon) crIcon.classList.toggle('kts-active', useKts);
        }

        // 바람: m/s 또는 kts 변환 후 2줄 HTML로 삽입
        if (OS.state.rawWindSpeed != null && OS.state.rawWindDir != null) {
            var wMs = OS.state.rawWindSpeed;
            var wDir = OS.windDirToText(OS.state.rawWindDir);
            var wNum = useKts
                ? (wMs * 1.944).toFixed(1) + ' kts'
                : wMs.toFixed(1) + ' m/s';
            var wEl = document.getElementById('ocean-val-wind');
            if (wEl) {
                wEl.classList.remove('ocean-skeleton');
                wEl.innerHTML =
                    '<div class="ocean-val-dir-wrap">' +
                      '<span class="ocean-val-dir-text">' + wDir + '</span>' +
                      '<span class="ocean-val-num-text">' + wNum + '</span>' +
                    '</div>';
            }
            var wIcon = document.getElementById('ocean-icon-wind');
            if (wIcon) wIcon.classList.toggle('kts-active', useKts);
        }
    };

    /* --------------------------------------------------------------
     * 저질 + 해도 수심 AI 분석
     * - 클라이언트 뷰포트 캡처 방식 제거
     * - 서버에서 해아름 WMS 이미지를 직접 취득하여 Gemini 분석
     * ------------------------------------------------------------ */

    /* --------------------------------------------------------------
     * [시트 ↔ 레이어 슬라이더 동기]
     *
     * 시트 슬라이더 release 시점에 호출 (ocean_bottom_sheet2.js OS.SheetTL.onRelease 안).
     * 시트 슬라이더 시각 → 레이어 슬라이더 value 로 변환 + 활성 레이어 데이터 reload.
     *
     * [동작]
     *   1) 시트 슬라이더 시각(epoch ms) → "현재로부터 N시간" 변환
     *   2) 레이어 슬라이더 step (조류=1, 파고/풍=3) 에 round 스냅
     *   3) 레이어 슬라이더 max 로 클램프
     *   4) layerSlider.value = N + window.oceanOverlaySetTime(N) 호출
     *      → 활성 오버레이 (wave/wind/current) 가 새 시각 데이터 reload
     *
     * [방향 단방향]
     *   시트 슬라이더 → 레이어 슬라이더만 동기 (사용자 합의: 시트 열린 동안 레이어
     *   슬라이더 가려져 사용자 조작 불가).
     * ------------------------------------------------------------ */
    /* --------------------------------------------------------------
     * [예보 범위 외 가시성 정책 — 사용자 합의]
     *
     * 시트의 현재 표시 시각(OS.state.date) 이 wave/wind 예보 범위(now ~ now+max) 안인지
     * 판정해서 슬라이더 + 5개 예보 의존 카드의 표시 여부를 결정.
     *
     * [표시 정책]
     *   범위 안: 슬라이더 표시 + 5개 카드 표시 (loadAllForDate 가 자체 처리)
     *   범위 밖: 슬라이더 숨김 + 5개 카드 강제 hide
     *
     * [숨김 대상 카드 (5개)]
     *   - ocean-card-wave    (파고)
     *   - ocean-card-wind    (풍향풍속)
     *   - ocean-card-current (유향유속)
     *   - ocean-card-temp    (수온)
     *   - ocean-card-weather (천기 — KMA 단기예보)
     *
     * [항상 표시 카드 (날짜 무관)]
     *   - ocean-card-tide    (조석 — 매일 발표)
     *   - ocean-card-astro   (천문 — SunCalc 클라이언트 계산)
     *   - ocean-card-moon    (월상 — 클라이언트 계산)
     *   - ocean-card-depth   (수심 — 위치 기반 정적)
     *
     * [호출 시점]
     *   1) OS.goPrev / OS.goNext (◀/▶ 날짜 변경) 직후
     *   2) showOceanBottomSheet 끝 (시트 첫 오픈 시 안전 가드)
     *   3) STL.onRelease 안 (시트 슬라이더 release 시 — 일반적으로 in-range 보장됨)
     * ------------------------------------------------------------ */
    OS._enforceForecastRangeVisibility = function () {
        var sheetDate = OS.state && OS.state.date;
        if (!sheetDate) return;

        var now = new Date();
        var deltaH = (sheetDate.getTime() - now.getTime()) / 3600000;

        // wave/wind max 는 레이어 슬라이더의 현재 max 를 신뢰 (layer 활성/zone-forecasts 응답으로 갱신됨).
        var layerSlider = document.getElementById('ocean-timeline-slider');
        var lmax = layerSlider ? (parseFloat(layerSlider.max) || 72) : 72;

        // 약간의 buffer (-1h ~ +0.5h) 로 경계에서 jitter 방지
        var inRange = (deltaH >= -1) && (deltaH <= lmax + 0.5);

        if (inRange) {
            // 슬라이더 표시 (max=0 인 경우는 STL 내부에서 자체 가드)
            if (OS.SheetTL && typeof OS.SheetTL.setVisible === 'function') {
                OS.SheetTL.setVisible(true);
            }
            // 5개 카드는 loadAllForDate 가 자체 fetch 결과로 표시 처리하므로 명시 X
        } else {
            // 슬라이더 숨김
            if (OS.SheetTL && typeof OS.SheetTL.setVisible === 'function') {
                OS.SheetTL.setVisible(false);
            }
            // 5개 예보 의존 카드 강제 hide
            ['ocean-card-wave', 'ocean-card-wind', 'ocean-card-current',
             'ocean-card-temp', 'ocean-card-weather'].forEach(function (id) {
                if (typeof OS.hideCard === 'function') OS.hideCard(id);
            });
        }
    };

    OS._syncLayerSliderToSheet = function () {
        if (!OS.SheetTL) return;
        var layerSlider = document.getElementById('ocean-timeline-slider');
        if (!layerSlider) return;

        var sheetDate = OS.SheetTL.getCurrentDate();
        var deltaH = (sheetDate.getTime() - Date.now()) / 3600000;
        var layerHours = Math.max(0, Math.round(deltaH));  // 음수(과거) → 0 (=현재)

        // step 스냅 (레이어 슬라이더 자체 step 기준)
        var step = parseInt(layerSlider.step, 10) || 3;
        layerHours = Math.round(layerHours / step) * step;

        // max 클램프
        var lmax = parseFloat(layerSlider.max) || 72;
        layerHours = Math.min(layerHours, lmax);

        layerSlider.value = layerHours;

        // 활성 오버레이 데이터 reload (활성 레이어 없으면 ocean_overlay 가 자체 가드로 무동작)
        if (typeof window.oceanOverlaySetTime === 'function') {
            try { window.oceanOverlaySetTime(layerHours); } catch (e) { /* swallow */ }
        }
    };
})();
