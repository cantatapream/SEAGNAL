#!/usr/bin/env node
/**
 * 3-41 ① — 본문 인용의 **값 숫자**(금액·기간·비율·치수)를 **raw 원문과 맞대어 본다.**
 *
 * 왜 새로 만드나 (2026-09-24)
 *   `cite_number_check.py` 로 먼저 해 봤더니 **맞음 0 · 어긋남 9** 가 나왔다. 까닭을 파 보니
 *   `body_cite_gap.json` 의 `원문` 칸은 **조 제목만** 담고 있었다(`"법률: 항만공사의 대행"`).
 *   ★맞댈 본문이 애초에 없었다 — 도구가 아니라 **내가 고른 자료가 틀렸다.**
 *   ⇒ 여기서는 raw 원문 본문을 **챗봇이 쓰는 함수로 직접 읽어** 맞댄다(L-136).
 *
 * 어떻게 고르나 (넘겨짚지 않는다)
 *   · 인용 줄이 **다른 법·고시를 이름 대어 가리키면 건너뛴다** — 어느 문서의 제N조인지
 *     기계가 못 가린다(`사용료고시 제14조`를 항만법 제14조로 읽으면 엉뚱한 값과 맞댄다).
 *   · 그 쪽(statute/concept)의 **자기 법** 조문만 본다. 계층은 줄에 적힌 말로 가린다
 *     (`시행령 제3조` → 시행령). 안 적혀 있으면 법률·시행령·시행규칙을 **다 뒤져** 하나라도
 *     맞으면 맞음으로 센다(느슨한 쪽으로 — 틀렸다고 단정하지 않기 위해서다).
 *
 * 무엇을 말하나
 *   ✅ 맞음         값 숫자가 그 조 원문에 글자 그대로 있다
 *   ⚠ 어긋남 후보   하나라도 없다. ★**틀렸다는 말이 아니다** — 원문이 한글로 적었거나
 *                  (`일억원`) 다른 조·다른 문서에서 끌어온 값일 수 있다. 사람이 볼 목록이다
 *   ·  못 가림      법·계층·조를 기계가 못 정했다 → ②(사람) 쪽
 *
 * [연계] ← `_dashboard/body_cite_gap.json` · `_dashboard/law_raw_paths.json`
 *         자: `local_server/services/article_text.js`(extractArticleBlock)
 *         → `_dashboard/cite_number_raw.json`
 * 사용법: node cite_number_raw.js [--write] [--list]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const RAW = path.join(LEGAL, 'raw');
const DASH = path.join(LEGAL, '_dashboard');
const REPO = path.resolve(LEGAL, '../../..');   // legal → knowledge → local_server → 저장소 뿌리
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const PATHS = JSON.parse(fs.readFileSync(path.join(DASH, 'law_raw_paths.json'), 'utf8'));

const UNIT = '원|만원|억원|천원|퍼센트|%|일|개월|시간|분|미터|m|밀리미터|mm|센티미터|cm'
           + '|킬로미터|km|톤|킬로그램|kg|그램|리터|명|인|배|노트|마일|해리|세|척';
const VALUE = new RegExp('(?<![조항호목장편절])(\\d[\\d,]*(?:\\.\\d+)?)\\s*(' + UNIT + ')(?![가-힣A-Za-z])', 'g');
const DROP = [
    /\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}/g,
    /\d{4}\s*년\s*\d{1,2}\s*월(\s*\d{1,2}\s*일)?/g,
    /(법률|대통령령|부령|훈령|고시)\s*제?\s*\d+\s*호/g,
    /제\s*\d+\s*(조|항|호|목|장|편|절)(의\s*\d+)?/g,
    /별표\s*\d+(의\d+)?|별지\s*제?\s*\d+/g,
    /\b[A-Z]{1,3}\d{1,3}(-\d+)?[a-z]?\b/g,
    /\d+\s*차(\s|감사|$)/g,                              // 「12차 감사」는 값이 아니다
];
// 인용 줄이 **다른 문서**를 이름 대어 가리키는 꼴 — 그러면 건너뛴다
const OTHER_DOC = /(고시|지침|규정|세칙|요령|예규|훈령|기준|협약|조약|규칙)\s*제\s*\d+\s*조|「[^」]{2,40}」\s*제\s*\d+\s*조/;

function values(line) {
    let s = String(line || '');
    for (const d of DROP) s = s.replace(d, ' ');
    const out = [];
    let m;
    VALUE.lastIndex = 0;
    while ((m = VALUE.exec(s))) {
        const v = m[1].replace(/,/g, '') + m[2];
        if (!out.includes(v)) out.push(v);
    }
    return out;
}

function inText(num, unit, text) {
    if (text.includes(num + unit)) return true;
    if (text.includes(num)) return true;
    if (num.length > 3) {
        const c = Number(num).toLocaleString('en-US');
        if (text.includes(c)) return true;
    }
    return false;
}

/** 법 이름 → raw 폴더(절대경로). `rawPathOf` 와 같은 규약(공백 제거). */
function folderOf(law) {
    const flat = String(law || '').replace(/\s+/g, '');
    const rel = PATHS[flat] || PATHS[flat.replace(/[·ㆍ・]/g, '')];
    return rel ? path.join(REPO, rel) : null;
}

