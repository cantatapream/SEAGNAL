/**
 * ============================================================================
 * 파일명: local_server/scripts/build_jurisdiction_from_law.js
 * 역할  : 법제처 별표(지방해양경찰관서의 관할구역)의 좌표를 읽어 해양경찰서별
 *         관할 해역 폴리곤을 만든다. 사고의 관할서를 좌표로 판정할 때 쓴다.
 * ============================================================================
 *
 * [실행]
 *   node local_server/scripts/build_jurisdiction_from_law.js            # 만들고 저장
 *   node local_server/scripts/build_jurisdiction_from_law.js --check    # 만들어 검산만
 *
 * [입력] local_server/scripts/data/jurisdiction/byl2_jurisdiction_raw.txt
 *        (법제처 원문 텍스트 — 그 파일 머리말에 출처·받은 날짜가 있다)
 * [출력] local_server/config/coastguard_jurisdiction_law.json
 *        [{ owner, coords:[[lon,lat],...], segments:n, source:'법정' }, ...]
 *
 * ---------------------------------------------------------------------------
 * ★왜 이 스크립트를 새로 만들었나 (2026-09-04, 사용자 지적)
 * ---------------------------------------------------------------------------
 * 지금까지 관할서 판정에 쓰던 폴리곤(config/coastguard_jurisdiction_faces.json)은
 * **법령이 아니라 사고 데이터에서 역추정한 것**이었다. 원래 용도가 "검수 화면에
 * 경계선을 그려 보여주기"였는데 그것을 판정 도구로 재사용한 것이다. 그 결과:
 *   - 부안해양경찰서 면은 사고 11건으로 그려져 격포항 앞 3.7km × 6.3km 뿐이었다.
 *     법정 관할은 92km × 33km 다(약 0.8%만 덮고 있었다).
 *   - 253면 중 97면이 사고 1건으로 만들어졌다.
 * 법제처에 정확한 관할이 있는데 그것을 안 쓰고 있었다.
 *
 * ---------------------------------------------------------------------------
 * ★법령의 표현을 폴리곤으로 바꾸는 방법과 그 한계
 * ---------------------------------------------------------------------------
 * 별표는 관할 해역을 "다음 각 호의 (점을 순차적으로 연결한) 선의 **내측 해역**"
 * 으로 적는다. 즉 주어지는 것은 **열린 선**이고, 실제 구역은 그 선과 **해안선**
 * 사이다. 해안선을 따라 닫으려면 해안 폴리곤을 따라 걷는 계산이 필요한데,
 * 여기서는 **양 끝점을 육지 쪽으로 밀어 낸 뒤 그 두 점을 이어 닫는다.**
 *
 * ★처음에는 끝점끼리 곧바로 잇는 직선 닫기를 썼는데 **검산에서 떨어졌다**
 * (일치율 72.0% — 기존 방식 89.2% 보다 나쁨). 만(灣)이 깊은 서에서 연안이
 * 통째로 잘려 나갔기 때문이다: 부산 60.2% · 평택 67.2% · 창원 53.8% 의 사고가
 * 폴리곤 밖으로 떨어졌다(경기만·부산항·진해만).
 *
 * 그래서 닫는 방법을 바꿨다 — 끝점에서 **가장 가까운 육지 쪽으로** 그 거리보다
 * 더 멀리(INLAND_KM 만큼 더) 밀어 낸 두 점을 이어 닫는다. 그러면 해안 만곡부가
 * 전부 폴리곤 안에 들어온다. 폴리곤이 육지까지 덮게 되지만 사고는 해상에 있고
 * 육지점은 이미 걸러진 뒤라 판정에 해가 없다.
 *
 * 인접한 서끼리 겹치지 않는 이유: 별표는 인접 서의 분계선을 **같은 좌표**로 적는다
 * (예: 부안의 1·2번 점 = 군산 3호의 가·나 점). 그래서 같은 끝점은 같은 규칙으로
 * 같은 자리로 밀리고, 두 폴리곤이 그 선을 맞대며 맞물린다.
 *
 * ★검산(성공 기준): 관할서가 이미 적혀 있는 사고를 이 폴리곤으로 다시 판정해
 *   일치율이 **기존 방식(89.2%)보다 높아야** 채택한다. --check 로 그 값을 낸다.
 *
 * ---------------------------------------------------------------------------
 * 별표에 나오는 표현은 두 가지뿐이다(전수 확인)
 * ---------------------------------------------------------------------------
 *   ○ 다음 각 호의 점을 순차적으로 연결한 선의 내측 해역   … 호가 곧 점(7개 서)
 *   ○ 다음 각 호의 선의 내측 해역                          … 호가 선 또는 연장선
 *       N. 다음 각 목의 점을 순차적으로 연결한 선  → 가·나·다… 가 점
 *       N. 북위 …에서 θ도 방향의 연장선            → 그 점에서 θ 방향 반직선
 *   연장선 방향은 8종(37·90·105·136·180·225·248·270도)이고, 북쪽 0도 시계방향이다.
 *
 * [연계] 쓰는 쪽 local_server/scripts/assign_unknown_jurisdiction.js
 *        / 원문 data/jurisdiction/byl2_jurisdiction_raw.txt
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_PATH = path.join(__dirname, 'data', 'jurisdiction', 'byl2_jurisdiction_raw.txt');
const OUT_PATH = path.join(ROOT, 'local_server', 'config', 'coastguard_jurisdiction_law.json');

/** 연장선을 이만큼 뻗는다(km). 우리 사고 데이터가 닿는 범위(가장 먼 점이 한반도에서
 * 약 200km)를 넉넉히 넘기면 되고, 너무 길면 반대쪽 서의 구역과 겹친다. */
