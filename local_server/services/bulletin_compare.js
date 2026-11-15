'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_compare.js
 * 역할  : MMIS 기준 특보현황(실제 앱)과 통보문 기준 특보현황(bulletin_status)을 매분 맞대어 기록하고,
 *         「통보문 기준이었다면 나갔을 푸시」(가상 — 보내지 않음)를 계산해 실제 MMIS 푸시와 나란히 남긴다.
 * 사용자 확정 2026-11-15:
 *   「두 개를 비교해서 … 보고서가 만들어지도록 … MMIS는 어떻게 MMIS 신호가 들어온 뒤 얼마 후에 어떠한 그 푸시 알림이 몇 분 몇 초에 나갔는데,
 *    통보문을 했을 때는 몇 분 몇 초에 어떠한 내용의 푸시 알림이 나갔을 거다라는 것을 비교하는 문서」
 *   「MMIS에서의 문제점들이 … 통보문으로 했을 때는 그런 문제점이 발생하지 않는지」
 *   가상 푸시에는 MMIS 의 3분 디바운스·의심 가드·취소 문구 대기를 넣지 않는다(「통보문만 정확하게 나왔다면 디바운스 같은 기능이 필요가 없는것」).
 *   예비 시간창 끝 뒤 10분 대기는 bulletin_status 가 이미 한다.
 * 가상 푸시 문구는 실제 푸시와 같은 함수(push_helpers.generateMessage)로 만든다 — 같은 종류면 같은 꼴.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_status(통보문 기준) · data/weather_alerts.json(MMIS 기준 — marine_warning_crawler 가 씀) ·
 *                   data/custom_push_history.json(실제 보낸 푸시 — routes/push.js 가 씀) · services/push_helpers.generateMessage(문구)
 *  - 저장          : data/bulletin_compare/<KST 날짜>.jsonl(기록, 60일) · data/bulletin_compare/state.json(앞 상태)
 *  - 나를 쓰는 곳  : scheduler.js(통보문 기준 계산 다음 매분) · routes/bulletin_watch.js(GET /api/admin/bulletin-compare/report.md) · 검사 test_bulletin_compare
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'bulletin_compare');
const ALERTS_FILE = path.join(__dirname, '..', 'data', 'weather_alerts.json');
const PUSH_FILE = path.join(__dirname, '..', 'data', 'custom_push_history.json');
const KEEP_DAYS = 60;
const KST = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const dayOf = (ms) => KST(ms).slice(0, 10);

/**
 * MMIS 나무(/api/weather-alerts current) → 단위(부모·자식)별 상태. bulletin_status.zones 와 같은 꼴.
 * 예: {동해:{…:{울산앞바다:{current:null, upcoming:{wrnTpNm:'풍랑', wrnLvlNm:'예비', tmEf:'…'}, children:{}}}}} → { 울산앞바다: {kind:'yebi', type:'풍랑', level:'예비', …} }
 * [연계] ← run(이 파일)
 */
function flattenTree(tree) {
    const out = {};
    const blk = (b, parent) => {
        if (!b || typeof b !== 'object') return null;
        const level = b.wrnLvlNm || b.wrnLvl || '';
        if (!level || level === '해제') return null;
        return { parent, kind: level === '예비' ? 'yebi' : 'formal', type: b.wrnTpNm || b.wrnTp || '', level, tmFc: b.tmFc || '', tmEf: b.tmEf || '', clr: b.clrNtcTm || b.tmCc || '' };
    };
    (function walk(o) {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object' && 'current' in v && 'children' in v) {
                const s = blk(v.current, k) || blk(v.upcoming, k); if (s) out[k] = s;
                for (const [c, cv] of Object.entries(v.children || {})) { const cs = blk(cv, k); if (cs) out[c] = cs; }
            } else walk(v);
        }
    })(tree);
    return out;
}

/** 상태 비교용 서명 — 종류·등급(예비는 시간창, 정식은 해제 예고까지). */
const sig = (z) => (z ? `${z.kind}|${z.type}|${z.level}|${z.kind === 'yebi' ? z.tmEf : z.clr}` : '');
const word = (z) => (z ? (z.kind === 'yebi' ? `${z.type} 예비(${z.tmEf})` : `${z.type}${z.level}${z.clr ? `(해제 예고 ${z.clr})` : ''}`) : '없음');

