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
// 1. 탭 그룹 매핑 데이터 (INDEX2 탭 구조)
//    ──────────────────────────────────────────────────────────
//    [현재 INDEX2 메인탭 구성]
//      특보정보(그룹) | 해양종합정보(독립섹션) | 해양생활(그룹) | 공지사항(독립섹션)
//
//    [이전 ocean-group 삭제 이력]
//      - 해안 CCTV 를 해양종합으로 통합 → cctv-section 섹션 삭제
//      - 조석정보 서브탭/섹션 삭제 (index2 전용)
//      - 결과적으로 해양종합정보 는 서브탭이 없는 독립 섹션 탭이 됨
//      → ocean-group (TAB_GROUP_*) 매핑 불필요 → 모두 제거
// ──────────────────────────────────────────────────────────────
// [제거됨] TAB_GROUP_DEFAULTS['ocean-group']  — 서브탭 없음
// [제거됨] TAB_GROUP_SUBTABS['ocean-group']   — 서브탭 없음
// [제거됨] SECTION_TO_GROUP['tide-section']    — 조석정보 섹션 제거
// [제거됨] SECTION_TO_GROUP['ocean-map-section'] — 독립 섹션탭으로 전환
// [제거됨] SECTION_TO_GROUP['cctv-section']    — 해안CCTV 섹션 통합됨

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
    // 섹션 bottom 변화 → 활성 지도 canvas 리사이즈 트리거 (하단 빈 공간 방지)
    _scheduleActiveMapResize();
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
    // 서브탭 실측 높이 → --sub-tab-height 변수 동기화
    //  (CSS :root 기본값은 50px 이지만 실제 버튼 높이는 내용/폰트에 따라
    //   이보다 작게 렌더링됨. 고정값을 쓰면 섹션이 50px 만큼 올라가는데
    //   바는 30여 px 밖에 채우지 못해 바 위쪽에 빈 공간이 생김.)
    _syncSubTabHeightVar(subNav);
    // 섹션 bottom 변화 → 활성 지도 canvas 리사이즈 트리거 (하단 빈 공간 방지)
    _scheduleActiveMapResize();
}

/**
 * [헬퍼] 현재 열린 서브탭 nav 의 실측 높이를 --sub-tab-height CSS 변수에 주입
 *
 * [타이밍/측정]
 *  - 즉시(RAF): scrollHeight(컨텐츠 원본 높이) + CSS max-height(50px) 캡
 *    → max-height 트랜지션이 0→50 으로 진행 중이라 offsetHeight 는 중간값을
 *      리턴하지만, scrollHeight 는 트랜지션과 무관하게 "컨텐츠가 차지하는
 *      내재 높이" 이므로 시작 직후에도 올바른 최종값을 얻을 수 있음.
 *  - 400ms 후 : 트랜지션 종료 후 offsetHeight 실측으로 최종 보정.
 *
 *  [왜 scrollHeight?]
 *    offsetHeight 는 transition 중의 CSS height(= clip 된 값)을 반환하므로
 *    첫 RAF(≈16ms) 시점에서 매우 작은 값(≈2px)이 찍힘 → 섹션이 너무 길게
 *    계산되어 서브탭 위쪽으로 지도 컨텐츠가 비쳐 보이는 역효과 발생.
 */
function _syncSubTabHeightVar(subNav) {
    function _applyScrollHeight() {
        var sh = subNav.scrollHeight;
        if (sh > 0) {
            // CSS .sub-tabs.sub-tabs-visible { max-height: 50px } 제약 반영
            document.documentElement.style.setProperty('--sub-tab-height', Math.min(sh, 50) + 'px');
            _scheduleActiveMapResize();
        }
    }
    function _applyOffsetHeight() {
        var h = subNav.offsetHeight;
        if (h > 0) {
            document.documentElement.style.setProperty('--sub-tab-height', h + 'px');
            _scheduleActiveMapResize();
        }
    }
    // 즉시: 트랜지션과 무관한 내재 높이 기반 추정
    requestAnimationFrame(_applyScrollHeight);
    // 트랜지션 종료 후: 최종 렌더 높이 기반 보정
    setTimeout(_applyOffsetHeight, 400);
}

