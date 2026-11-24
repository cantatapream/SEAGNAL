/**
 * 앱 푸시(push_sender) — 발효 중 특보 위에 「다가오는 특보」가 처음 생길 때 제목 검사.
 * 실행: node local_server/scripts/test_push_upcoming_type.js
 * 사용자 확정 2026-11-17: 「📢 풍랑경보→태풍주의보 격상 발표 … 이렇게 되는게 맞아. 어떤 특보가 어떤 높은 등급의 특보로 올라가는지 명확하게 보여주잖아」.
 *   설계 §4.19(client/js/forecast/alerts/mmis_history.design.md) 종류 변경 = 「이전 종류+등급 → 새 종류+등급」.
 *   종전엔 종류가 달라도 점수만 비교해 「📢 태풍 경보→주의보 격상 발표」가 나갔다(실자료 2026-10-24 제주·부산 태풍 예비).
 * 실제 함수(push_sender.processChanges → 보내는 내용 → routes/push.js 와 같은 generateMessage)를 돌리고, 서버로 보내는 순간만 가로챈다(네트워크 없음).
 */
'use strict';
require('../config/zone_split')._forceForTest(false);   // 2026-11-26 구역 분할 전 기준으로 고정 — 이 검사는 옛 이름(제주도남쪽바깥먼바다)을 쓴다. 전환 뒤 동작은 test_zone_split 이 본다(시각 의존 금지)
const Module = require('module');
const sent = [];
const fakeFetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ success: true, successCount: 0 }), text: async () => '' }; };
const origLoad = Module._load;
Module._load = function (req, parent, isMain) { if (req === 'node-fetch') return fakeFetch; return origLoad.apply(this, arguments); };
globalThis.fetch = fakeFetch;
const ps = require('../push_sender');
Module._load = origLoad;
const { generateMessage } = require('../services/push_helpers');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const CS = { all: [], active: [], added: [], released: [] };
async function run(cur, up, prev) {
    sent.length = 0;
    await ps.processChanges([{ type: 'UPCOMING_CHANGE', zone: '제주도남쪽바깥먼바다', prev: prev || null, curr: Object.assign({ tmFc: '2026년 10월 24일 16시 00분', tmEf: '2026년 10월 25일 오전(06시~12시)', tmYn: '' }, up), currentActive: cur, childState: CS }], {});
    const p = sent[0] && sent[0].payload;   // push_sender 는 { isManualGroupSend, type:'auto', payload } 로 보낸다(routes/push.js 가 payload 로 generateMessage)
    return p ? Object.assign({ templateId: p.templateId }, generateMessage(p)) : null;
}

