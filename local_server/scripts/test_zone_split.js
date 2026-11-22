/**
 * 구역 분할(2026-11-26 — 제주도남쪽바깥먼바다 → 남서쪽·남동쪽바깥먼바다) 검사.
 * 실행: node local_server/scripts/test_zone_split.js
 * 시계를 보지 않는다 — 전환 전/후를 _forceForTest 로 고정해 둘 다 본다(26일 전에도 후에도 같은 결과).
 * 사용자 확정(2026-11-22) 한 줄씩:
 *   ① 26일 00:00 KST 부터 자동 전환, 그 전엔 종전 그대로  ② 인덱스 카드·지도 구역이 2개로
 *   ③ 옛 이름 = 두 구역 모두 · 제주도먼바다 = 4 · 제주도전해상 = 8
 *   ④ 두 구역만 통보문 기준으로 표출(나머지 MMIS)  ⑤ 두 구역(옛 이름 포함) 특보 푸시 없음, 다른 구역은 정상
 * [연계] config/zone_split · marine_warning_crawler · analysis/bulletin_survey/lifecycle_check · services/bulletin_status ·
 *        config/zone_group_map · services/push_helpers · push_sender · services/warn_zones_split · client/js/core/zone_split.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const sent = [];
const fakeFetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ success: true, successCount: 0 }), text: async () => '' }; };
const origLoad = Module._load;
Module._load = function (req) { if (req === 'node-fetch') return fakeFetch; return origLoad.apply(this, arguments); };
globalThis.fetch = fakeFetch;
const ps = require('../push_sender');
Module._load = origLoad;

const ZS = require('../config/zone_split');
const C = require('../marine_warning_crawler');
const LC = require('../analysis/bulletin_survey/lifecycle_check');
const BS = require('../services/bulletin_status');
const { ZONE_GROUP_MAP } = require('../config/zone_group_map');
const PH = require('../services/push_helpers');
const WS = require('../services/warn_zones_split');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const OLD = '제주도남쪽바깥먼바다', W = '제주도남서쪽바깥먼바다', E = '제주도남동쪽바깥먼바다';
const far = (tree) => Object.keys(tree['제주도']['제주도먼바다']);
const parentsOf = (tok) => { const s = LC.expand(tok, []); return s ? [...s].filter((x) => LC.PARENTS.has(x)).sort() : null; };
const info = (lv) => ({ wrnTp: 'V', wrnTpNm: '풍랑', wrnLvlNm: lv, tmFc: '2026.11.25 16:00', tmEf: '2026.11.25 18:00', tmYn: '', clrNtcTm: '' });

(async () => {
    console.log('A. 전환 시각');
    ZS._forceForTest(null);
    ok('2026-11-25 23:59:59 KST = 아직', ZS.isActive(Date.parse('2026-11-25T23:59:59+09:00')) === false);
    ok('2026-11-26 00:00:00 KST = 전환', ZS.isActive(Date.parse('2026-11-26T00:00:00+09:00')) === true);
    ok('전환 시각 = 2026-11-25 15:00 UTC', ZS.AT_MS === Date.parse('2026-11-25T15:00:00Z'), ZS.AT_MS);

    console.log('B. 전환 전 — 종전 그대로');
    ZS._forceForTest(false);
    ok('뼈대: 제주도먼바다 잎 3개(옛 이름)', far(C._buildZoneTreeFromSnapshot(null)).join() === [OLD, '제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다'].join(), far(C._buildZoneTreeFromSnapshot(null)));
    ok('통보문: 옛 이름 = 옛 구역 1개', parentsOf(OLD).join() === OLD, parentsOf(OLD));
    ok('통보문: 제주도먼바다 = 3', parentsOf('제주도먼바다').length === 3);
    ok('통보문: 제주도전해상 = 7', parentsOf('제주도전해상').length === 7);
    ok('묶음표: 제주도먼바다 3 · 제주도전해상 7 · 키 21개', ZONE_GROUP_MAP['제주도먼바다'].length === 3 && ZONE_GROUP_MAP['제주도전해상'].length === 7 && Object.keys(ZONE_GROUP_MAP).length === 21);
    ok('구독 계층: 제주 = 7곳(옛 이름 포함)', PH.expandToMinorZones(['제주']).length === 7 && PH.expandToMinorZones(['제주']).includes(OLD));
    ok('푸시 차단 없음', !ZS.isPushBlocked(OLD) && !ZS.isPushBlocked(W));
    {
        const snap = new C.StateSnapshot({ parents: new Map([[OLD, info('주의보')]]) });
        const t = C._buildZoneTreeFromSnapshot(snap);
        ok('옛 구역 MMIS 특보가 나무에 그대로', t['제주도']['제주도먼바다'][OLD].current && t['제주도']['제주도먼바다'][OLD].current.wrnLvl === '주의보');
        sent.length = 0;
        await ps.processChanges([{ type: 'CURRENT_CHANGE', zone: OLD, prev: null, curr: { wrnTp: '풍랑', wrnLvl: '주의보', tmFc: '2026년 11월 25일 16시 00분', tmEf: '2026년 11월 25일 18시 00분' }, childState: { all: [], active: [], added: [], released: [] } }]);
        ok('옛 구역 푸시가 나간다(전환 전)', sent.length === 1 && JSON.stringify(sent[0]).includes(OLD), sent.length);
    }

    console.log('C. 전환 후 — 이름 해석');
    ZS._forceForTest(true);
    ok('뼈대: 제주도먼바다 잎 4개(새 두 이름 + 안쪽 둘), 옛 잎 없음', far(C._buildZoneTreeFromSnapshot(null)).join() === [W, E, '제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다'].join(), far(C._buildZoneTreeFromSnapshot(null)));
    ok('통보문: 옛 이름 = 두 구역 모두', parentsOf(OLD).join() === [E, W].sort().join(), parentsOf(OLD));
    ok('통보문: 제주도먼바다 = 4구역', parentsOf('제주도먼바다').join() === ['제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다', E, W].sort().join(), parentsOf('제주도먼바다'));
    ok('통보문: 제주도전해상 = 8구역(앞바다 4 + 먼바다 4)', parentsOf('제주도전해상').length === 8 && parentsOf('제주도전해상').filter((x) => /앞바다$/.test(x)).length === 4, parentsOf('제주도전해상'));
    ok('통보문: 제주도먼바다(옛 이름) = 바깥 둘만(안쪽에 안 번진다)', parentsOf('제주도먼바다(' + OLD + ')').join() === [E, W].sort().join(), parentsOf('제주도먼바다(' + OLD + ')'));
    ok('통보문: 제주도먼바다(남서쪽바깥) = 그 하나만', parentsOf('제주도먼바다(' + W + ')').join() === W, parentsOf('제주도먼바다(' + W + ')'));
    ok('통보문: 새 이름 단독', parentsOf(E).join() === E);
    ok('통보문: 띄어 쓴 새 이름', parentsOf('제주도 남서쪽 바깥먼바다'.replace(/\s+/g, '')).join() === W);
    ok('통보문: 안쪽먼바다는 그대로', parentsOf('제주도남서쪽안쪽먼바다').join() === '제주도남서쪽안쪽먼바다');
    ok('묶음표: 제주도먼바다 4 · 제주도전해상 8 · 키는 그대로 21개', ZONE_GROUP_MAP['제주도먼바다'].length === 4 && ZONE_GROUP_MAP['제주도전해상'].length === 8 && Object.keys(ZONE_GROUP_MAP).length === 21 && !ZONE_GROUP_MAP['제주도전해상'].includes(OLD));
    ok('묶음표를 글자로 바꿔도 새 이름', JSON.stringify(ZONE_GROUP_MAP).includes(W) && !JSON.stringify(ZONE_GROUP_MAP).includes(OLD));
    ok('구독 계층: 제주 = 8곳(새 두 이름)', PH.expandToMinorZones(['제주']).length === 8 && PH.expandToMinorZones(['제주해역']).includes(W) && !PH.expandToMinorZones(['제주']).includes(OLD));
    ok('구독: 옛 이름으로 저장된 구독 = 새 두 구역 구독', PH.expandToMinorZones([OLD, '울산앞바다']).sort().join() === ['울산앞바다', E, W].sort().join(), PH.expandToMinorZones([OLD]));

    console.log('D. 전환 후 — 통보문 기준 특보현황(실제 계산)');
    {
        // 25일(옛 이름) 발표 → 26일에도 두 구역으로 이어진다 · 26일 새 이름 한쪽만 해제
        const mk = (ho, tmFc, t1, t2, t3, t6) => ({ office: '184', rpt: '6', result: { tmFc, tmIn: tmFc, t1Title: ho, t1, t2, t3, t4: '', t6, t7: '' } });
        const b1 = mk('제11-90호', '2026-11-25 16:00:00.0', '풍랑주의보 발표', '(1) 풍랑주의보 발표 : ' + OLD, '(1) 풍랑주의보 발표 : 2026년 11월 25일 18시 00분', 'o 풍랑주의보 : ' + OLD);
        const now1 = Date.parse('2026-11-26T01:00:00+09:00');
        const r1 = BS.compute([b1], now1, []);
        ok('옛 이름으로 발표된 특보가 새 두 구역에 주의보', r1.zones[W] && r1.zones[E] && r1.zones[W].level === '주의보' && !r1.zones[OLD], Object.keys(r1.zones));
        const leaf = (t, n) => t['제주도']['제주도먼바다'][n];
        ok('통보문 기준 나무의 두 잎에 발효 중(출처 BULLETIN)', leaf(r1.tree, W).current && leaf(r1.tree, E).current && leaf(r1.tree, W).current.source === 'BULLETIN', leaf(r1.tree, W));
        const b2 = mk('제11-91호', '2026-11-26 04:00:00.0', '풍랑주의보 해제', '(1) 풍랑주의보 해제 : ' + E, '(1) 풍랑주의보 해제 : 2026년 11월 26일 05시 00분', 'o 풍랑주의보 : ' + W);
        const r2 = BS.compute([b1, b2], Date.parse('2026-11-26T06:00:00+09:00'), []);
        ok('새 이름 한쪽(남동쪽)만 해제 → 남서쪽만 남는다', r2.zones[W] && !r2.zones[E], Object.keys(r2.zones));

        // 끼우기: MMIS 나무의 두 잎 = 통보문 기준 값, 나머지 잎 = MMIS 값
        const snap = new C.StateSnapshot({ parents: new Map([[OLD, info('경보')], [W, info('경보')], ['제주도남부앞바다', info('주의보')]]) });
        ok('MMIS 가 새 이름으로 줘도(경보) 뼈대의 옛 잎은 없다', !('제주도남쪽바깥먼바다' in C._buildZoneTreeFromSnapshot(snap)['제주도']['제주도먼바다']));
        const cur = C._buildZoneTreeFromSnapshot(snap), prv = C._buildZoneTreeFromSnapshot(null);
        const origRead = BS.read;
        BS.read = () => ({ updatedAt: new Date().toISOString(), listsOkMs: Date.now(), current: r2.tree });
        C._graftBulletinSplitZones(cur, prv, { current: r1.tree });
        ok('남서쪽바깥 잎 = 통보문 기준 주의보(MMIS 경보가 아니다)', leaf(cur, W).current && leaf(cur, W).current.wrnLvl === '주의보' && leaf(cur, W).current.source === 'BULLETIN', leaf(cur, W).current);
        ok('남동쪽바깥 잎 = 특보 없음(통보문이 해제)', leaf(cur, E).current === null);
        ok('다른 구역은 MMIS 값 그대로', cur['제주도']['제주도앞바다']['제주도남부앞바다'].current.source === 'MARINE_MMIS');
        ok('previous 의 두 잎 = 직전에 보이던 값', leaf(prv, E).current && leaf(prv, E).current.wrnLvl === '주의보');
        // 전환 직후 첫 주기 — 통보문 계산이 아직 전환 전 것(옛 이름 잎)이면 그 값을 두 잎에
        ZS._forceForTest(false); const pre = BS.compute([b1], now1, []); ZS._forceForTest(true);
        BS.read = () => ({ updatedAt: new Date().toISOString(), listsOkMs: Date.now(), current: pre.tree, splitCurrent: pre.splitTree });
        const cur3 = C._buildZoneTreeFromSnapshot(snap);
        C._graftBulletinSplitZones(cur3, C._buildZoneTreeFromSnapshot(null), null);
        ok('전환 첫 주기(통보문 계산이 옛 이름 잎) → 두 잎에 그 특보가 보인다', leaf(cur3, W).current && leaf(cur3, E).current && leaf(cur3, W).current.wrnLvl === '주의보');
        // 참고사항 AI 덧씌움은 일반 사용자에게 나가는 두 잎에 섞이지 않는다
        const withAi = BS.compute([b1], now1, [{ 종류: '해제예고변경', zones: [W], exact: true, office: '제주청', ho: 'x', inMs: now1, 시간_후: 'AI가 바꾼 글자' }]);
        ok('AI 덧씌움: 관리자 나무에는 반영, 사용자용(splitTree)에는 없음', leaf(withAi.tree, W).current.clrNtcTm.includes('AI') && !String(leaf(withAi.splitTree, W).current.clrNtcTm).includes('AI'), [leaf(withAi.tree, W).current.clrNtcTm, leaf(withAi.splitTree, W).current.clrNtcTm]);
        ok('괄호로 한쪽만: 옛 이름(남서쪽바깥) = 남서쪽만', parentsOf(OLD + '(' + W + ')').join() === W && parentsOf(OLD + '(' + E + ' 제외)'.replace(' ', '')).join() === W, [parentsOf(OLD + '(' + W + ')')]);
        BS.read = () => null;
        const cur2 = C._buildZoneTreeFromSnapshot(snap);
        C._graftBulletinSplitZones(cur2, C._buildZoneTreeFromSnapshot(null), null);
        ok('통보문 기준을 못 읽으면 두 잎은 비고 예외 없음', leaf(cur2, W).current === null && leaf(cur2, E).current === null);
        BS.read = origRead;
    }

    console.log('E. 전환 후 — 푸시 차단');
    ok('옛 이름·새 두 이름·띄어 쓴 이름 차단', ZS.isPushBlocked(OLD) && ZS.isPushBlocked(W) && ZS.isPushBlocked(E) && ZS.isPushBlocked('제주도 남동쪽 바깥먼바다'));
    ok('MMIS 가 줄여 준 이름도 차단(「제주도남서쪽 바깥」)', ZS.isPushBlocked('제주도남서쪽 바깥') && ZS.isPushBlocked('제주도남동쪽바깥') && ZS.isPushBlocked('제주도바깥먼바다'));
    ok('다른 구역은 안 막는다(안쪽먼바다·앞바다)', !ZS.isPushBlocked('제주도남서쪽안쪽먼바다') && !ZS.isPushBlocked('제주도남부앞바다') && !ZS.isPushBlocked('서해남부남쪽바깥먼바다'));
    {
        const CS = { all: [], active: [], added: [], released: [] };
        const chg = (zone) => ({ type: 'CURRENT_CHANGE', zone, prev: null, curr: { wrnTp: '풍랑', wrnLvl: '주의보', tmFc: '2026년 11월 26일 04시 00분', tmEf: '2026년 11월 26일 06시 00분' }, childState: CS });
        sent.length = 0;
        await ps.processChanges([chg(W), chg(E), chg(OLD)]);
        ok('막힌 구역뿐이면 아무것도 안 보낸다', sent.length === 0, sent.length);
        sent.length = 0;
        await ps.processChanges([chg(W), chg('제주도남동쪽안쪽먼바다')]);
        const body = JSON.stringify(sent);
        ok('섞여 있으면 다른 구역만 보낸다', sent.length >= 1 && body.includes('제주도남동쪽안쪽먼바다') && !body.includes(W), sent.length);
        const f = ZS.filterPushItems([{ zones: ['제주도남부앞바다', OLD] }, { zones: [W] }, { zones: ['울산앞바다'] }]);
        ok('발송 묶음: 그 구역만 빼고 빈 묶음은 버린다', f.cut === 2 && f.items.length === 2 && f.items[0].zones.join() === '제주도남부앞바다' && f.items[1].zones.join() === '울산앞바다', f);
        const same = [{ zones: ['울산앞바다'] }];
        ok('막을 것이 없으면 받은 그대로', ZS.filterPushItems(same).items === same && ZS.filterPushItems(same).cut === 0);
        const la = require('../services/location_alert_dispatch').extractActiveWarnings;
        if (typeof la === 'function') {
            const t = C._buildZoneTreeFromSnapshot(new C.StateSnapshot({ parents: new Map([['제주도남부앞바다', info('주의보')]]) }));
            t['제주도']['제주도먼바다'][W].current = { wrnTp: '풍랑', wrnLvl: '주의보' };
            const got = la(t).map((w) => w.zone);
            ok('위치기반 알림 대상에서도 빠진다', got.includes('제주도남부앞바다') && !got.includes(W), got);
        }
    }

    console.log('F. 지도 구역 그림 분할');
    {
        const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson'), 'utf8'));
        const out = WS.splitFeatures(src);
        const nm = (f) => f.properties.name.replace(/\s+/g, '');
        const fw = out.features.find((f) => nm(f) === W), fe = out.features.find((f) => nm(f) === E);
        ok('원본 44개 → 분할본 45개, 원본은 그대로', src.features.length === 44 && out.features.length === 45 && src.features.some((f) => nm(f) === OLD));
        ok('옛 도형이 없고 새 도형 둘이 있다', fw && fe && !out.features.some((f) => nm(f) === OLD));
        const rw = fw.geometry.coordinates[0][0], re = fe.geometry.coordinates[0][0];
        const LON = 126 + 17 / 60 + 40 / 3600;
        const onLine = (r) => r.filter((p) => Math.abs(p[0] - LON) < 1e-4);
        const key = (p) => p.join(',');
        const shared = onLine(rw).map(key).filter((k) => onLine(re).map(key).includes(k));
        ok("경계 = 동경 126°17'40\" — 두 도형이 경계의 두 점을 똑같은 좌표로 함께 쓴다(틈 없음)", new Set(shared).size === 2, shared);
        ok('경계 북쪽 끝 = 32°15\'09"N(안쪽먼바다 경계의 남쪽 끝)', shared.some((k) => Math.abs(+k.split(',')[1] - (32 + 15 / 60 + 9 / 3600)) < 1e-4), shared);
        ok('서쪽 도형은 전부 경계 서쪽, 동쪽 도형은 전부 동쪽', rw.every((p) => p[0] <= LON + 1e-4) && re.every((p) => p[0] >= LON - 1e-4));
        const area = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
        const old = src.features.find((f) => nm(f) === OLD).geometry.coordinates[0][0];
        ok('두 도형 넓이의 합 = 옛 도형(바깥 테두리 불변)', Math.abs(area(rw) + area(re) - area(old)) < 1e-4, [area(rw), area(re), area(old)]);
        ok('남서쪽이 더 크다', area(rw) > area(re));
        ok('도형이 닫혀 있다', key(rw[0]) === key(rw[rw.length - 1]) && key(re[0]) === key(re[re.length - 1]));
        ok('새 구역코드는 지어내지 않는다(빈 값)', fw.properties.WarnCode === '' && fe.properties.WarnCode === '');
        // 부이 소속(사용자: 부이의 경위도로 다시 매핑) — client/buoyLocations.js 좌표
        const bl = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'buoyLocations.js'), 'utf8');
        const lonOf = (id) => +((bl.match(new RegExp('"' + id + '":\\s*\\{[^}]*lon:\\s*([0-9.]+)')) || [])[1]);
        ok('부이 22300(남해239)은 경계 서쪽, 22301(남해465)은 동쪽', lonOf('22300') < LON && lonOf('22301') > LON, [lonOf('22300'), lonOf('22301')]);
        const mp = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'shared', 'utils', 'mappings.js'), 'utf8');
        ok('부이 매핑표: 남서쪽바깥 = 22300, 남동쪽바깥 = 22301', new RegExp("'" + W + "':\\s*\\[\\s*\\{ id: '22300'[^\\]]*\\]").test(mp) && new RegExp("'" + E + "':\\s*\\[\\s*\\{ id: '22301'[^\\]]*\\]").test(mp));
    }

    console.log('G. 화면 쪽 짝(client/js/core/zone_split.js)');
    {
        const load = (force, store) => {
            const win = { __ZONE_SPLIT_FORCE: force, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, setTimeout: () => 0, console };
            new Function('window', 'globalThis', 'console', fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'core', 'zone_split.js'), 'utf8'))(win, win, console);
            return win.ZoneSplit;
        };
        const s0 = { weatherAppSettings_v1: JSON.stringify({ [OLD]: false, '울산앞바다': true }) };
        const z0 = load(false, s0);
        ok('서버와 같은 시각·같은 이름', z0.AT_MS === ZS.AT_MS && z0.OLD === ZS.OLD && z0.NEW.join() === ZS.NEW.join());
        ok('전환 전: 저장값·목록을 건드리지 않는다', JSON.parse(s0.weatherAppSettings_v1)[OLD] === false && z0.splitNames([OLD]).join() === OLD && !z0.isPending(W));
        const s1 = { weatherAppSettings_v1: JSON.stringify({ [OLD]: false, '울산앞바다': true }) };
        const z1 = load(true, s1), after = JSON.parse(s1.weatherAppSettings_v1);
        ok('전환 후: 옛 구역 끔 → 새 두 구역 끔, 옛 키 삭제', after[W] === false && after[E] === false && !(OLD in after) && after['울산앞바다'] === true, after);
        ok('전환 후: 목록의 옛 이름 → 새 두 이름', z1.splitNames(['제주도남동쪽안쪽먼바다', OLD]).join() === ['제주도남동쪽안쪽먼바다', W, E].join());
        ok('전환 후: 새 두 구역만 「수정 진행 중」', z1.isPending(W) && z1.isPending(E) && !z1.isPending('제주도남동쪽안쪽먼바다') && !z1.isPending(OLD));
        ok('버튼 안내 문구(사용자 지정)', z1.MSG_BUTTON.replace(/\n/g, ' ') === '기상청 특보구역 변경에 따른 수정 진행 중입니다.');
        const s2 = { weatherAppSettings_v1: JSON.stringify({ '울산앞바다': false }) };
        load(true, s2);
        ok('옛 키가 없으면(=켬) 저장값을 안 건드린다', s2.weatherAppSettings_v1 === JSON.stringify({ '울산앞바다': false }));
    }

    ZS._forceForTest(null);
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
