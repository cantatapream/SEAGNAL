/**
 * ab_card_html.js — ★**카드 HTML 을 옮기기 전과 옮긴 뒤가 한 바이트도 다르지 않은지** 잰다. (4-1·4-3)
 *
 * [왜 있나] 4-1·4-3 은 관리자 검토 카드 7종의 겉껍데기를 `cardShell()` 한 곳으로 모으는 일이다.
 * 이것은 **사용자(관리자)에게 보이는 화면**이고, 화면이 미세하게 바뀌어도 아무도 못 알아챈다 —
 * 관리자 화면은 매일 보는 곳이 아니다. `test_admin_cards.js` 는 「무엇이 있어야 하나」를 못박지만
 * **「글자 하나 안 바뀌었나」는 못박지 못한다.** 그 자리를 이 자가 맡는다.
 *
 * [어떻게 재나]
 *   ① 기준 커밋(기본 `HEAD`)에서 `ai_chat.js` 를 꺼내 **옛 함수**를 떼어 온다
 *   ② 작업본에서 `cardShell()` + **새 함수**를 떼어 온다
 *   ③ 카드마다 정해 둔 입력 격자를 **둘 다에 먹여 문자열을 견준다**
 *   대역(`esc`·`nfmt`·`shortTs`·`reviewFieldsHTML`)은 **양쪽에 똑같은 것**을 넣는다 —
 *   견주는 것은 겉껍데기이지 대역이 아니다.
 *
 * ⚠**옮기기 전에 먼저 이 자를 돌려 0을 봐 두어야 한다.** 옮긴 뒤에만 돌리면 「원래 그랬다」와
 *   「내가 바꿨다」를 가릴 수 없다(A/B 는 A를 먼저 재야 A/B다).
 * ⚠기준 커밋에 그 함수가 아직 없으면 **건너뛰지 않고 알린다** — 조용히 넘기면 안 잰 것이 통과로 보인다.
 *
 * 쓰는 법:
 *   node scripts/refactor/ab_card_html.js                 7종 전부 (기준 HEAD)
 *   node scripts/refactor/ab_card_html.js draftCardHTML    한 종만
 *   node scripts/refactor/ab_card_html.js --base HEAD~3    기준 커밋을 바꿔서
 *
 * [연계] ← 등록부 `4-1`·`4-3`. → local_server/scripts/test_admin_cards.js(있어야 할 것) ·
 *        client/js/ai-chat/ai_chat.js(cardShell · 카드 7종).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const F = 'client/js/ai-chat/ai_chat.js';
const argv = process.argv.slice(2);
const bi = argv.indexOf('--base');
const BASE = bi >= 0 ? argv[bi + 1] : 'HEAD';
const only = argv.filter((a) => /CardHTML$/.test(a));

/** 중괄호를 세어 함수 원문 한 덩이를 떼어 온다(test_chat_render.js 와 같은 방식). */
function fnSrc(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0, k = src.indexOf('{', i);
  for (;; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(i, k + 1);
}

// 양쪽에 똑같이 넣는 대역 — 견주는 것은 겉껍데기다.
const STUB = [
  'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")' +
  '.replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
  'function nfmt(n){return String(n);}',
  'function shortTs(t){return "2026-01-01";}',
  'function reviewFieldsHTML(rv){return "<div class=\\"nrya-rv-field\\">F</div>";}',
];

const XSS = '<script>alert(1)</script>';
const Q = 'a"b&c<d';
const STATES = ['pending', 'done', 'dismissed', 'approved', 'reviewed', undefined, ''];

/** 카드마다의 입력 격자. 빈 값·따옴표·꺾쇠·없는 칸을 일부러 섞는다. */
const GRID = {
  draftCardHTML: () => {
    const out = [];
    for (const file of ['a/b.md', '', 'raw/해운법/' + Q])
      for (const topic of [undefined, '', XSS])
        for (const law of [undefined, '', '해운법', Q])
          for (const penalty of [undefined, 0, 1])
            for (const unverified of [0, 1, 1234, -1, NaN, undefined, '3', 'x'])
              out.push([{ file, topic, law, penalty, unverified }]);
    return out;
  },
  feedbackCardHTML: () => {
    const out = [];
    for (const status of STATES)
      for (const question of [XSS, '', undefined, Q])
        for (const thumb of ['up', 'down', undefined])
          for (const reason of [undefined, '', Q])
            out.push([{ id: 'f1' + Q, question, answerGist: XSS, reason, thumb, status, ts: 1 }]);
    return out;
  },
  candidateCardHTML: () => {
    const out = [];
    for (const status of STATES)
      for (const query of [XSS, '', undefined])
        for (const laws of [undefined, [], ['해운법', Q]])
          for (const files of [undefined, [], ['a.txt', Q]])
            out.push([{ id: 'c1', query, answerGist: Q, laws, files, status, ts: 1 }]);
    return out;
  },
  amendmentCardHTML: () => {
    const out = [];
    for (const status of STATES)
      for (const law of [XSS, '', undefined, Q])
        for (const kind of ['개정', '폐지', undefined, ''])
          out.push([{ id: 'a1', law, kind, status, ts: 1 }]);
    return out;
  },
  freshnessCardHTML: () => {
    const out = [];
    for (const status of STATES)
      for (const title of [XSS, '', undefined])
        for (const verdict of ['구버전', '이름바뀜의심', undefined])
          for (const pending of [undefined, [], [{ issued: '2026-01-01', no: Q }]])
            for (const files of [undefined, [], [Q]])
              out.push([{
                id: 'r1', title, law: '해운법', kind: '구판', status, verdict, ts: 1,
                pending, files, tier: Q, held: Q, cur: { serial: Q, issued: '2026-01-01', no: Q },
                reopen_reason: undefined, candidates: undefined, words: undefined, steps: undefined,
              }]);
    return out;
  },
  mokCardHTML: () => {
    const out = [];
    for (const status of STATES)
      for (const title of [XSS, '', undefined])
        for (const kind of ['누락', undefined, ''])
          for (const spots of [undefined, [], [Q, 'x']])
            for (const missing of [undefined, 0, 3])
              out.push([{
                id: 'm1', title, law: '해운법', kind, status, tier: Q, spots, missing,
                api_count: 10, raw_count: 7, mst: undefined, reopen_reason: undefined,
              }]);
    return out;
  },
  reviewCardHTML: () => {
    const out = [];
    for (const open of [true, false, undefined])
      for (const approved of [true, false, undefined])
        for (const title of [XSS, '', undefined])
          for (const fields of [undefined, {}, { 'AI 제안값': Q }, { '확인 체크리스트': Q }])
            for (const targetPages of [undefined, [], [Q]])
              out.push([{ id: 'v1', title, law: Q, approved, fields, targetPages }, open]);
    return out;
  },
};

const names = only.length ? only : Object.keys(GRID);
let head;
try {
  head = execSync(`git -C ${REPO} show ${BASE}:${F}`, { maxBuffer: 1 << 28 }).toString();
} catch (e) {
  console.error(`실패: 기준 커밋 ${BASE} 에서 ${F} 를 꺼내지 못했다 — ${String(e.message || e).slice(0, 160)}`);
  process.exit(2);
}
const work = fs.readFileSync(path.join(REPO, F), 'utf8');
const shell = fnSrc(work, 'cardShell');

console.log(`\n── 카드 HTML A/B — 기준 ${BASE} vs 작업본 ──`);
console.log(`   겉껍데기: ${shell ? 'cardShell() 있다' : '아직 없다 (옮기기 전 A 를 재는 중)'}`);

let bad = 0, cases = 0, skipped = 0;
for (const name of names) {
  const oldSrc = fnSrc(head, name);
  const newSrc = fnSrc(work, name);
  if (!oldSrc || !newSrc) {
    // 조용히 넘기지 않는다 — 안 잰 것이 통과로 보이면 안 된다.
    console.log(`  ⚠ ${name} — ${!oldSrc ? `기준 ${BASE} 에 없다` : '작업본에 없다'} ⇒ 재지 못했다`);
    skipped++; continue;
  }
  if (oldSrc === newSrc) { console.log(`  ·  ${name} — 손대지 않았다 (원문 동일)`); continue; }
  let oldFn, newFn;
  try {
    oldFn = new Function(STUB.concat([oldSrc, 'return ' + name + ';']).join('\n'))();
    newFn = new Function(STUB.concat(shell ? [shell] : [], [newSrc, 'return ' + name + ';']).join('\n'))();
  } catch (e) {
    console.log(`  ❌ ${name} — 떼어 오지 못했다: ${String(e.message || e).slice(0, 120)}`);
    bad++; continue;
  }
  let diff = 0, n = 0, first = null;
  for (const args of GRID[name]()) {
    n++; cases++;
    let a, b;
    try { a = String(oldFn.apply(null, args)); } catch (e) { a = 'THROW:' + e.message; }
    try { b = String(newFn.apply(null, args)); } catch (e) { b = 'THROW:' + e.message; }
    if (a !== b) { diff++; if (!first) first = { args, a, b }; }
  }
  if (diff) {
    bad++;
    console.log(`  ❌ ${name} — ${n}가지 중 **${diff}가지가 다르다**`);
    console.log(`       입력 ${JSON.stringify(first.args).slice(0, 200)}`);
    console.log(`       옛: ${first.a.slice(0, 300)}`);
    console.log(`       새: ${first.b.slice(0, 300)}`);
  } else {
    console.log(`  ✅ ${name} — ${n}가지 입력 전부 **한 바이트도 같다**`);
  }
}
console.log(`\n  견준 입력 ${cases}가지 · 다른 카드 ${bad} · 재지 못한 카드 ${skipped}`);
process.exit(bad ? 1 : 0);
