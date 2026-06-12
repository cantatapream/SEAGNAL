/**
 * ============================================================================
 * js/advisory_manage_admin.js — 관리자 "특보 관리 → 특보 예측" 운영 UI
 * ============================================================================
 *  - 청중 모드 토글: OFF / 관리자 기기에만 / 전체 사용자  (마스터 스위치)
 *  - 현재 생성된 예측 목록: 구역별 [삭제][표출중지/복귀][수정]
 *  제어 API: /api/admin/advisory-display/*  (admin.js fetch 래퍼가 토큰 자동첨부)
 *  렌더 진입점: window.renderAdvisoryDisplayManageTab(container)
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    var _container = null;
    var _editing = null; // 현재 인라인 수정 중인 zone

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function api(pathName, body) {
        var opt = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
        if (body) opt.body = JSON.stringify(body);
        return fetch(pathName, opt).then(function (r) { return r.json().catch(function () { return {}; }); });
    }
    function toast(msg) { try { if (window.showToast) window.showToast(msg); else console.log('[advManage]', msg); } catch (e) { /* noop */ } }

    function load() {
        if (!_container) return;
        _container.innerHTML = '<div style="padding:18px;color:#9aa7b4">불러오는 중…</div>';
        Promise.all([
            api('/api/admin/advisory-display/state'),
            api('/api/admin/advisory-display/stats').catch(function () { return null; }),
        ]).then(function (rs) { render(rs[0], rs[1]); }).catch(function () {
            _container.innerHTML = '<div style="padding:18px;color:#ff8a8a">상태 조회 실패</div>';
        });
    }

    // ── 통계 섹션 HTML (운영 누적 저널 — 등급/확률구간별 적중·미적중) ──────────
    function statsHtml(st) {
        if (!st || !st.counts) return '';
        var pc = function (v) { return (v == null) ? '–' : v + '%'; };
        var row = function (label, a, expect) {
            return '<tr><td>' + label + '</td><td>' + a.hit + '</td><td>' + a.miss + '</td>' +
                '<td>' + a.pending + '</td><td><b>' + pc(a.ratePct) + '</b></td><td>' + expect + '</td></tr>';
        };
        var h = '<div class="advm-sec-title" style="margin-top:16px">예측 통계 (운영 누적 — 적중/미적중)</div>';
        h += '<table class="advm-stats"><thead><tr><th>분류</th><th>적중</th><th>미적중</th><th>진행중</th><th>적중률</th><th>기대</th></tr></thead><tbody>';
        h += row('🔴 높음', st.byGrade.high, '64~70%');
        h += row('🟡 관심', st.byGrade.watch, '51~58%');
        (st.byProb || []).forEach(function (b) { h += row('확률 ' + b.range, b, b.range); });
        h += '</tbody></table>';
        h += '<div class="advm-note">적중 창: 예상시각 −' + st.window.beforeH + 'h ~ +' + st.window.afterH +
            'h 내 공식 풍랑/태풍 발효 · 총 기록 ' + st.counts.pred + '건(결정 ' + st.counts.decided + ')</div>';
        // 최근 결정 사례
        if (st.recent && st.recent.length) {
            h += '<div class="advm-recent">';
            st.recent.slice(0, 8).forEach(function (r) {
                var ok = r.outcome === 'hit';
                h += '<div class="advm-recent-item">' +
                    '<span class="advm-oc ' + (ok ? 'hit' : 'miss') + '">' + (ok ? '적중' : '미적중') + '</span> ' +
                    esc(r.zone) + ' <span style="color:#8b97a3">(' + (r.grade === 'high' ? '높음' : '관심') + ' ' + esc(r.prob) + '%)</span></div>';
            });
            h += '</div>';
        }
        return h;
    }

    function modeBtn(cur, val, label, desc) {
        var on = cur === val;
        return '<button class="advm-mode-btn' + (on ? ' on' : '') + '" onclick="window.__advmSetMode(\'' + val + '\')">' +
            '<div class="advm-mode-label">' + label + '</div><div class="advm-mode-desc">' + desc + '</div></button>';
    }

    function statusBadge(zone, st) {
        if (st.hidden) return '<span class="advm-st advm-st-del">삭제됨</span>';
        if (st.resolved) return '<span class="advm-st advm-st-on">해소전환</span>';
        if (st.stopped) return '<span class="advm-st advm-st-stop">표출중지</span>';
        if (st.edited) return '<span class="advm-st advm-st-edit">수정됨</span>';
        return '<span class="advm-st advm-st-on">표출중</span>';
    }

    function render(s, stats) {
        if (!_container) return;
        s = s || {};
        var mode = s.mode || 'off';
        var hidden = s.hidden || {}, stopped = s.stopped || {}, edits = s.edits || {};
        var resolvedZ = s.resolvedZ || {};
        var preds = Array.isArray(s.predictions) ? s.predictions : [];

        var html = '';
        html += '<div class="advm-wrap">';
        // 청중 모드
        html += '<div class="advm-sec-title">표출 대상 (마스터 스위치)</div>';
        html += '<div class="advm-modes">' +
            modeBtn(mode, 'off', 'OFF', '아무에게도 표출 안 함(생성도 중단)') +
            modeBtn(mode, 'admin', '관리자 기기에만', '통합관리자센터 등록 기기만 표출(시범)') +
            modeBtn(mode, 'all', '전체 사용자', '모든 사용자에게 표출') +
            '</div>';
        html += '<div class="advm-note">기준시각: ' + esc(s.baseTimeKST || '—') + ' · 마지막 변경: ' + esc(s.updatedAt || '—') + '</div>';

        // 해소 목록 관리 — 잔재 정리(24h 자연만료 전 즉시 비우기)
        var rc = (typeof s.resolvedCount === 'number') ? s.resolvedCount : 0;
        html += '<div class="advm-sec-title" style="margin-top:16px">해소 목록 (' + rc + '건)</div>';
        html += '<div class="advm-actions" style="margin-top:0">' +
            '<button class="advm-btn advm-btn-danger"' + (rc === 0 ? ' disabled style="opacity:.45"' : '') +
            ' onclick="window.__advmClearResolved()">해소 목록 즉시 비우기</button>' +
            '<span class="advm-note" style="margin-top:0;align-self:center">사용자 화면의 \'최근 해소\' 섹션을 즉시 제거합니다(예측 카드는 유지).</span>' +
            '</div>';

        // 예측 목록
        html += '<div class="advm-sec-title" style="margin-top:16px">현재 예측 (' + preds.length + '건)</div>';
        if (preds.length === 0) {
            html += '<div class="advm-empty">생성된 예측이 없습니다. (모드를 OFF가 아닌 값으로 두면 다음 사이클에 생성됩니다)</div>';
        } else {
            html += '<div class="advm-list">';
            preds.forEach(function (p) {
                var zone = p.zone || '';
                var gKey = (p.grade && p.grade.key) || 'watch';
                var gLabel = (p.grade && p.grade.label) || (gKey === 'high' ? '높음' : '관심');
                var st = { hidden: !!hidden[zone], stopped: !!stopped[zone], edited: !!edits[zone], resolved: !!resolvedZ[zone] };
                var ed = edits[zone] || {};
                var prob = (ed.probPct != null) ? ed.probPct : p.probPct;
                html += '<div class="advm-item' + (st.hidden || st.stopped || st.resolved ? ' off' : '') + '">';
                html += '  <div class="advm-item-head">';
                html += '    <span class="advm-zone">' + esc(zone) + '</span>';
                html += '    <span class="advm-grade advm-grade-' + gKey + '">' + esc((ed.gradeKey ? (ed.gradeKey === 'high' ? '높음' : '관심') : gLabel)) + ' · ' + esc(prob) + '%</span>';
                html += '    ' + statusBadge(zone, st);
                html += '  </div>';
                html += '  <div class="advm-actions">';
                if (st.hidden || st.stopped || st.resolved) {
                    html += '<button class="advm-btn" onclick="window.__advmRestore(\'' + esc(zone) + '\')">복귀</button>';
                } else {
                    html += '<button class="advm-btn" onclick="window.__advmResolve(\'' + esc(zone) + '\')">해소로</button>';
                    html += '<button class="advm-btn" onclick="window.__advmHide(\'' + esc(zone) + '\',false)">표출중지</button>';
                    html += '<button class="advm-btn advm-btn-danger" onclick="window.__advmHide(\'' + esc(zone) + '\',true)">삭제</button>';
                }
                html += '<button class="advm-btn" onclick="window.__advmEdit(\'' + esc(zone) + '\')">수정</button>';
                if (st.edited) html += '<button class="advm-btn" onclick="window.__advmClearEdit(\'' + esc(zone) + '\')">수정해제</button>';
                html += '  </div>';
                // 인라인 수정 폼
                if (_editing === zone) {
                    html += '<div class="advm-edit">';
                    html += '<label>등급 <select id="advm-grade-sel">' +
                        '<option value="high"' + (((ed.gradeKey || gKey) === 'high') ? ' selected' : '') + '>높음</option>' +
                        '<option value="watch"' + (((ed.gradeKey || gKey) === 'watch') ? ' selected' : '') + '>관심</option></select></label>';
                    html += '<label>확률 <input id="advm-prob-inp" type="number" min="0" max="100" value="' + esc(prob) + '">%</label>';
                    html += '<label>서술문구<br><textarea id="advm-narr-inp" rows="3" placeholder="비우면 자동 문구 사용">' + esc(ed.narrative || '') + '</textarea></label>';
                    html += '<div class="advm-edit-actions"><button class="advm-btn advm-btn-primary" onclick="window.__advmSaveEdit(\'' + esc(zone) + '\')">저장</button>' +
                        '<button class="advm-btn" onclick="window.__advmCancelEdit()">취소</button></div>';
                    html += '</div>';
                }
                html += '</div>';
            });
            html += '</div>';
        }
        html += statsHtml(stats);
        html += '</div>';
        _container.innerHTML = html;
    }

    // ── 액션 ────────────────────────────────────────────────────────────────
    window.__advmSetMode = function (mode) {
        api('/api/admin/advisory-display/mode', { mode: mode }).then(function (r) {
            toast('표출 모드: ' + (r.mode || mode)); load();
        });
    };
    window.__advmHide = function (zone, perm) {
        api('/api/admin/advisory-display/hide', { zone: zone, permanent: !!perm }).then(function () {
            toast(perm ? '삭제됨' : '표출중지'); load();
        });
    };
    window.__advmRestore = function (zone) {
        api('/api/admin/advisory-display/restore', { zone: zone }).then(function () { toast('복귀'); load(); });
    };
    window.__advmResolve = function (zone) {
        if (typeof confirm === 'function' && !confirm(zone + ' 예측을 \'최근 해소\'로 보낼까요? (사용자에게 해소로 표시)')) return;
        api('/api/admin/advisory-display/resolve', { zone: zone }).then(function () { toast('해소 전환'); load(); });
    };
    window.__advmEdit = function (zone) { _editing = zone; load(); };
    window.__advmCancelEdit = function () { _editing = null; load(); };
    window.__advmClearEdit = function (zone) {
        api('/api/admin/advisory-display/clear-edit', { zone: zone }).then(function () { toast('수정 해제'); load(); });
    };
    window.__advmClearResolved = function () {
        if (typeof confirm === 'function' && !confirm('최근 해소 목록을 모두 비울까요? (사용자 화면에서 즉시 사라집니다)')) return;
        api('/api/admin/advisory-display/clear-resolved', {}).then(function (r) {
            toast('해소 ' + ((r && r.cleared) || 0) + '건 비움'); load();
        });
    };
    window.__advmSaveEdit = function (zone) {
        var g = document.getElementById('advm-grade-sel');
        var pr = document.getElementById('advm-prob-inp');
        var nr = document.getElementById('advm-narr-inp');
        var body = { zone: zone, gradeKey: g ? g.value : undefined, probPct: pr ? Number(pr.value) : undefined };
        if (nr && nr.value.trim()) body.narrative = nr.value.trim();
        api('/api/admin/advisory-display/edit', body).then(function () { _editing = null; toast('수정 저장'); load(); });
    };

    window.renderAdvisoryDisplayManageTab = function (container) { _container = container; _editing = null; load(); };
})();
