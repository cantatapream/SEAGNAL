/**
 * ============================================================================
 * 파일명: js/settings.js
 * 역할: 탭 시스템, 스타일 주입, 사용자 설정, 알림 설정, 위치 기반 검색
 * ============================================================================
 *
 * [설명]
 * - initTabs(): 탭 전환 로직
 * - injectTabStyles(), injectGlobalStyles(): 동적 CSS 주입
 * - UserSettings: 관심 해역 필터링 (localStorage)
 * - NotificationSettings: 푸시 알림 구독 설정
 * - FontSizeManager: 글꼴 크기 조절
 * - findSeaZone(), findNearestZone(): 위치 기반 해역 검색
 *
 * [로딩 순서] 8번째 (marine.js 이후)
 * ============================================================================
 */

function initTabs() {
    // 탭 스타일 주입
    injectTabStyles();

    // 메인 탭 이벤트 바인딩
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            window.switchMainTab(targetId);
        });
    });

    // 서브 탭 이벤트 바인딩
    const subTabs = document.querySelectorAll('.sub-tab-btn');
    subTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            window.switchSubTab(targetId);
        });
    });
}

function injectTabStyles() {
    if (document.getElementById('tab-styles')) return;

    const style = document.createElement('style');
    style.id = 'tab-styles';
    style.textContent = `
        /* 헤더 내부 탭 배치 */
        .main-header {
            padding-bottom: 0 !important;
        }
        
        .main-tabs {
            display: flex;
            justify-content: space-around;
            background: rgba(26, 26, 26, 0.95);
            border-top: 1px solid #333;
            border-bottom: 2px solid #333;
            margin: 7.5px 0 0 0;
            padding: 0;
        }
        .tab-btn {
            flex: 1;
            background: transparent;
            border: none;
            color: #888;
            padding: 7.5px 10px;
            font-size: 0.95rem;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            transition: all 0.3s ease;
            font-family: 'Noto Sans KR', sans-serif;
        }
        .tab-btn:hover {
            color: #fff;
            background: rgba(52, 152, 219, 0.05);
        }
        .tab-btn.active {
            color: #fff;
            border-bottom: 3px solid #3498db;
            font-weight: 700;
            background: rgba(52, 152, 219, 0.1);
        }
        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease-out;
        }
        .tab-content.active {
            display: block;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* 섹션 스타일 통일 */
        .alert-status-section,
        .sea-zone-section {
            background: transparent;
            padding: 0;
            margin: 0;
            border: none;
        }
        
        /* 지도 컨테이너 스타일 */
        .sea-zone-map-container {
            background: transparent;
            padding: 0;
            margin: 20px 0;
        }
        
        /* 지도 출처 정보 */
        .map-source {
            text-align: center;
            margin-top: 10px;
            padding: 8px 0;
        }
        .map-source a {
            color: #8b949e;
            text-decoration: none;
            font-size: 0.85rem;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: color 0.2s;
        }
        .map-source a:hover {
            color: #3498db;
        }
        .map-source i {
            font-size: 0.75rem;
        }
        
        /* 구역 클릭 안내 메시지 애니메이션 */
        @keyframes slideUpFade {
            0% { 
                opacity: 0; 
                transform: translateY(15px);
            }
            15% { 
                opacity: 1; 
                transform: translateY(0);
            }
            85% { 
                opacity: 1; 
                transform: translateY(0);
            }
            100% { 
                opacity: 0; 
                transform: translateY(-10px);
            }
        }
    `;
    document.head.appendChild(style);
}

// ----------------------------------------------------------------------------
// Initialization
// ----------------------------------------------------------------------------

