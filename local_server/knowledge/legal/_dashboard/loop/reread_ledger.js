/**
 * ============================================================================
 * 파일명: _dashboard/loop/reread_ledger.js
 * 역할: **다른 에이전트의 읽기(2차) 판정 장부** — 누가 · 어느 쪽을 · 몇 번째로 읽어 · 무엇을 찾았나.
 *       `reread_guard.js`(V5-57)가 이 장부로 「고친 canonical 을 다른 눈이 읽었나」를 막는다.
 * ============================================================================
 *
 * [왜 있나 — 1단계 1-3, 2026-10-08 사장님 결정 D2·D3]
 * D2 「canonical 을 고치면 고친 이가 아닌 에이전트의 읽기를 의무로」 · D3 「읽기는 최대 4번,
 * 넘으면 쪽을 나눠 다시 → 그래도 안 되면 draft + 사람 판단 목록」.
 * 지금까지 2차 결과는 「변경 이력」 한 줄 글로만 남아서 ①몇 번째 읽기인지 ②읽은 뒤 본문이 또
 * 바뀌었는지를 기계가 알 수 없었다(3-91·3-92 에서 회차는 사람이 세었다). 그래서 장부를 따로 둔다.
 *
 * [한 줄 = 한 번의 읽기] `_dashboard/reread/verdicts.jsonl`
 *   { 시각, 쪽, 회차, 읽은이, 고친이, 판정: PASS|HOLD|대기, 범위: 전체|변경분, 본문해시, 지적: [{등급:A|B|C, 확인:true|false, 내용}], 메모 }
 *   · 본문해시 — frontmatter · 「## 변경 이력」 칸 · 상태 배너의 굵은 머리를 뺀 본문(아래 bodyHash).
 *     **읽은 바로 그 본문**이라는 증거다. 읽은 뒤 한 글자라도 바뀌면 해시가 달라져 게이트가 다시 읽기를 요구한다.
 *   · 대기 — 급한 개정을 먼저 반영하고 읽기를 뒤로 미룬 쪽(D2 예외). 14일 안에 PASS 가 와야 한다.
 *   · 지적.확인 — 그 지적을 **원문을 열어 맞다고 확인했는가**(D3: 확인 안 된 지적은 오류로 세지 않는다).
 *
 * [쓰는 법]
 *   node reread_ledger.js add --page concepts/X.md --reader <읽은이> --verdict PASS|HOLD|대기
 *        [--fixer <고친이>] [--scope 전체|변경분] [--findings 지적.json] [--note 메모]
 *   node reread_ledger.js status [--page concepts/X.md]     ← 회차 · 마지막 판정 · 해시 일치 · 상한
 *   node reread_ledger.js hash concepts/X.md                 ← 지금 본문해시
 * [연계] → reread_guard.js(V5-57) · _SCHEMA.md §5-D ⓖ ⓗ · verify_all.sh
 * [로드 순서] 번들 없음(점검 스크립트 · 모듈로도 쓴다).
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEGAL = path.resolve(__dirname, '..', '..');
const WIKI = path.join(LEGAL, 'wiki');
// 시험(test_reread_guard)은 REREAD_LEDGER 로 임시 장부를 쓴다 — 진짜 장부를 건드리지 않는다.
const LEDGER = process.env.REREAD_LEDGER || path.join(LEGAL, '_dashboard', 'reread', 'verdicts.jsonl');
const CAP = 4;            // D3 — 읽기 상한
const PENDING_DAYS = 14;  // D2 예외 — 「대기」 가 버틸 수 있는 날

/** frontmatter · 「## 변경 이력」 칸 · 상태 배너의 굵은 머리를 빼고 공백을 고른 본문.
 *  배너 머리(`> ✅ **canonical — …**` / `> ⚠ **draft …**`)는 승격 도구가 바꾸는 자리라 뺀다 —
 *  안 빼면 「읽고 PASS → 승격」 만으로 해시가 달라져 방금 읽은 쪽을 또 읽으라 한다. */
