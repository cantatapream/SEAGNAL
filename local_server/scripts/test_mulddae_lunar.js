/**
 * ============================================================================
 * 파일명: local_server/scripts/test_mulddae_lunar.js
 * 역할  : 물때(1물~14물·조금·무시)와 음력 날짜 계산을 검사한다.
 *         (초보자용: 날짜를 하루씩 넘길 때 물때가 건너뛰거나, 같은 날인데 시각에 따라 바뀌지 않는지 본다.)
 * ----------------------------------------------------------------------------
 * [무엇을 보나 — 사용자 2026-11-24]
 *  「12물에서 갑자기 14물로 점프」「날짜를 변경하지 않았음에도 불구하고 왔다 갔다」 → 음력 날짜 기준으로 바꿈(「추천대로」).
 *  ① 음력 초하루가 서울 시각 삭(달이 안 보이는 순간) 날짜와 같다 — 2026·2027년, 2028년 설날
 *     (대조 자료: timeanddate.com 서울 달 위상표의 삭 시각. 자정 근처인 2026-10-11 00:50 · 2027-02-07 00:56 · 2028-01-27 00:12 포함)
 *  ② 물때가 하루에 한 칸씩만 넘어간다(음력 큰달 안에서 건너뜀·겹침 없음) — 남해·동해(8물때식)·서해(7물때식)
 *  ③ 같은 날이면 시각과 무관하게 같은 물때다
 *  (①에 더해: 추석 5개년 = 8월 15일 · 윤달 · 2024~2030 하루씩 이어짐 · 2030-02 까지 물때가 빠지는 날 없음 — 독립 검토 2026-11-24 반영)
 *  ④ 사용자 화면의 날짜: 2026-11-28=12물 · 11-29=13물 · 11-30=14물(종전 계산은 12물 다음이 14물이었다)
 * [연계] → client/tide.js (getLunarDate · isWestSea · computeMulddae) ← scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 검사. 서버·브라우저·외부 호출 없음. 날짜를 직접 넣으므로 오늘 날짜와 무관하다.
 * [실행] node local_server/scripts/test_mulddae_lunar.js
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../client/tide.js'), 'utf8');
let pass = 0, fail = 0;
/** 사례 하나를 세고 찍는다. @param {boolean} ok @param {string} msg @returns {void} */
function check(ok, msg) { if (ok) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } }
/** tide.js 에서 함수 하나의 글을 그대로 떼어 낸다(파일 전체는 브라우저 전용이라 통째로 못 올린다). @param {string} name @returns {string} */
function grab(name) {
    const i = src.indexOf('function ' + name + '(');
    let d = 0, k = src.indexOf('{', i);
    for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) break; }
    return src.slice(i, k + 1);
}
const box = {};
vm.createContext(box);
vm.runInContext(grab('getLunarDate') + grab('getLunarDateApprox') + grab('isWestSea') + grab('computeMulddae'), box);
const lunar = (y, m, d) => box.getLunarDate(y, m, d).replace(/^\d+년 /, '');
/** 한국 시각 y-m-d hh시의 순간. 물때는 한국 날짜로 읽으므로(기기 시간대와 무관) 시험도 한국 시각으로 만든다 — 이 검사가 어느 시간대의 컴퓨터에서 돌아도 같다. */
const kst = (y, m, d, hh) => new Date(Date.UTC(y, m - 1, d, (hh === undefined ? 9 : hh) - 9));
const mul = (y, m, d, hh, lat, lon) => box.computeMulddae(null, null, null, null, kst(y, m, d, hh), lat, lon);
const SOUTH = [35.0, 129.3], WEST = [36.5, 126.2];