const RAY_KM = 260;

/** 끝점을 육지 안쪽으로 이만큼 더 밀어 넣는다(km). 한반도에서 가장 넓은 곳의
 * 폭이 약 300km 이므로, 만을 품기에 충분하면서 반대편 바다까지 넘어가지 않는 값. */
const INLAND_KM = 60;

/** "북위 37도42분55초 동경 126도06분33초" → [경도, 위도]. 초는 없을 수도 있다. */
function parsePoint(line) {
    const m = line.match(/북위\s*(\d+)도\s*(\d+)분\s*(?:(\d+)초)?\s*동경\s*(\d+)도\s*(\d+)분\s*(?:(\d+)초)?/);
    if (!m) return null;
    const lat = +m[1] + (+m[2]) / 60 + (+(m[3] || 0)) / 3600;
    const lon = +m[4] + (+m[5]) / 60 + (+(m[6] || 0)) / 3600;
    return [+lon.toFixed(6), +lat.toFixed(6)];
}

/** 한 점에서 방위각(북 0도, 시계방향) 방향으로 km 만큼 간 점. 위도에 따라 경도
 * 한 도의 길이가 달라지므로 cos(위도)로 보정한다. */
function project(pt, bearingDeg, km) {
    const rad = bearingDeg * Math.PI / 180;
    const dLat = (km * Math.cos(rad)) / 111.0;
    const dLon = (km * Math.sin(rad)) / (111.0 * Math.cos(pt[1] * Math.PI / 180));
    return [+(pt[0] + dLon).toFixed(6), +(pt[1] + dLat).toFixed(6)];
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

/**
 * 끝점을 육지 쪽으로 밀어 낸 점.
 *
 * ★방향은 **선 자체의 기하**로 정한다 — 선의 무게중심에서 그 끝점으로 향하는 방향이다.
 * 별표의 선은 "해안에서 출발해 먼바다로 나갔다가 다시 해안으로 돌아오는" 모양이라,
 * 무게중심은 바다 쪽에 있고 끝점은 해안 쪽에 있다. 그래서 이 방향이 곧 육지 쪽이다.
 *
 * ★처음에는 육지 마스크에서 가장 가까운 육지 점을 찾아 그쪽으로 밀었는데 **더 나빠졌다**
 * (일치율 54.9%). 경기만 한복판 같은 곳에서는 가장 가까운 육지가 풍도·육도 같은
 * 작은 섬이라, 겨우 몇 km 밀리고 방향도 내륙이 아니었다. 그래서 육지 마스크는 안 쓴다.
 *
 * @param {[number,number]} pt 밀 끝점
 * @param {[number,number]} away 이 점에서 멀어지는 방향으로 민다(선의 무게중심)
 * @returns {[number,number]}
 */
function pushInland(pt, away) {
    const cosLat = Math.cos(pt[1] * Math.PI / 180);
    const dxk = (pt[0] - away[0]) * cosLat * 111.0, dyk = (pt[1] - away[1]) * 111.0;
    const len = Math.hypot(dxk, dyk);
    if (!(len > 1e-9)) return pt;
    return [
        +(pt[0] + (dxk / len) * INLAND_KM / (111.0 * cosLat)).toFixed(6),
        +(pt[1] + (dyk / len) * INLAND_KM / 111.0).toFixed(6)
    ];
}

/**
 * 원문을 읽어 해양경찰서별 "호 목록"을 뽑는다.
 * @returns {Array<{owner:string, segs:Array}>} segs 항목은
 *   {type:'line', pts:[[lon,lat],...]} 또는 {type:'ray', from:[lon,lat], bearing:number}
 */
function parseRaw() {
    const lines = fs.readFileSync(RAW_PATH, 'utf8').split('\n')
        .filter((l) => !l.startsWith('#'))
        .map((l) => l.replace(/\s+$/, ''));

    const offices = [];
    let cur = null;          // 지금 읽고 있는 해양경찰서
    let inSea = false;       // 해역 절 안인가
    let simple = false;      // "각 호의 점을 순차적으로" 형(호가 곧 점)
    let pendingLine = null;  // "다음 각 목의 점을…" 뒤에 오는 점들을 담을 곳

    function flushPending() {
        if (pendingLine && pendingLine.pts.length) cur.segs.push(pendingLine);
        pendingLine = null;
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const t = raw.trim();
        if (!t) continue;

        // 해양경찰서 이름 — 짧은 이름 줄 다음에 "해양경찰서" 줄이 온다.
        if (t === '해양경찰서') {
            const name = (lines[i - 1] || '').trim();
            if (name && !/지방해양경찰청|관할구역|명칭/.test(name)) {
                flushPending();
                cur = { owner: name + '해양경찰서', segs: [] };
                offices.push(cur);
                inSea = false; simple = false;
            }
            continue;
        }
        if (!cur) continue;

        if (/^○/.test(t)) {
            flushPending();
            if (/내측\s*해역/.test(t)) {
                inSea = true;
                simple = /점을\s*순차적으로\s*연결한\s*선의\s*내측/.test(t);
                if (simple) pendingLine = { type: 'line', pts: [] };
            } else {
                inSea = false;   // 육상 시군구 목록 — 여기서는 안 쓴다
            }
            continue;
        }
        if (!inSea) continue;

        // "N. 북위 …에서 θ도 방향의 연장선"
        const ray = t.match(/^(?:\d+|[가-힣])\.\s*(북위.*?)에서\s*(\d+)도\s*방향의\s*연장선/);
        if (ray) {
            flushPending();
            const from = parsePoint(ray[1]);
            if (from) cur.segs.push({ type: 'ray', from: from, bearing: +ray[2] });
            continue;
        }
        // "N. 다음 각 목의 …" — 뒤따르는 가·나·다 점들을 한 선으로 모은다
        if (/^\d+\.\s*다음\s*각\s*목/.test(t)) {
            flushPending();
            pendingLine = { type: 'line', pts: [] };
            continue;
        }
        // 점 한 줄
        const p = parsePoint(t);
        if (p) {
            if (!pendingLine) pendingLine = { type: 'line', pts: [] };
            pendingLine.pts.push(p);
        }
    }
    flushPending();
    return offices.filter((o) => o.segs.length);
}

/**
 * 호 목록을 닫힌 고리(폴리곤)로 잇는다.
 *
 * ①연장선은 그 시작점과 이어져 있으므로 앞 선과 한 덩어리(chain)로 묶는다.
 * ②덩어리끼리는 끝점이 가장 가까운 것을 이어 붙이되, 필요하면 뒤집는다
 *   (별표는 북쪽 경계와 남쪽 경계를 각각 "해안 → 먼바다" 순서로 적으므로,
 *    두 번째 덩어리는 뒤집어야 고리가 꼬이지 않는다).
 * ③양 끝점을 육지 쪽으로 밀어 낸 두 점을 거쳐 닫는다(위 주석의 닫기 방법).
 *
 * @param {Array} segs
 * @returns {Array<[number,number]>} 폴리곤 좌표
 */
function ringFromSegments(segs) {
    // ① 덩어리 묶기
    const chains = [];
    segs.forEach((s) => {
        if (s.type === 'ray') {
            const far = project(s.from, s.bearing, RAY_KM);
            const last = chains[chains.length - 1];
            if (last && dist(last[last.length - 1], s.from) < 1e-6) { last.push(far); return; }
            if (last && dist(last[0], s.from) < 1e-6) { last.unshift(far); return; }
            chains.push([s.from, far]);
            return;
        }
        chains.push(s.pts.slice());
    });

    // ② 잇기
    let ring = chains.shift() || [];
    while (chains.length) {
        const tail = ring[ring.length - 1];
        let bi = 0, bd = Infinity, rev = false;
        chains.forEach((c, i) => {
            const d0 = dist(tail, c[0]), d1 = dist(tail, c[c.length - 1]);
            if (d0 < bd) { bd = d0; bi = i; rev = false; }
            if (d1 < bd) { bd = d1; bi = i; rev = true; }
        });
        const c = chains.splice(bi, 1)[0];
        const pts = rev ? c.slice().reverse() : c;
        pts.forEach((p) => { if (dist(ring[ring.length - 1], p) > 1e-9) ring.push(p); });
    }
    // ③ 육지 쪽으로 밀어 닫기 — 만곡부를 품기 위함(위 머리말 주석 참고).
    if (ring.length >= 3) {
        let cx = 0, cy = 0;
        ring.forEach((p) => { cx += p[0]; cy += p[1]; });
        const mid = [cx / ring.length, cy / ring.length];
        const endIn = pushInland(ring[ring.length - 1], mid);
        const startIn = pushInland(ring[0], mid);
        if (dist(endIn, ring[ring.length - 1]) > 1e-9) ring.push(endIn);
        if (dist(startIn, endIn) > 1e-9) ring.push(startIn);
    }
    return ring;
}

/** 신발끈 공식 — 폴리곤 면적(제곱도). 너무 작은 고리를 걸러 내는 데만 쓴다. */
function areaOf(ring) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return Math.abs(a / 2);
}

