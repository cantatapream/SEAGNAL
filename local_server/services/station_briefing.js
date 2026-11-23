/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing.js
 * 역할  : 「연안 안전 브리핑」(종전 이름 「활동지점 안전 브리핑」) 생성·저장·일정·설정을 맡는다. 정해진 판(만들기 시작 06:50·16:50·22:20 → 공개 07:30·17:30·23:00 KST — 2026-10-17 §11.10.4, 2026-10-18 §11.10.22 D 사용자 *"시각 앞당기자 40분전으로."* — 종전 07:10·17:10·22:40)과
 *         특보가 바뀔 때(그 특보구역에 걸친 관할만 — 곧바로 공개) 관할 입력을 모아(station_briefing_inputs) 규칙으로 판단하고(station_briefing_rules — 「총평과 권고」 결론·근거·권고·규칙 분석 문단 포함)
 *         연안·해상 분석 문단만 AI 로 쓴 뒤(station_briefing_ai — VM 최대 3번 → Gemini → 규칙 분석) 날짜별 파일에 저장한다. 공개 시각 전의 판은 pending 에 두고 그동안 화면에는 이전 판을 준다(visibleOf).
 *         관리자 설정(생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만)과 노출 판정(관리자 기기에만 등)도 여기서 정한다.
 *         관리자 「AI 브리핑」 탭용으로 실행 중 진행(메모리 progress — 단계·묶음·관할, progressNow)과 최근 3일 실행 기록(state.runs — 실행마다 오류 드롭다운)도 준다(§11.10.7). 오류 기록에는 검사에 떨어진 AI 글·그 관할 허용 숫자·배수도 함께 3일 남긴다(§11.10.31 — 글 실린 것은 최근 1,000건, trimRejected).
 *         오류는 누적 오류 기록(station_briefing_errlog — data/station_briefing/error_log.json)에도 번호를 붙여 처리 완료 전까지 최대 90일 남기고, 관리자가 처리 안 된 오류 전부를 누적 md 로 내보내며(유형 번호 G01…)
 *         유형별로 처리 완료한다 — 관리자 버튼, 또는 그 md 로 고친 PR 에 함께 넣은 config/station_briefing_resolved.json 이 머지·배포된 뒤 서버가 읽어 자동으로(§11.10.48).
 *         실행 요약에는 관광지 자료 확인 불가(spotFailOf — 실행 기록은 수만, 마지막 실행·마지막 정시 판(lastEdition)은 관할·관광지 이름까지)도 남긴다(§11.10.21 — 관리자 「상태」 상자·정시 판 소요 표).
 *         정시 판(자동 실행)이 끝날 때마다 관리자 휴대폰에 결과 푸시 1통(특보 변경 판은 보내지 않음 — §11.10.60)(오류가 없어도), 던지면 「분석 실패」 1통(§11.10.8 — 관리자 즉시 실행은 보내지 않음).
 *         세션 정시 판(§11.10.56): 만들기 시작 19~21분 전(06:31·16:31·21:59 — §11.10.57) 예약 작업이 띄운 Claude Code 세션이 일감(session_job.json — 판 종류는 서버가 정함)을 받아 분석 문단을 쓰고 한 번 내면,
 *         정시 판 실행이 관할 입력이 그대로이고 검사를 통과한 관할만 그 글을 쓰고 나머지는 AI 사슬로 쓴다(답이 아직이면 시작을 10분까지 미룬다).
 *         해역 기상은 소해구 예보(§11.10.19): 모으기 전에 저장된 소해구 판(smallzone_forecast — 대해구 예보가 새 판을 받을 때 미리 받아 둠)을 찾기 함수로 넘기고,
 *         저장 판이 대해구 예보 판보다 옛것이면 그 실행에서 필요한 대해구만 한 번 받아 본다(실패·시간 초과여도 계속 — 그 해역만 대해구 예보로).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js · station_briefing_ai.js · station_briefing_inputs.js · station_briefing_errlog.js(누적 오류 기록 — 유형·내보내기·처리 완료, §11.10.48)
 *                    · config/station_briefing_resolved.json(머지로 들어오는 처리 완료 목록 — 읽기만, forDefault 가 넘김)
 *                    · routes/risk_forecast.js(stores — 위험예측 화면과 같은 risk_store·marine_fusion 저장소를 함께 쓴다, 메모리 중복 방지)
 *                    · services/codex_bridge.js(VM) · services/gemini_client.js(Gemini) — 실제 어댑터는 처음 부를 때 require
 *                    · data/weather_alerts.json(특보 변경 감지 — 크롤러 결과, 읽기만) · data/station_briefing/(설정·상태·날짜별 브리핑·대표 위치 캐시)
 *                    · services/sea_warning_history.js(이미 해제된 특보 — 해제 뒤 관심, 2026-10-16 결정 4) · services/risk_error_history.js(관리자 오류현황 원천 stationBriefing — 결정 6, historyRow)
 *                    · services/smallzone_forecast.js(peek·getStatus·prefetch — 브리핑 해역의 소해구 예보, §11.10.19 · forDefault 가 넘김)
 *                    · services/sea_traffic_profile.js(forDir().profiles — 해역 카드 「최근 14일 선박 동향」, §11.10.23 · forDefault 가 넘김)
 *                    · services/admin_push.js sendAdminPush(자동 실행 결과 관리자 푸시 — 운영 FLY_ALLOC_ID 일 때만, 개발은 콘솔 한 줄 · §11.10.8) · services/collect_fail_alert.js reasonOf(실패 푸시의 짧은 분류)
 *  - 서버 API      : routes/station_briefing.js 가 이 모듈을 부른다
 *  - 나를 쓰는 곳  : routes/station_briefing.js · server.js(운영 start) · services/risk_history_sources.js(historyRow — 1분 감시) · scripts/test_station_briefing.js(가짜 시계·어댑터)
 * [로드 순서] 서버 require 부작용 없음. start() 는 운영(FLY_ALLOC_ID)에서만 1분 점검을 켠다 — 서버 시작 때 계산·외부 호출을 하지 않는다(첫 점검은 1분 뒤).
 *            공개 대기(pending)는 파일에 저장되고 공개 여부는 읽을 때 시계로 정하므로(타이머 없음) 그 사이 서버가 다시 켜져도 제 시각에 보인다.
 *            실제 AI 어댑터는 운영 또는 STATION_BRIEFING_DEV_AI=1 일 때만 부른다(개발 환경 관리자 실행은 틀 — AI 해설 없음). 실행 실패는 10분 백오프·3번까지, 특보 변경은 3분 디바운스.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./station_briefing_rules'), AI = require('./station_briefing_ai'), I = require('./station_briefing_inputs'), EL = require('./station_briefing_errlog');
const DATA = path.join(__dirname, '..', 'data');
// 관리자 「AI 브리핑」 오류 목록 보관 — 2026-10-17 사용자 결정(원문 *"ai탭에서 최근 오류 관련, 모든 최근 3일치의 오류가 다 남아있기를 바라고 이를 복사, md파일로 저장 할 수 있도록 기능도 추가 필요."*).
// 최근 3일치(KST 오늘·어제·그제 — 오류 `at` 의 KST 날짜)는 모두 남기고 그보다 오래된 것만 지운다. 종전 200개 상한(slice(-200))은 나쁜 실행 몇 번(관할 97곳 × 검증·재시도)만으로 하루 치를 밀어냈다.
// 안전 상한 ERROR_HARD_CAP: state.json 은 1분 점검마다 여러 번 읽고 쓰므로 끝없이 커지면 안 된다. 운영 10-17 08:00 판 오류가 67건 — 정시 3판에 특보 변경·관리자 실행까지
// 하루 10번 그만큼 나도 3일 2천 건 남짓이라 5,000건은 그 두 배 넘는 여유이고, 한 건 수백 바이트라 파일은 수 MB 안이다. 상한에 걸려 지운 것은 errorsCapped 로 남겨
// 관리자 화면이 「상한 때문에 지움」을 밝힌다(조용히 사라지지 않게 — CLAUDE.md L-291).
// §11.10.31 부터 검사 탈락 오류에는 AI 글·허용 목록이 실려 한 건이 수 KB 다 — 그 몫은 아래 REJECTED_KEEP 이 따로 묶는다.
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
    return { errors: trimRejected(recent.slice(-ERROR_HARD_CAP)), dropped: Math.max(0, recent.length - ERROR_HARD_CAP) };
}
// 탈락 글 보관 건수(§11.10.31 — 사용자 「진행해줘.」): 검사 탈락 오류에 붙는 AI 글·허용 목록(text·allowed — station_briefing_ai.rejectedOf)은 최근 이만큼만.
//   글이 실린 오류는 한 건이 수 KB(실측은 설계서 §11.10.31)라, 5,000건 상한까지 모두 실으면 1분 점검마다 2~3번 통째로 읽는 state.json 이 수십 MB 가 된다.
//   그보다 오래된 것은 글·허용 목록만 빼고 textDropped:true 를 남긴다(오류 줄은 그대로 — 조용히 사라지지 않게, md 가 「보관 상한으로 글을 지움」을 밝힌다).
const REJECTED_KEEP = 1000;
/**
 * 오류 목록(오래된 것 → 최근 것)에서 탈락 글(text)이 실린 것을 최근 REJECTED_KEEP 건만 두고, 그보다 오래된 것은 글·허용 목록을 빼고 textDropped:true.
 * 예: 글 실린 오류 1,002건 → 가장 오래된 2건만 {…, textDropped:true}(text·allowed 없음) · 글 없는 오류는 그대로. 원래 배열·객체는 바꾸지 않는다.
 * @param {object[]} list @returns {object[]} [연계] ← keepErrors(쓰기·읽기 둘 다)
 */
function trimRejected(list) {
    const out = list.slice();
    for (let i = out.length - 1, n = 0; i >= 0; i--) { if (!out[i].text || ++n <= REJECTED_KEEP) continue; const { text: _t, allowed: _a, ...rest } = out[i]; out[i] = { ...rest, textDropped: true }; }
    return out;
}
/**
 * 상한 기록(errorsCapped)도 보관 기간(ERROR_KEEP_DAYS, KST 날짜)이 지나면 버린다(2026-10-17 독립 검토 10 — 종전엔 한 번 걸리면 지워지지 않아 관리자 화면이 계속 「상한 때문에 지움」을 밝혔다).
 * 예: ({at:'2026-10-14T09:00:00+09:00',…}, 10-17 08:00) → null · ({at:'2026-10-15T…'}, 같은 때) → 그대로 · null → null
 * @param {object|null} c - state.errorsCapped @param {number} now - ms @returns {object|null} [연계] ← addErrors·status
 */
function freshCapped(c, now) { return c && typeof c.at === 'string' && c.at.slice(0, 10) >= R.kstDate(now - (ERROR_KEEP_DAYS - 1) * 86400000) ? c : null; }
// 실행 기록(2026-10-17 사용자 결정 §11.10.7 — 관리자 오류를 「실행마다」 드롭다운으로). 오류가 0건인 실행도 고를 수 있게 남긴다 — 오류 목록만으로 고르면
// 깨끗하게 끝난 마지막 실행이 목록에 없어, 드롭다운 첫 칸이 그 전 실행의 오류를 「최근 실행」처럼 보이게 된다(CLAUDE.md L-291 「조용한 것이 이상 없는 것처럼」의 반대 꼴).
// 오류와 같은 3일만 남긴다. 한 실행은 한 줄(시작 시각 at = 그 실행 오류들의 at 과 같은 값 — generate 가 run 의 now 로 찍는다)이라 하루 수십 줄, 상한 RUN_LOG_CAP 은 안전망.
const RUN_LOG_CAP = 500;
/**
 * 실행 기록을 보관 규칙대로 자른다 — 오류와 같은 최근 ERROR_KEEP_DAYS 일(KST 날짜), 넘으면 오래된 것부터 RUN_LOG_CAP 까지.
 * 예: keepRuns([{at:'2026-10-14T23:00:00+09:00'},{at:'2026-10-17T07:10:00+09:00'}], 10-17 08:00) → [{at:'2026-10-17T07:10…'}]
 * @param {object[]} list - {at,kind,method,ms,publishAt,results} @param {number} now - ms @returns {object[]} [연계] ← run(쓰기)·status(읽기)
 */
function keepRuns(list, now) {
    const from = R.kstDate(now - (ERROR_KEEP_DAYS - 1) * 86400000);
    return (list || []).filter((r) => r && typeof r.at === 'string' && r.at.slice(0, 10) >= from).slice(-RUN_LOG_CAP);
}
/**
 * 관광지 자료 확인 불가(연안 하루 값 상세를 못 받은 관광지 — collectLand 의 missing:['detail'])를 관할별로 모은다(§11.10.21 — 사용자 화면에서는 뺐고 관리자 「상태」에서 본다).
 * 브리핑 파일에는 관할마다 수(land.failedSpots)만 남고 이름은 없어, 실행 때 입력에서 이름을 뽑아 실행 요약에 남긴다.
 * 예: spotFailOf([{name:'한림파출소',office:'제주해양경찰서',land:{spots:[{name:'협재',missing:['detail']},{name:'한림항',missing:[]}]}}, {land:null}])
 *     → {stations:1, spots:1, list:[{office:'제주해양경찰서', station:'한림파출소', spots:['협재']}]}
 * @param {object[]} inputs - I.gather 결과 @returns {{stations:number, spots:number, list:object[]}} [연계] ← run(실행 요약 lastRun·lastEdition·runs)
 */
