/**
 * ============================================================================
 * 파일명: scripts/test_amend_applied.js
 * 역할: 개정검토 「위키 반영 완료」 장부가 제대로 읽히고 쓰이는지, 그리고 「📋 승인분 전체 지시문」이
 *       장부에 적힌 건을 **빼고**, 뺐다는 사실을 **적는지** 검사한다.
 * ============================================================================
 *
 * [왜 있나 — 2026-11-07 사장님 「승인분 지시문이 이미 반영한 것까지 다시 묶는 문제 고치기 … 진행하기로 해」]
 * 지시문이 승인한 **전 건**을 매번 다시 묶어 이미 반영한 162건이 다음 지시문에 그대로 또 왔다.
 * 고친 길은 셋이다 — 이 셋을 기계로 고정한다:
 *   ①서버가 장부(`_amendments/wiki_applied.jsonl`)를 읽는다 — 없거나 깨진 줄이 있어도 죽지 않는다
 *   ②지시문은 장부에 있는 건을 빼고, **뺐다고 적고**, 끝에 「장부에 적어라」 단계를 둔다
 *   ③적는 도구(`amend_applied.py`)는 덧붙이기만 하고, 같은 id 를 두 번 적지 않고, 꼴이 다른 id 는 받지 않는다
 *   ④저장소에 실린 장부 자체가 멀쩡하다(줄마다 JSON · id 꼴 · 중복 없음)
 *
 * [연계]
 * - services/legal_amendment_scanner.js → loadWikiApplied · withoutApplied
 * - services/legal_wiki_brief.js → buildBulkWikiBrief(list, today, {skippedApplied})
 * - knowledge/legal/_dashboard/loop/amend_applied.py → add · load
 * - scripts/refactor/verify_all.sh → SUITES 에 등록(등록 안 하면 아무도 안 돌린다)
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_amend_applied.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../services/legal_amendment_scanner.js');
const W = require('../services/legal_wiki_brief.js');

let pass = 0, fail = 0;
/** 한 항목을 검사하고 결과를 찍는다. @param {string} name @param {boolean} cond @param {string} [extra] */
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amend_applied_'));

// ── ① 서버가 장부를 읽는다 ──
console.log('── ① loadWikiApplied ──');
ok('장부 파일이 없으면 빈 Map(죽지 않는다)', S.loadWikiApplied(path.join(tmp, 'none.jsonl')).size === 0);
const led = path.join(tmp, 'led.jsonl');
fs.writeFileSync(led, '{"id":"chg_20260810_a5f82d","at":"2026-11-07","note":"x"}\n{깨진 줄\n\n{"id":"chg_20261028_f30670","at":"2026-11-07"}\n');
const m = S.loadWikiApplied(led);
ok('깨진 줄은 건너뛰고 나머지 둘을 읽는다', m.size === 2 && m.has('chg_20260810_a5f82d') && m.has('chg_20261028_f30670'), [...m.keys()].join(','));
ok('기록 내용(날짜·메모)이 함께 온다', (m.get('chg_20260810_a5f82d') || {}).at === '2026-11-07');

const rows = [{ id: 'chg_20260810_a5f82d' }, { id: 'chg_20261101_000aaa' }, { id: 'chg_20261028_f30670' }];
const w = S.withoutApplied(rows, m);
ok('장부에 있는 건을 빼고 없는 건만 남긴다', w.list.length === 1 && w.list[0].id === 'chg_20261101_000aaa');
ok('뺀 수를 돌려준다(뺐다고 적어야 한다)', w.skipped === 2);
ok('장부가 비면 아무것도 안 뺀다', S.withoutApplied(rows, new Map()).skipped === 0);

