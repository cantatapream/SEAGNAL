/**
 * ============================================================================
 * 파일명: js/ocean_warn_active2.js  (2/5 — 데이터 계산)
 * 역할 : appState.alerts 배열을 부모 zoneName 단위로 묶어 "활성 맵(activeMap)"
 *        을 구축. 색상 결정 / 단계 결정 / 자식해역 → 부모 역색인 헬퍼 포함.
 * ============================================================================
 *
 * [핵심 출력] state.activeMap
 *   부모 zoneName → {
 *     paletteKey,    // 'wave'|'surge'|'typhoon'|null  (색칠 우선순위 적용한 결과)
 *     stage,         // 'upcoming'|'주의보'|'경보'      (현재 발효 우선)
 *     fillAlpha,     // STAGE_FILL_ALPHA[stage]
 *     currents,      // 현재 발효 중 알림 중 paletteKey 있는 것들 (색칠 후보)
 *     upcomings,     // 다가오는 알림 중 paletteKey 있는 것들
 *     allCurrents,   // 박스 표출용 — 모든 발효중 알림 (강풍·해제 포함될 수 있음)
 *     allUpcomings   // 박스 표출용 — 모든 다가오는 알림
 *   }
 *
 * [색칠 우선순위]
 *   현재 발효 중인 특보가 있으면 그 색을 우선 사용 (요구사항: 발효 중 우선).
 *   현재 발효 중이 없고 다가오는 특보만 있으면 다가오는 특보 색(옅은 톤) 사용.
 *
 * [해제 zone]
 *   appState.alerts 에 해당 zone 의 활성/upcoming 항목이 없으면 자연히
 *   activeMap 에 들어가지 않음 → 색칠 X, 박스 표출 X (요구사항 그대로).
 * ============================================================================
 */