function spotFailOf(inputs) {
    const list = (inputs || []).filter((x) => x && x.land).map((x) => ({ office: x.office || null, station: x.name, spots: (x.land.spots || []).filter((s) => (s.missing || []).includes('detail')).map((s) => s.name) })).filter((x) => x.spots.length);
    return { stations: list.length, spots: list.reduce((a, x) => a + x.spots.length, 0), list };
}
const EDITION_KINDS = ['morning', 'evening', 'night'];   // 정시 판(§11.10.21 lastEdition — 특보 변경·관리자 실행이 마지막 정시 판의 이름 목록을 덮지 않게)
// 실행 실패 백오프(독립 검토 B9·ops1): 실행이 던지면 매분 다시 돌며 AI 를 다시 부르지 않게 — 실패 뒤 10분 기다리고, 같은 판은 3번까지만.
const RUN_BACKOFF_MS = 10 * 60000, MAX_RUN_FAILS = 3;
// 특보 변경 디바운스(독립 검토 C9): 특보가 잇달아 바뀌면 마지막 변경 뒤 3분 조용할 때 한 번만 다시 만든다.
const WARN_DEBOUNCE_MS = 3 * 60000, WARN_MAX_WAIT_MS = 15 * 60000; // 계속 바뀌어도 첫 변경 뒤 15분이면 만든다(무한 대기 방지)
// 한 번 실행의 AI 데드라인(독립 검토 B7): 넘으면 남은 관할은 규칙 분석으로 저장한다. 정시 판은 공개 시각도 넘지 않는다(§11.10.4 — 공개 시각에 된 만큼 보인다, 늦추지 않음).
const RUN_DEADLINE_MS = 20 * 60000;
// 소해구 예보 다시 받기 기다림 상한(§11.10.19). 없으면: 기상청이 응답하지 않을 때 요청마다 15초 × 3번 + 쉼(smallzone_forecast TIMEOUT_MS·RETRIES)이 26 요청에 걸려
// 브리핑이 수 분 늦게 시작되고, 그만큼 공개 시각까지의 AI 시간(위 데드라인)이 줄어든다. 넘으면 기다리지 않고 대해구 예보로 만든다(받기는 뒤에서 계속 — 저장되면 다음 실행이 쓴다).
// 정상 시간은 대해구 69개 52 요청 32.7초(§11.10.18 실측, 프록시 경유) — 40개 이하 26 요청이면 그 절반쯤으로 어림(재지 않았다). 60초는 그 몇 배 여유.
const SMALLZONE_WAIT_MS = 60000;
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
// method: 'ai' = 관리자 「AI 모델 설정 → ④ 연안 안전 브리핑」 순서대로(§11.10.51, 2026-11-16 — 화면은 「AI 분석」 켜기/끄기만) · 'template' = 규칙 분석만(AI 안 씀).
//   'chatgpt'·'gemini' 는 옛 저장값(종전 「생성 방식」) — 운영(aiChain 이 있을 때)에서는 'ai' 와 같이 순서를 따른다(시험처럼 aiChain 이 없으면 종전 사슬).
const CHOICES = Object.freeze({
    method: ['ai', 'chatgpt', 'gemini', 'template'],
    chatgptModel: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],   // codex_bridge.ANSWER_MODELS 에서 'gemini' 를 뺀 것(시험이 같은지 확인)
    geminiModel: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],  // 저장소의 다른 Gemini 호출이 쓰는 두 모델
    exposure: ['user', 'admin', 'off'],
    batchUnit: ['station', 'office', 'region'],
    onlyChanged: [true, false],
});
const DEFAULT_CONFIG = Object.freeze({ method: 'ai', chatgptModel: 'gpt-6-luna', geminiModel: 'gemini-2.5-flash', exposure: 'admin', batchUnit: 'office', onlyChanged: true });

/**
 * 설정값을 선택지 안으로 정리한다(모르는 값은 기본값). 예: {method:'x',exposure:'user'} → {method:'chatgpt',exposure:'user',…}
 * @param {object} c @returns {object} [연계] ← readConfig·writeConfig
 */
function normConfig(c) { const o = {}; for (const [k, v] of Object.entries(DEFAULT_CONFIG)) o[k] = c && CHOICES[k].includes(c[k]) ? c[k] : v; return o; }
/**
 * 노출 판정(§11.6-15) — 옛 특보 예측 표출 제어(2026-11-03 삭제)와 같은 순서:
 *   user → 모두에게 / off → 아무에게도 / admin → ①등록된 관리자 기기(admin_devices.json — FCM 토큰 또는 웹푸시 endpoint 를 그대로 대조, services/admin_device.isAdminDevice)
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
    // §11.10.51 사슬 칸(관리자 「AI 모델 설정 → ④」): ChatGPT 는 고른 실행 위치(Fly 서버|VM)의 Codex 작업자, 클로드·업스테이지는 llm_chain.callDirect(키 없음·소진이면 available 거짓 — 건너뜀).
    const L = () => require('./llm_chain'), C = () => require('./codex_bridge');
    const runner = () => { try { return require('./bulletin_ai').getConfig().briefing.models.chatgpt.runner; } catch (_) { return C().DEFAULT_RUNNER; } };
    const keyState = (id) => (L().status([]).find((x) => x.id === id) || {});
    const direct = (id) => ({
        available: () => { const st = keyState(id); return !!st.hasKey && !st.exhaustedAt; },
        why: () => { const st = keyState(id); return !st.hasKey ? '키 없음' : st.exhaustedAt ? '크레딧 소진' : '사용 불가'; },
        call: async ({ prompt, model, effort }) => { const r = await L().callDirect(id, { contents: prompt, config: { responseMimeType: 'application/json' } }, { model, effort }); if (!r.success) throw new Error(r.error || (id + ' 실패')); return r.response.text; },
    });
    return {
        chatgpt: {
            available: () => C().ENABLED && C().workerAlive(runner()),
            why: () => (!C().ENABLED ? '작업자 꺼짐' : '작업자 연결 없음(' + (runner() === 'vm' ? 'VM' : 'Fly 서버') + ')'),
            call: async ({ prompt, model, runner: r }) => { const x = await C().callRaw({ contents: prompt, config: { responseMimeType: 'application/json' }, caller: 'StationBriefing', model, runner: r || runner() }); if (!x.success) throw new Error(x.error || 'ChatGPT 실패'); return x.response.text; },
        },
        claude1: direct('claude1'), claude2: direct('claude2'), upstage: direct('upstage'),
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
// 낡음 10시간: 정시 판 실행 간격 중 가장 긴 것(밤 22:20 → 아침 06:50 — §11.10.22 D, 종전 22:40 → 07:10 도 같은) 8시간 30분 + 여유(§11.10.4 전에는 23:00→08:00 9시간 + 1시간). 이것이 없으면 브리핑이 멈춰도 오류현황엔 「정상」이 남는다(L-291).
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

// ── 자동 실행 결과 관리자 푸시(§11.10.8 · §11.10.60 — 2026-11-20 사용자 *"정기 특보 결과만 나오고 수시로바뀌는 특보 판은 푸시알림을 안보내줘도될것같아 … 정기판만 보내줄 수 있도록"* → 지금은 정시 판(morning·evening·night)만 보낸다, 특보 변경 판은 결과·실패 모두 보내지 않음) ── 사용자 원문 *"고정적으로는 하루에 세 번을 분석하게 되어 있잖아. 그리고 고정적이 아닌 것은 특보 내용이 변경됐을 때 … 그 분석을 자동으로 했을 때
//    관리자에게 분석 결과가 푸시 알림으로 왔으면 좋겠거든. 예를 들면 몇시 분석 결과 해서 오류 그 분석 도구 오류 몇번 뭐 이런 내용이 조금 정리돼서 간략하게"* · 언제 → *"매번 보내기"*(오류가 없어도).
//    정시 판(morning·evening·night)을 1분 점검(tick)이 만들고 끝날 때마다 1통(특보 변경 판 warning 은 §11.10.60 부터 보내지 않음), 던지면 「분석 실패」 1통. 관리자 즉시 실행(manual)은 보내지 않는다(관리자가 화면을 보고 있다).
//    숫자는 그 실행의 results[].stats·errors — 관리자 「AI 브리핑」 상태 카드 칩(AI·재사용·규칙 분석·시간 초과·Gemini·오류)과 같은 값이다.
/**
 * 판 이름. 정시 판은 공개 시각(EDITIONS — 관리자 탭 「07:30 판」과 같은 이름), 특보 변경은 「특보 변경 판」.
 * 예: editionName('morning') → '07:30 판' · ('night') → '23:00 판' · ('warning') → '특보 변경 판'
 * @param {string} kind @returns {string} [연계] ← runPushText·failPushText
 */
function editionName(kind) {
    if (kind === 'warning') return '특보 변경 판';
    const e = R.EDITIONS.find((x) => x.kind === kind);
    return e ? String(e.ph).padStart(2, '0') + ':' + String(e.pm).padStart(2, '0') + ' 판' : kind + ' 판';
}
/**
 * 규칙 분석으로 끝난 관할 이름 — 「파출소」를 떼고 3곳까지, 넘으면 「외 N곳」.
 * 예: ['고현파출소'] → '고현' · ['고현파출소','임원파출소','진하파출소','마검포파출소','대산파출소'] → '고현·임원·진하 외 2곳'
 * @param {string[]} names @returns {string} [연계] ← resultLine
 */
function shortNames(names) {
    const n = names.map((x) => String(x).replace(/파출소$/, ''));
    return n.slice(0, 3).join('·') + (n.length > 3 ? ' 외 ' + (n.length - 3) + '곳' : '');
}
/**
 * 날짜 판 하나의 결과 한 줄. 규칙 분석이 없으면 「N곳 모두 AI 분석」, 있으면 「N곳 — AI a · 규칙 분석 t(이름)」. 시간 초과·Gemini 는 있을 때만, 오류는 늘(0 도).
 * 예: {stations:97, stats:{ai:96,template:1,reused:0}, errors:22, rule:['고현파출소']} → '97곳 — AI 96 · 규칙 분석 1(고현) · 오류 22'
 *     {stations:97, stats:{ai:67,reused:30,template:0}, errors:0} → '97곳 모두 AI 분석(새로 67 · 재사용 30) · 오류 0'
 *     {stations:18, stats:{ai:0,reused:18,template:0}, errors:0} → '18곳 모두 지난 AI 분석 재사용(입력 변화 없음) · 오류 0'
 *     method 'template'(관리자 설정 「규칙 분석만」·개발 환경) → '97곳 규칙 분석만(AI 안 부름) · 오류 0'
 * @param {object} x - run 결과 results[i] + rule(규칙 분석 관할 이름) @param {string} method - 그 실행의 생성 방식 @returns {string} [연계] ← runPushText
 */
function resultLine(x, method) {
    const st = x.stats || {}, n = x.stations || 0, e = x.errors || 0, rule = x.rule || [];
    if (method === 'template') return n + '곳 규칙 분석만(AI 안 부름) · 오류 ' + e;
    const parts = [];
    // AI 를 한 번도 부르지 않고 전부 지난 분석을 다시 쓴 판은 「모두 AI 분석」이라 하지 않는다(§11.10.8 독립 검토 — 이번에 AI 가 분석한 것으로 읽힌다)
    // §11.10.56 세션 정시 판: 세션이 쓴 관할(stats.session)은 「세션 N」으로 따로 센다 — 세션이 없으면 종전 글 그대로.
    if (!st.template) parts.push(st.reused && !st.ai && !st.session ? n + '곳 모두 지난 AI 분석 재사용(입력 변화 없음)' : n + '곳 모두 AI 분석' + (st.session ? '(세션 ' + st.session + ' · 새로 ' + (st.ai || 0) + (st.reused ? ' · 재사용 ' + st.reused : '') + ')' : st.reused ? '(새로 ' + (st.ai || 0) + ' · 재사용 ' + st.reused + ')' : ''));
    else {
        parts.push(n + '곳 — ' + (st.session ? '세션 ' + st.session + ' · ' : '') + 'AI ' + (st.ai || 0));
        if (st.reused) parts.push('재사용 ' + st.reused);
        parts.push('규칙 분석 ' + st.template + (rule.length ? '(' + shortNames(rule) + ')' : ''));
    }
    if (st.deadline) parts.push('시간 초과 ' + st.deadline);
    if (st.gemini) parts.push('Gemini ' + st.gemini + '회');
    parts.push('오류 ' + e);
    return parts.join(' · ');
}
/**
 * 자동 실행 하나가 끝났을 때의 푸시 글. 특보 변경이 오늘·내일 두 날짜 판을 고쳤으면 날짜마다 한 줄.
 * 예: ({kind:'morning', method:'chatgpt', results:[{date:'2026-10-17',stations:97,stats:{ai:96,template:1},errors:22,rule:['고현파출소']}]})
 *     → {title:'연안 안전 브리핑 07:30 판 결과', body:'97곳 — AI 96 · 규칙 분석 1(고현) · 오류 22'}
 *     ({kind:'warning', …results 하나 18곳}) → {title:'연안 안전 브리핑 특보 변경 판 결과', body:'특보 변경 18곳 — AI 17 · 규칙 분석 1(고현) · 오류 3'}
 *     ({kind:'warning', results:[]}) → body '특보 변경 — 다시 만든 판 없음(오늘·내일 브리핑이 아직 없음)'
 * @param {object} o - kind·method·results(run 반환값) @returns {{title:string, body:string}} [연계] ← createService.pushResult
 */
function runPushText({ kind, method, results, session = null }) {
    const head = kind === 'warning' ? '특보 변경 ' : '', list = results || [];
    let body;
    if (!list.length) body = head + '— 다시 만든 판 없음(오늘·내일 브리핑이 아직 없음)';
    else if (list.length === 1) body = head + resultLine(list[0], method);
    else body = head + list.map((x) => String(x.date || '').slice(5) + ' 판 ' + resultLine(x, method)).join('\n');
    const sl = sessionLine(session); if (sl) body += '\n' + sl;
    return { title: '연안 안전 브리핑 ' + editionName(kind) + ' 결과', body };
}
/**
 * 세션 정시 판(§11.10.56) 한 줄 — 세션이 안 왔거나 늦었거나 일부만 쓰였을 때 관리자가 알게(조용한 것이 「이상 없음」처럼 보이지 않게 — CLAUDE.md L-291).
 * 세션 글을 모두 쓴 판은 결과 줄의 「세션 N」으로 충분해 덧붙이지 않는다.
 * 예: {status:'none'} → '세션: 이 판 일감이 없음(예약 작업이 안 떴거나 그때 서버가 꺼져 있었음)' · {status:'late'} → '세션: 시작 10분 뒤까지 답이 없어 모두 AI'
 *     {status:'used', used:80, changed:12, submitted:{passed:93, failed:3, missing:1}} → '세션: 통과 93 중 80곳 사용(입력 바뀜 12) · 검사 탈락 3 · 빠짐 1'
 *     null·{status:'used', used:97, changed:0, submitted:{passed:97,failed:0,missing:0}} → null
 * @param {object|null} s - run 결과 session @returns {string|null} [연계] ← runPushText
 */
