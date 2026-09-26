/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet5.js
 * 역할: 7개 일반 카드 + 전체 오케스트레이터
 * [연계]
 *  - 사용하는 파일 : ocean_bottom_sheet3.js(OS.fetchTideForSheet), ocean_bottom_sheet4.js(OS.renderAstroCard/renderMoonCard),
 *                    ocean_bottom_sheet_weather/vsby.js(OS.loadWeatherCard/loadVsbyCard), ocean_bottom_sheet1.js(OS 유틸)
 *  - 서버 API      : GET /api/ocean/depth · GET /api/ocean/pressure
 *  - 마크업        : index2.html #ocean-card-{tide,astro,moon,depth,temp,current,wind,wave,vsby,pressure},
 *                    #ocean-val-{depth,temp,current,wind,wave,vsby,pressure}, #ocean-icon-{current,wind}
 *  - 나를 쓰는 곳  : OS.loadAllForDate — ocean_bottom_sheet1.js(showOceanBottomSheet),
 *                    ocean_bottom_sheet2.js(goPrev/goNext/SheetTL.onRelease)
 * ============================================================================
 *
 * [오케스트레이터 loadAllForDate]
 * 1. 모든 카드 reset (조석/천문은 1.js show, 6카드는 진행바 복원)
 * 2. 천문 카드 즉시 렌더 (SunCalc 동기) — 4.js
 * 3. 조석 카드 비동기 로딩 시작 — 3.js
 * 4. 7개 일반 카드: 오늘이면 호출, 아니면 즉시 숨김
 *    (현재 단계에서 백엔드 오류 시에는 자동으로 카드 숨김)
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
     * @param {Object} [opts]
     *   - skipHeavy {boolean}: true 면 조석 API + 천문 렌더 skip.
     *       시트 슬라이더 release 가 "같은 날 안의 시간 변경" 인 경우 사용.
     *       이 때 호출자가 별도로 OS.refreshTideGaugeForTime() 을 호출해 게이지만 갱신.
     *       시간 의존 카드(천기/파고/풍/유향속/수온) 는 skipHeavy 무관하게 항상 갱신.
     *
     * [fetch race 토큰]
     *   진입 시 OS.state._loadEpoch++. 각 fetch 응답 시 epoch 비교해 stale 응답 무시.
     *   ◀/▶ 빠른 연타 / closeSheet 직후 응답 도착 / 슬라이더 release 후 사용자 즉시 다른 동작
     *   같은 race 시나리오에서 카드 데이터 비대칭 (wind 만 보이는 등) 방지.
     * ------------------------------------------------------------ */
    OS.loadAllForDate = function (opts) {
        opts = opts || {};
        var skipHeavy = !!opts.skipHeavy;
        // [사용량] 바텀시트를 통해 데이터를 얻으면(열기/날짜 변경 = full load) '바텀시트' 1건으로 통합 집계.
        //   같은 날 게이지 갱신(skipHeavy)은 새 데이터를 받는 게 아니므로 카운트하지 않는다.
        //   개별 요소(조석/천문/월령/수심/수온/바람/조류/파고/천기)는 더 이상 따로 집계하지 않는다.
        if (!skipHeavy && window.trackUsage) window.trackUsage('sheet.bottom_sheet');
        var lat = OS.state.lat;
        var lon = OS.state.lon;
        var d = OS.state.date;

        // epoch 토큰 발급 — 이번 호출의 응답만 유효
        OS.state._loadEpoch = (OS.state._loadEpoch || 0) + 1;
        var myEpoch = OS.state._loadEpoch;

        // (1) 조석/천문/월상 카드 일단 표시 (3.js, 4.js가 채울 자리)
        OS.showCard('ocean-card-tide');
        OS.showCard('ocean-card-astro');
        OS.showCard('ocean-card-moon');

        // (2) 7개 일반카드 reset → 진행바 표시 + 카드 보이기
        ['ocean-val-depth', 'ocean-val-temp', 'ocean-val-current',
         'ocean-val-wind', 'ocean-val-wave', 'ocean-val-vsby', 'ocean-val-pressure'
        ].forEach(function (id) { OS.resetCardToProgress(id); });

        ['ocean-card-depth', 'ocean-card-temp', 'ocean-card-current',
         'ocean-card-wind', 'ocean-card-wave', 'ocean-card-vsby', 'ocean-card-pressure'
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
                        try { window.oceanOverlayUpdateLegend(); } catch (e) { /* 남의 범례를 새로 그리는 일이다 — 저쪽이 아직 없으면 범례만 그대로 있다 */ }
                    }
                };
            }
        });

        // (3) 천문 / 월상 / 조석 — heavy. 같은 날 갱신 시 skip.
        if (!skipHeavy) {
            if (OS.renderAstroCard) OS.renderAstroCard(lat, lon, d);
            if (OS.renderMoonCard)  OS.renderMoonCard(lat, lon, d);
            if (OS.fetchTideForSheet) OS.fetchTideForSheet(lat, lon, d);
        }

        // (4) 천기 카드 — forceRefresh: 풀 재로드만 imgList 캐시 무효화.
        if (OS.loadWeatherCard) OS.loadWeatherCard(lat, lon, d, /*forceRefresh*/ !skipHeavy);
        // (4-1) 시정 카드 — 클릭 팝업과 동일 RDPS 시정 점 샘플.
        if (OS.loadVsbyCard) OS.loadVsbyCard(lat, lon, d);

        // (5) 시간 의존 카드 — 항상 호출. epoch 토큰으로 stale 응답 차단.
        fetchDepth(lat, lon, myEpoch);
        fetchRoms(lat, lon, d, myEpoch);
        fetchWeather(lat, lon, d, myEpoch);
        fetchWave(lat, lon, d, myEpoch);
        fetchPressure(lat, lon, d, myEpoch);

    };

    /** epoch 검증 — fetch 응답 도착 시 myEpoch 가 현재 _loadEpoch 와 일치하지 않으면 stale. */
    function _isStaleEpoch(myEpoch) {
        return myEpoch !== (OS.state && OS.state._loadEpoch);
    }

    /* --------------------------------------------------------------
     * 6개 일반 카드 fetch — 응답이 없거나 실패하면 카드 숨김
     * ------------------------------------------------------------ */
    function fetchDepth(lat, lon, myEpoch) {
        fetch('/api/ocean/depth?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (_isStaleEpoch(myEpoch)) return;  // stale 응답 무시
                if (data && data.success && data.depth != null) {
                    OS.setCardValue('ocean-val-depth', data.depth.toFixed(1) + ' m');
                    OS.showCard('ocean-card-depth');
                } else {
                    OS.hideCard('ocean-card-depth');
                }
            })
            .catch(function () {
                if (_isStaleEpoch(myEpoch)) return;
                OS.hideCard('ocean-card-depth');
            });
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
    function fetchRoms(lat, lon, dateObj, myEpoch) {
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
                if (_isStaleEpoch(myEpoch)) return;
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
                if (_isStaleEpoch(myEpoch)) return;
                OS.setCardValue('ocean-val-temp', '데이터 없음');
                OS.setCardValue('ocean-val-current', '데이터 없음');
            });
    }

    /**
     * 기압 카드를 /api/ocean/pressure 로부터 채움 — 슬라이더가 가리키는 시각의 해면기압.
     * 예: 슬라이더가 모레 09시면 그 시각 예보 기압 '1008 hPa' 을 표시.
     * 값이 없으면(키 미설정 · 예보 범위 5일 밖 · 과거 시각 · 상류 실패) 카드를 숨긴다 —
     * 다른 일반 카드들과 같은 정책.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date=} dateObj - 슬라이더 시각 (없으면 지금). 서버에는 이 시각 자체가 아니라
     *                            지금과의 차이(오프셋)를 보낸다 — 단말 시계 오차 차단.
     * @param {number} myEpoch - 오래된 응답 차단용 토큰
     * [연계] ← OS.loadAllForDate (같은 파일) — 시트를 열거나 시각을 옮길 때마다 부른다.
     *          → local_server/routes/pressure.js 의 GET /api/ocean/pressure — 우리 서버가
     *            OpenWeather 를 대신 호출하므로 인증키가 브라우저에 노출되지 않는다.
     */
    function fetchPressure(lat, lon, dateObj, myEpoch) {
        // 절대 시각이 아니라 "지금으로부터 몇 ms 뒤"(오프셋)를 보낸다. 휴대폰 시계가
        // 틀어져 있어도 서버가 자기 시각(KST)에 오프셋을 더해 판단하므로 값이 흔들리지 않는다.
        var off = dateObj ? (dateObj.getTime() - Date.now()) : 0;
        var url = '/api/ocean/pressure?lat=' + lat + '&lon=' + lon + '&off=' + Math.round(off);
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (_isStaleEpoch(myEpoch)) return;
                if (data && data.success && data.pressure != null) {
                    OS.setCardValue('ocean-val-pressure', data.pressure + ' hPa');
                    OS.showCard('ocean-card-pressure');
                } else {
                    OS.hideCard('ocean-card-pressure');
                }
            })
            .catch(function () {
                if (_isStaleEpoch(myEpoch)) return;
                OS.hideCard('ocean-card-pressure');
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
    function fetchWeather(lat, lon, dateObj, myEpoch) {
        var url = '/api/ocean/weather?lat=' + lat + '&lon=' + lon;
        if (dateObj) url += '&time=' + encodeURIComponent(dateObj.toISOString());
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (_isStaleEpoch(myEpoch)) return;
                if (!data || !data.success) {
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
            .catch(function () {
                if (_isStaleEpoch(myEpoch)) return;
                OS.hideCard('ocean-card-wind');
            });
    }

    /**
     * 파고 카드를 /api/ocean/wave 로부터 채움.
     * data.waveHeight 있을 때만 표시, 없으면 카드 자체 숨김.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date=} dateObj - 슬라이더 시각 (있으면 ISO 문자열로 ?time=...)
     */
    function fetchWave(lat, lon, dateObj, myEpoch) {
        var url = '/api/ocean/wave?lat=' + lat + '&lon=' + lon;
        if (dateObj) url += '&time=' + encodeURIComponent(dateObj.toISOString());
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (_isStaleEpoch(myEpoch)) return;
                if (data && data.success && data.waveHeight != null) {
                    OS.setCardValue('ocean-val-wave', data.waveHeight.toFixed(1) + ' m');
                    OS.showCard('ocean-card-wave');
                } else {
                    OS.hideCard('ocean-card-wave');
                }
            })
            .catch(function () {
                if (_isStaleEpoch(myEpoch)) return;
                OS.hideCard('ocean-card-wave');
            });
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
     * [예보 범위 외 가시성 정책]
     *
     * 시트의 현재 표시 시각(OS.state.date) 이 wave/wind 예보 범위 안인지 판정해서
     * 슬라이더 + 5개 예보 의존 카드의 표시 여부 결정.
     *
     * - 범위 안: 슬라이더 표시. 5개 카드는 fetch 결과로 자체 표시/숨김.
     * - 범위 밖: 슬라이더 숨김. 5개 카드(wave/wind/current/temp/weather) 강제 hide.
     *   조석/천문/수심 3개만 표시.
     *
     * [판정 기준 — 새 정책]
     *   value=0 ↔ real now (deltaH ≈ 0). 슬라이더의 left edge 가 항상 "지금".
     *   ◀ 가 today 차단이라 음수 deltaH 거의 없음 (1분 buffer 만으로 충분).
     *   ▶ 로 미래 진입 가능 → deltaH 가 lmax 초과면 out-of-range.
     * ------------------------------------------------------------ */
    OS._enforceForecastRangeVisibility = function () {
        var sheetDate = OS.state && OS.state.date;
        if (!sheetDate) return;

        var nowMs = Date.now();
        var sheetMs = sheetDate.getTime();

        var layerSlider = document.getElementById('ocean-timeline-slider');
        var lmax = layerSlider ? (parseFloat(layerSlider.max) || 72) : 72;

        // 1분 과거 buffer (init/release 사이 미세 클럭 드리프트 흡수)
        var inRange = (sheetMs >= nowMs - 60000) && (sheetMs <= nowMs + lmax * 3600000);

        if (inRange) {
            if (OS.SheetTL && typeof OS.SheetTL.setVisible === 'function') {
                OS.SheetTL.setVisible(true);
            }
            // 5개 카드는 loadAllForDate 가 fetch 결과로 자체 처리
        } else {
            if (OS.SheetTL && typeof OS.SheetTL.setVisible === 'function') {
                OS.SheetTL.setVisible(false);
            }
            ['ocean-card-wave', 'ocean-card-wind', 'ocean-card-current',
             'ocean-card-temp', 'ocean-card-weather', 'ocean-card-vsby'].forEach(function (id) {
                if (typeof OS.hideCard === 'function') OS.hideCard(id);
            });
        }
    };

    /* --------------------------------------------------------------
     * [시트 ↔ 레이어 슬라이더 동기]
     *
     * 시트 슬라이더 release 시점에 호출 (ocean_bottom_sheet2.js OS.SheetTL.onRelease 안).
     * 시트 슬라이더 시각 → 레이어 슬라이더 value 로 변환 + 활성 레이어 reload.
     *
     * 단방향 — 시트 슬라이더 → 레이어 슬라이더만 동기 (시트 열린 동안 레이어
     * 슬라이더 가려져 사용자 조작 불가).
     * ------------------------------------------------------------ */
    // [이슈 1.6 대응] ◀/▶ 버튼 연타·슬라이더 release 가 짧은 시간에 연달아
    // 발생할 때 oceanOverlaySetTime() 이 매 호출마다 무거운 히트맵 fetch 를
    // 트리거. 250ms debounce 로 마지막 의도 1건만 실행 — 사용자가 멈춘 시각의
    // 배경만 그려 KHOA / 격자 fetch 부담 절감.
    var _syncLayerDebounceTimer = null;
    var _SYNC_LAYER_DEBOUNCE_MS = 250;
    OS._syncLayerSliderToSheet = function () {
        if (!OS.SheetTL) return;
        var layerSlider = document.getElementById('ocean-timeline-slider');
        if (!layerSlider) return;

        var sheetDate = OS.SheetTL.getCurrentDate();
        var deltaH = (sheetDate.getTime() - Date.now()) / 3600000;
        var layerHours = Math.max(0, Math.round(deltaH));

        var step = parseInt(layerSlider.step, 10) || 3;
        layerHours = Math.round(layerHours / step) * step;

        var lmax = parseFloat(layerSlider.max) || 72;
        layerHours = Math.min(layerHours, lmax);

        // 슬라이더 DOM 값은 즉시 반영 (UI 일관성)
        layerSlider.value = layerHours;

        // 무거운 히트맵 reload 만 debounce
        if (_syncLayerDebounceTimer) clearTimeout(_syncLayerDebounceTimer);
        _syncLayerDebounceTimer = setTimeout(function () {
            _syncLayerDebounceTimer = null;
            if (typeof window.oceanOverlaySetTime === 'function') {
                try { window.oceanOverlaySetTime(layerHours); } catch (e) { /* swallow */ }
            }
        }, _SYNC_LAYER_DEBOUNCE_MS);
    };

    /**
     * 닫기 시 호출 — 보류 중인 _syncLayerSliderToSheet debounce 캔슬.
     * 250ms 이내에 release → close 가 연속 발생하면 timer 가 살아남아
     * 닫힌 시트의 의도로 oceanOverlaySetTime 이 발화될 수 있다. closeSheet 에서
     * 이 함수를 호출해 명시적으로 캔슬한다.
     */
    OS._cancelSyncLayerDebounce = function () {
        if (_syncLayerDebounceTimer) {
            clearTimeout(_syncLayerDebounceTimer);
            _syncLayerDebounceTimer = null;
        }
    };
})();
