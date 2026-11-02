/**
 * ============================================================================
 * 파일명: local_server/services/kakao_relay.js
 * 역할  : 태블릿 전용 앱(kakao_relay_app)이 카카오톡 「기상청 해양기상정보포털」 알림톡에서 읽어 보낸
 *         글을 받아, 특보 한 줄씩(구역·종류·시각·발효/해제)으로 나누고 파일에 쌓는다.
 *         지금은 "받아서 기록"까지만 한다 — 사용자 푸시 발송 경로(MMIS)에는 아직 연결하지 않았다.
 *         태블릿이 멈추면(신호 끊김 등) 관리자에게 푸시로 알린다(checkHealth).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/server_config(DATA_DIR) · services/collect_fail_alert(멈춤 알림)
 *  - 서버 API      : 없음(routes/kakao_relay.js 가 부른다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/kakao_relay.js · scheduler.js(5분마다 checkHealth) · 검사 scripts/test_kakao_relay.js
 *  - 알림          : services/collect_fail_alert.js 항목 kakaoRelay(태블릿 신호 끊김·접근성 꺼짐·읽기 실패 → 관리자 푸시)
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');

const MAX_MESSAGES = 300;
const MAX_SEEN_KEYS = 3000;
/** 임시 긁어오기 보관 상한. */
const MAX_BACKFILL = 5000;
/** 받은 시각보다 이만큼 지난 특보 줄은 「새 특보」로 치지 않는다. */
const STALE_WARNING_MS = 24 * 3600e3;
/** 앱 신호는 30분마다(KakaoNotiService BEAT_MS). 절전으로 늦어질 수 있어 70분 넘게 없으면 끊김으로 본다.
 *  데이터 수집현황 목록표 kakaoRelay 의 30분 주기 + graceMinutes 40 과 같은 값이다. */
const HEARTBEAT_STALE_MS = 70 * 60e3;
/** 믿고 쓰는 동작어. 이 밖의 말은 'unknown'. */
const ACTIONS = ['발효', '해제', '변경', '발표', '연장', '대치'];

/**
 * 알림톡 본문에서 특보 줄을 뽑는다.
 * 예: "…[기상특보]\n동해남부북쪽바깥먼바다,\n풍랑주의보 11월 02일 19시 00분\n발효"
 *     → [{zone:'동해남부북쪽바깥먼바다', kind:'풍랑주의보', at:'2026-11-02T19:00+09:00', action:'발효'}]
 * @param {string} text - 알림톡 전문(줄바꿈 포함 그대로)
 * @param {Date} [now] - 연도 추정 기준(받은 시각). 12월에 1월 특보가 오면 다음 해로 본다.
 * @returns {Array<{zone:string, kind:string, at:string, action:string}>}
 * [연계] ← storeMessages(이 파일) — 받은 글마다 부른다 / 검사 test_kakao_relay
 */
function parseWarnings(text, now = new Date()) {
    const s = String(text || '');
    const start = s.indexOf('[기상특보]');
    if (start < 0) return [];
    // 화면 폭 때문에 생긴 줄바꿈도 섞여 들어올 수 있어, 공백류를 한 칸으로 합쳐 읽는다.
    const body = s.slice(start + '[기상특보]'.length).replace(/\s+/g, ' ');
    const re = /([^,]+?),\s*([가-힣]+?(?:주의보|경보))\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분\s*([가-힣]+)/g;
    const kst = new Date(now.getTime() + 9 * 3600e3);
    const out = [];
    let m;
    while ((m = re.exec(body))) {
        const mon = +m[3], day = +m[4];
        let year = kst.getUTCFullYear();
        if (mon === 1 && kst.getUTCMonth() === 11) year++;
        else if (mon === 12 && kst.getUTCMonth() === 0) year--;
        const p = (n) => String(n).padStart(2, '0');
        // 「…바\n다」처럼 화면 폭에서 끊긴 공백은 없애고, 「…앞바다중 북동연안바다」의 원래 띄어쓰기는 남긴다.
        const zone = m[1].trim().replace(/(?<!중)\s+/g, '');
        out.push({
            zone,
            // 비교용 열쇠 — 공백을 모두 뺀 이름(MMIS 쪽 이름 대부분이 공백 없는 꼴이다).
            zoneKey: zone.replace(/\s+/g, ''),
            kind: m[2],
            at: `${year}-${p(mon)}-${p(day)}T${p(m[5])}:${p(m[6])}+09:00`,
            // 모르는 동작어(잘린 글 「해」, 「풍랑경보로」 등)는 그대로 믿지 않고 'unknown' 으로 둔다.
            action: ACTIONS.includes(m[7]) ? m[7] : 'unknown',
            rawAction: m[7],
        });
    }
    return out;
}

