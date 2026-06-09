/**
 * combine_reports.js — out/leadtime_<code>_*.json (청별 최신) 을 모아 전국 종합 리포트 생성.
 *   사용: node combine_reports.js  → out/SUMMARY_national.md / .json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'out');

const CODE_NAME = {
    jeju: '제주청', busn: '부산청', gwju: '광주청', degu: '대구청', gawn: '강원청', dajn: '대전청',
};

// 청별 최신 json 선택
function latestByCode() {
    const files = fs.readdirSync(OUT).filter((f) => /^leadtime_[a-z]+_.*\.json$/.test(f));
    const pick = {};
    for (const f of files) {
        const code = f.match(/^leadtime_([a-z]+)_/)[1];
        if (!pick[code] || f > pick[code]) pick[code] = f;
    }
    return pick;
}

function main() {
    const pick = latestByCode();
    const rows = [];
    for (const [code, file] of Object.entries(pick)) {
        const { agg } = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
        rows.push({ code, agg });
    }
    rows.sort((a, b) => a.code.localeCompare(b.code));
    const leads = rows.length ? Object.keys(rows[0].agg.leads).map(Number).sort((a, b) => a - b) : [];

    let s = `# 전국 종합 — 해상일기도→풍랑주의보 선행예측 리드타임\n\n`;
    s += `(청별 최신 분석 결과 취합. 생성 ${new Date().toISOString().slice(0, 16)})\n\n`;

    // 청 단위 HIT율
    s += `## 청 단위 HIT율 (발효 L시간 전 차트에 ≥3m)\n\n`;
    s += `| 청 | 이벤트 | ` + leads.map((l) => `${l}h전`).join(' | ') + ` | 거짓경보율 |\n`;
    s += `|---|---|` + leads.map(() => '---').join('|') + `|---|\n`;
    for (const { code, agg } of rows) {
        const cells = leads.map((l) => { const x = agg.leads[l]; return x && x.hit3Rate != null ? `${(x.hit3Rate * 100).toFixed(0)}%` : '-'; });
        const fp = agg.control && agg.control.falseRate != null ? `${(agg.control.falseRate * 100).toFixed(0)}%` : '-';
        s += `| ${CODE_NAME[code] || code} | ${agg.events} | ${cells.join(' | ')} | ${fp} |\n`;
    }

    // per-zone HIT율
    s += `\n## per-zone HIT율 (발효된 바로 그 특보구역에 ≥3m)\n\n`;
    s += `| 청 | ` + leads.map((l) => `${l}h전`).join(' | ') + ` |\n`;
    s += `|---|` + leads.map(() => '---').join('|') + `|\n`;
    for (const { code, agg } of rows) {
        const cells = leads.map((l) => { const x = agg.leads[l]; return x && x.zoneHit3Rate != null ? `${(x.zoneHit3Rate * 100).toFixed(0)}%` : '-'; });
        s += `| ${CODE_NAME[code] || code} | ${cells.join(' | ')} |\n`;
    }

    // 전국 합산(가중평균)
    const sum = {};
    for (const l of leads) {
        let cov = 0, h = 0, zc = 0, zh = 0;
        for (const { agg } of rows) { const x = agg.leads[l]; if (!x) continue; cov += x.covered || 0; h += x.hit3 || 0; zc += x.zoneCovered || 0; zh += x.zoneHit3 || 0; }
        sum[l] = { covWhole: cov ? (h / cov) : null, covZone: zc ? (zh / zc) : null };
    }
    s += `\n## 전국 합산\n\n| 리드타임 | 청단위 HIT율 | per-zone HIT율 |\n|---|---|---|\n`;
    for (const l of leads) s += `| ${l}시간 전 | ${sum[l].covWhole != null ? (sum[l].covWhole * 100).toFixed(0) + '%' : '-'} | ${sum[l].covZone != null ? (sum[l].covZone * 100).toFixed(0) + '%' : '-'} |\n`;

    s += `\n> 해석: 청단위는 "그 청 해역 어딘가에 ≥3m", per-zone 은 "발효된 바로 그 구역에 ≥3m".\n`;
    s += `> per-zone < 청단위 격차는 풍속(≥14m/s)으로 발효된 앞바다 주의보가 파고로는 안 잡히는 비중을 시사.\n`;

    fs.writeFileSync(path.join(OUT, 'SUMMARY_national.md'), s);
    fs.writeFileSync(path.join(OUT, 'SUMMARY_national.json'), JSON.stringify(rows, null, 1));
    console.log(s);
    console.log('[saved] out/SUMMARY_national.md');
}
main();
