/**
 * ============================================================================
 * 파일명: js/render_coastal.js
 * 역할: 연안 구역 렌더링, 부이 데이터 표시, 로딩/시간 업데이트
 * ============================================================================
 *
 * [설명]
 * - displayBuoyInfo(): 부이 관측 데이터 표시 (풍속, 기온, 파고)
 * - createCoastalElement(): 연안바다/평수구역 하위 특보 카드 생성
 * - createDataBox(): 데이터 표시 박스 유틸
 * - updateLoading(), updateTimeDisplay(): UI 상태 업데이트
 *
 * [로딩 순서] 6번째 (render.js 이후)
 * ============================================================================
 */

function displayBuoyInfo(buoy, container) {
    container.innerHTML = '';

    // 디버그: 부이 ID와 데이터 유무 확인
    // console.log('🔍 부이 조회:', buoy.id, buoy.name, '| 데이터 존재:', !!appState.buoyData[buoy.id]);

    const buoyData = appState.buoyData[buoy.id];
    const typeInfo = BUOY_TYPES[buoy.type] || { name: '부이', icon: '📍' };

    // 헤더
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '12px';
    header.style.paddingBottom = '8px';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';

    const nameSpan = document.createElement('span');
    nameSpan.style.fontWeight = '600';
    nameSpan.style.fontSize = '0.95rem';
    nameSpan.style.color = '#e6edf3';
    nameSpan.style.display = 'flex';
    nameSpan.style.alignItems = 'center';
    nameSpan.style.gap = '6px';
    nameSpan.innerHTML = `${buoy.name} <span style="font-size:0.75rem;color:#8b949e">(${typeInfo.name})</span>`;

    // 위치 보기 버튼
    const locationBtn = document.createElement('button');
    locationBtn.innerHTML = '📍';
    locationBtn.title = '지도에서 위치 보기';
    locationBtn.style.cssText = `
        background: rgba(79, 195, 247, 0.2);
        border: 1px solid #4fc3f7;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        cursor: pointer;
        font-size: 0.8rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    `;
    locationBtn.onmouseenter = () => {
        locationBtn.style.background = 'rgba(79, 195, 247, 0.4)';
        locationBtn.style.transform = 'scale(1.1)';
    };
    locationBtn.onmouseleave = () => {
        locationBtn.style.background = 'rgba(79, 195, 247, 0.2)';
        locationBtn.style.transform = 'scale(1)';
    };
    locationBtn.onclick = (e) => {
        e.stopPropagation();
        showBuoyLocationOnMap(buoy.id);
    };
    nameSpan.appendChild(locationBtn);

    header.appendChild(nameSpan);
    container.appendChild(header);

    if (!buoyData) {
        const noData = document.createElement('div');
        noData.style.textAlign = 'center';
        noData.style.padding = '16px 10px';
        noData.style.color = '#ff9800';
        noData.style.backgroundColor = 'rgba(255, 152, 0, 0.1)';
        noData.style.borderRadius = '6px';
        noData.style.fontSize = '0.9rem';
        noData.innerHTML = '⚠️ 해당 부이에서는 기상정보가 관측되지 않았습니다.';
        container.appendChild(noData);
        return;
    }

    // 주요 데이터 (파고, 풍속, 수온)
    const mainData = document.createElement('div');
    mainData.style.display = 'flex';
    mainData.style.gap = '20px';
    mainData.style.marginBottom = '12px';
    mainData.style.flexWrap = 'wrap';

    if (buoyData.waveHeight !== null) {
        const waveBox = createDataBox('🌊 파고', buoyData.waveHeight, 'm', '#4fc3f7');
        mainData.appendChild(waveBox);
    }

    if (buoyData.windSpeed !== null) {
        const windDir = buoyData.windDirection !== null ? getWindDirectionText(buoyData.windDirection) : '';
        const windBox = createDataBox('💨 풍속', buoyData.windSpeed, `m/s ${windDir}`, '#81c784');
        mainData.appendChild(windBox);
    }

    if (buoyData.waterTemp !== null) {
        const tempBox = createDataBox('🌡️ 수온', buoyData.waterTemp, '°C', '#ffb74d');
        mainData.appendChild(tempBox);
    }

    container.appendChild(mainData);

    // 상세 데이터
    let detailHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px">';

    if (buoyData.windGust !== null) {
        detailHTML += `<div><span style="color:#8b949e">돌풍</span> <span style="color:#fff">${buoyData.windGust} m/s</span></div>`;
    }
    if (buoyData.airTemp !== null) {
        detailHTML += `<div><span style="color:#8b949e">기온</span> <span style="color:#fff">${buoyData.airTemp}°C</span></div>`;
    }
    if (buoyData.pressure !== null) {
        detailHTML += `<div><span style="color:#8b949e">기압</span> <span style="color:#fff">${buoyData.pressure} hPa</span></div>`;
    }
    if (buoyData.humidity !== null) {
        detailHTML += `<div><span style="color:#8b949e">습도</span> <span style="color:#fff">${buoyData.humidity}%</span></div>`;
    }
    if (buoyData.tm) {
        detailHTML += `<div style="grid-column:1/-1;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.1)"><span style="color:#8b949e">관측시간</span> <span style="color:#fff">${formatBuoyTime(buoyData.tm)}</span></div>`;
    }

    detailHTML += '</div>';

    const detailContainer = document.createElement('div');
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
    detailContainer.innerHTML = detailHTML;
    container.appendChild(detailContainer);
}

