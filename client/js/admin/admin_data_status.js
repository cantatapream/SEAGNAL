/**
 * ============================================================================
 * 파일명: client/js/admin/admin_data_status.js
 * 역할  : 관리자 → 점검 → 「데이터 수집현황」 화면(수집 목록·현재 원천 상태·오류·복구 이력)
 *         앱이 모으는 데이터마다 공식 갱신 시기·우리 수집 시각·
 *         지금 반영된 자료의 기준 시각·다음 기대 시각·상태를 카드로 보여 주고(수집 목록),
 *         위험예측 원천의 현재 상태와 오류·복구 이력(종전 AI → AI 사고예측 화면)을 같은 자리에서 연다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js (renderAiForecastSubtab — 현재 원천 상태·오류·복구 이력,
 *                    window.fetch 관리자 토큰 래퍼 adminAwareFetch)
 *  - 서버 API      : GET /api/admin/data-collection (routes/data_collection.js) ·
 *                    GET /api/admin/risk-forecast/errors (renderAiForecastSubtab 이 부름)
 *  - 마크업        : 관리자 센터 모달 #maint-subtab-body (admin.js renderUnifiedMaintenanceContent 가 만듦)
 *  - 나를 쓰는 곳  : admin.js switchMaintenanceSubTab('data') → window.renderDataCollectionTab
 * [로드 순서] admin/admin.js 다음 · admin/admin_collect.js 이전 — 순서 변경 금지
 *             (호출은 사용자가 탭을 누를 때라 admin.js 의 함수가 먼저 정의돼 있어야 한다)
 * ============================================================================
 */
