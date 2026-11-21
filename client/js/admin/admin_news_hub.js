/**
 * ============================================================================
 * 파일명: client/js/admin/admin_news_hub.js
 * 역할  : 통합관리자 → 게시판 관리 → 「어황정보」·「오늘의 뉴스」 칸(2026-11-21 시안 8-2·8-3).
 *         어황정보: 마지막 확인 시각·결과·보관 건수 · [지금 확인] · 글마다 [원문]·[숨기기/다시 보이기]·[다시 변환]·[삭제].
 *         오늘의 뉴스: 날짜 고르기 · 마지막 갱신 시각·결과·이번 회차 받음→실음·오류 · [지금 갱신] · 수집 검색어 추가·삭제 ·
 *                     실린 기사 [원문]·[숨기기/다시 보이기] · AI 가 뺀 기사 [원문]·[싣기](분류 고르기).
 *         「마지막 확인·결과」를 늘 띄운다 — 점검이 고장 나도 빈 목록이 「이상 없음」처럼 보이던 일(CLAUDE.md 결정로그 2026-09-20)을 막으려고.
 * 사용자: 「뺀기사는 원문 링크 볼수있는 버튼 [원문] 반영」 · 시안 8-1 A(위에 3칸) · 「추천대로」(관리자가 검색어 추가·삭제)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js(window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 을 붙인다) · admin/admin_collect.js(switchNhubAdminTab 이 나를 부른다)
 *  - 서버 API      : GET /api/admin/fishcond · POST /api/admin/fishcond/:id/(hide|delete|reconvert) · POST /api/admin/fishcond/run (routes/fishcond.js)
 *                    GET /api/admin/news?date= · POST /api/admin/news/:date/:id/hide · POST /api/admin/news/:date/publish · POST /api/admin/news/keywords · POST /api/admin/news/run (routes/news.js)
 *  - 마크업        : 없음(admin_collect.js 의 #nhub-admin-other 상자에 그린다)
 *  - 나를 쓰는 곳  : admin_collect.js renderUnifiedPromoContent → switchNhubAdminTab('fishcond'|'news')
 * [로드 순서] admin/admin_bulletin_ai.js 다음 — admin.js(fetch 래퍼) 뒤면 된다
 * ============================================================================
 */
