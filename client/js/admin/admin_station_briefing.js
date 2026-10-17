/**
 * ============================================================================
 * 파일명: client/js/admin/admin_station_briefing.js
 * 역할  : 통합관리자 → AI 탭 → 하위 탭 「AI 브리핑」(설계서 §11.6 결정 16·17) — 연안 안전 브리핑(종전 「활동지점 안전 브리핑」 — §11.10.4)의
 *         생성 방식(ChatGPT VM / Gemini / 규칙 분석만)·모델·노출 범위(사용자에게 / 관리자에게만 / 노출 안 함)·묶음 단위·「바뀐 곳만 다시 만들기」를 고르고,
 *         상태 카드(실행 중·대기 표시 · 마지막 실행 · 판별 AI/다시 시도/규칙 분석/오류 수 · 공개 예정 · 다음 예정)와 실행 중 진행 게이지(전체 막대 + 묶음별·관할별 — §11.10.7),
 *         상태 카드 안 「관광지 자료 확인 불가」(판별 N관할 · 관광지 M곳, 0이면 「없음」, 펼치면 이름)와 정시 판 소요 시간 작은 표(최근 6회 — 시작·분:초·결과·마감, §11.10.21),
 *         최근 3일 오류를 실행마다 드롭다운으로 골라 관할별·시도별 한글 풀이로 보고 [복사]·[md로 저장](고른 실행만 — 앱 안에서는 시스템 브라우저로 내려받기)을 하고,
 *         [지금 다시 만들기](곧바로 공개 · 실행 중이면 409 안내)와 관할 하나 미리보기(공개 예정 판은 「예정」)를 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js(window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부 · switchAiSubTab 이 나를 부름)
 *                    · forecast/station-briefing/station_briefing_render.js(StationBriefingRender.render — 미리보기는 사용자 화면과 같은 렌더러)
 *                    · @capacitor/browser(window.Capacitor.Plugins.Browser — 앱 안에서 md 를 시스템 브라우저로 내려받기, admin_collect.js CSV·PNG 저장과 같은 방식)
 *  - 서버 API      : GET·PUT /api/admin/station-briefing/config · GET /api/admin/station-briefing/status(?only=progress — 진행 게이지) · POST /api/admin/station-briefing/run(실행 중 409)
 *                    · GET /api/admin/station-briefing/stations · GET /api/admin/station-briefing/preview · POST /api/admin/station-briefing/download → GET /api/station-briefing/download/:token
 *                    (routes/station_briefing.js)
 *  - 마크업        : 관리자 센터 모달 #ai-subtab-body(admin.js renderUnifiedAiTab 이 만듦) — 이 파일이 안을 통째로 만든다(스타일은 <style id="sb-admin-style"> 를 한 번 심는다)
 *  - 나를 쓰는 곳  : admin.js switchAiSubTab('briefing') → window.renderStationBriefingAdmin
 * [로드 순서] admin/admin_data_status.js 다음 · admin/admin_collect.js 이전(호출은 사용자가 하위 탭을 누를 때)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var API = '/api/admin/station-briefing';
    // 선택지 이름표 — [큰 글, 작은 설명]. 모델은 AI 챗봇 「답변 AI 모델」 버튼(ai-chat/ai_chat.js)과 같은 이름. 서버 choices 에 없는 값은 그리지 않는다.
    // 방식 설명은 §11.10.4 다시 시도 순서(VM 최대 3번 → Gemini → 규칙 분석 · 방식 Gemini 는 Gemini 2번 → 규칙 분석)와 같다.
    var LABELS = {
        method: { chatgpt: ['ChatGPT', 'VM 최대 3번 → Gemini → 규칙 분석'], gemini: ['Gemini', '2번 → 규칙 분석'], template: ['규칙 분석만', 'AI 없음'] },
        chatgptModel: { 'gpt-6-luna': ['GPT Luna'], 'gpt-6-sol': ['GPT Sol'], 'gpt-6-astra': ['GPT Astra'] },
        geminiModel: { 'gemini-2.5-flash': ['Gemini 2.5 Flash'], 'gemini-2.5-flash-lite': ['Gemini 2.5 Flash-Lite'] },
        exposure: { user: ['사용자에게'], admin: ['관리자에게만'], off: ['노출 안 함'] },
        batchUnit: { station: ['파출소', '97회/판'], office: ['해양경찰서', '21회/판'], region: ['지방청', '5회/판'] },
        onlyChanged: { 'true': ['켜기', '입력이 같으면 지난 분석 재사용'], 'false': ['끄기', '매번 새로'] },
    };
    // 칸 이름 — [이름, 작은 설명]. onlyChanged 단서(2단계 검토 B13): 재사용 해시에 기상청 해상 전망(kma)이 들어 있어(station_briefing_ai.generate), 전망이 바뀌면 모든 관할의 해시가 바뀐다.
    var TITLES = { method: ['생성 방식'], chatgptModel: ['ChatGPT 모델'], geminiModel: ['Gemini 모델'], exposure: ['노출 범위'], batchUnit: ['묶음 단위', 'AI 호출 한 번에 묶는 관할'], onlyChanged: ['바뀐 곳만 다시 만들기', 'AI 분석을 입력이 바뀐 관할만 새로 씀 · 기상청 해상 전망이 바뀌면 전 관할을 다시 씁니다'] };
    var KIND = { morning: '07:30 판', evening: '17:30 판', night: '23:00 판', warning: '특보 변경 판', manual: '관리자 즉시 실행', failure: '실행 실패' };
    var PROVIDER = { vm: 'ChatGPT', chatgpt: 'ChatGPT', gemini: 'Gemini' };
    var LEVEL = ['없음', '관심', '주의', '경계'];
    // 서버 station_briefing_ai 의 MIN_S·MAX_S·MAX_CHARS 와 같은 값(시험 test_station_briefing.js 가 같은지 본다) — 오류 풀이 글에만 쓴다.
    var SHAPE = { minS: 3, maxS: 5, maxChars: 420 };
    // 정시 판 일정(KST 분) — 서버 station_briefing_rules.EDITIONS 와 같은 표(2026-10-17 §11.10.4): 만들기 시작 start → 공개 pub
    var SLOTS = [{ start: 430, pub: 450 }, { start: 1030, pub: 1050 }, { start: 1360, pub: 1380 }];
    var POLL_MS = 2500;
    // 화면에 남겨 둘 고른 값 — 진행 게이지가 다시 그려도(2.5초마다) 사용자가 고른 묶음·실행을 잃지 않게
    var ui = { batch: null, run: null, poll: null };

    /** 요소 하나(글은 textContent). 예: el('div','', '저장됨'). @returns {HTMLElement} [연계] ← 이 파일 */
    function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
    /** 요소 하나 + class. 예: elc('span','sba-chip','AI 77'). @returns {HTMLElement} [연계] ← 이 파일 */
    function elc(tag, cls, text) { var e = el(tag, '', text); e.className = cls; return e; }
    /** KST 시각 글자. 예: '2026-10-17T08:00:12+09:00' → '10-17 08:00'. @param {string} iso @returns {string} */
    function at(iso) { var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? m[1] + '-' + m[2] + ' ' + m[3] + ':' + m[4] : '—'; }
    /** 이름표 [큰 글, 작은 설명] 중 큰 글. 예: label('batchUnit','office') → '해양경찰서'. @returns {string} [연계] ← drawConfig·drawStatus */
    function label(field, v) { var x = (LABELS[field] || {})[String(v)]; return x ? x[0] : String(v); }
    /** 이름표 한 줄 글. 예: fullLabel('onlyChanged','false') → '끄기(매번 새로)'. @returns {string} [연계] ← drawConfig 저장 안내 */
    function fullLabel(field, v) { var x = (LABELS[field] || {})[String(v)]; return x ? x[0] + (x[1] ? '(' + x[1] + ')' : '') : String(v); }
    /**
     * 다음 정시 판 — 공개 시각과 만들기 시작 시각(KST — SLOTS, 서버 EDITIONS 와 같은 표). 이미 만들기 시작한 판(시작 ≤ 지금 < 공개)이면 그 판.
     * 예: 10-17 14:05 KST → '10-17 17:30 공개(17:10부터 만들기)' · 17:20 → '10-17 17:30 공개(17:10부터 만들기)' · 23:10 → '10-18 07:30 공개(07:10부터 만들기)'
     * @param {number} nowMs @returns {string} [연계] ← 상태 칸 「다음 예정」
     */
    function nextEdition(nowMs) {
        var k = new Date(nowMs + 9 * 3600000), mins = k.getUTCHours() * 60 + k.getUTCMinutes(), day = 0, pick = null;
        for (var i = 0; i < SLOTS.length; i++) if (SLOTS[i].pub > mins) { pick = SLOTS[i]; break; }
        if (pick === null) { pick = SLOTS[0]; day = 1; }
        var d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + day)), hm = function (x) { return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
        return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + ' ' + hm(pick.pub) + ' 공개(' + hm(pick.start) + '부터 만들기)';
    }
    /** JSON 요청(관리자 토큰은 admin.js 래퍼가 붙인다). 실패면 {status, error}. @returns {Promise<{status:number, body:Object}>} */
    async function call(path, init) {
        var r = await fetch(API + path, Object.assign({ cache: 'no-store' }, init || {}));
        var body = null; try { body = await r.json(); } catch (e) { body = null; console.warn('[AI 브리핑 관리] 응답이 JSON 이 아님 — ' + path + ' HTTP ' + r.status + ':', e && e.message); }
        return { status: r.status, body: body || {} };
    }
    /**
     * 이 탭의 스타일을 한 번 심는다(관리자 화면은 어두운 바탕만 있다 — style.css 에 밝은 테마 규칙이 없음을 확인함, 2026-10-17).
     * 2026-10-17 사용자 *"텍스트가 배경 색상이 조금 어둡다 보니까 … 눈에 잘 띄지 않거든 생성 방식, GPT 모델, 제미나이 모델 이런 부분 … 흰색으로"* — 칸 이름은 흰색·굵게, 고른 버튼은 진한 청록 바탕 + 흰 글 + ✓.
     * 예: ensureStyle() → <style id="sb-admin-style"> 가 없으면 head 에 붙인다. @returns {void} [연계] ← renderStationBriefingAdmin
     */
    function ensureStyle() {
        if (document.getElementById('sb-admin-style')) return;
        var s = document.createElement('style'); s.id = 'sb-admin-style';
        s.textContent = [
            '[data-sb-admin] .sba-box{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:12px;margin-bottom:12px;}',
            '[data-sb-admin] .sba-h{font-size:.92rem;font-weight:700;color:#f8fafc;margin:0 0 10px;}',
            '[data-sb-admin] .sba-field{margin-bottom:12px;}',
            '[data-sb-admin] .sba-label{color:#f8fafc;font-size:.82rem;font-weight:600;margin-bottom:6px;line-height:1.35;}',
            '[data-sb-admin] .sba-hint{display:block;color:#94a3b8;font-weight:400;font-size:.72rem;margin-top:1px;}',
            '[data-sb-admin] .sba-seg{display:flex;flex-wrap:wrap;gap:6px;}',
            '[data-sb-admin] .sba-pill{padding:6px 11px;min-height:34px;border-radius:999px;font-size:.8rem;font-weight:600;cursor:pointer;line-height:1.2;text-align:left;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.05);color:#e2e8f0;max-width:100%;}',
            '[data-sb-admin] .sba-pill small{display:block;font-size:.68rem;font-weight:400;color:#94a3b8;margin-top:1px;}',
            '[data-sb-admin] .sba-pill[aria-pressed="true"]{background:#0e7490;border-color:#67e8f9;color:#fff;}',
            '[data-sb-admin] .sba-pill[aria-pressed="true"] small{color:#cffafe;}',
            '[data-sb-admin] .sba-pill[aria-pressed="true"]::before{content:"✓ ";}',
            '[data-sb-admin] .sba-pill:focus-visible{outline:2px solid #fbbf24;outline-offset:2px;}',
            '[data-sb-admin] .sba-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;}',
            '[data-sb-admin] .sba-state{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:.78rem;font-weight:700;}',
            '[data-sb-admin] .sba-state.on{background:rgba(59,130,246,.2);color:#bfdbfe;border:1px solid rgba(96,165,250,.6);}',
            '[data-sb-admin] .sba-state.idle{background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(148,163,184,.35);}',
            '[data-sb-admin] .sba-dot{width:8px;height:8px;border-radius:50%;background:currentColor;}',
            '[data-sb-admin] .sba-state.on .sba-dot,[data-sb-admin] .sba-st-running .sba-dot{animation:sbaPulse 1.2s ease-in-out infinite;}',
            '@keyframes sbaPulse{0%,100%{opacity:1}50%{opacity:.25}}',
            '@media (prefers-reduced-motion: reduce){[data-sb-admin] .sba-dot{animation:none !important;}}',
            '[data-sb-admin] .sba-k{color:#94a3b8;font-size:.74rem;margin-top:10px;margin-bottom:3px;}',
            '[data-sb-admin] .sba-main{color:#f1f5f9;font-size:.86rem;font-weight:600;}',
            '[data-sb-admin] .sba-sub{color:#94a3b8;font-size:.75rem;line-height:1.5;}',
            '[data-sb-admin] .sba-chip{display:inline-block;padding:2px 8px;border-radius:7px;font-size:.74rem;font-weight:600;background:rgba(255,255,255,.07);color:#e2e8f0;border:1px solid rgba(255,255,255,.12);}',
            '[data-sb-admin] .sba-chip.ok{background:rgba(16,185,129,.16);color:#6ee7b7;border-color:rgba(16,185,129,.4);}',
            '[data-sb-admin] .sba-chip.warn{background:rgba(245,158,11,.16);color:#fcd34d;border-color:rgba(245,158,11,.45);}',
            '[data-sb-admin] .sba-chip.bad{background:rgba(239,68,68,.16);color:#fca5a5;border-color:rgba(239,68,68,.45);}',
            '[data-sb-admin] .sba-chip.info{background:rgba(59,130,246,.16);color:#bfdbfe;border-color:rgba(96,165,250,.45);}',
            '[data-sb-admin] .sba-btn{padding:8px 14px;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#f1f5f9;}',
            '[data-sb-admin] .sba-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff;}',
            '[data-sb-admin] .sba-btn:disabled{opacity:.45;cursor:default;}',
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
            // 오류 — 실행 고르기·관할별 묶음
            '[data-sb-admin] .sba-select{width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0f1b33;color:#fff;font-size:.8rem;}',
            '[data-sb-admin] .sba-errst{border-top:1px solid rgba(255,255,255,.08);padding:8px 0 6px;}',
            '[data-sb-admin] .sba-errst-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;}',
            '[data-sb-admin] .sba-errst-name{color:#f8fafc;font-weight:700;font-size:.84rem;}',
            '[data-sb-admin] .sba-errst ol{margin:4px 0 0;padding-left:0;list-style:none;}',
            '[data-sb-admin] .sba-errst li{color:#e2e8f0;font-size:.78rem;line-height:1.5;padding:3px 0 3px 10px;border-left:2px solid rgba(248,113,113,.5);margin-top:3px;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-errst li b{color:#fda4af;font-weight:700;}',
            // §11.10.21 관광지 자료 확인 불가(펼침 목록) · 정시 판 소요 표(360px 에서 넘치지 않게 고정 칸·줄바꿈)
            '[data-sb-admin] .sba-sf summary{cursor:pointer;color:#fcd34d;font-size:.84rem;font-weight:600;line-height:1.45;}',
            '[data-sb-admin] .sba-sf ul{margin:4px 0 0;padding-left:16px;}',
            '[data-sb-admin] .sba-sf li{color:#e2e8f0;font-size:.76rem;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-tt{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:4px;font-size:.72rem;}',
            '[data-sb-admin] .sba-tt th{color:#94a3b8;font-weight:600;text-align:left;padding:4px 3px;border-bottom:1px solid rgba(255,255,255,.14);}',
            '[data-sb-admin] .sba-tt td{color:#e2e8f0;padding:5px 3px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere;}',
            '[data-sb-admin] .sba-tt td small{display:block;color:#94a3b8;font-size:.66rem;}',
            '[data-sb-admin] .sba-tt td.bad{color:#fca5a5;font-weight:700;}',
            '[data-sb-admin] .sba-mdview{width:100%;min-height:180px;margin-top:6px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#0b1426;color:#e2e8f0;font-size:.72rem;font-family:monospace;}',
        ].join('\n');
        document.head.appendChild(s);
    }

    /**
     * AI 브리핑 하위 탭을 그린다.
     * 예: renderStationBriefingAdmin(document.getElementById('ai-subtab-body'))
     * @param {HTMLElement} container @returns {Promise<void>}
     * [연계] ← admin.js switchAiSubTab('briefing') / → drawConfig·drawStatus·drawPreview
     */
    async function renderStationBriefingAdmin(container) {
        ensureStyle();
        container.textContent = '';
        var host = el('div'); host.setAttribute('data-sb-admin', ''); container.appendChild(host);
        var title = el('div'); title.className = 'admin-section-title'; var ts = el('span'); var ic = el('i'); ic.className = 'fa-solid fa-compass'; ic.style.color = '#22d3ee'; ts.appendChild(ic); ts.appendChild(document.createTextNode(' AI 브리핑 — 연안 안전 브리핑')); title.appendChild(ts); host.appendChild(title);
        host.appendChild(el('div', 'color:#94a3b8;font-size:0.78rem;margin-bottom:10px;line-height:1.5;', '파출소 관할 97곳의 브리핑을 07:30·17:30·23:00 에 보이도록 각 20분 전(07:10·17:10·22:40)부터 만들어 두고, 특보가 바뀌면 그 관할을 곧바로 다시 만듭니다. AI 는 결론 아래 연안·해상 분석 문단(각 3~5문장)만 쓰고(VM 최대 3번 → Gemini → 그래도 안 되면 서버 규칙 분석), 결론·근거·권고·단계·카드는 서버 규칙입니다. 바꾼 값은 누르는 즉시 저장됩니다.'));
        var cfgBox = elc('div', 'sba-box'); cfgBox.setAttribute('data-sb-config', ''); host.appendChild(cfgBox);
        var stBox = elc('div', 'sba-box'); stBox.setAttribute('data-sb-status', ''); host.appendChild(stBox);
        var pvBox = elc('div', 'sba-box'); pvBox.setAttribute('data-sb-preview', ''); host.appendChild(pvBox);
        var cfg = await call('/config');
        if (cfg.status !== 200 || !cfg.body.config) { cfgBox.appendChild(el('div', 'color:#fca5a5;font-size:0.82rem;', '설정을 불러오지 못했습니다(' + cfg.status + '). 관리자 로그인이 필요할 수 있습니다.')); return; }
        drawConfig(cfgBox, cfg.body.config, cfg.body.choices || {});
        drawStatus(stBox);
        drawPreview(pvBox);
    }
    /**
     * 설정 칸(생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만). 버튼을 누르면 PUT 으로 그 칸만 보내고, 성공하면 버튼 상태를 바꾼다(실패면 이유).
     * 모델 줄은 방식에 따라 흐리게(규칙 분석만이면 둘 다, Gemini 면 ChatGPT 모델). 칸 이름은 흰색·굵게, 고른 버튼은 진한 청록 + ✓(§11.10.7 F).
     * 예: [관리자에게만] → PUT {exposure:'admin'} → 「저장됨 — 노출 범위: 관리자에게만」
     * @param {HTMLElement} box @param {Object} config @param {Object} choices @returns {void} [연계] ← renderStationBriefingAdmin
     */
    function drawConfig(box, config, choices) {
        box.textContent = '';
        box.appendChild(elc('div', 'sba-h', '설정'));
        var msg = el('div', 'font-size:0.78rem;min-height:1.2em;margin-top:2px;color:#94a3b8;'); msg.setAttribute('data-sb-msg', ''); msg.setAttribute('aria-live', 'polite');
        var rows = {};
        Object.keys(TITLES).forEach(function (field) {
            var opts = choices[field]; if (!Array.isArray(opts) || !opts.length) return;
            var r = elc('div', 'sba-field'); r.setAttribute('data-field', field);
            var lb = elc('div', 'sba-label', TITLES[field][0]); if (TITLES[field][1]) lb.appendChild(elc('span', 'sba-hint', TITLES[field][1]));
            r.appendChild(lb);
            var seg = elc('div', 'sba-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', TITLES[field][0]);
            opts.forEach(function (v) {
                var x = (LABELS[field] || {})[String(v)] || [String(v)];
                var b = elc('button', 'sba-pill', x[0]); b.type = 'button'; b.setAttribute('data-value', String(v));
                if (x[1]) b.appendChild(el('small', '', x[1]));
                b.addEventListener('click', async function () {
                    if (b.disabled) return;
                    var patch = {}; patch[field] = v; msg.style.color = '#94a3b8'; msg.textContent = '저장 중…';
                    try {
                        var res = await call('/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
                        if (res.status !== 200 || !res.body.config) throw new Error(res.body.error || ('HTTP ' + res.status));
                        config = res.body.config; paint(); msg.style.color = '#34d399'; msg.textContent = '저장됨 — ' + TITLES[field][0] + ': ' + fullLabel(field, v);
                    } catch (e) { console.warn('[AI 브리핑 관리] 설정 저장 실패:', field, e && e.message); msg.style.color = '#fca5a5'; msg.textContent = '저장 실패: ' + (e && e.message); }
                });
                seg.appendChild(b);
            });
            r.appendChild(seg); box.appendChild(r); rows[field] = r;
        });
        box.appendChild(msg);
        /** 지금 설정값에 맞춰 고른 버튼(aria-pressed)·흐림을 칠한다. */
        function paint() {
            Object.keys(rows).forEach(function (field) {
                var off = (field === 'chatgptModel' && config.method !== 'chatgpt') || (field === 'geminiModel' && config.method === 'template');
                rows[field].style.opacity = off ? '.45' : '1';
                rows[field].querySelectorAll('button[data-value]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === String(config[field]))); });
            });
        }
        paint();
    }
    /** 통계 칩 하나. 예: chip(box, 'AI 90', 'ok'). @returns {HTMLElement} [연계] ← drawStatus */
    function chip(parent, text, tone) { var c = elc('span', 'sba-chip' + (tone ? ' ' + tone : ''), text); parent.appendChild(c); return c; }
    /**
     * 상태 카드 — 실행 중/대기 표시 · 실행 중이면 진행 게이지(drawProgress, 2.5초마다 다시 받음) · 마지막 실행(시각·판·방식·걸린 시간·공개 시각) · 판별 통계 칩
     * · 관광지 자료 확인 불가(drawSpotFail) · 공개 예정 · 특보 변경 대기 · 실행 실패 · 다음 예정 · 저장된 날짜 · 정시 판 소요 표(drawEditionTimes) · 최근 3일 오류(drawRunErrors) · [지금 다시 만들기](202 시작 / 409 실행 중)·[새로고침].
     * 2026-10-17 사용자 *"실행 중 · 마지막 실행 · 몇 판 … 보기 좋게 … 깔끔하게"* — 줄글 대신 상태 알약·통계 칩·흐린 보조 글(정보는 종전 그대로 다).
     * 예: [● 실행 중] 진행 게이지 … · 마지막 실행 「10-17 07:10 · 07:30 판」 「ChatGPT · 412초 · 공개 10-17 07:30」 · 「10-17 판 97곳」 [AI 90] [다시 시도 5곳] [Gemini 1회] [재사용 3] [규칙 분석 4] [오류 2]
     * @param {HTMLElement} box @returns {Promise<void>} [연계] ← renderStationBriefingAdmin·버튼·진행이 끝날 때 / → drawProgress·startPoll·drawSpotFail·drawEditionTimes·drawRunErrors
     */
    async function drawStatus(box) {
        box.textContent = '';
        var top = elc('div', 'sba-row'); top.style.justifyContent = 'space-between'; box.appendChild(top);
        top.appendChild(elc('div', 'sba-h', '상태')).style.margin = '0';
        var pill = elc('span', 'sba-state idle'); pill.setAttribute('data-sb-running', ''); pill.appendChild(elc('span', 'sba-dot')); pill.appendChild(document.createTextNode('불러오는 중')); top.appendChild(pill);
        var prog = el('div', 'margin-top:10px;'); prog.setAttribute('data-sb-progress', ''); prog.hidden = true; box.appendChild(prog);
        var body = el('div', 'margin-top:4px;'); body.setAttribute('data-sb-status-body', ''); box.appendChild(body);
        var acts = el('div', 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;');
        var run = elc('button', 'sba-btn primary', '지금 다시 만들기'); run.type = 'button'; run.setAttribute('data-sb-run', '');
        var re = elc('button', 'sba-btn', '새로고침'); re.type = 'button';
        var msg = el('div', 'font-size:0.78rem;min-height:1.2em;margin-top:6px;line-height:1.5;'); msg.setAttribute('data-sb-run-msg', ''); msg.setAttribute('aria-live', 'polite');
        acts.appendChild(run); acts.appendChild(re); box.appendChild(acts); box.appendChild(msg);
        re.addEventListener('click', function () { drawStatus(box); });
        run.addEventListener('click', async function () {
            run.disabled = true; msg.style.color = '#94a3b8'; msg.textContent = '요청 중…';
            try {
                var r = await call('/run', { method: 'POST' });
                if (r.status === 202) { msg.style.color = '#34d399'; msg.textContent = '시작했습니다 — 21시 전이면 오늘 판, 이후면 내일 판을 다시 만들어 끝나는 대로 곧바로 보입니다(공개 시각을 기다리지 않음). 위 게이지가 진행을 보여 주고, 끝나면 결과가 저절로 바뀝니다.'; setPill(pill, true); drawProgress(prog, null); startPoll(box, pill, prog); }
                else if (r.status === 409) { msg.style.color = '#fbbf24'; msg.textContent = '이미 실행 중입니다 — 끝난 뒤 다시 눌러 주세요.'; startPoll(box, pill, prog); }
                else { msg.style.color = '#fca5a5'; msg.textContent = '시작하지 못했습니다: ' + (r.body.error || ('HTTP ' + r.status)); }
            } catch (e) { console.warn('[AI 브리핑 관리] 지금 다시 만들기 요청 실패:', e && e.message); msg.style.color = '#fca5a5'; msg.textContent = '요청 실패: ' + (e && e.message); }
            finally { run.disabled = false; }
        });
        var r = await call('/status');
        if (r.status !== 200) { setPill(pill, null); body.appendChild(el('div', 'color:#fca5a5;font-size:.8rem;', '상태를 불러오지 못했습니다(' + r.status + ').')); return; }
        var s = r.body, lr = s.lastRun;
        setPill(pill, !!s.running);
        if (s.running) { drawProgress(prog, s.progress); startPoll(box, pill, prog); }
        var sec = function (k, mark) { var d = el('div'); if (mark) d.setAttribute(mark, ''); d.appendChild(elc('div', 'sba-k', k)); body.appendChild(d); return d; };
        var last = sec('마지막 실행');
        if (lr) {
            var lm = elc('div', 'sba-main', at(lr.at) + ' · ' + (KIND[lr.kind] || lr.kind || '')); lm.setAttribute('data-sb-lastrun', ''); last.appendChild(lm);
            last.appendChild(elc('div', 'sba-sub', [label('method', lr.method || '—'), Number.isFinite(lr.ms) ? Math.round(lr.ms / 1000) + '초' : null, lr.publishAt ? '공개 ' + at(lr.publishAt) : null].filter(Boolean).join(' · ')));
            (lr.results || []).forEach(function (x) {
                var st = x.stats || {}, row = el('div', 'margin-top:6px;'); row.setAttribute('data-sb-result', '');
                row.appendChild(elc('div', 'sba-sub', String(x.date || '').slice(5) + ' 판 · ' + (x.stations || 0) + '곳'));
                var cs = elc('div', 'sba-row'); cs.style.marginTop = '3px'; row.appendChild(cs);
                chip(cs, 'AI ' + (st.ai || 0), 'ok');
                if (st.retried) chip(cs, '다시 시도 ' + st.retried + '곳', 'info');
                if (st.gemini) chip(cs, 'Gemini ' + st.gemini + '회', 'info');
                chip(cs, '재사용 ' + (st.reused || 0));
                chip(cs, '규칙 분석 ' + (st.template || 0), st.template ? 'warn' : '');
                chip(cs, '오류 ' + (x.errors || 0), x.errors ? 'bad' : '');
                if (st.deadline) chip(cs, '시간 초과(데드라인·공개 시각) ' + st.deadline, 'bad');
                last.appendChild(row);
            });
            if (lr.aiDisabled) last.appendChild(elc('div', 'sba-sub', '참고: ' + lr.aiDisabled));
        } else { var lm0 = elc('div', 'sba-sub', '기록 없음'); lm0.setAttribute('data-sb-lastrun', ''); last.appendChild(lm0); }
        drawSpotFail(sec('관광지 자료 확인 불가', 'data-sb-spotfail'), s);
        (s.pending || []).forEach(function (x) { var d = sec('공개 예정', 'data-sb-pending-status'); d.appendChild(elc('div', 'sba-main', at(x.publishAt) + ' — ' + x.stations + '곳(그때까지 사용자에게는 이전 판)')); });
        if (s.pendingWarn) sec('특보 변경 대기').appendChild(elc('div', 'sba-main', (s.pendingWarn.zones || []).join(', ') + ' — 마지막 변경 ' + at(s.pendingWarn.lastChangeAt)));
        Object.keys(s.failures || {}).forEach(function (k) { var f = s.failures[k], d = sec('실행 실패'); d.appendChild(el('div', 'color:#fca5a5;font-size:.8rem;', k + ' ' + f.count + '번 · 마지막 ' + at(f.lastAt) + ' · ' + (f.reason || ''))); });
        var nx = sec('다음 예정', 'data-sb-next'); nx.appendChild(elc('div', 'sba-main', nextEdition(Date.now()))); nx.appendChild(elc('div', 'sba-sub', '07:30·17:30·23:00 공개, 각 20분 전부터 만들기 · 특보가 바뀌면 그 관할만 곧바로'));
        if (Array.isArray(s.days) && s.days.length) sec('저장된 날짜').appendChild(elc('div', 'sba-sub', s.days.join(', ')));
        drawEditionTimes(sec('정시 판 소요 시간 — 최근 ' + EDITION_ROWS + '회까지', 'data-sb-edition-times'), s);
        drawRunErrors(body, s);
    }
    /** 밀리초 → 「분:초」. 예: 754000 → '12:34' · 59000 → '0:59' · 숫자 아님 → '—'. @param {number} ms @returns {string} [연계] ← drawEditionTimes */
    function mmss(ms) { if (!Number.isFinite(ms) || ms < 0) return '—'; var t = Math.round(ms / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
    /**
     * 「관광지 자료 확인 불가」 줄 — 판별로 「관광지 자료 확인 불가: 2관할 · 관광지 3곳」(누르면 관할·관광지 이름), 0이면 「없음」(§11.10.21 — 사용자 화면에서는 뺐다).
     * 마지막 실행과, 그것이 특보 변경·관리자 실행이면 마지막 정시 판(lastEdition)도 따로 보인다. 이 기록 전 실행(spotFail 없음)은 「기록 없음」 — 0 으로 보이지 않게(CLAUDE.md L-291).
     * 예: drawSpotFail(sec, {lastRun:{at,kind:'morning',results:[{date:'2026-10-17',spotFail:{stations:1,spots:2,list:[{office:'제주해양경찰서',station:'한림파출소',spots:['협재해수욕장','한림항']}]}}]}})
     *     → 「마지막 실행 · 10-17 07:10 · 07:30 판 · 10-17 판」 ▸「관광지 자료 확인 불가: 1관할 · 관광지 2곳」 → 「제주해양경찰서 한림파출소 — 협재해수욕장, 한림항」
     * @param {HTMLElement} box @param {Object} s - status 응답 @returns {void} [연계] ← drawStatus · 서버 station_briefing.spotFailOf(lastRun·lastEdition results[].spotFail)
     */
    function drawSpotFail(box, s) {
        var runs = [];
        if (s.lastRun) runs.push(['마지막 실행', s.lastRun]);
        if (s.lastEdition && (!s.lastRun || s.lastEdition.at !== s.lastRun.at)) runs.push(['마지막 정시 판', s.lastEdition]);
        if (!runs.length) { box.appendChild(elc('div', 'sba-sub', '실행 기록 없음')); return; }
        runs.forEach(function (pair) {
            var r = pair[1], res = r.results || [];
            if (!res.length) { box.appendChild(elc('div', 'sba-sub', pair[0] + ' · ' + at(r.at) + ' · 만든 판 없음')); return; }
            res.forEach(function (x) {
                var row = el('div', 'margin-top:4px;'); row.setAttribute('data-sb-spotfail-row', '');
                row.appendChild(elc('div', 'sba-sub', pair[0] + ' · ' + at(r.at) + ' · ' + (KIND[r.kind] || r.kind || '') + ' · ' + String(x.date || '').slice(5) + ' 판'));
                var f = x.spotFail;
                if (!f) row.appendChild(elc('div', 'sba-sub', '관광지 자료 확인 불가: 기록 없음(이 기능 전 실행)'));
                else if (!f.stations) row.appendChild(elc('div', 'sba-main', '관광지 자료 확인 불가: 없음'));
                else {
                    var d = elc('details', 'sba-sf'); d.appendChild(el('summary', '', '관광지 자료 확인 불가: ' + f.stations + '관할 · 관광지 ' + f.spots + '곳'));
                    var ul = el('ul'); (f.list || []).forEach(function (g) { ul.appendChild(el('li', '', [g.office, g.station].filter(Boolean).join(' ') + ' — ' + (g.spots || []).join(', '))); });
                    if (!(f.list || []).length) ul.appendChild(el('li', '', '이름 목록은 마지막 실행·마지막 정시 판에만 남깁니다'));
                    d.appendChild(ul); row.appendChild(d);
                }
                box.appendChild(row);
            });
        });
        box.appendChild(elc('div', 'sba-sub', '연안 하루 값 상세를 받지 못한 관광지 — 그 관광지는 브리핑 연안 판단에서 빠집니다.'));
    }
    var EDITION_ROWS = 6;
    /**
     * 정시 판(07:30·17:30·23:00) 소요 시간 작은 표 — 최근 EDITION_ROWS 회(서버 실행 기록 status.runs, 최근 3일). 사용자가 「만들기 시작 시각을 앞당길지」 판단하는 데 쓴다(§11.10.21).
     * 칸: 판(시작 시각) · 소요(분:초, 공개 몇 분 전/뒤 끝남) · 결과(관할·AI·재사용·규칙 분석·오류) · 마감(실행 마감에 걸려 규칙 분석으로 넘긴 관할 수).
     * 예: drawEditionTimes(sec, {runs:[{at:'2026-10-17T07:10:00+09:00',kind:'morning',ms:754000,publishAt:'…T07:30:00+09:00',results:[{stations:97,stats:{ai:90,reused:3,template:4,deadline:0},errors:2}]}], runDeadlineMs:1200000})
     *     → | 07:30 판 / 10-17 07:10 | 12:34 / 공개 7:26 전 끝남 | 97곳 · AI 90 · 재사용 3 · 규칙 4 · 오류 2 | 안 걸림 |
     * @param {HTMLElement} box @param {Object} s - status 응답 @returns {void} [연계] ← drawStatus · 서버 station_briefing.run(runs[].ms·results[].stats.deadline)·status(runDeadlineMs)
     */
    function drawEditionTimes(box, s) {
        var rows = (s.runs || []).filter(function (r) { return r && ['morning', 'evening', 'night'].indexOf(r.kind) >= 0; }).slice(0, EDITION_ROWS);
        if (!rows.length) { box.appendChild(elc('div', 'sba-sub', '최근 3일 정시 판 기록 없음')); return; }
        var t = elc('table', 'sba-tt'), cg = el('colgroup');
        ['24%', '24%', '34%', '18%'].forEach(function (w) { var c = el('col'); c.style.width = w; cg.appendChild(c); }); t.appendChild(cg);
        var hr = el('tr'); ['판(시작)', '소요(분:초)', '결과', '마감'].forEach(function (h) { hr.appendChild(el('th', '', h)); }); var th = el('thead'); th.appendChild(hr); t.appendChild(th);
        var tb = el('tbody'); t.appendChild(tb);
        var cell = function (tr, main, sub, cls) { var td = el('td', '', main); if (cls) td.className = cls; if (sub) td.appendChild(el('small', '', sub)); tr.appendChild(td); return td; };
        rows.forEach(function (r) {
            var n = { stations: 0, ai: 0, reused: 0, template: 0, errors: 0, deadline: 0 };
            (r.results || []).forEach(function (x) { var st = x.stats || {}; n.stations += x.stations || 0; n.ai += st.ai || 0; n.reused += st.reused || 0; n.template += st.template || 0; n.deadline += st.deadline || 0; n.errors += x.errors || 0; });
            var end = Date.parse(r.at) + r.ms, gap = r.publishAt && Number.isFinite(end) ? Date.parse(r.publishAt) - end : NaN;
            var tr = el('tr'); tr.setAttribute('data-sb-edition-row', '');
            cell(tr, KIND[r.kind], at(r.at));
            cell(tr, mmss(r.ms), Number.isFinite(gap) ? '공개 ' + mmss(Math.abs(gap)) + (gap >= 0 ? ' 전 끝남' : ' 뒤 끝남') : null);
            cell(tr, n.stations + '곳 · AI ' + n.ai + ' · 재사용 ' + n.reused + ' · 규칙 ' + n.template + ' · 오류 ' + n.errors);
            if (n.deadline) cell(tr, '걸림', '규칙으로 ' + n.deadline + '곳', 'bad'); else cell(tr, '안 걸림');
            tb.appendChild(tr);
        });
        box.appendChild(t);
        var dl = Number.isFinite(s.runDeadlineMs) ? Math.round(s.runDeadlineMs / 60000) + '분' : '정한 시간';
        box.appendChild(elc('div', 'sba-sub', '소요 = 위치 확인부터 저장까지 전체. 마감 = 시작 뒤 ' + dl + '과 공개 시각 중 이른 때 — 넘으면 남은 관할은 규칙 분석(AI 없음). 특보 변경·관리자 실행은 이 표에 없습니다.'));
    }
    /** 상태 알약을 실행 중/대기로. 예: setPill(p, true) → 「● 실행 중」. @param {HTMLElement} pill @param {boolean|null} on - null 이면 「알 수 없음」 @returns {void} [연계] ← drawStatus·startPoll */
    function setPill(pill, on) {
        pill.className = 'sba-state ' + (on ? 'on' : 'idle');
        pill.lastChild.textContent = on === null ? '알 수 없음' : on ? '실행 중' : '대기 중';
    }
    /**
     * 실행 중이면 2.5초마다 진행만(GET status?only=progress) 받아 게이지를 다시 그린다. 끝나면(running false) 멈추고 상태 카드를 통째로 다시 그린다(새 결과·오류).
     * 화면이 가려져 있으면(document.hidden) 그 차례는 건너뛰고, 탭을 떠나 상자가 문서에서 떨어지면 멈춘다. 한 번에 하나만 돈다.
     * 예: startPoll(box, pill, prog) → 2.5초 뒤 진행 41/99 … → running:false → drawStatus(box)
     * @param {HTMLElement} box @param {HTMLElement} pill @param {HTMLElement} prog @returns {void} [연계] ← drawStatus·[지금 다시 만들기] / → drawProgress
     */
    function startPoll(box, pill, prog) {
        if (ui.poll) clearTimeout(ui.poll);
        var busy = false;
        var tick = async function () {
            ui.poll = null;
            if (!box.isConnected) return;   // 다른 탭·모달 닫힘 — 멈춘다
            if (!document.hidden && !busy) {
                busy = true;
                try {
                    var r = await call('/status?only=progress');
                    if (r.status === 200) {
                        if (!r.body.running) { drawStatus(box); return; }
                        setPill(pill, true); drawProgress(prog, r.body.progress);
                    }
                } catch (e) { console.warn('[AI 브리핑 관리] 진행 받기 실패(다음 차례에 다시):', e && e.message); }
                finally { busy = false; }
            }
            if (box.isConnected) ui.poll = setTimeout(tick, POLL_MS);
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
     * 오류 목록을 마크다운으로(복사·md 저장이 같은 글을 쓴다). 표 칸의 줄바꿈은 빈칸으로, 「\」「|」「`」「<」「>」는 앞에 역슬래시를 붙여 글자 그대로 보이게 한다
     * (2026-10-17 독립 검토 11 — 이유 글의 `·<·> 가 마크다운 미리보기에서 코드·HTML 로 읽히지 않게 — CommonMark 문장부호 이스케이프).
     * run 을 주면(§11.10.7 — 고른 실행 하나) 제목·머리에 그 실행(시작 시각·판·방식·걸린 시간·판별 통계)을 적는다. 마지막 칸 「풀이」 = 화면과 같은 한글 풀이(reasonTexts).
     * 예: errorsMarkdown([{at:'2026-10-17T08:03:10+09:00',edition:'morning',date:'2026-10-17',stage:'validate',provider:'chatgpt',stations:['제주해양경찰서|한림파출소'],reason:'place:제주도',attempt:2}], ms, {days:3})
     *     → '# 연안 안전 브리핑 — AI 브리핑 오류(최근 3일)\n\n- 만든 시각: 2026-10-17 10:05 KST\n- 건수: 1건\n\n| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 | 풀이 |\n|---|…|\n| 2026-10-17 08:03:10 | 07:30 판 · 2026-10-17 | validate · 2번째 | chatgpt | 제주해양경찰서 한림파출소 | place:제주도 | 2번째 시도(ChatGPT) — 입력 자료에 없는 지명 「제주도」 |'
     * @param {Object[]} errs - 오류(최근 것부터) @param {number} nowMs @param {Object} keep - status.errorKeep {days,cap} @param {Object} [run] - runGroups 의 한 실행
     * @returns {string} [연계] ← drawRunErrors(복사·md로 저장) · 시험 test_station_briefing.js(vm)
     */
    function errorsMarkdown(errs, nowMs, keep, run) {
        var cell = function (v) { return String(v === undefined || v === null || v === '' ? '—' : v).replace(/\r?\n/g, ' ').replace(/([\\|`<>])/g, '\\$1'); };
        var head = run ? at(run.at) + ' 시작 · ' + (KIND[run.kind] || run.kind || '실행') : '최근 ' + ((keep && keep.days) || 3) + '일';
        var out = ['# 연안 안전 브리핑 — AI 브리핑 오류(' + head + ')', ''];
        if (run && run.run) {
            var r = run.run;
            out.push('- 실행: ' + String(r.at || '').slice(0, 16).replace('T', ' ') + ' 시작 · ' + (KIND[r.kind] || r.kind || '') + ' · 방식 ' + (r.method || '—') + (Number.isFinite(r.ms) ? ' · ' + Math.round(r.ms / 1000) + '초' : ''));
            (r.results || []).forEach(function (x) { var st = x.stats || {}; out.push('- ' + x.date + ' 판 ' + (x.stations || 0) + '곳: AI ' + (st.ai || 0) + ' · 다시 시도 ' + (st.retried || 0) + '곳 · Gemini ' + (st.gemini || 0) + '회 · 재사용 ' + (st.reused || 0) + ' · 규칙 분석 ' + (st.template || 0) + ' · 오류 ' + (x.errors || 0)); });
        }
        out.push('- 만든 시각: ' + kstStamp(nowMs, true) + ' KST', '- 건수: ' + errs.length + '건', '', '| 시각(KST) | 판 | 단계 | 공급자 | 관할 | 이유 | 풀이 |', '|---|---|---|---|---|---|---|');
        errs.forEach(function (e) { out.push('| ' + [String(e.at || '').slice(0, 19).replace('T', ' '), editionText(e), stageText(e), e.provider, stationsText(e.stations), e.reason, attemptText(e) + ' — ' + reasonTexts(e).join(' · ')].map(cell).join(' | ') + ' |'); });
        return out.join('\n') + '\n';
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
     * 오류 칸 — 최근 3일 오류를 「실행」마다 드롭다운으로 고르고(기본 = 가장 최근 실행), 고른 실행의 오류만 관할별·시도별 한글 풀이로 보인다.
     * [복사]·[md로 저장]은 고른 실행의 오류만(버튼 아래 작은 글로 밝힌다).
     * 2026-10-17 사용자 *"최근 3일치에 대해서만 띄우되 … 분석을 돌렸을 때마다 분류 … 드롭다운으로 … 언제 분석이 시작됐고 … 그때 오류 현황을 볼 수 있도록"*
     * 서버 안전 상한으로 지운 것이 있으면(errorsCapped) 그 사실을 한 줄로. 복사가 안 되면(권한·http 등) 보이는 안내로 알린다.
     * 예: 드롭다운 「10-17 18:31 · 관리자 즉시 실행 · 오류 22」 → 「고현파출소 (통영해양경찰서) · 오류 4」 「1번째 시도(ChatGPT) — 입력 자료에 없는 지명 「장승포」」 …
     * @param {HTMLElement} body @param {Object} s - status 응답 @returns {void} [연계] ← drawStatus / → runGroups·errorsByStation·reasonTexts·errorsMarkdown·saveMarkdown
     */
    function drawRunErrors(body, s) {
        var errs = Array.isArray(s.errors) ? s.errors : [], keep = s.errorKeep || { days: 3 }, groups = runGroups(errs, s.runs, s.lastRun);
        var box = el('div', 'margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.1);'); box.setAttribute('data-sb-errors', '');
        box.appendChild(elc('div', 'sba-h', '최근 ' + (keep.days || 3) + '일 오류 — 실행마다'));
        if (s.errorsCapped) box.appendChild(el('div', 'color:#fbbf24;font-size:0.76rem;margin-bottom:6px;', '보관 상한(' + (s.errorsCapped.cap || keep.cap || '') + '건)을 넘어 오래된 오류 ' + s.errorsCapped.dropped + '건을 지웠습니다(' + at(s.errorsCapped.at) + ').'));
        if (!groups.length) { box.appendChild(el('div', 'color:#94a3b8;font-size:.8rem;', '최근 ' + (keep.days || 3) + '일 동안 실행 기록도 오류도 없습니다.')); body.appendChild(box); return; }
        var sel = elc('select', 'sba-select'); sel.setAttribute('data-sb-err-run', ''); sel.setAttribute('aria-label', '오류를 볼 실행 고르기');
        groups.forEach(function (g, i) { var op = el('option', '', runOptionText(g)); op.value = g.at; if (g.at === ui.run || (!ui.run && i === 0)) op.selected = true; sel.appendChild(op); });
        if (!groups.some(function (g) { return g.at === ui.run; })) sel.selectedIndex = 0;
        box.appendChild(sel);
        var head = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;');
        var copy = elc('button', 'sba-btn', '복사'); copy.type = 'button'; copy.setAttribute('data-sb-err-copy', '');
        var save = elc('button', 'sba-btn', 'md로 저장'); save.type = 'button'; save.setAttribute('data-sb-err-md', '');
        head.appendChild(copy); head.appendChild(save); box.appendChild(head);
        var cap = el('div', 'color:#94a3b8;font-size:.72rem;margin-top:4px;'); cap.setAttribute('data-sb-err-scope', ''); box.appendChild(cap);
        var msg = el('div', 'font-size:0.76rem;min-height:1.1em;margin-top:4px;line-height:1.5;'); msg.setAttribute('data-sb-err-msg', ''); msg.setAttribute('aria-live', 'polite'); box.appendChild(msg);
        var view = el('div', 'margin-top:4px;'); view.setAttribute('data-sb-err-list', ''); box.appendChild(view);
        body.appendChild(box);
        var say = function (ok, t) { msg.style.color = ok === null ? '#94a3b8' : ok ? '#34d399' : '#fca5a5'; msg.textContent = t; };
        var cur = function () { return groups[sel.selectedIndex] || groups[0]; };
        /** 고른 실행의 오류를 그린다. */
        function paint() {
            var g = cur(); view.textContent = ''; say(null, '');
            cap.textContent = '[복사]·[md로 저장]은 고른 실행(' + at(g.at) + ' · ' + (KIND[g.kind] || g.kind || '실행') + ')의 오류 ' + g.errors.length + '건만 담습니다.';
            copy.disabled = save.disabled = !g.errors.length;
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
                var ol = el('ol'), li = el('li'); li.appendChild(el('b', '', attemptText(e))); li.appendChild(document.createTextNode(' — ' + reasonTexts(e).join(' · '))); ol.appendChild(li); d.appendChild(ol);
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
                    ol.appendChild(li);
                });
                d.appendChild(ol); view.appendChild(d);
            });
        }
        sel.addEventListener('change', function () { ui.run = cur().at; paint(); });
        paint();
        copy.addEventListener('click', async function () {
            var g = cur(), md = errorsMarkdown(g.errors, Date.now(), keep, g);
            try {
                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('이 브라우저(또는 http 주소)에서는 클립보드를 쓸 수 없음');
                await navigator.clipboard.writeText(md); say(true, '복사했습니다 — ' + at(g.at) + ' 실행 오류 ' + g.errors.length + '건(마크다운).');
            } catch (e) {
                console.warn('[AI 브리핑 관리] 오류 목록 클립보드 복사 실패 — 옛 방식으로 다시 시도:', e && e.message);
                // 옛 방식(execCommand) — 권한이 막힌 기기용. 그것도 안 되면 [md로 저장]을 안내한다.
                var ta = document.createElement('textarea'); ta.value = md; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;'; document.body.appendChild(ta); ta.select();
                var ok = false; try { ok = document.execCommand('copy'); } catch (e2) { console.warn('[AI 브리핑 관리] execCommand 복사 실패:', e2 && e2.message); }
                ta.remove();
                say(ok, ok ? '복사했습니다 — ' + at(g.at) + ' 실행 오류 ' + g.errors.length + '건(마크다운).' : '복사하지 못했습니다(' + ((e && e.message) || '클립보드 사용 불가') + ') — [md로 저장]으로 파일을 받으세요.');
            }
        });
        save.addEventListener('click', function () {
            var g = cur(), now = Date.now();
            saveMarkdown(errorsMarkdown(g.errors, now, keep, g), 'station_briefing_errors_' + kstStamp(Date.parse(g.at) || now, false) + '.md', say, view);
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
                var r = await call('/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, text: text }) });
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
        var old = view.querySelector('[data-sb-err-text]'); if (old) old.remove();
        var ta = elc('textarea', 'sba-mdview'); ta.readOnly = true; ta.value = text; ta.setAttribute('data-sb-err-text', ''); ta.setAttribute('aria-label', '오류 마크다운 글');
        view.insertBefore(ta, view.firstChild);
    }
    /**
     * 관할 하나 미리보기 — 관할 목록(경찰서별 묶음)·날짜(자동·오늘·내일)를 골라 사용자 화면과 같은 렌더러로 그린다. 노출 범위와 무관(관리자 경로).
     * 공개 시각 전의 판(§11.10.4)이 있으면 그 판을 「예정 — HH:MM 에 공개될 판」 안내와 함께 보인다(서버 preview 가 pending·publishAt 을 준다).
     * 예: 한림파출소 · 자동 → GET /api/admin/station-briefing/preview?station=…&day=auto → StationBriefingRender.render(…, {links:false})
     * @param {HTMLElement} box @returns {Promise<void>} [연계] ← renderStationBriefingAdmin / → StationBriefingRender.render
     */
    async function drawPreview(box) {
        box.textContent = '';
        box.appendChild(elc('div', 'sba-h', '관할 하나 미리보기'));
        var bar = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;');
        var sel = el('select', 'flex:1 1 200px;min-width:0;padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:#0f1b33;color:#fff;font-size:0.8rem;'); sel.setAttribute('data-sb-preview-station', '');
        var day = el('select', 'padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.2);background:#0f1b33;color:#fff;font-size:0.8rem;');
        [['auto', '자동(21시부터 내일)'], ['today', '오늘'], ['tomorrow', '내일']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; day.appendChild(op); });
        var go = elc('button', 'sba-btn primary', '보기'); go.type = 'button'; go.setAttribute('data-sb-preview-go', '');
        bar.appendChild(sel); bar.appendChild(day); bar.appendChild(go); box.appendChild(bar);
        var out = el('div', 'margin-top:10px;'); out.className = 'sb-wrap'; out.style.marginTop = '10px'; out.setAttribute('data-sb-preview-out', ''); box.appendChild(out);
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
    renderStationBriefingAdmin.codeText = codeText;
    renderStationBriefingAdmin.reasonTexts = reasonTexts;
    renderStationBriefingAdmin.runGroups = runGroups;
    renderStationBriefingAdmin.errorsByStation = errorsByStation;
    renderStationBriefingAdmin.SHAPE = SHAPE;
    renderStationBriefingAdmin.mmss = mmss;   // §11.10.21 정시 판 소요 표
})(window);
