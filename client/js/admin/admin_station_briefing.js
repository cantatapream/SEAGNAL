/**
 * ============================================================================
 * 파일명: client/js/admin/admin_station_briefing.js
 * 역할  : 통합관리자 → AI 탭 → 하위 탭 「AI 브리핑」(설계서 §11.6 결정 16·17 · 화면 정리 §11.10.50) — 연안 안전 브리핑(종전 「활동지점 안전 브리핑」 — §11.10.4) 관리 화면.
 *         위에서부터: 머리(제목 「연안 안전 브리핑」 한 줄 · 상태 알약 · [↻] · [지금 다시 만들기]) → 상태 카드(숫자 3칸 — 다음 판 / 마지막 실행 / 처리 안 된 오류 ·
 *         통계 칩 한 줄(AI·재사용·규칙 분석·오류 · 쓴 AI · 관광지 자료) · 실행 중 진행 게이지(§11.10.7) · 문제가 있을 때만 「관광지 자료 확인 불가」 펼침(§11.10.21)·공개 예정·특보 변경 대기·실행 실패·건너뛴 AI 줄)
 *         → 오류 카드(탭 2개 「처리 안 된 오류」(§11.10.48 누적 — 유형 목록·[md로 저장]·[복사]·내보내기의 [남은 N개 완료 처리]·알림 줄) / 「실행별」(최근 3일 실행 드롭다운·관할별 한글 풀이·[복사]·[md로 저장] §11.10.7·§11.10.31))
 *         → 정시 판 기록 표(판 · 소요 · AI·재사용·규칙 · 오류 — 마감에 걸린 판만 「마감 N곳」, 줄을 누르면 그 실행의 오류) → 설정(접힘 — AI 분석 스위치 · 노출 범위·묶음 단위 세그먼트 · 바뀐 곳만 스위치)
 *         → 관할 하나 미리보기(접힘 — 공개 예정 판은 「예정」). AI 모델·순서 고르기는 「AI 모델 설정」 탭 ③ 연안 안전 브리핑(admin_bulletin_ai.js)으로 옮겼다(§11.10.50).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js(window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부 · switchAiSubTab 이 나를 부름 · 설정 카드의 「AI 모델 설정 → ③」 링크가 switchAiSubTab('bulletinAi') 를 부름)
 *                    · forecast/station-briefing/station_briefing_render.js(StationBriefingRender.render — 미리보기는 사용자 화면과 같은 렌더러)
 *                    · @capacitor/browser(window.Capacitor.Plugins.Browser — 앱 안에서 md 를 시스템 브라우저로 내려받기, admin_collect.js CSV·PNG 저장과 같은 방식)
 *  - 서버 API      : GET·PUT /api/admin/station-briefing/config · GET /api/admin/station-briefing/status(?only=progress — 진행 게이지) · POST /api/admin/station-briefing/run(실행 중 409)
 *                    · GET /api/admin/station-briefing/stations · GET /api/admin/station-briefing/preview · POST /api/admin/station-briefing/download(글 그대로 text/markdown) → GET /api/station-briefing/download/:token
 *                    · POST /api/admin/station-briefing/error-log/export · POST /api/admin/station-briefing/error-log/exports/:id/resolve(§11.10.48)
 *                    (routes/station_briefing.js)
 *  - 마크업        : 관리자 센터 모달 #ai-subtab-body(admin.js renderUnifiedAiTab 이 만듦) — 이 파일이 안을 통째로 만든다(카드는 style.css .admin-card, 나머지 스타일은 <style id="sb-admin-style"> 를 한 번 심는다)
 *  - 나를 쓰는 곳  : admin.js switchAiSubTab('briefing') → window.renderStationBriefingAdmin
 * [로드 순서] admin/admin_data_status.js 다음 · admin/admin_collect.js 이전(호출은 사용자가 하위 탭을 누를 때)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var API = '/api/admin/station-briefing';
    // 선택지 이름표 — [큰 글, 작은 글]. 서버 choices 에 없는 값은 그리지 않는다.
    //   method 는 화면에서 「AI 분석」 스위치(켜짐 = 'ai', 끔 = 'template' — §11.10.50)로만 바꾼다. 옛 저장값 chatgpt·gemini 는 켜짐으로 보이고 마지막 실행 「쓴 AI」 이름표에만 쓴다.
    //   AI 모델·순서는 「AI 모델 설정」 탭 ③ 연안 안전 브리핑에서 고른다(admin_bulletin_ai.js — 이 탭에서 뺌).
    var LABELS = {
        method: { ai: ['AI 모델 설정 순서', '「AI 모델 설정」 ③ 목록 차례대로 → 규칙 분석'], chatgpt: ['ChatGPT'], gemini: ['Gemini'], template: ['규칙 분석만'] },
        exposure: { user: ['사용자에게'], admin: ['관리자에게만'], off: ['노출 안 함'] },
        batchUnit: { station: ['파출소', '97회'], office: ['해양경찰서', '21회'], region: ['지방청', '5회'] },
    };
    // 설정 칸 — kind 'switch'(켜기/끄기) · 'seg'(세그먼트). onlyChanged 단서(2단계 검토 B13): 재사용 해시에 기상청 해상 전망(kma)이 들어 있어(station_briefing_ai.generate), 전망이 바뀌면 모든 관할의 해시가 바뀐다.
    var SETTINGS = [
        { field: 'method', kind: 'switch', title: 'AI 분석', hint: '끄면 규칙 분석만(AI 안 씀)', on: 'ai', off: 'template', offText: '규칙 분석만' },
        { field: 'exposure', kind: 'seg', title: '노출 범위' },
        { field: 'batchUnit', kind: 'seg', title: '묶음 단위', hint: 'AI 한 번에 묶는 관할' },
        { field: 'onlyChanged', kind: 'switch', title: '바뀐 곳만 다시 만들기', hint: '입력이 같으면 지난 분석 재사용', on: true, off: false, onText: '기상청 해상 전망이 바뀌면 전 관할을 다시 씀', offText: '매번 새로' },
    ];
    var KIND = { morning: '07:30 판', evening: '17:30 판', night: '23:00 판', warning: '특보 변경 판', manual: '관리자 즉시 실행', failure: '실행 실패' };
    // AI 공급자 이름표 — 진행 게이지 call 사건·오류 풀이(attemptText·familyText)·「쓴 AI」(lastRun.results[].stats.byProvider)·「건너뜀」(lastRun.skipped) 이 같이 쓴다(§11.10.50).
    var PROVIDER = { vm: 'ChatGPT', chatgpt: 'ChatGPT', gemini: 'Gemini', claude1: '클로드 키1', claude2: '클로드 키2', upstage: '업스테이지' };
    var LEVEL = ['없음', '관심', '주의', '경계'];
    // 서버 station_briefing_ai 의 MIN_S·MAX_S·MAX_CHARS 와 같은 값(시험 test_station_briefing.js 가 같은지 본다) — 오류 풀이 글에만 쓴다.
    var SHAPE = { minS: 3, maxS: 5, maxChars: 460 };   // 460(2026-10-18 사용자 *"460자로 올리자."* — 설계서 §11.10.22 F, 종전 420)
    // 정시 판 일정(KST 분) — 서버 station_briefing_rules.EDITIONS 와 같은 표(2026-10-17 §11.10.4): 만들기 시작 start → 공개 pub
    //   2026-10-18 사용자 *"시각 앞당기자 40분전으로."*(설계서 §11.10.22 D): 06:50·16:50·22:20 시작(종전 07:10·17:10·22:40)
    var SLOTS = [{ start: 410, pub: 450 }, { start: 1010, pub: 1050 }, { start: 1340, pub: 1380 }];
    var POLL_MS = 2500;
    // 화면에 남겨 둘 고른 값 — 진행 게이지가 다시 그려도(2.5초마다) 사용자가 고른 묶음·실행을 잃지 않게
    // errTab = 오류 카드에서 고른 탭('open' 처리 안 된 오류 · 'run' 실행별 — 상태를 다시 그려도 유지)
    var ui = { batch: null, run: null, poll: null, errTab: 'open' };

    /** 요소 하나(글은 textContent). 예: el('div','', '저장됨'). @returns {HTMLElement} [연계] ← 이 파일 */
    function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
    /** 요소 하나 + class. 예: elc('span','sba-chip','AI 77'). @returns {HTMLElement} [연계] ← 이 파일 */
    function elc(tag, cls, text) { var e = el(tag, '', text); e.className = cls; return e; }
    /** KST 시각 글자. 예: '2026-10-17T08:00:12+09:00' → '10-17 08:00'. @param {string} iso @returns {string} */
    function at(iso) { var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? m[1] + '-' + m[2] + ' ' + m[3] + ':' + m[4] : '—'; }
    /** 이름표 [큰 글, 작은 글] 중 큰 글. 예: label('batchUnit','office') → '해양경찰서' · label('method','ai') → 'AI 순서'. @returns {string} [연계] ← drawConfig·drawStatus·drawProgress */
    function label(field, v) { var x = (LABELS[field] || {})[String(v)]; return x ? x[0] : String(v); }
    /**
     * 다음 정시 판 — 공개 시각과 만들기 시작 시각(KST — SLOTS, 서버 EDITIONS 와 같은 표). 이미 만들기 시작한 판(시작 ≤ 지금 < 공개)이면 그 판.
     * 예: 10-17 14:05 KST → {date:'10-17', pub:'17:30', start:'16:50', tomorrow:false} · 17:20 → 같은 판 · 23:10 → {date:'10-18', pub:'07:30', start:'06:50', tomorrow:true}
     * @param {number} nowMs @returns {{date:string, pub:string, start:string, tomorrow:boolean}} [연계] ← 상태 카드 숫자 칸 「다음 판」
     */
    function nextEdition(nowMs) {
        var k = new Date(nowMs + 9 * 3600000), mins = k.getUTCHours() * 60 + k.getUTCMinutes(), day = 0, pick = null;
        for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].pub > mins) { pick = SLOTS[i]; break; }
        if (pick === null) { pick = SLOTS[0]; day = 1; }
        var d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + day)), hm = function (x) { return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
        return { date: String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'), pub: hm(pick.pub), start: hm(pick.start), tomorrow: day === 1 };
    }
    /** JSON 요청(관리자 토큰은 admin.js 래퍼가 붙인다). 실패면 {status, error}. @returns {Promise<{status:number, body:Object}>} */
    async function call(path, init) {
        var r = await fetch(API + path, Object.assign({ cache: 'no-store' }, init || {}));
        var body = null; try { body = await r.json(); } catch (e) { body = null; console.warn('[AI 브리핑 관리] 응답이 JSON 이 아님 — ' + path + ' HTTP ' + r.status + ':', e && e.message); }
        return { status: r.status, body: body || {} };
    }
    /**
     * 이 탭의 스타일을 한 번 심는다(관리자 화면은 어두운 바탕만 있다 — style.css 에 밝은 테마 규칙이 없음을 확인함, 2026-10-17).
     * 카드는 style.css .admin-card(다른 관리자 탭과 같은 rgba(30,41,59,.5)·둥근 16px)에 .sba-card 로 안쪽 여백만 맞춘다. 세그먼트는 특보 관리 탭 .admin-sub-tabs 꼴(어두운 바탕·고른 칸만 밝게)을
     * 이 탭 안에서 같은 값으로 쓴다(.admin-sub-tabs 를 그대로 붙이면 600px 이하에서 칸이 2×2 로 접혀 세 칸짜리가 어긋난다). 칸 이름은 흰색·굵게(2026-10-17 사용자 — 어두운 바탕에서 잘 보이게).
     * 예: ensureStyle() → <style id="sb-admin-style"> 가 없으면 head 에 붙인다. @returns {void} [연계] ← renderStationBriefingAdmin
     */
    function ensureStyle() {
        if (document.getElementById('sb-admin-style')) return;
        var s = document.createElement('style'); s.id = 'sb-admin-style';
        s.textContent = [
            // 머리 — 제목 한 줄 + 오른쪽 상태 알약·[↻]·[지금 다시 만들기]
            '[data-sb-admin] .sba-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;}',
            '[data-sb-admin] .sba-title{margin:0;font-size:1rem;font-weight:800;color:#f8fafc;}',
            '[data-sb-admin] .sba-title-sub{font-size:.74rem;color:#94a3b8;margin-top:3px;line-height:1.4;}',
            '[data-sb-admin] .sba-head-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
            '[data-sb-admin] .sba-card{padding:16px 18px;margin-bottom:14px;}',
            '[data-sb-admin] .sba-ct{display:flex;align-items:center;justify-content:space-between;gap:8px 10px;flex-wrap:wrap;font-size:.88rem;font-weight:800;color:#f8fafc;margin-bottom:12px;}',
            '[data-sb-admin] .sba-ct small{font-weight:600;color:#94a3b8;font-size:.72rem;}',
            '[data-sb-admin] .sba-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;}',
            '[data-sb-admin] .sba-state{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;font-size:.76rem;font-weight:700;white-space:nowrap;}',
            '[data-sb-admin] .sba-state.on{background:rgba(59,130,246,.2);color:#bfdbfe;border:1px solid rgba(96,165,250,.6);}',
            '[data-sb-admin] .sba-state.idle{background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(255,255,255,.1);}',
            '[data-sb-admin] .sba-dot{width:7px;height:7px;border-radius:50%;background:currentColor;}',
            '[data-sb-admin] .sba-state.on .sba-dot,[data-sb-admin] .sba-st-running .sba-dot{animation:sbaPulse 1.2s ease-in-out infinite;}',
            '@keyframes sbaPulse{0%,100%{opacity:1}50%{opacity:.25}}',
            '@media (prefers-reduced-motion: reduce){[data-sb-admin] .sba-dot{animation:none !important;}}',
            // 상태 카드 — 숫자 3칸(좁으면 한 줄에 하나 — 이름·값·설명) · 칩 한 줄 · 있을 때만 보이는 줄
            '[data-sb-admin] .sba-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}',
            '[data-sb-admin] .sba-kpi{background:rgba(0,0,0,.22);border-radius:12px;padding:11px 12px;min-width:0;}',
            '[data-sb-admin] .sba-kpi .k{font-size:.7rem;color:#94a3b8;font-weight:700;}',
            '[data-sb-admin] .sba-kpi .v{font-size:1.25rem;font-weight:800;color:#f8fafc;margin-top:3px;line-height:1.25;}',
            '[data-sb-admin] .sba-kpi .d{font-size:.7rem;color:#94a3b8;margin-top:2px;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-kpi.bad .v{color:#f87171;}',
            '@media (max-width:520px){[data-sb-admin] .sba-kpis{grid-template-columns:1fr;gap:6px;}[data-sb-admin] .sba-kpi{display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:8px;align-items:baseline;padding:8px 12px;}[data-sb-admin] .sba-kpi .v{font-size:1.05rem;margin:0;}[data-sb-admin] .sba-kpi .d{grid-column:2;}[data-sb-admin] .sba-card{padding:14px 14px;}}',
            '[data-sb-admin] .sba-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;align-items:center;}',
            '[data-sb-admin] .sba-chip{display:inline-block;padding:3px 9px;border-radius:7px;font-size:.72rem;font-weight:700;background:rgba(255,255,255,.06);color:#cbd5e1;white-space:nowrap;}',
            '[data-sb-admin] .sba-chip.ok{background:rgba(16,185,129,.15);color:#6ee7b7;}',
            '[data-sb-admin] .sba-chip.warn{background:rgba(245,158,11,.16);color:#fcd34d;}',
            '[data-sb-admin] .sba-chip.bad{background:rgba(239,68,68,.15);color:#fca5a5;}',
            '[data-sb-admin] .sba-muted{color:#94a3b8;font-size:.72rem;line-height:1.5;}',
            '[data-sb-admin] .sba-line{font-size:.76rem;line-height:1.5;margin-top:8px;color:#cbd5e1;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-line.warn{color:#fcd34d;}',
            '[data-sb-admin] .sba-line.bad{color:#fca5a5;}',
            '[data-sb-admin] .sba-sub{color:#94a3b8;font-size:.75rem;line-height:1.5;}',
            '[data-sb-admin] .sba-main{color:#f1f5f9;font-size:.86rem;font-weight:600;}',
            '[data-sb-admin] .sba-k{color:#94a3b8;font-size:.74rem;margin-top:10px;margin-bottom:3px;}',
            // 버튼 — 다른 관리자 탭(.admin-action-btn·.admin-btn-primary)과 같은 색, 작은 크기
            '[data-sb-admin] .sba-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:10px;font-size:.78rem;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#fff;white-space:nowrap;}',
            '[data-sb-admin] .sba-btn:hover{background:rgba(255,255,255,.1);}',
            '[data-sb-admin] .sba-btn.primary{background:linear-gradient(135deg,#3b82f6,#2563eb);border-color:transparent;}',
            '[data-sb-admin] .sba-btn.icon{padding:4px 11px;font-size:1.05rem;line-height:1.2;}',
            '[data-sb-admin] .sba-btn:disabled{opacity:.45;cursor:default;}',
            '[data-sb-admin] .sba-btn:focus-visible,[data-sb-admin] .sba-seg>button:focus-visible,[data-sb-admin] .sba-sw:focus-visible,[data-sb-admin] .sba-acc:focus-visible,[data-sb-admin] .sba-link:focus-visible{outline:2px solid #fbbf24;outline-offset:2px;}',
            // 세그먼트(특보 관리 탭 .admin-sub-tabs 꼴) — 설정의 노출 범위·묶음 단위, 오류 카드의 탭 2개
            '[data-sb-admin] .sba-seg{display:flex;background:rgba(0,0,0,.3);padding:4px;border-radius:12px;gap:4px;min-width:0;}',
            '[data-sb-admin] .sba-seg>button{flex:1 1 0;min-width:0;padding:7px 8px;border:none;background:transparent;color:#94a3b8;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;line-height:1.3;word-break:keep-all;transition:background .2s,color .2s;}',
            '[data-sb-admin] .sba-seg>button[aria-pressed="true"],[data-sb-admin] .sba-seg>button[aria-selected="true"]{background:rgba(255,255,255,.1);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.2);}',
            '[data-sb-admin] .sba-seg>button small{font-size:.66rem;opacity:.65;margin-left:3px;white-space:nowrap;}',
            '[data-sb-admin] .sba-seg .n{display:inline-block;min-width:16px;padding:0 5px;border-radius:8px;background:rgba(239,68,68,.85);color:#fff;font-size:.64rem;font-weight:700;margin-left:5px;line-height:16px;}',
            '[data-sb-admin] .sba-tabs{flex:0 1 300px;}',
            '@media (max-width:520px){[data-sb-admin] .sba-seg>button{padding:6px 3px;font-size:.74rem;}[data-sb-admin] .sba-seg>button small{display:block;margin:1px 0 0;}[data-sb-admin] .sba-tabs{flex:1 1 100%;}}',
            // 스위치(켜기/끄기) · 다른 탭으로 가는 글 링크
            '[data-sb-admin] .sba-sw{position:relative;flex:0 0 auto;width:42px;height:24px;padding:0;border:none;border-radius:999px;background:rgba(148,163,184,.35);cursor:pointer;transition:background .2s;}',
            '[data-sb-admin] .sba-sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;}',
            '[data-sb-admin] .sba-sw[aria-checked="true"]{background:#2563eb;}',
            '[data-sb-admin] .sba-sw[aria-checked="true"]::after{left:21px;}',
            '[data-sb-admin] .sba-sw:disabled{opacity:.5;cursor:default;}',
            '[data-sb-admin] .sba-link{background:none;border:none;padding:0;color:#67e8f9;font-weight:700;font-size:inherit;cursor:pointer;text-align:left;}',
            // 설정 줄(이름 | 고르기) — 좁으면 위아래
            '[data-sb-admin] .sba-set{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06);}',
            '[data-sb-admin] .sba-set .l{font-size:.82rem;font-weight:700;color:#f8fafc;line-height:1.35;}',
            '[data-sb-admin] .sba-set .l small{display:block;color:#94a3b8;font-weight:500;font-size:.68rem;margin-top:2px;}',
            '[data-sb-admin] .sba-swrow{display:flex;align-items:center;gap:10px;min-width:0;}',
            '@media (max-width:520px){[data-sb-admin] .sba-set{grid-template-columns:1fr;gap:6px;}}',
            // 접고 펴는 카드 머리
            '[data-sb-admin] .sba-acc{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:0;border:none;background:none;color:inherit;cursor:pointer;text-align:left;font:inherit;}',
            '[data-sb-admin] .sba-acc-t{font-size:.88rem;font-weight:800;color:#f8fafc;}',
            '[data-sb-admin] .sba-acc-t small{font-size:.7rem;font-weight:600;color:#94a3b8;margin-left:4px;}',
            '[data-sb-admin] .sba-acc-sum{font-size:.74rem;color:#94a3b8;margin-top:3px;line-height:1.45;}',
            '[data-sb-admin] .sba-acc[aria-expanded="true"] .sba-acc-sum{display:none;}',
            '[data-sb-admin] .sba-caret{display:inline-block;color:#94a3b8;font-size:.8rem;transition:transform .2s;}',
            '[data-sb-admin] .sba-acc[aria-expanded="true"] .sba-caret{transform:rotate(180deg);}',
            // 진행 게이지 — 막대 가운데 글(지금 하는 곳)
            '[data-sb-admin] .sba-gauge{position:relative;min-height:34px;border-radius:9px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.14);}',
            '[data-sb-admin] .sba-fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#0e7490,#2563eb);transition:width .4s ease;}',
            '[data-sb-admin] .sba-glabel{position:relative;display:flex;align-items:center;justify-content:center;min-height:34px;padding:4px 10px;text-align:center;font-size:.76rem;font-weight:700;color:#fff;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.7);word-break:keep-all;}',
            '[data-sb-admin] .sba-phases{display:flex;gap:4px;margin-top:8px;}',
            '[data-sb-admin] .sba-phase{flex:1;text-align:center;font-size:.68rem;padding:3px 2px;border-radius:6px;background:rgba(255,255,255,.05);color:#94a3b8;}',
            '[data-sb-admin] .sba-phase.now{background:rgba(59,130,246,.25);color:#fff;font-weight:700;}',
            '[data-sb-admin] .sba-phase.past{background:rgba(16,185,129,.16);color:#6ee7b7;}',
            '[data-sb-admin] .sba-batches{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;}',
            '[data-sb-admin] .sba-batch{position:relative;overflow:hidden;padding:4px 8px;border-radius:7px;font-size:.72rem;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#cbd5e1;}',
            '[data-sb-admin] .sba-batch .bar{position:absolute;left:0;bottom:0;height:3px;background:#34d399;}',
            '[data-sb-admin] .sba-batch.done{background:rgba(16,185,129,.16);border-color:rgba(16,185,129,.45);color:#a7f3d0;}',
            '[data-sb-admin] .sba-batch.running{background:rgba(59,130,246,.22);border-color:#60a5fa;color:#fff;}',
            '[data-sb-admin] .sba-batch[aria-pressed="true"]{outline:2px solid #fbbf24;outline-offset:1px;}',
            '[data-sb-admin] .sba-sts{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}',
            '[data-sb-admin] .sba-st{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:6px;font-size:.72rem;background:rgba(255,255,255,.05);color:#94a3b8;border:1px solid rgba(255,255,255,.1);}',
            '[data-sb-admin] .sba-st-done{background:rgba(16,185,129,.16);color:#6ee7b7;border-color:rgba(16,185,129,.35);}',
            '[data-sb-admin] .sba-st-running{background:rgba(59,130,246,.22);color:#fff;border-color:#60a5fa;}',
            '[data-sb-admin] .sba-st-retry{background:rgba(245,158,11,.14);color:#fcd34d;border-color:rgba(245,158,11,.4);}',
            '[data-sb-admin] .sba-st-rule{background:rgba(239,68,68,.14);color:#fca5a5;border-color:rgba(239,68,68,.4);}',
            // 오류 카드 — 유형 목록(처리 안 된 오류) · 실행 고르기·관할별 묶음(실행별)
            '[data-sb-admin] .sba-eitem{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06);}',
            '[data-sb-admin] .sba-ename{color:#f8fafc;font-weight:700;font-size:.84rem;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-emeta{color:#94a3b8;font-size:.72rem;margin-top:2px;line-height:1.45;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-cnt{flex:0 0 auto;font-size:.72rem;font-weight:800;padding:2px 9px;border-radius:7px;background:rgba(239,68,68,.15);color:#fca5a5;white-space:nowrap;}',
            '[data-sb-admin] .sba-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;}',
            '[data-sb-admin] .sba-expbox{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:9px 11px;border-radius:10px;background:rgba(0,0,0,.2);margin-top:10px;}',
            '[data-sb-admin] .sba-exp{flex:1 1 220px;min-width:0;}',
            '[data-sb-admin] .sba-exp summary{cursor:pointer;color:#e2e8f0;font-size:.76rem;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-exp li{color:#cbd5e1;font-size:.74rem;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-select{width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:#0f1b33;color:#fff;font-size:.8rem;}',
            '[data-sb-admin] .sba-errst{border-top:1px solid rgba(255,255,255,.06);padding:8px 0 6px;}',
            '[data-sb-admin] .sba-errst-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;}',
            '[data-sb-admin] .sba-errst-name{color:#f8fafc;font-weight:700;font-size:.84rem;}',
            '[data-sb-admin] .sba-errst ol{margin:4px 0 0;padding-left:0;list-style:none;}',
            '[data-sb-admin] .sba-errst li{color:#e2e8f0;font-size:.78rem;line-height:1.5;padding:3px 0 3px 10px;border-left:2px solid rgba(248,113,113,.5);margin-top:3px;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-errst li b{color:#fda4af;font-weight:700;}',
            // §11.10.48 처리 완료된 오류(실행별 — 흐리게 남김) · 알림
            '[data-sb-admin] .sba-errst li.done{opacity:.55;border-left-color:rgba(16,185,129,.55);}',
            '[data-sb-admin] .sba-errst li .sba-done{display:inline-block;margin-left:6px;padding:0 6px;border-radius:5px;font-size:.66rem;background:rgba(16,185,129,.18);color:#6ee7b7;}',
            '[data-sb-admin] .sba-warn{color:#fbbf24;font-size:.76rem;line-height:1.5;margin:4px 0;}',
            // §11.10.21 관광지 자료 확인 불가(문제가 있을 때만 펼침) · 정시 판 기록 표(360px 에서 넘치지 않게 고정 칸·줄바꿈)
            '[data-sb-admin] .sba-sf{margin-top:8px;}',
            '[data-sb-admin] .sba-sf summary{cursor:pointer;color:#fcd34d;font-size:.8rem;font-weight:600;line-height:1.45;}',
            '[data-sb-admin] .sba-sf ul{margin:4px 0 0;padding-left:16px;}',
            '[data-sb-admin] .sba-sf li{color:#e2e8f0;font-size:.76rem;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-tt{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.76rem;}',
            '[data-sb-admin] .sba-tt th{color:#94a3b8;font-weight:700;text-align:left;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.1);}',
            '[data-sb-admin] .sba-tt td{color:#e2e8f0;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-tt td small{color:#94a3b8;font-size:.68rem;margin-left:4px;}',
            '[data-sb-admin] .sba-tt .r{text-align:right;}',
            '[data-sb-admin] .sba-tt td.bad{color:#fca5a5;font-weight:700;}',
            '[data-sb-admin] .sba-tt tbody tr{cursor:pointer;}',
            '[data-sb-admin] .sba-tt tbody tr:hover td{background:rgba(255,255,255,.03);}',
            '[data-sb-admin] .sba-tt .sba-dl{display:inline-block;margin-left:4px;padding:0 6px;border-radius:5px;font-size:.66rem;font-weight:700;background:rgba(239,68,68,.15);color:#fca5a5;white-space:nowrap;}',
            '[data-sb-admin] .sba-tt .late{display:block;color:#fca5a5;font-size:.66rem;margin:1px 0 0;}',
            '@media (max-width:520px){[data-sb-admin] .sba-tt td small{display:block;margin:1px 0 0;}}',
            '[data-sb-admin] .sba-note{font-size:.7rem;color:#94a3b8;margin-top:8px;line-height:1.5;}',
            '[data-sb-admin] .sba-mdview{width:100%;min-height:180px;margin-top:6px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0b1426;color:#e2e8f0;font-size:.72rem;font-family:monospace;}',
        ].join('\n');
        document.head.appendChild(s);
    }
    /**
     * 카드 하나(style.css .admin-card — 다른 관리자 탭과 같은 꼴). 예: card(host, 'data-sb-status'). @param {HTMLElement} parent @param {string} mark - data-* 표시 @returns {HTMLElement} [연계] ← renderStationBriefingAdmin
     */
    function card(parent, mark) { var c = elc('div', 'admin-card sba-card'); c.setAttribute(mark, ''); parent.appendChild(c); return c; }
    /**
     * 접고 펴는 카드 머리 — 기본 접힘, 접힌 동안 요약 한 줄(sum)을 보인다. 예: collapsible(box, '설정', '바꾸면 바로 저장', 'data-sb-config-toggle').
     * @param {HTMLElement} box @param {string} title @param {string} note - 제목 옆 작은 글 @param {string} mark - 머리 단추의 data-* 표시 @returns {{body:HTMLElement, sum:HTMLElement, btn:HTMLElement}} [연계] ← drawConfig·drawPreview
     */
    function collapsible(box, title, note, mark) {
        var btn = elc('button', 'sba-acc'); btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute(mark, '');
        var left = el('div', 'min-width:0;'), t = elc('div', 'sba-acc-t', title); if (note) t.appendChild(el('small', '', note)); left.appendChild(t);
        var sum = elc('div', 'sba-acc-sum'); left.appendChild(sum);
        btn.appendChild(left); btn.appendChild(elc('span', 'sba-caret', '▾'));
        var body = el('div', 'margin-top:6px;'); body.hidden = true;
        btn.addEventListener('click', function () { var open = body.hidden; body.hidden = !open; btn.setAttribute('aria-expanded', String(open)); });
        box.appendChild(btn); box.appendChild(body);
        return { body: body, sum: sum, btn: btn };
    }

    /**
     * AI 브리핑 하위 탭을 그린다 — 머리(제목·상태 알약·[↻]·[지금 다시 만들기]) → 상태 카드 → 오류 카드 → 정시 판 기록 → 설정(접힘) → 관할 하나 미리보기(접힘)(§11.10.50).
     * 2026-11-16 사용자 *"이 화면 자체가 너무 지저분하고 보기 좋지 않은데 … 불필요한 내용은 빼고 … 선택 버튼이나 그런게 다른 탭에서 구성하고 있는 부분과 디자인도 다르고"* — 시안 A2 그대로.
     * 예: renderStationBriefingAdmin(document.getElementById('ai-subtab-body'))
     * @param {HTMLElement} container @returns {Promise<void>}
     * [연계] ← admin.js switchAiSubTab('briefing') / → drawConfig·drawStatus·drawPreview · POST /run
     */
    async function renderStationBriefingAdmin(container) {
        ensureStyle();
        container.textContent = '';
        var host = el('div'); host.setAttribute('data-sb-admin', ''); container.appendChild(host);
        var head = elc('div', 'sba-head'); host.appendChild(head);
        var tw = el('div', 'min-width:0;'); tw.appendChild(elc('h2', 'sba-title', '연안 안전 브리핑')); tw.appendChild(elc('div', 'sba-title-sub', '07:30 · 17:30 · 23:00 공개 · 각 40분 전부터 만들기')); head.appendChild(tw);
        var acts = elc('div', 'sba-head-acts'); head.appendChild(acts);
        var pill = elc('span', 'sba-state idle'); pill.setAttribute('data-sb-running', ''); pill.appendChild(elc('span', 'sba-dot')); pill.appendChild(document.createTextNode('불러오는 중')); acts.appendChild(pill);
        var re = elc('button', 'sba-btn icon', '↻'); re.type = 'button'; re.title = '새로고침'; re.setAttribute('aria-label', '새로고침'); re.setAttribute('data-sb-refresh', ''); acts.appendChild(re);
        var run = elc('button', 'sba-btn primary', '지금 다시 만들기'); run.type = 'button'; run.setAttribute('data-sb-run', ''); acts.appendChild(run);
        var msg = el('div', 'font-size:0.78rem;line-height:1.5;margin:-6px 0 12px;'); msg.setAttribute('data-sb-run-msg', ''); msg.setAttribute('aria-live', 'polite'); msg.hidden = true; host.appendChild(msg);
        // v = 상태가 그리는 칸들(새로고침·진행 끝 때 한꺼번에 다시 그림)
        var v = { pill: pill, status: card(host, 'data-sb-status'), errors: card(host, 'data-sb-errcard'), times: card(host, 'data-sb-edition-times'), prog: null };
        var cfgBox = card(host, 'data-sb-config'), pvBox = card(host, 'data-sb-preview');
        re.addEventListener('click', function () { drawStatus(v); });
        var say = function (color, t) { msg.hidden = false; msg.style.color = color; msg.textContent = t; };
        run.addEventListener('click', async function () {
            run.disabled = true; say('#94a3b8', '요청 중…');
            try {
                var r = await call('/run', { method: 'POST' });
                if (r.status === 202) { say('#34d399', '시작했습니다 — 21시 전이면 오늘 판, 이후면 내일 판을 다시 만들어 끝나는 대로 곧바로 보입니다(공개 시각을 기다리지 않음). 상태 카드의 게이지가 진행을 보여 주고, 끝나면 결과가 저절로 바뀝니다.'); setPill(pill, true); drawStatus(v); }
                else if (r.status === 409) { say('#fbbf24', '이미 실행 중입니다 — 끝난 뒤 다시 눌러 주세요.'); drawStatus(v); }
                else say('#fca5a5', '시작하지 못했습니다: ' + (r.body.error || ('HTTP ' + r.status)));
            } catch (e) { console.warn('[AI 브리핑 관리] 지금 다시 만들기 요청 실패:', e && e.message); say('#fca5a5', '요청 실패: ' + (e && e.message)); }
            finally { run.disabled = false; }
        });
        var cfg = await call('/config');
        if (cfg.status !== 200 || !cfg.body.config) { cfgBox.appendChild(el('div', 'color:#fca5a5;font-size:0.82rem;', '설정을 불러오지 못했습니다(' + cfg.status + '). 관리자 로그인이 필요할 수 있습니다.')); return; }
        drawConfig(cfgBox, cfg.body.config, cfg.body.choices || {});
        drawStatus(v);
        drawPreview(pvBox);
    }
    /**
     * 설정 카드(접힘 — 접힌 동안 요약 한 줄) — AI 분석 스위치(켜짐 = method 'ai' · 끔 = 'template', 옛 저장값 chatgpt·gemini 는 켜짐으로 보임 — §11.10.50)와 「AI 모델 설정 → ③」 링크,
     * 노출 범위·묶음 단위 세그먼트, 바뀐 곳만 다시 만들기 스위치. 바꾸면 그 칸만 곧바로 PUT 하고, 성공하면 모양을 바꾼다(실패면 이유 — 모양은 그대로).
     * 2026-11-16 사용자 *"ai 모델 선택 및 설정 부분은 ai 탭의 ai 모델 설정이라는 하위 탭 … 그 탭으로 넣어줘"* — 생성 방식·ChatGPT 모델·Gemini 모델 칸은 이 탭에서 뺐다.
     * 예: [관리자에게만] → PUT {exposure:'admin'} → 「저장됨 — 노출 범위: 관리자에게만」 · AI 분석 끔 → PUT {method:'template'} → 「저장됨 — AI 분석: 꺼짐(규칙 분석만)」
     * @param {HTMLElement} box @param {Object} config @param {Object} choices - 서버 선택지(없는 칸은 그리지 않음) @returns {void} [연계] ← renderStationBriefingAdmin / → window.switchAiSubTab('bulletinAi')
     */
    function drawConfig(box, config, choices) {
        box.textContent = '';
        var acc = collapsible(box, '설정', '바꾸면 바로 저장', 'data-sb-config-toggle'); acc.sum.setAttribute('data-sb-config-sum', '');
        var msg = el('div', 'font-size:0.78rem;min-height:1.2em;margin-top:6px;color:#94a3b8;'); msg.setAttribute('data-sb-msg', ''); msg.setAttribute('aria-live', 'polite');
        var rows = {}, paints = [];
        var isOn = function (d) { return d.field === 'method' ? config.method !== 'template' : config[d.field] === d.on; };
        var save = async function (d, val, okText) {
            var patch = {}; patch[d.field] = val; msg.style.color = '#94a3b8'; msg.textContent = '저장 중…';
            try {
                var res = await call('/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
                if (res.status !== 200 || !res.body.config) throw new Error(res.body.error || ('HTTP ' + res.status));
                config = res.body.config; paint(); msg.style.color = '#34d399'; msg.textContent = '저장됨 — ' + d.title + ': ' + okText;
            } catch (e) { console.warn('[AI 브리핑 관리] 설정 저장 실패:', d.field, e && e.message); msg.style.color = '#fca5a5'; msg.textContent = '저장 실패: ' + (e && e.message); }
        };
        SETTINGS.forEach(function (d) {
            var opts = choices[d.field]; if (!Array.isArray(opts) || !opts.length) return;
            var r = elc('div', 'sba-set'); r.setAttribute('data-field', d.field); rows[d.field] = r;
            var lb = elc('div', 'l', d.title); if (d.hint) lb.appendChild(el('small', '', d.hint)); r.appendChild(lb);
            if (d.kind === 'switch') {
                var wrap = elc('div', 'sba-swrow'), sw = elc('button', 'sba-sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', d.title); sw.setAttribute('data-sb-switch', d.field);
                var side = elc('span', 'sba-muted'); side.setAttribute('data-sb-switch-text', d.field);
                wrap.appendChild(sw); wrap.appendChild(side); r.appendChild(wrap);
                sw.addEventListener('click', async function () {
                    if (sw.disabled) return;
                    var next = !isOn(d); sw.disabled = true;
                    try { await save(d, next ? d.on : d.off, next ? '켜짐' : '꺼짐(' + d.offText + ')'); } finally { sw.disabled = false; }
                });
                paints.push(function () {
                    var on = isOn(d); sw.setAttribute('aria-checked', String(on)); side.textContent = '';
                    side.appendChild(document.createTextNode(on ? '켜짐' + (d.onText ? ' · ' + d.onText : '') : '꺼짐 — ' + d.offText));
                    if (d.field === 'method') {   // AI 순서는 다른 탭 — 누르면 그 하위 탭으로
                        side.appendChild(document.createTextNode(' · AI 순서는 '));
                        var a = elc('button', 'sba-link', 'AI 모델 설정 → ③ 연안 안전 브리핑'); a.type = 'button'; a.setAttribute('data-sb-ai-order', '');
                        a.addEventListener('click', function () { if (typeof w.switchAiSubTab === 'function') w.switchAiSubTab('bulletinAi'); });
                        side.appendChild(a);
                    }
                });
            } else {
                var seg = elc('div', 'sba-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', d.title);
                opts.forEach(function (val) {
                    var x = (LABELS[d.field] || {})[String(val)] || [String(val)];
                    var b = el('button', '', x[0]); b.type = 'button'; b.setAttribute('data-value', String(val));
                    if (x[1]) b.appendChild(el('small', '', x[1]));
                    b.addEventListener('click', async function () { if (b.disabled || b.getAttribute('aria-pressed') === 'true') return; b.disabled = true; try { await save(d, val, label(d.field, val)); } finally { b.disabled = false; } });
                    seg.appendChild(b);
                });
                r.appendChild(seg);
                paints.push(function () { seg.querySelectorAll('button[data-value]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === String(config[d.field]))); }); });
            }
            acc.body.appendChild(r);
        });
        acc.body.appendChild(msg);
        /** 지금 설정값으로 스위치·세그먼트·접힌 요약을 칠한다. */
        function paint() {
            paints.forEach(function (f) { f(); });
            acc.sum.textContent = SETTINGS.filter(function (d) { return rows[d.field]; }).map(function (d) {
                if (d.field === 'method') return 'AI 분석 ' + (isOn(d) ? '켜짐' : '꺼짐');
                if (d.field === 'onlyChanged') return '바뀐 곳만 ' + (isOn(d) ? '켜짐' : '꺼짐');
                return label(d.field, config[d.field]) + (d.field === 'batchUnit' ? ' 묶음' : '');
            }).join(' · ');
        }
        paint();
    }
    /** 통계 칩 하나. 예: chip(box, 'AI 90', 'ok'). @returns {HTMLElement} [연계] ← drawStatus·drawOpenErrors */
    function chip(parent, text, tone) { var c = elc('span', 'sba-chip' + (tone ? ' ' + tone : ''), text); parent.appendChild(c); return c; }
    /**
     * 「쓴 AI」 글 — 마지막 실행의 판마다 AI 분석이 통과한 공급자 수(results[].stats.byProvider — §11.10.50)를 모아 많은 순으로. 그 기록이 없는 옛 실행은 방식 이름표(lastRun.method).
     * 예: {results:[{stats:{byProvider:{claude2:90,gemini:7}}}]} → '클로드 키2 90 · Gemini 7' · {method:'chatgpt',results:[{stats:{}}]} → 'ChatGPT' · byProvider 가 있는데 모두 0(전부 재사용·규칙) → '없음'
     * @param {Object} lr - status.lastRun @returns {string|null} [연계] ← drawStatus 칩 줄
     */
    function providersText(lr) {
        var sum = {}, seen = false;
        (lr.results || []).forEach(function (x) {
            var bp = x && x.stats && x.stats.byProvider; if (!bp || typeof bp !== 'object') return; seen = true;
            Object.keys(bp).forEach(function (k) { var n = Number(bp[k]) || 0; if (n > 0) sum[k] = (sum[k] || 0) + n; });
        });
        var ks = Object.keys(sum);
        if (ks.length) return ks.sort(function (a, b) { return sum[b] - sum[a]; }).map(function (k) { return (PROVIDER[k] || k) + ' ' + sum[k]; }).join(' · ');
        if (seen) return '없음';
        return lr.method ? label('method', lr.method) : null;
    }
    /** KST 오늘 'MM-DD'. 예: 2026-10-17 10:05 KST → '10-17'. @returns {string} [연계] ← drawStatus(마지막 실행이 오늘이 아니면 날짜를 붙임) */
    function todayMD() { return kstStamp(Date.now(), true).slice(5, 10); }
    /**
     * 상태 카드·오류 카드·정시 판 기록을 상태 응답(GET /status) 하나로 다시 그린다. 실행 중이면 상태 카드 안 진행 게이지(drawProgress)와 2.5초 진행 받기(startPoll).
     * 상태 카드: 숫자 3칸(다음 판 · 마지막 실행 — 시각·판·관할 수·초 · 처리 안 된 오류 — errorLog.open·유형 수, 0 아니면 빨강 · 읽지 못하면 「알 수 없음」)
     *   → 통계 칩 한 줄(AI·재사용·규칙 분석·오류 · 마감 · 「쓴 AI」 · 관광지 자료 — drawSpotFail) → 있을 때만: 건너뛴 AI · 참고(AI 끔) · 공개 예정 · 특보 변경 대기 · 실행 실패(조용히 사라지지 않게 — CLAUDE.md L-291).
     * 「저장된 날짜」는 뺐다(§11.10.50 — 사용자 「불필요한 내용은 빼고」).
     * 예: [다음 판 17:30 / 16:50부터 만들기] [마지막 실행 09:40 / 관리자 즉시 실행 · 4곳 · 300초] [처리 안 된 오류 3건 / 유형 2개] · [AI 4] [재사용 0] [규칙 분석 0] [오류 0] · 쓴 AI: 클로드 키2 4 · 관광지 자료 이상 없음
     * @param {Object} v - renderStationBriefingAdmin 의 칸 묶음 {pill, status, errors, times, prog} @returns {Promise<void>}
     * [연계] ← renderStationBriefingAdmin·[↻]·[지금 다시 만들기]·진행이 끝날 때(startPoll) / → drawProgress·startPoll·drawSpotFail·drawErrorCard·drawEditionTimes
     */
    async function drawStatus(v) {
        var box = v.status;
        var r = await call('/status');
        box.textContent = '';
        var prog = el('div', 'margin-bottom:12px;'); prog.setAttribute('data-sb-progress', ''); prog.hidden = true; box.appendChild(prog); v.prog = prog;
        if (r.status !== 200) { setPill(v.pill, null); box.appendChild(el('div', 'color:#fca5a5;font-size:.8rem;', '상태를 불러오지 못했습니다(' + r.status + ').')); return; }
        var s = r.body, lr = s.lastRun, L = s.errorLog;
        setPill(v.pill, !!s.running);
        if (s.running) { drawProgress(prog, s.progress); startPoll(v); }
        var kpis = elc('div', 'sba-kpis'); box.appendChild(kpis);
        var kpi = function (k, val, d, mark, bad) { var c = elc('div', 'sba-kpi' + (bad ? ' bad' : '')); c.appendChild(elc('div', 'k', k)); c.appendChild(elc('div', 'v', val)); var dd = elc('div', 'd', d); c.appendChild(dd); if (mark) c.setAttribute(mark, ''); kpis.appendChild(c); return dd; };
        var nx = nextEdition(Date.now());
        kpi('다음 판', nx.pub, (nx.tomorrow ? '내일 ' + nx.date + ' · ' : '') + nx.start + '부터 만들기', 'data-sb-next');
        var sumSt = 0; ((lr && lr.results) || []).forEach(function (x) { sumSt += x.stations || 0; });
        var lastD = lr ? [at(lr.at).slice(0, 5) !== todayMD() ? at(lr.at).slice(0, 5) : null, KIND[lr.kind] || lr.kind || null, (lr.results || []).length ? sumSt + '곳' : '만든 판 없음', Number.isFinite(lr.ms) ? Math.round(lr.ms / 1000) + '초' : null].filter(Boolean).join(' · ') : '기록 없음';
        kpi('마지막 실행', lr ? at(lr.at).slice(6) : '—', lastD).setAttribute('data-sb-lastrun', '');
        if (!L) kpi('처리 안 된 오류', '—', '정보 없음', 'data-sb-open-kpi');
        else if (L.unavailable) kpi('처리 안 된 오류', '알 수 없음', '누적 기록을 읽지 못함', 'data-sb-open-kpi', true);
        else kpi('처리 안 된 오류', (L.open || 0) + '건', L.open ? '유형 ' + (L.families || []).length + '개' : '없음', 'data-sb-open-kpi', !!L.open);
        if (lr) {
            var res = lr.results || [], rowsEl = [];
            res.forEach(function (x) {
                var st = x.stats || {}, cs = elc('div', 'sba-chips'); cs.setAttribute('data-sb-result', '');
                if (res.length > 1) cs.appendChild(elc('span', 'sba-muted', String(x.date || '').slice(5) + ' 판'));
                chip(cs, 'AI ' + (st.ai || 0), 'ok');
                chip(cs, '재사용 ' + (st.reused || 0));
                chip(cs, '규칙 분석 ' + (st.template || 0), st.template ? 'warn' : '');
                chip(cs, '오류 ' + (x.errors || 0), x.errors ? 'bad' : '');
                if (st.deadline) chip(cs, '마감 ' + st.deadline + '곳', 'bad');
                box.appendChild(cs); rowsEl.push(cs);
            });
            if (!rowsEl.length) { var c0 = elc('div', 'sba-chips'); box.appendChild(c0); rowsEl.push(c0); }
            var tail = rowsEl[rowsEl.length - 1], pv = providersText(lr);
            if (pv) { var pt = elc('span', 'sba-muted', '· 쓴 AI: ' + pv); pt.setAttribute('data-sb-providers', ''); tail.appendChild(pt); }
            drawSpotFail(box, tail, s);
            if (Array.isArray(lr.skipped) && lr.skipped.length) {
                var sk = elc('div', 'sba-line warn', '건너뜀: ' + lr.skipped.map(function (x) { return (PROVIDER[x && x.id] || (x && x.id) || '?') + (x && x.reason ? '(' + x.reason + ')' : ''); }).join(', ')); sk.setAttribute('data-sb-skipped', ''); box.appendChild(sk);
            }
            if (lr.aiDisabled) box.appendChild(elc('div', 'sba-line', '참고: ' + lr.aiDisabled));
        }
        (s.pending || []).forEach(function (x) { var d = elc('div', 'sba-line', '공개 예정 · ' + at(x.publishAt) + ' — ' + x.stations + '곳(그때까지 사용자에게는 이전 판)'); d.setAttribute('data-sb-pending-status', ''); box.appendChild(d); });
        if (s.pendingWarn) { var pw = elc('div', 'sba-line warn', '특보 변경 대기 · ' + (s.pendingWarn.zones || []).join(', ') + ' — 마지막 변경 ' + at(s.pendingWarn.lastChangeAt)); pw.setAttribute('data-sb-pending-warn', ''); box.appendChild(pw); }
        Object.keys(s.failures || {}).forEach(function (k) { var f = s.failures[k], d = elc('div', 'sba-line bad', '실행 실패 · ' + k + ' ' + f.count + '번 · 마지막 ' + at(f.lastAt) + ' · ' + (f.reason || '')); d.setAttribute('data-sb-failure', ''); box.appendChild(d); });
        var errCard = drawErrorCard(v.errors, s, function () { drawStatus(v); });
        drawEditionTimes(v.times, s, function (runAt) { errCard.show('run', runAt); });
    }
    /** 밀리초 → 「분:초」. 예: 754000 → '12:34' · 59000 → '0:59' · 숫자 아님 → '—'. @param {number} ms @returns {string} [연계] ← drawEditionTimes */
    function mmss(ms) { if (!Number.isFinite(ms) || ms < 0) return '—'; var t = Math.round(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
    /**
     * 「관광지 자료 확인 불가」(§11.10.21 — 연안 하루 값 상세를 받지 못한 관광지) — 마지막 실행과, 그것이 특보 변경·관리자 실행이면 마지막 정시 판(lastEdition)까지 본다.
     * 문제가 있는 판(spotFail.stations·spots > 0)만 칩 줄 아래 펼침 칸(누르면 관할·관광지 이름)으로, 없으면 칩 줄 끝에 「관광지 자료 이상 없음」 한 마디(§11.10.50).
     * 이 기록 전 실행(spotFail 없음)이 섞이면 「관광지 자료: 기록 없음(이 기능 전 실행)」 — 0(이상 없음)으로 보이지 않게(CLAUDE.md L-291).
     * 예: lastEdition 10-17 07:10 07:30 판 spotFail {stations:2, spots:3, list:[…]} → ▸「관광지 자료 확인 불가: 2관할 · 관광지 3곳 — 마지막 정시 판 10-17 07:10 · 07:30 판」 → 「제주해양경찰서 한림파출소 — 금능해수욕장, 협재해수욕장」
     * @param {HTMLElement} box - 상태 카드 @param {HTMLElement} tail - 칩 줄(이상 없음 한 마디를 붙일 곳) @param {Object} s - status 응답 @returns {void} [연계] ← drawStatus · 서버 station_briefing.spotFailOf(lastRun·lastEdition results[].spotFail)
     */
    function drawSpotFail(box, tail, s) {
        var runs = [];
        if (s.lastRun) runs.push(['마지막 실행', s.lastRun]);
        if (s.lastEdition && (!s.lastRun || s.lastEdition.at !== s.lastRun.at)) runs.push(['마지막 정시 판', s.lastEdition]);
        var bad = [], unknown = false;
        runs.forEach(function (pair) { (pair[1].results || []).forEach(function (x) { var f = x.spotFail; if (!f) unknown = true; else if (f.stations > 0 || f.spots > 0) bad.push([pair[0], pair[1], x]); }); });
        if (!bad.length) {
            if (!runs.length) return;
            var t = elc('span', 'sba-muted', unknown ? '· 관광지 자료: 기록 없음(이 기능 전 실행)' : '· 관광지 자료 이상 없음'); t.setAttribute('data-sb-spotfail', ''); tail.appendChild(t); return;
        }
        var wrap = el('div'); wrap.setAttribute('data-sb-spotfail', ''); box.appendChild(wrap);
        bad.forEach(function (b) {
            var r = b[1], f = b[2].spotFail;
            var d = elc('details', 'sba-sf'); d.setAttribute('data-sb-spotfail-row', '');
            d.appendChild(el('summary', '', '관광지 자료 확인 불가: ' + f.stations + '관할 · 관광지 ' + f.spots + '곳 — ' + b[0] + ' ' + at(r.at) + ' · ' + (KIND[r.kind] || r.kind || '') + ' · ' + String(b[2].date || '').slice(5) + ' 판'));
            var ul = el('ul'); (f.list || []).forEach(function (g) { ul.appendChild(el('li', '', [g.office, g.station].filter(Boolean).join(' ') + ' — ' + (g.spots || []).join(', '))); });
            if (!(f.list || []).length) ul.appendChild(el('li', '', '이름 목록은 마지막 실행·마지막 정시 판에만 남깁니다'));
            d.appendChild(ul); d.appendChild(elc('div', 'sba-muted', '그 관광지는 브리핑 연안 판단에서 빠집니다.'));
            wrap.appendChild(d);
        });
        if (unknown) wrap.appendChild(elc('div', 'sba-muted', '관광지 자료: 일부 판은 기록 없음(이 기능 전 실행)'));
    }
    var EDITION_ROWS = 6;
    /**
     * 정시 판(07:30·17:30·23:00) 기록 표 — 최근 EDITION_ROWS 회(서버 실행 기록 status.runs, 최근 3일). 사용자가 「만들기 시작 시각을 앞당길지」 판단하는 데 쓴다(§11.10.21).
     * 칸(§11.10.50): 판(공개 시각 + 시작 날짜·시각) · 소요(분:초 — 공개 시각 뒤에 끝났으면 「공개 m:ss 뒤」 빨강) · AI·재사용·규칙(실행 마감에 걸린 판만 「마감 N곳」) · 오류(0 아니면 빨강).
     * 줄을 누르면(Enter 도) 오류 카드가 「실행별」 탭으로 그 실행을 고른다(onPick).
     * 예: drawEditionTimes(box, {runs:[{at:'2026-10-17T07:10:00+09:00',kind:'morning',ms:754000,publishAt:'…T07:30:00+09:00',results:[{stations:97,stats:{ai:90,reused:3,template:4,deadline:1},errors:2}]}], runDeadlineMs:1200000}, fn)
     *     → | 07:30 10-17 07:10 | 12:34 | 90 · 3 · 4 [마감 1곳] | 2 |
     * @param {HTMLElement} box - 카드 @param {Object} s - status 응답 @param {Function} onPick - (실행 시작 시각) @returns {void} [연계] ← drawStatus · 서버 station_briefing.run(runs[].ms·results[].stats.deadline)·status(runDeadlineMs) / → drawErrorCard show
     */
    function drawEditionTimes(box, s, onPick) {
        box.textContent = '';
        var ct = elc('div', 'sba-ct'); ct.appendChild(el('span', '', '정시 판 기록')); ct.appendChild(el('small', '', '최근 ' + EDITION_ROWS + '회')); box.appendChild(ct);
        var rows = (s.runs || []).filter(function (r) { return r && ['morning', 'evening', 'night'].indexOf(r.kind) >= 0; }).slice(0, EDITION_ROWS);
        if (!rows.length) { box.appendChild(elc('div', 'sba-sub', '최근 3일 정시 판 기록 없음')); return; }
        var t = elc('table', 'sba-tt'), cg = el('colgroup');
        ['30%', '20%', '34%', '16%'].forEach(function (wd) { var c = el('col'); c.style.width = wd; cg.appendChild(c); }); t.appendChild(cg);
        var hr = el('tr'); [['판(시작)'], ['소요'], ['AI · 재사용 · 규칙'], ['오류', 'r']].forEach(function (h) { var th = el('th', '', h[0]); if (h[1]) th.className = h[1]; hr.appendChild(th); }); var thd = el('thead'); thd.appendChild(hr); t.appendChild(thd);
        var tb = el('tbody'); t.appendChild(tb);
        rows.forEach(function (r) {
            var n = { ai: 0, reused: 0, template: 0, errors: 0, deadline: 0 };
            (r.results || []).forEach(function (x) { var st = x.stats || {}; n.ai += st.ai || 0; n.reused += st.reused || 0; n.template += st.template || 0; n.deadline += st.deadline || 0; n.errors += x.errors || 0; });
            var end = Date.parse(r.at) + r.ms, gap = r.publishAt && Number.isFinite(end) ? Date.parse(r.publishAt) - end : NaN;
            var tr = el('tr'); tr.setAttribute('data-sb-edition-row', r.at); tr.tabIndex = 0; tr.title = '이 실행의 오류 보기';
            var td1 = el('td', '', String(KIND[r.kind] || '').replace(' 판', '')); td1.appendChild(el('small', '', at(r.at))); tr.appendChild(td1);
            var td2 = el('td', '', mmss(r.ms)); if (Number.isFinite(gap) && gap < 0) td2.appendChild(elc('small', 'late', '공개 ' + mmss(-gap) + ' 뒤')); tr.appendChild(td2);
            var td3 = el('td', '', n.ai + ' · ' + n.reused + ' · ' + n.template); if (n.deadline) td3.appendChild(elc('span', 'sba-dl', '마감 ' + n.deadline + '곳')); tr.appendChild(td3);
            var td4 = el('td', '', String(n.errors)); td4.className = 'r' + (n.errors ? ' bad' : ''); tr.appendChild(td4);
            var pick = function () { onPick(r.at); };
            tr.addEventListener('click', pick); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') pick(); });
            tb.appendChild(tr);
        });
        box.appendChild(t);
        var dl = Number.isFinite(s.runDeadlineMs) ? Math.round(s.runDeadlineMs / 60000) + '분' : '정한 시간';
        box.appendChild(elc('div', 'sba-note', '소요 = 위치 확인부터 저장까지 · 마감 = 시작 뒤 ' + dl + '과 공개 시각 중 이른 때(넘은 관할은 규칙 분석) — 걸린 판만 「마감 N곳」 · 판을 누르면 그 실행의 오류'));
    }
    /** 상태 알약을 실행 중/대기로. 예: setPill(p, true) → 「● 실행 중」. @param {HTMLElement} pill @param {boolean|null} on - null 이면 「알 수 없음」 @returns {void} [연계] ← drawStatus·startPoll·[지금 다시 만들기] */
    function setPill(pill, on) {
        pill.className = 'sba-state ' + (on ? 'on' : 'idle');
        pill.lastChild.textContent = on === null ? '알 수 없음' : on ? '실행 중' : '대기 중';
    }
    /**
     * 실행 중이면 2.5초마다 진행만(GET status?only=progress) 받아 게이지를 다시 그린다. 끝나면(running false) 멈추고 상태를 통째로 다시 그린다(새 결과·오류).
     * 화면이 가려져 있으면(document.hidden) 그 차례는 건너뛰고, 탭을 떠나 상자가 문서에서 떨어지면 멈춘다. 한 번에 하나만 돈다.
     * 예: startPoll(v) → 2.5초 뒤 진행 41/99 … → running:false → drawStatus(v)
     * @param {Object} v - drawStatus 의 칸 묶음 @returns {void} [연계] ← drawStatus / → drawProgress
     */
    function startPoll(v) {
        if (ui.poll) clearTimeout(ui.poll);
        var busy = false;
        var tick = async function () {
            ui.poll = null;
            if (!v.status.isConnected) return;   // 다른 탭·모달 닫힘 — 멈춘다
            if (!document.hidden && !busy) {
                busy = true;
                try {
                    var r = await call('/status?only=progress');
                    if (r.status === 200) {
                        if (!r.body.running) { drawStatus(v); return; }
                        setPill(v.pill, true); if (v.prog) drawProgress(v.prog, r.body.progress);
                    }
                } catch (e) { console.warn('[AI 브리핑 관리] 진행 받기 실패(다음 차례에 다시):', e && e.message); }
                finally { busy = false; }
            }
            if (v.status.isConnected) ui.poll = setTimeout(tick, POLL_MS);
        };
        ui.poll = setTimeout(tick, POLL_MS);
    }
    /** 이름에서 꼬리를 떼어 짧게. 예: '통영해양경찰서' → '통영' · '고현파출소' → '고현' · '남해지방해양경찰청' → '남해'. @param {string} n @returns {string} [연계] ← drawProgress */
    function shortName(n) { var s = String(n || '').replace(/(지방해양경찰청|해양경찰서|파출소|출장소)$/, ''); return s || String(n || ''); }
    /**
     * 진행 게이지 — 2026-10-17 사용자 *"분석이 시작되면 게이지로서 알려줬으면 … 묶음 단위별로 어디 묶음이 완료되었는지 그리고 그 묶음 안에서 어느 파출소 부분이 완료되었는지
     * … 전체 게이지로서 전체적으로 얼마나 진행됐는지 … 게이지의 가운데에는 텍스트로 어디가 진행되고 있는지"*.
     * ① 전체 막대(끝난 칸/전체 칸 %, 가운데 글 = 지금 하는 곳) ② 단계 4칸(위치 확인·입력 모으기·AI 분석·저장) ③ 묶음 칩(이름 끝난 수/관할 수 — 누르면 그 묶음 관할을 봄)
     * ④ 고른 묶음(기본 = 지금 부르는 묶음)의 관할 칩(✓ 완료 · ● 진행 중 · ↻ 다시 시도 대기 · 규칙 = AI 실패 → 규칙 분석 · 회색 대기).
     * 예: drawProgress(div, {done:40,total:99,current:'통영해양경찰서 · 고현파출소 — Gemini 4번째 시도',phase:'ai',batches:[…]})
     * @param {HTMLElement} box @param {Object|null} p - status.progress @returns {void} [연계] ← drawStatus·startPoll
     */
    function drawProgress(box, p) {
        box.textContent = ''; box.hidden = false;
        if (!p) { box.appendChild(elc('div', 'sba-sub', '진행 정보를 아직 받지 못했습니다 — 곧 다시 받습니다.')); return; }
        var pct = p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : 0;
        var head = elc('div', 'sba-row'); head.style.justifyContent = 'space-between'; head.style.marginBottom = '4px';
        var sec = Math.max(0, Math.round((Date.now() - Date.parse(p.at)) / 1000));
        head.appendChild(elc('span', 'sba-sub', (KIND[p.kind] || p.kind || '') + ' · ' + at(p.at) + ' 시작 · ' + (Number.isFinite(sec) ? Math.floor(sec / 60) + '분 ' + (sec % 60) + '초 지남' : '')));
        var pc = elc('span', 'sba-main', pct + '% (' + p.done + '/' + p.total + ')'); pc.setAttribute('data-sb-progress-pct', ''); head.appendChild(pc);
        box.appendChild(head);
        var g = elc('div', 'sba-gauge'); g.setAttribute('role', 'progressbar'); g.setAttribute('aria-valuemin', '0'); g.setAttribute('aria-valuemax', String(p.total || 0)); g.setAttribute('aria-valuenow', String(p.done || 0));
        var fill = elc('div', 'sba-fill'); fill.style.width = pct + '%'; g.appendChild(fill);
        var gl = elc('div', 'sba-glabel', p.current || ''); gl.setAttribute('data-sb-progress-now', ''); g.appendChild(gl); g.setAttribute('aria-valuetext', pct + '% — ' + (p.current || ''));
        box.appendChild(g);
        var order = ['locate', 'gather', 'ai', 'save'], names = ['위치 확인', '입력 모으기', 'AI 분석', '저장'], ix = order.indexOf(p.phase);
        var ph = elc('div', 'sba-phases'); order.forEach(function (k, i) { ph.appendChild(elc('span', 'sba-phase' + (i === ix ? ' now' : i < ix ? ' past' : ''), names[i])); }); box.appendChild(ph);
        var bs = p.batches || [];
        if (!bs.length) return;
        var unitName = label('batchUnit', p.unit || 'office');
        box.appendChild(el('div', 'color:#cbd5e1;font-size:.74rem;margin-top:10px;', '묶음(' + unitName + ') ' + bs.filter(function (b) { return b.state === 'done'; }).length + '/' + bs.length + ' 끝 — 칩을 누르면 그 묶음의 관할을 봅니다'));
        var running = bs.filter(function (b) { return b.state === 'running'; })[0];
        var pick = bs.filter(function (b) { return b.name === ui.batch; })[0] || running || bs.filter(function (b) { return b.state !== 'done'; })[0] || bs[bs.length - 1];
        var wrap = elc('div', 'sba-batches'); wrap.setAttribute('data-sb-progress-batches', '');
        bs.forEach(function (b) {
            var n = b.stations.length, c = elc('button', 'sba-batch ' + (b.state || 'waiting'), shortName(b.name) + ' ' + (b.done || 0) + '/' + n);
            c.type = 'button'; c.title = b.name; c.setAttribute('data-state', b.state || 'waiting'); c.setAttribute('aria-pressed', String(b === pick));
            var bar = elc('span', 'bar'); bar.style.width = (n ? Math.round((b.done || 0) / n * 100) : 0) + '%'; c.appendChild(bar);
            c.addEventListener('click', function () { ui.batch = b.name; drawProgress(box, p); });
            wrap.appendChild(c);
        });
        box.appendChild(wrap);
        if (!pick) return;
        var STATE = { done: ['✓', '완료'], running: ['', '진행 중'], retry: ['↻', '다시 시도 대기'], rule: ['규칙', 'AI 실패 → 규칙 분석'], waiting: ['', '대기'] };
        var d = el('div', 'margin-top:8px;'); d.setAttribute('data-sb-progress-stations', '');
        d.appendChild(el('div', 'color:#f1f5f9;font-size:.78rem;font-weight:700;', pick.name + ' — ' + (pick.done || 0) + '/' + pick.stations.length + '곳 끝'));
        var sts = elc('div', 'sba-sts');
        pick.stations.forEach(function (x) {
            var st = STATE[x.state] ? x.state : 'waiting', c = elc('span', 'sba-st sba-st-' + st); c.setAttribute('data-state', st); c.title = x.name + ' — ' + STATE[st][1] + (x.attempt ? '(' + x.attempt + '번째 시도)' : '');
            if (st === 'running') c.appendChild(elc('span', 'sba-dot'));
            c.appendChild(document.createTextNode((STATE[st][0] ? STATE[st][0] + ' ' : '') + shortName(x.name) + (st === 'retry' && x.attempt ? ' ' + x.attempt : '')));
            sts.appendChild(c);
        });
        d.appendChild(sts);
        d.appendChild(el('div', 'color:#94a3b8;font-size:.68rem;margin-top:5px;', '✓ 완료 · ● 진행 중 · ↻ 다시 시도 대기(숫자 = 떨어진 시도) · 규칙 = AI 실패 → 규칙 분석 · 회색 = 대기'));
        box.appendChild(d);
    }

    // ── 오류 풀이(§11.10.7 C) — 사용자 *"지금 영문으로 쓰이고 … 이해하기가 어렵거든 … 어떤 파출소의 어떤 부분에 있어서 어떤 오류가 발생했는지"* ──
    /** 관할 열쇠를 이름으로. 예: '통영해양경찰서|고현파출소' → {name:'고현파출소', office:'통영해양경찰서'}. @param {string} k @returns {Object} [연계] ← stationsText·runErrorGroups */
    function stationOf(k) { var a = String(k).split('|'); return a.length > 1 ? { name: a.slice(1).join('|'), office: a[0] } : { name: a[0], office: '' }; }
    /** 관할 열쇠 목록을 읽는 글로. 예: ['제주해양경찰서|한림파출소'] → '제주해양경찰서 한림파출소' · 5곳·max 3 → '… 외 2곳'. @param {string[]} keys @param {number} [max] @param {boolean} [short] - 파출소 이름만 @returns {string} [연계] ← errorsMarkdown·drawRunErrors */
    function stationsText(keys, max, short) {
        var a = (Array.isArray(keys) ? keys : []).map(function (k) { return short ? stationOf(k).name : String(k).replace('|', ' '); });
        if (!a.length) return '—';
        return max && a.length > max ? a.slice(0, max).join(', ') + ' 외 ' + (a.length - max) + '곳' : a.join(', ');
    }
    /** 오류 한 건의 판 글. 예: {edition:'morning',date:'2026-10-17'} → '07:30 판 · 2026-10-17' · 없음 → '—'. @param {Object} e @returns {string} [연계] ← errorsMarkdown */
    function editionText(e) { return [e.edition ? (KIND[e.edition] || e.edition) : null, e.date || null].filter(Boolean).join(' · ') || '—'; }
    /** 오류 단계 글 — 시도 번호가 있으면 붙인다(§11.10.4). 예: {stage:'validate',attempt:2} → 'validate · 2번째' · {stage:'deadline'} → 'deadline'. @param {Object} e @returns {string} [연계] ← errorsMarkdown */
    function stageText(e) { return (e.stage || '') + (Number(e.attempt) > 0 ? ' · ' + Number(e.attempt) + '번째' : ''); }
    /** KST 날짜·시각 글. 예: (ms, true) → '2026-10-17 08:05' · (ms, false) → '20261017_0805'(파일 이름용). @param {number} ms @param {boolean} human @returns {string} [연계] ← errorsMarkdown·저장 파일 이름 */
    function kstStamp(ms, human) { var s = new Date(ms + 9 * 3600000).toISOString(); return human ? s.slice(0, 10) + ' ' + s.slice(11, 16) : s.slice(0, 10).replace(/-/g, '') + '_' + s.slice(11, 16).replace(':', ''); }
    /** 문단 열쇠를 화면 이름으로. 예: 'land' → '연안 분석' · 'sea' → '해상 분석'. @returns {string} [연계] ← codeText */
    function para(k) { return k === 'land' ? '연안 분석' : '해상 분석'; }
    /**
     * 검사 오류 열쇠 하나를 한글로 푼다 — 서버 station_briefing_ai.validateOverview·generate 가 남기는 열쇠 전부(모르는 열쇠는 원래 글 그대로).
     * 예: 'place:장승포' → '입력 자료에 없는 지명 「장승포」' · 'level:주의>1' → '단계를 높여 씀 — 「주의」라고 썼지만 그 대상 단계는 「관심」까지'
     *     'shape:sea-sentences-2' → '해상 분석이 2문장(3~5문장이어야 함)' · 'number:hangul:세 곳' → '한글 셈말 「세 곳」 — 그 문단 결론·근거 줄에 같은 수가 없음(…)' · 'xyz' → 'xyz'
     * @param {string} code @returns {string} [연계] ← reasonGroups · 시험 test_station_briefing.js(모든 열쇠가 풀리는지)
     */
    function codeText(code) {
        var c = String(code || '').trim(), m, after = function (p) { return c.slice(p.length); };
        if ((m = /^shape:(land|sea)-sentences-(\d+)$/.exec(c))) return para(m[1]) + '이 ' + m[2] + '문장(' + SHAPE.minS + '~' + SHAPE.maxS + '문장이어야 함)';
        if ((m = /^shape:(land|sea)-too-long-(\d+)$/.exec(c))) return para(m[1]) + '이 ' + m[2] + '자(' + SHAPE.maxChars + '자 이내여야 함)';
        if ((m = /^shape:(land|sea)-no-conclusion$/.exec(c))) return para(m[1]) + ' 마지막 문장이 「따라서 … 요구됩니다.」 꼴이 아님(§11.10.16 전 실행은 「필요합니다.」)';
        if (c === 'shape:land-missing') return '연안 분석 문단이 비었음';
        if (c === 'shape:sea-missing') return '해상 분석 문단이 비었음';
        if (c === 'shape:land-not-allowed') return '해상만 맡는 관할인데 연안 분석을 씀';
        if (c.indexOf('word:level-need:') === 0) return '단계 말에 「필요」를 붙임 「' + after('word:level-need:') + '」(「주의」·「주의 수준」으로 — 설계서 §11.10.17 S1)';
        if (c === 'word:기준') return '「기준」이라는 말을 씀(바다 상태 말로 — §11.10.17 S3)';
        if (c === 'word:reason-twice') return '권고에서 이유를 두 번 겹쳐 씀(「… 근거로, … 이므로」 — §11.10.17 S6)';
        if (c === 'word:tag-reason') return '근거 꼬리표 「(기상청)·(KOMSA) 근거로」를 문장 속 이유로 씀(§11.10.17 S6)';
        if (c === 'markup') return 'HTML·링크 같은 표시 글자를 씀';
        if (c === 'missing:station') return 'AI 응답에 이 관할이 빠짐';
        if (c === 'parse') return 'AI 응답이 정해진 꼴(JSON)이 아님';
        if (c.indexOf('number:hangul:') === 0) return '한글 셈말 「' + after('number:hangul:') + '」 — 그 문단 결론·근거 줄에 같은 수가 없음(곳·개 말고는 쓰지 않음)';
        if (c.indexOf('number:') === 0) return '허용되지 않은 숫자 「' + after('number:') + '」 — 입력 자료에 없거나 (기상) 칸 숫자(AI 분석엔 쓰지 않음)';
        if (c.indexOf('multiplier:') === 0) return '입력 자료에 없는 배수 「' + after('multiplier:') + '」';
        if (c.indexOf('place:') === 0) return '입력 자료에 없는 지명 「' + after('place:') + '」';
        // 조사는 앞 낱말(관심·주의·경계·지명)에 따라 달라 붙이지 않는 꼴로 쓴다(「관심」와 같은 틀린 조사 방지)
        if ((m = /^level:(관심|주의|경계)>(\d)$/.exec(c))) return '단계를 높여 씀 — 「' + m[1] + '」라고 썼지만 그 대상의 단계는 「' + (LEVEL[+m[2]] || m[2]) + '」까지';
        if ((m = /^level-para:(관심|주의|경계)>(\d)$/.exec(c))) return '대상 이름 없이 단계 말 「' + m[1] + '」 사용 — 문단 결론 단계는 「' + (LEVEL[+m[2]] || m[2]) + '」';
        if ((m = /^level-last:(\S+)≠(\d)$/.exec(c))) return (m[1] === '없음' ? '마지막 「따라서」 문장에 단계 말이 없음' : '마지막 「따라서」 문장의 단계 말이 「' + m[1] + '」') + ' — 결론 단계는 「' + (LEVEL[+m[2]] || m[2]) + '」(같은 단계로 맺어야 함)';
        if ((m = /^level-max:(\S+)≠(\d)$/.exec(c))) return '문단에서 가장 높은 단계 말이 「' + m[1] + '」 — 결론 단계는 「' + (LEVEL[+m[2]] || m[2]) + '」(같아야 함)';
        if (c.indexOf('fact:') === 0) return '입력 자료에 없는 말 「' + after('fact:') + '」 사용';
        if (c.indexOf('label:') === 0) return '따옴표 단계 이름 ' + after('label:') + ' — 이 관할 자료에 없음';
        if (c === 'forbidden:안전 단정') return '「안전합니다」·「문제없음」 같은 단정을 씀';
        if (c === 'forbidden:결론과 다른 단정') return '결론보다 위험을 낮춰 말함(「평온」·「위험이 낮」 등)';
        if (c === 'forbidden:출항 지시') return '출항 금지·자제 같은 지시를 씀';
        if (c.indexOf('forbidden:') === 0) return '쓰지 않는 말 「' + after('forbidden:') + '」 사용';
        if (c === 'required:land' || c === 'required:sea') return '(옛 검사) ' + para(c.slice(9)) + '에 꼭 넣을 말 빠짐';
        if (c.indexOf('required:missing:') === 0) return '(옛 검사) 꼭 넣을 「' + after('required:missing:') + '」 빠짐';
        return c;
    }
    /**
     * 오류 한 건의 이유 글을 한글 풀이 목록으로. 검사 탈락(validate)은 쉼표로 이은 열쇠들을 하나씩 풀고, 같은 종류(지명·숫자)는 한 줄로 모은다.
     * 호출·해석·시간 초과·실행 실패는 서버가 쓴 글(대부분 한글)을 짧게 바꿔 쓴다.
     * 예: {stage:'validate',reason:'place:장승포,number:0.5m,number:4~8m/s'} → ['입력 자료에 없는 지명 「장승포」', '허용되지 않은 숫자 「0.5m」·「4~8m/s」 — …']
     *     {stage:'call',provider:'vm',reason:'vm 시간초과(320초)'} → ['AI 응답 시간 초과(320초)']
     * @param {Object} e - 오류 한 건 @returns {string[]} [연계] ← drawRunErrors·errorsMarkdown
     */
    function reasonTexts(e) {
        var r = String(e.reason || '');
        if (e.stage !== 'validate') {
            var m;
            if ((m = /^(?:vm|gemini) 시간초과\((\d+)초\)$/.exec(r))) return ['AI 응답 시간 초과(' + m[1] + '초)'];
            if (r === 'invalid response') return ['AI 응답을 읽지 못함(정해진 꼴이 아님)'];
            if (r === 'VM 작업자 연결 없음') return ['ChatGPT(VM) 작업자 연결이 없어 건너뜀'];
            if (r === '사용 불가') return ['이 AI 를 지금 쓸 수 없어 건너뜀'];
            if (e.stage === 'parse') return ['AI 응답을 읽지 못함 — ' + r];
            if (e.stage === 'call' && !/[가-힣]/.test(r)) return ['AI 호출 실패 — ' + r];
            return [r];
        }
        var fam = {}, order = [], out = [];
        r.split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (c) {
            var f = c.indexOf('place:') === 0 ? 'place' : (c.indexOf('number:') === 0 && c.indexOf('number:hangul:') !== 0) ? 'number' : null;
            if (!f) { out.push(codeText(c)); return; }
            if (!fam[f]) { fam[f] = []; order.push(f); }
            fam[f].push(c.slice(f.length + 1));
        });
        var grouped = order.map(function (f) {
            var q = fam[f].map(function (x) { return '「' + x + '」'; }).join('·');
            return f === 'place' ? '입력 자료에 없는 지명 ' + q : '허용되지 않은 숫자 ' + q + ' — 입력 자료에 없거나 (기상) 칸 숫자(AI 분석엔 쓰지 않음)';
        });
        return grouped.concat(out);
    }
    /** 오류 단계 이름(한글). 예: 'validate' → '검사 탈락' · 'call' → 'AI 호출 실패'. @param {string} st @returns {string} [연계] ← attemptText */
    function stageName(st) { return { validate: '검사 탈락', call: 'AI 호출 실패', parse: '응답 해석 실패', deadline: '시간 초과', run: '실행 실패' }[st] || st || ''; }
    /** 시도 글. 예: {attempt:4,provider:'gemini',stage:'validate'} → '4번째 시도(Gemini)' · {stage:'deadline'} → '시간 초과'. @param {Object} e @returns {string} [연계] ← drawRunErrors·errorsMarkdown */
    function attemptText(e) { return Number(e.attempt) > 0 ? Number(e.attempt) + '번째 시도' + (PROVIDER[e.provider] ? '(' + PROVIDER[e.provider] + ')' : '') : stageName(e.stage); }
    /**
     * 실행마다 묶는다 — 실행 기록(status.runs · 오류가 0건인 실행도)과 오류(at = 그 실행 시작 시각 — 서버 generate 가 run 의 now 로 찍음)를 시작 시각으로 맞춘다.
     * 실행 기록이 없는 옛 오류(이 바꿈 전)는 오류의 at·판(edition)으로 실행을 만들고, 실행 실패(stage run — 1분 점검의 기록)는 「실행 실패」.
     * 예: runGroups([{at:'…18:31:00+09:00',edition:'manual',…}×22], [{at:'…18:31:00+09:00',kind:'manual',ms:797000,…}], null)
     *     → [{at:'…18:31:00+09:00', kind:'manual', run:{…}, errors:[22건]}] (최근 실행부터)
     * @param {Object[]} errs - status.errors @param {Object[]} runs - status.runs @param {Object|null} lastRun @returns {Object[]} [연계] ← drawRunErrors · 시험
     */
    function runGroups(errs, runs, lastRun) {
        var map = {}, list = [];
        var get = function (key, kind) { if (!map[key]) { map[key] = { at: key, kind: kind || null, run: null, errors: [] }; list.push(map[key]); } return map[key]; };
        (Array.isArray(runs) ? runs : []).concat(lastRun ? [lastRun] : []).forEach(function (r) { if (!r || !r.at) return; var g = get(r.at, r.kind); if (!g.run) g.run = r; });
        (Array.isArray(errs) ? errs : []).forEach(function (e) {
            var key = String(e.at || ''), g = map[key] || get(key, e.stage === 'run' ? 'failure' : e.edition);
            if (!g.kind) g.kind = e.stage === 'run' ? 'failure' : e.edition;
            g.errors.push(e);
        });
        return list.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    }
    /** 드롭다운 한 줄. 예: {at:'2026-10-17T18:31:00+09:00',kind:'manual',errors:[22]} → '10-17 18:31 · 관리자 즉시 실행 · 오류 22'. @param {Object} g @returns {string} [연계] ← drawRunErrors */
    function runOptionText(g) { return at(g.at) + ' · ' + (KIND[g.kind] || g.kind || '실행') + ' · 오류 ' + g.errors.length; }
    /**
     * 마크다운 표 칸 하나 — 줄바꿈은 빈칸으로, 「\」「|」「`」「<」「>」「~」는 앞에 역슬래시(글자 그대로 보이게 — 2026-10-17 독립 검토 11 · 「~」는 §11.10.48 검토 ⑬:
     * 「0.5~1.5m」·「1~2m」가 한 칸에 둘 들어가면 GFM 미리보기가 취소선으로 읽는다). 빈 값은 「—」.
     * 예: mdCell('a|b') → 'a\\|b' · mdCell(null) → '—'. @param {*} v @returns {string} [연계] ← errorsMarkdown·cumulativeMarkdown·rejectedMarkdown(넘겨받음)
     */
    function mdCell(v) { return String(v === undefined || v === null || v === '' ? '—' : v).replace(/\r?\n/g, ' ').replace(/([\\|`<>~])/g, '\\$1'); }
    /**
     * 오류 목록을 마크다운으로(복사·md 저장이 같은 글을 쓴다). 표 칸의 줄바꿈은 빈칸으로, 「\」「|」「`」「<」「>」는 앞에 역슬래시를 붙여 글자 그대로 보이게 한다
     * (2026-10-17 독립 검토 11 — 이유 글의 `·<·> 가 마크다운 미리보기에서 코드·HTML 로 읽히지 않게 — CommonMark 문장부호 이스케이프).
     * run 을 주면(§11.10.7 — 고른 실행 하나) 제목·머리에 그 실행(시작 시각·판·방식·걸린 시간·판별 통계)을 적는다. 마지막 칸 「풀이」 = 화면과 같은 한글 풀이(reasonTexts).
     * 예: errorsMarkdown([{at:'2026-10-17T08:03:10+09:00',edition:'morning',date:'2026-10-17',stage:'validate',provider:'chatgpt',stations:['제주해양경찰서|한림파출소'],reason:'place:제주도',attempt:2}], ms, {days:3})
     *     → '# 연안 안전 브리핑 — AI 브리핑 오류(최근 3일)\n\n- 만든 시각: 2026-10-17 10:05 KST\n- 건수: 1건\n\n| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 | 풀이 |\n|---|…|\n| 2026-10-17 08:03:10 | 07:30 판 · 2026-10-17 | validate · 2번째 | chatgpt | 제주해양경찰서 한림파출소 | place:제주도 | 2번째 시도(ChatGPT) — 입력 자료에 없는 지명 「제주도」 |'
     * @param {Object[]} errs - 오류(최근 것부터) @param {number} nowMs @param {Object} keep - status.errorKeep {days,cap} @param {Object} [run] - runGroups 의 한 실행
     * 표 아래에는 검사에 떨어진 AI 글·그 관할 허용 숫자·배수 절을 붙인다(§11.10.31 — 서버가 남긴 오류에 글이 있을 때만, rejectedMarkdown).
     * @returns {string} [연계] ← drawRunErrors(복사·md로 저장) · 시험 test_station_briefing.js(vm) / → rejectedMarkdown
     */
    function errorsMarkdown(errs, nowMs, keep, run) {
        var cell = mdCell;
        var head = run ? at(run.at) + ' 시작 · ' + (KIND[run.kind] || run.kind || '실행') : '최근 ' + ((keep && keep.days) || 3) + '일';
        var out = ['# 연안 안전 브리핑 — AI 브리핑 오류(' + head + ')', ''];
        if (run && run.run) {
            var r = run.run;
            out.push('- 실행: ' + String(r.at || '').slice(0, 16).replace('T', ' ') + ' 시작 · ' + (KIND[r.kind] || r.kind || '') + ' · 방식 ' + (r.method || '—') + (Number.isFinite(r.ms) ? ' · ' + Math.round(r.ms / 1000) + '초' : ''));
            (r.results || []).forEach(function (x) { var st = x.stats || {}; out.push('- ' + x.date + ' 판 ' + (x.stations || 0) + '곳: AI ' + (st.ai || 0) + ' · 다시 시도 ' + (st.retried || 0) + '곳 · Gemini ' + (st.gemini || 0) + '회 · 재사용 ' + (st.reused || 0) + ' · 규칙 분석 ' + (st.template || 0) + ' · 오류 ' + (x.errors || 0)); });
        }
        out.push('- 만든 시각: ' + kstStamp(nowMs, true) + ' KST', '- 건수: ' + errs.length + '건', '', '| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 | 풀이 |', '|---|---|---|---|---|---|---|');
        errs.forEach(function (e) { out.push('| ' + [String(e.at || '').slice(0, 19).replace('T', ' '), editionText(e), stageText(e), e.provider, stationsText(e.stations), e.reason, (e.resolved ? '(처리 완료) ' : '') + attemptText(e) + ' — ' + reasonTexts(e).join(' · ')].map(cell).join(' | ') + ' |'); });
        return out.join('\n') + '\n' + rejectedMarkdown(errs, cell);
    }
    /**
     * 검사에 떨어진 AI 글과 그 관할의 허용 숫자·배수(서버 오류의 text·allowed — §11.10.31)를 마크다운 절로. 글이 실린 오류가 없으면 빈 글.
     * 글은 코드 울타리(```text) 안에 그대로 — 글 속 백틱 줄보다 긴 울타리를 써서 글이 울타리를 닫지 못하게 한다(CommonMark).
     * 서버 보관 상한(최근 1,000건)을 넘어 글을 지운 오류(textDropped)는 그 사실을 한 줄로 밝힌다.
     * 예: rejectedMarkdown([{at:'2026-10-18T14:08:00+09:00',stations:['인천해양경찰서|대청파출소'],attempt:1,provider:'chatgpt',reason:'multiplier:1.1~1.2배',text:{land:'…',sea:'…'},allowed:{numbers:['1.1배'],multipliers:{sea:[],land:['1.1배','1.2배']}}}], cell)
     *     → '\n## 탈락한 AI 글 …\n\n### 1. 2026-10-18 14:08:00 · 인천해양경찰서 대청파출소 · 1번째 시도(ChatGPT)\n\n- 이유: `multiplier:1.1~1.2배`\n- 허용 배수 — 연안: `1.1배` · `1.2배` / 해상: (없음)\n…'
     * @param {Object[]} errs @param {Function} cell - errorsMarkdown 의 표 칸 이스케이프 @returns {string} [연계] ← errorsMarkdown
     */
    function rejectedMarkdown(errs, cell, keepText) {
        var list = errs.filter(function (e) { return e && (e.text || e.textDropped); });
        if (!list.length) return '';
        // 숫자·이유는 코드 칸(`…`)으로 — 「12~15시 · 15~18시」의 물결(~)이 GFM 미리보기에서 취소선으로 읽히지 않게. 글 속 백틱보다 긴 백틱으로 감싼다.
        var ticks = function (t, min) { var runs = String(t).match(/`+/g) || []; return new Array(Math.max(min, 1 + runs.reduce(function (m, r) { return Math.max(m, r.length); }, 0)) + 1).join('`'); };
        var code = function (v) { var s = String(v).replace(/\r?\n/g, ' '), f = ticks(s, 1); return f.length > 1 ? f + ' ' + s + ' ' + f : f + s + f; };
        var join = function (a) { return Array.isArray(a) && a.length ? a.map(code).join(' · ') : '(없음)'; };
        var fence = function (t) { var f = ticks(t, 3); return f + 'text\n' + t + '\n' + f; };
        var out = ['', '## 탈락한 AI 글 — 검사가 본 글과 그 관할의 허용 숫자·배수(' + list.length + '건)', ''];
        list.forEach(function (e, i) {
            out.push('### ' + (i + 1) + '. ' + [String(e.at || '').slice(0, 19).replace('T', ' '), stationsText(e.stations), attemptText(e)].map(cell).join(' · '), '', '- 이유: ' + code(e.reason || '—'));
            if (!e.text) { out.push('- 글: 보관 상한(' + (keepText || '최근 1,000건') + ')을 넘어 서버가 지웠습니다', ''); return; }
            var a = e.allowed || {}, m = a.multipliers || {};
            out.push('- 허용 배수 — 연안: ' + join(m.land) + ' / 해상: ' + join(m.sea), '- 허용 숫자: ' + join(a.numbers), '');
            [['land', '연안 분석'], ['sea', '해상 분석']].forEach(function (p) { var t = e.text[p[0]]; out.push(p[1] + ':', '', typeof t === 'string' && t ? fence(t) : '(없음)', ''); });
        });
        return out.join('\n');
    }
    /**
     * 한 실행의 오류를 관할별로 묶는다 — 관할 하나짜리 오류(검사 탈락 등)는 그 관할 아래 시도 순서대로, 여러 관할에 걸친 오류(묶음 호출 실패·시간 초과)와 관할 없는 오류(실행 실패)는 따로.
     * 예: errorsByStation([{stations:['통영…|고현파출소'],attempt:2},{stations:['통영…|고현파출소'],attempt:1},{stations:[a,b],stage:'call'}])
     *     → {stations:[{key:'통영…|고현파출소', name:'고현파출소', office:'통영해양경찰서', errors:[시도1, 시도2]}], shared:[{…call}]}
     * @param {Object[]} errs @returns {Object} {stations, shared} [연계] ← drawRunErrors · 시험
     */
    function errorsByStation(errs) {
        var by = {}, stations = [], shared = [];
        errs.forEach(function (e) {
            var ks = Array.isArray(e.stations) ? e.stations : [];
            if (ks.length !== 1) { shared.push(e); return; }
            if (!by[ks[0]]) { var so = stationOf(ks[0]); by[ks[0]] = { key: ks[0], name: so.name, office: so.office, errors: [] }; stations.push(by[ks[0]]); }
            by[ks[0]].errors.push(e);
        });
        stations.forEach(function (s) { s.errors.sort(function (a, b) { return (Number(a.attempt) || 0) - (Number(b.attempt) || 0); }); });
        stations.sort(function (a, b) { return a.office === b.office ? a.name.localeCompare(b.name, 'ko') : a.office.localeCompare(b.office, 'ko'); });
        return { stations: stations, shared: shared };
    }
    /**
     * 오류 카드 하나(§11.10.50 — 종전 두 칸) — 오른쪽 세그먼트 탭 2개: 「처리 안 된 오류(빨간 수)」(drawOpenErrors, 기본) / 「실행별」(drawRunErrors).
     * 고른 탭은 ui.errTab 에 남겨 상태를 다시 그려도(진행 끝·새로고침) 그대로 둔다. 정시 판 기록 줄을 누르면 show('run', 그 실행 시각).
     * 예: drawErrorCard(box, status, refresh) → [처리 안 된 오류 3][실행별] · .show('run', '2026-10-16T17:31:00+09:00') → 실행별 탭 + 그 실행 고름
     * @param {HTMLElement} box - 카드 @param {Object} s - status 응답 @param {Function} refresh - 처리 완료 뒤 상태를 다시 그림 @returns {{show:Function}} [연계] ← drawStatus / → drawOpenErrors·drawRunErrors
     */
    function drawErrorCard(box, s, refresh) {
        box.textContent = '';
        var L = s.errorLog, n = L && !L.unavailable ? (L.open || 0) : 0;
        var ct = elc('div', 'sba-ct'); ct.appendChild(el('span', '', '오류')); box.appendChild(ct);
        var seg = elc('div', 'sba-seg sba-tabs'); seg.setAttribute('role', 'tablist'); seg.setAttribute('aria-label', '오류 보기'); ct.appendChild(seg);
        var panels = {}, tabs = {};
        [['open', '처리 안 된 오류', 'data-sb-open'], ['run', '실행별', 'data-sb-errors']].forEach(function (t) {
            var b = el('button', '', t[1]); b.type = 'button'; b.id = 'sba-tab-' + t[0]; b.setAttribute('role', 'tab'); b.setAttribute('data-sb-err-tab', t[0]); b.setAttribute('aria-controls', 'sba-panel-' + t[0]);
            if (t[0] === 'open' && n) { var nb = elc('span', 'n', String(n)); nb.setAttribute('data-sb-open-badge', ''); b.appendChild(nb); }
            var p = el('div'); p.id = 'sba-panel-' + t[0]; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id); p.setAttribute(t[2], '');
            b.addEventListener('click', function () { select(t[0]); });
            seg.appendChild(b); box.appendChild(p); tabs[t[0]] = b; panels[t[0]] = p;
        });
        drawOpenErrors(panels.open, s, refresh);
        drawRunErrors(panels.run, s);
        /** 탭 하나를 보인다(aria-selected·hidden). */
        function select(k) { ui.errTab = k; Object.keys(tabs).forEach(function (x) { tabs[x].setAttribute('aria-selected', String(x === k)); tabs[x].tabIndex = x === k ? 0 : -1; panels[x].hidden = x !== k; }); }
        select(ui.errTab === 'run' ? 'run' : 'open');
        return { show: function (k, runAt) { if (runAt) { ui.run = runAt; drawRunErrors(panels.run, s); } select(k); box.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
    }
    /**
     * 「실행별」 탭 — 최근 3일 오류를 「실행」마다 드롭다운으로 고르고(기본 = 가장 최근 실행), 고른 실행의 오류만 관할별·시도별 한글 풀이로 보인다.
     * [복사]·[md로 저장]은 고른 실행의 오류만(버튼 아래 작은 글로 밝힌다) — 고른 실행에 오류가 없으면 두 버튼을 숨긴다(§11.10.50 — 종전엔 꺼진 채 보였다).
     * 2026-10-17 사용자 *"최근 3일치에 대해서만 띄우되 … 분석을 돌렸을 때마다 분류 … 드롭다운으로 … 언제 분석이 시작됐고 … 그때 오류 현황을 볼 수 있도록"*
     * 서버 안전 상한으로 지운 것이 있으면(errorsCapped) 그 사실을 한 줄로. 복사가 안 되면(권한·http 등) 보이는 안내로 알린다.
     * 예: 드롭다운 「10-17 18:31 · 관리자 즉시 실행 · 오류 22」 → 「고현파출소 (통영해양경찰서) · 오류 4」 「1번째 시도(ChatGPT) — 입력 자료에 없는 지명 「장승포」」 …
     * @param {HTMLElement} box - 탭 칸 @param {Object} s - status 응답 @returns {void} [연계] ← drawErrorCard / → runGroups·errorsByStation·reasonTexts·errorsMarkdown·saveMarkdown
     */
    function drawRunErrors(box, s) {
        box.textContent = '';
        var errs = Array.isArray(s.errors) ? s.errors : [], keep = s.errorKeep || { days: 3 }, groups = runGroups(errs, s.runs, s.lastRun);
        if (s.errorsCapped) box.appendChild(el('div', 'color:#fbbf24;font-size:0.76rem;margin-bottom:6px;', '보관 상한(' + (s.errorsCapped.cap || keep.cap || '') + '건)을 넘어 오래된 오류 ' + s.errorsCapped.dropped + '건을 지웠습니다(' + at(s.errorsCapped.at) + ').'));
        if (!groups.length) { box.appendChild(el('div', 'color:#94a3b8;font-size:.8rem;', '최근 ' + (keep.days || 3) + '일 동안 실행 기록도 오류도 없습니다.')); return; }
        var sel = elc('select', 'sba-select'); sel.setAttribute('data-sb-err-run', ''); sel.setAttribute('aria-label', '오류를 볼 실행 고르기(최근 ' + (keep.days || 3) + '일)');
        groups.forEach(function (g, i) { var op = el('option', '', runOptionText(g)); op.value = g.at; if (g.at === ui.run || (!ui.run && i === 0)) op.selected = true; sel.appendChild(op); });
        if (!groups.some(function (g) { return g.at === ui.run; })) sel.selectedIndex = 0;
        box.appendChild(sel);
        var head = elc('div', 'sba-acts'); head.style.marginTop = '8px';
        var copy = elc('button', 'sba-btn', '복사'); copy.type = 'button'; copy.setAttribute('data-sb-err-copy', '');
        var save = elc('button', 'sba-btn', 'md로 저장'); save.type = 'button'; save.setAttribute('data-sb-err-md', '');
        var cap = elc('span', 'sba-muted'); cap.setAttribute('data-sb-err-scope', '');
        head.appendChild(save); head.appendChild(copy); head.appendChild(cap); box.appendChild(head);
        var msg = el('div', 'font-size:0.76rem;min-height:1.1em;margin-top:4px;line-height:1.5;'); msg.setAttribute('data-sb-err-msg', ''); msg.setAttribute('aria-live', 'polite'); box.appendChild(msg);
        var view = el('div', 'margin-top:4px;'); view.setAttribute('data-sb-err-list', ''); box.appendChild(view);
        var say = function (ok, t) { msg.style.color = ok === null ? '#94a3b8' : ok ? '#34d399' : '#fca5a5'; msg.textContent = t; };
        var cur = function () { return groups[sel.selectedIndex] || groups[0]; };
        /** 고른 실행의 오류를 그린다. */
        function paint() {
            var g = cur(); view.textContent = ''; say(null, '');
            cap.textContent = '고른 실행(' + at(g.at) + ' · ' + (KIND[g.kind] || g.kind || '실행') + ')의 오류 ' + g.errors.length + '건만 담습니다.';
            head.hidden = !g.errors.length;
            var r = g.run, info = elc('div', 'sba-sub');
            info.textContent = at(g.at) + ' 시작 · ' + (KIND[g.kind] || g.kind || '실행') + (r ? ' · ' + label('method', r.method || '—') + (Number.isFinite(r.ms) ? ' · ' + Math.round(r.ms / 1000) + '초' : '') : '') + ' · 오류 ' + g.errors.length + '건';
            view.appendChild(info);
            if (!g.errors.length) { view.appendChild(el('div', 'color:#6ee7b7;font-size:.8rem;margin-top:6px;', '이 실행에서는 오류가 없었습니다.')); return; }
            var parts = errorsByStation(g.errors);
            parts.shared.forEach(function (e) {
                var d = elc('div', 'sba-errst'), h = elc('div', 'sba-errst-h');
                var ks = Array.isArray(e.stations) ? e.stations : [];
                h.appendChild(elc('span', 'sba-errst-name', ks.length ? '여러 관할 ' + ks.length + '곳' : e.stage === 'run' ? '실행 전체' : '관할 없음'));
                if (ks.length) h.appendChild(elc('span', 'sba-sub', stationsText(ks, 8, true)));
                d.appendChild(h);
                var ol = el('ol'), li = el('li'); li.appendChild(el('b', '', attemptText(e))); li.appendChild(document.createTextNode(' — ' + reasonTexts(e).join(' · '))); doneMark(li, e); ol.appendChild(li); d.appendChild(ol);
                view.appendChild(d);
            });
            parts.stations.forEach(function (st) {
                var d = elc('div', 'sba-errst'), h = elc('div', 'sba-errst-h'); d.setAttribute('data-sb-err-station', st.key);
                h.appendChild(elc('span', 'sba-errst-name', st.name)); if (st.office) h.appendChild(elc('span', 'sba-sub', st.office));
                chip(h, '오류 ' + st.errors.length, 'bad');
                d.appendChild(h);
                var ol = el('ol');
                st.errors.forEach(function (e) {
                    var li = el('li'); li.appendChild(el('b', '', attemptText(e))); li.appendChild(document.createTextNode(' — ' + reasonTexts(e).join(' · '))); li.title = e.reason || '';   // 원래 열쇠는 md·누르고 있기(title)에만
                    doneMark(li, e); ol.appendChild(li);
                });
                d.appendChild(ol); view.appendChild(d);
            });
        }
        sel.addEventListener('change', function () { ui.run = cur().at; paint(); });
        paint();
        copy.addEventListener('click', function () {
            var g = cur();
            copyText(errorsMarkdown(g.errors, Date.now(), keep, g), say, '복사했습니다 — ' + at(g.at) + ' 실행 오류 ' + g.errors.length + '건(마크다운).', '[md로 저장]');
        });
        save.addEventListener('click', function () {
            var g = cur(), now = Date.now();
            saveMarkdown(errorsMarkdown(g.errors, now, keep, g), 'station_briefing_errors_' + kstStamp(Date.parse(g.at) || now, false) + '.md', say, view);
        });
    }
    /** 실행별 화면에서 모든 유형이 처리 완료된 오류(서버 resolved:true — §11.10.48)를 흐리게 하고 「처리 완료」 표시. @param {HTMLElement} li @param {Object} e @returns {void} [연계] ← drawRunErrors */
    function doneMark(li, e) { if (!e || !e.resolved) return; li.className = 'done'; li.appendChild(elc('span', 'sba-done', '처리 완료')); }
    /**
     * 글을 클립보드에 복사한다 — 안 되면 옛 방식(execCommand), 그것도 안 되면 다른 버튼(altName)을 안내한다.
     * @param {string} md @param {Function} say - (ok, 글) @param {string} okMsg @param {string} altName - 실패 때 안내할 버튼 이름 @returns {Promise<void>} [연계] ← drawRunErrors [복사] · drawOpenErrors [누적 복사]
     */
    async function copyText(md, say, okMsg, altName) {
        try {
            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('이 브라우저(또는 http 주소)에서는 클립보드를 쓸 수 없음');
            await navigator.clipboard.writeText(md); say(true, okMsg);
        } catch (e) {
            console.warn('[AI 브리핑 관리] 오류 목록 클립보드 복사 실패 — 옛 방식으로 다시 시도:', e && e.message);
            // 옛 방식(execCommand) — 권한이 막힌 기기용. 그것도 안 되면 파일 저장 버튼을 안내한다.
            var ta = document.createElement('textarea'); ta.value = md; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;'; document.body.appendChild(ta); ta.select();
            var ok = false; try { ok = document.execCommand('copy'); } catch (e2) { console.warn('[AI 브리핑 관리] execCommand 복사 실패:', e2 && e2.message); }
            ta.remove();
            say(ok, ok ? okMsg : '복사하지 못했습니다(' + ((e && e.message) || '클립보드 사용 불가') + ') — ' + altName + '으로 파일을 받으세요.');
        }
    }
    /**
     * 누적 오류 유형 열쇠(서버 station_briefing_errlog.codeFamily·familiesOf 가 만드는 것)의 한글 이름(§11.10.48). 모르는 열쇠는 codeText(값 없는 고정 열쇠 — markup·word:기준·forbidden:… 등).
     * 예: 'shape:sea-sentences' → '해상 분석 문장 수가 3~5문장이 아님' · 'number' → '허용되지 않은 숫자' · '@call:vm:vm 시간초과(#초)' → 'AI 호출 실패(ChatGPT) — vm 시간초과(#초)'
     * @param {string} f @returns {string} [연계] ← drawOpenErrors·cumulativeMarkdown · 시험(서버 유형 열쇠가 모두 풀리는지)
     */
    function familyText(f) {
        var c = String(f || ''), m;
        if ((m = /^shape:(land|sea)-sentences$/.exec(c))) return para(m[1]) + ' 문장 수가 ' + SHAPE.minS + '~' + SHAPE.maxS + '문장이 아님';
        if ((m = /^shape:(land|sea)-too-long$/.exec(c))) return para(m[1]) + '이 ' + SHAPE.maxChars + '자를 넘음';
        var fixed = { 'word:level-need': '단계 말에 「필요」를 붙임', number: '허용되지 않은 숫자(입력 자료에 없거나 (기상) 칸 숫자)', 'number:hangul': '한글 셈말이 결론·근거 줄의 수와 맞지 않음', multiplier: '입력 자료에 없는 배수', place: '입력 자료에 없는 지명',
            level: '단계를 대상 단계보다 높여 씀', 'level-para': '대상 이름 없이 단계 말 사용 — 문단 결론 단계와 다름', 'level-last': '마지막 「따라서」 문장의 단계 말이 결론 단계와 다름', 'level-max': '문단에서 가장 높은 단계 말이 결론 단계와 다름',
            fact: '입력 자료에 없는 말 사용', label: '자료에 없는 따옴표 단계 이름', required: '(옛 검사) 꼭 넣을 말 빠짐', '@deadline': '시간 초과 — 실행 마감에 걸려 규칙 분석으로 넘김', '@validate:': '검사 탈락(이유 없음)' };
        if (fixed[c]) return fixed[c];
        if (c.indexOf('@run:') === 0) return '실행 실패 — ' + c.slice(5);
        if ((m = /^@(call|parse):([^:]*):(.*)$/.exec(c))) return stageName(m[1]) + (PROVIDER[m[2]] ? '(' + PROVIDER[m[2]] + ')' : '') + ' — ' + m[3];
        return codeText(c);
    }
    /**
     * 누적 오류 md(§11.10.48 — 처리 안 된 오류 전부). 서버 내보내기 응답({export:{id, at, groups:[{code, family, ids, count, stations, top, values, first, last}]}, errors})으로 만든다.
     * 절: 머리(내보내기 번호·범위·건수) → 처리 완료 기록 방법(AI 작업자용 — 저장소 파일 config/station_briefing_resolved.json 에 고친 유형 번호를 적으면 머지·배포 뒤 자동 처리 완료)
     *     → 1. 유형별 누적 요약(번호·유형·건수·관할·처음·마지막·많이 나온 값) → 2. 날짜별(날짜 → 실행 → 관할·시도·유형 번호·이유 원문·풀이) → 탈락한 AI 글(rejectedMarkdown).
     * 예: cumulativeMarkdown({export:{id:'E20261115-221034', at:'…', groups:[{code:'G01', family:'shape:sea-sentences', ids:['e1'], count:1, stations:1, top:[['강화파출소',1]], values:[['2',1]], first, last}]}, errors:[{id:'e1', at, edition:'evening', date, stage:'validate', provider:'chatgpt', stations:['인천해양경찰서|강화파출소'], attempt:1, reason:'shape:sea-sentences-2'}]}, ms)
     *     → '# 연안 안전 브리핑 — AI 브리핑 누적 오류(처리 완료 전 전부)\n\n- 내보내기 번호: `E20261115-221034`\n…| G01 | 해상 분석 문장 수가 3~5문장이 아님 `shape:sea-sentences` | 1 | …'
     * @param {Object} data @param {number} nowMs @returns {string} [연계] ← drawOpenErrors [누적 md로 저장]·[누적 복사] · 시험 / → mdCell·familyText·reasonTexts·rejectedMarkdown
     */
    function cumulativeMarkdown(data, nowMs) {
        var exp = (data && data.export) || {}, errs = Array.isArray(data && data.errors) ? data.errors : [], groups = Array.isArray(exp.groups) ? exp.groups : [], cell = mdCell;
        var codesOf = {}; groups.forEach(function (g) { (g.ids || []).forEach(function (id) { (codesOf[id] = codesOf[id] || []).push(g.code); }); });
        var ats = errs.map(function (e) { return String(e.at || ''); }).filter(Boolean).sort(), runs = {}; ats.forEach(function (a) { runs[a] = 1; });
        var d = function (iso) { return String(iso || '').slice(0, 16).replace('T', ' '); };
        var out = ['# 연안 안전 브리핑 — AI 브리핑 누적 오류(처리 완료 전 전부)', '',
            '- 내보내기 번호: `' + exp.id + '`', '- 만든 시각: ' + kstStamp(nowMs, true) + ' KST',
            '- 범위: 처리 완료 전 오류 전부(서버 보관 최대 90일) — ' + (ats.length ? ats[0].slice(0, 10) + ' ~ ' + ats[ats.length - 1].slice(0, 10) : '—'),
            '- 건수: 오류 ' + errs.length + '건 · 유형 ' + groups.length + '개 · 실행 ' + Object.keys(runs).length + '번', '',
            '## 처리 완료 기록 방법 — 이 md 로 코드를 고치는 AI 작업자에게', '',
            '1. 아래 「1. 유형별 누적 요약」의 번호(G01…) 가운데 **실제로 고친 유형만** 고릅니다(고치지 못한 유형은 적지 않습니다).',
            '2. 저장소 파일 `local_server/config/station_briefing_resolved.json` 의 `resolved` 배열 끝에 한 줄을 더해 **고친 코드와 같은 PR** 에 넣습니다(지난 줄은 지우지 않습니다):', '',
            '```json', '{ "export": "' + exp.id + '", "groups": ["G01", "G03"], "note": "무엇을 고쳤는지 한 줄" }', '```', '',
            '3. main 에 머지되어 배포되면 서버가 그 파일을 읽어, **이 md 에 들어 있던** 그 유형 오류를 「처리 완료」로 바꿉니다. 이 md 를 받은 뒤 새로 난 오류와 적지 않은 유형은 그대로 남습니다.',
            '4. 번호를 잘못 적으면 관리자 → AI → AI 브리핑 「오류」 카드의 「처리 안 된 오류」 탭에 알림이 뜹니다.', '',
            '## 1. 유형별 누적 요약', '', '| 번호 | 유형 | 건수 | 관할 | 처음 | 마지막 | 많이 나온 값 |', '|---|---|---|---|---|---|---|'];
        groups.forEach(function (g) {
            // 관할 없는 오류(실행 실패 등)만 든 유형은 「—」(종전 「 (0곳)」 — 2026-11-16 운영 md E20261116-003253 G10)
            var top = !g.stations ? '—' : (g.top || []).map(function (x) { return String(x[0]).replace(/(파출소|출장소)$/, '') + ' ' + x[1]; }).join(' · ') + ((g.stations || 0) > (g.top || []).length ? ' 외' : '') + ' (' + g.stations + '곳)';
            var vals = (g.values || []).map(function (x) { return '「' + x[0] + '」 ' + x[1]; }).join(' · ');
            out.push('| ' + [g.code, familyText(g.family) + ' (' + g.family + ')', g.count, top, d(g.first), d(g.last), vals].map(cell).join(' | ') + ' |');
        });
        out.push('', '## 2. 날짜별 — 최근 날짜부터', '');
        var byDay = {}, days = [];
        errs.forEach(function (e) { var k = String(e.at || '').slice(0, 10) || '—'; if (!byDay[k]) { byDay[k] = {}; days.push(k); } (byDay[k][e.at] = byDay[k][e.at] || []).push(e); });
        days.sort().reverse().forEach(function (k) {
            var rs = byDay[k], n = Object.keys(rs).reduce(function (a, r) { return a + rs[r].length; }, 0);
            out.push('### ' + k + ' — 오류 ' + n + '건', '');
            Object.keys(rs).sort().reverse().forEach(function (r) {
                var list = rs[r], e0 = list[0];
                out.push('#### ' + d(r).slice(11) + ' 시작 · ' + (e0.stage === 'run' ? '실행 실패' : editionText(e0)) + ' — ' + list.length + '건', '', '| 관할 | 시도 | 유형 | 이유(원문) | 풀이 |', '|---|---|---|---|---|');
                list.forEach(function (e) { out.push('| ' + [stationsText(e.stations), attemptText(e), (codesOf[e.id] || []).join(' '), e.reason, reasonTexts(e).join(' · ')].map(cell).join(' | ') + ' |'); });
                out.push('');
            });
        });
        return out.join('\n') + '\n' + rejectedMarkdown(errs, cell, '누적 기록은 처리 안 된 것 중 최근 5,000건');
    }
    /**
     * 「처리 안 된 오류」 탭(§11.10.48 누적 · §11.10.50 모양) — 서버 status.errorLog 요약으로 그린다: 기록 문제(쓰기 실패·읽지 못함·되살림)는 빨간 줄 · 처리 완료 목록 알림·보관 상한 알림
     * → 처리 안 된 오류 수 → 유형 목록(이름 · 관할(없으면 「관할 없음」)·값·처음~마지막 · 오른쪽 건수) → [md로 저장]·[복사](누를 때마다 서버에 내보내기를 만들어 번호가 붙는다 — 0건이면 숨김)
     * → 내보내기(유형마다 남은 수·처리 기록, 남은 유형이 있으면 [남은 N개 완료 처리]).
     * 2026-11-15 사용자 *"md 다운받은 그 내용에 대해서 모두 완료 처리를 할 수 있도록 하여 내역이 더이상 나타나지 않도록"* · *"머지가 되면 해당 부분이 자동으로 완료 처리"* · 버튼도 「둘 다 둠」.
     * 예: errorLog {open:3, families:[{family:'@run:k 실행 실패(#번째): ENOSPC', count:2, stations:0, …}]} → 「실행 실패 — …」 「관할 없음 · 11-15 22:20 ~ 22:30」 [2건]
     * @param {HTMLElement} box - 탭 칸 @param {Object} s - status 응답 @param {Function} refresh - 처리 완료 뒤 상태를 다시 그림 @returns {void} [연계] ← drawErrorCard / → cumulativeMarkdown·saveMarkdown·copyText · POST /error-log/export·/error-log/exports/:id/resolve
     */
    function drawOpenErrors(box, s, refresh) {
        box.textContent = '';
        var L = s.errorLog; if (!L) { box.appendChild(elc('div', 'sba-sub', '누적 오류 정보를 받지 못했습니다.')); return; }
        // 기록 문제는 빨간 줄로 — 못 읽은 것이 「처리 안 된 오류가 없습니다」(초록)처럼 보이지 않게(§11.10.48 검토 ② · CLAUDE.md L-291)
        var red = function (t, mark) { var d = el('div', 'color:#fca5a5;font-size:.78rem;line-height:1.5;margin:4px 0;', t); d.setAttribute(mark, ''); box.appendChild(d); };
        if (L.writeIssue) red('누적 기록 문제 — ' + L.writeIssue.what + ' · ' + at(L.writeIssue.at) + ' · ' + L.writeIssue.reason, 'data-sb-open-write');
        if (L.unavailable) { red('누적 오류 기록을 읽지 못했습니다(' + L.unavailable + ') — 처리 안 된 오류 수를 알 수 없습니다. [↻]로 다시 보세요.', 'data-sb-open-unavailable'); return; }
        if (L.recovered) red('누적 오류 기록 파일이 깨져 ' + at(L.recovered.at) + ' 에 최근 3일 오류로만 되살렸습니다 — 그 전 기록은 서버의 ' + L.recovered.file + ' 에 남아 있습니다(처리 완료 기록도 그 파일에).', 'data-sb-open-recovered');
        (L.issues || []).forEach(function (x) { var d = elc('div', 'sba-warn', '처리 완료 목록 확인 필요 — ' + (x.export ? x.export + ': ' : '') + x.problem + (x.index !== null && x.index !== undefined ? ' (resolved ' + (x.index + 1) + '번째 줄)' : '')); d.setAttribute('data-sb-open-issue', ''); box.appendChild(d); });
        if (L.capped) box.appendChild(elc('div', 'sba-warn', '보관 상한(' + L.capped.cap + '건)을 넘어 오래된 오류 ' + L.capped.dropped + '건을 지웠습니다(' + at(L.capped.at) + ').'));
        var head = elc('div', 'sba-sub'); head.setAttribute('data-sb-open-count', ''); head.style.marginBottom = '2px'; box.appendChild(head);
        var list = el('div'); box.appendChild(list);
        var acts = elc('div', 'sba-acts');
        var save = elc('button', 'sba-btn', '⬇ md로 저장'); save.type = 'button'; save.setAttribute('data-sb-open-md', '');
        var copy = elc('button', 'sba-btn', '⧉ 복사'); copy.type = 'button'; copy.setAttribute('data-sb-open-copy', '');
        acts.appendChild(save); acts.appendChild(copy); acts.appendChild(elc('span', 'sba-muted', '받은 md 로 고쳐 머지하면 고친 유형이 자동으로 처리 완료(md 안 「처리 완료 기록 방법」)')); box.appendChild(acts);
        var msg = el('div', 'font-size:0.76rem;min-height:1.1em;margin-top:4px;line-height:1.5;'); msg.setAttribute('data-sb-open-msg', ''); msg.setAttribute('aria-live', 'polite'); box.appendChild(msg);
        var view = el('div', 'margin-top:4px;'); box.appendChild(view);
        var say = function (ok, t) { msg.style.color = ok === null ? '#94a3b8' : ok ? '#34d399' : '#fca5a5'; msg.textContent = t; };
        if (!L.open) { head.textContent = '처리 안 된 오류가 없습니다.'; head.style.color = '#6ee7b7'; acts.hidden = true; }
        else {
            head.textContent = '처리 안 된 오류 ' + L.open + '건 · 유형 ' + (L.families || []).length + '개 · ' + at(L.since) + '부터(처리 완료 전까지 최대 ' + (L.keepDays || 90) + '일 보관)';
            (L.families || []).forEach(function (f) {
                var d = elc('div', 'sba-eitem'); d.setAttribute('data-sb-open-family', f.family);
                var left = el('div', 'min-width:0;'); left.appendChild(elc('div', 'sba-ename', familyText(f.family)));
                var top = f.top || [], more = (f.stations || 0) - top.length;
                var where = f.stations ? top.map(function (x) { return shortName(x[0]); }).join('·') + (more > 0 ? ' 외 ' + more + '곳' : '') : '관할 없음';
                var vals = (f.values || []).slice(0, 4).map(function (x) { return '「' + x[0] + '」'; }).join(' ');
                var a1 = at(f.first), a2 = at(f.last), when = a1 === a2 ? a1 : a1 + ' ~ ' + (a1.slice(0, 5) === a2.slice(0, 5) ? a2.slice(6) : a2);
                var meta = elc('div', 'sba-emeta', [where, vals ? '값 ' + vals : null, when].filter(Boolean).join(' · ')); meta.setAttribute('data-sb-open-meta', ''); left.appendChild(meta);
                d.appendChild(left); d.appendChild(elc('span', 'sba-cnt', f.count + '건'));
                list.appendChild(d);
            });
        }
        var exportNow = async function (mode) {
            save.disabled = copy.disabled = true; say(null, '처리 안 된 오류를 모으는 중…');
            try {
                var r = await call('/error-log/export', { method: 'POST' });
                if (r.status === 404) { say(true, '처리 안 된 오류가 없습니다.'); return; }
                if (r.status !== 200 || !r.body.export) throw new Error(r.body.error || ('HTTP ' + r.status));
                var md = cumulativeMarkdown(r.body, Date.now()), id = r.body.export.id;
                if (mode === 'copy') await copyText(md, say, '복사했습니다 — 내보내기 ' + id + ' · 오류 ' + r.body.errors.length + '건(마크다운). 아래 내보내기 줄은 [↻] 뒤에 보입니다.', '[md로 저장]');
                else await saveMarkdown(md, 'station_briefing_open_errors_' + id + '.md', say, view);
            } catch (e) { console.warn('[AI 브리핑 관리] 누적 오류 내보내기 실패:', e && e.message); say(false, '누적 오류를 내보내지 못했습니다: ' + ((e && e.message) || '알 수 없음')); }
            finally { save.disabled = copy.disabled = false; }
        };
        save.addEventListener('click', function () { exportNow('save'); });
        copy.addEventListener('click', function () { exportNow('copy'); });
        // 내보내기 — 남은 것이 있는 것은 모두, 끝난 것은 최근 5개(서버 summary)
        (Array.isArray(L.exports) ? L.exports : []).forEach(function (x, i) {
            var left = (x.groups || []).filter(function (g) { return !g.resolved && g.open > 0; }), n = x.openErrors || 0;
            var row = elc('div', 'sba-expbox'); row.setAttribute('data-sb-export', x.id);
            var d = elc('details', 'sba-exp');
            var sm = el('summary', '', (i === 0 ? '최근 내보내기 ' : '내보내기 ')); sm.appendChild(el('b', '', x.id)); sm.appendChild(document.createTextNode(' · ' + at(x.at) + ' · 유형 ' + (x.groups || []).length + '개 · ' + (left.length ? '남은 유형 ' + left.length : '모두 처리 완료')));
            d.appendChild(sm);
            var ul = el('ul', 'margin:6px 0 0;padding-left:16px;');
            (x.groups || []).forEach(function (g) {
                // 지워진 것(보관 90일·상한 — gone)은 「다른 내보내기로 처리」라고 하지 않는다(§11.10.48 검토 ⑥)
                var how = g.resolved ? '처리 완료(' + (g.resolved.by === 'merge' ? '머지' : '버튼') + ' ' + at(g.resolved.at) + (g.resolved.note ? ' — ' + g.resolved.note : '') + ')'
                    : g.open > 0 ? '남음 ' + g.open + '건' + (g.gone ? ' · 보관 기간·상한으로 지워짐 ' + g.gone + '건' : '')
                    : g.gone >= g.count ? '보관 기간·상한으로 모두 지워짐' : '다른 내보내기로 처리 완료' + (g.gone ? ' · 지워짐 ' + g.gone + '건' : '');
                ul.appendChild(el('li', '', g.code + ' ' + familyText(g.family) + ' — ' + g.count + '건 · ' + how));
            });
            d.appendChild(ul); row.appendChild(d);
            if (left.length) {
                var b = elc('button', 'sba-btn', '남은 ' + left.length + '개 완료 처리'); b.type = 'button'; b.setAttribute('data-sb-export-resolve', x.id);
                b.addEventListener('click', async function () {
                    if (!w.confirm(x.id + ' 의 남은 유형 ' + left.length + '개(오류 ' + n + '건)를 처리 완료로 바꿉니다. 처리 안 된 오류 목록·누적 md 에 더 나오지 않습니다(되돌릴 수 없음).')) return;
                    b.disabled = true; say(null, '처리 완료로 바꾸는 중…');
                    try {
                        var r = await call('/error-log/exports/' + encodeURIComponent(x.id) + '/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
                        if (r.status !== 200) throw new Error(r.body.error || ('HTTP ' + r.status));
                        refresh();
                    } catch (e) { console.warn('[AI 브리핑 관리] 처리 완료 실패:', e && e.message); b.disabled = false; say(false, '처리 완료로 바꾸지 못했습니다: ' + ((e && e.message) || '알 수 없음')); }
                });
                row.appendChild(b);
            }
            box.appendChild(row);
        });
    }
    /** 앱 안(Capacitor 네이티브)인가. 예: 안드로이드 앱 → true · PC 브라우저 → false. @returns {boolean} [연계] ← saveMarkdown */
    function isNativeApp() { return !!(w.Capacitor && typeof w.Capacitor.isNativePlatform === 'function' && w.Capacitor.isNativePlatform()); }
    /**
     * md 글을 파일로 저장한다(§11.10.7 D — 사용자 *"마크 다운으로 저장을 눌렀는데 실질적으로 저장이 휴대폰에 안 되는 것 같은데 … 로직을 확인"*).
     * 원인(코드로 확인): 휴대폰 앱은 Capacitor 안드로이드 WebView(capacitor.config.json server.url)이고, MainActivity·Capacitor 어디에도 WebView 내려받기 처리(setDownloadListener)가 없어
     *   <a download>(blob 주소) 누름이 아무 일도 하지 않는다 — 그런데 종전 코드는 그 뒤 곧바로 「저장했습니다」라고 적었다.
     * 고친 것: 앱 안이면 저장소에서 이미 쓰는 방식(admin_collect.js CSV·PNG 저장 — 서버에 잠깐 맡기고 → 한 번 쓰는 열쇠 → @capacitor/browser 로 시스템 브라우저가 내려받기).
     *   그것도 안 되면 글을 화면에 띄워 길게 눌러 복사하게 하고 그대로 알린다. 브라우저(PC·휴대폰 브라우저)는 종전 <a download>.
     * 예: saveMarkdown('# …', 'station_briefing_errors_20261017_1831.md', say, view) → (앱) 브라우저가 열리며 내려받기 · (PC) 다운로드 시작
     * @param {string} text @param {string} name - 파일 이름 @param {Function} say - (ok, 글) 안내 @param {HTMLElement} view - 대체로 글을 띄울 곳 @returns {Promise<void>}
     * [연계] ← drawRunErrors [md로 저장] / → POST /api/admin/station-briefing/download · window.Capacitor.Plugins.Browser.open
     */
    async function saveMarkdown(text, name, say, view) {
        if (isNativeApp()) {
            var Browser = w.Capacitor.Plugins && w.Capacitor.Plugins.Browser;
            if (!Browser || typeof Browser.open !== 'function') { showText(view, text); say(false, '이 앱 화면에서는 파일로 바로 저장할 수 없습니다(앱이 내려받기를 받지 않음) — 아래 글을 길게 눌러 전체 선택 → 복사하거나 [복사]를 쓰세요.'); return; }
            say(null, '파일을 준비하는 중…');
            try {
                // 글 그대로(text/markdown) 보낸다 — 누적 md(§11.10.48)는 5MB 를 넘을 수 있는데 JSON 은 서버 전역 상한 5MB 에 막힌다
                var r = await call('/download?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': 'text/markdown; charset=utf-8' }, body: text });
                if (r.status !== 200 || !r.body.path) throw new Error(r.body.error || ('HTTP ' + r.status));
                await Browser.open({ url: w.location.origin + r.body.path });
                say(true, '휴대폰 브라우저를 열어 파일(' + name + ')을 내려받게 했습니다 — 받은 파일은 「다운로드」 폴더(알림창)에 있습니다. 브라우저에서 받지 못했으면 [복사]를 쓰세요(링크는 5분·한 번만 유효).');
            } catch (e) {
                console.warn('[AI 브리핑 관리] 앱 안 md 저장(브라우저 내려받기) 실패:', e && e.message);
                showText(view, text); say(false, '파일로 저장하지 못했습니다(' + ((e && e.message) || '알 수 없음') + ') — 아래 글을 길게 눌러 전체 선택 → 복사하거나 [복사]를 쓰세요.');
            }
            return;
        }
        try {
            var url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
            var a = document.createElement('a'); a.href = url; a.download = name; a.setAttribute('data-sb-err-download', '');
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            say(true, '내려받기를 시작했습니다 — ' + name + ' (브라우저의 다운로드 목록에서 확인하세요).');
        } catch (e) { console.warn('[AI 브리핑 관리] 오류 목록 md 저장 실패:', e && e.message); showText(view, text); say(false, 'md 파일을 만들지 못했습니다(' + (e && e.message) + ') — 아래 글을 복사하세요.'); }
    }
    /** 저장이 안 될 때 md 글을 읽기 전용 글상자로 띄운다(길게 눌러 복사). 예: showText(view, '# …'). @param {HTMLElement} view @param {string} text @returns {void} [연계] ← saveMarkdown */
    function showText(view, text) {
        // 아주 큰 글(누적 md — 수 MB)은 글상자에 띄우지 않는다(§11.10.48 검토 ⑭ — 휴대폰 WebView 가 감당하기 어렵다). PC 브라우저에서 받게 안내.
        if (String(text).length > 1000000) { var old0 = view.querySelector('[data-sb-err-text]'); if (old0) old0.remove(); var n0 = el('div', 'color:#fca5a5;font-size:.76rem;margin-top:6px;', '글이 너무 커서(' + Math.round(String(text).length / 1000) + '천 자) 화면에 띄우지 않습니다 — PC 브라우저의 관리자 화면에서 받으세요.'); n0.setAttribute('data-sb-err-text', ''); view.insertBefore(n0, view.firstChild); return; }
        var old = view.querySelector('[data-sb-err-text]'); if (old) old.remove();
        var ta = elc('textarea', 'sba-mdview'); ta.readOnly = true; ta.value = text; ta.setAttribute('data-sb-err-text', ''); ta.setAttribute('aria-label', '오류 마크다운 글');
        view.insertBefore(ta, view.firstChild);
    }
    /**
     * 관할 하나 미리보기(접힘 카드 — 기본 접힘, §11.10.50) — 관할 목록(경찰서별 묶음)·날짜(자동·오늘·내일)를 골라 사용자 화면과 같은 렌더러로 그린다. 노출 범위와 무관(관리자 경로).
     * 공개 시각 전의 판(§11.10.4)이 있으면 그 판을 보인다(서버 preview 가 pending·publishAt 을 준다). 관할 목록은 접힌 동안에도 미리 받아 둔다.
     * 예: 한림파출소 · 자동 → GET /api/admin/station-briefing/preview?station=…&day=auto → StationBriefingRender.render(…, {links:false})
     * @param {HTMLElement} box @returns {Promise<void>} [연계] ← renderStationBriefingAdmin / → StationBriefingRender.render
     */
    async function drawPreview(box) {
        box.textContent = '';
        var acc = collapsible(box, '관할 하나 미리보기', '', 'data-sb-preview-toggle'); acc.sum.textContent = '관할을 골라 사용자 화면 그대로 보기';
        var bar = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;');
        var sel = el('select', 'flex:1 1 200px;min-width:0;padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:#0f1b33;color:#fff;font-size:0.8rem;'); sel.setAttribute('data-sb-preview-station', '');
        var day = el('select', 'padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:#0f1b33;color:#fff;font-size:0.8rem;');
        [['auto', '자동(21시부터 내일)'], ['today', '오늘'], ['tomorrow', '내일']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; day.appendChild(op); });
        var go = elc('button', 'sba-btn primary', '보기'); go.type = 'button'; go.setAttribute('data-sb-preview-go', '');
        bar.appendChild(sel); bar.appendChild(day); bar.appendChild(go); acc.body.appendChild(bar);
        var out = el('div', 'margin-top:10px;'); out.className = 'sb-wrap'; out.style.marginTop = '10px'; out.setAttribute('data-sb-preview-out', ''); acc.body.appendChild(out);
        var r = await call('/stations');
        var list = r.status === 200 && Array.isArray(r.body.stations) ? r.body.stations : [];
        var group = null, office = null;
        list.forEach(function (s) {
            if (s.office !== office) { group = el('optgroup'); group.label = s.office; sel.appendChild(group); office = s.office; }
            var op = el('option', '', s.name + (s.seaOnly ? ' (해상만)' : '')); op.value = s.key; group.appendChild(op);
        });
        if (!list.length) { out.appendChild(el('div', 'color:#fca5a5;font-size:0.8rem;', '관할 목록을 불러오지 못했습니다(' + r.status + ').')); go.disabled = true; return; }
        go.addEventListener('click', async function () {
            out.textContent = '불러오는 중…';
            var p = await call('/preview?station=' + encodeURIComponent(sel.value) + '&day=' + encodeURIComponent(day.value));
            if (p.status !== 200) { out.textContent = '미리보기를 불러오지 못했습니다: ' + (p.body.error || ('HTTP ' + p.status)); return; }
            if (w.StationBriefingRender) w.StationBriefingRender.render(out, p.body, { links: false });
            else out.textContent = '브리핑 렌더러(station_briefing_render.js)가 로드되지 않았습니다.';
        });
    }
    w.renderStationBriefingAdmin = renderStationBriefingAdmin;
    // 시험용(test_station_briefing.js 가 vm 으로 읽어 순수 함수만 본다 — 마크다운 이스케이프·오류 풀이·실행 묶기·관할 묶기)
    renderStationBriefingAdmin.errorsMarkdown = errorsMarkdown;
    renderStationBriefingAdmin.cumulativeMarkdown = cumulativeMarkdown;   // §11.10.48 누적 오류 md
    renderStationBriefingAdmin.familyText = familyText;
    renderStationBriefingAdmin.codeText = codeText;
    renderStationBriefingAdmin.reasonTexts = reasonTexts;
    renderStationBriefingAdmin.runGroups = runGroups;
    renderStationBriefingAdmin.errorsByStation = errorsByStation;
    renderStationBriefingAdmin.SHAPE = SHAPE;
    renderStationBriefingAdmin.mmss = mmss;   // §11.10.21 정시 판 소요 표
    renderStationBriefingAdmin.providersText = providersText;   // §11.10.50 「쓴 AI」
})(window);
