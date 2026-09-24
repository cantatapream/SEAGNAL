/**
 * ============================================================================
 * 파일명: services/typhoon_notifier.js
 * 역할 : 태풍이 "새로 생겼는지(발생)" / "사라졌는지(소멸)"를 스스로 알아채서
 *        알림을 켜둔 사용자에게 푸시를 보내주는 모듈.
 * ============================================================================
 *
 * [이 파일을 한 줄로 말하면]
 *   "10분마다 태풍 현황 파일을 들여다보고, 새 태풍/소멸을 발견하면 딱 한 번씩 알림을 쏜다."
 *
 * [전체 그림 — 초보자 설명]
 *   1. 태풍 수집기(typhoon_crawler.js)가 기상청에서 태풍 정보를 받아 data/typhoon.json 에 저장한다.
 *      (이 파일은 그 수집기를 건드리지 않는다. 읽기만 한다.)
 *   2. 스케줄러(scheduler.js)가 수집 직후 이 파일의 detectAndNotify() 를 불러준다.
 *   3. detectAndNotify() 는 "지난번까지 내가 알린 태풍 기록(상태 파일)"과 "지금 태풍 현황"을
 *      비교해서, 새로 생긴 태풍/소멸한 태풍만 골라 알림을 보낸다.
 *   4. 한 번 알린 태풍은 기록에 남겨, 같은 태풍을 또 알리지 않는다(중복 방지).
 *
 * [연관 파일]
 *   - typhoon_crawler.js      → data/typhoon.json 을 만든다(입력 데이터 제공)
 *   - scheduler.js            → detectAndNotify() / flushDeferred() 를 주기적으로 호출
 *   - services/typhoon_message.js → 알림 "문구"를 만들어 준다
 *   - routes/push.js (/api/push-typhoon) → 실제로 사용자 기기에 푸시를 쏘는 곳
 *
 * [이 모듈이 쓰는 데이터 파일]
 *   - data/typhoon.json            (읽기) 태풍 현황 — 수집기가 만든 것
 *   - data/typhoon_notify_state.json (읽기/쓰기) "어느 태풍을 이미 알렸는지" 기록장 + baseline
 *   - data/typhoon_defer_queue.json  (읽기/쓰기) 야간에 잠시 보류한 알림 대기열
 *
 * [중요한 규칙 — 사용자와 합의]
 *   - 발송 대상: 알림을 켠 사람(서버의 push-typhoon 라우트가 거른다).
 *   - 야간(밤 11시~아침 7시): 야간수신을 끈 사람에게는 보내지 않고 아침 7시에 모아서 보낸다.
 *   - 점검(유지보수) 모드: 태풍 푸시도 멈춘다.
 *   - 충돌 안전: 보내기 "전에 먼저 기록"한다 → 혹시 도중에 서버가 꺼져도 중복 발송은 막는다.
 *
 * [자격증명] 태풍 수집기와 같은 환경변수(KMA_DMDW_USER_ID/PWD)에 의존.
 *   미설정이면 enabled=false 로 아무 일도 하지 않는다(운영 영향 0).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Node 18+ 에 내장된 fetch 를 우선 쓰고, 없으면 node-fetch 패키지 사용(push_sender.js 와 동일).
let fetch;
try { fetch = require('node-fetch'); } catch (_) { fetch = globalThis.fetch; }

// 태풍 수집기와 동일한 "켜짐/꺼짐" 조건. 아이디·비밀번호가 있어야 동작.
const ENABLED = !!process.env.KMA_DMDW_USER_ID && !!process.env.KMA_DMDW_USER_PWD
    && process.env.KMA_DMDW_DISABLE !== '1';

const DATA_DIR = path.join(__dirname, '..', 'data');
const TYPHOON_FILE = path.join(DATA_DIR, 'typhoon.json');             // 태풍 현황(입력)
const STATE_FILE = path.join(DATA_DIR, 'typhoon_notify_state.json');  // 알림 기록장
const QUEUE_FILE = path.join(DATA_DIR, 'typhoon_defer_queue.json');   // 야간 보류 대기열
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance_config.json'); // 점검 모드 설정

const PUSH_API = 'http://localhost:3001/api/push-typhoon'; // 실제 발송은 이 라우트가 담당
const DEFER_MAX_AGE_MS = 12 * 3600 * 1000; // 보류 항목이 12시간 넘으면 폐기(늦은 알림 누적 방지)

const tmsg = require('./typhoon_message');

// 자격증명이 없으면 "아무 것도 안 하는" 빈 모듈로 내보내고 끝낸다(운영 영향 없음).
if (!ENABLED) {
    console.log('[typhoon-notify] 자격증명 미설정 — 태풍 알림기 비활성(운영 영향 없음).');
    module.exports = { enabled: false, async detectAndNotify() {}, async flushDeferred() {} };
    return;
}

// ---------------------------------------------------------------------------
// 파일 읽기/쓰기 도우미
// ---------------------------------------------------------------------------

/**
 * JSON 파일을 안전하게 읽는다. 파일이 없거나 깨졌으면 fallback(기본값)을 돌려준다.
 *   - 사용처: loadState, loadQueue, detectAndNotify(typhoon.json 읽기).
 */
