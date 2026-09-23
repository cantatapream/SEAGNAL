/**
 * test_silent_catch.js — 2-6b ★「조용히 삼키는 catch」의 뜻을 고정하고 **늘지 못하게** 막는다.
 *
 * [왜 있나] 독립 4벌이 같은 저장소를 보고 **61 / 55 / 133 / 39** 로 갈렸다(G-2 = 뿌리 사슬 ⑥).
 * 「근거 조문 행」과 똑같은 병이라 똑같이 고친다 — **뜻과 범위에 이름을 붙이고, 코드가 들고,
 * 게이트가 지킨다.** 2026-09-22 에 재 보니 뜻 4 × 범위 3 = **열두 칸이 전부 다른 수**였다.
 * 4벌이 갈린 게 당연했다.
 *
 * [무엇을 고정하나]
 *  ① 뜻 네 가지가 **정의대로** 갈린다 (bare ⊆ empty ⊆ silent ⊆ all)
 *  ② ★`bare`(몸통도 주석도 없는 catch)가 **기준선보다 늘지 않는다** — 가장 나쁜 것부터 막는다
 *  ③ 파서가 없으면 **0 이 아니라 「못 셌다」**로 알린다 (G-34 — 0 은 통과가 아니다)
 *  ④ 모르는 뜻·범위는 조용히 넘어가지 않고 던진다
 *  ⑤ 검사 도구·시험은 안 센다 — 도구가 삼키는 것과 사용자 앞 코드가 삼키는 것은 무게가 다르다
 *
 * ⚠기준선을 **낮추는** 것은 막지 않는다(고치면 줄어드는 게 정상이다). 줄었으면
 *   `baseline/silent_catch.json` 을 다시 만들어 그 자리에서 다시 잠근다.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES.
 *        → _dashboard/loop/_counting.js · baseline/silent_catch.json · 00_WORKLIST G-14 · 2-6b.
 */
const fs = require('fs');
const path = require('path');
const C = require('../knowledge/legal/_dashboard/loop/_counting.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('── ① 뜻 네 가지가 정의대로 갈린다 ──');
{
  const src = [
    'try { a(); } catch (e) {}',                                  // bare
    'try { a(); } catch (e) { /* 일부러 삼킨다 */ }',              // empty(주석 있음) — bare 아님
    'try { a(); } catch (e) { fallback = 1; }',                    // silent (문장은 있으나 로그·throw 없음)
    'try { a(); } catch (e) { console.error(e); }',                // 로그 남김 — 조용하지 않다
    'try { a(); } catch (e) { throw e; }',                         // 다시 던짐 — 조용하지 않다
  ].join('\n');
  const r = C.catchStats(src);
  if (!r) { ok('파서를 쓸 수 있다', false, 'acorn 없음 — 아래 문항을 못 잰다'); }
  else {
    ok('all = 5', r.all === 5, String(r.all));
    ok('bare = 1 (몸통도 주석도 없는 것만)', r.bare === 1, String(r.bare));
    ok('empty = 2 (주석만 있는 것도 문장은 0)', r.empty === 2, String(r.empty));
    ok('silent = 3 (empty 2 + 조용한 문장 1)', r.silent === 3, String(r.silent));
    ok('★포함 관계 bare ⊆ empty ⊆ silent ⊆ all', r.bare <= r.empty && r.empty <= r.silent && r.silent <= r.all);
    ok('로그를 남기면 조용한 것으로 안 센다', r.all - r.silent === 2, String(r.all - r.silent));
  }
}

console.log('\n── ② 모르는 뜻·범위는 조용히 넘어가지 않는다 ──');
{
  let threw = 0;
  try { C.countSilentCatches({ sense: '없는뜻' }); } catch (_) { threw++; }
  try { C.countSilentCatches({ scope: '없는범위' }); } catch (_) { threw++; }
  ok('둘 다 던진다', threw === 2, '던진 횟수 ' + threw);
  ok('쓸 수 있는 범위가 사전에 적혀 있다',
    Object.keys(C.CATCH_SCOPES).join(',') === 'server,client,product', Object.keys(C.CATCH_SCOPES).join(','));
  ok('검사 도구·시험 폴더는 어느 범위에도 없다',
    !JSON.stringify(C.CATCH_SCOPES).includes('scripts') && !JSON.stringify(C.CATCH_SCOPES).includes('_dashboard'),
    JSON.stringify(C.CATCH_SCOPES));
}

console.log('\n── ③ 파서가 없으면 「0」이 아니라 「못 셌다」 ──');
{
  ok('못 읽는 원문은 null 을 돌려준다(0 이 아니다)', C.catchStats('function ( {{{') === null);
  const r = C.countSilentCatches({ sense: 'bare', scope: 'server' });
  ok('available 로 잴 수 있었는지 알린다', typeof r.available === 'boolean');
  if (!r.available) ok('못 셌을 때 문구가 그렇게 말한다', /못 셌다/.test(r.label), r.label);
  else ok('잴 수 있었으면 파일을 실제로 읽었다', r.files > 0, '파일 ' + r.files);
}

console.log('\n── ④ ★기준선보다 늘지 않는다 (가장 나쁜 `bare` 부터) ──');
{
  const BP = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop', 'baseline', 'silent_catch.json');
  if (!fs.existsSync(BP)) { ok('기준선 파일이 있다', false, BP); }
  else {
    const base = JSON.parse(fs.readFileSync(BP, 'utf8'))['범위별'];
    for (const scope of ['server', 'client', 'product']) {
      const now = C.countSilentCatches({ sense: 'bare', scope });
      if (!now.available) { console.log(`  ⏭️  ${scope} — 못 셌다(acorn 없음)`); continue; }
      const b = base[scope].bare;
      console.log(`  · ${scope.padEnd(8)} bare ${String(now.rows).padStart(4)} (기준선 ${b})`
        + ` · silent ${now.counts.silent} · all ${now.counts.all}`);
      ok(`${scope} — bare 가 기준선보다 안 늘었다`, now.rows <= b, `지금 ${now.rows} > 기준선 ${b}`);

      // ★`io` — 기다리는 일(await)을 조용히 삼키는 catch (2026-09-23, G-14b)
      //   등록부는 이것을 "큰 덩이를 통째로 삼키는 catch 50곳" 이라 적었지만 **둘 다 안 맞았다**:
      //   50 은 어느 뜻으로도 안 나오고(10문장+ 69 · await 241), 스스로 든 실례
      //   `admin_collect.js:2394` 는 **2문장**이다. 위험한 것은 크기가 아니라
      //   **기다리는 일을 삼키는 것**이다 — fetch 가 실패해도 화면은 옛 값으로 그려진다.
      const io = C.countSilentCatches({ sense: 'io', scope });
      const bio = base[scope].io;
      console.log(`  · ${scope.padEnd(8)} io   ${String(io.rows).padStart(4)} (기준선 ${bio})`
        + '   ← 기다리는 일을 삼키는 catch');
      ok(`${scope} — io 가 기준선보다 안 늘었다`, io.rows <= bio, `지금 ${io.rows} > 기준선 ${bio}`);
      ok(`${scope} — 포함 관계 io ⊆ silent`, io.rows <= io.counts.silent,
          `io ${io.rows} · silent ${io.counts.silent}`);
    }
  }
}

console.log('\n── ⑤ 숫자를 말할 때 뜻과 범위를 함께 말한다 ──');
{
  const r = C.countSilentCatches({ sense: 'silent', scope: 'product' });
  ok('보고 문구에 뜻과 범위가 들어 있다', /뜻: .+ · 범위: .+/.test(r.label), r.label);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
