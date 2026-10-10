'use strict';
// ============================================================================
// 강풍(W) 별도 저장 검증 — node local_server/scripts/test_gale_store.js
//   해안 안전 예보 U5·M10: MMIS 응답에서 강풍 행만 따로 파일로 남긴다. 풍랑·태풍 흐름에는
//   손대지 않는다. 이 파일이 그 계약을 고정한다:
//   강풍만 · 실제 특보 행 판정은 크롤러 _isLiveRow 와 같음 · 모양이 다른 W 행도 기록(live:false) ·
//   바뀔 때만 덮어쓰기 · 빈 응답 한 번에 0행으로 덮지 않음 · 기록은 처음 본 행만(24시간 기억) ·
//   응답 객체를 바꾸지 않음.
//   [연계] services/gale_warning_store.js · marine_warning_crawler.js run()(_isLiveRow)
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require(path.join(__dirname, '..', 'services', 'gale_warning_store.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra || ''); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-'));
const T0 = new Date('2026-10-10T00:00:00Z').getTime();
const at = (min) => new Date(T0 + min * 60000);
const W = (zone, lvl, ef) => ({ warn_tp: 'W', warn_zone_cd: zone, warn_zone_nm: zone + '이름', warn_lvl_nm: lvl, tm_fc: '2026.10.10 00:00', tm_ef: ef });
const V = (zone) => ({ warn_tp: 'V', warn_zone_cd: zone, warn_lvl_nm: '주의보', tm_fc: '2026.10.10 00:00', tm_ef: '2026.10.10 03:00' });
const readLatest = () => JSON.parse(fs.readFileSync(path.join(dir, 'gale_warnings.json'), 'utf8'));
const logLines = () => { try { return fs.readFileSync(path.join(dir, 'gale_warnings_log.jsonl'), 'utf8').trim().split('\n').filter(Boolean); } catch (_) { return []; } };
const a = W('L1', '주의보', '2026.10.10 06:00'), b = W('L9', '경보', '2026.10.10 09:00');

console.log('\n[T1] 강풍만 고른다 — 풍랑·태풍은 빼고, 모양이 다른 W 행은 live:false 로 원본째');
const f1 = { warnList: [a, V('S1'), { warn_tp: 'T', warn_lvl_nm: '경보', tm_fc: 'x' }],
             warnSascList: [{ warn_tp: 'W', warn_zone_cd: 'L2' }, { warn_tp: 'W', warn_zone_cd: 'L4', warn_lvl_nm: '주의보' }],
             warnReady: [Object.assign(W('L3', '예비특보', '2026.10.10 18:00'), { warn_tp: 'w' })],
             warnSascReady: undefined };
const rows = store.pickGaleRows(f1);
const live = rows.filter(r => r.live), odd = rows.filter(r => !r.live);
ok('실제 강풍 행 2개(발효 1·예비 1, 소문자 w 포함)', live.length === 2, JSON.stringify(live.map(r => r.zoneCd)));
ok('풍랑(V)·태풍(T)는 없음', rows.every(r => r.zoneCd !== 'S1') && rows.length === 4);
ok('수준 이름 없는 행 · 시각 없는 행 → live:false + 원본', odd.length === 2 && odd.every(r => r.raw && r.raw.warn_tp === 'W'));
ok('live 판정 = 크롤러 _isLiveRow 기준', store.isLiveRow({ warn_lvl_nm: '주의보', tm_ef: 'x' }) && !store.isLiveRow({ warn_lvl_nm: '주의보' }) && !store.isLiveRow({ tm_fc: 'x' }));

console.log('\n[T2] 응답 객체를 바꾸지 않는다');
const before = JSON.stringify(f1); store._resetForTest(); store.save(f1, { dir, now: at(0) });
ok('save 전후 응답 동일', JSON.stringify(f1) === before);

console.log('\n[T3] 처음 저장 — 최신 파일엔 실제 행만, 기록엔 모양 다른 행까지');
store._resetForTest(); fs.rmSync(path.join(dir, 'gale_warnings_log.jsonl'), { force: true });
const r1 = store.save(f1, { dir, now: at(0) });
ok('count 2 · wrote · appended 4 · odd 2', r1.count === 2 && r1.wrote && r1.appended === 4 && r1.odd === 2, JSON.stringify(r1));
ok('최신 파일 2행', readLatest().count === 2);
ok('기록 4줄', logLines().length === 4);

