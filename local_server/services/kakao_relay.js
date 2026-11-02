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
 *  - 나를 쓰는 곳  : routes/kakao_relay.js · scheduler.js(5분마다 checkHealth, 매분 checkMmis) · 검사 scripts/test_kakao_relay.js
 *  - 읽는 파일     : data/weather_alerts.json(특보현황 — 카톡과 대조) · marine_warning_crawler(표준 해역표)
 *  - 알림          : services/collect_fail_alert.js 항목 kakaoRelay(태블릿 신호 끊김·접근성 꺼짐·읽기 실패 → 관리자 푸시)
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');

const MAX_MESSAGES = 300;
const MAX_SEEN_KEYS = 8000;
/** 「이미 봤음」 글 id 기억(실시간 기록 300건과 별도 — 긁어온 옛 글로 미리 채운다). */
const MAX_SEEN_IDS = 6000;
/** 임시 긁어오기 보관 상한. */
const MAX_BACKFILL = 5000;
/** 받은 시각보다 이만큼 지난 특보 줄은 「새 특보」로 치지 않는다. */
const STALE_WARNING_MS = 24 * 3600e3;
/** 앱 신호는 30분마다(KakaoNotiService BEAT_MS). 절전으로 늦어질 수 있어 70분 넘게 없으면 끊김으로 본다.
 *  데이터 수집현황 목록표 kakaoRelay 의 30분 주기 + graceMinutes 40 과 같은 값이다. */
const HEARTBEAT_STALE_MS = 70 * 60e3;
/** 믿고 쓰는 동작어. 이 밖의 말은 'unknown'. 「변경해제」는 실제 알림톡에 나온다(2026-10-25 2건). */
const ACTIONS = ['발효', '해제', '변경', '변경해제', '연장', '발표', '대치'];
/** 예비특보 줄의 동작어. */
const PRE_ACTIONS = ['발효', '해제'];

// ── 구역 이름 맞추기 (사용자 확정 2026-11-03) ───────────────────────────────────────
//   기준 = 서버 표준 해역표(marine_warning_crawler.MMIS_CODE_TO_NAME 93곳)와 부모→자식 표(PARENT_TO_CHILDREN).
//   카톡 이름은 앱 기존 규칙(location_alert_core.canonZone: 공백 제거·「.」→「·」)으로 맞춘 뒤 별칭을 본다.
//   「남해서부 서쪽」 = 남해서부서쪽먼바다(사용자 확인 — 그 이름의 해역은 이것뿐).
const ZONE_ALIAS = { '남해서부서쪽': '남해서부서쪽먼바다' };
let _zones = null;
/** 표준 해역표를 한 번 읽는다. [연계] → marine_warning_crawler(이미 서버에 올라와 있는 모듈 — require 캐시) */
function zoneTable() {
    if (_zones) return _zones;
    const { MMIS_CODE_TO_NAME, PARENT_TO_CHILDREN } = require('../marine_warning_crawler');
    const names = new Set(Object.values(MMIS_CODE_TO_NAME || {}));
    const childToParent = {};
    for (const [p, cs] of Object.entries(PARENT_TO_CHILDREN || {})) for (const c of cs) childToParent[c] = p;
    _zones = { names, childToParent };
    return _zones;
}
/** 카톡 구역 이름 → 표준 이름. 예: '태안.서산 북쪽 평수구역' → '태안·서산북쪽평수구역', '남해서부 서쪽' → '남해서부서쪽먼바다' */
function canonZone(raw) {
    const z = String(raw || '').replace(/\s+/g, '').replace(/[·.]/g, '·');
    return ZONE_ALIAS[z] || z;
}

const p2 = (n) => String(n).padStart(2, '0');
/** 월·일만 오는 시각에 연도를 붙인다. 12월에 1월 글이 오면 다음 해, 1월에 12월 글이 오면 전 해. */
function yearFor(mon, now) {
    const kst = new Date(now.getTime() + 9 * 3600e3);
    let y = kst.getUTCFullYear();
    if (mon === 1 && kst.getUTCMonth() === 11) y++;
    else if (mon === 12 && kst.getUTCMonth() === 0) y--;
    return y;
}

