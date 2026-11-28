/**
 * ============================================================================
 * 파일명: client/js/core/zone_split.js
 * 역할  : 기상청 해상 특보구역 개편을 화면이 「서버가 전환한 순간부터」 스스로 따르게 한다(전환은 서버가 MMIS 를 보고 정한다).
 *         「제주도남쪽바깥먼바다」 1개가 「제주도남서쪽바깥먼바다」·「제주도남동쪽바깥먼바다」 2개로 나뉜다(44 → 45개).
 *         ① 지금 새 기준인지 알려 주고(isActive) ② 기기에 저장된 옛 구역 켬/끔을 새 두 구역으로 이어 주고
 *         ③ 화면을 켜 둔 채 전환되면 한 번 새로 고친다(구역 목록·지도 그림이 처음 한 번만 읽히기 때문).
 * 사용자 확정 2026-11-22(원문):
 *   「위 내용은 모두 26일자부터 자동 적용될 수 있도록 설계해야해. 당장 오늘부터 위처럼 작동하도록 만드는게 아니라.」
 *   「인덱스 페이지에서는 이제는 제주도남쪽바깥먼바다가 아닌 제주도남서쪽바깥먼바다, 제주도남동쪽바깥먼바다 이렇게 2개로 나뉘는거야.」
 *   「카드에서 기상예보 버튼이 비활성화 … 윈디 위치도 마찬가지도 비활성화되도록, 종합정보 버튼도 비활성화 …
 *     "기상청 특보구역 변경에 따른 수정 진행 중입니다."라고 해당 버튼을 누르면 토스트 메시지」 · 「해구기상도 비활성」
 *   「카드의 시정 뱃지와 평균 파고·풍속 … 수치 부분을 -로 표시하고 누르면 추후 나오게 될거라는 토스트 메시지」
 * 사용자 확정 2026-11-24: 전환은 시각이 아니라 「MMIS에서 새로운 구역 신호줄때와 … 남쪽바깥먼바다에 특보가 없을때」(서버 config/zone_split.js 가 정한다) ·
 *   「기상버튼 등 해당버튼은 회색으로 비활성화상태로 두자」 「부이버튼은 활성화해줘」.
 * [2차 개편 — 2026-11-28 반영, 늘 적용] 서해중부 먼바다 2 → 4 · 남해동부 먼바다 2 → 3 (서버 짝 local_server/config/zone_split.js 머리 [2차 개편]).
 *   MMIS 가 이미 새 코드로 특보를 줘서 「전환 대기」가 없다. 사용자 확정 2026-11-28: 「바로시작」「이어받기 그대로」「전남광주 이름 변경」
 *   「우리가 제주도 남쪽 바깥 먼바다를 분할하면서 했던 과정을 모두 거쳐야 된다는 거야.」
 *   · 저장값: 서해중부안쪽 → 북쪽안쪽+남쪽안쪽, 서해중부바깥 → 북쪽바깥+남쪽바깥(옛 키 삭제) ·
 *     남해동부안쪽은 이름이 그대로라 기기마다 **한 번만** 중간에 같은 값을 넣는다(SPLIT2_ONCE_KEY — 그 뒤로 중간만 끄는 것을 막지 않으려고).
 *   · 「수정 진행 중」 카드: 서해중부 새 4구역 · 남해동부 안쪽(넓이가 바뀜)·중간.
 *   · 화면 이름(전남 → 전남광주, 코드·내부 이름 그대로): displayName.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (토스트는 core/index2_patch.js 의 window._showOceanToast — 누를 때 부른다)
 *  - 서버 API      : GET /api/zone-split (routes/weather.js — 켜 둔 화면이 전환을 알아채려고 5분마다·화면 복귀 때 묻는다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : core/config.js(구역 목록) · capacitor-plugins.js(푸시 구독 목록) · forecast/alerts/render.js·
 *                   forecast/outlook/windy.js(카드 버튼) · forecast/alerts/zone_avg.js(평균·시정 칸)
 *  - 서버 쪽 짝    : local_server/config/zone_split.js (같은 이름 — 둘을 함께 고친다. 전환은 서버가 정한다)
 * [로드 순서] 구역 표를 싣는 첫 파일(zoneOverlayConfig.js)보다 앞 — 저장값 이어받기가 settings.js·capacitor-plugins.js 보다 먼저 끝나야 한다. 순서 변경 금지
 * ============================================================================
 */
