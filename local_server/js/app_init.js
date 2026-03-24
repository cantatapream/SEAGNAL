/**
 * ============================================================================
 * 파일명: js/app_init.js
 * 역할: 앱 초기화, 시간 표시, 폰트 크기, 헤더 새로고침, 방문자 카운터
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
        // console.error('Refresh failed:', e);
    }
}
window.handleHeaderRefresh = handleHeaderRefresh;

// ============================================================================
// 방문자 카운터 UI 업데이트
// ============================================================================
window.updateVisitorStats = async function () {
    try {
        const hasVisited = sessionStorage.getItem('v1_visited');
        const url = hasVisited ? '/api/visit?inc=false' : '/api/visit';

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

// ============================================================================
// 수집 실패 시 헤더 방문자 카운터 경고 표시
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
});
