'use strict';
/**
 * trail_check.js — (분석용, 2026-11-18) 통보문 발자취(services/bulletin_status compute 의 trails — 📋 해역별 통보문 팝업)를 과거 통보문으로 검산한다.
 * 왜: 팝업은 「지금 특보의 시작(발표)부터」 통보문을 보여야 한다. 발자취가 끝난 앞 특보의 통보문을 물고 오거나(종전 MMIS 방식의 증상),
 *   발표를 빠뜨리면 안 된다. 「기상청 쪽」은 통보문에 적힌 그대로만 읽는다(replay_status.js 와 같은 원칙 — 계산기 규칙을 바꿔도 이쪽은 고치지 않는다).
 * 대조 방식(특보 통보문 하나마다, 그 통보문 입력 시각 기준 · 앞 10일(--days) 통보문으로 계산 · 부모 해역의 정식 특보만):
 *   ① 시작: 발효 중 칸(t6)에 그 해역이 **끊김 없이 적힌 뒤쪽 구간의 첫 통보문** = 발자취의 첫 정식 통보문(그리고 그것은 「발표」).
 *   ② 근거: 그 특보의 종류·등급을 만든 통보문(zones.ho)이 발자취에 들어 있다.
 *   ③ 옛 예비: 발자취 앞에 붙은 예비 통보문이 **앞 특보의 시작보다 먼저** 나온 것이면 안 된다(앞 특보로 넘어간 예비).
 *   해제 통보문을 받았거나 다음 특보가 기다리는 해역 · 「자식만 특보」 부모 · 자식 해역(일반 줄기 t6 에 자식 줄이 없다)은 견주지 않는다 — 검사(test_bulletin_status F)가 본다.
 * 검사 자체의 확인(2026-11-18): 발자취 규칙을 일부러 깨면(「변경」에서 새 발자취) 시작 다름 1,596건이 나온다 — 통과가 「안 보고 통과」가 아니다.
 *   다만 「해제 통보문 뒤 해제 시각 전 재발표」(새 발자취로 갈라지는 길)는 실자료의 부모 해역에 없어 이 검산으로는 안 걸린다(그 길은 검사 F 가 고정).
 * 실행: node trail_check.js [보여 줄 줄 수] [--days=N]
 * [연계] → raw/<달>/*.json · services/bulletin_status.compute(trails) · lifecycle_check.parseCurrent
 */
const fs = require('fs'), path = require('path');
const S = require('../../services/bulletin_status');
const { parseCurrent, PARENTS } = require('./lifecycle_check');
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const DAYS = +((process.argv.find((a) => a.startsWith('--days=')) || '--days=10').split('=')[1]), RAW = path.join(__dirname, 'raw'), by = {};
for (const ym of fs.readdirSync(RAW)) for (const f of fs.readdirSync(path.join(RAW, ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(RAW, ym, f), 'utf8'));
    for (const it of Object.values(d.items || {})) if (it.result && it.result.tmIn) (by[d.officeName] = by[d.officeName] || []).push({ office: d.officeName, rpt: it.rpt, result: it.result, ms: KST(it.result.tmIn) });
}
const R = { moments: 0, units: 0, cut: 0, startOk: 0, startBad: 0, hoMissing: 0, empty: 0, yebiOld: 0, withYebi: 0, firstAct: {} }, bad = [];
for (const list of Object.values(by)) {
    list.sort((a, b) => a.ms - b.ms);
    const W = list.filter((b) => b.rpt === '6');
    const t6 = new Map(W.map((b) => [b, new Set([...parseCurrent(b.result.t6, []).cur.keys()])]));
    for (let i = 0; i < W.length; i++) {
        const T = W[i]; if (T.result.tmIn < '2025-01-21') continue;
        const win = list.filter((b) => b.ms <= T.ms && b.ms > T.ms - DAYS * 86400e3);
        // 같은 입력시각의 통보문이 둘이면 뒤엣것까지 든 계산이라 건너뜀
        if (W[i + 1] && W[i + 1].ms === T.ms) continue;
        const r = S.compute(win, T.ms); R.moments++;
        const winW = win.filter((b) => b.rpt === '6');
        for (const [u, z] of Object.entries(r.zones)) {
            if (!PARENTS.has(u) || z.kind !== 'formal' || z.derived || z.relMs || z.next) continue;
            const tr = r.trails[u]; R.units++;
            if (!tr) { R.empty++; continue; }
            const formal = tr.list.filter((e) => !/예비특보/.test(e.act) && !/참고사항/.test(e.act));
            if (tr.cut) { R.cut++; continue; }
            if (!formal.length) { R.empty++; bad.push(`빈 발자취 ${T.office} ${T.result.t1Title} ${T.result.tmIn.slice(0,16)} ${u}`); continue; }
            // 통보문 그대로: t6 에 u 가 끊김 없이 적힌 뒤쪽 구간의 첫 통보문
            let j = winW.length - 1; if (!t6.get(winW[j]).has(u)) { continue; }
            while (j > 0 && t6.get(winW[j - 1]).has(u)) j--;
            const start = winW[j];
            R.firstAct[formal[0].act.split(' ').pop()] = (R.firstAct[formal[0].act.split(' ').pop()] || 0) + 1;
            if (formal[0].ho === start.result.t1Title && formal[0].inMs === start.ms) R.startOk++;
            else { R.startBad++; if (bad.length < 400) bad.push(`시작 다름 ${T.office} ${T.result.t1Title} ${T.result.tmIn.slice(0,16)} ${u} — 발자취 첫 ${formal[0].ho}(${formal[0].act}) / 발효 중 칸 구간 첫 ${start.result.t1Title} ${start.result.tmIn.slice(5,16)}${j === 0 ? ' (창 맨 앞)' : ''}`); }
            if (!formal.some((e) => e.ho === z.ho)) R.hoMissing++;
            // 예비: 앞 구간(직전 생애주기)의 시작보다 먼저 나온 예비 통보문이 붙었나
            const ye = tr.list.filter((e) => /예비특보/.test(e.act) && e.inMs <= formal[0].inMs);
            if (ye.length) R.withYebi++;
            let k = j - 1; while (k >= 0 && !t6.get(winW[k]).has(u)) k--;
            if (k >= 0) { let p = k; while (p > 0 && t6.get(winW[p - 1]).has(u)) p--; if (ye.some((e) => e.inMs <= winW[p].ms)) { R.yebiOld++; bad.push(`옛 예비 ${T.office} ${T.result.t1Title} ${u} — ${ye.map((e) => e.ho).join(',')} / 앞 특보 시작 ${winW[p].result.t1Title}`); } }
        }
    }
}
console.log(JSON.stringify(R, null, 1));
const kinds = {}; for (const x of bad) { const k = x.split(' ')[0] + ' ' + x.split(' ')[1]; (kinds[k] = kinds[k] || []).push(x); }
for (const [k, v] of Object.entries(kinds)) { console.log(`\n${k} ${v.length}건`); for (const x of v.slice(0, +process.argv[2] || 8)) console.log('   ' + x); }
