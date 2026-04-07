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

        var year = dateObj.getFullYear();
        // tide.js의 loadTideData는 callback 형태 — 데이터가 없으면 자동 로드 후 호출
        try {
            loadTideData(year, function (ok) {
                if (!ok) {
                    callback(null, '해당 연도(' + year + ') 표준항 데이터를 불러오지 못했습니다.');
                    return;
                }
                runIdw(lat, lon, dateObj, callback);
            });
        } catch (e) {
            // loadTideData가 동기 또는 다른 시그니처일 수 있으므로 한 번 더 시도
            try {
                runIdw(lat, lon, dateObj, callback);
            } catch (e2) {
                callback(null, '표준항 보간 중 오류가 발생했습니다.');
            }
        }
    };

    function runIdw(lat, lon, dateObj, callback) {
        try {
            var dates = getClientAdjacentDates(dateObj);
            var dateInt = dates.today;

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
            callback(tideBed, null);
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

        function fmt(t) {
            if (!t) return '--:--';
            if (t instanceof Date) {
                if (isNaN(t.getTime())) return '--:--';
                return String(t.getHours()).padStart(2, '0') + ':' +
                       String(t.getMinutes()).padStart(2, '0');
            }
            return String(t);
        }

        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-astro-wrap">' +
              '<div class="ocean-astro-title">☀🌙 천문</div>' +
              '<div class="ocean-astro-times">' +
                '<div>☀ 일출 ' + fmt(astro.sunrise) + '</div>' +
                '<div>☀ 일몰 ' + fmt(astro.sunset) + '</div>' +
                '<div>🌙 월출 ' + fmt(astro.moonrise) + '</div>' +
                '<div>🌙 월몰 ' + fmt(astro.moonset) + '</div>' +
              '</div>' +
              '<div class="ocean-astro-divider"></div>' +
              '<div class="ocean-astro-moon">' +
                '<div class="ocean-astro-moon-icon">' + phaseObj.icon + '</div>' +
                '<div class="ocean-astro-moon-info">' +
                  (lunarStr ? lunarStr + ' · ' : '') + phaseObj.name +
                '</div>' +
                '<div class="ocean-astro-moon-bright">밝기 ' + brightPct + '%</div>' +
              '</div>' +
            '</div>';
    };
})();
