/**
 * combine_reports.js — 청별 파고(wave)+풍속(wind) 결과를 결합해 전국 종합 리포트 생성.
 *   결합 예측: per-zone 에서 (유의파고 ≥3m) OR (풍속 ≥25kt) → 풍랑주의보 선행 신호.
 *   사용: node combine_reports.js → out/SUMMARY_national.md / .json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');
const CODE_NAME = { jeju: '제주청', busn: '부산청', gwju: '광주청', degu: '대구청', gawn: '강원청', dajn: '대전청' };

// 청코드+신호별 최신 json
function latest() {
    // 파고 파일은 신호추가 前 배치라 옛 이름(leadtime_<code>_<stamp>.json)일 수 있음 → wave 로 간주.
    const files = fs.readdirSync(OUT).filter((f) => /^leadtime_[a-z]+_.*\.json$/.test(f) && !/SUMMARY/.test(f));
    const pick = {}; // pick[code][signal] = file
    for (const f of files) {
        let m = f.match(/^leadtime_([a-z]+)_(wave|wind)_/);
        let code, sig;
        if (m) { code = m[1]; sig = m[2]; }
        else { const m2 = f.match(/^leadtime_([a-z]+)_/); if (!m2) continue; code = m2[1]; sig = 'wave'; }
        pick[code] = pick[code] || {};
        if (!pick[code][sig] || f > pick[code][sig]) pick[code][sig] = f;
    }
    return pick;
}
const load = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const pct = (x) => x != null ? `${(x * 100).toFixed(0)}%` : '-';

function mergeCode(code, files) {
    const wave = files.wave ? load(files.wave) : null;
    const wind = files.wind ? load(files.wind) : null;
    const base = wave || wind; if (!base) return null;
    const leads = Object.keys(base.agg.leads).map(Number).sort((a, b) => a - b);
    // 이벤트 매칭 (effectiveAt 기준)
    const windByT = new Map(); if (wind) wind.results.forEach((r) => windByT.set(r.effectiveAt, r));
    const waveByT = new Map(); if (wave) wave.results.forEach((r) => waveByT.set(r.effectiveAt, r));
    const allT = new Set([...waveByT.keys(), ...windByT.keys()]);
    const per = {}; // lead → {covered, waveHit, windHit, combHit}
    for (const L of leads) per[L] = { covered: 0, waveHit: 0, windHit: 0, combHit: 0 };
    for (const t of allT) {
        const wv = waveByT.get(t), wd = windByT.get(t);
        for (const L of leads) {
            const a = wv && wv.leads[L], b = wd && wd.leads[L];
            const aZ = a && a.ok ? !!a.zoneHit3 : null;
            const bZ = b && b.ok ? !!b.zoneHit3 : null;
            if (aZ == null && bZ == null) continue;
            per[L].covered++;
            if (aZ) per[L].waveHit++;
            if (bZ) per[L].windHit++;
            if (aZ || bZ) per[L].combHit++;
        }
    }
    return { code, leads, events: allT.size, per,
             waveControl: wave && wave.agg.control, windControl: wind && wind.agg.control,
             hasWave: !!wave, hasWind: !!wind };
}

function main() {
    const pick = latest();
    const codes = Object.entries(pick).map(([code, files]) => mergeCode(code, files)).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
    if (!codes.length) { console.log('결과 json 없음'); return; }
    const leads = codes[0].leads;

    let s = `# 전국 종합 — 해상일기도(파고+풍속)→풍랑주의보 선행예측\n\n`;
    s += `생성 ${new Date().toISOString().slice(0, 16)}. **결합 예측 = per-zone 에서 (유의파고 ≥3m) OR (해상풍 ≥25kt≈14m/s)**\n\n`;

    s += `## 청별 per-zone 결합 HIT율 (발효 L시간 전, 그 특보구역에 신호)\n\n`;
    s += `| 청 | 이벤트 | ` + leads.map((l) => `${l}h전`).join(' | ') + ` |\n|---|---|` + leads.map(() => '---').join('|') + `|\n`;
    for (const c of codes) {
        const cells = leads.map((l) => { const p = c.per[l]; return p.covered ? pct(p.combHit / p.covered) : '-'; });
        s += `| ${CODE_NAME[c.code] || c.code} | ${c.events} | ${cells.join(' | ')} |\n`;
    }

    s += `\n## 신호별 기여 (전국 합산 per-zone HIT율)\n\n`;
    s += `| 리드타임 | 파고만 | 풍속만 | 결합(OR) |\n|---|---|---|---|\n`;
    for (const l of leads) {
        let cov = 0, wv = 0, wd = 0, cb = 0;
        for (const c of codes) { const p = c.per[l]; cov += p.covered; wv += p.waveHit; wd += p.windHit; cb += p.combHit; }
        s += `| ${l}시간 전 | ${cov ? pct(wv / cov) : '-'} | ${cov ? pct(wd / cov) : '-'} | **${cov ? pct(cb / cov) : '-'}** |\n`;
    }

    s += `\n## 거짓경보율(청단위, 잔잔한 날 임계초과 비율)\n\n| 청 | 파고 | 풍속 |\n|---|---|---|\n`;
    for (const c of codes) {
        const wf = c.waveControl && c.waveControl.falseRate != null ? pct(c.waveControl.falseRate) : '-';
        const df = c.windControl && c.windControl.falseRate != null ? pct(c.windControl.falseRate) : '-';
        s += `| ${CODE_NAME[c.code] || c.code} | ${wf} | ${df} |\n`;
    }
    s += `\n> 청단위 풍속 거짓경보율이 높으면(차트 어딘가 항상 강풍) per-zone 결합이 정확한 지표.\n`;

    fs.writeFileSync(path.join(OUT, 'SUMMARY_national.md'), s);
    fs.writeFileSync(path.join(OUT, 'SUMMARY_national.json'), JSON.stringify(codes, null, 1));
    console.log(s);
    console.log('[saved] out/SUMMARY_national.md');
}
main();
