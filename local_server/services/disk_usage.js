/**
 * ============================================================================
 * 파일명: local_server/services/disk_usage.js
 * 역할  : 서버 저장 디스크(Fly 볼륨 — local_server/data) 사용량을 재고, 80% 를 넘으면 관리자 휴대폰에 푸시를 1통 보낸다.
 *         관리자 「저장소」 탭이 쓰는 전체·사용·남은 용량과 폴더·파일별 크기(종류별로 묶음)도 여기서 만든다.
 *         2026-11-15 사용자 결정 — 운영 디스크가 꽉 차(ENOSPC) 23:00 판 브리핑이 저장되지 못한 뒤:
 *         *"통합 관리자 센터에 "외부 저장소"라는 곳이 있는데, 그 탭 이름을 저장소로 바꾸고 그 안에서 종류별로 내용을 나눠서 표출할 수 있도록 하자.
 *          또한 80%가 넘으면 푸시 알림을 보내는 방안은 좋은 것 같아. 그리고 80%가 넘으면 그 저장소라는 곳에 n 뱃지가 붙도록 해줘."*
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : fs.statfsSync(디스크 전체·남은 용량) · services/admin_push.js sendAdminPush(80% 넘음 푸시 — 쓸 때 require)
 *                    · data/disk_usage_alert.json(푸시를 이미 보냈는지 — 서버가 다시 켜져도 같은 상태로 또 보내지 않게)
 *  - 서버 API      : routes/admin.js GET /api/admin/disk-usage(?only=summary — 뱃지용 가벼운 응답)
 *  - 나를 쓰는 곳  : routes/admin.js · server.js(운영 start — 10분마다 점검) · scripts/test_disk_usage.js
 * [로드 순서] require 부작용 없음. start() 는 운영(FLY_ALLOC_ID)에서만 점검을 켠다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
// 경고 기준 80%(사용자 결정). 다시 알림 기준 75%: 79~81% 를 오가며 점검마다 푸시가 반복되지 않게 — 75% 아래로 내려갔다가 다시 80% 를 넘을 때만 또 보낸다.
const WARN_PCT = 80, REARM_PCT = 75, CHECK_MS = 10 * 60000;

/**
 * 디스크 전체·사용·남은 용량. 사용률은 df 와 같은 식(사용 ÷ (사용 + 일반 사용자가 쓸 수 있는 남은 양))·같은 올림(정수 %) — 운영 df 「2.0G 947M 928M 51%」와 같은 값이 나오게.
 *   올림인 까닭(독립 검토 3): 반올림이면 실제 79.0~79.9% 에서 df 는 80% 인데 푸시·뱃지가 안 뜬다. usable = 사용 + 남은 양(예약 블록 뺀 「쓸 수 있는 크기」 — 화면 게이지 분모).
 * 예: measure('/app/local_server/data') → {total:2.0e9, used:9.9e8, avail:9.7e8, usable:1.96e9, pct:51}
 * @param {string} dir @param {Function} [statfs] - 시험용 @returns {{total:number, used:number, avail:number, pct:number}} [연계] ← check·snapshot
 */
function measure(dir, statfs = fs.statfsSync) {
    const s = statfs(dir), bs = Number(s.bsize);
    const total = Number(s.blocks) * bs, free = Number(s.bfree) * bs, avail = Number(s.bavail) * bs, used = total - free;
    return { total, used, avail, usable: used + avail, pct: used + avail > 0 ? Math.ceil((used * 100) / (used + avail)) : 0 };
}

// 종류(이름으로 나눔 — data/ 바로 아래 이름 기준). 위에서부터 처음 맞는 것. 맞는 것이 없으면 「기타」.
// 이름만 보고 나누므로 틀릴 수 있다 — 화면은 종류 아래에 실제 이름을 함께 보인다.
const CATEGORIES = [
    ['고정 참조 자료(수심 원본)', /^bathymetry$/],
    ['AI 브리핑', /^station_briefing$/],
    ['위험예측', /^risk_forecast$/],
    ['특보·기상·해양', /^(weather_alerts|warnings|zone_forecasts|forecast_cache|gale_warnings|alert_|khoa|regional_forecast|tide_field|hazard_rocks|marine|mmis|kma|beach_weather|sea_|typhoon|smallzone)|_index\b/],
    ['법령·챗봇(나리야)', /^(law_|legal_|admrul_|ordin_|amendment_|nariya|nrya|\.codex)/],
    ['카톡 중계', /^kakao/],
    ['서버 기록(로그)', /^server_logs$|\.log$/],
    ['사용자·운영', /^(subscriptions|usage_stats|visitors|uploads|promo|notices?|survey|custom_push|boards|comment|report|admin_|api_config|active_lifecycle|collect_cache)/],
];
/** 이름의 종류. 예: 'bathymetry' → '고정 참조 자료(수심 원본)' · 'foo.json' → '기타'. @param {string} name @returns {string} [연계] ← breakdown */
function categoryOf(name) { for (const [c, re] of CATEGORIES) if (re.test(name)) return c; return '기타'; }

