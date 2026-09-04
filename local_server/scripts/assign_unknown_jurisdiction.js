/**
 * ============================================================================
 * 파일명: local_server/scripts/assign_unknown_jurisdiction.js
 * 역할: 관할해경서가 비어 있어 "관할 미상"으로 표시되던 사고(orgCd=0)의 좌표를
 *       해경서 관할 폴리곤에 대입해, 그 좌표가 들어가는 해경서로 칸을 채운다.
 *       (빌드타임 1회성 스크립트, 배포에는 안 실림 — build_accident_warn_flags.js
 *        와 같은 관례로 완성된 JSON 을 읽어 칸만 채우고 되쓴다.)
 * ============================================================================
 *
 * [실행 방법]
 *   cd /home/user/SEAGNAL
 *   node local_server/scripts/assign_unknown_jurisdiction.js          # 실제 반영
 *   node local_server/scripts/assign_unknown_jurisdiction.js --dry    # 세어만 본다
 *
 * [입력] client/accident_ships_hk.json (orgCd = 9번째 칸, 인덱스 8)
 *        client/accident_persons.json  (orgCd = 6번째 칸, 인덱스 5)
 *        client/coastguard_jurisdiction_boundaries.json — [{owner, coords}] 253면
 * [출력] 위 두 사고 JSON 을 그 자리에서 갱신(다른 칸은 건드리지 않는다)
 *
 * [배경 — 사용자 확정 2026-09-04]
 *   원문: "관할미상에 대해서 263건은 제외하도록하고 나머지는 폴리곤안에 들어가도록
 *   하자. 그리고 위치 기준 추정이라는 것은 밝히지 말자."
 *   - 관할서가 이미 적힌 행은 건드리지 않는다(orgCd 가 0 인 행만 대상).
 *   - 폴리곤 밖 행은 그대로 0(관할 미상)으로 두면 관할서별 통계에서 자동으로
 *     빠진다(accident_info.js ASH_EXCLUDED_LABEL). 따로 지우지 않는다.
 *   - 화면에 "위치 기준 추정"이라고 밝히지 않는다.
 *
 * [왜 추정이라고 밝히지 않아도 되는가 — 실측 근거]
 *   관할서가 이미 적힌 69,640건을 같은 폴리곤으로 재판정해 보면 일치 87.3%다.
 *   그렇다면 "관할 미상 행은 애초에 판정이 어려운 자리(경계·먼바다)라 더 많이
 *   틀리지 않겠나" 싶어 폴리곤 경계선까지의 거리를 재어 세 무리를 비교했더니,
 *   관할 미상 무리(중앙값 3.3km)의 분포가 "일치" 무리(3.3km)와 사실상 같았다.
 *   경계에 몰려 있는 것은 "불일치" 무리(1.9km)뿐이었다. 즉 관할 미상 행은
 *   판정이 어려운 자리에 있는 게 아니라 그냥 기록이 빠진 것이라, 87.3% 를 그대로
 *   적용해도 된다. 예상 오차는 전체의 0.43% 수준으로 관할서 순위를 못 뒤집는다.
 *
 * [한계 — 그대로 둔 것]
 *   사천해양경찰서 폴리곤이 원본에 없다(19개서만 있음). 사천으로 이미 기록된 행은
 *   그대로 남고, 이 스크립트가 사천 관할 자리의 미상 행을 이웃 서로 보낼 수는 있다.
 *   영향은 최대 277건(전체의 0.37%)으로 확인돼 메우지 않기로 했다(설계서 작업 11).
 *
 * [연계] 판정 규칙 client/js/marine-life/safety/accident_info.js pointInPolygonLL
 *        (같은 ray casting 을 쓴다) / 설계서 accident_stats_sheet.design.md 작업 11
 *        / 코드표 client/js/shared/utils/accident_codes.js ACCIDENT_ORG_LABELS
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const DRY = process.argv.indexOf('--dry') >= 0;

// ★개서일 — 그 날 이전 사고를 이 서로 배정하면 "그때 없던 기관"에 넣는 셈이 된다[S19 정정].
// 이 표는 이 저장소가 이미 갖고 있던 것을 그대로 가져왔다
// (local_server/scripts/audit_hk_jurisdiction_mismatch.js 의 ESTABLISHED_YMD — 2026-08-25
//  웹서핑 조사 결과). 그 감사 스크립트는 같은 폴리곤을 쓰면서 이 게이트를 이미 걸고
// 있었는데, 처음 이 스크립트를 쓸 때 그것을 가져오지 않아 실제로 사고가 났다:
// 울진해양경찰서(2017-11-28 개서)에 2016년 사고 117건이 들어갔다(적대검증에서 발견).
//
// 개서일 이전 사고가 그 서의 폴리곤 안에 들면 **그 면을 건너뛰고 다른 면을 계속 찾는다.**
// 이웃 서의 면이 그 점을 덮고 있으면 그쪽으로 가고(그때 실제 관할이던 서일 가능성이
// 높다 — 신설서는 이웃 서 관할을 떼어 만든 것이다), 어느 면도 안 덮으면 관할 미상으로
// 남긴다. "전신 서가 어디였는지"를 단정하지는 않는다.
const ESTABLISHED_YMD = {
    평택해양경찰서: '20110401',   // 인천·태안 관할 일부 이관
    창원해양경찰서: '20121227',   // 통영 관할이던 창원·부산강서 일부 이관
    보령해양경찰서: '20140401',   // 태안 관할이던 보령·홍성·서천 이관
    부안해양경찰서: '20160421',   // 군산 관할이던 부안 이관
    울진해양경찰서: '20171128',   // 포항 관할이던 울진 이관
    사천해양경찰서: '20220331',   // 통영 관할이던 사천 이관(폴리곤 자체가 없어 지금은 안 걸린다)
    강릉해양경찰서: '20250331'    // 동해 관할이던 강릉 이관
};

// 해경서 이름 → 사고데이터에 쓰는 관할서 코드. 코드표에는 1532xxx(현행)와
// 1750xxx(옛 통합기관 시절) 두 계열이 같은 이름으로 들어 있는데, 화면 집계는
// 코드가 아니라 이름(라벨)으로 묶으므로 어느 쪽을 써도 결과가 같다. 현행 계열로 쓴다.
const CODE_OF_OWNER = {
    속초해양경찰서: 1532418, 동해해양경찰서: 1532440, 포항해양경찰서: 1532466,
    울산해양경찰서: 1532304, 부산해양경찰서: 1532329, 창원해양경찰서: 1532357,
    통영해양경찰서: 1532376, 여수해양경찰서: 1532170, 완도해양경찰서: 1532199,
    목포해양경찰서: 1532222, 군산해양경찰서: 1532255, 보령해양경찰서: 1532056,
    태안해양경찰서: 1532074, 평택해양경찰서: 1532098, 인천해양경찰서: 1532121,
    제주해양경찰서: 1532508, 서귀포해양경찰서: 1532530, 부안해양경찰서: 1532281,
    울진해양경찰서: 1532609, 사천해양경찰서: 1532759, 강릉해양경찰서: 1532865
};

/**
 * 폴리곤 두 벌을 읽는다[S20] — 먼저 볼 것과 그래도 못 찾았을 때 볼 것.
 *
 * ①`client/coastguard_jurisdiction_boundaries.json` — 사고 데이터에서 역추정한 면들.
 *   해안·항만을 촘촘히 덮어 실제 사고 위치에 잘 맞는다(기록과 96.9% 일치).
 * ②`config/coastguard_jurisdiction_law.json` — 법제처 별표의 법정 관할(신설).
 *   ①이 안 덮는 먼바다·빈 구역을 메운다. 특히 부안처럼 ①이 사고 11건으로만
 *   그려져 관할의 0.8% 밖에 못 덮던 곳을 법정 범위로 채운다.
 *
 * ★왜 ①을 먼저 보나(실측 2026-09-04): 관할서가 이미 적힌 69,640건으로 재판정해 비교했다.
 *     ① 단독          89.9%   (판정된 것 중 96.9%)
 *     ② 단독          83.0%   (판정된 것 중 92.5%)
 *     ①→② 합쳐 쓰기  **94.0%** (판정된 것 중 96.1%) ← 채택
 *   ②가 단독으로 더 나쁜 것은 법령이 관할을 "선의 **내측 해역**"이라는 **열린 선**으로
 *   적기 때문이다 — 해안선을 따라 닫아야 정확한데 그럴 수 없어 근사했고, 그래서 만·항만
 *   가장자리를 놓친다. 반대로 ①은 그 자리를 잘 덮는다(단, 이 사고들로 만든 것이라
 *   유리하게 나오는 면이 있다). 그래서 ①을 먼저 보고 못 찾은 것만 ②로 메운다.
 *
 * @returns {{near:Array, law:Array}}
 */
