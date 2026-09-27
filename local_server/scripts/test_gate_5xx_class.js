/**
 * test_gate_5xx_class.js — G-47 ★V4 게이트가 5xx 를 「환경」으로 봐주는 **잠금**을 고정한다.
 *
 * [왜 있나] khoa-wms 500 한 건을 이 세션에서 **세 번 넘겨짚었고 세 번 다 틀렸다.**
 *   그래서 프록시가 `proxy error: <까닭> (<errno>)` 를 본문에 적게 했고(G-42),
 *   이제 게이트는 **본문이 스스로 바깥길 끊김이라고 말한 것**만 환경으로 센다(G-47).
 *   ⚠봐주는 규칙은 **새는 순간 게이트가 죽는다.** 그래서 그 잠금을 여기서 지킨다.
 *
 * [무엇을 고정하나]
 *  ① 바깥길 errno 가 적힌 5xx 만 환경이다 — 우리 코드의 터짐은 그대로 실패다
 *  ② ★**하나라도 진짜 5xx 가 섞이면 아무것도 봐주지 않는다** (콘솔 문구는 주소를 안 담는다)
 *  ③ 봐주는 것은 **그 상태코드만** — 500 을 봐준다고 502 까지 봐주면 안 된다
 *  ④ 5xx 가 하나도 없으면 빼주는 규칙도 없다
 *
 * ⚠이 시험은 규칙을 **다시 적지 않고** `simulate.js` 가 내보낸 함수를 그대로 부른다(L-136).
 *   같은 규칙을 두 번 적으면 둘이 갈라져도 아무도 모른다(뿌리 사슬 ⑥).
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES.
 *        → scripts/refactor/simulate.js (classify5xx) · local_server/routes/ocean1.js (proxy error 본문)
 *        → 00_WORKLIST G-47 · G-42 · G-44
 */
const S = require('../../scripts/refactor/simulate.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \u2705 ' + name); }
  else { fail++; console.log('  \u274c ' + name + (detail ? ' \u2014 ' + detail : '')); }
}

const ENV_ECONNRESET = '500 /api/ocean/khoa-wms?x=1\n          \u21b3 proxy error: terminated (ECONNRESET)';
const ENV_ENOTFOUND  = '500 /api/ocean/khoa-wms?x=2\n          \u21b3 proxy error: fetch failed (ENOTFOUND)';
const ENV_UND        = '500 /api/ocean/khoa-wms?x=3\n          \u21b3 proxy error: terminated (UND_ERR_SOCKET)';
const OUR_TYPEERROR  = '500 /api/legal/answer\n          \u21b3 TypeError: cp.frontmatter is undefined';
const OUR_PLAIN      = '500 /api/legal/answer\n          \u21b3 {"error":"\uc11c\ubc84 \uc624\ub958"}';
const NO_ERRNO       = '500 /api/ocean/khoa-wms?x=4\n          \u21b3 proxy error: \ubb34\uc5b8\uac00 \uc798\ubabb\ub410\ub2e4';
const ENV_502        = '502 /api/ocean/khoa-wms?x=5\n          \u21b3 proxy error: terminated (ECONNRESET)';

console.log('\u2500\u2500 \u2460 \ubc14\uae65\uae38 errno \uac00 \uc801\ud78c 5xx \ub9cc \ud658\uacbd\uc774\ub2e4 \u2500\u2500');
ok('ECONNRESET \u2014 \ud658\uacbd', S.isOutwardProxyFail(ENV_ECONNRESET));
ok('ENOTFOUND \u2014 \ud658\uacbd', S.isOutwardProxyFail(ENV_ENOTFOUND));
ok('UND_ERR_SOCKET \u2014 \ud658\uacbd', S.isOutwardProxyFail(ENV_UND));
ok('\uc6b0\ub9ac \ucf54\ub4dc\uc758 TypeError \u2014 \ud658\uacbd \uc544\ub2c8\ub2e4', !S.isOutwardProxyFail(OUR_TYPEERROR));
ok('\ud3c9\ubc94\ud55c {error} \ubcf8\ubb38 \u2014 \ud658\uacbd \uc544\ub2c8\ub2e4', !S.isOutwardProxyFail(OUR_PLAIN));
ok('`proxy error:` \uc774\uc9c0\ub9cc errno \uac00 \uc5c6\ub2e4 \u2014 \ud658\uacbd \uc544\ub2c8\ub2e4', !S.isOutwardProxyFail(NO_ERRNO),
   '\uae4c\ub2ed\uc744 \uc548 \ub300\uba74 \ubd10\uc8fc\uc9c0 \uc54a\ub294\ub2e4 \u2014 \ubd10\uc8fc\ub294 \ucabd\uc774\uc57c\ub9d0\ub85c \uadfc\uac70\uac00 \uc788\uc5b4\uc57c \ud55c\ub2e4(G-34)');

