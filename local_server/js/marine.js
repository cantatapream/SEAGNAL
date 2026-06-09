/**
 * ============================================================================
 * 파일명: js/marine.js
 * 역할: 해구별 기상정보 모달, 해양 차트 렌더링
 * ============================================================================
 *
 * [설명]
 * - showMarineZoneModal(): 해구별 기상 상세 모달 표시
 * - parseMarineZoneData(): API 데이터 파싱
 * - renderMarineChart(): Chart.js 기반 해양 기상 차트
 * - getZoneCoordinatesByZoneId(): 해구 좌표 조회
 * - pixelToGps(), openZoneWindy(): Windy 연동
 *
 * [로딩 순서] 7번째 (render_coastal.js 이후)
 * ============================================================================
 */

// ============================================================
// 🌊 해구별 기상정보 (APIHub)
// ============================================================

/**
 * 해구 데이터 조회 및 모달 표시
 * @param {string} zoneId 해구번호
 */

// 모달 닫기
window.closeSeaZoneModal = function () {
    // 진행 중인 요청 취소 (요청 ID 무효화)
    window._marineZoneRequestId = null;

    const modal = document.getElementById('sea-zone-modal');
    if (modal) {
        // 차트 인스턴스 정리 (메모리 누수 방지)
        const chartCanvas = document.getElementById('marineChart');
        if (chartCanvas) {
            const chartInstance = Chart.getChart(chartCanvas);
            if (chartInstance) chartInstance.destroy();
        }
        // 모달 완전 제거 (다음 호출 시 새로 생성)
        modal.remove();
    }
};

// 로컬 서버에서 해구별 데이터 받아오기
window.getMarineZoneData = async function (zoneId) {
    // 요청 ID 생성 (모달 닫기 시 취소 확인용)
    const requestId = Date.now() + '_' + zoneId;
    window._marineZoneRequestId = requestId;

    showMarineZoneModal(zoneId, null, true);

    // 대해구 번호 추출
    let lZone = zoneId;
    let isSmallZone = false;

    if (String(zoneId).includes('-')) {
        const parts = String(zoneId).split('-');
        lZone = parts[0];
        isSmallZone = true;
    }

    // [시정] MMIS 해구별 시정예측을 병렬로 미리 요청 (천기와 동일: 클라이언트 직접 fetch)
    const visPromise = fetchZoneVisibility(zoneId);

    try {
        // ============================================================
        // [성능 최적화 — 4순위] 단일 해구 라우트 사용
        // ------------------------------------------------------------
        // 예전: /api/marine-zone-forecasts        (전체 5.86 MB 다운로드)
        // 지금: /api/marine-zone-forecasts/:zone  (해당 zone 1개만, 약 30 KB)
        //
        // 모달은 사용자가 클릭한 단 1개 해구만 보여주므로 전체 응답을 받을 필요 없음.
        // 서버는 dataCache.zoneForecasts.data[lZone] 만 골라 똑같은 구조로 응답해 주므로
        // 아래의 json.data[lZone] 파싱 로직은 그대로 사용할 수 있다.
        //
        // 참고: zone_avg.js / surfing1.js 는 전체 데이터를 자체 가공하므로
        //       여전히 기존 /api/marine-zone-forecasts (전체 dump) 라우트를 사용한다.
        //       즉, 두 라우트가 공존하며 서로 영향 주지 않는다.
        // ============================================================
        const response = await fetch(`/api/marine-zone-forecasts/${encodeURIComponent(lZone)}`);
        if (!response.ok) throw new Error('로컬 서버 응답 오류');

        const json = await response.json();

        // 요청이 취소되었는지 확인
        if (requestId !== window._marineZoneRequestId) return;

        // 데이터 찾기
        const zoneData = json.data && json.data[lZone];

        if (zoneData && zoneData.length > 0) {
            // [현재 시각부터] 이미 지나간 슬롯은 제거(진행 중 슬롯 1개는 포함).
            const trimmed = trimPastMarineRows(zoneData);

            // [즉시 표출] 풍속/파고 등 기존 정보는 시정을 기다리지 않고 바로 그린다.
            //   시정은 별도 fetch — 도착 후 applyMarineVisibility() 가 텍스트 행 + 합본 그래프를 채움.
            const formattedData = trimmed.map(item => ({
                ...item,
                displayTime: formatMarineTime(item.tm),
                vs: null
            }));
            formattedData.baseTime = json.baseTmUtf;
            formattedData._visLoading = true;

            showMarineZoneModal(zoneId, formattedData, false, null, json.baseTmUtf);

            // [지연 병합] 시정 도착하면 vs 채우고 시정 텍스트 행 + 합본 그래프 갱신 (실패해도 표 유지).
            visPromise.then(visMap => {
                if (requestId !== window._marineZoneRequestId) return;  // 모달 닫힘/교체 시 무시
                formattedData.forEach(d => {
                    const vs = visMap[d.tm];
                    d.vs = (typeof vs === 'number') ? vs : null;
                });
                applyMarineVisibility(formattedData);
            }).catch(() => {
                if (requestId !== window._marineZoneRequestId) return;
                applyMarineVisibility(formattedData);  // vs 전부 null → '시정 정보 없음' 처리
            });
        } else {
            showMarineZoneModal(zoneId, null, false,
                `해당 해구(${zoneId})의 데이터가 없습니다.<br>스케줄러가 데이터를 수집할 때까지 기다려주세요.`);
        }
    } catch (error) {
        // console.error('해구별 데이터 조회 오류:', error);
        if (requestId !== window._marineZoneRequestId) return;
        showMarineZoneModal(zoneId, null, false, `데이터 조회 중 오류: ${error.message}`);
    }
};

// 데이터 파싱 함수
function parseMarineZoneData(text) {
    const lines = text.trim().split('\n');
    const result = [];

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('m/s') || lines[i].includes('sec') || lines[i].includes('deg')) {
            headerIndex = i;
            break;
        }
    }

    const startIndex = (headerIndex !== -1) ? headerIndex + 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.startsWith('#') || line.startsWith('/')) continue;

        const parts = line.split(/\s+/);
        if (parts.length < 10) continue;

        const len = parts.length;
        const tm = parts[1];
        const wh = parseFloat(parts[len - 5]);
        const wp = parseFloat(parts[len - 4]);
        const waveDir = parseFloat(parts[len - 3]);
        const ws = parseFloat(parts[len - 2]);
        const windDir = parseFloat(parts[len - 1]);

        if (!isNaN(wh)) {
            result.push({
                tm: tm,
                displayTime: formatMarineTime(tm),
                wh: wh,
                wp: wp,
                waveDir: waveDir,
                ws: ws,
                windDir: windDir
            });
        }
    }
    return result;
}

// UTC "YYYYMMDDHH" → KST(+9h) 파트 분해. 표는 KST 기준으로 표시해야 하므로 공용 사용.
function _tmKst(tm) {
    const d = new Date(Date.UTC(+tm.substring(0, 4), +tm.substring(4, 6) - 1, +tm.substring(6, 8), +tm.substring(8, 10)));
    d.setUTCHours(d.getUTCHours() + 9);
    const p = n => String(n).padStart(2, '0');
    return {
        ymd: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
        mm: p(d.getUTCMonth() + 1),
        dd: p(d.getUTCDate()),
        hh: p(d.getUTCHours())
    };
}

// 시간 포맷팅 — tm 은 UTC "YYYYMMDDHH" 이므로 KST(+9h) 로 변환해 "MM.DD HH시" 로 표시.
function formatMarineTime(tm) {
    if (!tm || tm.length < 10) return tm;
    const k = _tmKst(tm);
    return `${k.mm}.${k.dd} ${k.hh}시`;
}

// 현재(UTC) 시각 이전의 지나간 예보 슬롯 제거 — 진행 중인 슬롯 1개는 포함.
//   rows[].tm 은 UTC "YYYYMMDDHH" 문자열이라 동일 포맷 키와 문자열 비교로 충분.
function trimPastMarineRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const nowKey = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
    let startIdx = rows.findIndex(r => r.tm >= nowKey);
    if (startIdx === -1) return rows;                              // 전부 과거(만료) → 원본 유지
    if (startIdx > 0 && rows[startIdx].tm > nowKey) startIdx -= 1; // 진행 중 슬롯 포함
    return rows.slice(startIdx);
}

