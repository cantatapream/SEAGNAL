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
const ZONE_SPLIT = require('../../config/zone_split');
const args = process.argv.slice(2);
const months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
const SHOW = +((args.find((a) => a.startsWith('--show=')) || '--show=15').split('=')[1]);

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[.]/g, '·');
// 구역 분할(config/zone_split.js): 통보문이 새 두 이름을 쓰면 읽을 수 있게 한다(코드표에도 새 코드가 있지만 여기서도 분명히 더해 둔다).
//   없으면: 「제주도남서쪽바깥먼바다」를 「바다가 아님」으로 버리고, 「제주도먼바다(제주도남서쪽바깥먼바다)」는 괄호 안을 몰라 묶음 전체(안쪽먼바다까지)에 특보를 붙인다.
const PARENTS = new Set([...Object.values(MMIS_CODE_TO_NAME).filter((n) => !Object.values(PARENT_TO_CHILDREN).flat().includes(n)), ...ZONE_SPLIT.NEW]);
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
    // 전환 뒤 「제주도남쪽바깥먼바다(제주도남서쪽바깥먼바다)」「…(남동쪽 제외)」처럼 옛 이름에 괄호로 한쪽만 적은 꼴 — 괄호 안이 가리키는 쪽만.
    //   없으면: 옛 이름은 자식이 없어 괄호를 못 읽고 두 구역 모두로 읽는다(특보 없는 쪽 카드·지도에 특보가 뜬다 — 독립 검토 2026-11-23).
    //   괄호 안을 못 읽으면 아래 본체로 내려가 두 구역 모두(넓은 쪽)로 둔다.
    if (ZONE_SPLIT.isActive()) {
        const m = token.match(/^([^(]+)\((.*)\)$/);
        if (m && norm(m[1]) === ZONE_SPLIT.OLD) {
            const excl = /제외\s*$/.test(m[2]);
            const toks = splitTop(m[2].replace(/제외\s*$/, '')).map(norm).filter(Boolean);
            const hit = ZONE_SPLIT.NEW.filter((n) => toks.some((t) => n === t || n.endsWith(t) || n.replace(/바깥먼바다$/, '').endsWith(t)));
            if (hit.length) return new Set(excl ? ZONE_SPLIT.NEW.filter((n) => !hit.includes(n)) : hit);
        }
    }
    const set = expandRaw(token, unknown);
    // 2026-11-26 부터 「제주도남쪽바깥먼바다」 = 새 두 구역 모두(사용자 확정 — config/zone_split.js). 묶음(제주도먼바다·제주도전해상)·괄호 안·단독 어느 꼴로 와도
    //   여기 한 곳에서 바꾼다 → 제주도먼바다 = 4구역, 제주도전해상 = 8구역. 25일 이전 통보문(옛 이름)으로 발효 중인 특보도 26일에 끊기지 않고 두 구역으로 이어진다.
    return set && set.has(ZONE_SPLIT.OLD) && ZONE_SPLIT.isActive() ? new Set(ZONE_SPLIT.splitNames(set)) : set;
}
/** expand 의 본체(구역 분할 전 이름 그대로). [연계] ← expand(이 파일) */
function expandRaw(token, unknown) {
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
        const sm = l.match(/^[oOㅇ*]\s*(.+)$/);
        if (sm && cur) {
            // 묶음 아래 세부 줄: 그 부모를 이 표현으로 바꿔 끼운다(예: o 제주도남부앞바다(연안바다 제외))
            for (const tok of splitTop(sm[1])) {
                const pm = tok.match(/^([^(]+)/); const p = pm ? norm(pm[1]) : '';
                if (!PARENTS.has(p)) continue;
                for (const x of [p, ...childrenOf(p), ...ZONE_SPLIT.splitNames([p])]) cur.units.delete(x);   // 전환 뒤 옛 이름 세부 줄 = 새 두 구역 칸을 바꿔 끼운다
                const u = expand(tok, unknown); if (u) for (const x of u) cur.units.add(x);
            }
        }
    }
    return items;
}
/**
 * 발효 중 칸(t6) → {cur: Map(단위 → 종류+등급, 예 '풍랑주의보'), kidsListed: Set(자식이 따로 적힌 부모)} — 풍랑·태풍.
 * ⚠이 칸은 상태가 다른 자식을 「부모(자식, 자식)」로 따로 적고, 부모 이름은 부모 자신만 뜻한다
 *   (2025-01 대전청 1-4호: 「충남북부앞바다(천수만·안면도 서쪽·태안·서산 북쪽 평수구역)」 + 「서해중부앞바다(충남북부앞바다, …)」).
 *   그래서 자식이 따로 적히지 않은 부모의 자식은 이 칸으로 검산할 수 없다(비교에서 뺀다).
 */
