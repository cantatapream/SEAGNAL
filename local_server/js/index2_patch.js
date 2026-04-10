/**
 * index2_patch.js
 * index2.html 전용 패치 스크립트
 *
 * [역할]
 * 1. 하단 탭 바 구조에 맞춰 탭 그룹 매핑 데이터를 오버라이드
 * 2. switchMainTab / switchSubTab을 래핑하여:
 *    - 헤더를 특보정보 탭에서만 표시, 나머지 탭에서 숨김
 *    - 서브탭을 하단 메인탭 위에 토글(열기/닫기)
 *    - 서브탭 선택 시 자동으로 서브탭 닫기
 * 3. enterOceanMapSection / exitOceanMapSection 오버라이드
 * 4. 하단 서브탭 위치(bottom)를 메인탭 바 높이에 맞춰 동적 계산
 *
 * [로드 순서] settings.js, marine.js 이후에 로드되어야 함
 *
 * [연계 파일]
 * - index2.html → 하단 탭 바 HTML (#bottom-tab-bar, .bottom-sub-tabs)
 * - js/marine.js → switchMainTab(), switchSubTab(), TAB_GROUP_DEFAULTS 등
 * - js/settings.js → .tab-btn, .sub-tab-btn 클릭 이벤트 바인딩
 */

