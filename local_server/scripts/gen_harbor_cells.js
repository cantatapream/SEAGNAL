/**
 * ============================================================================
 * 파일명: local_server/scripts/gen_harbor_cells.js
 * 역할  : 해상 교통 칸(GR4, 0.025°) 가운데 「항구 칸」(항·포구·방파제 안 — 정박·계류 배가 늘 세어지는 칸)을 골라
 *         고정 목록(config/coastal_safety/harbor_cells.json)과 사람이 확인할 「불확실」 후보표(마크다운)를 다시 만든다.
 *         사용자 2026-10-19 원문: *"항구에서 잡히는 것은 사실 통항이라고 보기는 어렵고 상시 그 배가 그 위치에 정박해서 계류하고
 *         있는 상태를 의미하는 거라서 … 전국의 각 항마다 … 전체적으로 확인해서 제외할 수 있는 방안을 마련해야 하고"* ·
 *         목록 확정 선택 「자동판정후 애매한곳은1번으로」(강·중은 바로 적용, 불확실은 후보표로만).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/coastal_hazard_zones.wgs84.geojson(해경 연안사고 위험구역 — 항포구·방파제·선착장 도형)
 *                    · client/accident_ships_hk.json(과거 선박사고 장소글) · client/land_mask_korea.json(육지 비율)
 *                    · config/coastal_safety/official_ports.json(해양수산부 공식 항만·어항 위치·국가어항 구역 — scripts/build_official_ports.js 가 만든다.
 *                      2026-10-19 「좋아 진행하자」 — 공식 자료로 자동 확인: 불확실 칸에 공식 항이 있으면 「공식」 등급으로 목록에 올린다)
 *                    · services/sea_realtime_collector.js(cellBounds — 칸 번호 → 상자)
 *  - 서버 API      : (실행할 때만) 운영 공개 GET /api/risk-forecast/meta · sea/traffic-cells · sea/current · sea/unified-cells
 *                    · sea/unified-frame?mode=congestion · sea/traffic-history?days=15 — 인증 없음, 동시 4개·간격 둠
 *  - 나를 쓰는 곳  : 사람이 손으로 실행(재생성) · scripts/test_harbor_cells.js(판정 함수 grade·evidenceFor 를 불러 시험)
 * [로드 순서] 독립 Node 실행. require 하면 판정 함수만 내보내고 네트워크를 쓰지 않는다.
 *   실행: node local_server/scripts/gen_harbor_cells.js [--server https://seagnal-server.fly.dev] [--cache <폴더>]
 *   --cache 를 주면 받은 응답을 그 폴더에 두고 다음 실행에서 다시 쓴다(같은 자료로 판정만 다시 돌릴 때).
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const { cellBounds } = require('../services/sea_realtime_collector');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'local_server', 'config', 'coastal_safety', 'harbor_cells.json');
const REVIEW = path.join(ROOT, 'client', 'js', 'marine-life', 'risk-forecast', 'harbor_cells_review.md');
const OFFICIAL = 'local_server/config/coastal_safety/official_ports.json';
// 항구 근거로 보는 해경 위험구역 장소형태(820곳 중 461곳 — 2026-10-19 집계). 갯바위·해변·갯벌·무인도서는 넣지 않는다.
const PORT_TYPES = new Set(['항포구(선착장)', '방파제(TTP)', '방파제', '선착장', '항포구']);
// 사고 장소글이 항 안을 가리키는 말. 「○○ 동방 3마일」처럼 거리가 붙은 글은 항 밖이라 뺀다.
const INPORT = /항\s*내|항내|안벽|물양장|계류|정박|부두|접안|선착장|포구|선창|어항|마리나|방파제/;
const OFFSET = /\d+(\.\d+)?\s*(마일|해리|km|키로)/;
const NAME = /[가-힣]{1,6}(?:항|포구|선착장|부두|방파제)/g;
const BUSY = 14;   // 「붐비는 해역」 기준(routes/station_briefing.js nowLineFrom · marine_fusion NOTICE_COUNT 와 같은 값)

/**
 * 판정에 쓰는 저장소 자료를 한 번 읽어 찾기 쉬운 꼴로 만든다.
 * 예: buildContext() → {land:Map(위도 0.01° 줄 → 변들), hazards:[{name,type,box,rings}], accidents:Map('칸열,칸행' → [{text,inPort}]),
 *      official:[{name,kind,lat,lon,rings,box}]}
 * @param {object} [files] - 시험용 자료 주입 {hazards, accidents, land, official(official_ports.json 의 ports 꼴)} @returns {object} 판정 문맥
 * [연계] ← main·test_harbor_cells / → evidenceFor 가 칸마다 쓴다
 */
