'use strict';
/**
 * ============================================================================
 * 파일명: local_server/config/zone_split.js
 * 역할  : 기상청 해상 특보구역 개편(2026-11-26)의 「언제부터·무엇이 무엇으로」를 한 군데에 둔다.
 *         「제주도남쪽바깥먼바다」 1개가 동경 126°17'40" 선을 경계로
 *         「제주도남서쪽바깥먼바다」(서쪽)·「제주도남동쪽바깥먼바다」(동쪽) 2개로 나뉜다(구역 44 → 45).
 *         서버는 미리 배포해 두고, 아래 「전환 조건」이 되면 스스로 갈아탄다(한 번 넘어가면 되돌아가지 않는다 — data/zone_split_state.json).
 * 사용자 확정 2026-11-22(원문):
 *   「위 내용은 모두 26일자부터 자동 적용될 수 있도록 설계해야해. 당장 오늘부터 위처럼 작동하도록 만드는게 아니라.」
 *   「제주도남쪽바깥먼바다는 이제 제주도남서쪽바깥먼바다와 제주도남동쪽바깥먼바다로 구분되고 이 두구역 모두 해당되는 경우에서는
 *     제주도남쪽바깥먼바다라고 칭하면 두구역 모두 해당되는 것으로 보아야 함.」
 *   「제주도먼바다라고 표현하는 경우에도 … 총 4구역이 모두 포함」 · 「제주도전해상의 경우 앞바다와 위 제주도먼바다 모든 해역이 모두 포함」
 *   「푸시는 26일부터는 보내지 말것. 인덱스 페이지 메인화면과, 특보구역(해양종합정보탭에서) 대해서만 표출」 — 이 두 구역(옛 이름 포함)에만 해당, 다른 구역 푸시는 정상.
 *   「26일부터는 … 통보문 mmis가 아닌 통보문 기준으로 표출」 — 이 두 구역만. 나머지는 MMIS.
 * 사용자 확정 2026-11-24(원문) — 전환을 시각이 아니라 MMIS 가 새 구역을 쓰기 시작하는 때로, 특보는 MMIS 로, 푸시도 연다:
 *   「특보도 mmis로 바꾸어서 보자. 푸시도 열고 기상버튼 등 해당버튼은 회색으로 비활성화상태로 두자.」 「부이버튼은 활성화해줘」
 *   「기존 남쪽바깥먼바다 구독자는 해당 2개해역을 그대로 이어받아 푸시받을수있도록」
 *   「특보가 살아있는 동안에는 그 해역에 대해서 특보 정보를 바꿀 수가 없다고 했거든 … 실질적으로 남서쪽, 남동쪽 바깥 먼바다로 전환돼서
 *     MMIS에서 표출하는 그 시점에 그걸 인식해서 UI를 변경하고, 그 시점에 그 남서쪽과 남동쪽으로 나눠서 특보를 보내고자 하는 거야.」
 *   「전환시점을 mmis에서 새로운 구역 신호줄때와 내일 남쪽바깥먼바다에 특보가 없을때 1개로 나누어서 하는건 어때」
 *   기상청 회신(사용자 전달 2026-11-24): 옛 S1324020 폐지 · 남동쪽 S1324120 · 남서쪽 S1324220 · 예보코드 남서쪽 12B10421 · 남동쪽 12B10422.
 *   ※ 2026-11-22 의 「이 두 구역은 통보문 기준 표출·푸시 차단」은 위 지시로 대체됐다(코드에서 걷어냄).
 * [전환 조건 — 둘 중 먼저 오는 쪽]
 *   ① MMIS 가 새 구역코드(S1324120·S1324220)를 쓰기 시작 — 특보 자료(발효·예비)에 보이거나, 포털 특보구역 지도 목록에 보일 때. 보는 즉시.
 *      (특보 자료에는 특보가 걸린 구역만 온다 — 실측 2026-11-24. 지도 목록은 44개 구역이 늘 온다.)
 *   ①-2 통보문(방재기상플랫폼)의 구역 칸에 새 두 구역 이름이 나올 때. 보는 즉시(예고 문장이 실릴 수 있는 참고사항은 보지 않는다).
 *   ② QUIET_FROM(2026-11-25 00:00 KST — 「내일 특보가없는 순간」) 뒤, 옛 구역에 특보(예비 포함)가 하나도 없을 때 — 10주기(약 10분) 연속, 해제 디바운스까지 끝난 뒤. 기상청은 특보가 없을 때만 구역을 바꿀 수 있다.
 *   전환 뒤에도 MMIS 가 옛 코드로 특보를 주면(기상청 작업 전) 그 특보 = 새 두 구역 모두의 특보로 읽는다(marine_warning_crawler._foldOldSplitZone).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : marine_warning_crawler(구역 뼈대·전환 감지·옛 코드 접기) ·
 *                   analysis/bulletin_survey/lifecycle_check(통보문 해역 해석) · config/zone_group_map(묶음 사전) ·
 *                   services/push_helpers(구독 계층) · routes/weather(/api/warn-zones 분할본) · 검사 test_zone_split
 *  - 화면 쪽 짝    : client/js/core/zone_split.js (같은 이름 — 둘을 함께 고친다. 전환은 이 파일이 정한다)
 *  - 저장          : data/zone_split_state.json — {active, at, reason}. 전환은 한 번이고 서버를 다시 켜도 이어진다.
 *  - 환경변수      : ZONE_SPLIT_AT — 전환 조건 ②가 시작되는 시각(시간대까지 적은 ISO 시각. 없으면 2026-11-25T00:00:00+09:00) ·
 *                   ZONE_SPLIT_FORCE=on|off — 손으로 켜거나(감지가 안 될 때) 끈다(스테이징 미리보기·되돌리기). 저장된 상태보다 먼저 본다.
 * [2차 개편 — 2026-11-28 반영] 서해중부 먼바다 2 → 4 · 남해동부 먼바다 2 → 3 (기상청 2026-11-26 시행)
 *   MMIS 가 이미 새 코드로 특보를 준다(2026-11-28 실측: 서해중부 새 4코드 풍랑주의보 00:00 발표 — 우리 표에 없어 버려지고 있었다).
 *   그래서 1차(제주)와 달리 「전환 대기」가 없다 — 이 파일의 SPLIT2_* 는 늘 적용된다.
 *   · 서해중부안쪽먼바다(S1252010 폐지) → 서해중부북쪽안쪽먼바다(S1252110)·서해중부남쪽안쪽먼바다(S1252210)
 *   · 서해중부바깥먼바다(S1252020 폐지) → 서해중부북쪽바깥먼바다(S1252120)·서해중부남쪽바깥먼바다(S1252220)
 *   · 남해동부안쪽먼바다(S1312010 폐지) → 남해동부안쪽먼바다(S1312030, 이름 그대로·넓이 줄어듦)·남해동부중간먼바다(S1312040)
 *     ★이름이 그대로라 「옛 이름 = 둘」 규칙을 이름에 걸 수 없다(새로 고른 사람이 「안쪽만」을 골라도 중간이 따라붙는다).
 *       그래서 옛 구독만 이어받는다: 서버는 새 앱 표시(zoneSchema:2)가 없는 구독(legacyExpand), 화면은 기기마다 한 번만(client zone_split.js).
 *   사용자 확정 2026-11-28(원문): 「바로시작」「이어받기 그대로」「전남광주 이름 변경」
 *     「우리가 제주도 남쪽 바깥 먼바다를 분할하면서 했던 과정을 모두 거쳐야 된다는 거야. 면밀히 살펴가지고 오류가 없도록 해줘.」
 *   ※ 전남 앞바다 5곳의 「전남광주…」 개명(코드 그대로)은 화면에 보이는 이름만 바꾼다(DISPLAY_RENAME) — 내부 이름·구독 열쇠는 그대로.
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const OLD = '제주도남쪽바깥먼바다';
const NEW_WEST = '제주도남서쪽바깥먼바다';
const NEW_EAST = '제주도남동쪽바깥먼바다';
const NEW = [NEW_WEST, NEW_EAST];
// 기상청 회신(2026-11-24): 옛 코드는 폐지, 새 코드 둘. 전환 감지와 MMIS 코드표(marine_warning_crawler.MMIS_CODE_TO_NAME)가 함께 쓴다.
const OLD_CODE = 'S1324020';
const NEW_CODES = { S1324220: NEW_WEST, S1324120: NEW_EAST };
// ── 2차 개편(늘 적용 — 파일 머리 [2차 개편]) ──
const SPLIT2 = {
    '서해중부안쪽먼바다': ['서해중부북쪽안쪽먼바다', '서해중부남쪽안쪽먼바다'],
    '서해중부바깥먼바다': ['서해중부북쪽바깥먼바다', '서해중부남쪽바깥먼바다'],
};
// 폐지된 옛 남해동부안쪽(S1312010) 코드로 온 특보만 이 이름표로 읽는다(새 코드 S1312030 은 이름이 같은 「남해동부안쪽먼바다」) — 옛 넓이 = 안쪽+중간.
const OLD_INNER_SE = '남해동부안쪽먼바다(옛구역)';
SPLIT2[OLD_INNER_SE] = ['남해동부안쪽먼바다', '남해동부중간먼바다'];
const SPLIT2_NEW_CODES = {
    S1252110: '서해중부북쪽안쪽먼바다', S1252120: '서해중부북쪽바깥먼바다',
    S1252210: '서해중부남쪽안쪽먼바다', S1252220: '서해중부남쪽바깥먼바다',
    S1312030: '남해동부안쪽먼바다', S1312040: '남해동부중간먼바다',
};
const SPLIT2_OLD_CODES = { S1252010: '서해중부안쪽먼바다', S1252020: '서해중부바깥먼바다', S1312010: OLD_INNER_SE };
// 「수정 진행 중」 카드(해구기상·윈디·종합정보 회색, 시정·평균 「-」) — 넓이가 바뀐 구역 전부(이름이 같은 남해동부안쪽 포함)
const SPLIT2_PENDING = ['서해중부북쪽안쪽먼바다', '서해중부북쪽바깥먼바다', '서해중부남쪽안쪽먼바다', '서해중부남쪽바깥먼바다', '남해동부안쪽먼바다', '남해동부중간먼바다'];
// 옛 앱이 저장한 구독의 이어받기(이름이 그대로인 구역만 — 사라진 이름은 SPLIT2 가 늘 바꾼다)
const SPLIT2_LEGACY = { '남해동부안쪽먼바다': ['남해동부안쪽먼바다', '남해동부중간먼바다'] };
// 화면에 보이는 이름만 바꾼다(코드 S1231300 등 그대로 — 기상청이 「전남」→「전남광주」로 이름만 바꿨다. 2026-11-28 MMIS 실측)
const DISPLAY_RENAME = {
    '전남북부서해앞바다': '전남광주북부서해앞바다', '전남중부서해앞바다': '전남광주중부서해앞바다',
    '전남남부서해앞바다': '전남광주남부서해앞바다', '전남서부남해앞바다': '전남광주서부남해앞바다',
    '전남동부남해앞바다': '전남광주동부남해앞바다',
};
// 표에 「자기 칸」으로 있는 이름만 본다 — 일반 객체라 'constructor'·'__proto__' 같은 이름이 오면 Object 의 것이 잡힌다.
//   없으면: 누구나 부를 수 있는 /api/subscribe 에 그런 이름 하나만 올라와도 발송 묶음 전체가 예외로 멈춘다(독립 검토 2026-11-28 재현).
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const STATE_FILE = process.env.ZONE_SPLIT_STATE_FILE || path.join(__dirname, '..', 'data', 'zone_split_state.json');
const DEFAULT_QUIET_FROM = '2026-11-25T00:00:00+09:00';   // 사용자 2026-11-24 「내일 정오로 보지말고 내일 특보가없는 순간에 변경하는것으로 보자」 — 25일이 되는 순간부터
const QUIET_FROM_MS = (() => {
    const env = process.env.ZONE_SPLIT_AT;
    // 시간대(+09:00·Z)가 없는 값은 받지 않는다 — 서버 시계가 UTC 라 「2026-11-25」가 25일 09:00 KST 로 읽힌다(독립 검토 2026-11-23)
    const ms = env && /(Z|[+-]\d{2}:?\d{2})$/.test(env.trim()) ? Date.parse(env) : NaN;
    if (env && isNaN(ms)) console.warn('[구역 분할] ZONE_SPLIT_AT 을 못 읽어(시간대까지 적어야 한다 — 예 2026-11-25T00:00:00+09:00) 기본 시각을 쓴다:', env);
    return isNaN(ms) ? Date.parse(DEFAULT_QUIET_FROM) : ms;
})();
const CONFIRM_CYCLES = 10;  // 「특보 없음」이 이만큼(약 10분) 연속이어야 전환 — 없으면: MMIS 가 몇 분 동안 통째로 빈 응답을 주는 때(실제로 있다 — 2026-11-24 검사 서버에서 4분간 31개 구역이 사라졌다 돌아옴)에 특보가 살아 있는데 넘어간다. 해제 디바운스(3분)보다 넉넉히 길게.
let _forced = null;         // 검사용 — true/false 로 고정
let _state = null;          // 파일에서 읽은 상태(처음 물을 때 한 번 읽는다)
const _streak = { quiet: 0 };

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');

function _load() {
    if (_state) return _state;
    try { const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); _state = (j && typeof j === 'object') ? j : {}; }
    catch (e) { if (e && e.code !== 'ENOENT') console.warn('[구역 분할] 상태 파일을 못 읽어 「전환 전」으로 본다:', e.message); _state = {}; }
    return _state;
}

let _envWarned = false;
/** ZONE_SPLIT_FORCE 를 읽는다 — 'on' → true, 'off' → false, 없거나 다른 값 → null(다른 값이면 한 번 경고하고 무시한다). [연계] ← isActive·observe */
function _envForce() {
    const f = String(process.env.ZONE_SPLIT_FORCE || '').trim().toLowerCase();
    if (f === 'on') return true;
    if (f === 'off') return false;
    if (f && !_envWarned) { _envWarned = true; console.warn('[구역 분할] ZONE_SPLIT_FORCE 는 on 또는 off 만 받는다 — 무시한다:', f); }
    return null;
}