// ═══════════════════════════════════════════════════
// 페이지 구분: index2가 아니면 아래 코드 전체 스킵
// ═══════════════════════════════════════════════════
if (window.__SEAGNAL_PAGE === 'index2') {

// ──────────────────────────────────────────────────────────────
// 1. 탭 그룹 매핑 데이터 오버라이드
//    marine.js에서 정의된 전역 상수를 INDEX2 탭 구조에 맞게 수정
//    - ocean-group 신규 추가 (해양종합, 조석정보, 해안 CCTV)
//    - cctv-section을 weather-group → ocean-group으로 이동
//    - tide-section을 독립 탭 → ocean-group 서브탭으로 이동
// ──────────────────────────────────────────────────────────────

// 그룹 → 기본 서브섹션: 그룹 탭 클릭 시 처음 보여줄 섹션
TAB_GROUP_DEFAULTS['ocean-group'] = 'ocean-map-section';

// 그룹 → 서브탭 nav ID: 어떤 서브탭 패널을 열지
TAB_GROUP_SUBTABS['ocean-group'] = 'ocean-sub-tabs';

// 섹션 → 소속 그룹 역매핑 (섹션 ID로 switchMainTab 호출 시 그룹 찾기용)
// cctv-section: weather-group에서 ocean-group으로 이동
SECTION_TO_GROUP['cctv-section'] = 'ocean-group';
// tide-section: 독립 탭에서 ocean-group 서브탭으로 이동
SECTION_TO_GROUP['tide-section'] = 'ocean-group';
// ocean-map-section: 독립 탭에서 ocean-group 기본 서브탭으로 이동
SECTION_TO_GROUP['ocean-map-section'] = 'ocean-group';

// ──────────────────────────────────────────────────────────────
// 2. 서브탭 bottom 위치 계산
//    메인탭 바의 실제 높이를 측정하여 서브탭이 그 바로 위에 표시되도록 함
//    화면 크기 변경 시에도 재계산
// ──────────────────────────────────────────────────────────────

/**
 * 하단 서브탭의 bottom 위치를 메인탭 바 높이에 맞춰 갱신
 * 메인탭 바가 렌더링된 후 호출해야 정확한 높이를 얻을 수 있음
 */
function updateSubTabsBottomPosition() {
    var tabBar = document.getElementById('bottom-tab-bar');
    if (!tabBar) return;
    // 메인탭 바의 전체 높이 (패딩, safe-area 포함)
    var barHeight = tabBar.offsetHeight;
    // 모든 하단 서브탭 nav에 bottom 값 설정
    var subNavs = document.querySelectorAll('.bottom-sub-tabs');
    for (var i = 0; i < subNavs.length; i++) {
        subNavs[i].style.bottom = barHeight + 'px';
    }
}

// 초기 실행 + 화면 크기 변경 시 재계산
requestAnimationFrame(updateSubTabsBottomPosition);
window.addEventListener('resize', updateSubTabsBottomPosition);

// ──────────────────────────────────────────────────────────────
// 3. 현재 열려 있는 서브탭 그룹 추적 변수
//    같은 메인탭을 다시 클릭하면 서브탭을 토글(열기/닫기)하기 위해 사용
// ──────────────────────────────────────────────────────────────
var _currentOpenSubGroup = null;  // 현재 열려 있는 서브탭의 그룹 ID (없으면 null)

// ──────────────────────────────────────────────────────────────
// 4. switchMainTab 래핑
//    marine.js의 원본 switchMainTab을 감싸서 INDEX2 전용 동작 추가:
//    - body[data-active-tab] 설정 → CSS로 헤더 표출/숨김 제어
//    - 서브탭 토글: 같은 탭 재클릭 → 서브탭 열기/닫기
//    - ocean-map-active 클래스 관리
// ──────────────────────────────────────────────────────────────
var _origSwitchMainTab = window.switchMainTab;

window.switchMainTab = function (targetId) {
    // ① 활성 탭 속성 설정 (헤더 표출/숨김은 CSS가 처리)
    //    weather-group이면 헤더 표시, 나머지면 숨김
    var activeGroup = targetId;
    // targetId가 섹션 ID인 경우 소속 그룹으로 변환
    if (SECTION_TO_GROUP[targetId]) {
        activeGroup = SECTION_TO_GROUP[targetId];
    }
    document.body.setAttribute('data-active-tab', activeGroup);

    // ② ocean-map-active 클래스 관리
    //    ocean-map-section이 표시되지 않으면 제거
    if (targetId !== 'ocean-map-section' && activeGroup !== 'ocean-group') {
        document.body.classList.remove('ocean-map-active');
        document.documentElement.style.removeProperty('--ocean-top-offset');
    }

    // ③ 서브탭 토글 로직
    //    그룹 탭(서브탭이 있는 탭)을 클릭했을 때:
    //    - 이미 열려있으면 닫기 (서브탭만 닫고, 콘텐츠는 유지)
    //    - 닫혀있으면 열기
    var isGroupTab = !!TAB_GROUP_DEFAULTS[targetId];
    if (isGroupTab) {
        var subNavId = TAB_GROUP_SUBTABS[targetId];
        var subNav = document.getElementById(subNavId);

        if (_currentOpenSubGroup === targetId && subNav && subNav.classList.contains('sub-tabs-visible')) {
            // 같은 그룹 재클릭 → 서브탭 닫기 (콘텐츠는 그대로 유지)
            subNav.classList.remove('sub-tabs-visible');
            _currentOpenSubGroup = null;
            return; // 탭 전환 없이 서브탭만 토글
        }
    }

    // ④ 모든 하단 서브탭 닫기 (새 탭으로 전환하므로)
    var allSubNavs = document.querySelectorAll('.bottom-sub-tabs');
    for (var i = 0; i < allSubNavs.length; i++) {
        allSubNavs[i].classList.remove('sub-tabs-visible');
    }

    // ⑤ marine.js 원본 switchMainTab 호출 (실제 탭 전환 수행)
    _origSwitchMainTab.call(window, targetId);

    // ⑥ 그룹 탭이면 서브탭 열기
    if (isGroupTab) {
        var subNavId2 = TAB_GROUP_SUBTABS[targetId];
        var subNav2 = document.getElementById(subNavId2);
        if (subNav2) {
            subNav2.classList.add('sub-tabs-visible');
        }
        _currentOpenSubGroup = targetId;
    } else {
        _currentOpenSubGroup = null;
    }

    // ⑦ ocean-map-section이 활성화되면 지도 크기 갱신
    if (targetId === 'ocean-map-section' || (isGroupTab && targetId === 'ocean-group')) {
        document.body.classList.add('ocean-map-active');
        requestAnimationFrame(function () {
            if (window.getOceanMap) {
                var m = window.getOceanMap();
                if (m && m.updateSize) m.updateSize();
            }
        });
    }
};

// ──────────────────────────────────────────────────────────────
// 5. switchSubTab 래핑
//    서브탭 클릭 시 서브탭 패널을 자동으로 닫음
//    (사용자 요구: 서브탭 중 하나를 선택하면 서브탭은 닫혀야 함)
// ──────────────────────────────────────────────────────────────
var _origSwitchSubTab = window.switchSubTab;

window.switchSubTab = function (targetId) {
    // ① 원본 switchSubTab 호출 (섹션 전환 수행)
    _origSwitchSubTab.call(window, targetId);

    // ② 서브탭 패널 닫기
    var allSubNavs = document.querySelectorAll('.bottom-sub-tabs');
    for (var i = 0; i < allSubNavs.length; i++) {
        allSubNavs[i].classList.remove('sub-tabs-visible');
    }
    _currentOpenSubGroup = null;

    // ③ ocean-map-section이 선택되면 ocean-map-active 클래스 추가 + 지도 갱신
    if (targetId === 'ocean-map-section') {
        document.body.classList.add('ocean-map-active');
        requestAnimationFrame(function () {
            if (window.getOceanMap) {
                var m = window.getOceanMap();
                if (m && m.updateSize) m.updateSize();
            }
        });
    } else {
        // ocean-map-section이 아닌 서브탭 → ocean-map-active 제거
        document.body.classList.remove('ocean-map-active');
        document.documentElement.style.removeProperty('--ocean-top-offset');
    }
};

// ──────────────────────────────────────────────────────────────
// 6. enterOceanMapSection 오버라이드
//    INDEX1에서는 팝업으로 열리지만, INDEX2에서는 종합기상 그룹의
//    해양종합 서브탭으로 전환
// ──────────────────────────────────────────────────────────────
window.enterOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    // ocean-group(종합기상)의 기본 서브탭이 ocean-map-section(해양종합)
    window.switchMainTab('ocean-group');
};