function buildContext(files = {}) {
    const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    const hz = files.hazards || read('local_server/config/coastal_safety/coastal_hazard_zones.wgs84.geojson').features;
    const hazards = [];
    for (const f of hz) {
        const p = f.properties || {}; if (!PORT_TYPES.has(p['장소형태']) || !f.geometry) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        const rings = polys.flat(), pts = rings.flat();
        hazards.push({ name: p['장소명'] || p.name || '', type: p['장소형태'], rings, box: [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))] });
    }
    const accidents = new Map();
    for (const r of files.accidents || read('client/accident_ships_hk.json').rows) {
        if (!Number.isFinite(r[0]) || !Number.isFinite(r[1])) continue;
        const t = String(r[4] || ''), key = Math.floor(r[1] * 40) + ',' + Math.floor(r[0] * 40);
        if (!accidents.has(key)) accidents.set(key, []);
        accidents.get(key).push({ text: t, inPort: INPORT.test(t) && !OFFSET.test(t) });
    }
    const land = new Map();   // 위도 0.01° 줄마다 그 줄을 지나는 육지 경계 변 — 점 하나는 자기 줄의 변만 센다(짝·홀 규칙)
    for (const ring of files.land || read('client/land_mask_korea.json').rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            for (let b = Math.floor(Math.min(yi, yj) * 100); b <= Math.floor(Math.max(yi, yj) * 100); b++) { if (!land.has(b)) land.set(b, []); land.get(b).push(xi, yi, xj, yj); }
        }
    }
    // 공식 항(해양수산부) — 대표 좌표와, 있으면 국가어항 구역 경계(위경도 고리)
    const official = (files.official || read(OFFICIAL).ports).map((p) => {
        const rings = p.zone || [], pts = rings.flat();
        return { name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, rings, box: pts.length ? [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))] : null };
    });
    return { hazards, accidents, land, official };
}
/**
 * 칸 상자 안의 공식 항(해양수산부) — 대표 좌표가 상자 안이면 「점」, 아니고 국가어항 구역이 상자와 겹치면 「구역」.
 * 예: officialIn(ctx, 한림항 칸 상자) → [{name:'한림항', kind:'연안항', how:'점'}, …]
 * @param {object} ctx - buildContext @param {number[]} b - [서,남,동,북] @returns {{name:string,kind:string,how:string}[]}
 * [연계] ← evidenceFor / → touches
 */
