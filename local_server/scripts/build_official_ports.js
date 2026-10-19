/**
 * ============================================================================
 * 파일명: local_server/scripts/build_official_ports.js
 * 역할  : 해양수산부가 공공데이터포털(data.go.kr)에 올린 공식 항만·어항 파일(CSV)에서 항 이름·종류·대표 좌표(위경도)·
 *         국가어항 구역 경계만 골라 작은 정리 파일(config/coastal_safety/official_ports.json)을 만든다.
 *         이 정리 파일을 「항구 칸」 판정(scripts/gen_harbor_cells.js — 공식 근거)과 해역 이름 기준점이 함께 쓴다.
 *         사용자 2026-10-19: *"그 위치에 대한 GPS 정보를 확인해서 … 거기가 항구구나라는 걸 인식할 수 있도록"* ·
 *         공식 자료로 자동 확인 「좋아 진행하자」.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : <원본 폴더>/<데이터번호>.csv — 아래 SOURCES 의 공공데이터포털 파일데이터(로그인 없이 받는 원문 CSV, cp949)
 *  - 서버 API      : (--download 일 때만) https://www.data.go.kr/data/<번호>/fileData.do 상세 화면에서 원문 내려받기 주소를 읽어 받는다
 *  - 만드는 파일   : local_server/config/coastal_safety/official_ports.json
 *  - 나를 쓰는 곳  : 사람이 손으로 실행(원본이 새로 올라왔을 때) · scripts/test_harbor_cells.js(정리 파일 내용 검사)
 * [로드 순서] 독립 Node 실행(proj4·iconv-lite — local_server/node_modules).
 *   실행: node local_server/scripts/build_official_ports.js --src <원본 폴더> [--download]
 *   --download 를 주면 원본을 그 폴더에 먼저 받는다(이미 있으면 그대로 쓴다). 원본은 저장소에 넣지 않는다(정리 파일만 넣는다).
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const proj4 = require('proj4'), iconv = require('iconv-lite');
proj4.defs('EPSG:5179', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const OUT = path.join(__dirname, '..', 'config', 'coastal_safety', 'official_ports.json');
// 쓰는 원본(공공데이터포털 파일데이터). 이름·날짜는 포털 상세 화면 그대로(2026-10-19 확인). 이용허락범위는 모두 「제한 없음」.
const SOURCES = {
    port_info: { id: '15088273', title: '해양수산부_항만정보_20231212', provider: '해양수산부 항만기술안전과', use: '무역항·연안항 이름·종류(국가관리/지방관리)' },
    small_harbor: { id: '15148613', title: '해양수산부_공동활용체계_소형선항만안내_20171231', provider: '해양수산부 해양공간정책과(조사 국립해양조사원 2017)', use: '항 대표 좌표(도분초 위경도) — 이름이 같은 항에 쓴다' },
    port_plan: { id: '15129889', title: '해양수산부_항만기본계획(무역항 연안항)_20240717', provider: '해양수산부 해양공간정책과', use: '소형선항만안내에 없는 무역항·연안항의 대표 좌표(기본계획 이름이 「○○항」으로 시작하는 시설 도형 중 가장 넓은 것의 중심)' },
    national_fp: { id: '15149006', title: '해양수산부_공동활용체계_국가어항_20100423', provider: '해양수산부 해양공간정책과(조사 국립해양조사원 2012)', use: '국가어항 이름·어항구역 경계(위경도 다각형)' },
    national_fp_zone: { id: '15148598', title: '해양수산부_공동활용체계_국가어항구역_20210901', provider: '해양수산부 해양공간정책과', use: '국가어항 이름·어항구역 경계(EPSG:5179 다각형 — 위 파일에 없는 항만)' },
    local_fp: { id: '15147449', title: '해양수산부_공동활용체계_지방어항_20211230', provider: '해양수산부 해양공간정책과(조사 국립해양조사원 2017)', use: '지방어항 이름·좌표' },
    settle_fp: { id: '15147417', title: '해양수산부_공동활용체계_어촌정주어항_20231119', provider: '해양수산부 해양공간정책과', use: '어촌정주어항 이름·좌표' },
    village_fp: { id: '15144585', title: '해양수산부_공동활용체계_마을공동어항_20200224', provider: '해양수산부 해양공간정책과', use: '마을공동어항 이름·좌표' },
    fishport: { id: '15147455', title: '해양수산부_공동활용체계_어항_20211123', provider: '해양수산부 해양공간정책과', use: '국가어항 대표 좌표(소형선항만안내에 없을 때)' }
};
const KINDS = ['무역항', '연안항', '국가어항', '지방어항', '어촌정주어항', '마을공동어항'];   // 앞일수록 우선(같은 항이 두 목록에 있으면 앞 종류)

/** cp949 CSV 를 행 객체 배열로. 따옴표 안 쉼표·줄바꿈 처리. 예: readCsv(dir,'15147449') → [{어항명:'가진항',…}] @returns {object[]} [연계] ← build */
function readCsv(dir, id) {
    const t = iconv.decode(fs.readFileSync(path.join(dir, id + '.csv')), 'cp949'), rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const h = rows.shift().map((k) => k.replace(/^﻿/, '').trim());
    return rows.filter((r) => r.length === h.length).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i].trim()])));
}
/** 이름 비교용. 예: '대포항(제주)' → '대포항' · '평택,당진항' → '평택당진항' @returns {string} */
const norm = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/[\s,·]/g, '');
/** WKT(MULTI)POLYGON/POINT → 고리 배열 [[[x,y],…],…]. 잘린(끝 괄호 없는) 글자는 빈 배열. @returns {number[][][]} */
function wkt(s) { s = String(s || ''); if (!/\)\s*$/.test(s)) return []; const rings = []; for (const m of s.matchAll(/\(([^()]+)\)/g)) rings.push(m[1].split(',').map((p) => p.trim().split(/\s+/).map(Number))); return rings; }
/** 고리 넓이(좌표 단위²)·중심. @returns {{a:number,c:number[]}} */
function ringStat(r) { let a = 0, cx = 0, cy = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const k = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k; } return a ? { a: Math.abs(a / 2), c: [cx / (3 * a), cy / (3 * a)] } : { a: 0, c: r[0] }; }
/** 도분초 글자 → 도. 예: '33-25-13.65N' → 33.42046 @returns {number|null} */
function dms(s) { const m = String(s || '').match(/^(\d+)-(\d+)-([\d.]+)([NSEW])$/); return m ? (+m[1] + m[2] / 60 + m[3] / 3600) * (/[SW]/.test(m[4]) ? -1 : 1) : null; }
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const toLL = (p) => proj4('EPSG:5179', 'EPSG:4326', p);
/** 두 점 거리(km). @returns {number} */
function km(a, b) { const R = 6371, d = Math.PI / 180, x = (b.lon - a.lon) * d * Math.cos((a.lat + b.lat) / 2 * d), y = (b.lat - a.lat) * d; return R * Math.hypot(x, y); }
/** 한반도 둘레 안인가. @returns {boolean} */
const inKr = (lat, lon) => lat > 32.5 && lat < 39 && lon > 124 && lon < 132;
/** 더글러스-포이커 단순화(도 단위 허용오차). @returns {number[][]} */
function simplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [s, e] = st.pop(); let mx = 0, k = -1; const [x1, y1] = pts[s], [x2, y2] = pts[e], L = Math.hypot(x2 - x1, y2 - y1);
        // 닫힌 고리는 처음·끝 점이 같아 선분 길이가 0 — 그때는 그 점까지의 거리
        for (let i = s + 1; i < e; i++) { const d = L ? Math.abs((y2 - y1) * pts[i][0] - (x2 - x1) * pts[i][1] + x2 * y1 - y2 * x1) / L : Math.hypot(pts[i][0] - x1, pts[i][1] - y1); if (d > mx) { mx = d; k = i; } }
        if (mx > tol && k > 0) { keep[k] = 1; st.push([s, k], [k, e]); } }
    return pts.filter((_, i) => keep[i]);
}

