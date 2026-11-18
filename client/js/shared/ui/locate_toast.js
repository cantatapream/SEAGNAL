/**
 * ============================================================================
 * 파일명: js/shared/ui/locate_toast.js
 * 역할: 「내 위치」(GPS) 버튼을 눌렀을 때 화면 하단에 진행 토스트를 띄우고 현재 위치를 가져온다.
 *       「위치정보를 확인하고 있어요 (스피너)」 → 성공: 초록 체크 + 「위치정보를 확인했어요」 뒤 서서히 사라짐 /
 *       실패: 주황 느낌표 + 「위치를 확인하지 못했어요」 뒤 서서히 사라짐.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : core/index2_patch.js 의 _computeBottomToastOffsetPx()(공용 토스트 높이 — 최소 높이로만 씀)
 *  - 서버 API      : 없음 — 위치는 폰 안에서만 쓰고 서버로 보내지 않는다(안내 「내 위치」 탭 문구의 근거.
 *                    local_server/scripts/test_guide_tabs.js [2b] 가 이 파일에 서버 호출이 없음을 확인)
 *  - 마크업        : 동적 생성 #locate-toast (+ <style id="locate-toast-style">)
 *  - 나를 쓰는 곳  : 내 위치 버튼 처리 8곳 — ocean-map/map/ocean_map.js goToMyLocation,
 *                    marine-life/{fishing,swimming,scuba,mudflat,ripcurrent}/ _moveToMyLocation,
 *                    marine-life/surfing/surfing1.js _goToSurfingMyLocation, marine-life/swell/swell.js _bindEvents
 *                    (해양생활 좌측 상단 #ls-gps-btn 은 이 버튼들을 대신 누르므로 같은 토스트가 뜬다)
 * [로드 순서] js/shared/ui/ui_modal.js 다음. 버튼을 누를 때 호출되므로 위 8곳보다 늦게 로드돼도 된다.
 * ============================================================================
 *
 * [왜 따로 두나] 기존 공용 토스트(index2_patch.js _showOceanToast)는 글자만 넣고 정해진 시간 뒤
 *   사라지는 구조라 「진행 중 → 완료로 바뀜」을 표현할 수 없고, 다른 기능이 같은 토스트를 덮어쓰면
 *   진행 표시가 끊긴다. 그래서 같은 모양(둥근 어두운 알약 꼴)으로 별도 요소를 쓴다.
 * [사용자 확정 2026-11-18] 「gps 위치를 눌렀을 때 최초에는 화면 하단에 토스트가 나오고 그 토스트 안에
 *   "위치정보를 확인하고 있어요 (로딩스피너)"가 뜨도록 … 완료되면 로딩스피너가 초록색 체크로 바뀌고
 *   토스트가 fade out으로 사라지도록」 · 실패는 「토스트로 통일」(종전 5곳의 alert 경고창을 없앰).
 */