function officialIn(ctx, b) {
    const out = [];
    for (const p of ctx.official) {
        if (p.lon >= b[0] && p.lon < b[2] && p.lat >= b[1] && p.lat < b[3]) out.push({ name: p.name, kind: p.kind, how: '점' });
        else if (p.box && touches(p, b)) out.push({ name: p.name, kind: p.kind, how: '구역' });
    }
    return out;
}
/** 점이 육지 안인가(짝·홀 규칙). 예: 한림읍 시가지 → true · 먼바다 → false. @returns {boolean} [연계] ← landShare */
function onLand(ctx, lon, lat) {
    const e = ctx.land.get(Math.floor(lat * 100)); if (!e) return false; let inside = false;
    for (let k = 0; k < e.length; k += 4) { const xi = e[k], yi = e[k + 1], xj = e[k + 2], yj = e[k + 3]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
}
/** 칸 상자 안 10×10 점 중 육지 점 비율(0~1, 소수 둘째 자리). 예: 한림항 칸 ≈ 0.74 · 보령 앞바다 칸 0. @returns {number} [연계] ← evidenceFor */
function landShare(ctx, b) {
    let n = 0; for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) if (onLand(ctx, b[0] + (x + .5) * (b[2] - b[0]) / 10, b[1] + (y + .5) * (b[3] - b[1]) / 10)) n++;
    return n / 100;
}
/** 선분이 상자와 만나는가(리앙-바스키 자르기). 예: 상자를 가로지르는 변 → true. @returns {boolean} [연계] ← touches */
function segHitsBox(x0, y0, x1, y1, b) {
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0 - b[0]], [dx, b[2] - x0], [-dy, y0 - b[1]], [dy, b[3] - y0]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
}
/** 점이 고리들 안인가(짝·홀). @returns {boolean} [연계] ← touches */
function inRings(rings, x, y) { let inside = false; for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
/** 위험구역 도형이 칸 상자와 겹치는가 — 변이 상자와 만나거나, 상자 가운데가 도형 안(도형이 상자를 감쌈). @returns {boolean} [연계] ← evidenceFor */
function touches(h, b) {
    if (h.box[2] < b[0] || h.box[0] > b[2] || h.box[3] < b[1] || h.box[1] > b[3]) return false;
    for (const ring of h.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segHitsBox(ring[j][0], ring[j][1], ring[i][0], ring[i][1], b)) return true;
    return inRings(h.rings, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
}
/**
 * 칸 하나의 항구 근거를 모은다.
 * 예: evidenceFor(ctx,'GR4_F4K32_F3') → {hazards:['한림항'], accInPort:29, accAll:157, names:['한림항','북방파제'], land:0.74,
 *      official:[{name:'한림항',kind:'연안항',how:'점'}, …]}
 * @param {object} ctx - buildContext @param {string} id - GR4 칸 번호 @returns {object|null} 번호로 상자를 못 구하면 null
 * [연계] ← main·test_harbor_cells / → touches·landShare
 */
function evidenceFor(ctx, id) {
    const b = cellBounds(id); if (!b) return null;
    const hz = ctx.hazards.filter((h) => touches(h, b)).map((h) => h.name);
    const acc = ctx.accidents.get(Math.round(b[0] * 40) + ',' + Math.round(b[1] * 40)) || [], inPort = acc.filter((a) => a.inPort);
    const names = new Map(); for (const a of inPort) for (const m of a.text.match(NAME) || []) names.set(m, (names.get(m) || 0) + 1);
    return { hazards: [...new Set(hz)], accInPort: inPort.length, accAll: acc.length, names: [...names].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'ko')).slice(0, 3).map((x) => x[0]), land: landShare(ctx, b), official: officialIn(ctx, b) };
}
/**
 * 근거로 등급을 정한다. 강·중 = 목록에 넣어 바로 적용, 불확실 = 사람 확인 후보표, 아님 = 넣지 않음.
 *   강 = 해경 항포구·방파제·선착장 구역이 칸에 걸침 + 항 안 사고글 1건 이상
 *   중 = 해경 구역만 걸침, 또는 항 안 사고글 3건 이상이고 육지 10% 이상
 *   공식 = 아래 「불확실」 근거가 있고, 칸 안에 해양수산부 공식 항(무역항·연안항·국가어항·지방어항·어촌정주어항·마을공동어항)의
 *          대표 좌표가 있거나 국가어항 구역이 칸과 겹침 — 목록에 넣는다(2026-10-19 「좋아 진행하자」 — 공식 자료로 자동 확인)
 *   불확실 = 그 밖에 항 안 사고글 1건 이상이거나 육지 10% 이상
 *   아님 = 근거 없음(육지도 10% 미만) — 선박 수가 아무리 많거나 늘 많아도 넣지 않는다(보령 앞바다 같은 진짜 혼잡을 지우지 않게).
 *          공식 항이 있어도 「아님」이면 올리지 않는다(지시 범위: 불확실 칸만 공식 근거로 올림).
 * 예: grade({hazards:['한림항'],accInPort:29,land:.74}) → '강' · grade({hazards:[],accInPort:0,land:.3,official:[{name:'옥포항'}]}) → '공식' · grade({hazards:[],accInPort:0,land:0}) → '아님'
 * @param {object} ev - evidenceFor 결과 @returns {string} '강'|'중'|'공식'|'불확실'|'아님'
 * [연계] ← main·test_harbor_cells
 */