/**
 * 파일·폴더 하나가 디스크에서 차지하는 크기(du 처럼 블록 기준 — 블록 수가 없으면 글자 크기)와 파일 수. 바로 가기(심볼릭 링크)는 따라가지 않는다. 못 읽는 것은 건너뛴다.
 * @param {string} p @returns {{bytes:number, files:number}} [연계] ← breakdown
 */
function sizeOf(p) {
    let st; try { st = fs.lstatSync(p); } catch (_) { return { bytes: 0, files: 0 }; }
    const own = Number.isFinite(st.blocks) && st.blocks > 0 ? st.blocks * 512 : st.size;
    if (!st.isDirectory()) return { bytes: own, files: st.isFile() ? 1 : 0 };
    let bytes = own, files = 0, names = [];
    try { names = fs.readdirSync(p); } catch (_) { /* 못 읽는 폴더 */ }
    for (const n of names) { const r = sizeOf(path.join(p, n)); bytes += r.bytes; files += r.files; }
    return { bytes, files };
}
/**
 * data/ 바로 아래 이름마다 크기를 재어 종류별로 묶는다(큰 종류부터, 종류 안은 큰 것부터).
 * 예: breakdown(dir) → [{category:'고정 참조 자료(수심 원본)', bytes:6.26e8, items:[{name:'bathymetry', dir:true, bytes:6.26e8, files:59}]}, …]
 * @param {string} dir @returns {object[]} [연계] ← snapshot(관리자 화면이 열 때만 — 파일을 모두 훑으므로 점검마다 부르지 않는다)
 */
function breakdown(dir) {
    const by = new Map();
    let names = []; try { names = fs.readdirSync(dir); } catch (_) { return []; }
    for (const name of names) {
        const p = path.join(dir, name), r = sizeOf(p); let isDir = false; try { isDir = fs.lstatSync(p).isDirectory(); } catch (_) { /* 그 사이 지워짐 */ }
        const c = categoryOf(name); if (!by.has(c)) by.set(c, { category: c, bytes: 0, items: [] });
        const g = by.get(c); g.bytes += r.bytes; g.items.push({ name, dir: isDir, bytes: r.bytes, files: r.files });
    }
    const out = [...by.values()]; out.forEach((g) => g.items.sort((a, b) => b.bytes - a.bytes)); out.sort((a, b) => b.bytes - a.bytes);
    return out;
}

/**
 * 점검기를 만든다(시험은 폴더·디스크 재기·푸시·시계·상태 파일을 바꿔 넣는다).
 * @param {object} o - dir(잴 폴더 — 기본 data/)·statfs·push((title, body, data) → Promise)·clock·stateFile
 * @returns {object} check·snapshot·summary·start·stop [연계] ← forDefault·시험
 */
