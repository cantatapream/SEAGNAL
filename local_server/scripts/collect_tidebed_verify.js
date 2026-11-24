#!/usr/bin/env node
/**
 * 파일명: local_server/scripts/collect_tidebed_verify.js
 * 역할: 표준항이 아닌 지점(임의항)마다 「한 달에 하루씩 12일」의 실제 TideBED 곡선을 받아
 *       ①그 지점의 기준 표준항·조시차·조고비·높이 보정식 ②그 12일의 실제 고조·저조를 저장한다.
 *       (1년치 조석을 표준항 표에서 계산해 만들 때 쓰는 재료이자, 그 계산을 검증할 정답지다.
 *        앱이 도는 중에 쓰는 코드가 아니라 1년에 한 번 돌리는 수집 도구다.)
 *
 * [쓰는 법]
 *   TIDEBED_KEYS="키1,키2,키3" NODE_USE_ENV_PROXY=1 node local_server/scripts/collect_tidebed_verify.js 2027 \
 *       [--budget 7000] [--until 06:50] [--limit 5]
 *   --budget  키 하나가 이번 실행에서 부를 수 있는 횟수(기본 7000 — 운영 앱이 같은 키를 쓰므로 하루 10,000 을 다 쓰지 않는다)
 *   --until   이 시각(KST)이 되면 멈춘다(기본 06:50 — 사용자 지시: 새벽 앵커 수집 뒤 시작, 07:00 전 종료)
 *   --limit   지점 수 제한(시험용)
 *   --params  재료만 받기 — 지점마다 한 번 불러 기준 표준항·조시차·조고비·보정식만(12일 곡선은 안 받는다)
 *   이미 12일을 다 받은 지점은 건너뛴다. 받는 도중 끊기면 받은 날까지 남아 다음 실행이 이어받는다.
 *
 * [연계]
 *   - 읽는 것: client/tide_data/points_<연도>/_points.csv (구분=임의항 인 줄만) · local_server/peak_finder.js (findTidePeaks —
 *             바텀시트가 고조·저조를 찾는 그 함수) · services/tide_collector.js 의 TideBED 주소와 같은 API
 *   - 쓰는 것: client/tide_data/points_<연도>/tidebed_verify/<id>.json
 *       { id, name, lat, lon, status:'ok'|'no_grid', qLat·qLon·nudgeKm(격자 밖이라 옮겨 물은 좌표), ref(기준 표준항 이름), josi, shiftMin, jogo, msl,
 *         days: { 'YYYYMMDD': { n, fit:{a,b,maxRes}, peaks:{highTide1:{time,height},…}, first, last } } }
 *   - 다음 단계: build_tide_points_year.js 가 이 파일 + 표준항 1년치로 지점별 1년치를 계산하고 12일을 대조한다.
 * [로드 순서] 단독 실행 스크립트(서버·index2.html 과 무관).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findTidePeaks } = require('../peak_finder');

const URL_BASE = 'https://apis.data.go.kr/1192136/tidebed/GetTidebedApiService';
/** 달마다 하루 — 사리·조금이 번갈아 걸리게 날짜를 36~37일씩 민다(물때 주기 약 14.8일). */
const DAYS = ['0105', '0211', '0317', '0423', '0502', '0608', '0714', '0820', '0926', '1005', '1111', '1217'];
const PARALLEL = 6;            // 동시에 받는 지점 수(한 지점 안에서는 차례로)
const BREAKER = 8;             // 연속 실패가 이만큼이면 멈춘다(TideBED 장애 — 운영 수집기와 같은 값)

const args = process.argv.slice(2);
const YEAR = args[0];
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BUDGET = parseInt(opt('--budget', '7000'), 10);
const UNTIL = opt('--until', '06:50');
const LIMIT = parseInt(opt('--limit', '0'), 10);
const DIR = path.join(__dirname, '..', '..', 'client', 'tide_data', `points_${YEAR}`);
const OUT = path.join(DIR, 'tidebed_verify');