// [Fix] 모바일 UI 개선을 위한 전역 스타일 주입
function injectGlobalStyles() {
    if (document.getElementById('mobile-ui-fix-style')) return;
    const style = document.createElement('style');
    style.id = 'mobile-ui-fix-style';
    style.innerHTML = `
        /* [Mobile UI Fix] 뱃지 및 헤더 밀림 방지 */
        .status-badge {
            white-space: nowrap !important; /* 뱃지 텍스트 줄바꿈 방지 (덩어리로 넘기기) */
        }
        .main-accordion-header {
            flex-wrap: wrap !important; /* 헤더 줄바꿈 허용 */
            gap: 8px !important;
            align-items: center !important;
            height: auto !important; /* 높이 유동적 */
            padding-bottom: 12px !important; /* 줄바꿈 시 여백 확보 */
            padding-top: 12px !important;
        }
        .header-status {
            margin-left: auto !important; /* 우측 정렬 */
            justify-content: flex-end !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 5px !important;
        }
        .section-title {
            white-space: nowrap !important; /* 제목 텍스트 줄바꿈 방지 */
            margin-right: 8px !important; /* 제목과 뱃지 사이 간격 */
            max-width: 100%; /* 너무 길면 말줄임 등 처리 여지 */
        }
        .alert-header {
            flex-wrap: wrap !important; /* 카드 헤더 줄바꿈 허용 */
            align-items: center !important;
            gap: 8px !important;
        }
        .alert-badges {
            justify-content: flex-end !important; /* 뱃지 우측 정렬 */
            margin-left: auto !important;
            flex-wrap: wrap !important;
        }
        /* 뱃지가 다음 줄로 넘어갔을 때 간격 조정 */
        .alert-badges:empty {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
}

// [Fix] 중복 DOMContentLoaded 방지 플래그 - 아래 7904번째 줄에 동일한 핸들러가 있으므로
// 이 핸들러에서는 fetchAllData를 호출하지 않고 초기화 작업만 수행
window.addEventListener('DOMContentLoaded', async () => {
    injectGlobalStyles(); // [Fix] 스타일 주입 호출
    initTabs(); // 탭 초기화
    // [이동됨] updateTimeDisplay 호출은 app_init.js에서 1초 간격으로 관리
    if (typeof updateTimeDisplay === 'function') updateTimeDisplay();

    // [Preload] 메인 로딩 완료 후 해구 지도 이미지를 백그라운드에서 미리 로드
    // requestIdleCallback 사용으로 메인 UI 렌더링을 방해하지 않음
    if (window.requestIdleCallback) {
        requestIdleCallback(() => {
            if (window.preloadSeaZoneImage) window.preloadSeaZoneImage();
        });
    } else {
        setTimeout(() => {
            if (window.preloadSeaZoneImage) window.preloadSeaZoneImage();
        }, 1000);
    }
});

window.toggleSection = toggleSection;
window.refreshData = fetchAllData;


// --- 이하: 사용자 설정, 알림, 위치 기반 (L5793-6546) ---

// ============================================================================
// ⚙️ 사용자 설정 (User Settings) - 관심 해역 필터링
// ============================================================================

const UserSettings = {
    STORAGE_KEY: 'weatherAppSettings_v1',
    settings: {}, // { '구역명': boolean } (true: 표시, false: 미표출)

    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                this.settings = JSON.parse(saved);
            }
        } catch (e) {
            // console.error('Settings load failed:', e);
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
        } catch (e) {
            // console.error('Settings save failed:', e);
        }
    },

    // 해당 구역이 표시 대상인지 확인 (계층 구조 확인)
    isVisible(zoneName) {
        if (!zoneName) return true;

        // 1. 대분류 확인
        const subRegion = getSubRegion(zoneName);
        const mainRegion = getMainRegion(subRegion);

        if (mainRegion && this.settings[mainRegion] === false) return false;

        // 2. 중분류 확인 (제주 제외)
        if (mainRegion !== '제주' && subRegion && this.settings[subRegion] === false) return false;

        // 3. 소분류 확인
        if (this.settings[zoneName] === false) return false;

        return true;
    },

    // 설정 값 가져오기 (기본값 true)
    get(key) {
        return this.settings[key] !== false;
    },

    // 설정 값 변경
    set(key, value) {
        this.settings[key] = value;
    },

    reset() {
        this.settings = {};
        this.save();
    }
};

// 초기화 실행
UserSettings.init();

// ----------------------------------------------------------------------------
// 설정 모달 관련 함수
// ----------------------------------------------------------------------------

// [New] 알림 설정 로직 (Notification Logic)
const NotificationSettings = {
    STORAGE_KEY: 'notificationSettings_v1',
    settings: {
        master: false,
        target: 'interest',
        announce: true,
        active: true,
        release: true,
        night: true
    },
    init() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) Object.assign(this.settings, JSON.parse(saved));
        } catch (e) { }
    },
    save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
    },
    get() { return this.settings; },
    set(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.save();

        // [추가] 서버로 설정 즉시 동기화 (네이티브인 경우)
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            // window.subscribeUser 함수가 토큰과 설정을 함께 보냄
            if (typeof window.subscribeUser === 'function') {
                // 토큰은 내부적으로 다시 가져오거나 저장된 것을 사용 (이미 브릿지에 구현됨)
                window.subscribeUser();
            }
        }
    }
};
NotificationSettings.init();

function initNotificationUI() {
    // 매번 localStorage에서 최신 값을 다시 읽어옴 (capacitor-plugins.js에서 직접 저장한 값 반영)
    NotificationSettings.init();
    const s = NotificationSettings.get();

    const master = document.getElementById('push-master-toggle');
    const radios = document.getElementsByName('push-target');
    const optAnnounce = document.getElementById('push-opt-announce');
    const optActive = document.getElementById('push-opt-active');
    const optRelease = document.getElementById('push-opt-release');
    const optNight = document.getElementById('push-opt-night');

    if (!master) return;

    // Load values
    master.checked = s.master;

    // [확실한 이벤트 바인딩]
    master.onclick = async (e) => {
        console.log('Push toggle clicked. Master checked:', e.target.checked);
        const willBeEnabled = e.target.checked;

        if (willBeEnabled) {
            // [Debug] 함수 존재 확인
            if (typeof window.checkPushPermission !== 'function') {
                console.error('Critical Error: checkPushPermission is not defined!');
                return;
            }

            const permission = await window.checkPushPermission();
            console.log('Permission result:', permission);

            if (permission === 'denied' || permission === 'prompt-with-rationale') {
                e.preventDefault();
                e.target.checked = false;

                if (typeof window.showCustomPopup === 'function') {
                    window.showCustomPopup({
                        icon: '<svg viewBox="0 0 24 24" stroke="#ff9800"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
                        iconBg: 'rgba(255, 152, 0, 0.12)',
                        title: '알림 권한이 필요합니다',
                        message: '현재 알림 권한이 거절되어 있습니다.<br>푸시 알림을 받으시려면 휴대폰 설정에서<br>알림을 허용해 주세요.',
                        confirmText: '설정으로 이동',
                        cancelText: '취소'
                    }).then((goToSettings) => {
                        if (goToSettings) window.openAppSettings();
                    });
                }
                return;
            } else if (permission === 'prompt') {
                if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
                    const result = await window.Capacitor.Plugins.PushNotifications.requestPermissions();
                    if (result.receive !== 'granted') {
                        e.preventDefault();
                        e.target.checked = false;
                        return;
                    }
                }
            }
        }
        // 정상적인 경우 UI 업데이트
        updateMasterState(willBeEnabled);

        // [추가] 즉시 설정 저장 및 서버 동기화
        NotificationSettings.set({ master: willBeEnabled });
    };

    updateMasterState(s.master);

    // Radios
    radios.forEach(r => {
        // Set state
        if (r.value === s.target) r.checked = true;

        // Visual Update
        updateRadioVisual(r);

        // Click Event (Wrapper)
        const label = r.closest('label');
        if (label) label.onclick = () => {
            setTimeout(() => {
                radios.forEach(radio => updateRadioVisual(radio));
            }, 0);
        };
    });

    function updateRadioVisual(radio) {
        const content = radio.nextElementSibling;
        if (!content) return;
        if (radio.checked) {
            content.classList.add('active');
            content.style.background = 'var(--accent-blue)';
            content.style.color = 'white';
        } else {
            content.classList.remove('active');
            content.style.background = 'transparent';
            content.style.color = '#ccc';
        }
    }

    // Options
    if (optAnnounce) optAnnounce.checked = s.announce;
    if (optActive) optActive.checked = s.active;
    if (optRelease) optRelease.checked = s.release;
    if (optNight) optNight.checked = s.night;
}

function updateMasterState(isEnabled) {
    const details = document.getElementById('push-detail-settings');
    if (!details) return;
    if (isEnabled) {
        details.style.opacity = '1';
        details.style.pointerEvents = 'auto';
    } else {
        details.style.opacity = '0.4';
        details.style.pointerEvents = 'none';
    }
}

function saveNotificationUI() {
    const master = document.getElementById('push-master-toggle');
    if (!master) return;

    const target = document.querySelector('input[name="push-target"]:checked')?.value || 'interest';

    NotificationSettings.set({
        master: master.checked,
        target: target,
        announce: document.getElementById('push-opt-announce')?.checked ?? true,
        active: document.getElementById('push-opt-active')?.checked ?? true,
        release: document.getElementById('push-opt-release')?.checked ?? true,
        night: document.getElementById('push-opt-night')?.checked ?? true
    });
}

// [New] 설정 탭 전환 함수
window.switchSettingsTab = function (tabId) {
    console.log('Switching to tab:', tabId);

    // 모든 탭 버튼 비활성화
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // 선택된 탭 버튼 활성화 (ID 기반으로 시도 후 안되면 기존 방식으로)
    const activeBtn = document.getElementById(`btn-${tabId}`) || document.querySelector(`.settings-tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // 모든 탭 컨텐츠 숨기기
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none'; // 명시적으로 숨김
    });
    // 선택된 탭 컨텐츠 보이기
    const activeContent = document.getElementById(tabId);
    if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'block'; // 명시적으로 보여줌
    }
};

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // 네이티브 앱이 아닌 경우 푸시 알림 탭 숨김
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform();
    const pushTabBtn = document.getElementById('btn-tab-push');
    const pushTabContent = document.getElementById('tab-push');
    if (pushTabBtn) pushTabBtn.style.display = isNative ? '' : 'none';
    if (pushTabContent) pushTabContent.style.display = isNative ? '' : 'none';

    // UI 보이기
    modal.classList.remove('hidden');

    // [New] 탭 초기화 (관심해역 탭부터 시작)
    window.switchSettingsTab('tab-zones');

    renderSettingsList();
    initNotificationUI(); // [New] UI 초기화
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
}

