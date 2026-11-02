/**
 * ============================================================================
 * 파일명: local_server/services/kakao_shadow.js
 * 역할  : 「카톡판 특보현황」 — 카톡 알림톡 특보 줄만으로 "카톡이 기준이었다면 지금 특보현황이 이랬을 것"을
 *         서버가 따로 만들어 두고, 1분마다 지금의 앱 특보현황(MMIS, data/weather_alerts.json)과 구역별로 맞대어
 *         다른 곳·시간 차이를 날짜별 기록장에 남긴다. 관리자 「카톡 중계 → 비교현황」 창이 그 기록을 시간대별로 보여 준다.
 *         ★기록만 한다 — 앱 특보현황·사용자 푸시는 바꾸지 않는다(사용자 확정 2026-11-03: 지금 단계는 MMIS 기준 유지).
 *         (사용자 확정 2026-11-03 「약 10일간 수집되는 것에 대해서 제대로 우리 앱에 반영될 준비가 되었는지 테스트」
 *          「수집되어서 반영되었을 때를 가정했을 때 오류가 없는가」 「A~D까지 모두 적용」)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/kakao_relay(저장소·해석 함수·표준 해역표) · services/kakao_relay_log(날짜별 기록장)
 *  - 읽는 파일     : data/weather_alerts.json(앱 특보현황) · data/kakao_relay.json(받은 글 — 읽기만)
 *  - 쓰는 파일     : data/kakao_shadow.json(카톡판 특보현황 상태 — 스케줄러 프로세스만 쓴다) · data/kakao_relay_log/*.jsonl
 *  - 서버 API      : 없음(routes/kakao_relay GET /api/admin/kakao-relay/compare 가 summarize 를 부른다)
 *  - 나를 쓰는 곳  : scheduler.js(매분 runShadow) · routes/kakao_relay.js(summarize) · 검사 scripts/test_kakao_shadow.js
 * [로드 순서] 해당 없음(서버 모듈)
 *
 * [카톡 줄의 뜻 — 사용자 확인 2026-11-03, kakao_relay.parseWarnings 와 같음]
 *   발효·변경·발표·대치 : 그 시각부터 그 등급(시각이 미래면 그때까지는 「다가오는 특보」)
 *   해제·변경해제      : 그 시각에 풍랑 특보 끝(미래 시각이면 확정 예고 — 그때 끝). 변경해제 = 태풍으로 바뀜
 *   연장               : 등급 그대로, 앞서 알린 해제 시각은 무효
 *   예비특보 발효/해제 : 「다가오는 특보」 있음/없음
 * [MMIS 쪽 칸의 뜻 — marine_warning_crawler toBlock·자식 채우기 확인]
 *   부모: current = 발효 중(주의보·경보), upcoming = 예비특보·발효 전 발표분(등급 「예비」 또는 실제 등급)
 *   자식: children[이름] 하나에 담기고 등급 「예비」면 다가오는 특보
 * [비교] 구역마다 ① 발효 중 등급 ② 다가오는 특보 있음/없음 ③ 해제 시각(양쪽 다 정확한 시각이 있을 때만).
 *   태풍이 걸린 구역은 카톡이 태풍 발효를 보내지 않아 비교에서 뺀다(태풍 = MMIS 기준).
 *   한쪽이 바뀐 지 10분 안의 차이는 「반영 대기」(카톡이 MMIS보다 2~4분 빠름 — 실측), 그 뒤에도 다르면 「차이」.
 * [시작 상태] 처음 돌 때 카톡 옛 글이 없어(긁어오기 보관함 비어 있음 — 2026-11-03 확인) 그 시각 MMIS 특보현황으로
 *   한 번 채운다(기록에 baseline 으로 남김). 그 뒤 바뀌는 것은 카톡 줄로만 바뀐다.
 *   「놓친 글」(알림 없이 대화방에서만 발견된 옛 글)은 순서를 알 수 없어 카톡판에 반영하지 않고 기록만 한다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const kr = require('./kakao_relay');
const { createLog, dayOf } = require('./kakao_relay_log');

const WAIT_MS = 10 * 60e3;          // 반영 대기 — 기존 대조(checkMmis MMIS_WAIT_MS)와 같은 10분
const TICK_MS = 5 * 60e3;           // 비교 결과를 기록장에 남기는 간격
const LINE_GIVE_UP_MS = 6 * 3600e3; // 카톡 줄이 6시간 안에 MMIS 와 같아지지 않으면 「불일치」로 닫는다
const APPLIED_TTL_MS = 3 * 864e5;
// 이보다 오래된 글 줄은 반영하지 않는다(이미 반영했을 것) — 「반영함」 표시를 지운 뒤 300건 안에 남은 옛 글이
//   다시 반영돼 카톡판이 옛 상태로 돌아가지 않게(적대검증 2026-11-03 #1). APPLIED_TTL_MS 보다 짧아야 한다.
const MAX_LINE_AGE_MS = 2 * 864e5;
const STALE_MMIS_MIN = 15;          // 특보현황 파일이 이만큼 갱신 안 됐으면 「MMIS 멈춤 의심」
const KST = 9 * 3600e3;

const emptyZone = () => ({ cur: null, until: null, pend: null, pre: null, changedAt: null, kakaoAt: null });

/**
 * 카톡 줄 하나를 카톡판 특보현황에 반영한다.
 * 예: applyLine(zs, {zone:'A', section:'기상특보', action:'발효', level:'주의보', at:'…19:00'}, 받은시각) → zs.A.cur={level:'주의보'}
 * @param {object} zs - 구역 → 상태 @param {object} w - parseWarnings 의 줄 @param {number} tMs - 받은 시각
 * [연계] ← runShadow
 */
