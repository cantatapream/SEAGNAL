/**
 * ============================================================================
 * 파일명: js/advisory_prediction.js  (Phase 5 통합본 — variant A·B 머지)
 * 역할: "특보 예측" 아코디언 — 백엔드 GET /api/advisory-prediction 호출 후
 *       "해역별 특보현황" 바로 위에 우리 자체 예측을 렌더한다.
 *
 *  ※ 기상청 공식 특보가 아닌, 위험기상일기도 분석 기반 SEAGNAL 자체 예측.
 * ============================================================================
 *
 * [구조]
 *  - buildAdvisoryHtml(data, isVisible)  : 순수 함수 → 바디 HTML 문자열
 *  - buildHeaderStatus(data, isVisible)  : 순수 함수 → 헤더 상태배지 HTML 문자열
 *  - renderAdvisoryPrediction(data)      : DOM 와이어링 (얇음)
 *  - loadAdvisoryPrediction()            : fetch + 렌더
 *  - window.toggleAdvisoryPredictionAccordion() : 아코디언 토글
 *
 * [테스트] node 에서 require 가능 — document/fetch/window 는 함수 안에서만 접근.
 *          파일 끝 module.exports 로 순수 함수 노출.
 *
 * [클래스명] 통합본은 .advisory-prediction-wrap / .adv-* / .adv-badge* 세트를
 *            사용하며 style.css 의 정의와 1:1 일치한다.
 * ============================================================================
 */
