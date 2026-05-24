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

    // 메인 탭 이벤트 바인딩 (기상정보, 조석정보, 해양생활, 공지사항)
    // [연계] js/marine.js switchMainTab() → 그룹/섹션 전환 처리

    // [히든 접근] 조석정보 탭 10회 연속 탭 → 해양종합정보 테스트 페이지 진입
    // - 3초 이내 연속 탭만 카운트, 초과 시 리셋
    // - 다른 탭 클릭 시에도 카운터 리셋
    let _hiddenTapCount = 0;
    let _hiddenTapTimer = null;

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');

            // 조석정보 탭 연속 탭 감지
            if (targetId === 'tide-section') {
                _hiddenTapCount++;
                // 3초 타이머 리셋 (3초 이내 연속 탭만 인정)
                clearTimeout(_hiddenTapTimer);
                _hiddenTapTimer = setTimeout(() => { _hiddenTapCount = 0; }, 3000);

                // 10회 도달 시 index2 페이지로 이동 (또는 이미 index2이면 종합기상 탭 전환)
                if (_hiddenTapCount >= 10) {
                    _hiddenTapCount = 0;
                    clearTimeout(_hiddenTapTimer);
                    if (window.__SEAGNAL_PAGE === 'index2') {
                        // 이미 index2 → 종합기상 탭으로 전환
                        window.switchMainTab('ocean-map-section');
                    } else {
                        // index1 → index2 페이지로 이동
                        window.location.href = 'index2.html';
                    }
                    return;
                }
            } else {
                // 다른 탭 클릭 시 카운터 리셋
                _hiddenTapCount = 0;
                clearTimeout(_hiddenTapTimer);
            }

            window.switchMainTab(targetId);
        });
    });

    // 서브 탭 이벤트 바인딩 (기상정보/해양생활 하위 탭)
    // [연계] js/marine.js switchSubTab() → 같은 그룹 내 서브 섹션 전환
    const subTabs = document.querySelectorAll('.sub-tab-btn');
    subTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            window.switchSubTab(targetId);
        });
    });
}

/**
 * 설정 모달 내 탭 UI 의 CSS 를 <style id="tab-styles"> 로 1회 주입.
 * 이미 주입되어 있으면 중복 방지(early return). DOMContentLoaded 후 호출.
 */
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

    // [이동됨] 해구도 프리로드는 data.js의 loadBackgroundData()에서 순차 처리
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
        night: true,
        childZones: false   // [작업2a] 특정관리해역(연안바다/평수구역) 자식 정보 푸시 표시 (기본 OFF)
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

/**
 * 푸시 알림 설정 UI 초기화 — 라디오/체크박스/마스터 토글에 현재 저장값 반영.
 * 매번 localStorage 에서 최신 값을 다시 읽어 capacitor-plugins.js 가 직접
 * 저장한 값(앱 권한 변경 등) 도 즉시 반영되도록 한다.
 *
 * [연계] 설정 모달이 열릴 때마다 호출(openSettingsModal).
 */
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
    const optChildZones = document.getElementById('push-opt-childzones');

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

    /**
     * 라디오 버튼의 시각적 활성/비활성 상태(채워짐 ↔ 빈 원)를 next sibling label
     * 의 클래스로 동기화. 같은 name 그룹 안에서 활성 1개만 강조되도록 함.
     */
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
    if (optChildZones) optChildZones.checked = s.childZones;
}

/**
 * 푸시 마스터 토글(전체 ON/OFF) 상태에 따라 세부 설정 영역(#push-detail-settings)
 * 의 시각/상호작용 상태를 흐림(40%) + pointerEvents 차단으로 처리.
 * "마스터가 OFF 면 세부 설정 변경 의미 없음" 을 시각적으로 안내.
 */
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

/**
 * 알림 설정 UI 의 현재 상태를 NotificationSettings 에 저장.
 * 마스터 토글 + 대상(전체/관심) + 우선순위 + 야간 음소거 등을 모아 1회 set.
 *
 * [호출 시점] 설정 모달의 "저장" 버튼(saveSettingsAndClose) 또는 모달 닫기 직전.
 */
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
        night: document.getElementById('push-opt-night')?.checked ?? true,
        childZones: document.getElementById('push-opt-childzones')?.checked ?? false
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

