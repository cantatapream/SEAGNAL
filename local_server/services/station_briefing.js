/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing.js
 * 역할  : 「연안 안전 브리핑」(종전 이름 「활동지점 안전 브리핑」) 생성·저장·일정·설정을 맡는다. 정해진 판(만들기 시작 07:10·17:10·22:40 → 공개 07:30·17:30·23:00 KST — 2026-10-17 §11.10.4)과
 *         특보가 바뀔 때(그 특보구역에 걸친 관할만 — 곧바로 공개) 관할 입력을 모아(station_briefing_inputs) 규칙으로 판단하고(station_briefing_rules — 「총평과 권고」 결론·근거·권고·규칙 분석 문단 포함)
 *         연안·해상 분석 문단만 AI 로 쓴 뒤(station_briefing_ai — VM 최대 3번 → Gemini → 규칙 분석) 날짜별 파일에 저장한다. 공개 시각 전의 판은 pending 에 두고 그동안 화면에는 이전 판을 준다(visibleOf).
 *         관리자 설정(생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만)과 노출 판정(관리자 기기에만 등)도 여기서 정한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js · station_briefing_ai.js · station_briefing_inputs.js
 *                    · routes/risk_forecast.js(stores — 위험예측 화면과 같은 risk_store·marine_fusion 저장소를 함께 쓴다, 메모리 중복 방지)
 *                    · services/codex_bridge.js(VM) · services/gemini_client.js(Gemini) — 실제 어댑터는 처음 부를 때 require
 *                    · data/weather_alerts.json(특보 변경 감지 — 크롤러 결과, 읽기만) · data/station_briefing/(설정·상태·날짜별 브리핑·대표 위치 캐시)
 *                    · services/sea_warning_history.js(이미 해제된 특보 — 해제 뒤 관심, 2026-10-16 결정 4) · services/risk_error_history.js(관리자 오류현황 원천 stationBriefing — 결정 6, historyRow)
 *  - 서버 API      : routes/station_briefing.js 가 이 모듈을 부른다
 *  - 나를 쓰는 곳  : routes/station_briefing.js · server.js(운영 start) · services/risk_history_sources.js(historyRow — 1분 감시) · scripts/test_station_briefing.js(가짜 시계·어댑터)
 * [로드 순서] 서버 require 부작용 없음. start() 는 운영(FLY_ALLOC_ID)에서만 1분 점검을 켠다 — 서버 시작 때 계산·외부 호출을 하지 않는다(첫 점검은 1분 뒤).
 *            공개 대기(pending)는 파일에 저장되고 공개 여부는 읽을 때 시계로 정하므로(타이머 없음) 그 사이 서버가 다시 켜져도 제 시각에 보인다.
 *            실제 AI 어댑터는 운영 또는 STATION_BRIEFING_DEV_AI=1 일 때만 부른다(개발 환경 관리자 실행은 틀 — AI 해설 없음). 실행 실패는 10분 백오프·3번까지, 특보 변경은 3분 디바운스.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./station_briefing_rules'), AI = require('./station_briefing_ai'), I = require('./station_briefing_inputs');
const DATA = path.join(__dirname, '..', 'data');
// 관리자 「AI 브리핑」 오류 목록 보관 — 2026-10-17 사용자 결정(원문 *"ai탭에서 최근 오류 관련, 모든 최근 3일치의 오류가 다 남아있기를 바라고 이를 복사, md파일로 저장 할 수 있도록 기능도 추가 필요."*).
// 최근 3일치(KST 오늘·어제·그제 — 오류 `at` 의 KST 날짜)는 모두 남기고 그보다 오래된 것만 지운다. 종전 200개 상한(slice(-200))은 나쁜 실행 몇 번(관할 97곳 × 검증·재시도)만으로 하루 치를 밀어냈다.
// 안전 상한 ERROR_HARD_CAP: state.json 은 1분 점검마다 여러 번 읽고 쓰므로 끝없이 커지면 안 된다. 운영 10-17 08:00 판 오류가 67건 — 정시 3판에 특보 변경·관리자 실행까지
// 하루 10번 그만큼 나도 3일 2천 건 남짓이라 5,000건은 그 두 배 넘는 여유이고, 한 건 수백 바이트라 파일은 수 MB 안이다. 상한에 걸려 지운 것은 errorsCapped 로 남겨
// 관리자 화면이 「상한 때문에 지움」을 밝힌다(조용히 사라지지 않게 — CLAUDE.md L-291).
const ERROR_KEEP_DAYS = 3, ERROR_HARD_CAP = 5000;
/**
 * 오류 목록을 보관 규칙대로 자른다 — 최근 ERROR_KEEP_DAYS 일(KST 날짜)만, 그래도 ERROR_HARD_CAP 을 넘으면 오래된 것부터.
 * 예: now 10-17 08:00 → at 10-15 00:00 은 남김 · 10-14 23:59 는 지움 · 6,000건이면 최근 5,000건 + dropped 1000
 * @param {object[]} list - {at:KST ISO,…} @param {number} now - ms @returns {object} {errors, dropped(상한으로 지운 수)}
 * [연계] ← run·reportFailure(쓰기) · status(읽기 — 실행이 며칠 없어도 오래된 것을 보이지 않게)
 */
function keepErrors(list, now) {
    const from = R.kstDate(now - (ERROR_KEEP_DAYS - 1) * 86400000);
    const recent = (list || []).filter((e) => e && typeof e.at === 'string' && e.at.slice(0, 10) >= from);
    return { errors: recent.slice(-ERROR_HARD_CAP), dropped: Math.max(0, recent.length - ERROR_HARD_CAP) };
}
/**
 * 상한 기록(errorsCapped)도 보관 기간(ERROR_KEEP_DAYS, KST 날짜)이 지나면 버린다(2026-10-17 독립 검토 10 — 종전엔 한 번 걸리면 지워지지 않아 관리자 화면이 계속 「상한 때문에 지움」을 밝혔다).
 * 예: ({at:'2026-10-14T09:00:00+09:00',…}, 10-17 08:00) → null · ({at:'2026-10-15T…'}, 같은 때) → 그대로 · null → null
 * @param {object|null} c - state.errorsCapped @param {number} now - ms @returns {object|null} [연계] ← addErrors·status
 */
