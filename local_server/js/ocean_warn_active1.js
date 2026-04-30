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
    //   같은 특보 종류(예: 풍랑) 안에서 단계가 올라갈수록 색이 진해짐.
    //   - 발표(발효 전 / upcoming)        : 옅게        → 색이 옅으면 "예고" 느낌
    //   - 발효중인 주의보                 : 중간
    //   - 발효중인 경보                   : 진하게      → 한눈에 가장 위급해 보임
    //
    // [구현]
    //   채도(stroke 색) 는 동일하게 두고 fill 의 alpha 만 변경 → 시각적 일관성 확보
    //   (윤곽선 색이 같은 종류면 동일하므로 사용자가 같은 종류임을 식별하기 쉬움).
    // ────────────────────────────────────────────────────────────────────
    var STAGE_FILL_ALPHA = {
        upcoming: 0.25,   // 발표 (아직 발효 전)
        '주의보': 0.50,
        '경보':   0.75
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
        boxOutsideHandler: null
    };

    // 외부 파일에서 접근할 수 있도록 네임스페이스에 장착
    ns._const = {
        ALERT_COLORS: ALERT_COLORS,
        STAGE_FILL_ALPHA: STAGE_FILL_ALPHA,
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
