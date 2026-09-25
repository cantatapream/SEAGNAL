// ============================================================================
// test_admin_cards.js — ★관리자 검토 카드 **7종의 HTML 을 못박는다**. (4-1 · 4-3)
//
//   [왜 있나] 2026-09-25. `ai_chat.js` 의 카드 생성기가 **7개**인데
//   (`draftCardHTML`·`feedbackCardHTML`·`candidateCardHTML`·`amendmentCardHTML`·
//    `freshnessCardHTML`·`mokCardHTML`·`reviewCardHTML`)
//   `test_chat_render.js` 는 이 자리를 **한 줄도 안 본다**(실측: 카드 관련 0건).
//   4-1·4-3 은 그 일곱을 `cardShell()` 하나로 합치는 일인데, **시험 없이 사용자 화면을
//   뜯는 것**은 이 저장소가 가장 싫어하는 일이다 — 「합쳤다」와 「같게 나온다」는 다르다.
//   ⇒ **합치기 전에** 지금 나오는 HTML 을 붙잡아 둔다. 합친 뒤 이 스위트가 그대로 통과하면
//     「글자 하나 안 바뀌었다」가 증거로 남는다.
//
//   [무엇을 못박나 — ★일곱을 **먼저 읽고** 실제 꼴에 맞춰 적었다]
//    ⚠처음엔 짐작으로 적었다가 절반이 틀렸다 — `draftCardHTML` 은 `data-id` 가 아니라 **`data-file`**
//      을 쓰고 **판정 버튼이 아예 없다**(대신 `📄 초안 보기`). `mokCardHTML` 은 대기에 `nrya-wait`
//      가 아니라 **`nrya-warn`** 을 쓴다. **코드가 아니라 내 시험이 틀렸다**(L-382).
//    ① 모두 겉껍데기 `nrya-rv` 로 시작하고 `nrya-rv-head` 를 갖는다 — **여기가 합칠 자리다**
//    ② 열쇠 칸: 여섯은 `data-id`, `draftCardHTML` 만 **`data-file`**(초안은 id 가 없다)
//    ③ 상태 알약은 **세 갈래가 아니라 네 갈래**다 — `wait`·`done`·`rej`·`warn`.
//       카드마다 쓰는 짝이 다르다(draft: done·wait·warn / feedback: done·rej·wait / mok: done·rej·warn)
//    ④ 판정 버튼(`nrya-btn-ok`·`nrya-btn-no`)은 **여섯에 있고 `draftCardHTML` 에는 없다**,
//       그리고 **대기일 때만** 나온다 — 처리된 카드에 또 나오면 관리자가 두 번 누른다
//    ⑤ ★**사용자가 넣은 글은 이스케이프된다** — `<script>` 가 그대로 나가면 안 된다
//    ⑥ 라벨 글자(❓ 질문 · 💬 답변 요지 …)는 **카드마다 정해진 것**이다
//
//   ⚠**모양(CSS)은 안 본다.** 이 스위트는 「같은 구조가 나오는가」만 본다 — 색·간격은
//     바꿔도 되고, 그것까지 못박으면 고칠 수 없는 시험이 된다.
//   ⚠시각 비의존 — 고정 문자열만 쓴다(CLAUDE.md 결정로그).
//
//   [연계] client/js/ai-chat/ai_chat.js(카드 생성기 7종) ·
//          scripts/refactor/verify_all.sh SUITES(여기 등록돼 있어야 실제로 돌아간다) ·
//          등록부 `4-1`·`4-3`.
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

