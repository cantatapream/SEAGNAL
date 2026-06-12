'use strict';
/**
 * ============================================================================
 * advisory/displayControl.js — 특보 예측 "표출 제어" (관리자 운영)
 * ============================================================================
 *
 *  관리자 탭("특보 관리 → 특보 예측")에서 제어하는 운영 상태:
 *   - mode: 'off' | 'admin' | 'all'
 *       off   = 아무에게도 표출 안 함(+ 스케줄러 생성도 중단)
 *       admin = 통합관리자센터에 '등록된 관리자 기기'에만 표출(시범 운영)
 *       all   = 전체 사용자에게 표출
 *   - 구역별 오버라이드:
 *       hidden[zone]  = 영구 삭제(표출 목록에서 제외)
 *       stopped[zone] = 일시 표출중지(복귀 가능)
 *       edits[zone]   = { narrative?, gradeKey?('high'|'watch'), probPct? } 수정 덮어쓰기
 *
 *  상태파일: data/advisory_display.json (런타임, Fly 볼륨). gitignore.
 *  기기식별: admin_devices.json(토큰/endpoint) 대조 — routes/admin.js 와 동일 규약.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

let DATA_DIR;
try { ({ DATA_DIR } = require('../config/server_config')); } catch (_) { DATA_DIR = null; }
if (!DATA_DIR) DATA_DIR = path.resolve(__dirname, '..', 'data');

const DISPLAY_FILE = path.join(DATA_DIR, 'advisory_display.json');
const ADMIN_DEVICES_FILE = path.join(DATA_DIR, 'admin_devices.json');

const GRADE_META = { high: { key: 'high', label: '높음', emoji: '🔴' }, watch: { key: 'watch', label: '관심', emoji: '🟡' } };
const DEFAULT = { mode: 'off', hidden: {}, stopped: {}, edits: {}, updatedAt: null };

function readState() {
    try {
        const d = JSON.parse(fs.readFileSync(DISPLAY_FILE, 'utf8'));
        return {
            mode: (d && (d.mode === 'admin' || d.mode === 'all')) ? d.mode : 'off',
            hidden: (d && d.hidden && typeof d.hidden === 'object') ? d.hidden : {},
            stopped: (d && d.stopped && typeof d.stopped === 'object') ? d.stopped : {},
            edits: (d && d.edits && typeof d.edits === 'object') ? d.edits : {},
            updatedAt: (d && d.updatedAt) || null,
        };
    } catch (_) { return JSON.parse(JSON.stringify(DEFAULT)); }
}
function writeState(s) {
    try { fs.mkdirSync(path.dirname(DISPLAY_FILE), { recursive: true });
        fs.writeFileSync(DISPLAY_FILE, JSON.stringify(s, null, 2), 'utf8'); return true; }
    catch (_) { return false; }
}
function stamp(s) { s.updatedAt = new Date().toISOString(); return s; }

function getMode() { return readState().mode; }
function setMode(mode) {
    const s = readState();
    s.mode = (mode === 'admin' || mode === 'all') ? mode : 'off';
    writeState(stamp(s));
    return s.mode;
}

// ── 구역별 관리 ─────────────────────────────────────────────────────────────
function hideZone(zone, permanent) {
    if (!zone) return false; const s = readState();
    if (permanent) s.hidden[zone] = true; else s.stopped[zone] = true;
    return writeState(stamp(s));
}
function restoreZone(zone) {
    if (!zone) return false; const s = readState();
    delete s.hidden[zone]; delete s.stopped[zone];
    return writeState(stamp(s));
}
function editZone(zone, patch) {
    if (!zone || !patch || typeof patch !== 'object') return false;
    const s = readState();
    const cur = s.edits[zone] || {};
    const next = Object.assign({}, cur);
    if (typeof patch.narrative === 'string') next.narrative = patch.narrative;
    if (patch.gradeKey === 'high' || patch.gradeKey === 'watch') next.gradeKey = patch.gradeKey;
    if (patch.probPct != null && isFinite(Number(patch.probPct))) next.probPct = Math.max(0, Math.min(100, Math.round(Number(patch.probPct))));
    s.edits[zone] = next;
    return writeState(stamp(s));
}
function clearEdit(zone) { if (!zone) return false; const s = readState(); delete s.edits[zone]; return writeState(stamp(s)); }

// ── 기기식별 (admin_devices.json 대조) ──────────────────────────────────────
function isAdminDevice(deviceId) {
    if (!deviceId) return false;
    try {
        const devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        return Array.isArray(devices) && devices.some((d) =>
            d && (d.type === 'fcm' ? d.token === deviceId : (d.subscription && d.subscription.endpoint === deviceId)));
    } catch (_) { return false; }
}

/**
 * payload(active/resolved/counts) 에 오버라이드 적용한 새 객체 반환.
 *   - hidden+stopped 구역 제거, edits 구역 덮어쓰기(narrative/grade/probPct), counts 재계산.
 */
function applyOverrides(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const s = readState();
    const dropped = (z) => s.hidden[z] || s.stopped[z];
    const src = Array.isArray(payload.active) ? payload.active : [];
    const active = [];
    for (const p of src) {
        if (!p || dropped(p.zone)) continue;
        const e = s.edits[p.zone];
        if (!e) { active.push(p); continue; }
        const np = Object.assign({}, p);
        if (typeof e.narrative === 'string') np.narrative = e.narrative;
        if (e.gradeKey && GRADE_META[e.gradeKey]) np.grade = Object.assign({}, GRADE_META[e.gradeKey]);
        if (e.probPct != null) np.probPct = Number(e.probPct);
        np._edited = true;
        active.push(np);
    }
    let high = 0, watch = 0;
    for (const a of active) { const k = a.grade && a.grade.key; if (k === 'high') high++; else if (k === 'watch') watch++; }
    const counts = Object.assign({}, payload.counts, { high, watch });
    return Object.assign({}, payload, { active, counts });
}

module.exports = {
    DISPLAY_FILE, readState, getMode, setMode,
    hideZone, restoreZone, editZone, clearEdit,
    isAdminDevice, applyOverrides, GRADE_META,
};
