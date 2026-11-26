#!/usr/bin/env node
/**
 * 파일명: local_server/scripts/collect_tidebed_fullyear.js
 * 역할: 12일 대조에서 「불합격」(시각 ±10분 또는 높이 ±10cm 밖)이 나온 임의항만, 실제 TideBED 곡선을 1년치 통째로 받아
 *       날마다 고조·저조를 바텀시트와 같은 함수(findTidePeaks)로 뽑아 둔다. 계산값 대신 이 값을 쓰게 하려는 것이다.
 *       (TIDE_YEAR_COLLECT_README.md 「정해 둔 기본값 3」 — 불합격이 50곳 이하면 그 지점만 통째로 받는다.)
 *
 * [쓰는 법]
 *   TIDEBED_KEYS="키1,키2,키3" NODE_USE_ENV_PROXY=1 node local_server/scripts/collect_tidebed_fullyear.js 2027 \
 *       [--budget 7000] [--until 06:50] [--ids 211,1188]
 *   --ids 를 안 주면 points_<연도>/verify_detail.json 에서 불합격 지점을 고른다(50곳 넘으면 받지 않고 멈춘다).
 *   지점 1곳 = 367일(앞뒤 하루 포함) × 5페이지 ≈ 1,835번. 끊겨도 받은 날까지 남아 다음 실행이 이어받는다.
 *
 * [바텀시트와 같게 한 점]
 *   그날 고조·저조 = findTidePeaks(전날+그날+다음날 1분 곡선, 그날) — 앞뒤 날을 이어 붙여 자정 근처 물때도 잡는다.
 *
 * [연계]
 *   - 읽는 것: points_<연도>/verify_detail.json · points_<연도>/tidebed_verify/<id>.json(옮겨 물은 좌표 qLat·qLon) · local_server/peak_finder.js
 *   - 쓰는 것: points_<연도>/tidebed_full/<id>.json
 *       { id, name, lat, lon, peaks: { 'YYYYMMDD': {highTide1:{time,height},…} }, tail: { 'YYYYMMDD': [[slctdDt, slctdHgt], …] } }
 *       tail = 이어받기용으로 마지막 이틀 원자료만 남긴다(1년치 원자료는 저장하지 않는다).
 *   - 다음 단계: build_tide_points_year.js 가 peaks 가 그 해 날짜를 다 덮은 지점을 method 'tidebed실측' 으로 바꿔 쓴다.
 * [로드 순서] 단독 실행 스크립트.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { findTidePeaks } = require('../peak_finder');

const URL_BASE = 'https://apis.data.go.kr/1192136/tidebed/GetTidebedApiService';
const args = process.argv.slice(2);
const YEAR = +args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BUDGET = parseInt(opt('--budget', '7000'), 10);
const UNTIL = opt('--until', '06:50');
const PD = path.join(__dirname, '..', '..', 'client', 'tide_data', `points_${YEAR}`);
const OUT = path.join(PD, 'tidebed_full');
const MAX_POINTS = 50;
const BREAKER = 8;

const keys = (process.env.TIDEBED_KEYS || '').split(',').map(s => s.trim()).filter(Boolean).map(k => ({ k, left: BUDGET }));
let rr = 0, calls = 0, stop = null, failStreak = 0;
const kstMin = () => { const d = new Date(Date.now() + 9 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const startMin = kstMin();
/** 멈출 시각(KST)을 지났나 — 밤에 시작해 새벽까지 도는 경우도 셈한다(collect_tidebed_verify.js 와 같다). */
function pastUntil() {
    const [h, m] = UNTIL.split(':').map(Number), until = h * 60 + m, now = kstMin();
    return startMin > until ? (now <= startMin && now >= until) : now >= until;
}
function pickKey() {
    for (let i = 0; i < keys.length; i++) { const c = keys[(rr++) % keys.length]; if (c.left > 0) { c.left--; return c; } }
    return null;
}
/** TideBED 한 페이지 → item 배열 | 'nogrid' | null(실패). collect_tidebed_verify.js page() 와 같은 요청. */
async function page(lat, lon, ymd, p) {
    for (let t = 0; t < 8; t++) {
        const c = pickKey();
        if (!c) { stop = stop || '키 한도 소진'; return null; }
        calls++;
        try {
            const r = await fetch(`${URL_BASE}?serviceKey=${encodeURIComponent(c.k)}&lat=${lat}&lot=${lon}&reqDate=${ymd}&type=json&min=1&numOfRows=300&pageNo=${p}`, { signal: AbortSignal.timeout(40000) });
            const text = await r.text();
            if (/LIMITED_NUMBER|SERVICE_KEY|DEADLINE/.test(text)) { c.left = 0; continue; }
            const j = JSON.parse(text), h = j.header || {}, rc = String(h.resultCode);
            if (rc === '00') { const it = j.body && j.body.items && j.body.items.item; return Array.isArray(it) ? it : (it ? [it] : []); }
            if (rc === '10' || rc === '03') return 'nogrid';
        } catch (e) { /* 끊김·시간 초과 → 다시 */ }
        await new Promise(r => setTimeout(r, Math.min(1500 * (t + 1), 15000)));
    }
    return null;
}
async function day(lat, lon, ymd) {
    const all = [];
    for (let p = 1; p <= 5; p++) {
        const r = await page(lat, lon, ymd, p);
        if (r === null) return null;
        if (r === 'nogrid') return 'nogrid';
        all.push(...r);
    }
    return all.map(i => [i.slctdDt, i.slctdHgt]);
}
const ymdOf = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const iso = ymd => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
/** 그날 고조·저조 — 바텀시트와 같은 findTidePeaks(앞뒤 날을 이어 붙인 곡선, 그날). */
function peaksOf(prev, cur, next, ymd) {
    const items = [].concat(prev || [], cur, next || []).map(([t, h]) => ({ slctdDt: t, slctdHgt: h }));
    const pk = findTidePeaks(items, iso(ymd)), out = {};
    for (const k of Object.keys(pk)) if (/Tide\d$/.test(k) && pk[k]) out[k] = pk[k];
    return out;
}

