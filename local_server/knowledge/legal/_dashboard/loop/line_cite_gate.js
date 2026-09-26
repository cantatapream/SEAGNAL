#!/usr/bin/env node
/**
 * V5-26 — §8-B 「인용은 줄 번호가 아니라 항목 이름으로」 (2026-09-23 신설, G-6)
 *
 * [규약] `_SCHEMA §8-B`(사용자 확정 2026-09-02) —
 *   *"위키를 고치면 그 아래 줄 번호가 전부 밀린다. 지난 라운드가 남긴 `파일.md:127` 같은
 *     인용은 다음 라운드에는 **엉뚱한 줄**을 가리킨다."*
 *   그리고 규약 자신이 적용 범위를 못박았다 —
 *   *"이 규칙은 **앞으로 쓰는 것**에만 건다. 이미 쌓인 줄 번호 인용을 소급해 고치지 않는다."*
 *
 * [무엇이 문제였나] 규약은 2026-09-02 부터 있었는데 **그것을 읽는 코드가 없었다**(G-6).
 *   세는 함수는 2-6b 에서 만들었지만(`_counting.countLineCitations`) **부르는 것이 시험뿐**이라
 *   아무것도 막지 못했다 — 뿌리 사슬 ②③④ 그대로다.
 *
 * [★그 사이에 늘었다] 규약이 적어 둔 2026-09-02 실측은 **위키 6건(그중 진짜 인용 4건)** 이다.
 *   2026-09-23 에 다시 세니 **9건 / 7건** — 두 뜻이 **나란히 +3**.
 *   ⚠같은 자로 잰 값인지 확인할 길이 없어 "늘었다"고 단정하지는 않는다(⑥).
 *   다만 둘 다 `any`·`citation` 두 뜻으로 적혀 있고 차이가 나란히 +3 이라, 늘었다고 볼 근거는 있다.
 *
 * [무엇을 재나] **위키만** 판정한다. 규약이 "앞으로 쓰는 것에만"이라 했으므로
 *   **늘지 않는 것**만 본다(0 을 요구하지 않는다).
 *   백로그(12,996)·대시보드(322)는 **참고로 찍기만** 한다 — 규약이 소급하지 않기로 한 자리다.
 *   ⚠빨간불에 기준선을 다시 굽는 것으로 넘기지 않는다(G-49).
 */
const fs = require('fs');
const path = require('path');
const C = require('./_counting.js');

const BASE = path.join(__dirname, 'baseline', 'line_cite.json');
const SENSES = ['any', 'citation'];

function measure() {
    const out = { wiki: {}, 참고: {} };
    for (const s of SENSES) out.wiki[s] = C.countLineCitations({ scope: 'wiki', sense: s }).rows;
    for (const sc of ['backlog', 'dashboard']) out.참고[sc] = C.countLineCitations({ scope: sc, sense: 'any' }).rows;
    return out;
}

function main() {
    const now = measure();
    if (process.argv.includes('--update')) {
        fs.writeFileSync(BASE, JSON.stringify(now, null, 2) + '\n');
        console.log('  기준선을 다시 구웠다:', JSON.stringify(now.wiki));
        return 0;
    }
    let base;
    try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) {
        console.log('  ⚠기준선이 없다 — `--update` 로 한 번 구워야 한다');
        return 1;
    }
    console.log('  §8-B 줄번호 인용 — **위키만 판정한다**(규약이 "앞으로 쓰는 것에만"이라 했다)');
    const worse = [];
    for (const s of SENSES) {
        const d = now.wiki[s] - base.wiki[s];
        const mark = d > 0 ? '❌' : d < 0 ? '✅' : '  ';
        console.log(`  ${mark} 위키 ${s.padEnd(8)} ${String(now.wiki[s]).padStart(4)}   (기준선 ${base.wiki[s]}${d ? `, ${d > 0 ? '+' : ''}${d}` : ''})`);
        if (d > 0) worse.push(`${s} ${base.wiki[s]}→${now.wiki[s]}`);
    }
    console.log(`  [참고 — 판정 아님] 백로그 ${now.참고.backlog.toLocaleString()} · 대시보드 ${now.참고.dashboard}`);
    console.log('     규약이 **소급하지 않기로 한 자리**다. 줄이려 들지 말 것 — 작업 기록이지 챗봇 답변이 아니다(§8-B).');
    if (worse.length) {
        console.log(`  ❌ 늘었다: ${worse.join(' · ')}`);
        console.log('     → 새로 적은 인용이 `파일.md:123` 꼴이다. **그 자리를 부르는 이름**으로 바꾼다(§8-B):');
        console.log('       좋음: `○○법__전문교육.md` 「위반 시 처벌」 표, 제55조①23호 행');
        console.log('       나쁨: `○○법__전문교육.md:96`');
        console.log('     찾는 법: node -e "…countLineCitations({scope:\'wiki\',sense:\'citation\'}).samples"');
        console.log('     ⚠기준선을 다시 굽는 것으로 넘기지 않는다(G-49).');
        return 1;
    }
    const better = SENSES.filter((s) => now.wiki[s] < base.wiki[s]);
    console.log(better.length ? `  ✅ 줄었다: ${better.join(' · ')} — \`--update\` 로 잠근다`
                              : '  ✅ 기준선 그대로 — 늘지 않았다');
    return 0;
}

if (require.main === module) process.exit(main());
module.exports = { measure };
