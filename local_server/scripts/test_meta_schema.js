/**
 * test_meta_schema.js — 2-2 ★꼬리표(`_meta.json`) 의 **뜻과 제자리**를 고정한다.
 *
 * [왜 있나] `_SCHEMA §1` 이 요구한 8키를 다 갖춘 꼬리표는 **516개 중 0개**였다(0-3).
 *   규칙은 있는데 **코드가 안 읽으니** 죽어 있었다 — 뿌리 사슬 ①.
 *   그래서 정의를 `_meta_schema.js` 한 곳에 두고, 이 시험이 그것을 **부른다**(L-136).
 *
 * [★이 시험이 막는 가장 큰 실수]
 *   판번호로 보이는 이름이 11가지라 "하나로 합치자"가 첫 설계였다. 값을 맞대어 보니
 *   **전부 다른 값**이었다(법령ID ↔ 법령일련번호(MST) 15쌍 · 같은 값 0).
 *   **법령ID(법 자체)와 MST(그 판)는 달라야 정상이다.** 합치면 조용히 틀린다.
 *   ①이 그것을 못박는다.
 *
 * [무엇을 고정하나]
 *  ① 법령ID 와 MST 는 **다른 것**이다 — 합치는 자리가 없다
 *  ② 판번호의 제자리는 **`families.<계층>`** 안이다 (스칼라가 아니다)
 *  ③ 최상위에 흩어진 것을 **조용히 합치지 않는다** — `strays` 로 따로 알린다
 *  ④ families 와 최상위가 어긋나면 **`conflicts` 로 알린다**(감추지 않는다)
 *  ⑤ 못 읽는 꼬리표는 **0 이 아니라 「못 읽었다」**로 알린다 (G-34)
 *  ⑥ 숫자를 말할 때 **뜻과 범위**를 함께 말한다 (2-6 의 규약)
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → _dashboard/loop/_meta_schema.js (정의의 유일한 자리)
 *        → 00_WORKLIST 2-2 · 2-3(V5-18) · 0-3
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../knowledge/legal/_dashboard/loop/_meta_schema.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 임시 폴더에 꼬리표 하나를 써서 읽힌다. */
function withMeta(obj, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
  const f = path.join(dir, '_meta.json');
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  try { return fn(f, dir); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

console.log('── ① 법령ID 와 MST 는 다른 것이다 (합치지 않는다) ──');
{
  const r = withMeta({ families: { 법률: { MST: '283707', 법령ID: '001737', 파일: '법률.json' } } }, M.readMeta);
  ok('둘 다 그대로 남는다', r.families['법률'].MST === '283707' && r.families['법률'].법령ID === '001737');
  ok('값이 달라도 어긋남으로 세지 않는다', r.conflicts.length === 0,
     '법령ID(법 자체)와 MST(그 판)는 **달라야 정상**이다 — 같으면 오히려 이상하다');
  ok('★합치는 자리가 없다', !('판번호' in r) && !('id' in r),
     '하나로 합치는 필드를 두면 다음 사람이 그걸 믿는다. 실측상 두 값은 전부 달랐다');
}

console.log('\n── ② 판번호의 제자리는 families.<계층> 안이다 ──');
{
  const r = withMeta({ families: { 시행령: { MST: '287499' } } }, M.readMeta);
  ok('families 안에 있으면 hasId 다', r.hasId === true);
  const s = withMeta({ '법령일련번호(법률)': '259279' }, M.readMeta);
  ok('최상위에만 있으면 hasId 가 아니다', s.hasId === false, '최상위는 **옛 자리**다');
  ok('그래도 버리지 않는다 — strays 로 온다', s.strays['법령일련번호(법률)'] === '259279');
  const e = withMeta({ families: { 법률: { 파일: '법률.json' } } }, M.readMeta);
  ok('families 는 있는데 번호가 비면 hasId 가 아니다', e.hasId === false);
}

console.log('\n── ③ 계층 이름은 괄호에서만 읽는다 (추측하지 않는다) ──');
{
  ok('`법령일련번호(시행령)` → 시행령', M.layerOfStray('법령일련번호(시행령)') === '시행령');
  ok('★`법령일련번호(MST)` 는 계층이 아니다', M.layerOfStray('법령일련번호(MST)') === null,
     '`(MST)` 는 꼴 표기지 계층이 아니다 — 계층으로 읽으면 엉뚱한 자리와 맞댄다');
  ok('`법령ID` 는 계층을 모른다', M.layerOfStray('법령ID') === null);
  ok('`MST` 도 계층을 모른다', M.layerOfStray('MST') === null);
}

console.log('\n── ④ 어긋나면 알린다 (감추지 않는다) ──');
{
  const r = withMeta({
    families: { 법률: { MST: '268103' } }, '법령일련번호(법률)': '283701',
  }, M.readMeta);
  ok('★같은 계층을 다르게 말하면 conflicts 에 담긴다', r.conflicts.length === 1, JSON.stringify(r.conflicts));
  ok('어느 쪽이 맞는지 **고르지 않는다**', /families\.MST=268103/.test(r.conflicts[0]) && /283701/.test(r.conflicts[0]),
     '둘 다 적어 사람이 보게 한다 — 기계가 고르면 조용히 틀린다');
  const same = withMeta({ families: { 법률: { MST: '283701' } }, '법령일련번호(법률)': '283701' }, M.readMeta);
  ok('같은 값이면 어긋남이 아니다', same.conflicts.length === 0);
  const unknown = withMeta({ families: { 법률: { MST: '268103' } }, '법령ID': '001737' }, M.readMeta);
  ok('★계층을 모르는 것은 맞대지 않는다', unknown.conflicts.length === 0,
     '`법령ID` 는 계층이 없으므로 `법률` 의 MST 와 견주면 안 된다 — 견주면 전부 거짓 어긋남이 된다');
}

console.log('\n── ⑤ 못 읽는 것은 0 이 아니라 「못 읽었다」 ──');
{
  const bad = withMeta('{ 망가진 JSON', M.readMeta);
  ok('깨진 JSON 은 ok=false 에 까닭을 단다', bad.ok === false && /읽지 못했다/.test(bad.error || ''), bad.error || '');
  const arr = withMeta([1, 2, 3], M.readMeta);
  ok('배열은 객체가 아니라고 말한다', arr.ok === false && /객체가 아니다/.test(arr.error || ''), arr.error || '');
  ok('못 읽어도 hasId 를 참으로 만들지 않는다', bad.hasId === false && arr.hasId === false);
}

console.log('\n── ⑥ 전수 census 는 뜻과 범위를 함께 말한다 ──');
{
  const c = M.census();
  ok('네 갈래 합이 전체와 맞는다',
     c.famOnly + c.strayOnly + c.both + c.none + c.unreadable === c.total,
     `${c.famOnly}+${c.strayOnly}+${c.both}+${c.none}+${c.unreadable} ≠ ${c.total}`);
  ok('보고 문구에 뜻과 범위가 들어 있다', /뜻: .+ · 범위: .+/.test(c.label), c.label);
  ok('실제 저장소를 읽는다(0이 아니다)', c.total > 400, '총 ' + c.total);
  console.log(`     실측 — families 안에만 ${c.famOnly} · 최상위에만 ${c.strayOnly}`
            + ` · 둘 다 ${c.both} · 아무 데도 없다 ${c.none} · 어긋남 ${c.conflictFiles}`);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
