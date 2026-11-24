#!/usr/bin/env node
/**
 * 파일명: local_server/scripts/build_tide_points_year.js
 * 역할: 목록 지점(바다타임 1,575곳)마다 1년치 고조·저조를 만들어 지점별 작은 파일로 쌓고,
 *       임의항은 실제 TideBED 12일(collect_tidebed_verify.js 가 받아 둔 것)과 대조해 보고서를 쓴다.
 *       (목적 — 사용자 2026-11-23: 「바다타임처럼 지정된 위치에 대해서는 로딩없이 바로 보여주고자」)
 *
 * [만드는 방식 — 지점 구분별]
 *   표준항      : 그 표준항의 조석표 그대로.
 *   임의항(ok)  : TideBED 가 응답에 준 기준 표준항·조시차·보정식으로 **계산** —
 *                 시각 = 기준항 시각 + shiftMin 분, 높이 = round(a × 기준항 높이 + b)  (a·b = 12일 보정식의 중앙값).
 *                 밀린 시각이 자정을 넘으면 그 날짜로 옮긴다(그래서 기준항의 앞뒤 하루 _edge.csv 가 있으면 쓴다).
 *   동해북부(위도≥36·경도≥128) : 지금 앱 방식 — 자료 있는 가까운 표준항 3곳을 거리 제곱 반비례로 섞는다
 *                 (client/tide.js findNearestStationsWithData → interpolateTideByIDW 를 **그대로 옮겼다**. 고치면 거기와 함께).
 *   그 밖에 TideBED 로 못 만드는 임의항(격자 없음 · 기준항을 못 찾음 · 기준항이 날짜마다 바뀜) : **만들지 않는다**(method '없음').
 *                 사용자 확정 2026-11-24: 「동해 36도 이북 해역에 대해서만 3곳 보정하고 나머지 위치(표준항을 제외한 임의항)에 대해서는
 *                 보간법을 사용하지 말도록 해줘.」
 *
 * [쓰는 법]
 *   node local_server/scripts/build_tide_points_year.js 2027            # 계산·대조만(보고서만 쓴다)
 *   node local_server/scripts/build_tide_points_year.js 2027 --write    # 지점 파일(p/<id>.json)·목록(index.json)까지 쓴다
 *   기준 표준항 CSV 가 아직 없는 임의항은 「대기」로 세고 건너뛴다(표준항이 끝난 것부터 부분 실행 가능).
 *
 * [연계]
 *   - 읽는 것: client/tide_data/points_<연도>/_points.csv · points_<연도>/tidebed_verify/<id>.json ·
 *             Raw_tide_data/<연도>_hghlw/<코드>.csv · _coords.csv · _edge.csv(있으면) · client/tide.js(표준항 목록 — 이름·코드·좌표)
 *   - 쓰는 것: points_<연도>/p/<id>.json  { id, name, year, method, ref?, rows:[{date, highTide1Time, highTide1Level, …, range(조차 cm), flow(물흐름 %)}] }
 *             points_<연도>/index.json   [{ id, name, region, lat, lon, method, ref, shiftMin }]
 *             points_<연도>/VERIFY_REPORT.md · points_<연도>/verify_detail.json
 *   - 검증 기준: TIDE_YEAR_COLLECT_README.md 「정해 둔 기본값 3」 — ±10분·±10cm 안이면 합격.
 * [로드 순서] 단독 실행 스크립트.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const YEAR = process.argv[2];
const WRITE = process.argv.includes('--write');
const TD = path.join(__dirname, '..', '..', 'client', 'tide_data');
const PD = path.join(TD, `points_${YEAR}`);
const SRC = path.join(TD, 'Raw_tide_data', `${YEAR}_hghlw`);
const ALIAS = { DT_0903: 'DT_0040', DT_0066: 'SO_0565' };   // API 코드 → 앱 이름표(build_tide_year_file.js 와 같다)
const EDGE_MIN = 30;       // TideBED 하루치 가장자리 이 분 안의 고조·저조는 대조에서 뺀다
const PASS_MIN = 10, PASS_CM = 10;

const csv = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).map(l => l.split(',').map(x => x.replace(/^"|"$/g, '')));
const toMin = dt => Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10), +dt.slice(11, 13), +dt.slice(14, 16)) / 60000;
const fromMin = m => { const d = new Date(m * 60000); return { date: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(), hhmm: d.getUTCHours() * 100 + d.getUTCMinutes(), mod: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const norm = s => String(s).replace(/\(.*?\)/g, '').replace(/(항|도)$/, '');

// ── 표준항: 목록(앱)·원본 줄 ───────────────────────────────────────────
/** client/tide.js 의 표준항 목록 [{code,name,lat,lon}] — 앱이 3곳 섞기에 쓰는 바로 그 목록. */
function appStations() {
    const src = fs.readFileSync(path.join(TD, '..', 'tide.js'), 'utf8');
    return [...src.matchAll(/\{\s*code:\s*"([A-Z]{2}_\d+)",\s*name:\s*"([^"]+)",\s*lat:\s*([\d.]+),\s*lon:\s*([\d.]+)/g)]
        .map(m => ({ code: m[1], name: m[2], lat: +m[3], lon: +m[4] }));
}
const stdEvents = new Map();   // API 코드 → [{t(분), lv, hl}] 시각순(가장자리 포함)
function loadStd(code) {
    if (stdEvents.has(code)) return stdEvents.get(code);
    const f = path.join(SRC, code + '.csv');
    if (!fs.existsSync(f)) { stdEvents.set(code, null); return null; }
    const ev = csv(f).slice(1).map(c => ({ t: toMin(c[2]), lv: +c[3], hl: c[4] === '고조' ? 'H' : 'L' }));
    stdEvents.set(code, ev);
    return ev;
}
/** 줄들 [{t,lv,hl}] → 그 해 날짜별 한 줄(표준항 파일과 같은 칸). */
function toRows(events) {
    const by = new Map();
    for (const e of events) {
        const f = fromMin(e.t);
        if (Math.floor(f.date / 10000) !== +YEAR) continue;
        if (!by.has(f.date)) by.set(f.date, []);
        by.get(f.date).push({ ...e, hhmm: f.hhmm });
    }
    return [...by.keys()].sort((a, b) => a - b).map(date => {
        const list = by.get(date).sort((a, b) => a.t - b.t), row = { date };
        for (const [hl, key] of [['H', 'highTide'], ['L', 'lowTide']]) {
            list.filter(x => x.hl === hl).slice(0, 4).forEach((x, i) => { row[`${key}${i + 1}Time`] = x.hhmm; row[`${key}${i + 1}Level`] = x.lv; });
        }
        return row;
    });
}

/**
 * 물흐름 — 날마다 조차(range, cm)와 물흐름(flow, %)을 줄에 더한다.
 *   range = 그날 가장 높은 고조 − 가장 낮은 저조.
 *   flow  = round( (range − 최소) ÷ (최대 − 최소) × 100 ),  최대·최소 = **그날 앞뒤 15일(모두 31일) 안의** 가장 큰·작은 조차.
 * 예) 앞뒤 15일의 조차가 82~297cm 이고 그날이 183cm → (183−82)/(297−82) = 47%.
 * [왜 이 식인가] 사용자 2026-11-24 「물 흐름도 함께 계산토록해줘」 — 바다타임 「물흐름」은 화면 숫자로 검산하니 조차를 0~100% 로 바꾼 값이다
 *   (제주 2026-11-24~12-08 15일: 「최대」가 그 사리의 최대 조차 297cm 에 붙고, 연중 최대 309cm 가 아니다 → 기준은 1년이 아니라 가까운 기간).
 *   ⚠바다타임의 0% 기준은 화면만으로 알아내지 못했다(거꾸로 맞추면 107cm 쯤인데 앞뒤 어느 조금의 최소값(94·110·82)과도 다르다).
 *   그래서 이 식은 바다타임과 **같지 않다** — 같은 15일을 견주면 평균 4.9%p 차이. 기준을 알게 되면 여기만 고치면 된다(range 는 그대로 쓴다).
 * @param {Array} rows 날짜순 줄(제자리에서 고친다). 고조나 저조가 없는 날은 range·flow 를 넣지 않는다.
 */
function addFlow(rows) {
    const rng = rows.map(r => {
        const h = [1, 2, 3, 4].map(i => r[`highTide${i}Level`]).filter(v => v != null), l = [1, 2, 3, 4].map(i => r[`lowTide${i}Level`]).filter(v => v != null);
        return h.length && l.length ? Math.max(...h) - Math.min(...l) : null;
    });
    rows.forEach((r, i) => {
        if (rng[i] == null) return;
        const w = rng.slice(Math.max(0, i - 15), i + 16).filter(v => v != null);
        const mn = Math.min(...w), mx = Math.max(...w);
        r.range = rng[i];
        r.flow = mx > mn ? Math.round((rng[i] - mn) / (mx - mn) * 100) : 0;
    });
    return rows;
}

// ── 앱 방식(표준항 3곳 섞기) — client/tide.js 에서 그대로 옮김 ─────────────
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function timeToMinutes(timeStr) {
    if (!timeStr && timeStr !== 0) return 0;
    const str = String(timeStr).padStart(4, '0');
    return parseInt(str.substring(0, 2)) * 60 + parseInt(str.substring(2, 4));
}
function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = Math.round(totalMinutes % 60);
    return parseInt(String(hours).padStart(2, '0') + String(minutes).padStart(2, '0'));
}
/** client/tide.js interpolateTideByIDW 와 같은 계산(가장 가까운 항의 고조·저조 순번만, 시각·높이 각각 1/d² 가중). */
function interpolateTideByIDW(stationsWithData) {
    if (stationsWithData.length === 1) return { ...stationsWithData[0].tideInfo };
    const primary = stationsWithData[0], result = {};
    for (const kind of ['highTide', 'lowTide']) for (let i = 1; i <= 4; i++) {
        const timeKey = `${kind}${i}Time`, levelKey = `${kind}${i}Level`;
        if (primary.tideInfo[timeKey] === undefined) continue;
        for (const [key, conv, out] of [[timeKey, timeToMinutes, minutesToTime], [levelKey, x => x, Math.round]]) {
            const st = stationsWithData.filter(s => s.tideInfo[key] !== undefined);
            if (!st.length) continue;
            const w = st.map(s => s.distance < 0.1 ? 1000000 : 1 / Math.pow(s.distance, 2));
            const tot = w.reduce((a, b) => a + b, 0);
            result[key] = out(st.reduce((sum, s, idx) => sum + conv(s.tideInfo[key]) * (w[idx] / tot), 0));
        }
    }
    return result;
}
let _idwCtx = null;
/** 표준항 3곳 섞기로 한 지점의 1년치. 표준항 조석표(앱 이름표 코드 기준)가 다 있어야 앱과 같은 값이 나온다. */
function rowsByIDW(lat, lon) {
    if (!_idwCtx) {
        const stations = appStations();
        const back = Object.fromEntries(Object.entries(ALIAS).map(([api, app]) => [app, api]));
        const table = new Map();   // 앱 코드 → Map(date → row)
        for (const s of stations) {
            const ev = loadStd(back[s.code] || s.code);
            if (ev) table.set(s.code, new Map(toRows(ev).map(r => [r.date, r])));
        }
        _idwCtx = { stations, table };
    }
    const { stations, table } = _idwCtx;
    const near = stations.map(s => ({ ...s, distance: calculateDistance(lat, lon, s.lat, s.lon) })).sort((a, b) => a.distance - b.distance);
    const rows = [], used = new Set();
    for (let t = Date.UTC(+YEAR, 0, 1); new Date(t).getUTCFullYear() === +YEAR; t += 86400000) {
        const d = new Date(t), date = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        const withData = [];
        for (const s of near) {
            const info = table.get(s.code) && table.get(s.code).get(date);
            if (info) { withData.push({ ...s, tideInfo: info }); if (withData.length === 3) break; }
        }
        if (!withData.length) continue;
        withData.forEach(s => used.add(s.name));
        const r = interpolateTideByIDW(withData);
        rows.push({ date, ...Object.fromEntries(Object.entries(r).filter(([k]) => /Tide\d(Time|Level)$/.test(k))) });
    }
    return { rows, used: [...used] };
}

