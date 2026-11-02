/**
 * test_nariya_exposure_schedule.js — 나리야 챗봇 「자동 노출 시간」(08:00 노출 · 19:00 비노출, KST)을 고정한다.
 *
 * 왜 있나: 사용자 확정(2026-11-02) — 「19시가 되면 챗봇이 비노출로 … 8시가 되면 모든 사용자에게 노출로, 자동화로」
 *   + 「비노출 하면 관리자도 안 보이도록 · 관리자 센터에서 켜기/끄기와 작동 시간을 설정」.
 *   ① 경계(07:59/08:00/18:59/19:00)와 자정 넘김 ② 노출 시각 > 비노출 시각(자정을 넘는 창)
 *   ③ 자동 끔이면 손으로 고른 값 ④ 자동 켬 + 손으로 바꿈 → 다음 경계에서 자동 값으로 복귀
 *   ⑤ 끄는 순간 보이던 값 고정 · 켜는 순간 시간표 ⑥ 설정 검증 400(저장값 그대로) ⑦ 운영 data 파일 안 건드림.
 *   시각은 서비스의 setNowForTest 로 주입한다(시각 의존 시험 금지). 프로세스 시간대는 일부러 KST 가 아닌 곳으로 둔다
 *   (Fly 서버가 UTC 여도 맞는지 — 계산이 TZ 에 기대지 않음을 확인).
 *
 * [연계] → services/nariya_exposure_schedule.js · routes/legal.js(GET/POST /api/legal/config)
 *          · scripts/refactor/verify_all.sh(SUITES)
 * 쓰는 법: node local_server/scripts/test_nariya_exposure_schedule.js
 */
process.env.TZ = 'America/New_York';   // KST 도 UTC 도 아닌 시간대 — 계산이 이 값에 흔들리면 안 된다
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('../services/nariya_exposure_schedule');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const K = (s) => Date.parse(s.replace(' ', 'T') + ':00+09:00');   // 'YYYY-MM-DD HH:MM'(KST) → epoch ms
const PROD = path.join(__dirname, '..', 'data', 'nariya_config.json');
const sha = () => (fs.existsSync(PROD) ? crypto.createHash('sha1').update(fs.readFileSync(PROD)).digest('hex') : 'none');
const prodBefore = sha();

