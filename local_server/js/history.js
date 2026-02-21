/**
 * ============================================================================
 * 파일명: js/history.js
 * 역할: 폰트 크기 관리, 특보 이력, 수동 푸시, 마무리 유틸리티
 * ============================================================================
 *
 * [설명]
 * - FontSizeManager: 글꼴 크기 설정 (localStorage)
 * - 특보 이력 관리 시스템
 * - 수동 푸시 알림 발송
 * - 방문자 카운터, KMA iframe, SEAGNAL 모달 유틸
 * - DOMContentLoaded #3: 최종 이벤트 핸들러
 *
 * [로딩 순서] 15번째 (마지막 - admin_collect.js 이후)
 * ============================================================================
 */

// ============================================================================
// [New] 폰트 크기 설정 기능
// ============================================================================
const FontSizeManager = {
    STORAGE_KEY: 'user_font_size',

    // 폰트 크기 오프셋 (기존 반응형 크기에 더함)
    OFFSETS: {
        small: 0,    // 기존 반응형 그대로
        medium: 2,   // +2px
        large: 4     // +4px
    },

    // 현재 설정 가져오기
    get() {
        return localStorage.getItem(this.STORAGE_KEY) || 'medium';
    },

    // 설정 저장
    set(size) {
        if (!this.OFFSETS.hasOwnProperty(size)) size = 'medium';
        localStorage.setItem(this.STORAGE_KEY, size);
        this.apply(size);
    },

    // CSS 적용
    apply(size) {
        if (!size) size = this.get();
        const offset = this.OFFSETS[size] || 0;

        // 현재 뷰포트 기반 기본 폰트 크기 계산
        const viewportWidth = window.innerWidth;
        let baseFontSize;

        if (viewportWidth < 360) {
            baseFontSize = 13;
        } else if (viewportWidth < 400) {
            baseFontSize = 14;
        } else if (viewportWidth < 431) {
            baseFontSize = 15;
        } else {
            baseFontSize = 16;
        }

        // 오프셋 적용
        const finalFontSize = baseFontSize + offset;
        document.documentElement.style.fontSize = finalFontSize + 'px';

        // data 속성 추가 (디버깅용)
        document.documentElement.setAttribute('data-font-size', size);

        console.log(`[FontSize] 적용: ${size} (base: ${baseFontSize}px + offset: ${offset}px = ${finalFontSize}px)`);
    },

    // 설정 모달 UI 초기화
    initUI() {
        const radios = document.querySelectorAll('input[name="font-size"]');
        const current = this.get();

        radios.forEach(radio => {
            const content = radio.nextElementSibling;

            // 현재 값 반영
            if (radio.value === current) {
                radio.checked = true;
                if (content) {
                    content.style.background = 'var(--accent-blue)';
                    content.style.color = 'white';
                    content.classList.add('active');
                }
            } else {
                radio.checked = false;
                if (content) {
                    content.style.background = '';
                    content.style.color = '#ccc';
                    content.classList.remove('active');
                }
            }

            // 클릭 이벤트
            radio.addEventListener('change', () => {
                // 모든 라디오 스타일 초기화
                radios.forEach(r => {
                    const c = r.nextElementSibling;
                    if (c) {
                        c.style.background = '';
                        c.style.color = '#ccc';
                        c.classList.remove('active');
                    }
                });

                // 선택된 라디오 스타일 적용
                if (content) {
                    content.style.background = 'var(--accent-blue)';
                    content.style.color = 'white';
                    content.classList.add('active');
                }

                // 즉시 미리보기 적용
                this.apply(radio.value);
            });
        });
    },

    // 저장 (saveSettingsAndClose에서 호출)
    save() {
        const selected = document.querySelector('input[name="font-size"]:checked');
        if (selected) {
            this.set(selected.value);
        }
    }
};

// 페이지 로드 시 폰트 크기 적용
FontSizeManager.apply();

// 설정 모달 열릴 때 UI 초기화
const _originalOpenSettingsModal = window.openSettingsModal;
window.openSettingsModal = function () {
    if (_originalOpenSettingsModal) _originalOpenSettingsModal();
    setTimeout(() => FontSizeManager.initUI(), 100);
};

// 전역 노출
window.FontSizeManager = FontSizeManager;

// [Note] 특보 알림 상세 팝업 기능은 fix_popup_logic.js에서 처리하므로 삭제됨

// ============================================================================
// (D) 특보 알림 관리 (Alert Management)
// ============================================================================

// Mock Data Storage for Demo
let MOCK_ALERT_HISTORY = [];