(function (root) {
    'use strict';
    var OLD = '제주도남쪽바깥먼바다';
    var NEW = ['제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다'];
    var SETTINGS_KEY = 'weatherAppSettings_v1';
    var MSG_BUTTON = '기상청 특보구역 변경에 따른\n수정 진행 중입니다.';
    var MSG_VALUE = '기상청 특보구역 변경에 따라 준비 중입니다.\n추후 제공될 예정입니다.';
    // ── 2차 개편(늘 적용 — 파일 머리 [2차 개편]. 서버 짝 config/zone_split.js 의 SPLIT2·SPLIT2_PENDING·DISPLAY_RENAME 과 같게) ──
    var SPLIT2 = {
        '서해중부안쪽먼바다': ['서해중부북쪽안쪽먼바다', '서해중부남쪽안쪽먼바다'],
        '서해중부바깥먼바다': ['서해중부북쪽바깥먼바다', '서해중부남쪽바깥먼바다']
    };
    var SPLIT2_PENDING = ['서해중부북쪽안쪽먼바다', '서해중부북쪽바깥먼바다', '서해중부남쪽안쪽먼바다', '서해중부남쪽바깥먼바다', '남해동부안쪽먼바다', '남해동부중간먼바다'];
    var SPLIT2_ONCE_KEY = 'zoneSplit2Migrated_v1';   // 남해동부안쪽 → 중간 이어받기를 이 기기에서 이미 했는가
    var DISPLAY_RENAME = {
        '전남북부서해앞바다': '전남광주북부서해앞바다', '전남중부서해앞바다': '전남광주중부서해앞바다',
        '전남남부서해앞바다': '전남광주남부서해앞바다', '전남서부남해앞바다': '전남광주서부남해앞바다',
        '전남동부남해앞바다': '전남광주동부남해앞바다'
    };
    var _forced = null;   // 검사용(window.__ZONE_SPLIT_FORCE = true/false 를 이 파일보다 먼저 두면 고정)
    if (root.__ZONE_SPLIT_FORCE === true || root.__ZONE_SPLIT_FORCE === false) _forced = root.__ZONE_SPLIT_FORCE;
    // 「지금 새 구역 기준인가」는 서버가 index2.html 에 실어 준다(window.__ZONE_SPLIT__ = {active} — local_server/routes/health.js).
    //   전환은 한 번이고 되돌아가지 않으므로, 한 번 「전환됨」을 본 기기는 그 사실을 기억해 둔다(ACTIVE_KEY) —
    //   실어 준 값이 없는 길(/index2.html 을 직접 연 경우·옛 HTML 과 섞인 한 번)에서도 같은 화면이 뜨게.
    var ACTIVE_KEY = 'zoneSplitActive_v1';
    function remembered() { try { return root.localStorage.getItem(ACTIVE_KEY) === '1'; } catch (e) { return false; } }
    function remember() { try { root.localStorage.setItem(ACTIVE_KEY, '1'); } catch (e) { /* 저장 못 해도 이번 화면은 그대로 */ } }
    var _active = !!(root.__ZONE_SPLIT__ && root.__ZONE_SPLIT__.active === true) || remembered();
    if (_active) remember();

    /**
     * 지금 새 구역 기준인가(이 화면을 열 때 기준 — 켜 둔 채 전환되면 새로 고쳐서 반영한다).
     * 예: 서버가 전환 전 → false · 전환 뒤에 연 화면 → true
     * @returns {boolean}
     * [연계] ← config.js·capacitor-plugins.js·카드 그리는 파일들 — 전환 전에는 종전과 똑같이 보이게 하려고 묻는다
     */
    function isActive() {
        if (_forced !== null) return _forced;
        return _active;
    }
    var _activeAtLoad = isActive();

    /**
     * 이 구역이 「수정 진행 중」 카드인가 — 전환 뒤의 새 두 구역.
     * 예: (전환 뒤) isPending('제주도남서쪽바깥먼바다') → true · isPending('제주도남동쪽안쪽먼바다') → false
     * @param {string} zoneName
     * @returns {boolean}
     * [연계] ← render.js·windy.js(버튼 4개 비활성) · zone_avg.js(시정·파고·풍속 「-」)
     */
    function isPending(zoneName) {
        var z = String(zoneName || '').replace(/\s+/g, '');
        return (isActive() && NEW.indexOf(z) !== -1) || SPLIT2_PENDING.indexOf(z) !== -1;   // 2차 개편 구역은 늘
    }

    /**
     * 구역 이름 배열에서 옛 이름을 새 두 이름으로 바꾼 새 배열(전환 뒤에만. 순서 유지).
     * 예: (전환 뒤) splitNames(['제주도남동쪽안쪽먼바다','제주도남쪽바깥먼바다']) → ['제주도남동쪽안쪽먼바다','제주도남서쪽바깥먼바다','제주도남동쪽바깥먼바다']
     * @param {string[]} names
     * @returns {string[]}
     * [연계] ← config.js(SUB_REGION_ZONES 제주해역) · capacitor-plugins.js(푸시 구독 목록)
     */
    function splitNames(names) {
        var jeju = isActive();
        var out = [];
        names.forEach(function (n) { (jeju && n === OLD ? NEW : (Object.prototype.hasOwnProperty.call(SPLIT2, n) ? SPLIT2[n] : [n])).forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); });
        return out;
    }

    /**
     * 화면에 보일 구역 이름 — 기상청이 「전남…」 앞바다 5곳을 「전남광주…」로 이름만 바꿨다(코드 그대로, 2026-11-28 MMIS 실측).
     *   내부 이름(특보 나무·저장값·구독 열쇠)은 그대로 두고 **보이는 글자만** 바꾼다(사용자 「전남광주 이름 변경」 — 열쇠를 바꾸면 구독·설정을 모두 옮겨야 한다).
     * 예: displayName('전남북부서해앞바다') → '전남광주북부서해앞바다' · displayName('부산앞바다') → '부산앞바다'
     * @param {string} name
     * @returns {string}
     * [연계] ← 카드 제목(render.js·windy.js)·설정 목록·지도 이름표 등 구역 이름을 글자로 보이는 곳
     */
    function displayName(name) {
        var z = String(name == null ? '' : name);
        var k = z.replace(/\s+/g, '');
        return Object.prototype.hasOwnProperty.call(DISPLAY_RENAME, k) ? DISPLAY_RENAME[k] : z;   // 표의 자기 칸만('constructor' 같은 이름에 Object 것이 잡히지 않게)
    }

    /**
     * 글 안의 옛 「전남…」 구역 이름을 모두 새 이름으로 바꾼다(이미 「전남광주…」인 곳은 그대로).
     * 예: displayText('전남북부서해앞바다 풍랑주의보') → '전남광주북부서해앞바다 풍랑주의보'
     * @param {string} text
     * @returns {string}
     * [연계] ← 이름이 문장 속에 섞여 나오는 곳(특보 목록 줄 등)
     */
    function displayText(text) {
        var t = String(text == null ? '' : text);
        Object.keys(DISPLAY_RENAME).forEach(function (o) { t = t.split(o).join(DISPLAY_RENAME[o]); });
        return t;
    }

    /**
     * 기기에 저장된 옛 구역 켬/끔을 새 두 구역으로 이어 주고 옛 키를 지운다(전환 뒤 한 번).
     *   옛 구역을 꺼 둔 사람은 새 두 구역도 꺼진 채로 시작한다(안 이어 주면 없는 키 = 켬 이라 원치 않는 구역이 켜진다).
     *   옛 키를 남기면 「관심해역을 골랐다」 판정(false 가 하나라도 있나)이 새 구역을 다 켜도 풀리지 않는다 → 지운다.
     * 예: {'제주도남쪽바깥먼바다': false} → {'제주도남서쪽바깥먼바다': false, '제주도남동쪽바깥먼바다': false}
     *     2차 개편(늘): {'서해중부안쪽먼바다': false} → {'서해중부북쪽안쪽먼바다': false, '서해중부남쪽안쪽먼바다': false} ·
     *     {'남해동부안쪽먼바다': false} → {…, '남해동부중간먼바다': false}(이 기기에서 처음 한 번만)
     * @returns {boolean} 고쳤으면 true
     * [연계] ← 이 파일(로드 즉시) — settings.js 의 UserSettings.init·capacitor-plugins.js 가 저장값을 읽기 전에
     */
    function migrateSettings() {
        try {
            var raw = root.localStorage.getItem(SETTINGS_KEY);
            var s = raw ? JSON.parse(raw) : null;
            var has = function (k) { return Object.prototype.hasOwnProperty.call(s, k); };
            var changed = false;
            if (s && typeof s === 'object') {
                // 제주(전환 뒤) + 2차 개편 서해중부(늘): 옛 키 값 → 새 키들, 옛 키 삭제
                var pairs = Object.keys(SPLIT2).map(function (o) { return [o, SPLIT2[o]]; });
                if (isActive()) pairs.unshift([OLD, NEW]);
                pairs.forEach(function (p) {
                    if (!has(p[0])) return;
                    p[1].forEach(function (n) { if (!has(n)) s[n] = s[p[0]]; });
                    delete s[p[0]];
                    changed = true;
                });
                // 2차 개편 남해동부: 이름이 그대로인 안쪽 → 새로 생긴 중간에 같은 값(이 기기에서 한 번만 — 뒤에 중간만 끈 사람을 다시 켜지 않게)
                var once = false;
                try { once = root.localStorage.getItem(SPLIT2_ONCE_KEY) === '1'; } catch (e) { once = false; }
                if (!once && has('남해동부안쪽먼바다') && !has('남해동부중간먼바다')) { s['남해동부중간먼바다'] = s['남해동부안쪽먼바다']; changed = true; }
            }
            if (changed) root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            try { root.localStorage.setItem(SPLIT2_ONCE_KEY, '1'); } catch (e) { /* 저장 못 하면 다음에 또 하지만, 중간 키가 생겼으면 위 조건에서 걸러진다 */ }
            return changed;
        } catch (e) {
            console.warn('[구역 분할] 저장값 이어받기 실패:', e && e.message);
            return false;
        }
    }

    /** 버튼 안내 토스트. [연계] ← makeDisabledButton(이 파일) / → core/index2_patch.js _showOceanToast */
    function toast(msg) {
        if (typeof root._showOceanToast === 'function') root._showOceanToast(msg, 'bottom', 2500, true);
    }

    /**
     * 「수정 진행 중」 회색 버튼 하나를 만든다 — 누르면 안내 토스트만 뜬다(카드가 접히지 않게 전파를 막는다).
     * 예: makeDisabledButton('윈디', 'windy-btn', 'flex:1;padding:10px 4px;') → <button class="windy-btn zone-split-disabled">윈디</button>
     * @param {string} label 버튼 글자  @param {string} className 원래 버튼의 클래스  @param {string} [baseCss] 원래 버튼의 크기 스타일
     * @returns {HTMLButtonElement}
     * [연계] ← render.js createAlertElement · windy.js createStatusCard (새 두 구역 카드의 기상예보·해구기상·윈디·종합정보)
     */
    function makeDisabledButton(label, className, baseCss) {
        var b = document.createElement('button');
        b.className = (className ? className + ' ' : '') + 'zone-split-disabled';
        b.textContent = label;
        b.setAttribute('aria-disabled', 'true');
        b.style.cssText = (baseCss || '') + 'opacity:0.45;filter:grayscale(1);cursor:not-allowed;';
        b.addEventListener('click', function (e) { e.stopPropagation(); toast(MSG_BUTTON); });
        return b;
    }

    // ── 로드 즉시 ──────────────────────────────────────────────────────────────
    migrateSettings();

    // 화면을 켜 둔 채(또는 뒤에 살려 둔 채) 서버가 전환하면 한 번 새로 고친다 —
    //   구역 목록(config.js)과 지도 구역 그림(/api/warn-zones)은 화면을 열 때 한 번만 읽혀, 안 고치면 옛 한 덩어리 그림에 새 이름 특보가 안 칠해진다.
    //   5분마다, 그리고 화면으로 돌아올 때 서버에 묻는다(/api/zone-split). 전환을 본 뒤에는 더 묻지 않는다.
    var _reloading = false;
    function reloadNow() {
        if (_reloading) return;
        // 쓰던 것을 지우지 않는다 — 글 쓰는 중(입력 칸에 커서)이거나 설정 창에 저장 안 한 변경이 있으면 20초 뒤 다시 본다
        try {
            var el = root.document && root.document.activeElement, tag = el && el.tagName;
            var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable);
            var unsaved = typeof root.settingsModalHasUnsaved === 'function' && root.settingsModalHasUnsaved();
            if (typing || unsaved) { root.setTimeout(reloadNow, 20000); return; }
        } catch (e) { /* 판정 실패 — 그냥 새로 고친다 */ }
        _reloading = true;
        // 한 화면(탭)에서 한 번만 — 기억을 못 남기는 기기(저장소 막힘)가 전환 표시 없는 문서를 받으면 복귀할 때마다 새로 고치게 된다(독립 검토 2026-11-24)
        try { if (root.sessionStorage.getItem(ACTIVE_KEY + '_reloaded') === '1') return; root.sessionStorage.setItem(ACTIVE_KEY + '_reloaded', '1'); } catch (e) { return; }
        try { root.location.reload(); } catch (e) { /* 새로 고침이 막힌 환경 — 다음 실행 때 반영 */ }
    }
    function checkSwitched() {
        if (_activeAtLoad || _reloading || typeof root.fetch !== 'function') return;
        root.fetch('/api/zone-split', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            if (j && j.active === true) { remember(); reloadNow(); }   // 기억해 두므로 새로 고친 화면은 실어 준 값이 없어도 전환된 것으로 뜬다
        }).catch(function (e) { console.warn('[구역 분할] 전환 여부를 못 물음(다음에 다시):', e && e.message); });
    }
    if (!_activeAtLoad && _forced === null) {
        if (typeof root.setInterval === 'function') root.setInterval(checkSwitched, 5 * 60 * 1000);
        if (root.document && root.document.addEventListener) {
            root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) checkSwitched(); });
        }
    }

    root.ZoneSplit = {
        OLD: OLD, NEW: NEW, MSG_BUTTON: MSG_BUTTON, MSG_VALUE: MSG_VALUE,
        SPLIT2: SPLIT2, SPLIT2_PENDING: SPLIT2_PENDING, DISPLAY_RENAME: DISPLAY_RENAME,
        isActive: isActive, isPending: isPending, splitNames: splitNames, displayName: displayName, displayText: displayText,
        migrateSettings: migrateSettings, makeDisabledButton: makeDisabledButton, toast: toast
    };
})(typeof window !== 'undefined' ? window : globalThis);