function loadFaceSets() {
    return { near: loadFaces(), law: loadLawFaces() };
}

function withBbox(faces) {
    faces.forEach(function (f) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        f.coords.forEach(function (c) {
            if (c[0] < x0) x0 = c[0];
            if (c[0] > x1) x1 = c[0];
            if (c[1] < y0) y0 = c[1];
            if (c[1] > y1) y1 = c[1];
        });
        f.bb = [x0, y0, x1, y1];
    });
    return faces;
}

/** 역추정 면(기존) — 해안·항만을 촘촘히 덮는다. */
function loadFaces() {
    const raw = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'coastguard_jurisdiction_boundaries.json'), 'utf8'));
    return withBbox(Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return raw[k]; }));
}

/** 법정 관할 면 — 없으면 빈 배열(먼저 build_jurisdiction_from_law.js 를 돌려야 한다). */
function loadLawFaces() {
    const p = path.join(__dirname, '..', 'config', 'coastguard_jurisdiction_law.json');
    if (!fs.existsSync(p)) {
        console.log('⚠ 법정 관할 파일이 없다 — node local_server/scripts/build_jurisdiction_from_law.js 를 먼저 돌린다.');
        return [];
    }
    return withBbox(JSON.parse(fs.readFileSync(p, 'utf8')));
}