function saveSettingsAndClose() {
    UserSettings.save();
    saveNotificationUI(); // [New] 알림 설정 저장
    if (window.FontSizeManager) FontSizeManager.save(); // [New] 폰트 크기 저장
    closeSettingsModal();

    // [New] 서버에 푸시 구독 정보 업데이트 요청 (Zones 변경 반영)
    if (typeof window.subscribeUser === 'function') {
        console.log('🔄 Settings saved. Updating server subscription...');
        window.subscribeUser();
    }

    // 화면 갱신: 특보 및 기상현황
    renderApp();
    if (typeof renderMarineWeatherStatus === 'function') {
        renderMarineWeatherStatus();
    }
}

function resetSettings() {
    if (confirm('모든 설정을 초기화하여 전체 해역을 표시하시겠습니까?')) {
        UserSettings.reset();
        openSettingsModal(); // UI 갱신
    }
}

// 설정 목록 UI 생성 (상태 유지 기능 추가)
function renderSettingsList(expandedStates = null) {
    const container = document.getElementById('settings-list-container');
    if (!container) return;

    // 현재 열려있는 아코디언 상태 저장 (ID 기반)
    // expandedStates가 전달되지 않았을 때만 현재 DOM에서 상태 수집
    const currentExpanded = expandedStates || getExpandedAccordionIds(container);

    container.innerHTML = '';

    // 대분류 순회
    const mainRegions = ['동해', '서해', '남해', '제주'];

    mainRegions.forEach(mainRegion => {
        const regionData = SEA_REGIONS[mainRegion];
        if (!regionData) return;

        const isMainVisible = UserSettings.get(mainRegion);
        const mainId = `accordion-main-${mainRegion}`; // ID 생성

        // 1. 대분류 아코디언 섹션
        const section = document.createElement('div');
        section.className = 'setting-section';
        section.style.marginBottom = '15px';

        // [추가] 자식 해역들의 전체 통계 계산 (대분류용)
        let mainActive = 0;
        let mainTotal = 0;
        regionData.subRegions.forEach(sub => {
            if (SUB_REGION_ZONES[sub]) {
                mainTotal += SUB_REGION_ZONES[sub].length;
                mainActive += SUB_REGION_ZONES[sub].filter(z => UserSettings.get(z)).length;
            }
        });
        // 제주의 경우 소분류 직접 계산
        if (mainRegion === '제주' && SUB_REGION_ZONES['제주해역']) {
            mainTotal = SUB_REGION_ZONES['제주해역'].length;
            mainActive = SUB_REGION_ZONES['제주해역'].filter(z => UserSettings.get(z)).length;
        }
        const mainBadgeHtml = mainTotal > 0 ? `<span style="margin-left:8px; font-size:0.8rem; color:${mainActive > 0 ? 'var(--accent-blue)' : '#64748b'}; font-weight:normal; background:rgba(0,0,0,0.2); padding:2px 8px; border-radius:10px;">(${mainActive}/${mainTotal})</span>` : '';

        // 헤더
        const header = document.createElement('div');
        header.className = `setting-accordion-header ${isMainVisible ? '' : 'disabled-style'}`;
        header.innerHTML = `
            <div class="setting-label" style="font-weight: 700;">
                <i class="fa-solid fa-chevron-right arrow" style="font-size: 0.8rem; width: 20px; text-align: center; transition: transform 0.3s; transform: rotate(0deg);"></i>
                ${regionData.icon} ${regionData.displayName || mainRegion}
                ${mainBadgeHtml}
            </div>
            <div class="switch-wrapper" onclick="event.stopPropagation()">
                <label class="switch">
                    <input type="checkbox" ${isMainVisible ? 'checked' : ''} onchange="toggleSetting('${mainRegion}', this.checked)">
                    <span class="slider"></span>
                </label>
            </div>
        `;

        const body = document.createElement('div');
        body.className = 'setting-accordion-body';
        body.id = mainId; // ID 부여

        // 상태 복원
        if (currentExpanded.has(mainId)) {
            body.classList.add('open');
            header.querySelector('.arrow').style.transform = 'rotate(90deg)';
        }

        // 헤더 클릭 이벤트
        header.onclick = (e) => {
            if (e.target.closest('.switch-wrapper')) return;
            const isOpen = body.classList.contains('open');
            const arrow = header.querySelector('.arrow');
            if (isOpen) {
                body.classList.remove('open');
                arrow.style.transform = 'rotate(0deg)';
            } else {
                body.classList.add('open');
                arrow.style.transform = 'rotate(90deg)';
            }
        };

        section.appendChild(header);
        section.appendChild(body);

        // 2. 하위 항목 생성
        if (mainRegion === '제주') {
            const zones = SUB_REGION_ZONES['제주해역'] || [];
            zones.forEach(zone => {
                body.appendChild(createSettingItem(zone, mainRegion));
            });
        } else {
            const subRegions = regionData.subRegions;
            subRegions.forEach(subRegion => {
                const subZones = SUB_REGION_ZONES[subRegion] || [];
                const isSubVisible = UserSettings.get(subRegion);
                const subId = `accordion-sub-${subRegion}`; // ID 생성

                const subSection = document.createElement('div');
                subSection.style.marginBottom = '8px';

                // 중분류 헤더
                const subHeader = document.createElement('div');
                subHeader.className = `setting-accordion-header ${isSubVisible && isMainVisible ? '' : 'disabled-style'}`;
                subHeader.style.padding = '10px 14px';
                subHeader.style.background = 'rgba(255, 255, 255, 0.05)';

                // [수정] 대분류가 꺼져있으면 중분류 비활성화 스타일 적용
                if (!isMainVisible) {
                    subHeader.style.opacity = '0.4';
                    subHeader.style.pointerEvents = 'none';
                }

                // [추가] 배지 계산 (선택된 해역 수 / 전체 해역 수)
                let activeCount = 0;
                let totalCount = 0;
                if (SUB_REGION_ZONES[subRegion]) {
                    totalCount = SUB_REGION_ZONES[subRegion].length;
                    activeCount = SUB_REGION_ZONES[subRegion].filter(z => UserSettings.get(z)).length;
                }
                const badgeHtml = totalCount > 0 ? `<span style="margin-left:6px; font-size:0.75rem; color:${activeCount > 0 ? 'var(--accent-blue)' : '#64748b'}; font-weight:normal; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:10px;">(${activeCount}/${totalCount})</span>` : '';

                subHeader.innerHTML = `
                    <div class="setting-label" style="font-size: 0.95rem;">
                        <i class="fa-solid fa-chevron-right arrow" style="font-size: 0.7rem; width: 15px; margin-right: 5px; transition: transform 0.3s;"></i>
                        ${subRegion} ${badgeHtml}
                    </div>
                    <div class="switch-wrapper" onclick="event.stopPropagation()">
                        <label class="switch" style="transform: scale(0.9);">
                            <input type="checkbox" ${isSubVisible ? 'checked' : ''} onchange="toggleSetting('${subRegion}', this.checked)">
                            <span class="slider"></span>
                        </label>
                    </div>
                `;

                const subBody = document.createElement('div');
                subBody.className = 'setting-accordion-body';
                subBody.id = subId; // ID 부여
                subBody.style.borderLeft = '1px dashed rgba(255,255,255,0.1)';

                // 상태 복원
                if (currentExpanded.has(subId)) {
                    subBody.classList.add('open');
                    subHeader.querySelector('.arrow').style.transform = 'rotate(90deg)';
                }

                subHeader.onclick = (e) => {
                    if (e.target.closest('.switch-wrapper')) return;
                    const isOpen = subBody.classList.contains('open');
                    const arrow = subHeader.querySelector('.arrow');
                    if (isOpen) {
                        subBody.classList.remove('open');
                        arrow.style.transform = 'rotate(0deg)';
                    } else {
                        subBody.classList.add('open');
                        arrow.style.transform = 'rotate(90deg)';
                    }
                };

                subSection.appendChild(subHeader);
                subSection.appendChild(subBody);

                subZones.forEach(zone => {
                    subBody.appendChild(createSettingItem(zone, subRegion));
                });

                body.appendChild(subSection);
            });
        }

        container.appendChild(section);
    });
}