(function () {
    'use strict';

    var ns = window.OceanWarnActive;
    if (!ns) return; // 1.js 미로드시 안전 종료

    // ────────────────────────────────────────────────────────────────────
    // 단계/색상 결정 헬퍼
    // ────────────────────────────────────────────────────────────────────

    /**
     * 알림의 wrnTp(특보 종류 문자열) 을 색상 팔레트 키로 변환.
     * 우리가 색칠하는 종류는 풍랑/폭풍해일/태풍 3가지뿐.
     *
     * 입력 예시: "풍랑", "태풍", "폭풍해일", "강풍" ...
     * 반환    : 'wave' | 'surge' | 'typhoon' | null
     *
     * @param {string} wrnTp - alertItem.warnType 값
     */
    ns._resolvePaletteKey = function (wrnTp) {
        if (!wrnTp) return null;
        // 부분 문자열 매칭으로 robust 하게 (KMA 데이터의 미세한 변형 흡수)
        if (wrnTp.indexOf('태풍') >= 0)     return 'typhoon';
        if (wrnTp.indexOf('폭풍해일') >= 0) return 'surge';
        if (wrnTp.indexOf('풍랑') >= 0)     return 'wave';
        return null; // 강풍/해일경보 등 기타 — 색칠 안 함
    };

    /**
     * 알림 객체 → 단계 키('upcoming'/'주의보'/'경보') 결정.
     *
     * data.js 의 processSingleAlert 출력 기준:
     *   - isPreliminary === true  → 발표 (아직 발효 전 / upcoming)
     *   - isPreliminary === false → 발효 중. 이때 level 에 '주의보' 또는 '경보'.
     *
     * @param {Object} alertItem - appState.alerts[i]
     * @returns {string} 'upcoming'|'주의보'|'경보' (예외시 '주의보' 안전 기본값)
     */
    ns._resolveStage = function (alertItem) {
        if (!alertItem) return '주의보';
        if (alertItem.isPreliminary) return 'upcoming';
        if (alertItem.level === '경보') return '경보';
        return '주의보';  // '주의보' / '예비' / 기타 → 주의보 알파로 통일
    };

    // ────────────────────────────────────────────────────────────────────
    // 자식해역 fullName → 부모 zoneName 역색인
    // ────────────────────────────────────────────────────────────────────

    /**
     * COASTAL_MAPPING 을 1회 평탄화하여 fullName → 부모 zoneName 캐시 빌드.
     *
     * COASTAL_MAPPING (mappings.js) 구조:
     *   {
     *     '울산앞바다': [
     *       { name: '평수구역', fullName: '울산앞바다중평수구역' },
     *       { name: '연안바다', fullName: '울산앞바다중연안바다' }
     *     ],
     *     ...
     *   }
     * → 역색인:
     *   {
     *     '울산앞바다중평수구역': '울산앞바다',
     *     '울산앞바다중연안바다': '울산앞바다',
     *     ...
     *   }
     */
    function _ensureSubToParent() {
        if (ns._state.subToParent) return ns._state.subToParent;
        var rev = {};
        if (typeof COASTAL_MAPPING !== 'undefined' && COASTAL_MAPPING) {
            var parents = Object.keys(COASTAL_MAPPING);
            for (var i = 0; i < parents.length; i++) {
                var pname = parents[i];
                var children = COASTAL_MAPPING[pname] || [];
                for (var j = 0; j < children.length; j++) {
                    var child = children[j];
                    if (child && child.fullName) rev[child.fullName] = pname;
                }
            }
        }
        ns._state.subToParent = rev;
        return rev;
    }

    /**
     * 자식해역 fullName → 부모 특보구역명 변환.
     * ocean_warn_zone.js 의 SUBZONE_LABEL_MAP 이 알려준 fullName 을 그대로 받음.
     *
     * @param {string} fullName - 예: "울산앞바다중연안바다"
     * @returns {string|null}   - 예: "울산앞바다" (매칭 없으면 null)
     */
    ns._resolveParentByFullName = function (fullName) {
        if (!fullName) return null;
        var rev = _ensureSubToParent();
        return rev[fullName] || null;
    };

    // ────────────────────────────────────────────────────────────────────
    // 활성 맵 빌드 (핵심)
    // ────────────────────────────────────────────────────────────────────

    /**
     * appState.alerts 를 스캔하여 부모 zoneName 단위 activeMap 을 다시 만든다.
     *
     * [호출 시점]
     *   - 'seagnal:alerts-changed' 이벤트 수신 시 (data.js 가 발화)
     *   - 토글 ON 진입 시 (현재 데이터 기준 즉시 색칠)
     *
     * [절차]
     *   1) state.activeMap 비움
     *   2) appState.alerts 순회 — 각 알림을 zoneName(부모) 단위로 그룹화
     *   3) 각 zone 별로 paletteKey 가 있는 알림을 currents/upcomings 에 분류
     *   4) 색칠용 paletteKey/stage 결정:
     *        - currents 가 있으면 그 중 첫 번째 알림의 paletteKey + stage('주의보'/'경보')
     *        - currents 비어있고 upcomings 가 있으면 첫 번째 upcomings 의 paletteKey + 'upcoming'
     *        - 둘 다 색칠 가능 항목 없으면 정보박스용으로만 보관 (paletteKey=null)
     *   5) 박스 표출용으로 모든 알림(강풍 포함) 도 allCurrents/allUpcomings 에 보관
     *
     * [주의]
     *   - 현재 발효 중에 같은 zone 에 종류가 다른 알림이 두 개 이상 있는 경우는
     *     매우 드물지만 발생 가능. 이 경우 첫 번째를 색칠 기준으로 사용
     *     (사용자가 박스를 보면 모두 보임).
     *   - 색칠 우선순위 내에서 동일 종류 안 주의보/경보 둘 다 있으면 경보가 우선
     *     이도록 sort.
     */
    ns._buildActiveMap = function () {
        var alerts = ns._getAlerts();
        var map = {};

        for (var i = 0; i < alerts.length; i++) {
            var a = alerts[i];
            if (!a || !a.zoneName) continue;
            // isCoastal 자식 항목은 본 모듈에서 사용하지 않음 (자식 단위 표출 X).
            // 단, appState.alerts 에는 isCoastal=true 가 들어가지 않음 (data.js 에서
            // coastalMap 으로 별도 분리). 안전하게 한 번 더 가드.
            if (a.isCoastal) continue;

            var zone = a.zoneName;
            if (!map[zone]) {
                map[zone] = {
                    paletteKey: null,
                    stage: null,
                    fillAlpha: 0,
                    currents: [],
                    upcomings: [],
                    allCurrents: [],
                    allUpcomings: []
                };
            }
            var entry = map[zone];

            // 박스 표출용은 모든 항목 보관 (강풍 등 색칠 못 해도 정보는 보여줌)
            if (a.isPreliminary) entry.allUpcomings.push(a);
            else                 entry.allCurrents.push(a);

            // 색칠용은 paletteKey 있는 항목만
            var pk = ns._resolvePaletteKey(a.warnType);
            if (pk) {
                if (a.isPreliminary) entry.upcomings.push(a);
                else                 entry.currents.push(a);
            }
        }

        // 각 zone 의 색칠 우선순위 결정
        var zones = Object.keys(map);
        for (var j = 0; j < zones.length; j++) {
            var info = map[zones[j]];

            // 현재 발효 중 우선 — 같은 종류 내 경보 > 주의보 순으로 정렬
            if (info.currents.length > 0) {
                info.currents.sort(function (x, y) {
                    var rx = (x.level === '경보') ? 0 : 1;
                    var ry = (y.level === '경보') ? 0 : 1;
                    return rx - ry;
                });
                var pick = info.currents[0];
                info.paletteKey = ns._resolvePaletteKey(pick.warnType);
                info.stage = ns._resolveStage(pick);
            } else if (info.upcomings.length > 0) {
                // 다가오는 특보만 있을 때 — 첫 번째 사용
                var pickU = info.upcomings[0];
                info.paletteKey = ns._resolvePaletteKey(pickU.warnType);
                info.stage = 'upcoming';
            }
            info.fillAlpha = info.paletteKey
                ? (ns._const.STAGE_FILL_ALPHA[info.stage] || 0)
                : 0;
        }

        ns._state.activeMap = map;
        return map;
    };

    // ========================================================================
    // [S9-D] 자식 해역(연안바다·평수구역) 단일 zone 색칠 정보 도출
    // ------------------------------------------------------------------------
    // 호출 위치: ocean_warn_active3.js 의 _styler — 자식(sub) 폴리곤 처리 분기.
    //
    // 입력: 자식 fullName (예: "제주도서부앞바다중북서연안바다")
    //       data.js 가 appState.coastalAlerts 에 채워둔 자식별 alert 배열을 조회.
    //       이 alert 배열은 dmdw 머지 결과(자식 정밀 wrnTp/wrnLvl) 가 반영되어 있음.
    //
    // 출력: { paletteKey, stage, fillAlpha } 또는 null
    //       - null  → 자식 비활성 또는 색칠 못 함 → _styler 가 _EMPTY_STYLE 반환
    //       - 객체  → _coloredStyle 의 info 인자로 그대로 전달 가능
    //
    // 정책: _buildActiveMap 의 단일 zone 로직 미니 버전 — 일관성 유지.
    //       부모와 동일한 팔레트·등급 우선순위 룰 적용.
    // ========================================================================
    ns._buildChildInfoForStyle = function (fullName) {
        if (!fullName) return null;
        var alertsMap = (window.appState && window.appState.coastalAlerts) || {};
        var arr = alertsMap[fullName];
        if (!arr || arr.length === 0) return null;

        // 색칠 가능 종류(풍랑·태풍·폭풍해일)만 currents/upcomings 로 분류.
        var currents = [];
        var upcomings = [];
        for (var i = 0; i < arr.length; i++) {
            var a = arr[i];
            if (!a) continue;
            if (!ns._resolvePaletteKey(a.warnType)) continue; // 색칠 못 하는 종류 skip
            if (a.isPreliminary) upcomings.push(a);
            else currents.push(a);
        }

        var info = { paletteKey: null, stage: null, fillAlpha: 0 };

        if (currents.length > 0) {
            // 같은 종류 내 경보 우선
            currents.sort(function (x, y) {
                return (x.level === '경보' ? 0 : 1) - (y.level === '경보' ? 0 : 1);
            });
            var pick = currents[0];
            info.paletteKey = ns._resolvePaletteKey(pick.warnType);
            info.stage = ns._resolveStage(pick);
        } else if (upcomings.length > 0) {
            var pickU = upcomings[0];
            info.paletteKey = ns._resolvePaletteKey(pickU.warnType);
            info.stage = 'upcoming';
        }

        info.fillAlpha = info.paletteKey
            ? (ns._const.STAGE_FILL_ALPHA[info.stage] || 0)
            : 0;
        return info;
    };
})();
