/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing.js
 * 역할  : 해양예보 탭 「🔭 기상청 해상 기상 전망」 바로 아래의 「HH:MM AI 연안 안전 브리핑」 아코디언(설계서 §11.1~§11.4 · 이름·제목 §11.10.4 — 종전 「활동지점 안전 브리핑」).
 *         제목의 HH:MM 은 보이는 판의 시각(07:30·17:30·23:00, 특보 변경 판은 만든 시각 — StationBriefingRender.titleText).
 *         ①서버 노출 판정이 display:true 일 때만 아코디언을 보인다(처음에는 관리자 기기에만 — 일반 사용자 화면은 그대로)
 *         ②설정 흐름: 설정 전 안내 → [설정하기] → 파출소 관할 하나를 누르면 가운데 확인 창 [취소]/[저장](해상·육상 함께, 각각 끄기 가능) · 건너뛰기 → 「더 이상 표시하지 않을까요?」
 *         ③본문(station_briefing_render.js) ④카드의 [위험예측에서 보기 ›] ⑤특보 변경 판 N 뱃지 ⑥설정 팝업(⚙ 오른쪽 위)의 표시/숨김·관할 설정 칸.
 *         ⑦「지금 밀집」 줄·선박 팝업 지도는 보고 있는 동안 새 실시간 선박 자료가 오면 바뀐다(pollNow — §11.10.24).
 *         선택은 이 기기에만 저장한다(localStorage — 관심해역 설정 weatherAppSettings_v1·지방청 설정 officeManualSettings 와 같은 관례).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : station_briefing_render.js(StationBriefingRender.render) · station_briefing_picker.js(StationBriefingPicker — 관할 고르기 탭 두 개 · 관할을 누르면 뜨는 가운데 확인 창 confirm)
 *                    · marine-life/risk-forecast/risk_forecast.js(RiskForecast.openAt — 바로가기)
 *                    · forecast/alerts/marine.js·core/index2_patch.js·marine-life/safety/life_safety.js(switchMainTab·switchSubTab — 탭 이동)
 *                    · settings/settings.js(openSettingsModal 이 renderSettings 를 부름 · closeSettingsModal) · shared/ui/ui_modal.js(showSeagnalModal — 숨김 안내)
 *                    · style.css .new-badge(공지사항과 같은 N 뱃지) · core/index2_patch.js(_showOceanToast — 바로가기 실패 안내)
 *                    · admin/admin.js('seagnal-admin-change' 사건 — 관리자 상태가 바뀌면 노출 판정 다시) · settings.js settingsModalHasUnsaved·saveSettingsAndClose([관할 설정])
 *                    · index2.html applyFeatureBlocks(점검 차단 'station-briefing' — window._blockedFeatures, 차단을 바꾼 뒤 applyVisibility 를 부름)
 *  - 서버 API      : GET /api/station-briefing/stations · GET /api/station-briefing/areas(고르기 지도 — picker 가 처음 지도를 열 때) · GET /api/station-briefing?station=&day=auto (routes/station_briefing.js — 노출 판정)
 *                    · GET /api/station-briefing/now?station=&day=auto&since=(「지금 밀집」만 — 보고 있는 동안 1분마다, §11.10.24 pollNow)
 *                    관리자 기기 판정 정보는 특보 예측 표출 제어(forecast/prediction/advisory_prediction.js _adminAuth)와 같은 방식:
 *                    관리자 모드(seagnal_admin_mode)일 때만 push_token → 쿼리 adminToken · 로그인 토큰 → X-Admin-Token 헤더
 *  - 마크업        : index2.html #station-briefing-accordion-header/body · #station-briefing-title(제목 글) · #station-briefing-content · #station-briefing-badge-slot
 *                    · #station-briefing-settings-btn · 설정 팝업 #station-briefing-settings(관심해역 탭)
 *  - 나를 쓰는 곳  : index2.html(아코디언 onclick) · settings.js(openSettingsModal) · 스스로 DOMContentLoaded 에 init
 *  - 계약          : client/js/ocean-map/coastal-risk/briefing.contract.md
 * [로드 순서] station_briefing_picker.js 다음(life_safety.js 뒤 묶음의 마지막) — 순서 변경 금지
 * ============================================================================
 */
