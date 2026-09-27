/**
 * ============================================================================
 * 파일명: js/app_init.js
 * 역할: 앱 초기화, 시간 표시, 폰트 크기, 헤더 새로고침, 방문자 카운터
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : js/shared/utils/utils.js (appState)
 *  - 서버 API      : GET /api/visit (방문자 카운터), GET /api/admin/collect-failures ·
 *                    /api/admin/review-needed (관리자 알림 배지)
 *  - 마크업        : index2.html #current-time, #current-date, #today-count,
 *                    #total-count, #admin-alert-banner, .header-content
 *  - 나를 쓰는 곳  : DOMContentLoaded 자가 실행 + 다수 feature 공용 —
 *                    FontSizeManager 는 settings.js·ocean_timeline.js 가,
 *                    updateVisitorStats()·updateTimeDisplay() 등은 data.js·marine.js 등이 호출
 * ============================================================================
 *
 * [설명]
 * - FontSizeManager: 글꼴 크기 설정 (localStorage)
 * - updateTimeDisplay(): 실시간 시간 표시 업데이트 (1초 간격)
 * - handleHeaderRefresh(): 헤더 클릭 시 기상정보 탭 전환 + 데이터 새로고침
 * - updateVisitorStats(): 방문자 카운터 UI 업데이트
 * - DOMContentLoaded: 헤더 좀비 리스너 제거
 *
 * [로딩 순서] history.js 대체 (마지막)
 * ============================================================================
 */

// ============================================================================
// 폰트 크기 설정 기능
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

                // 저장 버튼을 눌러야 적용됨 (즉시 미리보기 제거)
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

// ============================================================================
// 실시간 시간 표시 업데이트
// ============================================================================

/**
 * 우측 상단 시간 표시 업데이트
 */
function updateTimeDisplay() {
    const now = new Date();
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');

    if (dateEl && timeEl) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateEl.textContent = now.toLocaleDateString('ko-KR', options);
        timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    }

    if (typeof ApiStatusManager !== 'undefined') {
        if (window.ApiStatusManager) ApiStatusManager.update();
    }
}

// 시간 표시 초기화 및 1초마다 업데이트
updateTimeDisplay();
setInterval(updateTimeDisplay, 1000);

// ============================================================================
// 헤더 클릭 시 기상정보 탭 전환 + 데이터 새로고침
// ============================================================================
async function handleHeaderRefresh() {
    // 기상정보 탭으로 강제 전환
    window.switchMainTab("weather-alert-section");

    // 이미 로딩 중이면 무시
    if (appState.isLoading) return;

    try {
        await fetchAllData();
    } catch (e) {
        // ★조용히 넘어가지 않는다 (3-44). **화면이 옛 자료 그대로 남는다** —
        //   사용자는 방금 새로고침한 값이라고 믿는다(가장 위험한 꼴이다).
        console.warn('[앱] 자료 새로고침 실패 — 화면은 옛 값 그대로다:', e && e.message);
    }
}
window.handleHeaderRefresh = handleHeaderRefresh;

