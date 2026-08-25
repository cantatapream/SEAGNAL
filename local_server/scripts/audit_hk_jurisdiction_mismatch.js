/**
 * ============================================================================
 * 파일명: local_server/scripts/audit_hk_jurisdiction_mismatch.js
 * 역할  : hk(해경) 사고 데이터 중 "기록된 관할해경서(orgCd)"가 그 사고의 실제
 *         좌표가 속한 관할해역(법령 기반 폴리곤)과 다른 행을 찾아 집계한다.
 *         읽기 전용 — 아무 파일도 고치지 않고 콘솔 요약 + 후보 목록 JSON만 남긴다
 *         (사용자 확정 2026-08-25: "먼저 집계부터 해주고" — 삭제는 다음 단계).
 * ----------------------------------------------------------------------------
 * [배경] 사용자 지적: "위치가 그 해양경찰서 관할이 아닌데 그 해양경찰서 이름으로
 *   데이터가 들어가 있다면 그 부분은 잘못된 데이터이기 때문에 삭제해야 되거든."
 *   단, "강릉해양경찰서라든지 사천해양경찰서가 없던 시절... 각 해양경찰서 개서
 *   이력을 먼저 웹서핑으로 확인해서 그 기준을 세워 놓고" — 최근 신설된 서의
 *   관할 폴리곤(coastguard_jurisdiction_faces.json, 법령 2025-02-25 개정판
 *   기준=현재 시점 경계)을 개서 이전 사고에 그대로 적용하면 "그때는 그 서가
 *   없어서 원래 서 이름으로 기록된" 정상 데이터를 오류로 오판하게 된다.
 * [관할서 개서 이력 — 웹서핑 조사 결과(2026-08-25), hk 데이터 범위 2008~ 안에서
 *   신설된 7개서만 해당. 나머지 14개서(속초·동해·포항·울산·부산·통영·여수·완도·
 *   목포·군산·인천·제주·서귀포·태안)는 2008년 이전부터 있던 것으로 확인돼 날짜
 *   보정이 필요 없다]:
 *     평택해양경찰서 2011-04-01 개서 (인천·태안 관할 일부를 이관받음)
 *     창원해양경찰서 2012-12-27 개서 (통영 관할이던 창원·부산강서 일부 이관)
 *     보령해양경찰서 2014-04-01 개서 (태안 관할이던 보령·홍성·서천 이관)
 *     부안해양경찰서 2016-04-21 개서 (군산 관할이던 부안 이관, 2017-07-26 정식
 *       명칭 "해양경찰서"로 개편되나 실제 업무개시는 2016-04-21)
 *     울진해양경찰서 2017-11-28 개서 (포항 관할이던 울진 이관)
 *     사천해양경찰서 2022-03-31 개서 (통영 관할이던 사천 이관)
 *     강릉해양경찰서 2025-03-31 개서 (동해 관할이던 강릉 이관, 이미
 *       build_tribunal_merge.js classifyOrg() 에 날짜 게이트 구현돼 있음)
 *   출처: 각 해경서·언론사 보도(부산일보·오마이뉴스·경남신문 등, 웹검색 종합
 *   — namu.wiki/위키백과/kcg.go.kr 는 이 세션 네트워크 정책상 직접 열람 불가).
 * [정확한 이전 관할서(전신)까지는 특정하지 않는 이유] 평택처럼 두 서(인천+태안)
 *   에서 나눠 이관받은 경우 등 경계선을 정확히 모른다 — 잘못 추정해 특정 서로
 *   단정하면 오히려 새로운 오탐이 생긴다. 그래서 "신설일 이전 + 그 신설서의
 *   현재 폴리곤 안"인 행은 어떤 관할서로 기록돼 있든 검사 대상에서 아예 뺀다
 *   (플래그하지 않음 — 안전 우선, 사용자 지시: "삭제하면 안 된다는 거야").
 * [사천해양경찰서 — 폴리곤 자체가 없음] coastguard_jurisdiction_faces.json 263개
 *   신뢰 면에 사천 소유 면이 하나도 없다(2025-02-25 규칙 재구성 당시 사천 구역이
 *   낮은 순도로 걸러졌거나 원문에서 인접 서와 구분이 애매했던 것으로 추정 —
 *   원인 재조사는 이번 범위 밖). 이웃 통영 폴리곤이 사천 실제 영역까지 덮고
 *   있을 수 있어, orgCd=사천으로 기록된 행을 통영 폴리곤 기준으로 검사하면
 *   전부 오탐(사천은 정상인데 "통영이어야 하는데 사천이라 틀렸다"는 거짓 판정)
 *   이 난다. 그래서 orgCd=사천인 행은 이 감사에서 통째로 제외한다(검사 안 함,
 *   신뢰 못 해서가 아니라 비교 기준 자체가 없어서).
 * [판정 방식] pointInPolygon 이 "신뢰 면"(순도≥60%, build_tribunal_merge.js 와
 *   동일 데이터)에 직접 맞은 경우만 판정한다 — kNN·최근접 보정으로 채운 저신뢰
 *   구간은 그 자체가 ~92% 정확도라 감사 기준으로 쓰면 분류기 오차를 데이터
 *   오류로 오판할 위험이 있어 제외(신뢰 면 밖은 "판정 불가"로 집계만).
 * [실행] node local_server/scripts/audit_hk_jurisdiction_mismatch.js
 * [출력] 콘솔 요약 + local_server/scripts/_accident_raw/hk_jurisdiction_mismatch_candidates.json
 *   (읽기 전용 산출물, git 추적 안 함 — 원본 데이터는 건드리지 않음)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CLIENT_DIR = path.join(__dirname, '..', '..', 'client');
const OUT_PATH = path.join(__dirname, '_accident_raw', 'hk_jurisdiction_mismatch_candidates.json');

const ORG_LABEL_OF = {
    1532418: '속초해양경찰서', 1532440: '동해해양경찰서', 1532466: '포항해양경찰서', 1532304: '울산해양경찰서',
    1532329: '부산해양경찰서', 1532357: '창원해양경찰서', 1532376: '통영해양경찰서', 1532170: '여수해양경찰서',
    1532199: '완도해양경찰서', 1532222: '목포해양경찰서', 1532255: '군산해양경찰서', 1532056: '보령해양경찰서',
    1532074: '태안해양경찰서', 1532098: '평택해양경찰서', 1532121: '인천해양경찰서', 1532508: '제주해양경찰서',
    1532530: '서귀포해양경찰서', 1532281: '부안해양경찰서', 1532609: '울진해양경찰서', 1532759: '사천해양경찰서',
    1532865: '강릉해양경찰서',
    1750163: '속초해양경찰서', 1750186: '동해해양경찰서', 1750213: '포항해양경찰서', 1750259: '울산해양경찰서',
    1750283: '부산해양경찰서', 1750311: '창원해양경찰서', 1750329: '통영해양경찰서', 1750374: '여수해양경찰서',
    1750403: '완도해양경찰서', 1750426: '목포해양경찰서', 1750461: '군산해양경찰서', 1750494: '보령해양경찰서',
    1750511: '태안해양경찰서', 1750533: '평택해양경찰서', 1750556: '인천해양경찰서', 1750608: '제주해양경찰서',
    1750612: '제주해양경찰서', 1750631: '서귀포해양경찰서', 1750632: '서귀포해양경찰서',
};

// 웹서핑으로 확인한 개서일(YYYYMMDD) — 헤더 주석 참고. 이 날짜 이전 사고는
// 이 서의 폴리곤 안에 있어도 검사하지 않는다(전신 서 특정 불가 — 안전 우선).
const ESTABLISHED_YMD = {
    평택해양경찰서: '20110401',
    창원해양경찰서: '20121227',
    보령해양경찰서: '20140401',
    부안해양경찰서: '20160421',
    울진해양경찰서: '20171128',
    강릉해양경찰서: '20250331',
};

function pointInPolygon(lon, lat, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/** 점에서 폴리곤 경계까지 최소 거리(도 단위, 위경도 유클리드 근사) — 위경도 1도
 * ≈ 111km 이므로 대략 km 환산도 함께 씀. build_tribunal_merge.js 와 동일 공식. */
