#!/usr/bin/env node
/**
 * V5-55 — 「원문 그대로 · 요약·재해석 금지」를 **선언한 쪽이 실제로 원문 글을 담고 있나** (2026-09-27 신설)
 *
 * [왜 만들었나 — 규약은 있는데 그것을 재는 자가 없었다]
 *   위키 쪽 **210개**가 머리에 「원문 그대로 적는다 · 요약·재해석 금지」를 선언한다.
 *   그런데 **그 선언을 지켰는지 재는 자가 하나도 없었다.** (`exact_claim_recheck.py` 는 그 문구를
 *   *EXACT 주장에서 빼는 데* 쓸 뿐, 지켰는지는 묻지 않는다.) 뿌리 사슬 ⑤ 그대로다 —
 *   *게이트가 묻지 않는 물음은 영영 답이 없다.*
 *   실제로 `3-37`·농수산물 별표31 에서 **요약해 적은 쪽**이 우연히 발견됐다. 우연에 맡기지 않는다.
 *
 * [세는 법 — ★방향이 중요하다. 「원문의 낱말이 우리 쪽에 남아 있나」로 잰다]
 *   ⚠**처음 만든 자는 거꾸로였고 못 썼다.** 「우리 칸의 글이 원문에 **이어져** 있나」로 재면,
 *   원문의 박스 표는 칸 안에서 글이 줄바꿈되어 **평평하게 펴면 열끼리 뒤섞이므로**
 *   옳게 옮긴 쪽까지 「원문에 없다」로 잡힌다:
 *       │거. 법에 따른 각종 신청이 │법 제100조 │1회 │30만원 │
 *       │나 신고에서 거짓 사실을   │제3항제2호 ├───┼─────┤
 *     → 펴면 `거.법에따른각종신청이법제100조1회30만원나신고에서…` (출입국관리법 별표2 가 100% 로 잡혔다)
 *   ⚠**낱말로 바꿨지만 방향이 그대로여서 또 못 썼다.** 「우리 낱말이 원문에 있나」로는
 *   **요약을 못 잡는다** — 요약은 낱말을 그대로 쓰면서 **내용을 버리기** 때문이다
 *   (확인된 요약 쪽인 농수산물 별표31 이 3% 로 떨어졌다).
 *   ★그래서 **뒤집었다**: **원문의 서로 다른 낱말(2자 이상) 중 몇 %가 우리 쪽 글에 남아 있나.**
 *     · 요약·누락은 **원문 낱말을 통째로 잃는다** ⇒ 비율이 떨어진다.
 *     · 줄바꿈은 한 줄마다 **낱말 하나**를 조각내지만, 조각도 대개 우리 글의 부분글자열이라 잡히지 않는다.
 *     · 견줄 때 개정표시(`<개정 …>`)·우리 표시(`**`·`[[ ]]`)·박스 기호·공백을 떼고 눕혀서 본다.
 *
 * [★비율을 「보존된 내용의 몫」으로 읽지 않는다 — 자에 따라 값이 움직인다 (실측)]
 *   조사·어미가 다르면(원문의 문장을 우리가 표로 옮길 때 흔하다) 그 낱말은 「없다」로 세어진다.
 *   실제로 **농수산물 별표31 한 쪽**을 세 가지 자로 재 보니:
 *       엄격(그대로 찾는다)            **41%**
 *       흔한 조사 한 글자를 떼어 본다  **60%**
 *       아무 한 글자나 떼어 본다       **66%**
 *   ⇒ **절대값은 자가 정한다.** 그러나 ★**순위는 세 자에서 모두 같았다** — 가장 낮은 다섯 쪽이 그대로다.
 *   그래서 이 자는 **엄격한 쪽을 쓴다**(손으로 만든 조사 목록이 없어야 다음 사람이 안 헷갈린다) 그리고
 *   **① 순위** 와 **② 나빠졌나** 에만 쓴다. 「이 쪽은 41%만 지켰다」처럼 말하지 않는다.
 *   ⚠**무엇이 「요약 위반」인가는 기계가 고르지 않는다**(G-34). 잡힌 쪽의 차이는 갈래가 여럿이다 —
 *     ①진짜 내용 누락(농수산물 — 자격 학과 목록이 통째로 없다) ②문장 어미·조사(표로 옮기며 바뀐다)
 *     ③표 머리글 낱말 ④지명·이름이 다르다(수산업법 별표7 — 원문은 `전남광주통합특별시`, 우리 쪽엔 없다).
 *   ⇒ 게이트는 **늘지 않는 것**만 잠그고, **가르는 일은 사람에게 낸다.**
 *
 * [★못 재는 것을 「괜찮다」로 세지 않는다 — 세 갈래로 가른다]
 *   ① **견줄 수 있다** — `raw 원문:` 이 **그 별표 파일**(`…/별표/…txt`)을 가리킨다.
 *   ② **먼저 별표를 떼어야 한다** — 경로가 **문서 전체**(`…/행정규칙/…txt`)를 가리킨다.
 *      문서 전체와 별표 한 장을 견주면 당연히 비율이 낮다(낚시터 세부기준 14% — 허수다).
 *   ③ **원문 경로가 아예 없다** — 선언만 있고 견줄 원문이 적혀 있지 않다. ★이것이 가장 많다.
 *   ②③은 **결함 수가 아니라 「아직 못 잰 수」**다. 그 수도 잠근다 — 늘면 빨간불.
 *
 * 사용법
 *   node verbatim_coverage.js            지금 값을 찍는다
 *   node verbatim_coverage.js --list     쪽마다 덮임 비율을 보여 준다
 *   node verbatim_coverage.js --why <쪽조각>   그 쪽에서 원문에만 있는 낱말을 보여 준다
 *   node verbatim_coverage.js --gate     기준선과 견준다 (나빠지면 exit 1)
 *   node verbatim_coverage.js --update   기준선을 지금 값으로 다시 쓴다 (좋아졌을 때만)
 *
 * [연계] → 기준선 `loop/baseline/verbatim_coverage.json` · `verify_all.sh` V5-55
 *         ← 이 결함을 처음 드러낸 일 `3-37`(요약해 적은 조 3개) · 농수산물 별표31
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const WIKI = path.join(LEGAL, 'wiki');
const BASE = path.join(HERE, 'baseline', 'verbatim_coverage.json');

// 「원문 그대로」를 선언한 쪽을 고르는 말
const RULE = /요약[·ㆍ]?\s*재?해석?\s*금지|요약\s*금지|그대로\s*보존/;
// `raw 원문: raw/…txt` 꼴 (인용부호·★머리를 허용한다)
const RAWRE = /^[ \t]*>?[ \t]*(?:★)?[ \t]*raw[ \t]*원문[ \t]*[::][ \t]*`?(raw\/[^`\s]+\.txt)`?/gm;
const AMEND = /<\s*(?:개정|신설|삭제|본조신설|전문개정|제목개정)[^>]*>/g;
const BOX = /[│┃├┤┬┼┴┌┐└┘─━┄┈╡╢╞╟╪╫]/g;
const 우리표시 = /\*\*|\*|`|\[\[|\]\]|<br>|~~/g;

/** 눕히기 — 개정표시·우리 표시·표 기호·공백을 떼고 한 줄로 만든다 */
function 눕(t) {
    return String(t || '').replace(AMEND, '').replace(우리표시, '')
        .replace(BOX, '').replace(/\|/g, '').replace(/\s+/g, '');
}
/** 낱말 — 한글 2자 이상 / 숫자 3자 이상 / 영문 3자 이상. 표 기호는 칸 가름으로 본다 */
function 낱말(t) {
    return String(t || '').replace(AMEND, '').replace(BOX, ' ')
        .match(/[가-힣]{2,}|[0-9]{3,}|[A-Za-z]{3,}/g) || [];
}

