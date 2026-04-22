/**
 * index2_patch.js
 * index2.html 전용 패치 스크립트
 *
 * [역할]
 * 1. 하단 탭 바 구조에 맞춰 탭 그룹 매핑 데이터를 오버라이드
 *    - ocean-group 신규 추가 (해양종합/조석정보/해안 CCTV)
 * 2. 하단 메인탭 바의 실측 높이를 CSS 변수(--main-tab-height)로 주입
 *    → #ocean-map-section 의 슬라이더가 메인탭에 가리지 않도록 bottom 보정
 * 3. switchMainTab / switchSubTab 을 래핑하여:
 *    - 헤더를 특보정보 탭에서만 표시, 나머지 탭에서 숨김
 *    - 메인탭 클릭 시 해당 그룹 서브탭 자동 펼침 (body.sub-tabs-open ON)
 *    - 서브탭 버튼 선택 시 서브탭 닫힘
 * 4. 본문(콘텐츠/지도) 터치 시 서브탭 자동 닫힘 (capture 리스너)
 * 5. enterOceanMapSection / exitOceanMapSection 오버라이드
 *
 * [로드 순서] settings.js, marine.js 이후에 로드되어야 함
 *
 * [연계 파일]
 * - index2.html → 하단 탭 바 HTML (#bottom-tab-bar, .bottom-sub-tabs)
 *                 :root CSS 변수 --main-tab-height / --sub-tab-height
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
// 2. 메인탭 바 실측 높이 반영
//    [왜 필요한가?]
//     - 메인탭이 "아이콘+라벨 2단" 구조로 바뀌면서 버튼 높이가
//       기기/폰트/safe-area 에 따라 다르게 렌더됨.
//     - CSS 에서 고정값(68px) 으로 잡으면 실제 높이가 그보다 크면
//       #ocean-map-section 내부의 ocean-legend 슬라이더가 메인탭
//       바 뒤로 숨어 안 보이는 문제가 생김.
//     - 해결: 메인탭 바의 실측 offsetHeight 를 CSS 변수
//       --main-tab-height 에 주입하여, 섹션 bottom / content-area
//       padding-bottom / 서브탭 위치가 모두 정확히 맞춰지게 함.
//
//    [연계]
//     - index2.html :root { --main-tab-height: 68px } 기본값을 덮어씀
//     - #ocean-map-section.tab-content.active { bottom: calc(var(--main-tab-height) + ...) }
//     - body.sub-tabs-open #ocean-map-section ... 에도 동일 변수 사용
//     - .bottom-sub-tabs 의 bottom 도 같은 높이로 세팅
// ──────────────────────────────────────────────────────────────

/**
 * 하단 메인탭 바의 실측 높이를 측정하여 다음을 갱신:
 * 1) CSS 변수 --main-tab-height : ocean 섹션/콘텐츠 패딩 계산에 사용
 * 2) 서브탭 nav 의 bottom : 메인탭 바 바로 위에 붙도록
 *
 * [호출 시점]
 *  - 페이지 초기 로드 직후 (requestAnimationFrame)
 *  - 윈도우 리사이즈 / 방향 전환 시
 *  - 탭 전환 등으로 높이가 변할 가능성이 있을 때
 */
function updateSubTabsBottomPosition() {
    var tabBar = document.getElementById('bottom-tab-bar');
    if (!tabBar) return;
    // 메인탭 바의 전체 높이 (내부 padding + safe-area 하단 포함)
    var barHeight = tabBar.offsetHeight;

    // ① CSS 변수 주입 : 섹션 bottom 및 content-area padding 계산에 반영
    document.documentElement.style.setProperty('--main-tab-height', barHeight + 'px');

    // ② 서브탭 nav 의 bottom 값도 동기화 (메인탭 바 바로 위에 붙임)
    var subNavs = document.querySelectorAll('.bottom-sub-tabs');
    for (var i = 0; i < subNavs.length; i++) {
        subNavs[i].style.bottom = barHeight + 'px';
    }
}

