#!/usr/bin/env node
/**
 * V5-24 의 자를 고정한다 — 「사람이 봐야 한다」 표시 세는 법 (2026-09-23, G-24 · 2-19)
 *
 * ⚠L-136 — 여기서 규칙을 **다시 적지 않는다.** 운영 함수를 그대로 부른다.
 *   자를 베껴 쓰면 그 사본이 곧 옛 규칙이 되고, 같은 것을 두 값으로 재게 된다(⑥).
 */
const C = require('../knowledge/legal/_dashboard/loop/_counting.js');
const G = require('../knowledge/legal/_dashboard/loop/admrul_review_gate.js');

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name); if (why) console.log(why); }
};

// ── ① 범위 — 927 은 「폴더 바로 아래」라는 뜻에서만 나온다 ──────────────────
//   ★928 → 927 (2026-10-06 · 3-79): 「수산관계법령 위반행위에 대한 행정처분의 기준과 절차에 관한 규칙」은
//   행정규칙이 아니라 독립 해양수산부령이라 `수산업법/행정규칙/` 에서 제 법령 폴더로 옮겼다(사장님 결정).
const any = C.countAdmrulReview('anywhere');
//   ★927 → 930 (2026-10-07 · 3-84): 개정검토에서 관리자가 승인한 **새 고시 3건**을 받았다 —
//     「(해양경찰청) 범죄수사규칙」(해양경찰법) · 「해양경찰 무인비행장치 운용 및 관리에 관한 규칙」(해양경비법) ·
//     「유역관리업무지침」(물환경보전법). 「재난안전의무보험 업무기준」은 사장님 결정으로 받지 않았다.
ok('범위가 930개다 (행정규칙 폴더 **바로 아래** .txt)', any.전체 === 930,
    `        실제 ${any.전체}개 — 하위폴더를 포함하면 2,285, 도메인 01~14 만이면 739 가 된다.\n` +
    '        범위를 안 적어 두면 같은 이름으로 세 값이 나온다(뿌리 사슬 ⑥).');
ok('범위의 뜻이 사전에 글로 적혀 있다', typeof C.ADMRUL_SCOPE.뜻 === 'string' && C.ADMRUL_SCOPE.뜻.length > 10);

// ── ② 뜻마다 값이 다르다 — 그것이 정상이고, 뜻을 안 적는 것이 병이다 ────────
const v = {};
for (const s of Object.keys(C.REVIEW_SENSES)) v[s] = C.countAdmrulReview(s).걸린파일;
// ★숫자를 박지 않는다 (2026-09-24) — `4` 라 적어 뒀다가 뜻 하나(`남음`)를 더하자 빨간불이 났다.
//   시험이 지킬 것은 **개수가 아니라 성질**이다: *뜻마다 이름과 설명이 있다.*
ok('뜻마다 이름과 설명이 있다 (숫자를 박지 않는다)',
    Object.keys(C.REVIEW_SENSES).length >= 4
    && Object.values(C.REVIEW_SENSES).every((d) => typeof d === 'string' && d.length > 5),
    `        지금 뜻 ${Object.keys(C.REVIEW_SENSES).length}가지: ${Object.keys(C.REVIEW_SENSES).join(' · ')}`);
// ★새 뜻 `남음` — 대조 기록이 하나도 없는 파일만 센다.
//   `anywhere` 는 옛 표시를 괄호로 남기는 규약 때문에 **더는 내려갈 수 없다.** 그래서 이 뜻을 더했다.
ok('`남음` 은 `anywhere` 보다 크지 않다 (확인을 끝낸 파일만큼 작다)',
    v['남음'] <= v.anywhere, `        anywhere ${v.anywhere} · 남음 ${v['남음']}`);
ok('좁은 뜻일수록 값이 작거나 같다 (anywhere ⊇ head5 ⊇ first)',
    v.anywhere >= v.head5 && v.head5 >= v.first,
    `        anywhere ${v.anywhere} · head5 ${v.head5} · first ${v.first}\n` +
    '        포함관계가 깨졌다면 세는 법 자체가 틀렸다.');
ok('네 뜻이 실제로 서로 다른 값을 준다 (그래서 뜻을 밝혀야 한다)',
    new Set(Object.values(v)).size >= 3,
    `        ${JSON.stringify(v)}`);

// ── ③ ★뜻을 안 주면 세지 않는다 — ⑥ 을 코드가 거부하게 만든다 ──────────────
let threw = false;
try { C.countAdmrulReview(); } catch (_) { threw = true; }
ok('뜻 없이 부르면 던진다 (뜻을 안 정한 채 세는 것을 막는다)', threw,
    '        뜻을 안 줘도 숫자가 나오면, 그 숫자를 받은 사람은 무엇을 센 건지 모른다.');
let threw2 = false;
try { C.countAdmrulReview('없는뜻'); } catch (_) { threw2 = true; }
ok('모르는 뜻을 주면 던진다', threw2);

// ── ④ 등록부의 147 은 재현되지 않는다 — 사실을 시험으로 못박는다 ────────────
ok('★등록부가 말한 147 은 어떤 뜻으로도 안 나온다',
    !Object.values(v).includes(147),
    `        ${JSON.stringify(v)} — 147 이 다시 나온다면 이 시험을 고칠 것이 아니라\n` +
    '        등록부의 자를 찾은 것이니 그 자를 사전에 적어야 한다.');
ok('「원문 대조 필요」 라는 문구는 아주 드물다 (6개)', v.phrase === 6,
    `        실제 ${v.phrase}개 — 등록부는 이것이 147개라고 적었다.`);

// ── ⑤ ★표시가 까닭을 안 적는다 — 이것이 진짜 발견이다 ──────────────────────
const why = C.admrulReviewReasons();
ok('표시 덩어리를 까닭 있는 것과 맨 표시로 가른다', why.덩어리 === why.까닭있음 + why.맨표시,
    `        ${JSON.stringify(why)}`);
ok('★까닭을 안 적은 맨 표시가 과반이다 (줄이려면 까닭부터 적어야 한다)',
    why.맨표시 > why.까닭있음,
    `        까닭있음 ${why.까닭있음} · 맨표시 ${why.맨표시}\n` +
    '        이 줄이 뒤집히면 좋은 일이다 — 까닭이 적히기 시작했다는 뜻이다.');

// ── ⑥ 게이트가 사전을 부른다 (자를 두 벌 만들지 않았다) ─────────────────────
const m = G.measure();
ok('게이트가 재는 값이 사전이 재는 값과 같다', m.anywhere === v.anywhere && m.head5 === v.head5,
    `        게이트 ${m.anywhere}/${m.head5} · 사전 ${v.anywhere}/${v.head5}\n` +
    '        다르면 게이트가 규칙을 베껴 쓴 것이다(L-136 위반).');
ok('게이트가 맨 표시 수도 함께 돌려준다', typeof m.맨표시 === 'number');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