/**
 * 저장소(파일 하나)를 만든다. 검사에서는 임시 파일 경로를 넣는다.
 * 예: const st = createStore({ file: '/tmp/x.json' }); st.storeMessages([{text}], 'tab1')
 * @param {object} [o] @param {string} [o.file] - 저장 파일 경로(기본 data/kakao_relay.json)
 * @returns {{storeMessages:function, heartbeat:function, snapshot:function}}
 * [연계] ← routes/kakao_relay.js
 */
function createStore({ file, backfillFile } = {}) {
    if (!file) file = path.join(require('../config/server_config').DATA_DIR, 'kakao_relay.json');
    if (!backfillFile) backfillFile = file.replace(/\.json$/, '') + '_backfill.json';

    function load() {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) {
            if (e.code === 'ENOENT') return { messages: [], heartbeat: null, heartbeatAt: null, seenKeys: [] };
            // 깨진 파일을 빈 DB 로 덮어쓰면 이력이 통째로 사라진다 — 원본을 남기고 저장을 거부한다.
            try { fs.copyFileSync(file, file + '.bad'); } catch (_) { /* 원본 보존 시도만 */ }
            throw new Error('저장 파일 손상(' + e.message + ') — ' + file + '.bad 로 보존, 저장 거부');
        }
    }
    function save(db) {
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
        fs.renameSync(tmp, file);
    }

    /**
     * 앱이 보낸 글들을 넣는다. 같은 글(본문이 똑같은 것)은 한 번만 남긴다 —
     * 앱은 대화방을 열 때마다 화면에 보이는 최근 글을 여러 개 다시 보내기 때문이다.
     * 예: storeMessages([{text:'…', source:'screen'}], 'tab1') → {added:1, duplicate:0}
     * @param {Array<{text:string, source?:string}>} items @param {string} device
     * @param {Date} [now]
     * @returns {{added:number, duplicate:number, new:Array}}
     */
    function storeMessages(items, device, now = new Date()) {
        const db = load();
        const known = new Set(db.messages.map((x) => x.id));
        // 특보 「줄」 단위 중복 — 같은 특보가 알림 글·화면 글·접힌 글·전문으로 여러 번 들어와도 한 번만 새것이다.
        const seen = new Set(db.seenKeys || []);
        const added = [];
        let duplicate = 0;
        for (const it of items) {
            const text = String((it && it.text) || '').trim();
            if (!text) continue;
            const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
            if (known.has(id)) { duplicate++; continue; }
            known.add(id);
            const rec = {
                id, text,
                source: it.source === 'notification' ? 'notification' : 'screen',
                device: String(device || ''),
                receivedAt: now.toISOString(),
                warnings: parseWarnings(text, now),
            };
            // 새 특보 줄: 처음 보는 열쇠이고, 받은 시각보다 24시간 넘게 지난 옛 특보가 아닌 것(밀려난 옛 글이 다시 들어온 경우 차단).
            rec.newWarnings = rec.warnings.filter((w) => {
                const key = warningKey(w);
                if (seen.has(key) || w.action === 'unknown') return false;
                seen.add(key);
                return now.getTime() - Date.parse(w.at) <= STALE_WARNING_MS;
            });
            // 특보 글인데 한 줄도 못 나눴으면 꼴이 바뀐 것이다 — 조용히 넘기지 않고 표시·기록한다.
            if (text.includes('[기상특보]') && !rec.warnings.length) {
                rec.unparsed = true;
                console.warn('[kakao_relay] ⚠특보 글 분해 0줄 — 알림톡 꼴 확인 필요:', id);
            }
            db.messages.push(rec);
            added.push(rec);
        }
        if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
        db.seenKeys = [...seen].slice(-MAX_SEEN_KEYS);
        if (added.length) save(db);
        return { added: added.length, duplicate, new: added };
    }

    /**
     * 앱의 "살아 있음" 신호를 기록한다. 이 기록이 오래되면 태블릿 경로가 멈춘 것이다.
     * 예: heartbeat({device:'tab1', battery:80}) → 저장
     */
    function heartbeat(info, now = new Date()) {
        const db = load();
        db.heartbeat = { ...info, at: now.toISOString() };
        // 데이터 수집현황 카드가 읽는 맨 위 칸(목록표 kakaoRelay 의 collectedField).
        db.heartbeatAt = db.heartbeat.at;
        save(db);
    }

    /** 관리자 확인용 — 마지막 신호와 최근 글 n개. */
    function snapshot(n = 50) {
        const db = load();
        return { heartbeat: db.heartbeat, messages: db.messages.slice(-n).reverse() };
    }

    /** 멈춤 감시용 — 마지막 신호만. 파일이 없으면 null. */
    function lastHeartbeat() {
        return load().heartbeat || null;
    }

    // ── 임시 「긁어오기」 보관함 (사용자 확정 2026-11-02 「임시로만. 그렇게 가져가면 네가 그 데이터를 보고 분석해줄 수 있도록」) ──
    //   본 휴대폰 카톡에 이미 쌓인 옛 알림톡을 분석용으로만 모은다. 실시간 기록(file)·특보 줄 중복표(seenKeys)와
    //   섞지 않는다 — 옛 특보가 「새 특보」로 잡히거나, 앞으로 올 특보를 「이미 봤다」로 막는 일이 없게.
    //   분석이 끝나면 clearBackfill 로 지운다.

    function loadBackfill() {
        try { return JSON.parse(fs.readFileSync(backfillFile, 'utf8')); }
        catch (e) {
            if (e.code === 'ENOENT') return { messages: [] };
            throw new Error('긁어오기 파일 손상(' + e.message + ')');
        }
    }

    /**
     * 긁어온 글을 넣는다. 글 본문이 같으면 한 번만. 연도는 화면의 날짜 줄(예 '2026년 11월 2일 일요일')이 있으면 그것으로 정한다.
     * 예: storeBackfill([{text, date:'2026년 11월 2일 일요일', time:'오후 5:03'}], 'phone') → {added:1, duplicate:0, total:1}
     * @param {Array<{text:string, date?:string, time?:string}>} items @param {string} device @param {Date} [now]
     * [연계] ← routes/kakao_relay POST /api/kakao-relay/backfill
     */
    function storeBackfill(items, device, now = new Date()) {
        const db = loadBackfill();
        const known = new Set(db.messages.map((x) => x.id));
        let added = 0, duplicate = 0;
        for (const it of items) {
            const text = String((it && it.text) || '').trim();
            if (!text) continue;
            const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
            if (known.has(id)) { duplicate++; continue; }
            known.add(id);
            const date = it.date ? String(it.date).slice(0, 40) : null;
            const dm = date && /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(date);
            const basis = dm ? new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 3)) : now; // 그날 정오 KST
            db.messages.push({
                id, text, date, time: it.time ? String(it.time).slice(0, 20) : null,
                device: String(device || ''), receivedAt: now.toISOString(),
                yearGuessed: !dm,
                warnings: parseWarnings(text, basis),
            });
            added++;
        }
        if (db.messages.length > MAX_BACKFILL) db.messages = db.messages.slice(-MAX_BACKFILL);
        if (added) {
            const tmp = backfillFile + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(db));
            fs.renameSync(tmp, backfillFile);
        }
        return { added, duplicate, total: db.messages.length };
    }

    /** 긁어온 글 전부(분석용). */
    function backfillAll() { return loadBackfill(); }

    /** 분석이 끝나면 지운다. 지운 건수를 돌려준다. */
    function clearBackfill() {
        const n = loadBackfill().messages.length;
        try { fs.unlinkSync(backfillFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        return n;
    }

    return { storeMessages, heartbeat, snapshot, lastHeartbeat, storeBackfill, backfillAll, clearBackfill };
}

/**
 * 특보 줄의 비교 열쇠. 예: {zoneKey:'서해남부먼바다', kind:'풍랑주의보', at:'2026-11-02T19:00+09:00', action:'발효'}
 *   → '서해남부먼바다|풍랑주의보|2026-11-02T19:00+09:00|발효'
 * [연계] ← storeMessages
 */
function warningKey(w) {
    return [w.zoneKey || String(w.zone).replace(/\s+/g, ''), w.kind, w.at, w.action].join('|');
}

/**
 * 태블릿 경로가 지금 정상인가를 판정한다(사건이 아니라 상태 — 고쳐질 때까지 계속 「이상」이다).
 * 예: 마지막 신호 80분 전 → {ok:false, reason:'태블릿 신호 끊김 — 마지막 11/02 13:00'}
 *     신호 note 에 '접근성 꺼짐' → {ok:false, reason:'태블릿 화면 읽기(접근성) 꺼짐'}
 *     한 번도 신호가 없었음 → null(아직 설치 전 — 판정하지 않음. 수집현황 카드에는 「기록 없음」으로 보인다)
 * @param {object|null} hb - lastHeartbeat() @param {number} nowMs
 * @returns {{ok:boolean, reason?:string}|null}
 * [연계] ← checkHealth / 검사 test_kakao_relay
 */
function judgeHealth(hb, nowMs) {
    if (!hb || !hb.at) return null;
    const at = Date.parse(hb.at);
    if (!Number.isFinite(at)) return { ok: false, reason: '태블릿 신호 시각을 읽을 수 없음' };
    if (!(nowMs - at <= HEARTBEAT_STALE_MS)) {
        const k = new Date(at + 9 * 3600e3).toISOString();
        return { ok: false, reason: '태블릿 신호 끊김 — 마지막 ' + k.slice(5, 10).replace('-', '/') + ' ' + k.slice(11, 16) };
    }
    const note = String(hb.note || '');
    if (note.includes('접근성 꺼짐')) return { ok: false, reason: '태블릿 화면 읽기(접근성) 꺼짐' };
    if (note.includes('알림 감시 끊김')) return { ok: false, reason: '태블릿 카톡 알림 감시 끊김' };
    const last = /마지막 읽기: (.*)$/.exec(note);
    if (last && /실패/.test(last[1])) return { ok: false, reason: '대화방 읽기 실패 — ' + last[1].slice(0, 60) };
    return { ok: true };
}

/**
 * 판정을 관리자 알림기(collect_fail_alert)에 넘긴다 — 처음 이상일 때 1번, 정상으로 돌아오면 「복구」 1번.
 * 서버에 열쇠(KAKAO_RELAY_TOKEN)가 없으면 이 경로를 안 쓰는 것이므로 아무것도 하지 않는다.
 * 예: scheduler 가 5분마다 checkHealth() 호출
 * @returns {Promise<object|null>} 판정
 * [연계] ← scheduler.js 1분 마스터(5분마다) / → judgeHealth · services/collect_fail_alert.report('kakaoRelay')
 */
async function checkHealth({ store = createStore(), alert = require('./collect_fail_alert'), now = Date.now(), enabled = !!process.env.KAKAO_RELAY_TOKEN } = {}) {
    if (!enabled) return null;
    let v;
    try {
        v = judgeHealth(store.lastHeartbeat(), now);
    } catch (e) {
        v = { ok: false, reason: '저장 파일 읽기 실패 — ' + e.message.slice(0, 60) };
    }
    if (!v) return null;
    await alert.report('kakaoRelay', v.ok ? { ok: true } : { ok: false, error: { plainReason: v.reason } });
    return v;
}

module.exports = { parseWarnings, createStore, warningKey, judgeHealth, checkHealth, MAX_MESSAGES, ACTIONS, HEARTBEAT_STALE_MS };
