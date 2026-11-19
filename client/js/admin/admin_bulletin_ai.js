/**
 * ============================================================================
 * 파일명: js/admin/admin_bulletin_ai.js
 * 역할  : 통합관리자 → AI 탭 → 하위 탭 「AI 모델 설정」(2026-11-16 이름 바꿈 — 종전 「AI 특보 분석」).
 *         맨 위 「AI 챗봇 모델」 = 나리야 답변 AI 순서·일반 사용자 적용·ChatGPT 실행 위치(ai_chat.js renderModelSettingsInto — 종전 자리는 AI 챗봇 → 🤖 AI 모델).
 *         그 아래 「AI 특보 분석」 = 기능마다(① 특보 통보문 읽기 · ② 참고사항 해석 · ③ 해상 기상 전망 색칠 · ④ 연안 안전 브리핑) AI 우선순위.
 *         ④ 연안 안전 브리핑(2026-11-16 사용자 「ai 모델 선택 및 설정 부분은 … ① 특보 통보문 읽기에 해당하는 리스트와 같이 디자인을 수정해줘. 그리고 그 탭으로 넣어줘」 ·
 *           다시 시도 「(나)」 · 처음 순서 「클로드 2번, 클로드 1번, 업스테이지, gpt, gemini」): 칸마다 시도 횟수(1~3번)·Gemini 모델(브리핑만)까지 고르고,
 *           맨 아래 「규칙 분석」(고정) 줄. 「AI 분석」 켜기/끄기는 AI 브리핑 탭(설계서 §11.10.51).
 *         1순위가 실패하면 2순위 … 순서대로 시도한다. 칸마다 모델·노력, ChatGPT 칸은 모델과 실행 위치(Fly 서버|VM)를 고른다.
 *         Gemini 는 뺄 수 없다(마지막 안전망).
 * 사용자 요청(2026-11-16): 「ai 챗봇 탭의 ai 모델 탭에 있는 ai 모델 설정기능(답변순서, vm/fly 설정 등)을 ai 특보 분석 탭으로 넣고 ai 챗봇 모델 이라는 내용으로 …
 *         또한 ai 특보 분석이라는 이름을 ai 모델 설정으로 이름을 바꿔줘」
 * 사용자 확정(2026-11-15): 「특보읽기, 참고사항해석에 지금 반영되어있는 모든 ai 툴을 다 선택할 수 있도록 … 각 기능별 사용 ai의 우선순위를
 *         정해두고 그 우선순위대로 작동」 · 「chat gpt도 fly, vm중 고를 수있도록 하고, gpt의 모델도 선택할 수 있도록」
 * ⚠① 특보 읽기는 운영에서 아직 꺼져 있다(ai_report_parser 의 GEMINI_API_KEY 검사 — 운영에 그 시크릿이 없다, 2026-11-15 확인).
 *   켜는 것은 사용자 결정 후 따로 — 이 화면은 순서만 저장한다. ② 는 「통보문 관찰」 탭 4차 시험(설정한 순서)에 쓰인다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js(window.fetch 관리자 토큰 래퍼 · switchAiSubTab 이 나를 부름) · ai-chat/ai_chat.js(window.NariyaChat.renderModelSettingsInto)
 *  - 서버 API      : GET·POST /api/admin/bulletin-ai/config (routes/bulletin_watch.js → services/bulletin_ai.js)
 *  - 마크업        : 없음(switchAiSubTab 이 준 상자에 그린다)
 *  - 나를 쓰는 곳  : admin.js switchAiSubTab('bulletinAi') → window.renderBulletinAiAdmin
 *  - ⑥ 해상 기상 요약(2026-11-19): 지방청 단기 전망의 바다 얘기를 줄인다 — 「먼저 Gemma」 줄(처음부터 켜짐) + 순서 + 「시험 요약」(POST /api/admin/bulletin-ai/try-sea-summary — 지금 설정대로 그 지방청 글을 요약해 보고
 *    누가 답했는지·원문 대조에 걸린 까닭·걸린 시간을 보인다. 저장하지 않는다. 사용자 「젬마로 요약을 실제 해봐야 하겠는걸 ?」)
 *  - Gemma(2026-11-19): ③ 색칠 칸 맨 위 「먼저 Gemma」 줄(쓰지 않음|Gemma 두 모델 — 못 하면 아래 순서대로) + 「시험 호출」(POST /api/admin/bulletin-ai/try-model) + 마지막 Gemma 결과 표시
 * [로드 순서] admin.js 뒤(index2.html — admin_station_briefing.js 다음)
 * ============================================================================
 */
