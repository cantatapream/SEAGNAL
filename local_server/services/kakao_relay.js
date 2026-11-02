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
/** 「이미 봤음」 기억은 최근 3일치만 둔다(사용자 확정 2026-11-03 「계속 누적시킬 필요가 있을까」).
 *  같은 특보가 알림 글·대화방 전문·두 기기로 겹쳐 오는 건 몇 분~몇 시간 안의 일이다. 그보다 옛 글은
 *  기준점(anchor — 마지막으로 본 글) 덕분에 앱이 다시 읽지 않는다. */
const SEEN_TTL_MS = 3 * 24 * 3600e3;
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
            if (e.code === 'ENOENT') return { messages: [], heartbeat: null, heartbeatAt: null, seenKeys: {} };
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
    function storeMessages(items, device, now = new Date(), meta = {}) {
        const db = load();
        // 관리자가 끈·지운 기기의 글은 받지 않는다(사용자 확정 2026-11-03 3단계 「휴대폰 거를 관리자 페이지에서 삭제하고 태블릿 것만」).
        const dev = touchDevice(db, device, now);
        if (dev.state !== 'on') { save(db); return { added: 0, duplicate: 0, promoted: 0, ignored: items.length, new: [], anchor: db.anchor ? db.anchor.id : null }; }
        dev.lastMessageAt = now.toISOString();
        const byId = new Map(db.messages.map((x) => [x.id, x]));
        const seenIds = timedSet(db.seenIds, now);
        const seen = timedSet(db.seenKeys, now);
        // 「놓친 글」로만 본 줄의 열쇠 — 그 줄이 나중에 「이번 알림」 글(다른 글이어도)에 나오면 새 특보로 올린다(적대검증 M6).
        const missedKeys = timedSet(db.missedKeys, now);
        db.pending = db.pending || [];
        db.alerts = db.alerts || [];
        // 한 묶음 안에서는 「이번 알림」 글을 먼저 본다(앱은 화면 글 → 전문 → 위 페이지 순으로 보낸다 — M6).
        items = [...items].sort((x, y) => (y && y.trigger === false ? 0 : 1) - (x && x.trigger === false ? 0 : 1));
        const missedLines = [];
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
                    for (const w of old.missedWarnings) missedKeys.delete(warningKey(w));
                    old.missedWarnings = [];
                    old.trigger = true;
                    old.promotedAt = now.toISOString();
                    queuePending(db, old.newWarnings, now);
                    promoted++;
                }
                continue;
            }
            seenIds.add(id);
            if (it.newest) db.anchor = { id, at: now.toISOString(), device: String(device || '') };
            const rec = {
                id, text, trigger,
                source: it.source === 'notification' ? 'notification' : 'screen',
                device: String(device || ''),
                receivedAt: now.toISOString(),
                warnings: parseWarnings(text, now),
                newWarnings: [], missedWarnings: [],
            };
            // 알림 글은 200자에서 잘려 온다(2026-11-03 실측) — 끝에 닿은 마지막 줄은 동작어가 잘렸을 수 있어
            //   (「변경해제」→「변경」) 쓰지 않는다. 같은 줄은 대화방 전문으로 다시 온다(적대검증 M5).
            const cutTail = rec.source === 'notification' && text.length >= 190 ? rec.warnings[rec.warnings.length - 1] : null;
            for (const w of rec.warnings) {
                if (w === cutTail) { w.cutTail = true; continue; }
                const key = warningKey(w);
                if (!usable(w)) continue;
                if (seen.has(key)) {
                    if (trigger && missedKeys.has(key) && fresh(w)) { missedKeys.delete(key); rec.newWarnings.push(w); }
                    continue;
                }
                seen.add(key);
                if (trigger) { if (fresh(w)) rec.newWarnings.push(w); }
                else { rec.missedWarnings.push(w); missedKeys.add(key); if (fresh(w)) missedLines.push(`${w.zone} ${w.kind} 「${w.action}」 ${w.until ? w.at.slice(5, 16).replace('T', ' ') + '~' + w.until.slice(11, 16) : w.at.slice(5, 16).replace('T', ' ')}`); }
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
        // 기준점(마지막으로 본 글)을 화면에서 찾지 못하고 끝까지(최대 끌기) 올라갔다 — 그 사이 글을 놓쳤을 수 있다.
        if (meta.anchor === 'missing') db.alerts.push({ type: 'anchorMissing', at: now.toISOString(), device: String(device || ''), text: 'anchorMissing' });
        // 「이번 알림」으로 이미 아는 글이 다시 맨 아래에 있으면(중복) 기준점만 옮긴다.
        for (const it of items) {
            if (!it || !it.newest) continue;
            const id = crypto.createHash('sha256').update(String(it.text || '').trim()).digest('hex').slice(0, 16);
            if (seenIds.has(id)) db.anchor = { id, at: now.toISOString(), device: String(device || '') };
        }
        // 24시간 안의 놓친 줄은 관리자에게 알린다 — 알림을 못 받고 대화방에서만 발견된 특보(적대검증 M7).
        if (missedLines.length) db.alerts.push({ type: 'missed', lines: missedLines.slice(0, 20), at: now.toISOString(), device: String(device || ''), text: missedLines.join('|') });
        db.alerts = db.alerts.slice(-MAX_ALERTS);
        if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
        db.seenKeys = seen.dump(MAX_SEEN_KEYS);
        db.seenIds = seenIds.dump(MAX_SEEN_IDS);
        db.missedKeys = missedKeys.dump(MAX_SEEN_KEYS);
        save(db);
        return { added: added.length, duplicate, promoted, new: added, anchor: db.anchor ? db.anchor.id : null };
    }

    /**
     * 「이미 봤음」 기억을 미리 채운다 — 긁어온 옛 알림톡을 넣으면 처음 대화방을 읽을 때 옛 글이 새 특보로 잡히지 않는다
     * (2026-11-03 첫 실측에서 전날 19시 특보 2건이 새것으로 잡혔다). 글은 저장하지 않고 id·특보 줄 열쇠만 기억한다.
     * 예: seed(['…', '…']) → {ids:593, keys:2079}
     * [연계] ← routes/kakao_relay POST /api/kakao-relay/seed
     */
    function seed(texts, now = new Date()) {
        const db = load();
        const seenIds = timedSet(db.seenIds, now), seen = timedSet(db.seenKeys, now);
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
        db.seenIds = seenIds.dump(MAX_SEEN_IDS);
        db.seenKeys = seen.dump(MAX_SEEN_KEYS);
        save(db);
        return { ids, keys, totalIds: Object.keys(db.seenIds).length, totalKeys: Object.keys(db.seenKeys).length };
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
        const dev = touchDevice(db, info.device, now);
        dev.beat = { ...info, at: now.toISOString() };
        db.heartbeat = dev.beat;   // 마지막으로 들어온 신호(옛 화면·검사 호환)
        // 데이터 수집현황 카드가 읽는 맨 위 칸(목록표 kakaoRelay 의 collectedField) — 켜진 기기 중 가장 최근 신호.
        db.heartbeatAt = Object.values(db.devices).filter((d) => d.state === 'on' && d.beat)
            .map((d) => d.beat.at).sort().pop() || null;
        save(db);
        return db.anchor ? db.anchor.id : null;
    }

    /** 켜진 기기들의 마지막 신호(멈춤 감시는 기기마다 따로 본다). [{device, beat}] */
    function deviceBeats() {
        const db = load();
        return Object.entries(db.devices || {}).filter(([, d]) => d.state === 'on').map(([name, d]) => ({ device: name, beat: d.beat || null }));
    }

    /**
     * 관리자가 기기를 끄기·켜기·지우기. 지운 기기는 목록에서 빠지고, 다시 보내도 「지운 기기」로 남아 받지 않는다(켜기로 되살림).
     * 예: setDevice('phone', 'remove') → {ok:true, state:'removed'}
     * [연계] ← routes/kakao_relay POST /api/admin/kakao-relay/device
     */
    function setDevice(name, action, now = new Date()) {
        const db = load();
        const d = touchDevice(db, name, now);
        d.state = action === 'enable' ? 'on' : action === 'disable' ? 'off' : action === 'remove' ? 'removed' : d.state;
        d.changedAt = now.toISOString();
        db.heartbeatAt = Object.values(db.devices).filter((x) => x.state === 'on' && x.beat).map((x) => x.beat.at).sort().pop() || null;
        save(db);
        return { ok: true, device: name, state: d.state };
    }

    /** 관리자 확인용 — 마지막 신호와 최근 글 n개. */
    function snapshot(n = 50) {
        const db = load();
        return {
            heartbeat: db.heartbeat, devices: db.devices || {}, messages: db.messages.slice(-n).reverse(),
            pending: db.pending || [], checks: (db.checks || []).slice(-50).reverse(),
            seen: { ids: Object.keys(timedSet(db.seenIds, new Date()).dump(MAX_SEEN_IDS)).length, keys: Object.keys(timedSet(db.seenKeys, new Date()).dump(MAX_SEEN_KEYS)).length },
            anchor: db.anchor || null,
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

    return { storeMessages, seed, update, heartbeat, deviceBeats, setDevice, snapshot, lastHeartbeat, storeBackfill, backfillAll, clearBackfill };
}

/**
 * 기한(3일)이 있는 「이미 봤음」 집합. 저장 꼴은 {열쇠: 처음 본 시각}. 옛 저장 꼴(배열)은 지금 시각으로 옮긴다.
 * 예: const s = timedSet(db.seenKeys, now); s.has(k); s.add(k); db.seenKeys = s.dump(8000)
 */
function timedSet(stored, now) {
    const nowMs = now.getTime(), nowIso = now.toISOString();
    const m = new Map();
    if (Array.isArray(stored)) for (const k of stored) m.set(k, nowIso);
    else if (stored && typeof stored === 'object') for (const [k, at] of Object.entries(stored)) if (nowMs - Date.parse(at) <= SEEN_TTL_MS) m.set(k, at);
    return {
        has: (k) => m.has(k),
        add: (k) => { if (!m.has(k)) m.set(k, nowIso); },
        delete: (k) => m.delete(k),
        get size() { return m.size; },
        /** 기한 안의 것만, 최근 순으로 최대 n개를 객체로. */
        dump: (n) => Object.fromEntries([...m.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).slice(-n)),
    };
}

/** 기기 기록을 꺼내거나 새로 만든다(처음 보는 기기는 「켜짐」). 예: touchDevice(db, 'phone') → {state:'on', firstSeen, …} */
function touchDevice(db, name, now) {
    db.devices = db.devices || {};
    const key = String(name || '').trim().slice(0, 40) || '(이름 없음)';
    if (!db.devices[key]) db.devices[key] = { state: 'on', firstSeen: now.toISOString() };
    return db.devices[key];
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
        // 같은 해역에 더 새 카톡 줄이 오면 옛 대기 줄은 대체됐다 — 조용히 닫고 기록만(적대검증 H3: 옛 「해제 03:00」이
        //   새 「해제 06:00」 뒤에도 남아 오탐 알림을 내던 문제).
        db.checks = db.checks || [];
        db.pending = db.pending.filter((q) => {
            if (q.zone !== w.zone) return true;
            db.checks.push({ at: now.toISOString(), kind: 'superseded', title: '대조 대체(같은 해역에 새 카톡 줄)', body: `${q.zone} ${q.kind} 「${q.action}」 ${q.at} → ${w.kind} 「${w.action}」 ${w.at}` });
            return false;
        });
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
        // 기기마다 따로 판정한다(휴대폰·태블릿 신호가 섞이지 않게). 하나라도 이상이면 「이상」, 사유에 기기 이름을 붙인다.
        //   신호를 한 번도 안 보낸 기기·끈 기기는 판정하지 않는다.
        const vs = store.deviceBeats().map(({ device, beat }) => ({ device, v: judgeHealth(beat, now) })).filter((x) => x.v);
        const bad = vs.filter((x) => !x.v.ok);
        v = !vs.length ? null : bad.length ? { ok: false, reason: bad.map((x) => `[${x.device}] ${x.v.reason}`).join(' · ') } : { ok: true };
    } catch (e) {
        v = { ok: false, reason: '저장 파일 읽기 실패 — ' + e.message.slice(0, 60) };
    }
    if (!v) return null;
    await alert.report('kakaoRelay', v.ok ? { ok: true } : { ok: false, error: { plainReason: v.reason } });
    return v;
}

