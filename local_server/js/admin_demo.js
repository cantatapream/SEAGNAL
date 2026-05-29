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
 * [연계]
 * - 서버: /api/admin/demo/slots (GET/POST), /demo/emit, /demo/retract, /demo/clear
 * - 화면 표출은 js/demo_alert.js 가 관리자 기기에서 폴링·머지로 담당
 * - admin.js 의 특보 알림 상위탭에서 renderDemoAlertTab(container) 로 진입
 * ============================================================================
 */
(function () {
    'use strict';

    var WARN_TYPES = ['풍랑', '태풍', '강풍', '호우', '대설', '해일'];
    var LEVELS = ['주의보', '경보'];

    var _slots = [];     // 저장된 데모 슬롯
    var _active = [];    // 현재 표출 중인 슬롯 (id 목록 비교용)

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
            .then(function (r) { return r.ok ? r.json() : { slots: [], active: [] }; })
            .then(function (data) {
                _slots = data.slots || [];
                _active = data.active || [];
                return data;
            });
    }

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
        var html = ''
            + '<div class="admin-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">'
            + '  <div><i class="fa-solid fa-flask" style="color:#a855f7;"></i> 데모 특보 (시연용)</div>'
            + '  <div style="display:flex;gap:8px;">'
            + '    <button onclick="openDemoAddModal()" style="padding:7px 14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.82rem;"><i class="fa-solid fa-plus"></i> 데모 특보 추가</button>'
            + (activeCount > 0 ? '    <button onclick="demoClearAll()" style="padding:7px 14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;color:#fca5a5;cursor:pointer;font-weight:600;font-size:0.82rem;"><i class="fa-solid fa-eraser"></i> 전체 내리기 (' + activeCount + ')</button>' : '')
            + '  </div>'
            + '</div>'
            + '<div style="margin-bottom:10px;color:#94a3b8;font-size:0.78rem;line-height:1.5;">'
            + '  <i class="fa-solid fa-circle-info"></i> 미리 저장해 두고, 시연 때 원하는 특보의 <b style="color:#c4b5fd;">표출</b> 버튼을 누르면 '
            + '  <b>이 관리자 기기에만</b> 푸시 알림이 오고, 인덱스/지도/안내문구에 표출됩니다. (실 특보 장부·일반 사용자에는 영향 없음)'
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

        container.innerHTML = html;
    }

    function _slotRowHtml(slot, idx) {
        var active = _isActive(slot.id);
        var typeColor = slot.warnType === '태풍' ? '#dc2626' : (slot.level === '경보' ? '#ef4444' : '#22c55e');
        var pre = slot.upcoming && slot.upcoming.enabled;
        var num = idx + 1;

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

        var modal = document.createElement('div');
        modal.id = 'demo-add-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);';
        modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

        modal.innerHTML = ''
            + '<div style="background:#1e293b;border-radius:14px;width:92%;max-width:440px;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,0.1);">'
            + '  <div style="padding:16px;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:1;">'
            + '    <h4 style="margin:0;color:#fff;font-size:0.95rem;"><i class="fa-solid fa-flask"></i> ' + (editing ? '데모 특보 수정' : '데모 특보 추가') + '</h4>'
            + '    <button onclick="document.getElementById(\'demo-add-modal\').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;">&times;</button>'
            + '  </div>'
            + '  <div style="padding:18px;">'
            + '    <div style="margin-bottom:12px;"><label style="' + lblS + '">구역</label><select id="dm-zone" style="' + inS + '">' + zoneOpts + '</select></div>'
            + '    <div style="display:flex;gap:8px;margin-bottom:12px;">'
            + '      <div style="flex:1;"><label style="' + lblS + '">종류</label><select id="dm-type" style="' + inS + '">' + typeOpts(editing ? editing.warnType : '풍랑') + '</select></div>'
            + '      <div style="flex:1;"><label style="' + lblS + '">등급</label><select id="dm-level" style="' + inS + '">' + levelOpts(editing ? editing.level : '주의보') + '</select></div>'
            + '    </div>'
            + '    <div style="margin-bottom:12px;"><label style="' + lblS + '">발표 시각</label><input type="datetime-local" id="dm-tmFc" style="' + inS + '" value="' + (editing ? _toLocal(editing.tmFc) : '') + '"></div>'
            + '    <div style="margin-bottom:12px;"><label style="' + lblS + '">발효 시각</label><input type="datetime-local" id="dm-tmEf" style="' + inS + '" value="' + (editing ? _toLocal(editing.tmEf) : '') + '"></div>'
            + '    <div style="margin-bottom:14px;"><label style="' + lblS + '">해제 예정 시각</label><input type="datetime-local" id="dm-tmEd" style="' + inS + '" value="' + (editing ? _toLocal(editing.tmEd) : '') + '"></div>'
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
            + '      <div style="margin-bottom:6px;"><label style="' + lblS + '">발효 예정 시각</label><input type="datetime-local" id="dm-up-tmEf" style="' + inS + '" value="' + (up ? _toLocal(up.tmEf) : '') + '"></div>'
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

        var slot = {
            id: editId || undefined,
            zoneName: zone,
            warnType: document.getElementById('dm-type').value,
            level: document.getElementById('dm-level').value,
            command: '발효',
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
            var c = document.getElementById('alert-top-content');
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
            var c = document.getElementById('alert-top-content');
            if (c) _renderList(c);
        });
    };

    // ── 표출 / 내리기 ──────────────────────────────────────────
    window.demoEmit = function (slotId) {
        var btnReload = function () {
            var c = document.getElementById('alert-top-content');
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
            var c = document.getElementById('alert-top-content');
            if (c) _renderList(c);
            if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
        }).catch(function (e) { alert('내리기 실패: ' + e.message); });
    };

    window.demoClearAll = function () {
        if (!confirm('표출 중인 데모 특보를 모두 내릴까요?')) return;
        fetch('/api/admin/demo/clear', { method: 'POST' })
            .then(function (r) { return r.json(); }).then(function (resp) {
                _active = (resp && resp.active) || [];
                var c = document.getElementById('alert-top-content');
                if (c) _renderList(c);
                if (typeof reapplyDemoAlerts === 'function') setTimeout(reapplyDemoAlerts, 200);
            });
    };
})();