// ── ② 지시문 ──
console.log('── ② buildBulkWikiBrief ──');
const item = { id: 'chg_20261101_000aaa', 법령명: '항만법', layer: '법률', kind: '법률 개정', 현재: { 시행일자: '20261101', MST: '1' }, changed_articles: [] };
const r1 = W.buildBulkWikiBrief([item], '20261107', { skippedApplied: 162 });
ok('뺀 건이 있으면 「이미 위키 반영 완료로 기록된 162건은 뺐다」 를 적는다', r1.ok && /이미 위키 반영 완료로 기록된 162건은 뺐다/.test(r1.text));
ok('장부 위치를 적는다', /_amendments\/wiki_applied\.jsonl/.test(r1.text));
const r0 = W.buildBulkWikiBrief([item], '20261107');
ok('뺀 것이 없으면 그 줄을 안 적는다(옛 호출 그대로)', r0.ok && !/뺐다/.test(r0.text));
ok('끝 「해야 할 일」에 장부에 적는 단계가 있다', /amend_applied\.py --from-brief/.test(r0.text));

// ── ③ 적는 도구 ──
console.log('── ③ amend_applied.py ──');
const PY = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop', 'amend_applied.py');
/** 도구의 add() 를 임시 장부로 부른다. @returns {object} 보고 dict */
function pyAdd(ids, ledger) {
  const code = `import sys,json; sys.path.insert(0, ${JSON.stringify(path.dirname(PY))}); import amend_applied as A; ` +
    `print(json.dumps(A.add(${JSON.stringify(ids)}, '시험', path=${JSON.stringify(ledger)}, at='2026-11-07'), ensure_ascii=False))`;
  return JSON.parse(execFileSync('python3', ['-c', code], { encoding: 'utf8' }).trim().split('\n').pop());
}
const led2 = path.join(tmp, 'led2.jsonl');
fs.writeFileSync(led2, '{"id":"chg_20260810_a5f82d"}');   // 끝에 줄바꿈 없는 장부
const a1 = pyAdd(['chg_20260810_a5f82d', 'chg_20261101_000aaa', 'chg_20261101_000aaa', 'chg_bad'], led2);
ok('새 id 만 적는다(같은 id 두 번 줘도 한 번)', a1['적음'].length === 1 && a1['적음'][0] === 'chg_20261101_000aaa', JSON.stringify(a1));
ok('이미 있는 id 는 「이미있음」', a1['이미있음'].length === 1);
ok('꼴이 다른 id 는 받지 않는다', a1['꼴이다름'].length === 1 && a1['꼴이다름'][0] === 'chg_bad');
const lines2 = fs.readFileSync(led2, 'utf8').split('\n').filter(Boolean);
ok('줄바꿈 없이 끝난 장부에도 줄을 붙여 깨뜨리지 않는다', lines2.length === 2 && lines2.every((l) => { try { JSON.parse(l); return true; } catch (_) { return false; } }), lines2.join(' | '));
ok('도구가 쓴 장부를 서버가 그대로 읽는다', S.loadWikiApplied(led2).size === 2);
const a2 = pyAdd(['chg_20261101_000aaa'], led2);
ok('다시 돌려도 덧붙지 않는다', a2['적음'].length === 0 && fs.readFileSync(led2, 'utf8').split('\n').filter(Boolean).length === 2);

// ── ④ 저장소의 장부 자체 ──
console.log('── ④ 저장소 장부 ──');
const realTxt = fs.existsSync(S.WIKI_APPLIED_FILE) ? fs.readFileSync(S.WIKI_APPLIED_FILE, 'utf8') : '';
const realLines = realTxt.split('\n').filter((l) => l.trim());
const bad = [], dup = [], seen = new Set();
for (const l of realLines) {
  let o = null;
  try { o = JSON.parse(l); } catch (_) { bad.push(l.slice(0, 60)); continue; }
  if (!o || !/^chg_\d{8}_[0-9a-f]{6}$/.test(String(o.id || '')) || !o.note) { bad.push(l.slice(0, 60)); continue; }
  if (seen.has(o.id)) dup.push(o.id);
  seen.add(o.id);
}
ok('줄마다 JSON · id 꼴 · 메모(근거)가 있다', bad.length === 0, bad.slice(0, 3).join(' | '));
ok('같은 id 가 두 번 적히지 않았다', dup.length === 0, dup.slice(0, 5).join(','));
ok('서버가 읽는 수 = 줄 수', S.loadWikiApplied().size === realLines.length, `${S.loadWikiApplied().size} vs ${realLines.length}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
