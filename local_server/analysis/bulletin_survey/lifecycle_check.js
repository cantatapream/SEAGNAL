'use strict';
/**
 * lifecycle_check.js — (시험판) 특보 통보문만으로 해역(부모+자식)별 풍랑 특보 상태를 따라가고,
 *   매 통보문의 「현재 발효 중 특보(t6)」 칸과 맞는지 스스로 검산한다(분석용, 2026-11-12).
 * 규칙(사용자 확정 2026-11-12):
 *   - 부모 해역 이름만 나오면 자식 해역 전부 포함. 일부 포함·제외는 괄호로 명시된다.
 *   - 묶음 이름(제주도전해상·동해남부앞바다 …)은 config/zone_group_map 으로 펼친다. 「묶음(부모, 부모)」면 괄호 안 부모만.
 * 적용: 관서별로 같은 호의 마지막 판만, 입력시각 순. 발표·변경 = 그 등급, 해제 = 없음, 해제예고연장 = 그대로.
 *   통보문의 발효 중 칸은 「이 통보문까지 적용한 뒤」 상태(앞으로 발효될 것 포함)라 바로 적용한다.
 * 실행: node lifecycle_check.js 2025-01 2025-02 … [--show=20]
 * [연계] ← 사람이 실행 / → raw/<달>/*.json · config/zone_group_map · marine_warning_crawler PARENT_TO_CHILDREN
 */
const fs = require('fs'), path = require('path');
const { ZONE_GROUP_MAP } = require('../../config/zone_group_map');
const { PARENT_TO_CHILDREN, MMIS_CODE_TO_NAME } = require('../../marine_warning_crawler');
const args = process.argv.slice(2);
const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
const SHOW = +((args.find((a) => a.startsWith('--show=')) || '--show=15').split('=')[1]);

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[.]/g, '·');
const PARENTS = new Set(Object.values(MMIS_CODE_TO_NAME).filter((n) => !Object.values(PARENT_TO_CHILDREN).flat().includes(n)));
const childrenOf = (p) => PARENT_TO_CHILDREN[p] || [];
const lines = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
/** 괄호 짝을 지켜 쉼표로 나눈다. */
function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if ((ch === ',' || ch === '，') && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur); return out.map((x) => x.trim()).filter(Boolean);
}
/** 자식 표현(「연안바다」「북서연안바다」「천수만 평수구역」)에 맞는 그 부모의 자식들. */
function matchChildren(parent, tok) {
    const t = norm(tok);
    return childrenOf(parent).filter((c) => norm(c).endsWith(t) || norm(c) === t);
}
/**
 * 해역 표현 하나 → 단위 집합(부모 이름 = 부모 자신, 자식 이름 = 그 자식). 바다가 아니면 null.
 * 예: '제주도앞바다(제주도북부앞바다, 제주도동부앞바다)' → 두 부모 + 그 자식들
 *     '제주도남부앞바다(연안바다 제외)' → 부모만 / '경북북부앞바다(연안바다)' → 그 자식만
 */
