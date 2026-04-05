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

    try {
        // 로컬 서버에서 데이터 가져오기
        const response = await fetch('/api/marine-zone-forecasts');
        if (!response.ok) throw new Error('로컬 서버 응답 오류');

        const json = await response.json();

        // 요청이 취소되었는지 확인
        if (requestId !== window._marineZoneRequestId) return;

        // 데이터 찾기
        const zoneData = json.data && json.data[lZone];

        if (zoneData && zoneData.length > 0) {
            // displayTime 추가
            const formattedData = zoneData.map(item => ({
                ...item,
                displayTime: formatMarineTime(item.tm)
            }));
            formattedData.baseTime = json.baseTmUtf;

            showMarineZoneModal(zoneId, formattedData, false, null, json.baseTmUtf);
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

// 시간 포맷팅 (YYYYMMDDHH -> MM.DD HH시)
function formatMarineTime(tm) {
    if (!tm || tm.length < 10) return tm;
    const mm = tm.substring(4, 6);
    const dd = tm.substring(6, 8);
    const hh = tm.substring(8, 10);
    return `${mm}.${dd} ${hh}시`;
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
            const y = bt.substring(0, 4);
            const m = bt.substring(4, 6);
            const d = bt.substring(6, 8);
            const h = bt.substring(8, 10);
            baseTimeFormatted = `${y}.${m}.${d} ${h}:00 발표`;
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

    // 날짜별 그룹화
    const dateGroups = {};
    data.forEach(row => {
        const date = row.tm.substring(0, 8);
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
        const hh = row.tm.substring(8, 10);
        tableHTML += `<td id="time-cell-${index}" data-index="${index}" style="${cellStyle} font-weight:bold;">${hh}시</td>`;
    });
    tableHTML += '</tr></thead><tbody>';

    // 행 1: 풍향
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

    // 행 3: 그래프
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
    </div>
</th>`;
    tableHTML += `<td colspan="${data.length}" style="padding:0; border:1px solid #333; overflow:hidden; box-sizing:border-box;">`;
    tableHTML += `<div style="width:${chartWidth}px; height:140px; margin:0; padding-left:${CHART_OFFSET_LEFT}px; display:block; box-sizing:border-box;"><canvas id="marineChart" width="${chartWidth}" height="140" style="display:block;"></canvas></div>`;
    tableHTML += '</td></tr>';

    // 행 4: 유의파고
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

    tableHTML += '</tbody></table></div>';

    // 스크롤 안내 메시지 (가운데 정렬)
    tableHTML += `<div style="text-align:center; font-size:0.95rem; color:#ffffff; padding:10px 0 4px; font-weight:500;">☜ 밀어서 더 많은 정보를 확인하세요 ☞</div>`;

    // 발표시각 우측 하단 표시
    if (baseTimeFormatted) {
        tableHTML += `<div style="text-align:right; font-size:11px; color:#8899aa; padding:4px 10px 5px;">${baseTimeFormatted}</div>`;
    }

    body.innerHTML = tableHTML;

    // 차트 그리기
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
                tooltip: { enabled: true }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false },
                    offset: true // 중요: 막대가 틱 사이에 오도록
                },
                y_wind: { type: 'linear', display: false, position: 'left', beginAtZero: true },
                y_wave: { type: 'linear', display: false, position: 'right', beginAtZero: true }
            }
        }
    });
}

// ----------------------------------------------------------------------------
// [Adjustment Logic] 차트 위치 조정 기능 - 삭제됨 (오프셋 적용만 플러그인에서 처리)
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Tab Navigation (메인탭 + 서브탭 2단 구조)
// ----------------------------------------------------------------------------
// [구조]
// 메인탭: 기상정보(그룹) | 조석정보(단독) | 해양생활(그룹) | 공지사항(단독)
// 서브탭(기상정보): 특보 및 전망 | 해구기상 | 태풍정보
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
'typhoon-section': 'weather-group',
    'cctv-section': 'weather-group',
    'fishing-section': 'ocean-life-group',
    'surfing-section': 'ocean-life-group',
    'mudflat-section': 'ocean-life-group',
    'swimming-section': 'ocean-life-group',
    'scuba-section': 'ocean-life-group',
    'sea-parting-section': 'ocean-life-group'
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

    // 경우 3: 서브 탭이 없는 독립 메인 탭 (조석정보, 공지사항)
    // 히든 탭(ocean-map-section)은 조석정보에서 진입하므로 조석정보 탭 하이라이트 유지
    const actualTabTarget = (targetId === 'ocean-map-section') ? 'tide-section' : targetId;
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
function _onSectionActivated(sectionId) {
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
        setTimeout(() => {
            if (window.initSurfingMap) {
                window.initSurfingMap();
            }
        }, 200);
    }
    // 바다갈라짐 탭 활성화 시 데이터 로드
    if (sectionId === 'sea-parting-section') {
        setTimeout(() => {
            if (window.initSeaParting) {
                window.initSeaParting();
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
}

