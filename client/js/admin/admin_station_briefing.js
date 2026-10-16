/**
 * ============================================================================
 * 파일명: client/js/admin/admin_station_briefing.js
 * 역할  : 통합관리자 → AI 탭 → 하위 탭 「AI 브리핑」(설계서 §11.6 결정 16·17) — 활동지점 안전 브리핑의
 *         생성 방식(ChatGPT VM / Gemini / 틀)·모델·노출 범위(사용자에게 / 관리자에게만 / 노출 안 함)·묶음 단위·「바뀐 곳만 다시 만들기」를 고르고,
 *         상태(마지막 실행·판·성공/틀 대체/실패 수·다음 예정)를 보고, [지금 다시 만들기](실행 중이면 409 안내)와 관할 하나 미리보기를 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js(window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부 · switchAiSubTab 이 나를 부름)
 *                    · forecast/station-briefing/station_briefing_render.js(StationBriefingRender.render — 미리보기는 사용자 화면과 같은 렌더러)
 *  - 서버 API      : GET·PUT /api/admin/station-briefing/config · GET /api/admin/station-briefing/status · POST /api/admin/station-briefing/run(실행 중 409)
 *                    · GET /api/admin/station-briefing/stations · GET /api/admin/station-briefing/preview (routes/station_briefing.js)
 *  - 마크업        : 관리자 센터 모달 #ai-subtab-body(admin.js renderUnifiedAiTab 이 만듦) — 이 파일이 안을 통째로 만든다
 *  - 나를 쓰는 곳  : admin.js switchAiSubTab('briefing') → window.renderStationBriefingAdmin
 * [로드 순서] admin/admin_data_status.js 다음 · admin/admin_collect.js 이전(호출은 사용자가 하위 탭을 누를 때)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var API = '/api/admin/station-briefing';
    // 선택지 이름표 — 모델은 AI 챗봇 「답변 AI 모델」 버튼(ai-chat/ai_chat.js)과 같은 이름. 서버 choices 에 없는 값은 그리지 않는다.
    var LABELS = {
        method: { chatgpt: 'ChatGPT(관리자 VM → 꺼지면 Gemini → 틀)', gemini: 'Gemini(→ 실패하면 틀)', template: '틀(AI 없음)' },
        chatgptModel: { 'gpt-6-luna': 'GPT Luna', 'gpt-6-sol': 'GPT Sol', 'gpt-6-astra': 'GPT Astra' },
        geminiModel: { 'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite' },
        exposure: { user: '사용자에게', admin: '관리자에게만', off: '노출 안 함' },
        batchUnit: { station: '파출소(97회/판)', office: '해양경찰서(21회/판)', region: '지방청(5회/판)' },
        onlyChanged: { 'true': '켜기 — 입력이 같으면 지난 총평 재사용', 'false': '끄기 — 매번 새로' },
    };
    var TITLES = { method: '생성 방식', chatgptModel: 'ChatGPT 모델', geminiModel: 'Gemini 모델', exposure: '노출 범위', batchUnit: '묶음 단위(AI 호출 한 번에 묶는 관할)', onlyChanged: '바뀐 곳만 다시 만들기 — AI 총평을 입력이 바뀐 관할만 새로 씀(기상청 해상 전망이 바뀌면 전 관할을 다시 씁니다)' };
    // ↑ onlyChanged 단서(2단계 검토 B13): 재사용 해시에 기상청 해상 전망(kma)이 들어 있어(station_briefing_ai.generate), 전망이 바뀌면 모든 관할의 해시가 바뀐다.
    var KIND = { morning: '08:00 판', evening: '17:30 판', night: '23:00 판', warning: '특보 변경 판', manual: '관리자 즉시 실행' };
    var BOX = 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:14px;';

    /** 요소 하나(글은 textContent). 예: el('div','', '저장됨'). @returns {HTMLElement} [연계] ← 이 파일 */
    function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
    /** KST 시각 글자. 예: '2026-10-17T08:00:12+09:00' → '10-17 08:00'. @param {string} iso @returns {string} */
    function at(iso) { var m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || '')); return m ? m[1] + '-' + m[2] + ' ' + m[3] + ':' + m[4] : '—'; }
    /**
     * 다음 정시 판 시각(KST 08:00·17:30·23:00 — 서버 station_briefing_rules.EDITIONS 와 같은 표).
     * 예: 10-17 14:05 KST → '10-17 17:30' · 23:10 → '10-18 08:00'
     * @param {number} nowMs @returns {string} [연계] ← 상태 칸 「다음 예정」
     */
    function nextEdition(nowMs) {
        var k = new Date(nowMs + 9 * 3600000), mins = k.getUTCHours() * 60 + k.getUTCMinutes(), slots = [480, 1050, 1380], day = 0, pick = null;
        for (var i = 0; i < slots.length; i++) if (slots[i] > mins) { pick = slots[i]; break; }
        if (pick === null) { pick = slots[0]; day = 1; }
        var d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + day));
        return String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + ' ' + String(Math.floor(pick / 60)).padStart(2, '0') + ':' + String(pick % 60).padStart(2, '0');
    }
    /** JSON 요청(관리자 토큰은 admin.js 래퍼가 붙인다). 실패면 {status, error}. @returns {Promise<{status:number, body:Object}>} */
    async function call(path, init) {
        var r = await fetch(API + path, Object.assign({ cache: 'no-store' }, init || {}));
        var body = null; try { body = await r.json(); } catch (e) { body = null; console.warn('[AI 브리핑 관리] 응답이 JSON 이 아님 — ' + path + ' HTTP ' + r.status + ':', e && e.message); }
        return { status: r.status, body: body || {} };
    }

    /**
     * AI 브리핑 하위 탭을 그린다.
     * 예: renderStationBriefingAdmin(document.getElementById('ai-subtab-body'))
     * @param {HTMLElement} container @returns {Promise<void>}
     * [연계] ← admin.js switchAiSubTab('briefing') / → loadConfig·loadStatus·loadStations
     */
    async function renderStationBriefingAdmin(container) {
        container.textContent = '';
        var host = el('div'); host.setAttribute('data-sb-admin', ''); container.appendChild(host);
        var title = el('div'); title.className = 'admin-section-title'; var ts = el('span'); var ic = el('i'); ic.className = 'fa-solid fa-compass'; ic.style.color = '#22d3ee'; ts.appendChild(ic); ts.appendChild(document.createTextNode(' AI 브리핑 — 활동지점 안전 브리핑')); title.appendChild(ts); host.appendChild(title);
        host.appendChild(el('div', 'color:#94a3b8;font-size:0.8rem;margin-bottom:10px;line-height:1.5;', '파출소 관할 97곳의 브리핑을 08:00·17:30·23:00 과 특보가 바뀔 때 서버가 만듭니다. AI 는 총평 두 문단만 쓰고, 단계·카드는 서버 규칙입니다. 바꾼 값은 누르는 즉시 저장됩니다.'));
        var cfgBox = el('div', BOX); cfgBox.setAttribute('data-sb-config', ''); host.appendChild(cfgBox);
        var stBox = el('div', BOX); stBox.setAttribute('data-sb-status', ''); host.appendChild(stBox);
        var pvBox = el('div', BOX); pvBox.setAttribute('data-sb-preview', ''); host.appendChild(pvBox);
        var cfg = await call('/config');
        if (cfg.status !== 200 || !cfg.body.config) { cfgBox.appendChild(el('div', 'color:#fca5a5;font-size:0.82rem;', '설정을 불러오지 못했습니다(' + cfg.status + '). 관리자 로그인이 필요할 수 있습니다.')); return; }
        drawConfig(cfgBox, cfg.body.config, cfg.body.choices || {});
        drawStatus(stBox);
        drawPreview(pvBox);
    }
    /**
     * 설정 칸(생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만). 버튼을 누르면 PUT 으로 그 칸만 보내고, 성공하면 버튼 상태를 바꾼다(실패면 이유).
     * 모델 줄은 방식에 따라 흐리게(틀이면 둘 다, Gemini 면 ChatGPT 모델).
     * 예: [관리자에게만] → PUT {exposure:'admin'} → 「저장됨 — 노출 범위: 관리자에게만」
     * @param {HTMLElement} box @param {Object} config @param {Object} choices @returns {void} [연계] ← renderStationBriefingAdmin
     */
    function drawConfig(box, config, choices) {
        box.textContent = '';
        box.appendChild(el('div', 'font-size:0.85rem;color:#94a3b8;margin-bottom:8px;', '설정'));
        var msg = el('div', 'font-size:0.78rem;min-height:1.2em;margin-top:6px;color:#94a3b8;'); msg.setAttribute('data-sb-msg', ''); msg.setAttribute('aria-live', 'polite');
        var rows = {};
        Object.keys(TITLES).forEach(function (field) {
            var opts = choices[field]; if (!Array.isArray(opts) || !opts.length) return;
            var r = el('div', 'margin-bottom:10px;'); r.setAttribute('data-field', field);
            r.appendChild(el('div', 'color:#64748b;font-size:0.72rem;margin-bottom:4px;', TITLES[field]));
            var seg = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
            opts.forEach(function (v) {
                var b = el('button', '', (LABELS[field] || {})[String(v)] || String(v)); b.type = 'button'; b.setAttribute('data-value', String(v));
                b.addEventListener('click', async function () {
                    if (b.disabled) return;
                    var patch = {}; patch[field] = v; msg.style.color = '#94a3b8'; msg.textContent = '저장 중…';
                    try {
                        var res = await call('/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
                        if (res.status !== 200 || !res.body.config) throw new Error(res.body.error || ('HTTP ' + res.status));
                        config = res.body.config; paint(); msg.style.color = '#34d399'; msg.textContent = '저장됨 — ' + TITLES[field] + ': ' + ((LABELS[field] || {})[String(v)] || String(v));
                    } catch (e) { console.warn('[AI 브리핑 관리] 설정 저장 실패:', field, e && e.message); msg.style.color = '#fca5a5'; msg.textContent = '저장 실패: ' + (e && e.message); }
                });
                seg.appendChild(b);
            });
            r.appendChild(seg); box.appendChild(r); rows[field] = r;
        });
        box.appendChild(msg);
        /** 지금 설정값에 맞춰 버튼 색·흐림을 칠한다. */
        function paint() {
            Object.keys(rows).forEach(function (field) {
                var off = (field === 'chatgptModel' && config.method !== 'chatgpt') || (field === 'geminiModel' && config.method === 'template');
                rows[field].style.opacity = off ? '.45' : '1';
                rows[field].querySelectorAll('button[data-value]').forEach(function (b) {
                    var on = b.getAttribute('data-value') === String(config[field]);
                    b.setAttribute('aria-pressed', String(on));
                    b.style.cssText = 'padding:7px 12px;border-radius:8px;font-size:0.8rem;font-weight:700;cursor:pointer;border:1px solid ' + (on ? 'rgba(34,211,238,.6)' : 'rgba(255,255,255,.12)') + ';background:' + (on ? 'rgba(34,211,238,0.18)' : 'transparent') + ';color:' + (on ? '#67e8f9' : '#94a3b8') + ';';
                });
            });
        }
        paint();
    }
    /**
     * 상태 칸 — 마지막 실행(시각·판·방식·걸린 시간·날짜별 관할 수·AI·재사용·틀 대체·오류)·실행 중·특보 변경 대기·실행 실패·다음 예정·최근 오류 5개,
     * [지금 다시 만들기](202 시작 / 409 실행 중)·[새로고침].
     * 예: 「마지막 실행 10-17 08:00 · 08:00 판 · chatgpt · 412초」 「10월 17일 97곳 — AI 90 · 재사용 3 · 틀 대체 4 · 오류 2」
     * @param {HTMLElement} box @returns {Promise<void>} [연계] ← renderStationBriefingAdmin·버튼
     */
    async function drawStatus(box) {
        box.textContent = '';
        box.appendChild(el('div', 'font-size:0.85rem;color:#94a3b8;margin-bottom:8px;', '상태'));
        var body = el('div', 'font-size:0.8rem;color:#cbd5e1;line-height:1.6;'); body.setAttribute('data-sb-status-body', ''); box.appendChild(body);
        var acts = el('div', 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;');
        var run = el('button', 'padding:8px 14px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;', '지금 다시 만들기'); run.type = 'button'; run.setAttribute('data-sb-run', '');
        var re = el('button', 'padding:8px 14px;background:rgba(255,255,255,.08);color:#e2e8f0;border:none;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;', '새로고침'); re.type = 'button';
        var msg = el('div', 'font-size:0.78rem;min-height:1.2em;margin-top:6px;'); msg.setAttribute('data-sb-run-msg', ''); msg.setAttribute('aria-live', 'polite');
        acts.appendChild(run); acts.appendChild(re); box.appendChild(acts); box.appendChild(msg);
        re.addEventListener('click', function () { drawStatus(box); });
        run.addEventListener('click', async function () {
            run.disabled = true; msg.style.color = '#94a3b8'; msg.textContent = '요청 중…';
            try {
                var r = await call('/run', { method: 'POST' });
                if (r.status === 202) { msg.style.color = '#34d399'; msg.textContent = '시작했습니다 — 21시 전이면 오늘 판, 이후면 내일 판을 다시 만듭니다. 끝나면 [새로고침]으로 결과를 보세요.'; }
                else if (r.status === 409) { msg.style.color = '#fbbf24'; msg.textContent = '이미 실행 중입니다 — 끝난 뒤 다시 눌러 주세요.'; }
                else { msg.style.color = '#fca5a5'; msg.textContent = '시작하지 못했습니다: ' + (r.body.error || ('HTTP ' + r.status)); }
            } catch (e) { console.warn('[AI 브리핑 관리] 지금 다시 만들기 요청 실패:', e && e.message); msg.style.color = '#fca5a5'; msg.textContent = '요청 실패: ' + (e && e.message); }
            finally { run.disabled = false; }
        });
        var r = await call('/status');
        if (r.status !== 200) { body.appendChild(el('div', 'color:#fca5a5;', '상태를 불러오지 못했습니다(' + r.status + ').')); return; }
        var s = r.body, lr = s.lastRun;
        var line = function (k, v, mark) { var d = el('div'); if (mark) d.setAttribute(mark, ''); d.appendChild(el('span', 'color:#64748b;', k + ' ')); d.appendChild(document.createTextNode(v)); body.appendChild(d); };
        line('실행 중', s.running ? '예 — 지금 만드는 중' : '아니요', 'data-sb-running');
        if (lr) {
            line('마지막 실행', at(lr.at) + ' · ' + (KIND[lr.kind] || lr.kind || '') + ' · 방식 ' + (lr.method || '—') + (Number.isFinite(lr.ms) ? ' · ' + Math.round(lr.ms / 1000) + '초' : ''), 'data-sb-lastrun');
            (lr.results || []).forEach(function (x) {
                var st = x.stats || {};
                line(String(x.date || '').slice(5) + ' 판', (x.stations || 0) + '곳 — AI ' + (st.ai || 0) + ' · 재사용 ' + (st.reused || 0) + ' · 틀 대체 ' + (st.template || 0) + ' · 오류 ' + (x.errors || 0) + (st.deadline ? ' · 시간 초과 ' + st.deadline : ''), 'data-sb-result');
            });
            if (lr.aiDisabled) line('참고', lr.aiDisabled);
        } else line('마지막 실행', '기록 없음');
        line('다음 예정', nextEdition(Date.now()) + ' (08:00·17:30·23:00, 특보가 바뀌면 그 관할만 추가)', 'data-sb-next');
        if (s.pendingWarn) line('특보 변경 대기', (s.pendingWarn.zones || []).join(', ') + ' — 마지막 변경 ' + at(s.pendingWarn.lastChangeAt));
        Object.keys(s.failures || {}).forEach(function (k) { var f = s.failures[k]; line('실행 실패', k + ' ' + f.count + '번 · 마지막 ' + at(f.lastAt) + ' · ' + (f.reason || '')); });
        if (Array.isArray(s.days) && s.days.length) line('저장된 날짜', s.days.join(', '));
        if (Array.isArray(s.errors) && s.errors.length) {
            var d = el('details', 'margin-top:6px;'); d.appendChild(el('summary', 'cursor:pointer;color:#93c5fd;', '최근 오류 ' + s.errors.length + '건(최근 것부터)'));
            var ul = el('ul', 'margin:4px 0;padding-left:18px;');
            s.errors.slice(0, 20).forEach(function (e) { ul.appendChild(el('li', '', at(e.at) + ' · ' + (e.stage || '') + (e.provider ? '/' + e.provider : '') + ' · ' + (e.reason || ''))); });
            d.appendChild(ul); body.appendChild(d);
        }
    }
    /**
     * 관할 하나 미리보기 — 관할 목록(경찰서별 묶음)·날짜(자동·오늘·내일)를 골라 사용자 화면과 같은 렌더러로 그린다. 노출 범위와 무관(관리자 경로).
     * 예: 한림파출소 · 자동 → GET /api/admin/station-briefing/preview?station=…&day=auto → StationBriefingRender.render(…, {links:false})
     * @param {HTMLElement} box @returns {Promise<void>} [연계] ← renderStationBriefingAdmin / → StationBriefingRender.render
     */
    async function drawPreview(box) {
        box.textContent = '';
        box.appendChild(el('div', 'font-size:0.85rem;color:#94a3b8;margin-bottom:8px;', '관할 하나 미리보기'));
        var bar = el('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;');
        var sel = el('select', 'flex:1 1 200px;min-width:0;padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0f1b33;color:#fff;font-size:0.8rem;'); sel.setAttribute('data-sb-preview-station', '');
        var day = el('select', 'padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0f1b33;color:#fff;font-size:0.8rem;');
        [['auto', '자동(21시부터 내일)'], ['today', '오늘'], ['tomorrow', '내일']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; day.appendChild(op); });
        var go = el('button', 'padding:8px 14px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;', '보기'); go.type = 'button'; go.setAttribute('data-sb-preview-go', '');
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
})(window);