(function () {
    'use strict';

    // ---- 내부 유틸: XSS 안전 escape (&,<,>,",' 모두 처리) ----------------------
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---- baseTimeKST("2026061021") → "기준 2026-06-10 21시" --------------------
    function formatBaseTime(baseTimeKST) {
        if (!baseTimeKST || !/^\d{10}$/.test(String(baseTimeKST))) return '';
        const s = String(baseTimeKST);
        return `기준 ${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}시`;
    }

    // ---- 안전한 콜백 정규화 ----------------------------------------------------
    function normVisible(isVisible) {
        return (typeof isVisible === 'function') ? isVisible : function () { return true; };
    }

    // ---- 필터 상태 판정: settings 값 중 false 가 하나라도 있으면 필터됨 --------
    function isFilteredState() {
        try {
            if (typeof UserSettings !== 'undefined' && UserSettings && UserSettings.settings) {
                return Object.values(UserSettings.settings).some(function (v) { return v === false; });
            }
        } catch (e) { /* noop */ }
        return false;
    }

    // ==========================================================================
    // 순수 함수: 헤더 상태배지 HTML
    //   counts(필터 후 재계산) 반영. high → 🔴N, watch → 🟡N, resolved → ✓ 해소N.
    //   active·resolved 모두 0 이면 "예측 없음".
    // ==========================================================================
    function buildHeaderStatus(data, isVisible) {
        const vis = normVisible(isVisible);
        const d = data || {};
        const active = Array.isArray(d.active) ? d.active : [];
        const resolved = Array.isArray(d.resolved) ? d.resolved : [];

        const fActive = active.filter(function (it) { return it && vis(it.zone); });
        const fResolved = resolved.filter(function (it) { return it && vis(it.zone); });

        let high = 0, watch = 0;
        fActive.forEach(function (it) {
            const key = it && it.grade && it.grade.key;
            if (key === 'high') high++;
            else if (key === 'watch') watch++;
        });
        const resolvedCount = fResolved.length;

        if (fActive.length === 0 && resolvedCount === 0) {
            return '<span class="adv-badge adv-badge-empty">예측 없음</span>';
        }

        const parts = [];
        if (high > 0) parts.push('<span class="adv-badge adv-badge-high">🔴 ' + high + '</span>');
        if (watch > 0) parts.push('<span class="adv-badge adv-badge-watch">🟡 ' + watch + '</span>');
        if (resolvedCount > 0) parts.push('<span class="adv-badge adv-badge-resolved">✓ 해소 ' + resolvedCount + '</span>');
        return parts.join('');
    }

    // ==========================================================================
    // 순수 함수: 바디 HTML
    // ==========================================================================
    function buildAdvisoryHtml(data, isVisible) {
        const vis = normVisible(isVisible);
        const d = data || {};
        const active = Array.isArray(d.active) ? d.active : [];
        const resolved = Array.isArray(d.resolved) ? d.resolved : [];

        // 필터 적용
        const fActive = active.filter(function (it) { return it && vis(it.zone); });
        const fResolved = resolved.filter(function (it) { return it && vis(it.zone); });

        // high 를 위로 + probPct 내림차순 정렬
        const gradeWeight = function (it) {
            const k = it && it.grade && it.grade.key;
            return k === 'high' ? 0 : (k === 'watch' ? 1 : 2);
        };
        const sortedActive = fActive.slice().sort(function (a, b) {
            const gw = gradeWeight(a) - gradeWeight(b);
            if (gw !== 0) return gw;
            return (Number(b.probPct) || 0) - (Number(a.probPct) || 0);
        });

        const baseLabel = formatBaseTime(d.baseTimeKST);
        const html = [];

        html.push('<div class="advisory-prediction-wrap">');

        // 기준시각
        if (baseLabel) {
            html.push('<div class="adv-basetime">' + escapeHtml(baseLabel) + '</div>');
        }

        // 빈 상태
        if (sortedActive.length === 0 && fResolved.length === 0) {
            html.push('<div class="adv-empty">현재 예측된 특보가 없습니다.</div>');
        } else {
            // ---- 활성 예측 카드 ----
            if (sortedActive.length > 0) {
                html.push('<div class="adv-active-list">');
                sortedActive.forEach(function (it) {
                    const grade = it.grade || {};
                    const emoji = escapeHtml(grade.emoji || '');
                    const gLabel = escapeHtml(grade.label || '');
                    const gKey = (grade.key === 'high' || grade.key === 'watch') ? grade.key : 'watch';
                    const zone = escapeHtml(it.zone || '');
                    const prob = (it.probPct === 0 || it.probPct) ? Number(it.probPct) : null;
                    const windKt = (it.windKt === 0 || it.windKt) ? Number(it.windKt) : null;
                    const onset = escapeHtml(it.onsetLabel || '');
                    const narrative = escapeHtml(it.narrative || '');

                    html.push('<div class="adv-card adv-grade-' + gKey + '">');
                    html.push('<div class="adv-card-head">');
                    html.push('<span class="adv-emoji">' + emoji + '</span>');
                    html.push('<span class="adv-zone">' + zone + '</span>');
                    if (gLabel) html.push('<span class="adv-grade-label">' + gLabel + '</span>');
                    html.push('</div>');

                    html.push('<div class="adv-card-meta">');
                    if (prob !== null) html.push('<span class="adv-meta-prob">' + prob + '%</span>');
                    if (windKt !== null) html.push('<span class="adv-meta-wind">풍속~' + windKt + 'kt</span>');
                    if (onset) html.push('<span class="adv-meta-onset">' + onset + '</span>');
                    html.push('</div>');

                    if (narrative) {
                        html.push('<div class="adv-card-narrative">' + narrative + '</div>');
                    }
                    html.push('</div>'); // adv-card
                });
                html.push('</div>'); // adv-active-list
            }

            // ---- 최근 해소 서브섹션 (있을 때만) ----
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

        // 면책 문구 (필수)
        html.push('<div class="adv-disclaimer">※ 본 예측은 기상청 공식 특보가 아닌, ' +
            '위험기상일기도 분석 기반 SEAGNAL 자체 예측입니다.</div>');

        html.push('</div>'); // advisory-prediction-wrap
        return html.join('');
    }

    // ==========================================================================
    // DOM 와이어링 (얇게)
    // ==========================================================================
    function renderAdvisoryPrediction(data) {
        if (typeof document === 'undefined') return;

        const visFn = function (z) {
            try {
                if (typeof UserSettings !== 'undefined' && UserSettings &&
                    typeof UserSettings.isVisible === 'function') {
                    return UserSettings.isVisible(z);
                }
            } catch (e) { /* noop */ }
            return true;
        };

        const body = document.getElementById('advisory-prediction-accordion-body');
        if (body) body.innerHTML = buildAdvisoryHtml(data, visFn);

        const hs = document.querySelector('#advisory-prediction-accordion-header .header-status');
        if (hs) hs.innerHTML = buildHeaderStatus(data, visFn);

        // 제목: 관심해역 필터 시 "관심해역별 특보 예측"
        const titleEl = document.querySelector('#advisory-prediction-accordion-header .section-title');
        if (titleEl) {
            const icon = '<i class="fa-solid fa-wand-magic-sparkles"></i> ';
            titleEl.innerHTML = icon + (isFilteredState() ? '관심해역별 특보 예측' : '특보 예측');
        }
    }

    // ==========================================================================
    // 페치
    // ==========================================================================
    async function loadAdvisoryPrediction() {
        if (typeof fetch === 'undefined') return;
        try {
            const r = await fetch('/api/advisory-prediction');
            if (!r.ok) return;
            const d = await r.json();
            if (typeof window !== 'undefined' && window.appState) {
                window.appState.advisoryPrediction = d;
            }
            renderAdvisoryPrediction(d);
        } catch (e) {
            // 조용히 무시 (네트워크/파싱 오류 시 기존 로딩 상태 유지)
        }
    }

    // ==========================================================================
    // 토글 (기존 toggleMainAccordion 패턴)
    // ==========================================================================
    function toggleAdvisoryPredictionAccordion() {
        if (typeof document === 'undefined') return;
        const b = document.getElementById('advisory-prediction-accordion-body');
        const h = document.getElementById('advisory-prediction-accordion-header');
        if (b) b.classList.toggle('collapsed');
        if (h) h.classList.toggle('collapsed-state');
        try {
            if (typeof window !== 'undefined' && window.trackUsage) {
                window.trackUsage('main.advisory_prediction_toggle');
            }
        } catch (e) { /* noop */ }
    }

    // ---- 전역 노출 (브라우저) --------------------------------------------------
    if (typeof window !== 'undefined') {
        window.toggleAdvisoryPredictionAccordion = toggleAdvisoryPredictionAccordion;
        window.loadAdvisoryPrediction = loadAdvisoryPrediction;
        window.renderAdvisoryPrediction = renderAdvisoryPrediction;
        window.buildAdvisoryHtml = buildAdvisoryHtml;
        window.buildHeaderStatus = buildHeaderStatus;
    }

    // ---- 자가 구동 (코어 파일 미수정) -----------------------------------------
    //   node require 시 실행되지 않도록 document 가드.
    if (typeof document !== 'undefined') {
        var _start = function () {
            loadAdvisoryPrediction();
            // 5분 주기 자동 갱신
            try {
                setInterval(loadAdvisoryPrediction, 5 * 60 * 1000);
            } catch (e) { /* noop */ }
            // 탭 복귀 시 재호출
            try {
                document.addEventListener('visibilitychange', function () {
                    if (!document.hidden) loadAdvisoryPrediction();
                });
            } catch (e) { /* noop */ }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _start);
        } else {
            _start();
        }
    }

    // ---- node 테스트용 export (브라우저엔 module 미정의라 무해) ----------------
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildAdvisoryHtml: buildAdvisoryHtml,
            buildHeaderStatus: buildHeaderStatus,
            escapeHtml: escapeHtml,
            formatBaseTime: formatBaseTime
        };
    }
})();