/**
 * [헬퍼] 하위탭 토글로 섹션 bottom 이 바뀌면 그에 맞춰 현재 활성화된
 * OpenLayers 지도 canvas 를 리사이즈한다.
 *
 * [왜 필요한가?]
 *  body.sub-tabs-open 클래스 토글로 섹션의 CSS bottom 이 변하면 DOM 박스는
 *  줄어들거나 커지지만, 내부의 OL 지도 canvas 는 이전 크기 그대로 렌더되어
 *  "지도 canvas 가 컨테이너보다 큼/작음" 상태가 됨. 사용자 제보:
 *   - 하위탭 열림: 지도 하단과 하위탭 사이에 빈 공간 발생
 *   - 하위탭 닫힘: 지도 하단이 메인탭과 딱 붙음 (정상)
 *  해결: body 클래스 변경 시점에 각 섹션의 지도 updateSize() 를 호출.
 *
 * [타이밍]
 *  CSS transition(350ms) 이 끝나기 전에 여러 번 호출하도록 RAF + 지연
 *  조합. 두 번 호출(즉시 + 400ms 후)해 애니메이션 도중/완료 후 모두 갱신.
 *
 * [대상 지도]
 *  - 해양종합정보: window.getOceanMap()
 *  - 바다낚시:     window.getFishingMap() (fishing.js 가 export)
 *  - 서핑:         window._surfing.map (surfing1.js)
 *  각 getter 는 null 가능성 있으므로 방어적으로 호출.
 */
