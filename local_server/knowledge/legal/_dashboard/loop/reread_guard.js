/**
 * ============================================================================
 * 파일명: _dashboard/loop/reread_guard.js
 * 역할: (V5-57) **canonical 쪽의 본문이 바뀌었으면, 바뀐 바로 그 본문을 고친 이가 아닌 에이전트가
 *       읽고 PASS 했는가**를 막는다 — 사장님 결정 D2(2026-10-08) · `_SCHEMA.md` §5-D ⓖ ⓗ.
 * ============================================================================
 *
 * [왜 있나]
 * `promote_guard.js`(V5-13)는 **draft → canonical 로 올린 순간**만 본다. 이미 canonical 인 쪽을
 * 개정 반영·정정으로 고칠 때는 아무것도 안 봤다 — 1,092쪽이 다른 눈의 읽기 기록 없이 canonical 인 까닭이다
 * (해소 계획 2026-10-08). 3-90~3-92 에서 다른 에이전트의 읽기는 **기계 대조를 다 통과한 쪽에서도**
 * 조건 문구 누락 · 다른 조에 붙은 의무 · 원문에 없는 전화번호를 찾았다. 고칠 때마다 그 읽기를 거치게 한다.
 *
 * [무엇을 보나 — 이번 가지에서 바뀐 위키 쪽(기준: origin/main 과의 merge-base)]
 *   지금 status 가 canonical 이고 본문이 바뀐 쪽 → 장부(`_dashboard/reread/verdicts.jsonl`) 마지막 줄이
 *     ① PASS 이고 본문해시가 **지금 본문과 같거나**,
 *     ② 「대기」(급한 개정 예외)이고 해시가 같고 14일이 안 지났어야 한다(경고로 보여 준다).
 *   본문 비교는 frontmatter · 「## 변경 이력」 · 상태 배너 머리를 뺀다(reread_ledger.normBody).
 *   **형식만 바뀐 것은 면제** — 위키 링크 대상(`[[…]]`)이나 절 제목 줄(`#`)만 바뀌고 글은 그대로인 경우.
 *   그리고 가지와 무관하게(장부 전체):
 *     ③ 「대기」 가 14일을 넘긴 쪽 → 실패
 *     ④ HOLD 가 4번 이어진(상한) 쪽이 아직 canonical → 실패(쪽을 나눠 다시 읽히거나 draft + 사람 판단 목록)
 *
 * [쓰는 법]  node reread_guard.js [--gate] [--base <ref>]
 * [한계] 장부에 「읽었다」고 거짓으로 적으면 통과한다 — 그래도 **누가 어떤 본문을 읽었는지**가 남아 추적된다.
 * [연계] reread_ledger.js · promote_guard.js(V5-13, 승격 순간의 기록줄) · verify_all.sh V5-57
 * [로드 순서] 번들 없음(점검 스크립트).
 * ============================================================================
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./reread_ledger.js');

const REPO = path.resolve(__dirname, '../../../../..');
const WIKI = 'local_server/knowledge/legal/wiki';
const argv = process.argv.slice(2);
const argOf = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
function sh(cmd) { return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
function statusOf(t) { const m = /^---\n([\s\S]*?)\n---/.exec(t || ''); if (!m) return ''; const s = /^status:\s*(\S+)/m.exec(m[1]); return s ? s[1] : ''; }
function baseRef() {
  const given = argOf('--base');
  if (given) return given;
  for (const r of ['origin/main', 'origin/master']) {
    try { return sh(`git merge-base HEAD ${r}`).trim(); } catch (_) { /* 다음 */ }
  }
  return 'HEAD';
}

const BASE = baseRef();
let changed = [];
try {
  // ⚠`-z` 는 `--` 앞에 — 한글 경로가 이스케이프되지 않게(promote_guard.js 와 같은 함정).
  changed = sh(`git diff --name-only -z ${BASE} -- ${WIKI}`).split('\0').filter(Boolean)
    .filter(f => f.endsWith('.md') && !f.endsWith('_backbone.md'));
} catch (e) {
  console.log('  ⏭️  git diff 를 못 했다 — 건너뛴다:', e.message.slice(0, 60));
  process.exit(0);
}