function applyLine(zs, w, tMs) {
    const z = zs[w.zone] || (zs[w.zone] = emptyZone());
    const atMs = Date.parse(w.at);
    const future = atMs > tMs;
    if (w.section === '예비특보') {
        if (w.action === '발효') z.pre = { from: w.at, until: w.until || null };
        else if (w.action === '해제') z.pre = null;
    } else if (w.action === '해제' || w.action === '변경해제') {
        if (future) z.until = w.at;
        else { z.cur = null; z.until = null; }
    } else if (w.action === '연장') {
        z.until = null;
    } else {
        // 발효·변경·발표·대치 — 정식 특보가 오면 예비특보는 그것으로 대신한다.
        z.pre = null;
        if (future) z.pend = { level: w.level, at: w.at };
        else { z.cur = { level: w.level, since: w.at }; z.until = null; z.pend = null; }
    }
    z.changedAt = new Date(tMs).toISOString();
    z.kakaoAt = z.changedAt;
    return z;
}

/**
 * 시각이 되어 생기는 변화: 다가오던 특보 발효, 예고된 해제, 예비특보 시간대 끝.
 * @param {object} zs @param {number} nowMs
 * [연계] ← runShadow
 */
function advance(zs, nowMs) {
    for (const z of Object.values(zs)) {
        if (z.pend && Date.parse(z.pend.at) <= nowMs) {
            z.cur = { level: z.pend.level, since: z.pend.at };
            z.changedAt = z.pend.at;
            z.pend = null;
            if (z.until && Date.parse(z.until) <= Date.parse(z.cur.since)) z.until = null;
        }
        if (z.until && Date.parse(z.until) <= nowMs) { z.changedAt = z.until; z.cur = null; z.until = null; }
        if (z.pre && z.pre.until && Date.parse(z.pre.until) <= nowMs) { z.changedAt = z.pre.until; z.pre = null; }
    }
}

/** 카톡판 구역 상태 → 비교용 {cur, up, until}. */
function shadowView(z) {
    z = z || emptyZone();
    return { cur: z.cur ? z.cur.level : null, up: !!(z.pend || z.pre), until: z.until || null };
}

/**
 * 앱 특보현황(weather_alerts.json) → 구역 → {cur, up, clr, typhoon}. 부모와 자식 모두.
 * 예: {current:{…동해중부안쪽먼바다:{current:{wrnTp:'풍랑',wrnLvl:'주의보',…}, children:{울릉도…:{wrnLvl:'예비'}}}}}
 *     → {동해중부안쪽먼바다:{cur:'주의보',up:false,…}, 울릉도…:{cur:null, up:true}}
 * [연계] ← runShadow / → kakao_relay.mmisZones·lvlOf·isWave·clrOf·mmisIso
 */
