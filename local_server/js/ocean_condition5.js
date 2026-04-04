/**
 * ============================================================================
 * 파일명: js/ocean_condition5.js
 * 역할: 해황예보도 - 즐겨찾기(별표) 관리 + 토스트 메시지
 * ============================================================================
 *
 * [설명]
 * 지역 즐겨찾기(별표) 토글 기능과 토스트 메시지 표출을 담당합니다.
 *
 * [즐겨찾기 동작]
 * - 별표(☆) 클릭 → 현재 지역을 즐겨찾기로 저장 (★)
 *   → 토스트: "이제부터 ○○해역을 우선적으로 표출합니다."
 * - 별표(★) 다시 클릭 → 즐겨찾기 해제 (☆)
 *   → 토스트: "즐겨찾기가 해제되었습니다. 전국으로 표출합니다."
 * - 다음 앱 접속 시 즐겨찾기 지역이 기본 선택됨
 *
 * [연계 파일]
 * - ocean_condition1.js → OceanForecast 전역 상태, OCEAN_FAV_KEY 상수
 * - index.html → #ocean-forecast-fav-btn 버튼
 * ============================================================================
 */

// ============================================================================
// 즐겨찾기 토글
// ============================================================================

/**
 * 현재 선택된 지역의 즐겨찾기 상태를 토글
 *
 * [동작]
 * 1. 현재 지역이 이미 즐겨찾기 → 해제 (localStorage 삭제)
 * 2. 현재 지역이 즐겨찾기 아님 → 등록 (localStorage 저장)
 * 3. 별표 아이콘 갱신
 * 4. 토스트 메시지 표출
 *
 * [호출 위치] ocean_condition1.js → 즐겨찾기 버튼 click 이벤트
 */
window.toggleOceanFavorite = function () {
    var state = window.OceanForecast;
    var currentArea = state.currentArea;
    var areaName = state.areas[currentArea] || currentArea;

    if (state.favoriteArea === currentArea) {
        // 이미 즐겨찾기된 지역 → 해제
        state.favoriteArea = null;
        localStorage.removeItem(OCEAN_FAV_KEY);
        showOceanToast('즐겨찾기가 해제되었습니다. 전국으로 표출합니다.');
    } else {
        // 새로 즐겨찾기 등록
        state.favoriteArea = currentArea;
        localStorage.setItem(OCEAN_FAV_KEY, currentArea);
        showOceanToast('이제부터 ' + areaName + '해역을 우선적으로 표출합니다.');
    }

    // 별표 아이콘 갱신
    window.updateOceanFavIcon();
};

// ============================================================================
// 즐겨찾기 아이콘 갱신
// ============================================================================

/**
 * 즐겨찾기 버튼의 별표 아이콘을 현재 상태에 맞게 갱신
 * - 즐겨찾기 설정됨 + 현재 지역이 즐겨찾기 → ★ (채워진 별, 노란색)
 * - 그 외 → ☆ (빈 별)
 *
 * [호출 위치]
 * - ocean_condition1.js → initOceanForecast() (초기화)
 * - ocean_condition1.js → 드롭다운 change 이벤트 (지역 변경)
 * - toggleOceanFavorite() (즐겨찾기 토글)
 */
window.updateOceanFavIcon = function () {
    var state = window.OceanForecast;
    var favBtn = document.getElementById('ocean-forecast-fav-btn');
    if (!favBtn) return;

    var icon = favBtn.querySelector('i');
    if (!icon) return;

    if (state.favoriteArea && state.favoriteArea === state.currentArea) {
        // 현재 지역이 즐겨찾기됨 → 채워진 별 (★)
        icon.className = 'fa-solid fa-star';
        favBtn.classList.add('active');
    } else {
        // 즐겨찾기 아님 → 빈 별 (☆)
        icon.className = 'fa-regular fa-star';
        favBtn.classList.remove('active');
    }
};

// ============================================================================
// 토스트 메시지
// ============================================================================

/**
 * 화면 하단에 토스트 메시지를 표시하고 2초 후 자동 제거
 *
 * [UI]
 * ┌─────────────────────────────────────┐
 * │  이제부터 부산해역을                 │
 * │  우선적으로 표출합니다.              │
 * └─────────────────────────────────────┘
 *          (2초 후 페이드아웃)
 *
 * @param {string} message - 표시할 메시지
 *
 * [호출 위치] toggleOceanFavorite()
 */
function showOceanToast(message) {
    // 기존 토스트가 있으면 제거
    var existing = document.getElementById('ocean-forecast-toast');
    if (existing) existing.remove();

    // 토스트 요소 생성
    var toast = document.createElement('div');
    toast.id = 'ocean-forecast-toast';
    toast.className = 'ocean-forecast-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 표시 애니메이션 (약간의 딜레이 후 show 클래스 추가)
    requestAnimationFrame(function () {
        toast.classList.add('show');
    });

    // 2초 후 자동 제거
    setTimeout(function () {
        toast.classList.remove('show');
        // 페이드아웃 애니메이션(0.3초) 후 DOM에서 제거
        setTimeout(function () {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 2000);
}