console.log('── ① 음력 초하루 = 서울 시각 삭 날짜 ──');
[[2026, 2, 17, '1월'], [2026, 3, 19, '2월'], [2026, 4, 17, '3월'], [2026, 5, 17, '4월'], [2026, 6, 15, '5월'], [2026, 7, 14, '6월'],
    [2026, 8, 13, '7월'], [2026, 9, 11, '8월'], [2026, 10, 11, '9월'], [2026, 11, 9, '10월'], [2026, 12, 9, '11월'], [2027, 1, 8, '12월'],
    [2027, 2, 7, '1월'], [2027, 3, 8, '2월'], [2027, 4, 7, '3월'], [2027, 5, 6, '4월'], [2027, 6, 5, '5월'], [2027, 7, 4, '6월'],
    [2027, 8, 2, '7월'], [2027, 9, 1, '8월'], [2027, 9, 30, '9월'], [2027, 10, 29, '10월'], [2027, 11, 28, '11월'], [2027, 12, 28, '12월'],
    [2028, 1, 27, '1월']
].forEach(([y, m, d, mon]) => check(lunar(y, m, d) === mon + ' 1일', y + '-' + m + '-' + d + ' = 음력 ' + mon + ' 1일 (지금: ' + lunar(y, m, d) + ')'));
check(lunar(2026, 11, 27) === '10월 19일', '2026-11-27 = 음력 10월 19일(종전 표는 18일이었다) — 지금: ' + lunar(2026, 11, 27));
check(/ 30일$/.test(lunar(2027, 2, 6)) && / 30일$/.test(lunar(2028, 1, 26)), '설날 전날은 섣달 그믐(30일): ' + lunar(2027, 2, 6) + ' · ' + lunar(2028, 1, 26));

// 추석(음력 8월 15일) — 표를 만든 삭 자료와는 다른 출처(공휴일 날짜)로 보는 대조
[[2024, 9, 17], [2025, 10, 6], [2026, 9, 25], [2027, 9, 15], [2028, 10, 3]].forEach(([y, m, d]) =>
    check(lunar(y, m, d) === '8월 15일', '추석 ' + y + '-' + m + '-' + d + ' = 음력 8월 15일 (지금: ' + lunar(y, m, d) + ')'));
check(lunar(2025, 7, 25) === '(윤)6월 1일' && lunar(2028, 6, 23) === '(윤)5월 1일', '윤달: 2025 윤6월 · 2028 윤5월 — ' + lunar(2025, 7, 25) + ' · ' + lunar(2028, 6, 23));
{   // 2024-02-10(설날) ~ 2030-02-02 하루씩 — 음력 일이 +1 이거나 29·30일 뒤 1일로만 넘어간다(표가 끊기거나 31일·0일이 나오지 않는다)
    let bad = 0, prev = null, n = 0;
    for (let t = Date.UTC(2024, 1, 10); t < Date.UTC(2030, 1, 3); t += 864e5) {
        const u = new Date(t), m = /(\d+)월 (\d+)일$/.exec(box.getLunarDate(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()) || '');
        const d = m ? +m[2] : NaN; n++;
        if (!(d >= 1 && d <= 30) || +m[1] > 12 || (prev !== null && !(d === prev + 1 || (d === 1 && prev >= 29)))) bad++;
        prev = d;
    }
    check(bad === 0 && n > 2100, '2024-02-10 ~ 2030-02-02 ' + n + '일 — 음력 날짜가 끊기지 않고 이어진다(이상 ' + bad + '건)');
    let nul = 0; for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2030, 1, 3); t += 864e5) if (!box.computeMulddae(null, null, null, null, new Date(t), SOUTH[0], SOUTH[1])) nul++;
    check(nul === 0, '2026-01-01 ~ 2030-02-02 — 물때를 못 구하는 날이 없다(' + nul + '건)');
}

