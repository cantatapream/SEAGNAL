/**
 * ============================================================================
 * 파일명: local_server/services/kakao_relay.js
 * 역할  : 태블릿 전용 앱(kakao_relay_app)이 카카오톡 「기상청 해양기상정보포털」 알림톡에서 읽어 보낸
 *         글을 받아, 특보 한 줄씩(구역·종류·시각·발효/해제)으로 나누고 파일에 쌓는다.
 *         지금은 "받아서 기록"까지만 한다 — 푸시 발송 경로(MMIS)에는 아직 연결하지 않았다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/server_config(DATA_DIR)
 *  - 서버 API      : 없음(routes/kakao_relay.js 가 부른다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/kakao_relay.js · 검사 scripts/test_kakao_relay.js
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');

const MAX_MESSAGES = 300;

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
        out.push({
            // 「…바\n다」처럼 화면 폭에서 끊긴 공백은 없애고, 「…앞바다중 북동연안바다」의 원래 띄어쓰기는 남긴다.
            zone: m[1].trim().replace(/(?<!중)\s+/g, ''),
            kind: m[2],
            at: `${year}-${p(mon)}-${p(day)}T${p(m[5])}:${p(m[6])}+09:00`,
            action: m[7],
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
function createStore({ file } = {}) {
    if (!file) file = path.join(require('../config/server_config').DATA_DIR, 'kakao_relay.json');

    function load() {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) {
            if (e.code !== 'ENOENT') console.warn('[kakao_relay] 저장 파일 읽기 실패:', e.message);
            return { messages: [], heartbeat: null };
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
            db.messages.push(rec);
            added.push(rec);
        }
        if (db.messages.length > MAX_MESSAGES) db.messages = db.messages.slice(-MAX_MESSAGES);
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
        save(db);
    }

    /** 관리자 확인용 — 마지막 신호와 최근 글 n개. */
    function snapshot(n = 50) {
        const db = load();
        return { heartbeat: db.heartbeat, messages: db.messages.slice(-n).reverse() };
    }

    return { storeMessages, heartbeat, snapshot };
}

module.exports = { parseWarnings, createStore, MAX_MESSAGES };
