#!/usr/bin/env node
/**
 * 파일명: local_server/scripts/build_tide_year_file.js
 * 역할: collect_tide_hghlw.py 가 받아 둔 표준항 지점별 CSV 를 합쳐, 앱이 읽는 연간 조석표
 *       client/tide_data/tide_data_<연도>.js 를 **기존 파일과 같은 틀**로 만든다.
 *       (예전에는 사람이 HTML 도구로 합쳤다 — 그 도구가 저장소에 없어 같은 결과가 나오게 새로 짰다.)
 *
 * [쓰는 법]
 *   node local_server/scripts/build_tide_year_file.js 2027            # 검사만(파일을 쓰지 않는다)
 *   node local_server/scripts/build_tide_year_file.js 2027 --write    # 166곳이 다 있을 때만 쓴다
 *   node local_server/scripts/build_tide_year_file.js 2027 --write --partial   # 덜 받았어도 쓴다(시험용 — 커밋 금지)
 *
 * [틀 — 기존 tide_data_2027.js 를 뜯어 확인한 것]
 *   머리말 2줄 + `if (!window.TIDE_DATA_STORAGE) window.TIDE_DATA_STORAGE = {};` +
 *   `window.TIDE_DATA_STORAGE['<연도>'] = ` + JSON.stringify(rows, null, 2) + `;`
 *   rows = 지점 코드순 → 날짜순. 한 줄 = { date(20270101), stationName, stationCode,
 *          highTide1Time(HHMM 정수 — 04:53 → 453), highTide1Level(cm), …4, lowTide1Time, … }  — 없는 칸은 넣지 않는다.
 *   고조·저조는 그날 시각순으로 1,2,3,4.
 *
 * [연계]
 *   - 읽는 것: client/tide_data/Raw_tide_data/<연도>_hghlw/_stations.txt · <코드>.csv · _nodata.csv
 *   - 쓰는 것: client/tide_data/tide_data_<연도>.js (← client/tide.js loadTideData 가 `tide_data/tide_data_${year}.js` 로 읽는다,
 *             local_server/scripts/build_tide_field.js 도 Z₀ 계산에 읽는다) ·
 *             Raw_tide_data/tide_<연도>-<연도>_day<N>_<M>stations.csv (기존 묶음 이름 — 27곳씩, API 가이드 표의 읽는 순서)
 *   - 앱 이름표: API 코드가 바뀐 두 곳은 앱이 쓰는 옛 이름표로 적는다(ALIAS) — client/tide.js:1729~ 가 코드로 먼저 찾는다.
 * [로드 순서] 단독 실행 스크립트.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** API 코드 → 앱 이름표(코드·이름). 2026-11-23 실제 호출: 옛 코드 DT_0040 은 오류, SO_0565 는 자료 없음. */
const ALIAS = { DT_0903: { code: 'DT_0040', name: '독도' }, DT_0066: { code: 'SO_0565', name: '향화도항' } };

const YEAR = process.argv[2];
const WRITE = process.argv.includes('--write');
const PARTIAL = process.argv.includes('--partial');
const TD = path.join(__dirname, '..', '..', 'client', 'tide_data');
const RAW = path.join(TD, 'Raw_tide_data');
const SRC = path.join(RAW, `${YEAR}_hghlw`);

/** 지점 CSV 한 개 → [{code,name,dt:'2027-01-01 04:53',lv:183,hl:'고조'|'저조'}] */
function readStation(code) {
    const f = path.join(SRC, code + '.csv');
    if (!fs.existsSync(f)) return null;
    return fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map(l => {
        const c = l.split(',').map(x => x.replace(/^"|"$/g, ''));
        return { code: c[0], name: c[1], dt: c[2], lv: Number(c[3]), hl: c[4] };
    });
}