// ── 카톡 ↔ 특보현황(MMIS) 대조 (사용자 확정 2026-11-03: 「10분」 동의, 「관리자 푸시는 이해가기 쉽게」) ──────────
//   카톡으로 받은 풍랑 특보(부모 해역)가 10분이 지나도 특보현황(MMIS, data/weather_alerts.json)에 반영되지 않으면
//   관리자에게 알린다. 나중에 따라오면 「같아짐」, 6시간 내내 다르면 「대조 종료」를 한 번 더 알린다.
//   이 단계는 기록·알림만 한다 — 특보현황·사용자 푸시는 바꾸지 않는다.
//   ★특보현황 쪽 칸의 뜻은 크롤러 실제 동작에 맞춘다(적대검증 2026-11-03 H1·H2 — marine_warning_crawler 로 확인):
//     · 발표됐지만 아직 발효 전인 특보는 등급이 「예비」로 실린다(toBlock: wrnLvlReal || wrnLvlNm, :3374).
//     · 발표시각(tmFc)은 처음 발표 시각으로 고정되고 변경·연장에도 안 바뀐다(_applyAnnounceAnchor, :1820).
//       그래서 「연장」은 발표시각이 아니라 **해제예고 칸이 카톡 도착 무렵 바뀌었는지**로 본다.
const MMIS_WAIT_MS = 10 * 60e3;
const MMIS_GIVE_UP_MS = 6 * 3600e3;
/** 연장 판정: 특보현황 해제예고가 카톡 도착 15분 전 이후에 바뀌었으면 같은 연장을 받은 것으로 본다(특보현황이 더 빠를 수도 있어 여유). */
const CLR_CHANGE_SLACK_MS = 15 * 60e3;
const MAX_CHECKS = 200;
const MAX_ALERTS = 50;

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