(function (w) {
    'use strict';
    var KEY = 'seagnal_station_briefing_v1';
    var DEFAULTS = { station: null, name: null, office: null, seaOnly: false, showSea: true, showLand: true, hidden: false, seen: {} };
    var REFRESH_MS = 10 * 60000;   // 노출 판정·브리핑을 다시 받는 간격 — 판은 하루 세 번 + 특보 변경 때만 바뀐다(노출 범위 전환도 이 간격 안에 반영, 2단계 검토 A3)
    // 노출 판정 조회가 실패했을 때 다시 묻는 간격(2단계 검토 A5) — 직전 판정은 그대로 두고 짧게 세 번까지. 그 뒤는 10분 주기에 맡긴다.
    var RETRY_MS = [5000, 20000, 60000];
    // 「지금 밀집」 줄·선박 팝업을 보고 있는 동안 실시간 선박 자료가 바뀌었는지 묻는 간격(설계서 §11.10.24 — 사용자 결정 (가) 새 자료가 들어올 때마다).
    //   수집기는 1분마다 깨어나 5분 칸마다 한 번 받는다(sea_realtime_collector.js start·collect) — 1분 간격이면 새 자료가 저장된 뒤 1분 안에 보인다.
    //   서버(GET /now)는 자료 시각이 같으면 계산 없이 {unchanged:true} 만 준다.
    var NOW_MS = 60000;
    var S = { display: false, audience: null, stations: null, resp: null, fetchedAt: 0, mode: 'view', pick: null, timer: null, seq: 0, retry: 0, retryTimer: null, nowTimer: null, nowBusy: false };

    /**
     * 이 기기에 저장한 선택을 읽는다(저장소가 막혀 있으면 기본값).
     * 예: prefs() → {station:'제주해양경찰서|한림파출소', name:'한림파출소', office:'제주해양경찰서', showSea:true, showLand:true, hidden:false, seen:{…}}
     * @returns {Object} [연계] ← 이 파일 전체 / localStorage seagnal_station_briefing_v1
     */
    function prefs() {
        var p = {};
        try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { p = {}; }
        var out = {}; Object.keys(DEFAULTS).forEach(function (k) { out[k] = p[k] !== undefined ? p[k] : DEFAULTS[k]; });
        if (!out.seen || typeof out.seen !== 'object') out.seen = {};
        return out;
    }
    /** 선택을 저장한다. 예: save(Object.assign(prefs(), {hidden:true})). @param {Object} p @returns {void} [연계] ← 설정 흐름·뱃지 */
    function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { console.warn('[연안 안전 브리핑] 설정 저장 실패 — 이 기기에서 다음에 다시 물을 수 있다'); } }

    /**
     * 노출 판정용 관리자 정보 — 특보 예측(advisory_prediction.js _adminAuth)과 같은 방식.
     * 관리자 모드가 아니면 빈 값 → 서버가 「관리자에게만」 설정에서 display:false 를 준다.
     * 예: 관리자 모드 + push_token 'tok' → {params:'adminToken=tok', headers:{'X-Admin-Token':…}}
     * @returns {{params:string, headers:Object}} [연계] ← get / 서버 routes/station_briefing.js who()
     */
    function adminAuth() {
        try {
            if (localStorage.getItem('seagnal_admin_mode') !== 'true') return { params: '', headers: {} };
            var headers = {}, tok = '';
            try { tok = localStorage.getItem('seagnal_admin_token') || ''; } catch (e) { tok = ''; }
            if (!tok) { try { tok = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('seagnal_admin_token')) || ''; } catch (e) { /* 세션 저장소 막힘 — 토큰 없이 */ } }
            if (tok) headers['X-Admin-Token'] = tok;
            var pt = localStorage.getItem('push_token') || '';
            return { params: pt ? 'adminToken=' + encodeURIComponent(pt) : '', headers: headers };
        } catch (e) { return { params: '', headers: {} }; }
    }
    /**
     * 브리핑 API 를 부른다(관리자 정보 포함). 실패면 던진다.
     * 예: await get('/api/station-briefing/stations') → {ok:true,display:true,stations:[…]}
     * @param {string} path - '/api/station-briefing…' (쿼리 포함 가능) @returns {Promise<Object>} [연계] ← refreshDisplay·loadBriefing
     */
    async function get(path) {
        var a = adminAuth(), url = path + (a.params ? (path.indexOf('?') >= 0 ? '&' : '?') + a.params : '');
        var r = await fetch(url, { headers: a.headers, cache: 'no-store' });
        if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
        return r.json();
    }
    /** id 로 요소. @param {string} id @returns {HTMLElement|null} */
    function $(id) { return document.getElementById(id); }

    /**
     * 아코디언 머리·몸·⚙·설정 팝업 칸의 보임을 지금 상태에 맞춘다.
     * 예: display:false → 머리·몸 숨김(지금 화면과 같음) · display:true + 숨김 선택 → 숨김 · 관할 설정됨 → ⚙ 보임
     * @returns {void} [연계] ← refreshDisplay·설정 흐름·설정 팝업 스위치
     */
    function applyVisibility() {
        var p = prefs(), show = S.display && !p.hidden, h = $('station-briefing-accordion-header'), b = $('station-briefing-accordion-body'), gear = $('station-briefing-settings-btn');
        if (h) h.style.display = show ? '' : 'none';
        // 점검 차단(index2.html applyFeatureBlocks — 'station-briefing', 2단계 검토 A6): 몸을 숨긴 채 둔다(머리에는 「점검 중」 덮개).
        //   관리자 모드는 기존 관례대로 외관만 차단 — 머리를 누르면 열리고(toggle), 열어 둔 것은 정기 갱신이 다시 숨기지 않는다.
        if (b) b.style.display = show && (!blocked() || (adminMode() && b.style.display !== 'none')) ? '' : 'none';
        if (gear) gear.style.display = show && p.station ? '' : 'none';
        updateBadge();
        var modal = $('settings-modal');
        if (modal && !modal.classList.contains('hidden')) renderSettings();
    }
    /**
     * 노출 판정과 관할 목록을 받아 아코디언을 보일지 정하고, 보이면 본문을 채운다.
     * 실패하면 아코디언을 그리지 않는다(특보 예측과 같음 — 일반 화면에 오류를 띄우지 않는다). 콘솔에는 남긴다.
     * 예: 관리자 기기 → display:true → 관할이 있으면 브리핑을 받는다 / 일반 기기 → display:false → 아무것도 안 보임
     * @returns {Promise<void>} [연계] ← init·설정 팝업 열 때(관리자 모드를 막 켰을 수 있다) / → get·applyVisibility·loadBriefing·renderBody
     */
    async function refreshDisplay() {
        var n = ++S.seq;
        clearTimeout(S.retryTimer); S.retryTimer = null;
        try {
            var r = await get('/api/station-briefing/stations');
            if (n !== S.seq) return;
            S.display = !!(r && r.display === true); S.audience = r && r.audience || null;
            S.stations = S.display && Array.isArray(r.stations) ? r.stations : null;
            S.retry = 0;
        } catch (e) {
            if (n !== S.seq) return;
            // 일시 실패로 아코디언을 지우지 않는다(2단계 검토 A5) — 직전 판정(처음이면 「안 보임」)을 그대로 두고 짧게 다시 묻는다.
            var wait = RETRY_MS[S.retry];
            console.warn('[연안 안전 브리핑] 노출 판정 조회 실패 — 직전 판정 유지(' + (S.display ? '보임' : '안 보임') + ')' + (wait ? ', ' + wait / 1000 + '초 뒤 다시' : ', 다음 정기 갱신에 다시') + ':', e && e.message);
            if (wait) { S.retry++; S.retryTimer = setTimeout(refreshDisplay, wait); }
            return;
        }
        var p = prefs();
        // 저장된 관할이 목록에서 사라졌으면(관할 개편) 다시 고르게 한다 — 지난 이름으로 빈 브리핑을 계속 묻지 않는다.
        if (S.display && p.station && S.stations && !S.stations.some(function (s) { return s.key === p.station; })) { p.station = null; save(p); }
        applyVisibility();
        // 고르는 중(setup·confirm)이면 본문을 다시 그리지 않는다 — 정기 갱신(10분)이 찾기 글자·고른 관할을 지우지 않게.
        if (S.display && !p.hidden && S.mode === 'view') { if (p.station) await loadBriefing(); else renderBody(); }
    }
    /**
     * 고른 관할의 브리핑을 받아 본문을 그린다(day=auto — 21시부터 내일 판). 실패면 본문에 「불러오지 못했다」.
     * 예: await loadBriefing() → S.resp = {ok:true,display:true,date:'2026-10-17',briefing:{…}}
     * @returns {Promise<void>} [연계] ← refreshDisplay·설정 저장·아코디언 열기(10분 지났으면)·10분 주기 / → renderBody·updateBadge
     */
    async function loadBriefing() {
        var p = prefs(); if (!S.display || !p.station) return;
        var n = ++S.seq;
        try {
            var r = await get('/api/station-briefing?station=' + encodeURIComponent(p.station) + '&day=auto');
            if (n !== S.seq) return;
            if (!r || r.display !== true) { S.display = false; applyVisibility(); return; }
            // 팝업 지도(선박·관광지 등)가 열린 채 같은 판을 다시 받았으면 본문을 다시 그리지 않는다 — 다시 그리면 열린 창이 닫힌다(§11.10.24). 「지금 밀집」만 바꾼다.
            var same = S.resp && S.resp.briefing && r.briefing && S.resp.date === r.date && S.resp.briefing.generatedAt === r.briefing.generatedAt && S.resp.briefing.edition === r.briefing.edition;
            var R = w.StationBriefingRender, keep = same && S.mode === 'view' && R && R.popupOpen && R.popupOpen();
            S.resp = r; S.fetchedAt = Date.now();
            if (keep && R.updateNow($('station-briefing-content'), r)) { updateBadge(); setTitle(); return; }
        } catch (e) {
            if (n !== S.seq) return;
            console.warn('[연안 안전 브리핑] 브리핑 조회 실패:', e && e.message);
            S.resp = { error: true }; S.fetchedAt = 0;
        }
        if (S.mode === 'view') renderBody();
        updateBadge(); setTitle();
    }
    /**
     * 「지금 밀집」이 화면에 보이는가 — 기기 화면이 켜져 있고(visibilityState), 브리핑 본문이 실제로 보이거나(아코디언 펼침·해양예보 탭) 선박 팝업 지도가 열려 있을 때.
     * 예: 아코디언 접힘·다른 탭 → 거짓 · 선박 팝업 열림 → 참
     * @returns {boolean} [연계] ← pollNow / → StationBriefingRender.nowPopupOpen
     */
    function nowShown() {
        if (document.visibilityState === 'hidden') return false;
        var R = w.StationBriefingRender; if (R && R.nowPopupOpen && R.nowPopupOpen()) return true;
        var body = $('station-briefing-accordion-body'), box = $('station-briefing-content');
        return !!(body && box && !body.classList.contains('collapsed') && body.style.display !== 'none' && box.getClientRects().length);
    }
    /**
     * 실시간 선박 자료가 바뀌었으면 「지금 밀집」 줄(시각·척수·붐비는 해역)과 열린 선박 팝업 지도를 바꾼다 — 브리핑 본문은 다시 받지도 그리지도 않는다(설계서 §11.10.24).
     * 사용자 원문 2026-10-18: *"08:40 기준 관할 해역 선박 75척 이렇게 되어 있는데 … 실시간으로 데이터를 업데이트 시킬 수 있는 거 아닌가? 그래서 실시간 현황이 계속 표출될 수 있도록 … 시간도 계속 바뀌어가면서"*
     * GET /api/station-briefing/now?station=&day=auto&since=<지금 가진 now.at> — 같으면 {unchanged:true}. 줄이 새로 생기거나 없어져야 하면 본문을 다시 그린다(드묾 — 자료가 낡았다 돌아올 때).
     * 예: await pollNow() → true(바뀜) · false(그대로·보이지 않음·실패)
     * @returns {Promise<boolean>} [연계] ← init(1분 주기·화면 다시 보임) / → get·StationBriefingRender.updateNow·renderBody
     */
    async function pollNow() {
        var p = prefs();
        if (!S.display || S.mode !== 'view' || !p.station || p.showSea === false || !S.resp || !S.resp.briefing || S.nowBusy || !nowShown()) return false;
        var seq = S.seq, since = (S.resp.now && S.resp.now.at) || '', r;
        S.nowBusy = true;
        try { r = await get('/api/station-briefing/now?station=' + encodeURIComponent(p.station) + '&day=auto' + (since ? '&since=' + encodeURIComponent(since) : '')); }
        catch (e) { console.warn('[연안 안전 브리핑] 지금 밀집 다시 받기 실패 — 다음 주기에 다시:', e && e.message); return false; }
        finally { S.nowBusy = false; }
        if (seq !== S.seq || !S.resp || !S.resp.briefing || S.mode !== 'view') return false;   // 그 사이 브리핑을 다시 받았으면 버린다
        if (!r || r.display !== true) { S.display = false; applyVisibility(); return false; }
        if (r.now && r.now.unchanged) return false;
        S.resp.now = r.now || null;
        if (!w.StationBriefingRender || !w.StationBriefingRender.updateNow($('station-briefing-content'), S.resp)) renderBody();
        return true;
    }
    /**
     * 아코디언 제목 글을 보이는 판의 시각으로 맞춘다 — 「07:30 AI 연안 안전 브리핑」(2026-10-17 사용자 *"연안 안전 브리핑 아코디언을 hh:mm AI 연안 안전 브리핑으로 변경해줘."*). 판이 없으면 「AI 연안 안전 브리핑」.
     * 예: S.resp.briefing = {edition:'morning',publishAt:'…T07:30…'} → '07:30 AI 연안 안전 브리핑'
     * @returns {void} [연계] ← loadBriefing·renderBody·finishSetup / → StationBriefingRender.titleText / 마크업 #station-briefing-title
     */
    function setTitle() {
        var t = $('station-briefing-title'); if (!t) return;
        var b = S.resp && S.resp.briefing && prefs().station ? S.resp.briefing : null;
        t.textContent = w.StationBriefingRender && w.StationBriefingRender.titleText ? w.StationBriefingRender.titleText(b) : 'AI 연안 안전 브리핑';
    }

    /**
     * 아코디언 본문을 지금 모드(view·setup·confirm)에 맞춰 그린다.
     * 예: 관할 없음 → 「설정되지 않았습니다」 + [설정하기] · 관할 있음 → 브리핑 본문
     * @returns {void} [연계] ← loadBriefing·설정 흐름 / → StationBriefingRender.render·renderSetup·renderConfirm
     */
    function renderBody() {
        var box = $('station-briefing-content'); if (!box) return;
        if (w.StationBriefingPicker) w.StationBriefingPicker.destroy();   // 고르기 화면의 지도를 정리(다시 그리거나 다른 화면으로 바뀜)
        if (S.mode === 'setup') return renderSetup(box);
        if (S.mode === 'confirm') return renderConfirm(box);
        var p = prefs();
        setTitle();   // 관할이 없거나(지움) 브리핑을 아직 못 받았으면 시각 없는 제목
        box.textContent = '';
        if (!p.station) {
            var u = document.createElement('div'); u.className = 'sb-unset';
            var h = document.createElement('h4'); h.textContent = '연안 안전 브리핑 지역이 설정되지 않았습니다'; u.appendChild(h);
            var t = document.createElement('p'); t.textContent = '파출소 관할 하나를 고르면 그 관할의 해상·연안 안전 브리핑을 보여 드립니다.'; u.appendChild(t);
            var acts = document.createElement('div'); acts.className = 'sb-actions';
            var go = document.createElement('button'); go.type = 'button'; go.className = 'sb-btn sb-btn-primary'; go.id = 'station-briefing-setup-btn'; go.textContent = '설정하기';
            go.addEventListener('click', function (e) { e.stopPropagation(); openSetup(); });
            acts.appendChild(go); u.appendChild(acts); box.appendChild(u);
            return;
        }
        if (!S.resp) { var l = document.createElement('p'); l.className = 'sb-small'; l.textContent = '브리핑을 불러오는 중입니다…'; box.appendChild(l); return; }
        if (S.resp.error) { var er = document.createElement('p'); er.className = 'sb-miss'; er.textContent = '브리핑을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'; box.appendChild(er); return; }
        if (!w.StationBriefingRender) return;
        w.StationBriefingRender.render(box, S.resp, { showSea: p.showSea !== false, showLand: p.showLand !== false, onLink: openInRisk });
    }

    /**
     * 관할 고르기 화면(§11.2·Q3 「파출소 관할 하나만 고르면 해상·육상 둘 다」). 고르는 칸은 탭 두 개(2026-10-17 사용자 요청 — station_briefing_picker.js):
     * 「지도에서 선택하기」(해역 단추 → 관할 폴리곤 지도) · 「파출소로 선택하기」(지방청 → 해양경찰서 → 파출소 아코디언 + 이름 찾기, 남항 두 곳은 경찰서로 구분).
     * 관할을 누르면(두 탭 모두) 가운데 확인 창 [취소] [저장](StationBriefingPicker.confirm — 사용자 2026-10-17 *"저장하면 그대로 바로 반영"*):
     * [저장] = 종전 아래 [저장]과 같음(finishSetup) · [취소] = 누르기 전 선택(칠·「선택: …」·연안 칸)으로 되돌려 다른 관할을 누를 수 있다.
     * 아래 [저장]·[건너뛰기]·[취소] 줄은 없앴다 — 고르지 않고 나가는 단추 하나만 머리 오른쪽에 남긴다:
     * 관할이 없으면 [건너뛰기](종전과 같이 「더 이상 표시하지 않을까요?」로) · 이미 설정했으면 [취소](종전과 같이 바꾸지 않고 브리핑으로).
     * 해상·연안 보기 칸은 누르기 전에 정하도록 고르기 칸 위로 옮겼다(누르면 곧 저장되므로). 해상만 관할은 연안 칸을 끄고 이유를 보인다.
     * 예: 한림 폴리곤(또는 칩) 누름 → 「제주해양경찰서 한림파출소 / 이 관할을 선택하셨습니까? 저장하시겠습니까?」 → [저장] → 브리핑
     * @param {HTMLElement} box @returns {void} [연계] ← renderBody(mode setup) / → StationBriefingPicker.mount·confirm · finishSetup·askHide
     */
    function renderSetup(box) {
        var p = prefs();
        if (!S.pick) S.pick = { station: p.station, showSea: p.showSea !== false, showLand: p.showLand !== false };
        box.textContent = '';
        var wrap = document.createElement('div'); wrap.className = 'sb-setup'; wrap.setAttribute('data-sb-setup', '');
        var head = document.createElement('div'); head.className = 'sb-setup-head';
        var h = document.createElement('h4'); h.textContent = '연안 안전 브리핑 지역 설정'; head.appendChild(h);
        // 고르지 않고 나가기 — 관할이 없으면 [건너뛰기](finishSetup(true) → 묻기 화면, 종전 [건너뛰기]와 같음) · 있으면 [취소](종전 [취소]와 같음)
        var out = document.createElement('button'); out.type = 'button'; out.className = 'sb-btn sb-setup-out';
        if (p.station) { out.textContent = '취소'; out.setAttribute('data-sb-cancel', ''); out.addEventListener('click', function (e) { e.stopPropagation(); S.mode = 'view'; S.pick = null; renderBody(); }); }
        else { out.textContent = '건너뛰기'; out.setAttribute('data-sb-skip', ''); out.addEventListener('click', function (e) { e.stopPropagation(); finishSetup(true); }); }
        head.appendChild(out); wrap.appendChild(head);
        var d = document.createElement('p'); d.textContent = '파출소 관할 하나를 고르면 그 관할의 해상과 연안 브리핑을 함께 보여 드립니다. 이 기기에만 저장됩니다.'; wrap.appendChild(d);
        var toggles = document.createElement('div'); toggles.className = 'sb-toggles';
        var mk = function (label, key) {
            var l = document.createElement('label'); l.className = 'sb-toggle'; var c = document.createElement('input'); c.type = 'checkbox'; c.setAttribute('data-sb-show', key);
            c.checked = S.pick[key] !== false; c.addEventListener('change', function () { S.pick[key] = c.checked; });
            l.appendChild(c); l.appendChild(document.createTextNode(label)); toggles.appendChild(l); return c;
        };
        var cSea = mk('해상 브리핑 보기', 'showSea'), cLand = mk('연안 브리핑 보기', 'showLand');
        var landNote = document.createElement('p'); landNote.className = 'sb-small'; toggles.appendChild(landNote);
        wrap.appendChild(toggles);
        var pickBox = document.createElement('div'); pickBox.className = 'sb-picker'; wrap.appendChild(pickBox);
        var picked = document.createElement('p'); picked.className = 'sb-picked'; wrap.appendChild(picked);
        box.appendChild(wrap);
        var stations = S.stations || [], picker = null;
        /** 고른 관할 줄·연안 칸(해상만이면 끔)·고르기 칸의 선택 표시(칩 눌림·지도 폴리곤 색)를 맞춘다. */
        var sync = function () {
            var st = stations.filter(function (s) { return s.key === S.pick.station; })[0] || null;
            picked.textContent = st ? '선택: ' + st.name + ' · ' + st.office : '선택한 관할 없음';
            cLand.disabled = !!(st && st.seaOnly); landNote.textContent = st && st.seaOnly ? '이 관할은 관광지 자료가 없어 해상 브리핑만 제공합니다.' : '';
            if (st && st.seaOnly) cLand.checked = false;
            if (picker) picker.refresh();
        };
        /**
         * 관할 하나를 누른다(지도 폴리곤·칩 어느 쪽이든) → 칠하고 확인 창. [저장] = 종전 [저장] · [취소] = 누르기 전으로 되돌림.
         * 해상만 관할 때문에 꺼졌던 연안 칸(잠김)은 해상만이 아닌 관할로 바꾸면 다시 켠다. 사람이 끈 연안 칸은 그대로 둔다
         * (칸을 먼저 정하고 누르는 흐름이라 — 종전 「끈 칸이면 다시 켬」은 사람이 끈 것까지 켰다).
         * @param {Object} s - 관할 목록 한 줄
         */
        var choose = function (s) {
            var before = { station: S.pick.station, land: cLand.checked, showLand: S.pick.showLand };
            S.pick.station = s.key; if (!s.seaOnly && cLand.disabled) { cLand.checked = true; S.pick.showLand = true; } sync();
            w.StationBriefingPicker.confirm(s, {
                onSave: function () { S.pick.showSea = cSea.checked; S.pick.showLand = cLand.checked && !cLand.disabled; finishSetup(false); },
                onCancel: function () { S.pick.station = before.station; cLand.checked = before.land; S.pick.showLand = before.showLand; sync(); }
            });
        };
        if (w.StationBriefingPicker) picker = w.StationBriefingPicker.mount(pickBox, { stations: stations, selected: function () { return S.pick && S.pick.station; }, onPick: choose, loadAreas: function () { return get('/api/station-briefing/areas'); } });
        else { var none = document.createElement('p'); none.className = 'sb-small'; none.textContent = '관할 고르기 화면을 불러오지 못했습니다.'; pickBox.appendChild(none); }
        sync();
    }
    /**
     * 설정을 끝낸다. 관할을 고르지 않았거나(건너뛰기) 해상·육상을 모두 껐으면 = 둘 다 건너뛴 것 → 「더 이상 표시하지 않을까요?」.
     * 예: 한림 + 해상만 → 저장 후 브리핑 / 건너뛰기 → 묻기 화면
     * @param {boolean} skipped - [건너뛰기]를 눌렀나 @returns {void} [연계] ← renderSetup / → save·loadBriefing·askHide(renderConfirm)
     */
    function finishSetup(skipped) {
        var pk = S.pick || {}, st = (S.stations || []).filter(function (s) { return s.key === pk.station; })[0] || null;
        var noSea = pk.showSea === false, noLand = pk.showLand === false || (st && st.seaOnly);
        if (skipped || !st || (noSea && noLand)) { S.mode = 'confirm'; renderBody(); return; }
        var p = prefs();
        if (p.station !== st.key) { S.resp = null; p.seen = {}; setTitle(); }
        p.station = st.key; p.name = st.name; p.office = st.office; p.seaOnly = !!st.seaOnly; p.showSea = !noSea; p.showLand = !noLand; p.hidden = false;
        save(p); S.mode = 'view'; S.pick = null;
        applyVisibility(); renderBody(); loadBriefing();
    }
    /**
     * 둘 다 건너뛰었을 때 묻는다(§11.2 사용자 원문 「모두 설정하지 않으면 … 더이상 표출하지 않겠냐고 물어보고」).
     * 예 → 아코디언을 숨기고 「오른쪽 위 설정 버튼에서 언제든 다시 표시할 수 있다」 안내 · 아니요 → 설정 전 안내로
     * @param {HTMLElement} box @returns {void} [연계] ← renderBody(mode confirm) / → hide·showSeagnalModal
     */
    function renderConfirm(box) {
        box.textContent = '';
        var c = document.createElement('div'); c.className = 'sb-confirm'; c.setAttribute('data-sb-confirm', '');
        var h = document.createElement('h4'); h.textContent = '해상·연안 모두 설정하지 않았습니다'; c.appendChild(h);
        var t = document.createElement('p'); t.textContent = '이 아코디언을 더 이상 표시하지 않을까요?'; c.appendChild(t);
        var acts = document.createElement('div'); acts.className = 'sb-actions';
        var yes = document.createElement('button'); yes.type = 'button'; yes.className = 'sb-btn sb-btn-primary'; yes.textContent = '예, 표시하지 않기'; yes.setAttribute('data-sb-hide-yes', '');
        var no = document.createElement('button'); no.type = 'button'; no.className = 'sb-btn'; no.textContent = '아니요'; no.setAttribute('data-sb-hide-no', '');
        yes.addEventListener('click', function (e) {
            e.stopPropagation(); var p = prefs(); p.hidden = true; save(p); S.mode = 'view'; S.pick = null; applyVisibility(); renderBody();
            var msg = '「연안 안전 브리핑」을 더 이상 표시하지 않습니다.\n오른쪽 위 설정(⚙) 버튼에서 언제든 다시 표시할 수 있습니다.';
            if (typeof w.showSeagnalModal === 'function') w.showSeagnalModal('연안 안전 브리핑', msg, 'info'); else console.info(msg);
        });
        no.addEventListener('click', function (e) { e.stopPropagation(); S.mode = 'view'; S.pick = null; renderBody(); });
        acts.appendChild(yes); acts.appendChild(no); c.appendChild(acts); box.appendChild(c);
    }

    /**
     * 아코디언을 펼친다(이미 펼쳐 있으면 그대로). 펼치면 N 뱃지를 지운다(본 것으로 기록).
     * 예: expand() → body .collapsed 제거·머리 .collapsed-state 제거·markSeen
     * @returns {void} [연계] ← openSetup·toggle
     */
    function expand() {
        var b = $('station-briefing-accordion-body'), h = $('station-briefing-accordion-header');
        if (b) b.classList.remove('collapsed'); if (h) h.classList.remove('collapsed-state');
        markSeen();
    }
    /**
     * 아코디언 머리를 눌렀을 때 — 바깥 아코디언 토글(해상 기상 전망과 같은 동작). 펼치면 N 뱃지를 지우고, 10분 넘게 지난 브리핑은 다시 받는다.
     * 예: toggle() → 펼침 + markSeen
     * @returns {void} [연계] ← index2.html #station-briefing-accordion-header onclick / → markSeen·loadBriefing
     */
    function toggle() {
        var b = $('station-briefing-accordion-body'), h = $('station-briefing-accordion-header'); if (!b) return;
        // 점검 차단 중 관리자 모드가 머리를 누른 경우(index2.html 차단 덮개가 원래 onclick 을 부른다) — 숨겨 둔 몸을 다시 보이게(A6).
        if (b.style.display === 'none' && S.display && !prefs().hidden) b.style.display = '';
        var willOpen = b.classList.contains('collapsed');
        b.classList.toggle('collapsed'); if (h) h.classList.toggle('collapsed-state');
        if (willOpen) { markSeen(); if (prefs().station && Date.now() - S.fetchedAt > REFRESH_MS) loadBriefing(); }
    }
    /**
     * 설정 화면을 연다(⚙ 버튼·[설정하기]·설정 팝업 [관할 설정]). 숨김이었으면 다시 보인다.
     * 예: openSetup() → 아코디언 펼침 + 관할 고르기 화면
     * @returns {void} [연계] ← #station-briefing-settings-btn onclick·renderBody·renderSettings / → expand·renderSetup
     */
    function openSetup() {
        if (!S.display) return;
        var p = prefs(); if (p.hidden) { p.hidden = false; save(p); applyVisibility(); }
        S.mode = 'setup'; S.pick = null; expand(); renderBody();
    }

    /**
     * N 뱃지(§11.3) — 특보 변경으로 다시 만든 판(trigger.kind 'warning')을 이 기기에서 아직 펼쳐 보지 않았으면 머리에 공지사항과 같은 .new-badge.
     * 이미 펼쳐 둔 채 새 판이 오면 곧바로 본 것으로 친다.
     * 예: generatedAt '…13:10' · seen[한림] '…08:00' · 접혀 있음 → N 보임
     * @returns {void} [연계] ← loadBriefing·applyVisibility·markSeen / 마크업 #station-briefing-badge-slot · style.css .new-badge
     */
    function updateBadge() {
        var slot = $('station-briefing-badge-slot'); if (!slot) return;
        var p = prefs(), b = S.resp && S.resp.briefing, body = $('station-briefing-accordion-body');
        var isNew = !!(S.display && !p.hidden && b && b.trigger && b.trigger.kind === 'warning' && b.generatedAt && p.seen[p.station] !== b.generatedAt);
        if (isNew && body && !body.classList.contains('collapsed')) { markSeen(); isNew = false; }
        var cur = slot.querySelector('.new-badge');
        if (isNew && !cur) { var nb = document.createElement('span'); nb.className = 'new-badge'; nb.textContent = 'N'; nb.setAttribute('aria-label', '특보 변경으로 새로 만든 브리핑'); slot.appendChild(nb); }
        if (!isNew && cur) cur.remove();
    }
    /** 지금 브리핑을 본 것으로 기록하고 뱃지를 지운다(기기 저장). 예: markSeen() → seen[관할]=generatedAt. @returns {void} [연계] ← expand·toggle·updateBadge */
    function markSeen() {
        var p = prefs(), b = S.resp && S.resp.briefing; if (!p.station || !b || !b.generatedAt) return;
        if (p.seen[p.station] !== b.generatedAt) { p.seen = {}; p.seen[p.station] = b.generatedAt; save(p); }
        var cur = $('station-briefing-badge-slot') && $('station-briefing-badge-slot').querySelector('.new-badge'); if (cur) cur.remove();
    }

    /**
     * 카드의 [위험예측에서 보기 ›](§11.4·U55) — 해양안전생활 탭 > 해양안전으로 옮겨 「위험예측」을 켜고 그 칸·관광지·시각으로 시트를 연다.
     * 탭 옮기기는 기존 switchMainTab·switchSubTab(life_safety.js 가 감싼 것 — 탭 상태 유지 규칙 그대로)을 쓰고,
     * 해양안전 화면이 지도를 준비하고 떠날 때 화면을 되살리는 200ms 뒤(life_safety.js _enterSafety)를 기다린 다음 RiskForecast.openAt 를 부른다.
     * 예: openInRisk({kind:'marine',id:'GR4_F4K23_P4',location:{lon:126.53,lat:33.56},t:'…15:00…'}) → 해양안전 · 위험예측 해상 ON · 15시 · 그 칸 시트
     * @param {Object} target - RiskForecast.openAt 대상 @param {HTMLElement} [btn] - 누른 버튼(기다리는 동안 잠금) @returns {Promise<boolean>}
     * [연계] ← station_briefing_render.js linkBtn / → switchMainTab·switchSubTab·RiskForecast.openAt(risk_forecast.js)
     */
    async function openInRisk(target, btn) {
        var what = target && target.kind === 'coast' ? '이 관광지' + (target.date ? '(' + (w.StationBriefingRender ? w.StationBriefingRender.dateText(target.date) : target.date) + ')' : '') : '이 해역';
        if (!w.RiskForecast || typeof w.RiskForecast.openAt !== 'function') { console.warn('[연안 안전 브리핑] 위험예측 모듈이 없어 바로가기를 열지 못함'); toast('위험예측을 열지 못했습니다 — 위험예측 화면을 불러오지 못했습니다.'); return false; }
        // 2026-10-18 위험예측 일반 공개 — 미리보기 잠금이 없어져 일반 기기도 관리자와 같이 바로 연다(종전 「아직 미리보기 기능이라…」 안내는 뺐다).
        if (btn) btn.disabled = true;
        try {
            if (typeof w.switchMainTab === 'function') w.switchMainTab('ocean-life-group');
            if (!document.body.classList.contains('ls-safety') && typeof w.switchSubTab === 'function') w.switchSubTab('ocean-safety-section');
            await new Promise(function (r) { setTimeout(r, 450); });
            var shown = document.body.getAttribute('data-active-tab') === 'ocean-life-group' && document.body.classList.contains('ls-safety');
            if (!shown) { console.warn('[연안 안전 브리핑] 해양안전 화면으로 옮기지 못함(점검 차단 등) — 바로가기 중단'); toast('해양안전 화면으로 옮기지 못해 ' + what + '를 열지 못했습니다.'); return false; }
            var ok = await w.RiskForecast.openAt(target);
            // 실패를 조용히 넘기지 않는다(2단계 검토 A7) — 위험예측 표에 그 날짜·장소가 없거나(내일 자료 전 등) 화면 준비 실패.
            if (ok !== true) { console.warn('[연안 안전 브리핑] 위험예측에서 대상을 열지 못함:', JSON.stringify(target)); toast('위험예측에서 ' + what + '를 열지 못했습니다 — 그 날짜·시각 자료가 아직 없거나 위험예측 표에 없는 곳입니다.'); }
            return ok === true;
        } catch (e) { console.warn('[연안 안전 브리핑] 바로가기 실패:', e && e.message); toast('위험예측에서 ' + what + '를 열지 못했습니다.'); return false; }
        finally { if (btn) btn.disabled = false; }
    }
    /** 짧은 안내(해양종합정보 토스트 index2_patch.js _showOceanToast — 없으면 콘솔). 예: toast('…열지 못했습니다'). @param {string} msg @returns {void} [연계] ← openInRisk */
    function toast(msg) { if (typeof w._showOceanToast === 'function') w._showOceanToast(msg, 'bottom', 3500, true); else console.info('[연안 안전 브리핑] ' + msg); }
    /** 관리자 모드인가(localStorage seagnal_admin_mode — admin.js _toggleAdminMode). @returns {boolean} [연계] ← applyVisibility */
    function adminMode() { try { return localStorage.getItem('seagnal_admin_mode') === 'true'; } catch (e) { return false; } }
    /** 점검 차단 목록에 이 아코디언이 있나(index2.html applyFeatureBlocks 가 window._blockedFeatures 에 둔다 — admin.js featureTree id 'station-briefing'). @returns {boolean} [연계] ← applyVisibility */
    function blocked() { return (w._blockedFeatures || []).indexOf('station-briefing') >= 0; }

    /**
     * 설정 팝업(오른쪽 위 ⚙ — settings.js) 관심해역 탭의 「연안 안전 브리핑」 칸(§11.2 「설정 팝업에 해당 부분이 반영」).
     * 노출 판정이 display:true 일 때만 보인다(일반 사용자 설정 팝업은 지금과 같다). 스위치·[관할 설정]은 누르는 즉시 적용된다(팝업 [저장]과 따로).
     * 예: 숨김 상태 → 스위치 꺼짐 · 켬 → 아코디언 다시 보임
     * @returns {void} [연계] ← settings.js openSettingsModal · applyVisibility / 마크업 #station-briefing-settings(index2.html #tab-zones)
     */
    function renderSettings() {
        var host = $('station-briefing-settings'); if (!host) return;
        if (!S.display) { host.hidden = true; host.textContent = ''; return; }
        var p = prefs(); host.hidden = false; host.textContent = '';
        var t = document.createElement('div'); t.className = 'sb-set-title'; var ic = document.createElement('i'); ic.className = 'fa-solid fa-compass'; ic.style.color = '#67e8f9'; t.appendChild(ic); t.appendChild(document.createTextNode('연안 안전 브리핑')); host.appendChild(t);
        var sub = document.createElement('div'); sub.className = 'sb-set-sub'; sub.textContent = '해양예보 탭에 파출소 관할 하나의 해상·연안 안전 브리핑을 보여 줍니다.' + (S.audience === 'admin' ? ' 지금은 관리자 기기에만 보이는 기능입니다.' : '') + ' 이 칸은 누르는 즉시 적용됩니다.'; host.appendChild(sub);
        var r1 = document.createElement('div'); r1.className = 'sb-set-row';
        var l1 = document.createElement('span'); l1.textContent = '해양예보 탭에 표시'; r1.appendChild(l1);
        var sw = document.createElement('label'); sw.className = 'switch'; var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'opt-station-briefing-show'; cb.checked = !p.hidden; var sl = document.createElement('span'); sl.className = 'slider'; sw.appendChild(cb); sw.appendChild(sl); r1.appendChild(sw);
        cb.addEventListener('change', function () { var q = prefs(); q.hidden = !cb.checked; save(q); S.mode = 'view'; applyVisibility(); if (cb.checked) { if (q.station) loadBriefing(); else renderBody(); } });
        host.appendChild(r1);
        var r2 = document.createElement('div'); r2.className = 'sb-set-row';
        var l2 = document.createElement('span'); l2.id = 'station-briefing-settings-current';
        l2.textContent = p.station ? '관할: ' + (p.name || '') + ' · ' + (p.office || '') + ' (' + [p.showSea !== false ? '해상' : null, p.showLand !== false && !p.seaOnly ? '연안' : null].filter(Boolean).join('·') + ')' : '관할: 설정되지 않음';
        r2.appendChild(l2);
        var go = document.createElement('button'); go.type = 'button'; go.className = 'sb-btn sb-btn-primary'; go.id = 'station-briefing-settings-edit'; go.textContent = '관할 설정';
        go.addEventListener('click', function () {
            // 설정 팝업에 저장하지 않은 다른 변경(관심해역·알림·글꼴)이 있으면 묻는다(2단계 검토 A4) — 닫기(closeSettingsModal)는 스냅샷으로 되돌리므로
            //   묻지 않고 닫으면 그 변경이 조용히 사라진다. [확인] 저장하고 이동(saveSettingsAndClose — 팝업 [저장]과 같음) · [취소] 팝업에 그대로 남기.
            if (typeof w.settingsModalHasUnsaved === 'function' && w.settingsModalHasUnsaved()) {
                if (!w.confirm('설정 창에 저장하지 않은 변경이 있습니다.\n[확인] 저장하고 관할 설정으로 이동\n[취소] 설정 창에 그대로 남기')) return;
                if (typeof w.saveSettingsAndClose === 'function') w.saveSettingsAndClose();
            } else if (typeof w.closeSettingsModal === 'function') w.closeSettingsModal();
            if (typeof w.switchMainTab === 'function' && document.body.getAttribute('data-active-tab') !== 'weather-group') w.switchMainTab('weather-group');
            var sec = $('weather-alert-section'); if (sec && !sec.classList.contains('active') && typeof w.switchSubTab === 'function') w.switchSubTab('weather-alert-section');
            openSetup();
            var h = $('station-briefing-accordion-header'); if (h && h.scrollIntoView) h.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        r2.appendChild(go); host.appendChild(r2);
    }

    /**
     * 처음 한 번 — 노출 판정을 받고, 화면이 다시 보일 때·10분마다(펼쳐 둔 관할이 있으면) 새 판을 받는다.
     * 예: DOMContentLoaded → init()
     * @returns {void} [연계] ← 이 파일 끝 / → refreshDisplay·loadBriefing
     */
    function init() {
        refreshDisplay();
        // 10분마다 노출 판정부터 다시(2단계 검토 A3) — 관리자가 「노출 안 함」으로 바꾸면 관할을 고르지 않은 기기도 이 간격 안에 사라진다. 판정이 보임이면 그 안에서 브리핑도 받는다.
        if (!S.timer) S.timer = setInterval(function () { if (document.visibilityState !== 'hidden') refreshDisplay(); }, REFRESH_MS);
        // 「지금 밀집」 실시간(§11.10.24) — 1분마다, 화면이 다시 보이면 곧바로. 보이지 않으면 묻지 않는다(nowShown).
        if (!S.nowTimer) S.nowTimer = setInterval(pollNow, NOW_MS);
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') pollNow(); });
        // 관리자 로그인·로그아웃·관리자 모드·관리자 기기 등록이 바뀌면 바로 다시 판정(2단계 검토 A8 — admin.js 가 'seagnal-admin-change' 를 보낸다).
        document.addEventListener('seagnal-admin-change', function () { refreshDisplay(); });
    }

    w.toggleStationBriefingAccordion = toggle;
    w.openStationBriefingSetup = openSetup;
    w.StationBriefing = { init: init, refresh: refreshDisplay, load: loadBriefing, pollNow: pollNow, toggle: toggle, openSetup: openSetup, renderSettings: renderSettings, openInRisk: openInRisk, applyVisibility: applyVisibility, prefs: prefs, _state: S };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