function freshCapped(c, now) { return c && typeof c.at === 'string' && c.at.slice(0, 10) >= R.kstDate(now - (ERROR_KEEP_DAYS - 1) * 86400000) ? c : null; }
// 실행 실패 백오프(독립 검토 B9·ops1): 실행이 던지면 매분 다시 돌며 AI 를 다시 부르지 않게 — 실패 뒤 10분 기다리고, 같은 판은 3번까지만.
const RUN_BACKOFF_MS = 10 * 60000, MAX_RUN_FAILS = 3;
// 특보 변경 디바운스(독립 검토 C9): 특보가 잇달아 바뀌면 마지막 변경 뒤 3분 조용할 때 한 번만 다시 만든다.
const WARN_DEBOUNCE_MS = 3 * 60000, WARN_MAX_WAIT_MS = 15 * 60000; // 계속 바뀌어도 첫 변경 뒤 15분이면 만든다(무한 대기 방지)
// 한 번 실행의 AI 데드라인(독립 검토 B7): 넘으면 남은 관할은 규칙 분석으로 저장한다. 정시 판은 공개 시각도 넘지 않는다(§11.10.4 — 공개 시각에 된 만큼 보인다, 늦추지 않음).
const RUN_DEADLINE_MS = 20 * 60000;
/**
 * 날짜 파일에서 관할 하나의 「지금 보일」 판을 고른다 — 공개된 판(stations)과 공개 대기 판(pending) 중 공개 시각(publishAt)이 지난 것들 가운데 **더 나중에 만든 것**(generatedAt).
 * 공개 시각 순이 아니라 만든 시각 순인 이유(§11.10.4 대기 표 ③): 07:10 에 만든 아침 판(07:30 공개)이 07:20 특보 변경 판보다 오래된 자료라 07:30 에 그것을 덮으면 안 된다.
 * 예: ({stations:{k:특보판 07:20}, pending:{k:아침판 07:10·publishAt 07:30}}, k, 07:31) → 특보판 · (…stations:{k:어제 밤 판}…, 07:31) → 아침판 · 07:29 → 어제 밤 판
 * @param {object|null} day - 날짜 파일 @param {string} key @param {number} now - ms @returns {object|null} [연계] ← pick·settle·run(재사용 바탕)
 */
function visibleOf(day, key, now) {
    const s = day && day.stations ? day.stations[key] || null : null, p = day && day.pending ? day.pending[key] || null : null;
    if (p && Date.parse(p.publishAt) <= now && (!s || !(Date.parse(s.generatedAt) > Date.parse(p.generatedAt)))) return p;
    return s;
}
/**
 * 공개 시각이 지난 대기 판을 공개 판으로 옮긴다(쓰기 전에 — 새 대기 판이 그것을 덮어 지우지 않게). 더 오래된 대기 판은 버린다. 바꿨으면 true.
 * 예: settle({stations:{}, pending:{k:{publishAt:07:30,…}}}, 07:40) → stations.k = 그 판, pending 비움
 * @param {object} day @param {number} now @returns {boolean} [연계] ← run
 */
function settle(day, now) {
    let changed = false;
    for (const k of Object.keys(day.pending || {})) { if (Date.parse(day.pending[k].publishAt) > now) continue; const v = visibleOf(day, k, now); if (v) day.stations[k] = v; delete day.pending[k]; changed = true; }
    return changed;
}
// Gemini 한 번 호출 시간 제한(B7) — gemini_client 는 고치지 않고 어댑터에서 abortSignal + Promise.race.
const GEMINI_CALL_MS = 90000;

// 관리자 「AI 브리핑」 설정의 선택지와 기본값(§11.6-15·16·17). 기본 노출 = 관리자에게만.
const CHOICES = Object.freeze({
    method: ['chatgpt', 'gemini', 'template'],
    chatgptModel: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],   // codex_bridge.ANSWER_MODELS 에서 'gemini' 를 뺀 것(시험이 같은지 확인)
    geminiModel: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],  // 저장소의 다른 Gemini 호출이 쓰는 두 모델
    exposure: ['user', 'admin', 'off'],
    batchUnit: ['station', 'office', 'region'],
    onlyChanged: [true, false],
});
const DEFAULT_CONFIG = Object.freeze({ method: 'chatgpt', chatgptModel: 'gpt-6-luna', geminiModel: 'gemini-2.5-flash', exposure: 'admin', batchUnit: 'office', onlyChanged: true });

/**
 * 설정값을 선택지 안으로 정리한다(모르는 값은 기본값). 예: {method:'x',exposure:'user'} → {method:'chatgpt',exposure:'user',…}
 * @param {object} c @returns {object} [연계] ← readConfig·writeConfig
 */
function normConfig(c) { const o = {}; for (const [k, v] of Object.entries(DEFAULT_CONFIG)) o[k] = c && CHOICES[k].includes(c[k]) ? c[k] : v; return o; }
/**
 * 노출 판정(§11.6-15) — 특보 예측 표출 제어(routes/advisoryPrediction.js)와 같은 순서:
 *   user → 모두에게 / off → 아무에게도 / admin → ①등록된 관리자 기기(admin_devices.json — FCM 토큰 또는 웹푸시 endpoint 를 그대로 대조, advisory/displayControl.isAdminDevice)
 *   ②그 밖이면 관리자 로그인 토큰(X-Admin-Token — admin_auth.verifyToken, PC 처럼 기기 등록이 안 되는 관리자).
 * 예: decideExposure('admin', {deviceId:'tok1'}, {isAdminDevice:id=>id==='tok1'}) → {audience:'admin',display:true,by:'device'}
 * @param {string} exposure @param {object} who - {deviceId,adminToken} @param {object} fns - isAdminDevice·verifyToken @returns {object}
 * [연계] ← routes/station_briefing.js
 */
