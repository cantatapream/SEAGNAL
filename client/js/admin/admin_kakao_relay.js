/**
 * ============================================================================
 * 파일명: client/js/admin/admin_kakao_relay.js
 * 역할  : 관리자 → 특보 관리 → 「카톡 중계」 탭. 카톡 특보중계 앱(태블릿·휴대폰)이 보낸 기록을 본다.
 *         ① 기기별 마지막 신호·상태와 끄기/켜기/지우기 ② 카톡 ↔ 앱 특보현황(MMIS) 대조 기록
 *         ③ 받은 특보 글과 구역별로 나눈 줄(새 특보·놓친 글·이미 봄 표시).
 *         (사용자 확정 2026-11-03: 옛 「특보 예측」 탭 자리에 넣음, 휴대폰을 빼고 태블릿만 남길 수 있게)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js (window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부)
 *  - 서버 API      : GET /api/admin/kakao-relay · POST /api/admin/kakao-relay/device (routes/kakao_relay.js)
 *  - 마크업        : 관리자 센터 모달 #alert-top-content (admin.js renderUnifiedAlertContent 가 만듦)
 *  - 나를 쓰는 곳  : admin.js switchAlertTopTab('kakao-relay') → window.renderKakaoRelayAdminTab
 * [로드 순서] admin/admin_report.js 다음 · admin/admin_location_status.js 이전 — 순서 변경 금지
 * ============================================================================
 */