/**
 * 지금 새 구역 기준인가 — 전환이 한 번 일어났으면 계속 true.
 * 예: (전환 전) isActive() → false · (activate() 뒤) isActive() → true
 * @returns {boolean}
 * [연계] ← 이 파일을 쓰는 모든 곳 — 전환 전에는 종전과 똑같이 동작하게 하려고 매번 묻는다(서버를 다시 켜지 않아도 그 순간 바뀐다)
 */
function isActive() {
    if (_forced !== null) return _forced;
    const f = _envForce();
    if (f !== null) return f;
    return !!_load().active;
}

/**
 * 전환한다(한 번만 — 이미 전환됐으면 아무 일도 안 한다). 상태를 파일에 남긴다.
 * 예: activate('MMIS 특보 자료에 새 구역코드 S1324220') → true (처음일 때)
 * @param {string} reason 무엇을 보고 전환했나(관리자 알림·로그에 그대로 쓴다)
 * @param {number} [nowMs]
 * @returns {boolean} 이번에 전환했으면 true
 * [연계] ← observe(이 파일) · 검사
 */
function activate(reason, nowMs) {
    if (_load().active) return false;
    _state = { active: true, at: new Date(nowMs == null ? Date.now() : nowMs).toISOString(), reason: String(reason || '') };
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(_state)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('[구역 분할] ⚠ 전환 상태를 파일에 못 남겼다(이 프로세스 안에서는 전환됨 — 재시작하면 다시 감지한다):', e && e.message); }
    console.log(`[구역 분할] ★전환 — ${_state.reason} (${_state.at})`);
    return true;
}