const lvlOf = (b) => String((b && (b.wrnLvlNm || b.wrnLvl)) || '');
const isWave = (b) => !!b && /풍랑/.test(String(b.wrnTpNm || b.wrnTp || ''));
/** 해제예고 칸(정확 시각이 오면 tmYn, 아니면 clrNtcTm·tmCc 범위). */
const clrOf = (b) => String((b && (b.tmYn || b.clrNtcTm || b.tmCc)) || '');

/**
 * 카톡 한 줄이 특보현황(MMIS)에 반영됐는가.
 *   발효(T): 풍랑 블록 중 발효시각이 T 이고 등급이 같거나 「예비」(발효 전 발표분)인 것이 있으면 같음.
 *   변경(등급 L, T): 등급 L(또는 발효 전이면 「예비」) 블록의 발효시각이 T 이거나, T 가 지났고 지금 발효 중 등급이 L 이면 같음.
 *   연장: 지금 발효 중 같은 등급이 있고, 그 해제예고 칸이 카톡 도착 15분 전 이후에 바뀌었으면 같음(clrSince — checkMmis 가 잰다).
 *   해제(T): 발효 중(주의보·경보) 풍랑이 없거나, 그 해제시각/해제예고가 정확히 T 이면 같음. 다음 예비는 보지 않는다.
 *   변경해제: 그 등급의 발효 중 풍랑이 없거나 해제시각이 T 이면 같음.
 * 예: 카톡 「풍랑주의보 11월 03일 03시 00분 해제」 ↔ 특보현황 해제예고 '2026년 11월 03일 03시 00분' → true
 * @param {object} p - 대기 줄 @param {object|undefined} node - mmisZones()[해역]
 * @param {number} nowMs @param {number|null} clrSinceMs - 그 해역 해제예고 칸이 지금 값이 된 시각
 * @returns {boolean}
 * [연계] ← checkMmis
 */