/** 한 지점의 줄들 → 날짜별 한 줄(앱 틀).  예) 04:53 저조 183 · 11:11 고조 669 → {date:20270101,…,highTide1Time:1111,highTide1Level:669,lowTide1Time:453,lowTide1Level:183} */
function toRows(code, items) {
    const label = ALIAS[code] || { code, name: items[0].name };
    const byDay = new Map();
    for (const it of items) {
        const d = Number(it.dt.slice(0, 10).replace(/-/g, ''));
        if (String(d).slice(0, 4) !== String(YEAR)) continue;
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(it);
    }
    const rows = [];
    for (const d of [...byDay.keys()].sort((a, b) => a - b)) {
        const list = byDay.get(d).sort((a, b) => a.dt.localeCompare(b.dt));
        const hi = list.filter(x => x.hl === '고조'), lo = list.filter(x => x.hl === '저조');
        const row = { date: d, stationName: label.name, stationCode: label.code };
        const put = (arr, key) => arr.slice(0, 4).forEach((x, i) => {
            row[`${key}${i + 1}Time`] = Number(x.dt.slice(11).replace(':', ''));
            row[`${key}${i + 1}Level`] = x.lv;
        });
        // 기존 파일의 칸 순서: 고조1·2 → 저조1·2 → 고조3·4 → 저조3·4
        put(hi.slice(0, 2), 'highTide');
        put(lo.slice(0, 2), 'lowTide');
        hi.slice(2, 4).forEach((x, i) => { row[`highTide${i + 3}Time`] = Number(x.dt.slice(11).replace(':', '')); row[`highTide${i + 3}Level`] = x.lv; });
        lo.slice(2, 4).forEach((x, i) => { row[`lowTide${i + 3}Time`] = Number(x.dt.slice(11).replace(':', '')); row[`lowTide${i + 3}Level`] = x.lv; });
        if (hi.length > 4 || lo.length > 4) console.log(`  ⚠ ${code} ${d}: 고조 ${hi.length}·저조 ${lo.length} — 4개를 넘는 것은 못 싣는다`);
        rows.push(row);
    }
    return rows;
}

/**
 * API 원본 오류 걸러 내기 — 하루에 고조(또는 저조)가 4개를 넘는 지점·날짜에서, **다른 지점의 같은 날에 똑같이(시각·높이·종류) 있는 줄**을 뺀다.
 * [왜] 2026-11-24 실제 응답: 2027-01-02 의 속초등표(DT_0048)·쌍정초(DT_0046)가 9건으로 왔는데, 그중 4건이 속초(DT_0012)의 그날 값과
 *      글자 그대로 같고 1건(00:00 17cm)은 두 지점에 똑같이 들어 있었다 — 포털 쪽에서 다른 지점 줄이 섞인 것이다. 빼면 고조 2·저조 2 가 남는다.
 *      4개 이하인 날은 건드리지 않는다(가까운 두 지점이 우연히 같은 값일 수 있어서).
 * @param {Object<string,Array>} raw  지점 코드 → 줄들 (제자리에서 고친다)
 */
function dropForeign(raw) {
    const seen = new Map();   // '시각|높이|종류' → 그 줄을 가진 지점 수
    for (const code of Object.keys(raw)) for (const it of raw[code]) {
        const k = `${it.dt}|${it.lv}|${it.hl}`;
        seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const code of Object.keys(raw)) {
        const cnt = {};
        for (const it of raw[code]) { const k = it.dt.slice(0, 10) + it.hl; cnt[k] = (cnt[k] || 0) + 1; }
        const badDays = new Set(Object.keys(cnt).filter(k => cnt[k] > 4).map(k => k.slice(0, 10)));
        if (!badDays.size) continue;
        const before = raw[code].length;
        raw[code] = raw[code].filter(it => !(badDays.has(it.dt.slice(0, 10)) && seen.get(`${it.dt}|${it.lv}|${it.hl}`) > 1));
        console.log(`  · ${code} ${[...badDays].join(',')}: 다른 지점과 똑같은 줄 ${before - raw[code].length}건을 뺐다(API 원본에 섞여 온 줄)`);
    }
}

