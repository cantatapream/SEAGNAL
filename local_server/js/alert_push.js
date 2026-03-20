/**
 * ============================================================================
 * 파일명: js/alert_push.js
 * 역할: 해양특보 알림 관리 모달 (발표/발효/해제/격상/직접발송/이력)
 * ============================================================================
 *
 * [설명]
 * - showAlertManagementModal(): 알림 관리 모달 열기
 * - switchAlertAdminTab(): 탭 전환
 * - renderAlertAdminContent(): 탭별 콘텐츠 렌더링
 * - sendManualPushFromGroup(): 수동 발송 핸들러
 * - renderCustomPushTab(): 직접 발송 탭
 * - renderHistoryTab(): 발송 이력 탭
 *
 * [로딩 순서] admin_collect.js 이후, app_init.js 이전
 * [원본] history.js에서 분리
 * ============================================================================
 */

// ============================================================================
// (A) Mock 데이터 (데모용)
// ============================================================================
let MOCK_ALERT_HISTORY = [];

function generateMockAlertHistory() {
    MOCK_ALERT_HISTORY.push({
        id: 'pub_1', tab: 'publish', type: 'auto',
        time: '26.01.03 07:00', pushStatus: 'sent', pushTime: '15:30',
        title: '풍랑주의보 발표', zones: ['울산앞바다', '경북남부앞바다'], grade: 'warning',
        items: [
            { zone: '울산앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' },
            { zone: '경북남부앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' }
        ]
    });
    MOCK_ALERT_HISTORY.push({
        id: 'pub_2', tab: 'publish', type: 'auto',
        time: '26.01.03 07:00', pushStatus: 'pending', pushTime: null,
        title: '풍랑주의보 발표', zones: ['부산앞바다', '거제시동부앞바다'], grade: 'advisory',
        items: [
            { zone: '부산앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 20:00' },
            { zone: '거제시동부앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 22:00' }
        ]
    });
    MOCK_ALERT_HISTORY.push({
        id: 'act_1', tab: 'active', type: 'auto',
        time: '26.01.03 09:00', badge: 'active', pushStatus: 'sent', pushTime: '09:00',
        title: '풍랑경보 발효', zones: ['인천·경기북부앞바다'], grade: 'warning',
        items: [{ zone: '인천·경기북부앞바다', tmRl: '26.01.03 18:00' }]
    });
    MOCK_ALERT_HISTORY.push({
        id: 'lvl_1', tab: 'level', type: 'auto',
        time: '26.01.03 15:00', badge: 'upgrade', pushStatus: 'sent', pushTime: '15:00',
        title: '풍랑주의보 → 풍랑경보', zones: ['제주도북부앞바다'], grade: 'warning',
        items: [{ zone: '제주도북부앞바다', tmRl: '26.01.03 22:00' }]
    });
    MOCK_ALERT_HISTORY.push({
        id: 'cust_1', tab: 'custom_history', type: 'manual',
        time: '26.01.03 15:30', pushStatus: 'sent', count: 245,
        target: '전남서부남해앞바다, 전남동부남해앞바다',
        title: '긴급 해양 안전 공지',
        content: '현재 남해 서부 해역에 강한 돌풍이 예상되오니 소형 선박은 안전한 곳으로 대피하시기 바랍니다.'
    });
    MOCK_ALERT_HISTORY.push({
        id: 'cust_2', tab: 'custom_history', type: 'manual',
        time: '26.01.02 09:00', pushStatus: 'sent', count: 512,
        target: '전체 해역', title: '시스템 점검 안내',
        content: '26.01.02 10:00 ~ 12:00 서비스 점검 예정입니다.'
    });
}
generateMockAlertHistory();

// ============================================================================
// (B) 알림 관리 모달
// ============================================================================
window.showAlertManagementModal = function () {
    if (!adminAuthenticated.alert) return;
    const existingModal = document.getElementById('alert-management-modal');
    if (existingModal) existingModal.remove();

    const tabs = [
        { id: 'publish', name: '발표', icon: 'fa-bullhorn' },
        { id: 'active', name: '발효', icon: 'fa-check-circle' },
        { id: 'release', name: '해제', icon: 'fa-check' },
        { id: 'level', name: '격상/격하', icon: 'fa-arrow-up-right-dots' },
        { id: 'custom', name: '직접 발송', icon: 'fa-paper-plane' },
        { id: 'history', name: '발송 이력', icon: 'fa-history' }
    ];

    const modal = document.createElement('div');
    modal.id = 'alert-management-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);animation:fadeIn 0.2s;';
    modal.innerHTML = '<div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;width:95%;max-width:600px;max-height:85vh;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,0.1);"><div style="background:linear-gradient(135deg,#ef4444,#b91c1c);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;z-index:10;"><h3 style="margin:0;color:#fff;font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:10px;text-shadow:0 1px 2px rgba(0,0,0,0.2);"><i class="fa-solid fa-tower-broadcast"></i> 해양특보 알림 관리</h3><button onclick="document.getElementById(\'alert-management-modal\').remove();" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:background 0.2s;"><i class="fa-solid fa-xmark"></i></button></div><div style="display:flex;background:rgba(0,0,0,0.2);padding:0;border-bottom:1px solid rgba(255,255,255,0.1);position:sticky;z-index:10;backdrop-filter:blur(10px);width:100%;">' + tabs.map(function(t) { return '<button class="alert-admin-tab" data-tab="' + t.id + '" onclick="window.switchAlertAdminTab(\'' + t.id + '\')" style="flex:1;padding:12px 2px;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-weight:600;font-size:0.75rem;transition:all 0.2s;white-space:nowrap;border-bottom:2px solid transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;"><i class="fa-solid ' + t.icon + '" style="font-size:0.9rem;"></i><span>' + t.name + '</span></button>'; }).join('') + '</div><div id="alert-management-content" style="padding:20px;flex:1;overflow-y:auto;background:#0f172a;"><div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 데이터를 불러오는 중...</div></div></div>';

    document.body.appendChild(modal);
    window.switchAlertAdminTab('publish');
};

