/**
 * ============================================================================
 * 파일명: js/ocean_warn_active1.js  (1/5 — 네임스페이스·상수·공유 상태)
 * 역할 : 해양종합정보 지도 위에 "현재 활성/다가오는 특보"를 색칠하고,
 *        부모 특보구역 클릭 시 정보 박스를 띄우는 모듈의 공통 기반.
 * ============================================================================
 *
 * [전체 모듈 개요]
 *   ocean_warn_active1.js — 네임스페이스 / 색상 팔레트 / 공유 상태 (이 파일)
 *   ocean_warn_active2.js — 데이터 계산 (appState.alerts → 부모 zone 단위 활성 맵)
 *   ocean_warn_active3.js — 폴리곤 색상 스타일러
 *   ocean_warn_active4.js — 토글 버튼 + 활성/비활성 전환
 *   ocean_warn_active5.js — 클릭 정보박스 + 초기화/이벤트 listener
 *
 * [어디서 호출/사용되나]
 *   - index2.html : 우측 컨트롤 스택의 "🚨 ON/OFF" 토글 버튼이 이 모듈로 바인딩됨
 *   - js/ocean_warn_zone.js : window.OceanWarnZone API 를 통해 폴리곤 스타일을 위임받음
 *   - js/ocean_map.js       : handleMapClick 안에서 window.OceanWarnActive.tryHandleClick 호출
 *   - js/data.js            : window.dispatchEvent('seagnal:alerts-changed') 발화 →
 *                             이 모듈이 listen 하여 색칠/버튼 상태 자동 갱신
 *
 * [네임스페이스 패턴]
 *   ocean_bottom_sheet1~5.js 와 동일하게 IIFE 마다 window.OceanWarnActive 네임스페이스를
 *   확장. 외부 공개 API(tryHandleClick, isActive, refresh) 는 5.js 에서 최종 부착.
 *   내부 공유 상태는 _state, 상수는 _const 에 둠.
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 네임스페이스 보장 ───────────────────────────────────────────────
    // window.OceanWarnActive 는 5개 파일이 점진적으로 메서드를 부착하는 객체.
    // 다른 파일이 먼저 로드돼도 안전하도록 || {} 로 보호.
    var ns = window.OceanWarnActive = window.OceanWarnActive || {};

    // ────────────────────────────────────────────────────────────────────
    // 색상 팔레트
    // ────────────────────────────────────────────────────────────────────
    //
    // [팔레트 결정 근거]
    //   - 베이스맵이 ON 시 "해안도(coast)" 로 전환되는데, 해안도 자체가 옅은 청회색
    //     배경이라 청록/파랑 계열은 가독성이 낮음.
    //   - 기상청 범례에서 강풍주의보=초록인데, 우리 앱은 강풍 정보를 표출하지
    //     않으므로 그 초록색을 가독성 좋은 풍랑(주의보/경보)에 부여.
    //   - 폭풍해일은 카키/베이지(노랑-갈색 톤)로 자연 색채 차이 확보.
    //   - 태풍은 가장 강한 경보이므로 빨강.
    //
    // [팔레트 키]
    //   _resolvePaletteKey(wrnTp) 가 알림의 wrnTp(특보 종류) 문자열을 보고
    //   아래 키 중 하나로 매핑. 매핑 안 되는 종류(강풍 등)는 null → 색칠 제외.
    // ────────────────────────────────────────────────────────────────────
    var ALERT_COLORS = {
        // 풍랑(주의보/경보) — 초록
        wave: { rgb: '34, 197, 94' },        // tailwind green-500
        // 폭풍해일(주의보/경보) — 카키/머스타드
        surge: { rgb: '202, 138, 4' },       // tailwind yellow-600
        // 태풍(주의보/경보) — 빨강
        typhoon: { rgb: '220, 38, 38' }      // tailwind red-600
    };

    // ────────────────────────────────────────────────────────────────────
    // 단계별 fill 투명도 (3단계)
    // ────────────────────────────────────────────────────────────────────
    //
    // [규칙]
    //   같은 특보 종류(예: 풍랑) 안에서 단계가 올라갈수록 색이 진해지고,
    //   주의보·경보에는 추가로 대각선 빗금 패턴이 얹혀 단계 식별을 강화함.
    //   - 발표(발효 전 / upcoming)        : 옅은 단색만        → "예고" 느낌
    //   - 발효중인 주의보                 : 중간 단색 + 회색 빗금 → "주의 환기"
    //   - 발효중인 경보                   : 중간 단색 + 빨간 빗금 → "위급 신호"
    //
    // [알파 값 결정 근거 — 빗금 보정]
    //   기존엔 단색만 (0.25/0.50/0.75) 농도 차이로 단계 표현했으나, 같은 색
    //   계열의 농도 차이만으로는 사용자가 한눈에 단계 구분이 어려움. 이번 변경
    //   으로 빗금 패턴이 시각 무게를 추가하므로, 베이스 알파는 약간 낮춰서
    //   (0.40/0.55) 빗금이 도드라지고 화면이 답답하지 않게 함.
    // ────────────────────────────────────────────────────────────────────
    var STAGE_FILL_ALPHA = {
        upcoming: 0.25,   // 발표 (아직 발효 전) — 단색만
        '주의보': 0.40,   // 단색 + 회색 빗금 (빗금 추가 보정으로 0.50 → 0.40)
        '경보':   0.55    // 단색 + 빨간 빗금 (빗금 추가 보정으로 0.75 → 0.55)
    };

    // ────────────────────────────────────────────────────────────────────
    // 단계별 빗금 색상
    // ────────────────────────────────────────────────────────────────────
    //
    // [용도]
    //   _stripeFillPattern (3.js) 가 14 CSS px 타일 위에 베이스 색상 + 이 빗금색
    //   으로 대각선 패턴을 그려 ol.style.Fill 에 사용.
    //
    // [선택 근거 — 두 단계 동일 방식: "한 단계 밝은 색조 + α 0.55"]
    //   - 주의보: gray-400 (156,163,175) α 0.55 — 밝은 중성 회색
    //   - 경보  : red-400  (248,113,113) α 0.55 — 밝은 빨강
    //
    //   두 빗금이 동일한 시각 무게(밝은 색조 + 동일 알파)로 일관성 확보.
    //   단계 식별은 색조(회색 vs 빨강) 와 베이스 알파 차이(0.40 vs 0.55) 로 구분.
    //   "빨강 = 위험" 의 보편 신호는 채도 낮춰도 색조만으로 인식됨.
    //
    // [예비특보(upcoming)] : 빗금 없음 → 이 사전엔 없음.
    // ────────────────────────────────────────────────────────────────────
    var STAGE_STRIPE_RGBA = {
        '주의보': 'rgba(156, 163, 175, 0.55)',  // gray-400 밝은 회색 빗금
        '경보':   'rgba(248, 113, 113, 0.55)'   // red-400  밝은 빨강 빗금
    };

    // 모든 단계 공통 stroke 진하기 (윤곽선 alpha)
    // — 0.95 로 고정해 어떤 단계든 윤곽선이 또렷하게 보이도록.
    var STROKE_ALPHA = 0.95;

    // ────────────────────────────────────────────────────────────────────
    // 공유 상태
    // ────────────────────────────────────────────────────────────────────
    //
    // active        : 토글 ON/OFF 상태 (true 면 색칠 모드)
    // savedBasemap  : ON 진입 직전 베이스맵 종류 ('rltm'/'enc'/'coast').
    //                 OFF 시 이 값으로 복귀.
    // activeMap     : 부모 zoneName 을 키로 하는 활성 특보 맵.
    //                 _buildActiveMap (2.js) 가 채우고, _styler (3.js) 가 조회.
    //                 형식 예시:
    //                   {
    //                     "울산앞바다": {
    //                       paletteKey: 'wave',          // 색상 키
    //                       stage: '경보',                // 단계 ('upcoming'/'주의보'/'경보')
    //                       fillAlpha: 0.75,              // STAGE_FILL_ALPHA[stage]
    //                       currents: [<alertItem>...],   // 현재 발효 중 (color 가능 한정)
    //                       upcomings: [<alertItem>...],  // 다가오는 발표 (color 가능 한정)
    //                       allCurrents: [<alertItem>...],  // 박스 표출용 (강풍 등 모두 포함)
    //                       allUpcomings: [<alertItem>...]
    //                     },
    //                     ...
    //                   }
    // subToParent   : 자식해역 fullName → 부모 zoneName 역색인. 한 번만 빌드.
    // box           : 현재 표출 중인 정보 박스 DOM (없으면 null).
    // boxOutsideHandler : document 에 capture 단계로 등록한 외부 클릭 닫기 핸들러.
    //                     중복 등록 방지를 위해 참조 보관.
    // ────────────────────────────────────────────────────────────────────
    var state = {
        active: false,
        savedBasemap: null,
        activeMap: {},
        subToParent: null,
        box: null,
        boxOutsideHandler: null,
        // 박스 외부 클릭으로 박스가 막 닫힌 시각 (Date.now()).
        // tryHandleClick (5.js) 이 일정 윈도우(예: 400ms) 안의 클릭은 "닫기 의도"로 간주
        // 새 박스/바텀시트 호출을 차단 → 그 다음 클릭부터 정상 동작.
        boxJustClosedAt: 0,
        // 현재 정보박스가 표출 중인 부모 zone 이름 (선택 강조 표시용).
        // _showBox 가 set, _hideBox 가 null 로 reset.
        // _styler (3.js) 가 이 값과 일치하는 feature 의 테두리 색을 노란색으로
        // 강조하여 사용자가 어느 zone 을 선택했는지 시각적으로 식별 가능.
        selectedZone: null
    };

    // 외부 파일에서 접근할 수 있도록 네임스페이스에 장착
    ns._const = {
        ALERT_COLORS: ALERT_COLORS,
        STAGE_FILL_ALPHA: STAGE_FILL_ALPHA,
        STAGE_STRIPE_RGBA: STAGE_STRIPE_RGBA,
        STROKE_ALPHA: STROKE_ALPHA
    };
    ns._state = state;

    // ────────────────────────────────────────────────────────────────────
    // 공통 헬퍼 — 모든 파일에서 사용
    // ────────────────────────────────────────────────────────────────────

    /**
     * appState.alerts 안전 접근
     *
     * data.js 의 fetchAllData 가 끝나기 전(스플래시 단계) 에는 appState.alerts 가
     * undefined/비배열일 수 있으므로 항상 배열을 보장해 반환.
     *
     * [연계] data.js → flattenAlertsData() 가 채움
     */
    ns._getAlerts = function () {
        if (typeof appState === 'undefined' || !appState) return [];
        return Array.isArray(appState.alerts) ? appState.alerts : [];
    };

    /**
     * 색칠 가능한 활성 특보 zone 이 1개 이상 있는지 빠르게 조회.
     * 토글 버튼의 3-state 표시(특보 없음 / ON / OFF) 결정용.
     *
     * [연계] 4.js _renderButton 에서 호출
     */
    ns._hasAnyColorableActive = function () {
        var keys = Object.keys(state.activeMap);
        for (var i = 0; i < keys.length; i++) {
            var info = state.activeMap[keys[i]];
            if (info && info.paletteKey) return true;
        }
        return false;
    };

    /**
     * 디버그 로그 — 콘솔에 prefix 통일해서 출력. 운영 환경에서도 가벼워서 그대로 둠.
     */
    ns._log = function () {
        try {
            var args = ['[OceanWarnActive]'].concat(Array.prototype.slice.call(arguments));
            console.log.apply(console, args);
        } catch (e) { /* noop */ }
    };
})();
