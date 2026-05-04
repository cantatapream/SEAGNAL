/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet3.js
 * 역할: 바텀시트 조석 카드 — TideBED 폴링 + 3모드 렌더링(loading/error/detail)
 * ============================================================================
 *
 * [표시 형식 (이미지 기반)]
 *   ┌────────────────────────────────────────────────────┐
 *   │ ≋ 조석                            [표준항 보간 결과] │
 *   │ ┌────────────────────────────────────────────────┐ │
 *   │ │ 고조 12:42  ●━━━○────  저조 19:23              │ │
 *   │ │              05:37                             │ │
 *   │ │       현재 예상 조위 179cm ▼                   │ │
 *   │ │ ┌──┐                                           │ │
 *   │ │ │고│ 01:19 (226cm) ▲ +175                      │ │
 *   │ │ │조│ 12:42 (187cm) ▲  +77                      │ │
 *   │ │ └──┘                                           │ │
 *   │ │ ┌──┐                                           │ │
 *   │ │ │저│ 07:46 (110cm) ▼ -116                      │ │
 *   │ │ │조│ 19:23  (63cm) ▼ -124                      │ │
 *   │ │ └──┘                                           │ │
 *   │ └────────────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────────────┘
 *
 * [데이터 소스]
 * - POST /api/save_tide_input  → { success, files: { yesterday/today/tomorrow }, cached }
 * - GET  /data/{filename}      → 일별 TideBED 결과 (highTide1~4, lowTide1~4, analysis)
 *
 * [동해북부 우회]
 * - lat ≥ 36 && lon ≥ 128 인 좌표는 ocean_bottom_sheet4.js의 tryEastSeaIdw()로 처리
 * ============================================================================
 */

