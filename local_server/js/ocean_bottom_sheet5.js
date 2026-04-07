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

        // (2) 6개 일반카드 reset → 진행바 표시 + 카드 보이기
        ['ocean-val-depth', 'ocean-val-temp', 'ocean-val-current',
         'ocean-val-wind', 'ocean-val-wave', 'ocean-val-airtemp'
        ].forEach(function (id) { OS.resetCardToProgress(id); });

        ['ocean-card-depth', 'ocean-card-temp', 'ocean-card-current',
         'ocean-card-wind', 'ocean-card-wave', 'ocean-card-airtemp'
        ].forEach(function (id) { OS.showCard(id); });

        // (3) 천문: 즉시 동기 렌더
        if (OS.renderAstroCard) OS.renderAstroCard(lat, lon, d);

        // (4) 조석: 비동기 로딩
        if (OS.fetchTideForSheet) OS.fetchTideForSheet(lat, lon, d);

        // (5) 6개 일반 카드: 일단 모든 날짜에서 호출 (안A)
        //     백엔드 정상화 전까지 카드 자동 숨김도 임시 해제 — 실패 시 "데이터 없음" 텍스트 표출
        fetchDepth(lat, lon);
        fetchRoms(lat, lon, d);
        fetchWeather(lat, lon);
        fetchWave(lat, lon);

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
                    OS.setCardValue('ocean-val-current',
                        OS.windDirToText(data.crdir) + ' ' + data.crsp.toFixed(1) + ' cm/s');
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

    function fetchWeather(lat, lon) {
        fetch('/api/ocean/weather?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) {
                    OS.setCardValue('ocean-val-wind', '데이터 없음');
                    OS.setCardValue('ocean-val-airtemp', '데이터 없음');
                    return;
                }
                if (data.windDir != null && data.windSpeed != null) {
                    OS.setCardValue('ocean-val-wind',
                        OS.windDirToText(data.windDir) + ' ' + data.windSpeed.toFixed(1) + ' m/s');
                    OS.showCard('ocean-card-wind');
                } else {
                    OS.setCardValue('ocean-val-wind', '데이터 없음');
                }
                if (data.temperature != null) {
                    OS.setCardValue('ocean-val-airtemp', data.temperature.toFixed(1) + '\u00B0C');
                    OS.showCard('ocean-card-airtemp');
                } else {
                    OS.setCardValue('ocean-val-airtemp', '데이터 없음');
                }
            })
            .catch(function () {
                OS.setCardValue('ocean-val-wind', '데이터 없음');
                OS.setCardValue('ocean-val-airtemp', '데이터 없음');
            });
    }

    function fetchWave(lat, lon) {
        fetch('/api/ocean/wave?lat=' + lat + '&lon=' + lon)
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
     * 저질 분석 (기존 로직 이식)
     * ------------------------------------------------------------ */
    OS.requestSeabed = function (lat, lon) {
        var resultEl = document.getElementById('ocean-seabed-result');
        var btn = document.getElementById('ocean-seabed-btn');
        if (!resultEl || !btn) return;

        btn.disabled = true;
        btn.textContent = '분석 중...';
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<div class="ocean-progress-bar"><div class="ocean-progress-bar-fill"></div></div>';

        captureMapTile(lat, lon)
            .then(function (imageData) {
                if (!imageData) {
                    resultEl.innerHTML = '<p>해도 이미지를 가져올 수 없습니다.</p>';
                    restoreSeabedBtn();
                    return null;
                }
                return fetch('/api/ocean/seabed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: imageData, lat: lat, lon: lon })
                });
            })
            .then(function (r) { return r ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                if (data.success && data.seabed) {
                    var sb = data.seabed;
                    resultEl.innerHTML =
                        '<div class="ocean-seabed-info">' +
                          '<div class="ocean-seabed-primary"><strong>주요 저질:</strong> ' + (sb.primary || '--') + '</div>' +
                          (sb.secondary ? '<div class="ocean-seabed-secondary"><strong>보조:</strong> ' + sb.secondary + '</div>' : '') +
                          '<div class="ocean-seabed-summary">' + (sb.summary || '') + '</div>' +
                          '<div class="ocean-seabed-char">' + (sb.characteristics || '') + '</div>' +
                        '</div>';
                } else {
                    resultEl.innerHTML = '<p>' + (data.error || '분석 실패') + '</p>';
                }
                restoreSeabedBtn();
            })
            .catch(function () {
                resultEl.innerHTML = '<p>저질 분석 중 오류가 발생했습니다.</p>';
                restoreSeabedBtn();
            });

        function restoreSeabedBtn() {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
        }
    };

    function captureMapTile(lat, lon) {
        return new Promise(function (resolve) {
            var map = window.getOceanMap ? window.getOceanMap() : null;
            if (!map) { resolve(null); return; }
            try {
                map.once('rendercomplete', function () {
                    var canvas = map.getViewport().querySelector('canvas');
                    resolve(canvas ? canvas.toDataURL('image/png') : null);
                });
                map.renderSync();
            } catch (e) { resolve(null); }
        });
    }
})();