function _scheduleActiveMapResize() {
    function _resizeAll() {
        try {
            var m1 = window.getOceanMap && window.getOceanMap();
            if (m1 && m1.updateSize) m1.updateSize();
        } catch (e) {}
        try {
            var m2 = window.getFishingMap && window.getFishingMap();
            if (m2 && m2.updateSize) m2.updateSize();
        } catch (e) {}
        try {
            var m3 = (window._surfing && window._surfing.map) || null;
            if (m3 && m3.updateSize) m3.updateSize();
        } catch (e) {}
    }
    // 즉시 한 번 + transition 완료 후 한 번 (총 2회 호출해 중간 상태/최종 상태 모두 대응)
    requestAnimationFrame(_resizeAll);
    setTimeout(_resizeAll, 400);
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
    //    ocean-map-section 이 표시되지 않으면 제거
    //    (해양종합정보 메인탭은 독립 섹션탭이므로 targetId 검사로 충분)
    if (targetId !== 'ocean-map-section') {
        document.body.classList.remove('ocean-map-active');
        document.documentElement.style.removeProperty('--ocean-top-offset');
    }

    // ③ 전환 전에 모든 서브탭을 일단 닫아둠 (다음 단계에서 필요 시 다시 연다)
    _closeAllBottomSubTabs();

    // ③-2. 그룹탭 클릭 시 기본 하위탭으로 강제 초기화
    //  [배경] marine.js 원본 switchMainTab 은 "이전에 선택했던 .sub-tab-btn.active
    //         가 있으면 그 섹션을 표시" 하는 로직이라, 특보정보 탭에서 해구기상을
    //         보던 사용자가 다른 메인탭 다녀와도 해구기상이 유지됨. 사용자 요구:
    //         "특보정보 탭을 누르는 순간 무조건 '특보 및 전망' 하위탭".
    //  [구현] 원본 호출 직전에 해당 그룹의 서브탭 버튼 active 를 모두 제거하고
    //         기본 섹션(TAB_GROUP_DEFAULTS) 버튼에만 active 부여 → 원본이
    //         "active 버튼의 섹션" 을 찾을 때 기본 섹션으로 표시됨.
    //         단, targetId 가 명시적인 섹션ID인 경우는 사용자 의도를 존중해 스킵.
    var _groupForReset = TAB_GROUP_DEFAULTS[targetId] ? targetId : null;
    if (_groupForReset) {
        var _defaultSection = TAB_GROUP_DEFAULTS[_groupForReset];
        var _subNavId = TAB_GROUP_SUBTABS[_groupForReset];
        var _subNav = _subNavId && document.getElementById(_subNavId);
        if (_subNav && _defaultSection) {
            var _subBtns = _subNav.querySelectorAll('.sub-tab-btn');
            for (var _i = 0; _i < _subBtns.length; _i++) {
                _subBtns[_i].classList.toggle(
                    'active',
                    _subBtns[_i].getAttribute('data-target') === _defaultSection
                );
            }
        }
    }

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

    // ⑥ ocean-map-section 이 활성화되면 지도 크기 갱신 + 오버레이 파티클 재개
    //    해양종합정보 메인탭은 이제 독립 섹션탭이므로 targetId 만 체크하면 충분.
    //
    //    [오버레이 복귀 이슈]
    //     ocean_overlay.js 의 resizeCanvas() 는 map viewport 의
    //     getBoundingClientRect() 기준인데, 섹션이 display:none 상태에서 호출되면
    //     canvas 가 0x0 으로 줄어들어 _onCompositePrerender 에서 합성 스킵됨.
    //     → 다른 메인탭 다녀와서 복귀하면 파티클이 안 보이던 원인.
    //     해결: updateSize() 와 함께 oceanOverlayRefresh(map) 를 호출하여
    //           canvas 를 현재 viewport 크기로 재맞춤 + 파티클 가시성 복원.
    //           (내부 streamActive 가 true 이면 그대로 애니메이션 재개)
    //     타이밍: RAF 즉시 + 400ms 후 (섹션 트랜지션/서브탭 슬라이드 완료 후).
    if (targetId === 'ocean-map-section') {
        document.body.classList.add('ocean-map-active');
        function _oceanRevive() {
            try {
                if (!window.getOceanMap) return;
                var m = window.getOceanMap();
                if (!m) return;
                if (m.updateSize) m.updateSize();
                if (window.oceanOverlayRefresh) window.oceanOverlayRefresh(m);
                // OL 에 강제 렌더 요청 — prerender 훅을 재호출해 파티클 합성 재개
                if (m.render) m.render();
            } catch (e) {}
        }
        requestAnimationFrame(_oceanRevive);
        setTimeout(_oceanRevive, 400);

        // 세션 최초 진입 상단 토스트 — 같은 세션에서 한 번만 표시
        _showOceanFirstEntryToastIfNeeded();
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
//    INDEX1에서는 팝업으로 열리지만, INDEX2에서는 "해양종합정보"
//    메인탭(독립 섹션)으로 바로 전환.
// ──────────────────────────────────────────────────────────────
window.enterOceanMapSection = function () {
    var section = document.getElementById('ocean-map-section');
    if (!section) return;
    // 해양종합정보 메인탭 = ocean-map-section 섹션 (독립탭)
    window.switchMainTab('ocean-map-section');
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
// 8. 해양종합 전용 토스트 시스템
//    ──────────────────────────────────────────────────────────
//    [용도]
//     ① 세션 최초 해양종합 진입 안내 (상단, 2초)
//        "해역을 클릭하여 상세한 정보를 확인하세요"
//     ② 오버레이 버튼(파고/바람/조류) 클릭 시 설명 (하단, 2초)
//        - 파고:  "파고 및 파향의 현황을 표출합니다."
//        - 바람:  "풍향·속의 현황을 표출합니다."
//        - 조류:  "유향·속의 현황을 표출합니다."
//        (주요지명/기상부이/CCTV 는 토스트 없음)
//
//    [위치 계산 — 하단 토스트]
//     즐겨찾기 바(#ocean-fav-bar) 가 표시되어 있으면 그 바로 위에 표출.
//     즐겨찾기 바의 현재 CSS bottom(= --main-tab-height + optional legend + ...)
//     을 그대로 따라 올라가므로 바 상태(범례 표시 / 서브탭 열림 등) 에 자연히 적응.
// ──────────────────────────────────────────────────────────────

var _OCEAN_TOAST_ID = 'ocean-ui-toast';
var _OCEAN_FIRST_ENTRY_SESSION_KEY = 'ocean_first_entry_toast_shown_v1';
var _oceanToastTimer = null;

function _ensureOceanToastStyles() {
    if (document.getElementById('ocean-ui-toast-style')) return;
    var style = document.createElement('style');
    style.id = 'ocean-ui-toast-style';
    style.textContent = [
        '#' + _OCEAN_TOAST_ID + ' {',
        '  position: fixed;',
        '  left: 50%;',
        '  transform: translateX(-50%);',
        '  background: rgba(15, 23, 42, 0.92);',
        '  color: #fff;',
        '  font-size: 0.88rem;',
        '  font-weight: 500;',
        '  padding: 10px 18px;',
        '  border-radius: 999px;',
        '  border: 1px solid rgba(255,255,255,0.08);',
        '  box-shadow: 0 6px 20px rgba(0,0,0,0.45);',
        '  z-index: 9500;',
        '  pointer-events: none;',
        '  white-space: nowrap;',
        '  opacity: 0;',
        '  transition: opacity 0.2s ease;',
        '  max-width: calc(100vw - 40px);',
        '  text-overflow: ellipsis;',
        '  overflow: hidden;',
        '}',
        '#' + _OCEAN_TOAST_ID + '.visible { opacity: 1; }',
        // 긴 텍스트 허용 (옵션)
        '#' + _OCEAN_TOAST_ID + '.multi-line { white-space: normal; text-align: center; border-radius: 14px; }'
    ].join('\n');
    document.head.appendChild(style);
}

/**
 * 토스트 엘리먼트를 얻고(필요 시 생성) 공통 속성 초기화.
 */
function _getOceanToastEl() {
    _ensureOceanToastStyles();
    var el = document.getElementById(_OCEAN_TOAST_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = _OCEAN_TOAST_ID;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
    }
    return el;
}

/**
 * [공통] 토스트 표시
 * @param {string} message   표시 문구
 * @param {string} position  'top' | 'bottom'
 * @param {number} durationMs  표시 시간 (기본 2000)
 */
function _showOceanToast(message, position, durationMs) {
    if (!message) return;
    var el = _getOceanToastEl();
    el.textContent = message;
    el.classList.remove('multi-line');

    // 위치 계산
    if (position === 'top') {
        // 상단: safe-area + 16px
        el.style.bottom = '';
        el.style.top = 'calc(env(safe-area-inset-top, 0px) + 16px)';
    } else {
        // 하단: 즐겨찾기 바 위 (바가 숨겨져 있으면 메인탭 + 여유)
        el.style.top = '';
        el.style.bottom = _computeBottomToastOffsetPx() + 'px';
    }

    // 재표시 보장: class 토글을 RAF 로 한 틱 띄워 transition 유도
    el.classList.remove('visible');
    requestAnimationFrame(function () {
        el.classList.add('visible');
    });

    // 이전 타이머 취소 후 새 타이머
    if (_oceanToastTimer) {
        clearTimeout(_oceanToastTimer);
        _oceanToastTimer = null;
    }
    var dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : 2000;
    _oceanToastTimer = setTimeout(function () {
        el.classList.remove('visible');
        _oceanToastTimer = null;
    }, dur);
}

/**
 * 하단 토스트 bottom 픽셀값 계산.
 * 즐겨찾기 바가 표시되어 있으면 그 top 바로 위(8px 여유),
 * 아니면 --main-tab-height + (범례 보이면 +115) + 여유 값.
 */
function _computeBottomToastOffsetPx() {
    var favBar = document.getElementById('ocean-fav-bar');
    var favVisible = !!(favBar
        && !favBar.classList.contains('empty')
        && document.body.classList.contains('ocean-map-active')
        && !document.body.classList.contains('ocean-sheet-open')
        && favBar.offsetParent !== null);
    if (favVisible) {
        var rect = favBar.getBoundingClientRect();
        // 바 top 위 8px
        return Math.max(0, window.innerHeight - rect.top + 8);
    }
    // 즐겨찾기 바 없음 → 메인탭(+ 범례) 위로
    var mainStr = getComputedStyle(document.documentElement).getPropertyValue('--main-tab-height');
    var mainH = parseInt(mainStr, 10);
    if (!mainH || isNaN(mainH)) mainH = 68;
    var legendBoost = document.body.classList.contains('ocean-legend-visible') ? 115 : 0;
    var subTabBoost = document.body.classList.contains('sub-tabs-open') ? 50 : 0;
    return mainH + legendBoost + subTabBoost + 12;
}

/**
 * 세션 최초 해양종합 진입 시 상단 토스트 1회 표시.
 *  - sessionStorage 로 같은 세션 내 중복 표시 차단.
 *  - 새로 앱을 켜면(페이지 새로고침 포함) 다시 1회 표시.
 */
function _showOceanFirstEntryToastIfNeeded() {
    try {
        if (sessionStorage.getItem(_OCEAN_FIRST_ENTRY_SESSION_KEY) === '1') return;
        sessionStorage.setItem(_OCEAN_FIRST_ENTRY_SESSION_KEY, '1');
    } catch (e) { /* SS 접근 불가 환경에서도 동작은 계속 */ }
    // 섹션 전환 애니메이션 이후에 띄우도록 약간 지연
    setTimeout(function () {
        _showOceanToast('해역을 클릭하여 상세한 정보를 확인하세요', 'top', 2000);
    }, 200);
}

/**
 * 오버레이 버튼(파고/바람/조류) 클릭 시 하단 토스트 표출.
 * ocean_overlay.js 자체 click 핸들러와는 별도로, 동일 버튼에 "추가" 리스너를
 * bubble 단계로 붙여 기존 동작(레이어 전환)을 방해하지 않음.
 *
 * [동작 조건]
 *  - 버튼 클릭 결과 레이어가 '켜질 때' 만 토스트 표시
 *    (같은 버튼 재클릭으로 OFF 될 때는 표시 X — 버튼 active 상태로 판정)
 *  - data-layer 값: 'wave'(파고) | 'wind'(바람) | 'current'(조류)
 *  - 주요지명 / 기상부이 / CCTV 는 data-layer 미사용 → 이 리스너가 적용되지 않음
 */
var _OVERLAY_TOAST_MSG = {
    wave:    '파고 및 파향의 현황을 표출합니다.',
    wind:    '풍향·속의 현황을 표출합니다.',
    current: '유향·속의 현황을 표출합니다.'
};

function _bindOverlayButtonToasts() {
    var btns = document.querySelectorAll('.ocean-overlay-btn[data-layer]');
    for (var i = 0; i < btns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                // ocean_overlay.js 의 핸들러가 먼저 실행되어 active 클래스가 갱신된 뒤
                // 이 리스너가 실행됨. active 이면 "방금 켜진" 상태.
                // (버블 단계 기본 / 등록 순서가 뒤라 자연스러움)
                // 다만 동기 보장을 위해 rAF 지연으로 한 프레임 뒤 확인.
                requestAnimationFrame(function () {
                    if (!btn.classList.contains('active')) return;
                    var layer = btn.getAttribute('data-layer');
                    var msg = _OVERLAY_TOAST_MSG[layer];
                    if (msg) _showOceanToast(msg, 'bottom', 2000);
                });
            });
        })(btns[i]);
    }
}

// DOM 준비 후(혹은 ocean_overlay.js 가 버튼 바인딩한 뒤) 토스트 리스너 부착.
// DOMContentLoaded 후 한 번 + ocean_map 초기화 이후에도 한 번 — 둘 다 안전.
function _initOverlayToastsWhenReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindOverlayButtonToasts, { once: true });
    } else {
        _bindOverlayButtonToasts();
    }
}
_initOverlayToastsWhenReady();

// ──────────────────────────────────────────────────────────────
// 9. 초기 상태 설정
//    페이지 로드 시 기본 탭(특보정보)에 맞춰 body 속성 설정
// ──────────────────────────────────────────────────────────────
document.body.setAttribute('data-active-tab', 'weather-group');

} // end if (window.__SEAGNAL_PAGE === 'index2')