function normBody(text) {
  let b = String(text || '').replace(/^---\n[\s\S]*?\n---\n/, '');
  b = b.replace(/(^|\n)## 변경 이력[^\n]*\n[\s\S]*?(?=\n## |$)/, '$1');
  b = b.replace(/^>\s*(?:✅|⚠️?)\s*\*\*(?:canonical|draft)[^*\n]*\*\*(?:\s*—\s*원문 대조 정정 중\([^)]*\)\.)?/gm, '>');
  return b.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
function bodyHash(text) { return crypto.createHash('sha1').update(normBody(text)).digest('hex').slice(0, 16); }
/** 위키 링크 대상만 바뀐 변경인가 — `[[…]]` 를 다 지운 뒤 같으면 그렇다(글자 내용은 그대로). */
function linkOnly(a, b) {
  const strip = t => normBody(t).replace(/\[\[[^\]]*\]\]/g, '[[]]');
  return strip(a) === strip(b);
}
/** 형식만 바뀌었나 — 링크 대상(`[[…]]`)과 절 제목 줄(`#`)을 지운 뒤 같으면 그렇다. */
function formatOnly(a, b) {
  const strip = t => normBody(t).replace(/\[\[[^\]]*\]\]/g, '[[]]').split('\n').filter(l => !/^#/.test(l)).join('\n');
  return strip(a) === strip(b);
}
function pageKey(p) {
  let k = String(p).replace(/\\/g, '/');
  k = k.replace(/^.*?local_server\/knowledge\/legal\/wiki\//, '').replace(/^wiki\//, '');
  return k.endsWith('.md') ? k : k + '.md';
}
function readLedger() {
  let t = '';
  try { t = fs.readFileSync(LEDGER, 'utf8'); } catch (_) { return []; }
  return t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}
/** 쪽 하나의 상태 — 마지막 PASS 뒤로 이어진 HOLD 수가 「회차」 다. */
function pageState(key, rows) {
  const mine = (rows || readLedger()).filter(r => r['쪽'] === key);
  let streak = 0;
  for (let i = mine.length - 1; i >= 0 && mine[i]['판정'] === 'HOLD'; i--) streak++;
  return { rows: mine, last: mine[mine.length - 1] || null, holdStreak: streak, overCap: streak >= CAP };
}
function daysSince(iso) { return (Date.now() - Date.parse(iso)) / 86400000; }

module.exports = { LEDGER, CAP, PENDING_DAYS, normBody, bodyHash, linkOnly, formatOnly, pageKey, readLedger, pageState, daysSince };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
  const cmd = argv[0];
  if (cmd === 'hash') {
    const key = pageKey(argv[1]);
    console.log(bodyHash(fs.readFileSync(path.join(WIKI, key), 'utf8')), key);
  } else if (cmd === 'add') {
    const key = pageKey(arg('--page'));
    const verdict = arg('--verdict');
    const reader = arg('--reader');
    const fixer = arg('--fixer');
    if (!['PASS', 'HOLD', '대기'].includes(verdict)) { console.error('--verdict 는 PASS|HOLD|대기'); process.exit(2); }
    if (verdict !== '대기' && !reader) { console.error('--reader 가 없다 — 누가 읽었는지 없이는 적지 않는다'); process.exit(2); }
    if (reader && fixer && reader === fixer) { console.error('읽은이와 고친이가 같다 — 다른 에이전트가 읽어야 한다(§5-D ⓖ)'); process.exit(2); }
    const text = fs.readFileSync(path.join(WIKI, key), 'utf8');
    const findings = arg('--findings') ? JSON.parse(fs.readFileSync(arg('--findings'), 'utf8')) : [];
    const st = pageState(key);
    const row = {
      '시각': new Date().toISOString(), '쪽': key, '회차': st.holdStreak + 1, '읽은이': reader || '', '고친이': fixer || '',
      '판정': verdict, '범위': arg('--scope') || '전체', '본문해시': bodyHash(text), '지적': findings, '메모': arg('--note') || '',
    };
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n');
    const after = pageState(key);
    console.log(`적음: ${key} · ${row['회차']}회차 · ${verdict}` + (after.overCap ? ` ⚠상한 ${CAP}번 — 쪽을 나눠 다시 읽히거나 draft + 사람 판단 목록(§5-D ⓗ)` : ''));
  } else if (cmd === 'status') {
    const rows = readLedger();
    const keys = arg('--page') ? [pageKey(arg('--page'))] : [...new Set(rows.map(r => r['쪽']))];
    for (const k of keys) {
      const s = pageState(k, rows);
      let now = '';
      try { now = bodyHash(fs.readFileSync(path.join(WIKI, k), 'utf8')); } catch (_) { now = '(파일 없음)'; }
      const l = s.last || {};
      console.log(`${k} · 읽기 ${s.rows.length}번 · 마지막 ${l['판정'] || '-'}(${l['회차'] || '-'}회차) · 해시 ${l['본문해시'] === now ? '일치' : '다름'}` +
                  (s.overCap ? ` · ⚠상한 ${CAP}` : ''));
    }
  } else {
    console.log('쓰는 법: add | status | hash — 파일 머리말 참고');
  }
}