function decideExposure(exposure, who = {}, { isAdminDevice, verifyToken } = {}) {
    if (exposure === 'user') return { audience: 'user', display: true, by: 'all' };
    if (exposure !== 'admin') return { audience: 'off', display: false, by: null };
    try { if (who.deviceId && isAdminDevice && isAdminDevice(who.deviceId)) return { audience: 'admin', display: true, by: 'device' }; } catch (_) { /* 기기 목록 읽기 실패 — 아래 토큰으로 */ }
    try { if (who.adminToken && verifyToken && verifyToken(who.adminToken)) return { audience: 'admin', display: true, by: 'token' }; } catch (_) { /* 토큰 확인 실패 = 미인가 */ }
    return { audience: 'admin', display: false, by: null };
}
/**
 * 특보 트리에서 구역별 서명(종류·등급·발표·발효·해제예고·예비)을 만든다 — 서명이 바뀐 구역 = 특보가 바뀐 구역(예비·발표·발효·격상·격하·해제·해제예고 변경).
 * 예: warnSignatures(tree) → {'제주도북부앞바다': '[["V","주의보",…]]', '제주도북부앞바다중연안바다': '…'}
 * @param {object} tree - weather_alerts.json current @returns {object} zoneKey → 서명 [연계] ← tick
 */
function warnSignatures(tree) {
    const out = {}, f = (b) => b && typeof b === 'object' ? [b.wrnTp || b.wrnTpNm || '', b.wrnLvl || b.wrnLvlNm || '', b.tmFc || '', b.tmEf || '', b.clrNtcTm || b.tmCc || '', b.tmYn || ''] : null;
    (function walk(n) {
        if (!n || typeof n !== 'object') return;
        for (const [name, v] of Object.entries(n)) {
            if (!v || typeof v !== 'object') continue;
            if (Object.hasOwn(v, 'children') && (Object.hasOwn(v, 'current') || Object.hasOwn(v, 'upcoming'))) {
                out[R.zoneKey(name)] = JSON.stringify([f(v.current), f(v.upcoming)]);
                for (const [c, b] of Object.entries(v.children || {})) out[R.zoneKey(c)] = JSON.stringify([f(b)]);
            } else walk(v);
        }
    })(tree);
    return out;
}
/** 두 서명 묶음에서 바뀐 구역 열쇠. 예: ({a:'1'},{a:'2',b:'x'}) → ['a','b']. @returns {string[]} [연계] ← tick */
function changedZones(prev, next) { const ks = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]); return [...ks].filter((k) => (prev || {})[k] !== (next || {})[k]).sort(); }

/**
 * 실제 AI 어댑터(VM·Gemini). 시험은 가짜를 넣는다 — 이 함수는 운영에서만 불린다.
 * @returns {object} {vm:{available,call}, gemini:{available,call}} [연계] ← createService 기본값 / → codex_bridge.callRaw · gemini_client.callGeminiRaw
 */
function realAdapters() {
    return {
        vm: {
            available: () => { const c = require('./codex_bridge'); return c.ENABLED && c.workerAlive(); },
            call: async ({ prompt, model }) => { const r = await require('./codex_bridge').callRaw({ contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'StationBriefing', model }); if (!r.success) throw new Error(r.error || 'VM 실패'); return r.response.text; },
        },
        gemini: {
            available: () => require('./gemini_client').hasAnyKey(),
            // 시간 제한(B7): 부르는 쪽 signal 이 있으면 그것, 없으면 GEMINI_CALL_MS — @google/genai 의 config.abortSignal 로 요청을 끊고, 끊기지 않아도 Promise.race 로 기다림을 끝낸다.
            call: async ({ prompt, model, signal }) => {
                const sig = signal || AbortSignal.timeout(GEMINI_CALL_MS); let tid = null;
                const stop = new Promise((_, rej) => { const fire = () => rej(new Error('Gemini 시간초과')); if (sig.aborted) fire(); else sig.addEventListener('abort', fire, { once: true }); tid = setTimeout(fire, GEMINI_CALL_MS + 5000); });
                try {
                    const r = await Promise.race([require('./gemini_client').callGeminiRaw({ model, contents: prompt, config: { responseMimeType: 'application/json', abortSignal: sig }, caller: 'StationBriefing' }), stop]);
                    if (!r.success) throw new Error(r.error || 'Gemini 실패'); const t = r.response && r.response.text; return typeof t === 'function' ? t.call(r.response) : t;
                } finally { clearTimeout(tid); }
            },
        },
    };
}

// 관리자 오류현황(위험예측 오류현황 risk_error_history) 연결 — 2026-10-16 결정 6(원문 *"추천대로"*). 원천 이름·낡음 기준·일부 실패 분류.
// 낡음 10시간: 정시 판 실행 간격 중 가장 긴 것(밤 22:40 → 아침 07:10) 8시간 30분 + 여유(§11.10.4 전에는 23:00→08:00 9시간 + 1시간). 이것이 없으면 브리핑이 멈춰도 오류현황엔 「정상」이 남는다(L-291).
const HISTORY_SOURCE = 'stationBriefing', HISTORY_STALE_MS = 10 * 3600000, HISTORY_PARTIAL_CODE = '브리핑 일부 실패 — AI 총평 대신 틀';
/**
 * 브리핑 상태 파일(state.json)을 오류현황 원천 한 행으로 바꾼다 — 1분 감시(risk_history_sources)와 실행 직후 기록(run·reportFailure)이 같은 판정을 쓰도록 한 곳에 둔다.
 *   실행 실패가 마지막 실행보다 나중 → error(분류는 io.errorName — 자유 글자는 넘기지 않는다, 상세는 「브리핑 실행 실패(연속 N번)」)
 *   실행 기록 없음 → missing · 마지막 실행이 10시간 넘음 → stale
 *   마지막 실행에서 AI 방식인데(method ≠ template, 개발 환경 aiDisabled 아님) 틀 총평으로 대체된 관할이 있으면 → partial(분류 HISTORY_PARTIAL_CODE, 상세에 수·오류 단계) — VM 이 실패하고 Gemini 가 쓴 것처럼 결과가 AI 면 문제 아님 · 그 밖 ok
 * 예: historyRow({lastRun:{at:'…T08:00…',method:'chatgpt',results:[{stats:{template:2}}]},errors:[{at:'…T08:00…',stage:'validate'},…]}, 08:05)
 *     → {status:'partial',partialCode:'브리핑 일부 실패 — AI 총평 대신 틀',detail:'마지막 실행 AI 총평 대신 틀 2곳(validate 2) — 생성 방식 chatgpt',…}
 * @param {object} s - state() 결과 @param {number} now - ms @returns {object} 원천 상태(risk_error_history.recordCollector·observeSources 행)
 * [연계] ← run·reportFailure(실행 직후 기록)·risk_history_sources.createReader(1분 감시) → risk_error_history(관리자 → 점검 → 데이터 수집현황/오류현황)
 */