const rows = L.readLedger();
const need = [], ok = [], warn = [], bad = [];
let exempt = 0;
for (const f of changed) {
  let now = '';
  try { now = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (_) { continue; }   // 지워진 파일
  if (statusOf(now) !== 'canonical') continue;
  let before = '';
  try { before = sh(`git show ${BASE}:'${f.replace(/'/g, `'\\''`)}'`); } catch (_) { before = ''; }
  if (before && L.normBody(before) === L.normBody(now)) continue;          // 본문은 그대로(이력·frontmatter·배너만)
  if (before && statusOf(before) === 'canonical' && L.formatOnly(before, now)) { exempt++; continue; }
  const key = L.pageKey(f);
  need.push(key);
  const st = L.pageState(key, rows);
  const h = L.bodyHash(now);
  const last = st.last;
  if (last && last['판정'] === 'PASS' && last['본문해시'] === h) ok.push(key);
  else if (last && last['판정'] === '대기' && last['본문해시'] === h && L.daysSince(last['시각']) <= L.PENDING_DAYS) warn.push(key);
  else bad.push({ key, why: !last ? '장부에 읽기 기록이 없다'
    : last['본문해시'] !== h ? `마지막 기록(${last['판정']})의 본문해시가 지금 본문과 다르다 — 읽은 뒤에 또 고쳤다`
    : `마지막 판정이 ${last['판정']} 이다(${last['회차']}회차)` });
}

// ③④ — 장부 전체
const lastBy = new Map();
for (const r of rows) lastBy.set(r['쪽'], r);
const stale = [], capped = [];
for (const [key, r] of lastBy) {
  if (r['판정'] === '대기' && L.daysSince(r['시각']) > L.PENDING_DAYS) stale.push(key);
  if (L.pageState(key, rows).overCap) {
    let t = '';
    try { t = fs.readFileSync(path.join(REPO, WIKI, key), 'utf8'); } catch (_) { continue; }
    if (statusOf(t) === 'canonical') capped.push(key);
  }
}

console.log(`기준 ${BASE.slice(0, 12)} 대비 위키 변경 ${changed.length}쪽 · 그중 canonical 본문이 바뀐 쪽 ${need.length}쪽` +
            (exempt ? ` (형식만 바뀐 ${exempt}쪽 면제)` : '') + ` · 장부 ${rows.length}줄`);
if (ok.length) console.log(`  ✅ 바뀐 본문 그대로 다른 눈이 PASS: ${ok.length}쪽`);
for (const k of warn) console.log(`  ⚠ 「대기」(급한 개정 예외) — ${L.PENDING_DAYS}일 안에 읽어야 한다: ${k}`);
for (const x of bad) console.log(`  ❌ ${x.key} — ${x.why}`);
for (const k of stale) console.log(`  ❌ 「대기」 ${L.PENDING_DAYS}일 넘김: ${k}`);
for (const k of capped) console.log(`  ❌ HOLD ${L.CAP}번(상한)인데 아직 canonical: ${k} — 쪽을 나눠 다시 읽히거나 draft + 사람 판단 목록(§5-D ⓗ)`);
const fail = bad.length + stale.length + capped.length;
if (!fail) console.log('  ✅ V5-57 고친 canonical 은 모두 다른 눈의 읽기를 거쳤다');
else {
  console.log('\n  고치는 법: 다른 에이전트에게 그 쪽을 읽혀 `node reread_ledger.js add --page … --reader … --verdict PASS` 로 적는다.');
  console.log('            급하면 `--verdict 대기` 로 적고 14일 안에 읽힌다(§5-D ⓖ).');
}
if (argv.includes('--gate') && fail) process.exit(1);