/**
 * 통보문 쪽 상태 바뀜 하나 → 가상 푸시 종류(실제 push_sender 와 같은 templateId).
 * 예: 없음 → 예비 = publish · 예비/없음 → 정식 = active · 정식 → 없음 = release · 예비 → 없음 = prelim_cancel ·
 *     등급 오름 = level_upgrade_active · 해제 예고만 바뀜 = time_yn_change · 예비 시간창만 바뀜 = time_ef_change ·
 *     자식(연안바다·평수구역)은 부모가 정식 중이면 additional_active / partial_release, 예비 추가는 child_prelim.
 * @returns {{templateId, typeName, level, prevLevel?, prevTypeName?}|null}
 * [연계] ← run(이 파일)
 */
function templateOf(unit, before, after, parentNow) {
    const isChild = !!(after || before) && (after || before).parent !== unit;
    const LV = { 주의보: 1, 경보: 2 };
    if (!before && after) {
        if (after.kind === 'yebi') return { templateId: isChild && parentNow ? 'child_prelim' : 'publish', typeName: after.type, level: '주의보' };
        return { templateId: isChild && parentNow && parentNow.kind === 'formal' ? 'additional_active' : 'active', typeName: after.type, level: after.level };
    }
    if (before && !after) {
        if (before.kind === 'yebi') return { templateId: 'prelim_cancel', typeName: before.type, level: '주의보' };
        return { templateId: isChild && parentNow && parentNow.kind === 'formal' ? 'partial_release' : 'release', typeName: before.type, level: before.level };
    }
    if (before.kind === 'yebi' && after.kind === 'formal') return { templateId: 'active', typeName: after.type, level: after.level };
    if (before.kind === 'formal' && after.kind === 'yebi') return { templateId: 'release', typeName: before.type, level: before.level };
    if (before.kind === 'yebi') return before.tmEf !== after.tmEf ? { templateId: 'time_ef_change', typeName: after.type, level: '주의보' } : null;
    if (before.type !== after.type) return { templateId: after.type === '태풍' ? 'type_upgrade_active' : 'type_downgrade_active', typeName: after.type, level: after.level, prevTypeName: before.type, prevLevel: before.level };
    if (before.level !== after.level) return { templateId: (LV[after.level] || 0) > (LV[before.level] || 0) ? 'level_upgrade_active' : 'level_downgrade_active', typeName: after.type, level: after.level, prevLevel: before.level };
    if (before.clr !== after.clr) return { templateId: 'time_yn_change', typeName: after.type, level: after.level };
    return null;
}

/**
 * 비교 기록기를 만든다. 검사에서는 읽는 곳(통보문 기준·MMIS·푸시 기록)·시계·저장 위치를 바꿔 끼운다.
 * @param {{getBulletin?: function(): object|null, getMmis?: function(): object|null, getPushes?: function(): Array, now?: function(): number, dir?: string}} o
 * @returns {{run: function(): object, readDay: function(string): Array, days: function(): string[]}}
 * [연계] ← module.exports · test_bulletin_compare
 */