/**
 * 한 주기의 관찰을 받아 전환할지 정한다(전환 조건 ①·② — 파일 머리). 이미 전환됐으면 아무 일도 안 한다.
 * 예: observe({ newCodeSeen: 'S1324220', oldZoneHasWarning: false }) 를 두 주기 연속 → { activated: true, reason: 'MMIS 가 새 구역코드 S1324220 …' }
 * @param {{newCodeSeen?: string|null, bulletinNewName?: string|null, oldZoneHasWarning?: boolean, mmisOk?: boolean, nowMs?: number}} o
 *   newCodeSeen = 이번 주기에 MMIS(특보 자료·구역 지도 목록)에서 본 새 구역코드(없으면 null) · oldZoneHasWarning = 옛 구역에 특보·예비가 있나 ·
 *   mmisOk = 이번 주기 MMIS 특보 자료를 제대로 받았나(못 받았으면 「특보 없음」으로 세지 않는다)
 * @returns {{activated: boolean, reason?: string}}
 * [연계] ← marine_warning_crawler.run (스케줄러가 부른 주기에서만)
 */
function observe(o) {
    o = o || {};
    if (_forced !== null || _envForce() !== null || _load().active) return { activated: false };
    const nowMs = o.nowMs == null ? Date.now() : o.nowMs;
    let reason = null;
    // ① 새 구역코드 — 보는 즉시(기다리면 그 주기에 전환 전 규칙으로 새 이름 푸시가 나간다 — marine_warning_crawler._observeZoneSplitCode 주석)
    if (o.newCodeSeen) reason = `MMIS 가 새 구역코드(${o.newCodeSeen})를 쓰기 시작했다`;
    // ①-2 통보문이 새 구역 이름으로 특보·예비특보를 내기 시작 — 보는 즉시(사용자 2026-11-24 「통보문에서 그렇게 나누어서 발표하는 시점도 포함」)
    else if (o.bulletinNewName) reason = `통보문이 새 구역 이름(${o.bulletinNewName})으로 특보를 내기 시작했다`;
    // ② 특보 없음 — CONFIRM_CYCLES(10)주기 연속(oldZoneHasWarning 을 준 호출만 센다)
    else if (typeof o.oldZoneHasWarning === 'boolean') {
        _streak.quiet = (o.mmisOk !== false && nowMs >= QUIET_FROM_MS && o.oldZoneHasWarning === false) ? _streak.quiet + 1 : 0;
        if (_streak.quiet >= CONFIRM_CYCLES) reason = '전환 준비 시각이 지났고 제주도남쪽바깥먼바다에 특보가 없다';
    }
    if (!reason) return { activated: false };
    return { activated: activate(reason, nowMs), reason };
}