(function () {
    'use strict';

    var TOAST_ID = 'locate-toast';
    var MSG_LOADING = '위치정보를 확인하고 있어요';
    // 완료 문구 — 사용자 「초록색 체크로 바뀔때는 위치정보를 확인했어요 라고 표현되어야 할 것 같아」(2026-11-18)
    var MSG_OK = '위치정보를 확인했어요';
    // 한 줄로는 휴대폰 폭(약 400px)에서 끝이 잘려(2026-11-18 화면 확인) 두 줄로 나눈다
    var MSG_FAIL = '위치를 확인하지 못했어요.\n위치 권한을 확인해 주세요.';
    var HOLD_OK_MS = 1000;     // 초록 체크를 보여 주는 시간 → 그 뒤 fade out
    var HOLD_FAIL_MS = 2500;   // 실패 문구는 읽을 시간을 조금 더 준다
    var FADE_MS = 400;         // fade out 길이(아래 CSS transition 과 같은 값)

    var _hideTimer = null;
    var _seq = 0;              // 연달아 눌렀을 때 앞선 요청의 결과가 새 토스트를 바꾸지 않게 하는 번호

    /** 스타일을 1회 넣는다. 모양은 공용 토스트(#ocean-ui-toast)와 맞췄다. */
    function _ensureStyle() {
        if (document.getElementById('locate-toast-style')) return;
        var style = document.createElement('style');
        style.id = 'locate-toast-style';
        style.textContent = [
            '#' + TOAST_ID + ' {',
            '  position: fixed; left: 50%; transform: translateX(-50%);',
            '  display: flex; align-items: center; gap: 8px;',
            '  background: rgba(15, 23, 42, 0.92); color: #fff;',
            '  font-size: 0.88rem; font-weight: 500;',
            '  padding: 10px 18px; border-radius: 999px;',
            '  border: 1px solid rgba(255,255,255,0.08);',
            '  box-shadow: 0 6px 20px rgba(0,0,0,0.45);',
            '  z-index: 9600; pointer-events: none; white-space: nowrap;',
            // left:50% 기준이라 폭이 화면 절반으로 줄어드는 것을 막는다(글자 길이만큼, 화면 폭 안에서)
            '  width: max-content; max-width: calc(100vw - 40px); box-sizing: border-box;',
            '  opacity: 0; transition: opacity ' + FADE_MS + 'ms ease;',
            '}',
            '#' + TOAST_ID + '.visible { opacity: 1; }',
            '#' + TOAST_ID + ' .lt-icon { width: 16px; height: 16px; flex: 0 0 16px;',
            '  display: flex; align-items: center; justify-content: center; }',
            // 로딩 스피너 — 테두리 한쪽만 밝은 원을 돌린다
            '#' + TOAST_ID + ' .lt-spinner { width: 14px; height: 14px; box-sizing: border-box;',
            '  border: 2px solid rgba(255,255,255,0.25); border-top-color: #fff; border-radius: 50%;',
            '  animation: lt-spin 0.8s linear infinite; }',
            '@keyframes lt-spin { to { transform: rotate(360deg); } }',
            '#' + TOAST_ID + ' .lt-ok { color: #22c55e; font-size: 16px; }',
            '#' + TOAST_ID + ' .lt-fail { color: #f59e0b; font-size: 15px; }',
            '#' + TOAST_ID + ' .lt-text { overflow: hidden; text-overflow: ellipsis; }',
            // 실패 문구(두 줄)일 때 — 줄바꿈을 살리고 알약 대신 둥근 사각형으로
            '#' + TOAST_ID + '.lt-multi { border-radius: 14px; }',
            '#' + TOAST_ID + '.lt-multi .lt-text { white-space: pre-line; line-height: 1.4; word-break: keep-all; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /** 토스트 요소를 얻는다(없으면 만든다). */
    function _el() {
        _ensureStyle();
        var el = document.getElementById(TOAST_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = TOAST_ID;
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            el.innerHTML = '<span class="lt-icon"></span><span class="lt-text"></span>';
            document.body.appendChild(el);
        }
        return el;
    }

    /**
     * 토스트 상태를 바꾼다.
     * @param {'loading'|'ok'|'fail'} state
     */
    function _setState(state) {
        var el = _el();
        var icon = el.querySelector('.lt-icon');
        var text = el.querySelector('.lt-text');
        el.classList.toggle('lt-multi', state === 'fail');
        if (state === 'loading') {
            icon.innerHTML = '<span class="lt-spinner"></span>';
            text.textContent = MSG_LOADING;
        } else if (state === 'ok') {
            icon.innerHTML = '<i class="fa-solid fa-circle-check lt-ok"></i>';
            text.textContent = MSG_OK;
        } else {
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation lt-fail"></i>';
            text.textContent = MSG_FAIL;
        }
        _place();   // 문구가 바뀌면 크기가 달라지므로 자리를 다시 정한다
    }

    /**
     * 화면에 떠 있는(absolute·fixed) 버튼·범례 같은 요소들의 위치를 모은다 — 토스트 자리 정하기용.
     * [빼는 것] 지도 속 그림(OpenLayers 레이어·지도 위 마커/점 — .ol-overlaycontainer)·보이지 않는 것·
     *   토스트들 자신. 지도 컨트롤(.ol-overlaycontainer-stopevent 안의 저작권 표시·축척)은 센다.
     * @returns {DOMRect[]}
     * [연계] ← _place()
     */
    function _floatingRects() {
        var vw = window.innerWidth, vh = window.innerHeight, out = [];
        var all = document.body.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var n = all[i];
            var r = n.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
            var cs = getComputedStyle(n);
            if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
            if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
            if (n.closest('#' + TOAST_ID + ', #ocean-ui-toast, .ol-overlaycontainer, .ol-layers, .ol-layer')) continue;
            out.push(r);
        }
        return out;
    }

    /**
     * 토스트 자리를 정한다 — 화면 아래쪽 버튼·범례, 옆쪽 버튼 줄과 겹치지 않게.
     * [사용자 2026-11-18] 「토스트 메시지가 좀 더위로 위치했으면 좋겠어. 다른 버튼들이나 인터페이스와 겹치지 않게」
     *   화면마다 아래쪽·옆쪽에 있는 것이 다르다(범례·「…지수란?」 버튼·저작권 표시·축척·시간 막대·하단 탭·
     *   해양생활 오른쪽 활동 버튼 줄·해양종합정보 오른쪽 버튼 열). 목록을 손으로 적으면 화면이 바뀔 때마다
     *   낡으므로, 놓을 때마다 화면에 떠 있는 요소를 재서 정한다(요소 약 2,700개 · 2~8ms, iPhone SE·Pixel 7 측정).
     *   ① 높이: 화면 아래 절반에서 시작하는 요소(화면 절반보다 큰 판은 제외) 중 가장 위쪽 끝보다 GAP 위.
     *   ② 가로: 그 높이에 옆쪽 버튼 줄(폭이 화면 40% 이하인 요소)이 걸치면, 남은 가로 공간 가운데에 놓는다
     *      (작은 화면에서 해양생활 오른쪽 「너울」 버튼과 겹치던 것). 남는 폭이 180px 보다 좁으면 가운데 그대로.
     * [연계] ← _show() · _setState() 뒤(문구가 바뀌면 크기가 달라지므로 다시 놓는다)
     */
    function _place() {
        var GAP = 12, SIDE_GAP = 8, MIN_W = 180;
        var el = _el();
        var vw = window.innerWidth, vh = window.innerHeight;
        var rects = _floatingRects();

        // ① 높이
        var base = (typeof _computeBottomToastOffsetPx === 'function') ? _computeBottomToastOffsetPx() : 90;
        var topMost = vh;
        for (var i = 0; i < rects.length; i++) {
            var r = rects[i];
            if (r.top < vh * 0.5 || r.height > vh * 0.5) continue;
            if (r.top < topMost) topMost = r.top;
        }
        var bottom = Math.max(base, Math.round(vh - topMost + GAP));
        el.style.bottom = bottom + 'px';

        // ② 가로 — 토스트가 차지할 세로 띠에 걸치는 옆쪽 요소를 피한다
        el.style.left = '50%';
        el.style.maxWidth = '';
        var bandBottom = vh - bottom, bandTop = bandBottom - el.offsetHeight;
        var L = 0, R = vw;
        for (var j = 0; j < rects.length; j++) {
            var q = rects[j];
            if (q.width > vw * 0.4) continue;                         // 옆 줄이 아니라 넓은 판
            if (q.bottom <= bandTop || q.top >= bandBottom) continue; // 그 높이에 안 걸침
            if (q.left >= vw / 2) R = Math.min(R, q.left - SIDE_GAP);
            else if (q.right <= vw / 2) L = Math.max(L, q.right + SIDE_GAP);
        }
        if ((L > 0 || R < vw) && R - L >= MIN_W) {
            el.style.left = Math.round((L + R) / 2) + 'px';
            el.style.maxWidth = Math.round(R - L) + 'px';
        }
    }

    /** 하단 토스트를 띄운다(로딩 상태). 이미 떠 있으면 로딩으로 되돌린다. */
    function _show() {
        var el = _el();
        if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
        _setState('loading');
        requestAnimationFrame(function () { el.classList.add('visible'); });
    }

    /** holdMs 동안 보여 준 뒤 fade out. */
    function _hideAfter(holdMs) {
        if (_hideTimer) clearTimeout(_hideTimer);
        _hideTimer = setTimeout(function () {
            _el().classList.remove('visible');   // CSS transition 으로 서서히 사라진다
            _hideTimer = null;
        }, holdMs);
    }

    /**
     * 토스트를 띄우고 현재 위치를 가져온다(navigator.geolocation.getCurrentPosition 대신 쓴다).
     * 예: window.locateWithToast(function (pos) { 지도 이동 }, function (err) { 버튼 로딩 해제 },
     *                            { enableHighAccuracy: true, timeout: 10000 });
     * @param {Function} onSuccess - 위치를 받으면 호출(pos 전달). 토스트는 초록 체크 → fade out.
     * @param {Function} [onError] - 실패하면 호출(err 전달). 토스트는 실패 문구 → fade out.
     *                               위치 기능 자체가 없는 기기도 실패로 처리한다.
     * @param {Object} [options] - getCurrentPosition 옵션 그대로
     * [연계] ← 내 위치 버튼 처리 8곳(파일 헤더 참고). 좌표는 콜백으로만 넘기고 밖으로 보내지 않는다.
     */
    window.locateWithToast = function (onSuccess, onError, options) {
        var my = ++_seq;
        _show();
        function fail(err) {
            if (my === _seq) { _setState('fail'); _hideAfter(HOLD_FAIL_MS); }
            if (typeof onError === 'function') onError(err);
        }
        if (!navigator.geolocation) {
            fail({ code: 0, message: 'geolocation unavailable' });
            return;
        }
        navigator.geolocation.getCurrentPosition(function (pos) {
            if (my === _seq) { _setState('ok'); _hideAfter(HOLD_OK_MS); }
            if (typeof onSuccess === 'function') onSuccess(pos);
        }, fail, options);
    };
})();