// 현재 열려있는 아코디언 ID 수집
function getExpandedAccordionIds(container) {
    const expanded = new Set();
    const openBodies = container.querySelectorAll('.setting-accordion-body.open');
    openBodies.forEach(body => {
        if (body.id) expanded.add(body.id);
    });
    return expanded;
}

function createSettingItem(zoneName, parentKey) {
    const isVisible = UserSettings.get(zoneName);
    const parentVisible = UserSettings.get(parentKey);

    const div = document.createElement('div');
    div.className = 'setting-item';

    if (!parentVisible) {
        div.style.opacity = '0.4';
        div.style.pointerEvents = 'none';
    }

    div.innerHTML = `
        <div class="setting-label" style="font-size: 0.9rem; color: #ddd;">
            ${zoneName}
        </div>
        <label class="switch" style="transform: scale(0.8);">
            <input type="checkbox" ${isVisible ? 'checked' : ''} onchange="toggleSetting('${zoneName}', this.checked)">
            <span class="slider"></span>
        </label>
    `;
    return div;
}

function toggleSetting(key, isChecked) {
    // 1. 현재 항목 설정
    UserSettings.set(key, isChecked);

    // 2. 계층 구조에 따른 연동 (Cascading)

    // (A) 순방향 연동: 부모 -> 자식 (Parent -> Child)
    if (['동해', '서해', '남해', '제주'].includes(key)) {
        const regionData = SEA_REGIONS[key];
        if (regionData && regionData.subRegions) {
            regionData.subRegions.forEach(sub => {
                UserSettings.set(sub, isChecked);
                if (SUB_REGION_ZONES[sub]) {
                    SUB_REGION_ZONES[sub].forEach(zone => UserSettings.set(zone, isChecked));
                }
            });
        }
        if (key === '제주' && SUB_REGION_ZONES['제주해역']) {
            SUB_REGION_ZONES['제주해역'].forEach(zone => UserSettings.set(zone, isChecked));
        }
    } else if (SUB_REGION_ZONES[key]) {
        SUB_REGION_ZONES[key].forEach(zone => UserSettings.set(zone, isChecked));
    }

    // (B) [추가] 역방향 연동: 자식 -> 부모 (Child -> Parent ON)
    if (isChecked) {
        // [소분류 -> 중분류 & 대분류]
        for (const [subName, zones] of Object.entries(SUB_REGION_ZONES)) {
            if (zones.includes(key)) {
                UserSettings.set(subName, true); // 중분류 ON
                // 중분류에서 다시 대분류 찾기
                for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
                    if (data.subRegions.includes(subName)) {
                        UserSettings.set(mainName, true); // 대분류 ON
                    }
                }
                break;
            }
        }
        // [중분류 -> 대분류]
        for (const [mainName, data] of Object.entries(SEA_REGIONS)) {
            if (data.subRegions.includes(key)) {
                UserSettings.set(mainName, true); // 대분류 ON
                break;
            }
        }
    }

    // 리스트 컨테이너의 스크롤 위치 저장
    const body = document.querySelector('#settings-modal .modal-body');
    const scrollPos = body ? body.scrollTop : 0;

    // **중요**: 현재 상태를 수집한 후 재렌더링에 전달
    const container = document.getElementById('settings-list-container');
    const expandedStates = getExpandedAccordionIds(container);

    renderSettingsList(expandedStates);

    if (body) body.scrollTop = scrollPos;
}