function mmisView(alerts) {
    const out = {};
    const isTyphoon = (b) => !!b && /태풍/.test(String(b.wrnTpNm || b.wrnTp || ''));
    for (const [name, node] of Object.entries(kr.mmisZones(alerts))) {
        const c = node.current, u = node.upcoming;
        const cur = kr.isWave(c) && ['주의보', '경보'].includes(kr.lvlOf(c)) ? kr.lvlOf(c) : null;
        out[name] = { cur, up: kr.isWave(u), clr: cur ? kr.mmisIso(kr.clrOf(c)) : null, yn: cur ? kr.mmisIso(c.tmYn) : null, typhoon: isTyphoon(c) || isTyphoon(u) };
        for (const [cn, cb] of Object.entries(node.children || {})) {
            if (!cb) { out[cn] = { cur: null, up: false, clr: null, typhoon: false }; continue; }
            const lvl = kr.lvlOf(cb), wave = kr.isWave(cb);
            const ccur = wave && ['주의보', '경보'].includes(lvl) ? lvl : null;
            out[cn] = { cur: ccur, up: wave && lvl === '예비', clr: ccur ? kr.mmisIso(kr.clrOf(cb)) : null, yn: ccur ? kr.mmisIso(cb.tmYn) : null, typhoon: isTyphoon(cb) };
        }
    }
    return out;
}

/** 사람이 읽는 한 줄. 예: '풍랑주의보 · 해제 11/03 05:00' / '특보 없음 · 다가오는 특보 있음' */
function describe(v, clrWord) {
    if (!v) return '특보 없음';
    if (v.typhoon) return '태풍 특보(비교 제외)';
    const parts = [v.cur ? '풍랑' + v.cur : '특보 없음'];
    if (v.up) parts.push('다가오는 특보 있음');
    const t = v.until || v.clr;
    if (t) parts.push(clrWord + ' ' + kr.fmtK(t));
    return parts.join(' · ');
}

/**
 * 구역 하나 비교. status: match | wait(한쪽이 바뀐 지 10분 안) | diff | typhoon
 * diffs: 'cur'(발효 등급) · 'up'(다가오는 특보) · 'clr'(해제 시각, 양쪽 다 정확할 때만)
 * [연계] ← runShadow
 */
function compareZone(sv, mv, nowMs, shadowChangedMs, mmisSinceMs, mmisCoreSinceMs) {
    mv = mv || { cur: null, up: false, clr: null, typhoon: false };
    if (mv.typhoon) return { status: 'typhoon', diffs: [] };
    const diffs = [];
    if (sv.cur !== mv.cur) diffs.push('cur');
    if (sv.up !== mv.up) diffs.push('up');
    if (sv.cur && mv.cur && sv.until && mv.clr && sv.until !== mv.clr) diffs.push('clr');
    if (!diffs.length) return { status: 'match', diffs };
    // MMIS 쪽은 「다른 칸」이 바뀐 시각으로 본다 — 해제예고만 바뀌었는데 오래된 등급 차이가 10분간 「반영 대기」로
    //   내려가지 않게(적대검증 #6). 해제 시각만 다를 때만 해제예고 변화 시각을 쓴다.
    const onlyClr = diffs.length === 1 && diffs[0] === 'clr';
    const mSince = onlyClr ? mmisSinceMs : (mmisCoreSinceMs != null ? mmisCoreSinceMs : mmisSinceMs);
    const recent = (nowMs - (shadowChangedMs || 0) < WAIT_MS) || (nowMs - (mSince || 0) < WAIT_MS);
    return { status: recent ? 'wait' : 'diff', diffs };
}

const sigOf = (v) => JSON.stringify([v.cur, v.up, v.clr, v.typhoon]);
const coreOf = (v) => JSON.stringify([v.cur, v.up, v.typhoon]);
const lineText = (w) => `${w.zone} ${w.kind} 「${w.action}」 ${kr.fmtK(w.at)}${w.until ? '~' + kr.fmtK(w.until).slice(6) : ''}`;