function grade(ev) {
    if (!ev) return '아님';
    if (ev.hazards.length && ev.accInPort >= 1) return '강';
    if (ev.hazards.length || (ev.accInPort >= 3 && ev.land >= 0.1)) return '중';
    if (ev.accInPort >= 1 || ev.land >= 0.1) return ev.official && ev.official.length ? '공식' : '불확실';
    return '아님';
}

// ── 아래는 실행할 때만(운영 공개 API 를 읽어 후보를 모은다) ─────────────────────────────
/** 인자를 읽는다. 예: ['--cache','/tmp/x'] → {server,cache:'/tmp/x'} @returns {object} [연계] ← main */
function args(argv) { const o = { server: 'https://seagnal-server.fly.dev', cache: null }; for (let i = 0; i < argv.length; i++) { if (argv[i] === '--server') o.server = argv[++i]; else if (argv[i] === '--cache') o.cache = argv[++i]; } return o; }
/** 공개 GET 하나(캐시 폴더가 있으면 먼저 본다). @returns {Promise<object>} [연계] ← main */
async function get(o, p) {
    const file = o.cache && path.join(o.cache, p.replace(/[^\w.-]+/g, '_') + '.json');
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    for (let k = 0; ; k++) {
        try { const r = await fetch(o.server + '/api/risk-forecast/' + p); if (!r.ok) throw Error('HTTP ' + r.status); const j = await r.json(); if (file) fs.writeFileSync(file, JSON.stringify(j)); return j; }
        catch (e) { if (k >= 2) throw e; await new Promise((res) => setTimeout(res, 2000)); }
    }
}
/** 일들을 동시 n개씩 돌린다. @returns {Promise<array>} [연계] ← main */
async function pool(items, n, fn) { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); await new Promise((r) => setTimeout(r, 50)); } })); return out; }
/** 표에 쓸 퍼센트. 예: 0.834 → '83%' @returns {string} */
const pct = (x) => x == null ? '-' : Math.round(x * 100) + '%';
/** 공식 항 목록 글자. 예: [{name:'한림항',kind:'연안항',how:'점'}] → '한림항(연안항)' · 구역이면 '도두항(국가어항 · 구역)' @returns {string} */
const officialText = (list) => list.map((p) => p.name + '(' + p.kind + (p.how === '구역' ? ' · 구역' : '') + ')').join('·');
/**
 * 칸 중심에서 가장 가까운 공식 항(후보표 「공식 근거」 칸 — 공식 근거가 없을 때 사람이 볼 참고).
 * 예: nearestOfficial(ctx, {lat:34.7125, lon:128.0375}) → '가장 가까운 공식 항 ○○항(지방어항) 1.8km' @returns {string}
 */
