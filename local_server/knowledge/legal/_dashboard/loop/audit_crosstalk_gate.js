#!/usr/bin/env node
/**
 * V5-29 — 감사파일에 **다른 법의 감사 보고서**가 섞여 있나 (2026-09-23 신설, G-22)
 *
 * [무엇이었나] `_dashboard/audit/<법>.md` 는 그 법의 감사 기록이다. 그런데 다른 법의
 *   `# 품질감사 — 「…」` 보고서가 통째로 들어간 자리가 있었다.
 *
 * [★재 보니 2건이 아니라 3건이었다] 등록부(G-22)는 둘만 적었다. 전수로 세니:
 *     내수면어업법.md:3471           → 「어선원 및 어선 재해보상보험법」   ← 등록부가 몰랐다
 *     선박안전법.md:1567             → 「해양공간계획 및 관리에 관한 법률」
 *     해양수산발전기본법.md:2896     → 「해양공간계획 및 관리에 관한 법률」
 *
 * [★그리고 「잘못 놓인 원본」이 아니라 **중복본**이었다] 받아야 할 파일에 **이미 같은
 *   보고서가 있다**(어선원…:2334 · 해양공간…:565). 줄 대조 결과 내용이 사실상 같다
 *   (선박안전법 쪽은 유일 줄 0개 · 내수면 쪽은 1개). **잃은 기록은 없다.**
 *
 * [피해] 챗봇은 감사파일을 **안 읽는다**(`legal_retriever.js` 의 audit 언급은 주석뿐).
 *   피해는 **감사 장부**다 — 법별 문항 수·라운드 이력이 부풀고, 사람이 읽을 때 헷갈린다.
 *
 * [무엇을 재나] 기준선(3)보다 **늘면 실패**한다. 지우는 것은 따로 한다(3-40) —
 *   수백 줄을 지우는 일이라 덩이의 끝을 정확히 잡아야 하고, 그건 사람이 볼 일이다(G-34).
 *
 * ⚠**오검출을 걸러 낸다**: `# 품질감사 — 11라운드 재감사` 처럼 **법 이름 대신 라운드**를
 *   적은 머리줄이 5개 있다(항만재개발…). 그것은 오염이 아니다. 그래서 괄호 안이
 *   `법`·`률` 로 끝나는 이름일 때만 본다. **처음 센 값 8 중 5가 오검출이었다.**
 */
const fs = require('fs');
const path = require('path');

const AUDIT = path.resolve(__dirname, '../audit');
const BASE = path.join(__dirname, 'baseline', 'audit_crosstalk.json');
const HEAD = /^#\s*품질감사\s*[—-]\s*[「『"]?([^」』"(\n]+)/;
const norm = (x) => x.replace(/[\s「」『』ㆍ·]/g, '');

function find() {
    const out = [];
    for (const f of fs.readdirSync(AUDIT).sort()) {
        if (!f.endsWith('.md')) continue;
        const own = f.slice(0, -3);
        const lines = fs.readFileSync(path.join(AUDIT, f), 'utf8').split('\n');
        lines.forEach((l, idx) => {
            const m = HEAD.exec(l);
            if (!m) return;
            const named = m[1].trim();
            if (/^\d+라운드/.test(named)) return;          // ⚠라운드만 적은 머리줄 — 오염 아님
            if (!/[법률]$/.test(named.replace(/\s+$/, ''))) return;  // 법 이름 꼴이 아니면 안 본다
            const a = norm(named), b = norm(own);
            if (a.startsWith(b) || b.startsWith(a)) return;          // 제 법이면 정상
            out.push({ 파일: f, 줄: idx + 1, 남의법: named });
        });
    }
    return out;
}

function main() {
    const rows = find();
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify({ 교차오염: rows.length, 목록: rows }, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', rows.length);
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다'); return 1;
    }
    console.log(`  감사파일에 **다른 법의 감사 보고서**가 섞인 자리 ${rows.length}건 (기준선 ${base.교차오염})`);
    for (const r of rows) console.log(`     · ${r.파일}:${r.줄}  →  「${r.남의법}」`);
    console.log('     ※ 셋 다 받아야 할 파일에 **같은 보고서가 이미 있다** — 잃은 기록은 없다(중복본).');
    console.log('     ※ 챗봇은 감사파일을 안 읽는다 — 피해는 **감사 장부**(법별 문항 수·라운드 이력)다.');
    if (rows.length > base.교차오염) {
        console.log(`  ❌ 늘었다: ${base.교차오염} → ${rows.length}`);
        console.log('     → 감사 리포트를 **엉뚱한 법 파일에 이어 붙인 것**이다. 붙인 자리를 되돌린다.');
        return 1;
    }
    console.log(rows.length < base.교차오염
        ? `  ✅ 줄었다: ${base.교차오염} → ${rows.length} — \`--update\` 로 잠근다`
        : '  ✅ 기준선 그대로 — 늘지 않았다 (지우는 것은 3-40)');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { find };