// ============================================================
// 🌫️ 해구 시정(視程) — MMIS 해구별 시정예측
//   천기 기능과 동일한 방식: 서버 수집 없이 클라이언트가 MMIS 를 직접 fetch.
//   GET /mmis_marine_api/v1/kma/fct/netcdf/small-area/latlon/data/detail?lat&lon
//     응답 payload.marine_zone[]: { fctTm:"YYYY.MM.DD HH:00"(KST), vs:시정(km), ... }
//   매칭: 우리 zone tm 은 UTC("YYYYMMDDHH"), MMIS fctTm 은 KST → UTC 로 환산해 키 매칭.
//   (TZ 검증: detail baseTm "..21:00"(KST) == mdl_data_prdct_time "..12:00+00:00"(UTC) → KST 확정)
// ============================================================
const MMIS_VS_DETAIL_URL = 'https://marine.kma.go.kr/mmis_marine_api/v1/kma/fct/netcdf/small-area/latlon/data/detail';

// "2026.06.09 12:00"(KST) → "2026060903"(UTC YYYYMMDDHH) — zone tm 과 비교용 키
function _mmisFctTmToUtcKey(fctTm) {
    const m = String(fctTm || '').match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${utc.getUTCFullYear()}${p(utc.getUTCMonth() + 1)}${p(utc.getUTCDate())}${p(utc.getUTCHours())}`;
}

// 해구 중심좌표로 시정 시계열을 받아 { UTC키 → vs(km) } 맵 반환. 실패 시 빈 맵(부가정보이므로 표는 유지).
async function fetchZoneVisibility(zoneId) {
    const out = {};
    try {
        const coords = getZoneCoordinatesByZoneId(zoneId);
        if (!coords || coords.lat == null || coords.lon == null) return out;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const url = `${MMIS_VS_DETAIL_URL}?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}`;
        let r;
        try {
            r = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!r || !r.ok) return out;
        const j = await r.json();
        const arr = (j && j.payload && j.payload.marine_zone) || [];
        arr.forEach(e => {
            const key = _mmisFctTmToUtcKey(e.fctTm);
            if (key && e.vs != null && !isNaN(e.vs)) out[key] = Number(e.vs);
        });
    } catch (e) {
        // 시정은 부가정보 — 실패해도 기존 풍향/풍속/파고 표는 그대로 표출
    }
    return out;
}

// 현재 표시 중인 해구 정보 (Windy 연동용)
let currentZoneInfo = { zoneId: null, lat: null, lon: null };

/**
 * 해구 번호에서 경위도 추출
 * SEA_ZONES_DATA의 격자 키를 역으로 파싱하여 중심 경위도 계산
 */
function getZoneCoordinatesByZoneId(zoneId) {
    if (typeof SEA_ZONES_DATA === 'undefined' || typeof GRID_DATA === 'undefined') {
        // console.warn('SEA_ZONES_DATA 또는 GRID_DATA가 없습니다.');
        return null;
    }

    // SEA_ZONES_DATA에서 해당 zoneId를 가진 격자 키 찾기
    let foundKey = null;
    for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
        if (String(value) === String(zoneId)) {
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        // [New] 소해구 ID 처리 (예: "244-1") - 픽셀 역산으로 좌표 추정
        if (typeof zoneId === 'string' && zoneId.includes('-')) {
            const parts = zoneId.split('-');
            if (parts.length === 2 && !isNaN(parts[1])) {
                const parentZoneNum = parts[0];
                const smallIdx = parseInt(parts[1], 10);

                // 부모 대해구 키 찾기
                let parentKey = null;
                for (const [key, value] of Object.entries(SEA_ZONES_DATA)) {
                    if (String(value) === String(parentZoneNum)) {
                        parentKey = key;
                        break;
                    }
                }

                if (parentKey) {
                    // 부모 격자 정보 파싱
                    const match = parentKey.match(/^(\d+)-(\d+)_(\d+)-(\d+)$/);
                    if (match && typeof GRID_DATA !== 'undefined') {
                        const lon1Key = match[1];
                        const lon2Key = match[2];
                        const lat1Key = match[3];
                        const lat2Key = match[4];

                        const x1 = GRID_DATA.lon[lon1Key]?.val;
                        const x2 = GRID_DATA.lon[lon2Key]?.val;
                        const y1 = GRID_DATA.lat[lat1Key]?.val;
                        const y2 = GRID_DATA.lat[lat2Key]?.val;

                        if (x1 != null && x2 != null && y1 != null && y2 != null) {
                            const width = x2 - x1;
                            const height = y2 - y1;
                            const cellW = width / 3;
                            const cellH = height / 3;

                            // 소해구 인덱스 (1~9) -> 행/열 (0~2)
                            // row 0: 1,2,3 / row 1: 4,5,6 / row 2: 7,8,9
                            const row = Math.floor((smallIdx - 1) / 3);
                            const col = (smallIdx - 1) % 3;

                            // 소해구 중심 픽셀
                            const centerX = x1 + col * cellW + cellW / 2;
                            const centerY = y1 + row * cellH + cellH / 2;

                            // 픽셀 -> GPS 변환
                            const gps = pixelToGps(centerX, centerY);
                            if (gps && gps.lat && gps.lon) {
                                // console.log(`소해구 ${zoneId} 좌표 계산됨:`, gps);
                                return { lat: gps.lat, lon: gps.lon };
                            }
                        }
                    }
                }
            }
        }

        // console.debug(`해구 ${zoneId}의 격자 키를 찾을 수 없습니다.`);
        return null;
    }

    // 격자 키 파싱: "lon1-lon2_lat1-lat2" 형식
    // 예: "125-129_65-62"
    const match = foundKey.match(/^(\d+)-(\d+)_(\d+)-(\d+)$/);
    if (!match) {
        // console.warn(`격자 키 파싱 실패: ${foundKey}`);
        return null;
    }

    const lon1Key = match[1];
    const lon2Key = match[2];
    const lat1Key = match[3];
    const lat2Key = match[4];

    // GRID_DATA에서 픽셀 좌표 가져오기
    const lon1Pixel = GRID_DATA.lon[lon1Key]?.val;
    const lon2Pixel = GRID_DATA.lon[lon2Key]?.val;
    const lat1Pixel = GRID_DATA.lat[lat1Key]?.val;
    const lat2Pixel = GRID_DATA.lat[lat2Key]?.val;

    if (lon1Pixel == null || lon2Pixel == null || lat1Pixel == null || lat2Pixel == null) {
        // console.warn(`GRID_DATA에서 값을 찾을 수 없습니다: ${foundKey}`);
        return null;
    }

    // 격자 중심 픽셀 좌표 계산
    const centerPixelX = (lon1Pixel + lon2Pixel) / 2;
    const centerPixelY = (lat1Pixel + lat2Pixel) / 2;

    // 픽셀 → GPS 좌표 변환 (함수 사용)
    const gps = pixelToGps(centerPixelX, centerPixelY);
    if (gps) {
        // console.log(`📍 해구 ${zoneId} 경위도: ${gps.lat.toFixed(2)}, ${gps.lon.toFixed(2)}`);
        return gps;
    }

    return null;
}

/**
 * 픽셀 좌표를 GPS 좌표(경도, 위도)로 변환
 * @param {number} x - 픽셀 X
 * @param {number} y - 픽셀 Y
 * @returns {{lat: number, lon: number}} GPS 좌표
 */
function pixelToGps(x, y) {
    if (typeof GRID_CALIBRATION_DATA === 'undefined') return null;

    // X -> Lon 변환
    let lon = null;
    const lonKeys = Object.keys(GRID_CALIBRATION_DATA.lon).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < lonKeys.length - 1; i++) {
        const k1 = lonKeys[i];
        const k2 = lonKeys[i + 1];
        const x1 = GRID_CALIBRATION_DATA.lon[k1];
        const x2 = GRID_CALIBRATION_DATA.lon[k2];

        if (x >= x1 && x <= x2) {
            const ratio = (x - x1) / (x2 - x1);
            lon = k1 + (k2 - k1) * ratio;
            break;
        }
    }
    // 범위를 약간 벗어난 경우 가장자리 값 사용 (보외법 또는 클램핑)
    if (lon === null) {
        if (x < GRID_CALIBRATION_DATA.lon[lonKeys[0]]) lon = lonKeys[0];
        else if (x > GRID_CALIBRATION_DATA.lon[lonKeys[lonKeys.length - 1]]) lon = lonKeys[lonKeys.length - 1];
    }

    // Y -> Lat 변환 (Lat는 위쪽이 값이 큼, 픽셀 Y는 아래쪽이 큼)
    let lat = null;
    const latKeys = Object.keys(GRID_CALIBRATION_DATA.lat).map(Number).sort((a, b) => a - b); // 오름차순

    for (let i = 0; i < latKeys.length - 1; i++) {
        const k1 = latKeys[i];
        const k2 = latKeys[i + 1];

        // 주의: 위도가 높을수록(북쪽) 픽셀 Y값은 작음(위쪽)
        const y_at_k1 = GRID_CALIBRATION_DATA.lat[k1]; // 큰 Y (저위도)
        const y_at_k2 = GRID_CALIBRATION_DATA.lat[k2]; // 작은 Y (고위도)

        // 범위 체크 (y_at_k2 <= y <= y_at_k1)
        const minY = Math.min(y_at_k1, y_at_k2);
        const maxY = Math.max(y_at_k1, y_at_k2);

        if (y >= minY && y <= maxY) {
            // 역비율 계산
            const ratio = (y - y_at_k1) / (y_at_k2 - y_at_k1);
            lat = k1 + (k2 - k1) * ratio;
            break;
        }
    }

    // 범위 밖 처리
    if (lat === null) {
        // 간단히 가장 가까운 Y값의 위도 반환
        let minDiff = Infinity;
        let closestLat = latKeys[0];

        for (const k of latKeys) {
            const diff = Math.abs(y - GRID_CALIBRATION_DATA.lat[k]);
            if (diff < minDiff) {
                minDiff = diff;
                closestLat = k;
            }
        }
        lat = closestLat;
    }

    return { lon: lon || 126.5, lat: lat || 35.0 };
}

/**
 * 현재 해구의 Windy 팝업 열기 (새 창 대신 팝업 모달)
 */
function openZoneWindy() {
    if (!currentZoneInfo.lat || !currentZoneInfo.lon) {
        alert('해구 위치 정보를 찾을 수 없습니다.');
        return;
    }

    const lat = currentZoneInfo.lat.toFixed(3);
    const lon = currentZoneInfo.lon.toFixed(3);
    const zoneId = currentZoneInfo.zoneId;

    // embed.windy.com URL 생성
    const embedUrl = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=7&level=surface&overlay=waves&product=ecmwf&menu=false&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`;
    const windyUrl = `https://www.windy.com/waves?waves,${lat},${lon},8`;

    // 기존 모달 제거
    const existingModal = document.getElementById('zone-windy-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'zone-windy-modal';
    modal.innerHTML = `
        <div class="zone-windy-overlay" onclick="closeZoneWindyPopup()"></div>
        <div class="zone-windy-content">
            <div class="zone-windy-header">
                <h3><i class="fa-solid fa-wind"></i> ${zoneId}해구 기상전망 - Windy</h3>
                <button class="zone-windy-close" onclick="closeZoneWindyPopup()">✕</button>
            </div>
            <div class="zone-windy-iframe">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
            </div>
            <div class="zone-windy-footer">
                <a href="${windyUrl}" target="_blank" class="zone-windy-link">
                    🔗 새 탭에서 열기
                </a>
            </div>
        </div>
    `;

    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 20000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // ⭐ CSS 스타일 추가 (없으면 생성)
    if (!document.getElementById('zone-windy-modal-style')) {
        const style = document.createElement('style');
        style.id = 'zone-windy-modal-style';
        style.textContent = `
            .zone-windy-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(5px);
            }
            .zone-windy-content {
                position: relative;
                width: 90%;
                max-width: 1200px;
                height: 85vh;
                background: #1a1e2e;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                animation: zoneWindyIn 0.3s ease-out;
                display: flex;
                flex-direction: column;
            }
            @keyframes zoneWindyIn {
                from {
                    opacity: 0;
                    transform: scale(0.9) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            .zone-windy-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                background: linear-gradient(135deg, #00c6ff, #0072ff);
                color: white;
            }
            .zone-windy-header h3 {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 600;
            }
            .zone-windy-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                font-size: 1.2rem;
                cursor: pointer;
                transition: all 0.2s;
            }
            .zone-windy-close:hover {
                background: rgba(255, 255, 255, 0.4);
                transform: scale(1.1);
            }
            .zone-windy-iframe {
                flex: 1;
                background: #0a0a0a;
            }
            .zone-windy-iframe iframe {
                width: 100%;
                height: 100%;
                border: none;
            }
            .zone-windy-footer {
                padding: 12px 20px;
                background: rgba(0, 0, 0, 0.3);
                text-align: center;
            }
            .zone-windy-link {
                color: #00c6ff;
                text-decoration: none;
                font-size: 0.9rem;
                transition: color 0.2s;
            }
            .zone-windy-link:hover {
                color: #66d9ff;
            }
            @media (max-width: 768px) {
                .zone-windy-content {
                    width: 95%;
                    height: 90vh;
                    border-radius: 12px;
                }
                .zone-windy-header {
                    padding: 12px 16px;
                }
                .zone-windy-header h3 {
                    font-size: 1rem;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(modal);
}

// Zone Windy 팝업 닫기
function closeZoneWindyPopup() {
    const modal = document.getElementById('zone-windy-modal');
    if (modal) modal.remove();
}

// Windy 함수 전역 노출
window.openZoneWindy = openZoneWindy;
window.closeZoneWindyPopup = closeZoneWindyPopup;

// 데이터 표시 및 차트/테이블 렌더링
function showMarineZoneModal(zoneId, data, isLoading, errorMessage, baseTime = null) {
    let modal = document.getElementById('sea-zone-modal');
    const isMobile = window.innerWidth <= 768;

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sea-zone-modal';
        modal.className = 'modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; justify-content:center; align-items:center; z-index:10000; padding:20px; box-sizing:border-box; backdrop-filter:blur(5px); opacity:0; transition:opacity 0.3s ease;';

        const modalWidth = isMobile ? '100%' : 'auto';
        const modalHeight = 'auto';
        const modalRadius = '16px';
        const modalMaxWidth = isMobile ? '100%' : '1400px';

        modal.innerHTML = `
        <div class="modal-content" style="background:#1e1e1e; width:${modalWidth}; min-width:${isMobile ? '0' : '600px'}; max-width:${modalMaxWidth}; max-height:90vh; height:${isMobile ? 'auto' : 'auto'}; border-radius:${modalRadius}; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); transform:translateY(20px); transition:transform 0.3s ease;">
            <div class="modal-header" style="background:#2c3e50; color:white; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; flex-shrink:0;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <h3 style="margin:0; font-size:${isMobile ? '16px' : '18px'}; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-water"></i> <span id="zone-modal-title"></span>
                    </h3>
                    <button id="zone-windy-btn" onclick="openZoneWindy()" style="display:flex; align-items:center; gap:5px; background:linear-gradient(135deg, #00c6fb, #005bea); border:none; color:white; padding:6px 12px; border-radius:16px; font-size:${isMobile ? '12px' : '13px'}; font-weight:600; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 8px rgba(0,91,234,0.3);" title="Windy에서 보기">
                        <i class="fas fa-wind"></i> Windy
                    </button>
                </div>
                <button onclick="closeSeaZoneModal()" style="background:none; border:none; color:#aaa; font-size:28px; cursor:pointer; padding:5px 10px; touch-action:manipulation;" title="닫기"><i class="fas fa-times"></i></button>
            </div>
            <div id="zone-modal-body" style="flex:1; padding:${isMobile ? '10px' : '15px'}; overflow:auto; color:#eee; font-family:'NotosansKR', sans-serif; -webkit-overflow-scrolling:touch;">
            </div>
        </div>`;
        document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // 열기 애니메이션
    requestAnimationFrame(() => {
        modal.style.opacity = '1';
        const content = modal.querySelector('.modal-content');
        if (content) content.style.transform = 'translateY(0)';
    });

    const titleSpan = document.getElementById('zone-modal-title');
    if (titleSpan) titleSpan.textContent = `${zoneId}해구 기상전망`;

    // 현재 해구 정보 저장 (Windy 연동용)
    currentZoneInfo.zoneId = zoneId;
    const coords = getZoneCoordinatesByZoneId(zoneId);
    if (coords) {
        currentZoneInfo.lat = coords.lat;
        currentZoneInfo.lon = coords.lon;
    } else {
        // 좌표를 찾지 못한 경우 기본값 사용 (한반도 중심)
        currentZoneInfo.lat = 35.5;
        currentZoneInfo.lon = 127.0;
    }

    let baseTimeFormatted = '';
    if (baseTime) {
        const bt = String(baseTime);
        if (bt.length >= 10) {
            // baseTmUtf 는 UTC → KST(+9h) 로 변환해 표시
            const k = _tmKst(bt);
            baseTimeFormatted = `${k.ymd.substring(0, 4)}.${k.mm}.${k.dd} ${k.hh}:00 발표`;
        } else {
            baseTimeFormatted = `발표시각: ${bt}`;
        }
    }

    const body = document.getElementById('zone-modal-body');
    if (!body) return;

    if (isLoading) {
        body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
            <i class="fas fa-spinner fa-spin fa-3x" style="color:#3498db; margin-bottom:20px;"></i>
            <div style="font-size:16px; color:#aaa;">기상청 데이터를 분석 중입니다...</div>
        </div>`;
        return;
    }

    if (errorMessage) {
        body.innerHTML = `
        <div style="text-align:center; padding:50px; color:#e74c3c;">
            <i class="fas fa-exclamation-triangle fa-3x" style="margin-bottom:15px;"></i>
            <h3>데이터 조회 실패</h3>
            <p>${errorMessage}</p>
        </div>`;
        return;
    }

    if (!data || data.length === 0) {
        body.innerHTML = '<div style="text-align:center; padding:50px;">데이터가 없습니다.</div>';
        return;
    }

    // 날짜별 그룹화 — tm 은 UTC 라 KST 날짜 기준으로 묶는다.
    const dateGroups = {};
    data.forEach(row => {
        const date = _tmKst(row.tm).ymd;
        if (!dateGroups[date]) dateGroups[date] = [];
        dateGroups[date].push(row);
    });

    // 테이블 HTML 생성
    // 테이블 HTML 생성
    let tableHTML = '<div id="marine-table-container" style="position:relative; overflow-x:auto; overflow-y:auto; -webkit-overflow-scrolling:touch; max-height:100%; touch-action:pan-x pan-y;"><table id="marine-zone-table" style="border-collapse:collapse; table-layout:fixed; font-size:12px; margin:0 auto; background:#1a1a1a;">';

    // 헤더: 날짜 행
    tableHTML += '<thead><tr style="background:#2c3e50; color:#fff; border-bottom:2px solid #3498db;">';
    tableHTML += `<th style="padding:5px 8px; border:1px solid #333; width:45px; min-width:45px; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:2;">날짜</th>`;

    Object.keys(dateGroups).forEach(date => {
        const mm = date.substring(4, 6);
        const dd = date.substring(6, 8);
        const count = dateGroups[date].length;
        tableHTML += `<th colspan="${count}" style="padding:5px; border:1px solid #333; background:#34495e;">${mm}.${dd}.</th>`;
    });
    tableHTML += '</tr>';

    // 헤더: 시간 행
    tableHTML += '<tr style="background:#34495e; color:#ddd; border-bottom:1px solid #555;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#34495e; z-index:2;">시간</th>';

    const cellStyle = 'width:45px; min-width:45px; max-width:45px; box-sizing:border-box; padding:3px 0; border:1px solid #333; text-align:center;';

    data.forEach((row, index) => {
        const hh = _tmKst(row.tm).hh;  // UTC → KST
        tableHTML += `<td id="time-cell-${index}" data-index="${index}" style="${cellStyle} font-weight:bold;">${hh}시</td>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // [순서] 사용자 요청: 풍속/유의파고 그래프를 표 상단에 먼저 표출.
    //   (consts 는 아래 시정 행에서도 재사용하므로 여기서 한 번만 정의)
    const CHART_OFFSET_LEFT = 0;
    const CHART_WIDTH_ADJUST = -3;
    const cellWidth = 45;
    const chartWidth = (data.length * cellWidth) + CHART_WIDTH_ADJUST;

    tableHTML += '<tr style="background:#222;">';
    tableHTML += `<th style="padding:4px 6px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; vertical-align:middle;">
    <div style="display:flex; flex-direction:column; gap:2px; font-size:9px; align-items:center;">
        <span style="color:#ff7043;">풍속</span>
        <span style="display:inline-block; width:20px; height:3px; background:#ff7043; border-radius:2px;"></span>
        <span style="color:#26c6da; margin-top:4px;">유의</span>
        <span style="color:#26c6da;">파고</span>
        <span style="display:inline-block; width:10px; height:10px; background:rgba(38,198,218,0.6); border:1px solid #26c6da; border-radius:2px;"></span>
        <span style="color:#ffd54f; margin-top:4px;">시정</span>
        <span style="display:inline-block; width:20px; height:0; border-top:2px dashed #ffd54f;"></span>
    </div>
</th>`;
    tableHTML += `<td colspan="${data.length}" style="padding:0; border:1px solid #333; overflow:hidden; box-sizing:border-box;">`;
    tableHTML += `<div style="width:${chartWidth}px; height:140px; margin:0; padding-left:${CHART_OFFSET_LEFT}px; display:block; box-sizing:border-box;"><canvas id="marineChart" width="${chartWidth}" height="140" style="display:block;"></canvas></div>`;
    tableHTML += '</td></tr>';

    // 행: 풍향
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#4fc3f7; font-size:10px;"> 풍향<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-arrow-up" style="transform:rotate(${row.windDir}deg); color:#4fc3f7; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // 행 2: 풍속
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#ff7043; font-size:10px;"> 풍속<br><span style="font-size:9px; font-weight:normal; color:#888;">(m/s)</span></th>';
    data.forEach(row => {
        const color = getMarineWindColor(row.ws);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.ws.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // 행: 유의파고
    tableHTML += '<tr style="background:#1a1a1a; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#26c6da; font-size:10px;"> 유의<br>파고<br><span style="font-size:9px; font-weight:normal; color:#888;">(m)</span></th>';
    data.forEach(row => {
        const color = getMarineWaveColor(row.wh);
        tableHTML += `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${row.wh.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // 행 5: 파향
    tableHTML += '<tr style="background:#1e1e1e; border-bottom:1px solid #333;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#81c784; font-size:10px;"> 파향<br><span style="font-size:9px; font-weight:normal; color:#888;">(deg)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle}"><i class="fas fa-location-arrow" style="transform:rotate(${row.waveDir}deg); color:#81c784; font-size:14px;"></i></td>`;
    });
    tableHTML += '</tr>';

    // 행 6: 파주기
    tableHTML += '<tr style="background:#1a1a1a;">';
    tableHTML += '<th style="padding:4px 8px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; color:#9575cd; font-size:10px;"> 파주기<br><span style="font-size:9px; font-weight:normal; color:#888;">(sec)</span></th>';
    data.forEach(row => {
        tableHTML += `<td style="${cellStyle} color:#ccc; font-size:12px;">${row.wp.toFixed(1)}</td>`;
    });
    tableHTML += '</tr>';

    // 행: 시정 (MMIS 해구별 시정예측, 3시간 간격 공식값)
    //   [표출] 수치는 이 텍스트 행 / 추세는 상단 합본 그래프의 앰버 점선(시정 라인).
    //   [지연] 시정은 별도 fetch — 도착 전까지 스켈레톤, 도착 시 applyMarineVisibility() 가 행+그래프 갱신.
    //   [단위] 행 클릭 시 km ↔ 해리(NM) 토글.
    tableHTML += _marineVisRowHTML(data, !!data._visLoading);

    tableHTML += '</tbody></table></div>';

    // 스크롤 안내 메시지 (가운데 정렬)
    tableHTML += `<div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>`;

    // 발표시각 우측 하단 표시
    if (baseTimeFormatted) {
        tableHTML += `<div style="text-align:right; font-size:11px; color:#8899aa; padding:4px 10px 5px;">${baseTimeFormatted}</div>`;
    }

    body.innerHTML = tableHTML;

    // 차트 그리기 (시정 라인은 vs 가 채워지면 합본으로 함께 그려짐)
    setTimeout(() => renderMarineChart(data), 100);
}

// 풍속 색상
function getMarineWindColor(ws) {
    if (ws >= 14) return '#ff5252';
    if (ws >= 9) return '#ffb74d';
    return '#4fc3f7';
}

// 파고 색상
function getMarineWaveColor(wh) {
    if (wh >= 3.0) return '#ff5252';
    if (wh >= 1.5) return '#ffb74d';
    return '#81c784';
}

// 시정 색상 (km) — 낮을수록 위험(안개). 항해 가시거리 기준.
function getMarineVisibilityColor(vs) {
    if (vs < 1) return '#ff5252';   // 1km 미만: 짙은 안개 (위험)
    if (vs < 3) return '#ffb74d';   // 3km 미만: 안개 (주의)
    return '#81c784';               // 양호
}

// 시정 경고 임계값(해리, NM) — 항해 기준. 이 값 미만이면 그래프에 점·수치·위험색 표출.
const VIS_WARN_NM = 2;

// 합본 그래프 시정 라인/라벨 색 — 나쁠수록 위험색(빨강), 평소엔 앰버. (NM 기준)
//   <1NM 빨강 / <2NM 주황 / 그 외 앰버(점선 기본색)
function _visGraphColor(km) {
    if (km == null) return '#ffd54f';
    const nm = km * VIS_KM_TO_NM;
    if (nm < 1) return '#ff5252';
    if (nm < VIS_WARN_NM) return '#ffb74d';
    return '#ffd54f';
}

// 시정 라벨/점을 그래프에 노출할지 — 2 NM 미만(나쁠 때)만 표시.
function _visLabelVisible(km) {
    if (km == null) return false;
    return (km * VIS_KM_TO_NM) < VIS_WARN_NM;
}

// Chart.js 렌더링
function renderMarineChart(data) {
    const canvas = document.getElementById('marineChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = data.map(d => d.displayTime);
    const windSpeed = data.map(d => d.ws);
    const waveHeight = data.map(d => d.wh);

    if (window.currentMarineChart) {
        window.currentMarineChart.destroy();
    }

    if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    // [New] 커스텀 조정 플러그인 (오프셋 적용만 유지)
    const adjustmentPlugin = {
        id: 'adjustmentPlugin',
        beforeDatasetsDraw(chart) {
            // 오프셋 적용 Logic
            // index.html에 정의된 CHART_OFFSETS 값을 각 데이터 포인트의 X 좌표에 더함
            if (!window.CHART_OFFSETS) window.CHART_OFFSETS = [];

            chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                // bar(1)와 line(0) 모두 적용
                meta.data.forEach((element, index) => {
                    // [Fix] 오프셋 누적 문제 해결: 원래 위치 저장
                    if (typeof element.originalX === 'undefined') {
                        element.originalX = element.x;
                    }

                    const offset = window.CHART_OFFSETS[index] || 0;
                    // 항상 원래 위치 기준으로 오프셋 설정 (누적 방지)
                    element.x = element.originalX + offset;
                });
            });
        }
    };

    window.currentMarineChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '풍속 (m/s)',
                    data: windSpeed,
                    type: 'line',
                    borderColor: '#ff7043',
                    backgroundColor: 'rgba(255, 112, 67, 0.2)',
                    borderWidth: 2,
                    yAxisID: 'y_wind',
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff7043',
                    // [Fix] 호버 시 애니메이션/스타일 변경 제거
                    pointHoverRadius: 4,
                    pointHoverBackgroundColor: '#ff7043',
                    pointHoverBorderColor: '#ff7043',
                    pointHoverBorderWidth: 0,
                    order: 1, // 라인이 위로 오도록
                    datalabels: {
                        display: true,
                        color: '#ff7043',
                        anchor: (context) => context.dataset.data[context.dataIndex] >= 9.0 ? 'start' : 'end',
                        align: (context) => context.dataset.data[context.dataIndex] >= 9.0 ? 'bottom' : 'top',
                        offset: 4,
                        font: { size: 9, weight: 'bold' },
                        formatter: (value) => value.toFixed(1)
                    }
                },
                {
                    label: '유의파고 (m)',
                    data: waveHeight,
                    type: 'bar',
                    backgroundColor: 'rgba(38, 198, 218, 0.6)',
                    borderColor: '#26c6da',
                    borderWidth: 1,
                    // [Fix] 호버 시 애니메이션/스타일 변경 제거
                    hoverBackgroundColor: 'rgba(38, 198, 218, 0.6)',
                    hoverBorderColor: '#26c6da',
                    hoverBorderWidth: 1,
                    yAxisID: 'y_wave',
                    borderRadius: 2,
                    categoryPercentage: 0.8, // 막대 너비 조정
                    barPercentage: 0.9,
                    maxBarThickness: 40,
                    order: 2,
                    datalabels: {
                        display: true,
                        color: '#fff',
                        anchor: 'center',
                        align: 'center',
                        font: { size: 9, weight: 'bold' },
                        formatter: (value) => value.toFixed(1)
                    }
                },
                {
                    // [합본] 시정 라인 — 평소엔 추세만(점선), 시정이 나빠지면(<4) 그 지점만 점·수치·위험색 표시.
                    label: '시정',
                    data: data.map(d => (typeof d.vs === 'number' ? Math.min(d.vs, VIS_CAP_KM) : null)),
                    type: 'line',
                    borderColor: '#ffd54f',
                    backgroundColor: 'rgba(255, 213, 79, 0)',
                    borderWidth: 2,
                    borderDash: [5, 3],
                    yAxisID: 'y_vis',
                    tension: 0.3,
                    spanGaps: true,
                    // 점은 시정이 나쁠 때(<4 표시단위)만 노출 + 위험색
                    pointRadius: (ctx) => (_visLabelVisible(ctx.dataset.data[ctx.dataIndex]) ? 4 : 0),
                    pointHoverRadius: 0,
                    pointBackgroundColor: (ctx) => _visGraphColor(ctx.dataset.data[ctx.dataIndex]),
                    pointBorderColor: (ctx) => _visGraphColor(ctx.dataset.data[ctx.dataIndex]),
                    fill: false,
                    order: 0,
                    // 시정이 떨어지는 구간(둘 중 더 나쁜 값 기준)은 라인을 위험색으로
                    segment: {
                        borderColor: (ctx) => {
                            const worse = Math.min(
                                ctx.p0.parsed.y == null ? 99 : ctx.p0.parsed.y,
                                ctx.p1.parsed.y == null ? 99 : ctx.p1.parsed.y
                            );
                            return _visGraphColor(worse);
                        }
                    },
                    // 수치 라벨은 시정이 나쁠 때(<4 표시단위)만 — 좋을 땐 깔끔하게 숨김
                    datalabels: {
                        display: (ctx) => _visLabelVisible(ctx.dataset.data[ctx.dataIndex]),
                        color: (ctx) => _visGraphColor(ctx.dataset.data[ctx.dataIndex]),
                        anchor: 'center',
                        align: 'top',
                        offset: 6,
                        font: { size: 9, weight: 'bold' },
                        formatter: (km) => {
                            if (km == null) return '';
                            const u = (window._marineVisUnit === 'NM') ? 'NM' : 'km';
                            return ((u === 'NM') ? km * VIS_KM_TO_NM : km).toFixed(1);
                        }
                    }
                }
            ]
        },
        plugins: [ChartDataLabels, adjustmentPlugin],
        options: {
            animation: false,
            hover: { mode: null, animationDuration: 0 },
            responsive: false,
            maintainAspectRatio: false,
            layout: { padding: { left: 0, right: 0, top: 15, bottom: 0 } },
            interaction: {
                mode: 'index',
                intersect: false // 막대 근처만 클릭해도 인식되도록
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: (c) => {
                            if (c.dataset.label === '시정') {
                                const km = c.parsed.y;
                                if (km == null) return '';
                                const u = (window._marineVisUnit === 'NM') ? 'NM' : 'km';
                                const v = (u === 'NM') ? km * VIS_KM_TO_NM : km;
                                return `시정 ${v.toFixed(1)} ${u}${km >= VIS_CAP_KM ? '+' : ''}`;
                            }
                            return `${c.dataset.label}: ${c.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false },
                    offset: true // 중요: 막대가 틱 사이에 오도록
                },
                y_wind: { type: 'linear', display: false, position: 'left', beginAtZero: true },
                y_wave: { type: 'linear', display: false, position: 'right', beginAtZero: true },
                // 시정 전용 축 — 상한(20)보다 위에 여유(26)를 둬서 '맑음(20)' 선이 천장에 붙지 않게.
                y_vis: { type: 'linear', display: false, position: 'right', beginAtZero: true, min: 0, max: 26 }
            }
        }
    });
}

// 시정 단위 변환 상수
const VIS_CAP_KM = 20;            // 표시 상한: 20km 이상은 "맑음" 으로 묶어 캡
const VIS_KM_TO_NM = 0.539957;    // 1km = 0.539957 해리(NM)

// ============================================================
// 시정 표출 — 수치는 텍스트 행, 추세는 상단 합본 그래프의 시정 라인(앰버 점선).
//   20km 캡(20 이상 "20+"). 행 클릭 시 km ↔ 해리(NM) 토글. 도착 전까지 shimmer 스켈레톤.
// ============================================================

// 시정 텍스트 행 HTML. loading=true 면 shimmer 스켈레톤(좌측 안내문).
function _marineVisRowHTML(data, loading) {
    window._marineVisData = data;   // 단위 토글 재렌더용
    const unit = (window._marineVisUnit === 'NM') ? 'NM' : 'km';
    const cellStyle = 'width:45px; min-width:45px; max-width:45px; box-sizing:border-box; padding:3px 0; border:1px solid #333; text-align:center;';

    const th = `<th onclick="window.toggleMarineVisUnit()" style="padding:4px 6px; border:1px solid #333; text-align:center; position:sticky; left:0; background:#2c3e50; z-index:1; vertical-align:middle; cursor:pointer;" title="클릭하면 km ↔ 해리(NM) 단위가 전환됩니다">
        <div style="display:flex; flex-direction:column; gap:1px; font-size:9px; align-items:center;">
            <span style="color:#ffd54f;">시정</span>
            <span id="marine-vis-unit-label" style="color:#888; font-weight:normal;">(${unit})</span>
            <span style="color:#666; font-weight:normal; font-size:8px; line-height:1.1;">클릭:단위</span>
        </div>
    </th>`;

    let cells;
    if (loading) {
        _ensureMarineVisSkeletonStyle();
        // [모바일] 안내문은 맨 왼쪽(시정 라벨 옆)에 — 좁은 화면에서도 로딩 인지.
        cells = `<td colspan="${data.length}" style="padding:0; border:1px solid #333; overflow:hidden;">
            <div style="position:relative; width:100%; height:30px; overflow:hidden;">
                <div class="marine-vis-skeleton"></div>
                <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:flex-start; gap:6px; padding-left:12px; color:#ffd54f; font-size:11px; white-space:nowrap;"><i class="fas fa-spinner fa-spin"></i> 시정 불러오는 중…</div>
            </div>
        </td>`;
    } else if (!data.some(d => typeof d.vs === 'number')) {
        cells = `<td colspan="${data.length}" style="padding:6px 0 6px 12px; border:1px solid #333; text-align:left; color:#777; font-size:11px;">시정 정보 없음</td>`;
    } else {
        cells = data.map(d => {
            if (typeof d.vs !== 'number') return `<td style="${cellStyle} color:#555; font-size:11px;">-</td>`;
            const capped = Math.min(d.vs, VIS_CAP_KM);
            const val = (unit === 'NM') ? capped * VIS_KM_TO_NM : capped;
            const color = getMarineVisibilityColor(d.vs);
            return `<td style="${cellStyle} color:${color}; font-weight:bold; font-size:11px;">${val.toFixed(1)}${d.vs >= VIS_CAP_KM ? '+' : ''}</td>`;
        }).join('');
    }

    return `<tr id="marine-vis-row" style="background:#1e1e1e; border-top:1px solid #333;">${th}${cells}</tr>`;
}

// 시정 도착 시: 텍스트 행 교체 + 합본 그래프(시정 라인) 갱신.
function applyMarineVisibility(data) {
    const row = document.getElementById('marine-vis-row');
    if (row) row.outerHTML = _marineVisRowHTML(data, false);
    renderMarineChart(data);  // vs 채워진 데이터로 재렌더 → 시정 라인 표시
}

// 시정 행 클릭 → km ↔ 해리(NM) 토글 (텍스트 행 + 그래프 라벨 단위 함께 갱신).
window.toggleMarineVisUnit = function () {
    const data = window._marineVisData;
    if (!data || !data.some || !data.some(d => typeof d.vs === 'number')) return;  // 로딩 전/데이터 없음
    window._marineVisUnit = (window._marineVisUnit === 'NM') ? 'km' : 'NM';
    const row = document.getElementById('marine-vis-row');
    if (row) row.outerHTML = _marineVisRowHTML(data, false);
    renderMarineChart(data);  // 그래프 시정 라벨도 단위 반영
};

// 스켈레톤 shimmer 애니메이션 스타일 1회 주입
function _ensureMarineVisSkeletonStyle() {
    if (document.getElementById('marine-vis-skeleton-style')) return;
    const st = document.createElement('style');
    st.id = 'marine-vis-skeleton-style';
    st.textContent = `
@keyframes marineVisShimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
.marine-vis-skeleton { position:absolute; inset:0; background:linear-gradient(90deg, #1e1e1e 0%, #2c2c2c 50%, #1e1e1e 100%); background-size:200px 100%; animation: marineVisShimmer 1.2s infinite linear; }`;
    document.head.appendChild(st);
}

// ----------------------------------------------------------------------------
// [Adjustment Logic] 차트 위치 조정 기능 - 삭제됨 (오프셋 적용만 플러그인에서 처리)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Tab Navigation (메인탭 + 서브탭 2단 구조)
// ----------------------------------------------------------------------------
// [구조]
// 메인탭: 기상정보(그룹) | 조석정보(단독) | 해양생활(그룹) | 공지사항(단독)
// 서브탭(기상정보): 특보 및 전망 | 해상일기도
// 서브탭(해양생활): 바다낚시 | 서핑 | 해수욕 | 스킨스쿠버 | 갯벌체험 | 바다갈라짐
//
// [연계]
// - index.html → .main-tabs .tab-btn, .sub-tabs .sub-tab-btn
// - js/settings.js → 탭 클릭 이벤트 바인딩
// - js/app_init.js → switchMainTab("weather-alert-section") 초기 호출
// - js/admin_trigger.js → switchMainTab('promo-section') 등
// - js/config.js → seaZoneTab.click() 해구기상 전환
// ----------------------------------------------------------------------------

// 그룹 탭 → 기본 서브 섹션 매핑 (그룹 클릭 시 어떤 서브 섹션을 표시할지)
const TAB_GROUP_DEFAULTS = {
    'weather-group': 'weather-alert-section',
    'ocean-life-group': 'fishing-section'
};

// 그룹 탭 → 서브 탭 nav 요소 ID 매핑
const TAB_GROUP_SUBTABS = {
    'weather-group': 'weather-sub-tabs',
    'ocean-life-group': 'ocean-life-sub-tabs'
};

// 섹션 ID → 소속 그룹 역매핑 (섹션 ID로 switchMainTab 호출 시 올바른 그룹 활성화)
const SECTION_TO_GROUP = {
    'weather-alert-section': 'weather-group',
    'sea-zone-section': 'weather-group',
    'marine-chart-section': 'weather-group',  // KMA 날씨누리 해상일기도 (특보정보 그룹)
    'cctv-section': 'weather-group',
    'fishing-section': 'ocean-life-group',
    'surfing-section': 'ocean-life-group',
    'mudflat-section': 'ocean-life-group',
    'swimming-section': 'ocean-life-group',
    'scuba-section': 'ocean-life-group',
    'sea-parting-section': 'ocean-life-group',
    'ripcurrent-section': 'ocean-life-group'
};

/**
 * 메인 탭 전환 함수
 * targetId는 그룹 ID('weather-group') 또는 섹션 ID('sea-zone-section') 모두 가능
 *
 * [호출처]
 * - settings.js → .tab-btn 클릭 이벤트
 * - app_init.js → handleHeaderRefresh()
 * - admin_trigger.js → goToLinkedPromo()
 * - config.js → 해구기상 탭 전환
 *
 * [기존 기능 보호]
 * - dataset.blocked 체크로 차단된 탭 클릭 시 점검 안내 팝업 표시
 *   (index.html applyFeatureBlocks()에서 blocked 속성 설정)
 */
window.switchMainTab = function (targetId) {
    // 차단된 탭인지 확인 (메인탭/서브탭 모두 체크)
    // [연계] index.html applyFeatureBlocks() → dataset.blocked = 'true' 설정
    // [관리자 우회] localStorage 'seagnal_admin_mode'가 'true'이면 차단 무시하고 정상 진입
    //   - 외관(opacity 0.4)은 유지된 채로 탭에 정상 접근 가능
    //   - admin.js _toggleAdminMode()에서 설정됨
    const targetTab = document.querySelector(`.tab-btn[data-target="${targetId}"], .sub-tab-btn[data-target="${targetId}"]`);
    if (targetTab && targetTab.dataset.blocked === 'true') {
        // 관리자 모드이면 차단 무시하고 정상 진행
        if (localStorage.getItem('seagnal_admin_mode') !== 'true') {
            if (typeof showBlockedFeaturePopup === 'function') showBlockedFeaturePopup();
            return;
        }
    }

    const mainTabs = document.querySelectorAll('.main-tabs .tab-btn');
    const subTabNavs = document.querySelectorAll('.sub-tabs');
    const contents = document.querySelectorAll('.tab-content');

    // 모든 메인 탭 비활성화
    mainTabs.forEach(t => t.classList.remove('active'));
    // 모든 콘텐츠 숨기기
    contents.forEach(c => c.classList.remove('active'));
    // 모든 서브 탭 nav 숨기기
    subTabNavs.forEach(nav => nav.classList.remove('sub-tabs-visible'));

    // 경우 1: targetId가 그룹 ID인 경우 (예: 'weather-group')
    // → 해당 그룹의 기본 서브 섹션을 표시
    if (TAB_GROUP_DEFAULTS[targetId]) {
        const groupId = targetId;
        const defaultSection = TAB_GROUP_DEFAULTS[groupId];

        // 메인 탭 활성화
        const mainTab = document.querySelector(`.main-tabs .tab-btn[data-target="${groupId}"]`);
        if (mainTab) mainTab.classList.add('active');

        // 서브 탭 nav 표시
        const subTabNavId = TAB_GROUP_SUBTABS[groupId];
        const subTabNav = document.getElementById(subTabNavId);
        if (subTabNav) {
            subTabNav.classList.add('sub-tabs-visible');
            // 이전에 선택했던 서브 탭이 있으면 그것을 표시, 없으면 기본 서브 섹션
            const activeSubBtn = subTabNav.querySelector('.sub-tab-btn.active');
            const sectionToShow = activeSubBtn ? activeSubBtn.getAttribute('data-target') : defaultSection;
            const section = document.getElementById(sectionToShow);
            if (section) section.classList.add('active');
            _onSectionActivated(sectionToShow);
        } else {
            _onSectionActivated(defaultSection);
        }
        return;
    }

    // 경우 2: targetId가 섹션 ID인 경우 (예: 'sea-zone-section')
    // → 역매핑으로 소속 그룹을 찾아서 그룹 탭 + 서브 탭 함께 활성화
    const groupId = SECTION_TO_GROUP[targetId];
    if (groupId) {
        // 메인 탭 활성화
        const mainTab = document.querySelector(`.main-tabs .tab-btn[data-target="${groupId}"]`);
        if (mainTab) mainTab.classList.add('active');

        // 서브 탭 nav 표시 + 해당 서브 탭 활성화
        const subTabNavId = TAB_GROUP_SUBTABS[groupId];
        const subTabNav = document.getElementById(subTabNavId);
        if (subTabNav) {
            subTabNav.classList.add('sub-tabs-visible');
            subTabNav.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            const subBtn = subTabNav.querySelector(`.sub-tab-btn[data-target="${targetId}"]`);
            if (subBtn) subBtn.classList.add('active');
        }

        // 섹션 표시
        const section = document.getElementById(targetId);
        if (section) section.classList.add('active');

        _onSectionActivated(targetId);
        return;
    }

    // 경우 3: 서브 탭이 없는 독립 메인 탭 (조석정보, 공지사항, 종합기상)
    // ocean-map-section 전용 탭이 있으면 그것을 활성화, 없으면 조석정보 탭 하이라이트
    let actualTabTarget = targetId;
    if (targetId === 'ocean-map-section') {
        const directTab = document.querySelector('.main-tabs .tab-btn[data-target="ocean-map-section"]');
        actualTabTarget = directTab ? 'ocean-map-section' : 'tide-section';
    }
    const mainTab = document.querySelector(`.main-tabs .tab-btn[data-target="${actualTabTarget}"]`);
    if (mainTab) mainTab.classList.add('active');

    const section = document.getElementById(targetId);
    if (section) section.classList.add('active');

    _onSectionActivated(targetId);
};

/**
 * 서브 탭 전환 전용 함수
 * 같은 그룹 내에서 서브 탭만 전환 (메인 탭 상태는 유지)
 *
 * [호출처] js/settings.js → .sub-tab-btn 클릭 이벤트
 *
 * [기존 기능 보호]
 * - dataset.blocked 체크로 차단된 서브탭 클릭 시 점검 안내 팝업 표시
 */
window.switchSubTab = function (targetId) {
    // 차단된 서브탭인지 확인
    // [연계] index.html applyFeatureBlocks() → dataset.blocked = 'true' 설정
    // [관리자 우회] localStorage 'seagnal_admin_mode'가 'true'이면 차단 무시
    const targetBtn = document.querySelector(`.sub-tab-btn[data-target="${targetId}"]`);
    if (targetBtn && targetBtn.dataset.blocked === 'true') {
        // 관리자 모드이면 차단 무시하고 정상 진행
        if (localStorage.getItem('seagnal_admin_mode') !== 'true') {
            if (typeof showBlockedFeaturePopup === 'function') showBlockedFeaturePopup();
            return;
        }
    }

    const groupId = SECTION_TO_GROUP[targetId];
    if (!groupId) return;

    const subTabNavId = TAB_GROUP_SUBTABS[groupId];
    const subTabNav = document.getElementById(subTabNavId);
    if (!subTabNav) return;

    // 같은 그룹 내 모든 섹션 숨기기 + 서브 탭 비활성화
    subTabNav.querySelectorAll('.sub-tab-btn').forEach(btn => {
        const secId = btn.getAttribute('data-target');
        const sec = document.getElementById(secId);
        if (sec) sec.classList.remove('active');
        btn.classList.remove('active');
    });

    // 선택된 서브 탭 활성화
    const subBtn = subTabNav.querySelector(`.sub-tab-btn[data-target="${targetId}"]`);
    if (subBtn) subBtn.classList.add('active');

    const section = document.getElementById(targetId);
    if (section) section.classList.add('active');

    _onSectionActivated(targetId);
};

/**
 * 섹션 활성화 후 특수 처리 (지도 초기화, 데이터 로드 등)
 * switchMainTab()과 switchSubTab()에서 공통으로 호출
 *
 * [연계]
 * - sea-zone-section → seaZones.js initSeaZoneMap()
 * - fishing-section → fishing.js initFishingMap()
 * - promo-section → promo.js loadPromoPosts()
 */
/* ============================================================================
 * 해양종합정보(히든탭) 전용 진입/퇴장 함수
 * ----------------------------------------------------------------------------
 *
 * [왜 별도 함수가 필요한가?]
 *  switchMainTab() 은 모든 메인탭과 서브탭의 active 상태를 한 번에 정리한 뒤
 *  목표 섹션만 활성화하도록 설계되어 있다. 이 동작은 일반 탭 전환에는 옳지만,
 *  해양종합정보 히든탭의 경우 사용자가 보고 있던 메인탭/서브탭을 그대로 두고
 *  헤더만 숨긴 채 위에 지도 화면을 띄우는 게 요구사항이다.
 *
 * [enterOceanMapSection 동작]
 *  1) 현재 .active 인 다른 모든 섹션(예: tide-section)의 .active 를 제거하고
 *     그 ID 들을 _oceanPrevActiveSections 에 기억해 둔다.
 *     → 해양종합정보를 "독립 화면" 으로 만들기 위함 (조석정보가 배경에 비치지 않게)
 *  2) #ocean-map-section 에 .active 추가
 *  3) history 스택에 섹션 dummy state 1개 push
 *     → 휴대폰 뒤로가기 2단계(시트→섹션→앱종료) 동작을 위해 필요
 *  4) CSS 변수 --ocean-top-offset 에 (서브탭/메인탭) bottom Y 주입
 *     → 화면 위쪽 탭바 영역만큼 비워 두고 그 아래부터 풀스크린
 *  5) _onSectionActivated('ocean-map-section') 호출
 *     → .main-header 숨김 + 200ms 후 initOceanMap()
 *
 * [exitOceanMapSection 동작]
 *  fromPopstate 인자:
 *    false (기본) — 사용자가 ← 버튼을 직접 클릭한 경우. 우리가 history.back() 호출 필요.
 *    true         — popstate 핸들러가 호출한 경우. 브라우저가 이미 pop 했으므로 back() 금지.
 *
 *  1) #ocean-map-section 의 .active 제거
 *  2) CSS 변수 정리
 *  3) _oceanPrevActiveSections 에 저장된 직전 섹션들의 .active 를 복원
 *  4) _onSectionActivated(복원한 섹션) 호출 → .main-header 복원 등
 *  5) 섹션 dummy 정리
 *     - fromPopstate=false 면 suppress 플래그 set 후 history.back() 호출
 *       (back() 의 결과 popstate 가 발화되지만 suppress 로 1회 무시)
 *     - fromPopstate=true 면 dummy 플래그만 false 로
 *
 * [연계]
 *  - 호출처(진입): js/settings.js (조석정보 10회 탭)
 *  - 호출처(퇴장): js/ocean_map.js 의 ocean-back-btn 핸들러
 *  - 사용 CSS  : style.css #ocean-map-section.active { top: var(--ocean-top-offset, 0); }
 * ========================================================================== */
/* ----------------------------------------------------------------------------
 * 해양종합정보(히든탭) 전역 상태
 * ----------------------------------------------------------------------------
 * _oceanPrevActiveSections
 *   진입 직전에 .active 였던 다른 섹션들의 ID 목록. 해양종합정보는 "독립 화면"
 *   이어야 하므로 진입 시 다른 섹션의 .active 를 모두 떼서 배경에 비치지 않게
 *   하고, 그 ID 들을 여기 저장해 뒀다가 퇴장 시 그대로 복원한다.
 *
 * [뒤로가기 처리 — backbutton.js 의 PopupStack 위에 얹힘]
 *  본 파일은 더 이상 직접 history.pushState/popstate 를 다루지 않는다.
 *  그 대신 backbutton.js 가 운영하는 전역 PopupStack 에 다음 두 항목을 등록한다:
 *    - 'ocean-map-section'  : 섹션 자체 (← 또는 시스템 뒤로가기로 닫기)
 *    - 'ocean-bottom-sheet'  : 시트 (ocean_bottom_sheet1.js 에서 등록)
 *  PopupStack 은 LIFO 이므로 시스템 뒤로가기 시 시트 → 섹션 → 앱 종료 토스트
 *  순으로 자연스럽게 처리된다.
 * -------------------------------------------------------------------------- */
window._oceanPrevActiveSections = [];

window.enterOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;

    // 1) 직전에 활성화돼 있던 섹션들의 .active 를 제거하고 ID 를 기억한다.
    window._oceanPrevActiveSections = [];
    var prevs = document.querySelectorAll('.tab-content.active');
    for (var p = 0; p < prevs.length; p++) {
        if (prevs[p].id && prevs[p].id !== 'ocean-map-section') {
            window._oceanPrevActiveSections.push(prevs[p].id);
            prevs[p].classList.remove('active');
        }
    }
    section.classList.add('active');
    document.body.classList.add('ocean-map-active');

    // 2) 뒤로가기 시 backbutton.js 가 우리를 닫을 수 있도록 PopupStack 등록
    if (window.PopupStack) {
        window.PopupStack.push('ocean-map-section', function () {
            window.exitOceanMapSection();
        });
    }

    // 3) 헤더 처리(SEAGNAL 로고 영역만 숨김) + 지도 init
    _onSectionActivated('ocean-map-section');

    // 4) CSS 변수: 탭바(메인탭+서브탭)가 차지하는 화면 위쪽 offset 주입
    //    로고 숨김 후 레이아웃이 반영되도록 rAF 다음 프레임에 계산.
    requestAnimationFrame(function () {
        var subVisible = document.querySelector('.sub-tabs.sub-tabs-visible');
        var refEl = subVisible || document.querySelector('.main-tabs');
        if (refEl) {
            var rect = refEl.getBoundingClientRect();
            document.documentElement.style.setProperty('--ocean-top-offset', rect.bottom + 'px');
        } else {
            document.documentElement.style.setProperty('--ocean-top-offset', '0px');
        }
        if (window.getOceanMap) {
            var m = window.getOceanMap();
            if (m && m.updateSize) m.updateSize();
        }
    });
};

window.exitOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    section.classList.remove('active');
    document.body.classList.remove('ocean-map-active');

    // CSS 변수 초기화
    document.documentElement.style.removeProperty('--ocean-top-offset');

    // 진입 시 숨겨 둔 직전 active 섹션들을 복원
    var fallbackId = null;
    if (window._oceanPrevActiveSections && window._oceanPrevActiveSections.length) {
        for (var i = 0; i < window._oceanPrevActiveSections.length; i++) {
            var el = document.getElementById(window._oceanPrevActiveSections[i]);
            if (el) el.classList.add('active');
            if (!fallbackId) fallbackId = window._oceanPrevActiveSections[i];
        }
        window._oceanPrevActiveSections = [];
    }
    _onSectionActivated(fallbackId || '');

    // PopupStack 에서 우리 항목 제거 (popLast 가 부른 경우엔 이미 pop 되었지만 안전)
    if (window.PopupStack) {
        window.PopupStack.remove('ocean-map-section');
    }
};

/**
 * 메인 섹션(해양종합정보/특보정보/해양생활/공지사항 등) 활성화 hook.
 * switchMainTab 의 후처리 — 진입/퇴장 시 로고/탭바 등 부가 UI 동기.
 *
 * [연계] body 의 ocean-map-active 클래스 + style.css !important 규칙이
 *  실질적인 표시 제어. 이 함수는 그 외 보조 처리(예: 차트 init) 만 담당.
 *
 * @param {string} sectionId - 활성된 섹션의 DOM id
 */
function _onSectionActivated(sectionId) {
    // 해양종합정보 진입/퇴장 시 SEAGNAL 로고 영역 숨김/표시는
    // body.ocean-map-active 클래스 + style.css 의 !important 규칙이 담당한다.
    // (다른 코드 경로 — switchMainTab 등이 inline display 를 건드려도 항상 숨김 유지)

    // 해양종합정보에서 벗어날 때 오버레이 애니메이션 정리 (RAF 누수 방지)
    if (sectionId !== 'ocean-map-section' && window.oceanOverlayClear) {
        window.oceanOverlayClear();
    }

    // 해구별 기상 탭 활성화 시 지도 초기화
    if (sectionId === 'sea-zone-section') {
        setTimeout(() => {
            if (window.initSeaZoneMap) {
                window.initSeaZoneMap();
            }
        }, 200);
    }
// 바다낚시 탭 활성화 시 지도 초기화 (탭 전환 후 사이즈 갱신)
    if (sectionId === 'fishing-section') {
        // [사용량] 바다낚시 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.fishing.tab');
        setTimeout(() => {
            if (window.initFishingMap) {
                window.initFishingMap();
            }
        }, 200);
    }
    // 서핑지수 탭 활성화 시 지도 초기화
    // surfing1.js의 initSurfingMap()을 호출합니다.
    // 200ms 지연: 탭 전환 CSS transition이 완료된 뒤 OL 지도 크기를 정확히 계산하기 위함
    if (sectionId === 'surfing-section') {
        // [사용량] 서핑 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.surfing.tab');
        setTimeout(() => {
            if (window.initSurfingMap) {
                window.initSurfingMap();
            }
        }, 200);
    }
    // 바다갈라짐 탭 활성화 시 데이터 로드
    if (sectionId === 'sea-parting-section') {
        // [사용량] 바다갈라짐 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.parting.tab');
        setTimeout(() => {
            if (window.initSeaParting) {
                window.initSeaParting();
            }
        }, 200);
    }
    // 갯벌체험 탭 활성화 시 데이터 로드
    if (sectionId === 'mudflat-section') {
        // [사용량] 갯벌체험 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.mudflat.tab');
        setTimeout(() => {
            if (window.initMudflat) {
                window.initMudflat();
            }
        }, 200);
    }
    // 스킨스쿠버 탭 활성화 시 지도 초기화 (바다낚시와 동일한 지도형)
    if (sectionId === 'scuba-section') {
        // [사용량] 스킨스쿠버 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.scuba.tab');
        setTimeout(() => {
            if (window.initScubaMap) {
                window.initScubaMap();
            }
        }, 200);
    }
    // 이안류 탭 활성화 시 지도 초기화 (스킨스쿠버와 동일한 지도형)
    if (sectionId === 'ripcurrent-section') {
        // [사용량] 이안류 하위 탭 진입
        if (window.trackUsage) window.trackUsage('life.ripcurrent.tab');
        setTimeout(() => {
            if (window.initRipCurrent) {
                window.initRipCurrent();
            }
        }, 200);
    }
    // 공지사항 탭 활성화 시 게시글 로드
    if (sectionId === 'promo-section') {
        if (typeof loadPromoPosts === 'function') setTimeout(loadPromoPosts, 100);
    }
    // 해양종합정보 탭 활성화 시 지도 초기화
    if (sectionId === 'ocean-map-section') {
        setTimeout(() => {
            if (window.initOceanMap) {
                window.initOceanMap();
            }
        }, 200);
    }
    // 해상일기도 탭 활성화 시 — KMA 날씨누리 GIF 차트 모듈 초기화
    // [연계] js/marine_chart1.js ~ marine_chart5.js
    // [동작] 첫 진입: 즐겨찾기 적용 → 변수 옵션 채움 → fetchList → 첫 GIF 로드
    //        재진입: 이벤트 재바인딩 없이 기존 state 유지 (자동재생 끊김 없음)
    if (sectionId === 'marine-chart-section') {
        setTimeout(() => {
            if (window.MarineChart && typeof window.MarineChart.init === 'function') {
                window.MarineChart.init();
            }
        }, 100);
    }
    // 해상일기도 외 다른 섹션으로 이동 시 자동재생 중지
    // [이유] play() 가 setInterval 로 GIF src 를 계속 갱신하므로, 화면에 안
    //        보이는 상태에서도 KMA 에 네트워크 요청이 누적됨.
    //        _onSectionActivated 는 모든 탭 전환 경로(switchMainTab/switchSubTab)
    //        에서 공통 호출되므로 여기 한 곳에서 정리.
    else if (window.MarineChart && typeof window.MarineChart.pause === 'function') {
        window.MarineChart.pause();
    }
}