function nearestOfficial(ctx, c) {
    let best = null, d = Infinity; const k = Math.cos(c.lat * Math.PI / 180);
    for (const p of ctx.official) { const x = Math.hypot((p.lon - c.lon) * k, p.lat - c.lat) * 111.2; if (x < d) { d = x; best = p; } }
    return best ? '가장 가까운 공식 항 ' + best.name + '(' + best.kind + ') ' + d.toFixed(1) + 'km' : '-';
}
/** 칸 하나의 표 줄. @returns {string} [연계] ← main(불확실 후보표 — 「공식 근거」 칸 포함) */
function reviewRow(c, k, ctx) {
    const ev = c.evidence, why = [ev.hazards.length ? '해경 구역 ' + ev.hazards.slice(0, 2).join('·') : null, ev.accInPort ? '항 안 사고글 ' + ev.accInPort + '건' + (ev.names.length ? '(' + ev.names.join('·') + ')' : '') : null, '육지 ' + pct(ev.land)].filter(Boolean).join(' · ');
    const off = ev.official && ev.official.length ? officialText(ev.official) : '없음 — ' + nearestOfficial(ctx, c);
    return '| ' + k + ' | ' + c.id + ' | ' + c.lat.toFixed(4) + ', ' + c.lon.toFixed(4) + ' | ' + (c.maxCount ?? '-') + ' | ' + (c.now ?? '-') + ' | ' + (c.congMax || '-') + ' | ' + why + ' | ' + off + ' | ' + pct(c.share14) + ' | https://www.google.com/maps?q=' + c.lat.toFixed(4) + ',' + c.lon.toFixed(4) + ' | |';
}
/** 운영 자료로 후보를 모아 판정하고 두 파일을 쓴다. @returns {Promise<void>} [연계] ← 명령행 실행 */
async function main() {
    const o = args(process.argv.slice(2)); if (o.cache) fs.mkdirSync(o.cache, { recursive: true });
    const ctx = buildContext();
    const meta = await get(o, 'meta'), tc = await get(o, 'sea/traffic-cells'), cur = await get(o, 'sea/current'), uc = await get(o, 'sea/unified-cells');
    if (tc.v !== cur.v) throw Error('실시간 칸 표와 현재 값의 버전이 다르다 — 다시 실행');
    const pos = new Map();   // GR4 칸 → 중심
    for (const c of tc.cells || []) if (String(c.id).startsWith('GR4_')) pos.set(c.id, { lat: c.lat, lon: c.lon, live: true });
    for (const c of uc.cells || []) if (String(c.id).startsWith('GR4_') && !pos.has(c.id)) pos.set(c.id, { lat: c.lat, lon: c.lon, live: false });
    const byI = new Map((tc.cells || []).map((c) => [c.i, c.id])), now = new Map((cur.cells || []).map((r) => [byI.get(r[0]), r[1]]));
    // 혼잡 예보: 메인 시간 막대의 해상 시각마다(지금~내일 23시) '높음' 이상인 칸의 가장 높은 단계
    const uById = new Map(uc.cells.map((c) => [c.i, c.id])), RANK = { '높음': 2, '매우높음': 3 }, cong = new Map();
    const times = meta.timeline.sea.times;
    await pool(times, 2, async (t) => { const f = await get(o, 'sea/unified-frame?mode=congestion&t=' + encodeURIComponent(t)); if (f.v !== uc.v) throw Error('혼잡 예보 프레임 버전이 칸 표와 다르다 — 다시 실행'); for (const r of f.cells || []) if (RANK[r[2]]) { const id = uById.get(r[0]), old = cong.get(id); if (!old || RANK[r[2]] > RANK[old]) cong.set(id, r[2]); } });
    // 근거(해경 구역·항 안 사고글·육지 10% 이상)가 하나라도 있는 칸만 이력을 묻는다 — 근거 없는 칸은 몇 척이든 「아님」이라 목록·후보표에 오지 않는다.
    const ev = new Map(); for (const id of pos.keys()) { const e = evidenceFor(ctx, id); if (grade(e) !== '아님') ev.set(id, e); }
    const ask = [...ev.keys()].filter((id) => pos.get(id).live), hist = new Map();
    let span = null;
    await pool(ask, 4, async (id) => {
        const h = await get(o, 'sea/traffic-history?cell=' + id + '&days=15'), v = (h.traffic.values || []).map((x, i) => [i, x]).filter((x) => x[1] !== null);
        if (!v.length) return; const xs = v.map((x) => x[1]);
        if (!span) span = { start: h.start, first: v[0][0], last: v[v.length - 1][0], slots: v.length };
        hist.set(id, { max: Math.max(...xs), share14: xs.filter((x) => x >= BUSY).length / xs.length });
    });
    const cand = [];
    for (const [id, e] of ev) {
        const h = hist.get(id), n = now.get(id) ?? null, c = cong.get(id) || null;
        const why = [h && h.max >= BUSY ? 'history' : null, n !== null && n >= BUSY ? 'now' : null, c ? 'congestion' : null].filter(Boolean);
        if (!why.length) continue;
        const p = pos.get(id); cand.push({ id, lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, grade: grade(e), why, now: n, maxCount: h ? Math.round(h.max * 10) / 10 : null, share14: h ? Math.round(h.share14 * 100) / 100 : null, congMax: c, evidence: e });
    }
    cand.sort((a, b) => a.id.localeCompare(b.id));
    const applied = cand.filter((c) => c.grade === '강' || c.grade === '중' || c.grade === '공식'), unsure = cand.filter((c) => c.grade === '불확실');
    const offMeta = JSON.parse(fs.readFileSync(path.join(ROOT, OFFICIAL), 'utf8')), noOfficial = applied.filter((c) => !c.evidence.official.length);
    const at = (i) => span ? new Date(Date.parse(span.start) + i * 1800000 + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '-';
    const window = span ? at(span.first) + ' ~ ' + at(span.last) + ' KST(30분 칸 ' + span.slots + '개)' : '이력 없음';
    const out = {
        schema: 'harbor-cells-v1', generatedAt: meta.now, source: o.server + ' 공개 API(traffic-cells v ' + tc.v + ' · unified-cells v ' + uc.v + ')',
        criteria: {
            candidate: '근거(해경 항포구·방파제·선착장 구역 / 항 안 사고글 / 육지 10% 이상)가 있는 GR4 칸 가운데, 실시간 30분 평균 척수 이력(' + window + ')에서 한 번이라도 ' + BUSY + '척 이상 · 지금(' + (cur.status && cur.status.sourceAt) + ') ' + BUSY + '척 이상 · 혼잡 예보(' + times[0] + ' ~ ' + times[times.length - 1] + ') \'높음\' 이상 중 하나',
            grade: '강 = 해경 구역 + 항 안 사고글 1건 이상 · 중 = 해경 구역만, 또는 항 안 사고글 3건 이상이고 육지 10% 이상 · 공식 = 불확실 근거 + 칸 안에 해양수산부 공식 항(대표 좌표 또는 국가어항 구역) · 불확실 = 그 밖의 근거(목록에 넣지 않고 후보표로) · 아님 = 근거 없음',
            official: '공식 항 = ' + OFFICIAL + '(' + offMeta.builder + ' — 해양수산부 공공데이터포털 파일데이터 ' + Object.values(offMeta.sources).map((s) => s.title + '(data.go.kr/data/' + s.id + ')').join(' · ') + ', 이용허락범위 「제한 없음」). 칸마다 official = [{name, kind, how:점|구역}]',
            applied: '강·중·공식이 이 목록에 들어가 혼잡 판정(지금 밀집·충돌·접촉 주의·혼잡 예보 관심 단계·관할 합계)에서 빠지고 지도에서 회색이 된다'
        },
        counts: { evidenceCells: ev.size, historyAsked: ask.length, candidates: cand.length, applied: applied.length, strong: applied.filter((c) => c.grade === '강').length, medium: applied.filter((c) => c.grade === '중').length, official: applied.filter((c) => c.grade === '공식').length, uncertain: unsure.length, strongMediumWithOfficial: applied.filter((c) => c.grade !== '공식' && c.evidence.official.length).length, strongMediumWithoutOfficial: noOfficial.length },
        cells: applied.map(({ id, lat, lon, grade: g, why, maxCount, share14, congMax, evidence }) => ({ id, lat, lon, grade: g, why, maxCount, share14, congMax, hazards: evidence.hazards, accInPort: evidence.accInPort, names: g === '공식' ? [...new Set([...evidence.official.map((p) => p.name), ...evidence.names])].slice(0, 3) : evidence.names, land: evidence.land, official: evidence.official }))
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
    const byCount = (a, b) => (b.maxCount ?? b.now ?? 0) - (a.maxCount ?? a.now ?? 0) || a.id.localeCompare(b.id);
    const HEAD = ['| # | 칸 | 위도, 경도 | 이력 최대(30분 평균) | 지금 | 혼잡 예보 | 근거 | 공식 근거 | 14척↑ 비율 | 구글맵 | 확인 |', '|---|---|---|---|---|---|---|---|---|---|---|'];
    const md = ['# 항구 칸 — 사람 확인 후보표(불확실)', '',
        '> 이 표는 `local_server/scripts/gen_harbor_cells.js` 가 만든다(손으로 고치지 말고 다시 실행). 자동 적용 목록은 `local_server/config/coastal_safety/harbor_cells.json`(강·중·공식).',
        '> 사용자 결정(2026-10-19): 목록 확정 「자동판정후 애매한곳은1번으로」 — 아래 칸은 **적용하지 않았다.** 구글맵으로 보고 항·포구·방파제 안이면 「확인」 칸에 표시해 알려 주면 목록에 넣는다.',
        '> 공식 자료 자동 확인(2026-10-19 「좋아 진행하자」): 불확실 칸 안에 해양수산부 공식 항(대표 좌표 또는 국가어항 구역)이 있으면 「공식」 등급으로 목록에 올렸다. 아래 표에 남은 칸은 공식 근거가 없는 칸이다 — 「공식 근거」 칸에 가장 가까운 공식 항과 거리를 적었다.', '',
        '- 만든 시각: ' + meta.now + ' · 후보 기준: ' + out.criteria.candidate, '- 등급 기준: ' + out.criteria.grade, '- ' + out.criteria.official,
        '- 칸 수: 근거 있는 칸 ' + ev.size + ' · 후보 ' + cand.length + ' · 자동 적용 ' + applied.length + '(강 ' + out.counts.strong + ' · 중 ' + out.counts.medium + ' · 공식 ' + out.counts.official + ') · **불확실 ' + unsure.length + '(이 표)**', '',
        ...HEAD, ...unsure.sort(byCount).map((c, k) => reviewRow(c, k + 1, ctx)), '',
        '## 공식 근거로 올라간 칸(공식 ' + out.counts.official + ' — 이미 적용)', '',
        ...HEAD, ...applied.filter((c) => c.grade === '공식').sort(byCount).map((c, k) => reviewRow(c, k + 1, ctx)), '',
        '## 참고 — 자동 적용(강·중) 가운데 공식 근거가 없는 칸 ' + noOfficial.length + '(적용은 그대로 — 빼려면 알려 주세요)', '',
        ...HEAD, ...noOfficial.sort(byCount).map((c, k) => reviewRow(c, k + 1, ctx)), ''];
    fs.writeFileSync(REVIEW, md.join('\n'));
    console.log(JSON.stringify(out.counts), window);
}
if (require.main === module) main().catch((e) => { console.error('[gen_harbor_cells] 실패:', e.message); process.exit(1); });
module.exports = { buildContext, evidenceFor, grade, landShare, touches, officialIn, PORT_TYPES, BUSY, OFFICIAL };