(function () {
    'use strict';

    // 상태 이름·색 — admin.js renderAiForecastSubtab 의 오류현황 배지와 같은 값(정상 초록·오래됨 노랑·일부 실패 주황·
    //   수집 실패 빨강·자료 없음 회색·비운영 청록). 같은 화면 묶음 안에서 같은 색이 같은 뜻이 되게 한다.
    var STATUS = { ok: '정상', offseason: '비운영 기간', partial: '일부 실패', error: '수집 실패', stale: '자료 오래됨', missing: '자료 없음' };
    var TONE = { ok: '52,211,153', stale: '251,191,36', partial: '251,146,60', error: '248,113,113', missing: '148,163,184', offseason: '34,211,238' };
    var KIND = { doc: '문서', measured: '실측' };
    var SUBTAB_KEY = 'seagnal_datastatus_subtab';

    function esc(v) {
        return String(v == null ? '—' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function kst(v) {
        return v && Number.isFinite(Date.parse(v))
            ? new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) + ' KST'
            : null;
    }

    /**
     * 데이터 수집현황 화면(하위 탭 셋)을 그린다.
     * 예: 점검 → 데이터 수집현황 → [수집 목록] [현재 원천 상태] [오류·복구 이력]. 마지막으로 연 하위 탭을 기억한다.
     * @param {HTMLElement} container - #maint-subtab-body
     * @returns {void}
     * [연계] ← admin.js switchMaintenanceSubTab('data') / → renderDataCollectionList(이 파일) ·
     *        admin.js renderAiForecastSubtab(view:'current'|'history') — 원천 상태·이력은 종전 화면을 그대로 쓴다
     */
    function renderDataCollectionTab(container) {
        var saved = 'list';
        try { saved = localStorage.getItem(SUBTAB_KEY) || 'list'; } catch (e) { /* 사생활 모드 — 기본 탭 */ }
        var tabs = [['list', '수집 목록', 'fa-list-check'], ['current', '현재 원천 상태', 'fa-signal'], ['history', '오류·복구 이력', 'fa-clock-rotate-left']];
        container.innerHTML =
            '<div data-ds-tabs style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">'
            + tabs.map(function (t) {
                return '<button type="button" data-ds-tab="' + t[0] + '" style="padding:7px 12px;border:none;border-radius:8px;background:transparent;color:#94a3b8;font-weight:700;cursor:pointer;font-size:0.82rem;">'
                    + '<i class="fa-solid ' + t[2] + '"></i> ' + t[1] + '</button>';
            }).join('')
            + '</div><div data-ds-body></div>';
        var bar = container.querySelector('[data-ds-tabs]'), body = container.querySelector('[data-ds-body]');
        function open(which) {
            try { localStorage.setItem(SUBTAB_KEY, which); } catch (e) { /* 기억 못 해도 화면은 연다 */ }
            bar.querySelectorAll('[data-ds-tab]').forEach(function (b) {
                var on = b.getAttribute('data-ds-tab') === which;
                b.style.background = on ? 'rgba(34,211,238,0.18)' : 'transparent';
                b.style.color = on ? '#67e8f9' : '#94a3b8';
            });
            // 하위 탭마다 새 상자를 만든다 — 이전 탭의 늦은 응답은 자기 상자가 떨어져 나가 무시된다.
            body.innerHTML = '<div></div>';
            var host = body.firstElementChild;
            if (which === 'list') renderDataCollectionList(host);
            else if (typeof window.renderAiForecastSubtab === 'function') window.renderAiForecastSubtab(host, { view: which });
            else host.innerHTML = '<div style="padding:12px;color:#fca5a5;">오류현황 모듈(admin.js)이 로드되지 않았습니다.</div>';
        }
        bar.querySelectorAll('[data-ds-tab]').forEach(function (b) {
            b.onclick = function () { open(b.getAttribute('data-ds-tab')); };
        });
        open(['list', 'current', 'history'].indexOf(saved) >= 0 ? saved : 'list');
    }

    /** 상태 배지. 예: stale → 노란 「자료 오래됨」. data-ds-badge 는 검사가 색을 읽는 자리. */
    function badge(status) {
        var tone = TONE[status] || TONE.missing;
        return '<span data-ds-badge="' + esc(status) + '" style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;white-space:nowrap;'
            + 'background:rgba(' + tone + ',0.15);color:rgb(' + tone + ');border:1px solid rgba(' + tone + ',0.3);">' + esc(STATUS[status] || status) + '</span>';
    }
    /** 「이름 칸 · 값」 두 줄 격자. 값이 null 이면 「기록 없음」(지어내지 않는다). */
    function lines(pairs) {
        return '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;margin-top:8px;font-size:0.78rem;line-height:1.45;">'
            + pairs.map(function (p) {
                var v = p[1] == null || p[1] === '' ? '<span style="color:#64748b;">기록 없음</span>' : p[2] ? p[1] : esc(p[1]);
                return '<span style="color:#64748b;white-space:nowrap;">' + p[0] + '</span><span style="color:#cbd5e1;overflow-wrap:anywhere;">' + v + '</span>';
            }).join('') + '</div>';
    }
    /** 근거 목록(파일:줄 · 인용 · 메모 · 주소)을 접힌 상자로. */
    function refs(title, list) {
        if (!list || !list.length) return '';
        return '<div style="margin-top:4px;"><span style="color:#64748b;">' + title + '</span><ul style="margin:2px 0 0 16px;padding:0;">'
            + list.map(function (r) {
                if (r.note) return '<li>' + esc(r.note) + '</li>';
                if (r.url) return '<li>' + esc(r.url) + '</li>';
                if (typeof r === 'string') return '<li><code style="color:#93c5fd;">' + esc(r) + '</code></li>';
                return '<li><code style="color:#93c5fd;">' + esc(r.ref) + '</code>' + (r.missing ? ' <span style="color:#fca5a5;">(인용 못 찾음)</span>' : '')
                    + (r.quote ? '<div style="color:#94a3b8;overflow-wrap:anywhere;">「' + esc(r.quote) + '」</div>' : '') + '</li>';
            }).join('') + '</ul></div>';
    }
    /** 카드 한 장. 왼쪽 띠 색 = 상태. */
    function card(it) {
        var tone = TONE[it.status] || TONE.missing, off = it.official || {};
        var official = off.kind
            ? '<span style="display:inline-block;padding:0 6px;margin-right:4px;border-radius:6px;font-size:0.68rem;font-weight:700;background:rgba(255,255,255,.08);color:#e2e8f0;">' + esc(KIND[off.kind] || off.kind) + '</span>' + esc(off.text)
            : '<span data-ds-needcheck style="color:#fbbf24;font-weight:700;">확인 필요</span>';
        var basis = it.basis && (it.basis.at || it.basis.raw)
            ? (it.basis.label ? it.basis.label + ' ' : '') + (kst(it.basis.at) || it.basis.raw)
            : null;
        var next = kst(it.nextExpectedAt);
        if (next && it.nextFrom === 'schedule') next += ' (일정표상 다음 회차)';
        if (!next && it.nextNote) next = '정할 수 없음 — ' + it.nextNote;
        return '<div data-ds-card="' + esc(it.id) + '" style="background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06);border-left:3px solid rgb(' + tone + ');border-radius:8px;padding:10px 12px;margin-top:8px;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">'
            + '<span style="color:#e2e8f0;font-weight:700;font-size:0.88rem;">' + esc(it.name) + '</span>' + badge(it.status) + '</div>'
            + lines([
                ['공식 갱신', official, true],
                ['우리 수집 시각', it.schedule && it.schedule.text],
                ['마지막 수집', kst(it.collectedAt)],
                ['자료 기준 시각', basis],
                ['다음 기대 시각', next],
                ['상태 근거', it.reason],
                ['상세', it.detail],
            ].filter(function (p, i) { return i !== 6 || p[1]; }))
            + '<details style="margin-top:6px;font-size:0.74rem;color:#cbd5e1;"><summary style="cursor:pointer;color:#94a3b8;">근거 보기</summary>'
            + (it.endpoint ? '<div style="margin-top:4px;"><span style="color:#64748b;">받는 곳</span> ' + esc(it.endpoint) + '</div>' : '')
            + refs('공식 갱신 근거', off.evidence) + refs('참고(출처 표기 없는 주석 — 근거로 치지 않음)', off.reference)
            + refs('수집 일정 근거', it.schedule && it.schedule.evidence) + refs('상태를 읽은 곳', it.stateFrom)
            + '</details></div>';
    }

    /**
     * 「수집 목록」— 출처별로 묶은 데이터 카드와 위쪽 요약(상태별 개수·확인 필요 개수)을 그린다.
     * 예: 기상청 MMIS 묶음 안에 「시정 예측 (기상청 MMIS)」 카드 — 공식 갱신 「확인 필요」·다음 기대 시각·상태.
     * @param {HTMLElement} container @returns {Promise<void>}
     * [연계] → GET /api/admin/data-collection(routes/data_collection.js → services/data_collection_status.list)
     *        탭을 떠난 뒤 늦게 온 응답은 버린다(container 가 문서에서 떨어졌는지로 판단)
     */
    function renderDataCollectionList(container) {
        container.innerHTML =
            '<div class="admin-section-title"><span><i class="fa-solid fa-database" style="color:#22d3ee;"></i> 수집 목록</span></div>'
            + '<div style="color:#94a3b8;font-size:0.8rem;margin-bottom:10px;line-height:1.5;">앱이 모으는 데이터마다 공식 갱신 시기와 우리 수집 시각, 지금 쓰는 자료의 기준 시각을 보여 줍니다. '
            + '<b>다음 기대 시각</b>이 지났는데 새 자료가 없으면 노랑(자료 오래됨), 실패가 이어지면 빨강(수집 실패)입니다. 공식 갱신 시기는 근거가 있는 것만 적고, 없으면 「확인 필요」입니다.</div>'
            + '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">'
            + '<label style="flex:1 1 160px;min-width:0;display:block;color:#64748b;font-size:0.72rem;">출처<select data-ds-provider style="width:100%;margin-top:3px;padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:#0f1b33;color:#fff;font-size:0.8rem;box-sizing:border-box;"><option value="">전체</option></select></label>'
            + '<button type="button" data-ds-refresh style="padding:8px 14px;background:#3b82f6;color:#fff;border:none;border-radius:7px;font-size:0.8rem;font-weight:700;cursor:pointer;"><i class="fa-solid fa-rotate-right"></i> 새로고침</button>'
            + '</div><div data-ds-list aria-live="polite"></div>';
        var list = container.querySelector('[data-ds-list]'), pick = container.querySelector('[data-ds-provider]'), last = null, request = 0;
        function draw() {
            if (!last) return;
            var want = pick.value, counts = {};
            last.items.forEach(function (it) { counts[it.status] = (counts[it.status] || 0) + 1; });
            var head = '<div data-ds-summary style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:0.78rem;color:#cbd5e1;line-height:1.7;">'
                + '<div style="color:#64748b;font-size:0.74rem;">확인 시각 ' + esc(kst(last.now)) + ' · 데이터 ' + last.counts.items + '종(1단계 위험예측 ' + last.counts.stage1 + ' · 2단계 그 밖 ' + last.counts.stage2 + ') · 공식 갱신 「확인 필요」 ' + last.counts.needCheck + '종</div>'
                + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">' + ['error', 'stale', 'missing', 'partial', 'ok', 'offseason'].filter(function (k) { return counts[k]; }).map(function (k) {
                    return badge(k) + '<span style="margin-right:6px;">' + counts[k] + '</span>';
                }).join('') + '</div></div>';
            var groups = last.providers.filter(function (p) { return !want || p.id === want; }).map(function (p) {
                var items = last.items.filter(function (it) { return it.provider === p.id; });
                if (!items.length) return '';
                return '<div data-ds-group="' + esc(p.id) + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px;margin-bottom:12px;">'
                    + '<div style="font-size:0.85rem;color:#94a3b8;">' + esc(p.name) + ' <span style="color:#64748b;">(' + items.length + ')</span></div>'
                    + items.map(card).join('') + '</div>';
            }).join('');
            list.innerHTML = head + (groups || '<div style="color:#64748b;font-size:0.8rem;padding:10px 0;">조건에 맞는 데이터가 없습니다.</div>');
        }
        function load() {
            var n = ++request;
            list.innerHTML = '<div style="color:#64748b;font-size:0.8rem;padding:6px 0;">수집현황을 불러오는 중입니다.</div>';
            fetch('/api/admin/data-collection').then(function (r) {
                if (!r.ok) throw Error('unavailable');
                return r.json();
            }).then(function (result) {
                if (n !== request || !container.isConnected) return;
                last = result;
                var keep = pick.value;
                pick.innerHTML = '<option value="">전체</option>' + result.providers.map(function (p) {
                    return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
                }).join('');
                pick.value = keep;
                draw();
            }).catch(function () {
                if (n !== request || !container.isConnected) return;
                console.warn('[관리자] 데이터 수집현황 조회 실패');
                list.innerHTML = '<div style="padding:12px;border-radius:8px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);color:#fca5a5;font-size:0.82rem;">수집현황을 불러오지 못했습니다. 새로고침으로 다시 시도해주세요.</div>';
            });
        }
        pick.onchange = draw;
        container.querySelector('[data-ds-refresh]').onclick = load;
        load();
    }

    window.renderDataCollectionTab = renderDataCollectionTab;
    window.renderDataCollectionList = renderDataCollectionList;
})();
