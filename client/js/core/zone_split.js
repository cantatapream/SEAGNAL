/**
 * ============================================================================
 * 파일명: client/js/core/zone_split.js
 * 역할  : 기상청 해상 특보구역 개편(2026-11-26)을 화면이 「그날 00시(한국시각)부터」 스스로 따르게 한다.
 *         「제주도남쪽바깥먼바다」 1개가 「제주도남서쪽바깥먼바다」·「제주도남동쪽바깥먼바다」 2개로 나뉜다(44 → 45개).
 *         ① 지금 새 기준인지 알려 주고(isActive) ② 기기에 저장된 옛 구역 켬/끔을 새 두 구역으로 이어 주고
 *         ③ 화면을 켜 둔 채 그 시각을 넘기면 한 번 새로 고친다(구역 목록·지도 그림이 처음 한 번만 읽히기 때문).
 * 사용자 확정 2026-11-22(원문):
 *   「위 내용은 모두 26일자부터 자동 적용될 수 있도록 설계해야해. 당장 오늘부터 위처럼 작동하도록 만드는게 아니라.」
 *   「인덱스 페이지에서는 이제는 제주도남쪽바깥먼바다가 아닌 제주도남서쪽바깥먼바다, 제주도남동쪽바깥먼바다 이렇게 2개로 나뉘는거야.」
 *   「카드에서 기상예보 버튼이 비활성화 … 윈디 위치도 마찬가지도 비활성화되도록, 종합정보 버튼도 비활성화 …
 *     "기상청 특보구역 변경에 따른 수정 진행 중입니다."라고 해당 버튼을 누르면 토스트 메시지」 · 「해구기상도 비활성」
 *   「카드의 시정 뱃지와 평균 파고·풍속 … 수치 부분을 -로 표시하고 누르면 추후 나오게 될거라는 토스트 메시지」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (토스트는 core/index2_patch.js 의 window._showOceanToast — 누를 때 부른다)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : core/config.js(구역 목록) · capacitor-plugins.js(푸시 구독 목록) · forecast/alerts/render.js·
 *                   forecast/outlook/windy.js(카드 버튼) · forecast/alerts/zone_avg.js(평균·시정 칸)
 *  - 서버 쪽 짝    : local_server/config/zone_split.js (같은 시각·같은 이름 — 둘을 함께 고친다)
 * [로드 순서] 구역 표를 싣는 첫 파일(zoneOverlayConfig.js)보다 앞 — 저장값 이어받기가 settings.js·capacitor-plugins.js 보다 먼저 끝나야 한다. 순서 변경 금지
 * ============================================================================
 */
