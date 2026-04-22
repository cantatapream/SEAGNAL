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
//    - null       : 어떤 서브탭도 열려있지 않음
//    - 'xxx-group': 해당 그룹의 서브탭이 현재 펼쳐져 있음
// ──────────────────────────────────────────────────────────────
var _currentOpenSubGroup = null;

/**
 * [헬퍼] 모든 하단 서브탭 패널을 닫고 body.sub-tabs-open 클래스도 제거
 *
 * [왜 필요한가?]
 *  - 서브탭이 열려 있으면 #ocean-map-section 하단의 슬라이더 영역을 덮어버림
 *  - CSS(body.sub-tabs-open #ocean-map-section.tab-content.active)에서
 *    서브탭이 열려 있을 때는 섹션 바닥을 더 올려서 슬라이더가 보이도록 처리
 *  - 따라서 서브탭 상태 변화 시 body 클래스도 함께 동기화해야 함
 *
 * [호출처]
 *  - switchMainTab: 탭 전환 전/토글 시
 *  - switchSubTab : 서브탭 버튼 클릭 시 (선택 후 자동 닫힘)
 */
function _closeAllBottomSubTabs() {
    var allSubNavs = document.querySelectorAll('.bottom-sub-tabs');
    for (var i = 0; i < allSubNavs.length; i++) {
        allSubNavs[i].classList.remove('sub-tabs-visible');
    }
    // body 클래스 제거 → CSS 원복 (섹션 바닥이 다시 메인탭 높이만큼만 올라감)
    document.body.classList.remove('sub-tabs-open');
    _currentOpenSubGroup = null;
}

/**
 * [헬퍼] 특정 그룹의 서브탭 패널을 펼침 + body 클래스 동기화
 *
 * @param {string} groupId  - 'weather-group' / 'ocean-group' / 'ocean-life-group'
 *
 * [동작]
 *  1) TAB_GROUP_SUBTABS[groupId]로 서브탭 nav 요소를 찾음
 *  2) 해당 nav에 .sub-tabs-visible 추가 → CSS transition으로 펼쳐짐
 *  3) body에 .sub-tabs-open 추가 → 섹션 바닥이 서브탭 높이만큼 추가로 올라감
 *  4) _currentOpenSubGroup 갱신 (재클릭 토글용)
 */
function _openSubTabsFor(groupId) {
    var subNavId = TAB_GROUP_SUBTABS[groupId];
    if (!subNavId) return;
    var subNav = document.getElementById(subNavId);
    if (!subNav) return;
    subNav.classList.add('sub-tabs-visible');
    document.body.classList.add('sub-tabs-open');
    _currentOpenSubGroup = groupId;
}

// ──────────────────────────────────────────────────────────────
// 4. switchMainTab 래핑 (INDEX2 전용 동작)
//    marine.js의 원본 switchMainTab을 감싸서 다음을 추가:
//    - body[data-active-tab] 설정 → CSS로 헤더 표출/숨김 제어
//    - 서브탭 "자동 열기" 제거 → 처음 진입 시 서브탭은 접힘 상태
//    - 같은 메인탭 재클릭 시 서브탭 토글(열기↔닫기)
//    - ocean-map-active 클래스 관리
//
//   [설계 변경 이유]
//    종합기상(ocean-group) 진입 시 서브탭이 자동으로 펼쳐지면
//    #ocean-map-section 하단의 슬라이더(범례+타임라인)를 덮어버려
//    사용자가 슬라이더를 조작할 수 없었음.
//    → 처음 진입할 때는 서브탭을 접어두고, 사용자가 메인탭을 다시
//      눌렀을 때만 펼치는 방식으로 변경 (UX 일관성 위해 모든 그룹탭 동일).
// ──────────────────────────────────────────────────────────────
var _origSwitchMainTab = window.switchMainTab;

window.switchMainTab = function (targetId) {
    // ⓘ 이전 활성 그룹 기억 (재클릭 판정용)
    //   - body[data-active-tab] 은 직전 탭 전환 시 세팅된 값
    //   - ①에서 덮어쓰기 전에 미리 읽어 두어야 "같은 그룹 재클릭" 을 판정 가능
    var prevActiveGroup = document.body.getAttribute('data-active-tab');

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

    // ③ 그룹탭 재클릭 토글 처리 (원본 switchMainTab 호출 전에 결정)
    //    [판정 기준] 이전 활성 그룹 === 지금 누른 그룹 → 재클릭
    //    - 서브탭이 열려있으면 → 닫기
    //    - 서브탭이 닫혀있으면 → 열기
    //    - 콘텐츠(섹션)는 이미 표시 중이므로 원본 전환 불필요 → 여기서 return
    var isGroupTab = !!TAB_GROUP_DEFAULTS[targetId];
    if (isGroupTab && prevActiveGroup === targetId) {
        var reSubNav = document.getElementById(TAB_GROUP_SUBTABS[targetId]);
        if (reSubNav && reSubNav.classList.contains('sub-tabs-visible')) {
            // 이미 열림 → 닫기 (body.sub-tabs-open 도 함께 제거)
            _closeAllBottomSubTabs();
        } else {
            // 닫혀있음 → 열기 (body.sub-tabs-open 추가 → 섹션 바닥 상향)
            _openSubTabsFor(targetId);
        }
        return;
    }

    // ④ 다른 그룹/섹션으로 전환 → 모든 하단 서브탭 먼저 닫기
    _closeAllBottomSubTabs();

    // ⑤ marine.js 원본 switchMainTab 호출 (실제 탭 전환 수행)
    //    원본은 내부에서 해당 그룹 서브탭에 .sub-tabs-visible 를 붙이므로,
    //    호출 직후 다시 한 번 전체 서브탭을 닫아 "처음 진입 시 접힘" 상태 보장.
    _origSwitchMainTab.call(window, targetId);

    // ⑥ 원본이 붙인 .sub-tabs-visible 제거 (자동 open 비활성화)
    //    - _currentOpenSubGroup도 null 유지
    //    - body.sub-tabs-open도 제거된 상태 유지 → 섹션 바닥 원복
    _closeAllBottomSubTabs();

    // ⑦ ocean-map-section이 활성화되면 지도 크기 갱신
    //    (서브탭이 닫힌 상태로 진입하므로 슬라이더가 안 가려짐)
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

    // ② 서브탭 패널 닫기 + body.sub-tabs-open 제거
    //    → #ocean-map-section 바닥이 원복되어 슬라이더가 메인탭만 피하는 위치로 복귀
    _closeAllBottomSubTabs();

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