function generateMockAlertHistory() {
    // Generate data based on the MD file scenarios
    const now = new Date();

    // 1. Publish (발표)
    MOCK_ALERT_HISTORY.push({
        id: 'pub_1',
        tab: 'publish', // also shown in general history
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'sent',
        pushTime: '15:30',
        title: '풍랑주의보 발표',
        zones: ['울산앞바다', '경북남부앞바다'],
        grade: 'warning',
        items: [
            { zone: '울산앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' },
            { zone: '경북남부앞바다', tmEf: '26.01.03 09:00', tmRl: '26.01.03 18:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'pub_2',
        tab: 'publish',
        type: 'auto',
        time: '26.01.03 07:00',
        pushStatus: 'pending',
        pushTime: null,
        title: '풍랑주의보 발표',
        zones: ['부산앞바다', '거제시동부앞바다'],
        grade: 'advisory',
        items: [
            { zone: '부산앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 20:00' },
            { zone: '거제시동부앞바다', tmEf: '26.01.03 10:00', tmRl: '26.01.03 22:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'act_1',
        tab: 'active',
        type: 'auto',
        time: '26.01.03 09:00',
        badge: 'active',
        pushStatus: 'sent',
        pushTime: '09:00',
        title: '풍랑경보 발효',
        zones: ['인천·경기북부앞바다'],
        grade: 'warning',
        items: [
            { zone: '인천·경기북부앞바다', tmRl: '26.01.03 18:00' }
        ]
    });

    MOCK_ALERT_HISTORY.push({
        id: 'lvl_1',
        tab: 'level',
        type: 'auto',
        time: '26.01.03 15:00',
        badge: 'upgrade',
        pushStatus: 'sent',
        pushTime: '15:00',
        title: '풍랑주의보 → 풍랑경보',
        zones: ['제주도북부앞바다'],
        grade: 'warning',
        items: [
            { zone: '제주도북부앞바다', tmRl: '26.01.03 22:00' }
        ]
    });

    // Custom History (Manually Sent)
    MOCK_ALERT_HISTORY.push({
        id: 'cust_1',
        tab: 'custom_history',
        type: 'manual',
        time: '26.01.03 15:30',
        pushStatus: 'sent',
        count: 245,
        target: '전남서부남해앞바다, 전남동부남해앞바다',
        title: '긴급 해양 안전 공지',
        content: '현재 남해 서부 해역에 강한 돌풍이 예상되오니 소형 선박은 안전한 곳으로 대피하시기 바랍니다.'
    });

    MOCK_ALERT_HISTORY.push({
        id: 'cust_2',
        tab: 'custom_history',
        type: 'manual',
        time: '26.01.02 09:00',
        pushStatus: 'sent',
        count: 512,
        target: '전체 해역',
        title: '시스템 점검 안내',
        content: '26.01.02 10:00 ~ 12:00 서비스 점검 예정입니다. 이용에 불편을 드려 죄송합니다.'
    });
}

// Generate once
generateMockAlertHistory();

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

    let activeTab = 'publish'; // default

    const modal = document.createElement('div');
    modal.id = 'alert-management-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);backdrop-filter:blur(4px);animation:fadeIn 0.2s;';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;width:95%;max-width:600px;max-height:85vh;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <!-- Header (Fixed) -->
            <div style="background:linear-gradient(135deg,#ef4444,#b91c1c);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;font-weight:700;display:flex;align-items:center;gap:10px;text-shadow:0 1px 2px rgba(0,0,0,0.2);">
                    <i class="fa-solid fa-tower-broadcast"></i> 해양특보 알림 관리
                </h3>
                <button onclick="document.getElementById('alert-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <!-- Tabs (Fixed & No Scroll) -->
            <div style="display:flex;background:rgba(0,0,0,0.2);padding:0;border-bottom:1px solid rgba(255,255,255,0.1);position:sticky;z-index:10;backdrop-filter:blur(10px);width:100%;">
                ${tabs.map(t => `
                    <button class="alert-admin-tab" 
                            data-tab="${t.id}"
                            onclick="window.switchAlertAdminTab('${t.id}')"
                            style="flex:1;padding:12px 2px;border:none;background:transparent;color:#94a3b8;cursor:pointer;font-weight:600;font-size:0.75rem;transition:all 0.2s;white-space:nowrap;border-bottom:2px solid transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;">
                         <i class="fa-solid ${t.icon}" style="font-size:0.9rem;"></i>
                         <span>${t.name}</span>
                    </button>
                `).join('')}
            </div>

            <!-- Content Area (Scrollable) -->
            <div id="alert-management-content" style="padding:20px;flex:1;overflow-y:auto;background:#0f172a;">
                <div style="text-align:center;padding:40px;color:#64748b;">
                    <i class="fa-solid fa-circle-notch fa-spin"></i> 데이터를 불러오는 중...
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Initial render
    window.switchAlertAdminTab(activeTab);
};

window.switchAlertAdminTab = function (tabId) {
    // Update tab styles
    document.querySelectorAll('.alert-admin-tab').forEach(btn => {
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

    // CONTENT RENDER
    window.renderAlertAdminContent(tabId);
};

window.renderAlertAdminContent = async function (tabId, targetContainer = null) {
    const container = targetContainer || document.getElementById('alert-management-content');
    if (!container) return;

    if (tabId === 'custom') {
        window.renderCustomPushTab(container);
        return;
    }
    if (tabId === 'history') {
        window.renderHistoryTab(container);
        return;
    }

    // 1. Fetch Push History for status verification
    let pushHistory = [];
    try {
        const hRes = await fetch('/api/push-history');
        if (hRes.ok) pushHistory = await hRes.json();
    } catch (e) { }

    // 2. Prepare Data
    // [수정] 해양특보 알림 관리에서는 메인 해역 특보만 취급 (연안바다/평수구역 제외)
    const allAlerts = [
        ...appState.alerts
    ].filter(a => !a.isCoastal && !a.zoneName.includes('연안바다') && !a.zoneName.includes('평수구역'));

    // Filter by Tab
    let filteredItems = [];
    if (tabId === 'publish') {
        // [수정] 발표 탭: 신규 발표(1)나 시각 변경(2)만 포함. 등급 변경(명령6 혹은 command:'변경')은 제외하여 격상 탭으로 유도.
        filteredItems = allAlerts.filter(a =>
            (a.isPreliminary || a.command === '1' || a.command === '발표' || a.command === '2' || a.command === '시각변경') &&
            !(a.command === '변경' || a.command === '변경발표' || a.command === '6')
        );
    } else if (tabId === 'active') {
        // [수정] 발효 탭: 해제(3)가 아닌 모든 데이터를 포함
        filteredItems = allAlerts.filter(a => a.command !== '3' && a.command !== '해제');
    } else if (tabId === 'release') {
        filteredItems = allAlerts.filter(a =>
            a.command === '3' ||
            a.command === '해제' ||
            (!a.isPreliminary && a.tmEd && a.tmEd.trim() !== '' && a.tmEd !== '정보 없음' && a.tmEd !== '미정' && !a.tmEd.includes('00일'))
        );
    } else if (tabId === 'level') {
        // [수정] 격상/격하 탭: command가 '변경'이거나 '6'인 모든 건(예정 포함)을 여기서 관리
        filteredItems = allAlerts.filter(a => a.command === '변경' || a.command === '변경발표' || a.command === '6');
    }

    // [추가] 데이터 무결성 보장: 동일 해역/특보에 대해 가장 최신 데이터(발표시각 기준)만 남김
    const uniqueAlertMap = new Map();
    filteredItems.forEach(item => {
        const uniqueKey = `${item.zoneName}_${item.warnType}_${item.level}`;
        const existing = uniqueAlertMap.get(uniqueKey);

        // 시간 비교를 위해 숫자만 추출
        const itemTime = String(item.tmFc || '').replace(/[^0-9]/g, '');
        const existingTime = existing ? String(existing.tmFc || '').replace(/[^0-9]/g, '') : '';

        if (!existing || itemTime > existingTime) {
            uniqueAlertMap.set(uniqueKey, item);
        }
    });
    const finalizedItems = Array.from(uniqueAlertMap.values());

    // 3. 1단계 그룹화 (시간 + 특보종류)
    const cardGroups = {};
    const nowStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace(/[-T:Z]/g, '').substring(0, 12);

    finalizedItems.forEach(item => {
        // 격상/격하 여부 판단
        const isLevelChange = item.command === '변경' || item.level?.includes('경보');
        const statusType = item.level?.includes('경보') ? '격상' : (item.level?.includes('주의보') && item.command === '변경' ? '격하' : '정규');

        // 날짜 정규화 함수 (비교용)
        const getCompareValue = (dStr) => {
            if (!dStr || dStr === '정보 없음' || dStr === '미정' || dStr.trim() === '일') return '999999999999';
            let numeric = dStr.replace(/[^0-9]/g, '');
            if (numeric.length === 12) return numeric;

            // 한글 포함 시각 (예: 06일 오전(09시~12시)) 처리
            const dayMatch = dStr.match(/(\d+)일/);
            const hourMatch = dStr.match(/\((\d+)시/);
            if (dayMatch) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = dayMatch[1].padStart(2, '0');
                // 범위의 시작 시각을 기준으로 비교 (09시~12시 -> 09시)
                const hour = hourMatch ? hourMatch[1].padStart(2, '0') : '00';
                return `${year}${month}${day}${hour}00`;
            }
            if (!numeric || numeric.length === 0) return '999999999999';
            return numeric.padEnd(12, '0');
        };

        const efCompare = getCompareValue(item.tmEf);
        const edCompare = getCompareValue(item.tmEd);

        // 실제 상황 판단 (현재 시점 기준)
        // [수정] 장부에서 '발표(upcoming)' 상태라면 시간이 지났어도 강제로 Active가 아닌 것으로 간주함
        const isActuallyActive = item.isPreliminary ? false : (efCompare <= nowStr);
        const isActuallyReleased = (item.isPreliminary || !isActuallyActive) ? false : (edCompare <= nowStr);

        // [핵심 로직] 탭별 대기/라이브 판단
        const isWaiting = tabId === 'release'
            ? (edCompare > nowStr)
            : (item.isPreliminary || efCompare > nowStr);

        const typeKey = `${item.warnType}${item.level}`;
        // [핵심 변경] 그룹 키에서 시각 제거하여 동일 특보 종류는 무조건 하나의 카드로 통합
        // [수정] 그룹 키에 시각 정보를 포함하여 동일한 종류라도 시각이 다르면 분리
        // (발표/발효/해제 시각을 모두 고려하여 유니크하게 분리)
        // [Primary Key] - Used for grouping cards
        // [Primary Key] - Used for grouping cards
        let primaryTime = item.tmFc; // Default (Publish/Level)
        if (tabId === 'active') primaryTime = item.tmEf; // Active tab uses tmEf
        else if (tabId === 'release') primaryTime = item.tmYn || item.tmEd || '정보 없음'; // Release tab uses Release Time

        const groupKey = `${statusType}_${typeKey}_${primaryTime}`;

        // [Sub Key] - Used for separating lists inside a card
        let subKey = 'default';
        if (tabId === 'publish') subKey = item.tmEf; // Split by Effective Time
        else if (tabId === 'active') subKey = item.tmEd || '정보 없음'; // Split by Release Time

        const isTimeChanged = item.command === '2' || item.command === '시각변경';

        // Time Validation & Format
        let headerTimeDisplay = isNaN(Number(primaryTime)) ? (primaryTime === '정보 없음' ? '해제 시각 미정' : primaryTime) : primaryTime;
        if (primaryTime && primaryTime.length === 12 && !isNaN(Number(primaryTime))) {
            headerTimeDisplay = `26.${primaryTime.substring(4, 6)}.${primaryTime.substring(6, 8)} ${primaryTime.substring(8, 10)}:${primaryTime.substring(10, 12)}`;
        }

        if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = {
                key: groupKey,
                headerTime: headerTimeDisplay,
                rawTime: primaryTime,
                tmFc: item.tmFc, // Keep for push log matching
                statusType: statusType,
                typeName: item.warnType,
                level: item.level,
                isPreliminary: item.isPreliminary,
                isTimeChanged: isTimeChanged,
                // [Fix] Add missing status flags to object
                isWaiting: isWaiting,
                isActuallyActive: isActuallyActive,
                isActuallyReleased: isActuallyReleased,
                // [Fix] isLevelChange를 group 객체에 추가 (push-history 매칭에서 참조됨)
                isLevelChange: isLevelChange,
                // [추가] 격상/격하 시 이전 등급 정보 (수동 발송용)
                // history에서 파생된 item.prevLevel이 있으면 우선 사용, 없으면 기존 추론 로직 유지
                prevLevel: item.prevLevel || (statusType === '격상' ? '주의보' : (statusType === '격하' ? '경보' : null)),
                prevTypeName: (statusType === '격상' || statusType === '격하') ? item.warnType : null,
                subGroups: {}
            };
        }

        if (!cardGroups[groupKey].subGroups[subKey]) {
            cardGroups[groupKey].subGroups[subKey] = {
                tmEf: item.tmEf,
                tmYn: item.tmEd,
                // Fix: Ensure tmFc is correctly assigned from item
                tmFc: item.tmFc,
                zones: []
            };
        }

        const fullName = item.zoneName.split('(')[0].trim();
        if (!cardGroups[groupKey].subGroups[subKey].zones.includes(fullName)) {
            cardGroups[groupKey].subGroups[subKey].zones.push(fullName);
        }
    });

    const sortedGroups = Object.values(cardGroups).sort((a, b) => {
        if (a.isWaiting !== b.isWaiting) return a.isWaiting ? 1 : -1;
        return String(b.rawTime).localeCompare(String(a.rawTime));
    });

    if (sortedGroups.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <i class="fa-solid fa-clipboard-check" style="font-size:3rem;margin-bottom:15px;opacity:0.3;"></i>
                <p style="font-size:1.1rem;font-weight:600;">현재 해당 탭의 특보 데이터가 없습니다.</p>
                <p style="font-size:0.85rem;margin-top:5px;">기상청 데이터가 수집되면 자동으로 타임라인이 형성됩니다.</p>
            </div>
        `;
        return;
    }

    let html = '';
    sortedGroups.forEach(group => {
        let timeDisplay = group.headerTime;
        const isSent = pushHistory.some(h => {
            // 탭 매칭
            const tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || h.tab.startsWith(tabId)));
            if (!tabMatch) return false;

            // [New] 기준시각(tmRef)이 있으면 우선 매칭 (자동 발송 시 심어짐)
            // 이제 groupKey가 시각별로 분리되었으므로 tmRef 비교가 정확해짐
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;

            // [Fallback] 기존 내용 기반 매칭 (수동 발송 등)
            // [수정] 종류와 시각뿐만 아니라 탭(tabId) 정보가 일치해야 함 (이미지 3 오판독 방지)
            const contentMatch = h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10));
            return contentMatch && (h.tab === tabId || h.tab?.startsWith(tabId));
        });

        const sentLog = isSent ? pushHistory.find(h => {
            const tabMatch = (group.isLevelChange ? h.tab === 'level' : (h.tab === tabId || h.tab?.startsWith(tabId)));
            if (!tabMatch) return false;
            if (h.tmRef && group.tmFc && h.tmRef === group.tmFc) return true;
            return h.content?.includes(group.typeName) && h.time?.includes(group.headerTime?.substring(4, 10));
        }) : null;

        const isAuto = sentLog?.type === 'auto';
        let statusText = '';
        const pushResult = isSent ? (isAuto ? '자동 발송완료' : '수동 발송완료') : '발송 대기';

        if (tabId === 'active' || tabId === 'level') {
            if (group.isTimeChanged) {
                statusText = `<span style="color:#38bdf8;"><i class="fa-solid fa-clock-rotate-left"></i> 시각 변경</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else if (group.isWaiting) {
                statusText = `<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기 중</span>`;
            } else if (group.isActuallyReleased) {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                let liveLabel = '발효 중';
                if (group.isLevelChange) {
                    liveLabel = `${group.level}로 ${group.statusType}`;
                }
                statusText = `<span style="color:#ef4444;"><i class="fa-solid fa-satellite-dish"></i> ${liveLabel}</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'release') {
            if (group.isWaiting) {
                statusText = `<span style="color:#10b981;"><i class="fa-solid fa-clock"></i> 해제 예정</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                statusText = `<span style="color:#22c55e;"><i class="fa-solid fa-check-double"></i> 해제 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else if (tabId === 'publish') {
            if (group.isActuallyActive) {
                statusText = `<span style="color:#22c55e;">발효 완료</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            } else {
                statusText = `<span style="color:#f59e0b;"><i class="fa-solid fa-hourglass-start"></i> 발효 대기</span> <span style="color:rgba(255,255,255,0.2);margin:0 5px;">|</span> <span style="color:${isSent ? '#22c55e' : '#94a3b8'};">${pushResult}</span>`;
            }
        } else {
            statusText = isSent ? '수동 발송완료' : '발송 대기';
        }

        const statusBadge = `<div style="font-size:0.75rem;font-weight:700;display:flex;align-items:center;">${statusText}</div>`;

        let displayLevel = group.level || '';
        if ((displayLevel === '예비' || group.isPreliminary) && (tabId === 'active' || tabId === 'release' || tabId === 'level' || tabId === 'publish')) {
            displayLevel = '주의보';
        }

        let tabSymbol = '🔔'; let tabLabel = '발표';
        if (tabId === 'active') { tabSymbol = '⚠️'; tabLabel = '발효'; }
        else if (tabId === 'release') { tabSymbol = '✅'; tabLabel = '해제'; }
        else if (tabId === 'level') {
            const isUp = (group.level || '').includes('경보');
            tabSymbol = isUp ? '🔺' : '🔻'; tabLabel = isUp ? '격상' : '격하';
            if (group.typeName.includes('태풍')) tabSymbol = '🌀';
        }

        const fullTitle = `${group.typeName}${displayLevel}`;
        const displayLabelText = (fullTitle.includes(tabLabel)) ? '' : tabLabel;

        html += `
            <div style="background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:12px;margin-bottom:18px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                <div style="padding:12px 16px;background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:0.85rem;font-weight:700;color:#cbd5e1;display:flex;align-items:center;">
                        <i class="fa-regular fa-calendar-check" style="margin-right:8px;"></i> ${timeDisplay}
                        <span style="color:rgba(255,255,255,0.1);margin:0 10px;">|</span>
                        ${statusBadge}
                    </div>
                    ${((tabId === 'active' || tabId === 'release' || tabId === 'level') && group.isWaiting) ? '' :
                (tabId === 'active' && group.isLevelChange) ? `
                        <div style="background:rgba(255,255,255,0.05);color:#64748b;padding:5px 12px;border-radius:6px;font-size:0.7rem;font-weight:700;border:1px solid rgba(255,255,255,0.05);">
                            격상/격하 탭에서 관리
                        </div>
                      ` : `
                        <button onclick="window.sendManualPushFromGroup('${group.key}', '${tabId}')" 
                                style="background:${isSent ? '#475569' : '#ef4444'};color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:0.75rem;font-weight:800;cursor:pointer;">
                            수동발송
                        </button>
                    `}
                </div>
                <div style="padding:16px;">
                    <div style="font-size:1.05rem; color:#fff; font-weight:800; margin-bottom:15px; display:flex; align-items:center; gap:8px;">
                        ${group.isTimeChanged ? '🕐' : tabSymbol} 
                        ${fullTitle} 
                        ${group.isTimeChanged ?
                (tabId === 'publish' ? '발효시각 변경' : '해제시각 변경') :
                (group.isWaiting && tabId === 'level' ? (group.statusType + ' 예정') : displayLabelText)}
                    </div>
                    ${(() => {
                // [해제] 탭인 경우: 모든 subGroups의 해역을 하나로 합쳐서 간단히 노출
                if (tabId === 'release') {
                    const allZones = [];
                    Object.values(group.subGroups).forEach(sub => {
                        sub.zones.forEach(z => {
                            if (!allZones.includes(z)) allZones.push(z);
                        });
                    });

                    return `
                                <div style="line-height:1.6;">
                                    <div style="color:#e2e8f0;font-size:0.85rem;font-weight:600;margin-bottom:4px;">
                                        ㅇ 대상해역(${allZones.length}): <span style="font-weight:400;color:#94a3b8;">${allZones.join(', ')}</span>
                                    </div>
                                </div>
                            `;
                }

                // [발표/발효/격상] 탭인 경우: subGroups(시간별) 순회하여 출력
                const keys = Object.keys(group.subGroups).sort();
                return keys.map(k => {
                    const sub = group.subGroups[k];
                    const uniqueZones = Array.from(new Set(sub.zones));
                    const zStr = uniqueZones.join(', ');
                    const count = uniqueZones.length;

                    let subInfo = '';
                    if (tabId === 'active') {
                        const ed = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">${ed}</span></div>`;
                    } else if (tabId === 'publish') {
                        const ef = typeof formatDate === 'function' ? formatDate(sub.tmEf) : sub.tmEf;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 발효예정: <span style="color:#fff;">${ef}</span></div>`;
                    } else if (tabId === 'level') {
                        const ed = typeof formatDate === 'function' ? formatDate(sub.tmYn) : sub.tmYn;
                        subInfo = `<div style="color:#94a3b8;font-size:0.85rem;margin-top:2px;">- 해제예정: <span style="color:#69f0ae;">${ed}</span></div>`;
                    }

                    return `
                                <div style="margin-bottom:12px; padding-bottom:12px; border-bottom:1px dashed rgba(255,255,255,0.1);">
                                    <div style="font-size:0.95rem; line-height:1.4;">
                                        <span style="color:#cbd5e1; font-weight:600;">ㅇ 대상해역(${count}):</span>
                                        <span style="color:#e2e8f0;">${zStr}</span>
                                    </div>
                                    ${subInfo}
                                </div>
                            `;
                }).join('');
            })()}
                </div>
            </div>
        `;
    });
    // [추가] 중요! 수동 발송을 위해 cardGroups 데이터를 전역에 저장 (sendManualPushFromGroup 에서 사용)
    window._currentAdminCardGroups = cardGroups;

    container.innerHTML = html;
};

// [수동 발송 핸들러]
window.sendManualPushFromGroup = async function (groupKey, tabId) {
    if (!confirm('해당 그룹의 시나리오 메시지를 정말 수동으로 발송하시겠습니까?')) return;

    // 1. 그룹 정보 조회
    const groups = window._currentAdminCardGroups;
    if (!groups || !groups[groupKey]) {
        return alert('오류: 그룹 정보를 찾을 수 없습니다. 페이지를 새로고침 해주세요.');
    }
    const group = groups[groupKey];

    // 2. 데이터 페이로드 구성 (서버에서 사용자별 필터링 후 텍스트 생성)
    // 텍스트 생성 로직(클라이언트)은 제거하고, 원본 데이터만 구조화하여 전송함.

    const typeName = group.typeName; // 예: 풍랑, 태풍
    const level = group.level || ''; // 예: 주의보, 경보

    // items 배열 생성: { zones: [], tmEf: '', tmEd: '', tmYn: '' }
    const items = Object.values(group.subGroups).map(sub => ({
        zones: sub.zones, // 배열 그대로 전송
        tmFc: group.headerTime?.replace(/[^0-9]/g, '') || '', // 발표시각
        tmEf: sub.tmEf,
        tmEd: sub.tmEd,
        tmYn: sub.tmEd // 서버 문구 생성기에서 사용하는 필드명(해제예정)으로도 전송
    }));

    // 3. 발송 요청 (Custom Push API)
    try {
        // 로딩 표시
        const btn = document.activeElement;
        const originalText = btn ? btn.innerText : '';
        if (btn) btn.innerText = '전송 중...';

        const res = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isManualGroupSend: true,
                payload: {
                    templateId: tabId === 'level'
                        ? (group.statusType === '격상'
                            ? (group.isWaiting ? 'level_upgrade_publish' : 'level_upgrade_active')
                            : (group.isWaiting ? 'level_downgrade_publish' : 'level_downgrade_active'))
                        : tabId, // active, release, publish
                    typeName: typeName,
                    level: level,
                    items: items,
                    isTimeChanged: group.isTimeChanged,
                    prevTypeName: group.prevTypeName || null,
                    prevLevel: group.prevLevel || null
                }
            })
        });

        if (res.ok) {
            alert('성공적으로 발송 요청되었습니다.');
            // UI 갱신 (해당 탭 다시 로드)
            window.switchAlertAdminTab(tabId);
        } else {
            const err = await res.text();
            alert('발송 실패: ' + err);
            if (btn) btn.innerText = originalText;
        }
    } catch (e) {
        alert('네트워크 오류: ' + e.message);
        const btn = document.activeElement;
        if (btn) btn.innerText = originalText;
    }
};

