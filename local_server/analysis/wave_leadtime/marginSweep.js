/**
 * ============================================================================
 * marginSweep.js — '면적 마진' 분석: 특보구역 면적의 몇 % 이상이 임계를 넘으면 발효되는가
 * ============================================================================
 *
 * [동기] per-zone HIT 는 "구역 안에 임계 초과 픽셀이 최소 몇 개라도 있으면 HIT" 였다.
 *   하지만 실제 특보는 1~2지점이 아니라 구역의 '일정 면적 이상'이 나빠져야 발효된다.
 *   → 구역 면적 대비 임계초과 면적비율(frac = pixelsGE / sampled)을 구하고,
 *     임계 비율 τ 를 스윕하며 (실제 발효 vs 잔잔)을 가장 잘 가르는 마진선을 찾는다.
 *
 * [방법] 신호(wave/wind)·리드타임 L 에 대해:
 *   - 발효 이벤트: 각 이벤트의 L시간 전 매칭 프레임(캐시)에서 그 구역들의 max frac
 *   - 잔잔(음성): 잔잔한 슬롯의 실황 프레임에서 차트 내 모든 구역 중 max frac
 *   - τ ∈ {0.05,0.10,...,0.6} 스윕: recall=P(event frac≥τ), FPR=P(calm frac≥τ)
 *   - 추천 τ: Youden J(recall-FPR) 최대 + recall≥0.7 유지하는 최대 τ
 *
 * 추가 다운로드 없음 — 배치가 받아둔 cache/gif 만 사용.
 *
 * [사용] node marginSweep.js [--lead=24] [--signals=wave,wind]
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES } = require('./chartClient');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone, ZONES } = require('./zones');
const { getStaticMask } = require('./staticMask');
const wavePalette = require('./palette');
const windPalette = require('./windPalette');

const OUT = path.join(__dirname, 'out');
const GIF = path.join(__dirname, 'cache', 'gif');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const LEAD = args.lead ? +args.lead : 24;
const SIGNALS = (args.signals || 'wave,wind').split(',');
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

const SIGCFG = {
    wave: { classify: undefined, ge3: 3.0, name: '유의파고', unit: 'm' },
    wind: { classify: windPalette.classify, ge3: windPalette.WARN_KT, name: '해상풍', unit: 'kt' },
};

// 청+신호 최신 결과 json (옛 파고 파일명도 wave 로)
function latestJson(code, sig) {
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.json') && !/SUMMARY/.test(f));
    let best = null;
    for (const f of files) {
        const mw = f.match(new RegExp(`^leadtime_${code}_wind_`));
        const mo = f.match(new RegExp(`^leadtime_${code}_(?:wave_)?\\d`));
        const isWind = !!mw;
        const isWave = !isWind && /^leadtime_[a-z]+_(?:wave_)?\d|^leadtime_[a-z]+_\d/.test(f) && new RegExp(`^leadtime_${code}_`).test(f);
        if (sig === 'wind' && isWind) { if (!best || f > best) best = f; }
        if (sig === 'wave' && !isWind && new RegExp(`^leadtime_${code}_(?:wave_)?\\d`).test(f)) { if (!best || f > best) best = f; }
    }
    return best ? path.join(OUT, best) : null;
}

function loadGif(fileName) {
    const p = path.join(GIF, fileName);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function calibAdapter(code) {
    const c = CALIB[code]; if (!c) return null;
    return { xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame };
}
const zoneRadius = (z) => (z.type === 'H' ? 55 : 30);

async function analyzeSignal(sig) {
    const cfg = SIGCFG[sig];
    const eventFracs = [];   // 발효 이벤트의 max frac
    const calmFracs = [];    // 잔잔 슬롯의 max frac
    const perOffice = {};

    for (const [code, region] of Object.entries(OFFICES)) {
        const jf = latestJson(code, sig);
        if (!jf) continue;
        const { results } = JSON.parse(fs.readFileSync(jf, 'utf8'));
        const chartCode = OFFICE_CHART[code] || code;
        const cal = calibAdapter(chartCode);
        const chartMeta = REGIONAL_OFFICES[chartCode];
        if (!cal) continue;
        const prefix = chartMeta.prefixKIM ? (sig === 'wind' ? chartMeta.prefixKIM.replace('_wave_', '_wind_') : chartMeta.prefixKIM) : chartMeta.prefixAPPM;
        let mask = null;
        try { mask = await getStaticMask(chartCode, chartMeta, { signal: sig, classify: cfg.classify, ge3Level: cfg.ge3, prefix }); } catch (e) {}
        const maskArr = mask && mask.mask;

        // 이벤트 effectiveAt → seaAreas (CSV 재파싱)
        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })
            .filter((e) => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map();
        for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set()); e.seaAreas.forEach((a) => areasByT.get(k).add(a)); }

        let oc = 0, ocFrac = [];
        for (const r of results) {
            const rec = r.leads && r.leads[LEAD];
            if (!rec || !rec.ok || !rec.frame) continue;
            const buf = loadGif(rec.frame); if (!buf) continue;
            const dec = decode(buf);
            const areas = areasByT.get(r.effectiveAt); if (!areas) continue;
            const zs = [...areas].map(resolveZone).filter(Boolean);
            let maxFrac = 0;
            for (const z of zs) {
                const za = analyzeZone(dec, cal, z, { mask: maskArr, radiusPx: zoneRadius(z), classify: cfg.classify, ge3Level: cfg.ge3, ge5Level: cfg.ge3 });
                if (za && za.sampled) { const frac = za.pixelsGE3 / za.sampled; if (frac > maxFrac) maxFrac = frac; }
            }
            eventFracs.push(maxFrac); ocFrac.push(maxFrac); oc++;
        }
        perOffice[code] = { events: oc, medianFrac: median(ocFrac) };

        // 잔잔 슬롯: results 의 잔잔 대조군 frame 은 따로 없으므로, 발효시각과 24h+ 떨어진 슬롯의
        //   캐시된 실황 프레임을 모든 구역 스캔. (control 다운로드분이 cache 에 있음)
        const warnTimes = results.map((x) => new Date(x.effectiveAt).getTime());
        const isCalm = (t) => warnTimes.every((wt) => Math.abs(wt - t) > 24 * 3600 * 1000);
        const chartZones = ZONES.filter((z) => {
            const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat);
            return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1;
        });
        // 캐시된 list json 으로 잔잔 슬롯 실황 프레임 파일명 확보
        const listFiles = fs.readdirSync(path.join(__dirname, 'cache')).filter((f) => f.startsWith(`list_${chartCode}_${sig}_`) || (sig === 'wave' && f.startsWith(`list_${chartCode}_`) && !f.includes('_wind_')));
        let calmDone = 0;
        for (const lf of listFiles) {
            if (calmDone >= 40) break;
            const tm = lf.match(/_(\d{10})\.json$/); if (!tm) continue;
            const slotDate = new Date(+tm[1].slice(0, 4), +tm[1].slice(4, 6) - 1, +tm[1].slice(6, 8), +tm[1].slice(8, 10));
            if (!isCalm(slotDate.getTime())) continue;
            const frames = JSON.parse(fs.readFileSync(path.join(__dirname, 'cache', lf), 'utf8'));
            const f0 = frames.find((x) => x.ftHours === 0); if (!f0) continue;
            const buf = loadGif(f0.fileName); if (!buf) continue;
            const dec = decode(buf);
            let maxFrac = 0;
            for (const z of chartZones) {
                const za = analyzeZone(dec, cal, z, { mask: maskArr, radiusPx: zoneRadius(z), classify: cfg.classify, ge3Level: cfg.ge3, ge5Level: cfg.ge3 });
                if (za && za.sampled) { const frac = za.pixelsGE3 / za.sampled; if (frac > maxFrac) maxFrac = frac; }
            }
            calmFracs.push(maxFrac); calmDone++;
        }
    }
    return { eventFracs, calmFracs, perOffice };
}

function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function sweep(eventFracs, calmFracs) {
    const taus = []; for (let t = 0.02; t <= 0.6; t += 0.02) taus.push(+t.toFixed(2));
    const rows = taus.map((tau) => {
        const recall = eventFracs.length ? eventFracs.filter((f) => f >= tau).length / eventFracs.length : 0;
        const fpr = calmFracs.length ? calmFracs.filter((f) => f >= tau).length / calmFracs.length : 0;
        return { tau, recall, fpr, j: recall - fpr };
    });
    const bestJ = rows.reduce((a, b) => (b.j > a.j ? b : a), rows[0]);
    const r70 = [...rows].reverse().find((r) => r.recall >= 0.7) || bestJ; // recall≥70% 유지 최대 τ
    return { rows, bestJ, r70 };
}

(async () => {
    let md = `# 면적 마진(area margin) 분석 — 특보구역 면적의 몇 % 이상이 임계 초과 시 발효?\n\n`;
    md += `리드타임 ${LEAD}시간 전 매칭 프레임 기준. frac = 구역 임계초과면적/구역표본면적.\n`;
    md += `(추가 다운로드 없이 캐시된 프레임으로 산출)\n\n`;
    for (const sig of SIGNALS) {
        const cfg = SIGCFG[sig];
        const { eventFracs, calmFracs, perOffice } = await analyzeSignal(sig);
        if (!eventFracs.length) { md += `## ${cfg.name}(${sig}) — 데이터 없음\n\n`; continue; }
        const { rows, bestJ, r70 } = sweep(eventFracs, calmFracs);
        md += `## ${cfg.name}(${sig}) 임계 ≥${cfg.ge3}${cfg.unit}\n\n`;
        md += `- 발효 이벤트 ${eventFracs.length}건, 잔잔 표본 ${calmFracs.length}건\n`;
        md += `- 이벤트 frac 중앙값 **${(median(eventFracs) * 100).toFixed(0)}%** vs 잔잔 frac 중앙값 ${(median(calmFracs) * 100).toFixed(0)}%\n`;
        md += `- **추천 마진선**: Youden 최대 τ=**${(bestJ.tau * 100).toFixed(0)}%** (재현율 ${(bestJ.recall * 100).toFixed(0)}%, 오탐 ${(bestJ.fpr * 100).toFixed(0)}%)`;
        md += ` / 재현율 70%↑ 유지 최대 τ=**${(r70.tau * 100).toFixed(0)}%** (재현율 ${(r70.recall * 100).toFixed(0)}%, 오탐 ${(r70.fpr * 100).toFixed(0)}%)\n\n`;
        md += `| 면적 마진 τ | 재현율 | 오탐율 | J |\n|---|---|---|---|\n`;
        for (const r of rows.filter((_, i) => i % 2 === 0)) md += `| ${(r.tau * 100).toFixed(0)}% | ${(r.recall * 100).toFixed(0)}% | ${(r.fpr * 100).toFixed(0)}% | ${(r.j).toFixed(2)} |\n`;
        md += `\n청별 이벤트 frac 중앙값: ` + Object.entries(perOffice).map(([c, v]) => `${c} ${v.medianFrac != null ? (v.medianFrac * 100).toFixed(0) + '%' : '-'}(${v.events})`).join(', ') + `\n\n`;
    }
    md += `> 해석: "구역 면적의 약 τ% 이상이 임계를 넘으면 풍랑주의보로 이어진다"는 정량 발효 기준.\n`;
    fs.writeFileSync(path.join(OUT, 'MARGIN_sweep.md'), md);
    console.log(md);
    console.log('[saved] out/MARGIN_sweep.md');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
