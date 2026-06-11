/**
 * ============================================================================
 * onsetTiming.js — "언제 발효될까" 예측 + 검증
 * ============================================================================
 *
 * 발효 REF_H 전에 가용했던 예보 run 의 프레임을 valid 시각 순으로 스캔해, 그 구역이
 * '처음 임계(≥20kt)를 넘는 valid 시각' = 예측 onset(악기상 시작). 실제 발효시각·발표시각과 비교.
 *
 * 일부 다운로드 필요(프레임 시퀀스). 사용: KMA_DMDW_*; node onsetTiming.js [--n=80] [--refh=36]
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone } = require('./zones');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');

const GIF = path.join(__dirname, 'cache', 'gif');
const CACHE = path.join(__dirname, 'cache');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const N = args.n ? +args.n : 80;
const REF_H = args.refh ? +args.refh : 36;
const PUB_DELAY_H = 7;
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

const pad = (n) => String(n).padStart(2, '0');
const ymdh = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const ymdhToDate = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = (z) => Math.round((z.type === 'H' ? 55 : 30) * 1.8);
function runSlotsBefore(queryAt, maxBack = 4) { const avail = new Date(queryAt.getTime() - PUB_DELAY_H * 3600 * 1000); const d = new Date(avail); d.setMinutes(0, 0, 0); while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1); const out = []; for (let i = 0; i < maxBack; i++) { out.push(ymdh(d)); d.setHours(d.getHours() - 12); } return out; }
async function getFrames(chartCode, prefix, model, modelText, tm) { const f = path.join(CACHE, `list_${chartCode}_wind_${tm}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); let fr = []; try { fr = await listFrames({ headData: `0#12#3#/DATA/CHT/${model}/#/${prefix}`, model, modelText, type: 'wind' }, tm); } catch (e) {} fs.writeFileSync(f, JSON.stringify(fr)); return fr; }
async function getGif(frame) { const fp = path.join(GIF, frame.fileName); if (fs.existsSync(fp)) return fs.readFileSync(fp); const b = await downloadFrame(frame); fs.writeFileSync(fp, b); await sleep(120); return b; }

(async () => {
    const perOffice = Math.ceil(N / Object.keys(OFFICES).length);
    const rows = [];
    for (const [code, region] of Object.entries(OFFICES)) {
        const chartCode = OFFICE_CHART[code] || code; const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode]; const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_'); const model = meta.prefixKIM ? 'KIMA' : 'APPM';
        const mask = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix }); const m = mask && mask.mask;
        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const byT = new Map(); for (const e of evs) { const k = e.effectiveAt.getTime(); if (!byT.has(k)) byT.set(k, { effectiveAt: e.effectiveAt, announceAt: e.announceAt, areas: new Set() }); e.seaAreas.forEach((a) => byT.get(k).areas.add(a)); }
        const events = [...byT.values()].sort((a, b) => a.effectiveAt - b.effectiveAt);
        const step = Math.max(1, Math.floor(events.length / perOffice));
        let taken = 0;
        for (let i = 0; i < events.length && taken < perOffice; i += step) {
            const e = events[i]; const zs = [...e.areas].map(resolveZone).filter(Boolean); if (!zs.length) continue;
            let frames = [];
            for (const slot of runSlotsBefore(new Date(e.effectiveAt.getTime() - REF_H * 3600 * 1000))) { frames = await getFrames(chartCode, prefix, model, meta.name, slot); if (frames.length) break; }
            if (!frames.length) continue;
            const cands = frames.filter((f) => f.tm).map((f) => ({ f, vt: ymdhToDate(f.tm) })).filter((x) => x.vt <= new Date(e.effectiveAt.getTime() + 6 * 3600 * 1000)).sort((a, b) => a.vt - b.vt);
            let onset = null;
            for (const { f, vt } of cands) {
                let buf; try { buf = await getGif(f); } catch (err) { continue; }
                const dec = decode(buf); let cross = false;
                for (const z of zs) { const a = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 }); if (a && a.maxBand >= 20) { cross = true; break; } }
                if (cross) { onset = vt; break; }
            }
            taken++;
            rows.push({ code, effectiveAt: e.effectiveAt, announceAt: e.announceAt, onset,
                errH: onset ? (onset - e.effectiveAt) / 3600000 : null,
                leadVsAnnounce: onset && e.announceAt ? (e.announceAt - onset) / 3600000 : null });
        }
        console.error(`[onset] ${code}: 표본 ${taken}`);
    }

    const withOnset = rows.filter((r) => r.onset);
    const errs = withOnset.map((r) => r.errH).sort((a, b) => a - b);
    const med = errs.length ? errs[Math.floor(errs.length / 2)] : null;
    const absMed = errs.length ? [...errs].map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length / 2)] : null;
    const within6 = errs.filter((e) => Math.abs(e) <= 6).length, within12 = errs.filter((e) => Math.abs(e) <= 12).length;
    const leads = withOnset.map((r) => r.leadVsAnnounce).filter((x) => x != null).sort((a, b) => a - b);
    const leadMed = leads.length ? leads[Math.floor(leads.length / 2)] : null;
    const beatAnnounce = leads.filter((x) => x > 0).length;

    let md = `# onset 타이밍 검증 ("언제 발효되나", 풍속, 기준 run = 발효 ${REF_H}h 전)\n\n`;
    md += `표본 ${rows.length}건 중 onset 예측됨 ${withOnset.length}건 (나머지는 기준 run 에서 임계 미도달 = 타이밍 예측불가)\n\n`;
    md += `## 예측 onset vs 실제 발효시각 오차\n\n`;
    md += `- 오차(예측onset − 실제발효) 중앙값 **${med != null ? med.toFixed(1) : '-'}시간** (음수=일찍 예측), 절대 중앙값 **${absMed != null ? absMed.toFixed(1) : '-'}시간**\n`;
    md += `- |오차| ≤ 6시간: **${withOnset.length ? (within6 / withOnset.length * 100).toFixed(0) : '-'}%**, ≤ 12시간: ${withOnset.length ? (within12 / withOnset.length * 100).toFixed(0) : '-'}%\n\n`;
    md += `## 기상청 발표 대비 선행성\n\n`;
    md += `- 예측 onset 이 실제 발표(announce)보다 앞선 비율: **${leads.length ? (beatAnnounce / leads.length * 100).toFixed(0) : '-'}%**, 선행 중앙값 ${leadMed != null ? leadMed.toFixed(1) : '-'}시간\n`;
    md += `\n> |오차| 작을수록 "언제" 예측 정확. 선행성 높을수록 기상청보다 먼저 알릴 수 있음.\n`;
    fs.writeFileSync(path.join(__dirname, 'reports', 'ONSET_timing.md'), md);
    console.log(md);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