(function (root) {
    'use strict';
    var OLD = '제주도남쪽바깥먼바다';
    var NEW = ['제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다'];
    var AT_MS = Date.parse('2026-11-26T00:00:00+09:00');   // 기기 시간대와 무관한 한 순간(서버 local_server/config/zone_split.js 와 같다)
    var SETTINGS_KEY = 'weatherAppSettings_v1';
    var MSG_BUTTON = '기상청 특보구역 변경에 따른\n수정 진행 중입니다.';
    var MSG_VALUE = '기상청 특보구역 변경에 따라 준비 중입니다.\n추후 제공될 예정입니다.';
    var _forced = null;   // 검사용(window.__ZONE_SPLIT_FORCE = true/false 를 이 파일보다 먼저 두면 고정)
    if (root.__ZONE_SPLIT_FORCE === true || root.__ZONE_SPLIT_FORCE === false) _forced = root.__ZONE_SPLIT_FORCE;

    /**
     * 지금 새 구역 기준인가.
     * 예: 2026-11-25 23:59 KST → false · 2026-11-26 00:00 KST → true
     * @returns {boolean}
     * [연계] ← config.js·capacitor-plugins.js·카드 그리는 파일들 — 26일 전에는 종전과 똑같이 보이게 하려고 묻는다
     */
    function isActive() {
        if (_forced !== null) return _forced;
        return Date.now() >= AT_MS;
    }
    var _activeAtLoad = isActive();

    /**
     * 이 구역이 「수정 진행 중」 카드인가 — 전환 뒤의 새 두 구역.
     * 예: (26일 이후) isPending('제주도남서쪽바깥먼바다') → true · isPending('제주도남동쪽안쪽먼바다') → false
     * @param {string} zoneName
     * @returns {boolean}
     * [연계] ← render.js·windy.js(버튼 4개 비활성) · zone_avg.js(시정·파고·풍속 「-」)
     */
    function isPending(zoneName) { return isActive() && NEW.indexOf(String(zoneName || '').replace(/\s+/g, '')) !== -1; }

    /**
     * 구역 이름 배열에서 옛 이름을 새 두 이름으로 바꾼 새 배열(전환 뒤에만. 순서 유지).
     * 예: (26일 이후) splitNames(['제주도남동쪽안쪽먼바다','제주도남쪽바깥먼바다']) → ['제주도남동쪽안쪽먼바다','제주도남서쪽바깥먼바다','제주도남동쪽바깥먼바다']
     * @param {string[]} names
     * @returns {string[]}
     * [연계] ← config.js(SUB_REGION_ZONES 제주해역) · capacitor-plugins.js(푸시 구독 목록)
     */
    function splitNames(names) {
        if (!isActive()) return names.slice();
        var out = [];
        names.forEach(function (n) { (n === OLD ? NEW : [n]).forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); });
        return out;
    }

    /**
     * 기기에 저장된 옛 구역 켬/끔을 새 두 구역으로 이어 주고 옛 키를 지운다(전환 뒤 한 번).
     *   옛 구역을 꺼 둔 사람은 새 두 구역도 꺼진 채로 시작한다(안 이어 주면 없는 키 = 켬 이라 원치 않는 구역이 켜진다).
     *   옛 키를 남기면 「관심해역을 골랐다」 판정(false 가 하나라도 있나)이 새 구역을 다 켜도 풀리지 않는다 → 지운다.
     * 예: {'제주도남쪽바깥먼바다': false} → {'제주도남서쪽바깥먼바다': false, '제주도남동쪽바깥먼바다': false}
     * @returns {boolean} 고쳤으면 true
     * [연계] ← 이 파일(로드 즉시) — settings.js 의 UserSettings.init·capacitor-plugins.js 가 저장값을 읽기 전에
     */
    function migrateSettings() {
        if (!isActive()) return false;
        try {
            var raw = root.localStorage.getItem(SETTINGS_KEY);
            if (!raw) return false;
            var s = JSON.parse(raw);
            if (!s || typeof s !== 'object' || !Object.prototype.hasOwnProperty.call(s, OLD)) return false;
            NEW.forEach(function (n) { if (!Object.prototype.hasOwnProperty.call(s, n)) s[n] = s[OLD]; });
            delete s[OLD];
            root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            return true;
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

    // 화면을 켜 둔 채(또는 뒤에 살려 둔 채) 전환 시각을 넘기면 한 번 새로 고친다 —
    //   구역 목록(config.js)과 지도 구역 그림(/api/warn-zones)은 화면을 열 때 한 번만 읽혀, 안 고치면 옛 한 덩어리 그림에 새 이름 특보가 안 칠해진다.
    function reloadIfSwitched() {
        if (_activeAtLoad || !isActive()) return;
        _activeAtLoad = true;   // 한 번만
        try { root.location.reload(); } catch (e) { /* 새로 고침이 막힌 환경 — 다음 실행 때 반영 */ }
    }
    if (!_activeAtLoad && _forced === null) {
        var wait = AT_MS - Date.now();
        if (wait < 0x7fffffff) root.setTimeout(reloadIfSwitched, wait + 1500);   // 서버 전환 직후(1.5초 뒤)
        if (root.document && root.document.addEventListener) {
            root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) reloadIfSwitched(); });
        }
    }

    root.ZoneSplit = {
        OLD: OLD, NEW: NEW, AT_MS: AT_MS, MSG_BUTTON: MSG_BUTTON, MSG_VALUE: MSG_VALUE,
        isActive: isActive, isPending: isPending, splitNames: splitNames,
        migrateSettings: migrateSettings, makeDisabledButton: makeDisabledButton, toast: toast
    };
})(typeof window !== 'undefined' ? window : globalThis);