// ============================================================================
// (C) 탭 전환
// ============================================================================
window.switchAlertAdminTab = function (tabId) {
    document.querySelectorAll('.alert-admin-tab').forEach(function(btn) {
        if (btn.dataset.tab === tabId) {
            btn.style.color = '#fff';
            btn.style.borderBottomColor = '#ef4444';
            btn.style.background = 'rgba(255,255,255,0.05)';
        } else {
            btn.style.color = '#94a3b8';
            btn.style.borderBottomColor = 'transparent';
            btn.style.background = 'transparent';
        }
    });
    window.renderAlertAdminContent(tabId);
};

// ============================================================================
// (D) 탭별 콘텐츠 렌더링
// ============================================================================
window.renderAlertAdminContent = async function (tabId, targetContainer) {
    var container = targetContainer || document.getElementById('alert-management-content');
    if (!container) return;
    if (tabId === 'custom') { window.renderCustomPushTab(container); return; }
    if (tabId === 'history') { window.renderHistoryTab(container); return; }

    var pushHistory = [];
    try { var hRes = await fetch('/api/push-history'); if (hRes.ok) pushHistory = await hRes.json(); } catch (e) { }

    var allAlerts = [...appState.alerts].filter(function(a) { return !a.isCoastal && !a.zoneName.includes('연안바다') && !a.zoneName.includes('평수구역'); });

    var filteredItems = [];
    if (tabId === 'publish') {
        filteredItems = allAlerts.filter(function(a) {
            return (a.isPreliminary || a.command === '1' || a.command === '발표' || a.command === '2' || a.command === '시각변경') && !(a.command === '변경' || a.command === '변경발표' || a.command === '6');
        });
    } else if (tabId === 'active') {
        filteredItems = allAlerts.filter(function(a) { return a.command !== '3' && a.command !== '해제'; });
    } else if (tabId === 'release') {
        filteredItems = allAlerts.filter(function(a) {
            return a.command === '3' || a.command === '해제' || ((!a.isPreliminary || a.tmCcExplicit) && a.tmEd && a.tmEd.trim() !== '' && a.tmEd !== '정보 없음' && a.tmEd !== '미정' && !a.tmEd.includes('00일'));
        });
    } else if (tabId === 'level') {
        filteredItems = allAlerts.filter(function(a) { return a.command === '변경' || a.command === '변경발표' || a.command === '6'; });
    }

    var uniqueAlertMap = new Map();
    filteredItems.forEach(function(item) {
        var uniqueKey = item.zoneName + '_' + item.warnType + '_' + item.level;
        var existing = uniqueAlertMap.get(uniqueKey);
        var itemTime = String(item.tmFc || '').replace(/[^0-9]/g, '');
        var existingTime = existing ? String(existing.tmFc || '').replace(/[^0-9]/g, '') : '';
        if (!existing || itemTime > existingTime) uniqueAlertMap.set(uniqueKey, item);
    });
    var finalizedItems = Array.from(uniqueAlertMap.values());

    var cardGroups = {};
    var nowStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-T:Z]/g, '').substring(0, 12);

    finalizedItems.forEach(function(item) {
        var isLevelChange = item.command === '변경' || (item.level && item.level.includes('경보'));
        var statusType = (item.level && item.level.includes('경보')) ? '격상' : ((item.level && item.level.includes('주의보') && item.command === '변경') ? '격하' : '정규');

        var getCompareValue = function(dStr) {
            if (!dStr || dStr === '정보 없음' || dStr === '미정' || dStr.trim() === '일') return '999999999999';
            var numeric = dStr.replace(/[^0-9]/g, '');
            if (numeric.length === 12) return numeric;
            var dayMatch = dStr.match(/(\d+)일/);
            var hourMatch = dStr.match(/\((\d+)시/);
            if (dayMatch) {
                var now2 = new Date();
                return now2.getFullYear() + String(now2.getMonth() + 1).padStart(2, '0') + dayMatch[1].padStart(2, '0') + (hourMatch ? hourMatch[1].padStart(2, '0') : '00') + '00';
            }
            if (!numeric || numeric.length === 0) return '999999999999';
            return numeric.padEnd(12, '0');
        };

        var efCompare = getCompareValue(item.tmEf);
        var edCompare = getCompareValue(item.tmEd);
        var isActuallyActive = item.isPreliminary ? false : (efCompare <= nowStr);
        var isActuallyReleased = (item.isPreliminary || !isActuallyActive) ? false : (edCompare <= nowStr);
        var isWaiting = tabId === 'release' ? (edCompare > nowStr) : (item.isPreliminary || efCompare > nowStr);

        var typeKey = item.warnType + (item.level || '');
        var primaryTime = item.tmFc;
        if (tabId === 'active') primaryTime = item.tmEf;
        else if (tabId === 'release') primaryTime = item.tmYn || item.tmEd || '정보 없음';

        var groupKey = statusType + '_' + typeKey + '_' + primaryTime;
        var subKey = 'default';
        if (tabId === 'publish') subKey = item.tmEf;
        else if (tabId === 'active') subKey = item.tmEd || '정보 없음';

        var isTimeChanged = item.command === '2' || item.command === '시각변경';
        var headerTimeDisplay = isNaN(Number(primaryTime)) ? (primaryTime === '정보 없음' ? '해제 시각 미정' : primaryTime) : primaryTime;
        if (primaryTime && primaryTime.length === 12 && !isNaN(Number(primaryTime))) {
            headerTimeDisplay = '26.' + primaryTime.substring(4, 6) + '.' + primaryTime.substring(6, 8) + ' ' + primaryTime.substring(8, 10) + ':' + primaryTime.substring(10, 12);
        }

        if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = {
                key: groupKey, headerTime: headerTimeDisplay, rawTime: primaryTime,
                tmFc: item.tmFc, statusType: statusType, typeName: item.warnType, level: item.level,
                isPreliminary: item.isPreliminary, isTimeChanged: isTimeChanged,
                isWaiting: isWaiting, isActuallyActive: isActuallyActive, isActuallyReleased: isActuallyReleased,
                isLevelChange: isLevelChange,
                prevLevel: item.prevLevel || (statusType === '격상' ? '주의보' : (statusType === '격하' ? '경보' : null)),
                prevTypeName: (statusType === '격상' || statusType === '격하') ? item.warnType : null,
                subGroups: {}
            };
        }

        if (!cardGroups[groupKey].subGroups[subKey]) {
            cardGroups[groupKey].subGroups[subKey] = { tmEf: item.tmEf, tmYn: item.tmEd, tmFc: item.tmFc, zones: [] };
        }

        var fullName = item.zoneName.split('(')[0].trim();
        if (!cardGroups[groupKey].subGroups[subKey].zones.includes(fullName)) {
            cardGroups[groupKey].subGroups[subKey].zones.push(fullName);
        }
    });

    var sortedGroups = Object.values(cardGroups).sort(function(a, b) {
        if (a.isWaiting !== b.isWaiting) return a.isWaiting ? 1 : -1;
        return String(b.rawTime).localeCompare(String(a.rawTime));
    });

    if (sortedGroups.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#64748b;"><i class="fa-solid fa-clipboard-check" style="font-size:3rem;margin-bottom:15px;opacity:0.3;"></i><p style="font-size:1.1rem;font-weight:600;">현재 해당 탭의 특보 데이터가 없습니다.</p><p style="font-size:0.85rem;margin-top:5px;">기상청 데이터가 수집되면 자동으로 타임라인이 형성됩니다.</p></div>';
        return;
    }

    var html = '';
    sortedGroups.forEach(function(group) {
        var timeDisplay = group.headerTime;
        var isSent = pushHistory.some(function(h) {
            var tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || h.tab.startsWith(tabId)));
            if (!tabMatch) return false;
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;
            var contentMatch = h.content && h.content.includes(group.typeName) && h.time && group.headerTime && h.time.includes(group.headerTime.substring(4, 10));
            return contentMatch && (h.tab === tabId || (h.tab && h.tab.startsWith(tabId)));
        });

        var sentLog = isSent ? pushHistory.find(function(h) {
            var tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || (h.tab && h.tab.startsWith(tabId))));
            if (!tabMatch) return false;
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;
            return h.content && h.content.includes(group.typeName) && h.time && group.headerTime && h.time.includes(group.headerTime.substring(4, 10));
        }) : null;

        var isAuto = sentLog && sentLog.type === 'auto';
        var pushResult = isSent ? (isAuto ? '자동 발송완료' : '수동 발송완료') : '발송 대기';
        var statusText = '';

        if (tabId === 'active' || tabId === 'level') {
            if (group.isTimeChanged) {
                statusText = '<span style="color:#38bdf8;"><i class="fa-solid fa-clock-rotate-left"></i> 시각 변경</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            } else if (group.isWaiting) {
                statusText = '<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기 중</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            } else if (group.isActuallyReleased) {
                statusText = '<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            } else {
                var liveLabel = '발효 중';
                if (group.isLevelChange) liveLabel = group.level + '로 ' + group.statusType;
                statusText = '<span style="color:#ef4444;"><i class="fa-solid fa-satellite-dish"></i> ' + liveLabel + '</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            }
        } else if (tabId === 'release') {
            if (group.isWaiting) {
                statusText = '<span style="color:#10b981;"><i class="fa-solid fa-clock"></i> 해제 예정</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            } else {
                statusText = '<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            }
        } else if (tabId === 'publish') {
            if (group.isActuallyActive) {
                statusText = '<span style="color:#22c55e;">발효 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            } else {
                statusText = '<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:' + (isSent ? '#22c55e' : '#94a3b8') + ';">' + pushResult + '</span>';
            }
        } else {
            statusText = isSent ? '수동 발송완료' : '발송 대기';
        }

        var statusBadge = '<div style="font-size:0.75rem;font-weight:700;display:flex;align-items:center;">' + statusText + '</div>';
        var displayLevel = group.level || '';
        if ((displayLevel === '예비' || group.isPreliminary) && (tabId === 'active' || tabId === 'release' || tabId === 'level' || tabId === 'publish')) displayLevel = '주의보';

        var tabSymbol = '🔔'; var tabLabel = '발표';
        if (tabId === 'active') { tabSymbol = '⚠️'; tabLabel = '발효'; }
        else if (tabId === 'release') { tabSymbol = '✅'; tabLabel = '해제'; }
        else if (tabId === 'level') {
            var isUp = (group.level || '').includes('경보');
            tabSymbol = isUp ? '🔺' : '🔻'; tabLabel = isUp ? '격상' : '격하';
            if (group.typeName.includes('태풍')) tabSymbol = '🌀';
        }

        var fullTitle = group.typeName + displayLevel;
        var displayLabelText = fullTitle.includes(tabLabel) ? '' : tabLabel;

        // Build sub-content
        var subContent = '';
        if (tabId === 'release') {
            var allZones = [];
            Object.values(group.subGroups).forEach(function(sub) { sub.zones.forEach(function(z) { if (!allZones.includes(z)) allZones.push(z); }); });
            subContent = '<div style="line-height:1.6;"><div style="color:#e2e8f0;font-size:0.85rem;font-weight:600;margin-bottom:4px;">ㅇ 대상해역(' + allZones.length + '): <span style="font-weight:400;color:#94a3b8;">' + allZones.join(', ') + '</span></div></div>';
        } else {
            var keys = Object.keys(group.subGroups).sort();
            subContent = keys.map(function(k) {
                var sub = group.subGroups[k];
                var uniqueZones = Array.from(new Set(sub.zones));
                var zStr = uniqueZones.join(', ');
                var count = uniqueZones.length;
                var subInfo = '';
                if (tabId === 'active') {
                    var ed = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                    subInfo = '<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">' + ed + '</span></div>';
                } else if (tabId === 'publish') {
                    var ef = typeof formatDate === 'function' ? formatDate(sub.tmEf) : sub.tmEf;
                    subInfo = '<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 발효예정: <span style="color:#fff;">' + ef + '</span></div>';
                } else if (tabId === 'level') {
                    var ed2 = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                    subInfo = '<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">' + ed2 + '</span></div>';
                }
                return '<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px dashed rgba(255,255,255,0.1);"><div style="font-size:0.95rem;line-height:1.4;"><span style="color:#cbd5e1;font-weight:600;">ㅇ 대상해역(' + count + '):</span> <span style="color:#e2e8f0;">' + zStr + '</span></div>' + subInfo + '</div>';
            }).join('');
        }

        // Button area
        var buttonArea = '';
        if (tabId === 'level' && group.isWaiting) {
            // 격상/격하는 발효 대기 중이어도 발표는 완료 → 수동발송 허용
            buttonArea = '<button onclick="window.sendManualPushFromGroup(\'' + group.key + '\', \'' + tabId + '\')" style="background:' + (isSent ? '#475569' : '#ef4444') + ';color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">수동발송</button>';
        } else if ((tabId === 'active' || tabId === 'release') && group.isWaiting) {
            buttonArea = '';
        } else if (tabId === 'active' && group.isLevelChange) {
            buttonArea = '<div style="background:rgba(255,255,255,0.05);color:#64748b;padding:5px 12px;border-radius:6px;font-size:0.7rem;font-weight:700;border:1px solid rgba(255,255,255,0.05);">격상/격하 탭에서 관리</div>';
        } else {
            buttonArea = '<button onclick="window.sendManualPushFromGroup(\'' + group.key + '\', \'' + tabId + '\')" style="background:' + (isSent ? '#475569' : '#ef4444') + ';color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">수동발송</button>';
        }

        var titleIcon = group.isTimeChanged ? '🕐' : tabSymbol;
        var titleSuffix = group.isTimeChanged ? (tabId === 'publish' ? '발효시각 변경' : '해제시각 변경') : (group.isWaiting && tabId === 'level' ? (group.statusType + ' 예정') : displayLabelText);

        html += '<div style="background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:18px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);"><div style="padding:12px 16px;background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="font-size:0.85rem;font-weight:700;color:#cbd5e1;display:flex;align-items:center;"><i class="fa-regular fa-calendar-check" style="margin-right:8px;"></i> ' + timeDisplay + ' <span style="color:rgba(255,255,255,0.1);margin:0 10px;">|</span> ' + statusBadge + '</div>' + buttonArea + '</div><div style="padding:16px;"><div style="font-size:1.05rem;color:#fff;font-weight:800;margin-bottom:15px;display:flex;align-items:center;gap:8px;">' + titleIcon + ' ' + fullTitle + ' ' + titleSuffix + '</div>' + subContent + '</div></div>';
    });

    window._currentAdminCardGroups = cardGroups;
    container.innerHTML = html;
};

