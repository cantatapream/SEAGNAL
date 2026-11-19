'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_watch.js
 * 역할  : 방재기상플랫폼(dmdw) 특보·예비특보 통보문을 1분마다 지켜보며 「처음 보인 모습」과 「나중에 바뀐 모습」을
 *         그대로 기록한다(관찰용 — 특보현황·푸시는 건드리지 않는다).
 *         목록은 3일 전부터 받는다(이미 발표·발효된 특보부터 따라가려고 — 사용자 확정 2026-11-15).
 *         3일 넘게 끊겼다 돌아오면 마지막으로 다 받은 날의 하루 전부터(최대 10일) 받아 빠진 통보문을 채운다(CATCH_UP_MAX_DAYS — 2026-11-19).
 *         특히 내용 없이 먼저 올라온 통보문은 채워질 때까지 매분 다시 확인한다
 *         (사용자 확정 2026-11-15: 「빈 통보문으로 올라왔을때에는 해당 통보문을 계속 확인하는 로직이 필요… 내용이 채워질때까지」).
 * 왜: 지난 통보문(2025-01~2026-11, 5,768건)은 사이트가 채워진 최종본만 보여 줘 빈 상태가 남지 않는다
 *     (analysis/bulletin_survey/README.md). 통보문 기반 특보현황을 만들기 전에 실제 모습을 봐야 한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(https 직접) — 요청 방식은 analysis/bulletin_survey/collect.js 와 같다
 *  - 서버 API      : dmdw POST /rsw/rest/mfp/wrn/retRswWrnRptList.json · retRswWrnRptDetail.json (로그인 필요)
 *  - 저장          : data/bulletin_watch/<KST 날짜>.jsonl(기록, 30일) · data/bulletin_watch/state.json(본 통보문)
 *  - 나를 쓰는 곳  : scheduler.js(매 1분 run) · routes/bulletin_watch.js(관리자 내려받기) · services/bulletin_status.js(bulletins — 통보문 기준 특보현황 · listsOkMs) ·
 *                   routes/weather.js(bulletins — 📋 해역별 통보문 팝업의 본문 글) · 검사 test_bulletin_watch
 *  - 알림          : 로그인이 안 되면 관리자 푸시 — services/collect_fail_alert('bulletins', 실패 시작 1통·복구 1통). 수집현황 목록표 config/data_collection_manifest.json 의 bulletins
 *  - 환경변수      : KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD(없으면 꺼짐) · BULLETIN_WATCH_DISABLE=1(강제 끔)
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OFFICES = { '109': '수도권청', '159': '부산청', '143': '대구청', '156': '광주청', '146': '전주지청', '133': '대전청', '105': '강원청', '184': '제주청' };
const DIR = path.join(__dirname, '..', 'data', 'bulletin_watch');
const KEEP_DAYS = 30;
// 목록은 3일 전부터 받는다 — 이미 발표·발효된 특보부터 따라가려고(사용자 확정 2026-11-15 「통보문은 3일 전꺼부터 수집해서 관찰하도록 해 이미 발효/발표된 특보들이 있거든」)
const LOOKBACK_DAYS = 3;
// 본 통보문은 처음 본 뒤 10일까지 들고 있다(목록에서 빠진 뒤에도) — 통보문 기준 특보현황(bulletin_status)은 들고 있는 통보문만으로 계산하므로,
//   어느 관서에서 특보 통보문이 이 기간 넘게 한 건도 안 나오면 그 관서의 발효 중 특보가 계산에서 빠진다.
//   사용자 결정 2026-11-18 「10일로 하자」(종전 5일). 실자료(2025-01~2026-11) 최장 공백 3.84일(강원 2026 1-93 → 1-97호) — 5일이면 여유 1.2일뿐이었다.
//   늘린 값의 비용(실자료 664일 재 봄): 들고 있는 통보문 평균 42 → 84건(최대 224), 계산 평균 0.7 → 0.9ms, 본문 평균 36 → 72KB.
const SEEN_KEEP_DAYS = 10;
// [끊긴 동안 보충] 로그인 장애 등으로 목록을 한동안 못 받았으면, 다시 될 때 「마지막으로 목록을 다 받은 날의 하루 전」부터 받는다(최대 CATCH_UP_MAX_DAYS).
//   사용자 2026-11-18: 로그인이 안 된 동안 빠진 통보문을 다시 되면 모두 받아 생애주기가 저절로 맞게.
//   없으면: 3일 넘게 끊겼다 돌아오면 그 사이(3일 전보다 앞)에 나온 발표·변경·해제 통보문을 영영 못 본다 — 통보문 기준 특보현황·📋 발자취에서 그 특보가 빠지거나 해제가 안 된 채 남는다.
//   10일 = 통보문을 기억하는 기간(SEEN_KEEP_DAYS)과 같다 — 그보다 앞의 것은 받아도 곧 지운다. 목록 API 가 10일 범위를 받는 것은 2026-11-18 실제 호출로 확인.
const CATCH_UP_MAX_DAYS = 10;
// 보충은 시작한 지 하루가 지나면 다 못 받았어도 그만둔다(빈 통보문을 그만 보는 EMPTY_GIVE_UP_MIN 과 같은 하루).
//   없으면: 목록 16개 가운데 하나나 본문 하나가 계속 안 받아지는 동안 매분 10일 치 범위를 끝없이 묻는다(검토에서 12일을 돌려 확인 — 평소의 3배쯤 되는 응답을 계속 받는다).
const CATCH_UP_GIVE_UP_MS = 24 * 3600e3;
const RECHECK_MIN = [3, 10];            // 내용이 있는 통보문은 내용을 처음 본 뒤 3분·10분에 한 번씩 다시 본다(채운 뒤 고치는지)
const EMPTY_GIVE_UP_MIN = 24 * 60;      // 하루가 지나도 비어 있으면 그만 보고 기록만 남긴다
const KST = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace('Z', '+09:00');   // 한국 시각(끝에 +09:00)
const dayOf = (ms) => KST(ms).slice(0, 10);
const hmOf = (ms) => KST(ms).slice(11, 16);

