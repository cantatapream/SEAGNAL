'use strict';
/**
 * replay_status.js — (분석용, 2026-11-18) 실제 계산기(services/bulletin_status.compute)를 과거 특보 통보문마다 그 순간으로 돌려,
 *   그 통보문에 기상청이 적어 둔 「발효 중 칸(t6)」·「딸린 예비 현황(t7)」과 같은지 센다.
 * 왜 저장소에 두나: 종전엔 이 대조를 임시 스크립트로 했고, 2026-11-17 에 **대조하는 쪽도 계산기와 같은 가정으로 고쳐서**
 *   (「A(자식)」이 있으면 부모도 특보로 채움) 100% 가 나왔다 — 가정이 틀렸는데도 못 잡았다(README ⑫ 정정).
 *   ⚠이 파일의 「기상청 쪽」은 통보문에 적힌 그대로만 읽는다. 계산기 규칙을 바꿔도 이쪽은 고치지 않는다.
 * 대조 방식(통보문 하나마다, 그 통보문 입력 시각 기준 · 앞 5일(운영 관찰기가 들고 있는 기간, --days 로 바꿈) 통보문으로 계산):
 *   ① 부모: t6 에 적힌 부모 해역·등급 = 계산기의 부모 정식 특보(해제 시각을 기다리는 것은 뺌 — t6 은 해제 통보문을 낸 순간 그 해역을 뺀다.
 *      발효 전 다음 특보가 있으면 그 등급 — t6 은 발표한 순간 새 등급을 적는다). 화면용으로 채운 「자식만 특보」 부모(derived)는 뺀다.
 *   ② 자식: 자식 줄기 통보문(wrnFc '02')의 t6 자식 줄 = 계산기의 자식 정식 특보(같은 규칙).
 *   ③ 예비: t7 의 풍랑·태풍 예비 부모 해역 = 계산기의 부모 예비(지금 예비 + 정식 특보의 다가오는 예비). t7 은 자식 예비를 적지 않으므로 부모만.
 * 실행: node replay_status.js [--list]      (6천 번 가까이 계산하므로 2~4분 걸린다)
 * [연계] → raw/<달>/*.json · services/bulletin_status.compute·parseYebiList · lifecycle_check.parseCurrent
 */
const fs = require('fs'), path = require('path');
const S = require('../../services/bulletin_status');
const { parseCurrent, PARENTS } = require('./lifecycle_check');
const LIST = process.argv.includes('--list');
// 창 길이: 운영 관찰기(services/bulletin_watch)는 통보문을 처음 본 뒤 5일까지 들고 있다(목록은 3일 전부터 받지만 본 기록은 5일 뒤에 지운다) → 기본 5일.
//   --days=3 으로 더 짧게(통보문이 더 적을 때 어떻게 되나) 돌려 볼 수 있다.
const DAYS = +((process.argv.find((a) => a.startsWith('--days=')) || '--days=5').split('=')[1]);
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');

const by = {};
const RAW = path.join(__dirname, 'raw');
for (const ym of fs.readdirSync(RAW)) for (const f of fs.readdirSync(path.join(RAW, ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(RAW, ym, f), 'utf8'));
    for (const it of Object.values(d.items || {})) if (it.result && it.result.tmIn) (by[d.officeName] = by[d.officeName] || []).push({ office: d.officeName, rpt: it.rpt, result: it.result, ms: KST(it.result.tmIn) });
}
const same = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const diff = (truth, mine) => [...truth].filter(([k, v]) => mine.get(k) !== v).map(([k, v]) => `${k}:${v}(계산 ${mine.get(k) || '없음'})`).concat([...mine].filter(([k]) => !truth.has(k)).map(([k, v]) => `${k}:계산 ${v}(통보문엔 없음)`));
const R = { n: 0, parent: 0, kidN: 0, kid: 0, yebi: 0, derived: 0 }, bad = { 부모: [], 자식: [], 예비: [] };
for (const list of Object.values(by)) {
    list.sort((a, b) => a.ms - b.ms);
    for (const T of list) {
        if (T.rpt !== '6' || T.result.tmIn < '2025-01-06') continue;   // 수집 시작 뒤 며칠은 앞 통보문이 모자라 뺀다
        const z = S.compute(list.filter((b) => b.ms <= T.ms && b.ms > T.ms - DAYS * 86400e3), T.ms).zones;
        const tag = `${T.office} ${T.result.t1Title} ${T.result.tmIn.slice(0, 16)}`;
        const lv = (v) => (v.next ? v.next.type + v.next.level : v.type + v.level);
        const formal = Object.entries(z).filter(([, v]) => v.kind === 'formal' && !v.relMs && !v.derived);
        const { cur, kidsListed } = parseCurrent(T.result.t6, []);
        R.n++; R.derived += Object.values(z).filter((v) => v.derived).length ? 1 : 0;
        // ① 부모
        const tP = new Map([...cur].filter(([u]) => PARENTS.has(u))), mP = new Map(formal.filter(([u]) => PARENTS.has(u)).map(([u, v]) => [u, lv(v)]));
        if (same(tP, mP)) R.parent++; else bad.부모.push(`${tag} — ${diff(tP, mP).join(', ')}`);
        // ② 자식(자식 줄기 통보문 — 자식 줄이 적힌 부모의 자식만 견줄 수 있다)
        if (T.result.wrnFc === '02') {
            R.kidN++;
            const tK = new Map([...cur].filter(([u]) => !PARENTS.has(u))), mK = new Map(formal.filter(([u, v]) => !PARENTS.has(u) && kidsListed.has(v.parent)).map(([u, v]) => [u, lv(v)]));
            if (same(tK, mK)) R.kid++; else bad.자식.push(`${tag} — ${diff(tK, mK).join(', ')}`);
        }
        // ③ 예비(부모)
        const tY = new Set(S.parseYebiList(T.result.t7 || '', T.result.tmFc).filter((e) => PARENTS.has(e.unit) && e.end > T.ms).map((e) => e.unit));
        const mY = new Set(Object.entries(z).filter(([u, v]) => PARENTS.has(u) && (v.kind === 'yebi' ? !v.derived : !!v.upYebi)).map(([u]) => u));
        const miss = [...tY].filter((u) => !mY.has(u)), extra = [...mY].filter((u) => !tY.has(u));
        if (!miss.length && !extra.length) R.yebi++; else bad.예비.push(`${tag} — 빠짐[${miss}] 더있음[${extra}]`);
    }
}
const pct = (a, b) => `${a}/${b} (${(a / b * 100).toFixed(2)}%)`;
console.log(`특보 통보문 ${R.n}건 · 창 ${DAYS}일`);
console.log(`① 부모 정식 특보 = 발효 중 칸      ${pct(R.parent, R.n)}`);
console.log(`② 자식 정식 특보 = 발효 중 칸 자식 줄 ${pct(R.kid, R.kidN)}  (자식 줄기 통보문만)`);
console.log(`③ 부모 예비 = 딸린 예비 현황        ${pct(R.yebi, R.n)}`);
console.log(`   화면용 「자식만 특보」 부모 카드가 생긴 통보문 ${R.derived}건(대조에서는 뺌)`);
for (const [k, v] of Object.entries(bad)) { console.log(`\n어긋남 — ${k} ${v.length}건`); for (const x of (LIST ? v : v.slice(0, 12))) console.log('   ' + x); }