console.log('\n\u2500\u2500 \u2461 \u2605\ud558\ub098\ub77c\ub3c4 \uc9c4\uc9dc 5xx \uac00 \uc12e\uc774\uba74 \uc544\ubb34\uac83\ub3c4 \ubd10\uc8fc\uc9c0 \uc54a\ub294\ub2e4 \u2500\u2500');
{
  const only = S.classify5xx([ENV_ECONNRESET, ENV_ENOTFOUND]);
  ok('\uc804\ubd80 \ubc14\uae65\uae38 \ub04a\uae40\uc774\uba74 \ube7c\uc8fc\ub294 \uaddc\uce59\uc774 \uc0dd\uae34\ub2e4', only.exemptRes.length === 1 && only.env5xx.length === 2 && only.real5xx.length === 0,
     `env=${only.env5xx.length} real=${only.real5xx.length} \uaddc\uce59=${only.exemptRes.length}`);
  ok('\uadf8 \uaddc\uce59\uc740 `status of 500 (` \ub97c \ub9de\ucd98\ub2e4', only.exemptRes.some((r) => r.test('Failed to load resource: the server responded with a status of 500 (Internal Server Error)')));

  const mixed = S.classify5xx([ENV_ECONNRESET, OUR_TYPEERROR]);
  ok('\u2605\uc9c4\uc9dc\uac00 \ud558\ub098 \uc12e\uc774\uba74 \ube7c\uc8fc\ub294 \uaddc\uce59\uc774 **\uc544\uc608 \uc0dd\uae30\uc9c0 \uc54a\ub294\ub2e4**', mixed.exemptRes.length === 0,
     `env=${mixed.env5xx.length} real=${mixed.real5xx.length} \uaddc\uce59=${mixed.exemptRes.length} \u2014 \ucf58\uc194 \ubb38\uad6c\ub294 \uc8fc\uc18c\ub97c \uc548 \ub2f4\uc544\uc11c \uadf8 \uc904\uc774 \uc9c4\uc9dc \ucabd \ub54c\ubb38\uc77c \uc218\ub3c4 \uc788\ub2e4`);
  ok('\uadf8\ub798\ub3c4 \uc5b4\ub290 \ucabd\uc774 \ubb34\uc5c7\uc778\uc9c0\ub294 \uac00\ub978\ub2e4', mixed.env5xx.length === 1 && mixed.real5xx.length === 1);
}

console.log('\n\u2500\u2500 \u2462 \ubd10\uc8fc\ub294 \uac83\uc740 \uadf8 \uc0c1\ud0dc\ucf54\ub4dc\ub9cc \u2500\u2500');
{
  const r = S.classify5xx([ENV_502]);
  ok('502 \ub9cc \ub0ac\uc73c\uba74 502 \ub9cc \ubd10\uc900\ub2e4', r.exemptRes.some((x) => x.test('status of 502 (Bad Gateway)')));
  ok('\u2605500 \uc740 \ubd10\uc8fc\uc9c0 \uc54a\ub294\ub2e4', !r.exemptRes.some((x) => x.test('status of 500 (Internal Server Error)')),
     '\ud55c \uc0c1\ud0dc\ucf54\ub4dc\ub97c \ubd10\uc900 \uac83\uc774 \ub2e4\ub978 \uc0c1\ud0dc\ucf54\ub4dc\uae4c\uc9c0 \ub36e\uc73c\uba74 \uadf8\uac8c \ubc14\ub85c \u300c\uc0c8\ub294 \uc7a0\uae08\u300d\uc774\ub2e4');
  const both = S.classify5xx([ENV_502, ENV_ECONNRESET]);
  ok('\ub458 \ub2e4 \ub0ac\uc73c\uba74 \ub458 \ub2e4 \ubd10\uc900\ub2e4', both.exemptRes.length === 2);
}

console.log('\n\u2500\u2500 \u2463 5xx \uac00 \uc5c6\uc73c\uba74 \ube7c\uc8fc\ub294 \uaddc\uce59\ub3c4 \uc5c6\ub2e4 \u2500\u2500');
{
  ok('\ube48 \ubaa9\ub85d', S.classify5xx([]).exemptRes.length === 0);
  ok('undefined \ub3c4 \ud130\uc9c0\uc9c0 \uc54a\ub294\ub2e4', S.classify5xx(undefined).exemptRes.length === 0);
  ok('\ubcf8\ubb38\uc744 \ubabb \uc77d\uc740 5xx \ub294 \ubd10\uc8fc\uc9c0 \uc54a\ub294\ub2e4',
     S.classify5xx(['500 /api/x\n          \u21b3 (\ubcf8\ubb38\uc744 \ubabb \uc77d\uc5c8\ub2e4)']).exemptRes.length === 0,
     '\ubaa8\ub974\ub294 \uac83\uc740 \ubd10\uc8fc\uc9c0 \uc54a\ub294\ub2e4 \u2014 0 \uc740 \ud1b5\uacfc\uac00 \uc544\ub2c8\ub2e4(G-34)');
}

console.log('\n\u2500\u2500 \u2464 \uc911\ubcf5\uc740 \ud55c \ubc88\uc73c\ub85c \uc13c\ub2e4 \u2500\u2500');
{
  const r = S.classify5xx([ENV_ECONNRESET, ENV_ECONNRESET, ENV_ECONNRESET]);
  ok('\uac19\uc740 \uc904 \uc14b\uc740 \ud55c \uac74\uc774\ub2e4', r.env5xx.length === 1, `env=${r.env5xx.length}`);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