// ============================================================================
// (E) 수동 발송 핸들러
// ============================================================================
window.sendManualPushFromGroup = async function (groupKey, tabId) {
    if (!confirm('해당 그룹의 시나리오 메시지를 정말 수동으로 발송하시겠습니까?')) return;
    var groups = window._currentAdminCardGroups;
    if (!groups || !groups[groupKey]) return alert('오류: 그룹 정보를 찾을 수 없습니다.');
    var group = groups[groupKey];

    var items = Object.values(group.subGroups).map(function(sub) {
        return { zones: sub.zones, tmFc: (group.headerTime || '').replace(/[^0-9]/g, ''), tmEf: sub.tmEf, tmEd: sub.tmEd, tmYn: sub.tmEd };
    });

    try {
        var btn = document.activeElement;
        var originalText = btn ? btn.innerText : '';
        if (btn) btn.innerText = '전송 중...';

        var res = await fetch('/api/push-custom', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true,
                payload: {
                    templateId: tabId === 'level' ? (group.statusType === '격상' ? (group.isWaiting ? 'level_upgrade_publish' : 'level_upgrade_active') : (group.isWaiting ? 'level_downgrade_publish' : 'level_downgrade_active')) : tabId,
                    typeName: group.typeName, level: group.level || '', items: items,
                    isTimeChanged: group.isTimeChanged, prevTypeName: group.prevTypeName || null, prevLevel: group.prevLevel || null
                }
            })
        });
        if (res.ok) { alert('성공적으로 발송 요청되었습니다.'); window.switchAlertAdminTab(tabId); }
        else { var err = await res.text(); alert('발송 실패: ' + err); if (btn) btn.innerText = originalText; }
    } catch (e) { alert('네트워크 오류: ' + e.message); }
};