function historyRow(s, now) {
    const io = require('./risk_collector_io'), last = s && s.lastRun ? s.lastRun : null, lastAt = last ? Date.parse(last.at) : NaN;
    const fail = Object.values((s && s.failures) || {}).filter((f) => f && Number.isFinite(Date.parse(f.lastAt))).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))[0] || null;
    const base = { updatedAt: last ? last.at : null, lastSuccess: last ? last.at : null, checkedAt: R.isoKst(now) };
    if (fail && (!Number.isFinite(lastAt) || Date.parse(fail.lastAt) > lastAt)) return { ...base, status: 'error', lastError: io.errorName({ message: String(fail.reason || '') }), detail: '브리핑 실행 실패(연속 ' + fail.count + '번, 마지막 ' + R.isoKst(Date.parse(fail.lastAt)).slice(5, 16).replace('T', ' ') + ' KST)' };
    if (!Number.isFinite(lastAt)) return { ...base, status: 'missing', lastError: null };
    if (now - lastAt > HISTORY_STALE_MS) return { ...base, status: 'stale', lastError: null, detail: '마지막 실행 ' + last.at.slice(5, 16).replace('T', ' ') + ' KST — 정시 판(07:30·17:30·23:00)이 10시간 넘게 없음' };
    const n = last.method && last.method !== 'template' && !last.aiDisabled ? (last.results || []).reduce((a, r) => a + (Number(r.stats && r.stats.template) || 0), 0) : 0;
    if (n > 0) {
        const recent = ((s && s.errors) || []).filter((e) => e.at === last.at), by = {};
        for (const e of recent) by[e.stage] = (by[e.stage] || 0) + 1;
        return { ...base, status: 'partial', partialCode: HISTORY_PARTIAL_CODE, lastError: null, detail: '마지막 실행 AI 총평 대신 틀 ' + n + '곳' + (Object.keys(by).length ? '(' + Object.entries(by).map(([k, v]) => k + ' ' + v).join('·') + ')' : '') + ' — 생성 방식 ' + last.method };
    }
    return { ...base, status: 'ok', lastError: null, detail: null };
}

/**
 * 브리핑 서비스를 만든다(시험은 폴더·시계·저장소·어댑터·관할 목록을 주입).
 * 예: const svc = createService({dir, clock, risk, marine, adapters}); await svc.run({kind:'morning'}); svc.pick({key, day:'auto'})
 * @param {object} o - dir·clock·risk·marine·adapters·loadStations·alertsFile·geocoder·tideDeps·spotsOf·hazardFeatures·kma
 *                     ·timer(경과 시간 — AI 데드라인, 기본 Date.now)·runDeadlineMs·aiOptions(generate 에 더 넘길 것 — timeouts 등)·allowRealAI(실제 AI 허용 여부)
 *                     ·warnHistory(특보 구간 기록 sea_warning_history 기록기 — 이미 해제된 특보, 결정 4. 기본 null = 보지 않음, forDefault 가 운영 기록기 forDir() 를 넘긴다)
 *                     ·errorHistory(관리자 오류현황 risk_error_history — 결정 6. 기본 null = 기록 안 함, forDefault 가 운영 것을 넘긴다)
 *                     ·regional(지방기상청 단기 해상예보·단기 전망 — 기본 I.regionalForecast(), 실행마다 한 번 읽음. §11.10.1 (기상) 칸)
 * @returns {object} run·tick·start·stop·pick·readConfig·writeConfig·status·stationList·stationAreas
 * [연계] ← forDefault·시험 / → R·AI·I
 */