/**
 * 설정 모달을 화면에 표시 + 현재 설정값 스냅샷 저장.
 * 사용자가 변경 후 "취소" 로 닫으면 스냅샷으로 원복(closeSettingsModal) 됨.
 *
 * [연계]
 *   - UserSettings._snapshot, NotificationSettings._snapshot, _fontSizeSnapshot
 *     세 가지 스냅샷을 저장 (저장 시 saveSettingsAndClose 가 비움)
 *   - injectTabStyles + initNotificationUI 도 모달 열 때 호출
 */
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
    initNotificationUI(); // [New] UI 초기화 (localStorage에서 최신 값 다시 읽음)

    // 스냅샷 저장 (initNotificationUI 이후에 생성해야 localStorage 최신 값 기준)
    UserSettings._snapshot = JSON.parse(JSON.stringify(UserSettings.settings));
    NotificationSettings._snapshot = JSON.parse(JSON.stringify(NotificationSettings.settings));
    window._fontSizeSnapshot = window.FontSizeManager ? FontSizeManager.get() : null;
}

/**
 * 설정 모달 닫기 — 변경사항이 저장되지 않았다면 스냅샷으로 원복.
 *
 * [복원 정책]
 *   _snapshot 이 남아있는 경우(=사용자가 "저장" 안 함) UserSettings/
 *   NotificationSettings/FontSizeManager 모두 스냅샷 시점으로 되돌림.
 *   "저장" 으로 닫혔으면 saveSettingsAndClose 가 미리 _snapshot 을 null 로
 *   세팅하므로 여기서 복원이 발동하지 않음.
 */
function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');

    // 스냅샷이 남아있으면 저장 없이 닫은 것 → 원래 상태로 복원
    if (UserSettings._snapshot) {
        UserSettings.settings = UserSettings._snapshot;
        UserSettings._snapshot = null;
    }
    if (NotificationSettings._snapshot) {
        NotificationSettings.settings = NotificationSettings._snapshot;
        NotificationSettings._snapshot = null;
    }
    if (window._fontSizeSnapshot) {
        if (window.FontSizeManager) FontSizeManager.apply(window._fontSizeSnapshot);
        window._fontSizeSnapshot = null;
    }
}

/**
 * 설정 모달의 변경사항을 확정 저장하고 모달 닫기.
 *
 * [순서]
 *   1) 세 스냅샷 모두 null 로 비움 (closeSettingsModal 의 복원 차단)
 *   2) saveNotificationUI() — 알림 설정 저장
 *   3) UserSettings.save() — 관심해역 등 저장
 *   4) closeSettingsModal — 화면 닫기
 *   5) 필요 시 loadRegionalForecast 다시 호출 (관심해역 변경 반영)
 */
function saveSettingsAndClose() {
    // 스냅샷 제거 (저장 확정이므로 closeSettingsModal에서 복원하지 않도록)
    UserSettings._snapshot = null;
    NotificationSettings._snapshot = null;
    window._fontSizeSnapshot = null;

    UserSettings.save();
    saveNotificationUI(); // [New] 알림 설정 저장
    if (window.FontSizeManager) FontSizeManager.save(); // [New] 폰트 크기 저장
    closeSettingsModal();

    // [New] 서버에 푸시 구독 정보 업데이트 요청 (Zones 변경 반영)
    if (typeof window.subscribeUser === 'function') {
        console.log('🔄 Settings saved. Updating server subscription...');
        window.subscribeUser();
    }

    // 화면 갱신: 특보, 기상현황, 종합 예보
    renderApp();
    if (typeof renderMarineWeatherStatus === 'function') {
        renderMarineWeatherStatus();
    }
    if (typeof loadRegionalForecast === 'function') {
        loadRegionalForecast();
    }
}

/**
 * 관심해역 설정 일괄 초기화 — 모든 zone 을 활성화 상태로 되돌림.
 * 메모리만 초기화하고 localStorage 는 사용자가 "저장" 버튼을 눌러야 반영됨
 * (실수 클릭 보호).
 */
function resetSettings() {
    if (confirm('모든 설정을 초기화하여 전체 해역을 표시하시겠습니까?')) {
        // 메모리만 초기화 (저장 버튼을 눌러야 실제 반영)
        UserSettings.settings = {};
        renderSettingsList(); // 설정 목록 UI만 갱신
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

/**
 * 관심해역 설정 화면의 한 항목(zone) 체크박스 row HTML 생성.
 * 부모 zone 이 OFF 이면 자식도 자동으로 체크 해제·비활성 표시.
 *
 * @param {string} zoneName  - 자식 zone 이름
 * @param {string} parentKey - 부모 zone 키 (가시성 종속 판정용)
 * @returns {string} - innerHTML 으로 삽입할 마크업
 */
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

/**
 * 설정 체크박스 토글 핸들러 — UserSettings 갱신 + 부모/자식 종속 처리.
 *
 * [부모/자식 종속]
 *   - 부모 OFF → 자식도 모두 OFF 처리 (자식 단독 ON 의미 없음)
 *   - 자식 ON → 부모 자동 ON (부모 OFF 인 채 자식만 ON 은 모순)
 *
 * @param {string} key - zone 이름 (또는 부모 zone 키)
 * @param {boolean} isChecked - 새 체크 상태
 */
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

