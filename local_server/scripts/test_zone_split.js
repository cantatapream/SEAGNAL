/**
 * 구역 분할(제주도남쪽바깥먼바다 → 남서쪽·남동쪽바깥먼바다) 검사.
 * 실행: node local_server/scripts/test_zone_split.js
 * 시계·운영 상태 파일을 보지 않는다 — 전환 전/후를 _forceForTest 로 고정하고, 전환 감지는 임시 상태 파일로 본다(언제 돌려도 같은 결과).
 * 사용자 확정(2026-11-22·24) 한 줄씩:
 *   ① 전환 = MMIS 가 새 구역코드를 쓰기 시작할 때, 또는 25일부터 옛 구역에 특보가 없을 때 — 그 전엔 종전 그대로
 *   ② 인덱스 카드·지도 구역이 2개로  ③ 옛 이름 = 두 구역 모두 · 제주도먼바다 = 4 · 제주도전해상 = 8
 *   ④ 특보는 MMIS 그대로(새 코드 S1324120·S1324220), 푸시도 연다 — 옛 구역 구독자는 두 구역을 이어받는다
 *   ⑤ 전환 순간 발효 중이던 특보는 거짓 「해제·발효」 없이 두 구역으로 이어진다
 *   ⑥ 2차 개편(2026-11-28, H절): 서해중부 2→4 · 남해동부 2→3(남해동부안쪽은 이름 그대로) · 전남→전남광주 보이는 이름 — 늘 적용
 * [연계] config/zone_split · marine_warning_crawler · analysis/bulletin_survey/lifecycle_check · services/bulletin_status ·
 *        config/zone_group_map · services/push_helpers · push_sender · services/warn_zones_split · client/js/core/zone_split.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
// 전환 상태 파일은 임시 폴더에(운영 data/ 를 건드리지 않는다) — zone_split 을 불러오기 전에 정한다
process.env.ZONE_SPLIT_STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zs-')), 'state.json');
delete process.env.ZONE_SPLIT_FORCE; delete process.env.ZONE_SPLIT_AT;
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
    console.log('A. 전환 조건(감지)');
    {
        const reset = () => { try { fs.unlinkSync(process.env.ZONE_SPLIT_STATE_FILE); } catch (_) {} ZS._forceForTest(null); };
        const NOON = Date.parse('2026-11-25T00:00:00+09:00');   // 준비 시각(25일이 되는 순간)
        reset();
        ok('준비 시각 = 2026-11-25 00:00 KST(「내일 특보가없는 순간」)', ZS.QUIET_FROM_MS === NOON, ZS.QUIET_FROM_MS);
        ok('처음에는 전환 전', ZS.isActive() === false);
        ok('새 코드도 없고 옛 특보가 살아 있으면 그대로', ZS.observe({ newCodeSeen: null, oldZoneHasWarning: true, nowMs: NOON - 3600e3 }).activated === false && !ZS.isActive());
        const r1 = ZS.observe({ newCodeSeen: 'S1324220', nowMs: NOON - 3600e3 });
        ok('① 새 코드를 보는 즉시 전환(준비 시각 전이어도, 옛 특보가 살아 있어도)', r1.activated === true && ZS.isActive() && /S1324220/.test(r1.reason), r1);
        reset();
        const rb = ZS.observe({ bulletinNewName: W, nowMs: NOON - 3600e3 });
        ok('①-2 통보문이 새 구역 이름으로 특보를 내면 즉시 전환', rb.activated === true && ZS.isActive() && /통보문/.test(rb.reason), rb);
        {
            // 통보문의 어느 칸을 보나 — 구역 칸만(참고사항의 예고 문장으로는 안 넘어간다)
            const BW = require('../services/bulletin_watch'), orig = BW.bulletins;
            const mkB = (rpt, r) => ({ office: '제주청', rpt, result: Object.assign({ t1: '', t2: '', t4: '', t6: '', other: '' }, r) });
            BW.bulletins = () => [mkB('6', { t2: '(1) 풍랑주의보 발표 : 제주도남쪽바깥먼바다', t6: 'o 풍랑주의보 : 제주도남쪽바깥먼바다', other: '26일부터 제주도남쪽바깥먼바다는 제주도남서쪽바깥먼바다와 제주도남동쪽바깥먼바다로 나뉩니다.' })];
            ok('참고사항의 예고 문장(새 이름)으로는 안 본 것', C._newNameInBulletins() === null, C._newNameInBulletins());
            BW.bulletins = () => [mkB('6', { t2: '(1) 풍랑주의보 발표 : 제주도 남서쪽 바깥먼바다' })];
            ok('특보 통보문 해당 구역 칸의 새 이름(띄어 써도) → 봄', C._newNameInBulletins() === W, C._newNameInBulletins());
            BW.bulletins = () => [mkB('6', { t2: '(1) 풍랑주의보 해제 : 제주도남쪽바깥먼바다', t6: 'o 풍랑주의보 : 제주도남동쪽바깥먼바다' })];
            ok('발효 현황 칸의 새 이름 → 봄', C._newNameInBulletins() === E);
            BW.bulletins = () => [mkB('7', { t4: '(1) 풍랑 예비특보<br>o 11월 26일 오후(12시~18시) : 제주도남서쪽바깥먼바다, 제주도남동쪽바깥먼바다' })];
            ok('예비특보 통보문 목록의 새 이름 → 봄', C._newNameInBulletins() === W);
            BW.bulletins = () => { throw new Error('수집 꺼짐'); };
            ok('통보문을 못 읽으면 「못 봤다」(예외 없음)', C._newNameInBulletins() === null);
            BW.bulletins = orig;
        }
        reset(); ZS.observe({ newCodeSeen: 'S1324220', nowMs: NOON - 3600e3 });
        ok('전환은 파일에 남는다(다시 켜도 이어진다)', JSON.parse(fs.readFileSync(process.env.ZONE_SPLIT_STATE_FILE, 'utf8')).active === true && (ZS._forceForTest(null), ZS.isActive()));
        ok('전환 상태에 시각·사유가 있고 알림은 아직 「전달 안 됨」', ZS.status().active && !!ZS.status().at && /S1324220/.test(ZS.status().reason) && ZS.status().notified === false, ZS.status());
        ZS.markNotified();
        ok('알림 전달 표시는 파일에 남는다', ZS.status().notified === true && JSON.parse(fs.readFileSync(process.env.ZONE_SPLIT_STATE_FILE, 'utf8')).notified === true && (ZS._forceForTest(null), ZS.status().notified === true));
        ok('전환 뒤에는 다시 전환하지 않는다', ZS.observe({ newCodeSeen: 'S1324120', oldZoneHasWarning: false, nowMs: NOON + 1 }).activated === false);
        reset();
        const quiet = (n, from, has, ok2) => { let r = null; for (let k = 0; k < n; k++) r = ZS.observe({ oldZoneHasWarning: !!has, mmisOk: ok2 !== false, nowMs: from + k * 60e3 }); return r; };
        ok('② 준비 시각 전에는 특보가 없어도(20분) 안 넘어간다', quiet(20, NOON - 30 * 60e3, false).activated === false && !ZS.isActive());
        reset();
        ok('② 준비 시각 뒤라도 옛 구역에 특보가 있으면 안 넘어간다', quiet(20, NOON, true).activated === false && !ZS.isActive());
        ok('② 특보 없음 9분 → 아직(MMIS 가 몇 분 빈 응답을 줘도 속지 않는다)', quiet(9, NOON + 3600e3, false).activated === false && !ZS.isActive());
        ok('② 사이에 특보가 다시 보이면 처음부터 다시 센다', quiet(1, NOON + 2 * 3600e3, true).activated === false && quiet(9, NOON + 3 * 3600e3, false).activated === false && !ZS.isActive());
        ok('② MMIS 를 못 받은 주기는 「특보 없음」으로 세지 않는다(다시 센다)', quiet(1, NOON + 4 * 3600e3, false, false).activated === false && quiet(9, NOON + 5 * 3600e3, false).activated === false && !ZS.isActive());
        const r2 = quiet(1, NOON + 6 * 3600e3, false);
        ok('② 준비 시각 뒤 특보 없음 10분 연속 → 전환', r2.activated === true && ZS.isActive(), r2);
        reset();
        process.env.ZONE_SPLIT_FORCE = 'on'; ok('손으로 켜기(ZONE_SPLIT_FORCE=on)', ZS.isActive() === true && ZS.observe({ newCodeSeen: 'S1324220' }).activated === false);
        process.env.ZONE_SPLIT_FORCE = 'off'; ok('손으로 끄기(ZONE_SPLIT_FORCE=off)', ZS.isActive() === false);
        process.env.ZONE_SPLIT_FORCE = 'true'; ok('on·off 가 아닌 값은 무시한다(감지는 그대로 돈다)', ZS.isActive() === false && ZS.observe({ newCodeSeen: 'S1324120', nowMs: NOON }).activated === true);
        delete process.env.ZONE_SPLIT_FORCE; reset();
        ok('MMIS 코드표에 새 코드 둘 + 옛 코드', C.MMIS_CODE_TO_NAME.S1324120 === E && C.MMIS_CODE_TO_NAME.S1324220 === W && C.MMIS_CODE_TO_NAME.S1324020 === OLD);
        ok('코드표와 전환 감지의 코드가 같다', ZS.NEW_CODES.S1324120 === E && ZS.NEW_CODES.S1324220 === W && ZS.OLD_CODE === 'S1324020');
    }

    console.log('B. 전환 전 — 종전 그대로');
    ZS._forceForTest(false);
    ok('뼈대: 제주도먼바다 잎 3개(옛 이름)', far(C._buildZoneTreeFromSnapshot(null)).join() === [OLD, '제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다'].join(), far(C._buildZoneTreeFromSnapshot(null)));
    ok('통보문: 옛 이름 = 옛 구역 1개', parentsOf(OLD).join() === OLD, parentsOf(OLD));
    ok('통보문: 제주도먼바다 = 3', parentsOf('제주도먼바다').length === 3);
    ok('통보문: 제주도전해상 = 7', parentsOf('제주도전해상').length === 7);
    ok('묶음표: 제주도먼바다 3 · 제주도전해상 7 · 키 21개', ZONE_GROUP_MAP['제주도먼바다'].length === 3 && ZONE_GROUP_MAP['제주도전해상'].length === 7 && Object.keys(ZONE_GROUP_MAP).length === 21);
    ok('구독 계층: 제주 = 7곳(옛 이름 포함)', PH.expandToMinorZones(['제주']).length === 7 && PH.expandToMinorZones(['제주']).includes(OLD));
    {
        const snap = new C.StateSnapshot({ parents: new Map([[OLD, info('주의보')]]) });
        ok('전환 전에는 옛 구역을 접지 않는다', C._foldOldSplitZone(snap) === 0 && snap.parents.has(OLD));
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

    console.log('D. 전환 후 — MMIS 특보 표출');
    {
        const leaf = (t, n) => t['제주도']['제주도먼바다'][n];
        // 새 코드로 온 줄 → 새 구역 이름(줄인 이름이 와도 코드로 읽는다)
        const row = (cd, nm) => ({ warn_zone_cd: cd, warn_zone_nm: nm, warn_tp: 'V', warn_lvl: '2', warn_tp_nm: '풍랑', warn_lvl_nm: '주의보', tm_fc: '2026.11.25 16:00', tm_ef: '2026.11.25 18:00', warn_cmd: '1' });
        const snapNew = C._buildSnapshotFromMarine([row('S1324220', '제주도남서쪽 바깥'), row('S1324110', '제주도남동쪽안쪽먼바다')], [], [], []);
        ok('MMIS 새 코드 S1324220(이름을 줄여 줘도) → 제주도남서쪽바깥먼바다', snapNew.parents.has(W) && !snapNew.parents.has(E) && snapNew.parents.has('제주도남동쪽안쪽먼바다'), [...snapNew.parents.keys()]);
        const tNew = C._buildZoneTreeFromSnapshot(snapNew);
        ok('나무: 남서쪽바깥 잎에 MMIS 주의보, 남동쪽바깥은 없음', leaf(tNew, W).current && leaf(tNew, W).current.source === 'MARINE_MMIS' && leaf(tNew, W).current.wrnLvl === '주의보' && leaf(tNew, E).current === null);
        // 전환 뒤에도 옛 코드로 오면(기상청 작업 전) = 두 구역 모두
        const snapOld = C._buildSnapshotFromMarine([row('S1324020', OLD)], [], [], []);
        ok('옛 코드 줄은 옛 이름으로 읽힌 뒤', snapOld.parents.has(OLD));
        ok('접으면 두 구역의 특보가 된다', C._foldOldSplitZone(snapOld) === 2 && !snapOld.parents.has(OLD) && snapOld.parents.has(W) && snapOld.parents.has(E) && snapOld.parents.get(W) !== snapOld.parents.get(E));
        const tOld = C._buildZoneTreeFromSnapshot(snapOld);
        ok('나무: 두 잎 모두 주의보', leaf(tOld, W).current && leaf(tOld, E).current && leaf(tOld, E).current.wrnLvl === '주의보');
        // 새 코드 값이 이미 있으면 그것을 둔다
        const mix = new C.StateSnapshot({ parents: new Map([[OLD, info('주의보')], [W, info('경보')]]) });
        C._foldOldSplitZone(mix);
        ok('새 코드로 온 값이 있으면 덮지 않는다(남서쪽 경보 유지, 남동쪽만 옛 값)', mix.parents.get(W).wrnLvlNm === '경보' && mix.parents.get(E).wrnLvlNm === '주의보' && !mix.parents.has(OLD));
        // 옛 코드로는 발효 중, 새 코드로는 예비만(코드가 섞여 오는 동안) → 발효를 지우지 않는다
        const mix2 = new C.StateSnapshot({ parents: new Map([[OLD, info('주의보')], [W, info('예비')]]) });
        C._foldOldSplitZone(mix2);
        ok('옛 코드 발효 + 새 코드 예비 → 발효 유지, 예비는 다가오는 특보로', mix2.parents.get(W).wrnLvlNm === '주의보' && mix2.upcomings.get(W) && mix2.upcomings.get(W).wrnLvlNm === '예비' && mix2.parents.get(E).wrnLvlNm === '주의보');
        const up = new C.StateSnapshot({ upcomings: new Map([[OLD, info('예비')]]) });
        ok('다가오는 특보(예비)도 같이 옮긴다', C._foldOldSplitZone(up) === 2 && up.upcomings.has(W) && up.upcomings.has(E));
        ok('옛 구역이 없으면 아무 일도 안 한다', C._foldOldSplitZone(new C.StateSnapshot({ parents: new Map([['제주도남부앞바다', info('주의보')]]) })) === 0);

        // ⑤ 전환 순간: 직전(옛 이름 발효 중) → 이번(새 코드 둘) — 접은 뒤 비교하면 변화가 없다(거짓 해제·발효 없음)
        const prev = new C.StateSnapshot({ parents: new Map([[OLD, info('주의보')], ['제주도남부앞바다', info('주의보')]]) });
        const curr = new C.StateSnapshot({ parents: new Map([[W, info('주의보')], [E, info('주의보')], ['제주도남부앞바다', info('주의보')]]) });
        C._foldOldSplitZone(curr); C._foldOldSplitZone(prev);
        const ch = C._buildUserPushChanges(prev, curr);
        ok('전환 주기: 옛 구역 「해제」·새 구역 「발효」 변화가 없다', ch.length === 0, ch.map((c) => c.type + ':' + c.zone));
        // 통보문이 옛 이름으로 취소를 적어도 새 두 구역의 취소다(예비취소 푸시 확정)
        const SC = require('../services/bulletin_cancel_scanner');
        {
            const rel = SC.parseCancelPhrases('참고사항 o 제주도남쪽바깥먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')[0];
            const got = rel ? [SC.matchesZone(rel, W), SC.matchesZone(rel, E), SC.matchesZone(rel, '제주도남서쪽안쪽먼바다')] : 'no release';
            ok('취소 문구가 옛 이름이어도 새 두 구역에 맞고 안쪽먼바다에는 안 맞는다', Array.isArray(got) && got[0] === true && got[1] === true && got[2] === false, got);
        }
        // 이름 열쇠 기억 옮기기(전환 뒤) — 옛 이름으로 남으면 보류실이 옛 이름으로 푸시를 내고 「해제시각 확정」이 한 번 더 나간다
        {
            C._resetCancelVerdictsForTest();
            ZS._forceForTest(false);
            C._registerParentCancelVerdict(OLD, { wrnTp: '풍랑', wrnLvl: '예비', tmFc: '2026년 11월 24일 16시 00분', tmEf: '25일 오전(06시~12시)' });   // 전환 전에 옛 이름으로 보류실 등록
            const keysBefore = Object.keys(C._loadCancelVerdicts().parents);
            ZS._forceForTest(true);
            const moved = C._migrateSplitMemories();
            const v = C._loadCancelVerdicts().parents, keys = Object.keys(v);
            ok('보류실: 옛 이름 항목 → 새 두 이름 항목(옛 항목 없음)', keysBefore.length === 1 && keysBefore[0].startsWith(OLD) && moved >= 2 && keys.length === 2 && keys.some((k) => k.startsWith(W + '|')) && keys.some((k) => k.startsWith(E + '|')) && !keys.some((k) => k.startsWith(OLD)), keys);
            ok('보류실 항목 안의 구역 이름도 새 이름', keys.every((k) => !v[k].zone || v[k].zone === k.split('|')[0]), keys.map((k) => v[k].zone));
            ok('다시 불러도 그대로(여러 번 안전)', C._migrateSplitMemories() === 0 && Object.keys(C._loadCancelVerdicts().parents).length === 2);
            C._resetCancelVerdictsForTest();
        }
        // 통보문 기준(관리자 [통보문] 비교)도 새 이름으로 계산된다
        const mk = (ho, tmFc, t1, t2, t3, t6) => ({ office: '184', rpt: '6', result: { tmFc, tmIn: tmFc, t1Title: ho, t1, t2, t3, t4: '', t6, t7: '' } });
        const b1 = mk('제11-90호', '2026-11-25 16:00:00.0', '풍랑주의보 발표', '(1) 풍랑주의보 발표 : ' + OLD, '(1) 풍랑주의보 발표 : 2026년 11월 25일 18시 00분', 'o 풍랑주의보 : ' + OLD);
        const r1 = BS.compute([b1], Date.parse('2026-11-26T01:00:00+09:00'), []);
        ok('통보문 기준: 옛 이름으로 발표된 특보가 새 두 구역에', r1.zones[W] && r1.zones[E] && !r1.zones[OLD], Object.keys(r1.zones));
        ok('통보문: 괄호로 한쪽만 — 옛 이름(남서쪽바깥) = 남서쪽만', parentsOf(OLD + '(' + W + ')').join() === W, parentsOf(OLD + '(' + W + ')'));
    }

    console.log('E. 전환 후 — 푸시(연다)');
    {
        const CS = { all: [], active: [], added: [], released: [] };
        const chg = (zone) => ({ type: 'CURRENT_CHANGE', zone, prev: null, curr: { wrnTp: '풍랑', wrnLvl: '주의보', tmFc: '2026년 11월 26일 04시 00분', tmEf: '2026년 11월 26일 06시 00분' }, childState: CS });
        sent.length = 0;
        await ps.processChanges([chg(W), chg(E)]);
        const body = JSON.stringify(sent);
        ok('새 두 구역 특보 푸시가 나간다', sent.length >= 1 && body.includes(W) && body.includes(E), sent.length);
        const items = sent.flatMap((x) => (x.payload && x.payload.items) || []);
        const zonesOf = [...new Set(items.flatMap((it) => it.zones || []))];
        ok('옛 구역 구독자(옛 이름으로 저장)가 새 두 구역 푸시를 받는다', PH.getMatchedZones([OLD], items, { target: 'interest' }).length >= 1, zonesOf);
        ok('「제주」 대분류 구독자도 받는다', PH.getMatchedZones(['제주'], items, { target: 'interest' }).length >= 1);
        ok('다른 구역만 켠 구독자는 안 받는다', PH.getMatchedZones(['울산앞바다'], items, { target: 'interest' }).length === 0);
        ok('새 이름으로 다시 구독한 기기(한쪽만 켬)는 그 구역만', (() => { const m = PH.getMatchedZones([W], items, { target: 'interest' }); const z = [...new Set(m.flatMap((it) => it.zones || []))]; return z.includes(W) && !z.includes(E); })());
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
        ok('새 도형의 구역코드 = 기상청 회신 코드(남서쪽 S1324220 · 남동쪽 S1324120)', fw.properties.WarnCode === 'S1324220' && fe.properties.WarnCode === 'S1324120');
        // 부이 소속(사용자: 부이의 경위도로 다시 매핑) — client/buoyLocations.js 좌표
        const bl = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'buoyLocations.js'), 'utf8');
        const lonOf = (id) => +((bl.match(new RegExp('"' + id + '":\\s*\\{[^}]*lon:\\s*([0-9.]+)')) || [])[1]);
        ok('부이 22300(남해239)은 경계 서쪽, 22301(남해465)은 동쪽', lonOf('22300') < LON && lonOf('22301') > LON, [lonOf('22300'), lonOf('22301')]);
        const mp = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'shared', 'utils', 'mappings.js'), 'utf8');
        ok('부이 매핑표: 남서쪽바깥 = 22300, 남동쪽바깥 = 22301', new RegExp("'" + W + "':\\s*\\[\\s*\\{ id: '22300'[^\\]]*\\]").test(mp) && new RegExp("'" + E + "':\\s*\\[\\s*\\{ id: '22301'[^\\]]*\\]").test(mp));
    }

    console.log('G. 화면 쪽 짝(client/js/core/zone_split.js)');
    {
        const load = (inj, store, force) => {
            const win = { __ZONE_SPLIT__: inj, __ZONE_SPLIT_FORCE: force, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, setTimeout: () => 0, setInterval: () => 0, console };
            new Function('window', 'globalThis', 'console', fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'core', 'zone_split.js'), 'utf8'))(win, win, console);
            return win.ZoneSplit;
        };
        const s0 = { weatherAppSettings_v1: JSON.stringify({ [OLD]: false, '울산앞바다': true }) };
        const z0 = load({ active: false }, s0);
        ok('서버와 같은 이름', z0.OLD === ZS.OLD && z0.NEW.join() === ZS.NEW.join());
        ok('전환 전: 저장값·목록을 건드리지 않는다', JSON.parse(s0.weatherAppSettings_v1)[OLD] === false && z0.splitNames([OLD]).join() === OLD && !z0.isPending(W) && !z0.isActive());
        ok('서버가 실어 준 값이 없으면 전환 전으로 본다', load(undefined, {}).isActive() === false);
        const s1 = { weatherAppSettings_v1: JSON.stringify({ [OLD]: false, '울산앞바다': true }) };
        const z1 = load({ active: true }, s1), after = JSON.parse(s1.weatherAppSettings_v1);
        ok('전환 후: 옛 구역 끔 → 새 두 구역 끔, 옛 키 삭제', after[W] === false && after[E] === false && !(OLD in after) && after['울산앞바다'] === true, after);
        ok('전환 후: 목록의 옛 이름 → 새 두 이름', z1.splitNames(['제주도남동쪽안쪽먼바다', OLD]).join() === ['제주도남동쪽안쪽먼바다', W, E].join());
        ok('전환 후: 새 두 구역만 「수정 진행 중」', z1.isPending(W) && z1.isPending(E) && !z1.isPending('제주도남동쪽안쪽먼바다') && !z1.isPending(OLD));
        ok('한 번 전환을 본 기기는 기억한다(실어 준 값이 없는 길에서도 전환된 화면)', load(undefined, s1).isActive() === true);
        ok('버튼 안내 문구(사용자 지정)', z1.MSG_BUTTON.replace(/\n/g, ' ') === '기상청 특보구역 변경에 따른 수정 진행 중입니다.');
        const s2 = { weatherAppSettings_v1: JSON.stringify({ '울산앞바다': false }) };
        load({ active: true }, s2);
        ok('옛 키가 없으면(=켬) 저장값을 안 건드린다', s2.weatherAppSettings_v1 === JSON.stringify({ '울산앞바다': false }));
        // 부이 버튼은 살아 있다 — 회색으로 바꾸는 것은 버튼 4개뿐(사용자 「부이버튼은 활성화해줘」)
        const rj = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'forecast', 'alerts', 'render.js'), 'utf8');
        // 회색은 해구기상·윈디·종합정보 3개 — 「기상예보」는 연다(사용자 2026-11-27), 부이도 연다(사용자 「부이버튼은 활성화해줘」)
        const wj = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'forecast', 'outlook', 'windy.js'), 'utf8');
        const pendingBlock = (src) => { const i = src.indexOf('ZoneSplit.isPending('); return i < 0 ? '' : src.slice(i, i + 1600); };
        for (const [nm, src] of [['특보현황 카드(render.js)', rj], ['기상현황 카드(windy.js)', wj]]) {
            const blk = pendingBlock(src);
            ok(nm + ': 회색 버튼 = 해구기상·윈디·종합정보', /'해구기상'/.test(blk) && /'윈디'/.test(blk) && /'종합정보'/.test(blk) && !/makeDisabledButton\([^)]*buoy/i.test(blk));
            ok(nm + ': 「기상예보」는 회색으로 만들지 않고 진짜 버튼을 다시 붙인다', !/\['기상예보'/.test(blk) && !/\['기상예보',/.test(blk) && /liveForecast/.test(blk) && !/makeDisabledButton\('기상예보'/.test(blk));
        }
    }

    console.log('H. 2차 개편(2026-11-28 — 서해중부 2→4 · 남해동부 2→3 · 전남광주 이름, 늘 적용)');
    {
        const NI = '서해중부북쪽안쪽먼바다', NO = '서해중부북쪽바깥먼바다', SI = '서해중부남쪽안쪽먼바다', SO = '서해중부남쪽바깥먼바다';
        const IN = '남해동부안쪽먼바다', MID = '남해동부중간먼바다', OUT = '남해동부바깥먼바다';
        for (const jeju of [false, true]) {
            ZS._forceForTest(jeju);
            const tag = jeju ? '(제주 전환 뒤)' : '(제주 전환 전)';
            ok('이름: 서해중부안쪽 = 북쪽안쪽+남쪽안쪽 · 바깥 = 북쪽바깥+남쪽바깥 ' + tag, ZS.splitNames(['서해중부안쪽먼바다', '서해중부바깥먼바다']).join() === [NI, SI, NO, SO].join());
            ok('이름: 남해동부안쪽은 이름이 그대로라 늘리지 않는다 ' + tag, ZS.splitNames([IN]).join() === IN && !ZS.isOldName(IN));
            const t = C._buildZoneTreeFromSnapshot(new C.StateSnapshot());   // 빈 스냅샷 → 뼈대 그대로
            ok('뼈대: 서해중부먼바다 4잎 · 남해동부먼바다 3잎 ' + tag, Object.keys(t['서해']['서해중부해상']['서해중부먼바다']).join() === [NI, NO, SI, SO].join() && Object.keys(t['남해']['남해동부해상']['남해동부먼바다']).join() === [IN, MID, OUT].join());
        }
        ZS._forceForTest(true);
        // MMIS 코드표 — 2026-11-28 실측(warn/list·WFS shp_wrn_poly)
        const codes = { S1252110: NI, S1252120: NO, S1252210: SI, S1252220: SO, S1312030: IN, S1312040: MID, S1312020: OUT };
        ok('MMIS 새 코드 6개 → 새 이름(남해동부바깥 그대로)', Object.entries(codes).every(([c, n]) => C.MMIS_CODE_TO_NAME[c] === n), Object.keys(codes).map((c) => C.MMIS_CODE_TO_NAME[c]));
        ok('폐지 코드: S1252010·S1252020 = 옛 이름 · S1312010 = 옛 넓이 이름표', C.MMIS_CODE_TO_NAME.S1252010 === '서해중부안쪽먼바다' && C.MMIS_CODE_TO_NAME.S1252020 === '서해중부바깥먼바다' && C.MMIS_CODE_TO_NAME.S1312010 === ZS.OLD_INNER_SE);
        ok('코드표 = config/zone_split 새 코드표', Object.entries(ZS.SPLIT2_NEW_CODES).every(([c, n]) => C.MMIS_CODE_TO_NAME[c] === n) && Object.entries(ZS.SPLIT2_OLD_CODES).every(([c, n]) => C.MMIS_CODE_TO_NAME[c] === n));
        // 2026-11-28 실제로 버려지던 줄 — 새 코드 줄이 나무 잎에 닿는다
        const row = (cd, nm, lv) => ({ warn_zone_cd: cd, warn_zone_nm: nm, warn_tp: 'V', warn_lvl: '2', warn_tp_nm: '풍랑', warn_lvl_nm: lv || '주의보', tm_fc: '2026.11.28 00:00', tm_ef: '2026.11.28 03:00', warn_cmd: '1' });
        const snap = C._buildSnapshotFromMarine([row('S1252110', '서해중부 북쪽 안쪽 먼바다'), row('S1252220', '서해중부남쪽바깥먼바다'), row('S1312040', '남해동부중간먼바다'), row('S1312030', '남해동부안쪽먼바다')], [], [], []);
        C._foldOldSplitZone(snap);
        const tr = C._buildZoneTreeFromSnapshot(snap), sea = tr['서해']['서해중부해상']['서해중부먼바다'], se = tr['남해']['남해동부해상']['남해동부먼바다'];
        ok('나무: 서해중부 새 코드 특보가 그 잎에(북쪽안쪽·남쪽바깥), 다른 잎은 비어 있다', sea[NI].current && sea[SO].current && sea[NI].current.wrnLvl === '주의보' && sea[NO].current === null && sea[SI].current === null);
        ok('나무: 남해동부 중간·안쪽 잎에 특보, 바깥은 비어 있다', se[MID].current && se[IN].current && se[OUT].current === null);
        // 옛 코드로 오면 = 새 구역 모두
        const old = C._buildSnapshotFromMarine([row('S1252010', '서해중부안쪽먼바다'), row('S1312010', '남해동부안쪽먼바다')], [], [], []);
        ok('옛 코드 줄: 서해중부안쪽(옛) · 남해동부안쪽(옛 넓이 이름표)으로 읽힌다', old.parents.has('서해중부안쪽먼바다') && old.parents.has(ZS.OLD_INNER_SE) && !old.parents.has(IN));
        const n = C._foldOldSplitZone(old);
        ok('접으면: 서해중부안쪽 → 북쪽안쪽+남쪽안쪽 · 옛 남해동부안쪽 → 안쪽+중간', n === 4 && old.parents.has(NI) && old.parents.has(SI) && old.parents.has(IN) && old.parents.has(MID) && !old.parents.has('서해중부안쪽먼바다') && !old.parents.has(ZS.OLD_INNER_SE), [...old.parents.keys()]);
        ZS._forceForTest(false);
        const old2 = C._buildSnapshotFromMarine([row('S1252020', '서해중부바깥먼바다')], [], [], []);
        ok('제주 전환 전이어도 2차 개편 접기는 한다', C._foldOldSplitZone(old2) === 2 && old2.parents.has(NO) && old2.parents.has(SO));
        ZS._forceForTest(true);
        // 묶음 이름
        ok('묶음: 서해중부먼바다 = 4 · 남해동부먼바다 = 3', ZONE_GROUP_MAP['서해중부먼바다'].join() === [NI, NO, SI, SO].join() && ZONE_GROUP_MAP['남해동부먼바다'].join() === [IN, MID, OUT].join());
        ok('묶음: 서해중부전해상 = 앞바다 4 + 먼바다 4 · 남해동부전해상 = 앞바다 4 + 먼바다 3', ZONE_GROUP_MAP['서해중부전해상'].length === 8 && ZONE_GROUP_MAP['남해동부전해상'].length === 7 && ZONE_GROUP_MAP['남해동부전해상'].includes(MID));
        ok('통보문 해석: 「서해중부안쪽먼바다」 = 북쪽안쪽+남쪽안쪽', parentsOf('서해중부안쪽먼바다').join() === [NI, SI].sort().join(), parentsOf('서해중부안쪽먼바다'));
        ok('통보문 해석: 「서해중부먼바다」 = 4 · 「남해동부먼바다」 = 3', parentsOf('서해중부먼바다').length === 4 && parentsOf('남해동부먼바다').join() === [IN, MID, OUT].sort().join());
        ok('통보문 해석: 새 이름은 그대로 하나', parentsOf(MID).join() === MID && parentsOf(NO).join() === NO);
        ok('옛 이름 찾기: 서해중부 새 구역 → 옛 안쪽/바깥 · 남해동부 → 없음', ZS.oldNamesOf(SI).join() === '서해중부안쪽먼바다' && ZS.oldNamesOf(SO).join() === '서해중부바깥먼바다' && ZS.oldNamesOf(MID).length === 0 && ZS.oldNamesOf(IN).length === 0);
        {
            const SC = require('../services/bulletin_cancel_scanner');
            const rel = SC.parseCancelPhrases('참고사항 o 서해중부안쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다')[0];
            const got = rel ? [SC.matchesZone(rel, NI), SC.matchesZone(rel, SI), SC.matchesZone(rel, NO)] : 'no release';
            ok('취소 문구가 옛 이름(서해중부안쪽)이어도 북쪽안쪽·남쪽안쪽에 맞고 바깥에는 안 맞는다', Array.isArray(got) && got[0] && got[1] && !got[2], got);
        }
        // 구독
        ok('구독 계층: 서해중부해상 = 8곳 · 남해동부해상 = 7곳', PH.expandToMinorZones(['서해중부해상']).length === 8 && PH.expandToMinorZones(['남해동부해상']).length === 7 && PH.expandToMinorZones(['남해동부해상']).includes(MID));
        ok('구독: 옛 서해중부안쪽 구독 = 북쪽안쪽+남쪽안쪽', PH.expandToMinorZones(['서해중부안쪽먼바다']).sort().join() === [NI, SI].sort().join());
        ok('이어받기: 옛 앱 구독(새 앱 표시 zoneSchema 없음)의 남해동부안쪽 = 안쪽+중간', ZS.legacyExpand({ zones: [IN, '부산앞바다'], updatedAt: Date.now() }).join() === [IN, MID, '부산앞바다'].join());
        ok('이어받기: 새 앱 구독(zoneSchema:2) — 안쪽만 고르면 안쪽만', ZS.legacyExpand({ zones: [IN], zoneSchema: 2 }).join() === IN);
        ok('이어받기: 빈 구독(= 전체 수신)은 그대로 비어 있다', ZS.legacyExpand({ zones: [] }).length === 0);
        {
            const items = [{ zones: [MID] }];
            const oldSub = PH.getMatchedZones(ZS.legacyExpand({ zones: [IN] }), items, {});
            const newSub = PH.getMatchedZones(ZS.legacyExpand({ zones: [IN], zoneSchema: 2 }), items, {});
            ok('발송 대상: 중간 특보 → 옛 안쪽 구독자는 받고, 새 앱에서 안쪽만 고른 사람은 안 받는다', oldSub.length === 1 && newSub.length === 0);
        }
        {
            // 누구나 부를 수 있는 /api/subscribe 에 이런 이름이 올라와도 발송이 멈추지 않는다(독립 검토 2026-11-28 재현 — 일반 객체 표의 Object 칸)
            let threw = null; try { ZS.legacyExpand({ zones: ['constructor', '__proto__', 'toString', IN] }); ZS.splitNames(['constructor', 'hasOwnProperty']); ZS.displayName('constructor'); } catch (e) { threw = e.message; }
            ok('이상한 구역 이름(constructor·__proto__ 등)에 예외 없음', threw === null, threw);
            ok('이상한 이름은 그대로 지나간다', ZS.splitNames(['constructor']).join() === 'constructor' && ZS.displayName('toString') === 'toString');
        }
        {
            // 구독 저장과 발송이 이 규칙에 실제로 연결돼 있다(routes/push.js — 표시 저장 1곳 · 이어받기 3곳)
            const pj = fs.readFileSync(path.join(__dirname, '..', 'routes', 'push.js'), 'utf8');
            ok('routes/push.js: 구독에 zoneSchema 저장 · legacyExpand 3곳(개인화 발송·직접 발송·구독자 통계)', /zoneSchema: zoneSchema === 2 \? 2 : undefined/.test(pj) && (pj.match(/legacyExpand\((user|sub)\)/g) || []).length === 3);
            const cj = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'capacitor-plugins.js'), 'utf8');
            ok('capacitor-plugins.js: 구독 본문에 zoneSchema: 2', /zoneSchema: 2/.test(cj));
        }
        // 푸시 글의 보이는 이름(전남 → 전남광주) — 구독 열쇠는 그대로
        const msg = PH.generateMessage({ templateId: 'publish', typeName: '풍랑', level: '주의보', items: [{ zones: ['전남북부서해앞바다', '전남동부남해앞바다', NI], time: '28일 12시' }] });
        ok('푸시 글: 「전남…」 → 「전남광주…」, 새 이름은 그대로', /전남광주북부서해앞바다/.test(msg.body) && /전남광주동부남해앞바다/.test(msg.body) && !/(^|[^광주])전남북부서해/.test(msg.body.replace(/전남광주/g, '')) && msg.body.includes(NI), msg.body);
        ok('보이는 이름 표 = 서버·화면 같다(5곳)', Object.keys(ZS.DISPLAY_RENAME).length === 5);
        // 지도 그림 48개 = 날씨누리 특보(종합) GIS 그림(wrnArea.geojson, 2026-11-28)의 특보구역 코드 48개
        const WN48 = ['S1131100','S1131200','S1131300','S1132110','S1132120','S1132210','S1132220','S1151100','S1151200','S1151300','S1152010','S1152020','S1231100','S1231200','S1231300','S1231400','S1231500','S1232110','S1232120','S1232210','S1232220','S1251100','S1251200','S1251300','S1251400','S1252110','S1252120','S1252210','S1252220','S1311100','S1311200','S1311300','S1311400','S1312020','S1312030','S1312040','S1321100','S1321200','S1322100','S1322200','S1323100','S1323200','S1323300','S1323400','S1324110','S1324120','S1324210','S1324220'];
        const fc = JSON.parse(WS.body()), got = fc.features.map((f) => f.properties.WarnCode).sort();
        ok('지도 그림: 48개 · 코드가 날씨누리·MMIS 목록과 하나도 안 다르다', fc.features.length === 48 && got.join() === WN48.slice().sort().join(), got.filter((c) => !WN48.includes(c)).concat(WN48.filter((c) => !got.includes(c))));
        const nm = (f) => f.properties.name.replace(/\s+/g, '');
        ok('지도 그림: 옛 도형 3개(서해중부안쪽·바깥, 옛 남해동부안쪽 S1312010)가 없다', !fc.features.some((f) => ['서해중부안쪽먼바다', '서해중부바깥먼바다'].includes(nm(f)) || f.properties.WarnCode === 'S1312010'));
        ok('지도 그림: 이름이 뼈대 잎 이름과 같다(화면은 이름으로 맞춘다)', [NI, NO, SI, SO, IN, MID].every((x) => fc.features.some((f) => nm(f) === x)));
        {
            // 새 도형끼리·이웃과 꼭짓점이 맞물린다 — 남해동부 중간의 남쪽 변 = 원본 바깥먼바다의 북쪽 변
            const ring = (n) => fc.features.find((f) => nm(f) === n).geometry.coordinates[0][0];
            const has = (r, p) => r.some((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6);
            ok('경계: 중간·바깥이 (127.833334,32.615)·(130.168056,33.678889)를 함께 쓴다', [[127.833334, 32.615], [130.168056, 33.678889]].every((p) => has(ring(MID), p) && has(ring(OUT), p)));
            ok('경계: 안쪽·중간이 새 경계선 3점을 함께 쓴다(기상청 공지 34°08′18″·127°50′, 34°20′·128°42′, 35°08′·129°25′)', [[127.833333, 34.138333], [128.7, 34.333333], [129.416667, 35.133333]].every((p) => has(ring(IN), p) && has(ring(MID), p)));
            ok('경계: 서해중부 네 구역이 북위 36°50′(36.833333) 선에서 맞물린다', [NI, NO, SI, SO].every((x) => ring(x).some((q) => Math.abs(q[1] - 36.833333) < 1e-6)));
        }
        // 지방청 PDF 줄 · 중기 권역 · 관할
        const RF = require('../regional_forecast_collector');
        ok('단기예보: 새 구역 → 관할 지방청(서해중부 109 · 남해동부중간 159)', [NI, NO, SI, SO].every((x) => RF.ZONE_TO_OFFICE_MAP[x] === '109') && RF.ZONE_TO_OFFICE_MAP[MID] === '159');
        const { ZONE_HOME_OFFICE } = require('../config/zone_home_office');
        ok('통보문 관할: 서해중부 새 4 → 109 · 중간 → 159', [NI, NO, SI, SO].every((x) => ZONE_HOME_OFFICE[x] === '109') && ZONE_HOME_OFFICE[MID] === '159');
        const LAF = require('../services/location_alert_forecast');
        ok('중기 권역(위치 알림): 서해중부 새 4 → 12A20000 · 중간 → 12B20000', [NI, NO, SI, SO].every((x) => LAF._internals.midTermRegId(x) === '12A20000') && LAF._internals.midTermRegId(MID) === '12B20000');
        const oz = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'office_zones.json'), 'utf8'));
        ok('관서 관할표: 수도권청에 서해중부 새 4 · 부산청에 중간', [NI, NO, SI, SO].every((x) => oz['수도권청'].includes(x)) && oz['부산청'].includes(MID));
        // 화면 짝
        const CL = path.join(__dirname, '..', '..', 'client');
        const loadC = (inj, store) => {
            const win = { __ZONE_SPLIT__: inj, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, setTimeout: () => 0, setInterval: () => 0, console };
            new Function('window', 'globalThis', 'console', fs.readFileSync(path.join(CL, 'js', 'core', 'zone_split.js'), 'utf8'))(win, win, console);
            return win.ZoneSplit;
        };
        const st = { weatherAppSettings_v1: JSON.stringify({ '서해중부안쪽먼바다': false, '서해중부바깥먼바다': true, [IN]: false, '부산앞바다': false }) };
        const zc = loadC({ active: false }, st), a1 = JSON.parse(st.weatherAppSettings_v1);
        ok('화면 저장값: 서해중부안쪽 끔 → 북쪽안쪽·남쪽안쪽 끔 · 바깥 켬 → 둘 켬 · 옛 키 삭제(제주 전환 전이어도)', a1[NI] === false && a1[SI] === false && a1[NO] === true && a1[SO] === true && !('서해중부안쪽먼바다' in a1) && !('서해중부바깥먼바다' in a1), a1);
        ok('화면 저장값: 남해동부안쪽 끔 → 중간도 끔(한 번)', a1[IN] === false && a1[MID] === false && st.zoneSplit2Migrated_v1 === '1');
        const a2 = JSON.parse(st.weatherAppSettings_v1); delete a2[MID]; st.weatherAppSettings_v1 = JSON.stringify(a2);
        loadC({ active: false }, st);
        ok('화면 저장값: 한 번 한 기기는 다시 안 한다(뒤에 중간만 켠 사람을 다시 끄지 않는다)', !(MID in JSON.parse(st.weatherAppSettings_v1)));
        ok('화면 「수정 진행 중」: 서해중부 새 4 · 남해동부 안쪽·중간 (바깥·다른 구역 아님)', [NI, NO, SI, SO, IN, MID].every((x) => zc.isPending(x)) && !zc.isPending(OUT) && !zc.isPending('부산앞바다'));
        ok('화면·서버 「수정 진행 중」 목록이 같다', zc.SPLIT2_PENDING.join() === ZS.SPLIT2_PENDING.join() && JSON.stringify(zc.DISPLAY_RENAME) === JSON.stringify(ZS.DISPLAY_RENAME) && JSON.stringify(zc.SPLIT2) === JSON.stringify(Object.fromEntries(Object.entries(ZS.SPLIT2).filter(([k]) => k !== ZS.OLD_INNER_SE))));
        ok('화면 보이는 이름: 전남북부서해앞바다 → 전남광주북부서해앞바다 · 문장 속도', zc.displayName('전남북부서해앞바다') === '전남광주북부서해앞바다' && zc.displayText('전남동부남해앞바다중서부평수구역') === '전남광주동부남해앞바다중서부평수구역' && zc.displayText('전남광주북부서해앞바다') === '전남광주북부서해앞바다');
        const cfg = fs.readFileSync(path.join(CL, 'js', 'core', 'config.js'), 'utf8');
        ok('화면 구역 목록(config.js SUB_REGION_ZONES): 새 이름 7개, 옛 서해중부 두 이름 없음', [NI, NO, SI, SO, MID].every((x) => cfg.includes(`'${x}'`)) && !/SUB_REGION_ZONES[\s\S]*'서해중부해상': \[[^\]]*'서해중부안쪽먼바다'/.test(cfg));
        const cap = fs.readFileSync(path.join(CL, 'capacitor-plugins.js'), 'utf8');
        ok('푸시 구독 목록(capacitor-plugins.js): 새 이름 포함', [NI, NO, SI, SO, MID].every((x) => cap.includes(`'${x}'`)) && !cap.includes("'서해중부안쪽먼바다'"));
        const mp = fs.readFileSync(path.join(CL, 'js', 'shared', 'utils', 'mappings.js'), 'utf8');
        const buoysOf = (z) => { const m = mp.match(new RegExp(`'${z}': \\[([\\s\\S]*?)\\]`)); return m ? (m[1].match(/name: '([^']+)'/g) || []).map((x) => x.slice(7, -1)) : null; };
        ok('부이(실제 위치로 새 도형 안): 북쪽안쪽 서해151·인천 · 남쪽안쪽 서해163·외연도 · 북쪽바깥 서해143 · 남쪽바깥 서해170', String(buoysOf(NI)) === '서해151,인천' && String(buoysOf(SI)) === '서해163,외연도' && String(buoysOf(NO)) === '서해143' && String(buoysOf(SO)) === '서해170');
        ok('부이: 남해동부안쪽 통영·거제도·간여암 · 중간 남해111', String(buoysOf(IN)) === '통영,거제도,간여암' && String(buoysOf(MID)) === '남해111');
        const fj = fs.readFileSync(path.join(CL, 'js', 'forecast', 'outlook', 'forecast.js'), 'utf8');
        ok('중기 권역(카드): 서해중부 새 4 → 12A20000 · 중간 → 12B20000', [NI, NO, SI, SO].every((x) => fj.includes(`'${x}': '12A20000'`)) && fj.includes(`'${MID}': '12B20000'`));
        ZS._forceForTest(true);
    }

    console.log('I. 남은 3건(2026-11-28 사용자 「고쳐」) — 위험예측 지점·칸 / 관리자 화면 이름 / AI 비서');
    {
        ZS._forceForTest(true);
        const WZ = require('../services/warn_zone_cells');
        ok('칸 판정 표(warn_zone_cells)의 본구역 = 지금 그림 48개(제주 전환 뒤)', WZ._load().main.length === 48 && !WZ._load().main.some((z) => ['서해중부안쪽먼바다', '서해중부바깥먼바다', '제주도남쪽바깥먼바다'].includes(z.key)));
        ok('칸 판정: 서해중부 북쪽 점 → 북쪽안쪽 · 남쪽 점 → 남쪽안쪽(종전엔 둘 다 폐지된 「서해중부안쪽먼바다」)', WZ.zonesAt([125.3, 37.2]).main.key === '서해중부북쪽안쪽먼바다' && WZ.zonesAt([125.3, 36.2]).main.key === '서해중부남쪽안쪽먼바다');
        const RS = require('../services/risk_sea_cells');
        const d = RS.describe({ latitude: 36.2, longitude: 124.2 });
        ok('위험예측 해상 칸 판정(risk_sea_cells.describe)도 새 이름(서해중부남쪽바깥먼바다)', String(d.warnZone).replace(/\s/g, '') === '서해중부남쪽바깥먼바다', d.warnZone);
        // 위험예측 관광지 표(파일은 그대로 — 사고 집계표 해시) 의 옛 이름 9곳 → 위치로 지금 구역
        const spots = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'coastal_safety', 'risk_spots.json'), 'utf8')).spots;
        const olds = spots.filter((p) => ZS.isOldName(p.warnZone));
        const mapped = olds.map((p) => WZ.currentZoneName(p.warnZone, [p.lon, p.lat]));
        const tree = C._buildZoneTreeFromSnapshot(new C.StateSnapshot()), leaves = new Set(); (function w(n) { for (const [k, v] of Object.entries(n)) { if (v && 'children' in v) leaves.add(k); else if (v && typeof v === 'object') w(v); } })(tree);
        const byName = Object.fromEntries(olds.map((p, i) => [p.name, mapped[i]]));
        ok(`관광지 표 옛 이름 ${olds.length}곳 → 위치대로: 백령·대청·소청 7곳 북쪽안쪽 · 외연도·어청도(북위 36.1~36.2) 남쪽안쪽 — 모두 특보 나무에 있다`,
            olds.length === 9 && mapped.every((m) => leaves.has(m)) && mapped.filter((m) => m === '서해중부북쪽안쪽먼바다').length === 7 && byName['외연도'] === '서해중부남쪽안쪽먼바다' && byName['어청도'] === '서해중부남쪽안쪽먼바다', byName);
        ok('옛 이름이 아니면 그대로 · 좌표가 없으면 그대로', WZ.currentZoneName('울산앞바다', [129.4, 35.4]) === '울산앞바다' && WZ.currentZoneName('서해중부안쪽먼바다', []) === '서해중부안쪽먼바다');
        const rs = fs.readFileSync(path.join(__dirname, '..', 'services', 'risk_store.js'), 'utf8');
        ok('risk_store: 특보 찾기 3곳이 지금 구역 이름으로(warnZoneOf)', (rs.match(/warningsFor\(warnZoneOf\((p|c)\)/g) || []).length === 3 && !/warningsFor\((p|c)\.warnZone/.test(rs));
        // 관리자 화면 — 보이는 이름만 「전남광주」, 누르는 값은 내부 이름
        const aj = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'admin', 'admin.js'), 'utf8');
        ok('관리자 화면: 구역 이름 글자 9곳이 _zoneLabel · onclick 값은 내부 이름 그대로', (aj.match(/_zoneLabel\(/g) || []).length >= 10 && /onclick="openAddAlertModal\('\$\{zoneName\}'\)"/.test(aj));
        const H2 = require('../services/push_helpers');
        const sp = H2.buildSplitPushes('publish', [{ parent: '전남북부서해앞바다', childState: null, time: null }]);
        ok('관리자 알림 글도 「전남광주…」', JSON.stringify(sp).includes('전남광주북부서해앞바다') && !/전남북부서해/.test(JSON.stringify(sp)), JSON.stringify(sp).slice(0, 200));
        // AI 비서 — 새 이름·전남광주 이름을 알아듣고, 옛 이름은 나뉜 구역들로 답한다
        const as = fs.readFileSync(path.join(__dirname, '..', 'routes', 'assistant.js'), 'utf8');
        ok('AI 비서 구역표: 서해중부 새 4 · 남해동부중간 · 제주 새 2', ['서해중부북쪽안쪽먼바다', '서해중부북쪽바깥먼바다', '서해중부남쪽안쪽먼바다', '서해중부남쪽바깥먼바다', '남해동부중간먼바다', '제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다'].every((n) => as.includes(`'${n}':`)));
        ok('AI 비서: 「전남광주…」 → 내부 이름 · 옛 이름 특보는 나뉜 구역 모두 · 중기는 제주 JEJU', /DISPLAY_RENAME/.test(as) && /replace\(\/전남광주\/g, '전남'\)/.test(as) && /ZS\.isOldName\(z\)/.test(as) && /'JEJU'/.test(as));
    }

    ZS._forceForTest(null);
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