// 초기 실행 + 화면 크기/방향 변경 시 재계산
requestAnimationFrame(updateSubTabsBottomPosition);
window.addEventListener('resize', updateSubTabsBottomPosition);
window.addEventListener('orientationchange', updateSubTabsBottomPosition);

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
//    - 메인탭 클릭 시 해당 그룹 서브탭 자동 열림 (+ body.sub-tabs-open)
//    - ocean-map-active 클래스 관리
//
//   [UX 흐름 — 사용자 지정]
//    1) 메인탭 클릭 → 대상 섹션 표시 + 서브탭 자동 펼침 (이미지 2 상태)
//    2) 본문(지도/콘텐츠) 터치 → 서브탭 자동 닫힘 (아래 6번 리스너)
//    3) 메인탭 재클릭 → 같은 섹션 유지, 서브탭 다시 펼침 (2번 거쳐 닫힌 경우 복원)
//    → 종합기상에서도 슬라이더는 서브탭 open 시엔 서브탭 위로 밀려서
//      항상 조작 가능, 본문 터치로 서브탭을 닫으면 풀지도 상태 진입.
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

    // ③ 전환 전에 모든 서브탭을 일단 닫아둠 (다음 단계에서 필요 시 다시 연다)
    _closeAllBottomSubTabs();

    // ④ marine.js 원본 switchMainTab 호출 (실제 섹션 전환 수행)
    //    원본은 내부에서 해당 그룹의 서브탭에 .sub-tabs-visible 를 붙이지만,
    //    우리는 body.sub-tabs-open 클래스도 함께 동기화해야 하므로
    //    호출 후 한번 정리하고 _openSubTabsFor 로 재오픈함.
    _origSwitchMainTab.call(window, targetId);

    // ⑤ 그룹탭(또는 그룹 내 섹션ID)이면 서브탭 자동 열기
    //    - targetId 가 그룹ID → 자신이 그룹
    //    - targetId 가 섹션ID → SECTION_TO_GROUP 으로 그룹 역매핑 후 오픈
    //    독립 섹션(promo-section 공지사항)은 TAB_GROUP_SUBTABS 매핑이 없어 자동 스킵
    var groupForSub = TAB_GROUP_DEFAULTS[targetId] ? targetId : SECTION_TO_GROUP[targetId];
    if (groupForSub && TAB_GROUP_SUBTABS[groupForSub]) {
        // 원본이 이미 .sub-tabs-visible 을 붙였을 수 있으므로 먼저 리셋 후 open
        _closeAllBottomSubTabs();
        _openSubTabsFor(groupForSub);
    }

    // ⑥ ocean-map-section이 활성화되면 지도 크기 갱신
    //    (서브탭 open 상태로 진입하므로 slider 는 서브탭 위에 위치)
    var isGroupTab = !!TAB_GROUP_DEFAULTS[targetId];
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
// 5-2. 본문(콘텐츠) 터치 시 서브탭 자동 닫힘 리스너
//      [UX 요구]
//       - 메인탭 클릭 시엔 서브탭이 자동으로 열리되,
//       - 사용자가 "떠있는 화면"(지도/콘텐츠)을 한 번이라도 터치하면
//         서브탭은 스스로 닫혀서 풀 화면 상태가 되어야 함.
//
//      [판정]
//       - 클릭 타겟이 .bottom-main-tabs 또는 .bottom-sub-tabs 안쪽이면 무시
//         (메인탭/서브탭 버튼 자체 동작은 보존)
//       - 그 외의 모든 영역 클릭 → 현재 열려 있는 서브탭을 닫음
//         (이미 닫혀있으면 아무 일도 하지 않음)
//
//      [capture phase 사용 이유]
//       - 지도/오버레이 버튼들이 자체적으로 stopPropagation() 을 호출할 수
//         있으므로, bubble phase 에서는 이벤트가 안 올 수 있음.
//       - capture 로 document 에서 먼저 받아 무조건 실행함.
//
//      [주의] 닫기만 수행, 다른 동작(예: 지도 드래그) 에는 영향 없음.
// ──────────────────────────────────────────────────────────────
function _handleContentTouchClose(ev) {
    // 서브탭이 열려있지 않으면 처리할 필요 없음
    if (!document.body.classList.contains('sub-tabs-open')) return;

    var tgt = ev.target;
    if (!tgt || !tgt.closest) return;

    // 메인탭/서브탭 바 내부 클릭은 무시 (버튼 자체의 전환 동작 보존)
    if (tgt.closest('.bottom-main-tabs')) return;
    if (tgt.closest('.bottom-sub-tabs')) return;

    // 그 외 모든 영역 → 서브탭 닫기
    _closeAllBottomSubTabs();
}

// capture 단계에서 등록 (이벤트 흐름 초기에 받아 stopPropagation 영향 최소화)
document.addEventListener('click', _handleContentTouchClose, true);
// 모바일 탭 이전에도 반응하도록 touchstart 도 함께 등록
document.addEventListener('touchstart', _handleContentTouchClose, true);

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