// ============================================================================
// 방문자 카운터 UI 업데이트
// ============================================================================
window.updateVisitorStats = async function () {
    try {
        const hasVisited = sessionStorage.getItem('v1_visited');
        // 관리자 모드 여부 확인 (localStorage는 동기 읽기이므로 즉시 판단 가능)
        const isAdmin = localStorage.getItem('seagnal_admin_mode') === 'true';

        // 방문자 카운트 API URL 결정:
        // - 이미 이 세션에서 방문한 적 있으면 → inc=false (카운트 증가 안 함, 현재 수치만 조회)
        // - 관리자 기기이면 → admin=true 추가 (서버에서 하루 1회만 카운트)
        // - 일반 사용자 첫 방문이면 → /api/visit (카운트 +1)
        let url = '/api/visit';
        if (hasVisited) {
            url = '/api/visit?inc=false';
        } else if (isAdmin) {
            url = '/api/visit?admin=true';
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

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

// [제거됨] markVisitorCounterError: 방문자 카운터 빨간색 경고 표시 기능 삭제
// 관리자 알림은 이제 관리자 배너(showAdminAlertBanner)와 FCM 푸시로 대체됨
// 호환성을 위해 빈 함수로 유지 (외부 호출 시 오류 방지)
window.markVisitorCounterError = function () { };
window.checkCollectFailures = function () { };

// ============================================================================
// [관리자 배너] 관리자 모드 기기로 일반 앱 접속 시 미확인 항목 배너 표시
// ============================================================================
window.showAdminAlertBanner = async function () {
    // 관리자 모드가 아니면 표시하지 않음
    if (localStorage.getItem('seagnal_admin_mode') !== 'true') return;

    // [Phase 4-B 보완] 인증 토큰이 없으면 admin API 호출 자체를 건너뜀.
    //   - admin 모드 토글(localStorage)은 UI 가드일 뿐, 서버 인증과 별개.
    //   - 토큰 없는 상태에서 호출하면 서버가 401 응답 → fetch 래퍼가
    //     "인증 만료" 콘솔 경고를 출력 → 사용자 콘솔 노이즈.
    //   - admin.js 의 getStoredAdminToken() 헬퍼는 admin.js 가 본 파일보다
    //     먼저 로드되므로 (index2.html 스크립트 순서: admin.js < app_init.js)
    //     이 시점에 사용 가능.
    if (typeof getStoredAdminToken === 'function' && !getStoredAdminToken()) return;

    try {
        const [failRes, reviewRes] = await Promise.all([
            fetch('/api/admin/collect-failures'),
            fetch('/api/admin/review-needed')
        ]);
        let failures = [];
        let reviews = [];
        if (failRes.ok) failures = await failRes.json();
        if (reviewRes.ok) reviews = await reviewRes.json();

        const pendingReviews = (reviews || []).filter(r => !r.acknowledged);
        const totalPending = pendingReviews.length + (failures ? failures.length : 0);

        // 기존 배너 제거
        const existing = document.getElementById('admin-alert-banner');
        if (existing) existing.remove();

        // 미확인 항목 없으면 배너 표시하지 않음
        if (totalPending === 0) return;

        // 배너 메시지 구성
        const parts = [];
        if (pendingReviews.length > 0) parts.push(`검토 필요 ${pendingReviews.length}건`);
        if (failures && failures.length > 0) parts.push(`수집 실패 ${failures.length}건`);

        const banner = document.createElement('div');
        banner.id = 'admin-alert-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-size:0.85rem;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        banner.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-bell" style="font-size:1rem;"></i>
                <span>관리자 확인 필요: ${parts.join(', ')}</span>
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="if(typeof showUnifiedAdminModal==='function')showUnifiedAdminModal('alert');document.getElementById('admin-alert-banner').remove();" style="padding:4px 12px;background:rgba(255,255,255,0.25);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;">관리자 센터</button>
                <button onclick="document.getElementById('admin-alert-banner').remove()" style="background:none;border:none;color:rgba(255,255,255,0.8);font-size:1.2rem;cursor:pointer;padding:0 4px;">&times;</button>
            </div>`;
        document.body.prepend(banner);
    } catch (e) {
        // ★조용히 넘어가지 않는다 (3-44). **관리자 알림 띠가 안 뜬다** — 「알릴 것이 없다」와 같아 보인다.
        console.warn('[앱] 관리자 알림 띠를 못 띄웠다 — 「알릴 것 없음」과 구분이 안 된다:', e && e.message);
    }
};

// ============================================================================
// DOMContentLoaded: 헤더 좀비 리스너 제거
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const headerContent = document.querySelector('.header-content');
    if (headerContent) {
        const newHeader = headerContent.cloneNode(true);
        headerContent.parentNode.replaceChild(newHeader, headerContent);
        newHeader.setAttribute('title', '전체 데이터 새로고침');
    }

    // [관리자 배너] 관리자 모드 기기 접속 시 미확인 항목 배너 표시
    if (typeof showAdminAlertBanner === 'function') {
        showAdminAlertBanner();
    }
});