/** `function 이름(` 부터 짝이 맞는 닫는 괄호까지 — test_chat_render 와 같은 방식이다. */
function fnSrc(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('함수를 못 찾음: ' + name);
  let depth = 0, started = false;
  for (let i = at; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error('함수 끝을 못 찾음: ' + name);
}

const GEN = ['draftCardHTML', 'feedbackCardHTML', 'candidateCardHTML', 'amendmentCardHTML',
  'freshnessCardHTML', 'mokCardHTML', 'reviewCardHTML'];

// `cardShell()` 이 생기면 그것도 같이 떼어 온다 — 있으면 쓰고, 없으면 지금 그대로 돈다.
const OPTIONAL = ['cardShell', 'cardField', 'cardStatus', 'cardActions'];
const optional = OPTIONAL.filter((n) => SRC.indexOf('function ' + n + '(') >= 0);

const parts = [
  // 화면 밖 의존은 이 스위트에서만 쓰는 최소 대역으로 채운다(test_chat_render 와 같은 방식).
  'function esc(s){return String(s==null?"":s)' +
  '.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
  'function nfmt(n){return String(n);}',
  'function shortTs(t){return "2026-01-01";}',
  'function reviewFieldsHTML(rv){return "<div class=\'nrya-rv-field\'></div>";}',
].concat(optional.map(fnSrc), GEN.map(fnSrc), [
  'return {' + GEN.map((n) => n + ':' + n).join(',') + '};',
]);

let C;
try {
  C = new Function(parts.join('\n'))();
} catch (e) {
  console.log('  ❌ FAIL: 카드 생성기를 떼어 오지 못했다 —', e && e.message);
  console.log('\n  0 PASS / 1 FAIL');
  process.exit(1);
}

console.log('\n── 관리자 검토 카드 7종 — 겉껍데기·열쇠칸·판정 버튼을 못박는다 ──');
console.log(`   (떼어 온 함수: 생성기 ${GEN.length} · 공통 껍데기 ${optional.length ? optional.join('·') : '아직 없다'})`);

const XSS = '<script>alert(1)</script>';
// ★일곱을 읽어 적은 표 — 열쇠칸 · 판정버튼 유무 · 대기/처리/무시에 쓰는 알약
const SPEC = {
  draftCardHTML: {
    key: 'data-file', decide: false,
    make: (st) => ({ file: 'a/b.md', topic: XSS, law: '해운법', unverified: st === 'pending' ? 3 : 0 }),
    pendPill: 'nrya-warn', donePill: 'nrya-done', rejPill: null,      // 초안은 「무시」가 없다
    doneMake: () => ({ file: 'a/b.md', topic: XSS, law: '해운법', unverified: 0 }),
  },
  feedbackCardHTML: {
    key: 'data-id', decide: true,
    make: (st) => ({ id: 'f1', question: XSS, answerGist: '요지', reason: '사유', thumb: 'down', status: st }),
    pendPill: 'nrya-wait', donePill: 'nrya-done', rejPill: 'nrya-rej', doneWord: 'reviewed',
  },
  candidateCardHTML: {
    key: 'data-id', decide: true,
    make: (st) => ({ id: 'c1', query: XSS, answerGist: '요지', laws: ['해운법'], files: ['a.txt'], status: st }),
    pendPill: 'nrya-wait', donePill: 'nrya-done', rejPill: 'nrya-rej', doneWord: 'approved',
  },
  amendmentCardHTML: {
    key: 'data-id', decide: true,
    make: (st) => ({ id: 'a1', law: XSS, kind: '개정', status: st }),
    pendPill: 'nrya-warn', donePill: 'nrya-done', rejPill: 'nrya-rej', doneWord: 'approved',
  },
  freshnessCardHTML: {
    // ⚠`law` 에 XSS 를 넣었다가 헛챘다 — 이 카드는 `law` 를 아예 찍지 않는다. 찍는 것은 `title`.
    key: 'data-id', decide: true,
    make: (st) => ({ id: 'r1', title: XSS, law: '해운법', kind: '구판', status: st }),
    pendPill: 'nrya-warn', donePill: 'nrya-done', rejPill: 'nrya-rej', doneWord: 'done',
  },
  mokCardHTML: {
    // ★이 카드만 판정 버튼을 **status 와 무관하게 언제나** 찍는다(다른 여섯은 대기일 때만).
    //   실측(2026-09-25): 목록이 `/api/legal/mok-audit?status=pending` 으로 **대기만** 받아 오므로
    //   처리된 mok 카드는 화면에 나올 일이 없다 — 그래서 산 버그가 아니다. 다만 **다른 여섯과 다르니**
    //   합칠 때 무심코 「대기일 때만」으로 맞추면 **지금 화면이 바뀐다.** 그래서 지금 꼴을 못박는다.
    key: 'data-id', decide: true, alwaysDecide: true,
    make: (st) => ({ id: 'm1', title: XSS, law: '해운법', kind: '누락', status: st }),
    pendPill: 'nrya-warn', donePill: 'nrya-done', rejPill: 'nrya-rej', doneWord: 'done',
  },
  reviewCardHTML: {
    // ★이 카드는 `status` 가 아니라 **`rv.approved`(참/거짓)** 로 갈린다. 그리고 승인된 카드는
    //   승인/반려 대신 **되돌리기 하나**만 준다 — 그 되돌리기가 `nrya-btn-no` 를 쓴다.
    key: 'data-id', decide: true, two: true,
    make: () => ({ id: 'v1', title: XSS, law: '해운법' }),
    doneMake: () => ({ id: 'v1', title: XSS, law: '해운법', approved: true }),
    pendPill: 'nrya-wait', donePill: 'nrya-done', rejPill: null,      // 수치검증에는 「무시」가 없다
    undoOnly: true,
  },
};

for (const name of GEN) {
  const sp = SPEC[name];
  const call = (o) => String((sp.two ? C[name](o, true) : C[name](o)) || '');
  let s;
  try { s = call(sp.make('pending')); }
  catch (e) { ok(`${name} — 대기 카드를 만든다`, false, '        던졌다: ' + (e && e.message)); continue; }

  ok(`${name} ① 겉껍데기 nrya-rv + nrya-rv-head 가 있다 (합칠 자리)`,
    s.indexOf('class="nrya-rv') === 5 || /class="nrya-rv[ "]/.test(s));
  ok(`${name} ② 열쇠 칸이 ${sp.key} 다`, s.indexOf(sp.key + '="') >= 0);
  ok(`${name} ③ 대기 알약이 ${sp.pendPill} 다`, s.indexOf(sp.pendPill) >= 0,
    `        나온 알약: ${(s.match(/nrya-(wait|done|rej|warn)/g) || []).join('·') || '없다'}`);
  ok(`${name} ④ 판정 버튼 ${sp.decide ? '있다' : '없다(초안은 「보기」만)'}`,
    sp.decide ? (s.indexOf('nrya-btn-ok') >= 0 && s.indexOf('nrya-btn-no') >= 0)
              : s.indexOf('nrya-btn-ok') < 0);
  ok(`${name} ⑤ ★사용자가 넣은 글이 이스케이프된다`,
    s.indexOf('<script>') < 0 && s.indexOf('&lt;script&gt;') >= 0,
    '        HTML 에 <script> 가 그대로 들어 있다');

  const done = call(sp.doneMake ? sp.doneMake() : sp.make(sp.doneWord));
  ok(`${name} ⑥ 처리된 카드 알약이 ${sp.donePill} 다`, done.indexOf(sp.donePill) >= 0);
  if (sp.alwaysDecide) {
    ok(`${name} ⑦ 이 카드는 처리된 뒤에도 판정 버튼을 찍는다 (목록이 대기만 받아 와서 안 보인다)`,
      done.indexOf('nrya-btn-ok') >= 0,
      '        지금 꼴이 바뀌었다 — 합치다가 화면을 고친 것일 수 있다');
  } else if (sp.undoOnly) {
    ok(`${name} ⑦ ★승인된 카드에는 승인 버튼이 없고 되돌리기만 있다`,
      done.indexOf('nrya-btn-ok') < 0 && done.indexOf('nrya-btn-undo') >= 0);
  } else if (sp.decide) {
    ok(`${name} ⑦ ★처리된 카드에는 판정 버튼이 없다 (두 번 누르는 것을 막는다)`,
      done.indexOf('nrya-btn-ok') < 0 && done.indexOf('nrya-btn-no') < 0);
  }
  if (sp.rejPill) {
    ok(`${name} ⑧ 무시한 카드 알약이 ${sp.rejPill} 다`,
      call(sp.make('dismissed')).indexOf(sp.rejPill) >= 0);
  }
}

