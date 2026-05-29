/**
 * ============================================================================
 * 파일명: js/admin_demo.js
 * 역할: [데모 시연] 관리자 센터 — 데모 특보 슬롯 추가/저장/리스트 + 표출 버튼
 * ============================================================================
 *
 * [UI 흐름]
 * 1. [+ 데모 특보 추가] 버튼 → 입력 모달 (구역·종류·등급·발표/발효/해제 시각 +
 *    "다가오는 특보 병기" 체크 시 추가 입력란 펼침)
 * 2. 모달에서 [저장] → 서버 demo_slots.json 에 누적 → 리스트에 한 줄 추가
 * 3. 리스트 각 줄 오른쪽 [표출] 버튼 → /api/admin/demo/emit 호출
 *    → 관리자 기기에만 푸시 + demo_active.json 누적 → 관리자 기기 화면에 표출
 * 4. 표출 중인 줄은 [내리기], 전체는 [전체 내리기] 로 제거
 *
 * [표출 누적] A 표출 → B 표출 = A+B 동시 표출 (서버에서 누적, 클라가 머지)
 *
 * [테스트 모드] 상단 토글로 ON/OFF. ON 이면 관리자 등록 기기 화면이 "빈 특보"
 *   상태로 전환되고(실제 특보 숨김) 데모 등록/표출 UI 가 활성화된다. OFF 면 등록
 *   UI 비활성(저장 슬롯은 보존) + 실제 특보 복원. 일반 사용자에는 영향 없음.
 *
 * [연계]
 * - 서버: /api/admin/demo/slots (GET/POST), /demo/emit, /demo/retract, /demo/clear,
 *         /demo/testmode (POST)
 * - 화면 표출/빈화면은 js/demo_alert.js 가 관리자 기기에서 폴링·머지로 담당
 * - admin.js 의 통합관리자센터 메인탭 "시연" 에서 renderDemoAlertTab(container) 로 진입
 * ============================================================================
 */
