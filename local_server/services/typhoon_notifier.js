/**
 * ============================================================================
 * 파일명: services/typhoon_notifier.js
 * 역할 : 태풍 "발생/소멸"을 감지해 옵트인 사용자에게 푸시를 발송하는 모듈.
 *        (수집기 typhoon_crawler.js 는 손대지 않는다 — 데이터/표출과 분리.)
 * ============================================================================
 *
 * [동작 흐름]  scheduler.js 가 typhoonCrawler.run() 직후 detectAndNotify() 호출
 *   1) 점검(유지보수) 모드면 즉시 중단(발송·상태변경 없음) — 특보 푸시와 동일 정책
 *   2) data/typhoon.json(수집기 최신 결과) + data/typhoon_notify_state.json(기록) 로드
 *   3) 콜드스타트: 기록 파일이 없으면 현재 활성 태풍을 "조용히 baseline 기록"(발송 X)
 *      → 배포/재시작 직후 기존 태풍으로 오발송하는 사고 방지
 *   4) 신규 발생(태풍 등급이며 미기록) / 소멸("종료" 또는 활성목록에서 사라짐) 판정
 *   5) 이벤트별로 "발송했다고 먼저 기록(at-most-once)" 후 발송 — 중복 발송 방지
 *      (사용자 합의: 극히 드문 충돌 시 중복보다 누락을 택함)
 *   6) 야간(KST 23:00~07:00): 야간수신 ON 사용자에게는 즉시,
 *      야간수신 OFF 사용자분은 보류큐에 적재 → 아침 07:00 또는 다음 주간 틱에 발송
 *
 * [발송 경로] POST http://localhost:3001/api/push-typhoon  (routes/push.js)
 *   수신 대상 거르기(master + typhoon 옵션 + 야간 코호트)는 그 라우트가 담당.
 *
 * [자격증명] typhoon_crawler 와 동일 게이트(KMA_DMDW_USER_ID/PWD). 미설정이면 enabled=false.
 *   (수집기가 비활성이면 typhoon.json 이 갱신되지 않으므로 알림기도 의미 없음.)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Node 18+ 내장 fetch 우선, 없으면 node-fetch (push_sender.js 와 동일 패턴)
let fetch;
try { fetch = require('node-fetch'); } catch (_) { fetch = globalThis.fetch; }

const ENABLED = !!process.env.KMA_DMDW_USER_ID && !!process.env.KMA_DMDW_USER_PWD
    && process.env.KMA_DMDW_DISABLE !== '1';

const DATA_DIR = path.join(__dirname, '..', 'data');
const TYPHOON_FILE = path.join(DATA_DIR, 'typhoon.json');
const STATE_FILE = path.join(DATA_DIR, 'typhoon_notify_state.json');
const QUEUE_FILE = path.join(DATA_DIR, 'typhoon_defer_queue.json');
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance_config.json');

const PUSH_API = 'http://localhost:3001/api/push-typhoon';
const DEFER_MAX_AGE_MS = 12 * 3600 * 1000; // 보류 항목이 12시간 넘으면 폐기(아침 발송 누락 누적 방지)

const tmsg = require('./typhoon_message');

if (!ENABLED) {
    console.log('[typhoon-notify] 자격증명 미설정 — 태풍 알림기 비활성(운영 영향 없음).');
    module.exports = { enabled: false, async detectAndNotify() {}, async flushDeferred() {} };
    return;
}

// ---------------------------------------------------------------------------
// 파일 I/O (원자적 저장)
// ---------------------------------------------------------------------------
function readJson(file, fallback) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    return fallback;
}
function writeJsonAtomic(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

function loadState() {
    const s = readJson(STATE_FILE, null);
    if (s && s.typhoons) return s;
    return { version: 1, seededAt: null, season: null, typhoons: {} };
}
function loadQueue() {
    const q = readJson(QUEUE_FILE, null);
    return q && Array.isArray(q.items) ? q : { version: 1, items: [] };
}

// ---------------------------------------------------------------------------
// 시각/상태 헬퍼
// ---------------------------------------------------------------------------
function kstNow() { return new Date(Date.now() + 9 * 3600 * 1000); }
function kstHour() { return kstNow().getUTCHours(); }
function kstYear() { return kstNow().getUTCFullYear(); }
function isNightWindow() { const h = kstHour(); return h >= 23 || h < 7; }

/** 점검 모드 + 푸시 차단이면 true (push_sender.js 와 동일 규칙). */
function isBlockedByMaintenance() {
    try {
        if (!fs.existsSync(MAINTENANCE_FILE)) return false;
        const c = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
        return !!(c.active && c.blockPush !== false);
    } catch (_) { return false; }
}