function 쪽들() {
    const out = [];
    const 걷 = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { 걷(p); continue; }
            if (!e.name.endsWith('.md')) continue;
            let t;
            try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
            if (!RULE.test(t)) continue;
            out.push({ 쪽: path.relative(WIKI, p), 글: t });
        }
    };
    걷(WIKI);
    return out;
}

function 재기() {
    const 선언 = 쪽들();
    const 잰것 = [];
    let 원문없음 = 0, 경로깨짐 = 0, 낱말적음 = 0;
    for (const { 쪽, 글 } of 선언) {
        RAWRE.lastIndex = 0;
        const 적힌 = [...글.matchAll(RAWRE)].map((m) => m[1]);
        if (!적힌.length) { 원문없음++; continue; }
        const 열림 = 적힌.filter((x) => fs.existsSync(path.join(LEGAL, x)));
        if (!열림.length) { 경로깨짐++; continue; }      // V5-40 이 따로 본다
        const rawT = 열림.map((x) => fs.readFileSync(path.join(LEGAL, x), 'utf8')).join('\n');
        const 위키 = 눕(글);
        const ws = [...new Set(낱말(rawT))];
        if (ws.length < 20) { 낱말적음++; continue; }     // 그림뿐인 별표 등 — 견줄 글이 없다
        const 없 = ws.filter((w) => !위키.includes(w));
        잰것.push({
            쪽,
            짝: /\/별표\//.test(열림[0]),                 // 원문 경로가 그 별표 파일인가
            원문낱말: ws.length,
            잃음: 없.length,
            덮임: 1 - 없.length / ws.length,
            보기: 없.slice(0, 25),
            원문: 열림[0],
            길: { raw: 눕(rawT).length, 위키: 위키.length },
        });
    }
    잰것.sort((a, b) => a.덮임 - b.덮임);
    const 짝 = 잰것.filter((r) => r.짝);
    return {
        선언한쪽: 선언.length,
        원문없음, 경로깨짐, 낱말적음,
        견줄수있다: 짝.length,
        별표를떼야한다: 잰것.length - 짝.length,
        '95미만': 짝.filter((r) => r.덮임 < 0.95).length,
        '60미만': 짝.filter((r) => r.덮임 < 0.60).length,
        _목록: 잰것,
    };
}