/**
 * 통보문 본문이 「비었나」— 특보는 제목·해당구역·발효 중 칸, 예비는 목록·유효시각 칸 중 하나라도 비면 빈 것으로 본다.
 * 예: isEmpty('6', { t1: '풍랑주의보 발표', t2: '', t6: 'o 없음' }) → true
 * @param {string} rpt '6' 특보 / '7' 예비특보  @param {object|null} r 본문(result)
 * @returns {boolean}
 * [연계] ← observe(이 파일) — 빈 통보문은 채워질 때까지 매분 다시 받는다
 */
function isEmpty(rpt, r) {
    if (!r) return true;
    const blank = (v) => !String(v == null ? '' : v).replace(/<br\s*\/?>/gi, '').trim();
    return rpt === '7' ? (blank(r.t4) || blank(r.t5)) : (blank(r.t1) || blank(r.t2) || blank(r.t6));
}
/** 통보문 번호(code)에 든 발표시각 → ms. 예: '7|105|16|202501270400|4|20250127040815' → 2025-01-27 04:00 KST. 못 읽으면 NaN. */
const codeFcMs = (code) => { const m = String(code).split('|')[3] || ''; return /^\d{12}$/.test(m) ? Date.parse(`${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}T${m.slice(8, 10)}:${m.slice(10, 12)}:00+09:00`) : NaN; };
const hashOf = (r) => crypto.createHash('sha256').update(JSON.stringify(r || null)).digest('hex').slice(0, 16);

/**
 * 관찰기를 만든다. 검사에서는 dmdw 요청(post·login)과 시계(now)·저장 위치(dir)를 바꿔 끼운다.
 * 예: const w = createWatch({ post, login, now: () => Date.now(), dir }); await w.run();
 * @param {{post: function(string, object): Promise<any>, login: function(): Promise<void>, now?: function(): number, dir?: string, sleep?: function(number): Promise<void>, gapMs?: number}} o
 * @returns {{run: function(): Promise<object>, readDay: function(string): Array, days: function(): string[]}}
 * [연계] ← module.exports.run(실제 dmdw 연결) · test_bulletin_watch
 */
