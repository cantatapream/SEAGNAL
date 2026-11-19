/**
 * ============================================================================
 * 파일명: js/forecast/main-accordion/main_accordion_solo.js
 * 역할  : 특보정보 탭의 큰 아코디언 4개(기상청 해상 기상 전망 · AI 연안 안전 브리핑 · 해역별 특보현황 · 해역별 기상현황)가
 *         한 번에 하나만 펼쳐지게 한다. 하나가 펼쳐지면 나머지는 접힌다 — 접히는 쪽 안의 펼침 상태는 건드리지 않으므로
 *         다시 펼치면 직전에 펼쳐 둔 안쪽 칸이 그대로 보인다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(아코디언 몸통의 class 변화만 지켜본다)
 *  - 서버 API      : 없음
 *  - 마크업        : index2.html #marine-forecast-accordion-body · #station-briefing-accordion-body ·
 *                    #main-accordion-body · #marine-status-accordion-body (펼침 = .collapsed 없음)
 *  - 나를 쓰는 곳  : 없음(스스로 지켜본다). 여는 쪽은 그대로 — outlook/marine_forecast.js toggleMarineForecastAccordion ·
 *                    station-briefing/station_briefing.js toggle·expand · alerts/data.js toggleMainAccordion ·
 *                    outlook/windy.js toggleMarineStatusAccordion · alerts/render.js(앱 처음 켤 때 자동 펼침) ·
 *                    fix_popup_logic.js(특보 상세에서 「목록에서 보기」) · ⚙ 설정 팝업이 아코디언을 여는 곳
 * [로드 순서] outlook/marine_forecast.js 다음 — 몸통 요소만 있으면 되므로 순서에 민감하지 않다.
 * ============================================================================
 *
 * [사용자 확정 2026-11-19] 「총 4개의 아코디언이 있잖아 ? 다른 아코디언이 펼쳐지면 기존 펼쳐져있던 아코디언은 접히도록 해줘.
 *   단, 기존 아코디언을 다시 펼쳤을 때 그 아코디언 안에 직전에 펼쳐놨던 아코디언이 펼쳐져있게 해줘.」
 * [왜 여는 함수마다 고치지 않고 지켜보나] 아코디언을 여는 곳이 여섯 군데 넘게 흩어져 있다(머리 누르기 4곳·앱 처음 켤 때
 *   자동 펼침·특보 상세의 「목록에서 보기」·⚙ 설정 팝업). 몸통의 .collapsed 가 빠지는 순간을 한 곳에서 보면 어느 길로
 *   열려도 똑같이 나머지가 접힌다 — 새로 여는 길이 생겨도 따로 챙길 필요가 없다.
 */
(function () {
    'use strict';

    // [몸통 id, 머리 id, 머리에 접힘 표시(collapsed-state)를 다는가]
    //   해역별 기상현황은 원래 토글(windy.js)이 머리 class 를 바꾸지 않으므로 여기서도 건드리지 않는다.
    var ACCORDIONS = [
        ['marine-forecast-accordion-body', 'marine-forecast-accordion-header', true],
        ['station-briefing-accordion-body', 'station-briefing-accordion-header', true],
        ['main-accordion-body', 'main-accordion-header', true],
        ['marine-status-accordion-body', 'marine-status-accordion-header', false]
    ];

    /**
     * 펼쳐진 하나를 뺀 나머지 큰 아코디언을 접는다(안쪽 칸 상태는 그대로 둔다).
     * 예: 「해역별 특보현황」이 펼쳐짐 → 해상 기상 전망·브리핑·기상현황 몸통에 .collapsed
     * @param {string} openId - 방금 펼쳐진 몸통 id
     * [연계] ← 아래 MutationObserver(몸통 class 가 바뀔 때)
     */
    function collapseOthers(openId) {
        ACCORDIONS.forEach(function (a) {
            if (a[0] === openId) return;
            var body = document.getElementById(a[0]);
            if (!body || body.classList.contains('collapsed')) return;
            body.classList.add('collapsed');
            var head = a[2] && document.getElementById(a[1]);
            if (head) head.classList.add('collapsed-state');
        });
    }

    /**
     * 몸통 4개에 class 변화 감시를 단다 — 접혀 있던 몸통에서 .collapsed 가 빠지는 순간만 반응한다.
     * [연계] ← 이 파일이 읽힐 때(몸통은 그보다 앞서 index2.html 에 있다) / → collapseOthers
     */
    function watch() {
        if (typeof MutationObserver !== 'function') return;
        var obs = new MutationObserver(function (records) {
            records.forEach(function (r) {
                var el = r.target;
                var wasCollapsed = /(^|\s)collapsed(\s|$)/.test(r.oldValue || '');
                if (wasCollapsed && !el.classList.contains('collapsed')) collapseOthers(el.id);
            });
        });
        ACCORDIONS.forEach(function (a) {
            var body = document.getElementById(a[0]);
            if (body) obs.observe(body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
})();
