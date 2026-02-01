function createAlertElement(items) {
    if (!Array.isArray(items)) items = [items];

    let zoneNameStr = '';
    let sortedAlerts = [];

    if (items.length > 0) {
        sortedAlerts = sortAlertItems(items);
        zoneNameStr = sortedAlerts[0].zoneName;
    }

    const data = sortedAlerts[0] || {};
    zoneNameStr = data.zoneName || '알 수 없는 구역';

    const template = document.getElementById('alert-item-template');
    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.alert-card');

    card.style.cssText = `
        padding: 10px 12px;
        margin-bottom: 6px;
        border-radius: 8px;
        background: rgba(30, 40, 60, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: all 0.2s ease;
    `;

    const zoneName = clone.querySelector('.zone-name');
    zoneName.innerHTML = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = zoneNameStr;
    zoneName.appendChild(nameSpan);

    const badgeContainer = clone.querySelector('.alert-badges');
    badgeContainer.style.display = 'flex';
    badgeContainer.style.gap = '4px';
    badgeContainer.style.flexWrap = 'wrap';

    const now = getKfTime();
    const targetZoneName = data.zoneName || '';

    const LEVEL_RANK = { '': 0, '없음': 0, '해제': 0, '기타': 1, '주의보': 1, '경보': 2 };
    const getRank = (lvl) => LEVEL_RANK[lvl] || 0;

    let ledgerEntry = null;
    const normalizeName = (s) => (s || '')
        .replace(/[\s·.()]/g, '')
        .replace(/중$/, '')
        .replace(/중평수구역$/, '')
        .replace(/평수구역$/, '')
        .replace(/연안바다$/, '')
        .trim();

    const normTarget = normalizeName(targetZoneName);

    if (appState.alertStateHistory && normTarget) {
        for (const [regId, zoneData] of Object.entries(appState.alertStateHistory)) {
            const normKo = normalizeName(zoneData.korName || zoneData.regKo || '');
            if (normKo === normTarget || (normKo && normTarget.includes(normKo)) || (normTarget && normKo.includes(normTarget))) {
                ledgerEntry = zoneData;
                break;
            }
        }
    }

    let currentInView = null;
    let transitionBadge = null;

    if (ledgerEntry && ledgerEntry.current && (ledgerEntry.current.status === 'active' || ledgerEntry.current.status === 'publish')) {
        const curr = ledgerEntry.current;
        currentInView = {
            warnType: curr.wrnTp || curr.warnType || '풍랑',
            level: (curr.wrnLvl || curr.level || '주의보') === '기타' ? '주의보' : (curr.wrnLvl || curr.level),
            tmFc: curr.tmFc,
            tmEf: curr.tmEf,
            tmYn: curr.tmYn,
            isFromHistory: true
        };
    } else if (data && !data.isDummy && data.warnType && data.level) {
        currentInView = {
            ...data,
            level: data.level === '기타' ? '주의보' : data.level
        };
    }

    if (ledgerEntry && currentInView) {
        const history = ledgerEntry.history || [];
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const hLvl = (h.wrnLvl || h.level || '없음') === '기타' ? '주의보' : (h.wrnLvl || h.level || '없음');
            if (hLvl !== currentInView.level && hLvl !== '예비' && h.command !== '해제') {
                const curRank = getRank(currentInView.level);
                const prevRank = getRank(hLvl);
                if (curRank > prevRank && prevRank > 0) transitionBadge = '격상';
                else if (curRank < prevRank && curRank > 0) transitionBadge = '격하';
                break;
            }
        }
    }

    let upcomingFromApi = [];
    sortedAlerts.forEach(alert => {
        if (!alert.warnType || !alert.level) return;
        const cleanEf = String(alert.tmEf || '').replace(/[^0-9]/g, '');
        const isFuture = cleanEf && cleanEf.length >= 12 && now < cleanEf;
        if (isFuture || alert.isPreliminary) upcomingFromApi.push(alert);
    });

    if (currentInView) {
        const badge = document.createElement('span');
        badge.className = 'status-badge warning';
        badge.textContent = `${currentInView.warnType} ${currentInView.level}`;
        badgeContainer.appendChild(badge);
        if (transitionBadge) {
            const cmdBadge = document.createElement('span');
            cmdBadge.className = 'status-badge safe';
            cmdBadge.textContent = transitionBadge;
            badgeContainer.appendChild(cmdBadge);
        }
    }

    upcomingFromApi.forEach(upcoming => {
        let labelPrefix = '';
        if (currentInView) {
            const curRank = getRank(currentInView.level);
            const upRank = getRank(upcoming.level);
            if (curRank < upRank) labelPrefix = '격상 ';
            else if (curRank > upRank) labelPrefix = '격하 ';
        }
        const badge = document.createElement('span');
        badge.className = 'status-badge preliminary';
        const cleanType = (upcoming.warnType || '').replace('주의보', '').replace('경보', '').trim();
        badge.textContent = `${labelPrefix}${cleanType} ${upcoming.level} 예비`;
        badgeContainer.appendChild(badge);
    });

    if (badgeContainer.children.length === 0) {
        const safeBadge = document.createElement('span');
        safeBadge.className = 'status-badge safe';
        safeBadge.textContent = '지정해역 특보 없음';
        safeBadge.style.opacity = '0.6';
        badgeContainer.appendChild(safeBadge);
    }

    const details = clone.querySelector('.alert-details');
    details.innerHTML = '';
    const displayAlerts = upcomingFromApi.length > 0 ? upcomingFromApi : (currentInView ? [currentInView] : []);

    displayAlerts.forEach((alert, idx) => {
        if (alert.isDummy) return;
        const timeBox = document.createElement('div');
        timeBox.className = 'alert-time-box';
        timeBox.style.cssText = 'background: rgba(0, 0, 0, 0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255, 255, 255, 0.05);';

        if (upcomingFromApi.length > 0 && currentInView && idx === 0) {
            const infoLabel = document.createElement('div');
            infoLabel.style.cssText = 'font-size: 0.75rem; color: #fbbf24; margin-bottom: 8px; font-weight: 600;';
            infoLabel.textContent = '📌 예정 특보 정보';
            timeBox.appendChild(infoLabel);
        }

        if (displayAlerts.length > 1) {
            const alertTitle = document.createElement('div');
            const isPrelim = alert.isPreliminary;
            alertTitle.style.cssText = `display: inline-block; margin-bottom: 8px; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; font-weight: 700; background: ${isPrelim ? 'rgba(255, 183, 77, 0.2)' : 'rgba(255, 107, 107, 0.2)'}; color: ${isPrelim ? '#ffb74d' : '#ff6b6b'}; border: 1px solid ${isPrelim ? 'rgba(255, 183, 77, 0.3)' : 'rgba(255, 107, 107, 0.3)'};`;
            alertTitle.textContent = `${alert.warnType} ${alert.level}`;
            timeBox.appendChild(alertTitle);
        }

        const createRow = (label, value, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.85rem;';
            row.innerHTML = `<span style="color: #8b949e;">${label}</span><span style="color: ${color || '#e6edf3'}; font-weight: 500;">${value}</span>`;
            return row;
        };

        const releaseTimeRaw = alert.tmEd && alert.tmEd.trim() !== '' ? alert.tmEd : '';
        let releaseTime = '정보 없음';
        if (releaseTimeRaw && !releaseTimeRaw.startsWith('00일')) releaseTime = formatDate(releaseTimeRaw);
        if (!releaseTime || releaseTime === '일' || releaseTime.trim() === '') releaseTime = '정보 없음';

        timeBox.appendChild(createRow('발표시각', formatDate(alert.tmFc) || '정보 없음'));
        timeBox.appendChild(createRow('발효시각', formatDate(alert.tmEf) || '정보 없음'));
        timeBox.appendChild(createRow('해제예정', releaseTime, '#69f0ae'));
        details.appendChild(timeBox);
    });

    const findCoastalZones = (zName) => {
        if (!zName) return null;
        const norm = zName.replace(/[\s·.]/g, '');
        for (const [key, val] of Object.entries(COASTAL_MAPPING)) {
            if (key.replace(/[\s·.]/g, '') === norm) return val;
        }
        return null;
    };

    const coastalZones = findCoastalZones(data.zoneName);
    if (coastalZones && coastalZones.length > 0) {
        const coastalContainer = document.createElement('div');
        coastalContainer.className = 'coastal-zones';
        coastalContainer.style.marginTop = '12px';
        coastalContainer.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        coastalContainer.style.paddingTop = '12px';

        const coastalTitle = document.createElement('div');
        coastalTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 8px;';
        coastalTitle.textContent = '연안바다/평수구역';
        coastalContainer.appendChild(coastalTitle);

        const findCoastalAlert = (fullName) => {
            const normalizedTarget = (fullName || '').replace(/\s+/g, '');
            for (const [key, alerts] of Object.entries(appState.coastalAlerts || {})) {
                if (key.replace(/\s+/g, '') === normalizedTarget) return alerts;
            }
            return null;
        };

        const sortedCoastal = [...coastalZones].sort((a, b) => {
            const alertA = findCoastalAlert(a.fullName);
            const alertB = findCoastalAlert(b.fullName);
            if (alertA && !alertB) return -1;
            if (!alertA && alertB) return 1;
            return 0;
        });

        sortedCoastal.forEach(coastal => {
            const coastalAlert = findCoastalAlert(coastal.fullName);
            const coastalItem = createCoastalElement(coastal, coastalAlert, data.zoneName);
            coastalContainer.appendChild(coastalItem);
        });
        details.appendChild(coastalContainer);
    }

    const buoys = BUOY_MAPPING[data.zoneName];
    if (buoys && buoys.length > 0) {
        const buoyContainer = document.createElement('div');
        buoyContainer.className = 'buoy-section';
        buoyContainer.style.cssText = 'margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;';

        const buoyTitle = document.createElement('div');
        buoyTitle.style.cssText = 'font-size: 0.85rem; color: #8b949e; margin-bottom: 10px;';
        buoyTitle.innerHTML = BUOY_SVG_ICON + ' 관측부이 <span style="color:#69f0ae;font-size:0.75rem">(' + buoys.length + ')</span>';
        buoyContainer.appendChild(buoyTitle);

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;';

        const infoArea = document.createElement('div');
        infoArea.className = 'buoy-info-area';
        infoArea.style.cssText = 'display: none; background: rgba(68, 138, 255, 0.1); border-radius: 8px; padding: 12px; border: 1px solid rgba(68, 138, 255, 0.2);';

        buoys.forEach(buoy => {
            const btn = document.createElement('button');
            btn.className = 'buoy-btn';
            btn.textContent = buoy.name;
            btn.style.cssText = 'padding: 6px 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #ccc; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    infoArea.style.display = 'none';
                    return;
                }
                btnContainer.querySelectorAll('.buoy-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                infoArea.style.display = 'block';
                displayBuoyInfo(buoy, infoArea);
            });
            btnContainer.appendChild(btn);
        });

        buoyContainer.appendChild(btnContainer);
        buoyContainer.appendChild(infoArea);
        details.appendChild(buoyContainer);
    }

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'card-action-btns';
    actionsContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 15px;';

    if (typeof showSeaForecastTable === 'function') {
        const forecastBtn = document.createElement('button');
        forecastBtn.innerHTML = '🕒 해역별 주간예보';
        forecastBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #f57c00, #e65100); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap;';
        forecastBtn.addEventListener('click', (e) => { e.stopPropagation(); showSeaForecastTable(data.zoneName); });
        actionsContainer.appendChild(forecastBtn);
    }

    const zoneViewBtn = document.createElement('button');
    zoneViewBtn.innerHTML = '🗺️ 기상전망';
    zoneViewBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #e94560, #0f3460); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap;';
    zoneViewBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof showZoneOverlay === 'function') showZoneOverlay(data.zoneName); });
    actionsContainer.appendChild(zoneViewBtn);

    if (WINDY_URL_MAPPING[data.zoneName]) {
        const windyBtn = document.createElement('button');
        windyBtn.innerHTML = '<i class="fa-solid fa-wind"></i> 윈디';
        windyBtn.style.cssText = 'flex: 1; padding: 12px 8px; background: linear-gradient(135deg, #00c6ff, #0072ff); color: white; border: none; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap;';
        windyBtn.addEventListener('click', (e) => { e.stopPropagation(); showWindyPopup(data.zoneName); });
        actionsContainer.appendChild(windyBtn);
    }

    details.appendChild(actionsContainer);
    return card;
}
