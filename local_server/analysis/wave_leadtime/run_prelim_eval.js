'use strict';
/**
 * run_prelim_eval.js — 우리 예측 로직(폴리곤+면적)을 "예비특보 기준"으로 평가.
 *
 *  3가지 질문 (캐시 GIF 만, 오프라인):
 *   [at]  예비특보 발표 순간, 그때 가용했던 일기도에서 우리도 그 구역을 잡았나?
 *         - linked(발효로 이어진 예비): 일치율 = KMA 가 맞춘 것을 우리도 맞춤
 *         - cancelled(취소된 예비=KMA 오탐): 우리가 덜 깃발 들었다면 KMA 보다 정밀
 *   [m24] 예비 발표 24시간 전 가용 일기도에서 이미 잡았나? (예비보다 선행하는 가치)
 *   [gap] 예비 없이 발효한 에피소드 — 발효 24h 전 일기도에서 우리가 잡았나? (공백 메움)
 *
 *  운영점: 폴리곤 maxBand≥25kt & 면적비율≥30% (검증된 보수 운영점). raw 신호도 저장.
 *  프레임은 캐시 파일명 구성으로만 탐색(다운로드 0) — 커버리지를 함께 보고.
 *
 *  실행: node analysis/wave_leadtime/run_prelim_eval.js [--limit=N]
 *  산출: out/prelim_eval_rows.json + reports/PRELIM_eval.md
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART, decode } = require('./geoCalib');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');
const { REGIONAL_OFFICES } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const EVENTS = path.join(__dirname, 'out', 'prelim_events.json');
const OUT_ROWS = path.join(__dirname, 'out', 'prelim_eval_rows.json');
const OUT_MD = path.join(__dirname, 'reports', 'PRELIM_eval.md');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const LIMIT = args.limit ? +args.limit : Infinity;

const H = 3600 * 1000, PUB_DELAY_H = 7;
const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const ymdhToDate = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);
function runSlotsBefore(queryAt, maxBack = 3) {
    const d = new Date(queryAt.getTime() - PUB_DELAY_H * H); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(ymdh(d)); d.setHours(d.getHours() - 12); } return out;
}
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }

// 차트 해상도(인덱스 계산용) — CALIB frame 대략 795x699 이하, decode 시 실제값 사용하지만
// 인덱스는 (w) 종속이므로 office별 최초 decode 후 확정. 사전엔 폴리곤 존재 여부만 확인.
const OFFICE_CODES = ['jeju', 'busn', 'gwju', 'gawn', 'dajn'];   // degu 는 gawn 차트와 동일

(async () => {
    const polyMap = loadZonePolygons();
    const episodes = JSON.parse(fs.readFileSync(EVENTS, 'utf8')).filter(e => e.kind === '풍랑');

    // [gap] 발효-무예비 에피소드 구축 (census 와 동일 로직)
    const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter(e => e.effectiveAt);
    const effByZone = new Map();
    for (const e of evs) for (const a of e.seaAreas) { const z = normName(a); if (!z) continue; if (!effByZone.has(z)) effByZone.set(z, []); effByZone.get(z).push(e.effectiveAt.getTime()); }
    for (const arr of effByZone.values()) arr.sort((a, b) => a - b);
    const preByZone = new Map();
    for (const ep of episodes) { if (!preByZone.has(ep.zone)) preByZone.set(ep.zone, []); preByZone.get(ep.zone).push(ep.announceAt); }
    const gapEpisodes = [];
    for (const [z, arr] of effByZone) {
        const pres = preByZone.get(z) || []; let lastT = -Infinity;
        for (const t of arr) {
            if (t - lastT <= 24 * H) { lastT = t; continue; } lastT = t;
            if (!pres.some(p => p <= t + 2 * H && p >= t - 72 * H)) gapEpisodes.push({ zone: z, effT: t });
        }
    }

    // 평가 작업 목록: {mode, zone, queryAt(가용기준), targetAt(유효시각), tag(linked/cancelled/-)}
    const tasks = [];
    let n = 0;
    for (const ep of episodes) {
        if (n++ >= LIMIT) break;
        const target = ep.expectedAt || (ep.announceAt + 24 * H);
        const tag = ep.linked != null ? 'linked' : 'cancelled';
        tasks.push({ mode: 'at', zone: ep.zone, queryAt: ep.announceAt, targetAt: target, tag });
        tasks.push({ mode: 'm24', zone: ep.zone, queryAt: ep.announceAt - 24 * H, targetAt: target, tag });
    }
    n = 0;
    for (const g of gapEpisodes) {
        if (n++ >= LIMIT) break;
        tasks.push({ mode: 'gap', zone: g.zone, queryAt: g.effT - 24 * H, targetAt: g.effT, tag: 'gap' });
    }
    console.error(`[eval] 에피소드: 예비 ${Math.min(episodes.length, LIMIT)} (linked/cancelled), gap ${Math.min(gapEpisodes.length, LIMIT)} → 작업 ${tasks.length}`);

    // 캐시 프레임 매칭: (office, slot, step) 파일명 구성 → 존재하는 첫 프레임
    //   주의: 내부 시각은 KST 벽시계, 캐시 파일명의 베이스시각은 UTC(00/12시) → −9h 변환.
    function findFrame(zone, queryAt, targetAt) {
        if (!polyMap.has(zone)) return null;
        for (const slot of runSlotsBefore(new Date(queryAt))) {
            const base = ymdhToDate(slot).getTime();                 // KST 벽시계 기준 run
            const fnSlot = ymdh(new Date(base - 9 * H));             // 파일명용 UTC 베이스
            const rawStep = Math.round((targetAt - base) / H / 3) * 3;
            for (const dlt of [0, 3, -3, 6, -6]) {
                const s = rawStep + dlt; if (s < 0 || s > 120) continue;
                for (const office of OFFICE_CODES) {
                    const fn = `kim_cww3_${office}_wind_s${pad(s).padStart(3, '0')}_${fnSlot}.gif`;
                    if (fs.existsSync(path.join(GIF, fn))) return { office, fn };
                }
            }
        }
        return null;
    }

    // 프레임별 그룹화 (decode 1회/프레임)
    const byFrame = new Map();
    let matched = 0, unmatched = 0;
    for (const t of tasks) {
        const f = findFrame(t.zone, t.queryAt, t.targetAt);
        if (!f) { t.cov = false; unmatched++; continue; }
        t.cov = true; t.office = f.office; matched++;
        if (!byFrame.has(f.fn)) byFrame.set(f.fn, []);
        byFrame.get(f.fn).push(t);
    }
    console.error(`[eval] 프레임 매칭: ${matched}/${tasks.length} (고유 프레임 ${byFrame.size}, 미매칭 ${unmatched})`);

    // 마스크 (office별 1회, graceful)
    const masks = {};
    for (const office of OFFICE_CODES) {
        try {
            const meta = REGIONAL_OFFICES[OFFICE_CHART[office] || office];
            const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
            const mk = await getStaticMask(OFFICE_CHART[office] || office, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix });
            masks[office] = mk && mk.mask;
        } catch (_) { masks[office] = null; }
    }

    // 평가 (프레임 1장씩 decode → 폐기)
    const idxCache = new Map(); // office|zone → Int32Array|null
    let done = 0;
    for (const [fn, group] of byFrame) {
        let dec; try { dec = decode(fs.readFileSync(path.join(GIF, fn))); } catch (_) { group.forEach(t => t.cov = false); continue; }
        for (const t of group) {
            const key = t.office + '|' + t.zone;
            let idx = idxCache.get(key);
            if (idx === undefined) {
                const cal = calibAdapter(OFFICE_CHART[t.office] || t.office);
                const polys = polyMap.get(t.zone);
                idx = (cal && polys) ? zonePixelIndices(cal, polys, dec.w, dec.h) : null;
                idxCache.set(key, idx);
            }
            if (!idx || !idx.length) { t.cov = false; continue; }
            const a = analyzeByIndices(dec, idx, { mask: masks[t.office], classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 });
            if (!a) { t.cov = false; continue; }
            t.band = a.maxBand; t.area = a.areaFraction;
            t.flag = (a.maxBand >= 25 && a.areaFraction >= 0.30);
        }
        if (++done % 200 === 0) console.error(`[eval] 프레임 ${done}/${byFrame.size}`);
    }

    const rows = tasks.filter(t => t.cov && t.band != null);
    fs.writeFileSync(OUT_ROWS, JSON.stringify(rows));

    // ── 리포트 ────────────────────────────────────────────────────────────────
    const pc = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '-';
    const grp = (mode, tag) => rows.filter(r => r.mode === mode && (tag == null || r.tag === tag));
    const flag = a => a.filter(r => r.flag).length;
    let md = '# 예비특보 기준 평가 — 우리 로직(폴리곤+면적, 밴드≥25kt·면적≥30%)\n\n';
    md += `작업 ${tasks.length} 중 캐시 프레임 평가 가능 ${rows.length} (${pc(rows.length, tasks.length)})\n\n`;
    md += '| 질문 | 표본 | 우리가 깃발 든 비율 | 해석 |\n|---|---|---|---|\n';
    const atL = grp('at', 'linked'), atC = grp('at', 'cancelled');
    const mL = grp('m24', 'linked'), mC = grp('m24', 'cancelled');
    const gp = grp('gap');
    md += `| [at] 예비 발표 순간 — 적중 예비(발효O) | ${atL.length} | **${pc(flag(atL), atL.length)}** | KMA 예비와의 일치율(높을수록 동급) |\n`;
    md += `| [at] 예비 발표 순간 — 취소 예비(발효X=KMA오탐) | ${atC.length} | **${pc(flag(atC), atC.length)}** | 낮을수록 KMA 보다 정밀 |\n`;
    md += `| [m24] 예비보다 24h 먼저 — 적중 예비 | ${mL.length} | **${pc(flag(mL), mL.length)}** | KMA 예비 선행 탐지율(우리 고유가치) |\n`;
    md += `| [m24] 예비보다 24h 먼저 — 취소 예비 | ${mC.length} | ${pc(flag(mC), mC.length)} | (참고) |\n`;
    md += `| [gap] 예비 없던 발효, 발효 24h 전 | ${gp.length} | **${pc(flag(gp), gp.length)}** | KMA 공백을 우리가 메우는 비율 |\n`;
    md += '\n## 커버리지(캐시 한계, 정직 고지)\n\n';
    for (const [m, t] of [['at', 'linked'], ['at', 'cancelled'], ['m24', 'linked'], ['gap', null]]) {
        const all = tasks.filter(x => x.mode === m && (t == null || x.tag === t));
        const ok = all.filter(x => x.cov && x.band != null);
        md += `- ${m}/${t || '-'}: ${ok.length}/${all.length} (${pc(ok.length, all.length)})\n`;
    }
    md += '\n> 캐시는 "발효 이벤트 주변" 프레임 위주라 취소예비·gap 커버리지가 낮을 수 있음 — 표본 편향 주의.\n';
    fs.writeFileSync(OUT_MD, md);
    console.log('\n' + md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