async function doPoint(id, name) {
    const file = path.join(OUT, id + '.json');
    const vf = path.join(PD, 'tidebed_verify', id + '.json');
    const v = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf8')) : {};
    const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { id, name: name || v.name || '', lat: v.qLat || v.lat, lon: v.qLon || v.lon, peaks: {}, tail: {} };
    const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(rec)); fs.renameSync(file + '.tmp', file); };
    const days = [];
    for (let t = Date.UTC(YEAR - 1, 11, 31); t <= Date.UTC(YEAR + 1, 0, 1); t += 86400000) days.push(ymdOf(new Date(t)));
    if (opt('--max-days')) days.splice(+opt('--max-days'));   // 시험용 — 앞쪽 며칠만
    // 그 해 날짜 D 의 물때를 구하려면 D-1·D·D+1 원자료가 있어야 한다 — tail(지난 실행의 마지막 이틀)부터 이어 간다
    const Y = String(YEAR);
    const want = j => j >= 0 && j < days.length && days[j].slice(0, 4) === Y && !rec.peaks[days[j]];
    const raw = Object.assign({}, rec.tail);
    for (let i = 0; i < days.length; i++) {
        if (!(want(i - 1) || want(i) || want(i + 1))) continue;   // 이 날 원자료로 구할 물때가 없다
        const ymd = days[i];
        if (!raw[ymd]) {
            if (stop || pastUntil()) { stop = stop || `멈출 시각(${UNTIL} KST)`; break; }
            const r = await day(rec.lat, rec.lon, ymd);
            if (r === null) { if (++failStreak >= BREAKER) stop = stop || `연속 ${BREAKER}회 실패`; break; }
            failStreak = 0;
            raw[ymd] = r === 'nogrid' ? [] : r;
        }
        // 이 날 원자료가 들어왔으니 전날(D-1)의 물때를 구한다(다음 날 자료가 없음이면 빈 채로)
        const d1 = days[i - 1];
        if (want(i - 1) && raw[d1] && raw[d1].length) rec.peaks[d1] = peaksOf(raw[days[i - 2]], raw[d1], raw[ymd], d1);
        rec.tail = {}; for (const k of [d1, ymd]) if (k && raw[k]) rec.tail[k] = raw[k];   // 이어받기용 원자료는 마지막 이틀만
        for (const k of Object.keys(raw)) if (i >= 2 && k < days[i - 2]) delete raw[k];
        if (i % 10 === 0) save();
    }
    save();
    return Object.keys(rec.peaks).filter(k => k.slice(0, 4) === String(YEAR)).length;
}

async function main() {
    if (!YEAR || !keys.length) { console.error('사용: TIDEBED_KEYS=… node collect_tidebed_fullyear.js <연도> [--budget N] [--until HH:MM] [--ids a,b]'); process.exit(1); }
    fs.mkdirSync(OUT, { recursive: true });
    let list;
    if (opt('--ids')) list = opt('--ids').split(',').map(id => ({ id: id.trim(), name: '' }));
    else {
        const det = JSON.parse(fs.readFileSync(path.join(PD, 'verify_detail.json'), 'utf8'));
        list = det.filter(d => d.dMin > 10 || d.dCm > 10).map(d => ({ id: String(d.id), name: d.name }));
        if (list.length > MAX_POINTS) { console.log(`불합격 ${list.length}곳 — ${MAX_POINTS}곳을 넘어 통째로 받지 않는다(계산 방식부터 살핀다).`); return; }
    }
    const daysInYear = (YEAR % 4 === 0 && (YEAR % 100 !== 0 || YEAR % 400 === 0)) ? 366 : 365;
    console.log(`1년치 통째로 받기: ${list.length}곳 (${list.map(x => x.id + ' ' + x.name).join(', ')}) · 키 ${keys.length}개 × ${BUDGET}번 · ${UNTIL} KST 까지`);
    for (const p of list) {
        if (stop) break;
        const n = await doPoint(p.id, p.name);
        console.log(`  ${p.id} ${p.name}: ${n}/${daysInYear}일`);
    }
    console.log(`끝: 호출 ${calls}번 · 멈춘 까닭: ${stop || '남은 지점 없음'} · 키별 남은 횟수 ${keys.map(k => k.left)}`);
}
main();