/**
 * 알림톡 본문에서 특보 줄을 뽑는다. [기상특보]·[예비특보] 둘 다 읽는다.
 * 예: "[기상특보]\n제주도동부앞바다중 북동연안바다,\n풍랑주의보 11월 02일 19시 00분 발효"
 *     → [{section:'기상특보', zone:'제주도동부앞바다중북동연안바다', parent:'제주도동부앞바다', zoneKnown:true,
 *         kind:'풍랑주의보', type:'풍랑', level:'주의보', at:'2026-11-02T19:00+09:00', until:null, action:'발효', …}]
 *     "[예비특보]\n제주도서부앞바다,\n풍랑예비특보 11월 02일 12~18시 발효"
 *     → [{section:'예비특보', kind:'풍랑예비특보', level:'예비', at:'…T12:00+09:00', until:'…T18:00+09:00', action:'발효', …}]
 * 뜻(사용자 확인 2026-11-03): 「시각」 = 그 상태가 시작되는 시각. 변경 = 그 종류·등급으로 바뀜(격상·격하는 직전 상태와 비교),
 *   변경해제 = 다른 종류(태풍)로 바뀌며 이 종류 끝, 해제의 미래 시각 = 그때 풀린다는 확정 예고, 연장 = 연장 발효 시각.
 *   태풍은 카톡이 발효·발표를 주지 않아 MMIS 기준(mmisOnly). 예비특보 「해제」는 취소인지 시간 변경인지 아직 미확정.
 * @param {string} text @param {Date} [now] - 연도 추정 기준
 * @returns {Array<object>}
 * [연계] ← storeMessages·storeBackfill(이 파일) / 검사 test_kakao_relay
 */