function loadState(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
        if (e.code === 'ENOENT') return null;
        // 깨진 상태를 새로 만들면 10일 시험이 조용히 다시 시작된다 — 원본을 남기고 멈춘다.
        try { fs.copyFileSync(file, file + '.bad'); } catch (_) { /* 보존 시도만 */ }
        throw new Error('카톡판 상태 파일 손상(' + e.message + ') — ' + file + '.bad 로 보존');
    }
}
function saveState(file, st) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, file);
}

let _running = false;
/**
 * 1분마다 부른다(scheduler). 새 카톡 줄 반영 → 시각 변화 → MMIS 와 구역별 비교 → 기록장에 남김.
 *   · 카톡 줄마다(B): MMIS 와 같아지면 「일치(카톡이 n분 빠름/MMIS가 먼저)」, 6시간 안에 안 같아지면 「불일치」,
 *     같은 구역에 다음 줄이 먼저 오면 「다음 글로 대체」, 태풍 구역이면 「비교 제외」로 닫는다.
 *   · 다른 상태가 이어진 구간(episode): 시작·끝·분·누가 먼저 바뀌었나.
 *   · 5분마다 tick: 같은 구역 수, 반영 대기·차이 구역 목록.
 *   · MMIS 쪽만 바뀐 것도(카톡이 안 온 것) 같은 비교로 잡힌다.
 * 열쇠(KAKAO_RELAY_TOKEN)가 없으면 이 경로를 안 쓰는 서버이므로 아무것도 하지 않는다.
 * @returns {object|null} {match, wait, diff, typhoon} 개수
 * [연계] ← scheduler.js 매분 / → kakao_relay.createStore().snapshot · kakao_relay_log
 */
