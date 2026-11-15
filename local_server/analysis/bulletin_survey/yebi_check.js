'use strict';
/**
 * yebi_check.js — (시험판) 예비특보 통보문만으로 해역별 풍랑·태풍 예비특보 상태를 따라가고,
 *   같은 관서 특보 통보문의 「예비특보 현황(t7)」 칸과 맞는지 검산한다(분석용, 2026-11-13).
 * 확인한 구조(2026-11-13, raw 2025-01~2026-11):
 *   - 예비특보 통보문 본문(t4)은 「바뀐 것」이 아니라 「지금 살아 있는 예비특보 전체 목록」이다
 *     (예: 제주 2026 3-5호가 3-4호 내용을 다시 적고 새 줄을 더함). 「o 없음」이면 전부 취소.
 *   - 줄 모양은 「o MM월 DD일 시간대(HH시~HH시) : 해역목록」 하나뿐(시간대 이름은 새벽·오전·오후·밤·아침·늦은 오후·저녁·낮).
 *   - 2025-12 부터 특보 목록에 「풍랑예비특보 해제」(t2 = 해당 구역, t3 = 해제 시각) 통보문이 따로 나온다(17건).
 * 모형: 시각 T 의 예비특보 = T 이전 마지막 예비특보 통보문의 목록 중 끝나지 않은 줄
 *        − 그 뒤 나온 「풍랑예비특보 해제」 통보문의 구역.
 * 실행: node yebi_check.js 2025-01 … [--show=20]
 * [연계] ← 사람이 실행 / → raw/<달>/*.json · lifecycle_check.js(해역 해석 함수)
 */
const fs = require('fs'), path = require('path');
const { lines, splitTop, expand } = require('./lifecycle_check');
const args = process.argv.slice(2);
const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
const SHOW = +((args.find((a) => a.startsWith('--show=')) || '--show=20').split('=')[1]);
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const fmt = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');

/**
 * 예비특보 목록 글(t4 또는 t7) → [{unit, start, end}] (풍랑·태풍만).
 * 예: '(1) 풍랑 예비특보 | o 03월 12일 밤(18시~24시) : 제주도남쪽바깥먼바다' → 03-12 18:00 ~ 03-13 00:00
 * @param {string} text  @param {string} tmFc 통보문 발표시각(연도를 정하는 데 쓴다)  @param {Array} unknown
 */