// 연안바다 이미지 매핑
const COASTAL_ZONES_IMAGES = {
    "제주도북부앞바다": { "연안바다": "북부앞바다(연안바다).png" },
    "제주도남부앞바다": { "연안바다": "남부앞바다(연안바다).png" },
    "제주도동부앞바다": {
        "북동연안바다": "동부앞바다(북동연안바다).png",
        "남동연안바다": "동부앞바다(남동연안바다).png"
    },
    "제주도서부앞바다": {
        "북서연안바다": "서부앞바다(북서연안바다).png",
        "남서연안바다": "서부앞바다(남서연안바다).png"
    }
};

// 이미지 모달 표시 함수
function showImageModal(imageName, title) {
    // 기존 모달 제거
    const existing = document.getElementById('image-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'image-modal-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(5px);
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        position: relative; max-width: 95%; max-height: 90%;
        background: #222; border-radius: 8px; overflow: hidden;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #444;
        display: flex; flex-direction: column;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
        padding: 12px 16px; background: #333; color: #fff; font-weight: bold;
        display: flex; justify-content: space-between; align-items: center;
        border-bottom: 1px solid #444; font-size: 1rem;
    `;
    header.innerHTML = `<span>🗺️ ${title}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        background: none; border: none; color: #aaa; font-size: 1.2rem; cursor: pointer;
    `;
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);

    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'padding: 0; overflow: auto; display: flex; align-items: center; justify-content: center; background: #000;';

    const img = document.createElement('img');
    img.src = `연안바다_이미지/${imageName}`;
    img.style.cssText = 'max-width: 100%; max-height: 80vh; display: block;';
    img.onerror = () => { img.alt = '이미지를 불러올 수 없습니다.'; img.src = ''; img.style.color = '#fff'; img.style.padding = '20px'; };

    imgContainer.appendChild(img);
    content.appendChild(header);
    content.appendChild(imgContainer);
    overlay.appendChild(content);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

// 데이터 박스 생성 헬퍼
function createDataBox(label, value, unit, color) {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '2px';

    const labelSpan = document.createElement('span');
    labelSpan.style.fontSize = '0.7rem';
    labelSpan.style.color = '#8b949e';
    labelSpan.textContent = label;

    const valueSpan = document.createElement('span');
    valueSpan.style.fontSize = '1.1rem';
    valueSpan.style.fontWeight = '700';
    valueSpan.style.color = color;
    valueSpan.innerHTML = `${value} <span style="font-size:0.75rem;font-weight:400;color:#8b949e">${unit}</span>`;

    box.appendChild(labelSpan);
    box.appendChild(valueSpan);

    return box;
}

// 부이 관측시간 포맷
function formatBuoyTime(tm) {
    if (!tm || tm.length < 12) return '-';
    const month = tm.substring(4, 6);
    const day = tm.substring(6, 8);
    const hour = tm.substring(8, 10);
    const minute = tm.substring(10, 12);
    return `${month}/${day} ${hour}:${minute}`;
}

// 연안바다/평수구역 요소 생성
function createCoastalElement(coastal, alertData, parentZoneName) {
    const item = document.createElement('div');
    item.className = 'coastal-item';
    item.style.padding = '8px 12px';
    item.style.marginBottom = '4px';
    item.style.borderRadius = '6px';
    item.style.backgroundColor = 'rgba(255,255,255,0.05)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = coastal.name;
    nameSpan.style.fontSize = '0.9rem';
    nameSpan.style.fontWeight = '600'; // 좀 더 굵게
    header.appendChild(nameSpan);

    // [New] 지도 아이콘 버튼 추가 (가파도/우도 제외)
    // coastal.name 예: "북서연안바다", "연안바다" 등
    // parentZoneName 예: "제주도서부앞바다"
    if (parentZoneName && COASTAL_ZONES_IMAGES[parentZoneName]) {
        // 정확한 매칭을 위해 coastal.name 사용.
        // 예: 제주도서부앞바다 -> 북서연안바다

        let imageName = null;
        // coastal.name이 정확히 키와 일치하는지 확인
        if (COASTAL_ZONES_IMAGES[parentZoneName][coastal.name]) {
            imageName = COASTAL_ZONES_IMAGES[parentZoneName][coastal.name];
        }
        // 예외: "연안바다"라는 이름이 중복되므로 parentZoneName으로 구분된 데이터에서 찾음.
        // 데이터 구조상 parentZoneName 키 아래에 "연안바다" 키가 있으면 매칭됨.

        if (imageName) {
            const mapBtn = document.createElement('button');
            mapBtn.innerHTML = '🗺️'; // 지도 아이콘
            mapBtn.title = '구역 지도 보기';
            mapBtn.style.cssText = `
                background: none; border: 1px solid #555; border-radius: 4px;
                color: #ccc; cursor: pointer; margin-left: 8px; padding: 2px 6px;
                font-size: 0.8rem; vertical-align: middle; transition: background 0.2s;
            `;
            mapBtn.onmouseover = () => mapBtn.style.background = 'rgba(255,255,255,0.1)';
            mapBtn.onmouseout = () => mapBtn.style.background = 'none';
            mapBtn.onclick = (e) => {
                e.stopPropagation(); // 카드 확장 방지
                showImageModal(imageName, `${parentZoneName} ${coastal.name}`);
            };

            // 이름 옆에 추가 (badge 앞)
            // header flex 순서: Name - (Map) - Badge
            // 현재 구조: nameSpan - badge
            // insertBefore badge if exists, else append

            // Re-ordering logic:
            // Just append to header, but we want it Next to Name.
            // Let's make a left-side container.

            // Override header structure for layout
            header.innerHTML = ''; // Clear and rebuild

            const leftGroup = document.createElement('div');
            leftGroup.style.display = 'flex';
            leftGroup.style.alignItems = 'center';
            leftGroup.style.gap = '6px';

            leftGroup.appendChild(nameSpan);
            leftGroup.appendChild(mapBtn);

            header.appendChild(leftGroup);
        }
    }

    // 만약 지도가 없어서 mapBtn을 안 만들었다면 name만 있어도 rebuild 필요할 수 있음
    // 혹은 위 if문 밖에서 로직 처리.
    // 기존 로직 유지를 위해:
    if (header.children.length === 0) {
        // Re-append name only
        header.appendChild(nameSpan);
    }

    if (alertData && alertData.length > 0) {
        // 특보가 있는 경우 (배열 처리)
        const badgeContainer = document.createElement('div');
        badgeContainer.style.display = 'flex';
        badgeContainer.style.gap = '4px';
        badgeContainer.style.flexWrap = 'wrap';
        badgeContainer.style.justifyContent = 'flex-end';

        // 정렬 적용 (태풍 우선)
        const sortedAlerts = sortAlertItems(alertData);

        const now = getKfTime();

        // [문제4 해결] 장부에서 실제 발효 중인 특보 정보 확인
        let activeAlertFromLedger = null;
        let pendingAlert = null;

        sortedAlerts.forEach(alert => {
            const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
            const isAwaiting = cleanEf && cleanEf.length >= 12 && now < cleanEf;

            if (alert.isPreliminary || isAwaiting) {
                // 예비/대기 상태
                pendingAlert = alert;
            } else {
                // 발효 중 상태
                activeAlertFromLedger = alert;
            }
        });

        // [A안 적용] 발효 중인 특보 없고 예비만 있으면, 히스토리에서 찾지 않음
        // activeAlert가 null이면 발효 중인 특보 없음
        // 더 이상 히스토리에서 이전 발효 특보를 찾지 않음

        // 1. [A안 적용] 발효 중인 특보가 있으면 그것만 표시
        if (activeAlertFromLedger && !activeAlertFromLedger.isPreliminary) {
            const badge = document.createElement('span');
            badge.className = 'status-badge warning';
            badge.style.fontSize = '0.7rem';
            badge.style.padding = '1px 6px';
            badge.textContent = `${activeAlertFromLedger.warnType} ${activeAlertFromLedger.level}`;
            badgeContainer.appendChild(badge);
        }
        // 2. 발효 중인 특보가 없으면 예비/대기만 표시
        else if (pendingAlert) {
            const badge = document.createElement('span');
            badge.className = 'status-badge preliminary';
            badge.style.fontSize = '0.7rem';
            badge.style.padding = '1px 6px';
            // [수정] level이 '예비'이면 ' 예비' 중복 방지
            const cleanType = (pendingAlert.warnType || '').replace(/주의보|경보/g, '').trim();
            badge.textContent = `${cleanType} 예비`;
            badgeContainer.appendChild(badge);
        }

        // 3. 배지가 하나도 없으면 원래 로직 fallback
        if (badgeContainer.children.length === 0) {
            sortedAlerts.forEach(alert => {
                const badge = document.createElement('span');
                const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
                const isAwaiting = !alert.isPreliminary && cleanEf && cleanEf.length >= 12 && now < cleanEf;

                badge.className = `status-badge ${alert.isPreliminary || isAwaiting ? 'preliminary' : 'warning'}`;
                badge.style.fontSize = '0.7rem';
                badge.style.padding = '1px 6px';

                badge.textContent = (alert.isPreliminary || isAwaiting)
                    ? `${(alert.warnType || '').replace(/주의보|경보/g, '').trim()} 예비`
                    : `${alert.warnType} ${alert.level}`;

                badgeContainer.appendChild(badge);
            });
        }

        header.appendChild(badgeContainer);

        // 시각적 강조 (가장 높은 등급 기준)
        const hasWarning = sortedAlerts.some(a => !a.isPreliminary);
        item.style.borderLeft = `3px solid ${hasWarning ? '#ff6b6b' : '#ffb74d'}`;
        item.style.cursor = 'pointer';

        item.appendChild(header);

        // 상세 정보 영역 (모든 특보 정보를 순회하며 표시)
        const detailBox = document.createElement('div');
        detailBox.className = 'coastal-detail-box';
        detailBox.style.cssText = `
            display: none;
            margin-top: 8px;
            padding: 8px 10px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.8rem;
            color: #aaa;
        `;

        // [수정] 범용 시각 포맷팅 함수 (글로벌 함수 활용)
        const formatWarningTimeLocal = (timeStr) => {
            return formatWarningTime(timeStr);
        };

        // [수정] 상세 정보 영역 표시 전 중복 제거 (종류와 등급이 같으면 하나만 표시)
        const uniqueCoastalAlerts = [];
        const coastalSeen = new Set();
        sortedAlerts.forEach(a => {
            const key = `${a.warnType}|${a.level}`;
            if (!coastalSeen.has(key)) {
                uniqueCoastalAlerts.push(a);
                coastalSeen.add(key);
            }
        });

        // [수정] 연도/월 표기 제거 헬퍼 (특보카드 상세에서도 동일하게 적용)
        const stripYearMonth = (timeStr) => {
            const formatted = formatWarningTime(timeStr);
            return formatted ? formatted.replace(/\d{4}년\s*/g, '').replace(/^\d+월\s*/, '').replace(/\s\d+월\s*/, ' ') : formatted;
        };

        uniqueCoastalAlerts.forEach((alert, index) => {
            const tmFcFormatted = stripYearMonth(alert.tmFc);
            const tmEfFormatted = stripYearMonth(alert.tmEf);
            let tmEdFormatted = '정보 없음';
            const releaseVal = alert.tmCc || alert.tmEd || '';
            if (releaseVal && releaseVal.trim().length > 2 && (!alert.isPreliminary || alert.tmCcExplicit)) {
                tmEdFormatted = stripYearMonth(releaseVal);
            }

            // [수정] 둘 이상의 서로 다른 특보 정보가 있을 때만 타이틀 표시
            if (uniqueCoastalAlerts.length > 1) {
                const alertTitle = document.createElement('div');
                alertTitle.style.cssText = `
                    margin-bottom: 6px;
                    padding-top: ${index > 0 ? '8px' : '0'};
                    border-top: ${index > 0 ? '1px dashed rgba(255,255,255,0.1)' : 'none'};
                    color: ${alert.isPreliminary ? '#ffb74d' : '#ff6b6b'};
                    font-weight: 700;
                    font-size: 0.75rem;
                `;
                // 명칭 구성: 예비 단계이면 '풍랑 주의보 예정' 등
                const isPrelim = alert.isPreliminary || (alert.rawTmEf && getKfTime() < alert.rawTmEf.replace(/[^0-9]/g, ''));
                alertTitle.textContent = `● ${alert.warnType} ${alert.level}${isPrelim ? ' 예정' : ''}`;
                detailBox.appendChild(alertTitle);
            }

            // [Fix] 3줄 평평한 구조 + 해제예정 All Green
            const createRow = (label, value, color) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 0.75rem;">
                    <span style="color: #777;">${label}</span>
                    <span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value}</span>
                </div>`;

            const infoHtml =
                createRow('발표시각', tmFcFormatted) +
                createRow('발효시각', tmEfFormatted) +
                createRow('해제예정', tmEdFormatted, '#69f0ae'); // 무조건 초록색

            const infoContainer = document.createElement('div');
            infoContainer.innerHTML = infoHtml;
            // 마지막 요소가 아니면 마진
            if (index < uniqueCoastalAlerts.length - 1) {
                infoContainer.style.marginBottom = '10px';
            }
            detailBox.appendChild(infoContainer);
        });

        item.appendChild(detailBox);

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = detailBox.style.display === 'block';
            detailBox.style.display = isVisible ? 'none' : 'block';
        });

    } else {
        // 특보가 없는 경우
        const noAlertBadge = document.createElement('span');
        noAlertBadge.style.fontSize = '0.75rem';
        noAlertBadge.style.color = '#69f0ae';
        noAlertBadge.style.padding = '2px 8px';
        noAlertBadge.style.backgroundColor = 'rgba(105, 240, 174, 0.1)';
        noAlertBadge.style.borderRadius = '4px';
        noAlertBadge.textContent = '특보 없음';
        header.appendChild(noAlertBadge);

        item.appendChild(header);
        item.style.opacity = '0.7';
    }

    return item;
}