/**
 * 구역 이름 목록에서 옛 이름을 새 두 이름으로 바꾼다(전환 뒤에만. 순서 유지·중복 없음).
 * 예: splitNames(['제주도남쪽바깥먼바다', '제주도남동쪽안쪽먼바다']) → ['제주도남서쪽바깥먼바다', '제주도남동쪽바깥먼바다', '제주도남동쪽안쪽먼바다']
 * @param {Iterable<string>} names
 *     2차 개편(늘): splitNames(['서해중부안쪽먼바다']) → ['서해중부북쪽안쪽먼바다', '서해중부남쪽안쪽먼바다']
 * @returns {string[]} 바꿀 이름이 없으면 그대로(복사본)
 * [연계] ← lifecycle_check.expand · zone_group_map · push_helpers — 「제주도남쪽바깥먼바다 = 두 구역 모두」를 한 규칙으로
 */
function splitNames(names) {
    const list = [...names];
    const jeju = isActive();
    const out = [];
    for (const n of list) for (const x of (jeju && n === OLD ? NEW : (own(SPLIT2, n) ? SPLIT2[n] : [n]))) if (!out.includes(x)) out.push(x);
    return out;
}

/**
 * 옛 이름인가 — 지금 기준으로 새 이름들로 바뀌는 이름(제주는 전환 뒤에만, 2차 개편은 늘).
 * 예: isOldName('서해중부안쪽먼바다') → true · isOldName('남해동부안쪽먼바다') → false(이름이 그대로다)
 * @param {string} name
 * @returns {boolean}
 * [연계] ← lifecycle_check.expand · 검사
 */
