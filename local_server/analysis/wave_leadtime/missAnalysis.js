/**
 * ============================================================================
 * missAnalysis.js — 놓친 특보 사례 분해: (A)일기도 신호 없음 vs (B)있었는데 미검출
 * ============================================================================
 *
 * 결합 미검출(combined miss) = 파고 zoneHit3=false AND 풍속 zoneHit3=false 인 발효 이벤트.
 * 각 미검출에 대해 캐시된 매칭 프레임으로 다음을 측정해 원인을 분류:
 *   - windOur  : 우리 반경(H55/I30)·임계(25kt) 의 구역 max  (정의상 <25)
 *   - windBigR : 반경 1.8배 로 키웠을 때 구역 max  (반경 때문에 놓쳤나?)
 *   - windNear : 구역 중심 반경 2.5배(인접 포함) max  (구역 바로 밖에 신호?)
 *   - wind20   : 우리 반경에서 20kt 밴드(임계 직하) 가 있나?  (양자화/컷 직하?)
 *   - waveOur/waveBigR : 파고도 동일
 *
 * 분류:
 *   B-radius : windBigR≥25 or waveBigR≥3        (반경만 키웠어도 잡혔음 → 우리 개선여지)
 *   B-nearby : windNear≥25                       (구역 바로 밖에 신호 → 경계/보정 이슈)
 *   B-justbelow : wind20(=20kt) present or wave 2.5m present (임계 직하 → 양자화/컷)
 *   A-absent : 위 모두 아님 (인근에 의미있는 신호 없음 → 일기도 한계)
 *
 * 표본 이미지(풍속·파고)를 reports/miss_samples/ 에 복사해 육안 확인 가능하게.
 *
 * 사용: node missAnalysis.js [--lead=24] [--sample=3]  (청별 표본 수)
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES } = require('./chartClient');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone } = require('./zones');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');

const OUT = path.join(__dirname, 'out');
const GIF = path.join(__dirname, 'cache', 'gif');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const SAMP = path.join(__dirname, 'reports', 'miss_samples');
fs.mkdirSync(SAMP, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const LEAD = args.lead ? +args.lead : 24;
const SAMPLE = args.sample ? +args.sample : 3;
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

function latestJson(code, sig) {
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.json') && !/SUMMARY/.test(f) && new RegExp(`^leadtime_${code}_`).test(f));
    let best = null;
    for (const f of files) {
        const isWind = /_wind_/.test(f);
        if (sig === 'wind' && isWind && (!best || f > best)) best = f;
        if (sig === 'wave' && !isWind && /^leadtime_[a-z]+_(?:wave_)?\d/.test(f) && (!best || f > best)) best = f;
    }
    return best ? path.join(OUT, best) : null;
}
const loadGif = (fn) => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null;
    return { xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = (z) => (z.type === 'H' ? 55 : 30);

async function main() {
    const cat = { 'B-radius': 0, 'B-nearby': 0, 'B-justbelow': 0, 'A-absent': 0 };
    const samples = [];
    let totalMiss = 0, totalEval = 0;

    for (const [code, region] of Object.entries(OFFICES)) {
        const wj = latestJson(code, 'wave'), dj = latestJson(code, 'wind');
        if (!wj || !dj) continue;
        const wave = JSON.parse(fs.readFileSync(wj, 'utf8'));
        const wind = JSON.parse(fs.readFileSync(dj, 'utf8'));
        const chartCode = OFFICE_CHART[code] || code;
        const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode];
        const wMask = await getStaticMask(chartCode, meta, { signal: 'wave', ge3Level: 3.0, prefix: meta.prefixKIM });
        const dMask = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: windPalette.WARN_KT, prefix: (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_') });

        const waveByT = new Map(wave.results.map((r) => [r.effectiveAt, r]));
        const windByT = new Map(wind.results.map((r) => [r.effectiveAt, r]));
        // 해역명 매핑
        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })
            .filter((e) => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map();
        for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set()); e.seaAreas.forEach((a) => areasByT.get(k).add(a)); }

        let offSampled = 0;
        for (const [t, wr] of waveByT) {
            const dr = windByT.get(t); if (!dr) continue;
            const a = wr.leads[LEAD], b = dr.leads[LEAD];
            if (!a || !a.ok || !b || !b.ok) continue;
            const miss = !a.zoneHit3 && !b.zoneHit3;
            if (!miss) continue;
            totalMiss++;
            const areas = areasByT.get(t); if (!areas) continue;
            const zs = [...areas].map(resolveZone).filter(Boolean); if (!zs.length) continue;
            const windBuf = loadGif(b.frame), waveBuf = loadGif(a.frame);
            if (!windBuf) continue;
            const dWind = decode(windBuf), dWave = waveBuf ? decode(waveBuf) : null;
            // 측정
            let windBigR = 0, windNear = 0, wind20 = false, waveBigR = 0, wave25 = false;
            for (const z of zs) {
                const r = radOf(z);
                const o1 = analyzeZone(dWind, cal, z, { mask: dMask && dMask.mask, radiusPx: Math.round(r * 1.8), classify: windPalette.classify, ge3Level: windPalette.WARN_KT, ge5Level: windPalette.WARN_KT });
                const o2 = analyzeZone(dWind, cal, z, { mask: dMask && dMask.mask, radiusPx: Math.round(r * 2.5), classify: windPalette.classify, ge3Level: windPalette.WARN_KT, ge5Level: windPalette.WARN_KT });
                if (o1 && o1.maxBand > windBigR) windBigR = o1.maxBand;
                if (o2 && o2.maxBand > windNear) windNear = o2.maxBand;
                if (o1 && o1.histogram && o1.histogram['20'] >= 12) wind20 = true;
                if (dWave) {
                    const w1 = analyzeZone(dWave, cal, z, { mask: wMask && wMask.mask, radiusPx: Math.round(r * 1.8), ge3Level: 3.0, ge5Level: 5.0 });
                    if (w1 && w1.maxBand > waveBigR) waveBigR = w1.maxBand;
                    if (w1 && w1.histogram && w1.histogram['2.5'] >= 12) wave25 = true;
                }
            }
            // 분류 (우선순위)
            let c;
            if (windBigR >= 25 || waveBigR >= 3) c = 'B-radius';
            else if (windNear >= 25) c = 'B-nearby';
            else if (wind20 || wave25) c = 'B-justbelow';
            else c = 'A-absent';
            cat[c]++; totalEval++;

            if (offSampled < SAMPLE) {
                offSampled++;
                const tag = `${code}_${t.slice(0, 13).replace(/[-:T]/g, '')}_${c}`;
                // 풍속 프레임 복사
                try { fs.copyFileSync(path.join(GIF, b.frame), path.join(SAMP, `${tag}_wind.gif`)); } catch (e) {}
                samples.push({ code, t, areas: [...areas].slice(0, 3), zonePx: zs.map((z) => `${z.name}(${Math.round(cal.xOf(z.lon))},${Math.round(cal.yOf(z.lat))})`),
                    windFrame: b.frame, windOurMax: b.zoneMaxBand, windBigR, windNear, wind20, waveBigR, cat: c, file: `${tag}_wind.gif` });
            }
        }
    }

    let md = `# 놓친 특보 사례 분석 (lead ${LEAD}h, 결합 미검출)\n\n`;
    md += `결합 미검출 ${totalMiss}건 중 ${totalEval}건 분류:\n\n`;
    md += `| 원인 | 건수 | 비율 | 의미 |\n|---|---|---|---|\n`;
    const meaning = { 'B-radius': '반경만 키웠어도 잡힘 → **우리 개선여지**', 'B-nearby': '구역 바로 밖에 신호 → 경계/보정', 'B-justbelow': '임계 직하(20kt/2.5m) → 양자화/컷', 'A-absent': '인근 신호 없음 → **일기도 한계(예측 불가)**' };
    for (const k of ['B-radius', 'B-nearby', 'B-justbelow', 'A-absent']) md += `| ${k} | ${cat[k]} | ${totalEval ? (cat[k] / totalEval * 100).toFixed(0) : 0}% | ${meaning[k]} |\n`;
    const B = cat['B-radius'] + cat['B-nearby'] + cat['B-justbelow'];
    md += `\n**요약**: 놓친 것 중 **약 ${totalEval ? (B / totalEval * 100).toFixed(0) : 0}%는 (B) 우리 로직 개선으로 잡을 여지**, **약 ${totalEval ? (cat['A-absent'] / totalEval * 100).toFixed(0) : 0}%는 (A) 일기도에 신호 자체가 없어 예측 불가**.\n\n`;
    md += `## 표본 (reports/miss_samples/ 에 풍속 이미지 저장)\n\n`;
    for (const s of samples) md += `- [${s.cat}] ${s.code} ${s.t.slice(0, 16)} | 해역 ${s.areas.join(',')} | 구역픽셀 ${s.zonePx.join(' ')} | windOur=${s.windOurMax} bigR=${s.windBigR} near=${s.windNear} wave_bigR=${s.waveBigR} | ${s.file}\n`;
    fs.writeFileSync(path.join(__dirname, 'reports', `MISS_analysis_lead${LEAD}.md`), md);
    fs.writeFileSync(path.join(OUT, `miss_samples_lead${LEAD}.json`), JSON.stringify(samples, null, 1));
    console.log(md);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
