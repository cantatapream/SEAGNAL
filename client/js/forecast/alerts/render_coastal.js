/**
 * ============================================================================
 * 파일명: js/render_coastal.js
 * 역할: 연안 구역 렌더링, 부이 데이터 표시, 로딩/시간 업데이트
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/utils/utils.js(appState·trackUsage) ·
 *                   shared/utils/mappings.js(BUOY_TYPES)
 *  - 서버 API      : 없음 (appState.buoyData 를 표시만 — 수집은 data.js가 담당)
 *  - 마크업        : #loading-indicator · #alert-content
 *  - 나를 쓰는 곳  : render.js(createCoastalElement·displayBuoyInfo) ·
 *                   outlook/windy.js(displayBuoyInfo) · data.js(updateLoading)
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
    // [사용량] 특보/기상현황 아코디언 안 부이 버튼으로 부이 정보가 표출됨 → 통합 key
    if (window.trackUsage) window.trackUsage('buoy.info_view');
    container.innerHTML = '';

    // 디버그: 부이 ID와 데이터 유무 확인
    // console.log('🔍 부이 조회:', buoy.id, buoy.name, '| 데이터 존재:', !!appState.buoyData[buoy.id]);

    const buoyData = appState.buoyData[buoy.id];
    const typeInfo = BUOY_TYPES[buoy.type] || { name: '부이', icon: '📍' };

    /**
     * [헬퍼] 부이 데이터 한 값을 사람이 읽기 좋은 문자열로 다듬는다.
     *
     * 왜 필요한가?
     *   marine.kma.go.kr 가 보내주는 값은 float32 라서 JS 로 받으면
     *   "0.800000011920929" 같은 부동소수점 잔여 자리가 길게 붙는다.
     *   해역별 특보/기상현황 아코디언 안의 부이 카드(displayBuoyInfo) 에서도
     *   동일한 잔여 자리가 그대로 노출되던 문제를 잡기 위한 헬퍼.
     *
     * 동작 규칙:
     *   - null / undefined / NaN 같이 숫자가 아닌 값은 그대로 통과(파괴 X).
     *   - key 가 'windDirection'(각도) 또는 'humidity'(%) 이면 정수로 round.
     *   - 그 외 (파고/풍속/돌풍/파주기/수온/기온/기압) → toFixed(1) 로
     *     소수 1자리 고정. 예: 0.800000011920929 → "0.8"
     *
     * seaZones.js 의 _fmt 와 같은 역할이지만 키 이름이 다른 데이터 모델
     *   (마린 API 의 짧은 키 vs 우리 내부 객체의 긴 키)
     *   을 다루므로 이 파일에 별도 정의되어 있음.
     *
     * 어디서 쓰이나? (이 파일 안에서만 호출, displayBuoyInfo 내부)
     *   - 파고 3종(waveHeightMax / waveHeightAvg / waveHeightSig)
     *   - 단일 파고(waveHeight)
     *   - 풍속(windSpeed) / 수온(waterTemp)
     *   - 돌풍(windGust) / 파주기(wavePeriod) / 기온(airTemp) / 기압(pressure) / 습도(humidity)
     *
     * @param {*} v   - 우리 내부 buoyData 객체에 들어있는 값
     * @param {string} key - 항목 식별. 'windDirection'·'humidity' 만 정수, 그 외 1자리
     * @returns {*} 포맷된 문자열 또는 변환 불가 시 원래 값
     */
    const _fmt = (v, key) => {
        if (v == null) return v;                              // null/undefined → 그대로
        const n = typeof v === 'number' ? v : parseFloat(v);  // 문자열 숫자도 받아줌
        if (!Number.isFinite(n)) return v;                    // NaN/Infinity → 그대로
        return (key === 'windDirection' || key === 'humidity') ? String(Math.round(n)) : n.toFixed(1);
    };

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

    // 파고 표시: 최대/유의/평균이 있으면 라벨 아래 한 줄 배치
    const hasDetailedWave = buoyData.waveHeightMax !== null && buoyData.waveHeightMax !== undefined;
    if (hasDetailedWave) {
        const valStyle = 'color:#4fc3f7;font-weight:600;font-size:1.1rem;';
        const unitStyle = 'font-size:0.75rem;font-weight:400;color:#8b949e;';
        const sepStyle = 'color:#555;margin:0 2px;';
        const parts = [];
        if (buoyData.waveHeightMax !== null) parts.push(`<span style="${valStyle}">${_fmt(buoyData.waveHeightMax, 'waveHeightMax')}</span><span style="${unitStyle}">m(최대)</span>`);
        if (buoyData.waveHeightAvg !== null) parts.push(`<span style="${valStyle}">${_fmt(buoyData.waveHeightAvg, 'waveHeightAvg')}</span><span style="${unitStyle}">m(평균)</span>`);
        if (buoyData.waveHeightSig !== null) parts.push(`<span style="${valStyle}">${_fmt(buoyData.waveHeightSig, 'waveHeightSig')}</span><span style="${unitStyle}">m(유의)</span>`);
        const waveDiv = document.createElement('div');
        waveDiv.style.cssText = 'width:100%;margin-bottom:-10px;';
        waveDiv.innerHTML = `
            <div style="font-size:0.85rem;color:#8b949e;margin-bottom:2px;">🌊 파고</div>
            <div>${parts.join(`<span style="${sepStyle}">|</span>`)}</div>
        `;
        mainData.appendChild(waveDiv);
    } else if (buoyData.waveHeight !== null) {
        const waveBox = createDataBox('🌊 파고', _fmt(buoyData.waveHeight, 'waveHeight'), 'm', '#4fc3f7');
        mainData.appendChild(waveBox);
    }

    if (buoyData.windSpeed !== null) {
        const windDir = buoyData.windDirection !== null ? getWindDirectionText(buoyData.windDirection) : '';
        const windBox = createDataBox('💨 풍속', _fmt(buoyData.windSpeed, 'windSpeed'), `m/s ${windDir}`, '#81c784');
        mainData.appendChild(windBox);
    }

    if (buoyData.waterTemp !== null) {
        const tempBox = createDataBox('🌡️ 수온', _fmt(buoyData.waterTemp, 'waterTemp'), '°C', '#ffb74d');
        mainData.appendChild(tempBox);
    }

    container.appendChild(mainData);

    // 상세 데이터
    let detailHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px">';

    if (buoyData.windGust !== null) {
        detailHTML += `<div><span style="color:#8b949e">돌풍</span> <span style="color:#fff">${_fmt(buoyData.windGust, 'windGust')} m/s</span></div>`;
    }
    // [NEW 2026-04-25] 파주기 — marine.kma.go.kr endpoint 도입으로 노출
    if (buoyData.wavePeriod !== null && buoyData.wavePeriod !== undefined) {
        detailHTML += `<div><span style="color:#8b949e">파주기</span> <span style="color:#fff">${_fmt(buoyData.wavePeriod, 'wavePeriod')} 초</span></div>`;
    }
    if (buoyData.airTemp !== null) {
        detailHTML += `<div><span style="color:#8b949e">기온</span> <span style="color:#fff">${_fmt(buoyData.airTemp, 'airTemp')}°C</span></div>`;
    }
    if (buoyData.pressure !== null) {
        detailHTML += `<div><span style="color:#8b949e">기압</span> <span style="color:#fff">${_fmt(buoyData.pressure, 'pressure')} hPa</span></div>`;
    }
    if (buoyData.humidity !== null) {
        detailHTML += `<div><span style="color:#8b949e">습도</span> <span style="color:#fff">${_fmt(buoyData.humidity, 'humidity')}%</span></div>`;
    }
    // [NEW 2026-04-25] 시정 — marine API m 단위를 km 환산
    if (typeof buoyData.visibility === 'number' && !isNaN(buoyData.visibility)) {
        const vsKm = Math.round(buoyData.visibility / 100) / 10;
        detailHTML += `<div><span style="color:#8b949e">시정</span> <span style="color:#fff">${vsKm} km</span></div>`;
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
        // [정책 — 사용자 확정 2026-08-09] 자식 카드는 **클릭에 반응하지 않고 항상 닫힘**.
        //  경위: 8/8 에 "탭하면 펼침"으로 바꿨다가(자식 고유 시각을 보여주기 위해),
        //  실사용 후 사용자가 "눌러도 안 열리게" 로 확정. detailBox 는 DOM 에 생성되지만
        //  표시되지 않는다(내용 구성 코드는 재활성화 대비 보존).
        //  → 자식 카드는 "이름 + 등급 배지" 표시 전용. 클릭 커서 단서도 두지 않는다.
        item.style.cursor = 'default';

        item.appendChild(header);

        // 상세 정보 영역 (모든 특보 정보를 순회하며 표시)
        const detailBox = document.createElement('div');
        detailBox.className = 'coastal-detail-box';
        // [2026-08-08] 기본 닫힘 + 클릭 시 펼침 (종전엔 영원히 닫힘).
        //   종전 정책의 근거였던 "부모 상속 자식 → detail box 가 부모 카드와 동일해 가치 0" 은
        //   서버가 자식 표출 필드를 자식 자신의 데이터로만 채우도록 바뀌면서(부모 fallback 제거)
        //   더는 성립하지 않는다. 실제로 자식은 부모와 다른 시각을 갖는다 —
        //   2026-08-08 경북남부앞바다: 부모 발효 8/8 23시 vs 평수구역 예비 발효예정 8/9 18~24시.
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
        // [표시 포맷] formatWarningTime 이 이미 "M월 D일(라벨) H시" 형식을 반환하므로
        //   월 제거 없이 그대로 사용 (사용자 요구: 월 포함 표시).
        const stripYearMonth = (timeStr) => formatWarningTime(timeStr);

        // [2026-08-08] V3.1 의 "자식 발효시각은 정확시각일 때만 표시" 게이트(isExactSingleTime)를
        //   제거했다. 그 게이트의 목적은 자식 카드의 "표시→사라짐→표시" 깜빡임 방지였는데,
        //   범위형도 항상 표시하면 줄이 사라지는 일 자체가 없어져 목적이 더 잘 달성된다.
        //   반대로 게이트가 있으면 범위형만 가진 예비 자식(예: 8/9 18~24시)이 "언제인지 없이"
        //   등급만 노출돼 사용자가 현재 특보로 오해한다 — 2026-08-08 실사고. 부모 카드와 동일하게
        //   "읽을 만한 값이 있으면 보여준다" 정책으로 통일.

        uniqueCoastalAlerts.forEach((alert, index) => {
            // [V3] 빈 시각 값은 빈 문자열 반환 → 줄 자체를 미표시 (자식이 종합기상
            //   텍스트 출처만일 때 tmEf/tmCc/tmEd 가 빈 값이므로 정보 노이즈 제거).
            // [2026-08-08] 발효시각도 부모와 동일 정책 — 값이 있으면 형식 불문 표시(범위형 포함).
            const hasValue = v => !!(v && String(v).trim().length > 0);
            const tmFcFormatted = hasValue(alert.tmFc) ? stripYearMonth(alert.tmFc) : '';
            const tmEfFormatted = hasValue(alert.tmEf) ? stripYearMonth(alert.tmEf) : '';
            let tmEdFormatted = '';
            const releaseVal = alert.tmCc || alert.tmEd || '';
            // [수정D] 실제 해제예고 값이 있으면 표시 (발표대기 자식이 부모 해제예고 상속한 경우 포함).
            //   순수 예비(해제예고 없음)는 값이 없어 자동 미표시.
            if (hasValue(releaseVal) && releaseVal.trim().length > 2) {
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
                // 발효 전엔 '예비' 표시, 발효 후엔 자식 텍스트 등급(주의보/경보) 그대로.
                // V3.2: "예정" 표기 폐지 — 발효 전은 통일하여 '예비' 라벨.
                const isPrelim = alert.isPreliminary || (alert.rawTmEf && getKfTime() < alert.rawTmEf.replace(/[^0-9]/g, ''));
                const displayLevel = isPrelim ? '예비' : alert.level;
                alertTitle.textContent = `● ${alert.warnType} ${displayLevel}`;
                detailBox.appendChild(alertTitle);
            }

            // [Fix] 3줄 평평한 구조 + 해제예정 All Green
            const createRow = (label, value, color) => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 0.75rem;">
                    <span style="color: #777;">${label}</span>
                    <span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value}</span>
                </div>`;

            // [2026-08-08 사용자 요구] 부모 카드와 동일하게 3줄을 항상 표시하고,
            //   값이 없으면 줄을 숨기는 대신 '정보 없음' 으로 채운다(render.js:868 과 같은 정책).
            //   종전처럼 줄을 통째로 감추면 "해제예정이 없는 것"과 "표시가 안 되는 것"을
            //   사용자가 구분할 수 없다.
            let infoHtml = '';
            infoHtml += createRow('발표시각', tmFcFormatted || '정보 없음');
            infoHtml += createRow('발효시각', tmEfFormatted || '정보 없음');
            infoHtml += createRow('해제예정', tmEdFormatted || '정보 없음', tmEdFormatted ? '#69f0ae' : undefined);

            if (infoHtml) {
                const infoContainer = document.createElement('div');
                infoContainer.innerHTML = infoHtml;
                if (index < uniqueCoastalAlerts.length - 1) {
                    infoContainer.style.marginBottom = '10px';
                }
                detailBox.appendChild(infoContainer);
            }
        });

        item.appendChild(detailBox);

        // [2026-08-09 사용자 확정] 클릭 토글 제거 — 눌러도 열리지 않는다.
        //   (8/8 에 넣었던 토글을 실사용 후 되돌린 것. detailBox 는 display:none 고정.)

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

    const parent = list.parentElement; // .sea-section
    const isCurrentlyOpen = parent.classList.contains('open');

    // 1. 같은 아코디언(부모 컨테이너) 내의 해역 섹션만 닫음 (배타적 모드)
    const container = parent.parentElement;
    if (container) {
        container.querySelectorAll('.sea-section').forEach(section => {
            section.classList.remove('open');
        });
    }

    // 2. 이전에 닫혀있었다면, 현재 섹션만 열기
    if (!isCurrentlyOpen) {
        parent.classList.add('open');
        // [사용량] 중분류(동해남부해상 등) 아코디언이 있는 대분류(동해/서해/남해)는
        //   여기(대분류)서 카운트하지 않는다 — 중분류 펼침에서 집계(render.js/windy.js).
        //   그러나 중분류가 1개라 구역이 대분류 바로 아래 표시되는 대분류(예: 제주)는
        //   이 대분류 펼침이 곧 '부모 해역' 조회이므로 여기서 집계한다.
        if (window.trackUsage && !list.querySelector('.sub-region-section')) {
            const key = (typeof id === 'string' && id.indexOf('status-') === 0)
                ? 'main.weather_region_open'
                : 'main.warn_region_open';
            window.trackUsage(key);
        }
    }
};

/**
 * 전역 로딩 상태 토글 — appState.isLoading 갱신 + 로딩 인디케이터 DOM 표시/숨김.
 * fetchAllData 등의 진입/퇴장 시 호출.
 *
 * @param {boolean} isLoading - true 면 인디케이터 표시
 */
function updateLoading(isLoading) {
    appState.isLoading = isLoading;
    const indicator = document.getElementById('loading-indicator');
    const content = document.getElementById('alert-content');
    const headerStatus = document.querySelector('#main-accordion-header .header-status');

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