function createWatch({ post, login, now = () => Date.now(), dir = DIR, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 700, onLogin = () => {} }) {
    const stateFile = path.join(dir, 'state.json');
    let state = null, loggedIn = false, loginBlockedUntil = 0, running = false;
    const load = () => { if (state) return; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { state = { seen: {} }; } };
    const save = () => { fs.mkdirSync(dir, { recursive: true }); const tmp = stateFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, stateFile); };
    const log = (ev) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, dayOf(ev.atMs) + '.jsonl'), JSON.stringify(Object.assign({ at: KST(ev.atMs) }, ev)) + '\n'); };

    /** 세션이 끊겼으면 다시 로그인. 거부되면 30분 쉰다(같은 계정을 쓰는 다른 수집이 잠기지 않게 — 2026-11-15 비밀번호 만료 statecode=11 사례). */
    async function call(p, form) {
        for (let i = 0; i < 2; i++) {
            if (!loggedIn) {
                if (now() < loginBlockedUntil) throw new Error('로그인 쉬는 중');
                // 로그인을 시도할 때마다 결과를 알린다(onLogin) — 안 되면 관리자 푸시(사용자 2026-11-18 「방재기상플랫폼 로그인이 갑자기 안되면 관리자에게 푸시」).
                //   쉬는 30분 동안은 시도하지 않으므로 알리지도 않는다(실패 상태는 알림 쪽이 들고 있다). 알림이 던져도 수집은 그대로 간다.
                try { await login(); loggedIn = true; try { onLogin({ ok: true }); } catch (_) { /* 알림 실패가 수집을 막지 않게 */ } }
                catch (e) { loginBlockedUntil = now() + 30 * 60e3; try { onLogin({ ok: false, error: e }); } catch (_) { /* 위와 같음 */ } throw e; }
            }
            try { return await post(p, form); }
            catch (e) { if (e && e.sessionLost) { loggedIn = false; continue; } throw e; }
        }
        throw new Error('세션을 다시 열지 못함');
    }

    async function detail(stn, code) {
        await sleep(gapMs);
        const b = await call('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { stnId: stn, rpt: code });
        return b && b.result ? b.result : null;
    }

    /**
     * 한 번 돈다: 관서 8곳 × (특보 전체 종류 · 예비특보) 목록 → 새 통보문·빈 통보문·다시 볼 때가 된 통보문의 본문.
     * 종류를 거르지 않는다 — 빈 통보문은 종류(풍랑) 칸도 비어 있을 수 있어 「풍랑」으로 거르면 놓친다(2026-11-15 시험: 거르지 않으면 모든 종류가 온다).
     * @returns {Promise<{lists:number, details:number, events:number}>}
     */
    async function run() {
        if (running) return { skipped: true };
        running = true;
        const stat = { lists: 0, details: 0, events: 0 };
        const emit = (ev) => { log(ev); stat.events++; };
        try {
            load();
            const baseline = !state.started;   // 맨 처음 한 번: 이미 올라와 있던 통보문은 「관찰 시작 때 이미 있던 것」으로 남긴다
            const t = now();
            // 보충 중인가: 마지막으로 목록을 다 받은 때가 평소 기간(3일 전 0시)보다 앞이면 그 하루 전부터 받는다. 한 번 넓히면 그 범위의 목록·새 본문을 빠짐없이 받은 회차까지 유지한다(state.catchUpFromMs)
            //   — 넓힌 첫 회차에 본문 하나를 못 받았는데 다음 분에 기간이 3일로 돌아가면 그 통보문은 목록에 다시 안 나와 영영 빈 채로 남는다.
            const normalStartMs = Date.parse(dayOf(t - LOOKBACK_DAYS * 86400e3) + 'T00:00:00+09:00');
            //   그만둔 뒤 하루는 다시 시작하지 않는다(catchUpPausedUntilMs) — 목록이 계속 안 받아지는 동안에는 listsOkMs 가 옛 값 그대로라, 쉬지 않으면 그만둔 다음 분에 곧바로 다시 시작한다.
            if (state.started && state.listsOkMs && state.listsOkMs < normalStartMs && !state.catchUpFromMs && !(t < (state.catchUpPausedUntilMs || 0))) {
                state.catchUpFromMs = state.listsOkMs - 86400e3;
                state.catchUpStartedMs = t;
                emit({ atMs: t, kind: 'catch_up', fromDay: dayOf(Math.max(state.catchUpFromMs, t - CATCH_UP_MAX_DAYS * 86400e3)), lastOk: KST(state.listsOkMs), 설명: `목록을 마지막으로 다 받은 때(${KST(state.listsOkMs).slice(0, 16).replace('T', ' ')})가 3일보다 앞 — 그 하루 전부터(최대 ${CATCH_UP_MAX_DAYS}일) 다시 받아 빠진 통보문을 채운다` });
            }
            const catchUp = !!state.catchUpFromMs;
            let missed = 0;   // 이번 회차에 못 받은 본문 수 — 새 통보문·빈 통보문 다시 보기 모두(보충을 끝내도 되는지 볼 때. 첫 회차에 못 받은 본문은 다음 분엔 「다시 보기」 길로 온다)
            const fromMs = catchUp ? Math.min(t - LOOKBACK_DAYS * 86400e3, Math.max(state.catchUpFromMs, t - CATCH_UP_MAX_DAYS * 86400e3)) : t - LOOKBACK_DAYS * 86400e3;
            const ed = dayOf(t).replace(/-/g, ''), sdDay = dayOf(fromMs), sd = sdDay.replace(/-/g, '');
            const windowStartMs = Date.parse(sdDay + 'T00:00:00+09:00');
            const listed = new Set();
            for (const stn of Object.keys(OFFICES)) {
                for (const rpt of ['6', '7']) {
                    await sleep(gapMs);
                    let list;
                    try { list = await call('/rsw/rest/mfp/wrn/retRswWrnRptList.json', Object.assign({ startDate: sd, endDate: ed, stnId: stn, rpt }, rpt === '6' ? { wrnKindNm: '' } : {})); }
                    catch (e) { console.warn('[bulletin_watch] 목록 실패', stn, rpt, e && e.message); emit({ atMs: now(), kind: 'error', stn, rpt, message: String(e.message || e).slice(0, 200), 설명: `${OFFICES[stn]} ${rpt === '7' ? '예비특보' : '특보'} 목록을 못 받음` }); continue; }
                    stat.lists++;
                    for (const e of Array.isArray(list) ? list : []) {
                        listed.add(e.code);
                        const s = state.seen[e.code];
                        const at = now();
                        if (!s) {
                            let r = null; try { r = await detail(stn, e.code); stat.details++; } catch (err) { missed++; console.warn('[bulletin_watch] 새 본문 실패', e.code, err && err.message); emit({ atMs: at, kind: 'error', stn, rpt, code: e.code, message: String(err.message || err).slice(0, 200), 설명: '새 통보문 본문을 못 받음 — 다음 분에 다시' }); }
                            const empty = isEmpty(rpt, r);
                            // 보충으로 받은 통보문은 「처음 본 때」를 회차 시작 시각 하나로 맞춘다 — 10일 뒤 지울 때 한 회차에 함께 지워지게
                            //   (하나씩 받은 시각대로 두면 지워지는 몇 분 동안 묶음에 구멍이 생겨, 끝난 특보가 통보문 기준 현황에 잠깐 되살아날 수 있다 — 검토)
                            state.seen[e.code] = { stn, rpt, firstMs: catchUp ? t : at, fullMs: empty ? null : at, listValue: e.value, hash: hashOf(r), empty, emptySinceMs: empty ? at : null, lastFetchMs: at, rechecked: [], result: r };   // 본문도 둔다 — 통보문 기준 특보현황(bulletin_status)이 읽는다
                            emit({ atMs: at, kind: 'new', baseline: baseline || undefined, catchUp: catchUp || undefined, stn, office: OFFICES[stn], rpt, code: e.code, listValue: e.value, empty, result: r,
                                설명: `${OFFICES[stn]} ${rpt === '7' ? '예비특보' : '특보'} ${baseline ? '관찰 시작 때 이미 있던' : '새'} 통보문 「${String(e.value).trim()}」 ${empty ? '— 내용이 비어 있다(채워질 때까지 매분 다시 본다)' : '— 내용이 있다'}` });
                            continue;
                        }
                        if (s.listValue !== e.value) {
                            emit({ atMs: at, kind: 'list_changed', stn, office: OFFICES[stn], rpt, code: e.code, before: s.listValue, after: e.value, 설명: `${OFFICES[stn]} 목록 글자가 바뀜: 「${String(s.listValue).trim()}」 → 「${String(e.value).trim()}」` });
                            s.listValue = e.value;
                        }
                        // 본문을 안 갖고 있는 옛 기록(2026-11-16 01:05 이전에 본 것 — 그땐 본문을 저장하지 않았다)은 한 번 다시 받아 채운다.
                        //   없으면: 그 전에 본 3일 치 통보문이 통보문 기준 특보현황에서 통째로 빠져 「전 해역 특보없음」으로 보인다(2026-11-16 사용자 지적).
                        if (!('result' in s)) {
                            try { s.result = await detail(stn, e.code); stat.details++; s.backfilled = true; } catch (err) { missed++; console.warn('[bulletin_watch] 옛 기록 본문 채우기 실패', e.code, err && err.message); }
                            continue;
                        }
                        const ageMin = (at - s.firstMs) / 60e3;
                        // 다시 보기 시계는 「내용을 처음 본 때」부터 — 빈 동안은 매분 보고 있으니 쓰지 않는다
                        const due = s.fullMs == null ? undefined : RECHECK_MIN.find((m) => (at - s.fullMs) / 60e3 >= m && !s.rechecked.includes(m));
                        const watchEmpty = s.empty && (at - s.emptySinceMs) / 60e3 < EMPTY_GIVE_UP_MIN;
                        if (!watchEmpty && due == null) continue;
                        if (due != null) s.rechecked.push(due);
                        // 다시 보기 실패는 다음 분에 또 본다(빈 통보문) — 서버 기록에만 남긴다
                        let r; try { r = await detail(stn, e.code); stat.details++; } catch (err) { missed++; console.warn('[bulletin_watch] 다시 보기 실패', e.code, err && err.message); continue; }
                        s.lastFetchMs = at;
                        const h = hashOf(r);
                        if (h === s.hash) continue;
                        const empty = isEmpty(rpt, r), wasEmpty = s.empty;
                        const filled = wasEmpty && !empty;
                        emit({ atMs: at, kind: filled ? 'filled' : 'detail_changed', stn, office: OFFICES[stn], rpt, code: e.code, listValue: e.value, empty,
                            emptyMinutes: filled ? Math.round((at - s.emptySinceMs) / 60e3) : undefined, result: r,
                            설명: filled ? `${OFFICES[stn]} 「${String(e.value).trim()}」 내용이 채워짐 — 처음 빈 채로 본 뒤 ${Math.round((at - s.emptySinceMs) / 60e3)}분`
                                : `${OFFICES[stn]} 「${String(e.value).trim()}」 내용이 바뀜(처음 본 뒤 ${Math.round(ageMin)}분)${empty ? ' — 아직 비어 있음' : ''}` });
                        s.hash = h; s.empty = empty; s.result = r; if (empty && !s.emptySinceMs) s.emptySinceMs = at; if (!empty) s.emptySinceMs = null;
                        if (filled) { s.fullMs = at; s.rechecked = []; }
                    }
                }
            }
            // 목록에서 사라진 통보문(목록 기간 안인데 없어짐) — 채우면서 번호(code)가 바뀌는지 보려는 것
            const t2 = now();
            for (const [code, s] of Object.entries(state.seen)) {
                if (listed.has(code) || s.gone) continue;
                // 목록 기간(3일 전~오늘) 끝자락은 저절로 빠진다 — 발표시각이 기간 시작에서 12시간 넘게 안쪽인 것만 「사라짐」으로 본다
                const fc = codeFcMs(code);
                if (!(fc > windowStartMs + 12 * 3600e3)) continue;
                if (stat.lists < Object.keys(OFFICES).length * 2) continue;   // 목록을 다 못 받은 회차엔 판단하지 않는다
                s.gone = true;
                emit({ atMs: t2, kind: 'gone', stn: s.stn, office: OFFICES[s.stn], rpt: s.rpt, code, listValue: s.listValue, wasEmpty: s.empty,
                    설명: `${OFFICES[s.stn]} 「${String(s.listValue).trim()}」가 목록에서 사라짐${s.empty ? '(빈 채로 있던 것 — 번호가 바뀌어 다시 올라왔는지 확인)' : ''}` });
            }
            // 본 기록 정리: 목록에 더는 없고 처음 본 지 SEEN_KEEP_DAYS(10일) 넘은 것만(목록 기간이 날짜 단위라 최대 4일 가까이 남는다 — 그 안에 지우면 「새 통보문」으로 다시 잡힌다)
            for (const [code, s] of Object.entries(state.seen)) if (!listed.has(code) && t2 - s.firstMs > SEEN_KEEP_DAYS * 86400e3) delete state.seen[code];
            // 보충 끝: 넓힌 범위의 목록 16개를 다 받고 새 본문도 하나도 안 놓친 회차 — 다음 분부터 평소 기간(3일)으로 돌아간다
            if (catchUp && stat.lists === Object.keys(OFFICES).length * 2 && missed === 0) {
                emit({ atMs: t2, kind: 'catch_up_done', fromDay: sdDay, 설명: `끊긴 동안의 통보문 보충을 마침(${sdDay} 부터 받음) — 다음부터 평소대로 3일 전부터` });
                delete state.catchUpFromMs; delete state.catchUpStartedMs; delete state.catchUpPausedUntilMs;
            } else if (catchUp && t2 - (state.catchUpStartedMs || t2) >= CATCH_UP_GIVE_UP_MS) {
                emit({ atMs: t2, kind: 'catch_up_gave_up', fromDay: sdDay, lists: stat.lists, missed, 설명: `끊긴 동안의 통보문 보충을 하루 동안 마치지 못해 그만둠(목록 ${stat.lists}/16 · 못 받은 본문 ${missed}건) — 하루 쉬고 다시 해 본다(그동안은 평소대로 3일 전부터). 빠진 통보문이 있을 수 있다` });
                delete state.catchUpFromMs; delete state.catchUpStartedMs; state.catchUpPausedUntilMs = t2 + CATCH_UP_GIVE_UP_MS;
            }
            if (stat.lists === Object.keys(OFFICES).length * 2) { state.started = true; state.listsOkMs = t2; }   // 목록을 다 받은 회차가 있어야 기준이 선다 · listsOkMs = 마지막으로 다 받은 시각(📋 팝업이 통보문이 최신인지 볼 때 — bulletin_status.zoneBulletins)
            save();
            prune();
            return stat;
        } finally { running = false; }
    }

    function prune() {
        const cut = dayOf(now() - KEEP_DAYS * 86400e3);
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) fs.unlinkSync(path.join(dir, f));
    }
    const days = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort();
    const readDay = (d) => { try { return fs.readFileSync(path.join(dir, d + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
    /**
     * 지금 들고 있는 통보문(목록 기간 3일 + 처음 본 뒤 10일까지 남겨 둔 기록) — 내용이 찬 것만, 처음 내용을 본 시각과 함께.
     * 예: [{ code, stn, office:'제주청', rpt:'6', seenMs:…, result:{ t1Title, tmFc, tmIn, t2, t6, … } }]
     * [연계] → services/bulletin_status.js(통보문 기준 특보현황 계산)
     */
    function bulletins() {
        load();
        return Object.entries(state.seen).filter(([, s]) => s.result && !s.empty)
            .map(([code, s]) => ({ code, stn: s.stn, office: OFFICES[s.stn], rpt: s.rpt, seenMs: s.fullMs || s.firstMs, result: s.result }));
    }
    /** 목록 16개를 마지막으로 다 받은 시각(ms, 없으면 0). [연계] → services/bulletin_status.run */
    const listsOkMs = () => { load(); return state.listsOkMs || 0; };
    return { run, readDay, days, bulletins, listsOkMs };
}

// ── 실제 dmdw 연결(collect.js 와 같은 요청) ────────────────────────────────────────────
const https = require('https');
const HOST = 'dmdw.kma.go.kr', BASE = 'https://' + HOST;
const S = { cookies: {}, csrf: '' };
const enc64 = (s) => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const csrfOf = (t) => { const m = t.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/); return m ? m[1] : ''; };
function req(method, p, body, extra) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({ 'User-Agent': 'Mozilla/5.0 (SEAGNAL/bulletin-watch)', Cookie: Object.entries(S.cookies).map(([k, v]) => k + '=' + v).join('; ') }, extra || {});
        if (body) { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h['Content-Length'] = Buffer.byteLength(body); }
        const r = https.request({ method, host: HOST, path: p, headers: h, timeout: 30000 }, (o) => {
            (o.headers['set-cookie'] || []).forEach((c) => { const kv = c.split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) S.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
            const c = []; o.on('data', (d) => c.push(d)); o.on('end', () => resolve({ s: o.statusCode, t: Buffer.concat(c).toString('utf8') }));
        });
        r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
        if (body) r.write(body); r.end();
    });
}
async function realLogin() {
    S.cookies = {};
    const w = await req('GET', '/rsw/mfp/mfpMain'); S.csrf = csrfOf(w.t);
    const lr = await req('POST', '/rsw/rest/frm/login_user', new URLSearchParams({ userId: enc64(process.env.KMA_DMDW_USER_ID), userPwd: enc64(process.env.KMA_DMDW_USER_PWD) }).toString(),
        { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, Origin: BASE, Referer: BASE + '/rsw/mfp/mfpMain', Accept: 'application/json' });
    const state = (() => { try { return JSON.parse(lr.t).body.result.statecode; } catch (_) { return null; } })();
    if (state !== '10') throw new Error('로그인 거부(statecode=' + state + ')');   // 00 미등록 · 01 승인대기 · 11 비밀번호 만료
    const f = await req('GET', '/rsw/mfp/wrn/rswWeaWnotRetrieve', null, { 'X-Requested-With': 'XMLHttpRequest' });
    const c2 = csrfOf(f.t); if (c2) S.csrf = c2;
}
async function realPost(p, form) {
    const r = await req('POST', p, new URLSearchParams(form).toString(),
        { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, Origin: BASE, Referer: BASE + '/rsw/mfp/mfpSub?lv2Id=B001', Accept: 'application/json' });
    if (r.s === 401 || r.s === 302 || r.s === 403) throw Object.assign(new Error('세션 끊김 ' + r.s), { sessionLost: true });
    if (r.s !== 200) throw new Error('HTTP ' + r.s);
    let j; try { j = JSON.parse(r.t); } catch (_) { throw Object.assign(new Error('JSON 아님(세션 끊김 추정)'), { sessionLost: true }); }
    if (j.statusCode && j.statusCode !== 200) throw new Error('statusCode ' + j.statusCode);
    return j.body;
}