function main() {
    if (!YEAR) { console.error('사용: node build_tide_year_file.js <연도> [--write] [--partial]'); process.exit(1); }
    const codes = fs.readFileSync(path.join(SRC, '_stations.txt'), 'utf8').trim().split(/\s+/);
    const nodata = new Set(fs.existsSync(path.join(SRC, '_nodata.csv'))
        ? fs.readFileSync(path.join(SRC, '_nodata.csv'), 'utf8').trim().split(/\s+/).filter(Boolean) : []);
    const daysInYear = (YEAR % 4 === 0 && (YEAR % 100 !== 0 || YEAR % 400 === 0)) ? 366 : 365;
    const all = [], missing = [], short = [], raw = {};
    for (const code of codes) { const items = readStation(code); if (items) raw[code] = items; else missing.push(code); }
    dropForeign(raw);
    for (const code of codes) {
        const items = raw[code];
        if (!items) continue;
        const rows = toRows(code, items);
        const nd = [...nodata].filter(x => x.startsWith(code + ',')).length;
        if (rows.length + nd < daysInYear) short.push(`${code}(${rows.length}일+자료없음 ${nd}일)`);
        all.push(...rows);
    }
    all.sort((a, b) => a.stationCode < b.stationCode ? -1 : a.stationCode > b.stationCode ? 1 : a.date - b.date);
    console.log(`지점 ${codes.length}곳 중 받은 곳 ${codes.length - missing.length} · 못 받은 곳 ${missing.length} · 줄 ${all.length}`);
    if (short.length) console.log(`  ⚠ 날짜가 모자란 지점 ${short.length}: ${short.join(' ')}`);

    // ── 기존 파일과 대조(있으면) ──
    const outFile = path.join(TD, `tide_data_${YEAR}.js`);
    if (fs.existsSync(outFile)) {
        const sb = { window: {} };
        require('vm').runInNewContext(fs.readFileSync(outFile, 'utf8'), sb);
        const old = new Map((sb.window.TIDE_DATA_STORAGE[String(YEAR)] || []).map(r => [r.stationCode + '_' + r.date, r]));
        const sig = r => ['highTide', 'lowTide'].map(k => [1, 2, 3, 4].map(i => r[`${k}${i}Time`] == null ? '' : `${r[`${k}${i}Time`]}/${r[`${k}${i}Level`]}`).filter(Boolean).sort().join(' ')).join(' | ');
        let same = 0, diff = 0, onlyNew = 0, cntDiff = 0;
        const band = { '1분 이하': 0, '5분 이하': 0, '10분 이하': 0, '10분 초과': 0 };
        const hhmm = t => Math.floor(t / 100) * 60 + t % 100;
        const times = (r, k) => [1, 2, 3, 4].map(i => r[`${k}${i}Time`]).filter(t => t != null).map(hhmm).sort((a, b) => a - b);
        for (const r of all) {
            const o = old.get(r.stationCode + '_' + r.date);
            if (!o) { onlyNew++; continue; }
            if (sig(o) === sig(r)) { same++; continue; }
            diff++;
            // 다른 날: 고조·저조 개수가 같으면 시각순으로 짝지어 가장 큰 시각 차를 잰다(개수가 다르면 따로 센다)
            let worst = 0, mismatch = false;
            for (const k of ['highTide', 'lowTide']) {
                const a = times(r, k), b = times(o, k);
                if (a.length !== b.length) { mismatch = true; break; }
                a.forEach((t, i) => { worst = Math.max(worst, Math.abs(t - b[i])); });
            }
            if (mismatch) cntDiff++;
            else band[worst <= 1 ? '1분 이하' : worst <= 5 ? '5분 이하' : worst <= 10 ? '10분 이하' : '10분 초과']++;
        }
        const newKeys = new Set(all.map(r => r.stationCode + '_' + r.date));
        const got = new Set(all.map(r => r.stationCode));
        const onlyOld = [...old.keys()].filter(k => got.has(k.slice(0, k.lastIndexOf('_'))) && !newKeys.has(k)).length;
        console.log(`기존 파일과 대조(받은 지점만): 같은 날 ${same} · 다른 날 ${diff} [시각 차 ${Object.entries(band).map(([k, v]) => `${k} ${v}`).join(' · ')} · 고조/저조 개수가 다른 날 ${cntDiff}] · 새 파일에만 ${onlyNew} · 기존에만 ${onlyOld}`);
    }
    if (!WRITE) return;
    if (missing.length && !PARTIAL) { console.error(`✗ 아직 ${missing.length}곳을 못 받았다 — 쓰지 않는다(시험이면 --partial).`); process.exit(2); }

    const head = `// 조석 데이터 ${YEAR}년 (자동 생성됨)\n// 생성 일시: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
        `if (!window.TIDE_DATA_STORAGE) window.TIDE_DATA_STORAGE = {};\nwindow.TIDE_DATA_STORAGE['${YEAR}'] = `;
    fs.writeFileSync(outFile, head + JSON.stringify(all, null, 2) + ';');
    console.log(`저장: ${outFile} (${(fs.statSync(outFile).size / 1048576).toFixed(1)}MB)`);

    // ── 원본 묶음(기존 이름·기존 지점 구성 그대로, 코드가 바뀐 두 곳은 새 코드 자리로) ──
    const back = Object.fromEntries(Object.entries(ALIAS).map(([api, a]) => [a.code, api]));
    for (const f of fs.readdirSync(RAW).filter(x => new RegExp(`^tide_${YEAR}-${YEAR}_day\\d+_\\d+stations\\.csv$`).test(x))) {
        const order = [];
        for (const l of fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
            const c = l.split(',')[0].replace(/"/g, '');
            if (c && order[order.length - 1] !== c && !order.includes(c)) order.push(c);
        }
        const lines = ['"관측소코드","관측소명","날짜시간","조위(cm)","고저구분"'.replace(/"/g, '')];
        let n = 0;
        for (const c of order) for (const it of (raw[back[c] || c] || [])) { lines.push(`"${it.code}","${it.name}","${it.dt}","${it.lv}","${it.hl}"`); n++; }
        fs.writeFileSync(path.join(RAW, f), '﻿' + lines.join('\n') + '\n');
        console.log(`저장: ${f} (${order.length}곳 · ${n}줄)`);
    }
}
main();
