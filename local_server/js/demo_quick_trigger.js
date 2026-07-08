/**
 * ============================================================================
 * 파일명: js/demo_quick_trigger.js
 * 역할: [데모 시연] 메인 페이지 헤더 5연타 → 특보/태풍/위치기반 시연 즉시 발동
 * ============================================================================
 *
 * 관리자 센터(헤더 10연타) → 시연 탭에 들어가지 않고도, 메인 페이지의 두 헤더를
 * 각각 짧은 시간 안에 5번 연속 클릭하면 시연이 발동한다.
 *
 * [A] "해역별 특보현황" 헤더(#main-accordion-header) — 단계 진행식
 *   [1단계] 첫 5연타 → 특보 시연 활성화
 *     ① 테스트 모드 ON (POST /api/admin/demo/testmode)
 *     ② 저장된 데모 특보 슬롯 전부 표출 (POST /api/admin/demo/emit, 슬롯별 관리자 푸시)
 *     ③ reapplyDemoAlerts() 로 본인 화면 즉시 반영(폴링 대기 없이)
 *   [2단계] 다음 5연타 → 태풍 발생/소멸 테스트 푸시
 *     ④ POST /api/admin/demo/typhoon-test {kind:'onset'}      (발생)
 *     ⑤ POST /api/admin/demo/typhoon-test {kind:'dissipation'} (소멸)
 *        → 둘 다 sendAdminPush 로 관리자 등록 기기에만 발송.
 *        + 이후 해양종합정보 '태풍' 클릭 시 자동 표출을 "무장"(_typhoonDemoArmed).
 *   [3단계 이후] 동작 없음 (추후 기능 추가 예정)
 *
 * [C] 해양종합정보 '태풍' 버튼(#ocean-typhoon-toggle-btn) — 무장 시 1회 자동 표출
 *   [A]-2단계로 무장된 뒤, 사용자가 직접 해양종합정보에서 '태풍'을 클릭하면:
 *     - window.OceanTyphoon.demoFocus 로 제6호 '장미' 강제 표출
 *     - 통보문 제6-12호 선택(#tphn-bulletin) + 해역표출 강제(디버그) ON(#tphn-dbg-korea)
 *     - 이어서 '물빠짐' 클릭 시 지도 이동/자동재생을 "무장"(_mudflatDemoArmed)
 *   무장은 1회성이며 메모리 기반(앱 재시작 시 자동 초기화 — 별도 영속 없음).
 *
 * [D] 해양종합정보 '물빠짐' 버튼(#ocean-mudflat-toggle-btn) — 무장 시 1회 자동 동작
 *   [C]로 태풍 시연이 표출된 뒤, 사용자가 '물빠짐'을 클릭하면:
 *     - 지정 좌표(37°12'03"N,126°35'06"E·경기만)를 화면 중앙으로 이동(줌 13)
 *     - 물빠짐 슬라이더 자동 재생(#mudflat-play-btn). 물빠짐 예측 팝업은 열지 않음.
 *
 * [B] "해역별 기상현황" 헤더(#marine-status-accordion-header) — 단계 진행식(1회성)
 *   [1단계] 첫 5연타 → 위치기반 시연 5건 발송 (모두 관리자 기기에만)
 *     나레이션(marine1) 진행 위치에 맞춰 2묶음으로 시차 발송 (NARR_PUSH_SYNC 참고):
 *     ⑥⑦ 음원 6초 지점 — POST /api/admin/demo/typhoon-radius-test
 *        {kind:'strong'}(강풍반경 진입) → {kind:'storm'}(폭풍반경 진입)
 *     ⑧ 음원 11초 지점 — 위치기반 특보 시연 3종: laDemoSetPosition() + laDemoRun(id,0):
 *        prelim(풍랑 예비특보 발표) → adv_act(풍랑주의보 발효) → warn_act(풍랑경보 발효)
 *        (각각 /api/location-alert/demo 가 이 기기 토큰 1대에만 발송)
 *     (나레이션 미업로드 시 두 묶음 모두 즉시 발송 — 기존 동작)
 *   [2단계] 다음 5연타 → AI 탭 '시연'(나리 소개 슬라이드) 자동 ON: window.openNariDemo()
 *     ⑨ 그 시연 화면을 닫으면(closeNariDemo) 음성 비서 '나리야' 자동 ON (앱 전용)
 *   [3단계 이후] 동작 없음
 *
 * [E] 메인탭 "해양종합정보"(.tab-btn[data-target="ocean-map-section"]) — 5연타
 *   [임시 — 발표 나레이션] ocean 슬롯 나레이션만 재생(다른 시연 동작 없음).
 *   단계 없음 — 5연타마다 재생되어 리허설 반복 가능. 발표 후 제거 예정.
 *
 * [안전 설계 — demo_alert.js 와 동일한 게이트]
 *   ① localStorage.seagnal_admin_mode === 'true' (관리자 모드)
 *   ② localStorage.push_token 존재
 *   ③ /api/admin/device-status?token= 로 "등록된 관리자 기기" 확인
 *   세 조건을 모두 통과한 기기에서만 동작한다. 일반 사용자는 5번 눌러도
 *   device-status 가 false → 아무 일도 일어나지 않는다(완전 무동작).
 *   추가로 /api/admin/* 라우트는 X-Admin-Token 게이트 뒤에 있어, 토큰이 없는
 *   기기의 호출은 서버에서도 거부된다(이중 방어).
 *
 * [연계]
 *   - 표출/머지 표시는 js/demo_alert.js 가 담당(관리자 기기 폴링).
 *   - admin.js 의 fetch 래퍼가 X-Admin-Token 을 자동 첨부하므로 admin.js
 *     이후에 로드되어야 한다(index2.html 에서 demo_alert.js 인근 로드).
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    var NEED_CLICKS = 5;       // 발동에 필요한 연속 클릭 수
    var WINDOW_MS = 3000;      // 연속 클릭으로 인정하는 시간창
    var _busy = false;         // 동작 진행 중 재진입 방지(두 헤더 공유 — 발송 겹침 방지)
    var _stage = 0;            // [특보현황 헤더] 0=특보 시연(1단계), 1=태풍 발생/소멸(2단계), 2+=동작 없음
    var _marineStage = 0;      // [기상현황 헤더] 0=위치기반(1단계), 1=AI 시연 열기(2단계), 2+=동작 없음(1회성)
    var _nariyaArmed = false;  // 트리거로 연 AI 시연이 닫힐 때 나리야를 자동 ON 할지
    var _typhoonDemoArmed = false;            // 태풍 푸시(특보현황 2단계) 후 '태풍' 클릭 시 1회 자동 표출 무장
    var TPHN_DEMO = { year: 2026, seq: '6', bno: '12' };  // 제6호 장미 · 통보문 제6-12호
    var _mudflatDemoArmed = false;            // 태풍 시연 표출 후 '물빠짐' 클릭 시 1회 지도이동+자동재생 무장
    var _demoSession = false;                 // 시연 세션 표시(태풍 시연 진입 이후 앱 재시작 전까지 유지)
                                              //   — tide_field.js 가 물빠짐 확대 안내 카드 억제 판단에 사용
    // 37°12'03"N, 126°35'06"E (≈ 경기만), 줌 13 — 화면 중앙 이동 후 슬라이더 자동 재생
    var MUDFLAT_DEMO = { lat: 37.20083, lon: 126.585, zoom: 13 };

    // ========================================================================
    // [임시 — 발표 나레이션] 트리거 발동 시 배경 음성 재생 (발표 종료 후 제거 예정)
    //   - 매핑: GET /api/demo/narration → { map: { alert1|alert2|ocean|mudflat|marine1|marine2: {url} } }
    //     (업로드는 통합관리자센터 > 시연 > 오디오 하위탭 — js/admin_narration.js)
    //   - 재생: 슬롯 URL 을 단일 Audio 엘리먼트로 재생(새 재생 시 이전 재생 중단)
    //   - 언락: 트리거 발동이 비동기(fetch) 뒤라 사용자 제스처 컨텍스트가 끊기므로,
    //     헤더/버튼의 "클릭 순간"(제스처 내)에 무음 재생으로 오디오를 미리 언락한다.
    // ========================================================================
    var _narrMap = null;          // 슬롯 → {url,...} 매핑 캐시 (앱 시작 시 1회 로드)
    var _narrAudio = null;        // 공유 Audio 엘리먼트 (동시 재생 방지)
    var _narrUnlocked = false;    // 무음 언락 완료 여부
    // 0.05초 무음 WAV (오디오 정책 언락용)
    var _SILENT_WAV = 'data:audio/wav;base64,UklGRl4AAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YToAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

    /** 나레이션 매핑 로드(1회). 실패해도 조용히 무시 — 시연 자체는 계속 동작. */
    function _loadNarrationMap() {
        fetch('/api/demo/narration', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) { _narrMap = (d && d.map) || {}; })
            .catch(function () { _narrMap = _narrMap || {}; });
    }

    /** [제스처 내 호출 필수] 무음 재생으로 웹뷰 오디오 정책 언락 + Audio 준비. */
    function _unlockAudio() {
        if (_narrUnlocked) return;
        try {
            if (!_narrAudio) _narrAudio = new Audio();
            _narrAudio.src = _SILENT_WAV;
            var p = _narrAudio.play();
            if (p && p.catch) p.catch(function () { /* 정책 거부 — 다음 제스처에서 재시도 */ });
            _narrUnlocked = true;
        } catch (e) { /* noop */ }
    }

    /** 슬롯에 업로드된 나레이션이 있으면 재생(없으면 무동작). 새 재생은 이전 재생을 끊는다. */
    function _playNarration(slot) {
        try {
            var entry = _narrMap && _narrMap[slot];
            if (!entry || !entry.url) return;
            var title = entry.name || slot;
            // [네이티브 우선] 새 APK(NarrationPlayer 플러그인 내장)에서는 네이티브
            //   MediaPlayer 로 재생 — 상태표시줄에 시스템 미디어 컨트롤(⟲/⏯/⟳ + 시크바)
            //   알림이 표출된다. 구 APK/웹 환경에서는 웹 오디오 + 인앱 미니 플레이어 폴백.
            var P = window.Capacitor && window.Capacitor.Plugins;
            var Native = P && P.NarrationPlayer;
            var rate = (entry.rate && isFinite(entry.rate) && entry.rate > 0) ? entry.rate : 1;
            if (Native && Native.play) {
                try { if (_narrAudio) _narrAudio.pause(); } catch (e) { /* noop */ }
                _hidePlayer();
                var abs = entry.url.charAt(0) === '/' ? (location.origin + entry.url) : entry.url;
                Native.play({ url: abs, title: title, rate: rate })
                    .catch(function () { _playWebNarration(entry, title); });  // 네이티브 실패 → 웹 폴백
                return;
            }
            _playWebNarration(entry, title);
        } catch (e) { /* noop */ }
    }

    /** 웹 오디오 재생 + 인앱 미니 플레이어 (네이티브 플러그인 없는 환경 폴백). */
    function _playWebNarration(entry, title) {
        try {
            if (!_narrAudio) _narrAudio = new Audio();
            try { _narrAudio.pause(); } catch (e) { /* noop */ }
            var rate = (entry.rate && isFinite(entry.rate) && entry.rate > 0) ? entry.rate : 1;
            _narrAudio.src = entry.url;
            _narrAudio.currentTime = 0;
            _narrAudio.playbackRate = rate;   // 관리자 설정 배속 (피치 보존은 브라우저 기본)
            var p = _narrAudio.play();
            if (p && p.catch) p.catch(function () { /* 자동재생 거부 — 조용히 무시 */ });
            _showPlayer(title);          // 미니 플레이어 표시 (정지/탐색용)
            _setupMediaSession(title);   // 웹뷰가 지원하면 상태표시줄 미디어 컨트롤
        } catch (e) { /* noop */ }
    }

    // ── 미니 플레이어 (재생/일시정지 · ±10초 · 슬라이더 탐색 · 닫기) ──
    //   나레이션 재생 중 화면 하단(탭바 위)에 표시. 발표 중 음성을 중간에
    //   멈추거나 원하는 지점으로 이동할 수 있게 한다. 관리자 기기에서
    //   나레이션이 재생될 때만 나타나므로 일반 사용자 화면에는 절대 안 뜸.
    var _npWrap = null, _npBtn = null, _npSlider = null, _npTime = null, _npTitle = null;
    var _npSeeking = false;   // 슬라이더 드래그 중 timeupdate 가 값을 덮지 않도록

    function _fmtMMSS(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _ensurePlayerUI() {
        if (_npWrap) return;
        if (!_narrAudio) _narrAudio = new Audio();   // 이벤트 바인딩 대상 보장
        var w = document.createElement('div');
        w.id = 'narration-mini-player';
        w.style.cssText = 'position:fixed;left:10px;right:10px;bottom:88px;z-index:99998;display:none;'
            + 'background:rgba(15,23,42,0.96);border:1px solid rgba(168,85,247,0.55);border-radius:12px;'
            + 'padding:8px 12px;box-shadow:0 8px 24px rgba(0,0,0,0.5);color:#e2e8f0;';
        w.innerHTML = ''
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
            + '  <i class="fa-solid fa-volume-high" style="color:#c4b5fd;font-size:0.72rem;"></i>'
            + '  <span id="np-title" style="flex:1;font-size:0.72rem;color:#c4b5fd;font-weight:700;'
            + '        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">나레이션</span>'
            + '  <button id="np-close" style="background:none;border:none;color:#94a3b8;font-size:1rem;'
            + '        padding:0 2px;cursor:pointer;line-height:1;">&times;</button>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            + '  <button id="np-back" style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);'
            + '        border-radius:8px;color:#d8b4fe;width:34px;height:30px;cursor:pointer;font-size:0.7rem;">'
            + '        <i class="fa-solid fa-rotate-left"></i></button>'
            + '  <button id="np-toggle" style="background:linear-gradient(135deg,#a855f7,#7c3aed);border:none;'
            + '        border-radius:8px;color:#fff;width:40px;height:30px;cursor:pointer;font-size:0.8rem;">'
            + '        <i class="fa-solid fa-pause"></i></button>'
            + '  <button id="np-fwd" style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);'
            + '        border-radius:8px;color:#d8b4fe;width:34px;height:30px;cursor:pointer;font-size:0.7rem;">'
            + '        <i class="fa-solid fa-rotate-right"></i></button>'
            + '  <input id="np-slider" type="range" min="0" max="100" step="0.1" value="0"'
            + '        style="flex:1;accent-color:#a855f7;height:22px;">'
            + '  <span id="np-time" style="font-size:0.66rem;color:#94a3b8;min-width:66px;text-align:right;">0:00 / 0:00</span>'
            + '</div>';
        document.body.appendChild(w);
        _npWrap = w;
        _npBtn = w.querySelector('#np-toggle');
        _npSlider = w.querySelector('#np-slider');
        _npTime = w.querySelector('#np-time');
        _npTitle = w.querySelector('#np-title');

        _npBtn.addEventListener('click', function () {
            if (!_narrAudio) return;
            if (_narrAudio.paused) { var p = _narrAudio.play(); if (p && p.catch) p.catch(function () { }); }
            else _narrAudio.pause();
        });
        w.querySelector('#np-back').addEventListener('click', function () {
            if (_narrAudio) _narrAudio.currentTime = Math.max(0, _narrAudio.currentTime - 10);
        });
        w.querySelector('#np-fwd').addEventListener('click', function () {
            if (_narrAudio && isFinite(_narrAudio.duration)) {
                _narrAudio.currentTime = Math.min(_narrAudio.duration, _narrAudio.currentTime + 10);
            }
        });
        w.querySelector('#np-close').addEventListener('click', function () {
            try { if (_narrAudio) { _narrAudio.pause(); _narrAudio.currentTime = 0; } } catch (e) { /* noop */ }
            _hidePlayer();
        });
        // 슬라이더 탐색 — 드래그 중에는 timeupdate 갱신을 멈추고, 놓으면 해당 위치로 이동
        _npSlider.addEventListener('input', function () { _npSeeking = true; });
        _npSlider.addEventListener('change', function () {
            _npSeeking = false;
            if (_narrAudio && isFinite(_narrAudio.duration)) {
                _narrAudio.currentTime = (parseFloat(_npSlider.value) / 100) * _narrAudio.duration;
            }
        });

        // 오디오 이벤트 → UI 반영 (Audio 엘리먼트는 공유 1개라 여기서 1회만 바인딩)
        _narrAudio.addEventListener('timeupdate', _syncPlayerUI);
        _narrAudio.addEventListener('durationchange', _syncPlayerUI);
        _narrAudio.addEventListener('play', _syncPlayerUI);
        _narrAudio.addEventListener('pause', _syncPlayerUI);
        _narrAudio.addEventListener('ended', function () {
            _syncPlayerUI();
            // 자연 종료 시 2초 뒤 자동 숨김 (다시 듣고 싶으면 그 전에 ⟲/재생 누르면 유지)
            setTimeout(function () { if (_narrAudio && _narrAudio.ended) _hidePlayer(); }, 2000);
        });
    }

    function _syncPlayerUI() {
        if (!_npWrap || _npWrap.style.display === 'none' || !_narrAudio) return;
        var dur = isFinite(_narrAudio.duration) ? _narrAudio.duration : 0;
        var cur = _narrAudio.currentTime || 0;
        if (!_npSeeking && dur > 0) _npSlider.value = String((cur / dur) * 100);
        _npTime.textContent = _fmtMMSS(cur) + ' / ' + _fmtMMSS(dur);
        _npBtn.innerHTML = _narrAudio.paused
            ? '<i class="fa-solid fa-play"></i>'
            : '<i class="fa-solid fa-pause"></i>';
    }

    function _showPlayer(title) {
        _ensurePlayerUI();
        if (_npTitle) _npTitle.textContent = title || '나레이션';
        _npWrap.style.display = 'block';
        _syncPlayerUI();
    }

    function _hidePlayer() {
        if (_npWrap) _npWrap.style.display = 'none';
    }

    /** 웹뷰가 Media Session API 를 지원하면 상태표시줄 미디어 컨트롤도 등록(미지원 시 무동작). */
    function _setupMediaSession(title) {
        try {
            if (!('mediaSession' in navigator)) return;
            if (typeof MediaMetadata === 'function') {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || '발표 나레이션', artist: 'SEA:GNAL 시연'
                });
            }
            navigator.mediaSession.setActionHandler('play', function () {
                if (_narrAudio) { var p = _narrAudio.play(); if (p && p.catch) p.catch(function () { }); }
            });
            navigator.mediaSession.setActionHandler('pause', function () {
                if (_narrAudio) _narrAudio.pause();
            });
            navigator.mediaSession.setActionHandler('seekbackward', function () {
                if (_narrAudio) _narrAudio.currentTime = Math.max(0, _narrAudio.currentTime - 10);
            });
            navigator.mediaSession.setActionHandler('seekforward', function () {
                if (_narrAudio && isFinite(_narrAudio.duration)) {
                    _narrAudio.currentTime = Math.min(_narrAudio.duration, _narrAudio.currentTime + 10);
                }
            });
            navigator.mediaSession.setActionHandler('seekto', function (d) {
                if (_narrAudio && d && d.seekTime != null) _narrAudio.currentTime = d.seekTime;
            });
        } catch (e) { /* 미지원/부분지원 — 조용히 무시 */ }
    }
    // ===================== [임시 — 발표 나레이션 끝] ==========================

    function _adminMode() {
        try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { return false; }
    }
    function _pushToken() {
        try { return localStorage.getItem('push_token') || ''; } catch (e) { return ''; }
    }

    /** 관리자 모드 + 등록된 관리자 기기인지 판정 (둘 다 만족해야 true) */
    function _isAdminDevice() {
        var token = _pushToken();
        if (!_adminMode() || !token) return Promise.resolve(false);
        return fetch('/api/admin/device-status?token=' + encodeURIComponent(token))
            .then(function (r) { return r.ok ? r.json() : { registered: false }; })
            .then(function (st) { return !!(st && st.registered); })
            .catch(function () { return false; });
    }

    /** 짧은 안내 토스트 (전역 헬퍼가 없을 때를 대비해 자체 포함) */
    function _toast(msg) {
        try {
            if (typeof window.showToast === 'function') { window.showToast(msg); return; }
        } catch (e) { /* noop */ }
        try {
            var el = document.createElement('div');
            el.textContent = msg;
            el.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);'
                + 'background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;padding:10px 18px;'
                + 'border-radius:10px;font-size:0.86rem;font-weight:700;z-index:99999;'
                + 'box-shadow:0 6px 20px rgba(124,58,237,0.45);max-width:88%;text-align:center;';
            document.body.appendChild(el);
            setTimeout(function () { try { el.remove(); } catch (e) { } }, 2600);
        } catch (e) { /* noop */ }
    }

    /**
     * ① 저장된 데모 슬롯 조회(먼저) → ② 슬롯이 있을 때만 테스트 모드 ON
     * → ③ 슬롯 전부 표출 → ④ 본인 화면 즉시 반영.
     *
     * [순서 주의] 테스트 모드를 먼저 켜면 실 특보가 숨겨지는데, 표출할 슬롯이
     * 0건이면 "빈 화면"으로 남아 관리자 센터에서 수동으로 꺼야만 복구된다.
     * 그래서 슬롯이 있는 것을 확인한 뒤에만 테스트 모드를 켠다.
     */
    function _activate() {
        if (_busy) return;
        _busy = true;
        fetch('/api/admin/demo/slots', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : { slots: [] }; })
            .then(function (data) {
                var slots = (data && data.slots) || [];
                if (!slots.length) {
                    _toast('저장된 데모 특보가 없습니다. (관리자 센터에서 먼저 등록하세요)');
                    return;
                }
                // ② 테스트 모드 ON
                return fetch('/api/admin/demo/testmode', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: true })
                })
                    // ③ 저장된 슬롯을 순차 표출 (각 표출이 관리자 기기에 푸시 발송)
                    .then(function () {
                        return slots.reduce(function (p, slot) {
                            return p.then(function () {
                                return fetch('/api/admin/demo/emit', {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ slotId: slot.id })
                                }).then(function () { }).catch(function () { });
                            });
                        }, Promise.resolve());
                    })
                    // ④ 본인 화면 즉시 반영 (demo_alert.js 폴링을 기다리지 않음)
                    .then(function () {
                        if (typeof window.reapplyDemoAlerts === 'function') setTimeout(window.reapplyDemoAlerts, 300);
                        _toast('특보 시연이 활성화되었습니다. (데모 특보 ' + slots.length + '건 표출)');
                    });
            })
            .catch(function () { _toast('특보 시연 활성화에 실패했습니다.'); })
            .then(function () { _busy = false; });
    }

    /**
     * [2단계] 태풍 발생/소멸 테스트 푸시 — 발생 → 소멸 순차 발송.
     * 둘 다 /api/admin/demo/typhoon-test 가 sendAdminPush 로 관리자 등록 기기에만
     * 발송한다(위치기반 반경 typhoon-radius-test 는 호출하지 않음 — 제외).
     */
    function _sendTyphoonTests() {
        if (_busy) return;
        _busy = true;
        var _post = function (kind) {
            return fetch('/api/admin/demo/typhoon-test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: kind })
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
                .catch(function () { return {}; });
        };
        // 발생 → 소멸 순차 (KMA 실데이터 조회가 있어 직렬 처리)
        _post('onset').then(function (r1) {
            return _post('dissipation').then(function (r2) {
                var ok1 = !!(r1 && r1.success), ok2 = !!(r2 && r2.success);
                if (ok1 && ok2) {
                    _toast('태풍 발생·소멸 테스트 푸시를 전송했습니다.');
                } else {
                    var err = ((r1 && r1.error) || '') + ' ' + ((r2 && r2.error) || '');
                    _toast('태풍 테스트 발송 실패' + (err.trim() ? ': ' + err.trim() : ''));
                }
            });
        }).catch(function () {
            _toast('태풍 테스트 발송에 실패했습니다.');
        }).then(function () { _busy = false; });
    }

    /**
     * ["해역별 기상현황" 5연타] 위치기반 시연 5건 — 나레이션(marine1) 진행 위치에 맞춰 시차 발송:
     *   (A) 태풍 위치기반 반경 2건(강풍→폭풍)  → 음원 6초  지점 도착 목표 [typhoon-radius-test]
     *   (B) 위치기반 특보 3건(예비→주의보→경보) → 음원 11초 지점 도착 목표
     *       (laDemoSetPosition()+laDemoRun(id,0) → /api/location-alert/demo 가 이 기기 1대에만 발송)
     *
     * 대기 시간 = 음원 위치(초) ÷ 재생 배속 − FCM 전달 보정(1.5초).
     *   배속은 서버 저장값(_narrMap['marine1'].rate)을 그대로 사용하므로
     *   관리자에서 배속을 바꿔도 항상 같은 음성 대목에서 알림이 도착한다.
     *   나레이션이 미업로드면 기존처럼 즉시 발송.
     */
    var NARR_PUSH_SYNC = { typhoonAtSec: 6, alertsAtSec: 11, fcmLeadMs: 1500 };

    function _sendLocationDemos() {
        if (_busy) return;
        var _radius = function (kind) {
            return fetch('/api/admin/demo/typhoon-radius-test', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: kind })
            }).then(function (r) { return r.json().catch(function () { return {}; }); })
                .catch(function () { return {}; });
        };
        // 특보 3종만 발송: 풍랑 예비특보 발표 / 풍랑주의보 발효 / 풍랑경보 발효
        //   (제외: adv_pub 발효예정, warn_pub 경보발표, typhoon 태풍경보발효)
        var LA_IDS = ['prelim', 'adv_act', 'warn_act'];

        // 나레이션 유무/배속 → 발송 대기 시간 산출
        var entry = _narrMap && _narrMap['marine1'];
        var rate = (entry && entry.rate && isFinite(entry.rate) && entry.rate > 0) ? entry.rate : 1;
        var hasNarr = !!(entry && entry.url);
        var delayTyphoon = hasNarr ? Math.max(0, NARR_PUSH_SYNC.typhoonAtSec * 1000 / rate - NARR_PUSH_SYNC.fcmLeadMs) : 0;
        var delayAlerts = hasNarr ? Math.max(0, NARR_PUSH_SYNC.alertsAtSec * 1000 / rate - NARR_PUSH_SYNC.fcmLeadMs) : 0;

        var sendTyphoon = function () {
            return _radius('strong').then(function () { return _radius('storm'); });
        };
        var sendAlerts = function () {
            if (typeof window.laDemoRun !== 'function') return Promise.resolve();
            var p = Promise.resolve();
            if (typeof window.laDemoSetPosition === 'function') {
                p = p.then(function () { return window.laDemoSetPosition(); }).catch(function () { });
            }
            LA_IDS.forEach(function (id) {
                p = p.then(function () { return window.laDemoRun(id, 0); }).catch(function () { });
            });
            return p;
        };

        // 예약 발송 — _busy 는 잡지 않는다(다음 단계 5연타를 막지 않도록,
        //   중복 발동은 _marineStage 단계 진행으로 이미 차단됨).
        var pTyphoon = new Promise(function (resolve) {
            setTimeout(function () {
                sendTyphoon().catch(function () { }).then(resolve);
            }, delayTyphoon);
        });
        var pAlerts = new Promise(function (resolve) {
            setTimeout(function () {
                sendAlerts().catch(function () { }).then(resolve);
            }, delayAlerts);
        });
        Promise.all([pTyphoon, pAlerts])
            .then(function () { _toast('위치기반 시연 푸시를 전송했습니다. (총 5건)'); })
            .catch(function () { _toast('위치기반 시연 발송에 실패했습니다.'); });
    }

    /** ["해역별 특보현황" 5연타] 현재 단계 동작 실행 후 다음 단계로 진행 */
    function _dispatchAlertHeader() {
        if (_busy) return;
        if (_stage === 0) {
            _stage = 1;
            _playNarration('alert1');  // [임시] 발표 나레이션 — 특보현황 1차
            _activate();              // 1단계: 특보 시연 활성화
        } else if (_stage === 1) {
            _stage = 2;
            _typhoonDemoArmed = true;  // 이후 해양종합정보 '태풍' 클릭 시 장미·통보문 제6-12호 자동 표출
            _demoSession = true;       // 시연 세션 진입 — 이후 물빠짐 확대 안내 카드 억제(세션 내내)
            _playNarration('alert2');  // [임시] 발표 나레이션 — 특보현황 2차
            _sendTyphoonTests();      // 2단계: 태풍 발생/소멸 테스트 푸시
        }
        // _stage >= 2 → 동작 없음 (추후 추가 예정)
    }

    /** 음성 비서 나리야 ON — 네이티브 플러그인 직접 호출(앱 전용, 웹/플러그인 없으면 무동작). */
    function _enableNariya() {
        try {
            var P = window.Capacitor && window.Capacitor.Plugins;
            var Native = P && P.SeagnalAssistant;
            if (!Native || !Native.enable) return;   // 앱 외 환경 — 무동작
            var profile = '{}';
            try { profile = localStorage.getItem('seagnal_profile') || '{}'; } catch (e) { /* noop */ }
            Native.enable({ serverUrl: location.origin, profile })
                .then(function () { _toast('음성 비서 나리야가 켜졌습니다.'); })
                .catch(function () { /* 권한/모델 미비 등 — 조용히 무시 */ });
        } catch (e) { /* noop */ }
    }

    /**
     * window.closeNariDemo 를 1회 래핑 — 기존 닫기 동작은 그대로 두고,
     * "트리거로 연 시연"이 닫힐 때만(_nariyaArmed) 나리야를 자동 ON 한다.
     * 닫기 버튼·하드웨어 뒤로가기(PopupStack) 모두 window.closeNariDemo 를 거치므로 한 곳만 래핑.
     */
    function _wrapCloseNariOnce() {
        if (window.__nariCloseWrappedBySeagnalDemo) return;
        var orig = window.closeNariDemo;
        if (typeof orig !== 'function') return;
        window.closeNariDemo = function () {
            var r;
            try { r = orig.apply(this, arguments); } catch (e) { r = undefined; }
            if (_nariyaArmed) { _nariyaArmed = false; _enableNariya(); }
            return r;
        };
        window.__nariCloseWrappedBySeagnalDemo = true;
    }

    /** [기상현황 2단계] AI 탭 시연(나리 소개 슬라이드) 열기 + 닫을 때 나리야 ON 무장. */
    function _openAiDemoAndArm() {
        if (typeof window.openNariDemo !== 'function') {
            _toast('AI 시연 모듈이 아직 로드되지 않았습니다.');
            return;
        }
        _wrapCloseNariOnce();   // openNariDemo 가 PopupStack 에 closeNariDemo 를 등록하기 전에 래핑
        _nariyaArmed = true;
        try { window.openNariDemo(); } catch (e) { _nariyaArmed = false; }
    }

    /** ["해역별 기상현황" 5연타] 1차=위치기반 시연, 2차=AI 시연 열기 (1회성). */
    function _dispatchMarineHeader() {
        if (_busy) return;
        if (_marineStage === 0) {
            _marineStage = 1;
            _playNarration('marine1');  // [임시] 발표 나레이션 — 기상현황 1차
            _sendLocationDemos();   // 1단계: 위치기반 시연 8건
        } else if (_marineStage === 1) {
            _marineStage = 2;
            _playNarration('marine2');  // [임시] 발표 나레이션 — 기상현황 2차
            _openAiDemoAndArm();    // 2단계: AI 시연 열기 → 닫으면 나리야 ON
        }
        // _marineStage >= 2 → 동작 없음 (1회성)
    }

    /**
     * [태풍 시연] 무장 상태에서 해양종합정보 '태풍' 클릭 시 1회 실행:
     *   제6호 장미 강제 표출(demoFocus) → 통보문 제6-12호 선택 → 해역표출 강제(디버그) ON.
     * demoFocus 가 실데이터를 비동기 로드(목록이 2단계로 채워질 수 있음)하므로,
     * 디버그는 즉시 켜고 통보문은 "제6-12호" 옵션이 나타날 때까지 폴링해서 선택한다.
     */
    function _runTyphoonDemo() {
        try {
            var OT = window.OceanTyphoon;
            if (!OT || typeof OT.demoFocus !== 'function') return;
            OT.demoFocus({ year: TPHN_DEMO.year, seq: TPHN_DEMO.seq });  // 장미(6호) 강제 표출
            _selectBulletinAndDebug(0);
            _mudflatDemoArmed = true;   // 이후 '물빠짐' 클릭 시 지정 좌표로 지도 이동 + 자동 재생
            _demoSession = true;        // 시연 세션 표시(알림 탭으로 진입해 헤더 무장 이력이 없어도 성립)
        } catch (e) { /* 시연 실패는 조용히 무시 */ }
    }

    /**
     * [알림 탭 → 인앱 태풍 시연] "태풍 발생/소멸" 테스트 알림을 탭하면, 앱을 재시작(splash)하지
     *   않고 해양종합정보 탭을 연 뒤 위 직접-버튼(2단계 무장) 경로와 동일하게
     *   제6호 장미 · 통보문 제6-12호 + 디버그(해역표출)를 강제 표출한다.
     *   capacitor-plugins.js 의 푸시 탭 핸들러(data.type === 'typhoon_test')에서 호출한다.
     *   (무장 여부와 무관하게 동작 — 이 알림을 받았다는 것 자체가 2단계 시퀀스를 거쳤다는 의미)
     */
    function _runTyphoonDemoFromNotification() {
        try {
            // [이중 트리거 방지] 헤더 10연타로 이미 무장(_typhoonDemoArmed)된 상태에서 알림을 탭하면
            //   버튼 클릭 핸들러를 우회하므로 arm 이 소진되지 않는다. 여기서 미리 소진하지 않으면,
            //   이후 태풍 버튼을 눌러 "끌" 때 버튼 핸들러가 그제서야 arm 을 소비해 시연을 재실행 →
            //   방금 끈 태풍이 다시 켜진다. 그래서 알림 경로 진입 시 arm 을 소진한다.
            _typhoonDemoArmed = false;
            if (typeof window.switchMainTab === 'function') {
                window.switchMainTab('ocean-map-section');   // 인앱 전환(페이지 새로고침/스플래시 없음)
            }
            _waitTyphoonReady(function () { _runTyphoonDemo(); }, 0);
        } catch (e) { /* 시연 실패는 조용히 무시 */ }
    }

    /**
     * OceanTyphoon 이 "실제로" 준비될 때까지 ~16초 폴링 후 done() 1회 호출.
     * [중요 — 초기화 레이스] 지도는 탭 진입 시 lazy 생성(marine.js 200ms)이고 ocean_typhoon 의
     *   tryInit 폴러(300ms)가 그 뒤 _map 을 잡으며 상태(_unlocked/_visible)를 리셋한다.
     *   demoFocus 존재만 보고 실행하면 그 리셋에 덮여 태풍이 표출되지 않으므로,
     *   ① 지도 인스턴스 생성 + ② OceanTyphoon.isReady()(tryInit 완료)까지 확인한다.
     *   콜드스타트 등으로 switchMainTab 이 아직 없어 탭 전환이 누락됐다면 여기서 재시도한다.
     */
    function _waitTyphoonReady(done, tries) {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map && typeof window.switchMainTab === 'function') {
            // 탭 전환이 아직 안 됐거나(콜드스타트 시 누락) 지도 미생성 → 전환 (map 생기면 더 안 부름)
            try { window.switchMainTab('ocean-map-section'); } catch (e) { /* noop */ }
        }
        var OT = window.OceanTyphoon;
        var ready = map && OT && typeof OT.demoFocus === 'function'
            && (typeof OT.isReady !== 'function' || OT.isReady())   // tryInit(레이어/바인딩/상태) 완료
            && document.getElementById('ocean-typhoon-toggle-btn');
        if (ready) { setTimeout(done, 250); return; }   // 탭 전환 직후 렌더 여유
        if (tries < 80) setTimeout(function () { _waitTyphoonReady(done, tries + 1); }, 200);
    }

    /**
     * [물빠짐 시연] 무장 상태에서 해양종합정보 '물빠짐' 클릭 시 1회 실행:
     *   지정 좌표(경기만)를 화면 중앙으로 이동(줌 고정) + 슬라이더 자동 재생.
     *   ※ 물빠짐 예측 팝업은 열지 않는다(지도 이동·재생만).
     */
    function _runMudflatDemo() {
        // 1) 지도 중앙 이동 + 줌 (moveend 핸들러가 바닥선 통과 시 안내 숨김·렌더 처리)
        try {
            var map = window.__getOceanMap && window.__getOceanMap();
            if (map && window.ol && window.ol.proj) {
                map.getView().animate({
                    center: window.ol.proj.fromLonLat([MUDFLAT_DEMO.lon, MUDFLAT_DEMO.lat]),
                    zoom: MUDFLAT_DEMO.zoom,
                    duration: 700
                });
            }
        } catch (e) { /* noop */ }
        // 2) 프레임 준비되면 슬라이더 자동 재생
        _autoplayMudflat(0);
    }

    /** 물빠짐 슬라이더(프레임)가 준비되면 자동 재생 시작(정지 상태일 때만). ~8초 폴링. */
    function _autoplayMudflat(tries) {
        var slider = document.getElementById('mudflat-slider');
        var playBtn = document.getElementById('mudflat-play-btn');
        if (slider && playBtn && (parseInt(slider.max, 10) || 0) > 0) {
            // 아이콘이 pause 면 이미 재생 중 → 클릭 안 함(토글로 멈추지 않도록)
            if (String(playBtn.innerHTML).indexOf('fa-pause') < 0) playBtn.click();
            return;
        }
        if (tries < 40) setTimeout(function () { _autoplayMudflat(tries + 1); }, 200);
    }

    /** 통보문 라벨("제6-12호")이 드롭다운에 나타날 때까지 ~6초 폴링 후 선택 + 디버그 ON. */
    function _selectBulletinAndDebug(tries) {
        // 디버그(해역표출 강제)는 체크박스가 보이면 통보문 매칭과 무관하게 즉시 켠다.
        var dbg = document.getElementById('tphn-dbg-korea');
        if (dbg && !dbg.checked) { dbg.checked = true; dbg.dispatchEvent(new Event('change')); }

        var bSel = document.getElementById('tphn-bulletin');
        var needle = '제' + TPHN_DEMO.seq + '-' + TPHN_DEMO.bno + '호';   // "제6-12호" (라벨 매칭 — code 형식 무관)
        var target = null;
        if (bSel && bSel.options) {
            for (var i = 0; i < bSel.options.length; i++) {
                if (String(bSel.options[i].textContent || '').indexOf(needle) >= 0) { target = bSel.options[i].value; break; }
            }
        }
        if (target) {
            if (bSel.value !== target) {
                bSel.value = target;
                bSel.dispatchEvent(new Event('change'));  // → selectBulletin 실행
            }
            return;
        }
        // 아직 목록에 없으면(로딩 중) 계속 폴링 — 첫 채움에서 멈추지 않는다.
        //   (dmdw 실데이터 로드가 느린 환경 대비 ~12초까지 대기)
        if (tries < 80) setTimeout(function () { _selectBulletinAndDebug(tries + 1); }, 150);
    }

    /**
     * 5연타 카운터 생성기 — 헤더마다 독립된 카운트를 갖는다.
     * 5번째 클릭이 완성되면 관리자 등록 기기에서만 onComplete() 를 실행.
     * @param {Function} onComplete 5연타 완성 시 실행할 동작
     * @param {Function} [skip] true 를 반환하면 device-status 호출 없이 건너뜀
     */
    function _makeCounter(onComplete, skip) {
        var count = 0, firstTs = 0;
        return function () {
            // [임시 — 발표 나레이션] 발동은 _isAdminDevice() 비동기 확인 "이후"라 사용자
            //   제스처 컨텍스트가 끊긴다. 클릭 순간(제스처 내)에 무음 재생으로 미리 언락.
            //   관리자 모드 기기에서만 수행 — 일반 사용자는 기존과 완전 동일.
            //   (앱 시작 후 관리자 모드를 켠 경우 대비: 매핑 미로드 상태면 여기서 로드)
            if (_adminMode()) { _unlockAudio(); if (_narrMap === null) _loadNarrationMap(); }
            var now = Date.now();
            if (now - firstTs > WINDOW_MS) { count = 0; firstTs = now; }
            count++;
            if (count >= NEED_CLICKS) {
                count = 0;
                if (typeof skip === 'function' && skip()) return;
                // 관리자 등록 기기에서만 발동 — 일반 사용자는 무동작
                _isAdminDevice().then(function (ok) { if (ok) onComplete(); });
            }
        };
    }

    function _init() {
        // [임시 — 발표 나레이션] 관리자 모드 기기에서만 슬롯 매핑 프리로드(일반 사용자 요청 없음)
        if (_adminMode()) _loadNarrationMap();
        // [A] 해역별 특보현황 — 단계 진행식(특보 → 태풍)
        var alertHeader = document.getElementById('main-accordion-header');
        if (alertHeader) {
            // 기존 onclick(toggleMainAccordion) 은 그대로 두고 클릭 카운터만 추가
            alertHeader.addEventListener('click', _makeCounter(
                _dispatchAlertHeader,
                function () { return _stage >= 2; }  // 단계 소진 시 불필요한 호출 방지
            ));
        }
        // [B] 해역별 기상현황 — 단계 진행식(위치기반 → AI 시연), 1회성
        var marineHeader = document.getElementById('marine-status-accordion-header');
        if (marineHeader) {
            marineHeader.addEventListener('click', _makeCounter(
                _dispatchMarineHeader,
                function () { return _marineStage >= 2; }  // 단계 소진 시 불필요한 호출 방지
            ));
        }
        // [임시 — 발표 나레이션] 메인탭 "해양종합정보" 5연타 → ocean 슬롯 나레이션 재생.
        //   특보현황 5연타×2 다음의 "해양종합정보 진입" 발표 단계용. 다른 시연 동작은
        //   일으키지 않고 음성만 재생한다(단계 없음 — 5연타마다 재생, 리허설 반복 가능).
        //   _makeCounter 가 관리자 등록 기기 확인을 거치므로 일반 사용자는 무동작.
        var oceanTab = document.querySelector('button.tab-btn[data-target="ocean-map-section"]');
        if (oceanTab) {
            oceanTab.addEventListener('click', _makeCounter(function () {
                _playNarration('ocean');
            }));
        }
        // [C] 해양종합정보 '태풍' 버튼 — 특보현황 2단계(태풍 푸시) 후 무장되면,
        //     클릭 시 1회 한정으로 장미·통보문 제6-12호 + 디버그 자동 표출. (무장 안 됐으면 무동작)
        var tphnBtn = document.getElementById('ocean-typhoon-toggle-btn');
        if (tphnBtn) {
            tphnBtn.addEventListener('click', function () {
                if (!_typhoonDemoArmed) return;
                _typhoonDemoArmed = false;             // 1회성
                setTimeout(_runTyphoonDemo, 350);      // 기존 토글/잠금해제 처리 후 실행
            });
        }
        // [D] 해양종합정보 '물빠짐' 버튼 — 태풍 시연 표출 후 무장되면,
        //     클릭 시 1회 지정 좌표로 지도 중앙 이동 + 슬라이더 자동 재생.
        var mudBtn = document.getElementById('ocean-mudflat-toggle-btn');
        if (mudBtn) {
            mudBtn.addEventListener('click', function () {
                if (!_mudflatDemoArmed) return;
                _mudflatDemoArmed = false;             // 1회성
                _playNarration('mudflat');             // [임시] 발표 나레이션 — 무장 소진되는 "첫 클릭"에만 1회 재생
                setTimeout(_runMudflatDemo, 400);      // activate() 가 레이어/슬라이더 준비한 뒤 실행
            });
        }
    }

    // [알림 탭 연동] capacitor-plugins.js 의 푸시 탭 핸들러가 호출하는 인앱 태풍 시연 진입점 노출.
    window.SeagnalDemo = window.SeagnalDemo || {};
    window.SeagnalDemo.runTyphoonFromNotification = _runTyphoonDemoFromNotification;
    // 시연 세션 여부 — tide_field.js(물빠짐)가 확대 안내 카드 억제 판단에 사용(일반 사용자 false).
    window.SeagnalDemo.isDemoSession = function () { return _demoSession; };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
})();