console.log('── ② 하루에 한 칸씩 ──');
const ORDER_S = ['1물', '2물', '3물', '4물', '5물', '6물', '7물', '8물', '9물', '10물', '11물', '12물', '13물', '14물', '조금'];
const ORDER_W = ['무시', '1물', '2물', '3물', '4물', '5물', '6물', '7물', '8물', '9물', '10물', '11물', '12물', '13물', '조금'];
[['남해·동해', SOUTH, ORDER_S], ['서해', WEST, ORDER_W]].forEach(([name, at, order]) => {
    // 2026-11-09(음 10월 1일) ~ 12-08(음 10월 30일) — 큰달 한 달
    const seq = []; for (let i = 0; i < 30; i++) seq.push(mul(2026, 11, 9 + i, 9, at[0], at[1]).label);
    let ok = true; for (let i = 1; i < seq.length; i++) if (order.indexOf(seq[i]) !== (order.indexOf(seq[i - 1]) + 1) % 15) ok = false;
    check(ok && seq.every(l => order.indexOf(l) >= 0), name + ' — 음력 한 달 30일 동안 건너뜀·겹침 없이 한 칸씩: ' + seq.join(' '));
});
check(mul(2026, 11, 9, 9, SOUTH[0], SOUTH[1]).label === '8물' && mul(2026, 11, 16, 9, SOUTH[0], SOUTH[1]).label === '조금' && mul(2026, 11, 17, 9, SOUTH[0], SOUTH[1]).label === '1물',
    '남해·동해: 음력 1일 = 8물 · 8일 = 조금 · 9일 = 1물');
check(mul(2026, 11, 9, 9, WEST[0], WEST[1]).label === '7물' && mul(2026, 11, 16, 9, WEST[0], WEST[1]).label === '조금' && mul(2026, 11, 17, 9, WEST[0], WEST[1]).label === '무시' && mul(2026, 11, 18, 9, WEST[0], WEST[1]).label === '1물',
    '서해: 음력 1일 = 7물 · 8일 = 조금 · 9일 = 무시 · 10일 = 1물');

// 작은달(29일) 끝에서는 한 칸이 빠진다 — 음력 물때표의 원래 성질(사용자에게 알린 것). 그 밖의 건너뜀은 없어야 한다.
{   let skip = 0, other = 0, prevL = null, prevDay = null;
    for (let t = Date.UTC(2026, 1, 17); t < Date.UTC(2028, 0, 27); t += 864e5) {
        const r = box.computeMulddae(null, null, null, null, new Date(t), SOUTH[0], SOUTH[1]);
        if (prevL !== null && ORDER_S.indexOf(r.label) !== (ORDER_S.indexOf(prevL) + 1) % 15) { if (prevDay === 29 && r.lunarDay === 1) skip++; else other++; }
        prevL = r.label; prevDay = r.lunarDay;
    }
    check(other === 0, '2026-02-17 ~ 2028-01-26 — 작은달 끝(29일 → 1일)을 빼면 건너뜀·겹침 0건 (작은달 끝 ' + skip + '번 · 그 밖 ' + other + '번)');
}

console.log('── ③ 같은 날이면 시각과 무관 ──');
let same = true;
for (let d = 1; d <= 30 && same; d++) { const base = mul(2026, 11, d, 0, SOUTH[0], SOUTH[1]).label; for (let h = 1; h < 24; h++) if (mul(2026, 11, d, h, SOUTH[0], SOUTH[1]).label !== base) { same = false; console.log('     ' + d + '일 ' + h + '시에 바뀜'); break; } }
check(same, '2026년 11월 한 달 — 한국 시각 0시부터 23시까지 어느 시각을 넣어도 그날의 물때는 하나다');
// 간출암 화면은 「한국 정오」를 UTC 시각으로 만들어 넘긴다(hazard_rocks.js — Date.UTC(y, mo, d, 3)). 기기 시간대와 무관하게 그 한국 날짜의 물때여야 한다
check(box.computeMulddae(null, null, null, null, new Date(Date.UTC(2026, 10, 30, 3, 0, 0)), SOUTH[0], SOUTH[1]).label === '14물',
    '한국 정오를 UTC 로 만든 날짜(간출암 화면 방식)도 그 한국 날짜의 물때 — 2026-11-30 = 14물');

console.log('── ④ 사용자 화면의 날짜 ──');
check(['12물', '13물', '14물'].join() === [28, 29, 30].map(d => mul(2026, 11, d, 9, SOUTH[0], SOUTH[1]).label).join(),
    '2026-11-28·29·30 = 12물·13물·14물 (종전: 12물 다음이 14물) — 지금: ' + [28, 29, 30].map(d => mul(2026, 11, d, 9, SOUTH[0], SOUTH[1]).label).join('·'));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
