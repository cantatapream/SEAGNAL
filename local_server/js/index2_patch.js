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
    //    [오버레이 복귀 이슈 — 두 단계 모두 대응]
    //     (A) canvas 크기 0x0 문제
    //         ocean_overlay.js 의 resizeCanvas() 는 map viewport 의
    //         getBoundingClientRect() 기준인데, 섹션이 display:none 상태에서
    //         호출되면 canvas 가 0x0 으로 축소되어 이후 _onCompositePrerender
    //         에서 합성 스킵됨.
    //     (B) 데이터 소실 문제 (핵심)
    //         marine.js 의 _onSectionActivated 가 해양종합 아닌 섹션 활성화 시
    //         window.oceanOverlayClear() 를 호출 → gridData/particles/lonList/
    //         latList/gridLookup 을 전부 null/[] 로 폐기. (streamActive /
    //         activeLayer / 버튼 .active 는 보존)
    //         따라서 단순히 oceanOverlayRefresh() 만으론 gridData 가 null
    //         이라 복원 불가.
    //     [해결]
    //         oceanOverlayInit(map) 재호출. 재진입 분기(ocean_overlay.js
    //         line 185-195) 는 inited===true 이면 resizeCanvas() 수행 후
    //         streamActive 이면 버튼 active 복원 + loadOverlayData() 재호출
    //         → gridData 재로딩 → startParticleAnimation 자동 재개.
    //         streamActive=false 면 no-op 으로 return.
    //     [타이밍] RAF 즉시 + 400ms 후 (섹션 트랜지션/서브탭 슬라이드 완료 후)
    //              두 번 호출. 재진입 분기는 idempotent 하므로 중복 호출 안전.
    if (targetId === 'ocean-map-section') {
        document.body.classList.add('ocean-map-active');
        function _oceanRevive() {
            try {
                if (!window.getOceanMap) return;
                var m = window.getOceanMap();
                if (!m) return;
                if (m.updateSize) m.updateSize();
                // [최초 1회] 초기 지도 중심 설정 (위치 즐겨찾기 우선, 없으면 한반도 중심)
                _applyOceanInitialCenter(m);
                // oceanOverlayInit 재진입으로 canvas 크기 + 데이터(loadOverlayData) 동시 복구
                if (window.oceanOverlayInit) window.oceanOverlayInit(m);
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
// 4-2. 해양종합 지도 최초 진입 시 중심 좌표 설정
//    ──────────────────────────────────────────────────────────
//    [동작 우선순위]
//      ① localStorage 'ocean_location_favorites_v1' 의 첫 번째 위치
//         즐겨찾기(바텀시트 ⭐ 로 저장한 항목) 좌표
//      ② 없으면 한반도 시각적 중심 (35.914005, 127.572611)
//
//    [한 번만 적용]
//      _oceanInitialCenterApplied 플래그로 페이지 로드당 1회만 실행.
//      이후 사용자가 지도를 패닝/줌하면 그 위치를 그대로 유지
//      (다른 탭 다녀와도 다시 리셋되지 않음).
//
//    [줌 변경 없음]
//      ocean_map.js 의 DEFAULT_ZOOM(7) 그대로 유지. setCenter 만 호출.
// ──────────────────────────────────────────────────────────────
var _oceanInitialCenterApplied = false;
function _applyOceanInitialCenter(map) {
    if (_oceanInitialCenterApplied) return;
    if (!map || !map.getView) return;
    if (typeof ol === 'undefined' || !ol.proj) return;
    _oceanInitialCenterApplied = true;

    var lon = 127.572611;          // 기본: 한반도 시각적 중심
    var lat = 35.914005;

    try {
        var raw = localStorage.getItem('ocean_location_favorites_v1');
        if (raw) {
            var items = JSON.parse(raw);
            if (Array.isArray(items) && items.length > 0) {
                var first = items[0];
                // lat/lng 또는 lat/lon 모두 지원 (저장 시점 명명 차이 방어)
                var fLat = parseFloat(first.lat);
                var fLon = parseFloat(first.lon != null ? first.lon : first.lng);
                if (!isNaN(fLat) && !isNaN(fLon)) {
                    lat = fLat;
                    lon = fLon;
                }
            }
        }
    } catch (e) { /* localStorage 접근 실패 시 기본 좌표 사용 */ }

    try {
        map.getView().setCenter(ol.proj.fromLonLat([lon, lat]));
    } catch (e) {}
}

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
// 초기 진입 보호 가드: 페이지 로드 직후 init 과정에서 발생하는 자동
// 클릭/터치(폰트 로드, 이미지 로드, 다른 init 코드의 부수 트리거 등) 에
// 의해 펼쳐진 서브탭이 즉시 닫히는 문제 방지.
// 사용자 요구: "매 접속 시 시작은 서브탭 펼침". 800ms 동안만 닫기 무시.
var _initialOpenGuardUntil = Date.now() + 800;

function _handleContentTouchClose(ev) {
    // 서브탭이 열려있지 않으면 처리할 필요 없음
    if (!document.body.classList.contains('sub-tabs-open')) return;

    // 초기 진입 보호 시간 동안은 자동 이벤트로 닫히지 않게 무시
    if (Date.now() < _initialOpenGuardUntil) return;

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
        // 긴 텍스트 허용 (옵션).
        //  - pre-line: 메시지의 \n 을 줄바꿈으로 보존
        //  - keep-all: 한국어 단어 사이에서만 줄바꿈 허용 (자모 사이 안 쪼개짐)
        //  - width: min(75vw, 600px) — 박스 폭을 화면 75% 로 강제(태블릿 600px 상한)
        //    max-width 만 있으면 콘텐츠 폭에 맞춰 줄어들어 좁게 보이는 문제 방지
        //  - padding 좌우 14px 로 줄여 텍스트 영역을 한 단계 더 확보
        //  - box-sizing: border-box 로 padding 포함된 width 계산
        '#' + _OCEAN_TOAST_ID + '.multi-line {',
        '  white-space: pre-line;',
        '  text-align: center;',
        '  border-radius: 14px;',
        '  word-break: keep-all;',
        '  overflow-wrap: anywhere;',
        '  width: min(75vw, 600px);',
        '  max-width: calc(100vw - 16px);',
        '  padding: 10px 14px;',
        '  box-sizing: border-box;',
        '  text-overflow: clip;',
        '}'
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
 * @param {string} message   표시 문구 (multiLine=true 일 때 \n 으로 줄바꿈 가능)
 * @param {string} position  'top' | 'bottom'
 * @param {number} durationMs  표시 시간 (기본 2000)
 * @param {boolean} multiLine  true 면 .multi-line 클래스 적용 — 둥근 사각형 + pre-line(줄바꿈 허용)
 */
function _showOceanToast(message, position, durationMs, multiLine) {
    if (!message) return;
    var el = _getOceanToastEl();
    el.textContent = message;
    // 폰트 크기는 매 호출 시 원복 — 직전 호출에서 축소돼 있을 수 있음
    el.style.fontSize = '';
    if (multiLine) el.classList.add('multi-line');
    else el.classList.remove('multi-line');

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
        // multi-line 인 경우, 컨테이너 폭에 들어가는지 확인 후 필요 시 폰트 동적 축소
        if (multiLine) _shrinkToastFontIfWraps(el, message);
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
 * multi-line 토스트가 의도하지 않은 줄바꿈(=텍스트 wrap)을 일으키는지 확인하고,
 * 발생 시 font-size 를 1px 단위로 축소해 \n 으로 만든 줄 수와 실제 줄 수를 일치시킨다.
 *
 *  - 메시지의 \n 개수 + 1 = 기대하는 줄 수 (예: "A\nB" → 2줄)
 *  - 실제 그려진 줄 수: scrollHeight / lineHeight 로 추정
 *  - 차이가 있으면 폰트를 줄여 다시 측정
 *  - 하한 11px, 안전 가드(최대 8회) 로 무한루프 방지
 *
 *  [왜 필요한가?]
 *  좁은 화면(예: 320px iPhone SE)에서 한 줄 텍스트가 컨테이너 폭을 초과하면 자동
 *  줄바꿈이 일어나 "원하는 \n + 의도치 않은 wrap" 이 결합돼 3줄 이상으로 보임.
 *  word-break: keep-all 로 최대한 보호하지만, 단어 자체가 컨테이너보다 넓으면
 *  결국 wrap 발생 → 폰트 축소가 마지막 보루.
 */
function _shrinkToastFontIfWraps(el, message) {
    if (!el || !message) return;
    var expectedLines = message.split('\n').length;
    var minPx = 11;
    var safety = 0;
    // getComputedStyle 결과에 line-height 가 'normal' 이면 fontSize × 1.2 로 추정
    function _measure() {
        var cs = getComputedStyle(el);
        var fz = parseFloat(cs.fontSize) || 14;
        var lh = parseFloat(cs.lineHeight);
        if (!lh || isNaN(lh)) lh = fz * 1.2;
        var actual = Math.round(el.scrollHeight / lh);
        return { fz: fz, actual: actual };
    }
    var m = _measure();
    while (m.actual > expectedLines && m.fz > minPx && safety < 8) {
        el.style.fontSize = (m.fz - 1) + 'px';
        safety++;
        m = _measure();
    }
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
 * 세션 최초 해양종합 진입 시 토스트 1회 표시 (하단, 즐겨찾기 바 위).
 *  - sessionStorage 로 같은 세션 내 중복 표시 차단.
 *  - 새로 앱을 켜면(페이지 새로고침 포함) 다시 1회 표시.
 *  - 위치는 'bottom' — 파고/바람/조류 토스트와 동일 위치로 통일하여
 *    안내 메시지의 위치 일관성 확보.
 */
function _showOceanFirstEntryToastIfNeeded() {
    try {
        if (sessionStorage.getItem(_OCEAN_FIRST_ENTRY_SESSION_KEY) === '1') return;
        sessionStorage.setItem(_OCEAN_FIRST_ENTRY_SESSION_KEY, '1');
    } catch (e) { /* SS 접근 불가 환경에서도 동작은 계속 */ }
    // 섹션 전환 애니메이션 이후에 띄우도록 약간 지연
    setTimeout(function () {
        _showOceanToast('해역을 클릭하여 상세한 정보를 확인하세요', 'bottom', 2000);
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

/**
 * 해구도 토글(#ocean-marine-zone-toggle-btn) ON 시 안내 토스트.
 * 동작 원리는 위의 오버레이 버튼 토스트와 동일:
 *   - ocean_map.js 의 bindMarineZoneGridToggle 가 먼저 실행되어 active 클래스 갱신
 *   - 그 뒤 이 리스너가 rAF 한 프레임 후 active 여부를 확인
 *   - active(=방금 켜진 상태) 일 때만 토스트.
 * 메시지: "해구를 2번 클릭하면 해구별 기상전망이 표출됩니다."
 *   2-step 클릭(첫 클릭=하이라이트 / 두 번째 클릭=모달) 흐름을 사용자에게 알림.
 */
function _bindMarineZoneToggleToast() {
    var btn = document.getElementById('ocean-marine-zone-toggle-btn');
    if (!btn) return;   // index2 가 아니거나 버튼 자체가 없는 경우
    btn.addEventListener('click', function () {
        requestAnimationFrame(function () {
            if (!btn.classList.contains('active')) return;
            _showOceanToast('해구를 2번 클릭하면 해구별 기상전망이 표출됩니다.', 'bottom', 2500);
        });
    });
}

/**
 * 특보구역 토글(#ocean-warn-zone-toggle-btn) ON 시 안내 토스트.
 *  - ocean_warn_zone.js 의 _bindToggle() 가 먼저 실행되어 active 클래스 갱신
 *  - 그 뒤 이 리스너가 rAF 한 프레임 후 active 여부를 확인 → ON 일 때만 표시
 *  - 메시지가 길어 multiLine 옵션으로 2줄 표출 (둥근 사각형 + 줄바꿈)
 *  - 하단(B/C) 위치 — 다른 오버레이 토스트와 동일하게 즐겨찾기 바/메인탭 위
 */
function _bindWarnZoneToggleToast() {
    var btn = document.getElementById('ocean-warn-zone-toggle-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
        requestAnimationFrame(function () {
            if (!btn.classList.contains('active')) return;
            _showOceanToast(
                '특보구역은 참고용으로 활용하시고,\n정확한 경계는 관할 해경 파출소에 확인 바랍니다.',
                'bottom',
                3500,
                true
            );
        });
    });
}

// DOM 준비 후(혹은 ocean_overlay.js 가 버튼 바인딩한 뒤) 토스트 리스너 부착.
// DOMContentLoaded 후 한 번 + ocean_map 초기화 이후에도 한 번 — 둘 다 안전.
function _initOverlayToastsWhenReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _bindOverlayButtonToasts();
            _bindMarineZoneToggleToast();
            _bindWarnZoneToggleToast();
        }, { once: true });
    } else {
        _bindOverlayButtonToasts();
        _bindMarineZoneToggleToast();
        _bindWarnZoneToggleToast();
    }
}
_initOverlayToastsWhenReady();

// ──────────────────────────────────────────────────────────────
// 8-2. 오버레이 버튼 hover-sticky 해제 리스너
//    ──────────────────────────────────────────────────────────
//    [배경]
//     모바일 WebView(Android/iOS Capacitor) 에서 버튼을 탭한 뒤
//     :hover 가 그대로 남아 버튼 배경색이 계속 강조된 상태로 보이는
//     알려진 현상. 사용자 증상: 기상부이·CCTV·주요지명·파고·바람·조류
//     어느 버튼이든 "한번 누른 뒤 꺼도 평소 색으로 돌아오지 않음".
//     @media (hover: hover) 래핑은 일부 WebView 가 항상 true 로
//     평가하여 효과가 없으므로, JS 에서 click 직후 hover/focus 상태를
//     강제 해제하는 트릭을 적용.
//
//    [트릭]
//     1) btn.blur()           — focus 를 해제
//     2) pointer-events 잠시 'none' → 다음 프레임에 복귀
//        → 브라우저가 해당 버튼의 hover 판정을 재계산하여 sticky 해제
//
//    [대상]
//     .ocean-overlay-btn 모두 (CCTV/주요지명/기상부이/파고/바람/조류/
//     내 위치/해안도 지도 종류 등). index2 전용 리스너라 index1 무영향.
// ──────────────────────────────────────────────────────────────
function _bindOverlayButtonHoverReset() {
    var btns = document.querySelectorAll('.ocean-overlay-btn');
    for (var i = 0; i < btns.length; i++) {
        (function (btn) {
            btn.addEventListener('click', function () {
                // click 처리(active 토글 등)가 완료된 뒤에 실행되도록 지연
                setTimeout(function () {
                    try { btn.blur(); } catch (e) {}
                    var prev = btn.style.pointerEvents;
                    btn.style.pointerEvents = 'none';
                    requestAnimationFrame(function () {
                        btn.style.pointerEvents = prev || '';
                    });
                }, 0);
            });
        })(btns[i]);
    }
}
function _initOverlayHoverResetWhenReady() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindOverlayButtonHoverReset, { once: true });
    } else {
        _bindOverlayButtonHoverReset();
    }
}
_initOverlayHoverResetWhenReady();

// ──────────────────────────────────────────────────────────────
// 9. index2 전용 CSS 오버라이드 주입
//    ──────────────────────────────────────────────────────────
//    [배경]
//     style.css 의 원본 .fishing-bottomsheet / .surfing-popup 은
//     `top: 32%` 로 화면 위쪽 1/3 지점에 떠 있다. 사용자 요구는
//     "팝업 중앙이 항상 화면 정중앙에 오고, 크기는 데이터 양에 맞춰
//      자연 축소" 이므로 index2 한정으로 중앙 정렬로 오버라이드.
//
//    [메커니즘]
//     top: 50% + transform: translate(-50%, -50%) 조합으로 팝업의
//     기하학적 중심을 화면 중앙에 정확히 일치시킴.
//     max-height: 65vh 는 원본과 동일하게 유지 → 데이터가 적으면
//     컨텐츠 크기만큼 자동 축소, 많으면 65vh 까지 확장 후 내부 스크롤.
//
//    [메인탭 가림은 별도 해결]
//     이전엔 top/max-height 를 강제로 줄여 메인탭을 피했으나, 메인탭
//     z-index 를 60 으로 낮춘 후로는 팝업(z:999) 이 자연히 위로 떠서
//     불필요. 단순 중앙 정렬만 유지.
//
//    [영향 범위]
//     style 태그는 __SEAGNAL_PAGE==='index2' 가드 안쪽에서만 주입되므로
//     index1 에는 전혀 반영되지 않음.
//
//    [대상]
//     - .fishing-bottomsheet : 바다낚시 포인트 상세 팝업
//     - .surfing-popup       : 서핑 포인트 상세 팝업
//     - .fishing-guide-popup : 바다낚시 지수 안내 팝업 (동일 구조)
// ──────────────────────────────────────────────────────────────
(function _injectIndex2PopupOverrides() {
    if (document.getElementById('index2-popup-override-style')) return;
    var style = document.createElement('style');
    style.id = 'index2-popup-override-style';
    style.textContent = [
        // 기본 상태 (열림 직전 / 닫힘): 화면 정중앙에 살짝 축소된 상태
        '.fishing-bottomsheet,',
        '.surfing-popup,',
        '.fishing-guide-popup {',
        '    top: 50% !important;',
        '    transform: translate(-50%, -50%) scale(0.95) !important;',
        '    max-height: 65vh !important;',
        '}',
        // active 상태 (열림 완료): 동일 중앙 위치 + scale 1
        '.fishing-bottomsheet.active,',
        '.surfing-popup.active,',
        '.fishing-guide-popup.active {',
        '    transform: translate(-50%, -50%) scale(1) !important;',
        '}'
    ].join('\n');
    document.head.appendChild(style);
})();

// ──────────────────────────────────────────────────────────────
// 10. 초기 상태 설정
//    페이지 로드 시 기본 탭(특보정보)에 맞춰 body 속성 설정
// ──────────────────────────────────────────────────────────────
document.body.setAttribute('data-active-tab', 'weather-group');

// ──────────────────────────────────────────────────────────────
// 11. 첫 진입 시 서브탭 펼침 보장
//    사용자 요구: 매 접속 시 처음에는 특보정보 서브탭이 표출된 상태로 시작.
//    app_init.js 의 switchMainTab 초기 호출이 우리 wrapper 를 통해 서브탭을
//    열지만, 폰트/이미지 로드 등 init 과정의 부수 이벤트로 닫힐 가능성 방어.
//    DOMContentLoaded 와 load 두 시점 모두에서 명시적으로 한번 더 펼침.
// ──────────────────────────────────────────────────────────────
function _ensureInitialSubTabsOpen() {
    // 차단된 탭이면 스킵 (사용자가 이미 다른 탭으로 이동한 경우 등)
    var activeMain = document.querySelector('.main-tabs .tab-btn.active');
    if (!activeMain) return;
    var targetGroup = activeMain.getAttribute('data-target');
    // 섹션 ID 인 경우 그룹으로 변환
    if (SECTION_TO_GROUP && SECTION_TO_GROUP[targetGroup]) {
        targetGroup = SECTION_TO_GROUP[targetGroup];
    }
    if (TAB_GROUP_SUBTABS && TAB_GROUP_SUBTABS[targetGroup]) {
        _openSubTabsFor(targetGroup);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _ensureInitialSubTabsOpen);
} else {
    _ensureInitialSubTabsOpen();
}
window.addEventListener('load', function () {
    // load 시점엔 이미 모든 init 코드가 끝난 상태 — 한번 더 보장
    setTimeout(_ensureInitialSubTabsOpen, 50);
});

} // end if (window.__SEAGNAL_PAGE === 'index2')