function isOldName(name) { return (isActive() && name === OLD) || own(SPLIT2, name); }

/**
 * 이 새 구역을 덮던 옛 이름들 — 통보문·MMIS 가 아직 옛 이름으로 적은 줄도 이 구역 것으로 읽으려고.
 * 예: oldNamesOf('서해중부북쪽안쪽먼바다') → ['서해중부안쪽먼바다'] · oldNamesOf('제주도남서쪽바깥먼바다') → ['제주도남쪽바깥먼바다'](전환 뒤) · 그 밖 → []
 * @param {string} name
 * @returns {string[]}
 * [연계] ← routes/weather.js(📋 통보문 팝업) · services/bulletin_cancel_scanner.matchesZone
 */
function oldNamesOf(name) {
    const out = [];
    if (isActive() && NEW.includes(name)) out.push(OLD);
    for (const [o, list] of Object.entries(SPLIT2)) if (o !== OLD_INNER_SE && list.includes(name) && !out.includes(o)) out.push(o);
    return out;
}

/** 「수정 진행 중」 카드인가(제주 새 두 구역은 전환 뒤, 2차 개편 구역은 늘). 예: isPendingZone('남해동부중간먼바다') → true [연계] ← 검사(화면 짝은 client zone_split.isPending) */
function isPendingZone(name) { return (isActive() && NEW.includes(name)) || SPLIT2_PENDING.includes(name); }