window.toggleSection = function (id) {
    const list = document.getElementById(id);
    if (!list) return;

    const parent = list.parentElement;
    const isCurrentlyOpen = parent.classList.contains('open');

    // 1. 모든 해역 섹션을 닫음 (배타적 모드)
    const allSections = document.querySelectorAll('.sea-section');
    allSections.forEach(section => {
        section.classList.remove('open');
    });

    // 2. 이전에 닫혀있었다면, 현재 섹션만 열기
    if (!isCurrentlyOpen) {
        parent.classList.add('open');
    }
};

function updateLoading(isLoading) {
    appState.isLoading = isLoading;
    const indicator = document.getElementById('loading-indicator');
    const content = document.getElementById('alert-content');
    const headerStatus = document.querySelector('.header-status');

    if (isLoading) {
        if (indicator) indicator.classList.remove('hidden');
        if (content) content.classList.add('hidden');

        // 헤더 뱃지 영역에 스피너 표시
        if (headerStatus) {
            // 아이콘 보존을 위해 새로 생성
            headerStatus.innerHTML = `
                <span style="color: rgba(255,255,255,0.5); font-size: 0.85rem; margin-right: 8px;">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                </span>
                <i id="main-accordion-icon" class="fa-solid fa-chevron-down"></i>
            `;
        }
    } else {
        if (indicator) indicator.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        // 로딩 해제 시 뱃지는 renderApp()에서 렌더링되므로 여기서 처리 불필요
    }
}

// [이동됨] updateTimeDisplay → app_init.js

