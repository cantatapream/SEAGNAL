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
     * ------------------------------------------------------------ */
    OS.loadAllForDate = function () {
        var lat = OS.state.lat;
        var lon = OS.state.lon;
        var d = OS.state.date;

        // (1) 조석/천문 카드 일단 표시 (3.js, 4.js가 채울 자리)
        OS.showCard('ocean-card-tide');
        OS.showCard('ocean-card-astro');

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
                };
            }
        });

        // (3) 천문: 즉시 동기 렌더
        if (OS.renderAstroCard) OS.renderAstroCard(lat, lon, d);

        // (4) 조석: 비동기 로딩
        if (OS.fetchTideForSheet) OS.fetchTideForSheet(lat, lon, d);

        // (5) 6개 일반 카드: 일단 모든 날짜에서 호출 (안A)
        //     백엔드 정상화 전까지 카드 자동 숨김도 임시 해제 — 실패 시 "데이터 없음" 텍스트 표출
        fetchDepth(lat, lon);
        fetchRoms(lat, lon, d);
        fetchWeather(lat, lon, d);
        fetchWave(lat, lon, d);

        // (6) 저질 버튼은 항상 보이고, 결과 영역만 숨김
        var seabedBtn = document.getElementById('ocean-seabed-btn');
        if (seabedBtn) {
            seabedBtn.disabled = false;
            seabedBtn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
            seabedBtn.onclick = function () { OS.requestSeabed(lat, lon); };
        }
        var seabedResult = document.getElementById('ocean-seabed-result');
        if (seabedResult) {
            seabedResult.style.display = 'none';
            seabedResult.innerHTML = '';
        }
        OS.showCard('ocean-card-seabed');
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
                    OS.setCardValue('ocean-val-depth', '데이터 없음');
                }
            })
            .catch(function () { OS.setCardValue('ocean-val-depth', '데이터 없음'); });
    }

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
            // 사용자가 미래 날짜를 보고 있을 수도 있으니 정오를 기본으로
            var nowD = new Date();
            var sameDay = (d.getFullYear() === nowD.getFullYear() &&
                           d.getMonth() === nowD.getMonth() &&
                           d.getDate() === nowD.getDate());
            hourStr = sameDay
                ? String(nowD.getHours()).padStart(2, '0')
                : '12';
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

    function fetchWeather(lat, lon, dateObj) {
        var url = '/api/ocean/weather?lat=' + lat + '&lon=' + lon;
        if (dateObj) url += '&time=' + encodeURIComponent(dateObj.toISOString());
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    OS.setCardValue('ocean-val-wind', '데이터 없음');
                    OS.setCardValue('ocean-val-airtemp', '데이터 없음');
                    return;
                }
                if (data.windDir != null && data.windSpeed != null) {
                    OS.state.rawWindSpeed = data.windSpeed;
                    OS.state.rawWindDir = data.windDir;
                    OS.renderCurrentWindValues();
                    OS.showCard('ocean-card-wind');
                } else {
                    OS.setCardValue('ocean-val-wind', '데이터 없음');
                }
            })
            .catch(function () {
                OS.setCardValue('ocean-val-wind', '데이터 없음');
            });
    }

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
                    OS.setCardValue('ocean-val-wave', '데이터 없음');
                }
            })
            .catch(function () { OS.setCardValue('ocean-val-wave', '데이터 없음'); });
    }

    /* --------------------------------------------------------------
     * 해류/바람 단위 렌더 (m/s ↔ kts 토글)
     * rawCrsp(cm/s), rawWindSpeed(m/s) 원시값으로부터 계산.
     * 해류/바람 아이콘 클릭 시 호출.
     * ------------------------------------------------------------ */
    OS.renderCurrentWindValues = function () {
        var useKts = OS.state.useKts;

        // 해류 (cm/s → m/s 또는 kts)
        if (OS.state.rawCrsp != null && OS.state.rawCrdir != null) {
            var crMs = OS.state.rawCrsp / 100;
            var crDir = OS.windDirToText(OS.state.rawCrdir);
            var crText = useKts
                ? crDir + ' ' + (crMs * 1.944).toFixed(2) + ' kts'
                : crDir + ' ' + crMs.toFixed(2) + ' m/s';
            OS.setCardValue('ocean-val-current', crText);
            var crIcon = document.getElementById('ocean-icon-current');
            if (crIcon) crIcon.classList.toggle('kts-active', useKts);
        }

        // 바람 (m/s 또는 kts)
        if (OS.state.rawWindSpeed != null && OS.state.rawWindDir != null) {
            var wMs = OS.state.rawWindSpeed;
            var wDir = OS.windDirToText(OS.state.rawWindDir);
            var wText = useKts
                ? wDir + ' ' + (wMs * 1.944).toFixed(1) + ' kts'
                : wDir + ' ' + wMs.toFixed(1) + ' m/s';
            OS.setCardValue('ocean-val-wind', wText);
            var wIcon = document.getElementById('ocean-icon-wind');
            if (wIcon) wIcon.classList.toggle('kts-active', useKts);
        }
    };

    /* --------------------------------------------------------------
     * 저질 + 해도 수심 AI 분석
     * - 클라이언트 뷰포트 캡처 방식 제거
     * - 서버에서 해아름 WMS 이미지를 직접 취득하여 Gemini 분석
     * ------------------------------------------------------------ */
    OS.requestSeabed = function (lat, lon) {
        var resultEl = document.getElementById('ocean-seabed-result');
        var btn      = document.getElementById('ocean-seabed-btn');
        if (!resultEl || !btn) return;

        btn.disabled  = true;
        btn.textContent = '분석 중...';
        resultEl.style.display = 'block';
        resultEl.innerHTML =
            '<div class="ocean-progress-bar">' +
              '<div class="ocean-progress-bar-fill"></div>' +
            '</div>';

        // 좌표만 전송 — 이미지는 서버에서 해아름 WMS 직접 요청
        fetch('/api/ocean/seabed', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ lat: lat, lon: lon })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data) { renderError('응답 없음'); return; }
                if (!data.success || !data.seabed) {
                    renderError(data.error || '분석 실패');
                    return;
                }

                var sb = data.seabed;

                // ── 육지·항내 ────────────────────────────────────────────
                if (sb.isLand) {
                    resultEl.innerHTML =
                        '<div class="ocean-seabed-info">' +
                          '<div class="ocean-seabed-land">' +
                            '⚠ 육지 또는 항내로 판단됩니다.<br>' +
                            '해상 위치를 클릭해주세요.' +
                          '</div>' +
                        '</div>';
                    restoreBtn();
                    return;
                }

                // ── BADA2024 수심 (기존 카드에 표시된 값 참조) ───────────
                var badaEl   = document.getElementById('ocean-val-depth');
                var badaText = (badaEl && badaEl.textContent.trim() !== '데이터 없음')
                    ? badaEl.textContent.trim() : null;

                // ── 해도 수심 행 ─────────────────────────────────────────
                var depthHtml = '';
                if (sb.depth != null) {
                    depthHtml =
                        '<div class="ocean-seabed-depth">' +
                          '<strong>해도 수심 (AI):</strong> 약 ' + sb.depth + 'm' +
                          (sb.depthNote
                              ? '<span class="ocean-seabed-depth-note"> — ' + sb.depthNote + '</span>'
                              : '') +
                        '</div>';
                    if (badaText) {
                        depthHtml +=
                            '<div class="ocean-seabed-bada">' +
                              '<strong>BADA2024 수심:</strong> ' + badaText +
                            '</div>';
                    }
                }

                // ── 저질 행 ─────────────────────────────────────────────
                var seabedHtml =
                    '<div class="ocean-seabed-primary">' +
                      '<strong>주요 저질:</strong> ' + (sb.primary || '--') +
                    '</div>' +
                    (sb.secondary
                        ? '<div class="ocean-seabed-secondary">' +
                            '<strong>보조 저질:</strong> ' + sb.secondary +
                          '</div>'
                        : '');

                resultEl.innerHTML =
                    '<div class="ocean-seabed-info">' +
                      seabedHtml +
                      depthHtml +
                      (sb.summary
                          ? '<div class="ocean-seabed-summary">' + sb.summary + '</div>'
                          : '') +
                      (sb.characteristics
                          ? '<div class="ocean-seabed-char">' + sb.characteristics + '</div>'
                          : '') +
                    '</div>';

                restoreBtn();
            })
            .catch(function () {
                renderError('저질 분석 중 오류가 발생했습니다.');
            });

        function renderError(msg) {
            resultEl.innerHTML = '<p class="ocean-seabed-error">' + msg + '</p>';
            restoreBtn();
        }
        function restoreBtn() {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
        }
    };
})();