// ============================================================================
// (F) 직접 발송 탭
// ============================================================================
window.renderCustomPushTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    var history = [];
    try { var histRes = await fetch('/api/push-history'); if (histRes.ok) history = await histRes.json(); } catch (e) { }

    var regions = {};
    if (typeof SUB_REGION_ZONES !== 'undefined') {
        for (var subName in SUB_REGION_ZONES) {
            var zones = SUB_REGION_ZONES[subName];
            var mainName = typeof getMainRegion === 'function' ? getMainRegion(subName) : '기타';
            if (!regions[mainName]) regions[mainName] = {};
            regions[mainName][subName] = zones;
        }
    }

    var accordionHtml = '';
    var mainIdx = 0;
    Object.entries(regions).forEach(function(entry) {
        var main = entry[0], subs = entry[1];
        var isJeju = main.includes('제주');
        var subContent = '';

        if (isJeju) {
            var jejuZones = Object.values(subs)[0] || [];
            subContent = '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + jejuZones.map(function(z) {
                return '<label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.85rem;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);"><input type="checkbox" class="zone-checkbox main-group-' + mainIdx + '" value="' + z + '" style="margin-right:6px;" onchange="window.updateTargetCount()"> ' + z + '</label>';
            }).join('') + '</div>';
        } else {
            var subIdx = 0;
            subContent = Object.entries(subs).map(function(se) {
                var sub = se[0], szones = se[1];
                var result = '<div style="margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:10px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><input type="checkbox" class="sub-region-checkbox main-group-' + mainIdx + '" data-sub="' + mainIdx + '-' + subIdx + '" onchange="window.toggleSubRegionZones(' + mainIdx + ', ' + subIdx + ', this.checked)" style="width:14px;height:14px;cursor:pointer;"><span onclick="window.toggleAdminAccordion(\'sub-' + mainIdx + '-' + subIdx + '\')" style="font-size:0.85rem;color:#3b82f6;font-weight:600;cursor:pointer;">' + sub + '</span></div><div id="content-sub-' + mainIdx + '-' + subIdx + '" style="display:flex;flex-wrap:wrap;gap:6px;padding-left:24px;">' + szones.map(function(z) {
                    return '<label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;color:#cbd5e1;border:1px solid transparent;"><input type="checkbox" class="zone-checkbox main-group-' + mainIdx + ' sub-group-' + mainIdx + '-' + subIdx + '" value="' + z + '" style="margin-right:5px;" onchange="window.updateTargetCount()"> ' + z + '</label>';
                }).join('') + '</div></div>';
                subIdx++;
                return result;
            }).join('');
        }

        accordionHtml += '<div style="margin-bottom:10px;border:1px solid rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);"><div style="padding:12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;gap:10px;flex:1;"><input type="checkbox" class="main-region-checkbox" data-main="' + mainIdx + '" onchange="window.toggleMainRegionZones(' + mainIdx + ', this.checked)" style="width:16px;height:16px;cursor:pointer;"><span onclick="window.toggleAdminAccordion(\'main-' + mainIdx + '\')" style="font-weight:700;color:#fff;font-size:0.95rem;cursor:pointer;flex:1;">' + main + '</span></div><i class="fa-solid fa-chevron-down" id="icon-main-' + mainIdx + '" onclick="window.toggleAdminAccordion(\'main-' + mainIdx + '\')" style="font-size:0.8rem;transition:transform 0.2s;cursor:pointer;color:#94a3b8;padding:5px;"></i></div><div id="content-main-' + mainIdx + '" style="display:none;padding:10px;background:rgba(0,0,0,0.2);">' + subContent + '</div></div>';
        mainIdx++;
    });

    container.innerHTML = '<div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.08);"><div style="font-weight:600;color:#fff;margin-bottom:15px;font-size:1rem;display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-envelope"></i> 커스텀 알림 발송</div><div style="margin-bottom:15px;padding:12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;"><div style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="check-send-all-subscribers" onchange="window.toggleSendAllSubscribers(this.checked)" style="width:18px;height:18px;cursor:pointer;accent-color:#ef4444;"><label for="check-send-all-subscribers" style="cursor:pointer;font-size:0.95rem;color:#fca5a5;font-weight:700;"><i class="fa-solid fa-users" style="margin-right:6px;"></i>구독자 전원에게 발송</label><span style="font-size:0.75rem;color:#94a3b8;margin-left:auto;">(푸시 알림 허용 사용자 전체)</span></div></div><div id="zone-selection-area" style="margin-bottom:15px;"><label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:10px;">발송 대상 해역 선택 (Hierarchy)</label><div style="background:rgba(0,0,0,0.3);padding:15px;border-radius:12px;max-height:350px;overflow-y:auto;border:1px solid rgba(255,255,255,0.05);"><div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;"><input type="checkbox" id="check-all-zones" onchange="window.toggleAllZones(this.checked)" style="width:18px;height:18px;cursor:pointer;"><label for="check-all-zones" style="cursor:pointer;font-size:0.9rem;color:#fff;font-weight:700;">전체 해역 선택</label></div>' + accordionHtml + '</div></div><div style="margin-bottom:15px;"><label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 제목</label><input type="text" id="custom-push-title" placeholder="예: 🌊 긴급 해양 안전 안내" oninput="window.updateCustomPushPreview()" style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;box-sizing:border-box;outline:none;"></div><div style="margin-bottom:15px;"><label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 내용</label><textarea id="custom-push-content" placeholder="직접 작성하실 알림 내용을 입력해주세요." oninput="window.updateCustomPushPreview()" style="width:100%;height:100px;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;resize:none;box-sizing:border-box;outline:none;line-height:1.4;"></textarea><div style="text-align:right;font-size:0.75rem;color:#64748b;margin-top:4px;" id="custom-push-char-count">0 / 500자</div></div><div style="background:rgba(0,0,0,0.3);padding:20px;border-radius:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.05);"><div style="font-size:0.8rem;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Smartphone Preview</div><div style="background:#fff;border-radius:20px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);position:relative;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><div style="width:28px;height:28px;background:#1e293b;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;">🌊</div><div style="font-weight:800;color:#1e293b;font-size:0.95rem;flex:1;">SEA:GNAL</div><div style="font-size:0.75rem;color:#94a3b8;">지금</div></div><div id="preview-title" style="font-weight:800;margin-bottom:4px;color:#000;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">(제목 미리보기)</div><div id="preview-content" style="color:#475569;font-size:1rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">(내용 미리보기)</div></div></div><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:0.95rem;color:#cbd5e1;">발송 대상: <span style="font-weight:800;color:#3b82f6;" id="target-zone-count">0</span>개 구역</div><div style="display:flex;gap:12px;"><button onclick="window.switchAlertAdminTab(\'custom\')" style="padding:12px 20px;background:rgba(255,255,255,0.08);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">초기화</button><button onclick="window.confirmCustomPush()" style="padding:12px 28px;background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 20px rgba(239,68,68,0.3);">푸시 발송하기</button></div></div><div id="custom-push-confirm-overlay" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:100;border-radius:16px;backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:20px;"><div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:30px;width:100%;max-width:320px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);"><div style="font-size:3rem;margin-bottom:20px;">📢</div><div style="color:#fff;font-size:1.2rem;font-weight:700;margin-bottom:12px;">푸시 발송 최종 확인</div><div style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin-bottom:25px;">정말 <span id="confirm-target-text" style="color:#3b82f6;font-weight:700;"></span>으로<br>알림을 발송하시겠습니까?</div><div style="display:flex;gap:10px;"><button onclick="document.getElementById(\'custom-push-confirm-overlay\').style.display=\'none\'" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">취소</button><button id="final-send-btn" onclick="window.executeCustomPush()" style="flex:1;padding:12px;background:#ef4444;border:none;border-radius:10px;color:#fff;cursor:pointer;font-weight:700;">지금 발송</button></div></div></div></div>';
};