function distToPolygonBoundary(lon, lat, coords) {
    let best = Infinity;
    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[(i + 1) % coords.length];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((lon - x1) * dx + (lat - y1) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + t * dx, py = y1 + t * dy;
        const d = Math.hypot(lon - px, lat - py);
        if (d < best) best = d;
    }
    return best;
}

function main() {
    const faces = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_jurisdiction_faces.json'), 'utf8'));
    const gangneung = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'coastguard_gangneung_zone.json'), 'utf8'));
    const hkData = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'accident_ships_hk.json'), 'utf8'));

    /** (lat,lon,ymd) -> {owner, coords, preEstablish} | null(신뢰 면 밖). preEstablish=true 면
     * "신설 서 폴리곤 안이지만 그 신설일 이전이라 전신 서 특정 불가"라 판정에서 뺀다. */
    function findExpected(lat, lon, ymd) {
        if (ymd >= gangneung.effective_from && pointInPolygon(lon, lat, gangneung.coords)) {
            return { owner: '강릉해양경찰서', coords: gangneung.coords, preEstablish: false };
        }
        for (const f of faces) {
            if (!pointInPolygon(lon, lat, f.coords)) continue;
            const est = ESTABLISHED_YMD[f.owner];
            if (est && ymd < est) return { owner: f.owner, coords: f.coords, preEstablish: true };
            return { owner: f.owner, coords: f.coords, preEstablish: false };
        }
        return null;
    }

    // 폴리곤 재구성 자체의 검증 정확도가 91.9%였다(별도 세션, 80/20 학습셋 검증) — 즉 "신뢰
    // 면"에 맞아도 그 경계선 자체가 8% 안팎의 오차를 갖는다. 그래서 경계에서 먼(=확실히 그
    // 서 영역 안쪽) 불일치만 "확실한 후보"로 따로 센다 — 경계 근처는 폴리곤 오차와 구분이
    // 안 돼 진짜 데이터 오류라고 확신할 수 없다. 0.03도 ≈ 3.3km(위도 기준) 를 경계로 삼음
    // (이 프로젝트에서 "동일 사고" 판정에 이미 쓰는 3km 반경과 비슷한 크기로 맞춤).
    const CONFIDENT_KM_DEG = 0.03;

    let total = 0, excluded2025 = 0, excludedSacheon = 0, checked = 0, skippedPreEstablish = 0,
        unclassified = 0, matched = 0, mismatched = 0, confidentMismatch = 0;
    const candidates = [];
    const totalByRecorded = {}; // 기록된 관할서별 검사 대상 건수 — 비율 계산용

    hkData.rows.forEach((row, idx) => {
        total++;
        const [lat, lon, ymd] = row;
        if (String(ymd).startsWith('2025')) { excluded2025++; return; } // 심판원 단독 — 사용자 확정 제외
        const recordedCd = row[8];
        const recordedName = ORG_LABEL_OF[recordedCd];
        if (recordedName === '사천해양경찰서') { excludedSacheon++; return; } // 사천 폴리곤 없음 — 비교 불가

        checked++;
        if (recordedName) totalByRecorded[recordedName] = (totalByRecorded[recordedName] || 0) + 1;
        const hit = findExpected(lat, lon, ymd);
        if (hit == null) { unclassified++; return; }
        if (hit.preEstablish) { skippedPreEstablish++; return; }
        if (hit.owner === recordedName) { matched++; return; }
        mismatched++;
        const distDeg = distToPolygonBoundary(lon, lat, hit.coords);
        const confident = distDeg >= CONFIDENT_KM_DEG;
        if (confident) confidentMismatch++;
        candidates.push({
            idx, lat, lon, ymd, hm: row[3], typeCd: row[5], caseNo: row[16] || null,
            recorded: recordedName || String(recordedCd), expected: hit.owner,
            distFromBoundaryKm: Math.round(distDeg * 111 * 10) / 10, confident,
        });
    });

    console.log('[관할해경서 오분류 감사] hk 전체', total, '건');
    console.log('  제외: 심판원 단독(2025)', excluded2025, '건 · 사천(폴리곤 없음)', excludedSacheon, '건');
    console.log('  검사 대상', checked, '건 중:');
    console.log('    신설 이전(전신 서 특정 불가, 스킵)', skippedPreEstablish, '건');
    console.log('    신뢰 면 밖(판정 불가)', unclassified, '건');
    console.log('    일치', matched, '건');
    console.log('    ❗ 불일치(전체, 경계 오차 포함 가능)', mismatched, '건');
    console.log('    ❗❗ 그중 "확실한" 불일치(경계에서', CONFIDENT_KM_DEG * 111, 'km 이상 안쪽)', confidentMismatch, '건');
    console.log('       — 폴리곤 자체 정확도가 91.9%(별도 검증)라, 경계 근처 불일치는 폴리곤 오차일 수 있어 위 "확실한" 쪽만 신뢰도 높음.');

    const byPair = {};
    candidates.filter((c) => c.confident).forEach((c) => {
        const k = c.recorded + ' → ' + c.expected;
        byPair[k] = (byPair[k] || 0) + 1;
    });
    console.log('  "확실한" 불일치 조합별 건수(상위 20):');
    Object.entries(byPair).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, n]) => console.log('   ', n + '건', k));

    // 관할서별 "확실한" 불일치 비율 — 이 비율이 유독 높은 서(예: 40%대)는 개별 데이터
    // 오류가 그렇게 많이 몰려있다고 보기보다, 그 서 폴리곤 자체가 부정확할 가능성을
    // 먼저 의심해야 한다(카파시 4번: 도구 자체를 의심). 대부분 서는 한 자릿수%대에
    // 몰려 있는 것과 비교해서 판단할 것.
    const byConfidentRecorded = {};
    candidates.filter((c) => c.confident).forEach((c) => { byConfidentRecorded[c.recorded] = (byConfidentRecorded[c.recorded] || 0) + 1; });
    console.log('  관할서별 "확실한" 불일치 비율(검사 대상 대비, 내림차순):');
    Object.keys(totalByRecorded)
        .map((name) => ({ name, total: totalByRecorded[name], mismatch: byConfidentRecorded[name] || 0 }))
        .sort((a, b) => (b.mismatch / b.total) - (a.mismatch / a.total))
        .forEach((r) => console.log('   ', r.name, '총', r.total, '건 중', r.mismatch, '건 —', (r.mismatch / r.total * 100).toFixed(1) + '%'));

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(candidates, null, 1));
    console.log('후보 목록 저장(전체 불일치, confident 플래그 포함):', OUT_PATH);
}

main();