(function () {
    'use strict';

    var STATE = { on: ['수신 중', '52,211,153'], off: ['꺼짐(받지 않음)', '148,163,184'], removed: ['지움(받지 않음)', '248,113,113'] };

    /** 글자를 HTML 에 안전하게 넣는다. 예: esc('<b>') → '&lt;b&gt;' @param {*} v @returns {string} */
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    /** ISO → 'MM/DD HH:mm (n분 전)' KST. 예: kst('2026-11-03T00:02:00Z') → '11/03 09:02 (3분 전)' @param {string} v @returns {string} */
    function kst(v, withAgo) {
        var t = Date.parse(v);
        if (!Number.isFinite(t)) return '—';
        var k = new Date(t + 9 * 3600e3).toISOString();
        var s = k.slice(5, 10).replace('-', '/') + ' ' + k.slice(11, 16);
        if (!withAgo) return s;
        var m = Math.round((Date.now() - t) / 60e3);
        return s + ' (' + (m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전') + ')';
    }
    /** 색 뱃지 HTML. 예: badge('수신 중','52,211,153') @returns {string} */
    function badge(text, rgb) {
        return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;'
            + 'background:rgba(' + rgb + ',0.18);color:rgb(' + rgb + ');border:1px solid rgba(' + rgb + ',0.4)">' + esc(text) + '</span>';
    }
    function section(title, inner) {
        return '<div style="margin:14px 0 6px;font-weight:700;color:#cdd6e0;font-size:0.9rem">' + title + '</div>' + inner;
    }
    function box(inner, dim) {
        return '<div style="background:#161b22;border:1px solid #2a3340;border-radius:10px;padding:10px 12px;margin-bottom:8px;' + (dim ? 'opacity:0.6;' : '') + '">' + inner + '</div>';
    }
    function btn(label, onclick, tone) {
        return '<button type="button" onclick="' + onclick + '" style="padding:5px 10px;margin:6px 6px 0 0;border-radius:8px;border:1px solid rgba(' + tone + ',0.5);'
            + 'background:rgba(' + tone + ',0.12);color:rgb(' + tone + ');font-size:0.78rem;cursor:pointer">' + esc(label) + '</button>';
    }

    /**
     * 기기 카드 하나. 마지막 신호가 70분 넘게 없으면(서버 멈춤 감시와 같은 기준) 빨갛게 표시한다.
     * @param {string} name @param {Object} d - {state, beat:{at,note,battery}, lastMessageAt, firstSeen}
     * @returns {string} [연계] ← draw
     */
    function deviceCard(name, d) {
        var st = STATE[d.state] || STATE.on;
        var beat = d.beat || null;
        var late = beat && Date.now() - Date.parse(beat.at) > 70 * 60e3;
        var rows = [
            ['마지막 신호', beat ? '<span style="color:' + (late && d.state === 'on' ? '#f87171' : '#e6edf3') + '">' + esc(kst(beat.at, true)) + (late && d.state === 'on' ? ' — 70분 넘게 없음' : '') + '</span>' : '아직 없음'],
            ['상태 메모', beat ? esc(beat.note || '—') : '—'],
            ['배터리', beat && beat.battery != null && beat.battery >= 0 ? esc(beat.battery + '%') : '—'],
            ['마지막으로 글 받음', d.lastMessageAt ? esc(kst(d.lastMessageAt, true)) : '없음'],
        ];
        var q = JSON.stringify(name).replace(/"/g, '&quot;');
        var acts = d.state === 'on'
            ? btn('끄기(받지 않음)', 'window.__krDevice(' + q + ',\'disable\')', '251,191,36') + btn('지우기', 'window.__krDevice(' + q + ',\'remove\')', '248,113,113')
            : btn('다시 받기', 'window.__krDevice(' + q + ',\'enable\')', '52,211,153') + (d.state === 'off' ? btn('지우기', 'window.__krDevice(' + q + ',\'remove\')', '248,113,113') : '');
        return box('<div style="display:flex;align-items:center;gap:8px"><b style="color:#e6edf3">' + esc(name) + '</b>' + badge(st[0], st[1]) + '</div>'
            + '<div style="font-size:0.8rem;color:#9aa7b4;margin-top:6px;line-height:1.7">'
            + rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('<br>') + '</div>' + acts, d.state !== 'on');
    }

    /** 받은 글 하나 — 출처·이번 알림 여부·구역별 줄 표. @param {Object} m @returns {string} [연계] ← draw */
    function messageCard(m) {
        var src = m.source === 'notification' ? '알림 글(앞 200자)' : '대화방 전문';
        var kind = m.trigger === false ? badge('함께 읽힌 직전 글', '148,163,184') : badge('이번 알림', '96,165,250');
        var newKeys = {}, missKeys = {};
        (m.newWarnings || []).forEach(function (w) { newKeys[w.zone + w.kind + w.at + w.action] = 1; });
        (m.missedWarnings || []).forEach(function (w) { missKeys[w.zone + w.kind + w.at + w.action] = 1; });
        var rows = (m.warnings || []).map(function (w) {
            var k = w.zone + w.kind + w.at + w.action;
            var tag = !w.zoneKnown ? badge('모르는 구역', '248,113,113')
                : w.mmisOnly ? badge('태풍=MMIS 기준', '148,163,184')
                : w.cutTail ? badge('잘린 끝 줄', '148,163,184')
                : w.action === 'unknown' ? badge('동작어 모름', '248,113,113')
                : newKeys[k] ? badge('새 특보', '52,211,153')
                : missKeys[k] ? badge('놓친 글', '251,146,60')
                : badge('이미 봄', '100,116,139');
            var when = w.until ? kst(w.at) + '~' + kst(w.until).slice(6) : kst(w.at);
            return '<tr><td style="padding:3px 6px">' + esc(w.zone) + (w.parent ? '<div style="font-size:0.68rem;color:#8b97a3">(' + esc(w.parent) + ')</div>' : '')
                + '</td><td style="padding:3px 6px">' + esc(w.kind) + '</td><td style="padding:3px 6px;white-space:nowrap">' + esc(when)
                + '</td><td style="padding:3px 6px">' + esc(w.rawAction || w.action) + '</td><td style="padding:3px 6px">' + tag + '</td></tr>';
        }).join('');
        var table = rows ? '<table style="width:100%;border-collapse:collapse;font-size:0.76rem;color:#d6dee6;margin-top:6px">'
            + '<tr style="color:#8b97a3"><th style="text-align:left;padding:3px 6px">구역</th><th style="text-align:left;padding:3px 6px">종류</th><th style="text-align:left;padding:3px 6px">시각</th><th style="text-align:left;padding:3px 6px">동작</th><th></th></tr>'
            + rows + '</table>' : '<div style="font-size:0.78rem;color:#f87171;margin-top:6px">' + (m.unparsed ? '특보 줄을 나누지 못함' : '특보 줄 없음') + '</div>';
        return box('<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:0.78rem;color:#9aa7b4">'
            + '<b style="color:#e6edf3">' + esc(kst(m.receivedAt)) + '</b> · ' + esc(m.device || '') + ' · ' + esc(src) + ' ' + kind + '</div>' + table);
    }

    /** MMIS 대조 기록·대기 중 줄. @param {Object} data @returns {string} [연계] ← draw */
    function checks(data) {
        var pend = (data.pending || []).map(function (p) {
            return '• ' + esc(p.zone + ' ' + p.kind + ' 「' + p.action + '」 ' + kst(p.at)) + ' — 카톡 ' + esc(kst(p.receivedAt))
                + (p.status === 'alerted' ? ' ' + badge('반영 안 됨 알림 보냄', '251,191,36') : ' ' + badge('대조 중', '96,165,250'));
        }).join('<br>');
        var list = (data.checks || []).filter(function (c) { return c.kind !== 'superseded'; }).slice(0, 20).map(function (c) {
            return box('<div style="font-size:0.8rem;font-weight:700;color:#e6edf3">' + esc(c.title) + '</div>'
                + '<div style="font-size:0.72rem;color:#8b97a3;margin:2px 0 4px">' + esc(kst(c.at)) + ' 관리자 알림</div>'
                + '<div style="font-size:0.78rem;color:#c9d3dd;white-space:pre-wrap;line-height:1.55">' + esc(c.body) + '</div>');
        }).join('');
        return box('<div style="font-size:0.78rem;color:#c9d3dd;line-height:1.7">' + (pend || '대조 중인 카톡 특보 없음') + '</div>')
            + (list || '<div style="font-size:0.78rem;color:#8b97a3;padding:4px 2px">아직 보낸 대조 알림이 없습니다.</div>');
    }

    var lastContainer = null;

    /**
     * 탭을 그린다(서버에서 최근 40건을 받아). 실패하면 그 사실을 그대로 보여 준다(빈 화면으로 숨기지 않는다).
     * 예: renderKakaoRelayAdminTab(document.getElementById('alert-top-content'))
     * @param {HTMLElement} container @returns {Promise<void>}
     * [연계] ← admin.js switchAlertTopTab('kakao-relay') / → GET /api/admin/kakao-relay
     */
    async function renderKakaoRelayAdminTab(container) {
        lastContainer = container;
        container.innerHTML = '<div style="padding:16px;color:#8b97a3">카톡 중계 기록을 불러오는 중…</div>';
        var data;
        try {
            var r = await fetch('/api/admin/kakao-relay?n=40', { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            data = await r.json();
        } catch (e) {
            container.innerHTML = '<div style="padding:16px;color:#f87171">카톡 중계 기록을 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
            return;
        }
        var devs = data.devices || {};
        var names = Object.keys(devs);
        var active = names.filter(function (n) { return devs[n].state !== 'removed'; });
        var removed = names.filter(function (n) { return devs[n].state === 'removed'; });
        var html = '<div style="padding:4px 2px">'
            + '<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:0.8rem;color:#9aa7b4">'
            + '카톡 「기상청 해양기상정보포털」 특보 알림톡을 중계 앱이 읽어 보낸 기록입니다. 지금은 기록·대조만 하고 앱 특보현황은 바꾸지 않습니다.</div>'
            + btn('새로고침', 'window.__krRefresh()', '96,165,250') + '</div>'
            + section('📱 중계 기기', (active.length ? active.map(function (n) { return deviceCard(n, devs[n]); }).join('') : box('<span style="color:#8b97a3;font-size:0.8rem">아직 신호를 보낸 기기가 없습니다.</span>'))
                + (removed.length ? '<div style="font-size:0.74rem;color:#8b97a3;margin:4px 2px">지운 기기: ' + removed.map(function (n) {
                    return esc(n) + ' ' + btn('다시 받기', 'window.__krDevice(' + JSON.stringify(n).replace(/"/g, '&quot;') + ',\'enable\')', '52,211,153');
                }).join(' ') + '</div>' : ''))
            + section('🔍 앱 특보현황(MMIS)과 대조', checks(data))
            + section('📨 받은 특보 글 (최근 ' + (data.messages || []).length + '건)', (data.messages || []).map(messageCard).join('') || box('<span style="color:#8b97a3;font-size:0.8rem">받은 글이 없습니다.</span>'))
            + '</div>';
        container.innerHTML = html;
    }

    /**
     * 기기 끄기·켜기·지우기. 지우기·끄기는 한 번 더 묻는다(되돌릴 수는 있다 — 「다시 받기」).
     * @param {string} name @param {'enable'|'disable'|'remove'} action
     * [연계] ← 기기 카드 버튼 / → POST /api/admin/kakao-relay/device
     */
    async function deviceAction(name, action) {
        var msg = action === 'remove' ? '「' + name + '」 기기를 지울까요?\n이 기기가 보내는 카톡 글을 더 이상 받지 않고, 멈춤 감시에서도 뺍니다.\n(나중에 「다시 받기」로 되살릴 수 있습니다)'
            : action === 'disable' ? '「' + name + '」 기기를 끌까요?\n이 기기가 보내는 카톡 글을 받지 않고 멈춤 감시에서도 뺍니다.' : null;
        if (msg && !window.confirm(msg)) return;
        try {
            var r = await fetch('/api/admin/kakao-relay/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: name, action: action }) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
        } catch (e) {
            window.alert('기기 설정을 바꾸지 못했습니다 — ' + e.message);
        }
        if (lastContainer) renderKakaoRelayAdminTab(lastContainer);
    }

    window.renderKakaoRelayAdminTab = renderKakaoRelayAdminTab;
    window.__krDevice = deviceAction;
    window.__krRefresh = function () { if (lastContainer) renderKakaoRelayAdminTab(lastContainer); };
})();