// ============================================================================
// (G) 발송 이력 탭
// ============================================================================
var historyFilter = { cat: 'all', type: 'all' };

window.renderHistoryTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
    try {
        var histRes = await fetch('/api/push-history');
        var history = histRes.ok ? await histRes.json() : [];
        var filtered = history.filter(function(h) {
            return (historyFilter.cat === 'all' || h.tab === historyFilter.cat) && (historyFilter.type === 'all' || h.type === historyFilter.type);
        });

        var categories = [
            { id: 'all', name: '전체' }, { id: 'publish', name: '발표' },
            { id: 'active', name: '발효' }, { id: 'release', name: '해제' },
            { id: 'level', name: '격상/격하' }, { id: 'custom', name: '직접 발송' }
        ];

        var catHtml = categories.map(function(c) {
            return '<button onclick="window.updateHistoryFilter(\'cat\', \'' + c.id + '\')" style="padding:6px 12px;border:none;border-radius:20px;background:' + (historyFilter.cat === c.id ? '#ef4444' : 'rgba(255,255,255,0.05)') + ';color:' + (historyFilter.cat === c.id ? '#fff' : '#94a3b8') + ';font-size:0.8rem;white-space:nowrap;cursor:pointer;font-weight:600;">' + c.name + '</button>';
        }).join('');

        var typeHtml = historyFilter.cat !== 'custom' ? '<div style="display:flex;gap:10px;margin-bottom:20px;padding-left:4px;">' + ['all', 'auto', 'manual'].map(function(t) {
            return '<label style="display:flex;align-items:center;gap:6px;color:' + (historyFilter.type === t ? '#fff' : '#64748b') + ';font-size:0.85rem;cursor:pointer;font-weight:600;"><input type="radio" name="hist-type" value="' + t + '" ' + (historyFilter.type === t ? 'checked' : '') + ' onchange="window.updateHistoryFilter(\'type\', \'' + t + '\')" style="width:14px;height:14px;cursor:pointer;"> ' + (t === 'all' ? '전체' : (t === 'auto' ? '자동' : '수동')) + '</label>';
        }).join('') + '</div>' : '';

        var itemsHtml = filtered.map(function(h) {
            return '<div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);position:relative;"><div style="position:absolute;top:14px;left:14px;"><input type="checkbox" class="hist-item-check" data-id="' + h.id + '" style="width:15px;height:15px;cursor:pointer;"></div><div style="margin-left:30px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#64748b;font-size:0.75rem;">' + h.time + '</span><div style="display:flex;gap:6px;"><span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;background:' + (h.type === 'manual' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)') + ';color:' + (h.type === 'manual' ? '#3b82f6' : '#22c55e') + ';">' + (h.type === 'manual' ? '👤 수동' : '🤖 자동') + '</span><button onclick="window.deleteSingleHistory(' + h.id + ')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-trash-can"></i></button></div></div><div style="color:#fff;font-weight:700;margin-bottom:4px;font-size:0.95rem;">' + h.title + '</div><div style="color:#94a3b8;font-size:0.85rem;line-height:1.4;margin-bottom:8px;">' + h.content + '</div><div style="font-size:0.7rem;color:#475569;background:rgba(0,0,0,0.2);padding:6px 10px;border-radius:6px;"><i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> 대상: ' + (h.target.length > 50 ? h.target.substring(0, 50) + '...' : h.target) + '</div></div></div>';
        }).join('');

        container.innerHTML = '<div style="margin-bottom:20px;"><div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05);">' + catHtml + '</div>' + typeHtml + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding:0 6px;"><div style="display:flex;gap:12px;align-items:center;"><input type="checkbox" id="hist-check-all" onchange="window.toggleAllHistoryChecks(this.checked)" style="width:16px;height:16px;cursor:pointer;"><label for="hist-check-all" style="color:#94a3b8;font-size:0.85rem;cursor:pointer;">전체 선택</label></div><button onclick="window.deleteSelectedHistory()" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600;">선택 삭제</button></div><div id="history-items-container">' + itemsHtml + (filtered.length === 0 ? '<div style="text-align:center;padding:50px;color:#64748b;">이력이 없습니다.</div>' : '') + '</div>' + (history.length > 0 ? '<div style="text-align:center;margin-top:20px;"><button onclick="window.clearAllHistory()" style="background:none;border:none;color:#64748b;font-size:0.8rem;text-decoration:underline;cursor:pointer;">전체 이력 초기화</button></div>' : '') + '</div>';
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">오류 발생: ' + e.message + '</div>';
    }
};