// ── 대조 ─────────────────────────────────────────────────────────────
/** 한 지점·하루: 실제(TideBED 곡선의 고조·저조) vs 계산값. 가장자리는 뺀다.
 *  @returns {{dMin:number, dCm:number, unmatched:number, n:number}} */
function compareDay(day, ymd, row) {
    const lo = EDGE_MIN, hi = 1440 - EDGE_MIN;
    const dayStart = toMin(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)} 00:00`);
    // TideBED 하루치가 덮는 구간(지점 시각) — 그 안쪽 30분만 믿는다
    const from = Math.max(lo, toMin(day.first) - dayStart + EDGE_MIN), to = Math.min(hi, toMin(day.last) - dayStart - EDGE_MIN);
    const inWin = m => m >= from && m <= to;
    let dMin = 0, dCm = 0, unmatched = 0, n = 0;
    for (const kind of ['highTide', 'lowTide']) {
        const act = [1, 2, 3, 4].map(i => day.peaks[kind + i]).filter(Boolean).map(p => ({ m: timeToMinutes(p.time.replace(':', '')), cm: p.height }));
        const cal = row ? [1, 2, 3, 4].filter(i => row[`${kind}${i}Time`] != null).map(i => ({ m: timeToMinutes(row[`${kind}${i}Time`]), cm: row[`${kind}${i}Level`] })) : [];
        const usedCal = new Set();
        for (const a of act) {
            let best = -1, bd = 1e9;
            cal.forEach((c, i) => { const d = Math.abs(c.m - a.m); if (!usedCal.has(i) && d < bd) { bd = d; best = i; } });
            if (best >= 0 && bd <= 120) {
                usedCal.add(best);
                if (inWin(a.m) && inWin(cal[best].m)) { n++; dMin = Math.max(dMin, bd); dCm = Math.max(dCm, Math.abs(cal[best].cm - a.cm)); }
            } else if (inWin(a.m)) unmatched++;
        }
        cal.forEach((c, i) => { if (!usedCal.has(i) && inWin(c.m)) unmatched++; });
    }
    return { dMin, dCm, unmatched, n };
}

function main() {
    if (!YEAR) { console.error('사용: node build_tide_points_year.js <연도> [--write]'); process.exit(1); }
    const pts = csv(path.join(PD, '_points.csv')).slice(1).map(c => ({ id: c[0], region: c[1], name: c[2], lat: +c[3], lon: +c[4], kind: c[5], std: c[6] }));
    // 기준 표준항 이름 → API 코드: 조석예보 API 가 준 이름(_coords.csv) 먼저, 없으면 앱 목록(이름 끝 항·도 무시)
    const nameToCode = new Map();
    if (fs.existsSync(path.join(SRC, '_coords.csv'))) for (const c of csv(path.join(SRC, '_coords.csv'))) nameToCode.set(norm(c[1]), c[0]);
    const back = Object.fromEntries(Object.entries(ALIAS).map(([api, app]) => [app, api]));
    for (const s of appStations()) if (!nameToCode.has(norm(s.name))) nameToCode.set(norm(s.name), back[s.code] || s.code);
    // 앞뒤 하루(있으면) — 기준항 줄에 덧붙인다
    const edge = new Map();
    if (fs.existsSync(path.join(SRC, '_edge.csv'))) for (const c of csv(path.join(SRC, '_edge.csv')).slice(1)) {
        if (!edge.has(c[0])) edge.set(c[0], []);
        edge.get(c[0]).push({ t: toMin(c[2]), lv: +c[3], hl: c[4] === '고조' ? 'H' : 'L' });
    }
    if (WRITE) fs.mkdirSync(path.join(PD, 'p'), { recursive: true });

    const index = [], detail = [], cnt = {};
    const bump = k => { cnt[k] = (cnt[k] || 0) + 1; };
    for (const p of pts) {
        let method, rows = null, ref = null, shiftMin = null, note = null, cmp = null;
        const vf = path.join(PD, 'tidebed_verify', p.id + '.json');
        const v = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf8')) : null;
        if (p.kind === '표준항') {
            const ev = loadStd(back[p.std] || p.std);
            method = '표준항'; ref = p.std;
            if (ev) rows = toRows(ev); else note = '표준항 자료 대기';
        } else if (p.kind === '임의항' && !v) {
            method = 'tidebed계산'; note = 'TideBED 12일 대기';
        } else if (p.kind === '임의항' && v.status === 'ok' && v.ref && (Object.keys(v.days).length || v.param)) {
            method = 'tidebed계산'; ref = v.ref; shiftMin = v.shiftMin;
            const code = nameToCode.get(norm(v.ref));
            const ev = code && loadStd(code);
            if (!code) { method = '없음'; note = `기준항 「${v.ref}」을 표준항 목록에서 못 찾음`; }
            else if (!ev) note = '기준 표준항 자료 대기';
            else if (v.refChanged) { method = '없음'; note = '날짜에 따라 기준항·조시차가 바뀜'; }
            else {
                // 보정식: 12일을 받았으면 그 중앙값, 아직이면 「재료만 받기」의 하루치(10분 간격) 식
                const fits = Object.keys(v.days).length ? Object.values(v.days).map(d => d.fit) : [v.param.fit];
                const a = median(fits.map(f => f.a)), b = median(fits.map(f => f.b));
                const all = ev.concat(edge.get(code) || []);
                rows = toRows(all.map(e => ({ t: e.t + v.shiftMin, lv: Math.round(a * e.lv + b), hl: e.hl })));
                const byDate = new Map(rows.map(r => [r.date, r]));
                if (Object.keys(v.days).length) cmp = { dMin: 0, dCm: 0, unmatched: 0, n: 0, days: Object.keys(v.days).length, a: +a.toFixed(4), b: +b.toFixed(2), worst: null };
                else note = '1년치 계산됨 · 12일 대조 대기';
                for (const [ymd, day] of Object.entries(v.days)) {
                    const c = compareDay(day, ymd, byDate.get(+ymd));
                    if (c.dMin > cmp.dMin || c.dCm > cmp.dCm) cmp.worst = ymd;
                    cmp.dMin = Math.max(cmp.dMin, c.dMin); cmp.dCm = Math.max(cmp.dCm, c.dCm); cmp.unmatched += c.unmatched; cmp.n += c.n;
                }
            }
        } else if (p.kind === '동해북부') {
            method = '표준항3곳'; note = '동해 36도 이북(TideBED 미제공)';
        } else {
            // 표준항 3곳 섞기는 동해 36도 이북에만 쓴다(사용자 확정 2026-11-24) — 그 밖의 임의항은 TideBED 로 못 만들면 자료를 만들지 않는다.
            method = '없음';
            note = v && v.status === 'no_grid' ? 'TideBED 격자 없음(둘레에도 없음)' : 'TideBED 자료 불완전';
        }
        if (method === '표준항3곳') { const r = rowsByIDW(p.lat, p.lon); rows = r.rows; ref = r.used.join('·'); }
        bump(method === '없음' ? '자료 없음(만들지 않음)' : rows ? method : '대기');
        index.push({ id: +p.id, name: p.name, region: p.region, lat: p.lat, lon: p.lon, method, ref, shiftMin, ready: !!rows, note,
            ...(v && v.qLat ? { qLat: +v.qLat, qLon: +v.qLon, nudgeKm: v.nudgeKm } : {}) });
        if (cmp) detail.push({ id: +p.id, name: p.name, region: p.region, ref, shiftMin, ...cmp });
        if (rows) addFlow(rows);
        if (WRITE && rows) fs.writeFileSync(path.join(PD, 'p', p.id + '.json'), JSON.stringify({ id: +p.id, name: p.name, year: +YEAR, method, ref, rows }));
    }

    // ── 보고서 ──
    const band = { '±2분·2cm 안': 0, '±5 안': 0, '±10 안': 0, '그 밖': 0 };
    const fail = [], cntDiff = [];
    for (const d of detail) {
        const w = Math.max(d.dMin, d.dCm);
        band[w <= 2 ? '±2분·2cm 안' : w <= 5 ? '±5 안' : w <= 10 ? '±10 안' : '그 밖']++;
        if (d.dMin > PASS_MIN || d.dCm > PASS_CM) fail.push(d);
        if (d.unmatched) cntDiff.push(d);
    }
    const lines = [`# 임의항 1년치 계산 — 실제 TideBED 12일 대조 (${YEAR}년)`, '',
        `> 만든 때: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST · 도구: local_server/scripts/build_tide_points_year.js`,
        '> 대조 = 지점마다 한 달에 하루씩 받은 실제 TideBED 곡선의 고조·저조(바텀시트의 findTidePeaks) vs 표준항 표로 계산한 값.',
        `> 하루치 곡선의 가장자리 ${EDGE_MIN}분 안은 뺐다. 합격 기준 = 시각 ±${PASS_MIN}분 · 높이 ±${PASS_CM}cm.`, '',
        '## 지점 수', '', '| 만든 방식 | 곳 |', '|---|---:|', ...Object.entries(cnt).map(([k, v]) => `| ${k} | ${v} |`), '',
        `## 대조한 임의항 ${detail.length}곳 — 지점별 가장 큰 차이`, '', '| 구간 | 곳 |', '|---|---:|', ...Object.entries(band).map(([k, v]) => `| ${k} | ${v} |`), '',
        `- 불합격(±${PASS_MIN}분·${PASS_CM}cm 밖): **${fail.length}곳**`,
        `- 고조·저조 개수가 실제와 다른 날이 있는 곳: **${cntDiff.length}곳** (합계 ${cntDiff.reduce((s, d) => s + d.unmatched, 0)}건)`, ''];
    if (fail.length) lines.push('## 불합격 지점', '', '| id | 지점 | 해역 | 기준항 | 조시차(분) | 시각 최대 차(분) | 높이 최대 차(cm) | 가장 나쁜 날 |', '|---:|---|---|---|---:|---:|---:|---|',
        ...fail.sort((x, y) => Math.max(y.dMin, y.dCm) - Math.max(x.dMin, x.dCm)).map(d => `| ${d.id} | ${d.name} | ${d.region} | ${d.ref} | ${d.shiftMin} | ${d.dMin} | ${d.dCm} | ${d.worst} |`), '');
    if (cntDiff.length) lines.push('## 고조·저조 개수가 다른 곳(위 40곳)', '', '| id | 지점 | 해역 | 기준항 | 안 맞은 건수 |', '|---:|---|---|---|---:|',
        ...cntDiff.sort((x, y) => y.unmatched - x.unmatched).slice(0, 40).map(d => `| ${d.id} | ${d.name} | ${d.region} | ${d.ref} | ${d.unmatched} |`), '');
    // ── 리스트업(사용자 2026-11-24: 「대조결과 차이 2분 이상 차이나는 개소 등 정리해서 리스트업」) ──
    const row = d => `| ${d.id} | ${d.name} | ${d.region} | ${d.ref} | ${d.shiftMin} | ${d.dMin} | ${d.dCm} | ${d.unmatched} | ${d.worst || ''} |`;
    const head = ['| id | 지점 | 해역 | 기준항 | 조시차(분) | 시각 최대 차(분) | 높이 최대 차(cm) | 개수 다른 건 | 가장 나쁜 날 |', '|---:|---|---|---|---:|---:|---:|---:|---|'];
    const t2 = detail.filter(d => d.dMin >= 2).sort((x, y) => y.dMin - x.dMin || x.id - y.id);
    const c2 = detail.filter(d => d.dCm >= 2 && d.dMin < 2).sort((x, y) => y.dCm - x.dCm || x.id - y.id);
    lines.push(`## 리스트업 ① 시각이 2분 이상 차이 난 곳 — ${t2.length}곳`, '', ...(t2.length ? [...head, ...t2.map(row)] : ['없음']), '',
        `## 리스트업 ② 높이가 2cm 이상 차이 난 곳(①에 없는 곳) — ${c2.length}곳`, '', ...(c2.length ? [...head, ...c2.map(row)] : ['없음']), '');
    const moved = index.filter(i => i.nudgeKm).sort((x, y) => y.nudgeKm - x.nudgeKm || x.id - y.id);
    lines.push(`## 리스트업 ③ 좌표를 옮겨 TideBED 를 받은 곳 — ${moved.length}곳 (최대 2km)`, '',
        ...Object.entries(moved.reduce((m, i) => { m[i.nudgeKm] = (m[i.nudgeKm] || 0) + 1; return m; }, {})).map(([k, v]) => `- 약 ${k}km: ${v}곳`), '',
        '| id | 지점 | 해역 | 옮긴 거리(km) | 기준항 |', '|---:|---|---|---:|---|', ...moved.map(i => `| ${i.id} | ${i.name} | ${i.region} | ${i.nudgeKm} | ${i.ref} |`), '');
    const none = index.filter(i => i.method === '없음');
    lines.push(`## 리스트업 ④ 자료를 만들지 않은 곳 — ${none.length}곳`, '', '| id | 지점 | 해역 | 위도 | 경도 | 까닭 |', '|---:|---|---|---:|---:|---|', ...none.map(i => `| ${i.id} | ${i.name} | ${i.region} | ${i.lat} | ${i.lon} | ${i.note} |`), '');
    const idw = index.filter(i => i.method === '표준항3곳');
    lines.push(`## 리스트업 ⑤ 표준항 3곳 섞기로 만든 곳(동해 36도 이북) — ${idw.length}곳`, '', '| id | 지점 | 섞인 표준항 |', '|---:|---|---|', ...idw.map(i => `| ${i.id} | ${i.name} | ${i.ref} |`), '');
    const notes = {};
    for (const i of index) if (i.note) notes[i.note.replace(/「.*?」/, '「…」')] = (notes[i.note.replace(/「.*?」/, '「…」')] || 0) + 1;
    lines.push('## 따로 적을 것', '', ...Object.entries(notes).map(([k, v]) => `- ${k}: ${v}곳`), '');
    fs.writeFileSync(path.join(PD, 'VERIFY_REPORT.md'), lines.join('\n'));
    fs.writeFileSync(path.join(PD, 'verify_detail.json'), JSON.stringify(detail));
    if (WRITE) fs.writeFileSync(path.join(PD, 'index.json'), JSON.stringify(index));
    console.log(`지점 ${pts.length}곳:`, cnt);
    console.log(`대조 ${detail.length}곳:`, band, `· 불합격 ${fail.length} · 개수 다름 ${cntDiff.length}곳`);
}
main();
