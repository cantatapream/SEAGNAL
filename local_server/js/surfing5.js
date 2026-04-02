/**
 * ============================================================================
 * 파일명: js/surfing5.js
 * 역할: 서핑지수 프론트엔드 - 해상특보 맵 구축 + 해상특보 HTML 생성
 * ============================================================================
 *
 * [설명]
 * weather_alerts.json은 동해 > 동해남부해상 > 동해남부앞바다 > 울산앞바다처럼
 * 4단계 중첩 구조로 되어 있습니다.
 * 이 파일은 그 중첩 구조를 순회하여
 * { '울산앞바다': { current, upcoming }, '강원북부앞바다': { current, upcoming }, ... }
 * 형태의 평면 맵으로 변환합니다.
 * 이후 팝업에서 해수욕장별 특보구역 이름(예: '강원북부앞바다')으로 O(1) 조회 가능.
 *
 * [로드 순서] surfing4.js 다음 (마지막 surfing 파일)
 *
 * [연계]
 * - surfing1.js → _loadSurfingData() 완료 후 s.buildAlertMap(weatherAlerts) 호출
 *                 → 결과를 s.alertMap에 저장
 * - surfing4.js → _renderPopupContent()에서 s.buildAlertHtml(alertName) 호출
 *                 → 반환된 HTML을 팝업 콘텐츠에 추가
 *
 * [weather_alerts.json 구조 예시]
 * {
 *   "previous": {
 *     "동해": {
 *       "동해남부해상": {
 *         "동해남부앞바다": {
 *           "울산앞바다": {          ← 말단 구역 (current/upcoming 보유)
 *             "current": null,       ← 현재 특보 없음
 *             "upcoming": null,      ← 예비 특보 없음
 *             "history": [...]
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * [buildAlertMap 결과 예시]
 * {
 *   '울산앞바다':    { current: null, upcoming: null },
 *   '강원북부앞바다': { current: { type: '풍랑주의보', command: '발효' }, upcoming: null },
 *   ...
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    if (!window._surfing) {
        console.error('surfing5.js: window._surfing이 없습니다. surfing1.js를 먼저 로드하세요.');
        return;
    }

    var s = window._surfing;

    // ========================================================================
    // 1. 특보 평면 맵 구축
    // ========================================================================

    /**
     * weather_alerts.json의 중첩 구조를 평면 맵으로 변환합니다.
     *
     * [변환 방법]
     * weather_alerts.previous를 재귀 순회하여
     * current 또는 upcoming 키를 가진 객체(말단 구역)를 찾아 구역명 → 정보로 기록.
     *
     * [왜 평면 맵이 필요한가?]
     * - 팝업에서 해수욕장의 특보구역(예: '강원북부앞바다')으로 바로 조회해야 하는데,
     *   중첩 구조에서 매번 4단계를 탐색하면 느리고 코드가 복잡해집니다.
     * - 평면 맵으로 변환하면 alertMap['강원북부앞바다']로 O(1) 조회 가능합니다.
     *
     * @param {Object} weatherAlerts - /api/weather-alerts 응답 전체
     * @returns {Object} { 구역명: { current, upcoming } } 형태의 평면 맵
     */
    function _buildAlertMap(weatherAlerts) {
        var map = {};

        // weather_alerts.previous가 중첩 구역 데이터를 담고 있습니다
        var root = weatherAlerts && weatherAlerts.previous;
        if (!root) return map;

        // 재귀 함수: obj의 모든 키를 순회하여 말단 구역(current/upcoming 보유)을 수집
        function traverse(obj) {
            if (!obj || typeof obj !== 'object') return;

            // 이 객체가 말단 구역인지 확인:
            // current 또는 upcoming 키를 직접 가지고 있으면 말단 구역
            if ('current' in obj || 'upcoming' in obj) return;

            Object.keys(obj).forEach(function (key) {
                var child = obj[key];
                if (!child || typeof child !== 'object') return;

                // 자식이 말단 구역이면 맵에 추가 (key = 구역명)
                if ('current' in child || 'upcoming' in child) {
                    map[key] = {
                        current:  child.current  || null,
                        upcoming: child.upcoming || null
                    };
                } else {
                    // 아직 말단이 아니면 더 깊이 탐색
                    traverse(child);
                }
            });
        }

        traverse(root);
        return map;
    }

    // ========================================================================
    // 2. 해상특보 HTML 생성
    // ========================================================================

    /**
     * 특보구역명을 받아 해상특보 HTML을 반환합니다.
     *
     * [표시 예시 — 특보 없음]
     * ─── 해상특보 ────────────────────────────────
     *  강원북부앞바다: 특보 없음
     *
     * [표시 예시 — 특보 발효 중]
     * ─── 해상특보 ────────────────────────────────
     *  강원중부앞바다: 풍랑주의보 발효 중
     *
     * [표시 예시 — 예비 특보 있음]
     * ─── 해상특보 ────────────────────────────────
     *  충남북부앞바다: 풍랑주의보 (예비)
     *
     * [표시 예시 — alertMap에 구역 없음 (데이터 로드 실패 등)]
     * ─── 해상특보 ────────────────────────────────
     *  특보 정보를 불러올 수 없습니다.
     *
     * @param {string} alertName - 특보구역명 (예: '강원북부앞바다')
     * @returns {string} HTML 문자열
     */
    function _buildAlertHtml(alertName) {
        var html = '<div class="surfing-alert-section">';
        html += '<div class="surfing-alert-title">해상특보</div>';

        // alertMap이 구축되지 않았거나 구역 정보가 없는 경우
        var alertMap = s.alertMap;
        if (!alertMap || !alertName) {
            html += '<div class="surfing-alert-row surfing-alert-none">특보 정보를 불러올 수 없습니다.</div>';
            html += '</div>';
            return html;
        }

        var zoneInfo = alertMap[alertName];
        if (!zoneInfo) {
            html += '<div class="surfing-alert-row surfing-alert-none">';
            html += '<span class="surfing-alert-zone">' + _esc(alertName) + '</span>';
            html += ': 정보 없음';
            html += '</div>';
            html += '</div>';
            return html;
        }

        var current  = zoneInfo.current;
        var upcoming = zoneInfo.upcoming;

        html += '<div class="surfing-alert-row">';
        html += '<span class="surfing-alert-zone">' + _esc(alertName) + '</span>: ';

        if (current) {
            // 현재 발효 중인 특보
            // current 구조: { type: '풍랑주의보', command: '발효'|'해제'|'대치', ... }
            var alertType = current.type || '특보';
            var cmd = current.command || '';
            if (cmd === '해제') {
                // 해제 상태는 "없음"으로 표시
                html += '<span class="surfing-alert-none">특보 없음</span>';
            } else {
                html += '<span class="surfing-alert-active">' + _esc(alertType) + ' 발효 중</span>';
            }
        } else if (upcoming) {
            // 현재 특보는 없지만 예비 특보 존재
            var upType = upcoming.type || '특보';
            html += '<span class="surfing-alert-upcoming">' + _esc(upType) + ' (예비)</span>';
        } else {
            // 특보 없음
            html += '<span class="surfing-alert-none">특보 없음</span>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    /**
     * XSS 방지용 HTML 이스케이프 헬퍼 (surfing5.js 내부 전용)
     * @param {string} str
     * @returns {string}
     */
    function _esc(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }

    // ========================================================================
    // 3. window._surfing에 함수 등록
    // ========================================================================

    /**
     * surfing1.js의 _loadSurfingData()와 surfing4.js의 _renderPopupContent()가
     * 이 두 함수를 호출합니다.
     *
     * 호출 흐름:
     *   _loadSurfingData() → s.buildAlertMap(alerts) → s.alertMap = { 구역명: {...} }
     *   _renderPopupContent() → s.buildAlertHtml('강원북부앞바다') → HTML 반환
     */
    s.buildAlertMap  = _buildAlertMap;
    s.buildAlertHtml = _buildAlertHtml;

})();