function readJson(file, fallback) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* 파일이 깨졌으면 던진다 — 아래에서 fallback 을 돌려준다 */ }
    return fallback;
}

/**
 * JSON 파일을 "원자적으로" 저장한다(임시파일에 쓴 뒤 이름 바꾸기).
 *   - 이렇게 하면 저장 도중 서버가 꺼져도 파일이 반쯤 망가지는 일이 없다.
 *   - 사용처: 상태 파일/대기열 저장.
 */
function writeJsonAtomic(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

/** 알림 기록장(state)을 읽어온다. 없으면 빈 기록장을 만들어 돌려준다. */
function loadState() {
    const s = readJson(STATE_FILE, null);
    if (s && s.typhoons) return s;
    return { version: 1, seededAt: null, season: null, typhoons: {} };
}

/** 야간 보류 대기열(queue)을 읽어온다. 없으면 빈 대기열을 돌려준다. */
function loadQueue() {
    const q = readJson(QUEUE_FILE, null);
    return q && Array.isArray(q.items) ? q : { version: 1, items: [] };
}

// ---------------------------------------------------------------------------
// 시각/상태 판단 도우미
// ---------------------------------------------------------------------------

/** 지금을 한국시각 기준 Date 로 (UTC + 9시간). */
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
/** 지금 한국시각의 "시(0~23)". */
function kstHour() { return kstNow().getUTCHours(); }
/** 지금 한국시각의 "연도". 시즌(연도) 변경 감지에 사용. */
function kstYear() { return kstNow().getUTCFullYear(); }
/** 지금이 야간(밤 11시~아침 7시)인가? 야간 보류 판단에 사용. */
function isNightWindow() { const h = kstHour(); return h >= 23 || h < 7; }

/**
 * 지금 "점검(유지보수) 모드"라서 푸시를 막아야 하는가?
 *   - 특보 푸시(push_sender.js)와 똑같은 규칙: active 이고 blockPush 가 꺼져있지 않으면 차단.
 *   - 사용처: detectAndNotify / flushDeferred 맨 앞.
 */
function isBlockedByMaintenance() {
    try {
        if (!fs.existsSync(MAINTENANCE_FILE)) return false;
        const c = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
        return !!(c.active && c.blockPush !== false);
    } catch (_) { return false; }
}

/**
 * 최신 통보문이 "태풍 등급"인가?(아직 열대저압부(TD) 단계면 발생 알림을 보내지 않기 위함)
 *   - kind 가 'TYP'이거나, 강도(grade)가 1 이상이면 진짜 태풍으로 본다(grade 0 = TD).
 *   - 사용처: detectAndNotify 의 발생 판정.
 */
function isTyphoonStage(b0) {
    if (!b0) return false;
    if (b0.kind === 'TYP') return true;
    return !!(b0.current && typeof b0.current.grade === 'number' && b0.current.grade >= 1);
}

/** 통보문 비고에 "종료"라는 글자가 있으면 소멸로 본다(앱의 기존 종료 판정과 동일 신호). */
function remHasEnd(rem) { return !!rem && String(rem).indexOf('종료') >= 0; }

/**
 * typhoon.json 의 태풍 1건을 → 메시지 만들기 좋은 "스냅샷"으로 정리한다.
 *   - bulletins[0] = 가장 최신 통보문. 거기서 현재 위치/비고/발표시각을 뽑는다.
 *   - 사용처: detectAndNotify 가 발생/소멸 문구를 만들 때.
 */
function snapFromTyphoon(t) {
    const b0 = (t.bulletins && t.bulletins[0]) || {};
    const cur = b0.current || null;
    return {
        seq: t.seq, name: t.name, nameEn: t.nameEn || (b0.nameEn || ''),
        current: cur ? { lat: cur.lat, lon: cur.lon, time: cur.time } : null,
        rem: b0.rem || '', tmFc: b0.tmFc || t.latestTmFc || ''
    };
}

/**
 * 기록장 항목(state entry)에 저장해 둔 "마지막 위치/비고"로 스냅샷을 만든다.
 *   - 태풍이 활성목록에서 그냥 사라진 경우(소멸 폴백)에, 마지막으로 본 위치로 문구를 만들기 위함.
 *   - 사용처: detectAndNotify 의 "사라짐" 소멸 처리.
 */
function snapFromEntry(e) {
    return {
        seq: e.seq, name: e.name, nameEn: e.nameEn || '',
        current: e.lastCurrent || null, rem: e.lastRem || '', tmFc: e.lastTmFc || ''
    };
}

// ---------------------------------------------------------------------------
// 발송 (실제 푸시는 push-typhoon 라우트가 처리하고, 여기선 "보내달라"고 요청만 한다)
// ---------------------------------------------------------------------------

/**
 * 만든 문구(msg)를 서버의 푸시 발송 라우트로 보낸다.
 *   - nightCohort: 누구에게 보낼지 구분 — 'on'(야간수신 켠 사람만) / 'off'(끈 사람만) / 없음(전원).
 *   - 누구를 거를지(알림 ON/태풍 ON/야간)는 push-typhoon 라우트가 판단한다.
 *   - 사용처: detectAndNotify(즉시/야간ON), flushDeferred(아침 보류분).
 * @param {{title,body,url}} msg
 * @param {'on'|'off'|undefined} nightCohort
 */
async function postPush(msg, nightCohort) {
    if (!fetch) { console.error('[typhoon-notify] fetch 사용 불가 — 발송 스킵'); return; }
    try {
        const res = await fetch(PUSH_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, nightCohort })
        });
        const r = await res.json().catch(() => ({}));
        console.log(`[typhoon-notify] 발송(${nightCohort || 'all'}): ${msg.title} → 성공 ${r.successCount || 0} / 실패 ${r.failCount || 0}`);
    } catch (e) {
        console.error('[typhoon-notify] 발송 실패:', e.message);
    }
}