function runShadow({
    store = kr.createStore(), now = Date.now(),
    readAlerts = () => JSON.parse(fs.readFileSync(path.join(require('../config/server_config').DATA_DIR, 'weather_alerts.json'), 'utf8')),
    file = path.join(require('../config/server_config').DATA_DIR, 'kakao_shadow.json'),
    log = createLog(path.join(path.dirname(file), 'kakao_relay_log')),
    enabled = !!process.env.KAKAO_RELAY_TOKEN,
} = {}) {
    if (!enabled || _running) return null;
    _running = true;
    try {
        const nowIso = new Date(now).toISOString();
        let st = loadState(file);
        let mv;
        let mmisAgeMin = null;
        try {
            const raw = readAlerts();
            mv = mmisView(raw);
            // 특보현황 파일이 언제 갱신됐나 — 크롤러가 멈춰 굳어 있으면 「같음」이 믿을 수 없다(적대검증 낮음: 조용함 ≠ 정상).
            if (raw && raw.updatedAt && Number.isFinite(Date.parse(raw.updatedAt))) mmisAgeMin = Math.round((now - Date.parse(raw.updatedAt)) / 60e3);
        }
        catch (e) {
            // 특보현황을 못 읽으면 비교할 수 없다 — 「같음」으로 남기지 않고 못 읽었다고 남긴다(5분에 한 번).
            if (st && now - Date.parse(st.lastTick || 0) >= TICK_MS) {
                log.append({ kind: 'tick', mmisError: String(e.message).slice(0, 120) }, now);
                st.lastTick = nowIso;
                saveState(file, st);
            }
            return null;
        }
        if (!st) {
            st = { startedAt: nowIso, zones: {}, applied: {}, tracks: [], mmis: {}, ep: {}, lastTick: null, prunedDay: null };
            const active = [];
            for (const [name, v] of Object.entries(mv)) {
                if (!v.cur && !v.up) continue;
                const z = st.zones[name] = emptyZone();
                if (v.cur) z.cur = { level: v.cur, since: null };
                // 해제예고(clrNtcTm)는 예보라 넣지 않는다 — 확정 해제시각(tmYn)만(적대검증 #4).
                if (v.yn) z.until = v.yn;
                if (v.up) z.pre = { from: null, until: null, baseline: true };
                z.changedAt = nowIso;
                active.push(`${name} ${describe(v, '해제예고')}`);
            }
            for (const [name, v] of Object.entries(mv)) st.mmis[name] = { sig: sigOf(v), since: nowIso, core: coreOf(v), coreSince: nowIso };
            // 시작 전에 카톡이 이미 알려 준 「미래 시각 해제」(확정)는 넣는다 — 시작 상태 구역에만, 아직 안 지난 것만.
            const known = [];
            for (const m of store.snapshot(kr.MAX_MESSAGES).messages) {
                if (now - Date.parse(m.receivedAt) > MAX_LINE_AGE_MS) continue;
                for (const w of m.warnings || []) {
                    const z = st.zones[w.zone];
                    if (!z || !z.cur || w.section !== '기상특보' || w.action !== '해제' || w.cutTail || !w.zoneKnown || !(Date.parse(w.at) > now)) continue;
                    if (!z.until || Date.parse(w.at) !== Date.parse(z.until)) { z.until = w.at; known.push(`${w.zone} 해제 ${kr.fmtK(w.at)}`); }
                }
            }
            log.append({ kind: 'baseline', kakaoRelease: known, note: '시작 상태를 이 시각 앱 특보현황(MMIS)으로 채움 — 이후 변화는 카톡 줄로만', active }, now);
        }
        // MMIS 쪽 변화 시각(구역별) — 반영 대기·「누가 먼저」 판정과 카톡 줄 지연 계산에 쓴다.
        for (const [name, v] of Object.entries(mv)) {
            const sig = sigOf(v), core = coreOf(v), prev = st.mmis[name];
            if (!prev || prev.sig !== sig) {
                if (prev) log.append({ kind: 'mmis', zone: name, to: describe(v, '해제예고') }, now);
                st.mmis[name] = { sig, since: nowIso, core, coreSince: prev && prev.core === core ? (prev.coreSince || prev.since) : nowIso };
            }
            // 시작 때 MMIS 로 채운 「다가오는 특보」는 카톡 줄로 시작·끝을 알 수 없다 — MMIS 에서 사라지면 같이 지운다.
            const z = st.zones[name];
            if (z && z.pre && z.pre.baseline && !v.up) z.pre = null;
        }
        for (const [name, prev] of Object.entries(st.mmis)) {
            if (mv[name]) continue;
            log.append({ kind: 'mmis', zone: name, to: '특보 없음(목록에서 빠짐)' }, now);
            delete st.mmis[name];
        }
        // ① 새 카톡 줄 — 「이번 알림」 줄(newWarnings)만 반영한다. 놓친 글 줄은 기록만.
        const startMs = Date.parse(st.startedAt);
        const cand = [];
        store.snapshot(kr.MAX_MESSAGES).messages.slice().reverse().forEach((m, j) => {
            const t = Date.parse(m.promotedAt || m.receivedAt);
            if (!(t >= startMs) || now - t > MAX_LINE_AGE_MS) return;
            (m.newWarnings || []).forEach((w, i) => cand.push({ w, t, j, i, m, missed: false }));
            (m.missedWarnings || []).forEach((w, i) => cand.push({ w, t: Date.parse(m.receivedAt), j, i, m, missed: true }));
        });
        // 같은 시각이면 글 순서 → 줄 순서(적대검증 #5)
        cand.sort((a, b) => a.t - b.t || a.j - b.j || a.i - b.i);
        for (const { w, t, m, missed } of cand) {
            // 놓친 글로 먼저 본 줄이 나중에 「이번 알림」으로 올라오면 다시 봐야 하므로 열쇠를 나눈다(적대검증 #2).
            const key = m.id + '|' + kr.warningKey(w) + (missed ? '|missed' : '|new');
            if (st.applied[key]) continue;
            st.applied[key] = nowIso;
            if (missed) { log.append({ kind: 'missedLine', zone: w.zone, line: lineText(w), device: m.device, msgId: m.id }, now); continue; }
            for (const tr of st.tracks) {
                if (tr.zone !== w.zone) continue;
                log.append({ kind: 'line', zone: tr.zone, line: tr.line, receivedAt: tr.receivedAt, result: '다음 글로 대체', mmis: describe(mv[tr.zone], '해제예고') }, now);
                tr.closed = true;
            }
            st.tracks = st.tracks.filter((tr) => !tr.closed);
            advance(st.zones, t);   // 그 줄을 받기 전까지의 시각 변화부터(몰아서 처리할 때 순서 — 적대검증 낮음)
            const b4 = shadowView(st.zones[w.zone]);
            applyLine(st.zones, w, t);
            const af = shadowView(st.zones[w.zone]);
            // 이 줄이 무엇을 바꿨나 — 그것이 MMIS 에 반영됐는지로 줄 결과를 낸다(적대검증 #3: 구역 전체가 같은지로만 보면
            //   연장·해제예고 없는 미래 해제가 받자마자 「일치」가 되고 큰 음수 지연이 평균에 섞였다).
            const aspect = (b4.cur !== af.cur || b4.up !== af.up) ? 'core' : b4.until !== af.until ? 'clr' : 'none';
            st.tracks.push({ zone: w.zone, line: lineText(w), receivedAt: new Date(t).toISOString(), msgId: m.id, aspect });
            log.append({ kind: 'apply', zone: w.zone, line: lineText(w), device: m.device, msgId: m.id, receivedAt: new Date(t).toISOString() }, now);
        }
        // ② 시각 변화
        advance(st.zones, now);
        // ③ 구역별 비교
        const names = new Set([...kr.zoneTable().names, ...Object.keys(st.zones), ...Object.keys(mv)]);
        const rows = [];
        for (const name of names) {
            const z = st.zones[name], sv = shadowView(z), m = mv[name];
            const mm = st.mmis[name];
            const r = compareZone(sv, m, now, z && Date.parse(z.changedAt), mm && Date.parse(mm.since), mm && Date.parse(mm.coreSince || mm.since));
            rows.push({ zone: name, ...r, kakao: describe(sv, '해제 예정'), mmis: describe(m, '해제예고'), active: !!(sv.cur || sv.up || (m && (m.cur || m.up))) });
        }
        const byZone = new Map(rows.map((r) => [r.zone, r]));
        // ④ 카톡 줄마다 결과(B)
        const mvNow = mv;
        for (const tr of st.tracks) {
            const r = byZone.get(tr.zone);
            const recvMs = Date.parse(tr.receivedAt);
            let result = null, lagMin;
            if (r && r.status === 'typhoon') result = '비교 제외(태풍)';
            else if (tr.aspect === 'none') result = '바뀐 것 없음(이미 아는 내용)';
            else if (r && r.status === 'match') {
                const mm = st.mmis[tr.zone] || {};
                if (tr.aspect === 'clr' && !(mvNow[tr.zone] && mvNow[tr.zone].clr)) {
                    // MMIS 에 정확한 해제 시각이 아직 없다 — 생길 때까지 기다리고, 카톡판 해제 예정이 지나거나 6시간이 되면 닫는다.
                    const z = st.zones[tr.zone];
                    if (!(z && z.until) || now - recvMs > LINE_GIVE_UP_MS) result = '확인 불가(MMIS에 정확한 해제 시각 없음)';
                } else {
                    result = '일치';
                    // 양수 = MMIS 가 카톡보다 n분 늦게 같아짐(카톡이 빠름), 0 이하 = MMIS 가 먼저 바뀌어 있었음
                    const since = tr.aspect === 'core' ? (mm.coreSince || mm.since) : mm.since;
                    lagMin = Math.round((Date.parse(since || tr.receivedAt) - recvMs) / 60e3);
                }
            } else if (now - recvMs > LINE_GIVE_UP_MS) result = '불일치';
            if (!result) continue;
            log.append({ kind: 'line', zone: tr.zone, line: tr.line, receivedAt: tr.receivedAt, result, lagMin, mmis: r ? r.mmis : '', kakao: r ? r.kakao : '' }, now);
            tr.closed = true;
        }
        st.tracks = st.tracks.filter((tr) => !tr.closed);
        // ⑤ 다른 상태가 이어진 구간
        for (const r of rows) {
            const ep = st.ep[r.zone];
            if (r.status === 'wait' || r.status === 'diff') {
                if (!ep) {
                    const z = st.zones[r.zone];
                    const kMs = z ? Date.parse(z.changedAt) || 0 : 0, mMs = st.mmis[r.zone] ? Date.parse(st.mmis[r.zone].since) || 0 : 0;
                    st.ep[r.zone] = { start: nowIso, worst: r.status, first: kMs >= mMs ? '카톡이 먼저 바뀜' : 'MMIS가 먼저 바뀜', diffs: r.diffs, kakao: r.kakao, mmis: r.mmis };
                } else {
                    if (r.status === 'diff') ep.worst = 'diff';
                    ep.kakao = r.kakao; ep.mmis = r.mmis; ep.diffs = r.diffs;
                }
            } else if (ep) {
                log.append({ kind: 'episode', zone: r.zone, start: ep.start, end: nowIso, min: Math.round((now - Date.parse(ep.start)) / 60e3), worst: ep.worst, first: ep.first, diffs: ep.diffs, kakao: ep.kakao, mmis: ep.mmis, endedAs: r.status }, now);
                delete st.ep[r.zone];
            }
        }
        // ⑥ 5분마다 상태 한 줄
        const pick = (s) => rows.filter((r) => r.status === s).map((r) => ({ zone: r.zone, diffs: r.diffs, kakao: r.kakao, mmis: r.mmis }));
        const counts = { match: rows.filter((r) => r.status === 'match').length, wait: pick('wait').length, diff: pick('diff').length, typhoon: pick('typhoon').length, active: rows.filter((r) => r.active).length };
        if (!st.lastTick || now - Date.parse(st.lastTick) >= TICK_MS - 30e3) {
            log.append({ kind: 'tick', ...counts, mmisAgeMin, waitZones: pick('wait'), diffZones: pick('diff'), typhoonZones: pick('typhoon').map((r) => r.zone) }, now);
            st.lastTick = nowIso;
        }
        st.last = { at: nowIso, ...counts, rows: rows.filter((r) => r.active || r.status !== 'match').sort((a, b) => a.zone.localeCompare(b.zone, 'ko')) };
        // 정리: 오래된 「반영함」 표시, 30일 지난 기록장
        for (const [k, at] of Object.entries(st.applied)) if (now - Date.parse(at) > APPLIED_TTL_MS) delete st.applied[k];
        if (st.prunedDay !== dayOf(now)) { log.prune(now); st.prunedDay = dayOf(now); }
        saveState(file, st);
        return counts;
    } finally {
        _running = false;
    }
}