function mmisMatches(p, node, nowMs = Date.now(), clrSinceMs = null) {
    if (!node) return false;
    const cur = isWave(node.current) ? node.current : null;
    const blocks = [node.current, node.upcoming].filter(isWave);
    const active = cur && ['주의보', '경보'].includes(lvlOf(cur)) ? cur : null;
    if (p.action === '해제' || p.action === '변경해제') {
        if (!active || (p.action === '변경해제' && lvlOf(active) !== p.level)) return true;
        return mmisIso(active.tmYn) === p.at || mmisIso(active.clrNtcTm) === p.at;
    }
    if (p.action === '연장') {
        return !!active && lvlOf(active) === p.level && clrSinceMs != null && clrSinceMs >= Date.parse(p.receivedAt) - CLR_CHANGE_SLACK_MS;
    }
    // 발효·변경(·발표·대치)
    if (blocks.some((b) => mmisIso(b.tmEf) === p.at && (lvlOf(b) === p.level || lvlOf(b) === '예비'))) return true;
    return Date.parse(p.at) <= nowMs && !!active && lvlOf(active) === p.level;
}

/** 특보현황의 그 해역 상태를 사람이 읽는 한 줄로(발효 중 + 다가오는 것). */
function describeMmis(node) {
    const one = (b, tag) => {
        const parts = [tag + String(b.wrnTpNm || b.wrnTp || '') + lvlOf(b)];
        if (b.tmEf) parts.push('발효 ' + (mmisIso(b.tmEf) ? fmtK(mmisIso(b.tmEf)) : b.tmEf));
        const clr = clrOf(b);
        parts.push('해제예고 ' + (clr ? (mmisIso(clr) ? fmtK(mmisIso(clr)) : clr) : '없음'));
        if (b.tmFc) parts.push('처음 발표 ' + fmtK(mmisIso(b.tmFc)));
        return parts.join(' · ');
    };
    const out = [];
    if (node && node.current) out.push(one(node.current, ''));
    if (node && node.upcoming) out.push(one(node.upcoming, '다가오는 특보: '));
    return out.length ? out.join(' / ') : '특보 없음';
}

