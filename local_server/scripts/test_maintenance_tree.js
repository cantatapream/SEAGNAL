/**
 * ============================================================================
 * 파일명: local_server/scripts/test_maintenance_tree.js
 * 역할  : 점검 탭(선택 차단) 회귀 검사 — ①관리자 트리(admin.js featureTree)의 모든 id 가
 *         화면 차단 로직(index2.html applyFeatureBlocks 등)에 실제로 연결돼 있는가
 *         ②그 연결이 가리키는 버튼·섹션이 마크업에 실제로 있는가
 *         ③위치기반 특보 알림 발송이 점검 "푸시 알림 차단"을 따르는가.
 *         "트리에는 있는데 안 잠기는 항목"이 다시 생기면 여기서 잡힌다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : client/js/admin/admin.js(featureTree) · client/index2.html(차단 적용) ·
 *                    client/js/engagement/survey_user.js(설문 팝업 차단) ·
 *                    local_server/services/location_alert_dispatch.js(dispatchWake) ·
 *                    local_server/push_sender.js(isPushBlocked)
 *  - 서버 API      : 없음
 *  - 마크업        : client/index2.html
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_maintenance_tree.js)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(ok, msg) {
    if (ok) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ ' + msg); }
}

// ── ① 트리 id 수집 (admin.js 의 featureTree 리터럴 안 { id: '...' }) ──
const adminSrc = read('client/js/admin/admin.js');
const treeStart = adminSrc.indexOf('const featureTree = [');
const treeEnd = adminSrc.indexOf('];', treeStart);
check(treeStart > 0 && treeEnd > treeStart, 'admin.js 에서 featureTree 를 찾았다');
const treeSrc = adminSrc.slice(treeStart, treeEnd);
const treeIds = [...treeSrc.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]);
const treeLabels = [...treeSrc.matchAll(/label:\s*'([^']+)'/g)].map(m => m[1]);
check(treeIds.length >= 60, '트리 id ' + treeIds.length + '개(60개 이상)');
check(new Set(treeIds).size === treeIds.length, '트리 id 중복 없음');
check(treeLabels.indexOf('해양생활') === -1 && treeLabels.indexOf('해양안전생활') !== -1,
    "트리 최상위 이름이 '해양안전생활'(옛 '해양생활' 아님)");

// ── 차단 적용 코드 — index2.html 의 applyFeatureBlocks ~ 인터셉터 구간 ──
const html = read('client/index2.html');
const blockStart = html.indexOf('function applyFeatureBlocks(');
const blockEnd = html.indexOf('function showWorkModePopup(');
check(blockStart > 0 && blockEnd > blockStart, 'index2.html 에서 차단 적용 구간을 찾았다');
const blockSrc = html.slice(blockStart, blockEnd);
const surveySrc = read('client/js/engagement/survey_user.js');

// 트리에만 있고 실제 차단 대상이 없는 "묶음용" id — 자식이 전부 연결돼 있으면 된다.
const GROUP_ONLY = new Set(['main-etc']);
treeIds.forEach(id => {
    if (GROUP_ONLY.has(id)) return;
    const wired = blockSrc.indexOf("'" + id + "'") !== -1 || surveySrc.indexOf("'" + id + "'") !== -1;
    check(wired, '차단 연결 있음: ' + id);
});

// ── ② 선택자 → 마크업 실존 (버튼 매핑 / 탭 매핑 / 아코디언 매핑) ──
function mapObject(name) {
    const i = blockSrc.indexOf('const ' + name + ' = {');
    const j = blockSrc.indexOf('};', i);
    return blockSrc.slice(i, j);
}
const buttonMap = [...mapObject('buttonMap').matchAll(/'([^']+)':\s*'([^']+)'/g)];
check(buttonMap.length >= 35, 'buttonMap 항목 ' + buttonMap.length + '개(35개 이상)');
buttonMap.forEach(([, id, sel]) => {
    // '#id' 또는 '#id .cls[...]' / '.cls' / '.cls[data-x="v"]' 형태만 쓴다 — 첫 토큰만 실존 확인
    const first = sel.trim().split(/\s+/)[0];
    let ok = false;
    // 나리야 FAB(#nryaFab)처럼 자바스크립트가 만드는 요소는 그 파일의 문자열에서 확인한다
    const idAttr = 'id="' + first.slice(1).replace(/\[.*$/, '') + '"';
    if (first[0] === '#') ok = html.indexOf(idAttr) !== -1 || read('client/js/ai-chat/ai_chat.js').indexOf(idAttr) !== -1;
    else if (first[0] === '.') {
        const cls = first.slice(1).replace(/\[.*$/, '');
        ok = new RegExp('class="[^"]*\\b' + cls + '\\b').test(html) || read('client/js/ai-chat/ai_chat.js').indexOf(cls) !== -1;
    }
    check(ok, '선택자가 마크업에 있음: ' + id + ' → ' + sel);
});
const tabMap = [...mapObject('tabMap').matchAll(/'([^']+)':\s*'([^']+)'/g)];
tabMap.forEach(([, id, section]) => {
    check(html.indexOf('data-target="' + section + '"') !== -1, '탭 버튼이 마크업에 있음: ' + id + ' → ' + section);
});
const featureMap = [...mapObject('featureMap').matchAll(/'([^']+)':\s*'([^']+)'/g)];
featureMap.forEach(([, id, headerId]) => {
    check(html.indexOf('id="' + headerId + '"') !== -1, '아코디언 헤더가 마크업에 있음: ' + id + ' → ' + headerId);
});
check(blockSrc.indexOf("window.addEventListener('click'") !== -1,
    '차단 인터셉터가 window 캡처 단계에 걸려 있다(life_safety 의 document 캡처보다 먼저)');

// ── ③ 위치기반 특보 알림 — 점검 푸시 차단을 따르는가 ──
const dispatch = require('../services/location_alert_dispatch');
const pushSender = require('../push_sender');
check(typeof pushSender.isPushBlocked === 'function', 'push_sender.isPushBlocked 가 있다');
const active = [{ zone: '울산앞바다', wrnTp: '풍랑', wrnLvl: '경보', tmEf: '20260617T2100', tmCc: '20260618T0600' }];
(async () => {
    let sent = 0;
    const sendFn = async (tokens) => { sent += tokens.length; return { ok: true, successCount: tokens.length }; };
    const consents = () => [{ token: 'tkA', agreed: true }];
    const blocked = await dispatch.dispatchWake(active, { sendFn, getConsents: consents, record: false, isPushBlocked: () => true });
    check(blocked.sent === 0 && blocked.reason === 'push_blocked_maintenance' && sent === 0,
        '점검(푸시 차단) 중에는 위치기반 깨우기를 보내지 않는다: ' + JSON.stringify(blocked));
    const open = await dispatch.dispatchWake(active, { sendFn, getConsents: consents, record: false, isPushBlocked: () => false });
    check(open.sent === 1 && sent === 1, '점검이 아니면 그대로 보낸다: sent=' + open.sent);

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