// ──────────────────────────────────────────────────────────────
// 7. exitOceanMapSection 오버라이드
//    해양종합 화면에서 벗어날 때, 특보정보 탭으로 복귀
// ──────────────────────────────────────────────────────────────
window.exitOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    section.classList.remove('active');
    document.body.classList.remove('ocean-map-active');
    document.documentElement.style.removeProperty('--ocean-top-offset');

    // 이전 활성 섹션이 있으면 복원, 없으면 특보정보 기본 탭으로 이동
    var fallbackId = null;
    if (window._oceanPrevActiveSections && window._oceanPrevActiveSections.length) {
        for (var i = 0; i < window._oceanPrevActiveSections.length; i++) {
            var el = document.getElementById(window._oceanPrevActiveSections[i]);
            if (el) el.classList.add('active');
            if (!fallbackId) fallbackId = window._oceanPrevActiveSections[i];
        }
        window._oceanPrevActiveSections = [];
    }

    if (!fallbackId) fallbackId = 'weather-alert-section';
    window.switchMainTab(fallbackId);

    if (window.PopupStack) {
        window.PopupStack.remove('ocean-map-section');
    }
};

// ──────────────────────────────────────────────────────────────
// 8. 초기 상태 설정
//    페이지 로드 시 기본 탭(특보정보)에 맞춰 body 속성 설정
// ──────────────────────────────────────────────────────────────
document.body.setAttribute('data-active-tab', 'weather-group');

} // end if (window.__SEAGNAL_PAGE === 'index2')