function createMonitor({ dir = DATA_DIR, statfs = fs.statfsSync, push = (t, b, d) => require('./admin_push').sendAdminPush(t, b, d), clock = Date.now, stateFile = path.join(DATA_DIR, 'disk_usage_alert.json') } = {}) {
    let timer = null, first = null, last = null, sending = false;   // last = 마지막 점검 {at, ok, disk|error, pushed?} · sending = 푸시 보내는 중(점검이 겹쳐도 두 통 가지 않게)
    const iso = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
    /** 알림 상태 {alerted, at, pct} — alerted = 80% 넘음 푸시가 실제로 1대 이상에 전달됨. 파일이 없거나 깨졌으면 아직 안 보냄. */
    const readState = () => { try { const j = JSON.parse(fs.readFileSync(stateFile, 'utf8')); return j && typeof j === 'object' ? j : { alerted: false }; } catch (_) { return { alerted: false }; } };
    let state = null;
    const getState = () => state || (state = readState());
    // 디스크가 꽉 찼으면 이 기록도 실패할 수 있다 — 메모리 상태는 그대로 두므로 이 서버가 켜져 있는 동안은 다시 보내지 않는다(다시 켜지면 한 번 더 갈 수 있다).
    // 임시 파일에 쓰고 이름을 바꾼다(독립 검토 8 — 쓰는 도중 끊겨 반쪽 JSON 이 남으면 「안 보냄」으로 읽혀 1통이 더 간다).
    const saveState = (s) => { state = s; const t = stateFile + '.' + process.pid + '.tmp'; try { fs.writeFileSync(t, JSON.stringify(s)); fs.renameSync(t, stateFile); } catch (e) { try { fs.unlinkSync(t); } catch (_) { /* 임시 파일이 안 생겼음 */ } console.warn('[disk_usage] 알림 상태 저장 실패:', e && e.message); } };
    // 어느 서버인지(독립 검토 7 — 스테이징도 Fly 머신이라 점검이 돈다). 운영 앱 이름이면 붙이지 않는다.
    const appTag = () => { const a = process.env.FLY_APP_NAME; return a && a !== 'seagnal-server' ? '[' + a + '] ' : ''; };
    /**
     * 한 번 잰다 — 80% 이상이고 아직 전달되지 않았으면 관리자 푸시. 1대 이상에 전달되면 그 뒤 75% 아래로 내려갈 때까지는 다시 안 보낸다.
     * 전달이 0건이거나 던지면(기기 없음·Firebase 미초기화·FCM 실패 — sendAdminPush 는 모두 {sent:0}) 「보냄」으로 적지 않고 다음 점검(10분 뒤)에 다시 보낸다
     * (독립 검토 1 — 종전엔 보내기 전에 「보냄」을 적어, 한 통도 안 갔는데 화면은 「알림 보냄」이고 다시 보내지도 않았다. CLAUDE.md L-291).
     * 재기에 실패하면 그 사실을 남긴다(화면이 「마지막 점검 실패」로 보이게).
     * 예: await check() → {at, ok:true, disk:{…, pct:83}, pushed:true}
     * @returns {Promise<object>} [연계] ← start(10분마다)·시험
     */
    async function check() {
        const now = clock();
        let disk; try { disk = measure(dir, statfs); } catch (e) { last = { at: iso(now), ok: false, error: String((e && e.code) || (e && e.message) || e).slice(0, 120) }; console.error('[disk_usage] 디스크 재기 실패:', last.error); return last; }
        last = { at: iso(now), ok: true, disk };
        const s = getState();
        if (disk.pct >= WARN_PCT && !s.alerted && !sending) {
            sending = true;
            const gb = (b) => (b / 1073741824).toFixed(2) + 'GB';
            try {
                const r = await push(appTag() + '서버 저장 공간 ' + disk.pct + '% 사용', '서버 디스크 ' + gb(disk.used) + ' / ' + gb(disk.usable) + ' · 남은 공간 ' + gb(disk.avail) + ' — 관리자 → 저장소에서 큰 항목을 확인하세요. 가득 차면 브리핑·특보 자료 저장이 실패합니다.', { kind: 'disk_usage', pct: String(disk.pct) });
                last.pushed = !!(r && r.sent > 0);
                if (last.pushed) saveState({ alerted: true, at: iso(now), pct: disk.pct }); else console.warn('[disk_usage] 80% 푸시 전달 0건(기기 없음·Firebase 미초기화 등) — 다음 점검 때 다시');
            } catch (e) { last.pushed = false; console.error('[disk_usage] 80% 푸시 실패 — 다음 점검 때 다시:', e && e.message); }
            finally { sending = false; }
        } else if (disk.pct < REARM_PCT && s.alerted) saveState({ alerted: false, at: iso(now), pct: disk.pct });
        return last;
    }
    /**
     * 뱃지용 가벼운 응답(디스크 재기만 — 폴더는 훑지 않음). warn = 「저장소」 탭 N 뱃지: 80% 이상, 또는 디스크를 재지 못했을 때도 켠다
     * (독립 검토 2 — 못 잴 때 뱃지가 꺼지면 「80% 미만」과 「못 잼」이 탭을 열기 전엔 같아 보인다. 탭 안에서 실패 사유가 보인다).
     * @returns {object} {warnPct, disk|error, warn, alert, lastCheck} [연계] ← routes GET disk-usage?only=summary
     */
    function summary() {
        let disk = null, error = null; try { disk = measure(dir, statfs); } catch (e) { error = String((e && e.code) || (e && e.message) || e).slice(0, 120); }
        return { warnPct: WARN_PCT, rearmPct: REARM_PCT, disk, error, warn: !disk || disk.pct >= WARN_PCT, alert: getState(), lastCheck: last, measuredAt: iso(clock()) };
    }
    /** 관리자 화면용 — summary + 종류별 크기. @returns {object} [연계] ← routes GET disk-usage */
    function snapshot() { return { ...summary(), categories: breakdown(dir) }; }
    /** 운영(Fly)에서만 10분마다 점검(첫 점검은 1분 뒤 — 서버 시작 때 무거운 일을 하지 않는다). @returns {boolean} [연계] ← server.js */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        const run = () => { check().catch((e) => console.error('[disk_usage] 점검 실패:', e && e.message)); };
        first = setTimeout(run, 60000); first.unref(); timer = setInterval(run, CHECK_MS); timer.unref(); return true;
    }
    return { check, summary, snapshot, start, stop() { if (first) clearTimeout(first); if (timer) clearInterval(timer); timer = first = null; } };
}
let def = null;
/** 운영 기본 점검기(data/). @returns {object} [연계] ← routes/admin.js · server.js */
function forDefault() { return def || (def = createMonitor()); }

module.exports = { measure, categoryOf, sizeOf, breakdown, createMonitor, forDefault, start: () => forDefault().start(), WARN_PCT, REARM_PCT, CHECK_MS, CATEGORIES };