(function (w) {
    'use strict';
    var CATS = { money: '돈', duty: '처벌·의무', rule: '조업·이용 규칙', safety: '안전', sea: '바다 여건', conflict: '바다 이용 갈등·제도' };
    var CAT_COLOR = { money: '#69f0ae', duty: '#ff5252', rule: '#ffab40', safety: '#448aff', sea: '#4dd0e1', conflict: '#b388ff' };
    var SEA_COLOR = { '서해': '#448aff', '남해': '#69f0ae', '동해': '#4dd0e1', '전국': '#cbd5e1' };
    var STATUS = { ok: '정상', no_pdf: 'PDF 없음', convert_failed: '그림 실패', pending: '받는 중' };
    var newsDate = null, newsBusy = false;

    function api(p) { return ((w.CONFIG && w.CONFIG.API_BASE) || '') + p; }
    function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text != null) e.textContent = String(text); return e; }
    function btn(label, onClick, kind) {
        var b = el('button', 'background:' + (kind === 'blue' ? '#2f6bff' : kind === 'red' ? '#2a1a20' : '#253048') + ';border:1px solid ' + (kind === 'blue' ? '#2f6bff' : kind === 'red' ? '#5a2b33' : '#33405c') + ';color:' + (kind === 'red' ? '#ff8a8a' : '#e2e8f0') + ';border-radius:7px;padding:4px 10px;font-size:0.78rem;cursor:pointer;white-space:nowrap;', label);
        b.type = 'button'; b.addEventListener('click', onClick); return b;
    }
    function tag(text, color) { return el('span', 'font-size:0.7rem;font-weight:700;padding:1px 8px;border-radius:10px;border:1px solid ' + color + ';color:' + color + ';white-space:nowrap;', text); }
    /** KST 시각 글자. 예: '2026-11-21T00:02:00Z' → '11.21 09:02' */
    function kst(iso) { var t = Date.parse(iso); if (!isFinite(t)) return '—'; var k = new Date(t + 9 * 3600000); return String(k.getUTCMonth() + 1).padStart(2, '0') + '.' + String(k.getUTCDate()).padStart(2, '0') + ' ' + String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0'); }
    function openLink(u) { if (/^https?:\/\//i.test(u || '')) w.open(u, '_blank', 'noopener'); }
    function row() { return el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#1a2336;border:1px solid #273148;border-radius:10px;padding:8px 10px;margin-bottom:6px;'); }
    function title(text) { return el('div', 'flex:1;min-width:160px;color:#e2e8f0;font-size:0.85rem;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere;', text); }
    function small(text, color) { return el('span', 'font-size:0.75rem;color:' + (color || '#94a3b8') + ';white-space:nowrap;', text); }
    function heading(text) { return el('div', 'font-weight:800;color:#cdd6e5;font-size:0.9rem;margin:14px 0 6px;', text); }
    /** 상태 상자 — 칸 하나씩(작은 이름 + 굵은 값). @param {Array<[string,string,string?]>} cells [이름, 값, 색] */
    function statBox(cells, extra) {
        var box = el('div', 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#0e1524;border:1px solid #2a3449;border-radius:10px;padding:10px 12px;margin-bottom:8px;');
        cells.forEach(function (c) { var d = el('div', 'flex:1 1 120px;min-width:0;'); d.appendChild(el('div', 'font-size:0.7rem;color:#64748b;', c[0])); d.appendChild(el('div', 'font-weight:700;font-size:0.85rem;color:' + (c[2] || '#e2e8f0') + ';', c[1])); box.appendChild(d); });
        if (extra) box.appendChild(extra);
        return box;
    }
    async function post(path, body) {
        var r = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
    }
    function failBox(host, msg) { host.innerHTML = ''; host.appendChild(el('div', 'padding:16px;color:#fca5a5;', msg)); }

    // ── 어황정보 ─────────────────────────────────────────────────────────
    /**
     * 어황정보 칸을 그린다.
     * @param {HTMLElement} host [연계] ← admin_collect.js switchNhubAdminTab('fishcond') / → GET /api/admin/fishcond
     */
    async function renderAdminFishcond(host) {
        host.innerHTML = '<div style="padding:16px;color:#94a3b8;">불러오는 중…</div>';
        var j;
        try { var r = await fetch(api('/api/admin/fishcond')); j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); }
        catch (e) { return failBox(host, '어황정보를 불러오지 못했습니다: ' + (e && e.message)); }
        if (!host.isConnected) return;
        host.innerHTML = '';
        var st = j.state || {}, posts = j.posts || [];
        var mb = posts.reduce(function (s, p) { return s + (p.bytes || 0); }, 0) / 1048576;
        var runBtn = btn(j.running ? '확인 중…' : '지금 확인', async function () {
            runBtn.disabled = true; runBtn.textContent = '확인 중…';
            try { await post('/api/admin/fishcond/run'); } catch (e) { alert('지금 확인 실패: ' + e.message); }
            setTimeout(function () { renderAdminFishcond(host); }, 8000);
        }, 'blue');
        runBtn.disabled = !!j.running;
        host.appendChild(statBox([
            ['마지막 확인', st.lastRun ? kst(st.lastRun) : '아직 없음'],
            ['결과', !st.lastRun ? '—' : st.ok ? '정상 · 새 글 ' + (st.added || 0) + '건' : '실패', !st.lastRun ? null : st.ok ? '#34d399' : '#f87171'],
            ['보관 중', posts.length + '건 · ' + mb.toFixed(1) + 'MB (PDF 기준)'],
        ], runBtn));
        if (st.lastRun && !st.ok) host.appendChild(el('div', 'color:#f87171;font-size:0.8rem;margin:-2px 2px 8px;', '실패 까닭: ' + (st.error || '알 수 없음')));
        host.appendChild(el('div', 'color:#94a3b8;font-size:0.78rem;margin-bottom:8px;', '국립수산과학원 어황정보 게시판을 매시 7분에 확인합니다. 최근 7일 새 글만 받고 30일이 지나면 지웁니다. 숨긴 글은 앱 목록에서만 빠집니다.'));
        if (!posts.length) { host.appendChild(el('div', 'padding:12px;color:#94a3b8;', '받아 둔 글이 없습니다.')); return; }
        posts.forEach(function (p) {
            var r = row(); if (p.hidden) r.style.opacity = '0.5';
            r.appendChild(tag(p.sea || '전국', SEA_COLOR[p.sea] || '#cbd5e1'));
            r.appendChild(title(p.title + (p.hidden ? ' (숨김)' : '')));
            r.appendChild(small(String(p.date || '').replace(/-/g, '.')));
            r.appendChild(small(STATUS[p.status] || p.status, p.status === 'ok' ? '#94a3b8' : '#fbbf24'));
            r.appendChild(small('조회 ' + (p.views || 0)));
            r.appendChild(btn('원문', function () { openLink(p.sourceUrl); }));
            r.appendChild(btn(p.hidden ? '다시 보이기' : '숨기기', async function () {
                try { await post('/api/admin/fishcond/' + p.id + '/hide', { hidden: !p.hidden }); renderAdminFishcond(host); } catch (e) { alert('실패: ' + e.message); }
            }));
            if (p.status !== 'ok') r.appendChild(btn('다시 변환', async function () {
                try { var x = await post('/api/admin/fishcond/' + p.id + '/reconvert'); alert('다시 변환 결과: ' + (STATUS[x.status] || x.status)); renderAdminFishcond(host); } catch (e) { alert('실패: ' + e.message); }
            }));
            r.appendChild(btn('삭제', async function () {
                if (!w.confirm('「' + p.title + '」을(를) 지울까요?\n(PDF·그림까지 지우고, 다시 받지 않습니다)')) return;
                try { await post('/api/admin/fishcond/' + p.id + '/delete'); renderAdminFishcond(host); } catch (e) { alert('실패: ' + e.message); }
            }, 'red'));
            host.appendChild(r);
        });
    }

    // ── 오늘의 뉴스 ─────────────────────────────────────────────────────
    /**
     * 오늘의 뉴스 칸을 그린다.
     * @param {HTMLElement} host @param {string} [date] YYYY-MM-DD(없으면 오늘)
     * [연계] ← admin_collect.js switchNhubAdminTab('news') / → GET /api/admin/news
     */
    async function renderAdminNews(host, date) {
        if (date) newsDate = date;
        host.innerHTML = '<div style="padding:16px;color:#94a3b8;">불러오는 중…</div>';
        var j;
        try { var r = await fetch(api('/api/admin/news' + (newsDate ? '?date=' + newsDate : ''))); j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); }
        catch (e) { return failBox(host, '오늘의 뉴스를 불러오지 못했습니다: ' + (e && e.message)); }
        if (!host.isConnected) return;
        newsDate = j.date;
        host.innerHTML = '';
        var st = j.state || {};
        // 날짜 고르기
        var top = el('div', 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;');
        top.appendChild(el('span', 'color:#94a3b8;font-size:0.8rem;', '날짜'));
        var sel = el('select', 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font-size:0.82rem;');
        var ds = (j.dates || []).slice(); if (ds.indexOf(j.date) < 0) ds.push(j.date);
        ds.sort().reverse().forEach(function (d) { var o = el('option', '', d); o.value = d; if (d === j.date) o.selected = true; sel.appendChild(o); });
        sel.addEventListener('change', function () { renderAdminNews(host, sel.value); });
        top.appendChild(sel);
        host.appendChild(top);
        // 상태
        var runBtn = btn(j.running ? '갱신 중…' : '지금 갱신', async function () {
            runBtn.disabled = true; runBtn.textContent = '갱신 중…';
            try { await post('/api/admin/news/run'); } catch (e) { alert('지금 갱신 실패: ' + e.message); }
            setTimeout(function () { renderAdminNews(host); }, 15000);
        }, 'blue');
        runBtn.disabled = !!j.running;
        var prov = st.providers ? Object.keys(st.providers).map(function (k) { return k + ' ' + st.providers[k]; }).join(' · ') : '';
        host.appendChild(statBox([
            ['마지막 갱신', st.lastRun ? kst(st.lastRun) : '아직 없음'],
            ['결과', !st.lastRun ? '—' : st.ok ? '정상 · 새 카드 ' + (st.added || 0) + '장' : '실패', !st.lastRun ? null : st.ok ? '#34d399' : '#f87171'],
            ['이번 회차', st.lastRun ? '받음 ' + (st.fetched || 0) + ' → 판정 ' + (st.judged || 0) + ' → 실음 ' + (st.kept || 0) : '—'],
            ['판정한 AI', prov || '—'],
        ], runBtn));
        if (st.lastRun && !st.ok) host.appendChild(el('div', 'color:#f87171;font-size:0.8rem;margin:-2px 2px 8px;', '실패 까닭: ' + (st.error || '알 수 없음')));
        if (st.keywordErrors && st.keywordErrors.length) host.appendChild(el('div', 'color:#fbbf24;font-size:0.78rem;margin:-2px 2px 8px;', '받지 못한 검색어 ' + st.keywordErrors.length + '개: ' + st.keywordErrors.slice(0, 3).join(' / ')));
        host.appendChild(el('div', 'color:#94a3b8;font-size:0.78rem;margin-bottom:4px;', '매시 2분에 네이버 뉴스를 모아 「AI 모델 설정 ⑦」 순서의 AI 가 판정합니다(3점 이상만 실음). 숨긴 카드는 앱에서만 빠집니다.'));
        // 검색어
        host.appendChild(heading('수집 검색어 (' + (j.keywords || []).length + '개)'));
        var chips = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;');
        var saveKw = async function (list) { if (newsBusy) return; newsBusy = true; try { await post('/api/admin/news/keywords', { keywords: list }); } catch (e) { alert('검색어 저장 실패: ' + e.message); } newsBusy = false; renderAdminNews(host); };
        (j.keywords || []).forEach(function (k) {
            var c = el('span', 'display:inline-flex;align-items:center;gap:4px;background:#1f2a40;border:1px solid #33405c;border-radius:12px;padding:2px 4px 2px 9px;font-size:0.78rem;color:#e2e8f0;', k);
            var x = el('button', 'background:none;border:0;color:#94a3b8;cursor:pointer;font-size:0.85rem;padding:0 3px;', '×'); x.type = 'button'; x.setAttribute('aria-label', k + ' 삭제');
            x.addEventListener('click', function () { if ((j.keywords || []).length <= 1) return alert('검색어는 하나 이상 있어야 합니다.'); saveKw(j.keywords.filter(function (y) { return y !== k; })); });
            c.appendChild(x); chips.appendChild(c);
        });
        host.appendChild(chips);
        var add = el('div', 'display:flex;gap:6px;margin-bottom:6px;');
        var inp = el('input', 'flex:1;min-width:0;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px 8px;font-size:0.82rem;'); inp.placeholder = '새 검색어(예: 해루질 단속)'; inp.maxLength = 60;
        var addFn = function () { var v = inp.value.trim(); if (!v) return; if ((j.keywords || []).indexOf(v) >= 0) return alert('이미 있는 검색어입니다.'); saveKw((j.keywords || []).concat(v)); };
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') addFn(); });
        add.appendChild(inp); add.appendChild(btn('+ 추가', addFn, 'blue'));
        host.appendChild(add);
        // 실린 기사
        host.appendChild(heading('실린 기사 (' + (j.cards || []).length + '장)'));
        if (!(j.cards || []).length) host.appendChild(el('div', 'padding:6px 2px 10px;color:#94a3b8;font-size:0.82rem;', '이날 실린 기사가 없습니다.'));
        (j.cards || []).forEach(function (c) {
            var r = row(); if (c.hidden) r.style.opacity = '0.5';
            if (c.catName) r.appendChild(tag(c.catName, CAT_COLOR[c.cat] || '#cbd5e1'));
            r.appendChild(title(c.title + (c.more ? ' (' + c.source + ' 외 ' + c.more + '건)' : '') + (c.hidden ? ' (숨김)' : '') + (c.manual ? ' (관리자가 실음)' : '')));
            r.appendChild(small(c.time));
            r.appendChild(small((c.score || '-') + '점 · 펼침 ' + (c.views || 0)));
            r.appendChild(btn('원문', function () { openLink(c.link); }));
            r.appendChild(btn(c.hidden ? '다시 보이기' : '숨기기', async function () {
                try { await post('/api/admin/news/' + j.date + '/' + c.id + '/hide', { hidden: !c.hidden }); renderAdminNews(host); } catch (e) { alert('실패: ' + e.message); }
            }));
            host.appendChild(r);
        });
        // AI 가 뺀 기사
        host.appendChild(heading('AI 가 뺀 기사 (' + (j.rejected || []).length + '건) — 잘못 빠진 것을 실을 수 있습니다'));
        if (!(j.rejected || []).length) host.appendChild(el('div', 'padding:6px 2px 10px;color:#94a3b8;font-size:0.82rem;', '이날 뺀 기사가 없습니다.'));
        (j.rejected || []).forEach(function (x) {
            var r = row();
            var t = title(x.title); t.style.color = '#94a3b8'; r.appendChild(t);
            r.appendChild(small(x.time));
            r.appendChild(small(x.score + '점' + (x.reason ? ' · ' + x.reason : ''), '#64748b'));
            r.appendChild(btn('원문', function () { openLink(x.link); }));
            var cs = el('select', 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:3px 6px;font-size:0.75rem;');
            [['', '분류 없음']].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k]]; })).forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; cs.appendChild(op); });
            r.appendChild(cs);
            r.appendChild(btn('싣기', async function () {
                try { await post('/api/admin/news/' + j.date + '/publish', { index: x.index, cat: cs.value }); renderAdminNews(host); } catch (e) { alert('싣기 실패: ' + e.message); }
            }, 'blue'));
            host.appendChild(r);
        });
    }

    w.renderAdminFishcond = renderAdminFishcond;
    w.renderAdminNews = function (host) { return renderAdminNews(host); };
})(window);