/**
 * 원본 폴더로 정리 파일 내용을 만든다(쓰지는 않는다).
 * 예: build('/tmp/ports') → {schema:'official-ports-v1', ports:[{name:'한림항',kind:'연안항',lat:33.42046,lon:126.25364,src:['port_info','small_harbor']},…], …}
 * @param {string} dir - 원본 폴더(<번호>.csv) @returns {object} 정리 파일 내용
 * [연계] ← main / → readCsv
 */
function build(dir) {
    const raw = Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, readCsv(dir, s.id)]));
    // 소형선항만안내 — 이름 → 좌표(같은 이름 여럿이면 모두)
    const small = new Map();
    for (const r of raw.small_harbor) { const lat = dms(r['소형선항만도분초위도']), lon = dms(r['소형선항만도분초경도']); if (lat == null || lon == null || !inKr(lat, lon)) continue; const k = norm(r['항만명']); if (!small.has(k)) small.set(k, []); small.get(k).push({ lat, lon }); }
    const fish = new Map();   // 어항 파일(좌표 있는 줄만)
    for (const r of raw.fishport) { const lat = +r['위도'], lon = +r['경도']; if (!r['위도'] || !r['경도'] || !inKr(lat, lon)) continue; const k = norm(r['어항명']); if (!fish.has(k)) fish.set(k, []); fish.get(k).push({ lat, lon }); }
    const ports = [], unlocated = [];
    /** 이름으로 좌표 하나 고르기 — 후보가 하나면 그것, 여럿이면 near 에 가장 가까운 것(near 없으면 고르지 않음). */
    const pick = (list, near) => !list || !list.length ? null : list.length === 1 ? list[0] : near ? list.slice().sort((a, b) => km(a, near) - km(b, near))[0] : null;
    // ① 무역항·연안항(항만정보) — 좌표: 소형선항만안내 같은 이름 → 항만기본계획 「○○항…」 가장 넓은 시설 도형 중심
    const plans = new Map();
    for (const r of raw.port_plan) { const m = norm(r['기본계획명']).match(/^(.+?항)/); if (!m || /^(전국항만|국가관리연안항|항만기본)/.test(norm(r['기본계획명']))) continue; for (const ring of wkt(r['공간정보'])) { const s = ringStat(ring); if (!plans.has(m[1]) || s.a > plans.get(m[1]).a) plans.set(m[1], s); } }
    for (const r of raw.port_info) {
        const name = r['항만명'].trim(), sub = r['국가관리구분'] + ' ' + r['항구분'], kind = r['항구분'] === '연안항' ? '연안항' : '무역항';   // 신항만은 무역항 계열로 둔다(sub 에 원래 구분)
        const s = pick(small.get(norm(name))), p = plans.get(norm(name));
        if (s) ports.push({ name, kind, sub, lat: r5(s.lat), lon: r5(s.lon), src: ['port_info', 'small_harbor'] });
        else if (p) { const [lon, lat] = toLL(p.c); ports.push({ name, kind, sub, lat: r5(lat), lon: r5(lon), src: ['port_info', 'port_plan'] }); }
        else unlocated.push({ name, kind, sub, src: 'port_info' });
    }
    // ② 국가어항 — 이름·구역: 국가어항(위경도) ∪ 국가어항구역(5179). 좌표: 소형선항만안내 → 어항 파일 → 구역 도형 중심
    const nat = new Map();
    for (const r of raw.national_fp) { const n = r['국가어항구역명'].trim(), rings = wkt(r['공간정보']); if (!nat.has(norm(n))) nat.set(norm(n), { name: n, rings, src: 'national_fp' }); }
    for (const r of raw.national_fp_zone) { const n = r['국가어항구역명'].trim(); if (nat.has(norm(n)) && nat.get(norm(n)).rings.length) continue; nat.set(norm(n), { name: n, rings: wkt(r['공간정보']).map((ring) => ring.map(toLL)), src: 'national_fp_zone' }); }
    for (const [k, v] of nat) {
        const rings = v.rings.filter((x) => x.length > 3), big = rings.map(ringStat).sort((a, b) => b.a - a.a)[0], center = big ? { lon: big.c[0], lat: big.c[1] } : null;
        // 이름이 같은 점이 구역에서 5km 넘게 멀면(다른 곳의 같은 이름) 쓰지 않는다
        const near = (q) => q && (!center || km(q, center) <= 5) ? q : null;
        const s = near(pick(small.get(k), center)), f = near(pick(fish.get(k), center)), at = s ? [s, 'small_harbor'] : f ? [f, 'fishport'] : center ? [center, v.src] : null;
        if (!at || !inKr(at[0].lat, at[0].lon)) { unlocated.push({ name: v.name, kind: '국가어항', src: v.src }); continue; }
        const zone = rings.map((ring) => simplify(ring, 0.0002).map(([x, y]) => [r5(x), r5(y)])).filter((x) => x.length > 3);
        ports.push({ name: v.name, kind: '국가어항', lat: r5(at[0].lat), lon: r5(at[0].lon), src: [...new Set([v.src, at[1]])], ...(zone.length ? { zone } : {}) });
    }
    // ③ 지방어항·어촌정주어항·마을공동어항 — 파일 좌표 그대로(정주·마을 파일은 「위도」 칸에 경도가 들어 있어 값 범위로 가린다)
    for (const r of raw.local_fp) { const m = (r['공간정보'] || '').match(/POINT \(([\d.]+) ([\d.]+)\)/); if (!m) { unlocated.push({ name: r['어항명'], kind: '지방어항', src: 'local_fp' }); continue; } ports.push({ name: r['어항명'].trim(), kind: '지방어항', lat: r5(+m[2]), lon: r5(+m[1]), src: ['local_fp'] }); }
    for (const [key, kind, nameCol] of [['settle_fp', '어촌정주어항', '어촌정주어항명칭'], ['village_fp', '마을공동어항', '어촌정주어항명칭']]) {
        for (const r of raw[key]) { const a = +r['어촌정주어항위도'], b = +r['어촌정주어항경도'], lon = a > 100 ? a : b, lat = a > 100 ? b : a;
            if (!inKr(lat, lon)) { unlocated.push({ name: r[nameCol], kind, src: key }); continue; } ports.push({ name: r[nameCol].trim(), kind, lat: r5(lat), lon: r5(lon), src: [key] }); }
    }
    // 같은 이름이 두 종류 목록에 2km 안으로 겹치면 앞 종류 하나만(무역항 > 연안항 > 국가어항 > 지방어항 > 어촌정주어항 > 마을공동어항)
    ports.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, 'ko') || a.lat - b.lat);
    const kept = [], dropped = [];
    for (const p of ports) { const d = kept.find((q) => norm(q.name) === norm(p.name) && km(q, p) < 2); if (d) dropped.push({ name: p.name, kind: p.kind, keptAs: d.kind }); else kept.push(p); }
    const counts = Object.fromEntries(KINDS.map((k) => [k, kept.filter((p) => p.kind === k).length]));
    return {
        schema: 'official-ports-v1', builtAt: new Date().toISOString().slice(0, 10), builder: 'local_server/scripts/build_official_ports.js',
        note: '해양수산부 공공데이터포털 파일데이터에서 항 이름·종류·대표 좌표(위경도, 소수 다섯째 자리)·국가어항 구역 경계(위경도, 약 20m 단순화)만 옮긴 정리 파일. 이용허락범위: 공공데이터포털 표기 「제한 없음」. 출처 표기: 각 항의 src → sources.',
        sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { ...s, url: 'https://www.data.go.kr/data/' + s.id + '/fileData.do', rows: raw[k].length, license: '공공데이터포털 이용허락범위 「제한 없음」' }])),
        counts: { ...counts, total: kept.length, withZone: kept.filter((p) => p.zone).length, unlocated: unlocated.length, mergedDuplicates: dropped.length },
        unlocated, mergedDuplicates: dropped, ports: kept
    };
}

