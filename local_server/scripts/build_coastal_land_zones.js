/**
 * ============================================================================
 * 파일명: local_server/scripts/build_coastal_land_zones.js
 * 역할  : 육상 특보구역(강풍) 중 "바다에 접한 것"만 골라 경계를 단순화해 클라이언트가
 *         쓸 수 있는 작은 파일로 만든다(빌드타임 1회성, 배포 코드에는 안 실림).
 *
 * [왜 필요한가]
 *   강풍특보는 육상 구역 단위로 낸다. 격자 칸이 해안에 걸쳐 있으면 그 칸의 "육상 특보
 *   발효 일수"도 함께 보여주기로 했는데(설계서 작업 6 G-4, 사용자 확정 2026-09-04
 *   "해상 0000일 / 육상 0000일 두 줄"), 그러려면 어느 육상 구역에 걸치는지 앱이 알아야
 *   한다. 원본(wrnArea_land.geojson)은 4.2MB 라 그대로 실을 수 없다.
 *
 * [어떻게 줄이나]
 *   ① 내륙 구역은 뺀다 — 해상 특보구역에서 3km 안쪽(NEAR_LAND_KM 과 같은 값)에 닿는
 *      것만 남긴다. 실측으로 시군 단위 280개 중 108개만 남는다.
 *   ② 경계를 단순화한다 — 격자 칸은 보통 수 km 이상이라 수백 m 오차는 판정에 영향이
 *      없다. 실측: 222m 정밀도에서 0.52MB, 555m 에서 0.30MB.
 *
 * [실행]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf
 *   node local_server/scripts/build_coastal_land_zones.js
 *
 * [출력] client/assets/warn_zones_land_coastal.geojson
 *   properties.name 은 build_warn_intervals.js 가 쓰는 구역 이름과 같은 규칙으로
 *   정규화해 둔다(공백·가운뎃점·마침표 제거) — 두 파일을 이름으로 맞춰야 하기 때문.
 *
 * [연계] 이름 규칙은 build_accident_warn_flags.js 의 loadZoneFeatures() 와 같다
 *   (regKo || regko, 신 제주 10구역은 빼고 jeju_old_zones.geojson 의 옛 이름을 쓴다).
 *   읽는 쪽: client/js/marine-life/safety/accident_info.js (S11 에서 연결)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const DATA_DIR = path.join(__dirname, 'data', 'warn_zone_flags');
const LAND_PATH = path.join(DATA_DIR, 'wrnArea_land.geojson');
const JEJU_OLD_PATH = path.join(DATA_DIR, 'jeju_old_zones.geojson');
const SEA_PATH = path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson');
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones_land_coastal.geojson');

const NEAR_LAND_KM = 3;          // build_accident_warn_flags.js 와 같은 값이어야 한다
const SIMPLIFY_TOLERANCE = 0.002; // 도 단위, 약 222m
const NEW_JEJU_NAMES = ['제주시서부', '제주시동부', '제주시북부', '제주시중산간',
    '서귀포시서부', '서귀포시동부', '서귀포시남부', '서귀포시중산간'];

function normZone(name) { return String(name).replace(/[\s·.]/g, ''); }

function bboxOverlap(a, b) {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** 세부구역의 무게중심이 어느 상위(level 1) 구역 안에 드는지 — 그 이름을 돌려준다.
 * 백령도·대청도, 연평도·우도처럼 통보문이 세부구역 이름을 안 쓰고 상위("서해5도")로만
 * 발표하는 경우에 대신 볼 이름이 된다(사용자 지적 2026-09-04). 못 찾으면 null. */
function parentsOf(feature, l1List) {
    // 무게중심이 상위 폴리곤 밖에 떨어지는 섬 구역이 있어(백령도·대청도) 교차로 본다.
    // 상위가 여럿 걸릴 수 있어 **전부** 담는다 — 어느 이름이 통보문에 있는지는
    // 화면 쪽이 정한다(여기서는 통보문 자료를 안 읽는다).
    const out = [];
    let fb;
    try { fb = turf.bbox(feature); } catch (e) { return out; }
    l1List.forEach((p) => {
        try {
            if (!bboxOverlap(fb, turf.bbox(p))) return;
            if (!turf.booleanIntersects(feature, p)) return;
            const nm = p.properties.regko || p.properties.regKo;
            if (nm && out.indexOf(nm) < 0) out.push(nm);
        } catch (e) { /* 이상 지오메트리 */ }
    });
    return out;
}

/**
 * 세부구역이 쪼개져 나오기 전의 "시·군 전체" 구역 이름. 없으면 null.
 *
 * 원본의 regid 는 자리값을 갖는다 — 완도군 전체가 `L1053300`, 거기서 갈라져 나온
 * `완도(여서도 제외)` 가 `L1053310`, `완도여서도` 가 `L1053320` 이다. 끝 두 자리가
 * `00` 이 아니면 갈라져 나온 구역이고, 그 자리를 `00` 으로 되돌리면 부모가 나온다.
 *
 * [왜 필요한가 — 2026-09-04, 사용자가 기상청 안내서를 주고 확인함]
 *   `완도여서도`·`영광낙월면`·`부안위도면`·`군산옥도면(어청도제외)`·`군산어청도` 다섯은
 *   기상청 「특보구역 상세 안내」('26.6.1 기준)에 **정확히 그 이름의 특보구역으로** 실려 있다.
 *   그런데 우리가 가진 통보문 자료(2016-08-26~2025-12-31)에는 그 이름도, 짝인
 *   `(…제외)` 이름도 **한 번도 안 나온다**(원본 CSV 를 직접 검색해 0건 확인).
 *   같은 성격의 섬 구역인 `거문도.초도` 826건 · `흑산도.홍도` · `추자도` 183건과 대조적이다.
 *   즉 **자료 기간 동안 이 다섯은 아직 갈라지기 전이었고, 시·군 전체 이름으로 발표됐다.**
 *   그래서 이 다섯의 과거 발효 기록은 부모 구역(`완도`·`영광`·`부안`·`군산`)의 기록이다.
 *   ⚠나중에 통보문이 실제로 갈라진 이름을 쓰기 시작하면 이 대체는 **과다 계산**이 된다
 *     (그때는 `완도` 가 여서도를 뺀 뜻이 되기 때문). 통보문 자료를 갱신할 때 다시 볼 것.
 *
 * @param {object} feature 세부구역 피처
 * @param {object} byId regid -> 피처
 * @returns {string|null} 부모 구역의 통보문 표기 이름
 */
