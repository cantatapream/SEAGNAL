/**
 * ============================================================================
 * 파일명: js/ocean_bottom_sheet.js
 * 역할: 해양종합정보 바텀시트 (데이터 로딩 + 표시)
 * ============================================================================
 *
 * [설명]
 * 지도 클릭 시 바텀시트를 표시하고, 5개 API를 병렬 호출하여
 * 각 데이터가 도착하는 즉시 스켈레톤 → 실제 값으로 교체합니다.
 *
 * [데이터 소스]
 * 1. 조석 → TideBED (기존 /api/save_tide_input)
 * 2. 수심 → /api/ocean/depth
 * 3. ROMS(수온/해류) → /api/ocean/roms
 * 4. 기상(풍향속/기온) → /api/ocean/weather
 * 5. 파고 → /api/ocean/wave
 * 6. 저질 → /api/ocean/seabed (수동 버튼)
 *
 * [연계 파일]
 * - ocean_map.js → showOceanBottomSheet() 호출
 * - index.html → #ocean-bottom-sheet 구조
 * ============================================================================
 */

(function () {
    'use strict';

    // 풍향 → 방위 텍스트 변환
    const WIND_DIR_NAMES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

    function windDirToText(deg) {
        if (deg == null || isNaN(deg)) return '--';
        var idx = Math.round(deg / 22.5) % 16;
        return WIND_DIR_NAMES[idx];
    }

    /**
     * 바텀시트를 표시하고 데이터를 병렬 로딩합니다.
     *
     * @param {number} lat - 위도
     * @param {number} lon - 경도
     * @param {Object} [stationInfo] - 표준항 정보 (선택)
     */
    window.showOceanBottomSheet = function (lat, lon, stationInfo) {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;

        // 바텀시트 표시
        sheet.style.display = 'block';
        setTimeout(function () { sheet.classList.add('open'); }, 10);

        // 제목 설정
        var title = document.getElementById('ocean-sheet-title');
        if (title) {
            if (stationInfo && stationInfo.stationName) {
                title.textContent = stationInfo.stationName;
            } else {
                title.textContent = lat.toFixed(3) + ', ' + lon.toFixed(3);
            }
        }

        // 모든 값을 스켈레톤 상태로 초기화
        resetValues();

        // 닫기 버튼
        var closeBtn = document.getElementById('ocean-sheet-close');
        if (closeBtn) {
            closeBtn.onclick = closeBottomSheet;
        }

        // 저질 확인 버튼
        var seabedBtn = document.getElementById('ocean-seabed-btn');
        if (seabedBtn) {
            seabedBtn.onclick = function () { requestSeabed(lat, lon); };
        }
        var seabedResult = document.getElementById('ocean-seabed-result');
        if (seabedResult) seabedResult.style.display = 'none';

        // 5개 API 병렬 호출
        fetchDepth(lat, lon);
        fetchRoms(lat, lon);
        fetchWeather(lat, lon);
        fetchWave(lat, lon);
        fetchTide(lat, lon, stationInfo);
    };

    function closeBottomSheet() {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (sheet) {
            sheet.classList.remove('open');
            setTimeout(function () { sheet.style.display = 'none'; }, 300);
        }
    }

    /**
     * 모든 데이터 값을 스켈레톤 상태로 초기화
     */
    function resetValues() {
        var ids = ['ocean-val-tide', 'ocean-val-depth', 'ocean-val-temp',
            'ocean-val-current', 'ocean-val-wind', 'ocean-val-wave', 'ocean-val-airtemp'];
        ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.textContent = '';
                el.classList.add('ocean-skeleton');
            }
        });
    }

    /**
     * 값 설정 + 스켈레톤 해제
     */
    function setValue(id, text) {
        var el = document.getElementById(id);
        if (el) {
            el.textContent = text;
            el.classList.remove('ocean-skeleton');
        }
    }

    // ========================================================================
    // 개별 데이터 Fetch
    // ========================================================================

    function fetchDepth(lat, lon) {
        fetch('/api/ocean/depth?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    setValue('ocean-val-depth', data.depth.toFixed(1) + 'm');
                } else {
                    setValue('ocean-val-depth', '데이터 없음');
                }
            })
            .catch(function () { setValue('ocean-val-depth', '조회 실패'); });
    }

    function fetchRoms(lat, lon) {
        fetch('/api/ocean/roms?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    // 수온
                    var tempText = data.wtem != null ? data.wtem.toFixed(1) + '\u00B0C' : '--';
                    setValue('ocean-val-temp', tempText);

                    // 해류 (유향 + 유속)
                    var dirText = data.crdir != null ? windDirToText(data.crdir) : '--';
                    var spdText = data.crsp != null ? data.crsp.toFixed(1) + 'cm/s' : '--';
                    setValue('ocean-val-current', dirText + ' ' + spdText);
                } else {
                    setValue('ocean-val-temp', '데이터 없음');
                    setValue('ocean-val-current', '데이터 없음');
                }
            })
            .catch(function () {
                setValue('ocean-val-temp', '조회 실패');
                setValue('ocean-val-current', '조회 실패');
            });
    }

    function fetchWeather(lat, lon) {
        fetch('/api/ocean/weather?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    // 바람
                    var wDir = data.windDir != null ? windDirToText(data.windDir) : '--';
                    var wSpd = data.windSpeed != null ? data.windSpeed.toFixed(1) + 'm/s' : '--';
                    setValue('ocean-val-wind', wDir + ' ' + wSpd);

                    // 기온
                    var tempText = data.temperature != null ? data.temperature.toFixed(1) + '\u00B0C' : '--';
                    setValue('ocean-val-airtemp', tempText);
                } else {
                    setValue('ocean-val-wind', '데이터 없음');
                    setValue('ocean-val-airtemp', '데이터 없음');
                }
            })
            .catch(function () {
                setValue('ocean-val-wind', '조회 실패');
                setValue('ocean-val-airtemp', '조회 실패');
            });
    }

    function fetchWave(lat, lon) {
        fetch('/api/ocean/wave?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    var whText = data.waveHeight != null ? data.waveHeight.toFixed(1) + 'm' : '--';
                    setValue('ocean-val-wave', whText);
                } else {
                    setValue('ocean-val-wave', '데이터 없음');
                }
            })
            .catch(function () { setValue('ocean-val-wave', '조회 실패'); });
    }

    function fetchTide(lat, lon, stationInfo) {
        // TideBED API 흐름:
        // 1) POST /api/save_tide_input → { success, gridHash, files: { today: "tide_YYYYMMDD_hash.json" } }
        // 2) 서버가 백그라운드에서 데이터 수집
        // 3) GET /data/{filename} → 수집된 조석 데이터
        var dateInt = formatDate(window.getOceanDate ? window.getOceanDate() : new Date());
        var body = { lat: lat, lon: lon, date: dateInt };

        fetch('/api/save_tide_input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !data.files || !data.files.today) {
                    setValue('ocean-val-tide', '조석 데이터 없음');
                    return;
                }
                // 수집 완료 대기 후 파일 조회 (2초 후 재시도)
                var fileName = data.files.today;
                var retries = 0;
                var maxRetries = 5;

                function pollTideData() {
                    fetch('/data/' + fileName)
                        .then(function (r) { return r.json(); })
                        .then(function (tideData) {
                            if (tideData.tideBedStatus === 'complete' && tideData.analysis) {
                                // 고조/저조 표시
                                var peaks = tideData.analysis;
                                if (peaks.length > 0) {
                                    var text = peaks.slice(0, 2).map(function (p) {
                                        var type = p.type === 'high' ? '만조' : '간조';
                                        return type + ' ' + (p.time || '') + ' ' + (p.level ? p.level + 'cm' : '');
                                    }).join(' / ');
                                    setValue('ocean-val-tide', text);
                                } else {
                                    setValue('ocean-val-tide', '분석 데이터 없음');
                                }
                            } else if (retries < maxRetries) {
                                retries++;
                                setTimeout(pollTideData, 2000);
                            } else {
                                setValue('ocean-val-tide', '수집 중...');
                            }
                        })
                        .catch(function () {
                            if (retries < maxRetries) {
                                retries++;
                                setTimeout(pollTideData, 2000);
                            } else {
                                setValue('ocean-val-tide', '조회 실패');
                            }
                        });
                }

                // 캐시 히트면 즉시 조회, 아니면 2초 대기 후 폴링
                if (data.cached >= 1) {
                    pollTideData();
                } else {
                    setTimeout(pollTideData, 2000);
                }
            })
            .catch(function () { setValue('ocean-val-tide', '조회 실패'); });
    }

    // ========================================================================
    // 저질 AI 분석
    // ========================================================================

    function requestSeabed(lat, lon) {
        var resultEl = document.getElementById('ocean-seabed-result');
        var btn = document.getElementById('ocean-seabed-btn');
        if (!resultEl || !btn) return;

        btn.disabled = true;
        btn.textContent = '분석 중...';
        resultEl.style.display = 'block';
        resultEl.innerHTML = '<div class="ocean-skeleton" style="height:60px;"></div>';

        // 해아름 ENC57 타일 이미지 캡처
        // 현재 지도 뷰에서 해당 좌표 근처의 해도 타일을 가져옴
        captureMapTile(lat, lon)
            .then(function (imageData) {
                if (!imageData) {
                    resultEl.innerHTML = '<p>해도 이미지를 가져올 수 없습니다.</p>';
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
                    return;
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

                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
            })
            .catch(function () {
                resultEl.innerHTML = '<p>저질 분석 중 오류가 발생했습니다.</p>';
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-gem"></i> 저질 확인 (AI 분석)';
            });
    }

    /**
     * 지도의 현재 캔버스에서 특정 좌표 주변 타일 이미지를 캡처합니다.
     * ENC57 레이어가 없으면 현재 지도 캔버스를 캡처합니다.
     */
    function captureMapTile(lat, lon) {
        return new Promise(function (resolve) {
            var map = window.getOceanMap ? window.getOceanMap() : null;
            if (!map) { resolve(null); return; }

            try {
                map.once('rendercomplete', function () {
                    var canvas = map.getViewport().querySelector('canvas');
                    if (canvas) {
                        resolve(canvas.toDataURL('image/png'));
                    } else {
                        resolve(null);
                    }
                });
                map.renderSync();
            } catch (e) {
                resolve(null);
            }
        });
    }

    // ========================================================================
    // 유틸리티
    // ========================================================================

    /**
     * TideBED API가 기대하는 YYYYMMDD 정수 형식으로 날짜를 변환
     */
    function formatDate(date) {
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return parseInt(y + '' + m + '' + d);
    }

})();