/** 상세 화면에서 원문 내려받기 주소를 찾아 받는다(이미 있으면 건너뜀). @returns {Promise<void>} [연계] ← main(--download) */
async function download(dir) {
    fs.mkdirSync(dir, { recursive: true });
    // 포털 연결이 가끔 끊긴다(2026-10-19 작업 환경 ECONNRESET) — 다섯 번까지 2초 간격으로 다시
    const get = async (u) => { for (let k = 0; ; k++) { try { const r = await fetch(u); if (!r.ok) throw Error('HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); } catch (e) { if (k >= 4) throw e; await new Promise((res) => setTimeout(res, 2000)); } } };
    for (const s of Object.values(SOURCES)) {
        const file = path.join(dir, s.id + '.csv'); if (fs.existsSync(file)) continue;
        const html = (await get('https://www.data.go.kr/data/' + s.id + '/fileData.do')).toString(), m = html.match(/fileDownload\.do\?atchFileId=([A-Z0-9_]+)&(?:amp;)?fileDetailSn=(\d+)/);
        if (!m) throw Error(s.id + ' 내려받기 주소를 찾지 못함');
        fs.writeFileSync(file, await get('https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=' + m[1] + '&fileDetailSn=' + m[2] + '&insertDataPrcus=N')); console.log('받음', s.id, s.title);
    }
}
async function main() {
    const a = process.argv.slice(2), src = a[a.indexOf('--src') + 1];
    if (a.indexOf('--src') < 0 || !src) throw Error('--src <원본 폴더> 가 필요하다');
    if (a.includes('--download')) await download(src);
    const out = build(src);
    fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
    console.log(JSON.stringify(out.counts));
}
if (require.main === module) main().catch((e) => { console.error('[build_official_ports] 실패:', e.message); process.exit(1); });
module.exports = { build, readCsv, norm, dms, SOURCES, KINDS };