function parseYebi(text, tmFc, unknown) {
    const out = []; let kind = null;
    const y0 = +String(tmFc).slice(0, 4), m0 = +String(tmFc).slice(5, 7);
    for (const l of lines(text)) {
        const h = l.match(/^\(\d+\)\s*(\S+)\s*예비특보/);
        if (h) { kind = h[1]; continue; }
        const m = l.match(/^[oOㅇ]\s*(\d+)월\s*(\d+)일\s*[^(]*\((\d+)시~(\d+)시\)\s*:\s*(.+)$/);
        if (!m || !(kind === '풍랑' || kind === '태풍')) continue;
        const mo = +m[1], dd = +m[2], a = +m[3], b = +m[4];
        const yr = mo < m0 - 6 ? y0 + 1 : (mo > m0 + 6 ? y0 - 1 : y0);   // 12월 통보문의 1월 줄
        const day = Date.UTC(yr, mo - 1, dd) - 9 * 3600e3;
        const start = day + a * 3600e3, end = day + (b <= a ? b + 24 : b) * 3600e3;
        for (const tok of splitTop(m[5])) { const u = expand(tok, unknown); if (u) for (const x of u) out.push({ unit: x, start, end, kind }); }
    }
    return out;
}
const keyOf = (e) => `${e.unit}|${fmt(e.start)}~${fmt(e.end).slice(6)}`;

/** 같은 호는 마지막 판만(호 번호는 해마다 다시 시작 — 연도를 붙인다). */
function lastVersions(list) {
    const last = new Map();
    for (const r of list) { const k = String(r.tmFc).slice(0, 4) + ' ' + r.t1Title; if (!last.has(k) || last.get(k).tmIn < r.tmIn) last.set(k, r); }
    return [...last.values()];
}

const unknown = [], examples = [];
const byOffice = {};
for (const ym of months) for (const f of fs.readdirSync(path.join(__dirname, 'raw', ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', ym, f), 'utf8'));
    const o = byOffice[d.officeName] = byOffice[d.officeName] || { yebi: [], wrn: [] };
    for (const it of Object.values(d.items)) if (it.result) (it.rpt === '7' ? o.yebi : o.wrn).push(it.result);
}
const tot = { checked: 0, exact: 0, missOnly: 0, extraOnly: 0, both: 0 };
const offices = {};
const why = { extraFormal: 0, extraOther: 0, missing: 0 };
for (const [office, { yebi, wrn }] of Object.entries(byOffice)) {
    // 사건 목록: 예비 통보문(목록 통째 교체) · 예비 해제 통보문(구역 빼기) · 특보 통보문(t7 검산, t2 발표 구역 기록)
    const ev = [
        ...lastVersions(yebi).map((r) => ({ t: KST(r.tmIn), type: 'yebi', r })),
        ...lastVersions(wrn).map((r) => ({ t: KST(r.tmIn), type: 'wrn', r })),
    ].sort((a, b) => a.t - b.t || (a.type === 'yebi' ? -1 : 1));   // 같은 시각이면 예비 통보문을 먼저
    let snap = null; const o = offices[office] = { checked: 0, exact: 0 };
    for (const e of ev) {
        const r = e.r;
        if (e.type === 'yebi') { snap = parseYebi(r.t4, r.tmFc, unknown); continue; }
        if (/예비특보\s*해제/.test(r.t1 || '') && snap) {
            // 「풍랑예비특보 해제」: t2 첫 묶음(번호 없는 줄 또는 (1))이 해제 구역
            const first = String(r.t2 || '').split(/\|\s*\(\d+\)|<br\s*\/?>\s*\(\d+\)/i)[0].replace(/^\(\d+\)[^:]*:\s*/, '');
            const gone = new Set(); for (const tok of splitTop(first.replace(/\s+/g, ''))) { const u = expand(tok, unknown); if (u) for (const x of u) gone.add(x); }
            snap = snap.filter((x) => !gone.has(x.unit));
        }
        if (!snap) continue;                         // 첫 예비 통보문 전에는 검산하지 않는다
        const now = e.t;
        const model = new Map(snap.filter((x) => x.end > now).map((x) => [keyOf(x), x]));
        const truth = new Map(parseYebi(r.t7, r.tmFc, unknown).map((x) => [keyOf(x), x]));
        const miss = [...truth.keys()].filter((k) => !model.has(k));
        const extra = [...model.keys()].filter((k) => !truth.has(k));
        tot.checked++; o.checked++;
        if (!miss.length && !extra.length) { tot.exact++; o.exact++; continue; }
        // 우리에겐 있는데 t7 엔 없는 줄: 이 특보 통보문(또는 이전)에 그 구역이 정식 특보로 넘어갔나?
        const formal = new Set(); for (const l of lines(r.t6)) { const m = l.replace(/^[oOㅇ*]\s*/, '').match(/^(풍랑|태풍)(주의보|경보)\s*:\s*(.+)$/); if (m) for (const tok of splitTop(m[3])) { const u = expand(tok, unknown); if (u) for (const x of u) formal.add(x); } }
        const ex2 = extra.filter((k) => !formal.has(k.split('|')[0]));
        why.extraFormal += extra.length - ex2.length; why.extraOther += ex2.length; why.missing += miss.length;
        if (!miss.length && !ex2.length) { tot.extraOnly++; continue; }   // 정식 특보로 넘어가 t7 에서 빠진 것뿐
        tot.both++;
        if (examples.length < SHOW) examples.push(`${office} ${r.t1Title} ${String(r.tmIn).slice(0, 16)} 「${r.t1}」 — ${[...miss.map((k) => 't7에만 ' + k), ...ex2.map((k) => '우리만 ' + k)].slice(0, 5).join(', ')}`);
        snap = [...truth.values()];                 // 어긋나면 t7 로 다시 맞추고 계속
    }
}
console.log(`특보 통보문 t7 검산 ${tot.checked}건 · 완전히 같음 ${tot.exact}건 · 정식 특보로 넘어간 구역만 t7 에서 빠짐 ${tot.extraOnly}건 · 설명 안 되는 어긋남 ${tot.both}건`);
console.log(`  (줄 단위: 정식 특보로 넘어가 빠짐 ${why.extraFormal} · 우리만 있음 ${why.extraOther} · t7 에만 있음 ${why.missing})`);
for (const [k, v] of Object.entries(offices)) console.log(`  ${k}: 같음 ${v.exact}/${v.checked}`);
console.log('\n설명 안 되는 어긋남 예:'); for (const e of examples) console.log('  ' + e);
const uc = {}; for (const u of unknown) uc[u] = (uc[u] || 0) + 1;
console.log('\n해석 못 한 바다 표현:'); for (const [k, v] of Object.entries(uc).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k} ×${v}`);

// ── 2부: 예비특보 한 줄(부모 해역 × 시간창)이 어떻게 끝났나 ──────────────────────────────
// 정식 전환 = 그 시간창 끝까지 나온 특보 통보문의 발효 중 칸(t6)에 그 해역이 있음(앞으로 발효될 것 포함)
// 시간 변경 = 끝나기 전에 목록에서 빠졌고 같은 해역이 다른 시간창으로 남음 · 취소 = 빠지고 그 해역이 아예 없음
// 조용히 만료 = 끝까지 목록에 있었는데 정식 특보가 없었음
{
    const { PARENTS } = require('./lifecycle_check');
    const fate = { 정식전환: 0, 시간변경: 0, 취소: 0, 만료: 0 }, cancelHow = {}, cancelEx = [];
    for (const [office, { yebi, wrn }] of Object.entries(byOffice)) {
        const ys = lastVersions(yebi).sort((a, b) => a.tmIn.localeCompare(b.tmIn));
        const ws = lastVersions(wrn).sort((a, b) => a.tmIn.localeCompare(b.tmIn));
        const formalAt = ws.map((r) => { const s = new Set(); for (const l of lines(r.t6)) { const m = l.replace(/^[oOㅇ*]\s*/, '').match(/^(풍랑|태풍)(주의보|경보)\s*:\s*(.+)$/); if (m) for (const tok of splitTop(m[3])) { const mm = tok.match(/^([^(]+)/); if (mm) { const u = expand(tok, []); if (u) for (const x of u) if (PARENTS.has(x)) s.add(x); } } } return { t: KST(r.tmIn), s, r }; });
        const live = new Map();   // key → {e, first}
        const close = (k, how, at, r) => {
            const { e } = live.get(k); live.delete(k);
            const formal = formalAt.some((w) => w.t <= e.end && w.t >= e.first - 3600e3 && w.s.has(e.unit));
            if (formal) { fate.정식전환++; return; }
            if (how === 'expired') { fate.만료++; return; }
            fate[how]++;
            if (how === '취소') {
                fate.늦은취소 = (fate.늦은취소 || 0) + (at > e.start ? 1 : 0);   // 시간창이 이미 시작된 뒤에야 취소
                const tag = /예비특보\s*해제/.test(r.t1 || '') ? '「풍랑예비특보 해제」 특보 통보문' : (lines(r.t4).some((l) => /^o\s*없음/.test(l)) ? '예비 통보문 「o 없음」' : '예비 통보문 목록에서 빠짐');
                const note = /취소|해제|삭제|제외/.test(String(r.other || '')) ? ' + 참고사항에 언급' : ' (참고사항 언급 없음)';
                cancelHow[tag + note] = (cancelHow[tag + note] || 0) + 1;
                if (cancelEx.length < 8 && /취소|해제|삭제|제외/.test(String(r.other || ''))) cancelEx.push(`${office} ${r.t1Title} ${String(r.tmIn).slice(0, 16)} ${e.unit} ${fmt(e.start)}~ — 참고사항: ${String(r.other).replace(/<br\s*\/?>/g, ' / ').slice(0, 160)}`);
            }
        };
        const evs = [...ys.map((r) => ({ t: KST(r.tmIn), r, y: true })), ...ws.filter((r) => /예비특보\s*해제/.test(r.t1 || '')).map((r) => ({ t: KST(r.tmIn), r, y: false }))].sort((a, b) => a.t - b.t);
        for (const { t, r, y } of evs) {
            for (const [k, v] of [...live]) if (v.e.end <= t) close(k, 'expired', t, r);
            if (y) {
                const now = parseYebi(r.t4, r.tmFc, []).filter((e) => PARENTS.has(e.unit));
                const keys = new Set(now.map(keyOf)), units = new Set(now.map((e) => e.unit));
                for (const [k, v] of [...live]) if (!keys.has(k)) close(k, units.has(v.e.unit) ? '시간변경' : '취소', t, r);
                for (const e of now) if (!live.has(keyOf(e)) && e.end > t) live.set(keyOf(e), { e: Object.assign({ first: t }, e) });
            } else {
                const first = String(r.t2 || '').split(/\|\s*\(\d+\)|<br\s*\/?>\s*\(\d+\)/i)[0].replace(/^\(\d+\)[^:]*:\s*/, '');
                const gone = new Set(); for (const tok of splitTop(first.replace(/\s+/g, ''))) { const mm = tok.match(/^([^(]+)/); if (mm && PARENTS.has(mm[1]) && !/\(/.test(tok)) gone.add(mm[1]); }
                for (const [k, v] of [...live]) if (gone.has(v.e.unit)) close(k, '취소', t, r);
            }
        }
        for (const [k] of [...live]) close(k, 'expired', Infinity, {});
    }
    const late = fate.늦은취소 || 0; delete fate.늦은취소;
    const n = Object.values(fate).reduce((a, b) => a + b, 0);
    console.log(`\n예비특보 줄(부모 해역 × 시간창) ${n}건이 끝난 모양:`);
    for (const [k, v] of Object.entries(fate)) console.log(`  ${k} ${v}건 (${(v / n * 100).toFixed(1)}%)`);
    console.log(`  (취소 중 시간창이 이미 시작된 뒤에야 나온 것 ${late}건)`);
    console.log('취소가 표시된 방법:'); for (const [k, v] of Object.entries(cancelHow).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
    console.log('참고사항에 언급된 취소 예:'); for (const e of cancelEx) console.log('  ' + e);
}
