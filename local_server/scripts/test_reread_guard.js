/**
 * test_reread_guard.js — ★고친 canonical 은 다른 에이전트가 읽어야 한다 (1단계 1-2·1-3 · 사장님 결정 D2·D3, 2026-10-08)
 *
 * [왜 있나] canonical 쪽을 고칠 때 아무도 다시 안 읽었다(1,092쪽에 다른 눈의 읽기 기록이 없다).
 *   이제 판정 장부(`_dashboard/reread/verdicts.jsonl`)와 V5-57(`reread_guard.js`)이 막는다.
 *   이 스위트는 그 판단의 뼈대가 바뀌지 않게 고정한다.
 *
 * [무엇을 고정하나]
 *  R1 본문해시 — frontmatter · 「## 변경 이력」 · 상태 배너 머리 · 공백은 해시에 안 들어간다 / 글이 바뀌면 해시가 바뀐다
 *  R2 형식만 바뀐 것 — 링크 대상 · 절 제목 줄만 바뀌면 면제, 글자가 바뀌면 면제 아님
 *  R3 회차와 상한 — 마지막 PASS 뒤 HOLD 가 이어진 수가 회차 · 4번이면 상한
 *  R4 장부에 적기 — 읽은이 없이 PASS 못 적음 · 읽은이 = 고친이면 거부 · 적으면 지금 본문의 해시가 들어간다
 *  R5 게이트가 V5-57 로 verify_all 에 걸려 있다(정적)
 *  R7 개정 반영 지시문(legal_wiki_brief.js)에 다른 에이전트 읽기 단계가 있다(정적)
 *  R6 승격 도구(promote_page.py)는 장부의 PASS · 범위 전체 · 본문해시 일치일 때만 올린다(--dry)
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → knowledge/legal/_dashboard/loop/reread_ledger.js · reread_guard.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reread-'));
process.env.REREAD_LEDGER = path.join(TMP, 'verdicts.jsonl');
const LEDGER_JS = path.join(__dirname, '../knowledge/legal/_dashboard/loop/reread_ledger.js');
const L = require(LEDGER_JS);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const PAGE = [
  '---', 'status: draft', 'updated: 2026-10-01', '---',
  '# 제목', '', '> ⚠ **draft — 미승인.** 요약 문장.', '',
  '## 위반 시 처벌', '제10조를 위반하면 **1년 이하의 징역 또는 1천만원 이하의 벌금**([[concepts/A__B]]).', '',
  '## 변경 이력', '| 날짜 | 내용 |', '|---|---|', '| 2026-10-01 | 만듦 |', '',
].join('\n');

console.log('R1 본문해시');
const promoted = PAGE.replace('status: draft', 'status: canonical')
  .replace('> ⚠ **draft — 미승인.** 요약 문장.', '> ✅ **canonical — 2026-10-08 `_SCHEMA.md` §5-D ⓑ 재점검 1차·2차 통과(3-92).** 요약 문장.')
  .replace('| 2026-10-01 | 만듦 |', '| 2026-10-01 | 만듦 |\n| 2026-10-08 | 승급 |');
ok('승격(frontmatter·배너 머리·이력 줄)만으로는 해시가 그대로', L.bodyHash(PAGE) === L.bodyHash(promoted));
ok('공백만 다르면 해시가 그대로', L.bodyHash(PAGE) === L.bodyHash(PAGE.replace('1년 이하의', '1년  이하의 ')));
ok('글이 바뀌면 해시가 바뀐다(이하→미만)', L.bodyHash(PAGE) !== L.bodyHash(PAGE.replace('1년 이하의', '1년 미만의')));
ok('「정정 중」 꼬리도 배너 머리와 함께 빠진다',
  L.bodyHash(PAGE.replace('> ⚠ **draft — 미승인.** 요약 문장.', '> ⚠ **draft** — 원문 대조 정정 중(3-91). 요약 문장.')) ===
  L.bodyHash(promoted));

console.log('R2 형식만 바뀐 것');
ok('링크 대상만 바뀜 → 면제', L.formatOnly(PAGE, PAGE.replace('[[concepts/A__B]]', '[[concepts/A__C]]')));
ok('절 제목만 바뀜 → 면제', L.formatOnly(PAGE, PAGE.replace('## 위반 시 처벌', '## 벌칙')));
ok('금액이 바뀜 → 면제 아님', !L.formatOnly(PAGE, PAGE.replace('1천만원', '2천만원')));
ok('링크 밖 글자가 바뀜 → 면제 아님', !L.formatOnly(PAGE, PAGE.replace('위반하면', '위반한 경우')));

console.log('R3 회차와 상한');
const K = 'concepts/T.md';
const row = (v, i) => ({ '시각': `2026-10-0${i}T00:00:00Z`, '쪽': K, '판정': v });
ok('기록 없음 → 회차 0', L.pageState(K, []).holdStreak === 0);
ok('HOLD 2번 → 2', L.pageState(K, [row('HOLD', 1), row('HOLD', 2)]).holdStreak === 2);
ok('PASS 뒤 HOLD 1번 → 1', L.pageState(K, [row('HOLD', 1), row('PASS', 2), row('HOLD', 3)]).holdStreak === 1);
ok('HOLD 4번 → 상한', L.pageState(K, [1, 2, 3, 4].map(i => row('HOLD', i))).overCap === true);
ok('HOLD 3번 → 상한 아님', L.pageState(K, [1, 2, 3].map(i => row('HOLD', i))).overCap === false);
ok('pageKey 는 저장소 경로를 위키 기준으로', L.pageKey('local_server/knowledge/legal/wiki/concepts/X__Y.md') === 'concepts/X__Y.md');

console.log('R4 장부에 적기(실제 CLI 로)');
const WPAGE = 'concepts/어촌ㆍ어항법__한국어촌어항공단.md';
const env = Object.assign({}, process.env, { REREAD_LEDGER: process.env.REREAD_LEDGER });
function cli(args) {
  try { return { code: 0, out: execFileSync('node', [LEDGER_JS, ...args], { env, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stderr || '') + String(e.stdout || '') }; }
}
ok('읽은이 없이 PASS → 거부', cli(['add', '--page', WPAGE, '--verdict', 'PASS']).code === 2);
ok('읽은이 = 고친이 → 거부', cli(['add', '--page', WPAGE, '--verdict', 'PASS', '--reader', 'a1', '--fixer', 'a1']).code === 2);
ok('이상한 판정 → 거부', cli(['add', '--page', WPAGE, '--verdict', 'OK', '--reader', 'a1']).code === 2);
const r = cli(['add', '--page', WPAGE, '--verdict', 'HOLD', '--reader', 'a2', '--fixer', 'a1']);
const rows = L.readLedger();
ok('HOLD 를 적으면 1회차로 들어간다', r.code === 0 && rows.length === 1 && rows[0]['회차'] === 1, r.out);
const real = fs.readFileSync(path.join(__dirname, '../knowledge/legal/wiki', WPAGE), 'utf8');
ok('장부의 본문해시 = 지금 본문의 해시', rows[0] && rows[0]['본문해시'] === L.bodyHash(real));
cli(['add', '--page', WPAGE, '--verdict', 'PASS', '--reader', 'a3', '--fixer', 'a1']);
ok('PASS 뒤에는 회차가 0 으로', L.pageState(WPAGE).holdStreak === 0 && L.pageState(WPAGE).last['판정'] === 'PASS');

console.log('R6 승격 도구는 장부의 PASS(전체·해시 일치)가 있어야 올린다(시험 모드 --dry)');
const DRAFT = 'concepts/내수면어업법__공익어업제한취소.md';
const PP = path.join(__dirname, '../knowledge/legal/_dashboard/loop/promote_page.py');
const SPEC = path.join(TMP, 'spec.json');
fs.writeFileSync(SPEC, JSON.stringify({ '내수면어업법__공익어업제한취소': ['raw/05_수산어업/내수면어업법', '조문', '없음'] }));
function pp() {
  try { return { code: 0, out: execFileSync('python3', [PP, SPEC, '--round', 'T', '--dry'], { env, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') }; }
}
const draftNow = fs.readFileSync(path.join(__dirname, '../knowledge/legal/wiki', DRAFT), 'utf8');
if (!/^status: draft$/m.test(draftNow)) { console.log('  ⏭️  시험 쪽이 이미 draft 가 아니다 — R6 건너뜀'); }
else {
  ok('장부 기록 없음 → 안 올림', pp().code === 1);
  cli(['add', '--page', DRAFT, '--verdict', 'HOLD', '--reader', 'b2', '--fixer', 'b1']);
  ok('마지막이 HOLD → 안 올림', pp().code === 1);
  cli(['add', '--page', DRAFT, '--verdict', 'PASS', '--reader', 'b3', '--fixer', 'b1', '--scope', '변경분']);
  ok('PASS 지만 범위가 변경분 → 안 올림(승격은 전체를 읽어야)', pp().code === 1);
  cli(['add', '--page', DRAFT, '--verdict', 'PASS', '--reader', 'b4', '--fixer', 'b1']);
  const r6 = pp();
  ok('PASS · 전체 · 해시 일치 → 올림(시험이라 파일은 안 바뀜)', r6.code === 0 && /올림/.test(r6.out), r6.out);
  ok('시험 모드는 파일을 바꾸지 않는다', fs.readFileSync(path.join(__dirname, '../knowledge/legal/wiki', DRAFT), 'utf8') === draftNow);
}

console.log('R5 verify_all 에 걸려 있다');
const VA = fs.readFileSync(path.join(__dirname, '../../scripts/refactor/verify_all.sh'), 'utf8');
ok('V5-57 이 reread_guard.js --gate 를 부른다', /reread_guard\.js --gate[^\n]*V5-57/.test(VA));
ok('이 스위트가 SUITES 에 있다', /\btest_reread_guard\b/.test(VA));

console.log('R7 개정 반영 지시문에 다른 에이전트 읽기 단계가 있다(1-4)');
const WB = fs.readFileSync(path.join(__dirname, '../services/legal_wiki_brief.js'), 'utf8');
ok('단건·일괄 두 지시문 모두 rereadStepLines() 를 넣는다', (WB.match(/for \(const ln of rereadStepLines\(\)\) L\.push\(ln\);/g) || []).length === 2);
ok('그 단계가 장부 명령(reread_ledger.js add)을 알려 준다', /reread_ledger\.js add --page/.test(WB));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