function 찍기(v) {
    console.log('  「원문 그대로 · 요약 금지」를 선언한 쪽이 원문 글을 담고 있나');
    console.log('    뜻: **원문의 서로 다른 낱말 중 몇 %가 우리 쪽 글에 남아 있나** (방향이 이쪽이어야 요약이 잡힌다)');
    console.log('');
    console.log(`    선언한 쪽 ${v.선언한쪽}`);
    console.log(`      · 견줄 수 있다              ${v.견줄수있다}   ← 이 안에서만 판정한다`);
    console.log(`          그중 덮임 95% 미만       ${v['95미만']}`);
    console.log(`          그중 덮임 60% 미만       ${v['60미만']}   ★요약·누락이 크다`);
    console.log(`      · 먼저 별표를 떼야 한다      ${v.별표를떼야한다}   (원문 경로가 문서 전체를 가리킨다)`);
    console.log(`      · 원문 경로가 안 적혀 있다   ${v.원문없음}   ★가장 많다 — 견줄 것이 없다`);
    console.log(`      · 적힌 경로가 안 열린다      ${v.경로깨짐}   (V5-40 이 따로 본다)`);
    console.log(`      · 견줄 글이 너무 적다        ${v.낱말적음}   (그림뿐인 별표 등)`);
}

function 기준선() {
    try { return JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch (_) { return null; }
}

if (require.main === module) {
    const v = 재기();
    const 목 = v._목록;
    delete v._목록;

    if (process.argv.includes('--why')) {
        const 조각 = process.argv[process.argv.indexOf('--why') + 1] || '';
        for (const r of 목.filter((x) => x.쪽.includes(조각))) {
            console.log(`\n${r.쪽}   덮임 ${(100 * r.덮임).toFixed(0)}% · 잃은 낱말 ${r.잃음}/${r.원문낱말}`);
            console.log(`   원문 ${r.원문}  (${r.길.raw}자 → 우리 ${r.길.위키}자)${r.짝 ? '' : '   ⚠문서 전체를 가리킨다 — 비율은 허수다'}`);
            console.log(`   원문에만 있는 낱말: ${r.보기.join(' · ')}`);
        }
        process.exit(0);
    }

    if (process.argv.includes('--list')) {
        찍기(v);
        console.log('\n  갈래 덮임  잃음/원문낱말   원문자→우리자    쪽');
        for (const r of 목) {
            console.log(`  ${r.짝 ? '짝' : '통'} ${(100 * r.덮임).toFixed(0).padStart(4)}% ${String(r.잃음).padStart(5)}/${String(r.원문낱말).padEnd(6)} ${String(r.길.raw).padStart(7)}→${String(r.길.위키).padEnd(7)} ${r.쪽.replace('annexes/', '').slice(0, 58)}`);
        }
        console.log('\n  「통」은 원문 경로가 문서 전체를 가리키는 쪽이다 — **비율을 판정에 쓰지 않는다.**');
        process.exit(0);
    }

    if (process.argv.includes('--update')) {
        fs.mkdirSync(path.dirname(BASE), { recursive: true });
        const 옛 = 기준선();
        fs.writeFileSync(BASE, JSON.stringify({
            견줄수있다: v.견줄수있다, '95미만': v['95미만'], '60미만': v['60미만'],
            별표를떼야한다: v.별표를떼야한다, 원문없음: v.원문없음,
            _잰날: new Date().toISOString().slice(0, 10),
            _옛_기준선: 옛 || null,
            _뜻: '나빠지면 빨간불. 좋아졌을 때만 `--update` 로 내려 잠근다(G-49).',
        }, null, 1) + '\n', 'utf8');
        찍기(v);
        console.log('\n✅ 기준선을 다시 썼다 — loop/baseline/verbatim_coverage.json');
        process.exit(0);
    }

    찍기(v);
    if (!process.argv.includes('--gate')) process.exit(0);

    const b = 기준선();
    if (!b) {
        console.log('\n❌ 기준선이 없다 — `node verbatim_coverage.js --update` 로 먼저 잠근다');
        process.exit(1);
    }
    const 나쁨 = [];
    for (const k of ['95미만', '60미만', '별표를떼야한다', '원문없음']) {
        if (v[k] > b[k]) 나쁨.push(`${k} ${b[k]} → ${v[k]}`);
    }
    // 견줄 수 있는 쪽이 줄면(원문 경로를 지웠다는 뜻) 그것도 나쁘다
    if (v.견줄수있다 < b.견줄수있다) 나쁨.push(`견줄수있다 ${b.견줄수있다} → ${v.견줄수있다} (줄었다)`);
    if (!나쁨.length) {
        console.log(`\n✅ V5-55 나빠지지 않았다 (기준선 95%미만 ${b['95미만']} · 60%미만 ${b['60미만']} · 원문경로없음 ${b.원문없음})`);
        process.exit(0);
    }
    console.log(`\n❌ V5-55 **「원문 그대로」선언이 더 안 지켜졌다** — ${나쁨.join(' · ')}`);
    console.log('   → 어느 쪽인지 본다:      node verbatim_coverage.js --list');
    console.log('   → 무엇을 잃었는지 본다:  node verbatim_coverage.js --why <쪽 이름 조각>');
    console.log('   ★고치는 길은 「원문을 그대로 다시 옮기는 것」이다. 기준선을 올려서 통과시키지 않는다(G-49).');
    process.exit(1);
}

module.exports = { 재기, 눕, 낱말 };