(async () => {
    console.log('A. 종류가 다른 다가오는 특보(사용자 확정 2026-11-17)');
    const a = await run({ wrnTp: '풍랑', wrnLvl: '경보' }, { wrnTp: '태풍', wrnLvl: '예비' });
    ok('풍랑경보 발효 중 + 태풍 예비 처음 = 종류 격상 발표 「📢 풍랑경보→태풍주의보 격상 발표」', a && a.templateId === 'type_upgrade_publish' && a.title === '📢 풍랑경보→태풍주의보 격상 발표', a);
    ok('본문 = 해역 + 발효예정 시간대', a && /ㅇ제주도남쪽바깥먼바다/.test(a.body) && /발효예정 : 10월 25일 06시~12시/.test(a.body), a && a.body);
    const b = await run({ wrnTp: '태풍', wrnLvl: '주의보' }, { wrnTp: '풍랑', wrnLvl: '예비' });
    ok('태풍주의보 발효 중 + 풍랑 예비 처음 = 종류 격하 발표 「📢 태풍주의보→풍랑주의보 격하 발표」', b && b.templateId === 'type_downgrade_publish' && b.title === '📢 태풍주의보→풍랑주의보 격하 발표', b);
    const c = await run({ wrnTp: '풍랑', wrnLvl: '주의보' }, { wrnTp: '태풍', wrnLvl: '경보' });
    ok('풍랑주의보 발효 중 + 태풍경보(발효 전) = 「📢 풍랑주의보→태풍경보 격상 발표」', c && c.templateId === 'type_upgrade_publish' && c.title === '📢 풍랑주의보→태풍경보 격상 발표', c);

    console.log('B. 같은 종류는 종전 그대로(회귀)');
    const d = await run({ wrnTp: '풍랑', wrnLvl: '주의보' }, { wrnTp: '풍랑', wrnLvl: '경보' });
    ok('풍랑주의보 발효 중 + 풍랑경보(발효 전) = 등급 격상 발표 「📢 풍랑 주의보→경보 격상 발표」', d && d.templateId === 'level_upgrade_publish' && d.title === '📢 풍랑 주의보→경보 격상 발표', d);
    const e = await run({ wrnTp: '풍랑', wrnLvl: '경보' }, { wrnTp: '풍랑', wrnLvl: '예비' });
    ok('풍랑경보 발효 중 + 풍랑 예비 = 등급 격하 발표', e && e.templateId === 'level_downgrade_publish', e);
    const f = await run({ wrnTp: '풍랑', wrnLvl: '주의보' }, { wrnTp: '풍랑', wrnLvl: '예비' });
    ok('풍랑주의보 발효 중 + 풍랑 예비(같은 점수) = 발표(publish)', f && f.templateId === 'publish', f);
    const g = await run(null, { wrnTp: '태풍', wrnLvl: '예비' });
    ok('발효 중 특보 없음 + 태풍 예비 = 발표(publish)', g && g.templateId === 'publish', g);
    const h = await run({ wrnTp: '태풍', wrnLvl: '주의보' }, { wrnTp: '태풍', wrnLvl: '예비' }, { wrnTp: '풍랑', wrnLvl: '예비', tmEf: '2026년 10월 25일 오전(06시~12시)' });
    ok('다가오는 특보가 이미 있었고 예비끼리 종류만 바뀜(풍랑 예비→태풍 예비) = 종전 종류 격상 발표', h && h.templateId === 'type_upgrade_publish', h);

    console.log('C. 적대검증 2026-11-17 회귀 — 묶음 · 수신 설정 · 앱 팝업 · 관리자 탭');
    sent.length = 0;
    await ps.processChanges([
        { type: 'UPCOMING_CHANGE', zone: 'Z1', prev: null, curr: { wrnTp: '태풍', wrnLvl: '예비', tmFc: '', tmEf: '2026년 10월 25일 오전(06시~12시)', tmYn: '' }, currentActive: { wrnTp: '풍랑', wrnLvl: '경보' }, childState: CS },
        { type: 'UPCOMING_CHANGE', zone: 'Z2', prev: { wrnTp: '풍랑', wrnLvl: '예비', tmEf: '2026년 10월 25일 오전(06시~12시)' }, curr: { wrnTp: '태풍', wrnLvl: '예비', tmFc: '', tmEf: '2026년 10월 25일 오전(06시~12시)', tmYn: '' }, currentActive: null, childState: CS },
    ], {});
    const ts = sent.map((x) => x.payload).map((p) => ({ zones: p.items.map((i) => i.zones[0]).join(','), title: generateMessage(p).title }));
    ok('「풍랑경보 중 태풍 예비 처음」(Z1)과 「풍랑 예비→태풍 예비」(Z2)는 따로 묶여 각자 맞는 이전 특보로', ts.length === 2 && ts.some((t) => t.zones === 'Z1' && t.title === '📢 풍랑경보→태풍주의보 격상 발표') && ts.some((t) => t.zones === 'Z2' && t.title === '📢 풍랑주의보→태풍주의보 격상 발표'), ts);
    const fs = require('fs'), path = require('path');
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'push.js'), 'utf8');
    const listOf = (re) => { const m = route.match(re); return m ? m[1] : ''; };
    const ann = listOf(/opts\.announce === false &&\s*\[([^\]]*)\]/), act = listOf(/opts\.active === false &&\s*\[([^\]]*)\]/);
    ok('「발표 알림 끔」 사용자에겐 종류 격상/격하 발표도 안 감 · 「발효 알림 끔」엔 종류 격상/격하 발효도', /type_upgrade_publish/.test(ann) && /type_downgrade_publish/.test(ann) && /type_upgrade_active/.test(act) && /type_downgrade_active/.test(act), { ann, act });
    ok('관리자 발송 기록: 종류 격상/격하도 「격상/격하」(level) 탭', /startsWith\('type_'\)/.test(route));
    const popup = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'fix_popup_logic.js'), 'utf8');
    const sup = (popup.match(/SUPPRESSED_POPUP_STATUSES = \[([\s\S]*?)\]/) || [])[1] || '';
    ok('앱에서 푸시를 누를 때 종류 격상/격하도 등급 격상/격하처럼 팝업 생략(「…태풍예비가 발생했습니다」 오문구 방지)', ['type_upgrade_publish', 'type_upgrade_active', 'type_downgrade_publish', 'type_downgrade_active'].every((t) => sup.includes(`'${t}'`)), sup);

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