const TIERS = [['시행규칙', 'rule'], ['시행령', 'decree'], ['법률', 'law']];

function main() {
    const write = process.argv.includes('--write');
    const show = process.argv.includes('--list');
    const d = JSON.parse(fs.readFileSync(path.join(DASH, 'body_cite_gap.json'), 'utf8'));
    const items = [];
    for (const [law, pages] of Object.entries(d.by_law)) {
        for (const pg of pages) for (const it of pg.items) items.push({ ...it, law, page: pg.page });
    }
    const R = { ok: [], bad: [], skip: [], human: [] };
    for (const it of items) {
        const vals = values(it.line);
        if (!vals.length) { it._왜 = '값 숫자가 없다 — 뜻풀이 인용이다'; R.human.push(it); continue; }
        if (OTHER_DOC.test(it.line)) {
            it._왜 = '인용 줄이 다른 문서(고시·지침 등)의 조를 가리킨다 — 기계가 어느 문서인지 못 가린다';
            it._찾은값 = vals; R.skip.push(it); continue;
        }
        const dir = folderOf(it.law);
        if (!dir || !fs.existsSync(dir)) {
            it._왜 = 'raw 폴더를 못 찾았다: ' + it.law; it._찾은값 = vals; R.skip.push(it); continue;
        }
        // 그 쪽에서 쓸 수 있는 본문 파일을 모아 조를 찾는다(계층이 안 적혀 있으면 다 뒤진다)
        let body = '';
        for (const [stem, tier] of TIERS) {
            for (const nm of [`${stem}.txt`, `${stem}_발췌.txt`]) {
                const p = path.join(dir, nm);
                if (!fs.existsSync(p)) continue;
                const blk = AT.extractArticleBlock(fs.readFileSync(p, 'utf8'), it.article, tier);
                if (blk) body += '\n' + (blk.title || '') + '\n' + (blk.body || '');
            }
        }
        if (!body.trim()) {
            it._왜 = `그 조(${it.article})를 raw 본문에서 못 찾았다`; it._찾은값 = vals;
            R.skip.push(it); continue;
        }
        const missing = vals.filter((v) => {
            const m = /^([\d.]+)(.+)$/.exec(v);
            return !inText(m[1], m[2], body);
        });
        it._찾은값 = vals;
        if (missing.length) { it._안맞는값 = missing; R.bad.push(it); } else R.ok.push(it);
    }
    console.log('  3-41 ① 값 숫자를 raw 원문과 맞대어 본다');
    console.log(`    본문 인용 항목 전체 ${items.length}  ★등록부는 376 이라 적혀 있으나 실측은 이 수다`);
    console.log(`    ✅ 맞음 ${R.ok.length}           값 숫자가 그 조 원문에 글자 그대로 있다`);
    console.log(`    ⚠ 어긋남 후보 ${R.bad.length}      ★틀렸다는 말이 아니다 — 사람이 볼 목록이다`);
    console.log(`    ·  못 가림 ${R.skip.length}        법·계층·조를 기계가 못 정했다 → ② 쪽`);
    console.log(`    ·  ② 뜻풀이 ${R.human.length}      값 숫자가 없다 — 사람이 본다`);
    if (show) {
        for (const it of R.ok.slice(0, 15)) console.log(`       ✅ ${it.law.slice(0, 20)} ${it.article} — ${it._찾은값.join('·')}`);
        for (const it of R.bad) console.log(`       ⚠ ${it.law.slice(0, 20)} ${it.article} — 없는값 ${it._안맞는값.join('·')} (찾은값 ${it._찾은값.join('·')})`);
    }
    if (write) {
        fs.writeFileSync(path.join(DASH, 'cite_number_raw.json'), JSON.stringify({
            _뜻: '본문 인용의 값 숫자(금액·기간·비율·치수)를 raw 원문과 글자 그대로 맞대어 본 결과',
            _범위: 'body_cite_gap.json 전체 · 자는 article_text.extractArticleBlock(챗봇과 같은 것)',
            _주의: '「어긋남 후보」는 틀렸다는 말이 아니다 — 원문이 한글로 적었거나(일억원) 다른 조·다른 문서에서 끌어온 값일 수 있다',
            전체: items.length, 맞음: R.ok.length, 어긋남후보: R.bad.length,
            못가림: R.skip.length, 뜻풀이: R.human.length,
            맞음목록: R.ok, 어긋남후보목록: R.bad,
        }, null, 1) + '\n', 'utf8');
        fs.writeFileSync(path.join(DASH, 'cite_human_review.json'), JSON.stringify({
            _뜻: '3-41 ② 사람이 봐야 하는 인용 — 값 숫자가 없거나(뜻풀이) 기계가 법·조를 못 가린 것',
            _쓰는곳: '_dashboard/review/cite_review.html 이 이 파일을 읽는다',
            전체: R.human.length + R.skip.length,
            뜻풀이: R.human.length, 못가림: R.skip.length,
            목록: [...R.human, ...R.skip],
        }, null, 1) + '\n', 'utf8');
        console.log('    → _dashboard/cite_number_raw.json · cite_human_review.json');
    }
    return 0;
}
if (require.main === module) process.exit(main());