// 전역 노출
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettingsAndClose = saveSettingsAndClose;
window.resetSettings = resetSettings;
window.toggleSetting = toggleSetting;

// ============================================================
// 📍 내 주변 바다 기상전망 (GPS 기반)
// ============================================================

async function showMyLocationWeather() {
    const btn = document.getElementById('my-location-btn');
    if (!btn) return;

    // UI 업데이트
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 확인 중...';
    btn.disabled = true;

    try {
        let lat, lon;

        // Capacitor 네이티브 환경이면 Capacitor Geolocation 플러그인 사용
        if (typeof window.getCurrentPositionViaCapacitor === 'function') {
            const position = await window.getCurrentPositionViaCapacitor();
            lat = position.coords.latitude;
            lon = position.coords.longitude;
        } else if (navigator.geolocation) {
            // 브라우저 환경 폴백
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true, timeout: 15000, maximumAge: 0
                });
            });
            lat = position.coords.latitude;
            lon = position.coords.longitude;
        } else {
            alert("이 환경에서는 위치 정보를 사용할 수 없습니다.");
            return;
        }

        // 1. 해구(Sea Zone) 판별
        const checkResult = findSeaZone(lon, lat);

        if (checkResult) {
            // 해상임: 해당 해구의 기상전망 표출
            if (window.showMarineZoneModal) {
                if (window.closeSeaZoneModal) window.closeSeaZoneModal();
                window.getMarineZoneData(checkResult.zoneId);
            }
        } else {
            // 육상임: 가장 가까운 해안 예보 구역 찾기
            const nearestZone = findNearestZone(lat, lon);
            if (nearestZone) {
                if (window.showSeaForecastTable) {
                    showSeaForecastTable(nearestZone.name);
                }
            } else {
                alert("가장 가까운 예보 구역을 찾을 수 없습니다.");
            }
        }
    } catch (e) {
        console.error("Location error:", e);
        let msg = "위치 정보를 가져올 수 없습니다.";
        if (e.message === 'location_permission_denied') {
            // 권한 거부 시 스타일 팝업으로 안내
            if (typeof window.showCustomPopup === 'function' && window.Capacitor && window.Capacitor.isNativePlatform()) {
                const goToSettings = await window.showCustomPopup({
                    icon: '<svg viewBox="0 0 24 24" stroke="#ff9800"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
                    iconBg: 'rgba(255, 152, 0, 0.12)',
                    title: '위치 권한이 필요합니다',
                    message: '내 주변 바다 날씨를 확인하려면<br>위치 정보 접근을 허용해 주세요.',
                    confirmText: '설정으로 이동',
                    cancelText: '취소'
                });
                if (goToSettings) window.openAppSettings();
            } else {
                alert(msg + "\n위치 정보 제공을 허용해주세요.");
            }
        } else {
            alert(msg);
        }
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// 헬퍼: GPS 좌표로 해구 정보(대해구, 소해구) 찾기
function findSeaZone(lon, lat) {
    if (typeof gpsToPixel !== 'function' || typeof GRID_DATA === 'undefined' || typeof SEA_ZONES_DATA === 'undefined') {
        // console.warn('필요한 데이터가 로드되지 않았습니다.');
        return null;
    }

    const pixel = gpsToPixel(lon, lat); // gridCalibrationData.js

    // 1. 격자(Grid) 찾기
    const lonKeys = Object.keys(GRID_DATA.lon).map(Number).sort((a, b) => a - b);
    const latKeys = Object.keys(GRID_DATA.lat).map(Number).sort((a, b) => a - b);

    let lonKey = null, latKey = null; // 구간 시작 키
    let lonNext = null, latNext = null; // 구간 끝 키

    for (let i = 0; i < lonKeys.length - 1; i++) {
        const x1 = GRID_DATA.lon[lonKeys[i]].val;
        const x2 = GRID_DATA.lon[lonKeys[i + 1]].val;
        if (pixel.x >= x1 && pixel.x < x2) {
            lonKey = lonKeys[i];
            lonNext = lonKeys[i + 1];
            break;
        }
    }

    for (let i = 0; i < latKeys.length - 1; i++) {
        const y1 = GRID_DATA.lat[latKeys[i]].val;
        const y2 = GRID_DATA.lat[latKeys[i + 1]].val;
        if (pixel.y >= y1 && pixel.y < y2) {
            latKey = latKeys[i];
            latNext = latKeys[i + 1];
            break;
        }
    }

    if (lonKey !== null && latKey !== null) {
        const gridKey = `${lonKey}-${lonNext}_${latKey}-${latNext}`;
        const zoneNum = SEA_ZONES_DATA[gridKey];

        if (zoneNum && zoneNum !== "0") {
            // 대해구 찾음. 이제 소해구(1~9) 계산
            const x1 = GRID_DATA.lon[lonKey].val;
            const y1 = GRID_DATA.lat[latKey].val;

            // 전체 격자 크기 계산
            const width = GRID_DATA.lon[lonNext].val - x1;
            const height = GRID_DATA.lat[latNext].val - y1;

            const cellW = width / 3;
            const cellH = height / 3;

            const localX = pixel.x - x1;
            const localY = pixel.y - y1;

            const col = Math.floor(localX / cellW);
            const row = Math.floor(localY / cellH);

            const safeCol = Math.max(0, Math.min(2, col));
            const safeRow = Math.max(0, Math.min(2, row));

            const subIdx = safeRow * 3 + safeCol + 1; // 1~9

            return {
                zoneNum: zoneNum,
                subIdx: subIdx,
                zoneId: `${zoneNum}-${subIdx}`
            };
        }
    }
    return null;
}

// 헬퍼: 가장 가까운 육상 예보 구역 찾기
function findNearestZone(lat, lon) {
    if (typeof ZONE_COORDINATES === 'undefined') return null;

    let minDist = Infinity;
    let nearest = null;

    for (const [name, coord] of Object.entries(ZONE_COORDINATES)) {
        const dist = getDistanceFromLatLonInKm(lat, lon, coord.lat, coord.lon);
        if (dist < minDist) {
            minDist = dist;
            nearest = { name: name, dist: dist };
        }
    }
    return nearest;
}

// 헬퍼: 거리 계산
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ============================================================================
// 🛠️ 서버 점검 & 관리자 공지 시스템
// ============================================================================