(function (w) {
    'use strict';
    var API = '/api/admin/bulletin-ai/config';
    var NAME = { upstage: '업스테이지', claude1: '클로드 키1', claude2: '클로드 키2', chatgpt: 'ChatGPT', gemini: 'Gemini' };
    var FEAT = {
        read: ['① 특보 통보문 읽기', '기상청 통보문에서 풍랑·태풍 특보와 해역을 뽑습니다. ⚠운영에서는 아직 꺼져 있어 순서만 저장됩니다(켜기는 따로 결정).'],
        interpret: ['② 참고사항 해석', '통보문 「참고사항」의 뜻을 정리합니다. 지금은 「특보 관리 → 통보문 관찰」의 4차 시험(설정한 순서)에서만 쓰입니다.'],
        // 2026-11-16 — 종전 Gemini 고정. 운영에서 바로 쓰인다(새로 들어온 전망부터 — 이미 색칠해 둔 전망은 다시 부르지 않는다).
        forecast: ['③ 해상 기상 전망 색칠', '메인 화면 「기상청 해상 기상 전망」(초단기·단기·지방청)의 지역·수치·위험 표현에 색을 입힙니다. 운영에서 바로 쓰이며, 새로 들어온 전망부터 적용됩니다.'],
        briefing: ['④ 연안 안전 브리핑', '파출소 관할 97곳의 연안·해상 분석 문단을 씁니다. 칸마다 정한 횟수만큼 시도하고(검사에 떨어진 관할만 다시), 안 되면 다음 순위로 — 끝까지 안 되면 서버 규칙 분석. 「AI 분석」 켜기·끄기는 AI 브리핑 탭에서.'],
        // 2026-11-19 사용자 「관리자페이지에서 어떤 ai 쓸건지 결정하는 부분도 ui 만들어야」 — 서버 services/bulletin_escalation.js
        escalation: ['⑤ 격상 가능성 읽기', '통보문 참고사항·기상청 날씨해설(본청 단기·초단기 전망)의 「풍랑경보로 변경될 가능성」「태풍특보로 변경될 가능성」 문장 가운데 규칙이 해역·시점을 읽지 못한 것만 묻습니다(메인 화면 특보구역 카드의 🔺 표시). AI 답은 그 문장에 글자 그대로 있는 해역일 때만 쓰입니다.'],
        // 2026-11-19 사용자 「2.순서 - 전용칸 6」 — 서버 services/regional_sea_summary.js
        seasummary: ['⑥ 해상 기상 요약', '메인 화면 지방청 단기 전망 카드의 「해상 기상 요약」 상자를 만듭니다(바다 얘기만 — 해역별 바람·물결과 너울·안개·조고·특보 가능성 등). 답의 숫자·해역 이름이 원문에 없으면 그 답은 버리고 다음 순위로 넘어가며, 끝까지 안 되면 원문의 바다 항목을 그대로 보입니다. 바다 얘기가 없는 글에는 AI 를 부르지 않습니다.'],
    };
    var RUNNER = { fly: 'Fly 서버', vm: 'VM' };
    var state = null;
    var busy = false;   // 저장 요청 중 — 낡은 순서로 겹쳐 보내 앞 저장을 덮지 않게 다른 누름을 막는다(독립 검토)
    var seaTrial = { office: '', text: '', color: '', busy: false };   // ⑥ 「시험 요약」 — 고른 지방청·마지막 결과·도는 중(다른 칸을 만져 다시 그려도 남게 — 별도 에이전트 검토 2026-11-19)
    var box = null;     // 지금 그리는 상자 — 다른 하위 탭으로 바뀌어 상자가 빠졌으면 늦은 응답이 그 탭을 덮지 않게

    /** 요소 하나(글은 textContent). 예: el('div','color:red','저장됨'). @returns {HTMLElement} [연계] ← 이 파일 */
    function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
    /** 고르기 상자. 예: sel(['a','b'],'b',fn). @returns {HTMLSelectElement} [연계] ← drawFeature */
    function sel(list, cur, label, onChange) {
        var s = el('select', 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:3px 6px;font-size:0.8rem;max-width:150px');
        list.forEach(function (v) { var o = el('option', '', label ? label(v) : v); o.value = v; if (v === cur) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', function () { onChange(s.value); });
        return s;
    }
    /** 작은 버튼. @returns {HTMLButtonElement} */
    function btn(text, onClick, dis) {
        var b = el('button', 'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;padding:2px 8px;font-size:0.8rem;cursor:pointer', text);
        if (dis) { b.disabled = true; b.style.opacity = '0.35'; b.style.cursor = 'default'; } else b.addEventListener('click', onClick);
        return b;
    }

    /**
     * ③ 해상 기상 전망 색칠 · ⑥ 해상 기상 요약의 「먼저 Gemma」 줄 — 고르면 Gemma 를 먼저 부르고, Gemma 가 색칠하지 못하면 아래 순서(관리자가 정한 AI)대로 이어서 부른다.
     *   사용자 2026-11-19: 「젬마가 색칠하는 기능을 넣자 … 젬마가 색칠할 수 없는 문제, 한도 초과, 서버 붐빔 등 문제가 있다면 그때 내가 선택한 api가 호출하여 색칠하도록 하자.」
     *   고르기(쓰지 않음|Gemma 두 모델) · 「시험 호출」(지금 고른 Gemma, 안 골랐으면 기본 Gemini 모델) · 마지막 Gemma 결과(날짜·시각, 서버를 올린 뒤 성공·실패 횟수).
     * @returns {HTMLElement} [연계] ← drawFeature / → save(gemma) · tryModel
     */
    function gemmaRow(f, cfg, ch, host) {
        var row = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;background:#0b1220;margin-bottom:6px;border:1px dashed #334155');
        row.setAttribute('data-bai-gemma-row', f);
        row.appendChild(el('span', 'color:#fbbf24;font-weight:800;min-width:20px', '먼저'));
        row.appendChild(el('span', 'color:#e2e8f0;font-weight:700;min-width:60px', 'Gemma'));
        var opts = [''].concat(ch.gemma.models);
        var gsel = sel(opts, cfg.gemma || '', function (v) { return v || '쓰지 않음'; }, function (v) { save(f, { gemma: v }, host); });
        gsel.style.maxWidth = '230px';
        gsel.setAttribute('data-bai-gemma', f);
        row.appendChild(gsel);
        var out = el('div', 'flex-basis:100%;font-size:0.75rem;color:#94a3b8;word-break:break-all', '');
        out.setAttribute('data-bai-try-out', f);
        var tryBtn = btn('시험 호출', function () { tryModel(gsel.value || (ch.gemma.tryModels && ch.gemma.tryModels[0]) || '', out); });   // 지금 화면에 고른 값(안 골랐으면 기본 Gemini 모델 — 그 모델이 아직 불리는지 볼 때)
        tryBtn.setAttribute('data-bai-try', f);
        row.appendChild(tryBtn);
        var act = f === 'seasummary' ? '요약' : '색칠';   // ③ 은 색칠, ⑥ 은 요약
        row.appendChild(el('div', 'flex-basis:100%;font-size:0.75rem;color:#94a3b8', 'Gemma 가 ' + act + '하지 못하면(오류·한도 초과·수요 과다·못 쓰는 답) 아래 순서대로 이어서 부릅니다.'));
        // 마지막 Gemma 결과 — 날짜·시각과 서버를 올린 뒤 누적 횟수를 함께(「마지막 한 번」만 보이면 절반이 실패해도 초록으로 보인다). 기록은 서버 메모리에만 있다.
        var last = state.gemma && state.gemma[f];
        var when = function (ms) { return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
        var tally = last ? ' · 서버를 올린 뒤 성공 ' + (last.okCount || 0) + ' · 실패 ' + (last.failCount || 0) : '';
        if (last && last.ok === false) { out.style.color = '#f87171'; out.textContent = '마지막 Gemma ' + act + ' 실패(' + when(last.at) + ') → 아래 순서의 AI 가 대신 ' + act + '함 — ' + (last.error || '') + tally; }
        else if (last && last.ok) { out.style.color = (last.failCount || 0) > 0 ? '#fbbf24' : '#34d399'; out.textContent = '마지막 Gemma ' + act + ' 성공(' + when(last.at) + ') · ' + last.model + tally; }
        else if (cfg.gemma) out.textContent = 'Gemma 를 골랐지만 서버를 올린 뒤 아직 부른 기록이 없습니다 — 「시험 호출」로 되는지 먼저 확인하세요.';
        row.appendChild(out);
        return row;
    }

    /**
     * 「시험 호출」 — 그 모델을 짧은 지시문으로 한 번 불러 보고 결과를 그 줄 아래에 적는다(설정은 안 바뀐다).
     * 예: tryModel('gemma-4-31b-it', outEl) → outEl 에 「성공 812ms — {"해역":"동해중부먼바다",…}」 또는 「실패 — …」
     * @param {string} model @param {HTMLElement} out 결과를 적을 곳
     * [연계] ← gemmaRow(③ 「먼저 Gemma」 줄) → POST /api/admin/bulletin-ai/try-model
     */
    function tryModel(model, out) {
        out.style.color = '#94a3b8';
        out.textContent = model + ' 부르는 중…';
        fetch('/api/admin/bulletin-ai/try-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model }) })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                out.style.color = j && j.ok ? '#34d399' : '#f87171';
                out.textContent = j && j.ok ? '시험 성공 ' + j.ms + 'ms · ' + j.model + ' — ' + j.text : '시험 실패 · ' + model + ' — ' + ((j && j.error) || '응답 없음');
            })
            .catch(function (e) { out.style.color = '#f87171'; out.textContent = '시험 실패 — ' + (e && e.message); });
    }

    /**
     * 서버에 한 기능의 바꿀 칸만 보낸다. 성공하면 받은 상태로 다시 그린다. 실패면 상단에 오류.
     * 예: save('read', { order:[…] }) · save('read', { models:{ chatgpt:{ model:'gpt-6-sol', runner:'vm' } } })
     * [연계] → POST /api/admin/bulletin-ai/config
     */
    function save(feature, patch, host) {
        if (busy) return;
        busy = true;
        host.style.opacity = '0.6';
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ feature: feature }, patch)) })
            .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
            .then(function (x) {
                busy = false; host.style.opacity = '';
                if (x.status === 200 && x.body && x.body.ok) { state = x.body; draw(host); return; }
                draw(host, (x.body && x.body.error) || ('저장 실패 HTTP ' + x.status));
            })
            .catch(function (e) { busy = false; host.style.opacity = ''; draw(host, '네트워크 오류: ' + (e && e.message)); });
    }

    /**
     * ⑥ 해상 기상 요약의 「시험 요약」 줄 — 지방청을 골라 누르면 그 지방청의 지금 통보문을 지금 설정(먼저 Gemma → 순서)대로 요약해 본다(저장하지 않는다).
     *   결과: 누가 답했나 · 걸린 시간 · 요약(해역별 줄·종류별 한 줄) 또는 못 만든 까닭(원문 대조에 걸린 까닭 포함) · AI 에게 준 바다 글.
     *   사용자 2026-11-19: 「젬마로 요약을 실제 해봐야 하겠는걸 ?」 — 작업 환경에는 AI 키가 없어 운영 키로 여기서 본다.
     * @returns {HTMLElement} [연계] ← drawFeature / → POST /api/admin/bulletin-ai/try-sea-summary
     */
    function seaTrialRow() {
        var row = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;background:#0b1220;margin-bottom:6px;border:1px dashed #334155');
        row.setAttribute('data-bai-sea-row', '1');
        var offices = state.seaOffices || [];
        var osel = sel(offices.map(function (o) { return o.code; }), seaTrial.office || (offices[0] && offices[0].code), function (v) { var o = offices.filter(function (x) { return x.code === v; })[0]; return o ? o.name : v; }, function (v) { seaTrial.office = v; });
        osel.setAttribute('data-bai-sea-office', '1');
        row.appendChild(osel);
        var out = el('pre', 'flex-basis:100%;margin:0;font-size:0.74rem;color:#94a3b8;white-space:pre-wrap;word-break:break-all;font-family:inherit',
            !offices.length ? '서버가 지방청 목록을 주지 않았습니다(서버가 옛 판) — 서버를 새로 올린 뒤 다시 여세요.' : seaTrial.text || '지방청을 골라 「시험 요약」을 누르면 지금 설정대로 요약해 봅니다(저장하지 않음 · 수십 초 걸릴 수 있음).');
        out.setAttribute('data-bai-sea-out', '1');
        if (offices.length && seaTrial.text) out.style.color = seaTrial.color;
        // 결과는 seaTrial 에 두고, 그때 화면에 있는 결과 칸에 적는다(누른 뒤 다른 칸을 만져 다시 그려졌어도 새 칸에 나온다)
        var show = function (color, text) { seaTrial.color = color; seaTrial.text = text; var o = document.querySelector('[data-bai-sea-out]'); if (o) { o.style.color = color; o.textContent = text; } };
        var done = function () { seaTrial.busy = false; var t = document.querySelector('[data-bai-sea-try]'); if (t) t.disabled = false; };
        var b = btn('시험 요약', function () {
            if (seaTrial.busy) return;   // 도는 중에는 다시 부르지 않는다(운영 키로 나가는 AI 호출이다)
            seaTrial.busy = true; seaTrial.office = osel.value; b.disabled = true;
            show('#94a3b8', '요약하는 중 … (수십 초 걸릴 수 있습니다)');
            fetch('/api/admin/bulletin-ai/try-sea-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ office: osel.value }) })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    done();
                    if (!j || !j.ok) { show('#f87171', '시험 실패 — ' + ((j && j.error) || '응답 없음')); return; }
                    var r = j.result || {}, L = [], color = '#94a3b8';
                    var tried = (r.tried || []).map(function (t) { return t.id + (t.ok ? ' 성공' : ' 실패(' + (t.error || '') + ')'); }).join(' → ');
                    if (r.state === 'ok') {
                        color = '#34d399';
                        L.push('요약됨 · 답한 AI: ' + r.by + ' · ' + j.ms + 'ms' + (tried ? ' · 시도: ' + tried : ''));
                        (r.zones || []).forEach(function (z) { L.push('  [해역] ' + z.zone + ' | ' + z.period + ' | 바람 ' + (z.wind || '-') + ' m/s | 물결 ' + (z.wave || '-') + ' m'); });
                        (r.notes || []).forEach(function (n) { L.push('  [' + n.kind + '] ' + n.text); });
                    } else if (r.state === 'none') {
                        L.push('이 글에는 바다 항목이 없습니다 — AI 를 부르지 않았습니다(화면에는 「해상 기상 내용이 포함되어 있지 않습니다.」).');
                    } else {
                        color = '#f87171';
                        L.push('요약하지 못함(화면에는 원문의 바다 항목이 그대로 나갑니다) · ' + j.ms + 'ms — ' + (r.error || '') + (tried ? ' · 시도: ' + tried : ''));
                    }
                    if ((r.reasons || []).length) L.push('원문 대조에 걸린 까닭: ' + r.reasons.join(' / '));
                    if ((r.dropped || []).length) L.push('쓰인 답에서 버리거나 고친 것: ' + r.dropped.join(' / '));
                    // 답은 왔는데 못 쓴 AI 는 그 답 전체를 보인다(오류 문구는 앞 120자뿐이라 까닭을 알 수 없었다 — 2026-11-19 운영 시험)
                    (r.tried || []).forEach(function (t) { if (!t.ok && t.raw) L.push('', '── ' + t.id + ' 가 낸 답(못 쓴 답 · 앞 4,000자까지) ──', t.raw); });
                    if (j.seaText) L.push('', '── AI 에게 준 바다 글 ──', j.seaText);
                    show(color, L.join('\n'));
                })
                .catch(function (e) { done(); show('#f87171', '시험 실패 — ' + (e && e.message)); });
        }, !offices.length || seaTrial.busy);
        b.setAttribute('data-bai-sea-try', '1');
        row.appendChild(b);
        row.appendChild(out);
        return row;
    }

    /** 한 기능의 순서 목록 카드. [연계] ← draw */
    function drawFeature(host, f) {
        var cfg = state.config[f], ch = state.choices, workers = state.workers || {};
        var card = el('div', 'background:rgba(15,23,42,0.6);border:1px solid #1e293b;border-radius:12px;padding:12px;margin-bottom:14px');
        card.setAttribute('data-bai-feature', f);
        card.appendChild(el('div', 'font-weight:800;color:#e2e8f0;margin-bottom:2px', FEAT[f][0]));
        card.appendChild(el('div', 'color:#94a3b8;font-size:0.78rem;margin-bottom:10px', FEAT[f][1]));
        if (ch.gemma && ch.gemma.features.indexOf(f) >= 0) card.appendChild(gemmaRow(f, cfg, ch, host));   // ③⑥: 먼저 Gemma
        if (f === 'seasummary') card.appendChild(seaTrialRow());   // ⑥: 시험 요약
        var vis = cfg.order.filter(function (id) { return cfg.removed.indexOf(id) < 0; });
        var hid = cfg.order.filter(function (id) { return cfg.removed.indexOf(id) >= 0; });
        var stOf = {}; (state.status || []).forEach(function (s) { stOf[s.id] = s; });
        vis.forEach(function (id, i) {
            var row = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;background:#0b1220;margin-bottom:6px');
            row.appendChild(el('span', 'color:#67e8f9;font-weight:800;width:20px', (i + 1) + ''));
            row.appendChild(el('span', 'color:#e2e8f0;font-weight:700;min-width:78px', NAME[id] || id));
            var st = stOf[id];
            if (id === 'chatgpt') {
                var m = cfg.models.chatgpt;
                row.appendChild(sel(ch.chatgpt.models, m.model, null, function (v) { save(f, { models: { chatgpt: { model: v, runner: m.runner } } }, host); }));
                row.appendChild(sel(ch.chatgpt.runners, m.runner, function (v) { return RUNNER[v] || v; }, function (v) { save(f, { models: { chatgpt: { model: m.model, runner: v } } }, host); }));
                row.appendChild(el('span', 'font-size:0.75rem;color:' + (workers[m.runner] ? '#34d399' : '#fbbf24'), workers[m.runner] ? '연결됨' : '연결 없음 · 건너뜀'));
            } else if (id === 'gemini' && f === 'briefing') {
                // ④ 브리핑만 Gemini 모델을 고른다(종전 브리핑 설정의 두 모델)
                row.appendChild(sel(ch.briefing.geminiModels, cfg.models.gemini.model, null, function (v) { save(f, { models: { gemini: { model: v } } }, host); }));
            } else if (id === 'gemini') {
                row.appendChild(el('span', 'color:#94a3b8;font-size:0.8rem', (ch.gemini.models[0] || '') + ' (고정)'));
            } else {
                var p = cfg.models[id], c = ch[id];
                row.appendChild(sel(c.models, p.model, null, function (v) { var o = {}; o[id] = { model: v, effort: p.effort }; save(f, { models: o }, host); }));
                row.appendChild(sel(c.efforts, p.effort, function (v) { return '노력 ' + v; }, function (v) { var o = {}; o[id] = { model: p.model, effort: v }; save(f, { models: o }, host); }));
                if (st && st.hasKey === false) row.appendChild(el('span', 'font-size:0.75rem;color:#fbbf24', '키 없음 · 건너뜀'));
                else if (st && st.exhaustedAt) row.appendChild(el('span', 'font-size:0.75rem;color:#f87171', '소진 · 건너뜀(AI 챗봇 탭에서 해제)'));
            }
            if (f === 'briefing') {   // ④ 칸별 시도 횟수(사용자 「(나)」)
                var at = sel(ch.briefing.attempts, cfg.attempts[id], function (v) { return '최대 ' + v + '번'; }, function (v) { var o = {}; o[id] = Number(v); save(f, { attempts: o }, host); });
                at.setAttribute('data-bai-attempts', id);
                var sels = row.querySelectorAll('select'), lastSel = sels[sels.length - 1];   // 모델·노력(실행 위치) 고르기 바로 뒤, 상태 글 앞
                if (lastSel && lastSel.nextSibling) row.insertBefore(at, lastSel.nextSibling); else row.appendChild(at);
            }
            var tools = el('span', 'margin-left:auto;display:flex;gap:4px');
            var move = function (d) { var v = vis.slice(), j = i + d, t = v[i]; v[i] = v[j]; v[j] = t; save(f, { order: v.concat(hid) }, host); };
            tools.appendChild(btn('▲', function () { move(-1); }, i === 0));
            tools.appendChild(btn('▼', function () { move(1); }, i === vis.length - 1));
            if (id !== 'gemini') tools.appendChild(btn('삭제', function () {
                if (!w.confirm('정말 삭제하시겠습니까?\n(' + NAME[id] + '을(를) ' + FEAT[f][0] + ' 순서에서 뺍니다)')) return;
                save(f, { removed: cfg.removed.concat(id) }, host);
            }));
            row.appendChild(tools);
            card.appendChild(row);
        });
        if (f === 'briefing') {   // 늘 마지막 — 서버 규칙 문단(고정, 옮기거나 지울 수 없음)
            var rule = el('div', 'display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:8px;background:#0b1220;margin-bottom:6px;opacity:0.75');
            rule.setAttribute('data-bai-rule', '');
            rule.appendChild(el('span', 'color:#64748b;font-weight:800;width:20px', '·'));
            rule.appendChild(el('span', 'color:#cbd5e1;font-weight:700;min-width:78px', '규칙 분석'));
            rule.appendChild(el('span', 'color:#94a3b8;font-size:0.78rem', 'AI 없이 서버 규칙 문단(늘 마지막 · 고정)'));
            card.appendChild(rule);
        }
        if (hid.length) {
            var h = el('div', 'color:#94a3b8;font-size:0.8rem;margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center', '삭제된 AI:');
            hid.forEach(function (id) {
                h.appendChild(btn(NAME[id] + ' 다시 추가', function () {
                    // 보이는 줄의 맨 뒤(맨 뒤가 Gemini 면 그 바로 앞)에 넣는다 — AI 챗봇 탭과 같은 규칙
                    var v = vis.slice(), at = v[v.length - 1] === 'gemini' ? v.length - 1 : v.length;
                    v.splice(at, 0, id);
                    save(f, { order: v.concat(hid.filter(function (x) { return x !== id; })), removed: cfg.removed.filter(function (x) { return x !== id; }) }, host);
                }));
            });
            card.appendChild(h);
        }
        host.appendChild(card);
    }

    /** 전체 다시 그리기. err 가 있으면 맨 위에 붉게. [연계] ← renderBulletinAiAdmin·save */
    function draw(host, err) {
        if (!box || !document.body.contains(box)) return;   // 다른 하위 탭으로 바뀜 — 그리지 않는다
        host = box;
        host.innerHTML = '';
        var title = el('div', 'font-weight:800;color:#e2e8f0;font-size:1rem;margin-bottom:4px', '기능별 AI 우선순위 — 특보 분석 · 연안 안전 브리핑');
        host.appendChild(title);
        host.appendChild(el('div', 'color:#94a3b8;font-size:0.8rem;margin-bottom:12px', '위에서부터 시도하고, 실패하거나 쓸 수 없으면(키 없음·소진·작업자 연결 없음) 다음 순위로 넘어갑니다. 바꾸면 바로 저장됩니다.'));
        if (err) host.appendChild(el('div', 'color:#fca5a5;margin-bottom:10px', err));
        if (!state) return;
        drawFeature(host, 'read');
        drawFeature(host, 'interpret');
        drawFeature(host, 'forecast');
        if (state.config.briefing) drawFeature(host, 'briefing');   // ④ — 옛 서버(briefing 없음)면 그리지 않는다
        if (state.config.escalation) drawFeature(host, 'escalation');   // ⑤ — 옛 서버면 그리지 않는다
        if (state.config.seasummary) drawFeature(host, 'seasummary');   // ⑥ — 옛 서버면 그리지 않는다
    }

    /**
     * 「AI 특보 분석」 하위 탭을 그린다(서버에서 설정을 받아 온 뒤).
     * @param {HTMLElement} host - switchAiSubTab 의 #ai-subtab-body
     * [연계] ← admin.js switchAiSubTab('bulletinAi') → GET /api/admin/bulletin-ai/config
     */
    w.renderBulletinAiAdmin = function (host) {
        host.innerHTML = '';
        // 맨 위: 「AI 챗봇 모델」(나리야 답변 순서·일반 사용자 적용·ChatGPT 실행 위치 — ai_chat.js 가 그리고 저장한다)
        host.appendChild(el('div', 'font-weight:800;color:#e2e8f0;font-size:1rem;margin-bottom:6px', 'AI 챗봇 모델'));
        var chat = el('div', 'margin-bottom:22px', '');
        host.appendChild(chat);
        if (w.NariyaChat && typeof w.NariyaChat.renderModelSettingsInto === 'function') w.NariyaChat.renderModelSettingsInto(chat);
        else chat.appendChild(el('div', 'color:#fca5a5', '나리야 모듈(js/ai-chat/ai_chat.js)이 로드되지 않았습니다.'));
        // 그 아래: 「AI 특보 분석」 — draw 는 이 상자만 다시 그린다(위 챗봇 카드를 지우지 않게)
        box = el('div', '', ''); host.appendChild(box);
        box.innerHTML = '<div style="padding:20px;color:#94a3b8">불러오는 중…</div>';
        busy = false;
        fetch(API, { cache: 'no-store' })
            .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
            .then(function (x) {
                if (x.status === 200 && x.body && x.body.ok) { state = x.body; draw(host); }
                else draw(host, x.status === 401 || x.status === 403 ? '관리자 로그인이 필요합니다.' : ((x.body && x.body.error) || ('불러오기 실패 HTTP ' + x.status)));
            })
            .catch(function (e) { draw(host, '네트워크 오류: ' + (e && e.message)); });
    };
})(window);