const keys = (process.env.TIDEBED_KEYS || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(k => ({ k, left: BUDGET }));
let rr = 0, calls = 0, failStreak = 0, stop = null;

/** 지금 KST 시각이 멈출 시각을 지났나. 예) UNTIL='06:50', 지금 06:51 KST → true.
 *  밤(18시 이후)에 시작하면 다음 날 새벽까지로 본다. */
const startKstMin = kstMin();
function kstMin() { const d = new Date(Date.now() + 9 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function pastUntil() {
    const [h, m] = UNTIL.split(':').map(Number);
    const until = h * 60 + m;
    const now = kstMin();
    if (startKstMin > until) return now <= startKstMin && now >= until;   // 자정을 넘겨 도는 경우
    return now >= until;
}

/** 다음 키 하나(남은 횟수가 있는 것). 없으면 null. */
function pickKey() {
    for (let i = 0; i < keys.length; i++) {
        const c = keys[(rr++) % keys.length];
        if (c.left > 0) { c.left--; return c; }
    }
    return null;
}

/**
 * TideBED 한 페이지.
 * @returns {{items:Array}|{nogrid:true}|null}  null = 실패(여러 번 다시 불러도 안 됨)
 * [연계] services/tide_collector.js fetchTideBedPage 와 같은 요청(min=1, 300줄).
 */
async function page(lat, lon, ymd, pageNo, min = 1) {
    for (let t = 0; t < 5; t++) {
        const c = pickKey();
        if (!c) { stop = stop || '키 한도 소진'; return null; }
        calls++;
        const u = `${URL_BASE}?serviceKey=${encodeURIComponent(c.k)}&lat=${lat}&lot=${lon}&reqDate=${ymd}&type=json&min=${min}&numOfRows=300&pageNo=${pageNo}`;
        let text = '';
        try {
            const r = await fetch(u, { signal: AbortSignal.timeout(40000) });
            text = await r.text();
            const j = JSON.parse(text);
            const head = j.header || (j.response && j.response.header) || {};
            const body = j.body || (j.response && j.response.body) || {};
            const rc = String(head.resultCode);
            if (rc === '00') {
                const it = body.items && body.items.item;
                return { items: Array.isArray(it) ? it : (it ? [it] : []) };
            }
            if (rc === '10' || rc === '03') return { nogrid: true, code: rc };   // 격자 미제공(응답은 왔으나 자료 없음)
            if (['22', '30', '31', '32', '20'].includes(rc)) { c.left = 0; console.log(`  ⚠ 키 ${c.k.slice(0, 6)}… 응답 ${rc} ${head.resultMsg} — 그만 씀`); continue; }
            if (/LIMITED_NUMBER|SERVICE_KEY|ACCESS DENIED|DEADLINE/.test(text)) { c.left = 0; console.log(`  ⚠ 키 ${c.k.slice(0, 6)}… 한도/인증 — 그만 씀`); continue; }
        } catch (e) { /* 접속 끊김·시간 초과·JSON 아님 → 다시 */ }
        await new Promise(r => setTimeout(r, 1500 * (t + 1)));
    }
    return null;
}

/** 하루치 곡선(5페이지). @returns {Array|{nogrid}|null} */
async function day(lat, lon, ymd) {
    const all = [];
    for (let p = 1; p <= 5; p++) {
        const r = await page(lat, lon, ymd, p);
        if (!r) return null;
        if (r.nogrid) return r;
        all.push(...r.items);
    }
    return all;
}

const mins = s => parseInt(s.slice(11, 13), 10) * 60 + parseInt(s.slice(14, 16), 10);

/** 하루치 곡선 → 저장할 요약(보정식 + 실제 고조·저조).
 *  보정식: 지점 높이(slctdHgt) = a × 기준 표준항 높이(obsrvnHgt) + b  (같은 줄끼리 — 시각은 조시차만큼 밀려 있다) */
function summarize(items, ymd) {
    const xs = items.map(i => parseFloat(i.obsrvnHgt)), ys = items.map(i => parseFloat(i.slctdHgt));
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const a = sxx ? sxy / sxx : 1, b = my - a * mx;
    let maxRes = 0;
    for (let i = 0; i < n; i++) maxRes = Math.max(maxRes, Math.abs(ys[i] - (a * xs[i] + b)));
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const pk = findTidePeaks(items, iso);
    const peaks = {};
    for (const k of Object.keys(pk)) if (/Tide\d$/.test(k) && pk[k]) peaks[k] = pk[k];
    return { n, fit: { a: +a.toFixed(5), b: +b.toFixed(3), maxRes: +maxRes.toFixed(2) }, peaks,
        first: items[0].slctdDt, last: items[n - 1].slctdDt };
}

/**
 * 격자 밖 지점을 둘레(약 1·2·4km, 여덟 방향)로 옮겨 가며 격자가 있는 가장 가까운 자리를 찾는다.
 * 예) 영도(35.0803,129.0393) → 격자 없음 → 남쪽 0.01° 가 답하면 {lat:35.0703, lon:129.0393, km:1.1}
 * @returns {{lat:string, lon:string, km:number}|null}
 * [연계] 운영 수집기(services/tide_field_collector.js)의 「앵커 격자 보정」과 같은 뜻 — 거기는 수심 격자에서 고르고
 *        여기는 수심 자료가 없어 둘레를 직접 물어본다.
 */
async function nudge(pt, ymd) {
    const lat0 = parseFloat(pt.lat), lon0 = parseFloat(pt.lon);
    for (const r of [0.01, 0.02, 0.04]) {
        for (let k = 0; k < 8; k++) {
            const ang = k * Math.PI / 4;
            const lat = (lat0 + r * Math.cos(ang)).toFixed(5), lon = (lon0 + r * Math.sin(ang) / Math.cos(lat0 * Math.PI / 180)).toFixed(5);
            const res = await page(lat, lon, ymd, 1);
            if (!res) return null;
            if (!res.nogrid && res.items.length) return { lat, lon, km: +(r * 111).toFixed(1) };
        }
    }
    return null;
}

/**
 * 재료만 받기(--params) — 지점마다 **한 번** 불러 기준 표준항·조시차·조고비·보정식만 얻는다(10분 간격 하루치 144줄이 한 번에 온다).
 * [왜] 사용자 2026-11-24: 「재료부터 불러서 … 각 임의항별 1년치를 만들어놓으면 좋지 않겠니?」 — 12일 대조는 며칠 걸리지만
 *      1년치 계산에 필요한 재료는 한 번 호출이면 된다. 12일 수집은 이 파일에 이어서 days 를 채운다.
 * @returns 저장한 기록(rec). rec.param = {ymd, n, fit:{a,b,maxRes}}
 */
async function doParam(pt) {
    const file = path.join(OUT, pt.id + '.json');
    const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { id: pt.id, name: pt.name, lat: pt.lat, lon: pt.lon, status: 'ok', days: {} };
    if (rec.ref || rec.status === 'no_grid') return rec;
    const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(rec)); fs.renameSync(file + '.tmp', file); };
    const ymd = YEAR + DAYS[0];
    let r = await page(pt.lat, pt.lon, ymd, 1, 10);
    if (r && r.nogrid && !rec.nudgeTried) {
        rec.nudgeTried = true;
        const hit = await nudge(pt, ymd);
        if (hit) { rec.qLat = hit.lat; rec.qLon = hit.lon; rec.nudgeKm = hit.km; r = await page(hit.lat, hit.lon, ymd, 1, 10); }
    }
    if (!r) { if (++failStreak >= BREAKER) stop = stop || `연속 ${BREAKER}회 실패(TideBED 장애 추정)`; return rec; }
    failStreak = 0;
    if (r.nogrid) { rec.status = 'no_grid'; rec.nogridCode = r.code; save(); return rec; }
    if (r.items.length < 100) return rec;
    const f = r.items[0];
    Object.assign(rec, { ref: f.obsvtrNm, refLat: f.lat, refLon: f.lot, josi: f.josi, jogo: parseFloat(f.jogo), msl: f.msl });
    const shift = mins(f.slctdDt) - mins(f.obsrvnDt);
    rec.shiftMin = shift > 720 ? shift - 1440 : (shift < -720 ? shift + 1440 : shift);
    const sum = summarize(r.items, ymd);
    rec.param = { ymd, n: sum.n, fit: sum.fit };
    save();
    return rec;
}

async function doPoint(pt) {
    const file = path.join(OUT, pt.id + '.json');
    const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { id: pt.id, name: pt.name, lat: pt.lat, lon: pt.lon, status: 'ok', days: {} };
    const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(rec)); fs.renameSync(file + '.tmp', file); };
    for (const md of DAYS) {
        const ymd = YEAR + md;
        if (rec.days[ymd] || rec.status === 'no_grid') continue;
        if (stop || pastUntil()) { stop = stop || `멈출 시각(${UNTIL} KST)`; break; }
        let items = await day(rec.qLat || pt.lat, rec.qLon || pt.lon, ymd);
        if (items && items.nogrid && !rec.qLat && !rec.nudgeTried) {
            // 좌표가 TideBED 격자 밖(뭍 위·방파제 끝 등) → 둘레 바다 쪽으로 조금 옮겨 다시 찾는다
            rec.nudgeTried = true;
            const hit = await nudge(pt, ymd);
            if (hit) { rec.qLat = hit.lat; rec.qLon = hit.lon; rec.nudgeKm = hit.km; items = await day(hit.lat, hit.lon, ymd); }
        }
        if (!items) {
            if (++failStreak >= BREAKER) stop = stop || `연속 ${BREAKER}회 실패(TideBED 장애 추정)`;
            break;
        }
        failStreak = 0;
        if (items.nogrid) { rec.status = 'no_grid'; rec.nogridCode = items.code; save(); break; }
        if (items.length < 1380) { console.log(`  ? ${pt.id} ${ymd}: ${items.length}줄뿐 — 건너뜀`); continue; }
        const f = items[0];
        if (!rec.ref) {
            Object.assign(rec, { ref: f.obsvtrNm, refLat: f.lat, refLon: f.lot, josi: f.josi, jogo: parseFloat(f.jogo), msl: f.msl });
        } else if (rec.ref !== f.obsvtrNm || rec.josi !== f.josi) {
            // 날짜에 따라 기준항·조시차가 바뀌면 「표준항 표로 계산」이 성립하지 않는다 → 따로 표시
            rec.refChanged = (rec.refChanged || []).concat([{ ymd, ref: f.obsvtrNm, josi: f.josi }]);
        }
        const shift = mins(f.slctdDt) - mins(f.obsrvnDt);
        if (rec.shiftMin == null) rec.shiftMin = shift > 720 ? shift - 1440 : (shift < -720 ? shift + 1440 : shift);
        rec.days[ymd] = summarize(items, ymd);
        save();
    }
    return rec;
}