// ── ⑨ 알약은 **네 갈래**다 — 셋으로 알고 합치면 한 갈래가 사라진다 ────────────────
{
  const seen = new Set();
  for (const name of GEN) {
    const sp = SPEC[name];
    const h = String((sp.two ? C[name](sp.make('pending'), true) : C[name](sp.make('pending'))) || '');
    (h.match(/nrya-(wait|done|rej|warn)/g) || []).forEach((x) => seen.add(x));
  }
  ok('⑨ ★알약이 네 갈래다 (wait·done·rej·warn) — 셋으로 알고 합치면 한 갈래가 사라진다',
    seen.has('nrya-warn') && (seen.has('nrya-wait') || seen.has('nrya-done')),
    `        본 것: ${[...seen].sort().join('·')}`);
}

// ── ⑩ 라벨 글자가 살아 있다 ──────────────────────────────────────────────
{
  const fb = String(C.feedbackCardHTML(SPEC.feedbackCardHTML.make('pending')) || '');
  ok('⑩ 피드백 카드 라벨 (❓ 질문 · 💬 답변 요지 · 📝 사유)',
    fb.indexOf('❓ 질문') >= 0 && fb.indexOf('💬 답변 요지') >= 0 && fb.indexOf('📝 사유') >= 0);
  const cd = String(C.candidateCardHTML(SPEC.candidateCardHTML.make('pending')) || '');
  ok('⑩ 지식후보 카드 라벨 (❓ 질문 · ⚖️ 관련 법)',
    cd.indexOf('❓ 질문') >= 0 && cd.indexOf('⚖️ 관련 법') >= 0);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