console.log('\n[T4] 같은 응답 반복 · 순서만 바뀐 응답 — 다시 쓰지 않고 기록도 그대로');
ok('같은 응답: wrote false · appended 0', (r => !r.wrote && r.appended === 0)(store.save(f1, { dir, now: at(1) })));
const f1r = Object.assign({}, f1, { warnList: f1.warnList.slice().reverse() });
ok('순서만 바뀜: wrote false', !store.save(f1r, { dir, now: at(2) }).wrote);
ok('기록 그대로 4줄', logLines().length === 4);

console.log('\n[T5] 새 강풍 행 — 그 행만 기록');
const f2 = { warnList: [a, b] };
store._resetForTest(); fs.rmSync(path.join(dir, 'gale_warnings_log.jsonl'), { force: true });
store.save({ warnList: [a] }, { dir, now: at(0) });
const r5 = store.save(f2, { dir, now: at(1) });
ok('count 2 · appended 1', r5.count === 2 && r5.appended === 1, JSON.stringify(r5));

console.log('\n[T6] 빈 응답 글리치 한 번 — 최신 파일을 0행으로 덮지 않고, 돌아와도 기록 중복 없음');
const g1 = store.save({ warnList: [] }, { dir, now: at(2) });
ok('한 번 빈 응답: wrote false', !g1.wrote && readLatest().count === 2, JSON.stringify(g1));
const g2 = store.save(f2, { dir, now: at(3) });
ok('돌아옴: appended 0 · wrote false', g2.appended === 0 && !g2.wrote, JSON.stringify(g2));
ok('기록 2줄 그대로', logLines().length === 2);

console.log('\n[T7] 두 주기 연속 0개 — 그때 0행으로 덮는다(진짜 해제)');
store.save({ warnList: [V('S1')] }, { dir, now: at(4) });
const e2 = store.save({ warnList: [V('S1')] }, { dir, now: at(5) });
ok('두 번째 빈 주기에 0행 저장', e2.wrote && readLatest().count === 0, JSON.stringify(e2));
ok('기록은 지우지 않음', logLines().length === 2);

console.log('\n[T8] 24시간 넘게 안 보인 행이 다시 뜨면 — 새로 기록');
const r8 = store.save(f2, { dir, now: at(5 + 25 * 60) });
ok('appended 2', r8.appended === 2, JSON.stringify(r8));

console.log('\n[T9] 응답이 비어 있거나 이상해도 예외 없이 0행');
let threw = false; try { store.pickGaleRows(null); store.pickGaleRows({ warnList: 'x' }); store.pickGaleRows({ warnList: ['x', 1, null, []] }); } catch (_) { threw = true; }
ok('예외 없음', !threw);

console.log('\n[T10] 쓰기 실패는 호출부로 던진다(크롤러가 잡아서 무시) — 조용히 삼키지 않는다');
store._resetForTest();
let err = null; try { store.save(f2, { dir: path.join(dir, '없는폴더') }); } catch (e) { err = e; }
ok('없는 폴더면 예외', !!err);

console.log('\n[T11] 크롤러 연결 — run() 이 저장을 try/catch 로 감싸 부른다(실패가 특보 흐름을 막지 않음)');
const src = fs.readFileSync(path.join(__dirname, '..', 'marine_warning_crawler.js'), 'utf8');
ok('require 를 try/catch 로', /try \{\s*galeStore = require\('\.\/services\/gale_warning_store'\);\s*\} catch/.test(src));
ok('save 호출을 try/catch 로', /try \{ galeStore\.save\(fetched\); \}\s*catch/.test(src));
ok('풍랑·태풍 allowlist 그대로(V·T)', /REALTIME_TARGET_TP = new Set\(\['V', 'T'\]\)/.test(src));
ok('강풍 저장 모듈은 fs·path 말고 아무것도 부르지 않음(푸시 모듈 없음)', (fs.readFileSync(path.join(__dirname, '..', 'services', 'gale_warning_store.js'), 'utf8').match(/require\('([^']+)'\)/g) || []).join() === "require('fs'),require('path')");

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