// ---------------------------------------------------------------------------
// 메인: 발생/소멸 감지 + 발송
// ---------------------------------------------------------------------------
let _running = false; // 같은 작업이 겹쳐 도는 것을 막는 안전장치

/**
 * [핵심 함수] 태풍 현황을 보고 발생/소멸을 판정해 알림을 보낸다.
 *   - 호출: scheduler.js 가 태풍 수집(typhoonCrawler.run()) 직후에 부른다.
 *   - 순서:
 *       1) 점검 모드면 중단(발송·기록 없음 → 점검 끝난 뒤 다시 판정되어 누락 없음)
 *       2) typhoon.json + 기록장 읽기
 *       3) 첫 실행/연도변경이면 "현재 태풍"을 조용히 기록만(baseline) — 기존 태풍 오발송 방지
 *       4) 신규 발생(태풍 등급이며 처음 보는 것) / 소멸(종료 통보 or 목록에서 사라짐) 찾기
 *       5) 이벤트마다 "먼저 기록 → 그다음 발송"(중복 방지)
 *       6) 야간이면 야간수신 ON 만 즉시 보내고, OFF 분은 대기열에 넣어 아침 7시에 발송
 *   - 연결: snapFromTyphoon/snapFromEntry(데이터 정리) → typhoon_message(문구) → postPush(발송)
 * @param {{log?:Function}} opts 로그 함수(스케줄러가 넘겨줌)
 */