function baseZoneName(feature, byId) {
    const id = String(feature.properties.regid || feature.properties.regId || '');
    if (!/\d{2}$/.test(id) || id.slice(-2) === '00') return null;
    const parent = byId[id.slice(0, -2) + '00'];
    if (!parent) return null;
    return parent.properties.regko || parent.properties.regKo || null;
}

function main() {
    console.log('[1/4] 원본 읽기...');
    const land = JSON.parse(fs.readFileSync(LAND_PATH, 'utf8'));
    const jejuOld = JSON.parse(fs.readFileSync(JEJU_OLD_PATH, 'utf8'));
    const sea = JSON.parse(fs.readFileSync(SEA_PATH, 'utf8'));

    // 해상구역을 각각 3km 밖으로 부풀려 둔다 — 이 중 하나라도 닿는 육상구역이 "해안"이다.
    // 하나로 합치지(union) 않는 이유: 44개를 합치면 아주 무겁고, 어차피 "하나라도 닿는가"만
    // 보면 되므로 합칠 이유가 없다. bbox 를 미리 재 두고 먼저 걸러 빠르게 판정한다.
    console.log('[2/4] 해상구역을 3km 밖으로 부풀리기...');
    const band = sea.features.map((f) => {
        const b = turf.buffer(f, NEAR_LAND_KM, { units: 'kilometers' });
        return { geom: b, bbox: turf.bbox(b) };
    });
    // 상위(광역) 구역 — 세부구역이 통보문에 없을 때 대신 볼 이름을 찾는 데 쓴다.
    const l1 = land.features.filter((f) => f.properties.level === 1);
    // regid -> 피처. 갈라져 나온 구역의 "시·군 전체" 부모를 찾는 데 쓴다(baseZoneName 참고).
    const byId = {};
    land.features.forEach((f) => {
        const id = f.properties && (f.properties.regid || f.properties.regId);
        if (id) byId[String(id)] = f;
    });

    console.log('[3/4] 해안에 닿는 육상구역만 고르고 경계 단순화...');
    const cands = [];
    land.features.forEach((f) => {
        if (f.properties.level !== 2 || f.properties.ground !== 'local') return;
        // ★짧은 표기(regko)를 먼저 쓴다[2026-09-04 정정].
        // 원본에는 이름 칸이 둘이다 — regKo 는 행정구역 표기(`부안군(위도면 제외)`),
        // regko 는 통보문 표기(`부안(위도면 제외)`). 특보 통보문은 2017-01-20 무렵부터
        // 짧은 표기로 바뀌었는데 우리가 긴 쪽을 골라, 발효 구간과 이름이 안 맞았다.
        // 실측: level2 육상 280개 중 통보문과 맞는 것이 긴 이름 75개 · 짧은 이름 164개.
        // 상위 구역명(parents)도 함께 남긴다 — 백령도·대청도처럼 세부구역이 통보문에
        // 없고 상위("서해5도")로만 발표되는 경우에 쓴다(사용자 지적 2026-09-04).
        const name = f.properties.regko || f.properties.regKo;
        if (!name || NEW_JEJU_NAMES.includes(name)) return;
        cands.push({ name: name, geom: f, base: baseZoneName(f, byId) });
    });
    jejuOld.features.forEach((f) => cands.push({ name: f.properties.name, geom: f }));

    const out = [];
    cands.forEach((c) => {
        let touches = false;
        let cb;
        try { cb = turf.bbox(c.geom); } catch (e) { return; }
        for (let i = 0; i < band.length && !touches; i++) {
            if (!bboxOverlap(cb, band[i].bbox)) continue;
            try { touches = turf.booleanIntersects(c.geom, band[i].geom); } catch (e) { /* 이상 지오메트리 */ }
        }
        if (!touches) return;
        let simplified;
        try {
            simplified = turf.simplify(c.geom, { tolerance: SIMPLIFY_TOLERANCE, highQuality: false, mutate: false });
        } catch (e) { simplified = c.geom; }
        const props = { name: normZone(c.name) };
        // 대신 볼 이름들 — **가까운 것부터**. 갈라지기 전 시·군 전체 이름이 먼저이고,
        // 광역(전라남도 등)·앞바다 구역은 그 뒤다. 화면은 앞에서부터 통보문에 있는지 본다.
        const parents = [];
        if (c.base) parents.push(normZone(c.base));
        parentsOf(c.geom, l1).map(normZone).forEach((n) => {
            if (parents.indexOf(n) < 0) parents.push(n);
        });
        if (parents.length) props.parents = parents;
        out.push({ type: 'Feature', properties: props, geometry: simplified.geometry });
    });

    console.log('[4/4] 저장...');
    fs.writeFileSync(OUT_PATH, JSON.stringify({ type: 'FeatureCollection', features: out }));
    const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`  후보 ${cands.length}개 -> 해안 ${out.length}개 (${kb}KB)`);
    console.log(`  저장: ${OUT_PATH}`);
}

main();
