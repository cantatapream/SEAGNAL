/**
 * ============================================================================
 * 파일명: js/admin_narration.js
 * 역할: [임시 — 발표 나레이션] 통합관리자센터 > 시연 > "오디오" 하위탭
 * ============================================================================
 *
 * ※ 발표 시연용 임시 기능입니다. 발표 종료 후 이 파일과 아래 연계 지점을
 *   함께 제거하면 됩니다.
 *   - js/admin.js            : 시연 하위탭 btn('audio') + switchDemoSubTab 분기
 *   - js/demo_quick_trigger.js: [임시 — 발표 나레이션] 블록(_playNarration 등)
 *   - routes/admin.js        : /api/demo/narration, /api/admin/demo/narration/*
 *   - index2.html            : admin_narration.js <script> 태그
 *
 * [설명]
 * 5연타 트리거 발동 시 배경 재생할 나레이션 음성(mp3 등)을 슬롯별로
 * 업로드/교체/삭제/미리듣기 한다. 파일은 서버 data/uploads/narration/ 에
 * 저장(Fly 볼륨 → 재배포에도 유지)되어, 재배포 없이 발표 직전까지 교체 가능.
 *
 * [슬롯 ↔ 트리거 매핑] (js/demo_quick_trigger.js 의 _playNarration 호출 지점)
 *   alert1  — "해역별 특보현황" 5연타 1차 (특보 시연 활성화)
 *   alert2  — "해역별 특보현황" 5연타 2차 (태풍 발생/소멸 푸시)
 *   ocean   — 메인탭 "해양종합정보" 5연타 (나레이션만 재생, 5연타마다)
 *   mudflat — 해양종합정보 '물빠짐' 버튼 첫 클릭(무장 소진 시 1회)
 *   marine1 — "해역별 기상현황" 5연타 1차 (위치기반 시연)
 *   marine2 — "해역별 기상현황" 5연타 2차 (AI 시연 열기)
 *
 * [서버 연계]
 *   GET    /api/demo/narration                (공개 — 매핑 조회)
 *   POST   /api/admin/demo/narration/:slot    (업로드, multipart 'audio')
 *   DELETE /api/admin/demo/narration/:slot    (삭제)
 *   → admin.js 의 fetch 래퍼가 /api/admin/* 에 X-Admin-Token 자동 첨부.
 * ============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // 슬롯 정의 (표시 순서 = 발표 시나리오 순서)
    var SLOTS = [
        { id: 'alert1',  label: '특보현황 1차 (5연타)',  desc: '"해역별 특보현황" 첫 5연타 — 특보 시연 활성화와 동시에 재생' },
        { id: 'alert2',  label: '특보현황 2차 (5연타)',  desc: '"해역별 특보현황" 두 번째 5연타 — 태풍 발생/소멸 푸시와 동시에 재생' },
        { id: 'ocean',   label: '해양종합정보 탭 (5연타)', desc: '메인탭 "해양종합정보" 5연타 — 나레이션만 재생(다른 동작 없음, 5연타마다 재생 가능)' },
        { id: 'mudflat', label: '물빠짐 버튼 (첫 클릭)', desc: '태풍 시연 후 해양종합정보 \'물빠짐\' 첫 클릭에만 1회 재생' },
        { id: 'marine1', label: '기상현황 1차 (5연타)',  desc: '"해역별 기상현황" 첫 5연타 — 위치기반 시연 발송과 동시에 재생' },
        { id: 'marine2', label: '기상현황 2차 (5연타)',  desc: '"해역별 기상현황" 두 번째 5연타 — AI 시연 열기와 동시에 재생' }
    ];

    var _map = {};        // slot → { url, name, size, rate, updatedAt }
    var _durCache = {};   // url → 원본 길이(초) — <audio> metadata 로 1회 측정 후 캐시

    var RATE_MIN = 0.5, RATE_MAX = 2.0, RATE_STEP = 0.1;

    function _rateOf(slot) {
        var e = _map[slot];
        var r = e && Number(e.rate);
        return (isFinite(r) && r >= RATE_MIN && r <= RATE_MAX) ? r : 1;
    }

    function _fmtDur(sec) {
        if (!isFinite(sec) || sec < 0) return '-';
        var m = Math.floor(sec / 60), s = Math.round(sec % 60);
        if (s === 60) { m++; s = 0; }
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _fmtSize(bytes) {
        if (!bytes && bytes !== 0) return '';
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
        return (bytes / 1024 / 1024).toFixed(1) + 'MB';
    }
    function _fmtTime(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0')
                + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) { return ''; }
    }
    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _fetchMap() {
        return fetch('/api/demo/narration', { cache: 'no-cache' })
            .then(function (r) { return r.ok ? r.json() : { map: {} }; })
            .then(function (d) { _map = (d && d.map) || {}; })
            .catch(function () { _map = {}; });
    }

    // 진입점 — admin.js switchDemoSubTab('audio') 에서 호출
    window.renderNarrationAudioTab = function (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
        _fetchMap().then(function () { _render(container); });
    };

    function _render(container) {
        var html = ''
            + '<div class="admin-section-title"><i class="fa-solid fa-volume-high" style="color:#a855f7;"></i> 발표 나레이션 오디오 <span style="font-size:0.7rem;color:#f59e0b;font-weight:600;">[임시]</span></div>'
            + '<div style="margin-bottom:14px;color:#94a3b8;font-size:0.78rem;line-height:1.6;">'
            + '  <i class="fa-solid fa-circle-info"></i> 5연타 트리거가 발동될 때 아래 슬롯에 업로드된 음성이 배경으로 재생됩니다. '
            + '  파일은 서버에 저장되어 <b style="color:#c4b5fd;">재배포 없이 교체</b>할 수 있습니다. '
            + '  재생은 <b style="color:#c4b5fd;">관리자 등록 기기</b>에서만 동작하며 일반 사용자에게는 영향이 없습니다.'
            + '</div>'
            + '<div style="display:flex;flex-direction:column;gap:10px;">';

        SLOTS.forEach(function (s) {
            var e = _map[s.id];
            var has = !!(e && e.url);
            html += ''
                + '<div style="border:1px solid ' + (has ? 'rgba(168,85,247,0.45)' : 'rgba(255,255,255,0.1)') + ';border-radius:12px;padding:12px 14px;background:' + (has ? 'rgba(168,85,247,0.07)' : 'rgba(255,255,255,0.02)') + ';">'
                + '  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'
                + '    <div style="flex:1;min-width:200px;">'
                + '      <div style="color:#fff;font-weight:700;font-size:0.88rem;margin-bottom:2px;">'
                + '        <i class="fa-solid ' + (has ? 'fa-circle-check" style="color:#a855f7;' : 'fa-circle" style="color:#475569;font-size:0.5rem;vertical-align:middle;') + '"></i> '
                + _esc(s.label)
                + '      </div>'
                + '      <div style="color:#64748b;font-size:0.72rem;line-height:1.4;">' + _esc(s.desc) + '</div>'
                + (has
                    ? '  <div style="margin-top:6px;color:#94a3b8;font-size:0.72rem;">'
                      + '    <i class="fa-solid fa-file-audio" style="color:#c4b5fd;"></i> ' + _esc(e.name || e.filename || '')
                      + '    <span style="color:#64748b;"> · ' + _fmtSize(e.size) + ' · ' + _fmtTime(e.updatedAt) + '</span>'
                      + '  </div>'
                      + '  <audio controls preload="metadata" id="narration-preview-' + s.id + '" src="' + _esc(e.url) + '" style="margin-top:8px;width:100%;max-width:340px;height:32px;"></audio>'
                      // 재생 속도(0.1 단위 ±) + 배속 적용 시 총 길이 표시
                      + '  <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">'
                      + '    <span style="color:#94a3b8;font-size:0.72rem;">재생 속도</span>'
                      + '    <button onclick="narrationRateStep(\'' + s.id + '\',-1)" style="width:26px;height:26px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#d8b4fe;cursor:pointer;font-weight:700;font-size:0.9rem;line-height:1;">−</button>'
                      + '    <b id="narration-rate-' + s.id + '" style="color:#e2e8f0;font-size:0.8rem;min-width:52px;text-align:center;">' + _rateOf(s.id).toFixed(1) + '배속</b>'
                      + '    <button onclick="narrationRateStep(\'' + s.id + '\',1)" style="width:26px;height:26px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.4);border-radius:6px;color:#d8b4fe;cursor:pointer;font-weight:700;font-size:0.9rem;line-height:1;">+</button>'
                      + '    <span id="narration-len-' + s.id + '" style="color:#94a3b8;font-size:0.72rem;">길이 계산 중…</span>'
                      + '  </div>'
                    : '')
                + '    </div>'
                + '    <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">'
                + '      <button onclick="narrationPickFile(\'' + s.id + '\')" style="padding:7px 13px;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.78rem;">'
                + '        <i class="fa-solid fa-upload"></i> ' + (has ? '교체' : '업로드')
                + '      </button>'
                + (has
                    ? '  <button onclick="narrationDelete(\'' + s.id + '\')" style="padding:7px 11px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;color:#fca5a5;cursor:pointer;font-weight:600;font-size:0.78rem;"><i class="fa-solid fa-trash"></i></button>'
                    : '')
                + '    </div>'
                + '  </div>'
                + '  <div id="narration-status-' + s.id + '" style="display:none;margin-top:8px;font-size:0.75rem;color:#c4b5fd;"></div>'
                + '</div>';
        });

        html += '</div>'
            // 숨김 파일 입력 (슬롯 공용 — 선택 시점의 슬롯 id 를 dataset 에 보관)
            + '<input type="file" id="narration-file-input" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg" style="display:none;">';

        container.innerHTML = html;

        var input = document.getElementById('narration-file-input');
        if (input) {
            input.onchange = function () {
                var slot = input.dataset.slot;
                var file = input.files && input.files[0];
                input.value = '';   // 같은 파일 재선택 허용
                if (!slot || !file) return;
                _upload(slot, file, container);
            };
        }

        // 업로드된 슬롯: 원본 길이 측정(metadata) + 미리듣기 배속 적용 + 길이 라벨 갱신
        SLOTS.forEach(function (s) {
            var e = _map[s.id];
            if (!e || !e.url) return;
            var preview = document.getElementById('narration-preview-' + s.id);
            if (preview) {
                try { preview.playbackRate = _rateOf(s.id); } catch (err) { /* noop */ }
                preview.addEventListener('loadedmetadata', function () {
                    _durCache[e.url] = preview.duration;
                    _updateLenLabel(s.id);
                });
            }
            if (_durCache[e.url] != null) _updateLenLabel(s.id);
        });
    }

    /** 배속 적용 길이 라벨 갱신: "배속 적용 mm:ss (원본 mm:ss)" */
    function _updateLenLabel(slot) {
        var el = document.getElementById('narration-len-' + slot);
        var e = _map[slot];
        if (!el || !e || !e.url) return;
        var dur = _durCache[e.url];
        if (dur == null || !isFinite(dur)) { el.textContent = '길이 계산 중…'; return; }
        var rate = _rateOf(slot);
        el.innerHTML = '배속 적용 <b style="color:#c4b5fd;">' + _fmtDur(dur / rate) + '</b>'
            + ' <span style="color:#64748b;">(원본 ' + _fmtDur(dur) + ')</span>';
    }

    /** ± 버튼 — 0.1 단위 배속 변경 → 서버 저장 + 라벨/미리듣기 즉시 반영 */
    window.narrationRateStep = function (slot, dir) {
        var e = _map[slot];
        if (!e || !e.url) return;
        var next = Math.round((_rateOf(slot) + dir * RATE_STEP) * 10) / 10;
        if (next < RATE_MIN || next > RATE_MAX) return;   // 0.5~2.0 범위 제한
        e.rate = next;   // 낙관적 반영 (서버 실패 시 재조회로 원복)
        var rateEl = document.getElementById('narration-rate-' + slot);
        if (rateEl) rateEl.textContent = next.toFixed(1) + '배속';
        var preview = document.getElementById('narration-preview-' + slot);
        if (preview) { try { preview.playbackRate = next; } catch (err) { /* noop */ } }
        _updateLenLabel(slot);
        fetch('/api/admin/demo/narration/' + encodeURIComponent(slot) + '/rate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rate: next })
        }).then(function (r) {
            if (!r.ok) throw new Error();
        }).catch(function () {
            // 저장 실패 → 서버 상태로 원복
            _fetchMap().then(function () {
                var c = document.getElementById('demo-subtab-body');
                if (c) _render(c);
            });
        });
    };

    // 업로드 버튼 → 파일 선택 열기
    window.narrationPickFile = function (slot) {
        var input = document.getElementById('narration-file-input');
        if (!input) return;
        input.dataset.slot = slot;
        input.click();
    };

    function _setStatus(slot, msg, isError) {
        var el = document.getElementById('narration-status-' + slot);
        if (!el) return;
        el.style.display = msg ? 'block' : 'none';
        el.style.color = isError ? '#fca5a5' : '#c4b5fd';
        el.innerHTML = msg || '';
    }

    function _upload(slot, file, container) {
        _setStatus(slot, '<i class="fa-solid fa-circle-notch fa-spin"></i> 업로드 중... (' + _esc(file.name) + ')');
        var fd = new FormData();
        fd.append('audio', file);
        fetch('/api/admin/demo/narration/' + encodeURIComponent(slot), { method: 'POST', body: fd })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                if (!res.ok || !res.d || !res.d.success) {
                    throw new Error((res.d && res.d.error) || '업로드 실패');
                }
                // 성공 → 매핑 갱신 후 전체 다시 그림
                return _fetchMap().then(function () { _render(container); });
            })
            .catch(function (e) {
                _setStatus(slot, '<i class="fa-solid fa-triangle-exclamation"></i> 실패: ' + _esc(e && e.message), true);
            });
    }

    window.narrationDelete = function (slot) {
        if (!confirm('이 슬롯의 나레이션 음성을 삭제하시겠습니까?')) return;
        var container = document.getElementById('demo-subtab-body');
        fetch('/api/admin/demo/narration/' + encodeURIComponent(slot), { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function () { return _fetchMap(); })
            .then(function () { if (container) _render(container); })
            .catch(function (e) { alert('삭제 실패: ' + (e && e.message)); });
    };
})();