async function detectAndNotify(opts = {}) {
    const log = opts.log || console.log;
    if (_running) return;
    _running = true;
    try {
        // 1) 점검 모드: 발송·기록 없이 중단(다음 정상 틱에서 다시 판정되므로 누락되지 않음)
        if (isBlockedByMaintenance()) { log('[typhoon-notify] 점검 모드 — 태풍 알림 보류'); return; }

        // 2) 데이터 로드
        const data = readJson(TYPHOON_FILE, null);
        if (!data) return; // 아직 수집 전(파일 없음)이면 할 일 없음
        const typhoons = Array.isArray(data.typhoons) ? data.typhoons : [];
        const year = data.year || kstYear();
        const state = loadState();

        // 3) 첫 실행 또는 연도(시즌) 변경 → 현재 활성 태풍을 "조용히 기록만"(baseline, 발송 X)
        //    배포/재시작 직후 이미 떠 있던 태풍으로 알림이 잘못 나가는 사고를 막는다.
        const seasonChanged = state.season != null && state.season !== year;
        if (!state.seededAt || seasonChanged) {
            const nowIso = new Date().toISOString();
            const seeded = { version: 1, seededAt: nowIso, season: year, typhoons: {} };
            for (const t of typhoons) {
                const b0 = (t.bulletins && t.bulletins[0]) || {};
                seeded.typhoons[`${year}:${t.seq}`] = {
                    seq: t.seq, name: t.name, nameEn: t.nameEn || '',
                    onsetNotifiedAt: nowIso, seededOnset: true, // "발생은 이미 처리된 셈"으로 표시 → 다시 안 보냄
                    dissipatedNotifiedAt: remHasEnd(b0.rem) ? nowIso : null,
                    lastCurrent: b0.current ? { lat: b0.current.lat, lon: b0.current.lon, time: b0.current.time } : null,
                    lastRem: b0.rem || '', lastTmFc: b0.tmFc || t.latestTmFc || ''
                };
            }
            writeJsonAtomic(STATE_FILE, seeded);
            log(`[typhoon-notify] baseline 설정(발송 없음) — 활성 ${typhoons.length}개 기록`);
            return;
        }

        // 4) 정상 감지 — 현재 떠 있는 태풍들을 하나씩 보며 발생/소멸 이벤트를 모은다.
        const present = new Set();   // 이번에 본 태풍 키 모음(아래 "사라짐" 판정에 사용)
        const events = [];           // 보낼 이벤트 목록: {kind:'onset'|'dissipation', key, snap}
        for (const t of typhoons) {
            const key = `${year}:${t.seq}`; // 태풍 식별키 (연도:호수)
            present.add(key);
            const b0 = (t.bulletins && t.bulletins[0]) || {};
            let e = state.typhoons[key];
            if (!e) { e = { seq: t.seq, name: t.name, nameEn: t.nameEn || '', onsetNotifiedAt: null, dissipatedNotifiedAt: null }; state.typhoons[key] = e; }
            // 마지막 위치/비고를 항상 캐시(나중에 "사라짐 소멸" 문구를 만들 때 사용)
            e.name = t.name; e.nameEn = t.nameEn || e.nameEn || '';
            if (b0.current) e.lastCurrent = { lat: b0.current.lat, lon: b0.current.lon, time: b0.current.time };
            e.lastRem = b0.rem || ''; e.lastTmFc = b0.tmFc || t.latestTmFc || e.lastTmFc || '';

            // (발생) 아직 안 알렸고 + 태풍 등급이면(TD 단계 제외) → 발생 이벤트
            if (!e.onsetNotifiedAt && !e.seededOnset && isTyphoonStage(b0)) {
                events.push({ kind: 'onset', key, snap: snapFromTyphoon(t) });
            }
            // (소멸) 발생/baseline 기록이 있고 + 아직 소멸 안 알렸고 + 비고에 "종료" → 소멸 이벤트
            if ((e.onsetNotifiedAt || e.seededOnset) && !e.dissipatedNotifiedAt && remHasEnd(b0.rem)) {
                events.push({ kind: 'dissipation', key, snap: snapFromTyphoon(t) });
            }
        }
        // (소멸 — 사라짐 폴백) 기록은 있는데 이번 목록엔 없고 소멸도 안 알렸으면 → 마지막 캐시로 소멸 처리
        //   (태풍이 48시간 활성창에서 빠져 목록에서 사라진 경우에도 소멸 알림을 놓치지 않기 위함)
        for (const key of Object.keys(state.typhoons)) {
            if (present.has(key)) continue;
            const e = state.typhoons[key];
            if ((e.onsetNotifiedAt || e.seededOnset) && !e.dissipatedNotifiedAt) {
                events.push({ kind: 'dissipation', key, snap: snapFromEntry(e) });
            }
        }

        if (!events.length) {
            // 새로 알릴 소식은 없어도, 이번에 갱신한 "마지막 위치/비고" 캐시는 저장해 둔다.
            //   → 나중에 태풍이 종료 통보 없이 목록에서 사라져 '사라짐 소멸'을 만들 때,
            //     발생 당시 위치가 아닌 "최신 위치"로 문구를 만들 수 있다.
            writeJsonAtomic(STATE_FILE, state);
            return;
        }

        // 5~6) 이벤트 처리 — "먼저 기록(중복방지)" 후, 야간이면 보류/주간이면 즉시 발송
        const night = isNightWindow();
        const queue = loadQueue();
        const nowIso = new Date().toISOString();
        for (const ev of events) {
            const e = state.typhoons[ev.key];
            // (중복 방지의 핵심) 발송 "전에" 먼저 알림 처리 시각을 기록하고 저장한다.
            //   → 혹시 발송 도중 서버가 꺼져도, 이미 기록돼 있으니 다음 실행에서 또 보내지 않는다.
            if (ev.kind === 'onset') e.onsetNotifiedAt = nowIso; else e.dissipatedNotifiedAt = nowIso;
            writeJsonAtomic(STATE_FILE, state);

            const msg = ev.kind === 'onset' ? tmsg.buildOnset(ev.snap) : tmsg.buildDissipation(ev.snap);
            log(`[typhoon-notify] ${ev.kind === 'onset' ? '발생' : '소멸'} 감지: ${msg.title}`);
            if (night) {
                await postPush(msg, 'on'); // 야간수신 ON 사용자에게만 즉시
                // 야간수신 OFF 사용자분은 대기열에 넣어 아침 7시(flushDeferred)에 발송
                queue.items.push({ key: `${ev.key}:${ev.kind}`, title: msg.title, body: msg.body, url: msg.url, enqueuedAt: nowIso });
                writeJsonAtomic(QUEUE_FILE, queue);
            } else {
                await postPush(msg); // 주간: 옵트인 전원에게 즉시
            }
        }

        // 주간인데 대기열에 보류분이 남아 있으면(예: 아침 7시 발송을 놓친 경우) 이참에 내보낸다.
        if (!night && loadQueue().items.length) await flushDeferred(opts);
    } catch (e) {
        (opts.log || console.log)(`[typhoon-notify] 오류: ${e.message}`);
    } finally {
        _running = false;
    }
}