/** 점이 폴리곤 안인가 — ray casting. accident_info.js pointInPolygonLL 과 같은 식. */
function pointInPolygon(lon, lat, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

/**
 * 좌표가 들어가는 해경서 이름. 어느 폴리곤에도 안 들어가면 null.
 *
 * ⚠null 은 "먼바다"가 아니다[S19 정정]. 남은 253건의 폴리곤 경계까지 거리를 재 보니
 * 중앙값이 선박 0.30km · 인명 0.07km 이고 209건이 1km 이내였다 — 항내·연안인데
 * 폴리곤이 항만·내만을 안 덮어서 빠진 것이다(장소명도 "격포항내"·"부산 감천항 5부두"
 * 같은 항내가 많다). 그러니 "판정 못 함"이라고만 말해야 한다.
 *
 * ⚠면이 겹칠 때는 **배열에서 먼저 나오는 면이 이긴다.** 관할 미상 중 162건이 서로 다른
 * 서의 면 2개 이상에 동시에 든다. 면적 최소 우선으로 바꿔 시험해 봤으나 일치율이
 * 나아지지 않아(94.1%→93.7%) 그대로 두되, 순서가 답을 정한다는 사실을 여기 적어 둔다.
 *
 * @param {Array} faces bb 가 붙은 폴리곤 목록
 * @param {number} lon 경도
 * @param {number} lat 위도
 * @param {string} ymd 사고 발생일(YYYYMMDD) — 개서 이전 서는 건너뛴다
 * @returns {string|null} 해경서 이름
 */
function ownerAt(faces, lon, lat, ymd) {
    if (!faces) return null;
    for (let i = 0; i < faces.length; i++) {
        const b = faces[i].bb;
        if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
        const open = ESTABLISHED_YMD[faces[i].owner];
        if (open && String(ymd) < open) continue;   // 그때 없던 서 — 다음 면을 본다
        if (pointInPolygon(lon, lat, faces[i].coords)) return faces[i].owner;
    }
    return null;
}

function run() {
    const sets = loadFaceSets();
    console.log('관할 폴리곤 — 역추정 ' + sets.near.length + '면 · 법정 ' + sets.law.length + '면');
    [['accident_ships_hk.json', 8, '선박'], ['accident_persons.json', 5, '인명']].forEach(function (spec) {
        const file = spec[0], orgIdx = spec[1], name = spec[2];
        const p = path.join(CLIENT_DIR, file);
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        let unknown = 0, filled = 0, outside = 0, byLaw = 0;
        const byOwner = {};
        data.rows.forEach(function (r) {
            if (+r[orgIdx] !== 0) return;          // 이미 적힌 행은 건드리지 않는다
            unknown++;
            // 역추정 면을 먼저 보고, 못 찾으면 법정 면으로 메운다[S20 — 위 loadFaceSets 주석].
            let owner = ownerAt(sets.near, r[1], r[0], r[2]);
            let fromLaw = false;
            if (!owner) { owner = ownerAt(sets.law, r[1], r[0], r[2]); fromLaw = !!owner; }
            const code = owner && CODE_OF_OWNER[owner];
            if (!code) { outside++; return; }       // 어느 쪽에서도 못 찾음 — 0 그대로 둔다
            r[orgIdx] = code;
            filled++;
            if (fromLaw) byLaw++;
            byOwner[owner] = (byOwner[owner] || 0) + 1;
        });
        console.log('\n[' + name + '] ' + file);
        console.log('  관할 미상 ' + unknown + '건 → 채움 ' + filled + '건(그중 법정 관할이 메운 것 ' + byLaw +
            '건) / 판정 못 함 ' + outside + '건(관할 미상으로 남김)');
        console.log('  ' + Object.keys(byOwner).sort(function (a, b) { return byOwner[b] - byOwner[a]; })
            .map(function (k) { return k.replace('해양경찰서', '') + ' ' + byOwner[k]; }).join(' · '));
        if (DRY) { console.log('  (--dry 라 파일은 안 바꿨다)'); return; }
        fs.writeFileSync(p, JSON.stringify(data));
        console.log('  저장함: client/' + file);
    });
    if (!DRY) console.log('\n되돌리려면: git checkout -- client/accident_ships_hk.json client/accident_persons.json');
}

run();
