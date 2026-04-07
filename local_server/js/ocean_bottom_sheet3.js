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
                if (result) {
                    OS.renderTideData(result, /*isIdw=*/true, dateObj);
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
                pollTodayFile(resp.files.today, dateObj);
            })
            .catch(function () {
                OS.renderTideError('조석 데이터 요청 중 오류가 발생했습니다.');
            });

        // -- 내부: today 파일 1개만 폴링 (60초) --------------
        function pollTodayFile(fileName, dateObj) {
            var tries = 0;
            (function loop() {
                fetch('/data/' + fileName)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data && (data.tideBedStatus === 'complete'
                            || data.tideBedStatus === 'complete (IDW)')) {
                            OS.renderTideData(data, /*isIdw=*/false, dateObj);
                            return;
                        }
                        if (++tries < POLL_MAX_TRIES) {
                            setTimeout(loop, POLL_INTERVAL_MS);
                        } else {
                            OS.renderTideError('조석 데이터 수집 시간이 초과되었습니다.');
                        }
                    })
                    .catch(function () {
                        if (++tries < POLL_MAX_TRIES) {
                            setTimeout(loop, POLL_INTERVAL_MS);
                        } else {
                            OS.renderTideError('조석 데이터 조회 실패');
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
     * 렌더링 2) 에러 (격자 밖/육지 등)
     * ------------------------------------------------------------ */
    OS.renderTideError = function (msg) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;
        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석</div>' +
              '</div>' +
              '<div class="ocean-tide-error">' +
                '<i class="fa-solid fa-circle-exclamation"></i>' +
                '<div class="ocean-tide-error-text">' + escapeHtml(msg) + '</div>' +
              '</div>' +
            '</div>';
    };

    /* --------------------------------------------------------------
     * 렌더링 3) 상세 (4피크 + 현재 조위 + 헤더 진행바)
     *
     * @param {Object} data       /data/tide_*.json 응답 형식
     *                            (highTide1~4, lowTide1~4, analysis)
     * @param {boolean} isIdw     동해북부 IDW 보간 결과 여부
     * @param {Date} dateObj      이 카드가 표시 중인 날짜
     * ------------------------------------------------------------ */
    OS.renderTideData = function (data, isIdw, dateObj) {
        var card = document.getElementById('ocean-card-tide');
        if (!card) return;

        var peaks = collectPeaks(data); // [{type:'high'|'low', minutes, level}, ...]
        if (peaks.length === 0) {
            OS.renderTideError('조석 분석 데이터가 비어 있습니다.');
            return;
        }
        peaks.sort(function (a, b) { return a.minutes - b.minutes; });

        var todayMode = OS.isToday(dateObj);
        var nowMin = nowMinutes();

        // 직전·다음 피크 계산 (오늘일 때만 의미 있음)
        var prevPeak = null, nextPeak = null;
        if (todayMode) {
            for (var i = 0; i < peaks.length; i++) {
                if (peaks[i].minutes <= nowMin) prevPeak = peaks[i];
                if (peaks[i].minutes > nowMin && !nextPeak) nextPeak = peaks[i];
            }
        }

        // 4피크 리스트의 ±차이값: 직전 반대 피크 대비
        // peaks 배열을 시간순으로 두고, 각 피크에 대해 그 직전의 반대 type 피크를 찾아 차이 계산
        for (var j = 0; j < peaks.length; j++) {
            var p = peaks[j];
            var dprev = null;
            for (var k = j - 1; k >= 0; k--) {
                if (peaks[k].type !== p.type) { dprev = peaks[k]; break; }
            }
            // 직전 반대 피크가 없으면 그 다음 반대 피크와 비교 (배열 첫 항목 보호)
            if (!dprev) {
                for (var k2 = j + 1; k2 < peaks.length; k2++) {
                    if (peaks[k2].type !== p.type) { dprev = peaks[k2]; break; }
                }
            }
            p.diff = dprev ? (p.level - dprev.level) : null;
        }

        var highs = peaks.filter(function (p) { return p.type === 'high'; }).slice(0, 2);
        var lows  = peaks.filter(function (p) { return p.type === 'low'; }).slice(0, 2);

        // 헤더: "다음" 피크 / "그 다음" 피크 (오늘일 때만 진행 막대 표시)
        var headHtml = renderHeadHtml(prevPeak, nextPeak, todayMode, peaks);

        // 현재 조위 (오늘만)
        var currentHtml = '';
        if (todayMode && prevPeak && nextPeak) {
            var curLevel = interpolateLevel(prevPeak, nextPeak, nowMin);
            var rising = nextPeak.type === 'high';
            currentHtml =
                '<div class="ocean-tide-current">' +
                  '<span class="ocean-tide-current-label">현재 예상 조위</span>' +
                  '<span class="ocean-tide-current-big">' + Math.round(curLevel) + ' cm</span>' +
                  '<span class="ocean-tide-current-arrow ' + (rising ? 'is-up' : 'is-down') + '">' +
                    (rising ? '▲' : '▼') +
                  '</span>' +
                '</div>';
        }

        // 4피크 리스트
        var peaksHtml =
            '<div class="ocean-tide-peaks">' +
              renderPeakGroup('고조', 'is-high', highs, '▲') +
              renderPeakGroup('저조', 'is-low',  lows,  '▼') +
            '</div>';

        var idwBadge = isIdw
            ? '<div class="ocean-tide-idw-badge">표준항 보간 결과</div>' : '';

        card.style.display = '';
        card.innerHTML =
            '<div class="ocean-tide-wrap">' +
              '<div class="ocean-tide-title-row">' +
                '<div class="ocean-tide-title"><i class="fa-solid fa-water"></i> 조석</div>' +
                idwBadge +
              '</div>' +
              headHtml +
              currentHtml +
              peaksHtml +
            '</div>';
    };

    /* --------------------------------------------------------------
     * 내부: 헤더 (좌:다음피크 / 가운데:진행막대 / 우:그 다음 피크)
     * ------------------------------------------------------------ */
    function renderHeadHtml(prevPeak, nextPeak, todayMode, peaks) {
        if (!todayMode || !prevPeak || !nextPeak) {
            return '';
        }
        // 좌측 라벨: 다음 피크 (시각 포함)
        var leftCls = nextPeak.type === 'high' ? 'is-high' : 'is-low';
        var leftLabel = (nextPeak.type === 'high' ? '고조 ' : '저조 ') + minutesToHHMM(nextPeak.minutes);

        // 우측 라벨: nextPeak 이후의 첫 번째 피크 (peaks 배열에서 시간순으로 다시 찾음)
        var afterNext = null;
        if (peaks && peaks.length) {
            for (var i = 0; i < peaks.length; i++) {
                if (peaks[i].minutes > nextPeak.minutes) { afterNext = peaks[i]; break; }
            }
        }
        var rightCls, rightLabel;
        if (afterNext) {
            rightCls = afterNext.type === 'high' ? 'is-high' : 'is-low';
            rightLabel = (afterNext.type === 'high' ? '고조 ' : '저조 ') + minutesToHHMM(afterNext.minutes);
        } else {
            rightCls = nextPeak.type === 'high' ? 'is-low' : 'is-high';
            rightLabel = (nextPeak.type === 'high' ? '저조' : '고조');
        }

        var nowMin = nowMinutes();
        var pct = ((nowMin - prevPeak.minutes) / (nextPeak.minutes - prevPeak.minutes)) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        var remainMin = Math.max(0, nextPeak.minutes - nowMin);
        var remainStr = formatRemain(remainMin);
        // "고조까지 남은시간 HH:MM" 또는 "저조까지 남은시간 HH:MM"
        var remainText = (nextPeak.type === 'high' ? '고조까지' : '저조까지') + ' 남은시간 ' + remainStr;

        return (
            '<div class="ocean-tide-head">' +
              '<div class="ocean-tide-head-labels">' +
                '<div class="ocean-tide-head-side ' + leftCls + '">' + leftLabel + '</div>' +
                '<div class="ocean-tide-head-side ' + rightCls + '">' + rightLabel + '</div>' +
              '</div>' +
              '<div class="ocean-tide-progress-track">' +
                '<div class="ocean-tide-progress-fill" style="width:' + pct.toFixed(1) + '%"></div>' +
                '<div class="ocean-tide-progress-marker" style="left:' + pct.toFixed(1) + '%"></div>' +
              '</div>' +
              '<div class="ocean-tide-progress-remain">' + remainText + '</div>' +
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
            var diffStr = (diff == null) ? '' :
                (diff > 0 ? '+' + Math.round(diff) : '' + Math.round(diff));
            return (
                '<div class="ocean-tide-peak-row">' +
                  '<span class="ocean-tide-peak-time">' + minutesToHHMM(p.minutes) + '</span>' +
                  '<span class="ocean-tide-peak-cm">(' + Math.round(p.level) + ' cm)</span>' +
                  '<span class="ocean-tide-peak-arrow ' + cls + '">' + arrow + '</span>' +
                  '<span class="ocean-tide-peak-diff ' + cls + '">' + diffStr + '</span>' +
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
    function nowMinutes() {
        var d = new Date();
        return d.getHours() * 60 + d.getMinutes();
    }
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
    function minutesToHHMM(m) {
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    function formatRemain(m) {
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }
})();