function parseCurrent(t6, unknown) {
    const cur = new Map(), kidsListed = new Set();
    for (const l of lines(t6)) {
        const m = l.replace(/^[oOㅇ*]\s*/, '').match(/^(풍랑|태풍)(주의보|경보)\s*:\s*(.+)$/);   // 2025-12-20 무렵 대문자 「O」 머리표가 쓰였다
        if (!m) continue;
        for (const tok of splitTop(m[3])) {
            const u = expand(tok, unknown); if (!u) continue;
            for (const x of u) {
                if (PARENTS.has(x)) cur.set(x, m[1] + m[2]);
                else { const par = Object.keys(PARENT_TO_CHILDREN).find((p) => childrenOf(p).includes(x)); const pm = tok.match(/^([^(]+)/);
                    // 자식이 괄호로 따로 적힌 경우만 자식 상태로 친다(부모 이름만으로 펼쳐진 자식은 뺀다)
                    if (/\(/.test(tok) && par && norm(pm[1]) === par && !PARENTS.has(norm(tok.replace(/^[^(]+\(|\)$/g, '')))) { cur.set(x, m[1] + m[2]); kidsListed.add(par); }
                    // 자식 이름을 괄호 없이 그대로 적은 꼴 「남해서부서쪽먼바다중 추자도연안바다」「서해남부남쪽안쪽먼바다중 조도부근평수구역」(자식이 하나뿐인 부모 — 적대검증 2026-11-18: 종전엔 안 읽혀 자식 대조에서 빠졌다)
                    else if (par && !/\(/.test(tok) && norm(tok) === x) { cur.set(x, m[1] + m[2]); kidsListed.add(par); } }
            }
        }
    }
    return { cur, kidsListed };
}

module.exports = { norm, lines, splitTop, expand, parseItems, parseCurrent, PARENTS, childrenOf };
if (require.main === module) {
const unknown = [];
const report = { bulletins: 0, checked: 0, exact: 0, offices: {} }, examples = [];
const byOffice = {};
for (const ym of months) for (const f of fs.readdirSync(path.join(__dirname, 'raw', ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', ym, f), 'utf8'));
    for (const it of Object.values(d.items)) if (it.rpt === '6' && it.result) (byOffice[d.officeName] = byOffice[d.officeName] || []).push(it.result);
}
for (const [office, list] of Object.entries(byOffice)) {
    const last = new Map();   // 같은 호는 마지막 판만 — 호 번호는 해마다 다시 시작하므로 발표 연도를 붙인다(2025 1-41호 ≠ 2026 1-41호)
    for (const r of list) { const k = String(r.tmFc).slice(0, 4) + ' ' + r.t1Title; if (!last.has(k) || last.get(k).tmIn < r.tmIn) last.set(k, r); }
    // 입력 시각 순 — 발표시각(tmFc)은 앞뒤가 바뀔 수 있다(2025-07 대전청 7-28호: 발표 11:00·입력 11:17 이 7-26호 발표 11:10·입력 10:50 보다 뒤).
    const seq = [...last.values()].sort((a, b) => (a.tmIn + a.tmFc).localeCompare(b.tmIn + b.tmFc));
    const st = new Map(); let seeded = false;
    const o = report.offices[office] = { bulletins: seq.length, checked: 0, exact: 0 };
    for (const r of seq) {
        report.bulletins++;
        const items = parseItems(r.t2, unknown);
        const { cur: truth, kidsListed } = parseCurrent(r.t6, unknown);
        const comparable = (k) => PARENTS.has(k) || kidsListed.has(Object.keys(PARENT_TO_CHILDREN).find((p) => childrenOf(p).includes(k)));
        // 첫 통보문: 발효 중 칸으로 시작하되, 그 통보문의 변경 칸(부모 이름 = 자식 포함)도 적용한다
        //   (발효 중 칸만 쓰면 자식이 빠진다 — 2025-01 대전 1-3호 「서해중부앞바다(충남북부앞바다, 충남남부앞바다) 발표」의 평수구역, 2026-11-15)
        if (!seeded) { for (const [k, v] of truth) st.set(k, v); for (const it of items) for (const u of it.units) { if (it.action === '해제') st.delete(u); else if (it.action === '발표' || it.action === '변경') st.set(u, it.type + it.level); } seeded = true; continue; }
        for (const it of items) {
            for (const u of it.units) {
                if (it.action === '해제') st.delete(u);
                else if (it.action === '발표' || it.action === '변경') st.set(u, it.type + it.level);   // 태풍 특보가 풍랑 특보를 대신하므로 종류까지 상태로 든다
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
}