async function main() {
    if (!YEAR || !keys.length) { console.error('사용: TIDEBED_KEYS=… node collect_tidebed_verify.js <연도> [--budget N] [--until HH:MM] [--limit N]'); process.exit(1); }
    fs.mkdirSync(OUT, { recursive: true });
    const lines = fs.readFileSync(path.join(DIR, '_points.csv'), 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
    let pts = lines.filter(c => c[5] === '임의항').map(c => ({ id: c[0], name: c[2], lat: c[3], lon: c[4] }));
    const isDone = p => {
        const f = path.join(OUT, p.id + '.json');
        if (!fs.existsSync(f)) return false;
        const r = JSON.parse(fs.readFileSync(f, 'utf8'));
        return r.status === 'no_grid' || DAYS.every(md => r.days[YEAR + md]);
    };
    const total = pts.length;
    if (args.includes('--params')) {
        const need = pts.filter(p => { const f = path.join(OUT, p.id + '.json'); if (!fs.existsSync(f)) return true; const r = JSON.parse(fs.readFileSync(f, 'utf8')); return !r.ref && r.status !== 'no_grid'; });
        console.log(`재료만 받기: 임의항 ${total}곳 · 재료 있는 곳 ${total - need.length} · 받을 곳 ${need.length}`);
        let i = 0, ok = 0, ng = 0;
        await Promise.all(Array.from({ length: PARALLEL }, async () => {
            while (!stop && i < need.length) { const r = await doParam(need[i++]); if (r.status === 'no_grid') { ng++; console.log(`  – ${r.id} ${r.name}: 격자 미제공`); } else if (r.ref) ok++; }
        }));
        console.log(`끝: 재료 받은 곳 ${ok} · 격자 미제공 ${ng} · 호출 ${calls}번 · 멈춘 까닭: ${stop || '남은 지점 없음'}`);
        return;
    }
    pts = pts.filter(p => !isDone(p));
    console.log(`임의항 ${total}곳 · 이미 끝남 ${total - pts.length}곳 · 남음 ${pts.length}곳 · 키 ${keys.length}개 × ${BUDGET}번 · ${UNTIL} KST 까지`);
    if (LIMIT) pts = pts.slice(0, LIMIT);
    let idx = 0, done = 0, nogrid = 0;
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
        while (!stop && idx < pts.length) {
            const pt = pts[idx++];
            const rec = await doPoint(pt);
            if (rec.status === 'no_grid') { nogrid++; console.log(`  – ${pt.id} ${pt.name}: 격자 미제공`); }
            else if (DAYS.every(md => rec.days[YEAR + md])) {
                done++;
                if (done % 20 === 0) console.log(`  ✓ ${done}곳 끝 (호출 ${calls}번)`);
            }
        }
    }));
    console.log(`끝: 이번에 ${done}곳 완료 · 격자 미제공 ${nogrid}곳 · 호출 ${calls}번 · 멈춘 까닭: ${stop || '남은 지점 없음(또는 --limit)'} · 키별 남은 횟수 ${keys.map(k => k.left)}`);
}
main();