// ---------------------------------------------------------------------------
// 야간 보류분 발송
// ---------------------------------------------------------------------------

/**
 * 야간에 보류해 둔 알림을 야간수신 OFF 사용자에게 내보낸다.
 *   - 호출: scheduler.js 가 매일 아침 07:00 에 부른다. (주간 감지 중 대기열이 남아도 한 번 더 시도)
 *   - 너무 오래된(12시간 초과) 보류분은 폐기해서, 한참 늦은 알림이 쌓이는 것을 막는다.
 *   - 발송 성공한 항목은 대기열에서 빼고, 실패분만 남겨 다음 기회에 재시도(멱등 처리).
 * @param {{log?:Function}} opts
 */
async function flushDeferred(opts = {}) {
    const log = opts.log || console.log;
    try {
        if (isBlockedByMaintenance()) return; // 점검 중이면 대기열 그대로 두고 나중에
        const queue = loadQueue();
        if (!queue.items.length) return;
        const now = Date.now();
        const remaining = [];
        for (const item of queue.items) {
            // 너무 오래된 보류분은 폐기(늦은 알림 누적 방지)
            if (item.enqueuedAt && (now - Date.parse(item.enqueuedAt)) > DEFER_MAX_AGE_MS) {
                log(`[typhoon-notify] 보류 폐기(만료): ${item.title}`);
                continue;
            }
            try {
                await postPush({ title: item.title, body: item.body, url: item.url }, 'off');
            } catch (e) {
                // ★조용히 넘어가지 않는다 (3-44). 보존해 다음 틱에 다시 보내지만, **계속 실패하면**
                //   영영 안 나가는데 아무 표시가 없었다.
                console.warn('[typhoon-notify] 보류분 발송 실패 — 다음 틱에 다시 시도한다:', item.title, e && e.message);
                remaining.push(item); // 실패분은 보존 → 다음 틱 재시도
            }
        }
        writeJsonAtomic(QUEUE_FILE, { version: 1, items: remaining });
    } catch (e) {
        log(`[typhoon-notify] 보류분 발송 오류: ${e.message}`);
    }
}

module.exports = { enabled: true, detectAndNotify, flushDeferred };