(async () => {
  console.log('── ① 시간표 경계(08:00 노출 · 19:00 비노출) ──');
  ok('프로세스 시간대가 KST 가 아니다(시험 전제)', new Date(K('2026-11-02 10:00')).getTimezoneOffset() !== -540);
  for (const [t, want] of [['2026-11-02 07:59', 'off'], ['2026-11-02 08:00', 'user'], ['2026-11-02 18:59', 'user'], ['2026-11-02 19:00', 'off'],
    ['2026-11-02 23:59', 'off'], ['2026-11-03 00:00', 'off'], ['2026-11-03 03:00', 'off']]) {
    ok(`${t} KST → ${want}`, S.scheduledAt('08:00', '19:00', K(t)) === want);
  }
  const base = { exposure: 'off', exposureAuto: true, exposureOnAt: '08:00', exposureOffAt: '19:00', exposureManualAt: null };
  let d = S.describe(base, K('2026-11-02 07:59'));
  ok('07:59 → 다음 08:00 노출, 1분 뒤', d.exposure === 'off' && d.exposureNext.kst === '08:00' && d.exposureNext.exposure === 'user' && d.exposureNext.inMs === 60000, JSON.stringify(d));
  d = S.describe(base, K('2026-11-02 18:59'));
  ok('18:59 → 노출 · 다음 19:00 비노출', d.exposure === 'user' && d.exposureSource === 'schedule' && d.exposureNext.kst === '19:00' && d.exposureNext.exposure === 'off', JSON.stringify(d));
  d = S.describe(base, K('2026-11-02 19:00'));
  ok('19:00 → 비노출 · 다음은 이튿날 08:00(자정 넘김)', d.exposure === 'off' && d.exposureNext.at === new Date(K('2026-11-03 08:00')).toISOString(), JSON.stringify(d));
  d = S.describe(base, K('2026-11-02 23:30'));
  ok('23:30 → 다음 전환까지 8시간 30분', d.exposureNext.inMs === 8.5 * 3600000, JSON.stringify(d));

  console.log('\n── ② 노출 시각이 비노출 시각보다 늦음(20:00 노출 · 06:00 비노출 — 자정을 넘는 창) ──');
  for (const [t, want] of [['2026-11-02 19:59', 'off'], ['2026-11-02 20:00', 'user'], ['2026-11-02 23:59', 'user'], ['2026-11-03 00:00', 'user'], ['2026-11-03 05:59', 'user'], ['2026-11-03 06:00', 'off']]) {
    ok(`${t} KST → ${want}`, S.scheduledAt('20:00', '06:00', K(t)) === want);
  }
  ok('normTimes: 틀린 형식·같은 두 시각 → 기본 08:00·19:00', JSON.stringify(S.normTimes({ exposureOnAt: '8:00' })) === '{"onAt":"08:00","offAt":"19:00"}' && JSON.stringify(S.normTimes({ exposureOnAt: '19:00' })) === '{"onAt":"08:00","offAt":"19:00"}' && JSON.stringify(S.normTimes({ exposureOnAt: '07:30', exposureOffAt: '20:00' })) === '{"onAt":"07:30","offAt":"20:00"}');
  ok('isHHMM: 00:00·23:59 만 받고 24:00·8:00·숫자는 거절', S.isHHMM('00:00') && S.isHHMM('23:59') && !S.isHHMM('24:00') && !S.isHHMM('8:00') && !S.isHHMM(800));

  console.log('\n── ③④ 자동 끔 = 손으로 고른 값 · 자동 켬 + 손으로 바꿈 = 다음 경계까지만 ──');
  d = S.describe(Object.assign({}, base, { exposureAuto: false, exposure: 'admin' }), K('2026-11-02 10:00'));
  ok('자동 끔 → 저장값(관리자만) 그대로 · 다음 전환 없음', d.exposure === 'admin' && d.exposureSource === 'manual' && d.exposureNext === null, JSON.stringify(d));
  const ov = Object.assign({}, base, { exposure: 'admin', exposureManualAt: new Date(K('2026-11-02 20:00')).toISOString() });
  d = S.describe(ov, K('2026-11-03 07:59'));
  ok('20:00 에 관리자만으로 바꿈 → 이튿날 07:59 까지 관리자만(override) · 08:00 에 노출로 돌아감', d.exposure === 'admin' && d.exposureSource === 'override' && d.exposureNext.kst === '08:00' && d.exposureNext.exposure === 'user', JSON.stringify(d));
  d = S.describe(ov, K('2026-11-03 08:00'));
  ok('08:00 경계를 지나면 → 시간표(노출)', d.exposure === 'user' && d.exposureSource === 'schedule', JSON.stringify(d));
  d = S.describe(Object.assign({}, base, { exposure: 'user', exposureManualAt: new Date(K('2026-11-02 18:00')).toISOString() }), K('2026-11-02 21:00'));
  ok('경계(19:00) 전에 바꾼 값은 경계 뒤엔 무시', d.exposure === 'off' && d.exposureSource === 'schedule', JSON.stringify(d));

  console.log('\n── ⑤⑥ 설정 API(GET/POST /api/legal/config) — 설정 파일은 메모리로 돌린다 ──');
  const adminAuth = require('../services/admin_auth');
  adminAuth.verifyToken = (t) => t === 'good';
  const mem = {};
  const isCfg = (p) => /nariya_config\.json(\.tmp)?$/.test(String(p));
  const real = { ex: fs.existsSync, rd: fs.readFileSync, wr: fs.writeFileSync, mv: fs.renameSync };
  fs.existsSync = (p) => (isCfg(p) ? p in mem : real.ex(p));
  fs.readFileSync = (p, ...a) => (isCfg(p) ? (p in mem ? mem[p] : (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; })()) : real.rd(p, ...a));
  fs.writeFileSync = (p, dd, ...a) => (isCfg(p) ? void (mem[p] = String(dd)) : real.wr(p, dd, ...a));
  fs.renameSync = (a, b) => (isCfg(a) ? void (mem[b] = mem[a], delete mem[a]) : real.mv(a, b));
  try {
    const router = require('../routes/legal');
    const route = (m) => router.stack.find(l => l.route && l.route.path === '/api/legal/config' && l.route.methods[m]).route;
    const call = (m, token, body) => new Promise((resolve) => {
      const stack = route(m).stack;
      const req = { body, get: (h) => (h === 'X-Admin-Token' ? token : undefined) };
      const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
      stack[stack.length - 1].handle(req, res, () => resolve({ code: 'next' }));
    });
    const at = (t) => S.setNowForTest(K(t));
    const CFG = PROD;
    const saved = () => JSON.parse(mem[CFG]);
    mem[CFG] = JSON.stringify({ exposure: 'off', answerCanonicalOnly: true });   // 이 기능 전의 운영 저장값 모양

    at('2026-11-02 10:00');
    let g = await call('get', undefined);
    ok('옛 저장값(자동 칸 없음) → 자동 켜짐(기본) · 10:00 은 노출 · 다음 19:00 비노출 · 토큰 없어도 보임', g.body.exposure === 'user' && g.body.exposureAuto === true && g.body.exposureOnAt === '08:00' && g.body.exposureOffAt === '19:00' && g.body.exposureNext.kst === '19:00' && g.body.exposureNext.exposure === 'off' && !('providerStatus' in g.body), JSON.stringify(g.body));
    at('2026-11-02 19:00');
    g = await call('get', undefined);
    ok('19:00 GET → 비노출(off — 관리자 기기도 FAB 안 보임)', g.body.exposure === 'off', g.body.exposure);

    at('2026-11-02 20:00');
    let p = await call('post', 'good', { exposure: 'admin' });
    ok('자동 켬 + 20:00 에 관리자만으로 바꿈 → 응답 admin(override) · 바꾼 시각 저장', p.code === 200 && p.body.exposure === 'admin' && p.body.exposureSource === 'override' && saved().exposureManualAt === new Date(K('2026-11-02 20:00')).toISOString(), JSON.stringify({ b: p.body.exposure, s: saved() }));
    at('2026-11-03 07:59'); g = await call('get', undefined);
    ok('이튿날 07:59 → 아직 관리자만', g.body.exposure === 'admin', g.body.exposure);
    at('2026-11-03 08:00'); g = await call('get', undefined);
    ok('08:00 → 자동 값(노출)으로 복귀', g.body.exposure === 'user' && g.body.exposureSource === 'schedule', JSON.stringify(g.body));

    at('2026-11-03 10:00');
    p = await call('post', 'good', { exposureAuto: false });
    ok('자동 끔(10:00, 보이던 값=노출) → 저장값 노출로 고정 · 자동 꺼짐', p.code === 200 && saved().exposure === 'user' && saved().exposureAuto === false && saved().exposureManualAt === null && p.body.exposure === 'user' && p.body.exposureNext === null, JSON.stringify(saved()));
    at('2026-11-03 20:00'); g = await call('get', undefined);
    ok('자동 끔이면 20:00 에도 노출 그대로(수동값)', g.body.exposure === 'user' && g.body.exposureSource === 'manual', JSON.stringify(g.body));
    p = await call('post', 'good', { exposure: 'off' });
    ok('자동 끔 + 손으로 비노출 → 바꾼 시각은 안 남김', p.body.exposure === 'off' && saved().exposureManualAt === null, JSON.stringify(saved()));
    at('2026-11-04 10:00'); g = await call('get', undefined);
    ok('자동 끔 → 이튿날 10:00 에도 비노출', g.body.exposure === 'off', g.body.exposure);
    p = await call('post', 'good', { exposureAuto: true });
    ok('자동 다시 켬 → 그 순간부터 시간표(10:00 노출)', p.body.exposure === 'user' && p.body.exposureSource === 'schedule' && saved().exposureAuto === true, JSON.stringify(p.body));

    p = await call('post', 'good', { exposureOnAt: '07:30', exposureOffAt: '20:00' });
    ok('시각 저장 07:30·20:00', p.code === 200 && saved().exposureOnAt === '07:30' && saved().exposureOffAt === '20:00' && p.body.exposureNext.kst === '20:00', JSON.stringify(p.body));
    for (const [t, want] of [['2026-11-05 07:29', 'off'], ['2026-11-05 07:30', 'user'], ['2026-11-05 19:59', 'user'], ['2026-11-05 20:00', 'off']]) {
      at(t); g = await call('get', undefined);
      ok(`바뀐 시각 기준 ${t} → ${want}`, g.body.exposure === want, g.body.exposure);
    }

    for (const [name, bad] of [['노출 시각 형식(8:00)', { exposureOnAt: '8:00' }], ['비노출 시각 24:00', { exposureOffAt: '24:00' }], ['자동 스위치 문자열', { exposureAuto: 'yes' }],
      ['두 시각 같음', { exposureOnAt: '09:00', exposureOffAt: '09:00' }], ['노출 시각을 지금 비노출 시각(20:00)과 같게', { exposureOnAt: '20:00' }], ['exposure 틀린 값', { exposure: 'all' }]]) {
      const before = mem[CFG];
      p = await call('post', 'good', bad);
      ok(`POST ${name} → 400 · 저장값 그대로`, p.code === 400 && p.body.ok === false && mem[CFG] === before, JSON.stringify(p));
    }
    p = await call('post', 'good', { providerRemoved: ['claude1'] });
    ok('다른 칸 저장(providerRemoved)은 자동 노출 칸을 안 건드림', p.code === 200 && saved().exposureAuto === true && saved().exposureOnAt === '07:30' && saved().exposureOffAt === '20:00', JSON.stringify(saved()));
  } finally {
    fs.existsSync = real.ex; fs.readFileSync = real.rd; fs.writeFileSync = real.wr; fs.renameSync = real.mv;
    S.setNowForTest(null);
  }

  console.log('\n── ⑦ 운영 data 파일 ──');
  ok('local_server/data/nariya_config.json 이 시험 전후 같다', sha() === prodBefore, `${prodBefore} → ${sha()}`);

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ❌ 예외', e && e.stack || e); console.log(`\n  ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