function sessionLine(s) {
    if (!s) return null;
    if (s.status === 'none') return '세션: 이 판 일감이 없음(예약 작업이 안 떴거나 그때 서버가 꺼져 있었음)';
    if (s.status === 'late') return '세션: 시작 10분 뒤까지 답이 없어 모두 AI';
    const sub = s.submitted || {}, extra = [];
    if (s.changed) extra.push('입력 바뀜 ' + s.changed);
    if (sub.failed) extra.push('검사 탈락 ' + sub.failed);
    if (sub.missing) extra.push('빠짐 ' + sub.missing);
    if (sub.parseErrors) extra.push('해석 실패 묶음 ' + sub.parseErrors);
    if (!extra.length && (s.used || 0) === (sub.passed || 0)) return null;
    return '세션: 통과 ' + (sub.passed || 0) + ' 중 ' + (s.used || 0) + '곳 사용' + (extra.length ? '(' + extra[0] + ')' + (extra.length > 1 ? ' · ' + extra.slice(1).join(' · ') : '') : '');
}
/**
 * 자동 실행이 던졌을 때의 푸시 글. 오류 원문(파일 경로·주소가 섞일 수 있다)은 넣지 않고 짧은 분류만 — 시스템 오류 코드(ENOSPC 등)가 있으면 그것,
 * 없으면 collect_fail_alert.reasonOf(빈 응답·HTTP 503·시간초과·연결 실패·응답 해석 실패·기타 오류). 원문은 관리자 「AI 브리핑」 탭 「실행 실패」에 있다.
 * 예: ({kind:'morning', error:Object.assign(Error('…'),{code:'ENOSPC'}), count:1}) → {title:'연안 안전 브리핑 07:30 판 분석 실패', body:'분석 실패(1번째) — ENOSPC · 10분 뒤 다시 시도 · 자세한 이유는 관리자 → AI 브리핑'}
 *     count 3(MAX_RUN_FAILS) → '… · 이 판은 더 만들지 않음(화면은 이전 판) · …' · 특보 변경 → '… · 이 특보 변경은 더 다시 만들지 않음 · …'
 * @param {object} o - kind·error·count(이번이 몇 번째 실패 — reportFailure 반환값) @returns {{title:string, body:string}} [연계] ← createService.tick
 */
function failPushText({ kind, error, count }) {
    const code = error && /^E[A-Z0-9]+$/.test(String(error.code || '')) ? error.code : require('./collect_fail_alert').reasonOf(error);
    const next = count < MAX_RUN_FAILS ? Math.round(RUN_BACKOFF_MS / 60000) + '분 뒤 다시 시도' : kind === 'warning' ? '이 특보 변경은 더 다시 만들지 않음' : '이 판은 더 만들지 않음(화면은 이전 판)';
    return { title: '연안 안전 브리핑 ' + editionName(kind) + ' 분석 실패', body: '분석 실패(' + count + '번째) — ' + code + ' · ' + next + ' · 자세한 이유는 관리자 → AI 브리핑' };
}
/**
 * 운영 기본 발송: 운영(FLY_ALLOC_ID)에서만 admin_push.sendAdminPush(등록된 관리자 FCM 기기 전부). 개발은 보내지 않고 콘솔 한 줄 — collect_fail_alert.defaultSend 와 같은 방식.
 * 예: 운영·기기 2대 → {delivered:true} / 개발 → {delivered:false, error:'개발 환경 — 푸시 생략'}
 * @param {string} title @param {string} body @param {object} data - 문자열 값만(FCM data 규칙) @returns {Promise<{delivered:boolean, error?:string}>}
 * [연계] ← createService({adminPush}) 기본값 / → services/admin_push.js sendAdminPush(Firebase 미초기화·기기 없음·발송 오류를 모두 {sent:0} 으로 돌려준다)
 */
async function defaultAdminPush(title, body, data) {
    if (!process.env.FLY_ALLOC_ID) {
        console.log('[station_briefing] 개발 환경 — 관리자 푸시 생략: ' + title + ' / ' + body.replace(/\n/g, ' / '));
        return { delivered: false, error: '개발 환경 — 푸시 생략' };
    }
    const r = await require('./admin_push').sendAdminPush(title, body, data);
    if (r && r.sent > 0) return { delivered: true };
    return { delivered: false, error: r && r.failed > 0 ? '발송 실패 ' + r.failed + '건' : '전달 0건(기기 없음·Firebase 미초기화·발송 오류)' };
}

// ── 실행 진행(§11.10.7) ── 사용자 원문 *"분석이 시작되면 게이지로서 알려줬으면 … 묶음 단위별로 어디 묶음이 완료되었는지 그리고 그 묶음 안에서 어느 파출소 부분이 완료되었는지
//    게이지에서 표출 … 전체 게이지로서 전체적으로 얼마나 진행됐는지 … 게이지의 가운데에는 텍스트로 어디가 진행되고 있는지"*.
// 전체 칸 = 위치 확인 1 + 날짜(창)마다 (입력 모으기 1 + 관할 수). AI 앞 단계도 세어 게이지가 0 에 조용히 멈춰 있지 않게 한다. 관할 하나는 AI 통과·재사용·규칙 분석 중 하나로 끝날 때 1칸.
const PROVIDER_NAME = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude1: '클로드 키1', claude2: '클로드 키2', upstage: '업스테이지' };   // §11.10.51 — 관리자 게이지 글(사슬 AI)
/**
 * 실행 하나의 진행 상태를 새로 만든다.
 * 예: newProgress({at:'2026-10-17T18:31:00+09:00', kind:'manual', unit:'office', stations:97, windows:['2026-10-17']}) → {phase:'locate', done:0, total:99, current:'관할 대표 위치 확인 중', batches:[]…}
 * @param {object} o - at·kind·unit·stations(관할 수)·windows(대상 날짜들) @returns {object} [연계] ← run / → 관리자 게이지(admin_station_briefing.js drawProgress)
 */
function newProgress({ at, kind, unit, stations, windows }) {
    return { at, kind, unit, phase: 'locate', window: 0, windows, date: windows[0] || null, stations, done: 0, total: 1 + windows.length * (1 + stations), base: 0, batches: [], current: '관할 대표 위치 확인 중', method: null };
}
/**
 * 단계 하나를 넘긴다(위치 확인 끝 · 날짜 w 의 입력 모으기 · AI · 저장). 관할 칸은 onAiProgress 가 센다 — 여기서는 단계 칸과, 저장 때 남은 관할 칸을 맞춘다.
 * 예: stepProgress(p, 'gather', {window:0}) → p.phase 'gather', p.done 1, current '입력 자료 모으는 중 — 관할 97곳'
 * @param {object|null} pr @param {string} phase - locate-done|gather|ai|save @param {object} [o] - window·method @returns {void} [연계] ← run
 */
function stepProgress(pr, phase, o = {}) {
    if (!pr) return;
    if (phase === 'locate-done') { pr.done = 1; return; }
    const w = o.window || 0, dayNote = pr.windows.length > 1 ? ' (' + pr.windows.length + '개 날짜 중 ' + (w + 1) + '번째 · ' + String(pr.windows[w]).slice(5) + ')' : '';
    pr.window = w; pr.date = pr.windows[w] || null; pr.phase = phase;
    const base = 1 + w * (1 + pr.stations);   // 이 날짜 앞까지 끝난 칸
    if (phase === 'gather') { pr.done = base; pr.batches = []; pr.current = '입력 자료 모으는 중 — 관할 ' + pr.stations + '곳' + dayNote; }
    else if (phase === 'ai') { pr.done = base + 1; pr.base = base + 1; pr.method = o.method || null; pr.current = (o.method === 'template' ? '규칙 분석 쓰는 중(AI 없음)' : 'AI 분석 시작') + dayNote; }
    else if (phase === 'save') {
        for (const b of pr.batches) for (const x of b.stations) if (x.state !== 'done' && x.state !== 'rule') x.state = 'rule';   // 남은 관할은 generate 가 규칙 분석으로 끝냈다
        batchStates(pr); pr.done = base + 1 + pr.stations; pr.current = '저장 중' + dayNote;
    }
}
/** 묶음마다 상태(done 모두 끝 · running 부르는 중 · waiting 시작 전·다시 시도 대기)와 끝난 관할 수를 다시 센다. 예: 묶음 6곳 중 4곳 done → b.done 4, b.state 'waiting'. @param {object} pr @returns {void} [연계] ← stepProgress·onAiProgress */
function batchStates(pr) {
    let fin = 0;
    for (const b of pr.batches) {
        const f = b.stations.filter((x) => x.state === 'done' || x.state === 'rule').length; fin += f; b.done = f;
        b.state = f === b.stations.length ? 'done' : b.stations.some((x) => x.state === 'running') ? 'running' : 'waiting';
    }
    pr.done = pr.base + fin;
}
/**
 * AI.generate 의 진행 알림을 진행 상태에 반영한다 — plan(묶음·관할) · call(지금 부르는 묶음 → running, 가운데 글) · station(done·retry·rule).
 * 예: onAiProgress(p, {type:'call', batch:'통영해양경찰서', keys:['통영해양경찰서|고현파출소'], provider:'gemini', attempt:4}) → p.current '통영해양경찰서 · 고현파출소 — Gemini 4번째 시도'
 * @param {object|null} pr @param {object} ev - generate 의 onProgress 알림 @returns {void} [연계] ← run(AI.generate onProgress)
 */
function onAiProgress(pr, ev) {
    if (!pr || !ev) return;
    const find = (k) => { for (const b of pr.batches) { const x = b.stations.find((y) => y.key === k); if (x) return x; } return null; };
    if (ev.type === 'plan') pr.batches = (ev.batches || []).map((b) => ({ name: b.name, state: 'waiting', done: 0, stations: b.stations.map((x) => ({ key: x.key, name: x.name, state: x.state })) }));
    else if (ev.type === 'call') {
        for (const b of pr.batches) for (const x of b.stations) if (x.state === 'running') x.state = 'retry';   // 앞 호출이 답 없이 끝난 관할(호출 실패 — station 알림 없이 넘어감)은 다시 시도 대기
        const names = []; for (const k of ev.keys || []) { const x = find(k); if (x) { x.state = 'running'; x.attempt = ev.attempt; names.push(x.name); } }
        pr.current = ev.batch + ' · ' + (names.slice(0, 2).join('·') || '—') + (names.length > 2 ? ' 외 ' + (names.length - 2) + '곳' : '') + ' — ' + (PROVIDER_NAME[ev.provider] || ev.provider || '') + ' ' + ev.attempt + '번째 시도';
    } else if (ev.type === 'station') { const x = find(ev.key); if (x) { x.state = ev.state; if (ev.attempt) x.attempt = ev.attempt; } }
    batchStates(pr);
}
/**
 * 대해구 예보 판(risk_store 원천 상태 zoneForecasts.base — "YYYYMMDDHH" UTC). 못 읽으면 null(그 실행은 모든 해역이 대해구 예보 — §11.10.19).
 * 예: zoneBaseOf(stores.risk) → '2026101700' · marineInputs 가 던지거나 base 가 없으면 null
 * @param {object} risk - risk_store @returns {string|null} [연계] ← run
 */
function zoneBaseOf(risk) { try { const z = risk.marineInputs()?.sources?.zoneForecasts; return z && z.base ? String(z.base) : null; } catch (_) { return null; } }
/**
 * 소해구 찾기 함수(station_briefing_inputs.smallWeather 에 넘김) — 저장 판이 대해구 예보 판과 같거나 새것일 때만 그 대해구를 준다. 지난 판·저장 판 없음은 null(그 해역은 대해구로 후퇴).
 * 예: smallFinder(sz, '2026101700')('232') → sz.peek('232')(baseTm '2026101700') · 저장 판 '2026101612' → null · zb 없음 → 함수 대신 null
 * @param {object|null} sz - smallzone_forecast(peek) @param {string|null} zb - 대해구 예보 판 @returns {Function|null} [연계] ← run / → sz.peek
 */
function smallFinder(sz, zb) { return sz && zb ? (major) => { const p = sz.peek(major); return p && String(p.baseTm) >= zb ? p : null; } : null; }
/**
 * 브리핑 서비스를 만든다(시험은 폴더·시계·저장소·어댑터·관할 목록을 주입).
 * 예: const svc = createService({dir, clock, risk, marine, adapters}); await svc.run({kind:'morning'}); svc.pick({key, day:'auto'})
 * @param {object} o - dir·clock·risk·marine·adapters·loadStations·alertsFile·geocoder·tideDeps·spotsOf·hazardFeatures·kma
 *                     ·timer(경과 시간 — AI 데드라인, 기본 Date.now)·runDeadlineMs·aiOptions(generate 에 더 넘길 것 — timeouts 등)·allowRealAI(실제 AI 허용 여부)
 *                     ·warnHistory(특보 구간 기록 sea_warning_history 기록기 — 이미 해제된 특보, 결정 4. 기본 null = 보지 않음, forDefault 가 운영 기록기 forDir() 를 넘긴다)
 *                     ·errorHistory(관리자 오류현황 risk_error_history — 결정 6. 기본 null = 기록 안 함, forDefault 가 운영 것을 넘긴다)
 *                     ·regional(지방기상청 단기 해상예보·단기 전망 — 기본 I.regionalForecast(), 실행마다 한 번 읽음. §11.10.1 (기상) 칸)
 *                     ·adminPush(관리자 푸시 발송 (title, body, data) → Promise<{delivered, error?}> — 기본 defaultAdminPush, 시험은 가짜. §11.10.8)
 *                     ·smallZone(소해구 예보 — peek·getStatus·prefetch, 기본 null = 모든 해역 대해구 예보. forDefault 가 smallzone_forecast 를 넘긴다 — 시험은 가짜. §11.10.19)
 *                     ·smallZoneWaitMs(소해구 다시 받기 기다림 상한 — 기본 SMALLZONE_WAIT_MS)
 *                     ·traffic(sea_traffic_profile 계산기 {profiles} — 기본 null = 「최근 14일 선박 동향」 줄 없음. forDefault 가 forDir() 를 넘긴다 — 시험은 가짜·주입. §11.10.23)
 *                     ·resolvedFile(머지로 들어온 처리 완료 목록 config/station_briefing_resolved.json — 기본 null = 읽지 않음, forDefault 가 저장소 파일을 넘긴다. §11.10.48)
 *                     ·aiChain(AI 사슬 () → [{id, model, effort, runner, attempts}] — 관리자 「AI 모델 설정 → ④ 연안 안전 브리핑」, bulletin_ai.briefingChain. 기본 null = 종전 사슬(ChatGPT → Gemini). §11.10.51)
 * @returns {object} run·tick·start·stop·pick·readConfig·writeConfig·status·exportErrors·resolveExport·stationList·stationAreas (+ 시험용 _pushResult·_log)
 * [연계] ← forDefault·시험 / → R·AI·I
 */
