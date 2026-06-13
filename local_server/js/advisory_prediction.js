/**
 * ============================================================================
 * 파일명: js/advisory_prediction.js  (Phase 5 — v6 카드 재설계)
 * 역할: "해역별 특보 예측" 아코디언 렌더러.
 *   - 섹션 헤더: 제목 옆 ⓘ(팝업) · 제목 아래 기준시각 레이어(흰색, KST)
 *   - 해역 카드: 닫힌 아코디언(탭하면 펼침), 등급색 하이라이트, 확률 차등(51~70%)
 *   - 교차참조: 발표청명 + 발표시각 + kt(m/s) 병기
 *  ※ 기상청 공식 특보가 아닌, 위험기상일기도 분석 + 과거 특보 데이터 기반 자체 예측.
 *
 * [순수 함수(노드 테스트)] buildAdvisoryHtml / buildHeaderStatus / formatBaseTime / escapeHtml
 * ============================================================================
 */
(function () {
    'use strict';

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // baseTimeKST("2026061021") → "06월 10일 21시 기준" (KST). 형식 불량 시 ''.
    function formatBaseTime(baseTimeKST) {
        if (!baseTimeKST || !/^\d{10}$/.test(String(baseTimeKST))) return '';
        const s = String(baseTimeKST);
        return `${s.slice(4, 6)}월 ${s.slice(6, 8)}일 ${s.slice(8, 10)}시 기준`;
    }

    function normVisible(isVisible) {
        return (typeof isVisible === 'function') ? isVisible : function () { return true; };
    }

    const GRADE_META = { high: { emoji: '🔴', label: '높음' }, watch: { emoji: '🟡', label: '관심' } };
    function normGrade(g) {
        const obj = (g && typeof g === 'object') ? g : { key: g };
        const key = (obj.key === 'high' || obj.key === 'watch') ? obj.key : null;
        const meta = GRADE_META[key] || {};
        return { key: key, emoji: obj.emoji || meta.emoji || '', label: obj.label || meta.label || '' };
    }

    function isFilteredState() {
        try {
            if (typeof UserSettings !== 'undefined' && UserSettings && UserSettings.settings) {
                return Object.values(UserSettings.settings).some(function (v) { return v === false; });
            }
        } catch (e) { /* noop */ }
        return false;
    }

    const numOf = function (v) { return (v === 0 || v) ? Number(v) : null; };

    // ── 등급 변동(격상/격하) 표식 ─────────────────────────────────────────────
    //   change = { dir:'up'|'down', fromGrade, toGrade, fromProb, toProb, deltaProb }
    //   - 접힌 헤더용 미니 뱃지: ▲격상(빨강) / ▼격하(초록·노랑).
    //   - 펼친 바디용 전이 한 줄: "▲ 격상  관심 → 높음 (+12%p)".
    function normChange(c) {
        if (!c || (c.dir !== 'up' && c.dir !== 'down')) return null;
        return c;
    }
    function buildChangeBadge(change) {
        const c = normChange(change);
        if (!c) return '';
        const up = c.dir === 'up';
        const tri = up ? '▲' : '▼';
        const label = up ? '격상' : '격하';
        return '<span class="adv-chg adv-chg-' + (up ? 'up' : 'down') + '">' + tri + ' ' + label + '</span>';
    }
    function buildChangeLine(change) {
        const c = normChange(change);
        if (!c) return '';
        const up = c.dir === 'up';
        const tri = up ? '▲' : '▼';
        const from = escapeHtml(c.fromGrade || ''), to = escapeHtml(c.toGrade || '');
        const arrow = (from && to) ? (from + ' → ' + to) : '';
        const dp = (c.deltaProb != null && isFinite(c.deltaProb))
            ? ' <span class="adv-chg-dp">(' + (c.deltaProb > 0 ? '+' : '') + c.deltaProb + '%p)</span>' : '';
        return '<div class="adv-chg-line adv-chg-' + (up ? 'up' : 'down') + '">' +
            tri + ' ' + (up ? '격상' : '격하') + (arrow ? '  ' + arrow : '') + dp + '</div>';
    }

    // ── 서술문구(하이라이트 HTML) — 등급색은 CSS(.adv-card.* .adv-narr b)가 입힌다 ──
    function buildNarrativeHtml(it) {
        const zone = escapeHtml(it.zone || '');
        const onset = escapeHtml(it.onsetLabel || '');
        const wk = numOf(it.windKt), wm = numOf(it.windMs), wv = numOf(it.waveM);
        const area = numOf(it.areaPct), prob = numOf(it.probPct);
        const sig = [];
        if (wk) sig.push('풍속 ~<b>' + wk + 'kt(' + (wm != null ? wm : Math.round(wk * 0.514444)) + 'm/s)</b>');
        if (wv) sig.push('파고 ~<b>' + wv + 'm</b>');
        const sigText = sig.join('·') || '위험 신호';
        let l2 = onset + '경 ' + sigText + '가';
        l2 += (area != null) ? ' 전체 구역의 약 <b>' + area + '%</b>를 차지할 것으로 예상됨.' : ' 예상됨.';
        const l3 = (prob != null) ? '과거 통계 상 이 수준의 약 <b>' + prob + '%</b>가 실제 발효로 연결.' : '';
        return zone + ' 위험기상일기도 분석 결과,<br>' + l2 + (l3 ? '<br>' + l3 : '');
    }

    // ── 기상청 단기예보 병기(판정 없이). 숫자 한 줄 + 그 아래 단기전망 문장. ──
    //   숫자도 문장도 없으면 빈 문자열(줄 숨김).
    function buildKmaHtml(it) {
        const kma = it.kmaForecast;
        if (!kma || typeof kma !== 'object') return '';
        const ktms = kma.windKtMs || (kma.windSpeed ? (kma.windSpeed + 'm/s') : null);
        const wave = kma.waveHeight ? (kma.waveHeight + 'm') : null;
        const outlook = (typeof kma.outlook === 'string' && kma.outlook.trim()) ? kma.outlook.trim() : null;
        if (!ktms && !wave && !outlook) return '';
        const parts = [];
        if (ktms) parts.push('풍속 <b>' + escapeHtml(String(ktms)) + '</b>');
        if (wave) parts.push('파고 <b>' + escapeHtml(String(wave)) + '</b>');
        const office = kma.office ? escapeHtml(kma.office) + ' ' : '';
        const pub = kma.publishLabel ? ' <span class="adv-kma-pub">(' + escapeHtml(kma.publishLabel) + ')</span>' : '';
        const period = kma.periodLabel ? escapeHtml(kma.periodLabel) + ' ' : '';
        let html = '<div class="adv-kma">' +
            '<div class="adv-kma-kt">🛰️ ' + office + '단기예보' + pub + '</div>';
        if (parts.length) html += '<div class="adv-kma-vals">' + period + parts.join(', ') + '</div>';
        if (outlook) html += '<div class="adv-kma-outlook">“' + escapeHtml(outlook) + '”</div>';
        html += '</div>';
        return html;
    }

    // ── 헤더 상태배지(카운트) — 앱 기존 .adv-badge(반투명) 재사용 ──
    function buildHeaderStatus(data, isVisible) {
        const vis = normVisible(isVisible);
        const d = data || {};
        const active = Array.isArray(d.active) ? d.active : [];
        const resolved = Array.isArray(d.resolved) ? d.resolved : [];
        const fActive = active.filter(function (it) { return it && vis(it.zone); });
        const fResolved = resolved.filter(function (it) { return it && vis(it.zone); });
        let high = 0, watch = 0;
        fActive.forEach(function (it) {
            const key = normGrade(it && it.grade).key;
            if (key === 'high') high++; else if (key === 'watch') watch++;
        });
        const rc = fResolved.length;
        if (fActive.length === 0 && rc === 0) {
            return '<span class="adv-badge adv-badge-empty">예측 없음</span>';
        }
        const parts = [];
        if (high > 0) parts.push('<span class="adv-badge adv-badge-high">🔴 ' + high + '</span>');
        if (watch > 0) parts.push('<span class="adv-badge adv-badge-watch">🟡 ' + watch + '</span>');
        if (rc > 0) parts.push('<span class="adv-badge adv-badge-resolved"><span class="adv-dot-check">✓</span> ' + rc + '</span>');
        return parts.join('');
    }

    // ── 바디 HTML(해역 카드 아코디언 목록) ──
    function buildAdvisoryHtml(data, isVisible) {
        const vis = normVisible(isVisible);
        const d = data || {};
        const active = Array.isArray(d.active) ? d.active : [];
        const resolved = Array.isArray(d.resolved) ? d.resolved : [];
        const fActive = active.filter(function (it) { return it && vis(it.zone); });
        const fResolved = resolved.filter(function (it) { return it && vis(it.zone); });

        const gradeWeight = function (it) {
            const k = normGrade(it && it.grade).key;
            return k === 'high' ? 0 : (k === 'watch' ? 1 : 2);
        };
        const sortedActive = fActive.slice().sort(function (a, b) {
            const gw = gradeWeight(a) - gradeWeight(b);
            if (gw !== 0) return gw;
            return (Number(b.probPct) || 0) - (Number(a.probPct) || 0);
        });

        const html = [];
        html.push('<div class="advisory-prediction-wrap">');

        if (sortedActive.length === 0 && fResolved.length === 0) {
            html.push('<div class="adv-empty">현재 예측된 특보가 없습니다.</div>');
        } else {
            // 면책문구 — 바디 최상단(아코디언 바로 아래), 예측 정보가 있을 때만
            html.push('<div class="adv-disclaimer adv-disclaimer-top">※ 본 예측은 위험기상일기도 분석 및 ' +
                '과거 특보 데이터 기반 자체 예측 결과입니다.</div>');
            if (sortedActive.length > 0) {
                html.push('<div class="adv-active-list">');
                sortedActive.forEach(function (it) {
                    const grade = normGrade(it.grade);
                    const gKey = grade.key || 'watch';
                    const zone = escapeHtml(it.zone || '');
                    const prob = (it.probPct === 0 || it.probPct) ? Number(it.probPct) : null;
                    const gLabel = escapeHtml(grade.label || '');
                    const badgeTxt = gLabel + (prob !== null ? ' · ' + prob + '% 확률' : '');

                    const chgBadge = buildChangeBadge(it.change);
                    const chgLine = buildChangeLine(it.change);

                    html.push('<div class="adv-card adv-grade-' + gKey + '">');
                    html.push('<div class="adv-card-head" onclick="window.toggleAdvisoryCard&&window.toggleAdvisoryCard(this)">');
                    html.push('<span class="adv-zone">' + zone + '</span>');
                    if (chgBadge) html.push(chgBadge);
                    html.push('<span class="adv-badge2 adv-badge2-' + gKey + '">' + badgeTxt + '</span>');
                    html.push('<span class="adv-card-chev">▼</span>');
                    html.push('</div>');
                    html.push('<div class="adv-card-body">');
                    html.push('<div class="adv-card-hr"></div>');
                    if (chgLine) html.push(chgLine);
                    html.push('<div class="adv-narr">' + buildNarrativeHtml(it) + '</div>');
                    html.push(buildKmaHtml(it));
                    html.push('</div></div>');
                });
                html.push('</div>');
            }

            if (fResolved.length > 0) {
                html.push('<div class="adv-resolved-section">');
                html.push('<div class="adv-resolved-title">최근 해소</div>');
                html.push('<div class="adv-resolved-list">');
                fResolved.forEach(function (it) {
                    const narrative = escapeHtml(it.narrative || '');
                    const zone = escapeHtml(it.zone || '');
                    html.push('<div class="adv-resolved-item">');
                    html.push('<i class="fa-solid fa-circle-check adv-resolved-icon"></i>');
                    html.push('<span class="adv-resolved-text">' + (narrative || zone) + '</span>');
                    html.push('</div>');
                });
                html.push('</div></div>');
            }
        }

        html.push('</div>');
        return html.join('');
    }

    // ── DOM 와이어링 ──
    function renderAdvisoryPrediction(data) {
        if (typeof document === 'undefined') return;
        const visFn = function (z) {
            try {
                if (typeof UserSettings !== 'undefined' && UserSettings &&
                    typeof UserSettings.isVisible === 'function') return UserSettings.isVisible(z);
            } catch (e) { /* noop */ }
            return true;
        };
        const d = data || {};

        const body = document.getElementById('advisory-prediction-accordion-body');
        if (body) body.innerHTML = buildAdvisoryHtml(d, visFn);

        const hs = document.querySelector('#advisory-prediction-accordion-header .header-status');
        if (hs) hs.innerHTML = buildHeaderStatus(d, visFn);

        // 제목 라벨(관심해역 필터 시 문구 변경) — beta 는 제목 위 별도 요소(정적 마크업).
        const titleEl = document.querySelector('#advisory-prediction-accordion-header .section-title');
        if (titleEl) {
            titleEl.textContent = isFilteredState() ? '관심해역 특보 예측' : '해역별 특보 예측';
        }

        // 기준시각 레이어(흰색, KST)
        const bt = document.getElementById('adv-basetime-layer');
        if (bt) bt.textContent = formatBaseTime(d.baseTimeKST);
    }

    // 통합관리자센터 '관리자 모드'가 체크된 기기면 'admin' 모드 표출 인가를 받는다.
    //   - 앱(푸시 등록 기기): push_token 을 adminToken 쿼리로(기존 호환).
    //   - PC 등(푸시 미구독): 로그인 토큰(seagnal_admin_token)을 X-Admin-Token 헤더로.
    //   비관리자(체크 해제)는 빈값 → 서버가 미표출.
    function _adminAuth() {
        try {
            if (localStorage.getItem('seagnal_admin_mode') !== 'true') return { query: '', headers: {} };
            const headers = {};
            let tok = '';
            try { tok = localStorage.getItem('seagnal_admin_token') || ''; } catch (e) { tok = ''; }
            if (!tok) { try { tok = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('seagnal_admin_token')) || ''; } catch (e) { /* noop */ } }
            if (tok) headers['X-Admin-Token'] = tok;
            const pt = localStorage.getItem('push_token') || '';
            return { query: pt ? ('?adminToken=' + encodeURIComponent(pt)) : '', headers: headers };
        } catch (e) { return { query: '', headers: {} }; }
    }
    // 표출 제어: display=true 일 때만 아코디언(헤더+바디)을 보인다.
    function _setAccordionVisible(show) {
        if (typeof document === 'undefined') return;
        const h = document.getElementById('advisory-prediction-accordion-header');
        const b = document.getElementById('advisory-prediction-accordion-body');
        const v = show ? '' : 'none';
        if (h) h.style.display = v;
        if (b && show && b.style.display === 'none') b.style.display = '';
        if (b && !show) b.style.display = 'none';
    }

    async function loadAdvisoryPrediction() {
        if (typeof fetch === 'undefined') return;
        if (typeof window !== 'undefined' && window.__advisoryDemoActive) return;
        try {
            const auth = _adminAuth();
            const r = await fetch('/api/advisory-prediction' + auth.query, { headers: auth.headers });
            if (!r.ok) return;
            const d = await r.json();
            if (typeof window !== 'undefined' && window.appState) window.appState.advisoryPrediction = d;
            // 표출 인가 없으면 아코디언 숨김(off, 또는 admin 모드의 비관리자 기기).
            _setAccordionVisible(d && d.display === true);
            if (d && d.display === true) renderAdvisoryPrediction(d);
        } catch (e) { /* graceful */ }
    }

    function toggleAdvisoryPredictionAccordion() {
        if (typeof document === 'undefined') return;
        const b = document.getElementById('advisory-prediction-accordion-body');
        const h = document.getElementById('advisory-prediction-accordion-header');
        if (b) b.classList.toggle('collapsed');
        if (h) h.classList.toggle('collapsed-state');
        try { if (typeof window !== 'undefined' && window.trackUsage) window.trackUsage('main.advisory_prediction_toggle'); }
        catch (e) { /* noop */ }
    }

    // 카드 아코디언 토글 (헤더 탭)
    function toggleAdvisoryCard(headEl) {
        if (!headEl || typeof headEl.closest !== 'function') return;
        const card = headEl.closest('.adv-card');
        if (card) card.classList.toggle('open');
    }
    // ⓘ 팝업 열고/닫기 (마크업은 index2.html 의 #adv-info-modal)
    function openAdvisoryInfo() {
        const m = document.getElementById('adv-info-modal');
        if (m) m.classList.add('open');
    }
    function closeAdvisoryInfo() {
        const m = document.getElementById('adv-info-modal');
        if (m) m.classList.remove('open');
    }

    if (typeof window !== 'undefined') {
        window.toggleAdvisoryPredictionAccordion = toggleAdvisoryPredictionAccordion;
        window.loadAdvisoryPrediction = loadAdvisoryPrediction;
        window.renderAdvisoryPrediction = renderAdvisoryPrediction;
        window.buildAdvisoryHtml = buildAdvisoryHtml;
        window.buildHeaderStatus = buildHeaderStatus;
        window.toggleAdvisoryCard = toggleAdvisoryCard;
        window.openAdvisoryInfo = openAdvisoryInfo;
        window.closeAdvisoryInfo = closeAdvisoryInfo;
        window.__advShowAccordion = _setAccordionVisible; // 데모 표출기가 가시성 제어에 사용
    }

    if (typeof document !== 'undefined') {
        var _start = function () {
            loadAdvisoryPrediction();
            try { setInterval(loadAdvisoryPrediction, 5 * 60 * 1000); } catch (e) { /* noop */ }
            try {
                document.addEventListener('visibilitychange', function () {
                    if (!document.hidden) loadAdvisoryPrediction();
                });
            } catch (e) { /* noop */ }
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _start);
        else _start();
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildAdvisoryHtml: buildAdvisoryHtml,
            buildHeaderStatus: buildHeaderStatus,
            buildChangeBadge: buildChangeBadge,
            buildChangeLine: buildChangeLine,
            escapeHtml: escapeHtml,
            formatBaseTime: formatBaseTime,
        };
    }
})();