/** 화면에 보일 이름(전남 → 전남광주 개명). 예: displayName('전남북부서해앞바다') → '전남광주북부서해앞바다' · 그 밖은 그대로 [연계] ← 푸시 문구(push_sender) · 검사 */
function displayName(name) { return own(DISPLAY_RENAME, name) ? DISPLAY_RENAME[name] : name; }

/**
 * 한 구독자의 구역 목록 — 옛 앱이 저장한 구독이면 이름이 그대로인 개편 구역을 새 넓이만큼 넓힌다(사용자 「이어받기 그대로」).
 *   「남해동부안쪽먼바다」만 해당(옛 넓이 = 지금 안쪽 + 중간). 옛 앱 구독 = 새 앱 표시(zoneSchema:2 — client/capacitor-plugins.js 가 보낸다)가 없는 구독.
 *   새 앱이 저장한 구독은 고른 그대로 둔다(안쪽만 고른 사람에게 중간을 붙이지 않는다). 처음엔 「개편 코드가 켜진 시각」으로 갈랐는데,
 *   배포 순간 열려 있던 옛 화면이 다시 구독하면 시각이 새로워져 중간이 빠졌다 → 앱이 직접 알리는 표시로 바꿨다(독립 검토 2026-11-28).
 * 예: legacyExpand({zones:['남해동부안쪽먼바다']}) → ['남해동부안쪽먼바다','남해동부중간먼바다']
 *     legacyExpand({zones:['남해동부안쪽먼바다'], zoneSchema: 2}) → ['남해동부안쪽먼바다']
 * @param {{zones?: string[], zoneSchema?: number}} sub 구독 한 줄(routes/push.js SUBS_FILE)
 * @returns {string[]}
 * [연계] ← routes/push.js(발송 대상 고르기·구독자 통계) — expandToMinorZones 에 넘기기 전에
 */
function legacyExpand(sub) {
    const zones = (sub && Array.isArray(sub.zones)) ? sub.zones : [];
    if (!zones.length || (sub && sub.zoneSchema >= 2)) return zones;
    const out = [];
    for (const z of zones) for (const x of (own(SPLIT2_LEGACY, z) ? SPLIT2_LEGACY[z] : [z])) if (!out.includes(x)) out.push(x);
    return out;
}

/** 전환 상태(화면 쪽 짝·GET /api/zone-split 이 읽는다). 예: status() → { active: true, at: '2026-11-25T04:13:00.000Z', reason: '…', notified: true } */
function status() { const s = _load(); return { active: isActive(), at: s.at || null, reason: s.reason || null, notified: !!s.notified }; }

/**
 * 전환 알림(관리자 푸시)이 실제로 전달됐다고 적어 둔다 — 전달될 때까지 매 주기 다시 보내려고(marine_warning_crawler._notifyZoneSplit).
 * 예: markNotified() → 상태 파일에 notified:true
 * [연계] ← marine_warning_crawler._notifyZoneSplit
 */
function markNotified() {
    const s = _load(); if (!s.active || s.notified) return;
    s.notified = true;
    try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(s)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); }
    catch (e) { console.warn('[구역 분할] 알림 전달 표시를 파일에 못 남김(다음 주기에 한 번 더 갈 수 있다):', e && e.message); }
}

/** 검사용: 전환 여부를 고정한다(true/false), null 이면 저장된 상태를 본다. 기억해 둔 상태·연속 횟수도 비운다. [연계] ← test_zone_split 등 */
function _forceForTest(v) { _forced = (v === true || v === false) ? v : null; _state = null; _streak.quiet = 0; }

module.exports = { OLD, NEW, NEW_WEST, NEW_EAST, OLD_CODE, NEW_CODES, QUIET_FROM_MS, STATE_FILE, isActive, activate, observe, splitNames, status, markNotified, _forceForTest,
    SPLIT2, SPLIT2_NEW_CODES, SPLIT2_OLD_CODES, SPLIT2_PENDING, SPLIT2_LEGACY, OLD_INNER_SE, DISPLAY_RENAME,
    isOldName, oldNamesOf, isPendingZone, displayName, legacyExpand };
