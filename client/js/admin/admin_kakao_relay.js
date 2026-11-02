/**
 * ============================================================================
 * 파일명: client/js/admin/admin_kakao_relay.js
 * 역할  : 관리자 → 특보 관리 → 「카톡 중계」 탭. 카톡 특보중계 앱(태블릿·휴대폰)이 보낸 기록을 본다.
 *         ① 기기별 마지막 신호·상태와 끄기/켜기/지우기 ② 카톡 ↔ 앱 특보현황(MMIS) 대조 기록
 *         ③ 받은 특보 글과 구역별로 나눈 줄(새 특보·놓친 글·이미 봄 표시).
 *         ④ [비교현황] 창 — 카톡판 특보현황 ↔ 앱 특보현황(MMIS) 시간대별 비교(10일 시험, 2026-11-03).
 *         (사용자 확정 2026-11-03: 옛 「특보 예측」 탭 자리에 넣음, 휴대폰을 빼고 태블릿만 남길 수 있게)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin/admin.js (window.fetch 관리자 토큰 래퍼 — /api/admin/* 에 X-Admin-Token 자동 첨부)
 *  - 서버 API      : GET /api/admin/kakao-relay · POST /api/admin/kakao-relay/device · GET /api/admin/kakao-relay/compare (routes/kakao_relay.js)
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
        var m = Math.max(0, Math.round((Date.now() - t) / 60e3));
        return s + ' (' + (m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전') + ')';
    }
    /** 색 뱃지 HTML. 예: badge('수신 중','52,211,153') @returns {string} */
    function badge(text, rgb) {
        return '<span style="display:inline-block;white-space:nowrap;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700;'
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
            console.warn('[카톡 중계] 기록 불러오기 실패:', e && e.message);
            container.innerHTML = '<div style="padding:16px;color:#f87171">카톡 중계 기록을 불러오지 못했습니다 — ' + esc(e.message) + '</div>';
            return;
        }
        var devs = data.devices || {};
        var names = Object.keys(devs);
        var active = names.filter(function (n) { return devs[n].state !== 'removed'; });
        var removed = names.filter(function (n) { return devs[n].state === 'removed'; });
        var html = '<div style="padding:4px 2px">'
            // 버튼 줄(왼쪽 정렬) 아래에 설명 — 사용자 확정 2026-11-03 「[비교현황] [새로고침] (여기에 명시)」
            + '<div style="display:flex;justify-content:flex-start;align-items:center;gap:0">'
            + btn('비교현황', 'window.__krCompare()', '167,139,250') + btn('새로고침', 'window.__krRefresh()', '96,165,250') + '</div>'
            + '<div style="font-size:0.8rem;color:#9aa7b4;margin-top:8px">'
            + '카톡 「기상청 해양기상정보포털」 특보 알림톡을 중계 앱이 읽어 보낸 기록입니다. 지금은 기록·대조만 하고 앱 특보현황은 바꾸지 않습니다.</div>'
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
            console.warn('[카톡 중계] 기기 설정 실패:', e && e.message);
            window.alert('기기 설정을 바꾸지 못했습니다 — ' + e.message);
        }
        if (lastContainer) renderKakaoRelayAdminTab(lastContainer);
    }

    // ── 비교현황 창 (사용자 확정 2026-11-03 「시간대별로 비교하여 볼 수 있는 화면」 「새로고침 왼쪽에 비교현황 버튼」) ──
    //   카톡 글만으로 만든 「카톡판 특보현황」과 앱 특보현황(MMIS)을 서버가 1분마다 구역별로 맞대어 남긴 기록을
    //   날짜 → 시간대(KST) 순으로 보여 준다. 서버: GET /api/admin/kakao-relay/compare (services/kakao_shadow.summarize)

    var STATUS = { match: ['같음', '52,211,153'], wait: ['반영 대기', '251,191,36'], diff: ['차이', '248,113,113'], typhoon: ['태풍(비교 제외)', '148,163,184'] };
    var DIFF_WORD = { cur: '발효 등급', up: '다가오는 특보', clr: '해제 시각' };

    /** 카톡 줄 지연(분) → 쉬운 말. 양수 = 카톡이 빠름. 예: lagText(3) → '카톡이 3분 빠름' @param {number} m @returns {string} */
    function lagText(m) {
        if (typeof m !== 'number') return '';
        if (m > 0) return '카톡이 ' + m + '분 빠름';
        if (m === 0) return '같은 분';
        if (m <= -10) return 'MMIS가 먼저(이미 같았음)';
        return 'MMIS가 ' + (-m) + '분 빠름';
    }
    /** ISO → KST 'HH:mm'. @param {string} v @returns {string} */
    function hm(v) {
        var t = Date.parse(v);
        return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(11, 16) : '—';
    }
    function hourOf(v) { return new Date(Date.parse(v) + 9 * 3600e3).getUTCHours(); }
    function stat(label, value, sub, tone) {
        return '<div style="flex:1 1 130px;min-width:120px;background:#161b22;border:1px solid #2a3340;border-radius:10px;padding:8px 10px">'
            + '<div style="font-size:0.72rem;color:#8b97a3">' + esc(label) + '</div>'
            + '<div style="font-size:1.05rem;font-weight:800;color:' + (tone || '#e6edf3') + '">' + esc(value) + '</div>'
            + (sub ? '<div style="font-size:0.7rem;color:#8b97a3">' + esc(sub) + '</div>' : '') + '</div>';
    }
    function table(head, rows) {
        return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.76rem;color:#cdd6e0">'
            + '<tr>' + head.map(function (h) { return '<th style="text-align:left;padding:5px 6px;border-bottom:1px solid #2a3340;color:#8b97a3;white-space:nowrap">' + esc(h) + '</th>'; }).join('') + '</tr>'
            + rows.join('') + '</table></div>';
    }
    function td(v, extra) { return '<td style="padding:5px 6px;border-bottom:1px solid #1f2731;vertical-align:top;' + (extra || '') + '">' + v + '</td>'; }

    /**
     * 한 시간대를 펼친 내용: 그 시간 차이 구역(분·양쪽 상태), 카톡 줄 결과, 다른 상태 구간, 반영·MMIS 변화.
     * @param {object} s - 요약 @param {number} h - KST 시
     */
    function hourDetail(s, h) {
        var H = s.hours[h];
        var out = [];
        var dz = Object.keys(H.diffZones || {});
        if (dz.length) out.push('<div style="color:#f87171;font-weight:700;margin:4px 0">10분 넘게 다른 구역</div>' + dz.map(function (z) {
            var e = H.diffZones[z];
            return '<div>• ' + esc(z) + ' — 약 ' + e.min + '분 · 다른 것: ' + esc((e.diffs || []).map(function (d) { return DIFF_WORD[d] || d; }).join(', ')) + '<br>&nbsp;&nbsp;카톡판: ' + esc(e.kakao) + ' / 앱(MMIS): ' + esc(e.mmis) + '</div>';
        }).join(''));
        var ls = (s.lines || []).filter(function (l) { return hourOf(l.t) === h; });
        if (ls.length) out.push('<div style="font-weight:700;margin:6px 0 2px">카톡 줄 결과</div>' + ls.map(function (l) {
            var tone = l.result === '일치' ? '#34d399' : l.result === '불일치' ? '#f87171' : '#9aa7b4';
            return '<div>• <span style="color:' + tone + '">' + esc(l.result) + '</span> ' + esc(l.line) + ' <span style="color:#8b97a3">(받음 ' + hm(l.receivedAt) + (l.lagMin != null ? ' · ' + esc(lagText(l.lagMin)) : '') + ')</span>'
                + (l.result !== '일치' && l.mmis ? '<br>&nbsp;&nbsp;그때 앱(MMIS): ' + esc(l.mmis) : '') + '</div>';
        }).join(''));
        var eps = (s.episodes || []).filter(function (e) { return hourOf(e.end) === h; });
        if (eps.length) out.push('<div style="font-weight:700;margin:6px 0 2px">다른 상태였던 구간(끝난 것)</div>' + eps.map(function (e) {
            return '<div>• ' + esc(e.zone) + ' ' + hm(e.start) + '~' + hm(e.end) + ' (' + e.min + '분, ' + esc(e.first) + ', ' + (e.worst === 'diff' ? '<span style="color:#f87171">10분 넘음</span>' : '10분 안에 같아짐') + ')</div>';
        }).join(''));
        var evs = (s.events || []).filter(function (e) { return hourOf(e.t) === h; });
        if (evs.length) out.push('<div style="font-weight:700;margin:6px 0 2px">일어난 일</div>' + evs.map(function (e) {
            var what = e.kind === 'apply' ? '카톡판 반영: ' + e.line + ' (' + (e.device || '') + ')'
                : e.kind === 'mmis' ? '앱(MMIS) 변화: ' + e.zone + ' → ' + e.to
                : e.kind === 'missedLine' ? '놓친 글 발견(반영 안 함): ' + e.line
                : e.kind === 'baseline' ? '시험 시작 — ' + e.note
                : e.kind === 'anchor' ? '마지막으로 본 글 찾기: ' + (e.status === 'found' ? '찾음' : e.status === 'missing' ? '못 찾음(놓쳤을 수 있음)' : e.status) + ' (' + (e.device || '') + ')'
                : e.kind === 'device' ? '기기 설정: ' + e.device + ' ' + e.action : e.kind;
            return '<div style="color:#9aa7b4">' + hm(e.t) + ' ' + esc(what) + '</div>';
        }).join(''));
        return out.length ? out.join('') : '<div style="color:#8b97a3">이 시간에는 기록된 변화가 없습니다.</div>';
    }

    /**
     * 비교현황 창을 연다(또는 날짜를 바꿔 다시 그린다).
     * @param {string} [day] - 'YYYY-MM-DD'(없으면 오늘)
     * [연계] ← 「비교현황」 버튼 / → GET /api/admin/kakao-relay/compare
     */
    async function openCompare(day) {
        var ov = document.getElementById('kr-compare');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'kr-compare';
            ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:12px';
            ov.addEventListener('click', function (e) { if (e.target === ov) closeCompare(); });
            document.body.appendChild(ov);
        }
        var shell = function (inner) {
            return '<div style="width:min(960px,100%);max-height:92vh;overflow:auto;background:#0f141a;border:1px solid #2a3340;border-radius:14px;padding:14px 16px;color:#e6edf3">'
                + '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div style="font-weight:800;font-size:1rem">📊 비교현황 — 카톡판 특보현황 ↔ 앱 특보현황(MMIS)</div>'
                + '<button type="button" onclick="window.__krCompareClose()" style="white-space:nowrap;background:none;border:1px solid #2a3340;color:#cdd6e0;border-radius:8px;padding:4px 10px;cursor:pointer">닫기</button></div>'
                + inner + '</div>';
        };
        ov.innerHTML = shell('<div style="padding:16px;color:#8b97a3">불러오는 중…</div>');
        var s;
        try {
            var r = await fetch('/api/admin/kakao-relay/compare' + (day ? '?day=' + encodeURIComponent(day) : ''), { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            s = await r.json();
        } catch (e) {
            console.warn('[카톡 중계] 비교현황 불러오기 실패:', e && e.message);
            ov.innerHTML = shell('<div style="padding:16px;color:#f87171">비교현황을 불러오지 못했습니다 — ' + esc(e.message) + '</div>');
            return;
        }
        var cur = s.current || {};
        var T = s.totals || {};
        var L = T.lines || {};
        // 마크다운 보고서 내려받기 — 사람이 읽고, 그대로 AI 에게 줘서 분석할 수 있는 상세 보고서(사용자 확정 2026-11-03).
        var html = '<div style="display:flex;flex-wrap:wrap;gap:0;margin-top:6px">'
            + btn('이 날 보고서 내려받기(.md)', 'window.__krReport(\'' + esc(s.day) + '\')', '52,211,153')
            + btn('시험 전체 보고서 내려받기(.md)', 'window.__krReport(\'all\')', '52,211,153') + '</div>'
            + '<div style="font-size:0.78rem;color:#9aa7b4;margin:8px 0 4px;line-height:1.5">'
            + '카톡 글만으로 만든 특보현황이 앱 특보현황(MMIS)과 같은지 서버가 <b>1분마다 구역별로</b> 비교합니다. 기록만 하며 앱 화면·푸시는 바꾸지 않습니다.<br>'
            + badge('같음', STATUS.match[1]) + ' 양쪽이 같음 · ' + badge('반영 대기', STATUS.wait[1]) + ' 한쪽이 바뀐 지 ' + (s.waitMin || 10) + '분 안(정상 시간차) · '
            + badge('차이', STATUS.diff[1]) + ' ' + (s.waitMin || 10) + '분 넘게 다름 → 확인 필요 · ' + badge('태풍(비교 제외)', STATUS.typhoon[1]) + ' 카톡이 태풍 발효를 보내지 않음'
            + (cur.startedAt ? '<br>시험 시작: ' + esc(kst(cur.startedAt)) + ' (시작 상태는 그 시각 앱 특보현황으로 채움, 그 뒤 변화는 카톡 줄로만)' : '<br><span style="color:#fbbf24">아직 비교가 시작되지 않았습니다(서버가 1분 안에 시작합니다).</span>')
            + '</div>';
        // 지금 상태
        if (cur.error) html += box('<span style="color:#f87171">카톡판 상태를 읽지 못했습니다 — ' + esc(cur.error) + '</span>');
        else if (cur.at) {
            var rows = (cur.rows || []).map(function (x) {
                var st = STATUS[x.status] || [x.status, '148,163,184'];
                return '<tr>' + td(esc(x.zone)) + td(badge(st[0], st[1])) + td(esc(x.kakao)) + td(esc(x.mmis)) + td(esc((x.diffs || []).map(function (d) { return DIFF_WORD[d] || d; }).join(', '))) + '</tr>';
            });
            html += section('🟢 지금 (' + esc(kst(cur.at, true)) + ' 비교)', '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'
                + stat('같음', (cur.match || 0) + '구역', '특보 걸린 구역 ' + (cur.active || 0)) + stat('반영 대기', (cur.wait || 0) + '구역', '', '#fbbf24')
                + stat('차이', (cur.diff || 0) + '구역', '', cur.diff ? '#f87171' : null) + stat('태풍(비교 제외)', (cur.typhoon || 0) + '구역') + '</div>'
                + (rows.length ? table(['구역', '상태', '카톡판', '앱(MMIS)', '다른 것'], rows) : '<div style="font-size:0.78rem;color:#8b97a3">지금 특보가 걸린 구역이 양쪽 다 없습니다.</div>'));
        }
        // 날짜 고르기
        var days = (s.days || []).slice().reverse();
        html += section('📅 날짜', '<div style="display:flex;flex-wrap:wrap;gap:4px">' + (days.length ? days.map(function (d) {
            var sel = d.day === s.day;
            var bad = (d.lines && d.lines['불일치']) || d.diffMin;
            return '<button type="button" onclick="window.__krCompare(\'' + d.day + '\')" style="padding:4px 9px;border-radius:8px;cursor:pointer;font-size:0.76rem;'
                + 'border:1px solid ' + (sel ? '#a78bfa' : '#2a3340') + ';background:' + (sel ? 'rgba(167,139,250,0.18)' : '#161b22') + ';color:' + (bad ? '#fca5a5' : '#cdd6e0') + '">'
                + esc(d.day.slice(5).replace('-', '/')) + '</button>';
        }).join('') : '<span style="font-size:0.78rem;color:#8b97a3">아직 기록이 없습니다.</span>') + '</div>');
        // 그날 합계
        var devs = Object.keys(T.devices || {}).map(function (k) { return k + ' ' + T.devices[k]; }).join(' · ');
        var beats = Object.keys(T.beats || {}).map(function (k) { return k + ' ' + T.beats[k] + '회'; }).join(' · ');
        html += section('🧮 ' + esc(s.day) + ' 합계', '<div style="display:flex;flex-wrap:wrap;gap:6px">'
            + stat('받은 글', (T.msgs || 0) + '건', devs || '—')
            + stat('새 특보 줄', (T.newLines || 0) + '줄', '놓친 글 줄 ' + (T.missedLines || 0) + ' · 중복 ' + (T.dups || 0) + '건')
            + stat('카톡 줄 → 일치', (L['일치'] || 0) + '줄', T.lagAvg != null ? '평균 ' + lagText(Math.round(T.lagAvg)) : '', '#34d399')
            + stat('카톡 줄 → 불일치', (L['불일치'] || 0) + '줄', '6시간 안에 같아지지 않음', L['불일치'] ? '#f87171' : null)
            + stat('차이가 있던 시간', '약 ' + (T.diffMin || 0) + '분', '반영 대기 ' + (T.waitMin || 0) + '분', T.diffMin ? '#f87171' : null)
            + stat('앱(MMIS) 변화', (T.mmisChanges || 0) + '번', T.mmisError ? '특보현황 못 읽음 ' + T.mmisError + '번' : '', T.mmisError ? '#fbbf24' : null)
            + stat('기타', '대체 ' + (L['다음 글로 대체'] || 0) + ' · 태풍 ' + (L['비교 제외(태풍)'] || 0), '모르는 구역 ' + (T.unknownZone || 0) + ' · 잘린 끝 줄 ' + (T.cutTail || 0))
            + stat('신호', beats || '—', T.ignored ? '끈 기기 글 거절 ' + T.ignored + '건' : '')
            + stat('비교가 안 돈 시간', (T.gapHours || 0) + '시간', '특보현황 갱신 멈춤 의심 ' + (T.staleTicks || 0) * 5 + '분', (T.gapHours || T.staleTicks) ? '#fbbf24' : null) + '</div>');
        // 시간대별
        var hrows = (s.hours || []).map(function (H) {
            var any = H.msgs || H.applied || H.mmisChanges || H.diffMin || H.waitMin || H.mmisError || H.gap || H.staleTicks || Object.keys(H.lines || {}).length;
            var tone = H.diffMin ? 'background:rgba(248,113,113,0.08);' : H.waitMin ? 'background:rgba(251,191,36,0.06);' : '';
            var res = Object.keys(H.lines || {}).map(function (k) { return k + ' ' + H.lines[k]; }).join(' · ');
            // 조용함과 멈춤을 구분해 보여 준다 — 비교가 안 돈 시간, 특보현황 파일이 굳은 시간, 못 읽은 시간.
            var warn = [H.gap ? '⚠ 비교 기록 없음(멈춤?)' : '', H.staleTicks ? '⚠ 특보현황 갱신 멈춤 의심 ' + H.staleTicks * 5 + '분' : '', H.mmisError ? '⚠ 특보현황 못 읽음 ' + H.mmisError + '번' : ''].filter(Boolean).join(' · ');
            if (warn) res = '<span style="color:#fbbf24">' + esc(warn) + '</span>' + (res ? ' · ' + esc(res) : '');
            else res = esc(res);
            var row = '<tr style="cursor:' + (any ? 'pointer' : 'default') + ';' + tone + (any ? '' : 'opacity:0.45;') + '"' + (any ? ' onclick="window.__krHour(' + H.hour + ')"' : '') + '>'
                + td(String(H.hour).padStart(2, '0') + '시', 'white-space:nowrap') + td(H.msgs || '') + td(H.applied || '') + td(H.mmisChanges || '')
                + td(H.waitMin ? H.waitMin + '분' : '') + td(H.diffMin ? '<b style="color:#f87171">' + H.diffMin + '분</b>' : '') + td(res) + '</tr>';
            return row + '<tr id="kr-hour-' + H.hour + '" style="display:none"><td colspan="7" style="padding:6px 10px;background:#11161d;font-size:0.76rem;line-height:1.55">' + hourDetail(s, H.hour) + '</td></tr>';
        });
        html += section('🕒 시간대별 (줄을 누르면 펼침)', table(['시각', '받은 글', '카톡판 반영', 'MMIS 변화', '반영 대기', '차이', '카톡 줄 결과'], hrows));
        // 기록 있는 날 전체(10일 추세)
        if ((s.days || []).length > 1) {
            html += section('📈 날짜별 추세', table(['날짜', '받은 글', '새 특보 줄', '일치', '불일치', '차이(분)', '놓친 글 줄'], (s.days || []).slice().reverse().map(function (d) {
                var l = d.lines || {};
                return '<tr>' + td(esc(d.day)) + td(d.msgs || 0) + td(d.newLines || 0) + td(l['일치'] || 0) + td(l['불일치'] ? '<b style="color:#f87171">' + l['불일치'] + '</b>' : 0) + td(d.diffMin ? '<b style="color:#f87171">' + d.diffMin + '</b>' : 0) + td(d.missedLines || 0) + '</tr>';
            })));
        }
        ov.innerHTML = shell(html);
    }
    function closeCompare() {
        var ov = document.getElementById('kr-compare');
        if (ov) ov.remove();
    }

    /**
     * 마크다운 보고서를 내려받는다(관리자 토큰이 붙도록 fetch 로 받아 파일로 저장).
     * @param {string} day - 'YYYY-MM-DD' 또는 'all'
     * [연계] ← 비교현황 창 버튼 / → GET /api/admin/kakao-relay/report.md
     */
    async function downloadReport(day) {
        try {
            var r = await fetch('/api/admin/kakao-relay/report.md?day=' + encodeURIComponent(day), { cache: 'no-store' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var blob = await r.blob();
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'kakao_relay_report_' + day + '.md';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) {
            console.warn('[카톡 중계] 보고서 내려받기 실패:', e && e.message);
            window.alert('보고서를 내려받지 못했습니다 — ' + e.message);
        }
    }

    window.__krReport = downloadReport;
    window.__krCompare = openCompare;
    window.__krCompareClose = closeCompare;
    window.__krHour = function (h) {
        var tr = document.getElementById('kr-hour-' + h);
        if (tr) tr.style.display = tr.style.display === 'none' ? '' : 'none';
    };
    if (typeof document !== 'undefined') document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('kr-compare')) closeCompare(); });

    window.renderKakaoRelayAdminTab = renderKakaoRelayAdminTab;
    window.__krDevice = deviceAction;
    window.__krRefresh = function () { if (lastContainer) renderKakaoRelayAdminTab(lastContainer); };
})();