(function () {
    'use strict';

    var OS = window.OceanSheet = window.OceanSheet || {};

    var POLL_INTERVAL_MS = 500;
    var POLL_MAX_TRIES = 120; // 60초

    /* --------------------------------------------------------------
     * 외부 진입점: 조석 카드 로딩 시작
     * ------------------------------------------------------------ */
    OS.fetchTideForSheet = function (lat, lon, dateObj) {
        OS.renderTideLoading();

        // 동해북부 우회 (4.js)
        if (lat >= 36 && lon >= 128 && typeof OS.tryEastSeaIdw === 'function') {
            OS.tryEastSeaIdw(lat, lon, dateObj, function (result, errMsg) {
                if (result && result.today) {
                    OS.renderTideData(result.today, /*isIdw=*/true, dateObj, {
                        yesterday: result.yesterday,
                        tomorrow: result.tomorrow,
                        lat: lat, lon: lon   // 서해 판별용 좌표 전달
                    });
                } else {
                    OS.renderTideError(errMsg ||
                        '동해 북부 표준항 보간을 위한 근거 데이터가 부족합니다.');
                }
            });
            return;
        }

        // 일반 KHOA TideBED 호출
        OS.fetchTideKhoa(lat, lon, dateObj);
    };

    /* --------------------------------------------------------------
     * KHOA TideBED 호출 + 3일치 폴링
     * ------------------------------------------------------------ */
    OS.fetchTideKhoa = function (lat, lon, dateObj) {
        var dateInt = OS.formatDateInt(dateObj);
        var body = { lat: lat, lon: lon, date: dateInt, time: nowHHMM() };

        fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
                if (!resp.success) {
                    var em = (resp.error || '') + '';
                    if (em.indexOf('Grid hash unavailable') >= 0) {
                        OS.renderTideError('국립해양조사원 조석 예측정보가 제공되지 않는 해역입니다.');
                    } else {
                        OS.renderTideError('조석 예측정보 조회에 실패했습니다.');
                    }
                    return;
                }
                if (!resp.files || !resp.files.today) {
                    OS.renderTideError('조석 데이터 응답이 비어 있습니다.');
                    return;
                }
                // tide.js의 loadAllThreeDays와 동일하게 3일치(어제/오늘/내일)를 모두 폴링
                pollThreeDayFiles(resp.files, dateObj);
            })
            .catch(function () {
                OS.renderTideError('조석 데이터 요청 중 오류가 발생했습니다.');
            });

        // -- 내부: 3일치(어제/오늘/내일) 폴링 ---------------------
        // tide.js와 같은 방식으로 today를 우선 받아 즉시 렌더하고,
        // 어제/내일은 백그라운드로 계속 폴링하여 cross-day 보강.
        function pollThreeDayFiles(files, dateObj) {
            var tries = 0;
            var collected = { yesterday: null, today: null, tomorrow: null };

            // 단일 파일 폴링.
            // 인정 상태:
            //   'complete'        — final 결과 (padding 분석 완료) — 더 이상 폴링 안 함
            //   'complete (IDW)'  — IDW 보간 결과 — final 로 간주
            //   'complete-quick'  — today 우선 분석 임시 결과 (이웃 padding 없음).
            //                       collected 에 저장하되 다음 loop 에서 다시 가져와
            //                       final 'complete' 도착 시 갱신.
            //   'error'           — 백엔드 수집 실패. collected 에 저장 후 빠른 실패 처리.
            function fetchOne(key) {
                var fname = files[key];
                if (!fname) return Promise.resolve();
                // final 'complete' 또는 'error' 면 더 이상 폴링 안 함
                var cur = collected[key];
                if (cur && (cur.tideBedStatus === 'complete'
                            || cur.tideBedStatus === 'complete (IDW)'
                            || cur.tideBedStatus === 'error')) {
                    return Promise.resolve();
                }
                return fetch('/data/' + fname)
                    .then(function (r) { return r.json(); })
                    .then(function (d) {
                        if (!d) return;
                        if (d.tideBedStatus === 'complete'
                            || d.tideBedStatus === 'complete (IDW)'
                            || d.tideBedStatus === 'complete-quick'
                            || d.tideBedStatus === 'error') {
                            collected[key] = d;
                        }
                    })
                    .catch(function () {});
            }

            (function loop() {
                Promise.all([fetchOne('yesterday'), fetchOne('today'), fetchOne('tomorrow')])
                    .then(function () {
                        // today 의 백엔드 수집이 실패했으면 빠른 실패 (60초 timeout 기다리지 않음)
                        if (collected.today && collected.today.tideBedStatus === 'error') {
                            OS.renderTideError('조석 데이터 수집에 실패했습니다.');
                            return;
                        }
                        if (collected.today) {
                            // 오늘 데이터 + 현재까지 모인 이웃 데이터로 렌더
                            OS.renderTideData(collected.today, /*isIdw=*/false, dateObj, {
                                yesterday: collected.yesterday,
                                tomorrow: collected.tomorrow,
                                lat: lat, lon: lon   // 서해 판별용 좌표 전달
                            });
                            // 추가 폴링이 필요한 조건:
                            //   - today 가 'complete-quick' (이웃 도착 후 final 'complete' 기다림)
                            //   - 또는 yesterday/tomorrow 미도착
                            var stillPolling = (
                                collected.today.tideBedStatus === 'complete-quick'
                                || !collected.yesterday
                                || !collected.tomorrow
                            );
                            if (stillPolling && ++tries < POLL_MAX_TRIES) {
                                setTimeout(loop, POLL_INTERVAL_MS);
                            }
                            return;
                        }
                        if (++tries < POLL_MAX_TRIES) {
                            setTimeout(loop, POLL_INTERVAL_MS);
                        } else {
                            OS.renderTideError('조석 데이터 수집 시간이 초과되었습니다.');
                        }
                    });
            })();
        }
    };

    /* --------------------------------------------------------------
     * 렌더링 1) 로딩 (조석정보 탭과 동일 양식)
     * ------------------------------------------------------------ */
    OS.renderTideLoading = function () {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석</div>' +
              '</div>' +
              '<div class="ocean-tide-loading">' +
                '<div class="ocean-tide-spinner"></div>' +
                '<div class="ocean-tide-spinner-text">' +
                  '국립해양조사원으로부터 TideBED 기반<br>' +
                  '조석 예측정보를 불러오고 있습니다.' +
                '</div>' +
                '<div class="ocean-tide-spinner-sub">약 3~5초 소요됩니다</div>' +
              '</div>' +
            '</div>';
    };

    /* --------------------------------------------------------------
     * 렌더링 2) 에러 (격자 밖/육지 등) — 카드 자체를 숨김
     * 조석 예측정보를 제공하지 않는 해역에서는 해당 란을 아예 표시하지 않음.
     * ------------------------------------------------------------ */
    OS.renderTideError = function (msg) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        card.style.display = 'none';
    };

    /* --------------------------------------------------------------
     * 렌더링 3) 상세 (4피크 + 현재 조위 + 헤더 진행바)
     *
     * @param {Object} data       /data/tide_*.json 응답 형식
     *                            (highTide1~4, lowTide1~4, analysis)
     * @param {boolean} isIdw     동해북부 IDW 보간 결과 여부
     * @param {Date} dateObj      이 카드가 표시 중인 날짜
     * ------------------------------------------------------------ */
    OS.renderTideData = function (data, isIdw, dateObj, neighbors) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;

        var peaks = collectPeaks(data); // [{type, minutes, level}]
        if (peaks.length === 0) {
            OS.renderTideError('조석 분석 데이터가 비어 있습니다.');
            return;
        }
        peaks.sort(function (a, b) { return a.minutes - b.minutes; });

        // 어제/내일 피크 (cross-day 보강용) — tide.js loadAllThreeDays와 동일
        var yPeaks = (neighbors && neighbors.yesterday) ? collectPeaks(neighbors.yesterday) : [];
        var tPeaks = (neighbors && neighbors.tomorrow)  ? collectPeaks(neighbors.tomorrow)  : [];
        yPeaks.sort(function (a, b) { return a.minutes - b.minutes; });
        tPeaks.sort(function (a, b) { return a.minutes - b.minutes; });

        var todayMode = OS.isToday(dateObj);
        // [시트 슬라이더 연계] dateObj 는 슬라이더가 가리키는 시각 (value=0 → real now,
        // value=N≥3 → floor3(now)+N*h). 같은 날 안에서 시각만 변할 때 게이지/예상조위
        // 라벨이 그 시각 기준으로 표기되어야 하므로 nowMin 은 실제 now() 가 아닌
        // dateObj 의 minutes-of-day 사용.
        var nowMin = dateObj.getHours() * 60 + dateObj.getMinutes();

        // 직전·다음 피크 계산 — tide.js getTideProgress와 동일한 fallback 트리
        // (1) 일반: 오늘 피크들 사이
        // (2) 새벽: prev = 어제 마지막 피크 (-1440 보정)
        // (3) 심야: next = 내일 첫 피크 (+1440 보정)
        var prevPeak = null, nextPeak = null;
        if (todayMode) {
            for (var i = 0; i < peaks.length; i++) {
                if (peaks[i].minutes > nowMin) {
                    nextPeak = peaks[i];
                    if (i > 0) {
                        prevPeak = peaks[i - 1];
                    } else if (yPeaks.length > 0) {
                        var yLast = yPeaks[yPeaks.length - 1];
                        prevPeak = { type: yLast.type, level: yLast.level, minutes: yLast.minutes - 1440 };
                    }
                    break;
                }
            }
            // 다음 피크 없음 → 내일 첫 피크
            if (!nextPeak) {
                if (peaks.length > 0) prevPeak = peaks[peaks.length - 1];
                if (tPeaks.length > 0) {
                    var tFirst = tPeaks[0];
                    nextPeak = { type: tFirst.type, level: tFirst.level, minutes: tFirst.minutes + 1440 };
                }
            }
            // 게이지 길이 검증 (tide.js 2370행과 동일: >780 또는 ≤0이면 무효)
            if (prevPeak && nextPeak) {
                var dur = nextPeak.minutes - prevPeak.minutes;
                if (dur > 780 || dur <= 0) {
                    prevPeak = null;
                    nextPeak = null;
                }
            } else {
                prevPeak = null;
                nextPeak = null;
            }
        }

        // 4피크 리스트의 ±차이값: tide.js processCurrentDay와 동일
        // - 첫 피크는 어제 마지막 반대 피크 기준
        // - 마지막 피크는 내일 첫 반대 피크 기준 (오늘에 같은 종류 피크가 더 없을 때)
        var yLastHigh = lastOfType(yPeaks, 'high');
        var yLastLow  = lastOfType(yPeaks, 'low');
        var tFirstHigh = firstOfType(tPeaks, 'high');
        var tFirstLow  = firstOfType(tPeaks, 'low');
        for (var j = 0; j < peaks.length; j++) {
            var p = peaks[j];
            var dprev = null;
            // (a) 오늘 배열 안에서 직전 반대 피크
            for (var k = j - 1; k >= 0; k--) {
                if (peaks[k].type !== p.type) { dprev = peaks[k]; break; }
            }
            // (b) 없으면 어제 마지막 반대 피크
            if (!dprev) {
                dprev = (p.type === 'high') ? yLastLow : yLastHigh;
            }
            // (c) 그래도 없으면 내일 첫 반대 피크 (배열 양끝 보호)
            if (!dprev) {
                dprev = (p.type === 'high') ? tFirstLow : tFirstHigh;
            }
            p.diff = dprev ? (p.level - dprev.level) : null;
        }

        var highs = peaks.filter(function (p) { return p.type === 'high'; }).slice(0, 2);
        var lows  = peaks.filter(function (p) { return p.type === 'low'; }).slice(0, 2);

        // 현재 조위 (오늘만) — 게이지 바로 위 정 가운데에 삽입.
        // [시트 슬라이더 연계] 라벨은 슬라이더 시각의 HH:MM 그대로 표기.
        // 예: 슬라이더 value=0 (real now 07:42) → "07:42 예상 조위"
        // 예: 슬라이더 value=3 (09:00) → "09:00 예상 조위"
        var currentHtml = '';
        if (todayMode && prevPeak && nextPeak) {
            var curLevel = interpolateLevel(prevPeak, nextPeak, nowMin);
            var rising = nextPeak.type === 'high';
            var lblHH = String(dateObj.getHours()).padStart(2, '0');
            var lblMM = String(dateObj.getMinutes()).padStart(2, '0');
            var labelText = lblHH + ':' + lblMM + ' 예상 조위';
            currentHtml =
                '<div class="ocean-tide-current-top">' +
                  '<span class="ocean-tide-current-label">' + labelText + '</span>' +
                  '<span class="ocean-tide-current-val">' + Math.round(curLevel) + ' cm</span>' +
                  '<span class="ocean-tide-current-arrow ' + (rising ? 'is-up' : 'is-down') + '">' +
                    (rising ? '▲' : '▼') +
                  '</span>' +
                '</div>';
        }

        // 일조부등 판별: 하루에 고조 1회·저조 1회(총 2피크 이하)인 경우
        // → 조석 게이지(진행 막대) 없이 고조/저조 목록만 표시
        var isDiurnal = (peaks.length <= 2);

        // 헤더: "다음" 피크 / "그 다음" 피크 (오늘 + 반일조 해역에서만 진행 막대 표시).
        // nowMin 명시 전달 (dateObj 시각 기준) — 슬라이더 시간 변경 시 진행바 위치 일치.
        var headHtml = isDiurnal ? '' : renderHeadHtml(prevPeak, nextPeak, todayMode, peaks, currentHtml, nowMin);

        // 4피크 리스트
        var peaksHtml =
            '<div class="ocean-tide-peaks">' +
              renderPeakGroup('고조', 'is-high', highs, '▲') +
              renderPeakGroup('저조', 'is-low',  lows,  '▼') +
            '</div>';

        var idwBadge = isIdw
            ? '<div class="ocean-tide-idw-badge">표준항 보간 결과</div>' : '';

        // 물때 산출: tide.js의 computeMulddae() 전역 함수를 사용
        // peaks(오늘), yPeaks(어제), tPeaks(내일) 피크 배열과 M2/S2 조화상수를 전달
        // 날짜가 바뀔 때마다 renderTideData가 다시 호출되므로 자동으로 갱신됨
        var mulddaeBadgeHtml = '';
        if (typeof computeMulddae === 'function') {
            var tbRow0 = (data.tideBedData && data.tideBedData.length > 0)
                ? data.tideBedData[0]
                : null;
            // neighbors에 담아온 좌표로 서해 여부 판별
            var sheetLat = (neighbors && typeof neighbors.lat === 'number') ? neighbors.lat : null;
            var sheetLon = (neighbors && typeof neighbors.lon === 'number') ? neighbors.lon : null;
            var mulddaeInfo = computeMulddae(
                peaks,     // 오늘 피크 [{type, minutes, level}]
                yPeaks,    // 어제 피크 (방향 판단용)
                tPeaks,    // 내일 피크 (평균 대조차 추정 보조)
                tbRow0,    // M2/S2 조화상수 행
                dateObj,   // 기준 날짜 (월령 계산용)
                sheetLat,  // 위도 (서해 판별)
                sheetLon   // 경도 (서해 판별)
            );
            if (mulddaeInfo) {
                // '조석' 타이틀 옆에 소괄호 형태로 표시: ≋ 조석  (1물)
                mulddaeBadgeHtml =
                    '<span class="ocean-tide-mulddae-badge">(' + mulddaeInfo.label + ')</span>';
            }
        }

        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석' +
                  mulddaeBadgeHtml +
                '</div>' +
                idwBadge +
              '</div>' +
              headHtml +
              peaksHtml +
            '</div>';

        // [시트 슬라이더 연계] 캐시 저장 — 같은 날 안에서 슬라이더 시간만 변할 때
        // 조석 API 재호출 없이 게이지/예상조위만 클라이언트에서 재계산.
        // lat/lon 도 저장 — 같은 날 다른 좌표로 시트 재오픈 시 stale 캐시 차단.
        OS.state._tideTodayCache = {
            peaks: peaks.slice(),
            yPeaks: yPeaks.slice(),
            tPeaks: tPeaks.slice(),
            dataDayKey: dateObj.getFullYear() + '-' +
                        (dateObj.getMonth() + 1) + '-' +
                        dateObj.getDate(),
            lat: OS.state.lat,
            lon: OS.state.lon
        };
    };

    /* --------------------------------------------------------------
     * 시트 슬라이더 release (같은 날) 시 호출 — 조석 API 호출 없이
     * 게이지/예상조위/라벨/진행%/남은시간만 갱신.
     *
     * @param {Date} sheetDate - 슬라이더가 가리키는 새 시각 (오늘 안)
     * ------------------------------------------------------------ */
    OS.refreshTideGaugeForTime = function (sheetDate) {
        var cache = OS.state && OS.state._tideTodayCache;
        if (!cache) return;
        var sheetKey = sheetDate.getFullYear() + '-' +
                       (sheetDate.getMonth() + 1) + '-' +
                       sheetDate.getDate();
        if (sheetKey !== cache.dataDayKey) return;
        // [좌표 일치 검증] 같은 날 다른 좌표로 시트 재오픈된 직후 슬라이더 release 시
        // 이전 좌표의 stale peaks 로 게이지 표시되지 않도록 차단.
        if (cache.lat !== OS.state.lat || cache.lon !== OS.state.lon) return;
        if (!OS.isToday(sheetDate)) return;  // 미래/과거 날짜는 게이지 자체 없음

        var nowMin = sheetDate.getHours() * 60 + sheetDate.getMinutes();
        var peaks = cache.peaks;
        if (!peaks || peaks.length === 0) return;

        // prev/next 피크 — renderTideData 와 동일 알고리즘
        var prevPeak = null, nextPeak = null;
        for (var i = 0; i < peaks.length; i++) {
            if (peaks[i].minutes > nowMin) {
                nextPeak = peaks[i];
                if (i > 0) {
                    prevPeak = peaks[i - 1];
                } else if (cache.yPeaks && cache.yPeaks.length > 0) {
                    var yLast = cache.yPeaks[cache.yPeaks.length - 1];
                    prevPeak = { type: yLast.type, level: yLast.level, minutes: yLast.minutes - 1440 };
                }
                break;
            }
        }
        if (!nextPeak) {
            if (peaks.length > 0) prevPeak = peaks[peaks.length - 1];
            if (cache.tPeaks && cache.tPeaks.length > 0) {
                var tFirst = cache.tPeaks[0];
                nextPeak = { type: tFirst.type, level: tFirst.level, minutes: tFirst.minutes + 1440 };
            }
        }
        if (!prevPeak || !nextPeak) return;
        var dur = nextPeak.minutes - prevPeak.minutes;
        if (dur > 780 || dur <= 0) return;

        var curLevel = interpolateLevel(prevPeak, nextPeak, nowMin);
        var rising = nextPeak.type === 'high';
        var pctVal = ((nowMin - prevPeak.minutes) / dur) * 100;
        if (pctVal < 0) pctVal = 0;
        if (pctVal > 100) pctVal = 100;

        // DOM 부분 갱신 — card scope 안에서만 (전역 querySelector 충돌 방지)
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        var labelEl  = card.querySelector('.ocean-tide-current-label');
        var valEl    = card.querySelector('.ocean-tide-current-val');
        var arrowEl  = card.querySelector('.ocean-tide-current-arrow');
        var fillEl   = card.querySelector('.ocean-tide-progress-fill');
        var markerEl = card.querySelector('.ocean-tide-progress-marker');
        var remainEl = card.querySelector('.ocean-tide-progress-remain');

        if (labelEl) {
            var hh = String(sheetDate.getHours()).padStart(2, '0');
            var mm = String(sheetDate.getMinutes()).padStart(2, '0');
            labelEl.textContent = hh + ':' + mm + ' 예상 조위';
        }
        if (valEl) valEl.textContent = Math.round(curLevel) + ' cm';
        if (arrowEl) {
            arrowEl.classList.toggle('is-up', rising);
            arrowEl.classList.toggle('is-down', !rising);
            arrowEl.textContent = rising ? '▲' : '▼';
        }
        var gradient = rising
            ? 'linear-gradient(90deg, #991b1b 0%, #ef4444 100%)'
            : 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 100%)';
        if (fillEl) {
            fillEl.style.width = pctVal.toFixed(1) + '%';
            fillEl.style.background = gradient;
        }
        if (markerEl) markerEl.style.left = pctVal.toFixed(1) + '%';
        if (remainEl) {
            var remainStr = formatRemain(Math.max(0, nextPeak.minutes - nowMin));
            remainEl.textContent =
                (rising ? '고조까지' : '저조까지') + ' 남은시간 ' + remainStr;
        }
    };

    /* --------------------------------------------------------------
     * 내부: 헤더 (좌:다음피크 / 가운데:진행막대 / 우:그 다음 피크)
     * ------------------------------------------------------------ */
    function renderHeadHtml(prevPeak, nextPeak, todayMode, peaks, currentHtml, nowMinArg) {
        // 어제/내일 보기 (todayMode=false) — 게이지 영역 자체 없음.
        if (!todayMode) return '';

        // 오늘 보기인데 직전·다음 피크 계산 불가 — 일반적으로 다음 두 경우:
        //  ① 새벽/심야 — 어제(yesterday) 또는 내일(tomorrow) 의 피크가 필요한데
        //     아직 폴링에서 도착 안 함 (조석 점진 로딩 중)
        //  ② 이웃 데이터 도착 후에도 듀레이션 무효(>780분 또는 ≤0)
        // 첫 케이스는 곧 도착할 가능성이 큼 → 게이지 자리에 로딩 스피너 표시.
        // 4피크 리스트는 별도로 정상 표시되므로 사용자는 이미 핵심 정보(고조/저조 시각)
        // 를 볼 수 있고, 게이지만 잠시 후 채워짐.
        if (!prevPeak || !nextPeak) {
            return (
                '<div class="ocean-tide-head ocean-tide-head-loading">' +
                  '<div class="ocean-tide-gauge-spinner"></div>' +
                  '<div class="ocean-tide-gauge-spinner-text">게이지 정보를 불러오는 중...</div>' +
                '</div>'
            );
        }

        // tide.js와 동일: 좌측=직전(prev) 피크, 우측=다음(next) 피크
        var leftCls = prevPeak.type === 'high' ? 'is-high' : 'is-low';
        var leftLabelText = prevPeak.type === 'high' ? '고조' : '저조';
        var leftTimeText = minutesToHHMM(prevPeak.minutes);

        var rightCls = nextPeak.type === 'high' ? 'is-high' : 'is-low';
        var rightLabelText = nextPeak.type === 'high' ? '고조' : '저조';
        var rightTimeText = minutesToHHMM(nextPeak.minutes);

        // nowMinArg 미전달 시 (구 호출 호환) 실제 now 사용
        var nowMin = (typeof nowMinArg === 'number') ? nowMinArg : nowMinutes();
        var pct = ((nowMin - prevPeak.minutes) / (nextPeak.minutes - prevPeak.minutes)) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        var remainMin = Math.max(0, nextPeak.minutes - nowMin);
        var remainStr = formatRemain(remainMin);
        var remainText = (nextPeak.type === 'high' ? '고조까지' : '저조까지') + ' 남은시간 ' + remainStr;

        // tide.js getTideProgressHTML과 동일한 색상 테마
        // - rising(다음=고조): #991b1b → #ef4444 빨강 그라데이션
        // - falling(다음=저조): #1e3a8a → #3b82f6 파랑 그라데이션
        var rising = nextPeak.type === 'high';
        var gradient = rising
            ? 'linear-gradient(90deg, #991b1b 0%, #ef4444 100%)'
            : 'linear-gradient(90deg, #1e3a8a 0%, #3b82f6 100%)';

        var centerHtml = currentHtml || '<div class="ocean-tide-current-top"></div>';

        return (
            '<div class="ocean-tide-head">' +
              // 게이지 상단: 고조 라벨 / 현재 예상 조위 / 저조 라벨
              '<div class="ocean-tide-head-labels">' +
                '<div class="ocean-tide-head-side ' + leftCls + '">' +
                  '<div class="ocean-tide-head-label-text">' + leftLabelText + '</div>' +
                '</div>' +
                centerHtml +
                '<div class="ocean-tide-head-side ' + rightCls + '">' +
                  '<div class="ocean-tide-head-label-text">' + rightLabelText + '</div>' +
                '</div>' +
              '</div>' +
              // 게이지
              '<div class="ocean-tide-progress-track">' +
                '<div class="ocean-tide-progress-fill" style="width:' + pct.toFixed(1) + '%; background:' + gradient + ';"></div>' +
                '<div class="ocean-tide-progress-marker" style="left:' + pct.toFixed(1) + '%"></div>' +
              '</div>' +
              // 게이지 하단: 좌시각 / 남은시간(가운데) / 우시각
              '<div class="ocean-tide-head-times">' +
                '<div class="ocean-tide-head-time ' + leftCls + '">' + leftTimeText + '</div>' +
                '<div class="ocean-tide-progress-remain">' + remainText + '</div>' +
                '<div class="ocean-tide-head-time ' + rightCls + '">' + rightTimeText + '</div>' +
              '</div>' +
            '</div>'
        );
    }

    /* --------------------------------------------------------------
     * 내부: 4피크 그룹 렌더 (고조 2건 또는 저조 2건)
     * ------------------------------------------------------------ */
    function renderPeakGroup(labelText, cls, list, arrow) {
        if (list.length === 0) return '';
        var rowsHtml = list.map(function (p) {
            var diff = p.diff;
            var sign = '';
            var digits = '';
            if (diff != null) {
                var rounded = Math.round(diff);
                sign = (rounded > 0) ? '+' : (rounded < 0 ? '−' : '');
                digits = String(Math.abs(rounded));
            }
            return (
                '<div class="ocean-tide-peak-row">' +
                  '<div class="ocean-tide-peak-left">' +
                    '<span class="ocean-tide-peak-time">' + minutesToHHMM(p.minutes) + '</span>' +
                    '<span class="ocean-tide-peak-cm">(' + Math.round(p.level) + ' cm)</span>' +
                  '</div>' +
                  '<div class="ocean-tide-peak-right ' + cls + '">' +
                    '<span class="ocean-tide-peak-arrow">' + arrow + '</span>' +
                    '<span class="ocean-tide-peak-sign">' + sign + '</span>' +
                    '<span class="ocean-tide-peak-digits">' + digits + '</span>' +
                  '</div>' +
                '</div>'
            );
        }).join('');
        return (
            '<div class="ocean-tide-peak-group">' +
              '<div class="ocean-tide-peak-label ' + cls + '">' + labelText + '</div>' +
              '<div class="ocean-tide-peak-rows">' + rowsHtml + '</div>' +
            '</div>'
        );
    }

    /* --------------------------------------------------------------
     * 내부: highTide1~4 / lowTide1~4 → 통일 배열로
     * ------------------------------------------------------------ */
    function collectPeaks(data) {
        var arr = [];
        for (var i = 1; i <= 4; i++) {
            var hi = data['highTide' + i];
            if (hi && hi.time) {
                arr.push({ type: 'high', minutes: hhmmToMinutes(hi.time), level: parseFloat(hi.height || hi.level || 0) });
            }
            var lo = data['lowTide' + i];
            if (lo && lo.time) {
                arr.push({ type: 'low', minutes: hhmmToMinutes(lo.time), level: parseFloat(lo.height || lo.level || 0) });
            }
        }
        // 폴백: data.analysis 배열 형식도 처리
        if (arr.length === 0 && Array.isArray(data.analysis)) {
            data.analysis.forEach(function (p) {
                arr.push({
                    type: p.type === 'high' ? 'high' : 'low',
                    minutes: hhmmToMinutes(p.time),
                    level: parseFloat(p.level || 0)
                });
            });
        }
        return arr;
    }

    /* --------------------------------------------------------------
     * 내부: 특정 type의 첫/마지막 피크 (cross-day 변화량 계산용)
     * ------------------------------------------------------------ */
    function firstOfType(arr, type) {
        for (var i = 0; i < arr.length; i++) if (arr[i].type === type) return arr[i];
        return null;
    }
    /**
     * 배열을 뒤에서부터 훑어 마지막으로 type 이 일치하는 항목 반환.
     * firstOfType 의 역순. 만조/간조 분기 시 "오늘 마지막 만조" 추적용.
     */
    function lastOfType(arr, type) {
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].type === type) return arr[i];
        return null;
    }

    /* --------------------------------------------------------------
     * 내부: 사인 보간으로 두 피크 사이의 현재 조위를 추정
     * ------------------------------------------------------------ */
    function interpolateLevel(prevPeak, nextPeak, currentMin) {
        var span = nextPeak.minutes - prevPeak.minutes;
        if (span <= 0) return prevPeak.level;
        var t = (currentMin - prevPeak.minutes) / span; // 0~1
        // cosine 보간 (조위 곡선 근사)
        var blend = (1 - Math.cos(t * Math.PI)) / 2;
        return prevPeak.level + (nextPeak.level - prevPeak.level) * blend;
    }

    /* --------------------------------------------------------------
     * 내부 유틸
     * ------------------------------------------------------------ */
    function nowHHMM() {
        var d = new Date();
        return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    }
    /**
     * 현재 시각을 "0시 0분으로부터의 분" 단위로 반환 (0~1439).
     * 조석 피크와 비교용 — interpolateLevel 의 currentMin 계산.
     */
    function nowMinutes() {
        var d = new Date();
        return d.getHours() * 60 + d.getMinutes();
    }
    /**
     * "HH:MM" 또는 "HHMM" 문자열을 분(0~1439)으로 변환.
     * ':' 포함 여부로 두 포맷 모두 지원.
     *
     * @param {string|null} s
     * @returns {number}
     */
    function hhmmToMinutes(s) {
        if (!s) return 0;
        s = String(s);
        if (s.indexOf(':') >= 0) {
            var p = s.split(':');
            return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        }
        s = s.padStart(4, '0');
        return parseInt(s.substring(0, 2), 10) * 60 + parseInt(s.substring(2, 4), 10);
    }
    /**
     * 분(0 또는 외 값)을 "HH:MM" 으로 변환. 음수·1440+ 값도 24h 모듈로 정규화.
     * 자정 넘김(cross-day) 보정으로 안전.
     */
    function minutesToHHMM(m) {
        // cross-day 보정으로 음수 또는 1440 이상 값이 들어올 수 있음 → 24h 모듈로
        var n = ((m % 1440) + 1440) % 1440;
        var h = Math.floor(n / 60);
        var mm = n % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    /**
     * 분 단위 잔여 시간을 "HH:MM" 으로 포맷 ("다음 만조까지 02:14" 등).
     * minutesToHHMM 과 비슷하지만 모듈로 처리 안 함 (잔여시간은 0 이상이 보장됨).
     */
    function formatRemain(m) {
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    /**
     * HTML 안전 escape — 사용자 입력이 들어가는 위치(메시지/이름 등) 에 사용.
     * &, <, >, ", ' 5종 모두 처리.
     */
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }
})();
