/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet4.js
 * 역할: 동해 북부(36°N+128°E+) IDW 보간 + 천문 카드 (SunCalc)
 * ============================================================================
 *
 * [동해 북부 IDW 우회]
 * KHOA TideBED는 36°N 이북·128°E 이동 해역의 격자를 제공하지 않으므로,
 * tide.js에 이미 검증되어 있는 표준항 IDW 보간 함수들을 그대로 호출하여
 * 결과를 TideBED 포맷으로 변환합니다.
 *
 * 의존하는 tide.js 전역 함수 (모두 typeof 가드):
 *   - window.loadTideData(year, callback)
 *   - getClientAdjacentDates(dateObj)
 *   - findNearestStationsWithData(lat, lon, dateInt, count)
 *   - interpolateTideByIDW(stationsWithData)
 *   - convertIDWToTideBedFormat(idwResult, dateInt)
 *
 * [천문 카드]
 * tide.js의 getAstronomyInfo(lat, lon, date) 가 SunCalc로 계산한 값을 그대로 받아와
 * 일출/일몰/월출/월몰/월령/달밝기/달이미지를 카드로 표시합니다.
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    /* ==============================================================
     *  동해 북부 IDW 우회
     * ============================================================ */
    OS.tryEastSeaIdw = function (lat, lon, dateObj, callback) {
        // 필수 전역 함수 존재 여부 확인
        if (typeof loadTideData !== 'function'
            || typeof getClientAdjacentDates !== 'function'
            || typeof findNearestStationsWithData !== 'function'
            || typeof interpolateTideByIDW !== 'function'
            || typeof convertIDWToTideBedFormat !== 'function') {
            callback(null, '표준항 보간 모듈이 로드되지 않았습니다.');
            return;
        }
        runIdw(lat, lon, dateObj, callback);
    };

    /**
     * 동해북부 등 TideBED 미커버 좌표를 위한 IDW(역거리 가중) 보간 실행.
     *
     * [절차]
     *   1) 어제/오늘/내일 3일치 일자 추출 (getClientAdjacentDates)
     *   2) 일자별 연도가 다를 수 있어 필요한 모든 연도의 표준항 데이터 fetch
     *   3) 각 일자마다 가까운 표준항 3곳 선택 → IDW 보간 → TideBED 형식 변환
     *   4) callback(result, error) 으로 비동기 결과 반환
     *
     * [실패 케이스]
     *   - 인근 표준항 0개
     *   - IDW 계산 실패
     *   - 변환 실패 (TideBED 포맷 부적합)
     *   각각 callback(null, '<원인 메시지>') 으로 통지.
     *
     * [연계] OS.runTideIdw 외부 API 가 이 내부 함수를 호출.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {Date} dateObj
     * @param {Function} callback - (result|null, error|null)
     */
    function runIdw(lat, lon, dateObj, callback) {
        try {
            var dates = getClientAdjacentDates(dateObj);
            // tide.js processEastSeaNorthException와 동일하게 3일치(어제/오늘/내일) 모두 IDW
            var keyMap = { yesterday: dates.yesterday, today: dates.today, tomorrow: dates.tomorrow };
            var result = { yesterday: null, today: null, tomorrow: null };

            // 연도가 다를 수 있으므로 필요한 연도를 모두 로드
            var years = {};
            years[dates.yesterdayObj.getFullYear()] = true;
            years[dates.todayObj.getFullYear()] = true;
            years[dates.tomorrowObj.getFullYear()] = true;
            var pending = Object.keys(years);

            /**
             * 모든 연도 데이터 로드 끝난 뒤 실행 — 어제/오늘/내일 각각 IDW 적용.
             * 한 일자라도 실패하면 즉시 callback 으로 에러 통지하고 종료.
             */
            function afterLoads() {
                try {
                    for (var key in keyMap) {
                        var dateInt = keyMap[key];
                        var stations = findNearestStationsWithData(lat, lon, dateInt, 3);
                        if (!stations || stations.length === 0) {
                            callback(null, '인근 표준항 조석 데이터가 존재하지 않습니다.');
                            return;
                        }
                        var idwResult = interpolateTideByIDW(stations);
                        if (!idwResult) {
                            callback(null, '표준항 보간 계산에 실패했습니다.');
                            return;
                        }
                        var tideBed = convertIDWToTideBedFormat(idwResult, dateInt);
                        if (!tideBed) {
                            callback(null, '표준항 보간 결과를 변환할 수 없습니다.');
                            return;
                        }
                        tideBed.isInterpolated = true;
                        result[key] = tideBed;
                    }
                    callback(result, null);
                } catch (e) {
                    callback(null, '표준항 보간 처리 중 예외: ' + (e.message || e));
                }
            }

            /**
             * pending 큐에서 연도 한 개씩 꺼내 loadTideData(year) 호출.
             * Promise 가 resolve/reject 어느 쪽이든 다음 항목 진행 (실패해도 계속).
             * 모든 연도 처리 끝나면 afterLoads 호출.
             */
            function loadNext() {
                if (pending.length === 0) { afterLoads(); return; }
                var yr = pending.shift();
                // tide.js의 loadTideData는 async (Promise 반환), 인자는 year 1개
                try {
                    var p = loadTideData(String(yr));
                    if (p && typeof p.then === 'function') {
                        p.then(function () { loadNext(); },
                               function () { loadNext(); });
                    } else {
                        loadNext();
                    }
                } catch (e) { loadNext(); }
            }
            loadNext();
        } catch (e) {
            callback(null, '표준항 보간 처리 중 예외: ' + (e.message || e));
        }
    }

    /* ==============================================================
     *  천문 카드 (일출/일몰/월출/월몰/월령/달밝기/달이미지)
     * ============================================================ */

    // 달 위상 phase(0~1) → 8단계 이모지 + 한국어 명칭
    var MOON_PHASES = [
        { max: 0.0625, icon: '🌑', name: '그믐' },
        { max: 0.1875, icon: '🌒', name: '초승달' },
        { max: 0.3125, icon: '🌓', name: '상현달' },
        { max: 0.4375, icon: '🌔', name: '상현 지나' },
        { max: 0.5625, icon: '🌕', name: '보름달' },
        { max: 0.6875, icon: '🌖', name: '하현 직전' },
        { max: 0.8125, icon: '🌗', name: '하현달' },
        { max: 0.9375, icon: '🌘', name: '그믐 직전' },
        { max: 1.0001, icon: '🌑', name: '그믐' }
    ];

    /**
     * SunCalc 가 제공하는 달 위상 phase(0~1) 값을 8단계 객체로 매핑.
     * MOON_PHASES 배열의 max 임계값을 순차 비교하여 첫 번째 일치 항목 반환.
     *
     * @param {number} phase - 0~1 (0=그믐, 0.5=보름)
     * @returns {{max: number, icon: string, name: string}}
     */
    function pickMoonPhase(phase) {
        for (var i = 0; i < MOON_PHASES.length; i++) {
            if (phase <= MOON_PHASES[i].max) return MOON_PHASES[i];
        }
        return MOON_PHASES[0];
    }

    OS.renderAstroCard = function (lat, lon, dateObj) {
        var card = document.getElementById('ocean-card-astro');
        if (!card) return;

        // tide.js의 getAstronomyInfo 재사용 (없으면 카드 숨김)
        if (typeof getAstronomyInfo !== 'function' || typeof SunCalc === 'undefined') {
            card.style.display = 'none';
            return;
        }

        var astro;
        try {
            astro = getAstronomyInfo(lat, lon, dateObj);
        } catch (e) {
            card.style.display = 'none';
            return;
        }
        if (!astro) {
            card.style.display = 'none';
            return;
        }

        // SunCalc로 phase + illumination 계산 (getAstronomyInfo 결과를 보강)
        var moonInfo;
        try {
            moonInfo = SunCalc.getMoonIllumination(dateObj);
        } catch (e) {
            moonInfo = { phase: 0, fraction: 0 };
        }
        var phaseObj = pickMoonPhase(moonInfo.phase);
        var brightPct = Math.round((moonInfo.fraction || 0) * 100);

        var lunarStr = '';
        if (typeof getLunarDate === 'function') {
            try {
                lunarStr = getLunarDate(dateObj.getFullYear(), dateObj.getMonth() + 1, dateObj.getDate());
            } catch (e) { lunarStr = ''; }
        }

        /**
         * Date 또는 시각값을 "HH:MM" 으로 포맷 (renderAstroCard 내부 헬퍼).
         * 일출/일몰/월출/월몰 표시용.
         */
        function fmt(t) {
            if (!t) return '--:--';
            if (t instanceof Date) {
                if (isNaN(t.getTime())) return '--:--';
                return String(t.getHours()).padStart(2, '0') + ':' +
                       String(t.getMinutes()).padStart(2, '0');
            }
            return String(t);
        }

        // [사용량] 천문(일출몰/월출몰) 카드 표출 성공
        if (window.trackUsage) window.trackUsage('sheet.astro');
        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-card-icon">' +
              '<i class="fa-solid fa-sun"></i>' +
              '<div class="ocean-card-icon-label">천문</div>' +
            '</div>' +
            '<div class="ocean-card-value ocean-astro-value">' +
              '<div class="ocean-astro-time-row">' +
                '<span class="ocean-astro-label">일출/몰</span>' +
                '<span class="ocean-astro-times"><span class="ocean-astro-t">' + fmt(astro.sunrise) + '</span>/<span class="ocean-astro-t">' + fmt(astro.sunset) + '</span></span>' +
              '</div>' +
              '<div class="ocean-astro-time-row">' +
                '<span class="ocean-astro-label">월출/몰</span>' +
                '<span class="ocean-astro-times"><span class="ocean-astro-t">' + fmt(astro.moonrise) + '</span>/<span class="ocean-astro-t">' + fmt(astro.moonset) + '</span></span>' +
              '</div>' +
            '</div>';
    };

    /* ==============================================================
     *  월상 카드 (달 위상 이모지 / 월령 / 밝기)
     *  - 라벨(ocean-card-icon-label) 없이 이모지만 아이콘 박스에 표출
     *  - 우측에 '월령 #.#일' / '밝기 ##%' 두 줄
     * ============================================================ */
    OS.renderMoonCard = function (lat, lon, dateObj) {
        var card = document.getElementById('ocean-card-moon');
        if (!card) return;

        if (typeof SunCalc === 'undefined') {
            card.style.display = 'none';
            return;
        }

        var moonInfo;
        try {
            moonInfo = SunCalc.getMoonIllumination(dateObj);
        } catch (e) {
            card.style.display = 'none';
            return;
        }

        var phaseObj = pickMoonPhase(moonInfo.phase);
        var lunarAge = (moonInfo.phase * 29.53).toFixed(1);
        var brightPct = Math.round((moonInfo.fraction || 0) * 100);

        // [사용량] 월령(달 위상) 카드 표출 성공
        if (window.trackUsage) window.trackUsage('sheet.moon');
        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-card-icon ocean-moon-icon">' +
              '<span class="ocean-moon-emoji">' + phaseObj.icon + '</span>' +
              '<div class="ocean-card-icon-label">월상</div>' +
            '</div>' +
            '<div class="ocean-card-value ocean-moon-value">' +
              '<div class="ocean-moon-row">' +
                '<span class="ocean-moon-label">월령</span>' +
                '<span class="ocean-moon-data">' + lunarAge + ' 일</span>' +
              '</div>' +
              '<div class="ocean-moon-row">' +
                '<span class="ocean-moon-label">밝기</span>' +
                '<span class="ocean-moon-data">' + brightPct + ' %</span>' +
              '</div>' +
            '</div>';
    };
})();