function createCompare({
    getBulletin = () => require('./bulletin_status').read(),
    getMmis = () => { try { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')).current; } catch (_) { return null; } },
    getPushes = () => { try { const h = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); return Array.isArray(h) ? h : (h.history || []); } catch (_) { return []; } },
    now = () => Date.now(), dir = DIR,
} = {}) {
    const stateFile = path.join(dir, 'state.json');
    let st = null;
    const load = () => { if (st) return; try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { st = null; } };
    const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st)); fs.renameSync(stateFile + '.tmp', stateFile); };
    const log = (ev) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, dayOf(ev.atMs) + '.jsonl'), JSON.stringify(Object.assign({ at: KST(ev.atMs) }, ev)) + '\n'); };

    function run() {
        load();
        const t = now();
        const b = getBulletin(), mTree = getMmis();
        if (!b || !b.zones || !mTree) return { skipped: true, why: !b ? '통보문 기준 없음' : 'MMIS 없음' };
        const B = b.zones, M = flattenTree(mTree);
        const pushes = getPushes().filter((p) => p && p.type === 'auto');
        const stat = { events: 0 };
        const emit = (ev) => { log(Object.assign({ atMs: t }, ev)); stat.events++; };
        if (!st) {   // 처음: 지금 상태를 기준으로만 남기고 바뀜·푸시는 세지 않는다
            st = { mmis: M, bulletin: B, lastPushId: Math.max(0, ...pushes.map((p) => +p.id || 0)), mismatch: {} };
            emit({ kind: 'baseline', mmis: Object.keys(M).length, bulletin: Object.keys(B).length, 설명: `비교 시작 — MMIS ${Object.keys(M).length}곳 · 통보문 ${Object.keys(B).length}곳에 특보·예비` });
            save(); return stat;
        }
        // ① 양쪽 상태 바뀜
        const units = new Set([...Object.keys(st.mmis), ...Object.keys(M), ...Object.keys(st.bulletin), ...Object.keys(B)]);
        const virtual = {};
        for (const u of units) {
            for (const [side, prev, cur] of [['mmis', st.mmis[u], M[u]], ['bulletin', st.bulletin[u], B[u]]]) {
                if (sig(prev) === sig(cur)) continue;
                emit({ kind: 'change', side, unit: u, before: prev || null, after: cur || null, 설명: `${side === 'mmis' ? 'MMIS' : '통보문'} ${u}: ${word(prev)} → ${word(cur)}` });
                if (side === 'bulletin') {
                    const tp = templateOf(u, prev, cur, B[(cur || prev).parent]);
                    if (tp) { const k = [tp.templateId, tp.typeName, tp.level, tp.prevLevel || ''].join('|'); (virtual[k] = virtual[k] || Object.assign({ items: [] }, tp)).items.push({ zones: [u], tmFc: (cur || prev).tmFc, tmEf: (cur || prev).tmEf, tmYn: (cur || prev).clr }); }
                }
            }
            // 두 쪽이 다른 동안(시작·끝)
            const diff = sig(M[u]) !== sig(B[u]);
            if (diff && !st.mismatch[u]) { st.mismatch[u] = t; emit({ kind: 'mismatch_start', unit: u, mmis: M[u] || null, bulletin: B[u] || null, 설명: `${u} 두 쪽이 달라짐 — MMIS ${word(M[u])} / 통보문 ${word(B[u])}` }); }
            else if (!diff && st.mismatch[u]) { const m = Math.round((t - st.mismatch[u]) / 60e3); delete st.mismatch[u]; emit({ kind: 'mismatch_end', unit: u, minutes: m, 설명: `${u} 두 쪽이 다시 같아짐(${m}분 동안 달랐음)` }); }
        }
        // ② 통보문 기준 가상 푸시(보내지 않음 — 같은 분·같은 종류는 한 묶음, 실제와 같은 문구 함수)
        const { generateMessage } = require('./push_helpers');
        for (const v of Object.values(virtual)) {
            const msg = generateMessage(v);
            emit({ kind: 'virtual_push', templateId: v.templateId, title: msg.title, content: msg.body, target: v.items.flatMap((i) => i.zones).join(', '), 설명: `통보문 기준이었다면 이 때 푸시: ${msg.title}` });
        }
        // ③ 실제 MMIS 푸시(보낸 기록 — id 가 보낸 시각 ms)
        for (const p of pushes.filter((p) => (+p.id || 0) > st.lastPushId).sort((a, b) => a.id - b.id)) {
            log({ atMs: Math.floor(+p.id), kind: 'mmis_push', title: p.title, content: p.content, target: p.target, count: p.count, 설명: `MMIS 기준 실제 푸시: ${p.title} (${p.target})` });
            stat.events++;
            st.lastPushId = Math.max(st.lastPushId, +p.id);
        }
        st.mmis = M; st.bulletin = B;
        save(); prune();
        return stat;
    }
    function prune() {
        const cut = dayOf(now() - KEEP_DAYS * 86400e3);
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) fs.unlinkSync(path.join(dir, f));
    }
    const days = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort();
    const readDay = (d) => { try { return fs.readFileSync(path.join(dir, d + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
    return { run, readDay, days };
}

/**
 * 비교 보고서(마크다운): 요약 → 푸시 짝 맞추기(MMIS 실제 ↔ 통보문 가상, 같은 해역·6시간 안) → 두 쪽이 달랐던 동안 → 시간순 기록 → 부록(원본).
 * @param {Array<object>} events  @param {string} day
 * @returns {string}
 * [연계] ← routes/bulletin_watch GET /api/admin/bulletin-compare/report.md
 */
function reportMarkdown(events, day) {
    const hm = (s) => String(s).slice(5, 16).replace('T', ' ');
    const real = events.filter((e) => e.kind === 'mmis_push'), virt = events.filter((e) => e.kind === 'virtual_push');
    const zonesOf = (e) => String(e.target || '').split(/,\s*/).filter(Boolean);
    const used = new Set(), pairs = [];
    for (const r of real) {
        const rz = zonesOf(r), rt = Date.parse(r.at);
        let best = null;
        virt.forEach((v, i) => { if (used.has(i)) return; const dt = Date.parse(v.at) - rt; if (Math.abs(dt) > 6 * 3600e3) return; if (!zonesOf(v).some((z) => rz.includes(z))) return; if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { i, v, dt }; });
        if (best) used.add(best.i);
        pairs.push({ r, v: best && best.v, dt: best && best.dt });
    }
    const lone = virt.filter((_, i) => !used.has(i));
    const ms = (dt) => { const s = Math.round(Math.abs(dt) / 1000); return `${dt < 0 ? '통보문이 ' : 'MMIS가 '}${Math.floor(s / 60)}분 ${s % 60}초 빠름`; };
    const mis = events.filter((e) => e.kind === 'mismatch_end');
    const open = {}; for (const e of events) { if (e.kind === 'mismatch_start') open[e.unit] = e; if (e.kind === 'mismatch_end') delete open[e.unit]; }
    const out = [
        `# MMIS ↔ 통보문 특보 비교 (${day === 'all' ? '전체' : day})`, '',
        'MMIS 기준(실제 앱)과 방재기상플랫폼 통보문 기준(관찰·계산만)의 해역별 특보 상태와 푸시를 매분 맞대어 남긴 기록입니다. 시각은 KST.',
        '통보문 쪽 푸시는 **보내지 않은 가상 푸시**이며, 실제 푸시와 같은 문구 함수로 만들었습니다. MMIS 의 3분 디바운스 등은 넣지 않았고, 예비 시간창 끝 뒤 10분만 기다립니다.', '',
        '## 요약', '',
        `- 상태 바뀜: MMIS ${events.filter((e) => e.kind === 'change' && e.side === 'mmis').length}번 · 통보문 ${events.filter((e) => e.kind === 'change' && e.side === 'bulletin').length}번`,
        `- 푸시: MMIS 실제 ${real.length}건 · 통보문 가상 ${virt.length}건 · 짝이 맞은 것 ${pairs.filter((p) => p.v).length}건 · MMIS 만 ${pairs.filter((p) => !p.v).length}건 · 통보문만 ${lone.length}건`,
        `- 두 쪽 상태가 달랐다가 같아진 일: ${mis.length}번${mis.length ? ` (길이 중앙 ${mis.map((e) => e.minutes).sort((a, b) => a - b)[Math.floor(mis.length / 2)]}분)` : ''} · 지금도 다른 해역: ${Object.keys(open).length}곳`, '',
        '## 푸시 짝 맞추기 (같은 해역 · 6시간 안 가장 가까운 것)', '',
        '| MMIS 실제 | 통보문 가상 | 시간 차이 |', '|---|---|---|',
        ...pairs.map((p) => `| ${hm(p.r.at)} ${p.r.title} — ${p.r.target} | ${p.v ? `${hm(p.v.at)} ${p.v.title} — ${p.v.target}` : '(없음)'} | ${p.v ? ms(p.dt) : '—'} |`),
        ...lone.map((v) => `| (없음) | ${hm(v.at)} ${v.title} — ${v.target} | — |`), '',
        '## 두 쪽이 달랐던 동안', '',
        ...mis.map((e) => `- ${hm(e.at)}까지 ${e.unit}: ${e.minutes}분`),
        ...Object.values(open).map((e) => `- ${hm(e.at)}부터 지금까지 ${e.unit}: MMIS ${word(e.mmis)} / 통보문 ${word(e.bulletin)}`), '',
        '## 시간순 기록 (쉬운 설명)', '',
        ...events.map((e) => `- ${hm(e.at)} ${e.설명 || e.kind}${e.kind === 'mmis_push' || e.kind === 'virtual_push' ? `\n  > ${String(e.content || '').replace(/\n/g, ' / ')}` : ''}`), '',
        '## 부록: 원본 기록(한 줄 = 한 사건, JSON)', '', '```jsonl', ...events.map((e) => JSON.stringify(e)), '```', '',
    ];
    return out.join('\n');
}

let real = null;
const getReal = () => (real = real || createCompare());
module.exports = { run: () => getReal().run(), days: () => getReal().days(), readDay: (d) => getReal().readDay(d), createCompare, flattenTree, templateOf, reportMarkdown, sig };