/**
 * 비교현황 창(D)에 줄 요약. 하루를 시간대(KST 0~23시)별로 묶고, 기록이 있는 모든 날의 합계도 준다.
 * 예: summarize({day:'2026-11-03'}) → {days:[{day, msgs, lines:{일치:3}, diffMin:…}], day, totals, hours:[24], lines, episodes, current}
 * @param {object} o @param {string} [o.day] - 'YYYY-MM-DD'(없으면 오늘 KST)
 * [연계] ← routes/kakao_relay GET /api/admin/kakao-relay/compare / → kakao_relay_log.read
 */
function summarize({ day, now = Date.now(), file = path.join(require('../config/server_config').DATA_DIR, 'kakao_shadow.json'), log = createLog(path.join(path.dirname(file), 'kakao_relay_log')) } = {}) {
    const today = dayOf(now);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) day = today;
    const hourOf = (t) => new Date(Date.parse(t) + KST).getUTCHours();
    function one(d, detail) {
        const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, msgs: 0, dups: 0, newLines: 0, missedLines: 0, applied: 0, ticks: 0, staleTicks: 0, diffMin: 0, waitMin: 0, diffZones: {}, mmisChanges: 0, mmisError: 0, lines: {}, devices: {} }));
        const tot = { msgs: 0, dups: 0, ignored: 0, newLines: 0, missedLines: 0, unknownZone: 0, cutTail: 0, applied: 0, ticks: 0, staleTicks: 0, gapHours: 0, diffMin: 0, waitMin: 0, mmisChanges: 0, mmisError: 0, lines: {}, lagSum: 0, lagN: 0, lagMax: null, devices: {}, beats: {} };
        const lines = [], episodes = [], extra = [];
        for (const ev of log.read(d)) {
            const h = hours[hourOf(ev.t)];
            if (!h) continue;
            if (ev.kind === 'msg') {
                h.msgs++; tot.msgs++;
                h.devices[ev.device] = (h.devices[ev.device] || 0) + 1; tot.devices[ev.device] = (tot.devices[ev.device] || 0) + 1;
                for (const l of ev.lines || []) {
                    if (l.tag === 'new') { h.newLines++; tot.newLines++; }
                    else if (l.tag === 'missed') { h.missedLines++; tot.missedLines++; }
                    else if (l.tag === 'unknownZone') tot.unknownZone++;
                    else if (l.tag === 'cutTail') tot.cutTail++;
                }
            } else if (ev.kind === 'dup') { h.dups++; tot.dups++; }
            else if (ev.kind === 'ignored') tot.ignored += ev.count || 0;
            else if (ev.kind === 'beat') tot.beats[ev.device] = (tot.beats[ev.device] || 0) + 1;
            else if (ev.kind === 'apply') { h.applied++; tot.applied++; if (detail) extra.push(ev); }
            else if (ev.kind === 'mmis') { h.mmisChanges++; tot.mmisChanges++; if (detail) extra.push(ev); }
            else if (ev.kind === 'missedLine' || ev.kind === 'baseline' || ev.kind === 'anchor' || ev.kind === 'device') { if (detail) extra.push(ev); }
            else if (ev.kind === 'tick') {
                if (ev.mmisError) { h.mmisError++; tot.mmisError++; continue; }
                h.ticks++; tot.ticks++;
                if (ev.mmisAgeMin != null && ev.mmisAgeMin > STALE_MMIS_MIN) { h.staleTicks++; tot.staleTicks++; }
                const step = TICK_MS / 60e3;
                if ((ev.diffZones || []).length) { h.diffMin += step; tot.diffMin += step; }
                if ((ev.waitZones || []).length) { h.waitMin += step; tot.waitMin += step; }
                for (const z of ev.diffZones || []) {
                    const e = h.diffZones[z.zone] || (h.diffZones[z.zone] = { min: 0, kakao: z.kakao, mmis: z.mmis, diffs: z.diffs });
                    e.min += step; e.kakao = z.kakao; e.mmis = z.mmis; e.diffs = z.diffs;
                }
            } else if (ev.kind === 'line') {
                h.lines[ev.result] = (h.lines[ev.result] || 0) + 1; tot.lines[ev.result] = (tot.lines[ev.result] || 0) + 1;
                if (ev.result === '일치' && typeof ev.lagMin === 'number') {
                    tot.lagSum += ev.lagMin; tot.lagN++;
                    if (tot.lagMax == null || ev.lagMin > tot.lagMax) tot.lagMax = ev.lagMin;
                }
                if (detail) lines.push(ev);
            } else if (ev.kind === 'episode') { if (detail) episodes.push(ev); }
        }
        // 비교가 돌지 않은 시간 — 다 지난 시간인데(시험 시작 뒤) 5분 기록이 10개 미만이면 「기록 없음」으로 표시한다.
        for (const h of hours) {
            const hs = Date.parse(d + 'T00:00:00+09:00') + h.hour * 3600e3;
            h.gap = !!(startMs && hs >= startMs && hs + 3600e3 <= now && h.ticks + h.mmisError < 10);
            if (h.gap) tot.gapHours++;
        }
        tot.lagAvg = tot.lagN ? Math.round((tot.lagSum / tot.lagN) * 10) / 10 : null;
        return { hours, tot, lines, episodes, extra };
    }
    let current = null, startMs = 0;
    try { const st = loadState(file); current = st ? { startedAt: st.startedAt, ...(st.last || {}) } : null; startMs = st ? Date.parse(st.startedAt) || 0 : 0; }
    catch (e) { current = { error: e.message }; }
    const days = log.days().map((d) => ({ day: d, ...one(d, false).tot }));
    const sel = one(day, true);
    return { day, today, days, totals: sel.tot, hours: sel.hours, lines: sel.lines, episodes: sel.episodes, events: sel.extra, current, waitMin: WAIT_MS / 60e3, tickMin: TICK_MS / 60e3 };
}

module.exports = { runShadow, summarize, applyLine, advance, shadowView, mmisView, compareZone, WAIT_MS, TICK_MS, LINE_GIVE_UP_MS };