const enabled = !!(process.env.KMA_DMDW_USER_ID && process.env.KMA_DMDW_USER_PWD) && process.env.BULLETIN_WATCH_DISABLE !== '1';
let real = null;
const getReal = () => (real = real || createWatch({ post: realPost, login: realLogin, onLogin: (r) => { reportLogin(r); } }));   // 로그인이 안 되면 관리자 푸시(reportLogin — 던지지 않는다)

/**
 * 로그인 실패를 관리자에게 보일 짧은 사유로 바꾼다(푸시·수집현황 카드에 그대로 나간다).
 * 예: Error('로그인 거부(statecode=11)') → '로그인 거부 — 비밀번호 만료' · Error('timeout') → '로그인 실패 — 시간초과'
 * @param {*} e 로그인이 던진 오류 @returns {string}
 * [연계] ← reportLogin(이 파일) / 상태 코드 뜻은 realLogin 주석(00 미등록 · 01 승인대기 · 11 비밀번호 만료 — 11 은 2026-11-15 실제 사례)
 */
function loginReason(e) {
    const m = /statecode=([^)\s]+)/.exec(String((e && e.message) || e || ''));
    if (m) return '로그인 거부 — ' + ({ '11': '비밀번호 만료', '00': '미등록 계정', '01': '승인 대기' }[m[1]] || '상태 코드 ' + m[1]);
    return '로그인 실패 — ' + require('./collect_fail_alert').reasonOf(e);
}
/**
 * 로그인 시도 결과를 수집 실패 알림에 보고한다 — 안 되기 시작하면 관리자 푸시 1통, 다시 되면 「복구」 1통(collect_fail_alert 규칙 그대로).
 * 예: reportLogin({ok:false, error:Error('로그인 거부(statecode=11)')}) → 푸시 「특보·예비특보 통보문 (기상청 방재기상플랫폼) 수집 실패 — 로그인 거부 — 비밀번호 만료, 11/18 22:30부터」
 * @param {{ok:boolean, error?:*}} r @param {{report:function}} [alerter] 검사용 바꿔 끼우기
 * [연계] ← createWatch.call(onLogin — 실제 연결에서만) / → services/collect_fail_alert.report('bulletins')
 */
function reportLogin(r, alerter = require('./collect_fail_alert')) {
    return alerter.report('bulletins', r.ok ? { ok: true } : { ok: false, error: Object.assign(new Error(String((r.error && r.error.message) || r.error)), { plainReason: loginReason(r.error) }) });
}

module.exports = {
    enabled,
    run: () => getReal().run(),
    days: () => getReal().days(),
    readDay: (d) => getReal().readDay(d),
    bulletins: () => getReal().bulletins(),
    listsOkMs: () => getReal().listsOkMs(),
    createWatch, isEmpty, OFFICES, dayOf, hmOf, loginReason, reportLogin,
    _real: { post: realPost, login: realLogin },   // 실제 연결 한 번 시험용(저장 위치를 바꿔 끼울 때)
};