(function () {
    'use strict';

    var WARN_TYPES = ['풍랑', '태풍', '강풍', '호우', '대설', '해일'];
    var LEVELS = ['주의보', '경보'];
    // 단계 — 앱 push_helpers 템플릿에 대응 (발표/발효/해제/격상발효/격하발효)
    var COMMANDS = ['발표', '발효', '해제', '격상', '격하'];

    var _slots = [];     // 저장된 데모 슬롯
    var _active = [];    // 현재 표출 중인 슬롯 (id 목록 비교용)
    var _testMode = false; // 테스트 모드 ON 여부 (서버 상태)

    /** 전체 구역 목록 (config.js SUB_REGION_ZONES 평탄화) */
    function _allZones() {
        var zones = [];
        if (typeof SUB_REGION_ZONES !== 'undefined') {
            Object.keys(SUB_REGION_ZONES).forEach(function (sub) {
                (SUB_REGION_ZONES[sub] || []).forEach(function (z) {
                    if (zones.indexOf(z) === -1) zones.push(z);
                });
            });
        }
        return zones;
    }

    /** datetime-local → 기상청 형식 */
    function _toKma(s) {
        if (!s) return '';
        var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
        if (!m) return s;
        return m[1] + '년 ' + m[2] + '월 ' + m[3] + '일 ' + m[4] + '시 ' + m[5] + '분';
    }

    /** 기상청 형식 → datetime-local (수정 시 프리필용) */
    function _toLocal(s) {
        if (!s) return '';
        var m = String(s).match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{1,2})시\s*(\d{1,2})분/);
        if (!m) return '';
        return m[1] + '-' + m[2] + '-' + m[3] + 'T' + String(m[4]).padStart(2, '0') + ':' + String(m[5]).padStart(2, '0');
    }

    function _isActive(slotId) {
        return _active.some(function (a) { return a.id === slotId; });
    }

    // ── 서버 통신 ──────────────────────────────────────────────
    function _fetchSlots() {
        return fetch('/api/admin/demo/slots', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : { slots: [], active: [], testMode: false }; })
            .then(function (data) {
                _slots = data.slots || [];
                _active = data.active || [];
                _testMode = !!data.testMode;
                return data;
            });
    }

    /** 테스트 모드 ON/OFF 토글 */
    window.demoToggleTestMode = function (enabled) {
        // 즉시 UI 반영(낙관적) 후 서버 반영
        _testMode = !!enabled;
        var c = document.getElementById('unified-admin-body');
        if (c) _renderList(c);
        fetch('/api/admin/demo/testmode', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !!enabled })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            _testMode = !!(resp && resp.testMode);
            _active = (resp && resp.active) || _active;
            if (c) _renderList(c);
            // 시연 기기 본인 화면도 즉시 갱신
            if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
        }).catch(function (e) {
            alert('테스트 모드 전환 실패: ' + e.message);
            _testMode = !enabled;
            if (c) _renderList(c);
        });
    };

    function _saveSlots() {
        return fetch('/api/admin/demo/slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slots: _slots })
        }).then(function (r) { return r.json(); });
    }

    // ── 렌더 ──────────────────────────────────────────────────
    window.renderDemoAlertTab = function (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
        _fetchSlots().then(function () { _renderList(container); });
    };

    function _renderList(container) {
        var activeCount = _active.length;
        var on = _testMode;

        // ── 테스트 모드 토글 (상단 고정) ──
        var html = ''
            + '<div class="admin-section-title"><i class="fa-solid fa-flask" style="color:#a855f7;"></i> 시연 (테스트 모드)</div>'
            + '<div style="border:1px solid ' + (on ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.1)') + ';border-radius:12px;padding:16px;margin-bottom:16px;background:' + (on ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.02)') + ';">'
            + '  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
            + '    <div style="flex:1;min-width:220px;">'
            + '      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
            + '        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (on ? '#a855f7' : '#475569') + (on ? ';box-shadow:0 0 8px #a855f7' : '') + ';"></span>'
            + '        <span style="color:#fff;font-weight:700;font-size:1rem;">테스트 모드 ' + (on ? 'ON' : 'OFF') + '</span>'
            + '      </div>'
            + '      <div style="color:#94a3b8;font-size:0.76rem;line-height:1.5;">'
            + (on
                ? '        켜짐 — <b style="color:#d8b4fe;">이 관리자 기기 화면</b>의 실제 특보가 모두 사라지고, 아래에서 표출한 데모 특보만 인덱스·지도에 표시됩니다.'
                : '        꺼짐 — 실제 특보가 정상 표출됩니다. 데모 등록/표출을 하려면 테스트 모드를 켜세요.')
            + '        <br><span style="color:#64748b;">※ 관리자 기기로 등록되지 않은 일반 사용자에게는 어떤 경우에도 영향이 없습니다.</span>'
            + '      </div>'
            + '    </div>'
            + '    <label style="display:flex;align-items:center;cursor:pointer;flex-shrink:0;">'
            + '      <input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="demoToggleTestMode(this.checked)" style="width:0;height:0;opacity:0;position:absolute;">'
            + '      <span style="display:inline-flex;align-items:center;width:58px;height:30px;border-radius:15px;background:' + (on ? '#a855f7' : '#475569') + ';transition:all 0.2s;padding:3px;box-sizing:border-box;">'
            + '        <span style="width:24px;height:24px;border-radius:50%;background:#fff;transition:all 0.2s;transform:translateX(' + (on ? '28px' : '0') + ');"></span>'
            + '      </span>'
            + '    </label>'
            + '  </div>'
            + '</div>';

        // ── 데모 특보 등록/리스트 (테스트 모드 OFF 시 비활성) ──
        var disabledWrap = on ? '' : 'opacity:0.45;pointer-events:none;filter:grayscale(0.4);';
        html += '<div style="' + disabledWrap + '">'
            + '<div class="admin-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:0.92rem;">'
            + '  <div><i class="fa-solid fa-list" style="color:#a855f7;"></i> 데모 특보 목록</div>'
            + '  <div style="display:flex;gap:8px;">'
            + '    <button onclick="openDemoAddModal()" style="padding:7px 14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.82rem;"><i class="fa-solid fa-plus"></i> 데모 특보 추가</button>'
            + (activeCount > 0 ? '    <button onclick="demoClearAll()" style="padding:7px 14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;color:#fca5a5;cursor:pointer;font-weight:600;font-size:0.82rem;"><i class="fa-solid fa-eraser"></i> 전체 내리기 (' + activeCount + ')</button>' : '')
            + '  </div>'
            + '</div>'
            + '<div style="margin-bottom:10px;color:#94a3b8;font-size:0.78rem;line-height:1.5;">'
            + '  <i class="fa-solid fa-circle-info"></i> 미리 저장해 두고, 원하는 특보의 <b style="color:#c4b5fd;">표출</b> 버튼을 누르면 '
            + '  이 관리자 기기에 푸시 알림이 오고 인덱스/지도/안내문구에 표출됩니다. 여러 개를 누르면 누적 표출됩니다.'
            + '</div>';

        if (_slots.length === 0) {
            html += '<div style="text-align:center;padding:40px;color:#64748b;border:1px dashed rgba(255,255,255,0.1);border-radius:10px;">저장된 데모 특보가 없습니다. <b>[데모 특보 추가]</b> 로 만들어 보세요.</div>';
        } else {
            html += '<div style="display:flex;flex-direction:column;gap:8px;">';
            _slots.forEach(function (slot, idx) {
                html += _slotRowHtml(slot, idx);
            });
            html += '</div>';
        }
        html += '</div>';

        container.innerHTML = html;
    }

    function _slotRowHtml(slot, idx) {
        var active = _isActive(slot.id);
        var typeColor = slot.warnType === '태풍' ? '#dc2626' : (slot.level === '경보' ? '#ef4444' : '#22c55e');
        var pre = slot.upcoming && slot.upcoming.enabled;
        var num = idx + 1;
        var cmd = slot.command || '발효';
        var cmdLabel = (cmd === '격상' || cmd === '격하')
            ? (slot.prevLevel ? slot.prevLevel + '→' + (slot.level || '') + ' ' + cmd : cmd)
            : cmd;
        var cmdColor = cmd === '해제' ? '#22c55e' : (cmd === '격상' ? '#ef4444' : (cmd === '격하' ? '#3b82f6' : '#a855f7'));

        var timeLine = '';
        if (slot.tmFc) timeLine += '발표 ' + _shortTime(slot.tmFc) + ' ';
        if (slot.tmEf) timeLine += '· 발효 ' + _shortTime(slot.tmEf) + ' ';
        if (slot.tmEd) timeLine += '· 해제예정 ' + _shortTime(slot.tmEd);

        return ''
            + '<div style="border:1px solid ' + (active ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.08)') + ';border-radius:10px;padding:12px 14px;background:' + (active ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)') + ';display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'
            + '  <div style="flex:1;min-width:200px;">'
            + '    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
            + '      <span style="color:#64748b;font-size:0.75rem;font-weight:700;">#' + num + '</span>'
            + '      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + typeColor + ';"></span>'
            + '      <span style="color:#fff;font-weight:700;font-size:0.92rem;">' + (slot.zoneName || '(구역 미지정)') + '</span>'
            + '      <span style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:1px 8px;border-radius:8px;font-size:0.75rem;">' + (slot.warnType || '') + (slot.level || '') + '</span>'
            + '      <span style="background:' + cmdColor + '22;color:' + cmdColor + ';border:1px solid ' + cmdColor + '55;padding:1px 8px;border-radius:8px;font-size:0.72rem;font-weight:700;">' + cmdLabel + '</span>'
            + (active ? '      <span style="background:rgba(168,85,247,0.25);color:#d8b4fe;padding:1px 8px;border-radius:8px;font-size:0.72rem;font-weight:700;">표출 중</span>' : '')
            + (pre ? '      <span style="background:rgba(148,163,184,0.2);color:#cbd5e1;padding:1px 8px;border-radius:8px;font-size:0.72rem;">+다가오는</span>' : '')
            + '    </div>'
            + '    <div style="color:#94a3b8;font-size:0.76rem;">' + (timeLine || '시각 미지정') + '</div>'
            + (pre ? '    <div style="color:#94a3b8;font-size:0.73rem;margin-top:2px;">└ 다가오는: ' + (slot.upcoming.warnType || '') + (slot.upcoming.level || '') + ' ' + (slot.upcoming.zoneName ? '(' + slot.upcoming.zoneName + ')' : '') + (slot.upcoming.tmEf ? ' 발효 ' + _shortTime(slot.upcoming.tmEf) : '') + '</div>' : '')
            + '  </div>'
            + '  <div style="display:flex;gap:6px;">'
            + (active
                ? '    <button onclick="demoRetract(\'' + slot.id + '\')" style="padding:8px 16px;background:rgba(148,163,184,0.2);border:1px solid rgba(148,163,184,0.4);border-radius:8px;color:#cbd5e1;cursor:pointer;font-weight:700;font-size:0.82rem;"><i class="fa-solid fa-arrow-down"></i> 내리기</button>'
                : '    <button onclick="demoEmit(\'' + slot.id + '\')" style="padding:8px 18px;background:linear-gradient(135deg,#a855f7,#7c3aed);border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:700;font-size:0.82rem;"><i class="fa-solid fa-tower-broadcast"></i> 표출</button>')
            + '    <button onclick="openDemoAddModal(\'' + slot.id + '\')" title="수정" style="padding:8px 11px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);border-radius:8px;color:#93c5fd;cursor:pointer;font-size:0.82rem;"><i class="fa-solid fa-pen"></i></button>'
            + '    <button onclick="demoDeleteSlot(\'' + slot.id + '\')" title="삭제" style="padding:8px 11px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;cursor:pointer;font-size:0.82rem;"><i class="fa-solid fa-trash"></i></button>'
            + '  </div>'
            + '</div>';
    }

    function _shortTime(s) {
        if (!s) return '';
        var m = String(s).match(/(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/);
        if (m) return m[2] + '일 ' + String(m[3]).padStart(2, '0') + ':' + String(m[4]).padStart(2, '0');
        return String(s);
    }

    /**
     * datetime-local 입력 + [지금][−1h][+1h] 버튼 묶음 HTML.
     * @param {string} id   input element id
     * @param {string} label 레이블
     * @param {string} value 초기값(datetime-local 형식 yyyy-MM-ddTHH:mm)
     */
    function _timeFieldHtml(id, label, value) {
        var inS = 'flex:1;padding:9px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.88rem;box-sizing:border-box;color-scheme:dark;min-width:0;';
        var lblS = 'display:block;color:#94a3b8;font-size:0.78rem;margin-bottom:4px;';
        var btnS = 'padding:8px 9px;background:rgba(59,130,246,0.18);border:1px solid rgba(59,130,246,0.35);border-radius:7px;color:#93c5fd;cursor:pointer;font-size:0.74rem;font-weight:700;white-space:nowrap;flex-shrink:0;';
        return ''
            + '<div style="margin-bottom:12px;">'
            + '  <label style="' + lblS + '">' + label + '</label>'
            + '  <div style="display:flex;gap:5px;align-items:center;">'
            + '    <input type="datetime-local" id="' + id + '" style="' + inS + '" value="' + (value || '') + '">'
            + '    <button type="button" onclick="demoTimeNow(\'' + id + '\')" style="' + btnS + '">지금</button>'
            + '    <button type="button" onclick="demoTimeStep(\'' + id + '\',-1)" style="' + btnS + '">−1h</button>'
            + '    <button type="button" onclick="demoTimeStep(\'' + id + '\',1)" style="' + btnS + '">+1h</button>'
            + '  </div>'
            + '</div>';
    }

    /** 현재 시각(KST, 분 0)을 datetime-local 문자열로 */
    function _nowLocal() {
        var d = new Date(Date.now() + 9 * 60 * 60 * 1000);
        d.setUTCMinutes(0, 0, 0);
        return d.toISOString().slice(0, 16);
    }

    /** [지금] — 입력칸을 현재 시각(정시)으로 */
    window.demoTimeNow = function (id) {
        var el = document.getElementById(id);
        if (el) el.value = _nowLocal();
    };

    /** [+1h]/[−1h] — 입력칸 시각을 1시간 단위로 가감 (비어있으면 지금 기준) */
    window.demoTimeStep = function (id, deltaH) {
        var el = document.getElementById(id);
        if (!el) return;
        var base = el.value || _nowLocal();
        var m = base.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!m) { el.value = _nowLocal(); return; }
        // 로컬(KST) 시각으로 Date 구성 후 시간 가감 — UTC 변환 오차 방지 위해 직접 계산
        var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
        dt.setUTCHours(dt.getUTCHours() + deltaH);
        el.value = dt.toISOString().slice(0, 16);
    };

    /** 단계(command) 변경 시 — 격상/격하면 '이전 등급' 입력란 표시 */
    window.demoOnCommandChange = function () {
        var cmd = document.getElementById('dm-command');
        var wrap = document.getElementById('dm-prevlevel-wrap');
        if (!cmd || !wrap) return;
        var show = (cmd.value === '격상' || cmd.value === '격하');
        wrap.style.display = show ? 'block' : 'none';
    };

    // ── 추가/수정 모달 ─────────────────────────────────────────
    window.openDemoAddModal = function (editId) {
        var editing = editId ? _slots.find(function (s) { return s.id === editId; }) : null;
        var old = document.getElementById('demo-add-modal');
        if (old) old.remove();

        var zoneOpts = _allZones().map(function (z) {
            var sel = editing && editing.zoneName === z ? ' selected' : '';
            return '<option value="' + z + '"' + sel + '>' + z + '</option>';
        }).join('');
        var typeOpts = function (cur) {
            return WARN_TYPES.map(function (t) { return '<option value="' + t + '"' + (cur === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
        };
        var levelOpts = function (cur) {
            return LEVELS.map(function (l) { return '<option value="' + l + '"' + (cur === l ? ' selected' : '') + '>' + l + '</option>'; }).join('');
        };

        var inS = 'width:100%;padding:9px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.88rem;box-sizing:border-box;color-scheme:dark;';
        var lblS = 'display:block;color:#94a3b8;font-size:0.78rem;margin-bottom:4px;';
        var up = editing && editing.upcoming && editing.upcoming.enabled ? editing.upcoming : null;
        var curCmd = editing ? (editing.command || '발효') : '발효';
        var isLevelChange = (curCmd === '격상' || curCmd === '격하');
        var cmdOpts = COMMANDS.map(function (c) { return '<option value="' + c + '"' + (curCmd === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');

        var modal = document.createElement('div');
        modal.id = 'demo-add-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
        modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

        modal.innerHTML = ''
            + '<div style="background:#1e293b;border-radius:14px;width:92%;max-width:460px;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);">'
            + '  <div style="padding:16px;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:1;">'
            + '    <h4 style="margin:0;color:#fff;font-size:0.95rem;"><i class="fa-solid fa-flask"></i> ' + (editing ? '데모 특보 수정' : '데모 특보 추가') + '</h4>'
            + '    <button onclick="document.getElementById(\'demo-add-modal\').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;">&times;</button>'
            + '  </div>'
            + '  <div style="padding:18px;">'
            + '    <div style="margin-bottom:12px;"><label style="' + lblS + '">단계</label><select id="dm-command" onchange="demoOnCommandChange()" style="' + inS + '">' + cmdOpts + '</select></div>'
            + '    <div id="dm-prevlevel-wrap" style="display:' + (isLevelChange ? 'block' : 'none') + ';margin-bottom:12px;"><label style="' + lblS + '">이전 등급 (격상/격하 전 등급)</label><select id="dm-prevlevel" style="' + inS + '">' + LEVELS.map(function (l) { return '<option value="' + l + '"' + (editing && editing.prevLevel === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>'
            + '    <div style="margin-bottom:12px;"><label style="' + lblS + '">구역</label><select id="dm-zone" style="' + inS + '">' + zoneOpts + '</select></div>'
            + '    <div style="display:flex;gap:8px;margin-bottom:12px;">'
            + '      <div style="flex:1;"><label style="' + lblS + '">종류</label><select id="dm-type" style="' + inS + '">' + typeOpts(editing ? editing.warnType : '풍랑') + '</select></div>'
            + '      <div style="flex:1;"><label style="' + lblS + '">등급</label><select id="dm-level" style="' + inS + '">' + levelOpts(editing ? editing.level : '주의보') + '</select></div>'
            + '    </div>'
            + _timeFieldHtml('dm-tmFc', '발표 시각', editing ? _toLocal(editing.tmFc) : '')
            + _timeFieldHtml('dm-tmEf', '발효 시각', editing ? _toLocal(editing.tmEf) : '')
            + _timeFieldHtml('dm-tmEd', '해제 예정 시각', editing ? _toLocal(editing.tmEd) : '')
            + '    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:8px;">'
            + '      <input type="checkbox" id="dm-up-enabled" onchange="toggleDemoUpcoming()"' + (up ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">'
            + '      <span style="color:#e2e8f0;font-size:0.85rem;font-weight:600;">다가오는 특보 병기</span>'
            + '    </label>'
            + '    <div id="dm-up-fields" style="display:' + (up ? 'block' : 'none') + ';padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px dashed rgba(255,255,255,0.1);margin-bottom:14px;">'
            + '      <div style="margin-bottom:10px;"><label style="' + lblS + '">구역 (미지정 시 위 구역과 동일)</label><select id="dm-up-zone" style="' + inS + '"><option value="">— 위 구역과 동일 —</option>' + _allZones().map(function (z) { return '<option value="' + z + '"' + (up && up.zoneName === z ? ' selected' : '') + '>' + z + '</option>'; }).join('') + '</select></div>'
            + '      <div style="display:flex;gap:8px;margin-bottom:10px;">'
            + '        <div style="flex:1;"><label style="' + lblS + '">종류</label><select id="dm-up-type" style="' + inS + '">' + typeOpts(up ? up.warnType : '풍랑') + '</select></div>'
            + '        <div style="flex:1;"><label style="' + lblS + '">등급</label><select id="dm-up-level" style="' + inS + '">' + levelOpts(up ? up.level : '주의보') + '</select></div>'
            + '      </div>'
            + _timeFieldHtml('dm-up-tmEf', '발효 예정 시각', up ? _toLocal(up.tmEf) : '')
            + '    </div>'
            + '    <button onclick="submitDemoSlot(' + (editing ? '\'' + editing.id + '\'' : 'null') + ')" style="width:100%;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;"><i class="fa-solid fa-floppy-disk"></i> 저장</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(modal);
    };

    window.toggleDemoUpcoming = function () {
        var cb = document.getElementById('dm-up-enabled');
        var f = document.getElementById('dm-up-fields');
        if (f) f.style.display = cb && cb.checked ? 'block' : 'none';
    };

    window.submitDemoSlot = function (editId) {
        var zone = document.getElementById('dm-zone').value;
        if (!zone) { alert('구역을 선택하세요.'); return; }
        var upEnabled = document.getElementById('dm-up-enabled').checked;

        var cmd = document.getElementById('dm-command').value || '발효';
        var prevEl = document.getElementById('dm-prevlevel');
        var slot = {
            id: editId || undefined,
            zoneName: zone,
            warnType: document.getElementById('dm-type').value,
            level: document.getElementById('dm-level').value,
            command: cmd,
            prevLevel: (cmd === '격상' || cmd === '격하') && prevEl ? prevEl.value : '',
            tmFc: _toKma(document.getElementById('dm-tmFc').value),
            tmEf: _toKma(document.getElementById('dm-tmEf').value),
            tmEd: _toKma(document.getElementById('dm-tmEd').value),
            upcoming: upEnabled ? {
                enabled: true,
                zoneName: document.getElementById('dm-up-zone').value || zone,
                warnType: document.getElementById('dm-up-type').value,
                level: document.getElementById('dm-up-level').value,
                tmEf: _toKma(document.getElementById('dm-up-tmEf').value)
            } : { enabled: false }
        };

        if (editId) {
            var i = _slots.findIndex(function (s) { return s.id === editId; });
            if (i >= 0) slot.id = editId, _slots[i] = slot;
        } else {
            slot.id = 'demo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            _slots.push(slot);
        }

        _saveSlots().then(function (resp) {
            if (resp && resp.slots) _slots = resp.slots;
            var modal = document.getElementById('demo-add-modal');
            if (modal) modal.remove();
            var c = document.getElementById('unified-admin-body');
            if (c) _renderList(c);
        }).catch(function (e) { alert('저장 실패: ' + e.message); });
    };

    window.demoDeleteSlot = function (slotId) {
        if (!confirm('이 데모 특보를 삭제할까요?')) return;
        _slots = _slots.filter(function (s) { return s.id !== slotId; });
        // 표출 중이면 같이 내림
        fetch('/api/admin/demo/retract', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId: slotId })
        }).catch(function () { });
        _saveSlots().then(function (resp) {
            if (resp && resp.slots) _slots = resp.slots;
            return _fetchSlots();
        }).then(function () {
            var c = document.getElementById('unified-admin-body');
            if (c) _renderList(c);
        });
    };

    // ── 표출 / 내리기 ──────────────────────────────────────────
    window.demoEmit = function (slotId) {
        var btnReload = function () {
            var c = document.getElementById('unified-admin-body');
            if (c) _renderList(c);
        };
        fetch('/api/admin/demo/emit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId: slotId })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (resp && resp.active) _active = resp.active;
            var pr = resp && resp.pushResult;
            var msg = '표출되었습니다.';
            if (pr && typeof pr.sent === 'number') {
                msg += pr.sent > 0 ? ' (관리자 기기 ' + pr.sent + '대에 푸시 발송)' : ' (등록된 관리자 기기 없음 — 화면 표출만)';
            }
            btnReload();
            // 표출한 기기 본인 화면에도 즉시 반영 (demo_alert.js 폴링을 기다리지 않고)
            if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
            console.log('[Demo] ' + msg);
        }).catch(function (e) { alert('표출 실패: ' + e.message); });
    };

    window.demoRetract = function (slotId) {
        fetch('/api/admin/demo/retract', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId: slotId })
        }).then(function (r) { return r.json(); }).then(function (resp) {
            if (resp && resp.active) _active = resp.active;
            var c = document.getElementById('unified-admin-body');
            if (c) _renderList(c);
            if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
        }).catch(function (e) { alert('내리기 실패: ' + e.message); });
    };

    window.demoClearAll = function () {
        if (!confirm('표출 중인 데모 특보를 모두 내릴까요?')) return;
        fetch('/api/admin/demo/clear', { method: 'POST' })
            .then(function (r) { return r.json(); }).then(function (resp) {
                _active = (resp && resp.active) || [];
                var c = document.getElementById('unified-admin-body');
                if (c) _renderList(c);
                if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
            });
    };
})();