function parseWarnings(text, now = new Date()) {
    const s = String(text || '');
    const pre = s.indexOf('[예비특보]'), formal = s.indexOf('[기상특보]');
    if (pre < 0 && formal < 0) return [];
    const section = formal >= 0 ? '기상특보' : '예비특보';
    const body = s.slice((formal >= 0 ? formal : pre) + 6).replace(/\s+/g, ' ');
    const out = [];
    const zt = zoneTable();
    const zoneInfo = (raw) => {
        const zone = canonZone(raw);
        const parent = zt.childToParent[zone] || null;
        return { rawZone: raw.trim(), zone, zoneKey: zone, parent, zoneKnown: zt.names.has(zone) };
    };
    let m;
    if (section === '기상특보') {
        const re = /([^,]+?),\s*([가-힣]+?)(주의보|경보)\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분\s*([가-힣]+)/g;
        while ((m = re.exec(body))) {
            const mon = +m[4], day = +m[5], y = yearFor(mon, now);
            out.push({
                section, ...zoneInfo(m[1]),
                kind: m[2] + m[3], type: m[2], level: m[3],
                at: `${y}-${p2(mon)}-${p2(day)}T${p2(m[6])}:${p2(m[7])}+09:00`, until: null,
                // 모르는 동작어(잘린 글 「해」 등)는 그대로 믿지 않고 'unknown'.
                action: ACTIONS.includes(m[8]) ? m[8] : 'unknown', rawAction: m[8],
                mmisOnly: m[2] === '태풍' || undefined,
            });
        }
    } else {
        const re = /([^,]+?),\s*([가-힣]+?)예비특보\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})~(\d{1,2})시\s*([가-힣]+)/g;
        while ((m = re.exec(body))) {
            const mon = +m[3], day = +m[4], y = yearFor(mon, now), h1 = +m[5], h2 = +m[6];
            const start = Date.parse(`${y}-${p2(mon)}-${p2(day)}T${p2(h1)}:00+09:00`);
            // 끝 시각이 시작보다 작으면(18~00시) 다음 날.
            const end = start + (((h2 - h1 + 24) % 24) || 24) * 3600e3;
            const iso = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 16) + '+09:00';
            out.push({
                section, ...zoneInfo(m[1]),
                kind: m[2] + '예비특보', type: m[2], level: '예비',
                at: iso(start), until: iso(end),
                action: PRE_ACTIONS.includes(m[7]) ? m[7] : 'unknown', rawAction: m[7],
                mmisOnly: m[2] === '태풍' || undefined,
            });
        }
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
     * 앱이 보낸 글들을 넣는다. 「이미 봤음」을 두 겹으로 거른다(사용자 확정 2026-11-03 「직전 알림톡도 같이 읽어서 이미 봤던 것은 패스」):
     *   ① 글 전체가 같으면(id) 버린다 — 앱은 대화방을 열 때마다 위로 2페이지까지 다시 읽어 보낸다.
     *   ② 글이 달라도 특보 줄(구역·종류·시각·동작)이 이미 본 것이면 새것으로 치지 않는다 — 알림 글(200자에서 잘림)과 전문이 겹친다.
     * 처음 보는 줄은 둘로 나눈다:
     *   newWarnings    = 「이번 알림」 글(trigger)의 줄 — 앱이 방금 뜬 알림과 앞부분이 같은 말풍선에 trigger 를 붙인다.
     *   missedWarnings = 함께 읽힌 직전 글에서 나온 처음 보는 줄 — 통신이 끊겨 놓쳤다가 나중에 읽힌 것일 수 있다.
     *     이미 지난 특보일 수 있어 「새 특보」로 쓰지 않는다(상태 확인용). 나중에 같은 글이 trigger 로 오면 newWarnings 로 올린다.
     * 태풍 줄(mmisOnly)·모르는 동작어·모르는 구역은 새것/놓친 것에 넣지 않는다. 모르는 구역은 관리자에게 알린다.
     * 예: storeMessages([{text, source:'screen', trigger:true}], 'phone') → {added:1, duplicate:0, promoted:0, new:[rec]}
     * @param {Array<{text:string, source?:string, trigger?:boolean}>} items  trigger 가 없으면(옛 앱) true 로 본다.
     * @param {string} device @param {Date} [now]
     * [연계] ← routes/kakao_relay POST /messages / → parseWarnings · checkMmis(대조 대기열 pending)
     */
    function storeMessages(items, device, now = new Date()) {
        const db = load();
        const byId = new Map(db.messages.map((x) => [x.id, x]));
        const seenIds = new Set(db.seenIds || []);
        const seen = new Set(db.seenKeys || []);
        db.pending = db.pending || [];
        db.alerts = db.alerts || [];
        const added = [];
        let duplicate = 0, promoted = 0;
        const fresh = (w) => now.getTime() - Date.parse(w.until || w.at) <= STALE_WARNING_MS;
        const usable = (w) => w.zoneKnown && !w.mmisOnly && w.action !== 'unknown';
        for (const it of items) {
            const text = String((it && it.text) || '').trim();
            if (!text) continue;
            const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
            const trigger = !(it && it.trigger === false);
            const old = byId.get(id);
            if (old || seenIds.has(id)) {
                duplicate++;
                // 함께 읽힌 글로 먼저 들어왔던 것이 나중에 「이번 알림」으로 오면 놓친 줄을 새 줄로 올린다(동시에 여러 개 온 경우).
                if (old && trigger && !old.trigger && (old.missedWarnings || []).length) {
                    old.newWarnings = (old.newWarnings || []).concat(old.missedWarnings.filter(fresh));
                    old.missedWarnings = [];
                    old.trigger = true;
                    old.promotedAt = now.toISOString();
                    queuePending(db, old.newWarnings, now);
                    promoted++;
                }
                continue;
            }
            seenIds.add(id);
            const rec = {
                id, text, trigger,
                source: it.source === 'notification' ? 'notification' : 'screen',
                device: String(device || ''),
                receivedAt: now.toISOString(),
                warnings: parseWarnings(text, now),
                newWarnings: [], missedWarnings: [],
            };
            for (const w of rec.warnings) {
                const key = warningKey(w);
                if (seen.has(key) || !usable(w)) continue;
                seen.add(key);
                (trigger ? (fresh(w) ? rec.newWarnings : []) : rec.missedWarnings).push(w);
            }
            const unknown = rec.warnings.filter((w) => !w.zoneKnown).map((w) => w.rawZone);
            if (unknown.length) {
                rec.unknownZones = unknown;
                db.alerts.push({ type: 'unknownZone', zones: unknown, text: text.slice(0, 300), at: now.toISOString(), device: rec.device });
            }
            // 특보 글인데 한 줄도 못 나눴으면 꼴이 바뀐 것이다 — 조용히 넘기지 않고 표시·기록·관리자 알림.
            if (/\[(기상|예비)특보\]/.test(text) && !rec.warnings.length) {
                rec.unparsed = true;
                db.alerts.push({ type: 'unparsed', text: text.slice(0, 300), at: now.toISOString(), device: rec.device });
                console.warn('[kakao_relay] ⚠특보 글 분해 0줄 — 알림톡 꼴 확인 필요:', id);
            }
            queuePending(db, rec.newWarnings, now);
            db.messages.push(rec);
            byId.set(id, rec);
            added.push(rec);
        }
        if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
        db.seenKeys = [...seen].slice(-MAX_SEEN_KEYS);
        db.seenIds = [...seenIds].slice(-MAX_SEEN_IDS);
        if (added.length || promoted) save(db);
        return { added: added.length, duplicate, promoted, new: added };
    }

    /**
     * 「이미 봤음」 기억을 미리 채운다 — 긁어온 옛 알림톡을 넣으면 처음 대화방을 읽을 때 옛 글이 새 특보로 잡히지 않는다
     * (2026-11-03 첫 실측에서 전날 19시 특보 2건이 새것으로 잡혔다). 글은 저장하지 않고 id·특보 줄 열쇠만 기억한다.
     * 예: seed(['…', '…']) → {ids:593, keys:2079}
     * [연계] ← routes/kakao_relay POST /api/kakao-relay/seed
     */
    function seed(texts, now = new Date()) {
        const db = load();
        const seenIds = new Set(db.seenIds || []), seen = new Set(db.seenKeys || []);
        let ids = 0, keys = 0;
        for (const t of texts) {
            const text = String(t || '').trim();
            if (!text) continue;
            const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
            if (!seenIds.has(id)) { seenIds.add(id); ids++; }
            for (const w of parseWarnings(text, now)) {
                const k = warningKey(w);
                if (!seen.has(k)) { seen.add(k); keys++; }
            }
        }
        db.seenIds = [...seenIds].slice(-MAX_SEEN_IDS);
        db.seenKeys = [...seen].slice(-MAX_SEEN_KEYS);
        save(db);
        return { ids, keys, totalIds: db.seenIds.length, totalKeys: db.seenKeys.length };
    }

    /** 대조 대기열·관리자 알림 대기열을 다루는 checkMmis 용 — 읽고 고친 뒤 저장. */
    function update(fn) {
        const db = load();
        const r = fn(db);
        save(db);
        return r;
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
        return {
            heartbeat: db.heartbeat, messages: db.messages.slice(-n).reverse(),
            pending: db.pending || [], checks: (db.checks || []).slice(-50).reverse(),
            seen: { ids: (db.seenIds || []).length, keys: (db.seenKeys || []).length },
        };
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

    return { storeMessages, seed, update, heartbeat, snapshot, lastHeartbeat, storeBackfill, backfillAll, clearBackfill };
}