function expand(token, unknown) {
    const m = token.match(/^([^(]+)(?:\((.*)\))?$/);
    if (!m) { unknown.push(token); return null; }
    const name = norm(m[1]), inner = (m[2] || '').trim();
    let parents;
    if (ZONE_GROUP_MAP[name]) {
        parents = ZONE_GROUP_MAP[name];
        if (inner) {
            const sub = splitTop(inner).map(norm).filter((x) => PARENTS.has(x));
            if (sub.length) return new Set(sub.flatMap((p) => [p, ...childrenOf(p)]));
        }
        return new Set(parents.flatMap((p) => [p, ...childrenOf(p)]));
    }
    if (PARENTS.has(name)) {
        const set = new Set([name, ...childrenOf(name)]);
        if (!inner) return set;
        const excl = /제외\s*$/.test(inner);
        const toks = splitTop(inner.replace(/제외\s*$/, ''));
        const kids = toks.flatMap((t) => matchChildren(name, t));
        if (!kids.length) { unknown.push(token); return set; }
        if (excl) { for (const k of kids) set.delete(k); return set; }
        return new Set(kids);   // 괄호에 자식만 적었으면 그 자식만
    }
    if (Object.values(PARENT_TO_CHILDREN).flat().includes(name)) return new Set([name]);
    return null;   // 육상 등 — 바다가 아니다
}
/** 「(n) 풍랑주의보 발표 : 목록」 + 아래 「o 부모(…)」 줄 → [{n, kind, level, action, units}] */
function parseItems(t2, unknown) {
    const items = []; let cur = null;
    for (const l of lines(t2)) {
        const im = l.match(/^\((\d+)\)\s*(.+?)\s*:\s*(.+)$/);
        if (im) {
            const ka = im[2].replace(/\s+/g, '');
            const km = ka.match(/^(풍랑|태풍)(주의보|경보)(발표|변경|해제예고연장|해제예고변경|해제|연장)?/);
            cur = km ? { n: +im[1], type: km[1], level: km[2], action: km[3] || '?', raw: im[3], units: new Set() } : null;
            if (cur) { for (const tok of splitTop(im[3])) { const u = expand(tok, unknown); if (u) for (const x of u) cur.units.add(x); } items.push(cur); }
            continue;
        }
        const sm = l.match(/^[oㅇ*]\s*(.+)$/);
        if (sm && cur) {
            // 묶음 아래 세부 줄: 그 부모를 이 표현으로 바꿔 끼운다(예: o 제주도남부앞바다(연안바다 제외))
            for (const tok of splitTop(sm[1])) {
                const pm = tok.match(/^([^(]+)/); const p = pm ? norm(pm[1]) : '';
                if (!PARENTS.has(p)) continue;
                for (const x of [p, ...childrenOf(p)]) cur.units.delete(x);
                const u = expand(tok, unknown); if (u) for (const x of u) cur.units.add(x);
            }
        }
    }
    return items;
}
/**
 * 발효 중 칸(t6) → {cur: Map(단위 → 등급), kidsListed: Set(자식이 따로 적힌 부모)} — 풍랑만.
 * ⚠이 칸은 상태가 다른 자식을 「부모(자식, 자식)」로 따로 적고, 부모 이름은 부모 자신만 뜻한다
 *   (2025-01 대전청 1-4호: 「충남북부앞바다(천수만·안면도 서쪽·태안·서산 북쪽 평수구역)」 + 「서해중부앞바다(충남북부앞바다, …)」).
 *   그래서 자식이 따로 적히지 않은 부모의 자식은 이 칸으로 검산할 수 없다(비교에서 뺀다).
 */
function parseCurrent(t6, unknown) {
    const cur = new Map(), kidsListed = new Set();
    for (const l of lines(t6)) {
        const m = l.replace(/^[oㅇ*]\s*/, '').match(/^(풍랑)(주의보|경보)\s*:\s*(.+)$/);
        if (!m) continue;
        for (const tok of splitTop(m[3])) {
            const u = expand(tok, unknown); if (!u) continue;
            for (const x of u) {
                if (PARENTS.has(x)) cur.set(x, m[2]);
                else { const par = Object.keys(PARENT_TO_CHILDREN).find((p) => childrenOf(p).includes(x)); const pm = tok.match(/^([^(]+)/);
                    // 자식이 괄호로 따로 적힌 경우만 자식 상태로 친다(부모 이름만으로 펼쳐진 자식은 뺀다)
                    if (/\(/.test(tok) && par && norm(pm[1]) === par && !PARENTS.has(norm(tok.replace(/^[^(]+\(|\)$/g, '')))) { cur.set(x, m[2]); kidsListed.add(par); } }
            }
        }
    }
    return { cur, kidsListed };
}

const unknown = [];
const report = { bulletins: 0, checked: 0, exact: 0, offices: {} }, examples = [];
const byOffice = {};
for (const ym of months) for (const f of fs.readdirSync(path.join(__dirname, 'raw', ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', ym, f), 'utf8'));
    for (const it of Object.values(d.items)) if (it.rpt === '6' && it.result) (byOffice[d.officeName] = byOffice[d.officeName] || []).push(it.result);
}
for (const [office, list] of Object.entries(byOffice)) {
    const last = new Map();   // 같은 호는 마지막 판만
    for (const r of list) { const k = r.t1Title; if (!last.has(k) || last.get(k).tmIn < r.tmIn) last.set(k, r); }
    // 입력 시각 순 — 발표시각(tmFc)은 앞뒤가 바뀔 수 있다(2025-07 대전청 7-28호: 발표 11:00·입력 11:17 이 7-26호 발표 11:10·입력 10:50 보다 뒤).
    const seq = [...last.values()].sort((a, b) => (a.tmIn + a.tmFc).localeCompare(b.tmIn + b.tmFc));
    const st = new Map(); let seeded = false;
    const o = report.offices[office] = { bulletins: seq.length, checked: 0, exact: 0 };
    for (const r of seq) {
        report.bulletins++;
        const items = parseItems(r.t2, unknown);
        const { cur: truth, kidsListed } = parseCurrent(r.t6, unknown);
        const comparable = (k) => PARENTS.has(k) || kidsListed.has(Object.keys(PARENT_TO_CHILDREN).find((p) => childrenOf(p).includes(k)));
        if (!seeded) { for (const [k, v] of truth) st.set(k, v); seeded = true; continue; }   // 첫 통보문의 발효 중 칸으로 시작
        for (const it of items) {
            if (it.type !== '풍랑') continue;
            for (const u of it.units) {
                if (it.action === '해제') st.delete(u);
                else if (it.action === '발표' || it.action === '변경') st.set(u, it.level);
            }
        }
        report.checked++; o.checked++;
        const miss = [...truth].filter(([k, v]) => st.get(k) !== v).map(([k, v]) => `${k}:${v}(우리 ${st.get(k) || '없음'})`);
        const extra = [...st].filter(([k]) => comparable(k) && !truth.has(k)).map(([k, v]) => `${k}:${v}(통보문엔 없음)`);
        if (!miss.length && !extra.length) { report.exact++; o.exact++; }
        else {
            if (examples.length < SHOW) examples.push(`${office} ${r.t1Title} ${r.tmFc.slice(0, 16)} 「${r.t1}」 — ${[...miss, ...extra].slice(0, 6).join(', ')}`);
            for (const [k, v] of truth) st.set(k, v);   // 어긋나면 통보문 칸으로 다시 맞추고 계속(다음 호 검산이 앞 오류에 끌려가지 않게)
            for (const k of [...st.keys()]) if (comparable(k) && !truth.has(k)) st.delete(k);
        }
    }
}
console.log(`특보 통보문 ${report.bulletins}건 · 검산 ${report.checked}건 · 발효 중 칸과 완전히 같음 ${report.exact}건 (${(report.exact / report.checked * 100).toFixed(1)}%)`);
for (const [k, v] of Object.entries(report.offices)) console.log(`  ${k}: ${v.exact}/${v.checked}`);
console.log('\n어긋난 예:'); for (const e of examples) console.log('  ' + e);
const uc = {}; for (const u of unknown) uc[u] = (uc[u] || 0) + 1;
console.log('\n해석 못 한 바다 표현:'); for (const [k, v] of Object.entries(uc).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k} ×${v}`);
