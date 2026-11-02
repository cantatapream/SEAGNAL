/**
 * ============================================================================
 * 파일명: local_server/services/kakao_relay_log.js
 * 역할  : 카톡 특보중계 「10일 시험」의 날짜별 기록장. 받은 글·중복·신호·기기 설정·카톡판 특보현황과
 *         MMIS 특보현황의 비교 결과를 하루 한 파일(data/kakao_relay_log/YYYY-MM-DD.jsonl, KST 날짜)에
 *         한 줄씩 덧붙인다. 30일이 지난 파일은 지운다.
 *         (사용자 확정 2026-11-03 「수집되는 정보들이 모두 기록되어 있어야 해」 — 원래 기록은 최근 300건만 남았다)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(fs·path 만)
 *  - 서버 API      : 없음(routes/kakao_relay GET /api/admin/kakao-relay/compare 가 kakao_shadow.summarize 로 읽는다)
 *  - 나를 쓰는 곳  : services/kakao_relay(받은 글·신호·기기) · services/kakao_shadow(비교) · 검사 test_kakao_shadow
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const KEEP_DAYS = 30;
const KST = 9 * 3600e3;

/** ms → KST 날짜 'YYYY-MM-DD'. 예: dayOf(Date.parse('2026-11-02T15:30Z')) → '2026-11-03' */
function dayOf(ms) {
    return new Date(ms + KST).toISOString().slice(0, 10);
}

/**
 * 기록장을 만든다. 서버(받은 글)와 스케줄러(비교) 두 프로세스가 같은 파일에 덧붙이므로
 * 한 줄씩 append 만 한다(고쳐 쓰지 않는다).
 * 예: const lg = createLog('/tmp/x'); lg.append({kind:'beat', device:'tablet'}); lg.read('2026-11-03')
 * @param {string} dir
 * [연계] ← kakao_relay.createStore · kakao_shadow.runShadow
 */
function createLog(dir) {
    const fileOf = (day) => path.join(dir, day + '.jsonl');
    /** 한 줄 덧붙이기. 기록이 안 돼도 중계·비교는 멈추지 않는다(경고만). */
    function append(ev, nowMs = Date.now()) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(fileOf(dayOf(nowMs)), JSON.stringify({ t: new Date(nowMs).toISOString(), ...ev }) + '\n');
        } catch (e) {
            console.warn('[kakao_relay_log] 기록 실패:', e.message);
        }
    }
    /** 그날 기록 전부. 깨진 줄은 건너뛴다. */
    function read(day) {
        let txt;
        try { txt = fs.readFileSync(fileOf(day), 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') return []; throw e; }
        const out = [];
        for (const line of txt.split('\n')) {
            if (!line) continue;
            try { out.push(JSON.parse(line)); } catch (_) { /* 쓰는 중 잘린 마지막 줄 — 건너뜀 */ }
        }
        return out;
    }
    /** 기록이 있는 날짜들(오래된 순). */
    function days() {
        try { return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
        catch (e) { return []; }
    }
    /** 30일 지난 파일 지우기. 지운 날짜 목록. */
    function prune(nowMs = Date.now()) {
        const cut = dayOf(nowMs - KEEP_DAYS * 864e5);
        const gone = [];
        for (const d of days()) {
            if (d >= cut) continue;
            try { fs.unlinkSync(fileOf(d)); gone.push(d); } catch (e) { console.warn('[kakao_relay_log] 지우기 실패:', d, e.message); }
        }
        return gone;
    }
    return { append, read, days, prune, dir };
}

module.exports = { createLog, dayOf, KEEP_DAYS };