/**
 * 특보 줄의 비교 열쇠. 예: {zoneKey:'서해남부먼바다', kind:'풍랑주의보', at:'2026-11-02T19:00+09:00', action:'발효'}
 *   → '서해남부먼바다|풍랑주의보|2026-11-02T19:00+09:00|발효'
 * [연계] ← storeMessages
 */
function warningKey(w) {
    return [w.zoneKey || String(w.zone).replace(/\s+/g, ''), w.kind, w.at, w.until || '', w.action].join('|');
}

/**
 * 특보현황(MMIS)과 대조할 줄을 대기열에 넣는다. 대상: 「이번 알림」의 풍랑 정식 특보 줄 중 **부모 해역**만
 * (자식 해역은 MMIS 쪽 구조가 달라 오탐이 많다 — 부모가 맞으면 자식도 같은 글에 함께 온다).
 * [연계] ← storeMessages / → checkMmis
 */
function queuePending(db, ws, now) {
    for (const w of ws) {
        if (w.section !== '기상특보' || w.parent || w.type !== '풍랑') continue;
        db.pending.push({
            key: warningKey(w), zone: w.zone, kind: w.kind, level: w.level, action: w.action, at: w.at,
            receivedAt: now.toISOString(), status: 'wait',
        });
    }
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

// ── 카톡 ↔ 특보현황(MMIS) 대조 (사용자 확정 2026-11-03: 「10분」 동의, 「관리자 푸시는 이해가기 쉽게」) ──────────
//   카톡으로 받은 풍랑 특보(부모 해역)가 10분이 지나도 특보현황(MMIS, data/weather_alerts.json)에 반영되지 않으면
//   관리자에게 알린다. 나중에 따라오면 「같아짐」을 한 번 더 알린다. 6시간 넘게 안 맞으면 대조를 그만두고 기록만 남긴다.
//   이 단계는 기록·알림만 한다 — 특보현황·사용자 푸시는 바꾸지 않는다.
const MMIS_WAIT_MS = 10 * 60e3;
const MMIS_GIVE_UP_MS = 6 * 3600e3;
const MAX_CHECKS = 200;

/** 'YYYY년 MM월 DD일 HH시 MM분' → '…T HH:MM+09:00'. 못 읽으면 null. */
function mmisIso(str) {
    const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/.exec(String(str || ''));
    return m ? `${m[1]}-${p2(m[2])}-${p2(m[3])}T${p2(m[4])}:${p2(m[5])}+09:00` : null;
}
/** ISO(+09:00) → 'MM/DD HH:MM'. */
function fmtK(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return String(iso || '?');
    const k = new Date(t + 9 * 3600e3).toISOString();
    return k.slice(5, 10).replace('-', '/') + ' ' + k.slice(11, 16);
}

/** weather_alerts.json 의 current 트리에서 해역 이름 → 노드({current, upcoming}) 표. */
function mmisZones(alerts) {
    const out = {};
    (function walk(o, name) {
        if (!o || typeof o !== 'object') return;
        if ('current' in o && 'history' in o) { out[name] = o; return; }
        for (const [k, v] of Object.entries(o)) walk(v, k);
    })(alerts && alerts.current, '');
    return out;
}

/**
 * 카톡 한 줄이 특보현황(MMIS)에 반영됐는가.
 * 예: 카톡 「풍랑주의보 11월 03일 03시 00분 해제」 ↔ MMIS 해제예고 '2026년 11월 03일 03시 00분' → true
 *     카톡 「풍랑주의보 … 연장」 ↔ MMIS 발표시각이 카톡 도착 90분 전보다 이전(옛 발표 그대로) → false
 * 판정:
 *   발효·변경·연장: 특보현황에 같은 종류·등급(풍랑·주의보/경보)이 있고, 발효시각이나 발표시각이 카톡 시각과 같거나,
 *                  발표시각이 카톡 도착 90분 전 이후(=같은 발표를 이미 받음)일 때.
 *   해제: 특보현황에 풍랑이 없거나, 해제시각/해제예고가 카톡 시각과 정확히 같을 때.
 *   변경해제: 특보현황의 풍랑 경보가 사라졌거나(태풍 등으로 바뀜) 해제시각이 같을 때.
 * @param {object} p - 대기 줄 @param {object|undefined} node - mmisZones()[해역]
 * @returns {boolean}
 * [연계] ← checkMmis
 */
function mmisMatches(p, node) {
    if (!node) return false;
    const blocks = [node.current, node.upcoming].filter(Boolean);
    const wave = blocks.filter((b) => /풍랑/.test(String(b.wrnTpNm || b.wrnTp || '')));
    const lvl = (b) => String(b.wrnLvlNm || b.wrnLvl || '');
    if (p.action === '해제' || p.action === '변경해제') {
        const target = p.action === '변경해제' ? wave.filter((b) => lvl(b) === p.level) : wave;
        if (!target.length) return true;
        return target.some((b) => mmisIso(b.tmYn) === p.at || mmisIso(b.clrNtcTm) === p.at);
    }
    const since = Date.parse(p.receivedAt) - 90 * 60e3;
    return wave.some((b) => lvl(b) === p.level && (
        mmisIso(b.tmEf) === p.at || mmisIso(b.tmFc) === p.at || Date.parse(mmisIso(b.tmFc)) >= since));
}

/** 특보현황의 그 해역 상태를 사람이 읽는 한 줄로. */
function describeMmis(node) {
    const b = node && (node.current || node.upcoming);
    if (!b) return '특보 없음';
    const parts = [String(b.wrnTpNm || b.wrnTp || '') + String(b.wrnLvlNm || b.wrnLvl || '')];
    if (b.tmEf) parts.push('발효 ' + fmtK(mmisIso(b.tmEf)));
    const clr = b.tmYn || b.clrNtcTm || b.tmCc;
    parts.push('해제예고 ' + (clr ? (mmisIso(clr) ? fmtK(mmisIso(clr)) : clr) : '없음'));
    if (b.tmFc) parts.push('발표 ' + fmtK(mmisIso(b.tmFc)));
    return parts.join(' · ');
}

/** 운영에서만 관리자 푸시(개발은 콘솔 한 줄). collect_fail_alert.defaultSend 와 같은 규칙. */
async function defaultAdminSend(title, body, data) {
    if (!process.env.FLY_ALLOC_ID) {
        console.log('[kakao_relay] 개발 환경 — 관리자 푸시 생략: ' + title + ' / ' + body.replace(/\n/g, ' | '));
        return { delivered: false, error: '개발 환경' };
    }
    const r = await require('./admin_push').sendAdminPush(title, body, data);
    return r && r.sent > 0 ? { delivered: true } : { delivered: false, error: '전달 0건' };
}

/**
 * 1분마다 부른다. ① 대조 대기열을 특보현황과 맞춰 보고 10분째 다르면 알림, 나중에 같아지면 「같아짐」 알림.
 * ② 모르는 구역·분해 실패 알림을 보낸다. 보낸 알림은 checks 에 같은 문장으로 남긴다(관리자 기록).
 * 전달되지 않으면 상태를 바꾸지 않아 다음 회차에 다시 보낸다.
 * @returns {Promise<{sent:number, mismatched:number, resolved:number}>}
 * [연계] ← scheduler.js 1분 마스터 / → mmisMatches · describeMmis · admin_push
 */
async function checkMmis({
    store = createStore(), now = Date.now(), send = defaultAdminSend,
    readAlerts = () => JSON.parse(fs.readFileSync(path.join(require('../config/server_config').DATA_DIR, 'weather_alerts.json'), 'utf8')),
    enabled = !!process.env.KAKAO_RELAY_TOKEN,
} = {}) {
    if (!enabled) return null;
    let zones;
    try { zones = mmisZones(readAlerts()); }
    catch (e) { console.warn('[kakao_relay] 특보현황 읽기 실패 — 대조 건너뜀:', e.message); return null; }
    const snap = store.snapshot(0);
    const pending = snap.pending || [];
    const db0 = { alerts: [] };
    store.update((db) => { db0.alerts = db.alerts || []; return null; });
    const mism = [], res = [], drop = [];
    for (const p of pending) {
        const node = zones[p.zone];
        const ok = mmisMatches(p, node);
        const age = now - Date.parse(p.receivedAt);
        if (ok) { if (p.status === 'alerted') res.push({ p, node }); else drop.push({ p, why: 'matched' }); }
        else if (age > MMIS_GIVE_UP_MS) drop.push({ p, why: 'expired', node });
        else if (age >= MMIS_WAIT_MS && p.status === 'wait') mism.push({ p, node });
    }
    const msgs = [];
    const line = (p) => `${p.zone} ${p.kind} 「${p.action}」 ${fmtK(p.at)}`;
    if (mism.length) {
        msgs.push({
            kind: 'mismatch', items: mism,
            title: `⚠ 카톡 특보가 특보현황에 ${Math.round(MMIS_WAIT_MS / 60e3)}분째 반영 안 됨 (${mism.length}곳)`,
            body: mism.map(({ p, node }) =>
                `• ${line(p)}\n  카톡 도착 ${fmtK(p.receivedAt)}\n  지금 특보현황(MMIS): ${describeMmis(node)}`).join('\n')
                + '\n→ 앱 특보현황이 예전 정보일 수 있습니다. 기상청 통보문으로 어느 쪽이 맞는지 확인해 주세요.',
        });
    }
    if (res.length) {
        msgs.push({
            kind: 'resolved', items: res,
            title: `✅ 특보현황이 카톡과 같아짐 (${res.length}곳)`,
            body: res.map(({ p, node }) => `• ${line(p)}\n  ${fmtK(new Date(now).toISOString())}에 특보현황도 반영 (카톡보다 약 ${Math.round((now - Date.parse(p.receivedAt)) / 60e3)}분 늦음)\n  지금 특보현황: ${describeMmis(node)}`).join('\n'),
        });
    }
    for (const a of db0.alerts) {
        msgs.push(a.type === 'unknownZone' ? {
            kind: 'alert', alert: a,
            title: '❓ 카톡 특보에 모르는 구역 이름',
            body: `「${a.zones.join('」, 「')}」 — 우리 구역표(93곳)에 없는 이름입니다. 이 줄은 기록만 하고 대조·반영에서 뺐습니다.\n원문: ${a.text.replace(/\s+/g, ' ').slice(0, 160)}\n→ 새 별칭이 필요한지 확인해 주세요.`,
        } : {
            kind: 'alert', alert: a,
            title: '❓ 카톡 특보 글을 읽지 못함',
            body: `특보 글인데 구역·시각을 한 줄도 나누지 못했습니다(알림톡 꼴이 바뀌었을 수 있음).\n원문: ${a.text.replace(/\s+/g, ' ').slice(0, 160)}`,
        });
    }
    const delivered = [];
    for (const m of msgs) {
        let r;
        try { r = await send(m.title, m.body, { kind: 'kakao_relay_' + m.kind }); }
        catch (e) { r = { delivered: false, error: String(e && e.message).slice(0, 60) }; }
        if (r && r.delivered) delivered.push(m);
        else console.warn('[kakao_relay] 관리자 알림 미전달(다음 회차 재시도):', m.title, r && r.error);
    }
    const nowIso = new Date(now).toISOString();
    store.update((db) => {
        const keyOf = (p) => p.key + '@' + p.receivedAt;
        const byKey = new Map((db.pending || []).map((p) => [keyOf(p), p]));
        db.checks = db.checks || [];
        for (const { p, why, node } of drop) {
            byKey.delete(keyOf(p));
            if (why === 'expired') db.checks.push({ at: nowIso, kind: 'expired', title: '대조 종료(6시간 동안 다름)', body: `${line(p)} / 특보현황: ${describeMmis(node)}` });
        }
        for (const m of delivered) {
            db.checks.push({ at: nowIso, kind: m.kind, title: m.title, body: m.body });
            if (m.kind === 'mismatch') for (const { p } of m.items) { const q = byKey.get(keyOf(p)); if (q) { q.status = 'alerted'; q.alertedAt = nowIso; } }
            if (m.kind === 'resolved') for (const { p } of m.items) byKey.delete(keyOf(p));
            if (m.kind === 'alert') db.alerts = (db.alerts || []).filter((a) => a !== m.alert && !(a.at === m.alert.at && a.text === m.alert.text));
        }
        db.pending = [...byKey.values()];
        db.checks = db.checks.slice(-MAX_CHECKS);
        return null;
    });
    return { sent: delivered.length, mismatched: mism.length, resolved: res.length };
}

module.exports = { parseWarnings, canonZone, createStore, warningKey, judgeHealth, checkHealth, checkMmis, mmisMatches, describeMmis, mmisIso, MAX_MESSAGES, ACTIONS, HEARTBEAT_STALE_MS, MMIS_WAIT_MS };