window.renderCustomPushTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    // Fetch real history
    let history = [];
    try {
        const histRes = await fetch('/api/push-history');
        if (histRes.ok) history = await histRes.json();
    } catch (e) {
        console.warn('History load fail, using empty.');
    }

    // Build regions object for accordion
    const regions = {};
    if (typeof SUB_REGION_ZONES !== 'undefined') {
        for (const [subName, zones] of Object.entries(SUB_REGION_ZONES)) {
            const mainName = typeof getMainRegion === 'function' ? getMainRegion(subName) : '기타';
            if (!regions[mainName]) regions[mainName] = {};
            regions[mainName][subName] = zones;
        }
    }

    let accordionHtml = '';
    Object.entries(regions).forEach(([main, subs], mainIdx) => {
        const isJeju = main.includes('제주');

        accordionHtml += `
            <div style="margin-bottom:10px;border:1px solid rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);">
                <div style="padding:12px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;">
                        <input type="checkbox" class="main-region-checkbox" data-main="${mainIdx}" 
                               onchange="window.toggleMainRegionZones(${mainIdx}, this.checked)"
                               style="width:16px;height:16px;cursor:pointer;">
                        <span onclick="window.toggleAdminAccordion('main-${mainIdx}')" style="font-weight:700;color:#fff;font-size:0.95rem;cursor:pointer;flex:1;">${main}</span>
                    </div>
                    <i class="fa-solid fa-chevron-down" id="icon-main-${mainIdx}" onclick="window.toggleAdminAccordion('main-${mainIdx}')" style="font-size:0.8rem;transition:transform 0.2s;cursor:pointer;color:#94a3b8;padding:5px;"></i>
                </div>
                <div id="content-main-${mainIdx}" style="display:none;padding:10px;background:rgba(0,0,0,0.2);">
                    ${isJeju ? `
                        <!-- 제주 특화: 중분류 없이 바로 소해구 목록 -->
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            ${Object.values(subs)[0].map(z => `
                                <label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.85rem;color:#cbd5e1;border:1px solid rgba(255,255,255,0.05);">
                                    <input type="checkbox" class="zone-checkbox main-group-${mainIdx}" value="${z}" style="margin-right:6px;" onchange="window.updateTargetCount()"> ${z}
                                </label>
                            `).join('')}
                        </div>
                    ` : Object.entries(subs).map(([sub, zones], subIdx) => `
                        <div style="margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.03);padding-bottom:10px;">
                            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                                <input type="checkbox" class="sub-region-checkbox main-group-${mainIdx}" data-sub="${mainIdx}-${subIdx}"
                                       onchange="window.toggleSubRegionZones(${mainIdx}, ${subIdx}, this.checked)"
                                       style="width:14px;height:14px;cursor:pointer;">
                                <span onclick="window.toggleAdminAccordion('sub-${mainIdx}-${subIdx}')" style="font-size:0.85rem;color:#3b82f6;font-weight:600;cursor:pointer;">${sub}</span>
                            </div>
                            <div id="content-sub-${mainIdx}-${subIdx}" style="display:flex;flex-wrap:wrap;gap:6px;padding-left:24px;">
                                ${zones.map(z => `
                                    <label style="display:inline-flex;align-items:center;background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.8rem;color:#cbd5e1;border:1px solid transparent;">
                                        <input type="checkbox" class="zone-checkbox main-group-${mainIdx} sub-group-${mainIdx}-${subIdx}" value="${z}" style="margin-right:5px;" onchange="window.updateTargetCount()"> ${z}
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:600;color:#fff;margin-bottom:15px;font-size:1rem;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-envelope"></i> 커스텀 알림 발송
            </div>
            
            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:10px;">발송 대상 해역 선택 (Hierarchy)</label>
                <div style="background:rgba(0,0,0,0.3);padding:15px;border-radius:12px;max-height:350px;overflow-y:auto;border:1px solid rgba(255,255,255,0.05);">
                    <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
                        <input type="checkbox" id="check-all-zones" onchange="window.toggleAllZones(this.checked)" 
                               style="width:18px;height:18px;cursor:pointer;">
                        <label for="check-all-zones" style="cursor:pointer;font-size:0.9rem;color:#fff;font-weight:700;">전체 해역 선택</label>
                    </div>
                    ${accordionHtml}
                </div>
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 제목</label>
                <input type="text" id="custom-push-title" placeholder="예: 🌊 긴급 해양 안전 안내" 
                       oninput="window.updateCustomPushPreview()"
                       style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;box-sizing:border-box;outline:none;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;">알림 내용</label>
                <textarea id="custom-push-content" placeholder="직접 작성하실 알림 내용을 입력해주세요." 
                          oninput="window.updateCustomPushPreview()"
                          style="width:100%;height:100px;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;resize:none;box-sizing:border-box;outline:none;line-height:1.4;"></textarea>
                <div style="text-align:right;font-size:0.75rem;color:#64748b;margin-top:4px;" id="custom-push-char-count">0 / 500자</div>
            </div>

            <!-- 미리보기 (Fixed Layout) -->
            <div style="background:rgba(0,0,0,0.3);padding:20px;border-radius:16px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Smartphone Preview</div>
                <div style="background:#fff;border-radius:20px;padding:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);position:relative;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <div style="width:28px;height:28px;background:#1e293b;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;">🌊</div>
                        <div style="font-weight:800;color:#1e293b;font-size:0.95rem;flex:1;">SEA:GNAL</div>
                        <div style="font-size:0.75rem;color:#94a3b8;">지금</div>
                    </div>
                    <div id="preview-title" style="font-weight:800;margin-bottom:4px;color:#000;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">(제목 미리보기)</div>
                    <div id="preview-content" style="color:#475569;font-size:1rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">(내용 미리보기)</div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="font-size:0.95rem;color:#cbd5e1;">발송 대상: <span style="font-weight:800;color:#3b82f6;" id="target-zone-count">0</span>개 구역</div>
                <div style="display:flex;gap:12px;">
                    <button onclick="window.switchAlertAdminTab('custom')" style="padding:12px 20px;background:rgba(255,255,255,0.08);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">초기화</button>
                    <button onclick="window.confirmCustomPush()" style="padding:12px 28px;background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;border-radius:10px;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 20px rgba(239,68,68,0.3);">푸시 발송하기</button>
                </div>
            </div>
            
            <!-- Custom Confirm Overlay -->
            <div id="custom-push-confirm-overlay" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:100;border-radius:16px;backdrop-filter:blur(8px);align-items:center;justify-content:center;padding:20px;">
                <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:30px;width:100%;max-width:320px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="font-size:3rem;margin-bottom:20px;">📢</div>
                    <div style="color:#fff;font-size:1.2rem;font-weight:700;margin-bottom:12px;">푸시 발송 최종 확인</div>
                    <div style="color:#94a3b8;font-size:0.9rem;line-height:1.6;margin-bottom:25px;">
                        정말 <span id="confirm-target-text" style="color:#3b82f6;font-weight:700;"></span>으로<br>알림을 발송하시겠습니까?
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="document.getElementById('custom-push-confirm-overlay').style.display='none'" style="flex:1;padding:12px;background:rgba(255,255,255,0.05);border:none;border-radius:10px;color:#cbd5e1;cursor:pointer;font-weight:600;">취소</button>
                        <button id="final-send-btn" onclick="window.executeCustomPush()" style="flex:1;padding:12px;background:#ef4444;border:none;border-radius:10px;color:#fff;cursor:pointer;font-weight:700;">지금 발송</button>
                    </div>
                </div>
            </div>
        </div>
    `;
};

// [History State]
let historyFilter = { cat: 'all', type: 'all' };

window.renderHistoryTab = async function (container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    try {
        const histRes = await fetch('/api/push-history');
        const history = histRes.ok ? await histRes.json() : [];

        // Apply Filters
        const filtered = history.filter(h => {
            const catMatch = historyFilter.cat === 'all' || h.tab === historyFilter.cat;
            const typeMatch = historyFilter.type === 'all' || h.type === historyFilter.type;
            return catMatch && typeMatch;
        });

        const categories = [
            { id: 'all', name: '전체' },
            { id: 'publish', name: '발표' },
            { id: 'active', name: '발효' },
            { id: 'release', name: '해제' },
            { id: 'level', name: '격상/격하' },
            { id: 'custom', name: '직접 발송' }
        ];

        let html = `
            <div style="margin-bottom:20px;">
                <!-- Level 1: Category Filter -->
                <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05);">
                    ${categories.map(c => `
                        <button onclick="window.updateHistoryFilter('cat', '${c.id}')" 
                                style="padding:6px 12px;border:none;border-radius:20px;background:${historyFilter.cat === c.id ? '#ef4444' : 'rgba(255,255,255,0.05)'};color:${historyFilter.cat === c.id ? '#fff' : '#94a3b8'};font-size:0.8rem;white-space:nowrap;cursor:pointer;font-weight:600;">
                            ${c.name}
                        </button>
                    `).join('')}
                </div>

                <!-- Level 2: Type Filter (Auto/Manual) -->
                ${historyFilter.cat !== 'custom' ? `
                    <div style="display:flex;gap:10px;margin-bottom:20px;padding-left:4px;">
                        ${['all', 'auto', 'manual'].map(t => `
                            <label style="display:flex;align-items:center;gap:6px;color:${historyFilter.type === t ? '#fff' : '#64748b'};font-size:0.85rem;cursor:pointer;font-weight:600;">
                                <input type="radio" name="hist-type" value="${t}" ${historyFilter.type === t ? 'checked' : ''} 
                                       onchange="window.updateHistoryFilter('type', '${t}')"
                                       style="width:14px;height:14px;cursor:pointer;"> 
                                ${t === 'all' ? '전체' : (t === 'auto' ? '자동' : '수동')}
                            </label>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- Management Controls -->
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding:0 6px;">
                    <div style="display:flex;gap:12px;align-items:center;">
                        <input type="checkbox" id="hist-check-all" onchange="window.toggleAllHistoryChecks(this.checked)" style="width:16px;height:16px;cursor:pointer;">
                        <label for="hist-check-all" style="color:#94a3b8;font-size:0.85rem;cursor:pointer;">전체 선택</label>
                    </div>
                    <button onclick="window.deleteSelectedHistory()" style="padding:6px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:6px;font-size:0.8rem;cursor:pointer;font-weight:600;">선택 삭제</button>
                </div>

                <!-- History List -->
                <div id="history-items-container">
                    ${filtered.map(h => `
                        <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);position:relative;">
                            <div style="position:absolute;top:14px;left:14px;">
                                <input type="checkbox" class="hist-item-check" data-id="${h.id}" style="width:15px;height:15px;cursor:pointer;">
                            </div>
                            <div style="margin-left:30px;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                                    <span style="color:#64748b;font-size:0.75rem;">${h.time}</span>
                                    <div style="display:flex;gap:6px;">
                                        <span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;background:${h.type === 'manual' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)'};color:${h.type === 'manual' ? '#3b82f6' : '#22c55e'};">
                                            ${h.type === 'manual' ? '👤 수동' : '🤖 자동'}
                                        </span>
                                        <button onclick="window.deleteSingleHistory(${h.id})" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-trash-can"></i></button>
                                    </div>
                                </div>
                                <div style="color:#fff;font-weight:700;margin-bottom:4px;font-size:0.95rem;">${h.title}</div>
                                <div style="color:#94a3b8;font-size:0.85rem;line-height:1.4;margin-bottom:8px;">${h.content}</div>
                                <div style="font-size:0.7rem;color:#475569;background:rgba(0,0,0,0.2);padding:6px 10px;border-radius:6px;">
                                    <i class="fa-solid fa-location-dot" style="margin-right:4px;"></i> 대상: ${h.target.length > 50 ? h.target.substring(0, 50) + '...' : h.target}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    ${filtered.length === 0 ? '<div style="text-align:center;padding:50px;color:#64748b;">이력이 없습니다.</div>' : ''}
                </div>
                
                ${history.length > 0 ? `
                    <div style="text-align:center;margin-top:20px;">
                        <button onclick="window.clearAllHistory()" style="background:none;border:none;color:#64748b;font-size:0.8rem;text-decoration:underline;cursor:pointer;">전체 이력 초기화</button>
                    </div>
                ` : ''}
            </div>
        `;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#ef4444;">오류 발생: ${e.message}</div>`;
    }
};

window.updateHistoryFilter = function (key, val) {
    historyFilter[key] = val;
    // If category is custom, type must be manual/all (but custom is always manual)
    if (historyFilter.cat === 'custom') historyFilter.type = 'all';

    // [Fix] 통합 관리자 센터 대응: 두 가지 가능한 ID를 모두 체크
    const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
    if (container) window.renderHistoryTab(container);
};

window.toggleAllHistoryChecks = function (checked) {
    document.querySelectorAll('.hist-item-check').forEach(cb => cb.checked = checked);
};

window.deleteSingleHistory = async function (id) {
    if (!confirm('해당 이력을 삭제하시겠습니까?')) return;
    try {
        const res = await fetch(`/api/push-history/${id}`, { method: 'DELETE' });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.deleteSelectedHistory = async function () {
    const checked = Array.from(document.querySelectorAll('.hist-item-check:checked')).map(cb => parseInt(cb.dataset.id));
    if (checked.length === 0) return alert('삭제할 항목을 선택해주세요.');
    if (!confirm(`${checked.length}개의 항목을 삭제하시겠습니까?`)) return;

    try {
        const res = await fetch('/api/push-history', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: checked })
        });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.clearAllHistory = async function () {
    if (!confirm('정말로 모든 발송 이력을 영구적으로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    try {
        const res = await fetch('/api/push-history', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        if (res.ok) {
            const container = document.getElementById('alert-admin-inner-content') || document.getElementById('alert-management-content');
            if (container) window.renderHistoryTab(container);
        }
    } catch (e) { alert('삭제 실패: ' + e.message); }
};

window.toggleMainRegionZones = function (mainIdx, checked) {
    document.querySelectorAll(`.main-group-${mainIdx}`).forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.toggleSubRegionZones = function (mainIdx, subIdx, checked) {
    document.querySelectorAll(`.sub-group-${mainIdx}-${subIdx}`).forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.toggleAdminAccordion = function (id) {
    const content = document.getElementById('content-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!content) return;

    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (icon) {
        if (id.startsWith('main')) {
            icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        } else {
            icon.className = isHidden ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
        }
    }
};

window.toggleAllZones = function (checked) {
    document.querySelectorAll('.zone-checkbox, .main-region-checkbox, .sub-region-checkbox').forEach(cb => {
        cb.checked = checked;
    });
    window.updateTargetCount();
};

window.updateTargetCount = function () {
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const targetCountEl = document.getElementById('target-zone-count');
    if (targetCountEl) targetCountEl.textContent = checked.length;
};

window.updateCustomPushPreview = function () {
    const titleVal = document.getElementById('custom-push-title').value;
    const contentVal = document.getElementById('custom-push-content').value;

    const previewTitle = document.getElementById('preview-title');
    const previewContent = document.getElementById('preview-content');
    const charCount = document.getElementById('custom-push-char-count');

    if (previewTitle) previewTitle.textContent = titleVal || '(제목 미리보기)';
    if (previewContent) previewContent.textContent = contentVal || '(내용 미리보기)';
    if (charCount) charCount.textContent = `${contentVal.length} / 500자`;
};

window.confirmCustomPush = function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;

    if (checked.length === 0 && !allChecked) {
        alert('발송 대상 해역을 선택해주세요.');
        return;
    }
    if (!title || !content) {
        alert('제목과 내용을 입력해주세요.');
        return;
    }

    const targetText = allChecked ? '전체 해역' : `${checked.length}개 해역`;
    document.getElementById('confirm-target-text').textContent = targetText;
    document.getElementById('custom-push-confirm-overlay').style.display = 'flex';
};

window.executeCustomPush = async function () {
    const title = document.getElementById('custom-push-title').value.trim();
    const content = document.getElementById('custom-push-content').value.trim();
    const checked = document.querySelectorAll('.zone-checkbox:checked');
    const allChecked = document.getElementById('check-all-zones').checked;
    const targetZones = allChecked ? '전체 해역' : Array.from(checked).map(cb => cb.value).join(', ');

    const btn = document.getElementById('final-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 발송 중...';

    try {
        const response = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, targetZones })
        });
        const result = await response.json();

        if (result.success) {
            alert(`✅ 푸시 발송 완료\n성공: ${result.successCount}건 / 실패: ${result.failCount}건`);
            window.switchAlertAdminTab('custom');
        } else {
            alert('❌ 발송 실패: ' + (result.error || '알 수 없는 오류'));
            document.getElementById('custom-push-confirm-overlay').style.display = 'none';
        }
    } catch (e) {
        alert('❌ 서버 통신 오류: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '지금 발송';
    }
};

// (Redundant declarations removed)


// ============================================================================
// [�ű�] �湮�� ī���� UI ������Ʈ
// ============================================================================
window.updateVisitorStats = async function () {
    try {
        // [수정] 세션당 1회만 카운트를 증가시키도록 로직 개선
        const hasVisited = sessionStorage.getItem('v1_visited');
        const url = hasVisited ? '/api/visit?inc=false' : '/api/visit';

        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        // 처음 방문(카운트 증가)인 경우 세션에 기록
        if (!hasVisited) {
            sessionStorage.setItem('v1_visited', 'true');
        }

        const todayEl = document.getElementById('today-count');
        const totalEl = document.getElementById('total-count');

        if (todayEl) todayEl.textContent = data.today.toLocaleString();
        if (totalEl) totalEl.textContent = data.total.toLocaleString();
    } catch (e) {
        console.error('Failed to update visitor stats:', e);
    }
};

// ============================================================================
// [신규] 수집 실패 시 헤더 방문자 카운터 경고 표시
// ============================================================================
window.markVisitorCounterError = function (hasError) {
    const counter = document.querySelector('.visitor-counter');
    if (!counter) return;
    const counts = counter.querySelectorAll('.vc-count');
    const labels = counter.querySelectorAll('.vc-label');
    const dot = counter.querySelector('.vc-dot');
    if (hasError) {
        counts.forEach(el => el.style.color = '#ef4444');
        labels.forEach(el => el.style.color = '#fca5a5');
        if (dot) dot.style.color = '#ef4444';
        counter.title = '수집 실패 통보문이 있습니다. 관리자 센터를 확인하세요.';
    } else {
        counts.forEach(el => el.style.color = '');
        labels.forEach(el => el.style.color = '');
        if (dot) dot.style.color = '';
        counter.title = '';
    }
};

// 페이지 로드 시 수집 실패 여부 확인하여 헤더에 반영
window.checkCollectFailures = async function () {
    try {
        const res = await fetch('/api/admin/collect-failures');
        if (!res.ok) return;
        const failures = await res.json();
        if (failures && failures.length > 0) {
            markVisitorCounterError(true);
        }
    } catch (e) { /* 무시 */ }
};

// [Final Cleanup] 헤더 로고의 좀비 리스너 제거 및 관리자 트리거 방지
document.addEventListener('DOMContentLoaded', () => {
    const headerContent = document.querySelector('.header-content');
    if (headerContent) {
        // 기존 리스너(addEventListener로 추가된 것들) 제거를 위해 복제 후 교체
        const newHeader = headerContent.cloneNode(true);
        headerContent.parentNode.replaceChild(newHeader, headerContent);

        // 새로 교체된 헤더에 호버 힌트만 추가 (관리자 연타 안내 제거)
        newHeader.setAttribute('title', '전체 데이터 새로고침');
    }
});

// 헤더 클릭 시 기상정보 탭 이동 + 데이터 새로고침
window.handleHeaderRefresh = function () {
    console.log('🔄 헤더 클릭: 기상정보 탭 전환 + 전체 데이터 새로고침');
    if (typeof window.switchMainTab === 'function') {
        window.switchMainTab('weather-alert-section');
    }
    fetchAllData();
    if (typeof renderMarineWeatherStatus === 'function') renderMarineWeatherStatus();
};

/**
 * [추가] 기상청 링크 클릭 핸들러 (모바일 앱 대응)
 * 앱 환경이면 팝업창으로, 웹이면 새 창으로 열기
 */
window.handleKmaLinkClick = function (event, url, title) {
    // 모바일 네이티브 플랫폼(Android 등)인지 확인
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        event.preventDefault(); // 기본 링크 이동 방지
        window.openKmaIframeModal(url, title);
        return false;
    }
    return true; // 일반 웹 브라우저는 target="_blank"로 열림
};

/**
 * 기상청 전용 아이프레임 모달 열기
 */
window.openKmaIframeModal = function (url, title) {
    // 기존 모달 제거
    const existing = document.getElementById('kma-iframe-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'kma-iframe-modal';
    modal.className = 'kma-iframe-modal';
    modal.innerHTML = `
        <div class="kma-iframe-overlay" onclick="window.closeKmaIframeModal()"></div>
        <div class="kma-iframe-content">
            <div class="kma-iframe-header">
                <h3><i class="fa-solid fa-cloud-sun"></i> ${title} - 기상청</h3>
                <button class="kma-iframe-close" onclick="window.closeKmaIframeModal()">✕</button>
            </div>
            <div class="kma-iframe-body">
                <iframe src="${url}" frameborder="0" allowfullscreen></iframe>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
};

/**
 * 기상청 아이프레임 모달 닫기
 */
window.closeKmaIframeModal = function () {
    const modal = document.getElementById('kma-iframe-modal');
    if (modal) {
        modal.classList.add('fade-out'); // 애니메이션 위해 클래스 추가 (선택사항)
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 150);
    }
};

/**
 * SEAGNAL 커스텀 시스템 모달 (Alert 대체용)
 */
window.showSeagnalModal = function (title, message, type = 'info') {
    // 기존 모달 제거
    const existing = document.getElementById('seagnal-custom-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'seagnal-custom-modal';
    modal.className = 'seagnal-modal';

    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    const iconClass = type === 'error' ? 'error' : '';

    modal.innerHTML = `
        <div class="seagnal-modal-overlay" onclick="window.closeSeagnalModal()"></div>
        <div class="seagnal-modal-content">
            <div class="seagnal-modal-icon ${iconClass}">
                <i class="fa-solid ${icon}"></i>
            </div>
            <div class="seagnal-modal-title">${title}</div>
            <div class="seagnal-modal-message">${message.replace(/\n/g, '<br>')}</div>
            <button class="seagnal-modal-btn" onclick="window.closeSeagnalModal()">확인</button>
        </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
};

window.closeSeagnalModal = function () {
    const modal = document.getElementById('seagnal-custom-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
};

