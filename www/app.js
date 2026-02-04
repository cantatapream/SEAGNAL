/**
 * @file app.js
 * @description [SEAGNAL 프로젝트 - 메인 진입점 (Entry Point)]
 * 이 파일은 리팩토링된 SEAGNAL 웹 앱의 심장부입니다.
 * 복잡한 로직은 모두 각자의 방(모듈)으로 보냈고, 여기서는 각 모듈을 지휘(Orchestrate)하는 역할만 합니다.
 * 
 * [초보자를 위한 상세 설명]
 * - 예전 `app.js`는 혼자서 요리, 서빙, 청소까지 다 하는 11,000줄짜리 과로 직원이었어요.
 * - 이제는 '지배인'이 되어서 "주방장(WeatherService), 요리해!", "웨이터(WeatherUI), 서빙해!"라고 명령만 내립니다.
 * - 덕분에 코드가 훨씬 짧아지고(약 200줄), 문제가 생겨도 어디가 문제인지 금방 찾을 수 있습니다.
 * 
 * [파일 연계 정보]
 * 1. 데이터 담당: 02_api/weather_service.js (기상 데이터를 가져오라고 시킵니다.)
 * 2. 지도 담당: 03_seazone/seazone_core.js (지도를 준비하라고 시킵니다.)
 * 3. 화면 담당: 05_weather/weather_ui.js (가져온 데이터를 화면에 뿌리라고 시킵니다.)
 */

// 페이지 로드 완료 시 실행
document.addEventListener('DOMContentLoaded', async () => {
    // console.log('🚀 SEAGNAL App Initializing... (Refactored v2.0)');

    // 1. 지도 초기화 (Seazone Map)
    if (window.seazoneCore && window.seazoneCore.initSeaZoneMap) {
        window.seazoneCore.initSeaZoneMap();
    } else {
        console.error('❌ 지도 모듈(seazone_core.js)이 로드되지 않았습니다.');
    }

    // 2. 탭 네비게이션 설정
    setupTabNavigation();

    // 3. 초기 데이터 수집 및 UI 렌더링
    await loadWeatherData();

    // 4. 자동 새로고침 타이머 시작 (기존 auto_refresh.js 활용)
    if (window.startAutoRefresh) {
        window.startAutoRefresh(); // 1분 간격 등 설정된 주기로 실행
    }
});

/**
 * 기상 데이터를 수집하고 화면을 갱신합니다.
 */
async function loadWeatherData() {
    // 로딩 UI 표시 (선택적)
    // showGlobalLoading(); 

    if (window.weatherService) {
        // 서비스 모듈을 통해 통합 데이터(특보 + 부이) 수집
        await window.weatherService.fetchAllWeatherData();

        // UI 모듈에게 화면 갱신 지시
        if (window.weatherUI) {
            window.weatherUI.updateAlertUI();
        }

        // 지도 오버레이 갱신 지시 (특보 색칠)
        if (window.renderOverlay) {
            window.renderOverlay();
        }

    } else {
        console.error('❌ 기상 서비스 모듈(weather_service.js)이 로드되지 않았습니다.');
    }

    // hideGlobalLoading();
}

// --------------------------------------------------------------------------
// 📺 UI 인터랙션 (탭, 모달 등)
// --------------------------------------------------------------------------

function setupTabNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 모든 탭 비활성화
            tabs.forEach(t => t.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            // 선택된 탭 활성화
            tab.classList.add('active');
            const targetId = tab.dataset.target;
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');

                // 탭 전환 시 필요한 추가 동작 (예: 지도 리사이즈)
                if (targetId === 'sea-zone-section') {
                    if (window.seazoneCore && window.seazoneCore.resetViewAndCenter) {
                        // 탭 전환 애니메이션 후 실행되도록 약간 지연
                        setTimeout(window.seazoneCore.resetViewAndCenter, 100);
                    }
                }
            }
        });
    });
}

// 전역 함수로 노출 (HTML 버튼 등에서 호출해야 하는 경우)
window.fetchAllData = loadWeatherData; // 기존 이름 호환성 유지

/**
 * [예시] 설정 모달 열기 (기존 로직 유지 또는 별도 파일 분리 가능)
 */
window.openSettingsModal = function () {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeSettingsModal = function () {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
};

// ... (기타 필요한 전역 이벤트 핸들러는 여기에 최소한으로 유지)