// ============================================================================
// (H) 이력 관리 헬퍼
// ============================================================================
window.updateHistoryFilter = function (key, val) {
    historyFilter[key] = val;
    if (historyFilter.cat === 'custom') historyFilter.type = 'all';
    var container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
    if (container) window.renderHistoryTab(container);
};

window.toggleAllHistoryChecks = function (checked) {
    document.querySelectorAll('.hist-item-check').forEach(function(cb) { cb.checked = checked; });
};

window.deleteSingleHistory = async function (id) {
    if (!confirm('해당 이력을 삭제하시겠습니까?')) return;
    try {
        var res = await fetch('/api/push-history/' + id, { method: 'DELETE' });
        if (res.ok) {
            var container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.deleteSelectedHistory = async function () {
    var checked = Array.from(document.querySelectorAll('.hist-item-check:checked')).map(function(cb) { return parseInt(cb.dataset.id); });
    if (checked.length === 0) return alert('삭제할 항목을 선택해주세요.');
    if (!confirm(checked.length + '개의 항목을 삭제하시겠습니까?')) return;
    try {
        var res = await fetch('/api/push-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: checked }) });
        if (res.ok) {
            var container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.clearAllHistory = async function () {
    if (!confirm('정말로 모든 발송 이력을 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    try {
        var res = await fetch('/api/push-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) {
            var container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

// ============================================================================
// (I) 직접 발송 UI 헬퍼
// ============================================================================
window.toggleMainRegionZones = function (mainIdx, checked) {
    document.querySelectorAll('.main-group-' + mainIdx).forEach(function(cb) { cb.checked = checked; });
    window.updateTargetCount();
};

window.toggleSubRegionZones = function (mainIdx, subIdx, checked) {
    document.querySelectorAll('.sub-group-' + mainIdx + '-' + subIdx).forEach(function(cb) { cb.checked = checked; });
    window.updateTargetCount();
};

window.toggleAdminAccordion = function (id) {
    var content = document.getElementById('content-' + id);
    var icon = document.getElementById('icon-' + id);
    if (!content) return;
    var isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (icon) {
        if (id.startsWith('main')) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        else icon.className = isHidden ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
    }
};

window.toggleSendAllSubscribers = function (checked) {
    var zoneArea = document.getElementById('zone-selection-area');
    if (zoneArea) {
        zoneArea.style.opacity = checked ? '0.3' : '1';
        zoneArea.style.pointerEvents = checked ? 'none' : 'auto';
    }
    var countEl = document.getElementById('target-zone-count');
    if (countEl) {
        countEl.textContent = checked ? '전원' : document.querySelectorAll('.zone-checkbox:checked').length;
    }
};

window.toggleAllZones = function (checked) {
    document.querySelectorAll('.zone-checkbox, .main-region-checkbox, .sub-region-checkbox').forEach(function(cb) { cb.checked = checked; });
    window.updateTargetCount();
};

window.updateTargetCount = function () {
    var checked = document.querySelectorAll('.zone-checkbox:checked');
    var el = document.getElementById('target-zone-count');
    if (el) el.textContent = checked.length;
};

window.updateCustomPushPreview = function () {
    var titleVal = document.getElementById('custom-push-title').value;
    var contentVal = document.getElementById('custom-push-content').value;
    var pt = document.getElementById('preview-title');
    var pc = document.getElementById('preview-content');
    var cc = document.getElementById('custom-push-char-count');
    if (pt) pt.textContent = titleVal || '(제목 미리보기)';
    if (pc) pc.textContent = contentVal || '(내용 미리보기)';
    if (cc) cc.textContent = contentVal.length + ' / 500자';
};

window.confirmCustomPush = function () {
    var title = document.getElementById('custom-push-title').value.trim();
    var content = document.getElementById('custom-push-content').value.trim();
    var checked = document.querySelectorAll('.zone-checkbox:checked');
    var allChecked = document.getElementById('check-all-zones').checked;
    var sendAllSubs = document.getElementById('check-send-all-subscribers').checked;
    if (!sendAllSubs && checked.length === 0 && !allChecked) { alert('발송 대상 해역을 선택해주세요.'); return; }
    if (!title || !content) { alert('제목과 내용을 입력해주세요.'); return; }
    document.getElementById('confirm-target-text').textContent = sendAllSubs ? '구독자 전원' : (allChecked ? '전체 해역' : (checked.length + '개 해역'));
    document.getElementById('custom-push-confirm-overlay').style.display = 'flex';
};

window.executeCustomPush = async function () {
    var title = document.getElementById('custom-push-title').value.trim();
    var content = document.getElementById('custom-push-content').value.trim();
    var checked = document.querySelectorAll('.zone-checkbox:checked');
    var allChecked = document.getElementById('check-all-zones').checked;
    var sendAllSubs = document.getElementById('check-send-all-subscribers').checked;
    var targetZones = sendAllSubs ? '구독자 전원' : (allChecked ? '전체 해역' : Array.from(checked).map(function(cb) { return cb.value; }).join(', '));

    var btn = document.getElementById('final-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 발송 중...';

    try {
        var response = await fetch('/api/push-custom', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title, content: content, targetZones: targetZones, sendToAllSubscribers: sendAllSubs })
        });
        var result = await response.json();
        if (result.success) { alert('✅ 푸시 발송 완료\n성공: ' + result.successCount + '건 / 실패: ' + result.failCount + '건'); window.switchAlertAdminTab('custom'); }
        else { alert('❌ 발송 실패: ' + (result.error || '알 수 없는 오류')); document.getElementById('custom-push-confirm-overlay').style.display = 'none'; }
    } catch (e) { alert('❌ 서버 통신 오류: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '지금 발송'; }
};