/** 카톡 줄을 사람이 읽는 한 줄로. 미래 시각의 해제는 「예고」임을 밝힌다(적대검증 L2). */
function describeLine(p, nowMs) {
    const future = Date.parse(p.at) > nowMs;
    const act = p.action === '해제' && future ? '해제 예고(그 시각에 풀림)' : p.action;
    return `${p.zone} ${p.kind} 「${act}」 ${fmtK(p.at)}`;
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

let _checking = false;   // 겹쳐 돌지 않게(푸시가 1분을 넘겨도 같은 알림이 두 번 가지 않게 — 적대검증 L4)

/**
 * 1분마다 부른다.
 *   ① 특보현황 해역별 해제예고 칸이 언제 지금 값이 됐는지 기록(연장 판정용 clrSeen).
 *   ② 대조 대기열을 특보현황과 맞춰 본다: 10분째 다르면 알림, 나중에 같아지면 「같아짐」, 6시간 내내 다르면 「대조 종료」.
 *   ③ 모르는 구역·분해 실패·놓친 글 알림을 보낸다(특보현황 파일을 못 읽어도 이건 보낸다 — 적대검증 M3).
 *   ④ 특보현황 파일을 못 읽기 시작하면 1번, 다시 읽히면 1번 알린다.
 * 보낸 알림은 checks 에 같은 문장으로 남긴다. 전달되지 않으면 상태를 바꾸지 않아 다음 회차에 다시 보낸다.
 * @returns {Promise<{sent:number, mismatched:number, resolved:number}|null>}
 * [연계] ← scheduler.js 1분 마스터 / → mmisMatches · describeMmis · admin_push
 */
async function checkMmis({
    store = createStore(), now = Date.now(), send = defaultAdminSend,
    readAlerts = () => JSON.parse(fs.readFileSync(path.join(require('../config/server_config').DATA_DIR, 'weather_alerts.json'), 'utf8')),
    enabled = !!process.env.KAKAO_RELAY_TOKEN,
} = {}) {
    if (!enabled || _checking) return null;
    _checking = true;
    try {
        let zones = null, readErr = null;
        try { zones = mmisZones(readAlerts()); }
        catch (e) { readErr = e.message; console.warn('[kakao_relay] 특보현황 읽기 실패 — 대조 건너뜀:', e.message); }
        const nowIso = new Date(now).toISOString();
        // ① 해제예고 칸 변화 기록 + 현재 대기열·알림 대기열 꺼내기
        let pending = [], alerts = [], clrSeen = {}, readFailNotified = false;
        store.update((db) => {
            db.clrSeen = db.clrSeen || {};
            if (zones) {
                for (const [z, node] of Object.entries(zones)) {
                    const v = isWave(node.current) ? clrOf(node.current) : '';
                    const prev = db.clrSeen[z];
                    if (!prev || prev.v !== v) db.clrSeen[z] = { v, since: nowIso };
                }
            }
            pending = (db.pending || []).slice();
            alerts = (db.alerts || []).slice();
            clrSeen = db.clrSeen;
            readFailNotified = !!db.mmisReadFailNotified;
            return null;
        });
        const msgs = [];
        const mism = [], res = [], expired = [], matchedQuiet = [];
        if (zones) {
            for (const p of pending) {
                const node = zones[p.zone];
                const cs = clrSeen[p.zone] ? Date.parse(clrSeen[p.zone].since) : null;
                const ok = mmisMatches(p, node, now, cs);
                const age = now - Date.parse(p.receivedAt);
                if (ok) (p.status === 'alerted' ? res : matchedQuiet).push({ p, node });
                else if (age > MMIS_GIVE_UP_MS) expired.push({ p, node });
                else if (age >= MMIS_WAIT_MS && p.status === 'wait') mism.push({ p, node });
            }
            if (mism.length) {
                const mins = Math.round(Math.min(...mism.map(({ p }) => now - Date.parse(p.receivedAt))) / 60e3);
                msgs.push({
                    kind: 'mismatch', items: mism,
                    title: `⚠ 카톡 특보가 앱 특보현황에 ${mins}분째 반영 안 됨 (${mism.length}곳)`,
                    body: mism.map(({ p, node }) =>
                        `• ${describeLine(p, now)}\n  카톡 도착 ${fmtK(p.receivedAt)}\n  지금 앱 특보현황(기상청 MMIS 수집): ${describeMmis(node)}`).join('\n')
                        + '\n→ 앱 특보현황이 예전 정보일 수 있습니다. 기상청 통보문으로 어느 쪽이 맞는지 확인해 주세요.',
                });
            }
            if (res.length) {
                msgs.push({
                    kind: 'resolved', items: res,
                    title: `✅ 앱 특보현황이 카톡과 같아짐 (${res.length}곳)`,
                    body: res.map(({ p, node }) => `• ${describeLine(p, now)}\n  ${fmtK(nowIso)} 확인 — 카톡 도착 ${fmtK(p.receivedAt)}보다 약 ${Math.round((now - Date.parse(p.receivedAt)) / 60e3)}분 뒤\n  지금 앱 특보현황: ${describeMmis(node)}`).join('\n'),
                });
            }
            if (expired.length) {
                msgs.push({
                    kind: 'expired', items: expired,
                    title: `⛔ 카톡 특보와 앱 특보현황이 6시간째 다름 — 대조 종료 (${expired.length}곳)`,
                    body: expired.map(({ p, node }) => `• ${describeLine(p, now)} (카톡 도착 ${fmtK(p.receivedAt)})\n  지금 앱 특보현황: ${describeMmis(node)}`).join('\n')
                        + '\n→ 더는 자동으로 대조하지 않습니다. 앱 특보현황이 맞는지 직접 확인해 주세요.',
                });
            }
            if (readFailNotified) msgs.push({ kind: 'readOk', title: '✅ 앱 특보현황 파일 다시 읽힘 — 카톡 대조 재개', body: `${fmtK(nowIso)}부터 카톡 특보와 앱 특보현황 대조를 다시 합니다.` });
        } else if (!readFailNotified) {
            msgs.push({ kind: 'readFail', title: '⚠ 앱 특보현황 파일을 읽지 못해 카톡 대조 중단', body: `${fmtK(nowIso)} — ${String(readErr).slice(0, 80)}\n→ 서버의 특보 수집 상태를 확인해 주세요. 다시 읽히면 알려 드립니다.` });
        }
        for (const a of alerts) {
            const body0 = `원문: ${String(a.text || '').replace(/\s+/g, ' ').slice(0, 160)}`;
            if (a.type === 'unknownZone') msgs.push({ kind: 'alert', alert: a, title: '❓ 카톡 특보에 모르는 구역 이름',
                body: `「${a.zones.join('」, 「')}」 — 앱 표준 구역표에 없는 이름입니다. 이 줄은 기록만 하고 대조·반영에서 뺐습니다.\n${body0}\n→ 새 별칭이 필요한지 확인해 주세요.` });
            else if (a.type === 'anchorMissing') msgs.push({ kind: 'alert', alert: a, title: '⚠ 중계 앱이 마지막으로 본 글을 찾지 못함',
                body: `${fmtK(a.at)} ${a.device || ''} — 대화방을 위로 끝까지(최대 끌기) 올려도 서버가 기억하는 「마지막으로 본 글」이 나오지 않았습니다.\n그 사이 특보 글을 놓쳤을 수 있습니다. 카톡 대화방을 직접 확인하거나 [긁어오기]로 채워 주세요.` });
            else if (a.type === 'missed') msgs.push({ kind: 'alert', alert: a, title: `ℹ 카톡 대화방에서 처음 보는 특보 ${a.lines.length}줄(알림은 못 받았던 글)`,
                body: a.lines.map((l) => `• ${l}`).join('\n') + `\n(${fmtK(a.at)} ${a.device || ''} 가 대화방을 읽다가 발견 — 통신이 끊겼던 사이 온 글일 수 있습니다. 이미 지난 특보일 수 있어 새 특보로는 쓰지 않았습니다.)` });
            else msgs.push({ kind: 'alert', alert: a, title: '❓ 카톡 특보 글을 읽지 못함',
                body: `특보 글인데 구역·시각을 한 줄도 나누지 못했습니다(알림톡 꼴이 바뀌었을 수 있음).\n${body0}` });
        }
        const delivered = [];
        for (const m of msgs) {
            let r;
            try { r = await send(m.title, m.body, { kind: 'kakao_relay_' + m.kind }); }
            catch (e) { console.warn('[kakao_relay] 관리자 알림 발송 예외:', e && e.message); r = { delivered: false, error: String(e && e.message).slice(0, 60) }; }
            if (r && r.delivered) delivered.push(m);
            else console.warn('[kakao_relay] 관리자 알림 미전달(다음 회차 재시도):', m.title, r && r.error);
        }
        store.update((db) => {
            const keyOf = (p) => p.key + '@' + p.receivedAt;
            const byKey = new Map((db.pending || []).map((p) => [keyOf(p), p]));
            db.checks = db.checks || [];
            for (const { p } of matchedQuiet) byKey.delete(keyOf(p));
            for (const m of delivered) {
                db.checks.push({ at: nowIso, kind: m.kind, title: m.title, body: m.body });
                if (m.kind === 'mismatch') for (const { p } of m.items) { const q = byKey.get(keyOf(p)); if (q) { q.status = 'alerted'; q.alertedAt = nowIso; } }
                if (m.kind === 'resolved' || m.kind === 'expired') for (const { p } of m.items) byKey.delete(keyOf(p));
                if (m.kind === 'readFail') db.mmisReadFailNotified = true;
                if (m.kind === 'readOk') db.mmisReadFailNotified = false;
                if (m.kind === 'alert') db.alerts = (db.alerts || []).filter((a) => !(a.at === m.alert.at && a.type === m.alert.type && a.text === m.alert.text));
            }
            db.pending = [...byKey.values()];
            db.checks = db.checks.slice(-MAX_CHECKS);
            return null;
        });
        return { sent: delivered.length, mismatched: mism.length, resolved: res.length };
    } finally {
        _checking = false;
    }
}

module.exports = { parseWarnings, canonZone, createStore, warningKey, judgeHealth, checkHealth, checkMmis, mmisMatches, describeMmis, mmisIso, MAX_MESSAGES, ACTIONS, HEARTBEAT_STALE_MS, MMIS_WAIT_MS, MAX_ALERTS };