/** 최신 통보문이 태풍 등급인가(열대저압부 단계 제외). */
function isTyphoonStage(b0) {
    if (!b0) return false;
    if (b0.kind === 'TYP') return true;
    return !!(b0.current && typeof b0.current.grade === 'number' && b0.current.grade >= 1);
}
function remHasEnd(rem) { return !!rem && String(rem).indexOf('종료') >= 0; }

/** 태풍/캐시에서 메시지용 스냅샷 생성. */
function snapFromTyphoon(t) {
    const b0 = (t.bulletins && t.bulletins[0]) || {};
    const cur = b0.current || null;
    return {
        seq: t.seq, name: t.name, nameEn: t.nameEn || (b0.nameEn || ''),
        current: cur ? { lat: cur.lat, lon: cur.lon, time: cur.time } : null,
        rem: b0.rem || '', tmFc: b0.tmFc || t.latestTmFc || ''
    };
}
function snapFromEntry(e) {
    return {
        seq: e.seq, name: e.name, nameEn: e.nameEn || '',
        current: e.lastCurrent || null, rem: e.lastRem || '', tmFc: e.lastTmFc || ''
    };
}

// ---------------------------------------------------------------------------
// 발송
// ---------------------------------------------------------------------------
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
// 메인: 감지 + 발송
// ---------------------------------------------------------------------------
let _running = false;
async function detectAndNotify(opts = {}) {
    const log = opts.log || console.log;
    if (_running) return;
    _running = true;
    try {
        // 1) 점검 모드: 발송·상태변경 없이 중단(다음 정상 틱에서 재판정 → 누락 없음)
        if (isBlockedByMaintenance()) { log('[typhoon-notify] 점검 모드 — 태풍 알림 보류'); return; }

        // 2) 데이터 로드
        const data = readJson(TYPHOON_FILE, null);
        if (!data) return; // 수집 전(파일 없음)이면 할 일 없음
        const typhoons = Array.isArray(data.typhoons) ? data.typhoons : [];
        const year = data.year || kstYear();
        const state = loadState();

        // 3) 시즌(연도) 변경 → 기록 리셋 + 재baseline (이월 태풍 오발송 방지)
        const seasonChanged = state.season != null && state.season !== year;
        // 4) 콜드스타트/시즌변경: 현재 활성 태풍을 조용히 기록(발송 X)
        if (!state.seededAt || seasonChanged) {
            const nowIso = new Date().toISOString();
            const seeded = { version: 1, seededAt: nowIso, season: year, typhoons: {} };
            for (const t of typhoons) {
                const b0 = (t.bulletins && t.bulletins[0]) || {};
                seeded.typhoons[`${year}:${t.seq}`] = {
                    seq: t.seq, name: t.name, nameEn: t.nameEn || '',
                    onsetNotifiedAt: nowIso, seededOnset: true,
                    dissipatedNotifiedAt: remHasEnd(b0.rem) ? nowIso : null,
                    lastCurrent: b0.current ? { lat: b0.current.lat, lon: b0.current.lon, time: b0.current.time } : null,
                    lastRem: b0.rem || '', lastTmFc: b0.tmFc || t.latestTmFc || ''
                };
            }
            writeJsonAtomic(STATE_FILE, seeded);
            log(`[typhoon-notify] baseline 설정(발송 없음) — 활성 ${typhoons.length}개 기록`);
            return;
        }

        // 5) 정상 감지
        const present = new Set();
        const events = []; // {kind, key, snap}
        for (const t of typhoons) {
            const key = `${year}:${t.seq}`;
            present.add(key);
            const b0 = (t.bulletins && t.bulletins[0]) || {};
            let e = state.typhoons[key];
            if (!e) { e = { seq: t.seq, name: t.name, nameEn: t.nameEn || '', onsetNotifiedAt: null, dissipatedNotifiedAt: null }; state.typhoons[key] = e; }
            // 캐시 갱신(소멸-사라짐 폴백 시 문구용)
            e.name = t.name; e.nameEn = t.nameEn || e.nameEn || '';
            if (b0.current) e.lastCurrent = { lat: b0.current.lat, lon: b0.current.lon, time: b0.current.time };
            e.lastRem = b0.rem || ''; e.lastTmFc = b0.tmFc || t.latestTmFc || e.lastTmFc || '';

            // 발생: 미기록 + 태풍 등급(TD 단계 제외)
            if (!e.onsetNotifiedAt && !e.seededOnset && isTyphoonStage(b0)) {
                events.push({ kind: 'onset', key, snap: snapFromTyphoon(t) });
            }
            // 소멸: (발생/baseline 기록 있음) + 미소멸 + 비고에 "종료"
            if ((e.onsetNotifiedAt || e.seededOnset) && !e.dissipatedNotifiedAt && remHasEnd(b0.rem)) {
                events.push({ kind: 'dissipation', key, snap: snapFromTyphoon(t) });
            }
        }
        // 소멸(사라짐 폴백): 기록은 있으나 활성목록에서 빠졌고 소멸 미기록 → 마지막 캐시로 소멸 처리
        for (const key of Object.keys(state.typhoons)) {
            if (present.has(key)) continue;
            const e = state.typhoons[key];
            if ((e.onsetNotifiedAt || e.seededOnset) && !e.dissipatedNotifiedAt) {
                events.push({ kind: 'dissipation', key, snap: snapFromEntry(e) });
            }
        }

        if (!events.length) { return; }

        // 6) 이벤트 처리 — "먼저 기록(중복방지)" 후 발송/보류
        const night = isNightWindow();
        const queue = loadQueue();
        const nowIso = new Date().toISOString();
        for (const ev of events) {
            const e = state.typhoons[ev.key];
            if (ev.kind === 'onset') e.onsetNotifiedAt = nowIso; else e.dissipatedNotifiedAt = nowIso;
            writeJsonAtomic(STATE_FILE, state); // at-most-once 보장: 발송 전 기록 고정

            const msg = ev.kind === 'onset' ? tmsg.buildOnset(ev.snap) : tmsg.buildDissipation(ev.snap);
            log(`[typhoon-notify] ${ev.kind === 'onset' ? '발생' : '소멸'} 감지: ${msg.title}`);
            if (night) {
                await postPush(msg, 'on'); // 야간수신 ON 사용자만 즉시
                queue.items.push({ key: `${ev.key}:${ev.kind}`, title: msg.title, body: msg.body, url: msg.url, enqueuedAt: nowIso });
                writeJsonAtomic(QUEUE_FILE, queue);
            } else {
                await postPush(msg); // 주간: 전원(옵트인) 즉시
            }
        }

        // 주간이고 보류분이 남아 있으면(예: 07:00 틱 누락) 이참에 발송
        if (!night && loadQueue().items.length) await flushDeferred(opts);
    } catch (e) {
        (opts.log || console.log)(`[typhoon-notify] 오류: ${e.message}`);
    } finally {
        _running = false;
    }
}

// ---------------------------------------------------------------------------
// 야간 보류분 발송 (07:00 KST 또는 다음 주간 틱)
// ---------------------------------------------------------------------------
async function flushDeferred(opts = {}) {
    const log = opts.log || console.log;
    try {
        if (isBlockedByMaintenance()) return;
        const queue = loadQueue();
        if (!queue.items.length) return;
        const now = Date.now();
        const remaining = [];
        for (const item of queue.items) {
            // 너무 오래된 보류분은 폐기(늦은 알림이 쌓이는 것 방지)
            if (item.enqueuedAt && (now - Date.parse(item.enqueuedAt)) > DEFER_MAX_AGE_MS) {
                log(`[typhoon-notify] 보류 폐기(만료): ${item.title}`);
                continue;
            }
            try {
                await postPush({ title: item.title, body: item.body, url: item.url }, 'off');
            } catch (e) {
                remaining.push(item); // 실패분은 보존 → 다음 틱 재시도
            }
        }
        writeJsonAtomic(QUEUE_FILE, { version: 1, items: remaining });
    } catch (e) {
        log(`[typhoon-notify] 보류분 발송 오류: ${e.message}`);
    }
}

module.exports = { enabled: true, detectAndNotify, flushDeferred };