function main() {
    const offices = parseRaw();
    const out = offices.map((o) => ({
        owner: o.owner,
        segments: o.segs.length,
        source: '법정',
        coords: ringFromSegments(o.segs)
    }));

    console.log('해양경찰서 ' + out.length + '개 · 좌표 ' +
        out.reduce((n, o) => n + o.coords.length, 0) + '점');
    out.forEach((o) => {
        const lons = o.coords.map((p) => p[0]), lats = o.coords.map((p) => p[1]);
        console.log('  ' + o.owner.replace('해양경찰서', '').padEnd(4) +
            ' 호 ' + String(o.segments).padStart(2) +
            ' · 점 ' + String(o.coords.length).padStart(3) +
            ' · 경도 ' + Math.min.apply(null, lons).toFixed(2) + '~' + Math.max.apply(null, lons).toFixed(2) +
            ' · 위도 ' + Math.min.apply(null, lats).toFixed(2) + '~' + Math.max.apply(null, lats).toFixed(2) +
            ' · 면적 ' + areaOf(o.coords).toFixed(3));
    });

    if (process.argv.indexOf('--check') >= 0) { console.log('\n(--check 라 파일은 안 만들었다)'); return; }
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
    console.log('\n저장: local_server/config/coastguard_jurisdiction_law.json');
}

main();