function createService({ dir = path.join(DATA, 'station_briefing'), clock = Date.now, risk, marine, adapters, loadStations = () => I.loadStations(), alertsFile = path.join(DATA, 'weather_alerts.json'), geocoder = null, tideDeps, spotsOf, hazardFeatures, kma = () => I.kmaOutlook(),
    timer: elapsed = Date.now, runDeadlineMs = RUN_DEADLINE_MS, aiOptions = {}, allowRealAI = () => !!process.env.FLY_ALLOC_ID || process.env.STATION_BRIEFING_DEV_AI === '1', warnHistory = null, errorHistory = null, regional = () => I.regionalForecast() } = {}) {
    let timer = null, running = null, stationsCache = null, areasCache = null, ad = adapters;
    const fileCache = new Map();
    const p = (f) => path.join(dir, f);
    const stations = () => stationsCache || (stationsCache = loadStations());
    /** 설정 읽기. @returns {object} [연계] ← run·routes */
    function readConfig() { return normConfig(I.readJson(p('config.json'))); }
    /** 설정 쓰기(선택지 밖 값이면 400). 예: writeConfig({exposure:'user'}) → 저장된 설정 @param {object} patch @returns {object} [연계] ← routes PUT */
    function writeConfig(patch) {
        const cur = readConfig(), next = { ...cur };
        // 모르는 칸(__proto__·constructor 포함)은 400 — CHOICES 자신의 칸만 받는다(독립 검토 B12).
        for (const [k, v] of Object.entries(patch || {})) { if (!Object.hasOwn(CHOICES, k)) throw Object.assign(new Error('설정 칸 오류: ' + k), { status: 400 }); if (!CHOICES[k].includes(v)) throw Object.assign(new Error('설정값 오류: ' + k), { status: 400 }); next[k] = v; }
        I.writeJson(p('config.json'), { ...next, updatedAt: R.isoKst(clock()) }); return next;
    }
    /** 상태 파일(만든 판·특보 서명·관할별 특보구역·마지막 실행·오류·실행 실패 백오프·특보 변경 대기). @returns {object} [연계] ← run·tick·status */
    function state() { const s = I.readJson(p('state.json')) || {}; return { done: s.done || [], warnSig: s.warnSig || null, stationZones: s.stationZones || {}, lastRun: s.lastRun || null, errors: s.errors || [], errorsCapped: s.errorsCapped || null, alertsMtime: s.alertsMtime || null, failures: s.failures || {}, pendingWarn: s.pendingWarn || null }; }
    /** 오류를 보관 규칙(최근 3일·안전 상한)대로 더한다. 상한으로 지운 것이 있으면 errorsCapped 에 시각·수. @param {object} s - state() @param {object[]} add @param {number} now [연계] ← run·reportFailure → keepErrors */
    function addErrors(s, add, now) { const k = keepErrors(s.errors.concat(add), now); s.errors = k.errors; if (k.dropped) s.errorsCapped = { at: R.isoKst(now), dropped: k.dropped, cap: ERROR_HARD_CAP }; else s.errorsCapped = freshCapped(s.errorsCapped, now); }
    function saveState(s) { I.writeJson(p('state.json'), s); }
    /** 관리자 오류현황에 지금 상태를 남긴다(결정 6). 기록 실패는 브리핑 결과를 바꾸지 않는다. @returns {void} [연계] ← run·reportFailure → historyRow·errorHistory.recordCollector */
    function recordHistory() { if (!errorHistory) return; try { errorHistory.recordCollector(HISTORY_SOURCE, historyRow(state(), clock())); } catch (_) { console.warn('[station_briefing] 오류현황 기록 실패'); } }
    /**
     * 날짜별 브리핑 파일 읽기 — 늘 메모리에 두는 것은 오늘·내일 파일만(mtime 캐시, 최대 2개 — 독립 검토 C6). 다른 날짜는 읽기만 하고 두지 않는다.
     * @param {string} date @returns {object|null} [연계] ← pick·run
     */
    function readDay(date) {
        const f = p('briefings_' + date + '.json'); let st; try { st = fs.statSync(f); } catch (_) { return null; }
        const c = fileCache.get(f); if (c && c.mtime === st.mtimeMs) return c.data;
        const data = I.readJson(f), now = clock();
        if ([R.kstDate(now), R.kstDate(now + 86400000)].includes(date)) { fileCache.set(f, { mtime: st.mtimeMs, data }); while (fileCache.size > 2) fileCache.delete(fileCache.keys().next().value); }
        return data;
    }
    /** 이틀 넘게 지난 날짜 파일을 지운다(오늘·내일·어제만 남김). 쓰다 남은 임시 파일(.tmp)도 1시간 지난 것은 지운다(C9). @param {number} now [연계] ← run */
    function prune(now) {
        const keep = new Set([-1, 0, 1].map((d) => R.kstDate(now + d * 86400000)));
        try {
            for (const f of fs.readdirSync(dir)) {
                const m = f.match(/^briefings_(\d{4}-\d{2}-\d{2})\.json$/); if (m && !keep.has(m[1])) { fs.unlinkSync(p(f)); fileCache.delete(p(f)); continue; }
                if (/\.\d+\.tmp$/.test(f)) { try { if (Date.now() - fs.statSync(p(f)).mtimeMs > 3600000) fs.unlinkSync(p(f)); } catch (_) { /* 그 사이 지워짐 */ } }
            }
        } catch (_) { /* 폴더 없음 */ }
    }
    /**
     * 브리핑을 만든다. kind: morning|evening|night(정시 — 공개 시각 전이면 pending 에 저장) · warning(특보 변경 — keys 관할만, 이미 있는 오늘·내일 판의 남은 칸, 곧바로 공개) · manual(관리자 실행 — 화면이 지금 보일 날짜, 곧바로 공개).
     * 실제 AI 어댑터는 운영(FLY_ALLOC_ID) 또는 STATION_BRIEFING_DEV_AI=1 일 때만 — 그 밖(개발 환경)에서 어댑터를 주입하지 않았으면 틀만 — AI 해설 없음(C9).
     * 시각: 창은 시작 시각으로 정하지만, 위치 찾기·AI 가 오래 걸려도 연안 하루 값 시각이 낡지 않게 모으기 직전에 시각을 다시 잡는다(C2 — risk_store 는 지금−5분보다 앞선 시각을 400 으로 거부).
     * AI 데드라인 runDeadlineMs(기본 20분)과 공개 시각 중 이른 것 — 넘으면 남은 관할은 규칙 분석(B7·§11.10.4).
     * 예: await run({kind:'morning'}) → {ok:true, date:'2026-10-17', stations:97, stats:{…}, ms}
     * @param {object} o - kind·keys(대상 관할 열쇠, 없으면 전부)·zones(특보 변경 구역 — 기록용) @returns {Promise<object>}
     * [연계] ← tick·routes POST run / → I.gather·R.buildBriefing·AI.generate
     */
    async function run({ kind, keys = null, zones = null } = {}) {
        if (running) return { ok: false, skipped: 'busy' };
        running = (async () => {
            const t0 = elapsed(), now = clock(), config = readConfig(), all = stations(), st = state();
            const targets = keys ? all.filter((s) => keys.includes(s.key)) : all;
            const wins = [];
            if (kind === 'warning') { for (const d of [R.kstDate(now), R.kstDate(now + 86400000)]) { const day = readDay(d); if (!day) continue; const w = R.editionWindow('warning', now, d); if (w) wins.push(w); } }
            else if (kind === 'manual') { const d = R.displayDate(now), w = R.editionWindow(d === R.kstDate(now) ? 'morning' : 'night', now); wins.push({ ...w, kind: 'manual' }); }
            else wins.push(R.editionWindow(kind, now));
            const spots = spotsOf ? spotsOf() : risk.spots().spots, spotsBySt = I.assignSpots(all, spots);
            const hz = I.assignHazards(all, hazardFeatures ? hazardFeatures() : (I.readJson(path.join(I.CONFIG, 'coastal_hazard_zones.wgs84.geojson'))?.features || []));
            const landPoints = Object.fromEntries(all.map((s) => [s.key, (spotsBySt.get(s.key) || []).concat(hz.get(s.key) || [])]));
            const locations = await I.ensureLocations({ stations: all, landPoints, file: p('locations.json'), geocoder, now });
            const aiOn = !!ad || allowRealAI(), cfg = aiOn ? config : { ...config, method: 'template' }, rg = regional ? regional() : null;
            // 공개 시각(§11.10.4): 정시 판은 EDITIONS 공개 시각(07:30·17:30·23:00) — 그 전에는 pending 에 두고 화면은 이전 판. 특보 변경·관리자 실행은 곧바로(publishAt = 만든 시각).
            //   데드라인 = 20분과 「공개 시각까지」 중 이른 것 — 공개 시각에 된 만큼(AI 분석 + 나머지는 규칙 분석) 보이고 늦추지 않는다. 공개 시각이 이미 지난 늦은 실행은 20분 그대로(곧바로 공개).
            const publishAt = R.publishAtFor(kind, now) || R.isoKst(now), untilPublish = Date.parse(publishAt) - now;
            const deadline = t0 + (untilPublish > 0 ? Math.min(runDeadlineMs, untilPublish) : runDeadlineMs);
            const results = [];
            for (const win of wins) {
                const inputs = I.gather({ stations: targets, risk, marine, win, now: clock(), locations, hazards: hz, spotsBySt, tideDeps, warnHistory, regional: rg });
                const briefings = inputs.map((x) => R.buildBriefing(x, win, { generatedAt: R.isoKst(now) }));
                const day = readDay(win.targetDate) || { date: win.targetDate, stations: {} };
                day.stations = day.stations || {}; day.pending = day.pending || {};
                // 재사용 바탕 = 관할마다 가장 나중에 만든 판(공개 대기 포함)
                const latest = Object.fromEntries([...new Set(Object.keys(day.stations).concat(Object.keys(day.pending)))].map((k) => { const a = day.stations[k], b = day.pending[k]; return [k, !a ? b : !b ? a : Date.parse(b.generatedAt) > Date.parse(a.generatedAt) ? b : a]; }));
                const gen = await AI.generate({ briefings, config: cfg, previous: latest, adapters: ad || (aiOn ? (ad = realAdapters()) : {}), kma: kma(), now, timer: elapsed, deadline, ...aiOptions });
                const wNow = clock(); settle(day, wNow);
                for (const b of briefings) {
                    b.overview = gen.overviews[b.key] || b.overview; b.trigger = kind === 'warning' ? { kind, zones } : { kind }; b.publishAt = publishAt;
                    if (Date.parse(publishAt) > wNow) day.pending[b.key] = b;
                    // 곧바로 공개하는 판(특보 변경·관리자·공개 시각이 지난 정시 판) — 그보다 먼저 만든 대기 판은 지운다(나중에 공개되며 이 판을 덮지 않게 — 대기 표 ③·⑥)
                    else { day.stations[b.key] = b; const pd = day.pending[b.key]; if (pd && !(Date.parse(pd.generatedAt) > Date.parse(b.generatedAt))) delete day.pending[b.key]; }
                }
                if (!Object.keys(day.pending).length) delete day.pending;
                day.updatedAt = R.isoKst(now); I.writeJson(p('briefings_' + win.targetDate + '.json'), day); fileCache.delete(p('briefings_' + win.targetDate + '.json'));
                for (const x of inputs) st.stationZones[x.key] = [...new Set((x.sea.warnings || []).map((w) => R.zoneKey(w.zone)).concat((x.sea.regions || []).flatMap((r) => r.zones.map(R.zoneKey))))];
                addErrors(st, gen.errors.map((e) => ({ ...e, edition: win.kind, date: win.targetDate })), now);
                results.push({ date: win.targetDate, stations: briefings.length, stats: gen.stats, errors: gen.errors.length, publishAt });
            }
            prune(now);
            st.lastRun = { at: R.isoKst(now), kind, zones, method: cfg.method, publishAt, results, ms: elapsed() - t0, ...(aiOn ? {} : { aiDisabled: '개발 환경 — 실제 AI 호출 안 함(STATION_BRIEFING_DEV_AI=1 이면 부름)' }) };
            saveState(st); recordHistory();
            return { ok: true, results, ms: elapsed() - t0 };
        })();
        try { return await running; } finally { running = null; }
    }
    /** 실행 실패를 상태에 남긴다(횟수·마지막 시각·이유) — 백오프 판단용. @param {string} key - 판 열쇠 또는 'warning' @param {Error} e @param {number} now [연계] ← tick */
    function reportFailure(key, e, now) {
        const s = state(), f = s.failures[key] || { count: 0 }, why = String((e && e.message) || e).slice(0, 160);
        s.failures = Object.fromEntries(Object.entries({ ...s.failures, [key]: { count: f.count + 1, lastAt: R.isoKst(now), reason: why } }).slice(-12));
        addErrors(s, [{ at: R.isoKst(now), stage: 'run', provider: null, stations: [], reason: key + ' 실행 실패(' + (f.count + 1) + '번째): ' + why }], now);
        saveState(s); recordHistory(); console.error('[station_briefing] 실행 실패 ' + key + ' (' + (f.count + 1) + '/' + MAX_RUN_FAILS + '): ' + why);
    }
    /** 백오프 중인가 — 실패 뒤 10분 안이거나 같은 판을 3번 실패했으면 true. 예: ({count:1,lastAt:10:00}, 10:05) → true · 10:10 → false. @param {object} f - failures[key] @param {number} now @returns {boolean} [연계] ← tick */
    function inBackoff(f, now) { return !!f && (f.count >= MAX_RUN_FAILS || now - Date.parse(f.lastAt) < RUN_BACKOFF_MS); }
    /**
     * 1분 점검: ①지금 만들 정시 판(R.dueEdition)이 있으면 만든다 ②특보 크롤러 결과가 바뀌었으면 구역 서명을 비교해, 바뀐 구역에 걸친 관할만 다시 만든다.
     * 처음 보는 서명(재시작 직후 상태 파일에 서명이 없음)은 기록만 하고 다시 만들지 않는다. 실행 중이면 이번 점검을 건너뛴다.
     * 특보 변경은 마지막 변경 뒤 WARN_DEBOUNCE_MS(3분) 조용할 때 한 번 — 그 사이 바뀐 구역은 합친다(마지막으로 만든 서명과 비교하므로 누적, C9).
     * 서명이 같은 채 파일 시각만 바뀌면 대기를 늘리지 않고, 계속 바뀌어도 첫 변경 뒤 WARN_MAX_WAIT_MS(15분)면 만든다.
     * 실행이 던지면 실패 시각·횟수를 남기고 10분 기다린다, 같은 판(특보 변경은 'warning')은 3번까지 — 매분 AI 를 다시 부르지 않는다(B9·ops1). 3번 실패한 특보 변경은 그 서명을 받아들이고 멈춘다.
     * 예: await tick() → {edition:'2026-10-17|morning'} · {warning:['…|한림파출소'], zones:['제주도서부앞바다']} · {pending:[…]}(디바운스 대기) · {backoff:'2026-10-17|morning'} · {}
     * @returns {Promise<object>} [연계] ← start(1분) · 시험(가짜 시계)
     */
    async function tick() {
        if (running) return { busy: true };
        const now = clock(), out = {};
        const st = state(), due = R.dueEdition(now, st.done);
        if (due) {
            if (inBackoff(st.failures[due.key], now)) out.backoff = due.key;
            else {
                let r = null;
                try { r = await run({ kind: due.kind }); } catch (e) { reportFailure(due.key, e, now); out.failed = due.key; }
                if (r && r.ok) { const s2 = state(); s2.done = s2.done.concat(due.key).slice(-12); delete s2.failures[due.key]; saveState(s2); out.edition = due.key; }
            }
        }
        let mtime = null; try { mtime = fs.statSync(alertsFile).mtimeMs; } catch (_) { return out; }
        const s3 = state();
        if (s3.alertsMtime !== mtime) {
            const tree = I.readJson(alertsFile)?.current;
            if (tree) {
                const sig = warnSignatures(tree);
                s3.alertsMtime = mtime;
                if (!s3.warnSig) s3.warnSig = sig;
                else {
                    // 서명이 실제로 달라졌을 때만 「마지막 변경」을 새로 잡는다 — 크롤러가 같은 내용을 다시 써서 파일 시각만 바뀌면 대기를 늘리지 않는다.
                    const zs = changedZones(s3.warnSig, sig), pw0 = s3.pendingWarn;
                    if (!zs.length) s3.pendingWarn = null;
                    else if (!pw0 || changedZones(pw0.sig, sig).length) s3.pendingWarn = { sig, zones: zs, lastChangeAt: R.isoKst(now), since: pw0?.since || R.isoKst(now) };
                }
                saveState(s3);
            }
        }
        const pw = state().pendingWarn;
        if (!pw) return out;
        if (now - Date.parse(pw.lastChangeAt) < WARN_DEBOUNCE_MS && now - Date.parse(pw.since || pw.lastChangeAt) < WARN_MAX_WAIT_MS) { out.pending = pw.zones; return out; }
        const fw = state().failures.warning;
        if (fw && fw.count >= MAX_RUN_FAILS) { const s4 = state(); s4.warnSig = pw.sig; s4.pendingWarn = null; delete s4.failures.warning; saveState(s4); out.warningGaveUp = pw.zones; return out; }
        if (inBackoff(fw, now)) { out.backoff = (out.backoff ? out.backoff + ',' : '') + 'warning'; return out; }
        const hit = Object.entries(state().stationZones).filter(([, z]) => z.some((k) => pw.zones.includes(k))).map(([k]) => k);
        if (hit.length) {
            let r = null;
            try { r = await run({ kind: 'warning', keys: hit, zones: pw.zones }); } catch (e) { reportFailure('warning', e, now); out.failed = (out.failed ? out.failed + ',' : '') + 'warning'; return out; }
            if (!r.ok) return out;
            out.warning = hit; out.zones = pw.zones;
        }
        const s4 = state(); s4.warnSig = pw.sig; s4.pendingWarn = null; delete s4.failures.warning; saveState(s4);
        return out;
    }
    /** 운영(Fly)에서만 1분 점검을 켠다. @returns {boolean} [연계] ← server.js */
    function start() { if (!process.env.FLY_ALLOC_ID || timer) return false; timer = setInterval(() => { tick().catch((e) => console.error('[station_briefing] tick:', e && e.message)); }, 60000); timer.unref(); return true; }
    /**
     * 화면에 줄 브리핑을 고른다 — day auto 는 U58(21시 넘으면 다음 날). 다음 날 판(23:00 공개)이 아직 없으면 오늘 판을 주고 nextExpectedAt 을 붙인다.
     * 공개 대기 판(pending — §11.10.4)은 공개 시각(publishAt)이 지나야 보인다(visibleOf). 그 전에는 이전 판, 이전 판도 없으면 briefing null + nextExpectedAt = 그 공개 시각.
     * 예: pick({key, day:'auto'}) at 21:30 → {date:'2026-10-17', briefing:오늘 판, fallback:true, wanted:'2026-10-18', nextExpectedAt:'2026-10-17T23:00:00+09:00'}
     *     pick({key, day:'auto', withPending:true}) at 07:20(아침 판 대기) → {briefing:아침 판, pending:true, publishAt:'…T07:30:00+09:00', current:{generatedAt,edition}}
     * @param {object} o - key·day(auto|today|tomorrow)·withPending(관리자 미리보기만) @returns {object} [연계] ← routes GET(사용자)·GET preview(관리자, withPending)
     */
    function pick({ key, day = 'auto', withPending = false }) {
        const now = clock(), today = R.kstDate(now), tomorrow = R.kstDate(now + 86400000);
        const wanted = day === 'today' ? today : day === 'tomorrow' ? tomorrow : R.displayDate(now);
        const wd = readDay(wanted), b = visibleOf(wd, key, now);
        // 공개 대기 판(§11.10.4) — 사용자에게는 공개 시각까지 이전 판, 관리자 미리보기(withPending)는 「예정」으로 그 판을 본다
        const pd = wd && wd.pending && wd.pending[key] && Date.parse(wd.pending[key].publishAt) > now ? wd.pending[key] : null;
        if (withPending && pd && (!b || Date.parse(pd.generatedAt) > Date.parse(b.generatedAt))) return { date: wanted, briefing: pd, fallback: false, pending: true, publishAt: pd.publishAt, current: b ? { generatedAt: b.generatedAt, edition: b.edition } : null };
        if (b) return { date: wanted, briefing: b, fallback: false };
        if (wanted !== today && day === 'auto') { const t = visibleOf(readDay(today), key, now); return { date: today, briefing: t, fallback: !!t, wanted, nextExpectedAt: pd ? pd.publishAt : today + 'T23:00:00+09:00' }; }
        return { date: wanted, briefing: null, fallback: false, ...(pd ? { nextExpectedAt: pd.publishAt } : {}) };
    }
    /**
     * 관리자 상태(설정·마지막 실행·최근 3일 오류 전부(최근 것부터 — 2026-10-17 결정)·보관 규칙·상한으로 지운 기록·있는 날짜·실행 중·실행 실패 백오프·특보 변경 대기).
     * @returns {object} [연계] ← routes GET status·POST run(실행 중이면 409) · admin_station_briefing.js(오류 목록·복사·md 저장)
     */
    function status() {
        const s = state(); let days = []; try { days = fs.readdirSync(dir).map((f) => (f.match(/^briefings_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort(); } catch (_) { /* 폴더 없음 */ }
        // 공개 대기(§11.10.4) — 날짜 파일마다 아직 공개 시각이 안 된 판 수·공개 시각(관리자 상태 「공개 예정」)
        const now = clock(), pending = [];
        for (const d of days) { const dd = readDay(d), at = {}; for (const b of Object.values((dd && dd.pending) || {})) if (Date.parse(b.publishAt) > now) at[b.publishAt] = (at[b.publishAt] || 0) + 1; for (const [pa, n] of Object.entries(at)) pending.push({ date: d, publishAt: pa, stations: n }); }
        return { config: readConfig(), choices: CHOICES, lastRun: s.lastRun, done: s.done, pending, errors: keepErrors(s.errors, clock()).errors.reverse(), errorKeep: { days: ERROR_KEEP_DAYS, cap: ERROR_HARD_CAP }, errorsCapped: freshCapped(s.errorsCapped, clock()), days, running: !!running, failures: s.failures, pendingWarn: s.pendingWarn ? { zones: s.pendingWarn.zones, lastChangeAt: s.pendingWarn.lastChangeAt } : null };
    }
    /** 관할 목록(화면 설정용 — 폴리곤 없이). @returns {object[]} [연계] ← routes GET stations */
    function stationList() { const loc = I.readJson(p('locations.json'))?.stations || {}; return stations().map((s) => ({ key: s.key, name: s.name, office: s.office, region: s.region, seaOnly: s.seaOnly, location: loc[s.key]?.status === 'ok' ? { lat: loc[s.key].lat, lon: loc[s.key].lon, estimated: false } : { estimated: true } })); }
    /**
     * 관할 구역(설정 화면 「지도에서 선택하기」 — 2026-10-17) — 열쇠·해역들·폴리곤(소수 넷째 자리). 관할 목록·특보구역 도형은 바뀌지 않으므로 처음 한 번 만들어 둔다.
     * 예: stationAreas() → [{key:'제주해양경찰서|한림파출소', seas:['제주'], geometry:{…}}, …] @returns {object[]} [연계] ← routes GET areas / → I.stationAreas
     */
    function stationAreas() { return areasCache || (areasCache = I.stationAreas(stations())); }
    return { run, tick, start, stop() { if (timer) clearInterval(timer); timer = null; }, pick, readConfig, writeConfig, status, stationList, stationAreas, stations, _state: state, _readDay: readDay, _fileCacheSize: () => fileCache.size };
}
let def = null;
/**
 * 운영 기본 서비스 — 위험예측 라우트가 이미 만든 risk_store·marine_fusion 저장소를 함께 쓴다(같은 자료를 두 번 들고 있지 않게).
 * 대표 위치 카카오 검색은 운영(FLY_ALLOC_ID)에서만 켠다.
 * @returns {object} [연계] ← routes/station_briefing.js · server.js
 */
function forDefault() {
    if (def) return def;
    const { stores } = require('../routes/risk_forecast');
    def = createService({ risk: stores.risk, marine: stores.marine, geocoder: process.env.FLY_ALLOC_ID ? (a) => I.geocodeStation(a) : null, warnHistory: require('./sea_warning_history').forDir(), errorHistory: require('./risk_error_history') });
    return def;
}

module.exports = { createService, forDefault, visibleOf, settle, decideExposure, normConfig, warnSignatures, changedZones, realAdapters, historyRow, keepErrors, freshCapped, ERROR_KEEP_DAYS, ERROR_HARD_CAP, HISTORY_SOURCE, HISTORY_STALE_MS, HISTORY_PARTIAL_CODE, CHOICES, DEFAULT_CONFIG, RUN_BACKOFF_MS, MAX_RUN_FAILS, WARN_DEBOUNCE_MS, WARN_MAX_WAIT_MS, RUN_DEADLINE_MS, GEMINI_CALL_MS, start: () => forDefault().start() };