function createService({ dir = path.join(DATA, 'station_briefing'), clock = Date.now, risk, marine, adapters, loadStations = () => I.loadStations(), alertsFile = path.join(DATA, 'weather_alerts.json'), geocoder = null, tideDeps, spotsOf, hazardFeatures, kma = () => I.kmaOutlook(),
    timer: elapsed = Date.now, runDeadlineMs = RUN_DEADLINE_MS, aiOptions = {}, allowRealAI = () => !!process.env.FLY_ALLOC_ID || process.env.STATION_BRIEFING_DEV_AI === '1', warnHistory = null, errorHistory = null, regional = () => I.regionalForecast(), adminPush = defaultAdminPush, smallZone = null, smallZoneWaitMs = SMALLZONE_WAIT_MS, traffic = null, resolvedFile = null, aiChain = null } = {}) {
    let timer = null, running = null, stationsCache = null, areasCache = null, ad = adapters;
    // 실행 번호(§11.10.8 — 관리자 푸시는 실행 하나에 1통). run 이 하나씩 늘려 결과에 싣고, pushResult 는 이미 보낸 번호 이하를 다시 보내지 않는다(같은 결과를 두 번 처리해도 1통).
    let runSeq = 0, pushedSeq = 0; const pushedKey = {};
    // 실행 진행(§11.10.7 — 관리자 「AI 브리핑」 진행 게이지). 메모리에만 두고 실행이 끝나면 null — 서버가 다시 켜지면 진행 중 실행도 없다.
    let progress = null;
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
    function state() { const s = I.readJson(p('state.json')) || {}; return { done: s.done || [], warnSig: s.warnSig || null, stationZones: s.stationZones || {}, lastRun: s.lastRun || null, lastEdition: s.lastEdition || null, runs: s.runs || [], errors: s.errors || [], errorsCapped: s.errorsCapped || null, alertsMtime: s.alertsMtime || null, failures: s.failures || {}, pendingWarn: s.pendingWarn || null, sessionSeenAt: s.sessionSeenAt || null }; }
    /**
     * 오류를 더한다 — 먼저 누적 오류 기록(error_log.json — 처리 완료 전까지 최대 90일, §11.10.48)에 번호를 붙여 넣고, 같은 번호가 붙은 것을
     * 상태 파일의 최근 3일 목록(실행별 화면 — 보관 규칙 최근 3일·안전 상한)에도 넣는다. 상한으로 지운 것이 있으면 errorsCapped 에 시각·수.
     * 상태 파일은 1분 점검마다 여러 번 통째로 읽으므로 90일치를 거기 두지 않는다(누적은 관리자 화면·내보내기 때만 읽는 따로 된 파일).
     * @param {object} s - state()(부르는 쪽이 저장) @param {object[]} add @param {number} now [연계] ← run·reportFailure → EL.append·keepErrors
     */
    function addErrors(s, add, now) {
        // 누적 기록이 실패해도 브리핑 실행·실패 기록(재시도 대기)은 그대로 저장한다(독립 검토 ③ — 종전엔 여기서 던져 상태 파일이 저장되지 않아 매분 다시 실행될 수 있었다).
        //   그때 넣지 못한 오류는 번호 없이 최근 3일 목록에 남고, 다음에 기록이 될 때 함께 들어간다(아래 missing). 실패는 관리자 누적 칸에 빨간 줄(logIssue).
        let withId = add;
        try {
            const lg = loadLog(s, false), missing = s.errors.filter((e) => e && !e.id), ided = EL.append(lg, missing.concat(add), now); saveLog(lg);
            const back = new Map(missing.map((e, i) => [e, ided[i]])); s.errors = s.errors.map((e) => back.get(e) || e); withId = ided.slice(missing.length);
            logIssue = null;
        } catch (e) { logIssue = { at: R.isoKst(now), what: '누적 오류 기록에 쓰지 못함(' + add.length + '건 — 다음 기록 때 다시 넣음)', reason: String((e && e.code) || (e && e.message) || e).slice(0, 120) }; console.error('[station_briefing] 누적 오류 기록 실패:', logIssue.reason); }
        const k = keepErrors(s.errors.concat(withId), now); s.errors = k.errors; if (k.dropped) s.errorsCapped = { at: R.isoKst(now), dropped: k.dropped, cap: ERROR_HARD_CAP }; else s.errorsCapped = freshCapped(s.errorsCapped, now);
    }
    function saveState(s) { I.writeJson(p('state.json'), s); }
    const LOG_FILE = 'error_log.json';
    // 누적 기록 문제(쓰기 실패 — addErrors) — 관리자 누적 칸에 빨간 줄. 다음에 쓰기가 되면 지운다.
    let logIssue = null;
    /**
     * 누적 오류 기록을 읽는다(§11.10.48).
     * - 파일이 없으면(이 기능 전 — 처음 한 번): 상태 파일에 남은 최근 3일 오류부터 옮기고(번호가 없으면 붙이고 상태 파일 쪽에도 같은 번호) 새로 시작.
     * - 내용이 깨졌으면(JSON 이 아님): 지우지 않고 error_log.broken-<시각>.json 으로 옮긴 뒤, 상태 파일의 최근 3일 오류로 되살려 새로 시작하고 recovered 를 남긴다
     *   (관리자 누적 칸에 「깨져 최근 3일만 되살림」 빨간 줄 — 독립 검토 ② · 번호는 상태 파일의 가장 큰 번호 다음부터라 겹치지 않는다 — ①).
     * - 그 밖의 읽기 실패(EIO·EMFILE 등 일시적): 아무것도 바꾸지 않고 던진다(멀쩡한 파일을 깨진 것으로 치우지 않게 — ②). 부르는 쪽이 처리한다.
     * @param {object} s - state() — 옮길 때 그 오류에 번호를 단다 @param {boolean} save - 옮겼을 때 상태 파일을 여기서 저장할지(addErrors 는 부르는 쪽이 저장)
     * @returns {object} 기록(EL.normLog) [연계] ← addErrors·status·exportErrors·resolveExport·tick(첫 점검)
     */
    function loadLog(s, save) {
        const f = p(LOG_FILE); let txt = null, recovered = null;
        try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
        if (txt !== null) {
            let raw; try { raw = JSON.parse(txt); } catch (_) { raw = undefined; }
            if (raw && typeof raw === 'object') return EL.normLog(raw);
            const bad = p('error_log.broken-' + R.isoKst(clock()).slice(0, 19).replace(/[-:]/g, '') + '.json');
            fs.renameSync(f, bad); recovered = { at: R.isoKst(clock()), file: path.basename(bad) };
            console.error('[station_briefing] 누적 오류 기록이 깨져 ' + recovered.file + ' 로 옮기고 최근 3일 오류로 되살림');
        }
        const lg = EL.emptyLog(), st = s || state();
        if (recovered) lg.recovered = recovered;
        const all = st.errors.filter(Boolean);
        if (all.length) { const ided = EL.append(lg, all, clock()), back = new Map(all.map((e, i) => [e, ided[i]])); st.errors = st.errors.map((e) => back.get(e) || e); if (save) saveState(st); }
        saveLog(lg); return lg;
    }
    function saveLog(lg) { I.writeJson(p(LOG_FILE), lg); }
    // 머지로 들어온 처리 완료 목록(resolvedFile)을 적용한 마지막 결과 — 맞지 않는 줄(issues)은 관리자 화면이 알린다.
    let repoIssues = [];
    /**
     * 저장소의 처리 완료 목록(config/station_briefing_resolved.json — AI 가 고친 PR 에 함께 넣는 파일)을 누적 기록에 적용한다(§11.10.48 — 사용자 *"머지가 되면 해당 부분이 자동으로 완료 처리"*).
     * 머지 → main 배포(deploy.yml) → 서버가 다시 켜진 뒤 첫 점검(tick)·관리자 상태·내보내기 때 부른다. 이미 처리한 유형은 건너뛰므로 여러 번 불러도 같다.
     * 파일이 없거나 깨졌으면 기록은 그대로 두고 issues 에 한 줄(조용히 지나가지 않게).
     * @param {object} lg - 고친다(바뀌면 저장) @returns {object} lg [연계] ← tick(서버가 켜진 뒤 한 번)·status·exportErrors → EL.applyRepo
     */
    function applyResolved(lg) {
        if (!resolvedFile) return lg;
        let entries = [];
        try { const j = JSON.parse(fs.readFileSync(resolvedFile, 'utf8')); entries = j && Array.isArray(j.resolved) ? j.resolved : null; }
        catch (e) { repoIssues = [{ index: null, export: null, problem: '처리 완료 목록 파일을 읽지 못함 — ' + String((e && e.code) || (e && e.message) || e).slice(0, 80) }]; return lg; }
        if (!entries) { repoIssues = [{ index: null, export: null, problem: '처리 완료 목록 파일에 resolved 배열이 없음' }]; return lg; }
        const r = EL.applyRepo(lg, entries, clock()); repoIssues = r.issues;
        if (r.changed) { saveLog(lg); console.log('[station_briefing] 머지된 처리 완료 목록 적용'); }
        return lg;
    }
    let repoApplied = false;
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
     * 소해구 예보 준비(§11.10.19 — 사용자 *"격자에 대한 소해구 매칭이 먼저 돼 있어야 되고 … 그 해당 소해구의 정보를 가져와서 … 준비된 다음부터 이제 브리핑을 만드는 작업"*,
     * 오케스트레이터 추천안 「새 판이 나올 때 미리 받아 두고, 만들 때 저장본이 지난 판이면 한 번 더 받아 보고, 그래도 없으면 그 칸만 대해구로」에 *"진행."*).
     * 저장 판(smallZone.getStatus().baseTm)이 대해구 예보 판(zb)보다 옛것(또는 없음)이면 이 실행의 해역들이 쓰는 대해구만 prefetch 한 번(실행 안에서 같은 대해구는 다시 묻지 않음 — tried),
     * smallZoneWaitMs 까지만 기다린다. 던지거나 실패·시간 초과여도 브리핑은 계속한다. 받은 뒤 입력 묶음의 sea.weatherSmall 을 다시 붙인다(찾기 함수가 새 판을 본다).
     * 저장 판이 대해구 판과 같은데 그 대해구만 없으면 받지 않는다(그 해역은 대해구 — 다음 미리 받기가 채운다).
     * 예: 저장 '2026101612' · 대해구 '2026101700' · 해역 대해구 232·233 → prefetch(['232','233'], '2026101700') → {result:'fetched', fetched:2, regions:5, small:4, …}
     * @param {object[]} inputs - I.gather 결과(고친다) @param {object} win @param {string|null} zb @param {Function|null} find - smallFinder @param {Set<string>} tried
     * @returns {Promise<object>} 상태 요약(lastRun.smallZone) — result: stored(받을 것 없음)·fetched·partial·failed·timeout·no-zone-base
     * [연계] ← run / → smallZone.getStatus·prefetch · I.smallWeather
     */
    async function prepareSmallZone(inputs, win, zb, find, tried) {
        const majors = [...new Set(inputs.flatMap((x) => (x.sea.regions || []).map((r) => (r.haegu && r.haegu.major != null ? String(r.haegu.major) : null))).filter(Boolean))];
        const info = { zoneBase: zb, baseTm: null, result: zb ? 'stored' : 'no-zone-base', fetched: 0 };
        let stored = null; try { stored = smallZone.getStatus().baseTm; } catch (_) { /* 상태를 못 읽으면 옛것으로 보고 받아 본다 */ }
        const need = zb && !(stored && String(stored) >= zb) ? majors.filter((m) => !tried.has(m)) : [];
        if (need.length) {
            need.forEach((m) => tried.add(m)); info.fetched = need.length;
            let timer = null;
            try {
                const r = await Promise.race([Promise.resolve().then(() => smallZone.prefetch(need, zb)), new Promise((res) => { timer = setTimeout(() => res({ timeout: true }), smallZoneWaitMs); })]);
                info.result = r && r.timeout ? 'timeout' : r && r.ok ? 'fetched' : r && r.got ? 'partial' : 'failed';
            } catch (e) {
                info.result = 'failed'; info.error = String((e && e.message) || e).slice(0, 160);
                console.warn('[station_briefing] 소해구 예보 ' + zb + ' 판 받기 실패 — 받지 못한 해역은 대해구 예보로: ' + info.error);
            } finally { clearTimeout(timer); }
            if (info.result !== 'fetched' && !info.error) console.warn('[station_briefing] 소해구 예보 ' + zb + ' 판 받기 ' + info.result + ' — 받지 못한 해역은 대해구 예보로');
            for (const x of inputs) x.sea.weatherSmall = I.smallWeather(x.sea.regions, win, find);
        }
        try { info.baseTm = smallZone.getStatus().baseTm || null; } catch (_) { /* 요약에만 쓰는 값 */ }
        let regions = 0, small = 0;
        for (const x of inputs) for (const r of x.sea.regions || []) if (r.haegu && r.haegu.major != null) { regions++; if ((x.sea.weatherSmall || {})[r.haegu.major + '-' + r.haegu.sub]) small++; }
        return { ...info, regions, small };
    }
    /**
     * 브리핑을 만든다. kind: morning|evening|night(정시 — 공개 시각 전이면 pending 에 저장) · warning(특보 변경 — keys 관할만, 이미 있는 오늘·내일 판의 남은 칸, 곧바로 공개) · manual(관리자 실행 — 화면이 지금 보일 날짜, 곧바로 공개).
     * 실제 AI 어댑터는 운영(FLY_ALLOC_ID) 또는 STATION_BRIEFING_DEV_AI=1 일 때만 — 그 밖(개발 환경)에서 어댑터를 주입하지 않았으면 틀만 — AI 해설 없음(C9).
     * 시각: 창은 시작 시각으로 정하지만, 위치 찾기·AI 가 오래 걸려도 연안 하루 값 시각이 낡지 않게 모으기 직전에 시각을 다시 잡는다(C2 — risk_store 는 지금−5분보다 앞선 시각을 400 으로 거부).
     * AI 데드라인 runDeadlineMs(기본 20분)과 공개 시각 중 이른 것 — 넘으면 남은 관할은 규칙 분석(B7·§11.10.4).
     * 예: await run({kind:'morning'}) → {ok:true, results:[{date:'2026-10-17', stations:97, stats:{…}, errors, publishAt}], ms, seq:1(실행 번호), method:'chatgpt', rule:[['고현파출소']](날짜 판마다 규칙 분석 관할 — §11.10.8 푸시 글용)}
     * @param {object} o - kind·keys(대상 관할 열쇠, 없으면 전부)·zones(특보 변경 구역 — 기록용) @returns {Promise<object>}
     * [연계] ← tick·routes POST run / → I.gather·R.buildBriefing·AI.generate
     */
    // ── 세션 시험(2026-11-17 사용자 「세션을 통해서 테스트를 통해서 실제로 얼마나 걸리는지 여부에 대해서 확인할 필요가 있을 것 같아. 실제로 돌려보면서」) ──
    //   정시 판을 Claude Code 세션이 쓰면 얼마나 걸리고 몇 곳이 검사를 통과하는지 **재기만** 하는 길이다. 사용자 화면·날짜 파일·오류 기록에는 아무것도 쓰지 않는다.
    //   trialJob: 정시 판과 같은 재료(I.gather → R.buildBriefing → AI.stationInput)로 묶음별 지시문을 만들어 준다(AI 는 부르지 않는다).
    //   trialResult: 세션이 쓴 답을 서버의 같은 검사(polishOverview → validateOverview)로 판정하고, 걸린 시간과 함께 session_trials.json 에 남긴다.
    //   [연계] routes/station_briefing.js GET·POST /api/station-briefing/automation/trial-* (관리자 또는 자동화 열쇠) · 설계서 §11.10.53
    const trials = new Map();   // job_id → {at, kind, targetDate, si: Map(key→stationInput), batches}
    const TRIAL_KEEP = 3, TRIAL_TTL_MS = 6 * 3600000, TRIAL_LOG_KEEP = 20;
    /**
     * 시험 일감 — 정시 판 재료로 묶음별 지시문을 만든다. 실제 실행 중이면 만들지 않는다(같은 위치 파일을 함께 쓰지 않게).
     * 예: await trialJob({kind:'evening'}) → {job_id:'t-…', kind:'evening', targetDate:'2026-11-17', stations:97, batches:[{name:'인천해양경찰서', keys:[…], prompt:'…'}], build_ms}
     * @param {{kind?:'morning'|'evening'|'night'}} [o] @returns {Promise<object>}
     */
    async function trialJob({ kind = 'evening' } = {}) {
        if (!EDITION_KINDS.includes(kind)) { const e = new Error('kind 는 morning·evening·night'); e.status = 400; throw e; }
        if (running) { const e = new Error('브리핑 실행 중 — 끝난 뒤 다시'); e.status = 409; throw e; }
        const t0 = Date.now(), now = clock(), { win, items, batches, unit, k } = await buildJob(kind, now);
        const job_id = 't-' + R.isoKst(now).slice(0, 16).replace(/[-T:]/g, '') + '-' + Math.random().toString(16).slice(2, 6);
        for (const [id, j] of trials) if (now - j.at > TRIAL_TTL_MS) trials.delete(id);
        trials.set(job_id, { at: now, kind, targetDate: win.targetDate, si: new Map(items.map((it) => [it.b.key, it.si])), batches: batches.map((b) => ({ name: b.name, keys: b.keys })) });
        while (trials.size > TRIAL_KEEP) trials.delete(trials.keys().next().value);
        return { job_id, kind, targetDate: win.targetDate, unit, stations: items.length, batches: batches.map((b) => ({ ...b, prompt: AI.buildPrompt(AI.batchInput(b.keys.map((key) => items.find((it) => it.b.key === key).si), k, null)) })), build_ms: Date.now() - t0, issuedAt: R.isoKst(now) };
    }
    /**
     * 일감 재료 — 정시 판과 같은 재료(I.gather → R.buildBriefing → AI.stationInput)를 모아 관할 입력과 묶음(이름·관할 열쇠)을 만든다. AI 는 부르지 않는다.
     * 시험 일감(trialJob)과 운영 일감(sessionJob — §11.10.56)이 함께 쓴다.
     * 예: await buildJob('morning', now) → {win, items:[{b, si}], batches:[{name:'인천해양경찰서', keys:[…]}], unit:'office', k(기상청 전망)}
     * @param {string} kind - morning|evening|night @param {number} now - ms @returns {Promise<object>} [연계] ← trialJob·sessionJob / → I.gather·R.buildBriefing·AI.stationInput·AI.groupBy
     */
    async function buildJob(kind, now) {
        const config = readConfig(), all = stations();
        const win = R.editionWindow(kind, now);
        const spots = spotsOf ? spotsOf() : risk.spots().spots, spotsBySt = I.assignSpots(all, spots);
        const hz = I.assignHazards(all, hazardFeatures ? hazardFeatures() : (I.readJson(path.join(I.CONFIG, 'coastal_hazard_zones.wgs84.geojson'))?.features || []));
        const landPoints = Object.fromEntries(all.map((s) => [s.key, (spotsBySt.get(s.key) || []).concat(hz.get(s.key) || [])]));
        const locations = await I.ensureLocations({ stations: all, landPoints, file: p('locations.json'), geocoder, now });
        const rg = regional ? regional() : null, zb = smallZone ? zoneBaseOf(risk) : null, szFind = smallFinder(smallZone, zb);
        const inputs = I.gather({ stations: all, risk, marine, win, now: clock(), locations, hazards: hz, spotsBySt, tideDeps, warnHistory, regional: rg, smallZone: szFind, traffic });
        if (smallZone) await prepareSmallZone(inputs, win, zb, szFind, new Set());
        const briefings = inputs.map((x) => R.buildBriefing(x, win, { generatedAt: R.isoKst(now) }));
        const k = kma(), items = briefings.map((b) => ({ b, si: AI.stationInput(b, k) }));
        const unit = config.batchUnit || 'office';
        const batches = AI.groupBy(items, unit).map((g) => ({
            name: unit === 'station' ? g[0].b.station.name : unit === 'region' ? (g[0].b.station.region || g[0].b.station.office) : g[0].b.station.office,
            keys: g.map((it) => it.b.key),
        }));
        return { win, items, batches, unit, k };
    }
    /**
     * 세션이 쓴 묶음별 답을 관할마다 서버 검사(polishOverview → validateOverview)로 판정한다. 시험(trialResult)과 운영(sessionResult)이 같은 판정을 쓴다.
     * 예: judgeAnswers(Map{key→si}, [{batch, text:'{"stations":[…]}'}]) → {res:Map{key→{ok, errors, land, sea}}, passed, failed, missing, parseErrors, topErrors}
     * @param {Map} siMap - 관할 열쇠 → stationInput @param {*} answers - [{batch, text}] @returns {object} [연계] ← trialResult·sessionResult / → AI.parseResponse·polishOverview·validateOverview
     */
    function judgeAnswers(siMap, answers) {
        const list = Array.isArray(answers) ? answers.slice(0, 200) : [];
        const got = new Map(); let parseErrors = 0;
        for (const a of list) {
            try { for (const [id, o] of AI.parseResponse(String((a && a.text) || '').slice(0, 400000))) if (siMap.has(id) && !got.has(id)) got.set(id, o); }
            catch (e) { parseErrors++; console.warn('[station_briefing] 세션 답 해석 실패:', e && e.message); }
        }
        let passed = 0, failed = 0, missing = 0; const errCount = {}, res = new Map();
        for (const [key, si] of siMap) {
            const raw = got.get(key);
            if (!raw) { missing++; res.set(key, { ok: false, missing: true, errors: ['missing:station'], land: null, sea: null }); continue; }
            const o = AI.polishOverview(raw), v = o ? AI.validateOverview(o, si) : { ok: false, errors: ['missing:station'] };
            res.set(key, { ok: v.ok, errors: v.ok ? [] : v.errors.slice(0, 8), land: o && o.land ? String(o.land).slice(0, 1000) : null, sea: o && o.sea ? String(o.sea).slice(0, 1000) : null });
            if (v.ok) passed++; else { failed++; for (const er of v.errors) { const g = er.split(':').slice(0, 2).join(':'); errCount[g] = (errCount[g] || 0) + 1; } }
        }
        return { res, passed, failed, missing, parseErrors, topErrors: Object.entries(errCount).sort((x, y) => y[1] - x[1]).slice(0, 10) };
    }
    /**
     * 시험 결과 — 세션이 쓴 묶음별 답(지시문이 요구한 JSON 글)을 서버 검사로 판정하고 기록한다. 화면·날짜 파일·오류 기록은 건드리지 않는다.
     * 예: trialResult({job_id, answers:[{batch:'인천해양경찰서', text:'{"stations":[…]}'}], timings:{session_start:'…'}})
     *     → {ok:true, stations:97, passed:80, failed:12, missing:5, parseErrors:0, topErrors:[['place:…',3]], elapsed_ms}
     * @param {object} body @returns {object}
     */
    function trialResult(body) {
        const b = body && typeof body === 'object' ? body : {};
        const job = trials.get(String(b.job_id || ''));
        if (!job) { const e = new Error('시험 일감을 찾지 못함(서버가 다시 켜졌거나 6시간이 지남) — 다시 받아 주세요'); e.status = 404; throw e; }
        const { res, passed, failed, missing, parseErrors, topErrors } = judgeAnswers(job.si, b.answers);
        const perStation = [...res].map(([key, x]) => ({ key, ok: x.ok, errors: x.errors.slice(0, 6) }));
        const texts = new Map([...res].map(([key, x]) => [key, { land: x.land ? x.land.slice(0, 700) : null, sea: x.sea ? x.sea.slice(0, 700) : null, ok: x.ok, ...(x.missing ? { missing: true } : {}) }]));
        const now = clock();
        const t = b.timings && typeof b.timings === 'object' ? b.timings : {};
        const clean = (x) => (typeof x === 'string' ? x.slice(0, 40) : Number.isFinite(x) ? x : null);
        const rec = { job_id: String(b.job_id), kind: job.kind, targetDate: job.targetDate, issuedAt: R.isoKst(job.at), resultAt: R.isoKst(now), elapsed_ms: now - job.at,
            stations: job.si.size, passed, failed, missing, parseErrors, topErrors,
            timings: Object.fromEntries(Object.entries(t).slice(0, 12).map(([kk, vv]) => [String(kk).slice(0, 40), clean(vv)])), note: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
            // 표본 글(2026-11-17 사용자 「진행」 — 지금 AI 글과 나란히 보려고): 관할 목록에서 고르게 8곳(글자 수 상한 700).
            samples: (() => { const ks = [...texts.keys()], n = Math.min(8, ks.length), step = ks.length / Math.max(1, n); return [...Array(n)].map((_, i) => ks[Math.floor(i * step)]).map((key) => ({ key, ...texts.get(key) })); })() };
        try {
            let log = []; try { log = JSON.parse(fs.readFileSync(p('session_trials.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('[station_briefing] 세션 시험 기록을 못 읽어 새로 씀:', e.message); }
            I.writeJson(p('session_trials.json'), (Array.isArray(log) ? log : []).concat([rec]).slice(-TRIAL_LOG_KEEP));
        } catch (e) { console.error('[station_briefing] 세션 시험 기록 저장 실패(판정 결과는 그대로 돌려줌):', e.message); }
        return { ok: true, ...rec, perStation };
    }
    /**
     * 세션 시험 표본과 **같은 관할의 지금 판 AI 글**을 나란히 준다(그 날짜 파일의 공개 대기 판 또는 공개 판). 아무것도 쓰지 않는다.
     * 예: trialCompare('t-…') → {job_id, kind, targetDate, pairs:[{key, session:{land,sea,ok}, current:{land,sea,source,generatedAt}|null}]}
     * @param {string} jobId @returns {object}
     */
    function trialCompare(jobId) {
        const rec = trialLog().slice().reverse().find((r) => r.job_id === String(jobId || '')) || trialLog().slice(-1)[0];
        if (!rec) { const e = new Error('시험 기록이 없음'); e.status = 404; throw e; }
        const day = readDay(rec.targetDate) || {};
        const cur = (k) => { const a = (day.pending || {})[k], b = (day.stations || {})[k], x = !a ? b : !b ? a : (Date.parse(a.generatedAt) > Date.parse(b.generatedAt) ? a : b); return x ? { land: (x.overview && x.overview.land) || null, sea: (x.overview && x.overview.sea) || null, source: (x.overview && x.overview.source) || null, generatedAt: x.generatedAt || null, edition: (x.trigger && x.trigger.kind) || null } : null; };
        return { job_id: rec.job_id, kind: rec.kind, targetDate: rec.targetDate, resultAt: rec.resultAt, pairs: (rec.samples || []).map((sm) => ({ key: sm.key, session: { land: sm.land, sea: sm.sea, ok: sm.ok }, current: cur(sm.key) })) };
    }
    /** 세션 시험 기록(최근 20개). @returns {object[]} */
    function trialLog() { try { const l = JSON.parse(fs.readFileSync(p('session_trials.json'), 'utf8')); return Array.isArray(l) ? l : []; } catch (e) { if (e.code !== 'ENOENT') console.warn('[station_briefing] 세션 시험 기록 읽기 실패:', e.message); return []; } }

    // ── 세션 정시 판(2026-11-19 사용자 「나까지 이어서 만들자」 — 설계서 §11.10.56) ──
    //   정시 판의 분석 문단을 Claude Code 세션이 먼저 쓰고, 떨어지거나 늦은 관할만 지금 AI 사슬이 쓴다.
    //   ①예약 작업(하루 3번 — 06:31·16:31·21:59 KST, §11.10.57 — 연안 첫 칸의 해구 예보가 16:30 에 바뀌어 저녁은 그 뒤에)이 세션을 띄우면 세션이 GET /automation/job 으로 일감을 받는다. **판 종류는 서버가 시계로 정한다**(세션이 고르지 않는다).
    //   ②일감은 파일(session_job.json)에 둔다 — 배포로 서버가 다시 켜져도 남는다(3차 시험에서 메모리 일감이 배포 재시작으로 사라졌다).
    //   ③답은 일감 하나에 한 번만 받는다(POST /automation/job-result) — 2차 시험에서 세션이 시키지 않은 판을 한 번 더 냈다.
    //   ④정시 판 실행(run)이 그 답을 쓴다 — 관할 입력이 일감 때와 같고(sessionHash) 다시 검사해도 통과한 관할만 세션 글, 나머지는 지금 AI 사슬(AI.generate drafts).
    //   ⑤일감을 받아 놓고 답이 아직이면 1분 점검이 만들기 시작을 SESSION_WAIT_MS(10분)까지 미룬다 — 공개 시각(30분 뒤)에 AI 데드라인 20분이 그대로 들어간다.
    const SESSION_BEFORE_MS = 30 * 60000, SESSION_WAIT_MS = 10 * 60000, SESSION_LOG_KEEP = 30;
    const JOB_FILE = 'session_job.json', JOB_LOG = 'session_jobs.json';
    let jobBuilding = null, jobBuildingKey = null;   // 일감을 만드는 중(그 판 열쇠) — 1분 점검은 그동안 그 판을 시작하지 않는다(독립 검토 하7)
    /**
     * 지금 세션 일감을 줄 정시 판 — 만들기 시작(06:50·16:50·22:20) 30분 전부터 시작 전까지만. 그 밖이면 null.
     * 예: 06:35 → {kind:'morning', key:'2026-11-19|morning', buildAt:ms(06:50)} · 06:50 → null · 22:05 → {kind:'night', key:'2026-11-19|night', …}
     * @param {number} now - ms @returns {object|null} [연계] ← sessionJob
     */
    function sessionEdition(now) {
        const d = R.kstDate(now);
        for (const e of R.EDITIONS) {
            const buildAt = Date.parse(d + 'T' + String(e.h).padStart(2, '0') + ':' + String(e.m).padStart(2, '0') + ':00+09:00');
            if (now >= buildAt - SESSION_BEFORE_MS && now < buildAt) return { kind: e.kind, key: d + '|' + e.kind, buildAt };
        }
        return null;
    }
    function readJob() { const j = I.readJson(p(JOB_FILE)); return j && typeof j === 'object' && j.job_id ? j : null; }
    function saveJob(j) { I.writeJson(p(JOB_FILE), j); }
    /** 일감 요약 한 줄을 기록(최근 30개)에 더한다 — 관할 입력(si)·글은 싣지 않는다. @param {object} j @param {string} event [연계] ← sessionResult·run */
    function logJob(j, event) {
        try {
            const l = I.readJson(p(JOB_LOG)), rec = { at: R.isoKst(clock()), event, job_id: j.job_id, key: j.key, kind: j.kind, targetDate: j.targetDate, issuedAt: j.issuedAt, status: j.status, submittedAt: j.submittedAt || null, summary: j.summary || null, use: j.use || null, timings: j.timings || null, note: j.note || '' };
            I.writeJson(p(JOB_LOG), (Array.isArray(l) ? l : []).concat([rec]).slice(-SESSION_LOG_KEEP));
        } catch (e) { console.error('[station_briefing] 세션 일감 기록 실패:', e && e.message); }
    }
    /** 세션 일감 기록(최근 30개 — 오래된 것부터). @returns {object[]} [연계] ← routes GET /automation/jobs */
    function jobLog() { const l = I.readJson(p(JOB_LOG)); return Array.isArray(l) ? l : []; }
    /** 세션에 줄 일감 모양 — 묶음마다 지시문은 저장한 관할 입력으로 그때 만든다(파일에는 지시문을 두지 않는다). @param {object} j @returns {object} */
    function jobView(j) {
        return { job_id: j.job_id, kind: j.kind, edition: editionName(j.kind), targetDate: j.targetDate, issuedAt: j.issuedAt, deadline: j.waitUntil, stations: Object.keys(j.stations).length, unit: j.unit,
            batches: j.batches.map((b) => ({ name: b.name, keys: b.keys, prompt: AI.buildPrompt(AI.batchInput(b.keys.map((key) => j.stations[key].si), j.kma, null)) })) };
    }
    /**
     * 세션 일감을 준다(GET /automation/job). 판 종류는 서버가 시계로 정한다(sessionEdition). 같은 판 일감이 이미 있으면 그것을 다시 준다(답을 낸 뒤면 409).
     * 예: 06:35 → {job_id:'s-202611190635-ab12', kind:'morning', edition:'07:30 판', targetDate, deadline:'…T07:00:00+09:00', batches:[{name, keys, prompt}]}
     *     07:10 → 404(받을 일감 없음) · 같은 판 답을 낸 뒤 → 409
     * @returns {Promise<object>} [연계] ← routes GET /api/station-briefing/automation/job / → buildJob·AI.sessionHash
     */
    async function sessionJob() {
        const now = clock(), e = sessionEdition(now);
        if (!e) throw Object.assign(new Error('지금 받을 일감 없음 — 정시 판 만들기 시작(06:50·16:50·22:20) 30분 전부터 시작 전까지만 줍니다'), { status: 404 });
        if (state().done.includes(e.key)) throw Object.assign(new Error('이 판(' + e.key + ')은 이미 만들어졌습니다'), { status: 409 });
        const cur = readJob();
        if (cur && cur.key === e.key) {
            if (cur.status !== 'open') throw Object.assign(new Error('이 판(' + e.key + ') 일감은 이미 ' + (cur.status === 'submitted' || cur.status === 'used' ? '답을 받았습니다 — 일감 하나에 답은 한 번' : '닫혔습니다(' + cur.status + ')')), { status: 409 });
            cur.fetches = (cur.fetches || 0) + 1; saveJob(cur); return jobView(cur);
        }
        if (running) throw Object.assign(new Error('브리핑 실행 중 — 끝난 뒤 다시'), { status: 409 });
        if (jobBuilding) return jobBuilding;   // 같은 때 두 번 불러도 일감은 하나
        jobBuildingKey = e.key;
        jobBuilding = (async () => {
            const { win, items, batches, unit, k } = await buildJob(e.kind, now);
            // 만드는 사이(위치 확인·소해구 받기 — 수십 초) 정시 판이 시작됐거나 끝났으면 일감을 두지 않는다 — 받아도 쓰이지 않는 답을 받지 않게(독립 검토 하7)
            if (running || state().done.includes(e.key)) throw Object.assign(new Error('일감을 만드는 사이 이 판(' + e.key + ') 실행이 시작됐습니다'), { status: 409 });
            const j = { job_id: 's-' + R.isoKst(now).slice(0, 16).replace(/[-T:]/g, '') + '-' + Math.random().toString(16).slice(2, 6), key: e.key, kind: e.kind, targetDate: win.targetDate,
                buildAt: R.isoKst(e.buildAt), waitUntil: R.isoKst(e.buildAt + SESSION_WAIT_MS), issuedAt: R.isoKst(now), status: 'open', fetches: 1, unit, kma: k, batches,
                stations: Object.fromEntries(items.map((it) => [it.b.key, { si: it.si, hash: AI.sessionHash(it.si, k) }])) };
            saveJob(j); logJob(j, 'issued');
            const st = state(); st.sessionSeenAt = j.issuedAt; saveState(st);
            return jobView(j);
        })();
        try { return await jobBuilding; } finally { jobBuilding = null; jobBuildingKey = null; }
    }
    /**
     * 세션의 답을 받는다(POST /automation/job-result) — 일감 하나에 한 번. 관할마다 서버 검사로 판정해 일감 파일에 남긴다(글은 정시 판 실행이 쓴다).
     * 정시 판 실행이 이미 시작했거나(일감이 late — takeDrafts) 그 판이 만들어졌거나 공개 시각(시작 + 40분)이 지났으면 받지 않는다(409 — 그 판은 AI 사슬이 썼다).
     * 마감(waitUntil)이 지났어도 실행이 아직 시작하지 않았으면 받는다 — 다른 실행(관리자 즉시 실행)이 길어져 정시 판 시작이 밀린 경우(독립 검토 중2·중3).
     * 예: sessionResult({job_id, answers:[{batch, text}], timings, note}) → {ok:true, job_id, kind, passed:95, failed:2, missing:0, parseErrors:0, topErrors, perStation}
     * @param {object} body @returns {object} [연계] ← routes POST /api/station-briefing/automation/job-result / → judgeAnswers
     */
    function sessionResult(body) {
        const b = body && typeof body === 'object' ? body : {}, j = readJob(), now = clock();
        if (!j || j.job_id !== String(b.job_id || '')) throw Object.assign(new Error('일감을 찾지 못함 — 지금 일감은 ' + (j ? j.job_id : '없음')), { status: 404 });
        if (j.status !== 'open') throw Object.assign(new Error('이 일감은 이미 ' + (j.status === 'late' ? '시간이 지나 닫혔습니다(그 판은 AI 사슬이 씀)' : '답을 받았습니다 — 일감 하나에 답은 한 번')), { status: 409 });
        if (now >= Date.parse(j.buildAt) + 40 * 60000 || state().done.includes(j.key)) { j.status = 'late'; j.lateAt = R.isoKst(now); saveJob(j); logJob(j, 'late'); throw Object.assign(new Error('시간이 지나 받지 않습니다(이 판은 이미 만들어졌거나 공개 시각이 지남) — 그 판은 AI 사슬이 씁니다'), { status: 409 }); }
        const siMap = new Map(Object.entries(j.stations).map(([key, x]) => [key, x.si]));
        const r = judgeAnswers(siMap, b.answers);
        const t = b.timings && typeof b.timings === 'object' ? b.timings : {}, clean = (x) => (typeof x === 'string' ? x.slice(0, 40) : Number.isFinite(x) ? x : null);
        j.status = 'submitted'; j.submittedAt = R.isoKst(now); j.result = Object.fromEntries(r.res);
        j.summary = { passed: r.passed, failed: r.failed, missing: r.missing, parseErrors: r.parseErrors, topErrors: r.topErrors, elapsed_ms: now - Date.parse(j.issuedAt) };
        j.timings = Object.fromEntries(Object.entries(t).slice(0, 12).map(([kk, vv]) => [String(kk).slice(0, 40), clean(vv)])); j.note = typeof b.note === 'string' ? b.note.slice(0, 500) : '';
        saveJob(j); logJob(j, 'submitted');
        return { ok: true, job_id: j.job_id, kind: j.kind, targetDate: j.targetDate, ...j.summary, perStation: [...r.res].map(([key, x]) => ({ key, ok: x.ok, errors: x.errors.slice(0, 6) })) };
    }
    /**
     * 정시 판 실행이 쓸 세션 답을 꺼낸다 — 그 판의 일감만(열쇠 key 가 있으면 열쇠로, 없으면 종류·대상 날짜·3시간 안).
     * 아직 답이 없으면(open) late 로 닫는다(실행이 시작한 뒤 온 답은 받지 않는다). 답이 있으면 상태를 바꾸지 않는다 — 실행이 끝까지 저장한 뒤 markUsed 가 used 로 바꾼다
     * (실행이 던지거나 배포로 끊겨 다시 돌 때도 같은 답을 쓰게 — 독립 검토 중1).
     * 예: takeDrafts('morning', '2026-11-19', '2026-11-19|morning') → {drafts:{key:{ok, errors, land, sea, hash}}, info:{job_id, status:'used', submitted}, job}
     *     답 없음 → {drafts:null, info:{job_id, status:'late'}, job} · 일감 없음 → {drafts:null, info:null, job:null}
     * @param {string} kind @param {string} targetDate @param {string|null} key - 판 열쇠('날짜|판' — 1분 점검이 넘김) @returns {object} [연계] ← run
     */
    function takeDrafts(kind, targetDate, key) {
        const j = readJob(), now = clock();
        const same = j && j.kind === kind && j.targetDate === targetDate && (key ? j.key === key : now - Date.parse(j.issuedAt) <= 3 * 3600000);
        if (!same) return { drafts: null, info: null, job: null };
        if (j.status === 'open') { j.status = 'late'; j.lateAt = R.isoKst(now); saveJob(j); logJob(j, 'late'); }
        if (j.status === 'late') return { drafts: null, info: { job_id: j.job_id, status: 'late' }, job: j };
        if (j.status !== 'submitted' && j.status !== 'used') return { drafts: null, info: null, job: null };
        const drafts = Object.fromEntries(Object.entries(j.result || {}).filter(([k]) => j.stations[k]).map(([k, x]) => [k, { ...x, hash: j.stations[k].hash }]));
        return { drafts, info: { job_id: j.job_id, status: 'used', submitted: j.summary }, job: j };
    }

    async function run({ kind, keys = null, zones = null, key = null } = {}) {
        if (running) return { ok: false, skipped: 'busy' };
        running = (async () => {
            const t0 = elapsed(), now = clock(), config = readConfig(), all = stations(), st = state();
            const targets = keys ? all.filter((s) => keys.includes(s.key)) : all;
            const wins = [];
            if (kind === 'warning') { for (const d of [R.kstDate(now), R.kstDate(now + 86400000)]) { const day = readDay(d); if (!day) continue; const w = R.editionWindow('warning', now, d); if (w) wins.push(w); } }
            else if (kind === 'manual') { const d = R.displayDate(now), w = R.editionWindow(d === R.kstDate(now) ? 'morning' : 'night', now); wins.push({ ...w, kind: 'manual' }); }
            else wins.push(R.editionWindow(kind, now));
            progress = newProgress({ at: R.isoKst(now), kind, unit: config.batchUnit, stations: targets.length, windows: wins.map((w) => w.targetDate) });
            const spots = spotsOf ? spotsOf() : risk.spots().spots, spotsBySt = I.assignSpots(all, spots);
            const hz = I.assignHazards(all, hazardFeatures ? hazardFeatures() : (I.readJson(path.join(I.CONFIG, 'coastal_hazard_zones.wgs84.geojson'))?.features || []));
            const landPoints = Object.fromEntries(all.map((s) => [s.key, (spotsBySt.get(s.key) || []).concat(hz.get(s.key) || [])]));
            const locations = await I.ensureLocations({ stations: all, landPoints, file: p('locations.json'), geocoder, now });
            stepProgress(progress, 'locate-done');
            const aiOn = !!ad || allowRealAI(), rg = regional ? regional() : null;
            // §11.10.51: AI 를 쓰면 관리자 「AI 모델 설정 → ④」 순서(aiChain — 운영 forDefault 가 넘김). aiChain 이 없으면(시험) 'ai' 는 종전 사슬(ChatGPT → Gemini)로.
            let cfg = aiOn ? config : { ...config, method: 'template' };
            if (cfg.method !== 'template') cfg = aiChain ? { ...cfg, method: 'ai', chain: aiChain() } : cfg.method === 'ai' ? { ...cfg, method: 'chatgpt' } : cfg;
            const skippedAll = new Map();   // 이번 실행에서 못 써서 건너뛴 AI(날짜 판마다 같음 — 한 번만)
            // 공개 시각(§11.10.4): 정시 판은 EDITIONS 공개 시각(07:30·17:30·23:00) — 그 전에는 pending 에 두고 화면은 이전 판. 특보 변경·관리자 실행은 곧바로(publishAt = 만든 시각).
            //   데드라인 = 20분과 「공개 시각까지」 중 이른 것 — 공개 시각에 된 만큼(AI 분석 + 나머지는 규칙 분석) 보이고 늦추지 않는다. 공개 시각이 이미 지난 늦은 실행은 20분 그대로(곧바로 공개).
            //   §11.10.22 D(2026-10-18 — 공개 40분 전 시작): 제때 시작한 정시 판은 20분 쪽이 걸려, 다 쓰지 못해도 공개 시각보다 20분 앞서 끝난다(데드라인 규칙은 그대로 — 작업 지시서 「여유 20분 생김」).
            const publishAt = R.publishAtFor(kind, now) || R.isoKst(now), untilPublish = Date.parse(publishAt) - now;
            const deadline = t0 + (untilPublish > 0 ? Math.min(runDeadlineMs, untilPublish) : runDeadlineMs);
            const results = [], rule = [], szTried = new Set();
            let szInfo = null;
            // §11.10.56 세션 정시 판 — 같은 판 일감의 세션 답(없으면 null). 세션을 쓰기 시작한 뒤(최근 3일 안에 일감이 있었음)인데 이 판 일감이 없으면 「none」 — 관리자 푸시가 밝힌다.
            //   「none」은 기한 없이 — 한 번이라도 세션 일감이 있었던 서버면 계속 밝힌다(3일 뒤 저절로 조용해지면 고장과 끔이 같아 보인다 — 독립 검토 중4). 규칙 분석만(template)이면 세션을 쓰지 않으니 밝히지 않는다(하5).
            const sess = EDITION_KINDS.includes(kind) && cfg.method !== 'template' ? takeDrafts(kind, wins[0].targetDate, key) : { drafts: null, info: null, job: null };
            if (EDITION_KINDS.includes(kind) && cfg.method !== 'template' && !sess.info && st.sessionSeenAt) sess.info = { status: 'none' };
            for (const [wi, win] of wins.entries()) {
                stepProgress(progress, 'gather', { window: wi });
                // 소해구 예보(§11.10.19): 저장 판을 찾기 함수로 넘겨 모으고, 저장 판이 대해구 판보다 옛것이면 필요한 대해구만 한 번 받아 다시 붙인다
                const zb = smallZone ? zoneBaseOf(risk) : null, szFind = smallFinder(smallZone, zb);
                const inputs = I.gather({ stations: targets, risk, marine, win, now: clock(), locations, hazards: hz, spotsBySt, tideDeps, warnHistory, regional: rg, smallZone: szFind, traffic });
                if (smallZone) szInfo = await prepareSmallZone(inputs, win, zb, szFind, szTried);
                const briefings = inputs.map((x) => R.buildBriefing(x, win, { generatedAt: R.isoKst(now) }));
                // 읽은 날짜 파일은 캐시(pick 이 그대로 쓰는 객체)라 복사해 고친다 — 쓰기가 실패해도 사용자에게 저장 안 된 판이 보이거나 대기 판이 메모리에서 사라지지 않게(§11.10.5 독립 검토 4).
                const day = structuredClone(readDay(win.targetDate) || { date: win.targetDate, stations: {} });
                day.stations = day.stations || {}; day.pending = day.pending || {};
                // 재사용 바탕 = 관할마다 가장 나중에 만든 판(공개 대기 포함)
                const latest = Object.fromEntries([...new Set(Object.keys(day.stations).concat(Object.keys(day.pending)))].map((k) => { const a = day.stations[k], b = day.pending[k]; return [k, !a ? b : !b ? a : Date.parse(b.generatedAt) > Date.parse(a.generatedAt) ? b : a]; }));
                stepProgress(progress, 'ai', { window: wi, method: cfg.method });
                const gen = await AI.generate({ briefings, config: cfg, previous: latest, drafts: sess.drafts, adapters: ad || (aiOn ? (ad = realAdapters()) : {}), kma: kma(), now, timer: elapsed, deadline, onProgress: (ev) => onAiProgress(progress, ev), ...aiOptions });
                for (const x of gen.skipped || []) skippedAll.set(x.id, x);
                if (sess.job && sess.info.status === 'used') { sess.info.used = gen.stats.session || 0; sess.info.changed = gen.stats.sessionChanged || 0; }
                stepProgress(progress, 'save', { window: wi });
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
                results.push({ date: win.targetDate, stations: briefings.length, stats: gen.stats, errors: gen.errors.length, publishAt, spotFail: spotFailOf(inputs) });   // §11.10.21 관광지 자료 확인 불가(이름 목록은 lastRun·lastEdition 에만)
                rule.push(briefings.filter((b) => b.overview && b.overview.source === 'template').map((b) => b.station.name));   // 관리자 푸시 글(§11.10.8)용 — 상태 파일에는 넣지 않는다
            }
            prune(now);
            st.lastRun = { at: R.isoKst(now), kind, zones, method: cfg.method, publishAt, results, ms: elapsed() - t0, ...(sess.info ? { session: sess.info } : {}), ...(cfg.chain ? { chain: cfg.chain.map((c) => c.id), skipped: [...skippedAll.values()] } : {}), ...(szInfo ? { smallZone: szInfo } : {}), ...(aiOn ? {} : { aiDisabled: '개발 환경 — 실제 AI 호출 안 함(STATION_BRIEFING_DEV_AI=1 이면 부름)' }) };
            if (EDITION_KINDS.includes(kind)) st.lastEdition = st.lastRun;   // §11.10.21 마지막 정시 판(관광지 확인 불가 이름 목록)
            // §11.10.7 실행마다 오류 드롭다운 · §11.10.21 정시 판 소요 표 — 실행 기록에는 관광지 확인 불가 수만(이름 목록 없이 — state.json 크기)
            st.runs = keepRuns(st.runs.concat({ at: st.lastRun.at, kind, method: cfg.method, ms: st.lastRun.ms, publishAt, results: results.map((x) => ({ ...x, spotFail: { stations: x.spotFail.stations, spots: x.spotFail.spots } })) }), now);
            // 세션 답은 날짜 파일까지 저장한 뒤에 used(독립 검토 중1) · 실행 시작 때 읽은 st 가 그 사이 새로 찍힌 sessionSeenAt(일감 발급)을 지우지 않게(하7)
            if (sess.job && sess.info.status === 'used') { const jj = readJob(); if (jj && jj.job_id === sess.job.job_id) { jj.status = 'used'; jj.usedAt = R.isoKst(clock()); jj.use = { at: R.isoKst(now), used: sess.info.used, changed: sess.info.changed }; saveJob(jj); logJob(jj, 'used'); } }
            st.sessionSeenAt = state().sessionSeenAt || st.sessionSeenAt;
            saveState(st); recordHistory();
            return { ok: true, results, ms: elapsed() - t0, seq: ++runSeq, method: cfg.method, rule, session: sess.info };
        })();
        try { return await running; } finally { running = null; progress = null; }
    }
    /** 실행 실패를 상태에 남긴다(횟수·마지막 시각·이유) — 백오프 판단용. @param {string} key - 판 열쇠 또는 'warning' @param {Error} e @param {number} now @returns {number} 이번이 몇 번째 실패인가(관리자 푸시 글 — §11.10.8) [연계] ← tick */
    function reportFailure(key, e, now) {
        const s = state(), f = s.failures[key] || { count: 0 }, why = String((e && e.message) || e).slice(0, 160);
        s.failures = Object.fromEntries(Object.entries({ ...s.failures, [key]: { count: f.count + 1, lastAt: R.isoKst(now), reason: why } }).slice(-12));
        addErrors(s, [{ at: R.isoKst(now), stage: 'run', provider: null, stations: [], reason: key + ' 실행 실패(' + (f.count + 1) + '번째): ' + why }], now);
        saveState(s); recordHistory(); console.error('[station_briefing] 실행 실패 ' + key + ' (' + (f.count + 1) + '/' + MAX_RUN_FAILS + '): ' + why);
        return f.count + 1;
    }
    /**
     * 관리자 푸시 한 통을 보낸다 — 기다리지 않고(tick 은 곧바로 다음 일 — FCM 이 늦거나 멈춰도 같은 점검의 특보 변경 실행이 밀리지 않게) 절대 던지지 않는다.
     * 전달이 안 되면(개발 환경·기기 없음·발송 오류·예외) 콘솔 한 줄 — 다시 보내지 않는다(결과는 관리자 「AI 브리핑」 탭에 그대로 있다).
     * 예: notifyAdmin({title:'연안 안전 브리핑 07:30 판 결과', body:'97곳 — …'}, {kind:'station_briefing', run:'morning', phase:'result'})
     * @param {{title:string, body:string}} msg @param {object} data - 문자열 값만 @returns {void} [연계] ← pushResult·tick(실패) / → adminPush(기본 defaultAdminPush)
     */
    function notifyAdmin(msg, data) {
        let p;
        try { p = Promise.resolve(adminPush(msg.title, msg.body, data)); } catch (e) { p = Promise.reject(e); }
        p.then((r) => { if (!r || !r.delivered) console.warn('[station_briefing] 관리자 푸시 미전달 — ' + msg.title + ': ' + ((r && r.error) || '전달 안 됨')); },
            (e) => console.error('[station_briefing] 관리자 푸시 발송 예외 — ' + msg.title + ':', e && e.message));
    }
    /**
     * 정시 판 하나가 끝났을 때 결과 푸시 1통(특보 변경 판은 부르지 않음 — §11.10.60)(§11.10.8 — 오류가 없어도). 같은 실행 결과(seq)를 두 번 받으면 두 번째는 보내지 않는다.
     * 예: pushResult('morning', {ok:true, seq:3, method:'chatgpt', results:[…], rule:[['고현파출소']]}) → '연안 안전 브리핑 07:30 판 결과' 1통 · 같은 것을 다시 → 없음(false)
     * @param {string} kind - morning|evening|night|warning @param {object} r - run 반환값 @param {string|null} [key] - 판 열쇠(정시 '날짜|판' · 특보 변경 'warning|마지막 변경 시각') — 같은 열쇠는 두 번 보내지 않음 @returns {boolean} 보냈으면 true [연계] ← tick / → runPushText·notifyAdmin
     */
    function pushResult(kind, r, key = null) {
        if (!r || !r.ok || !(r.seq > pushedSeq)) return false;
        // 같은 판(key)을 다시 만들어도 1통(§11.10.8 독립 검토 — done·warnSig 기록이 던지면 다음 점검이 같은 판을 다시 만들고 seq 는 새로 오른다 → 매분 같은 결과 푸시). 종류마다 마지막 열쇠 하나만.
        if (key && pushedKey[kind] === key) return false;
        pushedSeq = r.seq; if (key) pushedKey[kind] = key;
        notifyAdmin(runPushText({ kind, method: r.method, session: r.session, results: (r.results || []).map((x, i) => ({ ...x, rule: (r.rule || [])[i] || [] })) }), { kind: 'station_briefing', run: kind, phase: 'result' });
        return true;
    }
    /** 백오프 중인가 — 실패 뒤 10분 안이거나 같은 판을 3번 실패했으면 true. 예: ({count:1,lastAt:10:00}, 10:05) → true · 10:10 → false. @param {object} f - failures[key] @param {number} now @returns {boolean} [연계] ← tick */
    function inBackoff(f, now) { return !!f && (f.count >= MAX_RUN_FAILS || now - Date.parse(f.lastAt) < RUN_BACKOFF_MS); }
    /**
     * 1분 점검: ①지금 만들 정시 판(R.dueEdition)이 있으면 만든다 ②특보 크롤러 결과가 바뀌었으면 구역 서명을 비교해, 바뀐 구역에 걸친 관할만 다시 만든다.
     * 처음 보는 서명(재시작 직후 상태 파일에 서명이 없음)은 기록만 하고 다시 만들지 않는다. 실행 중이면 이번 점검을 건너뛴다.
     * 특보 변경은 마지막 변경 뒤 WARN_DEBOUNCE_MS(3분) 조용할 때 한 번 — 그 사이 바뀐 구역은 합친다(마지막으로 만든 서명과 비교하므로 누적, C9).
     * 서명이 같은 채 파일 시각만 바뀌면 대기를 늘리지 않고, 계속 바뀌어도 첫 변경 뒤 WARN_MAX_WAIT_MS(15분)면 만든다.
     * 실행이 던지면 실패 시각·횟수를 남기고 10분 기다린다, 같은 판(특보 변경은 'warning')은 3번까지 — 매분 AI 를 다시 부르지 않는다(B9·ops1). 3번 실패한 특보 변경은 그 서명을 받아들이고 멈춘다.
     * 관리자 푸시(§11.10.8·§11.10.60): 정시 판 실행이 끝나면 결과 1통(pushResult), 던지면 실패를 기록한 뒤 「분석 실패」 1통. 특보 변경 판은 결과·실패 모두 보내지 않는다(기록만). 실행 중이라 건너뛴 점검·백오프·디바운스 대기·
     * 걸리는 관할이 없는 특보 변경·3번 실패 뒤 포기는 실행이 아니라 보내지 않는다. 푸시는 기다리지 않는다(notifyAdmin).
     * 예: await tick() → {edition:'2026-10-17|morning'} · {warning:['…|한림파출소'], zones:['제주도서부앞바다']} · {pending:[…]}(디바운스 대기) · {backoff:'2026-10-17|morning'} · {}
     * @returns {Promise<object>} [연계] ← start(1분) · 시험(가짜 시계)
     */
    async function tick() {
        if (running) return { busy: true };
        // 서버가 켜진 뒤 첫 점검 — 머지로 들어온 처리 완료 목록 적용(§11.10.48). 실패해도 브리핑 점검은 계속한다.
        if (!repoApplied) { repoApplied = true; try { applyResolved(loadLog(state(), true)); } catch (e) { console.error('[station_briefing] 처리 완료 목록 적용 실패:', e && e.message); } }
        const now = clock(), out = {};
        const st = state(), due = R.dueEdition(now, st.done);
        // §11.10.56: 이 판 세션 일감을 받아 놓고 답이 아직이면 만들기 시작을 waitUntil(시작 + 10분)까지 미룬다 — 공개 시각까지 AI 데드라인 20분은 그대로 남는다.
        //   일감을 만드는 중이어도 기다린다(하7). 규칙 분석만(template)이면 기다리지 않는다(하5).
        const sj = due ? readJob() : null, useSession = due && readConfig().method !== 'template';
        if (useSession && ((jobBuilding && jobBuildingKey === due.key) || (sj && sj.key === due.key && sj.status === 'open' && now < Date.parse(sj.waitUntil)))) out.sessionWait = due.key;
        else if (due) {
            if (inBackoff(st.failures[due.key], now)) out.backoff = due.key;
            else {
                let r = null;
                try { r = await run({ kind: due.kind, key: due.key }); } catch (e) { const n = reportFailure(due.key, e, now); out.failed = due.key; notifyAdmin(failPushText({ kind: due.kind, error: e, count: n }), { kind: 'station_briefing', run: due.kind, phase: 'fail' }); }
                pushResult(due.kind, r, due.key);   // 판을 다 만든 때(공개 시각 07:30·17:30·23:00 전) — done 기록보다 먼저: 기록이 실패해도 실제로 끝난 실행은 알린다
                if (r && r.ok) { const s2 = state(); s2.done = s2.done.concat(due.key).slice(-12); delete s2.failures[due.key]; saveState(s2); out.edition = due.key; }
            }
        }
        // 세션 답을 기다리는 동안은 특보 변경 실행도 미룬다 — 그 사이 특보 변경이 20분 돌면 정시 판이 밀려 AI 시간이 줄고 세션 답이 버려진다(독립 검토 중3).
        //   정시 판이 지금 자료(바뀐 특보 포함)로 모든 관할을 만들고, 남은 특보 변경 대기는 그 뒤 점검이 처리한다.
        if (out.sessionWait) return out;
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
            // §11.10.60(2026-11-20 사용자 「정기판만 보내줄 수 있도록」): 특보 변경 판은 결과·실패 모두 관리자 푸시를 보내지 않는다 — 실패는 상태(백오프)·누적 오류 기록·관리자 「AI 브리핑」 탭에 그대로 남는다.
            try { r = await run({ kind: 'warning', keys: hit, zones: pw.zones }); } catch (e) { reportFailure('warning', e, now); out.failed = (out.failed ? out.failed + ',' : '') + 'warning'; return out; }
            if (!r.ok) return out;   // 실행 중(busy)이라 건너뜀 — 결과가 아니다(푸시 없음), 대기가 남아 다음 점검에 다시
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
     * 관리자 상태(설정·마지막 실행·최근 3일 오류 전부(최근 것부터 — 2026-10-17 결정)·보관 규칙·상한으로 지운 기록·있는 날짜·실행 중·실행 실패 백오프·특보 변경 대기
     * · 누적 오류 요약 errorLog(처리 안 된 오류 — 유형별 수·최근 내보내기·처리 완료 목록 알림, §11.10.48)). 최근 3일 오류 중 모든 유형이 처리 완료된 것은 resolved:true.
     * @returns {object} [연계] ← routes GET status·POST run(실행 중이면 409) · admin_station_briefing.js(오류 목록·복사·md 저장·누적 칸)
     */
    function status() {
        // 누적 기록을 못 읽거나 못 써도 상태 응답(설정·즉시 실행·실행별 오류)은 준다 — 누적 칸만 「읽지 못함」(독립 검토 ③ — 종전엔 AI 브리핑 탭 전체·설정·즉시 실행이 함께 500)
        const s = state(); let lg = null, logError = null; try { lg = applyResolved(loadLog(s, true)); } catch (e) { logError = String((e && e.code) || (e && e.message) || e).slice(0, 120); console.error('[station_briefing] 누적 오류 기록 읽기 실패:', logError); }
        const closed = new Set(lg ? lg.errors.filter((e) => !EL.isOpen(e)).map((e) => e.id) : []); let days = []; try { days = fs.readdirSync(dir).map((f) => (f.match(/^briefings_(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort(); } catch (_) { /* 폴더 없음 */ }
        // 공개 대기(§11.10.4) — 날짜 파일마다 아직 공개 시각이 안 된 판 수·공개 시각(관리자 상태 「공개 예정」)
        const now = clock(), pending = [];
        for (const d of days) { const dd = readDay(d), at = {}; for (const b of Object.values((dd && dd.pending) || {})) if (Date.parse(b.publishAt) > now) at[b.publishAt] = (at[b.publishAt] || 0) + 1; for (const [pa, n] of Object.entries(at)) pending.push({ date: d, publishAt: pa, stations: n }); }
        // lastEdition = 마지막 정시 판 실행(관광지 확인 불가 이름 목록 — §11.10.21) · runDeadlineMs = 한 실행 AI 마감(정시 판 소요 표의 「마감」 설명)
        return { config: readConfig(), choices: CHOICES, lastRun: s.lastRun, lastEdition: s.lastEdition, runDeadlineMs, runs: keepRuns(s.runs, now).reverse(), progress: running ? progress : null, done: s.done, pending, errors: keepErrors(s.errors, clock()).errors.reverse().map((e) => (e.id && closed.has(e.id) ? { ...e, resolved: true } : e)), errorKeep: { days: ERROR_KEEP_DAYS, cap: ERROR_HARD_CAP }, errorLog: lg ? { ...EL.summary(lg, now, repoIssues), recovered: lg.recovered && now - Date.parse(lg.recovered.at) < 7 * 86400000 ? lg.recovered : null, writeIssue: logIssue } : { unavailable: logError, writeIssue: logIssue }, errorsCapped: freshCapped(s.errorsCapped, clock()), days, running: !!running, failures: s.failures, pendingWarn: s.pendingWarn ? { zones: s.pendingWarn.zones, lastChangeAt: s.pendingWarn.lastChangeAt } : null };
    }
    /**
     * 누적 md 내보내기(§11.10.48) — 처리 안 된 오류 전부와 유형 번호(G01…)를 돌려주고, 그 내보내기를 기록에 남긴다(나중에 머지·버튼으로 「이 md 에 들어 있던 것」만 처리 완료하려고).
     * 처리 안 된 오류가 없으면 null.
     * 예: exportErrors() → {export:{id:'E20261115-221034', at, groups:[{code:'G01', family, ids, count, stations, top, values, sample, first, last}]}, errors:[오래된 것부터 — text·allowed 포함]}
     * @returns {object|null} [연계] ← routes POST /error-log/export → 관리자 화면 cumulativeMarkdown
     */
    function exportErrors() {
        const lg = applyResolved(loadLog(state(), true)), r = EL.exportOpen(lg, clock());
        if (!r) return null;
        saveLog(lg);
        return { export: { id: r.exp.id, at: r.exp.at, groups: r.exp.groups.map((g, i) => ({ ...r.stats[i], code: g.code })) }, errors: r.errors };
    }
    /**
     * 관리자 버튼으로 내보내기 하나의 유형을 처리 완료(§11.10.48 — 머지 자동 처리와 별개, 사용자 「둘 다 둠」). codes 를 안 주면 그 내보내기의 남은 유형 전부.
     * 예: resolveExport('E20261115-221034') → {ok:true, resolved:['G02','G03'], already:['G01'], unknown:[]} · 없는 번호 → {ok:false, reason:'not-found'}
     * @param {string} id @param {string[]|null} codes @param {string} note @returns {object} [연계] ← routes POST /error-log/exports/:id/resolve → EL.resolve
     */
    function resolveExport(id, codes, note, by = 'manual') {
        // by: 'manual'(관리자 버튼) · 'auto'(자동 처리 세션 판정 — AI 가 실제로 어김·코드 밖, §11.10.62) · 'decision'(사장님 결정 「아니다(막기)」, §11.10.62)
        const lg = loadLog(state(), true), r = EL.resolve(lg, String(id || ''), Array.isArray(codes) ? codes : null, ['manual', 'auto', 'decision'].includes(by) ? by : 'manual', note, clock());
        if (r.resolved.length) saveLog(lg);
        return r;
    }
    /** 관할 목록(화면 설정용 — 폴리곤 없이). @returns {object[]} [연계] ← routes GET stations */
    function stationList() { const loc = I.readJson(p('locations.json'))?.stations || {}; return stations().map((s) => ({ key: s.key, name: s.name, office: s.office, region: s.region, seaOnly: s.seaOnly, location: loc[s.key]?.status === 'ok' ? { lat: loc[s.key].lat, lon: loc[s.key].lon, estimated: false } : { estimated: true } })); }
    /**
     * 관할 구역(설정 화면 「지도에서 선택하기」 — 2026-10-17) — 열쇠·해역들·폴리곤(소수 넷째 자리). 관할 목록·특보구역 도형은 바뀌지 않으므로 처음 한 번 만들어 둔다.
     * 예: stationAreas() → [{key:'제주해양경찰서|한림파출소', seas:['제주'], geometry:{…}}, …] @returns {object[]} [연계] ← routes GET areas / → I.stationAreas
     */
    function stationAreas() { return areasCache || (areasCache = I.stationAreas(stations())); }
    /**
     * 진행만(관리자 게이지가 2.5초마다 부른다 — status() 는 최근 3일 오류 전부를 실어 무겁다). 실행 중이 아니면 progress null.
     * 예: progressNow() → {running:true, progress:{at,kind,unit,phase:'ai',done:40,total:99,current:'통영해양경찰서 · 고현파출소 외 2곳 — ChatGPT 2번째 시도',batches:[…]}}
     * @returns {object} [연계] ← routes GET status?only=progress
     */
    function progressNow() { return { running: !!running, progress: running ? progress : null }; }
    return { trialJob, trialResult, trialLog, trialCompare, sessionJob, sessionResult, jobLog, _readJob: readJob, run, tick, start, stop() { if (timer) clearInterval(timer); timer = null; }, _pushResult: pushResult, pick, readConfig, writeConfig, status, exportErrors, resolveExport, _log: () => loadLog(state(), true), progressNow, stationList, stationAreas, stations, _state: state, _readDay: readDay, _fileCacheSize: () => fileCache.size };
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
    def = createService({ risk: stores.risk, marine: stores.marine, geocoder: process.env.FLY_ALLOC_ID ? (a) => I.geocodeStation(a) : null, warnHistory: require('./sea_warning_history').forDir(), errorHistory: require('./risk_error_history'), smallZone: require('./smallzone_forecast'), traffic: require('./sea_traffic_profile').forDir(),
        // 머지된 처리 완료 목록은 운영 서버(seagnal-server)에서만 읽는다(독립 검토 ⑩ — 내보내기 번호는 서버마다 따로라 스테이징·개발에서는 모든 줄이 「이 서버에 없는 번호」 알림이 된다)
        resolvedFile: process.env.FLY_APP_NAME === 'seagnal-server' ? path.join(__dirname, '..', 'config', 'station_briefing_resolved.json') : null,
        // AI 순서 — 관리자 「AI 모델 설정 → ④ 연안 안전 브리핑」(§11.10.51)
        aiChain: () => require('./bulletin_ai').briefingChain() });
    return def;
}

module.exports = { createService, forDefault, visibleOf, settle, decideExposure, normConfig, warnSignatures, changedZones, realAdapters, historyRow, keepErrors, trimRejected, REJECTED_KEEP, freshCapped, keepRuns, spotFailOf, newProgress, stepProgress, onAiProgress, editionName, shortNames, runPushText, sessionLine, failPushText, defaultAdminPush, RUN_LOG_CAP, ERROR_KEEP_DAYS, ERROR_HARD_CAP, HISTORY_SOURCE, HISTORY_STALE_MS, HISTORY_PARTIAL_CODE, CHOICES, DEFAULT_CONFIG, RUN_BACKOFF_MS, MAX_RUN_FAILS, WARN_DEBOUNCE_MS, WARN_MAX_WAIT_MS, RUN_DEADLINE_MS, GEMINI_CALL_MS, SMALLZONE_WAIT_MS, zoneBaseOf, smallFinder, start: () => forDefault().start() };
